# iOS Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New-mail banners on the iPhone and iPad for both shell apps while they are closed, the badge kept correct at the same time, and a tap that opens the message — driven by a small self-hosted server, with no Fastmail credential on the phone.

**Architecture:** A zero-dependency Node.js service in `Server/` holds a read-only Fastmail API token per account, subscribes to Fastmail's JMAP change notices (push subscription, or the event source stream when that is refused), turns each new Inbox message into an APNs alert carrying sender, subject, the badge label's count and the thread's URL, and sends it to every device token the apps registered. In the apps, an iOS-only `PushRegistrar` (a `UIApplicationDelegate` adaptor) asks permission, registers the token with the server, and hands a tapped notification's URL to `AppShell` through `PendingLinks`, where the existing `LinkRouter` path loads it. Pure logic on both sides — selection, payloads, token minting, config parsing, URL extraction — sits in plain functions with plain tests.

**Tech Stack:** Node.js 22 ESM (`node:http2`, `node:crypto`, `fetch`, `node --test`), Docker Compose, Swift 6 / SwiftUI / UserNotifications, Swift Testing, XcodeGen.

**Spec:** `docs/superpowers/specs/2026-09-07-ios-push-notifications-design.md`

## Global Constraints

- The app holds no Fastmail credential. The only secret it carries is the device-registration bearer, from the git-ignored `Config/Local.xcconfig`.
- No token, secret, team identifier, account identifier or hostname of the user's in any tracked file. Real values live in `Config/Local.xcconfig` and `Server/.env`, both git-ignored; tracked examples carry placeholders.
- Server: Node.js 22, ESM (`"type": "module"`), **no runtime dependencies**; tests with `node --test`, no framework.
- Apps: Swift 6 strict concurrency, no third-party dependencies; every iOS-only file is wrapped in `#if canImport(UIKit)`; macOS builds carry no push entitlement and are otherwise unchanged.
- Payload contract, exact: `aps.alert.title`, `aps.alert.body`, `aps.sound`, `aps.badge` (omitted when unknown), `aps["thread-id"]`, plus top-level `url` and `emailId`. A badge-only push is `{ "aps": { "badge": n } }`.
- Bundle identifiers: `com.mdbraber.fastmail.personal`, `com.mdbraber.fastmail.work`. Account names: `personal`, `work`.
- Thread URL: `https://app.fastmail.com/mail/Inbox/<threadId>` — no `u=`.
- Comments follow the house style in `Packages/FastmailShellKit`: a short paragraph where a decision is not obvious from the code, none where it is.
- Every commit message ends with the two trailer lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01D2hi638PLX5BJPQswRaE6r
  ```
- Never push. Never run `make deploy` (it relaunches the user's Mac apps and installs on their devices); Task 12 is the user's.
- Verification commands: `cd Server && node --test` for the server; `make test` for the package (runs on macOS); `make build-ios` for anything under `#if canImport(UIKit)`, which `make test` never compiles.

## File structure

```
Server/
  package.json          identity, "type": "module", scripts start/test
  .env.example          every variable with a placeholder
  Dockerfile            node:22-alpine, src/ only
  compose.yml           one service, env_file, /data and /secrets volumes
  README.md             one-time setup checklist
  src/
    config.js           environment → frozen config, fails loudly
    notify.js           pure: which emails notify, and the payloads
    state.js            per-account state on disk (atomic writes)
    devices.js          device token registry on disk, token validation
    apns.js             ES256 provider token, HTTP/2 client, outcome mapping
    jmap.js             session, calls, change log, push subscriptions, event source
    watcher.js          per-account loop: notices → pushes → remembered
    http.js             /devices, /jmap/<account>/<secret>, /healthz
    main.js             wiring and shutdown
  test/
    config.test.js  notify.test.js  state.test.js  devices.test.js
    apns.test.js    jmap.test.js    watcher.test.js  http.test.js

Apps/Personal/iOS.entitlements, Apps/Work/iOS.entitlements   aps-environment
Apps/Personal/Info.plist, Apps/Work/Info.plist               FMPushHost, FMPushSecret
Apps/Personal/PersonalApp.swift, Apps/Work/WorkApp.swift     the delegate adaptor
project.yml                                                  CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]
Config/Shared.xcconfig, Config/Local.xcconfig.example         PUSH_SERVER_HOST, PUSH_DEVICE_SECRET
Makefile                                                     server tests under `test`
.gitignore                                                   Server/.env, secrets, data

Packages/FastmailShellKit/Sources/FastmailShellKit/
  PushConfig.swift      host + secret from Info.plist; the registration request
  PushPayload.swift     the url out of a notification's userInfo
  PendingLinks.swift    a link from outside the view tree, for AppShell
  PushRegistrar.swift   iOS: permission, token, presentation, tap  (#if canImport(UIKit))
  Profile.swift         configuredValue(_:) shared with PushConfig
  BadgeController.swift asking moves out; reapply stays
  AppShell.swift        observes PendingLinks; reapply() instead of prime()
Packages/FastmailShellKit/Tests/FastmailShellKitTests/
  PushConfigTests.swift  PushPayloadTests.swift  PendingLinksTests.swift  BadgeControllerTests.swift
```

---

### Task 1: Server scaffold and configuration

**Files:**
- Create: `Server/package.json`, `Server/.env.example`, `Server/src/config.js`, `Server/test/config.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `loadConfig(env) → { accounts: { [name]: { name, token, topic } }, apns: { keyFile, keyId, teamId, sandbox }, publicUrl, deviceSecret, badgeLabel, notices, dataDir, port }` and `BUNDLE_IDS`.

- [ ] **Step 1: Write the scaffold**

`Server/package.json`:

```json
{
  "name": "fastmail-push",
  "version": "1.0.0",
  "description": "New-mail pushes for the Fastmail shell apps on iOS",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node src/main.js",
    "test": "node --test"
  }
}
```

`Server/.env.example`:

```
# Fastmail API tokens (Settings → Privacy & Security → Manage API tokens;
# scope: mail, read-only). Leave one empty to skip that account.
FASTMAIL_TOKEN_PERSONAL=
FASTMAIL_TOKEN_WORK=

# The APNs auth key from the developer portal (Keys → +, tick "Apple Push
# Notifications service"), put in ./secrets, which compose mounts read-only.
APNS_KEY_FILE=/secrets/AuthKey_XXXXXXXXXX.p8
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=ABCDE12345

# 1 for builds Xcode installs (development-signed), 0 for TestFlight or App Store builds
APNS_SANDBOX=1

# Where the reverse proxy exposes this service; Fastmail calls back here
PUBLIC_URL=https://push.example.net

# Any long random string; the same value goes into Config/Local.xcconfig as PUSH_DEVICE_SECRET
DEVICE_SECRET=

# The label whose message count is the app badge
BADGE_LABEL=Triage

# auto (push subscription, event source if refused) | push | eventsource
NOTICES=auto
```

Append to `.gitignore`:

```
Server/.env
Server/secrets/
Server/data/
Server/node_modules/
```

- [ ] **Step 2: Write the failing test**

`Server/test/config.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, BUNDLE_IDS } from '../src/config.js';

const complete = {
    FASTMAIL_TOKEN_PERSONAL: 'fmu1-personal',
    APNS_KEY_FILE: '/secrets/AuthKey.p8',
    APNS_KEY_ID: 'ABC123DEFG',
    APNS_TEAM_ID: 'ABCDE12345',
    PUBLIC_URL: 'https://push.example.net/',
    DEVICE_SECRET: 'shared-secret',
};

test('a complete environment loads with the defaults filled in', () => {
    const config = loadConfig(complete);
    assert.deepEqual(Object.keys(config.accounts), ['personal']);
    assert.equal(config.accounts.personal.topic, BUNDLE_IDS.personal);
    assert.equal(config.accounts.personal.token, 'fmu1-personal');
    assert.equal(config.publicUrl, 'https://push.example.net');
    assert.equal(config.apns.sandbox, true);
    assert.equal(config.badgeLabel, 'Triage');
    assert.equal(config.notices, 'auto');
    assert.equal(config.dataDir, '/data');
    assert.equal(config.port, 8080);
});

test('both accounts load when both tokens are set', () => {
    const config = loadConfig({ ...complete, FASTMAIL_TOKEN_WORK: 'fmu1-work' });
    assert.deepEqual(Object.keys(config.accounts).sort(), ['personal', 'work']);
    assert.equal(config.accounts.work.topic, BUNDLE_IDS.work);
});

test('everything missing is named at once', () => {
    assert.throws(() => loadConfig({}), /FASTMAIL_TOKEN_PERSONAL or FASTMAIL_TOKEN_WORK/);
    assert.throws(() => loadConfig({}), /APNS_KEY_FILE.*APNS_KEY_ID.*APNS_TEAM_ID.*PUBLIC_URL.*DEVICE_SECRET/);
});

test('APNS_SANDBOX=0 selects production', () => {
    assert.equal(loadConfig({ ...complete, APNS_SANDBOX: '0' }).apns.sandbox, false);
});

