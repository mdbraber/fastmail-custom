/*
Fastmail Custom Mode; head start

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
// start is how the settings panel knows there is an extension here to write
// through, before it has drawn anything.
document.documentElement.dataset.customModeHost = 'extension';

const EARLY_KEY = 'custom-mode-early';
const MODE_KEY = 'custom-mode';
// What it was called before the rename; the page script migrates it, but this
// runs first and would otherwise read nothing on the load that migrates it
const LEGACY_MODE_KEY = 'custom-inbox-mode';
const STYLE_ID = 'custom-mode-style';
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

// The chip rules only bite while the class is set, and the class only belongs
// there with the mode on
const storedMode = () => { const v = read(MODE_KEY); return v === null ? read(LEGACY_MODE_KEY) : v; };

const shouldHide = storedMode() !== '0' &&
    !!early.hide && early.hide[urlKey()] === true;

// On <html>, which also means there is nothing to wait for: at document_start
// <body> may not exist yet, but the document element always does.
if (shouldHide) {
    document.documentElement.classList.add(HIDE_CLASS);
}

/*
The settings panel runs in the page world, which has no route to extension
storage. It posts to its own window and this carries the value across.

Any script on this origin could post the same message. The origin is
Fastmail's own and none of these settings is security-sensitive, so the check
is that the message came from this window rather than a frame, and that it is
shaped like ours; nothing stronger is claimed.
*/
window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;

    const message = event.data;
    if (!message || message.source !== 'custom-mode' || message.kind !== 'setting') return;
    if (typeof message.key !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(message.key)) return;
    if (typeof message.value !== 'boolean' && typeof message.value !== 'string') return;

    // Read, merge, write: the settings live as one object, so writing a key
    // means rewriting the object, and two panels open at once would otherwise
    // undo each other.
    api.storage.local.get('settings').then((stored) => {
        const settings = Object.assign({}, stored.settings || {});
        settings[message.key] = message.value;
        return api.storage.local.set({ settings });
    }).catch((error) => {
        console.error('Custom mode: could not save a setting', error);
    });
});
