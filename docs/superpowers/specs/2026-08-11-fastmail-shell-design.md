# Fastmail Shell — Design

Date: 2026-08-11
Status: Approved

## Goal

Installable apps that each wrap `app.fastmail.com` in a `WKWebView` and inject a user-authored JavaScript file, so the Fastmail web UI can be modified (DOM and CSS) in ways a Home Screen PWA cannot allow. One app holds the `mdbraber.com` session, the other the `nexthealth.nl` session, switchable from the Home Screen or the Dock.

Two profiles across two platforms, so four products from two multiplatform targets: iOS and macOS, personal and work.

The script must be editable from a Mac without rebuilding the app, and must be shared across all four products. The script must also be able to reach two native capabilities: the system share sheet, and Shortcuts.

## Non-goals

Multiple sites or URL-pattern matching. Content blocking or request interception. Response rewriting. Push or local notifications. Offline caching. In-app script editing. Remote script updates. App Store distribution.

No unread-count badge. A badge can only be updated while the app runs, so a truthful one requires polling Fastmail's JMAP API from a background task, which requires storing an API token per profile. Not worth a stored credential. The app therefore holds no Fastmail credentials of its own; the only session state is the web view's cookies.

## Platform constraints

These were verified before design and each one shapes a decision:

1. **App-Bound Domains must not be used.** Adding `WKAppBoundDomains` to Info.plist puts every `WKWebView` in the app into a mode that denies script injection, custom stylesheets, and message handlers. The `limitsNavigationsToAppBoundDomains` flag is meant to restore them but is reported to still conflict with `addUserScript`. The app therefore does not declare the key. iOS only; the restriction does not exist on macOS.
2. **Passkey login is unavailable.** WebAuthn in a `WKWebView` requires Associated Domains between the app and the relying party, which requires an `apple-app-site-association` file on `fastmail.com`. Not controllable. Login is password plus TOTP, once per app per platform, persisted in cookies. Applies to both platforms.
3. **Service workers may not run**, as WKWebView ties them to app-bound domains. Accepted risk; verified in Milestone 0. iOS only.
4. **Web push does not exist in `WKWebView`.** No new-mail notifications. Accepted.

Constraints 1 and 3 are the reason the macOS build is the better place to develop the userscript: neither applies there.

## Approach

A native SwiftUI app with no third-party dependencies. Shared logic lives in a local Swift package; the two app targets are thin, holding only configuration, icons, and a profile constant.

Each app target is multiplatform, declaring both iOS and macOS as supported destinations, rather than four separate targets. A profile therefore keeps one bundle identifier across platforms, which in turn means one iCloud container and one identity per profile — the mechanism by which a single `userscript.js` reaches all four products.

Rejected alternatives: the Userscripts Safari extension (no native bridge, no app identity); a Capacitor/Tauri wrapper (a JS toolchain wrapped around a few hundred lines of Swift); and Mac Catalyst, which would remove the three platform shims below at the cost of an iPad-flavoured window on the Mac.

A Safari Web Extension of this script already exists at `~/src/fastmail-customized/safari-extension`, with an Xcode host app. It remains useful for Safari itself. It cannot serve a Home Screen web app, which is what prompted this project: Safari extensions do not run in Home Screen web apps, so on iOS the script has nowhere to run today.

## Project layout

```
~/src/fastmail-app/
  FastmailShell.xcodeproj
  Packages/FastmailShellKit/Sources/FastmailShellKit/
    AppShell.swift
    WebContainer.swift
    WebContainer+iOS.swift
    WebContainer+macOS.swift
    SharePresenter.swift
    ScriptStore.swift
    ScriptInjector.swift
    NativeBridge.swift
    NavigationPolicy.swift
    Profile.swift
    Intents/
  Packages/FastmailShellKit/Resources/harness.js
  Apps/Personal/{Info.plist, Assets.xcassets, PersonalApp.swift}
  Apps/Work/{Info.plist, Assets.xcassets, WorkApp.swift}
  tools/extract-icons.swift
  docs/superpowers/specs/
```

Deployment targets iOS 17 and macOS 14.

## Platform shims

Everything except these three is platform-agnostic — `ScriptStore`, `ScriptInjector`, `NativeBridge`, `NavigationPolicy`, `harness.js`, the subject selectors, and all App Intents compile unchanged on both.

