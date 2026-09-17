import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERDUE_MS, answered, answers, remindAt, snoozePatch } from '../src/reminders.js';

test('the moment a message asks to come back is read from its keyword, the latest if several', () => {
    assert.equal(remindAt({ $seen: true }), null);
    assert.equal(remindAt({ '$fmc-remind-abc': true }), null);
    assert.equal(remindAt({ '$fmc-remind-100': true }).getTime(), 100000);
    assert.equal(remindAt({ '$fmc-remind-100': true, '$fmc-remind-200': true, '$fmc-remind-300': false }).getTime(), 200000);
});

test('a moment already gone comes back a minute from now; a message without one is not snoozed', () => {
    const now = new Date('2026-09-17T10:00:00Z');
    const patch = snoozePatch({ keywords: { '$fmc-remind-100': true } }, { snoozedId: 'z', inboxId: 'i', now });
    assert.equal(patch.snoozed.until, new Date(now.getTime() + OVERDUE_MS).toISOString().replace(/\.\d+Z$/, 'Z'));
    assert.equal(snoozePatch({ keywords: {} }, { snoozedId: 'z', inboxId: 'i', now }), null);
});

test('an answer is a message that arrived; a reminder it cancels is waiting and older, in the same conversation', () => {
    const ids = { sentId: 's', draftsId: 'd', junkId: 'j', trashId: 't', snoozedId: 'z' };
    const replies = answers([
        { id: 'a', threadId: 'T', mailboxIds: { inbox: true }, receivedAt: '2026-09-17T12:00:00Z' },
        { id: 'b', threadId: 'T', mailboxIds: { t: true } },
        { id: 'c', mailboxIds: { inbox: true } },
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
