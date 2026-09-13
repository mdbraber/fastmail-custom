# Custom mode settings page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Custom mode's settings become a real page in Fastmail's Settings, at `/settings/custommode`, built from Fastmail's own page, pane, section and switch classes, replacing the dialog.

**Architecture:**
- **The page.** The userscript builds a `PageView` holding one `SettingsPaneView`, with one section per settings group in the markup Fastmail's own pages use.
- **Registration.** When Fastmail's Settings controller is available, the userscript registers the page with it and adds a sidebar entry through the controller's sources list.
- **Addresses.** It wraps two controller methods so the page has a title and its own address works.
- **Fallback.** If anything it relies on is missing, it falls back to the copied sidebar row and the plain fallback panel.
- **Removal.** The dialog is deleted last.

**Tech Stack:**
- The userscript, `Userscript/fastmail-custom-mode.user.js`: plain JavaScript on Fastmail's Overture view classes.
- Live probes through AppleScript `do JavaScript` in the macOS app.
- `make test`, which runs Swift, Xcode integration and server tests plus `node --check`.

**Spec:** `docs/superpowers/specs/2026-09-13-settings-page-design.md`. The parts of `docs/superpowers/specs/2026-09-12-settings-in-the-page-design.md` it does not supersede still stand.

## Global Constraints

**The page and its entry**
- Custom mode is a page registered with Fastmail's Settings controller under the id `custommode`. Its sidebar entry is named "Custom mode" and sits directly after the `actions` entry. It is not a dialog.
- Each of the seven groups is a section headed by its title only. No section gets a description, so there is no new copy.
- Values, keys, titles, hints and defaults do not change. Neither does how a value is written: always through `writeSetting`.
- Toggles are Fastmail's `ToggleView`, and text options are `TextInputView`.
- Sections use exactly this markup: `div.u-p-6.u-space-y-5#s-custommode-<group id>` > `div.u-flex.u-flex-wrap.u-mx-n6.u-my-n4` > [`div.u-mx-6.u-my-4.u-space-y-5.u-flex-1` > `h1.u-flex-auto.u-font-bold.u-text-2xl.u-trim.u-break-words.u-containSelection`] + [`div.u-mx-6.u-my-4.u-flex-major.u-space-y-8` > options].
- Never put Fastmail's `u-flex-1` on anything that is not a flex item: the class also sets `width: 0`.

**Fallback and `openSettings`**
- If any check fails, nothing is registered, nothing is wrapped and the sidebar's entries are not touched.
- The fallback is the copied "Custom mode" row opening the plain fallback panel. The copied row is inserted only after the checks have run and failed, and never while the real entry is present.
- `window.customMode.openSettings()` returns `true` once it has asked to go to the page, or has opened the fallback panel. It returns `false` only if neither was possible. The Safari popup closes only on `true`.

**Live probes**
- Never write Fastmail data: no mailbox `splits` or `sort`, and no messages.
- Probes register only the throwaway id `custommodeprobe`, stand in for `writeSetting` so no real setting is written, and remove the page, the entry and every wrapped method in the same run. They leave the app on mail.

**Order and workflow**
- Order is load-bearing: the page is built (Task 1), then made reachable (Task 2), then the dialog is removed (Task 3). A working way into the settings exists at every commit.
- Other sessions commit to this repository. Stage only the files a task names, never with `git add -A` or `git commit -a`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
  ```
- `make test` must pass at the end of every task. An integration-test crash inside AppKit's `NSWindowStackController` ("expected no items") is a known intermittent fault: re-run once and say so.
- Do not run any `make install-*` or `make deploy` without the user's go-ahead given at that time.

## Verified facts

These were measured in the running macOS app on 2026-09-13, including a throwaway page registered, opened and removed again. Build on them rather than re-deriving them.

**The Settings controller**
- `FastMail.router.getAppController('settings')` returns `router._appControllers.settings || null`. `FastMail.router.addObserverForKey` exists, and `router.get('app')` names the current app, for example `'mail'`.
- On that controller:
  - `register(id, builder)` stores the builder.
  - `go(id)` opens a registered page, calling `builder(viewState, controller, parent)`.
  - The address becomes `/settings/<id>`.
  - Clicking the page's entry opens it.
- `makeViewInstance` and `restoreEncodedState` are own properties of the controller instance, so they can be replaced and put back.
  - With `makeViewInstance` wrapped to set `made.title`, the stack entry's title and `document.title` both become that title.
  - With `restoreEncodedState` wrapped to call `this.go(id)` for its own path, `FastMail.router.restoreEncodedState('settings/<id>')` lands on the page.

**The sidebar**
- `controller.get('sources')` has `setOptions()`, a `search` property, and `sourceGroups`: a plain array of `{ title, content, options }`.
- Entries are Overture objects made by the same constructor, with `id`, `name` and `icon`. `filterOptions` calls `entry.get('name')` while the user searches Settings, so an entry must be built with that constructor (`new existingEntry.constructor({ id, name, icon })`), never as a plain object.
- `setOptions()` hands the list the group's `content` array itself. Splicing that array in place and calling `setOptions()` draws nothing. Assigning a new array to `group.content` and then calling `setOptions()` draws the new row, and the list's inline height grows to match.

**The page and its controls**
- `new PageView({ title, url, isTitleFromH1s: true, isImmortal: false, header: null, content: [pane] })` renders inside the Settings split, with the pane `.v-SettingsPane` at 804px wide on a 1280px window.
  - `SettingsPaneView` accepts `draw()` and `willLeaveDocument()` in its constructor. Its `destroy` calls `discardChanges`, which does nothing without a `recordToEdit`.
  - `willLeaveDocument` runs once when the page is left.
- `ToggleView`:
  - takes `label`, `description` and `value`;
  - draws `label.v-Toggle` with `div.v-Toggle-text > p.u-trim.u-font-semibold` for the label;
  - puts `is-checked`, `is-unchecked` or `is-disabled` in its class;
  - sets `value` through `userDidInput`.
- `TextInputView`'s default type is already `v-TextInput--standard`.
- `FastMail.el('div.a.b#some-id', children)` sets both the classes and the id. Views placed in `children` inside a view's `draw` render in place.

**The existing setup**
- The installed Mac app runs the userscript at `df4c6d9`. Its copied "Custom mode" row sits between Custom swipes and Offline in the Preferences group, so probes must allow for that row.
- The catalogue blocks contain only literals and can be sliced out on their own:
  - `const DEFAULT_SETTINGS = {` … `    };`
  - `const SETTING_GROUPS = [` … `    ];`
  - `const SETTINGS = [` … `    ];`

## File map

- **Modify:** `Userscript/fastmail-custom-mode.user.js`, in every task.
- **Modify:** `SafariExtension/settings.js`, in Task 2.
- **Modify:** `SafariExtension/README.md` and `SafariExtension/early.js`, in Task 3 (comments and documentation only).
- **Modify:** `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`, in Task 3 (one comment only).
- **Scratch, never committed:** probe generators and probes in the session scratchpad, `/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad/`, called `$SCRATCH` below.

## Running a probe

Every probe is generated from the userscript as it is on disk, then run in the macOS app:

```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
python3 "$SCRATCH/gen-page-probe.py" "$SCRATCH/page-probe.js"
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/page-probe.js\" as «class utf8»)"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return location.pathname + \" | probe links: \" + document.querySelectorAll(\"a[href*=custommodeprobe]\").length"'
```

The script run by `do JavaScript` is a function body: it may `await` and must `return`. The last command must print `/mail/Inbox/ | probe links: 0` (or whichever mailbox the app was on) after every probe run.

---

### Task 1: The page

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`
  - `panelClasses` (around line 6283)
  - the comment above `SUB_OPTION_INDENT` and `settingRow` (around lines 6333-6395)
  - the new page block, inserted directly after `settingRegister`'s closing `    };` (around line 6447) and before `    // Wide enough for a hint to read as a sentence`
  - `editGrouping` (around line 6724)
