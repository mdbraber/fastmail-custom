# Bar Items Sync Per Device Type — Amendment

> Amends `docs/superpowers/plans/2026-09-14-custom-mode-settings-sync.md` (Tasks 1-8, all committed). That
> plan made `bottomBarItems`/`topBarItems` local-only: never read from or written to iCloud, kept
> per individual device. This amendment changes that: each is now synced through iCloud, but scoped
> to a **device type** (`mac`, `iphone`, `ipad`) rather than to the account as a whole or to a single
> device. Every Mac (the Personal app, the Work app, and Safari) shares one value per account; every
> iPhone shares another; every iPad a third. Three iCloud-held values per account instead of zero.

**Why:** the user's own devices already differ enough in screen width within a device type that a
single per-account value would not fit every Mac (say, a laptop and a desktop display), but sharing
across the *same* type is exactly the granularity they want, confirmed directly:
- Safari's bar setting shares the Mac apps' bucket (not a bucket of its own).
- Device type is read via `UIDevice.current.userInterfaceIdiom` (`.pad` → `ipad`, anything else → `iphone`); macOS needs no such check.
- No special migration: whichever device of a given type opens first after this ships seeds that type's bucket in iCloud, same first-writer-wins rule as every other synced setting.

## Store key format

Unchanged, for every setting that is not a bar item: `<accountId>.<key>`.

New, for `bottomBarItems`/`topBarItems` only: `<accountId>.bar.<deviceType>.<key>`, e.g.
`u1234abcd.bar.mac.bottomBarItems`. The literal `bar` segment makes the two formats unambiguous to
parse (a plain key never has more than one `.`; a device-type key always has exactly three). All
byte-length and account-id rules are unchanged; the longest device-type key is well under the
64-byte limit (`.bar.iphone.bottomBarItems` adds 26 bytes to the account id, so ≤ 32 + 26 = 58).

## `SettingsSyncRules.swift`

- Rename `localOnlyKeys` → **`deviceTypeKeys`** (same two members: `bottomBarItems`, `topBarItems`).
  Update its doc comment: these no longer stay off iCloud; they sync per device type instead of per
  account. `isSyncedKey`/`storeKey`/`parse` are UNCHANGED — they must keep refusing these two names
  in the plain (account-only) key space, forcing them through the new device-type functions instead.
- Add `static let deviceTypeMarker = "bar"`.
- Add `enum DeviceType: String, CaseIterable { case mac, iphone, ipad }`.
- Add:
  ```swift
  static func deviceTypeStoreKey(accountId: String, deviceType: DeviceType, key: String) -> String?
  static func parseDeviceTypeKey(storeKey: String) -> (accountId: String, deviceType: DeviceType, key: String)?
  static func deviceTypeSettings(for accountId: String, deviceType: DeviceType, in contents: [String: Any]) -> [String: Any]
  static func deviceTypeStoreEntries(accountId: String, deviceType: DeviceType, local: [String: Any]) -> [String: Any]
  static func deviceTypeAdoption(local: [String: Any], inStore: [String: Any]) -> Adoption
  ```
  `deviceTypeStoreKey`/`parseDeviceTypeKey` validate the account id and that `key` is in
  `deviceTypeKeys`, mirroring `storeKey`/`parse`'s shape and length checks. `deviceTypeSettings` and
  `deviceTypeStoreEntries` mirror `settings(for:in:)` and `storeEntries(accountId:local:)` but for
  the device-type key space. `deviceTypeAdoption` mirrors `adoption(local:inStore:)`, except it does
  not call `isSyncedKey` (the dicts it receives are already scoped to `deviceTypeKeys` by the caller);
  removal is `local.keys.filter { deviceTypeKeys.contains($0) && inStore[$0] == nil }.sorted()`.
  `joinDecision(...)` is reused as-is for both key spaces (it is already a pure function of booleans
  and durations, not of key format).
- `extensionAnswer(to:hasICloudIdentity:storeContents:)`: Safari's device type is always `.mac`.
  - `get`: the `settings` reply merges `settings(for: accountId, in: contents)` with
    `deviceTypeSettings(for: accountId, deviceType: .mac, in: contents)` into one flat dict (no name
    collision is possible — the two key spaces never share a setting name).
  - `set`: if `key` is in `deviceTypeKeys`, write through `deviceTypeStoreKey(accountId:deviceType: .mac, key:)`
    instead of `storeKey(accountId:key:)`. Everything else about `set` (value must be a syncable
    boolean/string, refusal shape) is unchanged.
- Update `SettingsSyncRulesTests.swift`:
  - Rename every `localOnlyKeys` reference to `deviceTypeKeys`.
  - In `theExtensionRefusesBarLengthsBadIdsKeysValuesAndActions`, REMOVE the case
    `["action": "set", "accountId": "u1234abcd", "key": "bottomBarItems", "value": "4"]` (this now
    succeeds, it is no longer a refusal case).
  - Add new tests covering: `deviceTypeStoreKey`/`parseDeviceTypeKey` round-trip and refusals (bad
    account id, a key not in `deviceTypeKeys`, unknown device type string); `deviceTypeSettings`
    extracting only the matching account+device-type's bar keys; `deviceTypeStoreEntries` producing
    only prefixed bar keys from a local dict that also has plain settings; `deviceTypeAdoption`
    setting/removing correctly; and `extensionAnswer`'s `get` merging plain and mac-bucket bar
    settings, and `set` on `bottomBarItems`/`topBarItems` now succeeding and writing the mac-bucket
    key (not the plain one).

## `CustomModeSettingsSync.swift`

