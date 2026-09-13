# Notifications page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On iPhone and iPad, Settings → Notifications becomes a page with Fastmail's four boxed choices (Off, Important messages only, All in inbox, Custom), kept by the app and sent to the push server with each registration.

**Architecture:**
- **The app** keeps a `NotificationChoice` in its own defaults (`push.mode`, `push.senders`, `push.mailboxIds`), migrated once from `push.alerts`. It registers with `notify` and `alerts`, remembers what the server accepted (`push.acknowledged`) and whether it can read contacts (`push.contacts`).
- **The bridge** gains `notificationState`, `setNotifications` and `openNotificationSettings`. The harness wraps them as `window.native.notifications` on iPhone and iPad only.
- **The userscript** takes Fastmail's `notifications` page id when that object exists. It builds the page from the Custom mode page's parts (page view, header, sections) and Fastmail's own classes (boxed `RadioGroupView`, `CopyTextView`, `ListInputView`, `MailboxMenuView`), with a fallback for the list parts. If anything fails, Fastmail's own page is handed back.

**Tech Stack:**
- Swift 6 package `FastmailShellKit` (Swift Testing), with UIKit and UserNotifications on iOS.
- `harness.js`, tested by the macOS `IntegrationTests` scheme (XCTest and WKWebView).
- The userscript, plain JavaScript on Fastmail's Overture classes, checked with live probes in the macOS app.

**Spec:** `docs/superpowers/specs/2026-09-13-device-settings-design.md`, Part 3 and the Testing section. The cross-plan contract in the drafting brief refines it; the relevant parts are copied into Global Constraints below.

## Global Constraints

**Rules every plan carries (verbatim)**
- Commit messages end with exactly:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
  ```
- Stage only the task's own files by path; never `git add -A`, `git add .` or `git commit -a`. Other sessions commit to this repository.
- No host names of the push server and no tokens or secrets in tracked files. `Server/.env` and `Server/secrets/` are git-ignored and stay so.
- Never write Fastmail's own data or preferences: not per-mailbox `splits` or `sort`, not `notificationsMail`, `notificationsMailboxes`, `notificationsFilter` or any other Fastmail preference. Never choose an option in Fastmail's Group/Sort menu in a probe.
- `make install-*`, `make deploy`, a server redeploy and any change on the push server's host happen only with the user's go-ahead given at that time; a plan step that needs one says "ask the user" and stops there.
- Live probes run against the installed Mac app with `osascript -e 'tell application "mdbraber.com" to do JavaScript (read POSIX file "<probe path>" as «class utf8»)'` (the script is a function body that may `await` and must `return` a string; see `/Users/mdbraber/.claude/projects/-Users-mdbraber-src-fastmail-custom/memory/probing-the-mac-app-live.md`). A probe must not touch real settings or storage, must restore any patch and close any menu or modal in `finally`, and must leave the app on mail.
- The full test suite is `make test` (Swift package tests, the IntegrationTests scheme, `cd Server && npm test`, `node --check` of the userscript and the Safari extension scripts).

**Stored settings (standard `UserDefaults` of each iOS app; Personal and Work each have their own)**

| Key | Type | Default |
|---|---|---|
| `push.alerts` | Bool, legacy, read once for migration, never written | true |
| `push.mode` | String: `off`, `important`, `inbox`, `custom` | set by migration |
| `push.senders` | String: `everyone`, `contacts`, `vips` | `everyone` |
| `push.mailboxIds` | [String] | [] |
| `push.contacts` | Bool, from the last registration reply | absent = unknown |
| `push.acknowledged` | String, JSON of the last choice the server accepted | absent (replaces `push.alertsAcknowledged`) |

**Server contract (plan 2, already deployed code in `Server/`)**
- `POST /devices` body: `{ account, token, alerts?, notify? }`, `notify = { mode, senders?, mailboxIds? }`. `mailboxIds` is at most 200 non-empty strings.
- Reply 200: `{ ok: true, notify: <normalised {mode, senders, mailboxIds}>, contacts: <boolean> }`.
- The app sends both `notify` and `alerts: mode !== "off"`, so a server that predates plan 2 still gets a sensible on/off.

**App ↔ page contract**
- Bridge actions in `NativeBridge.handle`:
  - `notificationState` → reply value `{ mode, senders, mailboxIds, permission, pushToken, contacts }`. `permission` is `"allowed"`, `"denied"` or `"undetermined"`. `pushToken` is the lowercase hex device token or null. `contacts` is true, false or null.
  - `setNotifications` with payload `{ mode, senders, mailboxIds }` saves and re-registers. The reply value is the saved choice.
  - `openNotificationSettings` opens the app's page in the iOS Settings app.
- The harness defines, on iPhone and iPad only (not under the `Electron/` user agent), `window.native.notifications = { state(), set(choice), openSettings() }`. `state()` and `set()` return promises of the reply values above.
- The userscript registers its Notifications page under Fastmail's `notifications` view id only when `window.native && window.native.notifications` exists.

**Plan 1 names this plan may rely on:** `DevicePreferences` and `SettingsPresenter.shared.open()`. Plan 1 has removed `MobileSettingsSheet`, the Settings bundles, `tools/gen-settings-bundle.py` and `SettingsBundleTests.swift`. This plan uses no other plan 1 name.

**Copy (exact strings)**
- Choices:
  - "Off" — "Don't show a notification for any message on this device."
  - "Important messages only" — "Show a notification for messages from your VIP contacts, and replies to conversations you are following."
  - "All in inbox" — "Show a notification for everything that arrives in your inbox."
  - "Custom" — "Choose senders and labels to notify for."
- Heading: "New messages".
- Custom's controls: "Notify for messages from" (Everyone, Contacts, VIPs); "Labels"; "Add label".
- Warnings:
  - "Notifications are turned off for this app in iOS Settings.", with the button "Open Settings"
  - "The push server cannot read your contacts, so VIPs and contacts get no notifications."
- Push id: "The push id for your device is " followed by the first 8 characters of the token, with a copy button that copies the whole token.
- No sound select and no Calendar alerts section.

**Workflow**
- `make test` passes at the end of every task. An integration-test crash inside AppKit's `NSWindowStackController` ("expected no items") is a known intermittent fault: re-run once and say so.
- Swift code under `#if canImport(UIKit)` is not compiled by `make test`, which builds for macOS. Every task that touches it also runs the iOS build check:
  ```bash
  cd /Users/mdbraber/src/fastmail-custom && make generate && xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'generic/platform=iOS' -configuration Debug -derivedDataPath build/ios-app CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
  ```
  Expected: `** BUILD SUCCEEDED **`. This builds only; it installs nothing.

## Verified facts

These were measured on 2026-09-13 with read-only probes in the running `mdbraber.com` app. The probes fetched Fastmail's module text for both the desktop and the mobile build. Once, they asked Fastmail's own loader for its Notifications module, which Fastmail itself does when that page is opened. Task 5 re-measures every fact the code depends on, and stops the plan if one has changed.

**Fastmail's Settings controller** (`FastMail.router.getAppController('settings')`, a `HierarchyController`):
- `register(id, builder)` is `this._registeredViews[id] = builder`, on the prototype, not an own property.
- `makeViewInstance(id, state, parent)`:
  - With a builder for the id, it calls `builder(state, controller, parent)`. A returned `View` is used at once; a returned promise is awaited.
  - With no builder, it calls `this.getModuleForViewId(id).then(() => (0, _registeredViews[id])(…))`. So the builder is read after the module loads, and the builder that is registered at that moment wins.
- `getModuleForViewId('notifications')` imports `settings-notifications.mod.js`. That module ends with `F.register("notifications", …)`.
- `go(id, viewState)` reuses a stack entry with the same id and an equal view state. A different view state (for example `{ nonce: Math.random() }`) builds a new instance.
- `controller.get('viewId')` names the page on top of the stack, for example `'theme'`.
- Before the Notifications module loaded, `_registeredViews` held only `notadmin`, `theme` and `custommode`.

**Classes** (`FastMail.classes`, desktop build):
- With mail open these are all reachable: `RadioGroupView`, `CopyTextView`, `MailboxMenuView`, `MenuButtonView`, `PopOverView`, `HierarchyPaneView`, `SubscreenSelectView`, `SelectView`, `PushSelectView`, `ButtonView`, `View`, `PageView`, `PageHeaderView`, `SettingsPaneView`.
- `ListInputView` was not reachable before `getModuleForViewId('notifications')` resolved, and was reachable after.
- On the mobile build, `settings.mod.js` does not import `ListInputView`, `MailboxMenuView`, `RadioGroupView`, `CopyTextView` or `platform.mod.js` (which holds `SubscreenSelectView`) statically. `settings-notifications.mod.js` imports all of them. So the page loads that module before it draws.

**Fastmail's Notifications page, mobile build** (`settings-notifications.mod.js`):
- The page is `new PageView({ isTitleFromH1s: true, title, url: "notifications", isImmortal: false, header: new PageHeaderView({ showBack: bind(controller, "isWithSidebar", not) }), content: [pane] })`.
- Each part sits in a section `el("div.u-p-6 u-space-y-5", [...])`. The choices use the same two-column layout as the userscript's `settingsSection`: `div.u-flex.u-flex-wrap.u-mx-n6.u-my-n4` with the `h1` on the left.
- The choices are `new RadioGroupView({ type: "v-RadioGroup--boxed", value, options: [{ label: J(icon, title, description), value }] })`, with no `label` inside the app.
  - `J` is `RadioGroupView.mod.js`'s own export and is not reachable from the page.
  - It draws `div.u-py-1.u-flex.u-flex-col.u-space-y-3` > [`p.u-flex.u-space-x-2.u-items-center` > [icon with `+class "u-sq-24 u-my-n4"`, `div.u-flex-1.u-trim` > title], `div.u-flex.u-space-x-2` > [`span.u-sq-24.u-my-n4`, `p.u-flex-1.u-trim.u-color-unimportant` > description]].
- A DOM node given as an option's `label` is drawn as is: `drawLabel` returns a non-string label unchanged. A render check gave `fieldset.v-RadioGroup.v-RadioGroup--boxed > div.v-RadioGroup-options > label.v-RadioGroup-option[.is-checked] > [input.v-RadioGroup-input, div.v-RadioGroup-icon, div.v-RadioGroup-text > label node]`.
- The "who" select is `platform.mod.js`'s `P`: `SubscreenSelectView` on mobile, which pushes the options as a page of their own. It takes `{ label, options: [{label, value}], value, userDidInput }`.
- The mailbox list is `ListInputView` with these instance overrides:
  - `label`, `mapValueToItems`, `mapItemsToValue`, `drawItemContent: item => el("p.u-trim.u-flex-1", [pathName])`
  - `drawAddInput() { return el("p", [new MenuButtonView({ type: "v-Button--standard v-Button--sizeM", label, popOverView, popOverOptions: { positionToThe: "right", alignEdge: "middle", showCallout: true }, menuView: new MailboxMenuView({ accountId, didSelect(mailbox) { list.addItem(mailbox) } }) })]) }`
  - `addItem(mailbox)`, which pushes and then calls `setValueFromItems()`
- `ListInputView`:
  - Its prototype has `mapValueToItems`, `mapItemsToValue`, `drawItemIcon`, `drawItemContent`, `drawItemControl` (a remove button), `drawAddInput`, `setItemsFromValue`, `setValueFromItems`, `removeItem`, `userDidInput(v) { this.set("value", v) }` and `valueDidChange`.
  - `init` calls `setItemsFromValue()` after mixing in the constructor's options, so instance overrides apply.
  - `valueDidChange` ignores a value equal to the old one, and any change made while `_settingFromInput` is true.
  - `_items` is an observable array with `some`, `get('length')` and `replaceObjectsAt(index, count, items)`.
- `MailboxMenuView` takes `accountId`, `rolesVisible` (a map from `inheritedRole || "none"` to true) and `didSelect`. It offers "create" only with `willAdd`.
- `MenuButtonView`'s default `popOverView` is a computed property that makes a new `PopOverView`.
- `CopyTextView`:
  - It draws `toCopy` and copies `get("text")`.
  - A `text` given to the constructor overrides the computed one: `new CopyTextView({ toCopy: 'abcd1234', text: 'abcd1234efgh5678', label: null })` answered `get('text') === 'abcd1234efgh5678'`, with className `v-CopyText u-whitespace-nowrap` when given `type: 'u-whitespace-nowrap'`.
  - Fastmail's page uses `{ layerTag: "b", type: "u-whitespace-nowrap", toCopy: deviceId, label: null }` inside `p.u-trim.u-text-sm.u-color-unimportant`.
- The warning banner helper (mobile `main.mod.js`, not reachable) draws:
  - `div.u-banner.u-p-3.u-flex.u-items-baseline.u-space-x-2` with className `u-banner--warning`
  - inside it `div.u-self-start.u-sq-24.u-m-n0_5`, then `div.u-flex-1` > `div.u-flex.u-flex-wrap.u-items-center.u-space-wrap-2` > [`div.u-banner-content.u-py-1.u-flex-1` > `h3.u-relative.u-trim.u-font-semibold` > [attention icon with `+class "u-banner-icon u-sq-24 u-my-n0_5"`, title], button]
  - The attention icon carries `v-Icon i-attention`.
- Icon markup, from `Cancelled.mod.js`, `VIP.mod.js`, `Inbox.mod.js`, the gear inside `settings-notifications.mod.js` and the attention glyph in `main.mod.js`, is copied verbatim into `NOTIFICATION_GLYPHS` in Task 7. Each icon function adds `v-Icon i-<name>` and `role="presentation"`.

**Fastmail's own notification preferences:**
- They live in `FastMail.localPrefs`: `get('notificationsMail')` answered `"off"`, `notificationsMailboxes` null, `notificationsFilter` `""`.
- They are stored in `localStorage` keys such as `preferences:<id>.notificationsMail`. `FastMail.preferences` and `FastMail.userPrefs` answer nothing for these keys.

**Labels:**
- `FastMail.auth.get('primaryAccounts')['urn:ietf:params:jmap:mail']` is a string.
- That account's mailboxes: 50 in all, 41 without a role, and one Inbox with a string `id` and `pathName` `"Inbox"`.
- The roles seen were `archive`, `drafts`, `inbox`, `junk`, `memos`, `scheduled`, `sent`, `snoozed` and `trash`.

**Overture:**
- `View.prototype.viewNeedsRedraw` exists and is already used by the userscript (`groupingsSection`).
- `ButtonView` takes `{ type, label, target, method }`; the userscript's pattern is `target: { go: fn }, method: 'go'`.

**Desktop vs mobile:**
- In the Mac app the Settings controller has no `__meta__.bindings.isWithSidebar`, and `FastMail.isMobile` is false. So the Mac live check draws `SelectView` and no header, which is the userscript's established desktop test.

**The repository:**
- `BridgeReply.value` is `String?`, and `WKScriptMessageHandlerWithReply` hands it to the page as a string. So the object replies travel as JSON text, and the harness parses them.
- `post()` in `harness.js` resolves `null` when the handler is missing or the reply is an error.
- The deployment target is iOS 17.0 (`project.yml`, `Package.swift`). `UIApplication.openNotificationSettingsURLString` exists from iOS 16, so no availability check is needed. `openSettingsURLString` is the fallback only if a URL cannot be made.
- `PushRegistrar` re-registers today from a `UserDefaults.didChangeNotification` observer. `send()` reads `PushPreferences.alertsEnabled()`, and `PushConfig.registration(account:deviceToken:alerts:)` builds the body `{account, token, alerts}`.

## File Structure

