# Fastmail: triage flow

Date: 2026-08-15
Status: design, not yet implemented

## Model

| State | Carries | List |
|---|---|---|
| Untriaged | `Inbox` | the Inbox itself |
| Kept | `Process`, not `Inbox` | `Process` |
| Done | neither | — |

The Inbox *is* the queue — no marker label, no catch-all rule. Both lists are
ordinary mailboxes, never searches.

Invariants:

- Nothing leaves the Inbox without a topic label, except by confirming the
  picker with nothing set — `Enter`, or `Shift-E` as its shortcut.
- `Inbox` and `Process` are mutually exclusive. Overlap is reachable only by
  moving a message by hand; it then shows in **both** lists rather than
  vanishing, and the next verb resolves it.

## Labels

| Kind | Examples | Count per message | Durable |
|---|---|---|---|
| Topic | `Work`, `Personal`, `Newsletters` | 1, usually | yes |
| Qualifier | `Admin`, `Waiting` | 0+ | yes |
| Marker | `Process` | 0–1 | no — stripped on archive and on snooze |
| Pin | — | — | no — stripped on archive |

Flat, all top-level. Qualifiers are named in `settings.qualifierLabels`; the
marker in `settings.processLabel`. Everything else is a topic.

`Waiting` is an ordinary qualifier that also appears in
`settings.deferredLabels`; the two lists overlap by intent, and nothing else
distinguishes it.

## Verbs

| Key | Meaning | Adds | Removes | Picker |
|---|---|---|---|---|
| `e` | done | — | `Inbox`, `Process`, deferred, pin | if no topic |
| `v` | keep | `Process` | `Inbox`, deferred | if no topic |
| `s` | urgent | `Process`, pin | `Inbox`, deferred | if no topic |
| `w` | waiting (v2.19) | `waitingLabel` | `Process`, other deferred | if no topic |
| `o` | someday (v2.19) | `somedayLabel` | `Process`, other deferred | if no topic |
| `Shift-E` | escape | — | `Inbox`, `Process`, deferred, pin | skipped |
| `Shift-V` | label only | chosen label | — | always |
| `l` | stock tristate | — | — | always |

The defer verbs leave the Inbox where it is: the deferred slice reads
this-mailbox AND deferred, so taking the Inbox off would hide the parked
pile from the Inbox's own Deferred filter. `waitingLabel` and
`somedayLabel` are settings (defaults `Waiting`/`Someday`), folded into
the deferred and qualifier sets automatically. `o` claims Fastmail's
open-conversation key while the mode is on; `Enter` still opens. On the
phone, Keep / Waiting / Someday live in the message bar's More menu.

As of v2.19 the marker is nobody's to tick: `Process` no longer shows in
the manual tristate — the verbs alone write it — and a deferred verdict
ticked by hand strips it on apply, the same exclusivity the quick
picker's defer branch keeps.

`Shift-E` is not a separate path: it is `e` followed by confirming the picker
with nothing selected. One keystroke for a two-keystroke sequence.

Each verb lands as one undo checkpoint under one toast: every move it makes
queues in the undo manager's `pending`, and the single `didAction` left
unswallowed cuts the checkpoint. `z` reverts the whole verb.

`e` inherits what archive already does besides the labels: the message is
marked **read** and reported not-spam. That is stock Fastmail, kept — done
mail is read mail.

### `s` has three cases

| Message is | `s` does |
|---|---|
| untriaged, unpinned | triage as kept, and pin |
| untriaged, already pinned by a rule | triage as kept, **keeping** the pin |
| already in `Process` | pin toggle only, no state change |

### Multi-select

A verb over a selection where **every** message has a topic runs directly.
Where any lacks one, the stock tristate picker opens showing half-state for
labels only some messages carry. Only an explicit all-on or all-off changes
anything.

The picker closes two ways, and they mean opposite things:

| | Result |
|---|---|
| `Enter` | proceed, even with messages still untopiced |
| `Escape`, or dismissing it | abort; nothing archived, nothing filed |

Committing with nothing set is deliberate, so it is allowed — that is what
`Shift-E` is a shortcut for. Cancelling is not, so it undoes the whole verb.

