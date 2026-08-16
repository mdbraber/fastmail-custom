# Automation and Windows: Registry, Intents, AppleScript, Compose

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app answers automation — Shortcuts on both platforms, Apple Events on the Mac — and the Mac build behaves like a document app: multiple windows and tabs that automation addresses correctly, and a ⌘N compose that feels instant.

**Architecture:** A `WebViewRegistry` resolves "the current web view" from the key window, because a singleton reference works perfectly until the first second tab; every intent, script command, and badge read goes through it (on iOS it resolves the only view there is). App Intents wrap the harness surfaces built in the harness-capabilities plan (`currentLink`, `registerAction`). AppleScript mirrors Safari's dictionary so existing habits carry over. Compose preloads a web view in an ordered-out window so ⌘N orders in rather than loads.

**Depends on:** `2026-08-16-harness-capabilities.md` (subject resolution, `registerAction`).

**Tech Stack:** App Intents, `.sdef` + `NSScriptCommand`, SwiftUI `WindowGroup`/`commands`, Swift Testing.

## Global Constraints

- No code comments. Ship bare code.
- Swift 6 strict concurrency. No third-party dependencies.
- No account identifier, team ID, email address or message subject in any tracked file.
- Keyboard digits belong to the userscript: it binds both ⌘1–⌘9 and ⌥1–⌥9 to source navigation, and a menu key equivalent silently beats a web view handler. Native takes no digit bindings at all; tab switching keeps only the system defaults (⌃⇥, the Window menu).
- `RunJavaScript` and `do JavaScript` reach a logged-in mail session without a gate. Deliberate on a single-user machine; first thing to revisit if the apps are ever shared.
- Intent titles carry the profile name, so the two apps are distinguishable in the Shortcuts picker.

---

### Task 1: `WebViewRegistry`

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/WebViewRegistry.swift`
- Modify: `WebContainer.swift` (register on make, unregister with the coordinator's lifetime)
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/WebViewRegistryTests.swift`

- [x] **Step 1:** `@MainActor` registry of live views keyed by window; `var active: WKWebView?` resolves from the key window, iOS returns the sole view, and the last window closing resolves to nil rather than a stale reference.
- [x] **Step 2:** Tests: registration, key-window resolution, last-window-closed.

### Task 2: App Intents

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/Intents/` (`OpenFastmail`, `GetURL`, `GetTitle`, `GetCurrentLink`, `RunJavaScript`, `RunScriptAction`, `MailLink` entity)
- Modify: `harness.js` (`registerAction(name, fn)` + a bridge action persisting registered names), `NativeBridge.swift`

- [x] **Step 1:** All set `openAppWhenRun = true` — the values live in the web view and only exist while it runs. Each acts on `WebViewRegistry.active`.
- [x] **Step 2:** `GetCurrentLink` returns the `MailLink` transient entity (`url`, `title`, `markdown`) from `native.currentLink()`; `GetURL` and `GetTitle` are conveniences over the same call, because pulling one value out of an entity is clumsy in a shortcut. "No message open" propagates as an intent error.
- [x] **Step 3:** `RunJavaScript(script)` evaluates via `callAsyncJavaScript`, awaits a returned promise, coerces the result to text.
- [x] **Step 4:** `RunScriptAction(name)` invokes a `registerAction` registration; the parameter's options come from the names last persisted to `UserDefaults` through the bridge. Adding an action to the userscript then needs no rebuild.
- [x] **Step 5:** `OpenFastmail(path?)` opens the app, optionally navigating to an `app.fastmail.com` path (same host rule as everywhere).

### Task 3: AppleScript

**Files:**
- Create: `Apps/Shared/Fastmail.sdef`, `Packages/FastmailShellKit/Sources/FastmailShellKit/ScriptCommands.swift`
- Modify: `project.yml` (`NSAppleScriptEnabled`, `OSAScriptingDefinition`, macOS targets only)

- [x] **Step 1:** The dictionary mirrors Safari: `windows` (tabs are windows under macOS tabbing, so they enumerate for free), each with `URL` and `name`, where `name` is the resolved subject matching `GetTitle`.
- [x] **Step 2:** `do JavaScript … in front window` via an `NSScriptCommand` subclass: `suspendExecution()` before `callAsyncJavaScript`, `resumeExecution(withResult:)` from the completion — never block the main thread, never return early with nothing.
- [ ] **Step 3:** Verify with `osascript`: `get URL of front window`, `get name of front window`, `do JavaScript "document.title" in front window`. *Deferred: the machine's screen was locked during execution, so the one-time Apple Events consent prompt (osascript → app) could not be approved; `quit`/`activate` (consent-exempt) confirmed AE delivery, and `get name` of the application answered from the dictionary. Run the three commands once unlocked and approve the prompt.*

### Task 4: Compose

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/ComposePool.swift`
- Modify: `Apps/Personal/PersonalApp.swift`, `Apps/Work/WorkApp.swift` (commands), `AppShell.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/ComposePoolTests.swift`

- [x] **Step 1:** ⌘N is Compose, displacing New Window to ⇧⌘N; ⌘T keeps native tabs. Compose opens its own window outside the tab group — a draft is a task, not another view of the mailbox.
- [x] **Step 2:** The pool: one compose view loaded at launch into an ordered-out window (WebKit needs a real window to render into). ⌘N orders it in; nothing loads at press time. A closed compose window reloads the compose URL and returns to the pool; ⌘N on an empty pool creates a fresh window and accepts the delay.
- [x] **Step 3:** The compose URL is the template pinned in the link-handling plan, with the profile's `u=` appended. The userscript stays inert there by its own readiness gate.
- [x] **Step 4:** Pool tests: spent view returns reloaded, empty pool creates rather than fails.

### Task 5: Titlebar tint repaint

**Files:**
- Modify: `WebContainer+macOS.swift` (`applyTint`)

- [x] **Step 1:** The recorded limitation: a theme change on an already-open window never repaints, though every value reads back correct. Try the one cheap ordering fix first — set `window.appearance` before `window.backgroundColor` (currently the reverse), on the hypothesis that assigning appearance resets the background. Verify live by toggling Fastmail's theme; if it holds, close the limitation note in the progress log, and if not, record the negative result and stop. *The ordering fix already landed in `fba16e1` (appearance before backgroundColor, plus `needsDisplay` and `invalidateShadow`); only the live theme-toggle check remains, deferred with the other screen-locked verifications.*

## Verification

- `make test` green.
- Shortcuts app: both profiles' intents listed separately; `GetCurrentLink` on an open message yields working markdown; `RunScriptAction` lists names registered by the userscript.
- Two tabs open: every "current" surface — intents, `do JavaScript`, share, badge — follows the key window.
- ⌘N with a mailbox window frontmost: compose appears instantly, in its own window; close it, ⌘N is instant again; two composes in a row both work.
- ⌘1–⌘9 and ⌥1–⌥9 still jump sources inside the page.