test('an unknown NOTICES value and a bad PORT are refused', () => {
    assert.throws(() => loadConfig({ ...complete, NOTICES: 'carrier-pigeon' }), /NOTICES/);
    assert.throws(() => loadConfig({ ...complete, PORT: 'eighty' }), /PORT/);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd Server && node --test`
Expected: FAIL — `Cannot find module '.../src/config.js'`

- [ ] **Step 4: Write the implementation**

`Server/src/config.js`:

```js
// The environment, read once into one frozen object. Anything that cannot
// be defaulted stops the start: a server missing its key or its secret
// would otherwise come up and sit there quietly doing nothing.

export const BUNDLE_IDS = Object.freeze({
    personal: 'com.mdbraber.fastmail.personal',
    work: 'com.mdbraber.fastmail.work',
});

export const NOTICE_MODES = ['auto', 'push', 'eventsource'];

export function loadConfig(env = process.env) {
    const missing = [];
    const required = (key) => {
        const value = (env[key] || '').trim();
        if (!value) missing.push(key);
        return value;
    };

    const accounts = {};
    for (const [name, topic] of Object.entries(BUNDLE_IDS)) {
        const token = (env[`FASTMAIL_TOKEN_${name.toUpperCase()}`] || '').trim();
        if (token) accounts[name] = Object.freeze({ name, token, topic });
    }
    if (!Object.keys(accounts).length) missing.push('FASTMAIL_TOKEN_PERSONAL or FASTMAIL_TOKEN_WORK');

    const config = {
        accounts: Object.freeze(accounts),
        apns: Object.freeze({
            keyFile: required('APNS_KEY_FILE'),
            keyId: required('APNS_KEY_ID'),
            teamId: required('APNS_TEAM_ID'),
            sandbox: (env.APNS_SANDBOX ?? '1').trim() !== '0',
        }),
        publicUrl: required('PUBLIC_URL').replace(/\/+$/, ''),
        deviceSecret: required('DEVICE_SECRET'),
        badgeLabel: (env.BADGE_LABEL || 'Triage').trim(),
        notices: (env.NOTICES || 'auto').trim(),
        dataDir: (env.DATA_DIR || '/data').trim(),
        port: Number(env.PORT || 8080),
    };

    if (!NOTICE_MODES.includes(config.notices)) {
        throw new Error(`NOTICES must be one of ${NOTICE_MODES.join(', ')}, not "${config.notices}"`);
    }
    if (!Number.isInteger(config.port) || config.port <= 0) {
        throw new Error(`PORT must be a positive integer, not "${env.PORT}"`);
    }
    if (missing.length) throw new Error(`missing configuration: ${missing.join(', ')}`);
    return Object.freeze(config);
}
```

- [ ] **Step 5: Run the tests**

Run: `cd Server && node --test`
Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add Server/package.json Server/.env.example Server/src/config.js Server/test/config.test.js .gitignore
git commit -m "feat(server): scaffold fastmail-push and read its configuration"
```

---

### Task 2: Selection and payloads (`notify.js`)

**Files:**
- Create: `Server/src/notify.js`, `Server/test/notify.test.js`

**Interfaces:**
- Produces: `selectNotifiable(emails, { inboxId, notified: Set }) → emails`, `alertPayload(email, { badge }) → payload`, `badgePayload(badge) → payload`, `senderName(email)`, `threadURL(email)`. `email` is a JMAP Email with `id, threadId, mailboxIds, keywords, from, subject`.

- [ ] **Step 1: Write the failing test**

`Server/test/notify.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectNotifiable, senderName, alertPayload, badgePayload, threadURL } from '../src/notify.js';

const inbox = 'mbx-inbox';
const email = (over = {}) => ({
    id: 'M1',
    threadId: 'T1',
    mailboxIds: { [inbox]: true },
    keywords: {},
    from: [{ name: 'Ada Lovelace', email: 'ada@example.net' }],
    subject: 'Engines',
    receivedAt: '2026-09-07T10:00:00Z',
    ...over,
});

test('a fresh unseen message in the Inbox notifies', () => {
    const chosen = selectNotifiable([email()], { inboxId: inbox, notified: new Set() });
    assert.deepEqual(chosen.map((e) => e.id), ['M1']);
});

test('outside the Inbox, seen, draft, or already announced do not', () => {
    const candidates = [
        email({ id: 'filed', mailboxIds: { 'mbx-other': true } }),
        email({ id: 'seen', keywords: { $seen: true } }),
        email({ id: 'draft', keywords: { $draft: true } }),
        email({ id: 'done' }),
    ];
    assert.deepEqual(selectNotifiable(candidates, { inboxId: inbox, notified: new Set(['done']) }), []);
});

test('the sender name falls back to the address, then to a placeholder', () => {
    assert.equal(senderName(email()), 'Ada Lovelace');
    assert.equal(senderName(email({ from: [{ name: '  ', email: 'ada@example.net' }] })), 'ada@example.net');
    assert.equal(senderName(email({ from: [] })), 'Unknown sender');
    assert.equal(senderName(email({ from: null })), 'Unknown sender');
});

test('the alert payload carries title, body, badge, thread and the url to open', () => {
    assert.deepEqual(alertPayload(email(), { badge: 3 }), {
        aps: {
            alert: { title: 'Ada Lovelace', body: 'Engines' },
            sound: 'default',
            'thread-id': 'T1',
            badge: 3,
        },
        url: 'https://app.fastmail.com/mail/Inbox/T1',
        emailId: 'M1',
    });
});

test('an empty subject and an unknown badge are handled', () => {
    const payload = alertPayload(email({ subject: '  ' }), { badge: null });
    assert.equal(payload.aps.alert.body, '(no subject)');
    assert.equal('badge' in payload.aps, false);
});

test('a badge-only payload is just the number', () => {
    assert.deepEqual(badgePayload(0), { aps: { badge: 0 } });
});

test('thread ids are url-encoded', () => {
    assert.equal(threadURL({ threadId: 'T a/b' }), 'https://app.fastmail.com/mail/Inbox/T%20a%2Fb');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd Server && node --test`
Expected: FAIL — `Cannot find module '.../src/notify.js'`

- [ ] **Step 3: Write the implementation**

`Server/src/notify.js`:

```js
// Which of the emails a notice brought deserve a banner, and what it says.
// Pure: no clock, no network, so every rule here is a plain test.

export function selectNotifiable(emails, { inboxId, notified }) {
    return emails.filter((email) =>
        email.mailboxIds?.[inboxId] === true
        && !email.keywords?.$seen
        && !email.keywords?.$draft
        && !notified.has(email.id));
}

export function senderName(email) {
    const from = email.from?.[0];
    if (!from) return 'Unknown sender';
    return (from.name || '').trim() || from.email || 'Unknown sender';
}

export function threadURL(email) {
    return `https://app.fastmail.com/mail/Inbox/${encodeURIComponent(email.threadId)}`;
}

// The APNs payload for one new message. `badge` is the count to show, or
// null when there is no badge label to count.
export function alertPayload(email, { badge }) {
    const aps = {
        alert: {
            title: senderName(email),
            body: (email.subject || '').trim() || '(no subject)',
        },
        sound: 'default',
        'thread-id': email.threadId,
    };
    if (Number.isInteger(badge)) aps.badge = badge;
    return { aps, url: threadURL(email), emailId: email.id };
}

export function badgePayload(badge) {
    return { aps: { badge } };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd Server && node --test`
Expected: all passing (12).

- [ ] **Step 5: Commit**

```bash
git add Server/src/notify.js Server/test/notify.test.js
git commit -m "feat(server): choose which arrivals notify, and what the push says"
```

---

### Task 3: State and device registry on disk

**Files:**
- Create: `Server/src/state.js`, `Server/src/devices.js`, `Server/test/state.test.js`, `Server/test/devices.test.js`

**Interfaces:**
- Produces: `emptyState()`, `loadState(dataDir, account, log)`, `saveState(dataDir, account, state)`, `rememberNotified(state, ids)`, `NOTIFIED_CAP`; `class DeviceRegistry(file, log)` with `load()`, `tokens(account)`, `register(account, token)`, `remove(account, token)`; `isDeviceToken(value)`.

- [ ] **Step 1: Write the failing tests**

`Server/test/state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyState, loadState, saveState, rememberNotified, NOTIFIED_CAP } from '../src/state.js';

const silent = { warn() {}, info() {}, error() {} };
const scratch = () => mkdtemp(path.join(os.tmpdir(), 'state-'));

test('a missing file is an empty state', async () => {
    const dir = await scratch();
    assert.deepEqual(await loadState(dir, 'personal', silent), emptyState());
});

test('state round-trips through disk', async () => {
    const dir = await scratch();
    await saveState(dir, 'personal', { emailState: 's42', notified: ['M1', 'M2'], badge: 7 });
    assert.deepEqual(await loadState(dir, 'personal', silent), { emailState: 's42', notified: ['M1', 'M2'], badge: 7 });
    assert.equal(JSON.parse(await readFile(path.join(dir, 'state-personal.json'), 'utf8')).badge, 7);
});

test('an unreadable file starts over rather than crashing', async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, 'state-work.json'), '{ not json');
    assert.deepEqual(await loadState(dir, 'work', silent), emptyState());
});

test('remembered ids are appended once and capped', () => {
    const state = rememberNotified({ ...emptyState(), notified: ['M1'] }, ['M1', 'M2']);
    assert.deepEqual(state.notified, ['M1', 'M2']);
    const many = Array.from({ length: NOTIFIED_CAP + 10 }, (_, i) => `M${i}`);
    const capped = rememberNotified(emptyState(), many);
    assert.equal(capped.notified.length, NOTIFIED_CAP);
    assert.equal(capped.notified.at(-1), `M${NOTIFIED_CAP + 9}`);
});
```

`Server/test/devices.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeviceRegistry, isDeviceToken } from '../src/devices.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'a'.repeat(64);
const scratch = async () => path.join(await mkdtemp(path.join(os.tmpdir(), 'devices-')), 'devices.json');

test('a device token is hex of a plausible length', () => {
    assert.equal(isDeviceToken(token), true);
    assert.equal(isDeviceToken(token.toUpperCase()), true);
    assert.equal(isDeviceToken('abc'), false);
    assert.equal(isDeviceToken('z'.repeat(64)), false);
    assert.equal(isDeviceToken(42), false);
});

test('registrations persist, per account, and can be removed', async () => {
    const file = await scratch();
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    await registry.register('personal', token.toUpperCase());
    await registry.register('work', 'b'.repeat(64));

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.tokens('personal'), [token]);
    assert.deepEqual(again.tokens('work'), ['b'.repeat(64)]);
    assert.deepEqual(again.tokens('other'), []);

    await again.remove('personal', token);
    await again.remove('personal', token);
    assert.deepEqual(again.tokens('personal'), []);
});