- Scratch: `$SCRATCH/gen-page-probe.py`

**Interfaces:**
- Consumes: `SETTING_GROUPS`, `SETTINGS`, `settingsInGroup(groupId)`, `sectionRow(classes, option, register)`, `settingRegister()` returning `{ add, hold, reset, trackFlush, flushPending, parentChanged, settle }`, and `reportFault(what, error)`.
- Produces:
  - `SETTINGS_PAGE_ID`, the string `'custommode'`
  - `SETTINGS_PAGE_TITLE`, the string `'Custom mode'`
  - `pageClasses()`, returning an object of classes or `null`
  - `settingsSection(group, rows)`, returning an element
  - `settingsPane(classes)`, returning a `SettingsPaneView`
  - `settingsPage(classes)`, returning a `PageView`
  - `settingRow`, which now draws a `ToggleView` for a boolean option

- [ ] **Step 1: Write the probe generator (the failing test)**

Create `$SCRATCH/gen-page-probe.py`:

```python
#!/usr/bin/env python3
"""Draw the userscript's settings page, as it is on disk, into Fastmail's
Settings under a throwaway id, measure it, and take it away again.

Everything the page calls that is not part of Task 1 is a stand-in:
writeSetting records instead of writing, the two list sections are
placeholders, and settingValue reads the installed app's own settings."""
import pathlib
import sys

REPO = pathlib.Path("/Users/mdbraber/src/fastmail-custom")
OUT = pathlib.Path(sys.argv[1])
src = (REPO / "Userscript/fastmail-custom-mode.user.js").read_text(encoding="utf-8")


def need(marker):
    if marker not in src:
        sys.exit(f"FAIL: marker not found in the userscript: {marker!r}")
    return src.index(marker)


def block(start, end_line):
    at = need(start)
    stop = src.index("\n" + end_line + "\n", at) + len(end_line) + 1
    return src[at:stop]


def between(start, end):
    at = need(start)
    if end not in src[at:]:
        sys.exit(f"FAIL: end marker not found after {start!r}: {end!r}")
    return src[at:src.index(end, at)]


catalogue = "\n".join([
    block("    const DEFAULT_SETTINGS = {", "    };"),
    block("    const SETTING_GROUPS = [", "    ];"),
    block("    const SETTINGS = [", "    ];"),
])
rows = between("    const SETTING_WRITE_DELAY = ", "    /*\n     * A sub-option only means")
register = between("    const settingRegister = () => {", "    const SETTINGS_PAGE_ID = ")
page = between("    const pageClasses = () => {", "    /*\n     * A list you can put in order.")

head = r"""
const SETTINGS_PAGE_ID = 'custommodeprobe';
const SETTINGS_PAGE_TITLE = 'Custom mode probe';
const SUB_OPTION_DIMMED = 'custom-mode-dimmed';
const writes = [];
const faults = [];
const writeSetting = (key, value) => { writes.push([key, value]); };
const reportFault = (what) => { faults.push(String(what)); };
"""

after_catalogue = r"""
const settingsInGroup = (group) => SETTINGS.filter(one => one.group === group);
const settingValue = (key) => {
    const current = window.customMode.settings();
    return Object.prototype.hasOwnProperty.call(current, key) ? current[key] : DEFAULT_SETTINGS[key];
};
const sectionRow = (classes, option, register) =>
    option.key === 'groupings' || option.key === 'bottomBarSlots'
        ? new classes.View({ className: 'custom-probe-list', draw: () => [FastMail.el('p', [option.title])] })
        : settingRow(classes, option, register);
"""

body = r"""
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const router = FastMail.router;
const result = { start: location.pathname };
router.goApp('settings');
await wait(1500);
const controller = router.getAppController('settings');
const classes = pageClasses();
result.classesFound = !!classes;
const SECTION = 'u-p-6 u-space-y-5';
const ROW = 'u-flex u-flex-wrap u-mx-n6 u-my-n4';
const LEFT = 'u-mx-6 u-my-4 u-space-y-5 u-flex-1';
const RIGHT = 'u-mx-6 u-my-4 u-flex-major u-space-y-8';
const H1 = 'u-flex-auto u-font-bold u-text-2xl u-trim u-break-words u-containSelection';
try {
    controller.register(SETTINGS_PAGE_ID, () => settingsPage(classes));
    controller.go(SETTINGS_PAGE_ID);
    await wait(1500);

    const pane = document.querySelector('.v-SettingsPane');
    const sections = pane ? Array.from(pane.children).filter(n => (n.id || '').indexOf('s-' + SETTINGS_PAGE_ID + '-') === 0) : [];
    result.sectionIds = sections.map(n => n.id);
    result.expectedSectionIds = SETTING_GROUPS.map(g => 's-' + SETTINGS_PAGE_ID + '-' + g.id);
    result.headings = sections.map(n => (n.querySelector('h1') || {}).textContent);
    result.expectedHeadings = SETTING_GROUPS.map(g => g.title);
    result.markupMatches = sections.length === SETTING_GROUPS.length && sections.every((n) => {
        const row = n.firstElementChild;
        const left = row && row.children[0];
        const right = row && row.children[1];
        const h1 = left && left.firstElementChild;
        return n.className === SECTION && row.className === ROW && left.className === LEFT &&
            right.className === RIGHT && h1.tagName === 'H1' && h1.className === H1;
    });

    const toggleOptions = SETTING_GROUPS.flatMap(g => settingsInGroup(g.id))
        .filter(o => o.key !== 'groupings' && o.key !== 'bottomBarSlots' && typeof settingValue(o.key) === 'boolean');
    const toggles = pane ? Array.from(pane.querySelectorAll('label.v-Toggle')) : [];
    const titleOfToggle = t => (t.querySelector('.v-Toggle-text p') || {}).textContent;
    result.toggleTitlesMatch = JSON.stringify(toggles.map(titleOfToggle)) === JSON.stringify(toggleOptions.map(o => o.title));
    result.toggleValuesMatch = toggles.length === toggleOptions.length &&
        toggles.every((t, i) => t.classList.contains('is-checked') === !!settingValue(toggleOptions[i].key));
    result.noCollapsedToggle = toggles.every(t => t.getBoundingClientRect().width > 150);
    result.checkboxesLeft = pane ? pane.querySelectorAll('.v-Checkbox').length : -1;

    const child = SETTINGS.find(o => o.parent && typeof settingValue(o.parent) === 'boolean' && settingValue(o.parent) === true);
    if (child) {
        const parentOption = SETTINGS.find(o => o.key === child.parent);
        const section = document.getElementById('s-' + SETTINGS_PAGE_ID + '-' + child.group);
        const toggleFor = title => Array.from(section.querySelectorAll('label.v-Toggle')).find(t => titleOfToggle(t) === title);
        const parentToggle = toggleFor(parentOption.title);
        const childToggle = toggleFor(child.title);
        const holder = childToggle.parentElement;
        result.subOption = { key: child.key, indented: holder.classList.contains('u-pl-6') };
        parentToggle.click();
        await wait(400);
        result.subOption.afterParentOff = {
            lastWrite: writes[writes.length - 1],
            childDisabled: childToggle.classList.contains('is-disabled'),
            childDimmed: holder.classList.contains(SUB_OPTION_DIMMED)
        };
        parentToggle.click();
        await wait(400);
        result.subOption.afterParentOn = {
            lastWrite: writes[writes.length - 1],
            childDisabled: childToggle.classList.contains('is-disabled'),
            childDimmed: holder.classList.contains(SUB_OPTION_DIMMED)
        };
    }

    const narrowSection = sections[1];
    pane.style.maxWidth = '360px';
    await wait(400);
    const heading = narrowSection.querySelector('h1').getBoundingClientRect();
    const options = narrowSection.querySelector('.u-flex-major').getBoundingClientRect();
    result.narrow = { headingBottom: Math.round(heading.bottom), optionsTop: Math.round(options.top), optionsWidth: Math.round(options.width) };
    pane.style.removeProperty('max-width');
    await wait(300);

    const input = pane.querySelector('input.v-TextInput-input');
    const writesBefore = writes.length;
    input.value = 'probe-typed';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(100);
    result.writesWhileTyping = writes.length - writesBefore;
    controller.go('theme');
    await wait(1200);
    result.flushedOnLeaving = writes.slice(writesBefore).filter(w => w[1] === 'probe-typed').length;
    result.faults = faults;
} catch (error) {
    result.threw = String(error) + ' ' + String(error && error.stack).slice(0, 500);
} finally {
    try { controller.go('theme'); } catch (error) {}
    await wait(900);
    try { delete controller._registeredViews[SETTINGS_PAGE_ID]; } catch (error) {}
    try { router.goApp('mail'); } catch (error) {}
    await wait(1200);
    result.cleanup = { stillRegistered: !!controller._registeredViews[SETTINGS_PAGE_ID], end: location.pathname };
}
return JSON.stringify(result, null, 1);
"""

OUT.write_text("\n".join([head, catalogue, after_catalogue, rows, register, page, body]), encoding="utf-8")
print(f"wrote {OUT}")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 "$SCRATCH/gen-page-probe.py" "$SCRATCH/page-probe.js"`

