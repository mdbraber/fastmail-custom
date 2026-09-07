# iOS Push Notifications — Design

Date: 2026-09-07
Status: Approved

## Goal

New-mail notifications on the iPhone and iPad for both shell apps, delivered while the app is in the background or closed, with the app icon's badge kept correct at the same time. Tapping a notification opens the message.

The 2026-08-11 design listed push notifications as a non-goal because a `WKWebView` has no web push and the app was to hold no Fastmail credential. This design keeps the second half: the app still holds no credential. A small server holds a read-only API token per account, watches the mailbox over JMAP, and sends the notification through Apple Push Notification service (APNs). The phone only ever receives.

## Non-goals

Notifications on macOS (the page hands its own to `NotificationPresenter` there, and that stays). Removing a delivered notification when the message is read or archived elsewhere; delivered notifications are cleared when the app comes to the front. Message previews in the banner. Per-label or per-sender rules beyond "landed in the Inbox". Calendar or contact notifications. App Store distribution or production APNs (the builds are development-signed, so the sandbox APNs host is used; switching is one setting).

## Facts the design rests on

1. **A `WKWebView` cannot receive web push**, and the page only runs while the app is in front. Only APNs can wake a backgrounded iOS app with a banner, and only something outside the phone can send an APNs push.
2. **The signing team can use APNs.** The apps are signed by the team in `Config/Local.xcconfig` with a one-year wildcard provisioning profile, which only a paid Developer Program membership issues. Push needs an explicit App ID with the Push Notifications capability; Xcode's automatic signing creates both when it sees the `aps-environment` entitlement. The one manual step is creating an APNs authentication key in the developer portal.
3. **The builds are development-signed** (`get-task-allow` is true), so their `aps-environment` is `development` and pushes must go to `api.sandbox.push.apple.com`.
4. **Fastmail's JMAP** is at `https://api.fastmail.com/jmap/session` with a bearer API token created under Settings → Privacy & Security → Manage API tokens; a token scoped to `urn:ietf:params:jmap:mail` read-only suffices. Change notices come either through a push subscription (`PushSubscription/set`, RFC 8620 §7.2, Fastmail calling a URL of ours) or through the session's `eventSourceUrl`. Whether Fastmail grants push subscriptions to API tokens is not documented; the first implementation task settles it, and the server supports both.
5. **A thread's address** in the web app is `https://app.fastmail.com/mail/Inbox/<threadId>`, with the JMAP `threadId` used as is; each app is logged into one account, and Fastmail adds its own `u=` on arrival. `AppShell.handle(url)` already loads such an address into the web view through `LinkRouter`.
6. **The badge** the apps show is the number of conversations carrying the badge label (`Triage` by default) — that label's mailbox `totalThreads` in JMAP. The page's own badge counts the same way, and a count of messages would jump every time the app came to the front.
7. **A tapped push is rehosted** to the selected backend before it is routed: the payload names `app.fastmail.com`, and the web view, the bridge and the injected scripts are all keyed to the server the setting chose.

## Architecture

```
Fastmail JMAP ──(state change notice)──▶ fastmail-push (Docker, on the user's host)
      ▲                                        │
      └──── Email/changes, Email/get, ─────────┤
            Mailbox/get                        ▼
                                         APNs (sandbox)
                                               │
                                               ▼
                                   mdbraber.com / nexthealth.nl on iOS
                                   (registers its device token with
                                    fastmail-push at every launch)
```

One server process serves both accounts. Each account is a `personal` or `work` block of configuration: the Fastmail token, the app's bundle identifier (the APNs topic), and the badge label name.

## Repository layout

The server lives in the app repository, in `Server/`, because the push payload and the app that reads it change together:

```
Server/
  Dockerfile              node:22-alpine, copies src/, runs node src/main.js
  compose.yml             one service, env_file .env, volume ./data:/data, port 8080
  .env.example            every variable, with placeholders
  package.json            "type": "module", no dependencies, "test": "node --test"
  src/
    main.js               wiring: config → accounts → watchers → http server
    config.js             reads and validates the environment
    jmap.js               session, method calls, changes, push subscription, event source
    watcher.js            per-account loop: notices → new Inbox mail + badge count → pushes
    notify.js             pure: which emails notify, and the payload for each
    apns.js               HTTP/2 client, ES256 token, per-token send, error → prune
    devices.js            the device registry on disk
    state.js              per-account state on disk (Email state, notified ids, last badge)
    http.js               /devices, /jmap/<account>/<secret>, /healthz
  test/                   node --test files, one per pure module, with fixtures
```

The app side stays in its places: `Apps/*/iOS.entitlements`, `project.yml`, `Config/*.xcconfig`, `Apps/*/Info.plist`, and one new file in the package, `PushRegistrar.swift`.

## Server

### Configuration (environment)

| Variable | Meaning |
| --- | --- |
| `FASTMAIL_TOKEN_PERSONAL`, `FASTMAIL_TOKEN_WORK` | API tokens. An account whose token is empty is skipped. |
| `APNS_KEY_FILE` | path to the `.p8` key inside the container (mounted from `./secrets`) |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | from the developer portal; the team is the `DEVELOPMENT_TEAM` in `Config/Local.xcconfig` |
| `APNS_SANDBOX` | `1` (default) for development-signed builds, `0` for production |
| `PUBLIC_URL` | the `https://` address the reverse proxy exposes, for the push subscription callback |
| `DEVICE_SECRET` | bearer secret the apps present when registering a device token |
| `BADGE_LABEL` | default `Triage` |
| `NOTICES` | `auto` (default: push subscription, event source if refused), `push`, or `eventsource` |
| `DATA_DIR` | default `/data` |
| `PORT` | default `8080` |

Bundle identifiers are fixed in code: `com.mdbraber.fastmail.personal` and `com.mdbraber.fastmail.work`.

### Startup, per account

1. `GET /jmap/session` with the bearer token → `apiUrl`, `eventSourceUrl`, and the mail account id from `primaryAccounts`.
2. `Mailbox/get` → the Inbox (role `inbox`) and the badge label (name equals `BADGE_LABEL`; missing means badge pushes are skipped, logged once).
3. Load `/data/state-<account>.json`: `{ emailState, notified: [emailId…], badge }`. Absent or unusable state means a resync: take the current `Email` state and treat everything already there as seen, so a fresh start never notifies for old mail.
4. Subscribe to change notices, types `Email` and `Mailbox`:
   - **Push subscription** (preferred): `PushSubscription/set` creating `{ deviceClientId, url: PUBLIC_URL + "/jmap/<account>/<secret>", types, expires }`. Fastmail then POSTs `{ "@type": "PushVerification", "pushSubscriptionId", "verificationCode" }` to the URL; the server answers with `PushSubscription/set` updating `verificationCode`. That POST can arrive before the create has returned the id it names, so a verification for an unknown id is held and used as soon as the id is known. Subscriptions are renewed before `expires`, and recreated on startup if the stored id is gone.
   - **Event source** (fallback, chosen automatically when the create is refused, or forced by `NOTICES=eventsource`): a long-lived `GET eventSourceUrl?types=Email,Mailbox&closeafter=no&ping=300`, reconnecting with backoff.
   - Either way, a poll every 5 minutes runs the same handler, so a missed notice costs at most 5 minutes.

The `<secret>` in the callback path is random per start and is only used to ignore posts that are not Fastmail's; a spoofed notice could at most trigger a JMAP read.

### On a notice

1. `Email/changes` since `emailState` (looping on `hasMoreChanges`) → the created ids, and the new state. More than 500 created ids means the server was away long enough that the backlog is not news: it is treated as lost, resynced silently, and nothing is announced.
2. `Email/get` on the created ids with properties `id, threadId, mailboxIds, keywords, from, subject, receivedAt`, in chunks of 500 so the call stays inside Fastmail's `maxObjectsInGet`.
3. Keep an email when: it is in the Inbox (`mailboxIds[inboxId]`), it is not `$seen` and not `$draft`, and its id is not in `notified`.
4. `Mailbox/get` on the badge label → `totalThreads` is the badge.
5. For each kept email, an alert push (below). Then, if the badge differs from the stored one and no alert carried it, a badge-only push. Badge-only pushes are coalesced: notices within two seconds produce one.
6. Store the new `emailState`, the notified ids (capped at the most recent 500), and the badge.

