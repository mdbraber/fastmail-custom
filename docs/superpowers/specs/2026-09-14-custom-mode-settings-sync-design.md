# Custom mode settings sync between devices — design

Date: 2026-09-14. Custom mode's settings follow the user between their Mac,
iPhone and iPad through iCloud, per Fastmail account, in the Personal and Work
apps and in the Safari extension.

## Why

Custom mode's 27 settings live on one device. Changing a label colour option on
the Mac does not change it on the iPhone, and Safari keeps a third, separate
copy. The user wants a change made anywhere to reach their other devices, while
the Personal and Work accounts keep settings of their own.

## Measured

Read from this repository, Apple's documentation and a throwaway test on
2026-09-14.

- **Where settings live today.**
  - **The Mac and iOS apps** keep them in `UserDefaults.standard` under
    `customMode.<key>` (`CustomModeSettings.swift`). The page writes them with
    the bridge's `setting` action (`NativeBridge.swift`). The app injects them
    at document start as `window.__customModeSettings`.
  - **Pushing into an open page already works.** `CustomModeSettingsPusher`
    (`WebContainer.swift`) watches `UserDefaults.didChangeNotification`. It
    calls the userscript's `window.customMode.applySettings(...)`, which
    redraws the page without a reload. On iOS, `PushRegistrar` refreshes the
    home-screen shortcuts on the same notification.
  - **The Safari extension** (macOS only) keeps one set in
    `browser.storage.local` under `settings`:
    - `early.js` receives the page's writes by `window.postMessage` and stores
      them.
    - `background.js` injects the set at tab load and pushes `applySettings` to
      every Fastmail tab on `storage.onChanged`.
    - It has no native messaging, and its `SafariWebExtensionHandler.swift` is
      Xcode's echo template.
  - **A plain browser tab** keeps settings in `localStorage`
    (`custom-mode-settings`).
  - **The userscript also keeps, per app or browser,** whether Custom mode is
    on (`custom-mode`), folded groupings keyed by mailbox id
    (`custom-mode-groups`), and styles replayed at first paint
    (`custom-mode-early`).
- **The settings** (`DEFAULT_SETTINGS` in the userscript) are 15 booleans and
  12 strings.
  - `bottomBarItems` is how many actions fit on the iPhone's bottom bar.
  - `topBarItems` is the same for the top bar on iPad and Mac.
  - The shell's own device settings (`device.*`, `backend`, `startView`,
    `push.*`) are outside the `customMode.` namespace.
- **Identity.**
  - Personal and Work are each one multiplatform target, so iOS and macOS share
    a bundle identifier: `com.mdbraber.fastmail-custom.personal` and
    `…work`.
  - The Safari host app is `com.mdbraber.fastmail-custom.safari`, and its
    extension is `…safari.extension`. All are on one development team.
- **Entitlements today.**
  - No target has iCloud or an app group.
  - The Mac apps are not sandboxed.
  - The Safari host and extension are sandboxed.
- **The account id.** The userscript never reads the page's primary mail
  account id, and no message tells a host which account a page is on.
- **iCloud key-value storage** (`NSUbiquitousKeyValueStore`).
  - Apps from one team share a store by declaring the same
    `com.apple.developer.ubiquity-kvstore-identifier`, and an app's iOS and
    macOS builds share one by default.
  - The limits are 1,024 keys, 1 MB per user, and 64 bytes per key name.
  - A change notice gives a reason: server change, initial sync, account change
    or quota violation.
- **A Safari extension's native part can use a store shared with its host
  app.** A throwaway macOS app and Safari web extension were signed with the
  team and both declared one store identifier.
  - Automatic signing provisioned both.
  - With the extension enabled in Safari, its native handler wrote a value
    (`synchronize()` true, iCloud signed in) and read the app's value.
  - The app received the external-change notice for the extension's key in the
    same second.
  - The test app was removed afterwards. Two throwaway app ids remain
    registered on the developer account.

## Decisions

Made with the user on 2026-09-14.

- **Mechanism:** iCloud key-value storage in the Mac and iOS apps. Safari joins
  through the extension's native part inside its host app.
