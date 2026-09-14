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

Settings sync. Each Fastmail account keeps a set of its own, and the set
follows the account to the Personal and Work apps on other devices through
iCloud. The page reports its account through early.js. The extension's native
part reads and writes iCloud's key-value store, but it cannot hear iCloud's
change notices, so this script asks it: when a tab reports its account, when a
Fastmail tab comes to the front, and every five minutes.

Storage:
- settings: the set a tab gets before its account is known, and the starting
  set for an account seen for the first time
- settingsByAccount: {<account id>: {...}}, written by early.js for the page's
  own changes, and here for iCloud's
- lastAccountId: the account a new tab is most likely on
- tabAccounts: {<tab id>: <account id>}
- joinedAccounts: the accounts that have had their first sync in Safari
- syncEnabled: the page's "Sync settings with iCloud" switch; absent means on
*/

const api = globalThis.browser || globalThis.chrome;

// The beta site is the same app on its own origin, so it gets the same
// treatment.
const TARGETS = ['https://app.fastmail.com/*', 'https://app.beta.fastmail.com/*'];
const TARGET_PATTERN = /^https:\/\/app\.(beta\.)?fastmail\.com\//;
const PAYLOAD = 'fastmail-custom-mode.js';

// Must match SettingsSyncRules.swift, which the native part compiles and
// which composes the store keys; SettingsParityTests reads this line.
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// Safari hands every native message to this extension's own native part,
// whatever application is named.
const NATIVE_APPLICATION = 'com.mdbraber.fastmail-custom.safari';
const SYNC_ALARM = 'custom-mode-settings-sync';
const SYNC_MINUTES = 5;

const STORED_KEYS = ['settings', 'settingsByAccount', 'lastAccountId', 'tabAccounts', 'joinedAccounts', 'syncEnabled'];

const readStored = () => api.storage.local.get(STORED_KEYS);

const isSyncOn = (stored) => stored.syncEnabled !== false;

const isAccountId = (value) => typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value);

// The account a tab said it is, or the last one any tab said
const accountOfTab = (stored, tabId) =>
    (stored.tabAccounts || {})[String(tabId)] || stored.lastAccountId || null;

// Whatever is stored, as it is. The page carries the catalogue and every
// default, so there is nothing to merge here: an account's own set, or the
// plain set until the account has one.
const settingsFor = (stored, accountId) => {
    const byAccount = stored.settingsByAccount || {};
    return (accountId && byAccount[accountId]) || stored.settings || {};
};

const sameSet = (one, other) => {
    const a = one || {};
    const b = other || {};
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
        keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
};

// The writes made here go one at a time, each reading what the last one left
let storageWork = Promise.resolve();
const updateStored = (change) => {
    storageWork = storageWork
        .then(async () => {
            const update = change(await readStored());
            if (update) await api.storage.local.set(update);
        })
        .catch((error) => {
            console.error('Custom mode: could not save the sync state', error);
        });
    return storageWork;
};

const inject = async (tabId) => {
    const stored = await readStored();

    // The page has not said which account it is yet; the last account any
    // page reported is the best guess, and the page's own report corrects it
    await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (value, sync) => {
            window.__customModeSettings = value;
            window.__customModeSync = sync;
        },
        args: [settingsFor(stored, stored.lastAccountId), { enabled: isSyncOn(stored) }]
    });

    await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: [PAYLOAD]
    });
};

// Settings, and the switch's state, into a page that is already running
const applyToTab = (tabId, stored) => api.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (value, sync) => {
        window.__customModeSettings = value;
        window.__customModeSync = sync;
        if (window.customMode) window.customMode.applySettings(value);
    },
    args: [settingsFor(stored, accountOfTab(stored, tabId)), { enabled: isSyncOn(stored) }]
}).catch(() => { /* tab may not have the payload yet */ });

const fastmailTabs = () => api.tabs.query({ url: TARGETS });

// A reply the native part refused, or no reply at all, throws
const askNative = async (message) => {
    const reply = await api.runtime.sendNativeMessage(NATIVE_APPLICATION, message);
    if (!reply || reply.ok !== true) throw new Error((reply && reply.error) || 'no answer');
    return reply;
};

const syncedOnly = (settings) => {
    const clean = {};
    Object.keys(settings || {}).forEach((key) => {
        const value = settings[key];
        if (typeof value === 'boolean' || typeof value === 'string') clean[key] = value;
    });
    return clean;
};

/*
iCloud's settings for one account.

The first time, iCloud wins when it holds any: its values replace the synced
ones here, and a synced setting it lacks is removed, so the page shows the
default. When it holds none, this set stays as it is, and the account is
joined without uploading anything, so a Mac that has not received iCloud's
settings yet cannot overwrite them. After that each answer overwrites the
settings iCloud holds.
*/
const pullAccount = async (accountId) => {
    if (!isAccountId(accountId) || !isSyncOn(await readStored())) return;

    let reply;
    try {
        reply = await askNative({ action: 'get', accountId });
    } catch (error) {
        console.warn('Custom mode: iCloud could not be asked; keeping the settings on this Mac', error);
        return;
    }
    if (!reply.available) {
        console.warn('Custom mode: iCloud is not available; keeping the settings on this Mac');
        return;
    }

    const incoming = syncedOnly(reply.settings);
    await updateStored((stored) => {
        // Switched off while the answer was on its way
        if (!isSyncOn(stored)) return null;

        const joined = stored.joinedAccounts || [];
        const isJoined = joined.includes(accountId);
        const current = settingsFor(stored, accountId);
        const next = (isJoined || !Object.keys(incoming).length)
            ? Object.assign({}, current, incoming)
            : Object.assign({}, incoming);

        const update = {};
        const byAccount = stored.settingsByAccount || {};
        if (!sameSet(next, byAccount[accountId])) {
            update.settingsByAccount = Object.assign({}, byAccount, { [accountId]: next });
        }
        if (!isJoined) update.joinedAccounts = joined.concat([accountId]);
        return Object.keys(update).length ? update : null;
    });
};

