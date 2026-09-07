import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyState, loadState, saveState, rememberNotified, NOTIFIED_CAP } from '../src/state.js';

const silent = { warn() {}, info() {}, error() {} };
const scratch = () => mkdtemp(path.join(os.tmpdir(), 'state-'));

test('a missing file is an empty state', async () => {
    const dir = await scratch();
    assert.deepEqual(await loadState(dir, 'personal', silent), emptyState());
});

test('state round-trips through disk', async () => {
    const dir = await scratch();
    await saveState(dir, 'personal', { emailState: 's42', notified: ['M1', 'M2'], badge: 7 });
    assert.deepEqual(await loadState(dir, 'personal', silent), { emailState: 's42', notified: ['M1', 'M2'], badge: 7 });
    assert.equal(JSON.parse(await readFile(path.join(dir, 'state-personal.json'), 'utf8')).badge, 7);
});

test('an unreadable file starts over rather than crashing', async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, 'state-work.json'), '{ not json');
    assert.deepEqual(await loadState(dir, 'work', silent), emptyState());
});

test('remembered ids are appended once and capped', () => {
    const state = rememberNotified({ ...emptyState(), notified: ['M1'] }, ['M1', 'M2']);
    assert.deepEqual(state.notified, ['M1', 'M2']);
    const many = Array.from({ length: NOTIFIED_CAP + 10 }, (_, i) => `M${i}`);
    const capped = rememberNotified(emptyState(), many);
    assert.equal(capped.notified.length, NOTIFIED_CAP);
    assert.equal(capped.notified.at(-1), `M${NOTIFIED_CAP + 9}`);
});
