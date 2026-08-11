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
3. ~~Service workers may not run.~~ **Disproved on 2026-08-11.** A bare `WKWebView` with no `WKAppBoundDomains` declared reports `navigator.serviceWorker.controller` as live on `app.fastmail.com`, so service workers run normally and the concern is withdrawn. Script injection works in the same configuration, so the two are not in tension as feared.
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
  Extensions/PersonalShare/
  Extensions/WorkShare/
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

`Profile` is a struct with `id`, `displayName`, `startURL`, `overlayScriptName`, `urlScheme`, and `accountId`. Each app target instantiates exactly one, on both platforms.

| | Personal | Work |
|---|---|---|
| Bundle ID | `com.mdbraber.fastmail.personal` | `com.mdbraber.fastmail.work` |
| Display name | mdbraber.com | nexthealth.nl |
| Overlay script | `userscript.personal.js` | `userscript.work.js` |
| URL scheme | `fastmail-personal` | `fastmail-work` |
| Account (`u=`) | from the environment, see Account identifiers | from the environment |
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

`isInspectable` is set unconditionally, in Release as well as Debug. This is deliberate: the installed Release build is where the user script is developed, so a `#if DEBUG` guard would remove the capability from the only build that matters. The consequence is accepted — anyone with access to the unlocked machine can attach Web Inspector to a logged-in mail session and read or script it. Revisit only if these apps ever leave a single-user machine.

**`SharePresenter`** — presents `UIActivityViewController` or `NSSharingServicePicker` behind one interface, so `NativeBridge` has no platform branches.

**`BadgeController`** — applies an unread count to the app icon, via `UNUserNotificationCenter` on iOS or the dock tile on macOS, and owns the one-time authorization request. See Unread badge.

**`DownloadManager`** — the `WKDownloadDelegate`, deciding destination, applying the auto-open allowlist, and handing completed files to Quick Look. See Attachments and downloads.

**`SettingsStore`** — `UserDefaults`-backed, holding the download folder bookmark and the auto-open toggle.

**`ScriptStore`** — reads `userscript.js` and the profile overlay from the app bundle and parses their metadata blocks. No watching, no I/O beyond launch. A missing script is a programming error rather than a runtime condition, since the build phase fails without one.

**`ScriptInjector`** — builds one `WKUserScript`: the bundled `harness.js` with the user script and overlay embedded as JSON-encoded string literals. Injected at `.atDocumentStart`, `forMainFrameOnly: true`, into `WKContentWorld.page`.

**`NativeBridge`** — a single `WKScriptMessageHandlerWithReply` registered as `native` via `addScriptMessageHandler(_:contentWorld:name:)` against `WKContentWorld.page`, so the page-world script can see it. Message body is `["action": String, "payload": [String: Any]]`. Unknown actions and malformed payloads reply with an error string, surfacing in JS as a rejected promise.

**`NavigationPolicy`** — in `decidePolicyFor`, allows `fastmail.com` and `fastmailusercontent.com` and their subdomains; everything else is cancelled and opened in the default browser, via `UIApplication.open` or `NSWorkspace.open`. `fastmailusercontent.com` is where attachment content is served, so excluding it would send every attachment click to Safari instead of downloading it.

It also handles the two cases WebKit does nothing about by default:

- **`target="_blank"` and `window.open()`** produce no action at all unless `webView(_:createWebViewWith:…)` is implemented. Most links in real email are `target=_blank`, so without this a large share of clicks silently do nothing. The delegate returns `nil` and routes the request through the same policy, so such links open in the default browser rather than a stray window.
- **Web content process termination** leaves a permanently blank view with no error. `webViewWebContentProcessDidTerminate` reloads the last URL. Rare, but the failure is total and reads as the app having broken.

