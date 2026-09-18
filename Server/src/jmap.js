// Fastmail's JMAP, the little of it this needs: the session, method calls,
// the change log, push subscriptions, and the event source stream.

export const SESSION_URL = 'https://api.fastmail.com/jmap/session';
export const CORE = 'urn:ietf:params:jmap:core';
export const MAIL = 'urn:ietf:params:jmap:mail';
export const CONTACTS = 'urn:ietf:params:jmap:contacts';
export const EMAIL_PROPERTIES = ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'subject', 'preview', 'receivedAt'];
export const CONTACT_CARD_PROPERTIES = ['id', 'uid', 'kind', 'members', 'emails'];
// Fastmail's `maxObjectsInGet` is 500; asking for more fails the whole call.
export const GET_CHUNK = 500;
export const TIMEOUT_MS = 30_000;

export class JMAPError extends Error {
    constructor(message, { status = 0, type = null } = {}) {
        super(message);
        this.name = 'JMAPError';
        this.status = status;
        this.type = type;
    }
}

export class JMAPClient {
    constructor({ token, fetch: fetchImpl = globalThis.fetch, sessionUrl = SESSION_URL, timeoutMs = TIMEOUT_MS }) {
        this.token = token;
        this.fetch = fetchImpl;
        this.sessionUrl = sessionUrl;
        this.timeoutMs = timeoutMs;
        this.session = null;
        this.accountId = null;
        this.contactsAccountIds = [];
    }

    headers() {
        return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json' };
    }

    get apiUrl() { return this.session?.apiUrl; }
    get eventSourceUrl() { return this.session?.eventSourceUrl; }
    // The first of contactsAccountIds (the primary one, when granted), so
    // existing callers that know of only one contacts account keep working.
    get contactsAccountId() { return this.contactsAccountIds[0] ?? null; }

    // Every call is bounded. Looks at the change log never overlap, so one
    // socket left hanging would hold up every notice after it.
    async timed(what, url, init) {
        try {
            return await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
        } catch (error) {
            if (error?.name === 'TimeoutError') throw new JMAPError(`${what}: timed out`);
            throw error;
        }
    }

    async connect() {
        const response = await this.timed('session', this.sessionUrl, { headers: this.headers() });
        if (!response.ok) throw new JMAPError(`session: HTTP ${response.status}`, { status: response.status });
        this.session = await response.json();
        this.accountId = this.session.primaryAccounts?.[MAIL] ?? null;
        if (!this.accountId) throw new JMAPError('session: no mail account');
        // Contacts only when the token grants them: the capability in the
        // session, and then every account that holds it, not only the
        // primary one, because a token often also reads a shared address
        // book that carries no mail of its own. The primary contacts
        // account, if among them, leads the list.
        const granted = this.session.capabilities?.[CONTACTS]
            ? Object.entries(this.session.accounts ?? {})
                .filter(([, account]) => Boolean(account?.accountCapabilities?.[CONTACTS]))
                .map(([id]) => id)
            : [];
        const primary = this.session.primaryAccounts?.[CONTACTS] ?? null;
        this.contactsAccountIds = granted.includes(primary) ? [primary, ...granted.filter((id) => id !== primary)] : granted;
        return this.session;
    }

