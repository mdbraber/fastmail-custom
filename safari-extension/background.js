/*
Fastmail Inbox mode injector

Fastmail serves `script-src 'self' …` with no 'unsafe-inline'. A userscript
manager runs page-world code by adding an inline <script> to the page, which
that policy refuses — so Inbox mode never starts.

scripting.executeScript() does not go through the DOM, so it is not the page's
script to refuse. Injecting with world "MAIN" therefore lands in the same
context the userscript wanted, with the page's CSP left exactly as it is.

This has to live in an extension: userscripts have no access to
browser.scripting. See https://github.com/quoid/userscripts/issues/954

Settings live in extension storage, which the page world cannot read, so they
are written onto the page immediately before the payload is injected. Changing
one pushes it straight to any open Fastmail tab rather than waiting for a
reload.
*/

const api = globalThis.browser || globalThis.chrome;

// The beta site is the same app on its own origin, so it gets the same
// treatment. Both are named outright rather than matched with a subdomain
// wildcard, which would take in the marketing site and everything else on
// fastmail.com along with them.
const TARGETS = ['https://app.fastmail.com/*', 'https://app.beta.fastmail.com/*'];
const TARGET_PATTERN = /^https:\/\/app\.(beta\.)?fastmail\.com\//;
const PAYLOAD = 'fastmail-inbox-mode.js';

// Kept in step with the userscript's DEFAULT_SETTINGS and settings.js
const DEFAULT_SETTINGS = {
    labelColours: true,
    labelColoursSidebarOnly: true,
    labelColoursSkipTriage: true,
    dragAdditive: true,
    hideInboxLabel: true,
    stripLabelPrefix: true,
    labelsShortcut: true,
    labelsSidebarOnly: true,
    labelsAutoSave: true,
    triageLabel: 'Triage',
    snoozeKey: 'w',
    snoozeDefault: '2w',
    snoozeTime: '08:00',
    urgentKey: 's',
    bottomBarSlots: 'Snooze, Pin, Archive, Labels, File, Delete, Move',
    excludedLabels: 'Later',
    contactGroupLabels: '',
    appBadgeLabel: 'Triage',
    swapArchiveExpand: true,
    sidebarSeparators: true,
    hideLoneExpando: true
};

const getSettings = async () => {
    const stored = await api.storage.local.get('settings');
    return Object.assign({}, DEFAULT_SETTINGS, stored.settings || {});
};

// Settings saved under 2.x keep keys 3.0 no longer has, and two whose
// default moved: the badge label was Inbox, the bar had nine slots. Once,
// on the first run of 3.0, a stored value still equal to its 2.x default
// takes the 3.0 default and unknown keys are dropped; anything the user
// set on purpose stays. The version mark keeps this from running twice.
const SETTINGS_VERSION = 3;
const LEGACY_DEFAULTS = {
    appBadgeLabel: 'Inbox',
    bottomBarSlots: 'Snooze, Pin, Archive, Labels, Keep, Waiting, Someday, Delete, Move'
};

const migrateSettings = async () => {
    const stored = await api.storage.local.get(['settings', 'settingsVersion']);
    if (stored.settingsVersion === SETTINGS_VERSION) return;

    const next = {};
    Object.keys(stored.settings || {}).forEach((key) => {
        if (!(key in DEFAULT_SETTINGS)) return;
        const value = stored.settings[key];
        next[key] = (key in LEGACY_DEFAULTS && value === LEGACY_DEFAULTS[key])
            ? DEFAULT_SETTINGS[key]
            : value;
    });
    await api.storage.local.set({ settings: next, settingsVersion: SETTINGS_VERSION });
};

migrateSettings().catch((error) => {
    console.error('Inbox mode: could not migrate settings', error);
});

const inject = async (tabId) => {
    const settings = await getSettings();

    // Settings first, so they are in place before the payload reads them
    await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (value) => { window.__customInboxModeSettings = value; },
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
        console.error('Inbox mode: injection failed', error);
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
                window.__customInboxModeSettings = value;
                if (window.customInboxMode) window.customInboxMode.applySettings(value);
            },
            args: [settings]
        }).catch(() => { /* tab may not have the payload yet */ });
    });
});
