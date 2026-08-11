# Fastmail Shell Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four installable apps — personal and work, iOS and macOS — that load `app.fastmail.com` in a `WKWebView` and run the existing Inbox mode user script inside it.

**Architecture:** A local Swift package, `FastmailShellKit`, holds everything platform-agnostic: profile configuration, user script metadata parsing, bundle-backed script loading, bootstrap assembly, and navigation policy. Two multiplatform Xcode app targets are thin wrappers that instantiate one `Profile` each. The user script is copied into each app bundle by a build phase and evaluated by a bundled JavaScript harness at the time its metadata asks for, in the page content world.

**Tech Stack:** Swift 6, SwiftUI, WebKit, Swift Testing for package tests, XCTest for the WebKit integration target, XcodeGen for project generation, Make for build and install.

## Global Constraints

- **No code comments.** Ship bare code. Reasoning belongs in commit messages and the spec, not in the source.
- **No third-party runtime dependencies** in the package or the apps. XcodeGen and Make are build-time tools only.
- Deployment targets: **iOS 17.0**, **macOS 14.0**. Swift language version **6**.
- Bundle identifiers, exactly: `com.mdbraber.fastmail.personal` and `com.mdbraber.fastmail.work`.
- **Never commit account identifiers.** They live in `Config/Local.xcconfig`, which is gitignored. `Config/Local.xcconfig.example` carries placeholders only. No real `u=` value may appear in any committed file, including tests and fixtures.
- **Do not add `WKAppBoundDomains`** to any Info.plist. It disables script injection, custom stylesheets, and message handlers.
- The user script and harness run in **`WKContentWorld.page`**. The script requires `window.FastMail`, which an isolated world cannot see. Message handlers must be registered with `addScriptMessageHandler(_:contentWorld:name:)` against `WKContentWorld.page` for the same reason.
- Allowed navigation hosts, exactly: `fastmail.com` and `fastmailusercontent.com`, plus their subdomains. Subdomain matching must require a leading dot so `notfastmail.com` is refused.
- Source of the user script: `~/src/fastmail-customized/fastmail-inbox-mode.user.js`, referenced through the `USERSCRIPT_PATH` build setting and never copied into this repository.

---

## File Structure

| Path | Responsibility |
|---|---|
| `project.yml` | XcodeGen definition: two multiplatform app targets, integration test target, aggregate scheme |
| `Makefile` | generate, test, build, install for both platforms |
| `Config/Shared.xcconfig` | Committed build settings; optionally includes `Local.xcconfig` |
| `Config/Local.xcconfig.example` | Placeholder template for the gitignored real file |
| `tools/copy-userscript.sh` | Build phase: validate and copy the user script into the bundle |
| `tools/extract-icons.swift` | Renders app icons from the existing macOS web apps into asset catalogs |
| `Packages/FastmailShellKit/Sources/FastmailShellKit/Profile.swift` | Per-app configuration value type |
| `.../UserScriptMetadata.swift` | Parsed representation of a user script metadata block |
| `.../MetadataParser.swift` | Parses `==UserScript==` blocks |
| `.../ScriptStore.swift` | Loads harness, user script, and overlay from a resource loader |
| `.../ScriptInjector.swift` | Builds the harness/user-script/overlay `WKUserScript`s: `@match` gate, `@run-at` mapping, per-document match re-check, try/catch guard |
| `.../NavigationPolicy.swift` | Decides allow / open externally / download |
| `.../NativeBridge.swift` | `WKScriptMessageHandlerWithReply` for `log` and `error` |
| `.../WebCoordinator.swift` | `WKNavigationDelegate` and `WKUIDelegate` |
| `.../WebContainer.swift` | Cross-platform representable, with `+iOS` and `+macOS` variants |
| `.../AppShell.swift` | Root SwiftUI view: web view plus error banner |
| `.../Resources/harness.js` | Bootstrap, run-at scheduling, route hooks, error capture |
| `Apps/Personal/`, `Apps/Work/` | `@main` entry points, Info.plist, asset catalogs |
| `Tests/IntegrationTests/` | WebKit-backed tests with a local fixture |

---

### Task 1: Spike — verify Fastmail runs in a bare `WKWebView`

The whole project rests on assumptions that cost minutes to check and days to discover late. This task builds a throwaway app, answers the questions, and commits the findings. Nothing else starts until it passes.

**Files:**
- Create: `/tmp/fmspike/main.swift` (throwaway, not committed)
- Create: `docs/superpowers/spike-findings.md`

- [ ] **Step 1: Write the spike app**

Create `/tmp/fmspike/main.swift`:

```swift
import AppKit
import WebKit

final class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        let probe = """
        window.__spike = {
            hasFastMail: typeof window.FastMail !== 'undefined',
            ua: navigator.userAgent,
            sw: 'serviceWorker' in navigator
        };
        """
        config.userContentController.addUserScript(
            WKUserScript(source: probe, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        webView = WKWebView(frame: .zero, configuration: config)
        webView.isInspectable = true
        webView.navigationDelegate = self
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1200, height: 900),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: URL(string: "https://app.fastmail.com")!))
    }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.run()
```

- [ ] **Step 2: Run it**

```bash
cd /tmp/fmspike && swiftc -o fmspike main.swift && ./fmspike
```

Expected: a window opens showing the Fastmail login page.

- [ ] **Step 3: Log in and answer the questions**

Log in with password and TOTP. Then open Safari → Develop → your Mac → the spike web view, and in the console run:

```javascript
window.__spike
document.querySelector('.v-Thread-title h1')
document.querySelectorAll('.v-Menu').length
navigator.serviceWorker.controller
```

Open a message, then open its actions menu (the one containing "Show details") and run:

```javascript
Array.from(document.querySelectorAll('.v-Menu'))
  .filter(m => m.offsetParent !== null)
  .map(m => Array.from(m.querySelectorAll('li.v-MenuOption')).map(li => li.textContent.trim()))
```

Also check whether a share icon exists in the sprite:

```javascript
Array.from(document.querySelectorAll('svg.v-Icon'))
  .map(s => s.getAttribute('class'))
  .filter((v, i, a) => a.indexOf(v) === i)
  .filter(c => /share|export|link/i.test(c))
```

- [ ] **Step 4: Record the findings**

Create `docs/superpowers/spike-findings.md` with the answers, one heading each:

```markdown
# Spike findings — 2026-08-11

## Login
Password plus TOTP in a bare WKWebView: PASS / FAIL, with notes.

## window.FastMail
Present: yes / no. Keys observed: store, classes, router, getViewFromNode.

## Service workers
navigator.serviceWorker.controller: value. Any visible degradation: notes.

## Subject selector
.v-Thread-title h1 resolves to the subject: yes / no.
Fallback .v-MailboxItem.is-focused .v-MailboxItem-subject: yes / no.

## Actions menu
Menu containing "Show details" identified by: contents / other.
Visible .v-Menu count while open: number.

## Share icon
Existing sprite class, or "none — inline an SVG path".

## User agent
Verbatim string.
```

- [ ] **Step 5: Gate**

If login fails, or `window.FastMail` is absent, **stop and report**. The remaining tasks assume both.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/spike-findings.md
git commit -m "docs: record WKWebView spike findings"
```

---

### Task 2: Repository scaffolding and project generation

**Files:**
- Create: `project.yml`, `Makefile`, `Config/Shared.xcconfig`, `Config/Local.xcconfig.example`, `tools/copy-userscript.sh`
- Modify: `.gitignore`
- Create: `Apps/Personal/Info.plist`, `Apps/Work/Info.plist`, `Apps/Personal/PersonalApp.swift`, `Apps/Work/WorkApp.swift`
- Create: `Packages/FastmailShellKit/Package.swift`, `Packages/FastmailShellKit/Sources/FastmailShellKit/Placeholder.swift`

**Interfaces:**
- Consumes: nothing
- Produces: a generated `FastmailShell.xcodeproj` with targets `Personal` and `Work`, both building for iOS and macOS; `make generate`, `make build-macos`

- [ ] **Step 1: Write the package manifest**

Create `Packages/FastmailShellKit/Package.swift`:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FastmailShellKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FastmailShellKit", targets: ["FastmailShellKit"])
    ],
    targets: [
        .target(
            name: "FastmailShellKit",
            resources: [.copy("Resources/harness.js")]
        ),
        .testTarget(
            name: "FastmailShellKitTests",
            dependencies: ["FastmailShellKit"]
        )
    ]
)
```

- [ ] **Step 2: Add a placeholder source and the harness resource**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/Placeholder.swift`:

```swift
public enum FastmailShellKit {
    public static let version = "0.1.0"
}
```

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`:

```javascript
(function () {
    window.__fmshell = { version: '0.1.0' };
})();
```

- [ ] **Step 3: Create the test directory and verify the package builds**

`Package.swift` declares a test target, and SwiftPM treats a declared target with no directory as a hard "overlapping sources" error rather than a warning, so the directory must exist before the package will build:

```bash
mkdir -p Packages/FastmailShellKit/Tests/FastmailShellKitTests
```

Run: `cd Packages/FastmailShellKit && swift build`
Expected: `Build complete!`

- [ ] **Step 4: Write the xcconfig files**

Create `Config/Shared.xcconfig`:

```
SWIFT_VERSION = 6.0
CODE_SIGN_STYLE = Automatic
USERSCRIPT_PATH = $(SRCROOT)/../fastmail-customized/fastmail-inbox-mode.user.js
PERSONAL_ACCOUNT_ID =
WORK_ACCOUNT_ID =
DEVELOPMENT_TEAM =

#include? "Local.xcconfig"
```

The include sits last so `Local.xcconfig` overrides the empty defaults.

Create `Config/Local.xcconfig.example`:

```
DEVELOPMENT_TEAM = ABCDE12345
PERSONAL_ACCOUNT_ID = replace-me
WORK_ACCOUNT_ID = replace-me
USERSCRIPT_PATH = /Users/you/src/fastmail-customized/fastmail-inbox-mode.user.js
```

- [ ] **Step 5: Extend .gitignore**

Replace `.gitignore` with:

```
Config/Local.xcconfig
FastmailShell.xcodeproj/
build/
DerivedData/
.DS_Store
*.xcuserstate
xcuserdata/
.build/
```

The generated project is ignored because `project.yml` is the source of truth.

- [ ] **Step 6: Write the build phase script**

Create `tools/copy-userscript.sh`:

```bash
#!/bin/sh
set -eu

if [ -z "${USERSCRIPT_PATH:-}" ]; then
    echo "error: USERSCRIPT_PATH is not set; copy Config/Local.xcconfig.example to Config/Local.xcconfig"
    exit 1
fi

if [ ! -f "$USERSCRIPT_PATH" ]; then
    echo "error: user script not found at $USERSCRIPT_PATH"
    exit 1
fi

if ! grep -q "==UserScript==" "$USERSCRIPT_PATH"; then
    echo "error: no ==UserScript== metadata block in $USERSCRIPT_PATH"
    exit 1
fi

DEST="$BUILT_PRODUCTS_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
mkdir -p "$DEST"
cp "$USERSCRIPT_PATH" "$DEST/userscript.js"
```

