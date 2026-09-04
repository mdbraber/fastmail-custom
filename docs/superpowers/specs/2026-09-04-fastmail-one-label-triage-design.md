# Fastmail: one-label triage

Date: 2026-09-04
Status: design, not yet implemented
Supersedes: 2026-08-15-fastmail-triage-flow-design.md (the model; the
mechanics it documents — undo checkpoints, the picker, drag, the phone bar,
badge counts — carry over unless named below)

## Why

The current model gives a project label two jobs: it says which project a
message belongs to, forever, and — together with the Inbox — that the message
is still live. Archiving from the Inbox removes the second and keeps the
first; archiving from a label removes the label. So archive means something
different depending on the list you are standing in, and every verb has to
know about topics, qualifiers, a kept marker and two deferred states to keep
the two jobs apart.

Two things changed since that model was written. Fastmail added **grouping**:
a per-mailbox, server-side setting that cuts a list into named groups by
query, first match wins. And the account stopped carrying the kept marker at
all — there is no `Next` label — so in practice `v` already only files and
`e` already only archives.

This design collapses the two jobs into one. A project label is the live
state and nothing else. History is search.

## Model

| State | Carries | Who put it there |
|---|---|---|
| Triage | `Inbox` + `Triage` | the catch-all rule |
| Pre-filed | `Inbox` + `Triage` + one project label | the catch-all rule and a sender rule |
| Filed | `Inbox` + exactly one project label | you |
| Done | neither; helper labels untouched | you |

Pre-filed is what a sender rule produces — mail from `pknhaarlem.nl` gets
`Kerk` on arrival — and it is still yours to look at: `Triage` is on it,
and the Triage group comes before the project groups, so that is where it
shows. Keeping it is one key (`v`, below); archiving it is `e`. A rule can
file; only you can decide.

Snoozed is not a state of its own: it is any of the above that Fastmail has
taken out of the Inbox for a while. It comes back as whatever it was, with
its labels still on.

Invariants:

- **A project label implies the Inbox.** Opening a label is therefore the
  sub-inbox for that project, with no filter. The rule keeps it true on
  arrival, adding a label keeps the Inbox where it is, and archive takes
  both off together. The one deliberate exception is Fastmail's own move
  (Option-drag, or the Move menu), which takes the Inbox off and is left
  alone: it is asked for with a modifier, and the message shows in its
  label until archived.
- **At most one project label.** Adding one replaces any other.
- **`Triage` and a project label coexist only when rules put both there.**
  The client never adds `Triage`, and adding a project label from the
  client takes it off; the first verb on a pre-filed message resolves it.
- **Helper labels are invisible to the scheme.** Never added, removed,
  counted, offered in the picker, or coloured. They are what the stock
  labels menu is for.

The Inbox is everything live; its groups are the working surface. There is
no marker label, no qualifier, no filter, and nothing the script writes to a
mailbox setting.

## Labels

Recognised in this order — the first rule that applies wins:

| Kind | How it is recognised | Examples |
|---|---|---|
| `Triage` | named in `settings.triageLabel` | `Triage` |
| Project | any other user label that is visible in the sidebar and not excluded | `Personal`, `Kerk`, `Admin`, `Fiddle`, `SIDNfonds` |
| Helper | hidden from the sidebar, or named in `settings.excludedLabels` | `c`, `Feedbin`, `Server`, `Postmaster`, the year archives, `Later` |

"Visible in the sidebar" is Fastmail's own `hidden` flag on the mailbox,
which the script already reads (`isSidebarLabel`). The account already
sorts itself this way without having meant to: every label that behaves as a
project is shown, every label that behaves as a tag is hidden. `Later` is the
one exception — shown, but a 2,500-message pile rather than a queue — and it
stays excluded by name as it is today.

Nested labels are projects like any other; a parent is a project only if it
is visible and not excluded, and picking it is filing under it. The existing
prefix stripping (`stripLabelPrefix`) is unchanged.

