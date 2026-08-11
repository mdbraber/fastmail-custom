# Fastmail Shell — Design

Date: 2026-08-11
Status: Approved

## Goal

Installable apps that each wrap `app.fastmail.com` in a `WKWebView` and inject a user-authored JavaScript file, so the Fastmail web UI can be modified (DOM and CSS) in ways a Home Screen PWA cannot allow. One app holds the `mdbraber.com` session, the other the `nexthealth.nl` session, switchable from the Home Screen or the Dock.

Two profiles across two platforms, so four products from two multiplatform targets: iOS and macOS, personal and work.

One script, authored in its own repository, is built into all four products. The script must also be able to reach two native capabilities: the system share sheet, and Shortcuts.

## Non-goals

Multiple sites or URL-pattern matching. Content blocking or request interception. Response rewriting. Push or local notifications. Offline caching. In-app script editing. Remote script updates. App Store distribution.

No background refresh of the badge. The badge is read from the page while the app runs; see Unread badge. Keeping it current when the app is closed would require polling Fastmail's JMAP API from a background task and storing an API token per profile, which is not worth a stored credential. The app holds no Fastmail credentials of its own; the only session state is the web view's cookies.

## Platform constraints

These were verified before design and each one shapes a decision:

1. **App-Bound Domains must not be used.** Adding `WKAppBoundDomains` to Info.plist puts every `WKWebView` in the app into a mode that denies script injection, custom stylesheets, and message handlers. The `limitsNavigationsToAppBoundDomains` flag is meant to restore them but is reported to still conflict with `addUserScript`. The app therefore does not declare the key. iOS only; the restriction does not exist on macOS.
2. **Passkey login is unavailable.** WebAuthn in a `WKWebView` requires Associated Domains between the app and the relying party, which requires an `apple-app-site-association` file on `fastmail.com`. Not controllable. Login is password plus TOTP, once per app per platform, persisted in cookies. Applies to both platforms.
3. **Service workers may not run**, as WKWebView ties them to app-bound domains. Accepted risk; verified in Milestone 0. iOS only.
4. **Web push does not exist in `WKWebView`.** No new-mail notifications. Accepted.

Constraints 1 and 3 are the reason the macOS build is the better place to develop the userscript: neither applies there.

## Approach

A native SwiftUI app with no third-party dependencies. Shared logic lives in a local Swift package; the two app targets are thin, holding only configuration, icons, and a profile constant.

Each app target is multiplatform, declaring both iOS and macOS as supported destinations, rather than four separate targets. A profile therefore keeps one bundle identifier, one asset catalog, and one build phase across platforms, so a script change is one rebuild per profile rather than four.

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
  Makefile
  Config/Shared.xcconfig
  docs/superpowers/specs/
