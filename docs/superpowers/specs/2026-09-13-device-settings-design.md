# Device settings and Notifications pages on iPhone and iPad — design

Date: 2026-09-13. Replaces the in-app settings sheet (`MobileSettingsSheet`)
and the iOS Settings bundle. The Mac apps, the Safari extension and Custom
mode's own settings page are not changed.

## Why

The official Fastmail app for iOS has two pages that the shell lacks:

- **Device settings.** A native page that has:
  - a Face ID lock
  - "Remember last viewed page"
  - "Use in-app browser for external links"
  - the version
  - "Show Advanced Settings", which leads to a Backend page with a
    debugging switch
- **Notifications.** A page with four boxed choices for new messages: Off,
  Important messages only, All in inbox, and Custom.

The shell has only a sheet with a backend picker and a start page field. Its
one notification choice ("Notify for new mail", on or off) lives in the iOS
Settings app. On iPhone and iPad, both pages should look and work like the
official app's, without the official page's Calendar alerts section.

## Measured

These facts were read from the running Mac app, from Fastmail's mobile code
(fetched, never run), and from this repository on 2026-09-13.

- **Fastmail's own native hooks cannot be used.**
  - Fastmail offers its Device entry and its native Notifications hooks
    (`showDeviceSettings`, `showNotificationSettings`, `getPushConfig`) only
    when `FM.isApp` is true.
  - Its check is `FM.isApp && (window.app[name] ||
    webkit.messageHandlers[name])`.
  - In the shell `FM.isApp` is false, so providing handlers with those names
    changes nothing.
- **The official Notifications page is Fastmail's own web page.**
  - It is `NotificationsPaneView` in `settings-notifications.mod.js`, drawn
    in full only when `FM.isApp` is true.
  - The four choices are a `RadioGroupView` of type `v-RadioGroup--boxed`,
    with the Cancelled, VIP, Inbox and settings-gear icons.
  - Custom reveals two extra controls:
    - a "who" select: everyone, contacts, or VIPs, stored as `pinned`
    - a mailbox list with an add button
  - It also has a sound select, a Calendar alerts section, and "The push id
    for your device is …" with a `CopyTextView`.
  - Every change is sent to Fastmail's `PushSubscription/registerDevice`,
    which delivers only to Fastmail's own app. Fastmail's "Important" sends
    `filterMailboxIds: null` and `filterOnlyContacts: "vips"`.
- **What the shell shows today.** Settings → Notifications in the shell shows
  only Fastmail's App Store and Google Play badges.
- **Components the userscript can reach.** In `FastMail.classes` in the Mac
  app, with mail open, these classes are reachable:
  - `RadioGroupView`, `RadioBlocksView`, `RadioView`
  - `SwitchView`, `ToggleView`, `CheckboxView`
  - `CopyTextView`
  - `PageView`, `PageHeaderView`, `SettingsPaneView`, `PreferencesPaneView`
  - `PushSelectView`, `SelectView`

  The mailbox list's own classes (`ListInputView`, `MailboxMenuView`) were
  not listed.
- **VIPs and followed conversations.**
  - Fastmail keeps VIPs as a contact card with `kind: "group"` and
    `uid: "vips"` in the primary contacts account.
  - A followed conversation carries the `$followed` keyword on its messages.
- **The push server** (`Server/`):
  - **Registration:** a device registers with `POST /devices`
    `{account, token, alerts}`. `alerts` is true or false, and a missing
    value means true.
  - **What it alerts for:** a new message in the Inbox that is not
    `$seen`, not `$draft`, and not already announced.
  - **Muted devices:** devices with alerts off get only badge updates.
  - **What it reads from Fastmail:** it fetches `id, threadId, mailboxIds,
    keywords, from, subject, receivedAt`, and subscribes to changes of the
    types `Email` and `Mailbox`.
