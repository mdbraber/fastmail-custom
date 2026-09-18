import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    selectFresh, senderAddress, matchesChoice, senderName, alertPayload, badgePayload, threadURL,
} from '../src/notify.js';

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

// The choices below decide where a message has to be; before them, only
// whether it is news at all.
test('fresh means unseen, not a draft and not announced, wherever the message is', () => {
    const candidates = [
        email({ id: 'filed', mailboxIds: { 'mbx-other': true } }),
        email({ id: 'seen', keywords: { $seen: true } }),
        email({ id: 'draft', keywords: { $draft: true } }),
        email({ id: 'done' }),
        email({ id: 'new' }),
    ];
    assert.deepEqual(selectFresh(candidates, { notified: new Set(['done']) }).map((e) => e.id), ['filed', 'new']);
});

test('the sender address is the first from, lowercased, or nothing', () => {
    assert.equal(senderAddress(email({ from: [{ name: 'Ada', email: 'Ada@Example.NET' }, { email: 'b@example.net' }] })), 'ada@example.net');
    assert.equal(senderAddress(email({ from: [] })), null);
    assert.equal(senderAddress(email({ from: null })), null);
    assert.equal(senderAddress(email({ from: [{ name: 'No address' }] })), null);
});

test('the sender address is trimmed before it is lowercased, and an all-blank address is none', () => {
    assert.equal(senderAddress(email({ from: [{ name: 'Ada', email: ' Ada@Example.NET ' }] })), 'ada@example.net');
    assert.equal(senderAddress(email({ from: [{ name: 'Blank', email: '   ' }] })), null);
});

const JUNK = 'mbx-junk';
const TRASH = 'mbx-trash';
const LABEL = 'mbx-label';
const OTHER_LABEL = 'mbx-label-2';
const context = (over = {}) => ({
    inboxId: inbox,
    junkId: JUNK,
    trashId: TRASH,
    vips: new Set(['vip@example.net']),
    contacts: new Set(['vip@example.net', 'friend@example.net']),
    followedThreadIds: new Set(),
    ...over,
});
const from = (address) => [{ name: 'Someone', email: address }];
const choice = (mode, over = {}) => ({ mode, senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], ...over });

test('off never matches', () => {
    assert.equal(matchesChoice(choice('off'), email({ from: from('vip@example.net') }), context()), false);
    assert.equal(matchesChoice(choice('off'), email({ keywords: { $followed: true } }), context()), false);
});

test('an unknown or missing choice matches nothing', () => {
    assert.equal(matchesChoice({ mode: 'loud' }, email(), context()), false);
    assert.equal(matchesChoice(undefined, email(), context()), false);
});

test('inbox matches what is in the Inbox, from anyone, and nothing else', () => {
    assert.equal(matchesChoice(choice('inbox'), email({ from: from('stranger@example.net') }), context()), true);
    assert.equal(matchesChoice(choice('inbox'), email({ mailboxIds: { [LABEL]: true } }), context()), false);
});

test('important matches a VIP anywhere but Junk and Trash', () => {
    const vip = { from: from('vip@example.net') };
    assert.equal(matchesChoice(choice('important'), email(vip), context()), true);
    assert.equal(matchesChoice(choice('important'), email({ ...vip, mailboxIds: { [LABEL]: true } }), context()), true);
    assert.equal(matchesChoice(choice('important'), email({ ...vip, mailboxIds: { [JUNK]: true } }), context()), false);
    assert.equal(matchesChoice(choice('important'), email({ ...vip, mailboxIds: { [TRASH]: true } }), context()), false);
    assert.equal(matchesChoice(choice('important'), email({ from: from('friend@example.net') }), context()), false);
    assert.equal(matchesChoice(choice('important'), email({ from: [] }), context()), false);
});

test('important matches a followed conversation, by the message itself or another in its thread', () => {
    const stranger = { from: from('stranger@example.net') };
    assert.equal(matchesChoice(choice('important'), email({ ...stranger, keywords: { $followed: true } }), context()), true);
    assert.equal(matchesChoice(choice('important'), email(stranger), context({ followedThreadIds: new Set(['T1']) })), true);
    assert.equal(matchesChoice(choice('important'), email(stranger), context({ followedThreadIds: new Set(['T2']) })), false);
});

