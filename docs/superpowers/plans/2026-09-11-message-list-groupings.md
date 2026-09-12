# Message List Groupings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Labels grouping and user-written groupings to Fastmail's message list Group menu, and stop a grouped label list from drawing nothing.

**Architecture:** The mode never stores a grouping definition. It wraps the mail controller's `calculateSplits` and calls Fastmail's own implementation with a substitute source, so Fastmail parses the search queries and returns its own filter shape. Which grouping a mailbox uses rides Fastmail's existing per-mailbox `sort`. Menu entries go in through `MenuView.prototype.draw`, finding the Group menu by reading which controller key its options are bound to.

**Tech Stack:** JavaScript userscript (single IIFE, no build step, no test harness), Swift 6 with Swift Testing in `Packages/FastmailShellKit`, SwiftUI settings form shared by macOS and iOS, a Python generator for the iOS `Settings.bundle`, a Safari extension options page in plain HTML and JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-11-inbox-groupings-design.md`

## Global Constraints

- The settings catalogue in `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift` is the single source of truth. Every key and default added there must be mirrored by hand, with identical values, in `Userscript/fastmail-custom-mode.user.js` (`DEFAULT_SETTINGS`), `SafariExtension/settings.js` (`DEFAULT_SETTINGS`), `SafariExtension/background.js` (`DEFAULT_SETTINGS`), and each app's generated `Apps/<app>/Settings.bundle/Root.plist`.
- Run `make settings-bundle` after any catalogue change, and `cd Packages/FastmailShellKit && swift test` to check it.
- The userscript is one IIFE with no imports and no build step. Anything a probe needs to reach must be hung off `window.customMode`.
- Prose in titles, hints and comments uses typographic apostrophes (`’`), matching the existing catalogue.
- The userscript never writes Fastmail's per-mailbox `splits` property. It may write `sort`.
- Never set `groupBy` through its setter; set `sort` directly. The `groupBy` setter deletes `collapsed` from the mailbox's stored split as a side effect.
- Commit after every task. End every commit message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UCLvYziGqLFjqHM9YjJwHu
```

- Other sessions work in this repo. Before committing run `git status --short`; stage only the files your task names.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift` | The `grouping` settings group, the `multiline` flag, the `groupings` option and its default | 1 |
| `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsUI.swift` | Renders a multi-line option as a `TextEditor` | 1 |
| `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift` | Catalogue tests | 1 |
| `tools/gen-settings-bundle.py` | Skips multi-line options, still writes their group header | 2 |
| `Apps/{Personal,Work}/Settings.bundle/Root.plist` | Generated; never hand-edited | 2 |
| `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift` | Settings-bundle tests | 2 |
| `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift` | New: catalogue against the three JavaScript mirrors | 3 |
| `SafariExtension/settings.html`, `settings.js`, `background.js` | The extension's copy of the setting | 3 |
| `Userscript/fastmail-custom-mode.user.js` | Parsing, the Labels grouping, the `calculateSplits` wrapper, the menu entries, collapse storage, the count guard | 4–7 |
| `Userscript/probe-groups.js` | New: exercises the parser and the Labels builder against the live app | 4 |

---

### Task 1: The setting exists and can be edited in the apps

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsUI.swift:128-155`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `CustomModeSettings.Group.grouping`; `CustomModeSettings.Option.multiline: Bool`; the option with key `groupings`, `clearable: true`, `multiline: true`, and the exact default string given in Step 3. Later tasks read that default verbatim.