`Triage` is applied by a **Fastmail rule** on all incoming mail, made by the
user once (see Setup). The script never adds it. A message that reaches the
Inbox without passing the rule — un-archived by hand, dragged back, moved
from Spam — carries no label and lands in the Inbox's catch-all group, where
it is visible until filed. That is the intended safety net, not a case to
paper over.

## Verbs

All work on the selection and the whole conversation, as today, and each
lands as one undo checkpoint under one toast.

| Key | Meaning | What it opens or does |
|---|---|---|
| `v` | keep | with a project label already on the thread: `Triage` off, nothing else, no picker. Without one: the picker — Fastmail's mailbox menu narrowed to projects, one pick, adds rather than moves, typing reaches anything. The pick is an ordinary add; the rules below do the rest |
| `Shift-V` | refile | always the picker, whatever is on the thread |
| `e` | done | archive: `Inbox`, `Triage`, every project label and the pin come off |
| `s` | pin | toggles the pin, nothing else |
| `w` | snooze | Fastmail's snooze dialog, prefilled for the default period |
| `l` | labels | Fastmail's tristate Labels menu, narrowed as today — helper labels live here |
| drag onto a label | add that label | Fastmail's drag; the rules below apply |
| Option-drag | Fastmail's move | Inbox off, label on; left alone |

The picker stays as a way of choosing; it no longer carries the model. The
model is enforced underneath every menu and gesture, the picker included:

### Enforced at the action level

Every label change in the client passes through five actions on the mail
controller — `add`, `remove`, `addremove`, `copy`, `move` — whichever menu,
key, drag or swipe asked for it. The script already wraps actions at this
level for archive (`patchArchive`), and that is what makes a swipe and `e`
do the same thing. The same wrapping carries three rules:

1. **Archive strips.** Any archive verb takes off `Inbox`, `Triage`, every
   project label and the pin. As today.
2. **A project label replaces.** Whenever the adds of an action include a
   project label, `Triage` and every other project label on those messages
   come off in the same action — silenced `didAction`, so it is one undo
   checkpoint and one toast. The Inbox is not touched: an `add` leaves it
   on, a `move` has taken it off on purpose. Helper labels never trigger
   this, and adding one never removes anything.
3. **A named label files the sender.** Whenever the adds include a label
   named in `contactGroupLabels`, the sender of each message goes into the
   contact group of that name, made if missing — as the picker did, now
   from every route. Filing to `Later` from the `l` menu, by typing its
   name, or by drag all count.

The wraps guard against re-entry: the removals rule 2 issues are
themselves an `addremove`, and must not be seen by rule 2 again.

`e` is the same from every list — the Inbox, a group inside it, a project's
own list, the Triage label, search — because there is no longer a difference
for it to be sensitive to. It inherits what archive already does besides
labels: marked read, reported not-spam.

`e` never opens the picker. The picker-before-archive existed to guarantee a
durable category before anything left the Inbox; with search as history,
filing something in order to strip it is pointless. `Shift-E` therefore goes.

`s` is a pin toggle and nothing more: the old "file first if unfiled" needed
a verb to wait on a pick, and there is no longer a pick to wait on. Filing
is `v`.

`v` is "keep": the picker only when there is nothing to keep it under. That
is the current script's picker rule, kept because sender rules make the
pre-filed case the common one, and one key is what it deserves. `Shift-V`
is the picker forced — the way to move a filed message to another project
without touching `l`. `o` (someday) goes and returns to Fastmail as
open-conversation.

**The picker stays; its job shrinks.** `v` opens what it opens today:
Fastmail's mailbox menu adopted as a picker (`applyMoveMode`), narrowed to
projects — visible, not excluded, not `Triage` — with typing reaching
anything, a single pick, the pick made an add rather than a move
(`addInsteadOfMoving`), and saved as soon as one option is left
(`autoSaveWhenAlone`, `labelsAutoSave`). That is a better way to file than
the tristate menu and it already exists. On the phone the File slot opens
the same picker.

