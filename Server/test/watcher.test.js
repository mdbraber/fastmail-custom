import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AccountWatcher, COALESCE_MS } from '../src/watcher.js';
import { emptyState, loadState } from '../src/state.js';
import { JMAPError } from '../src/jmap.js';

const silent = { warn() {}, info() {}, error() {} };
const account = { name: 'personal', token: 't', topic: 'com.mdbraber.fastmail.personal' };

const arrival = (id, over = {}) => ({
    id, threadId: `T-${id}`, mailboxIds: { inbox: true }, keywords: {},
    from: [{ name: 'Ada', email: 'ada@example.net' }], subject: `Subject ${id}`, ...over,
});

function fakeJMAP({ emails = [], created = [], counts = { badge: 4 }, refusePush = false, changesError = null } = {}) {
    const calls = [];
    return {
        calls, counts, accountId: 'acc1', eventSourceUrl: 'https://api.example.net/jmap/event/',
        fetch: async () => { throw new Error('no network in tests'); },
        headers: () => ({ authorization: 'Bearer t' }),
        connect: async () => {},
        mailboxes: async () => [
            { id: 'inbox', name: 'Inbox', role: 'inbox' },
            { id: 'triage', name: 'Triage', role: null },
        ],
        emailState: async () => 's0',
        mailboxTotal: async () => counts.badge,
        emailChanges: async (since) => {
            calls.push(['changes', since]);
            if (changesError) throw changesError;
            return { created, newState: 's1' };
        },
        emails: async (ids) => emails.filter((e) => ids.includes(e.id)),
        pushSubscriptions: async () => [{ id: 'old', deviceClientId: 'fastmail-push-personal' }],
        destroyPushSubscription: async (id) => { calls.push(['destroy', id]); },
        createPushSubscription: async ({ url }) => {
            calls.push(['subscribe', url]);
            if (refusePush) throw new JMAPError('PushSubscription/set: forbidden', { type: 'forbidden' });
            return { id: 'sub1', expires: new Date(Date.now() + 3600 * 1000).toISOString() };
        },
        verifyPushSubscription: async (id, code) => { calls.push(['verify', id, code]); },
    };
}

function fakeAPNs(answer = () => ({ status: 200, reason: null })) {
    const sent = [];
    return { sent, send: async (token, payload, options) => { sent.push({ token, payload, ...options }); return answer(token); } };
}

function fakeDevices(tokens) {
    const removed = [];
    return { removed, tokens: () => tokens.filter((t) => !removed.includes(t)), remove: async (_, t) => { removed.push(t); } };
}

// Timers under the test's control: only what is due within `upTo` runs.
function manualTimers() {
    const queue = [];
    return {
        queue,
        setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; },
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        async run(upTo = COALESCE_MS) {
            for (const entry of queue.splice(0)) {
                if (entry.ms <= upTo) await entry.fn(); else queue.push(entry);
            }
        },
    };
}

async function setUp(jmapOptions, { apns = fakeAPNs(), devices = fakeDevices(['tok1', 'tok2']), notices = 'auto' } = {}) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'watcher-'));
    const config = { publicUrl: 'https://push.example.net', badgeLabel: 'Triage', notices, dataDir: dir };
    const jmap = fakeJMAP(jmapOptions);
    const timers = manualTimers();
    const watcher = new AccountWatcher({ account, config, jmap, apns, devices, state: emptyState(), log: silent, timers });
    await watcher.start();
    return { dir, jmap, apns, devices, timers, watcher };
}

async function settle({ timers, watcher }) {
    await timers.run();
    await watcher.chain;
}

