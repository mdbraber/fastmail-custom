import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// What an account remembers between runs: where in Fastmail's change log it
// is, which messages it already announced, and the last badge it sent.
// Written whole and renamed into place, so a crash mid-write leaves the
// old file rather than half of the new one.

export const NOTIFIED_CAP = 500;

export function emptyState() {
    return { emailState: null, notified: [], badge: null };
}

export async function loadState(dataDir, account, log = console) {
    try {
        const parsed = JSON.parse(await readFile(statePath(dataDir, account), 'utf8'));
        return {
            ...emptyState(),
            ...parsed,
            notified: Array.isArray(parsed.notified) ? parsed.notified.filter((id) => typeof id === 'string') : [],
        };
    } catch (error) {
        if (error.code !== 'ENOENT') log.warn(`[${account}] state unreadable (${error.message}); starting over`);
        return emptyState();
    }
}

export async function saveState(dataDir, account, state) {
    await mkdir(dataDir, { recursive: true });
    const file = statePath(dataDir, account);
    const trimmed = { ...state, notified: state.notified.slice(-NOTIFIED_CAP) };
    await writeFile(`${file}.tmp`, JSON.stringify(trimmed, null, 2));
    await rename(`${file}.tmp`, file);
}

export function rememberNotified(state, ids) {
    const fresh = ids.filter((id) => !state.notified.includes(id));
    return { ...state, notified: state.notified.concat(fresh).slice(-NOTIFIED_CAP) };
}

function statePath(dataDir, account) {
    return path.join(dataDir, `state-${account}.json`);
}
