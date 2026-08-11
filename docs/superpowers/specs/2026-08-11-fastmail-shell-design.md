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

**`ScriptStore`** — resolves the iCloud container via `FileManager.url(forUbiquityContainerIdentifier:)`, calls `startDownloadingUbiquitousItem` for items not yet local, and observes `Documents/` with an `NSMetadataQuery` scoped to `NSMetadataQueryUbiquitousDocumentsScope`. Publishes `ScriptBundle(shared: String?, overlay: String?)`.

**`ScriptInjector`** — builds the `WKUserScript` list in order: bundled `harness.js`, then `userscript.js`, then the profile overlay. All at `.atDocumentStart`, `forMainFrameOnly: true`. On any change it calls `removeAllUserScripts()`, re-adds the list, and reloads the web view.

**`NativeBridge`** — a single `WKScriptMessageHandlerWithReply` registered as `native`. Message body is `["action": String, "payload": [String: Any]]`. Unknown actions and malformed payloads reply with an error string, surfacing in JS as a rejected promise.

**`NavigationPolicy`** — in `decidePolicyFor`, allows `fastmail.com` and its subdomains; everything else is cancelled and opened in the default browser, via `UIApplication.open` or `NSWorkspace.open`.

## Script pipeline

```
iCloud Documents/userscript.js
  → NSMetadataQuery change
  → debounce 300ms
  → reject empty or unreadable content, retain last good copy
  → removeAllUserScripts() + re-add harness/shared/overlay
  → reload
```

The debounce and last-good retention exist because the file will be written from a Mac editor while the app is foregrounded; a partially written file must never replace a working script. This matters most on macOS, where the editor and the running app share a disk and the window is visibly reloading as you save. The refresh affordance forces a re-read from disk for when iCloud sync lags.

If the container is unavailable (not signed into iCloud, first launch before download), the site still loads with harness only and the banner explains why.

## Harness API

`harness.js` ships in the bundle and runs before user scripts. It exposes `window.native`:

- `share({url, text})` → Promise resolving when the share sheet is dismissed.
- `currentLink()` → `{url, title, markdown}` for the open message, where `title` is the subject alone. Backs both the `GetCurrentLink` intent and the toolbar share button. Rejects when no message is open.
- `subjectResolver` → assignable; overrides the default selector chain.
- `registerAction(name, fn)` → registers a Shortcuts-invocable action; also notifies native so the name can be offered as a Shortcuts parameter option.
- `log(...args)` → Xcode console.
- `onRoute(cb)` → fires on route change. Implemented by patching `history.pushState` and `history.replaceState`, listening for `popstate`, and running a debounced `MutationObserver` on `document.body`. Necessary because `WKUserScript` runs once per document load and Fastmail is client-routed.

GM compatibility shims, so most Greasy Fork scripts run unmodified: `GM_addStyle`, `GM_setValue`, `GM_getValue`, `GM_deleteValue` over `localStorage` under a namespaced key prefix, and `GM_xmlhttpRequest` over `fetch`.

User scripts are wrapped in a try/catch inside an IIFE; a throw is reported to native and shown in the banner rather than failing silently as WebKit would otherwise do.

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

- **M0 — Spike.** Bare `WKWebView` loading `app.fastmail.com`: confirm login with password and TOTP completes, confirm script injection runs, observe whether missing service workers degrade the app, and re-verify the subject selector chain inside `WKWebView` (it was verified in Safari, and Fastmail may serve different markup to a non-Safari user agent). Decision gate before further work.
- **M1** — Package plus two multiplatform targets, profiles, navigation policy, persistent sessions. Both destinations build and run.
- **M2** — `ScriptStore` and `ScriptInjector`, iCloud container, reload pipeline.
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