- **Accounts:** separate settings per Fastmail account, in **one shared store**,
  with every key marked by account.
- **Account marker:** the Fastmail account id (the page's primary mail account
  id), not the app name and not the email address.
- **What syncs:** 25 of the 27 settings. These stay on each device:
  - the two bar lengths
  - whether Custom mode is on
  - folded groupings
  - the replayed early styles
- **First sync:** iCloud wins.
- **Switch:** a "Sync settings with iCloud" switch on Custom mode's settings
  page, kept per app and per device, never synced, and on by default.
- **Turning syncing back on:** iCloud wins again, as on a first sync.

## Part 1: storage and rules

- **The store.** One identifier,
  `$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.personal`, is declared
  by:
  - the Personal app (iOS and macOS)
  - the Work app (iOS and macOS)
  - the Safari extension target
  
  The Safari host app does not declare it.
- **Keys.** `<account id>.<setting>`, for example `u1234abcd.labelColours`.
  - The setting part passes `CustomModeSettings.isWritableSettingKey` (letters
    and digits, starting with a letter).
  - The account id is at most 32 characters of letters, digits, `-` and `_`,
    so that with the longest setting name the key stays within iCloud's
    64-byte limit.
- **Values.** Booleans and strings, as stored today.
- **Local-only settings.** `bottomBarItems` and `topBarItems` are never read
  from or written to the store.
- **Knowing the account.**
  - Each page load reports its account id to its host: the app, or the
    extension.
  - The host remembers the last id, so an app can sync at launch before the
    page loads.
- **First sync: iCloud wins.**
  - A device that has not yet synced for an account (not *joined*) looks at the
    store.
  - If the store holds any key for that account, the device **adopts** them.
    Every synced local setting takes iCloud's value, and a synced local setting
    that iCloud lacks is removed, so the page shows its default.
  - If the store holds no key for that account, an app **uploads** all its
    synced local settings. Safari never uploads a whole set (Part 3).
  - After either, the device is joined for that account.
- **After joining.**
  - A setting changed on the device is saved locally and written to the store.
  - A change from another device replaces the local value, and an open page
    updates through the existing push path.
  - When two devices change one setting, the value that reaches iCloud last
    wins.
  - A value received from the store is never written back to it.
- **Without iCloud.** When the device is signed out, offline or over quota,
  every setting still works locally. The reason is logged, and syncing resumes
  when iCloud is available.

## Part 2: the Mac and iOS apps

- **A sync component** in `FastmailShellKit` (`CustomModeSettingsSync`, on the
  main actor).
  - It owns the rules above.
  - It talks to the local `UserDefaults` and to a small `KeyValueStore`
    protocol. `NSUbiquitousKeyValueStore.default` conforms in production, and a
    fake conforms in tests.
- **The account message.**
  - A new bridge action `account` with payload `{accountId}` is validated as in
    Part 1 and handed to the sync component.
  - The harness offers `window.native.account(id)`.
  - The userscript reports the id once Fastmail has loaded:
    `FastMail.auth.get('primaryAccounts')['urn:ietf:params:jmap:mail']`. It
    picks the host the same way `writeSetting` does: `window.native` in the
    apps, a `postMessage` in Safari.
  - The component saves the id as `settingsSync.accountId`, outside the
    `customMode.` namespace, so it is neither synced nor injected.
  - A different id switches to that account's keys and joins it.
- **Joined state.** `settingsSync.joined.<account id>` in `UserDefaults`.
- **Local changes.** The existing `onSetting` handler saves the value, then asks
  the sync component to write `<account id>.<key>` to the store, unless:
  - the key is local-only;
  - the account is not joined yet (joining settles it); or
  - there is no account id yet.
- **Changes from the store.** On `didChangeExternallyNotification`, the
  component checks the reason:
  - **Server change or initial sync:** each changed key under the current
    account's prefix, except local-only keys, is written into `UserDefaults`
    when it differs. Keys of other accounts are ignored. The existing pusher and
    home-screen refresh follow.
  - **Initial sync:** also triggers joining if the account is not joined.
  - **Account change** (a different iCloud account): clears every joined flag
    and joins again.
  - **Quota violation:** logged; local settings are unaffected.
