import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeviceRegistry, isDeviceToken } from '../src/devices.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'a'.repeat(64);
const other = 'b'.repeat(64);
const scratch = async () => path.join(await mkdtemp(path.join(os.tmpdir(), 'devices-')), 'devices.json');
const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [] };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [], excludedMailboxIds: [] };

test('a device token is hex of a plausible length', () => {
    assert.equal(isDeviceToken(token), true);
    assert.equal(isDeviceToken(token.toUpperCase()), true);
    assert.equal(isDeviceToken('abc'), false);
    assert.equal(isDeviceToken('z'.repeat(64)), false);
    assert.equal(isDeviceToken(42), false);
});

test('registrations persist, per account, and can be removed', async () => {
    const file = await scratch();
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    await registry.register('personal', token.toUpperCase());
    await registry.register('work', other);

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.tokens('personal'), [token]);
    assert.deepEqual(again.tokens('work'), [other]);
    assert.deepEqual(again.tokens('other'), []);

    await again.remove('personal', token.toUpperCase());
    await again.remove('personal', token.toUpperCase());
    assert.deepEqual(again.tokens('personal'), []);
});

test('each device keeps its own choice, stored as notify, across a reload', async () => {
    const file = await scratch();
    const custom = { mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'], excludedMailboxIds: ['P9L'] };
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    await registry.register('personal', token);
    await registry.register('personal', other.toUpperCase(), { notify: custom });

    assert.deepEqual(registry.entries('personal'), [{ token, notify: INBOX }, { token: other, notify: custom }]);
    assert.deepEqual(registry.entries('work'), []);

    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(Object.keys(stored.personal[other]).sort(), ['notify', 'registeredAt']);
    assert.deepEqual(stored.personal[other].notify, custom);

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.entries('personal'), [{ token, notify: INBOX }, { token: other, notify: custom }]);

    // Registering again replaces the choice
    await again.register('personal', other, { notify: OFF });
    assert.deepEqual(again.entries('personal')[1], { token: other, notify: OFF });
});

test('a registry file from before notify reads its alerts as inbox or off, without being rewritten', async () => {
    const legacy = await scratch();
    const text = JSON.stringify({
        personal: {
            [token]: { registeredAt: '2026-09-01T00:00:00Z' },
            [other]: { registeredAt: '2026-09-02T00:00:00Z', alerts: false },
        },
        work: { ['c'.repeat(64)]: { registeredAt: '2026-09-03T00:00:00Z', alerts: true } },
    }, null, 2);
    await writeFile(legacy, text);
    const old = new DeviceRegistry(legacy, silent);
    await old.load();
    assert.deepEqual(old.entries('personal'), [{ token, notify: INBOX }, { token: other, notify: OFF }]);
    assert.deepEqual(old.entries('work'), [{ token: 'c'.repeat(64), notify: INBOX }]);
    assert.equal(await readFile(legacy, 'utf8'), text);
});

// Two phones registering at once, or a registration racing a prune, would
// otherwise write the same .tmp file and rename it out from under each other
test('registrations that arrive together both survive', async () => {
    const file = await scratch();
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    await Promise.all([registry.register('personal', token), registry.register('personal', other)]);

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.tokens('personal').sort(), [token, other].sort());
});

test('an unreadable registry starts empty', async () => {
    const file = await scratch();
    await writeFile(file, '[[[');
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    assert.deepEqual(registry.tokens('personal'), []);
});