| Concern | iOS | macOS |
|---|---|---|
| Web view host | `UIViewRepresentable` | `NSViewRepresentable` |
| Share | `UIActivityViewController` | `NSSharingServicePicker` |
| Refresh affordance | pull-to-refresh | toolbar button and ⌘R |

`WKWebView` itself is identical across platforms; on macOS it is an `NSView` subclass. The `native.share(...)` JavaScript contract is unchanged by the shim — only the presenter differs.

## Profile model

`Profile` is a struct with `id`, `displayName`, `startURL`, and `overlayScriptName`. Each app target instantiates exactly one, on both platforms.

| | Personal | Work |
|---|---|---|
| Bundle ID | `com.mdbraber.fastmail.personal` | `com.mdbraber.fastmail.work` |
| Display name | Fastmail | Fastmail Work |
| Overlay script | `userscript.personal.js` | `userscript.work.js` |
| Icon source | `~/Applications/mdbraber.com.app` | `~/Applications/nexthealth.nl.app` |

Separate bundle IDs give separate app containers, so `WKWebsiteDataStore.default()` yields two independent cookie jars and two concurrent Fastmail sessions. This is the entire mechanism behind profile switching; no in-app account handling is required.

Cookies do not sync between platforms, so each profile is logged in once on iOS and once on macOS. This is a consequence of the cookie jar being local to the app container, not a design choice, and it is the only per-platform setup step.

Both targets declare the same iCloud container, `iCloud.com.mdbraber.fastmail`, so the shared script is authored once and reaches all four products.

## Icons

Both icons already exist and are already distinct; they are reused rather than redesigned.

- **Personal** — a green recolour of the Fastmail envelope. It is a Finder-set custom icon, stored as a resource fork on a zero-byte `Icon\r` file at the root of `~/Applications/mdbraber.com.app`, and it overrides the bundle's `ApplicationIcon.icns`. Reading the `.icns` alone yields the wrong artwork.
- **Work** — the stock blue Fastmail envelope from `~/Applications/nexthealth.nl.app/Contents/Resources/ApplicationIcon.icns`.

Both are extracted the same way, via `NSWorkspace.icon(forFile:)`, which resolves whichever icon macOS actually displays and offers representations up to 2048×2048. The extraction is kept in the repository as `tools/extract-icons.swift` so the assets can be regenerated.

The macOS builds use the extracted artwork as-is: it is already an inset squircle with a drop shadow, which is exactly the macOS `AppIcon` convention.

The iOS builds need a conversion, since an iOS `AppIcon` must be a fully opaque square with no alpha and no pre-applied corner rounding. The artwork is scaled to full bleed (roughly 1.15–1.2×, letting the corners run past the edge where the iOS mask cuts them), composited onto an opaque backdrop, and exported at 1024×1024 with alpha removed.

A single asset catalog per target holds both, using platform-specific icon sets.

## Components

**`AppShell`** — root SwiftUI view. Hosts the web container, a toolbar (reload page, share current URL, reload script), and a dismissible error banner bound to a published error state.

**`WebContainer`** — the representable wrapping `WKWebView`, with the platform variants in `WebContainer+iOS.swift` and `WebContainer+macOS.swift`. Sets `isInspectable = true` so Safari Web Inspector attaches to the injected script. Owns the navigation delegate.

**`SharePresenter`** — presents `UIActivityViewController` or `NSSharingServicePicker` behind one interface, so `NativeBridge` has no platform branches.

**`ScriptStore`** — a protocol with two implementations behind one publisher of `ScriptBundle(shared: String?, overlay: String?)`. `RepositoryScriptStore` (macOS) watches the repository file with a `DispatchSource` on its directory, which survives the write-and-rename that editors perform on save. `UbiquitousScriptStore` (iOS) resolves the container via `FileManager.url(forUbiquityContainerIdentifier:)`, calls `startDownloadingUbiquitousItem` for items not yet local, and observes `Documents/` with an `NSMetadataQuery`.

**`ScriptPublisher`** — macOS only. Writes the repository content into the iCloud container so iOS receives edits between builds. The single direction of flow, repository to container, is what keeps the two stores from fighting.

**`BundledScriptStore`** — reads the copy placed in the app bundle by the build phase. The fallback under both platform stores, and the reason no state exists in which the app has no script.

