import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MAILBOX_IDS, normaliseNotify, registrationChoice, storedChoice } from '../src/choice.js';

const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true };

test('a full choice is kept as sent', () => {
    assert.deepEqual(
        normaliseNotify({ mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'], excludedMailboxIds: ['P9L'], previews: true }),
        { notify: { mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'], excludedMailboxIds: ['P9L'], previews: true } },
    );
});

test('mailboxIds keeps repeats and their order, not just distinct values', () => {
    assert.deepEqual(
        normaliseNotify({ mode: 'custom', mailboxIds: ['b', 'a', 'b'], excludedMailboxIds: ['d', 'c', 'd'], previews: true }),
        { notify: { mode: 'custom', senders: 'everyone', mailboxIds: ['b', 'a', 'b'], excludedMailboxIds: ['d', 'c', 'd'], previews: true } },
    );
});

test('senders and both label lists are filled in when absent', () => {
    assert.deepEqual(normaliseNotify({ mode: 'important' }),
        { notify: { mode: 'important', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true } });
    assert.deepEqual(normaliseNotify({ mode: 'custom', mailboxIds: ['P2F'] }),
        { notify: { mode: 'custom', senders: 'everyone', mailboxIds: ['P2F'], excludedMailboxIds: [], previews: true } });
});

// A choice sent back is never the caller's own arrays, so changing what was
// sent later cannot change what was kept
test('the kept lists are copies', () => {
    const excluded = ['P9L'];
    const { notify } = normaliseNotify({ mode: 'custom', mailboxIds: ['P2F'], excludedMailboxIds: excluded });
    excluded.push('P8K');
    assert.deepEqual(notify.excludedMailboxIds, ['P9L']);
});

test('each malformed field is refused, naming the field', () => {
    assert.match(normaliseNotify(null).error, /^notify /);
    assert.match(normaliseNotify(['inbox']).error, /^notify /);
    assert.match(normaliseNotify('inbox').error, /^notify /);
    assert.match(normaliseNotify({}).error, /^notify\.mode /);
    assert.match(normaliseNotify({ mode: 'loud' }).error, /^notify\.mode /);
    assert.match(normaliseNotify({ mode: 'custom', senders: 'friends' }).error, /^notify\.senders /);
    assert.match(normaliseNotify({ mode: 'custom', senders: null }).error, /^notify\.senders /);
    assert.match(normaliseNotify({ mode: 'custom', mailboxIds: 'P2F' }).error, /^notify\.mailboxIds /);
    assert.match(normaliseNotify({ mode: 'custom', mailboxIds: [''] }).error, /^notify\.mailboxIds /);
    assert.match(normaliseNotify({ mode: 'custom', mailboxIds: [7] }).error, /^notify\.mailboxIds /);
    const tooMany = Array.from({ length: MAX_MAILBOX_IDS + 1 }, (_, index) => `M${index}`);
    assert.match(normaliseNotify({ mode: 'custom', mailboxIds: tooMany }).error, /^notify\.mailboxIds /);
    assert.equal(normaliseNotify({ mode: 'custom', mailboxIds: tooMany.slice(1) }).notify.mailboxIds.length, MAX_MAILBOX_IDS);
});

test('a malformed excluded list is refused, naming the field', () => {
    assert.match(normaliseNotify({ mode: 'custom', excludedMailboxIds: 'P9L' }).error, /^notify\.excludedMailboxIds /);
    assert.match(normaliseNotify({ mode: 'custom', excludedMailboxIds: null }).error, /^notify\.excludedMailboxIds /);
    assert.match(normaliseNotify({ mode: 'custom', excludedMailboxIds: [''] }).error, /^notify\.excludedMailboxIds /);
    assert.match(normaliseNotify({ mode: 'custom', excludedMailboxIds: [7] }).error, /^notify\.excludedMailboxIds /);
    const tooMany = Array.from({ length: MAX_MAILBOX_IDS + 1 }, (_, index) => `M${index}`);
    assert.match(normaliseNotify({ mode: 'custom', excludedMailboxIds: tooMany }).error, /^notify\.excludedMailboxIds /);
    assert.equal(normaliseNotify({ mode: 'custom', excludedMailboxIds: tooMany.slice(1) }).notify.excludedMailboxIds.length,
        MAX_MAILBOX_IDS);
});

// Whether a banner shows the start of the text: kept as sent, on for a choice
// from before the switch, and refused as anything but true or false
test('previews are kept as sent, are on when absent, and must be true or false', () => {
    assert.equal(normaliseNotify({ mode: 'inbox', previews: false }).notify.previews, false);
    assert.equal(normaliseNotify({ mode: 'inbox' }).notify.previews, true);
    assert.equal(storedChoice({ notify: { mode: 'inbox' } }).previews, true);
    assert.equal(storedChoice({ alerts: true }).previews, true);
    for (const previews of ['no', 0, null]) {
        assert.match(normaliseNotify({ mode: 'inbox', previews }).error, /^notify\.previews /);
    }
});

test('without notify the alerts switch decides: absent or true is inbox, false is off', () => {
    assert.deepEqual(registrationChoice({}), { notify: INBOX });
    assert.deepEqual(registrationChoice({ alerts: true }), { notify: INBOX });
    assert.deepEqual(registrationChoice({ alerts: false }), { notify: OFF });
    assert.equal(registrationChoice({ alerts: 'no' }).error, 'alerts must be true or false');
    assert.equal(registrationChoice({ alerts: null }).error, 'alerts must be true or false');
});

test('with both, notify wins', () => {
    assert.deepEqual(registrationChoice({ alerts: false, notify: { mode: 'inbox' } }), { notify: INBOX });
    assert.deepEqual(registrationChoice({ alerts: true, notify: { mode: 'off' } }), { notify: OFF });
    assert.match(registrationChoice({ alerts: true, notify: { mode: 'loud' } }).error, /^notify\.mode /);
});

test('a stored record reads its notify, and an old one its alerts', () => {
    // A record from before excluded labels excludes nothing
    assert.deepEqual(storedChoice({ registeredAt: 'x', notify: { mode: 'custom', senders: 'contacts', mailboxIds: ['L1'] } }),
        { mode: 'custom', senders: 'contacts', mailboxIds: ['L1'], excludedMailboxIds: [], previews: true });
    assert.deepEqual(
        storedChoice({ registeredAt: 'x', notify: { mode: 'custom', senders: 'everyone', mailboxIds: ['L1'], excludedMailboxIds: ['L2'], previews: true } }),
        { mode: 'custom', senders: 'everyone', mailboxIds: ['L1'], excludedMailboxIds: ['L2'], previews: true });
    assert.deepEqual(storedChoice({ registeredAt: 'x', alerts: false }), OFF);
    assert.deepEqual(storedChoice({ registeredAt: 'x', alerts: true }), INBOX);
    assert.deepEqual(storedChoice({ registeredAt: 'x' }), INBOX);
    assert.deepEqual(storedChoice(undefined), INBOX);
    // A record someone edited by hand into nonsense falls back to its switch
    assert.deepEqual(storedChoice({ notify: { mode: 'loud' }, alerts: false }), OFF);
});