```

Deployment targets iOS 17 and macOS 14.

## Building and installing

Two targets across two platforms means four products, and since a script change now requires a rebuild, propagating one edit by hand is four Xcode actions. Two things reduce that to one command.

**Aggregate scheme.** An `All` aggregate target depends on both app targets, so a single build action produces both apps for the selected destination. This covers the common case of rebuilding both Mac apps at once. It cannot cover both platforms in one action, because a scheme builds for one destination at a time — which is what the Makefile is for.

**Makefile.** The entry point for everything, driving `xcodebuild` per destination:

| Target | Effect |
|---|---|
| `make macos` | Builds both Mac apps and copies them to `/Applications` |
| `make ios` | Builds both iOS apps and installs them with `xcrun devicectl device install app` |
| `make install` | Both of the above |

The iOS device is identified by a `DEVICE` variable, defaulting to the first paired device from `xcrun devicectl list devices` and overridable on the command line, so the UDID is not committed. Signing uses automatic provisioning with the team identifier set in the xcconfig alongside `USERSCRIPT_PATH`.

`make install` is the routine after editing the user script.

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

Both targets run the same build phase against the same repository file, so the script is authored once and reaches all four products at build time.

## Icons

Both icons already exist and are already distinct; they are reused rather than redesigned.

- **Personal** — a green recolour of the Fastmail envelope. It is a Finder-set custom icon, stored as a resource fork on a zero-byte `Icon\r` file at the root of `~/Applications/mdbraber.com.app`, and it overrides the bundle's `ApplicationIcon.icns`. Reading the `.icns` alone yields the wrong artwork.
- **Work** — the stock blue Fastmail envelope from `~/Applications/nexthealth.nl.app/Contents/Resources/ApplicationIcon.icns`.

Both are extracted the same way, via `NSWorkspace.icon(forFile:)`, which resolves whichever icon macOS actually displays and offers representations up to 2048×2048. The extraction is kept in the repository as `tools/extract-icons.swift` so the assets can be regenerated.

The macOS builds use the extracted artwork as-is: it is already an inset squircle with a drop shadow, which is exactly the macOS `AppIcon` convention.

The iOS builds need a conversion, since an iOS `AppIcon` must be a fully opaque square with no alpha and no pre-applied corner rounding. The artwork is scaled to full bleed (roughly 1.15–1.2×, letting the corners run past the edge where the iOS mask cuts them), composited onto an opaque backdrop, and exported at 1024×1024 with alpha removed.

A single asset catalog per target holds both, using platform-specific icon sets.

The existing Safari web apps in `~/Applications` use these same icons, so once the Mac apps are installed there will be two green Fastmail icons and two blue ones, separable only by name. Accepted; the old web apps are not retired as part of this work.

## Components

**`AppShell`** — root SwiftUI view. Hosts the web container, a dismissible error banner bound to a published error state, and on macOS a window toolbar (reload, share).

**`WebContainer`** — the representable wrapping `WKWebView`, with the platform variants in `WebContainer+iOS.swift` and `WebContainer+macOS.swift`. Sets `isInspectable = true` so Safari Web Inspector attaches to the injected script. Owns the navigation delegate.

**`SharePresenter`** — presents `UIActivityViewController` or `NSSharingServicePicker` behind one interface, so `NativeBridge` has no platform branches.

**`BadgeController`** — applies an unread count to the app icon, via `UNUserNotificationCenter` on iOS or the dock tile on macOS, and owns the one-time authorization request. See Unread badge.

**`ScriptStore`** — reads `userscript.js` and the profile overlay from the app bundle and parses their metadata blocks. No watching, no I/O beyond launch. A missing script is a programming error rather than a runtime condition, since the build phase fails without one.

**`ScriptInjector`** — builds one `WKUserScript`: the bundled `harness.js` with the user script and overlay embedded as JSON-encoded string literals. Injected at `.atDocumentStart`, `forMainFrameOnly: true`, into `WKContentWorld.page`.

**`NativeBridge`** — a single `WKScriptMessageHandlerWithReply` registered as `native` via `addScriptMessageHandler(_:contentWorld:name:)` against `WKContentWorld.page`, so the page-world script can see it. Message body is `["action": String, "payload": [String: Any]]`. Unknown actions and malformed payloads reply with an error string, surfacing in JS as a rejected promise.

**`NavigationPolicy`** — in `decidePolicyFor`, allows `fastmail.com` and its subdomains; everything else is cancelled and opened in the default browser, via `UIApplication.open` or `NSWorkspace.open`.

## Script source

The script to run is an existing one: `~/src/fastmail-customized/fastmail-inbox-mode.user.js`, which adds a sticky Inbox filter on labels and Inbox-only sidebar badge counts. The repository stays canonical and versioned; the app never becomes the place the script lives.

The script is copied into the app bundle at build time and read from there at runtime. Nothing is watched, synced, or fetched. **Changing the script means rebuilding the app.**

**Build-phase copy.** A `Copy User Script` run-script phase copies the repository file into the app bundle's resources on every build of every target. The source path comes from a `USERSCRIPT_PATH` build setting in an xcconfig rather than being hardcoded in the phase. The phase declares its input and output files so incremental builds behave, and it fails the build when the source is missing — an app silently shipping no script is the failure worth preventing.

```
repo/fastmail-inbox-mode.user.js
  → build phase copies into each app bundle
  → read from Bundle at launch
  → parse metadata block
  → build bootstrap, inject at document start