Undoing an archive walks the view back to the restored message (v2.18):
the archive verbs stamp the message's URL onto the checkpoint their
`didAction` cuts (any other action's checkpoint stamps null), and a wrapped
`undo` — found by shape on the FastMail namespace, so the toast button and
`z` both route through it — navigates there via
`router.restoreEncodedState`, the same path back/forward takes.

On the phone there are no shortcut buttons to borrow and no `Enter`, so the
verb presses the message toolbar's own Labels button and adopts the sheet it
opens (v2.5). The close gestures translate:

| | Result |
|---|---|
| close with a topic ticked | commit — the sheet's changes fold into the verb's checkpoint, the verb proceeds |
| close with nothing ticked | the verb aborts silently (v2.16) — archiving unfiled has its own gesture, the long press (v2.8) |
| long-press Archive | archive unfiled, no picker (v2.8) |

Where no Labels button is visible — a swipe in the list — a dialog
("OK proceeds unfiled, Cancel aborts") alone stands in for the picker.

In a topic or Process label view the phone's bar carries an **Archive**
slot (v2.17) in place of the contextual Remove-label button Fastmail
draws there: arriving in a label means filing already happened, so the
slot runs the full done verb — Process and the deferred set come off if
present, the Inbox too, the topic stays. Remove label (the unfiling
correction) lives on in the More menu. Deferred label views keep the
stock slot, since there removal *is* the verb — it un-defers.

## What counts as a topic (v2.7)

A topic is a user label **visible in the sidebar** (Fastmail's own `hidden`
flag, bit 1 clear) that is not the Process marker, a deferred label, a
qualifier, or named in `settings.excludedLabels` (default `Later`). The
pickers offer exactly this set plus the qualifiers, and `untopicedAmong`
uses the same rule, so a message carrying only an excluded or hidden label
still counts as untopiced. The saved searches remain the inboxes for counts
and colouring, but they no longer define the topic set.

## The topic rule

> A triaging pick clears `Inbox` only when the label picked is a topic.
> `Shift-V` and `l` never clear it at all.

| Path | Triages? |
|---|---|
| `v` | on a topic only |
| drag onto a label | on a topic only |
| `Shift-V` | never |
| `l` | never |

`Shift-V` never triaging is what makes it usable to correct a wrong auto-label:
the message holds its place in the queue while you fix what it says.

## Snooze

| | |
|---|---|
| On snoozing | strip `Process`; Fastmail strips `Inbox` |
| While snoozed | carries topic + qualifiers + `Snoozed`; absent from both lists |
| On waking | returns to the Inbox, untriaged, still topic-labelled |
| Cost to re-file | one key |

One meaning wherever it is invoked: *gone now, queued later*. No restore-target
API call, no source-dependence.

## The Actionable filter

A new value in Fastmail's own filter menu, beside `unread`, `pinned`, `vips`
and `inbox` — not a second toolbar control, so it inherits the menu, the
`?filter=` encoding and `rememberedFilters` unchanged.

```
actionable  =  inMailbox Inbox  OR  inMailbox Process
deferred    =  inMailbox Snoozed  OR  inMailbox Waiting
```

Both appear in the filter menu, as complements of each other. Because deferring
is a **move** rather than an overlay, `actionable` needs no `NOT` clause: nothing
in `Process` is deferred, because deferring took it out.

A third value, `triage` (added in 2.2), names the undecided slice:

```
triage      =  inMailbox Inbox  AND NOT (Process, Snoozed, Waiting)
```

It splits `actionable` into decided (kept) and undecided; an empty triage view
is triage zero — every message in the queue has been given a verb. It rides
the same machinery as the other two: a row in both filter menus, ?filter=,
per-label memory, exact primed counts. And because the Inbox is a top-level
AND condition here, `stayHere`'s walk finds it — archiving from the triage
view needs no forced navigation.

| Filter applied to | Shows |
|---|---|
| a topic | that topic's untriaged and actionable mail |
| `Process` | everything — it is already the actionable list |
| the Inbox | the queue |

`deferred` is what makes the deferred mail reachable again, per topic or
whole: `Waiting` and `Snoozed` in one list, which is the review surface the
`Someday`/`Waiting` discussion needed and did not have.

JMAP's `NOT` requires all its conditions false, so one node covers the whole
deferred set. Membership is `settings.deferredLabels`, default `Waiting,
Snoozed`.

The two clauses overlap on purpose. Snoozed mail is already excluded by the
first — it has neither `Inbox` nor `Process` — so naming it again keeps
`actionable` correct even if the snooze strip fails to fire.

### What belongs in the deferred set

Only labels that sit on mail **still in `Process`**. Anything filed outside it
is excluded by the first clause already.

| Label | Returns by | Where it lives | In `deferredLabels`? |
|---|---|---|---|
| `Snoozed` | a date, automatically | nowhere | yes, as insurance |
| `Waiting` | you noticing a reply | `Process` | yes |
| `Someday` | deliberate review only | **archived**, not `Process` | no — excluded for free |

`Someday` is the one to keep out of `Process`. It has no return trigger, so
holding it there fills the action list with things that will not be acted on,
and hiding it by default makes that invisible. Filed as an ordinary label on
archived mail it gets its own sidebar row and badge, and is reviewed by opening
it.

### How a deferral clears

**Labels are stored per-message, and filters are evaluated per email and then
collapsed, so a thread appears if *any* of its messages matches.** That much
stands. But the earlier conclusion drawn from it — that the script must expand
threads by hand — was wrong, and the correction comes from the source
(`doAction`, static read 2026-08-15) rather than another probe.

Every controller verb runs its store keys through `doAction`, which expands
them **before** the verb sees them, by a per-verb scope flag:

| Verb | Expansion |
|---|---|
| `remove`, `removeCurrent`, `archive`, `snooze`, `copy`, and `addremove` whenever it removes anything | the whole thread, filtered by `viewThreadsAs` (normally every message not in Trash) |
| `add` — and `addremove` degenerates to `add` when given one label and no removals | only the thread's messages **in the current mailbox** |
| conversations disabled | no expansion — exactly the keys given |

The measured "changed exactly one message" came from `add`'s current-mailbox
scope, not from an absence of expansion.

The burden is still asymmetric:

| | Requirement |
|---|---|
| **Applying** a deferral | must cover **every** `Inbox`/`Process` message in the thread — one is not enough, the others keep it visible |
| **Clearing** a deferral | one non-deferred message is enough to resurface the thread; clearing the rest is tidiness, not correctness |

But no hand expansion is needed anywhere: because deferring is a **move**,
applying `Waiting` is `addremove(keys, [Waiting], [Process])`, and an
`addremove` with removals expands to the whole thread on its own. The one trap
left is issuing a deferral as a bare `add` — that one is scoped to the current
mailbox and would miss the thread's other messages. Route every deferral
through the move, which the model requires anyway.

Deferral is a disposition, not durable metadata — the same kind of state as
`Process` and the pin — so every triage verb also clears the deferred set
across the thread. `Snoozed` is the exception, being system-managed rather than
a label you can remove.

A reply needs no special handling, and this is why: it joins the thread carrying
`Inbox`, so `actionable` matches the reply — in `Inbox`, not `Waiting` — and the
thread surfaces even while the older message still carries the stale label.
Re-triaging then tidies it.

| Step | State |
|---|---|
| chased them, nothing to do | `Work` `Process` `Waiting` — hidden |
| reply arrives | thread also has an `Inbox` message — surfaces in the queue |
| press `v` | `Waiting` cleared, `Process` re-applied — actionable again |

No `New` label and no catch-all rule: the discriminator between *waiting,
nothing has happened* and *waiting, the reply came* is the `Inbox` label the
reply already carries.

If no reply ever comes, `Waiting` persists, which is correct — you are still
waiting. Pair it with a snooze to be asked again on a date; the two compose and
neither needs to know about the other.

| Filter applied to | Shows |
|---|---|
| a topic | that topic's active mail, deferred hidden |
| `Process` | kept mail you can act on now |
| the Inbox | the queue, deferred hidden |

**`actionable` is what Custom mode makes sticky.** Navigating to any label
applies it, so a label opens on the mail you can act on now — untriaged and
kept together, deferred hidden. `DEFAULT_FILTER` becomes `actionable`; there is
no per-label-kind split and `Process` needs no exemption.

`inbox` remains a filter you can pick, isolating the untriaged part of a label,
and is remembered per label as any hand-picked filter already is.

The Inbox-mode indicator now represents `actionable`, so it is that value the
filter button suppresses its own active state for, not `inbox`.

### Two things keyed to the old default

| Today | Under `actionable` |
|---|---|
| The Inbox chip is hidden, because every row in an inbox-filtered label is in the Inbox | **Shown** — rows are a mix of untriaged and kept, so the chip is what tells them apart |
| `computeCounts` scans Inbox messages | retired — no scan at all. State-mailbox counts are `Mailbox.totalThreads`; anything filtered reads its own primed query's `length` (see *The primer*) |

Chip-hiding stays correct for `inbox`; it must simply not fire for
`actionable`. Nothing needs pulling into the store any more — the counts stop
being computed from loaded messages altogether.

### Constraints

| Constraint | Why |
|---|---|
| Wrap the `where` Fastmail built; never construct a `MessageList` | a list without a `sort` makes every message action throw, and a hand-made one registered under the wrong id never resolves — both already measured |
| A badge or header count reads a query's `length` only under `hasTotal` | anything else is a paging estimate; the primer makes `hasTotal` reachable, so an estimate on screen means the primer broke |
| Verbs from an `actionable` view must force the after-action navigation | archive's stay-or-advance flag asks whether the Inbox id appears in the current `where`, walking `AND` nodes only — inside `actionable`'s `OR` it is never found, so stock thinks nothing left the list and the focus sits on a vanished row. Same didAction-wrapping the old triage view already used, keyed to `actionable` now |

## Delivery rules

| Class | Action | Archive checkbox | Result |
|---|---|---|---|
| Known sender | add topic | unchecked | enters the queue pre-labelled |
| Never-see | add topic | **checked** | never enters the queue |

No catch-all rule, so rule ordering carries no meaning for this design.

## Sidebar

| Row | Default filter | Badge |
|---|---|---|
| Inbox | `actionable` | queue count — `Inbox.totalThreads`, canonical |
| `Process` | `actionable` | kept mail you can act on now — `Process.totalThreads`, canonical |
| topics | `actionable` | none by default; with `showFilteredCounts`, the exact actionable count from that topic's primed query |

Urgent is `Process` with Fastmail's built-in `pinned` filter — no saved search.

---

# Flows

Notation: labels a message carries, in order of arrival.

## 1 — Known sender, done (1 key)

```
Sarah Chen — "Q3 contract review"
  rule       add Work, Archive unchecked
  arrives    Inbox  Work
  press      e
  result     Work
  views      leaves the queue; never enters Process
```

## 2 — Known sender, keep (1 key)

```
Mum — "Sunday lunch?"
  rule       add Personal, Archive unchecked
  arrives    Inbox  Personal
  press      v
  result     Personal  Process
  views      leaves the queue; enters Process
```

## 3 — Unknown sender, done (1 key + picker)

```
Tom Reyes — "Partnership opportunity"
  arrives    Inbox
  press      e          -> no topic, picker opens
  type       wo         -> Work is the last standing, auto-saves
  result     Work
```

## 4 — Unknown sender, urgent (1 key + picker)

```
Bristol Lettings — "Boiler inspection Thursday"
  arrives    Inbox
  press      s          -> no topic, picker opens
  type       pe         -> Personal auto-saves
  result     Personal  Process  [pinned]
  views      enters Process, at the top
```

## 5 — Second label (qualifier)

```
Heroku Billing — "Invoice #4471"
  rule       add Work, Archive unchecked
  arrives    Inbox  Work
  press      Shift-V    -> picker opens
  type       ad         -> Admin auto-saves
  state      Inbox  Work  Admin        <- Admin is a qualifier,
                                          Inbox untouched
  press      v
  result     Work  Admin  Process
```

Order is free — `v` then `Shift-V` gives the same result.

## 6 — The accident the topic rule prevents

```
Tom Reyes — "Partnership opportunity"
  arrives    Inbox
  press      Shift-V
  type       ad         -> Admin auto-saves
  result     Inbox  Admin
  views      STAYS in the queue
```

Without the rule this would leave the queue carrying only a qualifier, with
nothing saying which stream it belongs to.

## 7 — Never-see sender (0 keys)

```
Tech Digest — "Weekly Digest #212"
  rule       add Newsletters, Archive CHECKED
  arrives    Newsletters
  views      never in the Inbox
```

## 8 — Snooze from the queue

```
Sarah Chen — "Q3 contract review"
  state      Inbox  Work
  snooze     until Monday
  during     Work  Snoozed              <- Inbox removed by Fastmail
  Monday     Inbox  Work
  views      back in the queue, still labelled; e or v is one key
```

## 9 — Snooze from Process

```
Mum — "Sunday lunch?"
  state      Personal  Process
  snooze     until Saturday
  during     Personal  Snoozed          <- Process stripped by us
  views      absent from Process while away
  Saturday   Inbox  Personal
  views      returns to the QUEUE, not to Process
  press      v                          -> back in Process, one key
```

## 10 — Finishing a kept message

```
Bristol Lettings — "Boiler inspection Thursday"
  state      Personal  Process  [pinned]
  press      e
  result     Personal
  views      leaves Process; pin dropped
```

## 11 — Pin, all three cases

```
a. untriaged, unpinned
   state     Inbox  Personal
   press     s
   result    Personal  Process  [pinned]

b. untriaged, pinned by a rule
   state     Inbox  Work  [pinned]
   press     s
   result    Work  Process  [pinned]     <- triaged, pin kept

c. already kept
   state     Personal  Process  [pinned]
   press     s
   result    Personal  Process           <- pin toggle only
```

## 12 — Drag, topic vs qualifier

```
Mum — "Sunday lunch?"
  state      Inbox  Personal
  drag onto  Admin                     <- qualifier
  result     Inbox  Personal  Admin
  views      STAYS in the queue

Tom Reyes — "Partnership opportunity"
  state      Inbox
  drag onto  Work                      <- topic
  result     Work  Process
  views      leaves the queue (same as v)
```

## 13 — Mobile, unknown sender, done

```
Tom Reyes — "Partnership opportunity"
  arrives    Inbox
  swipe      short right (Remove from Inbox -> patched to e)
             -> no topic, picker halts the swipe
  tap        Work
  result     Work
```

## 14 — Multi-select, mixed topics

```
12 selected in the Inbox: 8 carry Newsletters, 4 carry nothing
  press      e
             -> not every message has a topic, tristate opens
  shows      Newsletters   half-state
  click      Newsletters   -> all on
  close      -> all 12 archived carrying Newsletters

Same selection, Enter without setting anything
  result     all 12 archived; the 4 untopiced stay untopiced

Same selection, Escape
  result     VERB ABORTS; nothing archived, nothing filed
```

## 15 — Correcting a wrong auto-label

```
Sarah Chen — "Lunch on Saturday?"
  rule       add Work, Archive unchecked     <- personal mail from a work address
  arrives    Inbox  Work
  press      Shift-V    -> picker opens
  type       pe         -> Personal auto-saves
  state      Inbox  Work  Personal
  views      STAYS in the queue              <- Shift-V never triages
  press      l          -> untick Work
  state      Inbox  Personal
  press      e
  result     Personal
```

No verb removes a topic; correcting one needs `l`.

## 16 — Escape: archive without a topic

```
noreply@quotes-r-us — "Your quote is ready"
  arrives    Inbox
  press      e          -> no topic, picker opens
  press      Enter      -> nothing selected, commit anyway
  result     (no labels)

Same thing, one key
  arrives    Inbox
  press      Shift-E
  result     (no labels)

Cancelling instead
  arrives    Inbox
  press      e          -> picker opens
  press      Escape
  result     Inbox                      <- verb aborted, still queued

Same key on a labelled message
  state      Inbox  Work
  press      Shift-E
  result     Work                       <- no picker was due; identical to e
```

## 17 — Waiting, and the Actionable filter

```
Heroku Billing — "Invoice #4471"
  state      Work  Admin  Process
  press      Shift-V -> Waiting        <- chased them, nothing to do now
  state      Work  Admin  Process  Waiting

Process, default filter actionable
  shows      everything in Process EXCEPT this one

Process, filter set to All mail
  shows      this one too

Work, default filter actionable
  shows      untriaged Work + kept Work, deferred hidden
  chips      untriaged rows show Inbox; kept rows show Process
             <- the chip is what tells them apart

Work, filter set to inbox
  shows      untriaged Work only
  chips      Inbox chip hidden — every row is in the Inbox
```

## 18 — Waiting clears itself

```
Heroku Billing — "Invoice #4471"
  state      Work  Admin  Process  Waiting
  views      hidden from Process by actionable

  ... they reply ...

  thread     Work  Admin  Process  Waiting   (the original)
           + Inbox                           (the reply)
  views      SURFACES in the queue — the reply is in Inbox,
             and actionable judges the reply, not the original

  press      v
  result     Work  Admin  Process            <- Waiting cleared thread-wide
  views      back in Process, actionable
```

No reply ever comes:

```
  state      Work  Admin  Process  Waiting
  views      stays hidden — correct, you are still waiting
  to review  Process with All mail, or the Waiting label's own row
  to be asked again  snooze it as well; the two compose
```

---

# Mobile

Same userscript, same `controller().actions`, so the verbs come from the
existing patches rather than new swipe handling — verified: every swipe
dispatches `actions[method]([storeKey], …)`.

Which verb sits on which swipe is the `customSwipes` preference (Settings →
Actions; four slots, short/long × left/right), remapped per mailbox role by
Fastmail — so the table below is a settings choice plus the action patches,
not code. The account currently has short-right = toggle unread, short-left =
remove label, long-left = move; the intended layout:

| Swipe | Configure as | Becomes via the patches |
|---|---|---|
| short right | Remove label / Archive | `e` |
| long right | Edit labels | `Shift-V` |
| short left | Snooze | snooze (strips `Process` too) |
| long left | Move | `v` |

A swipe that halts for a picker matches Fastmail's own Move, Edit labels and
Snooze — all anchor a popover to the held-open row (`stillActingOnSK`) — so no
platform divergence.

The phone has no filter control; its filter rows live in the header's ⋯ menu,
under View…, built fresh on each open and shown through that menu's own
`showMenu`. `actionable` and `deferred` are appended there by wrapping the ⋯
button's volatile `menuView` (found by its `i-morecircle` icon) and its
menus' `showFilterMenu`/`showMenu` pair — the same two rows the desktop
filter menu gets, so ?filter=, per-label memory and the tick all carry over.
The sort menu rides the same `showMenu` and is told apart structurally: two
sections against the filter list's one. Verified live (mobile layout via
iPhone UA): rows appear after VIPs, tick follows the active filter, choosing
Deferred sets `mailboxFilter`, sort menu untouched. The header funnel remains
the mode toggle (per-label actionable ↔ all), not a menu.