**`LinkRouter`** — the single entry point for every URL arriving from outside: custom scheme, `mailto:`, or share extension. Decides between loading locally, translating a `mailto:` to a compose URL, handing off to the other profile, and refusing. Pure logic with no platform or WebKit dependency, so all of its rules are unit-testable. See Link handling.

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
- `GetURL()` — the active web view's current URL.
- `GetTitle()` — the open message's subject, resolved by the same chain as `currentLink()`. Not `document.title`, for the reasons under GetCurrentLink; the raw document title is reachable through `RunJavaScript` for anyone who wants it.
- `GetCurrentLink()` — URL, title, and markdown together as one entity.
- `RunJavaScript(script: String)` — evaluates arbitrary JavaScript in the active web view via `callAsyncJavaScript`, awaiting a returned promise, and returns the result coerced to text.
- `RunScriptAction(name: String)` — invokes an action the user script registered by name. Parameter options come from the registered action names last persisted to `UserDefaults`.

`GetURL`, `GetTitle`, and `GetCurrentLink` share one implementation; the first two exist because pulling a single value out of an entity is clumsy in a shortcut.

All set `openAppWhenRun = true`, since the value lives in the web view and only exists while the app is running. On macOS the active web view is the key window's, so a shortcut acts on the front tab.

Adding a further Shortcuts action means adding a `registerAction` call to the script, with no rebuild.

### GetCurrentLink

Returns a `MailLink` transient entity with three properties, so a shortcut can consume whichever it needs:

| Property | Example |
|---|---|
| `url` | `https://app.fastmail.com/mail/Test/?filter=inbox&u=…` |
| `title` | `Invoice for July` |
| `markdown` | `[Invoice for July](https://app.fastmail.com/mail/Test/?filter=inbox&u=…)` |

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

The harness runs a `MutationObserver` on `document.body` watching for `.v-Menu` nodes being added or becoming visible. A menu is identified as the message actions menu by its **contents** rather than by a container selector, since `v-Menu` is shared by every menu in the app and ids are unusable.

The identifying contents are options labelled **both `Reply` and `Forward`**. Requiring two labels avoids matching a menu that happens to carry one common verb.

An earlier draft of this design identified the menu by an option labelled `Show details`. Milestone 0 disproved that: the message actions menu contains `Reply, Reply to all, Forward, Forward as attachment, Edit as new, Print, Download, Add rule from message…, Block <sender>…, Show raw message, View as text, Send a copy…, Delete` and no `Show details` at all. That label belongs to the message card's details toggle, which controls `div.v-Message-details.is-notshown`. The old rule would never have matched and the Share item would never have appeared. See `docs/superpowers/spike-findings.md`.

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

Milestone 0 settled the icon question: **no share icon exists** in Fastmail's sprite. Scanning every distinct `svg.v-Icon` class for share-like names returned only `i-forward`. The injected item therefore carries an inlined 24×24 SVG path following the existing convention rather than reusing a sprite class.

Label matching is English-only. The accounts are English, so this is accepted rather than solved.

The harness generalises this as `native.addMenuItem({label, icon, section, onSelect})`, so a user script can add further items without reimplementing the observer. The Share item is the first consumer of that API rather than a special case.

## Link handling

Two things are not possible and are recorded so they are not re-attempted:

- **Universal Links for `https://app.fastmail.com`.** Claiming them requires an `apple-app-site-association` file served from `fastmail.com`, which is not controllable. Registering as an `http`/`https` handler on macOS instead would make the app the default browser for everything, which is worse than not having it.
- **`mailto:` as the iOS default.** This requires the `com.apple.developer.mail-client` entitlement, granted only after Apple reviews the app as a genuine mail client, with a runtime check for both the entitlement and actual `mailto:` handling. Not available to a personally-signed app.

What is built instead:

### Account identifiers

The `u=` account identifiers must never enter the repository — not in this document, not in an xcconfig, not in an Info.plist under version control.

They are supplied by the environment at build time:

```
Config/Shared.xcconfig        committed, #includes the local file
Config/Local.xcconfig         gitignored, holds the real values
Config/Local.xcconfig.example committed, placeholders only
```

`Local.xcconfig` defines `PERSONAL_ACCOUNT_ID` and `WORK_ACCOUNT_ID`, which are substituted into each target's Info.plist as `FMAccountID` and read at runtime through `Bundle.main.infoDictionary`. The Makefile passes them through from the environment when set, so CI or a clean machine can build without the file existing.

`.gitignore` covers `Config/Local.xcconfig`, and the committed `.example` documents the shape without the values.

