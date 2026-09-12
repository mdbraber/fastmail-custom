# Settings in the page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all twenty-six Custom mode options out of three native settings
screens and into one panel drawn inside the Fastmail page from Fastmail's own
view classes.

**Architecture:** The userscript gains a canonical option catalogue and a
settings panel built from `ModalOverlayView`, `CheckboxView` and
`TextInputView`; the groupings editor is Fastmail's own `GroupSettingsView`
driven by a stand-in controller. Values stay in `UserDefaults` and extension
storage, reached through a new write channel per host — a `setting` action on
the native bridge, and a `postMessage` hop to the extension's content script.
Once the panel works on all three hosts, the SwiftUI form, the Settings bundle
rows and the extension's option rows are deleted.

**Tech Stack:** Swift 6 with Swift Testing, SwiftUI, WKWebView, a Safari
Manifest V3 WebExtension, a single-IIFE userscript with no build step, and
Python for the Settings bundle generator.

**Spec:** `docs/superpowers/specs/2026-09-12-settings-in-the-page-design.md`

## Global Constraints

- The userscript's `SETTINGS` array is canonical. No other file may enumerate
  the options — not their keys, not their copy, not their defaults. The one
  exception is Swift's literal `appBadgeLabel` default of `"Triage"`.
- Never write Fastmail's per-mailbox `splits` property from the userscript.
  The groupings editor writes only our own settings.
- The twenty-six keys, their titles, their hints and their defaults are moved
  verbatim from `CustomModeSettings.options`. No copy changes in this work.
- Order is load-bearing: write channels first, then the panel, then the
  deletions. A build that deletes the native screens before the panel works
  has no way to change a setting at all.
- Do not run `make install-macos` or `make install-extension` without the
  user's explicit go-ahead: they delete and replace applications in
  `/Applications` and force the running mail to quit.
- Other sessions commit to this repository. Stage only the files your task
  names.
- The userscript has no test harness. Verify a change by slicing the changed
  section out and evaluating it in the running app over AppleScript with
  local stand-ins, per `docs`/the memory note on probing the Mac app live.
  Put back any patch on a Fastmail class in the same run.
- `make test` must pass at the end of every task.

## Verified facts

These were measured against the running app on 2026-09-12. Build on them
rather than re-deriving them.

- `new FastMail.classes.ModalOverlayView({rootView: FastMail.root, className:
  'u-modal', positioning: 'relative', layout: {width: 620}, view: someView})`
  then `.show()` inserts and displays it; `.hide()` then `.destroy()` removes
  it leaving nothing behind.
- `new FastMail.classes.CheckboxView({label, description, value})` renders an
  `input[type=checkbox]` with the label and the description beneath it.
- `new FastMail.classes.TextInputView({label, placeholder, value})` renders an
  `input[type=text]`; adding `isMultiline: true` renders a `textarea`.
- `view.addObserverForKey('value', target, 'methodName')` fires when the value
  changes. `view.set('isDisabled', true)` disables the rendered input.
- `FastMail.classes.GroupSettingsView.prototype` carries `init`, `save`,
  `cancel`, `addGroup` and `sortCategories`. `init` reads
  `controller.get('sortSource').get('splits')`. `save` calls
  `sortSource.set('splits', value)`, then
  `controller.set('groupBy', …).computedPropertyDidChange('splits')`, then
  `this.cancel()`.
- `FastMail.classes.SplitConditionItemView.prototype` carries `isDraggable`,
  `isTouchDraggable`, `dragStarted`, `dragMoved`, `dragEnded`,
  `draggingLayout`, `minSortOrder` and `sortOrder`.
- `FastMail.el(tag, children)` is the element helper; `FastMail.classes.View`
  is the base view.

## File structure

| File | Responsibility after this work |
| --- | --- |
| `Userscript/fastmail-custom-mode.user.js` | The canonical catalogue, value resolution, the write channel, the panel, both list editors, the fallback panel, the sidebar row |
| `Packages/.../Resources/harness.js` | Adds `window.native.setSetting` |
| `Packages/.../NativeBridge.swift` | Adds the `setting` action and its key guard |
| `Packages/.../CustomModeSettings.swift` | Namespace handling and injection only; no option list |
| `Packages/.../SettingsUI.swift` | The mobile sheet's shell settings only |
| `Apps/Shared/SettingsView.swift` | One General pane, no tabs |
| `Packages/.../WebContainer.swift` | Wires `onSetting` to `UserDefaults` |
| `tools/gen-settings-bundle.py` | Three fixed rows, no catalogue parsing |
| `SafariExtension/early.js` | Adds the storage-write listener and the host marker |
| `SafariExtension/background.js` | Injection and the storage listener only |
| `SafariExtension/settings.html`, `settings.js` | One button |

---

### Task 1: The `setting` action on the native bridge

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift:96-141`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js:599-640`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift`
- Test: `Tests/IntegrationTests/HarnessTests.swift`

**Interfaces:**
- Produces: `CustomModeSettings.keyPrefix: String` (`"customMode."`),
  `CustomModeSettings.defaultsKey(for key: String) -> String`,
  `CustomModeSettings.isWritableSettingKey(_ key: String) -> Bool`.
- Produces: the bridge action `setting` with payload `{key: String, value: Bool | String}`.
- Produces: `window.native.setSetting(key, value)` in the page, returning a promise.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift`:

```swift
// MARK: The setting action

private func settingsDefaults(_ name: String) -> UserDefaults {
    let suite = "NativeBridgeTests.\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

@Test @MainActor func settingActionWritesABooleanAndAString() async {
    let defaults = settingsDefaults(#function)
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetting: { key, value in defaults.set(value, forKey: CustomModeSettings.defaultsKey(for: key)) }
    )
    let first = await bridge.handle(body: [
        "action": "setting", "payload": ["key": "labelColours", "value": false],
    ])
    let second = await bridge.handle(body: [
        "action": "setting", "payload": ["key": "triageLabel", "value": "Todo"],
    ])
    #expect(first.error == nil)
    #expect(second.error == nil)
    #expect(defaults.object(forKey: "customMode.labelColours") as? Bool == false)
    #expect(defaults.string(forKey: "customMode.triageLabel") == "Todo")
}

// The prefix is the whole guard: whatever the page sends lands under
// customMode., a namespace nothing else uses, so a key that happens to spell
// a shell setting writes a Custom mode one and leaves the shell alone.
@Test @MainActor func settingActionCannotReachAShellSetting() async {
    let defaults = settingsDefaults(#function)
    defaults.set("production", forKey: Backend.defaultsKey)
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetting: { key, value in defaults.set(value, forKey: CustomModeSettings.defaultsKey(for: key)) }
    )
    let reply = await bridge.handle(body: [
        "action": "setting", "payload": ["key": "backend", "value": "beta"],
    ])
    #expect(reply.error == nil)
    #expect(defaults.string(forKey: Backend.defaultsKey) == "production")
    #expect(defaults.string(forKey: "customMode.backend") == "beta")
}

// A dot would let a key path out of the namespace, so it is refused before
// anything is written; so is anything else that is not letters and digits.
@Test @MainActor func settingActionRefusesAKeyThatIsNotPlain() async {
    var written: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetting: { key, _ in written.append(key) }
    )
    for key in ["push.alerts", "1st", "has space", "has-hyphen", "", "customMode.triageLabel"] {
        let reply = await bridge.handle(body: [
            "action": "setting", "payload": ["key": key, "value": "x"],
        ])
        #expect(reply.error != nil, "\(key) should be refused")
    }
    #expect(written.isEmpty)
}

// JavaScript's 1 and true both cross the bridge as an NSNumber, and a number
// stored where a flag belongs reads back as true. Only a real boolean counts.
@Test @MainActor func settingActionRefusesAValueThatIsNeitherFlagNorText() async {
    var written: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetting: { key, _ in written.append(key) }
    )
    for value in [1, 0, 2.5, ["a"], [:] as [String: String]] as [Any] {
        let reply = await bridge.handle(body: [
            "action": "setting", "payload": ["key": "labelColours", "value": value],
        ])
        #expect(reply.error != nil)
    }
    let missing = await bridge.handle(body: ["action": "setting", "payload": ["key": "labelColours"]])
    #expect(missing.error != nil)
    #expect(written.isEmpty)
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Packages/FastmailShellKit && swift test --filter settingAction`
Expected: FAIL — `NativeBridge.init` has no `onSetting` parameter, and
`CustomModeSettings.defaultsKey(for:)` does not exist.

