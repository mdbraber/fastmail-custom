# Fastmail: swap Inbox sublabels on archive

Date: 2026-08-11
Status: approved design, not yet implemented

## Problem

The Inbox is used only for triage. Messages get a nested label — `Inbox/Test`,
`Inbox/Client` — that marks which stream they belong to. Archiving a message
removes it from the Inbox itself, but the nested `Inbox/*` labels survive. The
message stays visible in what is effectively a second inbox even though it has
been processed.

Archiving should retire the triage labels and leave behind the durable topic
label instead: `Inbox/Test` becomes `Test`.

An earlier attempt lives in `fastmail.js` (`initActions`, line 305). It is
commented out at line 80, strips *every* label rather than the Inbox ones, and
never adds a replacement. Its companion undo hack (line 375) pattern-matches
undo entries on `method`, `args` and `messageSKs` — fields that **do not exist**
in the current Fastmail build (see Internals below). This spec supersedes that
code; it is left in place, untouched.

## Decisions

| Question | Decision |
|---|---|
| Destination label | Any existing mailbox whose leaf name matches, anywhere in the tree; create at root if none exists |
| Message with several `Inbox/*` labels | Every one is swapped — `Inbox/Test` + `Inbox/Client` yields both `Test` and `Client` |
| Trigger | Patch `controller().actions.archive`, so keyboard, toolbar, swipe and menu all behave alike |
| Undo | Collapse the swap and the archive into a single undo step |
| Packaging | New standalone userscript, independent of `fastmail.js` |
| Destination cannot be created | Abort the swap for that message; it archives with labels intact |
| Undo patch fails to apply | Log and degrade to stock undo; the archive feature still works |

## Internals

Established by probing the live app (Safari, `app.fastmail.com`, 2026-08-11).
This section records what is *known*, because most of it contradicts the
assumptions in the old `initActions` code.

Confirmed present and working:

- `FastMail.router.getAppController('mail')` — the controller.
- `controller().actions.addremove(storeKeys, addMailboxes, removeMailboxes)` —
  **the key primitive.** Applies a list of label additions and a list of label
  removals to a set of messages in one batched operation. Internally it runs a
  single `doAction` pass, calling `move(msgs, add, archive, true)` for each
  addition and `move(msgs, null, remove, true)` for each removal. It also drops
  the Trash mailbox from the add set automatically.
- `controller().actions.getSelectedStoreKeys()` — the message set archive itself
  defaults to when called with no explicit keys.
- `mailbox.get('parent' | 'name' | 'role' | 'depth' | 'storeKey' | 'subfolders')`.
- `FastMail.store.getAll(FastMail.classes.Mailbox)`.

The undo manager is at
`FastMail.ViewEventsController.kbShortcuts._shortcuts.z[0][0]`, class
`UndoManager`, with `store === FastMail.store` and `maxUndoCount === 10`.

Its actual mechanism, from the minified source:

```
pushUndoData(e) { this.pending.push(e); this.get("sequence") || this.dataDidChange(); }
getUndoData()   { let e = this.pending; e.length ? this.pending = [] : e = null; return e; }
saveUndoCheckpoint(e) { ... this._pushState(this._undoStack, e) ... }
```

Changes accumulate in `pending`. A checkpoint — one entry on `_undoStack`, and
so one press of `z` — is cut when that pending set is drained. Crucially,
`pushUndoData` skips the `dataDidChange()` notification entirely while
`sequence` is truthy.

That is the supported grouping mechanism, and it is what this feature should
use: hold `sequence` truthy across both the label swap and the archive, then
release it and notify once. Everything lands in a single checkpoint.

Stack entries are store-change records shaped
`{create: [], update: [], destroy: [], move: []}`. There is no `method`, no
`args`, no `messageSKs` — hence the old hack could never have worked, and hence
the stack-depth-counting scheme from the first draft of this spec is also
unnecessary.

Creating a mailbox, confirmed end-to-end against the live account (created,
committed, then deleted again):

```js
const mb = new FastMail.classes.Mailbox(FastMail.store);
mb.set('accountId', inboxMailbox().get('accountId'));
mb.set('name', leaf);
mb.set('parent', null);   // null parent = top level
mb.saveToStore();
```

`FastMail.store.autoCommit` is `true`, so `saveToStore()` alone persists it — no
explicit `commitChanges()` needed. Observed: status goes `194`
(`READY|NEW|DIRTY`) → `2` (`READY`) with a real server id assigned, and the
mailbox appears in `getAll`, in `FastMail.findMailbox` and in the sidebar.

`saveToStore()` ignores any argument and reads `accountId` off the record, so
`accountId` must be set *before* the call. It defaults correctly on this
single-account setup; setting it explicitly from the Inbox is cheap insurance
against a shared or multi-account mailbox.

Deletion, if ever needed, is `mailbox.destroy()` (guarded by
`mailbox.get('mayDelete')`), which lands status `132` (`DIRTY|DESTROYED`) before
committing.

