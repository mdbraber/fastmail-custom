import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// What an account remembers between runs: where in Fastmail's change log it
// is, which messages it already announced, the last badge it sent, and which
// messages have a banner on which devices, so a banner can be taken off again
// once its message is read.

export const NOTIFIED_CAP = 500;
export const SHOWN_CAP = 200;

export function emptyState() {
    return { emailState: null, notified: [], badge: null, shown: [] };
}

const readShown = (value) => (Array.isArray(value) ? value : [])
    .filter((entry) => entry && typeof entry.id === 'string' && Array.isArray(entry.tokens))
    .map(({ id, tokens }) => ({ id, tokens: tokens.filter((token) => typeof token === 'string') }));

export async function loadState(dataDir, account, log = console) {
    try {
        const parsed = JSON.parse(await readFile(statePath(dataDir, account), 'utf8'));
        return {
            ...emptyState(),
            ...parsed,
            notified: Array.isArray(parsed.notified) ? parsed.notified.filter((id) => typeof id === 'string') : [],
            shown: readShown(parsed.shown),
        };
    } catch (error) {
        if (error.code !== 'ENOENT') log.warn(`[${account}] state unreadable (${error.message}); starting over`);
        return emptyState();
    }
}

export async function saveState(dataDir, account, state) {
    await mkdir(dataDir, { recursive: true });
    const file = statePath(dataDir, account);
    const trimmed = { ...state, notified: state.notified.slice(-NOTIFIED_CAP), shown: (state.shown ?? []).slice(-SHOWN_CAP) };
    await writeFile(`${file}.tmp`, JSON.stringify(trimmed, null, 2));
    await rename(`${file}.tmp`, file);
}

export function rememberNotified(state, ids) {
    const fresh = ids.filter((id) => !state.notified.includes(id));
    return { ...state, notified: state.notified.concat(fresh).slice(-NOTIFIED_CAP) };
}

// `banners`: message id → the device tokens it was just shown on.
export function rememberShown(state, banners) {
    const shown = (state.shown ?? []).map((entry) => ({ ...entry, tokens: [...entry.tokens] }));
    for (const [id, tokens] of banners) {
        let entry = shown.find((one) => one.id === id);
        if (!entry) {
            entry = { id, tokens: [] };
            shown.push(entry);
        }
        for (const token of tokens) if (!entry.tokens.includes(token)) entry.tokens.push(token);
    }
    return { ...state, shown: shown.slice(-SHOWN_CAP) };
}

export function forgetShown(state, ids) {
    return { ...state, shown: (state.shown ?? []).filter((entry) => !ids.includes(entry.id)) };
}

function statePath(dataDir, account) {
    return path.join(dataDir, `state-${account}.json`);
}