test('one new Inbox message becomes one alert per device, carrying the badge, and is remembered', async () => {
    const t = await setUp({ created: ['M1', 'M2'], emails: [arrival('M1'), arrival('M2', { mailboxIds: { other: true } })] });
    assert.equal(t.watcher.notices, 'push');
    assert.deepEqual(t.jmap.calls.find((c) => c[0] === 'destroy'), ['destroy', 'old']);
    assert.match(t.jmap.calls.find((c) => c[0] === 'subscribe')[1], /^https:\/\/push\.example\.net\/jmap\/personal\/[0-9a-f]{32}$/);

    await t.watcher.receive({ '@type': 'PushVerification', pushSubscriptionId: 'sub1', verificationCode: 'v1' });
    assert.equal(t.watcher.verified, true);
    assert.deepEqual(t.jmap.calls.find((c) => c[0] === 'verify'), ['verify', 'sub1', 'v1']);

    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);

    assert.equal(t.apns.sent.length, 2);
    assert.deepEqual(t.apns.sent.map((s) => s.token), ['tok1', 'tok2']);
    assert.equal(t.apns.sent[0].payload.aps.alert.title, 'Ada');
    assert.equal(t.apns.sent[0].payload.aps.badge, 4);
    assert.equal(t.apns.sent[0].payload.url, 'https://app.fastmail.com/mail/Inbox/T-M1');
    assert.equal(t.apns.sent[0].collapseId, 'M1');
    assert.equal(t.apns.sent[0].topic, account.topic);

    const saved = await loadState(t.dir, 'personal', silent);
    assert.deepEqual(saved, { emailState: 's1', notified: ['M1'], badge: 4 });
});

test('the same message never notifies twice', async () => {
    const t = await setUp({ created: ['M1'], emails: [arrival('M1')] });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's2' } } });
    await settle(t);
    assert.equal(t.apns.sent.length, 2);
});

test('a changed count with no new mail is a badge-only push, once per change', async () => {
    const t = await setUp({ created: [] });
    t.jmap.counts.badge = 3;
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Mailbox: 'm1' } } });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Mailbox: 'm2' } } });
    await settle(t);
    assert.deepEqual(t.apns.sent.map((s) => s.payload), [{ aps: { badge: 3 } }, { aps: { badge: 3 } }]);
    assert.equal(t.apns.sent[0].collapseId, null);

    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Mailbox: 'm3' } } });
    await settle(t);
    assert.equal(t.apns.sent.length, 2);
});

test('a notice for someone else, or with nothing of ours in it, is ignored', async () => {
    const t = await setUp({ created: ['M1'], emails: [arrival('M1')] });
    await t.watcher.receive({ '@type': 'StateChange', changed: { other: { Email: 's1' } } });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Calendar: 'c1' } } });
    await t.watcher.receive({ '@type': 'PushVerification', pushSubscriptionId: 'not-ours', verificationCode: 'x' });
    await settle(t);
    assert.equal(t.apns.sent.length, 0);
    assert.equal(t.watcher.verified, false);
});

test('a device APNs calls dead is dropped', async () => {
    const apns = fakeAPNs((token) => token === 'tok2' ? { status: 410, reason: 'Unregistered' } : { status: 200, reason: null });
    const t = await setUp({ created: ['M1'], emails: [arrival('M1')] }, { apns });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);
    assert.deepEqual(t.devices.removed, ['tok2']);
});

test('a lost change log means a silent resync', async () => {
    const error = new JMAPError('Email/changes: cannotCalculateChanges', { type: 'cannotCalculateChanges' });
    const t = await setUp({ created: ['M1'], emails: [arrival('M1')], changesError: error });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);
    assert.equal(t.apns.sent.length, 0);
    assert.equal((await loadState(t.dir, 'personal', silent)).emailState, 's0');
});

test('when the push subscription is refused the event source takes over', async () => {
    const t = await setUp({ refusePush: true });
    assert.equal(t.watcher.notices, 'eventsource');
    assert.equal(t.watcher.status().notices, 'eventsource');
    t.watcher.stop();
});

test('NOTICES=push does not fall back', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'watcher-'));
    const config = { publicUrl: 'https://push.example.net', badgeLabel: 'Triage', notices: 'push', dataDir: dir };
    const timers = manualTimers();
    const watcher = new AccountWatcher({ account, config, jmap: fakeJMAP({ refusePush: true }), apns: fakeAPNs(), devices: fakeDevices([]), state: emptyState(), log: silent, timers });
    await watcher.start();
    assert.equal(watcher.notices, null);
    assert.equal(timers.queue.length, 1);
});