# Code impact

| Unit | Change |
|---|---|
| `triageMailbox()` | returns the **Inbox** rather than a named label |
| `settings.triageLabel` | obsolete, removed |
| `settings.processLabel` | new, default `Process` |
| `settings.qualifierLabels` | unchanged |
| `didSelect` (`v`) | already does add-topic + remove-triage; add `Process` to the adds |
| `patchArchive` | remove `Inbox` explicitly, plus `Process` and pin |
| `patchDrop` | apply the topic rule |
| snooze | strip `Process` before Fastmail's own handling |
| filter menu | add `actionable` to the options |
| `mailboxTitleAndCount` | wrap: an `actionable` case, and counts under `showFilteredCounts` |
| list `where` | wrap Fastmail's own with the `actionable` conditions |
| `DEFAULT_FILTER` | `actionable`, for every label |
| `updateFilterButton` | suppression moves from `inbox` to `actionable` |
| Inbox chip hiding | fires for `inbox` only, never for `actionable` |
| `inboxMessages()` | retired — no local scan drives counts any more |
| `fetchInboxes()` | retired — nothing needs a mailbox preloaded |
| `computeCounts` | retired — state-mailbox counts read `Mailbox.totalThreads`; filtered counts read a primed query's `length` |
| primer | new — one raw `Email/query` with a registered query's own arguments plus `calculateTotal: true`, fired when the query is built; response routes back by recomputed id and flips it exact |
| after-action navigation | force stay-here off for verbs run from an `actionable` view — see Constraints |
| deferral | must **remove** `Process`, not sit alongside it — and always via `addremove`, never a bare `add`, so Fastmail's own thread expansion covers the whole thread |
| `forgetStaleTriageFilter` | retire with `triageLabel` |

