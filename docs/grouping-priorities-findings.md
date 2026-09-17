# Priorities in grouped lists: findings so far

Written 17 September 2026, to pick this up later. No code has changed yet.
What is below was measured on the work account (nexthealth.nl) against
Fastmail's beta API server, `ams.api.beta.fastmail.com`. Production was not
tried.

## The problem

On the iPhone, the work app's Inbox grouped by **Labels (all)** shows
Fastmail's empty-mailbox message once the grouping has a priority (Pinned).
The same grouping without a priority works on the iPhone, and so does
**Labels (root)** with the priority. On the Mac everything shows correctly.

## Why

### 1. The server refuses more than 32 groups

A grouped list is one `Email/query` with a `category` sort holding a list of
group conditions (`groupBy`). With 33 or more, the server answers
`unsupportedSort`. Fastmail's page then has no count for the list and shows
the empty-mailbox message.

Each priority currently adds a tier (an extra group) in front of every group,
plus one for Other. Labels (all) in the work Inbox is Unread, Triage and 20
labels, so 22 groups. With the Pinned priority that becomes 22 × 2 + 1 = 45.
Labels (root) with the priority stays under 32.

### 2. A group for an empty label swallows everything after it

If a group's condition is a label holding no messages at all, the server puts
every conversation not taken by an earlier group into it, and all later
groups come back empty. This has nothing to do with priorities or sorting.
The same label as a plain search filter correctly returns 0. In the work
account the empty labels are **Projects/Datalab GO** and **Projects/OSI**. It
does not depend on the name: every label with 0 messages does it, every label
with 1 or more does not.

So on the iPhone, Labels (all) is wrong even without a priority: Datalab GO
shows 31 conversations that belong to later groups, and every group after it
is empty.

Both bugs are written up for Fastmail, with the exact requests and answers,
in [fastmail-report-grouped-lists.md](fastmail-report-grouped-lists.md). Not
sent yet.

### 3. Why the Mac is fine: its offline copy answers

Fastmail's offline worker keeps a copy of the mail in the web view's storage.
When that copy holds every message and the query only uses conditions it can
evaluate itself, the worker answers locally instead of asking the server.
The local answer has neither bug.

- The Mac app presents itself to Fastmail as Fastmail's desktop app (to get
  native notifications), and Fastmail switches offline mail on automatically
  there.
- The iPhone app looks like mobile Safari to Fastmail, so offline mail is
  **off** unless turned on in Fastmail's **Settings → Offline** in the app.
  It needs "Keep me signed in". The "Recent" option appears to be enough:
  the Mac never chose "All mail" and still answers locally.
- Even with it on, the server is asked while the first sync runs, after the
  copy is reset or cleared, and for text searches. So the bugs can still
  show; the userscript should not rely on the offline copy.

## What the server supports (all measured)

- **Grouping** only works with Fastmail's own capability
  `https://www.fastmail.com/dev/mail` in `using`. With only
  `urn:ietf:params:jmap:mail`, any `category` sort is refused.
- **Sorts with several levels** work, with or without that capability.
- **Pinned first inside each group** works:
  `{"property": "someInThreadHaveKeyword", "keyword": "$flagged",
  "isAscending": false}` after the `category` sort. It looks at the whole
  conversation. Verified on the server and the offline copy.
- **Unread first** as "not every message in the conversation is read"
  (`allInThreadHaveKeyword`) is refused as a sort; it is not in the account's
  list of supported sorts (`emailQuerySortOptions`).
- **Unread first** does work as
  `{"property": "hasKeyword", "keyword": "$seen", "isAscending": true}`,
  because with conversations collapsed the server sorts messages first and
  then keeps each conversation's first message. An older unread message under
  a newer read reply still pulls the conversation up. Verified with test
  messages covering every mix of pinned, unread, and an unread message under
  a read reply, in both orders (pinned then unread, unread then pinned), on
  the server and the offline copy.

### Limits of the unread sort

- It only counts unread messages **inside the listed mailbox**. 18 of 259
  Inbox conversations have a received message outside the Inbox; it only
  matters if that message is the unread one.
- The group is chosen **per message**: a conversation shows in the earliest
  group any of its Inbox messages belongs to, and the unread sort only sees
  messages in that group. 11 of 259 Inbox conversations have Inbox messages
  with different labels. Example: an older message labelled Projects + MMV
  and a newer reply with no label shows in MMV through the labelled message;
  if the reply were the unread one, the conversation would not move up.
  Tiers do not have this gap, because their unread condition covers the whole
  conversation.
