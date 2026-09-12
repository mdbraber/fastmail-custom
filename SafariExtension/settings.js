const api = globalThis.browser || globalThis.chrome;

// Kept in step with the userscript's DEFAULT_SETTINGS and background.js
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
    stickyInboxFilter: true,
    filteredLabelCounts: true,
    groupings: 'by age (urgent first)\n  Triage = in:Triage OR is:unread\n  Pinned = is:pinned\n  Today = date:today\n  Yesterday = date:yesterday\n  This week = after:1w\n  This month = after:1m\n  Older',
    backToListAfterTriage: true,
    triageLabel: 'Triage',
    snoozeKey: 'w',
    snoozeDefault: '2w',
    snoozeTime: '08:00',
    urgentKey: 's',
    bottomBarSlots: 'Snooze, Pin, Keep, Archive, Labels, Move, Delete',
    bottomBarItems: '',
    topBarItems: '',
    excludedLabels: 'Later, Feedbin',
    contactGroupLabels: '',
    appBadgeLabel: 'Triage',
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

// A textarea is not type "text", and the checkbox branch would read its
// checked property, which is undefined; so the question is asked once, here.
const isTextInput = (input) => input.type === 'text' || input.tagName === 'TEXTAREA';

const load = async () => {
    const stored = await api.storage.local.get('settings');
    const settings = Object.assign({}, DEFAULT_SETTINGS, stored.settings || {});

    inputs.forEach(([key, input]) => {
        if (isTextInput(input)) input.value = settings[key] || '';
        else input.checked = !!settings[key];
    });
    syncSubs();
};

const save = async () => {
    const settings = {};
    inputs.forEach(([key, input]) => {
        settings[key] = isTextInput(input) ? input.value.trim() : input.checked;
    });

    syncSubs();

    // Writing here is what notifies the background script, which pushes the
    // change into any open Fastmail tab
    await api.storage.local.set({ settings });
};

// Writing settings wakes the background script, which pushes them into every
// open Fastmail tab and rebuilds the grouped list there; a textarea firing
// input on every keystroke would do that once per character. Coalesced into
// one write once typing pauses, rather than one write per keystroke. If the
// popup is dismissed inside that window with no blur — a close that tears
// the context down outright — the pending write would be lost, so hiding or
// tearing down the page flushes it immediately instead of waiting out the
// timer. change still saves straight away, for the blur case.
let saveTimer = null;

const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 450);
};

const flushSave = () => {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    save();
};

inputs.forEach(([, input]) => {
    input.addEventListener('change', save);
    if (input.tagName === 'TEXTAREA') input.addEventListener('input', scheduleSave);
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
});

window.addEventListener('pagehide', flushSave);

load();
