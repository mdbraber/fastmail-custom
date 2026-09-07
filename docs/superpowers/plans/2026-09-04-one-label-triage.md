# One-label triage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a project label the live state and nothing else — a message is Triage, filed under one project, or done — with archive meaning the same thing from every list, `w` opening Fastmail's snooze dialog prefilled, and the model enforced underneath every menu and gesture rather than inside the script's picker.

**Architecture:** The userscript (`fastmail-custom-mode.user.js`, one 6,100-line IIFE) patches Fastmail's mail controller `actions` object. Three rules are added at that level — archive strips, a project label replaces, a named label files the sender — by wrapping `add`/`copy`/`addremove`/`move` the way `archive`/`remove` are already wrapped. The verbs shrink to keep, pin, snooze and archive. The per-label filter system stays in the file behind one constant, off. The settings catalog is mirrored in the Safari extension and the shell apps and changes with it.

**Tech Stack:** Vanilla JS userscript running in Fastmail's page world (Overture views, `FastMail.store`, `controller().actions`); a Safari web extension (MV3, `scripting.executeScript` world MAIN); Swift/SwiftUI shell apps built with XcodeGen; `node --check` for syntax; manual verification on `app.beta.fastmail.com` driven from the terminal via `osascript`.

**Spec:** `docs/superpowers/specs/2026-09-04-fastmail-one-label-triage-design.md`

## Global Constraints

- Nothing writes to a store record outside a verb, and no verb writes a mailbox setting. The script never writes `Mailbox.splits` and never adds `Triage`.
- Counts come from `Mailbox.totalThreads`, never from a scan of loaded messages.
- Each verb is one undo checkpoint under one toast; `z` reverts it whole. Preparatory moves go through `silencingDidAction(actions, fn)`; exactly one `didAction` is left unswallowed.
- The payload guards against running twice (`if (window.customMode) return;` at the top). Keep it.
- All three rules live at Fastmail's action level so a swipe, a tap and a key do the same thing.
- The settings catalog lives in three places and changes together: the userscript's `DEFAULT_SETTINGS`; `safari-extension/background.js` + `settings.js` + `settings.html`; `fastmail-app/Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift` + the generated `Apps/*/Settings.bundle/Root.plist`.
- The filter system is retired, not removed: kept verbatim behind `LABEL_FILTERS = false`, parsing at all times.
- The script must parse (`node --check`) and run (the beta tab loads with `Custom mode ready` in the console) after every task.
- Version becomes `3.0`; commit subjects follow the repo's style: `feat: … (v3.0)` in lowercase prose.

---

## Verification harness

There is no automated test for the userscript. Every task verifies the same way; the exact commands are here so no task has to repeat them.

**Syntax:**
```bash
node --check fastmail-custom-mode.user.js && echo "parses"
```

**Rebuild the Safari extension so the beta tab runs the edited payload** (Xcode resolves the symlinked resources at build time, so an edit is invisible until this runs; the app must be quit first or `open` is a no-op):
```bash
osascript -e 'tell application "Fastmail Custom mode" to quit' 2>/dev/null
cd "/Users/mdbraber/src/fastmail-custom/safari-extension-app/Fastmail Custom mode" && \
xcodebuild -project "Fastmail Custom mode.xcodeproj" -scheme "Fastmail Custom mode" \
  -configuration Debug -derivedDataPath build build 2>&1 | grep -E "BUILD (SUCCEEDED|FAILED)" && \
open "build/Build/Products/Debug/Fastmail Custom mode.app"
cd /Users/mdbraber/src/fastmail-custom
```
Then reload the `app.beta.fastmail.com` tab in Safari. The extension must be enabled for that site once (Safari → Settings → Extensions); the console logs `Custom mode ready (Shift-I to toggle)` when the payload runs.

**Run read-only JavaScript in the beta tab from the terminal** (Safari → Develop → Allow JavaScript from Apple Events must be on; it already is):
```bash
osascript probe-run.applescript probe-labels.js
```
`probe-run.applescript` and `probe-labels.js` are created in Task 0.

**Look at labels on the selected conversation** — the check most tasks end with. After pressing a key in the beta tab, run the probe; it prints the labels every message of the selected thread carries, and the count of loaded Inbox messages that carry a project label without the Inbox (which must be 0 except after a deliberate Option-drag).

**Never delete messages on the beta tab.** Archive, label and snooze are fine; `z` undoes each verb.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `fastmail-custom-mode.user.js` | the payload | most of the work; sections named per task |
| `probe-run.applescript`, `probe-labels.js` | read-only verification from the terminal | created (Task 0) |
| `safari-extension/background.js`, `settings.js`, `settings.html` | settings catalog mirror #1 | Task 11 |
| `fastmail-app/.../CustomModeSettings.swift`, `Apps/*/Settings.bundle/Root.plist`, `Tests/.../CustomModeSettingsTests.swift` | settings catalog mirror #2 | Task 12 |
| `fastmail-app/.../ComposePool.swift` | the compose window's URL | Task 13 |
| `fastmail-app/.../harness.js`, `NativeBridge.swift`, `WebContainer.swift`, `AppShell.swift`, new `MailNotification.swift`, `NotificationPresenter.swift` | macOS notifications via Fastmail's desktop-app hook | Task 14 |

The userscript stays one file — that is how the repo works — but the tasks below name each section by its banner comment (`* The verbs`, `* Sticky filter`, …) and by the function names in it, which are unique.

---

### Task 0: The verification probe

**Files:**
- Create: `probe-run.applescript`
- Create: `probe-labels.js`

**Interfaces:**
- Produces: `osascript probe-run.applescript <file.js>` — runs the file's JavaScript in Safari's current tab and prints what it returns.

- [ ] **Step 1: Write the runner**

```applescript
-- probe-run.applescript: run a JavaScript file in Safari's current tab.
-- Read-only by convention; the probes never modify messages.
on run argv
  set js to (read POSIX file (item 1 of argv) as «class utf8»)
  tell application "Safari" to do JavaScript js in current tab of front window
end run
```

- [ ] **Step 2: Write the probe**

```javascript
/*
 * Labels on the selected conversation, and the one invariant that matters:
 * a project label implies the Inbox. Read-only. Paste into the console on
 * app.beta.fastmail.com, or run with:  osascript probe-run.applescript probe-labels.js
 */
(function () {
    try {
        const S = FastMail.store, C = FastMail.classes;
        const ctrl = FastMail.router.getAppController('mail');
        const names = (message) => {
            const boxes = message.get('mailboxes');
            const out = [];
            for (let i = 0; i < (boxes.get('length') || 0); i += 1) {
                out.push(boxes.getObjectAt(i).get('name'));
            }
            return out;
        };
        const keys = ctrl.actions.getSelectedStoreKeys() || [];
        const selected = keys.map(k => S.getRecordFromStoreKey(k))
            .filter(m => m instanceof C.Message);
        const threads = selected.map((message) => {
            const thread = message.get('thread');
            const list = thread ? thread.get('messages').map(x => x) : [message];
            return {
                subject: message.get('subject'),
                messages: list.map(m => ({ from: (m.get('fromName') || ''), labels: names(m) }))
            };
        });

        // Invariant over what is loaded: project label ⇒ Inbox
        const visible = S.getAll(C.Mailbox).filter(m => !m.get('role') && !(Number(m.get('hidden')) & 1))
            .map(m => m.get('name'));
        const settings = (window.customMode && window.customMode.settings()) || {};
        const excluded = String(settings.excludedLabels || 'Later').split(',').map(s => s.trim().toLowerCase());
        const triage = String(settings.triageLabel || 'Triage').toLowerCase();
        const projects = visible.filter(n => excluded.indexOf(n.toLowerCase()) === -1 && n.toLowerCase() !== triage);
        let orphans = 0;
        S.getAll(C.Message).forEach((m) => {
            const labels = names(m);
            if (labels.some(n => projects.indexOf(n) !== -1) && labels.indexOf('Inbox') === -1) orphans += 1;
        });

        return JSON.stringify({ selected: threads, projects, orphansLoaded: orphans }, null, 1);
    } catch (error) {
        return 'ERR ' + error.message;
    }
})()
```

- [ ] **Step 3: Run it against the beta tab with a conversation selected**