test('an unreadable registry starts empty', async () => {
    const file = await scratch();
    await writeFile(file, '[[[');
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    assert.deepEqual(registry.tokens('personal'), []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd Server && node --test`
Expected: FAIL — the two modules are missing.

- [ ] **Step 3: Write the implementations**

`Server/src/state.js`:

```js
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// What an account remembers between runs: where in Fastmail's change log it
// is, which messages it already announced, and the last badge it sent.
// Written whole and renamed into place, so a crash mid-write leaves the
// old file rather than half of the new one.

export const NOTIFIED_CAP = 500;

export function emptyState() {
    return { emailState: null, notified: [], badge: null };
}

export async function loadState(dataDir, account, log = console) {
    try {
        const parsed = JSON.parse(await readFile(statePath(dataDir, account), 'utf8'));
        return {
            ...emptyState(),
            ...parsed,
            notified: Array.isArray(parsed.notified) ? parsed.notified.filter((id) => typeof id === 'string') : [],
        };
    } catch (error) {
        if (error.code !== 'ENOENT') log.warn(`[${account}] state unreadable (${error.message}); starting over`);
        return emptyState();
    }
}

export async function saveState(dataDir, account, state) {
    await mkdir(dataDir, { recursive: true });
    const file = statePath(dataDir, account);
    const trimmed = { ...state, notified: state.notified.slice(-NOTIFIED_CAP) };
    await writeFile(`${file}.tmp`, JSON.stringify(trimmed, null, 2));
    await rename(`${file}.tmp`, file);
}

export function rememberNotified(state, ids) {
    const fresh = ids.filter((id) => !state.notified.includes(id));
    return { ...state, notified: state.notified.concat(fresh).slice(-NOTIFIED_CAP) };
}

function statePath(dataDir, account) {
    return path.join(dataDir, `state-${account}.json`);
}
```

`Server/src/devices.js`:

```js
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Apple says not to assume a device token's length, only that it is hex.
const TOKEN = /^[0-9a-f]{32,512}$/i;

export function isDeviceToken(value) {
    return typeof value === 'string' && TOKEN.test(value);
}

// Every phone and tablet that asked for pushes, by account, on disk.
export class DeviceRegistry {
    constructor(file, log = console) {
        this.file = file;
        this.log = log;
        this.devices = {};
    }

    async load() {
        try {
            const parsed = JSON.parse(await readFile(this.file, 'utf8'));
            this.devices = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            if (error.code !== 'ENOENT') this.log.warn(`devices unreadable (${error.message}); starting empty`);
            this.devices = {};
        }
    }

    tokens(account) {
        return Object.keys(this.devices[account] || {});
    }

    async register(account, token) {
        (this.devices[account] ??= {})[token.toLowerCase()] = { registeredAt: new Date().toISOString() };
        await this.save();
    }

    async remove(account, token) {
        if (!this.devices[account]?.[token]) return;
        delete this.devices[account][token];
        await this.save();
    }

    async save() {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(this.devices, null, 2));
        await rename(`${this.file}.tmp`, this.file);
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd Server && node --test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add Server/src/state.js Server/src/devices.js Server/test/state.test.js Server/test/devices.test.js
git commit -m "feat(server): remember the change-log position and the devices on disk"
```

---

### Task 4: APNs client (`apns.js`)

**Files:**
- Create: `Server/src/apns.js`, `Server/test/apns.test.js`

**Interfaces:**
- Produces: `mintToken({ key, keyId, teamId, now })`, `deviceOutcome(status, reason) → 'keep' | 'remove'`, `tokenOutcome(status, reason) → 'keep' | 'remint'`, `class APNsClient({ key, keyId, teamId, sandbox, host, log })` with `send(deviceToken, payload, { topic, collapseId, expiration }) → { status, reason }` and `close()`. `HOSTS`, `TOKEN_LIFETIME_MS`.

- [ ] **Step 1: Write the failing test**

`Server/test/apns.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import { generateKeyPairSync, verify } from 'node:crypto';
import { APNsClient, mintToken, deviceOutcome, tokenOutcome, HOSTS } from '../src/apns.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const silent = { warn() {}, info() {}, error() {} };

test('the provider token is an ES256 JWT naming the key and the team', () => {
    const token = mintToken({ key: privateKey, keyId: 'KEY1234567', teamId: 'ABCDE12345', now: 1_800_000_000_000 });
    const [header, claims, signature] = token.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
    assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: 'ABCDE12345', iat: 1_800_000_000 });
    const valid = verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
    );
    assert.equal(valid, true);
});

test('a token is reused within its lifetime and minted afresh after it', () => {
    const client = new APNsClient({ key: pem, keyId: 'K', teamId: 'T', host: 'http://localhost:1', log: silent });
    const first = client.bearer(1_000_000);
    assert.equal(client.bearer(1_000_000 + 49 * 60 * 1000), first);
    assert.notEqual(client.bearer(1_000_000 + 51 * 60 * 1000), first);
});

test('sandbox and production pick their hosts', () => {
    assert.equal(new APNsClient({ key: pem, keyId: 'K', teamId: 'T', log: silent }).host, HOSTS.sandbox);
    assert.equal(new APNsClient({ key: pem, keyId: 'K', teamId: 'T', sandbox: false, log: silent }).host, HOSTS.production);
});

test('dead device tokens are removed, everything else kept', () => {
    assert.equal(deviceOutcome(410, 'Unregistered'), 'remove');
    assert.equal(deviceOutcome(400, 'BadDeviceToken'), 'remove');
    assert.equal(deviceOutcome(400, 'DeviceTokenNotForTopic'), 'remove');
    assert.equal(deviceOutcome(400, 'BadMessageId'), 'keep');
    assert.equal(deviceOutcome(200, null), 'keep');
    assert.equal(deviceOutcome(500, 'InternalServerError'), 'keep');
});

test('only a rejected provider token asks for a new one', () => {
    assert.equal(tokenOutcome(403, 'ExpiredProviderToken'), 'remint');
    assert.equal(tokenOutcome(403, 'InvalidProviderToken'), 'remint');
    assert.equal(tokenOutcome(403, 'MissingProviderToken'), 'keep');
    assert.equal(tokenOutcome(400, 'BadDeviceToken'), 'keep');
});

// A stand-in APNs: answers as told, in order, and records what it saw.
async function fakeAPNs(answers) {
    const seen = [];
    const server = http2.createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
            seen.push({
                path: request.headers[':path'],
                authorization: request.headers.authorization,
                topic: request.headers['apns-topic'],
                pushType: request.headers['apns-push-type'],
                collapseId: request.headers['apns-collapse-id'],
                body: JSON.parse(body),
            });
            const answer = answers.shift() || { status: 200 };
            response.writeHead(answer.status, { 'content-type': 'application/json' });
            response.end(answer.reason ? JSON.stringify({ reason: answer.reason }) : '');
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        seen,
        host: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

test('send posts the payload with topic and collapse id and reports the answer', async () => {
    const apns = await fakeAPNs([{ status: 400, reason: 'BadDeviceToken' }]);
    const client = new APNsClient({ key: pem, keyId: 'K', teamId: 'T', host: apns.host, log: silent });
    const result = await client.send('abc123', { aps: { badge: 2 } }, { topic: 'com.example.app', collapseId: 'M1' });
    assert.deepEqual(result, { status: 400, reason: 'BadDeviceToken' });
    assert.equal(apns.seen[0].path, '/3/device/abc123');
    assert.equal(apns.seen[0].topic, 'com.example.app');
    assert.equal(apns.seen[0].pushType, 'alert');
    assert.equal(apns.seen[0].collapseId, 'M1');
    assert.deepEqual(apns.seen[0].body, { aps: { badge: 2 } });
    assert.match(apns.seen[0].authorization, /^bearer /);
    client.close();
    await apns.close();
});

test('an expired provider token is minted again and the push retried once', async () => {
    const apns = await fakeAPNs([{ status: 403, reason: 'ExpiredProviderToken' }, { status: 200 }]);
    const client = new APNsClient({ key: pem, keyId: 'K', teamId: 'T', host: apns.host, log: silent });
    const result = await client.send('abc123', { aps: { badge: 1 } }, { topic: 'com.example.app' });
    assert.deepEqual(result, { status: 200, reason: null });
    assert.equal(apns.seen.length, 2);
    assert.notEqual(apns.seen[0].authorization, apns.seen[1].authorization);
    client.close();
    await apns.close();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd Server && node --test`
Expected: FAIL — `Cannot find module '.../src/apns.js'`

- [ ] **Step 3: Write the implementation**

`Server/src/apns.js`:

```js
import http2 from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';

// Apple Push Notification service over HTTP/2 with token-based auth: a
// short-lived ES256 JWT signed with the .p8 key from the developer portal.
// One session per process, reopened when it closes.

export const HOSTS = Object.freeze({
    sandbox: 'https://api.sandbox.push.apple.com',
    production: 'https://api.push.apple.com',
});

// Apple wants the token younger than an hour and not minted more often
// than every twenty minutes; fifty minutes sits between the two.
export const TOKEN_LIFETIME_MS = 50 * 60 * 1000;

const base64url = (text) => Buffer.from(text).toString('base64url');

export function mintToken({ key, keyId, teamId, now = Date.now() }) {
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
    const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
    // JWT wants the raw r||s signature, not the DER that sign() gives by default
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
    return `${header}.${claims}.${signature.toString('base64url')}`;
}

// After APNs answers for one device: keep it, or forget it for good.
export function deviceOutcome(status, reason) {
    if (status === 410) return 'remove';
    if (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) return 'remove';
    return 'keep';
}

// After APNs answers about our own credentials: mint a fresh token, or not.
export function tokenOutcome(status, reason) {
    return status === 403 && (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') ? 'remint' : 'keep';
}

export class APNsClient {
    constructor({ key, keyId, teamId, sandbox = true, host, log = console }) {
        this.privateKey = createPrivateKey(key);
        this.keyId = keyId;
        this.teamId = teamId;
        this.host = host || (sandbox ? HOSTS.sandbox : HOSTS.production);
        this.log = log;
        this.token = null;
        this.tokenAt = 0;
        this.session = null;
    }

    bearer(now = Date.now()) {
        if (!this.token || now - this.tokenAt > TOKEN_LIFETIME_MS) {
            this.token = mintToken({ key: this.privateKey, keyId: this.keyId, teamId: this.teamId, now });
            this.tokenAt = now;
        }
        return this.token;
    }

    connect() {
        if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
        const session = http2.connect(this.host);
        session.on('error', (error) => this.log.warn(`apns session: ${error.message}`));
        session.on('close', () => { if (this.session === session) this.session = null; });
        this.session = session;
        return session;
    }

    close() {
        this.session?.close();
        this.session = null;
    }

    // One request. Resolves with APNs's answer whatever it is; rejects only
    // when the request never got one.
    request(deviceToken, payload, headers) {
        return new Promise((resolve, reject) => {
            const stream = this.connect().request({
                ':method': 'POST',
                ':path': `/3/device/${deviceToken}`,
                authorization: `bearer ${this.bearer()}`,
                'content-type': 'application/json',
                ...headers,
            });
            let status = 0;
            let body = '';
            stream.setEncoding('utf8');
            stream.on('response', (responseHeaders) => { status = responseHeaders[':status']; });
            stream.on('data', (chunk) => { body += chunk; });
            stream.on('end', () => {
                let reason = null;
                try { reason = body ? (JSON.parse(body).reason ?? null) : null; } catch { reason = null; }
                resolve({ status, reason });
            });
            stream.on('error', reject);
            stream.end(JSON.stringify(payload));
        });
    }

    async send(deviceToken, payload, { topic, collapseId = null, expiration = null }) {
        const headers = {
            'apns-topic': topic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-expiration': String(expiration ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60),
        };
        if (collapseId) headers['apns-collapse-id'] = collapseId;
        let result = await this.request(deviceToken, payload, headers);
        if (tokenOutcome(result.status, result.reason) === 'remint') {
            this.token = null;
            result = await this.request(deviceToken, payload, headers);
        }
        return result;
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd Server && node --test`
Expected: all passing. (The fake APNs speaks cleartext HTTP/2; `http2.connect` accepts an `http://` host for that.)

- [ ] **Step 5: Commit**

```bash
git add Server/src/apns.js Server/test/apns.test.js
git commit -m "feat(server): talk to APNs over HTTP/2 with a minted provider token"
```

---

### Task 5: JMAP client, push subscriptions and the event source (`jmap.js`)

**Files:**
- Create: `Server/src/jmap.js`, `Server/test/jmap.test.js`

**Interfaces:**
- Produces: `class JMAPClient({ token, fetch, sessionUrl })` with `connect()`, `accountId`, `apiUrl`, `eventSourceUrl`, `headers()`, `fetch`, `call(method, args, using)`, `mailboxes()`, `mailboxTotal(id)`, `emailState()`, `emailChanges(sinceState) → { created, newState }`, `emails(ids)`, `pushSubscriptions()`, `createPushSubscription({ deviceClientId, url, types, expires }) → { id, expires }`, `verifyPushSubscription(id, code)`, `destroyPushSubscription(id)`; `class JMAPError` with `.status` and `.type`; `eventSourceURL(template, { types, closeafter, ping })`; `class EventStreamParser` with `feed(text) → [{ event, data }]`; `runEventSource({ url, headers, onStateChange, signal, fetch, log })`.

- [ ] **Step 1: Write the failing test**

`Server/test/jmap.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JMAPClient, JMAPError, eventSourceURL, EventStreamParser, runEventSource } from '../src/jmap.js';

const silent = { warn() {}, info() {}, error() {} };

const session = {
    apiUrl: 'https://api.example.net/jmap/api/',
    eventSourceUrl: 'https://api.example.net/jmap/event/',
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acc1' },
};

// A stand-in for fetch: answers by method name, records every call.
function fakeFetch(answer) {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url: String(url), headers: init.headers, body });
        if (String(url).endsWith('/session')) return { ok: true, status: 200, json: async () => session };
        const responses = body.methodCalls.map(([method, args, id]) => {
            const [name, result] = answer(method, args, calls);
            return [name, result, id];
        });
        return { ok: true, status: 200, json: async () => ({ methodResponses: responses }) };
    };
    return { fetch, calls };
}

async function connected(answer) {
    const { fetch, calls } = fakeFetch(answer);
    const client = new JMAPClient({ token: 'tok', fetch });
    await client.connect();
    return { client, calls };
}

test('the session names the mail account and the api', async () => {
    const { client, calls } = await connected(() => ['error', {}]);
    assert.equal(client.accountId, 'acc1');
    assert.equal(client.apiUrl, session.apiUrl);
    assert.equal(client.eventSourceUrl, session.eventSourceUrl);
    assert.equal(calls[0].headers.authorization, 'Bearer tok');
});

test('a refused session is an error with its status', async () => {
    const client = new JMAPClient({ token: 'bad', fetch: async () => ({ ok: false, status: 401 }) });
    await assert.rejects(client.connect(), (error) => error instanceof JMAPError && error.status === 401);
});

test('call unwraps one response and turns a JMAP error into a JMAPError with its type', async () => {
    const { client } = await connected((method) => method === 'Email/get'
        ? ['Email/get', { state: 's9', list: [] }]
        : ['error', { type: 'cannotCalculateChanges', description: 'too old' }]);
    assert.equal(await client.emailState(), 's9');
    await assert.rejects(client.emailChanges('s0'), (error) => error.type === 'cannotCalculateChanges' && /too old/.test(error.message));
});

test('emailChanges follows the log to its end', async () => {
    let page = 0;
    const { client, calls } = await connected((method, args) => {
        page += 1;
        return ['Email/changes', page === 1
            ? { created: ['M1'], updated: [], destroyed: [], newState: 's1', hasMoreChanges: true }
            : { created: ['M2'], updated: [], destroyed: [], newState: 's2', hasMoreChanges: false }];
    });
    assert.deepEqual(await client.emailChanges('s0'), { created: ['M1', 'M2'], newState: 's2' });
    assert.equal(calls.at(-2).body.methodCalls[0][1].sinceState, 's0');
    assert.equal(calls.at(-1).body.methodCalls[0][1].sinceState, 's1');
});

test('emails asks for exactly the properties the payload needs, and nothing for no ids', async () => {
    const { client, calls } = await connected((method, args) => ['Email/get', { list: args.ids.map((id) => ({ id })) }]);
    assert.deepEqual(await client.emails([]), []);
    assert.deepEqual(await client.emails(['M1']), [{ id: 'M1' }]);
    assert.deepEqual(calls.at(-1).body.methodCalls[0][1].properties, ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'subject', 'receivedAt']);
});

test('a push subscription is created without an account id, verified, or refused with the reason', async () => {
    const { client, calls } = await connected((method, args) => {
        if (args.update) return ['PushSubscription/set', { updated: { ps1: null } }];
        if (args.create?.sub.url === 'https://x/y') {
            return ['PushSubscription/set', { created: { sub: { id: 'ps1', expires: '2026-09-08T00:00:00Z' } } }];
        }
        return ['PushSubscription/set', { notCreated: { sub: { type: 'forbidden', description: 'no push for tokens' } } }];
    });
    const created = await client.createPushSubscription({ deviceClientId: 'd', url: 'https://x/y', types: ['Email'], expires: '2026-09-14T00:00:00Z' });
    assert.deepEqual(created, { id: 'ps1', expires: '2026-09-08T00:00:00Z' });
    assert.deepEqual(calls.at(-1).body.using, ['urn:ietf:params:jmap:core']);
    assert.equal('accountId' in calls.at(-1).body.methodCalls[0][1], false);

    await client.verifyPushSubscription('ps1', 'code');
    assert.deepEqual(calls.at(-1).body.methodCalls[0][1], { update: { ps1: { verificationCode: 'code' } } });

    await assert.rejects(
        client.createPushSubscription({ deviceClientId: 'd', url: 'https://x/z', types: ['Email'], expires: null }),
        /forbidden.*no push for tokens/,
    );
});

test('the event source url takes the three parameters either way', () => {
    assert.equal(
        eventSourceURL('https://api.example.net/jmap/event/{types}/{closeafter}/{ping}', { types: ['Email', 'Mailbox'] }),
        'https://api.example.net/jmap/event/Email%2CMailbox/no/300',
    );
    assert.equal(
        eventSourceURL('https://api.example.net/jmap/event/', { types: ['Email'], ping: 60 }),
        'https://api.example.net/jmap/event/?types=Email&closeafter=no&ping=60',
    );
});

test('the stream parser handles split chunks, CRLF, comments and multi-line data', () => {
    const parser = new EventStreamParser();
    assert.deepEqual(parser.feed('event: state\r\ndata: {"a":'), []);
    assert.deepEqual(parser.feed('1}\r\n\r\n: ping\n\ndata: x\ndata: y\n\n'), [
        { event: 'state', data: '{"a":1}' },
        { event: 'message', data: 'x\ny' },
    ]);
});

test('runEventSource hands every state event over and stops when aborted', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('event: state\ndata: {"@type":"StateChange","changed":{"acc1":{"Email":"s1"}}}\n\n'));
            controller.close();
        },
    });
    const received = [];
    const abort = new AbortController();
    let requests = 0;
    await runEventSource({
        url: 'https://api.example.net/jmap/event/?types=Email',
        headers: { authorization: 'Bearer tok' },
        onStateChange: (change) => { received.push(change); abort.abort(); },
        signal: abort.signal,
        fetch: async () => { requests += 1; return { ok: true, status: 200, body }; },
        log: silent,
    });
    assert.equal(requests, 1);
    assert.deepEqual(received, [{ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } }]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd Server && node --test`
Expected: FAIL — `Cannot find module '.../src/jmap.js'`

- [ ] **Step 3: Write the implementation**

`Server/src/jmap.js`:

```js
// Fastmail's JMAP, the little of it this needs: the session, method calls,
// the change log, push subscriptions, and the event source stream.

export const SESSION_URL = 'https://api.fastmail.com/jmap/session';
export const CORE = 'urn:ietf:params:jmap:core';
export const MAIL = 'urn:ietf:params:jmap:mail';
export const EMAIL_PROPERTIES = ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'subject', 'receivedAt'];

export class JMAPError extends Error {
    constructor(message, { status = 0, type = null } = {}) {
        super(message);
        this.name = 'JMAPError';
        this.status = status;
        this.type = type;
    }
}

export class JMAPClient {
    constructor({ token, fetch: fetchImpl = globalThis.fetch, sessionUrl = SESSION_URL }) {
        this.token = token;
        this.fetch = fetchImpl;
        this.sessionUrl = sessionUrl;
        this.session = null;
        this.accountId = null;
    }

    headers() {
        return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json' };
    }

    get apiUrl() { return this.session?.apiUrl; }
    get eventSourceUrl() { return this.session?.eventSourceUrl; }

    async connect() {
        const response = await this.fetch(this.sessionUrl, { headers: this.headers() });
        if (!response.ok) throw new JMAPError(`session: HTTP ${response.status}`, { status: response.status });
        this.session = await response.json();
        this.accountId = this.session.primaryAccounts?.[MAIL] ?? null;
        if (!this.accountId) throw new JMAPError('session: no mail account');
        return this.session;
    }

    async request(methodCalls, using = [CORE, MAIL]) {
        const response = await this.fetch(this.apiUrl, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ using, methodCalls }),
        });
        if (!response.ok) throw new JMAPError(`api: HTTP ${response.status}`, { status: response.status });
        return (await response.json()).methodResponses;
    }

    // One method call, unwrapped: its arguments back, or a JMAPError
    // carrying the error type for the caller to recognise.
    async call(method, args, using) {
        const [[name, result]] = await this.request([[method, args, 'c0']], using);
        if (name === 'error') {
            const detail = result.description ? ` — ${result.description}` : '';
            throw new JMAPError(`${method}: ${result.type}${detail}`, { type: result.type });
        }
        return result;
    }

    async mailboxes() {
        const result = await this.call('Mailbox/get', {
            accountId: this.accountId, ids: null, properties: ['id', 'name', 'role', 'totalEmails'],
        });
        return result.list;
    }

    async mailboxTotal(id) {
        const result = await this.call('Mailbox/get', { accountId: this.accountId, ids: [id], properties: ['totalEmails'] });
        return result.list[0]?.totalEmails ?? null;
    }

    async emailState() {
        return (await this.call('Email/get', { accountId: this.accountId, ids: [] })).state;
    }

    // Every id created since `sinceState`, following the log to its end.
    async emailChanges(sinceState) {
        const created = [];
        let state = sinceState;
        for (;;) {
            const result = await this.call('Email/changes', { accountId: this.accountId, sinceState: state, maxChanges: 500 });
            created.push(...result.created);
            state = result.newState;
            if (!result.hasMoreChanges) break;
        }
        return { created, newState: state };
    }

    async emails(ids) {
        if (!ids.length) return [];
        const result = await this.call('Email/get', { accountId: this.accountId, ids, properties: EMAIL_PROPERTIES });
        return result.list;
    }

    async pushSubscriptions() {
        return (await this.call('PushSubscription/get', { ids: null }, [CORE])).list;
    }

    async createPushSubscription({ deviceClientId, url, types, expires }) {
        const result = await this.call('PushSubscription/set', {
            create: { sub: { deviceClientId, url, types, expires } },
        }, [CORE]);
        const created = result.created?.sub;
        if (created) return { id: created.id, expires: created.expires ?? expires };
        const problem = result.notCreated?.sub;
        const detail = problem?.description ? ` — ${problem.description}` : '';
        throw new JMAPError(`PushSubscription/set: ${problem?.type ?? 'not created'}${detail}`, { type: problem?.type ?? null });
    }

    async verifyPushSubscription(id, verificationCode) {
        const result = await this.call('PushSubscription/set', { update: { [id]: { verificationCode } } }, [CORE]);
        const problem = result.notUpdated?.[id];
        if (problem) throw new JMAPError(`PushSubscription/set: ${problem.type}`, { type: problem.type });
    }

    async destroyPushSubscription(id) {
        await this.call('PushSubscription/set', { destroy: [id] }, [CORE]);
    }
}

// The event source URL is a template in RFC 8620's terms. Fastmail's has no
// variables in it and takes the same three as query parameters instead.
export function eventSourceURL(template, { types, closeafter = 'no', ping = 300 }) {
    const values = { types: types.join(','), closeafter, ping: String(ping) };
    if (/\{(types|closeafter|ping)\}/.test(template)) {
        return template.replace(/\{(types|closeafter|ping)\}/g, (_, name) => encodeURIComponent(values[name]));
    }
    const url = new URL(template);
    for (const [name, value] of Object.entries(values)) url.searchParams.set(name, value);
    return url.toString();
}

// text/event-stream, fed as it arrives; returns the events each feed
// completes. Fastmail's pings are comment lines and fall through.
export class EventStreamParser {
    constructor() {
        this.buffer = '';
        this.event = null;
        this.data = [];
    }

    feed(text) {
        this.buffer += text;
        const events = [];
        let newline;
        while ((newline = this.buffer.search(/\r\n|\n|\r/)) !== -1) {
            const line = this.buffer.slice(0, newline);
            const width = this.buffer[newline] === '\r' && this.buffer[newline + 1] === '\n' ? 2 : 1;
            this.buffer = this.buffer.slice(newline + width);
            if (line === '') {
                if (this.data.length) events.push({ event: this.event ?? 'message', data: this.data.join('\n') });
                this.event = null;
                this.data = [];
            } else if (!line.startsWith(':')) {
                const colon = line.indexOf(':');
                const field = colon === -1 ? line : line.slice(0, colon);
                let value = colon === -1 ? '' : line.slice(colon + 1);
                if (value.startsWith(' ')) value = value.slice(1);
                if (field === 'event') this.event = value;
                else if (field === 'data') this.data.push(value);
            }
        }
        return events;
    }
}

const delay = (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

// Keeps one event source connection open until `signal` aborts, handing
// every StateChange to `onStateChange`, reconnecting with backoff.
export async function runEventSource({ url, headers, onStateChange, signal, fetch: fetchImpl = globalThis.fetch, log = console }) {
    let backoff = 1000;
    while (!signal.aborted) {
        try {
            const response = await fetchImpl(url, { headers: { ...headers, accept: 'text/event-stream' }, signal });
            if (!response.ok) throw new JMAPError(`event source: HTTP ${response.status}`, { status: response.status });
            backoff = 1000;
            const parser = new EventStreamParser();
            const decoder = new TextDecoder();
            for await (const chunk of response.body) {
                for (const event of parser.feed(decoder.decode(chunk, { stream: true }))) {
                    if (event.event !== 'state') continue;
                    try {
                        await onStateChange(JSON.parse(event.data));
                    } catch (error) {
                        log.warn(`event source: ${error.message}`);
                    }
                }
            }
            if (!signal.aborted) log.warn('event source: stream ended; reconnecting');
        } catch (error) {
            if (signal.aborted) return;
            log.warn(`event source: ${error.message}; retrying in ${backoff / 1000}s`);
            await delay(backoff, signal);
            backoff = Math.min(backoff * 2, 5 * 60 * 1000);
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd Server && node --test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add Server/src/jmap.js Server/test/jmap.test.js
git commit -m "feat(server): read Fastmail's change log and subscribe to its notices"
```

---

### Task 6: The per-account watcher (`watcher.js`)

**Files:**
- Create: `Server/src/watcher.js`, `Server/test/watcher.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: `class AccountWatcher({ account, config, jmap, apns, devices, state, log, timers })` with `start()`, `receive(body)`, `notice(source)`, `callbackSecret`, `notices`, `status()`, `stop()`, and `chain` (the promise of the last processing run, for tests). Constants `COALESCE_MS`, `POLL_MS`, `RETRY_MS`, `SUBSCRIPTION_TTL_MS`.

- [ ] **Step 1: Write the failing test**

`Server/test/watcher.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AccountWatcher, COALESCE_MS } from '../src/watcher.js';
import { emptyState, loadState } from '../src/state.js';
import { JMAPError } from '../src/jmap.js';

const silent = { warn() {}, info() {}, error() {} };
const account = { name: 'personal', token: 't', topic: 'com.mdbraber.fastmail.personal' };

const arrival = (id, over = {}) => ({
    id, threadId: `T-${id}`, mailboxIds: { inbox: true }, keywords: {},
    from: [{ name: 'Ada', email: 'ada@example.net' }], subject: `Subject ${id}`, ...over,
});

function fakeJMAP({ emails = [], created = [], counts = { badge: 4 }, refusePush = false, changesError = null } = {}) {
    const calls = [];
    return {
        calls, counts, accountId: 'acc1', eventSourceUrl: 'https://api.example.net/jmap/event/',
        fetch: async () => { throw new Error('no network in tests'); },
        headers: () => ({ authorization: 'Bearer t' }),
        connect: async () => {},
        mailboxes: async () => [
            { id: 'inbox', name: 'Inbox', role: 'inbox' },
            { id: 'triage', name: 'Triage', role: null },
        ],
        emailState: async () => 's0',
        mailboxTotal: async () => counts.badge,
        emailChanges: async (since) => {
            calls.push(['changes', since]);
            if (changesError) throw changesError;
            return { created, newState: 's1' };
        },
        emails: async (ids) => emails.filter((e) => ids.includes(e.id)),
        pushSubscriptions: async () => [{ id: 'old', deviceClientId: 'fastmail-push-personal' }],
        destroyPushSubscription: async (id) => { calls.push(['destroy', id]); },
        createPushSubscription: async ({ url }) => {
            calls.push(['subscribe', url]);
            if (refusePush) throw new JMAPError('PushSubscription/set: forbidden', { type: 'forbidden' });
            return { id: 'sub1', expires: new Date(Date.now() + 3600 * 1000).toISOString() };
        },
        verifyPushSubscription: async (id, code) => { calls.push(['verify', id, code]); },
    };
}

function fakeAPNs(answer = () => ({ status: 200, reason: null })) {
    const sent = [];
    return { sent, send: async (token, payload, options) => { sent.push({ token, payload, ...options }); return answer(token); } };
}

function fakeDevices(tokens) {
    const removed = [];
    return { removed, tokens: () => tokens.filter((t) => !removed.includes(t)), remove: async (_, t) => { removed.push(t); } };
}

// Timers under the test's control: only what is due within `upTo` runs.
function manualTimers() {
    const queue = [];
    return {
        queue,
        setTimeout: (fn, ms) => { queue.push({ fn, ms }); return queue.length; },
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        async run(upTo = COALESCE_MS) {
            for (const entry of queue.splice(0)) {
                if (entry.ms <= upTo) await entry.fn(); else queue.push(entry);
            }
        },
    };
}

async function setUp(jmapOptions, { apns = fakeAPNs(), devices = fakeDevices(['tok1', 'tok2']), notices = 'auto' } = {}) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'watcher-'));
    const config = { publicUrl: 'https://push.example.net', badgeLabel: 'Triage', notices, dataDir: dir };
    const jmap = fakeJMAP(jmapOptions);
    const timers = manualTimers();
    const watcher = new AccountWatcher({ account, config, jmap, apns, devices, state: emptyState(), log: silent, timers });
    await watcher.start();
    return { dir, jmap, apns, devices, timers, watcher };
}

async function settle({ timers, watcher }) {
    await timers.run();
    await watcher.chain;
}

test('one new Inbox message becomes one alert per device, carrying the badge, and is remembered', async () => {
    const t = await setUp({ created: ['M1', 'M2'], emails: [arrival('M1'), arrival('M2', { mailboxIds: { other: true } })] });
    assert.equal(t.watcher.notices, 'push');
    assert.deepEqual(t.jmap.calls.find((c) => c[0] === 'destroy'), ['destroy', 'old']);
    assert.match(t.jmap.calls.find((c) => c[0] === 'subscribe')[1], /^https:\/\/push\.example\.net\/jmap\/personal\/[0-9a-f]{32}$/);

    await t.watcher.receive({ '@type': 'PushVerification', pushSubscriptionId: 'sub1', verificationCode: 'v1' });
    assert.equal(t.watcher.verified, true);
    assert.deepEqual(t.jmap.calls.find((c) => c[0] === 'verify'), ['verify', 'sub1', 'v1']);

    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);

    assert.equal(t.apns.sent.length, 2);
    assert.deepEqual(t.apns.sent.map((s) => s.token), ['tok1', 'tok2']);
    assert.equal(t.apns.sent[0].payload.aps.alert.title, 'Ada');
    assert.equal(t.apns.sent[0].payload.aps.badge, 4);
    assert.equal(t.apns.sent[0].payload.url, 'https://app.fastmail.com/mail/Inbox/T-M1');
    assert.equal(t.apns.sent[0].collapseId, 'M1');
    assert.equal(t.apns.sent[0].topic, account.topic);

    const saved = await loadState(t.dir, 'personal', silent);
    assert.deepEqual(saved, { emailState: 's1', notified: ['M1'], badge: 4 });
});

test('the same message never notifies twice', async () => {
    const t = await setUp({ created: ['M1'], emails: [arrival('M1')] });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's2' } } });
    await settle(t);
    assert.equal(t.apns.sent.length, 2);
});