What the picker no longer does is decide anything. The pick issues an
ordinary `add`, and rule 2 takes the other labels off in the same
checkpoint; the sender filing that lived inside the picker's `didSelect`
becomes rule 3 and fires from every route. Retired with that: the pending
verb that waited on a pick and handed it to `onCommit`, and the
label-changing branches of `didSelect` itself.

### `w` — snooze for a default period

Fastmail's toolbar Snooze button is a `MenuButtonView` (stock shortcut `b`)
whose menu is a `FutureTimeMenuView`. That menu has a custom option that
swaps its preset list for a `FutureCustomTimeView`: a date picker and a time
field, both bound to the view's `date` property, a relative preview ("in 2
weeks"), and Save/Cancel. Enter in the view saves. Save reaches the same
`actions.snooze(keys, date)` the script already wraps.

`w` presses that button the way the bottom bar already does
(`pressButtonView` on the view found by `hasShortcut(view, 'b')`), calls
`showCustomPicker()` on the menu, finds the custom view among the menu's
child views, and sets its `date` to today plus `settings.snoozeDefault` at
`settings.snoozeTime`. The user sees Fastmail's own dialog already filled
in; Enter confirms, Escape backs out, or they change the date first. Nothing
is snoozed until they confirm, and everything after that is Fastmail's —
including the undo toast.

`date` on that view is the local wall-clock time expressed as if it were
UTC (`drawCustom` subtracts the timezone offset; `localDate` adds it back).
The script must apply the same shift, or the dialog shows the right day at
the wrong hour.

On confirm, Fastmail stores the chosen offset as its own "last custom"
choice, so its Custom… option starts offering the same period. Accepted.

Settings: `snoozeDefault` (`2w`; accepts `Nd`, `Nw`, `Nm`), `snoozeTime`
(`08:00`), `snoozeKey` (`w`). A no-dialog variant (`Shift-W`, snooze
immediately for the default) is a few lines if wanted; not in scope.

The existing snooze patch — which stripped the kept marker on the way out —
goes with the marker. Snooze needs no patch at all in this model.

## Inbox groups

The groups are the user's, edited in Fastmail's own Group settings, stored
on the Inbox mailbox (`Mailbox.splits`, a synced attribute:
`{categories: [{name, query}], otherName}`). Each `query` is Fastmail search
syntax, compiled client-side into a `category` sort whose `groupBy` is a
list of JMAP filters; the server places each message in the first group it
matches. Groups have counts (`groupByCounts`) and collapse; the catch-all
renders last.

The recommended Inbox grouping, which replaces the current one:

| Group | Query | Why |
|---|---|---|
| Unread | `is:unread` | new mail first |
| Triage | `in:Triage` | undecided, at the top; never goes stale |
| Pinned | `is:pinned` | |
| one per project | `in:Personal`, `in:Kerk`, … | the sub-inboxes |
| *catch-all* | — | anything that arrived without passing the rule |

The current Triage group is a NOT-list over every project label, which
must be edited as projects come and go and already names a label that no
longer exists (`Adoptie`). `in:Triage` needs no maintenance. The current
Waiting group goes with the Waiting label.

**The script never writes `splits`.** Groups are a user setting, and the
header's principle stands: nothing here writes to a store record. Renaming
or adding a project is followed by the user adding its group, exactly as
they add the label.

Grouping renders in the phone layout as well (confirmed by the user), so
the same Inbox is the working surface on every device.

## The phone

The message bar keeps its shape — Snooze / Labels / Archive / Move to / More
— and the slot vocabulary shrinks with the verbs:

- **Labels** is Fastmail's tristate menu, narrowed as on the desktop —
  `l`. Picking a project there files too, by rule 2.
- **File** (formerly Keep) opens the picker — `v`.
- Archive is `e`. Pin is `s`. Snooze is Fastmail's menu, untouched.
- More carries whatever the bar cannot fit, in order, plus **Snooze 2
  weeks** (the `w` dialog). Keep, Waiting and Someday are gone.

