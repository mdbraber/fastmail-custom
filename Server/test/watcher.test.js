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
const account = { name: 'personal', token: 't', topic: 'com.mdbraber.fastmail-custom.personal' };

const arrival = (id, over = {}) => ({
    id, threadId: `T-${id}`, mailboxIds: { inbox: true }, keywords: {},
    from: [{ name: 'Ada', email: 'ada@example.net' }], subject: `Subject ${id}`, ...over,
});

// `refusePush` and `onCreate` are properties rather than options only so a
// test can change its mind after start(), which is where renewals happen.
function fakeJMAP({
    emails = [], created = [], counts = { badge: 4 }, refusePush = false, changesError = null,
    contactsAccountIds = [], books = {}, threadMessages = {},
} = {}) {
    const calls = [];
    const fake = {
        calls, counts, refusePush, onCreate: null,
        accountId: 'acc1', eventSourceUrl: 'https://api.example.net/jmap/event/',
        // One address book per contacts account id: `{ cards, state, error }`.
        // `books` is keyed the same way as the real `contactsAccountIds`, and
        // a test may reach into `fake.books[id]` between looks to change an
        // address book or make one fail.
        contactsAccountIds, books: { ...books },
        contactCards: async (accountId) => {
            calls.push(['contacts', accountId]);
            const book = fake.books[accountId] ?? {};
            if (book.error) throw book.error;
            return { cards: book.cards ?? [], state: book.state ?? null };
        },
        fetch: async (url) => { calls.push(['eventsource', String(url)]); throw new Error('no network in tests'); },
        // `threadMessages`: thread id → its messages with their keywords
        threadsError: null,
        threads: async (ids) => {
            calls.push(['threads', ids]);
            if (fake.threadsError) throw fake.threadsError;
            return ids.map((id) => ({ id, emailIds: (threadMessages[id] ?? []).map((message) => message.id) }));
        },
        keywords: async (ids) => {
            calls.push(['keywords', ids]);
            return Object.values(threadMessages).flat()
                .filter((message) => ids.includes(message.id))
                .map(({ id, keywords }) => ({ id, keywords }));
        },
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
            { id: 'junk', name: 'Spam', role: 'junk', hidden: 0 },
            { id: 'trash', name: 'Trash', role: 'trash', hidden: 0 },
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
        createPushSubscription: async ({ url, keys, types }) => {
            calls.push(['subscribe', url, keys, types]);
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

const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [] };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [] };

// Each token with its choice: inbox, unless `choices` names another
function fakeDevices(tokens, choices = {}) {
    const removed = [];
    const live = () => tokens.filter((t) => !removed.includes(t));
    return {
        removed,
        entries: () => live().map((token) => ({ token, notify: choices[token] ?? INBOX })),
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

    // M2 was put to every device too, and matched none: it counts as announced
    const saved = await loadState(t.dir, 'personal', silent);
    assert.deepEqual(saved, { emailState: 's1', notified: ['M1', 'M2'], badge: 4 });
});

test('a device whose choice is off hears only the count, and the count still follows every change', async () => {
    const created = ['M1'];
    const emails = [arrival('M1')];
    const t = await setUp({ created, emails }, { devices: fakeDevices(['tok1', 'tok2'], { tok2: OFF }) });
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


// The buttons on a notification. The phone cannot do any of this itself, so it
// asks here, and each verb has to mean the same thing it means in the app, or
// the same button does two different things depending on where you press it.
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
// off, and the hold label left alone, a hold outlives a decision.
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

// Later: a hold is a filing destination like a project, so it replaces, Triage
// and the project come off.
test('filing under the hold label replaces the labels but keeps the Inbox', async () => {
    const t = await setUp({ emails: [decided({ mailboxIds: { inbox: true, triage: true, kerk: true } })] });

    await t.watcher.later('M1');

    assert.deepEqual(patchOf(t), {
        'mailboxIds/later': true,
        'mailboxIds/triage': null,
        'mailboxIds/kerk': null,
    });
});

// The history labels; the years, the shelves, are hidden from the sidebar,
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


// Contacts and VIPs. The tokens may or may not read contacts, and the
// watcher has to work either way.
const person = (uid, address) => ({ id: `id-${uid}`, uid, kind: 'individual', emails: { e1: { address } } });
const addressBook = () => [
    person('ada', 'Ada@Example.net'),
    person('bob', 'bob@example.net'),
    { id: 'id-vips', uid: 'vips', kind: 'group', members: { ada: true } },
];

test('ContactCard is subscribed to only when the token can read contacts', async () => {
    const without = await setUp();
    assert.deepEqual(without.jmap.calls.find((c) => c[0] === 'subscribe')[3], ['Email', 'Mailbox']);

    const withAccess = await setUp({ contactsAccountIds: ['acc2'] });
    assert.deepEqual(withAccess.jmap.calls.find((c) => c[0] === 'subscribe')[3], ['Email', 'Mailbox', 'ContactCard']);

    // The event source asks for the same types
    const plain = await setUp({ refusePush: true });
    const fallback = await setUp({ refusePush: true, contactsAccountIds: ['acc2'] });
    try {
        assert.equal(new URL(plain.jmap.calls.find((c) => c[0] === 'eventsource')[1]).searchParams.get('types'), 'Email,Mailbox');
        assert.equal(new URL(fallback.jmap.calls.find((c) => c[0] === 'eventsource')[1]).searchParams.get('types'), 'Email,Mailbox,ContactCard');
    } finally {
        plain.watcher.stop();
        fallback.watcher.stop();
    }
});

test('the contact sets are built from the cards and the VIPs group when the watcher starts', async () => {
    const t = await setUp({ contactsAccountIds: ['acc2'], books: { acc2: { cards: addressBook(), state: 'cs1' } } });
    assert.deepEqual([...t.watcher.contactAddresses].sort(), ['ada@example.net', 'bob@example.net']);
    assert.deepEqual([...t.watcher.vipAddresses], ['ada@example.net']);
    assert.deepEqual(t.watcher.contactsStates, { acc2: 'cs1' });
});

test('a ContactCard change reads the cards again; a notice carrying the state already read does not', async () => {
    const t = await setUp({ contactsAccountIds: ['acc2'], books: { acc2: { cards: addressBook(), state: 'cs1' } } });
    const reads = () => t.jmap.calls.filter((c) => c[0] === 'contacts').length;
    assert.equal(reads(), 1);

    await t.watcher.receive({ '@type': 'StateChange', changed: { acc2: { ContactCard: 'cs1' } } });
    await settle(t);
    assert.equal(reads(), 1);
    assert.equal(t.jmap.calls.filter((c) => c[0] === 'changes').length, 0);

    // Bob becomes a VIP; the notice names the contacts account, not the mail one
    t.jmap.books.acc2 = {
        cards: [...addressBook().slice(0, 2), { id: 'id-vips', uid: 'vips', kind: 'group', members: { ada: true, bob: true } }],
        state: 'cs2',
    };
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc2: { ContactCard: 'cs2' } } });
    await settle(t);
    assert.equal(reads(), 2);
    assert.deepEqual([...t.watcher.vipAddresses].sort(), ['ada@example.net', 'bob@example.net']);
    assert.deepEqual(t.watcher.contactsStates, { acc2: 'cs2' });

    // The same kind of type under the mail account's id is not ours to read
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { ContactCard: 'cs3' } } });
    await settle(t);
    assert.equal(reads(), 2);
});

