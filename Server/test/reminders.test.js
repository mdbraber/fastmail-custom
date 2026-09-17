import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answered, answers, cancelPatch } from '../src/reminders.js';

test('cancelling takes the message out of Snoozed and drops its mark, and nothing else', () => {
    assert.deepEqual(cancelPatch({ snoozedId: 'z' }), { 'mailboxIds/z': null, 'keywords/$fmc-reminding': null });
});

test('an answer is a message that arrived; a reminder it cancels is waiting and older, in the same conversation', () => {
    const ids = { sentId: 's', draftsId: 'd', junkId: 'j', trashId: 't', snoozedId: 'z' };
    const replies = answers([
        { id: 'a', threadId: 'T', mailboxIds: { inbox: true }, receivedAt: '2026-09-17T12:00:00Z' },
        { id: 'b', threadId: 'T', mailboxIds: { t: true } },
        { id: 'c', mailboxIds: { inbox: true } },
        { id: 'e', threadId: 'T', mailboxIds: { d: true }, keywords: { $draft: true } },
    ], ids);
    assert.deepEqual(replies.map((e) => e.id), ['a']);
    const waiting = (id, over) => ({ id, threadId: 'T', mailboxIds: { s: true, z: true }, keywords: { '$fmc-reminding': true }, receivedAt: '2026-09-17T10:00:00Z', ...over });
    assert.deepEqual(answered([
        waiting('old'),
        waiting('newer', { receivedAt: '2026-09-17T13:00:00Z' }),
        waiting('woken', { mailboxIds: { s: true } }),
        waiting('plain', { keywords: {} }),
        waiting('other', { threadId: 'U' }),
    ], replies, ids).map((e) => e.id), ['old']);
});