# Settings

| Key | Default | Status |
|---|---|---|
| `qualifierLabels` | — | exists |
| `processLabel` | `Process` | **new** |
| `deferredLabels` | `Waiting, Snoozed` | **new** |
| `showFilteredCounts` | off | **new** |
| `triageLabel` | — | **removed** |

# Migration

The live account already has `Process`, `Triage`, `Waiting` and `Later`, and
measurement shows its `Process` mail currently carries `Inbox` **as well** —
it is running the older "kept stays in the Inbox" model. So the migration is
mostly about separating those two.

State measured 2026-08-15: Inbox 42 threads, `Process` 36, `Waiting` 1,
`Snoozed` 2, `Triage` 5, `Later` 2,395 (13 unread). **No `Inbox/*` nested
labels remain** — steps 2 and 3 are already done and stay only for the record.

1. Strip `Inbox` from every message carrying `Process`. Until this is done
   both lists show the same mail and the queue never empties.
2. ~~Flatten `Inbox/X` to top-level `X`; merge where a top-level `X` exists.~~
   Already done.
3. ~~Delete the emptied `Inbox/*` parents.~~ Already done.
4. Remove any catch-all `Triage` rule; delete the `Triage` label (5 threads
   still carry it).
5. Retire the `-in:./*` stand-in query — the Inbox is the queue.
6. Decide what `Later` is: a second deferral qualifier, or a topic. If the
   former it belongs in `deferredLabels`; if it is a `Someday` by another name
   it belongs on archived mail instead. At 2,395 threads it must **not** enter
   `Process`.
7. Remaining Inbox mail needs nothing: it is untriaged by definition.

# Supersedes

| Document | Fate |
|---|---|
| `2026-08-11-fastmail-archive-inbox-labels-design.md` | superseded entirely — no nested labels left to swap |
| `2026-08-11-fastmail-custom-mode-design.md`, Move to menu | `v` gains `Process` and the topic rule |
| same, stand-in query | replaced by the Inbox itself |

The undo-sequence mechanism from the archive spec survives and is reused.

# Measured

Probed against the live account in Safari on 2026-08-15. Every message mutation
was reverted and verified identical. A second pass the same day re-verified the
claims statically against the shipped modules (`mail.mod.js`, the shared
controller chunk and `main.mod.js`, build `3bf3351c1b`) and ran further
**read-only** probes — queries and raw `Email/query` calls only, no message
touched. Corrections from that pass are folded in below; the two that changed
conclusions are *How a deferral clears* (Fastmail expands threads itself) and
*The primer* (exact counts are one call away).

### The filter vocabulary

`mailboxFilter` → JMAP `where`, read off `mailboxMessageList` while on a label:

| Filter | `where` |
|---|---|
| `""` | `{inMailbox: X}` |
| `unread` | `AND[ NOT[allInThreadHaveKeyword $seen], {inMailbox: X} ]` |
| `pinned` | `{someInThreadHaveKeyword: "$flagged", inMailbox: X}` |
| `vips` | `{fromContactCardUid: "vips", inMailbox: X}` |
| `inbox` | `AND[ {inMailbox: Inbox}, {inMailbox: X} ]` |

`AND`, `NOT` and thread-scoped keyword tests are all Fastmail's own vocabulary,
so nothing about the `actionable` shape is exotic.

### Settled

Re-verified 2026-08-15 against the shipped build (static read of `mail.mod.js`
and the shared chunk it imports the controller from — currently named
`NewEvent.mod.js`, with the store, query machinery and low-level actions in
`main.mod.js`; the names are build artifacts and will drift).

