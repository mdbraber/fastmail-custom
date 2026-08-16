# Harness Capabilities: Current Link, Share, Badge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two native capabilities the shell exists to provide — the system share sheet and a link to the open message — plus the unread app-icon badge. All three read Fastmail's state through its own object layer, never its markup, and fall back to markup only where no state surface exists.

**Architecture:** `harness.js` grows `currentLink()`, `share()`, `addMenuItem()`, and `setBadge()`. The subject and URL of the open message come from the mail controller (`FastMail.router.getAppController('mail')`), the same surface the userscript patches. The Share menu item is added by wrapping the message-actions menu's `menuView` computed property and pushing a `FastMail.classes.ButtonView` into its options — the identical pattern the userscript uses for the filter menu and verb pickers — never by observing the DOM for menu nodes. The badge count comes from `window.customInboxMode`'s exact server-computed counts when the userscript is running, with a sidebar-badge read as the only fallback. Native side: a `share` bridge action publishes a request on `ShellModel` and `AppShell` presents it (the existing banner pattern); `BadgeController` applies counts per platform.

**Tech Stack:** Swift 6, SwiftUI, WebKit (`WKScriptMessageHandlerWithReply`), `UNUserNotificationCenter` (iOS badge), `NSDockTile` (macOS badge), `UIActivityViewController` / `NSSharingServicePicker`, Swift Testing + XCTest integration tests.

## Global Constraints