- **The push server's Fastmail tokens.**
  - Both tokens, Personal and Work, grant only
    `urn:ietf:params:jmap:core` and `urn:ietf:params:jmap:mail`. They do not
    grant contacts.
  - The server's host uses the same tokens as `Server/.env` on the
    development Mac; the two hashes match.
- **The shell today.**
  - **The settings row.** `harness.js` clones the Custom swipes row into a
    "Device settings" row, placed just before Offline, and skips it under
    the Electron user agent (the Mac).
    - Custom swipes is Fastmail's `actions` entry, which the official app
      places its Device entry after.
    - The userscript puts Custom mode directly after it, so the row already
      sits where the official app puts Device, following Custom mode.
  - **The sheet.** The row sends `openSettings`, which raises
    `MobileSettingsSheet`.
  - **The iOS Settings bundle.**
    - `tools/gen-settings-bundle.py` (`make settings-bundle`) generates it.
    - `SettingsBundleTests.swift` guards it.
    - It holds three keys: `backend` (default `beta`), `startView`, and
      `push.alerts` (default true).
  - **The last page** is held in memory only (`WebCoordinator.lastURL`).
  - **External links** open with `UIApplication.shared.open`.
  - **Web Inspector.** Web views are always inspectable (`WebContainer.swift`,
    `ComposePool.swift`).
  - **Not yet in the shell.** There is no `LocalAuthentication`, no
    `SFSafariViewController`, and no `NSFaceIDUsageDescription`.
  - **Info.plist** is checked in per app, and the version comes from
    `CFBundleShortVersionString` and `CFBundleVersion`.
  - **The native bridge** takes `{action, payload}` messages and can return a
    value to the page.

## Decisions

These were made with the user on 2026-09-13.

- **Scope:** the official layout plus the new features: Face ID lock,
  in-app browser, and remote debugging switch.
- **Platforms:** iPhone and iPad. The Mac keeps its Settings window.
- **Start page:** both "Remember last viewed page" and Start page are on
  the Device settings page. The Start page applies when remembering is off.
- **Face ID timing:** "after being away a bit". The app asks at launch and
  after more than a minute in the background, with the passcode as the
  fallback.
- **Where the settings live:** both pages are in the app, like the
  official app's, and they leave the iOS Settings app.
- **Notifications page:** like the official page, without the Calendar
  part.
- **Notification choices:** all four work, and the push server learns each
  device's choice.
- **VIPs and contacts:** the user creates new Fastmail tokens with read-only
  Contacts, and the server reads VIPs and contacts itself.
- **How the Notifications page is built:** from Fastmail's own components,
  by the userscript, as the Custom mode page is.

## Part 1: the Device settings page

### Reaching it

- **The row.** The "Device settings" row keeps its place, between Custom
  mode and Offline. Tapping it opens the new page instead of the sheet.
- **How the page opens.** It enters from the right edge over the whole
  screen, on both iPhone and iPad. It has the title "Device settings" and a
  back arrow at the top left, which returns to Fastmail's Settings the same
  way.
- **The Backend page** is pushed within the page and has its own back arrow.
  The usual left-edge swipe works there.
- **While the page is open,** the web view underneath stays loaded.

### The main page

The page uses grouped rows in the style of iOS settings, in this order:

1. **Screen lock**
   - A switch named after what the device offers: "Face ID", "Touch ID" or
     "Passcode".
   - It is off by default.
   - Footer: "Require authentication when opening the app".
2. **The page the app opens.** A group with two rows:
   - "Remember last viewed page": a switch, off by default.
   - "Start page": a text field with a path, such as `/mail/Inbox`.
     - Footer: "Used when Remember last viewed page is off. Empty opens
       Fastmail's default view."
     - The text is resolved by the existing `StartView.resolve`.
3. **"Use in-app browser for external links"**: a switch, on by default.
4. **"Version"**: shows `CFBundleShortVersionString (CFBundleVersion)`, for
   example "1.0 (1)".
5. **"Show Advanced Settings"**: a row with a chevron that opens the Backend
   page.

