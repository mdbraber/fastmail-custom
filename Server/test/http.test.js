import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'c'.repeat(64);
const sealedNotice = { '@type': 'StateChange', changed: { acc1: { Email: 's7' } } };
const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true };

async function running() {
    const received = [];
    const registered = [];
    const watchers = {
        personal: {
            callbackSecret: 'abc123',
            // Started: the session has been read, so the reply's contacts is a boolean
            sessionRead: true,
            hasContacts: true,
            status: () => ({ notices: 'push', verified: true, lastNotice: null, devices: 1 }),
            receive: async (body) => { received.push(body); },
            // The real one unseals RFC 8291; here "sealed" is the only body that opens
            unseal: (raw) => (raw.equals(Buffer.from('sealed')) ? sealedNotice : null),
        },
    };
    const done = [];
    for (const verb of ['archive', 'later', 'pin']) {
        watchers.personal[verb] = async (emailId) => {
            if (emailId === 'M-missing') throw new Error('no such message');
            done.push([verb, emailId]);
        };
    }
    const cleared = [];
    watchers.personal.deviceCleared = async (value) => { cleared.push(value); };
    const devices = { register: async (account, value, options) => { registered.push([account, value, options]); } };
    const server = createServer({ config: { deviceSecret: 's3cret' }, watchers, devices, log: silent });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, watchers, received, registered, done, cleared, close: () => new Promise((resolve) => server.close(resolve)) };
}

const register = (s, body) => fetch(`${s.base}/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer s3cret' },
    body: JSON.stringify(body),
});

test('healthz reports every account', async () => {
    const s = await running();
    const response = await fetch(`${s.base}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accounts: { personal: { notices: 'push', verified: true, lastNotice: null, devices: 1 } } });
    await s.close();
});

