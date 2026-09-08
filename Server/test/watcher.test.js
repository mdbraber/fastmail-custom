import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AccountWatcher, BACKLOG_CAP, COALESCE_MS } from '../src/watcher.js';
import { emptyState, loadState } from '../src/state.js';
import { JMAPError } from '../src/jmap.js';
import { encrypt, keysFromSubscription } from './helpers/webpush-encrypt.js';

const silent = { warn() {}, info() {}, error() {} };
const account = { name: 'personal', token: 't', topic: 'com.mdbraber.fastmail.personal' };

const arrival = (id, over = {}) => ({
    id, threadId: `T-${id}`, mailboxIds: { inbox: true }, keywords: {},
    from: [{ name: 'Ada', email: 'ada@example.net' }], subject: `Subject ${id}`, ...over,
});

// `refusePush` and `onCreate` are properties rather than options only so a
// test can change its mind after start(), which is where renewals happen.
function fakeJMAP({ emails = [], created = [], counts = { badge: 4 }, refusePush = false, changesError = null } = {}) {
    const calls = [];
    const fake = {
        calls, counts, refusePush, onCreate: null,
        accountId: 'acc1', eventSourceUrl: 'https://api.example.net/jmap/event/',
        fetch: async () => { throw new Error('no network in tests'); },
        headers: () => ({ authorization: 'Bearer t' }),
        connect: async () => {},
        // `hidden` is Fastmail's own flag; bit 1 is "not in the folder list",
        // which is how a history label is told from one you file under.
        mailboxes: async () => [
            { id: 'inbox', name: 'Inbox', role: 'inbox', hidden: 0 },
            { id: 'triage', name: 'Triage', role: null, hidden: 0 },
            { id: 'kerk', name: 'Kerk', role: null, hidden: 0 },
            { id: 'later', name: 'Later', role: null, hidden: 0 },
            { id: 'y2019', name: '2019', role: null, hidden: 1 },
            { id: 'archive', name: 'Archive', role: 'archive', hidden: 0 },
        ],
        patchEmail: async (id, patch) => {
            calls.push(['set', id, patch]);
            if (id === 'M-missing') throw new JMAPError('Email/set: notFound', { type: 'notFound' });
        },
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
        createPushSubscription: async ({ url, keys }) => {
            calls.push(['subscribe', url, keys]);
            await fake.onCreate?.();
            if (fake.refusePush) throw new JMAPError('PushSubscription/set: forbidden', { type: 'forbidden' });
            return { id: 'sub1', expires: new Date(Date.now() + 3600 * 1000).toISOString() };
        },
        verifyPushSubscription: async (id, code) => { calls.push(['verify', id, code]); },
    };
    return fake;
}

function fakeAPNs(answer = () => ({ status: 200, reason: null })) {
    const sent = [];
    return { sent, send: async (token, payload, options) => { sent.push({ token, payload, ...options }); return answer(token); } };
}

function fakeDevices(tokens, muted = []) {
    const removed = [];
    const live = () => tokens.filter((t) => !removed.includes(t));
    return {
        removed,
        tokens: (_, { alerts } = {}) => live().filter((t) => alerts === undefined || alerts !== muted.includes(t)),
        remove: async (_, t) => { removed.push(t); },
    };
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

async function build(jmapOptions, { apns = fakeAPNs(), devices = fakeDevices(['tok1', 'tok2']), notices = 'auto', holdLabels = ['Later'] } = {}) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'watcher-'));
    const config = { publicUrl: 'https://push.example.net', badgeLabel: 'Triage', holdLabels, notices, dataDir: dir };
    const jmap = fakeJMAP(jmapOptions);
    const timers = manualTimers();
    const watcher = new AccountWatcher({ account, config, jmap, apns, devices, state: emptyState(), log: silent, timers });
    return { dir, jmap, apns, devices, timers, watcher };
}

async function setUp(jmapOptions, options) {
    const started = await build(jmapOptions, options);
    await started.watcher.start();
    return started;
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
    assert.equal(t.apns.sent[0].payload.url, 'https://app.fastmail.com/mail/Inbox/T-M1.M1');
    assert.equal(t.apns.sent[0].collapseId, 'M1');
    assert.equal(t.apns.sent[0].topic, account.topic);

    const saved = await loadState(t.dir, 'personal', silent);
    assert.deepEqual(saved, { emailState: 's1', notified: ['M1'], badge: 4 });
});