test('cards that cannot be read are tried again at the next look', async () => {
    const t = await build({ contactsAccountIds: ['acc2'], books: { acc2: { cards: addressBook(), state: 'cs1' } } });
    t.jmap.books.acc2.error = new JMAPError('ContactCard/query: serverFail', { type: 'serverFail' });
    await t.watcher.start();
    assert.equal(t.watcher.notices, 'push', 'the mail is watched regardless');
    assert.equal(t.watcher.vipAddresses.size, 0);
    assert.equal(t.watcher.contactsDue, true);

    t.jmap.books.acc2.error = null;
    t.watcher.notice('poll');
    await settle(t);
    assert.deepEqual([...t.watcher.vipAddresses], ['ada@example.net']);
    assert.equal(t.watcher.contactsDue, false);
});

test('without contacts access nothing is read, the sets stay empty, and health says so', async () => {
    const without = await setUp({ books: { acc2: { cards: addressBook() } } });
    assert.equal(without.jmap.calls.filter((c) => c[0] === 'contacts').length, 0);
    assert.equal(without.watcher.vipAddresses.size, 0);
    assert.equal(without.watcher.contactAddresses.size, 0);
    assert.equal(without.watcher.hasContacts, false);
    assert.equal(without.watcher.status().contacts, false);

    const withAccess = await setUp({ contactsAccountIds: ['acc2'], books: { acc2: { cards: addressBook(), state: 'cs1' } } });
    assert.equal(withAccess.watcher.hasContacts, true);
    assert.equal(withAccess.watcher.status().contacts, true);
});

