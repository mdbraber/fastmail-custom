# Settings in the page

Date: 2026-09-12

Every Custom mode option is written three times: once as a SwiftUI form, once
as rows in the Safari extension's HTML, and once as rows a Python script
generates into the iOS Settings bundle. All three are driven from one
catalogue in Swift, which is what has kept them honest, but three renderings
of one list is still three renderings, and none of them can offer the thing
the groupings setting most needs — a list you can drag, rename in place, and
add to.

This moves all twenty-six Custom mode options into a single settings panel
drawn inside the Fastmail page, built from Fastmail's own view classes. One
implementation serves the macOS app, the iOS app, the Safari extension and a
plain browser tab, because the page is the only layer all four share. The
native screens shrink to the settings that must stay native.

## What the page already gives us

Measured against the running app rather than read from documentation. Every
class named here was confirmed present and shaped as described.

`FastMail.classes` exports 250 named view classes. The ones this rests on:

- **`CheckboxView`** draws a control, a label and a description in one row —
  `draw()` returns `[drawControl(), div[drawLabel(label), drawDescription(description)]]`.
  That is a settings row with its hint, already. It carries `isDisabled`,
  which is how a sub-option follows its parent.
- **`TextInputView`** carries `label`, `placeholder`, `value`, `inputType`,
  `isMultiline` and `isExpanding`, so one class covers both the one-line
  fields and the groupings text.
- **`ModalOverlayView`** has `show()`, which does
  `this.get('rootView').insertView(this)` and returns a promise resolved by
  `hide()`. `FastMail.root` is a real `RootView` with `insertView`, so we can
  raise and dismiss a dialog ourselves rather than borrowing the click
  handler of one of Fastmail's own menu options.
- **`GroupSettingsView`** is Fastmail's own groupings editor, reached today
  from the Group menu's "Custom…" entry. Its `init` reads
  `controller.get('sortSource').get('splits')`; its `save` writes that
  mailbox's `splits` and sets the controller's `groupBy`. Both are on the
  prototype and both are patchable.
- **`SplitConditionItemView`** is one row of that editor, and it carries the
  whole drag protocol — `isDraggable`, `isTouchDraggable`, `dragStarted`,
  `dragMoved`, `dragEnded`, `draggingLayout`, `minSortOrder` — alongside a
  `sortOrder` the parent list re-sorts on. Drag-to-reorder that works with a
  mouse and with a finger, already written.

The apps already inject a page-side bridge. `Resources/harness.js` defines a
`post(action, payload)` helper over `webkit.messageHandlers.native` and hangs
named functions off `window.native` — `log`, `share`, `setBadge`,
`badgeResolver`, `subjectResolver`, and an `openSettings` fired by a "Device
settings" row it inserts into Fastmail's own Settings sidebar. The userscript
already uses `window.native.setBadge` and `window.native.badgeResolver`. So
the apps have a channel; it simply has no settings action on it.

## Decisions

- The page draws every Custom mode option, **using Fastmail's own view
  classes** rather than markup of our own, so the panel is indistinguishable
  from the rest of the app on every platform and inherits its modal, focus
  and escape behaviour.
- The **values stay where they are** — `UserDefaults` in the apps, extension
  storage in Safari. The page gets a write channel to each. Nothing moves
  into web storage, so the values survive clearing website data, travel in
  the app's backup, and stay readable by native code.
- The **native screens keep only the shell's own settings**. They are not
  removed, because three of them decide whether a page can load at all.
- The **userscript's catalogue is canonical**. It is the only place an option
  is declared, and neither host holds a copy of the list — not its keys, not
  its copy, not its defaults. Each host handles the `customMode.` namespace
  without knowing what is in it. The single exception is `appBadgeLabel`,
  whose default Swift needs because `HomeShortcuts` reads it before the page
  has ever run.
- **No migration.** The `inboxMode.` rename and the 2.x settings version both
  landed on 2026-09-07 and every device has run them; the code that performs
  them goes, and nothing replaces it.
- A **plain-HTML fallback panel** ships alongside, drawn only when a Fastmail
  class the panel needs has gone missing. With the native screens gone, a
  renamed class would otherwise lock the user out of their own settings.
