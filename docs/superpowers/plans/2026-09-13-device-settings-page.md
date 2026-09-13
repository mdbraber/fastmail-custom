# Device settings page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On iPhone and iPad, the Device settings row opens a native Device settings page and its Backend page. They carry a screen lock, Remember last viewed page, the Start page, the in-app browser, the version and a remote debugging switch. The iOS Settings bundle and the old sheet go.

**Architecture:**
- **Pure rules.** Every rule the spec asks to test lives in a pure Swift type that builds and tests on macOS:
  - `DevicePreferences` (keys, defaults, the page to save, the launch address)
  - `ScreenLockState` and `ScreenLockMethod` (when to ask, when to cover)
  - `ExternalLinks` (where an external link goes)
  - `WebInspection` (whether the inspector may attach)
  - `AppVersion` (the version text)
- **iOS-only code.** UIKit, SwiftUI pages, LocalAuthentication and SafariServices code sits behind `#if canImport(UIKit)`:
  - `ScreenLock`: the controller, and a cover window above the app's own
  - `DeviceSettingsPage` and `BackendSettingsPage`
  - the in-app browser opener
- **The shell.** `AppShell` lays the page over the web view, routes outside links through the lock, and saves the page as it changes. The Mac branches keep today's behaviour.
- **Removal.** The Settings bundle, its generator, its Makefile target, its `project.yml` entry and its tests are removed last.

**Tech Stack:**
- Swift 6 (Swift Testing): SwiftUI, WebKit, LocalAuthentication, SafariServices
- The `FastmailShellKit` Swift package, built for macOS 14 and iOS 17
- xcodegen and `make test`

**Spec:** `docs/superpowers/specs/2026-09-13-device-settings-design.md`, Part 1 ("the Device settings page"), plus the Swift tests and the iPhone and iPad checks from its Testing section that belong to Part 1.

## Global Constraints

**Rules for every plan in this work (verbatim)**
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

**The cross-plan contract, as this plan produces it**
- Stored settings, in the standard `UserDefaults` of each iOS app:

  | Key | Type | Default |
  |---|---|---|
  | `device.screenLock` | Bool | false |
  | `device.rememberPage` | Bool | false |
  | `device.lastPage` | String (path + query + fragment, starts with `/`) | absent |
  | `device.inAppBrowser` | Bool | true |
  | `device.remoteDebugging` | Bool | true |

  `backend` and `startView` keep their keys and defaults.
- `public enum DevicePreferences` in `Packages/FastmailShellKit/Sources/FastmailShellKit/`:
  - Key constants: `screenLockKey`, `rememberPageKey`, `lastPageKey`, `inAppBrowserKey`, `remoteDebuggingKey`.
  - Readers: `screenLock(in:)`, `rememberPage(in:)`, `lastPage(in:)`, `inAppBrowser(in:)`, `remoteDebugging(in:)`. Each takes `UserDefaults = .standard` and applies the defaults above.
- `SettingsPresenter.shared.open()` keeps its name and now presents the Device settings page. `NativeBridge`'s `openSettings` action keeps calling it, and the harness row keeps posting `openSettings`.
- This plan removes `MobileSettingsSheet`. It does not touch `PushPreferences`, `PushConfig` or `PushRegistrar`.

**Copy, exactly as written**
- Page title "Device settings". Row titles:
  - "Remember last viewed page"
  - "Start page" (prompt `/mail/Inbox`)
  - "Use in-app browser for external links"
  - "Version"
  - "Show Advanced Settings"
- The lock switch is titled "Face ID", "Touch ID" or "Passcode" ("Optic ID" on a device that has it). Its footer is "Require authentication when opening the app".
- Start page footer: "Used when Remember last viewed page is off. Empty opens Fastmail's default view."
- Backend page:
  - section "Server backend", rows Production / `app.fastmail.com` and Beta / `app.beta.fastmail.com`, with a checkmark on the one in use
  - footer "Beta is Fastmail's test server, with its own sign-in and settings. Switching reloads the page and asks you to log in again."
  - section "Debugging" with "Enable remote debugging"
- `NSFaceIDUsageDescription` in both apps: "Unlock your mail with Face ID."
- The version reads `CFBundleShortVersionString (CFBundleVersion)`, for example "1.0 (1)".

**Platforms**
- The package builds for macOS and iOS; `swift test` runs on macOS.
- The Mac apps' behaviour does not change: their web views stay inspectable, `Apps/Shared/SettingsView.swift` is not touched, and `ComposePool.swift` is not touched.
- Nothing in this plan can be seen working on an iPhone or iPad from the Mac. The last task hands those checks to the user.

**Workflow**
- `make test` passes at the end of every task. An integration-test crash inside AppKit's `NSWindowStackController` ("expected no items") is a known intermittent fault: re-run once and say so.
- Tests come first in every task that adds a rule.
- Builds for iOS are unsigned (`CODE_SIGNING_ALLOWED=NO`, or a package build), never installs, and write only under the git-ignored `build/`.

## Verified facts

Measured on 2026-09-13 at commit `e60a3a2`. Build on them rather than re-deriving them.

**The code this plan writes was compiled.**
- A throwaway copy of the repository at `e60a3a2` was used, outside the repository.
- In it, every file in this plan was written as below and the bundle was removed. Then:
  - `swift test` on macOS: `Test run with 335 tests in 0 suites passed`
  - `xcodebuild -scheme FastmailShellKit -destination 'generic/platform=iOS' build` in the package: `** BUILD SUCCEEDED **`
  - `xcodegen generate`, then an unsigned `Personal` build for generic iOS: `** BUILD SUCCEEDED **`. The built `mdbraber.com.app` has `NSFaceIDUsageDescription` in its Info.plist and no `Settings.bundle`.
- Before any change, `swift test` reports `Test run with 300 tests in 0 suites passed`.
- `swift test --filter ScreenLockStateTests` runs just that file's tests (13), so `--filter <TestFileName>` works for a new file.

