/*
Fastmail Custom Mode injector

Fastmail serves `script-src 'self' …` with no 'unsafe-inline'. A userscript
manager runs page-world code by adding an inline <script> to the page, which
that policy refuses; so Custom mode never starts.

scripting.executeScript() does not go through the DOM, so it is not the page's
script to refuse. Injecting with world "MAIN" therefore lands in the same
context the userscript wanted, with the page's CSP left exactly as it is.

This has to live in an extension: userscripts have no access to
browser.scripting. See https://github.com/quoid/userscripts/issues/954

Settings live in extension storage, which the page world cannot read, so they
are written onto the page immediately before the payload is injected. Changing
one pushes it straight to any open Fastmail tab rather than waiting for a
reload.

The settings are edited in the page, by the payload's own panel, which reaches
this storage through early.js. Nothing here knows what the settings are.
*/

const api = globalThis.browser || globalThis.chrome;

// The beta site is the same app on its own origin, so it gets the same
// treatment.
const TARGETS = ['https://app.fastmail.com/*', 'https://app.beta.fastmail.com/*'];
const TARGET_PATTERN = /^https:\/\/app\.(beta\.)?fastmail\.com\//;
const PAYLOAD = 'fastmail-custom-mode.js';

// Whatever is stored, as it is. The page carries the catalogue and every
// default, so there is nothing to merge here and nothing to keep in step:
// this script does not know which settings exist, and does not need to.
const getSettings = async () => {
    const stored = await api.storage.local.get('settings');
    return stored.settings || {};
};

const inject = async (tabId) => {
    const settings = await getSettings();

    // Settings first, so they are in place before the payload reads them
    await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (value) => { window.__customModeSettings = value; },
        args: [settings]
    });

    await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: [PAYLOAD]
    });
};

// The payload guards against running twice, so a duplicate injection is safe
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab || !tab.url || !TARGET_PATTERN.test(tab.url)) return;

    inject(tabId).catch((error) => {
        console.error('Custom mode: injection failed', error);
    });
});

// Push a changed setting to whatever is already open
api.storage.onChanged.addListener(async () => {
    const settings = await getSettings();
    const tabs = await api.tabs.query({ url: TARGETS });

    tabs.forEach((tab) => {
        api.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: (value) => {
                window.__customModeSettings = value;
                if (window.customMode) window.customMode.applySettings(value);
            },
            args: [settings]
        }).catch(() => { /* tab may not have the payload yet */ });
    });
});
