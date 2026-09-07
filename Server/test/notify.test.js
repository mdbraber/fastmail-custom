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
        url: 'https://app.fastmail.com/mail/Inbox/T1',
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
    assert.equal(threadURL({ threadId: 'T a/b' }), 'https://app.fastmail.com/mail/Inbox/T%20a%2Fb');
});
