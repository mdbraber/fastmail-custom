/*
Fastmail Custom; head start

The payload runs in the page world, which means waiting for the document to be
complete and then for Fastmail itself to be ready. Fastmail paints its first
message rows before that, so on a fresh load they arrive unstyled: the Inbox
chip appears and then vanishes, and label colours turn up late.

Neither the stylesheet nor the body class needs Fastmail once the payload has
worked them out, so it leaves both in localStorage and this replays them at
document_start; before there is anything on screen to correct. A content
script is enough: only the JavaScript world is isolated, while localStorage is
scoped to the origin and therefore shared with the page.

Anything replayed wrongly, a view opened for the first time, a label recoloured
in another tab; is corrected by the payload a moment later. The worst case is
the flash this exists to remove, which is where we started.
*/

const api = globalThis.browser || globalThis.chrome;

// The page world cannot see this content script, and cannot see extension
// storage either; but both see the DOM. Stamping the root element at document
// start is how the settings page knows there is an extension here to write
// through, before it has drawn anything.
document.documentElement.dataset.fastmailCustomHost = 'extension';

const EARLY_KEY = 'fastmail-custom-early';
const STYLE_ID = 'fastmail-custom-style';
const HIDE_CLASS = 'custom-hideInboxLabel';

// Must match earlyUrlKey in the payload exactly, or nothing is ever found
const urlKey = () => {
    const params = new URLSearchParams(location.search);
    return [
        location.pathname,
        params.get('filter') || '',
        params.get('u') || ''
    ].join('|');
};

const read = (key) => {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        // Storage can be disabled; then there is simply no head start
        return null;
    }
};

let early;
try {
    early = JSON.parse(read(EARLY_KEY)) || {};
} catch (error) {
    early = {};
}

// <head> may not have been parsed yet. A style element applies from anywhere in
// the document, and the payload finds it by id and takes it over from there.
if (early.css) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = early.css;
    document.documentElement.appendChild(style);
}

// The chip rules only bite while the class is set
const shouldHide = !!early.hide && early.hide[urlKey()] === true;

// On <html>, which also means there is nothing to wait for: at document_start
// <body> may not exist yet, but the document element always does.
if (shouldHide) {
    document.documentElement.classList.add(HIDE_CLASS);
}

// Each write is a read, a merge and a write, so two in flight at once
// would let the second read a value the first had not yet committed and
// drop it. One panel is enough to cause that: its text fields each debounce
// on their own timer and its checkboxes write at once. Chaining the writes
// keeps them in order at the cost of nothing that matters here — these are
// single keystrokes' worth of work, arriving at human speed.
let pendingWrite = Promise.resolve();

/*
The settings page runs in the page world, which has no route to extension
storage. It posts to its own window and this carries the value across.

Any script on this origin could post the same message. The origin is
Fastmail's own and none of these settings is security-sensitive, so the check
is that the message came from this window rather than a frame, and that it is
shaped like ours; nothing stronger is claimed.

Three kinds arrive. A setting is saved here, under the Fastmail account the
page said it is, and the background script is told, so that it can send the
setting to iCloud. The account itself, and the page's "Sync settings with
iCloud" switch, go to the background script, which keeps them.
*/

// Must match background.js and SettingsSyncRules.swift; SettingsParityTests
// reads this line.
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// The account this page said it is; nothing until it has said
let pageAccountId = null;

// A background script that is asleep is woken by the message. One that cannot
// be reached costs the sync and never the setting, which is saved first.
const tellBackground = (message) => {
    try {
        const sent = api.runtime.sendMessage(message);
        if (sent && typeof sent.catch === 'function') sent.catch(() => {});
    } catch (error) {
        // The extension was reloaded under this page; the next load syncs
    }
};

const saveSetting = (key, value) => api.storage.local
    .get(['settings', 'settingsByAccount', 'lastAccountId'])
    .then((stored) => {
        // A write before the page has said its account goes to the last
        // account any page said, or to the plain set when there is none
        const remembered = typeof stored.lastAccountId === 'string' &&
            ACCOUNT_ID_PATTERN.test(stored.lastAccountId) ? stored.lastAccountId : null;
        const accountId = pageAccountId || remembered;

        if (!accountId) {
            const settings = Object.assign({}, stored.settings || {});
            settings[key] = value;
            return api.storage.local.set({ settings });
        }

        // An account's first write starts from the plain set, as the
        // background script starts an account it sees for the first time
        const byAccount = Object.assign({}, stored.settingsByAccount || {});
        const own = Object.assign({}, byAccount[accountId] || stored.settings || {});
        own[key] = value;
        byAccount[accountId] = own;
        return api.storage.local.set({ settingsByAccount: byAccount })
            .then(() => tellBackground({ kind: 'setting', accountId, key, value }));
    });

window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;

    const message = event.data;
    if (!message || message.source !== 'fastmail-custom') return;

    if (message.kind === 'account') {
        if (typeof message.accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(message.accountId)) return;
        pageAccountId = message.accountId;
        tellBackground({ kind: 'account', accountId: message.accountId });
        return;
    }

    if (message.kind === 'sync') {
        if (typeof message.enabled !== 'boolean') return;
        tellBackground({ kind: 'sync', enabled: message.enabled });
        return;
    }

    if (message.kind !== 'setting') return;
    if (typeof message.key !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(message.key)) return;
    if (typeof message.value !== 'boolean' && typeof message.value !== 'string') return;

    // Chain this write onto the pending promise to serialize all writes.
    pendingWrite = pendingWrite.then(() => saveSetting(message.key, message.value)).catch((error) => {
        console.error('Fastmail Custom: could not save a setting', error);
    });
});
