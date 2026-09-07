import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'c'.repeat(64);

async function running() {
    const received = [];
    const registered = [];
    const watchers = {
        personal: {
            callbackSecret: 'abc123',
            status: () => ({ notices: 'push', verified: true, lastNotice: null, devices: 1 }),
            receive: async (body) => { received.push(body); },
        },
    };
    const devices = { register: async (account, value) => { registered.push([account, value]); } };
    const server = createServer({ config: { deviceSecret: 's3cret' }, watchers, devices, log: silent });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, received, registered, close: () => new Promise((resolve) => server.close(resolve)) };
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
    assert.deepEqual(s.registered, [['personal', token]]);
    await s.close();
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

test('anything else is not found, and a broken body is a bad request', async () => {
    const s = await running();
    assert.equal((await fetch(`${s.base}/nope`)).status, 404);
    assert.equal((await fetch(`${s.base}/devices`)).status, 404);
    const broken = await fetch(`${s.base}/devices`, { method: 'POST', headers: { authorization: 'Bearer s3cret' }, body: '{ not json' });
    assert.equal(broken.status, 400);
    await s.close();
});
