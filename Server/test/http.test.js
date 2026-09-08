import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'c'.repeat(64);
const sealedNotice = { '@type': 'StateChange', changed: { acc1: { Email: 's7' } } };

async function running() {
    const received = [];
    const registered = [];
    const watchers = {
        personal: {
            callbackSecret: 'abc123',
            status: () => ({ notices: 'push', verified: true, lastNotice: null, devices: 1 }),
            receive: async (body) => { received.push(body); },
            // The real one unseals RFC 8291; here "sealed" is the only body that opens
            unseal: (raw) => (raw.equals(Buffer.from('sealed')) ? sealedNotice : null),
        },
    };
    const archived = [];
    watchers.personal.archive = async (emailId) => {
        if (emailId === 'M-missing') throw new Error('no such message');
        archived.push(emailId);
    };
    const devices = { register: async (account, value, options) => { registered.push([account, value, options]); } };
    const server = createServer({ config: { deviceSecret: 's3cret' }, watchers, devices, log: silent });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, received, registered, archived, close: () => new Promise((resolve) => server.close(resolve)) };
}

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
    assert.deepEqual(await ok.json(), { ok: true, alerts: true });
    assert.deepEqual(s.registered, [['personal', token, { alerts: true }]]);
    await s.close();
});

test('a registration can turn alerts off for that device, and only with a real boolean', async () => {
    const s = await running();
    const post = (body) => fetch(`${s.base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer s3cret' }, body: JSON.stringify(body) });
    try {
        assert.equal((await post({ account: 'personal', token, alerts: 'no' })).status, 400);
        assert.equal((await post({ account: 'personal', token, alerts: 0 })).status, 400);
        assert.equal((await post({ account: 'personal', token, alerts: null })).status, 400);
        assert.equal(s.registered.length, 0);
        const off = await post({ account: 'personal', token, alerts: false });
        assert.equal(off.status, 200);
        assert.deepEqual(await off.json(), { ok: true, alerts: false });
        assert.deepEqual(s.registered, [['personal', token, { alerts: false }]]);
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


// The Archive button on a notification comes back here: the phone has no
// Fastmail credentials of its own, and the few seconds a background action
// gets are enough for one request but not for a whole session.
test('a notification action archives, and refuses anything it cannot vouch for', async () => {
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
    assert.equal((await post(good, { account: 'personal', action: 'delete', emailId: 'M1' })).status, 400);
    assert.equal((await post(good, { account: 'personal', action: 'archive' })).status, 400);
    assert.equal((await post(good, { account: 'personal', action: 'archive', emailId: '' })).status, 400);
    assert.deepEqual(s.archived, []);

    const ok = await post(good, { account: 'personal', action: 'archive', emailId: 'M1' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    assert.deepEqual(s.archived, ['M1']);

    // A message the account cannot archive is a failure the phone is told
    // about, so it can say so rather than leave you thinking it worked
    assert.equal((await post(good, { account: 'personal', action: 'archive', emailId: 'M-missing' })).status, 500);

    await s.close();
});
