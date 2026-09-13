import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressSets } from '../src/contacts.js';

const card = (uid, addresses, over = {}) => ({
    id: `id-${uid}`,
    uid,
    kind: 'individual',
    emails: Object.fromEntries(addresses.map((address, index) => [`e${index}`, { address }])),
    ...over,
});

test('every address on a card that is not a group is a contact, lowercased', () => {
    const { contacts, vips } = addressSets([
        card('ada', ['Ada@Example.net', ' ada@work.example ']),
        card('bob', ['bob@example.net']),
        card('team', ['team@example.net'], { kind: 'group', members: { ada: true } }),
        card('org', ['info@example.org'], { kind: 'org' }),
        { id: 'id-bare', uid: 'bare' },
    ]);
    assert.deepEqual([...contacts].sort(), ['ada@example.net', 'ada@work.example', 'bob@example.net', 'info@example.org']);
    assert.deepEqual([...vips], []);
});

test('a card without a kind is an individual', () => {
    const { contacts } = addressSets([{ id: 'x', uid: 'x', emails: { e: { address: 'x@example.net' } } }]);
    assert.deepEqual([...contacts], ['x@example.net']);
});

test('VIPs are the addresses on the cards the vips group names by uid', () => {
    const { contacts, vips } = addressSets([
        card('ada', ['ada@example.net']),
        card('bob', ['bob@example.net']),
        card('cy', ['cy@example.net']),
        card('vips', [], { id: 'not-the-uid', kind: 'group', members: { ada: true, 'id-bob': true, cy: false } }),
    ]);
    assert.deepEqual([...vips], ['ada@example.net']);
    assert.deepEqual([...contacts].sort(), ['ada@example.net', 'bob@example.net', 'cy@example.net']);
});

test('a card named vips that is not a group is not the VIPs group', () => {
    const { vips } = addressSets([
        card('ada', ['ada@example.net']),
        card('vips', ['someone@example.net'], { members: { ada: true } }),
    ]);
    assert.deepEqual([...vips], []);
});

test('no cards, no addresses', () => {
    const { contacts, vips } = addressSets([]);
    assert.equal(contacts.size, 0);
    assert.equal(vips.size, 0);
});

test('malformed cards, emails and members are skipped, not thrown on', () => {
    const messy = [
        {
            id: 'id-ada',
            uid: 'ada',
            kind: 'individual',
            emails: {
                e0: {},
                e1: { address: 42 },
                e2: null,
                e3: { address: '   ' },
                e4: { address: '  Ada@Example.NET ' },
            },
        },
        { id: 'id-null-emails', uid: 'null-emails', kind: 'individual', emails: null },
        { id: 'id-no-emails', uid: 'no-emails', kind: 'individual' },
        {
            id: 'id-vips',
            uid: 'vips',
            kind: 'group',
            members: { ada: true, ghost: true, blank: null },
        },
        null,
    ];
    let result;
    assert.doesNotThrow(() => { result = addressSets(messy); });
    assert.deepEqual([...result.contacts], ['ada@example.net']);
    assert.deepEqual([...result.vips], ['ada@example.net']);

    // A vips group whose members is null outright, not an object, also
    // survives, contributing no members.
    const nullMembers = addressSets([
        { id: 'id-ada', uid: 'ada', kind: 'individual', emails: { e0: { address: 'ada@example.net' } } },
        { id: 'id-vips', uid: 'vips', kind: 'group', members: null },
    ]);
    assert.deepEqual([...nullMembers.vips], []);
});
