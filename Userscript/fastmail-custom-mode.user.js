// ==UserScript==
// @name         Fastmail Custom
// @namespace    custom
// @version      3.14
// @description  One-label triage for Fastmail: a project label is the live state, and archive means one thing everywhere
// @author       Maarten den Braber <m@mdbraber.com>
// @license      AGPL-3.0-or-later
// @match        https://app.fastmail.com/*
// @match        https://app.beta.fastmail.com/*
// @run-at       document-idle
// @inject-into  context
// @grant        none
// ==/UserScript==

/*
Fastmail Custom
Maarten den Braber <m@mdbraber.com>

One-label triage for Fastmail: a project label is the live state of a
message, and archive means the same thing in every list.

Licensed under the GNU Affero General Public License, version 3 or later.
*/

(function () {
    'use strict';

    // Injection can happen more than once, an injector racing a reload, or a
    // manual load on top of an existing copy.
    if (window.fastmailCustom) {
        console.log('Fastmail Custom: already loaded');
        return;
    }

    /*
     * ----------------------------------------------------------------
     * Configuration
     * ----------------------------------------------------------------
     */

    // Option-Command and 1 … 9 or 0 go to the sources listed above the Labels
    // heading. Command and a number used to do the same; it belongs to the
    // window's tabs in the shell apps, and to the browser's tabs elsewhere.

    // Option shortcuts are matched on the physical key rather than the
    // character, because Option is what a Mac keyboard uses to reach a second
    // layer: Option-1 is not "1" but ¡ or similar; nothing a shortcut can be
    // named after, and the answer would change with the layout.
    const OPTION_SOURCE_CODES = [
        'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
        'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'
    ];

    // Set on <body> while the Inbox chip should be hidden on message rows
    const HIDE_INBOX_LABEL_CLASS = 'custom-hideInboxLabel';
    // Goes on the sidebar row that opens a run of a different kind, so the line
    // above it can be left to CSS
    const SOURCE_SEPARATOR_CLASS = 'custom-sourceSeparator';
    // Goes on the sidebar when the only section drawn is this account's own
    const LONE_SECTION_CLASS = 'custom-loneSection';
    // Opens the Move to menu: v narrowed to the sidebar and adding rather than
    // moving, Option-V as it comes.
    const MOVE_SHORTCUT = 'v';
    const STOCK_MOVE_CODE = 'KeyV';
    // Id of our stylesheet
    const STYLE_ID = 'fastmail-custom-style';
    // What the extension's document_start script replays on the next load, so
    // Fastmail's first paint is already styled. Read by early.js as well.
    const EARLY_KEY = 'fastmail-custom-early';
    // Views worth remembering an answer for; older ones are dropped
    const EARLY_PATH_LIMIT = 40;
    // Bumped when remembered answers become untrustworthy, to drop them once
    const EARLY_VERSION = 2;

    // Options, overridable from the extension's settings.
    const DEFAULT_SETTINGS = {
        labelColours: true,
        labelColoursSidebarOnly: true,
        // Triage is on every undecided row, so tinting by it would paint
        // the whole group one shade and say nothing
        labelColoursSkipTriage: true,
        dragAdditive: true,
        hideInboxLabel: true,
        stripLabelPrefix: true,
        labelsShortcut: true,
        labelsSidebarOnly: true,
        labelsAutoSave: true,
        // A project label is a queue, not an archive: its list opens showing
        // only what is still in the Inbox.
        stickyInboxFilter: true,
        // And the badge counts the same set the filtered list shows, rather
        // than everything the label has ever held.
        filteredLabelCounts: true,
        // In the sidebar, a label with sublabels shows its own badge only
        // while collapsed; expanding it hands the count to each sublabel
        // instead. Leaves the count above its own message list alone.
        collapsedLabelCounts: false,
        // The groupings offered in Fastmail's Group menu between None, which
        // stays Fastmail's own, and Custom…, which does too. A block each: a
        // line naming it, then indented Name = search lines, then a bare
        // line for the rest. "by age", "pinned first" and "unread first" ship
        // here rather than staying Fastmail's fixed three of the same names,
        // so all of them can be renamed, reordered, edited or removed the
        // same way as a grouping of the user's own; add a Triage group to
        // "by age" for what used to be a separate urgency-first version of
        // it.
        groupings: 'by age\n  Today = date:today\n  Yesterday = date:yesterday\n  This week = after:1w\n' +
            '  This month = after:1m\n  Older\n\npinned first\n  Pinned = is:pinned\n\n' +
            'unread first\n  Unread = is:unread',
        // A decision about a message in triage steps on to the next message
        // only while that one is in triage too; the run is over otherwise,
        // and the list is where it ends. Only where the message fills the
        // window: beside a reading pane the list is on screen anyway, and
        // there, as after a decision about any other message, Fastmail's own
        // setting says where to go.
        backToListAfterTriage: true,
        // The label a rule puts on everything incoming. Taken off by keeping
        // or filing; the script never adds it.
        triageLabel: 'Triage',
        // Fastmail's own Snooze button and shortcut (b) open this list
        // instead of its own presets, one per line as "Name = Date @ Time";
        // Date is a keyword (today, tomorrow, this weekend, next week), a
        // count and a unit short or written out (2w, in 2 weeks), or a date
        // as YYYY-MM-DD, each with a Time as HH:MM; or a number of hours
        // (+4h, in 4 hours), counted from the start of this hour, which needs
        // no Time. "Choose a date and time…", which opens Fastmail's own
        // picker, always comes last and is not part of this setting.
        snoozePresets: 'Later today = +4h\nThis Evening = today @ 19:00\nTomorrow = tomorrow @ 08:00\n' +
            'This weekend = this weekend @ 08:00\nNext week = next week @ 08:00',
        // What the group everything further out falls into is called, and
        // what the reminder menu's own "none" entry says; both are changed
        // from the row that shows them
        snoozeGroupsOther: 'Later',
        reminderNoneLabel: 'No reminder',
        // What the Snoozed folder's own grouping is called, in the Group
        // menu and among the group presets, where it is renamed
        snoozeGroupName: 'By return date',
        // Where it sits among them, as a number; empty puts it last
        snoozeGroupAt: '',
        // Groups for the Snoozed folder, by when a conversation comes back,
        // written the way snooze presets are: a name and how far out the
        // group reaches. Cumulative, first match wins, and whatever is
        // further out falls into the last group. Offered in the Snoozed
        // folder's Group menu, beside the ordinary presets.
        snoozeGroups: 'Next 7 days = 7d\nNext 30 days = 30d\nNext 90 days = 90d',
        // The times compose's Remind button offers for a message to come
        // back if nobody replies, written the way snoozePresets are
        reminderPresets: 'Tomorrow = tomorrow @ 08:00\nIn 3 days = 3d @ 08:00\n' +
            'Next week = next week @ 08:00\nIn 2 weeks = 2w @ 08:00',
        // When a message you send comes back to the Inbox if nobody has
        // replied: the name of a reminder preset, or a Date @ Time the way a
        // preset writes one, counted from when the message goes out. One for
        // new messages and forwards, one for replies; empty sets none, and
        // compose's Remind button changes it for the message at hand.
        remindNewMessages: '',
        remindReplies: '',
        // The action bar's verbs, as one ordered list over all of them: the
        // bar takes as many leading ones as fit; More always keeps a slot,
        // and the rest wait inside More, in the same order. Each kind of
        // device keeps its own list, synced between devices of that kind;
        // along the bottom on a phone, across the top of a message on a
        // tablet and on the Mac.
        bottomBarSlots: 'Snooze, Pin, Keep, Archive, Labels, Move, Delete',
        // How many of them are drawn rather than measured for, one count per
        // bar; empty leaves the bar measuring, which is what it did before
        // either was asked for
        bottomBarItems: '',
        topBarItems: '',
        // The Labels grouping from when it was a grouping of its own rather
        // than one of the presets: where it stood among them (3, after "by
        // age", "pinned first" and "unread first") and its own block, with
        // "Labels = *labels*" where the group per label goes. Still read, so
        // it stands among the presets until they are next written; that
        // writes it in as one of them and sets the place to "none".
        labelsGroupingIndex: '3',
        labelsGrouping: '',
        // Shown in the sidebar but worked as piles, not queues: never filed
        // into, never stripped by archive
        excludedLabels: 'Later, Feedbin',
        // Labels that file the sender as well as the message: adding one, from
        // any menu, by typing, or by drag, adds from[0] to the contact group
        // of the same name, making the contact, and the group, if either is
        // new.
        contactGroupLabels: '',
        // Keeping a message, by any of the Keep routes, adds from[0] to your
        // contacts when they are not one already
        keepAddsContact: false,
        // The labels a new message goes out with, ticked in the compose
        // window's own Labels menu as it opens; replies and forwards are left
        // alone. Comma-separated paths; empty adds none.
        sentLabel: '',
        // The app icon's badge, for the shell apps: this label's total, Triage
        // is what is left to decide.
        appBadgeLabel: 'Triage',
        swapArchiveExpand: true,
        sidebarSeparators: true,
        hideLoneExpando: true,
        // The phone's own up/down step sits in the header, a stretch for a
        // thumb holding the phone one-handed; this repeats it fixed above
        // the tab bar instead. The two are independent: the pair can be
        // added without taking the header's own buttons away, or the
        // header's pair can be taken away on its own. Off by default on
        // the iPad even when the pair itself is on, since a tablet's own
        // reach is not the phone's one-handed stretch this exists for.
        floatingMessageNav: true,
        floatingMessageNavIPad: false,
        hideMessageNavButtons: false,
        // The phone's own big title over the list; Fastmail never builds
        // one at all past phone width, so this is a standalone element
        // rather than anything Fastmail's own could be un-hidden into.
        showMailboxTitle: false,
        attachmentBeforeLabels: true,
        tagsBeforeSidebarLabels: true,
        // A grouping's priorities that name a single keyword (is:unread,
        // is:pinned, keyword:…) as sort entries inside each group rather
        // than as a group of their own ahead of each group. See
        // prioritySortFor.
        prioritiesAsSort: false
    };

    // Named here, ahead of localSettings, so that writeSetting's own
    // local-storage fallback further down the file reads and writes the same
    // key rather than a second spelling of it.
    const LOCAL_SETTINGS_KEY = 'fastmail-custom-settings';

    // A plain browser tab has no host to store settings in, so the page
    // keeps them here. A tab that does have a host never writes this, so an
    // old copy cannot outrank what the host injected.
    const localSettings = () => {
        try {
            return JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY)) || {};
        } catch (error) {
            return {};
        }
    };

    // A window Fastmail opened itself starts from the settings its host had
    // when the app started; the window that opened it has them as they are
    const openerSettings = () => {
        try {
            return window.opener && window.opener.__fastmailCustomSettings;
        } catch (error) {
            return null;
        }
    };

    let settings = Object.assign(
        {},
        DEFAULT_SETTINGS,
        openerSettings() || window.__fastmailCustomSettings || localSettings()
    );

    /*
     * ----------------------------------------------------------------
     * The option catalogue
     * ----------------------------------------------------------------
     *
     * Canonical, and the only one. The settings page is drawn from this, and
     * neither host holds a copy: the apps and the extension handle the
     * fastmailCustom. namespace without knowing what is in it, so adding an
     * option means adding one entry here and nothing anywhere else.
     *
     * The default is not repeated: DEFAULT_SETTINGS above already carries all
     * of them, and settingValue reads it from there.
     */
    const SETTING_GROUPS = [
        { id: 'appearance', title: 'Appearance' },
        { id: 'keyboard', title: 'Keyboard' },
        { id: 'labelsFiling', title: 'Labels & keeping' },
        { id: 'contacts', title: 'Contacts' },
        { id: 'bottomBar', title: 'Action bar' },
        { id: 'grouping', title: 'Groups' },
        { id: 'snooze', title: 'Snooze' },
        { id: 'reminders', title: 'Reminders' }
    ];

    const SETTINGS = [
        {
            key: 'appBadgeLabel', group: 'labelsFiling', clearable: true,
            title: 'Badge label',
            hint: 'The app icon shows how many conversations carry this label. Empty uses the Inbox count.'
        },
        {
            key: 'labelColours', group: 'appearance',
            title: 'Colour rows by label',
            hint: 'Rows take the colour of a label they carry.'
        },
        {
            key: 'labelColoursSidebarOnly', group: 'appearance', parent: 'labelColours',
            title: 'Only labels in the sidebar',
            hint: 'Plain tags stay uncoloured.'
        },
        {
            key: 'labelColoursSkipTriage', group: 'appearance', parent: 'labelColours',
            title: 'Ignore the triage label',
            hint: 'Every undecided message carries it; its colour would tint everything.'
        },
        {
            key: 'sidebarSeparators', group: 'appearance',
            title: 'Separate folders from labels',
            hint: 'A line between the system folders and your labels.'
        },
        {
            key: 'hideLoneExpando', group: 'appearance',
            title: 'Hide the Labels collapse arrow',
            hint: 'Hidden while only one account is shown.'
        },
        {
            key: 'hideInboxLabel', group: 'appearance',
            title: 'Hide the Inbox tag',
            hint: 'Hidden where every message is in the Inbox anyway.'
        },
        {
            key: 'stripLabelPrefix', group: 'appearance',
            title: 'Hide the parent label',
            hint: '“Work” instead of “Projects/Work”. Hover for the full path.'
        },
        {
            key: 'triageLabel', group: 'labelsFiling',
            title: 'Triage label',
            hint: 'Added to every incoming message by your rule; removed by keeping it somewhere or archiving it.'
        },
        {
            key: 'excludedLabels', group: 'labelsFiling', clearable: true,
            title: 'Labels that are never projects',
            hint: 'Destinations that hold mail rather than queue it; archive leaves them on, and Shift-E archives into one. Comma-separated paths.'
        },
        {
            key: 'keepAddsContact', group: 'contacts',
            title: 'Add the sender to contacts when filing under a label',
            hint: 'Keeping a message under a label, or archiving it into one with Shift-E, adds its sender to your contacts if they are not there yet. A plain archive does not.'
        },
        {
            key: 'contactGroupLabels', group: 'contacts', clearable: true,
            title: 'Labels that add the sender to a contact group',
            hint: 'Applying one adds the sender to the contact group of the same name, creating it if needed. Comma-separated paths.'
        },
        {
            key: 'sentLabel', group: 'labelsFiling', clearable: true,
            title: 'Labels for new messages you send',
            hint: 'Ticked in the compose window’s Labels menu for a new message, where you can untick them; replies and forwards don’t get them. Comma-separated paths; empty adds none.'
        },
        {
            key: 'backToListAfterTriage', group: 'labelsFiling',
            title: 'Return to message list when no triage labels left',
            hint: 'Where a message fills the window, such as the phone or with Fastmail’s reading pane off. After a decision on a message carrying the triage label, the step to the next one is taken only while that one carries it too; otherwise the message list comes back. Beside a reading pane, and after a decision on any other message, Fastmail’s own setting decides.'
        },
        {
            key: 'dragAdditive', group: 'labelsFiling',
            title: 'Dragging adds label instead of moving',
            hint: 'A drop keeps the message under that label and leaves it in the Inbox. Option moves it.'
        },
        {
            key: 'labelsShortcut', group: 'labelsFiling',
            title: 'Keep instead of move',
            hint: 'Keeps the message under a project label and leaves it in the Inbox; one already kept just loses its triage label. Shift-V keeps it somewhere else, Option-V moves.'
        },
        {
            key: 'labelsSidebarOnly', group: 'labelsFiling', parent: 'labelsShortcut',
            title: 'Only labels in the sidebar',
            hint: 'The picker hides Trash, Spam and plain tags; typing still finds any label.'
        },
        {
            key: 'labelsAutoSave', group: 'labelsFiling', parent: 'labelsShortcut',
            title: 'Apply the only match automatically',
            hint: 'A single remaining match is applied and the picker closes.'
        },
        {
            key: 'stickyInboxFilter', group: 'labelsFiling',
            title: 'Apply “In Inbox” filter to project labels',
            hint: 'Its list opens showing only what is still in the Inbox, since that is the queue and the rest is history. Turning the filter off holds while you stay on that label.'
        },
        {
            key: 'filteredLabelCounts', group: 'labelsFiling',
            title: 'Count only what is in the Inbox',
            hint: 'A project label’s badge counts the same messages its filtered list shows, rather than everything it has ever held.'
        },
        {
            key: 'collapsedLabelCounts', group: 'labelsFiling',
            title: 'Count root labels in the sidebar only when collapsed',
            hint: 'In the sidebar, a label with sublabels, like Projects or Boards, shows a badge only while it’s collapsed; expand it and the count moves to each sublabel underneath. Leaves the count above its own message list alone.'
        },
        {
            key: 'groupings', group: 'grouping', clearable: true, multiline: true,
            title: 'Group presets',
            hint: 'Shown in each mailbox’s Group menu. Groups and priorities use Fastmail’s search syntax; priorities put matching conversations first within every group. Labels (root) and Labels (all) add a group per label. Renaming a preset removes it from mailboxes using it.'
        },
        {
            key: 'prioritiesAsSort', group: 'grouping',
            title: 'Sort priorities instead of adding groups',
            hint: 'Flag priorities like is:unread or is:pinned sort within each group instead of adding groups, staying under Fastmail’s 32-group limit. Other priorities still add groups, which come first. Switching this unfolds those presets’ groups.'
        },
        {
            key: 'snoozePresets', group: 'snooze', clearable: true, multiline: true,
            title: 'Snooze presets',
            hint: 'Replaces Fastmail’s Snooze list; press 1, 2, 3… to pick. Give a date (today, tomorrow, this weekend, next week, 2w, YYYY-MM-DD) and a time, or hours from now (+4h).'
        },
        {
            key: 'reminderPresets', group: 'reminders', clearable: true, multiline: true,
            title: 'Reminder presets',
            hint: 'The times compose’s Remind button offers, beside Schedule send, for a message you send to come back to the Inbox, unread and still in Sent, if nobody replies. Written like snooze presets.'
        },
        {
            key: 'snoozeGroups', group: 'snooze', clearable: true, multiline: true,
            title: 'Snooze group presets (return date)',
            hint: 'Groups the Snoozed folder by when a conversation comes back, offered in its Group menu beside the ordinary presets. Each group reaches to its own time (7d, tomorrow, 1m, or a date and time) and takes what the ones above it did not; anything further out falls in the last group.'
        },
        {
            key: 'remindNewMessages', group: 'reminders', clearable: true,
            title: 'Remind me if nobody replies to a new message',
            hint: 'The reminder a new message or forward starts with: a reminder preset’s name, or a date and time like a preset’s (3d @ 08:00); empty sets none. A reply takes the reminder off when the push server runs; without it the reply still brings the conversation back to the Inbox, and the reminder comes back as well.'
        },
        {
            key: 'remindReplies', group: 'reminders', clearable: true,
            title: 'Remind me if nobody replies to a reply',
            hint: 'The same for replies you send.'
        },
        {
            key: 'swapArchiveExpand', group: 'keyboard',
            title: 'Swap E and Y',
            hint: 'E archives and Y expands, the reverse of Fastmail’s default. H still archives.'
        },
        {
            key: 'bottomBarSlots', group: 'bottomBar',
            title: 'Action bar actions',
            hint: 'Actions above the separator show on the bar, the rest under More. Phone, iPad and Mac each keep their own.'
        },
        {
            key: 'floatingMessageNav', group: 'appearance',
            title: 'Floating message navigation (Mobile only)',
            hint: 'Up/down buttons above the tab bar, for stepping between messages one-handed.'
        },
        {
            key: 'floatingMessageNavIPad', group: 'appearance', parent: 'floatingMessageNav',
            title: 'Also on iPad',
            hint: 'Off keeps the floating pair to the phone; on repeats it on the iPad too.'
        },
        {
            key: 'hideMessageNavButtons', group: 'appearance',
            title: 'Hide the header’s own up/down buttons',
            hint: 'Independent of the floating pair above. Phone only.'
        },
        {
            key: 'showMailboxTitle', group: 'appearance',
            title: 'Show the mailbox name above the list',
            hint: 'The phone’s own big title, past phone width too, where Fastmail draws none.'
        },
        {
            key: 'attachmentBeforeLabels', group: 'appearance',
            title: 'Show the paperclip before the labels',
            hint: 'Where a row shows both on one line; the labels then end in the same place on every row.'
        },
        {
            key: 'tagsBeforeSidebarLabels', group: 'appearance',
            title: 'Show plain tags before sidebar labels',
            hint: 'Labels hidden from the sidebar come first on a row, ahead of ones like Triage.'
        }
    ];

    const settingFor = (key) => SETTINGS.filter(one => one.key === key)[0] || null;

    const settingsInGroup = (group) => SETTINGS.filter(one => one.group === group);

    /*
     * What a stored value means. These rules used to live in Swift, in
     * FastmailCustomSettings.current; they move here with the catalogue, because
     * the hosts no longer know which options are clearable.
     *
     * A text value is trimmed. If nothing is left, a clearable option means
     * "none" and keeps the empty string, and any other option means "put it
     * back" and gets its default: a triage label called nothing is not
     * something anyone means, while no excluded labels plainly is.
     */
    const resolveSetting = (key, stored) => {
        const fallback = DEFAULT_SETTINGS[key];

        if (typeof fallback === 'boolean') {
            return typeof stored === 'boolean' ? stored : fallback;
        }
        if (typeof stored !== 'string') return fallback;

        const trimmed = stored.trim();
        if (trimmed) return trimmed;

        const option = settingFor(key);
        return option && option.clearable ? '' : fallback;
    };

    const settingValue = (key) => resolveSetting(key, settings[key]);

    // Every key the page knows, resolved; a key storage still holds but the
    // catalogue has dropped does not come along.
    const resolveSettings = (raw) => {
        const source = raw || {};
        const resolved = {};
        Object.keys(DEFAULT_SETTINGS).forEach((key) => {
            resolved[key] = resolveSetting(key, source[key]);
        });
        return resolved;
    };

    // The declaration above runs before the catalogue exists, and resolving
    // needs the catalogue to know which fields may be empty; so the values
    // are resolved here, once it does.
    settings = resolveSettings(settings);

    /*
     * Where a changed setting goes. The page owns none of the three stores,
     * so it hands the value to whichever host is here: the shell apps expose
     * window.native, the extension leaves a mark on the root element and
     * listens for a posted message, and a plain browser tab has neither and
     * keeps its own copy.
     *
     * Each host echoes the change back through applySettings, so the local
     * object is updated here only so that the page and the mode agree before
     * the round trip lands.
     */
    const hostIsExtension = () =>
        document.documentElement.dataset.fastmailCustomHost === 'extension';

    const writeSetting = (key, value) => {
        settings[key] = resolveSetting(key, value);

        if (window.native && typeof window.native.setSetting === 'function') {
            window.native.setSetting(key, value);
            return;
        }

        if (hostIsExtension()) {
            window.postMessage(
                { source: 'fastmail-custom', kind: 'setting', key: key, value: value },
                location.origin
            );
            return;
        }

        try {
            const stored = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY)) || {};
            stored[key] = value;
            localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(stored));
        } catch (error) {
            reportFault('could not save that setting');
        }
    };

    /*
     * Settings sync. A host that can keep these settings in iCloud, which is
     * the apps and the Safari extension, says so by setting
     * window.__fastmailCustomSync = {enabled} beside the settings, and sets it
     * again before every applySettings. A plain browser tab has no such
     * object, so it draws no switch.
     *
     * The host keeps each Fastmail account's settings apart, so the page
     * tells it which account it is, once per load. Fastmail's session can
     * arrive after its router and classes, so the page asks again every half
     * second for a minute and then lets go; a page that never learns its
     * account keeps its settings on this device, as before.
     */
    const SYNC_GROUP = { id: 'sync', title: 'Sync' };
    const SYNC_TITLE = 'Sync settings with iCloud';
    const SYNC_HINT = 'Keeps these settings the same on your other devices for this Fastmail account. ' +
        'The bar lengths stay on each device. Turning syncing on takes the settings already in iCloud.';
    const ACCOUNT_REPORT_DELAY = 500;
    const ACCOUNT_REPORT_TRIES = 120;

    const syncState = () => {
        const sync = window.__fastmailCustomSync;
        return sync && typeof sync.enabled === 'boolean' ? sync : null;
    };

    // The host's echo comes back through applySettings; the state changes
    // here first, so the switch and the page agree until it lands.
    const writeSyncEnabled = (enabled) => {
        window.__fastmailCustomSync = { enabled: enabled };

        if (window.native && typeof window.native.setSettingsSync === 'function') {
            window.native.setSettingsSync(enabled);
            return;
        }

        if (hostIsExtension()) {
            window.postMessage(
                { source: 'fastmail-custom', kind: 'sync', enabled: enabled },
                location.origin
            );
        }
    };

    const reportAccount = (accountId) => {
        if (window.native && typeof window.native.account === 'function') {
            window.native.account(accountId);
            return;
        }

        if (hostIsExtension()) {
            window.postMessage(
                { source: 'fastmail-custom', kind: 'account', accountId: accountId },
                location.origin
            );
        }
    };

    let accountReportStarted = false;

    const reportAccountWhenKnown = () => {
        if (accountReportStarted) return;
        accountReportStarted = true;
        let tries = 0;
        const attempt = () => {
            let accountId = null;
            try {
                accountId = window.FastMail ? primaryMailAccountId() : null;
            } catch (error) {
                accountId = null;
            }
            if (typeof accountId === 'string' && accountId) {
                reportAccount(accountId);
                return;
            }
            tries += 1;
            if (tries < ACCOUNT_REPORT_TRIES) setTimeout(attempt, ACCOUNT_REPORT_DELAY);
        };
        attempt();
    };

    /*
     * The switch, in its own section at the bottom of the page, in a view of
     * its own so that a change made in another window redraws the switch and
     * nothing else on the page. A switch just flipped here already shows
     * what the host will echo back, so that echo redraws nothing.
     */
    let syncRowView = null;
    let syncRowShown = null;

    const syncRow = (classes) => {
        const holder = new classes.View({
            draw: () => {
                const state = syncState();
                syncRowShown = state ? state.enabled : null;
                if (!state) return [];

                const box = new classes.ToggleView({
                    label: SYNC_TITLE,
                    description: SYNC_HINT,
                    value: state.enabled
                });
                box.addObserverForKey('value', {
                    changed: () => {
                        const enabled = !!box.get('value');
                        syncRowShown = enabled;
                        writeSyncEnabled(enabled);
                    }
                }, 'changed');
                return [box];
            }
        });
        syncRowView = holder;
        return holder;
    };

    const refreshSyncRow = () => {
        const state = syncState();
        const shown = state ? state.enabled : null;
        if (!syncRowView || shown === syncRowShown) return;
        try {
            if (syncRowView.get('isInDocument')) syncRowView.viewNeedsRedraw();
        } catch (error) {
            reportFault('the iCloud sync switch could not be redrawn', error);
        }
    };

    /*
     * ----------------------------------------------------------------
     * General helper functions
     * ----------------------------------------------------------------
     */

    // Get controller
    const controller = () => FastMail.router.getAppController('mail');

    /*
     * ----------------------------------------------------------------
     * Saying when something did not work
     * ----------------------------------------------------------------
     *
     * This mode is full of places that give up quietly: a view that is not
     * drawn yet, a bar being rebuilt underneath us, a name the app has
     * stopped answering to. Carrying on is right; half a toolbar is worse
     * than none; but going quiet about it is not. The Labels button was
     * missing for days, through three wrong diagnoses, and at no point did
     * anything say "I looked for Labels and could not find it". A console
     * warning is no help either: there is no console on a phone.
     *
     * So a failure that matters raises Fastmail's own toast, the one an
     * archive raises. Once per distinct failure, since these run on every
     * redraw and the second thousand tell you nothing the first did not.
     */

    const faultsReported = new Set();
    let notificationView = null;

    /*
     * Fastmail's toast host, found by walking the root view for one of that
     * class. By class rather than by CSS name: the markup is Fastmail's to
     * rename and the class is the thing itself.
     */
    const notifications = () => {
        if (notificationView) return notificationView;

        const Container = FastMail.classes.NotificationContainerView;
        if (!Container) return null;

        const walk = (view, depth) => {
            if (!view || depth > 6) return null;
            if (view instanceof Container) return view;

            let children = [];
            try {
                children = view.get('childViews') || [];
            } catch (error) {
                return null;
            }

            for (const child of children) {
                const found = walk(child, depth + 1);
                if (found) return found;
            }
            return null;
        };

        notificationView = walk(FastMail.root, 0);
        return notificationView;
    };

    const reportFault = (what, error) => {
        if (error !== undefined) console.warn('Fastmail Custom: ' + what, error);
        else console.warn('Fastmail Custom: ' + what);

        if (faultsReported.has(what)) return;
        faultsReported.add(what);

        try {
            const host = notifications();
            // Long enough to read and dismissible, since it is not routine
            if (host) host.toast('Fastmail Custom: ' + what, 8000, true);
        } catch (toastError) {
            // The console line above is all that is left
        }
    };

    // Overture collections are sometimes real arrays and sometimes record
    // arrays.
    const toArray = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (typeof value.map === 'function') return value.map(item => item);
        if (typeof value.get === 'function') return toArray(value.get('[]'));
        if (typeof value.length === 'number') return Array.prototype.slice.call(value);
        return [];
    };

    // A user label is a mailbox without a system role
    const isUserLabel = (mailbox) => !!mailbox && !mailbox.get('role');

    // Fastmail names a chip by the mailbox's full path; "Projects/Work", not
    // "Work"; while the record's name and displayName are only the leaf.
    const parentOf = (mailbox) => {
        if (!mailbox || !mailbox.get) return null;

        try {
            return mailbox.get('parent');
        } catch (error) {
            return null;
        }
    };

    // Mailbox has a pathName of its own; parent's pathName, a slash, this
    // one's displayName, and the row chips carry it as their title, so asking
    // for it is both shorter and the only way to be sure the two agree.
    const mailboxPath = (mailbox) => {
        try {
            const own = mailbox && mailbox.get && mailbox.get('pathName');
            if (typeof own === 'string' && own) return own;
        } catch (error) {
            // Fall through to working it out
        }

        const parts = [];
        let node = mailbox;

        while (node && node.get) {
            parts.unshift(node.get('displayName') || node.get('name'));

            // A cycle would hang the loop; depth is a cheap guard
            if (parts.length > 20) break;
            node = parentOf(node);
        }

        return parts.join('/');
    };

    // A label nested inside the Inbox is drawn under it, and as far as the
    // sidebar's shape goes it belongs to it: a line between the two would cut
    // the Inbox off from its own children, and a second one below them would
    // make the system folder that follows look like the start of something
    // new.
    const isUnderInbox = (mailbox) => {
        let node = parentOf(mailbox);

        // Same depth guard as mailboxPath, for the same reason
        for (let depth = 0; node && node.get && depth < 20; depth += 1) {
            if (node.get('role') === 'inbox') return true;
            node = parentOf(node);
        }

        return false;
    };

    // Labels struck from the project set by name; Later holds mail, it does
    // not file it, a rule of yours, so it is named rather than worked out.
    let excludedCache = null;

    const excludedPaths = () => {
        const key = String(settings.excludedLabels || '');
        if (excludedCache && excludedCache.key === key) return excludedCache.paths;

        const paths = key.split(',')
            .map(part => part.trim())
            .filter(Boolean);

        excludedCache = { key: key, paths: paths };
        return paths;
    };

    const isExcludedLabel = (mailbox) => {
        const path = mailboxPath(mailbox).toLowerCase();
        return excludedPaths().some(named => named.toLowerCase() === path);
    };

    // Visible in the sidebar: bit 1 of Fastmail's own hidden flag is "not in
    // the folder list"; measured: 0 on sidebar labels, 1 on the archive shelf,
    // 3 on a label hidden everywhere.
    const isSidebarLabel = (mailbox) => !(Number(mailbox.get('hidden')) & 1);

    /*
     * ----------------------------------------------------------------
     * The state mailboxes: Inbox and Triage
     * ----------------------------------------------------------------
     */

    // These are asked on every badge paint and inside computed properties, so
    // they are cached per account and dropped whenever a Mailbox record
    // changes; the same store event that already rebuilds the stylesheet.
    const labelCache = new Map();
    // Whether a label has labels under it, answered once per label. A label
    // gaining or losing a child is a Mailbox change like any other, so the
    // two caches are dropped together.
    const sublabelCache = new Map();

    const forgetLabelCache = () => {
        labelCache.clear();
        sublabelCache.clear();
        expandedRootLabelIds.clear();
    };

    const pathsFromSetting = (value) => String(value || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

    const mailboxesOf = (accountId) => FastMail.store.getAll(FastMail.classes.Mailbox)
        .filter(m => !accountId || m.get('accountId') === accountId);

    // Matched on the full path, case-insensitively, among every mailbox of the
    // account; folders as well as labels, since a setting may name either.
    const findByPath = (accountId, path) => {
        const wanted = String(path || '').toLowerCase();
        if (!wanted) return null;

        return mailboxesOf(accountId)
            .filter(m => mailboxPath(m).toLowerCase() === wanted)[0] || null;
    };

    let warnedNoTriage = '';

    const stateLabels = (accountId) => {
        const key = accountId || '';
        let cached = labelCache.get(key);
        if (cached) return cached;

        cached = {
            inbox: mailboxesOf(accountId).filter(m => m.get('role') === 'inbox')[0] || null,
            triage: findByPath(accountId, settings.triageLabel)
        };

        if (settings.triageLabel && !cached.triage && warnedNoTriage !== settings.triageLabel) {
            warnedNoTriage = settings.triageLabel;
            reportFault('no label named "' + settings.triageLabel +
                '"; v takes nothing off and archive strips no Triage until it exists');
        }

        labelCache.set(key, cached);
        return cached;
    };

    const inboxMailbox = (accountId) => stateLabels(accountId).inbox;
    const triageMailbox = (accountId) => stateLabels(accountId).triage;

    const isTriage = (mailbox) => !!mailbox &&
        mailbox === triageMailbox(mailbox.get('accountId'));

    // A project: a user label shown in the sidebar, not struck out by name,
    // and not Triage.
    const isProject = (mailbox) => isUserLabel(mailbox) &&
        isSidebarLabel(mailbox) && !isExcludedLabel(mailbox) && !isTriage(mailbox);

    // Where a message can be filed: a project, or a hold label named in
    // settings.excludedLabels; one at a time, and a hold label survives
    // archive where a project does not
    const isDestination = (mailbox) => isProject(mailbox) || isExcludedLabel(mailbox);

    // Whether anything in the sidebar sits under this label. Hidden children
    // do not count: a label whose only children are off the sidebar reads as
    // a leaf there, and reading as one is what this is about.
    const hasSublabels = (mailbox) => {
        if (!mailbox || !mailbox.get) return false;

        const cached = sublabelCache.get(mailbox);
        if (cached !== undefined) return cached;

        const found = mailboxesOf(mailbox.get('accountId')).some(other =>
            other !== mailbox && parentOf(other) === mailbox && isSidebarLabel(other));

        sublabelCache.set(mailbox, found);
        return found;
    };

    /*
     * The head of a nest, which is not a place to put anything.
     *
     * A nested label names a thing and a kind of thing: Boards/ZonMw is the
     * board, Boards is the shelf it sits on. Mail belongs to the board. So a
     * label with labels under it is never offered as somewhere to keep a
     * message, never accepts a drop, and never appears in the narrowed list;
     * and a label with nothing under it is where every filing lands, nested
     * or not.
     *
     * Only about the mode's own routes. Fastmail's Labels menu still offers
     * every label it has, because that menu adds the label you ticked and
     * makes no claim about where the message lives.
     */
    const isRootLabel = (mailbox) => isDestination(mailbox) && hasSublabels(mailbox);

    // Where a keep can actually put a message.
    const isKeepTarget = (mailbox) => isDestination(mailbox) && !hasSublabels(mailbox);

    /*
     * A destination and every destination above it, outermost first.
     *
     * Fastmail infers neither from the other: a message in Boards/ZonMw is
     * not in Boards, and a list of Boards does not show it. Under this model
     * it should; the shelf holds what is on it; so filing puts the whole
     * chain on rather than the leaf alone.
     *
     * It stops at the first ancestor the model has no opinion about, so a
     * label nested under a system folder carries only what is actually a
     * destination.
     */
    const filingChain = (mailbox) => {
        const chain = [];
        let node = mailbox;

        // The same depth guard as mailboxPath, for the same reason
        for (let depth = 0; node && depth < 20; depth += 1) {
            if (!isDestination(node)) break;
            chain.unshift(node);
            node = parentOf(node);
        }

        return chain;
    };

    // The labels a filing actually applies: what was asked for, and the
    // labels above anything nested in it.
    const withFilingParents = (adds) => {
        const all = adds.slice();

        adds.forEach((mailbox) => {
            filingChain(mailbox).forEach((step) => {
                if (all.indexOf(step) === -1) all.push(step);
            });
        });

        return all;
    };

    /*
     * ----------------------------------------------------------------
     * Counting
     * ----------------------------------------------------------------
     */

    // No scan of loaded messages drives any count here: a badge is its
    // mailbox's own Mailbox.totalThreads, which the server maintains, push
    // updates, and Fastmail adjusts optimistically before the server confirms.

    /*
     * A project label's badge, counted against the Inbox.
     *
     * The model says a project label implies the Inbox, so its total is its
     * queue; but only for mail filed under this model. A label that was in
     * use before it, or one picked from the L-key menu, holds messages that
     * left the Inbox long ago, and the badge then counts history rather than
     * work. settings.filteredLabelCounts counts what the filtered list shows
     * instead: the label and the Inbox both.
     *
     * That number is stored nowhere, so it is a query per label. Collapsed to
     * threads, because that is what a badge counts. Built the first time a
     * badge asks for one and kept, since a live query tracks its own changes;
     * dropped when the setting goes off, so nothing is running for a feature
     * nobody is using.
     */
    const inboxCounts = new Map();

    // A WindowedQuery fetches nothing until a range is observed, and the
    // length is all this wants, so the range is the smallest one there is.
    const COUNT_RANGE = { start: 0, end: 1 };

    // How much of a label's Inbox queue one window can hold.
    const COUNT_WINDOW = 250;

    // Overture's Query.AUTO_REFRESH_IF_OBSERVED. A query is told when the data
    // behind it has changed, but it only goes and looks again if it has been
    // asked to, and the default is never.
    const AUTO_REFRESH_IF_OBSERVED = 1;

    const countRangeObserver = { rangeDidChange() {} };
    const countLengthObserver = { go: () => scheduleBadgeRepaint() };

    const countQueryFor = (mailbox) => {
        const id = mailbox.get('id');
        const held = inboxCounts.get(id);
        if (held) return held;

        const accountId = mailbox.get('accountId');
        const inbox = inboxMailbox(accountId);
        if (!inbox) return null;

        try {
            const params = {
                accountId: accountId,
                where: {
                    operator: 'AND',
                    conditions: [{ inMailbox: id }, { inMailbox: inbox.get('id') }]
                },
                sort: [{ property: 'receivedAt', isAscending: false }],
                collapseThreads: true,
                // A windowed query asks for one window at a time and reports
                // how much it holds, so a badge reading a default query sees
                // about thirty of them however many there are.
                windowSize: COUNT_WINDOW
            };

            // The id has to come from getQueryId: the source resolves a
            // response back to its query by recomputing it from the request,
            // so a query filed under any other id never resolves.
            const query = FastMail.store.getQuery(
                FastMail.classes.Message.getQueryId(params),
                FastMail.classes.MessageList,
                params
            );

            // Without this the badge keeps serving the number it had when the
            // query first landed: a label added to a message marks the query
            // obsolete and nothing refetches it, while allIdsAreLoaded stays
            // true, so countKnown reports the stale length as a certainty.
            query.autoRefresh = AUTO_REFRESH_IF_OBSERVED;

            query.addObserverForRange(COUNT_RANGE, countRangeObserver, 'rangeDidChange');
            query.getObjectAt(0);
            query.addObserverForKey('length', countLengthObserver, 'go');

            inboxCounts.set(id, query);
            return query;
        } catch (error) {
            // No query to be had; the total below still answers
            return null;
        }
    };

    const forgetInboxCounts = () => {
        inboxCounts.forEach((query) => {
            try {
                query.removeObserverForRange(COUNT_RANGE, countRangeObserver, 'rangeDidChange');
                query.removeObserverForKey('length', countLengthObserver, 'go');
            } catch (error) {
                // Already gone
            }
        });
        inboxCounts.clear();
    };

    // What a row's badge reads: the label's own total, or the part of it that
    // is still in the Inbox.
    const countKnown = (query) => {
        if (!query) return null;
        if (!query.hasTotal && !query.get('allIdsAreLoaded')) return null;
        const length = query.get('length');
        return typeof length === 'number' ? length : null;
    };

    const countFor = (mailbox) => {
        if (settings.filteredLabelCounts && isProject(mailbox)) {
            const known = countKnown(countQueryFor(mailbox));
            if (known !== null) return known;
        }

        return mailbox.get('totalThreads') || 0;
    };

    // Badge repaints arrive in bursts as query totals land
    let badgeTimer = null;

    const scheduleBadgeRepaint = () => {
        if (badgeTimer) return;

        badgeTimer = setTimeout(() => {
            badgeTimer = null;
            repaintBadges();
            pushAppBadge();

            // The heading shares the badge queries, but none of its own
            // declared dependencies move when an unread total lands
            try {
                controller().computedPropertyDidChange('mailboxTitleAndCount');
            } catch (error) {
                // No mail screen, no heading
            }
        }, 100);
    };

    /*
     * The app icon's badge, for the shell apps. The harness they inject
     * exposes window.native, a resolver it pulls on foreground, a setBadge
     * it forwards to the dock and the home screen; so the whole feature is
     * choosing the number: the total of settings.appBadgeLabel, summed
     * across accounts. In plain Safari there is no window.native and none
     * of this runs.
     */
    const appBadgeCount = () => {
        const path = String(settings.appBadgeLabel || '').trim().toLowerCase();
        if (!path) return null;

        let total = 0;
        let found = false;

        FastMail.store.getAll(FastMail.classes.Mailbox).forEach((mailbox) => {
            if (mailboxPath(mailbox).toLowerCase() !== path) return;
            found = true;
            total += mailbox.get('totalThreads') || 0;
        });

        return found ? total : null;
    };

    let lastAppBadge = null;

    const pushAppBadge = () => {
        if (!window.native || typeof window.native.setBadge !== 'function') return;

        const count = appBadgeCount();
        if (count === null || count === lastAppBadge) return;

        lastAppBadge = count;
        window.native.setBadge(count);
    };

    // The resolver is the pull half: the shell asks on foreground, when a
    // pushed number may be long stale.
    const installAppBadge = () => {
        if (!window.native) return;

        window.native.badgeResolver =
            String(settings.appBadgeLabel || '').trim()
                ? () => appBadgeCount()
                : null;
    };

    /*
     * ----------------------------------------------------------------
     * The list's own total, above the Inbox's or a project's rows
     * ----------------------------------------------------------------
     *
     * Fastmail draws a divider there itself, "Unread N", the header of the
     * one named bucket a grouping puts a label on; a project or the Inbox
     * is read as a queue here, though, so what belongs there is the queue's
     * whole length, with what is still unread alongside it rather than
     * standing in for it. Replaces that divider, since a bucket titled
     * "Unread" holding the queue's total would be its own contradiction;
     * a grouping that draws no such divider gets no line here either,
     * rather than one pasted in without a bucket to sit in.
     */
    const MAILBOX_SUMMARY_CLASS = 'custom-mailboxListSummary';

    const mailboxSummaryApplies = (mailbox) => !!mailbox &&
        (mailbox.get('role') === 'inbox' || isTriage(mailbox) || isProject(mailbox));

    const mailboxSummaryText = () => {
        const mailController = controller();
        if (mailController.get('search')) return null;

        const mailbox = mailController.get('mailbox');
        if (!mailboxSummaryApplies(mailbox)) return null;

        const total = countFor(mailbox);
        const unread = mailbox.get('unreadThreads') || 0;
        return unread > 0 ? `${total} (${unread})` : String(total);
    };

    // The divider stands on its own, not under a title guaranteed to be
    // drawn above it: some layouts draw no page title over the list at
    // all, and a bare count sitting where "Unread" used to name it reads
    // as nothing in particular. The name makes the line its own sentence.
    const mailboxSummaryLine = () => {
        const text = mailboxSummaryText();
        if (text === null) return null;

        const mailbox = controller().get('mailbox');
        const name = mailbox && mailbox.get('name');
        return name ? `${name} • ${text}` : text;
    };

    // Whether ensureMailboxTitle is the one carrying the name and count
    // right now, the same three conditions it gates on itself.
    const mailboxTitleActive = () =>
        settings.showMailboxTitle &&
        !isPhoneLayout() && !isTabletLayout();

    // The bold label is only there to recognise the row the first time;
    // once dressed, the class left on it is the mark a later pass reads
    // instead, since the label itself is gone by then.
    const dressMailboxListTitle = (node) => {
        // Something else already says this: the standalone title on
        // desktop, or Fastmail's own native title on phone and tablet,
        // which mailboxTitleActive() itself stands aside for but keeps
        // showing regardless of the setting. Either way a divider
        // repeating it would only be the same line twice.
        if (mailboxTitleActive() || isPhoneLayout() || isTabletLayout()) return;

        if (!node.classList.contains(MAILBOX_SUMMARY_CLASS)) {
            const label = node.querySelector('b');
            if (!label || label.textContent.trim() !== 'Unread') return;
        }

        const text = mailboxSummaryLine();
        if (text === null || node.dataset.customDressed === text) return;

        node.dataset.customDressed = text;
        node.classList.add(MAILBOX_SUMMARY_CLASS);
        node.textContent = text;
    };

    // A filter narrows the queue rather than grouping it, so it earns no
    // divider of its own; Fastmail already names the filter in the title's
    // own subtitle ("Personal • In Inbox"), and what is missing there is how
    // many the narrowed list actually holds.
    const mailboxFilteredCount = () => {
        const mailController = controller();
        if (mailController.get('search') || !mailController.get('mailboxFilter')) {
            return null;
        }
        if (!mailboxSummaryApplies(mailController.get('mailbox'))) return null;

        const list = mailController.get('mailboxMessageList');
        const length = list && list.get('length');
        return typeof length === 'number' ? length : null;
    };

    // The subtitle's own text, before any count joins it, kept once so a
    // count that changes edits from there rather than piling onto its own
    // last edit.
    const dressPageSubtitle = (node) => {
        if (node.dataset.customBase === undefined) {
            node.dataset.customBase = node.textContent;
        }

        const base = node.dataset.customBase;
        const count = mailboxFilteredCount();
        const text = count === null ? base : `${base} • ${count}`;

        if (node.textContent !== text) node.textContent = text;
    };

    // The mirror of mailboxTitleActive() for phone and tablet: Fastmail
    // draws its own title there unconditionally, which is why the
    // standalone one never activates on those layouts, but the setting
    // should still reach what that native title says. Only in Mail: every
    // app draws its title in the same .v-Page-title, and the mail
    // controller keeps its mailbox while Contacts or Files is showing.
    const nativeMailboxTitleActive = () =>
        settings.showMailboxTitle &&
        (isPhoneLayout() || isTabletLayout()) &&
        FastMail.router.get('app') === 'mail';

    // Fastmail's own title, replaced wholesale rather than appended to
    // like dressPageSubtitle: mailboxSummaryLine() is already the full
    // line wanted, freshly computed from the current mailbox each call,
    // so there is no per-element "base" worth remembering, and the two
    // synced copies (the large title and the one it shrinks into on
    // scroll) both take it the same way Fastmail keeps their own text in
    // sync with each other.
    const dressNativeMailboxTitle = (node) => {
        if (!nativeMailboxTitleActive()) return;
        const text = mailboxSummaryLine();
        if (text === null || node.textContent === text) return;
        // Into Fastmail's own text node where there is one, rather than
        // replacing it: if Fastmail updates that node when its title
        // changes, a replaced node would leave the title stuck on the
        // mailbox after switching to another app.
        const only = node.childNodes.length === 1 && node.firstChild;
        if (only && only.nodeType === Node.TEXT_NODE) only.data = text;
        else node.textContent = text;
    };

    const removeMailboxTitle = () => {
        const el = document.getElementById(MAILBOX_TITLE_ID);
        if (el) el.remove();
        const compact = document.getElementById(MAILBOX_TITLE_COMPACT_ID);
        if (compact) compact.remove();
    };

    // Where the compact title lands once the big one has scrolled past:
    // the same row as the list's own Select all checkbox, so scrolling
    // reads as the title shrinking into it rather than costing its own
    // extra row the way a merely-sticky title would.
    const mailboxTitleCheckbox = () => {
        const checkbox = document.querySelector('.v-SelectAllCheckbox');
        return checkbox && checkbox.closest('.v-Toolbar') ? checkbox : null;
    };

    // The compact title's resting transform: enlarged and shifted to sit
    // exactly where the big title is, so the crossfade in updateMailbox-
    // TitleScrolled reads as one title shrinking into place. Neither
    // element is inside the scrolling container (both are flex siblings
    // of it), so their viewport positions are already scroll-invariant —
    // no scrollTop correction needed. The translate is unaffected by the
    // scale next to it in the same transform, since scale, being closer
    // to the element, applies first and translate shifts the
    // already-scaled box in the parent's own pixels.
    const positionMailboxTitleCompact = (compact, big) => {
        const bigRect = big.getBoundingClientRect();
        const compactRect = compact.getBoundingClientRect();
        const tx = bigRect.left - compactRect.left;
        const ty = bigRect.top - compactRect.top;
        const scale = MAILBOX_TITLE_FONT_SIZE / MAILBOX_TITLE_COMPACT_FONT_SIZE;
        compact.style.setProperty(
            '--custom-mailboxTitleExpand',
            'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')'
        );
    };

    const ensureMailboxTitleCompact = (big) => {
        const checkbox = mailboxTitleCheckbox();
        if (!checkbox) {
            const stale = document.getElementById(MAILBOX_TITLE_COMPACT_ID);
            if (stale) stale.remove();
            return;
        }

        let el = document.getElementById(MAILBOX_TITLE_COMPACT_ID);
        let changed = false;
        if (!el) {
            el = document.createElement('span');
            el.id = MAILBOX_TITLE_COMPACT_ID;
            changed = true;
        }
        if (el.dataset.customKey !== big.dataset.customKey) {
            el.dataset.customKey = big.dataset.customKey;
            el.textContent = '';
            big.childNodes.forEach((node) => el.appendChild(node.cloneNode(true)));
            changed = true;
        }
        if (el.previousElementSibling !== checkbox) {
            checkbox.insertAdjacentElement('afterend', el);
            changed = true;
        }
        // ensureMailboxTitle runs on every list mutation (MutationObserver
        // on document.body), which is most of them; getBoundingClientRect
        // forces a synchronous layout, so only paying for it when the
        // title was actually created, changed or moved keeps the common
        // no-op call cheap instead of reflowing the page on every row the
        // list recycles.
        if (changed) positionMailboxTitleCompact(el, big);
    };

    const MAILBOX_TITLE_SCROLL_THRESHOLD = 20;

    const updateMailboxTitleScrolled = (container) => {
        const scrolled = container.scrollTop > MAILBOX_TITLE_SCROLL_THRESHOLD;
        const big = document.getElementById(MAILBOX_TITLE_ID);
        const compact = document.getElementById(MAILBOX_TITLE_COMPACT_ID);
        if (big) big.classList.toggle(MAILBOX_TITLE_SCROLLED_CLASS, scrolled);
        if (compact) compact.classList.toggle(MAILBOX_TITLE_SCROLLED_CLASS, scrolled);
    };

    // Attached once per scroll container; a mailbox switch replaces the
    // container's content but not the container itself, so the listener
    // keeps working across route changes without being re-added.
    const watchMailboxTitleScroll = (container) => {
        if (container.dataset.customTitleScrollWatch) return;
        container.dataset.customTitleScrollWatch = 'true';
        container.addEventListener('scroll', () => updateMailboxTitleScrolled(container));
    };

    const ensureMailboxTitle = () => {
        if (!mailboxTitleActive()) {
            removeMailboxTitle();
            return;
        }

        const mailbox = controller().get('mailbox');
        const name = mailbox && mailbox.get('name');
        const titles = document.querySelector('.v-MailboxListTitles');
        const container = titles && titles.parentElement;
        const pagePane = container && container.parentElement;
        if (!name || !container || !pagePane) {
            removeMailboxTitle();
            return;
        }

        // The Inbox, Triage or a project reads as a queue, so its title
        // carries the same total (and unread) the list's own divider
        // does, in the divider's own subdued colour rather than the
        // name's; anything else (Sent, Drafts, …) is not a queue and
        // keeps to its plain name.
        const count = mailboxSummaryText();
        const key = name + '|' + count;

        let el = document.getElementById(MAILBOX_TITLE_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = MAILBOX_TITLE_ID;
        }
        if (el.dataset.customKey !== key) {
            el.dataset.customKey = key;
            el.textContent = '';
            el.appendChild(document.createTextNode(name));
            if (count !== null) {
                const countEl = document.createElement('span');
                countEl.className = MAILBOX_TITLE_COUNT_CLASS;
                countEl.textContent = ' • ' + count;
                el.appendChild(countEl);
            }
        }
        // A flex sibling of the scrolling container, never a child of it:
        // that container is Fastmail's own, its rows recycled by Ember,
        // and a mailbox switch replaces .v-MailboxListTitles inside it —
        // exactly when a node written into that subtree previously
        // corrupted the next render, leaving the list frozen on the old
        // mailbox's rows. .v-Page is a flex column, so sitting ahead of
        // the content pane here still pushes it down, the same effect
        // insertBefore into the pane itself used to give directly.
        if (el.nextSibling !== container) pagePane.insertBefore(el, container);

        ensureMailboxTitleCompact(el);
        watchMailboxTitleScroll(container);
        updateMailboxTitleScrolled(container);
    };

    const refreshMailboxSummary = () => {
        document.querySelectorAll('.v-MailboxListTitles-title')
            .forEach(dressMailboxListTitle);
        document.querySelectorAll('.v-Page-subtitle')
            .forEach(dressPageSubtitle);
        document.querySelectorAll('.v-Page-title')
            .forEach(dressNativeMailboxTitle);
        ensureMailboxTitle();
    };

    // A filtered list's own length is what the subtitle's count reads, and
    // filing a message out of it changes that length without the list
    // itself being replaced; watched the same way watchGroupCounts watches
    // a list's own counts, once per list rather than once per read.
    const watchMailboxSummaryList = () => {
        const list = controller().get('mailboxMessageList');
        if (!list || list.customSummaryWatch) return;
        list.customSummaryWatch = true;
        list.addObserverForKey('length', { go: refreshMailboxSummary }, 'go');
    };

    // A redraw, not a rename: the row this dresses only ever comes and goes
    // with the grouping, so watching for it arriving is watching for the
    // list itself being drawn, which a route change and a scroll both do.
    let mailboxSummaryWatched = false;

    const watchMailboxListTitles = () => {
        if (mailboxSummaryWatched) return;
        mailboxSummaryWatched = true;

        new MutationObserver(refreshMailboxSummary)
            .observe(document.body, { childList: true, subtree: true });
    };

    /*
     * ----------------------------------------------------------------
     * Badges
     * ----------------------------------------------------------------
     */

    // Every drawn mailbox row in the sidebar, with its view
    const sidebarRows = () => {
        const rows = [];

        document.querySelectorAll('.v-MailboxSource').forEach(el => {
            const view = FastMail.getViewFromNode(el);
            if (!view || typeof view.redrawBadgeCount !== 'function') return;

            const mailbox = view.get('content');
            // The row element as well as the view: getViewFromNode walks up to
            // find the view, so its layer is not necessarily the node matched
            if (mailbox) rows.push({ view, mailbox, el });
        });

        return rows;
    };

    // Root labels whose children are currently drawn beneath them. Fastmail
    // expresses collapse by removing the child rows from the DOM rather than
    // flagging the mailbox or its view (see watchLabels below), so this is
    // read off the drawn rows themselves: a root label counts as expanded
    // when the very next drawn row belongs to one of its children.
    let expandedRootLabelIds = new Set();

    const refreshRootLabelExpansion = () => {
        const rows = sidebarRows();
        const next = new Set();

        rows.forEach((row, index) => {
            if (!isRootLabel(row.mailbox)) return;
            const child = rows[index + 1];
            if (child && parentOf(child.mailbox) === row.mailbox) {
                next.add(row.mailbox.get('id'));
            }
        });

        let changed = next.size !== expandedRootLabelIds.size;
        if (!changed) {
            expandedRootLabelIds.forEach((id) => { if (!next.has(id)) changed = true; });
        }

        expandedRootLabelIds = next;
        if (changed) scheduleBadgeRepaint();
    };

    // Run fn while our count stands in for the mailbox's badge count.
    const withInboxCount = (mailbox, fn) => {
        const stock = mailbox.badgeCount;
        // Collapsed root labels count as usual; expanded ones hand the count
        // to their children instead, if the setting for that is on.
        const hideExpandedRoot = settings.collapsedLabelCounts && isRootLabel(mailbox) &&
            expandedRootLabelIds.has(mailbox.get('id'));

        mailbox.badgeCount = hideExpandedRoot ? 0 : countFor(mailbox);
        try {
            return fn();
        } finally {
            mailbox.badgeCount = stock;
        }
    };

    // Triage and the projects show their totals; a helper label keeps whatever Fastmail draws
    const managesBadge = (mailbox) => !!mailbox &&
        (mailbox.get('role') === 'inbox' || isTriage(mailbox) || isProject(mailbox));

    // Wrap the two places that read badgeCount when painting a row:
    // draw() for a row appearing for the first time, redrawBadgeCount() after that
    const patchBadgeRendering = () => {
        const proto = FastMail.classes.MailboxSourceView.prototype;
        const drawOriginal = proto.draw;
        const redrawOriginal = proto.redrawBadgeCount;

        proto.draw = function () {
            const mailbox = this.get('content');
            if (!managesBadge(mailbox)) {
                return drawOriginal.apply(this, arguments);
            }

            const args = arguments;
            return withInboxCount(mailbox, () => drawOriginal.apply(this, args));
        };

        proto.redrawBadgeCount = function () {
            const mailbox = this.get('content');
            if (!managesBadge(mailbox)) {
                return redrawOriginal.apply(this, arguments);
            }

            const args = arguments;
            return withInboxCount(mailbox, () => redrawOriginal.apply(this, args));
        };
    };

    // Repaint every drawn row. Only needed when the counts themselves change,
    // or when the mode is toggled: any redraw Fastmail triggers for its own
    // reasons already goes through the patch above.
    const repaintBadges = () => {
        sidebarRows().forEach(({ view }) => {
            // A view that has not drawn yet has no badge element to repaint
            if (!view._badge) return;
            try {
                view.redrawBadgeCount();
            } catch (error) {
                reportFault('could not repaint a badge', error);
            }
        });
    };

    /*
     * ----------------------------------------------------------------
     * Navigation
     * ----------------------------------------------------------------
     */

    // Go somewhere the way clicking the sidebar would.
    const selectSource = (source) => {
        if (source) controller().sources.select(source);
    };

    // The sources above the Labels heading; Inbox, Snoozed, Drafts and so on.
    const sourcesAboveLabels = () => {
        const groups = toArray(controller().sources.sourceGroups());
        const first = groups[0];
        const content = first && (first.content || (first.get && first.get('content')));
        const above = toArray(content);

        if (above.length) return above;

        const accountId = controller().get('accountId');

        return FastMail.store.getAll(FastMail.classes.Mailbox)
            .filter(m => m.get('role') && m.get('accountId') === accountId)
            .sort((a, b) => a.get('sortOrder') - b.get('sortOrder'));
    };

    const goToSourceAt = (index) => selectSource(sourcesAboveLabels()[index]);

    /*
     * One step through the sidebar, Fastmail's own way.
     *
     * Its sidebar is a selection over the drawn list, and selectUp and
     * selectDown are what its own arrow keys use; so a step here lands
     * wherever clicking would, skips the headings, and goes to the place
     * rather than merely highlighting it. Nothing to do when the sidebar is
     * not there to walk, as on a phone with the list on screen.
     */
    const walkSidebar = (direction) => {
        try {
            const sources = controller().sources;
            if (sources && typeof sources[direction] === 'function') {
                sources[direction]();
            }
        } catch (error) {
            reportFault('could not step through the sidebar', error);
        }
    };

    /*
     * ----------------------------------------------------------------
     * Inbox label on message rows
     * ----------------------------------------------------------------
     */

    // Every row in an inbox-filtered label is in the Inbox by definition, so
    // the Inbox chip on each row says nothing.
    const cssString = (value) => String(value).replace(/["\\]/g, '\\$&');

    const inboxChipRules = () => {
        const names = FastMail.store.getAll(FastMail.classes.Mailbox)
            .filter(m => m.get('role') === 'inbox')
            .map(m => mailboxPath(m))
            .filter((name, index, all) => name && all.indexOf(name) === index);

        return names.reduce((rules, name) => rules.concat([
            // The list, where the chip is a span carrying the name as its title
            `.${HIDE_INBOX_LABEL_CLASS} .v-MailboxItem-mailbox` +
            `:has(> span[title="${cssString(name)}"])` +
            ' { display: none; }',

            // The open message, which draws its labels differently: a .u-badge
            // holding a link and a remove button.
            `.${HIDE_INBOX_LABEL_CLASS} .v-ThreadLabels .u-badge` +
            `:has(> a[href*="/mail/${cssString(encodeURIComponent(name))}/"])` +
            ' { display: none; }',

            // The phone's badge is a span with no href, so it is matched on
            // the name stamped by markBadge instead.
            `.${HIDE_INBOX_LABEL_CLASS} .v-ThreadLabels` +
            ` .u-badge[${BADGE_NAME}="${cssString(name)}"]` +
            ' { display: none; }'
        ]), []);
    };

    /*
     * Wash each row in the colour of a label it carries, and darken the whole
     * of that wash when the row is the one you are on.
     *
     * Two decisions are worth writing down, because the obvious way to do
     * either of them is what this replaced.
     *
     * The colour is written into each label's own rules rather than set as a
     * property on the row and read back by one shared rule. The shared rule
     * is tidier and it does not survive contact with the list, which recycles
     * its rows as you scroll: WebKit does not reliably work a blend out again
     * when the property it reads changes underneath, so a row could go on
     * wearing the colour of whichever message used to live in it. Written per
     * label there is nothing per row to go stale.
     *
     * And the highlight is a step from the row's own resting colour toward
     * the page's text colour, rather than a blend toward Fastmail's highlight
     * background. Blending toward that background means the size of the
     * change depends on how near the label already is to it; on an account
     * whose highlight is a pale green and whose busiest label is a green, the
     * two land on nearly the same colour and being on a row stops showing at
     * all. A step toward the text is the same size of step whatever the
     * label, and it is the right direction in a dark theme too, where the
     * text is the light end.
     */
    const PAGE_BG = 'var(--ui-page-color-bg, #fff)';
    const TEXT_FG = 'var(--ui-page-color-fg, #1b1e20)';

    // How far toward the text each state moves. Focused is the row you are
    // on; selected is a row you have ticked, and says so more loudly.
    const FOCUSED_STEP = 12;
    const SELECTED_STEP = 18;

    const TINT_TARGETS = '.u-list-link, .v-MailboxItem-time,' +
        ' .v-MailboxItem-mailboxes, .v-MailboxItem-mailbox, .v-MailboxItem-toolbar';

    const steppedToward = (colour, percent) =>
        `color-mix(in srgb, ${colour} ${100 - percent}%, ${TEXT_FG})`;

    /*
     * The row's own class, said four times, which is not a typo.
     *
     * While the list has the keyboard Fastmail paints the row you are on in
     * the account's selected colour, and it does so through a selector six
     * classes deep rather than the two-deep one the same rule uses otherwise.
     * Being the narrower rule it wins, so the highlight went the account's
     * accent shade; and since that selector reaches the row and its toolbar
     * but not the date beside them, the date was the one part still taking
     * this mode's colour. Which is exactly what it looked like: a row that
     * barely changed, with a small patch by the date that did.
     *
     * Repeating the class is how a selector is made narrower without
     * naming anything new, and it keeps the answer here rather than in a
     * copy of Fastmail's selector that would go quietly wrong the day that
     * selector is renamed. Only the two highlight rules need it; nothing
     * argues with the resting one.
     */
    const NARROW_ROW = '.v-MailboxItem.v-MailboxItem.v-MailboxItem.v-MailboxItem';

    // The three rules one resting colour needs. `on` narrows them to the rows
    // that wear it; empty for the rows that wear none.
    const rowColourRules = (resting, on) => [
        `.v-MailboxItem${on} :is(${TINT_TARGETS})` +
        ` { background-color: ${resting}; }`,
        // The row's class is added to these on purpose, and with no space.
        `.u-list-item.is-focused${NARROW_ROW}${on} :is(${TINT_TARGETS})` +
        ` { background-color: ${steppedToward(resting, FOCUSED_STEP)}; }`,
        `.u-list-item.is-selected${NARROW_ROW}${on} :is(${TINT_TARGETS})` +
        ` { background-color: ${steppedToward(resting, SELECTED_STEP)}; }`
    ];

    // Rows carrying no colour at all still take the step, so being on a row
    // reads the same everywhere in the list rather than only where a label
    // happens to have a colour.
    const ROW_COLOUR_RULES = rowColourRules(PAGE_BG, '');

    const labelColourRules = () => {
        if (!settings.labelColours) return [];

        const rules = ROW_COLOUR_RULES.slice();

        FastMail.store.getAll(FastMail.classes.Mailbox)
            // Triage is on every undecided row, so tinting rows by it would
            // colour the whole group one shade and say nothing.
            .filter(m => isUserLabel(m) && m.get('color') &&
                !(settings.labelColoursSkipTriage && isTriage(m)) &&
                (!settings.labelColoursSidebarOnly || isSidebarLabel(m)))
            .forEach(m => {
                const name = cssString(mailboxPath(m));
                const chip = `.v-MailboxItem-mailbox span[title="${name}"]`;

                // Its own three rules, resting and both highlights, written
                // with the colour in them. A rule that names the label is
                // narrower than the ones above, so it wins on rows wearing it
                // and leaves every other row to them.
                const resting =
                    `color-mix(in srgb, ${m.get('color')} 10%, ${PAGE_BG})`;
                rowColourRules(resting, `:has(${chip})`)
                    .forEach(rule => rules.push(rule));

                // The row is tinted to the chip's own shade, so the chip needs
                // an edge of its own: a hairline on top, right and bottom,
                // leaving the left open so it reads as a tag rather than a
                // box.
                rules.push(`${chip} { box-shadow:` +
                    ` inset 0 1px 0 ${PAGE_BG},` +
                    ` inset -1px 0 0 ${PAGE_BG},` +
                    ` inset 0 -1px 0 ${PAGE_BG}; }`);
            });

        return rules;
    };

    // The line above a row that opens a new run. Which rows those are is
    // worked out in JS; it depends on each mailbox's role, which no selector
    // can see, and marked with a class, leaving the drawing here.
    const SEPARATOR_GAP = 8;

    // Drawn on the row and inset by hand, rather than hung off the link and
    // left to inherit its width.
    const SEPARATOR_INSET = 8;

    // The colour is Fastmail's own divider, falling back to a neutral grey
    // that reads on a light theme or a dark one; the fallback also covers the
    // variable being renamed out from under us.
    const SOURCE_SEPARATOR_RULES = [
        `.${SOURCE_SEPARATOR_CLASS}::before {` +
        ' content: ""; position: absolute;' +
        ` left: ${SEPARATOR_INSET}px; right: ${SEPARATOR_INSET}px;` +
        ` top: -${SEPARATOR_GAP / 2}px; height: 1px;` +
        ' background: var(--ui-color-border, rgba(128, 128, 128, 0.28));' +
        ' pointer-events: none; }'
    ];

    // Fastmail draws the collapse arrow on the Labels heading from
    // showExpando: i.length > 1 in sourceGroups, where i is every account with
    // mail; so a second account puts an arrow there whether or not it shows
    // anything in the sidebar.
    const LONE_SECTION_RULES = [
        `.${LONE_SECTION_CLASS} .v-Sources-expando { display: none; }`
    ];

    // The bar's Pin while the open conversation is pinned: the same pair of
    // theme variables Fastmail's own list rule paints a pinned row's pin with,
    // so the two read as one state in either theme.
    const PIN_STATE_RULES = [
        '.v-Button.custom-pinned svg.v-Icon {' +
        ' color: var(--ui-icon-pin-color-stroke);' +
        ' fill: var(--ui-icon-pin-color-fill); }',
        '.v-Button.custom-pinned svg.v-Icon * { fill: inherit; }'
    ];

    // A group's heading over the list: its name a step larger than the rows
    // under it, and the count beside it as heavy as the name, so the pair
    // reads as one line rather than a label with a footnote.
    const GROUP_TITLE_RULES = [
        '.v-MailboxListTitles-title b { font-size: 1.1em; }',
        '.v-MailboxListTitles-title b + span { font-weight: 700; }'
    ];

    // Compose's Remind button while the message has a reminder, in Fastmail's
    // own success green, which follows the theme the way the pin's pair above
    // does. On the phone the button is an icon alone, so the colour is the
    // whole of what it says.
    const REMINDER_STATE_RULES = [
        '.v-Button.custom-reminder-set svg.v-Icon {' +
        ' color: var(--ui-success-color-fg, #147b33); }'
    ];

    // The badge's unread half: heavier than the total beside it, so the
    // pair reads at a glance as "of which"
    const BADGE_UNREAD_RULES = [
        '.v-MailboxSource-badge b { font-weight: 800; }'
    ];

    // The Triage row wears the funnel, the same glyph as the switch above the
    // list: what it holds is everything still waiting, not a place mail lives.
    const HIDDEN_SOURCE_ICON_CLASS = 'custom-hiddenSourceIcon';

    const TRIAGE_ICON_RULES = [
        '.' + HIDDEN_SOURCE_ICON_CLASS + ' { display: none !important; }'
    ];

    // A pill for passive confirmations; the fallback only: showToast asks
    // Fastmail's own notification layer first and draws this by hand when that
    // container is not there to ask.
    const TOAST_RULES = [
        '.custom-inbox-toast {' +
        ' position: fixed; left: 50%;' +
        ' bottom: calc(72px + env(safe-area-inset-bottom, 0px));' +
        ' transform: translateX(-50%) translateY(6px);' +
        ' z-index: 2147483647; pointer-events: none;' +
        ' max-width: 80vw; overflow: hidden;' +
        ' text-overflow: ellipsis; white-space: nowrap;' +
        ' padding: 8px 14px; border-radius: 8px;' +
        ' background: rgba(24, 24, 24, 0.92); color: #fff;' +
        ' font-size: 13px; line-height: 1.4;' +
        ' opacity: 0; transition: opacity 0.15s ease, transform 0.15s ease; }',
        '.custom-inbox-toast.is-shown {' +
        ' opacity: 1; transform: translateX(-50%) translateY(0); }'
    ];

    // A second pair of up/down buttons for stepping between messages, fixed
    // above the tab bar on the right rather than up in the phone's header,
    // where a thumb holding the phone one-handed cannot reach them. Fastmail's
    // own notification pill (.v-NotificationContainer, the one showToast
    // reaches for first) rises above the message's own action bar when one
    // shows, measured with a message open at 122px above the viewport's own
    // bottom edge; 140px clears it rather than the plainer 72px TOAST_RULES
    // uses for its own hand-drawn fallback, which only has the action bar to
    // clear.
    const FLOATING_NAV_ID = 'custom-message-nav';

    const FLOATING_NAV_RULES = [
        '#' + FLOATING_NAV_ID + ' {' +
        ' position: fixed; right: 16px;' +
        ' bottom: calc(140px + env(safe-area-inset-bottom, 0px));' +
        ' z-index: 2147483000;' +
        ' display: none; flex-direction: column; gap: 10px; }',
        '#' + FLOATING_NAV_ID + '.is-shown { display: flex; }',
        // The compose button's own style, read off Fastmail's own custom
        // properties rather than its computed colours, so the pair follows
        // dark mode (and any future theme) the same way the compose button
        // does instead of freezing today's light-mode values. The literal
        // colours are only the fallback, for the moment before Fastmail's
        // own stylesheet has set these on :root.
        '.custom-message-nav-btn {' +
        ' width: 44px; height: 44px; padding: 0; border: none; border-radius: 50%;' +
        ' display: flex; align-items: center; justify-content: center;' +
        ' background: var(--ui-layer-color-bg, rgb(250, 250, 250));' +
        ' color: var(--ui-page-color-fg, rgb(27, 30, 32));' +
        ' box-shadow: var(--ui-page-shadow, 0 2px 10px rgba(0, 0, 0, 0.1), 0 1px 20px rgba(0, 0, 0, 0.1));' +
        ' -webkit-tap-highlight-color: transparent; }',
        '.custom-message-nav-btn:disabled {' +
        ' background: var(--ui-button-simple-color-bg-disabled, rgba(250, 250, 250, 0.7));' +
        ' color: var(--ui-button-simple-color-fg-disabled, rgba(27, 30, 32, 0.3)); }'
    ];

    // The header's own up/down pair, on <html> rather than <body> for the
    // same reason HIDE_INBOX_LABEL_CLASS is: Fastmail rewrites body.className
    // wholesale on a redraw. Reached by the icon rather than a name Fastmail
    // gives neither button; scoped to a header's own button so a chevron
    // used anywhere else on the page (the main menu carries one too) is left
    // alone.
    const HIDE_MESSAGE_NAV_CLASS = 'custom-hideMessageNav';

    const HIDE_MESSAGE_NAV_RULES = [
        '.' + HIDE_MESSAGE_NAV_CLASS + ' .v-PageHeader-section button.v-Button--iconOnly:has(.i-chevronup),' +
        ' .' + HIDE_MESSAGE_NAV_CLASS + ' .v-PageHeader-section button.v-Button--iconOnly:has(.i-chevrondown)' +
        ' { display: none !important; }'
    ];

    // A row's paperclip ahead of its labels rather than after them. Fastmail
    // places the two independently, each at a fixed offset from the row's
    // right edge, so no rule can swap them while the labels' width varies.
    // Instead Fastmail's own icon is hidden where labels share its line, and
    // the same glyph (its path copied from Fastmail's i-attachment) is drawn
    // as the first item of the labels' own flex row; the labels then take
    // the edge a row without an attachment gives them, so both line up. Only
    // where the two share a line: with previews on, a narrow row puts the
    // paperclip on the subject's line and the labels on the one below.
    const ATTACHMENT_ICON_SVG = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path' +
        ' d="M9.42,13l6.23-6.19c1.13-1.13,2.22-1.2,3-.43.61.61,1.08,1.74-.22,3' +
        'l-7.94,7.89a3.36,3.36,0,0,1-4.75,0h0a3.33,3.33,0,0,1,0-4.72l6.84-6.8"' +
        ' fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"' +
        ' stroke-linejoin="round"/></svg>');
    const ATTACHMENT_BESIDE_LABELS = [
        '.v-Mailbox--short.v-Mailbox--previewOff',
        '.v-Mailbox--long'
    ];
    const attachmentIconRules = () => settings.attachmentBeforeLabels ? [
        ATTACHMENT_BESIDE_LABELS.map(list => list +
            ' .v-MailboxItem-attachments.s-has-attachment:has(~ .v-MailboxItem-mailboxes)')
            .join(', ') + ' { visibility: hidden; }',
        ATTACHMENT_BESIDE_LABELS.map(list => list +
            ' .v-MailboxItem-attachments.s-has-attachment ~ .v-MailboxItem-mailboxes::before')
            .join(', ') + ' {' +
        ' content: ""; flex: none; align-self: center; width: 20px; height: 20px;' +
        ' margin-right: 2px; background-color: var(--ui-button-subtle-color-fg);' +
        ' -webkit-mask: url("' + ATTACHMENT_ICON_SVG + '") center / 20px 20px no-repeat;' +
        ' mask: url("' + ATTACHMENT_ICON_SVG + '") center / 20px 20px no-repeat; }',
        // Fastmail moves a narrow row's labels left to make room for the
        // paperclip; they now carry it, so they keep their usual edge.
        '.v-Mailbox--short.v-Mailbox--previewOff .v-MailboxItem' +
        ' .v-MailboxItem-attachments.s-has-attachment ~ .v-MailboxItem-mailboxes' +
        ' { right: 12px; }',
        // A wide row keeps a fixed column for the paperclip right of the
        // labels; they move into it, with or without an attachment, so every
        // row's labels end at the same place.
        '.v-Mailbox--long .v-MailboxItem .v-MailboxItem-mailboxes { right: 137px; }',
        '.v-Mailbox--long.v-Mailbox--size .v-MailboxItem .v-MailboxItem-mailboxes { right: 202px; }'
    ] : [];

    // Plain tags, the labels kept out of the sidebar, ahead of the sidebar's
    // own on a row: the tag says something particular about the message,
    // where a sidebar label (Triage above all) is on many rows alike. The
    // chips are items of a flex row, so order moves them without touching
    // Fastmail's DOM; each tag is named by its path the same way the label
    // colours name a chip.
    const tagsFirstRules = () => {
        if (!settings.tagsBeforeSidebarLabels) return [];
        const chips = FastMail.store.getAll(FastMail.classes.Mailbox)
            .filter(m => isUserLabel(m) && !isSidebarLabel(m))
            .map(m => `.v-MailboxItem-mailbox:has(span[title="${cssString(mailboxPath(m))}"])`);
        return chips.length ? [chips.join(', ') + ' { order: -1; }'] : [];
    };

    // The phone's own big list title, colour var(--ui-page-color-fg) and
    // family read off a real one on the phone, since isMobile is a
    // platform read rather than a width one and past phone width
    // Fastmail's own stylesheet carries no .v-Page-title rule at all to
    // borrow from directly. Sized down from the phone's own 32px, which on
    // a desktop pane reads oversized against the row text below it. The
    // left margin matches a group heading's own left padding (20px) exactly,
    // so the two starts line up rather than merely looking close; the
    // count's own colour is the same subdued one the phone's title and the
    // group headings both already read a count in, var(--ui-page-color-fg
    // -subtle), measured off one rather than guessed. It stays bold like
    // the name, the colour alone setting it apart.
    const MAILBOX_TITLE_ID = 'custom-mailboxTitle';
    const MAILBOX_TITLE_COUNT_CLASS = 'custom-mailboxTitle-count';
    const MAILBOX_TITLE_COMPACT_ID = 'custom-mailboxTitle-compact';
    const MAILBOX_TITLE_SCROLLED_CLASS = 'custom-mailboxTitle-scrolled';
    const MAILBOX_TITLE_FONT_SIZE = 26;
    const MAILBOX_TITLE_COMPACT_FONT_SIZE = 14;

    // Matches the phone's own two-copy technique: one title that fades
    // out as it scrolls (this one) and a second, permanently sitting in
    // the row with Select all, that starts transformed up to this one's
    // size and position and drops to its resting transform as it fades
    // in. Measured live, the phone's own shrink lands within about the
    // first 20px of scroll rather than tracking scroll position
    // continuously, which is why the swap below is a class threshold and
    // a CSS transition rather than per-pixel scroll math.
    const MAILBOX_TITLE_RULES = [
        '#' + MAILBOX_TITLE_ID + ' {' +
        ' font-family: "Proxima Nova", system-ui, "Segoe UI", Roboto, Ubuntu,' +
        ' Cantarell, "Noto Sans", -apple-system, Arial, sans-serif;' +
        ' font-size: ' + MAILBOX_TITLE_FONT_SIZE + 'px; font-weight: 700; line-height: 1.3;' +
        ' color: var(--ui-page-color-fg, rgb(27, 30, 32));' +
        // A real gap here, not just padding down to the list: the first
        // row below can be an interactive group header rather than a
        // plain message, and with no visible break the two read as one
        // clickable block when only the row is, leaving the title's own
        // share of it dead to hover and click.
        ' padding: 12px 20px 4px; box-sizing: border-box;' +
        ' overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' +
        // No longer a child of the scrolling container, so it no longer
        // scrolls out of the way on its own; flex: none keeps .v-Page's
        // flex column from stretching it, and max-height transitioning to
        // 0 (border-box counts the padding inside that budget) reclaims
        // the row it would otherwise leave behind once faded.
        ' flex: none; max-height: 70px;' +
        ' transition: opacity 0.15s ease, max-height 0.15s ease; }',
        '#' + MAILBOX_TITLE_ID + '.' + MAILBOX_TITLE_SCROLLED_CLASS + ' {' +
        ' opacity: 0; max-height: 0; }',
        '#' + MAILBOX_TITLE_COMPACT_ID + ' {' +
        ' font-family: "Proxima Nova", system-ui, "Segoe UI", Roboto, Ubuntu,' +
        ' Cantarell, "Noto Sans", -apple-system, Arial, sans-serif;' +
        ' display: inline-block; margin-left: 12px; max-width: 40%;' +
        // A label, never a target; and while it waits for the list to be
        // scrolled it stands invisible over the first rows, scaled up to
        // where the big title is. Taking clicks there left the first group
        // heading unfoldable, since the click landed on this instead.
        ' pointer-events: none;' +
        ' font-size: ' + MAILBOX_TITLE_COMPACT_FONT_SIZE + 'px; font-weight: 700;' +
        ' color: var(--ui-page-color-fg, rgb(27, 30, 32));' +
        ' overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' +
        ' transform-origin: top left;' +
        ' transform: var(--custom-mailboxTitleExpand, none); opacity: 0;' +
        ' transition: transform 0.15s ease, opacity 0.15s ease; }',
        '#' + MAILBOX_TITLE_COMPACT_ID + '.' + MAILBOX_TITLE_SCROLLED_CLASS + ' {' +
        ' transform: none; opacity: 1; }',
        '.' + MAILBOX_TITLE_COUNT_CLASS + ' {' +
        ' color: var(--ui-page-color-fg-subtle, rgb(91, 100, 108)); }'
    ];

    // The fallback panel's own styles, added once by ensureSettingsPageStyles
    // rather than run through updateStyles: the plain panel can be opened
    // before mail has ever loaded, so these rules must not wait on it.
    const FALLBACK_PANEL_RULES = [
        '#fastmail-custom-fallback-settings {' +
        ' position: fixed; inset: 0; z-index: 2147483000;' +
        ' display: flex; align-items: flex-start; justify-content: center;' +
        ' padding: 24px; overflow-y: auto; background: rgba(0, 0, 0, 0.4); }',
        '.fastmail-custom-fallback-sheet {' +
        ' width: 100%; max-width: 620px; padding: 20px 24px;' +
        ' border-radius: 10px; background: Canvas; color: CanvasText;' +
        ' color-scheme: light dark;' +
        ' font: 14px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }',
        '.fastmail-custom-fallback-row {' +
        ' display: flex; gap: 9px; align-items: flex-start; padding: 9px 0;' +
        ' border-top: 1px solid rgba(128, 128, 128, 0.3); }',
        '.fastmail-custom-fallback-row input[type="text"],' +
        ' .fastmail-custom-fallback-row textarea {' +
        ' display: block; width: 100%; box-sizing: border-box; font: inherit; }',
        '.fastmail-custom-fallback-row textarea {' +
        ' font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }',
        '.fastmail-custom-fallback-title { display: block; font-weight: 500; }',
        '.fastmail-custom-fallback-hint { display: block; opacity: 0.7; }',
        '.fastmail-custom-fallback-note { opacity: 0.7; }'
    ];

    // A sub-option on the settings page while the option it depends on is
    // off. Fastmail's own disabled switch greys only its control, and its
    // stylesheet has no class that dims a label and hint along with it; half
    // is what its own disabled menu entries use. Added once by
    // ensureSettingsPageStyles, alongside the fallback panel's own rules,
    // for the same reason: the page opens before mail has ever loaded too.
    const SUB_OPTION_DIMMED = 'fastmail-custom-dimmed';
    const SUB_OPTION_RULES = ['.' + SUB_OPTION_DIMMED + ' { opacity: 0.5; }'];

    // The settings page's own two rule sets, in their own element rather
    // than updateStyles': unlike inboxChipRules and labelColourRules, they
    // need neither the mailbox store nor the mode to be known, so they can
    // go up the moment the page can start, and there is nothing here for
    // rememberStyles to remember for the next launch's head start. Added
    // once; nothing here ever changes, so nothing later needs to update it.
    const SETTINGS_STYLE_ID = STYLE_ID + '-settings';

    const ensureSettingsPageStyles = () => {
        if (document.getElementById(SETTINGS_STYLE_ID)) return;
        document.body.appendChild(
            FastMail.el('style', { type: 'text/css', id: SETTINGS_STYLE_ID },
                [FALLBACK_PANEL_RULES.concat(SUB_OPTION_RULES).join('\n')])
        );
    };

    // The line is the stylesheet's half of the option; the gap it sits in is
    // the marking pass's, since only that can move a row the list has pinned.
    const sourceSeparatorRules = () =>
        (settings.sidebarSeparators ? SOURCE_SEPARATOR_RULES : []);

    /*
     * ----------------------------------------------------------------
     * A head start for the next load
     * ----------------------------------------------------------------
     */

    // None of this can run until Fastmail is ready, and Fastmail paints its
    // first rows before then, so on a fresh load they appear unstyled: the
    // Inbox chip shows and then vanishes, and colours arrive late.
    let early = null;

    const loadEarly = () => {
        if (early) return early;

        try {
            early = JSON.parse(localStorage.getItem(EARLY_KEY)) || {};
        } catch (error) {
            early = {};
        }

        if (!early.hide || typeof early.hide !== 'object') early.hide = {};

        // Answers filed by an older version were keyed before the URL had
        // caught up with the route, so some of them name the wrong view
        if (early.v !== EARLY_VERSION) {
            early.v = EARLY_VERSION;
            early.hide = {};
        }

        return early;
    };

    const saveEarly = () => {
        try {
            localStorage.setItem(EARLY_KEY, JSON.stringify(early));
        } catch (error) {
            // A full or disabled store costs only the head start
        }
    };

    const rememberStyles = (css) => {
        loadEarly();
        if (early.css === css) return;

        early.css = css;
        saveEarly();
    };

    // Whether to hide the chip depends on the mailbox being a user label,
    // which needs the store.
    const earlyUrlKey = () => {
        const params = new URLSearchParams(location.search);
        return [
            location.pathname,
            params.get('filter') || '',
            params.get('u') || ''
        ].join('|');
    };

    const rememberHide = (hide) => {
        loadEarly();

        const key = earlyUrlKey();
        if (early.hide[key] === hide) return;

        early.hide[key] = hide;

        // Oldest first, since insertion order is preserved
        const keys = Object.keys(early.hide);
        keys.slice(0, Math.max(0, keys.length - EARLY_PATH_LIMIT))
            .forEach(stale => delete early.hide[stale]);

        saveEarly();
    };

    // The router writes the URL on the run loop, so reading it as the answer
    // is worked out keys it to the view being left; which is how an answer
    // meant for a label ends up filed under the Inbox.
    let hideTimer = null;

    const rememberHideSoon = (hide) => {
        if (hideTimer) clearTimeout(hideTimer);

        hideTimer = setTimeout(() => {
            hideTimer = null;
            rememberHide(hide);
        }, 300);
    };

    // A setting that changes what the class means invalidates every remembered
    // answer, not just this view's
    const forgetHide = () => {
        loadEarly();
        early.hide = {};
        saveEarly();
    };

    // The title we put on the picker while it is copying. Sized off the menu's
    // own filter row so it reads as part of the menu rather than pasted on.

    const updateStyles = () => {
        const rules = inboxChipRules()
            .concat(labelColourRules())
            .concat(sourceSeparatorRules())
            .concat(LONE_SECTION_RULES)
            .concat(PIN_STATE_RULES)
            .concat(REMINDER_STATE_RULES)
            .concat(GROUP_TITLE_RULES)
            .concat(BADGE_UNREAD_RULES)
            .concat(TRIAGE_ICON_RULES)
            .concat(TOAST_RULES)
            .concat(FLOATING_NAV_RULES)
            .concat(HIDE_MESSAGE_NAV_RULES)
            .concat(MAILBOX_TITLE_RULES)
            .concat(attachmentIconRules())
            .concat(tagsFirstRules())
            .join('\n');
        const existing = document.getElementById(STYLE_ID);

        rememberStyles(rules);

        if (existing) {
            existing.textContent = rules;

            // The head start puts this on <html> before Fastmail's own sheets
            // are parsed.
            if (existing.parentNode !== document.body) document.body.appendChild(existing);
            return;
        }

        document.body.appendChild(
            FastMail.el('style', { type: 'text/css', id: STYLE_ID }, [rules])
        );
    };

    const updateInboxLabelVisibility = () => {
        const mailController = controller();

        // A project list is Inbox-only by the invariant, a project label
        // implies the Inbox, and so is Triage's, so the chip that says "Inbox"
        // on every row there says nothing and is hidden.
        const mailbox = mailController.get('mailbox');
        const inboxOnly = isInboxSearch() ||
            (!!mailbox && (isTriage(mailbox) || isProject(mailbox)));

        const hide = settings.hideInboxLabel && inboxOnly;

        // On <html>, not <body>. Fastmail rewrites body.className wholesale
        // when its root view redraws; that is how is-kbmode comes and goes,
        // and any class of ours on it is dropped without a classList call to
        // observe.
        document.documentElement.classList.toggle(HIDE_INBOX_LABEL_CLASS, hide);
        rememberHideSoon(hide);
    };

    /*
     * ----------------------------------------------------------------
     * Groupings
     * ----------------------------------------------------------------
     */

    /*
     * Fastmail splits a message list into named groups. The choice lives in
     * the mailbox's own sort, whose first entry names it while the last is
     * the sort field; its five are "" for none, isTodayWeekMonth, isPinned,
     * isUnread and custom, and custom reads a definition stored on the
     * mailbox. The mode adds two kinds of its own and stores no definition
     * on the mailbox: "labels", built from the label tree and shaped by
     * settings.labelsGrouping, and one per block of settings.groupings, under
     * the id "split:" and its name — "by age", "pinned first" and "unread
     * first" among them by default, standing in for isTodayWeekMonth,
     * isPinned and isUnread, which the Group menu no longer offers (see
     * addGroupings).
     * Those three native values are still safe in a mailbox's stored sort:
     * calculateSplits is only wrapped for "labels" and "split:" ids, so a
     * mailbox already grouped isTodayWeekMonth, isPinned or isUnread keeps
     * grouping that way, Fastmail's own logic and all; there is simply no
     * ticked entry for it any more, and None is the only menu route back.
     *
     * A value Fastmail does not know is safe in that sort: its own
     * calculateSplits returns null for one, no category sort is built, and
     * the list simply shows ungrouped. So an account opened in the official
     * app loses the grouping and nothing else.
     */

    // The id a mailbox's sort carries for the Labels grouping from when it
    // was a grouping of its own; still answered, by the preset standing for it
    const LABELS_GROUPING = 'labels';
    const SPLIT_PREFIX = 'split:';

    // Everything the list falls into that no group claimed. Fastmail's own
    // wording for the same bucket.
    const OTHER_NAME = 'Other';

    /*
     * The two rows that stand for a group per label, in any grouping. Each is
     * carried as a group like any other, with a search nobody would type, so
     * the setting keeps the form every grouping has and Fastmail's own editor
     * can carry it as a row among the rest. Labels (root) is the labels one
     * level down: the top-level labels in the Inbox, the labels directly
     * inside a label. Labels (all) is every label at any depth below that,
     * each sub-label before its parent; Fastmail puts a conversation in the
     * first group it matches, and mail kept under Projects/RUP carries both,
     * so with the parent first RUP would never hold anything.
     */
    const LABELS_MARKER = {
        name: 'Labels (root)', query: '*labels*', hint: 'A group for each top-level label'
    };
    const ALL_LABELS_MARKER = {
        name: 'Labels (all)', query: '*labels:all*', hint: 'A group for every label, sub-labels first'
    };
    const LABELS_MARKERS = [LABELS_MARKER, ALL_LABELS_MARKER];
    const labelsMarkerFor = (query) => LABELS_MARKERS.filter(marker => marker.query === query)[0] || null;
    const isLabelsMarker = (category) => !!category && category.query === LABELS_MARKER.query;
    const isAnyLabelsMarker = (category) => !!category && !!labelsMarkerFor(category.query);

    // What the Labels grouping is called until it is renamed — lowercase, to
    // match "by age", "pinned first" and "unread first" beside it in the menu.
    const LABELS_GROUPING_NAME = 'labels';

    /*
     * The settings text, as blocks: every grouping it holds, finished or not.
     *
     * A blank line ends a block. Inside one, a line with an equals sign is a
     * group, its name before and a Fastmail search after; a line without one
     * names the bucket for everything else, unless it sits at the margin, in
     * which case it opens the next grouping instead. That last rule is all
     * the indentation does, and it is there so a second block can follow the
     * first without a blank line between them. The cost is that a bucket name
     * written at the margin opens a grouping of its own, which parseGroupings
     * drops for having no groups, leaving the default name behind; the gain
     * is that a block nobody indented still reads as one grouping rather than
     * as several empty ones, which is the likelier slip by far.
     *
     * Of two blocks sharing a name the first wins: the second is parsed into
     * a grouping that is never kept, so its lines are consumed rather than
     * reopening the first or derailing everything after it. A group line
     * missing its name or its search is skipped.
     *
     * A line reading "priority: <name> = <search>" is neither a group nor
     * the leftover bucket's name but one of the block's priorities, in the
     * order written: within every group, what the first names comes first,
     * then what the second names, then the rest. The name is only for the
     * editor's row and may be left out, as "priority: <search>". See
     * withPriorityTwins.
     */
    const PRIORITY_LINE = /^priority\s*:\s*/i;

    const readGroupingBlocks = (text) => {
        const groupings = [];
        const taken = {};
        let current = null;

        String(text || '').split('\n').forEach((raw) => {
            const line = raw.trim();

            if (!line) {
                current = null;
                return;
            }

            const indented = /^\s/.test(raw);
            const divider = line.indexOf('=');

            if (!current || (!indented && divider === -1 && !PRIORITY_LINE.test(line))) {
                // A name already taken still opens a scratch grouping, so its
                // lines are consumed rather than falling through and being
                // read as the start of a grouping of their own.
                const id = SPLIT_PREFIX + line;
                current = {
                    id: id,
                    name: line,
                    categories: [],
                    otherName: OTHER_NAME,
                    priorities: []
                };
                if (!taken[id]) {
                    taken[id] = true;
                    groupings.push(current);
                }
                return;
            }

            if (PRIORITY_LINE.test(line)) {
                const rest = line.replace(PRIORITY_LINE, '');
                const split = rest.indexOf('=');
                const query = (split === -1 ? rest : rest.slice(split + 1)).trim();
                if (query) {
                    current.priorities.push({
                        name: split === -1 ? '' : rest.slice(0, split).trim(),
                        query: query
                    });
                }
                return;
            }

            if (divider === -1) {
                current.otherName = line;
                return;
            }

            const name = line.slice(0, divider).trim();
            const query = line.slice(divider + 1).trim();
            if (name && query) current.categories.push({ name: name, query: query });
        });

        return groupings;
    };

    // The groupings the text defines. A block with no groups is dropped, since
    // a grouping that groups nothing is a menu entry that does nothing.
    const parseGroupings = (text) => readGroupingBlocks(text).filter(one => one.categories.length);

    /*
     * The inverse of parseGroupings: an array of groupings back to the text
     * the setting holds. The two must round-trip, because the editor parses,
     * edits and writes back, and anything this drops is lost.
     *
     * The leftover bucket's name is written only when it is not the default
     * one, since parseGroupings supplies that name for a block that omits it.
     */
    const formatGroupings = (groupings) => (groupings || []).map((one) => {
        const lines = [one.name];
        (one.priorities || []).forEach((priority) => {
            lines.push('  priority: ' + (priority.name ? priority.name + ' = ' : '') + priority.query);
        });
        (one.categories || []).forEach((category) => {
            lines.push('  ' + category.name + ' = ' + category.query);
        });
        if (one.otherName && one.otherName !== OTHER_NAME) lines.push('  ' + one.otherName);
        return lines.join('\n');
    }).join('\n\n');

    /*
     * The Labels grouping from when it was a grouping of its own. Its block
     * and its place are read from the two settings it had, and it stands
     * among the presets at that place, until the presets are next written:
     * that writes it in as one of them and sets the place to "none", after
     * which it is a preset like any other, to rename, reorder or remove.
     */
    const LEGACY_LABELS_FOLDED = 'none';

    // Its place among the presets, or nothing once it has been written in.
    // An empty or unreadable place is the front, as it always was.
    const legacyLabelsIndex = (groupingCount) => {
        const stored = String(settings.labelsGroupingIndex == null ? '' : settings.labelsGroupingIndex).trim();
        if (stored === LEGACY_LABELS_FOLDED) return null;
        const raw = parseInt(stored, 10);
        return raw >= 0 ? Math.min(raw, groupingCount) : 0;
    };

    /*
     * Its block as the user shaped it: groups of their own by search, the
     * marker where the group per label goes, and the name for everything
     * else. With nothing stored, or no marker in what is, the marker stands
     * first; a second marker is dropped.
     */
    const labelsGroupingSettings = () => {
        const stored = parseGroupings(settings.labelsGrouping)[0];
        const categories = [];
        (stored ? stored.categories : []).forEach((one) => {
            if (!isLabelsMarker(one) || !categories.some(isLabelsMarker)) categories.push(one);
        });
        if (!categories.some(isLabelsMarker)) categories.unshift(Object.assign({}, LABELS_MARKER));
        return {
            name: stored && stored.name ? stored.name : LABELS_GROUPING_NAME,
            categories: categories,
            otherName: stored ? stored.otherName : OTHER_NAME
        };
    };

    // Every preset, the old Labels grouping among them while it is still
    // kept apart. A preset already carrying its name wins.
    const modeGroupings = () => {
        const own = parseGroupings(settings.groupings);
        const at = legacyLabelsIndex(own.length);
        if (at === null) return own;

        const legacy = labelsGroupingSettings();
        const id = SPLIT_PREFIX + legacy.name;
        if (own.some(one => one.id === id)) return own;

        return own.slice(0, at).concat([{
            id: id, name: legacy.name, categories: legacy.categories, otherName: legacy.otherName
        }], own.slice(at));
    };

    /*
     * Groups for the Snoozed folder, by when a conversation comes back.
     *
     * Fastmail groups a list on the server: the query carries a filter per
     * group and the server answers with a count per group, which is what the
     * list lays its headings out from. No filter can name a return date
     * (snoozedBefore and its kind are refused, and a custom keyword cannot be
     * grouped on), so these groups carry a filter nothing matches, leaving
     * every row in the leftover group and in the order the Snoozed folder
     * already has, by return date; and the counts are worked out here, from
     * the rows, and handed to the list, which draws the rest itself.
     */
    const SNOOZE_PREFIX = 'snoozesplit:';

    const NEVER_MATCHES = () => ({
        operator: 'AND',
        conditions: [{ hasKeyword: '$draft' }, { notKeyword: '$draft' }]
    });

    const SNOOZE_GROUPING_NAME = 'By return date';
    const SNOOZE_OTHER_NAME = 'Later';
    const snoozeOtherName = () =>
        String(settingValue('snoozeGroupsOther') || '').trim() || SNOOZE_OTHER_NAME;
    const SNOOZE_ONLY_NOTE = '(only shown in Snoozed)';

    const snoozeGroupingName = () =>
        String(settingValue('snoozeGroupName') || '').trim() || SNOOZE_GROUPING_NAME;

    // Its place among the group presets; anything unreadable puts it last
    const snoozeGroupingAt = (total) => {
        const at = parseInt(settingValue('snoozeGroupAt'), 10);
        if (!isFinite(at) || at < 0) return total;
        return Math.min(at, total);
    };

    // The presets a mailbox offers, the Snoozed folder's own among them in
    // the place it was dragged to
    const groupingsWithSnooze = (definitions, mailbox) => {
        if (!isSnoozeMailbox(mailbox)) return definitions;
        const snooze = snoozeGroupings();
        if (!snooze.length) return definitions;
        const at = snoozeGroupingAt(definitions.length);
        return definitions.slice(0, at).concat(snooze, definitions.slice(at));
    };

    // One grouping, whose groups are the setting's own rows
    const snoozeGroupings = () => {
        const rows = parseSnoozePresets(settings.snoozeGroups);
        if (!rows.length) return [];
        return [{
            id: SNOOZE_PREFIX + 'return',
            name: snoozeGroupingName(),
            categories: rows.map(row => ({ name: row.name, date: row.date, time: row.time })),
            otherName: snoozeOtherName(),
            snooze: true
        }];
    };

    const isSnoozeMailbox = (mailbox) => {
        try {
            return !!mailbox && mailbox.get('role') === 'snoozed';
        } catch (error) {
            return false;
        }
    };

    // How far out a group reaches: a period counts from now, a day keyword
    // reaches to the end of that day, so "tomorrow" takes all of tomorrow.
    const snoozeHorizon = (now, category) => {
        const text = String(category.date || '').trim();
        const hours = snoozeHoursTarget(now, text);
        if (hours) return hours;
        // A time of its own is the moment the group reaches to; a period
        // counts from now; a day without a time reaches to the end of it, so
        // "tomorrow" takes all of tomorrow.
        if (category.time) return snoozePresetTarget(now, category);
        if (SNOOZE_PERIOD.test(text)) return snoozeDateKeyword(now, text);
        const day = snoozeDateKeyword(now, text);
        day.setHours(23, 59, 59, 999);
        return day;
    };

    const legacyLabelsFolded = () => legacyLabelsIndex(0) === null;

    // The Inbox groups by the labels at the top level, which are nobody's
    // children; every other mailbox by its own.
    const groupingParent = (mailbox) =>
        mailbox && mailbox.get('role') === 'inbox' ? null : mailbox;

    const byLabelOrder = (a, b) => (a.get('sortOrder') || 0) - (b.get('sortOrder') || 0);

    // The labels directly inside one, or at the top with none
    const labelsInside = (mailbox, parent) => mailboxesOf(mailbox.get('accountId'))
        .filter(other => (parentOf(other) || null) === (parent || null) &&
            (parent || isUserLabel(other)) && isSidebarLabel(other) && !isTriage(other))
        .sort(byLabelOrder);

    /*
     * A group per label, built as filters rather than searches, so no query
     * has to be written or parsed and two labels with the same leaf name
     * cannot be confused. Plain membership: Fastmail's labels do not inherit,
     * and keeping under a nested label already puts every label above it on,
     * so mail filed by this mode lands under its own heading. Mail filed
     * before that rule, or labelled from Fastmail's own menu, carries the
     * leaf alone and falls into Other under Labels (root), which is where it
     * should be visible rather than hidden.
     */
    const labelGroup = (label) => ({ name: label.get('name'), filter: { inMailbox: label.get('id') } });

    const rootLabelGroups = (mailbox) => labelsInside(mailbox, groupingParent(mailbox)).map(labelGroup);

    // Depth first, each label after everything inside it
    const allLabelGroups = (mailbox) => {
        const groups = [];
        const walk = (parent) => labelsInside(mailbox, parent).forEach((label) => {
            walk(label);
            groups.push(labelGroup(label));
        });
        walk(groupingParent(mailbox));
        return groups;
    };

    // A preset for one mailbox: its Labels rows given the groups they stand
    // for there. None when nothing is left to group by, as for a mailbox with
    // no labels under a preset that is only its Labels row.
    const expandLabels = (grouping, mailbox) => {
        if (!grouping) return null;
        if (!grouping.categories.some(isAnyLabelsMarker)) return grouping;
        if (!mailbox || !mailbox.get) return null;

        const categories = [].concat(...grouping.categories.map((one) => {
            if (isLabelsMarker(one)) return rootLabelGroups(mailbox);
            if (isAnyLabelsMarker(one)) return allLabelGroups(mailbox);
            return [one];
        }));
        return categories.length ? Object.assign({}, grouping, { categories: categories }) : null;
    };

    // What a sort still naming the old Labels grouping means now: the first
    // preset grouping by the top-level labels, else the first by any.
    const presetForLegacyLabels = () => {
        const presets = modeGroupings();
        return presets.filter(one => one.categories.some(isLabelsMarker))[0] ||
            presets.filter(one => one.categories.some(isAnyLabelsMarker))[0] || null;
    };

    const presetFor = (id) => {
        if (!id) return null;
        if (id === LABELS_GROUPING) return presetForLegacyLabels();
        if (id.indexOf(SNOOZE_PREFIX) === 0) {
            return snoozeGroupings().filter(one => one.id === id)[0] || null;
        }
        if (id.indexOf(SPLIT_PREFIX) !== 0) return null;
        return modeGroupings().filter(one => one.id === id)[0] || null;
    };

    // Under the id the sort names, so what is kept against that id, the
    // folded groups, still finds it
    const groupingFor = (id, mailbox) => {
        const grouping = expandLabels(presetFor(id), mailbox);
        return grouping && Object.assign({}, grouping, { id: id });
    };

    // The sort's first entry names the grouping, and there is one only when
    // the sort has a second entry to be the sort field.
    const currentGroupingId = () => {
        try {
            const sort = controller().get('sort') || [];
            return sort.length > 1 ? String(sort[0].property || '') : '';
        } catch (error) {
            return '';
        }
    };

    // Whether the mailbox's sort names one of the mode's groupings, whatever
    // the mode is doing. Asked by the refresh, which has to fire when the
    // mode goes off as well as on, or the list would keep the grouping it
    // had until something else recomputed it.
    const sortNamesModeGrouping = () => {
        const id = currentGroupingId();
        return id === LABELS_GROUPING || id.indexOf(SPLIT_PREFIX) === 0 ||
            id.indexOf(SNOOZE_PREFIX) === 0;
    };

    const modeGroupingIsActive = () => {
        if (!sortNamesModeGrouping()) return null;
        return groupingFor(currentGroupingId(), controller().get('mailbox'));
    };

    /*
     * Written to sort rather than set through groupBy, because that setter
     * deletes the collapsed list off the mailbox's stored split on its way
     * past; switching grouping and switching back would quietly unfold a
     * split somebody had folded.
     */
    const chooseGrouping = (id) => {
        const mailController = controller();
        const sort = mailController.get('sort') || [];
        let sortField = sort[sort.length - 1];
        if (!sortField) return;

        // Groups by return date are counted off the rows in the order they
        // come back, so they are chosen together with that order: date,
        // soonest first, which is what the Snoozed folder turns into a sort
        // by return date. Any other order would slice the groups somewhere
        // else than where they belong.
        if (id && id.indexOf(SNOOZE_PREFIX) === 0) {
            sortField = { property: 'receivedAt', isAscending: true };
        }

        mailController.set('sort',
            id ? [{ property: id, isAscending: false }, sortField] : [sortField]);
    };

    /*
     * Fastmail's own calculateSplits, asked a different question.
     *
     * It reads groupBy off the controller and, for custom, a definition off
     * the sort source, and returns categories whose searches it has parsed
     * into filters. Rather than reimplement that parsing, the mode calls the
     * original with a stand-in: an object that answers custom for groupBy
     * and hands back the mode's definition for splits, and delegates every
     * other question to the real one. Fastmail then does the parsing, and
     * the shape that comes back is its own.
     *
     * A group built from a filter already, which each of Labels' group per
     * label is, needs none of that. So only the searches are handed over,
     * and the filter Fastmail makes of each goes back into the place its
     * search held among the rest.
     */
    const standInFor = (mailController, definition) => {
        const source = {
            get(key) {
                if (key === 'splits') return definition;
                return mailController.get('sortSource').get(key);
            }
        };

        return {
            get(key) {
                if (key === 'groupBy') return 'custom';
                if (key === 'sortSource') return source;
                return mailController.get(key);
            }
        };
    };

    const splitsFor = (mailController, original, definition) => {
        if (definition.snooze) {
            return {
                categories: definition.categories.map(one => ({ name: one.name, filter: NEVER_MATCHES() })),
                otherName: definition.otherName
            };
        }
        const searches = definition.categories.filter(one => !one.filter);
        const parsed = searches.length
            ? original.call(standInFor(mailController, {
                categories: searches,
                otherName: definition.otherName
            }))
            : { categories: [] };
        if (!parsed) return null;

        let next = 0;
        const splits = {
            categories: definition.categories.map(one => (one.filter ? one : parsed.categories[next++])),
            otherName: definition.otherName
        };
        if (definition.prioritySort && definition.prioritySort.length) splits.prioritySort = definition.prioritySort;
        return splits;
    };

    /*
     * A grouping's priority search, asked the same way splitsFor asks
     * Fastmail to parse a category's own search: a one-category stand-in,
     * so the parsing is Fastmail's rather than reimplemented here.
     */
    const priorityFilterFor = (mailController, original, query) => {
        try {
            const parsed = original.call(standInFor(mailController, {
                categories: [{ name: '', query: query }],
                otherName: OTHER_NAME
            }));
            const category = parsed && parsed.categories && parsed.categories[0];
            return (category && category.filter) || null;
        } catch (error) {
            return null;
        }
    };

    /*
     * A priority's filter as a sort entry, or nothing when it has none.
     *
     * The server sorts only by a keyword the message has (hasKeyword) or one
     * some message in its conversation has (someInThreadHaveKeyword); every
     * other sort it offers is a field such as a date or a sender. So only a
     * filter naming one keyword can become a sort, and which way round
     * follows from whether it asks for the keyword or its absence. Fastmail
     * parses is:pinned, is:muted and is:followed into the conversation's
     * forms, keyword:… and is:answered into the message's.
     *
     * is:unread arrives as "not every message in the conversation is read",
     * which the server refuses as a sort (allInThreadHaveKeyword), so it
     * becomes "unread messages first". With conversations collapsed the
     * server sorts the messages and keeps each conversation's first, so an
     * unread message anywhere in it still lifts the conversation, as long
     * as that message is in the mailbox listed. is:read, "every message
     * read", has no such stand-in and stays a group.
     */
    const prioritySortFor = (filter) => {
        if (!filter) return null;
        let negated = false;
        let condition = filter;
        if (condition.operator === 'NOT' && condition.conditions && condition.conditions.length === 1) {
            negated = true;
            condition = condition.conditions[0];
        }
        if (!condition || condition.operator) return null;
        const keys = Object.keys(condition);
        if (keys.length !== 1) return null;
        const key = keys[0];
        const keyword = condition[key];
        if (typeof keyword !== 'string' || !keyword) return null;

        const entry = (property, first) => ({
            property: property, keyword: keyword, isAscending: first !== !negated
        });
        switch (key) {
            case 'hasKeyword': return entry('hasKeyword', true);
            case 'notKeyword': return entry('hasKeyword', false);
            case 'someInThreadHaveKeyword': return entry('someInThreadHaveKeyword', true);
            case 'noneInThreadHaveKeyword': return entry('someInThreadHaveKeyword', false);
            case 'allInThreadHaveKeyword': return negated
                ? { property: 'hasKeyword', keyword: keyword, isAscending: true }
                : null;
            default: return null;
        }
    };

    /*
     * An invisible tag on a category's own name, naming the group it is a
     * tier of and which tier: 0 for the group's own rest, 1 for its first
     * priority, 2 for its second, and so on. The tag travels with the splits
     * themselves, so the list's folding and its layout each find the tiers
     * in the very splits they were handed (see priorityTiers), rather than
     * in something kept on the side that could describe a different
     * grouping by then. It also keeps every tier's name distinct.
     *
     * Built from characters every engine this runs in renders with no glyph
     * and no width, so the tag never shows in the heading a person reads:
     * zero width space and non-joiner write the group's number in binary, a
     * zero width joiner per step marks the tier, and a word joiner and a
     * byte order mark bound the whole thing, so a name that happens to hold
     * one of these on its own is not mistaken for a tag.
     */
    const TIER_TAG_START = '⁠';
    const TIER_TAG_ZERO = '​';
    const TIER_TAG_ONE = '‌';
    const TIER_TAG_STEP = '‍';
    const TIER_TAG_END = '﻿';
    const TIER_TAG_RE = new RegExp(TIER_TAG_START + '([' + TIER_TAG_ZERO + TIER_TAG_ONE + ']*)(' +
        TIER_TAG_STEP + '*)' + TIER_TAG_END);

    const tierTag = (groupId, tier) => {
        const bits = Math.max(0, groupId).toString(2).split('')
            .map(bit => (bit === '1' ? TIER_TAG_ONE : TIER_TAG_ZERO)).join('');
        return TIER_TAG_START + bits + TIER_TAG_STEP.repeat(tier) + TIER_TAG_END;
    };

    const readTierTag = (text) => {
        const match = TIER_TAG_RE.exec(text || '');
        if (!match) return null;
        const bits = match[1].split('').map(ch => (ch === TIER_TAG_ONE ? '1' : '0')).join('');
        return { groupId: bits ? parseInt(bits, 2) : 0, tier: match[2].length };
    };

    /*
     * The tiered groups in a set of splits, each as its tiers' category
     * indexes in drawing order: its priority tiers, then its own rest last.
     * The leftover bucket counts as the index after the last category, the
     * way Fastmail's collapsedGroups and splitOffsets both count it.
     */
    const priorityTiers = (splits) => {
        const groups = [];
        if (!splits || !splits.categories) return groups;

        const tags = splits.categories.map(one => readTierTag(one.name))
            .concat([readTierTag(splits.otherName)]);
        let run = [];
        tags.forEach((tag, index) => {
            const previous = run.length ? tags[run[run.length - 1]] : null;
            if (!tag || !tag.tier && !run.length ||
                previous && (tag.groupId !== previous.groupId || tag.tier && tag.tier !== previous.tier + 1)) {
                run = [];
            }
            if (!tag || !tag.tier && !run.length) return;

            run.push(index);
            if (!tag.tier) {
                groups.push(run);
                run = [];
            }
        });
        return groups;
    };

    /*
     * A grouping's categories, tiered by its priorities.
     *
     * Each category gets a tier ahead of it per priority, in the priorities'
     * order, each demanding that priority's search as well as the
     * category's. Fastmail puts a conversation in the first category it
     * matches, so what the first priority names lands in the first tier,
     * what only the second names in the second, and the category itself
     * keeps the rest; the tiers draw back to back with nothing between
     * them, and patchPriorityLayout draws them as the one group they are.
     * The leftover bucket gets the same treatment, as one more explicit
     * category per priority naming only that priority's search, ahead of
     * whatever Fastmail still calls Other. Every tier carries the group's
     * tag, the rest as well, since priorityTiers has to find the rest by
     * more than its name alone.
     *
     * A category already holding a filter (a label) is anded with the
     * priority's own filter, asked from Fastmail above rather than written
     * as a search nothing here could parse back into inMailbox safely. A
     * category still holding a search is just two searches written
     * together, left for splitsFor's own call to Fastmail's parser to turn
     * into a filter the same way any other search-built category is. A
     * priority Fastmail cannot parse is left out.
     *
     * With prioritiesAsSort on, a priority prioritySortFor can turn into a
     * sort entry is carried as one instead, in the priorities' order, on
     * the definition's prioritySort, and patchListSort adds those to the
     * list's query. Only the others are tiered. The server applies the
     * grouping before any sort, so tiers still come ahead of sorted
     * priorities whatever order they were written in.
     */
    const withPriorityTwins = (mailController, original, definition) => {
        const parsed = (definition.priorities || [])
            .map(one => ({ query: one.query, filter: priorityFilterFor(mailController, original, one.query) }))
            .filter(one => one.filter);
        const asSort = settingValue('prioritiesAsSort');
        const prioritySort = asSort ? parsed.map(one => prioritySortFor(one.filter)).filter(Boolean) : [];
        const priorities = asSort ? parsed.filter(one => !prioritySortFor(one.filter)) : parsed;
        if (prioritySort.length) definition = Object.assign({}, definition, { prioritySort: prioritySort });
        if (!priorities.length) return definition;

        const categories = [];

        definition.categories.forEach((category, groupId) => {
            priorities.forEach((priority, at) => {
                const name = tierTag(groupId, at + 1) + category.name;
                categories.push(category.filter
                    ? { name: name, filter: { operator: 'AND', conditions: [category.filter, priority.filter] } }
                    : { name: name, query: category.query + ' ' + priority.query });
            });
            categories.push(Object.assign({}, category, { name: tierTag(groupId, 0) + category.name }));
        });

        const otherGroupId = definition.categories.length;
        const otherName = definition.otherName || OTHER_NAME;
        priorities.forEach((priority, at) => {
            categories.push({ name: tierTag(otherGroupId, at + 1) + otherName, query: priority.query });
        });

        return Object.assign({}, definition, {
            categories: categories,
            otherName: tierTag(otherGroupId, 0) + otherName
        });
    };

    const patchSplits = () => {
        const mailController = controller();
        if (mailController.customGroupings) return;
        mailController.customGroupings = true;

        const original = mailController.calculateSplits;

        mailController.calculateSplits = function () {
            try {
                const definition = modeGroupingIsActive();
                if (definition) return splitsFor(this, original, withPriorityTwins(this, original, definition));
            } catch (error) {
                reportFault('could not build the groups', error);
            }

            return original.apply(this, arguments);
        };
    };

    /*
     * A mode grouping's sorted priorities, put into the list's query.
     *
     * Fastmail builds the list's sort inside the mail controller's
     * mailboxMessageList, from the splits, in a function nothing outside its
     * module can reach: the grouping first, then the sort field. It then
     * asks Message.getQueryId for the query's id and hands the very same
     * parameters to the store, so adding the entries to them there changes
     * both the query and its id; the id is a digest of the parameters,
     * which is also what lets the source resolve the response.
     *
     * Only the list built from the current splits is touched: its grouping
     * holds exactly the splits' own filter objects, since Fastmail maps the
     * categories to their filters just before this call. Every other query
     * passes through unchanged, and so do parameters already holding the
     * entries: the source recomputes the id from a request's own
     * parameters to find its query, and adding them twice would lose it.
     */
    const patchListSort = () => {
        const Message = FastMail.classes && FastMail.classes.Message;
        if (!Message || Message.customListSort) return;
        Message.customListSort = true;

        const original = Message.getQueryId;

        Message.getQueryId = function (params) {
            try {
                const sort = params && params.sort;
                const grouping = sort && sort[0];
                if (grouping && grouping.property === 'category' && Array.isArray(grouping.groupBy)) {
                    const splits = controller().get('splits');
                    const extra = splits && splits.prioritySort;
                    if (extra && extra.length &&
                        grouping.groupBy.length === splits.categories.length &&
                        grouping.groupBy.every((filter, index) => filter === splits.categories[index].filter) &&
                        JSON.stringify(sort.slice(1, 1 + extra.length)) !== JSON.stringify(extra)) {
                        params.sort = [grouping].concat(extra, sort.slice(1));
                    }
                }
            } catch (error) {
                reportFault('could not sort the priorities', error);
            }

            return original.apply(this, arguments);
        };
    };

    /*
     * A day boundary moves under a grouping that names one.
     *
     * Fastmail arms its own midnight refresh only for its by-age grouping and
     * for custom, so a mode grouping using date:today would show yesterday's
     * mail under Today until something else made the list recompute. Rather
     * than dress the mode's grouping up as custom for that one check, the
     * mode keeps its own clock: one timer to the next midnight, rearmed each
     * time it fires, and only while one of its groupings is on.
     */
    let midnightTimer = null;

    const scheduleMidnight = () => {
        if (midnightTimer) clearTimeout(midnightTimer);
        midnightTimer = null;
        if (!modeGroupingIsActive()) return;

        const midnight = new Date();
        midnight.setHours(24, 0, 5, 0);

        midnightTimer = setTimeout(() => {
            midnightTimer = null;
            try {
                controller().computedPropertyDidChange('splits');
            } catch (error) {
                reportFault('could not refresh the groups at midnight', error);
            }
            scheduleMidnight();
        }, Math.max(1000, midnight.getTime() - Date.now()));
    };

    /*
     * The splits computed says it depends on the saved search, the mailbox,
     * groupBy and whether conversations are on. None of those changes when a
     * label is renamed or the settings text is edited, so the mode says so
     * itself; the same call Fastmail's own custom-split dialog makes when it
     * saves.
     */
    const refreshGroupings = () => {
        try {
            if (!sortNamesModeGrouping()) return;
            controller().computedPropertyDidChange('splits');
        } catch (error) {
            reportFault('could not refresh the groups', error);
        }
    };

    /*
     * The Mailbox store fires on every record change, and that is not only a
     * label-tree event: it also carries the count updates this file's own
     * badge code already treats as optimistic and short-lived. Rebuilding
     * splits invalidates the list proxy and refetches the query, the most
     * expensive thing available, so this asks first whether the tree a
     * grouping's Labels rows actually read has moved, and calls refreshGroupings
     * only when the signature of what it would build has changed. A grouping
     * the user wrote reads no label tree, so it needs no mailbox-driven
     * refresh at all, which the currentGroupingId check gives for free.
     */
    let lastLabelGroups = '';

    const refreshLabelGroups = () => {
        try {
            const id = currentGroupingId();
            const preset = presetFor(id);
            if (!preset || !preset.categories.some(isAnyLabelsMarker)) return;
            const grouping = groupingFor(id, controller().get('mailbox'));
            const signature = grouping
                ? grouping.categories.map(one =>
                    (one.filter ? one.filter.inMailbox : one.query) + ':' + one.name).join('|')
                : '';
            if (signature === lastLabelGroups) return;
            lastLabelGroups = signature;
            refreshGroupings();
        } catch (error) {
            // A tree that cannot be read is a tree that has not changed
        }
    };

    // Folded groups, for the mode's own groupings only: mailbox and grouping
    // to the indexes folded under it. Local because the definition is never
    // stored either, so there is nothing on the server for it to hang off.
    const GROUPING_STORE_KEY = 'fastmail-custom-groups';

    /*
     * The prioritiesAsSort value the folds were kept under. The folds are
     * group indexes, and a priority kept as tiers takes several of them per
     * group where a sorted one takes none, so a preset with priorities folds
     * different groups once the setting flips. Its folds are dropped then,
     * the first time they are read, which also catches a flip that arrived
     * from another device while this one was closed. A store from before
     * this was kept counts as tiers, the setting's default. Presets without
     * priorities number their groups the same either way and keep theirs.
     */
    const FOLDS_SORT_KEY = '#prioritiesAsSort';

    const foldedGroups = () => {
        let store;
        try {
            store = JSON.parse(localStorage.getItem(GROUPING_STORE_KEY)) || {};
        } catch (error) {
            return {};
        }

        const asSort = !!settingValue('prioritiesAsSort');
        if (!!store[FOLDS_SORT_KEY] === asSort) return store;

        Object.keys(store).forEach((key) => {
            if (key === FOLDS_SORT_KEY) return;
            const preset = presetFor(key.slice(key.indexOf('|') + 1));
            if (preset && preset.priorities && preset.priorities.length) delete store[key];
        });
        store[FOLDS_SORT_KEY] = asSort;
        try {
            localStorage.setItem(GROUPING_STORE_KEY, JSON.stringify(store));
        } catch (error) {
            // Dropped again on the next read
        }
        return store;
    };

    const foldKey = (mailbox, id) =>
        (mailbox && mailbox.get ? mailbox.get('id') : '') + '|' + id;

    const rememberFolded = (mailbox, id, indexes) => {
        try {
            const store = foldedGroups();
            const key = foldKey(mailbox, id);

            if (indexes.length) store[key] = indexes;
            else delete store[key];

            localStorage.setItem(GROUPING_STORE_KEY, JSON.stringify(store));
        } catch (error) {
            // A fold that cannot be written is a fold that does not last
        }
    };

    /*
     * Take the open list's folding over.
     *
     * The list is a proxy over the query: collapsedGroups is a plain set on
     * it, and folding calls collapsedGroupsDidChange, which Fastmail defines
     * on the proxy itself to write into the mailbox's stored split. Under
     * one of the mode's groupings that would store a definition the mode
     * does not own, so the method is replaced and the set is seeded from
     * what was folded here last time. Folding itself is taken over too, so
     * a group tiered by priorities folds as the one group it is drawn as;
     * see foldPriorityTiers.
     */
    const adoptList = () => {
        try {
            const mailController = controller();
            const list = mailController.get('mailboxMessageList');
            if (!list || !list.collapsedGroups) return;

            const definition = modeGroupingIsActive();
            if (!definition) return;
            if (list.customFolding === definition.id) return;
            list.customFolding = definition.id;

            const mailbox = mailController.get('mailbox');
            const remembered = foldedGroups()[foldKey(mailbox, definition.id)] || [];

            // By now the list has been built from the mailbox's stored folds
            // and has counted its rows by them. Its length does not watch the
            // set, so it has to be told, the way Fastmail's own toggleGroup
            // tells it. Left counting the old folds, the list offered rows
            // past its end that read as undefined, which Fastmail's list view
            // gives one shared key; the redraw on coming back from Settings
            // then threw ("The object can not be found here") and the mail
            // page never came back.
            // A tiered group is squared up before the count, not after, for
            // the same reason: any tier folded folds them all.
            const before = list.get('length') || 0;
            list.collapsedGroups.clear();
            remembered.forEach(index => list.collapsedGroups.add(index));
            priorityTiers(mailController.get('splits')).forEach((tiers) => {
                if (tiers.some(index => list.collapsedGroups.has(index))) {
                    tiers.forEach(index => list.collapsedGroups.add(index));
                }
            });
            list.computedPropertyDidChange('length');
            list.rangeDidChange(0, Math.max(before, list.get('length') || 0));

            const toggleGroup = list.toggleGroup;
            list.toggleGroup = function (index) {
                return toggleGroup.call(this, foldPriorityTiers(this, mailController.get('splits'), index));
            };

            list.collapsedGroupsDidChange = function () {
                rememberFolded(mailbox, definition.id,
                    Array.from(this.collapsedGroups).sort((a, b) => a - b));
                checkGroupCounts(this);
            };
        } catch (error) {
            reportFault('could not take over the list\'s folding', error);
        }
    };

    /*
     * Fold a group tiered by priorities as one group, whichever tier's
     * heading was clicked.
     *
     * Fastmail's toggleGroup flips the one index it is handed, recounts the
     * list's length and tells the list which rows moved, all in one go.
     * Matching the other tiers afterwards, from collapsedGroupsDidChange,
     * came too late: the length had already been counted with the group
     * partly folded, so opening one left the list short by the other tiers'
     * rows and folding one left it offering rows past its end. So every
     * tier but the first is set here, beforehand, to what the clicked tier
     * is to become, the first to the opposite, and the first is handed on
     * for Fastmail to flip: the count then covers them all, and the rows it
     * reports as moved start at the first tier, ahead of the rest.
     *
     * Returns the index Fastmail's own toggleGroup should flip.
     */
    const foldPriorityTiers = (list, splits, index) => {
        const tiers = priorityTiers(splits).find(one => one.includes(index));
        if (!tiers) return index;

        const folding = !list.collapsedGroups.has(index);
        tiers.forEach((tier, at) => {
            // Fastmail flips the first one, so it starts on the other side
            if (at ? folding : !folding) list.collapsedGroups.add(tier);
            else list.collapsedGroups.delete(tier);
        });
        return tiers[0];
    };

    /*
     * A folded group hiding more than the list actually has.
     *
     * The list's visible height is its length less the folded groups'
     * counts, taken as given; that subtraction is not floored the way
     * Fastmail's own _groupRanges floors the catch-all when it measures the
     * list. So when folded counts run ahead of the length, the height goes
     * negative and the list draws nothing at all, which is how a label with
     * a grouping on it comes up empty. That negative height is the actual
     * harm, and it can only happen with something folded, so that is what is
     * guarded rather than the sum on its own: on a mailbox where every
     * message falls into some group, the counts already sum to exactly the
     * length, and archiving one message drops the length optimistically
     * before the counts follow, so the sum runs a message ahead for a moment
     * on every ordinary triage verb. Guarding the sum would refetch the
     * whole list on every one of those; guarding the height does not, since
     * one message can move the height by one but cannot carry it past zero.
     */
    const checkGroupCounts = (list) => {
        try {
            const counts = list.get('groupByCounts');
            const length = list.get('queryLength');
            const folded = list.collapsedGroups;
            if (!counts || typeof length !== 'number' || !folded || !folded.size) {
                list.customCountsDropped = false;
                return;
            }

            let hidden = 0;
            folded.forEach((index) => { hidden += counts[index] || 0; });
            if (length - hidden >= 0) {
                list.customCountsDropped = false;
                return;
            }

            // Dropping the counts changes them, which brings us back here;
            // once per drift is enough.
            if (list.customCountsDropped) return;
            list.customCountsDropped = true;

            if (list.query) list.query.set('groupByCounts', null);
            if (typeof list.reset === 'function') list.reset();
            else if (list.query && typeof list.query.reset === 'function') list.query.reset();
            reportFault('the group counts had run ahead of the list; refetching');
        } catch (error) {
            // A list that cannot be asked is a list that cannot be mended
        }
    };

    /*
     * Watch every list, grouped or not.
     *
     * adoptList returns early when no grouping of the mode's own is in
     * force, but the drift this guards against happens under Fastmail's own
     * groupings too, so the watch is attached separately, unlike adoptList.
     */
    /*
     * The counts a snooze grouping's headings are drawn from: how many rows
     * come back within each horizon, taken from the rows themselves. The
     * list is already in return order, so each group's rows are next to each
     * other, and a row that reaches past the last horizon ends the count:
     * everything after it is further out still, and falls in the last group.
     * A row the list has not loaded ends it the same way, and the count
     * settles as the rest arrive.
     */
    /*
     * The counts a snooze grouping's headings are drawn from: how many
     * conversations come back within each horizon.
     *
     * Asked of the server rather than read off the rows: a page holds only
     * the rows it has drawn, and an offline copy need not carry the snooze at
     * all, so counting what is to hand gave a different answer on each
     * device; the same question asked of the server gives the same groups
     * everywhere. The list's own filter and thread setting go with it, so the
     * count is of the very rows the list shows, in the order it shows them.
     */
    const SNOOZE_COUNT_LIMIT = 500;

    // The unfolded query the mailbox's list is drawn from
    const snoozeRowsOf = list => list.query || list;

    const snoozeCountsFrom = (moments, edges) => {
        const counts = edges.map(() => 0);
        moments.forEach((until) => {
            for (let edge = 0; edge < edges.length; edge += 1) {
                if (until <= edges[edge]) {
                    counts[edge] += 1;
                    return;
                }
            }
        });
        return counts;
    };

    /*
     * The return times of the whole folder: what the rows to hand carry, and
     * for the rest one ask for their snooze. The folder's own list is what
     * says which messages are in it; a query of our own is refused wherever
     * Fastmail's offline worker answers, which is every window but a compose
     * one. Counted off the query rather than the list drawn from it, so that
     * folding a group, which takes its rows out of that list, does not take
     * them out of the count as well. Asking for a row the page has not
     * loaded yet makes it load, and counting starts again when it arrives,
     * so a folder longer than one screen fills in over a moment rather than
     * staying short.
     */
    const snoozeMomentsFor = (list, mailbox) => {
        const moments = [];
        const asking = [];
        let complete = true;
        const rows = snoozeRowsOf(list);
        const length = Math.min(rows.get('length') || 0, SNOOZE_COUNT_LIMIT);
        for (let index = 0; index < length; index += 1) {
            const record = rows.getObjectAt(index);
            if (!record || typeof record.get !== 'function') {
                complete = false;
                continue;
            }
            const snoozed = record.get('snoozed');
            if (snoozed && snoozed.until) {
                moments.push(new Date(snoozed.until).getTime());
                continue;
            }
            const id = record.get('id');
            if (id) asking.push(id);
            else complete = false;
        }
        if (!asking.length) return Promise.resolve({ moments: moments, complete: complete });
        return FastMail.callJMAPMethod('Email/get', {
            accountId: mailbox.get('accountId'),
            ids: asking,
            properties: ['snoozed']
        }).then((answer) => {
            (answer.list || []).forEach((email) => {
                if (email.snoozed && email.snoozed.until) {
                    moments.push(new Date(email.snoozed.until).getTime());
                }
            });
            return { moments: moments, complete: complete };
        }).catch((error) => {
            console.warn('Fastmail Custom: could not ask for the return times', error);
            return { moments: moments, complete: false };
        });
    };

    let applyingSnoozeCounts = false;
    // On while the rule below writes a grouping back, so its own write does
    // not read as the list being resorted again
    let revertingSnoozeGrouping = false;

    const applySnoozeCounts = (list, counts) => {
        if (!counts) return;
        if (JSON.stringify(list.get('groupByCounts')) === JSON.stringify(counts)) return;
        applyingSnoozeCounts = true;
        try {
            list.set('groupByCounts', counts);
        } finally {
            applyingSnoozeCounts = false;
        }
    };

    let snoozeCountsTimer = null;

    /*
     * Folding a group takes its rows out of the list, so the counts already
     * worked out stand while anything is folded; they are still put back when
     * Fastmail answers with its own row of noughts, which it does at every
     * refresh, so the two cannot chase each other.
     */
    const refreshSnoozeCounts = () => {
        snoozeCountsTimer = null;
        try {
            const definition = modeGroupingIsActive();
            if (!definition || !definition.snooze) return;
            const mailController = controller();
            const mailbox = mailController.get('mailbox');
            const list = mailController.get('mailboxMessageList');
            if (!mailbox || !list) return;

            const now = new Date();
            const edges = definition.categories.map(one => snoozeHorizon(now, one).getTime());
            const asked = [
                mailbox.get('id'), snoozeRowsOf(list).get('length'), edges.join(',')
            ].join('|');

            if (asked === list.customSnoozeAsked) {
                applySnoozeCounts(list, list.customSnoozeCounts);
                return;
            }
            if (list.customSnoozeAsking) return;
            list.customSnoozeAsking = true;

            snoozeMomentsFor(list, mailbox).then(({ moments, complete }) => {
                // Only a full count is worth keeping: a short one is asked
                // again once the rows it was missing have arrived
                list.customSnoozeAsked = complete ? asked : null;
                list.customSnoozeCounts = snoozeCountsFrom(moments, edges);
                applySnoozeCounts(list, list.customSnoozeCounts);
                // Readable from the app's own log, which is how a phone says
                // what it counted
                if (window.native && window.native.log) {
                    window.native.log('snooze groups: ' + moments.length + ' rows -> ' +
                        JSON.stringify(list.customSnoozeCounts) + ' in ' + mailbox.get('name'));
                }
            }).catch((error) => {
                // Offline, or the server said no: the next look asks again
                console.warn('Fastmail Custom: could not count the snooze groups', error);
            }).then(() => {
                list.customSnoozeAsking = false;
            });
        } catch (error) {
            reportFault('could not count the snooze groups', error);
        }
    };

    const scheduleSnoozeCounts = () => {
        if (snoozeCountsTimer) clearTimeout(snoozeCountsTimer);
        snoozeCountsTimer = setTimeout(refreshSnoozeCounts, 50);
    };

    const watchSnoozeCounts = () => {
        const list = controller().get('mailboxMessageList');
        if (!list || list.customSnoozeCountWatch) return;
        list.customSnoozeCountWatch = true;

        const check = { go: () => { if (!applyingSnoozeCounts) scheduleSnoozeCounts(); } };
        list.addObserverForKey('[]', check, 'go');
        list.addObserverForKey('length', check, 'go');
        list.addObserverForKey('groupByCounts', check, 'go');
        scheduleSnoozeCounts();
    };

    const watchSnoozeSort = () => {
        const mailController = controller();
        if (mailController.customSnoozeSortWatch) return;
        mailController.customSnoozeSortWatch = true;

        mailController.addObserverForKey('sort', {
            go: () => {
                if (revertingSnoozeGrouping) return;
                // After the change that brought it here has settled: a
                // mailbox opening carries its own sort with it, and writing
                // one back inside that change stopped the mailbox opening
                setTimeout(() => {
                    if (revertingSnoozeGrouping) return;
                    try {
                        if (!isSnoozeMailbox(mailController.get('mailbox'))) return;
                        if (currentGroupingId().indexOf(SNOOZE_PREFIX) !== 0) return;
                        const sort = mailController.get('sort') || [];
                        const field = sort[sort.length - 1];
                        if (field && field.property === 'receivedAt' && field.isAscending) return;
                        revertingSnoozeGrouping = true;
                        try {
                            chooseGrouping('');
                        } finally {
                            revertingSnoozeGrouping = false;
                        }
                    } catch (error) {
                        reportFault('could not take the return-date grouping off a resorted list', error);
                    }
                }, 0);
            }
        }, 'go');
    };

    const watchGroupCounts = () => {
        const list = controller().get('mailboxMessageList');
        if (!list || !list.collapsedGroups || list.customCountWatch) return;
        list.customCountWatch = true;

        const check = { go: () => checkGroupCounts(list) };
        list.addObserverForKey('groupByCounts', check, 'go');
        list.addObserverForKey('queryLength', check, 'go');
        checkGroupCounts(list);
    };

    /*
     * Draw a group tiered by priorities as one group.
     *
     * The message list lays its groups out from splitOffsets: an entry per
     * category and one for the leftover bucket, each giving the group's
     * first row, its count, how many of those rows show, and where the
     * group starts and how tall it stands. Every group holding anything is
     * given a heading's room, and the headings view puts each heading at
     * its group's top, see-through where the group has no height. Left to
     * that, a group with mail in more than one tier reads as several groups
     * of the same name, and hiding headings in the page only leaves their
     * room standing empty.
     *
     * So the first tier takes the whole group: every tier's count, every
     * tier's showing rows and a single heading's room over them all. The
     * tiers after it are left holding nothing, the way an empty group's
     * entry does, so their headings are the see-through ones, and every
     * group below moves up by the headings no longer needed. The list
     * positions rows with indexToOffset and offsetToIndex, which read the
     * same entries and count a heading only for an entry holding something,
     * so rows and clicks line up with the one heading too.
     *
     * Always the first tier, even while it is empty, rather than whichever
     * tier first holds something: Fastmail fades a heading in or out over
     * 300ms as its group gains or loses height, so handing the group from
     * one tier's heading to another's crossfaded the two where they stand,
     * the outgoing one already reading 0. Pinning the first message of a
     * group whose priority is is:pinned flashed "Triage 0" over "Triage 16"
     * that way. Kept on the first tier, the group's heading never changes
     * hands, so nothing fades.
     *
     * The list is Fastmail's one message list view, patched the first time
     * it redraws.
     */
    const patchPriorityLayout = (view) => {
        if (view.customPriorityLayout) return;
        if (!Object.prototype.hasOwnProperty.call(view, 'splitOffsets') ||
            typeof view.splitOffsets !== 'function') return;
        view.customPriorityLayout = true;

        const original = view.splitOffsets;
        const splitOffsets = function () {
            const offsets = original.apply(this, arguments);
            const groups = offsets ? priorityTiers(this.get('splits')) : [];
            if (!groups.length) return offsets;

            const titleHeight = this.get('titleHeight');
            const merged = offsets.slice();
            groups.forEach((tiers) => {
                if (tiers.some(index => !merged[index])) return;
                const filled = tiers.filter(index => merged[index].count);
                if (!filled.length) return;

                const add = key => filled.reduce((sum, index) => sum + merged[index][key], 0);
                const entry = Object.assign({}, merged[tiers[0]], {
                    count: add('count'),
                    visibleCount: add('visibleCount'),
                    // Each filled tier's height carries a heading; one stays
                    height: add('height') - titleHeight * (filled.length - 1)
                });

                merged[tiers[0]] = entry;
                tiers.slice(1).forEach((index) => {
                    merged[index] = Object.assign({}, merged[index], {
                        index: entry.index + entry.visibleCount,
                        count: 0,
                        visibleCount: 0,
                        height: 0
                    });
                });
            });

            let pxTop = 0;
            return merged.map((entry) => {
                const placed = Object.assign({}, entry, { pxTop: pxTop });
                pxTop += entry.height;
                return placed;
            });
        };

        // Carries isProperty over, which is what makes it a computed property
        Object.assign(splitOffsets, original);
        view.splitOffsets = splitOffsets;
        view.computedPropertyDidChange('splitOffsets');
    };

    /*
     * A redraw that fails partway must not leave the list deaf.
     *
     * A view's redraw opens a batch of property changes before it redraws
     * anything and closes it only at the end, with nothing in between to
     * close it on an error. So one error thrown mid-redraw leaves the
     * message list holding every change it hears from then on: the group
     * headers keep the counts they had (an emptied group still reads 16),
     * and a group opened afterwards is laid out as if it were still shut, its
     * rows drawn under the last heading. Measured in the work app, where the
     * list view sat with its batch open and its changes queued until the
     * batch was closed by hand, after which everything drew as it should.
     *
     * So a redraw that throws has whatever it opened closed again, and the
     * error goes on as before. The error itself is not known yet: nothing
     * recorded it. The toast carries its message and the trace is kept on
     * window.fastmailCustom.redrawFaults(), so the next one can be read.
     */
    const redrawFaults = [];

    const guardListRedraw = () => {
        const ListView = FastMail.classes.ProgressiveListView;
        if (!ListView || ListView.prototype.customRedrawGuard) return;

        const proto = ListView.prototype;
        const original = proto.redraw;
        if (typeof original !== 'function') return;
        proto.customRedrawGuard = true;

        const depthOf = (view) => (view.__meta__ && view.__meta__.depth) || 0;

        proto.redraw = function () {
            try {
                patchPriorityLayout(this);
            } catch (layoutError) {
                reportFault('could not draw a group tiered by priorities as one group', layoutError);
            }

            const before = depthOf(this);
            try {
                return original.apply(this, arguments);
            } catch (error) {
                try {
                    while (depthOf(this) > before) this.endPropertyChanges();
                } catch (closeError) {
                    // Closing runs the queued observers; one failing again
                    // is reported with the first, and must not hide it
                }

                if (redrawFaults.length < 20) {
                    redrawFaults.push({
                        at: new Date().toISOString(),
                        message: String(error && error.message || error),
                        stack: String(error && error.stack || '')
                    });
                }
                reportFault('the message list failed to redraw: ' +
                    String(error && error.message || error), error);
                throw error;
            }
        };
    };

    /*
     * ----------------------------------------------------------------
     * The list toolbar
     * ----------------------------------------------------------------
     */

    const mailToolbar = () => {
        const page = document.getElementById('mailbox');
        const toolbar = page && page.querySelector('.v-Toolbar');
        return toolbar ? FastMail.getViewFromNode(toolbar) : null;
    };

    /*
     * The Inbox filter, made to stick.
     *
     * Fastmail offers it on a label's list; mailboxFilter, value "inbox",
     * offered only for a label with no inherited role while the account has
     * an Inbox, and forgets it the moment you go somewhere else. Under this
     * model a project label is a queue and the rest of what it holds is
     * history, so the queue is what its list should open on.
     *
     * Applied on arrival rather than held on, which is what makes turning it
     * off in the filter menu work: it stays off for as long as you stay, and
     * the next label comes up filtered again. Only a filter nobody has set is
     * written, so an unread or pinned filter carried in from elsewhere is
     * left exactly as it is.
     */
    const applyStickyFilter = () => {
        if (!settings.stickyInboxFilter) return;

        const mailController = controller();
        if (mailController.get('search')) return;

        const mailbox = mailController.get('mailbox');
        if (!mailbox || !isProject(mailbox)) return;

        try {
            if (!mailController.get('mailboxFilter')) {
                mailController.set('mailboxFilter', 'inbox');
            }
        } catch (error) {
            // No filter on this screen; nothing to make stick
        }
    };

    /*
     * ----------------------------------------------------------------
     * The message bar
     * ----------------------------------------------------------------
     */

    // The phone's message toolbar is Labels / Delete / Remove / Snooze / More.
    const bottomToolbar = () => {
        const bar = document.querySelector('.v-BottomToolbar .v-Toolbar');
        return bar ? FastMail.getViewFromNode(bar) : null;
    };

    // Phone or tablet, decided by width; 768 and up is a tablet, and kept on
    // the root view, which recomputes it as the window changes.
    const isTabletLayout = () => {
        try {
            return !!(FastMail.root && FastMail.root.get('isTablet'));
        } catch (error) {
            return false;
        }
    };

    // Three layouts, not two: isTablet is false on the Mac shell as well as
    // the phone, so a feature meant for the phone alone asks isMobile
    // directly rather than reading "not a tablet" as "is a phone".
    const isPhoneLayout = () => {
        try {
            return !!(FastMail.root && FastMail.root.get('isMobile'));
        } catch (error) {
            return false;
        }
    };

    // The bar the message actions are on. The plain question first; which bar
    // carries its own list of actions; since that is what being this bar
    // consists of, and it answers on every layout without knowing about any of
    // them.
    const messageToolbar = () => messageActionsBar() ||
        (isTabletLayout() ? actionBar() || bottomToolbar()
            : bottomToolbar() || actionBar());

    /*
     * A button's real name.
     *
     * ToolbarView keeps every view it was built with in a registry; the
     * message bar registers archive, removeLabel, snooze, trash, spam,
     * phishing, labels, move, copy, read, unread, flag, unflag, follow,
     * unfollow and mute, on both platforms, plus overflow for the More
     * button itself, and getView hands one back by that name. Identical
     * names on desktop and mobile, measured in the app's own toolbar
     * construction.
     *
     * That name is the sturdiest handle there is. It survives translation,
     * which a label does not. It survives a bar too narrow to draw the
     * button, which a glyph search does not. It survives a platform with no
     * keyboard, which a shortcut does not, and that last one is the whole
     * history of the project picker failing on the phone. So it is asked
     * first everywhere, and the older tests stay behind it for a toolbar
     * that registers nothing under the name.
     */
    // Which bar answers to a name is remembered, because the predicates below
    // are called once per view in a filter and a fresh sweep of the document
    // each time would be paid for on every pass of the bar
    const registryBars = {};

    const toolbarsOnScreen = () =>
        Array.from(document.querySelectorAll('.v-Toolbar'))
            .map(node => FastMail.getViewFromNode(node))
            .filter(view => view && typeof view.getView === 'function');

    const registeredToolbarView = (name) => {
        const cached = registryBars[name];

        try {
            if (cached && cached.get('isInDocument')) {
                const view = cached.getView(name);
                if (view) return view;
            }
        } catch (error) {
            // Gone; look for another bar below
        }

        // Every bar on screen, not just the phone's: the desktop registers the
        // same names on the toolbar it draws beside an open message, and a bar
        // that has never heard of the name simply says so.
        for (const bar of toolbarsOnScreen()) {
            try {
                const view = bar.getView(name);
                if (view) {
                    registryBars[name] = bar;
                    return view;
                }
            } catch (error) {
                // Next bar
            }
        }

        registryBars[name] = null;
        return null;
    };

    // Every bar's registry, not just the first to answer.
    const isRegisteredAs = (target, name) => !!target &&
        toolbarsOnScreen().some((bar) => {
            try {
                return bar.getView(name) === target;
            } catch (error) {
                return false;
            }
        });

    // The bar the message actions are on, whichever layout drew it.
    const ACTION_BAR_NAMES = ['move', 'labels', 'archive'];

    const actionBar = () => {
        for (const name of ACTION_BAR_NAMES) {
            if (registeredToolbarView(name) && registryBars[name]) {
                return registryBars[name];
            }
        }
        return null;
    };

    // Our own "Remove label", since Fastmail draws no such button here: the
    // third slot holds one contextual view that reads Archive while the view
    // is filtered to the Inbox; which, in this mode, every label view is, and
    // Remove only otherwise.
    const REMOVE_LABEL_SHAPES = [
        ['line', { x1: '4.75', y1: '4.75', x2: '19.25', y2: '19.25' }],
        ['circle', { cx: '15.5', cy: '8.5', r: '1.5' }],
        ['path', { d: 'M17.78,13.78l1.47-1.46V4.75H11.69L10.22,6.22M15.5,10A1.5,' +
            '1.5,0,1,1,17,8.5,1.5,1.5,0,0,1,15.5,10Z' }],
        ['path', { d: 'M8.22,8.22l-3,3a1.5,1.5,0,0,0,0,2.13l5.42,5.43a1.51,1.51,' +
            '0,0,0,2.14,0h0l3-3' }]
    ];

    // Fastmail's label glyph, as its sidebar draws it
    const LABEL_SHAPES = [
        ['path', { d: 'M11.69,4.75l-6.5,6.5a1.5,1.5,0,0,0,0,2.13l5.42,5.43a1.51,1.51,0,0,0,2.14,0h0l6.5-6.49V4.75Z' +
            'M15.5,10A1.5,1.5,0,1,1,17,8.5,1.5,1.5,0,0,1,15.5,10Z' }]
    ];

    // u-standardicon is what gives these no fill, a currentcolor stroke and
    // the weight the rest of the bar is drawn at
    const standardIcon = (name, shapes) => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'u-standardicon v-Icon ' + name);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('role', 'presentation');

        shapes.forEach(([shapeName, attributes]) => {
            const shape = document.createElementNS(SVG_NS, shapeName);
            Object.keys(attributes).forEach(key =>
                shape.setAttribute(key, attributes[key]));
            svg.appendChild(shape);
        });

        return svg;
    };

    // The app's own glyph, taken from the button that owns it. A button draws
    // its icon node as it stands, so this is the glyph the bar shows. Given a
    // class, only a glyph carrying it will do.
    const borrowedIcon = (name, className) => {
        try {
            const view = registeredToolbarView(name);
            const icon = view && view.get('icon');
            if (!icon || icon.nodeType !== 1 || !icon.cloneNode) return null;

            const copy = icon.cloneNode(true);
            const classes = (copy.getAttribute('class') || '').split(/\s+/);
            return className && classes.indexOf(className) === -1 ? null : copy;
        } catch (error) {
            return null;
        }
    };

    const removeLabelIcon = () => borrowedIcon('removeLabel', 'i-removelabel') ||
        standardIcon('i-removelabel', REMOVE_LABEL_SHAPES);

    // Set while this button is the one asking, so the redirection below lets
    // it through.
    let removingLabelOnPurpose = false;

    /*
     * A removal the mode is making itself, rather than one to interpret.
     *
     * Taking a project label off is normally a request, and this mode reads
     * it as "archive"; the label is the queue, so leaving it is done. But
     * archive's own first act is to take the project label off, and read as a
     * request that is archive again: archive called archive until the stack
     * ran out, and archiving anything already filed did nothing at all.
     *
     * So the mode's own removals say so. Nested on purpose, since the whole
     * verb runs inside one of these and the parts must not clear it early.
     */
    const removingOnPurpose = (work) => {
        const was = removingLabelOnPurpose;
        removingLabelOnPurpose = true;
        try {
            return work();
        } finally {
            removingLabelOnPurpose = was;
        }
    };

    const removeCurrentLabel = () =>
        removingOnPurpose(() => controller().actions.removeCurrent(null));

    const removeLabelOption = () => new FastMail.classes.ButtonView({
        label: 'Remove label',
        icon: removeLabelIcon(),
        target: { removeLabel: () => removeCurrentLabel() },
        method: 'removeLabel'
    });

    // The bar's spelling of the one verb Fastmail has no button for: keep, a
    // tray.
    const STATE_VERB_SHAPES = {
        // An arrow going down into an open tray. It was a tick in a circle,
        // which is the mark for done, and done is Archive, two buttons along.
        keep: [
            ['line', { x1: '12', y1: '4.4', x2: '12', y2: '13.6' }],
            ['polyline', { points: '7.6 9.2 12 13.6 16.4 9.2' }],
            ['polyline', { points: '5.2 12.6 5.2 19.6 18.8 19.6 18.8 12.6' }]
        ]
    };

    const stateVerbIcon = (kind) => standardIcon('i-' + kind, STATE_VERB_SHAPES[kind]);

    // Dispatched a tick later so the More popover has finished closing: Keep
    // sends an unfiled conversation to the Labels sheet, and two menus
    // fighting over the same moment is how taps get eaten
    const stateVerbOption = (label, kind) => {
        const run = () => setTimeout(() => runVerb('keep', null), 0);

        const option = new FastMail.classes.ButtonView({
            label: label,
            icon: stateVerbIcon(kind),
            target: { run },
            method: 'run'
        });

        // The kind, not a bare flag: the bar slots tell them apart
        option.customStateVerb = kind;
        return option;
    };

    /*
     * How many verbs the bar draws before More: a divider's position in the
     * settings page's drag list, in orderedSlots() order, kept as a plain
     * count rather than a name so a slot dragged past it moves itself in or
     * out without anything here noticing which slot it was.
     *
     * The bar used to measure its own buttons and fit as many as the width
     * allowed; the setting now always carries an explicit count instead, so
     * nothing here reads a width or a button's size. Empty or unreadable
     * still means something — every verb shown, nothing under More — rather
     * than falling back to measuring, so a value nobody has set yet behaves
     * the same on every screen size.
     */

    /*
     * Which of the two bars this is.
     *
     * A phone draws one, along the bottom of the screen. A tablet draws the
     * message's own across the top as well, and the two are different widths
     * in different places, so they are asked for separately. Read off where
     * the bar actually sits rather than from a name, since it is the same
     * class of bar either way and only the layout tells them apart.
     */
    const barIsAtTop = (toolbar) => {
        try {
            const layer = toolbar && toolbar.get('layer');
            const box = layer && layer.getBoundingClientRect();
            if (!box || !box.height) return false;
            return (box.top + box.height / 2) < (window.innerHeight / 2);
        } catch (error) {
            return false;
        }
    };

    // The count asked for. Empty or unreadable means every verb this bar
    // has, which is also the starting count until somebody has dragged the
    // divider: a value nobody has chosen yet should hide nothing that a
    // choice would have kept.
    const askedBarItems = (toolbar, names) => {
        const raw = barIsAtTop(toolbar) ? settings.topBarItems : settings.bottomBarItems;
        const count = parseInt(String(raw == null ? '' : raw).trim(), 10);
        return count >= 0 ? count : names.length;
    };

    const barCapacity = (toolbar, names) => askedBarItems(toolbar, names);

    /*
     * Saying what the bar holds, rather than rearranging what it drew.
     *
     * A ToolbarView does not keep a list of buttons. It keeps a list of
     * *names*; the account's own action list, the one Settings > Actions
     * edits, and looks each one up in a registry the bar was built with.
     * Whatever the width cannot take is the tail of that list, and the tail
     * becomes More. Both halves are derived, and both are rebuilt from the
     * names whenever the list changes.
     *
     * So a button moved by hand is a button the next rebuild does not know
     * about. Everything this mode used to fight; Labels and Delete going
     * missing, Archive drawn twice, Pin frozen reading Pin on a pinned
     * conversation; is that one mistake wearing different clothes.
     *
     * The list is the thing to write, then. Fastmail already puts only the
     * applicable verb in it (Pin or Unpin, never both), already drops what
     * the mailbox cannot do, and already draws and redraws from it. Restated
     * in the order the setting asks for, with the cut where the width falls,
     * it needs no correcting afterwards: a verb is on the bar or under More
     * because the list says so, and no rebuild can lose it.
     *
     * The conversation bar carries its own copy of that list rather than
     * sharing the class's, which is what makes this safe to do at all: the
     * message actions are taken over and the mailbox list's own bar, built
     * from the same class, is left completely alone.
     */

    // Each slot, and the name Fastmail's registry knows it by.
    const SLOT_ACTION_NAMES = {
        snooze: ['snooze'],
        pin: ['flag', 'unflag'],
        archive: ['archive'],
        labels: ['labels'],
        move: ['move'],
        'delete': ['trash'],
        keep: ['keep']
    };

    /*
     * A slot's glyph for the settings page's list, taken from where the bar
     * takes it: the button its registry holds under the slot's name. Pin
     * answers with Pin's, the first name listed, since Unpin's is blank.
     *
     * The page is usually opened from Fastmail's Settings screen, where no
     * mail toolbar is in the document to read. So each glyph read from a bar
     * is also kept, one detached copy per verb for the session, and drawn
     * from a fresh copy of that when no bar is there. Fastmail builds each
     * icon in a module of its own, with no name to ask for it by, so a bar
     * that has been drawn is the only place in the page to read them from.
     * The copies are taken whenever a bar is dressed, which is whenever one
     * is drawn.
     *
     * Keep is the mode's own button and only a message actions bar registers
     * it, so without one it is drawn from the shapes that button is drawn
     * from. Null when nothing can be read, as after a launch straight into
     * Settings, and the list then shows the name alone.
     */
    const rememberedSlotIcons = Object.create(null);

    const barSlotIcon = (slot) => {
        const names = Object.prototype.hasOwnProperty.call(SLOT_ACTION_NAMES, slot)
            ? SLOT_ACTION_NAMES[slot] : [];
        for (const name of names) {
            const icon = borrowedIcon(name);
            if (icon) return icon;
        }
        return null;
    };

    // Keep is left out: it has shapes of its own to fall back on, and only a
    // message actions bar could answer, so asking every other bar is wasted.
    const rememberSlotIcons = () => {
        try {
            Object.keys(SLOT_ACTION_NAMES).forEach((slot) => {
                if (slot === 'keep' || rememberedSlotIcons[slot]) return;
                const icon = barSlotIcon(slot);
                if (icon) rememberedSlotIcons[slot] = icon;
            });
        } catch (error) {
            // Nothing to read yet; the next bar drawn is asked again
        }
    };

    const slotIcon = (slot) => {
        const live = barSlotIcon(slot);
        if (live) return live;
        const kept = rememberedSlotIcons[slot];
        if (kept) return kept.cloneNode(true);
        return slot === 'keep' ? stateVerbIcon('keep') : null;
    };

    // The verbs that mark a list as the message actions.
    const ACTION_LIST_MARKS = ['archive', 'labels', 'move', 'trash', 'snooze', 'removeLabel'];

    /*
     * The one verb of the mode's own that lives in the menu and nowhere
     * else: Remove label, because Fastmail's own button cannot be used
     * here. It runs the plain remove, and this mode reads a plain remove on
     * a project label as "archive"; that is what keeps a swipe from quietly
     * unfiling a message. Removing on purpose has to say so, which is what
     * this one does.
     *
     * Snooze used to have one here too, beside Fastmail's own Snooze
     * button; now that button's own menu is this mode's list of presets
     * (see addSnoozePresets), so there is nothing left for a second one to
     * do.
     *
     * Named rather than inserted, like everything else on the bar.
     */
    const MODE_MENU_NAMES = ['customRemoveLabel'];

    /*
     * Our buttons, drawn the way the bar draws its own.
     *
     * A bar decides whether a verb is an icon or an icon with its name beside
     * it, and it decides that for the buttons it built itself. Ours are built
     * here, so they arrive carrying a label and no opinion about it, and on a
     * bar that shows icons only they are the one place words appear; which is
     * how Keep came to be spelled out across the top of a message on a tablet
     * while everything beside it was a picture.
     *
     * So the styling is copied from a stock button on the same bar rather
     * than decided here: whatever Archive is doing next to it is what Keep
     * does. That answers every layout, including ones this has never seen,
     * and it goes on answering when Fastmail changes its mind.
     *
     * The whole button vocabulary, not just the icon-only flag. A bar across
     * the top of a message on the Mac shows words, so nothing was icon-only
     * and nothing was copied; Keep arrived with no styling at all and drew
     * half the width of the Archive beside it.
     */
    // A stock button's type is the button's own styling and then that verb's
    // name for itself: "v-Button--subtleStandard v-Button--sizeM s-archive".
    // Only the first kind is anybody's to copy.
    const BUTTON_STYLE_PREFIX = 'v-Button--';

    // Verbs Fastmail puts on this bar itself, in the order they are worth
    // asking: the first one the bar actually has is the one to copy.
    const STOCK_STYLE_NAMES = ['archive', 'delete', 'move', 'labels', 'trash'];

    const isButtonStyle = (part) => part.indexOf(BUTTON_STYLE_PREFIX) === 0;

    const barButtonStyle = (toolbar) => {
        for (const name of STOCK_STYLE_NAMES) {
            try {
                const view = toolbar.getView(name);
                const type = view && typeof view.get === 'function' && view.get('type');
                if (type) {
                    return String(type).split(/\s+/).filter(isButtonStyle);
                }
            } catch (error) {
                // Not a verb this bar knows; try the next
            }
        }
        return null;
    };

    // Null is "the bar has not said yet", which happens before it is drawn;
    // left alone rather than guessed at, and asked again on the next pass.
    const matchBarStyle = (toolbar, view) => {
        if (!view || typeof view.set !== 'function') return;

        const style = barButtonStyle(toolbar);
        if (!style) return;

        const type = String((typeof view.get === 'function' && view.get('type')) || '');
        const parts = type ? type.split(/\s+/).filter(Boolean) : [];
        const wanted = parts.filter(part => !isButtonStyle(part)).concat(style).join(' ');
        if (wanted === type) return;

        try {
            view.set('type', wanted);
        } catch (error) {
            // A button that will not restyle is still a working button
        }
    };

    // Registered once per bar and kept: the registry is what a name is looked
    // up in, and a name it cannot answer for is a verb that is not there.
    const registerModeViews = (toolbar) => {
        const named = (name, make) => {
            const existing = toolbar.getView(name);
            if (existing) return existing;
            const view = make();
            toolbar.registerView(name, view, true);
            return view;
        };

        // Measured as it is registered, since a bar that decides what fits by
        // width has no width on file for a button it has never drawn.
        if (!toolbar.getView('keep')) {
            toolbar.registerView('keep', stateVerbOption('Keep', 'keep'));
        }
        matchBarStyle(toolbar, toolbar.getView('keep'));

        matchBarStyle(toolbar, named('customRemoveLabel', () => {
            const option = removeLabelOption();
            option.customRemoveLabel = true;
            return option;
        }));

    };

    // What a slot used to be called. The verb is Keep; it was File from 3.0
    // to 3.13, and a saved order still spells it that way. Without this the
    // name would simply not be recognised and the verb would be appended at
    // the end, quietly reordering a bar somebody had arranged.
    const SLOT_ALIASES = { file: 'keep' };

    // The setting is an order over every slot, not a subset: slots it does
    // not name join at the end, so an older saved value still places them all
    const orderedSlots = () => {
        const named = String(settings.bottomBarSlots || '')
            .split(',')
            .map(part => part.trim().toLowerCase())
            .map(name => SLOT_ALIASES[name] || name)
            .filter(name => SLOT_ACTION_NAMES[name]);

        Object.keys(SLOT_ACTION_NAMES).forEach((name) => {
            if (named.indexOf(name) === -1) named.push(name);
        });

        return named;
    };

    const arrangeActions = (original, toolbar) => {
        const names = (original || []).filter(name => name !== '-' && name !== '*');
        const has = (name) => names.indexOf(name) !== -1;

        // Not the message actions: a read-only mailbox's short list, or none
        // at all. Left exactly as it came.
        if (!ACTION_LIST_MARKS.some(has)) return original;

        const wanted = [];
        orderedSlots().forEach((slot) => {
            const candidates = SLOT_ACTION_NAMES[slot];
            let pick = candidates.filter(has)[0];

            // Keep is ours, so it is never in Fastmail's list; and inside a
            // label Fastmail offers Remove label in Archive's place, while
            // this mode wants the full verb.
            if (!pick && (slot === 'keep' || slot === 'archive')) pick = candidates[0];
            if (pick && wanted.indexOf(pick) === -1) wanted.push(pick);
        });

        const onBar = wanted.slice(0, barCapacity(toolbar, wanted));
        const underMore = wanted.slice(onBar.length)
            .concat(names.filter(name => wanted.indexOf(name) === -1))
            .concat(MODE_MENU_NAMES);

        // A trailing divider after each drawn verb and none after the cut, in
        // the shape the bar builds for itself
        const config = [];
        onBar.forEach((name) => config.push(name, '-'));
        config.push('*');
        return config.concat(underMore);
    };

    /*
     * Take the list over, once per bar.
     *
     * The wrapper keeps the original's own marks; what makes it a computed
     * property, and which changes it recomputes for; so the bar still
     * redraws itself when the mailbox, the labels mode or the pinned state
     * moves. Only the answer differs.
     */
    const ownActionsConfig = (toolbar) => {
        if (!toolbar) return false;
        if (toolbar.customOwnsConfig) return true;

        // Only a bar with a list of its own. The mailbox list's bar shares
        // the class's, and rewriting that would rewrite its Actions menu too.
        if (!Object.prototype.hasOwnProperty.call(toolbar, 'actionsConfig')) return false;

        const original = toolbar.actionsConfig;
        if (typeof original !== 'function' || !original.isProperty) return false;
        if (typeof toolbar.registerView !== 'function') return false;
        if (typeof toolbar.computedPropertyDidChange !== 'function') return false;

        const wrapped = function () {
            const names = original.apply(this, arguments);

            try {
                return arrangeActions(names, this);
            } catch (error) {
                reportFault('could not arrange the bar', error);
                return names;
            }
        };

        // isProperty and dependencies above all; whatever else Overture hung
        // on it travels too, since the bar reads them and we do not own them
        Object.getOwnPropertyNames(original).forEach((key) => {
            if (key === 'length' || key === 'name' || key === 'prototype') return;
            try {
                wrapped[key] = original[key];
            } catch (error) {
                // Read-only; the ones that matter are not
            }
        });

        try {
            // Before the list can name them: a name the registry cannot answer
            // for is a hole in the drawn bar, and the redraw walks straight
            // into it.
            registerModeViews(toolbar);
            toolbar.actionsConfig = wrapped;
            toolbar.customOwnsConfig = true;

            // The bar's own list can still change size (a rotation, the
            // reading pane opening); recomputed here so a stale arrangement
            // is never left on screen, even though the cut itself no longer
            // depends on width.
            toolbar.addObserverForKey('pxWidth', configWatcher, 'widthDidChange');
            toolbar.computedPropertyDidChange('actionsConfig');
            return true;
        } catch (error) {
            reportFault('could not take over the bar', error);
            toolbar.customOwnsConfig = false;
            return false;
        }
    };

    /*
     * The message actions bar, identified by the thing that makes it one.
     *
     * Asking the registry for a verb finds any bar that knows the name, and
     * the mailbox list's bar knows all of them; it builds its own Actions
     * menu from the same buttons. What only the message actions bar has is a
     * list of its own: the class holds one, and this bar is handed a second
     * that answers for the open message. So that is what to look for.
     */
    // All of them, not the first. A tablet draws two; the open message's
    // header and the list's own bar for a selection, and both are message
    // actions bars with the same list.
    const messageActionsBars = () => toolbarsOnScreen().filter(toolbar =>
        Object.prototype.hasOwnProperty.call(toolbar, 'actionsConfig'));

    const messageActionsBar = () => messageActionsBars()[0] || null;

    const configWatcher = {
        widthDidChange(toolbar) {
            try {
                toolbar.computedPropertyDidChange('actionsConfig');
            } catch (error) {
                // The bar is going away
            }
        }
    };

    // A changed setting has to reach the bar, but the wrapper only answers
    // again the next time it is asked.
    const refreshOwnedConfigs = () => {
        toolbarsOnScreen().forEach((toolbar) => {
            if (!toolbar.customOwnsConfig) return;
            try {
                // The snooze period may have moved with the rest
                registerModeViews(toolbar);
                toolbar.computedPropertyDidChange('actionsConfig');
            } catch (error) {
                // Gone
            }
        });
    };

    /*
     * The bar arranges itself.
     *
     * Everything this used to do; moving buttons between the bar and More,
     * putting back the ones a rebuild dropped, keeping a substitute Archive
     * and a Pin that could toggle; was work created by writing to the drawn
     * bar instead of to the list it is drawn from. Taking the list over left
     * none of it to do.
     *
     * A bar being dressed is also a bar on screen, so its glyphs are copied
     * here for the settings page, which is mostly drawn where no bar is.
     */
    const dressToolbar = () => {
        rememberSlotIcons();
        messageActionsBars().forEach(ownActionsConfig);
    };

    // The bar's Pin says nothing about state as Fastmail draws it: one
    // outline, whatever the thread carries.
    const openThreadIsPinned = () => {
        let message = null;
        try {
            message = controller().get('message');
        } catch (error) {
            return false;
        }
        if (!message) return false;
        return threadOf(message).some(other => other.get('isFlagged'));
    };

    // Pin and Unpin are two buttons in the bar's own registry, not one that
    // changes its mind, and the list names whichever applies.
    const PIN_VIEW_NAMES = ['flag', 'unflag'];

    const updatePinState = () => {
        const pinned = openThreadIsPinned();

        messageActionsBars().forEach((toolbar) => {
            PIN_VIEW_NAMES.forEach((name) => {
                try {
                    const view = toolbar.getView(name);
                    const layer = view && view.get('layer');
                    if (layer) layer.classList.toggle('custom-pinned', pinned);
                } catch (error) {
                    // Not drawn, or the bar is going away
                }
            });
        });
    };

    // A search that starts with in:inbox is an Inbox view by another name; the
    // saved search listing what has not been triaged yet.
    const INBOX_SEARCH = /^\s*in:inbox\b/i;

    const isInboxSearch = () => INBOX_SEARCH.test(controller().get('search') || '');

    // Whether this screen is one the mode has anything to say about.
    const modeAppliesHere = () =>
        FastMail.router.get('app') === 'mail' &&
        (!controller().get('search') || isInboxSearch());

    // The bar is rebuilt as you move around, so it is dressed again on every
    // move rather than once.
    /*
     * Collapse or expand every group of the list at once, from the list's
     * own bar beside Filter and Sort. One button: while any group with
     * messages is open it collapses them all, otherwise it opens them all;
     * greyed out when the list is not grouped.
     *
     * The bar draws from its computed rightConfig, which is wrapped on each
     * list bar the way the message actions bar's list is, to put the button
     * before Sort; not while a selection has the bar, which then shows the
     * selection's own actions. The folds go in the way adoptList puts them
     * in: the set first, then the length recounted and the range redrawn,
     * then collapsedGroupsDidChange, which stores them where a heading's own
     * click does (Fastmail's split, or the mode's remembered folds).
     */
    const FOLD_GROUPS_VIEW = 'customFoldGroups';

    const FOLD_ICON_SHAPES = {
        // Chevrons meeting, and parting
        collapse: [['polyline', { points: '7 4.5 12 9.5 17 4.5' }], ['polyline', { points: '7 19.5 12 14.5 17 19.5' }]],
        expand: [['polyline', { points: '7 9.5 12 4.5 17 9.5' }], ['polyline', { points: '7 14.5 12 19.5 17 14.5' }]]
    };

    // The open list's groups as the list view lays them out, or null when it
    // is not grouped
    const listGroups = () => {
        try {
            const list = controller().get('mailboxMessageList');
            if (!list || !list.collapsedGroups || typeof list.computedPropertyDidChange !== 'function') return null;
            const node = document.querySelector('.v-Mailbox');
            const view = node && FastMail.getViewFromNode(node);
            const offsets = view && typeof view.get === 'function' ? view.get('splitOffsets') : null;
            if (!Array.isArray(offsets) || offsets.length < 2) return null;
            return { list, offsets };
        } catch (error) {
            return null;
        }
    };

    const anyGroupOpen = (groups) => groups.offsets.some(entry => entry.count && !entry.collapsed);

    const foldAllGroups = () => {
        const groups = listGroups();
        if (!groups) return;
        const { list, offsets } = groups;
        const collapse = anyGroupOpen(groups);
        const before = list.get('length') || 0;
        offsets.forEach((entry, index) => {
            if (collapse) list.collapsedGroups.add(index);
            else list.collapsedGroups.delete(index);
        });
        list.computedPropertyDidChange('length');
        list.rangeDidChange(0, Math.max(before, list.get('length') || 0));
        if (typeof list.collapsedGroupsDidChange === 'function') list.collapsedGroupsDidChange();
        setTimeout(updateFoldGroupsButton, 0);
    };

    const updateFoldGroupsButton = () => {
        const groups = listGroups();
        const collapse = !groups || anyGroupOpen(groups);
        const label = collapse ? 'Collapse all groups' : 'Expand all groups';
        const buttons = toolbarsOnScreen()
            .map(toolbar => toolbar.customFoldGroups && toolbar.getView(FOLD_GROUPS_VIEW));
        if (headerFoldButton) buttons.push(headerFoldButton);
        buttons.forEach((button) => {
            if (!button) return;
            try {
                if (button.get('isDisabled') !== !groups) button.set('isDisabled', !groups);
                if (button.get('label') !== label) {
                    button.set('label', label);
                    button.set('icon', standardIcon('i-fold-' + (collapse ? 'collapse' : 'expand'),
                        FOLD_ICON_SHAPES[collapse ? 'collapse' : 'expand']));
                }
            } catch (error) {
                // The bar is going away
            }
        });
    };

    // The mailbox list's bar: the one with Sort, and a rightConfig of its own
    const dressListToolbars = () => {
        toolbarsOnScreen().forEach((toolbar) => {
            if (toolbar.customFoldGroups || !toolbar.getView('sort') ||
                    !Object.prototype.hasOwnProperty.call(toolbar, 'rightConfig') ||
                    typeof toolbar.rightConfig !== 'function') return;
            const original = toolbar.rightConfig;
            const wrapped = function () {
                const names = original.apply(this, arguments);
                if (!Array.isArray(names) || names.indexOf('selection') !== -1) return names;
                const at = names.indexOf('sort');
                if (at === -1 || names.indexOf(FOLD_GROUPS_VIEW) !== -1) return names;
                return names.slice(0, at).concat(FOLD_GROUPS_VIEW, names.slice(at));
            };
            Object.getOwnPropertyNames(original).forEach((key) => {
                if (key === 'length' || key === 'name' || key === 'prototype') return;
                try {
                    wrapped[key] = original[key];
                } catch (error) {
                    // Read-only; the ones that matter are not
                }
            });
            try {
                const sort = toolbar.getView('sort');
                toolbar.registerView(FOLD_GROUPS_VIEW, new FastMail.classes.ButtonView({
                    type: String(sort.get('type') || 'v-Button--subtleStandard v-Button--sizeM v-Button--iconOnly v-Button--tooltipLabel'),
                    icon: standardIcon('i-fold-collapse', FOLD_ICON_SHAPES.collapse),
                    label: 'Collapse all groups',
                    target: { run: foldAllGroups },
                    method: 'run'
                }), true);
                toolbar.rightConfig = wrapped;
                toolbar.customFoldGroups = true;
                toolbar.computedPropertyDidChange('rightConfig');
            } catch (error) {
                reportFault('could not add the collapse-all button', error);
                toolbar.customFoldGroups = true;
            }
        });
        updateFoldGroupsButton();
    };

    /*
     * The phone and the iPad have no list bar. The row above the mailbox's
     * title is Fastmail's PageHeaderView, drawn once from a fixed list of
     * buttons that ends in the ⋯ menu holding Filter, Group and Sort; the
     * button goes in just before that menu. The menu sits in a SwitchView
     * that swaps it for Cancel while the search field has focus, and the
     * button joins the menu's list there, so it comes and goes with it.
     */
    let headerFoldButton = null;

    // Told apart by what its menu offers: its menuView is the raw computed
    // function, and the key it hands Group's entries to survives minifying
    const headerListMenu = () => {
        const MenuButton = FastMail.classes.MenuButtonView;
        return Array.from(document.querySelectorAll('.v-PageHeader button'))
            .map(node => FastMail.getViewFromNode(node))
            .find(view => view instanceof MenuButton && typeof view.menuView === 'function' &&
                /\bgroupOptions\b/.test(Function.prototype.toString.call(view.menuView))) || null;
    };

    const dressPageHeader = () => {
        if (!isPhoneLayout() && !isTabletLayout()) return;
        const menu = headerListMenu();
        const header = menu && menu.get('parentView');
        if (!header || (headerFoldButton && headerFoldButton.get('parentView') === header)) return;
        try {
            const button = new FastMail.classes.ButtonView({
                type: 'v-Button--iconOnly',
                icon: standardIcon('i-fold-collapse', FOLD_ICON_SHAPES.collapse),
                label: 'Collapse all groups',
                target: { run: foldAllGroups },
                method: 'run'
            });
            const switcher = (header.get('childViews') || []).find(view =>
                Array.isArray(view.views) && view.views.some(list =>
                    Array.isArray(list) && list.indexOf(menu) !== -1));
            if (switcher) {
                const list = switcher.views.find(one => Array.isArray(one) && one.indexOf(menu) !== -1);
                list.splice(list.indexOf(menu), 0, button);
            }
            header.insertView(button, menu, 'before');
            headerFoldButton = button;
        } catch (error) {
            reportFault('could not add the collapse-all button to the header', error);
        }
        updateFoldGroupsButton();
    };

    const refreshToolbar = () => {
        dressListToolbars();
        dressPageHeader();
        if (modeAppliesHere()) {
            // Every layout that has a message actions bar: along the bottom
            // on a phone, across the top of the message on a tablet and on
            // the Mac. The setting names one list of verbs for all three.
            dressToolbar();
            updatePinState();
        }

        updateInboxLabelVisibility();
        updateFloatingNav();
    };

    /*
     * ----------------------------------------------------------------
     * Drag and drop
     * ----------------------------------------------------------------
     */

    // Overture's copy drag effect, which is what holding Option asks for
    const DRAG_EFFECT_COPY = 1;

    // Dropping a message on a label adds it, and the rules under every menu do
    // the rest: a project takes Triage and any other project off, the Inbox
    // stays.
    const patchDrop = () => {
        const proto = FastMail.classes.MailboxSourceView.prototype;
        const original = proto.drop;
        const originalWillAccept = proto.willAcceptDrag;

        // Said before the drop rather than after it: the head of a nest is
        // not somewhere mail goes, so its row does not light up as a target
        // and the message stays where it was. A row that took the drop and
        // then did nothing would look like a bug.
        proto.willAcceptDrag = function () {
            if (settings.dragAdditive && isRootLabel(this.get('content'))) {
                return false;
            }

            return originalWillAccept.apply(this, arguments);
        };

        proto.drop = function (drag) {
            if (!settings.dragAdditive) return original.apply(this, arguments);

            const mailbox = this.get('content');
            if (!mailbox.get('mayAddItems')) return;
            // Refused above; this is for a drop that reaches here another way
            if (isRootLabel(mailbox)) return;

            drag.getDataOfType('MessageStoreKeys', (storeKeys) => {
                if (!storeKeys) return;

                const actions = controller().actions;
                const optionHeld = !!(drag.get('dropEffect') & DRAG_EFFECT_COPY);

                // A drop files: a destination replaces by rule 2, a hold
                // label included, and a named one files the sender by rule 3.
                asFiling(null, () => {
                    if (optionHeld) {
                        // Fastmail's move: Inbox off, label on. Asked for with
                        // a modifier, so left exactly as asked; rule 2 still
                        // takes Triage and every other destination off under.
                        actions.move(storeKeys, mailbox);
                    } else if (!FastMail.preferences.get('inLabelsMode')) {
                        asKeep(() => actions.copy(storeKeys, mailbox));
                    } else {
                        asKeep(() => actions.add(storeKeys, mailbox));
                    }
                });
            });
        };
    };

    /*
     * ----------------------------------------------------------------
     * The Labels menu
     * ----------------------------------------------------------------
     */

    // Move to is the quick one: a plain list with no checkboxes and no Save,
    // so a message is filed by typing a few letters.
    let wantOurMove = false;
    // True while the Keep verb is opening the tristate Labels menu, a
    // multi-selection's picker; so that menu files rather than merely labels
    let wantOurFile = false;

    // The options list is an OptionsProxy, which reports a length and answers
    // getObjectAt but whose map() yields nothing and whose get('[]') is null.
    const optionsOf = (menuController) => {
        const options = menuController.get('options');
        if (!options) return [];

        const length = typeof options.get === 'function'
            ? options.get('length')
            : options.length;

        const list = [];
        for (let i = 0; i < length; i += 1) {
            list.push(options.getObjectAt ? options.getObjectAt(i) : options[i]);
        }

        return list;
    };

    // The menu offers "Create label…" alongside the mailboxes, and that is an
    // option like any other, so anything counting what is left has to count
    // records rather than options.
    const labelOptions = (menuController) =>
        optionsOf(menuController)
            .filter(option => option instanceof FastMail.classes.Mailbox);

    // Once typing has left a single label, save it.
    const autoSaveWhenAlone = (menuController) => {
        if (menuController.customAutoSave) return;
        menuController.customAutoSave = true;

        const originalSetOptions = menuController.setOptions;

        menuController.setOptions = function () {
            originalSetOptions.apply(this, arguments);

            if (!this.customOurs || !settings.labelsAutoSave) return;
            if (!this.get('search')) return;

            const labels = labelOptions(this);
            if (labels.length !== 1) return;

            // setOptions runs while the list is being rebuilt, and checkFocus
            // has only just moved the focus, so let that settle first
            setTimeout(() => {
                if (!this.customOurs) return;
                if (labelOptions(this).length !== 1) return;

                const menu = this.customMenu;
                if (!menu) return;

                // Selecting is what files it, exactly as picking it by hand
                // does; closing afterwards is only tidying up
                this.focus(labels[0]);
                this.selectFocused();

                if (typeof menu.done === 'function') menu.done();
            }, 0);
        };
    };

    // rolesVisible drops the system mailboxes, but not every label of your own
    // is in the sidebar either, and offering those back defeats the point of
    // narrowing the list.
    const narrowLabelOptions = (menuController) => {
        if (menuController.customFilter) return;
        menuController.customFilter = true;

        const originalFilterOptions = menuController.filterOptions;

        menuController.filterOptions = function () {
            const options = originalFilterOptions.apply(this, arguments);

            // Archiving into a label: the hold labels and nothing else, since
            // a hold label is the only kind that survives an archive.
            if (this.customArchiveInto) {
                return options.filter(option =>
                    option instanceof FastMail.classes.Mailbox && isExcludedLabel(option));
            }

            // The Labels menu is Fastmail's own; the full list, helpers and
            // all; so it is left as it comes.
            if (!this.customOurs) return options;

            // The head of a nest is never offered, typed or not. Typing is
            // asking for something by name, but a name you can reach that way
            // is a name you can pick, and picking the shelf is the one thing
            // this list must not let you do. "Create label…" and the other
            // helpers are not mailboxes and are left alone.
            const offered = options.filter(option =>
                !(option instanceof FastMail.classes.Mailbox) || !isRootLabel(option));

            // Typing is asking for something by name
            if (this.get('search')) return offered;

            return offered.filter((option) => {
                if (!(option instanceof FastMail.classes.Mailbox)) return true;

                return !settings.labelsSidebarOnly || isDestination(option);
            });
        };
    };

    // Move to files by moving: measured, its didSelect is a one-shot
    // `actions.move(null, mailbox)`, where null means the current selection.
    const isLabelsMenu = (menu) => !!menu.get('willAdd') && !!menu.get('willRemove');

    // Picking a helper label leaves the menu open: there is likely another one
    // coming, and selectFocused has already cleared what you typed.
    const submitAfterPlacing = (menuController, menu) => {
        if (menuController.customSubmit) return;
        menuController.customSubmit = true;

        const originalSelect = menuController.select;

        menuController.select = function (option) {
            const result = originalSelect.apply(this, arguments);

            if (!this.customLabels) return result;
            if (!(option instanceof FastMail.classes.Mailbox)) return result;
            // A hold label is a placing decision only when the Keep verb
            // opened this menu; from the L key it is a helper and stays open
            const places = isProject(option) ||
                (this.customFiling && isExcludedLabel(option));
            if (!places) return result;

            // Both spent as they are read, so the menu cannot make the same
            // decision twice. An archive steps the view itself, so a pick that
            // ends in one hands its advance to nobody: the filing and the
            // archive would each take a step, and the message after next is
            // not where anyone asked to be.
            const archiveInto = this.customArchiveInto;
            const advance = archiveInto ? null : this.customAdvance;
            this.customArchiveInto = false;
            this.customAdvance = null;

            // Closing is what writes. The tristate holds its ticks in a map
            // and applies them in one addremove as it leaves the document,
            // read out of the app bundle; so the whole change lands inside
            // this call, and a filing can say so around it rather than ahead
            // of it.
            if (typeof menu.done === 'function') {
                const close = () => menu.done();
                // A keep, unless the archive below is where this is going
                if (this.customFiling) asFiling(advance, archiveInto ? close : () => asKeep(close));
                else close();
            }

            // Archiving into a label: the tristate menu has just put the
            // label on, and the decision is what follows it
            if (archiveInto) runDoneInto(option);

            return result;
        };
    };

    // True once the menu has been dressed; false while it has no controller
    // to dress, which is how the first opening of a reused menu arrives. The
    // caller tries again, the way the Move menu's does: a menu left undressed
    // is a menu that does not narrow, does not file, and holds on to nothing
    // handed to it.
    const applyLabelsMode = (menu, files) => {
        const menuController = menu.get('controller');
        if (!menuController) return false;

        // The list is left stock; Labels is Fastmail's full picker.
        submitAfterPlacing(menuController, menu);
        narrowLabelOptions(menuController);
        // Taken, not read: the verb set these for the next picker to open,
        // and this is that picker. From here they belong to the menu, and a
        // menu dismissed without a pick takes them away when it goes.
        menuController.customArchiveInto = takeArchiveInto();
        menuController.customAdvance = takeAdvance();

        menuController.customMenu = menu;
        menuController.customLabels = true;
        // Opened by the Keep verb for a multi-selection, this menu files: a
        // hold label commits like a project. Opened from the L key it does not.
        menuController.customFiling = files;

        if (typeof menuController.setOptions === 'function') menuController.setOptions();

        return true;
    };

    /*
     * ----------------------------------------------------------------
     * Filing the sender as well as the message
     * ----------------------------------------------------------------
     *
     * Picking a label named in contactGroupLabels adds from[0] to the
     * contact group of the same name, making the contact, and the group,
     * if either is new.
     *
     * Contacts are ordinary records in the same store the mail lives in,
     * measured in a running app: ten thousand of them, resident without the
     * Contacts app ever being opened, which is what makes this a lookup
     * rather than a fetch. A group is a contact too: kind "group", with a
     * members object keyed by member uid, and addContact/removeContact on
     * the record itself. Fastmail's own VIPs feature is the same shape, and
     * its find-or-create is the pattern followed here.
     *
     * The contact is created the way the Contacts app creates one; isShared
     * and a uid, then saveToStore; with the address book set explicitly,
     * because a group only holds members of its own account and the picker
     * can be standing in either one.
     */

    const contactGroupPaths = () => pathsFromSetting(settings.contactGroupLabels);

    const wantsContactGroup = (mailbox) => {
        if (!contactGroupPaths().length) return false;

        const path = mailboxPath(mailbox).toLowerCase();
        return contactGroupPaths().some(named => named.toLowerCase() === path);
    };

    // The book a new contact goes in: the account's default one, or any it may
    // write to.
    const addressBookFor = (accountId) => {
        const AddressBook = FastMail.classes.AddressBook;
        if (!AddressBook) return null;

        const mine = (data) => data.accountId === accountId &&
            (!data.myRights || data.myRights.mayWrite);

        return FastMail.store.getOne(AddressBook, data => mine(data) && data.isDefault) ||
            FastMail.store.getOne(AddressBook, mine) ||
            null;
    };

    // Group names live on the record as name.full; a person's name is a
    // components list instead, which is why this reads the raw data rather
    // than the computed property; getOne hands over stored data, not records.
    const contactGroupNamed = (accountId, name) => {
        const Contact = FastMail.classes.Contact;
        if (!Contact) return null;

        const wanted = String(name || '').toLowerCase();
        if (!wanted) return null;

        return FastMail.store.getOne(Contact, data =>
            data.accountId === accountId &&
            data.kind === 'group' &&
            String((data.name && data.name.full) || '').toLowerCase() === wanted) || null;
    };

    const contactWithEmail = (accountId, email) => {
        const Contact = FastMail.classes.Contact;
        if (!Contact) return null;

        const wanted = String(email || '').toLowerCase();
        if (!wanted) return null;

        return FastMail.store.getOne(Contact, (data) => {
            if (data.kind === 'group' || data.accountId !== accountId) return false;
            if (!data.emails) return false;

            return Object.keys(data.emails).some(key =>
                String(data.emails[key].address || '').toLowerCase() === wanted);
        }) || null;
    };

    const makeContact = (accountId, email, name) => {
        const Contact = FastMail.classes.Contact;
        const book = addressBookFor(accountId);
        if (!Contact || !book) return null;

        const contact = new Contact(FastMail.store)
            .set('isShared', false)
            .set('uid', crypto.randomUUID())
            .set('addressBook', book)
            .set('name', name || email)
            .set('emails', [{
                type: 'personal',
                label: null,
                value: String(email).toLowerCase(),
                isDefault: true
            }]);

        contact.saveToStore();
        return contact;
    };

    // A group is a contact with kind "group", so making one is the same call
    // with the kind set and no email; the shape the Contacts app's own new-
    // group flow builds before handing it to its edit dialog.
    const makeContactGroup = (accountId, name) => {
        const Contact = FastMail.classes.Contact;
        const book = addressBookFor(accountId);
        if (!Contact || !book || !name) return null;

        const group = new Contact(FastMail.store)
            .set('isShared', false)
            .set('uid', crypto.randomUUID())
            .set('kind', 'group')
            .set('addressBook', book)
            .set('name', name);

        group.saveToStore();
        return group;
    };

    // What the next undo takes back. One deep and cleared on use, the same
    // shape the return-to-message stamp uses: the membership is undone because
    // it was this pick that added it, and the contact is left alone because a
    // contact that now exists is not a mistake.
    let pendingGroupAdds = null;
    let lastGroupAdds = null;

    const undoGroupAdds = () => {
        const adds = lastGroupAdds;
        lastGroupAdds = null;
        if (!adds) return;

        adds.forEach(({ group, contact }) => {
            try {
                group.removeContact(contact);
            } catch (error) {
                reportFault('could not take the contact back out', error);
            }
        });
    };

    const fileSendersIntoGroup = (mailbox, keys) => {
        if (!mailbox || !wantsContactGroup(mailbox)) return;

        try {
            const accountId = mailbox.get('accountId');
            const leaf = mailbox.get('displayName');

            // Found by the label's own name; its leaf first, then its full
            // path, and made under the leaf when neither turns one up.
            const group = contactGroupNamed(accountId, leaf) ||
                contactGroupNamed(accountId, mailboxPath(mailbox)) ||
                makeContactGroup(accountId, leaf);

            if (!group) {
                reportFault('could not find or make a contact' +
                    ' group named ' + mailboxPath(mailbox));
                return;
            }

            const added = [];
            const names = [];
            let made = 0;

            messagesFrom(keys).forEach((message) => {
                // Only a label that was not there already. Re-picking a label
                // a conversation is filed under is a correction or a no-op;
                // the sender was dealt with the first time, and filing them
                // again on every pass is how a group fills up with people you
                // only meant to add once.
                if (carriesMailbox(message, mailbox)) return;

                const from = message.get('from');
                const sender = from && from[0];
                if (!sender || !sender.email) return;

                const existing = contactWithEmail(accountId, sender.email);
                const contact = existing ||
                    makeContact(accountId, sender.email, sender.name);
                if (!contact) return;

                // Already a member: nothing to add, and nothing an undo
                // should take away either
                if (group.includes(contact)) return;

                group.addContact(contact);
                added.push({ group: group, contact: contact });
                names.push(sender.name || sender.email);
                if (!existing) made += 1;
            });

            pendingGroupAdds = added.length ? added : null;
            if (added.length) {
                // Joined to the verb's Undo toast where there is one, so
                // neither hides the other
                const who = names.length === 1
                    ? names[0]
                    : names.length + ' senders';

                showToastWithUndo(made
                    ? who + ' added to contacts and ' + group.get('name')
                    : who + ' added to ' + group.get('name'));
            }
        } catch (error) {
            reportFault('could not file the sender', error);
        }
    };

    /*
     * Filing a message under a label adds its sender to contacts, with
     * keepAddsContact on: keeping it, or archiving it into one with Shift-E.
     * The same find-or-make a contact group label uses, without the group;
     * and it runs after the group, so a label that names one has made the
     * contact already and there is nothing left to add.
     *
     * Your own addresses are left out: a message you sent, kept under a
     * project, is not someone to add.
     */
    const isOwnAddress = (email) => {
        const Identity = FastMail.classes.Identity;
        if (!Identity) return false;

        const wanted = String(email || '').toLowerCase();
        return FastMail.store.getAll(Identity).some((identity) => {
            const own = String(identity.get('email') || '').toLowerCase();
            // A wildcard identity sends as anyone at its domain
            return own.startsWith('*@') ? wanted.endsWith(own.slice(1)) : own === wanted;
        });
    };

    const addSendersToContacts = (keys) => {
        if (!settings.keepAddsContact) return;

        try {
            const seen = new Set();
            const names = [];

            messagesFrom(keys).forEach((message) => {
                const from = message.get('from');
                const sender = from && from[0];
                if (!sender || !sender.email) return;

                const accountId = message.get('accountId');
                const email = String(sender.email).toLowerCase();
                // Once per sender, however many of their messages were kept
                if (seen.has(accountId + ' ' + email)) return;
                seen.add(accountId + ' ' + email);

                if (isOwnAddress(email) || contactWithEmail(accountId, email)) return;
                if (makeContact(accountId, email, sender.name)) {
                    names.push(sender.name || email);
                }
            });

            if (names.length) {
                showToastWithUndo((names.length === 1 ? names[0] : names.length + ' senders') +
                    ' added to contacts');
            }
        } catch (error) {
            reportFault('could not add the sender to contacts', error);
        }
    };

    const addInsteadOfMoving = (menu) => {
        if (menu.customAdditive) return;
        menu.customAdditive = true;

        const originalDidSelect = menu.didSelect;

        menu.didSelect = function (mailbox) {
            if (!this.customOurs) return originalDidSelect.apply(this, arguments);

            const advance = this.customAdvance;
            this.customAdvance = null;

            // Opened by Shift-E or a long press on Archive: the pick is a
            // decision rather than a filing, and the verb finishes it; it
            // steps the view itself, so the advance is dropped rather than
            // handed on.
            if (this.customArchiveInto) {
                this.customArchiveInto = false;
                runDoneInto(mailbox);
                return;
            }

            // A pick is an add. Rule 2 takes Triage and every other
            // destination off underneath, rule 3 files the sender; nothing is
            // decided here. A picker built for particular conversations
            // files those; any other files what is selected by now.
            const actions = controller().actions;
            const keys = this.customKeys || null;
            asFiling(advance, () => asKeep(() => {
                if (FastMail.preferences.get('inLabelsMode')) {
                    actions.add(keys, mailbox);
                } else {
                    actions.copy(keys, mailbox);
                }
            }));
        };
    };

    // The menu is built once and reused, so none of this can live in its
    // construction: opened by Option-V after being opened by v, it would still
    // be carrying our narrowing.
    const applyMoveMode = (menu, ours) => {
        const menuController = menu.get('controller');
        // Answered rather than assumed: the first time the menu is opened it
        // enters the document before its controller is set, and a menu with no
        // controller cannot be narrowed yet. The caller tries again.
        if (!menuController) return false;

        autoSaveWhenAlone(menuController);
        narrowLabelOptions(menuController);
        addInsteadOfMoving(menu);

        menuController.customMenu = menu;
        menu.customOurs = ours;
        menuController.customOurs = ours;
        // Taken, not read. The keystroke armed it for the next picker to
        // open, and this is that picker, so it comes off the global and onto
        // the menu: the list it narrows and the pick it decides are both this
        // menu's, and a menu dismissed without a pick takes it away with it.
        // On the view as well as the controller, because the pick arrives at
        // the view's didSelect and the narrowing at the controller's filter.
        // Spent whether or not this is our menu: it was armed for whichever
        // picker opened next, and if that turned out to be a menu of
        // Fastmail's it is spent wrongly rather than left lying here.
        const armed = takeArchiveInto();
        const advance = takeAdvance();
        const archiveInto = ours && armed;
        menu.customArchiveInto = archiveInto;
        menuController.customArchiveInto = archiveInto;
        // The pick arrives at the view's didSelect, so the advance rides
        // there; a menu of Fastmail's own has no verb waiting on it.
        menu.customAdvance = ours ? advance : null;

        // filterOptions keeps a mailbox when rolesVisible has a truthy entry
        // for its inherited role, so this leaves the labels you gave names to
        // and drops Trash, Archive, Spam and the rest; which are one mistyped
        // letter away in a menu you drive by typing.
        const roles = ours && settings.labelsSidebarOnly ? { none: true } : null;

        menu.set('rolesVisible', roles);
        menuController.set('rolesVisible', roles);

        if (typeof menuController.setOptions === 'function') {
            menuController.setOptions();
        }

        return true;
    };

    /*
     * ----------------------------------------------------------------
     * Snooze presets; Fastmail's own Snooze button and shortcut, `b`
     * ----------------------------------------------------------------
     *
     * Fastmail's own Snooze button is a MenuButtonView whose menu is a
     * FutureTimeMenuView, read off its own bundle (NewEvent.mod.js, folded
     * into mail.mod.js's own import list). Its draw() builds
     * `this.menuView = new MenuView({showFilter:false, closeOnActivate:true,
     * options: this.drawOptions()})` - the very MenuView class patchMenus
     * already patches for the Group menu, with the very same plain, mutable
     * `options` array addGroupings already rewrites. So this list is added
     * the same way, in the same patched draw(), rather than through any
     * dialog-swapping mechanism of its own.
     *
     * drawOptions() builds six numbered presets, each `new ButtonView({
     * shortcut: "1".."6", date: <a Date>, target: this,
     * method: "menuDateChosen" })`, and a seventh, `new ButtonView({
     * shortcut: "7", target: this, method: "showCustomPicker" })`; all seven
     * share one target, the FutureTimeMenuView itself. Numbered shortcuts
     * are not a MenuView behaviour that falls out of an option's position:
     * "shortcut" is a plain property any ButtonView carries (confirmed on
     * ButtonView's own Mixin in the bundle: an empty default, registered
     * with the global shortcut table on didEnterDocument whenever it is
     * non-empty), and FutureTimeMenuView sets it explicitly per option. So
     * every preset built below sets one of its own the same way.
     *
     * menuDateChosen reads the button's own `date` and hands it to
     * didSelect, which the mail app's own FutureTimeMenuView overrides to
     * call a real, callable primitive: `controller().actions.snooze(keys,
     * date)`. Confirmed both off the static bundle and live, read-only,
     * against the real running app (its own toString() matches the bundle
     * byte for byte): `snooze(e,t){if(eA&&this.dispatchToMainWindow(...)
     * ||!t)return this; ...}` - a plain Date is enough, with no dependence
     * on the custom picker's own local-time-written-as-UTC quirk, since
     * that quirk lives in FutureCustomTimeView, not in this call. Passing a
     * falsy `keys` (as `controller().actions.archive(null)` already does
     * elsewhere in this file) snoozes the current selection, exactly as
     * pressing `b` and choosing a stock preset would. Each preset below
     * hands its date to the menu's own didSelect, as a stock preset does,
     * because the same menu class also asks when to send (Schedule send)
     * and when to be reminded, and each of those says what a date means.
     *
     * "Choose a date and time…" is not a preset: it reuses Fastmail's own
     * Custom… option's target and method (showCustomPicker), taken off
     * whichever stock option still carries them before they are replaced,
     * so it opens the very same real picker Fastmail's own entry did.
     */

    // "08:00". Anything unreadable is eight in the morning.
    const parseSnoozeTime = (text) => {
        const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text || ''));
        if (!match) return { hours: 8, minutes: 0 };
        return {
            hours: Math.min(23, parseInt(match[1], 10)),
            minutes: Math.min(59, parseInt(match[2], 10))
        };
    };

    // "Name = Date @ Time", one per line. The settings page always writes
    // both halves, but reading stays forgiving, like parseGroupings: a line
    // with no "=" is skipped rather than guessed at, and a name with
    // nothing else on the line resolves to today at 8am, the same defaults
    // snoozeDateKeyword and parseSnoozeTime fall back to for anything else
    // unread.
    const parseSnoozePresets = (text) => String(text || '').split('\n')
        .map(raw => raw.trim())
        .filter(Boolean)
        .map((line) => {
            const divider = line.indexOf('=');
            if (divider === -1) return null;
            const name = line.slice(0, divider).trim();
            if (!name) return null;
            const rest = line.slice(divider + 1).trim();
            const at = rest.indexOf('@');
            const date = (at === -1 ? rest : rest.slice(0, at)).trim();
            const time = (at === -1 ? '' : rest.slice(at + 1)).trim();
            return { name: name, date: date, time: time };
        })
        .filter(Boolean);

    // The inverse of parseSnoozePresets, and round-trips with it: a preset
    // with neither half written is still "Name =", not dropped.
    const formatSnoozePresets = (presets) => (presets || []).map((one) => {
        const date = one.date || '';
        const time = one.time ? '@ ' + one.time : '';
        const right = date && time ? date + ' ' + time : date + time;
        return (one.name + ' = ' + right).trim();
    }).join('\n');

    // The next occurrence of a given weekday (0 = Sunday .. 6 = Saturday)
    // that is not today - rolling a full week ahead rather than ever
    // landing on the day it is asked from.
    const snoozeWeekdayOffset = (fromDay, targetDay) => {
        const add = (targetDay - fromDay + 7) % 7;
        return add === 0 ? 7 : add;
    };

    // "2w", "14d", "1m", or the same written out, "in 2 weeks", "in 14
    // days", "in 1 month" - the count-and-unit shape this mode's old single
    // snoozeDefault setting used, kept as one more way to write a Date, a
    // plain offset from now rather than anchored to a weekday the way
    // "next week" is. A leading "+" reads the same as "in".
    const SNOOZE_PERIOD = /^(?:\+\s*|in\s+)?(\d+)\s*(d(?:ays?)?|w(?:eeks?)?|m(?:onths?)?)$/i;

    // "+4h", "4h" or "in 4 hours": that many hours on from the start of the
    // current hour, the way Fastmail's own Later today counts its three, so
    // it always lands on a full hour; at 19:37, +4h is 23:00. It brings its
    // own time, so a preset written this way needs no Time.
    const SNOOZE_HOURS = /^(?:\+\s*|in\s+)?(\d+)\s*h(?:ours?)?$/i;

    const snoozeHoursTarget = (now, text) => {
        const match = SNOOZE_HOURS.exec(String(text || '').trim());
        if (!match) return null;
        const target = new Date(now.getTime());
        target.setMinutes(0, 0, 0);
        target.setHours(target.getHours() + parseInt(match[1], 10));
        return target;
    };

    /*
     * A preset's Date resolved against `now`: "today" changes nothing,
     * "tomorrow" is the next day, "this weekend" / "next week" are the next
     * Saturday or Monday that is not today, a count and a unit (short, as
     * "2w", or written out, as "in 2 weeks") is that many days, weeks or
     * months from now, and anything shaped like YYYY-MM-DD is a literal
     * calendar date, parsed by its parts rather than handed to `new
     * Date(string)`, whose format support varies by engine. Anything else
     * unread is today, the same as an empty Date would be, since every
     * preset is required to have one.
     *
     * The weekend and week rules are not this mode's own convention: they
     * are Fastmail's own, read off FutureTimeMenuView.drawOptions in its
     * bundle. Its weekend option adds `7-(day+1)%7` days and its week
     * option adds `7-(day+6)%7`, worked out there from a fresh `new Date`
     * each time the menu draws; checked by hand against every day of the
     * week, both reduce to exactly snoozeWeekdayOffset above with target
     * weekdays 6 (Saturday) and 1 (Monday) - the next Saturday or Monday,
     * never today even on a Saturday or a Monday itself. (Fastmail also
     * swaps the weekend option's own label between "This weekend" and
     * "Next weekend" depending on whether today already is one; this mode
     * keeps one name, chosen once, for the same preset either way.)
     */
    const snoozeDateKeyword = (now, keyword) => {
        const target = new Date(now.getTime());
        const word = String(keyword || '').trim().toLowerCase();
        switch (word) {
            case 'tomorrow':
                target.setDate(target.getDate() + 1);
                return target;
            case 'this weekend':
            case 'next weekend':
                target.setDate(target.getDate() + snoozeWeekdayOffset(now.getDay(), 6));
                return target;
            case 'next week':
                target.setDate(target.getDate() + snoozeWeekdayOffset(now.getDay(), 1));
                return target;
            default:
            // Falls through to the period and literal-date checks below
        }
        const period = SNOOZE_PERIOD.exec(word);
        if (period) {
            const count = parseInt(period[1], 10);
            const unit = period[2].charAt(0).toLowerCase();
            if (unit === 'd') target.setDate(target.getDate() + count);
            else if (unit === 'w') target.setDate(target.getDate() + count * 7);
            else target.setMonth(target.getMonth() + count);
            return target;
        }
        const literal = /^(\d{4})-(\d{2})-(\d{2})$/.exec(word);
        if (literal) {
            target.setFullYear(parseInt(literal[1], 10), parseInt(literal[2], 10) - 1, parseInt(literal[3], 10));
        }
        // '', 'today', or anything else unread: today, same as literal did
        // not match
        return target;
    };

    // The wall-clock moment a preset proposes: its Date keyword, at its own
    // Time, or a number of hours, which brings its own time. A Time is
    // required of every other preset; parseSnoozeTime's own "unreadable is
    // 8am" is a parser's safety net for a malformed line, not a setting to
    // fall back on.
    const snoozePresetTarget = (now, preset) => {
        const hours = snoozeHoursTarget(now, preset.date);
        if (hours) return hours;
        const target = snoozeDateKeyword(now, preset.date);
        const time = parseSnoozeTime(preset.time);
        target.setHours(time.hours, time.minutes, 0, 0);
        return target;
    };

    // Fastmail's own Custom… option, the one whose method is
    // "showCustomPicker" (see the header above) - every stock preset shares
    // its target, the FutureTimeMenuView itself, which is also how "Choose
    // a date and time…" below still opens Fastmail's own real picker.
    const snoozeMenuCustomOption = (options) => (options || []).filter((option) => {
        try {
            return !!option && typeof option.get === 'function' &&
                option.get('method') === 'showCustomPicker';
        } catch (error) {
            return false;
        }
    })[0] || null;

    // The small, subdued text Fastmail's own preset rows carry beside the
    // name: the time, with the weekday added once the target is not today
    // and the calendar date too once it is a week or more out. Read off
    // Fastmail's own bundle (FutureTimeMenuView.drawOption in
    // NewEvent.mod.js) rather than invented here — its own two booleans,
    // `i >= s` and `i >= s + 6048e5` (today at midnight, and a week past
    // that), decide the same thing this mirrors with plain Date math. The
    // time is on the 24-hour clock, as a preset's own Time is written,
    // whatever clock the browser's locale would use.
    const snoozePresetRightText = (now, target) => {
        const todayEnd = new Date(now.getTime());
        todayEnd.setHours(24, 0, 0, 0);
        const showWeekday = target.getTime() >= todayEnd.getTime();
        const showDate = target.getTime() >= todayEnd.getTime() + 6048e5;
        const weekday = showWeekday ? target.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' : '';
        const date = showDate ? target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' : '';
        const time = String(target.getHours()).padStart(2, '0') + ':' +
            String(target.getMinutes()).padStart(2, '0');
        return weekday + date + time;
    };

    // A preset row's label: the name on the left, its resolved time (and
    // weekday/date where they matter) subdued on the right — the same
    // two-part div Fastmail's own drawOption builds, so a replaced preset
    // reads exactly like a stock one did. A plain string label (no `right`)
    // is for "Choose a date and time…", which has nothing to resolve yet.
    const snoozePresetLabel = (name, right) => {
        if (!right) return name;
        const el = FastMail.el;
        return el('div.u-flex.u-space-x-2.u-whitespace-nowrap', [
            el('p.u-flex-grow', [name]),
            el('p.u-flex-none.u-color-unimportant', [right])
        ]);
    };

    // A disabled option is greyed out, and neither a click nor its number
    // chooses it: the same isDisabled Fastmail's own drawOption sets on This
    // evening once it is past six.
    const snoozePresetOption = (shortcut, label, run, disabled) => {
        const option = new FastMail.classes.ButtonView({
            isDisabled: !!disabled,
            shortcut: shortcut,
            label: label,
            target: { run: run },
            method: 'run'
        });
        option.customSnoozePreset = true;
        return option;
    };

    const CHOOSE_SNOOZE_DATE_LABEL = 'Choose a date and time…';
    const NO_REMINDER_LABEL = 'No reminder';
    const noReminderLabel = () =>
        String(settingValue('reminderNoneLabel') || '').trim() || NO_REMINDER_LABEL;

    // Replaces Fastmail's own preset list with this mode's, through the
    // same patched MenuView.prototype.draw as addGroupings (see patchMenus
    // below): options is the plain array FutureTimeMenuView built, and
    // snoozeMenuCustomOption is how this menu is told apart from any other,
    // translation-proof and independent of Fastmail's own wording, the same
    // way boundToGroupBy tells the Group menu apart from any other.
    const addSnoozePresets = (options) => {
        if (options.some(option => option && option.customSnoozePreset)) return;

        const custom = snoozeMenuCustomOption(options);
        if (!custom) return;
        const futureTimeMenuView = custom.get('target');
        if (!futureTimeMenuView || typeof futureTimeMenuView.didSelect !== 'function') return;

        const now = new Date();
        const list = futureTimeMenuView.customPresetsKey === 'reminderPresets'
            ? settings.reminderPresets : settings.snoozePresets;
        const presets = parseSnoozePresets(list).map(preset => ({
            name: preset.name, target: snoozePresetTarget(now, preset)
        }));

        // A time already gone cannot be snoozed until, so it is offered
        // greyed out rather than hidden, keeping every number where it was.
        const entries = presets.map((preset, index) => snoozePresetOption(String(index + 1),
            snoozePresetLabel(preset.name, snoozePresetRightText(now, preset.target)),
            // The name rides along for a menu that shows it; Fastmail's own
            // menus take the date alone
            () => futureTimeMenuView.didSelect(preset.target, preset.name),
            preset.target.getTime() <= now.getTime()));

        if (typeof futureTimeMenuView.showCustomPicker === 'function') {
            entries.push(snoozePresetOption(String(entries.length + 1), CHOOSE_SNOOZE_DATE_LABEL,
                () => futureTimeMenuView.showCustomPicker()));
        }

        // The reminder menu can also be told there is to be none
        if (typeof futureTimeMenuView.customNoReminder === 'function') {
            entries.push(snoozePresetOption(String(entries.length + 1), noReminderLabel(),
                () => futureTimeMenuView.customNoReminder()));
        }

        if (!entries.length) return;
        options.splice(0, options.length, ...entries);
    };

    /*
     * ----------------------------------------------------------------
     * The rules under every menu
     * ----------------------------------------------------------------
     */

    // Every label change in the client passes through these actions, whichever
    // menu, key, drag or swipe asked for it; so the model is enforced here
    // rather than inside any one picker. Seeing them all is not acting on them
    // all: which changes are filings, and so which the rules have anything to
    // say about, is the question each rule asks for itself.
    const LABEL_ACTIONS = ['add', 'copy', 'addremove', 'move'];

    // True while a rule is issuing its own addremove, so the wrapper does
    // not read that call as one more request to apply the rules to
    let applyingLabelRules = false;

    /*
     * Rule 2, a destination replaces. What comes off the selected threads when
     * `adds` lands on them: Triage and every other destination, project or
     * hold label alike, so a message is in one place at a time.
     *
     * Only when the add is a filing, though, and filing is the mode's own
     * routes: the Keep verb's picker, a drop on a label in the sidebar, the
     * narrowed Move menu, the label an archive goes into. Each of those says
     * so by arming the flag before the add lands.
     *
     * Fastmail's own Labels menu does not, and must not. It is the full
     * tristate picker, and ticking a second project in it is a request for a
     * second label, not a request to move the message somewhere else; the
     * rule read it as one, so labelling from that menu quietly took every
     * other label off. Labels is Fastmail's verb and behaves like Fastmail's;
     * putting a message in one place is what Keep is for.
     */
    const replacedBy = (storeKeys, adds, filing) => {
        if (!filing) return [];

        const landed = adds.some(isDestination);
        if (!landed) return [];

        const removes = [];
        mailboxesAmong(storeKeys).forEach((mailbox) => {
            if (adds.indexOf(mailbox) !== -1) return;
            if (isTriage(mailbox) || isDestination(mailbox)) removes.push(mailbox);
        });
        return removes;
    };

    const patchLabelActions = () => {
        const actions = controller().actions;
        if (actions.customLabelRules) return;
        actions.customLabelRules = true;

        LABEL_ACTIONS.forEach((verb) => {
            const original = actions[verb];
            if (typeof original !== 'function') return;

            actions[verb] = function (storeKeys) {
                if (applyingLabelRules) {
                    return original.apply(this, arguments);
                }

                const keys = resolveKeys(this, storeKeys);
                if (!keys) return original.apply(this, arguments);

                const asked = verb === 'addremove'
                    ? toArray(arguments[1])
                    : [arguments[1]].filter(Boolean);

                // Rule 4, a nest goes on whole. Filing under Boards/ZonMw
                // puts Boards on as well, so the shelf holds what is on it;
                // Fastmail infers neither label from the other. A filing
                // only: Fastmail's Labels menu adds what was ticked and
                // nothing else, the same as it adds nothing else here.
                const adds = pendingFiling ? withFilingParents(asked) : asked;
                const above = adds.filter(mailbox => asked.indexOf(mailbox) === -1);

                // Rule 3, a named label files the sender, from any route. The
                // labels above the pick count: they land on the message like
                // any other, so a contact group named after one still fills.
                adds.forEach(mailbox => fileSendersIntoGroup(mailbox, keys));
                // A keep adds the sender to contacts as well, after the groups
                if (pendingKeep) {
                    addSendersToContacts(keys);
                    noteFollowUp('kept', keys);
                }

                // Set only by the call this one is nested inside, so an add
                // that arrives on its own is just an add
                const removes = replacedBy(keys, adds, pendingFiling);
                if (!removes.length && !above.length) return original.apply(this, arguments);

                applyingLabelRules = true;
                try {
                    if (verb === 'addremove') {
                        // One call, one checkpoint: the rule's removals and
                        // the labels above the pick ride the same addremove
                        // as the pick itself. Nothing being added is removed
                        // in the same breath, so a label unticked in the menu
                        // that the nest puts back stays on.
                        const own = toArray(arguments[2])
                            .filter(m => adds.indexOf(m) === -1);
                        const merged = own.concat(removes.filter(m => own.indexOf(m) === -1));
                        // The caller's own selection argument goes through
                        // untouched: null means the focused conversation to
                        // Fastmail, and resolving it here would move the focus
                        // afterwards.
                        const advance = takeFilingAdvance();
                        const result = original.call(this, storeKeys, adds, merged);
                        // A Keep verb waiting on this pick moves the view on
                        // to the next message.
                        if (advance) advanceAfterDecision(advance.from, advance.step);
                        return result;
                    }

                    // The removals go first and silenced, so the last write
                    // here is the one whose didAction cuts the checkpoint, and
                    // everything queued before it joins that checkpoint.
                    const self = this;
                    const args = arguments;
                    if (removes.length) {
                        silencingDidAction(this, () => {
                            removingOnPurpose(() => self.addremove(keys, [], removes));
                        });
                    }
                    const advance = takeFilingAdvance();
                    let result;

                    if (above.length) {
                        // The labels above the pick go on last, because move
                        // takes the message out of the mailbox it is being
                        // read in and that can be one of them: keeping into
                        // Boards/ZonMw from a list of Boards would have taken
                        // Boards straight back off. Going last also makes
                        // this the write that cuts the checkpoint, so the
                        // whole filing is still one undo.
                        silencingDidAction(self, () => {
                            result = original.apply(self, args);
                        });
                        self.addremove(keys, above, []);
                    } else {
                        result = original.apply(self, args);
                    }

                    if (advance) advanceAfterDecision(advance.from, advance.step);
                    return result;
                } finally {
                    applyingLabelRules = false;
                }
            };
        });
    };

    /*
     * ----------------------------------------------------------------
     * The verbs
     * ----------------------------------------------------------------
     */

    // Archive in labels mode is `move(messages, null, Inbox, true)` against
    // the account's Inbox by role; it never touches the label being viewed,
    // plus a mark-read and a not-spam report, expanded to the whole thread.

    // A verb works on whole conversations, so a label counts wherever it sits
    // in one. Falls back to the message itself for a message without a thread.
    const threadOf = (message) => {
        const thread = message && message.get('thread');
        const messages = thread && toArray(thread.get('messages'));
        return messages && messages.length ? messages : [message];
    };

    const messagesFrom = (storeKeys) => (storeKeys || [])
        .map(key => FastMail.store.getRecordFromStoreKey(key))
        .filter(message => message instanceof FastMail.classes.Message);

    // Every mailbox any message of the selected threads carries
    const mailboxesAmong = (storeKeys) => {
        const carried = new Set();

        messagesFrom(storeKeys).forEach(message =>
            threadOf(message).forEach(other =>
                toArray(other.get('mailboxes')).forEach(m => carried.add(m))));

        return carried;
    };

    const anyFlagged = (storeKeys) => messagesFrom(storeKeys)
        .some(message => threadOf(message).some(other => other.get('isFlagged')));

    const allFlagged = (storeKeys) => messagesFrom(storeKeys)
        .every(message => threadOf(message).some(other => other.get('isFlagged')));

    // The same question for one conversation rather than a selection
    const carriesMailbox = (message, mailbox) => !!mailbox && !!message &&
        threadOf(message).some(other =>
            toArray(other.get('mailboxes')).indexOf(mailbox) !== -1);

    const triageAmong = (storeKeys) =>
        Array.from(mailboxesAmong(storeKeys)).filter(isTriage);

    // The excluded labels the selection carries; Later and its kind; which
    // come off with Triage when a conversation is kept
    const excludedAmong = (storeKeys) =>
        Array.from(mailboxesAmong(storeKeys)).filter(isExcludedLabel);

    // The keep rule's question: does every selected conversation carry a
    // destination, a project or a hold label?
    const unfiledAmong = (storeKeys) => messagesFrom(storeKeys)
        .filter(message => !threadOf(message).some(other =>
            toArray(other.get('mailboxes')).some(isDestination)));

    // Those with no project at all; held under Later, or filed nowhere; for
    // the keep rule's tie-break: a hold label comes off with Triage only where
    // every conversation also carries a project, which then wins.
    const withoutProject = (storeKeys) => messagesFrom(storeKeys)
        .filter(message => !threadOf(message).some(other =>
            toArray(other.get('mailboxes')).some(isProject)));

    /*
     * Keeping the open list honest after a change.
     *
     * Fastmail keeps a list up to date after a local change by working out
     * which mailbox the list is filed under; the first inMailbox reachable
     * through AND nodes, and reading only the changes filed under that one.
     * A verb here moves mail between labels, so a change filed under another
     * mailbox goes unread and the row stays. The same pass falls back to
     * setObsolete for a query whose filter has no such mailbox, which is why
     * this matters only for filed-under lists.
     */

    // Where a filter is filed: first inMailbox by AND-descent, as Fastmail
    // computes it
    const filedUnderId = (where) => {
        if (!where) return null;

        if (where.operator === 'AND') {
            for (const condition of where.conditions || []) {
                const found = filedUnderId(condition);
                if (found) return found;
            }
            return null;
        }

        return where.inMailbox || null;
    };

    // Every mailbox the filter mentions anywhere, AND, OR and NOT alike
    const filterMailboxIds = (where) => {
        if (!where) return [];

        if (where.operator) {
            return (where.conditions || []).reduce(
                (ids, condition) => ids.concat(filterMailboxIds(condition)), []);
        }

        return where.inMailbox ? [where.inMailbox] : [];
    };

    // Marked obsolete rather than struck out by hand: it is what Fastmail
    // marks when it cannot work a change out locally, and an observed obsolete
    // query refetches; with its total, once primed.
    const staleAfter = (query, mailbox) => {
        if (!query || typeof query.get !== 'function') return;

        const where = query.get('where');
        const id = mailbox.get('id');

        if (!query.customPrimed && filedUnderId(where) === id) return;
        if (filterMailboxIds(where).indexOf(id) === -1) return;

        query.setObsolete();
    };

    const refreshListAfter = (mailbox) => {
        if (!mailbox || typeof mailbox.get !== 'function') return;

        const list = controller().get('mailboxMessageList');
        if (list && typeof list.setObsolete === 'function') {
            staleAfter(list, mailbox);
        }
    };

    // Run `work` with didAction replaced. The replacement is handed the real
    // one first, then whatever arguments Fastmail passed, so it can drop the
    // call or pass it on changed.
    const withDidAction = (actions, replacement, work) => {
        const original = actions.didAction;
        let restored = false;
        const restore = () => {
            if (restored) return;
            restored = true;
            actions.didAction = original;
        };

        actions.didAction = function () {
            restore();
            return replacement.apply(this,
                [original].concat(Array.prototype.slice.call(arguments)));
        };

        try {
            work();
        } finally {
            restore();
        }
    };

    // Hold the view where it is, so the step this mode makes is the only one.
    // Not an arrow: withDidAction applies the actions object as `this`.
    const stayHereAfter = function (didAction, text, stayHere, goTo) {
        return didAction.call(this, text, true, goTo);
    };

    // Swallow every didAction inside `work`, however many calls make one.
    const silencingDidAction = (actions, work) => {
        const original = actions.didAction;
        actions.didAction = function () { return this; };

        try {
            work();
        } finally {
            actions.didAction = original;
        }
    };

    /*
     * Filing and archiving both move the view on to the next conversation
     * still waiting for triage. Filing keeps the message in the Inbox; Filed
     * is Inbox plus one project; so nothing leaves the list on its own;
     * archiving takes the Inbox off, so Fastmail would step to the next row
     * (often a filed one) unless held. Either way the walk is explicit: down
     * the list to the next one carrying Triage, stepping over any already
     * filed, and back to the list when none is left rather than opening a
     * filed one; and with nothing selected there, since an emptied queue
     * should look empty. Only in the Inbox, the triage surface.
     */
    // The same conversation however the two records were reached: the list
    // holds a thread's top message, the verb may hold another of its messages.
    const sameConversation = (a, b) => {
        if (!a || !b) return false;
        if (a === b) return true;
        const ta = a.get && a.get('thread');
        const tb = b.get && b.get('thread');
        return !!ta && ta === tb;
    };

    // The two lists a decision is made in: the Inbox and the triage label's
    // own view.
    const onTriageSurface = () => {
        const mailbox = controller().get('mailbox');
        return !!mailbox && !controller().get('search') &&
            (mailbox.get('role') === 'inbox' || isTriage(mailbox));
    };

    // Where a conversation sits in the list, read before the decision lands.
    const rowIndexOf = (message) => {
        const list = controller().get('mailboxMessageList');
        if (!message || !list || typeof list.getObjectAt !== 'function') return -1;
        const length = list.get('length') || 0;

        for (let i = 0; i < length; i += 1) {
            const row = list.getObjectAt(i);
            if (!row) break;
            if (sameConversation(row, message)) return i;
        }
        return -1;
    };

    /*
     * The conversations on either side of this one, taken before the decision
     * lands rather than looked up after it.
     *
     * Afterwards there may be nothing to look up. Archiving takes the row out
     * of the list, the query goes back to the server for the rest, and a list
     * mid-refetch answers for no row at all; so a step to the next message
     * read a blank and became a step back to the mailbox instead. The records
     * themselves do not go anywhere, so holding on to them is enough.
     *
     * Neighbours rather than a slot, too: whether the row stays put (filing)
     * or leaves (archiving), the message after this one is the message that
     * was after it, and the message before is the one that was before.
     *
     * An index of -1; the row was never found; has no neighbours rather
     * than the first and last rows of the list.
     */
    // The conversation on screen, or nothing when the list is all there is.
    const openMessage = () => {
        try {
            return controller().get('message') || null;
        } catch (error) {
            return null;
        }
    };

    /*
     * Put the open conversation down, which the URL cannot say on its own.
     *
     * Fastmail writes the conversation into the address only in its own
     * full-screen view. With a reading pane the address is the mailbox's and
     * nothing more, and the pane draws whatever the controller still calls
     * the open message; so walking to the list URL moves the address and
     * leaves the message standing. Without a pane that message is behind the
     * list and out of sight, which is why Fastmail can leave it there. With
     * one it is the conversation just archived, still filling half the
     * window.
     *
     * Putting it down is also what empties the pane. Fastmail's focus and
     * the open message are bound to each other, so closing the message
     * empties the focus with it, and a reading pane follows its focus. Which
     * is the whole of "back to the list" in that layout: the list never
     * left, so ending a run there means the pane stops showing what you have
     * finished with and shows nothing at all.
     */
    const closeOpenMessage = () => {
        try {
            controller().set('message', null);
        } catch (error) {
            reportFault('could not put down the message the pane had open', error);
        }
    };

    /*
     * Whether a decision on this message is a decision on what you are
     * reading. Moving on to the next conversation only means anything if you
     * were in one: a swipe on a row, or a key on the focused row, is made
     * from the list, and the list is where it should leave you. Fastmail
     * draws the same line; its own step is gated on isActioningFocused,
     * which asks whether the conversation is visible and whether the message
     * acted on is the one selected, and a mode that stepped anyway turned a
     * swipe in the list into a conversation opening in your face.
     *
     * Read before the decision lands, like the neighbours either side.
     */
    const decidingOnOpenMessage = (message) => {
        const open = openMessage();
        return !!open && !!message && open === message;
    };

    const stepFrom = (message) => {
        const index = rowIndexOf(message);
        const list = controller().get('mailboxMessageList');
        const at = (position) => {
            if (!list || typeof list.getObjectAt !== 'function') return null;
            if (position < 0) return null;
            return list.getObjectAt(position) || null;
        };

        return {
            index: index,
            reading: decidingOnOpenMessage(message),
            // Only a message carrying the triage label is part of a run, so
            // only a decision about one can end a run; a decision about
            // anything else steps where Fastmail's own setting says.
            inRun: carriesMailbox(message, message && triageMailbox(message.get('accountId'))),
            listShowing: readingPaneShowing(),
            next: index < 0 ? null : at(index + 1),
            previous: index < 1 ? null : at(index - 1)
        };
    };

    /*
     * Where to go after a decision: Fastmail's own answer.
     *
     * It is a preference; Settings, Mail, after moving, deleting or
     * archiving; with three values: back to the mailbox, on to the next
     * conversation, back to the previous one. Archiving, deleting and moving
     * take a message out of the list, so Fastmail applies it on its own.
     * Filing does not: the message keeps its place in the Inbox, so the step
     * has to be made here, and this is the step to make.
     */
    const AFTER_ACTION_DEFAULT = 'next';

    const afterActionGoTo = () => {
        try {
            return FastMail.preferences.get('afterActionGoTo') || AFTER_ACTION_DEFAULT;
        } catch (error) {
            return AFTER_ACTION_DEFAULT;
        }
    };

    /*
     * Whether the mailbox list stands beside the open message. Fastmail's own
     * answer: false on the phone, false with its reading pane switched off,
     * and false in a window too narrow to hold both. Where it is true, coming
     * back to the list is no move at all; the list never went anywhere, and
     * all that happens is the open message closing, leaving an empty pane.
     */
    const readingPaneShowing = () => {
        try {
            return !!controller().get('showReadingPane');
        } catch (error) {
            return false;
        }
    };

    // A message opened in a window of its own: no list beside it, and none
    // behind it to come back to.
    const inOwnWindow = () => !!(window.opener || window.__fmshellComposeWindow);

    // The current mailbox's list URL, built from a message in it; Fastmail
    // has no getUrlForMailbox; by dropping the message id off the end.
    const listURLFrom = (message) => {
        const url = urlForMessage(message);
        if (!url) return null;
        try {
            const u = new URL(url, location.href);
            u.pathname = u.pathname.replace(/[^/]+\/?$/, '');
            return String(u);
        } catch (error) {
            return null;
        }
    };

    /*
     * The step filing has to make for itself, made the way Fastmail would.
     *
     * Archiving, deleting and moving take the message out of the list, so
     * Fastmail applies its own after-an-action setting and nothing is needed
     * here. Filing does not; the message keeps its place in the Inbox under
     * one project label; so no step happens unless this one makes it, and
     * the step to make is the one that setting names.
     *
     * Fastmail's own setting says where to go; back to the mailbox, on to
     * the next, back to the previous; so it decides, except at the end of a
     * run. A run is only what the triage label holds: a decision about a
     * message carrying it, stepping to a neighbour that carries it too.
     * Landing on a neighbour outside the run means reading something nobody
     * asked about, so the list catches that instead; while a decision made
     * outside the run in the first place is left to the setting.
     *
     * Only where a message fills the window, though. Beside a reading pane
     * the list is on screen the whole time, so there is nothing to come back
     * to and the setting keeps the last word there too.
     *
     * Run a tick after the decision, so the store has taken Triage off the
     * one just decided and the list has settled.
     *
     * `step` holds the neighbours as they were before the decision, and the
     * caller takes it before making one; which is the whole point of it.
     * Reading them here instead finds a list still refetching, and a list
     * refetching answers for no row at all.
     */
    const advanceAfterDecision = (from, step) => {
        if (!onTriageSurface()) return;
        // In a window of its own the decision is the whole of what happens:
        // there is no list there to step along or come back to.
        if (inOwnWindow()) return;
        const plan = step && typeof step === 'object' ? step : stepFrom(from);
        // A decision made from the list stays on the list: nothing was open
        // to move on from, so there is nowhere to move on to
        if (!plan.reading) return;

        setTimeout(() => {
            if (!onTriageSurface()) return;

            const backToList = () => {
                const list = controller().get('mailboxMessageList');
                const anchor = from ||
                    (list && typeof list.getObjectAt === 'function' && list.getObjectAt(0));
                const listUrl = listURLFrom(anchor);
                if (listUrl) goToUrl(listUrl);
                // The URL is only half the step: it says which list, and with
                // a reading pane the list was never the thing that moved. So
                // the conversation is put down too, and before the focus is
                // placed, since that is what leaves the first row somewhere to
                // move to.
                closeOpenMessage();
                // And stays down: the focus is let go a tick later, after the
                // route has landed, since landing on a list is a moment the
                // focus can be handed back to the first row.
                setTimeout(focusNothing, 0);
            };

            const where = afterActionGoTo();
            const target = where === 'prev' ? plan.previous
                : where === 'next' ? plan.next
                    : null;

            // The run ends where the triage label does. A decision about a
            // message that was not carrying it is no part of a run, so the
            // setting has the last word there, as it does with no triage
            // label set at all, and as it does beside a reading pane: the
            // list is on screen there whatever happens, so ending the run on
            // it would only blank the pane.
            const triage = settings.backToListAfterTriage && plan.inRun &&
                !plan.listShowing && target && triageMailbox(target.get('accountId'));
            const stillTriage = !triage || carriesMailbox(target, triage);

            // Nothing that way is the end of the list, and the mailbox is what
            // Fastmail answers that with; rather than staying on the message
            // the decision has just finished with.
            const url = target && stillTriage && urlForMessage(target);
            if (url) goToUrl(url);
            else backToList();
        }, 0);
    };

    /*
     * Let the focus go, rather than move it.
     *
     * This is the end of a run: nothing above the list is waiting to be
     * triaged, and the list is what you have come back to. The focus used to
     * be put on the first row, so the keyboard had somewhere to be; but a
     * reading pane follows the focus, so the first row was opened the moment
     * it took it, and finishing a queue ended with a conversation nobody had
     * asked for filling half the window. An emptied queue should look empty.
     *
     * The record rather than the index, because that is the end the
     * controller reasons from: null is no selection, and it works the index
     * back to -1 itself. j or k from there starts at the top again.
     */
    const focusNothing = () => {
        try {
            const focused = controller().get('focused');
            if (focused && typeof focused.set === 'function') {
                focused.set('record', null);
            }
        } catch (error) {
            // No list on screen, nothing to let go of
        }
    };

    /*
     * Where the view goes after the pick; the conversation the Keep verb acted
     * on and what sat either side of it. Read when the picker opens, for the
     * same reason every other caller reads neighbours early: the pick may take
     * the row out of the list, and by then there is nothing to find.
     *
     * Set by the verb and taken by the next picker to open, which is the one
     * the verb asked for; from there it rides on that menu, and the pick hands
     * it to the write it makes. It does not sit here waiting to be claimed by
     * whatever label change happens along next.
     *
     * It used to, with twelve seconds to expire in, and a picker opened and
     * dismissed left it behind: the next filing you made in those twelve
     * seconds moved the view to the neighbour of a message you had stopped
     * looking at.
     */
    let pendingAdvance = null;

    const armAdvance = (from) => {
        pendingAdvance = { from: from || null, step: stepFrom(from) };
    };

    const takeAdvance = () => {
        const was = pendingAdvance;
        pendingAdvance = null;
        return was;
    };

    /*
     * Whether the label change about to land is a filing; the Keep verb's
     * picker, a drop on a label, the narrowed Move menu, an archive into a
     * hold label; which is what puts it under rule 2. Unmarked, an add is
     * only an add, and Fastmail's own Labels menu never marks one.
     *
     * A bracket around the call, not a flag set and left standing. Every
     * route writes synchronously inside the gesture that asks for it, the
     * tristate menu included: it holds its ticks in a map and applies them in
     * one addremove as it leaves the document, so even that write happens
     * inside the call that closes the menu.
     *
     * It was set when the picker opened instead, which is a different span
     * entirely; it had to outlive the reading and the typing, so it was given
     * twelve seconds to expire in. That made a picker opened and dismissed
     * leave the mark lying there, and the next label change to come along in
     * those twelve seconds; from any menu, including the one that must never
     * file; was filed on its behalf.
     */
    let pendingFiling = false;
    // Where the view goes when this filing lands, for the rule to pick up as
    // it cuts the checkpoint; null for a filing nobody is waiting on, which is
    // a drop, and for one whose verb steps the view itself, which is an
    // archive into a hold label.
    let filingAdvance = null;

    const asFiling = (advance, work) => {
        const wasFiling = pendingFiling;
        const wasAdvance = filingAdvance;
        pendingFiling = true;
        filingAdvance = advance || null;
        try {
            return work();
        } finally {
            pendingFiling = wasFiling;
            filingAdvance = wasAdvance;
        }
    };

    // Set around the routes that keep a message: the Keep picker, however it
    // was opened, and a plain drop on a label. Not an archive into a hold
    // label, which files as well but decides to be done with the message, and
    // not an Option-drop, which is Fastmail's move. A bracket, like filing.
    let pendingKeep = false;

    const asKeep = (work) => {
        const wasKeep = pendingKeep;
        pendingKeep = true;
        try {
            return work();
        } finally {
            pendingKeep = wasKeep;
        }
    };

    // One step per filing, however many calls the filing turns into.
    const takeFilingAdvance = () => {
        const was = filingAdvance;
        filingAdvance = null;
        return was;
    };

    /*
     * Archive into a hold label; Shift-E, or a long press on Archive.
     *
     * Set by the keystroke and spent by the next picker to open, which is the
     * one the keystroke asked for. It cannot be scoped to a call the way a
     * filing is: what it has to survive is you reading the list and choosing
     * from it, and there is no call around that. So it is handed to the menu
     * instead. From the moment the picker opens, being an archive-into is a
     * property of that menu: it is what narrows the list to the hold labels
     * and what turns the pick into a decision rather than a filing, and a
     * menu dismissed without a pick takes it away when it goes.
     *
     * It used to stay here and time out after twelve seconds, and in those
     * twelve seconds it belonged to nobody. A picker opened on Shift-E and
     * dismissed left it behind, and the next picker you opened for any reason
     * came up narrowed to the hold labels and archived what you picked in it.
     *
     * Only hold labels are offered because only a hold label survives an
     * archive: a project label is the live state, and a project label on a
     * message that is done is a contradiction the archive would undo a
     * moment later anyway.
     */
    let pendingArchiveInto = false;

    const armArchiveInto = () => {
        pendingArchiveInto = true;
    };

    const takeArchiveInto = () => {
        const was = pendingArchiveInto;
        pendingArchiveInto = false;
        return was;
    };

    /*
     * The project picker.
     *
     * A keep that finds no project on the selection opens a menu and stops.
     * One conversation gets the quick Move-to menu, narrowed and adding
     * rather than moving; a multi-selection gets the stock tristate Labels
     * menu. Whatever is picked is an ordinary add, and the rules under every
     * menu take Triage and any other project off in the same checkpoint.
     * Nothing waits on the pick and nothing is asked twice.
     *
     * The phone has no shortcut buttons to borrow, so the bar's Keep button
     * presses the message toolbar's own Labels button.
     */

    // The Labels button, captured from its registration the way the Move
    // button is, so the tristate picker can be opened programmatically
    let labelsButton = null;

    // A drawn control, found by its icon the way the ⋯ button is.
    const visibleViewForIcon = (selector) => {
        const icons = document.querySelectorAll(selector);
        for (const icon of icons) {
            if (!icon.getClientRects().length) continue;
            const view = FastMail.getViewFromNode(icon);
            if (view) return view;
        }
        return null;
    };

    // The Labels control: the message toolbar draws it as an i-label
    // ButtonView.
    const mobileLabelsButtonView = () =>
        visibleViewForIcon('svg.v-Icon.i-label');

    const pressButtonView = (view) => {
        try {
            // activate() is the button's own press, and the only route that
            // reliably opens a menu-owning button; calling its bare target
            // method skips the presentation and strands the verb.
            if (typeof view.activate === 'function') {
                view.activate();
                try {
                    view.set('isActive', false);
                } catch (error) {
                    // A button without the property has nothing to let go
                }
                return true;
            }
            const target = typeof view.get === 'function' && view.get('target');
            const method = typeof view.get === 'function' && view.get('method');
            if (target && method && typeof target[method] === 'function') {
                target[method]();
                return true;
            }
        } catch (error) {
            reportFault('could not press the button', error);
        }
        return false;
    };

    // A captured registration is only as good as the view behind it.
    const capturedIsLive = (entry) => {
        if (!entry || !entry.target || typeof entry.target.get !== 'function') {
            return false;
        }
        if (typeof entry.target[entry.method] !== 'function') return false;

        try {
            const layer = entry.target.get('layer');
            return !!layer && layer.isConnected;
        } catch (error) {
            return false;
        }
    };

    const pressCaptured = (entry) => {
        try {
            entry.target[entry.method]();
            return true;
        } catch (error) {
            reportFault('could not open the project picker', error);
            return false;
        }
    };

    /*
     * The Labels button, asked for by name.
     *
     * Its place is the bar's business; on the bar when the width allows,
     * under More when it does not, and a button waiting in a closed menu is
     * drawn nowhere, so looking for it on screen used to miss it and hand the
     * verb the bare archive dialog instead of the picker. The registry knows
     * it either way, and knows it in every language.
     *
     * Every bar is asked, because a tablet draws two and the one that answers
     * first may be the one you cannot see; a drawn button wins where there is
     * a choice. A press that opens nothing is still caught by the deadline.
     */
    // A view that is drawn: its layer is in the document and has a size.
    const isDrawn = (view) => {
        try {
            const layer = view.get('layer');
            if (!layer || !layer.isConnected) return false;
            const box = layer.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
        } catch (error) {
            return false;
        }
    };

    const toolbarLabelsView = () => {
        const found = [];

        for (const bar of toolbarsOnScreen()) {
            try {
                const named = bar.getView('labels');
                if (named) found.push(named);
            } catch (error) {
                // A bar that has never heard of the name
            }
        }

        return found.filter(isDrawn)[0] || found[0] || null;
    };

    // Anything that opens a label menu. The Labels control is the one to want:
    // it opens the tristate, which serves as the picker on either platform.
    const drawnPickerView = () => mobileLabelsButtonView() ||
        toolbarLabelsView() ||
        visibleViewForIcon('svg.v-Icon.i-folder');

    /*
     * The picker, asked for rather than hunted down.
     *
     * Pressing a button is only ever a way of asking Fastmail to construct
     * its label menu and show it. Every failure so far has been in the
     * finding; no shortcut to name the button by, no glyph to match, not on
     * the bar, not even in the More menu, and none of them in the menu. So
     * the last resort drops the button and asks for the menu directly. It is
     * still Fastmail's menu: its class, its search field, its Create label,
     * its icons and colours, and; because our hooks sit on the prototype,
     * the same didEnterDocument, the same narrowing and the same commit that
     * a menu opened by a button gets.
     *
     * Read out of the app bundle rather than guessed. MailboxMenuView takes
     * willAdd, willRemove and accountId, builds its controller lazily, and
     * that controller's select() ends in didSelect on the view; so the
     * caller supplies the handler and no button need exist. Showing it is
     * PopOverView.show({view, alignWithView, …}), which is what the app's own
     * swipe actions do for exactly this menu.
     */

    const anchorRect = (view) => {
        try {
            const layer = view && typeof view.get === 'function' && view.get('layer');
            if (!layer || !layer.isConnected) return null;
            const rect = layer.getBoundingClientRect();
            return rect.width || rect.height ? rect : null;
        } catch (error) {
            return null;
        }
    };

    const viewForNode = (node) => (node ? FastMail.getViewFromNode(node) : null);

    // Something drawn to hang the menu off. show() measures the anchor's layer
    // and inserts the popover into the root view the anchor belongs to, so
    // this has to be a view that is on screen: not the root itself, which is
    // nobody's child and would leave the popover unparented, and not a button
    // parked in a closed menu, which has no rectangle.
    const pickerAnchor = () => {
        const candidates = [
            messageToolbar(),
            mailToolbar(),
            viewForNode(document.querySelector('.v-PageHeader')),
            viewForNode(document.querySelector('.v-MailboxSource'))
        ];

        for (const view of candidates) {
            if (anchorRect(view)) return view;
        }
        return null;
    };

    // One popover, reused. show() hides whatever it was holding first and
    // detaches itself on hide, which is how the app's own singleton behaves; a
    // fresh one per opening would leak a view every time.
    let pickerPopOver = null;

    const popOverForPicker = () => {
        if (pickerPopOver) return pickerPopOver;

        const PopOverView = FastMail.classes && FastMail.classes.PopOverView;
        if (!PopOverView) return null;

        pickerPopOver = new PopOverView();
        return pickerPopOver;
    };

    /*
     * placement, when given, is where to show it instead: a popover's own
     * options, alignWithView and all, as a right-click menu was shown with.
     */
    const buildPicker = (keys, placement) => {
        const MailboxMenuView = FastMail.classes && FastMail.classes.MailboxMenuView;
        if (!MailboxMenuView) return false;

        const popOver = popOverForPicker();
        const anchor = placement ? placement.alignWithView : pickerAnchor();
        const rect = anchor && anchorRect(anchor);
        if (!popOver || !rect) return false;

        const first = messagesFrom(keys)[0];

        try {
            const menu = new MailboxMenuView({
                // Adding one, which is the shape Move to opens; the tristate
                // needs willRemove too, and a verb only ever wants a topic
                willAdd: true,
                accountId: first ? first.get('accountId') : null,
                closeOnActivate: true,
                // Replaced by addInsteadOfMoving as the menu enters the
                // document; declared so the controller has one to call
                didSelect() {}
            });
            // The pick files these, whatever is selected by the time it is
            // made; a right-click menu's conversation is not the selection
            // once that menu has closed
            menu.customKeys = keys;

            // What tells didEnterDocument this menu is ours to narrow and to
            // route through the waiting verb, exactly as pressing Move to does
            wantOurMove = true;

            // Away from the edge it is anchored to: hung off the bottom bar
            // it opens upwards, off a header it opens down.
            const below = rect.top + rect.height / 2 > window.innerHeight / 2;

            popOver.show({
                view: menu,
                alignWithView: anchor,
                positionToThe: placement ? placement.positionToThe : below ? 'top' : 'bottom',
                alignEdge: placement ? placement.alignEdge : 'centre',
                offsetTop: placement ? placement.offsetTop : 0,
                offsetLeft: placement ? placement.offsetLeft : 0,
                showCallout: !placement,
                keepInHorizontalBounds: true,
                keepInVerticalBounds: true,
                onHide(options) {
                    try {
                        options.view.destroy();
                    } catch (error) {
                        // Already gone is already gone
                    }
                }
            });

            return true;
        } catch (error) {
            wantOurMove = false;
            reportFault('could not open the project picker', error);
            return false;
        }
    };

    // Open the filing picker for these conversations; the projects and the
    // hold labels. True when something opened, so a caller with a decision
    // riding on this picker knows whether there is a menu to hand it to.
    // With a placement it opens there, built for exactly these conversations,
    // rather than from whichever button is on screen.
    const openProjectPicker = (keys, placement) => {
        // Where to go after the pick, read now because the pick may take the
        // row out of the list. The menu about to open takes it; what marks the
        // pick a filing is not set here at all, the pick itself sets that.
        armAdvance(messagesFrom(keys)[0]);
        if (placement && buildPicker(keys, placement)) return true;
        const single = keys.length === 1;
        const order = single
            ? [moveButton, labelsButton]
            : [labelsButton, moveButton];
        const captured = order.filter(capturedIsLive)[0];

        if (captured) {
            if (captured === moveButton) wantOurMove = true;
            if (captured === labelsButton) wantOurFile = true;
            if (pressCaptured(captured)) return true;
            wantOurFile = false;
        }

        // The phone's path, and a desktop that has never drawn Move to.
        // Whatever this finds opens the tristate, so the menu about to appear
        // is the Labels one opened by Keep, and it carries the same mark the
        // captured button's route gives it: without that it is indistinguishable
        // from someone pressing Labels, and Keep would stop filing.
        const drawn = drawnPickerView();
        if (drawn) {
            wantOurFile = true;
            if (pressButtonView(drawn)) return true;
            wantOurFile = false;
        }

        // No button anywhere: ask Fastmail for the menu itself
        if (buildPicker(keys)) return true;

        // Nothing opened, so no menu took what was set for it, and it must
        // not be left here for one that opens later with no verb behind it.
        takeAdvance();
        reportFault('no label menu to open');
        return false;
    };

    /*
     * The verbs proper. Each resolves its keys once, silences the didActions
     * of its preparatory moves, and lets exactly one didAction through at the
     * end; the archive's for `e`, the addremove's for `v`, the flag's for
     * `s`; so the whole verb is one checkpoint and one toast.
     */

    const resolveKeys = (actions, storeKeys) => {
        const keys = storeKeys && storeKeys.length
            ? storeKeys
            : actions.getSelectedStoreKeys();
        return keys && keys.length ? keys : null;
    };

    // done; `e`. `finish` runs the stock archive, which takes the Inbox off
    // and marks the thread read; everything else comes off first, silenced, so
    // the archive's own didAction cuts the one checkpoint: Triage, every
    // project label and the pin.
    const runDone = (actions, keys, finish) => {
        const from = messagesFrom(keys)[0];
        // Before anything moves. In the triage label's own view the very first
        // thing this does; take Triage off; is what takes the row out of the
        // list, so neighbours read after it are already gone and the step
        // becomes a step back to the mailbox.
        const step = stepFrom(from);

        silencingDidAction(actions, () => {
            const dropped = [];
            mailboxesAmong(keys).forEach((mailbox) => {
                if (isTriage(mailbox) || isProject(mailbox)) dropped.push(mailbox);
            });
            // The mode's own removal, not a request to read back: the labels
            // coming off here are what archive means, and a project among them
            // would otherwise be understood as asking to archive again.
            if (dropped.length) {
                removingOnPurpose(() => actions.addremove(keys, [], dropped));
            }

            if (anyFlagged(keys)) actions.unflag(keys);
        });

        /*
         * Fastmail applies its own after-an-action setting when it archives,
         * but only in the Inbox. Its own test is
         *
         *     stayHere = !inbox || !actioningFocused ||
         *                !listIsIn(inbox, mailboxMessageList.where)
         *
         * and the triage label's list is the triage label, whose query names
         * that label and not the Inbox. So archiving from the Inbox stepped
         * on and archiving from the triage label sat there, still showing a
         * message that had just been archived.
         *
         * The two lists hold the same mail, so they should behave the same.
         * The step is made here for both, to the place the setting names, and
         * Fastmail's own is held so it cannot also happen. Anywhere else the
         * stock behaviour stands.
         */
        // Only when the decision was made on the conversation you are reading.
        if (onTriageSurface() && step.reading) {
            withDidAction(actions, stayHereAfter, finish);
            advanceAfterDecision(from, step);
        } else {
            finish();
        }
    };

    // keep; `v`. A thread that already has a destination is kept by taking
    // Triage off it.
    const runKeep = (actions, keys) => {
        const projectWins = !withoutProject(keys).length;
        const removes = triageAmong(keys)
            .concat(projectWins ? excludedAmong(keys) : []);
        const from = messagesFrom(keys)[0];
        // Read first: in the Inbox the row stays put, but in the triage
        // label's own view taking Triage off takes the row out of the list,
        // and the neighbours would be gone by the line after this one.
        const step = stepFrom(from);
        // Nothing to take off is not nothing to do. A message already filed
        // and already past Triage is a decision that has been made, and the
        // answer to being asked again is the same as the first time: move on.
        if (removes.length) {
            noteFollowUp('kept', keys);
            actions.addremove(keys, [], removes);
        }
        addSendersToContacts(keys);
        // Kept in place; the view moves on to where the setting says, or back
        // to the list, with nothing selected, when there is nothing that way.
        advanceAfterDecision(from, step);
    };

    // pin; `s`. A toggle over the selection: all pinned, unpin; else pin.
    const runUrgent = (actions, keys) => {
        if (allFlagged(keys)) actions.unflag(keys);
        else actions.flag(keys);
    };

    /*
     * Archive into a hold label; what the picker opened by Shift-E, or by a
     * long press on Archive, commits to.
     *
     * Two things in one gesture, and one undo: the label goes on with its own
     * didAction silenced, so the archive's checkpoint carries both, the way
     * the archive verb already carries its own removals. The label is put on
     * by the ordinary route, so the rules under every menu still apply; the
     * hold replaces Triage and any project label, and a label that names a
     * contact group still files the sender. It is a filing under a label
     * too, so keepAddsContact adds the sender to contacts, as a keep does.
     *
     * Then the archive verb, unchanged: Inbox off, Triage off, every project
     * label off, the pin off, and hold labels left alone; which is what
     * leaves the one just chosen standing, and the whole point of the verb.
     *
     * No advance is handed to the label going on. Filing moves the view on
     * and so does archiving; both would step, and the message after next is
     * not where anyone asked to be. The pick site drops it before calling in.
     */
    const runDoneInto = (mailbox) => {
        if (!mailbox) return;
        const actions = controller().actions;

        silencingDidAction(actions, () => {
            asFiling(null, () => asKeep(() => {
                if (FastMail.preferences.get('inLabelsMode')) {
                    actions.add(null, mailbox);
                } else {
                    actions.copy(null, mailbox);
                }
            }));
        });
        actions.archive(null);
    };

    const runVerb = (kind, storeKeys, placement) => {
        const actions = controller().actions;
        const keys = resolveKeys(actions, storeKeys);
        if (!keys) return;

        if (kind === 'urgent') {
            runUrgent(actions, keys);
            return;
        }

        if (unfiledAmong(keys).length) {
            openProjectPicker(keys, placement);
        } else {
            runKeep(actions, keys);
        }
    };

    /*
     * Undo, with the view following. Fastmail's undo restores the labels
     * but leaves you looking at wherever the verb sent you. So the archive
     * verbs stamp the message's own URL onto the checkpoint they cut, and
     * an undo that reverts that checkpoint walks the view back to the
     * message it just restored.
     */

    // Set by the verb the moment before its didAction fires; stamped onto the
    // checkpoint by the wrapper in patchArchive.
    let pendingUndoReturn = null;
    let lastUndoReturn = null;

    const urlForMessage = (message) => {
        const mailController = controller();
        if (!message || typeof mailController.getUrlForMessage !== 'function') {
            return null;
        }

        try {
            const url = mailController.getUrlForMessage(message);
            return url ? String(new URL(url, location.href)) : null;
        } catch (error) {
            return null;
        }
    };

    // Navigation the way the router itself does it on back and forward:
    // restore the app state the URL encodes, and the URL, and a history entry;
    // follow from the state change on their own.
    const goToUrl = (url) => {
        try {
            const router = FastMail.router;
            const target = new URL(url, location.href);
            const base = new URL(String(router.get('baseUrl') || '/'), location.href);

            let state = target.pathname;
            if (state.indexOf(base.pathname) === 0) {
                state = state.slice(base.pathname.length);
            }
            if (state[0] === '/') state = state.slice(1);

            router.restoreEncodedState(state, target.searchParams);
        } catch (error) {
            reportFault('could not walk back to the message', error);
        }
    };

    /*
     * ----------------------------------------------------------------
     * Floating message navigation
     * ----------------------------------------------------------------
     *
     * Fastmail's own up/down step lives in the phone's header, out of a
     * thumb's reach while holding the phone one-handed. This pair repeats
     * it fixed above the tab bar instead, walking to the same neighbours
     * stepFrom already works out for filing, by the same goToUrl a
     * decision's own step uses.
     */

    let floatingNavEl = null;
    let floatingNavPrevBtn = null;
    let floatingNavNextBtn = null;

    const chevronIcon = (direction) => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '22');
        svg.setAttribute('height', '22');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('role', 'presentation');

        const points = document.createElementNS(SVG_NS, 'polyline');
        points.setAttribute('points', direction === 'up' ? '6 15 12 9 18 15' : '6 9 12 15 18 9');
        svg.appendChild(points);
        return svg;
    };

    const stepToNeighbour = (which) => {
        const message = openMessage();
        if (!message) return;
        const target = stepFrom(message)[which];
        const url = target && urlForMessage(target);
        if (url) goToUrl(url);
    };

    // The controller keeps naming a message the header's own back button has
    // already left: with a reading pane Fastmail draws whatever it still
    // calls the open message behind the list rather than clearing it (see
    // closeOpenMessage's own comment above, on the same quirk). The address
    // is the tell instead: the phone's single pane draws whichever message
    // the URL names, so a message no longer named there is one behind the
    // list, not the one on screen.
    const messageIsCurrentView = (message) => {
        if (!message) return false;
        const own = urlForMessage(message);
        if (!own) return false;
        try {
            return new URL(own, location.href).pathname === location.pathname;
        } catch (error) {
            return false;
        }
    };

    const ensureFloatingNav = () => {
        if (floatingNavEl) return floatingNavEl;

        floatingNavEl = document.createElement('div');
        floatingNavEl.id = FLOATING_NAV_ID;

        floatingNavPrevBtn = document.createElement('button');
        floatingNavPrevBtn.type = 'button';
        floatingNavPrevBtn.className = 'custom-message-nav-btn';
        floatingNavPrevBtn.setAttribute('aria-label', 'Previous message');
        floatingNavPrevBtn.appendChild(chevronIcon('up'));
        floatingNavPrevBtn.addEventListener('click', () => stepToNeighbour('previous'));

        floatingNavNextBtn = document.createElement('button');
        floatingNavNextBtn.type = 'button';
        floatingNavNextBtn.className = 'custom-message-nav-btn';
        floatingNavNextBtn.setAttribute('aria-label', 'Next message');
        floatingNavNextBtn.appendChild(chevronIcon('down'));
        floatingNavNextBtn.addEventListener('click', () => stepToNeighbour('next'));

        floatingNavEl.appendChild(floatingNavPrevBtn);
        floatingNavEl.appendChild(floatingNavNextBtn);
        document.body.appendChild(floatingNavEl);
        return floatingNavEl;
    };

    // Run on everything that can move either pair on or off screen: the
    // message opening or closing, the list under it being replaced, the
    // app being left for Settings or Contacts, either setting, and a
    // rotation crossing the phone/tablet width Fastmail decides on. The
    // header's own buttons stay a phone-only concern — the iPad's header
    // has no such pair to hide — so only the floating one gets the iPad
    // sub-setting; the two are otherwise independent, each applied on its
    // own rather than one following the other.
    const applyFloatingNav = () => {
        const message = openMessage();
        const onMessage = !!message && messageIsCurrentView(message) &&
            FastMail.router.get('app') === 'mail';
        const onPhoneMessage = onMessage && isPhoneLayout();
        const onFloatingNavMessage = onPhoneMessage ||
            (onMessage && isTabletLayout() && settings.floatingMessageNavIPad);

        if (onFloatingNavMessage && settings.floatingMessageNav) {
            ensureFloatingNav();
            const plan = stepFrom(message);
            floatingNavPrevBtn.disabled = !plan.previous;
            floatingNavNextBtn.disabled = !plan.next;
            floatingNavEl.classList.add('is-shown');
        } else if (floatingNavEl) {
            floatingNavEl.classList.remove('is-shown');
        }

        document.documentElement.classList.toggle(
            HIDE_MESSAGE_NAV_CLASS,
            onPhoneMessage && settings.hideMessageNavButtons
        );
    };

    // A tick after the trigger, the same wait advanceAfterDecision gives the
    // list elsewhere in this file: the message key and the router's own
    // encoded state each fire mid-navigation, before location.href has
    // necessarily caught up with either, and messageIsCurrentView reads
    // exactly that address. Coalesced, since opening a message fires both
    // in the same turn.
    //
    // The tick is not always enough on its own: the address and the message
    // key do not always land on the same one, and a check run against
    // whichever landed first reads the other as still the old screen. A
    // second pass a moment later catches the state the first pass was too
    // early to see, with nothing else left to trigger a check once it does
    // land; reset on every fresh trigger so a burst of them ends in one
    // settled pass rather than several.
    let floatingNavTimer = null;
    let floatingNavSettleTimer = null;

    const updateFloatingNav = () => {
        if (!floatingNavTimer) {
            floatingNavTimer = setTimeout(() => {
                floatingNavTimer = null;
                applyFloatingNav();
            }, 0);
        }

        clearTimeout(floatingNavSettleTimer);
        floatingNavSettleTimer = setTimeout(applyFloatingNav, 250);
    };

    // Every address change goes through here regardless of which of the
    // router's own properties it also touches, or whether it touches one at
    // all, so this is the one place worth wrapping rather than a growing
    // list of properties guessed at one broken case at a time. Wraps
    // whatever is already on history.pushState/replaceState, composing with
    // the shell's own equivalent patch instead of fighting it.
    let historyWatchedForFloatingNav = false;

    const watchHistoryForFloatingNav = () => {
        if (historyWatchedForFloatingNav) return;
        historyWatchedForFloatingNav = true;

        ['pushState', 'replaceState'].forEach((method) => {
            const original = history[method];
            history[method] = function () {
                const result = original.apply(this, arguments);
                updateFloatingNav();
                return result;
            };
        });

        window.addEventListener('popstate', updateFloatingNav);
    };

    // The one undo everything routes through; the toast's button and the
    // keyboard's z alike.
    let undoTarget = null;
    let warnedNoUndo = false;

    const wrapUndoOn = (owner, method) => {
        if (undoTarget || !owner || typeof owner[method] !== 'function') {
            return false;
        }

        undoTarget = owner;
        const original = owner[method];

        owner[method] = function () {
            const back = lastUndoReturn;
            lastUndoReturn = null;

            // Fastmail's undo knows nothing about the address book, so the
            // group membership is taken back here.
            undoGroupAdds();

            const result = original.apply(this, arguments);
            if (back) goToUrl(back);
            return result;
        };

        return true;
    };

    const patchUndo = () => {
        if (undoTarget) return;

        let manager = null;
        try {
            const keys = Object.keys(FastMail);
            for (let i = 0; i < keys.length && !manager; i += 1) {
                const value = FastMail[keys[i]];
                if (value && typeof value === 'object' &&
                    typeof value.undo === 'function' &&
                    typeof value.redo === 'function') {
                    manager = value;
                }
            }
        } catch (error) {
            return;
        }

        // z's registration names the manager even when the namespace does
        // not: the table is read the way the key is
        if (!manager) {
            try {
                const events = FastMail.ViewEventsController;
                const table = events && events.kbShortcuts;
                const handler = table && typeof table.getHandlerForKey === 'function' &&
                    table.getHandlerForKey('z');
                if (handler && handler[0] && typeof handler[0][handler[1]] === 'function') {
                    wrapUndoOn(handler[0], handler[1]);
                    return;
                }
            } catch (error) {
                // No table yet; the register hook catches a later one
            }
        }

        if (!manager && typeof controller().actions.undo === 'function') {
            manager = controller().actions;
        }
        if (manager) wrapUndoOn(manager, 'undo');
    };

    /*
     * Two primitives mean archive, and they are patched rather than any of
     * the routes into them. `archive` is the plain verb. `remove` becomes one
     * when the mailbox coming off is the Inbox: removeCurrent; the [ and ]
     * keys, the Remove-from-Inbox button, a swipe; is measured to be
     * `remove(keys, whichever mailbox you are looking at)`.
     *
     * On a project label that same call is redirected to archive rather than
     * treated as one, since removing the label would leave the message in the
     * Inbox. So a swipe, [ and ] and Fastmail's contextual button all archive
     * there, and only the mode's own Remove label button still takes the
     * label off; it is the one route that asks for that and means it.
     */
    const ARCHIVE_VERBS = ['archive', 'remove'];

    const isArchiving = (verb, args) => verb === 'archive' ||
        (!!args[1] && typeof args[1].get === 'function' &&
            args[1].get('role') === 'inbox');

    // The other two verbs that take a message off the mailbox you are looking
    // at, and so run into the same update blind spot.
    const REMOVED_BY = {
        move: () => [controller().get('mailbox')],
        addremove: (args) => toArray(args[1]).concat(toArray(args[2]))
    };

    const patchFiling = (actions) => {
        Object.keys(REMOVED_BY).forEach((verb) => {
            const original = actions[verb];
            if (typeof original !== 'function') return;

            actions[verb] = function () {
                const result = original.apply(this, arguments);
                REMOVED_BY[verb](arguments).forEach(refreshListAfter);
                return result;
            };
        });
    };

    /*
     * Snoozing takes the triage label off, whichever route asks for it: a
     * conversation coming back later is one you have decided about, and it
     * comes back to the Inbox rather than to a queue that has already been
     * through. Project and hold labels stay, because where a message belongs
     * is not what snoozing changes. Taken off with its own didAction
     * silenced, so the snooze's own checkpoint carries both and one undo puts
     * both back.
     */
    const patchSnooze = (actions) => {
        const original = actions.snooze;
        if (typeof original !== 'function') return;

        actions.snooze = function (storeKeys, date) {
            try {
                const keys = resolveKeys(this, storeKeys);
                const removes = keys ? triageAmong(keys) : [];
                if (removes.length) {
                    silencingDidAction(this, () => {
                        removingOnPurpose(() => this.addremove(keys, [], removes));
                    });
                }
            } catch (error) {
                reportFault('could not take the triage label off a snoozed message', error);
            }
            noteFollowUp('snoozed', resolveKeys(this, storeKeys));
            return original.apply(this, arguments);
        };
    };

    /*
     * The second decision, from the toast of the first. Snoozing, archiving
     * and keeping each take the message out of view, so deciding a second
     * thing about it meant searching it back. Fastmail's own toast for the
     * first, the one with Undo, now offers the others for the same
     * messages: after a snooze Keep… and Archive (done with it for now; it
     * still comes back at its time), after an archive or a keep Snooze…. In
     * labels mode none of them undoes another: a snooze moves Inbox to
     * Snoozed and leaves the labels, an archive takes the Inbox and the
     * project labels off and leaves Snoozed, a keep adds a label.
     *
     * The verb notes what it did and to which messages the moment before its
     * didAction; the didAction wrapper in patchArchive hands that to the
     * toast Fastmail shows from inside it, through the container's show. The
     * buttons act on those messages, never the selection, which by then is
     * something else; a second decision's own toast offers no third.
     */
    const FOLLOW_UPS = {
        snoozed: ['keep', 'archive'],
        archived: ['snooze'],
        kept: ['snooze']
    };
    // A verb whose didAction never comes leaves nothing for a later one
    const FOLLOW_UP_WAIT_MS = 3000;
    let pendingFollowUp = null;
    let showingFollowUp = null;
    // The messages a toast's button just acted on, whose own toast then
    // offers nothing more
    let followingUp = { keys: new Set(), until: 0 };

    const noteFollowUp = (kind, keys) => {
        if (!keys || !keys.length) return;
        if (Date.now() < followingUp.until && keys.every(key => followingUp.keys.has(key))) return;
        pendingFollowUp = { kind, keys: keys.slice(), at: Date.now() };
    };

    const takeFollowUp = () => {
        const was = pendingFollowUp;
        pendingFollowUp = null;
        return was && Date.now() - was.at < FOLLOW_UP_WAIT_MS ? was : null;
    };

    const markFollowingUp = (keys) => {
        followingUp = { keys: new Set(keys), until: Date.now() + 60 * 1000 };
    };

    // Fastmail's time menu, the one its own Snooze button opens, hung off
    // the toast and snoozing exactly these messages
    const openFollowUpSnooze = (keys, notification) => {
        const popOver = popOverForPicker();
        const Menu = FastMail.classes.FutureTimeMenuView;
        if (!popOver || typeof Menu !== 'function' || !anchorRect(notification)) return false;
        const menu = new Menu({
            didSelect(date) {
                this.hide();
                markFollowingUp(keys);
                controller().actions.snooze(keys, new Date(date));
            }
        });
        popOver.show({
            view: menu,
            alignWithView: notification,
            positionToThe: 'top',
            alignEdge: 'centre',
            showCallout: true,
            keepInHorizontalBounds: true,
            keepInVerticalBounds: true
        });
        return true;
    };

    const FOLLOW_UP_BUTTONS = {
        keep: {
            label: 'Keep…',
            // The label picker for these messages, hung off the toast; the
            // toast stays up under it, since the picker is placed by it
            run: (keys, notification) => {
                markFollowingUp(keys);
                // Nothing to step on to: the message is not the one in view
                takeAdvance();
                if (!buildPicker(keys, {
                    alignWithView: notification, positionToThe: 'top', alignEdge: 'centre',
                    offsetTop: 0, offsetLeft: 0
                })) reportFault('no label menu to open');
                return false;
            }
        },
        archive: {
            label: 'Archive',
            run: (keys) => {
                markFollowingUp(keys);
                controller().actions.archive(keys);
                return true;
            }
        },
        snooze: {
            label: 'Snooze…',
            run: (keys, notification) => {
                if (!openFollowUpSnooze(keys, notification)) reportFault('no snooze menu to open');
                return false;
            }
        }
    };

    // The buttons go before Undo, in Fastmail's own action row and style
    const addFollowUpButtons = (notification, parts) => {
        const followUp = notification.customFollowUp;
        const row = parts && parts[1];
        if (!followUp || !(row instanceof Element)) return;
        const el = FastMail.el;
        const buttons = (FOLLOW_UPS[followUp.kind] || []).map((name) => {
            const spec = FOLLOW_UP_BUTTONS[name];
            const button = el('button.v-Notification-action', [spec.label]);
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                try {
                    const done = spec.run(followUp.keys, notification);
                    if (done && notification._controller) notification._controller.hide(notification);
                } catch (error) {
                    reportFault('the toast’s ' + spec.label.replace('…', '') + ' did not go through', error);
                }
            });
            return button;
        });
        buttons.reverse().forEach(button => row.insertBefore(button, row.firstChild));
    };

    const patchFollowUpToasts = () => {
        const Container = FastMail.classes.NotificationContainerView;
        if (!Container || Container.prototype.customFollowUps) return;
        Container.prototype.customFollowUps = true;
        const show = Container.prototype.show;
        Container.prototype.show = function (view) {
            const followUp = showingFollowUp;
            showingFollowUp = null;
            // An undoable toast, which is the one a verb's didAction shows;
            // its class is loaded with it, so it is patched the first time
            if (followUp && view && typeof view === 'object' && view.undoTarget &&
                    typeof view.drawNotification === 'function') {
                const proto = Object.getPrototypeOf(view);
                if (!Object.prototype.hasOwnProperty.call(proto, 'customFollowUpDraw')) {
                    const draw = proto.drawNotification;
                    proto.drawNotification = function () {
                        const parts = draw.apply(this, arguments);
                        try {
                            addFollowUpButtons(this, parts);
                        } catch (error) {
                            reportFault('the toast’s follow-up buttons could not be drawn', error);
                        }
                        return parts;
                    };
                    proto.customFollowUpDraw = true;
                }
                view.customFollowUp = followUp;
            }
            return show.apply(this, arguments);
        };
    };

    const patchArchive = () => {
        const actions = controller().actions;
        if (actions.customTriageArchive) return;
        actions.customTriageArchive = true;

        ARCHIVE_VERBS.forEach((verb) => {
            const original = actions[verb];

            actions[verb] = function (storeKeys, goTo) {
                const mailbox = arguments[1];

                // Taking the label you are looking at off is what a swipe, the
                // bracket keys and Fastmail's contextual button all ask for,
                // and on a project label it is not what any of them mean: the
                // label is the queue, so leaving it is archiving.
                if (verb === 'remove' && !removingLabelOnPurpose &&
                        mailbox && typeof mailbox.get === 'function' &&
                        mailbox.get('role') !== 'inbox' && isProject(mailbox)) {
                    return this.archive(storeKeys);
                }

                const archiving = isArchiving(verb, arguments);

                if (!archiving) {
                    const plain = original.apply(this, arguments);
                    refreshListAfter(mailbox);
                    return plain;
                }

                const keys = resolveKeys(this, storeKeys);
                if (!keys) return original.apply(this, arguments);

                const self = this;
                const args = arguments;
                const first = messagesFrom(keys)[0];
                const inbox = first && inboxMailbox(first.get('accountId'));

                pendingUndoReturn = urlForMessage(first);
                noteFollowUp('archived', keys);
                runDone(self, keys, () => {
                    // The original gets its own arguments: passing resolved
                    // keys would flip isActioningFocused and move the focus
                    original.apply(self, args);
                });
                if (inbox) refreshListAfter(inbox);
                return this;
            };
        });

        patchFiling(actions);
        patchSnooze(actions);

        // The stamp rides the checkpoint: whichever didAction cuts one takes
        // the pending return with it; the archive verbs set it the moment
        // before, everything else stamps null.
        const originalDidAction = actions.didAction;
        actions.didAction = function () {
            lastUndoReturn = pendingUndoReturn;
            pendingUndoReturn = null;
            lastGroupAdds = pendingGroupAdds;
            pendingGroupAdds = null;
            showingFollowUp = takeFollowUp();

            if (!undoTarget) {
                patchUndo();
                if (!undoTarget && lastUndoReturn && !warnedNoUndo) {
                    warnedNoUndo = true;
                    reportFault('no undo manager found to wrap;' +
                        ' undo will not walk back to the message');
                }
            }

            try {
                return originalDidAction.apply(this, arguments);
            } finally {
                showingFollowUp = null;
            }
        };

        patchFollowUpToasts();
        patchUndo();
    };

    const patchMailboxMenu = () => {
        const proto = FastMail.classes.MailboxMenuView.prototype;
        // Resolved through the chain: the class has none of its own
        const originalDidEnterDocument = proto.didEnterDocument;

        // Enter with nothing typed commits: what you have ticked is ticked,
        // and the tristate applies it as it closes.
        const originalKeydown = proto.keydown;

        proto.keydown = function (event) {
            const menuController = this.get('controller');
            const typed = menuController && menuController.get('search');

            if (menuController && menuController.customLabels && !typed &&
                event && event.key === 'Enter') {
                event.preventDefault();
                if (typeof this.done === 'function') this.done();
                return undefined;
            }

            return originalKeydown.apply(this, arguments);
        };

        proto.didEnterDocument = function () {
            // Taken before applying, since applying can be put off a tick,
            // and the next thing to open the menu sets it again.
            if (isLabelsMenu(this)) {
                const files = wantOurFile;
                wantOurFile = false;

                if (!applyLabelsMode(this, files)) {
                    const menu = this;
                    setTimeout(() => {
                        applyLabelsMode(menu, files);
                    }, 0);
                }

                return originalDidEnterDocument.apply(this, arguments);
            }

            const ours = wantOurMove;
            wantOurMove = false;

            if (!applyMoveMode(this, ours)) {
                const menu = this;
                setTimeout(() => {
                    applyMoveMode(menu, ours);
                }, 0);
            }

            return originalDidEnterDocument.apply(this, arguments);
        };
    };

    // Fastmail gives the Move to button "m v"; two keys in one space-separated
    // property, measured.
    const LABELS_SHORTCUT = 'l';

    const hasShortcut = (target, key) => {
        if (!target || typeof target.get !== 'function') return false;

        try {
            return String(target.get('shortcut')).trim().split(/\s+/).indexOf(key) !== -1;
        } catch (error) {
            return false;
        }
    };

    // The name the bar knows it by, then the key it answers to.
    const isLabelsButton = (target) => isRegisteredAs(target, 'labels') ||
        hasShortcut(target, LABELS_SHORTCUT);

    const isMoveButton = (target) => isRegisteredAs(target, 'move') ||
        hasShortcut(target, MOVE_SHORTCUT);

    // Where "l" would have gone. Captured from the registration rather than
    // looked up, so whatever Fastmail bound is what we call.
    let moveButton = null;

    // v goes in under a stand-in of ours calling openMove, not under the
    // button calling activate, and the button takes its shortcut back off
    // under its own name, which matches nothing, so each registration stayed
    // behind.
    const moveHandlers = new WeakMap();

    const moveHandlerFor = (target) => {
        let handler = moveHandlers.get(target);

        if (!handler) {
            handler = { openMove: openMove };
            moveHandlers.set(target, handler);
        }

        return handler;
    };

    const ourMoveWanted = () => settings.labelsShortcut;

    // v is keep: on a filed selection it takes Triage off directly, and only
    // an unfiled one opens the picker; the same narrowed menu, opened with
    // nothing waiting on it.
    const openMove = () => {
        if (!ourMoveWanted()) {
            if (!moveButton) return;
            wantOurMove = false;
            moveButton.target[moveButton.method]();
            return;
        }

        runVerb('keep', null);
    };

    // Shift-V: the picker, whatever the selection carries; the same menu v
    // opens for an unfiled conversation.
    const openLabelPicker = () => {
        const actions = controller().actions;
        const keys = resolveKeys(actions, null);
        if (!keys) return;
        openProjectPicker(keys);
    };

    // The hold labels this account has, by the same names the setting gives.
    const holdLabelsHere = () => {
        const accountId = controller().get('accountId');
        return mailboxesOf(accountId).filter(isExcludedLabel);
    };

    // Shift-E, and a long press on Archive. The picker is the Keep picker,
    // narrowed to the holds while this is armed, and the pick archives.
    const openArchiveIntoPicker = () => {
        const actions = controller().actions;
        const keys = resolveKeys(actions, null);
        if (!keys) return;

        if (!holdLabelsHere().length) {
            reportFault('no hold label to archive into; name one in "' +
                'Labels that are never projects"');
            return;
        }

        // Nothing opened means no menu took it, and it must not be left here
        // for one that opens later and was never asked to archive anything.
        armArchiveInto();
        if (!openProjectPicker(keys)) takeArchiveInto();
    };

    /*
     * A long press on the Archive button opens the same picker, because the
     * phone has no Shift to hold. Half a second, and a drag of more than a
     * few pixels is a scroll rather than a press.
     *
     * The click that follows the press is swallowed: the button would
     * otherwise archive underneath the picker that just opened, which is the
     * one outcome a long press must not have.
     */
    const LONG_PRESS_MS = 500;
    const LONG_PRESS_SLOP = 10;

    const archiveButtonUnder = (node) => {
        if (!node) return null;
        for (const bar of toolbarsOnScreen()) {
            try {
                const view = bar.getView('archive');
                const layer = view && view.get('layer');
                if (layer && layer.contains(node)) return view;
            } catch (error) {
                // Next bar
            }
        }
        return null;
    };

    const watchArchiveLongPress = () => {
        let timer = null;
        let from = null;
        let swallowClick = false;

        const cancel = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            from = null;
        };

        document.addEventListener('pointerdown', (event) => {
            cancel();
            if (!archiveButtonUnder(event.target)) return;

            from = { x: event.clientX, y: event.clientY };
            timer = setTimeout(() => {
                timer = null;
                from = null;
                swallowClick = true;
                openArchiveIntoPicker();
            }, LONG_PRESS_MS);
        }, true);

        document.addEventListener('pointermove', (event) => {
            if (!from) return;
            const moved = Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y);
            if (moved > LONG_PRESS_SLOP) cancel();
        }, true);

        ['pointerup', 'pointercancel', 'scroll'].forEach((name) => {
            document.addEventListener(name, cancel, true);
        });

        document.addEventListener('click', (event) => {
            if (!swallowClick) return;
            swallowClick = false;
            event.preventDefault();
            event.stopPropagation();
        }, true);
    };

    // A shortcut and the button it stands for should not disagree, so clicking
    // Move to opens what v opens, and Option-clicking opens what Option-V
    // does.
    const watchMoveClick = () => {
        // Watched on the press that opens the menu. The button opens it on
        // pointerdown, which comes before mousedown, so a mousedown watch set
        // the intent one press too late: the first menu of a session showed
        // everything, and every menu after it carried the answer from the
        // press before.
        const press = typeof window.PointerEvent === 'function' ?
            'pointerdown' : 'mousedown';

        document.addEventListener(press, (event) => {
            const layer = moveButton && moveButton.target.get('layer');
            const onButton = !!layer && !!event.target && layer.contains(event.target);

            wantOurMove = onButton && !event.altKey && ourMoveWanted();
        }, true);
    };

    // Fastmail archives with y (and with h, which is left alone) and expands a
    // thread with e.
    const SWAPPED_KEYS = { e: 'y', y: 'e' };

    // The key that archives once the two have traded places.
    const ARCHIVE_KEY = 'e';

    // Fastmail's own archive key, claimed for the same reason and whether or
    // not the two have traded places.
    const ARCHIVE_ALT_KEY = 'h';

    // Fastmail's own pin key, claimed so that pinning goes through the mode's
    // verb.
    const PIN_KEY = 's';

    // Registrations made before the patch below was installed keep the stock
    // binding, so move those across once.
    const swapExistingKeys = (kb, register) => {
        const moves = Object.keys(SWAPPED_KEYS)
            .map((key) => {
                const list = kb._shortcuts[key] || [];
                const handler = list[list.length - 1];
                return handler ? [SWAPPED_KEYS[key], handler] : null;
            })
            .filter(Boolean);

        moves.forEach(([key, handler]) => {
            register.call(kb, key, handler[0], handler[1], handler[2]);
        });
    };

    // The verb keys the mode owns outright. Fastmail's own registrations, the
    // list's star on s, the conversation view's expandAll on Shift-E, land
    // underneath and stay there unused.
    const claimedHandlers = {};

    // key -> verb, filled by reclaimKeys from the key settings; the handlers
    // look their verb up here on every press, so a rebuilt map retargets keys
    // already claimed
    const claimedRun = {};

    const wantedClaims = () => {
        const wanted = {
            'Shift-V': () => openLabelPicker(),
            // Archive into a hold label, over Fastmail's expandAll.
            'Shift-E': () => openArchiveIntoPicker(),

            // The sidebar, on the shifted pair of the keys that walk a list.
            // Fastmail's own sidebar controller does the walking, so these
            // move through it in the order it is drawn, whole: the states
            // above the labels, the labels themselves, and the folders under
            // them. Shift-I is the one place worth naming, since the Inbox is
            // the one you come back to rather than arrive at.
            'Shift-J': () => walkSidebar('selectDown'),
            'Shift-K': () => walkSidebar('selectUp'),
            'Shift-I': () => selectSource(inboxMailbox(controller().get('accountId')))
        };

        // null is the caller's selection untouched; the focused conversation
        // to Fastmail, and the wrapper in patchArchive turns it into the verb:
        // Triage, every project label and the pin come off, a hold label such
        // as Later stays, and that holds in every list because nothing here
        // asks the toolbar what it currently means.
        const archive = () => controller().actions.archive(null);

        // h is Fastmail's own archive key and is claimed either way; e only
        // while the two have traded places, since without the swap it is
        // Fastmail's thread expander and stays that way.
        wanted[ARCHIVE_ALT_KEY] = archive;
        if (settings.swapArchiveExpand) wanted[ARCHIVE_KEY] = archive;

        wanted[PIN_KEY] = () => runVerb('urgent', null);

        return wanted;
    };

    // Assigned inside patchShortcuts, where the registry lives; called
    // again whenever the key settings change
    let reclaimKeys = () => {};

    // A button registers its shortcut on entering the document and ignores
    // later changes to the property; setting it afterwards leaves the old
    // binding in place, which is measurable.
    const patchShortcuts = () => {
        const kb = FastMail.ViewEventsController.kbShortcuts;
        const originalRegister = kb.register;

        const claimKey = (key) => {
            const handler = {
                go: (event) => claimedRun[key](event)
            };

            claimedHandlers[key] = handler;
            originalRegister.call(kb, key, handler, 'go');
        };

        const liftClaimed = (key) => {
            const handler = claimedHandlers[key];
            if (!handler) return;

            const list = kb._shortcuts[key] || [];
            if (list.length && list[list.length - 1][0] === handler) return;

            originalDeregister.call(kb, key, handler, 'go');
            originalRegister.call(kb, key, handler, 'go');
        };

        // The same for v, which is not claimed but substituted: our stand-in
        // goes in where the Move button registers, and anything registering
        // the key afterwards buries it, because the registry answers to
        // whichever went in last.
        const liftMove = (key) => {
            if (key !== MOVE_SHORTCUT || !moveButton) return;

            const handler = moveHandlers.get(moveButton.target);
            if (!handler) return;

            const list = kb._shortcuts[MOVE_SHORTCUT] || [];
            if (list.length && list[list.length - 1][0] === handler) return;

            originalDeregister.call(kb, MOVE_SHORTCUT, handler, 'openMove');
            originalRegister.call(kb, MOVE_SHORTCUT, handler, 'openMove');
        };

        kb.register = function (key, target, method, priority) {
            // Decided as the registration goes in rather than at the keypress,
            // because the key itself is what dispatches.
            if (settings.swapArchiveExpand && SWAPPED_KEYS[key]) {
                const moved = SWAPPED_KEYS[key];
                const swapped = originalRegister.call(
                    this, moved, target, method, priority
                );

                // Ours goes back on top afterwards. The registry answers to
                // whichever registered last, and the toolbar registers again
                // every time it enters the document, so without this the
                // button would shadow the claimed key a redraw later.
                liftClaimed(moved);
                return swapped;
            }

            // The tristate picker is opened programmatically for a multi-
            // select verb, so the button that owns it is captured from its
            // registration the way the Move button is
            if (key === LABELS_SHORTCUT && isLabelsButton(target)) {
                labelsButton = { target: target, method: method };
            }

            // z's owner is the undo route worth wrapping; the same object the
            // toast's button presses; so its registration is another way to
            // find what the namespace scan may have missed
            if (key === 'z' && !undoTarget && target &&
                    typeof target === 'object' &&
                    typeof target[method] === 'function') {
                wrapUndoOn(target, method);
            }

            if (key !== MOVE_SHORTCUT || !isMoveButton(target)) {
                const result = originalRegister.apply(this, arguments);
                liftClaimed(key);
                liftMove(key);
                return result;
            }

            // The menu as Fastmail ships it stays reachable on Option-V, which
            // is bound on the physical key rather than registered here
            moveButton = { target: target, method: method };

            return originalRegister.call(
                this, MOVE_SHORTCUT, moveHandlerFor(target), 'openMove', priority
            );
        };

        // A view takes its shortcut back off under the key it thinks it holds,
        // so a registration that moved has to be taken off the key it moved
        // to, or it is never taken off at all: measured, six handlers on e and
        // nine on y for two buttons and one thread-expander.
        const originalDeregister = kb.deregister;

        kb.deregister = function (key, target, method) {
            if (settings.swapArchiveExpand && SWAPPED_KEYS[key]) {
                return originalDeregister.call(
                    this, SWAPPED_KEYS[key], target, method
                );
            }

            // Ours went in under a stand-in, so it comes off as one.
            const handler = key === MOVE_SHORTCUT && target && typeof target === 'object'
                ? moveHandlers.get(target)
                : null;

            if (handler) {
                return originalDeregister.call(
                    this, MOVE_SHORTCUT, handler, 'openMove'
                );
            }

            return originalDeregister.apply(this, arguments);
        };

        if (settings.swapArchiveExpand) swapExistingKeys(kb, originalRegister);

        // Claim the verb keys last, so they sit on top of anything already
        // registered when the script starts.
        reclaimKeys = () => {
            const wanted = wantedClaims();

            Object.keys(claimedHandlers).forEach((key) => {
                if (!wanted[key]) {
                    originalDeregister.call(kb, key, claimedHandlers[key], 'go');
                    delete claimedHandlers[key];
                    delete claimedRun[key];
                }
            });

            Object.keys(wanted).forEach((key) => {
                claimedRun[key] = wanted[key];
                if (!claimedHandlers[key]) claimKey(key);
            });
        };

        reclaimKeys();

        watchMoveClick();
        watchArchiveLongPress();
    };

    /*
     * ----------------------------------------------------------------
     * Mode
     * ----------------------------------------------------------------
     */

    // The mailboxes a message is in, by name
    const mailboxPaths = (message) => {
        const boxes = message && message.get ? message.get('mailboxes') : null;
        if (!boxes || typeof boxes.getObjectAt !== 'function') return [];

        const names = [];
        const length = boxes.get('length') || 0;

        for (let i = 0; i < length; i += 1) {
            const box = boxes.getObjectAt(i);
            if (box && box.get) names.push(mailboxPath(box));
        }

        return names;
    };

    /*
     * The mailboxes a row's chips answer to: every message of the thread, not
     * just the one the row holds.
     *
     * A row is a conversation, and its chips are the union of what the thread
     * carries, a label on the reply shows on the row even though the message
     * the row was built from has never been in it. Read against that one
     * message, such a chip looks stale, and rows were losing labels they
     * really had: measured, a row whose chips read "Nexthealth/HDV" while its
     * own record reported nothing but the Inbox.
     */
    const threadMailboxPaths = (message) => {
        const names = new Set();
        threadOf(message).forEach(other =>
            mailboxPaths(other).forEach(name => names.add(name)));
        return Array.from(names);
    };

    // Fastmail draws a row's label chips and adds to them when a label is
    // added, but does not take one away when a label is removed; the chip
    // stays behind.

    // A chip reads "Projects/Work" because that is the mailbox's path, but the
    // container is scaffolding; it is on every label and says nothing.
    const stripChipPrefix = (chip) => {
        const span = chip.querySelector('span[title]');
        if (!span) return;

        const path = span.getAttribute('title');
        const cut = path.lastIndexOf('/');
        if (cut === -1) return;

        const leaf = path.slice(cut + 1);
        if (span.textContent !== leaf) span.textContent = leaf;
    };

    // An open message lists its labels as badges rather than chips, and there
    // the path is the text and nothing else; no title to read it back from.
    const stripBadgePrefix = (badge) => {
        const text = badge.textContent;
        const cut = text.lastIndexOf('/');

        if (cut === -1) {
            // Badges are reused. A title left over from a nested label would
            // claim the wrong path for whatever is in the badge now.
            const title = badge.getAttribute('title');
            if (title && title.slice(title.lastIndexOf('/') + 1) !== text) {
                badge.removeAttribute('title');
            }
            return;
        }

        badge.setAttribute('title', text);
        badge.textContent = text.slice(cut + 1);
    };

    const CHIP_SELECTOR = '.v-MailboxItem-mailbox';

    // Not `a.u-badge-text`: the desktop draws each badge as a link, the phone as
    // a plain span, and asking for the link left the phone's badges unstripped.
    const BADGE_SELECTOR = '.v-ThreadLabels .u-badge-text';

    // A badge on the phone is `<div class="u-badge"><span>Inbox</span></div>`,
    // no href, no title, nothing but the text, which CSS cannot select on.
    const BADGE_NAME = 'data-custom-mailbox';

    const markBadge = (badge) => {
        const container = badge.closest('.u-badge') || badge;

        // Before stripping the text is the whole path; after it, the title is.
        const path = badge.getAttribute('title') || badge.textContent.trim();

        if (path && container.getAttribute(BADGE_NAME) !== path) {
            container.setAttribute(BADGE_NAME, path);
        }
    };

    const stripLabelsIn = (root) => {
        if (!root.querySelectorAll) return;

        const badges = [];
        if (root.matches && root.matches(BADGE_SELECTOR)) badges.push(root);
        root.querySelectorAll(BADGE_SELECTOR).forEach(badge => badges.push(badge));

        // Stamped whatever the prefix setting says: it is what the hide rules
        // select on, and the two settings are not the same question
        badges.forEach(markBadge);

        if (!settings.stripLabelPrefix) return;

        if (root.matches && root.matches(CHIP_SELECTOR)) stripChipPrefix(root);
        root.querySelectorAll(CHIP_SELECTOR).forEach(stripChipPrefix);
        badges.forEach(stripBadgePrefix);
    };

    // Rows are recycled as you scroll and the open message is redrawn whenever
    // you move to another one, so both have to be caught as they are drawn.
    let labelObserver = null;

    const watchLabels = () => {
        const app = document.getElementById('mail') || document.querySelector('.v-Page-main');
        if (!app || app === (labelObserver && labelObserver.root)) return;

        if (labelObserver) labelObserver.observer.disconnect();

        const SOURCE_ROW = '.v-MailboxSource';

        // A row arriving, and anything redrawn inside one that is already
        // there.
        const drawsSourceRow = (node) =>
            !!node.querySelector &&
            ((node.matches && node.matches(SOURCE_ROW)) ||
                !!node.querySelector(SOURCE_ROW) ||
                (!!node.closest && !!node.closest(SOURCE_ROW)));

        const draws = (node, selector) =>
            !!node.querySelector &&
            ((node.matches && node.matches(selector)) || !!node.querySelector(selector));

        const observer = new MutationObserver((changes) => {
            let sidebarDrawn = false;
            let toolbarDrawn = false;

            changes.forEach((change) => {
                change.addedNodes.forEach((node) => {
                    stripLabelsIn(node);
                    sidebarDrawn = sidebarDrawn || drawsSourceRow(node);
                    toolbarDrawn = toolbarDrawn || draws(node, '.v-Toolbar');
                });

                // A row leaving counts for as much as one arriving.
                // Collapsing a label takes its children out of the list and
                // hands each row below them to a different mailbox, rewriting
                // the inline style as it goes; which drops the shift the
                // marking pass wrote there and leaves those rows lapping the
                // one above. Nothing is added in the whole of that, so a test
                // that only reads addedNodes never hears about it, and the
                // sidebar stayed overlapped until some unrelated change
                // happened to redraw it.
                change.removedNodes.forEach((node) => {
                    sidebarDrawn = sidebarDrawn || drawsSourceRow(node);
                });
            });

            // Each rebuilt toolbar comes back with Remove in it
            if (toolbarDrawn) {
                dressToolbar();
                updatePinState();
            }

            // A row appearing or leaving moves where one kind gives way to
            // the next
            if (sidebarDrawn) {
                markSourceGroups();
                dressTriageRows();
                dressSourceSections();
                refreshRootLabelExpansion();
            }
        });

        observer.observe(app, { childList: true, subtree: true });
        labelObserver = { root: app, observer: observer };
        stripLabelsIn(app);
        markSourceGroups();
        dressTriageRows();
        dressSourceSections();
        refreshRootLabelExpansion();
        dressToolbar();
        updatePinState();
    };

    // Lucide's filter glyph, drawn in the SVG namespace and given the classes
    // and inline style of the icon it replaces, so Fastmail's sizing and
    // colouring carry on applying.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const FILTER_ICON_CLASS = 'custom-filterIcon';
    // Lucide draws to the edges of its 24-unit box; Fastmail's icons sit well
    // inside theirs.
    const FILTER_ICON_POINTS = '19.75 5.03 4.25 5.03 10.45 12.36 10.45 17.43' +
        ' 13.55 18.98 13.55 12.36 19.75 5.03';

    const filterGlyph = (existing) => {
        const svg = document.createElementNS(SVG_NS, 'svg');

        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('role', 'presentation');
        // The sizing classes are worth having; the glyph identifier is not,
        // i-inbox and friends are what Fastmail hangs each icon's own styling
        // off, and this is no longer that icon.
        const classes = (existing.getAttribute('class') || '')
            .split(/\s+/)
            .filter(name => name && name.indexOf('i-') !== 0);

        svg.setAttribute('class', classes.concat(FILTER_ICON_CLASS).join(' '));

        const shape = document.createElementNS(SVG_NS, 'polygon');
        shape.setAttribute('points', FILTER_ICON_POINTS);
        svg.appendChild(shape);

        return svg;
    };

    // The Triage row wears the funnel too, so the sidebar and the switch above
    // the list say the same thing about the same set.
    const sourceIcon = (el) => toArray(el.querySelectorAll('svg')).filter((svg) => {
        const names = (svg.getAttribute('class') || '').split(/\s+/);
        return names.indexOf(FILTER_ICON_CLASS) === -1 &&
            names.some(name => name.indexOf('i-') === 0);
    })[0] || null;

    // A sidebar row's own icon is coloured inline from the label, not by any
    // rule a stylesheet could carry: measured, Fastmail's redrawIcon sets
    // style.color from the label's foreground colour and style.fill from its
    // background one, on a glyph it has just built.
    const labelColour = (mailbox) => {
        if (!mailbox || typeof mailbox.get !== 'function') return '';

        try {
            return String(mailbox.get('color') ||
                mailbox.get('backgroundColor') || '');
        } catch (error) {
            return '';
        }
    };

    const paintFilterGlyph = (svg, mailbox) => {
        const colour = labelColour(mailbox);
        if (colour) {
            svg.style.color = colour;
        } else {
            svg.style.removeProperty('color');
        }
    };

    const dressTriageRows = () => {
        sidebarRows().forEach(({ mailbox, el }) => {
            const drawn = el.querySelector('svg.' + FILTER_ICON_CLASS);
            const stock = sourceIcon(el);

            if (!isTriage(mailbox)) {
                if (drawn) drawn.remove();
                if (stock) stock.classList.remove(HIDDEN_SOURCE_ICON_CLASS);
                return;
            }

            const funnel = drawn || (stock && stock.parentNode
                ? stock.parentNode.insertBefore(filterGlyph(stock), stock)
                : null);
            if (!funnel) return;

            if (stock) stock.classList.add(HIDDEN_SOURCE_ICON_CLASS);

            // Painted on every pass rather than only as it goes in:
            // recolouring the label redraws the row, and a funnel already in
            // place would otherwise keep the old shade until something removed
            // it.
            paintFilterGlyph(funnel, mailbox);
        });
    };

    // The sidebar runs the system folders, the labels and the saved searches
    // together in one list.
    const sourceKind = (mailbox) =>
        (isUserLabel(mailbox) && !isUnderInbox(mailbox) ? 'label' : 'system');

    // A saved search is a source like the others and belongs to no mailbox, so
    // it is a third kind rather than part of whatever run it happens to
    // follow.
    const SEARCH_ROW = '.v-SearchSource';

    const rowKind = (el, mailbox) => {
        if (mailbox) return sourceKind(mailbox);

        return el.matches && el.matches(SEARCH_ROW) ? 'search' : null;
    };

    // The lists holding sidebar rows, and the mailbox behind each row that has
    // one.
    const sourceLists = () => {
        const mailboxes = new Map();
        const lists = new Set();

        sidebarRows().forEach(({ mailbox, el }) => {
            mailboxes.set(el, mailbox);
            if (el.parentElement) lists.add(el.parentElement);
        });

        return { mailboxes, lists };
    };

    const markSourceGroups = () => {
        // With the option off the rows go back where Fastmail put them.
        const gap = settings.sidebarSeparators ? SEPARATOR_GAP : 0;
        const { mailboxes, lists } = sourceLists();

        // Each list is walked on its own. A second account's sources are a
        // list of their own, positioned from their own origin, so an offset
        // carried over from the list above would push them all down; and its
        // first row already has the group's heading above it, which says the
        // same thing a line would.
        lists.forEach((list) => {
            let previous = null;
            let offset = 0;

            // Every child, not just the rows with a mailbox behind them.
            const rows = toArray(list.children).map((el) => ({
                el,
                kind: rowKind(el, mailboxes.get(el)),
                top: parseFloat(el.style.top) || 0
            }));

            // The slots the list laid out, in its own order. It assumes the
            // rows are of one height, as a list on a fixed pitch has them.
            const slots = rows.map(row => row.top);

            rows.forEach((row, index) => {
                let starts = false;

                if (row.kind) {
                    // The first row opens the list rather than a run within it
                    starts = previous !== null && row.kind !== previous;
                    if (starts) offset += gap;
                    previous = row.kind;
                }

                row.el.classList.toggle(SOURCE_SEPARATOR_CLASS, starts);

                // A transform rather than anything the list would notice: it
                // moves the row on screen and leaves the layout the list
                // computed exactly as it found it
                const shift = (slots[index] + offset) - row.top;
                row.el.style.transform = shift ? `translateY(${shift}px)` : '';
            });

            // The rows now end lower than the list knows about; its height is
            // written inline by Fastmail and would only be overwritten again.
            const group = list.parentElement;
            if (group) group.style.paddingBottom = offset ? `${offset}px` : '';
        });
    };

    // Only a group with a title draws a header, and every one that has a title
    // draws one; so a second account showing sources of its own is a second
    // header, and one header means there is nothing else on screen to collapse
    // to.
    const dressSourceSections = () => {
        const sources = document.querySelector('.v-Sources');
        if (!sources) return;

        const headers = document.querySelectorAll('.v-Sources-group > .v-Sources-header');

        sources.classList.toggle(LONE_SECTION_CLASS,
            !!settings.hideLoneExpando && headers.length < 2);
    };

    const dropStaleChips = () => {
        // The row view's layer is the list item; .v-MailboxItem is a child of
        // it, and getViewFromNode gives nothing for that
        document.querySelectorAll('.u-list-item').forEach((node) => {
            const chips = node.querySelectorAll('.v-MailboxItem-mailbox');
            if (!chips.length) return;

            const view = FastMail.getViewFromNode(node);
            const message = view && view.get ? view.get('content') : null;
            if (!message) return;

            // Every message of the thread, because that is what the chips
            // answer to; the row's own message is one voice among them
            const actual = threadMailboxPaths(message);

            // A record whose mailboxes have not arrived yet reports none, and
            // none is not the same answer as "every one of these labels is
            // gone".
            if (!actual.length) return;

            chips.forEach((chip) => {
                const span = chip.querySelector('span[title]');
                const name = span && span.getAttribute('title');

                if (name && actual.indexOf(name) === -1) chip.remove();
            });
        });
    };


    const refresh = () => {
        refreshRootLabelExpansion();
        repaintBadges();
        pushAppBadge();
        dropStaleChips();
        markSourceGroups();
        dressTriageRows();
        dressSourceSections();
        watchLabels();
        stripLabelsIn(document);
        refreshToolbar();
    };

    // Label changes arrive in bursts too
    let styleTimer = null;

    const scheduleStyles = () => {
        if (styleTimer) return;

        styleTimer = setTimeout(() => {
            styleTimer = null;
            updateStyles();
        }, 150);
    };

    // Message changes arrive in bursts, a bulk action, or the initial preload
    // of an Inbox; so coalesce them into one repaint.
    let refreshTimer = null;

    const scheduleRefresh = () => {
        if (refreshTimer) return;

        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refresh();
        }, 100);
    };

    /*
     * ----------------------------------------------------------------
     * Observers
     * ----------------------------------------------------------------
     */

    // Overture's registry is keyed on the character a key produces, which is
    // no use for Option, so these are handled here instead.
    const isTypingTarget = (node) => {
        if (!node) return false;
        if (node.isContentEditable) return true;

        const name = node.nodeName;
        return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
    };

    const bindOptionShortcuts = () => {
        document.addEventListener('keydown', (event) => {
            if (!event.altKey || event.ctrlKey) return;
            if (isTypingTarget(event.target)) return;

            // Move to as Fastmail ships it. Matched on the physical key: on a
            // Mac, Option-V arrives as "√", so there is no name to register.
            if (!event.metaKey && event.code === STOCK_MOVE_CODE && moveButton) {
                event.preventDefault();
                wantOurMove = false;
                moveButton.target[moveButton.method]();
                return;
            }

            // The sources above Labels take Command as well, so that Command
            // and a number on its own is free for the window's tabs.
            if (!event.metaKey) return;

            const source = OPTION_SOURCE_CODES.indexOf(event.code);
            if (source === -1) return;

            event.preventDefault();
            goToSourceAt(source);
        }, true);
    };

    const addObservers = () => {
        // The store fires an event keyed by record type whenever records of
        // that type change; this is the same signal LocalQuery subscribes to
        // in monitorForChanges.
        FastMail.store.on(FastMail.classes.Message, { go: scheduleRefresh }, 'go');

        // The stylesheet names labels and their colours, so it goes stale when
        // one is recoloured, renamed, added or removed.
        FastMail.store.on(FastMail.classes.Mailbox, {
            go: () => {
                forgetLabelCache();
                refreshLabelGroups();
                scheduleStyles();
                scheduleBadgeRepaint();
                refreshMailboxSummary();
            }
        }, 'go');

        // Moving between sources rebuilds the toolbar, and a rebuilt one
        // comes back wearing Fastmail's verbs rather than the mode's.
        controller().addObserverForKey('mailbox', { go: refreshToolbar }, 'go');

        // Arriving at a project label is when the Inbox filter goes on, so
        // this rides the same change of mailbox.
        controller().addObserverForKey('mailbox', { go: applyStickyFilter }, 'go');

        // A fresh mailbox draws its own divider before any of its records
        // change, so the summary line needs its own follow rather than
        // waiting on the store event above.
        controller().addObserverForKey('mailbox', { go: refreshMailboxSummary }, 'go');

        // Opening a message does not always rebuild the bar, so the pin's
        // paint follows the open message directly rather than waiting for a
        // redraw to carry it along.
        controller().addObserverForKey('message', { go: updatePinState }, 'go');

        // Same reasoning, for the floating up/down pair: opening or closing
        // a message is what puts them on or takes them off screen.
        controller().addObserverForKey('message', { go: updateFloatingNav }, 'go');

        // The header's own back button, and Home, carry the address back to
        // the list without clearing the controller's message (see
        // messageIsCurrentView's own comment), so the message key alone
        // misses that step. Fastmail's router writes every move through the
        // History API regardless of which of its own properties it also
        // updates, or whether it updates one at all, so this catches all of
        // them rather than guessing which property a given move touches.
        // Composes with the shell's own equivalent patch rather than
        // fighting it: each wraps whatever it finds already there.
        watchHistoryForFloatingNav();

        // Entering or leaving a search rebuilds the toolbar without changing
        // the mailbox or the filter, so neither of the other two observers
        // would notice that the filter control had come or gone
        controller().addObserverForKey('search', { go: refreshToolbar }, 'go');

        // Leaving for Settings or Contacts tears the mail page down without
        // touching the mailbox either, and coming back restores the one you
        // were on, so again nothing above would fire
        FastMail.router.addObserverForKey('app', { go: refreshToolbar }, 'go');

        // Fastmail resets the filter button's active state on every filter
        // change, including ones made from its own menu
        controller().addObserverForKey('mailboxFilter', {
            go: refreshToolbar
        }, 'go');

        // A filter's own subtitle carries a count now, so a filter turning
        // on or off needs the same follow the filter button's state does.
        controller().addObserverForKey('mailboxFilter', {
            go: refreshMailboxSummary
        }, 'go');

        // A different mailbox may be grouped differently, or not at all
        controller().addObserverForKey('sort', { go: scheduleMidnight }, 'go');
        controller().addObserverForKey('mailbox', { go: scheduleMidnight }, 'go');

        // The list is rebuilt whenever the mailbox, the sort or the filter
        // moves, and a fresh one folds nothing until it is told; it also
        // needs its counts watched from the moment it exists
        controller().addObserverForKey('mailboxMessageList', {
            go: () => {
                adoptList();
                watchGroupCounts();
                watchSnoozeCounts();
                watchSnoozeSort();
                updateFloatingNav();
                watchMailboxSummaryList();
                refreshMailboxSummary();
            }
        }, 'go');
    };

    /*
     * ----------------------------------------------------------------
     * Main routine
     * ----------------------------------------------------------------
     */

    // A window of its own, a popped-out message or a compose window, is
    // Fastmail's minimal page, which never draws a sidebar
    const isMinimalWindow = /[?&]ui=minimal(?:&|$)/.test(location.search);

    // FastMail.activeViews is empty outside debug builds, so readiness is
    // checked against the controller, the store and a drawn sidebar instead;
    // a minimal window goes on the controller and the store alone
    const isReady = () => {
        try {
            return !!(
                window.FastMail &&
                FastMail.store &&
                FastMail.classes &&
                FastMail.getViewFromNode &&
                FastMail.router &&
                FastMail.router.getAppController('mail') &&
                (isMinimalWindow || document.querySelector('.v-MailboxSource'))
            );
        } catch (error) {
            return false;
        }
    };

    /*
     * Copy link, in the message ⋯ menu.
     *
     * The menu is recognised the way the shells' Share item recognises it,
     * options carrying both a reply and a forward action, and the injection
     * point is the same measured one: MenuView draw, the only dispatch the
     * render pipeline makes dynamically. The URL is the canonical one the
     * mail controller itself hands out for the open message, u= and filter
     * included.
     */
    const LINK_ICON_PATHS = [
        'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
        'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
    ];

    const linkIcon = () => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'u-standardicon v-Icon i-link');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('role', 'presentation');

        LINK_ICON_PATHS.forEach((points) => {
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', points);
            svg.appendChild(path);
        });

        return svg;
    };

    const currentMessageLink = () => urlForMessage(controller().get('message'));

    // Fastmail's own notification layer. The container view is built with the
    // root view at boot and inserted right after it, on desktop and on the
    // phone alike, so its drawn node is always there to ask for the instance.
    const TOAST_MS = 5000;

    const notificationContainer = () => {
        const node = document.querySelector('.v-NotificationContainer');
        const view = node && FastMail.getViewFromNode(node);
        return view && typeof view.show === 'function' ? view : null;
    };

    // One pill at a time: a fresh message replaces whatever is still
    // fading rather than stacking under it
    let toastTimer = null;

    const showToast = (message) => {
        try {
            const container = notificationContainer();
            if (container) {
                container.show(message, TOAST_MS, true);
                return;
            }
        } catch (error) {
            // The pill below owes the container nothing
        }

        // The hand-drawn pill, kept as the fallback for a renamed or
        // not-yet-drawn container
        const previous = document.querySelector('.custom-inbox-toast');
        if (previous) previous.remove();
        if (toastTimer) clearTimeout(toastTimer);

        const toast = document.createElement('div');
        toast.className = 'custom-inbox-toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        // Two frames apart, so the transition has a "from" to leave
        requestAnimationFrame(() => toast.classList.add('is-shown'));

        toastTimer = setTimeout(() => {
            toastTimer = null;
            toast.classList.remove('is-shown');
            setTimeout(() => toast.remove(), 300);
        }, 1800);
    };

    /*
     * A line that comes with a verb, such as a sender added to contacts.
     * Fastmail shows one plain toast at a time and a new one hides the one
     * showing, so a separate toast would hide the verb's Undo, or be hidden
     * by it a moment later. When a toast with Undo is up, or waiting its
     * turn, the line joins its text instead; otherwise it is a toast of its
     * own. Checked a moment later, so the verb has put its toast up first.
     */
    const showToastWithUndo = (message) => {
        setTimeout(() => {
            try {
                const container = notificationContainer();
                const undoable = container && [container._waiting]
                    .concat(container._showing || [])
                    .find(one => one && one.undoTarget && !one.get('notificationType') &&
                        !one.customJoined);
                if (undoable) {
                    const text = undoable.get('text') + ' · ' + message;
                    undoable.set('text', text);
                    // Drawn once; a toast still waiting draws the new text
                    if (undoable._textNode) undoable._textNode.textContent = text;
                    undoable.customJoined = true;
                    return;
                }
            } catch (error) {
                // A toast of its own, then
            }
            showToast(message);
        }, 150);
    };

    const copyText = (text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
                () => showToast('Link copied'),
                () => copyTextFallback(text)
            );
            return;
        }
        copyTextFallback(text);
    };

    const copyTextFallback = (text) => {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try {
            if (document.execCommand('copy')) showToast('Link copied');
        } finally {
            area.remove();
        }
    };

    /*
     * The message the menu is about. Fastmail's own actions in this menu work
     * on the focused row, so the link follows the same rule: the row the menu
     * was opened on, and the message the pane has open only when there is no
     * row to read, as in a menu raised from the message itself.
     */
    const focusedRowMessage = () => {
        try {
            const node = document.querySelector('.v-MailboxItem.is-focused');
            const view = node && FastMail.getViewFromNode(node);
            const content = view && typeof view.get === 'function' ?
                view.get('content') : null;
            return content instanceof FastMail.classes.Message ? content : null;
        } catch (error) {
            return null;
        }
    };

    /*
     * The action hangs off a target rather than the button: a button whose
     * target is null runs nothing when it is pressed, however well the method
     * it names is defined on it. Read when pressed, not when the menu is
     * drawn, so the link is the one for the row that is focused by then.
     */
    const copyLinkOption = () => {
        const option = new FastMail.classes.ButtonView({
            label: 'Copy link',
            icon: linkIcon(),
            method: 'copyLink',
            target: {
                copyLink() {
                    const url = urlForMessage(focusedRowMessage()) || currentMessageLink();
                    if (url) {
                        copyText(url);
                    } else {
                        showToast('No link for this message');
                    }
                }
            }
        });

        option.customCopyLinkOption = true;
        return option;
    };

    /*
     * Which menu is the Group menu.
     *
     * Not by where its button sits, what it is registered as, or what its
     * heading says, all of which move or translate. Each of the four
     * groupings Fastmail offers is a button whose selected state is bound to
     * the controller's groupBy, and Overture keeps a binding's source path on
     * the object in the open. So the menu carrying such a button is the one,
     * whatever the language and wherever the button lives.
     *
     * If that ever stops matching, nothing is added and Fastmail's own menu
     * is what opens.
     */
    const boundToGroupBy = (option) => {
        try {
            const bindings = option && option.__meta__ && option.__meta__.bindings;
            const binding = bindings && bindings.isSelected;
            return !!binding && binding.fromPath === 'groupBy';
        } catch (error) {
            return false;
        }
    };

    const isGroupMenu = (options) => (options || []).some(boundToGroupBy);

    // Fastmail's own Custom… entry has no isSelected of its own; its icon is
    // what follows groupBy, a tick while the grouping is custom.
    const iconBoundToGroupBy = (option) => {
        try {
            const bindings = option && option.__meta__ && option.__meta__.bindings;
            const binding = bindings && bindings.icon;
            return !!binding && binding.fromPath === 'groupBy';
        } catch (error) {
            return false;
        }
    };

    // Every option in this menu carries an icon, a tick on the chosen one and
    // a blank of the same size on the rest, and the blank is what lines the
    // labels up. Both are copied from Fastmail's own grouping options, so the
    // mode's entries match whatever Fastmail draws; if neither can be found
    // the entries go without, as before.
    //
    // The blank always turns up this way: Fastmail's own groupBy is a plain
    // mirror of the mailbox's sort (see currentGroupingId, which reads the
    // same sort entry Fastmail's setter for groupBy writes), so while one of
    // this mode's own groupings is active groupBy holds this mode's own id,
    // never one of Fastmail's four stock values or the "custom" string its
    // own Custom… entry's icon checks for — none of Fastmail's stock options
    // is ever selected then, which is what draws their blanks.
    //
    // The tick is the one that cannot turn up the same way: for the same
    // reason, nothing Fastmail draws is ever ticked while this menu has
    // something of its own to tick, so there is never a rendered i-tick to
    // read off an option. The Custom… entry's icon is a transform of
    // groupBy (present on its binding as .transform, same as any Overture
    // binding here) rather than a fixed value, so calling that transform
    // directly with "custom" still returns Fastmail's own tick icon, with
    // no dependence on what groupBy currently holds.
    const groupingIcons = (options) => {
        const icons = { tick: null, blank: null };
        options.forEach((option) => {
            const isIconBound = iconBoundToGroupBy(option);
            if (!boundToGroupBy(option) && !isIconBound) return;
            try {
                const icon = option.get('icon');
                const className = icon && typeof icon.getAttribute === 'function'
                    ? icon.getAttribute('class') || '' : '';
                if (!icons.tick && /\bi-tick\b/.test(className)) icons.tick = icon;
                if (!icons.blank && /\bi-blank\b/.test(className)) icons.blank = icon;
            } catch (error) {
                // An option whose icon cannot be read is no sample
            }
            // Fastmail draws each entry's icon off its own isSelected, a
            // tick when true and the blank otherwise; handed true, that
            // transform is the tick whatever is chosen right now
            if (!icons.tick) {
                try {
                    const binding = option.__meta__.bindings.icon;
                    if (binding && binding.fromPath === 'isSelected' && typeof binding.transform === 'function') {
                        const tick = binding.transform.call(binding, true, true);
                        const className = tick && typeof tick.getAttribute === 'function'
                            ? tick.getAttribute('class') || '' : '';
                        if (/\bi-tick\b/.test(className)) icons.tick = tick;
                    }
                } catch (error) {
                    // Then the older builds' way below
                }
            }
            if (!icons.tick && isIconBound) {
                try {
                    const binding = option.__meta__.bindings.icon;
                    const tick = binding.transform.call(binding, 'custom', true);
                    const className = tick && typeof tick.getAttribute === 'function'
                        ? tick.getAttribute('class') || '' : '';
                    if (/\bi-tick\b/.test(className)) icons.tick = tick;
                } catch (error) {
                    // Fastmail's own transform is no sample either, then
                }
            }
        });
        return icons;
    };

    // Selected is worked out once rather than bound, because the menu is
    // built fresh every time it opens and thrown away when it closes.
    const groupingOption = (definition, active, icons) => {
        const isActive = definition.id === active;
        const sample = isActive ? icons.tick : icons.blank;
        const option = new FastMail.classes.ButtonView({
            label: definition.name,
            icon: sample ? sample.cloneNode(true) : null,
            isSelected: isActive,
            method: 'chooseItem',
            chooseItem() {
                chooseGrouping(definition.id);
            }
        });

        option.customGroupingOption = true;
        return option;
    };

    // After the last of Fastmail's own groupings and before its Custom entry,
    // which is the end of that section; the entry that was last gives up the
    // mark that says so.
    const addGroupings = (options) => {
        if (options.some(option => option && option.customGroupingOption)) return;
        if (!isGroupMenu(options)) return;

        // Fastmail's own four bound to groupBy are always None first, then
        // by age, pinned first and unread first; only None is left standing
        // here, since "by age", "pinned first" and "unread first" are drawn
        // from settings.groupings instead, further down, where they can be
        // renamed, reordered, edited or removed like any grouping of the
        // user's own. Spliced out from the end so removing one never moves
        // an index still to be checked.
        const stockGroupBy = [];
        options.forEach((option, index) => {
            if (boundToGroupBy(option)) stockGroupBy.push(index);
        });
        for (let at = stockGroupBy.length - 1; at >= 1; at -= 1) {
            options.splice(stockGroupBy[at], 1);
        }

        const current = currentGroupingId();
        // A mailbox still grouped by the old Labels grouping ticks the preset
        // standing for it now
        const standIn = current === LABELS_GROUPING ? presetForLegacyLabels() : null;
        const active = standIn ? standIn.id : current;
        const icons = groupingIcons(options);
        const mailbox = controller().get('mailbox');
        // A preset with nothing to group by here is not offered here
        // Groups by return date mean nothing anywhere else, so they are
        // offered in the Snoozed folder and nowhere else, where they were put
        const definitions = groupingsWithSnooze(
            modeGroupings().filter(one => expandLabels(one, mailbox)), mailbox);
        const entries = definitions.map(definition => groupingOption(definition, active, icons));

        if (!entries.length) return;

        // With one of the mode's own groupings chosen, the tick is that
        // entry's; Fastmail's entries still tick whatever they read off the
        // sort, so for this menu they wear the blank instead, and only one
        // row is ticked.
        if (icons.blank && entries.some(entry => entry.get('isSelected'))) {
            options.forEach((option) => {
                if (!boundToGroupBy(option) && !iconBoundToGroupBy(option)) return;
                try {
                    option.set('icon', icons.blank.cloneNode(true));
                } catch (error) {
                    // An entry that will not change keeps its own icon
                }
            });
        }

        let last = -1;
        options.forEach((option, index) => {
            if (boundToGroupBy(option)) last = index;
        });

        try {
            options[last].set('isLastOfSection', false);
        } catch (error) {
            // A menu that will not be told is still a working menu
        }

        entries[entries.length - 1].isLastOfSection = false;
        options.splice.apply(options, [last + 1, 0].concat(entries));
    };

    /*
     * Collapse or expand every group from the Group menu, where neither a
     * list bar nor the page header carries the button (see dressPageHeader):
     * an entry at the end of the menu's Group section, doing what the
     * button does; greyed out when the list is not grouped.
     */
    const addFoldAllOption = (options) => {
        // Wherever a list bar carries the button, the menu has no need to;
        // the iPad runs the phone's build and has no such bar either
        if (!isGroupMenu(options) || toolbarsOnScreen().some(toolbar => toolbar.customFoldGroups)) return;
        if (headerFoldButton && headerFoldButton.get('isInDocument')) return;
        if (options.some(option => option && option.customFoldAll)) return;

        let at = -1;
        options.forEach((option, index) => {
            if (boundToGroupBy(option) || iconBoundToGroupBy(option) ||
                    (option && option.customGroupingOption)) at = index;
        });
        if (at === -1) return;

        const groups = listGroups();
        const collapse = !groups || anyGroupOpen(groups);
        const option = new FastMail.classes.ButtonView({
            label: collapse ? 'Collapse all groups' : 'Expand all groups',
            icon: standardIcon('i-fold-' + (collapse ? 'collapse' : 'expand'),
                FOLD_ICON_SHAPES[collapse ? 'collapse' : 'expand']),
            isDisabled: !groups,
            isLastOfSection: true,
            // After the menu has closed, which is when the list redraws
            target: { run: () => setTimeout(foldAllGroups, 0) },
            method: 'run'
        });
        option.customFoldAll = true;

        try {
            options[at].set('isLastOfSection', false);
        } catch (error) {
            // Without its line the entry is still there
        }
        options.splice(at + 1, 0, option);
    };

    /*
     * Keep in a message row's right-click menu, in Move to's place, while
     * Keep instead of move is on: the verb the bar's Keep and v run, so a
     * conversation still to be filed opens the limited picker and one
     * already filed only loses its triage label. Move to itself stays behind
     * Option-V and the bar.
     *
     * The conversations are read as the entry is pressed, while the menu is
     * still open: until it closes, Fastmail's actions answer for the row that
     * was right-clicked rather than for the selection, and once it has closed
     * they no longer do. The picker opens where the menu stood, after the
     * menu has gone, the way the bar's Keep waits, and files exactly those
     * conversations (see buildPicker).
     */
    const contextKeepOption = (replaced) => {
        const option = new FastMail.classes.ButtonView({
            label: 'Keep',
            icon: stateVerbIcon('keep'),
            isLastOfSection: !!(replaced && replaced.get('isLastOfSection')),
            method: 'keep',
            target: {
                keep(button) {
                    const keys = resolveKeys(controller().actions, null);
                    if (!keys) return;

                    const PopOverView = FastMail.classes.PopOverView;
                    const menuPopOver = PopOverView && button && typeof button.getParent === 'function'
                        ? button.getParent(PopOverView) : null;
                    const shown = menuPopOver && menuPopOver.get('options');
                    const placement = shown && shown.alignWithView ? {
                        alignWithView: shown.alignWithView,
                        positionToThe: shown.positionToThe,
                        alignEdge: shown.alignEdge,
                        offsetTop: shown.offsetTop,
                        offsetLeft: shown.offsetLeft
                    } : null;

                    setTimeout(() => runVerb('keep', keys, placement), 0);
                }
            }
        });

        option.customContextKeep = true;
        return option;
    };

    const patchRowContextMenu = () => {
        const RowView = FastMail.classes.MailboxItemView;
        const proto = RowView && RowView.prototype;
        if (!proto || typeof proto.getContextOptions !== 'function' || proto.customContextKeep) return;
        proto.customContextKeep = true;

        const original = proto.getContextOptions;
        proto.getContextOptions = function () {
            const options = original.apply(this, arguments);
            try {
                if (ourMoveWanted() && Array.isArray(options)) {
                    const at = options.findIndex(option => isMoveButton(option));
                    if (at !== -1) options[at] = contextKeepOption(options[at]);
                }
            } catch (error) {
                reportFault('could not put Keep in the message menu', error);
            }
            return options;
        };
    };

    const isMessageActionsMenu = (options) => {
        let reply = false;
        let forward = false;

        toArray(options).forEach((option) => {
            if (!option || typeof option.get !== 'function') return;
            try {
                const action = option.get('action');
                reply = reply || action === 'reply';
                forward = forward || action === 'forward';
            } catch (error) {
                // An option without an action is not the fingerprint
            }
        });

        return reply && forward;
    };

    const patchMenus = () => {
        const MenuView = FastMail.classes.MenuView;
        if (!MenuView || MenuView.prototype.customMenuItems) return;
        MenuView.prototype.customMenuItems = true;

        const originalDraw = MenuView.prototype.draw;

        MenuView.prototype.draw = function () {
            try {
                const options = this.get('options');
                if (options && typeof options.unshift === 'function') {
                    // The Mac and iOS shells carry the same link on their own
                    // menu, Copy URL among two others, so this one stands
                    // down there rather than saying it twice.
                    // At the bottom, below everything Fastmail offers, the
                    // way the shells place theirs.
                    if (!/Electron\//.test(navigator.userAgent) &&
                        !options.some(option => option && option.customCopyLinkOption) &&
                        isMessageActionsMenu(options)) {
                        const last = options[options.length - 1];
                        try {
                            if (last) last.set('isLastOfSection', true);
                        } catch (error) {
                            // Without its line the link is still there
                        }
                        options.push(copyLinkOption());
                    }
                    addGroupings(options);
                    addFoldAllOption(options);
                    addSnoozePresets(options);
                }
            } catch (error) {
                reportFault('could not add to a menu', error);
            }

            return originalDraw.apply(this, arguments);
        };
    };

    /*
     * ----------------------------------------------------------------
     * The settings page
     * ----------------------------------------------------------------
     *
     * Every Fastmail Custom option, drawn from Fastmail's own view classes as a
     * page registered with Fastmail's Settings controller, so one page
     * serves the Mac app, the phone, the extension and a plain tab. The
     * native screens keep only what has to be reachable when no page will
     * load: the backend, the start page and notifications.
     *
     * If a class the page needs, or a method the Settings controller needs
     * to be taught, turns out to be missing, nothing is registered: the
     * plain panel, reached from a copied row in the sidebar, is the
     * fallback then.
     */
    // Writing on every keystroke would send one message per character, and
    // each one comes back through applySettings and rebuilds the grouped
    // list. Coalesced into one write once typing pauses. The same interval
    // the extension's own settings page used.
    const SETTING_WRITE_DELAY = 450;

    /*
     * The key and value are captured at the moment of the keystroke rather
     * than re-read from the field later, because flush() runs when the page
     * is being left or the plain panel is closing: by then the field it
     * came from may already be destroyed, and a value read off a destroyed
     * view is not the one that was typed.
     */
    const debouncedWrite = () => {
        let timer = null;
        let pending = null;
        const fire = () => {
            timer = null;
            const [key, value] = pending;
            pending = null;
            writeSetting(key, value);
        };
        return {
            write: (key, value) => {
                pending = [key, value];
                if (timer) clearTimeout(timer);
                timer = setTimeout(fire, SETTING_WRITE_DELAY);
            },
            flush: () => {
                if (!timer) return;
                clearTimeout(timer);
                fire();
            }
        };
    };

    /*
     * One option, drawn. A toggle is Fastmail's switch, the control its own
     * settings pages use, carrying its hint as the description it already
     * draws under the label; a text option is a field with the hint beneath
     * it.
     *
     * A clearable field shows "none" rather than its default as the
     * placeholder, because for those an empty box is ambiguous: never
     * touched, or emptied on purpose, and the two mean opposite things.
     *
     * A sub-option sits in under the option it depends on. The indent is
     * Fastmail's own padding class, on a view of its own around the row, so
     * the row keeps the classes Fastmail gave it. That view is also what dims
     * the whole row while the parent is off, since the row's own disabled
     * state greys only its input. The plain fallback panel stays flat.
     */
    const SUB_OPTION_INDENT = 'u-pl-6';

    const underParent = (classes, option, row, register) => {
        if (!option.parent) return row;
        const holder = new classes.View({ className: SUB_OPTION_INDENT, draw: () => [row] });
        register.hold(option, holder);
        return holder;
    };

    const settingRow = (classes, option, register) => {
        const el = FastMail.el;
        const current = settingValue(option.key);

        if (typeof current === 'boolean') {
            const box = new classes.ToggleView({
                label: option.title,
                description: option.hint,
                value: current
            });
            box.addObserverForKey('value', {
                changed: () => {
                    writeSetting(option.key, box.get('value'));
                    register.parentChanged(option.key, box.get('value'));
                }
            }, 'changed');
            register.add(option, box);
            return underParent(classes, option, box, register);
        }

        const debounced = debouncedWrite();
        const field = new classes.TextInputView({
            label: option.title,
            placeholder: option.clearable ? 'none' : String(DEFAULT_SETTINGS[option.key] || ''),
            value: String(current)
        });
        field.addObserverForKey('value', {
            changed: () => debounced.write(option.key, field.get('value'))
        }, 'changed');
        register.add(option, field);
        register.trackFlush(debounced.flush);

        return underParent(classes, option, new classes.View({
            className: 'u-space-y-1',
            draw: () => [field, el('p.u-trim.u-text-sm.u-color-unimportant', [option.hint])]
        }), register);
    };

    /*
     * A sub-option only means anything while the option above it is on, so it
     * follows its parent rather than sitting there looking available. The
     * rows are built one at a time and a parent may be drawn after its child,
     * so each row registers itself and the parent's state is applied to the
     * whole set once its group has finished drawing.
     *
     * A redraw throws the old rows away and builds fresh ones, so the
     * register is reset before each build rather than kept: a stale view left
     * in it belongs to a group no longer on screen, and settling against it
     * would mean nothing.
     *
     * The page's pending field writes live here too, rather than in a
     * second object: it is already the one thing threaded through every row
     * for the life of the page, unlike the views map above, which is
     * thrown away on every redraw while a debounce timer from a group no
     * longer on screen may still be waiting.
     */
    const settingRegister = () => {
        let views = {};
        let holders = {};
        const flushers = [];
        // The input greys itself, and its holder dims the label and hint with
        // it. The class goes on the holder's layer directly, which nothing
        // rewrites once that view is drawn.
        const follow = (key, on) => {
            views[key].set('isDisabled', !on);
            const holder = holders[key];
            if (holder) holder.get('layer').classList.toggle(SUB_OPTION_DIMMED, !on);
        };
        const register = {
            add: (option, view) => { views[option.key] = view; },
            hold: (option, holder) => { holders[option.key] = holder; },
            reset: () => { views = {}; holders = {}; },
            trackFlush: (flush) => { flushers.push(flush); },
            flushPending: () => { flushers.forEach((flush) => flush()); },
            parentChanged: (key, on) => {
                SETTINGS.forEach((option) => {
                    if (option.parent !== key || !views[option.key]) return;
                    follow(option.key, !!on);
                });
            },
            settle: () => {
                SETTINGS.forEach((option) => {
                    if (!option.parent || !views[option.key]) return;
                    follow(option.key, !!settingValue(option.parent));
                });
            }
        };
        return register;
    };

    /*
     * The page Fastmail's Settings shows for Fastmail Custom, built the way its
     * own pages are: a PageView holding one SettingsPaneView, and in it one
     * section per group with the heading on the left and the options on the
     * right. The section markup is Display options' and Custom swipes', class
     * for class, so the spacing, the dividers and the wrap to one column on a
     * narrow screen are all theirs.
     */
    const SETTINGS_PAGE_ID = 'custom-options';
    const SETTINGS_PAGE_TITLE = 'Custom options';

    // The page needs these; the groupings editor's dialog also wants
    // ModalOverlayView and ScrollView, the mobile build's back button wants
    // PageHeaderView, and a list row's "…" menu wants MenuButtonView and
    // MenuView, but each checks for its own class, so its absence costs that
    // one part rather than the page.
    const pageClasses = () => findClasses(
        ['PageView', 'SettingsPaneView', 'ToggleView', 'TextInputView', 'ButtonView', 'View'],
        ['ModalOverlayView', 'ScrollView', 'PageHeaderView', 'MenuButtonView', 'MenuView']
    );

    // Fastmail's classes by name: nothing if a required one is missing,
    // otherwise every required one and whichever optional ones exist. Each
    // settings page asks for its own set.
    const findClasses = (required, optional) => {
        const all = FastMail.classes || {};
        if (required.some(name => typeof all[name] !== 'function')) return null;
        const found = {};
        required.concat(optional).forEach((name) => {
            if (typeof all[name] === 'function') found[name] = all[name];
        });
        return found;
    };

    // One section of a settings page, its id naming the page and the group.
    const pageSection = (pageId, group, rows) => {
        const el = FastMail.el;
        // The two inline widths are copied from Display options' and Custom
        // swipes' own sections: without them the left column has no floor,
        // and at a narrow width it collapses instead of wrapping above the
        // options, breaking on the u-break-words heading one letter at a time.
        return el('div.u-p-6.u-space-y-5#s-' + pageId + '-' + group.id, [
            el('div.u-flex.u-flex-wrap.u-mx-n6.u-my-n4', [
                el('div.u-mx-6.u-my-4.u-space-y-5.u-flex-1', { style: 'min-width:200px' }, [
                    el('h1.u-flex-auto.u-font-bold.u-text-2xl.u-trim.u-break-words.u-containSelection', [group.title])
                ]),
                el('div.u-mx-6.u-my-4.u-flex-major.u-space-y-8',
                    { style: 'min-width:415px;min-width:min(415px, calc(100% - 48px))' }, rows)
            ])
        ]);
    };

    const settingsSection = (group, rows) => pageSection(SETTINGS_PAGE_ID, group, rows);

    const settingsPane = (classes) => {
        const register = settingRegister();
        return new classes.SettingsPaneView({
            draw() {
                register.reset();
                const sections = SETTING_GROUPS.map(group => settingsSection(group,
                    settingsInGroup(group.id).map(option => sectionRow(classes, option, register))));
                if (syncState()) sections.push(settingsSection(SYNC_GROUP, [syncRow(classes)]));
                register.settle();
                return sections;
            },
            // Leaving the page is when whatever a field still has waiting
            // gets flushed: written now, on the key and value it captured,
            // before the page's views are thrown away.
            willLeaveDocument() {
                try {
                    register.flushPending();
                } catch (error) {
                    reportFault('a setting typed just before leaving the page may not have saved', error);
                }
                return classes.SettingsPaneView.prototype.willLeaveDocument.call(this);
            }
        });
    };

    /*
     * The desktop build's own Settings pages have no header at all: Display
     * options itself passes header: null there, which is what this page
     * copied until the phone was tried. The mobile build gives each one
     * Fastmail's own PageHeaderView instead, whose back button follows
     * whether the sidebar sits beside the page — hidden on an iPad, where
     * the sidebar is there and Display options' own header hides it the
     * same way, shown on an iPhone, where it is not. A controller that
     * binds isWithSidebar, rather than carrying it as a plain constant, is
     * how the mobile build is told apart from the desktop one.
     */
    const isMobileSettings = (controller) => {
        const bindings = controller && controller.__meta__ && controller.__meta__.bindings;
        return !!(bindings && bindings.isWithSidebar);
    };

    const settingsPageHeader = (classes, controller) => {
        try {
            if (!isMobileSettings(controller) || typeof classes.PageHeaderView !== 'function') return null;

            const header = new classes.PageHeaderView({
                showBack: !controller.get('isWithSidebar'),
                isWithSidebarDidChange() {
                    this.set('showBack', !controller.get('isWithSidebar'));
                },
                destroy() {
                    // A header that cannot let go of its observer still has to
                    // come apart, or the page's other views stay behind with it.
                    try {
                        controller.removeObserverForKey('isWithSidebar', this, 'isWithSidebarDidChange');
                    } catch (error) {
                        reportFault('the settings page could not stop following the sidebar', error);
                    }
                    classes.PageHeaderView.prototype.destroy.call(this);
                }
            });
            controller.addObserverForKey('isWithSidebar', header, 'isWithSidebarDidChange');
            return header;
        } catch (error) {
            reportFault('the settings page could not add its back button', error);
            return null;
        }
    };

    // A settings page built the way Fastmail builds its own: titled from its
    // headings, thrown away when left, with the mobile build's header. The
    // header is made before the content, as it always was.
    const settingsPageView = (classes, controller, id, title, makeContent) => {
        const header = settingsPageHeader(classes, controller);
        return new classes.PageView({
            title,
            url: id,
            isTitleFromH1s: true,
            isImmortal: false,
            header,
            content: makeContent()
        });
    };

    const settingsPage = (classes, controller) => settingsPageView(
        classes, controller, SETTINGS_PAGE_ID, SETTINGS_PAGE_TITLE, () => [settingsPane(classes)]
    );

    /*
     * The Notifications page, on the phone and the iPad. Fastmail's own page
     * draws its choices only inside Fastmail's app; in the shells it shows
     * only the app store badges. So where the shell offers
     * window.native.notifications, which it does on iPhone and iPad and never
     * on the Mac, this page takes Fastmail's notifications id. It is built
     * from the Fastmail Custom page's parts: the same page view, header and
     * sections. The sidebar entry and its highlight stay Fastmail's own,
     * since the id is.
     *
     * The choice lives in the app, which tells the push server. Fastmail's
     * own notification preferences are never read here and never written.
     */
    const NOTIFICATIONS_PAGE_ID = 'notifications';
    const NOTIFICATIONS_PAGE_TITLE = 'Notifications';
    // Fastmail's own section, as its Notifications page wraps each part
    const NOTIFICATIONS_SECTION = 'div.u-p-6.u-space-y-5';
    const NOTIFICATIONS_PERMISSION_TEXT = 'Notifications are turned off for this app in iOS Settings.';
    const NOTIFICATIONS_CONTACTS_TEXT =
        'The push server cannot read your contacts, so VIPs and contacts get no notifications.';

    // Fastmail's glyphs for the four choices and for its warning banner,
    // copied from its Cancelled, VIP, Inbox, settings and attention icons;
    // the functions that draw them belong to its modules and are not
    // reachable from here.
    const NOTIFICATION_GLYPHS = {
        cancelled: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="u-standardicon">' +
            '<circle cx="12" cy="12" r="6.75"/><line x1="7.5" y1="7.5" x2="16.5" y2="16.5"/></svg>',
        vip: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="u-standardicon">' +
            '<path d="M12.41,16.28a.8.8,0,0,0-.82,0L7.36,19.17c-.23.16-.35.07-.27-.19l1.27-4.52a.93.93,0,0,0-.21-.83' +
            'L4.86,10.28c-.19-.19-.13-.37.15-.4l4.35-.41a.92.92,0,0,0,.69-.5l1.75-4c.11-.25.29-.25.4,0L14,9' +
            'a.92.92,0,0,0,.69.5L19,9.88c.28,0,.34.21.15.4l-3.29,3.35a.93.93,0,0,0-.21.83L16.91,19' +
            'c.08.26,0,.35-.27.19Z"/></svg>',
        inbox: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="u-standardicon">' +
            '<path d="M3.75 13.2727H7.01567C7.73679 13.2727 8.39602 13.6813 8.71852 14.328L8.93533 14.7629' +
            'C9.25782 15.4096 9.91706 15.8182 10.6382 15.8182H13.3618C14.0829 15.8182 14.7422 15.4096 15.0647 14.7629' +
            'L15.2815 14.328C15.604 13.6813 16.2632 13.2727 16.9843 13.2727H20.25M3.75 13.5598V17.0909' +
            'C3.75 18.1453 4.60238 19 5.65385 19H18.3462C19.3976 19 20.25 18.1453 20.25 17.0909V13.5598' +
            'C20.25 13.3695 20.2216 13.1802 20.1658 12.9984L18.1251 6.34765C17.8793 5.54662 17.1412 5 16.3054 5' +
            'H7.69459C6.8588 5 6.12073 5.54662 5.87494 6.34765L3.83419 12.9984C3.77838 13.1802 3.75 13.3695 3.75 13.5598Z"/></svg>',
        settings: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="u-standardicon">' +
            '<path d="M20.48 10.6L19 10.17a.33.33 0 0 1-.24-.24 6.86 6.86 0 0 0-.52-1.25.34.34 0 0 1 0-.34L19 7' +
            'a.71.71 0 0 0-.12-.86l-1-1a.72.72 0 0 0-.51-.22A.64.64 0 0 0 17 5l-1.33.74a.35.35 0 0 1-.17 0 .33.33 0 0 1-.17 0' +
            ' 7 7 0 0 0-1.26-.52.36.36 0 0 1-.25-.22l-.42-1.48a.72.72 0 0 0-.69-.52h-1.42a.72.72 0 0 0-.69.52L10.17 5' +
            'a.33.33 0 0 1-.24.24 7.17 7.17 0 0 0-1.25.52.35.35 0 0 1-.17 0 .33.33 0 0 1-.17 0L7 5a.64.64 0 0 0-.35-.1' +
            '.74.74 0 0 0-.51.22l-1 1A.74.74 0 0 0 5 7l.75 1.34a.37.37 0 0 1 0 .34 7.17 7.17 0 0 0-.52 1.25' +
            '.34.34 0 0 1-.24.24l-1.48.43a.72.72 0 0 0-.52.69v1.42a.72.72 0 0 0 .52.69l1.49.43a.34.34 0 0 1 .24.24' +
            ' 7.17 7.17 0 0 0 .52 1.25.37.37 0 0 1 0 .34L5 17a.7.7 0 0 0 .12.85l1 1a.69.69 0 0 0 .5.21A.63.63 0 0 0 7 19' +
            'l1.34-.74a.38.38 0 0 1 .34 0 7 7 0 0 0 1.26.52.33.33 0 0 1 .23.24l.43 1.48a.72.72 0 0 0 .69.52h1.42' +
            'a.72.72 0 0 0 .69-.52l.43-1.5a.33.33 0 0 1 .24-.24 7.17 7.17 0 0 0 1.25-.52.35.35 0 0 1 .17 0 .33.33 0 0 1 .17 0' +
            'L17 19a.63.63 0 0 0 .35.09.73.73 0 0 0 .51-.21l1-1A.71.71 0 0 0 19 17l-.75-1.34a.37.37 0 0 1 0-.34' +
            ' 7 7 0 0 0 .52-1.26.35.35 0 0 1 .24-.23l1.48-.43a.72.72 0 0 0 .52-.69v-1.42a.73.73 0 0 0-.53-.69z' +
            'M12 15.24A3.24 3.24 0 1 1 15.24 12 3.24 3.24 0 0 1 12 15.24z"/></svg>',
        attention: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
            ' stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">' +
            '<circle cx="11.75" cy="11.75" r="7.25"/>' +
            '<circle cx="11.5" cy="15.37" r="0.88" fill="currentColor" stroke="none"/>' +
            '<line x1="11.5" y1="8" x2="11.5" y2="12.5"/></svg>'
    };

    // A fresh glyph each time, since a node can be in one place only; the
    // classes are the ones Fastmail's own icon function and its caller add.
    const notificationGlyph = (name, sizing) => {
        const svg = new DOMParser().parseFromString(NOTIFICATION_GLYPHS[name], 'image/svg+xml').documentElement;
        svg.setAttribute('role', 'presentation');
        ['v-Icon', 'i-' + name].concat(sizing.split(' ')).forEach(one => svg.classList.add(one));
        return svg;
    };

    // Fastmail's label for a boxed choice, drawn the way RadioGroupView's own
    // helper draws it: the glyph and title on one line, the description under
    // the title.
    const notificationChoiceLabel = (glyph, title, description) => {
        const el = FastMail.el;
        return el('div.u-py-1.u-flex.u-flex-col.u-space-y-3', [
            el('p.u-flex.u-space-x-2.u-items-center', [
                notificationGlyph(glyph, 'u-sq-24 u-my-n4'),
                el('div.u-flex-1.u-trim', [title])
            ]),
            el('div.u-flex.u-space-x-2', [
                el('span.u-sq-24.u-my-n4'),
                el('p.u-flex-1.u-trim.u-color-unimportant', [description])
            ])
        ]);
    };

    const NOTIFICATION_MODES = [
        { value: 'off', glyph: 'cancelled', title: 'Off',
            description: "Don't show a notification for any message on this device." },
        { value: 'important', glyph: 'vip', title: 'Important messages only',
            description: 'Show a notification for messages from your VIP contacts, and replies to conversations you are following.' },
        { value: 'inbox', glyph: 'inbox', title: 'All in inbox',
            description: 'Show a notification for everything that arrives in your inbox.' },
        { value: 'custom', glyph: 'settings', title: 'Custom',
            description: 'Choose senders, and labels to include or exclude.' }
    ];

    const NOTIFICATION_SENDERS = [
        { label: 'Everyone', value: 'everyone' },
        { label: 'Contacts', value: 'contacts' },
        { label: 'VIPs', value: 'vips' }
    ];

    // Fastmail's warning banner, as its own helper draws one: the attention
    // glyph beside the text, and the button, when there is one, at the end.
    const notificationBanner = (text, button) => {
        const el = FastMail.el;
        return el('div.u-banner.u-p-3.u-flex.u-items-baseline.u-space-x-2', { className: 'u-banner--warning' }, [
            el('div.u-self-start.u-sq-24.u-m-n0_5'),
            el('div.u-flex-1', [
                el('div.u-flex.u-flex-wrap.u-items-center.u-space-wrap-2', [
                    el('div.u-banner-content.u-py-1.u-flex-1', [
                        el('h3.u-relative.u-trim.u-font-semibold', [
                            notificationGlyph('attention', 'u-banner-icon u-sq-24 u-my-n0_5'),
                            text
                        ])
                    ]),
                    button
                ])
            ])
        ]);
    };

    // Only a refusal counts: a question not yet asked is asked at launch,
    // and iOS Settings has no switch to show for it yet.
    const needsPermissionWarning = (state) => state.permission === 'denied' && state.mode !== 'off';

    // Only a server that said it cannot read contacts, and only for a choice
    // that needs them.
    const needsContactsWarning = (state) => state.contacts === false &&
        (state.mode === 'important' || (state.mode === 'custom' && state.senders !== 'everyone'));

    const notificationsBridge = () => {
        const native = window.native;
        const bridge = native && native.notifications;
        return bridge && typeof bridge.state === 'function' && typeof bridge.set === 'function' &&
            typeof bridge.openSettings === 'function' ? bridge : null;
    };

    const primaryMailAccountId = () => {
        const primary = FastMail.auth && typeof FastMail.auth.get === 'function'
            ? FastMail.auth.get('primaryAccounts') : null;
        return primary ? primary['urn:ietf:params:jmap:mail'] || null : null;
    };

    // What a notification can be for: the Inbox first, then every mailbox
    // without a role, by path.
    const notificationLabels = (accountId) => {
        const all = accountId ? mailboxesOf(accountId) : [];
        const inbox = all.filter(mailbox => mailbox.get('role') === 'inbox');
        const labels = all.filter(mailbox => !mailbox.get('role'))
            .sort((a, b) => String(a.get('pathName')).localeCompare(String(b.get('pathName'))));
        return inbox.concat(labels);
    };

    // A label the store does not have (deleted, or not loaded yet) keeps its
    // place in the list rather than being dropped from the choice unseen.
    const notificationLabelName = (accountId, id) => {
        const found = accountId ? mailboxesOf(accountId).filter(mailbox => mailbox.get('id') === id)[0] : null;
        return found ? String(found.get('pathName')) : 'Unknown label';
    };

    // Fastmail's Notifications module, which the page loads before it draws,
    // brings in the choices, the copy button and the list parts. The list and
    // the copy button each have a fallback, so they are optional.
    const notificationsPageClasses = () => findClasses(
        ['PageView', 'SettingsPaneView', 'RadioGroupView', 'SelectView', 'ButtonView', 'View'],
        ['PageHeaderView', 'CopyTextView', 'ListInputView', 'MenuButtonView', 'MailboxMenuView', 'SubscreenSelectView',
            'ToggleView']
    );

    // The first eight characters shown, the whole token copied
    const notificationPushId = (classes, token) => {
        const shown = token.slice(0, 8);
        if (typeof classes.CopyTextView !== 'function') return FastMail.el('b.u-whitespace-nowrap', [shown]);
        return new classes.CopyTextView({
            layerTag: 'b', type: 'u-whitespace-nowrap', toCopy: shown, text: token, label: null
        });
    };

    /*
     * A list of labels under a title, drawn with Fastmail's own list, menu
     * button and mailbox menu, the way its page draws them. The menu offers
     * the Inbox and mailboxes without a role. Both kinds of list answer
     * { view, show(ids) }, where show puts ids chosen elsewhere into the list
     * on screen.
     */
    const fastmailLabelList = (classes, accountId, title, ids, changed) => {
        const el = FastMail.el;
        const list = new classes.ListInputView({
            label: title,
            value: ids.slice(),
            mapValueToItems: (value) => (value || []).map(id => ({ id })),
            mapItemsToValue: (items) => items.map(item => item.id),
            drawItemContent: (item) => el('p.u-trim.u-flex-1', [notificationLabelName(accountId, item.id)]),
            drawAddInput() {
                const owner = this;
                return el('p', [new classes.MenuButtonView({
                    type: 'v-Button--standard v-Button--sizeM',
                    label: 'Add label',
                    popOverOptions: { positionToThe: 'right', alignEdge: 'middle', showCallout: true },
                    menuView: new classes.MailboxMenuView({
                        accountId,
                        rolesVisible: { inbox: true, none: true },
                        didSelect: (mailbox) => owner.addItem(mailbox)
                    })
                })]);
            },
            addItem(mailbox) {
                const id = mailbox && typeof mailbox.get === 'function' ? mailbox.get('id') : null;
                if (!id || this._items.some(item => item.id === id)) return;
                this._items.replaceObjectsAt(this._items.get('length'), 0, [{ id }]);
                this.setValueFromItems();
            },
            userDidInput(value) {
                this.set('value', value);
                changed(value);
            }
        });
        return {
            view: list,
            show: (next) => {
                // The same ids in the same order: a refresh, and nothing to redraw
                const shown = list.get('value');
                if (Array.isArray(shown) && shown.join('\n') === next.join('\n')) return;
                list.set('value', next.slice());
            }
        };
    };

    // The same list from parts that are always there: the list's own markup,
    // a remove button per label, and a select to add one.
    const plainLabelList = (classes, accountId, title, ids, changed) => {
        const el = FastMail.el;
        let current = ids.slice();
        let holder = null;
        const change = (next) => {
            current = next;
            holder.viewNeedsRedraw();
            changed(next.slice());
        };
        holder = new classes.View({
            layerTag: 'fieldset',
            className: 'v-ListInput u-space-y-3',
            draw: () => {
                const chosen = new Set(current);
                const rows = current.map(id => el('li.u-list-item.u-py-3.u-flex.u-items-center.u-space-x-2', [
                    el('p.u-trim.u-flex-1', [notificationLabelName(accountId, id)]),
                    new classes.ButtonView({
                        type: 'v-Button--subtle v-Button--sizeM',
                        label: 'Remove',
                        target: { go: () => change(current.filter(one => one !== id)) },
                        method: 'go'
                    })
                ]));
                const addable = notificationLabels(accountId).filter(mailbox => !chosen.has(mailbox.get('id')));
                return [
                    el('legend.u-font-semibold.u-trim', [title]),
                    el('ul.u-list-body.u-list-body--borders.u-hideifempty', rows),
                    new classes.SelectView({
                        label: 'Add label',
                        value: '',
                        options: [{ label: 'Choose a label', value: '' }].concat(
                            addable.map(mailbox => ({ label: String(mailbox.get('pathName')), value: mailbox.get('id') }))),
                        userDidInput: (value) => {
                            if (value) change(current.concat([value]));
                        }
                    })
                ];
            }
        });
        return {
            view: holder,
            show: (next) => {
                if (next.join('\n') === current.join('\n')) return;
                current = next.slice();
                holder.viewNeedsRedraw();
            }
        };
    };

    /*
     * The page's one pane. It asks the app for the state when it enters the
     * document and again whenever the window comes back, and draws from
     * that. A choice is shown at once and sent to the app; whatever the app
     * answers is what stays. Each answer is taken only if nothing was asked
     * after it, so a late reply cannot undo a newer choice.
     *
     * Parts that come and go (a warning, Custom's controls, the push id)
     * redraw the pane; a value that changes in parts already on screen is
     * put into them, so a choice made in a control is not redrawn under the
     * finger that made it.
     */
    // The previews switch, worded the same on the phone's page and on the
    // Mac's, in a section of its own below the choice of which mail notifies
    const PREVIEWS_LABEL = 'Show previews';
    const PREVIEWS_DESCRIPTION = 'A banner shows the subject above the start of the message, rather than the subject alone.';
    const previewsSection = (toggle) => pageSection(NOTIFICATIONS_PAGE_ID, { id: 'previews', title: 'Banners' }, [toggle]);

    const notificationsPane = (classes, controller, bridge) => {
        const el = FastMail.el;
        const mobile = isMobileSettings(controller);
        const accountId = primaryMailAccountId();
        const state = {
            status: 'loading', mode: null, senders: 'everyone', mailboxIds: [], excludedMailboxIds: [], previews: true,
            permission: 'allowed', pushToken: null, contacts: null
        };
        let asked = 0;
        let drawnShape = '';
        let views = {};
        let pane = null;

        const shape = () => [state.status, state.mode === 'custom', needsPermissionWarning(state),
            needsContactsWarning(state), state.pushToken || ''].join('|');

        const update = () => {
            if (!pane) return;
            if (shape() !== drawnShape) {
                pane.viewNeedsRedraw();
                return;
            }
            if (views.choices && views.choices.get('value') !== state.mode) views.choices.set('value', state.mode);
            if (views.senders && views.senders.get('value') !== state.senders) views.senders.set('value', state.senders);
            if (views.labels) views.labels.show(state.mailboxIds);
            if (views.excludedLabels) views.excludedLabels.show(state.excludedMailboxIds);
            if (views.previews && views.previews.get('value') !== state.previews) views.previews.set('value', state.previews);
        };

        // An app from before the excluded list answers without it: none
        const labelIds = (value) => Array.isArray(value) ? value.filter(id => typeof id === 'string' && id) : [];

        const takeChoice = (reply) => {
            if (!reply || NOTIFICATION_MODES.every(one => one.value !== reply.mode)) {
                throw new Error('the app answered no notification choice');
            }
            state.mode = reply.mode;
            state.senders = NOTIFICATION_SENDERS.some(one => one.value === reply.senders) ? reply.senders : 'everyone';
            state.mailboxIds = labelIds(reply.mailboxIds);
            state.excludedMailboxIds = labelIds(reply.excludedMailboxIds);
            // An app from before the switch shows previews
            state.previews = reply.previews !== false;
        };

        const refresh = () => {
            const mine = ++asked;
            Promise.resolve().then(() => bridge.state()).then((reply) => {
                if (mine !== asked) return;
                takeChoice(reply);
                state.permission = reply.permission === 'denied' || reply.permission === 'undetermined'
                    ? reply.permission : 'allowed';
                state.pushToken = typeof reply.pushToken === 'string' && reply.pushToken ? reply.pushToken : null;
                state.contacts = typeof reply.contacts === 'boolean' ? reply.contacts : null;
                state.status = 'ready';
                update();
            }).catch((error) => {
                if (mine !== asked) return;
                if (state.status === 'loading') {
                    state.status = 'failed';
                    update();
                }
                reportFault('the notification settings could not be read', error);
            });
        };

        const choose = (change) => {
            if (state.status !== 'ready') return;
            const next = {
                mode: state.mode, senders: state.senders,
                mailboxIds: state.mailboxIds.slice(), excludedMailboxIds: state.excludedMailboxIds.slice(),
                previews: state.previews
            };
            Object.assign(next, change);
            // Custom chosen with no labels yet starts from the Inbox, for
            // everyone; a list kept from an earlier Custom is taken up again.
            if (change.mode === 'custom' && state.mode !== 'custom' && !next.mailboxIds.length) {
                const inbox = notificationLabels(accountId).filter(mailbox => mailbox.get('role') === 'inbox')[0];
                next.mailboxIds = inbox ? [inbox.get('id')] : [];
                next.senders = 'everyone';
            }
            Object.assign(state, next);
            update();
            const mine = ++asked;
            Promise.resolve().then(() => bridge.set(next)).then((saved) => {
                if (mine !== asked) return;
                takeChoice(saved);
                update();
            }).catch((error) => {
                reportFault('the notification choice could not be saved', error);
                refresh();
            });
        };

        const drawChoices = () => new classes.RadioGroupView({
            type: 'v-RadioGroup--boxed',
            isDisabled: state.status !== 'ready',
            value: state.mode,
            options: NOTIFICATION_MODES.map(one => ({
                label: notificationChoiceLabel(one.glyph, one.title, one.description),
                value: one.value
            })),
            userDidInput(value) {
                this.set('value', value);
                if (value !== state.mode) choose({ mode: value });
            }
        });

        // The phone's own page opens the senders as a page of their own
        const drawSenders = () => {
            const Select = mobile && typeof classes.SubscreenSelectView === 'function'
                ? classes.SubscreenSelectView : classes.SelectView;
            return new Select({
                label: 'Notify for messages from',
                value: state.senders,
                options: NOTIFICATION_SENDERS.map(one => ({ label: one.label, value: one.value })),
                userDidInput(value) {
                    this.set('value', value);
                    if (value !== state.senders) choose({ senders: value });
                }
            });
        };

        // Custom's two lists: the labels it notifies for (mailboxIds), and
        // the labels whose messages it leaves out (excludedMailboxIds)
        const drawLabels = (title, key) => {
            const changed = (ids) => choose({ [key]: ids });
            const fastmails = ['ListInputView', 'MenuButtonView', 'MailboxMenuView']
                .every(name => typeof classes[name] === 'function');
            return fastmails
                ? fastmailLabelList(classes, accountId, title, state[key], changed)
                : plainLabelList(classes, accountId, title, state[key], changed);
        };

        // Whether a banner shows the start of the message under its subject;
        // left out where Fastmail has no switch to draw it with
        const drawPreviews = () => {
            if (typeof classes.ToggleView !== 'function') return null;
            const toggle = new classes.ToggleView({
                label: PREVIEWS_LABEL,
                description: PREVIEWS_DESCRIPTION,
                isDisabled: state.status !== 'ready',
                value: state.previews
            });
            toggle.addObserverForKey('value', {
                changed: () => {
                    const value = toggle.get('value') === true;
                    if (value !== state.previews) choose({ previews: value });
                }
            }, 'changed');
            return toggle;
        };

        const openSettingsButton = () => new classes.ButtonView({
            type: 'v-Button--standard v-Button--sizeM',
            label: 'Open Settings',
            target: { go: () => {
                Promise.resolve().then(() => bridge.openSettings()).catch((error) => {
                    reportFault('iOS Settings would not open', error);
                });
            } },
            method: 'go'
        });

        const onFocus = () => refresh();
        const onVisibility = () => {
            if (document.visibilityState === 'visible') refresh();
        };

        pane = new classes.SettingsPaneView({
            draw() {
                views = {};
                drawnShape = shape();
                if (state.status === 'failed') {
                    return [el(NOTIFICATIONS_SECTION, [
                        el('p.u-trim.u-color-unimportant', ['Notification settings are unavailable right now.'])
                    ])];
                }
                const sections = [];
                if (needsPermissionWarning(state)) {
                    sections.push(el(NOTIFICATIONS_SECTION, [
                        notificationBanner(NOTIFICATIONS_PERMISSION_TEXT, openSettingsButton())
                    ]));
                }
                if (needsContactsWarning(state)) {
                    sections.push(el(NOTIFICATIONS_SECTION, [notificationBanner(NOTIFICATIONS_CONTACTS_TEXT, null)]));
                }
                views.choices = drawChoices();
                const controls = [views.choices];
                if (state.mode === 'custom') {
                    views.senders = drawSenders();
                    views.labels = drawLabels('Included labels', 'mailboxIds');
                    views.excludedLabels = drawLabels('Excluded labels', 'excludedMailboxIds');
                    controls.push(el('div.u-space-y-5', [views.senders, views.labels.view, views.excludedLabels.view]));
                }
                sections.push(pageSection(NOTIFICATIONS_PAGE_ID, { id: 'messages', title: 'New messages' }, controls));
                views.previews = drawPreviews();
                if (views.previews) {
                    sections.push(previewsSection(views.previews));
                }
                if (state.pushToken) {
                    sections.push(el(NOTIFICATIONS_SECTION, [
                        el('p.u-trim.u-text-sm.u-color-unimportant', [
                            'The push id for your device is ', notificationPushId(classes, state.pushToken)
                        ])
                    ]));
                }
                return sections;
            },
            // Coming back from iOS Settings is how a granted permission shows,
            // so the state is asked again each time the window comes back.
            didEnterDocument() {
                const result = classes.SettingsPaneView.prototype.didEnterDocument.call(this);
                window.addEventListener('focus', onFocus);
                document.addEventListener('visibilitychange', onVisibility);
                refresh();
                return result;
            },
            willLeaveDocument() {
                window.removeEventListener('focus', onFocus);
                document.removeEventListener('visibilitychange', onVisibility);
                return classes.SettingsPaneView.prototype.willLeaveDocument.call(this);
            }
        });
        return pane;
    };

    const notificationsPage = (classes, controller, bridge) => settingsPageView(
        classes, controller, NOTIFICATIONS_PAGE_ID, NOTIFICATIONS_PAGE_TITLE,
        () => [notificationsPane(classes, controller, bridge)]
    );

    /*
     * Taking the id. Fastmail's Settings controller keeps each page's
     * builder in _registeredViews, and asks Fastmail's loader for a page's
     * module only when it has no builder; Fastmail's Notifications module
     * registers its own builder when it loads. So this page's builder goes
     * in, and register is wrapped on the controller, so that Fastmail's
     * builder, arriving later, is kept aside rather than put over this one.
     * The builder loads Fastmail's module itself, which is what brings in
     * the classes the page is drawn with.
     *
     * Anything that goes wrong while building puts Fastmail's builder back
     * and hands the page to it, so a failure costs this page and nothing
     * else. The install returns the function that puts the controller back.
     */
    let notificationsPageState = 'waiting';

    const notificationsContract = (controller) => !!controller &&
        typeof controller.get === 'function' && typeof controller.register === 'function' &&
        typeof controller.go === 'function' && typeof controller.getModuleForViewId === 'function' &&
        !!controller._registeredViews && typeof controller._registeredViews === 'object';

    const installNotificationsPage = (controller) => {
        const views = controller._registeredViews;
        const hadOwnRegister = Object.prototype.hasOwnProperty.call(controller, 'register');
        const originalRegister = controller.register;
        let fastmails = typeof views[NOTIFICATIONS_PAGE_ID] === 'function' ? views[NOTIFICATIONS_PAGE_ID] : null;
        let ours = null;

        const uninstall = () => {
            if (hadOwnRegister) controller.register = originalRegister;
            else delete controller.register;
            if (views[NOTIFICATIONS_PAGE_ID] !== ours) return;
            if (fastmails) views[NOTIFICATIONS_PAGE_ID] = fastmails;
            else delete views[NOTIFICATIONS_PAGE_ID];
        };

        const giveUp = (what, error) => {
            if (notificationsPageState === 'unavailable') return;
            notificationsPageState = 'unavailable';
            uninstall();
            reportFault(what + '; Fastmail’s own page stands in', error);
        };

        // Fastmail's own page, from the builder its module registers
        const theirs = (args) => Promise.resolve(controller.getModuleForViewId(NOTIFICATIONS_PAGE_ID)).then(() => {
            const builder = fastmails || views[NOTIFICATIONS_PAGE_ID];
            if (typeof builder !== 'function' || builder === ours) {
                throw new Error('Fastmail’s own Notifications page is not registered');
            }
            return builder.apply(null, args);
        });

        // HierarchyController calls a builder as builder(viewState,
        // controller, parent) and waits for a promise it returns.
        ours = function () {
            const args = Array.prototype.slice.call(arguments);
            if (notificationsPageState === 'unavailable') return theirs(args);
            return Promise.resolve(controller.getModuleForViewId(NOTIFICATIONS_PAGE_ID)).then(() => {
                const bridge = notificationsBridge();
                const classes = notificationsPageClasses();
                if (!bridge || !classes) throw new Error('missing ' + (bridge ? 'classes' : 'window.native.notifications'));
                return notificationsPage(classes, args[1] || controller, bridge);
            }).then(null, (error) => {
                giveUp('the Notifications page could not be drawn', error);
                return theirs(args);
            });
        };

        originalRegister.call(controller, NOTIFICATIONS_PAGE_ID, ours);
        controller.register = function (id, builder) {
            if (id === NOTIFICATIONS_PAGE_ID && builder !== ours) {
                fastmails = builder;
                return this;
            }
            return originalRegister.apply(this, arguments);
        };

        try {
            // Fastmail's page may already be on screen, built before this one
            // could take the id; it is built again, as this one. A new view
            // state is what makes the controller build rather than reuse.
            const router = FastMail.router;
            if (router && router.get('app') === 'settings' && controller.get('viewId') === NOTIFICATIONS_PAGE_ID) {
                controller.go(NOTIFICATIONS_PAGE_ID, { nonce: Math.random() });
            }
        } catch (error) {
            uninstall();
            throw error;
        }
        return uninstall;
    };

    // Called whenever the Fastmail Custom page is: the Settings controller exists
    // only once Settings has loaded. Without window.native.notifications,
    // which is everywhere but iPhone and iPad, it does nothing at all.
    const ensureNotificationsPage = () => {
        if (notificationsPageState !== 'waiting' || !notificationsBridge()) return;
        try {
            const router = FastMail.router;
            const controller = router && typeof router.getAppController === 'function'
                ? router.getAppController('settings') : null;
            if (!controller) return;
            if (!notificationsContract(controller) || !findClasses(['PageView', 'SettingsPaneView', 'ButtonView', 'View'], [])) {
                notificationsPageState = 'unavailable';
                reportFault('the Notifications page could not be added; Fastmail’s own page stands in');
                return;
            }
            installNotificationsPage(controller);
            notificationsPageState = 'installed';
        } catch (error) {
            notificationsPageState = 'unavailable';
            reportFault('the Notifications page could not be added; Fastmail’s own page stands in', error);
        }
    };

    /*
     * The Mac keeps Fastmail's own Notifications page: there Fastmail's
     * offline worker decides which mail notifies, by that page's choices. The
     * banner itself is the app's, so its previews switch is drawn onto
     * Fastmail's page, below Fastmail's own section, the way the phone's page
     * has it; and so is Custom's excluded labels list, under Fastmail's own
     * labels, which the app applies to what Fastmail chose to show. Fastmail's pane class is only there once its module has loaded,
     * which is when the page is first opened; the module registers the page
     * as it loads, so that is when the class is looked for, before the page
     * is built.
     */
    let notificationPreviewsState = 'waiting';

    const notificationPreviewsBridge = () => {
        const native = window.native;
        const bridge = native && native.notificationPreviews;
        return bridge && typeof bridge.get === 'function' && typeof bridge.set === 'function' ? bridge : null;
    };

    // The switch shows the app's setting once asked, and is held until then
    const macPreviewsSection = (classes, bridge) => {
        let ready = false;
        const toggle = new classes.ToggleView({
            label: PREVIEWS_LABEL, description: PREVIEWS_DESCRIPTION, value: true, isDisabled: true
        });
        toggle.addObserverForKey('value', {
            changed: () => {
                if (!ready) return;
                Promise.resolve().then(() => bridge.set(toggle.get('value') === true)).then((saved) => {
                    if (saved !== toggle.get('value')) toggle.set('value', saved);
                }).catch((error) => reportFault('the previews setting could not be saved', error));
            }
        }, 'changed');
        Promise.resolve().then(() => bridge.get()).then((value) => {
            toggle.set('value', value === true);
            toggle.set('isDisabled', false);
            ready = true;
        }).catch((error) => reportFault('the previews setting could not be read', error));
        return previewsSection(toggle);
    };

    const notificationExclusionsBridge = () => {
        const native = window.native;
        const bridge = native && native.notificationExclusions;
        return bridge && typeof bridge.get === 'function' && typeof bridge.set === 'function' ? bridge : null;
    };

    // Filled in once the app answers; a change is saved, and what the app
    // kept is put back into the list
    const macExcludedLabels = (classes, bridge) => {
        const accountId = primaryMailAccountId();
        const changed = (ids) => {
            Promise.resolve().then(() => bridge.set(ids)).then((kept) => list.show(kept))
                .catch((error) => reportFault('the excluded labels could not be saved', error));
        };
        const fastmails = ['ListInputView', 'MenuButtonView', 'MailboxMenuView']
            .every(name => typeof classes[name] === 'function');
        const list = fastmails
            ? fastmailLabelList(classes, accountId, 'Excluded labels', [], changed)
            : plainLabelList(classes, accountId, 'Excluded labels', [], changed);
        Promise.resolve().then(() => bridge.get()).then((ids) => list.show(ids))
            .catch((error) => reportFault('the excluded labels could not be read', error));
        return list.view;
    };

    // False while Fastmail's pane is not there to add to
    const patchNotificationsPane = (bridge) => {
        const Pane = (FastMail.classes || {}).NotificationsPaneView;
        const classes = findClasses(['ToggleView'], [
            'ListInputView', 'MenuButtonView', 'MailboxMenuView', 'ButtonView', 'SelectView', 'View'
        ]);
        if (typeof Pane !== 'function' || !Pane.prototype || typeof Pane.prototype.draw !== 'function' || !classes) {
            return false;
        }
        if (Pane.prototype.__fmcPreviews) return true;
        const draw = Pane.prototype.draw;
        Pane.prototype.draw = function () {
            const drawn = draw.apply(this, arguments);
            try {
                return [].concat(drawn, macPreviewsSection(classes, bridge));
            } catch (error) {
                reportFault('the previews switch could not be drawn', error);
                return drawn;
            }
        };
        // Custom's label list is drawn only while Custom is the choice, so
        // the excluded list beside it comes and goes with it
        const exclusions = notificationExclusionsBridge();
        const drawMailboxes = Pane.prototype.drawMailboxes;
        const canList = ['ListInputView', 'MenuButtonView', 'MailboxMenuView'].every(name => classes[name]) ||
            ['ButtonView', 'SelectView', 'View'].every(name => classes[name]);
        if (exclusions && canList && typeof drawMailboxes === 'function') {
            Pane.prototype.drawMailboxes = function () {
                const theirs = drawMailboxes.apply(this, arguments);
                try {
                    return FastMail.el('div.u-space-y-5', [theirs, macExcludedLabels(classes, exclusions)]);
                } catch (error) {
                    reportFault('the excluded labels could not be drawn', error);
                    return theirs;
                }
            };
        }
        Pane.prototype.__fmcPreviews = true;
        return true;
    };

    // Called alongside ensureNotificationsPage. Without
    // window.native.notificationPreviews, which is everywhere but the Mac,
    // it does nothing at all.
    const ensureNotificationPreviews = () => {
        const bridge = notificationPreviewsBridge();
        if (notificationPreviewsState !== 'waiting' || !bridge) return;
        try {
            const router = FastMail.router;
            const controller = router && typeof router.getAppController === 'function'
                ? router.getAppController('settings') : null;
            if (!controller) return;
            if (patchNotificationsPane(bridge)) {
                notificationPreviewsState = 'installed';
                return;
            }
            if (typeof controller.register !== 'function') {
                notificationPreviewsState = 'unavailable';
                reportFault('the previews switch could not be added to the Notifications page');
                return;
            }
            const register = controller.register;
            controller.register = function (id) {
                const result = register.apply(this, arguments);
                if (id === NOTIFICATIONS_PAGE_ID && notificationPreviewsState === 'watching') {
                    try {
                        notificationPreviewsState = patchNotificationsPane(bridge) ? 'installed' : 'unavailable';
                        if (notificationPreviewsState === 'unavailable') {
                            reportFault('the previews switch could not be added to the Notifications page');
                        }
                    } catch (error) {
                        notificationPreviewsState = 'unavailable';
                        reportFault('the previews switch could not be added to the Notifications page', error);
                    }
                }
                return result;
            };
            notificationPreviewsState = 'watching';
        } catch (error) {
            notificationPreviewsState = 'unavailable';
            reportFault('the previews switch could not be added to the Notifications page', error);
        }
    };

    /*
     * Reaching the page. Fastmail's Settings controller registers each of its
     * own pages by id, and lists it from a sources controller whose groups are
     * plain arrays of entries; Display options is registered this way. So is
     * this page, once the controller exists: Fastmail loads Settings the first
     * time it is opened, so that may be at start-up or much later.
     *
     * Everything relied on is checked first. If any of it is missing, nothing
     * is registered or wrapped, and the copied sidebar row and the plain panel
     * stand in: a renamed method must not cost the way into the settings.
     */
    let settingsPageState = 'waiting';

    // Fastmail sends an address it does not know to its default page, which
    // may rewrite the address before the controller exists to be taught this
    // one; so a load straight onto the page is remembered from the start.
    let openPageWhenInstalled = new RegExp('^/settings/' + SETTINGS_PAGE_ID + '(?:/|$)').test(location.pathname);

    const installedControllers = new WeakSet();

    // Every way of giving the page up goes through here, so a throw caught
    // anywhere below means the same thing whichever branch caught it. A load
    // that asked for this address directly is not left on whatever Settings
    // opened to instead: it falls back to the plain panel.
    const settingsPageUnavailable = () => {
        settingsPageState = 'unavailable';
        if (!openPageWhenInstalled) return;
        openPageWhenInstalled = false;
        try {
            openFallbackSettings();
        } catch (error) {
            reportFault('the plain settings panel would not open either', error);
        }
    };

    const settingsContract = (controller) => {
        if (!controller || typeof controller.get !== 'function' ||
            typeof controller.register !== 'function' || typeof controller.go !== 'function' ||
            typeof controller.makeViewInstance !== 'function' ||
            typeof controller.restoreEncodedState !== 'function') return null;
        const sources = controller.get('sources');
        if (!sources || typeof sources.get !== 'function' || typeof sources.setOptions !== 'function') return null;
        const groups = sources.get('sourceGroups');
        const group = Array.isArray(groups) && groups.find(one => one && Array.isArray(one.content) &&
            one.content.some(entry => entry && entry.id === 'actions'));
        if (!group) return null;
        const actions = group.content.find(entry => entry && entry.id === 'actions');
        if (typeof actions.get !== 'function' || typeof actions.constructor !== 'function') return null;
        return { sources, group };
    };

    // A miss before this is true may be Settings still building; a miss
    // once it is true means Fastmail has changed.
    const settingsGroupsBuilt = (controller) => {
        if (!controller || typeof controller.get !== 'function') return false;
        const sources = controller.get('sources');
        if (!sources || typeof sources.get !== 'function') return false;
        const groups = sources.get('sourceGroups');
        return Array.isArray(groups) && groups.length > 0 &&
            groups.some(one => one && Array.isArray(one.content) && one.content.length > 0);
    };

    // Fastmail Custom's funnel, the glyph the Triage row wears, given the classes
    // a Settings entry's icon carries. Fastmail calls this each time it draws
    // the row, so each call makes a fresh one.
    const settingsEntryIcon = () => {
        const stock = document.createElementNS(SVG_NS, 'svg');
        stock.setAttribute('class', 'u-standardicon v-Icon');
        return filterGlyph(stock);
    };

    /*
     * The entry is made by the constructor Fastmail's own entries come from,
     * because searching Settings reads each entry's name through get(). And
     * the group gets a new array rather than a splice: setOptions hands the
     * list the group's array itself, and the same array handed back again is
     * not a change the list redraws for.
     */
    const ensureSettingsEntry = ({ sources, group }) => {
        if (group.content.some(entry => entry && entry.id === SETTINGS_PAGE_ID)) return;
        // Below Offline; when that entry is not found (a Fastmail change) the
        // row still lands, just at the end rather than right after it.
        const offlineAt = group.content.findIndex(entry => entry && entry.id === 'offline');
        const at = offlineAt === -1 ? group.content.length : offlineAt + 1;
        const Entry = (group.content[at - 1] || group.content[0]).constructor;
        const entry = new Entry({ id: SETTINGS_PAGE_ID, name: SETTINGS_PAGE_TITLE, icon: settingsEntryIcon });
        group.content = group.content.slice(0, at).concat([entry], group.content.slice(at));
        sources.setOptions();
    };

    const installSettingsPage = (controller, classes, found) => {
        // HierarchyController.makeViewInstance calls a registered builder as
        // builder(viewState, controller, parent); the controller is passed
        // through so settingsPage can tell the mobile build's header apart
        // from the desktop build, which has none.
        controller.register(SETTINGS_PAGE_ID, (viewState, owner) => settingsPage(classes, owner));

        // Kept so a throw below can put the controller back exactly as it
        // was found. The registration above can stay either way: without
        // the wraps that follow, nothing reaches it.
        const hadOwnMake = Object.prototype.hasOwnProperty.call(controller, 'makeViewInstance');
        const hadOwnRestore = Object.prototype.hasOwnProperty.call(controller, 'restoreEncodedState');
        const originalMake = controller.makeViewInstance;
        const originalRestore = controller.restoreEncodedState;
        const originalContent = found.group.content;

        /*
         * Fastmail works out the sidebar's selected entry from its own id
         * table, built from its own fixed list of pages, which does not
         * include this one — so without this, opening the page would leave
         * no row anywhere carrying is-selected. The binding is Overture's
         * own, so it is found and wrapped rather than replaced outright: a
         * transform Fastmail did not mean to give up still runs first, and
         * only a genuine miss (this page, unrecognised) is filled in.
         */
        const binding = found.sources.__meta__ && found.sources.__meta__.bindings &&
            found.sources.__meta__.bindings.selected;
        const originalTransform = binding && typeof binding.transform === 'function' ? binding.transform : null;
        if (originalTransform) {
            binding.transform = function (stack) {
                const result = originalTransform.apply(this, arguments);
                if (result || !stack || !stack.length || stack[0].viewId !== SETTINGS_PAGE_ID) return result;
                try {
                    const groups = found.sources.get('sourceGroups');
                    const group = Array.isArray(groups) && groups.find(one => one && Array.isArray(one.content) &&
                        one.content.some(entry => entry && entry.id === SETTINGS_PAGE_ID));
                    const entry = group && group.content.find(entry => entry && entry.id === SETTINGS_PAGE_ID);
                    return entry || result;
                } catch (error) {
                    return result;
                }
            };
            // A page already showing is highlighted now, not only the next
            // time something else changes the stack.
            try {
                if (typeof binding.sync === 'function') binding.sync();
            } catch (error) {
                reportFault('the sidebar entry could not be highlighted', error);
            }
        }

        // Fastmail titles a stack entry from its own table of names, which
        // has none for this page. A function expression, not an arrow, so
        // arguments is the caller's own and every argument passes through,
        // not only the one named here.
        controller.makeViewInstance = function (viewId) {
            const made = originalMake.apply(this, arguments);
            if (viewId === SETTINGS_PAGE_ID && made) made.title = SETTINGS_PAGE_TITLE;
            return made;
        };

        // A trailing slash is accepted, matching the start-up pattern above.
        const ownAddress = new RegExp('^' + SETTINGS_PAGE_ID + '/?(?:#(.*))?$');
        controller.restoreEncodedState = function (encoded) {
            const match = ownAddress.exec(String(encoded == null ? '' : encoded));
            if (!match) return originalRestore.apply(this, arguments);
            this.go(SETTINGS_PAGE_ID, match[1] ? { anchor: match[1], nonce: Math.random() } : null);
            return this;
        };

        try {
            ensureSettingsEntry(found);
        } catch (error) {
            if (hadOwnMake) controller.makeViewInstance = originalMake; else delete controller.makeViewInstance;
            if (hadOwnRestore) controller.restoreEncodedState = originalRestore; else delete controller.restoreEncodedState;
            if (originalTransform) {
                binding.transform = originalTransform;
                try {
                    if (typeof binding.sync === 'function') binding.sync();
                } catch (syncError) {
                    reportFault('the sidebar entry could not be un-highlighted after a failed install', syncError);
                }
            }
            if (found.group.content !== originalContent) {
                found.group.content = originalContent;
                try {
                    found.sources.setOptions();
                } catch (setOptionsError) {
                    reportFault('the sidebar could not be put back after a failed install', setOptionsError);
                }
            }
            throw error;
        }
    };

    const ensureSettingsPage = () => {
        if (settingsPageState === 'unavailable') return;

        // Nothing below this line may escape: a throw here must never stop
        // whatever called in, be that Fastmail's own app switch or start().
        let controller = null;
        try {
            // SettingsPaneView arrives with Settings' own module, which loads
            // only once Settings has been opened; at start-up neither it nor
            // the controller exists yet. The controller is looked up first,
            // so a fresh load waits rather than judging the classes too
            // early and latching 'unavailable' for the rest of the session.
            const router = FastMail.router;
            controller = router && typeof router.getAppController === 'function'
                ? router.getAppController('settings') : null;
            if (!controller) return;

            const classes = pageClasses();
            if (!classes) {
                settingsPageUnavailable();
                return;
            }

            // A contract miss is not necessarily final: Settings may still
            // be mid-build. Once its sidebar groups exist, a controller not
            // yet installed gives the page up here instead of waiting
            // forever; an installed controller is left to try again later.
            const found = settingsContract(controller);
            if (!found) {
                if (!installedControllers.has(controller) && settingsGroupsBuilt(controller)) {
                    settingsPageUnavailable();
                }
                return;
            }

            if (installedControllers.has(controller)) {
                // Fastmail may rebuild its groups; the entry goes back if so.
                ensureSettingsEntry(found);
            } else {
                try {
                    installSettingsPage(controller, classes, found);
                } catch (error) {
                    settingsPageUnavailable();
                    reportFault('the Fastmail Custom settings page could not be added; using the plain panel', error);
                    return;
                }
                installedControllers.add(controller);
                settingsPageState = 'installed';
            }

            if (openPageWhenInstalled) {
                openPageWhenInstalled = false;
                // Good for one load that landed on this address while
                // Settings was already showing; once the app has moved on,
                // an install finishing late must not follow it there.
                if (router.get('app') === 'settings') {
                    try {
                        controller.go(SETTINGS_PAGE_ID);
                    } catch (error) {
                        reportFault('could not go to the Fastmail Custom settings page', error);
                    }
                }
            }
        } catch (error) {
            reportFault('the Fastmail Custom settings page ran into a problem; the plain panel stands in', error);
            // A controller already installed stays installed: this was one
            // failed refresh, not a reason to give up under someone already
            // looking at the page.
            if (controller && !installedControllers.has(controller)) settingsPageUnavailable();
        }
    };

    const watchSettingsApp = () => {
        const router = FastMail.router;
        if (router && typeof router.addObserverForKey === 'function') {
            router.addObserverForKey('app', {
                check: () => {
                    // Good for one install onto this address; once the app
                    // has moved on to anything but Settings itself loading,
                    // an install finishing late must not follow it there.
                    try {
                        const app = router.get('app');
                        if (app !== 'settings' && app !== 'loading') openPageWhenInstalled = false;
                    } catch (error) {
                        reportFault('could not tell which app is showing', error);
                    }
                    ensureSettingsPage();
                    ensureNotificationsPage();
                    ensureNotificationPreviews();
                }
            }, 'check');
        }
        ensureSettingsPage();
        ensureNotificationsPage();
        ensureNotificationPreviews();
    };

    const openSettings = () => {
        try {
            ensureSettingsPage();
            const router = FastMail.router;
            if (settingsPageState !== 'unavailable' && router &&
                typeof router.restoreEncodedState === 'function') {
                if (settingsPageState === 'waiting') openPageWhenInstalled = true;
                router.restoreEncodedState('settings/' + SETTINGS_PAGE_ID);
                return true;
            }
        } catch (error) {
            // The flag is only good for the install that was about to
            // happen; left true, an unrelated later visit to Settings would
            // be redirected here instead of wherever it meant to go.
            openPageWhenInstalled = false;
            reportFault('could not go to the Fastmail Custom settings page; showing the plain one', error);
        }
        try {
            openFallbackSettings();
            return true;
        } catch (error) {
            reportFault('the plain settings panel would not open either', error);
            return false;
        }
    };

    // Reachable the moment Fastmail's own classes and router exist, well
    // before the mail controller a plain start() waits for: a cold reload
    // straight onto this page must not depend on mail ever having loaded.
    // updateStyles is left to start(): inboxChipRules needs the mailbox
    // store, which is not up yet this early,
    // and rememberStyles would save an incomplete head start for the next
    // launch's own early load. The settings page's own rules need neither,
    // so they go up here instead, through ensureSettingsPageStyles.
    // Guarded so mail finishing later, and start() calling this again,
    // starts nothing twice; each step reports its own fault rather than
    // letting one throw stop the other two.
    let settingsPageStarted = false;

    const startSettingsPage = () => {
        if (settingsPageStarted) return;
        settingsPageStarted = true;
        try {
            ensureSettingsPageStyles();
        } catch (error) {
            reportFault('the settings page could not add its styles', error);
        }
        try {
            watchSettingsApp();
        } catch (error) {
            reportFault('the settings page could not start watching Settings', error);
        }
        try {
            watchSettingsList();
        } catch (error) {
            reportFault('the settings page could not start watching the sidebar list', error);
        }
    };

    /*
     * A list you can put in order. Fastmail's own splits editor already has
     * one — SplitConditionItemView carries the whole drag protocol, mouse and
     * touch — so a row here is one of those, drawing our parts where it would
     * draw a search, and ending in the same "…" menu its rows end in.
     *
     * If that row cannot be made, the rows still list, and still edit and
     * remove, but no longer reorder.
     */

    // An icon-only button draws its label into a span the app's own stylesheet
    // gives no height and no opacity, so one handed no icon is a blank box
    // thirty-six pixels wide. This is the glyph Fastmail's own editor gives
    // the "…" button at the end of each of its rows.
    const MORE_SHAPES = [
        ['circle', { fill: 'currentColor', cx: '12', cy: '12', r: '0.75' }],
        ['circle', { fill: 'currentColor', cx: '18', cy: '12', r: '0.75' }],
        ['circle', { fill: 'currentColor', cx: '6', cy: '12', r: '0.75' }]
    ];

    // The height Fastmail's own editor gives these rows. A dragging list puts
    // each row at its index times this, so no row may grow past it, and the
    // label is truncated rather than left to wrap onto a second line. Nor may
    // a row fall short of it: the rows sit apart by this pitch whatever their
    // own height, so the label is given a button's height to fill out a row
    // with no "…" menu, where the others get there with the menu button.
    const REORDER_ROW_HEIGHT = 49;

    // What `.v-Button > .v-Icon` makes a glyph on the bar.
    const BAR_GLYPH_SIZE = '22px';

    /*
     * A row's Edit and Remove, behind the "…" button Fastmail's own groupings
     * editor ends each of its rows with: the same button, glyph, label and
     * menu. Fastmail's menu is thrown away each time it closes, so a fresh
     * one is made each time it opens; and its row keeps the popover
     * placement the button works out for where it sits on screen, with the
     * menu's right edge against the button's, so this one does too. Without
     * the menu classes, the two are plain buttons on the row instead.
     */
    const rowActions = (classes, item) => {
        const actions = [];
        if (item.edit) actions.push({ label: 'Edit', go: item.edit });
        if (item.remove) actions.push({ label: 'Remove', go: item.remove });
        if (!actions.length) return [];

        const Button = classes.MenuButtonView;
        const Menu = classes.MenuView;
        if (!Button || !Menu) {
            return actions.map(action => new classes.ButtonView({
                type: 'v-Button--subtle v-Button--sizeM',
                label: action.label, target: action, method: 'go'
            }));
        }

        const menu = () => new Menu({
            options: actions.map(action => new classes.ButtonView({
                label: action.label, target: action, method: 'go'
            }))
        });
        return [FastMail.el('div.u-flex', [new Button({
            type: 'v-Button--subtle v-Button--sizeM v-Button--iconOnly v-Button--circular',
            icon: standardIcon('i-morehorizontal', MORE_SHAPES),
            label: 'More',
            destroyMenuViewOnClose: true,
            activate: function () {
                if (!this.get('isActive') && !this.get('isDisabled')) {
                    this.set('menuView', menu());
                    const placed = Button.prototype.popOverOptions;
                    this.popOverOptions = Object.assign({},
                        typeof placed === 'function' ? placed.call(this) : placed,
                        { alignEdge: 'right' });
                }
                return Button.prototype.activate.apply(this, arguments);
            }
        })])];
    };

    const reorderRowParts = (classes, item, draggable) => {
        const el = FastMail.el;
        const parts = [];
        // Fastmail's own grip, so that a row that drags looks like one.
        if (draggable) {
            parts.push(el('div.u-flex-none.u-select-none',
                { style: 'margin-top:-6px;cursor: grab' }, ['⣶']));
        }
        if (item.isDivider) {
            // A dash stands in for the icon a divider has none of, and the
            // label reads subdued, like a hint rather than a verb, so it
            // never competes with the actions it sits among.
            parts.push(el('div.u-flex-none.u-color-unimportant', { style: 'line-height:32px' }, ['—']));
            parts.push(el('div.u-flex-1.u-truncate.u-color-unimportant', { style: 'line-height:32px' }, [item.label]));
        } else {
            // Drawn afresh each time, since a node can be in only one row; a
            // row with no glyph to show carries its name alone. Fastmail's
            // stylesheet sizes an icon only inside the thing holding it, so
            // outside a button this one is given the size a button on the
            // bar gives it.
            const icon = item.icon ? item.icon() : null;
            if (icon) {
                icon.style.width = BAR_GLYPH_SIZE;
                icon.style.height = BAR_GLYPH_SIZE;
                parts.push(el('div.u-flex-none', { style: 'line-height:0' }, [icon]));
            }
            parts.push(el('div.u-flex-1.u-truncate', { style: 'line-height:32px' }, [item.label]));
        }
        return parts.concat(rowActions(classes, item));
    };

    /*
     * The dragging list, assembled the way Fastmail assembles its own, and
     * every piece of it is something the row demands rather than a choice.
     * The row finds where it sits by asking its parent for an index's offset,
     * which only a ListView with a fixed item height answers. It reads the
     * scroll position of the nearest ScrollView above it, and throws on the
     * first drag when there is none. And it reorders by writing sortOrder on
     * the objects it shows, so those must be observable, and the collection
     * holding them must then be sorted by it again.
     *
     * Not a subclass: the helper Fastmail builds its classes with is private
     * to its bundle. Each row is a SplitConditionItemView handed its own
     * draw, setIndex and dragEnded, which take precedence over the ones it
     * inherits.
     *
     * The collection is sorted once setIndex has returned, never from inside
     * it. When two neighbours' sortOrders sit too close, setIndex renumbers
     * the whole list in one pass by position, and a collection that re-sorted
     * on each of those writes moved rows under that pass: a drag across four
     * rows or more landed them in an order nobody chose.
     *
     * The setting is written once a drag is over, and a tick after that. The
     * write redraws this whole list, and a row destroyed inside its own
     * dragEnded is destroyed under a drag that has not finished with it. A
     * write that onOrder refuses redraws nothing, so the rows are put back
     * where they were by hand.
     */
    const reorderDragList = (classes, items, onOrder) => {
        const found = FastMail.classes || {};
        const Row = found.SplitConditionItemView;
        const List = found.ListView;
        const Scroll = found.ScrollView;
        const Collection = found.ObservableArray;
        if ([Row, List, Scroll, Collection].some(Class => typeof Class !== 'function')) return null;

        // Overture's own observable object. The class list leaves it out, but
        // every collection in it descends from it.
        const base = Object.getPrototypeOf(Collection.prototype);
        const Observable = base && base.constructor;
        if (typeof Observable !== 'function') return null;

        try {
            const byId = {};
            items.forEach((item) => { byId[item.id] = item; });

            const records = items.map((item, at) => new Observable({ id: item.id, sortOrder: at }));
            const content = new Collection(records.slice());

            const RowView = function (properties) {
                return new Row(Object.assign({}, properties, {
                    draw: function () {
                        return reorderRowParts(classes, byId[this.get('content').get('id')], true);
                    },
                    setIndex: function (to, from) {
                        Row.prototype.setIndex.call(this, to, from);
                        content.sort((one, other) => one.get('sortOrder') - other.get('sortOrder'));
                    },
                    dragEnded: function (drag) {
                        Row.prototype.dragEnded.call(this, drag);
                        const after = content.map(record => record.get('id'));
                        if (after.some((id, at) => id !== items[at].id)) {
                            setTimeout(() => {
                                if (onOrder(after) !== false) return;
                                records.forEach((record, at) => record.set('sortOrder', at));
                                content.sort((one, other) => one.get('sortOrder') - other.get('sortOrder'));
                            }, 0);
                        }
                    }
                }));
            };

            const list = new List({
                content: content,
                layerTag: 'ul',
                className: 'u-list-body u-list-body--borders',
                ItemView: RowView,
                itemHeight: REORDER_ROW_HEIGHT
            });

            return new Scroll({
                positioning: 'relative',
                layout: { height: items.length * REORDER_ROW_HEIGHT },
                childViews: [list]
            });
        } catch (error) {
            reportFault('could not build a list that drags; the buttons still reorder it', error);
            return null;
        }
    };

    const reorderList = (classes, items, onOrder) => {
        const dragging = reorderDragList(classes, items, onOrder);
        if (dragging) return dragging;

        return new classes.View({
            className: 'u-list-body u-list-body--borders',
            draw: () => items.map(item => new classes.View({
                className: 'u-list-item u-flex u-items-center u-space-x-2',
                draw: () => reorderRowParts(classes, item, false)
            }))
        });
    };

    /*
     * Group presets, as a list. Opening one raises
     * Fastmail's own splits editor, seeded with that grouping instead of a
     * mailbox's: a stand-in controller answers sortSource with an object
     * holding our categories, and catches the save.
     *
     * Nothing here touches a Mailbox record. Fastmail's own Custom… dialog
     * still edits the real per-mailbox splits, and still works.
     */
    const groupingStandIn = (grouping, keep) => {
        const source = {
            get: (key) => {
                if (key === 'splits') {
                    return { categories: grouping.categories, otherName: grouping.otherName };
                }
                return key === 'name' ? grouping.name : null;
            },
            set: (key, value) => {
                if (key === 'splits' && value) keep(value);
                return source;
            }
        };
        const controller = {
            get: (key) => (key === 'sortSource' ? source : null),
            set: () => controller,
            computedPropertyDidChange: () => controller
        };
        return controller;
    };

    /*
     * A dialog put together the way Fastmail puts its own together, as read
     * from its bundle: the view inside a ScrollView that carries the modal's
     * look, and that inside an overlay which passes keys on. Every part does
     * something. The overlay centres what it holds only while its own classes
     * are left alone. The frame is what scrolls a view taller than the window.
     * A row that drags reads the scroll position of the nearest ScrollView
     * above it, and throws when there is none. And a key pressed while nothing
     * in the dialog has focus reaches it only through keyOutside.
     *
     * takeApart is for after the overlay has been hidden, and keeps Fastmail's
     * order: the frame comes out of the overlay first, because a view still in
     * the document cannot be destroyed, and because the overlay would destroy
     * the frame along with itself.
     */
    const framedModal = (classes, view, width, keydown) => {
        const frame = new classes.ScrollView({
            className: 'u-modal',
            positioning: 'relative',
            layout: { width: width },
            childViews: [view]
        });
        const modal = new classes.ModalOverlayView({
            rootView: FastMail.root,
            view: frame,
            keyOutside: (event) => {
                if (event.type !== 'keydown') return;
                keydown(event);
                event.stopPropagation();
            }
        });
        const takeApart = () => {
            try {
                frame.detach();
                modal.destroy();
                frame.destroy();
            } catch (error) {
                reportFault('a dialog did not close cleanly', error);
            }
        };
        return { frame, modal, takeApart };
    };

    // A heading in the groupings editor, over the description that follows it
    const editorSection = (title, description) => FastMail.el('div.u-space-y-3', [
        FastMail.el('h2.u-trim.u-text-xl.u-font-bold', [title]),
        description
    ]);

    /*
     * A grouping's priorities in its editor, as a list built from the parts
     * Fastmail builds its groups list from, as read from its bundle: an
     * ObservableArray of objects each holding a name, a search and a
     * sortOrder, drawn by an AnimatedListView as SplitConditionItemView
     * rows. The row brings its own Edit and Remove and its own dragging,
     * which sets sortOrder on the objects and leaves the sorting to an
     * observer on each, the way Fastmail keeps its own list in order.
     *
     * Add priority opens EditGroupView, the name and search form Fastmail's
     * own Add group opens for Search…, in a popover under the button; the
     * form hands a new entry back through addGroup on the object it is
     * given, which answers everything else from the editor itself.
     *
     * The objects are made with the class Fastmail made the editor's own
     * groups with, taken from its first one, since that class is not among
     * FastMail.classes. Null, with a fault, when any part is missing.
     */
    const priorityRows = (classes, editor, Row, initial) => {
        const parts = FastMail.classes || {};
        const first = editor.get('categories') && editor.get('categories').getObjectAt(0);
        const Item = first && first.constructor;
        if (typeof Item !== 'function' || typeof parts.ObservableArray !== 'function' ||
            typeof parts.AnimatedListView !== 'function' || typeof parts.EditGroupView !== 'function' ||
            typeof parts.PopOverView !== 'function') {
            reportFault('could not show the priorities in the groupings editor');
            return null;
        }

        const el = FastMail.el;
        let list = null;
        const sort = (function () {
            list.set('[]', list.get('[]').slice().sort((a, b) => a.get('sortOrder') - b.get('sortOrder')));
        }).queue('before');
        const item = (one, sortOrder) => new Item({ name: one.name, query: one.query }, {
            sortOrder: sortOrder,
            resort: (function () { sort(); }).observes('sortOrder')
        });
        list = new parts.ObservableArray(initial.map((one, at) => item(one, at)));

        const rows = new parts.AnimatedListView({
            content: list,
            layerTag: 'ul',
            className: 'u-list-body u-list-body--borders',
            ItemView: Row,
            itemHeight: 49
        });
        // An empty list would still draw its borders
        const showRows = () => {
            rows.get('layer').style.display = list.get('length') ? '' : 'none';
        };
        list.addObserverForKey('length', { go: showRows }, 'go');
        showRows();

        const popOver = new parts.PopOverView();
        const add = (button) => {
            const form = new parts.EditGroupView({
                groupSettingsView: {
                    get: key => editor.get(key),
                    addGroup: (filled) => {
                        const query = String(filled.get('query') || '').trim();
                        if (!query) return;
                        const last = list.get('[]').reduce((most, one) => Math.max(most, one.get('sortOrder')), -1);
                        list.push(item({ name: String(filled.get('label') || '').trim(), query: query }, last + 1));
                    }
                }
            });
            // Its Save and Cancel both end in modal:hide, as in Fastmail's own
            form.on('modal:hide', { close: () => popOver.hide() }, 'close');
            popOver.show({
                view: form,
                alignWithView: button,
                positionToThe: 'bottom',
                alignEdge: 'left',
                className: 'v-PopOverContainer--noFlex',
                keepInVerticalBounds: true,
                resistHiding: true,
                onHide() {
                    try {
                        form.destroy();
                    } catch (error) {
                        // Already gone is already gone
                    }
                }
            });
        };
        const addButton = new classes.ButtonView({
            type: 'v-Button--standard v-Button--sizeM',
            label: 'Add priority',
            target: { go: add },
            method: 'go'
        });

        return {
            // Laid out the way Fastmail lays out its own groups above
            draw: () => [
                editorSection('Priorities', el('p.u-trim.u-color-unimportant', [
                    'Within each group, conversations matching the first priority come first, ' +
                    'then those matching the next, then the rest.'
                ])),
                el('div.u-space-y-3', [el('div', [addButton]), rows])
            ],
            value: () => list.map(one => ({ name: one.get('name') || '', query: one.get('query') }))
        };
    };

    /*
     * Fastmail's own editor, in the frame its own Custom… entry uses: its
     * condition rows drag only inside a ScrollView, and its Escape and Enter
     * are answered by its own keyOutside. closed, when given, is called once
     * the dialog has gone, or at once when it cannot open.
     *
     * Two things Fastmail's editor could not do are taught to it for as long
     * as the dialog is open, and put back once it has gone. Its Add group
     * menu offers the two Labels rows after its own Pinned, Unread and
     * Search…, each greyed out once the preset has it, the same way its own
     * are. And a Labels row is drawn with its name and what it stands for in
     * place of the search nobody should read, and its "…" menu keeps Remove
     * but not Edit, since there is nothing in it to edit. The settings page's
     * own lists hand their rows a draw of their own and build their menus
     * without an addGroup or editItem target, so they never reach either.
     */
    const editGrouping = (classes, grouping, done, closed) => {
        const finish = closed || (() => {});
        // Its dialog needs its own two classes; the page that holds the
        // Edit button does not, so they are checked here rather than there.
        const Editor = FastMail.classes && FastMail.classes.GroupSettingsView;
        const Row = FastMail.classes && FastMail.classes.SplitConditionItemView;
        const MenuView = FastMail.classes && FastMail.classes.MenuView;
        if (typeof Editor !== 'function' || typeof Row !== 'function' || typeof MenuView !== 'function' ||
            !classes.ModalOverlayView || !classes.ScrollView) {
            reportFault('Fastmail’s groupings editor is not available here');
            finish();
            return;
        }

        // Fastmail heads its dialog "Groups in" and the mailbox's name. Here
        // the name is the grouping's own and can be changed, so a field takes
        // the heading's place, and its value goes with the save. After
        // Fastmail's own groups come the grouping's priorities, which its
        // dialog knows nothing of, drawn with its own rows; see priorityRows.
        // Each of the two gets a heading over its description, and the
        // priorities are laid out the way Fastmail lays out its groups.
        // Both are read only at Save, since that is the only point Fastmail's
        // own dialog hands anything back. Without the priorities list, a save
        // keeps the priorities the grouping already had.
        let saved = null;
        let priorities = null;
        const nameField = new classes.TextInputView({ label: 'Name', value: grouping.name });
        const controller = groupingStandIn(grouping, (value) => {
            saved = Object.assign({}, value, {
                name: String(nameField.get('value') || '').trim(),
                priorities: priorities ? priorities.value() : (grouping.priorities || [])
            });
        });
        const view = new Editor({
            controller: controller,
            draw: function () {
                const parts = Editor.prototype.draw.apply(this, arguments);
                const field = FastMail.el('div', [nameField]);
                if (parts[0] && parts[0].tagName === 'H1') parts[0] = field;
                else parts.unshift(field);
                // Fastmail's description of groups follows its heading
                const description = parts[1] && parts[1].tagName === 'P' ? parts[1] : null;
                parts.splice(1, description ? 1 : 0, editorSection('Groups', description));
                // Ahead of Save and Cancel, which Fastmail draws last
                if (priorities) parts.splice(Math.max(0, parts.length - 1), 0, ...priorities.draw());
                return parts;
            }
        });
        priorities = priorityRows(classes, view, Row, grouping.priorities || []);

        const el = FastMail.el;
        const hadOwnRowDraw = Object.prototype.hasOwnProperty.call(Row.prototype, 'draw');
        const rowDraw = Row.prototype.draw;
        const menuDraw = MenuView.prototype.draw;
        const putBack = () => {
            if (hadOwnRowDraw) Row.prototype.draw = rowDraw;
            else delete Row.prototype.draw;
            MenuView.prototype.draw = menuDraw;
        };

        // Fastmail's row is the handle, the name, a gap, the search and the
        // menu; a Labels row keeps all of it but the two words. A row drawn
        // some other way than that gets a plain line instead, movable but
        // without a menu, rather than showing its search.
        Row.prototype.draw = function () {
            const content = this.get('content');
            const marker = content && labelsMarkerFor(content.get('query'));
            if (!marker) return rowDraw.apply(this, arguments);

            const parts = rowDraw.apply(this, arguments);
            const isElement = (part) => !!part && part.nodeType === 1;
            if (Array.isArray(parts) && parts.length === 5 && isElement(parts[1]) && isElement(parts[3])) {
                parts[1].textContent = marker.name;
                parts[3].textContent = marker.hint;
                parts[3].title = marker.hint;
                return parts;
            }
            return [
                el('div.u-flex-none.u-select-none', { style: 'margin-top:-6px;cursor: grab' }, ['⣶']),
                el('div.u-flex-1.u-font-bold', { style: 'line-height:32px' }, [marker.name]),
                el('div.u-flex-1.u-truncate.u-color-unimportant', [marker.hint]),
                el('div', { style: 'flex: 0 0 32px' })
            ];
        };

        MenuView.prototype.draw = function () {
            try {
                const options = this.get('options');
                if (Array.isArray(options)) {
                    const target = (option) => option && typeof option.get === 'function' ? option.get('target') : null;
                    const method = (option) => option && typeof option.get === 'function' ? option.get('method') : null;

                    if (options.some(option => target(option) === view && method(option) === 'addGroup') &&
                        !options.some(option => option && option.customLabelsRow)) {
                        const queries = new Set(view.get('categories').map(one =>
                            (typeof one.get === 'function' ? one.get('query') : one.query)));
                        LABELS_MARKERS.forEach((marker) => {
                            // With an icon, as Fastmail's own entries have,
                            // so the names line up with theirs
                            const option = new classes.ButtonView({
                                icon: standardIcon('i-label', LABEL_SHAPES),
                                label: marker.name,
                                query: marker.query,
                                isDisabled: queries.has(marker.query),
                                target: view,
                                method: 'addGroup'
                            });
                            option.customLabelsRow = true;
                            options.push(option);
                        });
                    }

                    for (let at = options.length - 1; at >= 0; at -= 1) {
                        const row = target(options[at]);
                        if (method(options[at]) !== 'editItem' || !(row instanceof Row)) continue;
                        const content = row.get('content');
                        if (content && labelsMarkerFor(content.get('query'))) options.splice(at, 1);
                    }
                }
            } catch (error) {
                reportFault('could not add the Labels rows to the editor', error);
            }
            return menuDraw.apply(this, arguments);
        };

        let dialog;
        try {
            dialog = framedModal(classes, view, 580, event => view.keyOutside(event));
        } catch (error) {
            putBack();
            reportFault('could not open the groupings editor', error);
            finish();
            return;
        }

        // The editor's own Cancel and Save both fire modal:hide; Save has
        // already handed us the value by then.
        view.on('modal:hide', { close: () => dialog.modal.hide() }, 'close');

        // show() settles once the overlay has been hidden.
        dialog.modal.show().then(() => {
            putBack();
            dialog.takeApart();
            finish();
            if (saved) done(saved);
        });
    };

    /*
     * An order taken from a list as it was drawn, laid over the names as they
     * are now. The names the drawn order holds go where it puts them. A name
     * it does not hold arrived since the list was drawn, and follows the rest
     * in the order it already had. A name only the drawn order holds has gone
     * since, and stays gone.
     */
    const mergeOrder = (names, order) => {
        const rank = new Map();
        order.forEach((name, at) => { if (!rank.has(name)) rank.set(name, at); });
        return names.filter(name => rank.has(name))
            .sort((one, other) => rank.get(one) - rank.get(other))
            .concat(names.filter(name => !rank.has(name)));
    };

    const NEW_GROUPING_NAME = 'New group preset';

    /*
     * Nothing here writes from the groupings as they were when the list was
     * drawn: the host can push a new value in while the page is open, so a
     * list drawn a minute ago may show groupings since removed elsewhere and
     * miss ones since added. So each action parses the setting afresh, finds
     * its grouping by name rather than by a position that may have moved, and
     * writes from that.
     */
    const groupingsSection = (classes) => {
        const el = FastMail.el;
        const option = settingFor('groupings');

        // The old Labels grouping among them while it is still kept apart
        const current = () => modeGroupings();
        const named = (groupings, name) => groupings.filter(one => one.name === name)[0] || null;

        const redraw = () => holder.viewNeedsRedraw();
        // The first write takes the old Labels grouping in as a preset, and
        // its old place is marked so it is not added a second time
        const save = (next) => {
            writeSetting('groupings', formatGroupings(next));
            if (!legacyLabelsFolded()) {
                writeSetting('labelsGroupingIndex', LEGACY_LABELS_FOLDED);
                writeSetting('labelsGrouping', '');
            }
            redraw();
        };

        // The Snoozed folder's own grouping drags with the rest; it is not in
        // the setting the others live in, so where it lands is kept on its own
        const SNOOZE_ROW = '\u0000snooze-return';

        const reorder = (order) => {
            const now = current();
            const merged = mergeOrder(now.map(one => one.name).concat([SNOOZE_ROW]), order);
            const at = merged.indexOf(SNOOZE_ROW);
            writeSetting('snoozeGroupAt', String(at === -1 ? merged.length : at));
            save(merged.filter(name => name !== SNOOZE_ROW).map(name => named(now, name)));
        };

        const remove = (name) => {
            const now = current();
            if (!named(now, name)) {
                redraw();
                return;
            }
            save(now.filter(one => one.name !== name));
        };

        // The editor is seeded with the grouping as it stands at the press,
        // and its save is laid over the setting as it stands at the save. A
        // grouping renamed or deleted in between is not brought back.
        const edit = (name) => {
            const seed = named(current(), name);
            if (!seed) {
                redraw();
                return;
            }
            editGrouping(classes, seed, (value) => {
                // Saved down to nothing, it would vanish from the list at the
                // next parse; removing it is the list's job, and says so.
                if (!value.categories || !value.categories.length) {
                    reportFault('a grouping needs at least one group; remove “' + name +
                        '” from the list instead');
                    return;
                }
                const now = current();
                const at = now.map(one => one.name).indexOf(name);
                if (at === -1) {
                    reportFault('“' + name + '” is no longer in your groupings, so its edit was not saved');
                    redraw();
                    return;
                }
                // A name another grouping already has would have the parser
                // drop this one at the next read, so it keeps its own.
                let newName = value.name || name;
                if (newName !== name && named(now, newName)) {
                    reportFault('a grouping called “' + newName + '” already exists, so “' + name +
                        '” kept its name');
                    newName = name;
                }
                now[at] = {
                    id: SPLIT_PREFIX + newName, name: newName,
                    categories: value.categories, otherName: value.otherName || OTHER_NAME,
                    priorities: value.priorities || []
                };
                save(now);
            });
        };

        // A name no grouping has yet: of two groupings sharing a name the
        // parser keeps the first and drops the second without a word, so a
        // second Add under the same name would add nothing.
        const add = () => {
            const now = current();
            let name = NEW_GROUPING_NAME;
            for (let count = 2; named(now, name); count += 1) name = NEW_GROUPING_NAME + ' ' + count;
            save(now.concat([{
                id: SPLIT_PREFIX + name, name: name,
                categories: [{ name: 'Pinned', query: 'is:pinned' }],
                otherName: OTHER_NAME,
                priorities: []
            }]));
        };

        const holder = new classes.View({
            className: 'u-space-y-3',
            draw: () => {
                // Drawn from, and never written from.
                const groupings = current();

                // Names alone, as the snooze presets show theirs; the groups
                // are for each one's Edit dialog.
                const items = groupings.map(one => ({
                    id: one.name,
                    label: one.name,
                    edit: () => edit(one.name),
                    remove: () => remove(one.name)
                }));

                // Its groups are a list of their own, under Snooze, and it is
                // offered in no other mailbox; so it is renamed rather than
                // edited here, and nothing removes it.
                items.splice(snoozeGroupingAt(items.length), 0, {
                    id: SNOOZE_ROW,
                    label: el('span.u-flex.u-items-center.u-space-x-2', [
                        el('span.u-truncate', [snoozeGroupingName()]),
                        el('span.u-flex-none.u-color-unimportant.u-text-sm',
                            { style: 'font-style: italic' }, [SNOOZE_ONLY_NOTE])
                    ]),
                    edit: () => renameGrouping(classes, snoozeGroupingName(), (name) => {
                        writeSetting('snoozeGroupName', name);
                        redraw();
                    })
                });

                const list = reorderList(classes, items, reorder);

                const addButton = new classes.ButtonView({
                    type: 'v-Button--standard v-Button--sizeM',
                    label: 'Add a group preset',
                    target: { go: add },
                    method: 'go'
                });

                return [
                    el('h3.u-trim.u-font-bold', [option.title]),
                    list,
                    addButton,
                    el('p.u-trim.u-text-sm.u-color-unimportant', [option.hint])
                ];
            }
        });

        return holder;
    };

    /*
     * The bar's verbs, in the order the bar takes them, with a divider laid
     * over the same list: everything above it is drawn on this device's own
     * bar, everything from it down goes under More. orderedSlots already
     * turns the setting into a complete list — it lowercases, renames the
     * old "file" to "keep", drops what it does not know and appends what the
     * saved value failed to mention — so nothing new is needed to read the
     * verbs themselves.
     *
     * The divider is a row like any other in the same drag list, so dragging
     * a verb past it moves the verb in or out of view, and dragging the
     * divider itself changes the count directly; both write through the
     * same order. Its own id never becomes part of bottomBarSlots — only the
     * count it lands at does, in bottomBarItems or topBarItems.
     *
     * Only one of the two counts is this device's own: bottomBarItems is the
     * phone's, topBarItems is the iPad's and the Mac's. Asked as "is this the
     * phone layout" rather than "is this a tablet": isTablet is false on the
     * Mac as well, which had the Mac's page editing the phone's count while
     * its own bar, across the top, read the other. The other count still
     * exists and still syncs; a device
     * it belongs to shows and edits it from its own settings page instead.
     */
    const ownBarDivider = () => (isPhoneLayout()
        ? { id: '__fastmailCustomBarDivider', settingKey: 'bottomBarItems' }
        : { id: '__fastmailCustomBarDivider', settingKey: 'topBarItems' });
    const DIVIDER_LABEL = 'Separator (below in Menu)';

    // Where a count from the setting lands among the verbs: clamped to the
    // list's own length, and every verb when the setting is empty or
    // unreadable, matching what the bar itself falls back to.
    const dividerCount = (names, raw) => {
        const count = parseInt(String(raw == null ? '' : raw).trim(), 10);
        return count >= 0 ? Math.max(0, Math.min(count, names.length)) : names.length;
    };

    /*
     * Lays dividers over an ordered list of ids at their target counts.
     * Spliced in from the highest target down, so an earlier insertion never
     * shifts where a not-yet-placed, lower target belongs — inserting at a
     * higher index first leaves every lower index exactly where it was.
     * Two dividers sharing a target insert in the order given; since each is
     * spliced into the position the previous one now sits at, the one given
     * later ends up first (the lower index, the one shown above).
     */
    const withDividers = (names, dividers) => {
        const ids = names.slice();
        dividers
            .map((divider, order) => Object.assign({}, divider, { order }))
            .sort((one, other) => (other.at - one.at) || (other.order - one.order))
            .forEach((divider) => { ids.splice(divider.at, 0, divider.id); });
        return ids;
    };

    // The reverse of withDividers: from a combined order, the verb-only
    // order and each divider's new count — how many verbs sit before it.
    const splitDividers = (order, names, dividerIds) => {
        const isVerb = (id) => names.indexOf(id) !== -1;
        const verbOrder = order.filter(isVerb);
        const counts = {};
        dividerIds.forEach((id) => {
            const at = order.indexOf(id);
            counts[id] = at === -1 ? verbOrder.length : order.slice(0, at).filter(isVerb).length;
        });
        return { verbOrder, counts };
    };

    const barSlotsSection = (classes) => {
        const el = FastMail.el;
        const option = settingFor('bottomBarSlots');

        const holder = new classes.View({
            className: 'u-space-y-3',
            draw: () => {
                const names = orderedSlots();
                const pretty = (name) => name.charAt(0).toUpperCase() + name.slice(1);

                const divider = ownBarDivider();

                const itemById = {};
                names.forEach((name) => {
                    itemById[name] = { id: name, label: pretty(name), icon: () => slotIcon(name), edit: null, remove: null };
                });
                itemById[divider.id] = {
                    id: divider.id, label: DIVIDER_LABEL, isDivider: true,
                    icon: null, edit: null, remove: null
                };

                // Laid over the order as it is at the press, not as drawn:
                // the host can push a new one in while the page is open.
                const at = dividerCount(names, settings[divider.settingKey]);
                const order = withDividers(names, [Object.assign({}, divider, { at })]);
                const items = order.map(id => itemById[id]);

                const list = reorderList(classes, items, (order) => {
                    const { verbOrder, counts } = splitDividers(order, names, [divider.id]);
                    writeSetting('bottomBarSlots', mergeOrder(orderedSlots(), verbOrder).map(pretty).join(', '));
                    writeSetting(divider.settingKey, String(counts[divider.id]));
                    holder.viewNeedsRedraw();
                });
                return [
                    el('h3.u-trim.u-font-bold', [option.title]),
                    list,
                    el('p.u-trim.u-text-sm.u-color-unimportant', [option.hint])
                ];
            }
        });

        return holder;
    };

    // Edited in a dialog of its own, the same shell editGrouping's own
    // editor sits in (framedModal, read off Fastmail's bundle) - just with
    // three plain fields as its content instead of Fastmail's splits
    // editor, which three short fields have no use for.
    const editSnoozePreset = (classes, preset, done, fields) => {
        if (!classes.ModalOverlayView || !classes.ScrollView ||
            !classes.TextInputView || !classes.ButtonView) {
            reportFault('the preset dialog is not available here');
            return;
        }

        const el = FastMail.el;
        let saved = null;

        const nameField = new classes.TextInputView({ placeholder: 'Name', value: preset.name });
        const dateField = new classes.TextInputView({
            placeholder: 'today, tomorrow, +4h, 2w, or YYYY-MM-DD', value: preset.date
        });
        const timeField = new classes.TextInputView({ placeholder: 'HH:MM', value: preset.time });

        const field = (label, input) => el('div.u-space-y-1', [
            el('div.u-text-sm.u-color-unimportant', [label]), input
        ]);

        const save = () => {
            const name = (nameField.get('value') || '').trim();
            saved = {
                name: name || preset.name,
                date: (dateField.get('value') || '').trim(),
                time: (timeField.get('value') || '').trim()
            };
            view.fire('modal:hide');
        };
        const cancel = () => view.fire('modal:hide');

        const view = new classes.View({
            className: 'u-p-6 u-space-y-5',
            draw: () => [
                el('h1.u-trim.u-font-bold', ['Edit preset']),
                el('div.u-space-y-3', [
                    field('Name', nameField),
                    field((fields && fields.date) || 'Date', dateField),
                    field((fields && fields.time) || 'Time', timeField)
                ]),
                el('div.u-flex.u-space-x-2', [
                    new classes.ButtonView({
                        type: 'v-Button--cta v-Button--sizeM', label: 'Save',
                        target: { go: save }, method: 'go'
                    }),
                    new classes.ButtonView({
                        type: 'v-Button--standard v-Button--sizeM', label: 'Cancel',
                        target: { go: cancel }, method: 'go'
                    })
                ])
            ],
            keyOutside: (event) => {
                if (event.type !== 'keydown') return;
                if (event.key === 'Enter') save();
                else if (event.key === 'Escape') cancel();
            }
        });

        const dialog = framedModal(classes, view, 420, event => view.keyOutside(event));
        view.on('modal:hide', { close: () => dialog.modal.hide() }, 'close');

        dialog.modal.show().then(() => {
            dialog.takeApart();
            if (saved) done(saved);
        });
    };

    // The one grouping that is renamed rather than edited: its groups live
    // in a list of their own, and it cannot be removed.
    const renameGrouping = (classes, current, done, title) => {
        if (!classes.ModalOverlayView || !classes.TextInputView || !classes.ButtonView) {
            reportFault('the rename dialog is not available here');
            return;
        }

        const el = FastMail.el;
        let saved = null;
        const nameField = new classes.TextInputView({ placeholder: 'Name', value: current });

        const save = () => {
            saved = (nameField.get('value') || '').trim() || current;
            view.fire('modal:hide');
        };
        const cancel = () => view.fire('modal:hide');

        const view = new classes.View({
            className: 'u-p-6 u-space-y-5',
            draw: () => [
                el('h1.u-trim.u-font-bold', [title || 'Rename group preset']),
                el('div.u-space-y-1', [
                    el('div.u-text-sm.u-color-unimportant', ['Name']), nameField
                ]),
                el('div.u-flex.u-space-x-2', [
                    new classes.ButtonView({
                        type: 'v-Button--cta v-Button--sizeM', label: 'Save',
                        target: { go: save }, method: 'go'
                    }),
                    new classes.ButtonView({
                        type: 'v-Button--standard v-Button--sizeM', label: 'Cancel',
                        target: { go: cancel }, method: 'go'
                    })
                ])
            ],
            keyOutside: (event) => {
                if (event.type !== 'keydown') return;
                if (event.key === 'Enter') save();
                else if (event.key === 'Escape') cancel();
            }
        });

        const dialog = framedModal(classes, view, 420, event => view.keyOutside(event));
        view.on('modal:hide', { close: () => dialog.modal.hide() }, 'close');
        dialog.modal.show().then(() => {
            dialog.takeApart();
            if (saved) done(saved);
        });
    };

    const NEW_SNOOZE_PRESET_NAME = 'New preset';

    /*
     * A list of presets, snooze or reminder (`key` names the setting), a
     * drag-reorderable list built the same way groupingsSection builds its
     * own (reorderList, names as ids, a dialog to edit one, discrete
     * add/remove/reorder actions that read the setting fresh and write it
     * back whole).
     *
     * "Choose a date and time…", and for reminders "No reminder", are drawn
     * last, always, and are not part of the setting at all - see
     * addSnoozePresets, which appends them itself whenever the menu is
     * actually built - so there is nothing here for them to move, edit or
     * remove.
     */
    const ADD_LABELS = {
        snoozePresets: 'Add a snooze preset',
        reminderPresets: 'Add a reminder preset',
        snoozeGroups: 'Add a snooze group preset'
    };

    // A group reaches to a time rather than naming one, so its dialog asks
    // for the time it reaches to and does not need one of its own
    const PRESET_FIELDS = {
        snoozeGroups: { date: 'Up to', time: 'Time (optional)' }
    };

    const presetListSection = (classes, key) => {
        const el = FastMail.el;
        const option = settingFor(key);

        const named = (presets, name) => presets.filter(one => one.name === name)[0] || null;

        const redraw = () => holder.viewNeedsRedraw();
        const save = (presets) => {
            writeSetting(key, formatSnoozePresets(presets));
            redraw();
        };

        const reorder = (order) => {
            const now = parseSnoozePresets(settingValue(key));
            save(mergeOrder(now.map(one => one.name), order).map(name => named(now, name)));
        };

        const remove = (name) => {
            const now = parseSnoozePresets(settingValue(key));
            save(now.filter(one => one.name !== name));
        };

        // A name no preset has yet, the same dedup groupingsSection's own
        // add() uses for "New grouping".
        const add = () => {
            const now = parseSnoozePresets(settingValue(key));
            let name = NEW_SNOOZE_PRESET_NAME;
            for (let count = 2; named(now, name); count += 1) name = NEW_SNOOZE_PRESET_NAME + ' ' + count;
            const seed = key === 'snoozeGroups'
                ? { date: '7d', time: '' }
                : { date: 'today', time: '08:00' };
            save(now.concat([{ name: name, date: seed.date, time: seed.time }]));
        };

        const edit = (name) => {
            const now = parseSnoozePresets(settingValue(key));
            const seed = named(now, name);
            if (!seed) {
                redraw();
                return;
            }
            editSnoozePreset(classes, seed, (value) => {
                const then = parseSnoozePresets(settingValue(key));
                const at = then.map(one => one.name).indexOf(name);
                if (at === -1) {
                    reportFault('“' + name + '” is no longer in ' + option.title.toLowerCase() + ', so its edit was not saved');
                    redraw();
                    return;
                }
                then[at] = value;
                save(then);
            }, PRESET_FIELDS[key]);
        };

        const holder = new classes.View({
            className: 'u-space-y-3',
            draw: () => {
                // Drawn from, and never written from.
                const presets = parseSnoozePresets(settingValue(key));

                // The name alone; its Date and Time are for its Edit dialog.
                const items = presets.map(one => ({
                    id: one.name,
                    label: one.name,
                    edit: () => edit(one.name),
                    remove: () => remove(one.name)
                }));

                const list = reorderList(classes, items, reorder);

                /*
                 * What the menu, or the list, puts after the rows themselves.
                 * Drawn as the rows above are, without a grip, since nothing
                 * orders them; the ones that are a wording of ours carry an
                 * Edit, and Fastmail's own picker entry carries none.
                 */
                const wording = (setting, fallback) => ({
                    label: settingValue(setting) || fallback,
                    edit: () => renameGrouping(classes, settingValue(setting) || fallback, (value) => {
                        writeSetting(setting, value);
                        redraw();
                    }, 'Rename')
                });
                const trailing = key === 'snoozeGroups'
                    ? [wording('snoozeGroupsOther', SNOOZE_OTHER_NAME)]
                    : [{ label: CHOOSE_SNOOZE_DATE_LABEL }].concat(
                        key === 'reminderPresets' ? [wording('reminderNoneLabel', NO_REMINDER_LABEL)] : []);

                const customRow = new classes.View({
                    className: 'u-list-body u-list-body--borders',
                    draw: () => trailing.map(one => new classes.View({
                        className: 'u-list-item u-flex u-items-center u-space-x-2',
                        draw: () => reorderRowParts(classes, {
                            id: one.label,
                            label: el('span.u-color-unimportant', [one.label]),
                            edit: one.edit
                        }, false)
                    }))
                });

                const addButton = new classes.ButtonView({
                    type: 'v-Button--standard v-Button--sizeM',
                    label: ADD_LABELS[key] || 'Add a preset',
                    target: { go: add }, method: 'go'
                });

                return [
                    el('h3.u-trim.u-font-bold', [option.title]),
                    el('div', [list, customRow]),
                    addButton,
                    el('p.u-trim.u-text-sm.u-color-unimportant', [option.hint])
                ];
            }
        });

        return holder;
    };

    // Four options are lists rather than fields; everything else is a row.
    const sectionRow = (classes, option, register) => {
        if (option.key === 'groupings') return groupingsSection(classes);
        if (option.key === 'bottomBarSlots') return barSlotsSection(classes);
        if (option.key === 'snoozePresets' || option.key === 'reminderPresets' ||
                option.key === 'snoozeGroups') {
            return presetListSection(classes, option.key);
        }
        return settingRow(classes, option, register);
    };

    /*
     * The panel without Fastmail. With the native settings screens gone, a
     * deploy that renames one of the view classes would otherwise leave no
     * way to change a setting at all; this is the same options, drawn in
     * plain HTML, so that failure costs the drag-and-drop and nothing else.
     *
     * Deliberately dull. It is not meant to be nice, it is meant to be there.
     */
    const FALLBACK_ID = 'fastmail-custom-fallback-settings';

    const openFallbackSettings = () => {
        if (document.getElementById(FALLBACK_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = FALLBACK_ID;

        const sheet = document.createElement('div');
        sheet.className = 'fastmail-custom-fallback-sheet';

        const heading = document.createElement('h1');
        heading.textContent = SETTINGS_PAGE_TITLE;
        sheet.appendChild(heading);

        const note = document.createElement('p');
        note.className = 'fastmail-custom-fallback-note';
        note.textContent = 'Fastmail’s own controls are unavailable in this ' +
            'version, so these are plain ones. Everything still saves.';
        sheet.appendChild(note);

        // Every text field gets its own debouncedWrite rather than one
        // timer shared across the sheet: typing into a second field within
        // the delay must not cost the first field its pending save, and
        // closing has to flush every one of these, not just the last.
        const flushers = [];

        SETTING_GROUPS.forEach((group) => {
            const rows = settingsInGroup(group.id);
            if (!rows.length) return;

            const title = document.createElement('h2');
            title.textContent = group.title;
            sheet.appendChild(title);

            rows.forEach((option) => {
                const current = settingValue(option.key);
                const row = document.createElement('label');
                row.className = 'fastmail-custom-fallback-row';

                const input = typeof current === 'boolean'
                    ? document.createElement('input')
                    : document.createElement(option.multiline ? 'textarea' : 'input');
                if (typeof current === 'boolean') {
                    input.type = 'checkbox';
                    input.checked = current;
                    input.addEventListener('change', () => writeSetting(option.key, input.checked));
                } else {
                    if (input.tagName === 'INPUT') input.type = 'text';
                    else input.rows = 10;
                    input.value = String(current);
                    input.spellcheck = false;
                    const debounced = debouncedWrite();
                    flushers.push(debounced.flush);
                    input.addEventListener('input', () => debounced.write(option.key, input.value));
                }

                const text = document.createElement('span');
                const name = document.createElement('span');
                name.className = 'fastmail-custom-fallback-title';
                name.textContent = option.title;
                const hint = document.createElement('span');
                hint.className = 'fastmail-custom-fallback-hint';
                hint.textContent = option.hint;
                text.appendChild(name);
                text.appendChild(hint);

                row.appendChild(input);
                row.appendChild(text);
                sheet.appendChild(row);
            });
        });

        const close = () => {
            // Whatever is mid-debounce in any field is spent now, on the key
            // and value that field captured when typed, before the field
            // itself is gone.
            flushers.forEach((flush) => flush());
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
        };
        const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };

        const done = document.createElement('button');
        done.type = 'button';
        done.textContent = 'Done';
        done.addEventListener('click', close);
        sheet.appendChild(done);

        overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
        document.addEventListener('keydown', onKey, true);

        // The overlay is plain DOM outside Fastmail's view tree, but
        // Fastmail's own shortcuts still listen at the document: without
        // this, typing "e" to rename something here would also archive
        // whatever message is open behind the panel. Stopped here, at the
        // overlay, rather than on each field, so a key nothing above has
        // claimed still cannot leak out; the field itself still gets the
        // event first; blocking only stops it travelling further.
        ['keydown', 'keypress', 'keyup'].forEach((type) => {
            overlay.addEventListener(type, (event) => event.stopPropagation());
        });

        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    };

    /*
     * Fastmail's own Settings screen is where someone goes looking, so a
     * copied row sits there too, for when the real entry could not be
     * installed. The shells add a "Device settings" row to the same list
     * from harness.js; this one is the userscript's own row, with its own
     * class and label, so the two can coexist on the phone without fighting
     * over which is present. Unlike harness.js's row, this one is not
     * skipped under Electron: harness.js's own settings still open from the
     * app menu there, but once the native tabs are gone this copied row is
     * the only fallback into these settings on the Mac too.
     *
     * Found the way harness.js finds it, since Fastmail names this list
     * nothing more specific than any other source list: every
     * ul.v-Sources-list is walked, and the one accepted is whichever holds
     * both a "Custom swipes" row and an "Offline" row, compared with
     * whitespace collapsed and lower-cased so a stray line break or a
     * differently-cased label still matches.
     */
    const SETTINGS_ROW_CLASS = 'fastmail-custom-settings-row';

    const collapseText = (text) => String(text == null ? '' : text).replace(/\s+/g, ' ').trim();

    const settingsSourceList = () => {
        const lists = document.querySelectorAll('ul.v-Sources-list');
        for (let i = 0; i < lists.length; i += 1) {
            let swipes = null;
            let offline = null;
            Array.prototype.forEach.call(lists[i].children, (li) => {
                const link = li.querySelector('a.app-source');
                if (!link) return;
                const text = collapseText(link.textContent).toLowerCase();
                if (text === 'custom swipes') swipes = li;
                if (text === 'offline') offline = li;
            });
            if (swipes && offline) return { list: lists[i], swipes, offline };
        }
        return null;
    };

    // Fastmail gives this list an inline pixel height for its collapse
    // animation, row count times one row's height; an inserted row overflows
    // that height and the next section's heading laps the last row.
    const fixListHeight = (list, sample) => {
        if (!/px\s*$/.test(list.style.height)) return;
        const rowHeight = sample ? sample.offsetHeight : 0;
        if (rowHeight > 0) list.style.height = (list.children.length * rowHeight) + 'px';
    };

    const dressSettingsList = () => {
        ensureSettingsPage();
        ensureNotificationsPage();
        ensureNotificationPreviews();
        const found = settingsSourceList();
        if (!found) return;
        const { list, swipes, offline } = found;
        const copied = list.querySelector('.' + SETTINGS_ROW_CLASS);

        // The list is on screen, so Settings has loaded; a controller that is
        // still not there to install into is as good as missing.
        if (settingsPageState === 'waiting') settingsPageUnavailable();

        // With the page installed, the entry Fastmail draws is the way in,
        // and a copy left from before would put the entry in the list twice.
        if (settingsPageState === 'installed') {
            if (copied) {
                (copied.closest('li') || copied).remove();
                fixListHeight(list, swipes);
            }
            return;
        }

        if (copied) {
            fixListHeight(list, swipes);
            return;
        }

        const clone = swipes.cloneNode(true);
        clone.removeAttribute('id');
        const link = clone.querySelector('a') || clone;
        link.classList.remove('is-selected');
        link.classList.add(SETTINGS_ROW_CLASS);
        link.setAttribute('href', '#');
        link.removeAttribute('title');

        const label = link.querySelector('span');
        if (label) label.textContent = SETTINGS_PAGE_TITLE;
        else link.appendChild(document.createTextNode(SETTINGS_PAGE_TITLE));

        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openFallbackSettings();
        });

        list.insertBefore(clone, offline.nextSibling);
        fixListHeight(list, swipes);
    };

    const watchSettingsList = () => {
        let scheduled = false;
        const run = () => { scheduled = false; dressSettingsList(); };
        new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(run, 100);
        }).observe(document.documentElement, { childList: true, subtree: true });
        run();
    };

    /*
     * ----------------------------------------------------------------
     * A way through to the browser's own menu
     * ----------------------------------------------------------------
     */

    /*
     * Fastmail answers contextmenu and cancels it, which is how it draws its
     * own menu on a message row; but it answers on the document, for every
     * element, so the browser's menu never appears anywhere on the page. In
     * a browser that costs little, since the inspector is reachable from the
     * menu bar regardless. In the shell apps it costs everything: they have
     * no Develop menu, so with the page swallowing the event there is no
     * Inspect Element and no console.
     *
     * Firefox's convention, then; Shift held means the page does not get
     * this one. Taken in the capture phase on the window, which is before
     * anything registered on the document, and only stopped rather than
     * cancelled: WebKit then does what it would have done with a right-click
     * nobody answered, which is to draw its own menu, Inspect Element and
     * all. A plain right-click still reaches Fastmail and still opens the
     * menu it draws for the row under the pointer.
     */
    const passContextMenuThrough = () => {
        window.addEventListener('contextmenu', (event) => {
            if (event.shiftKey) event.stopPropagation();
        }, true);
    };

    /*
     * The labels every new message goes out with, from sentLabel. Fastmail's
     * compose keeps its Labels menu as a Set of mailboxes on the controller,
     * filled from the message it opens (or just Drafts for a blank one), and
     * both the draft and the sent copy carry that Set; so ticking the labels
     * there as the controller opens is the same as picking them from the
     * menu, and they can be unticked the same way. Replies, forwards and
     * reopened drafts are left as they are; "asNew" is a template or Edit as
     * new, which is a new message too.
     *
     * The class's init is its constructor, so a patch on prototype.init never
     * runs. The constructor's last step before drawing is startAutoSave, with
     * mode and mailboxes already set; later calls (retain, a failed send)
     * come after the user has had the menu, so only the first one counts.
     *
     * Installed as soon as the classes are up rather than from start(): a
     * compose window of its own has no sidebar, so it never reaches isReady.
     */
    const NEW_MESSAGE_MODES = ['blank', 'asNew'];

    const patchCompose = () => {
        const ComposeController = FastMail.classes.ComposeController;
        if (!ComposeController) return;
        const proto = ComposeController.prototype;
        if (proto.customSentLabel) return;
        proto.customSentLabel = true;

        const originalStartAutoSave = proto.startAutoSave;
        proto.startAutoSave = function () {
            if (!this.customSentLabelDone) {
                this.customSentLabelDone = true;
                openComposers.add(this);
                try {
                    if (NEW_MESSAGE_MODES.indexOf(this.mode) !== -1 && this.mailboxes) {
                        pathsFromSetting(settingValue('sentLabel')).forEach((path) => {
                            const label = findByPath(this.accountId, path);
                            if (label) this.mailboxes.add(label);
                        });
                    }
                } catch (error) {
                    reportFault('could not add the label for sent mail', error);
                }
            }
            return originalStartAutoSave.apply(this, arguments);
        };

        const originalDrawToolbarButtons = proto.drawToolbarButtons;
        if (typeof originalDrawToolbarButtons === 'function') {
            proto.drawToolbarButtons = function () {
                const parts = originalDrawToolbarButtons.apply(this, arguments);
                try {
                    addReminderButton(this, parts);
                } catch (error) {
                    reportFault('could not add the reminder button', error);
                }
                return parts;
            };
        }

        const originalDestroy = proto.destroy;
        proto.destroy = function () {
            openComposers.delete(this);
            return originalDestroy.apply(this, arguments);
        };

        patchSubmission();
    };

    /*
     * Reminders for sent mail nobody answers. A message goes out marked with
     * two keywords, REMIND_KEYWORD and the moment to come back after
     * REMIND_AT_PREFIX, in seconds since the epoch. Once it is in Sent, the
     * mailbox window snoozes it there (sweepReminders), swapping
     * REMIND_KEYWORD for REMINDING_KEYWORD; the push server takes it out of
     * Snoozed again when a reply arrives (Server/src/reminders.js). The
     * snooze is set here because Fastmail keeps `snoozed` from API tokens,
     * which the server has; leaving Snoozed clears it, which the server may
     * do.
     *
     * The marks ride on the submission's own onSuccess patch, the one that
     * takes $draft off as the message is sent, so they land exactly when it
     * goes, after an undo-send wait or at a scheduled time, and a send that
     * is undone or fails never carries them to Sent.
     *
     * Each open compose window has a choice: undefined takes the default
     * from the settings, counted from when the message goes out; null is no
     * reminder; a Date is one picked from the toolbar.
     */
    const REMIND_KEYWORD = '$fmc-remind';
    const REMIND_AT_PREFIX = '$fmc-remind-';
    const REMINDING_KEYWORD = '$fmc-reminding';
    // A moment already gone still comes back, a minute from now
    const REMINDER_OVERDUE_MS = 60 * 1000;
    // Scheduled mail reaches Sent with nothing else changing, so the sweep
    // also runs this often
    const REMINDER_SWEEP_MS = 5 * 60 * 1000;

    // The compose controllers open in this page, to find the one a
    // submission comes from
    const openComposers = new Set();

    const isReplyCompose = (composer) => {
        const inReplyTo = composer.get('inReplyTo');
        return !!(inReplyTo && inReplyTo.length);
    };

    const defaultReminder = (composer) =>
        settingValue(isReplyCompose(composer) ? 'remindReplies' : 'remindNewMessages');

    // A reminder preset by name, or a Date @ Time written the way a preset's
    // is; `named` says which
    const reminderPreset = (spec) => {
        const text = String(spec || '').trim();
        if (!text) return null;
        const named = parseSnoozePresets(settings.reminderPresets)
            .find(preset => preset.name.toLowerCase() === text.toLowerCase());
        if (named) return { preset: named, named: true };
        const written = parseSnoozePresets('Reminder = ' + text)[0];
        return written ? { preset: written, named: false } : null;
    };

    // When the message is to come back, or null for no reminder
    const reminderMoment = (composer) => {
        const chosen = composer.customReminder;
        if (chosen === null) return null;
        if (chosen) return chosen;
        const found = reminderPreset(defaultReminder(composer));
        if (!found) return null;
        const base = composer._scheduleSend ? new Date(composer._scheduleSend) : new Date();
        const target = snoozePresetTarget(base, found.preset);
        return target.getTime() > base.getTime() ? target : null;
    };

    // The choice, in words: a preset's name, or when
    const reminderSummary = (composer) => {
        const moment = reminderMoment(composer);
        if (!moment) return noReminderLabel();
        if (composer.customReminder) {
            return composer.customReminderName || snoozePresetRightText(new Date(), moment);
        }
        const found = reminderPreset(defaultReminder(composer));
        return found && found.named ? found.preset.name : snoozePresetRightText(new Date(), moment);
    };

    // An alarm clock, drawn the way Fastmail's own toolbar icons are
    const REMINDER_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="u-standardicon">' +
        '<circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 14 15"/>' +
        '<line x1="5" y1="3" x2="2" y2="6"/><line x1="22" y1="6" x2="19" y2="3"/>' +
        '<line x1="6.38" y1="18.7" x2="4" y2="21"/><line x1="17.64" y1="18.67" x2="20" y2="21"/></svg>';

    const reminderIcon = () => {
        const svg = document.importNode(
            new DOMParser().parseFromString(REMINDER_ICON, 'image/svg+xml').documentElement, true);
        svg.setAttribute('role', 'presentation');
        svg.classList.add('v-Icon', 'i-reminder');
        return svg;
    };

    const reminderButtonLabel = (composer) => 'Remind: ' +
        (reminderMoment(composer) ? reminderSummary(composer) : 'Off');

    /*
     * The reminder sits on compose's own toolbar, just after Schedule send:
     * a labelled button on a wide layout, an icon on the phone's, its label
     * the tooltip. drawToolbarButtons hands back what the toolbar's view is
     * drawing, so the button is made with Fastmail's own element builder,
     * which makes it a child of that view, and then moved into place beside
     * Schedule send (or Send, where there is no Schedule send).
     */
    // `composerOf` answers the message the button is for: always the same
    // one on a wide layout, whichever is being written on the phone
    const reminderButton = (composerOf, type) => {
        let button = null;
        const label = () => {
            const composer = composerOf();
            return composer ? reminderButtonLabel(composer) : 'Remind';
        };
        // Set or not, in the button's own class as well as its label
        const showState = () => {
            const composer = composerOf();
            const set = !!(composer && reminderMoment(composer));
            button.set('type', type + (set ? ' custom-reminder-set' : ''));
            const layer = button.get('layer');
            if (layer) layer.classList.toggle('custom-reminder-set', set);
        };
        const choose = (menu, choice, name) => {
            const composer = composerOf();
            if (composer) {
                composer.customReminder = choice;
                composer.customReminderName = name || '';
            }
            button.set('label', label());
            showState();
            menu.hide();
        };
        button = new FastMail.classes.MenuButtonView({
            type: type + (composerOf() && reminderMoment(composerOf()) ? ' custom-reminder-set' : ''),
            icon: reminderIcon(),
            label: label(),
            destroyMenuViewOnClose: true,
            menuView: function () {
                return new FastMail.classes.FutureTimeMenuView({
                    customPresetsKey: 'reminderPresets',
                    title: 'Remind me if nobody replies',
                    lastCustomKey: 'lastUsedReminderDelta',
                    didSelect(date, name) {
                        choose(this, new Date(date), name);
                    },
                    customNoReminder() {
                        choose(this, null);
                    }
                });
            }.property().nocache()
        });
        button.customReminderButton = true;
        button.customRelabel = () => {
            button.set('label', label());
            showState();
        };
        // The layer exists only once it is drawn
        setTimeout(showState, 0);
        return button;
    };

    const addReminderButton = (composer, parts) => {
        const group = parts && parts[0];
        if (!(group instanceof Element) || group.querySelector('.i-reminder')) return;
        const beside = group.querySelector('.v-Button--mergeLeft') || group.querySelector('.s-send');
        if (!beside) return;
        const type = 'v-Button--subtleStandard v-Button--sizeM u-ml-2' +
            (isPhoneLayout() ? ' v-Button--iconOnly v-Button--tooltipLabel' : '');
        const holder = FastMail.el('div', [reminderButton(() => composer, type)]);
        if (holder.firstElementChild) beside.after(holder.firstElementChild);
    };

    /*
     * The phone draws compose's header from a fixed list of buttons, and its
     * build never calls drawToolbarButtons, so there the button goes in
     * beside the header's own Schedule send, an icon like it, once a
     * message is being written. The header is shared by every message, so
     * the button asks the mail controller which one that is.
     */
    let phoneReminderButton = null;

    const addPhoneReminderButton = () => {
        const mail = controller();
        const composer = mail.get('draft');
        if (!composer) return false;
        if (phoneReminderButton && phoneReminderButton.get('isInDocument')) {
            phoneReminderButton.customRelabel();
            return true;
        }
        const MenuButton = FastMail.classes.MenuButtonView;
        const schedule = Array.prototype.map.call(document.querySelectorAll('button'), node => FastMail.getViewFromNode(node))
            .filter(view => view instanceof MenuButton && view.get('shortcut') === 'Cmd-Shift-Enter')[0];
        const parent = schedule && schedule.get('parentView');
        if (!parent) return false;
        phoneReminderButton = reminderButton(() => mail.get('draft'), 'v-Button--iconOnly');
        parent.insertView(phoneReminderButton, schedule, 'before');
        return true;
    };

    const watchPhoneCompose = () => {
        if (!isPhoneLayout()) return;
        // The header is drawn a moment after the message is set
        const attempt = (left) => {
            try {
                if (addPhoneReminderButton() || !left) return;
            } catch (error) {
                reportFault('could not add the reminder button', error);
                return;
            }
            setTimeout(() => attempt(left - 1), 150);
        };
        controller().addObserverForKey('draft', { go: () => attempt(20) }, 'go');
        attempt(20);
    };

    const markReminder = (submission) => {
        const onSuccess = submission.get('onSuccess');
        // No patch means the message is destroyed once sent; nothing to mark
        if (!onSuccess || typeof onSuccess !== 'object') return;
        const message = submission.get('message');
        if (!message) return;
        const storeKey = message.get('storeKey');
        const composer = [...openComposers].find((one) => {
            const own = one.get('message');
            return own && own.get('storeKey') === storeKey;
        });
        if (!composer) return;

        const patch = Object.assign({}, onSuccess);
        // A draft sent before, and undone, may still carry an old mark
        Object.keys(message.get('keywords') || {}).forEach((keyword) => {
            if (keyword === REMIND_KEYWORD || keyword.indexOf(REMIND_AT_PREFIX) === 0) {
                patch['keywords/' + keyword] = null;
            }
        });
        const moment = reminderMoment(composer);
        if (moment) {
            patch['keywords/' + REMIND_KEYWORD] = true;
            patch['keywords/' + REMIND_AT_PREFIX + Math.floor(moment.getTime() / 1000)] = true;
        }
        submission.set('onSuccess', patch);
    };

    // The moment a message asks to come back, or null; the latest if several
    const reminderAt = (keywords) => Object.keys(keywords || {}).reduce((latest, keyword) => {
        if (!keywords[keyword] || keyword.indexOf(REMIND_AT_PREFIX) !== 0) return latest;
        const seconds = keyword.slice(REMIND_AT_PREFIX.length);
        if (!/^\d+$/.test(seconds)) return latest;
        const moment = new Date(Number(seconds) * 1000);
        return !latest || moment > latest ? moment : latest;
    }, null);

    const jmapDate = (date) => date.toISOString().replace(/\.\d+Z$/, 'Z');

    // Marked messages that have reached Sent are snoozed there, to come back
    // to the Inbox unread. Several windows and devices may sweep at once;
    // they all write the same thing.
    let reminderSweepTimer = null;
    let reminderSweeping = false;

    const sweepReminders = async () => {
        reminderSweepTimer = null;
        if (reminderSweeping) return;
        const accountId = controller().get('accountId');
        const byRole = (role) => mailboxesOf(accountId).filter(m => m.get('role') === role)[0];
        const sent = byRole('sent');
        const snoozed = byRole('snoozed');
        const inbox = byRole('inbox');
        if (!sent || !snoozed || !inbox) return;
        reminderSweeping = true;
        try {
            const found = await FastMail.callJMAPMethod('Email/query', {
                accountId,
                filter: {
                    operator: 'AND',
                    conditions: [
                        { inMailbox: sent.get('id') },
                        { hasKeyword: REMIND_KEYWORD },
                        { operator: 'NOT', conditions: [{ inMailbox: snoozed.get('id') }] }
                    ]
                },
                limit: 50
            });
            if (!found.ids.length) return;
            const got = await FastMail.callJMAPMethod('Email/get', {
                accountId, ids: found.ids, properties: ['keywords']
            });
            const soonest = Date.now() + REMINDER_OVERDUE_MS;
            const update = {};
            got.list.forEach((email) => {
                const at = reminderAt(email.keywords);
                if (!at) return;
                update[email.id] = {
                    ['mailboxIds/' + snoozed.get('id')]: true,
                    snoozed: {
                        until: jmapDate(new Date(Math.max(at.getTime(), soonest))),
                        moveToMailboxId: inbox.get('id'),
                        setKeywords: { $seen: false }
                    },
                    ['keywords/' + REMIND_KEYWORD]: null,
                    ['keywords/' + REMINDING_KEYWORD]: true
                };
            });
            if (Object.keys(update).length) {
                await FastMail.callJMAPMethod('Email/set', { accountId, update });
            }
        } catch (error) {
            // Offline, or the server said no: the next sweep tries again
            console.warn('Fastmail Custom: reminders not set yet', error);
        } finally {
            reminderSweeping = false;
        }
    };

    // The mailbox window sweeps; a window of its own closes too soon to
    // see its message reach Sent
    const scheduleReminderSweep = () => {
        if (isMinimalWindow) return;
        if (reminderSweepTimer) clearTimeout(reminderSweepTimer);
        reminderSweepTimer = setTimeout(sweepReminders, 3000);
    };

    const watchReminders = () => {
        if (isMinimalWindow) return;
        FastMail.store.on(FastMail.classes.Message, { go: scheduleReminderSweep }, 'go');
        setInterval(scheduleReminderSweep, REMINDER_SWEEP_MS);
        scheduleReminderSweep();
    };

    /*
     * A message sent from a window of its own is announced to the mailbox
     * window, which loads its EmailSubmission to show the Sent toast and its
     * Undo. Windows of their own run without the offline worker, so the
     * worker here has never seen that submission and answers notFound: the
     * load failed and the toast never came. Requests that only read
     * submissions go to the server directly, the way they do with offline
     * mode off; cancelling one still goes through the worker, which handles
     * it.
     */
    const patchSubmissionFetch = () => {
        if (isMinimalWindow || typeof IDBTransaction === 'undefined') return;
        const source = FastMail.store && FastMail.store.source;
        const connections = (source && (source.sources || source.get('sources'))) || [];
        connections.forEach((connection) => {
            const original = connection.sendRequest;
            if (typeof original !== 'function' || connection.customSubmissionFetch) return;
            connection.customSubmissionFetch = true;
            connection.sendRequest = function (request) {
                const calls = request && request.methodCalls;
                const onlySubmissions = !!(calls && calls.length) &&
                    calls.every(call => call[0] === 'EmailSubmission/get');
                if (!onlySubmissions) return original.apply(this, arguments);
                return fetch(FastMail.auth.get('apiUrl'), {
                    method: 'POST',
                    mode: 'cors',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: FastMail.auth.get('authHeaderValue')
                    },
                    body: JSON.stringify(request)
                }).then((response) => {
                    if (!response.ok) throw new Error('EmailSubmission/get: HTTP ' + response.status);
                    return response.json();
                });
            };
        });
    };

    const patchSubmission = () => {
        const Submission = FastMail.classes.MessageSubmission;
        if (!Submission || Submission.prototype.customReminder) return;
        Submission.prototype.customReminder = true;

        const original = Submission.prototype.saveToStore;
        Submission.prototype.saveToStore = function () {
            try {
                markReminder(this);
            } catch (error) {
                reportFault('could not set the reminder for sent mail', error);
            }
            return original.apply(this, arguments);
        };
    };

    const start = () => {
        passContextMenuThrough();
        patchCompose();
        patchSubmissionFetch();
        patchBadgeRendering();
        patchDrop();
        patchMailboxMenu();
        patchArchive();
        patchLabelActions();
        patchMenus();
        patchRowContextMenu();
        patchSplits();
        patchListSort();
        guardListRedraw();
        patchShortcuts();
        updateStyles();
        installAppBadge();
        startSettingsPage();
        reportAccountWhenKnown();

        // A rotation, a split view or a window dragged narrower all change
        // how many verbs fit on the bar
        let redressTimer = null;
        window.addEventListener('resize', () => {
            if (redressTimer) clearTimeout(redressTimer);
            redressTimer = setTimeout(() => {
                redressTimer = null;
                refreshToolbar();
            }, 150);
        });

        bindOptionShortcuts();
        addObservers();
        watchMailboxListTitles();

        // The bar's list and the groupings are cached, and were worked out
        // before the observers above could see anything
        updateStyles();
        refreshOwnedConfigs();
        refresh();
        refreshGroupings();
        scheduleMidnight();
        applyStickyFilter();
        updateFloatingNav();
        adoptList();
        watchGroupCounts();
        watchSnoozeCounts();
        watchSnoozeSort();
        watchMailboxSummaryList();
        refreshMailboxSummary();
        watchReminders();
        watchPhoneCompose();

        // Handy from the console, and how the counts can be checked by hand
        window.fastmailCustom = {
            refresh,
            countFor,
            sourcesAboveLabels,
            goToSourceAt,
            settings: () => settings,
            parseGroupings,
            groupingFor,
            currentGroupingId,
            chooseGrouping,
            openSettings,
            // What a failed list redraw threw, for reading back later
            redrawFaults: () => redrawFaults.slice(),
            // Called by the extension when the settings change, so options take
            // effect without a reload
            applySettings: (next) => {
                settings = resolveSettings(next);
                // Turning the chip setting off makes every remembered "hide"
                // wrong, not just this view's
                forgetHide();
                // The label names may have changed
                forgetLabelCache();
                refreshGroupings();
                scheduleMidnight();
                // A query per label is worth running only while something
                // reads it, so turning the setting off stops them
                if (!settings.filteredLabelCounts) forgetInboxCounts();
                applyStickyFilter();
                // The verb keys, the bar slots and the app badge are
                // settings too, and the bar's list is cached until asked again
                refreshOwnedConfigs();
                reclaimKeys();
                refreshToolbar();
                installAppBadge();
                updateStyles();
                updateInboxLabelVisibility();
                refresh();
                // The host sets its sync switch's state before each push
                refreshSyncRow();
            }
        };

        console.log('Fastmail Custom running');
    };

    // What startSettingsPage needs, and no more; checked the same defensive
    // way isReady is, since a half-built FastMail can throw on a property
    // that is not there yet. Fastmail's own classes and router are up long
    // before mail is, so this passes well ahead of isReady.
    const settingsPageCanStart = () => {
        try {
            return !!(
                window.FastMail &&
                FastMail.router && typeof FastMail.router.getAppController === 'function' &&
                FastMail.classes &&
                typeof FastMail.el === 'function' &&
                document.body
            );
        } catch (error) {
            return false;
        }
    };

    // The account is reported as soon as the settings page can start, since a
    // load straight onto Settings may never reach start()
    const mainObserver = new MutationObserver(() => {
        if (settingsPageCanStart()) {
            startSettingsPage();
            reportAccountWhenKnown();
            patchCompose();
        }
        if (!isReady()) return;
        mainObserver.disconnect();
        start();
    });

    if (settingsPageCanStart()) {
        startSettingsPage();
        reportAccountWhenKnown();
        patchCompose();
    }

    if (isReady()) {
        start();
    } else {
        mainObserver.observe(document.body, { attributes: true, childList: true, subtree: true });
    }

})();