- `init` gains `deviceType: @escaping @MainActor () -> SettingsSyncRules.DeviceType`.
- New per-account state: `settingsSync.joinedBar.<accountId>` (this device's own device type is
  fixed for the process's lifetime, so no device-type suffix is needed on the key — one flag per
  account is enough). Add `isJoinedBar(_ accountId: String) -> Bool` alongside the existing
  `isJoined`.
- `joinIfNeeded()`: after (or alongside) the existing plain-settings join, run the same three-way
  decision (`adopt`/`upload`/`wait`) for this account's bar bucket, using
  `SettingsSyncRules.deviceTypeSettings(for: accountId, deviceType: deviceType(), in: store.dictionaryRepresentation)`
  as `storeHasAccountKeys`'s input and `SettingsSyncRules.deviceTypeAdoption`/`deviceTypeStoreEntries`
  for adopt/upload, gated on `isJoinedBar`/setting `joinedBar.<accountId>` — reusing the same
  `firstSuccessfulSync`/`initialSyncArrived` clock the plain join already tracks (one clock for the
  whole join process, not two). Keep the two decisions independent in outcome (a device can adopt
  plain settings while still needing to upload its bar bucket, or vice versa) even though they share
  timing.
- `localChanged(key:value:)`: route `key` through the device-type path when
  `SettingsSyncRules.deviceTypeKeys.contains(key)` — gated on `isJoinedBar(accountId)` instead of
  `isJoined(accountId)`, keyed with `deviceTypeStoreKey(accountId:deviceType: deviceType(), key:)`.
  Non-bar keys keep the existing plain path exactly as today.
- `take(_ keys:)`: alongside the existing plain extraction, also apply any of the given keys that
  `SettingsSyncRules.parseDeviceTypeKey` resolves to this device's own `accountId` and `deviceType()`
  — same "only where it differs, never write back" rule as the plain path.
- `setEnabled(false)` / an iCloud account change: also clear every `settingsSync.joinedBar.*` flag,
  alongside the existing `settingsSync.joined.*` clear.
- `install()`: pass `deviceType: { #if canImport(UIKit)\n  return UIDevice.current.userInterfaceIdiom == .pad ? .ipad : .iphone\n  #else\n  return .mac\n  #endif }` (add `import UIKit` under the same `#if canImport(UIKit)` guard already used elsewhere in this file/package). No changes to `PersonalApp.swift`/`WorkApp.swift` — `install()` alone determines device type, so their `init()` calls are untouched.
- Update `CustomModeSettingsSyncTests.swift`'s `Harness` to accept (or default) a `deviceType`
  closure, and add tests mirroring the plain-join tests for the bar bucket: adopting an existing
  mac-bucket value, uploading after the initial-sync notice/30s grace when the bucket is empty, a
  local bar change writing the device-type key once joined (and not before), an external bar change
  from another device of the *same* type being taken, one from a *different* type or a different
  account being ignored, `setEnabled(false)` clearing the bar-joined flag and stopping bar writes
  too, and the switch-off/on round trip re-adopting the bar bucket same as the plain one.

## Safari extension

- `SafariExtension/background.js` and `SafariExtension/early.js`: **remove** `LOCAL_ONLY_KEYS` and
  every use of it (`syncedOnly`'s exclusion, `sendSetting`'s early return for a local-only key,
  `pullAccount`'s "keep the local-only keys, overwrite the rest" branch). Bar items now flow through
  the exact same `sendSetting`/`pullAccount`/`get`/`set` paths as any other setting — the native
  part alone decides (via `SettingsSyncRules`) whether a given key lands in the plain or the
  mac-bucket store key. This is a simplification, not new JS logic. `ACCOUNT_ID_PATTERN` is
  untouched in both files.
- `SafariExtension/README.md`: update the "Settings sync" section's bullet "`bottomBarItems` and
  `topBarItems` stay on this Mac" to describe the new per-device-type sharing (Safari shares the
  Mac apps' bucket).

## `SettingsParityTests.swift`

- The Task 8 parity test (`theSafariExtensionsScriptsAgreeWithTheSyncRules`) currently checks
  `background.js`'s `LOCAL_ONLY_KEYS` line against `SettingsSyncRules.deviceTypeKeys` (renamed).
  Since that constant no longer exists in the JS files, drop that half of the test and keep only the
  `ACCOUNT_ID_PATTERN` check in both files.
- The Task 7 parity test (native part answers through the shared rules) is unaffected.

## Testing

- `swift test` (package): every renamed/added rules test, every added component test.
- `node --check` on both edited Safari scripts.
- A stand-in run equivalent to Task 8's `check-safari-scripts.js`, adjusted so its assertions no
  longer expect bar items to be excluded from `set`/`get` — write a fresh version of that script (or
  edit the existing one's expectations) to assert bar items now round-trip through iCloud like any
  other setting, still scoped to this Mac's bucket.
- `make test` for the whole suite (package, IntegrationTests scheme, Server, `node --check`).
- No app rebuild/install is required by this change alone — the running installs from Task 9 keep
  working with the *old* local-only behavior for the bar setting until they are rebuilt and
  reinstalled with this change, which is a separate, later go-ahead (not part of this task).

## Commit discipline

Same rules as the parent plan: stage only this task's own files by explicit path (never `git add -A`/`-a`),
`git diff` each file first to confirm no stray hunks, commit message via `git commit -F -` heredoc,
trailer is this session's own attribution (see system reminders), never the parent plan's literal
Opus 5 trailer. Likely two natural commits — one for the Swift package (rules + component + tests),
one for the Safari extension (scripts + README + parity tests) — but a single commit covering both
is also acceptable if that reads more cleanly as one change.