test('a device with alerts off hears only the count, and the count still follows every change', async () => {
    const created = ['M1'];
    const emails = [arrival('M1')];
    const t = await setUp({ created, emails }, { devices: fakeDevices(['tok1', 'tok2'], ['tok2']) });
    assert.equal(t.watcher.status().devices, 2);
    assert.equal(t.watcher.status().muted, 1);

    // New mail and a changed count: the alert carries it to one, a bare count goes to the other
    t.jmap.counts.badge = 5;
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);
    assert.deepEqual(
        t.apns.sent.map((s) => [s.token, s.collapseId, s.payload.aps.alert?.title ?? null, s.payload.aps.badge]),
        [['tok1', 'M1', 'Ada', 5], ['tok2', 'badge', null, 5]],
    );

    // No new mail, a changed count: everyone hears it, once
    t.apns.sent.length = 0;
    t.jmap.counts.badge = 3;
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Mailbox: 'x' } } });
    await settle(t);
    assert.deepEqual(t.apns.sent.map((s) => [s.token, s.payload]), [['tok1', { aps: { badge: 3 } }], ['tok2', { aps: { badge: 3 } }]]);

    // New mail with the count unchanged: the muted device hears nothing
    t.apns.sent.length = 0;
    created.push('M2');
    emails.push(arrival('M2'));
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's2' } } });
    await settle(t);
    assert.deepEqual(t.apns.sent.map((s) => s.token), ['tok1']);
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
    assert.equal(t.apns.sent[0].collapseId, 'badge');

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

test('a change log too long to announce is a silent resync', async () => {
    const created = Array.from({ length: BACKLOG_CAP + 1 }, (_, index) => `M${index}`);
    const t = await setUp({ created, emails: created.map((id) => arrival(id)) });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);
    assert.equal(t.apns.sent.length, 0);
    assert.equal((await loadState(t.dir, 'personal', silent)).emailState, 's0');
});

test('a verification that beats the create is held until the id arrives', async () => {
    const t = await build();
    // Fastmail can call the callback URL back before PushSubscription/set answers
    t.jmap.onCreate = () => t.watcher.receive({ '@type': 'PushVerification', pushSubscriptionId: 'sub1', verificationCode: 'early' });
    await t.watcher.start();
    assert.equal(t.watcher.verified, true);
    assert.equal(t.watcher.pendingVerification, null);
    assert.deepEqual(t.jmap.calls.find((c) => c[0] === 'verify'), ['verify', 'sub1', 'early']);
});

test('the subscription is renewed before it expires, on a fresh secret', async () => {
    const t = await setUp();
    await t.timers.run(Infinity);
    const urls = t.jmap.calls.filter((c) => c[0] === 'subscribe').map((c) => c[1]);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /^https:\/\/push\.example\.net\/jmap\/personal\/[0-9a-f]{32}$/);
    assert.notEqual(urls[0], urls[1]);
    assert.equal(t.watcher.notices, 'push');
});

test('the subscription carries Web Push keys, and a callback sealed to them is read', async () => {
    const t = await build();
    assert.equal(t.watcher.unseal(Buffer.from('early')), null, 'nothing decrypts before there is a subscription');
    await t.watcher.start();

    const sent = t.jmap.calls.find((c) => c[0] === 'subscribe')[2];
    assert.deepEqual(Object.keys(sent), ['p256dh', 'auth']);
    const keys = keysFromSubscription(sent);
    assert.equal(keys.publicKey.length, 65);
    assert.equal(keys.auth.length, 16);

    const notice = { '@type': 'StateChange', changed: { acc1: { Email: 's1' } } };
    assert.deepEqual(t.watcher.unseal(encrypt(JSON.stringify(notice), keys)), notice);
    assert.equal(t.watcher.unseal(encrypt('not json', keys)), null);
    assert.equal(t.watcher.unseal(Buffer.from('garbage that is long enough to look at'.repeat(3))), null);
});

test('a renewal seals to fresh keys; the old ones are no longer accepted', async () => {
    const t = await setUp();
    const before = keysFromSubscription(t.jmap.calls.find((c) => c[0] === 'subscribe')[2]);
    await t.timers.run(Infinity);
    const subscribes = t.jmap.calls.filter((c) => c[0] === 'subscribe');
    assert.equal(subscribes.length, 2);
    const after = keysFromSubscription(subscribes[1][2]);
    assert.notDeepEqual(after.publicKey, before.publicKey);
    assert.notDeepEqual(after.auth, before.auth);

    const body = JSON.stringify({ '@type': 'PushVerification', pushSubscriptionId: 'sub1', verificationCode: 'x' });
    assert.equal(t.watcher.unseal(encrypt(body, before)), null);
    assert.deepEqual(t.watcher.unseal(encrypt(body, after)), JSON.parse(body));
});