`bottomBarSlots` default becomes `Snooze, Pin, Archive, Labels, File,
Delete, Move`.

All three rules are at the action level, so a swipe, a tap and a key do
the same thing. A rule at the keystroke would leave a swipe-archive on the
phone stripping the Inbox alone, and the message would then linger in its
label's list — the invariant broken by the most common gesture.

The native Fastmail iOS app is out of scope. Its archive leaves the project
label on; the message is healed by the next verb in a shell app.

## Drag

A plain drag onto a label adds it, and rule 2 does the rest when it is a
project: `Triage` and any other project come off, the Inbox stays.
Option-drag is Fastmail's stock move — Inbox off, label on — and is left
alone (`dragAdditive`, on by default, is what makes the plain drag an add
rather than Fastmail's default move). Dragging onto a helper label adds the
helper and nothing else.

## Sidebar and counts

- `Triage` and every project show their exact server-side thread total, as
  the Inbox does today. Since a project label implies the Inbox, the label's
  total *is* its queue; no registered query is needed for it.
- The Inbox shows its total: everything live.
- Helper labels show whatever Fastmail shows.
- The app badge is the `Triage` count (`appBadgeLabel: 'Triage'`).
- Row colouring by label stays; `labelColoursSkipProcess` becomes
  `labelColoursSkipTriage`, for the same reason: `Triage` is on every
  undecided row, and colouring by it would paint the whole group one shade.
- Label colours, separators, the lone-expando rule, and prefix stripping
  are unchanged.

## What goes

Features:

- The kept marker (`Next`/`Process`) and the Kept state.
- Qualifiers as a kind. `Admin` becomes a project.
- Waiting and Someday as states, and `w`/`o` as their verbs. `w` is
  reassigned to snooze; `o` reverts to Fastmail.
- Non-inbox labels (`nonInboxLabels`).
- The per-label filter system — **retired, not removed**; see below.
  Fastmail's groups do its job on the server now, and every label list is
  already the right slice.
- Filtered sidebar counts and the header count (`showFilteredCounts`,
  `showHeaderCounts`) — the user-facing settings go; the counting code is
  part of what is retired.
- `Shift-E`.
- The snooze patch.
- The picker's authority: the pending verb, `onCommit`, and the
  label-changing and sender-filing branches of its `didSelect`. The picker
  itself stays as a menu; the rules underneath it do the rest.

Settings removed from the catalog: `processLabel`, `qualifierLabels`,
`deferredLabels`, `waitingLabel`, `somedayLabel`, `nonInboxLabels`,
`waitingKey`, `somedayKey`, `showFilteredCounts`, `showHeaderCounts`,
`appBadgeFilter`, `labelColoursSkipProcess`. The first six and the two
count settings survive as internal constants beside the retired filter
code, not as anything a user sees.

Most of the change is deletion.

### Retired, not removed: the filter system

The per-label filters — `next`, `triage`, `deferred`, `noninbox`, their
older spellings, the `?filter=` parameter, the remembered choice per label,
the query builder, and the registered queries that counted them — stay in
the source, switched off, so they can be brought back if the groups turn
out not to be enough.

The code is two contiguous sections ("Sticky filter" and "The Next filter",
roughly lines 4658–5090 today) plus the counting section they draw on and
about a dozen one-line hooks elsewhere: configuration, state, the badge
queries, init. The sections are kept verbatim. The hooks are guarded by one
constant near the top, `LABEL_FILTERS = false`, and with it off nothing
installs: no entries in Fastmail's filter menu, `?filter=` ignored, no
registered count queries. Guarding rather than commenting out keeps the
code parsing and greppable; where a hook cannot be gated cleanly it is
commented out with the same `LABEL_FILTERS` marker so every retired piece
is found by one search.

Two things to know before turning it back on:

- The filter definitions are written against the old model — `next` is
  "Inbox or Process minus the deferred labels", `triage` is "Inbox with no
  verb yet". They would need re-basing on the new labels (`triage` is
  simply `in:Triage`; `next` has no meaning) before they say anything true.
