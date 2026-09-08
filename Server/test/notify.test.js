import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectNotifiable, senderName, alertPayload, badgePayload, threadURL } from '../src/notify.js';

const inbox = 'mbx-inbox';
const email = (over = {}) => ({
    id: 'M1',
    threadId: 'T1',
    mailboxIds: { [inbox]: true },
    keywords: {},
    from: [{ name: 'Ada Lovelace', email: 'ada@example.net' }],
    subject: 'Engines',
    receivedAt: '2026-09-07T10:00:00Z',
    ...over,
});

test('a fresh unseen message in the Inbox notifies', () => {
    const chosen = selectNotifiable([email()], { inboxId: inbox, notified: new Set() });
    assert.deepEqual(chosen.map((e) => e.id), ['M1']);
});

test('outside the Inbox, seen, draft, or already announced do not', () => {
    const candidates = [
        email({ id: 'filed', mailboxIds: { 'mbx-other': true } }),
        email({ id: 'seen', keywords: { $seen: true } }),
        email({ id: 'draft', keywords: { $draft: true } }),
        email({ id: 'done' }),
    ];
    assert.deepEqual(selectNotifiable(candidates, { inboxId: inbox, notified: new Set(['done']) }), []);
});

test('the sender name falls back to the address, then to a placeholder', () => {
    assert.equal(senderName(email()), 'Ada Lovelace');
    assert.equal(senderName(email({ from: [{ name: '  ', email: 'ada@example.net' }] })), 'ada@example.net');
    assert.equal(senderName(email({ from: [] })), 'Unknown sender');
    assert.equal(senderName(email({ from: null })), 'Unknown sender');
});

test('the alert payload carries title, body, badge, thread and the url to open', () => {
    assert.deepEqual(alertPayload(email(), { badge: 3 }), {
        aps: {
            alert: { title: 'Ada Lovelace', body: 'Engines' },
            sound: 'default',
            'thread-id': 'T1',
            badge: 3,
        },
        url: 'https://app.fastmail.com/mail/Inbox/T1.M1',
        emailId: 'M1',
    });
});

test('an empty subject and an unknown badge are handled', () => {
    const payload = alertPayload(email({ subject: '  ' }), { badge: null });
    assert.equal(payload.aps.alert.body, '(no subject)');
    assert.equal('badge' in payload.aps, false);
});

test('a badge-only payload is just the number', () => {
    assert.deepEqual(badgePayload(0), { aps: { badge: 0 } });
});

test('thread ids are url-encoded', () => {
    assert.equal(
        threadURL({ id: 'M c+d', threadId: 'T a/b' }),
        'https://app.fastmail.com/mail/Inbox/T%20a%2Fb.M%20c%2Bd',
    );
});

// Fastmail reads the last path segment as "<thread id>.<message id>", and a
// segment with no dot in it as a message id on its own. So a bare thread id
// is not a short way of naming the conversation — it is a message id that
// matches no message, and the app falls back to showing the mailbox. That is
// what a tapped notification did: it opened the list instead of the message.
test('the link names the message inside the thread, not the thread alone', () => {
    const url = threadURL(email());
    assert.equal(url, 'https://app.fastmail.com/mail/Inbox/T1.M1');
    assert.equal(alertPayload(email(), { badge: null }).url, url);

    // Both halves are there and in that order: thread first, then message
    const segment = url.slice(url.lastIndexOf('/') + 1);
    assert.deepEqual(segment.split('.'), ['T1', 'M1']);
});

// A message still carrying the badge label is opened where it is worked on,
// so the triage list is the one behind it and the verbs act on that list
test('a message in the badge label opens in that label rather than the Inbox', () => {
    const triage = 'mbx-triage';
    const waiting = email({ mailboxIds: { [inbox]: true, [triage]: true } });

    assert.equal(
        threadURL(waiting, { badge: { id: triage, label: 'Triage' } }),
        'https://app.fastmail.com/mail/Triage/T1.M1',
    );
    assert.equal(alertPayload(waiting, { badge: 2, context: { id: triage, label: 'Triage' } }).url,
        'https://app.fastmail.com/mail/Triage/T1.M1');

    // Already triaged, or no badge label at all: the Inbox is the context
    assert.equal(
        threadURL(email(), { badge: { id: triage, label: 'Triage' } }),
        'https://app.fastmail.com/mail/Inbox/T1.M1',
    );
    assert.equal(threadURL(waiting), 'https://app.fastmail.com/mail/Inbox/T1.M1');
    assert.equal(threadURL(waiting, { badge: null }), 'https://app.fastmail.com/mail/Inbox/T1.M1');
});

test('a label whose name needs encoding still makes one path segment', () => {
    const held = 'mbx-held';
    const waiting = email({ mailboxIds: { [inbox]: true, [held]: true } });
    assert.equal(
        threadURL(waiting, { badge: { id: held, label: 'To read/now' } }),
        'https://app.fastmail.com/mail/To%20read%2Fnow/T1.M1',
    );
});