Run: `chmod +x tools/copy-userscript.sh`

- [ ] **Step 7: Write the Info.plists**

Create `Apps/Personal/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>Fastmail</string>
    <key>FMAccountID</key>
    <string>$(PERSONAL_ACCOUNT_ID)</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleIconName</key>
    <string>AppIcon</string>
    <key>UILaunchScreen</key>
    <dict/>
</dict>
</plist>
```

Create `Apps/Work/Info.plist` identically, but with `CFBundleDisplayName` of `nexthealth.nl` and `FMAccountID` of `$(WORK_ACCOUNT_ID)`.

`UILaunchScreen` and `CFBundleIconName` are both required because `GENERATE_INFOPLIST_FILE` is `NO`: without the first, an iOS app runs letterboxed at a smaller size; without the second, the asset-catalog icon is not picked up.

- [ ] **Step 8: Write the app entry points**

Create `Apps/Personal/PersonalApp.swift`:

```swift
import SwiftUI

@main
struct PersonalApp: App {
    var body: some Scene {
        WindowGroup {
            Text("Personal")
        }
    }
}
```

Create `Apps/Work/WorkApp.swift` with `WorkApp` and `Text("Work")`.

These are replaced in Task 10. They exist now so the project generates and builds.

- [ ] **Step 9: Write project.yml**

Create `project.yml`:

```yaml
name: FastmailShell
options:
  bundleIdPrefix: com.mdbraber.fastmail
  deploymentTarget:
    iOS: "17.0"
    macOS: "14.0"
  createIntermediateGroups: true
  generateEmptyDirectories: true

configs:
  Debug: debug
  Release: release

configFiles:
  Debug: Config/Shared.xcconfig
  Release: Config/Shared.xcconfig

packages:
  FastmailShellKit:
    path: Packages/FastmailShellKit

targetTemplates:
  ShellApp:
    type: application
    supportedDestinations: [iOS, macOS]
    dependencies:
      - package: FastmailShellKit
        product: FastmailShellKit
    settings:
      base:
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
        ENABLE_USER_SCRIPT_SANDBOXING: NO
        GENERATE_INFOPLIST_FILE: NO
    postBuildScripts:
      - name: Copy User Script
        script: '"$SRCROOT/tools/copy-userscript.sh"'
        inputFiles:
          - $(USERSCRIPT_PATH)
        outputFiles:
          - $(BUILT_PRODUCTS_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/userscript.js

targets:
  Personal:
    templates: [ShellApp]
    sources:
      - path: Apps/Personal
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.mdbraber.fastmail.personal
        PRODUCT_NAME: mdbraber.com
        INFOPLIST_FILE: Apps/Personal/Info.plist

  Work:
    templates: [ShellApp]
    sources:
      - path: Apps/Work
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.mdbraber.fastmail.work
        PRODUCT_NAME: nexthealth.nl
        INFOPLIST_FILE: Apps/Work/Info.plist

aggregateTargets:
  All:
    targets: [Personal, Work]

schemes:
  Personal:
    build:
      targets:
        Personal: all
    run:
      config: Debug
  Work:
    build:
      targets:
        Work: all
    run:
      config: Debug
  All:
    build:
      targets:
        All: all
```

- [ ] **Step 10: Write the Makefile**

Create `Makefile`:

```makefile
PROJECT = FastmailShell.xcodeproj
DEVICE ?= $(shell xcrun devicectl list devices --quiet 2>/dev/null | awk 'NR==3 {print $$3}')

.PHONY: generate test build-macos install-macos build-ios install-ios install clean

generate:
	xcodegen generate

test:
	cd Packages/FastmailShellKit && swift test

build-macos: generate
	xcodebuild -project $(PROJECT) -scheme Personal -destination 'platform=macOS' -configuration Release build
	xcodebuild -project $(PROJECT) -scheme Work -destination 'platform=macOS' -configuration Release build

install-macos: build-macos
	rm -rf "/Applications/mdbraber.com.app" "/Applications/nexthealth.nl.app"
	cp -R "$$(xcodebuild -project $(PROJECT) -scheme Personal -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/mdbraber.com.app" /Applications/
	cp -R "$$(xcodebuild -project $(PROJECT) -scheme Work -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/nexthealth.nl.app" /Applications/

build-ios: generate
	xcodebuild -project $(PROJECT) -scheme Personal -destination 'generic/platform=iOS' -configuration Release build
	xcodebuild -project $(PROJECT) -scheme Work -destination 'generic/platform=iOS' -configuration Release build

install-ios: build-ios
	xcrun devicectl device install app --device $(DEVICE) "$$(xcodebuild -project $(PROJECT) -scheme Personal -destination 'generic/platform=iOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/mdbraber.com.app"
	xcrun devicectl device install app --device $(DEVICE) "$$(xcodebuild -project $(PROJECT) -scheme Work -destination 'generic/platform=iOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/nexthealth.nl.app"

install: install-macos install-ios

clean:
	rm -rf build DerivedData $(PROJECT)
```

- [ ] **Step 11: Create your local config and generate**

```bash
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

Edit `Config/Local.xcconfig`: set `DEVELOPMENT_TEAM` to your team id, `USERSCRIPT_PATH` to the real path, and leave the account ids as placeholders for now.

Run: `make generate`
Expected: `Created project at FastmailShell.xcodeproj`

- [ ] **Step 12: Build for macOS**

Run: `make build-macos`
Expected: `** BUILD SUCCEEDED **` twice.

- [ ] **Step 13: Verify the build phase actually copied the script**

```bash
find ~/Library/Developer/Xcode/DerivedData -name userscript.js -path '*mdbraber.com.app*' | head -1 | xargs head -3
```

Expected: the first lines of the Inbox mode user script, starting `// ==UserScript==`.

- [ ] **Step 14: Verify the build phase fails loudly when the source is missing**

```bash
USERSCRIPT_PATH=/nonexistent BUILT_PRODUCTS_DIR=/tmp/x UNLOCALIZED_RESOURCES_FOLDER_PATH=y ./tools/copy-userscript.sh; echo "exit=$?"
```

Expected: `error: user script not found at /nonexistent` and `exit=1`.

- [ ] **Step 15: Commit**

```bash
git add project.yml Makefile Config tools .gitignore Apps Packages
git commit -m "build: scaffold XcodeGen project, package, and user script build phase"
```

---

### Task 3: Profile

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/Profile.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ProfileTests.swift`

**Interfaces:**
- Consumes: nothing
- Produces: `Profile` with `id: String`, `displayName: String`, `startURL: URL`, `overlayScriptName: String?`, `urlScheme: String`, `accountID: String?`; `Profile.personal(accountID:)`, `Profile.work(accountID:)`, `Profile.accountID(from: Bundle)`

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKitTests/ProfileTests.swift` at `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ProfileTests.swift`:

```swift
import Testing
import Foundation
@testable import FastmailShellKit

@Test func personalProfileHasExpectedIdentity() {
    let profile = Profile.personal(accountID: nil)
    #expect(profile.id == "personal")
    #expect(profile.displayName == "mdbraber.com")
    #expect(profile.urlScheme == "fastmail-personal")
    #expect(profile.overlayScriptName == "userscript.personal.js")
    #expect(profile.startURL.absoluteString == "https://app.fastmail.com")
}

@Test func workProfileHasExpectedIdentity() {
    let profile = Profile.work(accountID: nil)
    #expect(profile.id == "work")
    #expect(profile.displayName == "nexthealth.nl")
    #expect(profile.urlScheme == "fastmail-work")
    #expect(profile.overlayScriptName == "userscript.work.js")
}

@Test func accountIDIsCarriedThrough() {
    #expect(Profile.personal(accountID: "abc123").accountID == "abc123")
}

@Test func unsubstitutedBuildSettingIsTreatedAsAbsent() {
    #expect(Profile.normalizedAccountID("$(PERSONAL_ACCOUNT_ID)") == nil)
    #expect(Profile.normalizedAccountID("") == nil)
    #expect(Profile.normalizedAccountID("   ") == nil)
    #expect(Profile.normalizedAccountID("abc123") == "abc123")
}
```

The unsubstituted case matters: if `Local.xcconfig` is missing, Info.plist keeps the literal `$(PERSONAL_ACCOUNT_ID)`, and treating that as a real account id would make every link look like it belonged to another profile.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `cannot find 'Profile' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/Profile.swift`:

```swift
import Foundation

public struct Profile: Equatable, Sendable {
    public let id: String
    public let displayName: String
    public let startURL: URL
    public let overlayScriptName: String?
    public let urlScheme: String
    public let accountID: String?

    public init(
        id: String,
        displayName: String,
        startURL: URL,
        overlayScriptName: String?,
        urlScheme: String,
        accountID: String?
    ) {
        self.id = id
        self.displayName = displayName
        self.startURL = startURL
        self.overlayScriptName = overlayScriptName
        self.urlScheme = urlScheme
        self.accountID = accountID
    }
}

extension Profile {
    public static func personal(accountID: String?) -> Profile {
        Profile(
            id: "personal",
            displayName: "mdbraber.com",
            startURL: URL(string: "https://app.fastmail.com")!,
            overlayScriptName: "userscript.personal.js",
            urlScheme: "fastmail-personal",
            accountID: normalizedAccountID(accountID)
        )
    }

    public static func work(accountID: String?) -> Profile {
        Profile(
            id: "work",
            displayName: "nexthealth.nl",
            startURL: URL(string: "https://app.fastmail.com")!,
            overlayScriptName: "userscript.work.js",
            urlScheme: "fastmail-work",
            accountID: normalizedAccountID(accountID)
        )
    }

    public static func accountID(from bundle: Bundle) -> String? {
        normalizedAccountID(bundle.object(forInfoDictionaryKey: "FMAccountID") as? String)
    }

    static func normalizedAccountID(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("$(") else { return nil }
        return trimmed
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add Packages/FastmailShellKit
git commit -m "feat: add Profile with account id normalization"
```

---

### Task 4: User script metadata parsing

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/UserScriptMetadata.swift`
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/MetadataParser.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/MetadataParserTests.swift`

**Interfaces:**
- Consumes: nothing
- Produces: `UserScriptMetadata` with `name: String?`, `matches: [String]`, `runAt: UserScriptMetadata.RunAt`, `grants: [String]`; `UserScriptMetadata.RunAt` cases `documentStart`, `documentEnd`, `documentIdle` with raw values `document-start`, `document-end`, `document-idle`; `MetadataParser.parse(_:) throws -> UserScriptMetadata`; `MetadataParseError.blockMissing`

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/MetadataParserTests.swift`:

```swift
import Testing
@testable import FastmailShellKit

private let realHeader = """
// ==UserScript==
// @name         Fastmail Inbox mode
// @namespace    mdbraber
// @version      1.0
// @description  Sticky Inbox filter on labels
// @author       Someone
// @match        https://app.fastmail.com/*
// @run-at       document-idle
// @inject-into  context
// @grant        none
// ==/UserScript==

(function () { 'use strict'; })();
"""

