import { randomBytes } from 'node:crypto';
import { alertPayload, badgePayload, dismissPayload, matchesChoice, selectFresh } from './notify.js';
import { MODES } from './choice.js';
import { addressSets } from './contacts.js';
import { forgetShown, rememberNotified, rememberShown, saveState } from './state.js';
import { deviceOutcome } from './apns.js';
import { eventSourceURL, runEventSource } from './jmap.js';
import { decrypt, generateKeys, subscriptionKeys } from './webpush.js';
import { REMIND, answered, answers, cancelPatch, snoozePatch } from './reminders.js';

export const COALESCE_MS = 2000;
export const POLL_MS = 5 * 60 * 1000;
export const RETRY_MS = 10 * 60 * 1000;
export const SUBSCRIPTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// More created ids than this since the last look means the server was away
// long enough that announcing them all would be noise, not news.
export const BACKLOG_CAP = 500;
const MAIL_TYPES = ['Email', 'Mailbox'];
const CONTACT_TYPE = 'ContactCard';

const realTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

// One account, from first session to every push: learns the mailboxes,
// subscribes to Fastmail's change notices, and turns each into the alerts and
// badge updates its devices should see.
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
        this.junkId = null;
        this.trashId = null;
        // Where reminders for unanswered mail wait; without Sent and Snoozed
        // there are none
        this.sentId = null;
        this.draftsId = null;
        this.snoozedId = null;
        // The contacts of every address book the token can read, as two sets
        // of lowercased addresses that are the union across those accounts,
        // and the ContactCard state each account was read at (by account
        // id); empty without contacts access
        this.contactAddresses = new Set();
        this.vipAddresses = new Set();
        this.contactsStates = {};
        this.contactsDue = false;
        // Set once the JMAP session has been read, and never unset: until
        // then `hasContacts` is false for want of knowing, not because the
        // token cannot read contacts
        this.sessionRead = false;
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
    // Known once the session is read; false until then
    get hasContacts() { return this.jmap.contactsAccountIds.length > 0; }
    // ContactCard only with contacts access: a subscription naming a type
    // the token may not read would be refused
    get types() { return this.hasContacts ? [...MAIL_TYPES, CONTACT_TYPE] : MAIL_TYPES; }

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
        // The session names the contacts accounts; a later step failing
        // does not make them unknown again
        this.sessionRead = true;
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
        // Important leaves out what Fastmail filed as junk or deleted
        this.junkId = mailboxes.find((m) => m.role === 'junk')?.id ?? null;
        this.trashId = mailboxes.find((m) => m.role === 'trash')?.id ?? null;
        this.sentId = mailboxes.find((m) => m.role === 'sent')?.id ?? null;
        this.draftsId = mailboxes.find((m) => m.role === 'drafts')?.id ?? null;
        this.snoozedId = mailboxes.find((m) => m.role === 'snoozed')?.id ?? null;
        if (!this.sentId || !this.snoozedId) this.log.warn(`[${this.name}] no Sent or Snoozed folder: reminders for unanswered mail are off`);
        if (!this.hasContacts) this.log.warn(`[${this.name}] the token cannot read contacts: VIPs and contacts match nobody`);
        await this.loadContacts();
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
            types: this.types,
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
            url: eventSourceURL(this.jmap.eventSourceUrl, { types: this.types }),
            headers: this.jmap.headers(),
            onStateChange: (change) => this.receive(change),
            signal: this.abort.signal,
            fetch: this.jmap.fetch,
            log: this.log,
        }).catch((error) => this.log.error(`[${this.name}] event source stopped: ${error.message}`));
    }

    // What Fastmail sends: first a verification, then state changes.
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
            const mail = body.changed?.[this.jmap.accountId];
            // A notice names each changed type with its new state; the cards
            // of an account are read again only when its state is not the
            // one already read there, and any one of the accounts qualifies
            const cardsChanged = this.jmap.contactsAccountIds.some((id) => {
                const cards = body.changed?.[id]?.[CONTACT_TYPE];
                return cards !== undefined && cards !== this.contactsStates[id];
            });
            if (cardsChanged) this.contactsDue = true;
            if (cardsChanged || (mail && MAIL_TYPES.some((type) => type in mail))) this.notice('change');
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
        // Before the mail, so a VIP added a moment ago already counts
        if (this.contactsDue) await this.loadContacts();
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
        const fresh = selectFresh(emails, { notified: new Set(this.state.notified) });
        const devices = this.devices.entries(this.name);
        const context = await this.contextFor(fresh, devices);
        const badge = await this.badgeCount();
        const badgeChanged = badge !== null && badge !== this.state.badge;

        const alerted = new Set();
        // Message id → the devices it was shown on
        const banners = new Map();
        for (const { token, notify } of devices) {
            const wanted = fresh.filter((email) => matchesChoice(notify, email, context));
            let alive = true;
            for (const email of wanted) {
                alive = await this.send(token, alertPayload(email, { badge }), email.id);
                if (!alive) break;
                alerted.add(email.id);
                banners.set(email.id, [...(banners.get(email.id) ?? []), token]);
            }
            // An alert carries the count; a device that got none hears it on its own
            if (alive && !wanted.length && badgeChanged) await this.send(token, badgePayload(badge), 'badge');
        }

        const dismissed = await this.dismissRead(changes);
        await this.remind(emails);

        // Announced for the account: every fresh message has been put to every device
        this.state = rememberNotified(this.state, fresh.map((email) => email.id));
        this.state = forgetShown(rememberShown(this.state, banners), dismissed);
        this.state.emailState = changes.newState;
        this.state.badge = badge;
        await this.persist();
        if (alerted.size) this.log.info(`[${this.name}] ${alerted.size} new (${source})`);
        if (dismissed.length) this.log.info(`[${this.name}] ${dismissed.length} read (${source})`);
    }

    /*
     * Banners for messages read or deleted since they were shown come off
     * again: each device that showed any gets one silent push naming them,
     * and the app takes them off. iOS rations silent pushes and gives none to
     * an app swiped away, so this is best effort; opening the app still
     * clears everything.
     *
     * Only messages with a banner are looked at. A lookup that fails leaves
     * them shown, to be looked at with the next change. Returns the ids
     * taken off.
     */
    async dismissRead(changes) {
        const shown = new Map((this.state.shown ?? []).map((entry) => [entry.id, entry.tokens]));
        const changed = new Set([...(changes.updated ?? []), ...(changes.destroyed ?? [])]);
        const touched = [...shown.keys()].filter((id) => changed.has(id));
        if (!touched.length) return [];

        let keywords;
        try {
            keywords = new Map((await this.jmap.keywords(touched)).map((email) => [email.id, email.keywords ?? {}]));
        } catch (error) {
            this.log.warn(`[${this.name}] could not check whether shown messages were read: ${error.message}`);
            return [];
        }
        const read = touched.filter((id) => !keywords.has(id) || keywords.get(id).$seen);
        if (!read.length) return [];

        const live = new Set(this.devices.entries(this.name).map((device) => device.token));
        const perDevice = new Map();
        for (const id of read) {
            for (const token of shown.get(id)) {
                if (live.has(token)) perDevice.set(token, [...(perDevice.get(token) ?? []), id]);
            }
        }
        for (const [token, ids] of perDevice) {
            await this.send(token, dismissPayload(ids), null, 'background');
        }
        return read;
    }

    /*
     * Reminders for sent mail nobody answered (see reminders.js): the ones
     * that have reached Sent are snoozed, and the ones an arriving message
     * answers are taken out of Snoozed again. A failure costs this look's
     * reminders, which the next look picks up, and never its alerts.
     */
    async remind(arrived) {
        if (!this.sentId || !this.snoozedId) return;
        const ids = { sentId: this.sentId, draftsId: this.draftsId, junkId: this.junkId, trashId: this.trashId, snoozedId: this.snoozedId };
        try {
            const waiting = await this.jmap.queryEmails({
                operator: 'AND',
                conditions: [
                    { inMailbox: this.sentId },
                    { hasKeyword: REMIND },
                    { operator: 'NOT', conditions: [{ inMailbox: this.snoozedId }] },
                ],
            });
            for (const email of waiting.length ? await this.jmap.emails(waiting) : []) {
                const patch = snoozePatch(email, { snoozedId: this.snoozedId, inboxId: this.inboxId });
                if (!patch) continue;
                await this.jmap.patchEmail(email.id, patch);
                this.log.info(`[${this.name}] reminder set for ${email.id} at ${patch.snoozed.until}`);
            }

            const replies = answers(arrived, ids);
            if (!replies.length) return;
            const threads = await this.jmap.threads([...new Set(replies.map((email) => email.threadId))]);
            const replyIds = new Set(replies.map((email) => email.id));
            const others = [...new Set(threads.flatMap((thread) => thread.emailIds ?? []))].filter((id) => !replyIds.has(id));
            if (!others.length) return;
            for (const email of answered(await this.jmap.emails(others), replies, ids)) {
                await this.jmap.patchEmail(email.id, cancelPatch(ids));
                this.log.info(`[${this.name}] reminder for ${email.id} cancelled by a reply`);
            }
        } catch (error) {
            this.log.warn(`[${this.name}] reminders: ${error.message}`);
        }
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
     * one, a hold label; Later; holds mail that has not been decided, and
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
    // with it; it is the live state and this is no longer live; the pin off,
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
    // replaces; the triage label and every other destination come off.
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

    // Pin: one keyword, and nothing moves. Setting rather than toggling, a
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

    // Both address sets, read afresh from every address book the token can
    // read, and unioned: the sets of each account are built from that
    // account's own cards, never from every account's cards pooled
    // together, because each account has its own VIPs group. A read that
    // fails, in any one account, leaves every set and state exactly as they
    // were and is tried again at the next look, so a hiccup at Fastmail
    // costs VIP alerts for a while, never every alert, and never half a
    // union.
    async loadContacts() {
        this.contactsDue = false;
        if (!this.hasContacts) {
            this.contactAddresses = new Set();
            this.vipAddresses = new Set();
            this.contactsStates = {};
            return;
        }
        try {
            const contacts = new Set();
            const vips = new Set();
            const states = {};
            for (const accountId of this.jmap.contactsAccountIds) {
                const { cards, state } = await this.jmap.contactCards(accountId);
                const sets = addressSets(cards);
                for (const address of sets.contacts) contacts.add(address);
                for (const address of sets.vips) vips.add(address);
                states[accountId] = state;
            }
            this.contactAddresses = contacts;
            this.vipAddresses = vips;
            this.contactsStates = states;
            this.log.info(`[${this.name}] contacts read: ${contacts.size} addresses, ${vips.size} VIP from ${this.jmap.contactsAccountIds.length} address books`);
        } catch (error) {
            this.contactsDue = true;
            this.log.warn(`[${this.name}] contacts unreadable (${error.message}); trying again at the next look`);
        }
    }

    async badgeCount() {
        return this.badgeMailboxId ? this.jmap.mailboxTotal(this.badgeMailboxId) : null;
    }

    // What the rules need beyond the message itself. The followed threads
    // cost two calls, so they are looked up only when a device asks for
    // Important, and only for the threads of this batch.
    async contextFor(fresh, devices) {
        const wantsImportant = devices.some(({ notify }) => notify.mode === 'important');
        return {
            inboxId: this.inboxId,
            junkId: this.junkId,
            trashId: this.trashId,
            vips: this.vipAddresses,
            contacts: this.contactAddresses,
            followedThreadIds: fresh.length && wantsImportant ? await this.followedThreads(fresh) : new Set(),
        };
    }

    // The threads of these messages in which some message carries
    // `$followed`. A lookup that fails costs the followed conversations of
    // this batch, not its other alerts.
    async followedThreads(emails) {
        try {
            const threads = await this.jmap.threads([...new Set(emails.map((email) => email.threadId).filter(Boolean))]);
            const emailIds = [...new Set(threads.flatMap((thread) => thread.emailIds ?? []))];
            const followed = new Set((await this.jmap.keywords(emailIds))
                .filter((email) => email.keywords?.$followed)
                .map((email) => email.id));
            return new Set(threads
                .filter((thread) => (thread.emailIds ?? []).some((id) => followed.has(id)))
                .map((thread) => thread.id));
        } catch (error) {
            this.log.warn(`[${this.name}] followed conversations unreadable (${error.message})`);
            return new Set();
        }
    }

    // One push to one device. False when APNs called the device dead and it
    // was dropped, so the caller sends it nothing more.
    async send(token, payload, collapseId, pushType = 'alert') {
        let result;
        try {
            result = await this.apns.send(token, payload, { topic: this.account.topic, collapseId, pushType });
        } catch (error) {
            this.log.warn(`[${this.name}] apns: ${error.message}`);
            return true;
        }
        if (deviceOutcome(result.status, result.reason) === 'remove') {
            await this.devices.remove(this.name, token);
            this.log.info(`[${this.name}] dropped a dead device (${result.reason})`);
            return false;
        }
        if (result.status !== 200) this.log.warn(`[${this.name}] apns ${result.status} ${result.reason ?? ''}`);
        return true;
    }

    async persist() {
        await saveState(this.config.dataDir, this.name, this.state);
    }

    // /healthz is unauthenticated, so it says whether the machinery works and
    // nothing about the mail itself.
    status() {
        const devices = this.devices.entries(this.name);
        const modes = Object.fromEntries(MODES.map((mode) => [mode, 0]));
        for (const { notify } of devices) modes[notify.mode] += 1;
        return {
            notices: this.notices,
            verified: this.notices === 'push' ? this.verified : null,
            lastNotice: this.lastNoticeAt,
            devices: devices.length,
            // What muted always meant: no alerts, the count still arrives
            muted: modes.off,
            // False before the session has been read, as well as after a
            // read that found no contacts access
            contacts: this.hasContacts,
            modes,
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