Run: `osascript probe-run.applescript probe-labels.js`
Expected: JSON with `selected` (one entry per selected thread, each message's labels), `projects` (Personal, Kerk, Admin, Fiddle, SIDNfonds — whatever is visible and not excluded), and `orphansLoaded` (a number). If it prints `ERR …`, the tab is not on Fastmail or nothing is loaded yet.

- [ ] **Step 4: Commit**

```bash
git add probe-run.applescript probe-labels.js
git commit -m "chore: a read-only probe for labels and the inbox invariant"
```

---

### Task 1: The new label vocabulary (additive)

Adds the new helpers and settings next to the old ones. Nothing is removed yet, so the script keeps running on the old model while later tasks move each consumer across.

**Files:**
- Modify: `fastmail-custom-mode.user.js` — the `Configuration` section (`DEFAULT_SETTINGS`), and the `The state mailboxes` section (`stateLabels` … `isFiled`).

**Interfaces:**
- Produces:
  - `const LABEL_FILTERS = false;` — a module-level constant.
  - `settings.triageLabel` (`'Triage'`), `settings.snoozeKey` (`'w'`), `settings.snoozeDefault` (`'2w'`), `settings.snoozeTime` (`'08:00'`), `settings.labelColoursSkipTriage` (`true`).
  - `triageMailbox(accountId) -> Mailbox|null`
  - `isTriage(mailbox) -> boolean`, `isProject(mailbox) -> boolean`, `isHelper(mailbox) -> boolean`
  - `projectsAmong(storeKeys) -> Mailbox[]`, `triageAmong(storeKeys) -> Mailbox[]`, `unfiledAmong(storeKeys) -> Message[]`

- [ ] **Step 1: Add the constant to the Configuration section**

Directly after the line `const SHORTCUT = 'Shift-I';` add:

```javascript
    // The per-label filter system — next, triage, deferred, noninbox — is
    // retired but kept: Fastmail's groups do its job on the server now.
    // Off, nothing of it installs. Every hook it had is guarded by this
    // one name, so a search for LABEL_FILTERS finds all of it.
    const LABEL_FILTERS = false;
```

- [ ] **Step 2: Add the new settings to `DEFAULT_SETTINGS`**

Inside `DEFAULT_SETTINGS`, directly after `labelColoursSkipProcess: true,` add:

```javascript
        // Triage is on every undecided row, so tinting by it would paint
        // the whole group one shade and say nothing
        labelColoursSkipTriage: true,
```

Directly after `nonInboxLabels: '',` add:

```javascript
        // The label a rule puts on everything incoming. Taken off by keeping
        // or filing; the script never adds it.
        triageLabel: 'Triage',
        // w opens Fastmail's own snooze dialog filled in for this far ahead —
        // a count and d, w or m — at this time of day
        snoozeKey: 'w',
        snoozeDefault: '2w',
        snoozeTime: '08:00',
```

- [ ] **Step 3: Teach `stateLabels` about Triage**

In `stateLabels`, inside the `cached = { … }` object literal, directly after `inbox: mailboxesOf(accountId).filter(m => m.get('role') === 'inbox')[0] || null,` add:

```javascript
            triage: findByPath(accountId, settings.triageLabel),
```

- [ ] **Step 4: Add the accessors and predicates**

Directly after the line `const nonInboxMailboxes = (accountId) => stateLabels(accountId).nonInbox;` add:

```javascript
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
```

- [ ] **Step 5: Add the selection helpers**

Directly after the `carriesMailbox` definition in the `The verbs` section (the line ending `.indexOf(mailbox) !== -1);`), add:

```javascript
    const projectsAmong = (storeKeys) =>
        Array.from(mailboxesAmong(storeKeys)).filter(isProject);

    const triageAmong = (storeKeys) =>
        Array.from(mailboxesAmong(storeKeys)).filter(isTriage);

    // The keep rule's question: does every selected conversation carry a
    // project? Those that do not are asked where they go.
    const unfiledAmong = (storeKeys) => messagesFrom(storeKeys)
        .filter(message => !threadOf(message).some(other =>
            toArray(other.get('mailboxes')).some(isProject)));
```

- [ ] **Step 6: Parse, rebuild, load**

Run: `node --check fastmail-custom-mode.user.js && echo parses`
Expected: `parses`

Rebuild and reload per *Verification harness*. In the beta tab's console:
```javascript
window.customMode.settings().triageLabel
```
Expected: `"Triage"`.

- [ ] **Step 7: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: the label vocabulary of the one-label model, beside the old (v3.0 wip)"
```

---

### Task 2: The rules under every menu

Wraps `add`, `copy`, `addremove` and `move` on the mail controller's `actions` so that a project label added from any route replaces Triage and any other project, and a label named in `contactGroupLabels` files the sender from any route. Moves sender filing out of the picker.

**Files:**
- Modify: `fastmail-custom-mode.user.js` — new section placed directly before the `* The verbs` banner; `addInsteadOfMoving` in `The Labels menu`; `start()`.

**Interfaces:**
- Consumes: `isProject`, `isTriage`, `mailboxesAmong`, `resolveKeys`, `silencingDidAction(actions, fn)`, `fileSendersIntoGroup(mailbox, keys)`, `toArray`, `controller()`, `modeIsOn`.
- Produces: `patchLabelActions()`; `replacedBy(storeKeys, adds) -> Mailbox[]`.

- [ ] **Step 1: Add the section**

Directly before the banner comment block that reads `* The verbs` (the one preceding `// Archive in labels mode is …`), insert:

```javascript
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
                        return original.call(this, keys, adds, merged);
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
```

- [ ] **Step 2: Take sender filing out of the picker**

In `addInsteadOfMoving`, inside `menu.didSelect`, delete these lines (the comment and the call):

```javascript
            // The pick itself, before any branch below acts on it: the keys
            // are read here because the verb clears itself on the way past
            // and the label-only branches hand actions a null selection.
            fileSendersIntoGroup(mailbox, pendingVerb
                ? pendingVerb.keys
                : resolveKeys(controller().actions, null));

```

- [ ] **Step 3: Install it at start**

In `start()`, directly after the line `patchArchive();` add:

```javascript
        patchLabelActions();
```

- [ ] **Step 4: Parse, rebuild, load, verify rule 2 from the stock menu**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. Rebuild and reload.

In the beta tab: select a conversation that carries `Personal`. Press `l` (Fastmail's Labels menu), tick `Kerk`, press Enter. Run `osascript probe-run.applescript probe-labels.js`.
Expected: every message of the thread shows `Kerk` and `Inbox`, and no longer `Personal`. Press `z`: both back as they were, in one undo.

- [ ] **Step 5: Verify rule 3**

In the beta tab's console, set the setting for this session only:
```javascript
window.customMode.applySettings(Object.assign({}, window.customMode.settings(), { contactGroupLabels: 'Later' }))
```
Select a conversation, press `l`, type `Lat`, tick `Later`, Enter.
Expected: Fastmail's toast area shows `<sender> added to Later` (or `… added to contacts and Later`); the message carries `Later` in addition to what it had (Later is a helper: nothing was removed). Press `z` to undo the label; the contact-group add has its own undo in the script (`undoGroupAdds`) and is left in place — that is existing behaviour.

- [ ] **Step 6: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: a project label replaces, and a named label files the sender, from every route (v3.0 wip)"
```

---

### Task 3: `v` keeps, `Shift-V` refiles, `s` pins — and the picker stops deciding

`v` takes Triage off a thread that already carries a project, and opens the picker for one that does not. The picker becomes a plain menu: a pick is an ordinary add. Everything that let a verb wait on a pick goes.

**Files:**
- Modify: `fastmail-custom-mode.user.js` — `runKeep`, `runUrgent`, `runDefer`, `runVerb` in `The verbs proper`; `openTopicPicker`, `armPicker`, `askBare`, `PICKER_DEADLINE_MS`, `pendingVerb`, `abortPendingVerb` in `The topic picker`; `addInsteadOfMoving`; `wrapApplyForVerb`; `patchMailboxMenu`; `labelsMenuOptions`; `wantedClaims`; `keepLeavesThisView`.

**Interfaces:**
- Consumes: `triageAmong`, `unfiledAmong`, `allFlagged`, `resolveKeys`, `moveButton`, `labelsButton`, `capturedIsLive`, `pressCaptured`, `drawnPickerView`, `pressButtonView`, `buildPicker`, `wantOurMove`, `openLabelPicker`.
- Produces: `runKeep(actions, keys)`, `runUrgent(actions, keys)`, `runVerb('keep'|'urgent', storeKeys)`, `openProjectPicker(keys)`.

- [ ] **Step 1: Replace `runKeep`, `runUrgent`, `runDefer` and `runVerb`**

Delete the four functions `runKeep`, `runUrgent`, `runDefer` and `runVerb` (from the comment `// keep — \`v\`: the marker on, the deferred set off.` through the closing `};` of `runVerb`) and put this in their place:

```javascript
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
```

- [ ] **Step 2: Replace `openTopicPicker` with `openProjectPicker`, and drop the waiting-verb plumbing**

Delete `let pendingVerb = null;`, `abortPendingVerb`, `askBare`, `PICKER_DEADLINE_MS`, `armPicker`, and the whole `openTopicPicker` function. Put this where `openTopicPicker` was:

```javascript
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

        console.warn('Custom mode: no label menu to open');
    };
```

Also update the section's banner comment (`* The topic picker.` …) to:

```javascript
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
```

- [ ] **Step 3: Make the picker's pick a plain add**

Replace the whole body of `menu.didSelect` inside `addInsteadOfMoving` with:

```javascript
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
```

- [ ] **Step 4: Delete `wrapApplyForVerb`**

Delete the whole `wrapApplyForVerb` function. In `patchMailboxMenu`, inside `proto.didEnterDocument`, delete the `if (pendingVerb) { … }` block and the call `wrapApplyForVerb(this);` (with its three-line comment above it). Delete the whole `proto.didLeaveDocument = function () { … };` override and the comment block above it (`// Closing without committing …`), and delete the line `const originalDidLeaveDocument = proto.didLeaveDocument;`.

In `proto.keydown`, delete the first `if` block — the one guarded by `this.customVerbOpen && pendingVerb && !typed && event && event.key === 'Enter'` — leaving the `customLabels` Enter block and the fallthrough. Update the comment above `const originalKeydown = proto.keydown;` to:

```javascript
        // Enter with nothing typed commits: what you have ticked is ticked,
        // and the tristate applies it as it closes. With something typed it
        // still picks out what the typing has focused, which is Fastmail's
        // own behaviour.
```

- [ ] **Step 5: `labelsMenuOptions` no longer knows about a waiting verb**

In `labelsMenuOptions`, delete the two lines:
```javascript
        const menu = menuController.customMenu;
        const asVerbPicker = !!(pendingVerb && menu && menu.customVerbOpen);
```
and replace the body of the `options.filter` callback with:
```javascript
            if (!(option instanceof FastMail.classes.Mailbox)) return true;
            if (option.get('role')) return false;
            return isProject(option);
```
Replace the comment above the function with:
```javascript
    // Narrowed to the projects you can file under. Typing still reaches
    // anything, as in the other menu: being handed a shorter list is not the
    // same as being told a label does not exist — which is how a helper
    // label like `c` or Later is ticked from here.
```

- [ ] **Step 6: `narrowLabelOptions` offers projects**

In `narrowLabelOptions` (the `menuController.filterOptions` override), replace the body of the `options.filter` callback with:

```javascript
                // Leave anything that is not a mailbox alone: "Create label…"
                // is an option in this list too
                if (!(option instanceof FastMail.classes.Mailbox)) return true;

                return !settings.labelsSidebarOnly || isProject(option);
```

- [ ] **Step 7: The key claims**

Replace the body of `wantedClaims` with:

```javascript
        const wanted = {
            'Shift-V': () => openLabelPicker()
        };

        wanted[sanitizedKey(settings.urgentKey, 's')] = () => runVerb('urgent', null);

        return wanted;
```
(`Shift-E`, `waitingKey` and `somedayKey` are gone; `snoozeKey` is claimed in Task 5.)

Update the comment above `openMove` to:
```javascript
    // v is keep: on a filed selection it takes Triage off directly, and only
    // an unfiled one opens the picker — the same narrowed menu, opened with
    // nothing waiting on it.
```

- [ ] **Step 8: Remove `keepLeavesThisView`**

Delete the `keepLeavesThisView` function and the comment block above it (from `// The slices a keep empties out from under you.` to its closing `};`). Nothing calls it any more.

- [ ] **Step 9: Parse, rebuild, load, verify**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. Then `grep -n "pendingVerb\|openTopicPicker\|runDefer\|wrapApplyForVerb\|keepLeavesThisView" fastmail-custom-mode.user.js` → expected: only mentions inside the `dressToolbar` state-verb code (`stateVerbOption` still calls `runVerb('waiting'…)` — fixed in Task 7) and none elsewhere. If `stateVerbOption` is the only hit, that is fine for now; `runVerb` ignores unknown kinds by treating them as keep — acceptable until Task 7 removes the buttons.

Rebuild and reload. In the beta tab:
1. Select a conversation in a project group (it carries, say, `Kerk`, no `Triage`). Press `v`. Expected: nothing happens (no Triage to take off), no picker.
2. Add `Triage` to it by hand: `l`, type `Tri`, tick, Enter. Now press `v`. Expected: `Triage` off, `Kerk` untouched, Inbox untouched — confirm with the probe. `z` restores.
3. Press `Shift-V` on it, pick `Personal`. Expected: `Personal` on, `Kerk` off, Inbox on. `z` restores both in one step.
4. Press `s`. Expected: pinned (moves to the Pinned group). `s` again: unpinned.
5. On a conversation with no project label (use the catch-all "Overig" group, or remove the project by hand with `l`), press `v`. Expected: the narrowed picker opens listing projects only; pick one; it is filed and the Inbox stays.

- [ ] **Step 10: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: v keeps, Shift-V refiles, s pins; the picker is a menu, not a verb (v3.0 wip)"
```

---

### Task 4: `e` archives from everywhere, and never asks

Archive strips the Inbox, Triage, every project label and the pin, from any route, and the picker-before-archive, `Shift-E` and the long-press are removed.

**Files:**
- Modify: `fastmail-custom-mode.user.js` — `runDone`; `patchArchive`; `suppressPicker`, `escapeVerb`; the `Long-press to archive bare` section (`LONG_PRESS_MS` … `installLongPressArchive`); `start()`.

**Interfaces:**
- Consumes: `isTriage`, `isProject`, `mailboxesAmong`, `anyFlagged`, `silencingDidAction`, `inFilteredView`, `withDidAction`, `navigateAfter`, `urlForMessage`, `pendingUndoReturn`, `refreshListAfter`, `inboxMailbox`, `messagesFrom`, `resolveKeys`.
- Produces: `runDone(actions, keys, finish)`.

- [ ] **Step 1: Replace `runDone`**

Replace the `runDone` function (and its two-line comment) with:

```javascript
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
```

- [ ] **Step 2: Simplify `patchArchive`**

Inside `patchArchive`, in the `actions[verb] = function (storeKeys, goTo) { … }` body:

- Delete the line `if (consumeGhostArchive()) return this;`.
- Replace everything from `const self = this;` to the end of the function body (`finish(null, false);` / `return this;`) with:

```javascript
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
```

- [ ] **Step 3: Remove the escape verb and the long-press**

Delete `let suppressPicker = false;` with its comment, the `escapeVerb` function, and the whole long-press section: the banner comment starting `* Long-press to archive bare — the touch Shift-E.`, `LONG_PRESS_MS`, `LONG_PRESS_SLOP`, `longPressFired`, `swallowUntil`, `consumeGhostArchive`, `archiveButtonViewFromNode`, `pressBare`, and `installLongPressArchive`. In `start()`, delete the line `installLongPressArchive();`.

Run: `grep -n "suppressPicker\|escapeVerb\|installLongPressArchive\|consumeGhostArchive\|untopicedAmong" fastmail-custom-mode.user.js`
Expected: only the `untopicedAmong` definition remains (deleted in Task 10). Anything else is a missed reference — fix it.

- [ ] **Step 4: Parse, rebuild, load, verify**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. Rebuild and reload.

In the beta tab:
1. Select a conversation carrying `Kerk` + `Inbox`, pinned. Press `e`. Expected: it leaves the Inbox; the probe (select it again from the Kerk label or search) shows neither `Inbox`, `Kerk` nor the pin. One toast. `z` restores all three.
2. Select a conversation in the catch-all group (no project). Press `e`. Expected: archived at once — no picker, no dialog.
3. Open a conversation carrying `c` (search `in:c`), archive it with the toolbar button. Expected: `c` stays; Inbox and any project go.
4. `Shift-E` does nothing of ours (Fastmail's own binding, if any, answers).

- [ ] **Step 5: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: archive strips every project label and never asks first (v3.0 wip)"
```

---

### Task 5: `w` opens the snooze dialog filled in

**Files:**
- Modify: `fastmail-custom-mode.user.js` — new section directly before the `* The rules under every menu` banner; `wantedClaims`; `patchSnooze` and its `start()` call.

**Interfaces:**
- Consumes: `registeredToolbarView(name)`, `toolbarsOnScreen()`, `hasShortcut(view, key)`, `SNOOZE_SHORTCUT`, `pressButtonView(view)`, `isViewOfClass(view, name)`, `settings.snoozeDefault`, `settings.snoozeTime`, `settings.snoozeKey`, `sanitizedKey`.
- Produces: `parseSnoozePeriod(text) -> {count, unit}`, `parseSnoozeTime(text) -> {hours, minutes}`, `snoozeTarget(now, period, time) -> Date`, `asPickerDate(local) -> Date`, `snoozePeriodLabel(text) -> string`, `openSnoozeDialog()`.

- [ ] **Step 1: Add the section**

Directly before the `* The rules under every menu` banner, insert:

```javascript
    /*
     * ----------------------------------------------------------------
     * Snooze for a while — `w`
     * ----------------------------------------------------------------
     */

    // Fastmail's Snooze button is a MenuButtonView whose menu is a
    // FutureTimeMenuView: the presets, and a custom option that swaps them
    // for a FutureCustomTimeView — a date picker and a time field bound to
    // that view's `date`, a preview line, Save and Cancel, Enter to save.
    // So w presses the button, switches the menu to the custom picker, and
    // proposes a date. Nothing is snoozed until the dialog is confirmed, and
    // from there it is Fastmail's own code, toast and all.

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
    // as if it were UTC — its drawCustom subtracts the timezone offset and
    // its localDate adds it back — so the same shift is applied here, or the
    // dialog shows the right day at the wrong hour.
    const asPickerDate = (local) =>
        new Date(local.getTime() - local.getTimezoneOffset() * 60000);

    // "2w" → "2 weeks", for a button label
    const snoozePeriodLabel = (text) => {
        const period = parseSnoozePeriod(text);
        const unit = { d: 'day', w: 'week', m: 'month' }[period.unit];
        return period.count + ' ' + unit + (period.count === 1 ? '' : 's');
    };

    // The Snooze button on whichever bar is drawn: by its registered name
    // first, which survives translation and a bar too narrow to draw it;
    // by its shortcut behind that.
    const snoozeButtonView = () => {
        const registered = registeredToolbarView('snooze');
        if (registered) return registered;

        for (const bar of toolbarsOnScreen()) {
            const found = (bar.get('childViews') || [])
                .filter(view => hasShortcut(view, SNOOZE_SHORTCUT))[0];
            if (found) return found;
        }
        return null;
    };

    const openSnoozeDialog = () => {
        const button = snoozeButtonView();
        if (!button || typeof button.get !== 'function') {
            console.warn('Custom mode: no Snooze button to open');
            return;
        }

        const menu = button.get('menuView');
        pressButtonView(button);

        if (!menu || typeof menu.showCustomPicker !== 'function') return;

        const propose = () => {
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
```

- [ ] **Step 2: Claim the key**

In `wantedClaims`, directly after the `urgentKey` line, add:

```javascript
        wanted[sanitizedKey(settings.snoozeKey, 'w')] = () => openSnoozeDialog();
```

- [ ] **Step 3: Remove the old snooze patch**

Delete the `patchSnooze` function and its comment (`// Snooze means "gone now, queued later" …`), and the line `patchSnooze();` in `start()`.

- [ ] **Step 4: Parse, rebuild, load, verify**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. Rebuild and reload.

In the beta tab, open a conversation and press `w`. Expected: Fastmail's snooze popover appears already on the custom picker, showing a date two weeks from today, time 08:00, and a preview line reading "in 2 weeks" (or Fastmail's wording). Press Escape: nothing snoozed. Press `w` again, then Enter: the thread is snoozed; Fastmail's own toast shows; `z` undoes. Check the label afterwards with the probe: the project label is still on the message.

Check the date maths in the console:
```javascript
(() => { const s = window.customMode.settings(); const now = new Date(2026, 8, 4, 15, 30); const t = new Date(now); t.setHours(8,0,0,0); t.setDate(t.getDate()+14); return t.toString(); })()
```
Expected: `Fri Sep 18 2026 08:00:00 …` — the same day the dialog proposes when run on 4 September.

- [ ] **Step 5: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: w opens the snooze dialog filled in for the default period (v3.0 wip)"
```

---

### Task 6: Drag adds; Option-drag moves

**Files:**
- Modify: `fastmail-custom-mode.user.js` — `patchDrop` in the `Drag and drop` section.

**Interfaces:**
- Consumes: `controller().actions.add/copy/move`, `settings.dragAdditive`, `modeIsOn`.

- [ ] **Step 1: Replace the drop branches**

In `patchDrop`, replace the `if (optionHeld) { … } else if … else { … }` chain with:

```javascript
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
```

Replace the comment above `patchDrop` with:

```javascript
    // Dropping a message on a label adds it, and the rules under every menu
    // do the rest: a project takes Triage and any other project off, the
    // Inbox stays. Option restores the stock move.
```

- [ ] **Step 2: Parse, rebuild, load, verify**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. Rebuild and reload.

In the beta tab: drag a conversation from the Personal group onto `Kerk` in the sidebar. Expected (probe): `Kerk` + `Inbox`, no `Personal`. `z`. Option-drag the same onto `Kerk`. Expected: `Kerk`, no `Inbox`, no `Personal` — and `orphansLoaded` in the probe goes up by one, which is the deliberate exception. `z`.

- [ ] **Step 3: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: drag adds and the rules finish it; Option-drag is Fastmail's move (v3.0 wip)"
```

---

### Task 7: The phone bar

Keep becomes File, Waiting and Someday go, and More gets "Snooze 2 weeks".

**Files:**
- Modify: `fastmail-custom-mode.user.js` — `STATE_VERB_SHAPES`, `stateVerbOption`, the `SLOT_KINDS` table and the `[['Keep', 'keep'], …]` loop inside `dressToolbar`; `DEFAULT_SETTINGS.bottomBarSlots`.

**Interfaces:**
- Consumes: `runVerb('keep', null)`, `openSnoozeDialog()`, `snoozePeriodLabel(text)`, `standardIcon(name, shapes)`, `settings.snoozeDefault`.

- [ ] **Step 1: The shapes**

Replace `STATE_VERB_SHAPES` with:

```javascript
    const STATE_VERB_SHAPES = {
        file: [
            ['path', { d: 'M19.75,11.29V12a7.75,7.75,0,1,1-4.6-7.08' }],
            ['polyline', { points: '19.75 5.8 12 13.56 9.68 11.23' }]
        ],
        snooze: [
            ['circle', { cx: '12', cy: '12', r: '7.75' }],
            ['polyline', { points: '12 7.81 12 12 14.93 13.47' }]
        ]
    };
```

- [ ] **Step 2: The buttons**

Replace `stateVerbOption` (and its comment) with:

```javascript
    // Dispatched a tick later so the More popover has finished closing:
    // File sends an unfiled conversation to the Labels sheet, and two menus
    // fighting over the same moment is how taps get eaten
    const stateVerbOption = (label, kind) => {
        const run = kind === 'snooze'
            ? () => setTimeout(openSnoozeDialog, 0)
            : () => setTimeout(() => runVerb('keep', null), 0);

        const option = new FastMail.classes.ButtonView({
            label: label,
            icon: standardIcon('i-' + kind, STATE_VERB_SHAPES[kind]),
            target: { run },
            method: 'run'
        });

        // The kind, not a bare flag: the bar slots tell them apart
        option.customStateVerb = kind;
        return option;
    };
```

- [ ] **Step 3: The slot table**

Inside `dressToolbar`'s `SLOT_KINDS`, replace the three entries `keep`, `waiting`, `someday` with one:

```javascript
                file: {
                    test: (view) => view.customStateVerb === 'file',
                    make: () => stateVerbOption('File', 'file')
                },
```

Update the comment above `SLOT_KINDS` to read `// The slot vocabulary. File can be made from nothing, since Fastmail draws no button for it; the rest are stock views, found wherever the last pass left them.`

- [ ] **Step 4: The More loop**

Replace the block that begins with the comment `// The states the keyboard spells v, w and o, for thumbs.` and the `[['Keep', 'keep'], ['Waiting', 'waiting'], ['Someday', 'someday']]` loop with:

```javascript
            // The keyboard's v and w, for thumbs. File named as a slot is
            // already on the bar; otherwise it waits in More. Snooze for the
            // default period is More-only: the bar's Snooze is Fastmail's.
            if (slotNames.indexOf('file') === -1 && !inMore(SLOT_KINDS.file.test)) {
                addToMore(stateVerbOption('File', 'file'));
            }
            if (!inMore(view => view.customStateVerb === 'snooze')) {
                addToMore(stateVerbOption(
                    'Snooze ' + snoozePeriodLabel(settings.snoozeDefault), 'snooze'));
            }
```

- [ ] **Step 5: The default slots**

In `DEFAULT_SETTINGS`, change `bottomBarSlots` to `'Snooze, Pin, Archive, Labels, File, Delete, Move'`. A saved value that still names `Keep`, `Waiting` or `Someday` loses those names as unknown kinds, and `File` joins at the end — which is the documented behaviour of the setting.

- [ ] **Step 6: Parse, rebuild, load, verify on the phone layout**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. `grep -n "'waiting'\|'someday'\|runVerb('keep'" fastmail-custom-mode.user.js` → expected: no `'waiting'`/`'someday'` string literals remain; `runVerb('keep'` appears in `openMove` and `stateVerbOption` only.

Rebuild and reload. Narrow the Safari window to under 500px so Fastmail switches to the phone bar (or use the iPhone shell app after Task 12's deploy). Open a conversation. Expected bar: Snooze, Pin, Archive, Labels, then More. In More: File, Snooze 2 weeks, and Fastmail's own entries. Tap File on an unfiled conversation: the Labels sheet, narrowed to projects. Tap Snooze 2 weeks: the snooze sheet on the custom picker, two weeks out.

- [ ] **Step 7: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: the phone bar files and snoozes for a while; keep, waiting and someday go (v3.0 wip)"
```

---

### Task 8: Counts, colours and the indicator

Badges show totals; the app badge is the Triage count; colours skip Triage; the toolbar indicator is the global switch.

**Files:**
- Modify: `fastmail-custom-mode.user.js` — `countFor`, `unreadFor`, `headerUnreadFor`, `appBadgeCount`, `APP_BADGE_KINDS` in `Counting`; `labelColourRules`; `currentLabel`, `indicatorIsActive`, `toggleCurrent` in `Toolbar indicator`.

**Interfaces:**
- Consumes: `LABEL_FILTERS`, `isTriage`, `isSidebarLabel`, `settings.labelColoursSkipTriage`, `settings.appBadgeLabel`, `mailboxPath`, `modeIsOn`, `toggleMode`.

- [ ] **Step 1: Counts are totals**

At the top of `countFor`, before its first `if`, add:

```javascript
        // Without the filters a badge is the label's own total: a project
        // label implies the Inbox, so its total is its queue
        if (!LABEL_FILTERS) return mailbox.get('totalThreads') || 0;
```

At the top of `unreadFor` and of `headerUnreadFor`, add:

```javascript
        if (!LABEL_FILTERS) return 0;
```

- [ ] **Step 2: The app badge**

In `appBadgeCount`, replace the three lines
```javascript
        const named = String(settings.appBadgeFilter || '').trim().toLowerCase();
        const kindName = FILTER_ALIASES[named] || named;
        const kind = APP_BADGE_KINDS[kindName] ? kindName : '';
```
with
```javascript
        // The label's total; the filtered variants belong to the retired
        // filter system and are not offered
        const kind = '';
```
and change the `DEFAULT_SETTINGS` entry `appBadgeLabel: 'Inbox',` to `appBadgeLabel: 'Triage',`. Delete `appBadgeFilter: 'next',` from `DEFAULT_SETTINGS`.

- [ ] **Step 3: Colours**

In `labelColourRules`, replace the `.filter(m => …)` predicate with:

```javascript
            .filter(m => isUserLabel(m) && m.get('color') &&
                !(settings.labelColoursSkipTriage && isTriage(m)) &&
                (!settings.labelColoursSidebarOnly || isSidebarLabel(m)))
```
and delete the `.sort((a, b) => { … })` call that follows it (with its comment about qualifiers). Replace the comment block above the filter with:

```javascript
            // Triage is on every undecided row, so tinting rows by it would
            // colour the whole group one shade and say nothing. The colours
            // are there to show what a message is about. An option, since a
            // colour you have given the label is a choice.
            // "Sidebar only" is the labels you actually file into.
```

- [ ] **Step 4: The indicator**

Replace `currentLabel` with:

```javascript
    const currentLabel = () => {
        const mailController = controller();
        if (mailController.get('search')) return null;

        const mailbox = mailController.get('mailbox');
        return isUserLabel(mailbox) ? mailbox : null;
    };
```

Replace `indicatorIsActive` with:

```javascript
    const indicatorIsActive = () => {
        const label = currentLabel();
        return LABEL_FILTERS && label ? modeForLabel(label) : modeIsOn;
    };
```

In `toggleCurrent`, change the first two lines to:

```javascript
        const label = currentLabel();
        if (!LABEL_FILTERS || !label) return toggleMode();
```

- [ ] **Step 5: Parse, rebuild, load, verify**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. Rebuild and reload.

Expected in the beta tab: sidebar badges on `Personal`, `Kerk`, `Admin`, `Fiddle` show their thread totals (matching the group counts in the Inbox); `Triage` (if shown) shows its total; rows in the Inbox keep their project colours; a row carrying only `Triage` is uncoloured. Clicking the toolbar's Custom-mode indicator toggles the whole mode (the console reports `isOn()` flipping), whichever label is open. In a shell app the icon badge is the Triage total (deploy comes with Task 12).

- [ ] **Step 6: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: badges are totals, the app badge is Triage, colours skip Triage (v3.0 wip)"
```

---

### Task 9: Retire the filter system behind `LABEL_FILTERS`

Every hook the filter system has is guarded; its code stays verbatim; the settings it reads become an internal block beside it.

**Files:**
- Modify: `fastmail-custom-mode.user.js` — `start()`, `updateIndicator`, `addObservers`, `setMode`, `inFilteredView`; the top of the `Sticky filter` section; `whereFor`; the `showFilteredCounts`/`showHeaderCounts` reads in `countFor`, `unreadFor`, `headerUnreadFor` and `patchTitleAndCount`.

**Interfaces:**
- Produces: `RETIRED_SETTINGS` (object), `retiredStateLabels(accountId)`.

- [ ] **Step 1: Guard the installers in `start()`**

Replace the lines `loadFilters();`, `patchGoSource();`, `patchMessageList();`, `patchTitleAndCount();` in `start()` with:

```javascript
        if (LABEL_FILTERS) loadFilters();
        patchBadgeRendering();
        if (LABEL_FILTERS) patchGoSource();
```
(keeping `patchBadgeRendering();` where it was between them) and, in place of the later two:
```javascript
        if (LABEL_FILTERS) patchMessageList();
        patchMessageMenu();
        if (LABEL_FILTERS) patchTitleAndCount();
```
The resulting order of the first lines of `start()` is: `loadFilters` (guarded), `patchBadgeRendering`, `patchGoSource` (guarded), `patchDrop`, `patchMailboxMenu`, `patchArchive`, `patchLabelActions`, `patchMessageList` (guarded), `patchMessageMenu`, `patchTitleAndCount` (guarded), `patchShortcuts`, …

- [ ] **Step 2: Guard the per-view hooks**

In `updateIndicator`, replace
```javascript
        ensureFilterMenuPatched();
        ensureMobileFilterMenuPatched();
        updateFilterButton();
        updateInboxLabelVisibility();
```
with
```javascript
        if (LABEL_FILTERS) {
            ensureFilterMenuPatched();
            ensureMobileFilterMenuPatched();
            updateFilterButton();
        }
        updateInboxLabelVisibility();
```

In `addObservers`, change `refreshCustomListOnArrival();` to `if (LABEL_FILTERS) refreshCustomListOnArrival();` and `rememberCurrentFilter();` to `if (LABEL_FILTERS) rememberCurrentFilter();`.

In `setMode`, change `if (applyToCurrentView) applyModeToCurrentView();` to `if (applyToCurrentView && LABEL_FILTERS) applyModeToCurrentView();`.

In `inFilteredView`, change `if (!modeIsOn) return false;` to `if (!modeIsOn || !LABEL_FILTERS) return false;`.

- [ ] **Step 3: The retired settings block**

Directly after the `* Sticky filter` banner comment (before `// Each label — and the Inbox — keeps whichever filter…`), insert:

```javascript
    // The settings the retired code reads, kept here with their old defaults
    // so nothing below references a setting the catalog no longer has.
    // Written against the old model — Process, qualifiers, the deferred
    // labels — and so would need re-basing on Triage before any of this
    // said something true again.
    const RETIRED_SETTINGS = {
        processLabel: 'Next',
        qualifierLabels: 'Admin, Waiting',
        deferredLabels: 'Waiting, Snoozed',
        waitingLabel: 'Waiting',
        somedayLabel: 'Someday',
        nonInboxLabels: '',
        showFilteredCounts: true,
        showHeaderCounts: true,
        appBadgeFilter: 'next'
    };

    // The old state-label set, for the filter builder below
    const retiredStateLabels = (accountId) => {
        const deferredPaths = pathsFromSetting(RETIRED_SETTINGS.deferredLabels);
        [RETIRED_SETTINGS.waitingLabel, RETIRED_SETTINGS.somedayLabel].forEach((path) => {
            const trimmed = String(path || '').trim();
            if (trimmed && !deferredPaths.some(other =>
                other.toLowerCase() === trimmed.toLowerCase())) {
                deferredPaths.push(trimmed);
            }
        });

        return {
            inbox: mailboxesOf(accountId).filter(m => m.get('role') === 'inbox')[0] || null,
            process: findByPath(accountId, RETIRED_SETTINGS.processLabel),
            deferred: deferredPaths.map(path => findByPath(accountId, path)).filter(Boolean),
            nonInbox: pathsFromSetting(RETIRED_SETTINGS.nonInboxLabels)
                .map(path => findByPath(accountId, path)).filter(Boolean)
        };
    };
```

- [ ] **Step 4: Point the retired code at it**

In `whereFor`, change `const { inbox, process, deferred, nonInbox } = stateLabels(accountId);` to `const { inbox, process, deferred, nonInbox } = retiredStateLabels(accountId);`.

Then, everywhere in the file that still reads them, replace `settings.showFilteredCounts` → `RETIRED_SETTINGS.showFilteredCounts`, `settings.showHeaderCounts` → `RETIRED_SETTINGS.showHeaderCounts`:

```bash
sed -i '' 's/settings\.showFilteredCounts/RETIRED_SETTINGS.showFilteredCounts/g; s/settings\.showHeaderCounts/RETIRED_SETTINGS.showHeaderCounts/g' fastmail-custom-mode.user.js
grep -n "RETIRED_SETTINGS\.\(showFilteredCounts\|showHeaderCounts\)" fastmail-custom-mode.user.js
```
Expected: hits in `countFor`, `unreadFor`, `headerUnreadFor`, `patchTitleAndCount` — all below the `if (!LABEL_FILTERS)` guards or inside guarded installers. Delete `showFilteredCounts: true,` and `showHeaderCounts: true,` (with their comments) from `DEFAULT_SETTINGS`.

- [ ] **Step 5: Parse, rebuild, load, verify the filters are gone**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. `grep -c "LABEL_FILTERS" fastmail-custom-mode.user.js` → expected: 12 or more.

Rebuild and reload. In the beta tab: Fastmail's filter menu (the funnel beside the list heading) shows only its own entries — no Next / Triage / Deferred. Open `https://app.beta.fastmail.com/mail/Personal/?filter=next&u=f5e940af`: the label opens unfiltered. In the console, `window.customMode.listQueries().size` → `0`.

- [ ] **Step 6: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: the filter system is retired behind one constant, off (v3.0 wip)"
```

---

### Task 10: Remove the old vocabulary and rewrite the header

The marker, qualifiers, the deferred states and non-inbox labels leave the live code and the settings; the file's header describes the new model; the version becomes 3.0.

**Files:**
- Modify: `fastmail-custom-mode.user.js` — `DEFAULT_SETTINGS`; `stateLabels` and the accessors after it; `isTopic`, `isFiled`, `untopicedAmong`, `carriedDispositions`; `qualifierCache`/`qualifierPaths`/`qualifierRank`; every remaining `isProcess`/`isDeferred`/`isNonInbox` use; the header comment (lines 1–107 today); `applySettings`.

- [ ] **Step 1: Remove the settings**

From `DEFAULT_SETTINGS` delete, with their comments: `labelColoursSkipProcess`, `processLabel`, `qualifierLabels`, `deferredLabels`, `waitingLabel`, `somedayLabel`, `nonInboxLabels`, `waitingKey`, `somedayKey`. (`showFilteredCounts`, `showHeaderCounts`, `appBadgeFilter` went in Tasks 8–9.) Update the `excludedLabels` comment to `// Shown in the sidebar but worked as piles, not queues: never filed into, never stripped by archive` and the `contactGroupLabels` comment to say `Adding one — from any menu, by typing, or by drag — adds from[0] to the contact group of the same name, making the contact, and the group, if either is new.`

- [ ] **Step 2: Shrink `stateLabels`**

Replace the `stateLabels` function body so that `cached` is only:

```javascript
        cached = {
            inbox: mailboxesOf(accountId).filter(m => m.get('role') === 'inbox')[0] || null,
            triage: findByPath(accountId, settings.triageLabel)
        };
```
(delete the `deferredPaths` computation above it). Delete the accessors `processMailbox`, `waitingMailbox`, `somedayMailbox`, `deferredMailboxes`, `nonInboxMailboxes`, and the predicates `isProcess`, `isDeferred`, `isNonInbox`, `isTopic`, `isFiled`. Update the section banner from `The state mailboxes: Inbox, Process, and the deferred labels` to `The state mailboxes: Inbox and Triage`.

- [ ] **Step 3: Remove the qualifier machinery and the old selection helpers**

Delete `qualifierCache`, `qualifierPaths`, `qualifierRank` (the block from `let qualifierCache = …` through the end of `qualifierRank`). Delete `untopicedAmong` and `carriedDispositions` with their comments.

- [ ] **Step 4: Find and fix every remaining reference**

```bash
grep -n "isProcess\|isDeferred\|isNonInbox\|isTopic\|isFiled\|qualifierRank\|carriedDispositions\|untopicedAmong\|processMailbox\|waitingMailbox\|somedayMailbox\|deferredMailboxes\|nonInboxMailboxes\|settings\.processLabel\|settings\.qualifierLabels\|settings\.deferredLabels\|settings\.waitingLabel\|settings\.somedayLabel\|settings\.nonInboxLabels\|settings\.waitingKey\|settings\.somedayKey\|labelColoursSkipProcess" fastmail-custom-mode.user.js
```

For each hit, apply the rule that fits:
- A reference inside the retired sections (`Sticky filter`, `The Next filter`, `whereFor`, or any function only called under `LABEL_FILTERS`): leave `process`/`deferred`/`nonInbox` reads that come from `retiredStateLabels`; replace any bare `isProcess(x)` with `x === retiredStateLabels(x.get('accountId')).process`, `isDeferred(x)` with `retiredStateLabels(x.get('accountId')).deferred.indexOf(x) !== -1`, and `isNonInbox(x)` likewise with `.nonInbox`.
- A reference in live code: it should not exist after Tasks 3–8. `isFiled(mailbox)` → `isProject(mailbox)`; `isTopic(mailbox)` → `isProject(mailbox)`. Any other live hit is a missed change — fix it to the new model rather than re-adding the old helper.
- The string `Process` in comments describing the old model: rewrite the comment.

Run the grep again; expected: no hits outside the two retired sections and `retiredStateLabels`.

- [ ] **Step 5: The header**

Replace everything between the `==/UserScript==` line and the `(function () {` line with:

```javascript
/*
Fastmail Custom mode
Maarten den Braber <m@mdbraber.com>
version 3.0 - 2026-09-04

Spec: docs/superpowers/specs/2026-09-04-fastmail-one-label-triage-design.md

# The model

A project label is the live state and nothing else. History is search.

| State     | Carries                               | Who put it there            |
|-----------|---------------------------------------|-----------------------------|
| Triage    | Inbox + Triage                        | the catch-all rule          |
| Pre-filed | Inbox + Triage + one project label    | that rule and a sender rule |
| Filed     | Inbox + exactly one project label     | you                         |
| Done      | neither; helper labels untouched      | you                         |

Snoozed is any of these that Fastmail has taken out of the Inbox for a
while; it comes back as it was. A project label implies the Inbox; a
message has at most one project label; Triage and a project coexist only
when rules put both there. Helper labels — hidden from the sidebar, or named
in settings.excludedLabels — are never added, removed, counted or offered
by anything here.

The Inbox's groups (Fastmail's own, a setting on the mailbox) are the
working surface: `in:Triage OR is:unread` first, then Pinned, then one per
project, then the catch-all for anything that arrived without passing the
rule. The script never writes them.

# Verbs

All work on the selection and the whole conversation; each is one undo
checkpoint under one toast, and `z` reverts it whole.

* `v`       keep — with a project on the thread: Triage off, nothing else.
            Without one: the picker, narrowed to projects; the pick is an
            ordinary add.
* `Shift-V` refile — always the picker.
* `e`       done — Inbox, Triage, every project label and the pin come off.
            The same from every list; never asks first.
* `s`       pin — a toggle.
* `w`       snooze — Fastmail's own dialog, on its custom picker, filled in
            for settings.snoozeDefault at settings.snoozeTime. Enter confirms.
* `l`       Fastmail's tristate Labels menu, narrowed to projects; typing
            reaches anything, which is how a helper label is ticked.
* drag      adds the label; Option-drag is Fastmail's move.

# The rules under every menu

Every label change in the client goes through five actions on the mail
controller — add, remove, addremove, copy, move — and the model is enforced
there, so a key, a menu, a drag and a swipe do the same thing:

1. Archive strips: Inbox, Triage, every project label, the pin.
2. A project label replaces: adding one takes Triage and every other
   project off in the same checkpoint. The Inbox is not touched.
3. A label named in settings.contactGroupLabels files the sender into the
   contact group of that name, from any route.

# Notes

* Nothing here writes to a store record outside a verb, and no verb writes
  a mailbox setting. Badge counts come from Mailbox.totalThreads.
* The per-label filter system of v2 (next, triage, deferred, noninbox and
  the ?filter= parameter) is retired, not removed: it sits behind
  LABEL_FILTERS, off, with the settings it read kept beside it. It is
  written against the v2 model and would need re-basing before use.
* On the phone the message bar is Snooze / Pin / Archive / Labels / More,
  with File and "Snooze 2 weeks" in More.
*/
```

Change the `@version` line to `// @version      3.0`.

- [ ] **Step 6: `applySettings`**

In `applySettings` inside `start()`, replace the comment `// The label names and the deferred set may have changed, and every registered query bakes them into its where` with `// The label names may have changed, and every registered query bakes them into its where`.

- [ ] **Step 7: Parse, rebuild, load, run every scenario once**

Run: `node --check fastmail-custom-mode.user.js && echo parses` → `parses`. Rebuild and reload; the console must show `Custom mode ready`.

Walk the spec's scenarios 1–12 on the beta tab, using the probe after each; in particular: 1 (new mail, `v`, picker), 3 (`e` on a filed message strips both), 4 (`Shift-V` refiles), 5 (`s` pin toggle), 6 (`w` dialog), 8 (drag and Option-drag), 9a (Later files the sender from `l` and from drag — set `contactGroupLabels` to `Later` via `applySettings` first), 9b (a Triage + Kerk message: `v` takes Triage off only), 11 (multi-select mixed: `v` → Kerk gives all three Kerk only; `e` strips everything, one toast). After the walk, `orphansLoaded` in the probe is what it was before, or higher only by your Option-drags.

- [ ] **Step 8: Commit**

```bash
git add fastmail-custom-mode.user.js
git commit -m "feat: one label is the live state, and archive means one thing everywhere (v3.0)"
```

---

### Task 11: The Safari extension's copy of the catalog

**Files:**
- Modify: `safari-extension/background.js` (`DEFAULT_SETTINGS`), `safari-extension/settings.js` (`DEFAULT_SETTINGS`), `safari-extension/settings.html` (the rows).

**Interfaces:**
- Consumes: the userscript's final `DEFAULT_SETTINGS` from Task 10 — the two JS copies must be identical to it, key for key.

- [ ] **Step 1: The two JS copies**

In both `background.js` and `settings.js`, replace the `DEFAULT_SETTINGS` object with exactly:

```javascript
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
    urgentKey: 's',
    snoozeKey: 'w',
    snoozeDefault: '2w',
    snoozeTime: '08:00',
    bottomBarSlots: 'Snooze, Pin, Archive, Labels, File, Delete, Move',
    excludedLabels: 'Later',
    contactGroupLabels: '',
    appBadgeLabel: 'Triage',
    swapArchiveExpand: true,
    sidebarSeparators: true,
    hideLoneExpando: true
};
```

Check it matches the userscript:
```bash
node -e '
const src = require("fs").readFileSync("fastmail-custom-mode.user.js","utf8");
const m = /const DEFAULT_SETTINGS = (\{[\s\S]*?\n    \});/.exec(src);
const a = Object.keys(eval("(" + m[1] + ")")).sort();
const b = Object.keys(eval("(" + /const DEFAULT_SETTINGS = (\{[\s\S]*?\n\});/.exec(require("fs").readFileSync("safari-extension/settings.js","utf8"))[1] + ")")).sort();
console.log(JSON.stringify(a) === JSON.stringify(b) ? "keys match" : "MISMATCH " + a + " vs " + b);
'
```
Expected: `keys match`.

- [ ] **Step 2: The HTML rows**

In `settings.html`:

Replace the `labelColoursSkipProcess` row with:
```html
    <label class="sub" data-parent="labelColours">
        <input type="checkbox" id="labelColoursSkipTriage">
        <span>
            <span class="title">Ignore the triage label</span>
            <span class="hint">Everything undecided carries it; its colour would tint the whole group.</span>
        </span>
    </label>
```

Delete the rows for `processLabel`, `qualifierLabels`, `deferredLabels`, `waitingLabel`, `somedayLabel`, `nonInboxLabels`, `waitingKey`, `somedayKey`, `showFilteredCounts`, `showHeaderCounts`, `appBadgeFilter` (each is one `<label …> … </label>` block containing that `id`).

Where the `processLabel` row was, add:
```html
    <label class="text">
        <span>
            <span class="title">The triage label</span>
            <span class="hint">Put on every incoming message by a rule; taken off by keeping or filing. Archive strips it too.</span>
            <input type="text" id="triageLabel" spellcheck="false" autocapitalize="off" placeholder="Triage">
        </span>
    </label>
```

Directly after the `urgentKey` row, add:
```html
    <label class="text">
        <span>
            <span class="title">Snooze key</span>
            <span class="hint">Opens the snooze dialog filled in for the default period.</span>
            <input type="text" id="snoozeKey" spellcheck="false" autocapitalize="off" placeholder="w">
        </span>
    </label>

    <label class="text">
        <span>
            <span class="title">Default snooze</span>
            <span class="hint">How far ahead the dialog proposes: a number and d, w or m — days, weeks, months.</span>
            <input type="text" id="snoozeDefault" spellcheck="false" autocapitalize="off" placeholder="2w">
        </span>
    </label>

    <label class="text">
        <span>
            <span class="title">Snooze time of day</span>
            <span class="hint">When on that day, as HH:MM.</span>
            <input type="text" id="snoozeTime" spellcheck="false" autocapitalize="off" placeholder="08:00">
        </span>
    </label>
```

Change the `bottomBarSlots` input's `placeholder` to `Snooze, Pin, Archive, Labels, File, Delete, Move`. Change the `appBadgeLabel` placeholder to `Triage` and its hint to `The app icon's badge, for the shell apps: this label's total. Empty hands the shell its own fallback.` Change the `excludedLabels` title to `Labels that are never projects` and hint to `Shown in the sidebar but worked as piles, not queues: never filed into, never stripped by archive. Comma-separated paths.` Change the `contactGroupLabels` hint to `Adding one — from any menu, by typing, or by drag — adds the sender to the contact group of the same name, making it if new. Comma-separated paths.`

Check every id in the HTML is a key and vice versa:
```bash
node -e '
const html = require("fs").readFileSync("safari-extension/settings.html","utf8");
const ids = [...html.matchAll(/<input[^>]*id="([a-zA-Z]+)"/g)].map(m=>m[1]).sort();
const js = require("fs").readFileSync("safari-extension/settings.js","utf8");
const keys = Object.keys(eval("(" + /const DEFAULT_SETTINGS = (\{[\s\S]*?\n\});/.exec(js)[1] + ")")).sort();
console.log(JSON.stringify(ids) === JSON.stringify(keys) ? "ids match keys" : "MISMATCH\n" + ids + "\n" + keys);
'
```
Expected: `ids match keys`.

- [ ] **Step 3: Rebuild, open the popup**

Rebuild per *Verification harness*. Click the extension's toolbar button in Safari: the popup shows the new rows and no old ones; change "Default snooze" to `3d`, press `w` in the beta tab: the dialog proposes three days out.

- [ ] **Step 4: Commit**

```bash
git add safari-extension/background.js safari-extension/settings.js safari-extension/settings.html
git commit -m "feat: the extension's settings follow the one-label model (v3.0)"
```

---

### Task 12: The shell apps' copy of the catalog

**Files:**
- Modify: `/Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift` (the `options` array)
- Modify: `/Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift`
- Regenerate: `/Users/mdbraber/src/fastmail-app/Apps/Personal/Settings.bundle/Root.plist`, `/Users/mdbraber/src/fastmail-app/Apps/Work/Settings.bundle/Root.plist`

**Interfaces:**
- Consumes: the catalog from Task 11 — same keys, same defaults, same copy.

- [ ] **Step 1: Update the tests first**

In `CustomModeSettingsTests.swift`, every reference to `processLabel` becomes `triageLabel`, every `"Next"` default becomes `"Triage"`, and every `"Keep"` override value becomes `"Todo"`:
```bash
cd /Users/mdbraber/src/fastmail-app
sed -i '' 's/processLabel/triageLabel/g; s/"Next"/"Triage"/g; s/"  Keep  "/"  Todo  "/g; s/"Keep"/"Todo"/g' Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift
grep -n "triageLabel\|Triage\|Todo" Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift
```
Expected: the same assertions, now about `triageLabel`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit && swift test --filter CustomModeSettings 2>&1 | grep -E "passed|failed|error" | tail -5`
Expected: failures mentioning `triageLabel` (the catalog has no such option yet).

- [ ] **Step 3: The catalog**

In `CustomModeSettings.swift`'s `options` array:

Replace the `labelColoursSkipProcess` entry with:
```swift
        Option(
            "labelColoursSkipTriage",
            parent: "labelColours",
            title: "Ignore the triage label",
            hint: "Everything undecided carries it; its colour would tint the whole group.",
            default: .toggle(true)
        ),
```

Delete the entries for `processLabel`, `qualifierLabels`, `deferredLabels`, `waitingLabel`, `somedayLabel`, `nonInboxLabels`, `waitingKey`, `somedayKey`, `showFilteredCounts`, `showHeaderCounts`, `appBadgeFilter`.

Where `processLabel` was, add:
```swift
        Option(
            "triageLabel",
            title: "The triage label",
            hint: "Put on every incoming message by a rule; taken off by keeping or filing. Archive strips it too.",
            default: .text("Triage")
        ),
```

Directly after the `urgentKey` entry, add:
```swift
        Option(
            "snoozeKey",
            title: "Snooze key",
            hint: "Opens the snooze dialog filled in for the default period.",
            default: .text("w")
        ),
        Option(
            "snoozeDefault",
            title: "Default snooze",
            hint: "How far ahead the dialog proposes: a number and d, w or m — days, weeks, months.",
            default: .text("2w")
        ),
        Option(
            "snoozeTime",
            title: "Snooze time of day",
            hint: "When on that day, as HH:MM.",
            default: .text("08:00")
        ),
```

Change the `bottomBarSlots` default to `.text("Snooze, Pin, Archive, Labels, File, Delete, Move")`. Change `appBadgeLabel`'s default to `.text("Triage")` and its hint to `"The app icon's badge: this label's total. Empty hands the shell its own fallback."`. Change `excludedLabels`'s title to `"Labels that are never projects"` and hint to `"Shown in the sidebar but worked as piles, not queues: never filed into, never stripped by archive. Comma-separated paths."`. Change `contactGroupLabels`'s hint to `"Adding one — from any menu, by typing, or by drag — adds the sender to the contact group of the same name, making it if new. Comma-separated paths."`.

Check the keys against the extension's copy:
```bash
cd /Users/mdbraber/src/fastmail-app && python3 - <<'PY'
import re, json
swift = open('Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift').read()
keys = sorted(re.findall(r'Option\(\s*"(\w+)"', swift))
js = open('/Users/mdbraber/src/fastmail-custom/safari-extension/settings.js').read()
block = re.search(r'const DEFAULT_SETTINGS = \{(.*?)\n\};', js, re.S).group(1)
jskeys = sorted(re.findall(r'^\s*(\w+):', block, re.M))
print('keys match' if keys == jskeys else f'MISMATCH\n{keys}\n{jskeys}')
PY
```
Expected: `keys match`.

- [ ] **Step 4: Regenerate the plists and run everything**

```bash
cd /Users/mdbraber/src/fastmail-app && python3 tools/gen-settings-bundle.py && make test 2>&1 | grep -E "Test run with|Executed .* tests|TEST (SUCCEEDED|FAILED)|error:" | tail -6
```
Expected: `wrote Apps/Personal/Settings.bundle/Root.plist`, `wrote Apps/Work/Settings.bundle/Root.plist`, `21 options from CustomModeSettings.swift`, all package tests pass, `TEST SUCCEEDED`. If `settingsBundleCarriesEveryCustomModeOption` fails, the generator was not run after the catalog change.

- [ ] **Step 5: Build both platforms**

```bash
cd /Users/mdbraber/src/fastmail-app && make build-macos 2>&1 | grep -E "BUILD (SUCCEEDED|FAILED)" && make build-ios 2>&1 | grep -E "BUILD (SUCCEEDED|FAILED)"
```
Expected: four `BUILD SUCCEEDED`. The builds copy the userscript from `fastmail-custom`, so they carry v3.0.

- [ ] **Step 6: Commit**

```bash
cd /Users/mdbraber/src/fastmail-app && git add -A && git commit -m "feat: the native settings follow the one-label model (userscript v3.0)"
```

Deploying (`make deploy`) is the user's call: it replaces the running apps and needs the devices unlocked.

---

## Self-review

**Spec coverage.**
- Model, invariants, pre-filed state → Task 1 (vocabulary), Task 2 (rule 2), Task 3 (`v` keeps), Task 10 (header).
- Labels: Triage by name, projects by sidebar-and-not-excluded, helpers → Task 1.
- Verbs table: `v` → Task 3; `Shift-V` → Task 3; `e` → Task 4; `s` → Task 3; `w` → Task 5; `l` narrowing → Task 3 step 5; drag/Option-drag → Task 6.
- Enforced at the action level, rules 1–3, re-entry guard → Task 4 (rule 1), Task 2 (rules 2–3).
- The picker stays; its authority moves → Task 3.
- `w` mechanics and the timezone shift → Task 5.
- Inbox groups: user setup, script never writes splits → no code; noted in Task 10's header.
- The phone: Labels, File, More with Snooze 2 weeks; archive at action level → Task 7; Task 4 keeps `patchArchive` at the action level.
- Sidebar and counts; app badge; colours; indicator → Task 8.
- What goes: marker, qualifiers, Waiting/Someday, non-inbox, `Shift-E`, snooze patch, picker authority → Tasks 3, 4, 5, 10. Filter system retired behind `LABEL_FILTERS` with `RETIRED_SETTINGS` → Task 9.
- Settings table, three catalogs → Tasks 10, 11, 12.
- Compatibility (`?filter=` ignored, stored filter left, orphans tolerated) → Task 9 step 5 verifies; Task 6 verifies the deliberate orphan.
- Verification: probe → Task 0; `node --check` → every task; `make test` → Task 12.
- Setup steps (Triage label, rule, grouping, delete Waiting, `Later` in `contactGroupLabels`) are the user's; not in code.

**Placeholders.** None: every step carries its code or its command.

**Names used across tasks.** `isTriage`, `isProject`, `isHelper`, `projectsAmong`, `triageAmong`, `unfiledAmong`, `triageMailbox` (Task 1) — used in Tasks 2, 3, 4, 8, 10. `patchLabelActions`, `replacedBy`, `applyingLabelRules` (Task 2). `runKeep(actions, keys)`, `runUrgent(actions, keys)`, `runVerb(kind, storeKeys)`, `openProjectPicker(keys)` (Task 3) — used in Task 7. `runDone(actions, keys, finish)` (Task 4). `openSnoozeDialog`, `snoozePeriodLabel`, `parseSnoozePeriod`, `parseSnoozeTime`, `snoozeTarget`, `asPickerDate` (Task 5) — used in Task 7. `LABEL_FILTERS` (Task 1) — used in Tasks 8, 9. `RETIRED_SETTINGS`, `retiredStateLabels` (Task 9) — used in Task 10. Settings keys are identical across Tasks 1, 10, 11, 12.

---

## Folded in: two shell-app changes

Both live in `~/src/fastmail-app`. They are independent of Tasks 1–12 and of each other, and each is its own commit there.

### Task 13: Compose in a new window opens the minimal composer

**Files:**
- Modify: `/Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit/Sources/FastmailShellKit/ComposePool.swift` — `ComposeURL.url(for:)`
- Test: `/Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit/Tests/FastmailShellKitTests/ComposePoolTests.swift`, `LinkRouterTests.swift`

**Interfaces:**
- Consumes: `profile.backend.host`, `profile.accountID`.
- Produces: `ComposeURL.url(for:)` → `https://<host>/mail/Inbox/compose?u=<id>&ui=minimal` (no `u=` when the account is unknown). `LinkRouter.composeBase(for:)` — the `mailto:` route into the main window — is unchanged.

- [ ] **Step 1: Change the tests**

In `ComposePoolTests.swift`, replace the two expectations in `theComposeURLCarriesTheAccountOnlyWhenKnown` with:

```swift
    #expect(ComposeURL.url(for: with).absoluteString == "https://app.fastmail.com/mail/Inbox/compose?u=f00dcafe&ui=minimal")
    #expect(ComposeURL.url(for: without).absoluteString == "https://app.fastmail.com/mail/Inbox/compose?ui=minimal")
```

In `LinkRouterTests.swift`, in `composeIsBuiltOnTheProfilesBackend`, change the two `ComposeURL` prefixes from `/mail/compose` to `/mail/Inbox/compose`, and add:

```swift
    #expect(ComposeURL.url(for: onBeta).query?.contains("ui=minimal") == true)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit && swift test --filter "theComposeURL|composeIsBuilt" 2>&1 | grep -E "passed|failed" | tail -3`
Expected: both fail on the URL.

- [ ] **Step 3: Build the URL from components**

Replace `ComposeURL.url(for:)` with:

```swift
    // The compose window is its own window, so it gets Fastmail's minimal
    // chrome: no sidebar, no list, just the message — ui=minimal. Built
    // from components rather than pasted, so the account and the flag are
    // encoded the same way whichever is present.
    public static func url(for profile: Profile) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = profile.backend.host
        components.path = "/mail/Inbox/compose"
        var items: [URLQueryItem] = []
        if let accountID = profile.accountID {
            items.append(URLQueryItem(name: "u", value: accountID))
        }
        items.append(URLQueryItem(name: "ui", value: "minimal"))
        components.queryItems = items
        return components.url!
    }
```

- [ ] **Step 4: Run the whole package suite**

Run: `cd /Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit && swift test 2>&1 | grep -E "Test run with" | tail -1`
Expected: all tests pass (the count is whatever it was plus one).

- [ ] **Step 5: See it**

Run: `cd /Users/mdbraber/src/fastmail-app && make build-macos 2>&1 | grep -E "BUILD (SUCCEEDED|FAILED)"` then open the built `mdbraber.com.app` from DerivedData and press the compose shortcut. Expected: the new window shows only the composer, no sidebar or list.

- [ ] **Step 6: Commit**

```bash
cd /Users/mdbraber/src/fastmail-app && git add -A && git commit -m "feat: a new compose window opens the minimal composer"
```

---

### Task 14: Fastmail's own notifications on macOS

The service worker decides and formats every notification and hands it to the page when it believes it is inside Fastmail's Electron app: the page checks `typeof electron == "object"`, the worker checks the user agent for `Electron/`. The shell provides both, and Fastmail does the rest — including dismissing a notification when its message is read, and opening the message on click.

**Files:**
- Modify: `/Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js` — the `window.electron` shim, after the `window.native` block
- Create: `/Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit/Sources/FastmailShellKit/MailNotification.swift`
- Create: `/Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationPresenter.swift` (macOS only)
- Modify: `NativeBridge.swift` — three new actions; `WebContainer.swift` — the user-agent token and the wiring; `AppShell.swift` — install the presenter on macOS
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/MailNotificationTests.swift` (create), `NativeBridgeTests.swift`

**Interfaces:**
- Consumes: the harness's `post(action, payload)`; the bridge's `handle(body:)` switch; `WebViewRegistry.shared.active`; `IntentSupport.text(from:)` is not needed.
- Produces:
  - `MailNotification(id:title:body:sound:threadId:dataJSON:)`, `MailNotification.parse(_ payload: [String: Any]) -> MailNotification?`
  - Bridge actions `notify` (payload: `id, title, body, sound, threadId, data`), `dismissNotifications` (payload: `ids: [String]`), `showWindow` (no payload); closures `onNotify: @MainActor (MailNotification) -> Void`, `onDismissNotifications: @MainActor ([String]) -> Void`, `onShowWindow: @MainActor () -> Void`.
  - `NotificationPresenter.shared` (macOS): `install()`, `show(_:)`, `dismiss(ids:)`, `showWindow()`, `onClick: @MainActor (String) -> Void` (receives the notification's `data` JSON), and the pure rule `NotificationPresenter.shouldPresent(appActive:) -> Bool`.
  - On the page: `window.native.notificationClicked(dataJSON)`.
  - The macOS user agent ends in `Electron/0.0.0 FastmailShell`.

- [ ] **Step 1: The model and its tests**

Create `MailNotificationTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

@Test func aNotificationParsesFromTheBridgePayload() throws {
    let payload: [String: Any] = [
        "id": "M1", "title": "Ada", "body": "Re: engine", "sound": true,
        "threadId": "T1", "data": "{\"emailId\":\"M1\"}"
    ]
    let notification = try #require(MailNotification.parse(payload))
    #expect(notification.id == "M1")
    #expect(notification.title == "Ada")
    #expect(notification.body == "Re: engine")
    #expect(notification.sound == true)
    #expect(notification.threadId == "T1")
    #expect(notification.dataJSON == "{\"emailId\":\"M1\"}")
}

@Test func aNotificationWithoutAnIdOrTitleIsRefused() {
    #expect(MailNotification.parse(["title": "x"]) == nil)
    #expect(MailNotification.parse(["id": "x"]) == nil)
    #expect(MailNotification.parse(["id": "", "title": "x"]) == nil)
}

@Test func missingOptionalFieldsHaveSafeDefaults() throws {
    let notification = try #require(MailNotification.parse(["id": "M2", "title": "Bob"]))
    #expect(notification.body == "")
    #expect(notification.sound == false)
    #expect(notification.threadId == nil)
    #expect(notification.dataJSON == "{}")
}
```

Run: `cd /Users/mdbraber/src/fastmail-app/Packages/FastmailShellKit && swift test --filter MailNotification 2>&1 | grep -E "error|passed|failed" | head -3`
Expected: a compile error — `MailNotification` does not exist.

Create `MailNotification.swift`:

```swift
import Foundation

/// One notification as Fastmail's page hands it over — the service worker
/// already decided it should exist and wrote its words. `dataJSON` is the
/// worker's own click payload, kept verbatim so a click can hand it straight
/// back.
public struct MailNotification: Equatable, Sendable {
    public let id: String
    public let title: String
    public let body: String
    public let sound: Bool
    public let threadId: String?
    public let dataJSON: String

    public init(id: String, title: String, body: String, sound: Bool, threadId: String?, dataJSON: String) {
        self.id = id
        self.title = title
        self.body = body
        self.sound = sound
        self.threadId = threadId
        self.dataJSON = dataJSON
    }

    public static func parse(_ payload: [String: Any]) -> MailNotification? {
        guard
            let id = payload["id"] as? String, !id.isEmpty,
            let title = payload["title"] as? String, !title.isEmpty
        else { return nil }
        let threadId = (payload["threadId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return MailNotification(
            id: id,
            title: title,
            body: payload["body"] as? String ?? "",
            sound: payload["sound"] as? Bool ?? false,
            threadId: threadId,
            dataJSON: payload["data"] as? String ?? "{}"
        )
    }
}
```

Run the filter again. Expected: 3 tests pass.

- [ ] **Step 2: The bridge actions, test first**

Append to `NativeBridgeTests.swift`:

```swift
@Test @MainActor func notifyRoutesAParsedNotification() async {
    var received: MailNotification?
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onNotify: { received = $0 }
    )
    let reply = await bridge.handle(body: ["action": "notify", "payload": [
        "id": "M1", "title": "Ada", "body": "hi", "sound": true, "data": "{}"
    ]])
    #expect(reply.error == nil)
    #expect(received?.id == "M1")
    #expect(received?.sound == true)
}

@Test @MainActor func notifyWithoutATitleIsAnError() async {
    let bridge = NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["action": "notify", "payload": ["id": "M1"]])
    #expect(reply.error != nil)
}

@Test @MainActor func dismissAndShowWindowRoute() async {
    var dismissed: [String] = []
    var shown = 0
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onDismissNotifications: { dismissed = $0 },
        onShowWindow: { shown += 1 }
    )
    _ = await bridge.handle(body: ["action": "dismissNotifications", "payload": ["ids": ["a", "b", 3]]])
    _ = await bridge.handle(body: ["action": "showWindow", "payload": [:]])
    #expect(dismissed == ["a", "b"])
    #expect(shown == 1)
}
```

Run: `swift test --filter "notifyRoutes|notifyWithout|dismissAndShow" 2>&1 | grep -E "error|passed|failed" | head -3`
Expected: compile errors — no such initializer parameters.

In `NativeBridge.swift`, add three stored closures after `onOpenSettings`:

```swift
    private let onNotify: @MainActor (MailNotification) -> Void
    private let onDismissNotifications: @MainActor ([String]) -> Void
    private let onShowWindow: @MainActor () -> Void