Expected: `FAIL: marker not found in the userscript: '    const SETTINGS_PAGE_ID = '` and exit status 1. The page block does not exist yet.

- [ ] **Step 3: Switch `settingRow` to Fastmail's switch**

In `settingRow`, replace:

```js
            const box = new classes.CheckboxView({
```

with:

```js
            const box = new classes.ToggleView({
```

In the comment block above `SUB_OPTION_INDENT`, replace these three lines:

```js
     * One option, drawn. A toggle is a checkbox carrying its hint as the
     * description Fastmail already draws under a label; a text option is a
     * field with the hint beneath it, and the multi-line one gets a textarea.
```

with:

```js
     * One option, drawn. A toggle is Fastmail's switch, the control its own
     * settings pages use, carrying its hint as the description it already
     * draws under the label; a text option is a field with the hint beneath
     * it, and the multi-line one gets a textarea.
```

Leave the rest of the comment as it is.

In `panelClasses`, replace `'CheckboxView'` with `'ToggleView'` in the `wanted` array, so the dialog keeps working until Task 3 removes it:

```js
        const wanted = ['ModalOverlayView', 'ScrollView', 'View', 'ToggleView', 'TextInputView', 'ButtonView'];
```

- [ ] **Step 4: Give the groupings editor its own check for its dialog's classes**