- The **action bar keeps its drag-to-reorder**. It has one today, in
  `SettingsUI.swift`'s `barOrderRows`; losing it would make this change a
  regression for the one option that already had the good editor.

## What moves and what stays

**Stays native, and why.** `backend` decides which host to load and
`startView` which path, both read before a page exists; get the backend wrong
and you cannot sign in, so the screen that fixes it cannot sit behind a
working page. `push.alerts` is read by `PushRegistrar` and belongs beside
iOS's own notification switches. On macOS only, compose mode, the downloads
folder and auto-open attachments are shell settings with no page equivalent.

**Moves to the page.** All twenty-six options in `CustomModeSettings.options`,
in their seven existing groups, with their existing titles, hints, defaults,
sub-option parents and clearable flags unchanged. This is a move, not a
rewrite: no copy changes, no keys change, no defaults change.

The surfaces end up as:

| Surface | After |
| --- | --- |
| iOS Settings → Apps → Fastmail | Backend, Start page, Notify for new mail |
| macOS Settings window | General tab only: backend, start page, compose mode, downloads folder, auto-open attachments |
| iOS in-app sheet | Backend, Start page |
| Safari extension popup | One button: open Custom mode settings in the current tab |
| The page | All twenty-six Custom mode options, everywhere |

## The settings panel

### Reaching it

`harness.js` already inserts a "Device settings" row into Fastmail's own
Settings sidebar, re-adding it whenever the DOM settles because Fastmail
redraws that sidebar. The panel gets a sibling row, "Custom mode", inserted
the same way — but **owned by the userscript, not by `harness.js`**, so it
appears in Safari and in a plain browser too, where `harness.js` does not
exist. "Device settings" keeps its current meaning and opens the native
screen.

`window.customMode` gains `openSettings()` alongside its existing
`toggleMode`, `refresh` and `applySettings`, which is both the console entry
point and what the extension's toolbar button calls.

### Shape

A `ModalOverlayView` hosting a view with the seven groups listed down the
left and the selected group's rows on the right, at a fixed width of 620 CSS
pixels. When `FastMail.isMobile` is true, or the root view is narrower than
700 CSS pixels, it collapses to one scrolling column with a heading per
group.

Each option draws as:

- A toggle is a `CheckboxView` with `label` bound to the option's title,
  `description` to its hint, and `value` to the setting.
- A text option is a `TextInputView` with `label` bound to the title,
  `placeholder` to the default (or to "none" when the option is clearable,
  matching what the SwiftUI form does today), and the hint drawn beneath it.
- A sub-option is indented and bound to `isDisabled` on the negation of its
  parent's value, so it greys out with its parent exactly as the SwiftUI form
  and the extension popup do today.

Two options are lists rather than fields, and are described in their own
section below: `groupings`, whose Groups section draws the grouping list with
an "Edit as text" disclosure revealing a multi-line `TextInputView` over the
same value for anyone who would rather type it; and `bottomBarSlots`, whose
Action bar section draws the verbs in order.

### Resolving a value

The rules `CustomModeSettings.current(from:)` applies today move here with the
catalogue, because Swift will no longer know which options are clearable. A
stored text value is trimmed of surrounding whitespace; if what remains is
empty, a clearable option resolves to the empty string and any other option
resolves to its default. A stored toggle is taken as it is. An absent value
resolves to its default. This is the existing behaviour, unchanged — only its
home moves.

### The catalogue

`CustomModeSettings.options` moves into the userscript as a `SETTINGS` array
beside `DEFAULT_SETTINGS`, one entry per option carrying `key`, `group`,
`parent`, `clearable`, `multiline`, `title` and `hint`. The default stays in
`DEFAULT_SETTINGS`, which already holds all twenty-six, so the default is not
written twice. Group titles move with it, as a `SETTING_GROUPS` list in
display order.

The userscript is one long IIFE with no build step, so this is a new section
in the same file, placed beside `DEFAULT_SETTINGS` rather than near the panel
that renders it — the catalogue is data about the options, not part of the
view.