**The existing code**
- **The sheet.** `MobileSettingsSheet` (`SettingsUI.swift`) holds only a backend picker and a Start page field. The phone's one alerts switch is the Settings bundle's `push.alerts` row, "Notify for new mail". It has no other home.
- **What mentions the bundle:**
  - `Makefile` (`.PHONY` and the `settings-bundle` target with its comment)
  - `project.yml:34`
  - `tools/gen-settings-bundle.py`
  - `SettingsBundleTests.swift`
  - the comment at `BackendTests.swift:25`
  - the doc comment at `PushPreferences.swift:6` (plan 3's file, left alone)

  No IntegrationTests file mentions it.
- **The Xcode project.** `FastmailShell.xcodeproj` is git-ignored and made by `xcodegen generate`, which `make test` runs first (`test: generate`). Removing a folder from `Apps/<app>/` needs no project edit beyond `project.yml`.
- **`AppShell`** builds the web view with `live.startURL(readingFrom: .standard)` and keys it on `backendName`. On iOS it raises `MobileSettingsSheet` from `SettingsPresenter.shared.isPresented`. It routes `onOpenURL`, Handoff, `PendingLinks` and `PendingActions` through `handle(_:)` at once.
- **`PageWatcher`** (`WebContainer.swift`) observes `webView.url` and sets `model.pageURL`. That includes Fastmail's pushState steps, which never reach `decidePolicyFor`.
- **`CustomModeSettingsPusher`** (`WebContainer.swift`) runs `CustomModeSettings.applyScriptSource()` in the page 500 ms after every `UserDefaults.didChangeNotification` and every `willEnterForeground`, whichever key changed.
  - The userscript's `applySettings` drops label caches, rebuilds groupings and refreshes.
  - So writing `device.lastPage` on each page change would, without Task 5's change, make the page do that on every message opened.
- **`WebCoordinator.openExternally`** defaults to `UIApplication.shared.open` on iOS.
  - It gets what `NavigationPolicy.decide` sends out: http, https off Fastmail, `mailto`, `tel`, `facetime` and `webcal`. Other schemes are refused.
  - The other account's app is opened by `AppShell.openInOtherApp`, not through here.
  - IntegrationTests inject their own `openExternally`.
- **Inspectable views.**
  - `WebContainer.makeWebView` sets `isInspectable = true` on every main web view and registers it in `WebViewRegistry.shared`, whose `views` lists the live ones.
  - The two other `isInspectable = true` lines are in `ComposeWindows`, which is compiled only for AppKit. iOS has no compose web views; compose is written in the main page.
- **Scenes.** `PushRegistrar` gives scenes `ShellSceneDelegate`. Neither app's Info.plist declares a scene manifest.
- **The harness row.** `harness.js` `dressSettingsList` posts `openSettings`, and `NativeBridge` calls `onOpenSettings`, which `WebContainer.swift:118` wires to `SettingsPresenter.shared.open()`. `HarnessTests.testDeviceSettingsOpensShellSettingsWithoutNavigating` checks the post.

## File Structure

**Create**, all in `Packages/FastmailShellKit/Sources/FastmailShellKit/`:
- `DevicePreferences.swift`: the five keys and readers, turning Remember off, which address is worth saving, saving it, and `Profile.launchURL(readingFrom:)`. Pure.
- `ScreenLockState.swift`: `ScreenLockState` (when to ask and cover) and `ScreenLockMethod` (the switch's name and footer). Pure.
- `ExternalLinks.swift`: `ExternalLinks.destination(for:inAppBrowser:)` (pure), and `ExternalLinks.open(_:)` behind `#if canImport(UIKit)`, which presents an `SFSafariViewController` or hands the link to the system.
- `WebInspection.swift`: whether the inspector may attach, and applying that to live views.
- `AppVersion.swift`: the version text. Pure.
- `ScreenLock.swift`, iOS only: LocalAuthentication, scene phases, the cover window.
- `DeviceSettingsPage.swift`, iOS only: `DeviceSettingsPage` and `BackendSettingsPage`.

**Create**, all in `Packages/FastmailShellKit/Tests/FastmailShellKitTests/`:
- `DevicePreferencesTests.swift`, `ScreenLockStateTests.swift`, `ExternalLinksTests.swift`, `WebInspectionTests.swift`, `CustomModeSettingsPusherTests.swift`, `AppVersionTests.swift`

**Modify:**
- `Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift`: the default external-link opener (Task 3), and a page-load hook for the settings pusher (Task 5).
- `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`: `isInspectable` (Task 4), and `CustomModeSettingsPusher` pushing only what changed (Task 5).
- `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`:
  - Task 5: the launch address and saving the page
  - Task 6: the lock and held links
  - Task 7: the page overlay replacing the sheet
- `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsPresenter.swift`: animated `open()`, and a new iOS `close()` (Task 7).
- `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`: one comment (Task 7).
- `Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebContainerTests.swift`: the Mac's views stay inspectable (Task 4).
- `Apps/Personal/Info.plist`, `Apps/Work/Info.plist`: `NSFaceIDUsageDescription` (Task 6).
- `Makefile`, `project.yml`, `Packages/FastmailShellKit/Tests/FastmailShellKitTests/BackendTests.swift`: Task 8.

**Delete:**
- `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsUI.swift` (Task 7)
- `Apps/Personal/Settings.bundle/`, `Apps/Work/Settings.bundle/`, `tools/gen-settings-bundle.py`, `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift` (Task 8)

**Not touched:**
- `Apps/Shared/SettingsView.swift`, `ComposePool.swift`, `WebContainer+macOS.swift`
- `PushPreferences.swift`, `PushConfig.swift`, `PushRegistrar.swift`, `NativeBridge.swift`
- `Userscript/`, `Server/`

## Commands used in every task

The package tests (macOS):

```bash
cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test 2>&1 | grep -E "error:|recorded an issue|Test run with"
```

The package built for iOS, unsigned, into the git-ignored `build/`:

```bash
cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && xcodebuild -scheme FastmailShellKit -destination 'generic/platform=iOS' -derivedDataPath /Users/mdbraber/src/fastmail-custom/build/ios-package build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
```

Expected: `** BUILD SUCCEEDED **` and no `error:` line. The existing warnings (`@preconcurrency` in `AttachmentOpener.swift`, unused `assumeIsolated` and "consider using asynchronous alternative function" in `WebContainer.swift`) are not filtered in and do not count.

The Personal app built for iOS, unsigned (Tasks 6 and 8):

```bash
cd /Users/mdbraber/src/fastmail-custom && make generate && xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'generic/platform=iOS' -configuration Debug -derivedDataPath build/ios-app CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
```

The whole suite: `cd /Users/mdbraber/src/fastmail-custom && make test`. Expected: exit 0 and `** TEST SUCCEEDED **`, with the package line as each task states.

---

### Task 1: Device preferences and the launch address

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/DevicePreferences.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/DevicePreferencesTests.swift`

**Interfaces:**
- Consumes (existing):
  - `Backend.current(_:)`, `Backend.defaultsKey`
  - `StartView.resolve(_:default:backend:)`, `StartView.defaultsKey`
  - `Profile.startURL`, `Profile.startURL(readingFrom:)`
  - `LinkRouter.isFastmailHost(_:)` (internal static)
- Produces:
  - `public enum DevicePreferences` with:
    - `screenLockKey`, `rememberPageKey`, `lastPageKey`, `inAppBrowserKey`, `remoteDebuggingKey` (`String`)
    - `screenLock(in:) -> Bool`, `rememberPage(in:) -> Bool`, `lastPage(in:) -> String?`, `inAppBrowser(in:) -> Bool`, `remoteDebugging(in:) -> Bool`
    - `setRememberPage(_ on: Bool, in:)`
    - `rememberablePath(of url: URL?) -> String?`
    - `recordPage(_ url: URL?, in:)`
  - `extension Profile { public func launchURL(readingFrom defaults: UserDefaults) -> URL }`

- [ ] **Step 1: Record where this plan starts**

Run: `cd /Users/mdbraber/src/fastmail-custom && git rev-parse --short HEAD`

Write the printed hash down as BASE; Task 9 compares against it.

- [ ] **Step 2: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/DevicePreferencesTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

private func freshDefaults(_ suite: String) -> UserDefaults {
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

@Test func theDeviceSettingsKeysAreTheAgreedNames() {
    #expect(DevicePreferences.screenLockKey == "device.screenLock")
    #expect(DevicePreferences.rememberPageKey == "device.rememberPage")
    #expect(DevicePreferences.lastPageKey == "device.lastPage")
    #expect(DevicePreferences.inAppBrowserKey == "device.inAppBrowser")
    #expect(DevicePreferences.remoteDebuggingKey == "device.remoteDebugging")
}

@Test func nothingStoredReadsAsTheDefaults() {
    let suite = "device-preferences-defaults-test"
    let defaults = freshDefaults(suite)
    #expect(DevicePreferences.screenLock(in: defaults) == false)
    #expect(DevicePreferences.rememberPage(in: defaults) == false)
    #expect(DevicePreferences.lastPage(in: defaults) == nil)
    #expect(DevicePreferences.inAppBrowser(in: defaults) == true)
    #expect(DevicePreferences.remoteDebugging(in: defaults) == true)
    defaults.removePersistentDomain(forName: suite)
}

@Test func storedValuesOutrankTheDefaults() {
    let suite = "device-preferences-stored-test"
    let defaults = freshDefaults(suite)
    defaults.set(true, forKey: DevicePreferences.screenLockKey)
    defaults.set(true, forKey: DevicePreferences.rememberPageKey)
    defaults.set("/mail/Archive", forKey: DevicePreferences.lastPageKey)
    defaults.set(false, forKey: DevicePreferences.inAppBrowserKey)
    defaults.set(false, forKey: DevicePreferences.remoteDebuggingKey)
    #expect(DevicePreferences.screenLock(in: defaults) == true)
    #expect(DevicePreferences.rememberPage(in: defaults) == true)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Archive")
    #expect(DevicePreferences.inAppBrowser(in: defaults) == false)
    #expect(DevicePreferences.remoteDebugging(in: defaults) == false)
    defaults.removePersistentDomain(forName: suite)
}

@Test func aStoredPageThatIsNotAPathIsIgnored() {
    let suite = "device-preferences-bad-page-test"
    let defaults = freshDefaults(suite)
    for stored in ["mail/Inbox", "https://app.fastmail.com/mail/Inbox", "//evil.example/mail", ""] {
        defaults.set(stored, forKey: DevicePreferences.lastPageKey)
        #expect(DevicePreferences.lastPage(in: defaults) == nil, "\(stored)")
    }
    defaults.removePersistentDomain(forName: suite)
}

@Test func aPageOnAKnownFastmailHostKeepsItsPathQueryAndFragment() {
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://app.fastmail.com/mail/Inbox/T1.M2?u=abc#reply"))
        == "/mail/Inbox/T1.M2?u=abc#reply")
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://app.beta.fastmail.com/mail/Archive/"))
        == "/mail/Archive/")
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://APP.FASTMAIL.COM/calendar/"))
        == "/calendar/")
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://app.fastmail.com/settings/custommode"))
        == "/settings/custommode")
    // Kept as it is encoded, so it opens exactly as it was
    #expect(DevicePreferences.rememberablePath(of: URL(string: "https://app.fastmail.com/mail/search:from%3Aboss"))
        == "/mail/search:from%3Aboss")
}

@Test func otherHostsAndSchemesAreNotSaved() {
    let refused = [
        "https://example.com/mail/Inbox",
        "https://www.fastmail.com/help/",
        "https://app.fastmail.com.evil.example/mail/Inbox",
        "http://app.fastmail.com/mail/Inbox",
        "about:blank"
    ]
    for address in refused {
        #expect(DevicePreferences.rememberablePath(of: URL(string: address)) == nil, "\(address)")
    }
    #expect(DevicePreferences.rememberablePath(of: nil) == nil)
}

@Test func theLoginPageAndMessagesBeingWrittenAreNotSaved() {
    let refused = [
        "https://app.fastmail.com/login/",
        "https://app.fastmail.com/login/?redirect=%2Fmail%2FInbox",
        "https://app.fastmail.com/",
        "https://app.fastmail.com/mail/compose?mailto=mailto%3Aa%40b.com&u=abc",
        "https://app.fastmail.com/mail/Inbox/compose?u=abc"
    ]
    for address in refused {
        #expect(DevicePreferences.rememberablePath(of: URL(string: address)) == nil, "\(address)")
    }
}

@Test func thePageIsSavedOnlyWhileTheSwitchIsOn() {
    let suite = "device-preferences-record-test"
    let defaults = freshDefaults(suite)
    let inbox = URL(string: "https://app.fastmail.com/mail/Inbox/?u=abc")!
    DevicePreferences.recordPage(inbox, in: defaults)
    #expect(defaults.object(forKey: DevicePreferences.lastPageKey) == nil)

    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(inbox, in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Inbox/?u=abc")

    // A page not worth saving leaves the last good one
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/login/"), in: defaults)
    DevicePreferences.recordPage(URL(string: "https://example.com/elsewhere"), in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Inbox/?u=abc")
    defaults.removePersistentDomain(forName: suite)
}

@Test func turningTheSwitchOffDeletesTheSavedPage() {
    let suite = "device-preferences-forget-test"
    let defaults = freshDefaults(suite)
    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/mail/Archive"), in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Archive")
    DevicePreferences.setRememberPage(false, in: defaults)
    #expect(DevicePreferences.rememberPage(in: defaults) == false)
    #expect(defaults.object(forKey: DevicePreferences.lastPageKey) == nil)
    defaults.removePersistentDomain(forName: suite)
}

// The launch address, in the spec's order. The first step, a link the app was
// launched with, is not this function's: AppShell routes that link once the
// app is up, and it replaces whatever was loaded here.
@Test func theLaunchAddressIsTheSavedPageThenTheStartPageThenTheDefaultView() {
    let suite = "device-preferences-launch-test"
    let defaults = freshDefaults(suite)
    let profile = Profile.personal(accountID: nil)
    defaults.set(Backend.production.rawValue, forKey: Backend.defaultsKey)

    // Nothing set: Fastmail's default view
    #expect(profile.launchURL(readingFrom: defaults) == URL(string: "https://app.fastmail.com/")!)

    // A Start page
    defaults.set("/mail/Archive", forKey: StartView.defaultsKey)
    #expect(profile.launchURL(readingFrom: defaults) == URL(string: "https://app.fastmail.com/mail/Archive")!)

    // Remembering on but nothing saved yet: still the Start page
    DevicePreferences.setRememberPage(true, in: defaults)
    #expect(profile.launchURL(readingFrom: defaults) == URL(string: "https://app.fastmail.com/mail/Archive")!)

    // A saved page outranks the Start page
    defaults.set("/mail/Inbox/T1.M2?u=abc#reply", forKey: DevicePreferences.lastPageKey)
    #expect(profile.launchURL(readingFrom: defaults)
        == URL(string: "https://app.fastmail.com/mail/Inbox/T1.M2?u=abc#reply")!)

    // A saved page is used only while the switch is on
    defaults.set(false, forKey: DevicePreferences.rememberPageKey)
    #expect(profile.launchURL(readingFrom: defaults) == URL(string: "https://app.fastmail.com/mail/Archive")!)
    defaults.removePersistentDomain(forName: suite)
}

@Test func aSavedPageIsPutOnTheCurrentBackend() {
    let suite = "device-preferences-launch-backend-test"
    let defaults = freshDefaults(suite)
    let profile = Profile.personal(accountID: nil)
    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/mail/Archive/T9?u=abc"), in: defaults)
    defaults.set(Backend.beta.rawValue, forKey: Backend.defaultsKey)
    #expect(profile.launchURL(readingFrom: defaults)
        == URL(string: "https://app.beta.fastmail.com/mail/Archive/T9?u=abc")!)
    defaults.removePersistentDomain(forName: suite)
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter DevicePreferencesTests 2>&1 | grep -E "error:" | head -5`

Expected: `error: cannot find 'DevicePreferences' in scope`, and `value of type 'Profile' has no member 'launchURL'`. The test target does not build.

- [ ] **Step 4: Write the implementation**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/DevicePreferences.swift`:

```swift
import Foundation

/// The Device settings page's own settings on iPhone and iPad, kept in the
/// app's standard defaults, so Personal and Work each have their own.
public enum DevicePreferences {
    public static let screenLockKey = "device.screenLock"
    public static let rememberPageKey = "device.rememberPage"
    /// A path with its query and fragment, starting with `/`; never a host.
    public static let lastPageKey = "device.lastPage"
    public static let inAppBrowserKey = "device.inAppBrowser"
    public static let remoteDebuggingKey = "device.remoteDebugging"

    public static func screenLock(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: screenLockKey) as? Bool ?? false
    }

    public static func rememberPage(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: rememberPageKey) as? Bool ?? false
    }

    /// The saved page, or nothing when none is saved or what is stored is not a
    /// path of this app's own.
    public static func lastPage(in defaults: UserDefaults = .standard) -> String? {
        guard
            let path = defaults.string(forKey: lastPageKey),
            path.hasPrefix("/"),
            !path.hasPrefix("//")
        else { return nil }
        return path
    }

    public static func inAppBrowser(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: inAppBrowserKey) as? Bool ?? true
    }

    public static func remoteDebugging(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: remoteDebuggingKey) as? Bool ?? true
    }

    /// Turning Remember last viewed page off forgets the page it had saved.
    public static func setRememberPage(_ on: Bool, in defaults: UserDefaults = .standard) {
        defaults.set(on, forKey: rememberPageKey)
        if !on { defaults.removeObject(forKey: lastPageKey) }
    }

    /// The first path segments of Fastmail's own views. Anything else, the
    /// login page among it, is not a page to come back to.
    static let rememberedViews: Set<String> = ["mail", "calendar", "contacts", "notes", "files", "settings"]

    /// What is worth saving of an address the main web view shows: its path,
    /// query and fragment, as they are encoded. Nothing for another host, a
    /// scheme other than https, a page outside Fastmail's views such as the
    /// login page, or a message being written, which would open an empty
    /// draft at every launch.
    public static func rememberablePath(of url: URL?) -> String? {
        guard
            let url,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == "https",
            LinkRouter.isFastmailHost(components.host)
        else { return nil }
        let path = components.percentEncodedPath
        let segments = path.split(separator: "/").map(String.init)
        guard
            let view = segments.first?.lowercased(),
            rememberedViews.contains(view),
            !segments.contains("compose")
        else { return nil }
        var remembered = path
        if let query = components.percentEncodedQuery, !query.isEmpty { remembered += "?" + query }
        if let fragment = components.percentEncodedFragment, !fragment.isEmpty { remembered += "#" + fragment }
        return remembered
    }

    /// Saves the page the main web view shows, while the switch is on. An
    /// address that is not worth saving leaves the last good one in place.
    public static func recordPage(_ url: URL?, in defaults: UserDefaults = .standard) {
        guard rememberPage(in: defaults), let path = rememberablePath(of: url) else { return }
        guard defaults.string(forKey: lastPageKey) != path else { return }
        defaults.set(path, forKey: lastPageKey)
    }
}