A `cannotCalculateChanges` error triggers the resync of step 3 above, silently.

### Payload

```json
{
  "aps": {
    "alert": { "title": "<sender display name, or address>", "body": "<subject, or (no subject)>" },
    "sound": "default",
    "badge": 3,
    "thread-id": "<threadId>"
  },
  "url": "https://app.fastmail.com/mail/Inbox/<threadId>",
  "emailId": "<emailId>"
}
```

A badge-only push is `{ "aps": { "badge": 3 } }`. Both are sent with `apns-push-type: alert`, `apns-priority: 10`, `apns-topic: <bundle id>`, `apns-collapse-id: <emailId>` for alerts, and `apns-expiration` one day out.

### APNs client

One HTTP/2 session per host, reconnected on close. Requests carry `authorization: bearer <jwt>`, where the JWT is ES256 over `{ "alg": "ES256", "kid": KEY_ID }` / `{ "iss": TEAM_ID, "iat": now }`, minted with `crypto.sign` and reused for 50 minutes. On `403` with `ExpiredProviderToken` or `InvalidProviderToken` the token is minted afresh and the request retried once. On `400 BadDeviceToken` or `410 Unregistered` the device is removed from the registry. Other failures are logged with the reason and dropped; nothing is retried across restarts.

### Device registry

`/data/devices.json`: `{ "personal": { "<token>": { "registeredAt" } }, "work": { … } }`. `POST /devices` with `Authorization: Bearer <DEVICE_SECRET>` and body `{ "account": "personal" | "work", "token": "<hex>" }` upserts; anything else is `401` or `400`. A push to an account goes to every token registered for it, so the iPhone and the iPad both get it.

### HTTP endpoints

| Route | Purpose |
| --- | --- |
| `POST /devices` | device token registration, bearer-protected |
| `POST /jmap/<account>/<secret>` | Fastmail's verification and state-change notices; wrong secret → `204` and ignored |
| `GET /healthz` | `200` with `{ accounts: { personal: { notices: "push" \| "eventsource", lastNotice, devices } … } }` |

Everything else is `404`. TLS is the reverse proxy's job.

## Apps

### Entitlement and build settings

- `Apps/Personal/iOS.entitlements` and `Apps/Work/iOS.entitlements`: `aps-environment` = `development`.
- `project.yml`: per target, `"CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]": Apps/Personal/iOS.entitlements` (and `Apps/Work/iOS.entitlements`), so macOS builds carry no entitlement and keep signing as they do now.
- `Config/Shared.xcconfig` gains empty `PUSH_SERVER_HOST` and `PUSH_DEVICE_SECRET`; `Config/Local.xcconfig` (git-ignored) holds the real values; `Config/Local.xcconfig.example` documents them. A host rather than a URL because `//` starts a comment in an xcconfig; the app puts `https://` in front (a path after the host is allowed).
- `Apps/*/Info.plist` gain `FMPushHost` = `$(PUSH_SERVER_HOST)` and `FMPushSecret` = `$(PUSH_DEVICE_SECRET)`. Empty or unsubstituted values mean push is off, exactly as `FMAccountID` degrades today.

### `PushRegistrar` (iOS only, in FastmailShellKit)

Installed from each `App` struct through `@UIApplicationDelegateAdaptor`; on macOS the adaptor is compiled out and nothing changes.