- **When to join.** At launch, when an account id is known, and when the page
  reports an id. The component calls `synchronize()`. Then:
  - If the store has keys for the account, adopt.
  - If it has none, upload only once the initial-sync notice has arrived in
    this launch, or 30 seconds after a successful `synchronize()` with an iCloud
    identity present. Until then, keep waiting; the component schedules one
    re-check for the 30-second mark.
  - With no iCloud identity, stay unjoined.
- **Entitlements.**
  - `Apps/Personal/iOS.entitlements`, `Apps/Personal/macOS.entitlements`,
    `Apps/Work/iOS.entitlements` and `Apps/Work/macOS.entitlements` gain the
    store identifier.
  - Automatic signing adds iCloud to both app ids.

## Part 3: the Safari extension

- **Native part.**
  - The extension target gains an entitlements file with the store identifier,
    beside its existing sandbox setting.
  - `manifest.json` gains the `nativeMessaging` and `alarms` permissions.
  - `SafariWebExtensionHandler.swift` answers two messages:
    - `get {accountId}` replies `{available, settings}`: that account's store
      keys without the prefix, local-only keys left out, and whether an iCloud
      identity is present.
    - `set {accountId, key, value}` writes one key, refuses local-only keys and
      invalid ids, keys or values, and replies `{ok}`.
- **Tab accounts.**
  - The page posts `{source: 'custom-mode', kind: 'account', accountId}`.
  - `early.js` checks it like setting messages and forwards it to the background
    script.
  - The background script keeps each tab's account and `lastAccountId` in
    `storage.local`.
- **Per-account storage.**
  - `storage.local` holds `settingsByAccount: {<account id>: {...}}`.
  - `joinedAccounts: [<account id>, …]` records the accounts that have
    finished their first sync in Safari.
  - The existing `settings` object stays as the starting set for an account
    seen for the first time.
- **At tab load.**
  - The background script injects `settingsByAccount[lastAccountId]`, or
    `settings` when there is none, so the page draws at once.
  - When the page reports a different account, that account's set is applied
    live with `applySettings`.
- **Changes made in Safari.**
  - `early.js` saves each page write under the tab's account.
  - The background script sends `set` to the native part.
  - Local-only keys are saved locally only.
  - Pushing to tabs on `storage.onChanged` becomes per tab: each tab gets its
    own account's set.
- **Changes from other devices.** The native part cannot listen for iCloud, so
  the background script sends `get` for the accounts of open Fastmail tabs:
  - when a Fastmail tab loads or reports its account
  - when a Fastmail tab becomes the active tab
  - every 5 minutes (`alarms`)
- **First sync in Safari.** An account not yet joined in the extension:
  - adopts iCloud's keys when `get` returns any. This is the same as Part 1:
    synced keys iCloud lacks are removed from that account's set.
  - otherwise keeps its set, becomes joined, and sends each later change
    individually. Safari never uploads a whole set, so an extension that saw an
    empty store cannot overwrite settings that have not reached this Mac yet.
- **After joining.** Each `get` overwrites the account's local values for the
  keys iCloud holds.
- **Failures.** If the native part is unreachable or iCloud is unavailable, the
  extension keeps its local sets and logs the reason to the extension console.
- **Parity.**
  - Three places carry the key format and the local-only list: the apps' Swift
    component, the extension's Swift handler, and `background.js`.
  - A package test reads the extension's two files by path, as
    `SettingsParityTests` already reads the userscript, and fails when they
    disagree with the Swift component.

## Part 4: the sync switch

- **The switch.** Custom mode's settings page gains a "Sync settings with
  iCloud" switch at the top of its general section. Its hint reads: "Keeps
  these settings the same on your other devices for this Fastmail account. The
  bar lengths stay on each device. Turning syncing on takes the settings
  already in iCloud."
- **One per host, never synced.**
  - The Personal app, the Work app and Safari each have their own switch on
    each device, covering every account in that app.
  - The switch is on by default.
  - The apps store it as `settingsSync.enabled` in `UserDefaults`, outside the
    `customMode.` namespace. Safari stores it as `syncEnabled` in
    `storage.local`.
