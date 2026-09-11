# Message list groupings

Date: 2026-09-11

Fastmail can split a message list into named groups. This adds two groupings
of our own to the ones it offers, lets the user write more in Settings, and
fixes a bug that empties the list when a grouping and the sticky Inbox filter
meet.

## What Fastmail already does

Worth writing down, because every decision below rests on it. All of it was
measured against the live app rather than read from documentation.

The mail controller carries a `groupBy` of `""`, `isTodayWeekMonth`,
`isPinned`, `isUnread` or `custom`. It is not a preference: `groupBy` is
stored in `sort`, and `controller.sort` reads and writes `sortSource.sort`,
which is a **synced property on the Mailbox record**. So Fastmail already
remembers a grouping per mailbox and syncs it between devices. `sort` is an
array whose last entry is the sort field and whose first entry, when there
are two, carries the grouping name.

`custom` reads `splits` off the same Mailbox record — also a synced property —
shaped `{categories: [{name, query}], otherName, collapsed}`, where `query`
is a search string such as `in:Triage OR is:unread`.

`controller.calculateSplits()` turns that into
`{categories: [{name, filter}], otherName}`, parsing each query string into a
JMAP filter client-side. The filters then travel to the server in the query's
sort, as `{property: "category", isAscending: true, groupBy: [filter, …]}`.

**The grouping itself is done by the server.** It returns the ids already
ordered into buckets plus a `groupByCounts` array. The names, the catch-all
name and the collapsed set never leave the client; the server only returns a
count per index.

Each list is wrapped in a `SubsetQueryProxy` holding `collapsedGroups` as a
plain `Set`. Folding a group calls `collapsedGroupsDidChange()`, whose stock
implementation writes the indexes into the mailbox's stored `splits`.

## Decisions

- The mode **computes its groupings live** and never writes `splits` to a
  mailbox. The user's hand-made Projects split stays untouched and reachable
  through Fastmail's own "Custom…" dialog.
- The mode **does** store which grouping a mailbox uses, in Fastmail's own
  per-mailbox `sort`, so per-mailbox memory and device sync come free. The
  cost is accepted: a value Fastmail does not recognise reaches the server
  record, and in the official clients that mailbox then shows ungrouped.
- Collapse state for the mode's groupings **sticks locally**, in the mode's
  own storage, keyed by mailbox and grouping.
- The Labels grouping matches **plain label membership**, not descendants.
  Commit `4ffee16` already puts every ancestor label on when Keep files a
  message, so this is right for anything filed from now on; mail filed before
  it, and mail labelled through Fastmail's own Labels menu, lands in the
  catch-all group, where it is visible rather than hidden.
- "By age (urgent first)" **ships as the starting content of the editable
  field** rather than being fixed in code, so it doubles as the worked example
  of the format.

## The change

### A grouping identifier

`labels` for the automatic one, `split:<name>` for one the user wrote. Both
live in `sort[0].property`, alongside Fastmail's own five values.

Chosen by setting `sort` directly, **not** through the `groupBy` setter: that
setter deletes `collapsed` from the mailbox's stored split as a side effect,
which would discard the folded state on the Projects split every time the user
switched grouping and came back.

Fastmail degrades safely on a value it does not know. `calculateSplits`
returns `null`, no category sort is built, and the list shows ungrouped.

### Applying a grouping

`controller.calculateSplits` is an own property of the controller, so it is
wrapped directly. When the chosen grouping is one of the mode's, the wrapper
calls **Fastmail's original function with a substitute `this`** whose
`groupBy` reads `custom` and whose `sortSource` is a stand-in returning the
mode's definition and the real account id; everything else delegates to the
real controller.

Fastmail then parses the query strings with its own parser and returns its own
filter shape. The mode reimplements no search syntax and reaches no
module-private binding. Verified against the live app: `in:Triage OR
is:unread`, `is:pinned`, `date:today`, `date:yesterday`, `after:1w` and
`after:1m` all produced correct filters through this path.

The same substitution goes on `updateNewDayListener`, which registers for the
midnight refresh only when `groupBy` is `isTodayWeekMonth` or `custom`. With
the stand-in it registers for the mode's groupings too, so `date:today` groups
roll over at midnight instead of going stale.

### The Labels grouping

