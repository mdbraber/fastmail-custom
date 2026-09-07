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

export function threadURL(email) {
    return `https://app.fastmail.com/mail/Inbox/${encodeURIComponent(email.threadId)}`;
}

// The APNs payload for one new message. `badge` is the conversation count to
// show, or null when there is no badge label to count.
export function alertPayload(email, { badge }) {
    const aps = {
        alert: {
            title: senderName(email),
            body: (email.subject || '').trim() || '(no subject)',
        },
        sound: 'default',
        'thread-id': email.threadId,
    };
    if (Number.isInteger(badge)) aps.badge = badge;
    return { aps, url: threadURL(email), emailId: email.id };
}

export function badgePayload(badge) {
    return { aps: { badge } };
}
