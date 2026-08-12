# Start View Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each app open to a view the user chooses — a folder, a tag, or a search — instead of always landing on the default mailbox.

**Architecture:** One `String` in `UserDefaults` under the key `startView`, resolved to a URL by a pure function in the package. iOS exposes it through a `Settings.bundle`, so it appears in the system Settings app and needs no in-app chrome. macOS exposes it through SwiftUI's `Settings` scene, which gets ⌘, for free. Both apps read the same key; because they have different bundle identifiers, each profile keeps its own value automatically.

**Tech Stack:** Swift 6, SwiftUI, `UserDefaults`, `Settings.bundle` (iOS), `Settings` scene (macOS), Swift Testing.

## Global Constraints

- No code comments. Ship bare code.
- Swift 6 strict concurrency. No `@unchecked Sendable`, no `nonisolated(unsafe)`.
- No third-party dependencies.
- Never add `WKAppBoundDomains` to any Info.plist.
- No account identifier, team ID, email address or message subject in any tracked file.
- Package tests use Swift Testing (`@Test`/`#expect`); `Tests/IntegrationTests` uses XCTest.
- `isInspectable = true` is intentional; preserve it.
- The resolved URL MUST be on `app.fastmail.com`. This setting is user-editable input that determines what origin the shell loads, injects the user script into, and accepts bridge messages from. Anything that does not resolve to that host falls back to the default.

---

### Task 1: Resolve the setting to a URL

The whole of the logic, with no platform code, so it can be tested directly.

The setting is the URL to load. Whatever the user pastes is what the app opens,
provided it is an `https` URL on `app.fastmail.com`. Anything else falls back to
the profile's default. There is no path-fragment shorthand: one field, one
meaning, and what you type is what you get.

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/StartView.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Profile.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/StartViewTests.swift`

**Interfaces:**
- Consumes: `Profile.startURL`
- Produces: `StartView.defaultsKey: String`; `StartView.resolve(_ raw: String?, default fallback: URL) -> URL`; `Profile.startURL(readingFrom: UserDefaults) -> URL`

- [ ] **Step 1: Write the failing tests**

```swift
import Foundation
import Testing
@testable import FastmailShellKit

private let fallback = URL(string: "https://app.fastmail.com/")!

@Test func emptyOrMissingFallsBack() {
    #expect(StartView.resolve(nil, default: fallback) == fallback)
    #expect(StartView.resolve("", default: fallback) == fallback)
    #expect(StartView.resolve("   ", default: fallback) == fallback)
}

@Test func aFastmailURLIsUsedAsIs() {
    let raw = "https://app.fastmail.com/mail/search:from%3Aboss"
    #expect(StartView.resolve(raw, default: fallback) == URL(string: raw)!)
}

@Test func aURLKeepsItsQueryAndFragment() {
    let raw = "https://app.fastmail.com/mail/Inbox?u=abc#thread"
    #expect(StartView.resolve(raw, default: fallback) == URL(string: raw)!)
}

@Test func surroundingWhitespaceIsTolerated() {
    let raw = "https://app.fastmail.com/mail/Archive"
    #expect(StartView.resolve("  \(raw)  ", default: fallback) == URL(string: raw)!)
}

@Test func aBareViewNameIsNotAURLAndFallsBack() {
    #expect(StartView.resolve("Inbox", default: fallback) == fallback)
    #expect(StartView.resolve("/mail/Inbox", default: fallback) == fallback)
    #expect(StartView.resolve("app.fastmail.com/mail/Inbox", default: fallback) == fallback)
}

@Test func aURLOnAnotherHostFallsBack() {
    #expect(StartView.resolve("https://evil.example/mail/Inbox", default: fallback) == fallback)
    #expect(StartView.resolve("https://www.fastmail.com/help/", default: fallback) == fallback)
    #expect(StartView.resolve("https://app.fastmail.com.evil.example/", default: fallback) == fallback)
}

@Test func aNonHTTPSSchemeFallsBack() {
    #expect(StartView.resolve("http://app.fastmail.com/mail/Inbox", default: fallback) == fallback)
    #expect(StartView.resolve("javascript:alert(1)", default: fallback) == fallback)
    #expect(StartView.resolve("file:///etc/passwd", default: fallback) == fallback)
}

@Test func hostComparisonIsCaseInsensitiveButRejectsATrailingDot() {
    #expect(StartView.resolve("https://APP.FASTMAIL.COM/mail/Inbox", default: fallback)
        == URL(string: "https://APP.FASTMAIL.COM/mail/Inbox")!)
    #expect(StartView.resolve("https://app.fastmail.com./mail/Inbox", default: fallback) == fallback)
}

@Test func aValueThatCannotBecomeAURLFallsBack() {
    #expect(StartView.resolve("\u{2028}\u{FFFF}", default: fallback) == fallback)
}

@Test func profileReadsTheSettingFromDefaults() {
    let defaults = UserDefaults(suiteName: "start-view-test")!
    defaults.removePersistentDomain(forName: "start-view-test")
    let profile = Profile.personal(accountID: nil)
    #expect(profile.startURL(readingFrom: defaults) == profile.startURL)
    defaults.set("https://app.fastmail.com/mail/Archive", forKey: StartView.defaultsKey)
    #expect(profile.startURL(readingFrom: defaults)
        == URL(string: "https://app.fastmail.com/mail/Archive")!)
    defaults.removePersistentDomain(forName: "start-view-test")
}
```

The trailing-dot case falls back rather than resolving, deliberately: `NavigationPolicy` strips a trailing dot but `ScriptInjector` and `NativeBridge` compare exactly, so `app.fastmail.com.` is a host on which the shell loads the page but the user script never runs and the bridge rejects every message. Refusing it here keeps the setting from steering the user into that state.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `cannot find 'StartView' in scope`.

- [ ] **Step 3: Implement**

Create `StartView.swift`:

```swift
import Foundation

