import { randomBytes } from 'node:crypto';
import { alertPayload, badgePayload, selectNotifiable } from './notify.js';
import { rememberNotified, saveState } from './state.js';
import { deviceOutcome } from './apns.js';
import { eventSourceURL, runEventSource } from './jmap.js';

export const COALESCE_MS = 2000;
export const POLL_MS = 5 * 60 * 1000;
export const RETRY_MS = 10 * 60 * 1000;
export const SUBSCRIPTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// More created ids than this since the last look means the server was away
// long enough that announcing them all would be noise, not news.
export const BACKLOG_CAP = 500;
const TYPES = ['Email', 'Mailbox'];

const realTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

// One account, from first session to every push: learns the mailboxes,
// subscribes to Fastmail's change notices, and turns each into the alerts
// and badge updates its devices should see.
export class AccountWatcher {
    constructor({ account, config, jmap, apns, devices, state, log = console, timers = realTimers }) {
        this.account = account;
        this.config = config;
        this.jmap = jmap;
        this.apns = apns;
        this.devices = devices;
        this.state = state;
        this.log = log;
        this.timers = timers;
        this.inboxId = null;
        this.badgeMailboxId = null;
        this.notices = null;
        this.callbackSecret = null;
        this.pushSubscriptionId = null;
        this.pendingVerification = null;
        this.verified = false;
        this.lastNoticeAt = null;
        this.pending = null;
        this.chain = Promise.resolve();
        this.abort = new AbortController();
        this.pollTimer = null;
        this.renewTimer = null;
        this.startTimer = null;
    }

    get name() { return this.account.name; }
    get deviceClientId() { return `fastmail-push-${this.name}`; }

    // Connects, and keeps trying every RETRY_MS if Fastmail will not have us.
    async start() {
        try {
            await this.connect();
        } catch (error) {
            this.log.error(`[${this.name}] start failed: ${error.message}; retrying in ${RETRY_MS / 60000} minutes`);
            this.startTimer = this.timers.setTimeout(() => this.start(), RETRY_MS);
        }
    }

    async connect() {
        await this.jmap.connect();
        const mailboxes = await this.jmap.mailboxes();
        this.inboxId = mailboxes.find((m) => m.role === 'inbox')?.id ?? null;
        if (!this.inboxId) throw new Error('no Inbox in this account');
        // A label is a mailbox without a role; prefer that over a system folder of the same name
        this.badgeMailboxId = mailboxes.find((m) => m.name === this.config.badgeLabel && !m.role)?.id
            ?? mailboxes.find((m) => m.name === this.config.badgeLabel)?.id
            ?? null;
        if (!this.badgeMailboxId) this.log.warn(`[${this.name}] no "${this.config.badgeLabel}" label: badges are off`);
        if (!this.state.emailState) await this.resync();
        await this.subscribe();
        this.pollTimer = this.timers.setInterval(() => this.notice('poll'), POLL_MS);
        this.log.info(`[${this.name}] watching, notices by ${this.notices}`);
    }

    // Take the present as the starting point: nothing already there is new.
    async resync() {
        this.state.emailState = await this.jmap.emailState();
        this.state.badge = await this.badgeCount();
        await this.persist();
    }

    async subscribe() {
        const mode = this.config.notices;
        if (mode !== 'eventsource') {
            try {
                await this.subscribePush();
                this.notices = 'push';
                return;
            } catch (error) {
                if (mode === 'push') throw error;
                this.log.warn(`[${this.name}] push subscription refused (${error.message}); using the event source`);
            }
        }
        this.startEventSource();
        this.notices = 'eventsource';
    }

    async subscribePush() {
        // Leftovers from earlier runs point at callback paths whose secret is gone
        for (const sub of await this.jmap.pushSubscriptions()) {
            if (sub.deviceClientId === this.deviceClientId) await this.jmap.destroyPushSubscription(sub.id);
        }
        this.callbackSecret = randomBytes(16).toString('hex');
        this.verified = false;
        // Anything held from the last subscription belongs to one just destroyed
        this.pendingVerification = null;
        const { id, expires } = await this.jmap.createPushSubscription({
            deviceClientId: this.deviceClientId,
            url: `${this.config.publicUrl}/jmap/${this.name}/${this.callbackSecret}`,
            types: TYPES,
            expires: new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString(),
        });
        this.pushSubscriptionId = id;
        if (this.pendingVerification?.id === id) {
            await this.jmap.verifyPushSubscription(id, this.pendingVerification.code);
            this.verified = true;
            this.pendingVerification = null;
            this.log.info(`[${this.name}] push subscription verified`);
        }
        // Renew well before Fastmail stops calling; it may have granted less than asked
        const lifetime = Math.max(new Date(expires).getTime() - Date.now(), 60 * 1000);
        this.timers.clearTimeout(this.renewTimer);
        this.renewTimer = this.timers.setTimeout(() => this.subscribePush().catch((error) => {
            this.log.warn(`[${this.name}] renewal failed (${error.message}); using the event source`);
            this.startEventSource();
            this.notices = 'eventsource';
        }), lifetime * 0.8);
    }