test('device registration needs the bearer, a known account and a real token', async () => {
    const s = await running();
    const post = (headers, body) => fetch(`${s.base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

    assert.equal((await post({}, { account: 'personal', token })).status, 401);
    assert.equal((await post({ authorization: 'Bearer wrong' }, { account: 'personal', token })).status, 401);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: 'work', token })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: 'personal', token: 'nope' })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: '__proto__', token })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: 'constructor', token })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: ['personal'], token })).status, 400);
    const ok = await post({ authorization: 'Bearer s3cret' }, { account: 'personal', token });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, notify: INBOX, contacts: true });
    assert.deepEqual(s.registered, [['personal', token, { notify: INBOX }]]);
    await s.close();
});

test('an older app build registers with alerts alone: true is inbox, false is off, anything else refused', async () => {
    const s = await running();
    try {
        assert.equal((await register(s, { account: 'personal', token, alerts: 'no' })).status, 400);
        assert.equal((await register(s, { account: 'personal', token, alerts: 0 })).status, 400);
        const refused = await register(s, { account: 'personal', token, alerts: null });
        assert.equal(refused.status, 400);
        assert.deepEqual(await refused.json(), { error: 'alerts must be true or false' });
        assert.equal(s.registered.length, 0);

        const on = await register(s, { account: 'personal', token, alerts: true });
        assert.deepEqual(await on.json(), { ok: true, notify: INBOX, contacts: true });
        const off = await register(s, { account: 'personal', token, alerts: false });
        assert.equal(off.status, 200);
        assert.deepEqual(await off.json(), { ok: true, notify: OFF, contacts: true });
        assert.deepEqual(s.registered, [['personal', token, { notify: INBOX }], ['personal', token, { notify: OFF }]]);
    } finally {
        await s.close();
    }
});

test('a registration carrying notify is stored and answered normalised', async () => {
    const s = await running();
    try {
        const choice = { mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'], excludedMailboxIds: ['P9L'], previews: true };
        const custom = await register(s, { account: 'personal', token, notify: choice });
        assert.equal(custom.status, 200);
        assert.deepEqual(await custom.json(), { ok: true, notify: choice, contacts: true });

        const important = await register(s, { account: 'personal', token, notify: { mode: 'important' } });
        const filled = { mode: 'important', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true };
        assert.deepEqual(await important.json(), { ok: true, notify: filled, contacts: true });
        assert.deepEqual(s.registered, [['personal', token, { notify: choice }], ['personal', token, { notify: filled }]]);
    } finally {
        await s.close();
    }
});

test('each malformed notify field is a 400 naming it, and nothing is stored', async () => {
    const s = await running();
    try {
        const cases = [
            [{ notify: null }, /^notify /],
            [{ notify: { senders: 'vips' } }, /^notify\.mode /],
            [{ notify: { mode: 'loud' } }, /^notify\.mode /],
            [{ notify: { mode: 'custom', senders: 'friends' } }, /^notify\.senders /],
            [{ notify: { mode: 'custom', mailboxIds: 'P2F' } }, /^notify\.mailboxIds /],
            [{ notify: { mode: 'custom', mailboxIds: [''] } }, /^notify\.mailboxIds /],
            [{ notify: { mode: 'custom', mailboxIds: Array.from({ length: 201 }, (_, index) => `M${index}`) } }, /^notify\.mailboxIds /],
            [{ notify: { mode: 'custom', mailboxIds: ['P2F'], excludedMailboxIds: [''], previews: true } }, /^notify\.excludedMailboxIds /],
        ];
        for (const [extra, pattern] of cases) {
            const response = await register(s, { account: 'personal', token, ...extra });
            assert.equal(response.status, 400, JSON.stringify(extra).slice(0, 80));
            assert.match((await response.json()).error, pattern);
        }
        assert.equal(s.registered.length, 0);
    } finally {
        await s.close();
    }
});

test('with both fields notify wins, and the reply says whether contacts can be read', async () => {
    const s = await running();
    try {
        const both = await register(s, { account: 'personal', token, alerts: true, notify: { mode: 'off' } });
        assert.deepEqual(await both.json(), { ok: true, notify: OFF, contacts: true });

        s.watchers.personal.hasContacts = false;
        const without = await register(s, { account: 'personal', token, alerts: false, notify: { mode: 'important' } });
        assert.deepEqual(await without.json(),
            { ok: true, notify: { mode: 'important', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true }, contacts: false });
    } finally {
        await s.close();
    }
});

// The server listens before its watchers have read their sessions. A device
// told false then would warn about contacts until it next registered.
test('before the watcher has read the session the reply says contacts are unknown; after, it says what the session said', async () => {
    const s = await running();
    const important = { mode: 'important', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true };
    try {
        s.watchers.personal.sessionRead = false;
        s.watchers.personal.hasContacts = false;
        const early = await register(s, { account: 'personal', token, notify: { mode: 'important' } });
        assert.equal(early.status, 200);
        assert.deepEqual(await early.json(), { ok: true, notify: important, contacts: null });
        // Stored all the same: only the reply waits on the session
        assert.deepEqual(s.registered, [['personal', token, { notify: important }]]);

        s.watchers.personal.sessionRead = true;
        const without = await register(s, { account: 'personal', token, notify: { mode: 'important' } });
        assert.deepEqual(await without.json(), { ok: true, notify: important, contacts: false });

        s.watchers.personal.hasContacts = true;
        const withAccess = await register(s, { account: 'personal', token, notify: { mode: 'important' } });
        assert.deepEqual(await withAccess.json(), { ok: true, notify: important, contacts: true });
    } finally {
        await s.close();
    }
});

test('Fastmail notices reach the watcher only with the right secret', async () => {
    const s = await running();
    const notice = { '@type': 'StateChange', changed: { acc1: { Email: 's1' } } };
    const post = (path) => fetch(`${s.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notice) });

    assert.equal((await post('/jmap/personal/wrong')).status, 204);
    assert.equal((await post('/jmap/work/abc123')).status, 204);
    assert.equal(s.received.length, 0);
    assert.equal((await post('/jmap/personal/abc123')).status, 200);
    assert.deepEqual(s.received, [notice]);
    await s.close();
});