test('an account without Junk or Trash still lets a VIP through', () => {
    const vip = email({ from: from('vip@example.net') });
    assert.equal(matchesChoice(choice('important'), vip, context({ junkId: null, trashId: null })), true);
});

test('custom needs one of its labels', () => {
    const custom = choice('custom', { mailboxIds: [LABEL, OTHER_LABEL] });
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [OTHER_LABEL]: true } }), context()), true);
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [inbox]: true } }), context()), false);
});

test('custom with an empty label list matches nothing', () => {
    assert.equal(matchesChoice(choice('custom'), email({ from: from('vip@example.net') }), context()), false);
});

// Inbox included and Later excluded: what is in the Inbox, unless it is also
// under Later
test('custom skips a message that carries any excluded label', () => {
    const LATER = 'mbx-later';
    const custom = choice('custom', { mailboxIds: [inbox], excludedMailboxIds: [OTHER_LABEL, LATER] });
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [inbox]: true } }), context()), true);
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [inbox]: true, [LATER]: true } }), context()), false);
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [inbox]: true, [OTHER_LABEL]: true } }), context()), false);
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [LATER]: true } }), context()), false);
    // A label not set to true is not carried
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [inbox]: true, [LATER]: false } }), context()), true);
});

test('a label both included and excluded is excluded', () => {
    const both = choice('custom', { mailboxIds: [LABEL, OTHER_LABEL], excludedMailboxIds: [LABEL] });
    assert.equal(matchesChoice(both, email({ mailboxIds: { [LABEL]: true } }), context()), false);
    assert.equal(matchesChoice(both, email({ mailboxIds: { [OTHER_LABEL]: true } }), context()), true);
});

test('an excluded label stops a message whoever sent it', () => {
    const vips = choice('custom', { mailboxIds: [inbox], excludedMailboxIds: [LABEL], senders: 'vips' });
    assert.equal(matchesChoice(vips, email({ from: from('vip@example.net') }), context()), true);
    assert.equal(matchesChoice(vips, email({ mailboxIds: { [inbox]: true, [LABEL]: true }, from: from('vip@example.net') }), context()), false);
});

// The app keeps both lists when another choice is picked, so they may come
// along with it; only Custom reads them
test('excluded labels count only for custom', () => {
    const inInboxAndLabel = { mailboxIds: { [inbox]: true, [LABEL]: true } };
    assert.equal(matchesChoice(choice('inbox', { excludedMailboxIds: [LABEL] }), email(inInboxAndLabel), context()), true);
    assert.equal(
        matchesChoice(choice('important', { excludedMailboxIds: [LABEL] }), email({ ...inInboxAndLabel, from: from('vip@example.net') }), context()),
        true,
    );
});

test('custom senders: everyone, contacts, or VIPs', () => {
    const inLabel = (address) => email({ mailboxIds: { [LABEL]: true }, from: from(address) });
    const everyone = choice('custom', { mailboxIds: [LABEL] });
    const contacts = choice('custom', { mailboxIds: [LABEL], senders: 'contacts' });
    const vips = choice('custom', { mailboxIds: [LABEL], senders: 'vips' });

    assert.equal(matchesChoice(everyone, inLabel('stranger@example.net'), context()), true);
    assert.equal(matchesChoice(everyone, email({ mailboxIds: { [LABEL]: true }, from: [] }), context()), true);

    assert.equal(matchesChoice(contacts, inLabel('friend@example.net'), context()), true);
    assert.equal(matchesChoice(contacts, inLabel('vip@example.net'), context()), true);
    assert.equal(matchesChoice(contacts, inLabel('stranger@example.net'), context()), false);
    assert.equal(matchesChoice(contacts, email({ mailboxIds: { [LABEL]: true }, from: [] }), context()), false);

    assert.equal(matchesChoice(vips, inLabel('vip@example.net'), context()), true);
    assert.equal(matchesChoice(vips, inLabel('friend@example.net'), context()), false);
});