Built from the mailbox tree, so no query parsing is involved: the direct
children of the current mailbox that are sidebar labels and are not the triage
label, in sidebar order, each as a plain `{inMailbox: id}` filter. Catch-all
name "Other".

The existing helpers carry the definitions: `parentOf`, `isSidebarLabel`,
`isTriage`. On the work account's Inbox this yields Business, Projects, Boards,
Later — the hidden labels `c` and `Year` and the triage label are all excluded.

The mode already observes the mailbox store, so a label added, renamed, removed
or re-sorted recomputes the categories and calls
`controller.computedPropertyDidChange('splits')`. That property's declared
dependencies are `savedSearch`, `mailbox`, `groupBy` and `enableConversations`,
none of which change when a label does, so the explicit notification is
required — the same thing Fastmail's own dialog does when it saves.

The menu entry is hidden on a mailbox with no sidebar children, rather than
offered as an option that groups nothing.

It is code-defined and not editable.

### Groupings the user writes

A new setting, `groupings`, holding multi-line text, parsed in the userscript.

    By age (urgent first)
      Triage = in:Triage OR is:unread
      Pinned = is:pinned
      Today = date:today
      Yesterday = date:yesterday
      This week = after:1w
      This month = after:1m
      Older

Rules: a bare line opens a grouping and names it for the menu; a following
`Name = query` line adds a group; a following bare line names the catch-all;
a blank line ends the block. Leading whitespace is ignored. Without a
catch-all line the name is "Other". A grouping with no groups is skipped.
Two groupings with the same name: the first wins, so the identifier
`split:<name>` stays unambiguous.

That text is the setting's default value, so the field arrives holding exactly
the grouping above. The setting is clearable: emptied deliberately, it means
no groupings of the user's own, and Labels and Fastmail's five remain.

A mailbox whose `sort` names a grouping that is no longer defined — deleted
from the field, or renamed — behaves as no grouping at all, which is how
Fastmail already treats a value it does not recognise. The mode leaves the
stored identifier alone rather than rewriting it, so putting the name back
restores that mailbox's grouping. Renaming a grouping therefore loses the
mailboxes using it, and the hint says so.

One property of Fastmail's parser the user should know, and the hint will say:
an unrecognised query word does not fail, it becomes a free-text search. A
mistyped `date:todya` groups by the text "date:todya" rather than complaining.

### The Group menu

The stock menu is built by the `menuView` of the list header's `sort` button:
four radio items bound to `groupBy`, then a "Custom…" item. It is declared
`.property().nocache()`, so it is rebuilt every time it opens — which means an
inserted item can compute its tick once at build time and needs no live
binding.

The mode wraps that `menuView` to call the original and splice in Labels and
one entry per parsed grouping, between the radio section and "Custom…",
modelled on the "Custom…" item and built from the same class, reachable from
the items Fastmail has already constructed. The mode draws its own tick.

**This is the most fragile part of the work.** It patches a view rather than a
controller method, and it is the piece most likely to need repair when Fastmail
changes its list header. Implementation starts with a probe against the live
menu to settle exactly how the items are constructed.

### Collapse state

When one of the mode's groupings is active, the mode replaces
`collapsedGroupsDidChange` on the list proxy so it writes the folded indexes to
local storage keyed by mailbox and grouping, and seeds `collapsedGroups` from
there when the proxy is rebuilt. Fastmail's own groupings keep using Fastmail's
storage, untouched.

The hook point is an observer on `controller.mailboxMessageList`, which is a
computed that rebuilds whenever `mailbox`, `sort`, `splits`, `mailboxFilter`,
`search`, `searchIsGlobal` or `enableConversations` changes.

### The empty-list bug

Clicking a label with a grouping and the sticky Inbox filter both on sometimes
shows nothing at all. Caught in the broken state on the Projects label:

- `queryLength` was 31
- `groupByCounts` was `[0,2,33,1,142,1,9,13,0,1,2]`, summing to 204
- collapsed groups {3,4,5,6,7,9,10} accounted for 169 rows

The proxy computes its visible length as `queryLength − (counts of collapsed
groups)`, taking the counts at face value: 31 − 169 = **−138**. A negative
length draws nothing. Forcing a refetch restored `queryLength` 204 and length
35, and the list rendered.