**This list is canonical, and it is the only one.** Adding an option means
adding one entry here and nothing anywhere else. Neither host enumerates the
options, so neither can fall behind: they handle the `customMode.` namespace
as a namespace. In Swift that means `json(from:)` reads every
`customMode.`-prefixed key out of `UserDefaults.dictionaryRepresentation()`
and strips the prefix, rather than walking a list; in the extension it means
`background.js` passes stored settings through untouched. A key the page
stops using lingers in storage, unread and harmless, until the page writes
over it.

## The groupings editor

The Groups section lists your groupings — one row each, drag to reorder,
rename in place, a button to add one and one to remove it. The list is built
the way `GroupSettingsView` builds its own: an ordered collection whose item
view subclasses `SplitConditionItemView`, overriding `draw`, `editItem` and
`removeItem` while inheriting `sortOrder` and the whole drag protocol.

If that subclass cannot be constructed — the class is gone, or its shape has
changed enough that constructing one throws — the list falls back to plain
rows with an up and a down button each. That fallback is worth having on its
own account: a drag is the only way to reorder otherwise, and there is no
keyboard path to it.

Opening a grouping raises **Fastmail's own `GroupSettingsView`**, seeded with
that grouping rather than a mailbox's splits. It is constructed with a
stand-in controller:

```javascript
const standInController = (grouping) => {
    const source = {
        get: (key) => key === 'splits'
            ? { categories: grouping.categories, otherName: grouping.otherName }
            : key === 'name' ? grouping.name : null,
        set: (key, value) => {
            if (key === 'splits') captureSplits(grouping, value);
            return source;
        }
    };
    return {
        get: (key) => key === 'sortSource' ? source : null,
        set: () => {},                       // groupBy, which we do not keep here
        computedPropertyDidChange: () => {}
    };
};
```

`GroupSettingsView.prototype.save` calls, in order,
`sortSource.set('splits', …)` then
`controller.set('groupBy', …).computedPropertyDidChange('splits')`, then
`cancel()`. The stand-in absorbs the second and captures the first, so
Fastmail's own Save button writes into our settings text and nothing reaches
a real Mailbox record. This is the same stand-in technique the grouping work
already proved for `calculateSplits`.

What that buys, unbuilt: drag-to-reorder with a grip, an edit popover per
condition with a name field and a search field, a remove action, an
Add menu offering Pinned, Unread and a custom search, a rename field for the
"everything else" bucket, and Fastmail's own styling and localisation.

The captured value is serialised back into the `groupings` text with the
existing format — a line naming the grouping, indented `Name = search` lines,
a bare line for the leftover bucket — and written through the settings
channel. `parseGroupings` stays the reader; a new `formatGroupings` is its
inverse, and the two must round-trip.

The action bar's verb order gets the same treatment, in the Action bar
section: a list of the seven verbs with the same drag protocol and the same
up-and-down fallback, serialised back to the comma-separated string
`bottomBarSlots` already holds. Its verbs keep the glyphs the bar itself
draws, read from the page rather than from the apps' asset catalogue —
`barSlotGlyph` and `barSlotSymbol` exist in Swift only to feed the SwiftUI
list, and go with it.

Nothing new is needed to read the value. `orderedSlots()` already turns the
setting into a complete ordered list of verbs: it lowercases, applies the
`SLOT_ALIASES` map that renames the old `file` to `keep`, drops names it does
not recognise, and appends any verb the saved value fails to mention. That is
exactly what `CustomModeSettingsModel.loadBarOrder` reimplements in Swift
today, so the Swift copy and its alias table go and the editor calls
`orderedSlots()`.

## Writing settings back

One page-side `writeSetting(key, value)` picks whichever of three channels is
present, in this order: `window.native.setSetting`, then the extension, then
`localStorage`.

**The apps.** `harness.js` gains
`window.native.setSetting = (key, value) => post('setting', { key: key, value: value })`.
`NativeBridge.handle` gains a `setting` case that writes `customMode.<key>`
into `UserDefaults`. Swift holds no list of valid keys, so the guard is the
namespace: the key is refused unless it matches `^[A-Za-z][A-Za-z0-9]*$`.
That is enough on its own. Everything the page could write lands under
`customMode.`, a prefix no other setting uses, so `backend`, `startView` and
`push.alerts` are unreachable whatever the page sends, and a key path cannot
be smuggled through because a dot is not in the pattern. The value is refused
unless it is a `Bool` or a `String`. A refusal returns a `BridgeReply` error
and writes nothing.

