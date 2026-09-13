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
