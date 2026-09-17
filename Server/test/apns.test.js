import { test } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import { generateKeyPairSync, verify } from 'node:crypto';
import { APNsClient, mintToken, deviceOutcome, tokenOutcome, HOSTS } from '../src/apns.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const silent = { warn() {}, info() {}, error() {} };

test('the provider token is an ES256 JWT naming the key and the team', () => {
    const token = mintToken({ key: privateKey, keyId: 'KEY1234567', teamId: 'ABCDE12345', now: 1_800_000_000_000 });
    const [header, claims, signature] = token.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
    assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: 'ABCDE12345', iat: 1_800_000_000 });
    const valid = verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
    );
    assert.equal(valid, true);
});

test('a token is reused within its lifetime and minted afresh after it', () => {
    const client = new APNsClient({ key: pem, keyId: 'K', teamId: 'T', host: 'http://localhost:1', log: silent });
    const first = client.bearer(1_000_000);
    assert.equal(client.bearer(1_000_000 + 49 * 60 * 1000), first);
    assert.notEqual(client.bearer(1_000_000 + 51 * 60 * 1000), first);
});

test('sandbox and production pick their hosts', () => {
    assert.equal(new APNsClient({ key: pem, keyId: 'K', teamId: 'T', log: silent }).host, HOSTS.sandbox);
    assert.equal(new APNsClient({ key: pem, keyId: 'K', teamId: 'T', sandbox: false, log: silent }).host, HOSTS.production);
});

test('dead device tokens are removed, everything else kept', () => {
    assert.equal(deviceOutcome(410, 'Unregistered'), 'remove');
    assert.equal(deviceOutcome(400, 'BadDeviceToken'), 'remove');
    assert.equal(deviceOutcome(400, 'DeviceTokenNotForTopic'), 'remove');
    assert.equal(deviceOutcome(400, 'BadMessageId'), 'keep');
    assert.equal(deviceOutcome(200, null), 'keep');
    assert.equal(deviceOutcome(500, 'InternalServerError'), 'keep');
});

test('only a rejected provider token asks for a new one', () => {
    assert.equal(tokenOutcome(403, 'ExpiredProviderToken'), 'remint');
    assert.equal(tokenOutcome(403, 'InvalidProviderToken'), 'remint');
    assert.equal(tokenOutcome(403, 'MissingProviderToken'), 'keep');
    assert.equal(tokenOutcome(400, 'BadDeviceToken'), 'keep');
});

// A stand-in APNs: answers as told, in order, and records what it saw.
async function fakeAPNs(answers) {
    const seen = [];
    const server = http2.createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
            seen.push({
                path: request.headers[':path'],
                authorization: request.headers.authorization,
                topic: request.headers['apns-topic'],
                pushType: request.headers['apns-push-type'],
                priority: request.headers['apns-priority'],
                collapseId: request.headers['apns-collapse-id'],
                body: JSON.parse(body),
            });
            const answer = answers.shift() || { status: 200 };
            response.writeHead(answer.status, { 'content-type': 'application/json' });
            response.end(answer.reason ? JSON.stringify({ reason: answer.reason }) : '');
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        seen,
        host: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

test('send posts the payload with topic and collapse id and reports the answer', async () => {
    const apns = await fakeAPNs([{ status: 400, reason: 'BadDeviceToken' }]);
    const client = new APNsClient({ key: pem, keyId: 'K', teamId: 'T', host: apns.host, log: silent });
    const result = await client.send('abc123', { aps: { badge: 2 } }, { topic: 'com.example.app', collapseId: 'M1' });
    assert.deepEqual(result, { status: 400, reason: 'BadDeviceToken' });
    assert.equal(apns.seen[0].path, '/3/device/abc123');
    assert.equal(apns.seen[0].topic, 'com.example.app');
    assert.equal(apns.seen[0].pushType, 'alert');
    assert.equal(apns.seen[0].collapseId, 'M1');
    assert.deepEqual(apns.seen[0].body, { aps: { badge: 2 } });
    assert.match(apns.seen[0].authorization, /^bearer /);
    client.close();
    await apns.close();
});

test('a background push says so, at the priority Apple requires for one', async () => {
    const apns = await fakeAPNs([{ status: 200 }]);
    const client = new APNsClient({ key: pem, keyId: 'K', teamId: 'T', host: apns.host, log: silent });
    await client.send('abc123', { aps: { 'content-available': 1 }, dismiss: ['M1'] }, { topic: 'com.example.app', pushType: 'background' });
    assert.equal(apns.seen[0].pushType, 'background');
    assert.equal(apns.seen[0].priority, '5');
    assert.equal(apns.seen[0].collapseId, undefined);
    client.close();
    await apns.close();
});

// An APNs that takes the request and never answers it.
async function stalledAPNs() {
    const sessions = [];
    const server = http2.createServer();
    server.on('session', (session) => sessions.push(session));
    server.on('stream', () => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        host: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => {
            for (const session of sessions) session.destroy();
            server.close(resolve);
        }),
    };
}

test('a push APNs never answers gives up rather than hanging the account', async () => {
    const apns = await stalledAPNs();
    const client = new APNsClient({ key: pem, keyId: 'K', teamId: 'T', host: apns.host, requestTimeoutMs: 200, log: silent });
    await assert.rejects(
        client.send('abc123', { aps: { badge: 1 } }, { topic: 'com.example.app' }),
        /apns: timed out/,
    );
    client.close();
    await apns.close();
});

test('an expired provider token is minted again and the push retried once', async () => {
    const apns = await fakeAPNs([{ status: 403, reason: 'ExpiredProviderToken' }, { status: 200 }]);
    const client = new APNsClient({ key: pem, keyId: 'K', teamId: 'T', host: apns.host, log: silent });
    const result = await client.send('abc123', { aps: { badge: 1 } }, { topic: 'com.example.app' });
    assert.deepEqual(result, { status: 200, reason: null });
    assert.equal(apns.seen.length, 2);
    assert.notEqual(apns.seen[0].authorization, apns.seen[1].authorization);
    client.close();
    await apns.close();
});