@Test func parsesTheRealHeader() throws {
    let meta = try MetadataParser.parse(realHeader)
    #expect(meta.name == "Fastmail Inbox mode")
    #expect(meta.matches == ["https://app.fastmail.com/*"])
    #expect(meta.runAt == .documentIdle)
    #expect(meta.grants == ["none"])
}

@Test func missingBlockThrows() {
    #expect(throws: MetadataParseError.blockMissing) {
        try MetadataParser.parse("(function () {})();")
    }
}

@Test func runAtDefaultsToDocumentIdle() throws {
    let source = """
    // ==UserScript==
    // @name  X
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).runAt == .documentIdle)
}

@Test func unknownRunAtFallsBackToDocumentIdle() throws {
    let source = """
    // ==UserScript==
    // @run-at  whenever
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).runAt == .documentIdle)
}

@Test func collectsMultipleMatches() throws {
    let source = """
    // ==UserScript==
    // @match https://app.fastmail.com/*
    // @match https://www.fastmail.com/*
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).matches.count == 2)
}

@Test func unknownDirectivesAreIgnoredNotFatal() throws {
    let source = """
    // ==UserScript==
    // @wibble something
    // @match https://app.fastmail.com/*
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).matches == ["https://app.fastmail.com/*"])
}

@Test func directivesAfterTheClosingLineAreIgnored() throws {
    let source = """
    // ==UserScript==
    // @match https://app.fastmail.com/*
    // ==/UserScript==
    // @match https://evil.example.com/*
    """
    #expect(try MetadataParser.parse(source).matches == ["https://app.fastmail.com/*"])
}
```

That last test is the one worth having: a parser that scans the whole file rather than the block would let anything below the header widen where the script runs.

Add boundary cases too, since `parse` is declared `throws` so malformed input fails safely — a trap here would crash the host process instead:

```swift
@Test func bothMarkersOnOneLineThrows() {
    #expect(throws: MetadataParseError.blockMissing) {
        try MetadataParser.parse("// ==UserScript== ==/UserScript==")
    }
}

@Test func emptySourceThrows() {
    #expect(throws: MetadataParseError.blockMissing) {
        try MetadataParser.parse("")
    }
}

@Test func onlyClosingMarkerThrows() {
    #expect(throws: MetadataParseError.blockMissing) {
        try MetadataParser.parse("// ==/UserScript==")
    }
}

@Test func adjacentMarkersYieldAnEmptyBlock() throws {
    let meta = try MetadataParser.parse("// ==UserScript==\n// ==/UserScript==")
    #expect(meta.matches.isEmpty)
    #expect(meta.runAt == .documentIdle)
}
```

The closing marker must be searched for strictly after the opening line. Searching from `lines[start...]` includes the opening line itself, so a line carrying both markers makes `end == start`, the range `(start + 1)..<end` inverts to `1..<0`, and Swift traps.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `cannot find 'MetadataParser' in scope`.

- [ ] **Step 3: Write the metadata type**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/UserScriptMetadata.swift`:

```swift
import Foundation

public struct UserScriptMetadata: Equatable, Sendable {
    public enum RunAt: String, Equatable, Sendable {
        case documentStart = "document-start"
        case documentEnd = "document-end"
        case documentIdle = "document-idle"
    }

    public let name: String?
    public let matches: [String]
    public let runAt: RunAt
    public let grants: [String]

    public init(name: String?, matches: [String], runAt: RunAt, grants: [String]) {
        self.name = name
        self.matches = matches
        self.runAt = runAt
        self.grants = grants
    }
}

public enum MetadataParseError: Error, Equatable {
    case blockMissing
}
```

- [ ] **Step 4: Write the parser**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/MetadataParser.swift`:

```swift
import Foundation

public enum MetadataParser {
    private static let openMarker = "==UserScript=="
    private static let closeMarker = "==/UserScript=="

    public static func parse(_ source: String) throws -> UserScriptMetadata {
        let lines = source.components(separatedBy: .newlines)
        guard let start = lines.firstIndex(where: { $0.contains(openMarker) }) else {
            throw MetadataParseError.blockMissing
        }
        guard let end = lines[(start + 1)...].firstIndex(where: { $0.contains(closeMarker) }) else {
            throw MetadataParseError.blockMissing
        }

        var name: String?
        var matches: [String] = []
        var runAt: UserScriptMetadata.RunAt = .documentIdle
        var grants: [String] = []

        for line in lines[(start + 1)..<end] {
            guard let (key, value) = directive(in: line) else { continue }
            switch key {
            case "name": name = value
            case "match": matches.append(value)
            case "run-at": runAt = UserScriptMetadata.RunAt(rawValue: value) ?? .documentIdle
            case "grant": grants.append(value)
            default: continue
            }
        }

        return UserScriptMetadata(name: name, matches: matches, runAt: runAt, grants: grants)
    }

    private static func directive(in line: String) -> (String, String)? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("//") else { return nil }
        let body = trimmed.dropFirst(2).trimmingCharacters(in: .whitespaces)
        guard body.hasPrefix("@") else { return nil }
        let content = body.dropFirst()
        guard let separator = content.firstIndex(where: { $0 == " " || $0 == "\t" }) else { return nil }
        let key = String(content[content.startIndex..<separator])
        let value = String(content[separator...]).trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty, !value.isEmpty else { return nil }
        return (key, value)
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS, 16 tests total.

- [ ] **Step 6: Commit**

```bash
git add Packages/FastmailShellKit
git commit -m "feat: parse user script metadata blocks"
```

---

### Task 5: Script loading from the bundle

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/ScriptStore.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScriptStoreTests.swift`

**Interfaces:**
- Consumes: `UserScriptMetadata`, `MetadataParser`
- Produces: `ScriptBundle` with `harness: String`, `userScript: String`, `overlay: String?`, `metadata: UserScriptMetadata`; protocol `ResourceLoading` with `func string(named: String) -> String?`; `BundleResourceLoader(bundle:)`; `ScriptStore(loader:overlayName:)` with `func load() throws -> ScriptBundle`; `ScriptStoreError.harnessMissing`, `.userScriptMissing`

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScriptStoreTests.swift`:

```swift
import Testing
@testable import FastmailShellKit

private struct StubLoader: ResourceLoading {
    var resources: [String: String]
    func string(named name: String) -> String? { resources[name] }
}

private let header = """
// ==UserScript==
// @match https://app.fastmail.com/*
// @run-at document-idle
// ==/UserScript==
"""

@Test func loadsHarnessUserScriptAndMetadata() throws {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": header + "\nBODY"
    ])
    let bundle = try ScriptStore(loader: loader, overlayName: nil).load()
    #expect(bundle.harness == "HARNESS")
    #expect(bundle.userScript.contains("BODY"))
    #expect(bundle.overlay == nil)
    #expect(bundle.metadata.runAt == .documentIdle)
}

@Test func loadsOverlayWhenPresent() throws {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": header,
        "userscript.personal.js": "OVERLAY"
    ])
    let bundle = try ScriptStore(loader: loader, overlayName: "userscript.personal.js").load()
    #expect(bundle.overlay == "OVERLAY")
}

@Test func missingOverlayIsNotAnError() throws {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": header
    ])
    let bundle = try ScriptStore(loader: loader, overlayName: "userscript.personal.js").load()
    #expect(bundle.overlay == nil)
}

@Test func missingHarnessThrows() {
    let loader = StubLoader(resources: ["userscript.js": header])
    #expect(throws: ScriptStoreError.harnessMissing) {
        try ScriptStore(loader: loader, overlayName: nil).load()
    }
}

@Test func missingUserScriptThrows() {
    let loader = StubLoader(resources: ["harness.js": "HARNESS"])
    #expect(throws: ScriptStoreError.userScriptMissing) {
        try ScriptStore(loader: loader, overlayName: nil).load()
    }
}

@Test func unparseableUserScriptPropagatesTheParseError() {
    let loader = StubLoader(resources: [
        "harness.js": "HARNESS",
        "userscript.js": "no metadata here"
    ])
    #expect(throws: MetadataParseError.blockMissing) {
        try ScriptStore(loader: loader, overlayName: nil).load()
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `cannot find 'ResourceLoading' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/ScriptStore.swift`:

```swift
import Foundation

public struct ScriptBundle: Equatable, Sendable {
    public let harness: String
    public let userScript: String
    public let overlay: String?
    public let metadata: UserScriptMetadata
}

public enum ScriptStoreError: Error, Equatable {
    case harnessMissing
    case userScriptMissing
}

public protocol ResourceLoading: Sendable {
    func string(named name: String) -> String?
}

public struct BundleResourceLoader: ResourceLoading {
    private let bundles: [Bundle]

    public init(bundles: [Bundle]) {
        self.bundles = bundles
    }

    public func string(named name: String) -> String? {
        for bundle in bundles {
            guard let url = bundle.url(forResource: name, withExtension: nil) else { continue }
            if let contents = try? String(contentsOf: url, encoding: .utf8) { return contents }
        }
        return nil
    }
}

public struct ScriptStore {
    private let loader: ResourceLoading
    private let overlayName: String?

    public init(loader: ResourceLoading, overlayName: String?) {
        self.loader = loader
        self.overlayName = overlayName
    }

    public func load() throws -> ScriptBundle {
        guard let harness = loader.string(named: "harness.js") else {
            throw ScriptStoreError.harnessMissing
        }
        guard let userScript = loader.string(named: "userscript.js") else {
            throw ScriptStoreError.userScriptMissing
        }
        let metadata = try MetadataParser.parse(userScript)
        let overlay = overlayName.flatMap { loader.string(named: $0) }
        return ScriptBundle(
            harness: harness,
            userScript: userScript,
            overlay: overlay,
            metadata: metadata
        )
    }
}
```

`BundleResourceLoader` takes several bundles because `harness.js` ships in the package's resource bundle while `userscript.js` is placed in the app bundle by the build phase.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS, 22 tests total.

- [ ] **Step 5: Commit**

```bash
git add Packages/FastmailShellKit
git commit -m "feat: load harness, user script, and overlay from bundles"
```

---

### Task 6: Bootstrap assembly

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/ScriptInjector.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScriptInjectorTests.swift`

**Interfaces:**
- Consumes: `ScriptBundle`
- Produces: `ScriptInjector.bootstrap(from: ScriptBundle) throws -> String`; `ScriptInjectorError.encodingFailed(String)`

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScriptInjectorTests.swift`:

```swift
import Testing
import Foundation
@testable import FastmailShellKit

private func bundle(userScript: String, overlay: String? = nil) -> ScriptBundle {
    ScriptBundle(
        harness: "HARNESS_SOURCE",
        userScript: userScript,
        overlay: overlay,
        metadata: UserScriptMetadata(
            name: "X",
            matches: ["https://app.fastmail.com/*"],
            runAt: .documentIdle,
            grants: ["none"]
        )
    )
}

private func stringArgument(_ index: Int, of source: String) throws -> String {
    let marker = "window.__fmshell.boot("
    var rest = Substring(source[source.range(of: marker)!.upperBound...])
    var found = 0
    while let open = rest.firstIndex(of: "\"") {
        var cursor = rest.index(after: open)
        var escaped = false
        while cursor < rest.endIndex {
            let character = rest[cursor]
            if escaped {
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "\"" {
                break
            }
            cursor = rest.index(after: cursor)
        }
        let literal = String(rest[open...cursor])
        if found == index {
            let data = literal.data(using: .utf8)!
            let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            return value as! String
        }
        found += 1
        rest = rest[rest.index(after: cursor)...]
    }
    throw ScriptInjectorError.encodingFailed("no argument at index \(index)")
}

@Test func bootstrapContainsHarnessThenBootCall() throws {
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.hasPrefix("HARNESS_SOURCE"))
    #expect(source.contains("window.__fmshell.boot("))
}

@Test func userScriptSurvivesQuotesNewlinesAndScriptTags() throws {
    let hostile = "var s = \"a'b\\\"c\";\nif (a </script> b) {}\n\u{2028}\u{2029} emoji 🙂 tail"
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: hostile))
    #expect(try stringArgument(0, of: source) == hostile)
}