- No code comments. Ship bare code.
- Swift 6 strict concurrency. No third-party dependencies.
- Never add `WKAppBoundDomains` to any Info.plist.
- No account identifier, team ID, email address or message subject in any tracked file.
- Package tests use Swift Testing; `Tests/IntegrationTests` uses XCTest.
- `isInspectable = true` is intentional; preserve it.
- Everything injected runs in the page content world; the bridge stays registered against `WKContentWorld.page`.
- Never key off generated element ids (`#v308`), label text, or `document.title`. Find Fastmail UI through `FastMail.getViewFromNode`, view classes, actions, and shortcuts; find data through the store and controllers. The title is rewritten by the userscript and is not a data source.
- Menu and toolbar patches must be idempotent (marker property, same as the userscript's `customFilterOption`) and re-applied when views are rebuilt.

---

### Task 0: Pin the state surfaces live

Read-only probes against a logged-in session in Safari (desktop layout) and the same session under an iPhone user agent (mobile layout). Record findings in `docs/superpowers/spike-findings.md`.

- [ ] **Step 1:** Pin the open-message surface: from `FastMail.router.getAppController('mail')`, the property path that yields the open thread/message record and its subject, on both layouts, and confirm `controller.getUrlForMessage(message)` yields the canonical URL with `u=` preserved.
- [ ] **Step 2:** Pin the message-actions menu: which view owns it (`getViewFromNode` on the ⋯ button), whether `menuView` is a computed property (check `isProperty` / `isVolatile`), and a behavioural identifier for its options (actions or shortcuts carried by Reply/Forward options, not their labels).
- [ ] **Step 3:** Pin the badge sources: `window.customInboxMode.countFor` for the Inbox mailbox record, and the `.v-MailboxSource` badge node shape for the fallback.
- [ ] **Step 4:** iOS offline spike, since the phone build is now daily-driven: load the mailbox, Airplane Mode, relaunch; record whether `navigator.serviceWorker.controller` is live and the mailbox renders. No code change either way — this bounds what the badge and share can assume offline.

### Task 1: `currentLink()` in the harness

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/Resources/harness.js`
- Test: `Tests/IntegrationTests/HarnessTests.swift`, `Tests/IntegrationTests/fixture.html`

**Interfaces:**
- Produces: `native.currentLink() -> Promise<{url, title, markdown}>`; `native.subjectResolver` (assignable override).

- [ ] **Step 1:** Resolution order: an assigned `subjectResolver`; then the controller surface pinned in Task 0 (subject + `getUrlForMessage`); then the DOM fallbacks `.v-Thread-title h1` and `.v-MailboxItem.is-focused .v-MailboxItem-subject` with `location.href` as the URL. Trim and collapse whitespace. Reject with `"No message open"` when nothing matches — a mailbox has no subject and a silently wrong title is worse than a visible error.
- [ ] **Step 2:** `markdown` is `[title](url)`, brackets in the title escaped.
- [ ] **Step 3:** Integration tests drive the fixture (which carries the `.v-Thread-title h1` structure): fallback resolution, whitespace collapse, override wins, rejection when empty.

### Task 2: Share — bridge action, presenters, anchoring

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/SharePresenter.swift`
- Modify: `NativeBridge.swift`, `WebContainer.swift` (ShellModel), `AppShell.swift`, `harness.js`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/NativeBridgeTests.swift`

**Interfaces:**
- Consumes: `native.share({url, text, rect}) -> Promise<void>` from the page.
- Produces: `ShellModel.shareRequest: ShareRequest?` (`@Published`), resolved on dismissal through the bridge's reply handler.

- [ ] **Step 1:** Bridge `share` action parses `{url?, text?, rect?}`; malformed payloads reply with a rejected promise (existing error path). The reply is held and completed when the sheet dismisses.
- [ ] **Step 2:** `rect` is `getBoundingClientRect()` shape in page coordinates; convert to view coordinates in native. Absent rect anchors to the web view's centre — degrade, never crash. On iPad the popover anchor is a correctness requirement (`popoverPresentationController` traps unanchored); `NSSharingServicePicker.show(relativeTo:of:preferredEdge:)` needs the same rect.
- [ ] **Step 3:** `AppShell` observes `shareRequest` and presents `UIActivityViewController` / `NSSharingServicePicker` through `SharePresenter`; presentation is state-driven, never reached through the view hierarchy.
- [ ] **Step 4:** Unit tests: payload parsing (url only, text only, both, junk), rect conversion arithmetic, absent-rect fallback.

### Task 3: macOS toolbar share

**Files:**
- Modify: `AppShell.swift` (macOS-only toolbar), `WebCoordinator.swift` if the button needs the web view.

- [ ] **Step 1:** A minimal macOS toolbar: Share and Reload. Share evaluates `native.currentLink()` in the page and feeds the result to `SharePresenter`, anchored to the toolbar button. `currentLink` rejection surfaces as the standard banner.
- [ ] **Step 2:** ⌘R reloads; iOS stays chromeless.

### Task 4: `addMenuItem` through the view layer, Share as first consumer

**Files:**
- Modify: `harness.js`
- Test: manual against the live session (both layouts), plus an integration test that the API exists and validates its arguments.

**Interfaces:**
- Produces: `native.addMenuItem({id, label, icon, onSelect})`, idempotent per `id`.

- [ ] **Step 1:** Wrap the owning view's `menuView` computed (pinned in Task 0) exactly as the userscript wraps the filter button's: call the original, push a `FastMail.classes.ButtonView` whose `chooseItem` runs `onSelect`, marker property for idempotence, `isLastOfSection` handled so the item forms its own section. Copy enumerable function properties when wrapping so `isProperty`/`isVolatile` survive.
- [ ] **Step 2:** Identify the message-actions menu by the behavioural marker from Task 0, never by option labels.
- [ ] **Step 3:** The Share item: label `Share`, inlined 24×24 SVG (Fastmail's sprite has no share icon), `onSelect` = `currentLink()` then `share()` anchored to the menu item's layer rect.
- [ ] **Step 4:** Verify live on desktop and mobile layouts: item present, menu reopens cleanly, no duplicates after repeated opens, Fastmail's own items untouched.

### Task 5: Unread badge

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/BadgeController.swift`
- Modify: `harness.js`, `NativeBridge.swift`, `WebContainer.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/BadgeControllerTests.swift`

**Interfaces:**
- Produces: `native.setBadge(count)`; `native.badgeResolver` (assignable); `BadgeController.apply(_ count: Int?)`.

- [ ] **Step 1:** Default resolver: when `window.customInboxMode` is present and on, use its exact Inbox count (`countFor` on the Inbox record — server-computed, always agrees with the sidebar); otherwise read the Inbox `.v-MailboxSource` badge text. `badgeResolver` overrides both.
- [ ] **Step 2:** Push on `onRoute` and on a debounced tick; native additionally pulls a fresh count on foregrounding via `callAsyncJavaScript` rather than trusting the last push.
- [ ] **Step 3:** `BadgeController`: iOS `UNUserNotificationCenter.setBadgeCount`, `.badge` authorization requested on the first non-zero count, declined authorization silences future asks; macOS `dockTile.badgeLabel`, no authorization. Zero clears; `nil` (no count found) leaves the badge unchanged — absence is not zero.
- [ ] **Step 4:** Unit tests: zero clears rather than shows `0`, nil leaves unchanged, declined auth not re-requested.

## Verification

- `make test` green (package + integration).
- Live, desktop layout: open a message, toolbar Share shows the sheet anchored to the button with `[subject](url)` available; menu Share item does the same anchored to the menu; no message open → banner, not a wrong link.
- Live, mobile layout (iPhone UA or the installed app): the ⋯ menu carries Share; the sheet anchors sensibly.
- Badge: mailbox with unread → icon badge matches the sidebar exactly (userscript on), survives backgrounding, clears at zero.
- Repeated navigation and menu opening produce no duplicate items and no console errors.