```

Add three parameters at the end of `init`, with defaults, and assign them:

```swift
        onOpenSettings: @escaping @MainActor () -> Void = {},
        onNotify: @escaping @MainActor (MailNotification) -> Void = { _ in },
        onDismissNotifications: @escaping @MainActor ([String]) -> Void = { _ in },
        onShowWindow: @escaping @MainActor () -> Void = {}
    ) {
        …
        self.onOpenSettings = onOpenSettings
        self.onNotify = onNotify
        self.onDismissNotifications = onDismissNotifications
        self.onShowWindow = onShowWindow
    }
```

In `handle(body:from:)`, before `default:`, add:

```swift
        case "notify":
            guard let notification = MailNotification.parse(payload) else {
                return BridgeReply(value: nil, error: "notify payload needs an id and a title")
            }
            onNotify(notification)
            return BridgeReply(value: nil, error: nil)
        case "dismissNotifications":
            let ids = (payload["ids"] as? [Any] ?? []).compactMap { $0 as? String }
            onDismissNotifications(ids)
            return BridgeReply(value: nil, error: nil)
        case "showWindow":
            onShowWindow()
            return BridgeReply(value: nil, error: nil)
```

Run the filter again. Expected: 3 pass.

- [ ] **Step 3: The presenter (macOS), with its one pure rule tested**

Append to `MailNotificationTests.swift`:

```swift
#if os(macOS)
@Test func aNotificationIsNotShownWhileTheAppIsFrontmost() {
    #expect(NotificationPresenter.shouldPresent(appActive: true) == false)
    #expect(NotificationPresenter.shouldPresent(appActive: false) == true)
}
#endif
```

Create `NotificationPresenter.swift`:

```swift
#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import UserNotifications