Every change saves at once. There is no Done or Save button.

### The Backend page

- **"Server backend".** Two rows: Production with `app.fastmail.com`
  underneath, and Beta with `app.beta.fastmail.com`. A checkmark marks the
  one in use.
  - Choosing the other backend saves it, and the app reloads on that server
    as it does today; the web container is keyed on the backend.
  - The footer keeps today's warning that Beta has its own sign-in and
    settings.
- **"Debugging".** An "Enable remote debugging" switch, on by default.
  - It sets `isInspectable` on the main web view and on the compose web
    views.
  - A change applies at once to the views that are open and to every view
    made later.
  - Off means Safari's Web Inspector cannot attach.
  - On the Mac, web views stay inspectable as today.

### The screen lock

- **Turning it on** asks for authentication once, with
  `LAPolicy.deviceOwnerAuthentication`, so that Face ID or Touch ID can fall
  back to the passcode.
  - The switch stays on only if that succeeds.
  - On a device with no passcode, the switch cannot turn on. The footer then
    says a passcode must be set first.
- **When the app asks.** While the lock is on, the app asks:
  - at launch
  - when it returns to the front after more than 60 seconds in the
    background
- **Covering the content.** An opaque cover, with the app's name and an
  "Unlock" button, hides the content:
  - while the app asks
  - whenever the app is not in front, so the app switcher's snapshot shows
    no mail
- **Returning within 60 seconds** removes the cover without asking.
- **If authentication fails or is cancelled,** the cover stays. "Unlock"
  asks again.
- **If the device's passcode was removed** after the lock was turned on, the
  lock cannot ask. The app then opens, and the switch turns off.
- **Links waiting behind the lock.** A notification tapped, a shortcut, or
  a link handed to the app while it is locked waits and is opened after
  unlocking.
- **The Info.plist** of both apps gains `NSFaceIDUsageDescription`: "Unlock
  your mail with Face ID."

### Remembering the page

- **Saving the page.** While the switch is on, the app saves the path of
  the page the main web view shows each time it changes. It saves:
  - only addresses on a known Fastmail host
  - only the path, the query and the fragment, not the host
  - nothing from compose windows, the login page or the in-app browser
- **Opening at launch.** The app opens, in this order:
  1. a link it was launched with, as today
  2. otherwise the saved path, if the switch is on and a path is saved
  3. otherwise the Start page
  4. otherwise Fastmail's default view
- **The backend.** A saved path is put on the current backend, so switching
  backends keeps the page.
- **Turning the switch off** deletes the saved path.

### The in-app browser

- **When the switch is on:**
  - `http` and `https` links that the navigation policy sends outside the
    app open in an `SFSafariViewController`, which has its own Done button.
  - Links that open the other account's app, and `mailto`, `tel`,
    `facetime`, `webcal` and other schemes, still go to the system as today.
  - Downloads are unchanged.
- **When the switch is off,** every external link opens with
  `UIApplication.shared.open`, as today.

### Leaving the iOS Settings app

- **Removed for both apps:**
  - the Settings bundle
  - its generator (`tools/gen-settings-bundle.py`)
  - the `settings-bundle` Makefile target
  - the `EXCLUDED_SOURCE_FILE_NAMES` entry in `project.yml`
  - `SettingsBundleTests.swift`
- **Kept.** `backend` and `startView` keep their keys, so the saved values
  carry over.
- **Moved.** `push.alerts` moves to the Notifications choice (Part 3).
- **Replaced.** `MobileSettingsSheet` and the sheet in `AppShell` are
  replaced by the new page. The `openSettings` message opens the new page.

## Part 2: the push server's filters

### Registration

- **The request.** `POST /devices` accepts a new optional field `notify`:

  ```json
  { "mode": "custom", "senders": "vips", "mailboxIds": ["P2F", "P3V"] }
  ```