In `editGrouping`, replace:

```js
        const Editor = FastMail.classes && FastMail.classes.GroupSettingsView;
        if (typeof Editor !== 'function') {
```

with:

```js
        // Its dialog needs its own two classes; the page that holds the
        // Edit button does not, so they are checked here rather than there.
        const Editor = FastMail.classes && FastMail.classes.GroupSettingsView;
        if (typeof Editor !== 'function' || !classes.ModalOverlayView || !classes.ScrollView) {
```

- [ ] **Step 5: Add the page block**

Insert directly after the closing `    };` of `settingRegister` and before `    // Wide enough for a hint to read as a sentence`:

```js

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
        return el('div.u-p-6.u-space-y-5#s-' + SETTINGS_PAGE_ID + '-' + group.id, [
            el('div.u-flex.u-flex-wrap.u-mx-n6.u-my-n4', [
                el('div.u-mx-6.u-my-4.u-space-y-5.u-flex-1', [
                    el('h1.u-flex-auto.u-font-bold.u-text-2xl.u-trim.u-break-words.u-containSelection', [group.title])
                ]),
                el('div.u-mx-6.u-my-4.u-flex-major.u-space-y-8', rows)
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
            // Leaving the page is when a closing dialog used to flush: what a
            // field still has waiting is written now, on the key and value it
            // captured, before the page's views are thrown away.
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
```

- [ ] **Step 6: Run the probe to verify it passes**

Run the three commands from "Running a probe".

Expected, in the probe's JSON output:
- `classesFound: true`
- `sectionIds` deep-equals `expectedSectionIds`, and `headings` deep-equals `expectedHeadings` (General, Appearance, Labels & keeping, Groups, Snooze, Keyboard, Action bar)
- `markupMatches`, `toggleTitlesMatch`, `toggleValuesMatch` and `noCollapsedToggle` are all `true`, and `checkboxesLeft: 0`
- `subOption.indented: true`
  - `afterParentOff.lastWrite` is `[<parent key>, false]`, with `childDisabled: true` and `childDimmed: true`
  - `afterParentOn.lastWrite` is `[<parent key>, true]`, with `childDisabled: false` and `childDimmed: false`
- `narrow.optionsTop >= narrow.headingBottom` and `narrow.optionsWidth > 200`
- `writesWhileTyping: 0` and `flushedOnLeaving: 1`
- `faults: []`, no `threw`, and `cleanup.stillRegistered: false`

The last command prints the mailbox path and `probe links: 0`.

If the text-field part reports `flushedOnLeaving: 0`, check whether `TextInputView` updates its value on the `input` event before changing the page code. If it listens for something else, change only the probe's event.

- [ ] **Step 7: Run the whole suite**

Run: `make test`

Expected: exit 0 and `** TEST SUCCEEDED **`, with the Swift package line reading `Test run with 300 tests … passed`. `node --check` on the userscript passes.

- [ ] **Step 8: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js
git commit -F - <<'EOF'
feat: the settings page is built from Fastmail's own page and switches

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 2: Reaching the page

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`
  - a new block inserted directly after `settingsPage` (end of Task 1's block) and before `    // Wide enough for a hint to read as a sentence`
  - `dressSettingsList` (around line 7300)
  - `start()` (around line 7383)
  - the `window.customMode` export (around line 7418)
- Modify: `SafariExtension/settings.js`
- Scratch: `$SCRATCH/gen-reach-probe.py`

**Interfaces:**
- Consumes (Task 1): `SETTINGS_PAGE_ID`, `SETTINGS_PAGE_TITLE`, `pageClasses()` and `settingsPage(classes)`.
- Consumes (existing): `filterGlyph(existing)`, `SVG_NS`, `openFallbackSettings()`, `reportFault(what, error)`, `settingsSourceList()`, `fixListHeight(list, sample)` and `SETTINGS_ROW_CLASS`.
- Produces:
  - state: `settingsPageState`, one of `'waiting'`, `'installed'` or `'unavailable'`
  - `settingsContract(controller)`, returning `{ sources, group }` or `null`
  - `ensureSettingsEntry({ sources, group })`
  - `installSettingsPage(controller, classes, found)`
  - `ensureSettingsPage()`
  - `watchSettingsApp()`
  - `openSettings()`, returning a boolean; exported as `window.customMode.openSettings`

- [ ] **Step 1: Write the probe generator (the failing test)**

Create `$SCRATCH/gen-reach-probe.py`:

```python
#!/usr/bin/env python3
"""Install the userscript's settings page, as it is on disk, into Fastmail's
live Settings under a throwaway id; check the sidebar entry, search, the
click, the address, openSettings and the fallback decisions; then remove the
page, the entry and both wrapped methods and go back to mail."""
import pathlib
import sys

REPO = pathlib.Path("/Users/mdbraber/src/fastmail-custom")
OUT = pathlib.Path(sys.argv[1])
src = (REPO / "Userscript/fastmail-custom-mode.user.js").read_text(encoding="utf-8")


def need(marker):
    if marker not in src:
        sys.exit(f"FAIL: marker not found in the userscript: {marker!r}")
    return src.index(marker)


def block(start, end_line):
    at = need(start)
    stop = src.index("\n" + end_line + "\n", at) + len(end_line) + 1
    return src[at:stop]


def between(start, end):
    at = need(start)
    if end not in src[at:]:
        sys.exit(f"FAIL: end marker not found after {start!r}: {end!r}")
    return src[at:src.index(end, at)]


catalogue = "\n".join([
    block("    const DEFAULT_SETTINGS = {", "    };"),
    block("    const SETTING_GROUPS = [", "    ];"),
    block("    const SETTINGS = [", "    ];"),
])
glyph = between("    const FILTER_ICON_CLASS = ", "    // The Triage row wears the funnel too")
rows = between("    const SETTING_WRITE_DELAY = ", "    /*\n     * A sub-option only means")
register = between("    const settingRegister = () => {", "    const SETTINGS_PAGE_ID = ")
page = between("    const pageClasses = () => {", "    /*\n     * Reaching the page.")
page_classes_only = between("    const pageClasses = () => {", "    const settingsSection = ")
reach = between("    const settingsContract = ", "    /*\n     * A list you can put in order.")

head = r"""
const SETTINGS_PAGE_ID = 'custommodeprobe';
const SETTINGS_PAGE_TITLE = 'Custom mode probe';
const SUB_OPTION_DIMMED = 'custom-mode-dimmed';
const SVG_NS = 'http://www.w3.org/2000/svg';
const writes = [];
const faults = [];
let fallbackOpened = 0;
const writeSetting = (key, value) => { writes.push([key, value]); };
const reportFault = (what) => { faults.push(String(what)); };
const openFallbackSettings = () => { fallbackOpened += 1; };
let settingsPageState = 'waiting';
let openPageWhenInstalled = false;
const installedControllers = new WeakSet();
"""

after_catalogue = r"""
const settingsInGroup = (group) => SETTINGS.filter(one => one.group === group);
const settingValue = (key) => {
    const current = window.customMode.settings();
    return Object.prototype.hasOwnProperty.call(current, key) ? current[key] : DEFAULT_SETTINGS[key];
};
const sectionRow = (classes, option, register) =>
    option.key === 'groupings' || option.key === 'bottomBarSlots'
        ? new classes.View({ className: 'custom-probe-list', draw: () => [FastMail.el('p', [option.title])] })
        : settingRow(classes, option, register);
"""

hidden_class_check = r"""
const pageClassesWithoutToggle = (() => {
    const FastMail = Object.create(window.FastMail, {
        classes: { value: Object.assign({}, window.FastMail.classes, { ToggleView: undefined }) }
    });
""" + page_classes_only + r"""
    return pageClasses();
})();
"""

body = r"""
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const router = FastMail.router;
const result = { start: location.pathname };
router.goApp('settings');
await wait(1500);
const controller = router.getAppController('settings');
const sources = controller.get('sources');
const groupOfActions = sources.get('sourceGroups').find(g => (g.content || []).some(c => c && c.id === 'actions'));
const originalContent = groupOfActions.content;
const hadOwnMake = Object.prototype.hasOwnProperty.call(controller, 'makeViewInstance');
const hadOwnRestore = Object.prototype.hasOwnProperty.call(controller, 'restoreEncodedState');
const originalMake = controller.makeViewInstance;
const originalRestore = controller.restoreEncodedState;
const rowTexts = () => {
    const link = document.querySelector('a[href*="/settings/actions"]');
    const ul = link && link.closest('ul');
    return ul ? Array.from(ul.children).map(li => li.textContent.trim()) : [];
};
try {
    result.contractOnLive = !!settingsContract(controller);
    result.contractOnEmpty = settingsContract({});
    result.contractWithoutActions = settingsContract({
        register() {}, makeViewInstance() {}, restoreEncodedState() {}, go() {},
        get: () => ({ setOptions() {}, get: () => [{ title: 'x', content: [] }] })
    });
    result.pageClassesWithoutToggle = pageClassesWithoutToggle;

    ensureSettingsPage();
    await wait(900);
    result.stateAfterInstall = settingsPageState;
    const links = document.querySelectorAll('a[href*="/settings/' + SETTINGS_PAGE_ID + '"]');
    const texts = rowTexts();
    result.entry = {
        count: links.length,
        indexAfterSwipes: texts.indexOf(SETTINGS_PAGE_TITLE) > texts.indexOf('Custom swipes'),
        indexBeforeOffline: texts.indexOf(SETTINGS_PAGE_TITLE) < texts.indexOf('Offline'),
        funnel: !!(links[0] && links[0].querySelector('svg.custom-filterIcon')),
        rows: texts
    };

    ensureSettingsPage();
    sources.setOptions();
    await wait(600);
    result.countAfterSecondEnsure = document.querySelectorAll('a[href*="/settings/' + SETTINGS_PAGE_ID + '"]').length;
    result.contentCount = groupOfActions.content.filter(c => c && c.id === SETTINGS_PAGE_ID).length;

    try {
        sources.set('search', 'probe');
        sources.setOptions();
        await wait(500);
        result.searchIds = (groupOfActions.options.get('[]') || []).map(o => o.get('id'));
    } catch (error) {
        result.searchThrew = String(error);
    } finally {
        sources.set('search', '');
        sources.setOptions();
        await wait(500);
    }

    const link = document.querySelector('a[href*="/settings/' + SETTINGS_PAGE_ID + '"]');
    link.click();
    await wait(1500);
    result.afterClick = {
        path: location.pathname,
        stackTitle: (controller.get('viewStack').last() || {}).title,
        documentTitle: document.title,
        sections: document.querySelectorAll('.v-SettingsPane > [id^="s-' + SETTINGS_PAGE_ID + '-"]').length
    };

    router.restoreEncodedState('settings/theme');
    await wait(1200);
    result.openSettingsReturned = openSettings();
    await wait(1500);
    result.afterOpenSettings = { path: location.pathname, viewId: controller.get('viewId') };

    router.restoreEncodedState('settings/theme');
    await wait(1200);
    router.restoreEncodedState('settings/' + SETTINGS_PAGE_ID + '#s-' + SETTINGS_PAGE_ID + '-snooze');
    await wait(1500);
    result.afterAnchor = { viewId: controller.get('viewId'), anchor: ((controller.get('viewStack').last() || {}).viewState || {}).anchor };

    router.restoreEncodedState('settings/theme');
    await wait(1200);
    settingsPageState = 'unavailable';
    result.fallbackReturned = openSettings();
    result.fallbackOpened = fallbackOpened;
    result.viewIdWhileUnavailable = controller.get('viewId');
    settingsPageState = 'installed';
    result.faults = faults;
} catch (error) {
    result.threw = String(error) + ' ' + String(error && error.stack).slice(0, 500);
} finally {
    try { router.restoreEncodedState('settings/theme'); } catch (error) {}
    await wait(900);
    try { groupOfActions.content = originalContent; sources.setOptions(); } catch (error) {}
    try { delete controller._registeredViews[SETTINGS_PAGE_ID]; } catch (error) {}
    try { if (hadOwnMake) controller.makeViewInstance = originalMake; else delete controller.makeViewInstance; } catch (error) {}
    try { if (hadOwnRestore) controller.restoreEncodedState = originalRestore; else delete controller.restoreEncodedState; } catch (error) {}
    await wait(600);
    result.cleanup = {
        entriesLeft: document.querySelectorAll('a[href*="/settings/' + SETTINGS_PAGE_ID + '"]').length,
        stillRegistered: !!controller._registeredViews[SETTINGS_PAGE_ID],
        makeRestored: controller.makeViewInstance === originalMake,
        restoreRestored: controller.restoreEncodedState === originalRestore,
        contentRestored: groupOfActions.content === originalContent
    };
    try { router.goApp('mail'); } catch (error) {}
    await wait(1200);
    result.cleanup.end = location.pathname;
}
return JSON.stringify(result, null, 1);
"""

OUT.write_text("\n".join([head, catalogue, after_catalogue, glyph, rows, register, page,
                          hidden_class_check, reach, body]), encoding="utf-8")
print(f"wrote {OUT}")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 "$SCRATCH/gen-reach-probe.py" "$SCRATCH/reach-probe.js"`