    startEventSource() {
        if (!this.jmap.eventSourceUrl) throw new Error('the session has no event source');
        runEventSource({
            url: eventSourceURL(this.jmap.eventSourceUrl, { types: TYPES }),
            headers: this.jmap.headers(),
            onStateChange: (change) => this.receive(change),
            signal: this.abort.signal,
            fetch: this.jmap.fetch,
            log: this.log,
        }).catch((error) => this.log.error(`[${this.name}] event source stopped: ${error.message}`));
    }

    // What Fastmail sends: first a verification, then state changes. A change
    // to someone else's account is ignored. A verification can arrive before
    // `PushSubscription/set` has told us the id it names, so one we do not
    // recognise is kept rather than dropped: `subscribePush` looks for it.
    async receive(body) {
        if (body?.['@type'] === 'PushVerification') {
            if (body.pushSubscriptionId !== this.pushSubscriptionId) {
                this.pendingVerification = { id: body.pushSubscriptionId, code: body.verificationCode };
                return;
            }
            await this.jmap.verifyPushSubscription(this.pushSubscriptionId, body.verificationCode);
            this.verified = true;
            this.log.info(`[${this.name}] push subscription verified`);
            return;
        }
        if (body?.['@type'] === 'StateChange') {
            const changed = body.changed?.[this.jmap.accountId];
            if (changed && TYPES.some((type) => type in changed)) this.notice('change');
        }
    }

    // A burst of notices becomes one look at the change log, and looks
    // never overlap: each waits for the one before it.
    notice(source) {
        this.lastNoticeAt = new Date().toISOString();
        if (this.pending) return;
        this.pending = this.timers.setTimeout(() => {
            this.pending = null;
            this.chain = this.chain
                .then(() => this.process(source))
                .catch((error) => this.log.error(`[${this.name}] ${error.message}`));
        }, source === 'poll' ? 0 : COALESCE_MS);
    }

    async process(source) {
        let changes;
        try {
            changes = await this.jmap.emailChanges(this.state.emailState);
        } catch (error) {
            if (error.type !== 'cannotCalculateChanges') throw error;
            this.log.warn(`[${this.name}] change log gone; resyncing without notifying`);
            await this.resync();
            return;
        }
        if (changes.created.length > BACKLOG_CAP) {
            this.log.warn(`[${this.name}] ${changes.created.length} new ids since last look; too many to announce, resyncing`);
            await this.resync();
            return;
        }
        const emails = await this.jmap.emails(changes.created);
        const fresh = selectNotifiable(emails, { inboxId: this.inboxId, notified: new Set(this.state.notified) });
        const badge = await this.badgeCount();

        for (const email of fresh) {
            await this.broadcast(alertPayload(email, { badge }), { collapseId: email.id });
        }
        if (!fresh.length && badge !== null && badge !== this.state.badge) {
            // One collapse id for all of them: only the newest count matters
            await this.broadcast(badgePayload(badge), { collapseId: 'badge' });
        }

        this.state = rememberNotified(this.state, fresh.map((email) => email.id));
        this.state.emailState = changes.newState;
        this.state.badge = badge;
        await this.persist();
        if (fresh.length) this.log.info(`[${this.name}] ${fresh.length} new (${source})`);
    }

    async badgeCount() {
        return this.badgeMailboxId ? this.jmap.mailboxTotal(this.badgeMailboxId) : null;
    }

    async broadcast(payload, { collapseId }) {
        for (const token of this.devices.tokens(this.name)) {
            let result;
            try {
                result = await this.apns.send(token, payload, { topic: this.account.topic, collapseId });
            } catch (error) {
                this.log.warn(`[${this.name}] apns: ${error.message}`);
                continue;
            }
            if (deviceOutcome(result.status, result.reason) === 'remove') {
                await this.devices.remove(this.name, token);
                this.log.info(`[${this.name}] dropped a dead device (${result.reason})`);
            } else if (result.status !== 200) {
                this.log.warn(`[${this.name}] apns ${result.status} ${result.reason ?? ''}`);
            }
        }
    }

    async persist() {
        await saveState(this.config.dataDir, this.name, this.state);
    }

    // /healthz is unauthenticated, so it says whether the machinery works and
    // nothing about the mail itself.
    status() {
        return {
            notices: this.notices,
            verified: this.notices === 'push' ? this.verified : null,
            lastNotice: this.lastNoticeAt,
            devices: this.devices.tokens(this.name).length,
        };
    }

    stop() {
        this.abort.abort();
        this.timers.clearInterval(this.pollTimer);
        this.timers.clearTimeout(this.renewTimer);
        this.timers.clearTimeout(this.startTimer);
        this.timers.clearTimeout(this.pending);
        this.pending = null;
    }
}