This path matters more than it looks: the account currently has **no top-level
`Test`** — `Test` exists only as a child of Inbox. So creation is what the very
first real archive will exercise, not a rare fallback.

## Behaviour

On every invocation of archive, for the message set archive was given:

1. For each message, read its labels and select the Inbox mailbox's descendants.
2. For each descendant, take its leaf name `X` and resolve a destination:
   - an existing mailbox whose leaf name is `X` and which is not itself under
     Inbox;
   - where several match, prefer a top-level mailbox, then the shallowest, then
     the alphabetically first full path — and log that the choice was ambiguous;
   - where none matches, create `X` at the root.
3. If any descendant fails to resolve *and* cannot be created, that message is
   dropped from the swap. It still archives, with its labels intact, and the
   failure is logged.
4. Group the surviving messages by their `(adds, removes)` signature and issue
   one `addremove(storeKeys, adds, removes)` per group. In the common case every
   selected message carries the same labels, so this is a single call.
5. Delegate to the original archive.

Steps 4 and 5 run inside the undo sequence described above, so they collapse to
one undo step.

A message carrying no `Inbox/*` labels produces an empty descendant set and
takes the stock archive path with no label changes.

The plain `Inbox` label is not removed explicitly — archive's own move already
takes the message out of the Inbox.

Step 3 is scoped per message, not per invocation. Archiving a selection of
twenty where one has an unresolvable label leaves that one message's labels
alone and swaps the other nineteen normally.

## Structure

A single file, `fastmail-archive-labels.js`, with a `==UserScript==` header
matching `app.fastmail.com`. It boots off the same
`MutationObserver`-waits-for-`FastMail` pattern used at `fastmail.js:46`.

| Unit | Does | Depends on |
|---|---|---|
| `inboxMailbox()` | The mailbox with role `inbox` | `FastMail.store` |
| `isUnderInbox(mailbox)` | Whether a mailbox descends from Inbox | `inboxMailbox` |
| `inboxDescendants(message)` | The `Inbox/*` labels on a message | `isUnderInbox` |
| `findDestination(leaf)` | Existing mailbox for a leaf name, or `null` | `isUnderInbox` |
| `ensureMailbox(leaf)` | Destination, creating at root if absent | `findDestination` |
| `planSwap(message)` | `{adds, removes}` or `null` when unresolvable | the four above |
| `groupPlans(plans)` | Messages bucketed by identical `(adds, removes)` | — |
| `withUndoSequence(fn)` | Runs `fn` inside one undo checkpoint | undo manager |
| `patchArchive()` | Wraps `controller().actions.archive` | all of the above |

`planSwap` returns a plain object and performs no mutation, so it can be
exercised against real messages from the console without touching anything.
`withUndoSequence` is the only unit that reaches into undo internals, and it is
guarded: if the manager is not where expected it logs, runs `fn` unwrapped, and
leaves stock undo alone. The archive behaviour does not depend on it.

## Verification

There is no test harness for a userscript against a live web app. Verification
is done in Safari via AppleScript-driven JavaScript (`osascript` →
`do JavaScript … in document 1`), which is already confirmed working and is how
the Internals section above was established.

The account is a throwaway, and the user has approved creating whatever the
tests need. Mailbox creation and deletion have already been exercised this way.
The cases below mutate real messages, so each run should leave the account as it
found it where practical.

| Case | Expected |
|---|---|
| Archive a message labelled `Inbox/Test`, no top-level `Test` | `Test` created at root and applied, `Inbox/Test` gone, message archived |
| Archive a message labelled `Inbox/Test`, top-level `Test` exists | `Test` applied, no duplicate mailbox created |
| Same, but only `Work/Test` exists | `Work/Test` applied |
| Message with `Inbox/Test` and `Inbox/Client` | Both swapped in one `addremove` |
| Message with no `Inbox/*` label | Plain archive, no label changes |
| Two matches, `Test` and `Work/Test` | Top-level `Test` wins, ambiguity logged |
| Destination unresolvable and uncreatable | Labels untouched, message archived, failure logged |
| Multi-select, mixed labels | One `addremove` per distinct signature |
| Multi-select where one message fails to resolve | Others swap normally |
| `z` after any successful archive | Labels and archive both reverted in one press |
| Undo manager path missing | Warning logged, archive still works, `z` reverts one step |
| Archive from the toolbar rather than the key | Identical behaviour |

## Out of scope

- Any change to `fastmail.js`, `fastmail-tweaks.js` or the backup file. The dead
  `initActions` stays as it is; merging this feature into `fastmail.js` is a
  later decision.
- Labels nested more than one level under Inbox (`Inbox/Test/Sub`). The leaf
  name is used regardless of depth; no special handling is designed for it.
- Any UI — no settings panel, no visual feedback beyond console logging.