extension Profile {
    /// The address the iPhone and iPad apps open at launch: the saved page
    /// while Remember last viewed page is on and a page is saved, otherwise
    /// the Start page, otherwise Fastmail's default view; always on the
    /// current backend, so switching backends keeps the page.
    ///
    /// A link the app was launched with is not part of this. It is routed once
    /// the app is up, as it always was, and replaces whatever this loaded.
    public func launchURL(readingFrom defaults: UserDefaults) -> URL {
        if DevicePreferences.rememberPage(in: defaults), let saved = DevicePreferences.lastPage(in: defaults) {
            return StartView.resolve(saved, default: startURL, backend: Backend.current(defaults))
        }
        return startURL(readingFrom: defaults)
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter DevicePreferencesTests 2>&1 | grep -E "error:|recorded an issue|Test run with"`

Expected: `Test run with 11 tests in 0 suites passed`.

Then run the package tests (see "Commands used in every task"). Expected: `Test run with 311 tests in 0 suites passed`.

- [ ] **Step 6: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 311 package tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/DevicePreferences.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/DevicePreferencesTests.swift
git commit -F - <<'EOF'
feat: the phone's device settings have their keys, and the launch address follows a remembered page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 2: When the screen lock asks

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/ScreenLockState.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScreenLockStateTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `public struct ScreenLockState: Equatable, Sendable`, with:
    - `static let gracePeriod: TimeInterval` (60)
    - `init(lockEnabled: Bool)`
    - `isLocked: Bool` and `isAsking: Bool`, both `public private(set)`
    - `mutating func enteredBackground(at: Date)`
    - `mutating func becameActive(at: Date, lockEnabled: Bool) -> Bool`, true when the app should ask now
    - `mutating func unlockTapped() -> Bool`, true when the app should ask now
    - `mutating func finishedAsking(succeeded: Bool)`
    - `mutating func cannotAsk()`
    - `func wouldBeLocked(at: Date, lockEnabled: Bool) -> Bool`
    - `func coversContent(isInFront: Bool, lockEnabled: Bool) -> Bool`
  - `public enum ScreenLockMethod: Equatable, Sendable`, with:
    - cases `.faceID`, `.touchID`, `.opticID`, `.passcode`, `.unavailable`
    - `title: String`, `canLock: Bool`, `footer: String`

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScreenLockStateTests.swift`. A mutating call is never made inside `#expect`; the macro cannot take one.

```swift
import Foundation
import Testing
@testable import FastmailShellKit

private let start = Date(timeIntervalSinceReferenceDate: 800_000_000)

/// A lock that asked at launch and was opened.
private func unlocked() -> ScreenLockState {
    var state = ScreenLockState(lockEnabled: true)
    _ = state.becameActive(at: start, lockEnabled: true)
    state.finishedAsking(succeeded: true)
    return state
}

@Test func theLockAsksAtLaunch() {
    var state = ScreenLockState(lockEnabled: true)
    #expect(state.isLocked)
    let asked = state.becameActive(at: start, lockEnabled: true)
    #expect(asked)
    #expect(state.isAsking)
    // SwiftUI can say the app is active twice; one ask is enough
    let askedAgain = state.becameActive(at: start, lockEnabled: true)
    #expect(!askedAgain)
}

@Test func withoutTheLockNothingIsAskedOrCovered() {
    var state = ScreenLockState(lockEnabled: false)
    #expect(!state.isLocked)
    let asked = state.becameActive(at: start, lockEnabled: false)
    #expect(!asked)
    state.enteredBackground(at: start)
    let askedLater = state.becameActive(at: start.addingTimeInterval(3600), lockEnabled: false)
    #expect(!askedLater)
    #expect(!state.coversContent(isInFront: false, lockEnabled: false))
    #expect(!state.wouldBeLocked(at: start.addingTimeInterval(3600), lockEnabled: false))
}

@Test func theLockAsksAfterMoreThanAMinuteAway() {
    var state = unlocked()
    state.enteredBackground(at: start)
    let asked = state.becameActive(at: start.addingTimeInterval(60.5), lockEnabled: true)
    #expect(asked)
    #expect(state.isLocked)
}

@Test func theLockDoesNotAskAfterAMinuteOrLess() {
    for away: TimeInterval in [0, 30, 60] {
        var state = unlocked()
        state.enteredBackground(at: start)
        let asked = state.becameActive(at: start.addingTimeInterval(away), lockEnabled: true)
        #expect(!asked, "away \(away)s")
        #expect(!state.isLocked, "away \(away)s")
        #expect(!state.coversContent(isInFront: true, lockEnabled: true), "away \(away)s")
    }
}

@Test func aFailedOrCancelledAskKeepsTheCoverAndWaitsForUnlock() {
    var state = ScreenLockState(lockEnabled: true)
    _ = state.becameActive(at: start, lockEnabled: true)
    state.finishedAsking(succeeded: false)
    #expect(state.isLocked)
    #expect(state.coversContent(isInFront: true, lockEnabled: true))
    // The prompt itself takes the app out of the front and back again, which
    // is not a return from the background
    let askedByItself = state.becameActive(at: start.addingTimeInterval(1), lockEnabled: true)
    #expect(!askedByItself)
    let askedByUnlock = state.unlockTapped()
    #expect(askedByUnlock)
    let askedTwice = state.unlockTapped()
    #expect(!askedTwice)
    state.finishedAsking(succeeded: true)
    #expect(!state.isLocked)
    #expect(!state.coversContent(isInFront: true, lockEnabled: true))
}

@Test func unlockAsksNothingOfAnAppThatIsNotLocked() {
    var state = unlocked()
    let asked = state.unlockTapped()
    #expect(!asked)
}

@Test func aLockThatWasNeverOpenedAsksAgainOnReturnHoweverSoon() {
    var state = ScreenLockState(lockEnabled: true)
    _ = state.becameActive(at: start, lockEnabled: true)
    state.finishedAsking(succeeded: false)
    state.enteredBackground(at: start.addingTimeInterval(5))
    let asked = state.becameActive(at: start.addingTimeInterval(10), lockEnabled: true)
    #expect(asked)
}

@Test func theCoverIsUpWheneverTheAppIsNotInFront() {
    let state = unlocked()
    #expect(state.coversContent(isInFront: false, lockEnabled: true))
    #expect(!state.coversContent(isInFront: true, lockEnabled: true))
}

@Test func aLockThatCannotAskLetsTheAppOpen() {
    var state = ScreenLockState(lockEnabled: true)
    _ = state.becameActive(at: start, lockEnabled: true)
    state.cannotAsk()
    #expect(!state.isLocked)
    #expect(!state.isAsking)
}

@Test func linksWaitWhileTheLockIsUpOrAboutToBe() {
    #expect(ScreenLockState(lockEnabled: true).wouldBeLocked(at: start, lockEnabled: true))
    var state = unlocked()
    #expect(!state.wouldBeLocked(at: start, lockEnabled: true))
    state.enteredBackground(at: start)
    #expect(!state.wouldBeLocked(at: start.addingTimeInterval(60), lockEnabled: true))
    #expect(state.wouldBeLocked(at: start.addingTimeInterval(61), lockEnabled: true))
}

@Test func turningTheLockOnWhileTheAppIsOpenDoesNotLockIt() {
    var state = ScreenLockState(lockEnabled: false)
    let asked = state.becameActive(at: start, lockEnabled: true)
    #expect(!asked)
    #expect(!state.isLocked)
}

@Test func theSwitchIsNamedForWhatTheDeviceUnlocksWith() {
    #expect(ScreenLockMethod.faceID.title == "Face ID")
    #expect(ScreenLockMethod.touchID.title == "Touch ID")
    #expect(ScreenLockMethod.passcode.title == "Passcode")
    #expect(ScreenLockMethod.unavailable.title == "Passcode")
    #expect(ScreenLockMethod.faceID.footer == "Require authentication when opening the app")
}

@Test func withoutAPasscodeTheLockCannotBeTurnedOn() {
    #expect(!ScreenLockMethod.unavailable.canLock)
    #expect(ScreenLockMethod.unavailable.footer == "Set a passcode for this device in the Settings app first.")
    for method: ScreenLockMethod in [.faceID, .touchID, .opticID, .passcode] {
        #expect(method.canLock)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter ScreenLockStateTests 2>&1 | grep -E "error:" | head -5`

Expected: `error: cannot find 'ScreenLockState' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/ScreenLockState.swift`:

```swift
import Foundation

/// When the screen lock asks, and when its cover is up. Pure, so the timing can
/// be tested anywhere; ScreenLock carries it out on iPhone and iPad.
///
/// The app asks at launch, and when it comes back to the front after more than
/// a minute in the background. Face ID's own prompt takes the app out of the
/// front and back again without sending it to the background, so only time in
/// the background counts, and an ask that failed or was cancelled waits for
/// Unlock rather than asking again by itself.
public struct ScreenLockState: Equatable, Sendable {
    /// How long the app may be away before it asks again. Exactly this long
    /// does not ask.
    public static let gracePeriod: TimeInterval = 60

    public private(set) var isLocked: Bool
    public private(set) var isAsking = false
    private var backgroundSince: Date?
    private var askedSinceBackground = false

    /// A launch with the lock on starts locked.
    public init(lockEnabled: Bool) {
        isLocked = lockEnabled
    }

    public mutating func enteredBackground(at now: Date) {
        if backgroundSince == nil { backgroundSince = now }
        askedSinceBackground = false
    }

    /// The app is in front again, or for the first time. Answers whether to
    /// ask now.
    public mutating func becameActive(at now: Date, lockEnabled: Bool) -> Bool {
        guard lockEnabled else {
            isLocked = false
            backgroundSince = nil
            return false
        }
        if let since = backgroundSince {
            backgroundSince = nil
            if now.timeIntervalSince(since) > Self.gracePeriod { isLocked = true }
        }
        guard isLocked, !isAsking, !askedSinceBackground else { return false }
        isAsking = true
        askedSinceBackground = true
        return true
    }

    /// The cover's Unlock button. Answers whether to ask now.
    public mutating func unlockTapped() -> Bool {
        guard isLocked, !isAsking else { return false }
        isAsking = true
        return true
    }

    public mutating func finishedAsking(succeeded: Bool) {
        isAsking = false
        if succeeded { isLocked = false }
    }

    /// The device can no longer ask, because its passcode was removed after
    /// the lock was turned on. The app opens; the caller turns the switch off.
    public mutating func cannotAsk() {
        isAsking = false
        isLocked = false
    }

    /// Whether the app is locked, or will be the moment it is in front again.
    /// A link handed in now waits until the lock has opened.
    public func wouldBeLocked(at now: Date, lockEnabled: Bool) -> Bool {
        guard lockEnabled else { return false }
        if isLocked { return true }
        guard let since = backgroundSince else { return false }
        return now.timeIntervalSince(since) > Self.gracePeriod
    }

    /// The cover is up while the app is locked, and whenever it is not in
    /// front, so the app switcher's snapshot shows no mail.
    public func coversContent(isInFront: Bool, lockEnabled: Bool) -> Bool {
        lockEnabled && (isLocked || !isInFront)
    }
}

/// What the device unlocks with, which names the switch.
public enum ScreenLockMethod: Equatable, Sendable {
    case faceID
    case touchID
    case opticID
    case passcode
    /// No passcode is set, so there is nothing to ask for.
    case unavailable

    public var title: String {
        switch self {
        case .faceID: "Face ID"
        case .touchID: "Touch ID"
        case .opticID: "Optic ID"
        case .passcode, .unavailable: "Passcode"
        }
    }

    public var canLock: Bool {
        self != .unavailable
    }

    public var footer: String {
        canLock
            ? "Require authentication when opening the app"
            : "Set a passcode for this device in the Settings app first."
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter ScreenLockStateTests 2>&1 | grep -E "error:|recorded an issue|Test run with"`

Expected: `Test run with 13 tests in 0 suites passed`. Then the package tests: `Test run with 324 tests in 0 suites passed`.

- [ ] **Step 5: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 324 package tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/ScreenLockState.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScreenLockStateTests.swift
git commit -F - <<'EOF'
feat: the screen lock asks at launch and after more than a minute away

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 3: External links in the in-app browser

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/ExternalLinks.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift:32-38` (the default `openExternally`)
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ExternalLinksTests.swift`

**Interfaces:**
- Consumes (Task 1): `DevicePreferences.inAppBrowser(in:)`.
- Produces:
  - `public enum ExternalLinkDestination { case inAppBrowser, system }`
  - `ExternalLinks.destination(for url: URL, inAppBrowser: Bool) -> ExternalLinkDestination`
  - iOS only: `@MainActor ExternalLinks.open(_ url: URL, defaults: UserDefaults = .standard)`

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ExternalLinksTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

private func destination(_ string: String, inAppBrowser: Bool) -> ExternalLinkDestination {
    ExternalLinks.destination(for: URL(string: string)!, inAppBrowser: inAppBrowser)
}

@Test func withTheSwitchOnWebLinksOpenInTheInAppBrowser() {
    #expect(destination("https://example.com/article", inAppBrowser: true) == .inAppBrowser)
    #expect(destination("http://example.com/", inAppBrowser: true) == .inAppBrowser)
    #expect(destination("HTTPS://Example.com/", inAppBrowser: true) == .inAppBrowser)
}

@Test func withTheSwitchOnEveryOtherSchemeStillGoesToTheSystem() {
    let links = [
        "mailto:someone@example.com",
        "tel:+3112345678",
        "facetime:someone@example.com",
        "webcal://example.com/calendar.ics",
        "fastmail-work://open?url=https%3A%2F%2Fapp.fastmail.com%2F&handoff=1",
        // A web scheme with no host is nothing the in-app browser can show
        "https:no-host"
    ]
    for link in links {
        #expect(destination(link, inAppBrowser: true) == .system, "\(link)")
    }
}

@Test func withTheSwitchOffEveryLinkGoesToTheSystem() {
    let links = [
        "https://example.com/article",
        "http://example.com/",
        "mailto:someone@example.com",
        "tel:+3112345678",
        "facetime:someone@example.com",
        "webcal://example.com/calendar.ics"
    ]
    for link in links {
        #expect(destination(link, inAppBrowser: false) == .system, "\(link)")
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter ExternalLinksTests 2>&1 | grep -E "error:" | head -5`

Expected: `error: cannot find type 'ExternalLinkDestination' in scope` and `cannot find 'ExternalLinks' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/ExternalLinks.swift`:

```swift
import Foundation

#if canImport(UIKit)
import SafariServices
import UIKit
#endif

public enum ExternalLinkDestination: Equatable, Sendable {
    /// An `SFSafariViewController` over the app, with its own Done button.
    case inAppBrowser
    /// Whatever the system does with the link: Safari, or the app that claims it.
    case system
}

/// Where a link the navigation policy sends out of the app goes on iPhone and
/// iPad. Only a web address with a host can be shown in the in-app browser;
/// mailto, tel, facetime, webcal and every other scheme still go to the
/// system. A link to the other account's app never comes through here: it is
/// handed over in AppShell, as it always was.
public enum ExternalLinks {
    public static func destination(for url: URL, inAppBrowser: Bool) -> ExternalLinkDestination {
        guard
            inAppBrowser,
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            let host = url.host,
            !host.isEmpty
        else { return .system }
        return .inAppBrowser
    }
}

#if canImport(UIKit)
extension ExternalLinks {
    /// Opens the link where the Use in-app browser switch says.
    @MainActor
    public static func open(_ url: URL, defaults: UserDefaults = .standard) {
        switch destination(for: url, inAppBrowser: DevicePreferences.inAppBrowser(in: defaults)) {
        case .inAppBrowser:
            guard let presenter = topViewController() else {
                UIApplication.shared.open(url)
                return
            }
            presenter.present(SFSafariViewController(url: url), animated: true)
        case .system:
            UIApplication.shared.open(url)
        }
    }

    @MainActor
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first { $0.isKeyWindow }
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}
#endif
```

- [ ] **Step 4: Send the phone's external links through it**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift`, replace:

```swift
        openExternally: @escaping @MainActor (URL) -> Void = { url in
            #if canImport(UIKit)
            UIApplication.shared.open(url)
            #else
```

with:

```swift
        openExternally: @escaping @MainActor (URL) -> Void = { url in
            #if canImport(UIKit)
            // The in-app browser for web links while its switch is on; the
            // system for everything else, as before.
            ExternalLinks.open(url)
            #else
```

The `#else` branch (`NSWorkspace.shared.open(url)`) stays as it is. Downloads never reach this closure: `decidePolicyFor navigationResponse` hands `.download` to WebKit before its switch.

- [ ] **Step 5: Run the tests and the iOS build**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter ExternalLinksTests 2>&1 | grep -E "error:|recorded an issue|Test run with"`

Expected: `Test run with 3 tests in 0 suites passed`.

Then:
- Run the package tests. Expected: `Test run with 327 tests in 0 suites passed`.
- Run the iOS package build. Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 6: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 327 package tests. The IntegrationTests' `WebCoordinatorTests` inject their own opener, so they are unaffected.

- [ ] **Step 7: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/ExternalLinks.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/ExternalLinksTests.swift Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift
git commit -F - <<'EOF'
feat: web links leaving the phone's app open in an in-app browser while its switch is on

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 4: The remote debugging switch decides whether views are inspectable

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebInspection.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift:189-190`
- Modify: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebContainerTests.swift` (after `theWebViewCarriesThePlatformsContentMode`, around line 138)
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebInspectionTests.swift`

**Interfaces:**
- Consumes (Task 1): `DevicePreferences.remoteDebugging(in:)`.
- Produces:
  - `WebInspection.isAllowed(isMac: Bool, remoteDebugging: Bool) -> Bool`
  - `WebInspection.isAllowed(in: UserDefaults = .standard) -> Bool`
  - `@MainActor WebInspection.apply(to views: [WKWebView], in: UserDefaults = .standard)`

- [ ] **Step 1: Write the failing tests**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebInspectionTests.swift`:

```swift
import Foundation
import Testing
import WebKit
@testable import FastmailShellKit

@Test func onThePhoneTheSwitchDecidesWhetherTheInspectorMayAttach() {
    #expect(WebInspection.isAllowed(isMac: false, remoteDebugging: true))
    #expect(!WebInspection.isAllowed(isMac: false, remoteDebugging: false))
}

@Test func theMacsWebViewsStayInspectableWhateverIsStored() {
    #expect(WebInspection.isAllowed(isMac: true, remoteDebugging: true))
    #expect(WebInspection.isAllowed(isMac: true, remoteDebugging: false))
}

#if os(macOS)
@Test @MainActor func onTheMacApplyingTheSwitchLeavesViewsInspectable() {
    let suite = "web-inspection-mac-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    defaults.set(false, forKey: DevicePreferences.remoteDebuggingKey)
    let view = WKWebView()
    view.isInspectable = false
    WebInspection.apply(to: [view], in: defaults)
    #expect(view.isInspectable)
    defaults.removePersistentDomain(forName: suite)
}
#endif
```

In `Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebContainerTests.swift`, insert directly after the closing `}` of `theWebViewCarriesThePlatformsContentMode` and before the comment `// Handoff offers whatever the window is showing`. It passes before and after this task on the Mac; it guards the Mac against the change in Step 4.

```swift

#if os(macOS)
// The remote debugging switch is the phone's; the Mac's views stay inspectable.
@Test @MainActor func theMacsMainWebViewStaysInspectable() {
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
    #expect(webView.isInspectable)
}
#endif
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter WebInspectionTests 2>&1 | grep -E "error:" | head -5`

Expected: `error: cannot find 'WebInspection' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/WebInspection.swift`:

```swift
import Foundation
import WebKit

/// Whether Safari's Web Inspector may attach to the app's web views. The Mac's
/// always may, as they always could; on iPhone and iPad the Enable remote
/// debugging switch decides, for the views already open and every one made
/// later.
public enum WebInspection {
    static let isMac: Bool = {
        #if os(macOS)
        true
        #else
        false
        #endif
    }()

    public static func isAllowed(isMac: Bool, remoteDebugging: Bool) -> Bool {
        isMac || remoteDebugging
    }

    public static func isAllowed(in defaults: UserDefaults = .standard) -> Bool {
        isAllowed(isMac: isMac, remoteDebugging: DevicePreferences.remoteDebugging(in: defaults))
    }

    @MainActor
    public static func apply(to views: [WKWebView], in defaults: UserDefaults = .standard) {
        let allowed = isAllowed(in: defaults)
        for view in views {
            view.isInspectable = allowed
        }
    }
}
```

- [ ] **Step 4: Make the main web view follow it**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`, in `makeWebView`, replace:

```swift
        WebViewRegistry.shared.register(webView)
        webView.isInspectable = true
```

with:

```swift
        WebViewRegistry.shared.register(webView)
        // Always on the Mac; on iPhone and iPad, the Enable remote debugging
        // switch on the Backend page.
        webView.isInspectable = WebInspection.isAllowed()
```

Leave both `view.isInspectable = true` lines in `ComposePool.swift` as they are. They are in `ComposeWindows`, which only the Mac compiles.

- [ ] **Step 5: Run the tests and the iOS build**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter "WebInspectionTests|theMacsMainWebViewStaysInspectable" 2>&1 | grep -E "error:|recorded an issue|Test run with"`

Expected: `Test run with 4 tests in 0 suites passed`.

Then:
- Run the package tests. Expected: `Test run with 331 tests in 0 suites passed`.
- Run the iOS package build. Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 6: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 331 package tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/WebInspection.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebInspectionTests.swift Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebContainerTests.swift
git commit -F - <<'EOF'
feat: on the phone a switch decides whether Web Inspector can attach; the Mac stays inspectable

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 5: Remembering the page, and opening on it

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift` (`CustomModeSettingsPusher`, the last class in the file)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift` (`webView(_:didFinish:)`, around line 213)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift` (the init, the `WebContainer` line, the `scenePhase` change handler)
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsPusherTests.swift`

**Interfaces:**
- Consumes (Task 1): `Profile.launchURL(readingFrom:)`, `DevicePreferences.recordPage(_:in:)`, `DevicePreferences.setRememberPage(_:in:)`, `DevicePreferences.lastPage(in:)`.
- Consumes (existing): `CustomModeSettings.json(from:)` (internal static), `CustomModeSettings.defaultsKey(for:)`.
- Produces:
  - `CustomModeSettingsPusher.shouldPush(_ settings: String, after pushed: String?, force: Bool) -> Bool` (nonisolated static)
  - `CustomModeSettingsPusher.pageLoaded()`
  - `AppShell.launchURL` (private)

Why the pusher changes first: saving the page writes `device.lastPage` on every page change. The pusher reacts to every defaults write by making the page apply its settings again, which drops caches and asks the server for counts. After this task it pushes only settings the running page does not already have. A new document resets that.

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsPusherTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

// Applying settings makes the page drop its caches and ask the server for
// counts again, so a defaults write that changed nothing the page reads, such
// as the page the app is on, must not reach it.
@Test func settingsThePageAlreadyHasAreNotPushedAgain() {
    #expect(!CustomModeSettingsPusher.shouldPush(#"{"a":true}"#, after: #"{"a":true}"#, force: false))
}

@Test func changedSettingsArePushed() {
    #expect(CustomModeSettingsPusher.shouldPush(#"{"a":false}"#, after: #"{"a":true}"#, force: false))
}

// A page that has only what it started with gets the next push, as it always did.
@Test func aPageThatWasNeverPushedToGetsTheNextPush() {
    #expect(CustomModeSettingsPusher.shouldPush(#"{"a":true}"#, after: nil, force: false))
}

// Coming back to the front pushes regardless, as it always did.
@Test func aForcedPushAlwaysGoes() {
    #expect(CustomModeSettingsPusher.shouldPush(#"{"a":true}"#, after: #"{"a":true}"#, force: true))
}

@Test func savingThePageLeavesTheCustomModeSettingsAsTheyWere() {
    let suite = "pusher-last-page-test"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    defaults.set(true, forKey: CustomModeSettings.defaultsKey(for: "filteredLabelCounts"))
    let before = CustomModeSettings.json(from: defaults)
    DevicePreferences.setRememberPage(true, in: defaults)
    DevicePreferences.recordPage(URL(string: "https://app.fastmail.com/mail/Archive"), in: defaults)
    #expect(DevicePreferences.lastPage(in: defaults) == "/mail/Archive")
    #expect(CustomModeSettings.json(from: defaults) == before)
    defaults.removePersistentDomain(forName: suite)
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter CustomModeSettingsPusherTests 2>&1 | grep -E "error:" | head -5`

Expected: `error: type 'CustomModeSettingsPusher' has no member 'shouldPush'`.

- [ ] **Step 3: Push only what changed**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`, replace everything from the line `/// Pushes changed Custom mode settings into a running page, the way the Safari` to the end of the file with:

```swift
/// Pushes changed Custom mode settings into a running page, the way the Safari
/// extension's storage listener does for its tabs.
@MainActor
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
        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.schedulePush(force: false) }
        })
        #if canImport(UIKit)
        observers.append(center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.schedulePush(force: true) }
        })
        #endif
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// A new document was loaded, with the settings the view was built with.
    func pageLoaded() {
        pushed = nil
    }

    /// Every defaults write posts the same notification, the shell's own keys
    /// included, and the iPhone and iPad apps write one each time the page
    /// changes while Remember last viewed page is on. A push the page already
    /// has would only make it drop its caches again.
    nonisolated static func shouldPush(_ settings: String, after pushed: String?, force: Bool) -> Bool {
        force || settings != pushed
    }

    // Applying settings makes the page drop caches and re-ask the server for
    // counts, so a keystroke-by-keystroke stream of changes is coalesced into
    // one push once the writing pauses.
    private func schedulePush(force: Bool) {
        forceNext = forceNext || force
        pushTask?.cancel()
        pushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled, let self else { return }
            let settings = CustomModeSettings.json(from: .standard)
            let force = self.forceNext
            self.forceNext = false
            guard Self.shouldPush(settings, after: self.pushed, force: force) else { return }
            self.pushed = settings
            self.webView?.evaluateJavaScript(
                CustomModeSettings.applyScriptSource(),
                completionHandler: nil
            )
        }
    }
}
```

- [ ] **Step 4: Reset it on each page load**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift`, replace:

```swift
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        #if !canImport(UIKit)
```

with:

```swift
    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // A new document starts from the settings it was built with, so the
        // next change reaches it whatever the last one pushed.
        settingsPusher?.pageLoaded()
        #if !canImport(UIKit)
```

- [ ] **Step 5: Open on the remembered page, and save it as it changes**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`, make three replacements.

First, replace:

```swift
    public init(profile: Profile) {
        self.profile = profile
    }
```

with:

```swift
    public init(profile: Profile) {
        self.profile = profile
    }

    /// What the web view opens. On iPhone and iPad a remembered page comes
    /// first; the Mac opens its Start page as it always has.
    private var launchURL: URL {
        #if canImport(UIKit)
        live.launchURL(readingFrom: .standard)
        #else
        live.startURL(readingFrom: .standard)
        #endif
    }
```

Second, replace:

```swift
            WebContainer(profile: live, model: model, loadURL: live.startURL(readingFrom: .standard))
```

with:

```swift
            WebContainer(profile: live, model: model, loadURL: launchURL)
```

Third, replace:

```swift
                PushRegistrar.current?.becameActive()
            }
        }
        .onChange(of: pendingLinks.url) {
```

with:

```swift
                PushRegistrar.current?.becameActive()
            }
        }
        .onChange(of: model.pageURL) {
            // Remember last viewed page: saved as it changes, while the switch is on
            DevicePreferences.recordPage(model.pageURL)
        }
        .onChange(of: pendingLinks.url) {
```

- [ ] **Step 6: Run the tests and the iOS build**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter CustomModeSettingsPusherTests 2>&1 | grep -E "error:|recorded an issue|Test run with"`

Expected: `Test run with 5 tests in 0 suites passed`.

Then:
- Run the package tests. Expected: `Test run with 336 tests in 0 suites passed`.
- Run the iOS package build. Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 7: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 336 package tests.

- [ ] **Step 8: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/CustomModeSettingsPusherTests.swift
git commit -F - <<'EOF'
feat: the phone remembers the page it was on, without re-pushing settings the page already has

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 6: The screen lock on iPhone and iPad

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/ScreenLock.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`
- Modify: `Apps/Personal/Info.plist`, `Apps/Work/Info.plist`

**Interfaces:**
- Consumes (Task 1): `DevicePreferences.screenLock(in:)`, `DevicePreferences.screenLockKey`.
- Consumes (Task 2): `ScreenLockState` and `ScreenLockMethod`.
- Produces, iOS only:
  - `@MainActor public final class ScreenLock: ObservableObject`, with:
    - `static let shared`
    - `@Published public private(set) var state: ScreenLockState`
    - `isEnabled: Bool`, `holdsLinks: Bool`
    - `static func method() -> ScreenLockMethod`
    - `func scenePhaseChanged(_: ScenePhase)`, `func unlockTapped()`, `func setEnabled(_: Bool)`
  - In `AppShell` (private): `route(_:)`, `releaseHeldLinks()`, and `heldLinks`.

The rules are tested in Task 2. This task wires LocalAuthentication and the cover to them, which only a device can show; its checks are the iOS builds and a reading of the wiring.

- [ ] **Step 1: Write the controller and its cover**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/ScreenLock.swift`:

```swift
#if canImport(UIKit)
import LocalAuthentication
import SwiftUI
import UIKit

/// The screen lock on iPhone and iPad: asks with Face ID, Touch ID or the
/// passcode, and keeps an opaque cover over the app while it is locked or not
/// in front. ScreenLockState decides when; this carries it out.
///
/// The cover is a window of its own above the app's, so it hides what the
/// app's window presents too: the in-app browser, a share sheet, a preview.
@MainActor
public final class ScreenLock: ObservableObject {
    public static let shared = ScreenLock()

    @Published public private(set) var state: ScreenLockState
    private var isInFront = false
    private let defaults: UserDefaults
    /// Held while an ask is out, so the context lives until it answers.
    private var context: LAContext?
    private var coverWindows: [UIWindow] = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        state = ScreenLockState(lockEnabled: DevicePreferences.screenLock(in: defaults))
    }

    public var isEnabled: Bool {
        DevicePreferences.screenLock(in: defaults)
    }

    /// Whether a link or page action handed in now waits for the lock to open.
    public var holdsLinks: Bool {
        state.wouldBeLocked(at: Date(), lockEnabled: isEnabled)
    }

    /// What this device unlocks with right now.
    public static func method() -> ScreenLockMethod {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return .unavailable }
        // Hardware that is not enrolled still reports its type, and then the
        // passcode is what actually asks.
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return .passcode }
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return .passcode
        }
    }