- [ ] **Step 3: Add the namespace helpers**

In `CustomModeSettings.swift`, directly above `public static let options`:

```swift
    /// Where every Custom mode setting lives in UserDefaults. Prefixed so the
    /// shell's own keys (backend, startView, push.alerts) and the page's
    /// cannot collide, and so the page can be given the whole namespace
    /// without being given anything else.
    public static let keyPrefix = "customMode."

    public static func defaultsKey(for key: String) -> String { keyPrefix + key }

    /// A key the page is allowed to write. Letters and digits only, starting
    /// with a letter. Swift keeps no list of the options — the userscript's
    /// catalogue is canonical — so the namespace is the guard: a key that
    /// passes this can only ever name something under `customMode.`, and a
    /// dot, which is the only way to climb out of a key path, is not in the
    /// pattern.
    public static func isWritableSettingKey(_ key: String) -> Bool {
        guard let first = key.first, first.isASCII, first.isLetter else { return false }
        return key.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }
```

- [ ] **Step 4: Add the bridge action**

In `NativeBridge.swift`, add the stored property beside `onOpenSettings`:

```swift
    /// A Custom mode setting the page has changed. The key is bare; the
    /// caller adds the namespace.
    private let onSetting: @MainActor (String, Any) -> Void
```

Add the initialiser parameter after `onOpenSettings`:

```swift
        onSetting: @escaping @MainActor (String, Any) -> Void = { _, _ in },
```

and the assignment beside the others:

```swift
        self.onSetting = onSetting
```

Add the case after `case "openSettings":`:

```swift
        case "setting":
            guard
                let key = payload["key"] as? String,
                CustomModeSettings.isWritableSettingKey(key)
            else {
                return BridgeReply(value: nil, error: "setting payload has no usable key")
            }
            // A JavaScript true and a JavaScript 1 both arrive as NSNumber,
            // and `as? Bool` accepts either; a count stored where a flag
            // belongs would then read back as true forever. Ask CoreFoundation
            // which one it really is.
            let value: Any
            if let number = payload["value"] as? NSNumber,
               CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() {
                value = number.boolValue
            } else if let text = payload["value"] as? String {
                value = text
            } else {
                return BridgeReply(value: nil, error: "setting value must be a boolean or a string")
            }
            onSetting(key, value)
            return BridgeReply(value: nil, error: nil)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd Packages/FastmailShellKit && swift test --filter settingAction`
Expected: PASS, four tests.

- [ ] **Step 6: Wire the action to UserDefaults**

In `WebContainer.swift`, in the `NativeBridge(...)` call, after the
`onOpenSettings:` line:

```swift
            onSetting: { key, value in
                UserDefaults.standard.set(value, forKey: CustomModeSettings.defaultsKey(for: key))
                #if canImport(UIKit)
                // The home-screen quick actions are built from the badge
                // label. They are rebuilt when the app comes forward, which
                // was enough while the label was only editable in the iOS
                // Settings app; now that it is editable without leaving the
                // app, they have to be rebuilt here too.
                if key == "appBadgeLabel" { HomeShortcuts.refresh() }
                #endif
            },
```

- [ ] **Step 7: Expose it to the page**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`,
beside the other `window.native` functions:

```javascript
    // A Custom mode setting the page's own settings panel has changed. The
    // key is bare: the shell owns the namespace it is stored under, so the
    // page cannot name anything outside it.
    window.native.setSetting = function (key, value) {
        return post('setting', { key: key, value: value });
    };
```

- [ ] **Step 8: Add the integration test**

Append to `Tests/IntegrationTests/HarnessTests.swift`, following the shape of
the `openSettings` test already there:

```swift
    func testSetSettingReachesTheBridge() async throws {
        _ = try await evaluate(webView, "window.native.setSetting('triageLabel', 'Todo'); true;")
        try await waitUntil { self.received.contains { $0["action"] as? String == "setting" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "setting" })
        let payload = try XCTUnwrap(message["payload"] as? [String: Any])
        XCTAssertEqual(payload["key"] as? String, "triageLabel")
        XCTAssertEqual(payload["value"] as? String, "Todo")
    }
```

- [ ] **Step 9: Run the full suite**

Run: `make test`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift \
        Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift \
        Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift \
        Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js \
        Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift \
        Tests/IntegrationTests/HarnessTests.swift
git commit -m "feat: the page can write a Custom mode setting"
```

---

### Task 2: The write channel in the Safari extension

**Files:**
- Modify: `SafariExtension/early.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `document.documentElement.dataset.customModeHost === 'extension'`,
  set at document start, as the page's signal that this channel exists.
- Produces: a listener for
  `window.postMessage({source: 'custom-mode', kind: 'setting', key, value})`
  that merges the key into `storage.local`'s `settings` object.

There is no test harness for the extension; `make test` only syntax-checks it.
Verification is the live check in Step 4.

- [ ] **Step 1: Add the API handle and the host marker**

At the top of `SafariExtension/early.js`, after the opening comment:

```javascript
const api = globalThis.browser || globalThis.chrome;