test('a renewal Fastmail refuses hands the account to the event source', async () => {
    const t = await setUp();
    t.jmap.refusePush = true;
    await t.timers.run(Infinity);
    assert.equal(t.watcher.notices, 'eventsource');
    t.watcher.stop();
});

test('when the push subscription is refused the event source takes over', async () => {
    const t = await setUp({ refusePush: true });
    assert.equal(t.watcher.notices, 'eventsource');
    assert.equal(t.watcher.status().notices, 'eventsource');
    t.watcher.stop();
});

test('NOTICES=push does not fall back', async () => {
    const t = await build({ refusePush: true }, { notices: 'push' });
    await t.watcher.start();
    assert.equal(t.watcher.notices, null);
    assert.equal(t.timers.queue.length, 1);
});


// The buttons on a notification. The phone cannot do any of this itself, so
// it asks here — and each verb has to mean the same thing it means in the
// app, or the same button does two different things depending on where you
// press it. A message carrying the Inbox, Triage, a project and a hold.
const decided = (over = {}) => arrival('M1', {
    mailboxIds: { inbox: true, triage: true, kerk: true, later: true },
    keywords: { $seen: true, $flagged: true },
    ...over,
});

const patchOf = (t) => {
    const write = t.jmap.calls.find((c) => c[0] === 'set');
    return write?.[2];
};

// Archive: out of the Inbox, no longer waiting for triage, the project label
// off since it is the live state and this message is no longer live, the pin
// off, and the hold label left alone — a hold outlives a decision.
test('archiving from a notification means what archiving means in the app', async () => {
    const t = await setUp({ emails: [decided()] });

    await t.watcher.archive('M1');

    assert.deepEqual(patchOf(t), {
        'mailboxIds/inbox': null,
        'mailboxIds/triage': null,
        'mailboxIds/kerk': null,
        'mailboxIds/archive': true,
        'keywords/$flagged': null,
    });
});

// Nothing is asked for that is not needed: an unpinned message in nothing but
// the Inbox archives without a word about pins or labels it does not carry.
test('archiving asks only for the changes the message actually needs', async () => {
    const t = await setUp({ emails: [decided({ mailboxIds: { inbox: true }, keywords: {} })] });

    await t.watcher.archive('M1');

    assert.deepEqual(patchOf(t), {
        'mailboxIds/inbox': null,
        'mailboxIds/archive': true,
    });
});

// Later: a hold is a filing destination like a project, so it replaces —
// Triage and the project come off. The Inbox stays: a held message is still
// in the Inbox, and the pin is none of filing's business.
test('filing under the hold label replaces the labels but keeps the Inbox', async () => {
    const t = await setUp({ emails: [decided({ mailboxIds: { inbox: true, triage: true, kerk: true } })] });

    await t.watcher.later('M1');

    assert.deepEqual(patchOf(t), {
        'mailboxIds/later': true,
        'mailboxIds/triage': null,
        'mailboxIds/kerk': null,
    });
});

// The history labels — the years, the shelves — are hidden from the sidebar,
// and nothing here adds, removes or counts them.
test('a hidden history label is never touched', async () => {
    const t = await setUp({ emails: [decided({ mailboxIds: { inbox: true, y2019: true, kerk: true } })] });

    await t.watcher.archive('M1');

    assert.equal(Object.hasOwn(patchOf(t), 'mailboxIds/y2019'), false);
});

// Pin: one keyword, and nothing else moves.
test('pinning from a notification flags the message and moves nothing', async () => {
    const t = await setUp({ emails: [decided({ keywords: {} })] });

    await t.watcher.pin('M1');

    assert.deepEqual(patchOf(t), { 'keywords/$flagged': true });
});

// A label that is not in the account cannot be filed under, and saying so is
// better than a patch that quietly does half the job.
test('filing without a hold label in the account is refused', async () => {
    const t = await build({ emails: [decided()] }, { holdLabels: ['Nowhere'] });
    await t.watcher.start();

    await assert.rejects(() => t.watcher.later('M1'), /Nowhere/);
});

// Nothing is quietly swallowed: the phone shows a banner saying it failed,
// and it can only do that if the failure reaches it.
test('an archive that will not go through is reported rather than swallowed', async () => {
    const t = await setUp({ emails: [decided({ id: 'M-missing' })] });
    await assert.rejects(() => t.watcher.archive('M-missing'), /notFound/);
});

// A message that has been dealt with elsewhere between the banner and the
// button press is not something to guess about.
test('an action on a message that is gone says so', async () => {
    const t = await setUp({ emails: [] });
    await assert.rejects(() => t.watcher.pin('M1'), /no such message/);
});
