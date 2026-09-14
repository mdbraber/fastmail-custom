# Custom Mode Settings Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Custom mode's settings follow each Fastmail account between the user's Mac, iPhone and iPad through iCloud key-value storage, in the Personal and Work apps and in the Safari extension, with a "Sync settings with iCloud" switch on Custom mode's settings page.

**Architecture:**
- **The rules** (`SettingsSyncRules.swift`) are pure and use Foundation only: the key format `<account id>.<setting>`, the local-only list, the join decision, adoption, and the Safari native part's answers. The Safari extension compiles this same file by reference.
- **The apps** get one `CustomModeSettingsSync` per process, on `NSUbiquitousKeyValueStore.default`. It keeps `settingsSync.*` state in `UserDefaults`, copies changes both ways and joins each account the first time. The bridge gains `account` and `settingsSync`, and the existing pusher carries the switch's state into open pages.
- **The Safari extension**: its native part answers `get` and `set`. `background.js` keeps a set per account and asks the native part on account report, tab activation and a 5-minute alarm. `early.js` saves page writes under the page's account.
- **The userscript** reports its account once Fastmail knows it and draws the switch where the host injects `window.__customModeSync`.

**Tech Stack:**
- Swift 6 package `FastmailShellKit` (Swift Testing), with XCTest for the macOS `IntegrationTests` scheme.
- The Safari extension's native part: Swift 5, macOS deployment target 10.14.
- `harness.js`, the userscript, and `background.js`/`early.js`, plain JavaScript, checked with `node --check`, a node stand-in run and live read-only probes in the Mac app.

**Spec:** `docs/superpowers/specs/2026-09-14-custom-mode-settings-sync-design.md`, Parts 1-4, Testing and Risks.

## Global Constraints