- **The fields:**
  - `mode` is one of `off`, `important`, `inbox` or `custom`, and is
    required when `notify` is present.
  - `senders` is one of `everyone`, `contacts` or `vips`. It defaults to
    `everyone` and is read only for `custom`.
  - `mailboxIds` is an array of up to 200 non-empty strings, read only for
    `custom`.
  - An empty `mailboxIds` array with `custom` matches nothing.
- **Validation.** Anything else answers 400 with an error naming the field.
- **Older app builds.** A request without `notify` uses `alerts` as today:
  true, or no value, means `inbox`, and false means `off`. When both fields
  are present, `notify` wins.
- **The device registry** stores `{registeredAt, notify}`. A record from
  before this change, carrying `alerts`, reads as `inbox` or `off`.
- **The reply** is `{ ok: true, notify, contacts }`. `contacts` is true
  when the account's token can read contacts.

### Which messages alert which device

A message is considered once, when it is new, and only if it is not `$seen`,
not `$draft`, and not already announced. Those rules are today's. Each device
then matches it against its own choice:

- **`off`:** never.
- **`inbox`:** the message is in the Inbox (today's rule).
- **`important`:** either condition matches.
  - The message is not in the mailbox with role `junk` or `trash`, and its
    sender is a VIP.
  - Or the conversation is followed: the message itself, or another message
    in its thread, carries `$followed`.
- **`custom`:** both conditions must hold.
  - The message is in at least one of `mailboxIds`.
  - Its sender matches `senders`:
    - `everyone`: any sender
    - `contacts`: a contact
    - `vips`: a VIP
- **The sender** is the first `from` address, compared without regard to
  case.

The rule is one pure function in `Server/src/notify.js`. It takes the choice,
the message, and a context:

- the Inbox, Junk and Trash mailbox ids
- the set of VIP addresses
- the set of contact addresses
- the ids of followed threads

**Followed threads** are looked up with `Thread/get` and `Email/get
keywords`, for the threads of the new messages only. The lookup happens only
when some device on the account has `important`.

### Sending

- **Alerts.** For each device, every new message its choice matches is sent
  as an alert, with today's payload, badge and buttons.
- **Badge updates.** A device that got no alert in a batch gets a badge-only
  push when the badge count changed, which is today's muted behaviour.
- **Which messages count as announced** stays per account, as today.
- **The link that opens the message** stays `threadURL`. The plan checks
  that `/mail/Inbox/<thread>.<email>` opens a message that is not in the
  Inbox. If it does not, the link for such a message names a mailbox it is
  in instead:
  - for Custom, the first chosen label the message is in
  - otherwise, the first of its mailboxes by id

### Contacts and VIPs

- **The source.** With a token that grants `urn:ietf:params:jmap:contacts`,
  the server reads every contact card of the primary contacts account with
  `ContactCard/get`.
- **The two address sets** are kept in memory:
  - **Contact addresses:** every address on a card whose `kind` is not
    `group`.
  - **VIP addresses:** the addresses on the cards named in the `members` of
    the card with `kind: "group"` and `uid: "vips"`.
- **When the sets are read:**
  - at start-up
  - whenever Fastmail reports a `ContactCard` change
- **Change notices.** `ContactCard` is added to the subscribed change types
  only when the token grants contacts. Otherwise the subscription would ask
  for a type it may not have.
- **Without contacts access:**
  - both sets are empty
  - the VIP and contact rules match nobody
  - `/healthz` reports `contacts: false` for the account
  - registrations reply with `contacts: false`

### Health report

For each account, `/healthz` gains two fields:

- `contacts` (true or false)
- `modes`, the count of devices per choice

`muted` stays, as the count of devices with `off`.

### Tokens and roll-out

1. The user creates two Fastmail API tokens, Personal and Work, with Mail
   access plus read-only Contacts.
2. The tokens replace `FASTMAIL_TOKEN_PERSONAL` and `FASTMAIL_TOKEN_WORK` in
   `Server/.env` on the development Mac and in the server's `.env` on its
   host.
3. The server is redeployed only on the user's go-ahead, with the existing
   update steps.

Neither the host name nor the tokens appear in tracked files.

## Part 3: the Notifications page

### Where it appears

- **The page.** On iPhone and iPad, the userscript registers its own page
  under Fastmail's `notifications` view id. It is built with the machinery
  of the Custom mode page:
  - the page classes
  - the header with Fastmail's back arrow when there is no sidebar
  - the sidebar highlight
- **When it replaces Fastmail's page.** Only when `window.native.notifications`
  exists.
  - The harness, which already provides `window.native` (the userscript
    uses its `setSetting` and `setBadge`), adds that object on iPhone and
    iPad only, never under the Electron user agent.
  - The object has three functions, each backed by one bridge message
    below:
    - `state()`, which returns a promise
    - `set(choice)`
    - `openSettings()`
- **Safari and the Mac apps** keep Fastmail's own page.
- **If registering fails** for any reason, Fastmail's own page stays, and
  the fault is reported the way the Custom mode page reports faults.

### What it shows

From top to bottom:

1. **A permission warning,** in Fastmail's warning banner style.
   - It shows when iOS does not allow notifications for the app and the
     choice is not Off.
   - Text: "Notifications are turned off for this app in iOS Settings."
   - A button, "Open Settings", opens the app's page in the iOS Settings
     app.
2. **A contacts warning,** in the same style.
   - It shows when the last registration reply said `contacts: false` and
     the choice needs contacts: Important, or Custom with Contacts or VIPs.
   - Text: "The push server cannot read your contacts, so VIPs and contacts
     get no notifications."
3. **The heading "New messages",** then the boxed choices with Fastmail's
   icons:
   - **Off**, with the Cancelled icon: "Don't show a notification for any
     message on this device."
   - **Important messages only**, with the VIP icon: "Show a notification
     for messages from your VIP contacts, and replies to conversations you
     are following."
   - **All in inbox**, with the Inbox icon: "Show a notification for
     everything that arrives in your inbox."
   - **Custom**, with the settings icon: "Choose senders and labels to
     notify for."
4. **When Custom is chosen,** two extra controls:
   - A "Notify for messages from" select: Everyone, Contacts or VIPs.
   - The label list: the chosen labels, each with a remove button, and an
     "Add label" button that opens a menu of the account's labels.
     - The first time Custom is chosen, the list starts with the Inbox and
       the sender choice starts at Everyone.
     - The list is built from Fastmail's own list and mailbox menu classes
       where the userscript can reach them. Otherwise it is built from
       reachable parts (`PushSelectView` or `SelectView` for the menu) with
       the same look.
5. **"The push id for your device is …",** in small unimportant text.
   - It shows the first 8 characters of the device's push token.
   - A copy button copies the whole token.
   - The line is absent while the app has no token.

The page has no sound select and no Calendar alerts section.

### How a choice travels

- **Opening the page.** The page calls `window.native.notifications.state()`.
  That sends the bridge message `notificationState` and resolves to the
  app's reply:

  ```json
  { "mode": "inbox", "senders": "everyone", "mailboxIds": [],
    "permission": "allowed", "pushToken": "…", "contacts": true }
  ```

  - `permission` is `allowed`, `denied` or `undetermined`.
  - `pushToken` and `contacts` are null while unknown.
- **Staying current.** The page asks again whenever the window regains
  focus, so a permission granted in iOS Settings clears the warning.
- **Changing a choice.** The page calls `set({mode, senders, mailboxIds})`,
  which sends `setNotifications`. The app does two things:
  - It saves the choice in its own defaults: `push.mode`, `push.senders`
    and `push.mailboxIds`. Personal and Work each keep their own.
  - It registers again, through the registrar's existing single-flight
    registration.
- **Registration state.** "Registration due" compares the acknowledged
  choice with the saved one, as it does today for the switch. A failed
  registration is retried on the next activation.
- **The contacts flag.** The registrar saves `contacts` from each reply for
  `notificationState`.
- **Opening iOS Settings.** `openSettings()` sends
  `openNotificationSettings`, which opens the app's page in the iOS Settings
  app.
- **The old switch.** The first time the app runs with this change and
  `push.mode` is absent, it sets `push.mode` from `push.alerts`: false
  becomes `off`, and true or absent becomes `inbox`.
- **Fastmail's own preferences** (`notificationsMail`,
  `notificationsMailboxes`, `notificationsFilter` and the rest) are never
  written.