**The Safari extension.** The payload runs in the page world, which cannot
reach extension storage. It posts to its own window:

```javascript
window.postMessage({ source: 'custom-mode', kind: 'setting', key, value }, location.origin);
```

`early.js` already runs at document start in the isolated world; it gains a
listener that checks `event.source === window`,
`event.origin === location.origin` and `data.source === 'custom-mode'`, then
calls `api.storage.local.set`. It also stamps
`document.documentElement.dataset.customModeHost = 'extension'` at document
start, which is how the page knows this channel exists — an isolated-world
content script cannot set a page-world global, but the DOM is shared.

Any script on the Fastmail origin could post that message. The settings are
not security-sensitive and the origin is Fastmail's own, so this is accepted
rather than mitigated.

**Neither.** In a plain browser tab the panel writes `localStorage` under
`custom-mode-settings`, and the userscript merges that over
`window.__customModeSettings` at startup. This also makes the fallback panel
useful when no host is present at all.

**Coming back.** Both hosts already push changes into the page —
`storage.onChanged` re-injects and calls `applySettings`, and the apps'
`applyScriptSource` does the same — so a change made in one window reaches
the others without new machinery.

**Not fighting the echo.** Text writes are debounced 450 ms, the interval the
extension popup's textarea already uses. While the panel is open,
`applySettings` updates the settings object but redraws only controls that do
not have focus, so an inbound echo cannot overwrite what is being typed.

## What each host keeps

**Swift.** `CustomModeSettings` loses the `Option` type, the whole `options`
array, the `Group` enum, `barSlotGlyph`, `barSlotSymbol` and
`migrateLegacyKeys`. What is left is small enough to describe in a sentence:
the `customMode.` prefix, a `json(from:)` that collects the prefixed keys out
of `UserDefaults.dictionaryRepresentation()`, `bootstrapScript`,
`applyScriptSource`, and one literal default — `appBadgeLabel` is `"Triage"`,
for `HomeShortcuts.badgeLabel`.

Because the page owns every default and already merges `DEFAULT_SETTINGS`
under `window.__customModeSettings`, the injection sends only what is
actually stored, and the resolution rules go with the catalogue. The
default-seeding pass that existed so the iOS Settings bundle could show a
value is removed along with the rows it served.

`SettingsUI.swift` loses `CustomModeSettingsForm` and
`CustomModeSettingsModel` entirely, `barOrderRows` and the bar-slot alias
table with them. `MobileSettingsSheet` keeps Backend and Start page.
`Apps/Shared/SettingsView.swift` keeps `GeneralSettingsView` and loses the
`TabView` wrapper and `CustomModeGroupView`.

**The Settings bundle.** `tools/gen-settings-bundle.py` stops parsing a
catalogue and emits three fixed rows — Backend, Start page, Notify for new
mail. It keeps being a generator rather than becoming a checked-in plist,
because the two apps need identical copies.

**The extension.** `settings.html` and `settings.js` become a popup holding
one button, which calls `scripting.executeScript` against the active Fastmail
tab in the `MAIN` world to invoke `window.customMode.openSettings()` and then
closes itself. If the active tab is not Fastmail, the button says so rather
than doing nothing.

`background.js` keeps its storage listener and its injection and loses
everything else: `DEFAULT_SETTINGS`, `SETTINGS_VERSION`, `LEGACY_DEFAULTS`
and `migrateSettings` all go. It reads what is stored and injects it, without
knowing or caring which keys exist. That is most of the file.

## The fallback

The panel resolves the four classes it cannot draw a row without —
`ModalOverlayView`, `CheckboxView`, `TextInputView` and `ButtonView` — before
it draws anything. If any is missing, it draws a plain-HTML form instead: the same rows from the
same catalogue, an `<input type="checkbox">` or `<input type="text">` each, the
groupings as a textarea, no drag-reorder, in a fixed-position overlay of our
own with a close button and an escape handler. It writes through the same
`writeSetting`.

It is deliberately dull and deliberately small. It exists so that a Fastmail
deploy that renames a class costs you drag-and-drop, not access to your
settings.