**Rules every plan carries**
- **Toolchain.** The Swift package targets Swift 6 with language mode 6 (`swift-tools-version: 6.0`), macOS 14 and iOS 17 (`Package.swift`: `platforms: [.iOS(.v17), .macOS(.v14)]`). Package tests use Swift Testing (`import Testing`, `@Test`, `#expect`); `Tests/IntegrationTests` uses XCTest.
- **Test commands.**
  - Package: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test`
  - Whole suite: `cd /Users/mdbraber/src/fastmail-custom && make test` (package tests, the IntegrationTests scheme, `cd Server && npm test`, `node --check` of the userscript and of `SafariExtension/*.js`).
  - iOS build check (installs nothing):
    ```bash
    cd /Users/mdbraber/src/fastmail-custom && make generate && xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'generic/platform=iOS' -configuration Debug -derivedDataPath build/ios-app CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
    ```
    Expected: `** BUILD SUCCEEDED **`.
  - Swift under `#if canImport(UIKit)` is not compiled by `make test`, which builds for macOS.
- **Known crash.** An integration-test crash inside AppKit's `NSWindowStackController` ("expected no items") is a known intermittent fault: re-run once and say so in the task report.
- **Server tests.** This plan changes nothing in `Server/`. If `make test` stops making progress inside `cd Server && npm test`, a Server watcher test is failing: run `cd /Users/mdbraber/src/fastmail-custom/Server && npm test -- --test-force-exit` to see which, and report it rather than fixing it.
- **Nothing identifying in tracked files.** No host name, token, team id or real Fastmail account id may appear in any tracked file, commit message or task report. Entitlements use `$(TeamIdentifierPrefix)`; tests use example ids such as `u1234abcd`. The team id is read from the git-ignored `Config/Local.xcconfig` when a command needs it. `SafariExtension/README.md` and the Safari project's `project.pbxproj` already carry the team id from an earlier change; this plan adds no copy of it, and no step types it.
- **Commits.**
  - Stage only the task's own files, by path. Never `git add -A`, `git add .` or `git commit -a`: other sessions commit to main in this checkout.
  - Before staging, run `git diff -- <file>` for each file. If a file holds hunks that are not this task's, stop and tell the controller rather than committing them.
  - Each commit message ends with exactly:
    ```
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
    ```
  - In zsh, pass the message with a quoted heredoc to `git commit -F -`, as its own command, never chained after `&& \`.
- **Probes in the Mac app are read-only.**
  - Never write Fastmail's data or preferences, or a real Custom mode setting.
  - Never choose an option in any Fastmail menu.
  - Restore any patch, and leave the app on mail.
  - Probes run only while the Mac is awake; the web view stalls overnight.
- **User go-aheads.** `make install-ios`, `make install-macos`, `make install-extension` and `make deploy` happen only with the user's go-ahead, given at that time. A step that needs one says "ask the user" and stops there.

**Stored state**

The apps, in `UserDefaults.standard` of each app on each device (Personal and Work separately):

| Key | Type | Default |
|---|---|---|
| `customMode.<setting>` | Bool or String, as today | absent = the page's default |
| `settingsSync.accountId` | String: the last account a page reported | absent |
| `settingsSync.joined.<account id>` | Bool: true once that account has had its first sync on this device | absent = not joined |
| `settingsSync.enabled` | Bool: the switch | absent = on |

iCloud key-value store `$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.personal`, shared by both apps and the Safari extension:

| Key | Type | Written by |
|---|---|---|
| `<account id>.<setting>` | Bool or String | an app's upload on first sync, and each later change in an app or in Safari |

The Safari extension, in `storage.local`:

| Key | Type | Default |
|---|---|---|
| `settings` | object | the set a tab gets before any account is known, and the starting set for an account seen for the first time |
| `settingsByAccount` | `{<account id>: object}` | absent |
| `lastAccountId` | String | absent |
| `tabAccounts` | `{<tab id>: <account id>}` | absent |
| `joinedAccounts` | `[String]` | absent = none |
| `syncEnabled` | Bool | absent = on |

**Rules (one definition each, in `SettingsSyncRules`)**
- Account id: `^[A-Za-z0-9_-]{1,32}$`.
- Setting part: `CustomModeSettings.isWritableSettingKey`'s rule, letters and digits starting with a letter.
- Store key: `<account id>.<setting>`, at most 64 bytes.
- Local-only settings: `bottomBarItems`, `topBarItems`.
- An app uploads to an empty store only after the initial-sync notice in this launch, or 30 seconds after this launch's first successful `synchronize()` with an iCloud identity present.
- Safari never uploads a whole set, and asks the native part every 5 minutes.

**App ↔ page contract**
- Bridge actions in `NativeBridge.handle`:
  - `account`, payload `{accountId}`: an id that fails the account id rule is refused with `account payload has no usable accountId`.
  - `settingsSync`, payload `{enabled}`: anything but a real boolean is refused with `settingsSync enabled must be a boolean`.
  - Both reply with no value.
- The harness defines `window.native.account(accountId)` and `window.native.setSettingsSync(enabled)`, each returning what `post()` returns.
- `window.__customModeSync = {enabled}` is set only by a host that can sync:
  - the apps at document start, and again before each `applySettings` push;
  - Safari at tab load, and again before each `applySettings` push.

**Page ↔ Safari contract**
- The page posts to its own window, as setting writes already do:
  - `{source: 'custom-mode', kind: 'account', accountId}`
  - `{source: 'custom-mode', kind: 'sync', enabled}`
- `early.js` sends the background script:
  - `{kind: 'account', accountId}`
  - `{kind: 'sync', enabled}`
  - `{kind: 'setting', accountId, key, value}`, after it has saved the setting
- The background script sends the native part (`browser.runtime.sendNativeMessage`):
  - `{action: 'get', accountId}` → `{ok: true, available, settings}`
  - `{action: 'set', accountId, key, value}` → `{ok: true}`
  - Anything refused → `{ok: false, error}`

**Copy (exact strings)**
- Switch title: "Sync settings with iCloud"
- Switch hint: "Keeps these settings the same on your other devices for this Fastmail account. The bar lengths stay on each device. Turning syncing on takes the settings already in iCloud."

## Verified facts

Read from the repository and the SDK on 2026-09-14.

**The package**
- `CustomModeSettings.isWritableSettingKey` checks `first.isASCII, first.isLetter` and `allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }`. `current(from:)` collects `customMode.*`, keeping CFBoolean and String values only.
- `bootstrapScript(from:)` is `window.__customModeSettings = <json>;` at document start in the main frame only. `applyScriptSource(from:)` sets the global and calls `window.customMode.applySettings`.
- `NativeBridge.handle`'s `setting` action refuses a non-CFBoolean `NSNumber`. The bridge's init ends with `onOpenNotificationSettings`.
- `WebContainer.makeWebView`:
  - builds one `NativeBridge` per web view, with `onSetting` writing `UserDefaults.standard` and, on iOS, refreshing the home-screen shortcuts;
  - adds `CustomModeSettings.bootstrapScript()` before the userscripts;
  - sets `coordinator.settingsPusher = CustomModeSettingsPusher(webView: webView)`.
- `CustomModeSettingsPusher` observes `UserDefaults.didChangeNotification`, waits 500 ms, and pushes only when `CustomModeSettings.json(from: .standard)` differs from what it last pushed. `WebCoordinator.webView(_:didFinish:)` calls `settingsPusher?.pageLoaded()`.
- `PushRegistrar` (iOS) refreshes `HomeShortcuts` on every `UserDefaults.didChangeNotification`. `HomeShortcuts.badgeLabel` reads `customMode.appBadgeLabel`.
- `AppShell` is per window (inside `WindowGroup`) and creates `WebContainer`. `PersonalApp` and `WorkApp` are the per-process entry points, with no `init()` today.
- SwiftUI's `App` protocol is `@preconcurrency @MainActor` in the macOS 26.5 SDK, so an `init()` there may call main-actor code.
- Foundation's `NSUbiquitousKeyValueStore` change reasons are, in order, server change, initial sync, quota violation, account change: 0, 1, 2, 3.
- `WebContainerTests` builds web views with no sync component installed and checks that the first user script starts `window.__customModeSettings = {`.
- `SettingsParityTests` finds repository files from `#filePath`, five levels up.

**The harness and the userscript**
- `harness.js` `post()` resolves `null` when there is no handler or the reply is an error. `window.native.setSetting` is at line 779.
- `writeSetting` picks the host from `window.native.setSetting`, then `hostIsExtension()` (`data-custom-mode-host="extension"` on the root element), then `localStorage`.
- `primaryMailAccountId()` already reads `FastMail.auth.get('primaryAccounts')['urn:ietf:params:jmap:mail']`.
- The settings page is drawn in `settingsPane`, one `settingsSection` per `SETTING_GROUPS` entry. `general` is the first group and holds only `appBadgeLabel`. Toggle rows are `ToggleView({label, description, value})` with an `addObserverForKey('value', …)` observer.
- `applySettings` does not redraw the settings page.
- `start()` runs once `isReady()` passes, which needs a drawn mailbox source. `startSettingsPage()` runs earlier, from the `mainObserver` callback and at the end of the file, as soon as `settingsPageCanStart()` passes.
- `View.prototype.viewNeedsRedraw` and `get('isInDocument')` are already used by the userscript.

**The Safari extension**
- `manifest.json` permissions are `scripting`, `tabs` and `storage`. The background script is a service worker.
- `early.js` accepts only `kind: 'setting'` messages and writes `storage.local.settings`, serialised through `pendingWrite`.
- `background.js` injects `storage.local.settings` and pushes it to every Fastmail tab on any `storage.onChanged`.
- `SafariWebExtensionHandler.swift` is Xcode's echo template.
- The extension target (`6BD49789302BA54200196E0B`):
  - Swift and platform: `SWIFT_VERSION = 5.0`, `MACOSX_DEPLOYMENT_TARGET = 10.14`, `SWIFT_UPCOMING_FEATURE_MEMBER_IMPORT_VISIBILITY = YES`.
  - Signing: `ENABLE_APP_SANDBOX = YES`, `CODE_SIGN_STYLE = Automatic`, and no `CODE_SIGN_ENTITLEMENTS`.
  - It uses explicit `PBXGroup`s, not synchronised folders, so a new file needs a file reference and a build-file entry.
  - Its Sources phase is `6BD49786302BA54200196E0B`, and its group `6BD4978E302BA54200196E0B`.
- `make build-extension` builds Release without `-allowProvisioningUpdates`; `build-macos` and `build-ios` pass it.
- The throwaway spike showed:
  - the extension's native part writing and reading a shared store (sandboxed);
  - the host app receiving the external-change notice for the extension's key in the same second.

**Entitlements today**
- `Apps/Personal/iOS.entitlements` and `Apps/Work/iOS.entitlements` hold only `aps-environment`.
- The two `macOS.entitlements` files hold `com.apple.application-identifier` and `com.apple.developer.team-identifier`.
- `project.yml` points `CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]` and `[sdk=macosx*]` at them. The Mac apps are not sandboxed.

## File Structure

- **Create** `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift`: the pure rules, also compiled into the Safari extension. (Task 2)
- **Create** `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettingsSync.swift`: the apps' sync component and the `KeyValueStore` protocol (Task 3); `current`, `install()` and the store's conformance (Task 5).
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`: the `account` and `settingsSync` actions. (Task 4)
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift`: the sync line in the bootstrap and apply scripts. (Task 4)
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`: the pusher compares the whole script (Task 4); wiring the sync component (Task 5).
- **Modify** `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`: `window.native.account` and `window.native.setSettingsSync`. (Task 4)
- **Modify** `Apps/Personal/PersonalApp.swift`, `Apps/Work/WorkApp.swift` and the four app entitlements files. (Task 5)
- **Modify** `Userscript/fastmail-custom-mode.user.js`: the account report and the switch. (Task 6)
- **Create** `SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode Extension/Fastmail Custom Mode Extension.entitlements`. (Task 7)
- **Modify** in `SafariExtension/` (Task 7):
  - `App/Fastmail Custom Mode/Fastmail Custom Mode.xcodeproj/project.pbxproj`
  - `App/Fastmail Custom Mode/Fastmail Custom Mode Extension/SafariWebExtensionHandler.swift`
  - `manifest.json`
- **Modify** `Makefile`: `build-extension` passes `-allowProvisioningUpdates`. (Task 7)
- **Modify** `SafariExtension/background.js`, `SafariExtension/early.js` and `SafariExtension/README.md`. (Task 8)
- **Tests** in `Packages/FastmailShellKit/Tests/FastmailShellKitTests/`:
  - create `SettingsSyncRulesTests.swift` (Task 2)
  - create `CustomModeSettingsSyncTests.swift` (Task 3)
  - append to `NativeBridgeTests.swift`, `CustomModeSettingsTests.swift` and `CustomModeSettingsPusherTests.swift` (Task 4)
  - append to `WebContainerTests.swift` (Task 5)
  - append to `SettingsParityTests.swift` (Tasks 7 and 8)
- **Tests elsewhere:** modify `Tests/IntegrationTests/HarnessTests.swift`. (Task 4)
- **Scratch, never committed**, in `$SCRATCH`, which is `/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad`:
  - `kvs-spike/` edits and `probe-account-id.js` (Task 1)
  - `gen-sync-probe.py` (Task 6)
  - `edit-safari-project.py` (Task 7)
  - `check-safari-scripts.js` (Task 8)

Order is load-bearing:
- Task 1 stops the plan if a non-sandboxed Mac app cannot use the store, or if a real account id fails the rule.
- The rules (Task 2) come before everything that uses them. The component (Task 3) comes before the bridge and pusher (Task 4), which come before the wiring (Task 5).
- The harness (Task 4) comes before the userscript calls it (Task 6).
- The native part (Task 7) comes before the scripts that ask it (Task 8).
- Nothing reaches a device before Task 9. Until then no app installs the component, so nothing touches iCloud.

## Running a probe

```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/<probe>.js\" as «class utf8»)"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return FastMail.router.get(\"app\") + \" \" + location.pathname"'
```

A probe is a function body: it may `await` and must `return` a string. See `/Users/mdbraber/.claude/projects/-Users-mdbraber-src-fastmail-custom/memory/probing-the-mac-app-live.md`. The second command must print `mail /mail/…` after every probe run. If it does not, run `osascript -e 'tell application "mdbraber.com" to do JavaScript "FastMail.router.goApp(\"mail\"); return \"ok\""'` and say so in the task report.

---

### Task 1: Confirm a non-sandboxed Mac app can use iCloud key-value storage (controller-run, read-only)

**Files:**
- Scratch: `$SCRATCH/kvs-spike/project/KVSSpike/KVSSpike/AppDelegate.swift` (rewritten), `$SCRATCH/kvs-spike/NoSandbox.entitlements`, `$SCRATCH/probe-account-id.js`
- No repository file changes, and no commit.

**Interfaces:**
- Consumes: the throwaway spike in `$SCRATCH/kvs-spike/` (the converter's `project/KVSSpike/` with scheme `KVSSpike`, app bundle id `com.mdbraber.kvs-spike`); the installed Mac apps `mdbraber.com` and `nexthealth.nl`.
- Produces: a recorded pass on two counts, which every later task relies on:
  - a non-sandboxed, signed Mac app wrote to the store with `synchronize=true` and `signedIn=true`, and a second copy heard it as an external change;
  - each Mac app's primary mail account id passes `^[A-Za-z0-9_-]{1,32}$`.

- [ ] **Step 1: Make each running copy write a key of its own**

Replace the whole of `$SCRATCH/kvs-spike/project/KVSSpike/KVSSpike/AppDelegate.swift` with:

```swift
// Throwaway spike, second round: can an app that is NOT sandboxed use the
// iCloud key-value store? Each running copy writes a key of its own at launch,
// logs the store's answers, and logs every external change, so two copies
// started with `open -n` show whether one hears the other
// (subsystem com.mdbraber.kvs-spike, category app).

import Cocoa
import os.log

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    private let log = Logger(subsystem: "com.mdbraber.kvs-spike", category: "app")
    private var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let store = NSUbiquitousKeyValueStore.default
        let pid = ProcessInfo.processInfo.processIdentifier
        let ownKey = "spike.instance.\(pid)"
        let signedIn = FileManager.default.ubiquityIdentityToken != nil
        let sandboxed = ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil

        NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: store, queue: .main
        ) { [weak self] note in
            let reason = note.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int ?? -1
            let keys = note.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
            self?.log.notice("pid=\(pid) changed externally reason=\(reason) keys=\(keys.joined(separator: ","), privacy: .public)")
        }

        let value = ISO8601DateFormatter().string(from: Date())
        store.set(value, forKey: ownKey)
        let synced = store.synchronize()
        log.notice("pid=\(pid) launch wrote \(ownKey, privacy: .public) synchronize=\(synced) signedIn=\(signedIn) sandboxed=\(sandboxed)")

        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            _ = store.synchronize()
            let others = store.dictionaryRepresentation.keys
                .filter { $0.hasPrefix("spike.instance.") && $0 != ownKey }
                .sorted()
            self?.log.notice("pid=\(pid) poll others=\(others.joined(separator: ","), privacy: .public)")
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
```

- [ ] **Step 2: Write entitlements with the store and nothing else**

Create `$SCRATCH/kvs-spike/NoSandbox.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.ubiquity-kvstore-identifier</key>
    <string>$(TeamIdentifierPrefix)com.mdbraber.kvs-spike</string>
</dict>
</plist>
```

- [ ] **Step 3: Build the host app without the App Sandbox**

The team comes from the git-ignored config and is passed on the command line only. The command-line settings also reach the spike's extension target, which is built but never run here.

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
SPIKE="$SCRATCH/kvs-spike"
TEAM="$(awk -F' *= *' '/^DEVELOPMENT_TEAM/ {print $2}' /Users/mdbraber/src/fastmail-custom/Config/Local.xcconfig)"
test -n "$TEAM" || echo "FAIL: no DEVELOPMENT_TEAM in Config/Local.xcconfig"
xcodebuild -project "$SPIKE/project/KVSSpike/KVSSpike.xcodeproj" -scheme KVSSpike -configuration Debug \
  -derivedDataPath "$SPIKE/build-nosandbox" -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" ENABLE_APP_SANDBOX=NO CODE_SIGN_ENTITLEMENTS="$SPIKE/NoSandbox.entitlements" \
  build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
```
Expected: `** BUILD SUCCEEDED **`. If signing or provisioning fails, stop and report the error lines. Do not work around them.

- [ ] **Step 4: Check what it was signed with**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
APP="$SCRATCH/kvs-spike/build-nosandbox/Build/Products/Debug/KVSSpike.app"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -p - | grep -E "ubiquity-kvstore|app-sandbox"
```
Expected: exactly one line, `"com.apple.developer.ubiquity-kvstore-identifier" => "<team>.com.mdbraber.kvs-spike"`, and no `app-sandbox` line. Write `<team>` in the report, not the value.

- [ ] **Step 5: Start one copy and wait for its launch line**

Run:
```bash
open -n "/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad/kvs-spike/build-nosandbox/Build/Products/Debug/KVSSpike.app"
```

Then wait with the Monitor tool (timeout 60 s; not `sleep`) on:
```bash
until log show --last 2m --style compact --predicate 'subsystem == "com.mdbraber.kvs-spike" AND category == "app"' | grep -q "launch wrote"; do sleep 3; done
```

- [ ] **Step 6: Start a second copy and wait for the first to hear it**

Run:
```bash
open -n "/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad/kvs-spike/build-nosandbox/Build/Products/Debug/KVSSpike.app"
```

Then wait with the Monitor tool (timeout 120 s) on:
```bash
until log show --last 3m --style compact --predicate 'subsystem == "com.mdbraber.kvs-spike" AND category == "app"' | grep -q "changed externally"; do sleep 5; done
```

Then record the log:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
log show --last 4m --style compact --predicate 'subsystem == "com.mdbraber.kvs-spike" AND category == "app"' | grep -E "launch wrote|changed externally|poll others" | tail -30 | tee "$SCRATCH/kvs-spike/log-nosandbox.txt"
```

Expected:
- two `launch wrote spike.instance.<pid> synchronize=true signedIn=true sandboxed=false` lines, with different pids;
- at least one `pid=<first pid> changed externally reason=0 keys=spike.instance.<second pid>` line;
- `poll others=spike.instance.<other pid>` lines from both copies.

- [ ] **Step 7: Read the primary mail account id's shape in both Mac apps**

Create `$SCRATCH/probe-account-id.js`:

```js
// Task 1: read-only. Does this app's primary mail account id fit the rule the
// sync keys depend on? Returns only the answer and the length, never the id.
const primary = window.FastMail && FastMail.auth && FastMail.auth.get('primaryAccounts');
const id = primary && primary['urn:ietf:params:jmap:mail'];
return JSON.stringify({
    isString: typeof id === 'string',
    fitsRule: typeof id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(id),
    length: typeof id === 'string' ? id.length : null,
    app: window.FastMail && FastMail.router ? FastMail.router.get('app') : null
});
```

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/probe-account-id.js\" as «class utf8»)"
osascript -e "tell application \"nexthealth.nl\" to do JavaScript (read POSIX file \"$SCRATCH/probe-account-id.js\" as «class utf8»)"
```
Expected, for each app: `{"isString":true,"fitsRule":true,"length":<1 to 32>,"app":"mail"}`. If `nexthealth.nl` is not running, record that it was not checked; Task 6's probe checks `mdbraber.com` again.

- [ ] **Step 8: Clean up**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
pkill -x KVSSpike
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$SCRATCH/kvs-spike/build-nosandbox/Build/Products/Debug/KVSSpike.app"
rm -rf "$SCRATCH/kvs-spike/build-nosandbox"
pgrep -x KVSSpike || echo "no spike running"
```
Expected: the last line is `no spike running`.

- [ ] **Step 9: Decide**

If Steps 3, 4, 6 and 7 met their expectations, record the log path and the two probe answers in the task report, and go on to Task 2.

Otherwise, stop the plan and report:
- the failing step and its output;
- for Step 6, whether the poll lines listed the other copy's key even though no change line came;
- for Step 7, the answer, which gives the length and never the id.

The controller decides. Do not adapt later tasks.

---

### Task 2: `SettingsSyncRules`, the pure rules

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsSyncRulesTests.swift` (create)

**Interfaces:**
- Consumes: `CustomModeSettings.isWritableSettingKey(_:)`, in the parity test only. The source file itself uses Foundation and nothing else from the package: Task 7 compiles it into the Safari extension, which is Swift 5 with a macOS 10.14 deployment target.
- Produces `enum SettingsSyncRules` (internal):
  - constants:
    - `static let keySeparator = "."`
    - `static let localOnlyKeys: Set<String>`
    - `static let maxAccountIdLength = 32`
    - `static let maxStoreKeyBytes = 64`
    - `static let uploadGrace: TimeInterval = 30`
  - keys:
    - `static func isValidAccountId(_:) -> Bool`
    - `static func isSettingKey(_:) -> Bool`
    - `static func isSyncedKey(_:) -> Bool`
    - `static func storeKey(accountId:key:) -> String?`
    - `static func parse(storeKey:) -> (accountId: String, key: String)?`
  - values:
    - `static func isSyncableValue(_ item: Any) -> Bool`
    - `static func sameValue(_:_:) -> Bool`
  - settings:
    - `static func settings(for:in:) -> [String: Any]`
    - `static func storeEntries(accountId:local:) -> [String: Any]`
  - joining:
    - `enum JoinDecision: Equatable { case adopt, upload, wait(recheckIn: TimeInterval?) }`
    - `static func joinDecision(storeHasAccountKeys:initialSyncArrived:secondsSinceSuccessfulSync:hasICloudIdentity:) -> JoinDecision`
    - `struct Adoption { var set: [String: Any]; var remove: [String] }`
    - `static func adoption(local:inStore:) -> Adoption`
  - the Safari extension:
    - `struct ExtensionAnswer { var reply: [String: Any]; var write: (key: String, value: Any)? }`
    - `static func extensionAnswer(to:hasICloudIdentity:storeContents:) -> ExtensionAnswer`

- [ ] **Step 1: Write the failing tests**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsSyncRulesTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

// MARK: Keys

@Test func aStoreKeyIsTheAccountADotAndTheSetting() {
    #expect(SettingsSyncRules.storeKey(accountId: "u1234abcd", key: "labelColours") == "u1234abcd.labelColours")
    let parsed = SettingsSyncRules.parse(storeKey: "u1234abcd.labelColours")
    #expect(parsed?.accountId == "u1234abcd")
    #expect(parsed?.key == "labelColours")
}

@Test func accountIdsAreOneToThirtyTwoLettersDigitsHyphensAndUnderscores() {
    for good in ["u1234abcd", "a", "A-b_9", String(repeating: "x", count: 32)] {
        #expect(SettingsSyncRules.isValidAccountId(good), "\(good) should be accepted")
    }
    for bad in ["", String(repeating: "x", count: 33), "u1234.abcd", "u1234 abcd", "ü1234", "u1234/abcd", "u1234abcd\n"] {
        #expect(!SettingsSyncRules.isValidAccountId(bad), "\(bad.debugDescription) should be refused")
    }
}

// The rules file cannot see CustomModeSettings, so it carries the rule
// again; the two must never part.
@Test func theSettingKeyRuleIsCustomModeSettingsOwn() {
    let samples = [
        "labelColours", "a", "Z9", "abc123", "", "1st", "has space", "has-hyphen",
        "has_underscore", "push.alerts", "customMode.triageLabel", "é", "café",
        "e\u{301}", "\r\n", "a\r\n", "Ⅻ", "٣", "abc٣", "ｆｕｌｌ", "a\u{0}",
    ]
    for key in samples {
        #expect(
            SettingsSyncRules.isSettingKey(key) == CustomModeSettings.isWritableSettingKey(key),
            "\(key.debugDescription)"
        )
    }
}

// The bar lengths depend on the screen, so they never travel
@Test func theBarLengthsAreNeverStoreKeys() {
    #expect(SettingsSyncRules.localOnlyKeys == ["bottomBarItems", "topBarItems"])
    #expect(SettingsSyncRules.storeKey(accountId: "u1234abcd", key: "bottomBarItems") == nil)
    #expect(SettingsSyncRules.storeKey(accountId: "u1234abcd", key: "topBarItems") == nil)
    #expect(SettingsSyncRules.parse(storeKey: "u1234abcd.topBarItems") == nil)
}

@Test func keysThatAreNotSyncedSettingsAreNotParsed() {
    for key in ["nodot", ".labelColours", "u1234abcd.", "u1234abcd.bad.key", "u12 34.labelColours", "u1234abcd.1st"] {
        #expect(SettingsSyncRules.parse(storeKey: key) == nil, "\(key) should not parse")
    }
}

// iCloud refuses a key longer than 64 bytes
@Test func aStoreKeyStaysWithinSixtyFourBytes() {
    let account = String(repeating: "a", count: 32)
    let longest = SettingsSyncRules.storeKey(accountId: account, key: "k" + String(repeating: "x", count: 30))
    #expect(longest?.utf8.count == 64)
    #expect(SettingsSyncRules.storeKey(accountId: account, key: "k" + String(repeating: "x", count: 31)) == nil)
    #expect(SettingsSyncRules.storeKey(accountId: account, key: "labelColoursSkipTriage") != nil)
}

// MARK: Values

@Test func onlyRealBooleansAndStringsAreSettingValues() {
    #expect(SettingsSyncRules.isSyncableValue(true))
    #expect(SettingsSyncRules.isSyncableValue("Todo"))
    #expect(!SettingsSyncRules.isSyncableValue(NSNumber(value: 1)))
    #expect(!SettingsSyncRules.isSyncableValue(2.5))
    #expect(!SettingsSyncRules.isSyncableValue(["a"]))
    #expect(SettingsSyncRules.sameValue(false, NSNumber(value: false)))
    #expect(!SettingsSyncRules.sameValue(true, NSNumber(value: 1)))
    #expect(!SettingsSyncRules.sameValue("true", true))
    #expect(!SettingsSyncRules.sameValue(nil, "Todo"))
}

@Test func anAccountsSettingsAreTakenFromTheStoreWithoutThePrefix() {
    let contents: [String: Any] = [
        "u1234abcd.labelColours": NSNumber(value: false),
        "u1234abcd.triageLabel": "Todo",
        "u1234abcd.topBarItems": "3",
        "u1234abcd.snoozeDefault": NSNumber(value: 4),
        "u9999zzzz.triageLabel": "Other",
        "unrelated": "x",
    ]
    let settings = SettingsSyncRules.settings(for: "u1234abcd", in: contents)
    #expect(Set(settings.keys) == ["labelColours", "triageLabel"])
    #expect(settings["labelColours"] as? Bool == false)
    #expect(settings["triageLabel"] as? String == "Todo")
}

@Test func uploadingSendsTheSyncedSettingsUnderTheirPrefixedKeys() {
    let local: [String: Any] = [
        "labelColours": true, "triageLabel": "Todo", "bottomBarItems": "4", "snoozeDefault": NSNumber(value: 3),
    ]
    let entries = SettingsSyncRules.storeEntries(accountId: "u1234abcd", local: local)
    #expect(Set(entries.keys) == ["u1234abcd.labelColours", "u1234abcd.triageLabel"])
    #expect(entries["u1234abcd.labelColours"] as? Bool == true)
}

// MARK: Joining

@Test func joiningAdoptsWhateverTheStoreHoldsForTheAccount() {
    let decision = SettingsSyncRules.joinDecision(
        storeHasAccountKeys: true, initialSyncArrived: false,
        secondsSinceSuccessfulSync: nil, hasICloudIdentity: true
    )
    #expect(decision == .adopt)
}

@Test func anEmptyStoreIsBelievedAfterTheInitialSyncOrThirtySeconds() {
    func decide(initialSync: Bool, seconds: TimeInterval?) -> SettingsSyncRules.JoinDecision {
        SettingsSyncRules.joinDecision(
            storeHasAccountKeys: false, initialSyncArrived: initialSync,
            secondsSinceSuccessfulSync: seconds, hasICloudIdentity: true
        )
    }
    #expect(decide(initialSync: true, seconds: nil) == .upload)
    #expect(decide(initialSync: false, seconds: 30) == .upload)
    #expect(decide(initialSync: false, seconds: 12) == .wait(recheckIn: 18))
    #expect(decide(initialSync: false, seconds: nil) == .wait(recheckIn: nil))
}

@Test func withoutAnICloudAccountNothingIsDecided() {
    let decision = SettingsSyncRules.joinDecision(
        storeHasAccountKeys: true, initialSyncArrived: true,
        secondsSinceSuccessfulSync: 60, hasICloudIdentity: false
    )
    #expect(decision == .wait(recheckIn: nil))
}

@Test func adoptingSetsWhatDiffersAndRemovesSyncedSettingsTheStoreLacks() {
    let local: [String: Any] = ["labelColours": true, "triageLabel": "Todo", "snoozeKey": "w", "bottomBarItems": "4"]
    let inStore: [String: Any] = ["labelColours": false, "triageLabel": "Todo", "urgentKey": "p"]
    let plan = SettingsSyncRules.adoption(local: local, inStore: inStore)
    #expect(Set(plan.set.keys) == ["labelColours", "urgentKey"])
    #expect(plan.set["labelColours"] as? Bool == false)
    #expect(plan.remove == ["snoozeKey"])
}

// MARK: The Safari extension's native part

@Test func theExtensionsGetAnswersOneAccountsSyncedSettingsWithoutThePrefix() throws {
    let contents: [String: Any] = [
        "u1234abcd.triageLabel": "Todo",
        "u1234abcd.labelColours": NSNumber(value: false),
        "u1234abcd.topBarItems": "3",
        "u9999zzzz.triageLabel": "Other",
    ]
    let answer = SettingsSyncRules.extensionAnswer(
        to: ["action": "get", "accountId": "u1234abcd"],
        hasICloudIdentity: true,
        storeContents: { contents }
    )
    #expect(answer.write == nil)
    #expect(answer.reply["ok"] as? Bool == true)
    #expect(answer.reply["available"] as? Bool == true)
    let settings = try #require(answer.reply["settings"] as? [String: Any])
    #expect(Set(settings.keys) == ["triageLabel", "labelColours"])
}

@Test func theExtensionsGetSaysWhenThereIsNoICloudAccount() {
    let answer = SettingsSyncRules.extensionAnswer(
        to: ["action": "get", "accountId": "u1234abcd"],
        hasICloudIdentity: false,
        storeContents: { [:] }
    )
    #expect(answer.reply["ok"] as? Bool == true)
    #expect(answer.reply["available"] as? Bool == false)
}

@Test func theExtensionsSetWritesOnePrefixedKeyWithoutReadingTheStore() {
    var read = 0
    let answer = SettingsSyncRules.extensionAnswer(
        to: ["action": "set", "accountId": "u1234abcd", "key": "labelColours", "value": false],
        hasICloudIdentity: true,
        storeContents: {
            read += 1
            return [:]
        }
    )
    #expect(answer.reply["ok"] as? Bool == true)
    #expect(answer.write?.key == "u1234abcd.labelColours")
    #expect(answer.write?.value as? Bool == false)
    #expect(read == 0)
}

@Test func theExtensionRefusesBarLengthsBadIdsKeysValuesAndActions() {
    let messages: [[String: Any]] = [
        ["action": "set", "accountId": "u1234abcd", "key": "bottomBarItems", "value": "4"],
        ["action": "set", "accountId": "", "key": "labelColours", "value": true],
        ["action": "set", "accountId": String(repeating: "a", count: 33), "key": "labelColours", "value": true],
        ["action": "set", "accountId": "u1234abcd", "key": "bad.key", "value": true],
        ["action": "set", "accountId": "u1234abcd", "key": "labelColours", "value": NSNumber(value: 1)],
        ["action": "set", "accountId": "u1234abcd", "key": "labelColours"],
        ["action": "get"],
        ["action": "delete", "accountId": "u1234abcd"],
    ]
    for message in messages {
        let answer = SettingsSyncRules.extensionAnswer(to: message, hasICloudIdentity: true, storeContents: { [:] })
        #expect(answer.reply["ok"] as? Bool == false, "\(message)")
        #expect(answer.reply["error"] is String)
        #expect(answer.write == nil)
    }
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | grep -E "error:" | head -5`
Expected: the build fails with `error: cannot find 'SettingsSyncRules' in scope`.

- [ ] **Step 3: Write the rules**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift`:

```swift
import Foundation

/// The rules for keeping Custom mode's settings in iCloud key-value storage:
/// what a store key looks like, which settings travel, what a first sync
/// decides, and what the Safari extension's native part answers.
///
/// Foundation and nothing else from this package. The Safari extension
/// compiles this same file by reference, in Swift 5 and for an older macOS,
/// so the apps and the extension cannot disagree about a key.
enum SettingsSyncRules {
    /// Between the account id and the setting: `u1234abcd.labelColours`.
    static let keySeparator = "."

    /// How many actions fit on a bar depends on the screen, so these two
    /// stay on each device.
    static let localOnlyKeys: Set<String> = ["bottomBarItems", "topBarItems"]

    /// With the longest setting name, a key stays inside iCloud's limit.
    static let maxAccountIdLength = 32
    static let maxStoreKeyBytes = 64

    /// How long an app believes an empty store may still be downloading,
    /// counted from its first successful synchronize.
    static let uploadGrace: TimeInterval = 30

    // MARK: Keys

    /// A Fastmail account id as the page reports it: 1 to 32 ASCII letters,
    /// digits, hyphens and underscores.
    static func isValidAccountId(_ accountId: String) -> Bool {
        guard !accountId.isEmpty, accountId.utf8.count <= maxAccountIdLength else { return false }
        return accountId.unicodeScalars.allSatisfy { isLetter($0) || isDigit($0) || $0 == "-" || $0 == "_" }
    }

    /// `CustomModeSettings.isWritableSettingKey`'s rule, letters and digits
    /// starting with a letter, written again so this file stands alone. A
    /// package test holds the two together.
    static func isSettingKey(_ key: String) -> Bool {
        guard let first = key.unicodeScalars.first, isLetter(first) else { return false }
        return key.unicodeScalars.allSatisfy { isLetter($0) || isDigit($0) }
    }

    /// A setting that travels between devices.
    static func isSyncedKey(_ key: String) -> Bool {
        isSettingKey(key) && !localOnlyKeys.contains(key)
    }

    /// The store key for one account's setting, or nothing when the account,
    /// the setting or the length will not do.
    static func storeKey(accountId: String, key: String) -> String? {
        guard isValidAccountId(accountId), isSyncedKey(key) else { return nil }
        let joined = accountId + keySeparator + key
        return joined.utf8.count <= maxStoreKeyBytes ? joined : nil
    }

    /// The account and setting a store key names, or nothing for a key that
    /// is not a synced setting.
    static func parse(storeKey: String) -> (accountId: String, key: String)? {
        guard let separator = storeKey.range(of: keySeparator) else { return nil }
        let accountId = String(storeKey[..<separator.lowerBound])
        let key = String(storeKey[separator.upperBound...])
        guard isValidAccountId(accountId), isSyncedKey(key) else { return nil }
        return (accountId, key)
    }

    // MARK: Values

    /// Booleans and strings are all the settings hold. A JavaScript 1 and a
    /// JavaScript true both arrive as NSNumber, so CoreFoundation is asked
    /// which one it is, as the bridge's `setting` action does.
    static func isSyncableValue(_ item: Any) -> Bool {
        settingValue(item) != nil
    }

    /// Both booleans and equal, or both strings and equal.
    static func sameValue(_ one: Any?, _ other: Any?) -> Bool {
        guard let one, let other, let first = settingValue(one), let second = settingValue(other) else {
            return false
        }
        return first == second
    }

    private enum SettingValue: Equatable {
        case flag(Bool)
        case text(String)
    }

    private static func settingValue(_ item: Any) -> SettingValue? {
        if let number = item as? NSNumber {
            guard CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() else { return nil }
            return .flag(number.boolValue)
        }
        if let text = item as? String {
            return .text(text)
        }
        return nil
    }

    private static func plain(_ value: SettingValue) -> Any {
        switch value {
        case .flag(let flag): return flag
        case .text(let text): return text
        }
    }

    // MARK: Settings

    /// One account's synced settings in the store's contents, without the
    /// prefix. Other accounts, local-only settings and values that are
    /// neither a boolean nor a string are left out.
    static func settings(for accountId: String, in contents: [String: Any]) -> [String: Any] {
        var settings: [String: Any] = [:]
        for (entryKey, item) in contents {
            guard let parsed = parse(storeKey: entryKey), parsed.accountId == accountId,
                  let value = settingValue(item) else { continue }
            settings[parsed.key] = plain(value)
        }
        return settings
    }

    /// A device's settings as store entries for one account: the synced ones,
    /// each under its prefixed key.
    static func storeEntries(accountId: String, local: [String: Any]) -> [String: Any] {
        var entries: [String: Any] = [:]
        for (key, item) in local {
            guard let entryKey = storeKey(accountId: accountId, key: key),
                  let value = settingValue(item) else { continue }
            entries[entryKey] = plain(value)
        }
        return entries
    }

    // MARK: Joining

    /// What a device that has not synced an account yet does.
    enum JoinDecision: Equatable {
        /// The store has the account's settings: take them.
        case adopt
        /// The store is empty for the account and can be believed: send this
        /// device's settings.
        case upload
        /// Not yet. Look again after this many seconds, or, when nil, at the
        /// next launch, page report or change notice.
        case wait(recheckIn: TimeInterval?)
    }

    /// Without an iCloud account nothing is decided. A store holding the
    /// account is adopted at once. An empty one is believed only once the
    /// initial-sync notice has arrived in this launch, or `uploadGrace`
    /// seconds after a successful synchronize.
    static func joinDecision(
        storeHasAccountKeys: Bool,
        initialSyncArrived: Bool,
        secondsSinceSuccessfulSync: TimeInterval?,
        hasICloudIdentity: Bool
    ) -> JoinDecision {
        guard hasICloudIdentity else { return .wait(recheckIn: nil) }
        if storeHasAccountKeys { return .adopt }
        if initialSyncArrived { return .upload }
        guard let elapsed = secondsSinceSuccessfulSync else { return .wait(recheckIn: nil) }
        return elapsed >= uploadGrace ? .upload : .wait(recheckIn: uploadGrace - elapsed)
    }

    /// Taking iCloud's settings: each synced setting iCloud holds is set
    /// where it differs, and each synced setting iCloud lacks is removed, so
    /// the page shows its default. Local-only settings are never touched.
    struct Adoption {
        var set: [String: Any]
        var remove: [String]
    }

    static func adoption(local: [String: Any], inStore: [String: Any]) -> Adoption {
        var set: [String: Any] = [:]
        for (key, item) in inStore where isSyncedKey(key) {
            guard let value = settingValue(item), !sameValue(local[key], item) else { continue }
            set[key] = plain(value)
        }
        let remove = local.keys.filter { isSyncedKey($0) && inStore[$0] == nil }.sorted()
        return Adoption(set: set, remove: remove)
    }

    // MARK: The Safari extension

    /// What the extension's native part does with one message from its
    /// background script: the reply, and the one store write a `set` asks
    /// for. Decided here, away from the store, so the package tests it.
    struct ExtensionAnswer {
        var reply: [String: Any]
        var write: (key: String, value: Any)?
    }

    /// - `get {accountId}` replies `{ok, available, settings}`: the account's
    ///   synced settings without the prefix, and whether this Mac has an
    ///   iCloud account.
    /// - `set {accountId, key, value}` replies `{ok}` and writes one key.
    /// - An unknown action, a local-only key, or a bad id, key or value
    ///   replies `{ok: false, error}` and writes nothing.
    static func extensionAnswer(
        to message: [String: Any],
        hasICloudIdentity: Bool,
        storeContents: () -> [String: Any]
    ) -> ExtensionAnswer {
        guard let accountId = message["accountId"] as? String, isValidAccountId(accountId) else {
            return refusal("the message has no usable accountId")
        }
        let action = message["action"] as? String ?? ""
        switch action {
        case "get":
            let settings = settings(for: accountId, in: storeContents())
            return ExtensionAnswer(
                reply: ["ok": true, "available": hasICloudIdentity, "settings": settings],
                write: nil
            )
        case "set":
            guard let key = message["key"] as? String,
                  let entryKey = storeKey(accountId: accountId, key: key) else {
                return refusal("the message has no usable key")
            }
            guard let item = message["value"], let value = settingValue(item) else {
                return refusal("the value must be a boolean or a string")
            }
            return ExtensionAnswer(reply: ["ok": true], write: (key: entryKey, value: plain(value)))
        default:
            return refusal("unknown action")
        }
    }

    private static func refusal(_ error: String) -> ExtensionAnswer {
        ExtensionAnswer(reply: ["ok": false, "error": error], write: nil)
    }

    // MARK: Characters

    /// ASCII only, by code point, so the answer is the same for every
    /// compiler and every macOS the extension may run on.
    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 65...90, 97...122: return true
        default: return false
        }
    }

    private static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
        (48...57).contains(scalar.value)
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -5`
Expected: the run passes, including the 17 new tests.

- [ ] **Step 5: Check the file stands alone in Swift 5 for macOS 10.14**

This is the Safari extension's language mode and deployment target, which Task 7 builds.

Run:
```bash
cd /Users/mdbraber/src/fastmail-custom && xcrun swiftc -typecheck -swift-version 5 -target x86_64-apple-macos10.14 -sdk "$(xcrun --sdk macosx --show-sdk-path)" -enable-upcoming-feature MemberImportVisibility -parse-as-library Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift; echo "exit $?"
```
Expected: `exit 0`, with no errors.

- [ ] **Step 6: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsSyncRulesTests.swift
```

```bash
cd /Users/mdbraber/src/fastmail-custom
git commit -F - <<'EOF'
feat: the rules for syncing Custom mode settings through iCloud

Store keys, account ids, the bar lengths that stay on each device, the first
sync's decision and adoption, and the Safari native part's answers. Foundation
only, so the Safari extension can compile the same file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 3: `CustomModeSettingsSync`, the apps' sync component

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettingsSync.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsSyncTests.swift` (create)

**Interfaces:**
- Consumes (Task 2): `SettingsSyncRules.isValidAccountId`, `storeKey(accountId:key:)`, `isSyncableValue`, `sameValue`, `settings(for:in:)`, `storeEntries(accountId:local:)`, `joinDecision(...)`, `adoption(local:inStore:)`. Also the existing `CustomModeSettings.current(from:)` and `CustomModeSettings.defaultsKey(for:)`.
- Produces:
  - `protocol KeyValueStore: AnyObject` (internal), with:
    - `func object(forKey key: String) -> Any?`
    - `func set(_ value: Any?, forKey key: String)`
    - `var dictionaryRepresentation: [String: Any] { get }`
    - `func synchronize() -> Bool`
  - `@MainActor public final class CustomModeSettingsSync`, with:
    - `nonisolated static let accountIdKey = "settingsSync.accountId"`, `enabledKey = "settingsSync.enabled"`, `joinedKeyPrefix = "settingsSync.joined."`
    - `enum ChangeReason: Int { case serverChange = 0, initialSync = 1, quotaViolation = 2, accountChange = 3 }`
    - `typealias Schedule = @MainActor (TimeInterval, @escaping @MainActor @Sendable () -> Void) -> Void`
    - `init(defaults: UserDefaults, store: KeyValueStore, hasICloudIdentity: @escaping @MainActor () -> Bool, now: @escaping @MainActor () -> Date = { Date() }, schedule: @escaping Schedule)`
    - `nonisolated static func isEnabled(in: UserDefaults) -> Bool` and `public var isEnabled: Bool`
    - `var accountId: String?` and `func isJoined(_ accountId: String) -> Bool`
    - `func start()`: observes `NSUbiquitousKeyValueStore.didChangeExternallyNotification` for its store, then joins the known account
    - `public func accountReported(_ accountId: String)`
    - `public func localChanged(key: String, value: Any)`
    - `public func setEnabled(_ enabled: Bool)`
    - `func externalChange(reason: Int, keys: [String])`
    - `func joinIfNeeded()`
  - Logs to subsystem `com.mdbraber.fastmail-custom`, category `settings-sync`.

- [ ] **Step 1: Write the failing tests**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsSyncTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

/// iCloud's store, faked: it answers from a dictionary and records every
/// write made through it.
private final class FakeStore: KeyValueStore {
    var values: [String: Any] = [:]
    var writes: [String] = []
    var synchronizeAnswer = true
    var synchronizeCount = 0

    func object(forKey key: String) -> Any? { values[key] }

    func set(_ value: Any?, forKey key: String) {
        writes.append(key)
        values[key] = value
    }

    var dictionaryRepresentation: [String: Any] { values }

    func synchronize() -> Bool {
        synchronizeCount += 1
        return synchronizeAnswer
    }
}

/// One sync component with everything it touches in reach: throwaway
/// defaults, the fake store, a clock that moves only when told and a
/// scheduler that runs only when told, so no test waits.
@MainActor
private final class Harness {
    let defaults: UserDefaults
    let store = FakeStore()
    var hasICloudIdentity = true
    var now = Date(timeIntervalSinceReferenceDate: 1_000_000)
    var scheduled: [(delay: TimeInterval, work: @MainActor @Sendable () -> Void)] = []
    private(set) var sync: CustomModeSettingsSync!

    init(_ name: String) {
        let suite = "CustomModeSettingsSyncTests.\(name)"
        defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        sync = CustomModeSettingsSync(
            defaults: defaults,
            store: store,
            hasICloudIdentity: { [unowned self] in self.hasICloudIdentity },
            now: { [unowned self] in self.now },
            schedule: { [unowned self] delay, work in self.scheduled.append((delay, work)) }
        )
    }

    func advance(_ seconds: TimeInterval) {
        now = now.addingTimeInterval(seconds)
    }

    /// Runs whatever is waiting, as the timer would once its time came.
    func runScheduled() {
        let due = scheduled
        scheduled = []
        for entry in due {
            entry.work()
        }
    }

    func local(_ key: String) -> Any? {
        defaults.object(forKey: CustomModeSettings.defaultsKey(for: key))
    }
}

// MARK: Joining

@Test @MainActor func joiningAdoptsTheStoresSettingsAndRemovesSyncedOnesItLacks() {
    let h = Harness(#function)
    h.defaults.set(true, forKey: "customMode.labelColours")
    h.defaults.set("x", forKey: "customMode.snoozeKey")
    h.defaults.set("4", forKey: "customMode.bottomBarItems")
    h.store.values = ["u1234abcd.labelColours": NSNumber(value: false), "u1234abcd.triageLabel": "Todo"]

    h.sync.accountReported("u1234abcd")

    #expect(h.local("labelColours") as? Bool == false)
    #expect(h.local("triageLabel") as? String == "Todo")
    #expect(h.local("snoozeKey") == nil)
    // The bar length is this device's own
    #expect(h.local("bottomBarItems") as? String == "4")
    #expect(h.sync.isJoined("u1234abcd"))
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func anEmptyStoreIsUploadedAfterTheInitialSyncNoticeAndNotBefore() {
    let h = Harness(#function)
    h.defaults.set(false, forKey: "customMode.labelColours")
    h.defaults.set("Todo", forKey: "customMode.triageLabel")
    h.defaults.set("4", forKey: "customMode.bottomBarItems")

    h.sync.accountReported("u1234abcd")
    #expect(h.store.writes.isEmpty)
    #expect(!h.sync.isJoined("u1234abcd"))

    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreInitialSyncChange, keys: [])

    #expect(h.store.values["u1234abcd.labelColours"] as? Bool == false)
    #expect(h.store.values["u1234abcd.triageLabel"] as? String == "Todo")
    #expect(h.store.values["u1234abcd.bottomBarItems"] == nil)
    #expect(h.sync.isJoined("u1234abcd"))
}

@Test @MainActor func anEmptyStoreIsUploadedThirtySecondsAfterASuccessfulSynchronizeAndNotBefore() {
    let h = Harness(#function)
    h.defaults.set("Todo", forKey: "customMode.triageLabel")

    h.sync.accountReported("u1234abcd")
    #expect(h.scheduled.map { $0.delay } == [30])

    // Run early, the look finds ten seconds gone and waits the other twenty
    h.advance(10)
    h.runScheduled()
    #expect(h.store.writes.isEmpty)
    #expect(!h.sync.isJoined("u1234abcd"))
    #expect(h.scheduled.map { $0.delay } == [20])

    h.advance(20)
    h.runScheduled()
    #expect(h.store.values["u1234abcd.triageLabel"] as? String == "Todo")
    #expect(h.sync.isJoined("u1234abcd"))
}

// A second report while a look is already due schedules no second look
@Test @MainActor func oneRecheckIsScheduledAtATime() {
    let h = Harness(#function)
    h.sync.accountReported("u1234abcd")
    h.advance(5)
    h.sync.accountReported("u1234abcd")
    #expect(h.scheduled.count == 1)
}

// Nothing has been heard from iCloud, so there is no clock to run out
@Test @MainActor func aFailedSynchronizeStartsNoClock() {
    let h = Harness(#function)
    h.store.synchronizeAnswer = false
    h.sync.accountReported("u1234abcd")
    h.advance(60)
    h.sync.accountReported("u1234abcd")
    #expect(h.scheduled.isEmpty)
    #expect(h.store.writes.isEmpty)
    #expect(!h.sync.isJoined("u1234abcd"))
}

@Test @MainActor func withoutAnICloudAccountTheAppStaysUnjoined() {
    let h = Harness(#function)
    h.hasICloudIdentity = false
    h.defaults.set("Mine", forKey: "customMode.triageLabel")
    h.store.values = ["u1234abcd.triageLabel": "Todo"]

    h.sync.accountReported("u1234abcd")

    #expect(h.local("triageLabel") as? String == "Mine")
    #expect(!h.sync.isJoined("u1234abcd"))
    #expect(h.scheduled.isEmpty)
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func launchJoinsTheLastReportedAccountBeforeAnyPage() {
    let h = Harness(#function)
    h.defaults.set("u1234abcd", forKey: "settingsSync.accountId")
    h.store.values = ["u1234abcd.triageLabel": "Todo"]

    h.sync.start()

    #expect(h.local("triageLabel") as? String == "Todo")
    #expect(h.sync.isJoined("u1234abcd"))
}

// MARK: Local changes

@Test @MainActor func aLocalChangeWritesThePrefixedKeyOnceJoined() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")

    h.sync.localChanged(key: "labelColours", value: false)

    #expect(h.store.writes == ["u1234abcd.labelColours"])
    #expect(h.store.values["u1234abcd.labelColours"] as? Bool == false)
}

@Test @MainActor func aLocalChangeWritesNothingForABarLengthBeforeJoiningOrWithoutAnAccount() {
    let noAccount = Harness(#function + ".noAccount")
    noAccount.sync.localChanged(key: "labelColours", value: false)
    #expect(noAccount.store.writes.isEmpty)

    // An empty store and no initial sync yet: the account waits to join
    let unjoined = Harness(#function + ".unjoined")
    unjoined.sync.accountReported("u1234abcd")
    unjoined.sync.localChanged(key: "labelColours", value: false)
    #expect(unjoined.store.writes.isEmpty)

    let joined = Harness(#function + ".joined")
    joined.store.values = ["u1234abcd.triageLabel": "Todo"]
    joined.sync.accountReported("u1234abcd")
    joined.sync.localChanged(key: "bottomBarItems", value: "4")
    joined.sync.localChanged(key: "topBarItems", value: "6")
    joined.sync.localChanged(key: "labelColours", value: NSNumber(value: 1))
    #expect(joined.store.writes.isEmpty)
}

// MARK: Changes from other devices

@Test @MainActor func anExternalChangeTakesOnlyThisAccountsSyncedKeysAndWritesNothingBack() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.defaults.set("4", forKey: "customMode.bottomBarItems")
    h.defaults.set("w", forKey: "customMode.snoozeKey")

    h.store.values["u1234abcd.triageLabel"] = "Later"
    h.store.values["u1234abcd.bottomBarItems"] = "2"
    h.store.values["u9999zzzz.snoozeKey"] = "q"
    h.sync.externalChange(
        reason: NSUbiquitousKeyValueStoreServerChange,
        keys: ["u1234abcd.triageLabel", "u1234abcd.bottomBarItems", "u9999zzzz.snoozeKey"]
    )

    #expect(h.local("triageLabel") as? String == "Later")
    #expect(h.local("bottomBarItems") as? String == "4")
    #expect(h.local("snoozeKey") as? String == "w")
    #expect(h.store.writes.isEmpty)
}

@Test @MainActor func overQuotaTheSettingsAreLeftAlone() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")

    h.store.values["u1234abcd.triageLabel"] = "Later"
    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreQuotaViolationChange, keys: ["u1234abcd.triageLabel"])

    #expect(h.local("triageLabel") as? String == "Todo")
}

// MARK: Account changes

@Test @MainActor func anICloudAccountChangeClearsEveryJoinedFlagAndJoinsAgain() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.defaults.set(true, forKey: "settingsSync.joined.u5555")

    h.store.values = ["u1234abcd.triageLabel": "Elsewhere"]
    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreAccountChange, keys: [])

    #expect(h.defaults.object(forKey: "settingsSync.joined.u5555") == nil)
    #expect(h.local("triageLabel") as? String == "Elsewhere")
    #expect(h.sync.isJoined("u1234abcd"))
}

@Test @MainActor func aPageOnAnotherAccountSwitchesToItsKeysAndJoinsIt() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo", "u5678efgh.triageLabel": "Work"]
    h.sync.accountReported("u1234abcd")

    h.sync.accountReported("u5678efgh")
    h.sync.localChanged(key: "snoozeKey", value: "q")

    #expect(h.defaults.string(forKey: "settingsSync.accountId") == "u5678efgh")
    #expect(h.local("triageLabel") as? String == "Work")
    #expect(h.sync.isJoined("u5678efgh"))
    #expect(h.store.writes == ["u5678efgh.snoozeKey"])
}

@Test @MainActor func aBadlyFormedAccountIsIgnored() {
    let h = Harness(#function)
    h.sync.accountReported("u1234.abcd")
    #expect(h.defaults.object(forKey: "settingsSync.accountId") == nil)
    #expect(h.store.synchronizeCount == 0)
}

// MARK: The switch

@Test @MainActor func theSwitchIsOnByDefault() {
    let h = Harness(#function)
    #expect(h.sync.isEnabled)
    #expect(CustomModeSettingsSync.isEnabled(in: h.defaults))
}

@Test @MainActor func turningSyncOffStopsEveryReadAndWriteAndClearsTheJoinedFlags() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.defaults.set(true, forKey: "settingsSync.joined.u5555")

    h.sync.setEnabled(false)

    #expect(!h.sync.isEnabled)
    #expect(!h.sync.isJoined("u1234abcd"))
    #expect(h.defaults.object(forKey: "settingsSync.joined.u5555") == nil)

    let synchronized = h.store.synchronizeCount
    h.sync.localChanged(key: "labelColours", value: false)
    h.store.values["u1234abcd.snoozeKey"] = "q"
    h.sync.externalChange(reason: NSUbiquitousKeyValueStoreServerChange, keys: ["u1234abcd.snoozeKey"])
    h.sync.accountReported("u1234abcd")
    h.sync.start()

    #expect(h.store.writes.isEmpty)
    #expect(h.store.synchronizeCount == synchronized)
    #expect(h.local("snoozeKey") == nil)
    // Every setting keeps its value
    #expect(h.local("triageLabel") as? String == "Todo")
}

@Test @MainActor func turningSyncOnJoinsAgainAndICloudWins() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.sync.setEnabled(false)
    h.defaults.set("Changed while off", forKey: "customMode.triageLabel")

    h.sync.setEnabled(true)

    #expect(h.local("triageLabel") as? String == "Todo")
    #expect(h.sync.isJoined("u1234abcd"))
}

// The switch and the account sit beside the settings, never among them:
// the page is not handed them as settings, and they never become store keys
@Test @MainActor func theSyncStateIsNeverASetting() {
    let h = Harness(#function)
    h.store.values = ["u1234abcd.triageLabel": "Todo"]
    h.sync.accountReported("u1234abcd")
    h.sync.setEnabled(false)
    h.sync.setEnabled(true)

    let settings = CustomModeSettings.current(from: h.defaults)
    #expect(!settings.keys.contains { $0.contains("enabled") || $0.contains("accountId") || $0.contains("joined") })
    #expect(SettingsSyncRules.storeKey(accountId: "u1234abcd", key: CustomModeSettingsSync.enabledKey) == nil)
    h.sync.localChanged(key: CustomModeSettingsSync.enabledKey, value: false)
    #expect(h.store.writes.isEmpty)
}

// The notice carries its reason as a plain integer
@Test @MainActor func theChangeReasonsAreFoundationsOwnNumbers() {
    #expect(CustomModeSettingsSync.ChangeReason.serverChange.rawValue == NSUbiquitousKeyValueStoreServerChange)
    #expect(CustomModeSettingsSync.ChangeReason.initialSync.rawValue == NSUbiquitousKeyValueStoreInitialSyncChange)
    #expect(CustomModeSettingsSync.ChangeReason.quotaViolation.rawValue == NSUbiquitousKeyValueStoreQuotaViolationChange)
    #expect(CustomModeSettingsSync.ChangeReason.accountChange.rawValue == NSUbiquitousKeyValueStoreAccountChange)
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | grep -E "error:" | head -5`
Expected: the build fails with `error: cannot find type 'KeyValueStore' in scope` and `cannot find 'CustomModeSettingsSync' in scope`.

- [ ] **Step 3: Write the component**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettingsSync.swift`:

```swift
import Foundation
import os

/// What the sync component needs from iCloud key-value storage. The apps
/// hand it `NSUbiquitousKeyValueStore.default`; the tests hand it a fake.
protocol KeyValueStore: AnyObject {
    func object(forKey key: String) -> Any?
    func set(_ value: Any?, forKey key: String)
    var dictionaryRepresentation: [String: Any] { get }
    func synchronize() -> Bool
}

/// Keeps Custom mode's settings the same on the devices of one iCloud
/// account, for each Fastmail account, through iCloud key-value storage.
///
/// One per app process, serving every window. Settings stay where they have
/// always been, in `UserDefaults` under `customMode.`; this copies them to
/// and from the store under `<account id>.<setting>`, by the rules in
/// `SettingsSyncRules`. Its own state lives beside them under
/// `settingsSync.`, so it is neither synced nor handed to the page.
@MainActor
public final class CustomModeSettingsSync {
    nonisolated static let accountIdKey = "settingsSync.accountId"
    nonisolated static let enabledKey = "settingsSync.enabled"
    nonisolated static let joinedKeyPrefix = "settingsSync.joined."

    /// Why the store says it changed, numbered as Foundation numbers them.
    enum ChangeReason: Int {
        case serverChange = 0
        case initialSync = 1
        case quotaViolation = 2
        case accountChange = 3
    }

    /// Runs work on the main actor after a delay: a timer in the apps, a list
    /// the test runs by hand.
    typealias Schedule = @MainActor (TimeInterval, @escaping @MainActor @Sendable () -> Void) -> Void

    private let defaults: UserDefaults
    private let store: KeyValueStore
    private let hasICloudIdentity: @MainActor () -> Bool
    private let now: @MainActor () -> Date
    private let schedule: Schedule
    private let log = Logger(subsystem: "com.mdbraber.fastmail-custom", category: "settings-sync")
    /// Whether this launch has heard the store's first download finish.
    private var initialSyncArrived = false
    /// This launch's first successful synchronize, where the 30 seconds start.
    private var firstSuccessfulSync: Date?
    private var recheckPending = false
    // Written once in start, read again only from deinit; never concurrently
    private nonisolated(unsafe) var observer: NSObjectProtocol?

    init(
        defaults: UserDefaults,
        store: KeyValueStore,
        hasICloudIdentity: @escaping @MainActor () -> Bool,
        now: @escaping @MainActor () -> Date = { Date() },
        schedule: @escaping Schedule
    ) {
        self.defaults = defaults
        self.store = store
        self.hasICloudIdentity = hasICloudIdentity
        self.now = now
        self.schedule = schedule
    }

    deinit {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// Whether this app syncs: on until the settings page switches it off.
    nonisolated static func isEnabled(in defaults: UserDefaults) -> Bool {
        defaults.object(forKey: enabledKey) as? Bool ?? true
    }

    public var isEnabled: Bool { Self.isEnabled(in: defaults) }

    /// The account the last page reported, kept across launches so the app
    /// can sync before any page has loaded.
    var accountId: String? {
        guard let stored = defaults.string(forKey: Self.accountIdKey),
              SettingsSyncRules.isValidAccountId(stored) else { return nil }
        return stored
    }

    func isJoined(_ accountId: String) -> Bool {
        defaults.bool(forKey: Self.joinedKeyPrefix + accountId)
    }

    /// Listens for other devices' changes, and joins the last known account
    /// at once, without waiting for a page.
    func start() {
        if observer == nil {
            observer = NotificationCenter.default.addObserver(
                forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
                object: store,
                queue: .main
            ) { [weak self] notification in
                let reason = notification.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int ?? -1
                let keys = notification.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
                MainActor.assumeIsolated { self?.externalChange(reason: reason, keys: keys) }
            }
        }
        joinIfNeeded()
    }

    /// A page said which Fastmail account it is. A different account from
    /// the last one switches to its keys and joins it.
    public func accountReported(_ accountId: String) {
        guard SettingsSyncRules.isValidAccountId(accountId) else { return }
        if defaults.string(forKey: Self.accountIdKey) != accountId {
            defaults.set(accountId, forKey: Self.accountIdKey)
        }
        joinIfNeeded()
    }

    /// The page changed a setting, which the app has already saved. It goes
    /// to the store once the account has joined; until then, joining settles
    /// it.
    public func localChanged(key: String, value: Any) {
        guard isEnabled, let accountId, isJoined(accountId),
              let entryKey = SettingsSyncRules.storeKey(accountId: accountId, key: key),
              SettingsSyncRules.isSyncableValue(value)
        else { return }
        store.set(value, forKey: entryKey)
    }

    /// The settings page's "Sync settings with iCloud" switch. Off keeps
    /// every setting as it is and forgets every account's first sync; on
    /// joins again, so iCloud's settings win when it has some.
    public func setEnabled(_ enabled: Bool) {
        defaults.set(enabled, forKey: Self.enabledKey)
        if enabled {
            joinIfNeeded()
        } else {
            clearJoined()
        }
    }

    /// What the store's change notice said.
    func externalChange(reason: Int, keys: [String]) {
        guard isEnabled else { return }
        guard let known = ChangeReason(rawValue: reason) else {
            log.error("iCloud key-value storage changed for an unknown reason: \(reason)")
            return
        }
        switch known {
        case .serverChange:
            take(keys)
            // A device still waiting to join may now find its account there
            joinIfNeeded()
        case .initialSync:
            initialSyncArrived = true
            take(keys)
            joinIfNeeded()
        case .accountChange:
            // Another iCloud account's store: nothing joined before counts,
            // and its download starts over
            log.notice("The iCloud account changed; joining again")
            initialSyncArrived = false
            firstSuccessfulSync = nil
            clearJoined()
            joinIfNeeded()
        case .quotaViolation:
            log.error("iCloud key-value storage is over quota; settings stay on this device")
        }
    }

    /// Values another device wrote, taken into this device's settings where
    /// they differ: this account's synced settings only. They go into
    /// UserDefaults directly and never through `localChanged`, so nothing
    /// received is written back; the pusher and the home-screen shortcuts
    /// follow the defaults change as they always have.
    private func take(_ keys: [String]) {
        guard let accountId else { return }
        var changed: [String: Any] = [:]
        for key in keys {
            if let item = store.object(forKey: key) {
                changed[key] = item
            }
        }
        let local = CustomModeSettings.current(from: defaults)
        for (key, value) in SettingsSyncRules.settings(for: accountId, in: changed)
        where !SettingsSyncRules.sameValue(local[key], value) {
            defaults.set(value, forKey: CustomModeSettings.defaultsKey(for: key))
        }
    }

    /// The current account's first sync, if it has not had one.
    func joinIfNeeded() {
        guard isEnabled, let accountId, !isJoined(accountId) else { return }
        let identity = hasICloudIdentity()
        let synchronized = store.synchronize()
        if synchronized, identity, firstSuccessfulSync == nil {
            firstSuccessfulSync = now()
        }
        let inStore = SettingsSyncRules.settings(for: accountId, in: store.dictionaryRepresentation)
        let decision = SettingsSyncRules.joinDecision(
            storeHasAccountKeys: !inStore.isEmpty,
            initialSyncArrived: initialSyncArrived,
            secondsSinceSuccessfulSync: firstSuccessfulSync.map { now().timeIntervalSince($0) },
            hasICloudIdentity: identity
        )
        switch decision {
        case .adopt:
            let plan = SettingsSyncRules.adoption(
                local: CustomModeSettings.current(from: defaults), inStore: inStore
            )
            for (key, value) in plan.set {
                defaults.set(value, forKey: CustomModeSettings.defaultsKey(for: key))
            }
            for key in plan.remove {
                defaults.removeObject(forKey: CustomModeSettings.defaultsKey(for: key))
            }
            defaults.set(true, forKey: Self.joinedKeyPrefix + accountId)
            log.notice("Took this account's Custom mode settings from iCloud")
        case .upload:
            let entries = SettingsSyncRules.storeEntries(
                accountId: accountId, local: CustomModeSettings.current(from: defaults)
            )
            for (key, value) in entries {
                store.set(value, forKey: key)
            }
            _ = store.synchronize()
            defaults.set(true, forKey: Self.joinedKeyPrefix + accountId)
            log.notice("Sent this device's Custom mode settings to iCloud")
        case .wait(let recheckIn):
            if !identity {
                log.notice("No iCloud account; Custom mode settings stay on this device")
            }
            guard let recheckIn, !recheckPending else { return }
            recheckPending = true
            schedule(recheckIn) { [weak self] in
                self?.recheckPending = false
                self?.joinIfNeeded()
            }
        }
    }

    private func clearJoined() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.joinedKeyPrefix) {
            defaults.removeObject(forKey: key)
        }
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -5`
Expected: the run passes, including the 19 new tests.

- [ ] **Step 5: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0. Nothing creates the component yet, so no app behaves differently.

- [ ] **Step 6: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettingsSync.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsSyncTests.swift
```

```bash
cd /Users/mdbraber/src/fastmail-custom
git commit -F - <<'EOF'
feat: a sync component copies Custom mode settings to and from iCloud

It joins each Fastmail account once, taking iCloud's settings or sending this
device's, writes each later change, takes other devices' changes without
echoing them, and stops when its switch is off.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 4: The bridge, the scripts and the harness

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`: properties (around line 37), init (57-58), assignments (76-77), actions (223-226)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift:65-84`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`: `CustomModeSettingsPusher` (around 515-527 and 576-584)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js:779-781`
- Test: `NativeBridgeTests.swift`, `CustomModeSettingsTests.swift` and `CustomModeSettingsPusherTests.swift` in `Packages/FastmailShellKit/Tests/FastmailShellKitTests/` (append)
- Test: `Tests/IntegrationTests/HarnessTests.swift` (insert before `// MARK: The Notifications page`, around line 858)

**Interfaces:**
- Consumes (Task 2): `SettingsSyncRules.isValidAccountId(_:)`.
- Produces:
  - `NativeBridge.init` gains two trailing parameters, `onAccount: @escaping @MainActor (String) -> Void = { _ in }` and `onSettingsSync: @escaping @MainActor (Bool) -> Void = { _ in }`.
  - Two bridge actions, with the replies and errors in Global Constraints: `account` and `settingsSync`.
  - `CustomModeSettings`:
    - `static func syncLine(_ syncEnabled: Bool?) -> String`: `""` for nil, else `"\nwindow.__customModeSync = {\"enabled\":<bool>};"`
    - `@MainActor public static func bootstrapScript(from: UserDefaults = .standard, syncEnabled: Bool? = nil) -> WKUserScript`
    - `public static func applyScriptSource(from: UserDefaults = .standard, syncEnabled: Bool? = nil) -> String`, which sets `__customModeSync` before calling `applySettings`
  - `CustomModeSettingsPusher.init(webView: WKWebView, syncEnabled: @escaping @MainActor () -> Bool? = { nil })`. It compares and pushes the whole apply script.
  - The harness: `window.native.account(accountId)` and `window.native.setSettingsSync(enabled)`.

**How the pusher learns the switch's state.** The switch is stored in `UserDefaults`, so flipping it posts the `didChangeNotification` the pusher already observes. The pusher asks the closure it was given for the state each time it builds a push. It compares the whole script, settings and switch together, not the settings JSON alone. So a flip in one window reaches every other window of the same app. Task 5 passes `{ CustomModeSettingsSync.current?.isEnabled }`.

- [ ] **Step 1: Write the failing package tests**

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift`:

```swift
// MARK: Settings sync

@Test @MainActor func accountActionHandsOnAValidAccountId() async {
    var reported: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onAccount: { reported.append($0) }
    )
    let reply = await bridge.handle(body: ["action": "account", "payload": ["accountId": "u1234abcd"]])
    #expect(reply.error == nil)
    #expect(reported == ["u1234abcd"])
}

// The id becomes part of every store key, so anything that could not be one
// is refused before the app hears of it
@Test @MainActor func accountActionRefusesEmptyOverlongAndBadlyFormedIds() async {
    var reported: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onAccount: { reported.append($0) }
    )
    let payloads: [[String: Any]] = [
        [:],
        ["accountId": ""],
        ["accountId": String(repeating: "a", count: 33)],
        ["accountId": "u1234.abcd"],
        ["accountId": "u1234 abcd"],
        ["accountId": "ü1234abcd"],
        ["accountId": NSNumber(value: 1234)],
    ]
    for payload in payloads {
        let reply = await bridge.handle(body: ["action": "account", "payload": payload])
        #expect(reply.error != nil, "\(payload) should be refused")
    }
    #expect(reported.isEmpty)
}

// JavaScript's 1 and true both cross as NSNumber; only a real boolean counts
@Test @MainActor func settingsSyncActionTakesARealBooleanOnly() async {
    var received: [Bool] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSettingsSync: { received.append($0) }
    )
    let on = await bridge.handle(body: ["action": "settingsSync", "payload": ["enabled": true]])
    let off = await bridge.handle(body: ["action": "settingsSync", "payload": ["enabled": false]])
    #expect(on.error == nil)
    #expect(off.error == nil)
    for value in [NSNumber(value: 1), NSNumber(value: 0), "true", [:] as [String: String]] as [Any] {
        let reply = await bridge.handle(body: ["action": "settingsSync", "payload": ["enabled": value]])
        #expect(reply.error != nil)
    }
    let missing = await bridge.handle(body: ["action": "settingsSync", "payload": [:]])
    #expect(missing.error != nil)
    #expect(received == [true, false])
}
```

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift`:

```swift
// Only a host that can sync says so; a page told nothing draws no switch.
// Where it is said, it is said before the page is asked to apply.
@Test func theApplyScriptCarriesTheSyncSwitchOnlyWhereThereIsOne() throws {
    let defaults = freshDefaults(#function)
    #expect(!CustomModeSettings.applyScriptSource(from: defaults).contains("__customModeSync"))

    let on = CustomModeSettings.applyScriptSource(from: defaults, syncEnabled: true)
    #expect(on.contains(#"window.__customModeSync = {"enabled":true};"#))
    let sync = try #require(on.range(of: "window.__customModeSync"))
    let apply = try #require(on.range(of: "applySettings"))
    #expect(sync.lowerBound < apply.lowerBound)

    let off = CustomModeSettings.applyScriptSource(from: defaults, syncEnabled: false)
    #expect(off.contains(#"window.__customModeSync = {"enabled":false};"#))
}

@Test @MainActor func theBootstrapCarriesTheSyncSwitchOnlyWhereThereIsOne() {
    let defaults = freshDefaults(#function)
    #expect(!CustomModeSettings.bootstrapScript(from: defaults).source.contains("__customModeSync"))

    let script = CustomModeSettings.bootstrapScript(from: defaults, syncEnabled: false)
    #expect(script.source.hasPrefix("window.__customModeSettings = {"))
    #expect(script.source.hasSuffix(#"window.__customModeSync = {"enabled":false};"#))
}
```

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsPusherTests.swift`:

```swift
// The switch is not a setting, so a flip leaves the settings as they were;
// the pusher compares the whole script, which carries the switch
@Test func aFlippedSyncSwitchIsPushedAndAnUnchangedOneIsNot() {
    let suite = "pusher-sync-switch-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    let on = CustomModeSettings.applyScriptSource(from: defaults, syncEnabled: true)
    let off = CustomModeSettings.applyScriptSource(from: defaults, syncEnabled: false)
    #expect(CustomModeSettingsPusher.shouldPush(off, after: on, force: false))
    #expect(!CustomModeSettingsPusher.shouldPush(off, after: off, force: false))
    defaults.removePersistentDomain(forName: suite)
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | grep -E "error:" | head -8`
Expected: the build fails with `extra argument 'onAccount' in call`, `extra argument 'onSettingsSync' in call` and `extra argument 'syncEnabled' in call`.

- [ ] **Step 3: Add the two actions to the bridge**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`, replace:

```swift
    private let onOpenNotificationSettings: @MainActor () -> Void

    public init(
```

with:

```swift
    private let onOpenNotificationSettings: @MainActor () -> Void
    /// The Fastmail account the page is on, already checked, for settings sync.
    private let onAccount: @MainActor (String) -> Void
    /// The settings page's "Sync settings with iCloud" switch.
    private let onSettingsSync: @MainActor (Bool) -> Void

    public init(
```

Replace:

```swift
        onOpenNotificationSettings: @escaping @MainActor () -> Void = {}
    ) {
```

with:

```swift
        onOpenNotificationSettings: @escaping @MainActor () -> Void = {},
        onAccount: @escaping @MainActor (String) -> Void = { _ in },
        onSettingsSync: @escaping @MainActor (Bool) -> Void = { _ in }
    ) {
```

Replace:

```swift
        self.onOpenNotificationSettings = onOpenNotificationSettings
    }
```

with:

```swift
        self.onOpenNotificationSettings = onOpenNotificationSettings
        self.onAccount = onAccount
        self.onSettingsSync = onSettingsSync
    }
```

Replace:

```swift
        case "openNotificationSettings":
            onOpenNotificationSettings()
            return BridgeReply(value: nil, error: nil)
        default:
```

with:

```swift
        case "openNotificationSettings":
            onOpenNotificationSettings()
            return BridgeReply(value: nil, error: nil)
        case "account":
            // The id becomes part of every store key, so it is checked here
            guard
                let accountId = payload["accountId"] as? String,
                SettingsSyncRules.isValidAccountId(accountId)
            else {
                return BridgeReply(value: nil, error: "account payload has no usable accountId")
            }
            onAccount(accountId)
            return BridgeReply(value: nil, error: nil)
        case "settingsSync":
            // A real boolean only, for the reason the setting action gives
            guard
                let number = payload["enabled"] as? NSNumber,
                CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID()
            else {
                return BridgeReply(value: nil, error: "settingsSync enabled must be a boolean")
            }
            onSettingsSync(number.boolValue)
            return BridgeReply(value: nil, error: nil)
        default:
```

- [ ] **Step 4: Tell the page whether its host can sync**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift`, replace:

```swift
    /// Writes the settings global before anything else runs, so the payload
    /// finds it when it starts; the WKUserScript counterpart of the Safari
    /// extension injecting settings ahead of its payload.
    @MainActor
    public static func bootstrapScript(from defaults: UserDefaults = .standard) -> WKUserScript {
        WKUserScript(
            source: "window.__customModeSettings = \(json(from: defaults));",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    /// Pushes the settings into a page that is already running. The global is
    /// refreshed as well so a payload injected later still reads the latest.
    public static func applyScriptSource(from defaults: UserDefaults = .standard) -> String {
        """
        window.__customModeSettings = \(json(from: defaults));
        if (window.customMode) window.customMode.applySettings(window.__customModeSettings);
        """
    }
```

with:

```swift
    /// What tells the page that its host can sync these settings, and
    /// whether the host's switch is on. Nothing where no sync component was
    /// installed, so the page draws no switch there.
    static func syncLine(_ syncEnabled: Bool?) -> String {
        guard let syncEnabled else { return "" }
        return "\nwindow.__customModeSync = {\"enabled\":\(syncEnabled)};"
    }

    /// Writes the settings global before anything else runs, so the payload
    /// finds it when it starts; the WKUserScript counterpart of the Safari
    /// extension injecting settings ahead of its payload.
    @MainActor
    public static func bootstrapScript(
        from defaults: UserDefaults = .standard,
        syncEnabled: Bool? = nil
    ) -> WKUserScript {
        WKUserScript(
            source: "window.__customModeSettings = \(json(from: defaults));" + syncLine(syncEnabled),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    /// Pushes the settings into a page that is already running. The globals
    /// are refreshed as well so a payload injected later still reads the
    /// latest, and the sync switch's state is in place before the page is
    /// told to apply.
    public static func applyScriptSource(
        from defaults: UserDefaults = .standard,
        syncEnabled: Bool? = nil
    ) -> String {
        """
        window.__customModeSettings = \(json(from: defaults));\(syncLine(syncEnabled))
        if (window.customMode) window.customMode.applySettings(window.__customModeSettings);
        """
    }
```

- [ ] **Step 5: Give the pusher the switch's state**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`, replace:

```swift
final class CustomModeSettingsPusher {
    private weak var webView: WKWebView?
    // Written once in init, read again only from deinit; never concurrently
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []
    private var pushTask: Task<Void, Never>?
    /// The settings last pushed into the running page, or nothing while it
    /// has only what it was built with.
    private var pushed: String?
    /// Whether the push waiting to go was asked for regardless of change.
    private var forceNext = false

    init(webView: WKWebView) {
        self.webView = webView
```

with:

```swift
final class CustomModeSettingsPusher {
    private weak var webView: WKWebView?
    /// Whether the app's sync switch is on, or nothing where the app cannot
    /// sync. Asked afresh for every push.
    private let syncEnabled: @MainActor () -> Bool?
    // Written once in init, read again only from deinit; never concurrently
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []
    private var pushTask: Task<Void, Never>?
    /// The script last pushed into the running page, settings and switch
    /// together, or nothing while it has only what it was built with.
    private var pushed: String?
    /// Whether the push waiting to go was asked for regardless of change.
    private var forceNext = false

    init(webView: WKWebView, syncEnabled: @escaping @MainActor () -> Bool? = { nil }) {
        self.webView = webView
        self.syncEnabled = syncEnabled
```

Replace:

```swift
            let settings = CustomModeSettings.json(from: .standard)
            let force = self.forceNext
            self.forceNext = false
            guard Self.shouldPush(settings, after: self.pushed, force: force) else { return }
            self.pushed = settings
            self.webView?.evaluateJavaScript(
                CustomModeSettings.applyScriptSource(),
                completionHandler: nil
            )
```

with:

```swift
            // The whole script is compared, not the settings alone: the sync
            // switch lives outside them, and a flip made in one window has to
            // reach the others
            let script = CustomModeSettings.applyScriptSource(from: .standard, syncEnabled: self.syncEnabled())
            let force = self.forceNext
            self.forceNext = false
            guard Self.shouldPush(script, after: self.pushed, force: force) else { return }
            self.pushed = script
            self.webView?.evaluateJavaScript(script, completionHandler: nil)
```

- [ ] **Step 6: Run the package tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -5`
Expected: the run passes, including the 6 new tests. The existing `scriptsCarryTheSettingsAndTheApplyCall` and `bootstrapScriptRunsFirstAndInTheMainFrameOnly` still pass, since a nil `syncEnabled` adds nothing.

- [ ] **Step 7: Write the failing integration tests**

In `Tests/IntegrationTests/HarnessTests.swift`, replace:

```swift
        XCTAssertEqual(stored as? Bool, true)
    }

    // MARK: The Notifications page
```

with:

```swift
        XCTAssertEqual(stored as? Bool, true)
    }

    // MARK: Settings sync

    func testAccountReachesTheBridge() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        _ = try await evaluate(webView, "window.native.account('u1234abcd'); true;")
        try await waitUntil { self.received.contains { $0["action"] as? String == "account" } }
        let message = try XCTUnwrap(received.first { $0["action"] as? String == "account" })
        let payload = try XCTUnwrap(message["payload"] as? [String: Any])
        XCTAssertEqual(payload["accountId"] as? String, "u1234abcd")
    }

    // What really crosses for a JavaScript false and a JavaScript 1, fed to
    // the bridge the app runs: the switch takes the boolean and refuses the
    // number, for the reason testSetSettingWithARealJavaScriptOneIsRefused
    // gives.
    func testSetSettingsSyncCrossesAsARealBooleanOnly() async throws {
        webView = try makeWebView(userScript: "", metadata: Self.meta())
        try await load(webView)
        let sent = { self.received.filter { $0["action"] as? String == "settingsSync" } }
        _ = try await evaluate(webView, "window.native.setSettingsSync(false); true;")
        try await waitUntil { sent().count == 1 }
        _ = try await evaluate(webView, "window.native.setSettingsSync(1); true;")
        try await waitUntil { sent().count == 2 }

        var handed: [Bool] = []
        let bridge = NativeBridge(
            expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
            onSettingsSync: { handed.append($0) }
        )
        let boolean = await bridge.handle(body: sent()[0])
        let number = await bridge.handle(body: sent()[1])
        XCTAssertNil(boolean.error)
        XCTAssertNotNil(number.error)
        XCTAssertEqual(handed, [false])
    }

    // MARK: The Notifications page
```

- [ ] **Step 8: Run the integration tests to see them fail**

Run: `cd /Users/mdbraber/src/fastmail-custom && make generate && xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test -only-testing:IntegrationTests/HarnessTests 2>&1 | grep -E "Test Case .*(Account|SettingsSync).*(passed|failed)|TEST (SUCCEEDED|FAILED)"`
Expected: `testAccountReachesTheBridge` and `testSetSettingsSyncCrossesAsARealBooleanOnly` fail (`window.native.account is not a function`, and the waits time out), and the run ends `** TEST FAILED **`.

- [ ] **Step 9: Add the two calls to the harness**

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

    // Which Fastmail account the page is on, so the app keeps synced
    // settings with their own account. The app checks the id.
    window.native.account = function (accountId) {
        return post('account', { accountId: accountId });
    };

    // The settings page's "Sync settings with iCloud" switch. The app takes
    // a real boolean only.
    window.native.setSettingsSync = function (enabled) {
        return post('settingsSync', { enabled: enabled });
    };
```

- [ ] **Step 10: Run the integration tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom && xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test -only-testing:IntegrationTests/HarnessTests 2>&1 | grep -E "TEST (SUCCEEDED|FAILED)|failed"`
Expected: `** TEST SUCCEEDED **`, with no failed test cases.

- [ ] **Step 11: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 12: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettings.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsTests.swift \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsPusherTests.swift \
  Tests/IntegrationTests/HarnessTests.swift
```

```bash
cd /Users/mdbraber/src/fastmail-custom
git commit -F - <<'EOF'
feat: the bridge takes the page's account and sync switch, and the scripts carry the switch

window.native.account and window.native.setSettingsSync reach the new account
and settingsSync actions. The bootstrap and apply scripts set
window.__customModeSync where the app can sync, and the pusher compares the
whole script so a flip reaches every window.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 5: One sync component per app, wired in

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettingsSync.swift` (append after the class)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`:
  - `onSetting` (around line 119)
  - `onOpenNotificationSettings` (171-176)
  - the bootstrap script (185-187)
  - the pusher (216)
- Modify: `Apps/Personal/PersonalApp.swift:7-10`, `Apps/Work/WorkApp.swift:7-10`
- Modify: `Apps/Personal/iOS.entitlements`, `Apps/Personal/macOS.entitlements`, `Apps/Work/iOS.entitlements`, `Apps/Work/macOS.entitlements`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebContainerTests.swift` (append)

**Interfaces:**
- Consumes:
  - Task 3: `CustomModeSettingsSync.init(defaults:store:hasICloudIdentity:now:schedule:)`, `start()`, `isEnabled`, `accountReported(_:)`, `localChanged(key:value:)`, `setEnabled(_:)`, `KeyValueStore`.
  - Task 4: `NativeBridge.init(... onAccount:onSettingsSync:)`, `CustomModeSettings.bootstrapScript(syncEnabled:)`, `CustomModeSettingsPusher.init(webView:syncEnabled:)`.
- Produces:
  - `extension NSUbiquitousKeyValueStore: KeyValueStore {}`
  - `@MainActor public extension CustomModeSettingsSync` with `private(set) static var current: CustomModeSettingsSync?` and `@discardableResult static func install() -> CustomModeSettingsSync`
  - Each app's `init()` calls `CustomModeSettingsSync.install()`.
  - All four app entitlements files declare `com.apple.developer.ubiquity-kvstore-identifier` = `$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.personal`.

**Where the component lives.** `PersonalApp`/`WorkApp` is the one object per process: `AppShell` and `WebContainer` are made per window. So the app's `init()` installs it into `CustomModeSettingsSync.current`, before the first window builds its web view. The bridge closures, the bootstrap script and the pusher reach it through `current`. Where nothing installed one (package tests, integration tests, the Mailto app), `current` is nil: pages get no `__customModeSync`, and the new closures do nothing. This is the same shape as `PushRegistrar.current`.

- [ ] **Step 1: Write the failing test**

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebContainerTests.swift`:

```swift
// Tests install no sync component, and neither does the Mailto app: such a
// page is told nothing about syncing, so it draws no switch
@Test @MainActor func withoutASyncComponentThePageIsToldNothingAboutSync() {
    #expect(CustomModeSettingsSync.current == nil)
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": nonMatchingHeader + "\nBODY"
    ])
    let model = ShellModel()
    let profile = Profile(
        id: "test",
        displayName: "Test",
        startURL: URL(string: "https://127.0.0.1:1/")!,
        overlayScriptName: nil,
        urlScheme: "test",
        accountID: nil
    )
    let container = WebContainer(profile: profile, model: model, loader: loader)
    let coordinator = WebCoordinator(model: model, startURL: profile.startURL)
    let webView = container.makeWebView(coordinator: coordinator)
    let bootstrap = webView.configuration.userContentController.userScripts[0]
    #expect(bootstrap.source.hasPrefix("window.__customModeSettings = {"))
    #expect(!bootstrap.source.contains("__customModeSync"))
}
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | grep -E "error:" | head -5`
Expected: the build fails with `type 'CustomModeSettingsSync' has no member 'current'`.

- [ ] **Step 3: Install one component per app, on iCloud's store**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettingsSync.swift`, replace:

```swift
    private func clearJoined() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.joinedKeyPrefix) {
            defaults.removeObject(forKey: key)
        }
    }
}
```

with:

```swift
    private func clearJoined() {
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(Self.joinedKeyPrefix) {
            defaults.removeObject(forKey: key)
        }
    }
}

extension NSUbiquitousKeyValueStore: KeyValueStore {}

@MainActor
public extension CustomModeSettingsSync {
    /// The one the app installed, or nothing where none was: the tests, the
    /// integration tests and the Mailto app.
    private(set) static var current: CustomModeSettingsSync?

    /// Makes the app's sync component on iCloud's own store and starts it;
    /// the same one when called again. The app's entry point calls this, so
    /// it exists before the first window builds its web view.
    @discardableResult
    static func install() -> CustomModeSettingsSync {
        if let current { return current }
        let sync = CustomModeSettingsSync(
            defaults: .standard,
            store: NSUbiquitousKeyValueStore.default,
            hasICloudIdentity: { FileManager.default.ubiquityIdentityToken != nil },
            schedule: { delay, work in
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    work()
                }
            }
        )
        current = sync
        sync.start()
        return sync
    }
}
```

- [ ] **Step 4: Wire it into the web view**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`, replace:

```swift
            onSetting: { key, value in
                UserDefaults.standard.set(value, forKey: CustomModeSettings.defaultsKey(for: key))
```

with:

```swift
            onSetting: { key, value in
                UserDefaults.standard.set(value, forKey: CustomModeSettings.defaultsKey(for: key))
                // Saved first; iCloud gets it once this account has joined
                CustomModeSettingsSync.current?.localChanged(key: key, value: value)
```

Replace:

```swift
            onOpenNotificationSettings: {
                #if canImport(UIKit)
                NotificationSettings.openSystemSettings()
                #endif
            }
        )
```

with:

```swift
            onOpenNotificationSettings: {
                #if canImport(UIKit)
                NotificationSettings.openSystemSettings()
                #endif
            },
            // Settings sync, where the app installed it; nothing happens
            // without it
            onAccount: { accountId in
                CustomModeSettingsSync.current?.accountReported(accountId)
            },
            onSettingsSync: { enabled in
                CustomModeSettingsSync.current?.setEnabled(enabled)
            }
        )
```

Replace:

```swift
        configuration.userContentController.addUserScript(
            CustomModeSettings.bootstrapScript()
        )
```

with:

```swift
        // With the sync switch's state where the app can sync, so the page
        // draws the switch from the start
        configuration.userContentController.addUserScript(
            CustomModeSettings.bootstrapScript(syncEnabled: CustomModeSettingsSync.current?.isEnabled)
        )
```

Replace:

```swift
        coordinator.settingsPusher = CustomModeSettingsPusher(webView: webView)
```

with:

```swift
        coordinator.settingsPusher = CustomModeSettingsPusher(
            webView: webView,
            syncEnabled: { CustomModeSettingsSync.current?.isEnabled }
        )
```

- [ ] **Step 5: Run the package tests to see them pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | tail -5`
Expected: the run passes, including `withoutASyncComponentThePageIsToldNothingAboutSync`.

- [ ] **Step 6: Install the component from each app's entry point**

In `Apps/Personal/PersonalApp.swift`, and again in `Apps/Work/WorkApp.swift`, replace:

```swift
    @UIApplicationDelegateAdaptor(PushRegistrar.self) private var pushRegistrar
    #endif

    var body: some Scene {
```

with:

```swift
    @UIApplicationDelegateAdaptor(PushRegistrar.self) private var pushRegistrar
    #endif

    init() {
        // One for the whole app, before its first window: Custom mode's
        // settings follow each Fastmail account to your other devices
        CustomModeSettingsSync.install()
    }

    var body: some Scene {
```

- [ ] **Step 7: Declare the store in all four app entitlements**

In `Apps/Personal/iOS.entitlements`, and again in `Apps/Work/iOS.entitlements`, replace:

```xml
    <key>aps-environment</key>
    <string>development</string>
</dict>
```

with:

```xml
    <key>aps-environment</key>
    <string>development</string>
    <!-- Custom mode's settings in iCloud key-value storage. One store for
         the Personal and Work apps and the Safari extension, which keep
         each Fastmail account apart by key. -->
    <key>com.apple.developer.ubiquity-kvstore-identifier</key>
    <string>$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.personal</string>
</dict>
```

In `Apps/Personal/macOS.entitlements`, and again in `Apps/Work/macOS.entitlements`, replace:

```xml
    <key>com.apple.developer.team-identifier</key>
    <string>$(DEVELOPMENT_TEAM)</string>
</dict>
```

with:

```xml
    <key>com.apple.developer.team-identifier</key>
    <string>$(DEVELOPMENT_TEAM)</string>
    <!-- Custom mode's settings in iCloud key-value storage. One store for
         the Personal and Work apps and the Safari extension, which keep
         each Fastmail account apart by key. -->
    <key>com.apple.developer.ubiquity-kvstore-identifier</key>
    <string>$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.personal</string>
</dict>
```

Then run: `cd /Users/mdbraber/src/fastmail-custom && plutil -lint Apps/Personal/iOS.entitlements Apps/Personal/macOS.entitlements Apps/Work/iOS.entitlements Apps/Work/macOS.entitlements`
Expected: four lines ending `OK`.

- [ ] **Step 8: Build for iOS**

Run: `cd /Users/mdbraber/src/fastmail-custom && make generate && xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'generic/platform=iOS' -configuration Debug -derivedDataPath build/ios-app CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"`
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 9: A signed Mac build of Work carries the store**

Work is the harder case: a Mac app that is not sandboxed, declaring a store named after the other app. Automatic signing adds iCloud to the Work app id, as the spec expects. This builds into the scratchpad and installs nothing. The build registers with LaunchServices, so it is unregistered and deleted afterwards.

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
cd /Users/mdbraber/src/fastmail-custom && xcodebuild -project FastmailShell.xcodeproj -scheme Work -destination 'platform=macOS' -configuration Debug -derivedDataPath "$SCRATCH/signed-work" -allowProvisioningUpdates build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
```
Expected: `** BUILD SUCCEEDED **`. If provisioning refuses the store identifier, stop and report the error lines.

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
APP="$SCRATCH/signed-work/Build/Products/Debug/nexthealth.nl.app"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | plutil -p - | grep -E "ubiquity-kvstore|app-sandbox"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$APP"
rm -rf "$SCRATCH/signed-work"
```
Expected: exactly one line, `"com.apple.developer.ubiquity-kvstore-identifier" => "<team>.com.mdbraber.fastmail-custom.personal"`. Write `<team>` in the report, not the value.

- [ ] **Step 10: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 11: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/CustomModeSettingsSync.swift \
  Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebContainerTests.swift \
  Apps/Personal/PersonalApp.swift Apps/Work/WorkApp.swift \
  Apps/Personal/iOS.entitlements Apps/Personal/macOS.entitlements \
  Apps/Work/iOS.entitlements Apps/Work/macOS.entitlements
```

```bash
cd /Users/mdbraber/src/fastmail-custom
git commit -F - <<'EOF'
feat: the Personal and Work apps sync Custom mode settings through iCloud

Each app installs one sync component on iCloud's key-value store at launch,
and every web view hands it the page's setting changes, account and switch.
Both apps declare the one store the Safari extension will share.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 6: The userscript reports its account and draws the switch

**Files:**
- Modify: `Userscript/fastmail-custom-mode.user.js`:
  - a new block directly after `writeSetting` (around line 411), before the `State` banner
  - `settingsPane` (around line 6562)
  - `applySettings` (around line 8463)
  - `start()` (around line 8405)
  - the `mainObserver` and the start-up lines at the end of the file (around line 8489)
- Scratch: `$SCRATCH/gen-sync-probe.py`

**Interfaces:**
- Consumes:
  - Task 4: `window.native.account(accountId)`, `window.native.setSettingsSync(enabled)`, and `window.__customModeSync = {enabled}` in the apps.
  - Tasks 7 and 8: the Safari extension's handling of the page messages. Until they land, Safari ignores the new messages, since `early.js` drops any message that is not `kind: 'setting'`.
  - The userscript's existing `hostIsExtension()`, `primaryMailAccountId()`, `reportFault(what, error)`, `settingsSection`, `SETTING_GROUPS` and `FastMail.classes.ToggleView`/`View`.
- Produces, inside the userscript's scope:
  - `SYNC_TITLE`, `SYNC_HINT`, `syncState()`, `writeSyncEnabled(enabled)`
  - `reportAccount(accountId)`, `reportAccountWhenKnown()`
  - `syncRow(classes)`, `syncRows(classes, group)`, `refreshSyncRow()`
  - The page messages `{source: 'custom-mode', kind: 'account', accountId}` and `{source: 'custom-mode', kind: 'sync', enabled}` in Safari.

- [ ] **Step 1: Write the probe generator (the failing test)**

Create `$SCRATCH/gen-sync-probe.py`:

```python
#!/usr/bin/env python3
"""Evaluate the userscript's settings-sync block as it is on disk, in its own
scope, against stand-ins for window, the host and Fastmail's classes; and,
inside the running app, draw the real switch in a view that never enters the
document and read Fastmail's own account id's shape. Nothing is registered,
nothing is written, and the id itself is never returned."""
import json
import pathlib
import sys

REPO = pathlib.Path("/Users/mdbraber/src/fastmail-custom")
OUT = pathlib.Path(sys.argv[1])
now = (REPO / "Userscript/fastmail-custom-mode.user.js").read_text(encoding="utf-8")

START = "    /*\n     * Settings sync. A host that can keep these settings in iCloud"
END = "    /*\n     * ----------------------------------------------------------------\n     * State\n"

if START not in now:
    sys.exit("FAIL: start marker missing")
at = now.index(START)
if END not in now[at:]:
    sys.exit("FAIL: end marker missing")
block = now[at:now.index(END, at)]

apply_at = now.index("applySettings: (next) => {")
apply_end = now.index("\n        };", apply_at)
file_checks = {
    "the switch rows lead each section": "syncRows(classes, group).concat(" in now,
    "applySettings refreshes the switch": "refreshSyncRow();" in now[apply_at:apply_end],
    "the account is reported from all three starts": now.count("reportAccountWhenKnown();") == 3,
    "primaryMailAccountId reads the primary mail account":
        "FastMail.auth.get('primaryAccounts')" in now and "['urn:ietf:params:jmap:mail']" in now,
}

HEAD = r"""
const faults = [];
const reportFault = (what) => { faults.push(String(what)); };
let hostExtension = false;
const hostIsExtension = () => hostExtension;
let accountAnswer = null;
const primaryMailAccountId = () => accountAnswer;
"""

SCOPE = "\n".join([
    "const syncScope = (window) => {",
    block,
    "    return {",
    "        SYNC_TITLE, SYNC_HINT, syncState, writeSyncEnabled, reportAccount,",
    "        reportAccountWhenKnown, syncRows, refreshSyncRow",
    "    };",
    "};",
])

BODY = r"""
const SPEC_TITLE = 'Sync settings with iCloud';
const SPEC_HINT = 'Keeps these settings the same on your other devices for this Fastmail account. ' +
    'The bar lengths stay on each device. Turning syncing on takes the settings already in iCloud.';
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const facts = {};
const notes = {};
const fact = (name, value) => { facts[name] = !!value; };
Object.keys(fileChecks).forEach(name => fact('file: ' + name, fileChecks[name]));

const recorder = () => {
    const calls = [];
    const fn = function () { calls.push(Array.prototype.slice.call(arguments)); };
    fn.calls = calls;
    return fn;
};
const appNative = () => ({ account: recorder(), setSettingsSync: recorder() });

// The block reads window.native, window.__customModeSync, window.FastMail and
// window.postMessage; each case gets a window of its own
const standIn = (native, sync) => {
    const posted = [];
    const win = {
        FastMail: window.FastMail || {},
        native: native,
        __customModeSync: sync,
        postMessage: (message, origin) => { posted.push({ message: message, origin: origin }); }
    };
    return { win: win, posted: posted };
};

// Views that count their redraws, and switches flipped by hand
const fakeClasses = (toggles) => {
    const View = function (options) { this.options = options; this.redraws = 0; this.inDocument = true; };
    View.prototype.get = function (key) { return key === 'isInDocument' ? this.inDocument : undefined; };
    View.prototype.viewNeedsRedraw = function () { this.redraws += 1; this.options.draw(); };
    const ToggleView = function (options) {
        this.options = options;
        this.value = options.value;
        this.observers = [];
        toggles.push(this);
    };
    ToggleView.prototype.get = function (key) { return key === 'value' ? this.value : undefined; };
    ToggleView.prototype.addObserverForKey = function (key, object, method) {
        this.observers.push(() => object[method]());
    };
    ToggleView.prototype.flip = function () {
        this.value = !this.value;
        this.observers.forEach(run => run());
    };
    return { View: View, ToggleView: ToggleView };
};

try {
    {
        hostExtension = false;
        const native = appNative();
        const { win, posted } = standIn(native, { enabled: true });
        const block = syncScope(win);
        block.reportAccount('u1234abcd');
        block.writeSyncEnabled(false);
        fact('apps: the account goes to window.native.account',
            native.account.calls.length === 1 && native.account.calls[0][0] === 'u1234abcd');
        fact('apps: the switch goes to window.native.setSettingsSync',
            native.setSettingsSync.calls.length === 1 && native.setSettingsSync.calls[0][0] === false);
        fact('apps: nothing is posted', posted.length === 0);
        fact('apps: the switch state changes ahead of the echo', win.__customModeSync.enabled === false);
    }
    {
        hostExtension = true;
        const { win, posted } = standIn(undefined, { enabled: false });
        const block = syncScope(win);
        block.reportAccount('u1234abcd');
        block.writeSyncEnabled(true);
        fact('safari: the account is posted to this window',
            posted.length === 2 && posted[0].message.source === 'custom-mode' && posted[0].message.kind === 'account' &&
            posted[0].message.accountId === 'u1234abcd' && posted[0].origin === location.origin);
        fact('safari: the switch is posted', posted[1].message.kind === 'sync' && posted[1].message.enabled === true);
        hostExtension = false;
    }
    {
        const { win, posted } = standIn(undefined, undefined);
        const block = syncScope(win);
        block.reportAccount('u1234abcd');
        fact('plain tab: nothing is sent', posted.length === 0);
        fact('plain tab: no switch is drawn', block.syncRows(fakeClasses([]), { id: 'general' }).length === 0);
    }
    {
        const { win } = standIn(appNative(), { enabled: true });
        const block = syncScope(win);
        const classes = fakeClasses([]);
        fact('the switch leads the general section', block.syncRows(classes, { id: 'general' }).length === 1);
        fact('and no other section', block.syncRows(classes, { id: 'appearance' }).length === 0);
        fact('the title and hint are the spec\'s', block.SYNC_TITLE === SPEC_TITLE && block.SYNC_HINT === SPEC_HINT);
    }
    {
        const native = appNative();
        const { win } = standIn(native, { enabled: true });
        const block = syncScope(win);
        const toggles = [];
        const holder = block.syncRows(fakeClasses(toggles), { id: 'general' })[0];
        holder.options.draw();
        fact('drawn from the host\'s state', toggles.length === 1 && toggles[0].options.value === true &&
            toggles[0].options.label === SPEC_TITLE && toggles[0].options.description === SPEC_HINT);
        toggles[0].flip();
        fact('a flip is written once', native.setSettingsSync.calls.length === 1 && native.setSettingsSync.calls[0][0] === false);
        block.refreshSyncRow();
        fact('the host echoing the flip redraws nothing', holder.redraws === 0);
        win.__customModeSync = { enabled: true };
        block.refreshSyncRow();
        fact('a change from another window redraws the switch',
            holder.redraws === 1 && toggles.length === 2 && toggles[1].options.value === true);
        fact('a redraw writes nothing', native.setSettingsSync.calls.length === 1);
        holder.inDocument = false;
        win.__customModeSync = { enabled: false };
        block.refreshSyncRow();
        fact('a switch no longer on screen is left alone', holder.redraws === 1);
    }
    {
        const native = appNative();
        const { win } = standIn(native, { enabled: true });
        const block = syncScope(win);
        accountAnswer = null;
        block.reportAccountWhenKnown();
        await wait(200);
        fact('no report while the account is unknown', native.account.calls.length === 0);
        accountAnswer = 'u1234abcd';
        await wait(900);
        block.reportAccountWhenKnown();
        await wait(900);
        fact('one report once it is known',
            native.account.calls.length === 1 && native.account.calls[0][0] === 'u1234abcd');
    }
    if (window.FastMail && FastMail.classes && FastMail.auth) {
        const primary = FastMail.auth.get('primaryAccounts');
        const id = primary && primary['urn:ietf:params:jmap:mail'];
        fact('Fastmail: the primary mail account id is a string', typeof id === 'string');
        fact('Fastmail: the id passes the hosts\' rule', typeof id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(id));
        const { win } = standIn(appNative(), { enabled: true });
        const block = syncScope(win);
        let row = null;
        try {
            row = block.syncRows(FastMail.classes, { id: 'general' })[0];
            const layer = row.render().get('layer');
            fact('Fastmail: the real switch draws the title and the hint',
                layer.textContent.indexOf(SPEC_TITLE) !== -1 && layer.textContent.indexOf(SPEC_HINT) !== -1);
            fact('Fastmail: a view never placed is not in the document', row.get('isInDocument') === false);
        } finally {
            if (row) row.destroy();
        }
        notes.app = FastMail.router.get('app');
    } else {
        notes.fastmail = 'not checked: no FastMail here';
    }
} catch (error) {
    notes.threw = String((error && error.stack) || error);
}
notes.faults = faults;
const failed = Object.keys(facts).filter(name => !facts[name]);
return JSON.stringify({ pass: failed.length === 0 && !notes.threw && faults.length === 0, failed, facts, notes }, null, 1);
"""

OUT.write_text(
    HEAD + "const fileChecks = " + json.dumps(file_checks) + ";\n" + SCOPE + "\n" + BODY,
    encoding="utf-8",
)
print(f"wrote {OUT}")
```

- [ ] **Step 2: Run it to see it fail**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
python3 "$SCRATCH/gen-sync-probe.py" "$SCRATCH/sync-probe.js"; echo "exit $?"
```
Expected: `FAIL: start marker missing` and `exit 1`.

- [ ] **Step 3: Add the sync block after `writeSetting`**

In `Userscript/fastmail-custom-mode.user.js`, replace:

```js
        try {
            const stored = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY)) || {};
            stored[key] = value;
            localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(stored));
        } catch (error) {
            reportFault('could not save that setting');
        }
    };
```

with:

```js
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
     * window.__customModeSync = {enabled} beside the settings, and sets it
     * again before every applySettings. A plain browser tab has no such
     * object, so it draws no switch.
     *
     * The host keeps each Fastmail account's settings apart, so the page
     * tells it which account it is, once per load. Fastmail's session can
     * arrive after its router and classes, so the page asks again every half
     * second for a minute and then lets go; a page that never learns its
     * account keeps its settings on this device, as before.
     */
    const SYNC_TITLE = 'Sync settings with iCloud';
    const SYNC_HINT = 'Keeps these settings the same on your other devices for this Fastmail account. ' +
        'The bar lengths stay on each device. Turning syncing on takes the settings already in iCloud.';
    const ACCOUNT_REPORT_DELAY = 500;
    const ACCOUNT_REPORT_TRIES = 120;

    const syncState = () => {
        const sync = window.__customModeSync;
        return sync && typeof sync.enabled === 'boolean' ? sync : null;
    };

    // The host's echo comes back through applySettings; the state changes
    // here first, so the switch and the page agree until it lands.
    const writeSyncEnabled = (enabled) => {
        window.__customModeSync = { enabled: enabled };

        if (window.native && typeof window.native.setSettingsSync === 'function') {
            window.native.setSettingsSync(enabled);
            return;
        }

        if (hostIsExtension()) {
            window.postMessage(
                { source: 'custom-mode', kind: 'sync', enabled: enabled },
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
                { source: 'custom-mode', kind: 'account', accountId: accountId },
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
     * The switch, at the top of the general section, in a view of its own so
     * that a change made in another window redraws the switch and nothing
     * else on the page. A switch just flipped here already shows what the
     * host will echo back, so that echo redraws nothing.
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

    // What goes ahead of a group's own options
    const syncRows = (classes, group) =>
        group.id === 'general' && syncState() ? [syncRow(classes)] : [];

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
```

- [ ] **Step 4: Put the switch at the top of the general section**

Replace:

```js
                const sections = SETTING_GROUPS.map(group => settingsSection(group,
                    settingsInGroup(group.id).map(option => sectionRow(classes, option, register))));
```

with:

```js
                const sections = SETTING_GROUPS.map(group => settingsSection(group,
                    syncRows(classes, group).concat(
                        settingsInGroup(group.id).map(option => sectionRow(classes, option, register)))));
```

- [ ] **Step 5: Let a push refresh the switch**

Replace:

```js
                updateInboxLabelVisibility();
                refresh();
            }
        };
```

with:

```js
                updateInboxLabelVisibility();
                refresh();
                // The host sets its sync switch's state before each push
                refreshSyncRow();
            }
        };