## What goes and what stays

- **Goes:**
  - `MobileSettingsSheet`
  - the Settings bundles, their generator, their Makefile target, their
    `project.yml` entry and their tests
  - the `push.alerts` key after migration (read once, then no longer
    written)
  - the always-on `isInspectable`
- **Changes:**
  - the harness row's click
  - `SettingsPresenter`, which now drives the new page
  - `PushConfig.registration`, which sends `notify`
  - `PushPreferences`, which holds the choice
  - `WebCoordinator`'s external-link opener and its saving of the last page
  - `AppShell`: the page overlay, the lock cover, and the launch address
  - the push server's registry, HTTP handler, rules, watcher and health
    report
- **Stays:**
  - the Mac Settings window and the Mac apps' behaviour
  - the Safari extension
  - Custom mode's settings page
  - notification buttons, alert text and badge logic
  - `StartView.resolve`
  - `Backend`

## Stages

Each stage is tested on its own:

1. **Device settings page.** App only.
2. **Push server filters.** Server only. It deploys and works before the new
   tokens exist, reporting `contacts: false` until they do.
3. **Notifications page.** Userscript, harness and app. It depends on stage
   2 being deployed for Important and Custom to have any effect.

## Testing

- **`make test` stays green.** It runs the Swift package tests, the
  integration tests, `npm test` in `Server/`, and syntax checks of the
  userscript and extension.