// The page world cannot see this content script, and cannot see extension
// storage either; but both see the DOM. Stamping the root element at document
// start is how the settings panel knows there is an extension here to write
// through, before it has drawn anything.
document.documentElement.dataset.customModeHost = 'extension';
```

- [ ] **Step 2: Add the listener**

At the end of `SafariExtension/early.js`:

```javascript
/*
The settings panel runs in the page world, which has no route to extension
storage. It posts to its own window and this carries the value across.

Any script on this origin could post the same message. The origin is
Fastmail's own and none of these settings is security-sensitive, so the check
is that the message came from this window rather than a frame, and that it is
shaped like ours; nothing stronger is claimed.
*/
window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;

    const message = event.data;
    if (!message || message.source !== 'custom-mode' || message.kind !== 'setting') return;
    if (typeof message.key !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(message.key)) return;
    if (typeof message.value !== 'boolean' && typeof message.value !== 'string') return;

    // Read, merge, write: the settings live as one object, so writing a key
    // means rewriting the object, and two panels open at once would otherwise
    // undo each other.
    api.storage.local.get('settings').then((stored) => {
        const settings = Object.assign({}, stored.settings || {});
        settings[message.key] = message.value;
        return api.storage.local.set({ settings });
    }).catch((error) => {
        console.error('Custom mode: could not save a setting', error);
    });
});
```

- [ ] **Step 3: Syntax-check**

Run: `for f in SafariExtension/*.js; do node --check "$f" || exit 1; done`
Expected: no output, exit 0.

- [ ] **Step 4: Verify the channel live**

Ask the user before running `make install-extension`. Once installed, in a
Fastmail tab's console:

```javascript
document.documentElement.dataset.customModeHost;   // 'extension'
window.postMessage({source: 'custom-mode', kind: 'setting', key: 'triageLabel', value: 'Probe'}, location.origin);
```

Then open the extension's popup: the triage label field reads `Probe`. Set it
back to `Triage` before moving on. If the user declines the install, record
that this step is outstanding in the ledger and carry it to the end-to-end
gate in Task 11.

- [ ] **Step 5: Commit**

```bash
git add SafariExtension/early.js
git commit -m "feat: the page can write a setting through the extension"
```

---

### Task 3: The canonical catalogue, value resolution and the write channel

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js` — a new section immediately
  after the `DEFAULT_SETTINGS` literal (currently ending near line 141)

**Interfaces:**
- Consumes: `window.native.setSetting` (Task 1), the
  `data-custom-mode-host` marker and the message shape (Task 2).
- Produces, all inside the IIFE:
  - `SETTING_GROUPS: [{id, title}]` in display order.
  - `SETTINGS: [{key, group, parent, clearable, multiline, title, hint}]`.
  - `settingValue(key)` → the resolved value.
  - `writeSetting(key, value)` → void, picks a channel.
  - `formatGroupings(groupings)` → the settings text for an array shaped as
    `parseGroupings` returns it.

- [ ] **Step 1: Add the catalogue**

Insert after the `DEFAULT_SETTINGS` literal and the `let settings = …` line:

```javascript
    /*
     * ----------------------------------------------------------------
     * The option catalogue
     * ----------------------------------------------------------------
     *
     * Canonical, and the only one. The settings panel is drawn from this, and
     * neither host holds a copy: the apps and the extension handle the
     * customMode. namespace without knowing what is in it, so adding an
     * option means adding one entry here and nothing anywhere else.
     *
     * The default is not repeated: DEFAULT_SETTINGS above already carries all
     * twenty-six, and settingValue reads it from there.
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
```

- [ ] **Step 2: Add value resolution**

Immediately after the catalogue:

```javascript
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
    const settingValue = (key) => {
        const fallback = DEFAULT_SETTINGS[key];
        const stored = settings[key];

        if (typeof fallback === 'boolean') {
            return typeof stored === 'boolean' ? stored : fallback;
        }
        if (typeof stored !== 'string') return fallback;

        const trimmed = stored.trim();
        if (trimmed) return trimmed;

        const option = settingFor(key);
        return option && option.clearable ? '' : fallback;
    };
```

- [ ] **Step 3: Add the write channel**

Immediately after:

```javascript
    /*
     * Where a changed setting goes. The panel runs in the page, which owns
     * none of the three stores, so it hands the value to whichever host is
     * here: the shell apps expose window.native, the extension leaves a mark
     * on the root element and listens for a posted message, and a plain
     * browser tab has neither and keeps its own copy.
     *
     * Each host echoes the change back through applySettings, so the local
     * object is updated here only so that the panel and the mode agree before
     * the round trip lands.
     */
    const LOCAL_SETTINGS_KEY = 'custom-mode-settings';

    const hostIsExtension = () =>
        document.documentElement.dataset.customModeHost === 'extension';

    const writeSetting = (key, value) => {
        settings[key] = value;

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
```

- [ ] **Step 4: Read the local copy at startup**

Replace the existing line

```javascript
    let settings = Object.assign({}, DEFAULT_SETTINGS, window.__customModeSettings || {});
```

with

```javascript
    // A plain browser tab has no host to store settings in, so the panel
    // keeps them here. A tab that does have a host never writes this, so an
    // old copy cannot outrank what the host injected.
    const localSettings = () => {
        try {
            return JSON.parse(localStorage.getItem('custom-mode-settings')) || {};
        } catch (error) {
            return {};
        }
    };

    let settings = Object.assign(
        {},
        DEFAULT_SETTINGS,
        window.__customModeSettings || localSettings()
    );
```

- [ ] **Step 5: Add `formatGroupings`**

In the Groupings section, immediately after `parseGroupings`:

```javascript
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
```

- [ ] **Step 6: Syntax-check**

Run: `node --check Userscript/fastmail-custom-mode.user.js`
Expected: no output, exit 0.

- [ ] **Step 7: Verify the pure functions live**

Slice the catalogue section and the Groupings section out of the file into a
scratch probe, wrap them with stand-ins for `settings`, `DEFAULT_SETTINGS`,
`OTHER_NAME`, `SPLIT_PREFIX` and `reportFault`, and evaluate it in the running
app over AppleScript. Assert, in the probe and reporting each result:

```javascript
// The round trip, on the shipped default and on a block with a leftover name
const text = DEFAULT_SETTINGS.groupings;
const once = formatGroupings(parseGroupings(text));
const twice = formatGroupings(parseGroupings(once));
results.roundTripIsStable = once === twice;
results.roundTripKeepsEveryBucket =
    parseGroupings(once).length === parseGroupings(text).length &&
    parseGroupings(once)[0].categories.length === parseGroupings(text)[0].categories.length;

const named = 'mine\n  A = is:pinned\n  Everything else';
results.leftoverNameSurvives = parseGroupings(formatGroupings(parseGroupings(named)))[0].otherName === 'Everything else';

// Resolution: trimmed, clearable empty, non-clearable empty, unset
settings = { triageLabel: '  Todo  ', excludedLabels: '   ', snoozeTime: '   ' };
results.trimmed = settingValue('triageLabel') === 'Todo';
results.clearableEmptyStaysEmpty = settingValue('excludedLabels') === '';
results.otherEmptyFallsBack = settingValue('snoozeTime') === '08:00';
results.unsetIsTheDefault = settingValue('labelColours') === true;
```

Every result must be `true`. Do not proceed while any is `false`.

- [ ] **Step 8: Run the full suite**

Run: `make test`
Expected: exit 0. The Swift parity test still passes: `DEFAULT_SETTINGS` is
unchanged and the Swift catalogue has not been touched yet.

- [ ] **Step 9: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js
git commit -m "feat: the page carries the option catalogue and can save a setting"
```

---

### Task 4: The settings panel

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js` — a new section before the
  bootstrap, and one line added to the `window.customMode` export

**Interfaces:**
- Consumes: `SETTINGS`, `SETTING_GROUPS`, `settingsInGroup`, `settingFor`,
  `settingValue`, `writeSetting` (Task 3); `reportFault`.
- Produces: `openSettingsPanel()`, and `window.customMode.openSettings()`.
- Produces: `panelClasses()` → an object of the resolved Fastmail classes, or
  `null` when one is missing. Task 6 branches on that `null`.
- Produces: `settingRow(option, onParentChange)` → a view, used by Task 5's
  sections for the rows they do not draw themselves.

- [ ] **Step 1: Add the class resolver**

New section before the bootstrap:

```javascript
    /*
     * ----------------------------------------------------------------
     * The settings panel
     * ----------------------------------------------------------------
     *
     * Every Custom mode option, drawn in the page from Fastmail's own view
     * classes, so one panel serves the Mac app, the phone, the extension and
     * a plain tab. The native screens keep only what has to be reachable when
     * no page will load: the backend, the start page and notifications.
     *
     * These four are the ones a row cannot be drawn without. They are looked
     * up once, together, rather than as each is needed: a panel that fails
     * halfway leaves a modal on screen with nothing in it, and the fallback
     * has to be chosen before anything is drawn.
     */
    const panelClasses = () => {
        const wanted = ['ModalOverlayView', 'View', 'CheckboxView', 'TextInputView', 'ButtonView'];
        const found = {};
        let missing = false;

        wanted.forEach((name) => {
            const Class = FastMail.classes && FastMail.classes[name];
            if (typeof Class !== 'function') missing = true;
            found[name] = Class;
        });

        return missing ? null : found;
    };
```

- [ ] **Step 2: Add the rows**

```javascript
    // Writing on every keystroke would send one message per character, and
    // each one comes back through applySettings and rebuilds the grouped
    // list. Coalesced into one write once typing pauses. The same interval
    // the extension's own settings page used.
    const SETTING_WRITE_DELAY = 450;

    const debouncedWrite = () => {
        let timer = null;
        return (key, value) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { timer = null; writeSetting(key, value); }, SETTING_WRITE_DELAY);
        };
    };

    /*
     * One option, drawn. A toggle is a checkbox carrying its hint as the
     * description Fastmail already draws under a label; a text option is a
     * field with the hint beneath it, and the multi-line one gets a textarea.
     *
     * A clearable field shows "none" rather than its default as the
     * placeholder, because for those an empty box is ambiguous: never
     * touched, or emptied on purpose, and the two mean opposite things.
     */
    const settingRow = (classes, option, register) => {
        const el = FastMail.el;
        const current = settingValue(option.key);

        if (typeof current === 'boolean') {
            const box = new classes.CheckboxView({
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
            return box;
        }

        const write = debouncedWrite();
        const field = new classes.TextInputView({
            label: option.title,
            placeholder: option.clearable ? 'none' : String(DEFAULT_SETTINGS[option.key] || ''),
            value: String(current),
            isMultiline: !!option.multiline,
            isExpanding: !!option.multiline
        });
        field.addObserverForKey('value', {
            changed: () => write(option.key, field.get('value'))
        }, 'changed');
        register.add(option, field);

        return new classes.View({
            className: 'u-space-y-1',
            draw: () => [field, el('p.u-trim.u-text-sm.u-color-unimportant', [option.hint])]
        });
    };
```

- [ ] **Step 3: Add the sub-option register**

```javascript
    /*
     * A sub-option only means anything while the option above it is on, so it
     * follows its parent rather than sitting there looking available. The
     * rows are built one at a time and a parent may be drawn after its child,
     * so each row registers itself and the parent's state is applied to the
     * whole set once, at the end, and again whenever a parent changes.
     */
    const settingRegister = () => {
        const views = {};
        const register = {
            add: (option, view) => { views[option.key] = view; },
            parentChanged: (key, on) => {
                SETTINGS.forEach((option) => {
                    if (option.parent !== key || !views[option.key]) return;
                    views[option.key].set('isDisabled', !on);
                });
            },
            settle: () => {
                SETTINGS.forEach((option) => {
                    if (!option.parent || !views[option.key]) return;
                    views[option.key].set('isDisabled', !settingValue(option.parent));
                });
            }
        };
        return register;
    };
```

- [ ] **Step 4: Add the panel view and its opener**

```javascript
    // Wide enough for a hint to read as a sentence, narrow enough to sit in a
    // laptop window. Below this the two columns become one.
    const PANEL_WIDTH = 620;
    const PANEL_STACKS_BELOW = 700;

    let openPanel = null;

    const settingsPanelView = (classes, register) => {
        const el = FastMail.el;
        const stacked = !!(FastMail.isMobile ||
            (FastMail.root && FastMail.root.get('pxWidth') < PANEL_STACKS_BELOW));

        let chosen = SETTING_GROUPS[0].id;

        const rowsFor = (groupId) => settingsInGroup(groupId)
            .map(option => sectionRow(classes, option, register));

        const body = new classes.View({
            className: 'u-flex-1 u-space-y-4 u-overflow-y-auto',
            draw: () => stacked
                ? SETTING_GROUPS.reduce((out, group) => out.concat(
                    [el('h2.u-trim.u-font-bold', [group.title])], rowsFor(group.id)), [])
                : [el('h2.u-trim.u-font-bold', [titleOf(chosen)])].concat(rowsFor(chosen))
        });

        const choose = (groupId) => {
            chosen = groupId;
            body.viewNeedsRedraw();
        };

        const sidebar = new classes.View({
            className: 'u-flex-none u-space-y-1',
            layout: { width: 170 },
            draw: () => SETTING_GROUPS.map(group => new classes.ButtonView({
                type: 'v-Button--subtle v-Button--sizeM',
                label: group.title,
                target: { go: () => choose(group.id) },
                method: 'go'
            }))
        });

        return new classes.View({
            className: 'u-p-8 u-space-y-5',
            draw: () => [
                el('h1.u-trim.u-text-2xl.u-font-bold', ['Custom mode']),
                stacked
                    ? body
                    : new classes.View({
                        className: 'u-flex u-space-x-5',
                        draw: () => [sidebar, body]
                    }),
                new classes.ButtonView({
                    type: 'v-Button--standard v-Button--sizeM',
                    label: 'Done',
                    target: { close: () => closeSettingsPanel() },
                    method: 'close'
                })
            ]
        });
    };

    const titleOf = (groupId) =>
        (SETTING_GROUPS.filter(group => group.id === groupId)[0] || {}).title || '';

    const closeSettingsPanel = () => {
        if (!openPanel) return;
        const modal = openPanel;
        openPanel = null;
        try {
            modal.hide();
            setTimeout(() => { try { modal.destroy(); } catch (error) { /* already gone */ } }, 400);
        } catch (error) {
            reportFault('the settings panel would not close');
        }
    };

    const openSettingsPanel = () => {
        if (openPanel) return;

        const classes = panelClasses();
        if (!classes) {
            openFallbackSettings();
            return;
        }

        try {
            const register = settingRegister();
            const view = settingsPanelView(classes, register);
            const modal = new classes.ModalOverlayView({
                rootView: FastMail.root,
                className: 'u-modal',
                positioning: 'relative',
                layout: { width: PANEL_WIDTH },
                view: view
            });
            openPanel = modal;
            modal.show();
            register.settle();
        } catch (error) {
            openPanel = null;
            reportFault('the settings panel would not open; showing the plain one');
            openFallbackSettings();
        }
    };
```

Note: `sectionRow` and `openFallbackSettings` are defined in Tasks 5 and 6.
Until then, add these two placeholders directly above `settingsPanelView` so
the file runs, and delete them in the task that supplies the real one:

```javascript
    // Replaced in the task that adds the list editors
    const sectionRow = (classes, option, register) => settingRow(classes, option, register);
    // Replaced in the task that adds the fallback
    const openFallbackSettings = () => reportFault('the settings panel is unavailable');
```

- [ ] **Step 5: Add the sidebar row and the export**

In the same section:

```javascript
    /*
     * Fastmail's own Settings screen is where someone goes looking, so the
     * panel is opened from there. The shells add a "Device settings" row to
     * the same list from harness.js; this one is the userscript's, so it is
     * there in Safari and in a plain tab too.
     *
     * Fastmail redraws that sidebar as sections change, so the row is re-added
     * whenever the DOM settles rather than once.
     */
    const SETTINGS_ROW_CLASS = 'custom-mode-settings-row';

    const dressSettingsList = () => {
        const swipes = document.querySelector('#v-Settings-swipes, .v-Settings-swipes');
        const list = swipes && swipes.closest('ul, .u-list-body');
        if (!list || list.querySelector('.' + SETTINGS_ROW_CLASS)) return;

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
            openSettingsPanel();
        });

        list.insertBefore(clone, swipes.nextSibling);
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
```

Call `watchSettingsList();` in the bootstrap, beside `installAppBadge();`.

Add to the `window.customMode` export object, after `chooseGrouping,`:

```javascript
            openSettings: openSettingsPanel,
```

- [ ] **Step 6: Syntax-check**

Run: `node --check Userscript/fastmail-custom-mode.user.js`
Expected: no output, exit 0.

- [ ] **Step 7: Verify the panel live**

Slice the panel section out, together with the catalogue section from Task 3,
into a scratch probe with stand-ins for `settings`, `DEFAULT_SETTINGS`,
`reportFault` and a `writeSetting` that records into an array rather than
writing anywhere. Evaluate in the running app. In the probe:

1. Call `openSettingsPanel()`, wait 300 ms, and record
   `document.querySelectorAll('.u-modal').length` — must be `1`.
2. Record the count of `input[type=checkbox]`, `input[type=text]` and
   `textarea` inside the modal's layer, and its `textContent`. Every group
   title in `SETTING_GROUPS` must appear when stacked, or the first group's
   title and its rows when not.
3. Toggle a parent checkbox off through `set('value', false)` and confirm its
   sub-options' inputs gain `disabled`.
4. Confirm the recorded writes contain the toggled key and no other.
5. Call `closeSettingsPanel()`, wait 500 ms, and confirm
   `document.querySelectorAll('.u-modal').length` is `0`.

Every assertion must hold. The probe must close the panel in a `finally`
block, so a failure does not leave a modal on the user's screen.

- [ ] **Step 8: Run the full suite**

Run: `make test`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js
git commit -m "feat: a Custom mode settings panel in the page"
```

---

### Task 5: The groupings list and the action bar list

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js` — the panel section

**Interfaces:**
- Consumes: `settingRow`, `panelClasses` (Task 4); `parseGroupings`,
  `formatGroupings`, `OTHER_NAME`, `SPLIT_PREFIX` (Task 3 and the existing
  Groupings section); `orderedSlots`, `SLOT_ACTION_NAMES` (existing).
- Produces: `sectionRow(classes, option, register)`, replacing the Task 4
  placeholder, which returns the grouping list for `groupings`, the verb list
  for `bottomBarSlots`, and `settingRow(...)` for everything else.
- Produces: `reorderList(classes, items, onOrder)` → a view; `items` is
  `[{id, label, edit, remove}]` where `edit` and `remove` are functions or
  `null`, and `onOrder(ids)` is called with the new order.

- [ ] **Step 1: Add the reorderable list**

```javascript
    /*
     * A list you can put in order. Fastmail's own splits editor already has
     * one — SplitConditionItemView carries the whole drag protocol, mouse and
     * touch — so a row here subclasses it and replaces only what it draws.
     *
     * If that subclass cannot be made, the rows still list and still reorder,
     * with a pair of buttons each. That fallback earns its place twice over:
     * a drag is the only way to reorder otherwise, and there is no keyboard
     * path to a drag.
     */
    const reorderList = (classes, items, onOrder) => {
        const el = FastMail.el;
        const order = items.map(item => item.id);

        const move = (id, by) => {
            const at = order.indexOf(id);
            const to = at + by;
            if (at === -1 || to < 0 || to >= order.length) return;
            order.splice(to, 0, order.splice(at, 1)[0]);
            onOrder(order.slice());
        };

        const row = (item) => new classes.View({
            className: 'u-list-item u-flex u-items-center u-space-x-2',
            draw: () => {
                const parts = [el('div.u-flex-1', [item.label])];
                parts.push(new classes.ButtonView({
                    type: 'v-Button--subtle v-Button--sizeM v-Button--iconOnly',
                    label: 'Move up',
                    target: { go: () => move(item.id, -1) }, method: 'go'
                }));
                parts.push(new classes.ButtonView({
                    type: 'v-Button--subtle v-Button--sizeM v-Button--iconOnly',
                    label: 'Move down',
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
            }
        });

        return new classes.View({
            className: 'u-list-body u-list-body--borders',
            draw: () => items.map(row)
        });
    };
```

This is the whole of the list for now: rows that reorder with a pair of
buttons each. Step 5 probes Fastmail's own drag protocol and adds a dragging
row class in front of this one, keeping these buttons as the fallback and as
the keyboard path. Do not attempt the drag before that probe: what a subclass
of `SplitConditionItemView` has to honour is not knowable from the outside.

- [ ] **Step 2: Add the groupings section**

```javascript
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

    const editGrouping = (classes, grouping, done) => {
        const Editor = FastMail.classes && FastMail.classes.GroupSettingsView;
        if (typeof Editor !== 'function') {
            reportFault('Fastmail’s groupings editor is not available; edit the text instead');
            return;
        }

        let saved = null;
        const controller = groupingStandIn(grouping, (value) => { saved = value; });
        const view = new Editor({ controller: controller });
        const modal = new classes.ModalOverlayView({
            rootView: FastMail.root,
            className: 'u-modal',
            positioning: 'relative',
            layout: { width: 580 },
            view: view
        });

        // The editor's own Cancel and Save both fire modal:hide; Save has
        // already handed us the value by then.
        view.on('modal:hide', { close: () => {
            modal.hide();
            setTimeout(() => { try { modal.destroy(); } catch (error) { /* already gone */ } }, 400);
            if (saved) done(saved);
        } }, 'close');

        modal.show();
    };

    const groupingsSection = (classes, register) => {
        const el = FastMail.el;
        const option = settingFor('groupings');
        let showText = false;

        const holder = new classes.View({
            className: 'u-space-y-3',
            draw: () => {
                const groupings = parseGroupings(settingValue('groupings'));

                const save = (next) => {
                    writeSetting('groupings', formatGroupings(next));
                    holder.viewNeedsRedraw();
                };

                const items = groupings.map((one, index) => ({
                    id: one.name,
                    label: one.name + ' — ' + one.categories.length + ' groups',
                    edit: () => editGrouping(classes, one, (value) => {
                        const next = groupings.slice();
                        next[index] = {
                            id: one.id, name: one.name,
                            categories: value.categories, otherName: value.otherName || OTHER_NAME
                        };
                        save(next);
                    }),
                    remove: () => save(groupings.filter((other, at) => at !== index))
                }));

                const list = reorderList(classes, items, (order) => {
                    save(order.map(name => groupings.filter(one => one.name === name)[0]));
                });

                const add = new classes.ButtonView({
                    type: 'v-Button--standard v-Button--sizeM',
                    label: 'Add a grouping',
                    target: { go: () => save(groupings.concat([{
                        id: SPLIT_PREFIX + 'New grouping', name: 'New grouping',
                        categories: [{ name: 'Pinned', query: 'is:pinned' }],
                        otherName: OTHER_NAME
                    }])) },
                    method: 'go'
                });

                const toggle = new classes.ButtonView({
                    type: 'v-Button--subtle v-Button--sizeM',
                    label: showText ? 'Hide the text' : 'Edit as text',
                    target: { go: () => { showText = !showText; holder.viewNeedsRedraw(); } },
                    method: 'go'
                });

                const parts = [
                    el('h3.u-trim.u-font-bold', [option.title]),
                    list, add, toggle
                ];
                if (showText) parts.push(settingRow(classes, option, register));
                parts.push(el('p.u-trim.u-text-sm.u-color-unimportant', [option.hint]));
                return parts;
            }
        });

        return holder;
    };
```

- [ ] **Step 3: Add the action bar section**

```javascript
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
                const items = names.map(name => ({
                    id: name, label: pretty(name), edit: null, remove: null
                }));
                const list = reorderList(classes, items, (order) => {
                    writeSetting('bottomBarSlots', order.map(pretty).join(', '));
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
```

- [ ] **Step 4: Replace the placeholder**

Delete the `sectionRow` placeholder from Task 4 and put this in its place:

```javascript
    // Two options are lists rather than fields; everything else is a row.
    const sectionRow = (classes, option, register) => {
        if (option.key === 'groupings') return groupingsSection(classes, register);
        if (option.key === 'bottomBarSlots') return barSlotsSection(classes);
        return settingRow(classes, option, register);
    };
```

- [ ] **Step 5: Probe the drag subclass, then add it**

Before writing the drag, find out what a subclass of
`SplitConditionItemView` needs. Run a read-only probe in the app:

```javascript
return (function () {
    const S = FastMail.classes.SplitConditionItemView;
    const chain = [];
    let p = S.prototype;
    while (p && p !== Object.prototype) { chain.push(Object.keys(p)); p = Object.getPrototypeOf(p); }
    return JSON.stringify({
        ctor: String(S).slice(0, 400),
        init: String(S.prototype.init || 'inherited').slice(0, 400),
        dragStarted: String(S.prototype.dragStarted || '').slice(0, 500),
        dragEnded: String(S.prototype.dragEnded || '').slice(0, 500),
        chain: chain
    }, null, 1);
})()
```

Read what `dragStarted` and `dragEnded` expect of the parent view — in
Fastmail's own editor the parent is an ordered collection whose items carry
`sortOrder`, and the row writes `sortOrder` as it moves.

Then add a `reorderRowClass()` above `reorderList` that returns a subclass of
`SplitConditionItemView` honouring that contract and overriding only what it
draws, or `null` if it cannot be built. Have `reorderList` use it for its rows
when it is not `null`, and keep the button rows for when it is. The buttons
stay in either case: they are the keyboard path. Record in the commit message
what the probe showed.

If the probe shows the drag depends on machinery that is not reachable —
a mixin held in a module-local variable, say — then stop at the button rows,
record that ruling, and move on. Buttons that reorder are the requirement;
the drag is the better version of it.

- [ ] **Step 6: Syntax-check**

Run: `node --check Userscript/fastmail-custom-mode.user.js`
Expected: no output, exit 0.

- [ ] **Step 7: Verify live**

Extend the Task 4 probe. With a stand-in `writeSetting` that records rather
than writes, and `settings.groupings` set to the shipped default:

1. Open the panel, choose the Groups section, and confirm the list draws one
   row per grouping with the bucket count in its label.
2. Click Move down on the first row; confirm the recorded write is the same
   text with the first two blocks swapped, and that
   `parseGroupings` of it still yields the same number of groupings with the
   same bucket counts.
3. Click Add a grouping; confirm the recorded text gains a `New grouping`
   block and that `parseGroupings` accepts it.
4. Click Edit on a row; confirm a second modal appears carrying Fastmail's own
   editor with the grouping's buckets listed, then dismiss it with its Cancel
   button and confirm no write was recorded.
5. Repeat 4, pressing its Save instead, and confirm exactly one write was
   recorded and it round-trips.
6. In the Action bar section, click Move up on the second verb and confirm the
   recorded value is the seven verbs, comma-separated, with those two swapped.
7. Close the panel; confirm no modal is left behind.

The probe must close both modals in a `finally` block.

- [ ] **Step 8: Run the full suite**

Run: `make test`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js
git commit -m "feat: groupings and bar verbs are lists you can reorder"
```

---

### Task 6: The plain-HTML fallback panel

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js` — the panel section
- Modify: `Userscript/fastmail-custom-mode.user.js` — the stylesheet the mode
  already injects (search for `updateStyles`)

**Interfaces:**
- Consumes: `SETTINGS`, `SETTING_GROUPS`, `settingsInGroup`, `settingValue`,
  `writeSetting`, `SETTING_WRITE_DELAY`.
- Produces: `openFallbackSettings()`, replacing the Task 4 placeholder.

- [ ] **Step 1: Replace the placeholder**

Delete the `openFallbackSettings` placeholder and add:

```javascript
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

        let timer = null;
        const writeSoon = (key, value) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { timer = null; writeSetting(key, value); }, SETTING_WRITE_DELAY);
        };

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
                    input.addEventListener('input', () => writeSoon(option.key, input.value));
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
            if (timer) { clearTimeout(timer); timer = null; }
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

        overlay.appendChild(sheet);
        document.body.appendChild(overlay);
    };
```

- [ ] **Step 2: Add its styles**

Add to the mode's injected stylesheet, beside the other rules:

```css
#custom-mode-fallback-settings {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 24px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.4);
}

.custom-mode-fallback-sheet {
    width: 100%;
    max-width: 620px;
    padding: 20px 24px;
    border-radius: 10px;
    background: Canvas;
    color: CanvasText;
    color-scheme: light dark;
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}

.custom-mode-fallback-row {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    padding: 9px 0;
    border-top: 1px solid rgba(128, 128, 128, 0.3);
}

.custom-mode-fallback-row input[type="text"],
.custom-mode-fallback-row textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    font: inherit;
}

.custom-mode-fallback-row textarea {
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
}

.custom-mode-fallback-title { display: block; font-weight: 500; }

.custom-mode-fallback-hint { display: block; opacity: 0.7; }

.custom-mode-fallback-note { opacity: 0.7; }
```

- [ ] **Step 3: Syntax-check**

Run: `node --check Userscript/fastmail-custom-mode.user.js`
Expected: no output, exit 0.

- [ ] **Step 4: Verify live**

In a probe, with a recording `writeSetting`:

1. Call `openFallbackSettings()` and confirm
   `document.getElementById('custom-mode-fallback-settings')` exists.
2. Confirm it contains one input or textarea per entry in `SETTINGS`, and one
   heading per group with rows.
3. Toggle a checkbox and confirm one write is recorded with the right key.
4. Press Escape and confirm the overlay is gone.
5. Force the real path: temporarily set `FastMail.classes.CheckboxView` to
   `undefined`, call `openSettingsPanel()`, confirm the fallback opened rather
   than a Fastmail modal, close it, and **put `CheckboxView` back in the same
   run**.

- [ ] **Step 5: Run the full suite**

Run: `make test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js
git commit -m "feat: a plain settings panel for when Fastmail's controls move"
```

---

### Task 7: The extension popup becomes one button

**Files:**
- Modify: `SafariExtension/settings.html`
- Modify: `SafariExtension/settings.js`

**Interfaces:**
- Consumes: `window.customMode.openSettings()` (Task 4).
- Produces: nothing other tasks use.

- [ ] **Step 1: Replace the popup markup**

Replace the whole of `SafariExtension/settings.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fastmail Custom Mode</title>
<style>
    :root { color-scheme: light dark; }

    body {
        margin: 0;
        padding: 18px;
        min-width: 260px;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    }

    h1 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }

    p { margin: 0 0 14px; opacity: 0.7; }

    button { font: inherit; padding: 5px 12px; }

    button[disabled] { opacity: 0.5; }