```

- [ ] **Step 6: Report the account from every start**

Replace:

```js
        installAppBadge();
        startSettingsPage();
```

with:

```js
        installAppBadge();
        startSettingsPage();
        reportAccountWhenKnown();
```

Replace:

```js
    const mainObserver = new MutationObserver(() => {
        if (settingsPageCanStart()) startSettingsPage();
        if (!isReady()) return;
        mainObserver.disconnect();
        start();
    });

    if (settingsPageCanStart()) startSettingsPage();
```

with:

```js
    // The account is reported as soon as the settings page can start, since a
    // load straight onto Settings may never reach start()
    const mainObserver = new MutationObserver(() => {
        if (settingsPageCanStart()) {
            startSettingsPage();
            reportAccountWhenKnown();
        }
        if (!isReady()) return;
        mainObserver.disconnect();
        start();
    });

    if (settingsPageCanStart()) {
        startSettingsPage();
        reportAccountWhenKnown();
    }
```

- [ ] **Step 7: Run the probe to see it pass**

The probe reads the file from disk, so nothing needs installing. In the running app the host still has the old harness and no `__customModeSync`; the probe uses stand-ins for both.

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
node --check /Users/mdbraber/src/fastmail-custom/Userscript/fastmail-custom-mode.user.js && echo "syntax ok"
python3 "$SCRATCH/gen-sync-probe.py" "$SCRATCH/sync-probe.js"
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/sync-probe.js\" as «class utf8»)" | tee "$SCRATCH/sync-probe.out"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return FastMail.router.get(\"app\") + \" \" + location.pathname"'
```
Expected:
- `syntax ok`
- `"pass": true`, `"failed": []`, and all 27 facts true, including the four `file:` facts and the four `Fastmail:` facts
- `"notes"` shows `"app": "mail"` and `"faults": []`
- the last line starts `mail /mail/`