Expected: `FAIL: marker not found in the userscript: '    const settingsContract = '` and exit status 1.

- [ ] **Step 3: Add the block that reaches the page**

Insert directly after the closing `    });` of `settingsPage` and before `    // Wide enough for a hint to read as a sentence`:

```js

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

        // Fastmail titles a stack entry from its own table of names, which
        // has none for this page.
        const make = controller.makeViewInstance;
        controller.makeViewInstance = function (viewId, viewState, parent) {
            const made = make.call(this, viewId, viewState, parent);
            if (viewId === SETTINGS_PAGE_ID && made) made.title = SETTINGS_PAGE_TITLE;
            return made;
        };

        const restore = controller.restoreEncodedState;
        const ownAddress = new RegExp('^' + SETTINGS_PAGE_ID + '(?:#(.*))?$');
        controller.restoreEncodedState = function (encoded, params) {
            const match = ownAddress.exec(String(encoded == null ? '' : encoded));
            if (!match) return restore.call(this, encoded, params);
            this.go(SETTINGS_PAGE_ID, match[1] ? { anchor: match[1], nonce: Math.random() } : null);
            return this;
        };

        ensureSettingsEntry(found);
    };

    const ensureSettingsPage = () => {
        if (settingsPageState === 'unavailable') return;
        const classes = pageClasses();
        if (!classes) {
            settingsPageState = 'unavailable';
            return;
        }
        const router = FastMail.router;
        const controller = router && typeof router.getAppController === 'function'
            ? router.getAppController('settings') : null;
        if (!controller) return;

        const found = settingsContract(controller);
        if (!found) {
            if (!installedControllers.has(controller)) settingsPageState = 'unavailable';
            return;
        }

        if (installedControllers.has(controller)) {
            // Fastmail may rebuild its groups; the entry goes back if so.
            ensureSettingsEntry(found);
        } else {
            try {
                installSettingsPage(controller, classes, found);
            } catch (error) {
                settingsPageState = 'unavailable';
                reportFault('the Custom mode settings page could not be added; using the plain panel', error);
                return;
            }
            installedControllers.add(controller);
            settingsPageState = 'installed';
        }

        if (openPageWhenInstalled) {
            openPageWhenInstalled = false;
            controller.go(SETTINGS_PAGE_ID);
        }
    };

    const watchSettingsApp = () => {
        const router = FastMail.router;
        if (router && typeof router.addObserverForKey === 'function') {
            router.addObserverForKey('app', { check: () => ensureSettingsPage() }, 'check');
        }
        ensureSettingsPage();
    };

    const openSettings = () => {
        ensureSettingsPage();
        try {
            const router = FastMail.router;
            if (settingsPageState !== 'unavailable' && router &&
                typeof router.restoreEncodedState === 'function') {
                if (settingsPageState === 'waiting') openPageWhenInstalled = true;
                router.restoreEncodedState('settings/' + SETTINGS_PAGE_ID);
                return true;
            }
        } catch (error) {
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
```

- [ ] **Step 4: Insert the copied row only when the page is unavailable**

Replace the whole `dressSettingsList` function with:

```js
    const dressSettingsList = () => {
        ensureSettingsPage();
        const found = settingsSourceList();
        if (!found) return;
        const { list, swipes, offline } = found;
        const copied = list.querySelector('.' + SETTINGS_ROW_CLASS);

        // The list is on screen, so Settings has loaded; a controller that is
        // still not there to install into is as good as missing.
        if (settingsPageState === 'waiting') settingsPageState = 'unavailable';

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
```

- [ ] **Step 5: Start watching, and export `openSettings`**

In `start()`, replace:

```js
        watchSettingsList();
```

with:

```js
        watchSettingsApp();
        watchSettingsList();
```

In the `window.customMode` object, replace:

```js
            openSettings: openSettingsPanel,
```

with:

```js
            openSettings,
```

- [ ] **Step 6: The Safari popup reads what `openSettings` returns**

In `SafariExtension/settings.js`, replace:

```js
    // The injected function reports whether it actually reached the payload's
    // export, so the popup only closes once the panel has really opened;
    // closing on a guard it never got past would make the click look ignored.
```

with:

```js
    // The injected function reports whether the payload's export went to the
    // settings page or opened the plain panel, so the popup only closes once
    // one of them has; closing on a guard it never got past would make the
    // click look ignored.
```

and replace:

```js
            if (window.customMode && window.customMode.openSettings) {
                window.customMode.openSettings();
                return true;
            }
```

with:

```js
            if (window.customMode && window.customMode.openSettings) {
                return window.customMode.openSettings() !== false;
            }
```