test('a changed count with no new mail is a badge-only push, once per change', async () => {
    const t = await setUp({ created: [] });
    t.jmap.counts.badge = 3;
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Mailbox: 'm1' } } });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Mailbox: 'm2' } } });
    await settle(t);
    assert.deepEqual(t.apns.sent.map((s) => s.payload), [{ aps: { badge: 3 } }, { aps: { badge: 3 } }]);
    assert.equal(t.apns.sent[0].collapseId, null);

    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Mailbox: 'm3' } } });
    await settle(t);
    assert.equal(t.apns.sent.length, 2);
});

test('a notice for someone else, or with nothing of ours in it, is ignored', async () => {
    const t = await setUp({ created: ['M1'], emails: [arrival('M1')] });
    await t.watcher.receive({ '@type': 'StateChange', changed: { other: { Email: 's1' } } });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Calendar: 'c1' } } });
    await t.watcher.receive({ '@type': 'PushVerification', pushSubscriptionId: 'not-ours', verificationCode: 'x' });
    await settle(t);
    assert.equal(t.apns.sent.length, 0);
    assert.equal(t.watcher.verified, false);
});

test('a device APNs calls dead is dropped', async () => {
    const apns = fakeAPNs((token) => token === 'tok2' ? { status: 410, reason: 'Unregistered' } : { status: 200, reason: null });
    const t = await setUp({ created: ['M1'], emails: [arrival('M1')] }, { apns });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);
    assert.deepEqual(t.devices.removed, ['tok2']);
});

