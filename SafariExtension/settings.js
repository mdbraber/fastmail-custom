const api = globalThis.browser || globalThis.chrome;

// The settings are drawn in the page now, by the payload, so the popup's one
// job is to open them there. Nothing is stored or read here.
const TARGET_PATTERN = /^https:\/\/app\.(beta\.)?fastmail\.com\//;

const button = document.getElementById('open');
const note = document.getElementById('note');

const activeTab = async () => {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
};

const open = async () => {
    const tab = await activeTab();
    if (!tab || !tab.url || !TARGET_PATTERN.test(tab.url)) {
        note.textContent = 'Open a Fastmail tab first; the settings live in the page.';
        button.disabled = true;
        return;
    }

    // The injected function reports whether it actually reached the payload's
    // export, so the popup only closes once the panel has really opened;
    // closing on a guard it never got past would make the click look ignored.
    // executeScript resolves one result per targeted frame, and this call
    // only ever targets the tab's main frame, so the first entry is it.
    const results = await api.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
            if (window.customMode && window.customMode.openSettings) {
                window.customMode.openSettings();
                return true;
            }
            return false;
        }
    });

    if (results && results[0] && results[0].result) {
        window.close();
    } else {
        note.textContent = 'Custom mode has not loaded in this tab yet. Reload the page and try again.';
    }
};

button.addEventListener('click', () => {
    open().catch((error) => {
        note.textContent = 'Could not open the settings: ' + error.message;
    });
});