    public func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            isInFront = true
            if state.becameActive(at: Date(), lockEnabled: isEnabled) { ask() }
        case .background:
            isInFront = false
            state.enteredBackground(at: Date())
        default:
            isInFront = false
        }
        updateCover()
    }

    public func unlockTapped() {
        if state.unlockTapped() { ask() }
        updateCover()
    }

    /// The page's switch. Turning it on asks once, and the switch stays on
    /// only if that succeeds; turning it off needs nothing, since the page is
    /// only reachable with the app open.
    public func setEnabled(_ on: Bool) {
        guard on else {
            defaults.set(false, forKey: DevicePreferences.screenLockKey)
            objectWillChange.send()
            return
        }
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            objectWillChange.send()
            return
        }
        self.context = context
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Turn on the screen lock") { [weak self] succeeded, _ in
            Task { @MainActor in
                guard let self else { return }
                self.context = nil
                if succeeded { self.defaults.set(true, forKey: DevicePreferences.screenLockKey) }
                self.objectWillChange.send()
            }
        }
    }

    private func ask() {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            // The passcode was removed after the lock was turned on, so
            // nothing can ask: the app opens and the switch goes off.
            state.cannotAsk()
            defaults.set(false, forKey: DevicePreferences.screenLockKey)
            objectWillChange.send()
            updateCover()
            return
        }
        self.context = context
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock your mail") { [weak self] succeeded, _ in
            Task { @MainActor in
                guard let self else { return }
                self.context = nil
                self.state.finishedAsking(succeeded: succeeded)
                self.updateCover()
            }
        }
    }

    private func updateCover() {
        guard state.coversContent(isInFront: isInFront, lockEnabled: isEnabled) else {
            for window in coverWindows { window.isHidden = true }
            coverWindows.removeAll()
            return
        }
        guard coverWindows.isEmpty else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            let window = UIWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.rootViewController = UIHostingController(rootView: LockCover(lock: self))
            window.isHidden = false
            coverWindows.append(window)
        }
    }
}

