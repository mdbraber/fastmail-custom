# Custom mode as a Fastmail settings page — design

Date: 2026-09-13. Supersedes "The settings panel → Reaching it" and "→ Shape"
in `2026-09-12-settings-in-the-page-design.md`. Everything else in that spec
stands: the canonical catalogue, the write channels, resolution, the list
editors, the plain fallback panel, and what each host keeps.

## Why

The 2026-09-12 work put every Custom mode setting in a dialog raised over
Fastmail's Settings screen. Seen on the phone, it reads as a thing apart:

- **It looks different.** Every other entry in Fastmail's Settings opens a
  page; this one opens a floating dialog.
- **It is crowded.** The groups have no clear sections like the other pages,
  so the options run together.

So Custom mode becomes a real page in Fastmail's Settings, built the way
Fastmail builds its own.

## Measured

Read from the running app and its loaded code on 2026-09-13.

- **The Settings controller.** `FastMail.router.getAppController('settings')`
  is a `HierarchyController`.
  - `register(viewId, builder)` stores `builder` in `_registeredViews`.
  - `makeViewInstance` calls a registered builder as
    `builder(viewState, controller, parent)`, and takes a view or a promise
    of one. Only for an id with no registered builder does it fall back to
    `getModuleForViewId`.
  - Already registered: `notadmin`, `theme`, `actions`, `actions/edit`.
- **How Display options registers itself.** Its module ends with
  `register('theme', …)`, whose builder returns
  `new PageView({ isTitleFromH1s: true, title, url: 'theme', isImmortal: false, header: null, content: [new PreferencesPaneView] })`.
  `PreferencesPaneView` extends `SettingsPaneView`, whose class name is
  `v-SettingsPane`.
- **Stack titles and navigation.**
  - The controller's own `makeViewInstance` sets the stack entry's title from
    Fastmail's label table, so an unknown id gets an empty title.
  - `go(viewId)` replaces the view stack with that page.
- **The sidebar.**
  - `settings.get('sources')` is a `SourcesController`. Its `select(entry)`
    calls `settings.go(entry.id)`, except for the `notifications` and
    `device` special cases.
  - `sources.get('sourceGroups')` is a plain, unfrozen array of
    `{ title, content, options }`. The Preferences group's content ids are
    `theme`, `preferences`, `notifications`, `actions`, `offline`.
  - Each entry is `{ id, name, icon, href }`, where `icon` is a function
    returning a fresh SVG element with the classes `u-standardicon` and
    `v-Icon`.
  - `SettingsSourceView` draws an entry as a link to `/settings/<id>`, with
    its icon and name. `SourcesController` has `sourceGroupsDidChange`.
- **Reloading an address.** The controller's own `restoreEncodedState`
  sends an id missing from its label table to the default page. So
  `/settings/custommode` would not reach the page on its own.
- **Section markup.** Display options and Custom swipes build every section
  the same way:

  ```
  div.u-p-6.u-space-y-5#<anchor>
    div.u-flex.u-flex-wrap.u-mx-n6.u-my-n4
      div.u-mx-6.u-my-4.u-space-y-5.u-flex-1
        h1.u-flex-auto.u-font-bold.u-text-2xl.u-trim.u-break-words.u-containSelection
      div.u-mx-6.u-my-4.u-flex-major.u-space-y-8
        …controls
  ```

- **The pane's own style.** Fastmail's rule is
  `.v-SettingsPane { box-sizing: border-box; max-width: 804px; min-height: calc(100% - 48px); padding: 24px }`,
  with `padding: 0` below 768px.
- **Switches.** `ToggleView` draws `label` as `p.u-trim.u-font-semibold` and
  `description` as `p.u-trim.u-color-unimportant`. Its class carries
  `is-checked`, `is-unchecked` and `is-disabled`, and a click calls
  `userDidInput(!value)`.
- **A class to avoid.** Fastmail's `u-flex-1` also sets `width: 0`, so it
  collapses anything that is not a flex item.

## Decisions

- **A real page.** Custom mode is a page registered with Fastmail's Settings
  controller under the id `custommode`, with a real sidebar entry. It is not
  a dialog.
- **Headings only.** Each of the seven groups is a section headed by its
  title. No section gets a description, so there is no new copy.
- **Fastmail's own controls.** Toggles are Fastmail's switch (`ToggleView`),
  as on Display options.
- **Values, keys, titles, hints and defaults do not change.** Neither does how
  a value is written.
- **A fallback, not a lockout.** If anything the page relies on is missing,
  the userscript falls back to today's copied sidebar row and the plain
  fallback panel.

## Reaching the page

**The checks.** When the Settings controller is available, the userscript
checks that:
- the controller offers `register`, `makeViewInstance`,
  `restoreEncodedState`, `go`, and a `sources` controller;
- that controller's `sourceGroups` include the group holding the `actions`
  entry;
- `FastMail.classes` has `PageView`, `SettingsPaneView`, `ToggleView`,
  `TextInputView`, `ButtonView` and `View`.

Fastmail's groupings editor, opened from the page's Groups section, keeps its
own check for the classes its dialog needs. As today, a missing one there
reports a fault and leaves "Edit as text" working.

**Registration.** With every check passed, the userscript does four things
once per controller:

1. **Register the page.** `register('custommode', builder)`, where the
   builder returns the page.
2. **Add the sidebar entry.** Insert
   `{ id: 'custommode', name: 'Custom mode', icon }` into the group holding
   `actions`, directly after it, and let the sources controller redraw. The
   icon is Custom mode's own funnel, the glyph `filterGlyph` draws for the
   Triage row, built fresh on each call.
