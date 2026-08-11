# Fastmail Shell — Design

Date: 2026-08-11
Status: Approved

## Goal

Two installable iOS apps that each wrap `app.fastmail.com` in a `WKWebView` and inject a user-authored JavaScript file, so the Fastmail web UI can be modified (DOM and CSS) in ways a Home Screen PWA cannot allow. One app holds the `mdbraber.com` session, the other the `nexthealth.nl` session, switchable from the Home Screen.

The script must be editable from a Mac without rebuilding the app. The script must also be able to reach two native capabilities: the iOS share sheet, and Shortcuts.

## Non-goals

Multiple sites or URL-pattern matching. Content blocking or request interception. Response rewriting. Push or local notifications. Offline caching. In-app script editing. Remote script updates. App Store distribution.

## Platform constraints

These were verified before design and each one shapes a decision:

1. **App-Bound Domains must not be used.** Adding `WKAppBoundDomains` to Info.plist puts every `WKWebView` in the app into a mode that denies script injection, custom stylesheets, and message handlers. The `limitsNavigationsToAppBoundDomains` flag is meant to restore them but is reported to still conflict with `addUserScript`. The app therefore does not declare the key.
2. **Passkey login is unavailable.** WebAuthn in a `WKWebView` requires Associated Domains between the app and the relying party, which requires an `apple-app-site-association` file on `fastmail.com`. Not controllable. Login is password plus TOTP, once per app, persisted in cookies.
3. **Service workers may not run**, as WKWebView ties them to app-bound domains. Accepted risk; verified in Milestone 0.
4. **Web push does not exist in `WKWebView`.** No new-mail notifications. Accepted.

## Approach

A native SwiftUI app with no third-party dependencies. Shared logic lives in a local Swift package; the two apps are thin targets holding only configuration, an icon, and a profile constant.

Rejected alternatives: the Userscripts Safari extension (no native bridge, no app identity) and a Capacitor/Tauri wrapper (a JS toolchain wrapped around a few hundred lines of Swift).

## Project layout

```
~/src/fastmail-app/
  FastmailShell.xcodeproj
  Packages/FastmailShellKit/Sources/FastmailShellKit/
    AppShell.swift
    WebContainer.swift
    ScriptStore.swift
    ScriptInjector.swift
    NativeBridge.swift
    NavigationPolicy.swift
    Profile.swift
    Intents/
  Packages/FastmailShellKit/Resources/harness.js
  Apps/Personal/{Info.plist, Assets.xcassets, PersonalApp.swift}
  Apps/Work/{Info.plist, Assets.xcassets, WorkApp.swift}
  docs/superpowers/specs/
```

Deployment target iOS 17.

## Profile model

`Profile` is a struct with `id`, `displayName`, `startURL`, and `overlayScriptName`. Each app target instantiates exactly one.

| | Personal | Work |
|---|---|---|
| Bundle ID | `com.mdbraber.fastmail.personal` | `com.mdbraber.fastmail.work` |
| Display name | Fastmail | Fastmail Work |
| Overlay script | `userscript.personal.js` | `userscript.work.js` |
| Icon source | `~/Applications/mdbraber.com.app` | `~/Applications/nexthealth.nl.app` |

Separate bundle IDs give separate app containers, so `WKWebsiteDataStore.default()` yields two independent cookie jars and two concurrent Fastmail sessions. This is the entire mechanism behind profile switching; no in-app account handling is required.

Both targets declare the same iCloud container, `iCloud.com.mdbraber.fastmail`, so the shared script is authored once.

## Icons

Both icons already exist and are already distinct; they are reused rather than redesigned.

- **Personal** — a green recolour of the Fastmail envelope. It is a Finder-set custom icon, stored as a resource fork on a zero-byte `Icon\r` file at the root of `~/Applications/mdbraber.com.app`, and it overrides the bundle's `ApplicationIcon.icns`. Reading the `.icns` alone yields the wrong artwork.
- **Work** — the stock blue Fastmail envelope from `~/Applications/nexthealth.nl.app/Contents/Resources/ApplicationIcon.icns`.

Both are extracted the same way, via `NSWorkspace.icon(forFile:)`, which resolves whichever icon macOS actually displays and offers representations up to 2048×2048. The extraction is kept in the repository as `tools/extract-icons.swift` so the assets can be regenerated.

Each then needs converting to iOS form, since an iOS `AppIcon` must be a fully opaque square with no alpha and no pre-applied corner rounding. The macOS artwork is an inset squircle with a drop shadow, so it is scaled to full bleed (roughly 1.15–1.2×, letting the corners run past the edge where the iOS mask cuts them), composited onto an opaque backdrop, and exported at 1024×1024 with alpha removed.

## Components