@Test func presentOverlayRoundTrips() throws {
    let overlay = "var x = \"content, with, commas\";"
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: "BODY", overlay: overlay))
    #expect(try stringArgument(1, of: source) == overlay)
}

@Test func absentOverlayIsEncodedAsNullAndDoesNotThrow() throws {
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.contains(", null, "))
}

@Test func metadataIsPassedAsRunAtAndMatches() throws {
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.contains("\"runAt\":\"document-idle\"") || source.contains("\"runAt\": \"document-idle\""))
    #expect(source.contains("\"matches\""))
    #expect(source.contains("app.fastmail.com"))
}
```

The hostile-input test is the point of this task. Concatenating a 49 KB script into a JavaScript string literal by hand is exactly where a quote or a `</script>` breaks everything, and the failure would look like a broken user script rather than a broken injector.

Two details in the helper matter. It walks the JSON string literal honouring backslash escapes rather than splitting on the first comma, because JSON does not escape commas inside strings and a real script is full of them. And the hostile fixture uses `\u{2028}` and `\u{2029}`, Swift's real scalar syntax — `"\\u2028"` would embed the six characters backslash-u-2-0-2-8 and quietly test nothing.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `cannot find 'ScriptInjector' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/ScriptInjector.swift`:

```swift
import Foundation

public enum ScriptInjectorError: Error, Equatable {
    case encodingFailed(String)
}

public enum ScriptInjector {
    public static func bootstrap(from bundle: ScriptBundle) throws -> String {
        guard let userScript = jsonLiteral(bundle.userScript) else {
            throw ScriptInjectorError.encodingFailed("userScript")
        }
        var overlay = "null"
        if let source = bundle.overlay {
            guard let encoded = jsonLiteral(source) else {
                throw ScriptInjectorError.encodingFailed("overlay")
            }
            overlay = encoded
        }
        guard let metadata = jsonLiteral([
            "runAt": bundle.metadata.runAt.rawValue,
            "matches": bundle.metadata.matches
        ] as Any) else {
            throw ScriptInjectorError.encodingFailed("metadata")
        }
        return """
        \(bundle.harness)
        window.__fmshell.boot(\(userScript), \(overlay), \(metadata));
        """
    }

    static func jsonLiteral(_ value: String) -> String? {
        jsonLiteral(value as Any)
    }