public enum StartView {
    public static let defaultsKey = "startView"

    static let host = "app.fastmail.com"

    public static func resolve(_ raw: String?, default fallback: URL) -> URL {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == host
        else { return fallback }
        return url
    }
}
```

In `Profile.swift`, add:

```swift
public func startURL(readingFrom defaults: UserDefaults) -> URL {
    StartView.resolve(defaults.string(forKey: StartView.defaultsKey), default: startURL)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Packages
git commit -m "feat: resolve a configurable start view to a URL"
```

---

### Task 2: Expose it on both platforms

**Files:**
- Create: `Apps/Personal/Settings.bundle/Root.plist`
- Create: `Apps/Work/Settings.bundle/Root.plist`
- Create: `Apps/Shared/SettingsView.swift`
- Modify: `Apps/Personal/PersonalApp.swift`
- Modify: `Apps/Work/WorkApp.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`
- Modify: `project.yml`

**Interfaces:**
- Consumes: `StartView.defaultsKey`, `Profile.startURL(readingFrom:)`
- Produces: `SettingsView(profile:)`

- [ ] **Step 1: The iOS Settings bundle**

`Root.plist` for each app, identical apart from nothing — the two apps have different bundle identifiers, so they get separate `UserDefaults` domains and separate values with no extra work:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PreferenceSpecifiers</key>
    <array>
        <dict>
            <key>Type</key>
            <string>PSGroupSpecifier</string>
            <key>FooterText</key>
            <string>The full address to open, for example https://app.fastmail.com/mail/Archive. Must be on app.fastmail.com. Leave empty for the default view. Takes effect next time the app starts.</string>
        </dict>
        <dict>
            <key>Type</key>
            <string>PSTextFieldSpecifier</string>
            <key>Title</key>
            <string>Start URL</string>
            <key>Key</key>
            <string>startView</string>
            <key>DefaultValue</key>
            <string></string>
            <key>IsSecure</key>
            <false/>
            <key>KeyboardType</key>
            <string>URL</string>
            <key>AutocapitalizationType</key>
            <string>None</string>
            <key>AutocorrectionType</key>
            <string>No</string>
        </dict>
    </array>
</dict>
</plist>
```

Add the bundle to each iOS target's resources in `project.yml`. Confirm `Key` matches `StartView.defaultsKey` exactly — a typo here fails silently, which is the defect class this project has fought repeatedly, so assert it in a test rather than trusting the string.

- [ ] **Step 2: The macOS settings screen**

`SettingsView.swift`, shared by both apps:

```swift
import SwiftUI
import FastmailShellKit

struct SettingsView: View {
    let profile: Profile
    @AppStorage(StartView.defaultsKey) private var startView = ""

    var body: some View {
        Form {
            TextField("Start URL", text: $startView, prompt: Text("https://app.fastmail.com/mail/Inbox"))
                .textFieldStyle(.roundedBorder)
            Text(resolved)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Text("The full address to open. Must be on app.fastmail.com. Leave empty for the default view. Takes effect in new windows.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(width: 460)
    }

    private var resolved: String {
        StartView.resolve(startView, default: profile.startURL).absoluteString
    }
}
```

Showing the resolved URL live is the point of this screen: it is how the user sees that a value was rejected and fell back, rather than discovering it at the next launch.

- [ ] **Step 3: Wire both apps**

In `PersonalApp.swift` and `WorkApp.swift`, add the scene alongside the existing `WindowGroup`:

```swift
#if os(macOS)
Settings {
    SettingsView(profile: profile)
}
#endif
```

Hoist the profile into a stored property so both scenes use the same value rather than constructing it twice.

- [ ] **Step 4: Use the setting when loading**

In `AppShell.swift`, pass `profile.startURL(readingFrom: .standard)` where `profile.startURL` is used to load. Do NOT change what `ScriptInjector`'s config-time match or `NativeBridge`'s `expectedHost` are given — those must stay bound to the profile's fixed host, not to user-editable input. This is the security boundary of the whole feature: the setting chooses a path, never an origin.

- [ ] **Step 5: Test the wiring**

```swift
@Test func settingsBundleKeyMatchesTheDefaultsKey() throws {
    for app in ["Personal", "Work"] {
        let url = URL(fileURLWithPath: "Apps/\(app)/Settings.bundle/Root.plist")
        let data = try Data(contentsOf: url)
        let plist = try #require(
            try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        )
        let specifiers = try #require(plist["PreferenceSpecifiers"] as? [[String: Any]])
        let keys = specifiers.compactMap { $0["Key"] as? String }
        #expect(keys.contains(StartView.defaultsKey))
    }
}
```

Run this from the repo root so the relative paths resolve, or resolve them from `#filePath`.

- [ ] **Step 6: Verify**

Build and install both platforms. On iOS, open Settings, find the app, set `https://app.fastmail.com/mail/Archive`, relaunch, confirm it opens there. Set a deliberately bad value such as `https://evil.example/` and confirm the app falls back to the default rather than loading it. On macOS, press ⌘, and confirm the resolved URL updates as you type and that a new window opens to it.

- [ ] **Step 7: Commit**

```bash
git add Apps project.yml Packages
git commit -m "feat: let each app open to a configurable start view"
```
