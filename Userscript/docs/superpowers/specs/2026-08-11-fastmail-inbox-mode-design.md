# Fastmail: Inbox mode

Date: 2026-08-11
Status: implemented in `fastmail-inbox-mode.user.js`

## Problem

The Inbox is used only for triage; the work itself lives under labels. Opening a
label from the sidebar shows everything ever filed there, not the part that is
still awaiting triage. The sidebar badge compounds this: it counts unread, which
says nothing about how much of that label is still sitting in the Inbox.

Inbox mode makes labels behave as per-label inboxes. While it is on, opening a
label applies Fastmail's built-in `inbox` filter, and each label's badge counts
the conversations that carry the label and are still in the Inbox.

The mode is a toggle rather than permanent behaviour, because seeing a label's
full contents remains useful.

## Decisions

| Question | Decision |
|---|---|
| Toggle | `Shift-I`, persisted in `localStorage` so it survives a reload |
| Scope | User labels only — a mailbox whose `role` is empty |
| What the badge counts | Conversations carrying the label *and* in the Inbox |
| Nested labels | No roll-up; a parent counts only its own |
| Manual filter change | Remembered for that label and re-applied whenever you return |
| Default state | On, until switched off with the button or `Shift-I` |
| Counting source | One local scan of Inbox messages, tallied per label |
| Multiple accounts | Every account's Inbox is counted; labels are per-account anyway |
| Completeness | Each Inbox is pulled into the store once so the scan is not short |
| Dragging onto a label | Additive by default; Option restores the stock move |
| Toggling while on a label | Applies to the label in front of you at once |
| Packaging | New standalone userscript |
| Mode indicator | A toggle button in the thread-list toolbar, left of the filter |
| Filter button state | Not active for the inbox filter; active for any other |
| Inbox chip on rows | Hidden while a label is filtered to the Inbox |
| Label colours | Rows striped with the colour of a sidebar label they carry, while the mode is on |
| Options | Extension settings page, suboptions nested under what they qualify |
| Quick labelling | `v` narrowed to the sidebar, auto-saving, and adding rather than moving; `Option-V` and `m` as they come |
| Delivery | A small companion extension, because CSP blocks userscript injection |
| Source shortcuts | `Cmd-1` … `Cmd-9` for the sources above the Labels heading |
| Label cycling | `Cmd-§` next, `Cmd-Shift-§` previous |
| The Inbox itself | The first query nested under it stands in, everywhere the Inbox is reached |

## Internals

Established by probing the live app (Safari, `app.fastmail.com`, 2026-08-11).
The probes ran against **stock Fastmail** — neither `fastmail.js` nor
`fastmail-tweaks.js` was loaded in that session. This matters, because several
assumptions in those scripts no longer hold.

### The filter

`mailboxFilter` on the mail controller accepts `""`, `"unread"`, `"pinned"`,
`"vips"` and `"inbox"` — enumerated in the controller's `mailboxTitleAndCount`
switch, which also supplies the header text for each. It is encoded into the URL
as `?filter=…`.

`goSource(mailbox, search, filter)` is the only writer worth patching:

```
goSource(e,t,i){ … .set("mailbox",e).set("mailboxFilter",!t&&i||"").set("search",t) … }
```

With a search present the filter is forced to `""`; with none, the third
argument wins. Called with just a mailbox — the sidebar case — the filter is
cleared.

Sidebar clicks reach it through:

```
MailboxSourceView.click  →  this.get('controller').select(content)
SourcesController.select →  mailController.goSource(mailbox)
```

so no search and no filter are ever passed from a sidebar click. URL-driven
navigation (back button, pasted link) does **not** go through `goSource`; it
decodes `?filter=` from the URL, which already carries the right value.

### Views

`FastMail.activeViews` is **empty** on the production build (`FastMail.isDebug`
is `false`). The `getViewsByClass` helper in both existing scripts iterates that
object and therefore returns nothing, and their boot guard —
`!FastMail.activeViews.v78 && !FastMail.activeViews.v212` — never passes, so
neither script can initialize at all on today's Fastmail.

The supported replacement is `FastMail.getViewFromNode(node)`. Given a
`.v-MailboxSource` element it returns the real `MailboxSourceView`, from which
`get('content')` yields the `Mailbox`.

### The badge

`MailboxSourceView.prototype.draw` builds the badge as

```js
this._badge = K('span', { className: oi(i), text: i })   // i = content.get('badgeCount')
```

and repaints it with

```js
redrawBadgeCount(){ let e=this._badge, t=this.get("content").get("badgeCount");
                    e.className=oi(t); e.textContent=t }
```

`oi(0)` yields `u-hidden`, which is why a zero badge simply disappears.

`Mailbox.prototype.badgeCount` is a **plain number** (`0`), not a computed
property. `badgeProperty` *is* computed and settable — `function(e){ if(e) return e; … }`,
dependent on `role`, `isShared`, `isSeenShared` — returning `"unread"` for a
plain label, `null` for archive/sent/trash/snoozed and `"totalEmails"` for
drafts/scheduled.

Three things were tested directly:

- Setting `badgeProperty` and calling `setBadgeCount()` left `badgeCount` at `0`.
  The 2023 script's approach — override `badgeProperty`, then fire
  `computedPropertyDidChange` — does not drive the badge on this build.
- `mailbox.set('badgeCount', 42)` alone updates the value but repaints nothing;
  the view does not observe it.
- `mailbox.set('badgeCount', 42)` **followed by** `view.redrawBadgeCount()`
  repaints: the span flips from `u-hidden:0` to `v-MailboxSource-badge:42`.
  Setting it back to `0` and redrawing restores `u-hidden`.

Throughout, the mailbox record's store status stayed `2` (`READY`). `badgeCount`
is not a JMAP attribute, so writing it neither dirties the record nor reaches
the server. By contrast `mailbox.set('unread', 5)` is silently ignored — those
counts are server-owned, which rules out the `set('totalThreads', …)` approach
`fastmail-tweaks.js` uses.

### Knowing when to recount

Watching the Inbox local query's membership is **not** sufficient. Adding or
removing a label leaves the message in the Inbox, so membership is unchanged and
the badge would keep a stale number — the first thing noticed in real use.

The store broadcasts changes per record type:

```js
_recordDidChange(sk){ this._changedTypes.add(this._skToType.get(sk));
                      queue("middle", this._fireTypeChanges, this) }
_fireTypeChanges(){ for (let type of changed) this.fire(u(type)) }
```

`LocalQuery.monitorForChanges` subscribes with `store.on(Type, this, 'setObsolete')`,
so `store.on(FastMail.classes.Message, target, method)` is the supported hook and
catches every message change — labels, archiving, undo and server pushes alike.
Note the asymmetry: `on()` takes the raw type while `fire()` is called with a
transformed key, so a hand-rolled `store.fire(Message)` does **not** reach these
handlers and cannot be used to test the wiring.

Because `_fireTypeChanges` is queued, bursts already coalesce; the script adds a
short timer on top so a bulk action or the initial preload causes one recount.

### Acting on messages

`actions.add`, `remove` and `addremove` all funnel into `doAction`, whose first
argument **must be an array** of store keys:

```js
(e, …) => { … e && e instanceof Array || (e = getSelectedStoreKeys()) … }
```

Passing a bare store key silently falls back to the current selection and
usually does nothing. The dead `initActions` code in `fastmail.js` passes a
scalar, which is a second reason it could never have worked.

These actions are also view-sensitive: re-adding a label to a message failed
while a label the message no longer carried was on screen, and succeeded once
the Inbox was in view.

### Navigation shortcuts

Shortcut names are derived from the event by Overture and confirmed by feeding
synthetic events through `kbShortcuts.trigger`: `Meta-1`, `Meta-§`,
`Meta-Shift-§`. On an ISO keyboard Shift-§ can arrive as `±` depending on
layout, so `Meta-Shift-±` is bound to the same action as insurance.

Both jump and cycle go through `sources.select()`, the same call a sidebar click
makes. It handles saved searches as well as mailboxes and routes through
`goSource`, so the sticky filter is applied on arrival — verified: cycling onto
a label lands with `filter=inbox`.

`Cmd-1` … `Cmd-9` index the first source group, which is Fastmail's own split of
the sidebar at the first mailbox without a role — exactly the sources drawn
above the Labels heading. Where that group is empty, which happens when a label
is ordered ahead of a system folder, they fall back to the account's system
mailboxes in sidebar order rather than doing nothing.

Cycling walks the drawn `.v-MailboxSource` rows filtered to user labels, so the
order matches the sidebar and children inside a collapsed parent are skipped.
Arriving from a non-label, it enters at the near end of the list.

**`Cmd-1` … `Cmd-9` do not work in an ordinary Safari window.** Tested with a
real keypress: Safari switches tabs and the page never sees the event. They work
in the Fastmail web apps, which have no tabs. `Cmd-§` was likewise tested with a
real keypress and does reach the page in both.

### The query that stands in for the Inbox

A saved search nested under the Inbox is the untriaged view. Fastmail scopes such
a search to its parent — `-in:./*` runs as `in:Inbox -in:./*`, confirmed by
reading `search` off the controller while on it — so it is already an Inbox by
another name, and with the mode on it is the list worth being in. The first one
takes the Inbox's place.

Which one is read from the sidebar, not the store: the first `SavedSearch` in the
sources above Labels whose `parent` is a mailbox with `role: 'inbox'`. Reading it
that way means "first" means what it looks like it means, and a query nested
under some other mailbox is not mistaken for one under the Inbox. Account safety
comes free from the same test — the redirect fires only for the very mailbox the
query hangs off, so another account's Inbox is left alone.