- The row then shows the **unread message's date**, not the newest reply's.
  Fastmail's row takes its date from the row's message
  (`MailboxItemView.redrawDate` reads `content.receivedAt`); the bold unread
  style and the pin come from the whole conversation.
- In the Labels (all) preset the unread priority adds nothing: its first
  group, "Unread = is:unread", already takes every unread conversation.

## Proposed fix (not decided)

1. **Leave empty labels out** of Labels (root) and Labels (all). Check how
   the groups get recalculated when a label gains its first message, or that
   message lands in its parent's group or Other until something else
   refreshes the groups.
2. **Pinned priority becomes a sort** inside groups instead of a tier.
   Labels (all) with Pinned then needs 22 groups instead of 45.
3. **Unread priority**: either a sort (with the gaps above) or keep it as a
   tier (whole-conversation, but costs groups). Open question for the user.
4. **Any other priority search** keeps its tier. If the groups would still
   exceed 32, drop tiers from the last groups first, so the list never goes
   blank.
5. Optional: switch Fastmail's offline mail on by default in the iPhone and
   iPad apps, the way it is on for the Mac. Costs storage and a first sync.

## Where things are in the code

`Userscript/fastmail-custom-mode.user.js` (line numbers as of commit
9b0f981):

- `labelsInside` 2371, `rootLabelGroups` 2388, `allLabelGroups` 2391,
  `expandLabels` 2404: turn the Labels rows into one group per label.
- `splitsFor` 2513, `priorityFilterFor` 2535: have Fastmail parse searches
  into conditions.
- `priorityTiers` 2591, `withPriorityTwins` 2639, `patchSplits` 2669: build
  the tiers.
- `adoptList` 2808, `foldPriorityTiers` 2875: fold a tiered group as one.
- `patchPriorityLayout` 2993: draw tiers under one heading.

Moving pinned (and perhaps unread) to a sort would make most of the tier
code unnecessary for those priorities. Fastmail builds the list query's sort
inside the mail controller's `mailboxMessageList` property from `splits` and
the last sort field. That code is identical in the desktop and phone builds,
so the extra sort entry has to be added where that query is created.

Fastmail shows the empty-mailbox message when the list's `length` is 0 and
its `queryLength` is missing or 0.

## How it was tested

- **Page probes:** JavaScript run inside the Mac apps with
  `osascript -e 'tell application "nexthealth.nl" to do JavaScript …'`.
  The iPhone app cannot be probed this way; `idevicesyslog -n -u <iPhone id>`
  shows the iPhone's system log (native code only, not page JavaScript).
- **Asking the server directly:** `fetch(FastMail.auth.get('apiUrl'), …)`
  with `credentials: 'include'` and
  `Authorization: 'Bearer ' + FastMail.auth.get('accessToken')`. Without
  `credentials` the server answers 401.
- **Asking the offline copy:** `FastMail.callJMAPMethod('Email/query', …)`
  in the Mac app. It answers locally when the copy is complete, so it is not
  a server test. Groups including an empty label tell the two apart.
- **Test messages:** `Email/set` create in the work account with `$seen`
  set and `receivedAt` a few hours back, so neither the push server nor the
  Mac notifications fire; wait ~45 s; then mark them unread with
  `keywords/$seen: null`. Delete afterwards by subject. All test messages
  from this session are deleted.

## Other open items from the same session

- **Mac notification fallback** (commit b9e40d4) works: verified in the work
  app, the Mac notification appeared 2 s after Fastmail's worker announced
  the message. Fastmail's own **mail notification setting in the work app
  is Off** (switched off between 23:07 and 23:55 on 16 September, not by our
  code). Turn it on in Settings → Notifications to get notifications.
- **Fastmail notification bug** to report (not in a file yet): their
  `sw-desktop.js` builds the sender's photo URL from `type`, but contact
  photos carry `mediaType`, so the lookup throws and the notification is
  silently dropped for any sender whose contact has a photo. Still present
  on app.fastmail.com and app.beta.fastmail.com on 16 September.
- **Keep in the message right-click menu** (commit fa830c5): still to confirm
  by hand that the menu closes after pressing Keep in a window that is in
  front.
- **iOS notifications:** opening the app clears its delivered notifications
  (verified on the iPhone, including a fresh launch). Reading a message
  elsewhere does not clear them. That would need a silent push on read
  (throttled by iOS, not delivered to a force-quit app) or a notification
  service extension with Apple's filtering entitlement.
- **iPhone and iPad apps** were reinstalled on 17 September from the working
  copy, which included another session's uncommitted sidebar-count change
  (off by default).
