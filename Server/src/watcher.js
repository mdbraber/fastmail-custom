import { randomBytes } from 'node:crypto';
import { alertPayload, badgePayload, selectNotifiable } from './notify.js';
import { rememberNotified, saveState } from './state.js';
import { deviceOutcome } from './apns.js';
import { eventSourceURL, runEventSource } from './jmap.js';
import { decrypt, generateKeys, subscriptionKeys } from './webpush.js';

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
        this.archiveMailboxId = null;
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
        this.archiveMailboxId = mailboxes.find((m) => m.role === 'archive')?.id ?? null;
        if (!this.archiveMailboxId) this.log.warn(`[${this.name}] no Archive folder: the notification's Archive button is off`);
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
        // Fastmail seals every callback to these (RFC 8291); they live as long as the subscription
        this.pushKeys = generateKeys();
        this.verified = false;
        // Anything held from the last subscription belongs to one just destroyed
        this.pendingVerification = null;
        const { id, expires } = await this.jmap.createPushSubscription({
            deviceClientId: this.deviceClientId,
            url: `${this.config.publicUrl}/jmap/${this.name}/${this.callbackSecret}`,
            types: TYPES,
            expires: new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString(),
            keys: subscriptionKeys(this.pushKeys),
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
    // A sealed callback body → the notice inside it, or null when it is not
    // for the current subscription's keys (an old subscription's straggler,
    // or noise on the callback path) or holds no JSON object.
    unseal(raw) {
        if (!this.pushKeys) return null;
        try {
            const body = JSON.parse(decrypt(raw, this.pushKeys).toString('utf8'));
            return body && typeof body === 'object' ? body : null;
        } catch (error) {
            this.log.warn(`[${this.name}] a callback that would not open (${error.message})`);
            return null;
        }
    }

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
            await this.broadcast(
                alertPayload(email, { badge, context: this.badgeContext() }),
                { collapseId: email.id, alerts: true },
            );
        }
        if (badge !== null && badge !== this.state.badge) {
            // Devices with alerts on already got the count on the alert; the
            // others only ever hear the count. One collapse id for all of
            // them: only the newest matters.
            await this.broadcast(badgePayload(badge), { collapseId: 'badge', alerts: fresh.length ? false : undefined });
        }

        this.state = rememberNotified(this.state, fresh.map((email) => email.id));
        this.state.emailState = changes.newState;
        this.state.badge = badge;
        await this.persist();
        if (fresh.length) this.log.info(`[${this.name}] ${fresh.length} new (${source})`);
    }

    /*
     * The buttons on a notification: archive, later, pin.
     *
     * The phone holds no Fastmail credentials and a background action gets a
     * few seconds, so it asks here and this makes the change.
     *
     * Each verb has to mean what it means in the app, or the same word does
     * two different things depending on where you press it. The model the app
     * works to: a project label is the live state, a message carries at most
     * one, a hold label — Later — holds mail that has not been decided, and
     * the labels hidden from the sidebar are history that nothing touches.
     *
     * So the labels have to be read, not guessed at, and they are read fresh
     * on every press: a project label made this morning is one you can file
     * out of tonight, and one extra round trip costs nothing on a button
     * nobody presses twice a minute.
     *
     * Any failure travels back to the phone, which says so. A message changed
     * here is a change like any other, so the badge and the state follow from
     * the notice Fastmail sends about it.
     */

    // Archive: out of the Inbox, off the triage label, the project label off
    // with it — it is the live state and this is no longer live — the pin off,
    // and every hold label left alone, because a hold outlives a decision.
    async archive(emailId) {
        if (!this.archiveMailboxId) throw new Error('no Archive folder in this account');
        const { email, projects } = await this.labelsOn(emailId);

        const patch = { [`mailboxIds/${this.inboxId}`]: null };
        if (this.badgeMailboxId && email.mailboxIds?.[this.badgeMailboxId]) {
            patch[`mailboxIds/${this.badgeMailboxId}`] = null;
        }
        for (const id of projects) patch[`mailboxIds/${id}`] = null;
        patch[`mailboxIds/${this.archiveMailboxId}`] = true;
        if (email.keywords?.$flagged) patch['keywords/$flagged'] = null;

        return this.write('archived', emailId, patch);
    }

    // Later: a hold label is a filing destination like a project, so it
    // replaces — the triage label and every other destination come off. The
    // Inbox stays on: a held message is still in the Inbox, waiting for you.
    // The pin is none of filing's business.
    async later(emailId) {
        const { email, mailboxes, projects, holds } = await this.labelsOn(emailId);
        const wanted = this.config.holdLabels?.[0];
        const destination = mailboxes.find((m) => !m.role && m.name === wanted);
        if (!destination) throw new Error(`no "${wanted}" label in this account`);

        const patch = { [`mailboxIds/${destination.id}`]: true };
        if (this.badgeMailboxId && email.mailboxIds?.[this.badgeMailboxId]) {
            patch[`mailboxIds/${this.badgeMailboxId}`] = null;
        }
        for (const id of projects) patch[`mailboxIds/${id}`] = null;
        for (const id of holds) if (id !== destination.id) patch[`mailboxIds/${id}`] = null;

        return this.write(`filed under ${wanted}`, emailId, patch);
    }

    // Pin: one keyword, and nothing moves. Setting rather than toggling — a
    // banner announces a message that has just arrived, and you cannot see
    // from the lock screen what state you would be toggling out of.
    async pin(emailId) {
        await this.labelsOn(emailId);
        return this.write('pinned', emailId, { 'keywords/$flagged': true });
    }

    async write(what, emailId, patch) {
        await this.jmap.patchEmail(emailId, patch);
        this.log.info(`[${this.name}] ${what} ${emailId} from a notification`);
        return true;
    }

    /*
     * The message and the labels it carries, sorted into the model's kinds.
     * A message that has been dealt with between the banner and the press is
     * not something to guess about, so a missing one stops here.
     */
    async labelsOn(emailId) {
        const [email] = await this.jmap.emails([emailId]);
        if (!email) throw new Error(`no such message: ${emailId}`);

        const mailboxes = await this.jmap.mailboxes();
        const holdNames = this.config.holdLabels ?? [];
        const carried = (m) => email.mailboxIds?.[m.id] === true;
        // Sidebar membership is the rule: bit 1 of Fastmail's `hidden` flag is
        // "not in the folder list", which is every history shelf and no label
        // anyone files under.
        const label = (m) => !m.role && !(Number(m.hidden) & 1) && m.id !== this.badgeMailboxId;
        const isHold = (m) => holdNames.includes(m.name);

        return {
            email,
            mailboxes,
            projects: mailboxes.filter((m) => label(m) && !isHold(m) && carried(m)).map((m) => m.id),
            holds: mailboxes.filter((m) => label(m) && isHold(m) && carried(m)).map((m) => m.id),
        };
    }

    // The badge label as a link context: a message still carrying it opens
    // in that label rather than in the Inbox.
    badgeContext() {
        return this.badgeMailboxId ? { id: this.badgeMailboxId, label: this.config.badgeLabel } : null;
    }

    async badgeCount() {
        return this.badgeMailboxId ? this.jmap.mailboxTotal(this.badgeMailboxId) : null;
    }

    // To every device, or only those with alerts on (true) or off (false)
    async broadcast(payload, { collapseId, alerts }) {
        for (const token of this.devices.tokens(this.name, { alerts })) {
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
            muted: this.devices.tokens(this.name, { alerts: false }).length,
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