**One choke point.** Measured: a click on the sidebar's Inbox calls
`sources.select(Inbox)`. So do the number shortcuts, and so do Fastmail's own
moves. Wrapping that one method covers every way of reaching the Inbox, without
touching the sidebar views. Verified by selecting Snoozed and then the Inbox: the
selection lands on the query, at `/mail/Inbox/search:-in%3A.%2F*/`.

A URL typed or opened directly does not go through `select()`, so `/mail/Inbox/`
still reaches the plain Inbox. That is the escape hatch, along with turning the
mode off.

The Inbox row's `href` is rewritten as well, so hovering and opening in a new tab
say where it now goes. That is cosmetic only — clicks are already covered — so if
a redraw puts the old address back before the next refresh, nothing breaks.

**The selected look is carried by a class, not by `:has()`.** Fastmail draws a
nested query only while the Inbox is expanded, and collapsed is an ordinary way
to keep it — measured on an account where the row was not in the DOM at all.
Keying the Inbox row's highlight off a rule like
`:has(.app-source[href="…"].is-selected)` would therefore leave nothing in the
sidebar looking selected. Instead the body carries a class whenever
`sources.selected` is the stand-in, and the rule is Fastmail's own
`.app-source.is-selected` declaration, variables and all, so it follows the
theme. Measured: the Inbox row then paints `rgba(36, 57, 89, 0.15)` at weight
700, the same as a genuinely selected row.

**The Inbox's row is hidden and the query is promoted into its place** — rather
than merging the two into one row. The obvious-looking alternative, renaming the
Inbox row to the query, was built first and was wrong: the row is still the Inbox
underneath, so its dots menu (`ButtonView` → `MailboxSourceView.editMailbox`)
went on editing the Inbox while the label said otherwise, and there was no way
left to edit the search. Keeping each row the record it actually is means the
query's row carries `SearchSourceView.editSavedSearch` for free.

Selecting on the query's own `url` means several queries under the Inbox stay
separate — only the one standing in is promoted.

Three details. The sidebar places rows absolutely, so hiding one leaves a hole:
everything after the Inbox, the query included, is pulled up by exactly one row's
height, measured from a drawn row. A nested row is indented by depth — 20px
against a top-level 12px — so the promoted row's padding is reset to whatever a
top-level row is using, read from the DOM rather than assumed. And Fastmail draws
a nested query **only while its parent is expanded**, which is now the row being
hidden, so it has to be expanded or there is nothing left to show; the chevron
goes with the hidden row, so it cannot be collapsed again by accident.

The promoted row is dressed to stand where the Inbox stood: the icon is **cloned
from the Inbox's own row** rather than drawn here, so it is whatever Fastmail is
using — colour, fill and all — instead of a copy that drifts.

**The count is the Inbox's unread, not the query's.** Fastmail draws no count on
a saved search, and the record's own `unread` is no substitute — measured at 0 on
an account with unread mail, so it is not maintained. Counting the query properly
needs a server query, and a hand-made `MessageList` never resolves: its `length`
stays `null` until a view drives it, even given the exact filter Fastmail itself
uses (readable as `mailboxMessageList.where` while on the view). So the row shows
the Inbox's live unread count — the very number it replaced. For a query that
subtracts what has been triaged the two agree, unless a message is filed while
still unread.

Both rows have to be watched for redraws, not just the Inbox's: the query's row
arrives separately as a sibling, so watching only the first left it wearing the
search icon.

Verified: the Inbox row `display: none`, "Inbox Zero" at the top with 12px
padding and an `i-inbox` icon, badge reading 2 against an Inbox unread of 2, rows
below evenly spaced with no gap, and its dots resolving to
`SearchSourceView.editSavedSearch`.

**Turning the mode off in the Inbox turns it off everywhere**, and per-label
settings survive. This falls out of what is already there rather than needing
anything: `currentLabel()` returns null whenever there is a search — which the
stand-in query is — or when the mailbox is not a user label, which the plain
Inbox is not, so the toggle falls through to the global `toggleMode()`. Nothing
in `setMode` touches `rememberedFilters`. Verified by clicking the indicator on
the query: the mode went off globally and the remembered filters were identical
either side.

It also stops taking a number in `Cmd-1` … `Cmd-9`, since it is no longer a row
of its own; its number is the Inbox's, which lands on it anyway.

Nothing here needs the indicator changed: the search Fastmail builds starts with
`in:Inbox`, so `isInboxSearch()` already recognises it.

### The Inbox chip on message rows

A row's labels are drawn as
`<div class="v-MailboxItem-mailbox"><span title="Inbox">Inbox</span></div>`
inside `.v-MailboxItem-mailboxes`. `MailboxItemView.draw` does not contain that
markup — a helper draws it — so there is no clean method to wrap.

CSS is the better tool anyway: rows are drawn and redrawn constantly while
scrolling, and a stylesheet covers every one without a hook. The chip carries
the mailbox name as its `title`, which is enough to select, and `:has()` lets
the wrapper be hidden so no gap is left:

```css
.custom-hideInboxLabel .v-MailboxItem-mailbox:has(> span[title="Inbox"]) { display: none; }
```

The title comes from the store rather than being hardcoded, so a renamed or
localised Inbox still matches, and a rule is emitted per distinct Inbox name
across accounts. A class on `<body>` gates it, toggled with the same triggers as
the toolbar.

Worth noting the asymmetry that makes this work at all: Fastmail's `style-src`
includes `'unsafe-inline'` while its `script-src` does not, so an injected
stylesheet is allowed where an injected script is refused.

### Label colours, and settings

Colouring rows uses the same lever as hiding the Inbox chip: the label chip
Fastmail already draws carries the mailbox name as its `title`, so one rule per
coloured label stripes the row from CSS.

Each label only declares its own colour; a handful of generic rules do the rest,
and since custom properties inherit, the children that need it get it too. The
fallback is the page colour rather than `transparent`, so every mix collapses to
exactly the stock background on a row with no label colour.

```css
/* per coloured label */
.v-MailboxItem:has(chip) { --custom-label-colour: #b71c1c; }
chip                     { outline: 1px solid var(--ui-page-color-bg, #fff); }

/* once */
.v-MailboxItem .u-list-link { box-shadow: inset 4px 0 0 var(--custom-label-colour, transparent); }
.v-MailboxItem           :is(TINT_TARGETS) { background-color: color-mix(in srgb, LABEL 10%, PAGE_BG); }
.u-list-item.is-focused  :is(TINT_TARGETS) { background-color: color-mix(in srgb, LABEL 12%, FOCUSED_BG); }
.u-list-item.is-selected :is(TINT_TARGETS) { background-color: color-mix(in srgb, LABEL 12%, SELECTED_BG); }
```

`TINT_TARGETS` is `.u-list-link` and the four children that inherit from it.

**The tint paints `.u-list-link`, not the row.** That element is the surface
Fastmail's own focused and selected backgrounds paint, and it is inset from the
row — measured at 8px left, 16px right, 1px top and bottom. Tinting
`.v-MailboxItem` instead put colour outside those edges, so a coloured row and a
highlighted one were visibly different shapes. Painting the same surface makes
the resting, focused and selected states one rectangle in three shades.

The 10% is not arbitrary. Fastmail already draws the chip as a tint of the label
colour — `#b71c1c` renders as `rgb(248, 232, 232)`, that colour at almost exactly
10% on white — so tinting the row to the same 10% makes row and chip read as one
thing.

**The tint must be opaque.** Fastmail declares `.u-list-link`,
`.v-MailboxItem-time`, `.v-MailboxItem-mailboxes` and `.v-MailboxItem-mailbox`
as `background-color: inherit`. A translucent tint is therefore repainted by
each of them and stacks — roughly three times the intended strength where they
overlap, which shows up as dark blocks behind the date and the chips. Mixing
against the page colour instead of `transparent` makes repainting idempotent.

The focused and selected rules mix the label colour into Fastmail's own two
backgrounds at 12%, so it shows through both states while keeping the
distinction between them.

Those two rules name `.v-MailboxItem` as well, and it has to be part of the same
compound selector. Fastmail paints the focused row with
`.u-list-item.is-focused .u-list-link` — three classes — and `:is()` counts only
as its most specific argument, so a plain `.u-list-item.is-focused :is(…)` ties
and the winner comes down to which stylesheet is later. The head start writes
ours before Fastmail's are parsed, so ours lost: for the link, but not for the
date, which Fastmail leaves at `inherit`. The date came out tinted while the row
it sat on did not.

A fourth class settles it, but **the row element carries both names** —
`class="v-MailboxItem u-list-item …"` — so writing them with a space asks for a
descendant that does not exist and the rule matches nothing at all, leaving the
date to inherit: a white patch behind it. Both mistakes were visible, and
opposite.

Verified on a row carrying a label chip: link, date, chip and toolbar compute an
identical background in all three states. Hover is expressed as `is-focused` on the row, not a
`:hover` rule — there is no `:hover` styling on list items at all.

The row is tinted to exactly the chip's own shade, so the chip needs an edge of
its own: a hairline on top, right and bottom, leaving the left open so it reads
as a tag rather than a box. The line is the page colour — white in the light
theme, and still the right separating colour in a dark one — so it reads as a
gap between chip and row rather than an outline drawn around it.