- **Create** `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationChoice.swift`: the choice model, payload parsing and JSON. (Task 1)
- **Create** `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationState.swift`: what `notificationState` answers, and the permission mapping. (Task 1)
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/PushPreferences.swift`: the choice in defaults, migration, acknowledgement and the contacts flag. (Task 2)
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/PushConfig.swift`: token hex, a registration carrying `notify`, and the reply's contacts flag. (Task 2)
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/PushRegistrar.swift`: migration at launch, registering the choice, `pushTokenHex` and `choiceChanged()`. (Task 2)
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`: the three actions. (Task 3)
- **Create** `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationSettings.swift`: the iOS glue (permission read, save plus register, open Settings). (Task 3)
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`: wiring the three actions. (Task 3)
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`: `window.native.notifications`. (Task 4)
- **Tests:**
  - create `NotificationChoiceTests.swift` and `NotificationStateTests.swift` (Task 1)
  - rewrite `PushPreferencesTests.swift` and modify `PushConfigTests.swift` (Task 2)
  - modify `NativeBridgeTests.swift` (Task 3), all under `Packages/FastmailShellKit/Tests/FastmailShellKitTests/`
  - modify `Tests/IntegrationTests/HarnessTests.swift` (Task 4)
- **Modify** `Userscript/fastmail-custom-mode.user.js`: the refactor for a second page (Task 6), then the Notifications page block and its two call sites (Task 7).
- **Scratch, never committed:** probes and generators in `$SCRATCH`, which is `/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad`. They are `probe-notifications-measure.js` (Task 5), `gen-refactor-probe.py` (Task 6) and `gen-notifications-probe.py` (Tasks 7 and 8).

Order is load-bearing:
- The app side (Tasks 1-3) lands before the harness exposes it (Task 4).
- The harness lands before the userscript can see it on a device (Task 7).
- Task 5 measures before any userscript code is written.
- Until Task 7, the userscript does nothing new, and Fastmail's own page stays everywhere.

---

### Task 1: The choice and the state the page is given

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationChoice.swift`
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationState.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NotificationChoiceTests.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NotificationStateTests.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `public struct NotificationChoice: Equatable, Sendable, Codable`, which has:
    - `enum Mode: String { off, important, inbox, custom }` and `enum Senders: String { everyone, contacts, vips }`
    - `static let maxMailboxIds = 200`
    - `var mode: Mode`, `var senders: Senders`, `var mailboxIds: [String]`
    - `init(mode:senders: = .everyone, mailboxIds: = [])`, which drops blanks and repeats and keeps at most 200
    - `var jsonObject: [String: Any]` (keys `mode`, `senders`, `mailboxIds`) and `var json: String` (sorted keys)
    - `struct Invalid: Error, Equatable { let message: String }`, whose message starts with the field name
    - `static func parse(_ payload: [String: Any]) -> Result<NotificationChoice, Invalid>`
    - `static func jsonText(_ object: [String: Any]) -> String`
  - `public struct NotificationState: Equatable, Sendable`, which has:
    - `enum Permission: String { allowed, denied, undetermined }` with `init(status: UNAuthorizationStatus)`
    - `let choice: NotificationChoice`, `let permission: Permission`, `let pushToken: String?`, `let contacts: Bool?`
    - `init(choice:permission:pushToken:contacts:)`
    - `var jsonObject: [String: Any]` (the three choice keys plus `permission`, `pushToken`, `contacts`, with nil as JSON null) and `var json: String`

- [ ] **Step 1: Write the failing tests**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NotificationChoiceTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

@Test func aChoiceDefaultsToEveryoneAndNoLabels() {
    let choice = NotificationChoice(mode: .inbox)
    #expect(choice.senders == .everyone)
    #expect(choice.mailboxIds == [])
}

// The server refuses an empty id and a list over 200, so the app never keeps one
@Test func labelsAreKeptInOrderWithoutBlanksOrRepeats() {
    let choice = NotificationChoice(mode: .custom, mailboxIds: ["P2F", "", "P3V", "P2F"])
    #expect(choice.mailboxIds == ["P2F", "P3V"])
}

@Test func noMoreThanTwoHundredLabelsAreKept() {
    let ids = (0..<250).map { "M\($0)" }
    #expect(NotificationChoice(mode: .custom, mailboxIds: ids).mailboxIds.count == 200)
}

@Test func thePagesPayloadParses() throws {
    let parsed = try NotificationChoice.parse([
        "mode": "custom", "senders": "vips", "mailboxIds": ["P2F", "P3V"],
    ]).get()
    #expect(parsed == NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["P2F", "P3V"]))
}

@Test func aPayloadWithOnlyAModeTakesTheDefaults() throws {
    #expect(try NotificationChoice.parse(["mode": "off"]).get() == NotificationChoice(mode: .off))
    let nulls: [String: Any] = ["mode": "important", "senders": NSNull(), "mailboxIds": NSNull()]
    #expect(try NotificationChoice.parse(nulls).get() == NotificationChoice(mode: .important))
}

// Each refusal names its field, the way the push server's 400 does
@Test func eachBadFieldIsRefusedByName() {
    func message(_ payload: [String: Any]) -> String? {
        if case .failure(let invalid) = NotificationChoice.parse(payload) { return invalid.message }
        return nil
    }
    #expect(message([:])?.hasPrefix("mode") == true)
    #expect(message(["mode": "loud"])?.hasPrefix("mode") == true)
    #expect(message(["mode": NSNumber(value: 1)])?.hasPrefix("mode") == true)
    #expect(message(["mode": "custom", "senders": "friends"])?.hasPrefix("senders") == true)
    #expect(message(["mode": "custom", "mailboxIds": "P2F"])?.hasPrefix("mailboxIds") == true)
    #expect(message(["mode": "custom", "mailboxIds": ["P2F", ""]])?.hasPrefix("mailboxIds") == true)
    #expect(message(["mode": "custom", "mailboxIds": ["P2F", NSNumber(value: 3)] as [Any]])?.hasPrefix("mailboxIds") == true)
    #expect(message(["mode": "custom", "mailboxIds": (0..<201).map { "M\($0)" }])?.hasPrefix("mailboxIds") == true)
}

@Test func theJSONObjectCarriesAllThreeFields() {
    let object = NotificationChoice(mode: .custom, senders: .contacts, mailboxIds: ["P2F"]).jsonObject
    #expect(object["mode"] as? String == "custom")
    #expect(object["senders"] as? String == "contacts")
    #expect(object["mailboxIds"] as? [String] == ["P2F"])
    #expect(object.count == 3)
}

@Test func theJSONTextIsSortedAndComplete() {
    let text = NotificationChoice(mode: .inbox).json
    #expect(text == #"{"mailboxIds":[],"mode":"inbox","senders":"everyone"}"#)
}

@Test func aChoiceSurvivesCodable() throws {
    let choice = NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["A", "B"])
    let data = try JSONEncoder().encode(choice)
    #expect(try JSONDecoder().decode(NotificationChoice.self, from: data) == choice)
}
```

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NotificationStateTests.swift`:

```swift
import Foundation
import Testing
import UserNotifications
@testable import FastmailShellKit

// Provisional delivery still reaches the device, so only a refusal and a
// question not yet asked read as something else
@Test func thePermissionReadsAsThePageNamesIt() {
    #expect(NotificationState.Permission(status: .authorized) == .allowed)
    #expect(NotificationState.Permission(status: .provisional) == .allowed)
    #expect(NotificationState.Permission(status: .denied) == .denied)
    #expect(NotificationState.Permission(status: .notDetermined) == .undetermined)
}

@Test func theStateAnswersWithEveryField() throws {
    let state = NotificationState(
        choice: NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["P2F"]),
        permission: .denied,
        pushToken: "00abff",
        contacts: false
    )
    let object = try #require(JSONSerialization.jsonObject(with: Data(state.json.utf8)) as? [String: Any])
    #expect(object["mode"] as? String == "custom")
    #expect(object["senders"] as? String == "vips")
    #expect(object["mailboxIds"] as? [String] == ["P2F"])
    #expect(object["permission"] as? String == "denied")
    #expect(object["pushToken"] as? String == "00abff")
    #expect(object["contacts"] as? Bool == false)
    #expect(object.count == 6)
}

