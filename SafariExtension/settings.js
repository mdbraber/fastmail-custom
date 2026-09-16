const api = globalThis.browser || globalThis.chrome;

// The settings are drawn in the page now, by the payload, so the popup's one
// job is to open them there. Nothing is stored or read here.
const TARGET_PATTERN = /^https:\/\/app\.(beta\.)?fastmail\.com\//;

const fastmailSection = document.getElementById('fastmail');
const elsewhereSection = document.getElementById('elsewhere');
const button = document.getElementById('open');
const note = document.getElementById('note');

const activeTab = async () => {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
};

const open = async () => {
    const tab = await activeTab();
    if (!tab) return;

    // The injected function reports whether the payload's export went to the
    // settings page or opened the plain panel, so the popup only closes once
    // one of them has; closing on a guard it never got past would make the
    // click look ignored.
    // executeScript resolves one result per targeted frame, and this call
    // only ever targets the tab's main frame, so the first entry is it.
    const results = await api.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
            if (window.fastmailCustom && window.fastmailCustom.openSettings) {
                return window.fastmailCustom.openSettings() !== false;
            }
            return false;
        }
    });

    if (results && results[0] && results[0].result) {
        window.close();
    } else {
        note.textContent = 'Fastmail Custom has not loaded in this tab yet. Reload the page and try again.';
    }
};

button.addEventListener('click', () => {
    open().catch((error) => {
        note.textContent = 'Could not open the settings: ' + error.message;
    });
});

document.getElementById('permissions').addEventListener('click', (event) => {
    event.preventDefault();
    api.runtime.openOptionsPage();
});

// Shown before any click: a Fastmail tab gets the "open settings" flow,
// anything else gets the plain website-permissions message. tab.url is only
// populated when host_permissions covers the tab, which is exactly the
// Fastmail domains, so an unset url means "not Fastmail" too.
activeTab().then((tab) => {
    const onFastmail = !!(tab && tab.url && TARGET_PATTERN.test(tab.url));
    fastmailSection.hidden = !onFastmail;
    elsewhereSection.hidden = onFastmail;
});