If any `Fastmail:` fact fails, stop and report the output: Fastmail has changed, or its account id does not fit the rule. The controller decides.

- [ ] **Step 8: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Userscript/fastmail-custom-mode.user.js
```

```bash
cd /Users/mdbraber/src/fastmail-custom
git commit -F - <<'EOF'
feat: Custom mode reports its Fastmail account and offers a "Sync settings with iCloud" switch

The page tells its host which account it is once Fastmail knows. Where the
host can sync, the settings page's general section opens with the switch,
which follows a change made in another window.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 7: The Safari extension's native part

**Files:**
- Create: `SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode Extension/Fastmail Custom Mode Extension.entitlements`
- Modify: `SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode.xcodeproj/project.pbxproj`, by `$SCRATCH/edit-safari-project.py`: lines 19, 66, 143, 290, and 442-445 and 477-480
- Modify: `SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode Extension/SafariWebExtensionHandler.swift` (whole file)
- Modify: `SafariExtension/manifest.json:13-17`
- Modify: `Makefile:57`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift` (append)

**Interfaces:**
- Consumes (Task 2): `SettingsSyncRules.extensionAnswer(to:hasICloudIdentity:storeContents:)`, `ExtensionAnswer.reply` and `ExtensionAnswer.write`.
- Produces:
  - The native part answers `browser.runtime.sendNativeMessage`:
    - `{action: 'get', accountId}` → `{ok: true, available, settings}`
    - `{action: 'set', accountId, key, value}` → `{ok: true}`, after writing `<accountId>.<key>` and calling `synchronize()`
    - anything refused → `{ok: false, error}`, logged with `os_log`
  - The extension target is signed with the App Sandbox and `com.apple.developer.ubiquity-kvstore-identifier` = `$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.personal`. The host app is unchanged.
  - `manifest.json` permissions gain `nativeMessaging` and `alarms`.
  - `make build-extension` passes `-allowProvisioningUpdates`.

**How the project compiles the shared rules file.** The extension target gets a file reference with `sourceTree = SOURCE_ROOT` and `path = ../../../Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift`, and a build-file entry in its Sources phase. So it compiles the package's own file, with no copy to drift. The project is Xcode's explicit-group format, so the edit is made by a script: it checks each anchor occurs once and each new id is unused, and writes nothing otherwise.

- [ ] **Step 1: Write the failing parity test**

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift`:

```swift
// The extension's native part answers through the rules file the apps
// compile, so its store keys and local-only list are the apps' own
@Test func theSafariExtensionsNativePartAnswersThroughTheSharedRules() throws {
    let project = repoRoot.appendingPathComponent("SafariExtension/App/Fastmail Custom Mode")
    let handler = try String(
        contentsOf: project.appendingPathComponent("Fastmail Custom Mode Extension/SafariWebExtensionHandler.swift"),
        encoding: .utf8
    )
    #expect(handler.contains("SettingsSyncRules.extensionAnswer("))

    let pbxproj = try String(
        contentsOf: project.appendingPathComponent("Fastmail Custom Mode.xcodeproj/project.pbxproj"),
        encoding: .utf8
    )
    let reference = "../../../Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift"
    #expect(pbxproj.contains("path = \(reference);"))
    #expect(pbxproj.contains("/* SettingsSyncRules.swift in Sources */,"))
    let named = project.appendingPathComponent(reference).standardizedFileURL
    #expect(FileManager.default.fileExists(atPath: named.path))
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter theSafariExtensionsNativePartAnswersThroughTheSharedRules 2>&1 | grep -E "Expectation failed|passed|failed after" | head -8`
Expected: three expectation failures (the handler, the `path =` line and the Sources line), and the test fails. The `fileExists` expectation already passes.