It is drawn with inset shadows rather than a border, because the list places
rows at a fixed height and a real border would add to the chip's size and nudge
the row's contents — measured unchanged at 24×19px either way.

That avoids touching the row views at all, which matters more here than for the
chip: the list is a `ProgressiveListView` that recycles item views as you
scroll, so anything hung off `MailboxItemView.className` would have to survive
being handed a different message. A stylesheet does not care.

The same sidebar rule applies here: a label taken out of the sidebar does not
colour its rows either. Verified on an account holding one hidden coloured label
and one visible one — a rule was emitted for the second only.

#### Chips are named by path

Fastmail names a chip by the mailbox's **full path** — `title="Projects/Work"` —
while the record's `name` and `displayName` are only the leaf. Every rule that
selects on a chip, and every comparison against one, has to use the path or it
silently misses every nested label: the colours would not apply, and the
stale-chip sweep below would delete each nested chip as belonging to a mailbox
the message is not in.

Once a container label holds everything, that prefix is on every chip and says
nothing, so only the leaf is shown. The `title` keeps the full path, so the
tooltip still says where the label lives and the rules still match.

**Safari will not do this in CSS.** `content` on an ordinary element is ignored —
measured, the chip's width did not move — and the alternatives either need the
font size hardcoded or leave the chip as wide as the text it is no longer
showing. So the text is rewritten as it is drawn.

An open message lists the same labels a second time, as badges
(`.v-ThreadLabels a.u-badge-text`) rather than chips, and those carry **no
`title`** — there the path is the text and nothing else. So the path is moved
into the `title`, which both keeps the tooltip and makes a second pass safe: a
badge already showing its leaf is left alone. Badges are reused, so a `title`
whose leaf no longer matches the text is dropped rather than left claiming the
wrong path.

Both are caught by one MutationObserver on the mail app (`#mail`), looking only
at the nodes it adds. Watching the whole app rather than the list means the
reading pane is covered without having to know when it is built — it is created
on first use, long after the observer is set up. Rewriting text replaces a text
node, and text nodes are turned away at the top, so this cannot feed itself.

#### A chip that outlives its label

Selecting on the chip has one catch. Fastmail draws a row's label chips and adds
to them when a label is added, but **does not take one away when a label is
removed** — the chip stays behind. That is its own display bug, and it becomes
ours as well: the colour is selected on the chip, so it outlives the label.

`redrawLayer()` on the row does not rebuild them, so the stale chip is taken out
directly, on the same message-change signal the badge counts already use. Only
chips naming a mailbox the message is no longer in are touched, so scrolling and
ordinary changes cost nothing. Nothing has to be put back: Fastmail draws the
row from the record whenever it does redraw — recycling it as you scroll, or
reopening the view.

Verified by adding and removing a coloured label on one message: the chip and
the colour appear together and go together, without a reload.

Only labels with a colour set produce a rule — `color` is `null` until you
assign one. A message carrying two coloured labels matches both rules and the
later wins; rules are emitted in store order, so the outcome is stable rather
than meaningful.

The stylesheet names labels and their colours, so it is regenerated on
`store.on(Mailbox)` as well — recolouring or renaming a label updates it
without a reload. That firing is queued, so the change lands a beat later, not
synchronously.

Settings live in the extension's `storage.local`, which the page world cannot
read. The background writes them onto the page with a `world: "MAIN"` `func`
injection immediately before the payload, and the payload merges them over its
own defaults — so running it by hand, without the extension, still works. A
change in the settings page fires `storage.onChanged`, which pushes the new
values into every open Fastmail tab and calls `applySettings`, so options take
effect without a reload.

### The thread-list toolbar

The bar above the thread list is the `.v-Toolbar` inside `#mailbox`, a
`MailToolbarView`. Its children run: select-all checkbox, a `v-Toolbar-flex`
spacer, the filter `MenuButtonView`, a divider, sort, a divider, actions.
Inserting before the filter view puts the button at the left of that group.

`FastMail.classes.ButtonView` takes `type` (extra classes), `icon`, `label`,
`target` and `method`, and computes

```js
className: baseClassName + type + (icon ? ' has-icon' : '') + (isActive ? ' is-active' : '') …
```

with `isActive` among its declared dependencies. Reusing Fastmail's own
`v-Button--subtleStandard` classes and its `is-active` state means the on and
off colours come from the theme rather than being hardcoded — the filter button
beside it uses the same convention. The icon is a clone of the sidebar's
`svg.i-inbox`, so it inherits icon sizing and colour like any other.

Two things do not work as expected:

- `className` recomputes when `isActive` changes, but Overture does not write it
  back to the layer for a view inserted this way. The class has to be applied to
  the node directly.
- `insertView` draws on the run loop, so "is it already there?" cannot be
  answered from the DOM alone. A toggle arriving before the draw lands sees no
  node and inserts a second button — observed in use. The check also has to
  consult the toolbar's `childViews`.

#### Screens with no filter

Search results are mail but offer no filter control, and Settings, Contacts and
Calendar tear the mail page down entirely. The mode has nothing to say about any
of them, so the button goes rather than sitting there alone.

Whether it belongs is read from the route, not from the toolbar:
`FastMail.router.get('app') === 'mail'` and no `search` on the controller —
**except** a search beginning `in:inbox`, which is an Inbox view by another
name. That is the saved search listing what has not been triaged yet
(`in:Inbox -in:./*`), and the mode has everything to say about it even though
Fastmail draws no filter control there. The Inbox chip is hidden on those rows
too, for the same reason it is hidden in an inbox-filtered label: every row is
in the Inbox, so the chip says nothing.

The button normally sits left of the filter control. A view without one puts the
sort control in that same place, so it stands in as the anchor and the button
keeps its position. This
matters because every observer runs *before* Overture redraws — at the moment
the search property changes, the old bar with its filter control is still on
screen, so asking the DOM gives last screen's answer. Reading the route gives
this screen's.

The route says whether, not when. Coming back from a search or from Settings,
there is no bar yet to put the button in, so placement retries every 50 ms for a
second and then gives up rather than spinning on a screen that will never have
one. Each navigation cancels a retry still in flight, since it was placing a
button for the screen just left.

### The Move to menu

Move to (`v`) is the quick one: a plain list, no checkboxes and no Save, so a
message is filed by typing a few letters. Two things are wrong with it for
triage. It offers **every** mailbox there is — measured at 22 on a thirteen-label
account, including Inbox, Trash and every label taken out of the sidebar — and
what it does at the end is *move*, taking the message out of the Inbox.

So `v` opens it narrowed to the sidebar's labels, saving the last one standing,
and **adding** the label rather than moving to it. `Option-V` opens it as it
comes. **Labels is untouched**: `l` opens it exactly as Fastmail ships it.

**Adding rather than moving.** Measured, Move to's `didSelect` is a one-shot
`actions.move(null, mailbox)`, where `null` means the current selection — against
the Labels menu's tristate, which keeps `_mailboxState`, `_changed` and an
`apply` that commits on close. Swapping in the same actions object's `add` (or
`copy`, in folders mode — the verb dropping onto a label already uses) leaves the
message where it is and gives it the label as well. Verified by counting: after
picking a label, the Inbox held 174 either side while the label went from 5 to 6.

Because `didSelect` is where the work happens — there is no `apply` to commit on
this menu — it is also where the list is asked to fetch again, which covers both
auto-save and picking by hand.

**A MessageList without a sort breaks the whole app.** `fetchInboxes` builds a
`MessageList` per account to pull the Inbox into the store. Given
`{accountId, where, collapseThreads}` and no `sort`, that query never
initialises — `length` stays `null`, `sort` stays `null` — and from the moment it
exists **every message action in Fastmail throws**: read, unread, flag, archive,
Report as Spam, all with `null is not an object (evaluating 't.length')`. The app
walks every `MessageList` in the store to apply an optimistic update and reads
the sort of each one.

Isolated cleanly: on a fresh load with the mode off, `read` succeeds; creating
that one query makes the very next `read` throw; adding
`sort: [{property: 'receivedAt', isAscending: false}]` makes it succeed again.
The order is irrelevant to us — only that there is one.

This is why "Report as Spam does not remove the message": the action was not
failing to update the list, it was **failing outright**. The stack pointed into
`setUnread`, which is the first thing `reportSpam` chains.

Two wrong turns worth remembering. `canGetDeltaUpdates` reads `true` in both
search and mailbox views, so it does not explain anything, despite `doAction`
ending with it. And an attempted reproduction by archiving from a search proved
nothing — the keypress never archived, and reading "the list did not change" as
confirmation was reading a null result as a positive one.

**Keeping the focus.** Filing a message takes it out of the view, and the row it
was focused on goes with it. Fastmail's incremental path already handles this
well — `contentWasUpdated` adjusts the index only for removals *above* it, so the
message that takes the filed one's place is the next one. The forced refetch does
not go that way: it replaces the list wholesale, and `setRecordInNewContent` sets
the index to `-1` when it cannot find its record.

Putting the index back is not enough on its own. The list settles in more than
one step, and the record is only re-derived when the index *changes* — so
restoring it against contents that are still the old ones leaves `record` naming
the message just filed, which is no longer in the list. Measured exactly that:
index 3 held the right message while `record` still named the filed one, which is
what the reading pane and the next action would have followed.

So the list is watched too, and the record brought back into step for as long as
the contents keep moving. Verified end to end: filing the message at index 3 took
the list from 146 to 145 and left the focus at index 3, on the message that had
been at index 4.