The two lists degrade separately and less drastically. `GroupSettingsView`
going missing costs the per-grouping condition editor, and the Groups section
falls back to its "Edit as text" disclosure; `SplitConditionItemView` going
missing costs the drag, and both lists fall back to up and down buttons.
Neither takes the panel down with it.

## Order of work

The panel has to exist and be verified on all three hosts before anything
native is deleted. Removing `CustomModeSettingsForm`, the Settings bundle
rows or the extension's option rows first would leave a build with no way to
change a setting at all. The write channels come before the panel, for the
same reason in miniature: a panel that cannot save is not worth drawing.

## Testing

**Swift.** `NativeBridgeTests` gains cases for the `setting` action. A
boolean and a string are each written under the prefixed key. A key that does
not match the pattern is refused with an error and writes nothing: a dotted
key, a key with a leading digit, one with a space, one with a hyphen, and an
empty key. Two cases guard the namespace itself and matter more than the
pattern does, because they are what stops the page reaching a shell setting:
sending the key `backend` writes `customMode.backend` and leaves the real
`backend` untouched, and sending `push.alerts` is refused outright for the
dot. A numeric or array value is refused. `HarnessTests` gains a case that
`window.native.setSetting` reaches the bridge, alongside the `openSettings`
case already there, because `harness.js` is only ever exercised in a real web
view.

`SettingsBundleTests` is rewritten against the three fixed rows.
`CustomModeSettingsTests` loses the cases for options and migrations that no
longer exist in Swift, and keeps the injection tests — with a new one, that
`json(from:)` picks up a `customMode.`-prefixed key it has never heard of and
ignores an unprefixed one, since collecting by namespace rather than by list
is the whole mechanism now.

`SettingsParityTests` shrinks to a single case, because after this there is
only one list of options anywhere: Swift's `appBadgeLabel` default matches
the userscript's. Everything the test used to guard — the extension's HTML
rows, its background defaults, the Settings bundle rows — is guarded now by
those lists not existing.

**The userscript** has no test harness — it is one IIFE with no imports and
no build step. Verification is the technique the grouping work used: slice
the changed section out, evaluate it in the running app with local stand-ins
for the helpers it calls, and put back any patch on a Fastmail class in the
same run. The round trip gets particular attention, because it is the one
piece that can lose data: `formatGroupings(parseGroupings(text))` must equal
the normalised text for the shipped default and for a grouping with no
leftover-bucket line.

**End to end.** An installed build, opening the panel on macOS and on the
phone, changing a toggle, a text field and a grouping, and confirming each
survives a relaunch. This needs `make install-macos`, which replaces both
applications and forces the running mail to quit, so it waits on an explicit
go-ahead. It is a merge gate, not an optional extra — and it also discharges
the same outstanding gate the groupings work left behind.

## No migration

Nothing to migrate, and nothing left that migrates. The keys, the store and
the values are unchanged; only the editor moves, so a value already in
`UserDefaults` or extension storage is read by the new panel exactly as the
old screens read it.

The two migration paths that exist today go with the lists they walked.
`CustomModeSettings.migrateLegacyKeys` moves values from an `inboxMode.`
prefix that the Custom mode rename retired on 2026-09-07; `migrateSettings`
in `background.js` drops keys the same rename retired, and rewrites two
values whose defaults moved. Both have run on every device that has launched
a build since, which is all of them, and neither can run at all once the
lists they enumerate are gone. They are deleted rather than ported.

The cost of being wrong about that is small and visible: a device that had
somehow never run a build from the last five days would come up with default
settings, and the panel would set them again.

The one visible loss from the change as a whole is that Custom mode options
no longer appear in the iOS Settings app. The settings that could strand a
user — backend and start page — are precisely the ones that stay there.

## Not in scope

- Syncing settings between the two apps and Safari. They are separate stores
  today and stay separate; this change neither helps nor hurts that.
- A search field in the panel. Twenty-six options across seven groups do not
  need one.
- Touching `backend`, `startView`, `push.alerts`, compose mode, the downloads
  folder or auto-open attachments, beyond removing the Custom mode rows that
  sat beside them.
- Reworking the groupings text format. `parseGroupings` stays exactly as it
  is; `formatGroupings` is written to match it.
