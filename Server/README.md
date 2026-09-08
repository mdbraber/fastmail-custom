# fastmail-push

New-mail pushes for the shell apps on iOS. A Fastmail token per account
lives here, never on the phone; the service watches each mailbox over JMAP
and sends an APNs alert for every message that lands in the Inbox, with the
number of conversations carrying the Triage label as the badge. Design and
payload contract:
`docs/superpowers/specs/2026-09-07-ios-push-notifications-design.md`.

## The buttons on a notification

Pulling a banner down shows Archive, Later and Pin. The phone holds no
Fastmail credentials, so it posts the verb and the message id to `/actions`
with the same device secret it registers with, and the work happens here.
Each verb means what it means in the app: archiving takes the message out
of the Inbox, off the triage label and off its project label, unpins it and
leaves any hold label on; Later files it under the first `HOLD_LABELS`
name, replacing the triage and project labels but keeping the Inbox; Pin
flags it and moves nothing. Labels are read fresh on every press, and the
ones hidden from Fastmail's folder list — the history shelves — are never
touched. A press that fails says so on the phone rather than going quiet,
so the tokens have to be able to write.

## One-time setup

1. **APNs key** — developer portal → Certificates, Identifiers & Profiles →
   Keys → +, tick *Apple Push Notifications service (APNs)*, download the
   `.p8` (only offered once), note the Key ID. Put the file in `secrets/`.
2. **Fastmail tokens** — in each account: Settings → Privacy & Security →
   Manage API tokens → New API token, scope *Mail*. Not read-only: the
   buttons on a notification write, and a read-only token fails them with
   `accountReadOnly` at the moment you press one.
3. **Configure** — `cp .env.example .env` and fill it in. `DEVICE_SECRET`
   is any long random string (`openssl rand -hex 32`); the same value goes
   into the app repo's `Config/Local.xcconfig` as `PUSH_DEVICE_SECRET`.
   `APNS_TEAM_ID` is the `DEVELOPMENT_TEAM` from that same file.
4. **Run** — `docker compose up -d --build`. Put the reverse proxy in front
   of `127.0.0.1:8080` at the address you gave as `PUBLIC_URL`; Fastmail
   calls back there over HTTPS.
5. **Check** — `curl "$PUBLIC_URL/healthz"` lists each account with
   `notices` (`"push"`, or `"eventsource"` if Fastmail refused the push
   subscription for an API token; either works, push is quicker),
   `verified` (true once Fastmail's verification round-trip is done),
   `lastNotice`, `devices` and `muted`. A muted device turned alerts off in
   the Settings app and still gets the badge. If `verified` stays `false`
   for more than a minute, run `docker compose restart`; the subscription
   is recreated at every start.
6. **Apps** — add `PUSH_SERVER_HOST` (the host, no `https://`) and
   `PUSH_DEVICE_SECRET` to `Config/Local.xcconfig`, then `make deploy`.
   On the first launch the app asks for notification permission and
   registers its device token; `healthz` shows `devices` counting up.

A device that already answered the old badge-only prompt is not asked
again: turn Alerts on under Settings → Notifications → the app, or delete
and reinstall the app.

## Running the tests

`npm test` in this directory, or `make test` at the repo root.
