const api = globalThis.browser || globalThis.chrome;

// Kept in step with the userscript's DEFAULT_SETTINGS and background.js
const DEFAULT_SETTINGS = {
    labelColours: true,
    labelColoursSidebarOnly: true,
    labelColoursSkipProcess: true,
    dragAdditive: true,
    hideInboxLabel: true,
    stripLabelPrefix: true,
    labelsShortcut: true,
    labelsSidebarOnly: true,
    labelsAutoSave: true,
    processLabel: 'Next',
    qualifierLabels: 'Admin, Waiting',
    deferredLabels: 'Waiting, Snoozed',
    waitingLabel: 'Waiting',
    somedayLabel: 'Someday',
    nonInboxLabels: '',
    urgentKey: 's',
    waitingKey: 'w',
    somedayKey: 'o',
    bottomBarSlots: 'Snooze, Pin, Archive, Labels, Keep, Waiting, Someday, Delete, Move',
    excludedLabels: 'Later',
    contactGroupLabels: '',
    showFilteredCounts: true,
    showHeaderCounts: true,
    appBadgeLabel: 'Inbox',
    appBadgeFilter: 'next',
    swapArchiveExpand: true,
    sidebarSeparators: true,
    hideLoneExpando: true
};

const inputs = Object.keys(DEFAULT_SETTINGS).map((key) => [key, document.getElementById(key)]);

// A suboption only means anything while the option above it is on, so it
// follows its parent rather than sitting there looking available
const subs = Array.from(document.querySelectorAll('label.sub')).map((row) => ({
    row,
    input: row.querySelector('input'),
    parent: document.getElementById(row.dataset.parent)
}));

const syncSubs = () => {
    subs.forEach(({ row, input, parent }) => {
        const on = !!parent && parent.checked;
        input.disabled = !on;
        row.classList.toggle('is-disabled', !on);
    });
};

const load = async () => {
    const stored = await api.storage.local.get('settings');
    const settings = Object.assign({}, DEFAULT_SETTINGS, stored.settings || {});

    inputs.forEach(([key, input]) => {
        if (input.type === 'text') input.value = settings[key] || '';
        else input.checked = !!settings[key];
    });
    syncSubs();
};

const save = async () => {
    const settings = {};
    inputs.forEach(([key, input]) => {
        settings[key] = input.type === 'text' ? input.value.trim() : input.checked;
    });

    syncSubs();

    // Writing here is what notifies the background script, which pushes the
    // change into any open Fastmail tab
    await api.storage.local.set({ settings });
};

inputs.forEach(([, input]) => input.addEventListener('change', save));

load();
