// ==UserScript==
// @name         Fastmail Inbox mode
// @namespace    custom
// @version      2.47
// @description  Triage flow for Fastmail: the Inbox is the queue, Process is the kept list, Next is the sticky filter
// @author       Maarten den Braber <m@mdbraber.com>
// @match        https://app.fastmail.com/*
// @match        https://app.beta.fastmail.com/*
// @run-at       document-idle
// @inject-into  context
// @grant        none
// ==/UserScript==

/*
Fastmail Inbox mode
Maarten den Braber <m@mdbraber.com>
version 2.0 - 2026-08-15

Spec: docs/superpowers/specs/2026-08-15-fastmail-triage-flow-design.md

# The model

| State     | Carries                 | List             |
|-----------|-------------------------|------------------|
| Untriaged | Inbox                   | the Inbox        |
| Kept      | Inbox + Process         | the Inbox        |
| Non-inbox | Process, not Inbox      | its own label    |
| Deferred  | Waiting or Someday      | its own label    |
| Done      | neither                 | —                |

Kept and Non-inbox are both `v`, and what you file it under decides which. Every
keep writes the marker — being kept is being work — and the label decides
one thing only: whether the Inbox stays. A topic keeps it, because the Inbox
is everything live and a message you have committed to is still live; what
takes it out of Triage is the marker, not leaving. A label named in
nonInboxLabels takes the Inbox off instead: those are worked from the label
rather than from the queue, so leaving them in the Inbox shows them twice.

Verbs, all working on the selection and the whole conversation:

* `e`       done — archive; also drops Process, the deferred labels and the
            pin. Opens the topic picker first when no topic is on the thread.
* `v`       keep — adds Process and removes any deferred label, leaving the
            Inbox where it is. Same picker rule. Filed under a non-inbox
            label instead, the Inbox comes off too; a topic anywhere on the
            thread outranks that.
* `s`       urgent — keep + pin; on something already kept, a pin toggle.
* `w`       waiting — parks it on settings.waitingLabel: the state goes on,
            Process and any rival verdict come off, the Inbox stays. Same
            picker rule.
* `o`       someday — the same parking on settings.somedayLabel. (`o` was
            Fastmail's open-conversation key; Enter still opens.)
* `Shift-E` escape — `e` committing the picker empty: archive without a topic.
* `Shift-V` label only — always the picker, never triages. Picking a deferred
            label (Waiting) also removes Process: deferring is a move.
* `l`       stock tristate Labels menu, narrowed but otherwise untouched.
            Process never shows: the marker is written by the verbs alone,
            and a verdict ticked by hand takes it off on its own. On the
            phone, Keep / Waiting / Someday live in the message bar's More
            menu.

While Inbox mode is on:

* Every label — and the Inbox itself — opens on the `next` filter:
  what is in the Inbox or in Process, minus the deferred labels. Two more
  values complete the set: `triage`, the undecided slice (in the Inbox with
  no verb yet — not kept, not deferred; empty means triage zero), and
  `deferred`, the complement of it. `noninbox` is the fourth, shown only
  once nonInboxLabels names something. All are ordinary values in Fastmail's
  own filter menu, carried by ?filter= and remembered per label. `next` and
  `noninbox` were spelled `actionable` and `reference` before v2.35; both
  spellings are still read wherever one was stored.
* Sidebar badges: the Inbox, Process and the deferred labels show their exact
  server-side thread counts. Topics carry no badge by default; with
  showFilteredCounts on they show their exact Next count, from a
  registered query primed with one calculateTotal call.
* Dragging a message onto a topic label triages it exactly as `v` does;
  dragging onto a qualifier just adds the label. Option restores the stock
  move.

A "user label" is any mailbox without a system role. The kept marker —
"Process" throughout this file's internals — is named by
settings.processLabel and defaults to "Next"; deferred labels live in
settings.deferredLabels; qualifiers in settings.qualifierLabels; every
other user label is a topic.

# Notes

* Nothing here writes to a store record. Badge counts are swapped in around
  Fastmail's own drawing code and restored immediately, so no record is
  dirtied; counts come from Mailbox.totalThreads or from a server-computed
  query total, never from a scan of loaded messages.
* Opening a label by a bare URL bypasses goSource and so opens unfiltered.
  Selecting any source afterwards re-applies the filter.
* Every verb lands as one undo checkpoint under one toast; `z` reverts it
  whole. The grouping is Fastmail's own: everything queued before the one
  didAction left unswallowed joins that checkpoint.
*/