- The settings they read (`processLabel`, `deferredLabels`,
  `qualifierLabels`, `nonInboxLabels`, `showFilteredCounts`,
  `showHeaderCounts`) leave the user-facing catalog. Where the retired code
  reads them it reads a small internal block of the same names, kept next
  to the retired code with the old defaults, so nothing references a
  setting that no longer exists.

## Settings

| Setting | Default | Note |
|---|---|---|
| `triageLabel` | `Triage` | new |
| `excludedLabels` | `Later` | unchanged: helpers that are nonetheless shown |
| `urgentKey` | `s` | unchanged |
| `snoozeKey` | `w` | new |
| `snoozeDefault` | `2w` | new |
| `snoozeTime` | `08:00` | new |
| `bottomBarSlots` | `Snooze, Pin, Archive, Labels, File, Delete, Move` | changed |
| `appBadgeLabel` | `Triage` | changed default |
| `labelColoursSkipTriage` | `true` | renamed |
| `contactGroupLabels` | as today | unchanged in meaning; now applies from every route |
| `labelColours`, `labelColoursSidebarOnly`, `dragAdditive`, `hideInboxLabel`, `stripLabelPrefix`, `labelsShortcut`, `labelsSidebarOnly`, `labelsAutoSave`, `swapArchiveExpand`, `sidebarSeparators`, `hideLoneExpando` | as today | unchanged |

The settings catalog lives in three places and they change together: the
userscript's `DEFAULT_SETTINGS`; the Safari extension's `background.js` and
`settings.html`/`settings.js`; and the shell apps' `InboxModeSettings.swift`
with the generated `Settings.bundle/Root.plist` for both apps
(`tools/gen-settings-bundle.py`, guarded by
`settingsBundleCarriesEveryInboxModeOption`).

## Setup (once, by the user)

1. Create the `Triage` label. Hidden or shown as preferred; the script
   finds it by name.
2. Add a rule that applies `Triage` to all incoming mail (confirmed
   possible). It must not stop rule processing, and sender rules that add
   a project label must run as well — order them so both apply, or the
   pre-filed state never arises.
3. Edit the Inbox grouping to the table above: Triage → `in:Triage`,
   remove the Waiting group.
4. Delete the empty `Waiting` label.
5. Optionally `Triage` the current Inbox by hand once, so the group is
   correct from the start. Anything not triaged sits in the catch-all,
   which is also fine.
6. Check that `Later` is named in `contactGroupLabels` if filing to it
   should keep adding senders to the Later group (147 members today).

## Compatibility

- Existing messages carrying a project label but not the Inbox — the
  current model's "Non-inbox" state, and anything archived-from-label — are
  Done by the new reading but still labelled. They show in their label's
  list until archived from there. Options: leave them (harmless, the list
  is just longer), or clear the labels off archived mail once by search.
  Not the script's job.
- `?filter=` on a URL is ignored while `LABEL_FILTERS` is off. The stored
  per-label filter choice is likewise ignored, and left in place rather than
  removed, since the retired code would read it again.
- Settings values stored under removed keys are ignored.
- A `Next`/`Process` label, if any account still has one, is an ordinary
  project by the label rule; the user hides or deletes it.
- Every other account this script runs on (the work account) follows the
  same rule for projects and helpers; it needs its own `Triage` label,
  rule and grouping.

## Scenarios

**1 — New mail, known project (1 key).** Arrives with `Triage`. In the
Triage group. `v` opens the picker; pick Personal. The pick is an add;
rule 2 takes `Triage` off in the same checkpoint. Inbox stays. Now in the
Personal group and in the Personal label.

**2 — New mail, done on sight (1 key).** `e`: Inbox and `Triage` off.
Gone from the Inbox; found by search.

**3 — Finishing a filed message (1 key).** In Personal. `e`: Inbox and
Personal off. Gone from both the Inbox and the Personal label.