test('an encrypted callback is unsealed by its watcher; one that will not open is dropped quietly', async () => {
    const s = await running();
    const post = (body, headers = {}) => fetch(`${s.base}/jmap/personal/abc123`, { method: 'POST', headers, body });
    try {
        assert.equal((await post('sealed', { 'content-encoding': 'aes128gcm' })).status, 200);
        assert.deepEqual(s.received, [sealedNotice]);
        assert.equal((await post('junk', { 'content-encoding': 'aes128gcm' })).status, 204);
        assert.equal((await post('sealed', { 'content-encoding': 'AES128GCM' })).status, 200);
        assert.equal(s.received.length, 2);
        // Without the encoding header a body is JSON: this one is not, so nothing is read
        assert.equal((await post('sealed')).status, 204);
        assert.equal(s.received.length, 2);
    } finally {
        await s.close();
    }
});

test('anything else is not found, and a broken body is a bad request', async () => {
    const s = await running();
    assert.equal((await fetch(`${s.base}/nope`)).status, 404);
    assert.equal((await fetch(`${s.base}/devices`)).status, 404);
    const broken = await fetch(`${s.base}/devices`, { method: 'POST', headers: { authorization: 'Bearer s3cret' }, body: '{ not json' });
    assert.equal(broken.status, 400);
    await s.close();
});


// The buttons on a notification come back here: the phone has no Fastmail
// credentials of its own, and the few seconds a background action gets are
// enough for one request but not for a whole session.
test('a notification action is carried out, and anything it cannot vouch for is refused', async () => {
    const s = await running();
    const post = (headers, body) => fetch(`${s.base}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });
    const good = { authorization: 'Bearer s3cret' };

    assert.equal((await post({}, { account: 'personal', action: 'archive', emailId: 'M1' })).status, 401);
    assert.equal((await post({ authorization: 'Bearer wrong' }, { account: 'personal', action: 'archive', emailId: 'M1' })).status, 401);
    assert.equal((await post(good, { account: 'work', action: 'archive', emailId: 'M1' })).status, 400);
    assert.equal((await post(good, { account: '__proto__', action: 'archive', emailId: 'M1' })).status, 400);
    // A verb is one of the three buttons or it is nothing: the name is not a
    // way to reach whatever method happens to be on the watcher
    assert.equal((await post(good, { account: 'personal', action: 'delete', emailId: 'M1' })).status, 400);
    assert.equal((await post(good, { account: 'personal', action: 'receive', emailId: 'M1' })).status, 400);
    assert.equal((await post(good, { account: 'personal', action: 'archive' })).status, 400);
    assert.equal((await post(good, { account: 'personal', action: 'archive', emailId: '' })).status, 400);
    assert.deepEqual(s.done, []);

    const ok = await post(good, { account: 'personal', action: 'archive', emailId: 'M1' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });

    // Each button reaches its own verb, and no other
    assert.equal((await post(good, { account: 'personal', action: 'later', emailId: 'M2' })).status, 200);
    assert.equal((await post(good, { account: 'personal', action: 'pin', emailId: 'M3' })).status, 200);
    assert.deepEqual(s.done, [['archive', 'M1'], ['later', 'M2'], ['pin', 'M3']]);

    // A message the account cannot archive is a failure the phone is told
    // about, so it can say so rather than leave you thinking it worked
    assert.equal((await post(good, { account: 'personal', action: 'archive', emailId: 'M-missing' })).status, 500);

    await s.close();
});

test('a device that cleared its own banners is taken off what is showing; a bad one is refused', async () => {
    const s = await running();
    try {
        const post = (body, secret = 's3cret') => fetch(`${s.base}/cleared`, {
            method: 'POST',
            headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        const ok = await post({ account: 'personal', token });
        assert.equal(ok.status, 200);
        assert.deepEqual(await ok.json(), { ok: true });
        assert.deepEqual(s.cleared, [token]);

        assert.equal((await post({ account: 'personal', token }, 'wrong')).status, 401);
        assert.equal((await post({ account: 'nobody', token })).status, 400);
        assert.equal((await post({ account: 'personal', token: 'nonsense' })).status, 400);
        assert.deepEqual(s.cleared, [token]);
    } finally {
        await s.close();
    }
});