**The button carries two keys.** Its `shortcut` is `"m v"`, one space-separated
property, so it has to be read as a list; comparing the whole string to `"v"`
matches nothing, and the menu comes up unnarrowed. Only the `v` registration is
taken over, which leaves `m` opening Move to as it comes, alongside `Option-V`.

`Option-V` is bound on the physical key (`event.code === 'KeyV'`) rather than
registered as a name, because on a Mac Option-V arrives as `√`.

Nested labels stay: the narrowing drops system mailboxes and anything you have
taken out of the sidebar, not anything nested. Measured on an account with seven
labels under one parent — 22 options down to 10, every nested one kept, and `c`,
`Year`, `2024` and `2025` (all `isHidden`) dropped.

**The menu is built once and reused**, which rules out doing any of this at
construction: a menu first opened from the button would never be patched, and
one first opened by `l` would keep its narrowing when opened by `Shift-L`
afterwards — both observed. The hook is `didEnterDocument`, so each opening is
configured for the way it was asked for, and the flag is cleared as it is read.
That is also what leaves Move to alone, since nothing ever asks for it.
`MailboxMenuView` has no `didEnterDocument` of its own; reading it off the
prototype resolves through the chain, and assigning shadows it for this class.

**Rebinding cannot be done by setting `shortcut`.** A button registers its
shortcut on entering the document and ignores later changes to the property,
which is measurable. The swap therefore happens as the registration goes in, by
wrapping `kbShortcuts.register`. That also settles precedence:
`getHandlerForKey` returns `shortcuts[shortcuts.length - 1]`, the last
registration, and the button re-registers every time a selection appears — long
after boot. Registering ours in the same call keeps it last.

The button is recognised by its shortcut being exactly `l`, rather than by its
label, which is translated.

A shortcut and the button it stands for should not disagree, so clicking Labels
opens what `l` opens and Shift-clicking opens what `Shift-L` opens. The modifier
is read from a capture-phase `mousedown`, before the menu is built. Every
mousedown sets the flag, so one that misses the button clears it — otherwise a
press that never opened a menu would leave it set for whatever opened next.

#### What it is called

A narrowed list is not the list the button promises, and the popover has no
title of its own — what names it is the button it hangs from. So the menu says
"Labels" while it is ours, and the title is removed when it is not.

#### Only labels in the sidebar

Driving the menu by typing makes a system mailbox one mistyped letter away —
`t` reaching Trash. `filterOptions` ends with

```js
rolesVisible && (options = options.filter(m => rolesVisible[m.get('inheritedRole') || 'none']))
```

so `{ none: true }` leaves the mailboxes with no role of their own and none
inherited. It is Fastmail's own mechanism, unused on this menu, rather than a
filter of ours.

That is not the whole answer, because **not every label of your own is in the
sidebar**. Fastmail marks the ones taken out of it `isHidden`, and offering those
back defeats the point of narrowing the list. Compared against what the sidebar
actually draws, `isHidden` agreed on every label in both accounts to hand,
including a parent hidden along with its children; `isSubscribed` was true for
all of them and so says nothing. `rolesVisible` cannot express this, so
`filterOptions` is wrapped to drop them as well — leaving anything that is not a
mailbox alone, since "Create label…" is in that list too.

Measured on an account with seven labels, five of them out of the sidebar:
sixteen destinations become the two the sidebar shows.

#### Auto-saving the last label standing

Once typing has left a single label, it is saved and the menu closes.

Three things make this less obvious than it sounds. **`apply()` commits only
once the menu has left the document** — it is the on-close handler, not a button
— so closing is what saves, exactly as dismissing it by hand does.

**"Create label…" is an option like any other**, so a search matching one label
leaves a count of two, and auto-saving by count alone would eventually invent a
label out of a half-typed word. Only `Mailbox` records are counted.

And **the options list is an `OptionsProxy`**: it reports a `length` and answers
`getObjectAt`, but its `map()` yields nothing and `get('[]')` is `null`. The
generic `toArray` helper sees the `map` and returns empty, which is exactly how
this failed the first time. It has to be walked by index.

The menu is a tristate toggle, so this takes a label off a message that already
carries it and puts it on one that does not — the same either way as picking it
by hand.

### Swapping E and Y

`e` is bound to `toggleExpand` and `y` to the Archive button; Gmail archives with
`e`, and that muscle memory does not unlearn. The two trade places through the
same wrapped `register`. `h` still archives, so nothing is lost.

Registrations already in place when the patch is installed keep the stock
binding, so they are moved across once — reading both before writing either,
since appending to `e` would otherwise be what the read of `y` finds.

Because the key itself is what dispatches, the swap is decided as the
registration goes in rather than at the keypress. Turning the setting off takes
hold as views re-register, or on the next reload.

#### Refreshing the list after saving

Taking a label off a message does not, on its own, remove it from that label's
list while you are looking at it. The row stays until the list is fetched again,
at which point it is gone.

This is Fastmail's behaviour, not ours: `Shift-L` — its own untouched menu —
does the same, measured both with a message open and from the list alone. The
removal itself lands immediately; the store shows the label gone the moment the
menu closes.

Optionally, that fetch is asked for, so a message that no longer belongs leaves
the view at once. `MessageList` inherits `setObsolete()` and `fetch(force)` from
the query base, which is all it takes.

The hook is `apply()`, the commit itself, so it covers every way of saving —
auto-save, Enter, and picking a label by hand. `apply` empties `_changed`, so
whether anything changed is read before calling through, and nothing is fetched
when nothing was saved.

Measured both ways on the same message: with the option on the row goes at once,
with it off the row stays while the store shows the label already gone.

### Dropping onto a label

`MailboxSourceView.prototype.drop` decides between filing and moving from the
drag's effect:

```js
drop(e){ … e.get("dropEffect") & COPY ? (inLabelsMode ? actions.add(sks,mb)
                                                      : actions.copy(sks,mb))
                                      : actions.move(sks,mb) }
```

`COPY` is `1`, confirmed by exercising the stock handler with synthetic drags:
effect `2` produced `move`, effect `1` produced `add`. `inLabelsMode` is read
from `FastMail.preferences`, and is `true` on this account. `actions.add`,
`actions.move` and `actions.copy` all exist on the mail controller.

Swapping the two branches is therefore enough, and does not require knowing how
Option maps to an effect — only that the app's own test separates the cases.

### Counting data

`Message` exposes `get('mailboxes')` and `get('thread')`. `mailboxes` is an
Overture **record array**, not a real array: its indexed values are store keys
and it has no own `length`, so `Array.prototype.slice.call()` on it silently
yields nothing. Its own `map()` is what hands back records, which is why the
existing scripts walk such collections with `.map(x => x)`.
A `LocalQuery` over `Message` with `where: data => !!data.mailboxIds[inboxStoreKey]`
returns the Inbox's messages and matched the Inbox's own total.

Only `Inbox`, `Archive`, `Sent`, `Drafts`, `Trash`, `Spam` and `Scheduled` carry
a `role` in this account; every user label has `role === null`.

### Accounts, and why the local scan is not enough on its own

The real setup has **two accounts** with an Inbox (`u39114078` with 408
messages, `uf5e940af` with 151). Taking "the" Inbox as the first mailbox with
role `inbox` picks an arbitrary one, and on this setup picked the account that
was not in view, producing a count of zero for all 37 labels. Every Inbox must
be considered. Doing so needs no account bookkeeping, because a label only ever
appears on messages of its own account.

The store also holds only what has been fetched. On that account the Inbox
totalled 151 messages but just 65 were cached, so a pure local scan starts out
short — invisible on a test mailbox holding a single message.

Fixing this needs a server-backed query per Inbox. `FastMail.classes.MessageList`
takes a plain JMAP filter, so one can be built directly without the internal
where-clause builder:

```js
FastMail.store.getQuery(id, FastMail.classes.MessageList, {
    accountId, where: { inMailbox: inbox.get('id') }, collapseThreads: false
});
```

`query.getStoreKeysForAllObjects(cb)` then `getObjectAt(i)` across the length
pulls every message into the store — the idiom `refreshQuery` already uses in
`fastmail-tweaks.js`. No waiting is required: records arriving in the store move
the local query, which repaints the badges, so counts converge on their own.
`WindowedQuery.prototype.checkIfEverythingIsFetched` does **not** exist natively;
the old script defined it.

### Shortcut

Fastmail binds `Meta-Shift-I`, `Meta-Shift-Z`, `Shift-M`, `Shift-A/C/E/F/G/L/R/U/W`
and the lowercase letters, among others. Plain `Shift-I` is unbound.

Note that `fastmail.js` and `fastmail-tweaks.js` both register `Shift-I` for
"go to Inbox". That is inert today — those scripts cannot boot — but if they are
ever repaired, both handlers will fire on the same key.

## Behaviour

While the mode is **on**:

1. Navigating to a user label applies the `inbox` filter. The Inbox itself and
   every other system mailbox are untouched, as are saved searches.
2. Each user label's badge shows the number of distinct threads among Inbox
   messages that carry that label. A label with none shows no badge.
3. Counts do not roll up into parent labels, so a badge always equals the row
   count you get by clicking that label.
4. Changing the filter by hand — via Fastmail's own filter menu — is remembered
   **for that label** and re-applied every time you return to it. A label you
   have never changed gets `inbox`. Setting a label back to `inbox` forgets it
   again, so the record only ever holds the labels you have actually changed.
   Choices are keyed by mailbox id, since store keys are per-session.
