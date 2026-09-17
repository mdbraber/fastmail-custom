import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyState, loadState, saveState, rememberNotified, rememberShown, forgetShown, NOTIFIED_CAP, SHOWN_CAP } from '../src/state.js';

const silent = { warn() {}, info() {}, error() {} };
const scratch = () => mkdtemp(path.join(os.tmpdir(), 'state-'));

test('a missing file is an empty state', async () => {
    const dir = await scratch();
    assert.deepEqual(await loadState(dir, 'personal', silent), emptyState());
});

test('state round-trips through disk', async () => {
    const dir = await scratch();
    const shown = [{ id: 'M1', tokens: ['tok1'] }];
    await saveState(dir, 'personal', { emailState: 's42', notified: ['M1', 'M2'], badge: 7, shown });
    assert.deepEqual(await loadState(dir, 'personal', silent), { emailState: 's42', notified: ['M1', 'M2'], badge: 7, shown });
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

test('a state from before banners were tracked loads with none shown', async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, 'state-work.json'), JSON.stringify({ emailState: 's1', notified: ['M1'], badge: 2 }));
    assert.deepEqual((await loadState(dir, 'work', silent)).shown, []);
    await writeFile(path.join(dir, 'state-work.json'), JSON.stringify({ emailState: 's1', notified: [], shown: [{ id: 'M1' }, 'x', { id: 'M2', tokens: ['t', 3] }] }));
    assert.deepEqual((await loadState(dir, 'work', silent)).shown, [{ id: 'M2', tokens: ['t'] }]);
});

test('shown banners gather their devices, are forgotten by id, and are capped', () => {
    let state = rememberShown(emptyState(), new Map([['M1', ['tok1']]]));
    state = rememberShown(state, new Map([['M1', ['tok2', 'tok1']], ['M2', ['tok1']]]));
    assert.deepEqual(state.shown, [{ id: 'M1', tokens: ['tok1', 'tok2'] }, { id: 'M2', tokens: ['tok1'] }]);
    assert.deepEqual(forgetShown(state, ['M1']).shown, [{ id: 'M2', tokens: ['tok1'] }]);
    const many = new Map(Array.from({ length: SHOWN_CAP + 5 }, (_, i) => [`M${i}`, ['t']]));
    const capped = rememberShown(emptyState(), many);
    assert.equal(capped.shown.length, SHOWN_CAP);
    assert.equal(capped.shown.at(-1).id, `M${SHOWN_CAP + 4}`);
});