    static func jsonLiteral(_ value: Any) -> String? {
        guard
            let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
            let text = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return text
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS, 26 tests total.

- [ ] **Step 5: Commit**

```bash
git add Packages/FastmailShellKit
git commit -m "feat: assemble the injection bootstrap with JSON-encoded sources"
```

---

### Task 7: Navigation policy

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/NavigationPolicy.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NavigationPolicyTests.swift`

**Interfaces:**
- Consumes: nothing
- Produces: `NavigationDecision` cases `allow`, `openExternally`, `download`; `NavigationPolicy.decide(url: URL) -> NavigationDecision`; `NavigationPolicy.decideResponse(canShowMIMEType: Bool, contentDisposition: String?) -> NavigationDecision`

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NavigationPolicyTests.swift`:

```swift
import Testing
import Foundation
@testable import FastmailShellKit

private func decide(_ string: String) -> NavigationDecision {
    NavigationPolicy.decide(url: URL(string: string)!)
}

@Test func allowsFastmailAndItsSubdomains() {
    #expect(decide("https://app.fastmail.com/mail/Inbox") == .allow)
    #expect(decide("https://fastmail.com/") == .allow)
    #expect(decide("https://www.fastmail.com/help") == .allow)
}

@Test func allowsAttachmentHost() {
    #expect(decide("https://a1.fastmailusercontent.com/file.pdf") == .allow)
    #expect(decide("https://fastmailusercontent.com/file.pdf") == .allow)
}

@Test func refusesLookalikeHosts() {
    #expect(decide("https://notfastmail.com/") == .openExternally)
    #expect(decide("https://fastmail.com.evil.example/") == .openExternally)
    #expect(decide("https://evilfastmailusercontent.com/") == .openExternally)
}

@Test func sendsOrdinaryLinksToTheBrowser() {
    #expect(decide("https://example.com/article") == .openExternally)
}

@Test func sendsNonWebSchemesOutward() {
    #expect(decide("mailto:someone@example.com") == .openExternally)
    #expect(decide("tel:+3112345678") == .openExternally)
}

@Test func requiresHTTPSEvenForAllowedHosts() {
    #expect(decide("http://app.fastmail.com/") == .openExternally)
}

@Test func hostComparisonIsCaseInsensitive() {
    #expect(decide("https://FASTMAIL.COM/") == .allow)
    #expect(decide("https://App.Fastmail.Com/") == .allow)
}

@Test func acceptsRootLabelForm() {
    #expect(decide("https://fastmail.com./") == .allow)
}

@Test func refusesSmuggledHostsInCredentialsAndFragment() {
    #expect(decide("https://user:pass@evil.example/?x=fastmail.com") == .openExternally)
    #expect(decide("https://evil.example/#https://app.fastmail.com/") == .openExternally)
    #expect(decide("https://app.fastmail.com.evil.example/") == .openExternally)
}

@Test func attachmentIsDetectedDespiteWhitespaceAndCase() {
    #expect(NavigationPolicy.decideResponse(
        canShowMIMEType: true,
        contentDisposition: " attachment; filename=\"invoice.pdf\""
    ) == .download)
    #expect(NavigationPolicy.decideResponse(canShowMIMEType: true, contentDisposition: "ATTACHMENT") == .download)
    #expect(NavigationPolicy.decideResponse(canShowMIMEType: true, contentDisposition: "attachment") == .download)
}

@Test func downloadsWhenContentDispositionSaysAttachment() {
    #expect(NavigationPolicy.decideResponse(
        canShowMIMEType: true,
        contentDisposition: "attachment; filename=\"invoice.pdf\""
    ) == .download)
}

@Test func downloadsWhenWebKitCannotRenderTheType() {
    #expect(NavigationPolicy.decideResponse(canShowMIMEType: false, contentDisposition: nil) == .download)
}

@Test func leavesRenderableInlineContentToFastmail() {
    #expect(NavigationPolicy.decideResponse(canShowMIMEType: true, contentDisposition: "inline") == .allow)
    #expect(NavigationPolicy.decideResponse(canShowMIMEType: true, contentDisposition: nil) == .allow)
}
```

`fastmail.com.evil.example` and `notfastmail.com` are the two failures a naive `hasSuffix` check produces, and both would render an attacker's page inside a logged-in mail session.

Three further rules exist for the same reason. Only `https` may be allowed — accepting `http` for an allowed host would leave the boundary depending on App Transport Security being configured correctly in a different file. `Content-Disposition` is trimmed before matching, because leading whitespace is legal in HTTP header values and an untrimmed check lets an attachment render inline in the authenticated origin instead of downloading. And a single trailing dot on the host is stripped, so the root-label form of a legitimate URL is not treated as external.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `cannot find 'NavigationPolicy' in scope`.

- [ ] **Step 3: Write the implementation**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/NavigationPolicy.swift`:

```swift
import Foundation

public enum NavigationDecision: Equatable, Sendable {
    case allow
    case openExternally
    case download
}

public enum NavigationPolicy {
    public static let allowedHosts = ["fastmail.com", "fastmailusercontent.com"]

    public static func decide(url: URL) -> NavigationDecision {
        guard url.scheme?.lowercased() == "https" else { return .openExternally }
        return isAllowed(host: url.host) ? .allow : .openExternally
    }

    public static func decideResponse(canShowMIMEType: Bool, contentDisposition: String?) -> NavigationDecision {
        let disposition = (contentDisposition ?? "")
            .lowercased()
            .trimmingCharacters(in: .whitespaces)
        if disposition.hasPrefix("attachment") { return .download }
        return canShowMIMEType ? .allow : .download
    }

    static func isAllowed(host: String?) -> Bool {
        guard var host = host?.lowercased() else { return false }
        if host.hasSuffix(".") { host.removeLast() }
        return allowedHosts.contains { host == $0 || host.hasSuffix("." + $0) }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS, 34 tests total.

- [ ] **Step 5: Commit**

```bash
git add Packages/FastmailShellKit
git commit -m "feat: add navigation policy with strict host matching"
```

---

### Task 8: The JavaScript harness

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`
- Create: `Tests/IntegrationTests/HarnessTests.swift`
- Create: `Tests/IntegrationTests/fixture.html`
- Modify: `project.yml`

**Interfaces:**
- Consumes: the bootstrap call shape from Task 6, `window.__fmshell.boot(userScript, overlay, metadata)`
- Produces: `window.__fmshell` with `boot`, `onRoute`, `report`; `window.native` with `log` and `onRoute`; messages posted to the `native` handler with `{action: "log"|"error", payload: {...}}`

- [ ] **Step 1: Write the fixture**

Create `Tests/IntegrationTests/fixture.html`:

```html
<!doctype html>
<html>
<head><title>Fixture</title></head>
<body>
<div class="v-Thread">
  <div class="v-Thread-title"><div><h1>Welcome to Labels</h1></div></div>
</div>
<script>
window.__fixtureRouted = 0;
</script>
</body>
</html>
```

- [ ] **Step 2: Write the failing tests**

Create `Tests/IntegrationTests/HarnessTests.swift`:

```swift
import XCTest
import WebKit
@testable import FastmailShellKit

@MainActor
final class HarnessTests: XCTestCase {
    private var webView: WKWebView!
    private var received: [[String: Any]] = []

    private final class Recorder: NSObject, WKScriptMessageHandlerWithReply {
        var onMessage: (([String: Any]) -> Void)?
        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping (Any?, String?) -> Void
        ) {
            if let body = message.body as? [String: Any] { onMessage?(body) }
            replyHandler(nil, nil)
        }
    }

    private static func meta(
        matches: [String] = [],
        runAt: UserScriptMetadata.RunAt = .documentIdle
    ) -> UserScriptMetadata {
        UserScriptMetadata(name: "T", matches: matches, runAt: runAt, grants: ["none"])
    }

    private func makeWebView(userScript: String, metadata: UserScriptMetadata) throws -> WKWebView {
        let harnessURL = Bundle(for: HarnessTests.self).url(forResource: "harness", withExtension: "js")!
        let harness = try String(contentsOf: harnessURL, encoding: .utf8)
        let bundle = ScriptBundle(
            harness: harness,
            userScript: userScript,
            overlay: nil,
            metadata: metadata
        )
        let configuration = WKWebViewConfiguration()
        let recorder = Recorder()
        recorder.onMessage = { [weak self] body in self?.received.append(body) }
        configuration.userContentController.addScriptMessageHandler(
            recorder,
            contentWorld: .page,
            name: "native"
        )
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: try ScriptInjector.bootstrap(from: bundle),
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        return WKWebView(frame: .zero, configuration: configuration)
    }

    private func load(_ webView: WKWebView) async throws {
        let url = Bundle(for: HarnessTests.self).url(forResource: "fixture", withExtension: "html")!
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        try await waitUntil { try await self.evaluate(webView, "document.readyState") as? String == "complete" }
    }

    private func evaluate(_ webView: WKWebView, _ js: String) async throws -> Any? {
        try await webView.evaluateJavaScript(js)
    }

    private func waitUntil(
        timeout: TimeInterval = 5,
        _ condition: () async throws -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("condition not met within \(timeout)s")
    }

    func testHarnessInstallsAndExposesNative() async throws {
        webView = try makeWebView(userScript: "window.__ran = true;", metadata: Self.meta())
        try await load(webView)
        let installed = try await evaluate(webView, "typeof window.__fmshell") as? String
        XCTAssertEqual(installed, "object")
        let native = try await evaluate(webView, "typeof window.native.log") as? String
        XCTAssertEqual(native, "function")
    }

    func testDocumentIdleScriptRunsAfterLoadNotAtStart() async throws {
        let script = "window.__readyStateWhenRun = document.readyState;"
        webView = try makeWebView(userScript: script, metadata: Self.meta())
        try await load(webView)
        try await waitUntil {
            try await self.evaluate(self.webView, "window.__readyStateWhenRun") != nil
        }
        let state = try await evaluate(webView, "window.__readyStateWhenRun") as? String
        XCTAssertEqual(state, "complete")
    }

    func testThrowingUserScriptIsReportedNotSilent() async throws {
        webView = try makeWebView(userScript: "throw new Error('boom');", metadata: Self.meta())
        try await load(webView)
        try await waitUntil { self.received.contains { $0["action"] as? String == "error" } }
        let error = received.first { $0["action"] as? String == "error" }
        let payload = error?["payload"] as? [String: Any]
        XCTAssertTrue((payload?["message"] as? String ?? "").contains("boom"))
    }

    func testRouteHookFiresOnPushState() async throws {
        let script = "window.native.onRoute(function () { window.__fixtureRouted += 1; });"
        webView = try makeWebView(userScript: script, metadata: Self.meta())
        try await load(webView)
        try await waitUntil {
            try await self.evaluate(self.webView, "typeof window.__fixtureRouted") as? String == "number"
        }
        _ = try await evaluate(webView, "history.pushState({}, '', '/changed')")
        try await waitUntil {
            (try await self.evaluate(self.webView, "window.__fixtureRouted") as? Int ?? 0) >= 1
        }
    }

    func testMatchMismatchPreventsEvaluation() async throws {
        webView = try makeWebView(
            userScript: "window.__ranAnyway = true;",
            metadata: Self.meta(matches: ["https://example.com/*"])
        )
        try await load(webView)
        let ran = try await evaluate(webView, "window.__ranAnyway")
        XCTAssertNil(ran)
    }
}
```

- [ ] **Step 3: Add the integration target to project.yml**

Add under `targets:` in `project.yml`:

```yaml
  IntegrationTests:
    type: bundle.unit-test
    platform: macOS
    sources:
      - path: Tests/IntegrationTests
      - path: Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js
        buildPhase: resources
    dependencies:
      - package: FastmailShellKit
        product: FastmailShellKit
    settings:
      base:
        GENERATE_INFOPLIST_FILE: YES
```

And add to `schemes:`:

```yaml
  IntegrationTests:
    build:
      targets:
        IntegrationTests: [test]
    test:
      targets:
        - IntegrationTests
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
make generate
xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test 2>&1 | tail -20
```

Expected: FAIL — the harness has no `boot`, so nothing is installed and every assertion fails.

- [ ] **Step 5: Write the harness**

Replace `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js` with:

```javascript
(function () {
    if (window.__fmshell && window.__fmshell.boot) return;

    var routeCallbacks = [];
    var lastHref = location.href;

    function post(action, payload) {
        var webkit = window.webkit;
        var handler = webkit && webkit.messageHandlers && webkit.messageHandlers.native;
        if (!handler) return Promise.resolve(null);
        try {
            var result = handler.postMessage({ action: action, payload: payload || {} });
            return result && result.catch ? result.catch(function () { return null; }) : Promise.resolve(result);
        } catch (error) {
            return Promise.resolve(null);
        }
    }

    function report(error) {
        var message = error && error.message ? error.message : String(error);
        var stack = error && error.stack ? error.stack : '';
        post('error', { message: message, stack: stack });
    }

    function notifyRoute() {
        if (location.href === lastHref) return;
        lastHref = location.href;
        for (var i = 0; i < routeCallbacks.length; i += 1) {
            try {
                routeCallbacks[i](location.href);
            } catch (error) {
                report(error);
            }
        }
    }

    function installRouteHooks() {
        ['pushState', 'replaceState'].forEach(function (name) {
            var original = history[name];
            history[name] = function () {
                var result = original.apply(this, arguments);
                notifyRoute();
                return result;
            };
        });
        window.addEventListener('popstate', notifyRoute);

        var pending = null;
        var observer = new MutationObserver(function () {
            if (pending) return;
            pending = setTimeout(function () {
                pending = null;
                notifyRoute();
            }, 100);
        });
        function observe() {
            if (document.body) observer.observe(document.body, { childList: true, subtree: true });
        }
        if (document.body) observe();
        else document.addEventListener('DOMContentLoaded', observe);
    }

    function matchesAny(patterns, href) {
        for (var i = 0; i < patterns.length; i += 1) {
            var escaped = patterns[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            if (new RegExp('^' + escaped + '$').test(href)) return true;
        }
        return false;
    }

    function runWhenReady(runAt, fn) {
        if (runAt === 'document-start') {
            fn();
            return;
        }
        if (runAt === 'document-end') {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
            else fn();
            return;
        }
        if (document.readyState === 'complete') fn();
        else window.addEventListener('load', fn);
    }

    function evaluate(source, label) {
        try {
            (0, eval)(source);
        } catch (error) {
            var message = error && error.message ? error.message : String(error);
            report(new Error(label + ': ' + message));
        }
    }

    window.__fmshell = {
        boot: function (userScript, overlay, metadata) {
            installRouteHooks();
            var patterns = (metadata && metadata.matches) || [];
            if (patterns.length && !matchesAny(patterns, location.href)) {
                post('error', {
                    message: 'user script @match does not cover ' + location.href,
                    stack: ''
                });
                return;
            }
            var runAt = (metadata && metadata.runAt) || 'document-idle';
            runWhenReady(runAt, function () {
                if (userScript) evaluate(userScript, 'userscript');
                if (overlay) evaluate(overlay, 'overlay');
            });
        },
        onRoute: function (callback) {
            routeCallbacks.push(callback);
        },
        report: report
    };

    window.native = window.native || {};
    window.native.log = function () {
        var parts = Array.prototype.slice.call(arguments).map(String);
        post('log', { message: parts.join(' ') });
    };
    window.native.onRoute = function (callback) {
        window.__fmshell.onRoute(callback);
    };

    window.addEventListener('error', function (event) {
        report(event.error || event.message);
    });
    window.addEventListener('unhandledrejection', function (event) {
        report(event.reason);
    });
})();
```

`(0, eval)` is indirect eval, which evaluates in global scope — the semantics a user script manager provides, and what the Inbox mode script's top-level `window.mdbraberInboxMode` guard expects.

- [ ] **Step 6: Run tests to verify they pass**

```bash
xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test 2>&1 | tail -20
```

Expected: `** TEST SUCCEEDED **`, 5 tests.

If WebKit refuses to run in the test process with an error about a missing bundle identifier, add `PRODUCT_BUNDLE_IDENTIFIER: com.mdbraber.fastmail.integrationtests` to the target's settings and regenerate.

- [ ] **Step 7: Add the integration suite to make test**

In `Makefile`, replace the `test` target with:

```makefile
test: generate
	cd Packages/FastmailShellKit && swift test
	xcodebuild -project $(PROJECT) -scheme IntegrationTests -destination 'platform=macOS' test
```

- [ ] **Step 8: Run the whole suite**

Run: `make test`
Expected: both suites pass.

- [ ] **Step 9: Commit**

```bash
git add Packages/FastmailShellKit Tests project.yml Makefile
git commit -m "feat: add JavaScript harness with run-at scheduling and error capture"
```

---

### Task 9: Web view, bridge, and shell UI

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift`
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift`

**Interfaces:**
- Consumes: `Profile`, `ScriptStore`, `ScriptInjector`, `NavigationPolicy`, `BundleResourceLoader`
- Produces: `ShellModel` (`@MainActor`, `ObservableObject`) with `@Published var banner: String?`; `NativeBridge(onLog:onError:)`; `WebContainer(profile:model:)`; `AppShell(profile:)`

- [ ] **Step 1: Write the failing test**

Create `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift`:

```swift
import Testing
import Foundation
@testable import FastmailShellKit

@Test func routesLogAndErrorActions() async {
    let recorded = Recorder()
    let bridge = await NativeBridge(
        onLog: { await recorded.appendLog($0) },
        onError: { await recorded.appendError($0) }
    )
    await bridge.handle(body: ["action": "log", "payload": ["message": "hello"]])
    await bridge.handle(body: ["action": "error", "payload": ["message": "boom", "stack": "s"]])
    #expect(await recorded.logs == ["hello"])
    #expect(await recorded.errors == ["boom"])
}

@Test func unknownActionProducesAnError() async {
    let bridge = await NativeBridge(onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["action": "teleport", "payload": [:]])
    #expect(reply.error?.contains("teleport") == true)
}

@Test func malformedBodyProducesAnError() async {
    let bridge = await NativeBridge(onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["nonsense": 1])
    #expect(reply.error != nil)
}

actor Recorder {
    var logs: [String] = []
    var errors: [String] = []
    func appendLog(_ value: String) { logs.append(value) }
    func appendError(_ value: String) { errors.append(value) }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `cannot find 'NativeBridge' in scope`.

- [ ] **Step 3: Write the bridge**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`:

```swift
import Foundation
import WebKit

public struct BridgeReply: Equatable, Sendable {
    public let value: String?
    public let error: String?
}

@MainActor
public final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let onLog: (String) async -> Void
    private let onError: (String) async -> Void

    public init(
        onLog: @escaping (String) async -> Void,
        onError: @escaping (String) async -> Void
    ) {
        self.onLog = onLog
        self.onError = onError
    }

    @discardableResult
    public func handle(body: [String: Any]) async -> BridgeReply {
        guard let action = body["action"] as? String else {
            return BridgeReply(value: nil, error: "message has no action")
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        switch action {
        case "log":
            await onLog(payload["message"] as? String ?? "")
            return BridgeReply(value: nil, error: nil)
        case "error":
            await onError(payload["message"] as? String ?? "unknown error")
            return BridgeReply(value: nil, error: nil)
        default:
            return BridgeReply(value: nil, error: "unknown action: \(action)")
        }
    }

    public nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        let body = message.body as? [String: Any] ?? [:]
        Task { @MainActor in
            let reply = await handle(body: body)
            replyHandler(reply.value, reply.error)
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS, 37 tests total.

- [ ] **Step 5: Write the coordinator**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/WebCoordinator.swift`:

```swift
import Foundation
import WebKit

#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

@MainActor
public final class WebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let model: ShellModel
    private var lastURL: URL

    public init(model: ShellModel, startURL: URL) {
        self.model = model
        self.lastURL = startURL
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        switch NavigationPolicy.decide(url: url) {
        case .allow:
            lastURL = url
            decisionHandler(.allow)
        case .openExternally, .download:
            decisionHandler(.cancel)
            open(url)
        }
    }

    public func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            switch NavigationPolicy.decide(url: url) {
            case .allow: webView.load(URLRequest(url: url))
            case .openExternally, .download: open(url)
            }
        }
        return nil
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        model.banner = "The page stopped responding and was reloaded."
        webView.load(URLRequest(url: lastURL))
    }

    public func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        model.banner = error.localizedDescription
    }

    private func open(_ url: URL) {
        #if canImport(UIKit)
        UIApplication.shared.open(url)
        #else
        NSWorkspace.shared.open(url)
        #endif
    }
}
```

`createWebViewWith` returning `nil` after routing the request is what makes `target="_blank"` links work at all; WebKit does nothing for them otherwise.

- [ ] **Step 6: Write the container and shell**

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`:

```swift
import SwiftUI
import WebKit

@MainActor
public final class ShellModel: ObservableObject {
    @Published public var banner: String?

    public init() {}

    public func show(_ message: String) {
        banner = message
    }
}

@MainActor
public struct WebContainer {
    let profile: Profile
    let model: ShellModel

    public init(profile: Profile, model: ShellModel) {
        self.profile = profile
        self.model = model
    }

    func makeWebView(coordinator: WebCoordinator) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()

        let bridge = NativeBridge(
            onLog: { message in print("[userscript] \(message)") },
            onError: { [model] message in model.show(message) }
        )
        configuration.userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "native"
        )

        let loader = BundleResourceLoader(bundles: [.main, .module])
        do {
            let scripts = try ScriptStore(
                loader: loader,
                overlayName: profile.overlayScriptName
            ).load()
            configuration.userContentController.addUserScript(
                WKUserScript(
                    source: try ScriptInjector.bootstrap(from: scripts),
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
        } catch {
            model.show("User script not loaded: \(error)")
        }

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = true
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        webView.load(URLRequest(url: profile.startURL))
        return webView
    }
}
```

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer+iOS.swift`:

```swift
#if canImport(UIKit)
import SwiftUI
import WebKit

extension WebContainer: UIViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: profile.startURL)
    }