- [ ] **Step 3: Give the extension target its entitlements**

Create `SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode Extension/Fastmail Custom Mode Extension.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <!-- The store the Personal and Work apps share, for Custom mode's
         settings. The host app does not declare it. -->
    <key>com.apple.developer.ubiquity-kvstore-identifier</key>
    <string>$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.personal</string>
</dict>
</plist>
```

Run: `cd "/Users/mdbraber/src/fastmail-custom/SafariExtension/App/Fastmail Custom Mode" && plutil -lint "Fastmail Custom Mode Extension/Fastmail Custom Mode Extension.entitlements"`
Expected: a line ending `OK`.

- [ ] **Step 4: Edit the project**

The script inserts, each directly after the named existing line:
- the build file `1E7B5DFFC1A1FE242E63E437`, after the handler's build file;
- the file references `381268564FF4103EF87FE214` (the rules file) and `490BF15CE0D0922353BD3F7D` (the entitlements), after the handler's file reference;
- both references in the extension's group, after its `Info.plist`;
- the build file in the extension's Sources phase, after the handler;
- `CODE_SIGN_ENTITLEMENTS` at the top of the extension's Debug (`6BD49795302BA54200196E0B`) and Release (`6BD49796302BA54200196E0B`) build settings.

It never reads or writes the project's `DEVELOPMENT_TEAM` lines.

Create `$SCRATCH/edit-safari-project.py`:

```python
#!/usr/bin/env python3
"""Task 7: give the Safari extension target its entitlements file, and compile
the apps' SettingsSyncRules.swift into it by reference. Every anchor must be
found exactly once and every new id must be unused, or nothing is written."""
import pathlib
import sys

PROJECT = pathlib.Path(
    "/Users/mdbraber/src/fastmail-custom/SafariExtension/App/Fastmail Custom Mode/"
    "Fastmail Custom Mode.xcodeproj/project.pbxproj"
)
BUILD_FILE = "1E7B5DFFC1A1FE242E63E437"
RULES_REF = "381268564FF4103EF87FE214"
ENTITLEMENTS_REF = "490BF15CE0D0922353BD3F7D"
RULES_PATH = "../../../Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift"
ENTITLEMENTS_SETTING = "\t\t\t\tCODE_SIGN_ENTITLEMENTS = \"Fastmail Custom Mode Extension/Fastmail Custom Mode Extension.entitlements\";\n"

# (anchor, text inserted directly after it)
EDITS = [
    # The build file, after the handler's
    (
        "\t\t6BD49790302BA54200196E0B /* SafariWebExtensionHandler.swift in Sources */ = {isa = PBXBuildFile; "
        "fileRef = 6BD4978F302BA54200196E0B /* SafariWebExtensionHandler.swift */; };\n",
        f"\t\t{BUILD_FILE} /* SettingsSyncRules.swift in Sources */ = {{isa = PBXBuildFile; "
        f"fileRef = {RULES_REF} /* SettingsSyncRules.swift */; }};\n",
    ),
    # The two file references, after the handler's: the rules file from the
    # project folder, the entitlements file in the extension's group
    (
        "\t\t6BD4978F302BA54200196E0B /* SafariWebExtensionHandler.swift */ = {isa = PBXFileReference; "
        "lastKnownFileType = sourcecode.swift; path = SafariWebExtensionHandler.swift; sourceTree = \"<group>\"; };\n",
        f"\t\t{RULES_REF} /* SettingsSyncRules.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; "
        f"name = SettingsSyncRules.swift; path = {RULES_PATH}; sourceTree = SOURCE_ROOT; }};\n"
        f"\t\t{ENTITLEMENTS_REF} /* Fastmail Custom Mode Extension.entitlements */ = {{isa = PBXFileReference; "
        "lastKnownFileType = text.plist.entitlements; path = \"Fastmail Custom Mode Extension.entitlements\"; "
        "sourceTree = \"<group>\"; };\n",
    ),
    # Both, in the extension's group
    (
        "\t\t\t\t6BD49791302BA54200196E0B /* Info.plist */,\n",
        f"\t\t\t\t{ENTITLEMENTS_REF} /* Fastmail Custom Mode Extension.entitlements */,\n"
        f"\t\t\t\t{RULES_REF} /* SettingsSyncRules.swift */,\n",
    ),
    # The rules file, compiled with the handler
    (
        "\t\t\t\t6BD49790302BA54200196E0B /* SafariWebExtensionHandler.swift in Sources */,\n",
        f"\t\t\t\t{BUILD_FILE} /* SettingsSyncRules.swift in Sources */,\n",
    ),
    # The entitlements file, for the extension's Debug and Release
    (
        "\t\t6BD49795302BA54200196E0B /* Debug */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n",
        ENTITLEMENTS_SETTING,
    ),
    (
        "\t\t6BD49796302BA54200196E0B /* Release */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n",
        ENTITLEMENTS_SETTING,
    ),
]

project = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else PROJECT
text = project.read_text(encoding="utf-8")
for new_id in (BUILD_FILE, RULES_REF, ENTITLEMENTS_REF):
    if new_id in text:
        sys.exit(f"FAIL: {new_id} is already in the project")
for anchor, insert in EDITS:
    count = text.count(anchor)
    if count != 1:
        sys.exit(f"FAIL: anchor found {count} times: {anchor[:90]!r}")
    text = text.replace(anchor, anchor + insert)
project.write_text(text, encoding="utf-8")
print(f"edited {project}")
```

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
cd /Users/mdbraber/src/fastmail-custom
python3 "$SCRATCH/edit-safari-project.py"
plutil -lint "SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode.xcodeproj/project.pbxproj"
git diff --stat -- "SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode.xcodeproj/project.pbxproj"
```
Expected:
- `edited …/project.pbxproj`
- a line ending `OK`
- `1 file changed, 8 insertions(+)`

If the script prints `FAIL`, it has written nothing: stop and report the line.

- [ ] **Step 5: Answer through the shared rules**

Replace the whole of `SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode Extension/SafariWebExtensionHandler.swift` with:

```swift
//
//  SafariWebExtensionHandler.swift
//  Fastmail Custom Mode Extension
//
//  Created by Maarten den Braber on 2026-08-11.
//

import Foundation
import SafariServices
import os.log

/// The extension's way to iCloud. The background script sends `get` for one
/// account's synced settings and `set` for one setting; this answers from the
/// iCloud key-value store the Personal and Work apps share.
///
/// What to answer is decided by SettingsSyncRules, the same file the apps
/// compile, so the key format and the local-only list cannot drift from
/// theirs. A native part cannot hear iCloud's change notices, which is why
/// the background script asks rather than being told.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        let store = NSUbiquitousKeyValueStore.default
        let answer = SettingsSyncRules.extensionAnswer(
            to: message as? [String: Any] ?? [:],
            hasICloudIdentity: FileManager.default.ubiquityIdentityToken != nil,
            storeContents: {
                // Whatever iCloud has delivered to this Mac so far
                _ = store.synchronize()
                return store.dictionaryRepresentation
            }
        )
        if let write = answer.write {
            store.set(write.value, forKey: write.key)
            _ = store.synchronize()
        }
        if let error = answer.reply["error"] as? String {
            os_log(.error, "Custom mode settings sync refused a message: %{public}@", error)
        }

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: answer.reply]
        } else {
            response.userInfo = ["message": answer.reply]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

}
```

- [ ] **Step 6: Ask for native messaging and alarms**

In `SafariExtension/manifest.json`, replace:

```json
        "tabs",
        "storage"
    ],
```

with:

```json
        "tabs",
        "storage",
        "nativeMessaging",
        "alarms"
    ],
```

- [ ] **Step 7: Let the extension's build fetch an iCloud profile**

A target with an iCloud entitlement needs a provisioning profile that includes iCloud. Automatic signing fetches or updates one from the command line only with `-allowProvisioningUpdates`, which `build-macos` and `build-ios` already pass.

In `Makefile`, replace:

```make
-scheme "Fastmail Custom Mode" -configuration Release -derivedDataPath build build
```

with:

```make
-scheme "Fastmail Custom Mode" -configuration Release -derivedDataPath build -allowProvisioningUpdates build
```

- [ ] **Step 8: Run the parity test and typecheck the native part**

Run:
```bash
cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter theSafariExtensionsNativePartAnswersThroughTheSharedRules 2>&1 | tail -3
cd /Users/mdbraber/src/fastmail-custom && xcrun swiftc -typecheck -swift-version 5 -target x86_64-apple-macos10.14 -sdk "$(xcrun --sdk macosx --show-sdk-path)" -enable-upcoming-feature MemberImportVisibility -parse-as-library -module-name FastmailCustomModeExtension Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift "SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode Extension/SafariWebExtensionHandler.swift"; echo "typecheck exit $?"
python3 -c "import json; json.load(open('/Users/mdbraber/src/fastmail-custom/SafariExtension/manifest.json')); print('manifest ok')"
```
Expected: the test passes, `typecheck exit 0`, and `manifest ok`.

- [ ] **Step 9: Build the extension, and check what it was signed with**

This builds into the project's git-ignored `build/` folder and installs nothing. Automatic signing adds iCloud to the extension's app id.

Run:
```bash
cd /Users/mdbraber/src/fastmail-custom && make build-extension 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
APPEX="/Users/mdbraber/src/fastmail-custom/SafariExtension/App/Fastmail Custom Mode/build/Build/Products/Release/Fastmail Custom Mode.app/Contents/PlugIns/Fastmail Custom Mode Extension.appex"
codesign -d --entitlements - --xml "$APPEX" 2>/dev/null | plutil -p - | grep -E "ubiquity-kvstore|app-sandbox"
```
Expected:
- `** BUILD SUCCEEDED **`
- `"com.apple.developer.ubiquity-kvstore-identifier" => "<team>.com.mdbraber.fastmail-custom.personal"` and `"com.apple.security.app-sandbox" => true`

Write `<team>` in the report, not the value. If provisioning fails, stop and report the error lines.

- [ ] **Step 10: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 11: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add "SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode Extension/Fastmail Custom Mode Extension.entitlements" \
  "SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode.xcodeproj/project.pbxproj" \
  "SafariExtension/App/Fastmail Custom Mode/Fastmail Custom Mode Extension/SafariWebExtensionHandler.swift" \
  SafariExtension/manifest.json Makefile \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift
```

```bash
cd /Users/mdbraber/src/fastmail-custom
git commit -F - <<'EOF'
feat: the Safari extension's native part reads and writes synced settings in iCloud

It answers get and set through SettingsSyncRules, compiled into the extension
by reference, from the key-value store the apps share. The manifest asks for
native messaging and alarms, and the extension's build may fetch an iCloud
profile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 8: The Safari extension's scripts

**Files:**
- Modify: `SafariExtension/early.js:98-119` (the message listener and the comment above it)
- Modify: `SafariExtension/background.js` (whole file)
- Modify: `SafariExtension/README.md`: the Contents table and a new section after it
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift` (append)
- Scratch: `$SCRATCH/check-safari-scripts.js`

**Interfaces:**
- Consumes:
  - Task 6: the page's `{source: 'custom-mode', kind: 'account' | 'sync' | 'setting', …}` messages, and `window.customMode.applySettings` reading `window.__customModeSync`.
  - Task 7: the native part's `get`/`set` replies.
  - Task 2: `SettingsSyncRules.localOnlyKeys` and `maxAccountIdLength`, in the parity test.
- Produces:
  - The storage layout and page ↔ Safari contract in Global Constraints.
  - In `background.js`, two constant lines read by the parity test: `const LOCAL_ONLY_KEYS = ['bottomBarItems', 'topBarItems'];` and `const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;`. `early.js` has the same `ACCOUNT_ID_PATTERN` line.
  - The alarm `custom-mode-settings-sync`, every 5 minutes.

**Why the parity test checks the account id pattern rather than the key separator.** `background.js` never builds a store key: it sends `{accountId, key}` and the native part composes `<accountId>.<key>` through `SettingsSyncRules`, which Task 7's parity test ties to the apps. What the scripts must agree on with Swift is which settings stay on the Mac and what an account id looks like, so those are the two lines checked.

- [ ] **Step 1: Write the failing parity test**

Append to `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift`:

```swift
// background.js never builds a store key; the native part does, through the
// shared rules. What the scripts must agree on is which settings stay on the
// Mac and what an account id looks like.
@Test func theSafariExtensionsScriptsAgreeWithTheSyncRules() throws {
    let background = try String(
        contentsOf: repoRoot.appendingPathComponent("SafariExtension/background.js"),
        encoding: .utf8
    )
    let early = try String(
        contentsOf: repoRoot.appendingPathComponent("SafariExtension/early.js"),
        encoding: .utf8
    )

    let line = try #require(
        background.split(separator: "\n").first { $0.hasPrefix("const LOCAL_ONLY_KEYS = ") },
        "background.js no longer declares LOCAL_ONLY_KEYS"
    )
    let names = line.split(separator: "'").enumerated().filter { $0.offset % 2 == 1 }.map { String($0.element) }
    #expect(names.count == SettingsSyncRules.localOnlyKeys.count)
    #expect(Set(names) == SettingsSyncRules.localOnlyKeys)

    let pattern = "const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,\(SettingsSyncRules.maxAccountIdLength)}$/;"
    #expect(background.contains(pattern))
    #expect(early.contains(pattern))
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter theSafariExtensionsScriptsAgreeWithTheSyncRules 2>&1 | grep -E "LOCAL_ONLY_KEYS|failed after" | head -3`
Expected: the test fails with `background.js no longer declares LOCAL_ONLY_KEYS`.

- [ ] **Step 3: Write the stand-in run (the second failing test)**

It loads both scripts into node's `vm` with a fake `browser` API and checks each rule. Nothing touches Safari, iCloud or real storage.

Create `$SCRATCH/check-safari-scripts.js`:

```js
// Stand-in run of the Safari extension's scripts. background.js and early.js
// are loaded into node's vm with a fake browser API, and each sync rule is
// exercised against it. Nothing here touches Safari, iCloud or storage.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = process.argv[2] || '/Users/mdbraber/src/fastmail-custom/SafariExtension';
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const quiet = { log() {}, info() {}, warn() {}, error() {} };

const results = {};
const check = (name, value) => { results[name] = !!value; };

const makeBrowser = (store) => {
    const listeners = { updated: [], activated: [], removed: [], message: [], alarm: [], changed: [] };
    const tabs = new Map();
    const executed = [];
    const native = [];
    const sent = [];
    const alarms = new Map();
    let reply = () => ({ ok: true, available: true, settings: {} });
    const hook = name => ({ addListener: (fn) => { listeners[name].push(fn); } });
    const browser = {
        storage: {
            local: {
                get: async (keys) => {
                    const out = {};
                    [].concat(keys).forEach((key) => { if (key in store) out[key] = clone(store[key]); });
                    return out;
                },
                set: async (update) => {
                    const changes = {};
                    Object.keys(update).forEach((key) => {
                        changes[key] = { oldValue: clone(store[key]), newValue: clone(update[key]) };
                        store[key] = clone(update[key]);
                    });
                    listeners.changed.forEach(fn => fn(changes, 'local'));
                }
            },
            onChanged: hook('changed')
        },
        scripting: {
            executeScript: async (options) => {
                executed.push(clone({ tabId: options.target.tabId, args: options.args, files: options.files }));
                return [];
            }
        },
        tabs: {
            onUpdated: hook('updated'),
            onActivated: hook('activated'),
            onRemoved: hook('removed'),
            query: async () => [...tabs.values()].map(clone),
            get: async id => clone(tabs.get(id))
        },
        runtime: {
            sendNativeMessage: async (application, message) => {
                native.push(clone(message));
                return reply(message);
            },
            sendMessage: (message) => {
                sent.push(clone(message));
                return Promise.resolve();
            },
            onMessage: hook('message')
        },
        alarms: {
            get: async name => alarms.get(name),
            create: (name, info) => { alarms.set(name, info); },
            onAlarm: hook('alarm')
        }
    };
    const fire = (name, ...args) => listeners[name].forEach(fn => fn(...args));
    return { browser, fire, tabs, executed, native, sent, alarms, setReply: (fn) => { reply = fn; } };
};

const loadBackground = (store) => {
    const fake = makeBrowser(store);
    vm.runInContext(
        fs.readFileSync(path.join(DIR, 'background.js'), 'utf8'),
        vm.createContext({ browser: fake.browser, console: quiet, setTimeout })
    );
    return fake;
};

const loadEarly = (store) => {
    const fake = makeBrowser(store);
    const listeners = [];
    const win = { addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); } };
    vm.runInContext(fs.readFileSync(path.join(DIR, 'early.js'), 'utf8'), vm.createContext({
        browser: fake.browser,
        console: quiet,
        window: win,
        document: { documentElement: { dataset: {}, classList: { add() {} }, appendChild() {} }, createElement: () => ({}) },
        localStorage: { getItem: () => null },
        location: { origin: 'https://app.fastmail.com', search: '', pathname: '/mail/Inbox' },
        URLSearchParams
    }));
    const post = data => listeners.forEach(fn => fn({ source: win, origin: 'https://app.fastmail.com', data }));
    return { fake, post };
};

const INBOX = 'https://app.fastmail.com/mail/Inbox';

(async () => {
    {
        const store = { settings: { labelColours: false, bottomBarItems: '4' } };
        const bg = loadBackground(store);
        await settle();
        const alarm = bg.alarms.get('custom-mode-settings-sync');
        check('background: the five-minute alarm is made once', bg.alarms.size === 1 && alarm && alarm.periodInMinutes === 5);

        bg.tabs.set(1, { id: 1, url: INBOX });
        bg.fire('updated', 1, { status: 'complete' }, { id: 1, url: INBOX });
        await settle();
        check('background: a loading tab gets the plain set and the switch before the payload',
            bg.executed.length === 2 && bg.executed[0].args[0].labelColours === false &&
            bg.executed[0].args[1].enabled === true && bg.executed[1].files[0] === 'fastmail-custom-mode.js');

        bg.setReply(() => ({ ok: true, available: true, settings: { triageLabel: 'Cloud', bottomBarItems: '9', odd: 3 } }));
        bg.executed.length = 0;
        bg.fire('message', { kind: 'account', accountId: 'u1234abcd' }, { tab: { id: 1 } });
        await settle();
        const own = store.settingsByAccount && store.settingsByAccount.u1234abcd;
        check('background: a report asks iCloud for that account',
            bg.native.length === 1 && bg.native[0].action === 'get' && bg.native[0].accountId === 'u1234abcd');
        check('background: a first sync takes iCloud\'s settings and drops the synced ones it lacks',
            own && own.triageLabel === 'Cloud' && !('labelColours' in own) && !('odd' in own));
        check('background: the bar length stays this Mac\'s', own && own.bottomBarItems === '4');
        check('background: the account is joined', (store.joinedAccounts || []).includes('u1234abcd'));
        check('background: the tab and the last account are kept',
            store.tabAccounts && store.tabAccounts['1'] === 'u1234abcd' && store.lastAccountId === 'u1234abcd');
        const last = bg.executed[bg.executed.length - 1];
        check('background: the tab gets its account\'s new set', last && last.tabId === 1 && last.args[0].triageLabel === 'Cloud');

        bg.native.length = 0;
        bg.fire('message', { kind: 'setting', accountId: 'u1234abcd', key: 'snoozeKey', value: 'q' }, { tab: { id: 1 } });
        bg.fire('message', { kind: 'setting', accountId: 'u1234abcd', key: 'topBarItems', value: '3' }, { tab: { id: 1 } });
        await settle();
        check('background: a change goes to iCloud and a bar length does not',
            bg.native.length === 1 && bg.native[0].action === 'set' && bg.native[0].key === 'snoozeKey' && bg.native[0].value === 'q');

        bg.native.length = 0;
        store.settingsByAccount.u1234abcd.snoozeKey = 'q';
        bg.setReply(() => ({ ok: true, available: true, settings: { triageLabel: 'Later' } }));
        bg.fire('activated', { tabId: 1 });
        await settle();
        check('background: a tab coming forward asks iCloud', bg.native.length === 1 && bg.native[0].action === 'get');
        check('background: once joined, iCloud overwrites what it holds and leaves the rest',
            store.settingsByAccount.u1234abcd.triageLabel === 'Later' && store.settingsByAccount.u1234abcd.snoozeKey === 'q');

        bg.native.length = 0;
        bg.executed.length = 0;
        bg.fire('message', { kind: 'sync', enabled: false }, { tab: { id: 1 } });
        await settle();
        check('background: off forgets every first sync', store.syncEnabled === false && store.joinedAccounts.length === 0);
        check('background: off reaches every tab', bg.executed.some(one => one.tabId === 1 && one.args[1].enabled === false));
        bg.fire('message', { kind: 'account', accountId: 'u1234abcd' }, { tab: { id: 1 } });
        bg.fire('message', { kind: 'setting', accountId: 'u1234abcd', key: 'snoozeKey', value: 'z' }, { tab: { id: 1 } });
        bg.fire('activated', { tabId: 1 });
        bg.fire('alarm', { name: 'custom-mode-settings-sync' });
        await settle();
        check('background: while off nothing is asked of or sent to iCloud', bg.native.length === 0);

        store.settingsByAccount.u1234abcd.triageLabel = 'Changed while off';
        bg.fire('message', { kind: 'sync', enabled: true }, { tab: { id: 1 } });
        await settle();
        check('background: on asks again and iCloud wins',
            store.syncEnabled === true && store.settingsByAccount.u1234abcd.triageLabel === 'Later' &&
            store.joinedAccounts.includes('u1234abcd'));

        bg.native.length = 0;
        bg.fire('alarm', { name: 'custom-mode-settings-sync' });
        await settle();
        check('background: the alarm asks for the open tabs\' accounts',
            bg.native.length === 1 && bg.native[0].action === 'get' && bg.native[0].accountId === 'u1234abcd');

        bg.fire('removed', 1);
        await settle();
        check('background: a closed tab is forgotten', !('1' in store.tabAccounts));
    }
    {
        const store = { settings: { labelColours: false } };
        const bg = loadBackground(store);
        bg.tabs.set(2, { id: 2, url: INBOX });
        bg.setReply(() => ({ ok: true, available: true, settings: {} }));
        bg.fire('message', { kind: 'account', accountId: 'u5678efgh' }, { tab: { id: 2 } });
        await settle();
        check('background: an empty iCloud leaves the set as it was', store.settingsByAccount.u5678efgh.labelColours === false);
        check('background: and joins without uploading',
            store.joinedAccounts.includes('u5678efgh') && bg.native.every(one => one.action === 'get'));
    }
    {
        const store = { settings: { labelColours: false } };
        const bg = loadBackground(store);
        bg.tabs.set(3, { id: 3, url: INBOX });
        bg.setReply(() => ({ ok: true, available: false, settings: {} }));
        bg.fire('message', { kind: 'account', accountId: 'u1234abcd' }, { tab: { id: 3 } });
        await settle();
        check('background: without iCloud nothing is joined', !(store.joinedAccounts || []).length);
        bg.setReply(() => { throw new Error('no native part'); });
        bg.fire('activated', { tabId: 3 });
        await settle();
        check('background: an unreachable native part changes nothing',
            !(store.joinedAccounts || []).length && store.settingsByAccount.u1234abcd.labelColours === false);
    }
    {
        const store = {
            settings: {},
            settingsByAccount: { u1: { a: '1' }, u2: { a: '2' } },
            tabAccounts: { 4: 'u1', 5: 'u2' },
            lastAccountId: 'u2',
            joinedAccounts: ['u1', 'u2']
        };
        const bg = loadBackground(store);
        bg.tabs.set(4, { id: 4, url: INBOX });
        bg.tabs.set(5, { id: 5, url: INBOX });
        await settle();
        await bg.browser.storage.local.set({ settingsByAccount: { u1: { a: 'x' }, u2: { a: '2' } } });
        await settle();
        check('background: a changed set reaches only its own account\'s tabs',
            bg.executed.length === 1 && bg.executed[0].tabId === 4 && bg.executed[0].args[0].a === 'x');
    }
    {
        const store = { settings: { labelColours: true } };
        const early = loadEarly(store);
        early.post({ source: 'custom-mode', kind: 'setting', key: 'snoozeKey', value: 'q' });
        await settle();
        check('early: before any account a write goes to the plain set', store.settings.snoozeKey === 'q' && !store.settingsByAccount);
        check('early: and nothing is sent for iCloud', early.fake.sent.length === 0);

        early.post({ source: 'custom-mode', kind: 'account', accountId: 'u1234abcd' });
        early.post({ source: 'custom-mode', kind: 'account', accountId: 'bad.id' });
        early.post({ source: 'custom-mode', kind: 'sync', enabled: false });
        early.post({ source: 'custom-mode', kind: 'sync', enabled: 'no' });
        early.post({ source: 'custom-mode', kind: 'setting', key: 'triageLabel', value: 'Todo' });
        await settle();
        const own = store.settingsByAccount && store.settingsByAccount.u1234abcd;
        check('early: a write is saved under the page\'s account, starting from the plain set',
            own && own.triageLabel === 'Todo' && own.labelColours === true && own.snoozeKey === 'q');
        check('early: the account, the switch and the change reach the background script in order',
            JSON.stringify(early.fake.sent) === JSON.stringify([
                { kind: 'account', accountId: 'u1234abcd' },
                { kind: 'sync', enabled: false },
                { kind: 'setting', accountId: 'u1234abcd', key: 'triageLabel', value: 'Todo' }
            ]));

        early.post({ source: 'custom-mode', kind: 'setting', key: 'bad.key', value: 'x' });
        early.post({ source: 'custom-mode', kind: 'setting', key: 'labelColours', value: 1 });
        early.post({ source: 'elsewhere', kind: 'account', accountId: 'u9999zzzz' });
        await settle();
        check('early: badly formed and foreign messages are dropped', early.fake.sent.length === 3);
    }
    const failed = Object.keys(results).filter(name => !results[name]);
    console.log(JSON.stringify({ pass: failed.length === 0, failed, count: Object.keys(results).length }, null, 1));
    process.exit(failed.length === 0 ? 0 : 1);
})().catch((error) => {
    console.log(JSON.stringify({ pass: false, threw: String(error && error.stack || error) }, null, 1));
    process.exit(1);
});
```

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
node "$SCRATCH/check-safari-scripts.js"; echo "exit $?"
```
Expected: `"pass": false`, with most `background:` and `early:` checks in `"failed"`, and `exit 1`.

- [ ] **Step 4: Save page writes under the page's account, and pass the rest on**

In `SafariExtension/early.js`, replace:

```js
shaped like ours; nothing stronger is claimed.
*/
window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;

    const message = event.data;
    if (!message || message.source !== 'custom-mode' || message.kind !== 'setting') return;
    if (typeof message.key !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(message.key)) return;
    if (typeof message.value !== 'boolean' && typeof message.value !== 'string') return;

    // Chain this write onto the pending promise to serialize all writes.
    pendingWrite = pendingWrite.then(() => {
        return api.storage.local.get('settings').then((stored) => {
            const settings = Object.assign({}, stored.settings || {});
            settings[message.key] = message.value;
            return api.storage.local.set({ settings });
        });
    }).catch((error) => {
        console.error('Custom mode: could not save a setting', error);
    });
});
```

with:

```js
shaped like ours; nothing stronger is claimed.

