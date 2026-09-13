// ==UserScript==
// @name         Fastmail Custom mode
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
Fastmail Custom mode
Maarten den Braber <m@mdbraber.com>

One-label triage for Fastmail: a project label is the live state of a
message, and archive means the same thing in every list.

Licensed under the GNU Affero General Public License, version 3 or later.
*/

(function () {
    'use strict';

    // Injection can happen more than once, an injector racing a reload, or a
    // manual load on top of an existing copy.
    if (window.customMode) {
        console.log('Custom mode: already loaded');
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

    // Where the on/off state is remembered across reloads
    const STORAGE_KEY = 'custom-mode';
    // What it was called before the mode was renamed, read once so a mode
    // switched off stays off.
    const LEGACY_STORAGE_KEY = 'custom-inbox-mode';
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
    const STYLE_ID = 'custom-mode-style';
    // What the extension's document_start script replays on the next load, so
    // Fastmail's first paint is already styled. Read by early.js as well.
    const EARLY_KEY = 'custom-mode-early';
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
        // The groupings offered in Fastmail's Group menu beyond its own five
        // and the automatic Labels one. A block each: a line naming it, then
        // indented Name = search lines, then a bare line for the rest.
        groupings: 'by age (urgent first)\n  Triage = in:Triage OR is:unread\n  Pinned = is:pinned\n  Today = date:today\n  Yesterday = date:yesterday\n  This week = after:1w\n  This month = after:1m\n  Older',
        // Filing steps on to the next message only while that message is
        // still in triage; the run is over otherwise, and the list is where
        // it ends.
        backToListAfterTriage: true,
        // The label a rule puts on everything incoming. Taken off by keeping
        // or filing; the script never adds it.
        triageLabel: 'Triage',
        // w opens Fastmail's own snooze dialog filled in for this far ahead,
        // a count and d, w or m, at this time of day
        snoozeKey: 'w',
        snoozeDefault: '2w',
        snoozeTime: '08:00',
        // The pin-toggle key, in Fastmail's own key spelling.
        urgentKey: 's',
        // The action bar's verbs, as one ordered list over all of them: the
        // bar takes as many leading ones as fit; More always keeps a slot,
        // and the rest wait inside More, in the same order. One list for
        // every bar there is; along the bottom on a phone, across the top of
        // a message on a tablet and on the Mac.
        bottomBarSlots: 'Snooze, Pin, Keep, Archive, Labels, Move, Delete',
        // How many of them are drawn rather than measured for, one count per
        // bar; empty leaves the bar measuring, which is what it did before
        // either was asked for
        bottomBarItems: '',
        topBarItems: '',
        // Shown in the sidebar but worked as piles, not queues: never filed
        // into, never stripped by archive
        excludedLabels: 'Later, Feedbin',
        // Labels that file the sender as well as the message: adding one, from
        // any menu, by typing, or by drag, adds from[0] to the contact group
        // of the same name, making the contact, and the group, if either is
        // new.
        contactGroupLabels: '',
        // The app icon's badge, for the shell apps: this label's total, Triage
        // is what is left to decide.
        appBadgeLabel: 'Triage',
        swapArchiveExpand: true,
        sidebarSeparators: true,
        hideLoneExpando: true
    };

    // Named here, ahead of localSettings, so that writeSetting's own
    // local-storage fallback further down the file reads and writes the same
    // key rather than a second spelling of it.
    const LOCAL_SETTINGS_KEY = 'custom-mode-settings';

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

    let settings = Object.assign(
        {},
        DEFAULT_SETTINGS,
        window.__customModeSettings || localSettings()
    );

    /*
     * ----------------------------------------------------------------
     * The option catalogue
     * ----------------------------------------------------------------
     *
     * Canonical, and the only one. The settings page is drawn from this, and
     * neither host holds a copy: the apps and the extension handle the
     * customMode. namespace without knowing what is in it, so adding an
     * option means adding one entry here and nothing anywhere else.
     *
     * The default is not repeated: DEFAULT_SETTINGS above already carries all
     * twenty-seven, and settingValue reads it from there.
     */
    const SETTING_GROUPS = [
        { id: 'general', title: 'General' },
        { id: 'appearance', title: 'Appearance' },
        { id: 'labelsFiling', title: 'Labels & keeping' },
        { id: 'grouping', title: 'Groups' },
        { id: 'snooze', title: 'Snooze' },
        { id: 'keyboard', title: 'Keyboard' },
        { id: 'bottomBar', title: 'Action bar' }
    ];

    const SETTINGS = [
        {
            key: 'appBadgeLabel', group: 'general', clearable: true,
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
            title: 'Show only the label’s own name',
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
            key: 'contactGroupLabels', group: 'labelsFiling', clearable: true,
            title: 'Labels that add the sender to a contact group',
            hint: 'Applying one adds the sender to the contact group of the same name, creating it if needed. Comma-separated paths.'
        },
        {
            key: 'backToListAfterTriage', group: 'labelsFiling',
            title: 'Back to the list when triage runs out',
            hint: 'Keeping steps to the next message only while that message still carries the triage label; otherwise the message list comes back.'
        },
        {
            key: 'dragAdditive', group: 'labelsFiling',
            title: 'Dragging adds a label',
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
            title: 'Filter a project label to the Inbox',
            hint: 'Its list opens showing only what is still in the Inbox, since that is the queue and the rest is history. Turning the filter off holds while you stay on that label.'
        },
        {
            key: 'filteredLabelCounts', group: 'labelsFiling',
            title: 'Count only what is in the Inbox',
            hint: 'A project label’s badge counts the same messages its filtered list shows, rather than everything it has ever held.'
        },
        {
            key: 'groupings', group: 'grouping', clearable: true, multiline: true,
            title: 'Your groupings',
            hint: 'One block each: a line naming the grouping, then indented “Name = search” lines, then a bare line for everything else. Fastmail’s own search syntax, so an unrecognised word becomes a text search rather than an error. Renaming a grouping loses it on the mailboxes using it.'
        },
        {
            key: 'snoozeKey', group: 'snooze',
            title: 'Snooze key',
            hint: 'Opens the snooze dialog with the default period filled in.'
        },
        {
            key: 'snoozeDefault', group: 'snooze',
            title: 'Default snooze period',
            hint: 'A number and d, w or m for days, weeks or months, such as 2w.'
        },
        {
            key: 'snoozeTime', group: 'snooze',
            title: 'Snooze time of day',
            hint: 'When a snoozed message returns, as HH:MM.'
        },
        {
            key: 'urgentKey', group: 'keyboard',
            title: 'Pin key',
            hint: 'Pins or unpins the selection.'
        },
        {
            key: 'swapArchiveExpand', group: 'keyboard',
            title: 'Swap E and Y',
            hint: 'E archives and Y expands, the reverse of Fastmail’s default. H still archives.'
        },
        {
            key: 'bottomBarSlots', group: 'bottomBar',
            title: 'Action bar actions',
            hint: 'In order; the bar along the bottom on iPhone, and across the top of a message on iPad and the Mac. What fits shows, the rest go under More.'
        },
        {
            key: 'bottomBarItems', group: 'bottomBar', clearable: true,
            title: 'Items on the bottom bar',
            hint: 'How many verbs the bar along the bottom of the screen draws before More. Empty fits as many as it can measure.'
        },
        {
            key: 'topBarItems', group: 'bottomBar', clearable: true,
            title: 'Items on the top bar',
            hint: 'The same count for the bar across the top of a message, on iPad and on the Mac. Empty fits as many as it can measure.'
        }
    ];

    const settingFor = (key) => SETTINGS.filter(one => one.key === key)[0] || null;

    const settingsInGroup = (group) => SETTINGS.filter(one => one.group === group);

    /*
     * What a stored value means. These rules used to live in Swift, in
     * CustomModeSettings.current; they move here with the catalogue, because
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
        document.documentElement.dataset.customModeHost === 'extension';

    const writeSetting = (key, value) => {
        settings[key] = resolveSetting(key, value);

        if (window.native && typeof window.native.setSetting === 'function') {
            window.native.setSetting(key, value);
            return;
        }

        if (hostIsExtension()) {
            window.postMessage(
                { source: 'custom-mode', kind: 'setting', key: key, value: value },
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
     * ----------------------------------------------------------------
     * State
     * ----------------------------------------------------------------
     */

    let modeIsOn = false;

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
        if (error !== undefined) console.warn('Custom mode: ' + what, error);
        else console.warn('Custom mode: ' + what);

        if (faultsReported.has(what)) return;
        faultsReported.add(what);

        try {
            const host = notifications();
            // Long enough to read and dismissible, since it is not routine
            if (host) host.toast('Custom mode: ' + what, 8000, true);
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

    // Which class a view is. FastMail.classes is keyed by the Name every class
    // declares, so the class object itself can be had and asked about ; which
    // beats comparing constructor.name to a string twice over: a subclass
    // answers yes, and nothing depends on the minifier having kept the
    // constructor's function name, which is a property nobody promised.
    const isViewOfClass = (view, name) => {
        if (!view || !view.constructor) return false;

        const Class = FastMail.classes && FastMail.classes[name];
        if (Class) return view instanceof Class;

        return view.constructor.name === name;
    };

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
        if (settings.filteredLabelCounts && modeIsOn && isProject(mailbox)) {
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

    // Run fn while our count stands in for the mailbox's badge count.
    const withInboxCount = (mailbox, fn) => {
        const stock = mailbox.badgeCount;
        mailbox.badgeCount = countFor(mailbox);
        try {
            return fn();
        } finally {
            mailbox.badgeCount = stock;
        }
    };

    // Triage and the projects show their totals; a helper label keeps whatever Fastmail draws
    const managesBadge = (mailbox) => modeIsOn && !!mailbox &&
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
        // The colours are part of the mode, not of Fastmail
        if (!settings.labelColours || !modeIsOn) return [];

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

    // The fallback panel's own styles, added once by ensureSettingsPageStyles
    // rather than run through updateStyles: the plain panel can be opened
    // with the mode off (openFallbackSettings does not check it) and before
    // mail has ever loaded, so these rules must not wait on either.
    const FALLBACK_PANEL_RULES = [
        '#custom-mode-fallback-settings {' +
        ' position: fixed; inset: 0; z-index: 2147483000;' +
        ' display: flex; align-items: flex-start; justify-content: center;' +
        ' padding: 24px; overflow-y: auto; background: rgba(0, 0, 0, 0.4); }',
        '.custom-mode-fallback-sheet {' +
        ' width: 100%; max-width: 620px; padding: 20px 24px;' +
        ' border-radius: 10px; background: Canvas; color: CanvasText;' +
        ' color-scheme: light dark;' +
        ' font: 14px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }',
        '.custom-mode-fallback-row {' +
        ' display: flex; gap: 9px; align-items: flex-start; padding: 9px 0;' +
        ' border-top: 1px solid rgba(128, 128, 128, 0.3); }',
        '.custom-mode-fallback-row input[type="text"],' +
        ' .custom-mode-fallback-row textarea {' +
        ' display: block; width: 100%; box-sizing: border-box; font: inherit; }',
        '.custom-mode-fallback-row textarea {' +
        ' font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }',
        '.custom-mode-fallback-title { display: block; font-weight: 500; }',
        '.custom-mode-fallback-hint { display: block; opacity: 0.7; }',
        '.custom-mode-fallback-note { opacity: 0.7; }'
    ];

    // A sub-option on the settings page while the option it depends on is
    // off. Fastmail's own disabled switch greys only its control, and its
    // stylesheet has no class that dims a label and hint along with it; half
    // is what its own disabled menu entries use. Added once by
    // ensureSettingsPageStyles, alongside the fallback panel's own rules,
    // for the same reason: the page opens with the mode off too, and before
    // mail has ever loaded.
    const SUB_OPTION_DIMMED = 'custom-mode-dimmed';
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
            .concat(BADGE_UNREAD_RULES)
            .concat(TRIAGE_ICON_RULES)
            .concat(TOAST_RULES)
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

        const hide = modeIsOn && settings.hideInboxLabel && inboxOnly;

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
     * anywhere: "labels", built from the label tree, and one per block of
     * settings.groupings, under the id "split:" and its name.
     *
     * A value Fastmail does not know is safe in that sort: its own
     * calculateSplits returns null for one, no category sort is built, and
     * the list simply shows ungrouped. So an account opened in the official
     * app loses the grouping and nothing else.
     */

    const LABELS_GROUPING = 'labels';
    const SPLIT_PREFIX = 'split:';

    // Everything the list falls into that no group claimed. Fastmail's own
    // wording for the same bucket.
    const OTHER_NAME = 'Other';

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
     * reopening the first or derailing everything after it.
     *
     * A block with no groups yet is returned like any other, and every other
     * non-blank line the reading throws away is listed beside the blocks: all
     * of a block whose name was already taken, a group line missing its name
     * or its search, and a bucket name that a later one in the same block
     * replaced. The settings page needs both. Its list writes the text back
     * from what the text parses to, so any of these would be deleted by that
     * write, most likely from under someone still typing them.
     */
    const readGroupingBlocks = (text) => {
        const groupings = [];
        const discarded = [];
        const taken = {};
        let current = null;
        // Whether the open block is the one kept under its name, and the
        // bucket line it has named so far.
        let kept = false;
        let bucketLine = null;

        String(text || '').split('\n').forEach((raw) => {
            const line = raw.trim();

            if (!line) {
                current = null;
                return;
            }

            const indented = /^\s/.test(raw);
            const divider = line.indexOf('=');

            if (!current || (!indented && divider === -1)) {
                // A name already taken still opens a scratch grouping, so its
                // lines are consumed rather than falling through and being
                // read as the start of a grouping of their own.
                const id = SPLIT_PREFIX + line;
                current = {
                    id: id,
                    name: line,
                    categories: [],
                    otherName: OTHER_NAME
                };
                kept = !taken[id];
                bucketLine = null;
                if (kept) {
                    taken[id] = true;
                    groupings.push(current);
                } else {
                    discarded.push({ line: line, grouping: line, reason: 'duplicate' });
                }
                return;
            }

            if (!kept) discarded.push({ line: line, grouping: current.name, reason: 'duplicate' });

            if (divider === -1) {
                if (kept && bucketLine !== null) {
                    discarded.push({ line: bucketLine, grouping: current.name, reason: 'replaced' });
                }
                bucketLine = line;
                current.otherName = line;
                return;
            }

            const name = line.slice(0, divider).trim();
            const query = line.slice(divider + 1).trim();
            if (name && query) {
                current.categories.push({ name: name, query: query });
            } else if (kept) {
                discarded.push({ line: line, grouping: current.name, reason: 'unfinished' });
            }
        });

        return { blocks: groupings, discarded: discarded };
    };

    // The groupings the text defines. A block with no groups is dropped, since
    // a grouping that groups nothing is a menu entry that does nothing.
    const parseGroupings = (text) => readGroupingBlocks(text).blocks.filter(one => one.categories.length);

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
        (one.categories || []).forEach((category) => {
            lines.push('  ' + category.name + ' = ' + category.query);
        });
        if (one.otherName && one.otherName !== OTHER_NAME) lines.push('  ' + one.otherName);
        return lines.join('\n');
    }).join('\n\n');

    const modeGroupings = () => parseGroupings(settings.groupings);

    /*
     * A group per label under this one.
     *
     * Built as filters rather than searches, so no query has to be written or
     * parsed and two labels with the same leaf name cannot be confused. Plain
     * membership: Fastmail's labels do not inherit, and keeping under a
     * nested label already puts every label above it on, so mail filed by
     * this mode lands under its own heading. Mail filed before that rule, or
     * labelled from Fastmail's own menu, carries the leaf alone and falls
     * into Other, which is where it should be visible rather than hidden.
     */
    const labelsGrouping = (mailbox) => {
        if (!mailbox || !mailbox.get) return null;

        const children = mailboxesOf(mailbox.get('accountId'))
            .filter(other => parentOf(other) === mailbox &&
                isSidebarLabel(other) && !isTriage(other))
            .sort((a, b) => (a.get('sortOrder') || 0) - (b.get('sortOrder') || 0));

        if (!children.length) return null;

        return {
            id: LABELS_GROUPING,
            name: 'labels',
            categories: children.map(child => ({
                name: child.get('name'),
                filter: { inMailbox: child.get('id') }
            })),
            otherName: OTHER_NAME
        };
    };

    // The Inbox groups by the labels at the top level, which are nobody's
    // children; every other mailbox by its own.
    const groupingParent = (mailbox) =>
        mailbox && mailbox.get('role') === 'inbox' ? null : mailbox;

    const labelsGroupingFor = (mailbox) => {
        if (!mailbox || !mailbox.get) return null;
        const under = groupingParent(mailbox);
        if (under) return labelsGrouping(under);

        const roots = mailboxesOf(mailbox.get('accountId'))
            .filter(other => !parentOf(other) && isUserLabel(other) &&
                isSidebarLabel(other) && !isTriage(other))
            .sort((a, b) => (a.get('sortOrder') || 0) - (b.get('sortOrder') || 0));

        if (!roots.length) return null;

        return {
            id: LABELS_GROUPING,
            name: 'labels',
            categories: roots.map(root => ({
                name: root.get('name'),
                filter: { inMailbox: root.get('id') }
            })),
            otherName: OTHER_NAME
        };
    };

    const groupingFor = (id, mailbox) => {
        if (!id) return null;
        if (id === LABELS_GROUPING) return labelsGroupingFor(mailbox);
        if (id.indexOf(SPLIT_PREFIX) !== 0) return null;
        return modeGroupings().filter(one => one.id === id)[0] || null;
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
        return id === LABELS_GROUPING || id.indexOf(SPLIT_PREFIX) === 0;
    };

    const modeGroupingIsActive = () => {
        if (!modeIsOn || !sortNamesModeGrouping()) return null;
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
        const sortField = sort[sort.length - 1];
        if (!sortField) return;

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
     * A definition built from filters already, which Labels is, needs none
     * of that and is returned as it stands.
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
        const parsed = definition.categories.length > 0 &&
            definition.categories.every(one => one.filter);
        if (parsed) {
            return {
                categories: definition.categories,
                otherName: definition.otherName
            };
        }

        return original.call(standInFor(mailController, definition));
    };

    const patchSplits = () => {
        const mailController = controller();
        if (mailController.customGroupings) return;
        mailController.customGroupings = true;

        const original = mailController.calculateSplits;

        mailController.calculateSplits = function () {
            try {
                const definition = modeGroupingIsActive();
                if (definition) return splitsFor(this, original, definition);
            } catch (error) {
                reportFault('could not build the groups', error);
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
     * expensive thing available, so this asks first whether the tree the
     * Labels grouping actually reads has moved, and calls refreshGroupings
     * only when the signature of what it would build has changed. A grouping
     * the user wrote reads no label tree, so it needs no mailbox-driven
     * refresh at all, which the currentGroupingId check gives for free.
     */
    let lastLabelGroups = '';

    const refreshLabelGroups = () => {
        try {
            if (currentGroupingId() !== LABELS_GROUPING) return;
            const grouping = labelsGroupingFor(controller().get('mailbox'));
            const signature = grouping
                ? grouping.categories.map(one => one.filter.inMailbox + ':' + one.name).join('|')
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
    const GROUPING_STORE_KEY = 'custom-mode-groups';

    const foldedGroups = () => {
        try {
            return JSON.parse(localStorage.getItem(GROUPING_STORE_KEY)) || {};
        } catch (error) {
            return {};
        }
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
     * what was folded here last time.
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

            list.collapsedGroups.clear();
            remembered.forEach(index => list.collapsedGroups.add(index));

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
     * groupings too, so the watch is attached separately and unconditionally,
     * unlike adoptList, rather than gated on modeIsOn. With the mode off and
     * a mode grouping still named in the sort, stock Fastmail draws nothing
     * for it, so there is no stock behaviour for the mode being off to fall
     * back to, and the watch has to keep running to catch the same drift.
     */
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
        if (!modeIsOn || !settings.stickyInboxFilter) return;

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

    const SNOOZE_SHORTCUT = 'b';

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

    // The bar's spellings of the verbs Fastmail has no button for: keep a
    // tray, snooze for a while a clock.
    const STATE_VERB_SHAPES = {
        // An arrow going down into an open tray. It was a tick in a circle,
        // which is the mark for done, and done is Archive, two buttons along.
        keep: [
            ['line', { x1: '12', y1: '4.4', x2: '12', y2: '13.6' }],
            ['polyline', { points: '7.6 9.2 12 13.6 16.4 9.2' }],
            ['polyline', { points: '5.2 12.6 5.2 19.6 18.8 19.6 18.8 12.6' }]
        ],
        snooze: [
            ['circle', { cx: '12', cy: '12', r: '7.75' }],
            ['polyline', { points: '12 7.81 12 12 14.93 13.47' }]
        ]
    };

    const stateVerbIcon = (kind) => standardIcon('i-' + kind, STATE_VERB_SHAPES[kind]);

    // Dispatched a tick later so the More popover has finished closing: Keep
    // sends an unfiled conversation to the Labels sheet, and two menus
    // fighting over the same moment is how taps get eaten
    const stateVerbOption = (label, kind) => {
        const run = kind === 'snooze'
            ? () => setTimeout(openSnoozeDialog, 0)
            : () => setTimeout(() => runVerb('keep', null), 0);

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
     * How many verbs fit.
     *
     * The bar can measure its own buttons; it is how the wide layout decides
     * what to show, and measuring is a request: measureViews draws them once
     * off-screen and writes every width down. So the answer can be counted
     * rather than estimated, one real width at a time against the real space,
     * with room kept for More.
     *
     * A thumb-sized slot is the fallback, for before the measuring has
     * happened or for a name that has no width on file. It is only ever an
     * estimate: these buttons are not all one width, and none of them is this
     * width; they measure 64 and 75 on the phone this was guessed for. Which
     * is why it is the fallback and not the rule.
     */
    const SLOT_WIDTH = 76;

    const barWidth = (toolbar) => {
        try {
            const layer = toolbar.get('layer');
            if (layer && layer.offsetWidth) return layer.offsetWidth;
        } catch (error) {
            // Not drawn yet
        }
        return window.innerWidth || 375;
    };

    // Written down once per bar, and again if the buttons are redrawn at a
    // different size. Cheap, and nothing else reads a layout while it runs.
    const measureBar = (toolbar) => {
        try {
            if (typeof toolbar.measureViews === 'function') toolbar.measureViews();
        } catch (error) {
            reportFault('could not measure the bar', error);
        }
    };

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

    // The count asked for, or nothing when the setting is empty and the bar
    // should go on measuring for itself. A number that is not one is nothing:
    // half a button is not an answer, and neither is none at all.
    const askedBarItems = (toolbar) => {
        const raw = barIsAtTop(toolbar) ? settings.topBarItems : settings.bottomBarItems;
        const count = parseInt(String(raw == null ? '' : raw).trim(), 10);
        return count > 0 ? count : 0;
    };

    const barCapacity = (toolbar, names) => {
        // A count that was asked for beats one that was measured
        const asked = askedBarItems(toolbar);
        if (asked) return asked;

        const width = barWidth(toolbar);
        const widths = toolbar && toolbar._widths;

        if (names && widths && widths.overflow) {
            let room = width - widths.overflow;
            try {
                room -= toolbar.get('minimumGap') || 0;
            } catch (error) {
                // The default is nothing
            }

            let fits = 0;
            for (const name of names) {
                const measured = widths[name];
                // A width nobody has taken: stop counting rather than guess
                // past it, since everything after it is unknown too
                if (!measured || measured > room) break;
                room -= measured;
                fits += 1;
            }

            if (fits) return fits;
        }

        return Math.max(1, Math.floor(width / SLOT_WIDTH) - 1);
    };

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
     * Two verbs of the mode's own that live in the menu and nowhere else.
     *
     * Snooze for the set period, beside Fastmail's Snooze rather than in
     * place of it: the stock button opens the dialog, this one just does it.
     *
     * Remove label, because Fastmail's own button cannot be used here. It
     * runs the plain remove, and this mode reads a plain remove on a project
     * label as "archive"; that is what keeps a swipe from quietly unfiling
     * a message. Removing on purpose has to say so, which is what this one
     * does.
     *
     * Named rather than inserted, like everything else on the bar, and named
     * last so they sit under Fastmail's own.
     */
    const MODE_MENU_NAMES = ['customSnooze', 'customRemoveLabel'];

    const snoozeMenuLabel = () =>
        'Snooze ' + snoozePeriodLabel(settings.snoozeDefault);

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

        const snooze = named('customSnooze',
            () => stateVerbOption(snoozeMenuLabel(), 'snooze'));
        try {
            // The period is a setting, so the wording follows it
            snooze.set('label', snoozeMenuLabel());
        } catch (error) {
            // A label that will not be set is still a working button
        }
        matchBarStyle(toolbar, snooze);

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
            if (!modeIsOn) return names;

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
            // Measured before the list is first asked for, so the cut is
            // counted from real widths rather than the fallback estimate
            measureBar(toolbar);
            toolbar.actionsConfig = wrapped;
            toolbar.customOwnsConfig = true;

            // How many fit is a width, so the list is worth recomputing when
            // the width moves, a rotation, or the reading pane opening
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

    // The mode being switched off has to reach the bar: the wrapper hands
    // back Fastmail's own answer then, but only the next time it is asked.
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
    const refreshToolbar = () => {
        if (modeAppliesHere()) {
            // Every layout that has a message actions bar: along the bottom
            // on a phone, across the top of the message on a tablet and on
            // the Mac. The setting names one list of verbs for all three.
            dressToolbar();
            updatePinState();
        }

        updateInboxLabelVisibility();
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
            if (modeIsOn && settings.dragAdditive && isRootLabel(this.get('content'))) {
                return false;
            }

            return originalWillAccept.apply(this, arguments);
        };

        proto.drop = function (drag) {
            if (!modeIsOn || !settings.dragAdditive) return original.apply(this, arguments);

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
                        actions.copy(storeKeys, mailbox);
                    } else {
                        actions.add(storeKeys, mailbox);
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
                if (this.customFiling) asFiling(advance, close);
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
        menuController.customLabels = modeIsOn;
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
        if (!modeIsOn || !mailbox || !wantsContactGroup(mailbox)) return;

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
                // Fastmail's own toast, and Fastmail's own precedence with it:
                // a verb's undo toast lands after this one and takes the
                // corner from it, which is the right way round; the button
                // that undoes an archive matters more than a line saying a
                // contact was filed.
                const who = names.length === 1
                    ? names[0]
                    : names.length + ' senders';

                showToast(made
                    ? who + ' added to contacts and ' + group.get('name')
                    : who + ' added to ' + group.get('name'));
            }
        } catch (error) {
            reportFault('could not file the sender', error);
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
            // decided here.
            const actions = controller().actions;
            asFiling(advance, () => {
                if (FastMail.preferences.get('inLabelsMode')) {
                    actions.add(null, mailbox);
                } else {
                    actions.copy(null, mailbox);
                }
            });
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
     * Snooze for a while; `w`
     * ----------------------------------------------------------------
     */

    // Fastmail's Snooze button is a MenuButtonView whose menu is a
    // FutureTimeMenuView: the presets, and a custom option that swaps them for
    // a FutureCustomTimeView, a date picker and a time field bound to that
    // view's `date`, a preview line, Save and Cancel, Enter to save.

    // "2w", "14d", "1m": a count and a unit. Anything unreadable is two weeks.
    const parseSnoozePeriod = (text) => {
        const match = /^\s*(\d+)\s*([dwm])\s*$/i.exec(String(text || ''));
        if (!match) return { count: 2, unit: 'w' };
        return { count: parseInt(match[1], 10), unit: match[2].toLowerCase() };
    };

    // "08:00". Anything unreadable is eight in the morning.
    const parseSnoozeTime = (text) => {
        const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text || ''));
        if (!match) return { hours: 8, minutes: 0 };
        return {
            hours: Math.min(23, parseInt(match[1], 10)),
            minutes: Math.min(59, parseInt(match[2], 10))
        };
    };

    // The wall-clock moment to propose: today plus the period, at the time
    const snoozeTarget = (now, period, time) => {
        const target = new Date(now.getTime());
        target.setHours(time.hours, time.minutes, 0, 0);
        if (period.unit === 'd') target.setDate(target.getDate() + period.count);
        else if (period.unit === 'w') target.setDate(target.getDate() + period.count * 7);
        else target.setMonth(target.getMonth() + period.count);
        return target;
    };

    // FutureCustomTimeView keeps `date` as the local wall-clock time written
    // as if it were UTC; its drawCustom subtracts the timezone offset and its
    // localDate adds it back; so the same shift is applied here, or the dialog
    // shows the right day at the wrong hour.
    const asPickerDate = (local) =>
        new Date(local.getTime() - local.getTimezoneOffset() * 60000);

    // "2w" → "2 weeks", for a button label
    const snoozePeriodLabel = (text) => {
        const period = parseSnoozePeriod(text);
        const unit = { d: 'day', w: 'week', m: 'month' }[period.unit];
        return period.count + ' ' + unit + (period.count === 1 ? '' : 's');
    };

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

    // The Snooze button on whichever bar is drawn: by its registered name
    // first, which survives translation and a bar too narrow to draw it; by
    // its shortcut behind that.
    const snoozeButtonView = () => {
        const candidates = [];
        for (const bar of toolbarsOnScreen()) {
            try {
                const named = bar.getView('snooze');
                if (named) candidates.push(named);
            } catch (error) {
                // A bar that has never heard of the name
            }
            (bar.get('childViews') || [])
                .filter(view => hasShortcut(view, SNOOZE_SHORTCUT))
                .forEach(view => candidates.push(view));
        }
        return candidates.filter(isDrawn)[0] || candidates[0] || null;
    };

    // The menu that is drawn. The button's menuView property makes a fresh,
    // undrawn menu on every read, so it is no use; the one on screen is an
    // ancestor of the popover's list, and it is the one whose preset list can
    // be swapped for the custom picker.
    const drawnSnoozeMenu = () => {
        const roots = document.querySelectorAll('.v-Menu, .v-PopOver, .v-Sheet');
        for (const root of Array.from(roots)) {
            let view = FastMail.getViewFromNode(root);
            for (let i = 0; view && i < 6; i += 1) {
                if (typeof view.showCustomPicker === 'function') return view;
                view = typeof view.get === 'function' ? view.get('parentView') : null;
            }
        }
        return null;
    };

    const openSnoozeDialog = () => {
        const button = snoozeButtonView();
        if (!button || typeof button.get !== 'function') {
            reportFault('no Snooze button to open');
            return;
        }

        pressButtonView(button);

        const propose = () => {
            const menu = drawnSnoozeMenu();
            if (!menu) return false;

            // showCustomPicker replaces the preset list once; menuView is
            // null after it, which is how a second try knows not to
            if (menu.menuView) menu.showCustomPicker();

            const custom = (menu.get('childViews') || [])
                .filter(view => isViewOfClass(view, 'FutureCustomTimeView'))[0];
            if (!custom) return false;

            const local = snoozeTarget(
                new Date(),
                parseSnoozePeriod(settings.snoozeDefault),
                parseSnoozeTime(settings.snoozeTime)
            );
            custom.set('date', asPickerDate(local));
            return true;
        };

        // activate() shows the popover synchronously as a rule; a tick later
        // covers a bar that builds its menu on the way in
        if (!propose()) setTimeout(propose, 0);
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
                if (!modeIsOn || applyingLabelRules) {
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
     * should look empty. Only in the Inbox with the mode on, the triage
     * surface.
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
        if (!modeIsOn) return false;
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
     * the next, back to the previous; so it decides, but only while there is
     * still triage to do. A neighbour carrying no triage label is not part of
     * the run, and landing on it means reading something nobody asked about,
     * so the list catches that instead.
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

            // The run ends where the triage label does. With no triage label
            // set there is no run to end, and the setting has the last word.
            const triage = settings.backToListAfterTriage && target &&
                triageMailbox(target.get('accountId'));
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

    const buildPicker = (keys) => {
        const MailboxMenuView = FastMail.classes && FastMail.classes.MailboxMenuView;
        if (!MailboxMenuView) return false;

        const popOver = popOverForPicker();
        const anchor = pickerAnchor();
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

            // What tells didEnterDocument this menu is ours to narrow and to
            // route through the waiting verb, exactly as pressing Move to does
            wantOurMove = true;

            // Away from the edge it is anchored to: hung off the bottom bar
            // it opens upwards, off a header it opens down.
            const below = rect.top + rect.height / 2 > window.innerHeight / 2;

            popOver.show({
                view: menu,
                alignWithView: anchor,
                positionToThe: below ? 'top' : 'bottom',
                alignEdge: 'centre',
                showCallout: true,
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
    const openProjectPicker = (keys) => {
        // Where to go after the pick, read now because the pick may take the
        // row out of the list. The menu about to open takes it; what marks the
        // pick a filing is not set here at all, the pick itself sets that.
        armAdvance(messagesFrom(keys)[0]);
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
        if (removes.length) actions.addremove(keys, [], removes);
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
     * contact group still files the sender.
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
            asFiling(null, () => {
                if (FastMail.preferences.get('inLabelsMode')) {
                    actions.add(null, mailbox);
                } else {
                    actions.copy(null, mailbox);
                }
            });
        });
        actions.archive(null);
    };

    const runVerb = (kind, storeKeys) => {
        const actions = controller().actions;
        const keys = resolveKeys(actions, storeKeys);
        if (!keys) return;

        if (kind === 'urgent') {
            runUrgent(actions, keys);
            return;
        }

        if (unfiledAmong(keys).length) {
            openProjectPicker(keys);
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
            if (modeIsOn && back) goToUrl(back);
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
                if (verb === 'remove' && modeIsOn && !removingLabelOnPurpose &&
                        mailbox && typeof mailbox.get === 'function' &&
                        mailbox.get('role') !== 'inbox' && isProject(mailbox)) {
                    return this.archive(storeKeys);
                }

                const archiving = modeIsOn && isArchiving(verb, arguments);

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

        // The stamp rides the checkpoint: whichever didAction cuts one takes
        // the pending return with it; the archive verbs set it the moment
        // before, everything else stamps null.
        const originalDidAction = actions.didAction;
        actions.didAction = function () {
            lastUndoReturn = pendingUndoReturn;
            pendingUndoReturn = null;
            lastGroupAdds = pendingGroupAdds;
            pendingGroupAdds = null;

            if (!undoTarget) {
                patchUndo();
                if (!undoTarget && lastUndoReturn && !warnedNoUndo) {
                    warnedNoUndo = true;
                    reportFault('no undo manager found to wrap;' +
                        ' undo will not walk back to the message');
                }
            }

            return originalDidAction.apply(this, arguments);
        };

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

    const ourMoveWanted = () => modeIsOn && settings.labelsShortcut;

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
            if (!modeIsOn || !archiveButtonUnder(event.target)) return;

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
    // underneath and answer again the moment the mode is off.
    const claimedHandlers = {};

    // key -> verb, filled by reclaimKeys from the key settings; the handlers
    // look their verb up here on every press, so a rebuilt map retargets keys
    // already claimed
    const claimedRun = {};

    const sanitizedKey = (value, fallback) => {
        const key = String(value || '').trim();
        return key || fallback;
    };

    const wantedClaims = () => {
        const wanted = {
            'Shift-V': () => openLabelPicker(),
            // Archive into a hold label. Fastmail's expandAll sits underneath
            // on this key and answers again the moment the mode is off.
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

        wanted[sanitizedKey(settings.urgentKey, 's')] = () => runVerb('urgent', null);
        wanted[sanitizedKey(settings.snoozeKey, 'w')] = () => openSnoozeDialog();

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
                go: (event) => {
                    if (modeIsOn) return claimedRun[key](event);

                    // Mode off: behave as if we were not here; hand the key
                    // to whatever Fastmail has registered underneath
                    const list = kb._shortcuts[key] || [];
                    for (let i = list.length - 1; i >= 0; i -= 1) {
                        const entry = list[i];
                        if (entry[0] !== handler) {
                            return entry[0][entry[1]](event);
                        }
                    }
                    return undefined;
                }
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
            }
        });

        observer.observe(app, { childList: true, subtree: true });
        labelObserver = { root: app, observer: observer };
        stripLabelsIn(app);
        markSourceGroups();
        dressTriageRows();
        dressSourceSections();
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
        if (!modeIsOn || refreshTimer) return;

        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refresh();
        }, 100);
    };

    const setMode = (on) => {
        modeIsOn = !!on;

        try {
            localStorage.setItem(STORAGE_KEY, modeIsOn ? '1' : '0');
        } catch (error) {
            reportFault('could not persist the mode', error);
        }

        // Nothing reads the counting queries with the mode off, so they stop
        // running until it comes back on
        if (!modeIsOn) forgetInboxCounts();

        // The colour rules are only emitted while the mode is on
        updateStyles();
        // The bar decides what it holds from a list it caches; switching the
        // mode changes the answer, so the list has to be asked again
        refreshOwnedConfigs();
        refresh();
        // The mode going off has to put the list back to ungrouped, and the
        // mode coming back on has to pick the clock back up if a grouping
        // is already sitting in the sort.
        refreshGroupings();
        scheduleMidnight();
        applyStickyFilter();
    };

    const toggleMode = () => setMode(!modeIsOn);

    // On by default: the mode is meant to be the normal state, with the button
    // there for the times you want out of it
    const storedMode = () => {
        try {
            let stored = localStorage.getItem(STORAGE_KEY);
            if (stored === null) {
                stored = localStorage.getItem(LEGACY_STORAGE_KEY);
                if (stored !== null) localStorage.setItem(STORAGE_KEY, stored);
            }
            localStorage.removeItem(LEGACY_STORAGE_KEY);
            localStorage.removeItem(LEGACY_STORAGE_KEY + '-early');
            return stored === null ? true : stored === '1';
        } catch (error) {
            return true;
        }
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
            }
        }, 'go');

        // Moving between sources rebuilds the toolbar, and a rebuilt one
        // comes back wearing Fastmail's verbs rather than the mode's.
        controller().addObserverForKey('mailbox', { go: refreshToolbar }, 'go');

        // Arriving at a project label is when the Inbox filter goes on, so
        // this rides the same change of mailbox.
        controller().addObserverForKey('mailbox', { go: applyStickyFilter }, 'go');

        // Opening a message does not always rebuild the bar, so the pin's
        // paint follows the open message directly rather than waiting for a
        // redraw to carry it along.
        controller().addObserverForKey('message', { go: updatePinState }, 'go');

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
            }
        }, 'go');
    };

    /*
     * ----------------------------------------------------------------
     * Main routine
     * ----------------------------------------------------------------
     */

    // FastMail.activeViews is empty outside debug builds, so readiness is
    // checked against the controller, the store and a drawn sidebar instead
    const isReady = () => {
        try {
            return !!(
                window.FastMail &&
                FastMail.store &&
                FastMail.classes &&
                FastMail.getViewFromNode &&
                FastMail.router &&
                FastMail.router.getAppController('mail') &&
                document.querySelector('.v-MailboxSource')
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

    // Selected is worked out once rather than bound, because the menu is
    // built fresh every time it opens and thrown away when it closes.
    const groupingOption = (definition, active) => {
        const option = new FastMail.classes.ButtonView({
            label: definition.name,
            isSelected: definition.id === active,
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
        // With the mode off this stays out of the menu entirely, so Fastmail's
        // own menu is what opens; the toggle is how the user gets back to
        // stock behaviour, and every divergence from it in this file honours
        // that.
        if (!modeIsOn) return;
        if (options.some(option => option && option.customGroupingOption)) return;
        if (!isGroupMenu(options)) return;

        const active = currentGroupingId();
        const entries = [];
        const labels = labelsGroupingFor(controller().get('mailbox'));

        if (labels) entries.push(groupingOption(labels, active));
        modeGroupings().forEach((definition) => {
            entries.push(groupingOption(definition, active));
        });

        if (!entries.length) return;

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
                    if (!options.some(option => option && option.customCopyLinkOption) &&
                        isMessageActionsMenu(options)) {
                        options.unshift(copyLinkOption(), null);
                    }
                    addGroupings(options);
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
     * Every Custom mode option, drawn from Fastmail's own view classes as a
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
     * it, and the multi-line one gets a textarea.
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
            value: String(current),
            isMultiline: !!option.multiline,
            isExpanding: !!option.multiline
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
     * The page Fastmail's Settings shows for Custom mode, built the way its
     * own pages are: a PageView holding one SettingsPaneView, and in it one
     * section per group with the heading on the left and the options on the
     * right. The section markup is Display options' and Custom swipes', class
     * for class, so the spacing, the dividers and the wrap to one column on a
     * narrow screen are all theirs.
     */
    const SETTINGS_PAGE_ID = 'custommode';
    const SETTINGS_PAGE_TITLE = 'Custom mode';

    // The page needs these; the groupings editor's dialog also wants
    // ModalOverlayView and ScrollView, but checks for them itself, so their
    // absence costs that one button rather than the page.
    const pageClasses = () => {
        const all = FastMail.classes || {};
        const required = ['PageView', 'SettingsPaneView', 'ToggleView', 'TextInputView', 'ButtonView', 'View'];
        if (required.some(name => typeof all[name] !== 'function')) return null;
        const found = {};
        required.concat(['ModalOverlayView', 'ScrollView']).forEach((name) => {
            if (typeof all[name] === 'function') found[name] = all[name];
        });
        return found;
    };

    const settingsSection = (group, rows) => {
        const el = FastMail.el;
        // The two inline widths are copied from Display options' and Custom
        // swipes' own sections: without them the left column has no floor,
        // and at a narrow width it collapses instead of wrapping above the
        // options, breaking on the u-break-words heading one letter at a time.
        return el('div.u-p-6.u-space-y-5#s-' + SETTINGS_PAGE_ID + '-' + group.id, [
            el('div.u-flex.u-flex-wrap.u-mx-n6.u-my-n4', [
                el('div.u-mx-6.u-my-4.u-space-y-5.u-flex-1', { style: 'min-width:200px' }, [
                    el('h1.u-flex-auto.u-font-bold.u-text-2xl.u-trim.u-break-words.u-containSelection', [group.title])
                ]),
                el('div.u-mx-6.u-my-4.u-flex-major.u-space-y-8',
                    { style: 'min-width:415px;min-width:min(415px, calc(100% - 48px))' }, rows)
            ])
        ]);
    };

    const settingsPane = (classes) => {
        const register = settingRegister();
        return new classes.SettingsPaneView({
            draw() {
                register.reset();
                const sections = SETTING_GROUPS.map(group => settingsSection(group,
                    settingsInGroup(group.id).map(option => sectionRow(classes, option, register))));
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

    const settingsPage = (classes) => new classes.PageView({
        title: SETTINGS_PAGE_TITLE,
        url: SETTINGS_PAGE_ID,
        isTitleFromH1s: true,
        isImmortal: false,
        header: null,
        content: [settingsPane(classes)]
    });

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

    // Custom mode's funnel, the glyph the Triage row wears, given the classes
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
        const at = group.content.findIndex(entry => entry && entry.id === 'actions') + 1;
        const Entry = group.content[at - 1].constructor;
        const entry = new Entry({ id: SETTINGS_PAGE_ID, name: SETTINGS_PAGE_TITLE, icon: settingsEntryIcon });
        group.content = group.content.slice(0, at).concat([entry], group.content.slice(at));
        sources.setOptions();
    };

    const installSettingsPage = (controller, classes, found) => {
        controller.register(SETTINGS_PAGE_ID, () => settingsPage(classes));

        // Kept so a throw below can put the controller back exactly as it
        // was found. The registration above can stay either way: without
        // the wraps that follow, nothing reaches it.
        const hadOwnMake = Object.prototype.hasOwnProperty.call(controller, 'makeViewInstance');
        const hadOwnRestore = Object.prototype.hasOwnProperty.call(controller, 'restoreEncodedState');
        const originalMake = controller.makeViewInstance;
        const originalRestore = controller.restoreEncodedState;
        const originalContent = found.group.content;

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
            // be mid-build. dressSettingsList's own rule gives the page up
            // once the list is actually on screen and still waiting.
            const found = settingsContract(controller);
            if (!found) return;

            if (installedControllers.has(controller)) {
                // Fastmail may rebuild its groups; the entry goes back if so.
                ensureSettingsEntry(found);
            } else {
                try {
                    installSettingsPage(controller, classes, found);
                } catch (error) {
                    settingsPageUnavailable();
                    reportFault('the Custom mode settings page could not be added; using the plain panel', error);
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
                        reportFault('could not go to the Custom mode settings page', error);
                    }
                }
            }
        } catch (error) {
            reportFault('the Custom mode settings page ran into a problem; the plain panel stands in', error);
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
                }
            }, 'check');
        }
        ensureSettingsPage();
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
            reportFault('could not go to the Custom mode settings page; showing the plain one', error);
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
    // store, and labelColourRules needs modeIsOn, neither up yet this early,
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
     * draw a search.
     *
     * If that row cannot be made, the rows still list and still reorder,
     * with a pair of buttons each. The dragging rows carry the same buttons,
     * because there is no keyboard path to a drag.
     */

    // An icon-only button draws its label into a span the app's own stylesheet
    // gives no height and no opacity, so one handed no icon is a blank box
    // thirty-six pixels wide. These are the chevrons the app draws elsewhere,
    // so the two moves look like the rest of the page rather than like text.
    const MOVE_SHAPES = {
        up: [['polyline', { points: '6.25 14.88 12 9.13 17.75 14.88' }]],
        down: [['polyline', { points: '17.75 9.13 12 14.88 6.25 9.13' }]]
    };

    // The height Fastmail's own editor gives these rows. A dragging list puts
    // each row at its index times this, so no row may grow past it, and the
    // label is truncated rather than left to wrap onto a second line. Nor may
    // a row fall short of it: the rows sit apart by this pitch whatever their
    // own height, so the label is given a button's height to fill it out,
    // where Fastmail's own row gets there with its taller menu button.
    const REORDER_ROW_HEIGHT = 49;

    // What `.v-Button > .v-Icon` makes a glyph on the bar.
    const BAR_GLYPH_SIZE = '22px';

    const reorderRowParts = (classes, item, move, draggable) => {
        const el = FastMail.el;
        const parts = [];
        // Fastmail's own grip, so that a row that drags looks like one.
        if (draggable) {
            parts.push(el('div.u-flex-none.u-select-none',
                { style: 'margin-top:-6px;cursor: grab' }, ['⣶']));
        }
        // Drawn afresh each time, since a node can be in only one row; a row
        // with no glyph to show carries its name alone. Fastmail's stylesheet
        // sizes an icon only inside the thing holding it, so outside a button
        // this one is given the size a button on the bar gives it.
        const icon = item.icon ? item.icon() : null;
        if (icon) {
            icon.style.width = BAR_GLYPH_SIZE;
            icon.style.height = BAR_GLYPH_SIZE;
            parts.push(el('div.u-flex-none', { style: 'line-height:0' }, [icon]));
        }
        parts.push(el('div.u-flex-1.u-truncate', { style: 'line-height:32px' }, [item.label]));
        parts.push(new classes.ButtonView({
            type: 'v-Button--subtle v-Button--sizeM v-Button--iconOnly',
            label: 'Move up',
            icon: standardIcon('i-chevronup', MOVE_SHAPES.up),
            target: { go: () => move(item.id, -1) }, method: 'go'
        }));
        parts.push(new classes.ButtonView({
            type: 'v-Button--subtle v-Button--sizeM v-Button--iconOnly',
            label: 'Move down',
            icon: standardIcon('i-chevrondown', MOVE_SHAPES.down),
            target: { go: () => move(item.id, 1) }, method: 'go'
        }));
        if (item.edit) parts.push(new classes.ButtonView({
            type: 'v-Button--subtle v-Button--sizeM',
            label: 'Edit', target: { go: item.edit }, method: 'go'
        }));
        if (item.remove) parts.push(new classes.ButtonView({
            type: 'v-Button--subtle v-Button--sizeM',
            label: 'Remove', target: { go: item.remove }, method: 'go'
        }));
        return parts;
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
    const reorderDragList = (classes, items, move, onOrder) => {
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
                        return reorderRowParts(classes, byId[this.get('content').get('id')], move, true);
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
        const order = items.map(item => item.id);

        // onOrder answers false when it refused to write. The order kept here
        // then goes back to the one on screen, so the next move starts from
        // what the list shows rather than from a move that never happened.
        const move = (id, by) => {
            const at = order.indexOf(id);
            const to = at + by;
            if (at === -1 || to < 0 || to >= order.length) return;
            const before = order.slice();
            order.splice(to, 0, order.splice(at, 1)[0]);
            if (onOrder(order.slice()) === false) order.splice(0, order.length, ...before);
        };

        const dragging = reorderDragList(classes, items, move, onOrder);
        if (dragging) return dragging;

        return new classes.View({
            className: 'u-list-body u-list-body--borders',
            draw: () => items.map(item => new classes.View({
                className: 'u-list-item u-flex u-items-center u-space-x-2',
                draw: () => reorderRowParts(classes, item, move, false)
            }))
        });
    };

    /*
     * Your groupings, as a list rather than as text. Opening one raises
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

    // Fastmail's own editor, in the frame its own Custom… entry uses: its
    // condition rows drag only inside a ScrollView, and its Escape and Enter
    // are answered by its own keyOutside.
    const editGrouping = (classes, grouping, done) => {
        // Its dialog needs its own two classes; the page that holds the
        // Edit button does not, so they are checked here rather than there.
        const Editor = FastMail.classes && FastMail.classes.GroupSettingsView;
        if (typeof Editor !== 'function' || !classes.ModalOverlayView || !classes.ScrollView) {
            reportFault('Fastmail’s groupings editor is not available; edit the text instead');
            return;
        }

        let saved = null;
        const controller = groupingStandIn(grouping, (value) => { saved = value; });
        const view = new Editor({ controller: controller });
        const dialog = framedModal(classes, view, 580, event => view.keyOutside(event));

        // The editor's own Cancel and Save both fire modal:hide; Save has
        // already handed us the value by then.
        view.on('modal:hide', { close: () => dialog.modal.hide() }, 'close');

        // show() settles once the overlay has been hidden.
        dialog.modal.show().then(() => {
            dialog.takeApart();
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

    const NEW_GROUPING_NAME = 'New grouping';

    /*
     * Nothing here writes from the groupings as they were when the list was
     * drawn. The text field below saves the setting without redrawing the
     * list, and the host can push a new value in while the page is open, so
     * a list drawn a minute ago may show groupings since typed away and miss
     * ones since typed in; a write made from that picture puts it back.
     *
     * So each action first saves whatever a field still has waiting, then
     * parses the setting afresh, finds its grouping by name rather than by a
     * position that may have moved, and writes from that. The list redraws
     * after it writes, but not while someone types, since a redraw throws the
     * field away under the cursor; a label that lags the text costs nothing
     * now that no action reads one.
     *
     * And an action refuses outright while writing the text back would lose
     * any line of it: a grouping with no groups yet, or any line the reading
     * discards. The write is made from what the parser keeps, so whatever it
     * leaves out would be deleted from under whoever is still typing it. A
     * refusal writes nothing, and redraws nothing but its own notice, since a
     * redraw of the section would replace the field holding the text.
     *
     * The notice is the section's own line rather than a fault. A fault is
     * shown once per page load, so a second press of the same button would
     * seem to do nothing at all; the notice is drawn again on every refusal,
     * and cleared by the next action that goes ahead.
     */
    const groupingsSection = (classes, register) => {
        const el = FastMail.el;
        const option = settingFor('groupings');
        let showText = false;

        // Drawn in a view of its own, so that saying something redraws only
        // the notice and never the text field beside it.
        let notice = '';
        let noticeView = null;
        const say = (text) => {
            if (!text && !notice) return;
            notice = text;
            if (noticeView) noticeView.viewNeedsRedraw();
        };

        // The first thing a write would lose, in words; '' when it loses nothing.
        const problemIn = (read) => {
            const empty = read.blocks.filter(one => !one.categories.length)[0];
            if (empty) {
                return 'Finish or remove the grouping “' + empty.name +
                    '” in the text before changing the list.';
            }
            const lost = read.discarded[0];
            if (!lost) return '';
            if (lost.reason === 'duplicate') {
                return 'The grouping “' + lost.grouping +
                    '” appears twice; rename or remove one before changing the list.';
            }
            if (lost.reason === 'replaced') {
                return '“' + lost.grouping + '” has two lines naming everything else, “' +
                    lost.line + '” among them; remove one before changing the list.';
            }
            return 'The line “' + lost.line + '” under “' + lost.grouping +
                '” is unfinished; finish or remove it before changing the list.';
        };

        // The groupings as they stand, or null while writing them back would
        // lose something typed; the notice says which, or is cleared.
        const current = () => {
            register.flushPending();
            const text = settingValue('groupings');
            const problem = problemIn(readGroupingBlocks(text));
            say(problem);
            return problem ? null : parseGroupings(text);
        };
        const named = (groupings, name) => groupings.filter(one => one.name === name)[0] || null;

        const redraw = () => holder.viewNeedsRedraw();
        const save = (next) => {
            writeSetting('groupings', formatGroupings(next));
            redraw();
        };

        const reorder = (order) => {
            const now = current();
            if (!now) return false;
            save(mergeOrder(now.map(one => one.name), order).map(name => named(now, name)));
        };

        const remove = (name) => {
            const now = current();
            if (!now) return;
            if (!named(now, name)) {
                redraw();
                return;
            }
            save(now.filter(one => one.name !== name));
        };

        // The editor is seeded with the grouping as it stands at the press,
        // and its save is laid over the setting as it stands at the save. A
        // grouping renamed or deleted in between is not brought back. It
        // refuses to open while the text is unfinished, rather than letting
        // somebody edit only to be refused at Save.
        const edit = (name) => {
            const before = current();
            if (!before) return;
            const seed = named(before, name);
            if (!seed) {
                redraw();
                return;
            }
            editGrouping(classes, seed, (value) => {
                // Saved down to nothing, it would vanish from the list at the
                // next parse; removing it is the list's job, and says so. As a
                // fault, since this happens inside Fastmail's dialog where the
                // notice cannot be seen, and in the notice too, so that it is
                // still there once the dialog has gone.
                if (!value.categories || !value.categories.length) {
                    reportFault('a grouping needs at least one group; remove “' + name +
                        '” from the list instead');
                    say('A grouping needs at least one group; remove “' + name +
                        '” from the list instead.');
                    return;
                }
                const now = current();
                if (!now) return;
                const at = now.map(one => one.name).indexOf(name);
                if (at === -1) {
                    reportFault('“' + name + '” is no longer in your groupings, so its edit was not saved');
                    redraw();
                    return;
                }
                now[at] = {
                    id: now[at].id, name: name,
                    categories: value.categories, otherName: value.otherName || OTHER_NAME
                };
                save(now);
            });
        };

        // A name no grouping has yet: of two groupings sharing a name the
        // parser keeps the first and drops the second without a word, so a
        // second Add under the same name would add nothing.
        const add = () => {
            const now = current();
            if (!now) return;
            let name = NEW_GROUPING_NAME;
            for (let count = 2; named(now, name); count += 1) name = NEW_GROUPING_NAME + ' ' + count;
            save(now.concat([{
                id: SPLIT_PREFIX + name, name: name,
                categories: [{ name: 'Pinned', query: 'is:pinned' }],
                otherName: OTHER_NAME
            }]));
        };

        const holder = new classes.View({
            className: 'u-space-y-3',
            draw: () => {
                // Drawn from, and never written from.
                const groupings = parseGroupings(settingValue('groupings'));

                const items = groupings.map(one => ({
                    id: one.name,
                    label: one.name + ' — ' + one.categories.length +
                        (one.categories.length === 1 ? ' group' : ' groups'),
                    edit: () => edit(one.name),
                    remove: () => remove(one.name)
                }));

                const list = reorderList(classes, items, reorder);

                const addButton = new classes.ButtonView({
                    type: 'v-Button--standard v-Button--sizeM',
                    label: 'Add a grouping',
                    target: { go: add },
                    method: 'go'
                });

                // Saved before it goes, so the list it leaves behind is current.
                const toggle = new classes.ButtonView({
                    type: 'v-Button--subtle v-Button--sizeM',
                    label: showText ? 'Hide the text' : 'Edit as text',
                    target: { go: () => {
                        register.flushPending();
                        showText = !showText;
                        redraw();
                    } },
                    method: 'go'
                });

                noticeView = new classes.View({
                    draw: () => (notice
                        ? [el('p.u-trim.u-text-sm.u-color-error',
                            { role: 'status', style: 'margin-top:8px' }, [notice])]
                        : [])
                });

                const parts = [
                    el('h3.u-trim.u-font-bold', [option.title]),
                    el('div', [list, noticeView]),
                    addButton, toggle
                ];
                if (showText) parts.push(settingRow(classes, option, register));
                parts.push(el('p.u-trim.u-text-sm.u-color-unimportant', [option.hint]));
                return parts;
            }
        });

        return holder;
    };

    /*
     * The bar's verbs, in the order the bar takes them. orderedSlots already
     * turns the setting into a complete list — it lowercases, renames the old
     * "file" to "keep", drops what it does not know and appends what the
     * saved value failed to mention — so nothing new is needed to read it.
     */
    const barSlotsSection = (classes) => {
        const el = FastMail.el;
        const option = settingFor('bottomBarSlots');

        const holder = new classes.View({
            className: 'u-space-y-3',
            draw: () => {
                const names = orderedSlots();
                const pretty = (name) => name.charAt(0).toUpperCase() + name.slice(1);
                // Each verb beside the glyph the bar draws for it.
                const items = names.map(name => ({
                    id: name, label: pretty(name), icon: () => slotIcon(name),
                    edit: null, remove: null
                }));
                // Laid over the order as it is at the press, not as drawn: the
                // host can push a new one in while the page is open.
                const list = reorderList(classes, items, (order) => {
                    writeSetting('bottomBarSlots',
                        mergeOrder(orderedSlots(), order).map(pretty).join(', '));
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

    // Two options are lists rather than fields; everything else is a row.
    const sectionRow = (classes, option, register) => {
        if (option.key === 'groupings') return groupingsSection(classes, register);
        if (option.key === 'bottomBarSlots') return barSlotsSection(classes);
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
    const FALLBACK_ID = 'custom-mode-fallback-settings';

    const openFallbackSettings = () => {
        if (document.getElementById(FALLBACK_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = FALLBACK_ID;

        const sheet = document.createElement('div');
        sheet.className = 'custom-mode-fallback-sheet';

        const heading = document.createElement('h1');
        heading.textContent = 'Custom mode';
        sheet.appendChild(heading);

        const note = document.createElement('p');
        note.className = 'custom-mode-fallback-note';
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
                row.className = 'custom-mode-fallback-row';

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
                name.className = 'custom-mode-fallback-title';
                name.textContent = option.title;
                const hint = document.createElement('span');
                hint.className = 'custom-mode-fallback-hint';
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
    const SETTINGS_ROW_CLASS = 'custom-mode-settings-row';

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
        const found = settingsSourceList();
        if (!found) return;
        const { list, swipes, offline } = found;
        const copied = list.querySelector('.' + SETTINGS_ROW_CLASS);

        // The list is on screen, so Settings has loaded; a controller that is
        // still not there to install into is as good as missing.
        if (settingsPageState === 'waiting') settingsPageUnavailable();

        // With the page installed, the entry Fastmail draws is the way in,
        // and a copy left from before would put Custom mode in the list twice.
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
        if (label) label.textContent = 'Custom mode';
        else link.appendChild(document.createTextNode('Custom mode'));

        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openFallbackSettings();
        });

        list.insertBefore(clone, offline);
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

    const start = () => {
        passContextMenuThrough();
        patchBadgeRendering();
        patchDrop();
        patchMailboxMenu();
        patchArchive();
        patchLabelActions();
        patchMenus();
        patchSplits();
        patchShortcuts();
        updateStyles();
        installAppBadge();
        startSettingsPage();

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

        setMode(storedMode());
        scheduleMidnight();
        adoptList();
        watchGroupCounts();

        // Handy from the console, and how the counts can be checked by hand
        window.customMode = {
            isOn: () => modeIsOn,
            setMode,
            toggleMode,
            refresh,
            countFor,
            sourcesAboveLabels,
            goToSourceAt,
            settings: () => settings,
            parseGroupings,
            labelsGrouping: labelsGroupingFor,
            currentGroupingId,
            chooseGrouping,
            openSettings,
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
            }
        };

        console.log(`Custom mode ${modeIsOn ? 'on' : 'off'}; window.customMode.toggleMode() to switch it`);
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

    const mainObserver = new MutationObserver(() => {
        if (settingsPageCanStart()) startSettingsPage();
        if (!isReady()) return;
        mainObserver.disconnect();
        start();
    });

    if (settingsPageCanStart()) startSettingsPage();

    if (isReady()) {
        start();
    } else {
        mainObserver.observe(document.body, { attributes: true, childList: true, subtree: true });
    }

})();
