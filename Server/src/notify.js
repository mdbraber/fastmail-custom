// Which of the emails a notice brought deserve a banner, and what it says.
// Pure: no clock, no network, so every rule here is a plain test.

// The messages worth putting to each device's choice: unread, not a draft,
// and not announced before. Where they are is the choice's business.
export function selectFresh(emails, { notified }) {
    return emails.filter((email) =>
        !email.keywords?.$seen
        && !email.keywords?.$draft
        && !notified.has(email.id));
}

// The first sender's address, lowercased so a VIP matches however it is written.
export function senderAddress(email) {
    const address = email.from?.[0]?.email;
    if (typeof address !== 'string') return null;
    const trimmed = address.trim();
    return trimmed ? trimmed.toLowerCase() : null;
}

const carries = (email, id) => Boolean(id) && email.mailboxIds?.[id] === true;

/*
 * Whether one device's choice wants a banner for one fresh message.
 *
 * `context` holds what the message alone does not say: `inboxId`, `junkId`
 * and `trashId` (null when the account has none), the sets `vips` and
 * `contacts` of lowercased addresses, and `followedThreadIds`, the threads
 * in which some message carries `$followed`.
 */
export function matchesChoice(notify, email, context) {
    const sender = senderAddress(email);
    switch (notify?.mode) {
    case 'inbox':
        return carries(email, context.inboxId);
    case 'important': {
        const discarded = carries(email, context.junkId) || carries(email, context.trashId);
        const vip = sender !== null && context.vips.has(sender);
        const followed = Boolean(email.keywords?.$followed) || context.followedThreadIds.has(email.threadId);
        return (!discarded && vip) || followed;
    }
    case 'custom': {
        // In one of the included labels and in none of the excluded ones,
        // so a label on both lists keeps its messages out
        if (!notify.mailboxIds.some((id) => carries(email, id))) return false;
        if (notify.excludedMailboxIds.some((id) => carries(email, id))) return false;
        if (notify.senders === 'contacts') return sender !== null && context.contacts.has(sender);
        if (notify.senders === 'vips') return sender !== null && context.vips.has(sender);
        return true;
    }
    default:
        return false;
    }
}

export function senderName(email) {
    const from = email.from?.[0];
    if (!from) return 'Unknown sender';
    return (from.name || '').trim() || from.email || 'Unknown sender';
}

// Where the message is opened: the Inbox, whatever labels the message
// carries. A banner is read where the mail arrives, not where it is filed.
// Measured in the Mac app on 2026-09-13: this address also opens a
// message that is not in the Inbox, as Important and Custom alerts need.
export function threadURL(email) {
    const conversation = `${encodeURIComponent(email.threadId)}.${encodeURIComponent(email.id)}`;
    return `https://app.fastmail.com/mail/Inbox/${conversation}`;
}

// The APNs payload for one new message. `badge` is the conversation count to
// show, or null when there is no badge label to count.
export const ALERT_CATEGORY = 'message';

export function alertPayload(email, { badge }) {
    const aps = {
        alert: {
            title: senderName(email),
            body: (email.subject || '').trim() || '(no subject)',
        },
        sound: 'default',
        'thread-id': email.threadId,
        category: ALERT_CATEGORY,
    };
    if (Number.isInteger(badge)) aps.badge = badge;
    return { aps, url: threadURL(email), emailId: email.id };
}

// A silent push naming messages whose banners should go: read or deleted
// since. It wakes the app, which takes them off; it shows nothing itself.
export function dismissPayload(emailIds) {
    return { aps: { 'content-available': 1 }, dismiss: emailIds };
}

export function badgePayload(badge) {
    return { aps: { badge } };
}