| Question | Answer |
|---|---|
| Is `Shift-V` unbound? | **Yes**, everywhere. |
| Is `Shift-E` unbound? | **In the list, yes — in an open conversation, no.** `ThreadMessageListView` registers a keymap while it is in the document: `e` toggle-expand, `s` toggle-pin, `Shift-E` expand-all, `Alt-Shift-E` collapse-all, `Shift-R/A/L`, `f n p o " : ;`. Last registration wins, so a binding made at startup is shadowed whenever a conversation is on screen; verbs must go in through a `register` wrapper (as the e/y swap already does), not a one-time registration. Also taken at the top level: `Shift-B C I M U W`, `Shift-/`, `Alt-Shift-C M W`. |
| What is `s` today? | The list binds it via `ListKBFocusView.star`, the conversation via `toggleFlagged` — both are the pin. `s` as *urgent* keeps that muscle memory but must override both contexts. |
| Which action is pin? | `$flagged`, via `flag` / `unflag` calling `setKeyword`. The `pinned` filter reads `someInThreadHaveKeyword`, so pinning is thread-scoped in filtering though per-message in storage |
| What is archive, exactly? | In labels mode: `report(notspam)` + `setUnread(read)` + `move(msgs, null, Inbox, true)`, expanded to the whole thread. It removes the account's **Inbox label by role** — never the label being viewed — so archiving from a filtered topic view cannot strip the topic. It also **marks the message read**. Its stay-or-advance flag comes from whether the Inbox id appears in the current query's `where`, walking `AND` only — see *Constraints*. |
| Is snooze patchable? | Yes — `actions.snooze`. In labels mode it is `move(msgs, Snoozed, Inbox, true, SnoozeRecord)`: adds `Snoozed`, removes **only** `Inbox`, every other label survives. The record carries `until`, `moveToMailboxId`, and keywords `$new` (plus `$seen: false` when `snoozeMarksUnread` is on — it is on in this account, so woken mail returns unread). Snooze creates the `Snoozed` mailbox if the account lacks one. |
| Where does snooze return to? | A `moveToMailboxId` on the snooze record, passed `null` in labels mode — meaning the Inbox. **Returning to the queue is already the default; no API call needed** |
| Does the filter menu tolerate a new value? | `mailboxTitleAndCount` is a switch with a `default:` branch computing a count, so an unrecognised value degrades rather than throwing. It lists `mailboxFilter` in its dependencies, so it is wrappable |
| What number does the stock header show? | The default branch shows the mailbox's **unread** count (`mailbox.unread`), total for Drafts, nothing for Archive in labels mode — not `totalThreads`. And the count prefix is dropped entirely in standalone/app mode; the same string also feeds `document.title`. |
| Do label actions reach the whole thread? | **Storage is per-message, but the verbs expand.** See *How a deferral clears* |
| How does undo group? | Actions push `{method, args, messageSKs}` records into the undo manager's `pending`; `didAction` cuts one checkpoint from whatever is pending and shows one toast. Swallowing the intermediate `didAction` is the whole grouping mechanism — no `sequence` flag needed. (The archive spec's claim that `method`/`args`/`messageSKs` do not exist was wrong: the store undo manager uses inverse-change records, the mail one uses these.) |

### `actionable` — solved

**A hand-made query must be registered under the id `Message.getQueryId(params)`
computes.** That is the whole answer, and it is why every earlier attempt sat
inert at status `1`.

The source resolves a response back to its query by recomputing the id from the
request arguments:

```js
class …Source { getQuery(args) {
    const id = Type.getQueryId ? Type.getQueryId(args) : oL(Type, args);
    return this.store.getQuery(id);
} }
```

so a query filed under any other id can never be correlated with what comes
back. `Email.getQueryId` is `args => oL(Email, args) + (args.collapseThreads ? '+' : '-')`,
and it is reachable as **`FastMail.classes.Message.getQueryId`** — verified by
recomputing the live list's own id, `Email:-572983584+`, exactly.

Measured working:

```js
const params = {
    accountId, where, sort, collapseThreads,
    findAllInThread, findMatchingParts      // all four copied off the live query
};
const q = FastMail.store.getQuery(
    FastMail.classes.Message.getQueryId(params),
    FastMail.classes.MessageList, params);
if (!q.prefetch) q.prefetch = 5;
q.addObserverForRange({ start: 0, end: 20 }, observer, 'rangeDidChange');
```

Result: `status 2`, `length 41`, rows returning `Inbox+Triage`,
`Inbox+Personal+Process`, `Fiddle+Inbox+Process`. Message actions stayed healthy
throughout. **No view involvement and no crash.**

The range observer is required — a `WindowedQuery` fetches nothing without one.

### The builder, for reference

`f1(accountId, search, mailboxFilter, mailbox, collapseThreads)` is a
module-scoped function and cannot be patched, but its output is now fully known:

| Branch | Produces |
|---|---|
| `unread` | `NOT[{allInThreadHaveKeyword:"$seen"}]`, or `{notKeyword:"$seen"}` uncollapsed |
| `pinned` | `{someInThreadHaveKeyword:"$flagged"}`, or `{hasKeyword:"$flagged"}` |
| `vips` | `{fromContactCardUid:"vips"}`, or the to/cc/bcc trio in Sent |
| `inbox` | `{inMailbox: <inbox id>}` |
| **anything else** | `{}` |

It then AND-s in the current mailbox, and appends
`{inMailboxOtherThan:[junk, trash, memos]}` when the query is unscoped. **A
hand-built `where` must add that exclusion itself** — Fastmail will not, and its
absence is the likeliest cause of a count that disagrees with a stock view.

Because the `default:` branch yields `{}`, registering `actionable` as a
`mailboxFilter` value is inert rather than harmful: the stock path degrades to
an unfiltered mailbox view while our wrapper supplies the real query.

**Measured.** Setting `mailboxFilter` to `'actionable'` with no code in place:

| | |
|---|---|
| reads back | `"actionable"` — arbitrary strings are held |
| `where` | `{inMailbox: <label>}` |
| query id | identical to plain `""` |
| header | the bare mailbox name |

So the existing plumbing carries the value for free — URL `?filter=`, history,
`goSource`'s third argument, and `rememberedFilters` keyed by filter string —
and a URL carrying it opens safely without the script. Our substituted query
lives under a different id, so it cannot collide with the stock one.

### Wiring it into the view — works

Measured end to end on `Personal`: the view bound to our query, the DOM rendered
**3 rows** (the three `Inbox+Personal+Process` messages), the `Waiting` one and
both snoozed ones absent, and message actions stayed healthy.

**Hand over only a query that has already resolved.** This is what makes it
safe, and the absence of it is almost certainly what crashed the earlier
attempt:

```js
const wrapped = function () {
    const stock = orig.call(this);
    if (this.get('mailboxFilter') !== 'actionable') return stock;
    const q = buildActionable(this, stock);      // params copied off `stock`
    if (!q || q.get('length') === null) return stock;   // not ready — stay on stock
    return q;
};
```

The query is driven by a range observer attached when it is built; when that
observer sees `length` become non-null it calls
`controller.computedPropertyDidChange('mailboxMessageList')`, and the next read
hands over.