When the identifier is absent the build still succeeds and cross-app handoff is disabled: links load locally regardless of account. Handoff is a convenience, so a missing identifier degrades rather than fails.

The values are still present in the built binary, which is unavoidable and acceptable — the requirement is that they never reach version control.

### Custom URL scheme

Each profile declares its own scheme in `CFBundleURLTypes`, derived from `Profile.urlScheme`: `fastmail-personal` and `fastmail-work`. Two forms are accepted:

| URL | Effect |
|---|---|
| `fastmail-personal://open?url=…` | Loads the percent-encoded URL |
| `fastmail-personal://compose?mailto=…` | Translates a `mailto:` URI to a compose URL |

`open` accepts `fastmail.com` hosts only. Anything else is refused with a banner rather than loaded. Without that check the scheme is an open redirect that renders an arbitrary page inside a logged-in mail session, which is the one genuine security consideration in this design.

This scheme is also the plumbing every other entry point routes through, rather than a user-facing feature.

### macOS mailto

Both targets declare the `mailto` scheme, so either can be chosen as the default email reader in Mail settings; the system offers the choice once more than one handler exists. On receiving a `mailto:` URL the app translates it to a Fastmail compose URL and appends the profile's account parameter, so it composes from the right account rather than whichever session is active.

The compose URL template is pinned during Milestone 0 by reading the protocol handler Fastmail's own web app registers, rather than inventing a parameter mapping.

### iOS share extension

One share extension target per profile, `com.mdbraber.fastmail.personal.share` and `.work.share`, titled "Open in Fastmail" and "Open in Fastmail Work". It accepts `public.url`, and opens the containing app through the custom scheme using `NSExtensionContext.open(_:)` — the reason the scheme exists, since an extension cannot reach `UIApplication`.

Non-Fastmail URLs are rejected in the extension rather than passed on, so the failure is visible at the point of sharing.

### Cross-app handoff

`Profile` gains an `accountId`, the value Fastmail carries as `u=` in its URLs. Its value is never written down here or anywhere else in the repository; see Account identifiers.

When an incoming URL carries a `u=` that does not match the receiving profile, the app rewrites it to the other profile's scheme and opens it, via `NSWorkspace.open` or `UIApplication.open`. A URL with no `u=` is loaded locally without handoff, since there is nothing to disagree with.

**The handoff is one hop only.** The rewritten URL carries `handoff=1`, and an app that receives a URL already bearing it loads it locally regardless of account. Without that guard, two apps that each consider the link foreign would bounce it between them indefinitely.

If the other app is not installed the open fails, and the link is loaded locally with a banner explaining the account mismatch.

## macOS windows

The Mac build is a real Mac app rather than a single fixed window: multiple windows, native tabs, and a compose command.

### Tabs

The scene is a `WindowGroup`, so each window owns its own `WKWebView` starting at the profile's start URL and sharing the profile's `WKWebsiteDataStore`. Native window tabbing is left enabled, so windows group into tabs according to the system preference, with the standard ⌘T, ⌃⇥, and Move Tab to New Window behaviour coming free.

The user script runs independently in each tab, which is correct — each is a separate page with its own JavaScript context — and the script's own `window.mdbraberInboxMode` guard already covers double-injection within a context.

**The standard Edit menu must be kept.** SwiftUI's `WindowGroup` supplies Cut, Copy, and Paste with their key equivalents, and a `WKWebView` depends on them: an app with no menu bar cannot route ⌘V into the page at all, as the Milestone 0 spike demonstrated by accident. The chromeless treatment applies to iOS only; on macOS the menu bar stays.

**Tab selection is bound to ⌥1–⌥9, not ⌘1–⌘9.** The Inbox mode script binds `Meta-1` through `Meta-9` to jump to sources, and a menu key equivalent wins over a web view key handler, so the conventional Mac binding would silently break shortcuts you use constantly. The web view keeps the ⌘ range; the menu takes the ⌥ range.

The cost is that ⌥ plus a digit no longer types its typographic character while composing. That is the lesser loss, and it is the first thing to revisit if it grates.