**`ScriptInjector`** — parses the metadata block, then builds one `WKUserScript`: the bundled `harness.js` with the user script and overlay embedded as JSON-encoded string literals. Injected at `.atDocumentStart`, `forMainFrameOnly: true`, into `WKContentWorld.page`. On any change it calls `removeAllUserScripts()`, re-adds, and reloads the web view.

**`NativeBridge`** — a single `WKScriptMessageHandlerWithReply` registered as `native` via `addScriptMessageHandler(_:contentWorld:name:)` against `WKContentWorld.page`, so the page-world script can see it. Message body is `["action": String, "payload": [String: Any]]`. Unknown actions and malformed payloads reply with an error string, surfacing in JS as a rejected promise.

**`NavigationPolicy`** — in `decidePolicyFor`, allows `fastmail.com` and its subdomains; everything else is cancelled and opened in the default browser, via `UIApplication.open` or `NSWorkspace.open`.

## Script source

The script to run is an existing one: `~/src/fastmail-customized/fastmail-inbox-mode.user.js`, which adds a sticky Inbox filter on labels and Inbox-only sidebar badge counts. The repository stays canonical and versioned; the app never becomes the place the script lives.

A symlink from the iCloud container to the repository does not work. iCloud Drive does not sync a symlink as content, and an iOS device has no `~/src/fastmail-customized` to resolve it against. Hard links fail for a different reason: editors that save atomically write a new file and rename over the old one, severing the link on first save.

Every build therefore embeds the current script, and the live sources layer on top of it.

**Build-phase copy.** A `Copy User Script` run-script phase copies the repository file into the app bundle's resources on every build of every target. The source path comes from a `USERSCRIPT_PATH` build setting in an xcconfig rather than being hardcoded in the phase. The phase declares its input and output files so incremental builds behave, and it fails the build when the source is missing — an app silently shipping a stale script is the failure worth preventing.

This makes the bundled copy a guaranteed-current baseline. There is no state in which the app has no script, so iCloud availability, sync lag, and whether the Mac app has run recently all stop being correctness concerns and become convenience ones.

**Runtime override.** On top of the baseline, each platform watches a live source so edits land without a rebuild:

| Platform | Live source | Watched with |
|---|---|---|
| macOS | the repository file directly | `DispatchSource` on the containing directory |
| iOS | the iCloud container | `NSMetadataQuery` |

Resolution order is live source, then bundled copy. The live source wins when it is non-empty and its metadata block parses; otherwise the bundle is used. On macOS the two are the same file, so they only diverge if a build is older than the working tree.

The macOS app additionally publishes the repository content into the iCloud container when it changes, so iOS picks up edits between builds. This is now a convenience path rather than the only path.

```
repo/fastmail-inbox-mode.user.js
  → build phase copies into each app bundle
  → at runtime: macOS DispatchSource / iOS NSMetadataQuery, else bundled copy
  → debounce 300ms
  → reject empty or unparseable content, retain last good copy
  → parse metadata block
  → removeAllUserScripts() + re-add bootstrap
  → reload
  → (macOS only) publish content to the iCloud container
```

**macOS sandboxing.** Reading the repository directly is outside an app container, so it requires either the App Sandbox switched off or a security-scoped bookmark from a user-selected file. Distribution is local and signed with a Developer ID, never the App Store, so the sandbox is switched off and the complexity of bookmarks avoided. Recorded here because it is the kind of decision that looks arbitrary later.

The debounce and last-good retention exist because the file is written from an editor while the app is running; a partially written file must never replace a working script. This matters most on macOS, where the editor and the app share a disk and the window visibly reloads as you save. The refresh affordance forces a re-read for when iCloud sync lags.

When the iCloud container is unavailable on iOS, the bundled copy is used and nothing is reported. That is a normal state, not an error.

## User script metadata

The file carries a Greasemonkey-style metadata block, which the harness honours rather than ignores:

```
// @match        https://app.fastmail.com/*
// @run-at       document-idle
// @inject-into  context
// @grant        none
```

**`@run-at`** is why the user script is not added as its own `WKUserScript`. Only the harness is injected, at `.atDocumentStart`; `ScriptInjector` embeds the user script's text into the harness bootstrap as a JSON-encoded string literal, and the harness evaluates it at the moment the metadata asks for — `document-idle` meaning after the `load` event. Injecting this particular script at document start would run it before `document.body` exists, and its observer setup would throw. Evaluating from the harness also gives the try/catch wrapper and the error reporting for free.

