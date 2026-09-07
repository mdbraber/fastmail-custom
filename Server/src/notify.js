// Which of the emails a notice brought deserve a banner, and what it says.
// Pure: no clock, no network, so every rule here is a plain test.

export function selectNotifiable(emails, { inboxId, notified }) {
    return emails.filter((email) =>
        email.mailboxIds?.[inboxId] === true
        && !email.keywords?.$seen
        && !email.keywords?.$draft
        && !notified.has(email.id));
}

export function senderName(email) {
    const from = email.from?.[0];
    if (!from) return 'Unknown sender';
    return (from.name || '').trim() || from.email || 'Unknown sender';
}

// Where the message is opened. A banner should land on the message in the
// list it is worked from: one still carrying the badge label opens in that
// label, where the triage verbs act on the list behind it. Anything else —
// already triaged, or no badge label configured — opens in the Inbox.
export function threadURL(email, { badge } = {}) {
    const inTriage = badge?.id && email.mailboxIds?.[badge.id] === true;
    const list = inTriage ? badge.label : 'Inbox';
    return `https://app.fastmail.com/mail/${encodeURIComponent(list)}/${encodeURIComponent(email.threadId)}`;
}

// The APNs payload for one new message. `badge` is the conversation count to
// show, or null when there is no badge label to count; `context` is that
// label's id and name, so the link can open the message where it is worked.
export function alertPayload(email, { badge, context = null }) {
    const aps = {
        alert: {
            title: senderName(email),
            body: (email.subject || '').trim() || '(no subject)',
        },
        sound: 'default',
        'thread-id': email.threadId,
    };
    if (Number.isInteger(badge)) aps.badge = badge;
    return { aps, url: threadURL(email, { badge: context }), emailId: email.id };
}

export function badgePayload(badge) {
    return { aps: { badge } };
}