    public func makeUIView(context: Context) -> WKWebView {
        makeWebView(coordinator: context.coordinator)
    }

    public func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif
```

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer+macOS.swift`:

```swift
#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import SwiftUI
import WebKit

extension WebContainer: NSViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: profile.startURL)
    }

    public func makeNSView(context: Context) -> WKWebView {
        makeWebView(coordinator: context.coordinator)
    }

    public func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#endif
```

Create `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift`:

```swift
import SwiftUI

public struct AppShell: View {
    private let profile: Profile
    @StateObject private var model = ShellModel()

    public init(profile: Profile) {
        self.profile = profile
    }

    public var body: some View {
        ZStack(alignment: .top) {
            WebContainer(profile: profile, model: model)
                .ignoresSafeArea()
            if let banner = model.banner {
                HStack(alignment: .top) {
                    Text(banner)
                        .font(.callout)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Button("Dismiss") { model.banner = nil }
                        .buttonStyle(.plain)
                }
                .padding(12)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                .padding(12)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: model.banner)
    }
}
```

- [ ] **Step 7: Verify the package still builds and tests pass**

Run: `cd Packages/FastmailShellKit && swift build && swift test`
Expected: build succeeds, 32 tests pass.

- [ ] **Step 8: Commit**

```bash
git add Packages/FastmailShellKit
git commit -m "feat: add web container, navigation coordinator, and error banner"
```

---

### Task 10: Wire the apps, extract icons, install

**Files:**
- Modify: `Apps/Personal/PersonalApp.swift`, `Apps/Work/WorkApp.swift`
- Create: `tools/extract-icons.swift`
- Create: `Apps/Personal/Assets.xcassets/`, `Apps/Work/Assets.xcassets/`
- Modify: `Makefile`, `project.yml`

**Interfaces:**
- Consumes: `AppShell`, `Profile`
- Produces: four installable products

- [ ] **Step 0: Rename the apps**

The products are named for the accounts they hold, not for Fastmail. Three places shipped with the old names and must be updated together:

1. `Packages/FastmailShellKit/Sources/FastmailShellKit/Profile.swift` — `displayName` becomes `mdbraber.com` for personal and `nexthealth.nl` for work.
2. `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ProfileTests.swift` — the two `displayName` assertions.
3. `Apps/Personal/Info.plist` and `Apps/Work/Info.plist` — `CFBundleDisplayName`.

`project.yml` already carries the matching `PRODUCT_NAME` values, so the built bundles become `mdbraber.com.app` and `nexthealth.nl.app`.

Run `cd Packages/FastmailShellKit && swift test` and confirm the profile tests pass with the new names before continuing.

This collides by name with the existing Safari web apps in `~/Applications`, which are also called `mdbraber.com.app` and `nexthealth.nl.app` and carry the same icons. The new apps install to `/Applications`, so both sets coexist and are told apart only by location. Accepted deliberately; retiring the old web apps is out of scope for this plan.

- [ ] **Step 0b: Full-height window chrome on macOS**

The Mac window must let Fastmail's own page header reach the top edge, with the traffic lights floating over it, rather than sitting below a stock title bar.

Add to `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer+macOS.swift`, applied once the view has a window:

```swift
func configureWindow(_ window: NSWindow) {
    window.styleMask.insert(.fullSizeContentView)
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
}
```

Call it from `makeNSView` via `DispatchQueue.main.async` on the view's `window`, since the view has no window at creation time. Guard against the window being nil rather than force-unwrapping.

This is native window configuration only. The CSS that pads Fastmail's header clear of the traffic lights belongs to the user script and is deliberately out of scope here — it must not be added to Swift.

- [ ] **Step 1: Point the apps at the shell**

Replace `Apps/Personal/PersonalApp.swift`:

```swift
import SwiftUI
import FastmailShellKit

@main
struct PersonalApp: App {
    var body: some Scene {
        WindowGroup {
            AppShell(profile: .personal(accountID: Profile.accountID(from: .main)))
        }
    }
}
```

Replace `Apps/Work/WorkApp.swift`:

```swift
import SwiftUI
import FastmailShellKit

@main
struct WorkApp: App {
    var body: some Scene {
        WindowGroup {
            AppShell(profile: .work(accountID: Profile.accountID(from: .main)))
        }
    }
}
```

- [ ] **Step 2: Write the icon extraction tool**

Create `tools/extract-icons.swift`:

```swift
import AppKit
import Foundation

struct Source {
    let app: String
    let target: String
}

let sources = [
    Source(app: "/Users/mdbraber/Applications/mdbraber.com.app", target: "Apps/Personal"),
    Source(app: "/Users/mdbraber/Applications/nexthealth.nl.app", target: "Apps/Work")
]

func render(_ image: NSImage, size: CGFloat, opaque: Bool, bleed: CGFloat) -> Data {
    let pixels = Int(size)
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixels,
        pixelsHigh: pixels,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let full = NSRect(x: 0, y: 0, width: size, height: size)
    if opaque {
        NSColor.white.setFill()
        full.fill()
    }
    let inset = -size * (bleed - 1) / 2
    image.draw(in: full.insetBy(dx: inset, dy: inset))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let contents = """
{
  "images" : [
    {
      "filename" : "icon-ios.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "filename" : "icon-mac.png",
      "idiom" : "mac",
      "scale" : "1x",
      "size" : "512x512"
    }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
"""

for source in sources {
    let icon = NSWorkspace.shared.icon(forFile: source.app)
    let set = "\(source.target)/Assets.xcassets/AppIcon.appiconset"
    try! FileManager.default.createDirectory(atPath: set, withIntermediateDirectories: true)
    try! render(icon, size: 1024, opaque: true, bleed: 1.18)
        .write(to: URL(fileURLWithPath: "\(set)/icon-ios.png"))
    try! render(icon, size: 512, opaque: false, bleed: 1.0)
        .write(to: URL(fileURLWithPath: "\(set)/icon-mac.png"))
    try! contents.write(toFile: "\(set)/Contents.json", atomically: true, encoding: .utf8)

    let root = "\(source.target)/Assets.xcassets"
    try! "{\n  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 }\n}"
        .write(toFile: "\(root)/Contents.json", atomically: true, encoding: .utf8)
    print("wrote \(set)")
}
```

- [ ] **Step 3: Run it and check the output**

```bash
swift tools/extract-icons.swift
open Apps/Personal/Assets.xcassets/AppIcon.appiconset/icon-ios.png
```

Expected: two asset catalogs written. The personal iOS icon is a green Fastmail envelope filling the square with no transparent corners; the macOS one keeps its inset squircle and shadow.

- [ ] **Step 4: Add the asset catalogs to the targets**

In `project.yml`, under both `Personal` and `Work`, extend `sources` — they already point at `Apps/Personal` and `Apps/Work`, so the catalogs are picked up automatically. Confirm by regenerating:

```bash
make generate && xcodebuild -project FastmailShell.xcodeproj -list
```

Expected: schemes `Personal`, `Work`, `All`, `IntegrationTests`.

- [ ] **Step 5: Build and run the Mac app**

```bash
make build-macos
open "$(xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $3}')/mdbraber.com.app"
```

Expected: a window opens on the Fastmail login page, with the green icon in the Dock.

- [ ] **Step 6: Verify the user script actually runs**

Log in. Then in Safari → Develop → your Mac → Fastmail, run in the console:

```javascript
window.mdbraberInboxMode
```

Expected: an object with `isOn`, `setMode`, `toggleMode`, `computeCounts`. Press `Shift-I` in the app window and confirm Inbox mode toggles.

If it is `undefined`, check the Xcode console for a `[userscript]` line or a banner in the app; the harness reports throw sites rather than swallowing them.

- [ ] **Step 7: Install everything**

```bash
make install-macos
```

Expected: `mdbraber.com.app` and `nexthealth.nl.app` in `/Applications`.

For iOS, connect and unlock the device, then:

```bash
make install-ios
```

Expected: both apps on the Home Screen. If `DEVICE` resolves wrongly, pass it explicitly: `make install-ios DEVICE=<udid from xcrun devicectl list devices>`.

- [ ] **Step 8: Verify on iOS**

Open Fastmail on the phone, log in, and confirm the sidebar badges show Inbox-only counts — the script's visible signature.

- [ ] **Step 9: Run the whole suite once more**

Run: `make test`
Expected: both suites pass.

- [ ] **Step 10: Commit**

```bash
git add Apps tools project.yml Makefile
git commit -m "feat: wire app targets to the shell and extract icons"
```

---

## Self-Review

**Spec coverage.** M0 → Task 1. M1 (package, two multiplatform targets, profiles, navigation policy, persistent sessions, `make install`) → Tasks 2, 3, 7, 9, 10. M2 (build phase, script store, injector, metadata) → Tasks 2, 4, 5, 6. M3-core (route hooks, error reporting, run-at evaluation) → Task 8.

Deliberately **not** in this plan, and belonging to Plans 2 and 3: subject resolution and `currentLink`, menu injection and `addMenuItem`, share and `SharePresenter`, badge, App Intents, AppleScript, compose and tabs, `WebViewRegistry`, link handling and `LinkRouter`, share extensions, downloads, Quick Look, and settings. Two spec items are pulled forward into Task 9 because leaving them out would ship a visibly broken app: `target="_blank"` routing and content-process crash recovery.

`NavigationPolicy.decideResponse` is written and tested in Task 7 but not yet wired to a `WKDownloadDelegate` — Task 9 routes `.download` externally as an interim, and Plan 3 replaces that with real downloads. Flagged so it is not mistaken for finished.

**Placeholder scan.** No TBDs. Every code step carries the actual source. Task 1 is a spike whose deliverable is a findings document with a named gate condition rather than tests, which is intentional.

**Type consistency.** `ScriptBundle(harness:userScript:overlay:metadata:)` is constructed identically in Tasks 5, 6, and 8. `UserScriptMetadata(name:matches:runAt:grants:)` matches across Tasks 4, 6, and 8. `NavigationDecision` cases `allow`/`openExternally`/`download` are used consistently in Tasks 7 and 9. `ShellModel.banner` is declared in Task 9's `WebContainer.swift` and consumed by `WebCoordinator` and `AppShell` in the same task. `Profile.accountID(from:)` defined in Task 3, used in Task 10.

---

### Task 11: Inject the user script directly instead of evaluating it

Found at first launch: the app loads, the harness installs, and the error banner reports the user script blocked. Fastmail serves

```
script-src 'self' https://hcaptcha.com https://*.hcaptcha.com 'sha256-…'
```

with no `'unsafe-eval'`, so the harness's `(0, eval)(source)` cannot run. The harness itself runs fine and is what reported the failure, which establishes the important fact: **`WKUserScript` injection bypasses page CSP; only `eval` inside it does not.**

The fix is to stop evaluating and let WebKit inject the user script the same way it injects the harness. This deletes the run-at scheduling, the `@match` gate, and the eval from JavaScript.

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/ScriptInjector.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`
- Modify: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScriptInjectorTests.swift`
- Modify: `Tests/IntegrationTests/HarnessTests.swift`

**Interfaces:**
- Consumes: `ScriptBundle`, `UserScriptMetadata`
- Produces: `ScriptInjector.userScripts(from: ScriptBundle, url: URL) throws -> [WKUserScript]`

- [ ] **Step 1: Replace the bootstrap tests**

`bootstrap(from:)` and its JSON-literal encoding go away entirely — nothing is embedded in a string any more, so the hostile-input and encoding tests have nothing left to protect. Replace `ScriptInjectorTests.swift` with tests for the new shape:

```swift
import Testing
import WebKit
@testable import FastmailShellKit

private func bundle(
    userScript: String = "BODY",
    overlay: String? = nil,
    runAt: UserScriptMetadata.RunAt = .documentIdle,
    matches: [String] = ["https://app.fastmail.com/*"]
) -> ScriptBundle {
    ScriptBundle(
        harness: "HARNESS",
        userScript: userScript,
        overlay: overlay,
        metadata: UserScriptMetadata(name: "T", matches: matches, runAt: runAt, grants: ["none"])
    )
}

private let fastmail = URL(string: "https://app.fastmail.com/mail/Inbox")!

@Test func harnessIsAlwaysFirstAndAtDocumentStart() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(), url: fastmail)
    #expect(scripts.first?.source == "HARNESS")
    #expect(scripts.first?.injectionTime == .atDocumentStart)
}

@Test func userScriptIsInjectedVerbatimNotEmbedded() throws {
    let source = "var s = \"a'b\\\"c\";\nif (a </script> b) {}\n\u{2028} 🙂"
    let scripts = try ScriptInjector.userScripts(from: bundle(userScript: source), url: fastmail)
    #expect(scripts.contains { $0.source == source })
}

@Test func documentIdleAndDocumentEndBothMapToDocumentEnd() throws {
    for runAt in [UserScriptMetadata.RunAt.documentIdle, .documentEnd] {
        let scripts = try ScriptInjector.userScripts(from: bundle(runAt: runAt), url: fastmail)
        #expect(scripts.last?.injectionTime == .atDocumentEnd)
    }
}

@Test func documentStartMapsToDocumentStart() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(runAt: .documentStart), url: fastmail)
    #expect(scripts.last?.injectionTime == .atDocumentStart)
}

@Test func overlayFollowsTheUserScript() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(overlay: "OVERLAY"), url: fastmail)
    #expect(scripts.map(\.source) == ["HARNESS", "BODY", "OVERLAY"])
}

@Test func nonMatchingURLYieldsHarnessOnly() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(), url: URL(string: "https://example.com/")!)
    #expect(scripts.map(\.source) == ["HARNESS"])
}

@Test func emptyMatchListMatchesEverything() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(matches: []), url: URL(string: "https://example.com/")!)
    #expect(scripts.count == 2)
}

@Test func allScriptsAreMainFrameOnly() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(overlay: "OVERLAY"), url: fastmail)
    #expect(scripts.allSatisfy(\.isForMainFrameOnly))
}
```

`nonMatchingURLYieldsHarnessOnly` is the replacement for the JavaScript `@match` gate, and it is stronger: the script is never handed to WebKit at all rather than being handed over and asked not to run.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, no member `userScripts(from:url:)`.

- [ ] **Step 3: Rewrite ScriptInjector**

Replace the whole file:

```swift
import Foundation
import WebKit

public enum ScriptInjector {
    public static func userScripts(from bundle: ScriptBundle, url: URL) throws -> [WKUserScript] {
        var scripts = [
            WKUserScript(source: bundle.harness, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        ]
        guard matches(bundle.metadata.matches, url: url) else { return scripts }
        let time = injectionTime(for: bundle.metadata.runAt)
        scripts.append(WKUserScript(source: bundle.userScript, injectionTime: time, forMainFrameOnly: true))
        if let overlay = bundle.overlay {
            scripts.append(WKUserScript(source: overlay, injectionTime: time, forMainFrameOnly: true))
        }
        return scripts
    }

    static func injectionTime(for runAt: UserScriptMetadata.RunAt) -> WKUserScriptInjectionTime {
        runAt == .documentStart ? .atDocumentStart : .atDocumentEnd
    }

    static func matches(_ patterns: [String], url: URL) -> Bool {
        guard !patterns.isEmpty else { return true }
        let href = url.absoluteString
        return patterns.contains { pattern in
            let escaped = NSRegularExpression.escapedPattern(for: pattern)
                .replacingOccurrences(of: "\\*", with: ".*")
            return href.range(of: "^" + escaped + "$", options: .regularExpression) != nil
        }
    }
}
```

`document-idle` maps to `.atDocumentEnd` because WebKit offers no later injection point. The Inbox mode script self-defers through its own `isReady()` and `MutationObserver`, so it still starts only once Fastmail is ready.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS.

- [ ] **Step 5: Strip the dead machinery from harness.js**

Delete `boot`, `runWhenReady`, `matchesAny`, and `evaluate` — every one of them exists only to serve the eval path. Keep `post`, `report`, `notifyRoute`, `installRouteHooks`, the `window.native` surface, and the two global listeners, and call `installRouteHooks()` directly from the IIFE. The global `error` and `unhandledrejection` listeners are what now report a failing user script, since an uncaught throw in an injected script reaches `window.onerror` exactly as it would from a page script.

Leave `window.__fmshell` in place exposing `onRoute` and `report`; the integration tests and any future user script use it.

- [ ] **Step 6: Update WebContainer**

Replace the single `addUserScript` call with iteration over the new list, passing the profile's start URL:

```swift
for script in try ScriptInjector.userScripts(from: scripts, url: profile.startURL) {
    configuration.userContentController.addUserScript(script)
}
```

- [ ] **Step 7: Update the harness integration tests**

`HarnessTests` builds its own bootstrap through `ScriptInjector.bootstrap`, which no longer exists. Rework `makeWebView` to add the scripts from `userScripts(from:url:)`, using the fixture's own URL so the match test is meaningful. The tests asserting eval-time behaviour — `testDocumentIdleScriptRunsAfterLoadNotAtStart`, `testDocumentStartScriptRunsWhileDocumentIsLoading`, `testDocumentEndScriptNeverRunsBeforeDOMContentLoaded` — now assert WebKit's injection timing rather than the harness's scheduling, which is what they should have been testing all along. `testMatchMismatchPreventsEvaluation` becomes an assertion that the script was never added.

Keep `testThrowingUserScriptIsReportedNotSilent`: it must still pass, now via `window.onerror` rather than the harness catch block. If it does not, stop and report — that would mean losing error visibility, which is what surfaced this defect in the first place.

- [ ] **Step 8: Verify against the real site**

Build and launch the Mac app, log in, and confirm in Web Inspector that `window.mdbraberInboxMode` is an object and no CSP error appears in the console. This is the only proof that matters.

- [ ] **Step 9: Commit**

```bash
git add Packages Tests
git commit -m "fix: inject the user script directly, since CSP forbids eval"
```

---

### Task 12: macOS chrome stylesheet

Task 10 made the window full-height, so Fastmail's own page header now runs to the top edge and the traffic lights sit on top of it. This task stops them overlapping.

Unlike the script case, CSS is not blocked: Fastmail sends `style-src 'self' 'unsafe-inline' …`, so an injected `<style>` element is permitted. Verified against the live headers on 2026-08-11.

The stylesheet is macOS-only. iOS has no traffic lights and no title bar, and applying the inset there would leave a dead band at the top of the screen.

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/chrome-macos.css`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/ScriptStore.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/ScriptInjector.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer+macOS.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ScriptInjectorTests.swift`

**Interfaces:**
- Consumes: `ScriptBundle`, `ScriptInjector.userScripts(from:url:)` from Task 11
- Produces: `ScriptBundle.chromeCSS: String?`; `ScriptInjector.userScripts(from:url:chromeCSS:)`

- [ ] **Step 1: Write the stylesheet**

Create `chrome-macos.css`:

```css
:root {
    --fmshell-titlebar-inset: 78px;
}

.v-PageHeader {
    padding-left: var(--fmshell-titlebar-inset);
}

body.fmshell-fullscreen {
    --fmshell-titlebar-inset: 0px;
}
```

The inset is a custom property so the value can be tuned in one place. 78px is the standard distance from the window's left edge to the right of the close/minimise/zoom cluster at default sizing; confirm it visually in Step 6 and adjust if Fastmail's own padding already accounts for part of it.

- [ ] **Step 2: Write the failing tests**

Add to `ScriptInjectorTests.swift`:

```swift
@Test func chromeCSSIsInjectedAsAStyleElementAtDocumentStart() throws {
    let scripts = try ScriptInjector.userScripts(
        from: bundle(), url: fastmail, chromeCSS: ".v-PageHeader { padding-left: 78px; }"
    )
    let styleScript = try #require(scripts.first { $0.source.contains("createElement('style')") })
    #expect(styleScript.injectionTime == .atDocumentStart)
    #expect(styleScript.source.contains("padding-left: 78px"))
}

@Test func chromeCSSIsOmittedWhenAbsent() throws {
    let scripts = try ScriptInjector.userScripts(from: bundle(), url: fastmail, chromeCSS: nil)
    #expect(scripts.allSatisfy { !$0.source.contains("createElement('style')") })
}

@Test func chromeCSSSurvivesQuotesAndNewlines() throws {
    let css = ".x::after { content: \"a'b\\\"c\"; }\n.y { color: red; }"
    let scripts = try ScriptInjector.userScripts(from: bundle(), url: fastmail, chromeCSS: css)
    let styleScript = try #require(scripts.first { $0.source.contains("createElement('style')") })
    let encoded = try #require(styleScript.source.range(of: "\"")).lowerBound
    _ = encoded
    #expect(styleScript.source.contains("\\n") || styleScript.source.contains("\\\""))
}

@Test func chromeCSSIsInjectedEvenWhenTheURLDoesNotMatch() throws {
    let scripts = try ScriptInjector.userScripts(
        from: bundle(), url: URL(string: "https://example.com/")!, chromeCSS: "x{}"
    )
    #expect(scripts.contains { $0.source.contains("createElement('style')") })
}
```

That last one is deliberate: the chrome inset is a property of the window, not of the page, so it applies wherever the window points — including the login page, which is where you will first see whether the inset is right.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `userScripts(from:url:chromeCSS:)` has no such parameter.

- [ ] **Step 4: Extend ScriptStore and ScriptInjector**

In `ScriptStore.swift`, add `chromeCSS` to `ScriptBundle` and load it, treating absence as normal rather than an error:

```swift
public struct ScriptBundle: Equatable, Sendable {
    public let harness: String
    public let userScript: String
    public let overlay: String?
    public let chromeCSS: String?
    public let metadata: UserScriptMetadata
}
```

and in `load()`, `let chromeCSS = loader.string(named: "chrome-macos.css")`, passed through to the initializer. Update the existing `ScriptStore` tests' expected values for the new field.

In `ScriptInjector.swift`, add the parameter and prepend the style script:

```swift
public static func userScripts(
    from bundle: ScriptBundle,
    url: URL,
    chromeCSS: String? = nil
) throws -> [WKUserScript] {
    var scripts = [
        WKUserScript(source: bundle.harness, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    ]
    if let chromeCSS, let literal = jsonLiteral(chromeCSS) {
        let source = """
        (function () {
            var style = document.createElement('style');
            style.id = 'fmshell-chrome';
            style.textContent = \(literal);
            (document.head || document.documentElement).appendChild(style);
        })();
        """
        scripts.append(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    ...
}
```

Reinstate the `jsonLiteral` helper deleted in Task 11, returning `String?`, for the CSS string only. A stylesheet with a quote or newline in it would otherwise break the surrounding JavaScript, which is the same class of bug the Task 6 tests were written for.

- [ ] **Step 5: Pass the CSS on macOS only, and track fullscreen**

In `WebContainer+macOS.swift`, pass `bundle.chromeCSS` through, and toggle the body class as the window enters and leaves fullscreen, since the traffic lights disappear in fullscreen and the inset must go with them:

```swift
func observeFullScreen(_ window: NSWindow, webView: WKWebView) {
    let center = NotificationCenter.default
    center.addObserver(forName: NSWindow.didEnterFullScreenNotification, object: window, queue: .main) { _ in
        MainActor.assumeIsolated {
            webView.evaluateJavaScript("document.body.classList.add('fmshell-fullscreen')")
        }
    }
    center.addObserver(forName: NSWindow.didExitFullScreenNotification, object: window, queue: .main) { _ in
        MainActor.assumeIsolated {
            webView.evaluateJavaScript("document.body.classList.remove('fmshell-fullscreen')")
        }
    }
}
```

`WebContainer.swift` must NOT pass `chromeCSS`; the iOS path leaves it nil.

- [ ] **Step 6: Verify visually**

Build and launch the Mac app. Confirm the search field and the buttons to its left are clear of the traffic lights, with no visible gap between the inset and Fastmail's own content. Enter fullscreen with ⌃⌘F and confirm the inset disappears and the header sits flush. Adjust `--fmshell-titlebar-inset` if the spacing is wrong and re-verify.

Record the final value you settled on in the report.

- [ ] **Step 7: Run the suites and commit**

```bash
make test
git add Packages
git commit -m "feat: inset Fastmail's page header clear of the traffic lights"
```

---

### Task 13: Titlebar tint from the page

The window edges and the area behind the content should carry Fastmail's colour rather than the system default, so the window reads as one surface the way the screenshot does.

Fastmail publishes `<meta name="theme-color" content="#d6d8da">` with no `media` attribute, so it does not vary by colour scheme; it also carries a `t-light` or `t-dark` class on `<html>`. The tint therefore comes from the meta, and the light/dark decision comes from the tint's own luminance rather than from the class, so it stays correct if Fastmail renames its themes.

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/ThemeColor.swift`
- Create: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ThemeColorTests.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/NativeBridge.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer.swift`
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebContainer+macOS.swift`

**Interfaces:**
- Consumes: `NativeBridge`, `ShellModel`
- Produces: `ThemeColor.components(fromHex:) -> (Double, Double, Double)?`, `ThemeColor.isDark(_:) -> Bool`; bridge action `theme` with payload `{color: String}`

- [ ] **Step 1: Write the failing tests**

Create `ThemeColorTests.swift`:

```swift
import Testing
@testable import FastmailShellKit

@Test func parsesSixDigitHex() throws {
    let rgb = try #require(ThemeColor.components(fromHex: "#d6d8da"))
    #expect(abs(rgb.0 - 214.0 / 255.0) < 0.001)
    #expect(abs(rgb.1 - 216.0 / 255.0) < 0.001)
    #expect(abs(rgb.2 - 218.0 / 255.0) < 0.001)
}

@Test func parsesWithoutLeadingHash() {
    #expect(ThemeColor.components(fromHex: "d6d8da") != nil)
}

@Test func parsesThreeDigitShorthand() throws {
    let rgb = try #require(ThemeColor.components(fromHex: "#fff"))
    #expect(rgb.0 == 1.0 && rgb.1 == 1.0 && rgb.2 == 1.0)
}

@Test func rejectsMalformedValues() {
    #expect(ThemeColor.components(fromHex: "") == nil)
    #expect(ThemeColor.components(fromHex: "#12345") == nil)
    #expect(ThemeColor.components(fromHex: "#gggggg") == nil)
    #expect(ThemeColor.components(fromHex: "rgb(1,2,3)") == nil)
}

@Test func judgesLightnessByLuminance() {
    #expect(ThemeColor.isDark((0, 0, 0)))
    #expect(!ThemeColor.isDark((1, 1, 1)))
    #expect(!ThemeColor.isDark((214.0 / 255, 216.0 / 255, 218.0 / 255)))
    #expect(ThemeColor.isDark((0.1, 0.1, 0.12)))
}

@Test func weightsGreenMoreThanBlue() {
    #expect(ThemeColor.isDark((0, 0, 1)))
    #expect(!ThemeColor.isDark((0, 1, 0)))
}
```

The last test is the one that catches a plain average being used instead of a luminance formula: pure blue is dark to the eye and pure green is not, but a naive mean calls them identical.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: FAIL, `cannot find 'ThemeColor' in scope`.

- [ ] **Step 3: Implement ThemeColor**

Create `ThemeColor.swift`:

```swift
import Foundation

public enum ThemeColor {
    public static func components(fromHex hex: String) -> (Double, Double, Double)? {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value.hasPrefix("#") { value.removeFirst() }
        if value.count == 3 {
            value = value.map { "\($0)\($0)" }.joined()
        }
        guard value.count == 6, value.allSatisfy({ $0.isHexDigit }) else { return nil }
        guard let number = UInt32(value, radix: 16) else { return nil }
        return (
            Double((number >> 16) & 0xff) / 255.0,
            Double((number >> 8) & 0xff) / 255.0,
            Double(number & 0xff) / 255.0
        )
    }

