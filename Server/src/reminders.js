/*
 * Reminders for sent mail nobody answered.
 *
 * The compose window marks a message it sends with two keywords: REMIND, and
 * REMIND_AT_PREFIX followed by the moment to come back, in seconds since the
 * epoch. Once the message is in Sent, the server snoozes it there: it stays
 * in Sent, is also in Snoozed, and Fastmail puts it in the Inbox, unread, at
 * that moment. REMIND is swapped for REMINDING, so it is snoozed only once.
 *
 * A reply cancels the reminder: a message arriving in the same conversation,
 * later than the reminder, takes it out of Snoozed again.
 */

export const REMIND = '$fmc-remind';
export const REMINDING = '$fmc-reminding';
export const REMIND_AT_PREFIX = '$fmc-remind-';

// A moment already gone still comes back, a minute from now
export const OVERDUE_MS = 60 * 1000;

// The moment a message asks to come back, or null. Should it carry more than
// one, the latest counts.
export function remindAt(keywords) {
    let latest = null;
    for (const [keyword, set] of Object.entries(keywords ?? {})) {
        if (!set || !keyword.startsWith(REMIND_AT_PREFIX)) continue;
        const seconds = keyword.slice(REMIND_AT_PREFIX.length);
        if (!/^\d+$/.test(seconds)) continue;
        const moment = new Date(Number(seconds) * 1000);
        if (!latest || moment > latest) latest = moment;
    }
    return latest;
}

// JMAP dates are UTC to the second
export function utcDate(date) {
    return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

export function snoozePatch(email, { snoozedId, inboxId, now = new Date() }) {
    const at = remindAt(email.keywords);
    if (!at) return null;
    const until = at.getTime() > now.getTime() ? at : new Date(now.getTime() + OVERDUE_MS);
    return {
        [`mailboxIds/${snoozedId}`]: true,
        snoozed: { until: utcDate(until), moveToMailboxId: inboxId, setKeywords: { $seen: false } },
        [`keywords/${REMIND}`]: null,
        [`keywords/${REMINDING}`]: true,
    };
}

export function cancelPatch({ snoozedId }) {
    return {
        [`mailboxIds/${snoozedId}`]: null,
        snoozed: null,
        [`keywords/${REMINDING}`]: null,
    };
}

// The messages that count as an answer: arrived, not written here, and not
// thrown away.
export function answers(emails, { sentId, draftsId, junkId, trashId }) {
    return emails.filter((email) => {
        const boxes = email.mailboxIds ?? {};
        if (!email.threadId || email.keywords?.$draft) return false;
        return ![sentId, draftsId, junkId, trashId].some((id) => id && boxes[id]);
    });
}

// Of the messages in those conversations, the reminders an answer cancels:
// still waiting in Snoozed, and older than an answer in their conversation.
export function answered(candidates, replies, { snoozedId }) {
    const latestReply = new Map();
    for (const reply of replies) {
        const at = Date.parse(reply.receivedAt) || 0;
        if (at > (latestReply.get(reply.threadId) ?? -1)) latestReply.set(reply.threadId, at);
    }
    return candidates.filter((email) => {
        if (!email.keywords?.[REMINDING] || !email.mailboxIds?.[snoozedId]) return false;
        const replyAt = latestReply.get(email.threadId);
        return replyAt !== undefined && (Date.parse(email.receivedAt) || 0) < replyAt;
    });
}
