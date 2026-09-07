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

test('an unreadable registry starts empty', async () => {
    const file = await scratch();
    await writeFile(file, '[[[');
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    assert.deepEqual(registry.tokens('personal'), []);
});