</style>
</head>
<body>
    <h1>Custom mode</h1>
    <p id="note">The settings live in the Fastmail page, beside Fastmail&rsquo;s own.</p>
    <button id="open" type="button">Open settings</button>
    <script src="settings.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace the popup script**

Replace the whole of `SafariExtension/settings.js` with:

```javascript
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

    await api.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
            if (window.customMode && window.customMode.openSettings) {
                window.customMode.openSettings();
            }
        }
    });
    window.close();
};

button.addEventListener('click', () => {
    open().catch((error) => {
        note.textContent = 'Could not open the settings: ' + error.message;
    });
});
```

- [ ] **Step 3: Syntax-check**

Run: `for f in SafariExtension/*.js; do node --check "$f" || exit 1; done`
Expected: no output, exit 0.

- [ ] **Step 4: Run the full suite**

Run: `make test`
Expected: FAIL. `SettingsParityTests.settingsHTMLCarriesEveryCatalogueKey`
and the `settings.js` mirror check both read option rows that no longer
exist. That is the expected failure; Task 8 rewrites those tests. Record the
failing test names in the ledger and proceed — do not weaken the tests here.

- [ ] **Step 5: Commit**

```bash
git add SafariExtension/settings.html SafariExtension/settings.js
git commit -m "feat: the extension popup opens the settings in the page"
```