// Unknown is null, never false: false would raise the contacts warning
@Test func anUnknownTokenAndContactsFlagAnswerAsNull() throws {
    let state = NotificationState(
        choice: NotificationChoice(mode: .inbox), permission: .allowed, pushToken: nil, contacts: nil
    )
    let object = try #require(JSONSerialization.jsonObject(with: Data(state.json.utf8)) as? [String: Any])
    #expect(object["pushToken"] is NSNull)
    #expect(object["contacts"] is NSNull)
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -20`
Expected: the build fails with `cannot find 'NotificationChoice' in scope` and `cannot find 'NotificationState' in scope`.

- [ ] **Step 3: Write the choice**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationChoice.swift`:

```swift
import Foundation

/// What this device wants to hear about new mail: the Notifications page's
/// four boxed choices, and for Custom the senders and labels. The names are
/// the ones the page sends and the push server's `notify` takes.
public struct NotificationChoice: Equatable, Sendable, Codable {
    public enum Mode: String, Codable, Sendable, CaseIterable {
        case off, important, inbox, custom
    }

    public enum Senders: String, Codable, Sendable, CaseIterable {
        case everyone, contacts, vips
    }

    /// The push server refuses a longer list.
    public static let maxMailboxIds = 200

    public var mode: Mode
    public var senders: Senders
    public var mailboxIds: [String]

    public init(mode: Mode, senders: Senders = .everyone, mailboxIds: [String] = []) {
        self.mode = mode
        self.senders = senders
        self.mailboxIds = Self.cleaned(mailboxIds)
    }

    /// In order, without blanks or repeats, and no longer than the server takes.
    static func cleaned(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        let kept = ids.filter { !$0.isEmpty && seen.insert($0).inserted }
        return Array(kept.prefix(maxMailboxIds))
    }

    /// The fields as the page reads them and the server's `notify` takes them.
    public var jsonObject: [String: Any] {
        ["mode": mode.rawValue, "senders": senders.rawValue, "mailboxIds": mailboxIds]
    }

    public var json: String { Self.jsonText(jsonObject) }

    /// Sorted, so the same object always reads the same.
    static func jsonText(_ object: [String: Any]) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
            let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }

    /// Why a payload was refused; the message starts with the field's name.
    public struct Invalid: Error, Equatable {
        public let message: String
    }

    /// A choice sent by the page. Only `mode` is required; a missing or null
    /// `senders` is everyone and a missing or null `mailboxIds` is none.
    public static func parse(_ payload: [String: Any]) -> Result<NotificationChoice, Invalid> {
        guard let rawMode = payload["mode"] as? String, let mode = Mode(rawValue: rawMode) else {
            return .failure(Invalid(message: "mode must be off, important, inbox or custom"))
        }

        var senders = Senders.everyone
        if let value = payload["senders"], !(value is NSNull) {
            guard let raw = value as? String, let parsed = Senders(rawValue: raw) else {
                return .failure(Invalid(message: "senders must be everyone, contacts or vips"))
            }
            senders = parsed
        }

        var ids: [String] = []
        if let value = payload["mailboxIds"], !(value is NSNull) {
            guard let list = value as? [Any], list.count <= maxMailboxIds else {
                return .failure(Invalid(message: "mailboxIds must be a list of at most \(maxMailboxIds) labels"))
            }
            for item in list {
                guard let id = item as? String, !id.isEmpty else {
                    return .failure(Invalid(message: "mailboxIds must hold only non-empty strings"))
                }
                ids.append(id)
            }
        }

        return .success(NotificationChoice(mode: mode, senders: senders, mailboxIds: ids))
    }
}
```

- [ ] **Step 4: Write the state**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationState.swift`:

```swift
import Foundation
import UserNotifications

/// Everything the Notifications page draws from, as the `notificationState`
/// bridge action answers it.
public struct NotificationState: Equatable, Sendable {
    public enum Permission: String, Sendable {
        case allowed, denied, undetermined

        /// Provisional and ephemeral delivery still reach the device, so they
        /// count as allowed.
        public init(status: UNAuthorizationStatus) {
            switch status {
            case .denied: self = .denied
            case .notDetermined: self = .undetermined
            default: self = .allowed
            }
        }
    }

    public let choice: NotificationChoice
    public let permission: Permission
    /// Apple's device token in lowercase hex, or nothing while the app has none.
    public let pushToken: String?
    /// Whether the push server can read the account's contacts, or nothing
    /// while no registration reply has said.
    public let contacts: Bool?

    public init(choice: NotificationChoice, permission: Permission, pushToken: String?, contacts: Bool?) {
        self.choice = choice
        self.permission = permission
        self.pushToken = pushToken
        self.contacts = contacts
    }

    public var jsonObject: [String: Any] {
        var object = choice.jsonObject
        object["permission"] = permission.rawValue
        object["pushToken"] = pushToken.map { $0 as Any } ?? NSNull()
        object["contacts"] = contacts.map { $0 as Any } ?? NSNull()
        return object
    }

    public var json: String { NotificationChoice.jsonText(jsonObject) }
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -20`
Expected: every test passes, including the 12 new ones.

- [ ] **Step 6: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationChoice.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationState.swift \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/NotificationChoiceTests.swift \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/NotificationStateTests.swift
git commit -m "$(cat <<'EOF'
feat: a notification choice and the state the Notifications page is given

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
)"
```

---

### Task 2: The choice is kept, migrated and registered

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/PushPreferences.swift` (whole file)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/PushConfig.swift:36-47`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/PushRegistrar.swift:19-38`, `:114-178`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushPreferencesTests.swift` (whole file)
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushConfigTests.swift:37-59`

**Interfaces:**
- Consumes (Task 1): `NotificationChoice`, `NotificationChoice.Mode`, `NotificationChoice.Senders`, `NotificationChoice.jsonObject`.
- Produces:
  - `PushPreferences`, with:
    - `modeKey = "push.mode"`, `sendersKey = "push.senders"`, `mailboxIdsKey = "push.mailboxIds"`, `contactsKey = "push.contacts"`
    - internal `acknowledgedKey = "push.acknowledged"`, `legacyAlertsKey = "push.alerts"`, `legacyAcknowledgedKey = "push.alertsAcknowledged"`
    - `migrate(in:)`, `choice(in:) -> NotificationChoice`, `save(_:in:)`, `contacts(in:) -> Bool?`, `registrationDue(in:) -> Bool` and `acknowledge(_ choice:contacts:in:)`
    - every `in:` parameter is a `UserDefaults` defaulting to `.standard`
  - `PushConfig`, with:
    - `static func hex(_ token: Data) -> String`
    - `func registration(account: String, deviceToken: Data, choice: NotificationChoice = NotificationChoice(mode: .inbox)) -> URLRequest`
    - `static func contacts(fromRegistrationReply data: Data) -> Bool?`
  - `PushRegistrar` (iOS), with `public var pushTokenHex: String?` and `public func choiceChanged()`
- Removed: `PushPreferences.alertsKey`, `alertsEnabled(in:)` and `acknowledge(alerts:in:)`, plus the `alerts:` parameter of `registration`.

- [ ] **Step 1: Confirm nothing else still reads the old switch**

Run:
```bash
cd /Users/mdbraber/src/fastmail-custom && grep -rn "alertsKey\|alertsEnabled\|acknowledge(alerts\|registration(account:.*alerts:" --include='*.swift' Packages Apps Tests; ls tools/gen-settings-bundle.py Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift 2>&1
```
Expected:
- The grep matches only `PushPreferences.swift`, `PushPreferencesTests.swift`, `PushRegistrar.swift` and `PushConfigTests.swift`.
- Both `ls` lines say `No such file or directory`.

If anything else matches (`SettingsBundleTests.swift`, `SettingsUI.swift`, `MobileSettingsSheet`), plan 1 is not complete. Stop and ask the user.

- [ ] **Step 2: Write the failing preference tests**

Replace the whole of `Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushPreferencesTests.swift` with:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

private func fresh() -> UserDefaults {
    let name = "push-preferences-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
}

@Test func aDeviceThatNeverChoseGetsInboxAlerts() {
    #expect(PushPreferences.choice(in: fresh()) == NotificationChoice(mode: .inbox))
}

// The old switch is read once: off becomes Off, on or never touched becomes
// All in inbox, and a choice already made is left alone
@Test func theOldSwitchSeedsTheChoiceOnce() {
    let off = fresh()
    off.set(false, forKey: "push.alerts")
    off.set(false, forKey: "push.alertsAcknowledged")
    PushPreferences.migrate(in: off)
    #expect(off.string(forKey: "push.mode") == "off")
    #expect(off.object(forKey: "push.alertsAcknowledged") == nil)
    #expect(off.object(forKey: "push.alerts") as? Bool == false, "read, not rewritten")

    let on = fresh()
    on.set(true, forKey: "push.alerts")
    PushPreferences.migrate(in: on)
    #expect(on.string(forKey: "push.mode") == "inbox")

    let never = fresh()
    PushPreferences.migrate(in: never)
    #expect(never.string(forKey: "push.mode") == "inbox")

    let chosen = fresh()
    chosen.set("custom", forKey: "push.mode")
    chosen.set(false, forKey: "push.alerts")
    PushPreferences.migrate(in: chosen)
    #expect(chosen.string(forKey: "push.mode") == "custom")
}

@Test func aSavedChoiceReadsBack() {
    let defaults = fresh()
    let choice = NotificationChoice(mode: .custom, senders: .contacts, mailboxIds: ["P2F", "P3V"])
    PushPreferences.save(choice, in: defaults)
    #expect(PushPreferences.choice(in: defaults) == choice)
    #expect(defaults.string(forKey: "push.mode") == "custom")
    #expect(defaults.string(forKey: "push.senders") == "contacts")
    #expect(defaults.stringArray(forKey: "push.mailboxIds") == ["P2F", "P3V"])
}

@Test func storedNonsenseReadsAsTheDefaults() {
    let defaults = fresh()
    defaults.set("loud", forKey: "push.mode")
    defaults.set("friends", forKey: "push.senders")
    defaults.set(["", "P2F", "P2F"], forKey: "push.mailboxIds")
    #expect(PushPreferences.choice(in: defaults) == NotificationChoice(mode: .inbox, senders: .everyone, mailboxIds: ["P2F"]))
}

// The server learns the choice only through a registration, so the app
// remembers the choice the server accepted and registers again on a difference
@Test func aRegistrationIsDueUntilTheServerAcceptedTheChoiceAsItStands() {
    let defaults = fresh()
    #expect(PushPreferences.registrationDue(in: defaults) == true, "nothing acknowledged yet")

    let inbox = NotificationChoice(mode: .inbox)
    PushPreferences.save(inbox, in: defaults)
    PushPreferences.acknowledge(inbox, contacts: true, in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == false)

    let custom = NotificationChoice(mode: .custom, mailboxIds: ["P2F"])
    PushPreferences.save(custom, in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == true)

    PushPreferences.acknowledge(custom, contacts: true, in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == false)

    PushPreferences.save(NotificationChoice(mode: .custom, mailboxIds: ["P2F", "P3V"]), in: defaults)
    #expect(PushPreferences.registrationDue(in: defaults) == true, "a label added is a change")

    defaults.set("not json", forKey: "push.acknowledged")
    #expect(PushPreferences.registrationDue(in: defaults) == true, "an unreadable acknowledgement is none")
}

@Test func theContactsFlagFollowsTheLastReply() {
    let defaults = fresh()
    let inbox = NotificationChoice(mode: .inbox)
    #expect(PushPreferences.contacts(in: defaults) == nil)
    PushPreferences.acknowledge(inbox, contacts: false, in: defaults)
    #expect(PushPreferences.contacts(in: defaults) == false)
    PushPreferences.acknowledge(inbox, contacts: true, in: defaults)
    #expect(PushPreferences.contacts(in: defaults) == true)
    PushPreferences.acknowledge(inbox, contacts: nil, in: defaults)
    #expect(PushPreferences.contacts(in: defaults) == nil, "a reply without the flag makes it unknown again")
}
```

- [ ] **Step 3: Write the failing registration tests**

In `Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushConfigTests.swift`, replace the two tests `theRegistrationPostsTheHexTokenWithTheSecret` and `theRegistrationCarriesTheAlertsSwitch` (lines 37-59) with:

```swift
@Test func theRegistrationPostsTheHexTokenWithTheSecret() throws {
    let config = try #require(PushConfig(host: "push.example.net/base", secret: "s3cret"))
    let request = config.registration(account: "work", deviceToken: Data([0x00, 0xAB, 0xFF]))
    #expect(request.url?.absoluteString == "https://push.example.net/base/devices")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer s3cret")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let body = try #require(request.httpBody)
    let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
    #expect(json["account"] as? String == "work")
    #expect(json["token"] as? String == "00abff")
    #expect(json["alerts"] as? Bool == true, "inbox alerts unless the app says otherwise")
    let notify = try #require(json["notify"] as? [String: Any])
    #expect(notify["mode"] as? String == "inbox")
    #expect(notify["senders"] as? String == "everyone")
    #expect(notify["mailboxIds"] as? [String] == [])
    #expect(json.count == 4)
}

// notify is the choice; alerts says the same as on or off, for a server that
// predates notify and reads only alerts
@Test func theRegistrationCarriesTheChoiceAndItsOnOffForOlderServers() throws {
    let config = try #require(PushConfig(host: "push.example.net", secret: "s3cret"))

    let off = config.registration(account: "personal", deviceToken: Data([0x01]), choice: NotificationChoice(mode: .off))
    let offBody = try #require(off.httpBody)
    let offJSON = try #require(JSONSerialization.jsonObject(with: offBody) as? [String: Any])
    #expect(offJSON["alerts"] as? Bool == false)
    #expect((offJSON["notify"] as? [String: Any])?["mode"] as? String == "off")
    #expect(offJSON["token"] as? String == "01")

    let custom = config.registration(
        account: "personal", deviceToken: Data([0x01]),
        choice: NotificationChoice(mode: .custom, senders: .vips, mailboxIds: ["P2F", "P3V"])
    )
    let customBody = try #require(custom.httpBody)
    let customJSON = try #require(JSONSerialization.jsonObject(with: customBody) as? [String: Any])
    #expect(customJSON["alerts"] as? Bool == true)
    let notify = try #require(customJSON["notify"] as? [String: Any])
    #expect(notify["mode"] as? String == "custom")
    #expect(notify["senders"] as? String == "vips")
    #expect(notify["mailboxIds"] as? [String] == ["P2F", "P3V"])
}

@Test func theTokenIsLowercaseHex() {
    #expect(PushConfig.hex(Data([0x00, 0xAB, 0xFF])) == "00abff")
    #expect(PushConfig.hex(Data()) == "")
}

@Test func theContactsFlagIsReadFromTheRegistrationReply() {
    func read(_ text: String) -> Bool? { PushConfig.contacts(fromRegistrationReply: Data(text.utf8)) }
    #expect(read(#"{"ok":true,"notify":{"mode":"inbox","senders":"everyone","mailboxIds":[]},"contacts":true}"#) == true)
    #expect(read(#"{"ok":true,"contacts":false}"#) == false)
    #expect(read(#"{"ok":true,"alerts":true}"#) == nil, "a server from before the flag")
    #expect(read(#"{"ok":true,"contacts":1}"#) == nil, "a number is not a flag")
    #expect(read("not json") == nil)
}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -20`
Expected: the build fails. It reports that `PushPreferences` has no member `migrate`, `choice`, `save` and `contacts`, and that `PushConfig` has no member `hex` and no `choice:` argument.

- [ ] **Step 5: Write the preferences**

Replace the whole of `Packages/FastmailShellKit/Sources/FastmailShellKit/PushPreferences.swift` with:

```swift
import Foundation

/// This device's notification choice: one of the Notifications page's four
/// boxed options, and for Custom the senders and labels. Kept in the app's own
/// defaults, so Personal and Work each have theirs, and changed only by the
/// page, through the `setNotifications` bridge action.
public enum PushPreferences {
    public static let modeKey = "push.mode"
    public static let sendersKey = "push.senders"
    public static let mailboxIdsKey = "push.mailboxIds"
    /// What the push server's last registration reply said about reading the
    /// account's contacts; absent while no reply has said.
    public static let contactsKey = "push.contacts"
    /// The choice the push server last accepted, as JSON.
    static let acknowledgedKey = "push.acknowledged"
    /// The on/off switch the shell had before the page. Read once, to seed the
    /// choice, and never written again.
    static let legacyAlertsKey = "push.alerts"
    static let legacyAcknowledgedKey = "push.alertsAcknowledged"

    /// Run at launch: a device that has never had a choice gets the one its
    /// old switch meant. The old acknowledgement is dropped, so the choice is
    /// registered once under its new name.
    public static func migrate(in defaults: UserDefaults = .standard) {
        guard defaults.object(forKey: modeKey) == nil else { return }
        defaults.set(legacyMode(in: defaults).rawValue, forKey: modeKey)
        defaults.removeObject(forKey: legacyAcknowledgedKey)
    }

    /// Off when the old switch was turned off; otherwise All in inbox, which
    /// is what the switch did when on.
    static func legacyMode(in defaults: UserDefaults) -> NotificationChoice.Mode {
        (defaults.object(forKey: legacyAlertsKey) as? Bool ?? true) ? .inbox : .off
    }

    /// The saved choice. A value that is not one of the known names reads as
    /// its default rather than failing.
    public static func choice(in defaults: UserDefaults = .standard) -> NotificationChoice {
        let mode = defaults.string(forKey: modeKey).flatMap(NotificationChoice.Mode.init(rawValue:))
            ?? legacyMode(in: defaults)
        let senders = defaults.string(forKey: sendersKey).flatMap(NotificationChoice.Senders.init(rawValue:))
            ?? .everyone
        let ids = defaults.array(forKey: mailboxIdsKey)?.compactMap { $0 as? String } ?? []
        return NotificationChoice(mode: mode, senders: senders, mailboxIds: ids)
    }

    /// Senders and labels are kept whatever the mode, so leaving Custom and
    /// coming back finds the list as it was.
    public static func save(_ choice: NotificationChoice, in defaults: UserDefaults = .standard) {
        defaults.set(choice.mode.rawValue, forKey: modeKey)
        defaults.set(choice.senders.rawValue, forKey: sendersKey)
        defaults.set(choice.mailboxIds, forKey: mailboxIdsKey)
    }

    public static func contacts(in defaults: UserDefaults = .standard) -> Bool? {
        defaults.object(forKey: contactsKey) as? Bool
    }

    /// Whether the server's idea of this device is stale: nothing was ever
    /// acknowledged, or the choice changed since.
    public static func registrationDue(in defaults: UserDefaults = .standard) -> Bool {
        guard
            let text = defaults.string(forKey: acknowledgedKey),
            let acknowledged = try? JSONDecoder().decode(NotificationChoice.self, from: Data(text.utf8))
        else { return true }
        return acknowledged != choice(in: defaults)
    }

    /// Called once the server accepted a registration carrying `choice`. The
    /// reply's contacts flag replaces the one kept, and a reply without one
    /// makes it unknown.
    public static func acknowledge(_ choice: NotificationChoice, contacts: Bool?, in defaults: UserDefaults = .standard) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        if let data = try? encoder.encode(choice), let text = String(data: data, encoding: .utf8) {
            defaults.set(text, forKey: acknowledgedKey)
        }
        if let contacts {
            defaults.set(contacts, forKey: contactsKey)
        } else {
            defaults.removeObject(forKey: contactsKey)
        }
    }
}
```

- [ ] **Step 6: Write the registration**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/PushConfig.swift`, replace:

```swift
    /// Registering again is also how the device changes its mind about alerts.
    public func registration(account: String, deviceToken: Data, alerts: Bool = true) -> URLRequest {
        var request = URLRequest(url: server.appendingPathComponent("devices"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        let body: [String: Any] = ["account": account, "token": token, "alerts": alerts]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request
    }
```

with:

```swift
    /// The device token as the server files it, and as the Notifications page
    /// shows it: lowercase hex.
    public static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }

    /// Registering again is also how the device changes its mind. `notify` is
    /// the choice; `alerts` says the same as on or off, for a server that
    /// predates `notify` and reads only `alerts`.
    public func registration(
        account: String,
        deviceToken: Data,
        choice: NotificationChoice = NotificationChoice(mode: .inbox)
    ) -> URLRequest {
        var request = URLRequest(url: server.appendingPathComponent("devices"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "account": account,
            "token": Self.hex(deviceToken),
            "alerts": choice.mode != .off,
            "notify": choice.jsonObject,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request
    }

    /// The `contacts` flag of a registration reply, or nothing when the reply
    /// carries no such flag (a server from before it) or is not JSON. Only a
    /// real boolean counts: a JSON 1 is a number, not a flag.
    public static func contacts(fromRegistrationReply data: Data) -> Bool? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let number = object["contacts"] as? NSNumber,
            CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID()
        else { return nil }
        return number.boolValue
    }
```

- [ ] **Step 7: Run the package tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -20`
Expected: every test passes. `PushRegistrar.swift` is iOS-only, so its old calls do not break this macOS build; Step 8 fixes them before the iOS check.

- [ ] **Step 8: Register the choice from the registrar**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/PushRegistrar.swift`, replace:

```swift
    public override init() {
        super.init()
        Self.current = self
        // The alerts switch, flipped in the sheet or in the Settings app,
        // reaches the server through a fresh registration
        NotificationCenter.default.addObserver(
            self, selector: #selector(defaultsChanged), name: UserDefaults.didChangeNotification, object: nil
        )
    }

    /// The notification's thread is not promised, so the work hops to the main
    /// actor.
    @objc private func defaultsChanged() {
        Task { @MainActor in
            // The badge label is one of these settings, and it names a shortcut
            HomeShortcuts.refresh()
            guard let registrar = PushRegistrar.current, registrar.deviceToken != nil, PushPreferences.registrationDue() else { return }
            await registrar.register()
        }
    }
```

with:

```swift
    public override init() {
        super.init()
        Self.current = self
        // The old on/off switch becomes the first choice, before anything
        // reads the choice
        PushPreferences.migrate()
        NotificationCenter.default.addObserver(
            self, selector: #selector(defaultsChanged), name: UserDefaults.didChangeNotification, object: nil
        )
    }

    /// The notification's thread is not promised, so the work hops to the main
    /// actor. A new notification choice is not handled here: the page is the
    /// only thing that changes it, and it calls `choiceChanged()`.
    @objc private func defaultsChanged() {
        Task { @MainActor in
            // The badge label is one of these settings, and it names a shortcut
            HomeShortcuts.refresh()
        }
    }
```

Then replace:

```swift
    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
```

with:

```swift
    /// Apple's device token as the push server files it, for the page's push
    /// id line; nothing while the app has none.
    public var pushTokenHex: String? {
        deviceToken.map(PushConfig.hex)
    }

    /// Called once the Notifications page has saved a choice. A choice the
    /// server already has sends nothing.
    public func choiceChanged() {
        guard deviceToken != nil, PushPreferences.registrationDue() else { return }
        Task { await register() }
    }

    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
```

Then replace:

```swift
    /// Tells the server about this device. One registration at a time: a
    /// trigger that arrives while one is out (the switch flipped again, an
    /// activation) is folded into a repeat that reads the switch afresh, so
    /// the last word the server hears is the current one.
```

with:

```swift
    /// Tells the server about this device. One registration at a time: a
    /// trigger that arrives while one is out (the choice changed again, an
    /// activation) is folded into a repeat that reads the choice afresh, so
    /// the last word the server hears is the current one.
```

Then replace:

```swift
    private func send() async {
        guard let config, let account, let deviceToken else { return }
        registrationDue = false
        let alerts = PushPreferences.alertsEnabled()
        do {
            let request = config.registration(account: account, deviceToken: deviceToken, alerts: alerts)
            let (_, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            registrationDue = !(200..<300).contains(status)
            if registrationDue { print("[push] the push server answered \(status)") } else { PushPreferences.acknowledge(alerts: alerts) }
        } catch {
```

with:

```swift
    private func send() async {
        guard let config, let account, let deviceToken else { return }
        registrationDue = false
        let choice = PushPreferences.choice()
        do {
            let request = config.registration(account: account, deviceToken: deviceToken, choice: choice)
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            registrationDue = !(200..<300).contains(status)
            if registrationDue {
                print("[push] the push server answered \(status)")
            } else {
                // What was sent is what is acknowledged; the reply says
                // whether the server can read contacts, for the page's warning
                PushPreferences.acknowledge(choice, contacts: PushConfig.contacts(fromRegistrationReply: data))
            }
        } catch {
```

- [ ] **Step 9: Build for iOS**

Run: `cd /Users/mdbraber/src/fastmail-custom && make generate && xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'generic/platform=iOS' -configuration Debug -derivedDataPath build/ios-app CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 10: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 11: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/PushPreferences.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/PushConfig.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/PushRegistrar.swift \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushPreferencesTests.swift \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushConfigTests.swift
git commit -m "$(cat <<'EOF'
feat: the app keeps a notification choice and registers it with the push server

The old alerts switch seeds the choice once. Each registration sends notify
and, for an older server, alerts; the accepted choice and the reply's
contacts flag are remembered.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
)"
```

---

### Task 3: The bridge answers the page

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift:26-64`, `:190-195`
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationSettings.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift:146-155`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift` (append)

**Interfaces:**
- Consumes (Task 1): `NotificationChoice.parse(_:)`, `NotificationChoice.json`, `NotificationState`, `NotificationState.json`, `NotificationState.Permission(status:)`.
- Consumes (Task 2): `PushPreferences.choice()`, `PushPreferences.save(_:)`, `PushPreferences.contacts()`, `PushRegistrar.current?.pushTokenHex` and `PushRegistrar.current?.choiceChanged()`.
- Produces:
  - `NativeBridge.init` gains three trailing parameters:
    - `onNotificationState: @escaping @MainActor () async -> NotificationState? = { nil }`
    - `onSetNotifications: @escaping @MainActor (NotificationChoice) -> NotificationChoice? = { _ in nil }`
    - `onOpenNotificationSettings: @escaping @MainActor () -> Void = {}`
  - Three actions:
    - `notificationState` replies with `NotificationState.json` as the reply's string value.
    - `setNotifications` replies with the saved choice's `json`, or an error starting `setNotifications: <field>`.
    - `openNotificationSettings` replies with no value.
  - `@MainActor enum NotificationSettings` (iOS only), with `static func state() async -> NotificationState`, `static func save(_ choice: NotificationChoice) -> NotificationChoice` and `static func openSystemSettings()`.

- [ ] **Step 1: Write the failing tests**

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift`:

```swift
// MARK: The Notifications page

private func replyObject(_ reply: BridgeReply) throws -> [String: Any] {
    let text = try #require(reply.value)
    return try #require(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
}

// A reply carries a string, so the state travels as JSON text the harness parses
@Test @MainActor func notificationStateAnswersTheAppsStateAsJSON() async throws {
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onNotificationState: {
            NotificationState(
                choice: NotificationChoice(mode: .important),
                permission: .undetermined, pushToken: nil, contacts: true
            )
        }
    )
    let reply = await bridge.handle(body: ["action": "notificationState", "payload": [:]])
    #expect(reply.error == nil)
    let object = try replyObject(reply)
    #expect(object["mode"] as? String == "important")
    #expect(object["permission"] as? String == "undetermined")
    #expect(object["pushToken"] is NSNull)
    #expect(object["contacts"] as? Bool == true)
}

// The Mac passes no handlers: the page never asks there, and if it did it
// would be told no rather than handed a made-up state
@Test @MainActor func withoutHandlersTheNotificationActionsAreRefused() async {
    let bridge = NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
    let state = await bridge.handle(body: ["action": "notificationState", "payload": [:]])
    let set = await bridge.handle(body: ["action": "setNotifications", "payload": ["mode": "off"]])
    #expect(state.error != nil)
    #expect(set.error != nil)
}

@Test @MainActor func setNotificationsSavesTheParsedChoiceAndAnswersWhatWasSaved() async throws {
    var saved: [NotificationChoice] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetNotifications: { choice in
            saved.append(choice)
            return choice
        }
    )
    let reply = await bridge.handle(body: [
        "action": "setNotifications",
        "payload": ["mode": "custom", "senders": "contacts", "mailboxIds": ["P2F"]],
    ])
    #expect(reply.error == nil)
    #expect(saved == [NotificationChoice(mode: .custom, senders: .contacts, mailboxIds: ["P2F"])])
    let object = try replyObject(reply)
    #expect(object["mode"] as? String == "custom")
    #expect(object["mailboxIds"] as? [String] == ["P2F"])
}

@Test @MainActor func setNotificationsRefusesABadChoiceBeforeSavingAnything() async {
    var saved = 0
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetNotifications: { choice in
            saved += 1
            return choice
        }
    )
    let payloads: [[String: Any]] = [
        [:],
        ["mode": "loud"],
        ["mode": "custom", "senders": "friends"],
        ["mode": "custom", "mailboxIds": [""]],
    ]
    for payload in payloads {
        let reply = await bridge.handle(body: ["action": "setNotifications", "payload": payload])
        #expect(reply.error?.hasPrefix("setNotifications: ") == true)
    }
    #expect(saved == 0)
}

@Test @MainActor func openNotificationSettingsReachesTheApp() async {
    var opened = 0
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onOpenNotificationSettings: { opened += 1 }
    )
    let reply = await bridge.handle(body: ["action": "openNotificationSettings", "payload": [:]])
    #expect(reply.error == nil)
    #expect(reply.value == nil)
    #expect(opened == 1)
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -20`
Expected: the build fails with `extra argument 'onNotificationState' in call` (and the same for `onSetNotifications` and `onOpenNotificationSettings`).

- [ ] **Step 3: Add the three actions to the bridge**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`, replace:

```swift
    /// Asked where to put a message, and answers where it put it; so a page
    /// told "inline" knows to go ahead and open one itself.
    private let onCompose: @MainActor (String) -> String
```

with:

```swift
    /// Asked where to put a message, and answers where it put it; so a page
    /// told "inline" knows to go ahead and open one itself.
    private let onCompose: @MainActor (String) -> String
    /// What the Notifications page draws from; nothing where there is no such
    /// page, which is the Mac.
    private let onNotificationState: @MainActor () async -> NotificationState?
    /// Keeps a choice the page made and registers it; answers the choice as
    /// saved, or nothing where there is no such page.
    private let onSetNotifications: @MainActor (NotificationChoice) -> NotificationChoice?
    private let onOpenNotificationSettings: @MainActor () -> Void
```

Replace:

```swift
        onCompose: @escaping @MainActor (String) -> String = { _ in ComposeMode.inline.rawValue }
    ) {
```

with:

```swift
        onCompose: @escaping @MainActor (String) -> String = { _ in ComposeMode.inline.rawValue },
        onNotificationState: @escaping @MainActor () async -> NotificationState? = { nil },
        onSetNotifications: @escaping @MainActor (NotificationChoice) -> NotificationChoice? = { _ in nil },
        onOpenNotificationSettings: @escaping @MainActor () -> Void = {}
    ) {
```

Replace:

```swift
        self.onCompose = onCompose
    }
```

with:

```swift
        self.onCompose = onCompose
        self.onNotificationState = onNotificationState
        self.onSetNotifications = onSetNotifications
        self.onOpenNotificationSettings = onOpenNotificationSettings
    }
```

Replace:

```swift
        case "showWindow":
            onShowWindow()
            return BridgeReply(value: nil, error: nil)
        default:
```

with:

```swift
        case "showWindow":
            onShowWindow()
            return BridgeReply(value: nil, error: nil)
        case "notificationState":
            guard let state = await onNotificationState() else {
                return BridgeReply(value: nil, error: "notification settings are not available here")
            }
            // Text rather than an object: a reply's value is a string, and
            // the harness parses it
            return BridgeReply(value: state.json, error: nil)
        case "setNotifications":
            switch NotificationChoice.parse(payload) {
            case .failure(let invalid):
                return BridgeReply(value: nil, error: "setNotifications: \(invalid.message)")
            case .success(let choice):
                guard let saved = onSetNotifications(choice) else {
                    return BridgeReply(value: nil, error: "notification settings are not available here")
                }
                return BridgeReply(value: saved.json, error: nil)
            }
        case "openNotificationSettings":
            onOpenNotificationSettings()
            return BridgeReply(value: nil, error: nil)
        default:
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -20`
Expected: every test passes, including the 5 new ones.

- [ ] **Step 5: Write the iOS side**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationSettings.swift`:

```swift
#if canImport(UIKit)
import UIKit
import UserNotifications

/// The app's half of the Notifications page: what the page is shown, where a
/// choice is kept, and the way to the app's page in iOS Settings.
@MainActor
enum NotificationSettings {
    /// Read fresh each time: the page asks again whenever the window comes
    /// back, so a permission granted in iOS Settings shows at once.
    static func state() async -> NotificationState {
        let status: UNAuthorizationStatus = await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
        return NotificationState(
            choice: PushPreferences.choice(),
            permission: NotificationState.Permission(status: status),
            pushToken: PushRegistrar.current?.pushTokenHex,
            contacts: PushPreferences.contacts()
        )
    }

    /// Saved first, then registered through the registrar's single-flight
    /// registration; a failed registration is tried again on the next
    /// activation.
    static func save(_ choice: NotificationChoice) -> NotificationChoice {
        PushPreferences.save(choice)
        PushRegistrar.current?.choiceChanged()
        return PushPreferences.choice()
    }

    /// The app's notification page in iOS Settings; the app's own page there
    /// if that address cannot be made.
    static func openSystemSettings() {
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString)
            ?? URL(string: UIApplication.openSettingsURLString)
        else { return }
        UIApplication.shared.open(url)
    }
}
#endif
```

- [ ] **Step 6: Wire the actions into the web view**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`, replace:

```swift
            onCompose: { asked in
                #if os(macOS)
                return ComposeCommands.open(asked: asked)
                #else
                // A phone has one window and no tabs; every message is written
                // in the page.
                return ComposeMode.inline.rawValue
                #endif
            }
        )
```

with:

```swift
            onCompose: { asked in
                #if os(macOS)
                return ComposeCommands.open(asked: asked)
                #else
                // A phone has one window and no tabs; every message is written
                // in the page.
                return ComposeMode.inline.rawValue
                #endif
            },
            // The Notifications page exists on iPhone and iPad only; the Mac
            // keeps Fastmail's own and answers nothing
            onNotificationState: {
                #if canImport(UIKit)
                return await NotificationSettings.state()
                #else
                return nil
                #endif
            },
            onSetNotifications: { choice in
                #if canImport(UIKit)
                return NotificationSettings.save(choice)
                #else
                return nil
                #endif
            },
            onOpenNotificationSettings: {
                #if canImport(UIKit)
                NotificationSettings.openSystemSettings()
                #endif
            }
        )
```

- [ ] **Step 7: Build for iOS**

Run: `cd /Users/mdbraber/src/fastmail-custom && make generate && xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'generic/platform=iOS' -configuration Debug -derivedDataPath build/ios-app CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 8: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/NotificationSettings.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift
git commit -m "$(cat <<'EOF'
feat: the bridge answers notificationState, setNotifications and openNotificationSettings

On iPhone and iPad they read the permission, save and register the choice,
and open the app's notification page in iOS Settings. The Mac refuses them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
)"
```

---

### Task 4: The harness offers `window.native.notifications`

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js:776-781` (after `window.native.setSetting`)
- Test: `Tests/IntegrationTests/HarnessTests.swift` (new tests before the class's closing brace)

**Interfaces:**
- Consumes (Task 3): the bridge actions `notificationState`, `setNotifications` and `openNotificationSettings`, and their JSON text replies.
- Produces: `window.native.notifications = { state(), set(choice), openSettings() }`, defined only when `navigator.userAgent` does not match `/Electron\//`.
  - `state()` resolves to the parsed state object.
  - `set({mode, senders, mailboxIds})` sends only the fields given and resolves to the parsed saved choice.
  - Both reject with `Error('The app did not answer')` when there is no string reply.
  - `openSettings()` resolves to whatever `post` resolves.

- [ ] **Step 1: Write the failing tests**

In `Tests/IntegrationTests/HarnessTests.swift`, insert before the final closing `}` of `HarnessTests` (after `testSetSettingWithARealJavaScriptTrueIsStoredAsABool`):

```swift
    // MARK: The Notifications page

    // The page is for the phone and the iPad; the Mac keeps Fastmail's own,
    // so under the Electron token there is nothing for the userscript to find
    func testNotificationsBridgeExistsOnlyWithoutTheElectronToken() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        let kinds = try await evaluate(webView, """
        [typeof window.native.notifications.state,
         typeof window.native.notifications.set,
         typeof window.native.notifications.openSettings].join(',')
        """) as? String
        XCTAssertEqual(kinds, "function,function,function")

        let mac = try makeWebView(
            userScript: "", metadata: Self.meta(),
            applicationName: WebContainer.electronUserAgentToken
        )
        try await load(mac)
        let onMac = try await evaluate(mac, "typeof window.native.notifications") as? String
        XCTAssertEqual(onMac, "undefined")
    }

    func testNotificationStateResolvesToTheAppsAnswerParsed() async throws {
        replies = { body in
            guard body["action"] as? String == "notificationState" else { return nil }
            return #"{"contacts":null,"mailboxIds":[],"mode":"inbox","permission":"allowed","pushToken":"00abff","senders":"everyone"}"#
        }
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, """
        window.__state = null;
        window.native.notifications.state().then(function (state) { window.__state = state; });
        true;
        """)
        try await waitUntil {
            try await self.evaluate(self.webView, "!!window.__state") as? Bool == true
        }
        let summary = try await evaluate(webView, """
        [window.__state.mode, window.__state.pushToken, String(window.__state.contacts === null)].join(',')
        """) as? String
        XCTAssertEqual(summary, "inbox,00abff,true")
    }

    func testSetNotificationsSendsTheChoiceAndResolvesToTheSavedOne() async throws {
        replies = { body in
            guard body["action"] as? String == "setNotifications" else { return nil }
            return #"{"mailboxIds":["P2F"],"mode":"custom","senders":"vips"}"#
        }
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, """
        window.__saved = null;
        window.native.notifications.set({ mode: 'custom', senders: 'vips', mailboxIds: ['P2F'] })
            .then(function (saved) { window.__saved = saved; });
        true;
        """)
        try await waitUntil { self.received.contains { $0["action"] as? String == "setNotifications" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "setNotifications" })
        let payload = try XCTUnwrap(message["payload"] as? [String: Any])
        XCTAssertEqual(payload["mode"] as? String, "custom")
        XCTAssertEqual(payload["senders"] as? String, "vips")
        XCTAssertEqual(payload["mailboxIds"] as? [String], ["P2F"])
        try await waitUntil {
            try await self.evaluate(self.webView, "!!window.__saved") as? Bool == true
        }
        let saved = try await evaluate(webView, "window.__saved.mode + ',' + window.__saved.mailboxIds.join('|')") as? String
        XCTAssertEqual(saved, "custom,P2F")
    }

    // A refusal, or no app at all, reaches the page as a rejection it can
    // report, not as a state made of nothing
    func testNotificationStateRejectsWhenTheAppGivesNoAnswer() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, """
        window.__failed = null;
        window.native.notifications.state().then(
            function () { window.__failed = 'resolved'; },
            function (error) { window.__failed = error.message; }
        );
        true;
        """)
        try await waitUntil {
            try await self.evaluate(self.webView, "window.__failed !== null") as? Bool == true
        }
        let failed = try await evaluate(webView, "window.__failed") as? String
        XCTAssertEqual(failed, "The app did not answer")
    }

    func testOpenNotificationSettingsReachesTheBridge() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, "window.native.notifications.openSettings(); true;")
        try await waitUntil {
            self.received.contains { $0["action"] as? String == "openNotificationSettings" }
        }
    }
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-custom && make generate && xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test -only-testing:IntegrationTests/HarnessTests 2>&1 | grep -E "Test Case .*(Notification|notification)|TEST (SUCCEEDED|FAILED)"`
Expected: the five new tests fail (`typeof window.native.notifications.state` throws, and waits time out), and the run ends `** TEST FAILED **`.

- [ ] **Step 3: Add the object to the harness**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`, replace:

```js
    window.native.setSetting = function (key, value) {
        return post('setting', { key: key, value: value });
    };
```

with:

```js
    window.native.setSetting = function (key, value) {
        return post('setting', { key: key, value: value });
    };

    // The Notifications page's way to the app, on the phone and the iPad. The
    // Mac keeps Fastmail's own page, so under the Electron user agent there
    // is none, and the userscript leaves Fastmail's page alone there.
    //
    // The app answers state() and set() as JSON text, since a reply's value
    // is a string; they resolve to the object, and reject when there is no
    // answer to read, which is how post() hands on a refusal.
    function notificationReply(text) {
        if (typeof text !== 'string') throw new Error('The app did not answer');
        return JSON.parse(text);
    }

    if (!/Electron\//.test(navigator.userAgent)) {
        window.native.notifications = {
            state: function () {
                return post('notificationState', {}).then(notificationReply);
            },
            set: function (choice) {
                choice = choice || {};
                var payload = { mode: choice.mode };
                if (choice.senders !== undefined) payload.senders = choice.senders;
                if (choice.mailboxIds !== undefined) payload.mailboxIds = choice.mailboxIds;
                return post('setNotifications', payload).then(notificationReply);
            },
            openSettings: function () {
                return post('openNotificationSettings', {});
            }
        };
    }
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom && xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test -only-testing:IntegrationTests/HarnessTests 2>&1 | grep -E "TEST (SUCCEEDED|FAILED)|failed"`
Expected: `** TEST SUCCEEDED **`, with no failed test cases.

- [ ] **Step 5: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js Tests/IntegrationTests/HarnessTests.swift
git commit -m "$(cat <<'EOF'
feat: the harness offers window.native.notifications on iPhone and iPad

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
)"
```

---

## Running a probe

```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/<probe>.js\" as «class utf8»)"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return FastMail.router.get(\"app\") + \" \" + location.pathname"'
```

The second command must print `mail /mail/…` after every probe run. If it does not, run `osascript -e 'tell application "mdbraber.com" to do JavaScript "FastMail.router.goApp(\"mail\"); return \"ok\""'` and say so in the task report.

### Task 5: Measure what the page is built from (read-only)

**Files:**
- Scratch: `$SCRATCH/probe-notifications-measure.js`
- No repository file changes, and no commit.

**Interfaces:**
- Consumes: the installed macOS app `mdbraber.com`.
- Produces: a recorded `allOk: true`, which Tasks 6 and 7 rely on. Every name the probe checks is used by Task 7's code:
  - `_registeredViews`, `register`, `getModuleForViewId`
  - the option-label, banner and push-id markup, and the five glyphs
  - `ListInputView`, `MailboxMenuView` and `MenuButtonView` and their members
  - the `CopyTextView` `text` override and node labels in a boxed `RadioGroupView`
  - the primary mail account and the Inbox's `id` and `pathName`
  - `FastMail.localPrefs` holding Fastmail's notification preferences

- [ ] **Step 1: Write the probe**

Create `$SCRATCH/probe-notifications-measure.js`:

```js
// Task 5: read-only measurement for the Notifications page. Fetches Fastmail's
// module text (never evaluated) and reads classes, the store and preferences.
// It may open Settings so Fastmail's Settings controller exists, asks
// Fastmail's own loader for its Notifications module (which Fastmail does
// itself when that page is opened), and makes two throwaway views that never
// enter the document. It registers, writes and chooses nothing, and it goes
// back to mail.
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (test, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try { if (test()) return true; } catch (error) {}
        await wait(100);
    }
    return false;
};
const grab = async (url) => {
    try { const r = await fetch(url); return r.ok ? await r.text() : ''; } catch (error) { return ''; }
};
const facts = {};
const notes = {};
const fact = (name, value) => { facts[name] = !!value; };
const router = FastMail.router;
try {
    const main = performance.getEntriesByType('resource').map(e => e.name).find(n => /\/main\.mod\.js(\?|$)/.test(n));
    const desktop = main.slice(0, main.lastIndexOf('/') + 1);
    const mobile = desktop.replace('/desktop/', '/mobile/');
    const core = await grab(mobile + 'main.mod.js');
    const radio = await grab(mobile + 'RadioGroupView.mod.js');
    const hierarchy = await grab(mobile + 'HierarchyController.mod.js');
    const page = await grab(mobile + 'settings-notifications.mod.js');
    const vip = await grab(mobile + 'VIP.mod.js');
    const inbox = await grab(mobile + 'Inbox.mod.js');
    const cancelled = await grab(mobile + 'Cancelled.mod.js');

    fact('makeViewInstance reads the builder after the module loads',
        /getModuleForViewId\(\w+\)\.then\(\(\)=>\{if\(\w+\.isInUse\)\{let \w+=\(0,\w+\[\w+\]\)\(/.test(hierarchy));
    fact('register stores into _registeredViews', /register\(\w+,\w+\)\{return this\._registeredViews\[\w+\]=\w+,this\}/.test(hierarchy));
    fact('Fastmail registers notifications from its module', /\.register\("notifications",/.test(page));
    fact('boxed choices', page.includes('type:"v-RadioGroup--boxed"'));
    fact('option label markup', ['div.u-py-1.u-flex.u-flex-col.u-space-y-3', 'p.u-flex.u-space-x-2.u-items-center',
        '"+class":"u-sq-24 u-my-n4"', 'div.u-flex-1.u-trim', 'span.u-sq-24.u-my-n4',
        'p.u-flex-1.u-trim.u-color-unimportant'].every(part => radio.includes(part)));
    fact('banner markup', ['div.u-banner.u-p-3.u-flex.u-items-baseline.u-space-x-2', 'div.u-self-start.u-sq-24.u-m-n0_5',
        'div.u-flex.u-flex-wrap.u-items-center.u-space-wrap-2', 'div.u-banner-content.u-py-1.u-flex-1',
        'h3.u-relative.u-trim.u-font-semibold', 'u-banner-icon u-sq-24 u-my-n0_5', 'i-attention'].every(part => core.includes(part)));
    fact('attention glyph', core.includes('<circle cx="11.75" cy="11.75" r="7.25"/>') &&
        core.includes('<line x1="11.5" y1="8" x2="11.5" y2="12.5"/>'));
    fact('VIP glyph', vip.includes('M12.41,16.28a.8.8,0,0,0-.82,0L7.36,19.17'));
    fact('Inbox glyph', inbox.includes('M3.75 13.2727H7.01567C7.73679'));
    fact('Cancelled glyph', cancelled.includes('<line x1="7.5" y1="7.5" x2="16.5" y2="16.5"/>'));
    fact('settings glyph', page.includes('M20.48 10.6L19 10.17a.33.33 0 0 1-.24-.24') && page.includes('"i-settings"'));
    fact('push id line markup', page.includes('"p.u-trim.u-text-sm.u-color-unimportant"') &&
        page.includes('layerTag:"b",type:"u-whitespace-nowrap"'));
    fact('mailbox list parts', page.includes('positionToThe:"right",alignEdge:"middle",showCallout:!0') &&
        /didSelect\(\w+\)\{\w+\.addItem\(\w+\)\}/.test(page));

    if (!router.getAppController('settings')) {
        notes.openedSettings = true;
        router.goApp('settings');
        await until(() => router.getAppController('settings'), 10000);
    }
    const controller = router.getAppController('settings');
    fact('Settings controller', controller);
    fact('register is not an own property', controller && !Object.prototype.hasOwnProperty.call(controller, 'register'));
    fact('_registeredViews is an object', controller && controller._registeredViews && typeof controller._registeredViews === 'object');
    fact('getModuleForViewId', controller && typeof controller.getModuleForViewId === 'function');
    fact('viewId is readable', controller && (controller.get('viewId') === null || typeof controller.get('viewId') === 'string'));
    notes.registeredBefore = controller ? Object.keys(controller._registeredViews || {}) : null;
    if (controller) await controller.getModuleForViewId('notifications');

    const C = FastMail.classes;
    ['RadioGroupView', 'CopyTextView', 'ListInputView', 'MailboxMenuView', 'MenuButtonView', 'SelectView',
        'ButtonView', 'View', 'PageView', 'SettingsPaneView', 'PageHeaderView']
        .forEach(name => fact('class ' + name, typeof C[name] === 'function'));
    notes.subscreenSelectView = typeof C.SubscreenSelectView === 'function';
    fact('Fastmail builder registered after the module', controller && typeof controller._registeredViews.notifications === 'function');
    fact('ListInputView members', C.ListInputView && ['mapValueToItems', 'mapItemsToValue', 'drawItemContent',
        'drawAddInput', 'setValueFromItems', 'removeItem', 'userDidInput']
        .every(name => typeof C.ListInputView.prototype[name] === 'function'));
    fact('MailboxMenuView members', C.MailboxMenuView && ['rolesVisible', 'accountId'].every(name => name in C.MailboxMenuView.prototype));
    fact('MenuButtonView members', C.MenuButtonView && ['popOverView', 'popOverOptions', 'menuView'].every(name => name in C.MenuButtonView.prototype));
    fact('viewNeedsRedraw', typeof C.View.prototype.viewNeedsRedraw === 'function');

    let copy = null;
    try {
        copy = new C.CopyTextView({ layerTag: 'b', type: 'u-whitespace-nowrap', toCopy: 'abcd1234', text: 'abcd1234efgh5678', label: null });
        fact('CopyTextView text override', copy.get('text') === 'abcd1234efgh5678' && copy.get('toCopy') === 'abcd1234');
    } finally {
        if (copy) copy.destroy();
    }
    let group = null;
    try {
        group = new C.RadioGroupView({
            type: 'v-RadioGroup--boxed', value: 'b',
            options: [{ label: FastMail.el('div.probe-a', ['A']), value: 'a' }, { label: FastMail.el('div.probe-b', ['B']), value: 'b' }]
        });
        const layer = group.render().get('layer');
        fact('boxed group draws node labels', layer.classList.contains('v-RadioGroup--boxed') &&
            layer.querySelectorAll('.v-RadioGroup-option').length === 2 &&
            !!layer.querySelector('.v-RadioGroup-option.is-checked .v-RadioGroup-text > .probe-b'));
    } finally {
        if (group) group.destroy();
    }

    const primary = FastMail.auth.get('primaryAccounts')['urn:ietf:params:jmap:mail'];
    const mine = FastMail.store.getAll(C.Mailbox).filter(m => m.get('accountId') === primary);
    const inboxRecord = mine.find(m => m.get('role') === 'inbox');
    fact('primary mail account', typeof primary === 'string');
    fact('Inbox with id and pathName', inboxRecord && typeof inboxRecord.get('id') === 'string' && typeof inboxRecord.get('pathName') === 'string');
    notes.labelsWithoutRole = mine.filter(m => !m.get('role')).length;
    fact('Fastmail notification preferences in localPrefs', FastMail.localPrefs && FastMail.localPrefs.get('notificationsMail') !== undefined);
    notes.mobileBinding = !!(controller && controller.__meta__ && controller.__meta__.bindings && controller.__meta__.bindings.isWithSidebar);
} catch (error) {
    notes.threw = String((error && error.stack) || error);
} finally {
    if (router.get('app') !== 'mail') {
        router.goApp('mail');
        await until(() => router.get('app') === 'mail', 10000);
    }
    notes.app = router.get('app');
    notes.path = location.pathname;
}
const failed = Object.keys(facts).filter(name => !facts[name]);
return JSON.stringify({ allOk: failed.length === 0 && !notes.threw, failed, facts, notes }, null, 1);
```

- [ ] **Step 2: Run it**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/probe-notifications-measure.js\" as «class utf8»)" | tee "$SCRATCH/probe-notifications-measure.out"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return FastMail.router.get(\"app\") + \" \" + location.pathname"'
```
Expected:
- `"allOk": true` and `"failed": []`
- `"notes"` shows `"app": "mail"` and `"mobileBinding": false`
- the last line starts `mail /mail/`

- [ ] **Step 3: Decide**

If `allOk` is true, record the output path in the task report and go on to Task 6.

If any fact failed, Fastmail has changed since this plan was written. Stop and report the failed names and the output. Do not adapt Task 7's code on your own: the controller decides.

---

### Task 6: The settings page's parts serve a second page

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`, the page block from `    const pageClasses = () => {` (around line 6519) to `settingsPage` (around line 6618)
- Scratch: `$SCRATCH/gen-refactor-probe.py`

**Interfaces:**
- Consumes: the existing `SETTINGS_PAGE_ID`, `SETTINGS_PAGE_TITLE`, `settingsPane(classes)` and `reportFault(what, error)`.
- Produces, all inside the same block and before `    /*\n     * Reaching the page.`:
  - `findClasses(required, optional)`: `null` if a required name is missing from `FastMail.classes`, else an object of every required class and each optional one present
  - `pageSection(pageId, group, rows)`: the section element, id `s-<pageId>-<group.id>`
  - `isMobileSettings(controller)`: a boolean, true when the controller binds `isWithSidebar`
  - `settingsPageView(classes, controller, id, title, makeContent)`: a `PageView`; the header is built before `makeContent()` is called
  - unchanged in behaviour: `pageClasses()`, `settingsSection(group, rows)`, `settingsPageHeader(classes, controller)` and `settingsPage(classes, controller)`

- [ ] **Step 1: Write the probe generator (the failing test)**

Create `$SCRATCH/gen-refactor-probe.py`:

```python
#!/usr/bin/env python3
"""Evaluate the settings page's building blocks as committed (HEAD) and as on
disk, each in its own scope with the same stand-ins, inside the running app;
compare what each builds, and check the shared names exist on disk. Nothing
is registered, nothing enters the document, nothing is written."""
import pathlib
import subprocess
import sys

REPO = pathlib.Path("/Users/mdbraber/src/fastmail-custom")
OUT = pathlib.Path(sys.argv[1])
PATH = "Userscript/fastmail-custom-mode.user.js"
now = (REPO / PATH).read_text(encoding="utf-8")
committed = subprocess.run(
    ["git", "-C", str(REPO), "show", "HEAD:" + PATH], check=True, capture_output=True, text=True
).stdout

START = "    const pageClasses = () => "
END = "    /*\n     * Reaching the page."


def block(src, label):
    if START not in src:
        sys.exit(f"FAIL: {label}: start marker missing")
    at = src.index(START)
    if END not in src[at:]:
        sys.exit(f"FAIL: {label}: end marker missing")
    return src[at:src.index(END, at)]


def scope(name, code):
    return "\n".join([
        "const " + name + " = (FastMail) => {",
        code,
        "    return {",
        "        pageClasses, settingsSection, settingsPageHeader, settingsPage,",
        "        shared: {",
        "            findClasses: typeof findClasses === 'function',",
        "            pageSection: typeof pageSection === 'function',",
        "            settingsPageView: typeof settingsPageView === 'function',",
        "            isMobileSettings: typeof isMobileSettings === 'function'",
        "        }",
        "    };",
        "};",
    ])


HEAD = r"""
const faults = [];
const reportFault = (what) => { faults.push(String(what)); };
const SETTINGS_PAGE_ID = 'custommode';
const SETTINGS_PAGE_TITLE = 'Custom mode';
const SETTING_GROUPS = [{ id: 'probe', title: 'Probe' }];
const settingsInGroup = () => [];
const sectionRow = () => null;
const settingRegister = () => ({ reset() {}, settle() {}, flushPending() {}, add() {}, hold() {} });
"""

BODY = r"""
const fakeClasses = (log) => {
    const make = (name) => function (options) { log.push(name); this.options = options; };
    const PageHeaderView = make('PageHeaderView');
    PageHeaderView.prototype.set = function () { return this; };
    PageHeaderView.prototype.destroy = function () {};
    return {
        PageView: make('PageView'), SettingsPaneView: make('SettingsPaneView'), PageHeaderView,
        ToggleView: make('ToggleView'), TextInputView: make('TextInputView'),
        ButtonView: make('ButtonView'), View: make('View')
    };
};
const mobileController = (observers) => ({
    __meta__: { bindings: { isWithSidebar: {} } },
    get: (key) => (key === 'isWithSidebar' ? false : null),
    addObserverForKey: (key, object, method) => { observers.push(key + ':' + method); },
    removeObserverForKey: () => {}
});
const desktopController = { __meta__: { bindings: {} }, get: () => null };
const throwingController = { get __meta__() { throw new Error('probe: meta refused'); } };

const describePage = (page) => {
    const o = page.options;
    return JSON.stringify({
        keys: Object.keys(o), title: o.title, url: o.url,
        isTitleFromH1s: o.isTitleFromH1s, isImmortal: o.isImmortal,
        header: o.header ? o.header.options.showBack : null,
        content: o.content.length
    });
};

const run = (make) => {
    const out = {};
    const real = make(window.FastMail);
    const classes = real.pageClasses();
    out.pageClasses = classes
        ? Object.keys(classes).sort().join(',') + '|' + Object.keys(classes).every(n => classes[n] === window.FastMail.classes[n])
        : 'null';
    const withoutToggle = make(Object.create(window.FastMail, {
        classes: { value: Object.assign({}, window.FastMail.classes, { ToggleView: undefined }) }
    }));
    out.pageClassesWithoutToggle = String(withoutToggle.pageClasses());
    out.section = real.settingsSection({ id: 'probe', title: 'Probe' }, [window.FastMail.el('p', ['row'])]).outerHTML;
    const desktopLog = [];
    out.desktopPage = describePage(real.settingsPage(fakeClasses(desktopLog), desktopController)) + '|' + desktopLog.join(',');
    const mobileLog = [];
    const observers = [];
    out.mobilePage = describePage(real.settingsPage(fakeClasses(mobileLog), mobileController(observers))) +
        '|' + mobileLog.join(',') + '|' + observers.join(',');
    const before = faults.length;
    out.throwingHeader = String(real.settingsPageHeader(fakeClasses([]), throwingController)) + '|' + faults.slice(before).join(',');
    out.shared = real.shared;
    return out;
};

const was = run(committedScope);
const is = run(diskScope);
const same = {};
['pageClasses', 'pageClassesWithoutToggle', 'section', 'desktopPage', 'mobilePage', 'throwingHeader']
    .forEach((key) => { same[key] = was[key] === is[key]; });
const pass = Object.values(same).every(Boolean) && Object.values(is.shared).every(Boolean);
return JSON.stringify({ pass, same, shared: is.shared, was, is }, null, 1);
"""

OUT.write_text(
    HEAD + scope("committedScope", block(committed, "HEAD")) + "\n" + scope("diskScope", block(now, "disk")) + BODY,
    encoding="utf-8",
)
print(f"wrote {OUT}")
```

- [ ] **Step 2: Run it to see it fail**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
python3 "$SCRATCH/gen-refactor-probe.py" "$SCRATCH/refactor-probe.js"
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/refactor-probe.js\" as «class utf8»)"
```
Expected: `"pass": false`. Every entry in `"same"` is `true`, since nothing has changed yet, and every entry in `"shared"` is `false`.

- [ ] **Step 3: Generalise the class lookup**

In `Userscript/fastmail-custom-mode.user.js`, replace:

```js
    const pageClasses = () => {
        const all = FastMail.classes || {};
        const required = ['PageView', 'SettingsPaneView', 'ToggleView', 'TextInputView', 'ButtonView', 'View'];
        if (required.some(name => typeof all[name] !== 'function')) return null;
        const found = {};
        required.concat(['ModalOverlayView', 'ScrollView', 'PageHeaderView']).forEach((name) => {
            if (typeof all[name] === 'function') found[name] = all[name];
        });
        return found;
    };
```

with:

```js
    const pageClasses = () => findClasses(
        ['PageView', 'SettingsPaneView', 'ToggleView', 'TextInputView', 'ButtonView', 'View'],
        ['ModalOverlayView', 'ScrollView', 'PageHeaderView']
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
```

- [ ] **Step 4: Generalise the section**

Replace:

```js
    const settingsSection = (group, rows) => {
        const el = FastMail.el;
        // The two inline widths are copied from Display options' and Custom
        // swipes' own sections: without them the left column has no floor,
        // and at a narrow width it collapses instead of wrapping above the
        // options, breaking on the u-break-words heading one letter at a time.
        return el('div.u-p-6.u-space-y-5#s-' + SETTINGS_PAGE_ID + '-' + group.id, [
```

with:

```js
    // One section of a settings page, its id naming the page and the group.
    const pageSection = (pageId, group, rows) => {
        const el = FastMail.el;
        // The two inline widths are copied from Display options' and Custom
        // swipes' own sections: without them the left column has no floor,
        // and at a narrow width it collapses instead of wrapping above the
        // options, breaking on the u-break-words heading one letter at a time.
        return el('div.u-p-6.u-space-y-5#s-' + pageId + '-' + group.id, [
```

Then replace the end of that function and the start of `settingsPane`:

```js
                el('div.u-mx-6.u-my-4.u-flex-major.u-space-y-8',
                    { style: 'min-width:415px;min-width:min(415px, calc(100% - 48px))' }, rows)
            ])
        ]);
    };

    const settingsPane = (classes) => {
```

with:

```js
                el('div.u-mx-6.u-my-4.u-flex-major.u-space-y-8',
                    { style: 'min-width:415px;min-width:min(415px, calc(100% - 48px))' }, rows)
            ])
        ]);
    };

    const settingsSection = (group, rows) => pageSection(SETTINGS_PAGE_ID, group, rows);

    const settingsPane = (classes) => {
```

- [ ] **Step 5: Name the mobile-build test**

Replace:

```js
    const settingsPageHeader = (classes, controller) => {
        try {
            const bindings = controller && controller.__meta__ && controller.__meta__.bindings;
            if (!bindings || !bindings.isWithSidebar || typeof classes.PageHeaderView !== 'function') return null;
```

with:

```js
    const isMobileSettings = (controller) => {
        const bindings = controller && controller.__meta__ && controller.__meta__.bindings;
        return !!(bindings && bindings.isWithSidebar);
    };

    const settingsPageHeader = (classes, controller) => {
        try {
            if (!isMobileSettings(controller) || typeof classes.PageHeaderView !== 'function') return null;
```

- [ ] **Step 6: Generalise the page**

Replace:

```js
    const settingsPage = (classes, controller) => new classes.PageView({
        title: SETTINGS_PAGE_TITLE,
        url: SETTINGS_PAGE_ID,
        isTitleFromH1s: true,
        isImmortal: false,
        header: settingsPageHeader(classes, controller),
        content: [settingsPane(classes)]
    });
```

with:

```js
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
```

- [ ] **Step 7: Run the probe to see it pass**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
node --check /Users/mdbraber/src/fastmail-custom/Userscript/fastmail-custom-mode.user.js
python3 "$SCRATCH/gen-refactor-probe.py" "$SCRATCH/refactor-probe.js"
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/refactor-probe.js\" as «class utf8»)"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return FastMail.router.get(\"app\") + \" \" + location.pathname"'
```
Expected:
- `"pass": true`, with every `"same"` entry and every `"shared"` entry `true`
- `is.mobilePage` ends `|PageHeaderView,SettingsPaneView,PageView|isWithSidebar:isWithSidebarDidChange`
- `is.throwingHeader` is `null|the settings page could not add its back button`
- the last line starts `mail /mail/`

- [ ] **Step 8: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Userscript/fastmail-custom-mode.user.js
git commit -m "$(cat <<'EOF'
refactor: the settings page's classes, sections, header and page view take a page of their own

The Custom mode page builds exactly what it built before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
)"
```

---

### Task 7: The Notifications page

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`
  - a new block inserted directly after `settingsPage` (Task 6) and before `    /*\n     * Reaching the page.`
  - `watchSettingsApp` (around line 6890)
  - `dressSettingsList` (around line 7700)
- Scratch: `$SCRATCH/gen-notifications-probe.py`

**Interfaces:**
- Consumes (Task 6): `findClasses(required, optional)`, `pageSection(pageId, group, rows)`, `isMobileSettings(controller)`, `settingsPageView(classes, controller, id, title, makeContent)`.
- Consumes (existing): `mailboxesOf(accountId)`, `reportFault(what, error)`.
- Consumes (Task 4, at run time): `window.native.notifications.state()`, `.set(choice)`, `.openSettings()`.
- Consumes (Task 5, measured): `controller._registeredViews`, `controller.register`, `controller.getModuleForViewId`, `controller.go`, `controller.get('viewId')`, plus the classes and markup listed there.
- Produces:
  - constants `NOTIFICATIONS_PAGE_ID` (`'notifications'`), `NOTIFICATIONS_PAGE_TITLE`, `NOTIFICATION_GLYPHS`, `NOTIFICATION_MODES` and `NOTIFICATION_SENDERS`
  - `notificationsBridge()`, which returns the object or `null`
  - `notificationsPane(classes, controller, bridge)` and `notificationsPage(classes, controller, bridge)`
  - state `notificationsPageState`: `'waiting'`, `'installed'` or `'unavailable'`
  - `installNotificationsPage(controller)`, which returns a function that puts the controller back
  - `ensureNotificationsPage()`, called from `watchSettingsApp` and `dressSettingsList`

- [ ] **Step 1: Write the probe generator (the failing test)**

Create `$SCRATCH/gen-notifications-probe.py`:

```python
#!/usr/bin/env python3
"""Draw the userscript's Notifications page, as it is on disk, in the running
Mac app against a stand-in window.native.notifications: check what it draws,
what it sends and what it asks again on focus; check the fallbacks against
stand-in controllers; then put window.native, the Settings controller and
Fastmail's own builder back and go back to mail. Fastmail's own notification
preferences are compared before and after and never written."""
import pathlib
import sys

REPO = pathlib.Path("/Users/mdbraber/src/fastmail-custom")
OUT = pathlib.Path(sys.argv[1])
src = (REPO / "Userscript/fastmail-custom-mode.user.js").read_text(encoding="utf-8")

NOTIFICATIONS_START = "    /*\n     * The Notifications page, on the phone and the iPad."


def between(start, end):
    if start not in src:
        sys.exit(f"FAIL: marker not found in the userscript: {start!r}")
    at = src.index(start)
    if end not in src[at:]:
        sys.exit(f"FAIL: end marker not found after {start!r}: {end!r}")
    return src[at:src.index(end, at)]


mailboxes_of = between("    const mailboxesOf = ", "    // Matched on the full path")
page_parts = between("    const pageClasses = () => ", NOTIFICATIONS_START)
notifications = between(NOTIFICATIONS_START, "    /*\n     * Reaching the page.")

SCOPE = "\n".join([
    "const makeScope = (FastMail, window) => {",
    mailboxes_of,
    page_parts,
    notifications,
    "    return {",
    "        ensure: ensureNotificationsPage,",
    "        state: () => notificationsPageState,",
    "        install: installNotificationsPage",
    "    };",
    "};",
])

HEAD = r"""
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (test, ms) => {
    const end = Date.now() + (ms || 6000);
    while (Date.now() < end) {
        try { if (test()) return true; } catch (error) {}
        await wait(100);
    }
    return false;
};
const faults = [];
const reportFault = (what, error) => {
    faults.push(String(what) + (error ? ' (' + (error.message || error) + ')' : ''));
};
const SETTINGS_PAGE_ID = 'custommode';
const SETTINGS_PAGE_TITLE = 'Custom mode';
const checks = {};
const check = (name, ok, detail) => {
    checks[name] = ok ? true : 'FAIL ' + JSON.stringify(detail === undefined ? null : detail);
};
"""

BODY = r"""
const PREF_KEYS = ['notificationsMail', 'notificationsMailboxes', 'notificationsFilter',
    'notificationsMailSound', 'enableCalendarNotifications', 'notificationsCalendarSound'];
const fastmailPrefs = () => JSON.stringify({
    prefs: PREF_KEYS.map(key => [key, window.FastMail.localPrefs.get(key)]),
    storage: Object.keys(localStorage).filter(key => /notification/i.test(key)).sort()
        .map(key => [key, localStorage.getItem(key)])
});
const PERMISSION_TEXT = 'Notifications are turned off for this app in iOS Settings.';
const CONTACTS_TEXT = 'The push server cannot read your contacts, so VIPs and contacts get no notifications.';
const TOKEN = '0123456789abcdef'.repeat(4);
const prefsBefore = fastmailPrefs();
const router = window.FastMail.router;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const copy = (value) => JSON.parse(JSON.stringify(value));
const calls = [];
const standIn = { mode: 'inbox', senders: 'everyone', mailboxIds: [], permission: 'denied', pushToken: TOKEN, contacts: false };
const bridge = {
    state: () => { calls.push(['state']); return Promise.resolve(copy(standIn)); },
    set: (choice) => {
        calls.push(['set', copy(choice)]);
        Object.assign(standIn, copy(choice));
        return Promise.resolve({ mode: standIn.mode, senders: standIn.senders, mailboxIds: standIn.mailboxIds.slice() });
    },
    openSettings: () => { calls.push(['openSettings']); return Promise.resolve(null); }
};
const sets = () => calls.filter(call => call[0] === 'set').map(call => call[1]);
const lastSet = () => JSON.stringify(sets()[sets().length - 1]);
const section = () => document.querySelector('#s-notifications-messages');
const collapse = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const banners = () => Array.from(document.querySelectorAll('.u-banner--warning')).map(collapse);
const options = () => Array.from(section().querySelectorAll('.v-RadioGroup-option'));
const checkedIndex = () => options().findIndex(node => node.classList.contains('is-checked'));
const viewAt = (selector) => window.FastMail.getViewFromNode(section().querySelector(selector));
const listItems = () => Array.from(section().querySelectorAll('.v-ListInput li')).map(collapse);

const hadNotifications = own(window.native, 'notifications');
const originalNotifications = window.native.notifications;
let controller = null;
let hadOwnRegister = false;
let originalRegister = null;
let originalBuilder;
let startViewId = null;
let openMenu = null;

try {
    if (!router.getAppController('settings')) {
        router.goApp('settings');
        await until(() => router.getAppController('settings'), 10000);
    }
    controller = router.getAppController('settings');
    const views = controller._registeredViews;
    hadOwnRegister = own(controller, 'register');
    originalRegister = controller.register;
    originalBuilder = views.notifications;
    startViewId = controller.get('viewId');
    const primary = window.FastMail.auth.get('primaryAccounts')['urn:ietf:params:jmap:mail'];
    const mailboxes = window.FastMail.store.getAll(window.FastMail.classes.Mailbox).filter(m => m.get('accountId') === primary);
    const inboxId = mailboxes.filter(m => m.get('role') === 'inbox')[0].get('id');
    const label = mailboxes.filter(m => !m.get('role'))[0];

    // 1. Without window.native.notifications nothing is registered
    const bare = makeScope(window.FastMail, { native: {} });
    bare.ensure();
    check('without the bridge: still waiting', bare.state() === 'waiting', bare.state());
    check('without the bridge: register untouched', own(controller, 'register') === hadOwnRegister);
    check('without the bridge: builder untouched', views.notifications === originalBuilder);

    // 2. With the stand-in it takes the id
    window.native.notifications = bridge;
    const live = makeScope(window.FastMail, window);
    live.ensure();
    check('installed', live.state() === 'installed', live.state());
    check('register wrapped', own(controller, 'register'));
    check('builder replaced', typeof views.notifications === 'function' && views.notifications !== originalBuilder);

    // 3. The page as drawn
    router.restoreEncodedState('settings/notifications');
    const drawn = await until(() => section() && options().length === 4 && checkedIndex() === 2, 10000);
    check('drawn with All in inbox chosen', drawn, section() ? collapse(section()).slice(0, 200) : null);
    check('address', location.pathname === '/settings/notifications', location.pathname);
    check('heading', section().querySelector('h1').textContent.trim() === 'New messages');
    check('boxed', !!section().querySelector('fieldset.v-RadioGroup.v-RadioGroup--boxed'));
    const titles = options().map(node => node.querySelector('p.u-items-center > div.u-flex-1').textContent.trim());
    check('choice titles', titles.join('|') === 'Off|Important messages only|All in inbox|Custom', titles);
    const descriptions = options().map(node => node.querySelector('p.u-color-unimportant').textContent);
    check('choice descriptions', descriptions[0] === "Don't show a notification for any message on this device." &&
        descriptions[3] === 'Choose senders and labels to notify for.', descriptions);
    const glyphs = options().map(node => ['i-cancelled', 'i-vip', 'i-inbox', 'i-settings']
        .filter(name => node.querySelector('.v-RadioGroup-text svg.' + name)).join(''));
    check('choice glyphs', glyphs.join(',') === 'i-cancelled,i-vip,i-inbox,i-settings', glyphs);
    check('Fastmail badges gone', !document.querySelector('.v-AppStoreBadge'));
    check('permission warning alone', banners().length === 1 && banners()[0].indexOf(PERMISSION_TEXT) === 0 &&
        /Open Settings$/.test(banners()[0]) && !!document.querySelector('.u-banner--warning svg.i-attention'), banners());
    const selected = Array.from(document.querySelectorAll('a.app-source.is-selected')).map(collapse);
    check('sidebar highlights Notifications', selected.indexOf('Notifications') !== -1, selected);
    const idLine = Array.from(document.querySelectorAll('p.u-trim.u-text-sm.u-color-unimportant'))
        .filter(node => node.textContent.indexOf('The push id for your device is ') === 0)[0];
    check('push id shows eight characters', !!idLine && idLine.textContent.indexOf(TOKEN.slice(0, 8)) !== -1 &&
        idLine.textContent.indexOf(TOKEN.slice(0, 9)) === -1, idLine && idLine.textContent);
    const copyView = idLine && window.FastMail.getViewFromNode(idLine.querySelector('.v-CopyText'));
    check('copy button holds the whole token', !!copyView && copyView.get('text') === TOKEN);
    document.querySelector('.u-banner--warning .v-Button').click();
    check('Open Settings asks the app', await until(() => calls.some(call => call[0] === 'openSettings'), 3000));

    // 4. Custom, the first time: the Inbox, for everyone
    viewAt('fieldset.v-RadioGroup').userDidInput('custom');
    await until(() => section().querySelector('.v-ListInput') && listItems().length === 1, 4000);
    check('custom sent with the Inbox for everyone',
        lastSet() === JSON.stringify({ mode: 'custom', senders: 'everyone', mailboxIds: [inboxId] }), sets());
    check('custom: sender select', !!section().querySelector('.v-Select') &&
        collapse(section()).indexOf('Notify for messages from') !== -1);
    check('custom: list starts with the Inbox', listItems().length === 1 && listItems()[0].indexOf('Inbox') === 0, listItems());
    check('custom: Add label button', collapse(section().querySelector('.v-ListInput > p')) === 'Add label');

    // 5. VIPs: the contacts warning joins the permission warning
    viewAt('.v-Select').userDidInput('vips');
    await until(() => banners().length === 2, 4000);
    check('vips sent', lastSet() === JSON.stringify({ mode: 'custom', senders: 'vips', mailboxIds: [inboxId] }), sets());
    check('contacts warning', banners().indexOf(CONTACTS_TEXT) !== -1, banners());

    // 6. The Add label menu opens on the account's labels and closes again;
    // nothing in it is chosen
    openMenu = viewAt('.v-ListInput > p .v-Button');
    openMenu.activate();
    check('Add label menu lists labels', await until(() => document.querySelectorAll('.v-PopOver .v-MenuOption').length > 0, 3000));
    openMenu.get('popOverView').hide();
    openMenu = null;
    check('menu closed', await until(() => !document.querySelector('.v-PopOver .v-MenuOption'), 3000));

    // 7. A label added and removed through the list
    viewAt('.v-ListInput').addItem(label);
    await until(() => listItems().length === 2, 4000);
    check('label added and sent',
        lastSet() === JSON.stringify({ mode: 'custom', senders: 'vips', mailboxIds: [inboxId, label.get('id')] }), sets());
    window.FastMail.getViewFromNode(section().querySelectorAll('.v-ListInput li')[1]).removeItem();
    await until(() => listItems().length === 1, 4000);
    check('label removed and sent', lastSet() === JSON.stringify({ mode: 'custom', senders: 'vips', mailboxIds: [inboxId] }), sets());

    // 8. Off: no warnings and no Custom controls, the list kept for later
    viewAt('fieldset.v-RadioGroup').userDidInput('off');
    await until(() => !section().querySelector('.v-ListInput') && banners().length === 0, 4000);
    check('off sent', lastSet() === JSON.stringify({ mode: 'off', senders: 'vips', mailboxIds: [inboxId] }), sets());
    check('off: nothing extra', banners().length === 0 && !section().querySelector('.v-Select'), banners());

    // 9. Focus asks again: a choice and a permission changed in the app show
    standIn.mode = 'important';
    standIn.permission = 'allowed';
    const asked = calls.filter(call => call[0] === 'state').length;
    window.dispatchEvent(new Event('focus'));
    await until(() => checkedIndex() === 1, 4000);
    check('focus asks again', calls.filter(call => call[0] === 'state').length > asked);
    check('focus: Important with the contacts warning alone',
        checkedIndex() === 1 && banners().length === 1 && banners()[0] === CONTACTS_TEXT, banners());

    check('five choices sent, all to the stand-in', sets().length === 5, sets());
    check('the live page reported no fault', faults.length === 0, faults);
    check('Fastmail notification preferences unchanged', fastmailPrefs() === prefsBefore);

    // 10. Fastmail's module registering later is kept aside, and put back
    const later = () => 'fastmail-page';
    const registry = { register(id, builder) { this._registeredViews[id] = builder; return this; } };
    const fakeController = (builders) => Object.assign(Object.create(registry), {
        _registeredViews: builders, get: () => null, go: () => {}, getModuleForViewId: () => Promise.resolve()
    });
    const aside = fakeController({});
    const putBack = makeScope(window.FastMail, { native: { notifications: bridge } }).install(aside);
    const oursThere = aside._registeredViews.notifications;
    aside.register('notifications', later);
    check('a later Fastmail registration is kept aside', aside._registeredViews.notifications === oursThere);
    putBack();
    check('put back: Fastmail builder', aside._registeredViews.notifications === later);
    check('put back: register unwrapped', !own(aside, 'register'));

    // 11. A page that cannot be drawn is handed to Fastmail's own builder
    const noChoices = Object.create(window.FastMail, {
        classes: { value: Object.assign({}, window.FastMail.classes, { RadioGroupView: undefined }) }
    });
    const broken = makeScope(noChoices, { native: { notifications: bridge } });
    const handedOver = fakeController({ notifications: later });
    const faultsBefore = faults.length;
    broken.install(handedOver);
    const built = await handedOver._registeredViews.notifications(null, handedOver, null);
    check('failed build hands the page to Fastmail', built === 'fastmail-page', built);
    check('failed build gives the id back', broken.state() === 'unavailable' &&
        handedOver._registeredViews.notifications === later && !own(handedOver, 'register'), broken.state());
    check('failed build reports one fault', faults.length === faultsBefore + 1, faults.slice(faultsBefore));

    // 12. A controller without the registry gives the page up at once
    const noRegistry = makeScope(Object.create(window.FastMail, {
        router: { value: {
            getAppController: () => ({ get: () => null, register() {}, go() {}, getModuleForViewId: () => Promise.resolve() }),
            get: () => 'settings'
        } }
    }), { native: { notifications: bridge } });
    const faultsBeforeRegistry = faults.length;
    noRegistry.ensure();
    check('no registry: unavailable, one fault',
        noRegistry.state() === 'unavailable' && faults.length === faultsBeforeRegistry + 1, faults.slice(faultsBeforeRegistry));
} catch (error) {
    checks.threw = 'FAIL ' + String((error && error.stack) || error);
} finally {
    try { if (openMenu) openMenu.get('popOverView').hide(); } catch (error) {}
    if (hadNotifications) window.native.notifications = originalNotifications;
    else delete window.native.notifications;
    if (controller) {
        if (hadOwnRegister) controller.register = originalRegister;
        else delete controller.register;
        if (originalBuilder === undefined) delete controller._registeredViews.notifications;
        else controller._registeredViews.notifications = originalBuilder;
        try {
            // The stack is left on one of Fastmail's pages, not on the one drawn here
            if (router.get('app') === 'settings') {
                controller.go(startViewId && startViewId !== 'notifications' ? startViewId : 'preferences');
            }
        } catch (error) {}
    }
    router.goApp('mail');
    await until(() => router.get('app') === 'mail', 10000);
    await wait(500);
}
const restored = {
    bridge: hadNotifications ? window.native.notifications === originalNotifications : !own(window.native, 'notifications'),
    register: controller ? own(controller, 'register') === hadOwnRegister : true,
    builder: controller ? controller._registeredViews.notifications === originalBuilder : true,
    preferences: fastmailPrefs() === prefsBefore,
    mail: router.get('app') === 'mail'
};
const failed = Object.keys(checks).filter(name => checks[name] !== true);
return JSON.stringify({
    pass: failed.length === 0 && Object.values(restored).every(Boolean),
    failed, restored, checks, sets: sets(), faults, path: location.pathname
}, null, 1);
"""

OUT.write_text(HEAD + SCOPE + BODY, encoding="utf-8")
print(f"wrote {OUT}")
```

- [ ] **Step 2: Run it to see it fail**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
python3 "$SCRATCH/gen-notifications-probe.py" "$SCRATCH/notifications-probe.js"
```
Expected: a line starting `FAIL:` that names the marker `The Notifications page, on the phone and the iPad.`, with exit status 1.

- [ ] **Step 3: Write the page's parts**

In `Userscript/fastmail-custom-mode.user.js`, find the end of Task 6's `settingsPage`:

```js
    const settingsPage = (classes, controller) => settingsPageView(
        classes, controller, SETTINGS_PAGE_ID, SETTINGS_PAGE_TITLE, () => [settingsPane(classes)]
    );
```

Directly after it, and before the blank line and `    /*\n     * Reaching the page.`, insert:

```js

    /*
     * The Notifications page, on the phone and the iPad. Fastmail's own page
     * draws its choices only inside Fastmail's app; in the shells it shows
     * only the app store badges. So where the shell offers
     * window.native.notifications, which it does on iPhone and iPad and never
     * on the Mac, this page takes Fastmail's notifications id. It is built
     * from the Custom mode page's parts: the same page view, header and
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
            description: 'Choose senders and labels to notify for.' }
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
        ['PageHeaderView', 'CopyTextView', 'ListInputView', 'MenuButtonView', 'MailboxMenuView', 'SubscreenSelectView']
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
     * The labels, drawn with Fastmail's own list, menu button and mailbox
     * menu, the way its page draws them. The menu offers the Inbox and
     * mailboxes without a role. Both lists answer { view, show(ids) }, where
     * show puts ids chosen elsewhere into the list on screen.
     */
    const fastmailLabelList = (classes, accountId, ids, changed) => {
        const el = FastMail.el;
        const list = new classes.ListInputView({
            label: 'Labels',
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
        return { view: list, show: (next) => list.set('value', next.slice()) };
    };

    // The same list from parts that are always there: the list's own markup,
    // a remove button per label, and a select to add one.
    const plainLabelList = (classes, accountId, ids, changed) => {
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
                    el('legend.u-font-semibold.u-trim', ['Labels']),
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
```

- [ ] **Step 4: Write the pane and the page**

Directly after `plainLabelList`'s closing `    };`, insert:

```js

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
    const notificationsPane = (classes, controller, bridge) => {
        const el = FastMail.el;
        const mobile = isMobileSettings(controller);
        const accountId = primaryMailAccountId();
        const state = {
            status: 'loading', mode: null, senders: 'everyone', mailboxIds: [],
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
        };

        const takeChoice = (reply) => {
            if (!reply || NOTIFICATION_MODES.every(one => one.value !== reply.mode)) {
                throw new Error('the app answered no notification choice');
            }
            state.mode = reply.mode;
            state.senders = NOTIFICATION_SENDERS.some(one => one.value === reply.senders) ? reply.senders : 'everyone';
            state.mailboxIds = Array.isArray(reply.mailboxIds)
                ? reply.mailboxIds.filter(id => typeof id === 'string' && id) : [];
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
            const next = { mode: state.mode, senders: state.senders, mailboxIds: state.mailboxIds.slice() };
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

        const drawLabels = () => {
            const changed = (ids) => choose({ mailboxIds: ids });
            const fastmails = ['ListInputView', 'MenuButtonView', 'MailboxMenuView']
                .every(name => typeof classes[name] === 'function');
            return fastmails
                ? fastmailLabelList(classes, accountId, state.mailboxIds, changed)
                : plainLabelList(classes, accountId, state.mailboxIds, changed);
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
                    views.labels = drawLabels();
                    controls.push(el('div.u-space-y-5', [views.senders, views.labels.view]));
                }
                sections.push(pageSection(NOTIFICATIONS_PAGE_ID, { id: 'messages', title: 'New messages' }, controls));
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
```

- [ ] **Step 5: Write the install**

Directly after `notificationsPage`'s closing `    );`, insert:

```js

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

    // Called whenever the Custom mode page is: the Settings controller exists
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
```

- [ ] **Step 6: Call it where the Custom mode page is ensured**

In `watchSettingsApp`, replace:

```js
                    ensureSettingsPage();
                }
            }, 'check');
        }
        ensureSettingsPage();
    };
```

with:

```js
                    ensureSettingsPage();
                    ensureNotificationsPage();
                }
            }, 'check');
        }
        ensureSettingsPage();
        ensureNotificationsPage();
    };