**Content world.** The script requires `window.FastMail` — it reads `FastMail.store`, `FastMail.classes`, `FastMail.router`, and `FastMail.getViewFromNode` to patch Fastmail's own badge drawing, source navigation, and drag handling. That is only reachable from the page content world, which is what `@inject-into context` requests. `WKUserScript` injects into the page world by default, so this works, but it must be explicit and must not be "improved" later by moving to an isolated world.

The message handler is consequently registered with `addScriptMessageHandler(_:contentWorld:name:)` against `WKContentWorld.page`, since a handler registered in a different world is invisible to the script.

The trade-off is that Fastmail's own JavaScript can also see `window.native` and could call `share`. For a personal client against a trusted first-party site this is accepted; it is noted so the decision is deliberate rather than accidental.

**`@grant none`** means the script uses no GM APIs. The GM compatibility shims are therefore dropped from the harness rather than written speculatively; they can be added when a script that needs them appears.

**`@match`** is checked against the loaded URL before evaluating, so a script written for a different site fails loudly rather than silently doing nothing.

## Harness API

`harness.js` ships in the bundle and runs before user scripts. It exposes `window.native`:

- `share({url, text, rect})` → Promise resolving when the share sheet is dismissed. `rect` is optional and takes the shape of `getBoundingClientRect()`; see Share presentation.
- `currentLink()` → `{url, title, markdown}` for the open message, where `title` is the subject alone. Backs both the `GetCurrentLink` intent and the toolbar share button. Rejects when no message is open.
- `subjectResolver` → assignable; overrides the default selector chain.
- `addMenuItem({label, icon, section, onSelect})` → injects an item into Fastmail's message actions menu, matching its markup. See Menu injection.
- `registerAction(name, fn)` → registers a Shortcuts-invocable action; also notifies native so the name can be offered as a Shortcuts parameter option.
- `log(...args)` → Xcode console.
- `onRoute(cb)` → fires on route change. Implemented by patching `history.pushState` and `history.replaceState`, listening for `popstate`, and running a debounced `MutationObserver` on `document.body`. Necessary because `WKUserScript` runs once per document load and Fastmail is client-routed.

User scripts are evaluated by the harness inside a try/catch; a throw is reported to native and shown in the banner rather than failing silently as WebKit would otherwise do. See User script metadata for when evaluation happens.

No GM API shims. The target script declares `@grant none` and needs none.

## Shortcuts

Three App Intents per app, working identically on iOS and macOS, titled with the profile name so the two apps are distinguishable in the Shortcuts picker:

- `OpenFastmail(path: String?)` — opens the app, optionally at a path.
- `GetCurrentLink()` — returns the frontmost URL and cleaned title.
- `RunScriptAction(name: String)` — opens the app, waits for load and action registration, then invokes the action via `callAsyncJavaScript`, awaiting the returned promise, and returns its string result. Parameter options come from the registered action names last persisted to `UserDefaults`.

All three set `openAppWhenRun = true`, since the value lives in the web view and only exists while the app is running.

Adding a further Shortcuts action means adding a `registerAction` call to the script, with no rebuild.

### GetCurrentLink

Returns a `MailLink` transient entity with three properties, so a shortcut can consume whichever it needs:

| Property | Example |
|---|---|
| `url` | `https://app.fastmail.com/mail/Test/?filter=inbox&u=REDACTED` |
| `title` | `Invoice for July` |
| `markdown` | `[Invoice for July](https://app.fastmail.com/mail/Test/?filter=inbox&u=REDACTED)` |

`title` is the subject of the open message and nothing else — no mailbox, no account, no ` | Fastmail` suffix, no unread count.

This rules out `document.title` as the source. Fastmail renders it as `In Inbox • Test | Fastmail` (observed 2026-08-11), which is mailbox context rather than subject, so no amount of suffix-stripping produces the wanted value. The subject is instead read from the message view's DOM.

The `u=` account parameter in the URL is preserved. It identifies which Fastmail account the link belongs to, so a link captured from the work app still opens as the work account rather than whichever session happens to be active.

Subject resolution lives in `harness.js`, not in Swift, so a Fastmail markup change is fixed by editing the script rather than rebuilding and re-signing both apps. The candidate chain, first non-empty match wins, verified against a live message on 2026-08-11:

1. `.v-Thread-title h1` — the reading-pane thread title. Contains the subject and nothing else. Canonical.
2. `.v-MailboxItem.is-focused .v-MailboxItem-subject` — the focused row in the message list, for when the reading pane is not rendered.
3. `document.title` — strip the trailing ` | Fastmail`, then take everything after the first ` – ` (U+2013, surrounded by ordinary spaces).

Each result is trimmed and has whitespace collapsed.

Element ids must not be used. Fastmail's view layer generates them per render (`h1#v391`, `div#v21`), so they differ between loads.

The observed title on a message view is:

```
In␉Inbox␉•␉Test – Welcome to Labels - 3 things to know | Fastmail
```

where ␉ marks U+2009 thin spaces around the bullet. The separator before the subject is an ordinary-spaced U+2013 en dash, while the subject itself contains an ASCII hyphen — which is why candidate 3 splits on the first en dash and not on any dash.

A message is considered open when candidate 1 matches. When nothing matches, `GetCurrentLink` fails with "No message open" rather than substituting a mailbox name. Capturing a link to a mailbox has no subject by definition, and a silently wrong title is worse than a visible error.

The user script can override resolution by assigning `native.subjectResolver = fn`; the harness uses the override when present.

## Share presentation

The iOS build is chromeless — the web view fills the screen, with no toolbar to hang a share button on. The share affordance therefore lives inside Fastmail's own UI, injected by the harness. See Menu injection.

The share sheet is reachable three ways, all resolving to the same `SharePresenter` call:

1. A **Share** item injected at the top of Fastmail's message actions menu. The primary route, and the only in-app one on iOS.
2. `native.share(...)` from the user script directly, for any other affordance the script wants to draw.
3. The `GetCurrentLink` intent feeding a share action in Shortcuts.

The macOS build additionally has a window toolbar, since a Mac window has one regardless, and the same Share item appears there.

On iOS the only other app-level affordance is pull-to-refresh, which reloads both page and script. Errors surface as a transient banner over the web view. No persistent chrome is added.

Anchoring is a correctness requirement rather than a refinement. On iPad, `UIActivityViewController` presents as a popover and traps if `popoverPresentationController.sourceView` and `sourceRect` are unset; `NSSharingServicePicker.show(relativeTo:of:preferredEdge:)` likewise needs a rect. The toolbar button supplies its own anchor. A script-invoked share supplies one by passing `rect` from `element.getBoundingClientRect()`, which `NativeBridge` converts from page coordinates to web view coordinates, accounting for scroll offset and content insets.

When `rect` is absent, the presenter anchors to the centre of the web view. This is deliberately a fallback rather than an error, since a missing anchor should degrade to an oddly placed sheet rather than a crash.

Presentation is driven by state, not by reaching into the view hierarchy: `NativeBridge` publishes a share request, `AppShell` presents it, and the promise resolves on dismissal.

## Menu injection

Fastmail's menu markup, read from a live session on 2026-08-11:

```html
<div class="v-Menu">
  <li id="v308" class="v-MenuOption">
    <button class="v-Button has-icon" type="button">
      <svg viewBox="0 0 24 24" class="u-standardicon v-Icon i-restore" role="presentation">…</svg>
      <span class="label">Undo</span>
    </button>
  </li>
  <li class="v-MenuOption v-MenuOption--lastOfSection">…</li>
</div>
```

Three properties of this markup drive the design:

1. **A separator is a modifier class, not an element.** `v-MenuOption--lastOfSection` on the last item of a section draws the rule. A Share item at the top with a separator underneath is therefore a single `li` carrying `v-MenuOption v-MenuOption--lastOfSection`, inserted as the first child.
2. **Several `.v-Menu` nodes coexist** in the DOM, at most one visible. A query at page load finds nothing useful and a query at click time may find a stale node. Injection must react to menus becoming visible.
3. **Element ids are generated per render** (`v308`, `v302`), so nothing may key off them.

The harness runs a `MutationObserver` on `document.body` watching for `.v-Menu` nodes being added or becoming visible. A menu is identified as the message actions menu by its **contents** — it contains an option whose label is `Show details` — rather than by a container selector, since `v-Menu` is shared by every menu in the app and ids are unusable.

On a match the harness prepends:

```html
<li class="v-MenuOption v-MenuOption--lastOfSection" data-fmshell="share">
  <button class="v-Button has-icon" type="button">
    <svg viewBox="0 0 24 24" class="u-standardicon v-Icon i-share" role="presentation">…</svg>
    <span class="label">Share</span>
  </button>
</li>
```