(function () {
    'use strict';

    // Injection can happen more than once — an injector racing a reload, or a
    // manual load on top of an existing copy. Patching twice would double-wrap
    // every method it touches, so stop if we are already here.
    if (window.customInboxMode) {
        console.log('Inbox mode: already loaded');
        return;
    }

    /*
     * ----------------------------------------------------------------
     * Configuration
     * ----------------------------------------------------------------
     */

    // Keystroke that toggles Inbox mode
    const SHORTCUT = 'Shift-I';
    // The per-label filter system — next, triage, deferred, noninbox — is
    // retired but kept: Fastmail's groups do its job on the server now.
    // Off, nothing of it installs. Every hook it had is guarded by this
    // one name, so a search for LABEL_FILTERS finds all of it.
    const LABEL_FILTERS = false;
    // 1 … 9 and 0 go to the sources listed above the Labels heading.
    //
    // Cmd is the one to reach for, but Safari keeps Cmd-1 … Cmd-9 for its tabs
    // and never lets the page see the number at all — pressing Cmd-1 delivers
    // the Cmd keydown and nothing else, so there is not even an event to
    // cancel. It still works in the web apps, which have no tabs, so it stays
    // bound; Option is bound alongside it, and nothing claims that.
    const SOURCE_SHORTCUT_COUNT = 9;
    const SOURCE_SHORTCUT_MODIFIERS = ['Meta'];

    // Option shortcuts are matched on the physical key rather than the
    // character, because Option is what a Mac keyboard uses to reach a second
    // layer: Option-1 is not "1" but ¡ or similar — nothing a shortcut can be
    // named after, and the answer would change with the layout. The code
    // does not.
    //
    // Digit0 comes last, so the row reads 1 … 9, 0 as it does on the keyboard.
    const OPTION_SOURCE_CODES = [
        'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
        'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'
    ];

    // Where the on/off state is remembered across reloads
    const STORAGE_KEY = 'custom-inbox-mode';
    // Where each label's own filter choice is remembered, by mailbox id
    const FILTERS_KEY = 'custom-inbox-mode-filters';
    // What a label gets until you choose otherwise. `next` is ours: in the
    // Inbox or in Process, minus the deferred labels. It was spelled
    // `actionable` until v2.35 — loadFilters rewrites that where it was
    // remembered, so a filter chosen under the old name survives.
    const DEFAULT_FILTER = 'next';
    // The complement: only the deferred labels
    const DEFERRED_FILTER = 'deferred';
    // The undecided slice: in the Inbox with no verb given yet — not kept
    // (Process), not deferred. Empty is triage zero.
    const TRIAGE_FILTER = 'triage';
    // What is filed under a non-inbox label: kept, but worked from the label
    // rather than from the Inbox. Its own slice, so the mail that has left
    // the front door can be picked out from the mail that has not.
    const NONINBOX_FILTER = 'noninbox';
    // The spellings these two went by before, rewritten wherever a stored
    // value or a setting still uses them
    const FILTER_ALIASES = { actionable: 'next', reference: 'noninbox' };
    // Marks our toolbar button so it can be found again after a redraw
    const INDICATOR_CLASS = 'custom-inboxModeButton';
    // Set on <body> while the Inbox chip should be hidden on message rows
    const HIDE_INBOX_LABEL_CLASS = 'custom-hideInboxLabel';
    // Goes on the sidebar row that opens a run of a different kind, so the line
    // above it can be left to CSS
    const SOURCE_SEPARATOR_CLASS = 'custom-sourceSeparator';
    // Goes on the sidebar when the only section drawn is this account's own
    const LONE_SECTION_CLASS = 'custom-loneSection';
    // Opens the Move to menu: v narrowed to the sidebar and adding rather than
    // moving, Option-V as it comes. Option-V is matched on the physical key,
    // because on a Mac the character Option produces is not "v".
    const MOVE_SHORTCUT = 'v';
    const STOCK_MOVE_CODE = 'KeyV';
    // Id of our stylesheet
    const STYLE_ID = 'custom-inboxMode-style';
    // What the extension's document_start script replays on the next load, so
    // Fastmail's first paint is already styled. Read by early.js as well.
    const EARLY_KEY = 'custom-inbox-mode-early';
    // Views worth remembering an answer for; older ones are dropped
    const EARLY_PATH_LIMIT = 40;
    // Bumped when remembered answers become untrustworthy, to drop them once
    const EARLY_VERSION = 1;

    // Options, overridable from the extension's settings. The extension writes
    // them onto the page just before this script is injected; running without
    // it (pasted into a console, say) simply falls back to these defaults.
    const DEFAULT_SETTINGS = {
        labelColours: true,
        labelColoursSidebarOnly: true,
        // The marker label sits on everything kept, so tinting rows by it
        // would colour the whole Process list one shade and say nothing
        labelColoursSkipProcess: true,
        // Triage is on every undecided row, so tinting by it would paint
        // the whole group one shade and say nothing
        labelColoursSkipTriage: true,
        dragAdditive: true,
        hideInboxLabel: true,
        stripLabelPrefix: true,
        labelsShortcut: true,
        labelsSidebarOnly: true,
        labelsAutoSave: true,
        // The marker for kept mail. A disposition, not durable metadata:
        // stripped again on archive and on snooze. Named Next because that
        // is what the list answers: what is next.
        processLabel: 'Next',
        // Qualifiers cut across topics; a message can carry any number
        qualifierLabels: 'Admin, Waiting',
        // What the Next filter hides. Waiting is an ordinary qualifier
        // that is also deferred; Snoozed is here as insurance only, since
        // snoozing already takes the Inbox label off.
        deferredLabels: 'Waiting, Snoozed',
        // The two named states the defer verbs park a message in — w and o.
        // Both are folded into the deferred set and the qualifier set, so
        // naming them here is the only configuration they need.
        waitingLabel: 'Waiting',
        somedayLabel: 'Someday',
        // The labels worked from the label rather than from the Inbox.
        // Keeping into one marks it like any other keep and takes the Inbox
        // off, so it lives in its label instead of the queue's front door.
        // A label is a topic or one of these, never both; a message carrying
        // one of each is work, and the topic wins. Empty by default, so
        // nothing changes until you name one.
        nonInboxLabels: '',
        // The label a rule puts on everything incoming. Taken off by keeping
        // or filing; the script never adds it.
        triageLabel: 'Triage',
        // w opens Fastmail's own snooze dialog filled in for this far ahead —
        // a count and d, w or m — at this time of day
        snoozeKey: 'w',
        snoozeDefault: '2w',
        snoozeTime: '08:00',
        // The verb keys, in Fastmail's own key spelling. o replaces the
        // stock open-conversation key while the mode is on; Enter still
        // opens either way.
        urgentKey: 's',
        waitingKey: 'w',
        somedayKey: 'o',
        // The phone bar's verbs, as one ordered list over all of them: the
        // bar takes as many leading ones as the screen fits — More always
        // keeps a slot — and the rest wait inside More, in the same order.
        // Kinds missing from a saved value join at the end.
        bottomBarSlots: 'Snooze, Pin, Archive, Labels, Keep, Waiting, Someday, Delete, Move',
        // Never offered as topics, even from the sidebar
        excludedLabels: 'Later',
        // Labels that file the sender as well as the message: picking one in
        // the topic picker adds from[0] to the contact group of the same
        // name, making the contact, and the group, if either is new. Empty
        // by default, because writing to your address book is not something
        // a mail script should start doing unasked.
        contactGroupLabels: '',
        // Show exact counts on filtered views and topic badges
        showFilteredCounts: true,
        // The list heading carries the same pair as the sidebar badge —
        // total, unread in parens — including in the shell apps, whose
        // stock heading carries no number at all
        showHeaderCounts: true,
        // The app icon's badge, for the shell apps: the total of this label
        // under this filter (next, triage, deferred, noninbox, or empty for the
        // plain total). An empty label hands the shell its own fallback.
        appBadgeLabel: 'Inbox',
        appBadgeFilter: 'next',
        swapArchiveExpand: true,
        sidebarSeparators: true,
        hideLoneExpando: true
    };

    let settings = Object.assign({}, DEFAULT_SETTINGS, window.__customInboxModeSettings || {});
    // Id prefix for the per-account queries that pull each Inbox into the store

    /*
     * ----------------------------------------------------------------
     * State
     * ----------------------------------------------------------------
     */

    let modeIsOn = false;
    // mailbox id -> the filter you last chose for that label
    let rememberedFilters = {};

    /*
     * ----------------------------------------------------------------
     * General helper functions
     * ----------------------------------------------------------------
     */

    // Get controller
    const controller = () => FastMail.router.getAppController('mail');

    // Overture collections are sometimes real arrays and sometimes record
    // arrays. A record array indexes store keys rather than records and has no
    // own length, so it must be walked with its own map() to get records out.
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

    // Which class a view is. FastMail.classes is keyed by the Name every
    // class declares, so the class object itself can be had and asked about
    // — which beats comparing constructor.name to a string twice over: a
    // subclass answers yes, and nothing depends on the minifier having kept
    // the constructor's function name, which is a property nobody promised.
    // The name comparison stays behind it for a class that is not exported.
    const isViewOfClass = (view, name) => {
        if (!view || !view.constructor) return false;

        const Class = FastMail.classes && FastMail.classes[name];
        if (Class) return view instanceof Class;

        return view.constructor.name === name;
    };

    // Fastmail names a chip by the mailbox's full path — "Projects/Work", not
    // "Work" — while the record's name and displayName are only the leaf. Every
    // rule that selects on a chip, and every comparison against one, has to use
    // the path or it silently misses every nested label.
    // A record whose parent has not arrived in the store yet throws on the way
    // up, and one walk of the tree is no reason to stop the caller
    const parentOf = (mailbox) => {
        if (!mailbox || !mailbox.get) return null;

        try {
            return mailbox.get('parent');
        } catch (error) {
            return null;
        }
    };

    // Mailbox has a pathName of its own — parent's pathName, a slash, this
    // one's displayName — and the row chips carry it as their title, so
    // asking for it is both shorter and the only way to be sure the two
    // agree. The walk below says the same thing by hand, which is one more
    // place to drift; it stays as the answer for a record that has not got
    // the property.
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
    // make the system folder that follows look like the start of something new.
    const isUnderInbox = (mailbox) => {
        let node = parentOf(mailbox);

        // Same depth guard as mailboxPath, for the same reason
        for (let depth = 0; node && node.get && depth < 20; depth += 1) {
            if (node.get('role') === 'inbox') return true;
            node = parentOf(node);
        }

        return false;
    };

    // The mode is global, but a label can be taken out of it on its own: its
    // remembered filter is what says so, which is the same thing that decides
    // how the label opens. One source of truth, already persisted.
    const modeForLabel = (mailbox) =>
        modeIsOn && isUserLabel(mailbox) && filterFor(mailbox) === DEFAULT_FILTER;

    // Qualifiers cut across the inboxes — a message is urgent *and* somewhere.
    // Which labels those are is a rule of yours, like the triage label, so it is
    // named rather than worked out. Order matters: the first named wins when a
    // message carries more than one.
    //
    // Asked for every option a picker filters and every row a rule colours,
    // so the parse is kept until the settings that feed it change.
    let qualifierCache = null;

    const qualifierPaths = () => {
        const key = [settings.qualifierLabels, settings.waitingLabel,
            settings.somedayLabel].join('\u0000');
        if (qualifierCache && qualifierCache.key === key) return qualifierCache.paths;

        const named = String(settings.qualifierLabels || '')
            .split(',')
            .map(part => part.trim())
            .filter(Boolean);

        // The verb states qualify by definition — parked is a way of being
        // marked — so they join without being listed twice
        [settings.waitingLabel, settings.somedayLabel].forEach((path) => {
            const trimmed = String(path || '').trim();
            if (trimmed && !named.some(other =>
                other.toLowerCase() === trimmed.toLowerCase())) {
                named.push(trimmed);
            }
        });

        qualifierCache = { key: key, paths: named };
        return named;
    };

    const qualifierRank = (mailbox) => {
        const path = mailboxPath(mailbox).toLowerCase();
        return qualifierPaths().findIndex(named => named.toLowerCase() === path);
    };

    // Labels struck from the topic set by name — Later holds mail, it does
    // not file it — a rule of yours like the qualifiers, so it is named
    // rather than worked out. Memoized like the qualifiers, for the same
    // callers.
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
    // the folder list" — measured: 0 on sidebar labels, 1 on the archive
    // shelf, 3 on a label hidden everywhere.
    const isSidebarLabel = (mailbox) => !(Number(mailbox.get('hidden')) & 1);

    /*
     * ----------------------------------------------------------------
     * The state mailboxes: Inbox, Process, and the deferred labels
     * ----------------------------------------------------------------
     */

    // These are asked on every badge paint and inside computed properties, so
    // they are cached per account and dropped whenever a Mailbox record
    // changes — the same store event that already rebuilds the stylesheet.
    const labelCache = new Map();
    const forgetLabelCache = () => labelCache.clear();

    const pathsFromSetting = (value) => String(value || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

    const mailboxesOf = (accountId) => FastMail.store.getAll(FastMail.classes.Mailbox)
        .filter(m => !accountId || m.get('accountId') === accountId);

    // Matched on the full path, case-insensitively, among every mailbox of the
    // account: the deferred set names Snoozed, which carries a role and so is
    // not a user label.
    const findByPath = (accountId, path) => {
        const wanted = String(path || '').toLowerCase();
        if (!wanted) return null;

        return mailboxesOf(accountId)
            .filter(m => mailboxPath(m).toLowerCase() === wanted)[0] || null;
    };

    const stateLabels = (accountId) => {
        const key = accountId || '';
        let cached = labelCache.get(key);
        if (cached) return cached;

        // The verb states are deferred by definition, so they fold into the
        // set without being listed in deferredLabels as well
        const deferredPaths = pathsFromSetting(settings.deferredLabels);
        [settings.waitingLabel, settings.somedayLabel].forEach((path) => {
            const trimmed = String(path || '').trim();
            if (trimmed && !deferredPaths.some(other =>
                other.toLowerCase() === trimmed.toLowerCase())) {
                deferredPaths.push(trimmed);
            }
        });

        cached = {
            inbox: mailboxesOf(accountId).filter(m => m.get('role') === 'inbox')[0] || null,
            triage: findByPath(accountId, settings.triageLabel),
            process: findByPath(accountId, settings.processLabel),
            waiting: findByPath(accountId, settings.waitingLabel),
            someday: findByPath(accountId, settings.somedayLabel),
            deferred: deferredPaths
                .map(path => findByPath(accountId, path))
                .filter(Boolean),
            nonInbox: pathsFromSetting(settings.nonInboxLabels)
                .map(path => findByPath(accountId, path))
                .filter(Boolean)
        };

        labelCache.set(key, cached);
        return cached;
    };

    const inboxMailbox = (accountId) => stateLabels(accountId).inbox;
    const processMailbox = (accountId) => stateLabels(accountId).process;
    const waitingMailbox = (accountId) => stateLabels(accountId).waiting;
    const somedayMailbox = (accountId) => stateLabels(accountId).someday;
    const deferredMailboxes = (accountId) => stateLabels(accountId).deferred;
    const nonInboxMailboxes = (accountId) => stateLabels(accountId).nonInbox;
    const triageMailbox = (accountId) => stateLabels(accountId).triage;

    const isTriage = (mailbox) => !!mailbox &&
        mailbox === triageMailbox(mailbox.get('accountId'));

    // A project: a user label shown in the sidebar, not struck out by name,
    // and not Triage. Sidebar membership is the rule — the archive shelf of
    // hidden labels tags history, it does not queue work.
    const isProject = (mailbox) => isUserLabel(mailbox) &&
        isSidebarLabel(mailbox) && !isExcludedLabel(mailbox) && !isTriage(mailbox);

    // Everything else a user label can be. Never added, removed, counted or
    // offered by anything here; the stock labels menu is for these.
    const isHelper = (mailbox) => isUserLabel(mailbox) &&
        !isTriage(mailbox) && !isProject(mailbox);

    const isProcess = (mailbox) => !!mailbox &&
        mailbox === processMailbox(mailbox.get('accountId'));

    const isDeferred = (mailbox) => !!mailbox &&
        deferredMailboxes(mailbox.get('accountId')).indexOf(mailbox) !== -1;

    const isNonInbox = (mailbox) => !!mailbox &&
        nonInboxMailboxes(mailbox.get('accountId')).indexOf(mailbox) !== -1;

    // A topic is any user label that is not the marker, not deferred and not a
    // qualifier. The topic rule keys off this: only picking a topic triages.
    // A topic: a user label that lives in the sidebar and is not a state
    // label, a qualifier, or struck out by name. Sidebar membership is the
    // rule — the archive shelf of hidden labels files history, not work.
    //
    // Non-inbox is excluded because the two are exclusive by construction: a
    // label either names work or names something kept to find again, and
    // naming it in nonInboxLabels is what says which.
    const isTopic = (mailbox) => isUserLabel(mailbox) &&
        isSidebarLabel(mailbox) && !isExcludedLabel(mailbox) &&
        !isProcess(mailbox) && !isDeferred(mailbox) && !isNonInbox(mailbox) &&
        qualifierRank(mailbox) === -1;

    // Filed at all — the question the topic rule actually asks. A non-inbox
    // label says what a message is about as surely as a topic does, so a
    // message carrying one has been placed and the picker has nothing left
    // to ask. Only the disposition differs, and that is runKeep's business.
    const isFiled = (mailbox) => isTopic(mailbox) || isNonInbox(mailbox);

    /*
     * ----------------------------------------------------------------
     * Counting
     * ----------------------------------------------------------------
     */

    // No scan of loaded messages drives any count here. The state mailboxes —
    // the Inbox, Process, the deferred labels — read Mailbox.totalThreads,
    // which the server maintains, push updates, and Fastmail adjusts
    // optimistically before the server confirms. A topic's Next count is
    // an intersection no record holds, so it comes from a registered query
    // whose total the server computes: see the primer below.

    // The JMAP connection carrying the Email, Thread and Mailbox types
    const mailSource = () => {
        const source = FastMail.store.source;
        const list = source && source.sources;
        return (list && list.filter(s => s.id === 'mail')[0]) || source;
    };

    // Status flag values, as Overture defines them. Only read, never written.
    const STATUS_LOADING = 16;
    const STATUS_OBSOLETE = 256;

    // The where for `next` on a mailbox: in it, and in the Inbox or in
    // Process, and in none of the deferred labels. Snoozed mail is already
    // outside (Inbox or Process) — naming it again in NOT is insurance.
    // For `deferred`: in it, and in one of the deferred labels.
    //
    // JMAP's NOT is a FilterOperator requiring all its conditions false, so
    // one node covers the whole deferred set.
    const whereFor = (mailbox, kind) => {
        const accountId = mailbox.get('accountId');
        const { inbox, process, deferred, nonInbox } = stateLabels(accountId);
        if (!inbox) return null;

        const conditions = [{ inMailbox: mailbox.get('id') }];

        // Kept, but filed away from the front door: carries the marker like
        // any other kept mail, so Next holds it too — this slice is what
        // tells the two apart.
        if (kind === NONINBOX_FILTER) {
            if (!nonInbox.length) return null;
            conditions.push({
                operator: 'OR',
                conditions: nonInbox.map(m => ({ inMailbox: m.get('id') }))
            });
            return { operator: 'AND', conditions };
        }

        if (kind === DEFERRED_FILTER) {
            if (!deferred.length) return null;
            conditions.push({
                operator: 'OR',
                conditions: deferred.map(m => ({ inMailbox: m.get('id') }))
            });
            return { operator: 'AND', conditions };
        }

        if (kind === TRIAGE_FILTER) {
            // Undecided: still in the Inbox, and carrying no verdict — the
            // decided are the kept (Process) and the deferred
            if (mailbox.get('id') !== inbox.get('id')) {
                conditions.push({ inMailbox: inbox.get('id') });
            }

            const decided = deferred.map(m => ({ inMailbox: m.get('id') }));
            if (process) decided.unshift({ inMailbox: process.get('id') });
            if (decided.length) {
                conditions.push({ operator: 'NOT', conditions: decided });
            }

            return { operator: 'AND', conditions };
        }

        const active = [{ inMailbox: inbox.get('id') }];
        if (process) active.push({ inMailbox: process.get('id') });
        conditions.push({ operator: 'OR', conditions: active });

        if (deferred.length) {
            conditions.push({
                operator: 'NOT',
                conditions: deferred.map(m => ({ inMailbox: m.get('id') }))
            });
        }

        return { operator: 'AND', conditions };
    };

    // A hand-made query must be registered under the id
    // Message.getQueryId(params) computes: the source resolves a response back
    // to its query by recomputing the id from the request arguments, so a
    // query filed under any other id never resolves. Measured.
    const registerQuery = (params) => {
        const id = FastMail.classes.Message.getQueryId(params);
        return FastMail.store.getQuery(id, FastMail.classes.MessageList, params);
    };

    // The primer. The stock client only asks the server to count when the
    // filter carries a top-level inMailbox, which an AND[…] never does — but
    // the server counts any filter when asked, even at limit 0 or 1, both
    // measured. One raw call with the query's own arguments plus
    // calculateTotal routes back to it by recomputed id and flips it exact:
    // hasTotal true, length the server's total. From then on every refresh
    // re-sends calculateTotal and the number stays exact for free.
    //
    // The filter and sort are passed as the query's own objects, so they
    // serialize byte-identical and the id matches.
    const primeQuery = (query, params) => {
        if (query.customPrimed) return;
        query.customPrimed = true;

        try {
            mailSource().callMethod('Email/query', {
                accountId: params.accountId,
                filter: params.where,
                sort: params.sort,
                collapseThreads: params.collapseThreads,
                position: 0,
                limit: 1,
                calculateTotal: true
            });
        } catch (error) {
            query.customPrimed = false;
            console.warn('Inbox mode: could not prime a query', error);
        }
    };

    // An unbound query does not refetch itself when a change marks it
    // obsolete — the view's own list has a controller observer doing that, so
    // ours get one too. fetch(true) takes the refresh path, which re-sends
    // calculateTotal for a query that has a total.
    const refetchWhenObsolete = (query) => {
        const status = query.get('status');
        if ((status & STATUS_OBSOLETE) && !(status & STATUS_LOADING)) {
            query.fetch(true);
        }
    };

    /*
     * Badge queries: one per label and filter — and one more for the
     * unread slice — built lazily when a badge first asks, kept for the
     * session. Cheap by construction — windowSize 10, one observed row —
     * and self-maintaining: any local move marks them obsolete through
     * Fastmail's own query-update pass, and the observer above refetches
     * with the total.
     */
    const badgeQueries = new Map();

    // The filtered slice's unread threads: the slice's own conditions plus
    // the standard keyword test, collapsed like the slice itself, so the
    // number is the server's — never a scan of loaded messages
    const unreadWhereFor = (mailbox, kind) => {
        const where = whereFor(mailbox, kind);
        if (!where) return null;

        // whereFor builds a fresh object per call, so the append is ours
        where.conditions.push({ notKeyword: '$seen' });
        return where;
    };

    const badgeQueryFor = (mailbox, kind, unread) => {
        const key = mailbox.get('id') + '|' + kind + (unread ? '|unread' : '');
        const existing = badgeQueries.get(key);
        if (existing) return existing.query;

        const where = unread
            ? unreadWhereFor(mailbox, kind)
            : whereFor(mailbox, kind);
        if (!where) return null;

        const params = {
            accountId: mailbox.get('accountId'),
            where,
            // A plain sort of its own: a count does not care about order, and
            // borrowing the view's sort would couple the badge to whichever
            // label is open
            sort: [{ property: 'receivedAt', isAscending: false }],
            collapseThreads: !!FastMail.preferences.get('enableConversations'),
            windowSize: 10
        };

        const query = registerQuery(params);
        if (!query.prefetch) query.prefetch = 5;

        const entry = {
            query,
            observer: { rangeDidChange() {} },
            watcher: {
                lengthDidChange: () => scheduleBadgeRepaint(),
                statusDidChange: () => refetchWhenObsolete(query)
            }
        };

        // A WindowedQuery fetches nothing until something observes a range
        query.addObserverForRange({ start: 0, end: 1 }, entry.observer, 'rangeDidChange');
        query.addObserverForKey('length', entry.watcher, 'lengthDidChange');
        query.addObserverForKey('status', entry.watcher, 'statusDidChange');
        query.getObjectAt(0);

        primeQuery(query, params);
        badgeQueries.set(key, entry);

        return query;
    };

    const dropBadgeQueries = () => {
        badgeQueries.forEach(({ query, observer, watcher }) => {
            try {
                query.removeObserverForRange({ start: 0, end: 1 }, observer, 'rangeDidChange');
                query.removeObserverForKey('length', watcher, 'lengthDidChange');
                query.removeObserverForKey('status', watcher, 'statusDidChange');
                query.destroy();
            } catch (error) {
                // A query the store already dropped is already gone
            }
        });
        badgeQueries.clear();
    };

    // Exact or nothing: length is a paging estimate until hasTotal, and an
    // estimate on a badge is worse than no badge
    const exactLength = (query) =>
        query && query.get('hasTotal') ? query.get('length') : null;

    // What a row's badge should read while the mode is on: the total of
    // the slice the label opens on — its own remembered filter — so the
    // number over the name is the number the click will show. A label
    // that opens unfiltered reads the Mailbox record, canonical and free.
    // With showFilteredCounts off, the old economy: state mailboxes show
    // plain totals, topics stay bare.
    const ownKind = (kind) => kind === DEFAULT_FILTER ||
        kind === TRIAGE_FILTER || kind === DEFERRED_FILTER ||
        kind === NONINBOX_FILTER;

    const countFor = (mailbox) => {
        if (!settings.showFilteredCounts) {
            if (mailbox.get('role') === 'inbox' ||
                    isProcess(mailbox) || isDeferred(mailbox)) {
                return mailbox.get('totalThreads') || 0;
            }
            return 0;
        }

        // Only the mode's own slices have a query to ask; a remembered
        // stock filter gets the plain total rather than a borrowed one
        const kind = filterFor(mailbox);
        if (!ownKind(kind)) return mailbox.get('totalThreads') || 0;

        return exactLength(badgeQueryFor(mailbox, kind, false)) || 0;
    };

    // The unread half of the badge — only where it is the shown slice's
    // own number. A pair whose halves come from different views would
    // read as one badge fighting itself, so anything else goes without.
    const unreadFor = (mailbox) => {
        if (!settings.showFilteredCounts) return 0;

        const kind = filterFor(mailbox);
        if (!ownKind(kind)) return 0;

        return exactLength(badgeQueryFor(mailbox, kind, true)) || 0;
    };

    // The heading's unread half: only the mode's own slices have an unread
    // query to ask; stock filters go without rather than guessing
    const headerUnreadFor = (mailbox, kind) => {
        if (!ownKind(kind)) return null;

        return exactLength(badgeQueryFor(mailbox, kind, true));
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
     * exposes window.native — a resolver it pulls on foreground, a setBadge
     * it forwards to the dock and the home screen — so the whole feature is
     * choosing the number: the total of settings.appBadgeLabel under
     * settings.appBadgeFilter, summed across accounts. In plain Safari
     * there is no window.native and none of this runs.
     */
    // The slices the badge setting accepts. A value written under the old
    // names is read as what it meant rather than as a typo that badges
    // nothing, which is what FILTER_ALIASES is for.
    const APP_BADGE_KINDS = {
        next: 1, triage: 1, deferred: 1, noninbox: 1
    };

    const appBadgeCount = () => {
        const path = String(settings.appBadgeLabel || '').trim().toLowerCase();
        if (!path) return null;

        const named = String(settings.appBadgeFilter || '').trim().toLowerCase();
        const kindName = FILTER_ALIASES[named] || named;
        const kind = APP_BADGE_KINDS[kindName] ? kindName : '';

        let total = 0;
        let found = false;

        FastMail.store.getAll(FastMail.classes.Mailbox).forEach((mailbox) => {
            if (mailboxPath(mailbox).toLowerCase() !== path) return;
            found = true;
            total += kind
                ? (exactLength(badgeQueryFor(mailbox, kind, false)) || 0)
                : (mailbox.get('totalThreads') || 0);
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
    // pushed number may be long stale. Installed only while the label
    // setting names something, so an emptied setting hands the shell its
    // own fallback reading back.
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
    // The write is a raw assignment rather than set(), so nothing is notified,
    // and the stock value is always put back.
    const withInboxCount = (mailbox, fn) => {
        const stock = mailbox.badgeCount;
        mailbox.badgeCount = countFor(mailbox);
        try {
            return fn();
        } finally {
            mailbox.badgeCount = stock;
        }
    };

    // The rows whose badge the mode owns: the Inbox and every user label.
    // System folders other than the Inbox keep whatever Fastmail draws.
    const managesBadge = (mailbox) => modeIsOn && !!mailbox &&
        (mailbox.get('role') === 'inbox' || isUserLabel(mailbox));

    // The unread half, written over the drawn badge: "12 (3)", the parens
    // in bold. Fastmail draws the total through the count swap above; the
    // decoration replaces the text afterwards, so zero unread leaves the
    // stock number exactly as drawn.
    const decorateBadge = (view, mailbox) => {
        const badge = view._badge;
        const node = badge && badge.nodeType === 1
            ? badge
            : (badge && typeof badge.get === 'function' && badge.get('layer'));
        if (!node) return;

        const total = countFor(mailbox);
        const unread = unreadFor(mailbox);
        if (!total || !unread) return;

        node.textContent = '';
        node.appendChild(document.createTextNode(total + ' '));

        const strong = document.createElement('b');
        strong.textContent = '(' + unread + ')';
        node.appendChild(strong);
    };

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
            const result = withInboxCount(mailbox, () => drawOriginal.apply(this, args));
            decorateBadge(this, mailbox);
            return result;
        };

        proto.redrawBadgeCount = function () {
            const mailbox = this.get('content');
            if (!managesBadge(mailbox)) {
                return redrawOriginal.apply(this, arguments);
            }

            const args = arguments;
            const result = withInboxCount(mailbox, () => redrawOriginal.apply(this, args));
            decorateBadge(this, mailbox);
            return result;
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
                console.warn('Inbox mode: could not repaint a badge', error);
            }
        });
    };

    /*
     * ----------------------------------------------------------------
     * Navigation
     * ----------------------------------------------------------------
     */

    const shortcut = (keystroke, fn) => {
        FastMail.ViewEventsController.kbShortcuts.register(keystroke, { do: fn }, 'do');
    };

    // Go somewhere the way clicking the sidebar would. select() copes with both
    // mailboxes and saved searches, and routes through goSource, so the sticky
    // filter is applied on the way.
    const selectSource = (source) => {
        if (source) controller().sources.select(source);
    };

    // The sources above the Labels heading — Inbox, Snoozed, Drafts and so on.
    // Fastmail divides the sidebar at the first mailbox without a role and
    // hands that split back as the first source group.
    //
    // That group is empty when a label is ordered ahead of a system folder,
    // which collapses the entire sidebar under Labels. Fall back to this
    // account's system mailboxes in sidebar order, so the keys still land
    // somewhere sensible rather than doing nothing.
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
     * ----------------------------------------------------------------
     * Inbox label on message rows
     * ----------------------------------------------------------------
     */

    // Every row in an inbox-filtered label is in the Inbox by definition, so
    // the Inbox chip on each row says nothing. Hide it there.
    //
    // Done in CSS rather than by patching the row drawing code: rows are drawn
    // and redrawn constantly as you scroll, and a stylesheet covers every one of
    // them without a hook. The chip carries the mailbox name as its title, which
    // is enough to select it. Fastmail's style-src allows inline styles, unlike
    // its script-src.
    // A chip's title is the mailbox name, so it has to survive being put in a
    // selector
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
            // holding a link and a remove button. The whole badge goes, not just
            // the link, or the × would be left behind on its own.
            //
            // Matched on the link's href rather than its text, because the text
            // is what the prefix stripping rewrites — and CSS cannot select on
            // text anyway. One rule covers every account: the path is the same
            // in each, only the ?u= differs.
            `.${HIDE_INBOX_LABEL_CLASS} .v-ThreadLabels .u-badge` +
            `:has(> a[href*="/mail/${cssString(encodeURIComponent(name))}/"])` +
            ' { display: none; }',

            // The phone's badge is a span with no href, so it is matched on the
            // name stamped by markBadge instead. Kept alongside the href rule
            // rather than replacing it: that one needs no script to have run, so
            // it still holds on the first paint of a reload.
            `.${HIDE_INBOX_LABEL_CLASS} .v-ThreadLabels` +
            ` .u-badge[${BADGE_NAME}="${cssString(name)}"]` +
            ' { display: none; }'
        ]), []);
    };

    // Mark each row with the colour of a label it carries, as a stripe down its
    // leading edge. Selecting on the chip Fastmail already draws means this
    // needs no hook into the row views, which matters because the list recycles
    // them as you scroll.
    //
    // A message carrying two coloured labels matches both rules, and the later
    // one wins — the labels are emitted in store order, so it is stable rather
    // than meaningful.
    // Theme colours, with the values Fastmail ships as a fallback
    const PAGE_BG = 'var(--ui-page-color-bg, #fff)';
    const FOCUSED_BG = 'var(--ui-page-color-bg-focused, #e9ebee)';
    const SELECTED_BG = 'var(--ui-page-color-bg-selected, #f2fafd)';
    // A row's label colour, falling back to the page colour so every mix below
    // collapses to exactly the stock background on rows without one
    const LABEL = `var(--custom-label-colour, ${PAGE_BG})`;

    // Rules that apply to every row and do nothing until a label colour is set.
    //
    // The tint has to be opaque. Fastmail declares `.u-list-link` and the time
    // and chip containers as `background-color: inherit`, so a translucent tint
    // gets repainted by each of them and stacks to roughly three times the
    // intended strength where they overlap. Mixing against the page colour
    // instead of transparent makes repainting it harmless.
    //
    // Hover and selection paint `.u-list-link`, which sits above the row, so
    // they would otherwise cover the tint entirely. Mixing the label colour
    // into those two backgrounds lets it show through both states.
    // The surfaces that make up a row's background. `.u-list-link` is the one
    // hover and selection paint: it is inset from the row and rounded, so
    // tinting the row itself would colour outside its edges. The rest declare
    // `background-color: inherit` and sit above the link, so they have to be
    // given the same colour or they punch holes in it.
    const TINT_TARGETS = '.u-list-link, .v-MailboxItem-time,' +
        ' .v-MailboxItem-mailboxes, .v-MailboxItem-mailbox, .v-MailboxItem-toolbar';

    const ROW_COLOUR_RULES = [
        `.v-MailboxItem .u-list-link` +
        ` { box-shadow: inset 4px 0 0 var(--custom-label-colour, transparent); }`,
        `.v-MailboxItem :is(${TINT_TARGETS})` +
        ` { background-color: color-mix(in srgb, ${LABEL} 10%, ${PAGE_BG}); }`,
        // .v-MailboxItem is added to these on purpose, and with no space.
        // Fastmail paints the focused and selected row with
        //
        //     .u-list-item.is-focused .u-list-link { background-color: … }
        //
        // which is three classes, and :is() counts only as its most specific
        // argument, so a plain `.u-list-item.is-focused :is(…)` ties and the
        // winner comes down to which stylesheet is later. The head start writes
        // ours before Fastmail's are parsed, so ours lost — for the link but
        // not for the date, which Fastmail leaves at `inherit`, and the date
        // came out tinted while the row it sits on did not.
        //
        // A fourth class settles it. It has to be part of the same compound
        // selector: the row element carries both names —
        // "v-MailboxItem u-list-item …" — so writing them with a space between
        // asks for a descendant that does not exist, and the rule matches
        // nothing at all. That leaves the date inheriting, which is the white
        // patch behind it.
        `.u-list-item.is-focused.v-MailboxItem :is(${TINT_TARGETS})` +
        ` { background-color: color-mix(in srgb, ${LABEL} 12%, ${FOCUSED_BG}); }`,
        `.u-list-item.is-selected.v-MailboxItem :is(${TINT_TARGETS})` +
        ` { background-color: color-mix(in srgb, ${LABEL} 12%, ${SELECTED_BG}); }`
    ];

    const labelColourRules = () => {
        // The colours are part of the mode, not of Fastmail
        if (!settings.labelColours || !modeIsOn) return [];

        const rules = ROW_COLOUR_RULES.slice();

        FastMail.store.getAll(FastMail.classes.Mailbox)
            // The Process marker is on everything kept, so tinting rows by it
            // would colour the whole Process list one shade and say nothing.
            // The colours are there to show what a message is about; being
            // kept is not what it is about. An option, since a colour you
            // have given the label is a choice, and you may want to see it.
            // "Sidebar only" once meant the saved-search inboxes of the old
            // workflow; that set is empty in the v2 model, which painted
            // nothing. Sidebar visibility is the living notion of the same
            // idea — the labels you actually file into.
            .filter(m => isUserLabel(m) && m.get('color') &&
                !(settings.labelColoursSkipProcess && isProcess(m)) &&
                (!settings.labelColoursSidebarOnly || isSidebarLabel(m) ||
                    isProcess(m) || isDeferred(m)))
            // A row carrying two coloured labels matches both rules and the
            // later one wins, so precedence is a matter of emission order.
            // Qualifiers go last, because being urgent outranks where a message
            // lives; and among themselves they go in reverse of the order you
            // named them, so the one you named first is emitted last and wins.
            .sort((a, b) => {
                const ra = qualifierRank(a);
                const rb = qualifierRank(b);

                if (ra === rb) return 0;
                if (ra === -1) return -1;
                if (rb === -1) return 1;

                return rb - ra;
            })
            .forEach(m => {
                const name = cssString(mailboxPath(m));
                const chip = `.v-MailboxItem-mailbox span[title="${name}"]`;

                // Each label only has to declare its colour; the rules above do
                // the rest, and custom properties inherit to the children that
                // need them
                rules.push(`.v-MailboxItem:has(${chip})` +
                    ` { --custom-label-colour: ${m.get('color')}; }`);

                // The row is tinted to the chip's own shade, so the chip needs
                // an edge of its own: a hairline on top, right and bottom,
                // leaving the left open so it reads as a tag rather than a box.
                //
                // The line is the page colour — white in the light theme, and
                // still the right separating colour in a dark one — so it reads
                // as a gap between chip and row rather than an outline.
                //
                // Drawn as inset shadows rather than a border: the list places
                // rows at a fixed height, and a real border would add to the
                // chip's size and nudge the row's contents.
                rules.push(`${chip} { box-shadow:` +
                    ` inset 0 1px 0 ${PAGE_BG},` +
                    ` inset -1px 0 0 ${PAGE_BG},` +
                    ` inset 0 -1px 0 ${PAGE_BG}; }`);
            });

        return rules;
    };

    // The line above a row that opens a new run. Which rows those are is worked
    // out in JS — it depends on each mailbox's role, which no selector can see —
    // and marked with a class, leaving the drawing here.
    //
    // The room the line sits in has to be taken, because the list leaves none.
    // It places every row itself — each carries `position: absolute` and a `top`
    // of its own, 26px apart and 26px tall — so the rows are packed edge to edge.
    //
    // A margin cannot open a gap in that. It slides one row down while every row
    // below stays at the offset the list gave it, so the row lands on top of the
    // next one: measured at 6px of margin, the Inbox row ran from 164 to 190
    // with the row after it fixed at 184. The gap is made with a transform
    // instead, applied in the marking pass — see markSourceGroups.
    //
    // How much room to take. Half of it falls above the line and half below,
    // which is what puts the line in the middle of the gap rather than against
    // one of the rows.
    const SEPARATOR_GAP = 8;

    // Drawn on the row and inset by hand, rather than hung off the link and
    // left to inherit its width. The link is the painted part — rounded,
    // highlighted, and held this far clear of each edge by a margin of its own —
    // so following it would have given the right width for free. But it is
    // `overflow: hidden`, and the line belongs above it, in the gap: drawn there
    // it was clipped away entirely, and drawn inside the link instead it cuts
    // across the rounded corners and reads as part of the pill rather than as a
    // division before it. The row clips nothing.
    //
    // So the inset is this script's, and has to match `.app-source`'s margin.
    // If Fastmail changes that the line is out by the difference — visibly
    // wrong, but only cosmetically. Measured against a drawn row: the row runs
    // 200.8px from x=8, the link 184.8px from x=16.
    const SEPARATOR_INSET = 8;

    // The colour is Fastmail's own divider, falling back to a neutral grey that
    // reads on a light theme or a dark one — the fallback also covers the
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
    //
    //     showExpando: i.length > 1
    //
    // in sourceGroups, where i is every account with mail — so a second account
    // puts an arrow there whether or not it shows anything in the sidebar. With
    // no other section to collapse to, the arrow only offers to hide the whole
    // sidebar. The class says that is the case; the rule does the hiding.
    const LONE_SECTION_RULES = [
        `.${LONE_SECTION_CLASS} .v-Sources-expando { display: none; }`
    ];

    // The bar's Pin while the open conversation is pinned: the same pair of
    // theme variables Fastmail's own list rule paints a pinned row's pin
    // with, so the two read as one state in either theme. The colour sits on
    // the icon alone; the word under it stays the toolbar's own.
    const PIN_STATE_RULES = [
        '.v-BottomToolbar .v-Button.custom-pinned svg.v-Icon {' +
        ' color: var(--ui-icon-pin-color-stroke);' +
        ' fill: var(--ui-icon-pin-color-fill); }',
        '.v-BottomToolbar .v-Button.custom-pinned svg.v-Icon * { fill: inherit; }'
    ];

    // The badge's unread half: heavier than the total beside it, so the
    // pair reads at a glance as "of which"
    const BADGE_UNREAD_RULES = [
        '.v-MailboxSource-badge b { font-weight: 800; }'
    ];

    // A pill for passive confirmations — the fallback only: showToast asks
    // Fastmail's own notification layer first and draws this by hand when
    // that container is not there to ask. Fixed above the bottom bar, dark
    // in either theme, gone on its own. pointer-events stays off so a toast
    // mid-fade never eats a tap meant for what is under it.
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

    // The line is the stylesheet's half of the option; the gap it sits in is the
    // marking pass's, since only that can move a row the list has pinned. Both
    // are answered when the option changes: applySettings restyles and refreshes.
    const sourceSeparatorRules = () =>
        (settings.sidebarSeparators ? SOURCE_SEPARATOR_RULES : []);

    /*
     * ----------------------------------------------------------------
     * A head start for the next load
     * ----------------------------------------------------------------
     */

    // None of this can run until Fastmail is ready, and Fastmail paints its
    // first rows before then, so on a fresh load they appear unstyled: the Inbox
    // chip shows and then vanishes, and colours arrive late. Neither the
    // stylesheet nor the body class needs Fastmail once they have been worked
    // out, so both are remembered here and replayed by the extension's
    // document_start script, before there is anything on screen to correct.
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

    // Whether to hide the chip depends on the mailbox being a user label, which
    // needs the store. Remembering the answer per URL sidesteps that: a view you
    // have opened before is right from the first paint, and any other is
    // corrected as soon as the store is up. EARLY_KEY_PARTS must stay in step
    // with the extension's copy of this, or nothing is ever found.
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

    // The router writes the URL on the run loop, so reading it as the answer is
    // worked out keys it to the view being left — which is how an answer meant
    // for a label ends up filed under the Inbox. Let the navigation settle, and
    // let the last answer win.
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
            .concat(TOAST_RULES)
            .join('\n');
        const existing = document.getElementById(STYLE_ID);

        rememberStyles(rules);

        if (existing) {
            existing.textContent = rules;

            // The head start puts this on <html> before Fastmail's own sheets
            // are parsed. Nothing here should depend on source order, but being
            // last is the safer place to stand.
            if (existing.parentNode !== document.body) document.body.appendChild(existing);
            return;
        }

        document.body.appendChild(
            FastMail.el('style', { type: 'text/css', id: STYLE_ID }, [rules])
        );
    };

    const updateInboxLabelVisibility = () => {
        const mailController = controller();

        // Under the `inbox` filter every row is in the Inbox by definition,
        // and under `triage` the query itself demands it. Under `next`
        // it is the flow that guarantees it: keeping leaves the Inbox on, so
        // Inbox-or-Process is the Inbox in practice. The chip that tells kept
        // from untriaged is Process, and it stays.
        //
        // Mail filed under a non-inbox label is the exception — it is the one
        // thing here without the Inbox — and it needs no exception, since a
        // chip it does not carry cannot be the one being hidden.
        const filter = mailController.get('mailboxFilter');
        const inboxOnly = isInboxSearch() ||
            ((filter === 'inbox' || filter === DEFAULT_FILTER ||
                filter === TRIAGE_FILTER) &&
                isUserLabel(mailController.get('mailbox')));

        const hide = modeIsOn && settings.hideInboxLabel && inboxOnly;

        // On <html>, not <body>. Fastmail rewrites body.className wholesale when
        // its root view redraws — that is how is-kbmode comes and goes — and any
        // class of ours on it is dropped without a classList call to observe.
        // Measured: a marker put on body vanished within seconds of ordinary
        // use, while the same marker on <html> survived. Nothing rewrites
        // <html>; Fastmail only touches it through classList for the theme.
        //
        // The chips reappeared the moment you started triaging because typing is
        // exactly what puts the app into keyboard mode.
        document.documentElement.classList.toggle(HIDE_INBOX_LABEL_CLASS, hide);
        rememberHideSoon(hide);
    };

    /*
     * ----------------------------------------------------------------
     * Toolbar indicator
     * ----------------------------------------------------------------
     */

    let indicatorView = null;

    const mailToolbar = () => {
        const page = document.getElementById('mailbox');
        const toolbar = page && page.querySelector('.v-Toolbar');
        return toolbar ? FastMail.getViewFromNode(toolbar) : null;
    };

    // The phone has no toolbar above the list and no filter control at all, so
    // the desktop's home for this button does not exist there. Its page header
    // ends in search and the three dots, and the switch goes between them.
    //
    // FastMail.isMobile rather than a width: the layout is chosen at load from
    // the user agent, so a narrow desktop window is still the desktop one.
    const headerSearch = () => {
        // The sidebar has a search field of its own, so the header's is picked
        // out by the header it sits in. This used to test that the icon was near
        // the top of the viewport, which held in a narrow desktop window and not
        // on a real phone: the app pads the header by the safe-area inset, so on
        // a notched device the icon starts some 50px down and the test failed —
        // no anchor, no button. Structure does not move.
        const header = Array.from(document.querySelectorAll('.v-PageHeader'))
            .find(node => node.querySelector('svg.i-search'));

        const icon = header && header.querySelector('svg.i-search');
        const button = icon && icon.closest('button');

        return button ? FastMail.getViewFromNode(button) : null;
    };

    // Where the button goes, and what it goes next to
    const indicatorHome = () => {
        if (FastMail.isMobile) {
            const search = headerSearch();
            const header = search && search.get('parentView');
            return header ? { parent: header, anchor: search, side: 'after' } : null;
        }

        const toolbar = mailToolbar();
        const anchor = indicatorAnchor();
        return toolbar && anchor
            ? { parent: toolbar, anchor: anchor, side: 'before' }
            : null;
    };

    // The filter control we sit to the left of
    const filterButton = () => {
        const page = document.getElementById('mailbox');
        const icon = page && page.querySelector('.v-Toolbar svg.i-filter');
        const button = icon && icon.closest('button');
        return button ? FastMail.getViewFromNode(button) : null;
    };

    // The same funnel the Triage row wears, so the switch and the list it
    // produces read as one thing. Classes are borrowed from an icon Fastmail
    // has already drawn — its own filter control by preference, since that sits
    // right beside this one — so sizing and colour come from the theme rather
    // than from anything hardcoded here.
    const inboxIcon = () => {
        // The phone has neither of the first two — it has no filter control at
        // all, and the sidebar holding the Inbox icon is off screen — so its own
        // header search icon stands in, which is the icon this one sits beside.
        const existing = document.querySelector('.v-Toolbar svg.i-filter') ||
            document.querySelector('svg.i-inbox') ||
            document.querySelector('svg.i-search');

        return existing ? filterGlyph(existing) : null;
    };

    const drawnIndicator = () => document.querySelector('.' + INDICATOR_CLASS);

    // Asking only whether the layer is in the document is not enough: insertView
    // draws on the run loop, so a second call before that lands would see
    // nothing and insert a duplicate. Check the toolbar's children too.
    const indicatorIsInPlace = () => {
        if (drawnIndicator()) return true;
        if (!indicatorView) return false;

        const home = indicatorHome();
        const children = home && home.parent.get('childViews');
        return !!children && children.indexOf(indicatorView) !== -1;
    };

    // A button in the bar above the thread list, left of the filter control —
    // or, on a phone, in the page header between search and the three dots.
    // It uses Fastmail's own button classes and its is-active state, so "on"
    // and "off" are the theme's activated and subtle colours rather than
    // anything hardcoded here. Clicking it toggles the mode.
    const addIndicator = () => {
        if (indicatorIsInPlace()) return;

        // Any earlier view went with the bar that held it
        indicatorView = null;

        const home = indicatorHome();
        if (!home) return;

        indicatorView = new FastMail.classes.ButtonView({
            // The phone's header buttons carry no subtleStandard, and giving it
            // one would make this the only boxed control up there
            type: INDICATOR_CLASS + (FastMail.isMobile
                ? ' v-Button--iconOnly'
                : ' v-Button--subtleStandard v-Button--sizeM' +
                  ' v-Button--iconOnly v-Button--tooltipLabel'),
            isActive: indicatorIsActive(),
            icon: inboxIcon(),
            label: 'Inbox mode',
            target: { toggleInboxMode: () => toggleCurrent() },
            method: 'toggleInboxMode'
        });

        try {
            home.parent.insertView(indicatorView, home.anchor, home.side);
        } catch (error) {
            console.warn('Inbox mode: could not add the toolbar indicator', error);
            indicatorView = null;
        }
    };

    // We sit to the left of the filter control. A view without one — an
    // in:inbox search — puts the sort control in that same place, so it stands
    // in and the button keeps its position.
    const indicatorAnchor = () => {
        const filter = filterButton();
        if (filter) return filter;

        const toolbar = mailToolbar();
        const children = toolbar && toolbar.get('childViews');
        if (!children) return null;

        return children.find(view => isViewOfClass(view, 'MenuButtonView')) || null;
    };

    const filterButtonNode = () => {
        const page = document.getElementById('mailbox');
        const icon = page && page.querySelector('.v-Toolbar svg.i-filter');
        return icon ? icon.closest('button') : null;
    };

    // Fastmail lights up the filter control for any filter at all, including
    // the one the mode applies itself. Next to our button that reads as two
    // active controls saying the same thing, so the Next filter is
    // excluded here and shown on our button instead. Any other filter —
    // including a hand-picked In Inbox — still lights it up; "All mail",
    // which is no filter, does not.
    //
    // Fastmail rewrites the button's type — is-active and all — whenever the
    // filter changes, so this has to run again after each such change.
    const updateFilterButton = () => {
        const node = filterButtonNode();
        if (!node) return;

        const filter = controller().get('mailboxFilter');
        const shouldBeActive = !!filter && !(modeIsOn && filter === DEFAULT_FILTER);
        const view = FastMail.getViewFromNode(node);

        if (view) {
            view.set('isActive', shouldBeActive);

            const type = view.get('type');
            if (typeof type === 'string') {
                const base = type.replace(/\s*\bis-active\b/g, '');
                view.set('type', shouldBeActive ? base + ' is-active' : base);
            }
        }

        node.classList.toggle('is-active', shouldBeActive);
    };

    // The button acts on what you are looking at. On a label it is that label's
    // switch and nothing else's; anywhere else there is no label for it to mean,
    // so it is the global one — which is what Shift-I always is.
    const currentLabel = () => {
        const mailController = controller();
        if (mailController.get('search')) return null;

        const mailbox = mailController.get('mailbox');

        // A deferred label has nothing for a per-label switch to mean — its
        // default is All mail, and `actionable` would show an empty list — so
        // the button is the global switch there, as on the Inbox. A non-inbox
        // label is an ordinary label for this: its mail carries the marker.
        return isUserLabel(mailbox) && !isDeferred(mailbox) ? mailbox : null;
    };

    const indicatorIsActive = () => {
        const label = currentLabel();
        return label ? modeForLabel(label) : modeIsOn;
    };

    // Fastmail's is-active is a faint grey wash behind the icon — enough to
    // separate a pressed button from an unpressed one, not enough for a switch
    // you want to read at a glance. The accent says it plainly.
    //
    // The theme has no custom properties to ask: each one ships concrete
    // colours. So it is read off the compose button, which is the one thing
    // always painted in the accent, and follows the theme for free.
    const accentColour = () => {
        // The theme keeps its palette here, one set per appearance:
        // accent5 through accent120, of which accent100 is the accent proper.
        // Read rather than cached, so following the system into dark and back
        // needs nothing.
        const theme = FastMail.theme;
        const palette = theme && theme.colors &&
            theme.colors[theme.isDark ? 'dark' : 'light'];

        if (palette && palette.accent100) return palette.accent100;

        // Sampled from the compose button if the palette ever moves. This was
        // the only way at first, and it is why it is only the fallback: the
        // phone draws no button in the accent anywhere on the list screen, so
        // there was nothing to sample and the switch stayed grey.
        const cta = document.querySelector('.v-Button--cta');
        const colour = cta && getComputedStyle(cta).backgroundColor;

        return colour && colour !== 'transparent' && !/,\s*0\)$/.test(colour)
            ? colour
            : null;
    };

    // Empty rather than a colour for "off", so it drops back to whatever the
    // theme gives the other icons around it. Every drawn switch is painted, not
    // just the first: the phone has one in each of its two page titles.
    const paintIndicator = (active) => {
        Array.from(document.querySelectorAll('.' + INDICATOR_CLASS)).forEach((layer) => {
            const glyph = layer.querySelector('svg');
            if (glyph) glyph.style.color = active ? (accentColour() || '') : '';
            layer.classList.toggle('is-active', active);
        });
    };

    /*
     * ----------------------------------------------------------------
     * The phone's switch
     * ----------------------------------------------------------------
     */

    // The phone's message toolbar is Labels / Delete / Remove / Snooze / More.
    // Remove takes off whichever label you are looking at — in the triage list
    // that means "not triaged any more", in the Inbox it means archive — so it
    // is the one button here that cannot file a message anywhere. Move to can,
    // and it is buried in More. They swap.
    //
    // What comes out is Snooze / Labels / Archive / Move to / More: the three
    // that file a message somewhere in the middle, Snooze — which only defers
    // one — ahead of them, and everything else a tap further into More.
    //
    // Fastmail's own Move to view is moved rather than rebuilt. It anchors its
    // popover with `alignWithView: this`, so it lines up wherever it is put; and
    // being the same view the v shortcut already identifies, tapping it opens
    // the narrowed additive menu rather than the stock one, exactly as v does.
    const messageToolbar = () => {
        const bar = document.querySelector('.v-BottomToolbar .v-Toolbar');
        return bar ? FastMail.getViewFromNode(bar) : null;
    };

    /*
     * A button's real name.
     *
     * ToolbarView keeps every view it was built with in a registry — the
     * message bar registers archive, removeLabel, snooze, trash, spam,
     * phishing, labels, move, copy, read, unread, flag, unflag, follow,
     * unfollow and mute, on both platforms, plus overflow for the More
     * button itself — and getView hands one back by that name. Identical
     * names on desktop and mobile, measured in the app's own toolbar
     * construction.
     *
     * That name is the sturdiest handle there is. It survives translation,
     * which a label does not. It survives a bar too narrow to draw the
     * button, which a glyph search does not. It survives a platform with no
     * keyboard, which a shortcut does not — and that last one is the whole
     * history of the topic picker failing on the phone. So it is asked
     * first everywhere, and the older tests stay behind it for a toolbar
     * that registers nothing under the name.
     */
    // Which bar answers to a name is remembered, because the predicates
    // below are called once per view in a filter and a fresh sweep of the
    // document each time would be paid for on every pass of the bar
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

        // Every bar on screen, not just the phone's: the desktop registers
        // the same names on the toolbar it draws beside an open message,
        // and a bar that has never heard of the name simply says so.
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

    const isRegisteredAs = (target, name) =>
        !!target && registeredToolbarView(name) === target;

    // The More button. ToolbarView registers its own under "overflow" in
    // init, before any caller adds a thing, so the name is there on every
    // bar there is; the class scan behind it covers a toolbar we were
    // handed rather than found.
    const toolbarOverflowView = (toolbar) => {
        if (!toolbar || typeof toolbar.get !== 'function') return null;

        try {
            if (typeof toolbar.getView === 'function') {
                const registered = toolbar.getView('overflow');
                if (registered) return registered;
            }

            return (toolbar.get('childViews') || []).filter(view =>
                isViewOfClass(view, 'OverflowMenuView'))[0] || null;
        } catch (error) {
            return null;
        }
    };

    const actionOf = (view) => {
        try {
            return String(view.get('action') || '');
        } catch (error) {
            return '';
        }
    };

    const DELETE_ACTION = 'deleteToTrash';
    // Pinning is flagging; Fastmail's own button for it says Pin
    const PIN_ACTION = 'flag';
    const ARCHIVE_ACTION = 'archive';
    const SNOOZE_SHORTCUT = 'b';

    // Our own "Remove label", since Fastmail draws no such button here: the
    // third slot holds one contextual view that reads Archive while the view is
    // filtered to the Inbox — which, in this mode, every label view is — and
    // Remove only otherwise. So the label-removing verb has nowhere to live
    // unless we give it one.
    // Fastmail's own i-removelabel, copied shape for shape. Drawn rather than
    // cloned because the icon is only on screen in the very case this option
    // exists to cover the absence of: while the view is filtered to the Inbox —
    // which is every label view here — the button it belongs to reads Archive
    // and this glyph is nowhere in the document to copy.
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

    // The app's own glyph, taken from the button that owns it.
    //
    // Both shape tables above exist because these options serve exactly the
    // views where the stock button is not on the bar, so there was no copy
    // in the document to clone — only a copy in the source to transcribe,
    // which is what a shape table is, and what stops matching the moment
    // Fastmail redraws an icon. The registry settles it: it hands over the
    // button whether or not it is drawn, and the icon element it was built
    // with comes with it.
    //
    // The class is checked rather than assumed, because the slot these
    // stand in for is contextual — one view reading Archive or Remove by
    // where you are standing — and a glyph that is not the one asked for is
    // worse than the transcribed one.
    const borrowedIcon = (name, className) => {
        try {
            const view = registeredToolbarView(name);
            const icon = view && view.get('icon');
            if (!icon || icon.nodeType !== 1 || !icon.cloneNode) return null;

            const copy = icon.cloneNode(true);
            const classes = (copy.getAttribute('class') || '').split(/\s+/);
            return classes.indexOf(className) === -1 ? null : copy;
        } catch (error) {
            return null;
        }
    };

    const removeLabelIcon = () => borrowedIcon('removeLabel', 'i-removelabel') ||
        standardIcon('i-removelabel', REMOVE_LABEL_SHAPES);

    const removeLabelOption = () => new FastMail.classes.ButtonView({
        label: 'Remove label',
        icon: removeLabelIcon(),
        target: { removeLabel: () => controller().actions.removeCurrent(null) },
        method: 'removeLabel'
    });

    // An archive crate in the same hand, for the same reason: the views the
    // button below serves are exactly the ones with no archive glyph on
    // screen to copy
    const ARCHIVE_SHAPES = [
        ['rect', { x: '3.75', y: '4.75', width: '16.5', height: '3.5', rx: '0.75' }],
        ['path', { d: 'M5.25,8.25v9a2,2,0,0,0,2,2h9.5a2,2,0,0,0,2-2v-9' }],
        ['line', { x1: '9.75', y1: '12.25', x2: '14.25', y2: '12.25' }]
    ];

    const archiveIcon = () => borrowedIcon('archive', 'i-archive') ||
        standardIcon('i-archive', ARCHIVE_SHAPES);

    // The processed archive for a label view: the same wrapped verb the
    // Inbox's own button runs — Process and the deferred set come off if
    // present, the Inbox too, the topic stays on as the filing. The
    // i-archive class is load-bearing: it is how the long press finds
    // this button.
    const archiveOption = () => new FastMail.classes.ButtonView({
        label: 'Archive',
        icon: archiveIcon(),
        target: { archive: () => controller().actions.archive(null) },
        method: 'archive'
    });

    // The phone's spellings of the state verbs, for More: keep a tick,
    // waiting a clock, someday a moon. Feather glyphs, stroke-drawn like
    // the rest of the bar.
    //
    // Sized to the bar the way the toolbar funnel is, and for the same
    // reason: Feather draws to the edges of its 24-unit box while Fastmail's
    // glyphs sit well inside theirs. Measured in that box, keep covered 20
    // units — its circle 2 to 22, its tick reaching past that to the corner
    // — against the 16.5 of the archive crate beside it and the 14.5 of the
    // remove-label tag, and read a third too big on the bar.
    //
    // So each is scaled about the centre by whatever brings it to 15.5,
    // between those two: keep by 0.775, waiting by 0.838, someday by 0.861,
    // which lands all three on an outer radius of 7.75. The geometry is
    // scaled rather than a transform put over it, so the stroke keeps the
    // weight the rest of the bar is drawn at.
    const STATE_VERB_SHAPES = {
        keep: [
            ['path', { d: 'M19.75,11.29V12a7.75,7.75,0,1,1-4.6-7.08' }],
            ['polyline', { points: '19.75 5.8 12 13.56 9.68 11.23' }]
        ],
        waiting: [
            ['circle', { cx: '12', cy: '12', r: '7.75' }],
            ['polyline', { points: '12 7.81 12 12 14.93 13.47' }]
        ],
        someday: [
            ['path', { d: 'M19.75,12.68A7.75,7.75,0,1,1,11.32,4.25,6.03,6.03,0,0,0,19.75,12.68Z' }]
        ]
    };

    // Dispatched a tick later so the More popover has finished closing:
    // an unfiled conversation sends these to the Labels sheet, and two
    // menus fighting over the same moment is how taps get eaten
    const stateVerbOption = (label, kind) => {
        const option = new FastMail.classes.ButtonView({
            label: label,
            icon: standardIcon('i-' + kind, STATE_VERB_SHAPES[kind]),
            target: { run: () => setTimeout(() => runVerb(kind, null), 0) },
            method: 'run'
        });

        // The kind, not a bare flag: the bar slots tell the three apart
        option.customStateVerb = kind;
        return option;
    };

    // How many verbs fit: the bar's own width over a thumb-sized slot,
    // one always held back for More. Falls back to the viewport when the
    // bar has not been measured yet.
    const SLOT_WIDTH = 76;

    const barCapacity = (toolbar) => {
        let width = 0;
        try {
            const layer = toolbar.get('layer');
            width = (layer && layer.offsetWidth) || 0;
        } catch (error) {
            width = 0;
        }
        if (!width) width = window.innerWidth || 375;

        return Math.max(1, Math.floor(width / SLOT_WIDTH) - 1);
    };

    const dressToolbar = () => {
        const toolbar = messageToolbar();
        if (!toolbar) return;

        const overflow = toolbarOverflowView(toolbar);
        const menu = overflow && overflow.get('menuView');
        if (!menu) return;

        try {
            // The bar holds whatever settings.bottomBarSlots names, in that
            // order; every other verb waits in More. Everything is found by
            // what it does rather than by what it reads — action, shortcut,
            // our own marks — because the words are translated and would
            // match in one language only. And every step is written to be
            // safe to run again: this runs on each rebuilt bar, and a step
            // that only appends is how More once held four copies of Delete.
            const onBar = (test) => (toolbar.get('childViews') || []).filter(test)[0];
            const inMore = (test) => (menu.get('options') || []).filter(test)[0];
            const isPin = (view) => actionOf(view) === PIN_ACTION;

            const dropFromMore = (view) => menu.set('options',
                (menu.get('options') || []).filter(option => option !== view));
            const addToMore = (view) => menu.set('options',
                (menu.get('options') || []).concat([view]));

            // The slot vocabulary. The three state verbs can be made from
            // nothing, since Fastmail draws no button for them; the rest are
            // stock views, found wherever the last pass left them.
            const SLOT_KINDS = {
                snooze: { test: (view) => hasShortcut(view, SNOOZE_SHORTCUT) },
                pin: { test: isPin },
                archive: {
                    test: (view) =>
                        actionOf(view) === ARCHIVE_ACTION || !!view.customArchive
                },
                labels: { test: isLabelsButton },
                move: { test: isMoveButton },
                'delete': { test: (view) => actionOf(view) === DELETE_ACTION },
                keep: {
                    test: (view) => view.customStateVerb === 'keep',
                    make: () => stateVerbOption('Keep', 'keep')
                },
                waiting: {
                    test: (view) => view.customStateVerb === 'waiting',
                    make: () => stateVerbOption('Waiting', 'waiting')
                },
                someday: {
                    test: (view) => view.customStateVerb === 'someday',
                    make: () => stateVerbOption('Someday', 'someday')
                }
            };

            // The setting is an order over every verb, not a subset: kinds
            // it does not name join at the end, so an older saved value
            // still places all nine somewhere
            const named = String(settings.bottomBarSlots || '')
                .split(',')
                .map(part => part.trim().toLowerCase())
                .filter(name => SLOT_KINDS[name]);

            Object.keys(SLOT_KINDS).forEach((name) => {
                if (named.indexOf(name) === -1) named.push(name);
            });

            // Sizing decides visibility: as many leading verbs as the bar
            // is wide, one slot always held back for More
            const slotNames = named.slice(0, barCapacity(toolbar));
            const overflowNames = named.slice(slotNames.length);

            // A topic or Process view is past filing: getting here at all
            // means the label is on, so the slot Fastmail fills contextually
            // holds the wrong verb — Remove label, the unfiling correction —
            // where processing belongs. Swap the slot for an Archive running
            // the full verb; Remove label keeps its home in More below. Off
            // the topic labels — Inbox, deferred lists, mode off, or a bar
            // configured without Archive — the stock slot stands.
            const wantArchiveSlot = modeIsOn && !!currentLabel() &&
                slotNames.indexOf('archive') !== -1;
            const barArchive = onBar(view => view.customArchive);
            const hasRemoveIcon = (view) => {
                try {
                    const layer = view.get('layer');
                    return !!(layer && layer.querySelector('svg.i-removelabel'));
                } catch (error) {
                    return false;
                }
            };

            if (wantArchiveSlot) {
                const stockRemove = onBar(hasRemoveIcon);
                if (stockRemove) {
                    toolbar.customStockRemove = stockRemove;
                    toolbar.removeView(stockRemove);
                }

                // Only where no archive of any kind sits already — under a
                // filter Fastmail recognizes the stock slot is one, and a
                // second would just be the first twice
                if (!barArchive &&
                    !onBar(view => actionOf(view) === ARCHIVE_ACTION)) {
                    const archive = archiveOption();
                    archive.customArchive = true;
                    toolbar.insertView(archive, overflow, 'before');
                }
            } else if (barArchive) {
                toolbar.removeView(barArchive);
                if (toolbar.customStockRemove) {
                    toolbar.insertView(toolbar.customStockRemove, overflow, 'before');
                    toolbar.customStockRemove = null;
                }
            }

            // Off the bar and into More: every kind past the cut. A stock
            // view keeps existing in More; a state verb's button is reused
            // the same way.
            overflowNames.forEach((name) => {
                const view = onBar(SLOT_KINDS[name].test);
                if (!view) return;

                toolbar.removeView(view);
                if (!inMore(SLOT_KINDS[name].test)) addToMore(view);
            });

            // Onto the bar: whatever the setting names that is not there
            // yet — lifted out of More first so nothing is drawn twice, or
            // made fresh when there is nothing to lift
            slotNames.forEach((name) => {
                const kind = SLOT_KINDS[name];
                if (onBar(kind.test)) return;

                const lifted = inMore(kind.test);
                if (lifted) {
                    dropFromMore(lifted);
                    toolbar.insertView(lifted, overflow, 'before');
                    return;
                }

                if (kind.make) {
                    const made = kind.make();
                    toolbar.insertView(made, overflow, 'before');
                }
            });

            // The order is the setting's, stated once rather than arrived at
            // by nudging one past another. Each is taken out and put back
            // against More in turn, which lands them in exactly this order
            // from whatever order they were in. Skipped when the bar already
            // reads that way: this runs on every rebuilt bar and every
            // resize, and pulling views through the DOM to land them where
            // they already stand is churn a redraw can notice.
            const wanted = slotNames
                .map(name => onBar(SLOT_KINDS[name].test))
                .filter(Boolean);
            const bar = toolbar.get('childViews') || [];
            const moreAt = bar.indexOf(overflow);
            const inOrder = moreAt >= wanted.length && wanted.every(
                (view, index) => bar[moreAt - wanted.length + index] === view);

            if (!inOrder) {
                wanted.forEach((view) => {
                    toolbar.removeView(view);
                    toolbar.insertView(view, overflow, 'before');
                });
            }

            // The stock button carries `flag`, which only ever sets: in More
            // it could be rebuilt to say Unpin, but lifted onto the bar it
            // froze as Pin. Wrapped into a toggle instead — pressed on a
            // pinned conversation it unpins, and the paint follows at once.
            const barPin = onBar(isPin);
            if (barPin && !barPin.customToggles &&
                typeof barPin.activate === 'function') {
                barPin.customToggles = true;

                const originalActivate = barPin.activate;

                barPin.activate = function () {
                    if (openThreadIsPinned()) {
                        const actions = controller().actions;
                        const keys = resolveKeys(actions, null);
                        if (keys) {
                            actions.unflag(keys);
                            updatePinState();
                            return this;
                        }
                    }

                    const result = originalActivate.apply(this, arguments);
                    updatePinState();
                    return result;
                };
            }

            // The states the keyboard spells v, w and o, for thumbs. One
            // named as a slot is already on the bar; the rest wait in More,
            // one tap further.
            [['Keep', 'keep'], ['Waiting', 'waiting'], ['Someday', 'someday']]
                .forEach(([label, kind]) => {
                    if (slotNames.indexOf(kind) !== -1) return;
                    if (inMore(SLOT_KINDS[kind].test)) return;
                    addToMore(stateVerbOption(label, kind));
                });

            // More reads in the list's order too: the known verbs are
            // pulled out and re-appended in sequence, after Fastmail's own.
            // Written back only when that moves something — a fresh array on
            // every pass would redraw a menu that already reads correctly.
            const moreNow = menu.get('options') || [];
            const ordered = [];
            named.forEach((name) => {
                const view = inMore(SLOT_KINDS[name].test);
                if (view) ordered.push(view);
            });
            if (ordered.length) {
                const reordered = moreNow
                    .filter(option => ordered.indexOf(option) === -1)
                    .concat(ordered);
                if (reordered.some((option, index) => option !== moreNow[index])) {
                    menu.set('options', reordered);
                }
            }

            const current = menu.get('options') || [];
            if (!current.some(option => option.customRemoveLabel)) {
                const option = removeLabelOption();
                option.customRemoveLabel = true;
                menu.set('options', current.concat([option]));
            }
        } catch (error) {
            console.warn('Inbox mode: could not rearrange the toolbar', error);
        }
    };

    // The bar's Pin says nothing about state as Fastmail draws it: one
    // outline, whatever the thread carries. Painted here instead — filled in
    // Fastmail's own pin red while the open conversation is pinned — from
    // the same test the verbs read, and repainted from the same Message
    // event that already drives every other repaint.
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

    const updatePinState = () => {
        if (!FastMail.isMobile) return;
        const toolbar = messageToolbar();
        if (!toolbar) return;

        const pin = (toolbar.get('childViews') || [])
            .filter(view => actionOf(view) === PIN_ACTION)[0];
        if (!pin) return;

        let layer = null;
        try {
            layer = pin.get('layer');
        } catch (error) {
            return;
        }
        if (!layer) return;

        layer.classList.toggle('custom-pinned', openThreadIsPinned());
    };

    const toggleCurrent = () => {
        const label = currentLabel();
        if (!label) return toggleMode();

        const turningOn = !modeForLabel(label);

        // Turning a label back on while the mode itself is off would change
        // nothing you can see, so take it to mean both
        if (turningOn && !modeIsOn) {
            rememberFilter(label, DEFAULT_FILTER);
            setMode(true);
            return;
        }

        rememberFilter(label, turningOn ? DEFAULT_FILTER : '');
        controller().set('mailboxFilter', turningOn ? DEFAULT_FILTER : '');
        refresh();
    };

    const removeIndicator = () => {
        const toolbar = mailToolbar();

        if (indicatorView && toolbar && typeof toolbar.removeView === 'function') {
            try {
                toolbar.removeView(indicatorView);
            } catch (error) {
                console.warn('Inbox mode: could not remove the toolbar indicator', error);
            }
        }

        // Whatever the view system made of that, make sure nothing is left drawn
        const layer = drawnIndicator();
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);

        indicatorView = null;
    };

    // A search that starts with in:inbox is an Inbox view by another name — the
    // saved search listing what has not been triaged yet. Fastmail offers no
    // filter control there, but the mode still has everything to say about it.
    const INBOX_SEARCH = /^\s*in:inbox\b/i;

    const isInboxSearch = () => INBOX_SEARCH.test(controller().get('search') || '');

    // Whether this screen has a filter for the mode to be about. Settings,
    // Contacts and the rest are not mail at all; search results are mail, but
    // Fastmail offers no filter there. Both readings come from the route rather
    // than from the toolbar, which is still the old one at the point the
    // observers fire.
    const modeAppliesHere = () =>
        FastMail.router.get('app') === 'mail' &&
        (!controller().get('search') || isInboxSearch());

    // canFilter says whether the button belongs on this screen, but not whether
    // there is yet anywhere to put it: the observers run before Overture has
    // drawn the new bar, so coming back from a search or from Settings there is
    // no filter control to sit left of. Keep trying for a second, then give up
    // rather than spin forever on a page that is never going to have one.
    let placeTimer = null;
    let placeTries = 0;

    const stopPlacing = () => {
        if (placeTimer) clearTimeout(placeTimer);
        placeTimer = null;
        placeTries = 0;
    };

    const placeIndicator = () => {
        placeTimer = null;
        addIndicator();
        paintIndicator(indicatorIsActive());

        if (indicatorIsInPlace() || placeTries >= 20) {
            stopPlacing();
            return;
        }

        placeTries += 1;
        placeTimer = setTimeout(placeIndicator, 50);
    };

    // The toolbar is rebuilt as you move around, so re-add when it has gone —
    // and on a screen with no filter of its own, take the button away rather
    // than leave it sitting there alone.
    const updateIndicator = () => {
        if (modeAppliesHere()) {
            if (FastMail.isMobile) {
                dressToolbar();
                updatePinState();
            }

            if (!placeTimer) placeIndicator();

            if (indicatorView) {
                const active = indicatorIsActive();
                indicatorView.set('isActive', active);

                // className recomputes correctly but Overture does not write it
                // back to the layer for a view inserted this way, so apply it by
                // hand. Go via the drawn node rather than the view's own layer,
                // so this still works if the toolbar was rebuilt under us.
                const layer = drawnIndicator();
                if (layer) layer.classList.toggle('is-active', active);

                paintIndicator(active);
            }
        } else {
            removeIndicator();
        }

        ensureFilterMenuPatched();
        ensureMobileFilterMenuPatched();
        updateFilterButton();
        updateInboxLabelVisibility();
    };

    // Start each move over: whatever we were waiting to place belonged to the
    // screen we have just left.
    const refreshToolbar = () => {
        stopPlacing();
        updateIndicator();
    };

    /*
     * ----------------------------------------------------------------
     * Drag and drop
     * ----------------------------------------------------------------
     */

    // Overture's copy drag effect, which is what holding Option asks for
    const DRAG_EFFECT_COPY = 1;

    // Dropping a message on a label adds it, and the rules under every menu
    // do the rest: a project takes Triage and any other project off, the
    // Inbox stays. Option restores the stock move.
    const patchDrop = () => {
        const proto = FastMail.classes.MailboxSourceView.prototype;
        const original = proto.drop;

        proto.drop = function (drag) {
            if (!modeIsOn || !settings.dragAdditive) return original.apply(this, arguments);

            const mailbox = this.get('content');
            if (!mailbox.get('mayAddItems')) return;

            drag.getDataOfType('MessageStoreKeys', (storeKeys) => {
                if (!storeKeys) return;

                const actions = controller().actions;
                const optionHeld = !!(drag.get('dropEffect') & DRAG_EFFECT_COPY);

                if (optionHeld) {
                    // Fastmail's move: Inbox off, label on. Asked for with a
                    // modifier, so left exactly as asked — rule 2 still takes
                    // Triage and any other project off underneath.
                    actions.move(storeKeys, mailbox);
                } else if (!FastMail.preferences.get('inLabelsMode')) {
                    actions.copy(storeKeys, mailbox);
                } else {
                    // An add. A project replaces by rule 2; a helper is just
                    // added; a named one files the sender by rule 3.
                    actions.add(storeKeys, mailbox);
                }
            });
        };
    };

    /*
     * ----------------------------------------------------------------
     * The Labels menu
     * ----------------------------------------------------------------
     */

    // Move to is the quick one: a plain list with no checkboxes and no Save, so
    // a message is filed by typing a few letters. What it does at the end is
    // wrong for triage, though — it moves, taking the message out of the Inbox.
    //
    // So v opens it narrowed to the sidebar's labels, taking the last one
    // standing, and adding the label rather than moving to it. Option-V opens
    // it as it comes. Labels is untouched.
    //
    // True only while the menu about to open is ours. Read as the menu enters
    // the document, then cleared, so every other way in gets the stock one.
    let wantOurMove = false;

    // The options list is an OptionsProxy, which reports a length and answers
    // getObjectAt but whose map() yields nothing and whose get('[]') is null.
    // It has to be walked by index; toArray sees the map and returns empty.
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

    // Once typing has left a single label, save it. apply() commits only after
    // the menu has left the document — it is the on-close handler, not a
    // button — so closing is what saves, exactly as dismissing it by hand does.
    //
    // Never the create-a-label option, though: that would invent labels out of
    // half-typed words.
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
    // narrowing the list. rolesVisible cannot express that, so it is filtered
    // here as well.
    //
    // Triage goes too, while you are standing in it. Everything listed there
    // carries the label — that is what the list is — so offering it back only
    // files a message where it already is. The menu adds rather than moves, so
    // picking it would not even be a mistake, just a keystroke that does
    // nothing, and one fewer option is one less thing to type past.
    //
    // Not behind a setting of its own: this takes away only an option that
    // could not have done anything from where you are standing.
    //
    // None of it applies once you start typing. Both of those narrowings shape
    // the list you are handed; neither should stand between you and a label you
    // have named. Asking for a label by name and being told there is no such
    // thing, when there is, is worse than a longer list to look at.
    //
    // Trash, Archive and Spam stay out either way. Those never reach here:
    // rolesVisible drops them inside Fastmail's own filtering, which runs
    // before this and is left alone.
    const narrowLabelOptions = (menuController) => {
        if (menuController.customFilter) return;
        menuController.customFilter = true;

        const originalFilterOptions = menuController.filterOptions;

        menuController.filterOptions = function () {
            const options = originalFilterOptions.apply(this, arguments);

            if (this.customLabels) return labelsMenuOptions(this, options);

            if (!this.customOurs) return options;

            // Typing is asking for something by name
            if (this.get('search')) return options;

            return options.filter((option) => {
                // Leave anything that is not a mailbox alone: "Create label…"
                // is an option in this list too
                if (!(option instanceof FastMail.classes.Mailbox)) return true;

                return !settings.labelsSidebarOnly || isProject(option);
            });
        };
    };

    // Move to files by moving: measured, its didSelect is a one-shot
    // `actions.move(null, mailbox)`, where null means the current selection.
    // Swapped for an add, it is this script's picker, and the pick decides
    // nothing: it is an ordinary add, and the rules under every menu finish
    // it — a project takes Triage and any other project off, a named label
    // files the sender, a helper label is simply added.
    //
    // didSelect is where the work happens for this menu — there is no apply to
    // commit, unlike the tristate Labels menu — so it is also where the list is
    // asked to fetch again, covering both auto-save and picking by hand.
    // The Labels menu is the tristate one: it adds and removes rather than
    // moving, and stays open as you pick. Fastmail asks it for both verbs at
    // once, which is what tells it apart from Move to — measured on a drawn
    // menu, willAdd and willRemove are both true there and neither is here.
    const isLabelsMenu = (menu) => !!menu.get('willAdd') && !!menu.get('willRemove');

    // Picking a qualifier leaves the menu open: a message can be waiting *and*
    // somewhere, so there is likely another choice coming, and selectFocused
    // has already cleared what you typed. Picking an inbox label is the placing
    // decision, so it commits — done() hides the menu, and this menu applies
    // what you chose on the way out.
    //
    // Wrapped around select rather than around the key or the tap, because both
    // of those arrive here: keydown routes Enter to selectFocused, which selects,
    // and the option view's toggle selects too. One hook, and typing and tapping
    // cannot drift apart.
    const submitAfterPlacing = (menuController, menu) => {
        if (menuController.customSubmit) return;
        menuController.customSubmit = true;

        const originalSelect = menuController.select;

        menuController.select = function (option) {
            const result = originalSelect.apply(this, arguments);

            if (!this.customLabels) return result;
            if (!(option instanceof FastMail.classes.Mailbox)) return result;
            if (qualifierRank(option) !== -1) return result;

            if (typeof menu.done === 'function') menu.done();

            return result;
        };
    };

    // Narrowed to the projects you can file under. Typing still reaches
    // anything, as in the other menu: being handed a shorter list is not the
    // same as being told a label does not exist — which is how a helper
    // label like `c` or Later is ticked from here.
    const labelsMenuOptions = (menuController, options) => {
        if (menuController.get('search')) return options;

        return options.filter((option) => {
            if (!(option instanceof FastMail.classes.Mailbox)) return true;
            if (option.get('role')) return false;
            return isProject(option);
        });
    };

    const applyLabelsMode = (menu) => {
        const menuController = menu.get('controller');
        if (!menuController) return;

        narrowLabelOptions(menuController);
        submitAfterPlacing(menuController, menu);

        menuController.customMenu = menu;
        menuController.customLabels = modeIsOn;

        if (typeof menuController.setOptions === 'function') menuController.setOptions();
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
     * Contacts are ordinary records in the same store the mail lives in —
     * measured in a running app: ten thousand of them, resident without the
     * Contacts app ever being opened, which is what makes this a lookup
     * rather than a fetch. A group is a contact too: kind "group", with a
     * members object keyed by member uid, and addContact/removeContact on
     * the record itself. Fastmail's own VIPs feature is the same shape, and
     * its find-or-create is the pattern followed here.
     *
     * The contact is created the way the Contacts app creates one — isShared
     * and a uid, then saveToStore — with the address book set explicitly,
     * because a group only holds members of its own account and the picker
     * can be standing in either one.
     */

    const contactGroupPaths = () => pathsFromSetting(settings.contactGroupLabels);

    const wantsContactGroup = (mailbox) => {
        if (!contactGroupPaths().length) return false;

        const path = mailboxPath(mailbox).toLowerCase();
        return contactGroupPaths().some(named => named.toLowerCase() === path);
    };

    // The book a new contact goes in: the account's default one, or any it
    // may write to. Set rather than left to work itself out, because the
    // group is in one account and the message may be in the other.
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
    // than the computed property — getOne hands over stored data, not records.
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
    // with the kind set and no email — the shape the Contacts app's own
    // new-group flow builds before handing it to its edit dialog.
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
    // shape the return-to-message stamp uses: the membership is undone
    // because it was this pick that added it, and the contact is left alone
    // because a contact that now exists is not a mistake.
    let lastGroupAdds = null;

    const undoGroupAdds = () => {
        const adds = lastGroupAdds;
        lastGroupAdds = null;
        if (!adds) return;

        adds.forEach(({ group, contact }) => {
            try {
                group.removeContact(contact);
            } catch (error) {
                console.warn('Inbox mode: could not take the contact back out', error);
            }
        });
    };

    const fileSendersIntoGroup = (mailbox, keys) => {
        if (!modeIsOn || !mailbox || !wantsContactGroup(mailbox)) return;

        try {
            const accountId = mailbox.get('accountId');
            const leaf = mailbox.get('displayName');

            // Found by the label's own name — its leaf first, then its full
            // path — and made under the leaf when neither turns one up. A
            // label named here that has no group yet is a group waiting to
            // be made, not a mistake to warn about.
            const group = contactGroupNamed(accountId, leaf) ||
                contactGroupNamed(accountId, mailboxPath(mailbox)) ||
                makeContactGroup(accountId, leaf);

            if (!group) {
                console.warn('Inbox mode: could not find or make a contact' +
                    ' group named ' + mailboxPath(mailbox));
                return;
            }

            const added = [];
            const names = [];
            let made = 0;

            messagesFrom(keys).forEach((message) => {
                // Only a label that was not there already. Re-picking a label
                // a conversation is filed under is a correction or a
                // no-op — the sender was dealt with the first time, and
                // filing them again on every pass is how a group fills up
                // with people you only meant to add once.
                //
                // The whole conversation is asked, the way every other verb
                // here asks it: a label counts wherever it sits in one. And
                // it is asked now, before the branches below apply anything,
                // which is the only moment the answer means what it says.
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

            lastGroupAdds = added.length ? added : null;
            if (added.length) {
                // Fastmail's own toast, and Fastmail's own precedence with
                // it: a verb's undo toast lands after this one and takes the
                // corner from it, which is the right way round — the button
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
            console.warn('Inbox mode: could not file the sender', error);
        }
    };

    const addInsteadOfMoving = (menu) => {
        if (menu.customAdditive) return;
        menu.customAdditive = true;

        const originalDidSelect = menu.didSelect;

        menu.didSelect = function (mailbox) {
            if (!this.customOurs) return originalDidSelect.apply(this, arguments);

            // A pick is an add. Rule 2 takes Triage and any other project off
            // underneath, rule 3 files the sender; nothing is decided here.
            const actions = controller().actions;
            if (FastMail.preferences.get('inLabelsMode')) {
                actions.add(null, mailbox);
            } else {
                actions.copy(null, mailbox);
            }
        };
    };

    // The menu is built once and reused, so none of this can live in its
    // construction: opened by Option-V after being opened by v, it would still
    // be carrying our narrowing. Applying it as the menu enters the document
    // instead means each opening gets exactly what it asked for — which is also
    // what leaves Labels alone, since nothing ever asks for it.
    const applyMoveMode = (menu, ours) => {
        const menuController = menu.get('controller');
        if (!menuController) return;

        autoSaveWhenAlone(menuController);
        narrowLabelOptions(menuController);
        addInsteadOfMoving(menu);

        menuController.customMenu = menu;
        menu.customOurs = ours;
        menuController.customOurs = ours;

        // filterOptions keeps a mailbox when rolesVisible has a truthy entry for
        // its inherited role, so this leaves the labels you gave names to and
        // drops Trash, Archive, Spam and the rest — which are one mistyped
        // letter away in a menu you drive by typing.
        const roles = ours && settings.labelsSidebarOnly ? { none: true } : null;

        menu.set('rolesVisible', roles);
        menuController.set('rolesVisible', roles);

        if (typeof menuController.setOptions === 'function') {
            menuController.setOptions();
        }
    };

    /*
     * ----------------------------------------------------------------
     * The rules under every menu
     * ----------------------------------------------------------------
     */

    // Every label change in the client passes through these actions —
    // whichever menu, key, drag or swipe asked for it — so the model is
    // enforced here rather than inside any one picker. add, copy and move
    // take one label as their second argument; addremove takes a list.
    const LABEL_ACTIONS = ['add', 'copy', 'addremove', 'move'];

    // True while a rule is issuing its own addremove, so the wrapper does
    // not read that call as one more request to apply the rules to
    let applyingLabelRules = false;

    // Rule 2 — a project label replaces. What comes off the selected threads
    // when `adds` lands on them: Triage and every other project. The Inbox
    // is not touched — an add leaves it on, a move took it off on purpose —
    // and a helper label triggers nothing.
    const replacedBy = (storeKeys, adds) => {
        if (!adds.some(isProject)) return [];

        const removes = [];
        mailboxesAmong(storeKeys).forEach((mailbox) => {
            if (adds.indexOf(mailbox) !== -1) return;
            if (isTriage(mailbox) || isProject(mailbox)) removes.push(mailbox);
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

                const adds = verb === 'addremove'
                    ? toArray(arguments[1])
                    : [arguments[1]].filter(Boolean);

                // Rule 3 — a named label files the sender, from any route
                adds.forEach(mailbox => fileSendersIntoGroup(mailbox, keys));

                const removes = replacedBy(keys, adds);
                if (!removes.length) return original.apply(this, arguments);

                applyingLabelRules = true;
                try {
                    if (verb === 'addremove') {
                        // One call, one checkpoint: the rule's removals ride
                        // the same addremove as the pick
                        const own = toArray(arguments[2]);
                        const merged = own.concat(removes.filter(m => own.indexOf(m) === -1));
                        // The caller's own selection argument goes through
                        // untouched: null means the focused conversation to
                        // Fastmail, and resolving it here would move the focus
                        // afterwards. The resolved keys served the rule only.
                        return original.call(this, storeKeys, adds, merged);
                    }

                    // The removals go first and silenced, so the add's own
                    // didAction is the one that cuts the checkpoint — and
                    // everything queued before it joins that checkpoint
                    const self = this;
                    silencingDidAction(this, () => {
                        self.addremove(keys, [], removes);
                    });
                    return original.apply(this, arguments);
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
    // the account's Inbox by role — it never touches the label being viewed —
    // plus a mark-read and a not-spam report, expanded to the whole thread.
    // What it does not do is retire the dispositions: Process, the deferred
    // labels and the pin all survive it, so `e` adds those removals, and `v`
    // and `s` are built from the same parts.
    //
    // Everything here works through controller().actions, so every route in is
    // covered at once: keys, toolbar, swipes, the context menu, a future one.

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

    // The topic rule's question: does every selected conversation carry at
    // least one topic? A verb over a selection where any lacks one opens the
    // picker first.
    const untopicedAmong = (storeKeys) => messagesFrom(storeKeys)
        .filter(message => !threadOf(message).some(other =>
            toArray(other.get('mailboxes')).some(isFiled)));

    // The dispositions to retire alongside a verb: the Process marker and any
    // deferred label the threads carry. Topics and qualifiers stay — filing
    // something under Moneybird was a decision; being done with it is not a
    // reason to undo that.
    const carriedDispositions = (storeKeys) => {
        const dropped = [];

        mailboxesAmong(storeKeys).forEach((mailbox) => {
            // Snoozed is system-managed: it is never removed by a verb
            if (mailbox.get('role')) return;
            if (isProcess(mailbox) || isDeferred(mailbox)) dropped.push(mailbox);
        });

        return dropped;
    };

    const anyFlagged = (storeKeys) => messagesFrom(storeKeys)
        .some(message => threadOf(message).some(other => other.get('isFlagged')));

    const allFlagged = (storeKeys) => messagesFrom(storeKeys)
        .every(message => threadOf(message).some(other => other.get('isFlagged')));

    const anyIn = (storeKeys, mailbox) => !!mailbox &&
        mailboxesAmong(storeKeys).has(mailbox);

    // The same question for one conversation rather than a selection
    const carriesMailbox = (message, mailbox) => !!mailbox && !!message &&
        threadOf(message).some(other =>
            toArray(other.get('mailboxes')).indexOf(mailbox) !== -1);

    const projectsAmong = (storeKeys) =>
        Array.from(mailboxesAmong(storeKeys)).filter(isProject);

    const triageAmong = (storeKeys) =>
        Array.from(mailboxesAmong(storeKeys)).filter(isTriage);

    // The keep rule's question: does every selected conversation carry a
    // project? Those that do not are asked where they go.
    const unfiledAmong = (storeKeys) => messagesFrom(storeKeys)
        .filter(message => !threadOf(message).some(other =>
            toArray(other.get('mailboxes')).some(isProject)));

    /*
     * Keeping a filtered list honest after a change.
     *
     * Fastmail keeps a list up to date after a local change by working out
     * which mailbox the list is filed under — the first inMailbox reachable
     * through AND nodes — and reading only the changes filed under that one.
     * A Next list is filed under its topic, so removing Inbox, Process
     * or a deferred label is filed elsewhere and goes unread; the row stays.
     * The same pass falls back to setObsolete for a query whose filter has no
     * such mailbox, which is why this matters only for filed-under queries.
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
    // query refetches — with its total, once primed.
    //
    // The filed-under skip is reserved for Fastmail's own lists: those get
    // removals filed under their mailbox applied natively. Our registered
    // queries did not on the phone — an archived row sat in the triage view
    // until a reload — so anything we primed always refetches instead.
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

        // The badge queries share the blind spot: they are filed under their
        // topic, and the verbs move mail between the state mailboxes
        badgeQueries.forEach(({ query }) => staleAfter(query, mailbox));
    };

    // Run `work` with didAction replaced. The replacement is handed the real
    // one first, then whatever arguments Fastmail passed, so it can drop the
    // call or pass it on changed. Restored on the first call as well as at the
    // end.
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

    // Swallow every didAction inside `work`, however many calls make one.
    // Each action queues its undo data before didAction runs, so everything
    // swallowed here joins the checkpoint the *next* unswallowed didAction
    // cuts — one toast, one press of z for the whole verb.
    const silencingDidAction = (actions, work) => {
        const original = actions.didAction;
        actions.didAction = function () { return this; };

        try {
            work();
        } finally {
            actions.didAction = original;
        }
    };

    // Not an arrow: withDidAction applies the actions object as `this`.
    // Forces stayHere off: the stock reading walks only AND nodes of the
    // filter, so it misses the Inbox inside Next's OR and the NOT that
    // carries triage's verdicts — and concludes nothing left the list,
    // leaving the focus on a vanished row. In every one of our slices the
    // verb takes the message out of view, so stayHere is always wrong here.
    const navigateAfter = function (didAction, text, stayHere, goTo) {
        return didAction.call(this, text, false, goTo);
    };

    const inFilteredView = () => {
        if (!modeIsOn) return false;
        return ownKind(controller().get('mailboxFilter'));
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
     * The phone has no shortcut buttons to borrow, so the bar's File button
     * presses the message toolbar's own Labels button.
     */

    // The Labels button, captured from its registration the way the Move
    // button is, so the tristate picker can be opened programmatically
    let labelsButton = null;

    // A drawn control, found by its icon the way the ⋯ button is. Visibility
    // is the test rather than mere presence: a button parked in the bar's
    // More menu is in the document and has no rectangle, and pressing one
    // that is not on screen opens nothing.
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
    // ButtonView. Pressing it opens the stock tristate — a MailboxMenuView,
    // so the verb hooks below adopt it like any other picker.
    const mobileLabelsButtonView = () =>
        visibleViewForIcon('svg.v-Icon.i-label');

    const pressButtonView = (view) => {
        try {
            // activate() is the button's own press, and the only route
            // that reliably opens a menu-owning button — calling its bare
            // target method skips the presentation and strands the verb.
            // Pressed by code, released by nobody: without a touch-up the
            // button keeps its active tint, so it is let go by hand.
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
            console.warn('Inbox mode: could not press the button', error);
        }
        return false;
    };

    // A captured registration is only as good as the view behind it. The
    // shortcut is registered when a button enters the document and is never
    // taken back here when it leaves, so what is captured can be a view that
    // has since been destroyed — or nothing at all, if the button has not
    // been drawn this session, which is the ordinary case on the phone and
    // on a desktop that has not opened a message yet.
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
            console.warn('Inbox mode: could not open the topic picker', error);
            return false;
        }
    };

    // The Labels button wherever the bar has put it. dressToolbar moves it
    // between the bar and More by width, and a button waiting in More is
    // drawn nowhere — so the icon search misses it, which is how a narrow
    // bar turned the picker into the bare-archive dialog. Both places are
    // asked here, and a press that opens nothing is caught by the deadline
    // rather than left to strand the verb.
    const toolbarLabelsView = () => {
        // The name first: it answers wherever the button is, drawn or not
        const registered = registeredToolbarView('labels');
        if (registered) return registered;

        const toolbar = messageToolbar();
        if (!toolbar) return null;

        try {
            const onBar = (toolbar.get('childViews') || []).filter(isLabelsButton)[0];
            if (onBar) return onBar;

            const overflow = toolbarOverflowView(toolbar);
            const menu = overflow && overflow.get('menuView');
            const options = menu && menu.get('options');

            return (options || []).filter(isLabelsButton)[0] || null;
        } catch (error) {
            return null;
        }
    };

    // Anything that opens a label menu. The Labels control is the one to
    // want: it opens the tristate, which serves as the picker on either
    // platform. Found by what is drawn and by what the bar is holding,
    // rather than by a registration, so a button in the More menu — or one
    // whose shortcut never reached the registry — is still reachable.
    const drawnPickerView = () => mobileLabelsButtonView() ||
        toolbarLabelsView() ||
        visibleViewForIcon('svg.v-Icon.i-folder');

    /*
     * The picker, asked for rather than hunted down.
     *
     * Pressing a button is only ever a way of asking Fastmail to construct
     * its label menu and show it. Every failure so far has been in the
     * finding — no shortcut to name the button by, no glyph to match, not on
     * the bar, not even in the More menu — and none of them in the menu. So
     * the last resort drops the button and asks for the menu directly. It is
     * still Fastmail's menu: its class, its search field, its Create label,
     * its icons and colours, and — because our hooks sit on the prototype —
     * the same didEnterDocument, the same narrowing and the same commit that
     * a menu opened by a button gets.
     *
     * Read out of the app bundle rather than guessed. MailboxMenuView takes
     * willAdd, willRemove and accountId, builds its controller lazily, and
     * that controller's select() ends in didSelect on the view — so the
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

    // Something drawn to hang the menu off. show() measures the anchor's
    // layer and inserts the popover into the root view the anchor belongs
    // to, so this has to be a view that is on screen: not the root itself,
    // which is nobody's child and would leave the popover unparented, and
    // not a button parked in a closed menu, which has no rectangle. The
    // toolbars come first because that is where the verb was pressed.
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
    // detaches itself on hide, which is how the app's own singleton behaves;
    // a fresh one per opening would leak a view every time.
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
            console.warn('Inbox mode: could not open the topic picker', error);
            return false;
        }
    };

    // Open the project picker for these conversations. Nothing waits on the
    // pick: it is an add like any other, and the rules underneath finish it.
    // Move to is the quick one and suits a single conversation; the tristate
    // is what a multi-selection needs. Either will do when the preferred one
    // is not on screen.
    const openProjectPicker = (keys) => {
        const single = keys.length === 1;
        const order = single
            ? [moveButton, labelsButton]
            : [labelsButton, moveButton];
        const captured = order.filter(capturedIsLive)[0];

        if (captured) {
            if (captured === moveButton) wantOurMove = true;
            if (pressCaptured(captured)) return;
        }

        // The phone's path, and a desktop that has never drawn Move to
        const drawn = drawnPickerView();
        if (drawn && pressButtonView(drawn)) return;

        // No button anywhere: ask Fastmail for the menu itself
        if (buildPicker(keys)) return;

        console.warn('Inbox mode: no label menu to open');
    };

    /*
     * The verbs proper. Each resolves its keys once, silences the didActions
     * of its preparatory moves, and lets exactly one didAction through at the
     * end — the archive's for `e`, the addremove's for `v`, the flag's for
     * `s` — so the whole verb is one checkpoint and one toast.
     */

    const resolveKeys = (actions, storeKeys) => {
        const keys = storeKeys && storeKeys.length
            ? storeKeys
            : actions.getSelectedStoreKeys();
        return keys && keys.length ? keys : null;
    };

    // done — `e`. `finish` runs the stock archive, which takes the Inbox off
    // and marks the thread read; everything else comes off first, silenced,
    // so the archive's own didAction cuts the one checkpoint: Triage, every
    // project label and the pin. Helper labels stay.
    const runDone = (actions, keys, finish) => {
        silencingDidAction(actions, () => {
            const dropped = [];
            mailboxesAmong(keys).forEach((mailbox) => {
                if (isTriage(mailbox) || isProject(mailbox)) dropped.push(mailbox);
            });
            if (dropped.length) actions.addremove(keys, [], dropped);

            if (anyFlagged(keys)) actions.unflag(keys);
        });

        if (inFilteredView()) {
            withDidAction(actions, navigateAfter, finish);
        } else {
            finish();
        }
    };

    // keep — `v`. A thread that already carries a project is kept by taking
    // Triage off it and nothing else. One that carries none is asked where it
    // goes, and the pick is an ordinary add that rule 2 finishes.
    const runKeep = (actions, keys) => {
        const triage = triageAmong(keys);
        if (!triage.length) return;
        actions.addremove(keys, [], triage);
    };

    // pin — `s`. A toggle over the selection: all pinned, unpin; else pin.
    const runUrgent = (actions, keys) => {
        if (allFlagged(keys)) actions.unflag(keys);
        else actions.flag(keys);
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

    // Set by the verb the moment before its didAction fires; stamped onto
    // the checkpoint by the wrapper in patchArchive. Every other action's
    // checkpoint stamps null, so a stale URL cannot outlive its checkpoint.
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
    // restore the app state the URL encodes, and the URL — and a history
    // entry — follow from the state change on their own.
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
            console.warn('Inbox mode: could not walk back to the message', error);
        }
    };

    // The one undo everything routes through — the toast's button and the
    // keyboard's z alike. Found by shape rather than pinned by name: the
    // object on the FastMail namespace that carries undo and redo, or,
    // failing that, whatever registers itself under the z key.
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
            // group membership is taken back here. Only the membership: a
            // contact that did not exist before now does, and that is not
            // the part anyone means to undo.
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

        if (!manager && typeof controller().actions.undo === 'function') {
            manager = controller().actions;
        }
        if (manager) wrapUndoOn(manager, 'undo');
    };

    /*
     * Two primitives mean archive, and they are patched rather than any of
     * the routes into them. `archive` is the plain verb. `remove` becomes one
     * when the mailbox coming off is the Inbox: removeCurrent — the [ and ]
     * keys, the Remove-from-Inbox button, a swipe — is measured to be
     * `remove(keys, whichever mailbox you are looking at)`.
     */
    const ARCHIVE_VERBS = ['archive', 'remove'];

    const isArchiving = (verb, args) => verb === 'archive' ||
        (!!args[1] && typeof args[1].get === 'function' &&
            args[1].get('role') === 'inbox');

    // The other two verbs that take a message off the mailbox you are looking
    // at, and so run into the same update blind spot. Wrapped for the refresh
    // alone. `move` takes the current mailbox off on the way; addremove is
    // handed the labels it adds and removes as its second and third
    // arguments — both directions matter, because under a filtered slice an
    // added label can take a row out of view just as surely: keeping adds
    // Process, and the triage slice excludes it.
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

        // The stamp rides the checkpoint: whichever didAction cuts one
        // takes the pending return with it — the archive verbs set it the
        // moment before, everything else stamps null. Discovery retries
        // here too: the manager may not exist yet when the patch first
        // runs, and a stamp nobody can use deserves a loud word once.
        const originalDidAction = actions.didAction;
        actions.didAction = function () {
            lastUndoReturn = pendingUndoReturn;
            pendingUndoReturn = null;

            if (!undoTarget) {
                patchUndo();
                if (!undoTarget && lastUndoReturn && !warnedNoUndo) {
                    warnedNoUndo = true;
                    console.warn('Inbox mode: no undo manager found to wrap;' +
                        ' undo will not walk back to the message');
                }
            }

            return originalDidAction.apply(this, arguments);
        };

        patchUndo();
    };

    // Snooze means "gone now, queued later", so the kept-marker comes off on
    // the way out: Fastmail strips the Inbox, we strip Process, and both land
    // in the snooze's own checkpoint. Waking returns it to the queue.
    const patchSnooze = () => {
        const actions = controller().actions;
        if (actions.customTriageSnooze) return;
        actions.customTriageSnooze = true;

        const original = actions.snooze;

        actions.snooze = function (storeKeys, until) {
            if (!modeIsOn || !until) return original.apply(this, arguments);

            const keys = resolveKeys(this, storeKeys);
            if (!keys) return original.apply(this, arguments);

            // Only the marker comes off. A deferred qualifier like Waiting
            // survives: snooze and Waiting compose, and neither needs to know
            // about the other.
            const process = carriedDispositions(keys).filter(isProcess);

            if (process.length) {
                silencingDidAction(this, () => {
                    this.addremove(keys, [], process);
                });
                process.forEach(refreshListAfter);
            }

            return original.apply(this, arguments);
        };
    };

    const patchMailboxMenu = () => {
        const proto = FastMail.classes.MailboxMenuView.prototype;
        // Resolved through the chain: the class has none of its own
        const originalDidEnterDocument = proto.didEnterDocument;

        // Enter with nothing typed commits: what you have ticked is ticked,
        // and the tristate applies it as it closes. With something typed it
        // still picks out what the typing has focused, which is Fastmail's
        // own behaviour.
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
            if (isLabelsMenu(this)) {
                applyLabelsMode(this);
                return originalDidEnterDocument.apply(this, arguments);
            }

            applyMoveMode(this, wantOurMove);
            wantOurMove = false;

            return originalDidEnterDocument.apply(this, arguments);
        };
    };

    // Fastmail gives the Move to button "m v" — two keys in one space-separated
    // property, measured. Identifying the button by its keys rather than by its
    // label keeps this working in a translated UI, but it has to be read as the
    // list it is: comparing the whole string to "v" matches nothing, which is
    // how the menu came up unnarrowed.
    //
    // Only the v registration is taken over, so m still opens Move to as it
    // comes, alongside Option-V.
    // The Labels button, told apart the same way Move to is: by the key it
    // answers to rather than by a translated word.
    const LABELS_SHORTCUT = 'l';

    const hasShortcut = (target, key) => {
        if (!target || typeof target.get !== 'function') return false;

        try {
            return String(target.get('shortcut')).trim().split(/\s+/).indexOf(key) !== -1;
        } catch (error) {
            return false;
        }
    };

    // A shortcut is a keyboard's way of naming a button, and the phone has no
    // keyboard: its toolbar buttons carry no shortcut property at all, which
    // is why the captured registrations are null there. Naming Labels and Move
    // by the shortcut alone therefore matched nothing on the phone — so the
    // bar's Labels and Move slots quietly did nothing, which is a configured
    // order that does not apply, and the topic picker had no button to open,
    // which is the bare-archive dialog turning up in place of the picker.
    //
    // The glyph is the other name a button has. A drawn view carries it in its
    // layer; one built from an icon element carries it there before ever being
    // drawn. isInDocument guards the layer read, because asking an undrawn view
    // for its layer is what renders it, and a button waiting in a closed menu
    // should stay closed.
    const viewHasIcon = (target, name) => {
        if (!target || typeof target.get !== 'function') return false;

        try {
            const icon = target.get('icon');
            if (icon && icon.nodeType === 1 && icon.getAttribute) {
                const classes = (icon.getAttribute('class') || '').split(/\s+/);
                if (classes.indexOf(name) !== -1) return true;
            }
        } catch (error) {
            // The drawn glyph below is the other half of the answer
        }

        try {
            if (!target.get('isInDocument')) return false;

            const layer = target.get('layer');
            return !!(layer && layer.querySelector &&
                layer.querySelector('svg.' + name));
        } catch (error) {
            return false;
        }
    };

    const isLabelsButton = (target) => isRegisteredAs(target, 'labels') ||
        hasShortcut(target, LABELS_SHORTCUT) ||
        viewHasIcon(target, 'i-label');

    const isMoveButton = (target) => isRegisteredAs(target, 'move') ||
        hasShortcut(target, MOVE_SHORTCUT) ||
        viewHasIcon(target, 'i-folder');

    // Where "l" would have gone. Captured from the registration rather than
    // looked up, so whatever Fastmail bound is what we call.
    let moveButton = null;

    // v goes in under a stand-in of ours calling openMove, not under the button
    // calling activate — and the button takes its shortcut back off under its
    // own name, which matches nothing, so each registration stayed behind. The
    // same asymmetry the swapped keys had.
    //
    // Held against the button it stands for so the removal can find it again,
    // and reused rather than replaced, so a button that enters twice does not
    // leave a stand-in behind it. Weakly: a destroyed view should not be kept
    // alive here by its own shortcut.
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
    // an unfiled one opens the picker — the same narrowed menu, opened with
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

    // Shift-V: the label-only picker. Always the menu, never a triage — the
    // topic rule's escape valve for correcting labels in place.
    const openLabelPicker = () => {
        if (!moveButton) return;
        wantOurMove = ourMoveWanted();
        moveButton.target[moveButton.method]();
    };

    // A shortcut and the button it stands for should not disagree, so clicking
    // Move to opens what v opens, and Option-clicking opens what Option-V does.
    //
    // Read on the way down, before the menu is built. Every mousedown sets the
    // flag, so one that misses the button clears it — otherwise a press that
    // never opened a menu would leave it set for whatever opened next.
    const watchMoveClick = () => {
        document.addEventListener('mousedown', (event) => {
            const layer = moveButton && moveButton.target.get('layer');
            const onButton = !!layer && !!event.target && layer.contains(event.target);

            wantOurMove = onButton && !event.altKey && ourMoveWanted();
        }, true);
    };

    // Fastmail archives with y (and with h, which is left alone) and expands a
    // thread with e. Gmail archives with e, and that muscle memory does not
    // unlearn, so the two trade places.
    const SWAPPED_KEYS = { e: 'y', y: 'e' };

    // Fastmail hangs two buttons off y. Archive is "y h"; the Remove label
    // button that shares its toolbar slot is "y", and both register whichever of
    // them is drawn. getHandlerForKey takes the last registration, and measured,
    // Remove label is last every time — which is how e came to take the triage
    // label off instead of archiving, toast and all.
    //
    // So only the archiving one is carried across. Identified by its keys rather
    // than its label, which is translated: h is the one key Archive does not
    // share with the button it takes turns with.
    const ARCHIVE_ONLY_KEY = 'h';

    const isArchiveHandler = (target) => {
        if (!target || typeof target.get !== 'function') return false;

        try {
            return String(target.get('shortcut')).trim().split(/\s+/)
                .indexOf(ARCHIVE_ONLY_KEY) !== -1;
        } catch (error) {
            return false;
        }
    };

    // Only y has a rival to settle; e expands a thread and holds nothing else.
    // Remove label's y is dropped rather than moved, because e is meant to
    // archive and y now expands, so there is nowhere left to put it — [ and ]
    // still call it.
    const movesToSwappedKey = (key, target) => key !== 'y' || isArchiveHandler(target);

    // Registrations made before the patch below was installed keep the stock
    // binding, so move those across once. Appending is enough, since
    // getHandlerForKey takes the last registration — but both have to be read
    // before either is written, or the second read sees the first write.
    const swapExistingKeys = (kb, register) => {
        const moves = Object.keys(SWAPPED_KEYS)
            .map((key) => {
                const list = kb._shortcuts[key] || [];

                // The last that belongs on the other key, which under y is the
                // last archiving one rather than the last of any kind
                const handler = list
                    .filter(entry => movesToSwappedKey(key, entry[0]))
                    .pop();

                return handler ? [SWAPPED_KEYS[key], handler] : null;
            })
            .filter(Boolean);

        moves.forEach(([key, handler]) => {
            register.call(kb, key, handler[0], handler[1], handler[2]);
        });
    };

    // The verb keys the mode owns outright. Fastmail's own registrations —
    // the list's star on s, the conversation view's expandAll on Shift-E —
    // land underneath and answer again the moment the mode is off. Ours are
    // re-lifted after every later registration, because the registry answers
    // to whichever went in last, and the conversation view registers its keys
    // each time it enters the document.
    const claimedHandlers = {};

    // key -> verb, filled by reclaimKeys from the key settings — the
    // handlers look their verb up here on every press, so a rebuilt map
    // retargets keys already claimed
    const claimedRun = {};

    const sanitizedKey = (value, fallback) => {
        const key = String(value || '').trim();
        return key || fallback;
    };

    const wantedClaims = () => {
        const wanted = {
            'Shift-V': () => openLabelPicker()
        };

        wanted[sanitizedKey(settings.urgentKey, 's')] = () => runVerb('urgent', null);

        return wanted;
    };

    // Assigned inside patchShortcuts, where the registry lives; called
    // again whenever the key settings change
    let reclaimKeys = () => {};

    // A button registers its shortcut on entering the document and ignores
    // later changes to the property — setting it afterwards leaves the old
    // binding in place, which is measurable. The swap therefore has to happen
    // as the registration goes in. Registering ours in the same breath also
    // keeps it last, and getHandlerForKey takes the last one registered.
    const patchShortcuts = () => {
        const kb = FastMail.ViewEventsController.kbShortcuts;
        const originalRegister = kb.register;

        const claimKey = (key) => {
            const handler = {
                go: (event) => {
                    if (modeIsOn) return claimedRun[key](event);

                    // Mode off: behave as if we were not here — hand the key
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

        kb.register = function (key, target, method, priority) {
            // Decided as the registration goes in rather than at the keypress,
            // because the key itself is what dispatches. Turning the setting
            // off takes hold as views re-register, or on the next reload.
            if (settings.swapArchiveExpand && SWAPPED_KEYS[key]) {
                // Dropped rather than left where it was: y expands now, and a
                // Remove label registration landing there last would take that
                // over the same way it took e over.
                if (!movesToSwappedKey(key, target)) return this;

                return originalRegister.call(
                    this, SWAPPED_KEYS[key], target, method, priority
                );
            }

            // The tristate picker is opened programmatically for a
            // multi-select verb, so the button that owns it is captured from
            // its registration the way the Move button is
            if (key === LABELS_SHORTCUT && isLabelsButton(target)) {
                labelsButton = { target: target, method: method };
            }

            // z's owner is the undo route worth wrapping — the same object
            // the toast's button presses — so its registration is another
            // way to find what the namespace scan may have missed
            if (key === 'z' && !undoTarget && target &&
                    typeof target === 'object' &&
                    typeof target[method] === 'function') {
                wrapUndoOn(target, method);
            }

            if (key !== MOVE_SHORTCUT || !isMoveButton(target)) {
                const result = originalRegister.apply(this, arguments);
                liftClaimed(key);
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
        // so a registration that moved has to be taken off the key it moved to,
        // or it is never taken off at all: measured, six handlers on e and nine
        // on y for two buttons and one thread-expander. Since the key answers to
        // whichever registered last, a pile of stale ones is not just untidy —
        // it is the toolbar as it stood several redraws ago still deciding.
        //
        // The same reading as registering, so the two stay in step: a Remove
        // label y was never registered anywhere, and deregistering the key it
        // was refused under finds nothing, which Overture treats as a no-op.
        const originalDeregister = kb.deregister;

        kb.deregister = function (key, target, method) {
            if (settings.swapArchiveExpand && SWAPPED_KEYS[key] &&
                    movesToSwappedKey(key, target)) {
                return originalDeregister.call(
                    this, SWAPPED_KEYS[key], target, method
                );
            }

            // Ours went in under a stand-in, so it comes off as one. Looked up
            // rather than asked of the button, so only the registrations we
            // actually substituted are answered for here.
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
        // registered when the script starts. Rerun on a settings change: a
        // key no longer wanted is handed back, a new one claimed.
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
    };

    /*
     * ----------------------------------------------------------------
     * Sticky filter
     * ----------------------------------------------------------------
     */

    // Each label — and the Inbox — keeps whichever filter you last chose for
    // it, so one you set to All mail or Unread stays that way when you come
    // back. Anything you have not chosen for gets the Next filter.
    //
    // Keyed by mailbox id rather than store key: store keys are handed out per
    // session and would not survive a reload.
    const loadFilters = () => {
        try {
            rememberedFilters = JSON.parse(localStorage.getItem(FILTERS_KEY)) || {};
        } catch (error) {
            rememberedFilters = {};
        }

        // A value stored under a slice's old name is still the choice you
        // made, so it is rewritten rather than left to fall through as a
        // filter nothing recognises — which would quietly hand the label
        // back its plain unfiltered list.
        let moved = false;
        Object.keys(rememberedFilters).forEach((id) => {
            const renamed = FILTER_ALIASES[rememberedFilters[id]];
            if (!renamed) return;

            rememberedFilters[id] = renamed;
            moved = true;
        });

        // Written back once, so the rewrite is not redone on every load
        if (moved) saveFilters();
    };

    const saveFilters = () => {
        try {
            localStorage.setItem(FILTERS_KEY, JSON.stringify(rememberedFilters));
        } catch (error) {
            console.warn('Inbox mode: could not persist the filter choices', error);
        }
    };

    // The sources the sticky filter manages: every user label, and the Inbox
    // itself — the queue opens on `next` too, which is what hides
    // deferred mail from it
    const modeManagesSource = (mailbox) => !!mailbox && typeof mailbox.get === 'function' &&
        (isUserLabel(mailbox) || mailbox.get('role') === 'inbox');

    const filterFor = (mailbox) => {
        const id = mailbox && mailbox.get('id');

        if (id && Object.prototype.hasOwnProperty.call(rememberedFilters, id)) {
            return rememberedFilters[id];
        }

        // A deferred label under `next` would show nothing at all —
        // it is the very set the filter hides — so those open unfiltered:
        // the label already is the deferred list.
        //
        // A non-inbox label is not that case: its mail carries the marker
        // like any other kept mail, so actionable is exactly the live half
        // of it and the default stands.
        return isDeferred(mailbox) ? '' : DEFAULT_FILTER;
    };

    // Storing nothing for the default keeps the record to the labels you have
    // actually changed, and makes going back to the default a deletion. The
    // default is per label: a deferred label's is All mail.
    const rememberFilter = (mailbox, filter) => {
        const id = mailbox && mailbox.get('id');
        if (!id) return;

        const fallback = isDeferred(mailbox) ? '' : DEFAULT_FILTER;

        if (filter === fallback) delete rememberedFilters[id];
        else rememberedFilters[id] = filter;

        saveFilters();
    };

    // Fastmail's own filter menu writes mailboxFilter directly, so this is
    // where a hand-picked filter gets recorded against the label you are on.
    //
    // Only filters *you* set are recorded. The mode sets one itself on every
    // navigation and whenever it is switched on or off, and those must not be
    // read back as choices — moving between labels changes the mailbox and the
    // filter together in one batch, with the two briefly out of step. Traced:
    // `filter -> "inbox" mailbox="Later"` while the URL still read
    // /mail/Triage/, which files one label's filter under another's name.
    //
    // It went unnoticed while the label it happened to hit was Triage, which
    // ignored the remembered value; now that Triage reads it like every other
    // label, a stray "" there switches the Inbox filter off and snoozed mail
    // comes back into the list.
    //
    // A flag rather than a guess about which pairs look consistent: the observer
    // is measured to run inside the call that sets the filter — the trace reads
    // `rememberCurrentFilter <- endPropertyChanges <- goSource` — so wrapping
    // our own writes catches exactly them and nothing else.
    let settingFilter = false;

    const settingOurFilter = (work) => {
        settingFilter = true;
        try {
            work();
        } finally {
            settingFilter = false;
        }
    };

    const rememberCurrentFilter = () => {
        if (!modeIsOn || settingFilter) return;

        const mailController = controller();
        if (mailController.get('search')) return;

        const mailbox = mailController.get('mailbox');
        if (!modeManagesSource(mailbox)) return;

        const filter = mailController.get('mailboxFilter') || '';

        // A ?filter= bookmarked before a slice was renamed still names the
        // slice you meant. Corrected in place, so the view it opens is the
        // one asked for rather than an unfiltered fallback — and so the old
        // spelling is not then remembered against the label.
        const renamed = FILTER_ALIASES[filter];
        if (renamed) {
            settingOurFilter(() => mailController.set('mailboxFilter', renamed));
            rememberFilter(mailbox, renamed);
            return;
        }

        rememberFilter(mailbox, filter);
    };

    // Sidebar clicks arrive here as goSource(mailbox) with no search and no
    // filter, by way of SourcesController.select()
    const patchGoSource = () => {
        const mailController = controller();
        const original = mailController.goSource;

        mailController.goSource = function (mailbox, search, mailboxFilter) {
            if (modeIsOn && !search && !mailboxFilter) {
                // goSource falls back to the current mailbox when given none
                const target = mailbox || this.get('mailbox');
                if (modeManagesSource(target)) mailboxFilter = filterFor(target);
            }

            let result;
            settingOurFilter(() => {
                result = original.call(this, mailbox, search, mailboxFilter);
            });

            return result;
        };
    };

    /*
     * ----------------------------------------------------------------
     * The Next filter
     * ----------------------------------------------------------------
     */

    // Wrapping a computed property means carrying its metadata across —
    // isProperty, dependencies and the rest all live as own properties on the
    // function .property() returns
    const wrapComputed = (original, wrapped) => {
        Object.keys(original).forEach((key) => {
            wrapped[key] = original[key];
        });
        return wrapped;
    };

    /*
     * The substituted list. mailboxFilter carries our value for free — URL,
     * history, goSource's third argument, rememberedFilters — and Fastmail's
     * own builder degrades to an unfiltered view for a value it does not
     * know. The wrapper supplies the real query: registered under the id
     * Message.getQueryId computes, primed for an exact total, and handed to
     * the view only once it has resolved — the stock list covers the gap and
     * the range observer recomputes the property the moment ours is ready.
     */
    const listQueries = new Map();

    const listQueryFor = (mailController, stock, kind) => {
        const mailbox = mailController.get('mailbox');
        if (!modeManagesSource(mailbox)) return null;

        const where = whereFor(mailbox, kind);
        if (!where) return null;

        const params = {
            accountId: stock.get('accountId'),
            where,
            // Sort and shape are borrowed wholesale from the stock query, so
            // the rows come out in the order the stock view would show them
            sort: stock.get('sort'),
            collapseThreads: stock.get('collapseThreads'),
            findAllInThread: stock.get('findAllInThread'),
            findMatchingParts: stock.get('findMatchingParts')
        };

        const id = FastMail.classes.Message.getQueryId(params);
        const existing = listQueries.get(id);
        if (existing) return existing.query;

        const query = registerQuery(params);
        if (!query.prefetch) query.prefetch = 5;

        const entry = {
            query,
            observer: {
                rangeDidChange: () => {
                    // The recompute is idempotent, so it needs no per-query
                    // handover flag — a shared one is exactly the bug the
                    // spec warns about
                    if (query.get('length') !== null) {
                        mailController.computedPropertyDidChange('mailboxMessageList');
                    }
                },
                // The rows and the exact total arrive in separate responses,
                // and the guard above holds the handover until both are in.
                // When the rows land last the range event closes the gap;
                // when the total lands last only this one does — without it
                // the view sits on the stock list until the next toggle.
                lengthDidChange: () => {
                    if (query.get('length') !== null) {
                        mailController.computedPropertyDidChange('mailboxMessageList');
                    }
                }
            },
            watcher: {
                statusDidChange: () => refetchWhenObsolete(query)
            }
        };

        query.addObserverForRange({ start: 0, end: 20 }, entry.observer, 'rangeDidChange');
        query.addObserverForKey('length', entry.observer, 'lengthDidChange');
        query.addObserverForKey('status', entry.watcher, 'statusDidChange');
        query.getObjectAt(0);

        primeQuery(query, params);
        listQueries.set(id, entry);

        return query;
    };

    const dropListQueries = () => {
        listQueries.forEach(({ query, observer, watcher }) => {
            try {
                query.removeObserverForRange({ start: 0, end: 20 }, observer, 'rangeDidChange');
                query.removeObserverForKey('length', observer, 'lengthDidChange');
                query.removeObserverForKey('status', watcher, 'statusDidChange');
                query.destroy();
            } catch (error) {
                // Already gone is already gone
            }
        });
        listQueries.clear();
    };

    const patchMessageList = () => {
        const mailController = controller();
        if (mailController.customMessageList) return;
        mailController.customMessageList = true;

        const original = mailController.mailboxMessageList;

        mailController.mailboxMessageList = wrapComputed(original, function () {
            const stock = original.call(this);
            if (!modeIsOn || !stock) return stock;

            // A search builds its own query and ignores the filter; leave it
            if (this.get('search')) return stock;

            const kind = this.get('mailboxFilter');
            if (!ownKind(kind)) return stock;

            const query = listQueryFor(this, stock, kind);

            // Hand over only a query that has already resolved: a list
            // without data would blank the view, and one under a foreign id
            // never resolves at all
            if (!query || query.get('length') === null) return stock;

            return query;
        });

        mailController.computedPropertyDidChange('mailboxMessageList');
    };

    /*
     * The header. Fastmail's own switch shows a word for every filter it
     * knows and would show a bare mailbox name for ours; the wrapper names
     * ours, and — behind showFilteredCounts — restores the number Fastmail
     * drops for every filtered view, exact or absent, never an estimate.
     */
    // The words the headings and the filter menu show. The values behind
    // them stay in step with the values, which is why both are read from
    // here rather than written out at each use.
    const FILTER_WORDS = {
        next: 'Next', deferred: 'Deferred',
        triage: 'Triage', noninbox: 'Non-inbox'
    };

    // A stock filtered query never asks the server for its total — only a
    // top-level inMailbox filter does — but the server answers for any filter
    // when asked. One raw call with the query's own arguments routes back to
    // it by recomputed id and makes its length exact from then on.
    const primeListForCount = (query) => {
        primeQuery(query, {
            accountId: query.get('accountId'),
            where: query.get('where'),
            sort: query.get('sort'),
            collapseThreads: query.get('collapseThreads')
        });
    };

    const patchTitleAndCount = () => {
        const mailController = controller();
        if (mailController.customTitleAndCount) return;
        mailController.customTitleAndCount = true;

        const original = mailController.mailboxTitleAndCount;

        mailController.mailboxTitleAndCount = wrapComputed(original, function () {
            const title = original.call(this);
            if (!modeIsOn || this.get('search')) return title;

            const filter = this.get('mailboxFilter');
            const word = FILTER_WORDS[filter];
            if (!word) return title;

            // Rebuilt from the bare name rather than suffixed onto the
            // stock string: priming the list for an exact total makes the
            // stock heading grow a number of its own, and "Inbox • 1 •
            // Triage 2" reads as two headings fighting. Ours is the whole
            // sentence — the place, its slice, the filtered total alone.
            let rebuilt = (this.get('mailboxTitle') || title) + ' • ' + word;

            if (settings.showHeaderCounts) {
                const mailbox = this.get('mailbox');
                const list = this.get('mailboxMessageList');

                // An empty slice goes without a number: "Inbox • Triage"
                // already says there is nothing, and a 0 after it only adds
                // what the absence of a count says better — the same rule
                // the sidebar badges follow.
                if (list && list.get('hasTotal')) {
                    const total = list.get('length');
                    if (total) {
                        let count = String(total);
                        const unread = mailbox && headerUnreadFor(mailbox, filter);
                        if (unread) count += ' (' + unread + ')';
                        rebuilt = rebuilt + ' ' + count;
                    }
                } else if (list && !list.customPrimed && list.get('where')) {
                    primeListForCount(list);
                }
            }

            return rebuilt;
        });

        mailController.computedPropertyDidChange('mailboxTitleAndCount');

        // None of the declared dependencies change when a count lands, so the
        // recompute is wired by hand off the bound list's length
        mailController.addObserverForKey('mailboxMessageList.length', {
            go: () => mailController.computedPropertyDidChange('mailboxTitleAndCount')
        }, 'go');
    };

    /*
     * The filter menu. Two more rows in Fastmail's own menu, so `next`
     * and `deferred` inherit the menu, the ?filter= encoding and the
     * remembered filters unchanged. The menu view is rebuilt on every open,
     * so the injection sees a fresh copy each time.
     */
    const TICK_POINTS = '7.13 13.19 10.26 16.25 16.88 7.75';

    const filterOptionIcon = (selected) => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('role', 'presentation');
        svg.setAttribute('class', 'v-Icon ' + (selected ? 'i-tick' : 'i-blank'));

        if (selected) {
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.setAttribute('stroke-width', '1.5');

            const shape = document.createElementNS(SVG_NS, 'polyline');
            shape.setAttribute('points', TICK_POINTS);
            svg.appendChild(shape);
        }

        return svg;
    };

    const customFilterOption = (label, value) => {
        const mailController = controller();
        const selected = mailController.get('mailboxFilter') === value;

        const option = new FastMail.classes.ButtonView({
            label: label,
            icon: filterOptionIcon(selected),
            isSelected: selected,
            method: 'chooseItem',
            chooseItem() {
                mailController.set('mailboxFilter', value);
            }
        });

        option.customFilterOption = true;
        return option;
    };

    const injectFilterOptions = (menu) => {
        const options = menu && typeof menu.get === 'function' && menu.get('options');
        if (!options || typeof options.push !== 'function') return;
        if (options.some(option => option && option.customFilterOption)) return;
        if (!modeManagesSource(controller().get('mailbox'))) return;

        const last = options[options.length - 1];
        if (last && last.isLastOfSection) last.isLastOfSection = false;

        // Named from the same map the heading reads, so a row and the title
        // it produces are the same word by construction
        const rows = [DEFAULT_FILTER, TRIAGE_FILTER, DEFERRED_FILTER]
            .map(kind => customFilterOption(FILTER_WORDS[kind], kind));

        // Only where there is non-inbox mail to show: a row that can only
        // ever draw an empty list is a row in the way
        if (nonInboxMailboxes(controller().get('accountId')).length) {
            rows.push(customFilterOption(
                FILTER_WORDS[NONINBOX_FILTER], NONINBOX_FILTER));
        }

        rows[rows.length - 1].isLastOfSection = true;
        options.push(...rows);
    };

    // The filter control is rebuilt with the toolbar, so this is re-applied
    // from the same place the indicator is
    const ensureFilterMenuPatched = () => {
        const view = filterButton();
        if (!view || view.customFilterMenu) return;
        if (typeof view.menuView !== 'function') return;
        view.customFilterMenu = true;

        const original = view.menuView;

        view.menuView = wrapComputed(original, function () {
            const menu = original.call(this);
            try {
                injectFilterOptions(menu);
            } catch (error) {
                console.warn('Inbox mode: could not extend the filter menu', error);
            }
            return menu;
        });
    };

    /*
     * The phone has no filter control of its own. Its filter rows live one
     * level down: the header's Actions button builds a menu whose "View…"
     * row shows a second menu holding them — built fresh on each open from
     * an array we cannot reach, and pushed through the first menu's own
     * showMenu. So the injection rides that call instead: showFilterMenu is
     * wrapped to say the next showMenu carries the filter rows, and a
     * structural check backs it up in case the event machinery calls the
     * original handler rather than the wrapper.
     */
    const looksLikeFilterRows = (menu) => {
        const rows = menu && typeof menu.get === 'function' && menu.get('options');
        if (!rows || !rows.length) return false;

        // Every filter row is a pick-one: a chooseItem of its own. The sort
        // menu comes through the same showMenu and matches that too, but it
        // carries two sections (fields, then pinned-first) where the filter
        // list is one titled run.
        if (!rows.every(row => row && typeof row.chooseItem === 'function' &&
            typeof row.get === 'function')) return false;

        return !!rows[0].get('sectionTitle') &&
            rows.filter(row => row.get('isLastOfSection')).length === 1;
    };

    const patchMobileActionsMenu = (menu) => {
        if (!menu || typeof menu.showMenu !== 'function' ||
            typeof menu.showFilterMenu !== 'function') return;

        let filterAsked = false;

        const filterHandler = menu.showFilterMenu;
        menu.showFilterMenu = function () {
            filterAsked = true;
            try {
                return filterHandler.apply(this, arguments);
            } finally {
                filterAsked = false;
            }
        };

        const show = menu.showMenu;
        menu.showMenu = function (submenu) {
            if (filterAsked || looksLikeFilterRows(submenu)) {
                try {
                    injectFilterOptions(submenu);
                } catch (error) {
                    console.warn('Inbox mode: could not extend the view menu', error);
                }
            }
            return show.apply(this, arguments);
        };
    };

    const ensureMobileFilterMenuPatched = () => {
        if (!FastMail.isMobile) return;

        // The ⋯ in the page header. Its icon is how it is told apart from
        // the account switcher beside it, which is also a menu button.
        //
        // Two icons, not one: the app draws this glyph through
        // drawIconPlatformOverflow, which picks i-morecircle — dots in a
        // ring, the iOS shape — or i-morevertical, dots in a column, by
        // platform. Matching only the first is a selector that quietly stops
        // finding the button on the platform it was not written on, taking
        // the filter options out of this menu with it.
        const icon = document.querySelector(
            '.v-PageHeader svg.i-morecircle, .v-PageHeader svg.i-morevertical');
        const node = icon && icon.closest('button');
        const view = node && FastMail.getViewFromNode(node);
        if (!view || view.customFilterMenu) return;
        if (typeof view.menuView !== 'function' || !view.menuView.isProperty) return;
        view.customFilterMenu = true;

        const original = view.menuView;

        // The menu is volatile — rebuilt on every open — so each fresh copy
        // comes through here and gets its showMenu dressed before it draws
        view.menuView = wrapComputed(original, function () {
            const menu = original.call(this);
            try {
                patchMobileActionsMenu(menu);
            } catch (error) {
                console.warn('Inbox mode: could not extend the actions menu', error);
            }
            return menu;
        });
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

    // Fastmail draws a row's label chips and adds to them when a label is
    // added, but does not take one away when a label is removed — the chip
    // stays behind. That is its own display bug, and it becomes ours as well,
    // because the row colours are selected on those chips: the colour outlives
    // the label, which is what you see.
    //
    // redrawLayer() does not rebuild them, so the stale chip is taken out
    // directly. Fastmail draws the row from the record whenever it does redraw
    // — recycling it as you scroll, or reopening the view — so nothing has to
    // be put back.

    // A chip reads "Projects/Work" because that is the mailbox's path, but the
    // container is scaffolding — it is on every label and says nothing. Only
    // the text is rewritten: the title keeps the full path, so the tooltip
    // still says where the label lives and every rule that selects on it goes
    // on working.
    //
    // Safari will not do this in CSS. `content` on an ordinary element is
    // ignored — measured, the chip's width did not budge — and the
    // alternatives either need the font size hardcoded or leave the chip the
    // width of the text it is no longer showing.
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
    // the path is the text and nothing else — no title to read it back from.
    // So the path moves into the title, which both keeps the tooltip and makes
    // this safe to run again: the leaf is left alone the second time round.
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

    // A badge on the phone is `<div class="u-badge"><span>Inbox</span></div>` —
    // no href, no title, nothing but the text, which CSS cannot select on. So
    // the name is stamped where a rule can reach it, and the rules go on doing
    // the hiding. Cheaper and steadier than hiding from script: the answer stops
    // depending on when this last ran, and turning the mode off puts every badge
    // back without walking anything.
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
    // Watching the whole mail app covers the two without having to know when
    // the reading pane gets built; only nodes it adds are looked at, so the
    // cost is a walk of whatever just appeared. Rewriting text replaces a text
    // node, and those are turned away at the top, so this cannot feed itself.
    let labelObserver = null;

    const watchLabels = () => {
        const app = document.getElementById('mail') || document.querySelector('.v-Page-main');
        if (!app || app === (labelObserver && labelObserver.root)) return;

        if (labelObserver) labelObserver.observer.disconnect();

        const SOURCE_ROW = '.v-MailboxSource';

        const drawsSourceRow = (node) =>
            !!node.querySelector &&
            ((node.matches && node.matches(SOURCE_ROW)) || !!node.querySelector(SOURCE_ROW));

        const draws = (node, selector) =>
            !!node.querySelector &&
            ((node.matches && node.matches(selector)) || !!node.querySelector(selector));

        const observer = new MutationObserver((changes) => {
            let sidebarDrawn = false;
            let toolbarDrawn = false;
            let headerDrawn = false;

            changes.forEach((change) => {
                change.addedNodes.forEach((node) => {
                    stripLabelsIn(node);
                    sidebarDrawn = sidebarDrawn || drawsSourceRow(node);
                    if (!FastMail.isMobile) return;
                    toolbarDrawn = toolbarDrawn || draws(node, '.v-Toolbar');
                    headerDrawn = headerDrawn || draws(node, '.v-PageHeader');
                });
            });

            // Each rebuilt toolbar comes back with Remove in it
            if (toolbarDrawn) {
                dressToolbar();
                updatePinState();
            }

            // Placement gives up after a second of the header not being there.
            // That is generous on a desktop and not necessarily on a phone
            // starting cold, so the header turning up is itself a reason to try
            // again. Guarded on the timer so this joins the existing attempt
            // rather than starting a second chain alongside it.
            if (headerDrawn && !placeTimer) placeIndicator();

            // A row appearing or leaving moves where one kind gives way to
            // the next
            if (sidebarDrawn) {
                markSourceGroups();
                dressSourceSections();
            }
        });

        observer.observe(app, { childList: true, subtree: true });
        labelObserver = { root: app, observer: observer };
        stripLabelsIn(app);
        markSourceGroups();
        dressSourceSections();
        if (FastMail.isMobile) {
            dressToolbar();
            updatePinState();
        }
    };

    // Lucide's filter glyph, drawn in the SVG namespace and given the classes
    // and inline style of the icon it replaces, so Fastmail's sizing and
    // colouring carry on applying. The toolbar indicator wears it.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const FILTER_ICON_CLASS = 'custom-filterIcon';
    // Lucide draws to the edges of its 24-unit box; Fastmail's icons sit well
    // inside theirs. Measured in the same viewBox, its own glyphs cover about
    // 15.5 units against the funnel's 20, so the funnel read a third too big
    // beside them. The points are scaled by 0.775 about the centre — geometry
    // rather than the viewBox, so the stroke keeps its weight — which brings it
    // to 15.5 x 14, between Fastmail's filter and label icons.
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
        // The sizing classes are worth having; the glyph identifier is not —
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

    // The sidebar runs the system folders, the labels and the saved searches
    // together in one list. Where one kind gives way to another, a line: the
    // first row of each new run is marked, and the rule above draws it.
    //
    // Anything under an Inbox counts as a system folder for this, so a label you
    // keep in there stays part of the Inbox rather than being fenced off from it
    // — and the folder after it does not read as the start of something new.
    //
    // The class and the offset are written onto every row on every pass, not
    // only onto the ones that changed. Collapsing a parent takes rows out of the
    // list, which moves the boundary; a stale mark left behind would draw the
    // line, and open the gap, in the wrong place.
    const sourceKind = (mailbox) =>
        (isUserLabel(mailbox) && !isUnderInbox(mailbox) ? 'label' : 'system');

    // A saved search is a source like the others and belongs to no mailbox, so
    // it is a third kind rather than part of whatever run it happens to follow.
    // That is what gathers the searches into a block of their own.
    //
    // Matched on the row's own class rather than on the absence of a mailbox: a
    // row this script does not recognise says nothing about where a run starts,
    // and is better carried along with the rows around it than made to open a
    // block it has no business opening.
    const SEARCH_ROW = '.v-SearchSource';

    const rowKind = (el, mailbox) => {
        if (mailbox) return sourceKind(mailbox);

        return el.matches && el.matches(SEARCH_ROW) ? 'search' : null;
    };

    // The lists holding sidebar rows, and the mailbox behind each row that has
    // one. Not every row does: a saved search is a row in the same list with no
    // mailbox behind it, and Fastmail places it alongside the rest.
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
        // With the option off the rows go back where Fastmail put them. The
        // class is left alone: without the rule above it draws nothing, so
        // turning the option back on costs a restyle rather than another walk.
        const gap = settings.sidebarSeparators ? SEPARATOR_GAP : 0;
        const { mailboxes, lists } = sourceLists();

        // Each list is walked on its own. A second account's sources are a list
        // of their own, positioned from their own origin, so an offset carried
        // over from the list above would push them all down; and its first row
        // already has the group's heading above it, which says the same thing a
        // line would.
        lists.forEach((list) => {
            let previous = null;
            let offset = 0;

            // Every child, not just the rows with a mailbox behind them. A row
            // this script cannot place still has to be given a place, or it is
            // left behind underneath one of the others.
            //
            // The list writes each row's place into the row's own style, so the
            // slots are read back as they are rather than measured — nothing
            // forces layout on a path that runs at every sidebar redraw.
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

            // The rows now end lower than the list knows about — its height is
            // written inline by Fastmail and would only be overwritten again.
            // The group around it has no height of its own, so padding there
            // grows it, and anything below is pushed clear rather than sat on.
            const group = list.parentElement;
            if (group) group.style.paddingBottom = offset ? `${offset}px` : '';
        });
    };

    // Only a group with a title draws a header, and every one that has a title
    // draws one — so a second account showing sources of its own is a second
    // header, and one header means there is nothing else on screen to collapse
    // to. Counted here rather than asked for in a selector: saying it in CSS
    // needs a :has() inside a :has(), which is invalid, and Safari throws out
    // the whole rule.
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

            const actual = mailboxPaths(message);

            chips.forEach((chip) => {
                const span = chip.querySelector('span[title]');
                const name = span && span.getAttribute('title');

                if (name && actual.indexOf(name) === -1) chip.remove();
            });
        });
    };

    // A new arrival never inserts itself into a filtered list: Fastmail's
    // own pass only inserts into pure in-mailbox lists, and its push refresh
    // passes our registered queries by — so a fresh message bumped the
    // header count and never made the rows, and the topic badges sat on
    // yesterday's number. So everything we registered refetches on arrival:
    // the visible custom list and every badge query of the session, each
    // cheap by construction.
    //
    // The arrival's signal is the Inbox Mailbox record, not the Message
    // event: our own refetches commit Email records, which fed the Message
    // event this first hung off — fetch, event, fetch, the refresh icon
    // jittering forever. A mailbox's totals cannot echo that way: the server
    // pushes them for an arrival and the verbs adjust them optimistically,
    // but no query refetch ever moves them — so the totals changing is the
    // one reading of "something arrived or left" that always converges.
    const refreshCustomList = () => {
        if (!modeIsOn) return;

        const list = controller().get('mailboxMessageList');
        if (list && list.customPrimed && typeof list.setObsolete === 'function') {
            list.setObsolete();
        }

        badgeQueries.forEach(({ query }) => {
            if (query && typeof query.setObsolete === 'function') {
                query.setObsolete();
            }
        });
    };

    let inboxTotalsSeen = null;

    const inboxTotalsSignature = () => {
        try {
            return toArray(FastMail.store.getAll(FastMail.classes.Mailbox))
                .filter(mailbox => mailbox.get('role') === 'inbox')
                .map(mailbox => [
                    mailbox.get('id'),
                    mailbox.get('totalEmails'),
                    mailbox.get('unreadEmails'),
                    mailbox.get('totalThreads'),
                    mailbox.get('unreadThreads')
                ].join(':'))
                .join('|');
        } catch (error) {
            return inboxTotalsSeen;
        }
    };

    const refreshCustomListOnArrival = () => {
        const signature = inboxTotalsSignature();
        if (signature === inboxTotalsSeen) return;

        const primed = inboxTotalsSeen !== null;
        inboxTotalsSeen = signature;
        if (primed) refreshCustomList();
    };

    const refresh = () => {
        repaintBadges();
        pushAppBadge();
        dropStaleChips();
        markSourceGroups();
        dressSourceSections();
        watchLabels();
        stripLabelsIn(document);
        updateIndicator();
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

    // Message changes arrive in bursts — a bulk action, or the initial preload
    // of an Inbox — so coalesce them into one repaint. No counting happens
    // here any more; this is chips and dressing.
    let refreshTimer = null;

    const scheduleRefresh = () => {
        if (!modeIsOn || refreshTimer) return;

        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refresh();
        }, 100);
    };

    // Toggling only affects where you go next, because selecting the source you
    // are already on short-circuits before reaching goSource. So apply the
    // change to the label in front of you as well, or the toggle looks inert.
    // An explicit toggle outranks a filter picked by hand earlier; turning the
    // mode off only clears the filter it put there.
    const applyModeToCurrentView = () => {
        const mailController = controller();
        if (mailController.get('search')) return;

        const mailbox = mailController.get('mailbox');
        if (!modeManagesSource(mailbox)) return;

        // Wrapped for the same reason as goSource: the mode putting a filter on
        // or taking it off is not you choosing one. Without this, switching the
        // mode off recorded "" against whichever label you were looking at, and
        // switching it back on left that one label unfiltered.
        settingOurFilter(() => {
            if (modeIsOn) {
                mailController.set('mailboxFilter', filterFor(mailbox));
            } else if (mailController.get('mailboxFilter') === filterFor(mailbox)) {
                // Only clear the filter this mode put there
                mailController.set('mailboxFilter', '');
            }
        });
    };

    const setMode = (on, applyToCurrentView = true) => {
        modeIsOn = !!on;

        try {
            localStorage.setItem(STORAGE_KEY, modeIsOn ? '1' : '0');
        } catch (error) {
            console.warn('Inbox mode: could not persist the mode', error);
        }

        if (applyToCurrentView) applyModeToCurrentView();

        // The colour rules are only emitted while the mode is on
        updateStyles();
        refresh();
    };

    const toggleMode = () => setMode(!modeIsOn);

    // On by default: the mode is meant to be the normal state, with the button
    // there for the times you want out of it
    const storedMode = () => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
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

    // Overture's registry is keyed on the character a key produces, which is no
    // use for Option, so these are handled here instead. preventDefault matters
    // for more than tidiness: without it the dead key stays pending and accents
    // the next thing typed.
    const isTypingTarget = (node) => {
        if (!node) return false;
        if (node.isContentEditable) return true;

        const name = node.nodeName;
        return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
    };

    const bindOptionShortcuts = () => {
        document.addEventListener('keydown', (event) => {
            if (!event.altKey || event.metaKey || event.ctrlKey) return;
            if (isTypingTarget(event.target)) return;

            // Move to as Fastmail ships it. Matched on the physical key: on a
            // Mac, Option-V arrives as "√", so there is no name to register.
            if (event.code === STOCK_MOVE_CODE && moveButton) {
                event.preventDefault();
                wantOurMove = false;
                moveButton.target[moveButton.method]();
                return;
            }

            const source = OPTION_SOURCE_CODES.indexOf(event.code);
            if (source === -1) return;

            event.preventDefault();
            goToSourceAt(source);
        }, true);
    };

    const addObservers = () => {
        // The store fires an event keyed by record type whenever records of
        // that type change; this is the same signal LocalQuery subscribes to in
        // monitorForChanges. Watching the Inbox query's membership is not
        // enough: adding or removing a label leaves a message in the Inbox, so
        // membership never changes and the counts would go stale.
        FastMail.store.on(FastMail.classes.Message, { go: scheduleRefresh }, 'go');

        // The stylesheet names labels and their colours, so it goes stale when
        // one is recoloured, renamed, added or removed. Reorganising labels —
        // renesting a dozen of them under a parent, say — changes them one at a
        // time, so this is coalesced the same way message changes are, rather
        // than rebuilding the sheet once per record.
        //
        // The same event is when the state-label cache goes stale, and when a
        // badge needs repainting: totalThreads lives on the Mailbox record,
        // and Fastmail adjusts it optimistically on every action.
        FastMail.store.on(FastMail.classes.Mailbox, {
            go: () => {
                forgetLabelCache();
                scheduleStyles();
                scheduleBadgeRepaint();
                refreshCustomListOnArrival();
            }
        }, 'go');

        // Moving between sources rebuilds the toolbar, taking the indicator
        // with it. This runs whether the mode is on or off, because the button
        // stays visible either way — grey when off.
        controller().addObserverForKey('mailbox', { go: refreshToolbar }, 'go');

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
            go: () => {
                rememberCurrentFilter();
                refreshToolbar();
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
     * The menu is recognised the way the shells' Share item recognises it —
     * options carrying both a reply and a forward action — and the injection
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

    // Fastmail's own notification layer. The container view is built with
    // the root view at boot and inserted right after it, on desktop and on
    // the phone alike, so its drawn node is always there to ask for the
    // instance. Its show() wraps a bare string in the same NotificationView
    // every stock toast is — same corner, same look, same close button —
    // and manages the queue of them itself.
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

    const copyLinkOption = () => {
        const option = new FastMail.classes.ButtonView({
            label: 'Copy link',
            icon: linkIcon(),
            method: 'chooseItem',
            chooseItem() {
                const url = currentMessageLink();
                if (url) copyText(url);
            }
        });

        option.customCopyLinkOption = true;
        return option;
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

    const patchMessageMenu = () => {
        const MenuView = FastMail.classes.MenuView;
        if (!MenuView || MenuView.prototype.customCopyLink) return;
        MenuView.prototype.customCopyLink = true;

        const originalDraw = MenuView.prototype.draw;

        MenuView.prototype.draw = function () {
            try {
                const options = this.get('options');
                if (options && typeof options.unshift === 'function' &&
                    !options.some(option => option && option.customCopyLinkOption) &&
                    isMessageActionsMenu(options)) {
                    options.unshift(copyLinkOption(), null);
                }
            } catch (error) {
                console.warn('Inbox mode: could not add Copy link', error);
            }

            return originalDraw.apply(this, arguments);
        };
    };

    const start = () => {
        loadFilters();
        patchBadgeRendering();
        patchGoSource();
        patchDrop();
        patchMailboxMenu();
        patchArchive();
        patchLabelActions();
        patchSnooze();
        patchMessageList();
        patchMessageMenu();
        patchTitleAndCount();
        patchShortcuts();
        updateStyles();
        installAppBadge();
        shortcut(SHORTCUT, toggleMode);

        // Rotation and split view change how many verbs fit on the bar
        let redressTimer = null;
        window.addEventListener('resize', () => {
            if (!FastMail.isMobile) return;
            if (redressTimer) clearTimeout(redressTimer);
            redressTimer = setTimeout(() => {
                redressTimer = null;
                updateIndicator();
            }, 150);
        });

        for (let i = 1; i <= SOURCE_SHORTCUT_COUNT; i += 1) {
            SOURCE_SHORTCUT_MODIFIERS.forEach((modifier) => {
                shortcut(`${modifier}-${i}`, () => goToSourceAt(i - 1));
            });
        }

        bindOptionShortcuts();
        addObservers();

        // On a fresh load, apply the filter only if the mode is on: with it off
        // we must not strip a ?filter= the URL itself asked for
        const wasOn = storedMode();
        setMode(wasOn, wasOn);

        // Handy from the console, and how the counts can be checked by hand
        window.customInboxMode = {
            isOn: () => modeIsOn,
            setMode,
            toggleMode,
            refresh,
            countFor,
            badgeQueries: () => badgeQueries,
            listQueries: () => listQueries,
            sourcesAboveLabels,
            goToSourceAt,
            filters: () => rememberedFilters,
            forgetFilters: () => { rememberedFilters = {}; saveFilters(); },
            settings: () => settings,
            // Called by the extension when the settings change, so options take
            // effect without a reload
            applySettings: (next) => {
                settings = Object.assign({}, DEFAULT_SETTINGS, next || {});
                // Turning the chip setting off makes every remembered "hide"
                // wrong, not just this view's
                forgetHide();
                // The label names and the deferred set may have changed, and
                // every registered query bakes them into its where
                forgetLabelCache();
                dropBadgeQueries();
                dropListQueries();
                // The verb keys, the bar slots and the app badge are
                // settings too
                reclaimKeys();
                updateIndicator();
                installAppBadge();
                updateStyles();
                updateInboxLabelVisibility();
                refresh();
            }
        };

        console.log(`Inbox mode ready (${SHORTCUT} to toggle), currently ${modeIsOn ? 'on' : 'off'}`);
    };

    const mainObserver = new MutationObserver(() => {
        if (!isReady()) return;
        mainObserver.disconnect();
        start();
    });

    if (isReady()) {
        start();
    } else {
        mainObserver.observe(document.body, { attributes: true, childList: true, subtree: true });
    }

})();