const pullOpenTabs = async () => {
    const stored = await readStored();
    if (!isSyncOn(stored)) return;
    const tabs = await fastmailTabs();
    const accounts = new Set(tabs.map(tab => (stored.tabAccounts || {})[String(tab.id)]).filter(isAccountId));
    for (const accountId of accounts) {
        await pullAccount(accountId);
    }
};

// One setting the page changed, which early.js has already saved. Only an
// account that has had its first sync sends anything.
const sendSetting = async (accountId, key, value) => {
    if (!isAccountId(accountId)) return;
    const stored = await readStored();
    if (!isSyncOn(stored) || !(stored.joinedAccounts || []).includes(accountId)) return;
    try {
        await askNative({ action: 'set', accountId, key, value });
    } catch (error) {
        console.warn('Custom mode: a setting could not be sent to iCloud; it is kept on this Mac', error);
    }
};

const accountReported = async (tabId, accountId) => {
    let injectedAnother = false;
    let hadOwnSet = false;
    await updateStored((stored) => {
        const byAccount = stored.settingsByAccount || {};
        injectedAnother = stored.lastAccountId !== accountId;
        hadOwnSet = !!byAccount[accountId];
        const update = {
            lastAccountId: accountId,
            tabAccounts: Object.assign({}, stored.tabAccounts || {}, { [String(tabId)]: accountId })
        };
        // An account seen for the first time starts from the plain set
        if (!hadOwnSet) {
            update.settingsByAccount = Object.assign({}, byAccount, {
                [accountId]: Object.assign({}, stored.settings || {})
            });
        }
        return update;
    });
    // The tab was given the last account's set when it loaded. A new
    // account's set reaches it through the storage listener; an existing
    // one that is not what it was given goes to it now.
    if (injectedAnother && hadOwnSet) applyToTab(tabId, await readStored());
    await pullAccount(accountId);
};

const syncSwitched = async (enabled) => {
    // Off forgets every first sync, so turning it on takes iCloud's
    // settings again
    await updateStored(() => (enabled ? { syncEnabled: true } : { syncEnabled: false, joinedAccounts: [] }));
    if (enabled) await pullOpenTabs();
};

// The payload guards against running twice, so a duplicate injection is safe
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab || !tab.url || !TARGET_PATTERN.test(tab.url)) return;

    inject(tabId).catch((error) => {
        console.error('Custom mode: injection failed', error);
    });
});

// A tab coming to the front may be showing settings changed elsewhere
api.tabs.onActivated.addListener(({ tabId }) => {
    (async () => {
        const tab = await api.tabs.get(tabId);
        if (!tab || !tab.url || !TARGET_PATTERN.test(tab.url)) return;
        const stored = await readStored();
        await pullAccount((stored.tabAccounts || {})[String(tabId)]);
    })().catch((error) => {
        console.warn('Custom mode: could not check iCloud for this tab', error);
    });
});

api.tabs.onRemoved.addListener((tabId) => {
    updateStored((stored) => {
        const tabAccounts = Object.assign({}, stored.tabAccounts || {});
        if (!Object.prototype.hasOwnProperty.call(tabAccounts, String(tabId))) return null;
        delete tabAccounts[String(tabId)];
        return { tabAccounts };
    });
});

// What early.js carries across from the page
api.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!message || typeof tabId !== 'number') return;

    let work = null;
    if (message.kind === 'account' && isAccountId(message.accountId)) {
        work = accountReported(tabId, message.accountId);
    } else if (message.kind === 'sync' && typeof message.enabled === 'boolean') {
        work = syncSwitched(message.enabled);
    } else if (message.kind === 'setting' && typeof message.key === 'string' &&
        (typeof message.value === 'boolean' || typeof message.value === 'string')) {
        work = sendSetting(message.accountId, message.key, message.value);
    }
    if (work) {
        work.catch((error) => {
            console.error('Custom mode: settings sync failed', error);
        });
    }
});

// Made once: creating it again each time this script wakes would restart its
// five minutes every time
api.alarms.get(SYNC_ALARM).then((existing) => {
    if (!existing) api.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
});

api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SYNC_ALARM) return;
    pullOpenTabs().catch((error) => {
        console.warn('Custom mode: could not check iCloud', error);
    });
});

// Push a changed set to the tabs it belongs to: every tab when the plain set
// or the switch changed, and otherwise the tabs of the accounts whose sets did
api.storage.onChanged.addListener(async (changes, area) => {
    if (area && area !== 'local') return;
    const everyTab = 'settings' in changes || 'syncEnabled' in changes;
    if (!everyTab && !('settingsByAccount' in changes)) return;

    const before = everyTab ? {} : (changes.settingsByAccount.oldValue || {});
    const after = everyTab ? {} : (changes.settingsByAccount.newValue || {});
    const stored = await readStored();
    const tabs = await fastmailTabs();

    tabs.forEach((tab) => {
        const accountId = accountOfTab(stored, tab.id);
        if (everyTab || !sameSet(before[accountId], after[accountId])) applyToTab(tab.id, stored);
    });
});