> **The "have we handed over yet" flag must be per query, not per wrapper.** A
> single shared flag works for the first label and then silently fails: on the
> second label it is already set, that query's observer never fires the
> recompute, and the view sits on stock until an unrelated dependency changes.
> Hang the flag off the query, or drop it and let the recompute be idempotent.

Measured sequence on first activation:

| Read | Result |
|---|---|
| 1st | falls back to stock — 8 rows, ours fetching at status 1 |
| after resolve | observer fires the recompute |
| 2nd | view is on ours — 3 rows, status 2 |

Switching to All mail and back hands over **immediately** with no fallback read,
since the query is cached and already resolved. Only the very first activation
shows stock briefly.

All five `MessageList`s in the store retained a `sort` throughout, so the
"every message action throws" failure never came near.

Restoring the original property descriptor and resetting `mailboxFilter` returns
everything to stock cleanly.

**Sort is correct**, borrowed wholesale from the stock query. Measured on
`Personal`: the three actionable rows are stock rows 2, 3 and 7 in the same
order, newest first. The sort's leading
`{property:'snoozedUntil', mailboxId:<current>}` key is inert here, since
snoozed mail is excluded before it can matter.

**Cache the mailbox lookups.** `buildActionable` runs inside a computed
property, and a naive `store.getAll(Mailbox).filter(…)` per label name means
four full scans per read. `inboxLabelSet` already caches by signature for
exactly this reason; do the same.

**No `inMailboxOtherThan` is needed.** `f1` appends the junk/trash/memos
exclusion only when the query is unscoped (`fG = !s`). Every query built here is
scoped to a mailbox, so Fastmail would not add it either, and omitting it
matches stock.

### Deferral is a move, not an overlay

**A canonical count exists only for a whole mailbox.** `Mailbox.totalThreads` is
server-maintained, arrives by push, and is even updated optimistically before
the server confirms (`preemptiveCounts` in the Email source assigns
`totalThreads`, `totalEmails`, `unreadThreads`, `unreadEmails` on every
`Mailbox/get`). Always right, no polling, no fetch.

Any *intersection* — `Process` minus `Waiting`, `Personal` and actionable — has
no such record, and no amount of cleverness gives it one.

So the design stops needing intersections. **Deferring a message removes
`Process`**, exactly as snoozing removes `Inbox`:

| State | Mailbox | Count |
|---|---|---|
| untriaged | `Inbox` | `Inbox.totalThreads` |
| actionable | `Process` | `Process.totalThreads` |
| waiting | `Waiting` | `Waiting.totalThreads` |
| deferred to a date | `Snoozed` | Fastmail's own |
| done | none | — |

A message is in exactly one state mailbox, so every list count is canonical and
free. `Process` *becomes* the actionable list rather than being filtered into
one.

This is coherent with what `Process` already is — a disposition, not durable
metadata. Deferring is a change of disposition, so leaving `Process` is the
honest representation, and the triage verbs already restore it: `v` adds
`Process` back when the deferral clears.

What still needs a query is the **per-topic** badge — `Personal` and actionable
is an intersection like any other. Those are the numbers to think hard about,
and the only ones.

### Fastmail never counts a filtered set

Measured, and it settles how much of this we can borrow: **there is no existing
mechanism to copy.**

| filter | displayed |
|---|---|
| `""` | `Personal`, plus a number |
| `unread` | `Unread • Personal` |
| `pinned` | `Pinned • Personal` |
| `inbox` | `In Inbox • Personal` |

`mailboxTitleAndCount` emits a *word* for every filtered view and a *number*
only for the unfiltered one — and that number is read straight off the `Mailbox`
record (`totalThreads`, `unreadEmails`), which the server maintains. Nothing in
the app ever counts the result of a query.

So the badge invariant this design inherits — *a badge equals the row count you
get by clicking the label* — is asking for something Fastmail's **client**
declines to ask for. The server, it turns out, never declines to answer — see
*The primer* below, which is what turned this section from a wall into a
doorway.

**The raw route, measured:** the JMAP connection is reachable at
`FastMail.store.source.sources[n]` (the one with `id: 'mail'`, carrying the
`Email`, `Thread` and `Mailbox` types) and exposes `callMethod`. A bare
`Email/query` with `calculateTotal: true, limit: 0` returns an exact `total`
for **every filter shape tried**, including `AND[OR, NOT]` — measured `41`
against the unscoped actionable set, `3` against the `Personal` one. And the
earlier belief that a raw call's result is dropped was exactly backwards:
responses route back by an id **recomputed from the request arguments**, so a
raw call whose arguments match a registered query is *credited to that query*.
That is not a hazard, it is the mechanism.

### Counts: only what is canonical

Every count this design needs for a **list** is now a `Mailbox.totalThreads`,
because deferral is a move:

| Row | Count | Cost |
|---|---|---|
| Inbox | `Inbox.totalThreads` | free, pushed |
| `Process` | `Process.totalThreads` | free, pushed |
| `Waiting` | `Waiting.totalThreads` | free, pushed |

No query, no scan, no preload, no polling, and correct the instant a local
action lands, because the Email source updates these optimistically.

**Per-topic badges are the only thing left, and they cannot be canonical** —
`Personal` and actionable is an intersection, and no record holds it. But
*canonical* and *exact* turn out not to be the same thing. Of the routes to an
exact intersection count, two are still bad and two turned out to be wrong
entries in this table:

| Route | Verdict |
|---|---|
| `LocalQuery` over the store | still bad — short unless the mailboxes are preloaded, and it re-implements the predicate a second time |
| page a query to `allIdsAreLoaded` | still bad — races the view's own window scheduling, leans on `_windows` |
| `Email/query` with `calculateTotal` | **works.** The top-level-`inMailbox` condition is the *client's* rule for when it bothers to ask; the server answers for any filter, measured — even at `limit: 0` |
| raw JMAP call | **works, and better than expected:** a response routes by an id recomputed from the request arguments, so a raw call with a registered query's own arguments lands *in that query* |

So a topic badge **can** be exact — one registered query per topic, primed once
(next section), refreshed by Fastmail's own machinery afterwards. Whether a
topic *should* carry a badge is now taste rather than constraint; the default
stays no-badge (the work is visible in the Inbox and `Process` counts), with
exact badges available behind `showFilteredCounts` at the cost of one primed
query per topic.

### The primer — an estimate becomes a count

Measured end to end. A hand-registered query resolves with an estimated
`length` and `hasTotal: false`, because the stock client sends
`calculateTotal: true` only for top-level `inMailbox` filters (or on refresh of
a query that already has a total). The server has no such reluctance. So:

1. register the query under `Message.getQueryId(params)` as usual, observer
   attached;
2. fire one raw call with **identical** `accountId / filter / sort /
   collapseThreads / findAllInThread / findMatchingParts`, plus
   `position: 0, limit: windowSize, calculateTotal: true`.

The adapter's `didQuery` recomputes the id from those arguments, finds our
query, and applies the response: measured `length 31 → 41`, `hasTotal:
false → true`, status healthy. From then on it is self-maintaining:

- `hasTotal` being true makes every later refresh send `calculateTotal` again
  (`calculateTotal = hasTotal ? !canGetDeltaUpdates && refresh : …`, and
  `canGetDeltaUpdates` is `false` for these filters — the server answers
  `canCalculateChanges: false` — so the refresh arm is taken);
- every local move runs the store's query-update pass, which finds no
  top-level `inMailbox` to update ours incrementally and calls
  `setObsolete()` on it instead, and an observed obsolete query refetches.

No polling, no window paging, no `_windows`, no second predicate. The one
matching rule: the raw call's `filter` and `sort` must serialize byte-identical
to the query's — pass the same objects.

### Counts in the header — `settings.showFilteredCounts`

Off by default. When on, a filtered view shows its count where an unfiltered one
already does, restoring the number Fastmail drops for every filter.

| | Stock | With the setting |
|---|---|---|
| unfiltered | `8 • Personal` | unchanged |
| `inbox` | `In Inbox • Personal` | `3 • In Inbox • Personal` |
| `unread` | `Unread • Personal` | `5 • Unread • Personal` |
| `actionable` | `Personal` | `3 • Personal • Actionable` |

The number leads, because that is the slot it already occupies unfiltered —
leftmost is the count whenever there is one. The filter word trails the
mailbox name (v2.16): the mailbox is the subject, the filter qualifies it.

As of v2.21 (default on) every sidebar badge shows the server-exact total
of *that label's own filter* — the number the click will show — with the
slice's unread count in bold parens after it: `12 (3)`. Unread comes from
a second primed query per label (`slice AND notKeyword $seen`, collapsed);
unfiltered rows read `totalThreads`/`unreadThreads` off the Mailbox
record. The shell apps' icon badge is configurable via
`appBadgeLabel`/`appBadgeFilter` (default Inbox/actionable), pushed
through the harness's `window.native.setBadge` and pulled back through
`window.native.badgeResolver` on foreground.

`mailboxTitleAndCount` is an own property on the controller and wraps exactly as
`mailboxMessageList` does. Its declared dependencies are

```
["search","mailboxTitle","mailbox","mailboxUnread","mailboxTotalMessages","mailboxFilter"]
```

none of which change when our count arrives, so the wrapper must call
`computedPropertyDidChange('mailboxTitleAndCount')` once the fetch resolves or
the header keeps a stale value.

**Re-decided, and kept.** It was specced as "exact, via all-ids", which was
withdrawn — and is now re-founded on the primer instead:

| Where | Count |
|---|---|
| `Process`, `Waiting`, the Inbox | canonical `totalThreads`, free |
| a topic under any filter | exact — the view's own list, primed; the count *is* `mailboxMessageList.length` once `hasTotal` is true |

The header needs no query of its own: the list the view is already showing is
the thing being counted, so priming that one query serves the header, and the
sidebar badge if one is wanted, from a single source. Show nothing until
`hasTotal` reads true — never an estimate.

Two stock behaviours to respect while wrapping: the unfiltered number Fastmail
shows is the **unread** count, not a total — leave that branch untouched — and
in standalone/app mode the stock string carries no number at all (the same
string becomes `document.title`), so the setting should not add one there
either.

`actionable` needs a case in the switch regardless of this setting, or its
header reads as a bare mailbox name with no sign a filter is on.

### When a query's `length` is exact

Measured side by side, before priming:

| | actionable query | live query (top-level `inMailbox`) |
|---|---|---|
| `length` | 31 | 8 |
| `hasTotal` | false | true |
| `allIdsAreLoaded` | false | true |
| `_windows` | `[4]` — 1 of 2 | complete |
| ids loaded | 30 | 8 |

`windowSize` is 30. One window was loaded and `length` read 31 — exactly
`position + ids.length + 1`, the estimate the bundle applies when a window comes
back full. It was never a count. The 41-vs-31 reading was two such estimates —
the "superset smaller than its subset" was never a contradiction.

> **`length` is exact when `hasTotal || allIdsAreLoaded`, and a lower bound
> otherwise.** Read it under any other condition and it is wrong.

`hasTotal` was believed unreachable for these filters. **It is not — the
primer reaches it in one call**, measured `31 → 41` with `hasTotal` true. The
estimate code is real:

```js
if (undefined === total) {            // server returned none
    total = position + ids.length;    // what we have so far
    (ids.length >= limit) && (hasTotal = false, total += 1);   // window was full: assume more
}
```

but "server returned none" happens because the **client** only asks for a
total when the filter carries a top-level `inMailbox` (or on refresh once a
total is held):

```js
const calculateTotal = !!(filter && filter.inMailbox) ||
    (hasTotal ? !canGetDeltaUpdates && refresh : …);
```

An `actionable` filter is always `AND[…]`, so the first arm never fires — but
the **server computes a total for any filter when asked**, measured, and the
primer is how to ask. After it, the `hasTotal` refresh arm keeps the total
current forever.

So the rules, in order of preference:

- a badge reads `length` **only after asserting `hasTotal`** — the primer makes
  that state reachable for every query this design has, so an estimate showing
  up means the primer broke, and showing nothing is the right degradation;
- `getStoreKeysForAllObjects` remains correct as a fallback and for tests —
  it fetches every id, so it is the expensive way to the same number;
- **do not page windows by hand.** That is `fetchInboxes`'s idiom under a new
  name: it races the `WindowedQuery`'s own fetch scheduling and depends on
  `_windows`, an internal.

One retraction from the earlier draft of this section: the delta path
(`Email/queryChanges`) is **not** how these queries refresh — the server
answers `canCalculateChanges: false` for them, so `canGetDeltaUpdates` reads
false after the first response and refreshes are plain refetches of the
observed windows. The conclusion survives anyway, because the refetches carry
`calculateTotal` once a total is held: refresh is driven by store changes and
push, never a timer, and a query that has become exact stays exact for free.
(Consequence: `doAction` clears the selection after a verb when the bound
list cannot delta-update, so multi-select under `actionable` drops the
selection after each verb — acceptable, but real.)

### Historic note

Where `mailboxFilter` becomes a `where` is `mailboxMessageList`, a computed
property on the controller, delegating to a **module-scoped helper not reachable
from the page** — as is the query-id builder it calls, though its result is
reproducible via `Message.getQueryId`.

**Creating such a query is harmless; only handing it to the view was ever
dangerous.** Queries were built repeatedly and left in place with
`actions.getSelectedStoreKeys()` staying healthy throughout.

Superseded dead ends, all of which sat at status `1` because the id was wrong —
not because any of these were missing:

| Attempt | Result |
|---|---|
| full parameter set copied off the live query | inert |
| `fetch()`, `fetchWindow(0,10)`, `getObjectAt(0)` | inert |
| explicit `addObserverForRange` alone | inert |
| id merely *prefixed* `Email:` rather than computed | inert |

`accountId` was never the problem; it resolves fine via
`query.get('accountId')`.

### Verified against real deferred mail

`probe-actionable.js` in the repo root checks the identity
`actionable + excluded == active` for a topic, which can only hold if the `NOT`
clause is being applied. Run against `Personal` with one `Waiting` message and
two snoozed ones:

| | count |
|---|---|
| `Personal`, all | 8 |
| active — `Personal ∩ (Inbox ∪ Process)` | 4 |
| **actionable** | **3** |
| excluded by the `NOT` | 1 |
| `Personal ∩ Waiting` | 1 |
| `Personal ∩ Snoozed` | 2 |

`3 + 1 = 4`. Two claims confirmed at once:

- The `Waiting` message was in `active`, so it had a real chance to appear and
  the `NOT` removed it. A dropped clause would have read 4.
- The two snoozed messages never reached `active`, which is why `excluded` is 1
  rather than 3 — snooze stripped their `Inbox` label, so they fail
  `(Inbox OR Process)` before the `NOT` is consulted. **`Snoozed` in
  `deferredLabels` is redundant insurance, measured rather than reasoned.**

The identity holds because the probe counts rows it has actually fetched. An
earlier unscoped comparison read 41 against a looser query's 31 — apparently a
superset smaller than its subset — which turned out not to be a filter problem
at all: neither number was a total. See *`length` is not a count* below.

### Formerly unverified — all three settled (static read, 2026-08-15)

| Question | Answer |
|---|---|
| Does `e` remove `Inbox` explicitly? | **Yes.** Archive in labels mode is `move(msgs, null, Inbox, true)` against the account's Inbox **by role** — the active label never enters into it, so a filtered topic view keeps its topic. It also reports not-spam and marks read. |
| Does the mobile web app share `controller().actions`? | **Yes.** The mobile build has the same controller/actions architecture, and every swipe dispatches `actions[method]([storeKey], …)` — `archive`, `removeCurrent`, `deleteToTrash`, `snooze`, `move`, or an `editLabels` popover. Patching the actions covers the swipes; no swipe handler of our own. Which verb sits on which swipe is the user's `customSwipes` preference (four slots: short/long × left/right), remapped per current-mailbox role — e.g. a configured *Remove label* becomes `archive` in the Inbox and `moveToInbox` in Archive. The mobile table in this spec is therefore a Settings → Actions configuration plus the action patches, not code. |
| Does a swipe-invoked picker halt cleanly mid-gesture? | **Yes — it is Fastmail's own pattern.** `editLabels` and preset-less snooze both halt the swipe with a popover anchored to the row (`stillActingOnSK` keeps the row held open). A verb's topic picker rides the same mechanism. |

# Verification cases

| Case | Expected |
|---|---|
| `e` on auto-labelled | archived, topic kept |
| `e` on unlabelled | picker, then archived with the chosen topic |
| `e` from an inbox-filtered topic view | `Inbox` removed, topic kept |
| `e` on a pinned kept message | archived, `Process` and pin both gone |
| `v` on auto-labelled | `Process` added, leaves the Inbox, no picker |
| `v` on unlabelled | picker, then `Process` |
| `s`, three cases | per the table above |
| `Shift-V` picking a topic | label added, stays in the Inbox |
| `Shift-V` picking a qualifier | label added, stays in the Inbox |
| `Shift-E` on unlabelled | archived bare, no picker |
| `Shift-E` on labelled | identical to `e` |
| `e` then `Enter` with nothing set | same result as `Shift-E` |
| `e` then `Escape` | verb aborts, message still queued |
| tristate, `Enter` with nothing set | selection proceeds, untopiced stay untopiced |
| tristate, `Escape` | verb aborts, nothing changes |
| drag onto a topic | same as `v` |
| drag onto a qualifier | label only, stays in the Inbox |
| snooze from the Inbox | absent while away, returns to the Inbox |
| snooze from `Process` | `Process` stripped, absent while away, returns to the Inbox |
| multi-select, all topiced | runs directly, no picker |
| multi-select, some untopiced | tristate with half-state |
| `z` after any verb | whole verb reverted in one press |
| Inbox badge | equals its row count under `actionable` |
| `Process` badge | equals its row count under `actionable` |
| `Process` + pinned filter | urgent only |
| `Process`, default filter | deferred mail hidden |
| `Process`, All mail | deferred mail shown |
| navigate to any label, mode on | opens on `actionable` |
| navigate to a **second** label | hands over too — not just the first |
| badge with deferred mail present | still equals the row count |
| badge before its query resolves | not painted from a `null` length |
| badge on a label with >50 actionable messages | correct — not the paged lower bound |
| `hasTotal` after the primer | `true`, and `length` equals the raw `calculateTotal` answer |
| badge before `hasTotal` is true | absent, never an estimate |
| primer response | credited to the registered query — no orphan query appears in the store |
| count survives a verb | a move marks the query obsolete; the refetch carries `calculateTotal` and the number stays exact |
| `showFilteredCounts` off | headers exactly as Fastmail ships them |
| `showFilteredCounts` on, filtered view | count leads, e.g. `3 • In Inbox • Personal` |
| `showFilteredCounts` on, unfiltered view | unchanged — stock already counts |
| header before its count resolves | stock string, no flicker to a wrong number |
| header count vs sidebar badge | identical; one cache serves both |
| `actionable` header, setting off | still names the filter, not a bare mailbox name |
| actionable rows | same order as the stock view, newest first |
| topic + `actionable` | untriaged and kept for that topic, deferred hidden |
| topic + `inbox` | untriaged only |
| Inbox chip under `actionable` | shown; distinguishes untriaged from kept |
| Inbox chip under `inbox` | hidden, as today |
| topic badge (setting on) | equals the `actionable` row count, spanning Inbox and `Process` |
| a `Process` message never fetched | still counted — the count is the server's total, not a scan of loaded messages |
| mark a `Process` message `Waiting` | leaves the list at once, badge drops |
| `deferredLabels` emptied | `actionable` degrades to active-only, nothing breaks |
| a message both `Waiting` and pinned | hidden by `actionable`; pin does not override |
| reply arrives on a `Waiting` thread | thread surfaces in the queue |
| `v` on that thread | `Waiting` cleared thread-wide, `Process` re-applied |
| `e` on a `Waiting` thread | `Waiting` and `Process` both gone |
| `Shift-V` applying `Waiting` | routed as `addremove([Waiting], [Process])`, so Fastmail's own expansion covers every not-in-trash message of the thread |
| `Waiting` on only one message of a multi-message thread | thread still visible — the others match |
| `Waiting` cleared by a verb | removed from every message of the thread |
| `Snoozed` | never removed by a verb — system-managed |
| message moved into the Inbox by hand | shows in the Inbox and `Process` both; next verb resolves it |
| every mobile swipe | dispatches through the patched action, so it matches its desktop verb exactly |
| `e` on a message | archived **and read** — stock archive marks read; accepted, not fought |
| verb from an `actionable` view | focus advances (stay-here forced off); no focus on a vanished row |
| `Shift-E` with a conversation open | still runs the escape verb — the view's `expandAll` registration does not shadow it |
| `s` with a conversation open | still the urgent verb, not stock `toggleFlagged` |
| multi-select verb under `actionable` | completes; the selection clearing afterwards is stock (`canGetDeltaUpdates` false) and accepted |

# Out of scope

- Roll-up badge counts.
- Automatic expiry or review of `Process`; the badge is the only pressure.
- Any change to `fastmail.js`, `fastmail-tweaks.js` or the backup file.