test('a lost change log means a silent resync', async () => {
    const error = new JMAPError('Email/changes: cannotCalculateChanges', { type: 'cannotCalculateChanges' });
    const t = await setUp({ created: ['M1'], emails: [arrival('M1')], changesError: error });
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
    await settle(t);
    assert.equal(t.apns.sent.length, 0);
    assert.equal((await loadState(t.dir, 'personal', silent)).emailState, 's0');
});

test('when the push subscription is refused the event source takes over', async () => {
    const t = await setUp({ refusePush: true });
    assert.equal(t.watcher.notices, 'eventsource');
    assert.equal(t.watcher.status().notices, 'eventsource');
    t.watcher.stop();
});

test('NOTICES=push does not fall back', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'watcher-'));
    const config = { publicUrl: 'https://push.example.net', badgeLabel: 'Triage', notices: 'push', dataDir: dir };
    const timers = manualTimers();
    const watcher = new AccountWatcher({ account, config, jmap: fakeJMAP({ refusePush: true }), apns: fakeAPNs(), devices: fakeDevices([]), state: emptyState(), log: silent, timers });
    await watcher.start();
    assert.equal(watcher.notices, null);
    assert.equal(timers.queue.length, 1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd Server && node --test`
Expected: FAIL — `Cannot find module '.../src/watcher.js'`

- [ ] **Step 3: Write the implementation**

`Server/src/watcher.js`:

```js
import { randomBytes } from 'node:crypto';
import { alertPayload, badgePayload, selectNotifiable } from './notify.js';
import { rememberNotified, saveState } from './state.js';
import { deviceOutcome } from './apns.js';
import { eventSourceURL, runEventSource } from './jmap.js';

export const COALESCE_MS = 2000;
export const POLL_MS = 5 * 60 * 1000;
export const RETRY_MS = 10 * 60 * 1000;
export const SUBSCRIPTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TYPES = ['Email', 'Mailbox'];

const realTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

// One account, from first session to every push: learns the mailboxes,
// subscribes to Fastmail's change notices, and turns each into the alerts
// and badge updates its devices should see.
export class AccountWatcher {
    constructor({ account, config, jmap, apns, devices, state, log = console, timers = realTimers }) {
        this.account = account;
        this.config = config;
        this.jmap = jmap;
        this.apns = apns;
        this.devices = devices;
        this.state = state;
        this.log = log;
        this.timers = timers;
        this.inboxId = null;
        this.badgeMailboxId = null;
        this.notices = null;
        this.callbackSecret = null;
        this.pushSubscriptionId = null;
        this.verified = false;
        this.lastNoticeAt = null;
        this.pending = null;
        this.chain = Promise.resolve();
        this.abort = new AbortController();
        this.pollTimer = null;
        this.renewTimer = null;
        this.startTimer = null;
    }

    get name() { return this.account.name; }
    get deviceClientId() { return `fastmail-push-${this.name}`; }

    // Connects, and keeps trying every RETRY_MS if Fastmail will not have us.
    async start() {
        try {
            await this.connect();
        } catch (error) {
            this.log.error(`[${this.name}] start failed: ${error.message}; retrying in ${RETRY_MS / 60000} minutes`);
            this.startTimer = this.timers.setTimeout(() => this.start(), RETRY_MS);
        }
    }

    async connect() {
        await this.jmap.connect();
        const mailboxes = await this.jmap.mailboxes();
        this.inboxId = mailboxes.find((m) => m.role === 'inbox')?.id ?? null;
        if (!this.inboxId) throw new Error('no Inbox in this account');
        // A label is a mailbox without a role; prefer that over a system folder of the same name
        this.badgeMailboxId = mailboxes.find((m) => m.name === this.config.badgeLabel && !m.role)?.id
            ?? mailboxes.find((m) => m.name === this.config.badgeLabel)?.id
            ?? null;
        if (!this.badgeMailboxId) this.log.warn(`[${this.name}] no "${this.config.badgeLabel}" label: badges are off`);
        if (!this.state.emailState) await this.resync();
        await this.subscribe();
        this.pollTimer = this.timers.setInterval(() => this.notice('poll'), POLL_MS);
        this.log.info(`[${this.name}] watching, notices by ${this.notices}`);
    }

    // Take the present as the starting point: nothing already there is new.
    async resync() {
        this.state.emailState = await this.jmap.emailState();
        this.state.badge = await this.badgeCount();
        await this.persist();
    }

    async subscribe() {
        const mode = this.config.notices;
        if (mode !== 'eventsource') {
            try {
                await this.subscribePush();
                this.notices = 'push';
                return;
            } catch (error) {
                if (mode === 'push') throw error;
                this.log.warn(`[${this.name}] push subscription refused (${error.message}); using the event source`);
            }
        }
        this.startEventSource();
        this.notices = 'eventsource';
    }

    async subscribePush() {
        // Leftovers from earlier runs point at callback paths whose secret is gone
        for (const sub of await this.jmap.pushSubscriptions()) {
            if (sub.deviceClientId === this.deviceClientId) await this.jmap.destroyPushSubscription(sub.id);
        }
        this.callbackSecret = randomBytes(16).toString('hex');
        this.verified = false;
        const { id, expires } = await this.jmap.createPushSubscription({
            deviceClientId: this.deviceClientId,
            url: `${this.config.publicUrl}/jmap/${this.name}/${this.callbackSecret}`,
            types: TYPES,
            expires: new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString(),
        });
        this.pushSubscriptionId = id;
        // Renew well before Fastmail stops calling; it may have granted less than asked
        const lifetime = Math.max(new Date(expires).getTime() - Date.now(), 60 * 1000);
        this.timers.clearTimeout(this.renewTimer);
        this.renewTimer = this.timers.setTimeout(() => {
            this.subscribePush().catch((error) => {
                this.log.warn(`[${this.name}] renewal failed (${error.message}); using the event source`);
                this.startEventSource();
                this.notices = 'eventsource';
            });
        }, lifetime * 0.8);
    }

    startEventSource() {
        if (!this.jmap.eventSourceUrl) throw new Error('the session has no event source');
        runEventSource({
            url: eventSourceURL(this.jmap.eventSourceUrl, { types: TYPES }),
            headers: this.jmap.headers(),
            onStateChange: (change) => this.receive(change),
            signal: this.abort.signal,
            fetch: this.jmap.fetch,
            log: this.log,
        }).catch((error) => this.log.error(`[${this.name}] event source stopped: ${error.message}`));
    }

    // What Fastmail sends: first a verification, then state changes. A
    // verification for a subscription that is not ours, or a change to
    // someone else's account, is ignored.
    async receive(body) {
        if (body?.['@type'] === 'PushVerification') {
            if (body.pushSubscriptionId !== this.pushSubscriptionId) return;
            await this.jmap.verifyPushSubscription(this.pushSubscriptionId, body.verificationCode);
            this.verified = true;
            this.log.info(`[${this.name}] push subscription verified`);
            return;
        }
        if (body?.['@type'] === 'StateChange') {
            const changed = body.changed?.[this.jmap.accountId];
            if (changed && TYPES.some((type) => type in changed)) this.notice('change');
        }
    }

    // A burst of notices becomes one look at the change log, and looks
    // never overlap: each waits for the one before it.
    notice(source) {
        this.lastNoticeAt = new Date().toISOString();
        if (this.pending) return;
        this.pending = this.timers.setTimeout(() => {
            this.pending = null;
            this.chain = this.chain
                .then(() => this.process(source))
                .catch((error) => this.log.error(`[${this.name}] ${error.message}`));
        }, source === 'poll' ? 0 : COALESCE_MS);
    }

    async process(source) {
        let changes;
        try {
            changes = await this.jmap.emailChanges(this.state.emailState);
        } catch (error) {
            if (error.type !== 'cannotCalculateChanges') throw error;
            this.log.warn(`[${this.name}] change log gone; resyncing without notifying`);
            await this.resync();
            return;
        }
        const emails = await this.jmap.emails(changes.created);
        const fresh = selectNotifiable(emails, { inboxId: this.inboxId, notified: new Set(this.state.notified) });
        const badge = await this.badgeCount();

        for (const email of fresh) {
            await this.broadcast(alertPayload(email, { badge }), { collapseId: email.id });
        }
        if (!fresh.length && badge !== null && badge !== this.state.badge) {
            await this.broadcast(badgePayload(badge), { collapseId: null });
        }

        this.state = rememberNotified(this.state, fresh.map((email) => email.id));
        this.state.emailState = changes.newState;
        this.state.badge = badge;
        await this.persist();
        if (fresh.length) this.log.info(`[${this.name}] ${fresh.length} new (${source})`);
    }

    async badgeCount() {
        return this.badgeMailboxId ? this.jmap.mailboxTotal(this.badgeMailboxId) : null;
    }

    async broadcast(payload, { collapseId }) {
        for (const token of this.devices.tokens(this.name)) {
            let result;
            try {
                result = await this.apns.send(token, payload, { topic: this.account.topic, collapseId });
            } catch (error) {
                this.log.warn(`[${this.name}] apns: ${error.message}`);
                continue;
            }
            if (deviceOutcome(result.status, result.reason) === 'remove') {
                await this.devices.remove(this.name, token);
                this.log.info(`[${this.name}] dropped a dead device (${result.reason})`);
            } else if (result.status !== 200) {
                this.log.warn(`[${this.name}] apns ${result.status} ${result.reason ?? ''}`);
            }
        }
    }

    async persist() {
        await saveState(this.config.dataDir, this.name, this.state);
    }

    status() {
        return {
            notices: this.notices,
            verified: this.notices === 'push' ? this.verified : null,
            lastNotice: this.lastNoticeAt,
            devices: this.devices.tokens(this.name).length,
            badge: this.state.badge,
        };
    }

    stop() {
        this.abort.abort();
        this.timers.clearInterval(this.pollTimer);
        this.timers.clearTimeout(this.renewTimer);
        this.timers.clearTimeout(this.startTimer);
        this.timers.clearTimeout(this.pending);
        this.pending = null;
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd Server && node --test`
Expected: all passing. The event-source test calls `stop()` so the reconnect delay does not keep the process alive.

- [ ] **Step 5: Commit**

```bash
git add Server/src/watcher.js Server/test/watcher.test.js
git commit -m "feat(server): watch each account and turn its notices into pushes"
```

---

### Task 7: HTTP endpoints and wiring (`http.js`, `main.js`)

**Files:**
- Create: `Server/src/http.js`, `Server/src/main.js`, `Server/test/http.test.js`

**Interfaces:**
- Produces: `createServer({ config, watchers, devices, log }) → http.Server` serving `GET /healthz`, `POST /devices`, `POST /jmap/<account>/<secret>`.

- [ ] **Step 1: Write the failing test**

`Server/test/http.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'c'.repeat(64);

async function running() {
    const received = [];
    const registered = [];
    const watchers = {
        personal: {
            callbackSecret: 'abc123',
            status: () => ({ notices: 'push', verified: true, lastNotice: null, devices: 1, badge: 2 }),
            receive: async (body) => { received.push(body); },
        },
    };
    const devices = { register: async (account, value) => { registered.push([account, value]); } };
    const server = createServer({ config: { deviceSecret: 's3cret' }, watchers, devices, log: silent });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, received, registered, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('healthz reports every account', async () => {
    const s = await running();
    const response = await fetch(`${s.base}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accounts: { personal: { notices: 'push', verified: true, lastNotice: null, devices: 1, badge: 2 } } });
    await s.close();
});

test('device registration needs the bearer, a known account and a real token', async () => {
    const s = await running();
    const post = (headers, body) => fetch(`${s.base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

    assert.equal((await post({}, { account: 'personal', token })).status, 401);
    assert.equal((await post({ authorization: 'Bearer wrong' }, { account: 'personal', token })).status, 401);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: 'work', token })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: 'personal', token: 'nope' })).status, 400);
    const ok = await post({ authorization: 'Bearer s3cret' }, { account: 'personal', token });
    assert.equal(ok.status, 200);
    assert.deepEqual(s.registered, [['personal', token]]);
    await s.close();
});