// Registrations reply `contacts: null` until this is set, so a device that
// registers while the watcher starts is not told the token cannot read them.
test('the session counts as read once Fastmail has answered it, even when a later step fails, and not before', async () => {
    assert.equal((await setUp()).watcher.sessionRead, true, 'a normal start');

    const t = await build({ contactsAccountIds: ['acc2'], books: { acc2: { cards: addressBook(), state: 'cs1' } } });
    assert.equal(t.watcher.sessionRead, false, 'nothing read before start');

    // A session that cannot be read leaves contacts unknown; start tries again later
    t.jmap.connect = async () => { throw new JMAPError('session: HTTP 503', { status: 503 }); };
    await t.watcher.start();
    assert.equal(t.watcher.sessionRead, false);
    assert.equal(t.watcher.notices, null, 'the start did fail');

    // Read, and then the account has no Inbox: the start fails, the contacts are known
    t.jmap.connect = async () => {};
    t.jmap.mailboxes = async () => [];
    await t.watcher.start();
    assert.equal(t.watcher.notices, null, 'the start did fail');
    assert.equal(t.watcher.sessionRead, true);
    assert.equal(t.watcher.hasContacts, true);
});

// Task 5b: a token typically reads two address books (its own primary one
// and a second, contacts-only account), and VIPs live in only one of them.
test('contacts and VIPs are the union of every address book the token can read, built per account', async () => {
    const first = [
        person('carol', 'carol@example.net'),
        { id: 'id-vips', uid: 'vips', kind: 'group', members: {} },
    ];
    const t = await setUp({
        contactsAccountIds: ['acc2', 'acc3'],
        books: { acc2: { cards: first, state: 'cs-a' }, acc3: { cards: addressBook(), state: 'cs-b' } },
    });
    assert.deepEqual([...t.watcher.contactAddresses].sort(), ['ada@example.net', 'bob@example.net', 'carol@example.net']);
    // acc2's own (empty) VIPs group does not erase acc3's VIP
    assert.deepEqual([...t.watcher.vipAddresses], ['ada@example.net']);
    assert.deepEqual(t.watcher.contactsStates, { acc2: 'cs-a', acc3: 'cs-b' });
});

test('a ContactCard change on either account reloads; matching states on both do not', async () => {
    const t = await setUp({
        contactsAccountIds: ['acc2', 'acc3'],
        books: { acc2: { cards: [], state: 'cs-a' }, acc3: { cards: addressBook(), state: 'cs-b' } },
    });
    const reads = () => t.jmap.calls.filter((c) => c[0] === 'contacts').length;
    assert.equal(reads(), 2, 'one read per account at start-up');

    // Both notices name the states already read: nothing to reload
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc2: { ContactCard: 'cs-a' }, acc3: { ContactCard: 'cs-b' } } });
    await settle(t);
    assert.equal(reads(), 2);

    // The second account alone moves to a new state
    t.jmap.books.acc3 = { cards: addressBook(), state: 'cs-b2' };
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc3: { ContactCard: 'cs-b2' } } });
    await settle(t);
    assert.equal(reads(), 4, 'a reload reads every account again, not only the one that changed');
    assert.deepEqual(t.watcher.contactsStates, { acc2: 'cs-a', acc3: 'cs-b2' });
});