- [ ] **Step 1: Write the failing tests**

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift`:

```swift
// The groupings field is the one place a user writes their own message-list
// groupings, so the shipped default doubles as the worked example of the
// format the userscript parses.
@Test func theGroupingsDefaultIsTheAgePreset() {
    let settings = CustomModeSettings.current(from: freshDefaults(#function))
    let text = settings["groupings"] as? String
    #expect(text?.hasPrefix("by age (urgent first)") == true)
    #expect(text?.contains("\n  Triage = in:Triage OR is:unread") == true)
    #expect(text?.contains("\n  Pinned = is:pinned") == true)
    #expect(text?.contains("\n  Today = date:today") == true)
    #expect(text?.contains("\n  Yesterday = date:yesterday") == true)
    #expect(text?.contains("\n  This week = after:1w") == true)
    #expect(text?.contains("\n  This month = after:1m") == true)
    #expect(text?.hasSuffix("\n  Older") == true)
}

// Emptied on purpose means no groupings of the user's own, not the preset back.
@Test func theGroupingsFieldIsClearable() {
    let defaults = freshDefaults(#function)
    defaults.set("   ", forKey: "customMode.groupings")
    #expect(CustomModeSettings.current(from: defaults)["groupings"] as? String == "")
}

// Only the form reads this; the value kind stays .text so the resolver, the
// injected JSON and their tests are untouched.
@Test func onlyTheGroupingsOptionIsMultiline() {
    let multiline = CustomModeSettings.options.filter(\.multiline).map(\.key)
    #expect(multiline == ["groupings"])
}

@Test func theGroupingsOptionSitsInItsOwnGroup() {
    #expect(CustomModeSettings.options(in: .grouping).map(\.key) == ["groupings"])
    #expect(CustomModeSettings.Group.grouping.title == "Groups")
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Packages/FastmailShellKit && swift test --filter CustomModeSettingsTests`
Expected: compile errors — `Group` has no member `grouping`, `Option` has no member `multiline`.

- [ ] **Step 3: Add the group, the flag and the option**

In `CustomModeSettings.swift`, add the case to `Group` between `labelsFiling` and `snooze`:

```swift
        case labelsFiling
        case grouping
        case snooze
```

Add its title, in the same switch:

```swift
            case .grouping: return "Groups"
```

Add its symbol, in the `systemImage` switch:

```swift
            case .grouping: return "rectangle.3.group"
```

In `Option`, add the stored property below `clearable`:

```swift
        /// Whether an empty text field is an answer rather than an omission.
        public let clearable: Bool
        /// Whether the value runs to several lines. The value kind stays
        /// `.text`; this only tells the form to draw an editor rather than a
        /// field, and tells the iOS Settings bundle to leave it alone, since
        /// a PSTextFieldSpecifier is one line and cannot hold it.
        public let multiline: Bool
```

Add the parameter to `init`, after `clearable`, and assign it:

```swift
        init(
            _ key: String,
            group: Group,
            parent: String? = nil,
            clearable: Bool = false,
            multiline: Bool = false,
            title: String,
            hint: String,
            default value: Value
        ) {
            self.key = key
            self.group = group
            self.parent = parent
            self.clearable = clearable
            self.multiline = multiline
            self.title = title
            self.hint = hint
            self.defaultValue = value
        }
```

In the `options` array, immediately after the `filteredLabelCounts` entry that closes the Labels & keeping block, insert:

```swift
        // Groups; the message list split into named sections. Fastmail offers
        // none, by age, pinned first, unread first and one custom split per
        // mailbox; the userscript adds Labels, which is built from the label
        // tree, and everything written here.
        Option(
            "groupings",
            group: .grouping,
            clearable: true,
            multiline: true,
            title: "Your groupings",
            hint: "One block each: a line naming the grouping, then indented “Name = search” lines, then a bare line for everything else. Fastmail’s own search syntax, so an unrecognised word becomes a text search rather than an error. Renaming a grouping loses it on the mailboxes using it.",
            default: .text("by age (urgent first)\n  Triage = in:Triage OR is:unread\n  Pinned = is:pinned\n  Today = date:today\n  Yesterday = date:yesterday\n  This week = after:1w\n  This month = after:1m\n  Older")
        ),
```

- [ ] **Step 4: Run the catalogue tests**

Run: `cd Packages/FastmailShellKit && swift test --filter CustomModeSettingsTests`
Expected: PASS. `unsetDefaultsProduceTheCatalogDefaults` and `scriptsCarryTheSettingsAndTheApplyCall` both count options rather than naming them, so they stay green.

- [ ] **Step 5: Draw a multi-line option as an editor**

In `SettingsUI.swift`, replace the `case .text(let fallback):` arm of `row(for:)` with:

```swift
            case .text(let fallback):
                Text(option.title)
                if option.multiline {
                    // A field would show one line of a value that is a dozen,
                    // and a placeholder cannot stand in for a format, so the
                    // hint below carries the format instead.
                    TextEditor(text: model.textBinding(for: option))
                        .font(.body.monospaced())
                        .frame(minHeight: 160)
                        .autocorrectionDisabled()
                        #if canImport(UIKit)
                        .textInputAutocapitalization(.never)
                        #endif
                } else {
                    // A clearable field shows its default as text rather than
                    // as a placeholder, because for those two an empty box is
                    // ambiguous; never touched, or emptied on purpose, and
                    // they mean opposite things.
                    TextField(
                        option.title,
                        text: model.textBinding(for: option),
                        prompt: Text(option.clearable ? "none" : fallback)
                    )
                    .labelsHidden()
                    .autocorrectionDisabled()
                    #if canImport(UIKit)
                    .textInputAutocapitalization(.never)
                    #endif
                }
```

- [ ] **Step 6: Build both platforms**

Run: `cd Packages/FastmailShellKit && swift build && swift test`
Expected: builds clean; only the settings-bundle tests fail, because `Root.plist` has not been regenerated yet. Task 2 fixes those. Note which ones fail so you can confirm the same set goes green.

- [ ] **Step 7: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift \
        Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsUI.swift \
        Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift
git commit -m "$(cat <<'EOF'
feat: a field for groupings of your own, and a box big enough to write them in

Fastmail's Group menu offers five and no way to add a sixth. This is where
the ones the userscript adds are written: a block per grouping, a line per
group, in Fastmail's own search syntax. It arrives holding the age preset,
which is the format explaining itself.

A value of a dozen lines wants an editor rather than a field, so an option
can say it is multiline. The value kind stays text, so nothing that resolves
or injects a setting had to learn a new one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UCLvYziGqLFjqHM9YjJwHu
EOF
)"
```

---

### Task 2: The iOS Settings bundle skips it and says where it lives

**Files:**
- Modify: `tools/gen-settings-bundle.py`
- Modify: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift:77-101`
- Regenerate: `Apps/Personal/Settings.bundle/Root.plist`, `Apps/Work/Settings.bundle/Root.plist`

**Interfaces:**
- Consumes: `CustomModeSettings.Option.multiline` and `Group.grouping` from Task 1.
- Produces: nothing later tasks use.

A `PSTextFieldSpecifier` is one line and cannot hold a dozen. The row is left out, but the group header stays with a footer pointing at the in-app screen, so the iOS Settings app does not silently lose a whole group.

- [ ] **Step 1: Write the failing test**

In `SettingsBundleTests.swift`, replace the body of `settingsBundleCarriesEveryCustomModeOption` with:

```swift
@Test func settingsBundleCarriesEveryCustomModeOption() throws {
    for app in apps {
        let byKey = Dictionary(
            try specifiers(for: app).compactMap { row in (row["Key"] as? String).map { ($0, row) } },
            uniquingKeysWith: { first, _ in first }
        )
        for option in CustomModeSettings.options {
            // A multi-line value has no specifier that can hold it; it is
            // edited in the app's own settings screen instead.
            guard !option.multiline else {
                #expect(byKey[option.defaultsKey] == nil, "\(app) should not carry \(option.defaultsKey)")
                continue
            }
            let row = try #require(byKey[option.defaultsKey], "\(app) is missing \(option.defaultsKey)")
            switch option.defaultValue {
            case .toggle(let value):
                #expect(row["Type"] as? String == "PSToggleSwitchSpecifier")
                #expect(row["DefaultValue"] as? Bool == value, Comment(rawValue: option.defaultsKey))
            case .text(let value):
                #expect(row["Type"] as? String == "PSTextFieldSpecifier")
                #expect(row["DefaultValue"] as? String == value, Comment(rawValue: option.defaultsKey))
            }
        }
    }
}

// A group whose every option is multi-line still gets its header, carrying a
// footer that says where the setting actually is. Losing the header would
// lose the only mention of the group on the phone's Settings screen.
@Test func settingsBundleExplainsAGroupItCannotShow() throws {
    for app in apps {
        let rows = try specifiers(for: app)
        let header = try #require(
            rows.first { $0["Type"] as? String == "PSGroupSpecifier"
                && $0["Title"] as? String == CustomModeSettings.Group.grouping.title },
            "\(app) is missing the \(CustomModeSettings.Group.grouping.title) header"
        )
        let footer = try #require(header["FooterText"] as? String)
        #expect(footer.contains("app’s own settings"))
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Packages/FastmailShellKit && swift test --filter SettingsBundleTests`
Expected: FAIL. `settingsBundleShowsEveryGroupHeader` fails because the plist has no Groups header, and `settingsBundleExplainsAGroupItCannotShow` fails for the same reason.

- [ ] **Step 3: Teach the generator about multi-line options**

In `tools/gen-settings-bundle.py`, extend the `OPTION` regex to accept the flag, by replacing the `clearable` line with these two:

```python
    r'(?:clearable:\s*(?:true|false),\s*)?'
    r'(?:multiline:\s*(?P<multiline>true|false),\s*)?'
```

In `options()`, carry the flag through, replacing the `found.append(...)` call:

```python
        found.append((match["key"], match["group"], default,
                      match["title"], match["hint"],
                      match["multiline"] == "true"))
```

Add the new group's title to `GROUP_TITLE`:

```python
    "grouping": "Groups",
```

In `specifiers()`, replace the loop over the catalogue with:

```python
    # A multi-line value has no specifier that fits: PSTextFieldSpecifier is
    # one line. The header still goes in, with a footer saying where the
    # setting is, rather than the group vanishing off the phone's screen.
    IN_APP_ONLY = ("This one runs to several lines, so it is edited in the "
                   "app’s own settings screen rather than here.")

    last_group = "general"
    for key, group_key, default, title, hint, multiline in catalog:
        group = {"Type": "PSGroupSpecifier",
                 "FooterText": IN_APP_ONLY if multiline else hint}
        if group_key != last_group:
            if last_group == "general":
                rows.extend(notifications)
            group["Title"] = GROUP_TITLE[group_key]
            last_group = group_key
        rows.append(group)

        if multiline:
            continue

        if isinstance(default, bool):
            rows.append({
                "Type": "PSToggleSwitchSpecifier",
                "Title": title,
                "Key": f"customMode.{key}",
                "DefaultValue": default,
            })
        else:
            rows.append({
                "Type": "PSTextFieldSpecifier",
                "Title": title,
                "Key": f"customMode.{key}",
                "DefaultValue": default,
                "IsSecure": False,
                "AutocapitalizationType": "None",
                "AutocorrectionType": "No",
            })

    return rows
```

- [ ] **Step 4: Regenerate and run the tests**

Run: `make settings-bundle && cd Packages/FastmailShellKit && swift test`
Expected: the generator prints two written paths and `27 options from CustomModeSettings.swift`; every test passes, including the ones Task 1 left failing.

- [ ] **Step 5: Commit**

```bash
git add tools/gen-settings-bundle.py \
        Apps/Personal/Settings.bundle/Root.plist \
        Apps/Work/Settings.bundle/Root.plist \
        Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift
git commit -m "$(cat <<'EOF'
fix: the phone's Settings screen says where a setting it cannot draw lives

A text field there is one line, and the groupings are a dozen, so the row is
left out. The header stays, with a footer sending you to the app's own
settings screen; a group that simply vanished would leave nothing on that
screen to say the setting exists at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UCLvYziGqLFjqHM9YjJwHu
EOF
)"
```

---

### Task 3: A parity test, then the extension's copy of the setting

**Files:**
- Create: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift`
- Modify: `Userscript/fastmail-custom-mode.user.js` (`DEFAULT_SETTINGS`, around line 81-138)
- Modify: `SafariExtension/settings.js`, `SafariExtension/background.js`, `SafariExtension/settings.html`

**Interfaces:**
- Consumes: the `groupings` key and default from Task 1.
- Produces: `settings.groupings` readable in the userscript. Task 4 reads it.

Nothing checks that the catalogue and its three JavaScript mirrors agree; they are kept in step by hand. This change adds a long value to all four, which is exactly what drifts, so the test comes first and the edits are what make it pass.

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

// The catalogue is the source of truth, but three JavaScript files carry a
// copy of it by hand: the userscript's own defaults, for a page running
// without a shell; the extension's options page; and the extension's
// background script. A key that reaches only some of them is a setting that
// works in some places and not others, which is exactly the bug nobody
// notices. This is the only thing that ties the four together.
private let repoRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()

private let mirrors = [
    "Userscript/fastmail-custom-mode.user.js",
    "SafariExtension/settings.js",
    "SafariExtension/background.js",
]

/// The `DEFAULT_SETTINGS` object literal of a mirror, as key to value, where
/// a value is a Bool or a String. Parsed rather than evaluated: the files are
/// not modules and cannot be imported into a Swift test.
private func defaults(inMirror path: String) throws -> [String: CustomModeSettings.Option.Value] {
    let source = try String(contentsOf: repoRoot.appendingPathComponent(path), encoding: .utf8)
    let opening = try #require(source.range(of: "DEFAULT_SETTINGS = {"))
    // The userscript closes its literal indented and the extension's two do
    // not, so the brace is found without one.
    let closing = try #require(source.range(of: "};", range: opening.upperBound..<source.endIndex))
    let body = source[opening.upperBound..<closing.lowerBound]

    var found: [String: CustomModeSettings.Option.Value] = [:]
    for line in body.split(separator: "\n") {
        let text = line.trimmingCharacters(in: .whitespaces)
        guard let colon = text.firstIndex(of: ":") else { continue }
        let key = String(text[text.startIndex..<colon])
        guard key.allSatisfy({ $0.isLetter || $0.isNumber }) else { continue }

        var value = String(text[text.index(after: colon)...])
            .trimmingCharacters(in: .whitespaces)
        if value.hasSuffix(",") { value.removeLast() }

        if value == "true" { found[key] = .toggle(true) }
        else if value == "false" { found[key] = .toggle(false) }
        else if value.hasPrefix("'") && value.hasSuffix("'") {
            let inner = String(value.dropFirst().dropLast())
            // The mirrors spell a newline the way JavaScript does.
            found[key] = .text(inner.replacingOccurrences(of: "\\n", with: "\n"))
        }
    }
    return found
}

@Test func everyMirrorCarriesEveryCatalogueKey() throws {
    for path in mirrors {
        let mirror = try defaults(inMirror: path)
        let catalogue = Set(CustomModeSettings.options.map(\.key))
        #expect(Set(mirror.keys) == catalogue, Comment(rawValue: path))
    }
}

@Test func everyMirrorCarriesEveryCatalogueDefault() throws {
    for path in mirrors {
        let mirror = try defaults(inMirror: path)
        for option in CustomModeSettings.options {
            #expect(
                mirror[option.key] == option.defaultValue,
                Comment(rawValue: "\(path): \(option.key)")
            )
        }
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd Packages/FastmailShellKit && swift test --filter SettingsParityTests`
Expected: FAIL on both tests, for all three mirrors, because none of them has `groupings`.

- [ ] **Step 3: Add the key to the userscript's defaults**

In `Userscript/fastmail-custom-mode.user.js`, inside `DEFAULT_SETTINGS`, immediately after the `filteredLabelCounts: true,` line, insert:

```javascript
        // The groupings offered in Fastmail's Group menu beyond its own five
        // and the automatic Labels one. A block each: a line naming it, then
        // indented Name = search lines, then a bare line for the rest.
        groupings: 'by age (urgent first)\n  Triage = in:Triage OR is:unread\n  Pinned = is:pinned\n  Today = date:today\n  Yesterday = date:yesterday\n  This week = after:1w\n  This month = after:1m\n  Older',
```

- [ ] **Step 4: Add the same line to both extension scripts**

Insert the identical `groupings: '…'` line (without the comment) into the `DEFAULT_SETTINGS` object of `SafariExtension/settings.js` and of `SafariExtension/background.js`, after their `filteredLabelCounts: true,` line in each.

- [ ] **Step 5: Run the parity test**

Run: `cd Packages/FastmailShellKit && swift test --filter SettingsParityTests`
Expected: PASS.

- [ ] **Step 6: Give the options page a textarea**

In `SafariExtension/settings.html`, after the `filteredLabelCounts` row, add:

```html
    <label class="text">
        <span>
            <span class="title">Your groupings</span>
            <span class="hint">One block each: a line naming the grouping, then indented “Name = search” lines, then a bare line for everything else. Fastmail’s own search syntax.</span>
            <textarea id="groupings" rows="10" spellcheck="false" autocapitalize="off"></textarea>
        </span>
    </label>
```

In the page's `<style>` block, beside the existing input rules, add:

```css
    textarea {
        font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
        resize: vertical;
        width: 100%;
    }
```

- [ ] **Step 7: Make the page read and write a textarea**

`settings.js` branches on `input.type === 'text'`, and a textarea's type is `textarea`, so both halves would treat it as a checkbox. In `SafariExtension/settings.js`, add this helper above `load`:

```javascript
// A textarea is not type "text", and the checkbox branch would read its
// checked property, which is undefined; so the question is asked once, here.
const isTextInput = (input) => input.type === 'text' || input.tagName === 'TEXTAREA';
```

Then replace the two branches:

```javascript
        if (isTextInput(input)) input.value = settings[key] || '';
        else input.checked = !!settings[key];
```

```javascript
        settings[key] = isTextInput(input) ? input.value.trim() : input.checked;
```

Finally, a textarea fires `change` only on blur, so also bind input:

```javascript
inputs.forEach(([, input]) => {
    input.addEventListener('change', save);
    if (input.tagName === 'TEXTAREA') input.addEventListener('input', save);
});
```

- [ ] **Step 8: Run the syntax checks and the full suite**

Run: `node --check Userscript/fastmail-custom-mode.user.js && for f in SafariExtension/*.js; do node --check "$f" || exit 1; done && cd Packages/FastmailShellKit && swift test`
Expected: no output from the checks, all Swift tests pass.

- [ ] **Step 9: Commit**

```bash
git add Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift \
        Userscript/fastmail-custom-mode.user.js \
        SafariExtension/settings.js SafariExtension/background.js SafariExtension/settings.html
git commit -m "$(cat <<'EOF'
test: tie the catalogue to the three files that copy it by hand

The catalogue is the source of truth and three JavaScript files carry a copy
of it: the userscript's own defaults, the extension's options page and its
background script. Nothing checked that they agreed. A key in only some of
them is a setting that works in some places and not others, which is the kind
of bug nobody reports because it looks like they imagined it.

So the test comes first, and adding the groupings field to all three is what
makes it pass. The options page gets a textarea, which is not type "text"
and would have been read as a checkbox otherwise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UCLvYziGqLFjqHM9YjJwHu
EOF
)"
```

---

### Task 4: Groupings the userscript can build

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`
- Create: `Userscript/probe-groups.js`

**Interfaces:**
- Consumes: `settings.groupings` from Task 3; the existing `controller()`, `reportFault`, `isSidebarLabel`, `isTriage`, `parentOf`, `forgetLabelCache`, `addObservers`, `start` helpers.
- Produces, all module-level in the IIFE and the first three also on `window.customMode`:
  - `parseGroupings(text)` → `[{ id: String, name: String, categories: [{name, query}], otherName: String }]`
  - `labelsGrouping(mailbox)` → `{ id: 'labels', name: 'labels', categories: [{name, filter}], otherName: 'Other' }` or `null`
  - `currentGroupingId()` → `String` (`''` when ungrouped)
  - `modeGroupings()` → `[definition]`, the parsed settings value
  - `groupingFor(id, mailbox)` → definition or `null`, over both Labels and the parsed list
  - `chooseGrouping(id)` → void, writes `sort`
  - `modeGroupingIsActive()` → definition or `null` for the current controller state

Place the whole section after `hasSublabels` and its neighbours, which it uses, and before the list-toolbar section.

- [ ] **Step 1: Write the probe that will exercise it**

Create `Userscript/probe-groups.js`:

```javascript
/*
 * The groupings the mode adds to Fastmail's Group menu: what the settings
 * text parses to, what Labels makes of the current mailbox, and what
 * Fastmail's own parser turns each search into. Read-only. Run with:
 *   osascript -e 'tell application "nexthealth.nl" to do JavaScript (read POSIX file "<abs path>/probe-groups.js" as «class utf8»)'
 */
(function () {
    try {
        const mode = window.customMode;
        if (!mode || !mode.parseGroupings) return 'ERR no customMode.parseGroupings';

        const parsed = mode.parseGroupings(mode.settings().groupings);
        const controller = FastMail.router.getAppController('mail');
        const mailbox = controller.get('mailbox');
        const labels = mode.labelsGrouping(mailbox);

        // What the categories become once Fastmail's own parser has them
        const splits = controller.calculateSplits();

        return JSON.stringify({
            current: mode.currentGroupingId(),
            mailbox: mailbox && mailbox.get('name'),
            parsed: parsed.map(one => ({
                id: one.id,
                name: one.name,
                otherName: one.otherName,
                groups: one.categories.map(c => c.name + ' = ' + c.query)
            })),
            labels: labels && {
                names: labels.categories.map(c => c.name),
                otherName: labels.otherName
            },
            splits: splits && {
                names: splits.categories.map(c => c.name),
                otherName: splits.otherName
            }
        }, null, 1);
    } catch (error) {
        return 'ERR ' + error.message + '\n' + error.stack;
    }
})()
```

- [ ] **Step 2: Run the probe to verify it fails**

Run: `osascript -e 'tell application "nexthealth.nl" to do JavaScript (read POSIX file "'"$PWD"'/Userscript/probe-groups.js" as «class utf8»)'`
Expected: `ERR no customMode.parseGroupings`. If instead you get "Can't find variable: FastMail", the app is on a non-Fastmail page; open its mail window first.

- [ ] **Step 3: Write the parser and the Labels builder**

Insert into `Userscript/fastmail-custom-mode.user.js`:

```javascript
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
     * The settings text, as groupings.
     *
     * A line at the margin opens a block and names it; an indented line with
     * an equals sign is a group, its name before and a Fastmail search after;
     * an indented line without one names the bucket for the rest; a blank
     * line ends the block. A block with no groups is dropped, since a
     * grouping that groups nothing is a menu entry that does nothing, and the
     * first of two blocks sharing a name wins, so "split:" and the name stay
     * one grouping.
     */
    const parseGroupings = (text) => {
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

            if (!current || (!indented && divider === -1)) {
                current = {
                    id: SPLIT_PREFIX + line,
                    name: line,
                    categories: [],
                    otherName: OTHER_NAME
                };
                if (!taken[current.id]) {
                    taken[current.id] = true;
                    groupings.push(current);
                } else {
                    current = null;
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

        return groupings.filter(one => one.categories.length);
    };

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

    const modeGroupingIsActive = () => {
        const id = currentGroupingId();
        if (id !== LABELS_GROUPING && id.indexOf(SPLIT_PREFIX) !== 0) return null;
        return groupingFor(id, controller().get('mailbox'));
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

        mailController.set('sort',
            id ? [{ property: id, isAscending: false }, sortField] : [sortField]);
    };
```

- [ ] **Step 4: Wrap calculateSplits**

Immediately after `chooseGrouping`, add:

```javascript
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
        const parsed = definition.categories.every(one => one.filter);
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
            if (!modeGroupingIsActive()) return;
            controller().computedPropertyDidChange('splits');
        } catch (error) {
            reportFault('could not refresh the groups', error);
        }
    };
```

- [ ] **Step 5: Wire it in**

In `start()`, add `patchSplits();` immediately after `patchMessageMenu();`.

In `addObservers()`, inside the existing `FastMail.store.on(FastMail.classes.Mailbox, …)` handler, add `refreshGroupings();` after `forgetLabelCache();` — a label added, renamed, removed or re-sorted changes what Labels groups by. Then add, at the end of `addObservers`:

```javascript
        // A different mailbox may be grouped differently, or not at all
        controller().addObserverForKey('sort', { go: scheduleMidnight }, 'go');
        controller().addObserverForKey('mailbox', { go: scheduleMidnight }, 'go');
```

and call `scheduleMidnight();` once at the end of `start()`, after `setMode(storedMode())`.

In `applySettings`, after the existing `forgetLabelCache();` call, add `refreshGroupings();` so editing the text takes effect without a reload.

In the `window.customMode` object, add:

```javascript
            parseGroupings,
            labelsGrouping: labelsGroupingFor,
            currentGroupingId,
            chooseGrouping,
```

- [ ] **Step 6: Syntax-check, install and run the probe**

Run: `node --check Userscript/fastmail-custom-mode.user.js && make install-extension`
Then reload the Fastmail window in the work app and run:
`osascript -e 'tell application "nexthealth.nl" to do JavaScript (read POSIX file "'"$PWD"'/Userscript/probe-groups.js" as «class utf8»)'`

Expected, on the Inbox: `parsed` holds one grouping, `split:by age (urgent first)`, with the seven groups and `otherName` "Older"; `labels` lists `["Business","Projects","Boards","Later"]` with `otherName` "Other"; `current` is whatever that mailbox was already using.

- [ ] **Step 7: Check the stand-in against Fastmail's parser**

In the work app's console or through a one-off probe, run:

```javascript
const mode = window.customMode;
mode.chooseGrouping('split:by age (urgent first)');
FastMail.router.getAppController('mail').calculateSplits();
```

Expected: categories named Triage, Pinned, Today, Yesterday, This week, This month, each with a `filter` — `Today` as `{after: …, before: …}` a day apart, `Pinned` as `{someInThreadHaveKeyword: "$flagged"}` — and `otherName` "Older". Then `mode.chooseGrouping('labels')` and check the categories are the four labels with `inMailbox` filters.

- [ ] **Step 8: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js Userscript/probe-groups.js
git commit -m "$(cat <<'EOF'
feat: groupings the mode supplies, without storing a definition anywhere

Fastmail keeps a custom split on the mailbox and parses its searches into
filters. The mode wants groupings of its own without touching that, so it
calls Fastmail's own calculateSplits with a stand-in: an object answering
custom for groupBy and handing back the mode's definition, delegating
everything else. Fastmail does the parsing and the shape that comes back is
its own, so no search syntax is reimplemented here.

Labels needs none of that, being filters already: a group per label under
this one, or per top-level label in the Inbox, on plain membership. Mail
filed before a nest went on whole carries the leaf alone and falls into
Other, where it can be seen.

The choice rides the mailbox's own sort, written directly, because the
groupBy setter deletes the collapsed list off a stored split on its way past.
A value Fastmail does not know means no grouping there and nothing worse.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UCLvYziGqLFjqHM9YjJwHu
EOF
)"
```

---

### Task 5: The entries in the Group menu

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js:5228-5268` (`isMessageActionsMenu`, `patchMessageMenu`)

**Interfaces:**
- Consumes: `modeGroupings`, `labelsGroupingFor`, `currentGroupingId`, `chooseGrouping` from Task 4.
- Produces: nothing later tasks use.

- [ ] **Step 1: Add the fingerprint and the entry builder**

In `Userscript/fastmail-custom-mode.user.js`, immediately above `isMessageActionsMenu`, add:

```javascript
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
```

- [ ] **Step 2: Fold it into the existing menu patch**

Replace `patchMessageMenu` with a version that owns both injections:

```javascript
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
```

In `start()`, change `patchMessageMenu();` to `patchMenus();`.

- [ ] **Step 3: Syntax-check and install**

Run: `node --check Userscript/fastmail-custom-mode.user.js && make install-extension`
Then reload the Fastmail window in the work app.

- [ ] **Step 4: Check the menu in the live app**

Run:

```bash
osascript -e 'tell application "nexthealth.nl" to do JavaScript "
  const C = FastMail.classes;
  const found = [];
  const walk = (v, d) => { if (!v || d > 40) return; if (v instanceof C.MenuButtonView) found.push(v);
    let k = []; try { k = v.get(\"childViews\") || []; } catch (e) {} k.forEach(x => walk(x, d + 1)); };
  walk(FastMail.root, 0);
  for (const b of found) {
    const layer = b.get(\"layer\");
    layer.click();
    const pop = document.querySelector(\".v-PopOver\");
    const text = pop ? pop.textContent : \"\";
    document.body.dispatchEvent(new KeyboardEvent(\"keydown\", { key: \"Escape\", bubbles: true }));
    if (text.indexOf(\"pinned first\") !== -1) return text;
  }
  return \"no group menu\";
"'
```

Expected: the text runs none, by age, pinned first, unread first, labels, by age (urgent first), custom…, then the Sort section. The Copy link entry on a message's own menu must still be there — open one and check.

- [ ] **Step 5: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js
git commit -m "$(cat <<'EOF'
feat: the Group menu offers labels and the ones you wrote

Found by what its buttons are bound to rather than by where it sits: each of
Fastmail's four groupings binds its selected state to the controller's
groupBy, and Overture leaves a binding's source path on the object in the
open, so the menu carrying one is the Group menu in any language and wherever
the button has moved to. No match means nothing is added and Fastmail's own
menu is what opens.

Which puts this on the patch the mode already runs for Copy link, with
entries built from the same ButtonView class the action bar builds its verbs
from.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UCLvYziGqLFjqHM9YjJwHu
EOF
)"
```

---

### Task 6: Folding a group sticks, locally

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`

**Interfaces:**
- Consumes: `modeGroupingIsActive`, `currentGroupingId` from Task 4.
- Produces: `adoptList()`, called again by Task 7; `GROUPING_STORE_KEY`.

Fastmail wraps each list in a proxy holding `collapsedGroups` as a set, and calls `collapsedGroupsDidChange()` when a group is folded; its own implementation writes the indexes into the mailbox's stored split, which the mode must not touch. So for the mode's groupings that one method is replaced.

- [ ] **Step 1: Add the store and the adoption**

Add beside the groupings section, after `refreshGroupings`:

```javascript
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
        };
    };
```

- [ ] **Step 2: Wire it in**

In `addObservers()`, add:

```javascript
        // The list is rebuilt whenever the mailbox, the sort or the filter
        // moves, and a fresh one folds nothing until it is told
        controller().addObserverForKey('mailboxMessageList', { go: adoptList }, 'go');
```

and call `adoptList();` once in `start()`, immediately after `scheduleMidnight();`.

- [ ] **Step 3: Syntax-check and install**

Run: `node --check Userscript/fastmail-custom-mode.user.js && make install-extension`
Then reload the Fastmail window in the work app.

- [ ] **Step 4: Check it in the live app**

1. On the Inbox, pick labels from the Group menu, and fold two groups.
2. Go to another mailbox and come back. Expected: the same two are still folded.
3. Run:

```bash
osascript -e 'tell application "nexthealth.nl" to do JavaScript "JSON.stringify({ folded: JSON.parse(localStorage.getItem(\"custom-mode-groups\") || \"{}\"), inboxSplits: FastMail.store.getAll(FastMail.classes.Mailbox).filter(m => m.get(\"role\") === \"inbox\")[0].get(\"splits\") })"'
```

Expected: the folded indexes are in local storage, and the Inbox's own `splits` is unchanged — `null` if it never had one, or exactly what it held before.

4. On Projects, switch to labels and back to custom. Expected: the Projects split's own folded groups are exactly as they were.

- [ ] **Step 5: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js
git commit -m "$(cat <<'EOF'
feat: a folded group stays folded, without writing to the mailbox

Fastmail folds a group by adding its index to a set on the list, then writing
that set into the split stored on the mailbox. The mode stores no definition
there, so it has nothing to write into and replaces that one method: the
indexes go to local storage under the mailbox and the grouping, and a fresh
list is seeded from them.

Which also keeps a split somebody made in Fastmail's own dialog exactly as
they left it, folded groups included, whatever the mode is doing next door.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UCLvYziGqLFjqHM9YjJwHu
EOF
)"
```

---

### Task 7: A grouped label list never draws nothing

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`

**Interfaces:**
- Consumes: `adoptList` from Task 6.
- Produces: nothing.

The list proxy works out how many rows it has as `queryLength` less the counts of the folded groups, taking the per-group counts at face value. Those counts and that length come from different places and can drift: marking the list obsolete sends `Email/queryChanges`, and Fastmail skips applying fresh counts while the query still holds optimistic changes, so the length moves and the counts do not. Caught on the Projects label with `queryLength` 31 against counts summing 204 and 169 rows folded away: minus 138 rows, and a list that draws nothing.

The guard is the arithmetic, not the cause. The counts can never legitimately sum above the length, because the leftover bucket is their difference.

- [ ] **Step 1: Add the guard**

Add immediately after `adoptList`:

```javascript
    /*
     * Counts that outrun the list.
     *
     * The list's height is its length less the folded groups' counts, and
     * those counts are taken as given; the bucket for everything else is the
     * difference between them, which Fastmail floors at nothing when it
     * measures the list but not when it counts it. So counts left over from
     * a longer list make the length negative and the list draws nothing at
     * all, which is how a label with a grouping on it comes up empty.
     *
     * Counts summing above the length are never right, whatever put them
     * there. Dropped, so the list draws now, ungrouped, rather than not at
     * all; and the query is refetched so real ones come back.
     */
    const checkGroupCounts = (list) => {
        try {
            const counts = list.get('groupByCounts');
            const length = list.get('queryLength');
            if (!counts || typeof length !== 'number') return;

            const total = counts.reduce((sum, one) => sum + (one || 0), 0);
            if (total <= length) {
                list.customCountsDropped = false;
                return;
            }

            // Dropping the counts changes them, which brings us back here;
            // once per drift is enough.
            if (list.customCountsDropped) return;
            list.customCountsDropped = true;

            reportFault('the group counts had run ahead of the list; refetching');
            if (list.query) list.query.set('groupByCounts', null);
            list.reset();
        } catch (error) {
            // A list that cannot be asked is a list that cannot be mended
        }
    };
```

- [ ] **Step 2: Watch every list, grouped or not**

`adoptList` returns early when no grouping of the mode's is on, but the drift happens under Fastmail's own groupings too, so the watch is separate. Add after `checkGroupCounts`:

```javascript
    const watchGroupCounts = () => {
        const list = controller().get('mailboxMessageList');
        if (!list || !list.collapsedGroups || list.customCountWatch) return;
        list.customCountWatch = true;

        const check = { go: () => checkGroupCounts(list) };
        list.addObserverForKey('groupByCounts', check, 'go');
        list.addObserverForKey('queryLength', check, 'go');
        checkGroupCounts(list);
    };
```

In `addObservers()`, extend the observer added in Task 6 so both run:

```javascript
        controller().addObserverForKey('mailboxMessageList', {
            go: () => {
                adoptList();
                watchGroupCounts();
            }
        }, 'go');
```

and in `start()`, add `watchGroupCounts();` after the `adoptList();` call.

- [ ] **Step 3: Syntax-check and install**

Run: `node --check Userscript/fastmail-custom-mode.user.js && make install-extension`
Then reload the Fastmail window in the work app.

- [ ] **Step 4: Force the drift and watch it recover**

Go to the Projects label, which has a custom split with folded groups, then run:

```bash
osascript -e 'tell application "nexthealth.nl" to do JavaScript "
  const ctrl = FastMail.router.getAppController(\"mail\");
  const list = ctrl.get(\"mailboxMessageList\");
  const before = { length: list.get(\"length\"), queryLength: list.get(\"queryLength\") };
  list.query.set(\"groupByCounts\", (list.get(\"groupByCounts\") || []).map(n => n + 500));
  return JSON.stringify({ before, during: { length: list.get(\"length\") } });
"'
```

Expected: `before.length` is a sensible positive number. The list must not be left empty: within a second or two it draws ungrouped and then comes back grouped, and a banner says the counts had run ahead. Check by eye, then confirm:

```bash
osascript -e 'tell application "nexthealth.nl" to do JavaScript "
  const list = FastMail.router.getAppController(\"mail\").get(\"mailboxMessageList\");
  return JSON.stringify({ length: list.get(\"length\"), queryLength: list.get(\"queryLength\"),
    counts: list.get(\"groupByCounts\") });
"'
```

Expected: `length` is positive again and the counts sum to no more than `queryLength`.

- [ ] **Step 5: Run the whole suite**

Run: `make test`
Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add Userscript/fastmail-custom-mode.user.js
git commit -m "$(cat <<'EOF'
fix: a grouped list draws what it has, rather than nothing

The list's length is what the server said less the counts of the groups
folded away, and those two numbers come from different answers. Marking the
list obsolete asks for changes since a state, and fresh counts are skipped
while the query still holds changes of its own, so the length moves and the
counts stay. Projects had a length of 31 against counts summing 204 with 169
rows folded: minus 138 rows, and nothing drawn.

Counts summing above the length are never right; the bucket for everything
else is the difference. So they are dropped and the query refetched, and the
list draws ungrouped for a moment instead of not at all. The guard is the
arithmetic rather than any one path into it, because this was never
reproducible on demand.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UCLvYziGqLFjqHM9YjJwHu
EOF
)"
```

---

## Final verification

Against the work account, which has the nesting and the volume. These are the spec's acceptance checks; run them after Task 7.

- [ ] Labels on the Inbox shows Business, Projects, Boards, Later, with the mail filed the old way in Other.
- [ ] Labels on Boards shows ZonMw and Gezond Adviseren.
- [ ] Renaming a label, and adding one, changes the groups without a reload.
- [ ] by age (urgent first) puts the right mail in each of its seven groups.
- [ ] Folding a group survives leaving the mailbox and coming back, and appears nowhere in the mailbox's stored `splits`.
- [ ] Switching to a mode grouping and back leaves the Projects split's own folded groups intact.
- [ ] Counts forced out of step with the length make the list fall back to ungrouped and refetch, rather than empty.
- [ ] The Group menu carries the new entries and ticks the active one.
- [ ] Editing the groupings text in Settings changes the menu without a reload.
- [ ] The Copy link entry is still on a message's own menu.
- [ ] Renaming a grouping in Settings leaves the mailboxes that were using it ungrouped, and putting the name back restores them.
- [ ] `make test` passes.