- [ ] **Step 7: Run the probe to verify it passes**

Run:
```bash
python3 "$SCRATCH/gen-reach-probe.py" "$SCRATCH/reach-probe.js"
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/reach-probe.js\" as «class utf8»)"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return location.pathname + \" | probe links: \" + document.querySelectorAll(\"a[href*=custommodeprobe]\").length"'
```

Expected, in the probe's JSON output:
- **Checks:** `contractOnLive: true`, `contractOnEmpty: null`, `contractWithoutActions: null` and `pageClassesWithoutToggle: null`.
- **Install and entry:** `stateAfterInstall: "installed"`. `entry.count` is `1`, and `entry.indexAfterSwipes`, `entry.indexBeforeOffline` and `entry.funnel` are all `true`.
- **Idempotence:** `countAfterSecondEnsure: 1` and `contentCount: 1`.
- **Search:** `searchIds` deep-equals `["custommodeprobe"]`, and there is no `searchThrew`.
- **Click:** `afterClick.path` is `/settings/custommodeprobe`, `afterClick.stackTitle` is `"Custom mode probe"`, `afterClick.documentTitle` contains `"Custom mode probe"`, and `afterClick.sections` is `7`.
- **`openSettings`:** `openSettingsReturned: true`, and `afterOpenSettings.viewId` is `"custommodeprobe"`.
- **Anchor:** `afterAnchor.viewId` is `"custommodeprobe"`, and `afterAnchor.anchor` is `"s-custommodeprobe-snooze"`.
- **Fallback:** `fallbackReturned: true` and `fallbackOpened: 1`, with `viewIdWhileUnavailable` still `"theme"`.
- **Clean run:** `faults: []` and no `threw`.
- **Cleanup:** `entriesLeft` is `0`, `stillRegistered` is `false`, and `makeRestored`, `restoreRestored` and `contentRestored` are all `true`.

The last command prints the mailbox path and `probe links: 0`.

- [ ] **Step 8: Check the copied-row and start-up wiring by reading the diff**

Run: `git diff -U3 -- Userscript/fastmail-custom-mode.user.js | grep -n -E "watchSettingsApp|openSettingsPanel|openFallbackSettings|settingsPageState"`

Expected:
- `watchSettingsApp();` appears in `start()` before `watchSettingsList();`.
- The copied row's click handler calls `openFallbackSettings()`.
- `openSettings: openSettingsPanel` is gone.
- `dressSettingsList` reads `settingsPageState` before inserting anything.

`openSettingsPanel` itself still exists until Task 3.

- [ ] **Step 9: Run the whole suite**