3. **Title the stack entry.** Wrap the controller's `makeViewInstance` so
   that, for `custommode` only, the returned stack entry's title is
   "Custom mode", since Fastmail's label table has none. Every other id
   passes through untouched.
4. **Catch its own address.** Wrap the controller's `restoreEncodedState` so
   that a path of `custommode`, optionally with a `#anchor`, calls
   `go('custommode')`. Any other path goes to Fastmail's own handler
   unchanged.

The Settings controller may not exist at start-up, because Fastmail loads
Settings when it is first opened. The userscript therefore registers whenever
the controller first becomes available, whether that is at start-up or later.
If the address is already `/settings/custommode` at that moment and the page
is not showing, it calls `go('custommode')` itself.

**Behaviour.**
- Choosing the entry opens the page like any other, and the address becomes
  `/settings/custommode`.
- On a wide screen the page fills the right-hand side and the entry is
  highlighted.
- On the phone it slides in with a back arrow.
- Back and forward work.

**`window.customMode.openSettings()`** goes to `settings/custommode` through
Fastmail's router. It returns `true` once it has asked to go there, or has
opened the fallback panel, and `false` only if neither was possible. The
Safari popup's contract is unchanged: it closes only on `true`.

**The fallback.**
- If any check fails, nothing is registered, nothing is wrapped and the
  sidebar's entries are not touched.
- The userscript inserts its copied "Custom mode" row into the sidebar, as
  today, and that row opens the plain fallback panel.
- `openSettings()` opens the same panel.
- The copied row is inserted only after the checks have run and failed, and
  never while the real entry is present, so the sidebar never shows
  "Custom mode" twice.

## The page

**Container.** A `PageView` titled "Custom mode", with `url: 'custommode'`,
`isImmortal: false`, `isTitleFromH1s: true` and no header. Its content is one
`SettingsPaneView`, the same container Display options uses.

**Sections.** One section per group in `SETTING_GROUPS` order: General,
Appearance, Labels & keeping, Groups, Snooze, Keyboard, Action bar.
- Each section uses the markup measured above, with anchor
  `s-custommode-<group id>`.
- The heading is the group's title in the left column, and the group's
  options fill the right column.
- On a narrow screen the right column wraps under the heading. That comes
  from Fastmail's `u-flex-wrap`, not from any breakpoint of ours.

**Controls.**
- **A toggle** is a `ToggleView` with `label` set to the option's title,
  `description` to its hint, and `value` to the setting. Flipping it writes
  the setting.
- **A text option** is a `TextInputView` with the option's title as its label
  and the hint drawn beneath it. The placeholder is the default, or "none"
  when the option is clearable, as today. It writes a moment after typing
  stops.
- **A sub-option** is indented under its parent, and disabled and dimmed
  while the parent is off, as today.
- **The Groups section** holds the groupings list, with Move, Edit and
  Remove, plus "Edit as text". Edit opens Fastmail's own groupings editor
  dialog, unchanged.
- **The Action bar section** holds the verb list, with its icons and
  drag-to-reorder, unchanged.

**Saving.** Writes go through `writeSetting`, exactly as today: to the app's
preferences, extension storage, or the local fallback. There is no Save
button. A text write still waiting when the page leaves the document is
written then, which replaces "when the dialog closes".

## What goes and what stays

**Goes.**
- `openSettingsPanel`, `closeSettingsPanel` and `settingsPanelView`: the
  dialog, its sidebar-of-groups and stacked layouts, and its Done button.
- `PANEL_WIDTH` and `PANEL_STACKS_BELOW`.
- Inserting the copied sidebar row when the page is available.

**Stays.**
- `SETTINGS`, `SETTING_GROUPS` and resolution.
- `writeSetting` and the three write channels.
- `settingRow`, which now draws a switch instead of a checkbox, and the
  register that disables and dims sub-options.
- The groupings and action bar list editors.
- `framedModal`, still used by Fastmail's groupings editor.
- `openFallbackSettings`.
- The copied sidebar row, as the fallback path only.
- `window.customMode.openSettings`, with its contract unchanged.

## Testing

The userscript has no test harness. The new code is checked in the running
Mac app over AppleScript, and those checks leave nothing behind:

- **Leave nothing registered.** Checks register the page under a throwaway
  id with a throwaway sidebar entry, then remove both and restore
  `makeViewInstance` and `restoreEncodedState` in the same run.
- **Leave settings as found.** Nothing writes a real setting unless it reads
  the setting first and puts it back.

**The checks:**
- **Sidebar entry.** It appears exactly once, directly after Custom swipes.
- **Opening the page.** Choosing it shows the page, with seven sections in
  the measured markup and the section headings in order.
- **Switches.** A switch reflects its setting and writes on flip, and a
  sub-option dims and disables with its parent.
- **Leaving the page.** Text typed just before leaving is written.
- **Reaching it by address.** Going to `settings/custommode` through the
  router, and `openSettings()`, both land on the page.
- **Fallback.** With a required class hidden for the run, the page is not
  registered, and the copied row and plain panel appear instead.
- **Narrow width.** At a width below 768px, each heading sits above its
  options and no row collapses in width.

`make test` passes at the end of every task.

**On installed builds, each install with the user's go-ahead at the time:**
- **Mac.** The page, the entry highlight, back and forward, and a reload of
  `/settings/custommode`.
- **iPhone.** The page slides in with a back arrow, headings sit above their
  options, and it scrolls.
- **Safari.** The toolbar button opens the page.

## Out of scope

- **Section descriptions.** The user chose headings only.
- **A settings change pushed while the page is open does not redraw it.**
  This was already deferred as its own small task: a naive redraw risks an
  echo loop.
- **Settings search.** Fastmail's Settings search keeps its own index of
  phrases, and Custom mode is not added to it.