/// What is on screen while the lock is up: the app's name and a way to ask
/// again, and nothing of the mail behind it.
private struct LockCover: View {
    @ObservedObject var lock: ScreenLock

    private var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? ""
    }

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(.secondary)
                Text(appName)
                    .font(.title2.weight(.semibold))
                Button("Unlock") { lock.unlockTapped() }
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}
#endif
```

- [ ] **Step 2: Hold the lock state in the shell**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`, replace:

```swift
    @Environment(\.scenePhase) private var scenePhase

    public init(profile: Profile) {
```

with:

```swift
    @Environment(\.scenePhase) private var scenePhase
    #if canImport(UIKit)
    @ObservedObject private var lock = ScreenLock.shared
    /// Links handed in while the screen lock is up, opened once it opens.
    @State private var heldLinks: [URL] = []
    #endif

    public init(profile: Profile) {
```

- [ ] **Step 3: Route every outside link through the lock**

In the same file, replace:

```swift
    private func handle(_ url: URL) {
```

with:

```swift
    /// A link from outside the page: opened now, or, on iPhone and iPad while
    /// the screen lock is up or about to be, held until it has opened.
    private func route(_ url: URL) {
        #if canImport(UIKit)
        if lock.holdsLinks {
            heldLinks.append(url)
            return
        }
        #endif
        handle(url)
    }

    #if canImport(UIKit)
    /// Opens what waited behind the lock, once the lock has opened.
    private func releaseHeldLinks() {
        guard !lock.holdsLinks else { return }
        let waiting = heldLinks
        heldLinks.removeAll()
        for url in waiting { handle(url) }
        if let action = pendingActions.take() { model.pendingAction = action }
    }
    #endif

    private func handle(_ url: URL) {
```