**Consequence for everything that says "current".** With more than one web view alive, `currentLink()`, the share toolbar button, the badge resolver, and the `GetCurrentLink` intent must all act on the key window's web view rather than on any singleton. A `WebViewRegistry` tracks the live views and resolves the active one from the key window; on iOS it resolves to the only view there is. This is written down because a singleton web view reference would work perfectly until the first second tab.

### Window chrome

The Mac window reproduces the chrome of the existing Safari web app: Fastmail's own page header running full width, with the traffic lights floating over it and no separate title bar.

None of that is a native toolbar. The search field, the sidebar and view toggles, and the settings, help and avatar buttons are all Fastmail's `.v-PageHeader`, the same element the web app renders in any browser. What makes it read as app chrome is the window letting the page reach the top edge:

- `styleMask` includes `.fullSizeContentView`
- `titlebarAppearsTransparent = true`
- `titleVisibility = .hidden`
- the tint from the section below

One thing must come from the user script rather than from Swift: the page header needs left padding so its leftmost controls clear the traffic lights, roughly 78pt at the standard window-button inset. Doing it in CSS keeps it adjustable without a rebuild, and keeps Swift ignorant of Fastmail's markup.

The toolbar described elsewhere in this document is therefore macOS-only *and* minimal — reload and share — and coexists with Fastmail's own header rather than duplicating it.

### Offline

Fastmail's web app has its own offline support built on a service worker. The app does not implement caching; it only needs to avoid preventing what Fastmail already does.

**macOS: confirmed working.** The Milestone 0 spike observed `navigator.serviceWorker.controller` live in a bare `WKWebView` with no app-bound domains declared, on the same configuration that injects scripts.

**iOS: unverified, and possibly mutually exclusive with script injection.** iOS is where WebKit has historically tied service worker availability to `WKAppBoundDomains` — the same key that disables `WKUserScript` injection, custom stylesheets, and message handlers. If that coupling still holds, iOS offers offline or the user script, not both, and the app cannot have the feature it exists to provide.

This must be measured before either behaviour is promised on iOS. The spike is small: install the app on a device, load the mailbox, enable Airplane Mode, and relaunch, then check `navigator.serviceWorker.controller` and whether the mailbox renders. Run it twice, once with no `WKAppBoundDomains` key and once with it declared, and record whether injection survives in the second case.

If the coupling holds, the resolution is to keep injection and accept no offline on iOS, since a shell that cannot run the user script has no reason to exist. That would be a change to the Non-goals, not a defect.

### Titlebar tint

The window titlebar takes the site's colour, the way Safari tints its toolbar, so the app reads as Fastmail rather than as a generic window. The macOS system menu bar cannot be tinted by an application and is not involved.

Observed on 2026-08-11, Fastmail publishes:

```html
<meta name="theme-color" content="#d6d8da">
<html class="t-light">
```

Two things follow. The meta carries **no `media` attribute**, so it is a single value that does not vary by colour scheme; taking it at face value would tint the titlebar light grey while Fastmail is in dark mode. And Fastmail signals its own theme with a `t-light` / `t-dark` class on `<html>`, which is the more reliable input.

The harness therefore reports both, and re-reports on change via a `MutationObserver` watching `<head>` for the meta's `content` and `<html>` for its class list. Fastmail's chrome elements all compute to `rgba(0, 0, 0, 0)`, so sampling a background colour is not an option — the paint comes from further down the tree.

Native applies it as:

- `titlebarAppearsTransparent = true` and `backgroundColor` set to the reported tint, which is what makes the titlebar take the colour.
- `appearance` set to `.darkAqua` or `.aqua` by the tint's relative luminance, so the traffic lights and title text stay legible whichever theme is active. Deriving appearance from luminance rather than from the `t-*` class means it stays correct even if Fastmail changes how it names its themes.

Each window tints independently, which is correct under tabs since each tab is its own window with its own page.

On iOS there is no titlebar. The equivalent surface is the safe-area background behind the status bar, tinted from the same reported value.

### Compose

A **Compose** command sits in the menu bar bound to ⌘N, which displaces the default New Window command; new windows move to ⇧⌘N and new tabs stay on ⌘T.