/// Shows the notifications Fastmail's own page hands over, and routes a
/// click back to it. Fastmail decides what to notify and writes the words;
/// this only presents them, the way its desktop app would.
@MainActor
public final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    public static let shared = NotificationPresenter()

    /// Given the notification's own click payload, verbatim, so the page can
    /// hand it to the service worker that wrote it.
    public var onClick: @MainActor (String) -> Void = { _ in }

    private var authorizationRequested = false
    private var authorizationDenied = false
    private var waiting: [MailNotification] = []

    private override init() {
        super.init()
    }

    public func install() {
        UNUserNotificationCenter.current().delegate = self
    }

    // While the app is frontmost the page is on screen and the message
    // arrives in it; a banner on top would say what you are looking at.
    nonisolated public static func shouldPresent(appActive: Bool) -> Bool {
        !appActive
    }

    public func show(_ notification: MailNotification) {
        if authorizationDenied { return }
        guard authorizationRequested else {
            authorizationRequested = true
            waiting.append(notification)
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) {
                [weak self] granted, _ in
                Task { @MainActor in
                    guard let self else { return }
                    let queued = self.waiting
                    self.waiting = []
                    if granted {
                        queued.forEach(self.deliver)
                    } else {
                        self.authorizationDenied = true
                    }
                }
            }
            return
        }
        deliver(notification)
    }

    private func deliver(_ notification: MailNotification) {
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.body = notification.body
        if notification.sound { content.sound = .default }
        if let threadId = notification.threadId { content.threadIdentifier = threadId }
        content.userInfo = ["data": notification.dataJSON]

        let request = UNNotificationRequest(identifier: notification.id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error { print("[notifications] \(error.localizedDescription)") }
        }
    }

    public func dismiss(ids: [String]) {
        guard !ids.isEmpty else { return }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
    }

    public func showWindow() {
        NSApp.activate(ignoringOtherApps: true)
        (NSApp.keyWindow ?? NSApp.windows.first { $0.isVisible })?.makeKeyAndOrderFront(nil)
    }

    // MARK: UNUserNotificationCenterDelegate

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        Task { @MainActor in
            let active = NSApp.isActive
            completionHandler(Self.shouldPresent(appActive: active) ? [.banner, .sound] : [])
        }
    }

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let data = response.notification.request.content.userInfo["data"] as? String ?? "{}"
        Task { @MainActor in
            self.showWindow()
            self.onClick(data)
            completionHandler()
        }
    }
}
#endif
```

Run: `swift test --filter "MailNotification|NotificationPresenter|aNotificationIsNotShown" 2>&1 | grep -E "error|passed|failed" | head -5`
Expected: all pass.

- [ ] **Step 4: Wire it into the web view, and add the user-agent token**

In `WebContainer.swift`, `makeWebView`, directly after `configuration.websiteDataStore = .default()` add:

```swift
        #if os(macOS)
        // Fastmail's service worker hands notifications to the page instead
        // of showing them itself when it sees Electron/ in the user agent —
        // the mark of Fastmail's own desktop app — and the page then calls
        // window.electron.showNotification, which the harness provides. The
        // token is what makes the worker take that branch; WKWebView cannot
        // receive push, so it is the only branch that can ever notify.
        configuration.applicationNameForUserAgent = "Electron/0.0.0 FastmailShell"
        #endif
