# fastmail-push

New-mail pushes for the shell apps on iOS. A read-only Fastmail token per
account lives here, never on the phone; the service watches each mailbox
over JMAP and sends an APNs alert for every message that lands in the
Inbox, with the number of conversations carrying the Triage label as the
badge. Design and payload contract:
`docs/superpowers/specs/2026-09-07-ios-push-notifications-design.md`.

## One-time setup

1. **APNs key** — developer portal → Certificates, Identifiers & Profiles →
   Keys → +, tick *Apple Push Notifications service (APNs)*, download the
   `.p8` (only offered once), note the Key ID. Put the file in `secrets/`.
2. **Fastmail tokens** — in each account: Settings → Privacy & Security →
   Manage API tokens → New API token, scope *Mail*, read-only.
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
   `lastNotice` and `devices`. If `verified` stays `false` for more than
   a minute, `docker compose restart`: the subscription is recreated at
   every start.
6. **Apps** — add `PUSH_SERVER_HOST` (the host, no `https://`) and
   `PUSH_DEVICE_SECRET` to `Config/Local.xcconfig`, then `make deploy`.
   On the first launch the app asks for notification permission and
   registers its device token; `healthz` shows `devices` counting up.

A device that already answered the old badge-only prompt is not asked
again: turn Alerts on under Settings → Notifications → the app, or delete
and reinstall the app.

## Running the tests

`npm test` in this directory, or `make test` at the repo root.
