// Fastmail's JMAP, the little of it this needs: the session, method calls,
// the change log, push subscriptions, and the event source stream.

export const SESSION_URL = 'https://api.fastmail.com/jmap/session';
export const CORE = 'urn:ietf:params:jmap:core';
export const MAIL = 'urn:ietf:params:jmap:mail';
export const EMAIL_PROPERTIES = ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'subject', 'receivedAt'];

export class JMAPError extends Error {
    constructor(message, { status = 0, type = null } = {}) {
        super(message);
        this.name = 'JMAPError';
        this.status = status;
        this.type = type;
    }
}

export class JMAPClient {
    constructor({ token, fetch: fetchImpl = globalThis.fetch, sessionUrl = SESSION_URL }) {
        this.token = token;
        this.fetch = fetchImpl;
        this.sessionUrl = sessionUrl;
        this.session = null;
        this.accountId = null;
    }

    headers() {
        return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json' };
    }

    get apiUrl() { return this.session?.apiUrl; }
    get eventSourceUrl() { return this.session?.eventSourceUrl; }

    async connect() {
        const response = await this.fetch(this.sessionUrl, { headers: this.headers() });
        if (!response.ok) throw new JMAPError(`session: HTTP ${response.status}`, { status: response.status });
        this.session = await response.json();
        this.accountId = this.session.primaryAccounts?.[MAIL] ?? null;
        if (!this.accountId) throw new JMAPError('session: no mail account');
        return this.session;
    }

    async request(methodCalls, using = [CORE, MAIL]) {
        const response = await this.fetch(this.apiUrl, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ using, methodCalls }),
        });
        if (!response.ok) throw new JMAPError(`api: HTTP ${response.status}`, { status: response.status });
        return (await response.json()).methodResponses;
    }

    // One method call, unwrapped: its arguments back, or a JMAPError
    // carrying the error type for the caller to recognise.
    async call(method, args, using) {
        const [[name, result]] = await this.request([[method, args, 'c0']], using);
        if (name === 'error') {
            const detail = result.description ? ` — ${result.description}` : '';
            throw new JMAPError(`${method}: ${result.type}${detail}`, { type: result.type });
        }
        return result;
    }

    async mailboxes() {
        const result = await this.call('Mailbox/get', {
            accountId: this.accountId, ids: null, properties: ['id', 'name', 'role', 'totalEmails'],
        });
        return result.list;
    }

    async mailboxTotal(id) {
        const result = await this.call('Mailbox/get', { accountId: this.accountId, ids: [id], properties: ['totalEmails'] });
        return result.list[0]?.totalEmails ?? null;
    }

    async emailState() {
        return (await this.call('Email/get', { accountId: this.accountId, ids: [] })).state;
    }

    // Every id created since `sinceState`, following the log to its end.
    async emailChanges(sinceState) {
        const created = [];
        let state = sinceState;
        for (;;) {
            const result = await this.call('Email/changes', { accountId: this.accountId, sinceState: state, maxChanges: 500 });
            created.push(...result.created);
            state = result.newState;
            if (!result.hasMoreChanges) break;
        }
        return { created, newState: state };
    }

    async emails(ids) {
        if (!ids.length) return [];
        const result = await this.call('Email/get', { accountId: this.accountId, ids, properties: EMAIL_PROPERTIES });
        return result.list;
    }

    async pushSubscriptions() {
        return (await this.call('PushSubscription/get', { ids: null }, [CORE])).list;
    }

    async createPushSubscription({ deviceClientId, url, types, expires }) {
        const result = await this.call('PushSubscription/set', {
            create: { sub: { deviceClientId, url, types, expires } },
        }, [CORE]);
        const created = result.created?.sub;
        if (created) return { id: created.id, expires: created.expires ?? expires };
        const problem = result.notCreated?.sub;
        const detail = problem?.description ? ` — ${problem.description}` : '';
        throw new JMAPError(`PushSubscription/set: ${problem?.type ?? 'not created'}${detail}`, { type: problem?.type ?? null });
    }

    async verifyPushSubscription(id, verificationCode) {
        const result = await this.call('PushSubscription/set', { update: { [id]: { verificationCode } } }, [CORE]);
        const problem = result.notUpdated?.[id];
        if (problem) throw new JMAPError(`PushSubscription/set: ${problem.type}`, { type: problem.type });
    }

    async destroyPushSubscription(id) {
        await this.call('PushSubscription/set', { destroy: [id] }, [CORE]);
    }
}