Compose opens its own window that does not join the tab group, since a draft is a task rather than another view of the mailbox.

**Preloading.** The point of the requirement is that ⌘N feels instant, so a compose web view is created and loaded at launch and kept ready off-screen, in an ordered-out window so WebKit has a real window to render into rather than a detached view. ⌘N orders that window in; nothing loads at press time.

The lifecycle is the part worth stating: a used compose view is spent. When a compose window closes, it reloads the compose URL and returns to the ready pool, so the next ⌘N is instant again. If ⌘N is pressed while the pool is empty — a second compose before the first closed — a fresh window is created and loaded normally, accepting the delay rather than blocking.

The compose URL is the same template pinned in Milestone 0 for `mailto:` handling, with the profile's account parameter appended.

The same injection applies to compose views as to any other, and no special-casing is needed: the Inbox mode script's `isReady()` gate requires a drawn `.v-MailboxSource` sidebar, so in a compose window it simply waits and stays inert.

iOS has neither command, since it has one full-screen web view and no menu bar. Compose there is reached through Fastmail's own UI.

### AppleScript

The Mac app is scriptable, with a dictionary that deliberately mirrors Safari's so existing habits and snippets carry over:

```applescript
tell application "Fastmail"
    get URL of front window
    get name of front window
    do JavaScript "document.title" in front window
end tell
```

`windows` enumerates real windows, and since macOS tabs are windows, it enumerates tabs too. Each exposes `URL` and `name`, where `name` is the resolved message subject, matching `GetTitle`.

Implementation is an `.sdef` in the bundle with `NSAppleScriptEnabled` and `OSAScriptingDefinition` set in Info.plist, plus an `NSScriptCommand` subclass for `do JavaScript`.

The one non-obvious piece: `callAsyncJavaScript` is asynchronous while an Apple Event expects a result. The command calls `suspendExecution()` and then `resumeExecution(withResult:)` from the completion handler, rather than blocking the main thread or returning early with nothing.

**Scripting reaches a logged-in mail session.** `do JavaScript` and `RunJavaScript` let anything that can send an Apple Event or run a shortcut execute code against live mail — the same exposure Safari gates behind "Allow JavaScript from Apple Events", which is off by default there. Both are enabled here without a gate, on the grounds that this is a personal app on a single-user machine and the alternative is a preferences surface the app otherwise does not need. Recorded so the decision is deliberate; it is the point to revisit first if the app is ever shared.

## Attachments and downloads

Attachment content is served from `fastmailusercontent.com`, which the navigation policy admits for exactly this reason. A navigation that becomes a download is taken over by `WKDownloadDelegate`; without it, clicking an attachment does nothing at all.

### When the app takes over

Fastmail renders PDFs and images in its own viewer, and intercepting those would fight the web app for no gain. The app therefore only takes over where WebKit would otherwise fail or download anyway. In `decidePolicyFor navigationResponse`:

| Response | Decision |
|---|---|
| `Content-Disposition: attachment` | `.download` |
| `!navigationResponse.canShowMIMEType` | `.download` |
| Anything else | `.allow`, and Fastmail displays it |

So opening a PDF inside Fastmail keeps using Fastmail's viewer; explicitly downloading an attachment, or opening a type WebKit cannot render, becomes a download.

### Where downloads go

| Platform | Default | Configurable |
|---|---|---|
| macOS | `~/Downloads` | Any folder, chosen in Settings |
| iOS | the app's Documents folder, visible in Files | Per-download "Save to…" via the document picker |

macOS reaches `~/Downloads` through the `com.apple.security.files.downloads.read-write` entitlement, so the common case needs no bookmark. A custom folder is chosen with `NSOpenPanel` and persisted as a security-scoped bookmark, resolved on each launch.

This partly walks back the earlier claim that dropping live script reloading removed security-scoped bookmarks entirely: they are gone from the script path, but a user-chosen download folder brings them back. The default path avoids them, so the complexity is only paid by someone who wants a different folder.

iOS cannot write to arbitrary locations, so a configurable path is a macOS concept. The app's Documents folder is exposed through `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace`, making downloads reachable from Files.