```

In `dressSettingsList`, replace:

```js
    const dressSettingsList = () => {
        ensureSettingsPage();
```

with:

```js
    const dressSettingsList = () => {
        ensureSettingsPage();
        ensureNotificationsPage();
```

- [ ] **Step 7: Run the live check to see it pass**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
node --check /Users/mdbraber/src/fastmail-custom/Userscript/fastmail-custom-mode.user.js
python3 "$SCRATCH/gen-notifications-probe.py" "$SCRATCH/notifications-probe.js"
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/notifications-probe.js\" as «class utf8»)" | tee "$SCRATCH/notifications-probe.out"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return FastMail.router.get(\"app\") + \" \" + location.pathname"'
```
Expected:
- `"pass": true` and `"failed": []`
- every `"restored"` entry `true`
- `"sets"` holds exactly five choices: custom/everyone/[Inbox], custom/vips/[Inbox], custom/vips/[Inbox, label], custom/vips/[Inbox], off/vips/[Inbox]
- `"faults"` holds exactly two entries, both from the isolated checks:
  - `the Notifications page could not be drawn; Fastmail’s own page stands in (missing classes)`
  - `the Notifications page could not be added; Fastmail’s own page stands in`
- the last line starts `mail /mail/`

Run this check before any build carrying this plan's userscript is installed in the Mac app. The app runs the userscript copy bundled at install, so today its running copy has no Notifications page code. After such an install, the running copy would also take the id while the stand-in `window.native.notifications` is present, and the checks would measure two installs at once.

If a check fails, fix the userscript and run Step 7 again. Change the probe only if it reads something the page does not promise, and say so in the task report. If the run throws before `finally`, confirm by hand that the last command prints `mail`. Also confirm that Fastmail's own Notifications page opens normally in the Mac app: Settings → Notifications shows its app store badges.

- [ ] **Step 8: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Userscript/fastmail-custom-mode.user.js
git commit -m "$(cat <<'EOF'
feat: a Notifications page on iPhone and iPad, built from Fastmail's own parts

Where the shell offers window.native.notifications, the userscript takes
Fastmail's notifications page id: four boxed choices, Custom's senders and
labels, the permission and contacts warnings, and the push id. The choice
goes to the app; Fastmail's own preferences are never touched. If the page
cannot be built, Fastmail's own page is handed back.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
)"
```

---

### Task 8: On the user's iPhone and iPad

**Files:** none. This task changes nothing; it confirms Tasks 1-7 on the devices.

**Interfaces:**
- Consumes: everything above, plus the push server from plan 2, whose `/healthz` reports `modes` and `contacts` per account.
- Produces: a recorded pass per check, or a list of defects to fix before the work is called done.

- [ ] **Step 1: Check the push server is plan 2's**

Important and Custom only have an effect once plan 2 is deployed. `/healthz` is an unauthenticated read, not a change on the host. The host is `PUSH_SERVER_HOST` in the git-ignored `Config/Local.xcconfig`; do not copy it into any tracked file or into the ledger.

```bash
cd /Users/mdbraber/src/fastmail-custom && curl -s "https://$(awk -F' *= *' '/^PUSH_SERVER_HOST/ {print $2}' Config/Local.xcconfig)/healthz"
```

Expected: each account carries `modes` and `contacts`. If they are missing, the server predates plan 2. Tell the user that Important and Custom will act as All in inbox until it is deployed, and ask whether to go on.

- [ ] **Step 2: Ask before installing**

Ask the user for a go-ahead, stating what each command does, and stop until it is given:
- **iPhone:** `make install-ios DEVICE=<iPhone identifier>` installs Personal, Work and Mailto. On 2026-09-13 the iPhone was `68584880-5010-5FD9-B899-FBCB5273FA46`; confirm with `xcrun devicectl list devices`. A bare `make install-ios` lands on the iPad.
- **iPad:** `make install-ios DEVICE=<iPad identifier>`.
- **Alternatively,** `make deploy` installs to every paired device and relaunches the Mac apps with `pkill`. That also lets the Mac check in Step 9 run.

If an install is refused, record its checks as outstanding, not as passed.

- [ ] **Step 3: The page on iPhone and iPad**

Give the user this list, for the Personal app first and then the Work app, on each device, and record each answer:
1. Settings → Notifications shows the new page, not Fastmail's app store badges.
   - On the iPhone it slides in with a back arrow that returns to Settings.
   - On the iPad the Notifications entry is highlighted in the sidebar.
2. The heading is "New messages", with four boxed choices and Fastmail's icons: Off (cancelled), Important messages only (star), All in inbox (tray) and Custom (gear). The descriptions read as in the spec.
3. The choice shown matches the old switch: All in inbox if "Notify for new mail" was on, Off if it was off.
4. "The push id for your device is" is followed by eight characters. The copy button copies the whole token: paste it in Notes and check that it is 64 characters starting with those eight.

- [ ] **Step 4: Custom's controls**

1. The first time Custom is chosen, the label list holds Inbox and "Notify for messages from" says Everyone.
2. On the iPhone, "Notify for messages from" opens its options as a page of their own; choosing VIPs returns with VIPs shown.
3. "Add label" opens a menu of the Inbox and labels. Choosing one adds it to the list, and its remove button takes it out again.
4. Choosing All in inbox and then Custom again finds the list as it was left.

- [ ] **Step 5: The warnings**

1. With a choice other than Off, turn notifications off for the app in iOS Settings, then come back. "Notifications are turned off for this app in iOS Settings." shows, with "Open Settings".
2. "Open Settings" opens the app's notification page in iOS Settings. Turn notifications back on and come back: the warning is gone without leaving the page.
3. Choosing Off hides the permission warning.
4. While `/healthz` says `contacts: false` for the account, choosing Important, or Custom with Contacts or VIPs, shows "The push server cannot read your contacts, so VIPs and contacts get no notifications."; Everyone and All in inbox do not. Once the server has contacts access and the app has registered again (switch choices once), the warning is gone.

- [ ] **Step 6: The choices reach the server**

For each of Off, Important messages only, All in inbox and Custom, choose it on the iPhone and run the Step 1 command. Record that the account's `modes` counts the change. Leave the app and come back once if it has not arrived: a failed registration is retried on activation. Personal and Work count separately.

- [ ] **Step 7: An alert per choice**

Send test mail to the account and record what arrives on the locked iPhone:
- **Off:** no alert; the badge still updates.
- **All in inbox:** an alert for a new Inbox message.
- **Important messages only:**
  - an alert for a message from a VIP
  - an alert for a reply in a conversation marked as followed
  - no alert for an ordinary sender
- **Custom:**
  - With a label and Everyone: an alert for a message filed only under that label, and none for a message only in the Inbox when Inbox is not in the list.
  - With Contacts or VIPs: only those senders alert.

- [ ] **Step 8: It stays chosen**

Quit the app from the app switcher and open it again. The page shows the same choice, and `/healthz` still counts it.

- [ ] **Step 9: Elsewhere keeps Fastmail's page**

1. In Safari, Fastmail's Settings → Notifications is Fastmail's own page.
2. Only if the Mac apps were installed with the user's go-ahead: in `mdbraber.com`, Settings → Notifications is Fastmail's own page.

- [ ] **Step 10: Record the result**

Write what passed and what did not into the ledger, naming the device and app for each. Any defect is fixed, and its task's checks are re-run.

---

## Self-review

**Spec coverage (Part 3 and its Testing items).**

| Spec requirement | Where |
|---|---|
| Page under Fastmail's `notifications` id, only with `window.native.notifications`; built with the Custom mode page's classes, header and highlight | Task 6 (shared parts), Task 7 (install, ensure); the highlight is Fastmail's own for its own id, checked in Task 7's probe |
| Harness adds the object on iPhone and iPad only, never under Electron; `state()`, `set()`, `openSettings()` | Task 4 |
| Safari and the Mac keep Fastmail's page | Task 4 (no object under Electron), Task 7 (nothing without the object), Task 8 Step 9 |
| If registering fails, Fastmail's page stays and the fault is reported the Custom mode way | Task 7 (`giveUp`, `ensureNotificationsPage`, `reportFault`; probe checks 11 and 12) |
| Permission warning, text, "Open Settings" | Task 7 (`needsPermissionWarning`, `notificationBanner`), Task 3 (`openNotificationSettings`), Task 8 Step 5 |
| Contacts warning and its rule | Task 7 (`needsContactsWarning`), Task 2 (`push.contacts`), Task 8 Step 5 |
| "New messages" and the four boxed choices with icons and copy | Task 7 (`NOTIFICATION_MODES`, `notificationChoiceLabel`, `NOTIFICATION_GLYPHS`) |
| Custom: senders select; label list with remove and "Add label" menu; first time Inbox and Everyone; Fastmail's list classes or a fallback | Task 7 (`drawSenders`, `fastmailLabelList`, `plainLabelList`, `choose`) |
| Push id: 8 characters, copy copies all, absent without a token | Task 7 (`notificationPushId`), Task 3 (`pushTokenHex`) |
| No sound select, no Calendar alerts | Task 7 draws neither |
| `state()` → `notificationState`, reply shape, null while unknown | Tasks 1, 3, 4 |
| Asks again when the window regains focus | Task 7 (`didEnterDocument` listeners), probe check 9 |
| `set()` → `setNotifications`: saves `push.mode`/`senders`/`mailboxIds` per app and registers through the single-flight registration | Tasks 2, 3 |
| Registration due compares acknowledged and saved; failure retried on activation | Task 2 (`registrationDue`, `send`, unchanged `becameActive`) |
| Registrar saves `contacts` from each reply | Task 2 |
| `openSettings()` → `openNotificationSettings` → iOS Settings | Task 3 |
| Migration from `push.alerts` | Task 2 (`migrate`, called in `PushRegistrar.init`) |
| Fastmail's own preferences never written | Task 7 draws from the app's state only; the probe compares them before and after |
| Swift tests: migration, registration body with `notify`, registration due | Task 2 |
| Live checks: page drawn with a stand-in bridge, not registered without it, Fastmail's preferences unchanged, back on mail | Task 7 Step 7 |
| Devices: the four choices reaching the server (`/healthz` `modes`), an alert per choice | Task 8 |

**Placeholder scan.** Every code step carries its code, and every command gives its expected output. The only values left to a person are the iPad's device identifier, read from `xcrun devicectl list devices`, and the push server's host, read from the git-ignored config.

**Type consistency.** These names are spelled the same in every task:
- Swift:
  - `NotificationChoice` (`Mode`, `Senders`, `maxMailboxIds`, `jsonObject`, `json`, `jsonText`, `Invalid`, `parse`)
  - `NotificationState` (`Permission(status:)`, `choice`, `permission`, `pushToken`, `contacts`, `json`)
  - `PushPreferences` (`modeKey`, `sendersKey`, `mailboxIdsKey`, `contactsKey`, `acknowledgedKey`, `legacyAlertsKey`, `legacyAcknowledgedKey`, `migrate`, `choice`, `save`, `contacts`, `registrationDue`, `acknowledge(_:contacts:in:)`)
  - `PushConfig` (`hex`, `registration(account:deviceToken:choice:)`, `contacts(fromRegistrationReply:)`)
  - `PushRegistrar` (`pushTokenHex`, `choiceChanged()`)
  - `NativeBridge` (`onNotificationState`, `onSetNotifications`, `onOpenNotificationSettings`)
  - `NotificationSettings` (`state()`, `save(_:)`, `openSystemSettings()`)
- Bridge actions: `notificationState`, `setNotifications`, `openNotificationSettings`.
- JavaScript:
  - the harness's `window.native.notifications.state/set/openSettings`
  - `findClasses`, `pageSection`, `isMobileSettings`, `settingsPageView`
  - `NOTIFICATIONS_PAGE_ID`, `notificationsBridge`, `notificationsPageClasses`, `notificationsPane`, `notificationsPage`
  - `notificationsPageState`, `installNotificationsPage`, `ensureNotificationsPage`
- Page ids and selectors: section id `s-notifications-messages`.

**Checked while drafting (in the scratchpad, never in the repository).** Tasks 1-3's Swift was applied to a copy of the package:
- `swift test` passed all new and changed tests (319 tests). The only failures were two existing tests that read repository files by path from the copy's location.
- `xcodebuild -scheme FastmailShellKit -destination 'generic/platform=iOS Simulator'` built the iOS code.

Tasks 4, 6 and 7's JavaScript was applied to copies:
- `node --check` passed for the harness, the userscript and both wrapped probes.
- Both generators compile, and the Notifications generator produced its probe from the edited copy.

## Notes for the controller

1. **The object replies travel as JSON text.** `BridgeReply.value` is `String?`, so `notificationState` and `setNotifications` reply with JSON text, and the harness parses it. `state()` and `set()` still resolve to the contract's objects. If wrong: none at the page; a later change of `BridgeReply` to carry objects would make the parse redundant.
2. **The permission warning shows only for `denied`, not for `undetermined`.** The app asks at launch, and iOS Settings has no notification switch to show before that. If wrong: a device that was never asked shows no warning.
3. **`push.acknowledged` stores the choice the app sent, not the server's normalised `notify`.** Senders and labels are kept and sent with every mode, so leaving Custom and returning restores the list; "first time Custom" means an empty list. If wrong: a user who empties the list and later picks Custom again starts from the Inbox.
4. **Re-registration moved from the `UserDefaults` observer to an explicit `PushRegistrar.choiceChanged()`.** The page is the only writer, and keeping both would send duplicate POSTs through the single-flight repeat. The observer keeps only `HomeShortcuts.refresh()`. Also:
   - `push.alertsAcknowledged` is removed on migration, and `push.alerts` is left in place.
   - `push.contacts` is removed when a reply carries no flag.

   If wrong: a choice written by any other path would wait for the next activation.
5. **The page relies on private internals.**
   - It loads Fastmail's own Notifications module through `controller.getModuleForViewId('notifications')`, which is how `ListInputView` and the other classes become reachable on the phone.
   - It wraps `controller.register` so Fastmail's later registration is kept aside, and it relies on the private `_registeredViews`.

   Task 5 re-measures this, and any build failure hands the page back to Fastmail's builder. If wrong: a Fastmail change costs this page and nothing else.
6. **The Add label menu differs slightly from Fastmail's own page.**
   - It passes `rolesVisible: { inbox: true, none: true }`, so it lists only the Inbox and labels, as the spec says; Fastmail's own lists every mailbox.
   - It passes no `popOverView`. Fastmail uses a shared instance from a module the userscript cannot reach, so `MenuButtonView` makes its own `PopOverView`.
   - The senders select is `SubscreenSelectView` on the mobile build, as Fastmail's page is, and `SelectView` elsewhere, so the Mac probe exercises only `SelectView`.

   If wrong: the menu's and the select's presentation on the phone, which Task 8 Step 4 checks.
7. **Presentation rulings.**
   - The warning text is the banner's title (semibold, with the attention glyph), with no body paragraph.
   - The choices are disabled only while loading. Fastmail's own page disables them while its permission banner shows, which would stop anyone from choosing Off.
   - A label the store does not know is shown as "Unknown label" rather than dropped, since the page does not call `fetchAll`.
   - The page listens for `visibilitychange` as well as `focus`.

   If wrong: copy or look only.
8. **Read-only probes ran against `mdbraber.com` while drafting.** They fetched module text, listed classes, and made two throwaway views that never entered the document. They did not navigate or write. One probe called `getModuleForViewId('notifications')` once, which loads Fastmail's desktop Notifications module and registers its builder, as opening that page does. Task 5 does the same. If wrong: none known.
9. **Plan 1 dependency.** Task 2 Step 1 stops if `SettingsBundleTests.swift`, `tools/gen-settings-bundle.py` or any other reader of `PushPreferences.alertsKey` still exists. If wrong: the plan pauses until plan 1 lands.
10. **The userscript's `@version` is not bumped.** If wrong: one line, if the Safari extension's update detection needs it.