```

In the `NativeBridge(` construction, after `onOpenSettings: { SettingsPresenter.shared.open() }` add:

```swift
            ,
            onNotify: { notification in
                #if os(macOS)
                NotificationPresenter.shared.show(notification)
                #endif
            },
            onDismissNotifications: { ids in
                #if os(macOS)
                NotificationPresenter.shared.dismiss(ids: ids)
                #endif
            },
            onShowWindow: {
                #if os(macOS)
                NotificationPresenter.shared.showWindow()
                #endif
            }
```

In `AppShell.swift`, inside the macOS `.onAppear { … }` that configures `ComposeWindows`, add:

```swift
            NotificationPresenter.shared.install()
            NotificationPresenter.shared.onClick = { data in
                // Hand the click to the page's service worker, which wrote the
                // payload and knows how to open the message
                guard let view = WebViewRegistry.shared.active else { return }
                let literal = String(data: try! JSONEncoder().encode(data), encoding: .utf8) ?? "\"{}\""
                view.callAsyncJavaScript(
                    "window.native && window.native.notificationClicked && window.native.notificationClicked(\(literal));",
                    arguments: [:], in: nil, in: .page, completionHandler: nil
                )
            }
```

- [ ] **Step 5: The page-side object**

In `harness.js`, directly after the line `window.native.addMenuItem({ id: 'share', … });` block ends (before `var SETTINGS_ICON`), add:

```javascript
    // Fastmail's desktop-app hook. Its service worker decides and formats
    // every notification — fed by the page's own live connection, so no
    // push is needed — and, when it believes it is inside Fastmail's
    // Electron app, hands it to the page, which calls
    // window.electron.showNotification. The page decides "inside Electron"
    // by `typeof electron == "object"`; the worker by "Electron/" in the
    // user agent, which the macOS shell adds. Being that object is how the
    // shell gets Fastmail's own notifications, preferences and all. Only
    // where the token is present, so the phone is untouched.
    //
    // Everything Fastmail's bundles call on the object unguarded is here;
    // showContextMenu and printToPDF are checked for before use and are
    // left undefined on purpose, so Fastmail keeps its own context menu.
    if (/Electron\//.test(navigator.userAgent) && typeof window.electron !== 'object') {
        var pendingNotification = null;

        // A sound, if wanted, is asked for right after the notification and
        // synchronously, so the send waits a tick and the two travel as one
        var flushNotification = function () {
            var notification = pendingNotification;
            pendingNotification = null;
            if (notification) post('notify', notification);
        };

        window.electron = {
            showNotification: function (payload, data) {
                payload = payload || {};
                data = data || {};
                pendingNotification = {
                    id: String(data.emailId || data.calendarEventId || Date.now()),
                    title: String(payload.title || ''),
                    body: String(payload.body || ''),
                    sound: false,
                    threadId: String(data.threadId || ''),
                    data: JSON.stringify(data)
                };
                setTimeout(flushNotification, 0);
            },
            playNotificationSound: function () {
                if (pendingNotification) pendingNotification.sound = true;
            },
            // Read, archived or deleted: Fastmail says which notifications
            // are stale. Its badge is an unread count and is not the
            // shell's, which shows Triage; it is ignored here.
            updateNotifications: function (options) {
                var ids = (options && options.dismissEmailIds) || [];
                if (ids.length) post('dismissNotifications', { ids: ids.map(String) });
            },
            showWindow: function () {
                post('showWindow', {});
            },
            setTitleBarOverlay: function () {},
            featuresSupported: {},
            checkForUpdate: function () { return Promise.resolve(); }
        };

        // A click, back to the worker that wrote the notification: it
        // opens the message, the same way it does for its own clicks
        window.native.notificationClicked = function (dataJSON) {
            var worker = navigator.serviceWorker && navigator.serviceWorker.controller;
            if (!worker) return;
            var data;
            try { data = JSON.parse(dataJSON); } catch (error) { return; }
            worker.postMessage({ type: 'notificationclick', data: data });
        };
    }
```

- [ ] **Step 6: Build, run, and see a notification**

```bash
cd /Users/mdbraber/src/fastmail-app && make test 2>&1 | grep -E "Test run with|TEST (SUCCEEDED|FAILED)|error:" | tail -3 && make build-macos 2>&1 | grep -E "BUILD (SUCCEEDED|FAILED)"
```
Expected: tests pass, both builds succeed.

Open the built `mdbraber.com.app` (from `xcodebuild -showBuildSettings`'s `BUILT_PRODUCTS_DIR`, or `make install-macos` then `/Applications/mdbraber.com.app`). On first new mail, macOS asks whether the app may send notifications: allow. Then:

1. From another device or account, send yourself a message. Switch to another app so the shell is not frontmost. Expected: a macOS notification with the sender and subject, in Fastmail's wording, with the system sound if Fastmail's notification sound preference is on.
2. Click it. Expected: the app comes to the front and the message opens.
3. Send another; this time stay in the app. Expected: no banner (the page shows it).
4. Send another, switch away, then read the message on the phone. Expected: the banner disappears on its own (Fastmail's `updateNotifications` dismisses it).
5. Check nothing else changed: right-click a message — Fastmail's own context menu; the profile menu may now carry a "Check for updates" entry, which does nothing; everything else as before.

Verify the token from the terminal (the app must be running):
```bash
osascript -e 'tell application "mdbraber.com" to do JavaScript "return navigator.userAgent + \" | \" + typeof window.electron + \" | \" + FastMail.isElectron" in window 1'
```
Expected: the user agent ends in `Electron/0.0.0 FastmailShell`, then `object`, then `true`.

- [ ] **Step 7: Commit**

```bash
cd /Users/mdbraber/src/fastmail-app && git add -A && git commit -m "feat: Fastmail's own notifications on macOS, through its desktop-app hook"
```

---

## Self-review (addendum)

**Coverage of the two additions.** Compose URL → Task 13, with the mailto route deliberately untouched. Notifications → Task 14: token (worker branch), `window.electron` (page branch), presentation, suppression while frontmost, click → worker → message, dismissal on read, iOS untouched by construction (no token, so no object).

**Names.** `MailNotification.parse`, the three bridge actions and closures, `NotificationPresenter.shared.install/show/dismiss/showWindow/onClick/shouldPresent`, `window.native.notificationClicked` — each defined in the step that first uses it.
