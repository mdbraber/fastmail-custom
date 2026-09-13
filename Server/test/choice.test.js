import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MAILBOX_IDS, normaliseNotify, registrationChoice, storedChoice } from '../src/choice.js';

const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [] };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [] };

test('a full choice is kept as sent', () => {
    assert.deepEqual(
        normaliseNotify({ mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'] }),
        { notify: { mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'] } },
    );
});

test('senders and mailboxIds are filled in when absent', () => {
    assert.deepEqual(normaliseNotify({ mode: 'important' }), { notify: { mode: 'important', senders: 'everyone', mailboxIds: [] } });
    assert.deepEqual(normaliseNotify({ mode: 'custom', mailboxIds: [] }), { notify: { mode: 'custom', senders: 'everyone', mailboxIds: [] } });
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
    assert.deepEqual(storedChoice({ registeredAt: 'x', notify: { mode: 'custom', senders: 'contacts', mailboxIds: ['L1'] } }),
        { mode: 'custom', senders: 'contacts', mailboxIds: ['L1'] });
    assert.deepEqual(storedChoice({ registeredAt: 'x', alerts: false }), OFF);
    assert.deepEqual(storedChoice({ registeredAt: 'x', alerts: true }), INBOX);
    assert.deepEqual(storedChoice({ registeredAt: 'x' }), INBOX);
    assert.deepEqual(storedChoice(undefined), INBOX);
    // A record someone edited by hand into nonsense falls back to its switch
    assert.deepEqual(storedChoice({ notify: { mode: 'loud' }, alerts: false }), OFF);
});
