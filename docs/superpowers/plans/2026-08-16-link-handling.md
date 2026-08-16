# Link Handling: Schemes, mailto, Share Extensions, Handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every URL arriving from outside — custom scheme, `mailto:`, a share-sheet handoff — lands in the right profile at the right view, through one tested router. A link captured from the work account opens in the work app even when it arrives at the personal one.

**Architecture:** `LinkRouter` is pure logic in the package, the `NavigationPolicy`/`StartView` shape: input URL plus profile in, a routing decision out, every rule unit-tested with no WebKit or platform imports. The platforms feed it: `onOpenURL` in both app scenes, `CFBundleURLTypes` declared per target in `project.yml` from `Profile.urlScheme`, and one share-extension target per profile whose only job is reaching the containing app through that scheme. Account identity rides the existing `FMAccountID` Info.plist plumbing; the identifiers themselves never enter the repository.

**Tech Stack:** SwiftUI `onOpenURL`, XcodeGen extension targets, `NSExtensionContext`, Swift Testing.

## Global Constraints

- No code comments. Ship bare code.
- Swift 6 strict concurrency. No third-party dependencies.
- No account identifier, team ID, email address or message subject in any tracked file. Account IDs flow only through `Config/Local.xcconfig` → Info.plist → `Profile`.
- `open` accepts `app.fastmail.com` URLs only. Anything else is refused with a banner — an unchecked scheme is an open redirect into a logged-in mail session, the one genuine security hole this feature could create.
- Handoff is one hop: a URL carrying `handoff=1` loads locally regardless of account, or two apps bounce a foreign link forever.
- A missing `FMAccountID` degrades: links load locally, handoff is skipped, nothing fails.

---

### Task 0: Pin the compose URL template

- [x] **Step 1:** Read the template Fastmail registers for `mailto:` itself — `navigator.registerProtocolHandler` in the live app, or the compose URL an open compose window shows — rather than inventing a parameter mapping. Record the template and its `subject`/`body`/`to` encoding in `docs/superpowers/spike-findings.md`.

### Task 1: `LinkRouter`

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/LinkRouter.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/LinkRouterTests.swift`

**Interfaces:**
- Produces: `LinkRouter.route(_ url: URL, profile: Profile) -> Route` where `Route` is `load(URL)`, `handoff(URL)`, or `refuse(String)`.

- [x] **Step 1:** Rules, each a test: scheme `open?url=` with a `app.fastmail.com` URL loads; any other host refuses with a banner message; `compose?mailto=` translates through the Task 0 template and appends the profile's `u=`; a raw `mailto:` (macOS) translates the same way; an `https://app.fastmail.com` URL whose `u=` matches the profile (or is absent) loads; a mismatched `u=` becomes `handoff(other-scheme URL + handoff=1)`; anything carrying `handoff=1` loads locally no matter what; a nil `accountID` never hands off.
- [x] **Step 2:** `mailto:` translation covers `to`, `subject`, `body`, `cc` with percent-encoding round-trips tested.

### Task 2: Declare and receive the schemes

**Files:**
- Modify: `project.yml` (per-target `CFBundleURLTypes`: `fastmail-personal` / `fastmail-work`; both targets also declare `mailto` on macOS), `Apps/Personal/PersonalApp.swift`, `Apps/Work/WorkApp.swift`, `AppShell.swift`.

- [x] **Step 1:** `onOpenURL` feeds `LinkRouter`; `load` drives the web view, `refuse` raises the banner, `handoff` calls `NSWorkspace.open` / `UIApplication.open` and, when the open fails (other app missing), loads locally with a banner naming the account mismatch.
- [x] **Step 2:** After `xcodegen generate`, verify the built Info.plists carry the schemes and nothing secret.

### Task 3: iOS share extensions

**Files:**
- Create: `Extensions/PersonalShare/`, `Extensions/WorkShare/` (minimal principal class + Info.plist via `project.yml` extension targets).

- [x] **Step 1:** Each accepts `public.url` only, titled "Open in Fastmail" / "Open in Fastmail Work". Non-Fastmail URLs are rejected in the extension UI so the failure is visible at the point of sharing.
- [x] **Step 2:** A accepted URL becomes `fastmail-<profile>://open?url=…` opened through `NSExtensionContext.open(_:)` — the reason the scheme exists, since an extension cannot reach `UIApplication`.
- [x] **Step 3:** Signing rides the same automatic provisioning; bundle IDs `com.mdbraber.fastmail.personal.share` / `.work.share`.

### Task 4: macOS default mail reader

- [ ] **Step 1:** With `mailto` declared, macOS offers the app in Mail settings' default-reader picker. Verify choosing it routes a `mailto:` click from another app into a compose window with the right account's `u=`.

## Verification

- `make test` green; every `LinkRouter` rule has a test, including the bounce-loop guard.
- `open "fastmail-personal://open?url=https%3A%2F%2Fapp.fastmail.com%2Fmail%2FInbox%2F"` lands in the personal app's Inbox; a non-Fastmail URL in the same shape shows the refusal banner and loads nothing.
- Share a Fastmail URL from Safari on iOS → "Open in Fastmail" appears and opens the app at that URL; a random URL is rejected inside the sheet.
- A URL with the other profile's `u=` opens the other app once, and a crafted `handoff=1` URL does not bounce back.