// The event source URL is a template in RFC 8620's terms. Fastmail's has no
// variables in it and takes the same three as query parameters instead.
export function eventSourceURL(template, { types, closeafter = 'no', ping = 300 }) {
    const values = { types: types.join(','), closeafter, ping: String(ping) };
    if (/\{(types|closeafter|ping)\}/.test(template)) {
        return template.replace(/\{(types|closeafter|ping)\}/g, (_, name) => encodeURIComponent(values[name]));
    }
    const url = new URL(template);
    for (const [name, value] of Object.entries(values)) url.searchParams.set(name, value);
    return url.toString();
}

// text/event-stream, fed as it arrives; returns the events each feed
// completes. Fastmail's pings are comment lines and fall through.
export class EventStreamParser {
    constructor() {
        this.buffer = '';
        this.event = null;
        this.data = [];
    }

    feed(text) {
        this.buffer += text;
        const events = [];
        let newline;
        while ((newline = this.buffer.search(/\r\n|\n|\r/)) !== -1) {
            const line = this.buffer.slice(0, newline);
            // A bare CR at the very end may be the first half of a CRLF: wait for what follows (but not for empty lines)
            if (this.buffer[newline] === '\r' && newline === this.buffer.length - 1 && line !== '') break;
            const width = this.buffer[newline] === '\r' && this.buffer[newline + 1] === '\n' ? 2 : 1;
            this.buffer = this.buffer.slice(newline + width);
            if (line === '') {
                if (this.data.length) events.push({ event: this.event ?? 'message', data: this.data.join('\n') });
                this.event = null;
                this.data = [];
            } else if (!line.startsWith(':')) {
                const colon = line.indexOf(':');
                const field = colon === -1 ? line : line.slice(0, colon);
                let value = colon === -1 ? '' : line.slice(colon + 1);
                if (value.startsWith(' ')) value = value.slice(1);
                if (field === 'event') this.event = value;
                else if (field === 'data') this.data.push(value);
            }
        }
        return events;
    }
}

const delay = (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

// Keeps one event source connection open until `signal` aborts, handing
// every StateChange to `onStateChange`, reconnecting with backoff.
export async function runEventSource({ url, headers, onStateChange, signal, fetch: fetchImpl = globalThis.fetch, log = console }) {
    let backoff = 1000;
    while (!signal.aborted) {
        try {
            const response = await fetchImpl(url, { headers: { ...headers, accept: 'text/event-stream' }, signal });
            if (!response.ok) throw new JMAPError(`event source: HTTP ${response.status}`, { status: response.status });
            backoff = 1000;
            const parser = new EventStreamParser();
            const decoder = new TextDecoder();
            for await (const chunk of response.body) {
                for (const event of parser.feed(decoder.decode(chunk, { stream: true }))) {
                    if (event.event !== 'state') continue;
                    try {
                        await onStateChange(JSON.parse(event.data));
                    } catch (error) {
                        log.warn(`event source: ${error.message}`);
                    }
                }
            }
            if (!signal.aborted) log.warn('event source: stream ended; reconnecting');
        } catch (error) {
            if (signal.aborted) return;
            log.warn(`event source: ${error.message}; retrying in ${backoff / 1000}s`);
            await delay(backoff, signal);
            backoff = Math.min(backoff * 2, 5 * 60 * 1000);
        }
    }
}