5. Dragging messages onto a label files them **additively**: they gain the label
   and stay in the Inbox. Holding Option restores the stock move. This is the
   reverse of Fastmail's usual pairing, and suits filing during triage.

A button sits in the toolbar above the thread list, immediately left of the
filter control. It shows the mode's state — the theme's activated colour when
on, its subtle colour when off — and clicking it toggles the mode, alongside the
keyboard shortcut.

While a label is filtered to the Inbox, every row in it is in the Inbox by
definition, so the Inbox chip on each row carries no information and is hidden.
It reappears in the Inbox's own view, in an unfiltered label, and with the mode
off.

Fastmail marks the filter control active for any filter, which beside this
button would mean two lit controls saying the same thing. So the filter button
is left inactive for the inbox filter, which our button now represents, and
stays active for every other filter. "All mail" is no filter, so neither is lit.

| Filter | Inbox-mode button | Filter button |
|---|---|---|
| `inbox` | active | not active |
| `unread`, `pinned`, `vips` | follows the mode | active |
| All mail | follows the mode | not active |

Toggling the mode applies to the label already on screen, rather than only
taking effect on the next navigation. Selecting the source you are already on
short-circuits inside `SourcesController.select` before reaching `goSource`, so
without this the toggle would look inert until you navigated away and back. An
explicit toggle outranks a filter picked by hand earlier; switching the mode off
clears only the filter the mode itself applied.

While the mode is **off**, everything is stock: no filter is injected and badges
show Fastmail's own counts.

One gap follows from patching `goSource`: reaching a label by URL rather than by
selecting a source bypasses the patch, since there is no `?filter=` to decode.
A **fresh page load** is covered anyway, because applying the mode at boot
filters whatever label the load lands on. What remains uncovered is in-app
history navigation — the back button onto a bare label URL — which opens
unfiltered until you select a source again. Badges are unaffected; they never
depend on `goSource`.

Toggling emits nothing beyond the badge and filter changes themselves. Fastmail's
header already renders "In Inbox • *Label*" whenever the filter is active, which
is an accurate indicator obtained for free.

## Structure

A single file, `fastmail-inbox-mode.user.js`, with a `==UserScript==` header
matching `app.fastmail.com`. Configuration — the shortcut and the `localStorage`
key — sits in constants at the top.

### Installation

The Userscripts Safari extension keeps its scripts in a sandboxed container and
maintains its own `manifest.json`. Two things follow, both learned the hard way:

- The **real file must live in the container**, at
  `~/Library/Containers/com.userscripts.macos.Userscripts-Extension/Data/Documents/scripts/`.
  The repo holds a symlink pointing at it. A symlink in the other direction is
  never picked up, and neither is a plain copy until the extension rescans.
- The name must end in `.user.js`, and `@inject-into page` is required so the
  script runs in the page's world where `FastMail` lives.

The extension re-reads a script only when it scans; after editing the file
externally, it stops injecting until its list is opened again. For iterating,
evaluating the file directly in the page is faster and does not depend on the
extension.

| Unit | Does | Depends on |
|---|---|---|
| `isUserLabel(mailbox)` | True when the mailbox has no `role` | — |
| `inboxStoreKeys()` | Store keys of every account's Inbox | `FastMail.store` |
| `inboxMessages()` | `LocalQuery` of messages in any Inbox | `inboxStoreKeys` |
| `accountsWithLabels()` | Accounts that have labels worth counting | `isUserLabel` |
| `fetchInboxes()` | Pulls each relevant Inbox into the store once | `accountsWithLabels` |
| `computeCounts()` | `Map(mailboxStoreKey → thread count)` | `inboxMessages` |
| `sidebarRows()` | Rendered rows as `{view, mailbox}` | `getViewFromNode` |
| `repaintBadges()` | Calls `redrawBadgeCount` on every row | `sidebarRows` |
| `patchBadgeRendering()` | Wraps `draw` and `redrawBadgeCount` | `computeCounts` |
| `patchGoSource()` | Injects the `inbox` filter | `isUserLabel` |
| `patchDrop()` | Swaps additive and move on drop | `isUserLabel` |
| `addIndicator()` | Inserts the toolbar button, once | `mailToolbar`, `filterButton` |
| `canFilter()` | Whether this screen has a filter at all | the route |
| `placeIndicator()` | Retries insertion until the bar is drawn | `addIndicator` |
| `removeIndicator()` | Takes the button off a screen without a filter | `mailToolbar` |
| `updateIndicator()` | Syncs the button to the mode, or removes it | the three above |
| `updateFilterButton()` | Suppresses its active state for `inbox` | — |
| `refreshToolbar()` | Re-applies after Overture redraws | the above |
| `applyModeToCurrentView()` | Filters the label already on screen | `isUserLabel` |
| `setMode(on)` | Persists the flag, recomputes, repaints | the above |
| `boot()` | Waits for readiness, applies patches, registers `Shift-I` | — |

The most recent `computeCounts()` result is held in a module-level map, which is
what the badge interception reads.

### Badge interception

`patchBadgeRendering` wraps `redrawBadgeCount` rather than pushing values and
hoping they survive. When the mode is on and the row is a user label, it writes
our number onto the mailbox as a **raw property assignment** (not `.set()`, so
nothing is notified), calls the original, then restores the previous value:

```js
const original = MailboxSourceView.prototype.redrawBadgeCount;
MailboxSourceView.prototype.redrawBadgeCount = function () {
    const mailbox = this.get('content');
    if (!modeIsOn || !isUserLabel(mailbox)) return original.call(this);
    const stock = mailbox.badgeCount;
    mailbox.badgeCount = counts.get(mailbox.get('storeKey')) || 0;
    try { original.call(this); } finally { mailbox.badgeCount = stock; }
};
```

`draw` is wrapped the same way. It builds the badge span by reading
`badgeCount` directly rather than calling `redrawBadgeCount`, so a row appearing
for the first time — the children revealed by expanding a collapsed parent —
would otherwise show the stock count until something else forced a repaint.

Intercepting at the paint point means any redraw Fastmail triggers for its own
reasons paints our number rather than reverting to the stock one, so there is no
race with Fastmail's badge binding.

An explicit `repaintBadges()` sweep is therefore needed only when the counts
themselves change, or when the mode is toggled.

### Recomputation

`computeCounts` is pure: one pass over `inboxMessages()`, adding each message's
thread store key to a `Set` per user label, then reducing each `Set` to its size.
It mutates nothing and can be run from the console to check its numbers against
the lists before the badges are trusted.

It is re-run, followed by `repaintBadges()`, when the mode is toggled, and
whenever the store reports a change to any `Message` — the subscription
described above, coalesced through a short timer.

### Boot

The readiness check waits for `FastMail.router.getAppController('mail')`,
`FastMail.store`, and at least one `.v-MailboxSource` node in the DOM — replacing
the `activeViews` guard that cannot pass on this build. The mode's persisted
state is read from `localStorage` and applied once the patches are in place.

### The first paint

The payload is injected once the document is complete and then waits for
Fastmail itself to be ready. Fastmail paints its first message rows before that,
so on a fresh load they arrive unstyled: the Inbox chip appears and then
vanishes, and label colours turn up late.

Neither the stylesheet nor the body class needs Fastmail once they have been
worked out, so both are kept in `localStorage` and replayed by a content script
at `document_start` — before there is anything on screen to correct. A content
script is enough, and no MAIN world is needed: only the JavaScript world is
isolated, while `localStorage` is scoped to the origin and therefore shared with
the page. The replayed `<style>` carries the same id, so the payload finds it and
takes it over rather than adding a second one.

Whether the chip should be hidden depends on the mailbox being a user label,
which needs the store. Remembering the answer per URL sidesteps that: a view you
have opened before is right from the first paint, and any other is corrected as
soon as the store is up.

That answer is filed on a short delay. The router writes the URL on the run
loop, so reading it as the answer is worked out keys it to the view being left —
which is how an answer meant for a label ended up filed under the Inbox, as
observed. A version stamp on the stored map drops answers written before that
was fixed.

## Verification

There is no test harness for a userscript against a live web app. Verification
is done in Safari via AppleScript-driven JavaScript (`osascript` →
`do JavaScript … in document 1`), which is how every claim in Internals above
was established.