test('Fastmail notices reach the watcher only with the right secret', async () => {
    const s = await running();
    const notice = { '@type': 'StateChange', changed: { acc1: { Email: 's1' } } };
    const post = (path) => fetch(`${s.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(notice) });

    assert.equal((await post('/jmap/personal/wrong')).status, 204);
    assert.equal((await post('/jmap/work/abc123')).status, 204);
    assert.equal(s.received.length, 0);
    assert.equal((await post('/jmap/personal/abc123')).status, 200);
    assert.deepEqual(s.received, [notice]);
    await s.close();
});

test('anything else is not found, and a broken body is a bad request', async () => {
    const s = await running();
    assert.equal((await fetch(`${s.base}/nope`)).status, 404);
    assert.equal((await fetch(`${s.base}/devices`)).status, 404);
    const broken = await fetch(`${s.base}/devices`, { method: 'POST', headers: { authorization: 'Bearer s3cret' }, body: '{ not json' });
    assert.equal(broken.status, 400);
    await s.close();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd Server && node --test`
Expected: FAIL — `Cannot find module '.../src/http.js'`

- [ ] **Step 3: Write the implementation**

`Server/src/http.js`:

```js
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { isDeviceToken } from './devices.js';

const BODY_LIMIT = 64 * 1024;

export function createServer({ config, watchers, devices, log = console }) {
    return http.createServer((request, response) => {
        route({ config, watchers, devices }, request, response).catch((error) => {
            log.error(`http: ${error.message}`);
            if (!response.headersSent) reply(response, 500, { error: 'internal' });
        });
    });
}

async function route({ config, watchers, devices }, request, response) {
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'GET' && url.pathname === '/healthz') {
        const accounts = Object.fromEntries(Object.entries(watchers).map(([name, watcher]) => [name, watcher.status()]));
        return reply(response, 200, { accounts });
    }

    if (request.method === 'POST' && url.pathname === '/devices') {
        if (!bearerMatches(request.headers.authorization, config.deviceSecret)) {
            return reply(response, 401, { error: 'unauthorized' });
        }
        const body = await readJSON(request);
        if (!body || !(body.account in watchers) || !isDeviceToken(body.token)) {
            return reply(response, 400, { error: 'account and token required' });
        }
        await devices.register(body.account, body.token);
        return reply(response, 200, { ok: true });
    }

    if (request.method === 'POST' && parts.length === 3 && parts[0] === 'jmap') {
        const watcher = watchers[parts[1]];
        // A wrong secret is not worth telling anyone about
        if (!watcher?.callbackSecret || !safeEqual(parts[2], watcher.callbackSecret)) return reply(response, 204);
        const body = await readJSON(request);
        if (body) await watcher.receive(body);
        return reply(response, 200, { ok: true });
    }

    return reply(response, 404, { error: 'not found' });
}

function bearerMatches(header, secret) {
    const prefix = 'Bearer ';
    return typeof header === 'string' && header.startsWith(prefix) && safeEqual(header.slice(prefix.length), secret);
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
}

function readJSON(request) {
    return new Promise((resolve) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > BODY_LIMIT) {
                request.destroy();
                resolve(null);
            }
        });
        request.on('end', () => {
            try { resolve(body ? JSON.parse(body) : null); } catch { resolve(null); }
        });
        request.on('error', () => resolve(null));
    });
}

function reply(response, status, body) {
    if (body === undefined) {
        response.writeHead(status);
        response.end();
        return;
    }
    const text = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
    response.end(text);
}
```

`Server/src/main.js`:

```js
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { APNsClient } from './apns.js';
import { JMAPClient } from './jmap.js';
import { DeviceRegistry } from './devices.js';
import { loadState } from './state.js';
import { AccountWatcher } from './watcher.js';
import { createServer } from './http.js';

const stamp = () => new Date().toISOString();
const log = {
    info: (message) => console.log(`${stamp()} ${message}`),
    warn: (message) => console.warn(`${stamp()} warn: ${message}`),
    error: (message) => console.error(`${stamp()} error: ${message}`),
};

const config = loadConfig();
const apns = new APNsClient({
    key: await readFile(config.apns.keyFile, 'utf8'),
    keyId: config.apns.keyId,
    teamId: config.apns.teamId,
    sandbox: config.apns.sandbox,
    log,
});
const devices = new DeviceRegistry(path.join(config.dataDir, 'devices.json'), log);
await devices.load();

const watchers = {};
for (const account of Object.values(config.accounts)) {
    const state = await loadState(config.dataDir, account.name, log);
    const jmap = new JMAPClient({ token: account.token });
    watchers[account.name] = new AccountWatcher({ account, config, jmap, apns, devices, state, log });
}

const server = createServer({ config, watchers, devices, log });
server.listen(config.port, () => {
    log.info(`fastmail-push listening on ${config.port}, ${config.apns.sandbox ? 'sandbox' : 'production'} APNs`);
});
for (const watcher of Object.values(watchers)) watcher.start();

const shutdown = () => {
    log.info('stopping');
    for (const watcher of Object.values(watchers)) watcher.stop();
    apns.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 4: Run the tests, and start the server without configuration**

Run: `cd Server && node --test`
Expected: all passing.

Run: `cd Server && node src/main.js; echo "exit $?"`
Expected: an uncaught `Error: missing configuration: FASTMAIL_TOKEN_PERSONAL or FASTMAIL_TOKEN_WORK, APNS_KEY_FILE, ...` and a non-zero exit — the loud failure the spec asks for.

- [ ] **Step 5: Commit**

```bash
git add Server/src/http.js Server/src/main.js Server/test/http.test.js
git commit -m "feat(server): serve device registration, Fastmail's callbacks and a health check"
```

---

### Task 8: Container, compose file, README, and the Makefile hook

**Files:**
- Create: `Server/Dockerfile`, `Server/compose.yml`, `Server/README.md`
- Modify: `Makefile`

- [ ] **Step 1: Write the container files**

`Server/Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["node", "src/main.js"]
```

`Server/compose.yml`:

```yaml
services:
  fastmail-push:
    build: .
    container_name: fastmail-push
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./data:/data
      - ./secrets:/secrets:ro
```

`Server/README.md`:

```markdown
# fastmail-push

New-mail pushes for the shell apps on iOS. A read-only Fastmail token per
account lives here, never on the phone; the service watches each mailbox
over JMAP and sends an APNs alert for every message that lands in the
Inbox, with the Triage count as the badge. Design and payload contract:
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
5. **Check** — `curl https://<PUBLIC_URL>/healthz` lists each account with
   `notices: "push"` (and `verified: true` once Fastmail's verification
   round-trip is done) or `notices: "eventsource"` if Fastmail refused the
   push subscription for an API token. Either works; push is quicker.
6. **Apps** — add `PUSH_SERVER_HOST` (the host, no `https://`) and
   `PUSH_DEVICE_SECRET` to `Config/Local.xcconfig`, then `make deploy`.
   On the first launch the app asks for notification permission and
   registers its device token; `healthz` shows `devices` counting up.

A device that already answered the old badge-only prompt is not asked
again: turn Alerts on under Settings → Notifications → the app, or delete
and reinstall the app.

## Running the tests

`node --test` in this directory, or `make test` at the repo root.
```

- [ ] **Step 2: Hook the server tests into `make test`**

In `Makefile`, change the `test` target to:

```make
test: generate
	cd Packages/FastmailShellKit && swift test
	xcodebuild -project $(PROJECT) -scheme IntegrationTests -destination 'platform=macOS' test
	cd Server && node --test
```

- [ ] **Step 3: Build the image and watch it fail loudly without configuration**

Run: `docker build -t fastmail-push Server/ && docker run --rm fastmail-push; echo "exit $?"`
Expected: the image builds; the container prints `Error: missing configuration: ...` and exits non-zero.

Run: `make test`
Expected: the Swift tests, the integration tests and then the Node tests all pass.

- [ ] **Step 4: Commit**

```bash
git add Server/Dockerfile Server/compose.yml Server/README.md Makefile
git commit -m "feat(server): package fastmail-push for Docker Compose"
```

---

### Task 9: Entitlement, build settings and Info.plist keys

**Files:**
- Create: `Apps/Personal/iOS.entitlements`, `Apps/Work/iOS.entitlements`
- Modify: `project.yml`, `Config/Shared.xcconfig`, `Config/Local.xcconfig.example`, `Apps/Personal/Info.plist`, `Apps/Work/Info.plist`

- [ ] **Step 1: The entitlements files**

Both `Apps/Personal/iOS.entitlements` and `Apps/Work/iOS.entitlements`, identical:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>aps-environment</key>
    <string>development</string>
</dict>
</plist>
```

- [ ] **Step 2: Wire them in `project.yml`, iOS only**

Under `targets: Personal: settings: base:` add after `INFOPLIST_FILE`:

```yaml
        "CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]": Apps/Personal/iOS.entitlements
```

and under `targets: Work: settings: base:`:

```yaml
        "CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]": Apps/Work/iOS.entitlements
```

- [ ] **Step 3: The build settings**

`Config/Shared.xcconfig`, after `DEVELOPMENT_TEAM =`:

```
PUSH_SERVER_HOST =
PUSH_DEVICE_SECRET =
```

`Config/Local.xcconfig.example`, appended:

```
PUSH_SERVER_HOST = push.example.net
PUSH_DEVICE_SECRET = replace-me
```

- [ ] **Step 4: The Info.plist keys**

In both `Apps/Personal/Info.plist` and `Apps/Work/Info.plist`, directly after the `FMAccountID` entry:

```xml
    <key>FMPushHost</key>
    <string>$(PUSH_SERVER_HOST)</string>
    <key>FMPushSecret</key>
    <string>$(PUSH_DEVICE_SECRET)</string>
```

- [ ] **Step 5: Build both platforms**

Run: `make build-ios`
Expected: BUILD SUCCEEDED twice. With `-allowProvisioningUpdates`, Xcode registers explicit App IDs for both bundle identifiers with the Push Notifications capability and makes matching development profiles. If it fails with *"Provisioning profile ... doesn't support the Push Notifications capability"*, the capability has to be ticked by hand once in the developer portal under Identifiers → the App ID → Push Notifications; then rerun.

Run: `make build-macos`
Expected: BUILD SUCCEEDED twice, signing unchanged (`codesign -d --entitlements - "$(xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $3}')/mdbraber.com.app" 2>&1 | grep -c aps-environment` prints `0`).

- [ ] **Step 6: Commit**

```bash
git add Apps/Personal/iOS.entitlements Apps/Work/iOS.entitlements project.yml Config/Shared.xcconfig Config/Local.xcconfig.example Apps/Personal/Info.plist Apps/Work/Info.plist
git commit -m "feat(ios): the push entitlement, and where the apps find their push server"
```

---

### Task 10: `PushConfig`, `PushPayload`, `PendingLinks`, and the badge's asking moves out

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/PushConfig.swift`, `PushPayload.swift`, `PendingLinks.swift`; tests `PushConfigTests.swift`, `PushPayloadTests.swift`, `PendingLinksTests.swift`
- Modify: `Profile.swift`, `BadgeController.swift`, `AppShell.swift`, `BadgeControllerTests.swift`

**Interfaces:**
- Produces: `PushConfig(host:secret:)`, `PushConfig.from(bundle:)`, `PushConfig.account(forBundleIdentifier:)`, `PushConfig.registration(account:deviceToken:) → URLRequest`; `PushPayload.url(from:)`; `PendingLinks.shared`, `open(_:)`, `take()`; `Profile.configuredValue(_:)`; `BadgeController.reapply()` (kept), `prime()` removed, `BadgeAuthorizationMove.request` removed.

- [ ] **Step 1: Write the failing tests**

`Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushConfigTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

@Test func aHostAndSecretMakeAConfig() {
    let config = PushConfig(host: "push.example.net", secret: "s3cret")
    #expect(config?.server.absoluteString == "https://push.example.net")
    #expect(config?.secret == "s3cret")
}

@Test func aPathAfterTheHostIsKept() {
    #expect(PushConfig(host: "push.example.net/fastmail-push", secret: "s")?.server.absoluteString == "https://push.example.net/fastmail-push")
}

@Test func anUnconfiguredBuildHasNoPush() {
    #expect(PushConfig(host: nil, secret: nil) == nil)
    #expect(PushConfig(host: "", secret: "s") == nil)
    #expect(PushConfig(host: "$(PUSH_SERVER_HOST)", secret: "s") == nil)
    #expect(PushConfig(host: "replace-me", secret: "s") == nil)
    #expect(PushConfig(host: "push.example.net", secret: "") == nil)
    #expect(PushConfig(host: "push.example.net", secret: "$(PUSH_DEVICE_SECRET)") == nil)
    #expect(PushConfig(host: "push.example.net", secret: "replace-me") == nil)
}

@Test func aSchemeInTheHostIsRefused() {
    #expect(PushConfig(host: "https://push.example.net", secret: "s") == nil)
    #expect(PushConfig(host: "http://push.example.net", secret: "s") == nil)
}

@Test func theAccountIsTheBundleIdentifiersLastPart() {
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail.personal") == "personal")
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail.work") == "work")
    #expect(PushConfig.account(forBundleIdentifier: "com.mdbraber.fastmail.personal.share") == nil)
    #expect(PushConfig.account(forBundleIdentifier: nil) == nil)
}

@Test func theRegistrationPostsTheHexTokenWithTheSecret() throws {
    let config = try #require(PushConfig(host: "push.example.net/base", secret: "s3cret"))
    let request = config.registration(account: "work", deviceToken: Data([0x00, 0xAB, 0xFF]))
    #expect(request.url?.absoluteString == "https://push.example.net/base/devices")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer s3cret")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let body = try #require(request.httpBody)
    let json = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
    #expect(json == ["account": "work", "token": "00abff"])
}
```

`Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushPayloadTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

@Test func theThreadAddressComesOutOfThePayload() {
    let url = PushPayload.url(from: ["url": "https://app.fastmail.com/mail/Inbox/T1", "emailId": "M1"])
    #expect(url?.absoluteString == "https://app.fastmail.com/mail/Inbox/T1")
}

@Test func aMissingOrOddAddressIsNothing() {
    #expect(PushPayload.url(from: [:]) == nil)
    #expect(PushPayload.url(from: ["url": 42]) == nil)
    #expect(PushPayload.url(from: ["url": ""]) == nil)
    #expect(PushPayload.url(from: ["url": "javascript:alert(1)"]) == nil)
    #expect(PushPayload.url(from: ["url": "http://app.fastmail.com/mail/Inbox/T1"]) == nil)
}
```

`Packages/FastmailShellKit/Tests/FastmailShellKitTests/PendingLinksTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

@Test @MainActor func aLinkIsTakenOnce() {
    let links = PendingLinks()
    #expect(links.take() == nil)
    links.open(URL(string: "https://app.fastmail.com/mail/Inbox/T1")!)
    #expect(links.take()?.absoluteString == "https://app.fastmail.com/mail/Inbox/T1")
    #expect(links.take() == nil)
}
```

In `BadgeControllerTests.swift`, replace the `authorizationIsRequestedOnlyWhenUndecidedAndThereIsACount` test with:

```swift
// Asking is the push registrar's job, at launch; an undecided status waits
// for that prompt, whose answer re-applies the last count.
@Test func undecidedWaitsForThePrompt() {
    #expect(BadgeController.move(authorization: .notDetermined, count: 5) == .skip)
    #expect(BadgeController.move(authorization: .notDetermined, count: 0) == .skip)
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: compile errors — `PushConfig`, `PushPayload`, `PendingLinks` do not exist.

- [ ] **Step 3: Share the "configured value" rule in `Profile.swift`**

Replace `normalizedAccountID` in the `extension Profile` with:

```swift
    static func normalizedAccountID(_ raw: String?) -> String? {
        configuredValue(raw)
    }

    /// A build setting that reached Info.plist: empty, an unsubstituted
    /// `$(...)`, or the example placeholder all mean "not configured", so the
    /// feature it belongs to stays off rather than pointing at nonsense.
    static func configuredValue(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !trimmed.hasPrefix("$("),
              trimmed != "replace-me"
        else { return nil }
        return trimmed
    }
```

(The comment that was on `normalizedAccountID` about the compose URL moves with the rule; delete it there.)

- [ ] **Step 4: Write the three new files**

`PushConfig.swift`:

```swift
import Foundation

/// Where this app registers for pushes, read from Info.plist the way the
/// account id is. A host rather than a URL, because `//` starts a comment
/// in the xcconfig it comes from; the scheme is always https.
public struct PushConfig: Equatable, Sendable {
    public let server: URL
    public let secret: String

    public init?(host rawHost: String?, secret rawSecret: String?) {
        guard
            let host = Profile.configuredValue(rawHost),
            let secret = Profile.configuredValue(rawSecret),
            !host.contains("://"),
            let server = URL(string: "https://" + host),
            server.host != nil
        else { return nil }
        self.server = server
        self.secret = secret
    }

    public static func from(bundle: Bundle) -> PushConfig? {
        PushConfig(
            host: bundle.object(forInfoDictionaryKey: "FMPushHost") as? String,
            secret: bundle.object(forInfoDictionaryKey: "FMPushSecret") as? String
        )
    }

    /// Which account the server files this device under: the last part of
    /// the bundle identifier, `personal` or `work`. An extension's identifier
    /// ends in something else and gets nothing.
    public static func account(forBundleIdentifier identifier: String?) -> String? {
        guard let last = identifier?.split(separator: ".").last else { return nil }
        let name = String(last)
        return name == "personal" || name == "work" ? name : nil
    }

    public func registration(account: String, deviceToken: Data) -> URLRequest {
        var request = URLRequest(url: server.appendingPathComponent("devices"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["account": account, "token": token])
        return request
    }
}
```

`PushPayload.swift`:

```swift
import Foundation

/// The one thing the app reads out of a push: the thread's address the
/// server put in `url`. Only https is taken here; LinkRouter still gets to
/// refuse anything that is not Fastmail's.
public enum PushPayload {
    public static func url(from userInfo: [AnyHashable: Any]) -> URL? {
        guard
            let text = userInfo["url"] as? String,
            let url = URL(string: text),
            url.scheme?.lowercased() == "https"
        else { return nil }
        return url
    }
}
```

`PendingLinks.swift`:

```swift
import Combine
import Foundation

/// A link handed in from outside the view tree — a tapped notification —
/// for AppShell to route as if it had arrived through onOpenURL.
@MainActor
public final class PendingLinks: ObservableObject {
    public static let shared = PendingLinks()

    @Published public var url: URL?

    public init() {}

    public func open(_ url: URL) {
        self.url = url
    }

    public func take() -> URL? {
        defer { url = nil }
        return url
    }
}
```

- [ ] **Step 5: Move the asking out of `BadgeController`**

In `BadgeController.swift`:

- Delete the `.request` case from `BadgeAuthorizationMove`.
- Replace `move(authorization:count:)` and its comment with:

```swift
    /// The decision, read from the live authorization status rather than a
    /// remembered flag: a permission the user grants — or revokes — in Settings
    /// is honoured on the very next badge, without an app restart. Asking is
    /// the push registrar's, at launch; an undecided status waits for that.
    nonisolated public static func move(
        authorization: BadgeAuthorization, count: Int
    ) -> BadgeAuthorizationMove {
        switch authorization {
        case .denied, .notDetermined:
            return .skip
        case .allowed:
            return .proceed
        }
    }
```

- Delete `prime()` entirely (its doc comment included).
- In `set(_:)`, delete the `case .request:` branch, leaving `.skip` and `.proceed`.
- In the comment above `reapply()`, replace "lands without waiting for the next push" with "lands without waiting for the next count", and add one sentence: "The push registrar calls this once its permission prompt is answered."

In `AppShell.swift`, after `@ObservedObject private var settings = SettingsPresenter.shared` add:

```swift
    @ObservedObject private var pendingLinks = PendingLinks.shared
```

Replace the whole `#if canImport(UIKit)` branch of the modifiers (from `.sheet(isPresented:` to just before `#else`) with:

```swift
        .sheet(isPresented: $settings.isPresented) {
            MobileSettingsSheet(profile: profile)
        }
        .onAppear {
            // The registrar asks for permission at launch; this puts the
            // last badge back once the app is on screen, and opens the
            // notification that launched it, if one did.
            BadgeController.shared.reapply()
            if let url = pendingLinks.take() { handle(url) }
        }
        .onChange(of: scenePhase) {
            // Coming back to the front is when a badge permission just granted
            // in Settings first takes effect, and when a number that drifted
            // while the app slept gets corrected.
            if scenePhase == .active {
                BadgeController.shared.reapply()
            }
        }
        .onChange(of: pendingLinks.url) {
            // A tapped notification, routed exactly as a link from outside
            if let url = pendingLinks.take() { handle(url) }
        }
```

`onChange` sees a change only once the view is on screen, which is why `onAppear` also takes a link: a tap that launches the app can land before the view does. (Task 11 adds one more line to the scenePhase block.)

- [ ] **Step 6: Run the package tests**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: all passing, including the four new files' cases and the changed badge test.

- [ ] **Step 7: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/PushConfig.swift Packages/FastmailShellKit/Sources/FastmailShellKit/PushPayload.swift Packages/FastmailShellKit/Sources/FastmailShellKit/PendingLinks.swift Packages/FastmailShellKit/Sources/FastmailShellKit/Profile.swift Packages/FastmailShellKit/Sources/FastmailShellKit/BadgeController.swift Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushConfigTests.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/PushPayloadTests.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/PendingLinksTests.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/BadgeControllerTests.swift
git commit -m "feat: the push server's address, a push's link, and a badge that waits for one prompt"
```

---

### Task 11: `PushRegistrar` on iOS, installed in both apps

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/PushRegistrar.swift`
- Modify: `Apps/Personal/PersonalApp.swift`, `Apps/Work/WorkApp.swift`

**Interfaces:**
- Consumes: `PushConfig`, `PushPayload`, `PendingLinks`, `BadgeController.reapply()` from Task 10.
- Produces: `PushRegistrar` (`NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate`), `PushRegistrar.current`, `becameActive()`, `PushRegistrar.foregroundPresentation`.

- [ ] **Step 1: Write the registrar**

`PushRegistrar.swift`:

```swift
#if canImport(UIKit)
import UIKit
import UserNotifications

/// The phone's side of pushes: asks for permission, hands the device token
/// to the push server, and turns a tapped banner into a link for the shell.
/// The server writes the words; this only registers and routes.
@MainActor
public final class PushRegistrar: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// The one the app installed. With scenes, the delegate is not told
    /// about activation; AppShell is, through scenePhase, and reaches the
    /// registrar here.
    public private(set) static weak var current: PushRegistrar?

    private let config = PushConfig.from(bundle: .main)
    private let account = PushConfig.account(forBundleIdentifier: Bundle.main.bundleIdentifier)
    private var deviceToken: Data?
    private var registrationDue = false

    public override init() {
        super.init()
        Self.current = self
    }

    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        ask()
        return true
    }

    /// One prompt for everything the shell wants — alerts, sound and badge —
    /// then the badge that waited on it, and Apple's token if pushes are in.
    private func ask() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            Task { @MainActor in
                BadgeController.shared.reapply()
                guard granted else { return }
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Called by AppShell when the scene becomes active.
    public func becameActive() {
        // Whatever was announced is on screen now
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        if registrationDue {
            Task { await register() }
        }
    }

    public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        self.deviceToken = deviceToken
        Task { await register() }
    }

    public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        print("[push] Apple would not register this device: \(error.localizedDescription)")
    }

    /// Tells the server about this device. A failure is remembered and tried
    /// again on the next activation, never shown.
    private func register() async {
        guard let config, let account, let deviceToken else { return }
        registrationDue = false
        do {
            let (_, response) = try await URLSession.shared.data(for: config.registration(account: account, deviceToken: deviceToken))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            registrationDue = !(200..<300).contains(status)
            if registrationDue { print("[push] the push server answered \(status)") }
        } catch {
            registrationDue = true
            print("[push] the push server was unreachable: \(error.localizedDescription)")
        }
    }

    // MARK: UNUserNotificationCenterDelegate

    /// Only consulted while the app is in front, where the page is on
    /// screen: the badge applies, the banner and sound do not.
    nonisolated public static let foregroundPresentation: UNNotificationPresentationOptions = [.badge]

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler(Self.foregroundPresentation)
    }

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let url = PushPayload.url(from: response.notification.request.content.userInfo)
        Task { @MainActor in
            if let url { PendingLinks.shared.open(url) }
            completionHandler()
        }
    }
}
#endif
```

- [ ] **Step 2: Install it in both apps, and let AppShell reach it**

In `Apps/Personal/PersonalApp.swift`, after the `profile` property:

```swift
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PushRegistrar.self) private var pushRegistrar
    #endif
```

The same lines in `Apps/Work/WorkApp.swift`.

In `AppShell.swift`, inside the iOS `.onChange(of: scenePhase)` from Task 10, add the line `PushRegistrar.current?.becameActive()` after `BadgeController.shared.reapply()`, so the block reads:

```swift
            if scenePhase == .active {
                BadgeController.shared.reapply()
                PushRegistrar.current?.becameActive()
            }
```

- [ ] **Step 3: Build iOS, then the rest**

Run: `make build-ios`
Expected: BUILD SUCCEEDED twice. This is the only build that compiles `PushRegistrar`; fix any Swift 6 isolation diagnostics here, keeping the class `@MainActor` and the two delegate callbacks `nonisolated` as written.

Run: `make test`
Expected: green (the file is compiled out on macOS; the Node tests run last).

- [ ] **Step 4: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/PushRegistrar.swift Apps/Personal/PersonalApp.swift Apps/Work/WorkApp.swift
git commit -m "feat(ios): ask once, register the device with the push server, and open a tapped push"
```

---

### Task 12: Rollout (the user's, with their secrets)

Nothing here is for a subagent: every step needs the user's accounts, keys or devices. Present it as the checklist it is.

- [ ] **Step 1: Server** — follow `Server/README.md` steps 1–5 on the host. `GET /healthz` shows both accounts; `notices` is `push` with `verified: true`, or `eventsource`.
- [ ] **Step 2: App configuration** — `PUSH_SERVER_HOST` and `PUSH_DEVICE_SECRET` in `Config/Local.xcconfig`.
- [ ] **Step 3: Deploy** — `make deploy` (the user runs it). On the iPhone, allow notifications when asked. If the badge-only prompt was answered earlier, turn Alerts on under Settings → Notifications → the app, or delete and reinstall. `healthz` now shows `devices: 1` per account with an app that launched.
- [ ] **Step 4: End to end** — with the app closed, send a mail to the account: a banner within seconds naming the sender and subject, the badge equal to the Triage count. Archive a message on the Mac: the badge drops. Tap a banner: the thread opens. Unlock the iPad and repeat `make deploy` so it gets the same.
- [ ] **Step 5: Push the commits** — only when the user says so.