**`AppShell`** — root SwiftUI view. Hosts the web container, a toolbar (reload page, share current URL, reload script), and a dismissible error banner bound to a published error state.

**`WebContainer`** — `UIViewRepresentable` wrapping `WKWebView`. Sets `isInspectable = true` so Safari Web Inspector on the Mac attaches to the injected script. Owns the navigation delegate.

**`ScriptStore`** — resolves the iCloud container via `FileManager.url(forUbiquityContainerIdentifier:)`, calls `startDownloadingUbiquitousItem` for items not yet local, and observes `Documents/` with an `NSMetadataQuery` scoped to `NSMetadataQueryUbiquitousDocumentsScope`. Publishes `ScriptBundle(shared: String?, overlay: String?)`.

**`ScriptInjector`** — builds the `WKUserScript` list in order: bundled `harness.js`, then `userscript.js`, then the profile overlay. All at `.atDocumentStart`, `forMainFrameOnly: true`. On any change it calls `removeAllUserScripts()`, re-adds the list, and reloads the web view.

**`NativeBridge`** — a single `WKScriptMessageHandlerWithReply` registered as `native`. Message body is `["action": String, "payload": [String: Any]]`. Unknown actions and malformed payloads reply with an error string, surfacing in JS as a rejected promise.

**`NavigationPolicy`** — in `decidePolicyFor`, allows `fastmail.com` and its subdomains; everything else is cancelled and passed to `UIApplication.open`.

## Script pipeline

```
iCloud Documents/userscript.js
  → NSMetadataQuery change
  → debounce 300ms
  → reject empty or unreadable content, retain last good copy
  → removeAllUserScripts() + re-add harness/shared/overlay
  → reload
```

The debounce and last-good retention exist because the file will be written from a Mac editor while the app is foregrounded; a partially written file must never replace a working script. Pull-to-refresh forces a re-read from disk for when iCloud sync lags.

If the container is unavailable (not signed into iCloud, first launch before download), the site still loads with harness only and the banner explains why.

## Harness API

`harness.js` ships in the bundle and runs before user scripts. It exposes `window.native`:

- `share({url, text})` → Promise resolving when the share sheet is dismissed.
- `registerAction(name, fn)` → registers a Shortcuts-invocable action; also notifies native so the name can be offered as a Shortcuts parameter option.
- `log(...args)` → Xcode console.
- `onRoute(cb)` → fires on route change. Implemented by patching `history.pushState` and `history.replaceState`, listening for `popstate`, and running a debounced `MutationObserver` on `document.body`. Necessary because `WKUserScript` runs once per document load and Fastmail is client-routed.

GM compatibility shims, so most Greasy Fork scripts run unmodified: `GM_addStyle`, `GM_setValue`, `GM_getValue`, `GM_deleteValue` over `localStorage` under a namespaced key prefix, and `GM_xmlhttpRequest` over `fetch`.

User scripts are wrapped in a try/catch inside an IIFE; a throw is reported to native and shown in the banner rather than failing silently as WebKit would otherwise do.

## Shortcuts

Two App Intents per app, titled with the profile name so the two apps are distinguishable in the Shortcuts picker:

- `OpenFastmail(path: String?)` — opens the app, optionally at a path.
- `RunScriptAction(name: String)` — opens the app, waits for load and action registration, then invokes the action via `callAsyncJavaScript`, awaiting the returned promise, and returns its string result. Parameter options come from the registered action names last persisted to `UserDefaults`.

Adding a Shortcuts action therefore means adding a `registerAction` call to the script, with no rebuild.

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

Integration test with a real `WKWebView` loading a bundled `fixture.html`: harness installs, `window.native` exists, `onRoute` fires after a `pushState`, `GM_addStyle` inserts a style element, a throwing user script is caught and reported.

Manual verification uses `isInspectable` and Safari Web Inspector.

## Milestones

- **M0 — Spike.** Bare `WKWebView` loading `app.fastmail.com`: confirm login with password and TOTP completes, confirm script injection runs, observe whether missing service workers degrade the app. Decision gate before further work.
- **M1** — Package plus two targets, profiles, navigation policy, persistent sessions.
- **M2** — `ScriptStore` and `ScriptInjector`, iCloud container, reload pipeline.
- **M3** — `harness.js`: route hooks, GM shims, error reporting.
- **M4** — `NativeBridge` and share.
- **M5** — App Intents.
- **M6** — Tests, icons, error states.

## Risks

1. Fastmail depends on its service worker more than expected. Mitigated by the M0 gate.
2. Fastmail login inside `WKWebView` hits a flow that assumes Safari. Mitigated by the M0 gate.
3. Fastmail ships UI changes that break selectors. Inherent to the approach; mitigated by keeping scripts defensive and reloadable without a rebuild.