Mirroring Fastmail's own class names means the item inherits menu styling with no CSS of its own, and keeps matching if Fastmail restyles.

Selecting it calls `currentLink()`, then `share(...)` with the rect of the `li` so the popover anchors to the menu item, then dismisses the menu.

The `data-fmshell` attribute makes injection idempotent, since menu nodes are reused across openings.

Two details to settle in Milestone 0: whether an `i-share` icon exists in Fastmail's sprite, falling back to an inlined 24×24 path matching the existing convention; and whether the message actions menu can be identified by `Show details` in the reading pane as well as the message card.

Label matching is English-only. The accounts are English, so this is accepted rather than solved.

The harness generalises this as `native.addMenuItem({label, icon, section, onSelect})`, so a user script can add further items without reimplementing the observer. The Share item is the first consumer of that API rather than a special case.

## Error handling

| Condition | Behavior |
|---|---|
| iCloud container unavailable | Site loads with harness only; banner explains |
| Script file missing | Site loads; banner notes the missing file |
| Script empty or mid-write | Rejected; last good copy retained |
| User script throws | Caught in harness, reported to native, shown in banner |
| Unknown or malformed bridge action | Rejected promise with a descriptive message |
| Network failure | Retry view replacing the WebKit error page |

## Testing

Unit tests, no WebKit required:

- `ScriptStore`: debounce coalescing, empty-file rejection, last-good fallback, missing-file path, overlay resolution.
- `NativeBridge`: unknown action, malformed payload, share payload parsing.

Integration test with a real `WKWebView` loading a bundled `fixture.html`: harness installs, `window.native` exists, `onRoute` fires after a `pushState`, `GM_addStyle` inserts a style element, a throwing user script is caught and reported. The fixture also carries the `.v-Thread-title h1` structure so the subject selector chain is covered without hitting the network.

The package's tests run on macOS directly, which is the fast loop; the same suite runs on the iOS simulator to catch platform divergence in the shims.

Manual verification uses `isInspectable` and Safari Web Inspector.

## Milestones

- **M0 — Spike.** Bare `WKWebView` loading `app.fastmail.com`: confirm login with password and TOTP completes, confirm script injection runs, observe whether missing service workers degrade the app, re-verify the subject selector chain inside `WKWebView` (it was verified in Safari, and Fastmail may serve different markup to a non-Safari user agent), and capture the message actions menu: which container it renders into, that `Show details` identifies it, and whether an `i-share` icon exists in the sprite. `window.FastMail` is already confirmed present under a `WKWebView` user agent and is not re-checked. Decision gate before further work.
- **M1** — Package plus two multiplatform targets, profiles, navigation policy, persistent sessions. Both destinations build and run.
- **M2** — `ScriptStore` in both forms, `ScriptPublisher`, `ScriptInjector`, metadata parsing, reload pipeline. Ends with the Inbox mode script running unmodified on both platforms.
- **M3** — `harness.js`: route hooks, GM shims, subject resolution, error reporting.
- **M4** — `NativeBridge`, `SharePresenter`, and the web view shims.
- **M5** — App Intents.
- **M6** — Tests, icons in both forms, error states.

Within each milestone the macOS build is brought up first where the work is platform-agnostic, because the rebuild loop is faster and neither the app-bound-domain nor service-worker constraint applies there. iOS is then verified before the milestone closes, so divergence never accumulates across more than one milestone.

## Risks

1. Fastmail depends on its service worker more than expected. Mitigated by the M0 gate. iOS only.
2. Fastmail login inside `WKWebView` hits a flow that assumes Safari. Mitigated by the M0 gate.
3. Fastmail ships UI changes that break selectors. Inherent to the approach; mitigated by keeping scripts defensive and reloadable without a rebuild.
4. Fastmail serves different markup or a different layout to the macOS user agent, so one selector chain does not cover both platforms. Checked in M0 on both; if it holds, the chain moves into the per-profile overlay rather than the shared script.
5. Developing primarily on macOS hides an iOS-only failure. Mitigated by closing each milestone on both platforms rather than at the end.
6. Retired. `window.FastMail` was confirmed present under a `WKWebView` user agent on 2026-08-11, so the Inbox mode script's central dependency holds.
7. Retired. The build-phase copy means a build always carries the current script, so a stale script on iOS is bounded by install time rather than by whether the Mac app has run.