Three kinds arrive. A setting is saved here, under the Fastmail account the
page said it is, and the background script is told, so that it can send the
setting to iCloud. The account itself, and the page's "Sync settings with
iCloud" switch, go to the background script, which keeps them.
*/

// Must match background.js and SettingsSyncRules.swift; SettingsParityTests
// reads this line.
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// The account this page said it is; nothing until it has said
let pageAccountId = null;

// A background script that is asleep is woken by the message. One that cannot
// be reached costs the sync and never the setting, which is saved first.
const tellBackground = (message) => {
    try {
        const sent = api.runtime.sendMessage(message);
        if (sent && typeof sent.catch === 'function') sent.catch(() => {});
    } catch (error) {
        // The extension was reloaded under this page; the next load syncs
    }
};

const saveSetting = (key, value) => api.storage.local
    .get(['settings', 'settingsByAccount', 'lastAccountId'])
    .then((stored) => {
        // A write before the page has said its account goes to the last
        // account any page said, or to the plain set when there is none
        const remembered = typeof stored.lastAccountId === 'string' &&
            ACCOUNT_ID_PATTERN.test(stored.lastAccountId) ? stored.lastAccountId : null;
        const accountId = pageAccountId || remembered;

        if (!accountId) {
            const settings = Object.assign({}, stored.settings || {});
            settings[key] = value;
            return api.storage.local.set({ settings });
        }

        // An account's first write starts from the plain set, as the
        // background script starts an account it sees for the first time
        const byAccount = Object.assign({}, stored.settingsByAccount || {});
        const own = Object.assign({}, byAccount[accountId] || stored.settings || {});
        own[key] = value;
        byAccount[accountId] = own;
        return api.storage.local.set({ settingsByAccount: byAccount })
            .then(() => tellBackground({ kind: 'setting', accountId, key, value }));
    });

window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;

    const message = event.data;
    if (!message || message.source !== 'custom-mode') return;

    if (message.kind === 'account') {
        if (typeof message.accountId !== 'string' || !ACCOUNT_ID_PATTERN.test(message.accountId)) return;
        pageAccountId = message.accountId;
        tellBackground({ kind: 'account', accountId: message.accountId });
        return;
    }

    if (message.kind === 'sync') {
        if (typeof message.enabled !== 'boolean') return;
        tellBackground({ kind: 'sync', enabled: message.enabled });
        return;
    }

    if (message.kind !== 'setting') return;
    if (typeof message.key !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(message.key)) return;
    if (typeof message.value !== 'boolean' && typeof message.value !== 'string') return;

    // Chain this write onto the pending promise to serialize all writes.
    pendingWrite = pendingWrite.then(() => saveSetting(message.key, message.value)).catch((error) => {
        console.error('Custom mode: could not save a setting', error);
    });
});
```

- [ ] **Step 5: Keep a set per account and sync it**

Replace the whole of `SafariExtension/background.js` with:

```js
/*
Fastmail Custom Mode injector

Fastmail serves `script-src 'self' …` with no 'unsafe-inline'. A userscript
manager runs page-world code by adding an inline <script> to the page, which
that policy refuses; so Custom mode never starts.

scripting.executeScript() does not go through the DOM, so it is not the page's
script to refuse. Injecting with world "MAIN" therefore lands in the same
context the userscript wanted, with the page's CSP left exactly as it is.

This has to live in an extension: userscripts have no access to
browser.scripting. See https://github.com/quoid/userscripts/issues/954

Settings live in extension storage, which the page world cannot read, so they
are written onto the page immediately before the payload is injected. Changing
one pushes it straight to any open Fastmail tab rather than waiting for a
reload.

The settings are edited in the page, by the payload's own panel, which reaches
this storage through early.js. Nothing here knows what the settings are.

Settings sync. Each Fastmail account keeps a set of its own, and the set
follows the account to the Personal and Work apps on other devices through
iCloud. The page reports its account through early.js. The extension's native
part reads and writes iCloud's key-value store, but it cannot hear iCloud's
change notices, so this script asks it: when a tab reports its account, when a
Fastmail tab comes to the front, and every five minutes.

Storage:
- settings: the set a tab gets before its account is known, and the starting
  set for an account seen for the first time
- settingsByAccount: {<account id>: {...}}, written by early.js for the page's
  own changes, and here for iCloud's
- lastAccountId: the account a new tab is most likely on
- tabAccounts: {<tab id>: <account id>}
- joinedAccounts: the accounts that have had their first sync in Safari
- syncEnabled: the page's "Sync settings with iCloud" switch; absent means on
*/

const api = globalThis.browser || globalThis.chrome;

// The beta site is the same app on its own origin, so it gets the same
// treatment.
const TARGETS = ['https://app.fastmail.com/*', 'https://app.beta.fastmail.com/*'];
const TARGET_PATTERN = /^https:\/\/app\.(beta\.)?fastmail\.com\//;
const PAYLOAD = 'fastmail-custom-mode.js';

// Both must match SettingsSyncRules.swift, which the native part compiles and
// which composes the store keys; SettingsParityTests reads these two lines.
const LOCAL_ONLY_KEYS = ['bottomBarItems', 'topBarItems'];
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// Safari hands every native message to this extension's own native part,
// whatever application is named.
const NATIVE_APPLICATION = 'com.mdbraber.fastmail-custom.safari';
const SYNC_ALARM = 'custom-mode-settings-sync';
const SYNC_MINUTES = 5;

const STORED_KEYS = ['settings', 'settingsByAccount', 'lastAccountId', 'tabAccounts', 'joinedAccounts', 'syncEnabled'];

const readStored = () => api.storage.local.get(STORED_KEYS);

const isSyncOn = (stored) => stored.syncEnabled !== false;

const isAccountId = (value) => typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value);

// The account a tab said it is, or the last one any tab said
const accountOfTab = (stored, tabId) =>
    (stored.tabAccounts || {})[String(tabId)] || stored.lastAccountId || null;

// Whatever is stored, as it is. The page carries the catalogue and every
// default, so there is nothing to merge here: an account's own set, or the
// plain set until the account has one.
const settingsFor = (stored, accountId) => {
    const byAccount = stored.settingsByAccount || {};
    return (accountId && byAccount[accountId]) || stored.settings || {};
};

const sameSet = (one, other) => {
    const a = one || {};
    const b = other || {};
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
        keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
};

// The writes made here go one at a time, each reading what the last one left
let storageWork = Promise.resolve();
const updateStored = (change) => {
    storageWork = storageWork
        .then(async () => {
            const update = change(await readStored());
            if (update) await api.storage.local.set(update);
        })
        .catch((error) => {
            console.error('Custom mode: could not save the sync state', error);
        });
    return storageWork;
};

const inject = async (tabId) => {
    const stored = await readStored();

    // The page has not said which account it is yet; the last account any
    // page reported is the best guess, and the page's own report corrects it
    await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (value, sync) => {
            window.__customModeSettings = value;
            window.__customModeSync = sync;
        },
        args: [settingsFor(stored, stored.lastAccountId), { enabled: isSyncOn(stored) }]
    });

    await api.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        files: [PAYLOAD]
    });
};

// Settings, and the switch's state, into a page that is already running
const applyToTab = (tabId, stored) => api.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (value, sync) => {
        window.__customModeSettings = value;
        window.__customModeSync = sync;
        if (window.customMode) window.customMode.applySettings(value);
    },
    args: [settingsFor(stored, accountOfTab(stored, tabId)), { enabled: isSyncOn(stored) }]
}).catch(() => { /* tab may not have the payload yet */ });

const fastmailTabs = () => api.tabs.query({ url: TARGETS });

// A reply the native part refused, or no reply at all, throws
const askNative = async (message) => {
    const reply = await api.runtime.sendNativeMessage(NATIVE_APPLICATION, message);
    if (!reply || reply.ok !== true) throw new Error((reply && reply.error) || 'no answer');
    return reply;
};

const syncedOnly = (settings) => {
    const clean = {};
    Object.keys(settings || {}).forEach((key) => {
        const value = settings[key];
        if (LOCAL_ONLY_KEYS.includes(key)) return;
        if (typeof value === 'boolean' || typeof value === 'string') clean[key] = value;
    });
    return clean;
};

/*
iCloud's settings for one account.

The first time, iCloud wins when it holds any: its values replace the synced
ones here, and a synced setting it lacks is removed, so the page shows the
default; the bar lengths stay. When it holds none, this set stays as it is,
and the account is joined without uploading anything, so a Mac that has not
received iCloud's settings yet cannot overwrite them. After that each answer
overwrites the settings iCloud holds.
*/
const pullAccount = async (accountId) => {
    if (!isAccountId(accountId) || !isSyncOn(await readStored())) return;

    let reply;
    try {
        reply = await askNative({ action: 'get', accountId });
    } catch (error) {
        console.warn('Custom mode: iCloud could not be asked; keeping the settings on this Mac', error);
        return;
    }
    if (!reply.available) {
        console.warn('Custom mode: iCloud is not available; keeping the settings on this Mac');
        return;
    }

    const incoming = syncedOnly(reply.settings);
    await updateStored((stored) => {
        // Switched off while the answer was on its way
        if (!isSyncOn(stored)) return null;

        const joined = stored.joinedAccounts || [];
        const isJoined = joined.includes(accountId);
        const current = settingsFor(stored, accountId);
        let next;
        if (isJoined || !Object.keys(incoming).length) {
            next = Object.assign({}, current, incoming);
        } else {
            next = {};
            LOCAL_ONLY_KEYS.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key];
            });
            Object.assign(next, incoming);
        }

        const update = {};
        const byAccount = stored.settingsByAccount || {};
        if (!sameSet(next, byAccount[accountId])) {
            update.settingsByAccount = Object.assign({}, byAccount, { [accountId]: next });
        }
        if (!isJoined) update.joinedAccounts = joined.concat([accountId]);
        return Object.keys(update).length ? update : null;
    });
};

const pullOpenTabs = async () => {
    const stored = await readStored();
    if (!isSyncOn(stored)) return;
    const tabs = await fastmailTabs();
    const accounts = new Set(tabs.map(tab => (stored.tabAccounts || {})[String(tab.id)]).filter(isAccountId));
    for (const accountId of accounts) {
        await pullAccount(accountId);
    }
};

// One setting the page changed, which early.js has already saved. Only an
// account that has had its first sync sends anything.
const sendSetting = async (accountId, key, value) => {
    if (!isAccountId(accountId) || LOCAL_ONLY_KEYS.includes(key)) return;
    const stored = await readStored();
    if (!isSyncOn(stored) || !(stored.joinedAccounts || []).includes(accountId)) return;
    try {
        await askNative({ action: 'set', accountId, key, value });
    } catch (error) {
        console.warn('Custom mode: a setting could not be sent to iCloud; it is kept on this Mac', error);
    }
};

const accountReported = async (tabId, accountId) => {
    let injectedAnother = false;
    let hadOwnSet = false;
    await updateStored((stored) => {
        const byAccount = stored.settingsByAccount || {};
        injectedAnother = stored.lastAccountId !== accountId;
        hadOwnSet = !!byAccount[accountId];
        const update = {
            lastAccountId: accountId,
            tabAccounts: Object.assign({}, stored.tabAccounts || {}, { [String(tabId)]: accountId })
        };
        // An account seen for the first time starts from the plain set
        if (!hadOwnSet) {
            update.settingsByAccount = Object.assign({}, byAccount, {
                [accountId]: Object.assign({}, stored.settings || {})
            });
        }
        return update;
    });
    // The tab was given the last account's set when it loaded. A new
    // account's set reaches it through the storage listener; an existing
    // one that is not what it was given goes to it now.
    if (injectedAnother && hadOwnSet) applyToTab(tabId, await readStored());
    await pullAccount(accountId);
};

const syncSwitched = async (enabled) => {
    // Off forgets every first sync, so turning it on takes iCloud's
    // settings again
    await updateStored(() => (enabled ? { syncEnabled: true } : { syncEnabled: false, joinedAccounts: [] }));
    if (enabled) await pullOpenTabs();
};

// The payload guards against running twice, so a duplicate injection is safe
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab || !tab.url || !TARGET_PATTERN.test(tab.url)) return;

    inject(tabId).catch((error) => {
        console.error('Custom mode: injection failed', error);
    });
});

// A tab coming to the front may be showing settings changed elsewhere
api.tabs.onActivated.addListener(({ tabId }) => {
    (async () => {
        const tab = await api.tabs.get(tabId);
        if (!tab || !tab.url || !TARGET_PATTERN.test(tab.url)) return;
        const stored = await readStored();
        await pullAccount((stored.tabAccounts || {})[String(tabId)]);
    })().catch((error) => {
        console.warn('Custom mode: could not check iCloud for this tab', error);
    });
});

api.tabs.onRemoved.addListener((tabId) => {
    updateStored((stored) => {
        const tabAccounts = Object.assign({}, stored.tabAccounts || {});
        if (!Object.prototype.hasOwnProperty.call(tabAccounts, String(tabId))) return null;
        delete tabAccounts[String(tabId)];
        return { tabAccounts };
    });
});

// What early.js carries across from the page
api.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!message || typeof tabId !== 'number') return;

    let work = null;
    if (message.kind === 'account' && isAccountId(message.accountId)) {
        work = accountReported(tabId, message.accountId);
    } else if (message.kind === 'sync' && typeof message.enabled === 'boolean') {
        work = syncSwitched(message.enabled);
    } else if (message.kind === 'setting' && typeof message.key === 'string' &&
        (typeof message.value === 'boolean' || typeof message.value === 'string')) {
        work = sendSetting(message.accountId, message.key, message.value);
    }
    if (work) {
        work.catch((error) => {
            console.error('Custom mode: settings sync failed', error);
        });
    }
});

// Made once: creating it again each time this script wakes would restart its
// five minutes every time
api.alarms.get(SYNC_ALARM).then((existing) => {
    if (!existing) api.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
});

api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SYNC_ALARM) return;
    pullOpenTabs().catch((error) => {
        console.warn('Custom mode: could not check iCloud', error);
    });
});

// Push a changed set to the tabs it belongs to: every tab when the plain set
// or the switch changed, and otherwise the tabs of the accounts whose sets did
api.storage.onChanged.addListener(async (changes, area) => {
    if (area && area !== 'local') return;
    const everyTab = 'settings' in changes || 'syncEnabled' in changes;
    if (!everyTab && !('settingsByAccount' in changes)) return;

    const before = everyTab ? {} : (changes.settingsByAccount.oldValue || {});
    const after = everyTab ? {} : (changes.settingsByAccount.newValue || {});
    const stored = await readStored();
    const tabs = await fastmailTabs();

    tabs.forEach((tab) => {
        const accountId = accountOfTab(stored, tab.id);
        if (everyTab || !sameSet(before[accountId], after[accountId])) applyToTab(tab.id, stored);
    });
});
```

- [ ] **Step 6: Describe the sync in the README**

In `SafariExtension/README.md`, replace:

```markdown
| `background.js` | Injects the payload with `world: "MAIN"` on page load |
| `early.js` | Content script at `document_start`, replaying last load's styles; stamps the host marker (`data-custom-mode-host`) and relays the page's setting writes into extension storage |
```

with:

```markdown
| `background.js` | Injects the payload with `world: "MAIN"` on page load; keeps each Fastmail account's settings and syncs them with iCloud through the native part |
| `early.js` | Content script at `document_start`, replaying last load's styles; stamps the host marker (`data-custom-mode-host`), saves the page's setting writes under its account, and passes the account and the sync switch to the background script |
| `App/Fastmail Custom Mode/Fastmail Custom Mode Extension/SafariWebExtensionHandler.swift` | The native part: reads and writes iCloud key-value storage for the background script, through `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift`, which the extension compiles by reference |
```

Replace:

```markdown
The payload guards against running twice, so a duplicate injection is harmless.
```

with:

```markdown
The payload guards against running twice, so a duplicate injection is harmless.

## Settings sync

Custom mode's settings follow each Fastmail account between Safari on this Mac
and the Personal and Work apps on the Mac, iPhone and iPad, through iCloud
key-value storage. The extension target declares the store the apps share;
the host app does not.

- The page reports its account. Each account keeps its own set in
  `settingsByAccount`, and `settings` is the starting set for an account seen
  for the first time.
- The native part cannot hear iCloud's change notices, so the background
  script asks it when a tab reports its account, when a Fastmail tab comes to
  the front, and every five minutes.
- The first time an account syncs here, iCloud's settings win when it holds
  any. Otherwise the set here stays, and only later changes are sent, one at
  a time.
