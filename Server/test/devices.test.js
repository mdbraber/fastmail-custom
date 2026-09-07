import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeviceRegistry, isDeviceToken } from '../src/devices.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'a'.repeat(64);
const scratch = async () => path.join(await mkdtemp(path.join(os.tmpdir(), 'devices-')), 'devices.json');

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
    await registry.register('work', 'b'.repeat(64));

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.tokens('personal'), [token]);
    assert.deepEqual(again.tokens('work'), ['b'.repeat(64)]);
    assert.deepEqual(again.tokens('other'), []);

    await again.remove('personal', token.toUpperCase());
    await again.remove('personal', token.toUpperCase());
    assert.deepEqual(again.tokens('personal'), []);
});

test('alerts can be turned off per device, survive a reload, and are on for records that predate the switch', async () => {
    const file = await scratch();
    const muted = 'b'.repeat(64);
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    await registry.register('personal', token);
    await registry.register('personal', muted.toUpperCase(), { alerts: false });

    assert.deepEqual(registry.tokens('personal').sort(), [token, muted].sort());
    assert.deepEqual(registry.tokens('personal', { alerts: true }), [token]);
    assert.deepEqual(registry.tokens('personal', { alerts: false }), [muted]);
    assert.deepEqual(registry.tokens('work', { alerts: false }), []);

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.tokens('personal', { alerts: false }), [muted]);

    // The switch flips back with a plain re-registration
    await again.register('personal', muted, { alerts: true });
    assert.deepEqual(again.tokens('personal', { alerts: false }), []);
    await again.register('personal', muted);
    assert.deepEqual(again.tokens('personal', { alerts: true }).sort(), [token, muted].sort());

    const legacy = await scratch();
    await writeFile(legacy, JSON.stringify({ personal: { [token]: { registeredAt: '2026-09-01T00:00:00Z' } } }));
    const old = new DeviceRegistry(legacy, silent);
    await old.load();
    assert.deepEqual(old.tokens('personal', { alerts: true }), [token]);
    assert.deepEqual(old.tokens('personal', { alerts: false }), []);
});

// Two phones registering at once, or a registration racing a prune, would
// otherwise write the same .tmp file and rename it out from under each other
test('registrations that arrive together both survive', async () => {
    const file = await scratch();
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    await Promise.all([registry.register('personal', token), registry.register('personal', 'b'.repeat(64))]);

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.tokens('personal').sort(), [token, 'b'.repeat(64)].sort());
});

test('an unreadable registry starts empty', async () => {
    const file = await scratch();
    await writeFile(file, '[[[');
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    assert.deepEqual(registry.tokens('personal'), []);
});