Run: `make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 300 package tests, and `node --check` passing for the userscript and every `SafariExtension/*.js`.

- [ ] **Step 10: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js SafariExtension/settings.js
git commit -F - <<'EOF'
feat: Custom mode is a page in Fastmail's Settings, with its own entry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 3: The dialog goes

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`
- Modify: `SafariExtension/README.md`
- Modify: `SafariExtension/early.js` (comments only)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js` (one comment only)

**Interfaces:**
- Consumes (Task 2): `openSettings`, and `settingsPageState` as the only route to the settings.
- Produces: nothing new. It removes `panelClasses`, `PANEL_WIDTH`, `PANEL_STACKS_BELOW`, `openPanel`, `settingsPanelView`, `titleOf`, `closeSettingsPanel` and `openSettingsPanel`.

- [ ] **Step 1: Write the check (the failing test)**

Run:
```bash
grep -n -E "openSettingsPanel|closeSettingsPanel|settingsPanelView|panelClasses|PANEL_WIDTH|PANEL_STACKS_BELOW|openPanel|titleOf|CheckboxView" Userscript/fastmail-custom-mode.user.js
```

Expected now: several matches, so the check fails.

- [ ] **Step 2: Delete the dialog code**

In `Userscript/fastmail-custom-mode.user.js`, delete each of these entirely. Where a short comment describes only that one declaration, delete the comment too: the two lines above `PANEL_WIDTH`, and the two lines above `openPanel`. Keep the block comment headed ` * The settings panel` above `panelClasses`, because Step 3 rewrites it.
- `const panelClasses = () => { … };`
- `const PANEL_WIDTH = 620;` and `const PANEL_STACKS_BELOW = 700;`
- `let openPanel = null;`
- `const settingsPanelView = (classes, register) => { … };`
- `const titleOf = (groupId) => …;`
- `const closeSettingsPanel = () => { … };`
- `const openSettingsPanel = () => { … };`

Keep:
- `framedModal`, `editGrouping` and `openFallbackSettings`
- everything Tasks 1 and 2 added

- [ ] **Step 3: Rewrite the comments that describe the dialog**

List them with:

```bash
grep -n -i -E "settings panel|the panel|a panel|panel is|panel's|open panel|closing|modal on screen" Userscript/fastmail-custom-mode.user.js
```

For each match, first decide what it refers to:
- **The page:** the comment describes the Custom mode settings as drawn in Fastmail's Settings. Say "settings page" or "the page" instead of "settings panel" or "the panel", and say "leaving the page" instead of "closing".
- **The plain fallback:** the comment is about `openFallbackSettings`, `FALLBACK_ID` or `FALLBACK_PANEL_RULES`. Leave it as it is.

Rewrite these known cases as follows:
- The block comment headed ` * The settings panel` (above where `panelClasses` was). It becomes ` * The settings page`, describing a page registered with Fastmail's Settings, built from Fastmail's own classes, with the plain panel as the fallback when a class or controller method is missing.
- The `FALLBACK_PANEL_RULES` comment says "the panel can be opened with the mode off (openSettingsPanel does not check it)". It becomes "the plain panel can be opened with the mode off (openFallbackSettings does not check it)".
- The `SUB_OPTION_DIMMED` comment says "A sub-option in the settings panel … Fastmail's own disabled checkbox greys only its box". It becomes "A sub-option on the settings page … Fastmail's own disabled switch greys only its control".
- The `settingRegister` comment says "Switching groups throws the old rows away" and "for the life of the open panel". These become "A redraw throws the old rows away" and "for the life of the page".
- The `debouncedWrite` comment says "flush() runs when the panel is closing". It becomes "flush() runs when the page is being left".

- [ ] **Step 4: Rewrite the dialog wording outside the userscript**

- **`SafariExtension/README.md` line 46.** Replace `The toolbar popup; opens the settings panel drawn in the Fastmail page` with `The toolbar popup; opens Custom mode's page in Fastmail's Settings`.
- **`SafariExtension/README.md` around line 138.** Replace `open the settings panel from the toolbar` with `open Custom mode's settings page from the toolbar`, keeping the rest of the sentence.
- **`SafariExtension/early.js` around lines 24 and 93.** Replace `the settings panel` with `the settings page` in both comments.
- **`harness.js` line 776.** Replace `A Custom mode setting the page's own settings panel has changed.` with `A Custom mode setting the settings page has changed.`

- [ ] **Step 5: Run the checks to verify they pass**

Run:
```bash
grep -n -E "openSettingsPanel|closeSettingsPanel|settingsPanelView|panelClasses|PANEL_WIDTH|PANEL_STACKS_BELOW|openPanel|titleOf|CheckboxView" Userscript/fastmail-custom-mode.user.js
grep -n -i "settings panel" Userscript/fastmail-custom-mode.user.js SafariExtension/README.md SafariExtension/early.js SafariExtension/settings.js Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js
node --check Userscript/fastmail-custom-mode.user.js
```

Expected:
- The first command prints nothing.
- The second prints nothing, or only lines about the plain fallback panel. Quote any such line in the report.
- `node --check` passes.

- [ ] **Step 6: Run Task 2's probe again to show nothing it needs was deleted**

Run the three commands from Task 2, Step 7. The generator's slices end at the comment ` * A list you can put in order.`, which this task keeps, so they still find their code.

Expected: the same results as in Task 2, Step 7, with `probe links: 0` at the end.

- [ ] **Step 7: Run the whole suite**

Run: `make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 300 package tests, and `node --check` passing.

- [ ] **Step 8: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js SafariExtension/README.md SafariExtension/early.js Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js
git commit -F - <<'EOF'
refactor: the settings dialog is gone now the page is the way in

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 4: On installed builds

**Files:** none. This task changes nothing; it confirms what Tasks 1-3 built.

**Interfaces:**
- Consumes: everything.
- Produces: a recorded pass, or a list of defects to fix before the work is called done.

- [ ] **Step 1: Ask before installing**

Ask the user for a go-ahead for each of the following, stating what each does:
- `make install-macos` replaces both Mac apps in `/Applications`, so the running mail apps must quit and relaunch.
- `make install-ios DEVICE=68584880-5010-5FD9-B899-FBCB5273FA46` installs to the iPhone. A bare `make install-ios` lands on the iPad.
- `make install-extension` replaces the Safari extension app.

If an install is refused, record that its checks are outstanding and do not report them as passed.

- [ ] **Step 2: Mac**

After `make install-macos`, quit each running app gracefully and relaunch it from `/Applications`. Then, in `mdbraber.com`:
1. Fastmail's Settings sidebar shows "Custom mode" once, with the funnel icon, directly after Custom swipes. No copied row appears.
2. Choosing it opens `/settings/custommode`, highlights the entry and shows seven sections with Fastmail's switches.
3. A sub-option dims with its parent. Change a setting, change it back, and confirm by reading it back.
4. Back and forward move between Custom mode and another Settings page.
5. Reloading on `/settings/custommode` lands on the page.
6. The Groups section's Edit opens Fastmail's groupings editor. Close it with Cancel.

- [ ] **Step 3: iPhone**

After the install, open Fastmail's Settings on the phone:
1. "Custom mode" is listed.
2. It slides in with a back arrow.
3. Headings sit above their options.
4. The page scrolls to the Action bar section.

These need a person. Give the user the list and record their answers.

- [ ] **Step 4: Safari**

After `make install-extension`, the toolbar popup's button opens the page in a Fastmail tab and the popup closes. This needs a person; record the user's answer.

- [ ] **Step 5: Record the result**

Write what passed and what did not into the ledger. Any defect is fixed and re-verified. A passed check is stated plainly, naming the platforms it was run on.

---

## Self-review

**Spec coverage.** Every requirement in the spec maps to a task:

| Spec requirement | Where it is done |
|---|---|
| The container, sections, controls, sub-options, list sections and saving on leave | Task 1 |
| The checks, the four registration steps, the controller arriving late, the load onto the address, the behaviour, `openSettings` and the fallback, including a copied row only when unavailable | Task 2 |
| "What goes" | Task 3 |
| "Stays": `framedModal`, `openFallbackSettings`, the list editors and the export | Named as kept in Task 3, Step 2 |
| Testing in the running app | Tasks 1 and 2 probes |
| Testing on installed builds | Task 4 |
| `make test` | Every task |

One refinement beyond the spec's wording, for the implementer and the reviewer:
- **The spec** says the sidebar entry is `{ id, name, icon }`.
- **This plan** builds it with the constructor of Fastmail's own entries, because searching Settings calls `entry.get('name')`, and a plain object would throw there. The entry's fields are unchanged.
- **Also added:** a load straight onto the page's address is remembered from start-up, because Fastmail may rewrite the address before the controller exists.

**Placeholder scan.**
- Every code step carries the code.
- Task 3's comment rewrites give the exact before-and-after wording for each known case, plus the rule and a command that lists every candidate.

**Type consistency.** These names are spelled the same in every task, in both the userscript code and the probes:
- `SETTINGS_PAGE_ID`, `SETTINGS_PAGE_TITLE`
- `pageClasses()`, `settingsSection(group, rows)`, `settingsPane(classes)`, `settingsPage(classes)`
- `settingsContract(controller)`, `ensureSettingsEntry({ sources, group })`, `installSettingsPage(controller, classes, found)`
- `ensureSettingsPage()`, `watchSettingsApp()`, `openSettings()`
- `settingsPageState`, `openPageWhenInstalled`, `installedControllers`