| Case | Expected |
|---|---|
| Toggle on, click a label | List filtered to Inbox; header reads "In Inbox" |
| Toggle on, click Inbox, Archive or Sent | Unfiltered, stock behaviour |
| Label with 2 Inbox conversations | Badge shows `2`, matching the row count |
| Label with nothing in the Inbox | No badge |
| Two messages of one thread, both labelled and in the Inbox | Counts as `1` |
| Message labelled `A` and `B`, in the Inbox | Both badges count it |
| Change a label's filter to Unread, leave, return | Still Unread |
| Set that label back to Inbox | Entry forgotten, default restored |
| Set a label to All mail, leave, return | Still All mail |
| Switch the mode off and on again | Re-applies that label's own choice, not `inbox` |
| A label never changed | Gets `inbox` |
| Archive a message out of the Inbox | Its label's badge drops without a reload |
| Remove a label from a conversation | That label's count drops without a reload |
| Re-add the label | The count comes back |
| Counts vs. the server | Every label agrees with a JMAP `Email/query` total |
| Two accounts with an Inbox | Labels counted against their own account's Inbox |
| Toggle off | Badges revert to stock counts; no filter injected |
| Reload with the mode on | Mode still on, counts painted |
| Expand a collapsed parent while on | Newly drawn children show Inbox counts |
| Parent label with labelled children | Parent counts only its own |
| Toggle on while already viewing a label | Filter applies at once, without navigating |
| Fresh page load onto a bare label URL | Boot applies the filter |
| Back button onto a bare label URL | Unfiltered until a source is selected |
| Drag onto a label, mode off | Moves (stock) |
| Drag onto a label with Option, mode off | Adds the label (stock) |
| Drag onto a label, mode on | Adds the label, message stays in the Inbox |
| Drag onto a label with Option, mode on | Moves |
| `l` with the mode on | Menu titled "Labels", narrowed to the sidebar's labels |
| `Shift-L` after `l` | Second opening is the full stock menu again |
| Click the Labels button | Same as `l` |
| Shift-click the Labels button | Same as `Shift-L` |
| `m` and `v` | Stock Move to, unchanged |
| Type until one label is left | Saved and the menu closes, no Enter, no Save |
| Type something matching no label | "Create label…" is never saved automatically |
| Remove a label, refresh on | Row leaves the view at once |
| Remove a label, refresh off | Row stays until the list is fetched again |
| Mode off | No colours; `l` opens the stock menu |
| `e` / `y` | Archive / expand, swapped from stock; `h` still archives |
| `Option-V` with the mode on | Stock Move to |
| `m` | Stock Move to, either way |
| `v` with the mode off | Stock Move to |
| "Offer only labels" on | Trash, Archive, Spam and Sent absent from that picker |
| "Offer only labels" off | Every destination Fastmail would normally offer |
| Indicator with the mode on / off | Activated colour / subtle colour |
| Click the indicator | Mode toggles, both buttons restyle |
| Toggle repeatedly | Exactly one indicator, never a duplicate |
| Move between sources | Indicator survives the toolbar rebuild |
| Enter a search | Indicator goes with the filter control |
| Search starting `in:inbox` | Indicator shown, left of sort; Inbox chip hidden |
| Any other search | No indicator, chip shown |
| Leave the search | Indicator returns, exactly one |
| Open Settings or Contacts | No indicator |
| Return to mail | Indicator returns, exactly one |
| Filter set to unread or pinned | Filter button active, indicator follows the mode |
| Filter set to All mail | Neither button active unless the mode is on |
| Inbox chip, mode on, label filtered to Inbox | Hidden |
| Inbox chip, viewing the Inbox itself | Rows still show their other labels |
| Inbox chip, mode off | Visible again |
| `Cmd-1`, `Cmd-4`, `Cmd-6` | Inbox, Sent, Trash — the 1st, 4th, 6th above Labels |
| `Cmd-§` from the Inbox | Enters the label list, filter applied |
| `Cmd-1`…`Cmd-9` in a Safari tab | Safari switches tabs; use the web apps |
| Row carrying a coloured label | Striped and tinted in that colour |
| Hovering a coloured row | Hover shade with the colour showing through |
| Selecting a coloured row | Selection shade with the colour showing through |
| Date and chip areas of a tinted row | Same shade as the row, not darker |
| Tinted row vs. a highlighted one | Same rectangle, no colour outside its edges |
| Label with no colour set | No stripe |
| Recolour or clear a label's colour | Stylesheet follows, without a reload |
| Turn "Colour rows by label" off | Rules removed, stripes gone |
| Coloured label taken out of the sidebar | No stripe, no tint |
| Remove a coloured label from a message | Chip and colour both go, no reload |
| Nested coloured label | Coloured; rule selects the full path |
| Chip for a nested label | Shows the leaf, tooltip shows the path |
| Scroll a stripped chip out and back | Still stripped |
| Nested label on an open message | Shows the leaf, tooltip shows the path |
| Click the sidebar's Inbox, mode on | Lands on the query under it |
| `Option-1` with a stand-in query | Same, and the keys below keep their rows |
| Sitting on the stand-in query | Its own row highlighted, as Fastmail draws it |
| The query's dots | Edit the saved search, not the Inbox |
| The query's row | Inbox icon, and the Inbox's unread count |
| Toggle while on the query | Whole mode off; per-label settings kept |
| Account with no query under Inbox | Inbox behaves as Fastmail ships it |
| Turn Inbox mode off | Inbox row goes back to the plain Inbox |
| Open `/mail/Inbox/` directly | The plain Inbox, as an escape hatch |
| Sidebar on a fresh load | No Inbox row, query at the top, unindented, no gap |
| `v` in the Inbox | Narrowed list, no title, nested labels kept |
| Pick a label from `v` | Label added, message still in the Inbox |
| `Option-V` or `m` | Move to as Fastmail ships it, full list, moves |
| Any message action with the mode on | Works — read, flag, archive, Report as Spam |
| File a message that leaves the view | Focus lands on the next message, record and all |
| File one that stays in the view | Focus does not move |
| Move to another message | Its own labels stripped, no stale tooltip |
| Add a coloured label to a message | Chip and colour both appear |
| Copy to picker, account with hidden labels | Only the sidebar's labels offered |
| Suboption with its parent off | Shown, disabled, plainly not in play |
| Saved search navigation | Unaffected |
| Mailbox record status after painting | Still `READY`; no server traffic |

## Out of scope

- Any change to `fastmail.js`, `fastmail-tweaks.js` or the backup file —
  including repairing their dead `activeViews` boot guard and `getViewsByClass`
  helper. Merging Inbox mode into them is a later decision.
- Roll-up counts for parent labels.
- Grouping or sorting the message list by label. Fastmail's JMAP rejects it:
  `Email/query` with a sort property of `mailboxIds`, `mailbox`, `label` or
  `keyword` all return `unsupportedSort`, while `receivedAt` succeeds. Doing it
  client-side would mean fetching the whole query and reimplementing a list that
  is windowed and paged by the server.
- Badges on saved searches, and any counting for system mailboxes.
- Any settings UI. Configuration is constants at the top of the file.
- Any interaction with the archive-label swap designed in
  `2026-08-11-fastmail-archive-inbox-labels-design.md`. The two features are
  independent scripts; if both are installed, archiving fires that script's
  label swap and this script's badges then recount, with no coupling between
  them.

## Untriaged as a label (supersedes the stand-in query)

Date: 2026-08-12

### Why the earlier design kept fighting

"Still to process" was defined by **absence** — an Inbox message with no label yet.
Absence cannot be expressed as a mailbox, only as a search, and that one fact
produced most of the difficulty: a search view needs a saved search to live in,
the saved search needs a sidebar row of its own, its list does not update the way
a mailbox does, so filing needs a forced refetch, and the refetch loses the focus,
which needs repairing. Each fix was sound and each was only needed because of the
first choice.

Turning it around — defining "still to process" by **presence** of an `Untriaged`
label — makes it an ordinary mailbox. Everything native comes back: counts, delta
updates, `j`/`k`, focus, the reading pane, and no search anywhere.

### The design

A Fastmail rule adds `Untriaged` to incoming mail. The user maintains that rule;
the script never writes it.

- **Processing view**: open `Untriaged`. A real mailbox, so a real mailbox view.
  With the mode on it is filtered to the Inbox, so it reads as "in my Inbox, not
  yet categorised".
- **Filing**: `v` picks the real label and drops `Untriaged` in the same action —
  `actions.addremove(storeKeys, [chosen], [untriaged])`, measured to take arrays
  of mailboxes for each side and to delegate to `add`/`remove` for the single
  cases. The row then leaves the view through Fastmail's own delta update.
- **Nothing leaves the Inbox.** Labels are additive; a message stays in the Inbox
  until it is actually dealt with.
- **Inbox Zero** is `Untriaged`'s badge reaching zero. Inbox mode already
  rewrites a label's badge to count the Inbox messages carrying it, so that badge
  is the progress meter with no new code.
- **Per-label Inbox views** are what the mode already does.

### What this removes

The forced refetch and the focus repair go with it — both existed only because a
search-backed list does not drop a message that has stopped matching. So does the
whole stand-in apparatus: `standInQuery`, `standInRules`, `standInRowNode`,
`showStandInRow`, `syncStandInStyles`, `hookSelect`, the promoted-row icon and
badge, the sidebar hiding and unindenting, and the `inboxStandIn` setting.

`isInboxSearch` stays: it costs little and still does something useful for any
`in:inbox` search typed by hand.

Verified: a message carrying `["Triage", "Inbox"]` came out of one `addremove`
as `["Inbox", "Later"]` — categorised, off the triage list, still in the Inbox.

The label's name is a setting, `triageLabel`, defaulting to `Triage`; the options
page gained its first text field for it. Left empty, the whole thing switches off
and filing behaves as it did before.

### Open
- Existing Inbox mail carries no triage label. Simplest one-off is in
  Fastmail itself: search the untriaged set, select all, add the label. No script
  support needed.
- Worth deciding: a shortcut that jumps straight to `Untriaged`.

### fetchInboxes, removed

`fetchInboxes` was a no-op that also left a mess. Its `MessageList` never resolves — `length`
stays `null`, `status` `1` — and the query could not be found in the store at
all afterwards. Hand-made `MessageList` queries do not fetch: `fetch(true)`,
`getObjectAt(0)`, `getStoreKeysForAllObjects()` and `store.fetchAll` all failed
to drive one. The per-label counts have therefore only ever counted the messages Fastmail
happened to have loaded, and the badges are short on a large Inbox — the pull was
never doing anything.

Worse, the query it left behind is **permanently stuck**: `status` 1, `length`
null, for the life of the tab, recreated every time the mode is turned on. Read
back from the store after a session's work:

```
custom-inbox-mode-fetch-uf5e940af  ->  length=null  status=1
custom-inbox-mode-messages         ->  length=85    status=2
```

Chasing a report of a search view "reloading" turned up heavy background churn —
22 list changes and 15 message-store events in five seconds on an idle view, with
`length` never moving. That particular tab was polluted with eight throwaway
stuck queries from probing, which is the likely cause of what was seen; a fresh
load with a single stuck query was quiet. But a query that can never resolve has
no business existing, and this one bought nothing.

So `fetchInboxes` is gone, along with `FETCH_QUERY_PREFIX`. Verified after:
`custom-inbox-mode-messages` alone in the store, and 0 list changes in 8 seconds.

The badges now count what the store holds, which is what they were doing anyway.

### Label prefixes, removed then restored

The prefix stripping was taken out with the redesign, on the reasoning that a
container label's prefix was only noise once triage no longer depended on it.
That reasoning was wrong about how the labels are read day to day, and it went
straight back in: `stripChipPrefix` and `stripBadgePrefix` over
`.v-MailboxItem-mailbox` and `.v-ThreadLabels a.u-badge-text`, driven by
`stripLabelsIn(root)`, with `stripLabelPrefix` still the setting. The
MutationObserver over `#mail` came back with it — it is what catches labels
drawn after a refresh, and it now also dresses the Triage row when a
`.v-MailboxSource` appears.

### The counting query must be built once

`inboxMessages` called `store.getQuery(QUERY_ID, LocalQuery, {where: …})` on
every refresh, handing it a **fresh `where` closure each time**. That rebuilds
the query, and rebuilding it counts as a change to the messages it holds — which
is the same signal, `store.on(Message, …)`, that scheduled the refresh. A loop,
and a visible one: the view redrew several times a second for as long as the mode
was on.

Measured on an idle Triage view, over ~4.5 seconds:

| | list redraws | message-store events |
|---|---|---|
| before | 23 | 21 |
| mode off | 1 | — |
| after | 0 | 3 |

Note the second column: most of the message-store traffic was self-inflicted too,
generated by the rebuilds rather than arriving from the server.

A `LocalQuery` watches the store itself and stays current unasked, so it only
needs building when the set of Inboxes changes — practically never. It is now
cached against the Inbox store keys and reused. Counts are unaffected: `Triage`
60 and `Later` 1 on the test account, with the sidebar showing `Triage 60`.

**The general lesson**, twice over today: a refresh driven by a store signal must
not do anything the store treats as a change. The first instance left a query
permanently stuck (`fetchInboxes`); this one rebuilt a good query forever.

### Archiving takes the triage label off too

A message that carries the triage label and gets archived has been dealt with,
so both labels come off. Left alone it would sit in the triage list having been
archived, which is the one place it must not be.

**Patch the primitives, not the routes.** Archiving reaches two methods on the
actions singleton, and both are wrapped there rather than at any of the keys or
buttons that lead to them:

| Route | Resolves to | Covered |
|---|---|---|
| Archive button, `h` | `actions.archive` | via `archive` |
| `[`, `]`, Remove label button | `actions.removeCurrent` → `this.remove(keys, mailbox)` | via `remove` |
| Swipe | `actions[method]([storeKey])`, measured | via whichever it names |

`removeCurrent` is measured to be `remove(keys, whichever mailbox you are looking
at)`, and in labels mode archiving *is* taking the Inbox label off — so `remove`
is wrapped with a guard on the mailbox's role. Removing some other label is
filing, not archiving: taking a message out of `Later` says nothing about whether
it still needs triaging.

Swipes dispatch through `a_[s]([storeKey])` on the same singleton, resolved at
call time, so they need nothing of their own. Note the configured names are not
method names — the preference reads `removeLabel`, `moveTo`, `toggleUnread`, and
none of those exist on the actions object; `aq()` maps them to the real methods.
A swipe bound to Move to calls `actions.move`, which is a move rather than an
archive and is left alone.

**Two steps, one action.** Every Fastmail action ends by calling `didAction`,
which shows the toast and closes the undo checkpoint — the changes themselves are
already queued by then. Swallowing the first call leaves the label removal on the
queue for the archive's own `didAction` to close over. Measured: `[Triage, Inbox]`
→ `[Archive]` under a single "Archived 1 conversation", and one undo put both
labels back. `didAction` runs inside the call rather than after it, for any
selection Fastmail sends in one batch.

The original gets its own arguments untouched — passing the resolved store keys
would make `isActioningFocused` read false and change where the focus lands.

### The funnel

Triage is a filter, not a tag, so it wears a Lucide funnel — in the sidebar in
place of the label icon, and on the toolbar button, so the switch and the list it
produces read as one thing. `filterGlyph` builds it from an icon Fastmail has
already drawn, keeping the sizing classes and dropping the `i-*` one, which is
what Fastmail hangs each glyph's own styling off.

**Size.** Lucide draws to the edges of its 24-unit box; Fastmail's own glyphs
cover about 15.5 units of theirs, so the funnel read a third too big beside them.
The fix scales the polygon by 0.775 about the centre — the geometry, not the
viewBox, so the stroke keeps its weight — bringing it to 15.5 × 13.9, between
Fastmail's filter and label icons.

