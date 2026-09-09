import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JMAPClient, JMAPError, eventSourceURL, EventStreamParser, runEventSource } from '../src/jmap.js';

const silent = { warn() {}, info() {}, error() {} };

const session = {
    apiUrl: 'https://api.example.net/jmap/api/',
    eventSourceUrl: 'https://api.example.net/jmap/event/',
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acc1' },
};

// A stand-in for fetch: answers by method name, records every call.
function fakeFetch(answer) {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url: String(url), headers: init.headers, body });
        if (String(url).endsWith('/session')) return { ok: true, status: 200, json: async () => session };
        const responses = body.methodCalls.map(([method, args, id]) => {
            const [name, result] = answer(method, args, calls);
            return [name, result, id];
        });
        return { ok: true, status: 200, json: async () => ({ methodResponses: responses }) };
    };
    return { fetch, calls };
}

async function connected(answer) {
    const { fetch, calls } = fakeFetch(answer);
    const client = new JMAPClient({ token: 'tok', fetch });
    await client.connect();
    return { client, calls };
}

test('the session names the mail account and the api', async () => {
    const { client, calls } = await connected(() => ['error', {}]);
    assert.equal(client.accountId, 'acc1');
    assert.equal(client.apiUrl, session.apiUrl);
    assert.equal(client.eventSourceUrl, session.eventSourceUrl);
    assert.equal(calls[0].headers.authorization, 'Bearer tok');
});

test('a refused session is an error with its status', async () => {
    const client = new JMAPClient({ token: 'bad', fetch: async () => ({ ok: false, status: 401 }) });
    await assert.rejects(client.connect(), (error) => error instanceof JMAPError && error.status === 401);
});

test('call unwraps one response and turns a JMAP error into a JMAPError with its type', async () => {
    const { client } = await connected((method) => method === 'Email/get'
        ? ['Email/get', { state: 's9', list: [] }]
        : ['error', { type: 'cannotCalculateChanges', description: 'too old' }]);
    assert.equal(await client.emailState(), 's9');
    await assert.rejects(client.emailChanges('s0'), (error) => error.type === 'cannotCalculateChanges' && /too old/.test(error.message));
});

test('emailChanges follows the log to its end', async () => {
    let page = 0;
    const { client, calls } = await connected((method, args) => {
        page += 1;
        return ['Email/changes', page === 1
            ? { created: ['M1'], updated: [], destroyed: [], newState: 's1', hasMoreChanges: true }
            : { created: ['M2'], updated: [], destroyed: [], newState: 's2', hasMoreChanges: false }];
    });
    assert.deepEqual(await client.emailChanges('s0'), { created: ['M1', 'M2'], newState: 's2' });
    assert.equal(calls.at(-2).body.methodCalls[0][1].sinceState, 's0');
    assert.equal(calls.at(-1).body.methodCalls[0][1].sinceState, 's1');
});

test('emails asks for exactly the properties the payload needs, and nothing for no ids', async () => {
    const { client, calls } = await connected((method, args) => ['Email/get', { list: args.ids.map((id) => ({ id })) }]);
    assert.deepEqual(await client.emails([]), []);
    assert.deepEqual(await client.emails(['M1']), [{ id: 'M1' }]);
    assert.deepEqual(calls.at(-1).body.methodCalls[0][1].properties, ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'subject', 'receivedAt']);
});

test('a backlog is fetched in helpings Fastmail will accept', async () => {
    const { client, calls } = await connected((method, args) => ['Email/get', { list: args.ids.map((id) => ({ id })) }]);
    const ids = Array.from({ length: 1200 }, (_, index) => `M${index}`);
    const list = await client.emails(ids);
    assert.deepEqual(list.map((email) => email.id), ids);
    assert.deepEqual(calls.slice(1).map((call) => call.body.methodCalls[0][1].ids.length), [500, 500, 200]);
});

test('the badge count is conversations, not messages', async () => {
    const { client, calls } = await connected((method, args) => ['Mailbox/get', {
        list: args.ids
            ? [{ id: 'triage', totalThreads: 7, totalEmails: 9 }]
            : [{ id: 'inbox', name: 'Inbox', role: 'inbox', totalThreads: 2 }],
    }]);
    assert.equal(await client.mailboxTotal('triage'), 7);
    assert.deepEqual(calls.at(-1).body.methodCalls[0][1].properties, ['totalThreads']);

    assert.deepEqual(await client.mailboxes(), [{ id: 'inbox', name: 'Inbox', role: 'inbox', totalThreads: 2 }]);
    // Every property, named none: the buttons need Fastmail's own `hidden`
    // flag to tell a label you file under from a history shelf you never
    // touch, and naming an extension property in the list is invalidArguments
    assert.equal(calls.at(-1).body.methodCalls[0][1].properties, undefined);
});

test('a call that never comes back gives up rather than holding the account', async () => {
    const client = new JMAPClient({
        token: 'tok',
        timeoutMs: 50,
        fetch: (_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        }),
    });
    await assert.rejects(client.connect(), (error) => error instanceof JMAPError && /session: timed out/.test(error.message));
});