- **Server tests** (`node --test`):
  - The rule function: each mode; each sender option; Junk and Trash
    excluded for Important; followed thread by the message's own keyword
    and by another message's keyword; an empty Custom label list; an
    uppercase sender.
  - Registration: a valid `notify`; each invalid field; `alerts` alone, true
    and false; both fields present; the reply carrying `contacts`.
  - Registry: an old `alerts` record reads as `inbox` or `off`.
  - Watcher:
    - per-device alerts
    - badge-only for devices without a match
    - the contact sets built from cards and the VIPs group
    - `ContactCard` subscribed only with contacts access
    - no thread lookup when no device has Important
  - Health: `contacts` and `modes`.
- **Swift tests:**
  - migration from `push.alerts`
  - the registration body carrying `notify`
  - "registration due" for a changed choice
  - the lock rule: ask at launch; ask after more than 60 seconds; do not
    ask at 60 seconds or less
  - saving the last page: only known Fastmail hosts, path kept, other hosts
    and the login page refused
  - the launch address order
  - the external-link decision with the switch on and off, per scheme
  - the version text
- **Live checks on the Mac app, with read-only probes:**
  - the Notifications page drawn with a stand-in bridge
  - the page not registered without the bridge
  - Fastmail's own notification preferences unchanged after choosing each
    option on the stand-in
  - the app returned to mail at the end
- **On the user's iPhone and iPad:**
  - the Device settings page, back arrow, Backend page and checkmark
  - the lock at launch, after a minute away, and within a minute
  - the in-app browser
  - the last page remembered
  - the Notifications page's four choices reaching the server (checked in
    `/healthz` `modes`)
  - an alert per choice

## Out of scope

- **Leaving Fastmail's page untouched:** Calendar alerts, notification
  sounds, per-choice notification buttons, and privacy mode.
- **The Mac:** its Settings window and notifications.
- **Elsewhere:** Safari, and Android.
- **Closing gesture:** swiping from the left edge to close the main Device
  settings page. The back arrow closes it.
- **Pushed alerts' look:** changes to the text or grouping of alerts.