**Colour** took two passes. Fastmail writes `color` (the label's colour) and
`fill` (a pale wash of it) into a sidebar icon's inline style, and inline style
beats the `fill="none"` attribute — so copying the style wholesale filled the
funnel and turned a stroked glyph solid, and on the toolbar button it pinned a
colour that had nothing to do with the mode. Dropping the style fixed the button
and lost the label's colour in the sidebar. What works is taking `color` alone,
and only where it means something: `filterGlyph(existing, keepColour)`, true from
`dressTriageRow`, absent from `inboxIcon`.

**The active state.** Fastmail's `is-active` on a subtle button is a faint grey
wash — `rgba(234, 235, 236, 0.15)` behind an unchanged icon. Legible as pressed,
not as on. `paintIndicator` puts the accent on the glyph instead. Measured: on
`rgb(124, 179, 66)`, off the theme's ordinary icon colour with nothing pinned.

The accent comes from `FastMail.theme.colors[isDark ? 'dark' : 'light']`, a
palette of `accent5` through `accent120` of which `accent100` is the accent
proper. It is read on each paint rather than cached, so following the system into
dark and back needs no extra work.

That was the second answer. The first sampled `.v-Button--cta`, the compose
button, on the reasoning that the theme defines no custom properties to ask — 106
stylesheets, zero `--*` names, concrete colours throughout. True, but the
conclusion was wrong: the phone paints nothing in the accent anywhere on the list
screen, so there was nothing to sample and the switch stayed grey. Nor is the
colour in the CSS to be grepped — searching every rule for `#7cb342` returns
nothing. Sampling survives as a fallback only.

The button also had to stop asking `modeForLabel(Triage)`. Triage carries no
Inbox filter by design, so "on for this label" has nothing to mean there, and
asking anyway left the button reading off in the one view you spend the day in.
`currentLabel` now returns null for Triage, making the button the global switch
there — which is what it already does on the Inbox itself.

### The phone

`FastMail.isMobile` decides, not a width: the layout is chosen at load from the
user agent, so a 420px desktop window is still the desktop one, three panes and
all. Testing it means switching Safari's user agent to an iPhone and reloading —
narrowing the window proves nothing.

The phone has no toolbar above the list and no filter control at all, so the
desktop's button has nowhere to sit. It has a page title, and Fastmail already
writes a filter into that title — `Triage • Unread`, in a `.v-Page-subtitle`
span. The switch takes that place, reading `Triage • ⧩`, because that is what it
is: a filter on the list, said where filters are said.

There are two titles, not one — the big in-page heading and the copy that slides
into the header as the list scrolls, `InPageTitleView` and
`DynamicPageTitleView`. Both are dressed, so the switch is wherever the title is.
Overture rewrites the title when the mailbox or its filter changes, which takes
the switch with it, so the same MutationObserver that catches redrawn sidebar
rows re-dresses it.

Two details worth keeping:

- **The spaces are non-breaking.** Fastmail's own `• Unread` sits inside a single
  text node, where ordinary spaces hold. Ours starts a new element straight after
  the title's text, and a leading ordinary space there collapses to nothing —
  which closed the bullet up against the name.
- **The box is 1.2em, not 1em.** The funnel is drawn across 13.95 of its 24-unit
  viewBox, so a 1em box renders it at 0.58em, visibly shorter than the letters
  beside it. 1.2em brings the drawn shape to about 0.7em, the cap height of the
  text. `vertical-align: -0.25em` then drops it onto the baseline, since the
  shape is centred in its box with clear space below.

An earlier attempt put a button in the page header between search and the three
dots — `PageHeaderView.insertView`, anchored after the search `ButtonView`. It
worked, and is recorded here only because the header is the obvious place and the
title turned out to be the better one. Two switches for one setting would only
raise the question of whether they meant different things.

### The Inbox chip while triaging

`hideInboxLabel` asks whether the view is filtered to the Inbox, and triage is
deliberately not — that is the whole point of it. So every row in the triage list
carried an `Inbox` chip saying what every other row said.

`hideInboxLabelTriage` covers it separately rather than widening the first test.
The reasoning differs: in a filtered label view every row *is* in the Inbox as a
matter of fact, whereas here it is a matter of your rule putting the label on
incoming mail. Its own setting, because that "in practice" is a choice you made
rather than something the app enforces.

### Why the Inbox chip came back as soon as you started

Two faults, found while chasing one report.

**The class was on the wrong element.** The chip rules bite only while
`custom-hideInboxLabel` is set, and it was set on `<body>`. Fastmail rewrites
`body.className` wholesale whenever its root view redraws — that is how
`is-kbmode` comes and goes — so the class was dropped, and dropped *silently*:
a `MutationObserver` over `DOMTokenList.toggle`/`add`/`remove` recorded nothing,
because no classList call is involved in an assignment to `className`.

Measured directly: a marker class put on `<body>` was gone within seconds of
ordinary use, while the same marker on `<html>` survived every redraw. So the
class moved to `document.documentElement`, in the payload and in `early.js`
alike. The selectors are descendant selectors and did not change. In `early.js`
it also removes the wait for `<body>` to exist at `document_start`.

This is the whole of "as soon as I start, they come back": entering keyboard mode
is what redraws the root view, and typing is what enters keyboard mode.

**The rules only covered the list.** `.v-MailboxItem-mailbox` is the chip on a
row. An open message draws its labels differently — `.v-ThreadLabels .u-badge`,
holding a link and a remove button — so the chip was still there the moment you
opened anything, which is the first thing triaging does.

The second rule hides the whole `.u-badge`, not just its link, or the × would be
left standing on its own. It matches on the link's `href` rather than its text,
for two reasons: CSS cannot select on text at all, and the text is precisely what
the prefix stripping rewrites. One rule covers every account — the path is the
same in each, only the `?u=` differs.

Both are still pure CSS. Nothing walks the DOM to remove chips, which matters
because the list recycles rows constantly as it scrolls.

### Archiving has to say that the message left

Focus stopped advancing on archive — it sat on the row that had just gone.

Fastmail decides whether to move on by asking whether the action takes the
message out of the list you are looking at. `archive` computes its `stayHere`
flag as, in effect, "is the Inbox part of the current query?" — in the triage
list it is not, so it stays put. That is right for stock Fastmail: stock
archiving takes off the Inbox label only, the triage label stays, and so does the
message.

Dropping that label is exactly what breaks the assumption. The message does leave
the list, so the flag has to say so.

`withDidAction` wraps the call and hands the replacement the real `didAction`
first, then Fastmail's own arguments, so it can either drop the call — which is
how the two removals still land as one undo step — or pass it on with `stayHere`
forced false. Forcing it runs Fastmail's own `goNext`/`goPrev`, honouring the
`afterActionGoTo` preference rather than reimplementing it.

Narrowly gated, on having actually dropped the label *and* being in the triage
list. Archiving a message with no triage label leaves the list unchanged and
should stay put; so should archiving from anywhere else.

Measured, from the triage list with a message open:

| | index | focused record | list |
|---|---|---|---|
| before | 1 | "A quick update on Sticky" | 105 |
| after | 1 | "Raycast July Update" | 104 |

and the archived message came out `[Archive]`, both labels off.

The desktop's reading pane is always present, so `isConversationVisible` — which
`didAction` requires before it navigates at all — is true there whether or not a
message is open. A layout without that pane still stays put, but that is stock
behaviour for any archive rather than anything this changes.

### Verified on the phone

The swipe dispatcher ends in `actions[swipe.method]([storeKey])` on the same
actions singleton, resolved at call time, so patching the primitives covers it —
but "covered by construction" is a claim, so it was run. Driving
`SwipeActionsController.doAction` with `{method: 'archive'}` in an iPhone-user-agent
session, all four paths behave:

| Path | before | after | focus |
|---|---|---|---|
| Swipe → Archive, in the list | `[Inbox, Triage]` | `[Archive]` | list 105 → 104 |
| Archive, message open | `[Inbox, Triage]` | `[Archive]` | moved to the next message |
| Remove, from the Inbox, untriaged | `[Inbox, Later]` | `[Later]` | moved |
| Remove, from the Inbox, triaged | `[Inbox, Triage]` | `[Archive]` | moved |

One toast each, no exceptions. `hasSeenCustomSwipes` was already set, so the
dispatcher's one-time-notice branch was skipped and the call was the real one.

Worth knowing about the phone's UI rather than its plumbing: **in a label view it
offers Remove, not Archive**. The message toolbar is Labels / Delete / Remove /
Snooze / More, and More holds Move to, Mark unread, Unpin, Notify, Mute, Forward
as attachment, Report spam, Report phishing — no Archive anywhere. So from the
triage list, Remove means `removeCurrent`, which takes off the triage label and
leaves the message in the Inbox. Archiving proper is reached by a swipe bound to
it, or from the Inbox, where Remove *is* archive.

### The phone's bottom bar

Fastmail's message toolbar there is Labels / Delete / Remove / Snooze / More.
Remove takes off whichever label you are looking at — in the triage list that
means "not triaged any more", in the Inbox it means archive — so it is the one
button that cannot file a message anywhere. Move to can, and it sat inside More.
They swap: Remove goes, Move to takes its place between Delete and Snooze.

Fastmail's own Move to view is **moved rather than rebuilt**. Two reasons:

- It anchors its popover with `alignWithView: this`, so it lines up against
  wherever it is put — the menu opens directly above the button, which a
  hand-built button calling the original's activate would not have managed: that
  one would still align to the overflow button it came from.
- It is the same view `isMoveButton` already identifies by its `"m v"` shortcut,
  so tapping it opens the narrowed additive menu, exactly as `v` does on the
  desktop, with no second code path.

It is taken out of the overflow's options first, or it would be drawn in two
places at once. If it cannot be found, Remove is left alone rather than taken
away with nothing to put in its place. The toolbar is rebuilt as you move
around, so the same MutationObserver re-applies it.

Desktop is untouched: the swap runs only under `FastMail.isMobile`, and the
toolbar it looks for, `.v-BottomToolbar .v-Toolbar`, is drawn only there.

### Badges differ between desktop and phone

Found while checking the above. The desktop draws a thread label as
`<div class="u-badge"><a href="…/mail/Inbox/?u=…">Inbox</a><button>×</button></div>`;
the phone draws `<div class="u-badge"><span>Inbox</span></div>` — no href, no
title, nothing but the text, which CSS cannot select on.

Two things were quietly desktop-only as a result: the Inbox-chip rule, which
matched on the href, and `BADGE_SELECTOR`, which asked for `a.u-badge-text` and
so never stripped a prefix on the phone at all.

The selector lost its `a`. For the rule, `markBadge` stamps the label's path onto
the badge as `data-custom-mailbox` and a second rule matches that. The stamping
runs whatever the prefix setting says — it is what the hide rules select on, and
the two settings are not the same question. It reads `title` first and the text
second, so it is right both before stripping and after.

The href rule stays alongside it rather than being replaced: that one needs no
script to have run, so it still holds on the first paint of a reload.

### Snoozed mail leaves the triage list on its own

Snoozing something you work from a triage list makes a claim — "not now" — that
the label was contradicting: the message stayed on the list you triage from.

**No Sieve route exists.** Fastmail runs Sieve only on delivery, and the
[Sieve snooze draft](https://datatracker.ietf.org/doc/html/draft-ietf-extra-sieve-snooze)
is explicit that its `snooze` action "applies only to the current message being
processed by the Sieve script during delivery. It cannot affect messages snoozed
through other means like client-initiated snoozing."

**The wake hook is real but too narrow.** A snooze record measured live is
`{until, moveToMailboxId, setKeywords}` — the JMAP form of the draft's `:mailbox`
and `:addflags`. `moveToMailboxId` is singular and the wake does *add
destination, remove Snoozed*, so it can return a message to the Inbox or to the
triage label, never both. `setKeywords` sets keywords, which are not labels.

**None of it is needed.** Measured:

| | labels |
|---|---|
| before snooze | `[Inbox, Triage]` |
| while snoozed | `[Snoozed, Triage]` |
| after waking | `[Inbox, Triage]` |

Snoozing takes off *only* the Inbox label. The triage label rides through
untouched and the Inbox label comes back by itself. So the label needs no
handling at all — what needed fixing was only which of them we show.

Since snoozing removes the Inbox label, filtering the triage view to the Inbox
excludes snoozed mail by construction. That reverses the earlier exemption, whose
reasoning — "filtering could only hide something on the list that has left the
Inbox, which is exactly what you still want to deal with" — was right about
everything except sleep.

The count follows: `totalThreads` less the snoozed conversations carrying the
label, tallied from the same local query, now widened to Inbox ∪ Snoozed. The
server's total less what we can see asleep, rather than the Inbox tally, because
that tally only knows what Fastmail has loaded and runs short on a large Inbox.
This errs the other way — a snoozed message we have not loaded counts as still to
do — which shows more work than there is rather than hiding some.

**Nothing depends on a client being open.** The label is never removed, so there
is nothing to put back; the server's wake is the whole mechanism. The filter and
the count are display, recomputed from current state whenever the payload runs.
Both of the alternatives considered — a `moveToMailboxId` of the triage label, or
a marker keyword set at wake and reconciled later — would have failed in exactly
that case.

One stale value had to go. While the exemption stood, `filterFor` answered `""`
for the triage label before consulting `rememberedFilters` at all, so the `""`
written back there was never a choice and never read. Now that it is read it
would defeat the fix, so it is dropped once per load — only that exact value,
since anything else there was chosen deliberately.

Verified end to end: badge and list 103 → 102 on snoozing, the message gone from
the list; 102 → 103 on waking, back as the first row.