- `bottomBarItems` and `topBarItems` stay on this Mac.
- The "Sync settings with iCloud" switch on Custom mode's settings page is
  kept as `syncEnabled`, for Safari on this Mac only. Turning it off keeps
  every setting and forgets every first sync; turning it on takes iCloud's
  settings again.
```

- [ ] **Step 7: Run the checks to see them pass**

Run:
```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
cd /Users/mdbraber/src/fastmail-custom
node --check SafariExtension/background.js && node --check SafariExtension/early.js && echo "syntax ok"
node "$SCRATCH/check-safari-scripts.js"; echo "exit $?"
cd Packages/FastmailShellKit && swift test --filter 'theSafariExtensions' 2>&1 | tail -3
```
Expected:
- `syntax ok`
- `"pass": true`, `"failed": []`, `"count": 27`, and `exit 0`
- both Safari parity tests pass

- [ ] **Step 8: Build the extension**

Run: `cd /Users/mdbraber/src/fastmail-custom && make build-extension 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"`
Expected: `** BUILD SUCCEEDED **`. This builds only; it installs nothing.

- [ ] **Step 9: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test 2>&1 | tail -15`
Expected: it exits 0.

- [ ] **Step 10: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add SafariExtension/background.js SafariExtension/early.js SafariExtension/README.md \
  Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsParityTests.swift
```

```bash
cd /Users/mdbraber/src/fastmail-custom
git commit -F - <<'EOF'
feat: Safari keeps Custom mode settings per Fastmail account and syncs them with iCloud

early.js saves the page's writes under its account and passes on the account
and the sync switch. The background script injects and pushes each tab its own
account's set, asks the native part on report, tab focus and every five
minutes, and sends each change once the account has had its first sync.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 9: On the user's devices

**Files:** none. This task changes nothing; it confirms Tasks 1-8 on the devices.

**Interfaces:**
- Consumes: everything above.
- Produces: a recorded pass per check, or a list of defects to fix before the work is called done.

- [ ] **Step 1: Ask which device's settings should seed iCloud**

The first app to join an account with an empty store sends its settings. Every device that joins later takes them, and loses its own. Ask the user which device and app hold the settings they want to keep, per account (Personal, and Work separately). That app is installed and opened first, in Step 2.

- [ ] **Step 2: Ask before installing**

Ask the user for a go-ahead, stating what each command does, and stop until it is given:
- **Mac apps:** `make install-macos` builds Personal and Work in Release and replaces `/Applications/mdbraber.com.app` and `/Applications/nexthealth.nl.app`. The running apps are replaced under them: quit both first, and open them again afterwards.
- **iPhone:** `make install-ios DEVICE=<iPhone identifier>` installs Personal, Work and Mailto. On 2026-09-13 the iPhone was `68584880-5010-5FD9-B899-FBCB5273FA46`; confirm with `xcrun devicectl list devices`. A bare `make install-ios` lands on whichever device is awake first. The phone must be unlocked.
- **Safari extension:** `make install-extension` replaces `/Applications/Fastmail Custom Mode.app`. Quit that app first (`osascript -e 'tell application "Fastmail Custom Mode" to quit'`). Afterwards, check it is enabled in Safari → Settings → Extensions.

Install in the order Step 1 chose. After the first app opens on an account, wait until it has joined before opening another device, which takes at most 30 seconds. On the Mac, the join shows in the log:

```bash
log show --last 5m --style compact --predicate 'subsystem == "com.mdbraber.fastmail-custom" AND category == "settings-sync"'
```

Expected: `Sent this device's Custom mode settings to iCloud` for the first app, and `Took this account's Custom mode settings from iCloud` for each one after.

If an install is refused, record its checks as outstanding, not as passed.

- [ ] **Step 3: The spec's checks**

Give the user this list and record each answer, naming the device and app:
1. A setting changed in the Personal app on the Mac arrives in the Personal app on the iPhone without a reload, and the reverse.
2. The Work app's settings stay separate.
3. A setting changed in Safari arrives on the iPhone, and one changed on the iPhone arrives in Safari: on tab focus, or within 5 minutes.
4. The bar lengths stay different per device.
5. With syncing turned off on the iPhone, a change there stays on the iPhone. Turning it back on brings back iCloud's settings.
6. The switch does not appear in a plain browser tab.

For check 6, use a browser tab where the Safari extension is not running, for example with the extension turned off, or another browser.

- [ ] **Step 4: The switch itself**

1. Custom mode's settings page opens its General section with "Sync settings with iCloud", on, with the hint as in Global Constraints, in the Personal app on the Mac and on the iPhone, and in Safari.
2. In the Mac app with two windows open on Custom mode's settings page, flipping the switch in one flips it in the other within a second.

- [ ] **Step 5: Record the result**

Write what passed and what did not into the ledger, naming the device and app for each. Any defect is fixed, and its task's checks are re-run.

---

## Self-review

**Spec coverage (Parts 1-4, Testing and Risks).**

| Spec requirement | Where |
|---|---|
| **Part 1** | |
| One store, `$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.personal`, declared by Personal and Work (iOS and macOS) and the extension target, not the host app | Task 5 Step 7, Task 7 Step 3; checked signed in Task 5 Step 9 and Task 7 Step 9 |
| Keys `<account id>.<setting>`; setting part passes `isWritableSettingKey`; account id ≤ 32 of letters, digits, `-`, `_`; within 64 bytes | Task 2 (`storeKey`, `parse`, `isValidAccountId`, `isSettingKey` and its parity test, `maxStoreKeyBytes`) |
| Values are booleans and strings | Task 2 (`isSyncableValue`), Task 3, Task 7 (`extensionAnswer`), Task 8 (`syncedOnly`) |
| `bottomBarItems` and `topBarItems` never read from or written to the store | Task 2 (`localOnlyKeys`), Task 3 tests, Task 7, Task 8 (`LOCAL_ONLY_KEYS`, stand-in checks) |
| Each page load reports its account; the host remembers the last id | Task 6 (`reportAccountWhenKnown`), Task 3 (`settingsSync.accountId`), Task 8 (`lastAccountId`) |
| First sync: adopt when the store holds the account (removing synced local settings it lacks); else an app uploads, Safari never uploads a whole set; then joined | Task 2 (`joinDecision`, `adoption`, `storeEntries`), Task 3, Task 8 (`pullAccount`) |
| After joining: local change saved and written; another device's change replaces the local value and the page updates through the push path; last write wins; nothing received is written back | Task 3 (`localChanged`, `take`), Task 4 (pusher), Task 5 (`onSetting`), Task 8; last write wins is the store's own behaviour |
| Without iCloud every setting works locally, the reason is logged, syncing resumes | Task 3 (`wait`, logs, account-change rejoin), Task 8 (console warnings, nothing joined) |
| **Part 2** | |
| `CustomModeSettingsSync` on the main actor with a `KeyValueStore` protocol; `NSUbiquitousKeyValueStore.default` in production, a fake in tests | Task 3, Task 5 Step 3 |
| Bridge action `account {accountId}`, validated as in Part 1; `window.native.account(id)`; userscript reports via `FastMail.auth.get('primaryAccounts')['urn:ietf:params:jmap:mail']`, choosing the host as `writeSetting` does | Task 4 (bridge, harness), Task 6 (`reportAccount`, which uses `primaryMailAccountId`) |
| Saved as `settingsSync.accountId`, outside `customMode.`; a different id switches keys and joins | Task 3 (`accountReported`, test `aPageOnAnotherAccountSwitchesToItsKeysAndJoinsIt`) |
| Joined state `settingsSync.joined.<account id>` | Task 3 |
| Local changes skip local-only keys, unjoined accounts and a missing account | Task 3 (`localChanged` and its tests), Task 5 (`onSetting`) |
| External-change reasons: server change or initial sync take this account's keys; initial sync also joins; account change clears joined flags and joins again; quota violation is logged | Task 3 (`externalChange`) |
| When to join: at launch with a known account, on a page report; `synchronize()`; adopt; upload only after the initial-sync notice or 30 s after a successful `synchronize()` with an identity; one re-check at the 30-second mark; no identity stays unjoined | Task 2 (`joinDecision`), Task 3 (`start`, `joinIfNeeded`, `recheckPending`), Task 5 (`install()` calls `start()`) |
| Four app entitlements files gain the store; automatic signing adds iCloud to both app ids | Task 5 Steps 7 and 9, Task 9 Step 2 |
| **Part 3** | |
| Extension entitlements file beside its sandbox; `nativeMessaging` and `alarms`; `get` → `{available, settings}`, `set` → `{ok}` refusing local-only keys and bad ids, keys or values | Task 7 |
| Page posts `kind: 'account'`; `early.js` checks and forwards it; background keeps each tab's account and `lastAccountId` in `storage.local` | Task 6, Task 8 (`tabAccounts`, `lastAccountId`) |
| `settingsByAccount`, `joinedAccounts`; `settings` stays as the starting set for a new account | Task 8 (`accountReported`, `saveSetting`) |
| At tab load inject `settingsByAccount[lastAccountId]` or `settings`; a different reported account's set is applied live | Task 8 (`inject`, `accountReported`) |
| Changes in Safari: `early.js` saves under the tab's account; background sends `set`; local-only keys stay local; the push becomes per tab | Task 8 (`saveSetting`, `sendSetting`, the `storage.onChanged` listener) |
| Other devices' changes: `get` when a tab loads or reports, when a Fastmail tab becomes active, every 5 minutes | Task 8 (`accountReported`, `tabs.onActivated`, the alarm); a load is covered by the report every load sends, see note 7 |
| First sync in Safari: adopt when `get` returns keys; otherwise keep the set, join, and send later changes one by one | Task 8 (`pullAccount`, stand-in checks) |
| After joining, each `get` overwrites the keys iCloud holds | Task 8 (`pullAccount`) |
| Native part unreachable or iCloud unavailable: keep local sets, log to the console | Task 8 (`pullAccount`, `sendSetting`, stand-in checks) |
| Parity: a package test reads the extension's two files and fails when they disagree with Swift | Task 7 (handler and project), Task 8 (`background.js` and `early.js`), see note 5 |
| **Part 4** | |
| The switch at the top of the general section, with the spec's title and hint | Task 6 (`syncRow`, `syncRows`; the probe compares the copy) |
| One per host, never synced, on by default; `settingsSync.enabled` in the apps, `syncEnabled` in Safari | Task 3 (`isEnabled`, `theSyncStateIsNeverASetting`), Task 8 (`isSyncOn`) |
| `window.__customModeSync = {enabled}` injected where a host can sync (apps at document start, Safari at tab load), set again with each push; shown only when the object exists | Task 4 (`syncLine`), Task 5 (bootstrap, pusher), Task 6 (`syncState`, `refreshSyncRow`), Task 8 (`inject`, `applyToTab`) |
| Apps: `window.native.setSettingsSync(enabled)` → `settingsSync`, a real boolean only; Safari: `kind: 'sync'` through `early.js` | Task 4, Task 6 (`writeSyncEnabled`), Task 8 |
| Off: no store reads or writes, values kept, joined flags cleared | Task 3 (`setEnabled(false)` and its test), Task 8 (`syncSwitched`, stand-in checks) |
| On: join again, iCloud wins when it holds settings; otherwise an app uploads and Safari keeps its set | Task 3 (`turningSyncOnJoinsAgainAndICloudWins`), Task 8 (`syncSwitched` → `pullOpenTabs`) |
| **Testing** | |
| Package tests: joining, local changes, external changes, account changes, the bridge, parity, the switch | Tasks 2, 3, 4, 7, 8 |
| Integration test: `window.native.account` reaches the bridge | Task 4 (`testAccountReachesTheBridge`, plus `testSetSettingsSyncCrossesAsARealBooleanOnly`) |
| iOS build check | Task 5 Step 8 |
| Checks on the user's devices | Task 9 Step 3, the spec's list word for word |
| **Risks** | |
| Non-sandboxed Mac apps: confirm before building on it | Task 1 (the spike, not the Personal app, see note 13), Task 5 Step 9 (a signed Work build carries the store) |
| First download not finished | Task 2 and Task 3 (initial-sync notice, 30-second rule), Task 8 (Safari never uploads), Task 9 Step 1 |

**Placeholder scan.** No "TBD", "TODO", "implement later" or "similar to Task N". Every code step carries its code, and every command gives its expected output. The only values left to a person are:
- the iPhone's device identifier, confirmed with `xcrun devicectl list devices`;
- the team id, read by command from the git-ignored `Config/Local.xcconfig` and reported as `<team>`.

**Type consistency.** These names are spelled the same in every task:
- Swift:
  - `SettingsSyncRules`:
    - keys and values: `keySeparator`, `localOnlyKeys`, `maxAccountIdLength`, `maxStoreKeyBytes`, `uploadGrace`, `isValidAccountId`, `isSettingKey`, `isSyncedKey`, `storeKey(accountId:key:)`, `parse(storeKey:)`, `isSyncableValue`, `sameValue`
    - settings and joining: `settings(for:in:)`, `storeEntries(accountId:local:)`, `JoinDecision` (`adopt`, `upload`, `wait(recheckIn:)`), `joinDecision(storeHasAccountKeys:initialSyncArrived:secondsSinceSuccessfulSync:hasICloudIdentity:)`, `Adoption`, `adoption(local:inStore:)`
    - the extension: `ExtensionAnswer` (`reply`, `write`), `extensionAnswer(to:hasICloudIdentity:storeContents:)`
  - `KeyValueStore`
  - `CustomModeSettingsSync`:
    - state: `accountIdKey`, `enabledKey`, `joinedKeyPrefix`, `ChangeReason`, `Schedule`, `isEnabled(in:)`, `isEnabled`, `accountId`, `isJoined(_:)`
    - actions: `start()`, `accountReported(_:)`, `localChanged(key:value:)`, `setEnabled(_:)`, `externalChange(reason:keys:)`, `joinIfNeeded()`
    - installation: `current`, `install()`
  - `NativeBridge` (`onAccount`, `onSettingsSync`)
  - `CustomModeSettings` (`syncLine`, `bootstrapScript(from:syncEnabled:)`, `applyScriptSource(from:syncEnabled:)`)
  - `CustomModeSettingsPusher.init(webView:syncEnabled:)`
- Bridge actions `account` and `settingsSync`; harness `window.native.account` and `window.native.setSettingsSync`.
- JavaScript in the userscript: `SYNC_TITLE`, `SYNC_HINT`, `syncState`, `writeSyncEnabled`, `reportAccount`, `reportAccountWhenKnown`, `syncRow`, `syncRows`, `refreshSyncRow`, `window.__customModeSync`.
- JavaScript in the extension:
  - `early.js`: `ACCOUNT_ID_PATTERN`, `pageAccountId`, `tellBackground`, `saveSetting`
  - `background.js`:
    - constants: `LOCAL_ONLY_KEYS`, `ACCOUNT_ID_PATTERN`, `NATIVE_APPLICATION`, `SYNC_ALARM`, `SYNC_MINUTES`
    - storage helpers: `readStored`, `isSyncOn`, `settingsFor`, `updateStored`
    - actions: `inject`, `applyToTab`, `askNative`, `pullAccount`, `pullOpenTabs`, `sendSetting`, `accountReported`, `syncSwitched`
- Storage keys: `settings`, `settingsByAccount`, `lastAccountId`, `tabAccounts`, `joinedAccounts`, `syncEnabled`. Page messages have `kind` of `account`, `sync` or `setting`; native messages have `action` of `get` or `set`.

**Checked while drafting (in the scratchpad, never in the repository).** A copy of the package, the userscript, the Safari extension's scripts, handler and project, the integration tests, the app entry points and the Makefile was made at the repository's relative paths. Every replace block above was applied to it by scripts that require each anchor exactly once.
- `swift test` ran 404 tests, including every new Swift test in Tasks 2-5, 7 and 8. The only failure was the existing `everyShortcutIconIsOneThatWillDraw`, which reads `Apps/Shared/Glyphs.xcassets` and that folder was not copied.
- `swiftc -typecheck -swift-version 5 -target x86_64-apple-macos10.14` passed for `SettingsSyncRules.swift` with the new handler.
- `node --check` passed for the edited userscript, harness, `early.js` and `background.js`.
- `check-safari-scripts.js` passed all 27 checks against the edited scripts.
- `gen-sync-probe.py` failed on the unedited userscript with `start marker missing`. On the edited copy it generated a probe that passed all 23 stand-in facts under node; the four `Fastmail:` facts need the app.
- `plutil -lint` passed for the edited project and all five entitlements files, and `manifest.json` parsed.

Not run while drafting: the IntegrationTests scheme, the iOS build, `make build-extension`, both signed builds, Task 1, and the live probes. Nothing was installed and no probe touched the apps.

## Notes for the controller

1. **How the pusher learns the switch's state.** The switch is a `UserDefaults` value (`settingsSync.enabled`), so a flip already posts the notification the pusher observes. The pusher is given `syncEnabled: { CustomModeSettingsSync.current?.isEnabled }`, asks it for every push, and compares the whole apply script (settings plus the `__customModeSync` line) instead of the settings JSON. Cost if wrong: a flip in one window would reach the app's other windows only with the next settings change or return to the foreground; the page that flipped it is right either way.
2. **Where the per-app component lives.** `PersonalApp.init()` and `WorkApp.init()` call `CustomModeSettingsSync.install()`, which creates it on `NSUbiquitousKeyValueStore.default` and `UserDefaults.standard`, starts it, and keeps it in `CustomModeSettingsSync.current`. The bridge closures, bootstrap script and pusher reach it there. `AppShell` and `WebContainer` are per window, so neither could own it. Where nothing installs one (package tests, integration tests, Mailto), `current` is nil and pages get no switch. Cost if wrong: a later second process-level owner would need `install()` to stay idempotent, which it is.
3. **How the Safari project compiles the shared rules file.** By file reference: `sourceTree = SOURCE_ROOT`, `path = ../../../Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsSyncRules.swift`, with a build-file entry in the extension's Sources phase. The edit is made by `$SCRATCH/edit-safari-project.py`, with fresh ids and single-anchor checks. The rules file is therefore Foundation-only and was typechecked in Swift 5 for macOS 10.14. `make build-extension` gains `-allowProvisioningUpdates`, since a target with an iCloud entitlement needs a profile that automatic signing can only fetch with it. Cost if wrong: moving the package or the Safari project breaks the extension's build, not the apps'; Task 7's parity test catches a missing file.
4. **How the 30-second rule is testable.** The decision is the pure `SettingsSyncRules.joinDecision`, which returns `.wait(recheckIn: remaining)`. The component takes `now` and `schedule` closures: the apps pass `Date()` and a main-actor `Task.sleep`, and the tests pass a clock and a list they advance and run by hand. One re-check is pending at a time. Cost if wrong: none at run time; the production scheduler is four lines in `install()`.
5. **The Safari parity test checks the account id pattern instead of a key separator.** `background.js` never composes a store key; the native part does, through the shared rules file. So Task 8's test compares `LOCAL_ONLY_KEYS` and `ACCOUNT_ID_PATTERN` (in both `background.js` and `early.js`), and Task 7's test checks that the handler answers through `SettingsSyncRules` and that the project compiles that file. Cost if wrong: none known; a separator constant in `background.js` would be unused.
6. **Two small additions to the component's rules.**
   - A server-change notice also calls `joinIfNeeded()`. It is a no-op once joined, and lets a device still waiting find its account as soon as the store delivers it.
   - An iCloud account change also resets this launch's initial-sync flag and 30-second clock, since the new account's store starts its download over.

   Cost if wrong: a device waiting to join might adopt slightly earlier than the spec's wording, which is still iCloud winning.
7. **Safari pulls on the account report, not separately on tab load.** Every load injects the payload, which reports the account within a second or so, and the report triggers `get`. A pull at load would ask for `lastAccountId`, possibly the wrong account, and twice. Cost if wrong: if a page never reports (Fastmail's session never loads), that tab gets no pull until it is activated, and then only if its account is known.
8. **`early.js` and `background.js` both write `settingsByAccount`.** The spec has `early.js` save the page's writes, and the background script saves iCloud's values. Each serialises its own writes, but a write from each landing together can drop one side's change locally. It heals: a page change was also sent with `set`, so the next `get` restores it, and an iCloud value comes back on the next `get`. Cost if wrong: a setting may show its previous value for up to 5 minutes, or until the tab is focused. The alternative is to route every write through the background script, which departs from the spec's wording.
9. **Before a page reports its account, `early.js` saves a write under `lastAccountId`, or `settings` when there is none.** This matches what the tab was injected with. Cost if wrong: a write made in the first moment of a load on a different account lands in the last account's set. The settings page cannot be reached before Fastmail knows its session, so this is not expected to happen.
10. **The account report starts as soon as the settings page can start, as well as from `start()`.** It retries every 500 ms for a minute. A load straight onto Settings may never reach `start()`, which waits for a drawn mailbox list. Cost if wrong: none; the report is guarded to once per load.
11. **The extension's entitlements carry the sandbox and the store only.** The spike's extension also had `com.apple.security.network.client`. Key-value storage goes through the system's sync daemon, not the network, so it was left out, as the spec lists. Cost if wrong: Task 9's Safari checks fail with the native part reporting `available: true` but nothing arriving; then add that one entitlement.
12. **The plain fallback panel (`openFallbackSettings`) gets no switch.** The spec places the switch on Custom mode's settings page, and the panel exists only for when Fastmail's classes are missing. Cost if wrong: while that fallback is showing, syncing can only be left as it is.
13. **Task 1 uses the spike, not a signed Personal app.** The spec's Risks section asks for "a signed Mac build of the Personal app" to write and read the store. The brief's outline uses the non-sandboxed spike, which answers the sandbox question without provisioning the real app ids first. Task 5 Step 9 then confirms a signed Work build carries the store identifier, and Task 9 confirms real reads and writes. Cost if wrong: an entitlement problem specific to the real app ids would surface in Task 5 Step 9, or at worst on the devices.
14. **Signing touches the developer account before any install.** Task 1 provisions the spike again, Task 5 Step 9 adds iCloud to the Work app id, and Task 7 Step 9 adds it to the extension's app id. The spec expects automatic signing to do this; no install happens. Cost if wrong: if the user wants the capability added only at install time, skip Task 5 Step 9 and accept that `make build-extension` in Task 7 needs it anyway.
15. **The team id is already tracked.** It appears in `SafariExtension/README.md:101` and in `project.pbxproj` at lines 446, 481, 518 and 560, from the earlier signing change. This conflicts with the "nothing identifying" constraint. This plan adds no copy: the project edit anchors avoid those lines, and every command reads the value from `Config/Local.xcconfig`. Cost if wrong: none added; removing the existing copies is a separate change.
16. **The apps keep one local set per app, as the spec says.** Reporting a different account in the same app adopts that account's iCloud settings, or uploads the current set as that account's. Cost if wrong: two accounts used in one app share a local set; the spec accepts this.
17. **Other spec wording kept loosely.**
    - The native part's replies also carry `ok`, so the background script can tell a refusal from a reply.
    - A `get` for an account whose set does not change writes nothing, so tabs are not pushed needlessly.
    - The userscript's `@version` is not bumped.

    Cost if wrong: none at the page.