So the two numbers had drifted apart, and collapsed groups are a required
ingredient rather than an incidental detail. The suspected cause is the mode's
own `refreshListAfter`: on a label list the filter is `AND(Inbox, label)`,
which Fastmail files under the Inbox, so a verb touching the label makes the
mode call `setObsolete`. That sends `Email/queryChanges`, and Fastmail's
`updateGroupByCounts` skips applying fresh counts while the query still holds
optimistic changes — length updates, counts do not. It is the same code path
as the open archive-sync bug.

It did not reproduce on demand, so the fix is a guard rather than a repair of
one path. On the same proxy hook the mode watches for
`sum(groupByCounts) > queryLength`, a condition that is never legitimate since
the catch-all count is their difference. On seeing it the mode clears the stale
counts — `groupByCounts` set to `null`, which makes `splitOffsets` return
`null` — so the list immediately draws as an ungrouped list instead of drawing
nothing, and marks the query for a full refetch so real counts return.
Fastmail's own `_groupRanges` already clamps the catch-all at zero, which is it
half-acknowledging the same condition.

The mode's `staleAfter` is separately changed not to be the thing that causes
the drift, but the guard is what makes it safe whatever the cause — including
Fastmail's own paths.

### Settings plumbing

The catalogue is `CustomModeSettings.options`, rendered by a shared SwiftUI
form on both platforms and mirrored by hand into `SafariExtension/settings.html`
and `settings.js`, the userscript's `DEFAULT_SETTINGS`, and each app's
generated `Settings.bundle/Root.plist`.

- A new `Group` case, `groups`, titled "Groups", giving the setting a macOS
  tab and a phone section of its own. It needs the room.
- One new option: key `groupings`, clearable, defaulting to the age preset
  written as a single-line Swift literal with `\n` escapes, so
  `tools/gen-settings-bundle.py`'s regex keeps matching.
- A `multiline` flag on `Option`. The value kind stays `.text`, so the
  resolver and its tests are untouched; only the form reads the flag, and
  renders a `TextEditor` instead of a `TextField`.
- `gen-settings-bundle.py` skips multiline options, because
  `PSTextFieldSpecifier` is single-line and cannot hold this.
  `settingsBundleCarriesEveryCustomModeOption` is updated to expect the skip.
  The phone still has the setting in its in-app sheet, which uses the shared
  form.
- `<textarea>` in the extension's options page.

#### One targeted improvement

Nothing today checks that the Swift catalogue, the userscript's
`DEFAULT_SETTINGS` and the extension's `settings.js` agree; they are kept in
step by hand. This change adds a long multi-line default to all three, which
is exactly the kind of value that drifts. So this work adds a parity test that
reads those two JavaScript files and asserts every catalogue key and default
matches. It is in the path of the work and stops the change silently rotting.

## Testing

Real tests on the Swift side, written first: the new catalogue default, the
`multiline` flag, the settings-bundle skip, and the new three-way parity test.

The userscript has no test harness — `make test` only runs `node --check` on
it. Following the repo's existing practice, the grouping-text parser and the
Labels category builder are exposed on `window.customMode` and exercised by a
new `Userscript/probe-groups.js`, run against the live app over AppleScript
the way the other probes are.

**This is a deliberate departure from writing tests first for the userscript
half**, recorded here rather than left silent. Building a unit-test harness for
a 5,000-line IIFE that is copied verbatim into the extension and both apps is a
larger change than this work, and is not smuggled in with it.

Live verification, on the work account, which has the nesting and the volume:

1. Labels on the Inbox shows Business, Projects, Boards, Later, and the
   stragglers in Other.
2. Labels on Boards shows ZonMw and Gezond Adviseren.
3. Renaming and adding a label updates the groups without a reload.
4. The age preset puts the right mail in each of its seven groups.
5. Folding a group survives leaving the mailbox and coming back, and does not
   appear in the mailbox's stored `splits`.
6. Switching to a mode grouping and back leaves the Projects split's own
   `collapsed` list intact.
7. Forcing `groupByCounts` out of step with `queryLength` makes the list fall
   back to ungrouped and refetch, rather than empty.

## Not in scope

- No backfill of ancestor labels onto mail filed before `4ffee16`.
- No change to Fastmail's own "Custom…" dialog.
- No attempt to make the mode's groupings visible in the official Fastmail
  clients.
- No unit-test harness for the userscript.