test('one address book failing to read keeps every set and state as they were, until the next look succeeds', async () => {
    const t = await setUp({
        contactsAccountIds: ['acc2', 'acc3'],
        books: { acc2: { cards: addressBook(), state: 'cs-a' }, acc3: { cards: [], state: 'cs-b' } },
    });
    assert.deepEqual([...t.watcher.vipAddresses], ['ada@example.net']);

    // acc3 changes, but this time it cannot be read
    t.jmap.books.acc3 = { cards: [], state: 'cs-b2', error: new JMAPError('ContactCard/query: serverFail', { type: 'serverFail' }) };
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc3: { ContactCard: 'cs-b2' } } });
    await settle(t);
    // Nothing replaced: the previous sets and states, from both accounts, stand
    assert.deepEqual([...t.watcher.vipAddresses], ['ada@example.net']);
    assert.deepEqual(t.watcher.contactsStates, { acc2: 'cs-a', acc3: 'cs-b' });
    assert.equal(t.watcher.contactsDue, true);

    // Fixed: the next look reads every account again and succeeds
    t.jmap.books.acc3.error = null;
    t.watcher.notice('poll');
    await settle(t);
    assert.deepEqual(t.watcher.contactsStates, { acc2: 'cs-a', acc3: 'cs-b2' });
    assert.equal(t.watcher.contactsDue, false);
});


// Each device its own choice: the four side by side, on one batch. Ada is a
// VIP, Bob a contact; M5's thread is followed through another message.
const choices = {
    'tok-inbox': INBOX,
    'tok-important': { mode: 'important', senders: 'everyone', mailboxIds: [] },
    'tok-custom': { mode: 'custom', senders: 'contacts', mailboxIds: ['kerk'] },
    'tok-off': OFF,
};
const batch = () => ({
    contactsAccountIds: ['acc1'],
    books: { acc1: { cards: addressBook(), state: 'cs1' } },
    created: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
    emails: [
        arrival('M1', { from: [{ email: 'stranger@example.net' }] }),
        arrival('M2', { mailboxIds: { kerk: true }, from: [{ email: 'bob@example.net' }] }),
        arrival('M3', { from: [{ name: 'Ada', email: 'ada@example.net' }] }),
        arrival('M4', { mailboxIds: { junk: true }, from: [{ email: 'ADA@example.net' }] }),
        arrival('M5', { mailboxIds: { later: true }, from: [{ email: 'stranger@example.net' }] }),
        arrival('M6', { keywords: { $seen: true }, from: [{ email: 'ada@example.net' }] }),
    ],
    threadMessages: {
        'T-M5': [{ id: 'M5', keywords: {} }, { id: 'M0', keywords: { $followed: true } }],
    },
});
const newMail = (t) => t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
const heardBy = (t, tokens) => Object.fromEntries(tokens.map((token) => [
    token, t.apns.sent.filter((s) => s.token === token).map((s) => [s.collapseId, s.payload.aps.badge]),
]));

test('each device hears the new messages its own choice matches', async () => {
    const t = await setUp(batch(), { devices: fakeDevices(Object.keys(choices), choices) });
    await newMail(t);
    await settle(t);
    assert.deepEqual(heardBy(t, Object.keys(choices)), {
        'tok-inbox': [['M1', 4], ['M3', 4]],
        'tok-important': [['M3', 4], ['M5', 4]],
        'tok-custom': [['M2', 4]],
        'tok-off': [],
    });
    const alert = t.apns.sent.find((s) => s.token === 'tok-custom');
    assert.equal(alert.payload.aps.alert.title, 'bob@example.net');
    assert.equal(alert.payload.url, 'https://app.fastmail.com/mail/Inbox/T-M2.M2');
    assert.equal(alert.topic, account.topic);
});

