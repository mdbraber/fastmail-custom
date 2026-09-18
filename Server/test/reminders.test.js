import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answered, answers, cancelPatch, replyPatch, wakePatch } from '../src/reminders.js';

test('cancelling takes the message out of Snoozed and drops its mark, and nothing else', () => {
    assert.deepEqual(cancelPatch({ snoozedId: 'z' }), { 'mailboxIds/z': null, 'keywords/$fmc-reminding': null });
});

test('waking takes the message out of Snoozed and back into the Inbox', () => {
    assert.deepEqual(wakePatch({ snoozedId: 'z', inboxId: 'i' }), { 'mailboxIds/z': null, 'mailboxIds/i': true });
});

test('a reply cancels a reminder and wakes anything else snoozed', () => {
    const ids = { snoozedId: 'z', inboxId: 'i' };
    assert.deepEqual(replyPatch({ keywords: { '$fmc-reminding': true } }, ids), { 'mailboxIds/z': null, 'keywords/$fmc-reminding': null });
    assert.deepEqual(replyPatch({ keywords: { $seen: true } }, ids), { 'mailboxIds/z': null, 'mailboxIds/i': true });
    assert.deepEqual(replyPatch({}, ids), { 'mailboxIds/z': null, 'mailboxIds/i': true });
});

test('an answer is a message that arrived; what it wakes is waiting and older, in the same conversation', () => {
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
    ], replies, ids).map((e) => e.id), ['old', 'plain']);
});