### Progress

`WKDownload` publishes a `Progress`, so `DownloadManager` exposes `[DownloadItem]` with filename, fraction complete, byte counts, and state. `Progress.localizedAdditionalDescription` already renders "3.2 MB of 12 MB" in the user's locale, so no byte formatting is written by hand.

**Nothing is shown for the first 500ms.** Most attachments finish inside that window, and flashing a progress panel for a 40 KB PDF is worse than showing nothing. Past the threshold the platform surface appears:

| Platform | Surface |
|---|---|
| macOS | A toolbar item with a progress ring, opening a popover listing active and recent downloads, each cancellable, with Show in Finder once complete |
| iOS | A compact pill above the safe area showing filename and progress, tapping to expand into the same list, cancellable |

The iOS pill reuses the banner mechanism rather than introducing a second overlay concept, which keeps the chromeless design intact — it is transient, and gone once downloads finish.

A download whose total size is unknown renders indeterminate rather than pretending to a percentage. Concurrent downloads list together and the macOS ring shows their combined fraction, since `Progress` composes through `addChild`.

Completed items stay in the list for the session so a file can be found again without re-downloading, and are not persisted beyond it.

### After a download

A completed download is previewed with Quick Look rather than handed straight to another app: `QLPreviewPanel` on macOS, the same floating panel Finder uses, and `QLPreviewController` on iOS. From there the standard share and save affordances take over.

**Quick Look requires a local file.** `QLPreviewItem.previewItemURL` must be a `file:` URL; neither API will fetch an `https://fastmailusercontent.com/…` URL. Previewing therefore always follows a completed download and can never operate on the remote URL directly. This is the reason the download path exists at all, rather than previewing straight from the web view.

**Auto-open safe attachments** is a setting, off by default. When enabled, a completed download whose type is on a fixed allowlist opens in the default application instead of previewing:

- PDF, plain text, RTF
- Images: PNG, JPEG, GIF, HEIC, WebP
- Calendar invitations: `.ics`

The allowlist is by uniform type identifier, checked with `UTType.conforms(to:)` rather than by file extension, since an extension is attacker-controlled in a way a sniffed type is less so. Everything else previews regardless of the setting. Archives, disk images, installers, scripts, and executables are never auto-opened, and the list is deliberately fixed rather than user-editable — a settings toggle that can be widened to `.dmg` is a phishing vector in a mail client, which is precisely where hostile attachments arrive.

Off by default because the safe cases are exactly the ones Quick Look already handles well, so the setting buys convenience rather than capability.

## Settings

A small settings surface, holding only what cannot be inferred:

| Setting | Default |
|---|---|
| Download folder (macOS) | `~/Downloads` |
| Auto-open safe attachments | Off |

macOS uses a `Settings` scene, reachable at ⌘, as normal. iOS has no chrome to hang a settings button on, so it is reached through an item the harness injects into Fastmail's actions menu, alongside Share — the same mechanism, and the reason `addMenuItem` was generalised rather than written for Share alone.

Values live in `UserDefaults`, per profile by virtue of separate app containers, so the two apps can have different download folders.

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
| Incoming URL is not a Fastmail host | Refused with a banner; never loaded |
| Handoff target app not installed | Loaded locally with a banner explaining the account mismatch |
| Handoff URL already carries `handoff=1` | Loaded locally regardless of account, breaking the bounce loop |
| Web content process terminates | Blank view reloaded from the last URL |
| `target=_blank` or `window.open` | No stray window; routed through the navigation policy |
| Download folder bookmark fails to resolve | Falls back to `~/Downloads` and reports it once in Settings |
| Download fails or is cancelled | Reported in the banner; no partial file left in place |

## Testing

Unit tests, no WebKit required:

- `MetadataParser`: `@match`, `@run-at`, and `@grant` extraction; missing block; unknown directives ignored rather than fatal.
- `ScriptStore`: bundle resolution, overlay resolution, and the script-plus-overlay ordering.
- `NativeBridge`: unknown action, malformed payload, share payload parsing.
- `BadgeController`: zero clears rather than shows `0`, a missing count leaves the badge unchanged, and a declined authorization is not re-requested.
- `LinkRouter`: `mailto:` translation including subject and body, non-Fastmail host refusal, `u=` match and mismatch, absent `u=`, and that a URL carrying `handoff=1` is never handed off again.
- `WebViewRegistry`: resolves the active view from the key window, and copes with the last window closing.
- `ComposePool`: a closed compose window returns to the pool reloaded, and an empty pool creates a fresh window rather than failing.
- `NavigationPolicy`: `fastmailusercontent.com` is admitted rather than externalised, and the response rules route `Content-Disposition: attachment` and unshowable MIME types to download while leaving everything else to Fastmail.
- `DownloadManager`: the auto-open allowlist admits PDF and images and refuses archives, disk images, and executables, matched by UTI rather than by extension; a spoofed extension on a disallowed type is still refused. Also that a download completing inside the 500ms threshold never publishes a progress item, and that a cancelled download leaves no partial file.

Integration test with a real `WKWebView` loading a bundled `fixture.html`: harness installs, `window.native` exists, `onRoute` fires after a `pushState`, the user script is evaluated after `load` rather than at document start, and a throwing user script is caught and reported. The fixture also carries the `.v-Thread-title h1` structure and a `.v-Menu` containing `Show details`, so the subject chain and menu injection are covered without hitting the network.

The package's tests run on macOS directly, which is the fast loop; the same suite runs on the iOS simulator to catch platform divergence in the shims.

Manual verification uses `isInspectable` and Safari Web Inspector.

## Milestones

- **M0 — Spike.** Bare `WKWebView` loading `app.fastmail.com`: confirm login with password and TOTP completes, confirm script injection runs, observe whether missing service workers degrade the app, re-verify the subject selector chain inside `WKWebView` (it was verified in Safari, and Fastmail may serve different markup to a non-Safari user agent), and capture the message actions menu: which container it renders into, that `Show details` identifies it, and whether an `i-share` icon exists in the sprite. `window.FastMail` is already confirmed present under a `WKWebView` user agent and is not re-checked. Decision gate before further work.
- **M1** — Package plus two multiplatform targets, profiles, navigation policy, persistent sessions. Both destinations build and run, and `make install` puts all four in place. The Makefile comes this early because every later milestone depends on rebuilding often.
- **M2** — Build phase, `ScriptStore`, `ScriptInjector`, metadata parsing. Ends with the Inbox mode script running unmodified on both platforms.
- **M3** — `harness.js`: route hooks, subject resolution, menu injection, error reporting.
- **M4** — `NativeBridge`, `SharePresenter`, `BadgeController`, and the web view shims.
- **M5** — App Intents, the AppleScript dictionary, link handling, share extensions, and the macOS compose and tab behaviour.
- **M6** — Attachments and downloads, Quick Look, the settings surface, `target=_blank` and crash recovery.
- **M7** — Tests, icons in both forms, error states.

Within each milestone the macOS build is brought up first where the work is platform-agnostic, because the rebuild loop is faster and neither the app-bound-domain nor service-worker constraint applies there. iOS is then verified before the milestone closes, so divergence never accumulates across more than one milestone.

## Risks

1. Retired. Service workers were confirmed running in `WKWebView` on 2026-08-11, so Fastmail's dependence on them is not a risk.
2. Fastmail login inside `WKWebView` hits a flow that assumes Safari. Mitigated by the M0 gate.
3. Fastmail ships UI changes that break selectors. Inherent to the approach; mitigated by keeping scripts defensive and reloadable without a rebuild.
4. Fastmail serves different markup or a different layout to the macOS user agent, so one selector chain does not cover both platforms. Checked in M0 on both; if it holds, the chain moves into the per-profile overlay rather than the shared script.
5. Developing primarily on macOS hides an iOS-only failure. Mitigated by closing each milestone on both platforms rather than at the end.
6. Retired. `window.FastMail` was confirmed present under a `WKWebView` user agent on 2026-08-11, so the Inbox mode script's central dependency holds.
7. Retired. The build-phase copy means a build always carries the current script, so a stale script on iOS is bounded by install time rather than by whether the Mac app has run.