**4 — Refile.** In Personal, `Shift-V`, pick Kerk: Kerk on; rule 2 takes
Personal off. (`v` here would keep, and there is no `Triage` to take off,
so it would do nothing.)

**5 — Urgent.** `s`: pinned. Now in the Pinned group (first match),
whatever its label. `s` again: unpinned, back to its group.

**6 — Park for two weeks.** `w`: Fastmail's snooze dialog, date two weeks
out at 08:00. Enter. Out of the Inbox; project label still on, so still
listed under its project. Two weeks later it returns to the Inbox in its
project's group, unread if Fastmail's setting says so.

**7 — Reply arrives to a snoozed thread.** Fastmail wakes the thread; it
returns to the Inbox with its label. Nothing for the script to do.

**8 — Drag.** From the Triage group onto Kerk in the sidebar: an add, so
as scenario 1. Option-drag: Fastmail's move — Inbox off, Kerk on; rule 2
still takes `Triage` off, the Inbox is left off as asked. The old
"non-inbox" outcome, chosen with a modifier.

**9 — Un-archived by hand.** Dragged from Archive back to the Inbox: no
label, so it lands in the catch-all group. `v` files it.

**9b — Pre-filed by a sender rule (1 key).** Mail from `pknhaarlem.nl`
arrives with `Triage` and `Kerk`. In the Triage group, because Triage
comes first. `v`: `Triage` off, nothing else asked — now in the Kerk
group and the Kerk label, exactly as if you had filed it. Or `e`: gone.

**9a — Later, from anywhere.** `l`, type "Lat", pick Later; or drag onto
Later. Later is a helper, so rule 2 does nothing — the project stays. Later
is named in `contactGroupLabels`, so rule 3 puts the sender in the Later
contact group, with the toast saying so. Same from the phone's Labels
button.

**10 — Helper label.** A calendar invite arrives with `c` (rule) and
`Triage`. `v` → Personal: `Triage` off, Personal on, `c` untouched. `e`
later: Inbox and Personal off, `c` untouched.

**11 — Multi-select, mixed.** Three messages, one in Triage and two in
Personal, selected; `v` → Kerk: all three end up Inbox + Kerk only. `e`:
all three lose Inbox and every project label. One checkpoint, one toast.

**12 — Phone.** Swipe to archive: rule 1, so as scenario 3. Tap File,
pick a project: as scenario 1; tap Labels and tick one: rule 2 all the
same. More → Snooze 2 weeks: as scenario 6.

## Constraints kept from the earlier specs

- Nothing writes to a store record outside a verb, and no verb writes a
  mailbox setting.
- Counts come from `Mailbox.totalThreads`, never from a scan of loaded
  messages.
- Each verb is one undo checkpoint; `z` reverts it whole.
- The payload guards against running twice.

## Verification

There is no automated test for the userscript. Verification is on the beta
site, which runs stock Fastmail in one tab and the script in another once
the extension is enabled there:

- Each scenario above, by hand, checking labels in the reading pane and the
  message's position in the Inbox groups.
- `probe-actionable.js`'s pattern for a read-only identity check where one
  applies — here, that every message carrying a project label is also in
  the Inbox, over the whole account, run before and after a session.
- The settings catalog: `make test` in `fastmail-app` for the plist parity
  guard; the extension's settings page by eye.
- The retired filter system stays retired: Fastmail's filter menu shows only
  its own entries, a `?filter=next` URL opens the label unfiltered, and no
  count query is registered. `node --check` on the userscript, since the
  retired sections must still parse.

## Not in scope

- Re-basing the retired filters on the new model. They are kept, not
  revived.
- The script maintaining the Inbox grouping.
- Adding `Triage` from the script to mail that missed the rule.
- Filing the sender when a *server-side rule* adds a label. The rules run
  on the server; the script sees only the client's actions.
- The native Fastmail iOS app.
- `Shift-W` (snooze without the dialog).
- Any change to prefix stripping, colours, separators or contact-group
  filing.