```

This was deliberately chosen over live reloading from iCloud or a watched repository file. Those were specified earlier in this design and removed. What they bought was editing the script without a rebuild; what they cost was an iCloud container and entitlement, `NSMetadataQuery` and `DispatchSource` watchers, debounce and last-good-copy handling for partially written files, a publish path from macOS to iOS, and a class of failure where the running script is not the one in the repository. On macOS a rebuild is seconds, and the script is mature rather than under active development.

Three simplifications follow, and they are the reason this is the better trade:

1. **No iCloud.** No container, no entitlement, no sync states, no availability errors.
2. **The macOS App Sandbox stays on**, because the app never reads a path outside its own bundle. The security-scoped bookmark question disappears.
3. **The script is immutable at runtime**, so there is no reload path, no debounce, no partially written file to defend against, and no divergence between platforms.

The cost, stated plainly: iterating on the script means a rebuild on macOS and a rebuild plus reinstall on iOS.

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
- `setBadge(count)` → sets the app icon badge. See Unread badge.
- `badgeResolver` → assignable; overrides how the unread count is read from the page.
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

On iOS the only other app-level affordance is pull-to-refresh, which reloads the page. Errors surface as a transient banner over the web view. No persistent chrome is added.

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

## Unread badge

The app icon carries an unread count, read from the page Fastmail already renders. No API, no token, no background task.

The count is only as fresh as the last time the app ran. On iOS it therefore freezes when the app is backgrounded and stays frozen until it is next opened. This is accepted rather than worked around: the value is seeing the count on returning to the Home Screen, not being notified.

**Source.** The harness resolves the count from Fastmail's own sidebar rather than inventing its own query, so the badge always agrees with what the app shows. The default resolver reads the Inbox source's badge from `.v-MailboxSource`, and is overridable with `native.badgeResolver = fn` on the same pattern as `subjectResolver`.

Overriding matters here more than elsewhere: the Inbox mode script already computes its own per-label Inbox counts and patches Fastmail's badge rendering, so it is better placed than the harness to say what the number should be. The harness supplies the primitive and the script decides the policy.

**When it updates.** On route change, on a debounced `MutationObserver` tick, and when the app returns to the foreground, where native asks the page for a fresh count via `callAsyncJavaScript` rather than trusting the last pushed value.

**Native side.** `BadgeController` takes an `Int` and applies it per platform:

| Platform | Mechanism | Authorization |
|---|---|---|
| iOS | `UNUserNotificationCenter.setBadgeCount(_:)` | `.badge` only, requested on the first non-zero count |
| macOS | `NSApplication.shared.dockTile.badgeLabel` | none required |

Authorization is requested when there is first something to show, not at launch, so the prompt arrives with obvious cause. If it is declined the badge silently does nothing and the harness stops being asked; the app is otherwise unaffected.

A count of zero clears the badge rather than displaying `0`. The badge deliberately persists after the app quits, showing the last known count, which is the entire point on iOS.

## Error handling

| Condition | Behavior |
|---|---|
| Script missing from bundle | Cannot occur; the build phase fails first |
| Metadata block unparseable | Build-time check in the copy phase, so it fails before shipping |
| `@match` does not match the loaded URL | Script not evaluated; reported to the banner |
| User script throws | Caught in harness, reported to native, shown in banner |
| Unknown or malformed bridge action | Rejected promise with a descriptive message |
| Network failure | Retry view replacing the WebKit error page |
| Badge authorization declined | Badge is skipped; harness stops being asked for a count |
| Badge resolver finds no count | Badge left unchanged rather than cleared, since absence is not zero |

## Testing

Unit tests, no WebKit required:

- `MetadataParser`: `@match`, `@run-at`, and `@grant` extraction; missing block; unknown directives ignored rather than fatal.
- `ScriptStore`: bundle resolution, overlay resolution, and the script-plus-overlay ordering.
- `NativeBridge`: unknown action, malformed payload, share payload parsing.
- `BadgeController`: zero clears rather than shows `0`, a missing count leaves the badge unchanged, and a declined authorization is not re-requested.

Integration test with a real `WKWebView` loading a bundled `fixture.html`: harness installs, `window.native` exists, `onRoute` fires after a `pushState`, the user script is evaluated after `load` rather than at document start, and a throwing user script is caught and reported. The fixture also carries the `.v-Thread-title h1` structure and a `.v-Menu` containing `Show details`, so the subject chain and menu injection are covered without hitting the network.

The package's tests run on macOS directly, which is the fast loop; the same suite runs on the iOS simulator to catch platform divergence in the shims.

Manual verification uses `isInspectable` and Safari Web Inspector.

## Milestones

- **M0 — Spike.** Bare `WKWebView` loading `app.fastmail.com`: confirm login with password and TOTP completes, confirm script injection runs, observe whether missing service workers degrade the app, re-verify the subject selector chain inside `WKWebView` (it was verified in Safari, and Fastmail may serve different markup to a non-Safari user agent), and capture the message actions menu: which container it renders into, that `Show details` identifies it, and whether an `i-share` icon exists in the sprite. `window.FastMail` is already confirmed present under a `WKWebView` user agent and is not re-checked. Decision gate before further work.
- **M1** — Package plus two multiplatform targets, profiles, navigation policy, persistent sessions. Both destinations build and run, and `make install` puts all four in place. The Makefile comes this early because every later milestone depends on rebuilding often.
- **M2** — Build phase, `ScriptStore`, `ScriptInjector`, metadata parsing. Ends with the Inbox mode script running unmodified on both platforms.
- **M3** — `harness.js`: route hooks, subject resolution, menu injection, error reporting.
- **M4** — `NativeBridge`, `SharePresenter`, `BadgeController`, and the web view shims.
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