Replace:

```swift
        .onOpenURL { url in
            handle(url)
        }
```

with:

```swift
        .onOpenURL { url in
            route(url)
        }
```

Replace:

```swift
            guard let target = Continuity.target(of: activity) else { return }
            handle(target)
```

with:

```swift
            guard let target = Continuity.target(of: activity) else { return }
            route(target)
```

- [ ] **Step 4: Tell the lock about the scene, and release what waited**

In the same file, replace:

```swift
            BadgeController.shared.reapply()
            // The push names production; the page is on whichever server is selected
            if let url = pendingLinks.take() { handle(live.backend.rehost(url)) }
            if let action = pendingActions.take() { model.pendingAction = action }
        }
        .onChange(of: scenePhase) {
```

with:

```swift
            BadgeController.shared.reapply()
            // With the lock on, the cover goes up and the app asks, before
            // anything that launched it is opened.
            lock.scenePhaseChanged(scenePhase)
            // The push names production; the page is on whichever server is selected
            if let url = pendingLinks.take() { route(live.backend.rehost(url)) }
            if !lock.holdsLinks, let action = pendingActions.take() { model.pendingAction = action }
        }
        .onChange(of: scenePhase) {
            lock.scenePhaseChanged(scenePhase)
            releaseHeldLinks()
```

Replace (Task 5 added this line):

```swift
        .onChange(of: model.pageURL) {
```

with:

```swift
        .onChange(of: lock.state.isLocked) {
            releaseHeldLinks()
        }
        .onChange(of: model.pageURL) {
```

Replace:

```swift
            if let url = pendingLinks.take() { handle(live.backend.rehost(url)) }
        }
        .onChange(of: pendingActions.name) {
            // A shortcut that asks the page to do something rather than to go
            // somewhere; search, which has no address of its own. The runner
            // holds it until the page can answer.
            if let action = pendingActions.take() { model.pendingAction = action }
        }
```

with:

```swift
            if let url = pendingLinks.take() { route(live.backend.rehost(url)) }
        }
        .onChange(of: pendingActions.name) {
            // A shortcut that asks the page to do something rather than to go
            // somewhere; search, which has no address of its own. The runner
            // holds it until the page can answer, and the lock holds it until
            // it has opened.
            guard !lock.holdsLinks else { return }
            if let action = pendingActions.take() { model.pendingAction = action }
        }
```