- **Only where syncing exists.**
  - A host that can sync injects `window.__customModeSync = {enabled}` next to
    `window.__customModeSettings`: the apps at document start, Safari at tab
    load.
  - The page shows the switch only when that object exists, so a plain browser
    tab never shows it.
  - The host sets the object again with each `applySettings` push, so the switch
    follows a change made in another window of the same app.
- **Changing it.**
  - In the apps, the page calls `window.native.setSettingsSync(enabled)`. This
    posts a new bridge action `settingsSync` with `{enabled}`, which accepts a
    real boolean only.
  - In Safari, the page posts `{source: 'custom-mode', kind: 'sync', enabled}`,
    and `early.js` passes it to the background script.
- **Turning it off.**
  - The host stops reading from and writing to the store. The apps ignore
    external changes and skip store writes; Safari sends no `get` or `set`.
  - Every setting keeps its current local value.
  - All joined flags are cleared: `settingsSync.joined.*` in the apps,
    `joinedAccounts` in Safari.
- **Turning it on.** The host joins the current account again, as in Part 1.
  iCloud wins when it holds settings for the account, so changes made while
  syncing was off are replaced. Otherwise an app uploads its settings and
  Safari keeps its set.

## Testing

- **Package tests** (Swift Testing, fake store, throwaway `UserDefaults`
  suites):
  - **Joining.** Adopt when the store has the account's keys, including removing
    synced local keys the store lacks. Upload after the initial-sync notice or
    the 30-second rule, and not before. Stay unjoined without an iCloud
    identity.
  - **Local changes.** A local change writes the prefixed key after joining. It
    writes nothing for local-only keys, before joining, or without an account.
  - **External changes.** An external change updates only the current account's
    keys and ignores other accounts and local-only keys. It does not write back
    to the store.
  - **Account changes.** An iCloud account change clears joined flags. A new
    page account switches keys and joins.
  - **Bridge.** The `account` action accepts valid ids and refuses empty,
    over-long or badly formed ones.
  - **Parity.** The extension's local-only list and key format match the Swift
    component.
  - **The switch.** Turning sync off stops every read and write to the store
    and clears the joined flags; turning it on joins again. The switch's key
    is never synced or injected as a setting. The `settingsSync` bridge
    action accepts only a boolean.
- **Integration test** (XCTest): `window.native.account` reaches the bridge.
- **iOS build check**, as for earlier plans.
- **Checks on the user's devices:**
  - A setting changed in the Personal app on the Mac arrives in the Personal
    app on the iPhone without a reload, and the reverse.
  - The Work app's settings stay separate.
  - A setting changed in Safari arrives on the iPhone, and one changed on the
    iPhone arrives in Safari: on tab focus, or within 5 minutes.
  - The bar lengths stay different per device.
  - With syncing turned off on the iPhone, a change there stays on the
    iPhone. Turning it back on brings back iCloud's settings.
  - The switch does not appear in a plain browser tab.

## Risks

- **Non-sandboxed Mac apps.**
  - The throwaway test used sandboxed targets, and the Personal and Work Mac
    apps are not sandboxed.
  - The first implementation task confirms that a signed Mac build of the
    Personal app can write and read the store before building on it.
- **First download not finished.**
  - An app that looks at an empty store before iCloud has delivered it could
    upload over the real settings.
  - The initial-sync notice and the 30-second rule reduce this. Safari avoids it
    by never uploading a whole set.
- **Changes before joining.** A setting changed on a device before it joins,
  or while syncing is off, is replaced by iCloud's value when iCloud has one.
- **Rate limits.** iCloud may delay frequent writes. Text fields already wait
  450 ms before writing, and checkboxes write once per click.

## Out of scope

- Syncing Personal with Work.
- Syncing whether Custom mode is on, folded groupings, the bar lengths or the
  early styles.
- Plain browser tabs without a host, and Safari on iOS (no iOS extension
  exists).
- The shell's own device settings and notification choices.