test('a device that got no alert hears a changed count on its own; one that got an alert has it there', async () => {
    const quiet = { ...choices, 'tok-quiet': { mode: 'custom', senders: 'vips', mailboxIds: ['kerk'] } };
    const t = await setUp(batch(), { devices: fakeDevices(Object.keys(quiet), quiet) });
    t.jmap.counts.badge = 5;
    await newMail(t);
    await settle(t);
    assert.deepEqual(heardBy(t, Object.keys(quiet)), {
        'tok-inbox': [['M1', 5], ['M3', 5]],
        'tok-important': [['M3', 5], ['M5', 5]],
        'tok-custom': [['M2', 5]],
        'tok-off': [['badge', 5]],
        'tok-quiet': [['badge', 5]],
    });
    assert.deepEqual(t.apns.sent.find((s) => s.token === 'tok-off').payload, { aps: { badge: 5 } });
});

test('followed threads are looked up only when a device asks for Important, and only for fresh messages', async () => {
    const withoutImportant = { 'tok-inbox': INBOX, 'tok-custom': choices['tok-custom'] };
    const t = await setUp(batch(), { devices: fakeDevices(Object.keys(withoutImportant), withoutImportant) });
    await newMail(t);
    await settle(t);
    assert.equal(t.jmap.calls.filter((c) => c[0] === 'threads' || c[0] === 'keywords').length, 0);

    const u = await setUp(batch(), { devices: fakeDevices(Object.keys(choices), choices) });
    await newMail(u);
    await settle(u);
    assert.deepEqual(u.jmap.calls.filter((c) => c[0] === 'threads').map((c) => c[1]), [['T-M1', 'T-M2', 'T-M3', 'T-M4', 'T-M5']]);
    assert.deepEqual(u.jmap.calls.filter((c) => c[0] === 'keywords').map((c) => c[1]), [['M5', 'M0']]);
});

test('a thread lookup that fails costs only the followed conversations', async () => {
    const t = await setUp(batch(), { devices: fakeDevices(['tok-important'], choices) });
    t.jmap.threadsError = new JMAPError('Thread/get: serverFail', { type: 'serverFail' });
    await newMail(t);
    await settle(t);
    assert.deepEqual(t.apns.sent.map((s) => s.collapseId), ['M3']);
});

test('a device APNs calls dead in the middle of a batch is dropped and sent nothing more', async () => {
    const apns = fakeAPNs((token) => (token === 'tok-inbox' ? { status: 410, reason: 'Unregistered' } : { status: 200, reason: null }));
    const t = await setUp(batch(), { apns, devices: fakeDevices(Object.keys(choices), choices) });
    t.jmap.counts.badge = 5;
    await newMail(t);
    await settle(t);
    assert.deepEqual(t.devices.removed, ['tok-inbox']);
    assert.deepEqual(heardBy(t, ['tok-inbox', 'tok-off']), { 'tok-inbox': [['M1', 5]], 'tok-off': [['badge', 5]] });
});

test('every fresh message is remembered for the account, whether any device was alerted or not', async () => {
    const t = await setUp(batch(), { devices: fakeDevices(['tok-off'], choices) });
    await newMail(t);
    await settle(t);
    assert.equal(t.apns.sent.length, 0);
    assert.deepEqual((await loadState(t.dir, 'personal', silent)).notified, ['M1', 'M2', 'M3', 'M4', 'M5']);
});

test('health counts the devices per choice, and muted is the ones that are off', async () => {
    const five = { ...choices, 'tok-off-2': OFF };
    const t = await setUp(undefined, { devices: fakeDevices(Object.keys(five), five) });
    assert.deepEqual(t.watcher.status(), {
        notices: 'push',
        verified: false,
        lastNotice: null,
        devices: 5,
        muted: 2,
        contacts: false,
        modes: { off: 2, important: 1, inbox: 1, custom: 1 },
    });
});