---

### Task 8: Delete the native catalogue and its screens

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsUI.swift`
- Modify: `Apps/Shared/SettingsView.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/HomeShortcuts.swift:127-133`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift`

**Interfaces:**
- Consumes: `CustomModeSettings.keyPrefix` (Task 1).
- Produces: `CustomModeSettings.badgeLabelDefault: String` (`"Triage"`).
- Removes: `CustomModeSettings.Option`, `.Group`, `.options`, `.options(in:)`,
  `.barSlotGlyph`, `.barSlotSymbol`, `.migrateLegacyKeys`,
  `CustomModeSettingsForm`, `CustomModeSettingsModel`, `CustomModeGroupView`.

- [ ] **Step 1: Rewrite the tests first**

Replace the whole of `SettingsParityTests.swift` with:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

// The userscript's catalogue is canonical and nothing else enumerates the
// options, so there is only one thing left that could drift: the badge
// label's default, which the shell needs before the page has ever run.
private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

@Test func theBadgeLabelDefaultMatchesTheUserscript() throws {
    let source = try String(
        contentsOf: repoRoot.appendingPathComponent("Userscript/fastmail-custom-mode.user.js"),
        encoding: .utf8
    )
    let line = try #require(
        source.split(separator: "\n").first { $0.contains("appBadgeLabel:") },
        "the userscript no longer declares appBadgeLabel"
    )
    #expect(line.contains("'\(CustomModeSettings.badgeLabelDefault)'"))
}
```

In `CustomModeSettingsTests.swift`, delete
`unsetDefaultsProduceTheCatalogDefaults`,
`emptyTextFallsBackToTheDefaultWhereEmptyMeansNothing`,
`emptyTextIsHonouredWhereEmptyMeansNone` and
`untouchedClearableFieldsStillGetTheirDefaults` — the rules they cover now
live in the userscript and are verified by Task 3's probe. Replace
`storedValuesWinOverDefaults` with:

```swift
// Swift keeps no list of the options. Anything under the namespace is a
// setting, whatever it is called, and anything outside it is not.
@Test func injectionCollectsTheNamespaceAndNothingElse() {
    let defaults = freshDefaults(#function)
    defaults.set(false, forKey: "customMode.labelColours")
    defaults.set("Todo", forKey: "customMode.triageLabel")
    defaults.set("yes", forKey: "customMode.somethingSwiftHasNeverHeardOf")
    defaults.set("beta", forKey: "backend")
    defaults.set(true, forKey: "push.alerts")

    let settings = CustomModeSettings.current(from: defaults)
    #expect(settings["labelColours"] as? Bool == false)
    #expect(settings["triageLabel"] as? String == "Todo")
    #expect(settings["somethingSwiftHasNeverHeardOf"] as? String == "yes")
    #expect(settings["backend"] == nil)
    #expect(settings["alerts"] == nil)
    #expect(settings.count == 3)
}

// Nothing is invented: an untouched suite injects nothing, and the page
// supplies every default itself.
@Test func anUntouchedSuiteInjectsNothing() {
    #expect(CustomModeSettings.current(from: freshDefaults(#function)).isEmpty)
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Packages/FastmailShellKit && swift test --filter "Namespace|Untouched|BadgeLabelDefault"`
Expected: FAIL — `badgeLabelDefault` does not exist and `current(from:)` still
walks a catalogue.

- [ ] **Step 3: Gut `CustomModeSettings.swift`**

Delete the `Group` enum, the `Option` struct, `options`, `options(in:)`,
`barSlotGlyph`, `barSlotSymbol` and `migrateLegacyKeys`. Keep the file's
imports, `keyPrefix`, `defaultsKey(for:)`, `isWritableSettingKey`,
`bootstrapScript` and `applyScriptSource`, and replace `current(from:)` with:

```swift
    /// The badge label as the app has it before the page has ever run.
    /// The one default Swift still carries, because HomeShortcuts builds the
    /// home-screen menu from it at launch.
    public static let badgeLabelDefault = "Triage"

    /// The settings as the userscript should see them: everything stored
    /// under the namespace, with the prefix taken off.
    ///
    /// Swift holds no list of the options — the userscript's catalogue is
    /// canonical — so this collects a namespace rather than walking a table.
    /// A key the page has stopped using travels one more time and is ignored;
    /// a key Swift has never heard of travels correctly the first time.
    /// Defaults are not filled in here: the page merges its own.
    public static func current(from defaults: UserDefaults = .standard) -> [String: Any] {
        var settings: [String: Any] = [:]
        for (key, value) in defaults.dictionaryRepresentation() where key.hasPrefix(keyPrefix) {
            let bare = String(key.dropFirst(keyPrefix.count))
            guard isWritableSettingKey(bare) else { continue }
            if let number = value as? NSNumber,
               CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() {
                settings[bare] = number.boolValue
            } else if let text = value as? String {
                settings[bare] = text
            }
        }
        return settings
    }
```

- [ ] **Step 4: Point `HomeShortcuts` at the new default**

Replace `HomeShortcuts.badgeLabel(in:)`:

```swift
    /// The badge label as the app has it: the stored value, or the default.
    public static func badgeLabel(in defaults: UserDefaults = .standard) -> String {
        defaults.string(forKey: CustomModeSettings.defaultsKey(for: "appBadgeLabel"))
            ?? CustomModeSettings.badgeLabelDefault
    }
```

- [ ] **Step 5: Gut `SettingsUI.swift`**

Delete `CustomModeSettingsForm` and `CustomModeSettingsModel` entirely — the
whole file except `MobileSettingsSheet`. In `MobileSettingsSheet.body`, delete
the `Section { CustomModeSettingsForm(group: .general) }` block and the
`ForEach(CustomModeSettings.Group.inboxGroups …)` block, leaving the Backend
and Start page sections. Add a footer under the last section:

```swift
                } footer: {
                    Text("Everything else lives in the page, under Fastmail's own Settings, so it is the same on every device you use.")
                }
```

- [ ] **Step 6: Gut `Apps/Shared/SettingsView.swift`**

Replace `SettingsView.body` with the General pane alone:

```swift
    var body: some View {
        // Only the shell's own settings are here now. Everything about the
        // mail interface is in the page, under Fastmail's own Settings, where
        // one panel serves the Mac, the phone and Safari alike.
        GeneralSettingsView(profile: profile)
            .frame(width: 500, height: 460)
    }
```

Delete `CustomModeGroupView` and the `TabView`. Leave `GeneralSettingsView`
exactly as it is.

- [ ] **Step 7: Run the tests**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS. If `SettingsBundleTests` fails, that is Task 9's; record it and
carry on.

- [ ] **Step 8: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift \
        Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsUI.swift \
        Packages/FastmailShellKit/Sources/FastmailShellKit/HomeShortcuts.swift \
        Apps/Shared/SettingsView.swift \
        Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift \
        Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift
git commit -m "refactor: Swift handles the settings namespace, not a catalogue"
```

---

### Task 9: The Settings bundle keeps three rows

**Files:**
- Modify: `tools/gen-settings-bundle.py`
- Modify: `Apps/Personal/Settings.bundle/Root.plist` (generated)
- Modify: `Apps/Work/Settings.bundle/Root.plist` (generated)
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: a Root.plist with exactly Backend, Start page and the alerts
  switch.

- [ ] **Step 1: Rewrite the test**

Replace the whole of `SettingsBundleTests.swift` with a version that keeps the
`repoRoot`, `apps` and `specifiers(for:)` helpers exactly as they are and has
these cases:

```swift
@Test func settingsBundleKeyMatchesTheDefaultsKey() throws {
    for app in apps {
        let keys = try specifiers(for: app).compactMap { $0["Key"] as? String }
        #expect(keys.contains(StartView.defaultsKey))
    }
}

// The alerts switch is read by the registrar under this key; the Settings
// app must write the same one, with the same default, or the two disagree.
@Test func settingsBundleCarriesTheAlertsSwitch() throws {
    for app in apps {
        let row = try #require(
            try specifiers(for: app).first { $0["Key"] as? String == PushPreferences.alertsKey },
            "\(app) is missing the alerts row"
        )
        #expect(row["Type"] as? String == "PSToggleSwitchSpecifier")
        #expect(row["DefaultValue"] as? Bool == true)
    }
}

// The Custom mode options are in the page now. A row here would be a second
// place to change one, and the two would disagree the moment either was used.
@Test func settingsBundleCarriesNoCustomModeRow() throws {
    for app in apps {
        let keys = try specifiers(for: app).compactMap { $0["Key"] as? String }
        #expect(!keys.contains { $0.hasPrefix(CustomModeSettings.keyPrefix) }, "\(app) still has one")
        #expect(Set(keys) == [Backend.defaultsKey, StartView.defaultsKey, PushPreferences.alertsKey])
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd Packages/FastmailShellKit && swift test --filter settingsBundleCarriesNoCustomModeRow`
Expected: FAIL — the checked-in plist still has twenty-six `customMode.` rows.

- [ ] **Step 3: Rewrite the generator**

Replace the whole of `tools/gen-settings-bundle.py` with:

```python
#!/usr/bin/env python3
"""Regenerate each app's Settings.bundle/Root.plist.

Only the shell's own settings are here: the backend and the start page decide
whether a page can load at all, and the alerts switch belongs beside iOS's own
notification controls. Everything about the mail interface is in the page, in
Custom mode's own settings panel, which is the same on every platform.

This stays a generator rather than two checked-in plists because the two apps
need identical copies, and `settingsBundleCarriesNoCustomModeRow` fails if
they drift.
"""
import plistlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPS = ("Personal", "Work")

SPECIFIERS = [
    {
        "Type": "PSGroupSpecifier",
        "Title": "General",
        "FooterText": "Beta is Fastmail's test server, with its own sign-in "
        "and settings. Switching reloads the page and asks you to log in "
        "again.",
    },
    {
        "Type": "PSMultiValueSpecifier",
        "Title": "Backend",
        "Key": "backend",
        # Backend.standard in the app; both shells run against beta
        "DefaultValue": "beta",
        "Titles": ["Production", "Beta"],
        "Values": ["production", "beta"],
    },
    {
        "Type": "PSGroupSpecifier",
        "FooterText": "The path to open, such as /mail/Inbox. Empty opens the "
        "default view. Takes effect on the next launch.",
    },
    {
        "Type": "PSTextFieldSpecifier",
        "Title": "Start page",
        "Key": "startView",
        "DefaultValue": "",
        "IsSecure": False,
        "KeyboardType": "URL",
        "AutocapitalizationType": "None",
        "AutocorrectionType": "No",
    },
    # Read by PushRegistrar under PushPreferences.alertsKey; the badge is not
    # part of the switch.
    {
        "Type": "PSGroupSpecifier",
        "Title": "Notifications",
        "FooterText": "Off stops the banners for new mail on this device. The "
        "badge keeps counting, and other devices are not affected.",
    },
    {
        "Type": "PSToggleSwitchSpecifier",
        "Title": "Notify for new mail",
        "Key": "push.alerts",
        "DefaultValue": True,
    },
    {
        "Type": "PSGroupSpecifier",
        "FooterText": "Everything else is in the Fastmail page, under "
        "Fastmail's own Settings, so it is the same on every device you use.",
    },
]


def main():
    root = {"PreferenceSpecifiers": SPECIFIERS}

    for app in APPS:
        path = ROOT / "Apps" / app / "Settings.bundle" / "Root.plist"
        with open(path, "wb") as handle:
            plistlib.dump(root, handle, sort_keys=False)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Regenerate and verify**

Run: `make settings-bundle && cd Packages/FastmailShellKit && swift test --filter settingsBundle`
Expected: two "wrote" lines, then PASS on all three cases.

- [ ] **Step 5: Commit**

```bash
git add tools/gen-settings-bundle.py \
        Apps/Personal/Settings.bundle/Root.plist \
        Apps/Work/Settings.bundle/Root.plist \
        Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift
git commit -m "refactor: the iOS Settings bundle keeps only the shell's own three"
```

---

### Task 10: The extension's background script forgets the options

**Files:**
- Modify: `SafariExtension/background.js`

**Interfaces:**
- Consumes: nothing.
- Removes: `DEFAULT_SETTINGS`, `SETTINGS_VERSION`, `LEGACY_DEFAULTS`,
  `migrateSettings`.

- [ ] **Step 1: Remove the catalogue and the migration**

Delete the `DEFAULT_SETTINGS` object, `SETTINGS_VERSION`, `LEGACY_DEFAULTS`,
`migrateSettings` and its `.catch` call. Replace `getSettings` with:

```javascript
// Whatever is stored, as it is. The page carries the catalogue and every
// default, so there is nothing to merge here and nothing to keep in step:
// this script does not know which settings exist, and does not need to.
const getSettings = async () => {
    const stored = await api.storage.local.get('settings');
    return stored.settings || {};
};
```

Update the file's opening comment, replacing the paragraph beginning
"Settings live in extension storage" with:

```
Settings live in extension storage, which the page world cannot read, so they
are written onto the page immediately before the payload is injected. Changing
one pushes it straight to any open Fastmail tab rather than waiting for a
reload.

The settings are edited in the page, by the payload's own panel, which reaches
this storage through early.js. Nothing here knows what the settings are.
```

- [ ] **Step 2: Syntax-check**

Run: `for f in SafariExtension/*.js; do node --check "$f" || exit 1; done`
Expected: no output, exit 0.

- [ ] **Step 3: Run the full suite**

Run: `make test`
Expected: exit 0. The parity test that read `background.js`'s
`DEFAULT_SETTINGS` was replaced in Task 8, so nothing reads it any more.

- [ ] **Step 4: Commit**

```bash
git add SafariExtension/background.js
git commit -m "refactor: the extension injects settings without knowing them"
```

---

### Task 11: The end-to-end gate

**Files:** none. This task changes nothing; it confirms what the others built.

**Interfaces:**
- Consumes: everything.
- Produces: a recorded pass or a list of defects to fix before merge.

This is the merge gate. Nothing in Tasks 1 to 10 has run inside an installed
build — every check was extracted code evaluated against stand-ins. It also
discharges the same outstanding gate the message-list groupings work left
behind.

- [ ] **Step 1: Ask before installing**

`make install-macos` deletes and replaces both applications in `/Applications`
and forces the running mail to quit; `make install-extension` replaces the
Safari extension. Ask the user for an explicit go-ahead before either. If it
is refused, record in the ledger that the gate is outstanding and stop — do
not report the work as verified.

- [ ] **Step 2: Install and check the Mac**

Run: `make install-macos`

Then, in one of the two apps:

1. Fastmail's Settings screen shows both a "Device settings" row and a
   "Custom mode" row.
2. "Custom mode" opens the panel; the seven groups are listed and each draws
   its rows.
3. Turn "Colour rows by label" off: its two sub-options grey out, and the rows
   in the message list lose their colour without a reload.
4. Change the triage label, close the panel, quit and relaunch: the new value
   is still there and the panel shows it.
5. In Groups, reorder two groupings, add one, edit one through Fastmail's own
   dialog and save. Open the Group menu on a mailbox: the new grouping is
   listed, and choosing it renders a real message list with the right
   buckets — **this is the assertion nothing so far has made**.
6. In Action bar, reorder two verbs; the bar redraws in the new order.
7. macOS Settings shows one General pane and no Custom mode tabs.

- [ ] **Step 3: Check the phone**

Run: `make install-ios`

1. Settings → Apps → Fastmail shows Backend, Start page and Notify for new
   mail, and nothing else.
2. The in-app sheet shows Backend and Start page and no catalogue sections.
3. The panel opens from Fastmail's Settings screen and stacks into one column.
4. Change the badge label in the panel; the home-screen quick actions pick up
   the new label without leaving the app.
5. Drag a grouping into a new position with a finger, if the drag landed in
   Task 5; otherwise use the buttons.

- [ ] **Step 4: Check Safari**

Run: `make install-extension`

1. The toolbar button's popup shows one button, and it opens the panel in the
   Fastmail tab.
2. On a non-Fastmail tab the popup says to open Fastmail first.
3. Change a setting in the panel; open a second Fastmail tab and confirm it
   has the new value.

- [ ] **Step 5: Record the result**

Write what passed and what did not into the ledger. Any defect is fixed and
re-verified before merge; a passed gate is stated plainly, naming the
platforms it was run on.

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: the panel and its
shape to Task 4; resolution and the catalogue to Task 3; the groupings editor
and the bar list to Task 5; the three write channels to Tasks 1, 2 and 3; what
each host keeps to Tasks 8, 9 and 10; the fallback to Task 6; the extension
popup to Task 7; testing to the steps inside each task and to Task 11; "no
migration" to Tasks 8 and 10, which delete `migrateLegacyKeys` and
`migrateSettings`. The spec's ordering constraint is Task 1 through 7 before
Task 8 through 10.

**Placeholder scan.** One thing in this plan is specified as a probe rather
than as code: the dragging row class in Task 5 Step 5. That is not a gap being
deferred — what a subclass of `SplitConditionItemView` must honour cannot be
read from outside the minified bundle, so the plan says what to find out, what
to do with the answer, and what to ship if the answer is that it cannot be
reached. Task 5 Step 1 delivers a list that reorders without it, so the
requirement is met either way. Every other code block is either verified
against the live app on 2026-09-12 or is ordinary Swift, Python or DOM code.

**Type consistency.** `writeSetting(key, value)`, `settingValue(key)`,
`settingFor(key)`, `settingsInGroup(group)`, `settingRow(classes, option,
register)`, `sectionRow(classes, option, register)`, `reorderList(classes,
items, onOrder)`, `panelClasses()`, `openSettingsPanel()`,
`closeSettingsPanel()`, `openFallbackSettings()` and
`formatGroupings(groupings)` are spelled the same everywhere they appear.
`CustomModeSettings.keyPrefix`, `.defaultsKey(for:)`,
`.isWritableSettingKey(_:)`, `.badgeLabelDefault` and `.current(from:)` match
between Tasks 1, 8 and 9.