test('a sender written in capitals is still a VIP and a contact', () => {
    const shouted = { from: from('VIP@Example.NET') };
    assert.equal(matchesChoice(choice('important'), email(shouted), context()), true);
    assert.equal(matchesChoice(choice('custom', { mailboxIds: [inbox], senders: 'contacts' }), email(shouted), context()), true);
});

test('without contacts access the sets are empty and those rules match nobody', () => {
    const empty = context({ vips: new Set(), contacts: new Set() });
    assert.equal(matchesChoice(choice('important'), email({ from: from('vip@example.net') }), empty), false);
    assert.equal(matchesChoice(choice('custom', { mailboxIds: [inbox], senders: 'vips' }), email(), empty), false);
    assert.equal(matchesChoice(choice('custom', { mailboxIds: [inbox], senders: 'contacts' }), email(), empty), false);
    assert.equal(matchesChoice(choice('inbox'), email(), empty), true);
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
            category: 'message',
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

// With the start of the text, the banner reads like Mail's: who, what about,
// and how it begins, on one line however the message was laid out.
test('a preview becomes the body, and the subject moves up to the subtitle', () => {
    const payload = alertPayload(email({ preview: '  Dear Charles,\n\nThe  engine\tworks.  ' }), { badge: null });
    assert.deepEqual(payload.aps.alert, {
        title: 'Ada Lovelace',
        subtitle: 'Engines',
        body: 'Dear Charles, The engine works.',
    });
    const untitled = alertPayload(email({ subject: '', preview: 'Hello' }), { badge: null });
    assert.equal(untitled.aps.alert.subtitle, '(no subject)');
    assert.equal(untitled.aps.alert.body, 'Hello');
});

test('a message with no text keeps the subject as the body', () => {
    for (const preview of [undefined, null, '', '  \n ']) {
        const alert = alertPayload(email({ preview }), { badge: null }).aps.alert;
        assert.deepEqual(alert, { title: 'Ada Lovelace', body: 'Engines' });
    }
});

test('a device that asked for no previews gets the subject as the body', () => {
    const alert = alertPayload(email({ preview: 'Dear Charles' }), { badge: null, previews: false }).aps.alert;
    assert.deepEqual(alert, { title: 'Ada Lovelace', body: 'Engines' });
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
// segment with no dot in it as a message id on its own.
test('the link names the message inside the thread, not the thread alone', () => {
    const url = threadURL(email());
    assert.equal(url, 'https://app.fastmail.com/mail/Inbox/T1.M1');
    assert.equal(alertPayload(email(), { badge: null }).url, url);

    // Both halves are there and in that order: thread first, then message
    const segment = url.slice(url.lastIndexOf('/') + 1);
    assert.deepEqual(segment.split('.'), ['T1', 'M1']);
});

// The Inbox is where a banner lands, whatever else the message carries: it is
// the list the mail arrived in, and the same one every time.
test('a message opens in the Inbox whatever labels it carries', () => {
    const triage = 'mbx-triage';
    const waiting = email({ mailboxIds: { [inbox]: true, [triage]: true } });

    assert.equal(threadURL(waiting), 'https://app.fastmail.com/mail/Inbox/T1.M1');
    assert.equal(
        alertPayload(waiting, { badge: 2, context: { id: triage, label: 'Triage' } }).url,
        'https://app.fastmail.com/mail/Inbox/T1.M1',
    );
    assert.equal(threadURL(email()), 'https://app.fastmail.com/mail/Inbox/T1.M1');
});


// Buttons on a notification come from a category the app registers under this
// name.
test('an alert names the category whose buttons the app registered', () => {
    const payload = alertPayload(email(), { badge: 1 });
    assert.equal(payload.aps.category, 'message');
    // The button needs to say which message it is acting on
    assert.equal(payload.emailId, 'M1');
});

test('a dismissal wakes the app without showing anything, and names the messages', async () => {
    const { dismissPayload } = await import('../src/notify.js');
    assert.deepEqual(dismissPayload(['M1', 'M2']), { aps: { 'content-available': 1 }, dismiss: ['M1', 'M2'] });
});