The `#else` branch (the Mac's `.onAppear`, `.onChange(of: backendName)` and `.handlesExternalEvents`) is not touched.

- [ ] **Step 5: Give both apps the Face ID usage text**

In `Apps/Personal/Info.plist` and in `Apps/Work/Info.plist`, replace:

```xml
    <key>CFBundleVersion</key>
    <string>1</string>
```

with:

```xml
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>NSFaceIDUsageDescription</key>
    <string>Unlock your mail with Face ID.</string>
```

Run: `cd /Users/mdbraber/src/fastmail-custom && plutil -lint Apps/Personal/Info.plist Apps/Work/Info.plist`

Expected: both `OK`.

- [ ] **Step 6: Read the wiring back**

Run: `cd /Users/mdbraber/src/fastmail-custom && grep -n "handle(" Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`

Expected, and nothing else:
- the `handle(url)` call at the end of `route(_:)`
- `for url in waiting { handle(url) }`
- `private func handle(_ url: URL) {`

Every way in (`onOpenURL`, Handoff, `PendingLinks` at launch and later) now goes through `route`.

- [ ] **Step 7: Build for iOS and run the tests**

Run the iOS package build (see "Commands used in every task"). Expected: `** BUILD SUCCEEDED **`.

Run the Personal app build for iOS, unsigned (see "Commands used in every task"). Expected: `** BUILD SUCCEEDED **`. Then check the built app carries the usage text:

Run: `/usr/libexec/PlistBuddy -c "Print :NSFaceIDUsageDescription" "/Users/mdbraber/src/fastmail-custom/build/ios-app/Build/Products/Debug-iphoneos/mdbraber.com.app/Info.plist"`

Expected: `Unlock your mail with Face ID.`

Run the package tests. Expected: `Test run with 336 tests in 0 suites passed`; this task adds no unit tests.

- [ ] **Step 8: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 336 package tests.

- [ ] **Step 9: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/ScreenLock.swift Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift Apps/Personal/Info.plist Apps/Work/Info.plist
git commit -F - <<'EOF'
feat: the phone's app can lock behind Face ID, with a cover and links that wait for it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---

### Task 7: The Device settings page replaces the sheet

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/AppVersion.swift`
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/DeviceSettingsPage.swift`
- Delete: `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsUI.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsPresenter.swift` (whole file)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift` (the sheet, and the overlay in the `ZStack`)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js:535-536` (comment only)
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/AppVersionTests.swift`

**Interfaces:**
- Consumes:
  - Task 1: `DevicePreferences.rememberPageKey`, `inAppBrowserKey`, `remoteDebuggingKey` and `setRememberPage(_:in:)`
  - Task 4: `WebInspection.apply(to:in:)`
  - Task 6: `ScreenLock.shared`, `ScreenLock.method()`, `isEnabled` and `setEnabled(_:)`
  - existing: `WebViewRegistry.shared.views`, `Backend.allCases`, `.title`, `.host`, `Backend.resolve(_:)`, `StartView.defaultsKey`
- Produces:
  - `AppVersion.text(short:build:) -> String`, `AppVersion.text(infoDictionary:) -> String`, `AppVersion.text(bundle:) -> String`
  - `public struct DeviceSettingsPage: View` with `init(onClose: @escaping () -> Void)` (iOS)
  - `struct BackendSettingsPage: View` (iOS)
  - `SettingsPresenter.close()` (iOS)
  - `SettingsPresenter.open()` keeps its name

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/AppVersionTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

@Test func theVersionReadsAsShortVersionThenBuild() {
    #expect(AppVersion.text(short: "1.0", build: "1") == "1.0 (1)")
    #expect(AppVersion.text(short: " 2.3 ", build: " 45 ") == "2.3 (45)")
}

@Test func aMissingHalfLeavesTheOther() {
    #expect(AppVersion.text(short: "1.0", build: nil) == "1.0")
    #expect(AppVersion.text(short: "1.0", build: "") == "1.0")
    #expect(AppVersion.text(short: nil, build: "7") == "7")
    #expect(AppVersion.text(short: "  ", build: "7") == "7")
    #expect(AppVersion.text(short: nil, build: nil) == "Unknown")
}

@Test func theVersionIsReadFromTheInfoDictionaryKeys() {
    let info: [String: Any] = ["CFBundleShortVersionString": "1.0", "CFBundleVersion": "1"]
    #expect(AppVersion.text(infoDictionary: info) == "1.0 (1)")
    #expect(AppVersion.text(infoDictionary: nil) == "Unknown")
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter AppVersionTests 2>&1 | grep -E "error:" | head -5`

Expected: `error: cannot find 'AppVersion' in scope`.

- [ ] **Step 3: Write the version text**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/AppVersion.swift`:

```swift
import Foundation

/// The version the Device settings page shows, written the way Fastmail's own
/// app writes it: "1.0 (1)".
public enum AppVersion {
    public static func text(short: String?, build: String?) -> String {
        let short = (short ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let build = (build ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        switch (short.isEmpty, build.isEmpty) {
        case (false, false): return "\(short) (\(build))"
        case (false, true): return short
        case (true, false): return build
        case (true, true): return "Unknown"
        }
    }

    public static func text(infoDictionary: [String: Any]?) -> String {
        text(
            short: infoDictionary?["CFBundleShortVersionString"] as? String,
            build: infoDictionary?["CFBundleVersion"] as? String
        )
    }

    public static func text(bundle: Bundle = .main) -> String {
        text(infoDictionary: bundle.infoDictionary)
    }
}
```

Run: `cd /Users/mdbraber/src/fastmail-custom/Packages/FastmailShellKit && swift test --filter AppVersionTests 2>&1 | grep -E "error:|recorded an issue|Test run with"`

Expected: `Test run with 3 tests in 0 suites passed`.

- [ ] **Step 4: Write the pages**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/DeviceSettingsPage.swift`:

```swift
#if canImport(UIKit)
import SwiftUI
import UIKit

/// The Device settings page on iPhone and iPad, reached from the Device
/// settings row in Fastmail's Settings. It lies over the whole screen with the
/// web view still loaded underneath, and every change saves at once.
public struct DeviceSettingsPage: View {
    private let onClose: () -> Void
    @ObservedObject private var lock = ScreenLock.shared
    @AppStorage(StartView.defaultsKey) private var startView = ""
    @AppStorage(DevicePreferences.rememberPageKey) private var rememberPage = false
    @AppStorage(DevicePreferences.inAppBrowserKey) private var inAppBrowser = true
    @State private var method = ScreenLock.method()

    public init(onClose: @escaping () -> Void) {
        self.onClose = onClose
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(method.title, isOn: Binding(
                        get: { lock.isEnabled },
                        set: { lock.setEnabled($0) }
                    ))
                    .disabled(!method.canLock && !lock.isEnabled)
                } footer: {
                    Text(method.footer)
                }

                Section {
                    Toggle("Remember last viewed page", isOn: Binding(
                        get: { rememberPage },
                        set: { DevicePreferences.setRememberPage($0) }
                    ))
                    LabeledContent("Start page") {
                        TextField("Start page", text: $startView, prompt: Text("/mail/Inbox"))
                            .multilineTextAlignment(.trailing)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                    }
                } footer: {
                    Text("Used when Remember last viewed page is off. Empty opens Fastmail's default view.")
                }

                Section {
                    Toggle("Use in-app browser for external links", isOn: $inAppBrowser)
                }

                Section {
                    LabeledContent("Version", value: AppVersion.text())
                }

                Section {
                    NavigationLink("Show Advanced Settings") {
                        BackendSettingsPage()
                    }
                }
            }
            .navigationTitle("Device settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onClose) {
                        Image(systemName: "chevron.backward")
                            .fontWeight(.semibold)
                    }
                    .accessibilityLabel("Back")
                }
            }
        }
        // A passcode set or removed in the Settings app changes what the
        // switch is called and whether it can turn on.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            method = ScreenLock.method()
        }
    }
}

/// Show Advanced Settings: which server the app talks to, and whether Safari's
/// Web Inspector may attach.
struct BackendSettingsPage: View {
    @AppStorage(Backend.defaultsKey) private var backendName = Backend.standard.rawValue
    @AppStorage(DevicePreferences.remoteDebuggingKey) private var remoteDebugging = true

    var body: some View {
        Form {
            Section {
                ForEach(Backend.allCases, id: \.rawValue) { backend in
                    Button {
                        // The web view is keyed on this, so a change reloads
                        // the page on the other server.
                        guard Backend.resolve(backendName) != backend else { return }
                        backendName = backend.rawValue
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(backend.title)
                                    .foregroundStyle(.primary)
                                Text(backend.host)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if Backend.resolve(backendName) == backend {
                                Image(systemName: "checkmark")
                                    .fontWeight(.semibold)
                                    .foregroundStyle(Color.accentColor)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                }
            } header: {
                Text("Server backend")
            } footer: {
                Text("Beta is Fastmail's test server, with its own sign-in and settings. Switching reloads the page and asks you to log in again.")
            }

            Section {
                Toggle("Enable remote debugging", isOn: $remoteDebugging)
            } header: {
                Text("Debugging")
            }
        }
        .navigationTitle("Backend")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: remoteDebugging) {
            WebInspection.apply(to: WebViewRegistry.shared.views)
        }
    }
}
#endif
```

- [ ] **Step 5: The presenter slides the page in and out**

Replace the whole of `Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsPresenter.swift` with:

```swift
import SwiftUI

#if canImport(AppKit)
import AppKit
#endif

@MainActor
public final class SettingsPresenter: ObservableObject {
    public static let shared = SettingsPresenter()

    /// Whether the Device settings page is over the app, on iPhone and iPad.
    @Published public var isPresented = false

    /// The page's Device settings row. On iPhone and iPad it slides the Device
    /// settings page in from the right; on the Mac it opens the Settings window.
    public func open() {
        #if canImport(UIKit)
        withAnimation(.easeInOut(duration: 0.3)) { isPresented = true }
        #else
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        NSApp.activate(ignoringOtherApps: true)
        #endif
    }

    #if canImport(UIKit)
    /// The page's back arrow: it slides out the way it came.
    public func close() {
        withAnimation(.easeInOut(duration: 0.3)) { isPresented = false }
    }
    #endif
}
```

The Mac branch of `open()` is the same two lines as before.

- [ ] **Step 6: The page replaces the sheet in the shell**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`, replace:

```swift
        #if canImport(UIKit)
        .sheet(isPresented: $settings.isPresented) {
            MobileSettingsSheet(profile: profile)
        }
        .onAppear {
```

with:

```swift
        #if canImport(UIKit)
        .onAppear {
```

Replace:

```swift
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.default, value: model.banner)
```

with:

```swift
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            #if canImport(UIKit)
            // Over the whole screen, entering from the right, with the web
            // view still loaded beneath it.
            if settings.isPresented {
                DeviceSettingsPage(onClose: { settings.close() })
                    .transition(.move(edge: .trailing))
                    .zIndex(1)
            }
            #endif
        }
        .animation(.default, value: model.banner)
```

- [ ] **Step 7: Delete the sheet**

Run: `cd /Users/mdbraber/src/fastmail-custom && git rm Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsUI.swift`

- [ ] **Step 8: The harness comment names the page**

In `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`, replace:

```js
        // a fresh icon, a new label, no id to collide, and a click that opens
        // the settings sheet instead of routing to a Fastmail settings pane.
```

with:

```js
        // a fresh icon, a new label, no id to collide, and a click that opens
        // the Device settings page instead of routing to a Fastmail settings pane.
```

The row still posts `openSettings`; nothing else in the harness changes.

- [ ] **Step 9: Check nothing still names the sheet**

Run:
```bash
cd /Users/mdbraber/src/fastmail-custom
git grep -n "MobileSettingsSheet\|settings sheet" -- Packages Apps Tests
node --check Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js
```

Expected: `git grep` prints nothing, and `node --check` passes.

- [ ] **Step 10: Build for iOS and run the tests**

- Run the iOS package build. Expected: `** BUILD SUCCEEDED **`.
- Run the package tests. Expected: `Test run with 339 tests in 0 suites passed`.

- [ ] **Step 11: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 339 package tests. `HarnessTests.testDeviceSettingsOpensShellSettingsWithoutNavigating` still passes: the row still posts `openSettings`.

- [ ] **Step 12: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Packages/FastmailShellKit/Sources/FastmailShellKit/AppVersion.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/AppVersionTests.swift Packages/FastmailShellKit/Sources/FastmailShellKit/DeviceSettingsPage.swift Packages/FastmailShellKit/Sources/FastmailShellKit/SettingsPresenter.swift Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js
git commit -F - <<'EOF'
feat: Device settings is a page on the phone, with a Backend page, replacing the sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

`git rm` in Step 7 already staged the deletion of `SettingsUI.swift`, so it goes into this commit.

---

### Task 8: The settings leave the iOS Settings app

**Files:**
- Delete: `Apps/Personal/Settings.bundle/`, `Apps/Work/Settings.bundle/`, `tools/gen-settings-bundle.py`, `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift`
- Modify: `Makefile:5` and `Makefile:10-15`
- Modify: `project.yml:34`
- Modify: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/BackendTests.swift:25-26` (comment only)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. The `backend` and `startView` keys stay, so saved values carry over. `push.alerts` keeps its stored value, and `PushPreferences` still reads it until plan 3.

- [ ] **Step 1: Write the check (the failing test)**

Run:
```bash
cd /Users/mdbraber/src/fastmail-custom
git grep -n -i "Settings\.bundle\|settings-bundle\|gen-settings-bundle\|SettingsBundle" -- ':!docs/superpowers'
ls -d Apps/Personal/Settings.bundle Apps/Work/Settings.bundle
```

Expected now:
- Matches in `Makefile`, `project.yml`, `BackendTests.swift`, `SettingsBundleTests.swift` and `tools/gen-settings-bundle.py`.
- Both bundle folders listed.

The check fails.

- [ ] **Step 2: Delete the bundles, the generator and their tests**

Run:
```bash
cd /Users/mdbraber/src/fastmail-custom
git rm -r Apps/Personal/Settings.bundle Apps/Work/Settings.bundle tools/gen-settings-bundle.py Packages/FastmailShellKit/Tests/FastmailShellKitTests/SettingsBundleTests.swift
```

- [ ] **Step 3: Remove the Makefile target**

In `Makefile`, replace:

```make
.PHONY: generate test build-macos install-macos forget-builds build-ios install-ios build-extension install-extension install deploy settings-bundle clean
```

with:

```make
.PHONY: generate test build-macos install-macos forget-builds build-ios install-ios build-extension install-extension install deploy clean
```

Then delete these six lines: the comment, the target, its recipe (which starts with a tab) and the blank line after it. They sit between `	xcodegen generate` plus its blank line and `test: generate`.

```make
# Root.plist is generated and checked in; regenerate whenever the shell's
# own settings (backend, start page, alerts switch) change, or `make test`
# fails on the parity guard
settings-bundle:
	python3 tools/gen-settings-bundle.py

```

Afterwards the file reads `generate:`, `	xcodegen generate`, a blank line, then `test: generate`.

- [ ] **Step 4: Remove the project.yml entry**

In `project.yml`, under `targetTemplates: ShellApp: settings: base:`, delete this line:

```yaml
        "EXCLUDED_SOURCE_FILE_NAMES[sdk=macosx*]": Settings.bundle
```

- [ ] **Step 5: Reword the test comment that named the bundle**

In `Packages/FastmailShellKit/Tests/FastmailShellKitTests/BackendTests.swift`, replace:

```swift
// Settings.bundle writes this key as a plain string, so an unknown value is
// something that can genuinely arrive rather than a case that cannot happen
```

with:

```swift
// The key is a plain string in defaults, left there by an older build or
// written by hand, so an unknown value can genuinely arrive rather than
// being a case that cannot happen
```

- [ ] **Step 6: Run the check to verify it passes**

Run the two commands from Step 1 again.

Expected:
- `git grep` prints nothing.
- `ls` reports `No such file or directory` for both folders.

`PushPreferences.swift:6` still says "Shared with the Settings bundle and the in-app sheet". It is plan 3's file and does not match this pattern; leave it.

- [ ] **Step 7: Regenerate the project and build the app for iOS**

The Xcode project is git-ignored and made by xcodegen, so removing the folders needs only a regenerate, which the build command's `make generate` does. Anyone with the project open in Xcode runs `make generate` once after pulling.

Run the Personal app build for iOS, unsigned (see "Commands used in every task"). Expected: `** BUILD SUCCEEDED **`.

Run: `ls /Users/mdbraber/src/fastmail-custom/build/ios-app/Build/Products/Debug-iphoneos/mdbraber.com.app | grep -c "Settings.bundle"`

Expected: `0`.

If a Settings.bundle from an earlier build is still in the product folder, delete `build/ios-app` and build again before reading the count.

- [ ] **Step 8: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, `Test run with 335 tests in 0 suites passed`.

- [ ] **Step 9: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Makefile project.yml Packages/FastmailShellKit/Tests/FastmailShellKitTests/BackendTests.swift
git commit -F - <<'EOF'
refactor: the shell's settings leave the iOS Settings app, with their generator and tests

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

The deletions from Step 2 were staged by `git rm` and go into this commit.

---

### Task 9: The whole suite, the Mac unchanged, and the user's checks on iPhone and iPad

**Files:** none. This task changes nothing; it confirms what Tasks 1-8 built.

**Interfaces:**
- Consumes: everything above, and BASE from Task 1.
- Produces: a recorded pass, or a list of defects to fix before the work is called done.

- [ ] **Step 1: Run the whole suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`

Expected: exit 0, `** TEST SUCCEEDED **`, 335 package tests, `npm test` passing in `Server/`, and every `node --check` passing.

- [ ] **Step 2: Show the Mac is untouched**

Run (put Task 1's hash in place of BASE):
```bash
cd /Users/mdbraber/src/fastmail-custom
git diff --stat BASE..HEAD -- Apps/Shared/SettingsView.swift Apps/Personal/PersonalApp.swift Apps/Work/WorkApp.swift Packages/FastmailShellKit/Sources/FastmailShellKit/ComposePool.swift Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer+macOS.swift Packages/FastmailShellKit/Sources/FastmailShellKit/WebInspector.swift Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift
git diff BASE..HEAD -- Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift | grep -E "^[-+].*(ComposeWindows|NotificationPresenter|TabSwitcher|handlesExternalEvents|NSWorkspace)"
git diff --stat BASE..HEAD -- Packages/FastmailShellKit/Sources/FastmailShellKit/PushPreferences.swift Packages/FastmailShellKit/Sources/FastmailShellKit/PushConfig.swift Packages/FastmailShellKit/Sources/FastmailShellKit/PushRegistrar.swift
```

Expected: all three print nothing. If a file does show a change, run `git log --oneline BASE..HEAD -- <file>`. Name the commit in the report: it must belong to another session, not this plan.

The Mac's own guarantees are also in the suite:
- `theMacsMainWebViewStaysInspectable`
- `theMacsWebViewsStayInspectableWhateverIsStored`
- `onTheMacApplyingTheSwitchLeavesViewsInspectable`

- [ ] **Step 3: Check the contract names**

Run:
```bash
cd /Users/mdbraber/src/fastmail-custom
grep -n "public enum DevicePreferences\|screenLockKey = \"device.screenLock\"\|rememberPageKey = \"device.rememberPage\"\|lastPageKey = \"device.lastPage\"\|inAppBrowserKey = \"device.inAppBrowser\"\|remoteDebuggingKey = \"device.remoteDebugging\"" Packages/FastmailShellKit/Sources/FastmailShellKit/DevicePreferences.swift
grep -n "onOpenSettings: { SettingsPresenter.shared.open() }" Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift
grep -n "post('openSettings'" Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js
```

Expected: six lines from the first command, and one line from each of the other two.

- [ ] **Step 4: Say what cannot be checked from the Mac**

There is no way to drive or inspect the iPhone or iPad user interface from this Mac. The Mac app's web view is the only thing a probe reaches. This plan does not change what the Mac app does, so there is no live probe to run.

Report this plainly. Every check below needs the user's hands on a device, and none of them may be reported as passed until the user says so.

- [ ] **Step 5: Ask the user before installing, and stop**

Ask the user whether to install. State each of the following:
- **iPhone:** `make install-ios DEVICE=68584880-5010-5FD9-B899-FBCB5273FA46` installs Personal, Work and Mailto.
- **iPad:** a bare `make install-ios` lands there, because it picks the first device listed.
- **The Mac** needs no install for this plan.
- **Alerts, until plan 3 lands:** the iPhone and iPad have no alerts switch anywhere.
  - This plan removes the Settings bundle, whose "Notify for new mail" row was the only one. The old sheet never had one.
  - Each app keeps whatever `push.alerts` value it has now.
  - Installing plan 1 on its own is the user's informed choice.

Stop here until the user answers. If an install is refused, record that its checks are outstanding and do not report them as passed.

- [ ] **Step 6: Give the user the checks, and record the answers**

After an install the user agreed to, give the user this list for the iPhone and for the iPad:

1. **The page.**
   - In Fastmail's Settings, "Device settings" still sits between Custom mode and Offline.
   - Tapping it slides the page in from the right over the whole screen, titled "Device settings".
   - The rows are in order: the lock switch, Remember last viewed page and Start page, Use in-app browser, Version, Show Advanced Settings.
   - The version reads like "1.0 (1)".
   - The back arrow at the top left slides it out to the right, back onto Fastmail's Settings, with the page underneath as it was.
2. **The Backend page.**
   - Show Advanced Settings pushes it with its own back arrow, and a swipe from the left edge also goes back.
   - Production with `app.fastmail.com` and Beta with `app.beta.fastmail.com` are listed, with the checkmark on the one in use.
   - Choosing the other reloads the app on that server; choose the original again afterwards.
   - Enable remote debugging is on. Turned off, Safari's Develop menu on the Mac no longer lists the device's page. Turned on again, it does. No relaunch is needed either way.
3. **The lock.**
   - The switch is named for the device (Face ID, Touch ID or Passcode). Turning it on asks once, and cancelling leaves it off.
   - With it on, quitting and relaunching shows the cover (app name and Unlock) and asks. Cancelling keeps the cover, and Unlock asks again.
   - The app switcher's snapshot shows the cover, not mail.
   - Away for more than a minute: coming back asks.
   - Away for less than a minute: coming back removes the cover without asking.
   - While locked, tapping a mail notification opens that message only after unlocking.
4. **The in-app browser.**
   - With the switch on, a link in a message to an outside website opens in an in-app browser with a Done button.
   - A `mailto:` or `tel:` link still goes to the system.
   - With the switch off, the website opens in Safari.
5. **The last page.**
   - With Remember last viewed page on, open a message or another mailbox, quit the app from the switcher and relaunch: it opens there.
   - Turn the switch off and relaunch: it opens the Start page, or Fastmail's default view when the Start page is empty.

Record each answer and name the device it came from. A failed check is a defect: fix it, then have the user check again before calling it passed.

---

## Self-review

**Spec coverage (Part 1 and its tests):**

| Spec requirement | Where |
|---|---|
| Row keeps its place; tapping opens the page; `openSettings` kept | Task 7 (presenter, overlay, harness comment only); Task 9 Step 3 |
| Enters from the right over the whole screen; title; back arrow returns the same way; web view stays loaded | Task 7 Steps 5-6 |
| Backend page pushed with its own back arrow and edge swipe | Task 7 Step 4 (`NavigationLink` in a `NavigationStack`) |
| Main page rows, order, footers, version text; every change saves at once | Task 7 Step 4; version rule Task 7 Steps 1-3 |
| Server backend rows, checkmark, reload on change, Beta footer | Task 7 Step 4 (`backendName` keys the web view, unchanged) |
| Remote debugging on by default; applies to open and later views; Mac stays inspectable | Task 4; Task 7 Step 4 (`WebInspection.apply`) |
| Lock: `deviceOwnerAuthentication`, stays on only on success, no-passcode footer | Task 6 Step 1 (`setEnabled`); Task 2 (`ScreenLockMethod`) |
| Asks at launch and after more than 60 s; cover while asking and whenever not in front; within 60 s no ask; failure keeps cover, Unlock asks again | Task 2 (rules and tests); Task 6 (wiring) |
| Passcode removed: app opens and switch turns off | Task 2 `cannotAsk`; Task 6 `ask()` |
| Links waiting behind the lock (notification, shortcut, link) | Task 2 `wouldBeLocked`; Task 6 Steps 3-4 |
| `NSFaceIDUsageDescription` in both apps | Task 6 Step 5 |
| Remember: save path only, known hosts only, not login or compose, switch off deletes | Task 1; Task 5 Step 5 |
| Launch order and saved path on the current backend | Task 1 (`launchURL`); Task 5 Step 5 |
| In-app browser for http/https when on; other schemes and the other app to the system; downloads unchanged; off means `UIApplication.shared.open` | Task 3 |
| Settings bundle, generator, Makefile target, `project.yml` entry, tests removed; `backend` and `startView` kept | Task 8 |
| `MobileSettingsSheet` and the sheet in `AppShell` replaced | Task 7 |
| Swift tests: lock rule, last page, launch order, external-link decision, version text | Tasks 2, 1, 1, 3, 7 |
| `make test` stays green | Every task |
| iPhone and iPad checks for Part 1 | Task 9 Step 6 |

Additions the spec does not spell out, and why:
- **Task 5's pusher change.** Saving the page is a defaults write, and without the change each one would make the page apply its settings again.
- **The cover as its own window.** It also hides what the app's window presents: the in-app browser, share sheets and previews.
- **`holdsLinks` looks ahead.** It holds a link while the app is still in the background and about to lock, not only once it is locked.

**Placeholder scan.** Every code step carries its complete code, and every edit gives the exact text to replace and its replacement. No step says "similar to" another.

**Type consistency.** These names are spelled the same in every task:
- `DevicePreferences` and its five keys and readers, `setRememberPage(_:in:)`, `rememberablePath(of:)`, `recordPage(_:in:)`, and `Profile.launchURL(readingFrom:)`
- `ScreenLockState` with `becameActive(at:lockEnabled:)`, `enteredBackground(at:)`, `unlockTapped()`, `finishedAsking(succeeded:)`, `cannotAsk()`, `wouldBeLocked(at:lockEnabled:)` and `coversContent(isInFront:lockEnabled:)`
- `ScreenLockMethod` with `title`, `canLock` and `footer`
- `ScreenLock` with `shared`, `state`, `isEnabled`, `holdsLinks`, `method()`, `scenePhaseChanged(_:)`, `unlockTapped()` and `setEnabled(_:)`
- `ExternalLinks` with `destination(for:inAppBrowser:)` and `open(_:defaults:)`, and `ExternalLinkDestination`
- `WebInspection` with `isAllowed(isMac:remoteDebugging:)`, `isAllowed(in:)` and `apply(to:in:)`
- `CustomModeSettingsPusher` with `shouldPush(_:after:force:)` and `pageLoaded()`
- `AppVersion.text(short:build:)`, `AppVersion.text(infoDictionary:)` and `AppVersion.text(bundle:)`
- `DeviceSettingsPage(onClose:)`, `BackendSettingsPage`, and `SettingsPresenter.open()` / `close()`

## Notes for the controller

Each note is a ruling the spec does not settle, with its cost if wrong.

1. **The contract speaks of `MobileSettingsSheet`'s "alerts toggle"; the sheet has none.**
   - It holds only the backend picker and the Start page. The phone's only alerts switch is the Settings bundle's `push.alerts` row.
   - So after Task 8 the phone has no way to change alerts until plan 3. Task 9 tells the user.
   - This is the only place I found the contract and the code disagree, and nothing here depends on it.
2. **The settings pusher now pushes only what the page does not already have** (Task 5).
   - **Why.** Writing `device.lastPage` on each page change would otherwise make the userscript re-apply its settings every time a message opens: it drops caches, rebuilds groupings and re-asks for counts.
   - **The Mac.** This applies there too, but only identical re-pushes into the same document are skipped. A new document resets it, and coming to the front still forces a push.
   - **Cost if wrong.** If something relied on an identical re-push, a page could keep stale Custom mode state until the next real change.
   - **Alternative.** Save the page only on backgrounding, which contradicts "each time it changes".
3. **Which addresses are saved.** Only paths whose first segment is one of Fastmail's views are saved: `mail`, `calendar`, `contacts`, `notes`, `files`, `settings`. Any path with a `compose` segment is refused.
   - **Why.** The login page's path was not measured, and an allowlist refuses it whatever it is. On iOS compose is written in the main web view, and a saved compose address would open an empty draft at each launch.
   - **Cost if wrong.** A real Fastmail view under another first segment is not remembered. A mailbox literally named `compose` is not remembered either.
4. **The lock cover is a separate `UIWindow` at `.alert + 1`.**
   - It hides what the app's window presents (the in-app browser, share sheets, alerts, previews).
   - The keyboard window may still show above it.
   - It also appears whenever the scene is merely inactive with the lock on: Control Center, the notification permission prompt at first launch.
   - **Cost if wrong.** A brief cover where the user did not expect one. A SwiftUI overlay alone would leave presented controllers visible in the app switcher.
5. **Copy and small rulings the spec leaves open:**
   - the no-passcode footer text, "Set a passcode for this device in the Settings app first."
   - "Optic ID" as a fourth switch title
   - the Backend page title "Backend"
   - no footer under Debugging
   - a lock symbol on the cover
   - the back arrow as a chevron labelled "Back"
   - dropping the old sheet's resolved-address line under Start page
   - a lock whose device reports `canEvaluatePolicy` false for any reason is treated as "passcode removed": the app opens and the switch goes off
   - the grace period is measured with the wall clock (`Date`)
6. **Smaller points, each cheap to change:**
   - **The launch link.** Launch order step 1 (a link the app was launched with) stays as today: it is routed after the first load and replaces it. `launchURL` and its test cover steps 2-4.
   - **Where the page is saved.** In `AppShell` (`onChange(of: model.pageURL)`), not in `WebCoordinator` as the spec's "Changes" list says. `PageWatcher`'s URL observation is what sees Fastmail's pushState steps.
   - **Compose views.** "Compose web views" exist only on the Mac, whose `ComposeWindows` keeps `isInspectable = true`. On iOS the switch governs the main web view, which is where compose happens.
   - **Universal links.** With the in-app browser on (the default, live from Task 3), an https link claimed by another app (a YouTube link, say) opens in the in-app browser instead of that app.
   - **Held links.** When several links wait behind the lock, each is routed on unlock, so the last one wins.
   - **Home shortcuts.** `PushRegistrar.defaultsChanged` still rebuilds the home shortcuts on every saved page. The contract keeps this plan out of `PushRegistrar`; it is cheap, and plan 3 may gate it.
   - **Stale comments left for other plans.** `PushPreferences.swift:6` ("Shared with the Settings bundle and the in-app sheet"), `PushRegistrar.swift:22` ("flipped in the sheet or in the Settings app"), and `Server/README.md:43` ("turned alerts off in the Settings app").
