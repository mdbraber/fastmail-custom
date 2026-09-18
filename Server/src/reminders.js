/*
 * Snoozed conversations a reply wakes, and reminders for sent mail nobody
 * answered.
 *
 * Fastmail leaves a snoozed message snoozed when someone replies: the reply
 * reaches the Inbox, and the message it answers comes back again later, at
 * its own time. Here a reply wakes it instead. It goes back to the Inbox,
 * which is where Fastmail returns snoozed mail unless told otherwise; where
 * else it was told is Fastmail's `snoozed` property, which an API token
 * cannot read.
 *
 * Reminders for sent mail nobody answered:
 *
 * The compose window marks a message it sends with `$fmc-remind` and
 * `$fmc-remind-<seconds since the epoch>`. Once the message is in Sent, the
 * apps snooze it there: it stays in Sent, is also in Snoozed, and Fastmail
 * puts it in the Inbox, unread, at that moment; `$fmc-remind` becomes
 * REMINDING as they do. The apps do it because Fastmail keeps the `snoozed`
 * property from API tokens.
 *
 * What the server does is the part that has to happen while no app is
 * open: a reply cancels the reminder. A message arriving in the same
 * conversation, later than the reminder, takes it out of Snoozed again,
 * which clears its snooze as well.
 */

export const REMINDING = '$fmc-reminding';

export function cancelPatch({ snoozedId }) {
    return {
        [`mailboxIds/${snoozedId}`]: null,
        [`keywords/${REMINDING}`]: null,
    };
}

// Out of Snoozed, which clears its snooze, and back in the Inbox
export function wakePatch({ snoozedId, inboxId }) {
    return {
        [`mailboxIds/${snoozedId}`]: null,
        [`mailboxIds/${inboxId}`]: true,
    };
}

// What a reply does to a message it answers: a reminder is cancelled and
// stays in Sent, anything else snoozed comes back
export function replyPatch(email, ids) {
    return email.keywords?.[REMINDING] ? cancelPatch(ids) : wakePatch(ids);
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

// Of the messages in those conversations, the ones an answer wakes or
// cancels: still waiting in Snoozed, and older than an answer in their
// conversation.
export function answered(candidates, replies, { snoozedId }) {
    const latestReply = new Map();
    for (const reply of replies) {
        const at = Date.parse(reply.receivedAt) || 0;
        if (at > (latestReply.get(reply.threadId) ?? -1)) latestReply.set(reply.threadId, at);
    }
    return candidates.filter((email) => {
        if (!email.mailboxIds?.[snoozedId]) return false;
        const replyAt = latestReply.get(email.threadId);
        return replyAt !== undefined && (Date.parse(email.receivedAt) || 0) < replyAt;
    });
}