    async request(methodCalls, using = [CORE, MAIL]) {
        const response = await this.timed('api', this.apiUrl, {
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
            const detail = result.description ? `; ${result.description}` : '';
            throw new JMAPError(`${method}: ${result.type}${detail}`, { type: result.type });
        }
        return result;
    }

    async mailboxes() {
        // Every property rather than a named few. The buttons on a
        // notification need `hidden`, Fastmail's own flag whose bit 1 is "not
        // in the folder list"; 0 on the labels you file under, 1 on the
        // history shelves, and it is an extension property: it comes back with
        // everything else, but naming it in `properties` is refused as
        // invalidArguments.
        const result = await this.call('Mailbox/get', { accountId: this.accountId, ids: null });
        return result.list;
    }

    // Conversations, not messages: the badge the page sets is the label's
    // thread count, and the two must agree or the badge jumps.
    async mailboxTotal(id) {
        const result = await this.call('Mailbox/get', { accountId: this.accountId, ids: [id], properties: ['totalThreads'] });
        return result.list[0]?.totalThreads ?? null;
    }

    async emailState() {
        return (await this.call('Email/get', { accountId: this.accountId, ids: [] })).state;
    }

    // Every id created, updated and destroyed since `sinceState`, following
    // the log to its end.
    async emailChanges(sinceState) {
        const created = [];
        const updated = [];
        const destroyed = [];
        let state = sinceState;
        for (;;) {
            const result = await this.call('Email/changes', { accountId: this.accountId, sinceState: state, maxChanges: 500 });
            created.push(...result.created);
            updated.push(...(result.updated ?? []));
            destroyed.push(...(result.destroyed ?? []));
            state = result.newState;
            if (!result.hasMoreChanges) break;
        }
        return { created, updated, destroyed, newState: state };
    }

    // A /get for any number of ids, in helpings Fastmail will accept, as one list.
    async getInChunks(method, ids, args, using) {
        const list = [];
        for (let from = 0; from < ids.length; from += GET_CHUNK) {
            const result = await this.call(method, { ...args, ids: ids.slice(from, from + GET_CHUNK) }, using);
            list.push(...result.list);
        }
        return list;
    }

    async emails(ids) {
        return this.getInChunks('Email/get', ids, { accountId: this.accountId, properties: EMAIL_PROPERTIES });
    }

    // Each thread with the ids of its messages: `{ id, emailIds }`.
    async threads(ids) {
        return this.getInChunks('Thread/get', ids, { accountId: this.accountId });
    }

    // Only the keywords of each message: `{ id, keywords }`.
    async keywords(ids) {
        return this.getInChunks('Email/get', ids, { accountId: this.accountId, properties: ['keywords'] });
    }

    // Every contact card of one contacts account (the primary one, unless
    // told otherwise), and the ContactCard state read before them: a change
    // made while they are read then shows up as a newer state, and they are
    // read again.
    async contactCards(accountId = this.contactsAccountIds[0]) {
        if (!this.contactsAccountIds.includes(accountId)) throw new JMAPError('ContactCard: this token cannot read contacts');
        const using = [CORE, CONTACTS];
        const { state } = await this.call('ContactCard/get', { accountId, ids: [] }, using);
        const ids = [];
        for (;;) {
            const page = await this.call('ContactCard/query', { accountId, position: ids.length, limit: GET_CHUNK, calculateTotal: true }, using);
            ids.push(...page.ids);
            if (page.ids.length === 0 || (Number.isInteger(page.total) && ids.length >= page.total)) break;
        }
        const cards = await this.getInChunks('ContactCard/get', ids, { accountId, properties: CONTACT_CARD_PROPERTIES }, using);
        return { cards, state };
    }

    // The one write this makes. A patch rather than whole maps of mailboxes
    // and keywords, so anything the server has no opinion about, a label a
    // rule put on, a keyword another client keeps; is left exactly as it was.
    async patchEmail(id, patch) {
        const result = await this.call('Email/set', { accountId: this.accountId, update: { [id]: patch } });
        const problem = result.notUpdated?.[id];
        if (problem) {
            const detail = problem.description ? `; ${problem.description}` : '';
            throw new JMAPError(`Email/set: ${problem.type}${detail}`, { type: problem.type });
        }
        return id;
    }

    async pushSubscriptions() {
        return (await this.call('PushSubscription/get', { ids: null }, [CORE])).list;
    }

    async createPushSubscription({ deviceClientId, url, types, expires, keys }) {
        // Fastmail refuses a subscription without Web Push keys (RFC 8291)
        const result = await this.call('PushSubscription/set', {
            create: { sub: { deviceClientId, url, types, expires, ...(keys ? { keys } : {}) } },
        }, [CORE]);
        const created = result.created?.sub;
        if (created) return { id: created.id, expires: created.expires ?? expires };
        const problem = result.notCreated?.sub;
        const detail = problem?.description ? `; ${problem.description}` : '';
        throw new JMAPError(`PushSubscription/set: ${problem?.type ?? 'not created'}${detail}`, { type: problem?.type ?? null });
    }

    async verifyPushSubscription(id, verificationCode) {
        const result = await this.call('PushSubscription/set', { update: { [id]: { verificationCode } } }, [CORE]);
        const problem = result.notUpdated?.[id];
        if (!problem) return;
        const detail = problem.description ? `; ${problem.description}` : '';
        throw new JMAPError(`PushSubscription/set: ${problem.type}${detail}`, { type: problem.type });
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
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

// Keeps one event source connection open until `signal` aborts, handing every
// StateChange to `onStateChange`, reconnecting with backoff.
export async function runEventSource({ url, headers, onStateChange, signal, fetch: fetchImpl = globalThis.fetch, log = console, ping = 300 }) {
    const idleMs = 2 * ping * 1000;
    let backoff = 1000;
    while (!signal.aborted) {
        const attempt = new AbortController();
        const relay = () => attempt.abort();
        signal.addEventListener('abort', relay, { once: true });
        let watchdog = null;
        const wind = () => {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => attempt.abort(new Error(`nothing for ${idleMs / 1000}s; reconnecting`)), idleMs);
        };
        try {
            const response = await fetchImpl(url, { headers: { ...headers, accept: 'text/event-stream' }, signal: attempt.signal });
            if (!response.ok) throw new JMAPError(`event source: HTTP ${response.status}`, { status: response.status });
            backoff = 1000;
            const parser = new EventStreamParser();
            const decoder = new TextDecoder();
            wind();
            for await (const chunk of response.body) {
                wind();
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
        } finally {
            clearTimeout(watchdog);
            signal.removeEventListener('abort', relay);
        }
    }
}