test('a push subscription is created without an account id, verified, or refused with the reason', async () => {
    const { client, calls } = await connected((method, args) => {
        if (args.update) {
            return args.update.ps1.verificationCode === 'code'
                ? ['PushSubscription/set', { updated: { ps1: null } }]
                : ['PushSubscription/set', { notUpdated: { ps1: { type: 'invalidProperties', description: 'wrong code' } } }];
        }
        if (args.create?.sub.url === 'https://x/y') {
            return ['PushSubscription/set', { created: { sub: { id: 'ps1', expires: '2026-09-08T00:00:00Z' } } }];
        }
        return ['PushSubscription/set', { notCreated: { sub: { type: 'forbidden', description: 'no push for tokens' } } }];
    });
    const keys = { p256dh: 'BCVx', auth: 'BTBZ' };
    const created = await client.createPushSubscription({ deviceClientId: 'd', url: 'https://x/y', types: ['Email'], expires: '2026-09-14T00:00:00Z', keys });
    assert.deepEqual(created, { id: 'ps1', expires: '2026-09-08T00:00:00Z' });
    assert.deepEqual(calls.at(-1).body.using, ['urn:ietf:params:jmap:core']);
    assert.equal('accountId' in calls.at(-1).body.methodCalls[0][1], false);
    // Fastmail insists on the Web Push keys: without them the create is refused
    assert.deepEqual(calls.at(-1).body.methodCalls[0][1].create.sub, {
        deviceClientId: 'd', url: 'https://x/y', types: ['Email'], expires: '2026-09-14T00:00:00Z', keys,
    });

    await client.verifyPushSubscription('ps1', 'code');
    assert.deepEqual(calls.at(-1).body.methodCalls[0][1], { update: { ps1: { verificationCode: 'code' } } });
    await assert.rejects(client.verifyPushSubscription('ps1', 'stale'), /invalidProperties; wrong code/);

    await assert.rejects(
        client.createPushSubscription({ deviceClientId: 'd', url: 'https://x/z', types: ['Email'], expires: null }),
        /forbidden.*no push for tokens/,
    );
    assert.equal('keys' in calls.at(-1).body.methodCalls[0][1].create.sub, false);
});

test('the event source url takes the three parameters either way', () => {
    assert.equal(
        eventSourceURL('https://api.example.net/jmap/event/{types}/{closeafter}/{ping}', { types: ['Email', 'Mailbox'] }),
        'https://api.example.net/jmap/event/Email%2CMailbox/no/300',
    );
    assert.equal(
        eventSourceURL('https://api.example.net/jmap/event/', { types: ['Email'], ping: 60 }),
        'https://api.example.net/jmap/event/?types=Email&closeafter=no&ping=60',
    );
});

test('the stream parser handles split chunks, CRLF, comments and multi-line data', () => {
    const parser = new EventStreamParser();
    assert.deepEqual(parser.feed('event: state\r\ndata: {"a":'), []);
    assert.deepEqual(parser.feed('1}\r\n\r\n: ping\n\ndata: x\ndata: y\n\n'), [
        { event: 'state', data: '{"a":1}' },
        { event: 'message', data: 'x\ny' },
    ]);
});

test('a trailing bare CR waits for the next chunk, whatever precedes it', () => {
    const split = new EventStreamParser();
    assert.deepEqual(split.feed('data: hello\r'), []);
    assert.deepEqual(split.feed('\ndata: world\r\n\r\n'), [{ event: 'message', data: 'hello\nworld' }]);

    const multi = new EventStreamParser();
    assert.deepEqual(multi.feed('data: line1\ndata: line2\r'), []);
    assert.deepEqual(multi.feed('\ndata: line3\r\n\r\n'), [{ event: 'message', data: 'line1\nline2\nline3' }]);

    const lone = new EventStreamParser();
    assert.deepEqual(lone.feed('data: a\r'), []);
    assert.deepEqual(lone.feed('data: b\r\rdata: c\r'), [{ event: 'message', data: 'a\nb' }]);
    assert.deepEqual(lone.feed('\r'), [{ event: 'message', data: 'c' }]);
});

test('runEventSource hands every state event over and stops when aborted', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('event: state\ndata: {"@type":"StateChange","changed":{"acc1":{"Email":"s1"}}}\n\n'));
            controller.close();
        },
    });
    const received = [];
    const abort = new AbortController();
    let requests = 0;
    await runEventSource({
        url: 'https://api.example.net/jmap/event/?types=Email',
        headers: { authorization: 'Bearer tok' },
        onStateChange: (change) => { received.push(change); abort.abort(); },
        signal: abort.signal,
        fetch: async () => { requests += 1; return { ok: true, status: 200, body }; },
        log: silent,
    });
    assert.equal(requests, 1);
    assert.deepEqual(received, [{ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } }]);
});

test('a stream that has gone quiet is dropped so the loop can reconnect', async () => {
    const abort = new AbortController();
    const warned = [];
    let requests = 0;
    await runEventSource({
        url: 'https://api.example.net/jmap/event/?types=Email',
        headers: {},
        onStateChange: () => {},
        signal: abort.signal,
        // The watchdog waits two pings; 10ms of ping makes that 20ms here
        ping: 0.01,
        fetch: async (_url, init) => {
            requests += 1;
            const body = new ReadableStream({
                start(controller) {
                    init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
                },
            });
            return { ok: true, status: 200, body };
        },
        log: { ...silent, warn: (message) => { warned.push(message); abort.abort(); } },
    });
    assert.equal(requests, 1);
    assert.match(warned[0], /nothing for 0.02s/);
});