    public static func isDark(_ rgb: (Double, Double, Double)) -> Bool {
        0.2126 * rgb.0 + 0.7152 * rgb.1 + 0.0722 * rgb.2 < 0.5
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: PASS.

- [ ] **Step 5: Report the theme colour from the harness**

Add to `harness.js`, inside the IIFE, called once at install and again whenever it changes:

```javascript
function reportTheme() {
    var meta = document.querySelector('meta[name="theme-color"]');
    var color = meta ? meta.getAttribute('content') : null;
    if (!color) return;
    post('theme', { color: color });
}

function watchTheme() {
    reportTheme();
    var observer = new MutationObserver(reportTheme);
    if (document.head) {
        observer.observe(document.head, { attributes: true, childList: true, subtree: true });
    }
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
```

Call `watchTheme()` from the IIFE, after `installRouteHooks()`. Observing the `<html>` class as well as the head matters because Fastmail may swap themes without replacing the meta element.

- [ ] **Step 6: Route the action and publish the tint**

In `NativeBridge.swift`, add a `theme` case alongside `log` and `error`, taking `payload["color"] as? String` and calling a new `onTheme` closure. An unknown or unparseable colour must produce a rejected promise, not be silently ignored.

In `WebContainer.swift`, add `@Published public var tint: String?` to `ShellModel` and set it from the bridge, hopping to the main actor with `Task { @MainActor in }` exactly as the banner does.

- [ ] **Step 7: Apply it on macOS**

In `WebContainer+macOS.swift`, observe the model's tint and apply it to the window:

```swift
func applyTint(_ hex: String, to window: NSWindow) {
    guard let rgb = ThemeColor.components(fromHex: hex) else { return }
    window.backgroundColor = NSColor(
        srgbRed: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1
    )
    window.appearance = NSAppearance(named: ThemeColor.isDark(rgb) ? .darkAqua : .aqua)
}
```

A colour that fails to parse leaves the window as it was rather than falling back to a guess.

iOS takes no action in this task; the safe-area tint is deferred.

- [ ] **Step 8: Verify**

Launch the Mac app and confirm the window background matches Fastmail's own header colour at the rounded corners and during a resize, and that the traffic lights and any title text remain legible. Switch Fastmail between its light and dark themes in settings and confirm the window follows.

- [ ] **Step 9: Run the suites and commit**

```bash
make test
git add Packages
git commit -m "feat: tint the window from the page's theme-color"
```