- **Permission**: asks once for `[.alert, .sound, .badge]`. On iOS all asking moves here; `BadgeController` only reads the status and applies the badge as before. iOS does not re-prompt for options added after the first answer, so a device that already answered the badge-only prompt needs Alerts switched on under Settings → Notifications → the app, or the app deleted and reinstalled.
- **Token**: after permission, `registerForRemoteNotifications()`; `didRegisterForRemoteNotificationsWithDeviceToken` hex-encodes the token and `POST`s `{ account, token }` to `https://<FMPushHost>/devices` with the bearer secret. Sent at every launch and on every activation where the last attempt failed; a failure is logged, never shown.
- **Presentation**: as `UNUserNotificationCenterDelegate`, `willPresent` (which iOS only calls while the app is in front, where the page is on screen) returns `[.badge]`: the badge applies, no banner or sound. On becoming active, `removeAllDeliveredNotifications()`.
- **Tap**: `didReceive` reads `url` from `userInfo`, and hands it to `AppShell` through a small `@MainActor` observable, `PendingLinks.shared`, which `AppShell` observes and routes through the same `handle(url)` that `onOpenURL` uses. Only `https://app.fastmail.com` URLs pass `LinkRouter`, so a bad payload can at most show the "Only Fastmail links can be opened" banner.
- **No config**: with `FMPushHost` empty, the registrar asks for permission and applies badges but registers nothing.

## Setup checklist (one-time, by hand)

1. Developer portal → Keys → new key with Apple Push Notifications service enabled → download the `.p8`, note the Key ID.
2. Fastmail, both accounts → Settings → Privacy & Security → Manage API tokens → new token, mail read-only.
3. On the host: `Server/.env` from `.env.example`, the `.p8` in `Server/secrets/`, `docker compose up -d`; the reverse proxy forwards `PUBLIC_URL` to port 8080. `GET /healthz` reports both accounts.
4. `Config/Local.xcconfig`: `PUSH_SERVER_HOST` and `PUSH_DEVICE_SECRET` (the same value as the server's `DEVICE_SECRET`).
5. `make deploy`. The first build with the entitlement makes Xcode register the App IDs and the capability.

## Failure handling

| Situation | Behaviour |
| --- | --- |
| Fastmail refuses `PushSubscription/set` | fall back to the event source for that account; `/healthz` says so |
| Fastmail token invalid (`401`) | log loudly, retry the session every 10 minutes, keep serving the other account |
| Notice arrives with an unknown or wrong secret | ignored |
| `cannotCalculateChanges` | resync: take the current state, mark nothing as new |
| APNs token rejected | mint anew, retry once |
| Device token dead | removed from the registry |
| State file unreadable | resync, as on first start; devices file unreadable → empty registry, logged |
| Server unreachable from the phone | registration retried on the next activation |
| Payload without a usable `url` | tap opens the app, nothing else |

## Testing

- **Server** (`node --test`, fixtures in `test/fixtures/`): `notify.js` — which created emails notify (Inbox, unseen, not draft, not already notified) and the exact payload for one; `apns.js` — the JWT's header and claims, its signature verified with the key's public half, and the error-to-prune mapping; `devices.js` and `state.js` — round trips and the notified-ids cap; `http.js` — the three routes against an in-process server, including the wrong-secret and wrong-bearer cases; `watcher.js` — one notice against a fake JMAP producing one alert push and one badge push, and the coalescing.
- **Apps** (Swift Testing): `PendingLinks` delivering a URL once; the URL extraction from `userInfo` including the missing case; the presentation decision by scene activity; the config-absent case of the registrar.
- **Build**: `make test` (the package tests, the integration tests, and now `node --test` in `Server/`) and `make build-ios`, as today.
- **End to end**, by hand: app closed, mail sent to the account → banner within seconds; archive it on the Mac → the badge drops; tap a banner → the thread opens; the iPad, once unlocked, gets the same banner.

## Rollout order

1. Verify with a real token whether `PushSubscription/set` is granted (a 20-line script); that decides the default notice source.
2. Server complete and green under `node --test`; running on the host with `/healthz` up and the push subscription verified (or the stream connected).
3. APNs key and secrets in place.
4. App changes built, `make build-ios` green, deployed to the iPhone.
5. End-to-end checks above.
