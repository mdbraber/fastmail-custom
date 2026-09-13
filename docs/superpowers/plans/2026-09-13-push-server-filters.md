# Push Server Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The push server learns each device's notification choice (Off, Important, All in inbox, Custom) and alerts every device only for the new messages its own choice matches, reading VIPs, contacts and followed conversations from Fastmail.

**Architecture:**
- **The choice** is validated in a new `Server/src/choice.js`. `POST /devices` stores it in the registry as `notify`, and a record from before the change still reads through its `alerts`.
- **The rule** is one pure function, `matchesChoice(notify, email, context)`, in `Server/src/notify.js`.
- **Reading from Fastmail.** `Server/src/jmap.js` learns whether the token reads contacts, and reads contact cards, threads and keywords. The new `Server/src/contacts.js` turns the cards into two address sets.
- **The watcher** (`Server/src/watcher.js`) keeps the address sets current: at start-up, and whenever a notice carries a new `ContactCard` state. It subscribes to `ContactCard` only with contacts access. It sends per device instead of broadcasting, and reports `contacts` and `modes` in `/healthz`.

**Tech Stack:** Node 22+ ES modules with no dependencies; tests in `node:test` with `node:assert/strict` (`cd /Users/mdbraber/src/fastmail-custom/Server && npm test`); JMAP core and mail (RFC 8620/8621), JMAP for Contacts (RFC 9610) with JSContact cards (RFC 9553); APNs.

**Spec:** `docs/superpowers/specs/2026-09-13-device-settings-design.md`, "Part 2: the push server's filters". The cross-plan contract below refines it and wins where they differ.

## Global Constraints

**Rules every plan of this work carries**
- Commit messages end with exactly:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
  ```
- Stage only the task's own files by path; never `git add -A`, `git add .` or `git commit -a`. Other sessions commit to this repository.
- No host names of the push server and no tokens or secrets in tracked files. `Server/.env` and `Server/secrets/` are git-ignored and stay so.
- Never write Fastmail's own data or preferences: not per-mailbox `splits` or `sort`, not `notificationsMail`, `notificationsMailboxes`, `notificationsFilter` or any other Fastmail preference. Never choose an option in Fastmail's Group/Sort menu in a probe.
- `make install-*`, `make deploy`, a server redeploy and any change on the push server's host happen only with the user's go-ahead given at that time; a plan step that needs one says "ask the user" and stops there.
- Live probes run against the installed Mac app with `osascript -e 'tell application "mdbraber.com" to do JavaScript (read POSIX file "<probe path>" as «class utf8»)'` (the script is a function body that may `await` and must `return` a string; see `/Users/mdbraber/.claude/projects/-Users-mdbraber-src-fastmail-custom/memory/probing-the-mac-app-live.md`). A probe must not touch real settings or storage, must restore any patch and close any menu or modal in `finally`, and must leave the app on mail.
- The full test suite is `make test` (Swift package tests, the IntegrationTests scheme, `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`, `node --check` of the userscript and the Safari extension scripts).

**Server contract (shared with plans 1 and 3; use these names exactly)**
- `POST /devices` body: `{ account, token, alerts?, notify? }`, `notify = { mode, senders?, mailboxIds? }`.
  - `mode` required when `notify` is present: `off` | `important` | `inbox` | `custom`.
  - `senders`: `everyone` | `contacts` | `vips`, default `everyone`.
  - `mailboxIds`: array of at most 200 non-empty strings, default `[]`.
  - Invalid → 400 `{ error: "<field> ..." }` naming the field.
  - No `notify` → from `alerts` (true or absent → `{mode:"inbox"}`, false → `{mode:"off"}`). Both present → `notify` wins.
  - Reply 200: `{ ok: true, notify: <normalised {mode, senders, mailboxIds}>, contacts: <boolean> }`.
- The app (plan 3) sends both `notify` and `alerts: mode !== "off"`, so a server that predates plan 2 still gets a sensible on/off.

**This plan's own rules**
- Only files under `Server/` change. No new npm dependencies; `Server/package.json` is unchanged.
- The error fields are spelled `notify`, `notify.mode`, `notify.senders`, `notify.mailboxIds` and `alerts`.
- The normalised `notify` keeps `mailboxIds` exactly as sent, in order and without de-duplication, because plan 3 compares what it sent with what was accepted.
- `devices.json` on the host is never rewritten by hand or by a migration. Old records carrying `alerts` read correctly as they are and are replaced only when that device registers again.
- Every task ends with `cd /Users/mdbraber/src/fastmail-custom/Server && npm test` passing. The last code task also runs `make test`.
- The push server's host is never named. The update procedure is called "the existing update steps".

## Facts this plan builds on

Read from the code on 2026-09-13; `npm test` passed 83 of 83 before any change.

- **The session.** `JMAPClient.connect()` (`Server/src/jmap.js:49-56`) stores the whole session in `this.session` and takes `accountId` from `primaryAccounts['urn:ietf:params:jmap:mail']`. Every other call goes through `call(method, args, using)`, whose `using` defaults to `[CORE, MAIL]`.
- **Notices carry types and states.** A `StateChange` body is `{ '@type': 'StateChange', changed: { <accountId>: { <Type>: <state> } } }`, both from push callbacks (`http.js` → `watcher.receive`) and from the event source (`runEventSource` → `watcher.receive`). Today `receive` (`watcher.js:173-176`) only asks whether `Email` or `Mailbox` is present under the mail account and throws the states away. So no new plumbing is needed: `receive` reads `changed[contactsAccountId].ContactCard` itself.
- **Types are named in two places:** `subscribePush` (`types: TYPES`, `watcher.js:117`) and `startEventSource` (`eventSourceURL(..., { types: TYPES })`, `watcher.js:141`).
- **Sending today.**
  - `process` (`watcher.js:192-228`) selects Inbox messages with `selectNotifiable`.
  - It broadcasts each alert to devices with alerts on, and a badge-only push to muted devices (or to everyone when there was no new mail).
  - `broadcast` (`watcher.js:333-349`) drops a device APNs calls dead and logs other failures.
- **The registry** (`devices.js`) stores `{ registeredAt, alerts }` per token; `tokens(account, { alerts })` treats a missing `alerts` as on. Nothing rewrites `devices.json` on load.
- **The app reads only the reply's status.** `PushRegistrar.send()` (`Packages/FastmailShellKit/Sources/FastmailShellKit/PushRegistrar.swift:164-178`) looks at the HTTP status and never at the body, so dropping `alerts` from the reply breaks no build that is installed today.
- **How a tapped notification opens.**
  - `AppShell` hands the url to `WebContainer.load` (`WebContainer.swift:293-314`).
  - When the page is already on a Fastmail host, it steps inside the page with `history.pushState(null, '', path)` followed by a `popstate` event (`WebContainer.stepScript`).
  - Otherwise it loads the url.
- **Mailbox addresses.** The shell already spells a nested mailbox as its path of names joined by `/`, each segment percent-encoded: `HomeShortcuts` turns "Projects/Work" into `/mail/Projects/Work` and "R&D" into `/mail/R%26D` (`HomeShortcutsTests.swift:98-100`).
- **The userscript's reachable Fastmail API**, used by the link probe, all in `Userscript/fastmail-custom-mode.user.js`:
  - `FastMail.store.getAll(FastMail.classes.Mailbox)` (line 633)
  - `message.get('thread')` and `thread.get('messages')` (lines 3722-3723)
  - `message.get('mailboxes')` (line 3737)
  - `mailbox.get('parent')` (line 534)
  - `FastMail.router.getAppController('mail').get('message')` (line 3946)
  - `getUrlForMessage(message)` (line 4702)
  - `FastMail.store.getQuery(FastMail.classes.Message.getQueryId(params), FastMail.classes.MessageList, params)` with `where`, `sort` and `collapseThreads` (lines 810-833)

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `Server/src/choice.js` | Create (Task 1) | The choice's names and limits; validating a registration; reading a stored record, old or new |
| `Server/src/devices.js` | Modify (Tasks 1, 5) | Stores `{registeredAt, notify}`; `entries(account)` lists `{token, notify}` |
| `Server/src/http.js` | Modify (Task 1) | `POST /devices` takes `notify` or `alerts` and replies `{ok, notify, contacts}` |
| `Server/src/notify.js` | Modify (Tasks 2, 5, 6 if needed) | `selectFresh`, `senderAddress`, `matchesChoice`; the payloads; the link |
| `Server/src/contacts.js` | Create (Task 3) | Contact cards → `{ contacts, vips }` address sets |
| `Server/src/jmap.js` | Modify (Task 3) | `CONTACTS`, `contactsAccountId`, `getInChunks`, `threads`, `keywords`, `contactCards` |
| `Server/src/watcher.js` | Modify (Tasks 4, 5, 6 if needed) | Contacts at start-up and on change; types; per-device sending; health |
| `Server/test/choice.test.js`, `Server/test/contacts.test.js` | Create | Tests for the new modules |
| `Server/test/devices.test.js`, `http.test.js`, `notify.test.js`, `jmap.test.js`, `watcher.test.js` | Modify | Tests alongside each change |
| `Server/README.md`, `Server/.env.example` | Modify (Task 5) | Token scope, the choices, `/healthz` fields |
| Scratchpad, never committed | Create (Tasks 6, 7) | `link-probe.js`, `contacts-check.mjs` |

`$SCRATCH` below means `/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad`.

---
### Task 1: Registration carries the choice

**Files:**
- Create: `Server/src/choice.js`
- Modify: `Server/src/devices.js` (whole file below)
- Modify: `Server/src/http.js:1-4` (imports) and `:29-43` (the `POST /devices` block)
- Create: `Server/test/choice.test.js`
- Modify: `Server/test/devices.test.js` (whole file below)
- Modify: `Server/test/http.test.js:1-76` (fixture and the two registration tests)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `choice.js` exports:
    - `MODES`: `['off','important','inbox','custom']`, frozen
    - `SENDERS`: `['everyone','contacts','vips']`, frozen
    - `MAX_MAILBOX_IDS`: `200`
    - `fromAlerts(alerts) → {mode, senders, mailboxIds}`
    - `normaliseNotify(value) → { notify } | { error }`
    - `registrationChoice(body) → { notify } | { error }`
    - `storedChoice(record) → {mode, senders, mailboxIds}`
  - `DeviceRegistry`:
    - `entries(account) → [{ token, notify }]`
    - `register(account, token, { notify })`, where `notify` defaults to `fromAlerts(true)`
    - `tokens(account, { alerts })` keeps working, derived from `notify.mode !== 'off'`, until Task 5 removes the option
  - `POST /devices` replies `{ ok: true, notify, contacts }`. `contacts` is `watchers[account].hasContacts === true`; Task 4 adds that getter, so the reply says `false` until then.

- [ ] **Step 1: Write the failing tests**

Create `Server/test/choice.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MAILBOX_IDS, normaliseNotify, registrationChoice, storedChoice } from '../src/choice.js';

const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [] };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [] };

test('a full choice is kept as sent', () => {
    assert.deepEqual(
        normaliseNotify({ mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'] }),
        { notify: { mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'] } },
    );
});

test('senders and mailboxIds are filled in when absent', () => {
    assert.deepEqual(normaliseNotify({ mode: 'important' }), { notify: { mode: 'important', senders: 'everyone', mailboxIds: [] } });
    assert.deepEqual(normaliseNotify({ mode: 'custom', mailboxIds: [] }), { notify: { mode: 'custom', senders: 'everyone', mailboxIds: [] } });
});

test('each malformed field is refused, naming the field', () => {
    assert.match(normaliseNotify(null).error, /^notify /);
    assert.match(normaliseNotify(['inbox']).error, /^notify /);
    assert.match(normaliseNotify('inbox').error, /^notify /);
    assert.match(normaliseNotify({}).error, /^notify\.mode /);
    assert.match(normaliseNotify({ mode: 'loud' }).error, /^notify\.mode /);
    assert.match(normaliseNotify({ mode: 'custom', senders: 'friends' }).error, /^notify\.senders /);
    assert.match(normaliseNotify({ mode: 'custom', senders: null }).error, /^notify\.senders /);
    assert.match(normaliseNotify({ mode: 'custom', mailboxIds: 'P2F' }).error, /^notify\.mailboxIds /);
    assert.match(normaliseNotify({ mode: 'custom', mailboxIds: [''] }).error, /^notify\.mailboxIds /);
    assert.match(normaliseNotify({ mode: 'custom', mailboxIds: [7] }).error, /^notify\.mailboxIds /);
    const tooMany = Array.from({ length: MAX_MAILBOX_IDS + 1 }, (_, index) => `M${index}`);
    assert.match(normaliseNotify({ mode: 'custom', mailboxIds: tooMany }).error, /^notify\.mailboxIds /);
    assert.equal(normaliseNotify({ mode: 'custom', mailboxIds: tooMany.slice(1) }).notify.mailboxIds.length, MAX_MAILBOX_IDS);
});

test('without notify the alerts switch decides: absent or true is inbox, false is off', () => {
    assert.deepEqual(registrationChoice({}), { notify: INBOX });
    assert.deepEqual(registrationChoice({ alerts: true }), { notify: INBOX });
    assert.deepEqual(registrationChoice({ alerts: false }), { notify: OFF });
    assert.equal(registrationChoice({ alerts: 'no' }).error, 'alerts must be true or false');
    assert.equal(registrationChoice({ alerts: null }).error, 'alerts must be true or false');
});

test('with both, notify wins', () => {
    assert.deepEqual(registrationChoice({ alerts: false, notify: { mode: 'inbox' } }), { notify: INBOX });
    assert.deepEqual(registrationChoice({ alerts: true, notify: { mode: 'off' } }), { notify: OFF });
    assert.match(registrationChoice({ alerts: true, notify: { mode: 'loud' } }).error, /^notify\.mode /);
});

test('a stored record reads its notify, and an old one its alerts', () => {
    assert.deepEqual(storedChoice({ registeredAt: 'x', notify: { mode: 'custom', senders: 'contacts', mailboxIds: ['L1'] } }),
        { mode: 'custom', senders: 'contacts', mailboxIds: ['L1'] });
    assert.deepEqual(storedChoice({ registeredAt: 'x', alerts: false }), OFF);
    assert.deepEqual(storedChoice({ registeredAt: 'x', alerts: true }), INBOX);
    assert.deepEqual(storedChoice({ registeredAt: 'x' }), INBOX);
    assert.deepEqual(storedChoice(undefined), INBOX);
    // A record someone edited by hand into nonsense falls back to its switch
    assert.deepEqual(storedChoice({ notify: { mode: 'loud' }, alerts: false }), OFF);
});
```

Replace the whole of `Server/test/devices.test.js` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeviceRegistry, isDeviceToken } from '../src/devices.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'a'.repeat(64);
const other = 'b'.repeat(64);
const scratch = async () => path.join(await mkdtemp(path.join(os.tmpdir(), 'devices-')), 'devices.json');
const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [] };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [] };

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
    await registry.register('work', other);

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.tokens('personal'), [token]);
    assert.deepEqual(again.tokens('work'), [other]);
    assert.deepEqual(again.tokens('other'), []);

    await again.remove('personal', token.toUpperCase());
    await again.remove('personal', token.toUpperCase());
    assert.deepEqual(again.tokens('personal'), []);
});

test('each device keeps its own choice, stored as notify, across a reload', async () => {
    const file = await scratch();
    const custom = { mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'] };
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    await registry.register('personal', token);
    await registry.register('personal', other.toUpperCase(), { notify: custom });

    assert.deepEqual(registry.entries('personal'), [{ token, notify: INBOX }, { token: other, notify: custom }]);
    assert.deepEqual(registry.entries('work'), []);

    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(Object.keys(stored.personal[other]).sort(), ['notify', 'registeredAt']);
    assert.deepEqual(stored.personal[other].notify, custom);

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.entries('personal'), [{ token, notify: INBOX }, { token: other, notify: custom }]);

    // Registering again replaces the choice
    await again.register('personal', other, { notify: OFF });
    assert.deepEqual(again.entries('personal')[1], { token: other, notify: OFF });
});

test('a registry file from before notify reads its alerts as inbox or off, without being rewritten', async () => {
    const legacy = await scratch();
    const text = JSON.stringify({
        personal: {
            [token]: { registeredAt: '2026-09-01T00:00:00Z' },
            [other]: { registeredAt: '2026-09-02T00:00:00Z', alerts: false },
        },
        work: { ['c'.repeat(64)]: { registeredAt: '2026-09-03T00:00:00Z', alerts: true } },
    }, null, 2);
    await writeFile(legacy, text);
    const old = new DeviceRegistry(legacy, silent);
    await old.load();
    assert.deepEqual(old.entries('personal'), [{ token, notify: INBOX }, { token: other, notify: OFF }]);
    assert.deepEqual(old.entries('work'), [{ token: 'c'.repeat(64), notify: INBOX }]);
    assert.equal(await readFile(legacy, 'utf8'), text);
});

// Until the watcher sends per device it still asks for the devices with alerts on or off
test('tokens still split on alerts, now read from the choice', async () => {
    const registry = new DeviceRegistry(await scratch(), silent);
    await registry.load();
    await registry.register('personal', token, { notify: { mode: 'important', senders: 'everyone', mailboxIds: [] } });
    await registry.register('personal', other, { notify: OFF });
    assert.deepEqual(registry.tokens('personal', { alerts: true }), [token]);
    assert.deepEqual(registry.tokens('personal', { alerts: false }), [other]);
});

// Two phones registering at once, or a registration racing a prune, would
// otherwise write the same .tmp file and rename it out from under each other
test('registrations that arrive together both survive', async () => {
    const file = await scratch();
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    await Promise.all([registry.register('personal', token), registry.register('personal', other)]);

    const again = new DeviceRegistry(file, silent);
    await again.load();
    assert.deepEqual(again.tokens('personal').sort(), [token, other].sort());
});

test('an unreadable registry starts empty', async () => {
    const file = await scratch();
    await writeFile(file, '[[[');
    const registry = new DeviceRegistry(file, silent);
    await registry.load();
    assert.deepEqual(registry.tokens('personal'), []);
});
```

In `Server/test/http.test.js`, replace lines 1-76, from the first `import` through the closing `});` of the test `'a registration can turn alerts off for that device, and only with a real boolean'`, with the following. Lines 78 onward (`'Fastmail notices reach the watcher only with the right secret'` and after) stay as they are.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http.js';

const silent = { warn() {}, info() {}, error() {} };
const token = 'c'.repeat(64);
const sealedNotice = { '@type': 'StateChange', changed: { acc1: { Email: 's7' } } };
const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [] };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [] };

async function running() {
    const received = [];
    const registered = [];
    const watchers = {
        personal: {
            callbackSecret: 'abc123',
            hasContacts: true,
            status: () => ({ notices: 'push', verified: true, lastNotice: null, devices: 1 }),
            receive: async (body) => { received.push(body); },
            // The real one unseals RFC 8291; here "sealed" is the only body that opens
            unseal: (raw) => (raw.equals(Buffer.from('sealed')) ? sealedNotice : null),
        },
    };
    const done = [];
    for (const verb of ['archive', 'later', 'pin']) {
        watchers.personal[verb] = async (emailId) => {
            if (emailId === 'M-missing') throw new Error('no such message');
            done.push([verb, emailId]);
        };
    }
    const devices = { register: async (account, value, options) => { registered.push([account, value, options]); } };
    const server = createServer({ config: { deviceSecret: 's3cret' }, watchers, devices, log: silent });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, watchers, received, registered, done, close: () => new Promise((resolve) => server.close(resolve)) };
}

const register = (s, body) => fetch(`${s.base}/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer s3cret' },
    body: JSON.stringify(body),
});

test('healthz reports every account', async () => {
    const s = await running();
    const response = await fetch(`${s.base}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accounts: { personal: { notices: 'push', verified: true, lastNotice: null, devices: 1 } } });
    await s.close();
});

test('device registration needs the bearer, a known account and a real token', async () => {
    const s = await running();
    const post = (headers, body) => fetch(`${s.base}/devices`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

    assert.equal((await post({}, { account: 'personal', token })).status, 401);
    assert.equal((await post({ authorization: 'Bearer wrong' }, { account: 'personal', token })).status, 401);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: 'work', token })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: 'personal', token: 'nope' })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: '__proto__', token })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: 'constructor', token })).status, 400);
    assert.equal((await post({ authorization: 'Bearer s3cret' }, { account: ['personal'], token })).status, 400);
    const ok = await post({ authorization: 'Bearer s3cret' }, { account: 'personal', token });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, notify: INBOX, contacts: true });
    assert.deepEqual(s.registered, [['personal', token, { notify: INBOX }]]);
    await s.close();
});

test('an older app build registers with alerts alone: true is inbox, false is off, anything else refused', async () => {
    const s = await running();
    try {
        assert.equal((await register(s, { account: 'personal', token, alerts: 'no' })).status, 400);
        assert.equal((await register(s, { account: 'personal', token, alerts: 0 })).status, 400);
        const refused = await register(s, { account: 'personal', token, alerts: null });
        assert.equal(refused.status, 400);
        assert.deepEqual(await refused.json(), { error: 'alerts must be true or false' });
        assert.equal(s.registered.length, 0);

        const on = await register(s, { account: 'personal', token, alerts: true });
        assert.deepEqual(await on.json(), { ok: true, notify: INBOX, contacts: true });
        const off = await register(s, { account: 'personal', token, alerts: false });
        assert.equal(off.status, 200);
        assert.deepEqual(await off.json(), { ok: true, notify: OFF, contacts: true });
        assert.deepEqual(s.registered, [['personal', token, { notify: INBOX }], ['personal', token, { notify: OFF }]]);
    } finally {
        await s.close();
    }
});

test('a registration carrying notify is stored and answered normalised', async () => {
    const s = await running();
    try {
        const custom = await register(s, { account: 'personal', token, notify: { mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'] } });
        assert.equal(custom.status, 200);
        const choice = { mode: 'custom', senders: 'vips', mailboxIds: ['P2F', 'P3V'] };
        assert.deepEqual(await custom.json(), { ok: true, notify: choice, contacts: true });

        const important = await register(s, { account: 'personal', token, notify: { mode: 'important' } });
        const filled = { mode: 'important', senders: 'everyone', mailboxIds: [] };
        assert.deepEqual(await important.json(), { ok: true, notify: filled, contacts: true });
        assert.deepEqual(s.registered, [['personal', token, { notify: choice }], ['personal', token, { notify: filled }]]);
    } finally {
        await s.close();
    }
});

test('each malformed notify field is a 400 naming it, and nothing is stored', async () => {
    const s = await running();
    try {
        const cases = [
            [{ notify: null }, /^notify /],
            [{ notify: { senders: 'vips' } }, /^notify\.mode /],
            [{ notify: { mode: 'loud' } }, /^notify\.mode /],
            [{ notify: { mode: 'custom', senders: 'friends' } }, /^notify\.senders /],
            [{ notify: { mode: 'custom', mailboxIds: 'P2F' } }, /^notify\.mailboxIds /],
            [{ notify: { mode: 'custom', mailboxIds: [''] } }, /^notify\.mailboxIds /],
            [{ notify: { mode: 'custom', mailboxIds: Array.from({ length: 201 }, (_, index) => `M${index}`) } }, /^notify\.mailboxIds /],
        ];
        for (const [extra, pattern] of cases) {
            const response = await register(s, { account: 'personal', token, ...extra });
            assert.equal(response.status, 400, JSON.stringify(extra).slice(0, 80));
            assert.match((await response.json()).error, pattern);
        }
        assert.equal(s.registered.length, 0);
    } finally {
        await s.close();
    }
});

test('with both fields notify wins, and the reply says whether contacts can be read', async () => {
    const s = await running();
    try {
        const both = await register(s, { account: 'personal', token, alerts: true, notify: { mode: 'off' } });
        assert.deepEqual(await both.json(), { ok: true, notify: OFF, contacts: true });

        s.watchers.personal.hasContacts = false;
        const without = await register(s, { account: 'personal', token, alerts: false, notify: { mode: 'important' } });
        assert.deepEqual(await without.json(), { ok: true, notify: { mode: 'important', senders: 'everyone', mailboxIds: [] }, contacts: false });
    } finally {
        await s.close();
    }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: FAIL.
- `choice.test.js` fails with `ERR_MODULE_NOT_FOUND` for `../src/choice.js`.
- `devices.test.js` fails in `'each device keeps its own choice…'` and `'a registry file from before notify…'` with `registry.entries is not a function`.
- `http.test.js` fails its registration tests, because the reply is still `{ ok: true, alerts: true }`.

- [ ] **Step 3: Write the implementation**

Create `Server/src/choice.js`:

```js
// A device's choice of which new messages alert it: as the app sends it to
// POST /devices, and as the registry keeps it.

export const MODES = Object.freeze(['off', 'important', 'inbox', 'custom']);
export const SENDERS = Object.freeze(['everyone', 'contacts', 'vips']);
export const MAX_MAILBOX_IDS = 200;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The choice an app build from before `notify` meant with its one switch.
export function fromAlerts(alerts) {
    return { mode: alerts === false ? 'off' : 'inbox', senders: 'everyone', mailboxIds: [] };
}

// `notify` checked and filled in: { notify } or { error } naming the field.
// The mailbox ids are kept exactly as sent, in their order: the app compares
// what it sent with what was accepted.
export function normaliseNotify(value) {
    if (!isPlainObject(value)) return { error: 'notify must be an object' };
    if (!MODES.includes(value.mode)) return { error: `notify.mode must be one of ${MODES.join(', ')}` };
    const senders = value.senders === undefined ? 'everyone' : value.senders;
    if (!SENDERS.includes(senders)) return { error: `notify.senders must be one of ${SENDERS.join(', ')}` };
    const mailboxIds = value.mailboxIds === undefined ? [] : value.mailboxIds;
    if (!Array.isArray(mailboxIds) || mailboxIds.length > MAX_MAILBOX_IDS
        || !mailboxIds.every((id) => typeof id === 'string' && id.length > 0)) {
        return { error: `notify.mailboxIds must be an array of at most ${MAX_MAILBOX_IDS} non-empty strings` };
    }
    return { notify: { mode: value.mode, senders, mailboxIds: [...mailboxIds] } };
}

// A registration's choice: `notify` when it is there, otherwise the older
// `alerts` switch, where no value means on. A malformed `alerts` is refused
// either way.
export function registrationChoice(body) {
    if (body.alerts !== undefined && typeof body.alerts !== 'boolean') return { error: 'alerts must be true or false' };
    if (body.notify !== undefined) return normaliseNotify(body.notify);
    return { notify: fromAlerts(body.alerts) };
}

// What a registry record asks for. A record from before `notify` carries
// `alerts` and reads the way that switch did; the file is never rewritten
// for it.
export function storedChoice(record) {
    if (record?.notify !== undefined) {
        const { notify } = normaliseNotify(record.notify);
        if (notify) return notify;
    }
    return fromAlerts(record?.alerts);
}
```

Replace the whole of `Server/src/devices.js` with:

```js
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fromAlerts, storedChoice } from './choice.js';

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
        this.saving = Promise.resolve();
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

    // Every device of the account with the choice it registered. A record
    // from before `notify` reads through its `alerts`.
    entries(account) {
        const records = this.devices[account] || {};
        return Object.keys(records).map((token) => ({ token, notify: storedChoice(records[token]) }));
    }

    // Every token for the account, or only those whose choice is not off
    // (alerts: true) or is off (alerts: false).
    tokens(account, { alerts } = {}) {
        return this.entries(account)
            .filter(({ notify }) => alerts === undefined || alerts === (notify.mode !== 'off'))
            .map(({ token }) => token);
    }

    // Registering again is how a device changes its mind
    async register(account, token, { notify = fromAlerts(true) } = {}) {
        (this.devices[account] ??= {})[token.toLowerCase()] = { registeredAt: new Date().toISOString(), notify };
        await this.save();
    }

    async remove(account, token) {
        const lower = token.toLowerCase();
        if (!this.devices[account]?.[lower]) return;
        delete this.devices[account][lower];
        await this.save();
    }

    // One write at a time: a registration and a prune arriving together would
    // otherwise share the one .tmp file, and the loser renames a file that is
    // already gone.
    save() {
        this.saving = this.saving.catch(() => {}).then(() => this.write());
        return this.saving;
    }

    async write() {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(this.devices, null, 2));
        await rename(`${this.file}.tmp`, this.file);
    }
}
```

In `Server/src/http.js`, add the import after `import { isDeviceToken } from './devices.js';`:

```js
import { registrationChoice } from './choice.js';
```

and replace the block from `if (request.method === 'POST' && url.pathname === '/devices') {` through its closing `}` (lines 29-43) with:

```js
    if (request.method === 'POST' && url.pathname === '/devices') {
        if (!bearerMatches(request.headers.authorization, config.deviceSecret)) {
            return reply(response, 401, { error: 'unauthorized' });
        }
        const body = await readJSON(request);
        // An array of one name would pass hasOwn on its toString, so insist on a string
        if (!body || typeof body.account !== 'string' || !Object.hasOwn(watchers, body.account) || !isDeviceToken(body.token)) {
            return reply(response, 400, { error: 'account and token required' });
        }
        // The device's choice; an app build from before it sends only its switch
        const { notify, error } = registrationChoice(body);
        if (error) return reply(response, 400, { error });
        await devices.register(body.account, body.token, { notify });
        // Whether the account's token can read contacts: without, VIPs and contacts match nobody
        return reply(response, 200, { ok: true, notify, contacts: watchers[body.account].hasContacts === true });
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: PASS, `ℹ tests 94`, `ℹ fail 0`. The watcher's tests still pass unchanged, because `tokens(account, { alerts })` still answers.

- [ ] **Step 5: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Server/src/choice.js Server/src/devices.js Server/src/http.js Server/test/choice.test.js Server/test/devices.test.js Server/test/http.test.js
git commit -F - <<'EOF'
feat: a device registers its notification choice with the push server

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---
### Task 2: The rule

**Files:**
- Modify: `Server/src/notify.js:1-10` (add three functions after `selectNotifiable`)
- Modify: `Server/test/notify.test.js:1-3` (imports) and after line 30 (new tests)

**Interfaces:**
- Consumes: the choice shape `{ mode, senders, mailboxIds }` from Task 1.
- Produces, in `notify.js`:
  - `selectFresh(emails, { notified: Set<string> }) → emails`: unseen, not a draft, not announced, in any mailbox
  - `senderAddress(email) → string | null`: the first `from` address, lowercased
  - `matchesChoice(notify, email, context) → boolean`, with `context = { inboxId, junkId, trashId, vips: Set<string>, contacts: Set<string>, followedThreadIds: Set<string> }`; the addresses in both sets are lowercased, and `junkId`/`trashId` may be null
  - `selectNotifiable` stays until Task 5 removes it

- [ ] **Step 1: Write the failing tests**

In `Server/test/notify.test.js`, replace the import on line 3 with:

```js
import {
    selectNotifiable, selectFresh, senderAddress, matchesChoice, senderName, alertPayload, badgePayload, threadURL,
} from '../src/notify.js';
```

Then insert the following directly after the test `'outside the Inbox, seen, draft, or already announced do not'` (after its closing `});`, line 30):

```js

// The choices below decide where a message has to be; before them, only
// whether it is news at all.
test('fresh means unseen, not a draft and not announced, wherever the message is', () => {
    const candidates = [
        email({ id: 'filed', mailboxIds: { 'mbx-other': true } }),
        email({ id: 'seen', keywords: { $seen: true } }),
        email({ id: 'draft', keywords: { $draft: true } }),
        email({ id: 'done' }),
        email({ id: 'new' }),
    ];
    assert.deepEqual(selectFresh(candidates, { notified: new Set(['done']) }).map((e) => e.id), ['filed', 'new']);
});

test('the sender address is the first from, lowercased, or nothing', () => {
    assert.equal(senderAddress(email({ from: [{ name: 'Ada', email: 'Ada@Example.NET' }, { email: 'b@example.net' }] })), 'ada@example.net');
    assert.equal(senderAddress(email({ from: [] })), null);
    assert.equal(senderAddress(email({ from: null })), null);
    assert.equal(senderAddress(email({ from: [{ name: 'No address' }] })), null);
});

const JUNK = 'mbx-junk';
const TRASH = 'mbx-trash';
const LABEL = 'mbx-label';
const OTHER_LABEL = 'mbx-label-2';
const context = (over = {}) => ({
    inboxId: inbox,
    junkId: JUNK,
    trashId: TRASH,
    vips: new Set(['vip@example.net']),
    contacts: new Set(['vip@example.net', 'friend@example.net']),
    followedThreadIds: new Set(),
    ...over,
});
const from = (address) => [{ name: 'Someone', email: address }];
const choice = (mode, over = {}) => ({ mode, senders: 'everyone', mailboxIds: [], ...over });

test('off never matches', () => {
    assert.equal(matchesChoice(choice('off'), email({ from: from('vip@example.net') }), context()), false);
    assert.equal(matchesChoice(choice('off'), email({ keywords: { $followed: true } }), context()), false);
});

test('an unknown or missing choice matches nothing', () => {
    assert.equal(matchesChoice({ mode: 'loud' }, email(), context()), false);
    assert.equal(matchesChoice(undefined, email(), context()), false);
});

test('inbox matches what is in the Inbox, from anyone, and nothing else', () => {
    assert.equal(matchesChoice(choice('inbox'), email({ from: from('stranger@example.net') }), context()), true);
    assert.equal(matchesChoice(choice('inbox'), email({ mailboxIds: { [LABEL]: true } }), context()), false);
});

test('important matches a VIP anywhere but Junk and Trash', () => {
    const vip = { from: from('vip@example.net') };
    assert.equal(matchesChoice(choice('important'), email(vip), context()), true);
    assert.equal(matchesChoice(choice('important'), email({ ...vip, mailboxIds: { [LABEL]: true } }), context()), true);
    assert.equal(matchesChoice(choice('important'), email({ ...vip, mailboxIds: { [JUNK]: true } }), context()), false);
    assert.equal(matchesChoice(choice('important'), email({ ...vip, mailboxIds: { [TRASH]: true } }), context()), false);
    assert.equal(matchesChoice(choice('important'), email({ from: from('friend@example.net') }), context()), false);
    assert.equal(matchesChoice(choice('important'), email({ from: [] }), context()), false);
});

test('important matches a followed conversation, by the message itself or another in its thread', () => {
    const stranger = { from: from('stranger@example.net') };
    assert.equal(matchesChoice(choice('important'), email({ ...stranger, keywords: { $followed: true } }), context()), true);
    assert.equal(matchesChoice(choice('important'), email(stranger), context({ followedThreadIds: new Set(['T1']) })), true);
    assert.equal(matchesChoice(choice('important'), email(stranger), context({ followedThreadIds: new Set(['T2']) })), false);
});

test('an account without Junk or Trash still lets a VIP through', () => {
    const vip = email({ from: from('vip@example.net') });
    assert.equal(matchesChoice(choice('important'), vip, context({ junkId: null, trashId: null })), true);
});

test('custom needs one of its labels', () => {
    const custom = choice('custom', { mailboxIds: [LABEL, OTHER_LABEL] });
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [OTHER_LABEL]: true } }), context()), true);
    assert.equal(matchesChoice(custom, email({ mailboxIds: { [inbox]: true } }), context()), false);
});

test('custom with an empty label list matches nothing', () => {
    assert.equal(matchesChoice(choice('custom'), email({ from: from('vip@example.net') }), context()), false);
});

test('custom senders: everyone, contacts, or VIPs', () => {
    const inLabel = (address) => email({ mailboxIds: { [LABEL]: true }, from: from(address) });
    const everyone = choice('custom', { mailboxIds: [LABEL] });
    const contacts = choice('custom', { mailboxIds: [LABEL], senders: 'contacts' });
    const vips = choice('custom', { mailboxIds: [LABEL], senders: 'vips' });

    assert.equal(matchesChoice(everyone, inLabel('stranger@example.net'), context()), true);
    assert.equal(matchesChoice(everyone, email({ mailboxIds: { [LABEL]: true }, from: [] }), context()), true);

    assert.equal(matchesChoice(contacts, inLabel('friend@example.net'), context()), true);
    assert.equal(matchesChoice(contacts, inLabel('vip@example.net'), context()), true);
    assert.equal(matchesChoice(contacts, inLabel('stranger@example.net'), context()), false);
    assert.equal(matchesChoice(contacts, email({ mailboxIds: { [LABEL]: true }, from: [] }), context()), false);

    assert.equal(matchesChoice(vips, inLabel('vip@example.net'), context()), true);
    assert.equal(matchesChoice(vips, inLabel('friend@example.net'), context()), false);
});

test('a sender written in capitals is still a VIP and a contact', () => {
    const shouted = { from: from('VIP@Example.NET') };
    assert.equal(matchesChoice(choice('important'), email(shouted), context()), true);
    assert.equal(matchesChoice(choice('custom', { mailboxIds: [inbox], senders: 'contacts' }), email(shouted), context()), true);
});

test('without contacts access the sets are empty and those rules match nobody', () => {
    const empty = context({ vips: new Set(), contacts: new Set() });
    assert.equal(matchesChoice(choice('important'), email({ from: from('vip@example.net') }), empty), false);
    assert.equal(matchesChoice(choice('custom', { mailboxIds: [inbox], senders: 'vips' }), email(), empty), false);
    assert.equal(matchesChoice(choice('custom', { mailboxIds: [inbox], senders: 'contacts' }), email(), empty), false);
    assert.equal(matchesChoice(choice('inbox'), email(), empty), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: FAIL. `notify.test.js` does not load: `SyntaxError: The requested module '../src/notify.js' does not provide an export named 'matchesChoice'` (or `selectFresh`).

- [ ] **Step 3: Write the implementation**

In `Server/src/notify.js`, insert directly after the closing `}` of `selectNotifiable` (line 10):

```js

// The messages worth putting to each device's choice: unread, not a draft,
// and not announced before. Where they are is the choice's business.
export function selectFresh(emails, { notified }) {
    return emails.filter((email) =>
        !email.keywords?.$seen
        && !email.keywords?.$draft
        && !notified.has(email.id));
}

// The first sender's address, lowercased so a VIP matches however it is written.
export function senderAddress(email) {
    const address = email.from?.[0]?.email;
    return typeof address === 'string' && address ? address.toLowerCase() : null;
}

const carries = (email, id) => Boolean(id) && email.mailboxIds?.[id] === true;

/*
 * Whether one device's choice wants a banner for one fresh message.
 *
 * `context` holds what the message alone does not say: `inboxId`, `junkId`
 * and `trashId` (null when the account has none), the sets `vips` and
 * `contacts` of lowercased addresses, and `followedThreadIds`, the threads
 * in which some message carries `$followed`.
 */
export function matchesChoice(notify, email, context) {
    const sender = senderAddress(email);
    switch (notify?.mode) {
    case 'inbox':
        return carries(email, context.inboxId);
    case 'important': {
        const discarded = carries(email, context.junkId) || carries(email, context.trashId);
        const vip = sender !== null && context.vips.has(sender);
        const followed = Boolean(email.keywords?.$followed) || context.followedThreadIds.has(email.threadId);
        return (!discarded && vip) || followed;
    }
    case 'custom': {
        if (!notify.mailboxIds.some((id) => carries(email, id))) return false;
        if (notify.senders === 'contacts') return sender !== null && context.contacts.has(sender);
        if (notify.senders === 'vips') return sender !== null && context.vips.has(sender);
        return true;
    }
    default:
        return false;
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: PASS, `ℹ tests 107`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Server/src/notify.js Server/test/notify.test.js
git commit -F - <<'EOF'
feat: one rule decides which new message a device's choice wants

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---
### Task 3: Reading contacts, threads and keywords from Fastmail

**Files:**
- Create: `Server/src/contacts.js`
- Modify: `Server/src/jmap.js:6-7` (constants), `:27-29` (constructor), `:53-55` (`connect`), `:114-123` (`emails`)
- Create: `Server/test/contacts.test.js`
- Modify: `Server/test/jmap.test.js:14-34` (`fakeFetch`, `connected`) and the end of the file (new tests)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `contacts.js` exports:
    - `VIPS_UID = 'vips'`
    - `addressSets(cards) → { contacts: Set<string>, vips: Set<string> }`, with addresses trimmed and lowercased
  - `jmap.js` exports `CONTACTS = 'urn:ietf:params:jmap:contacts'` and `CONTACT_CARD_PROPERTIES = ['id','uid','kind','members','emails']`.
  - On `JMAPClient`:
    - `contactsAccountId`: `string | null`, set by `connect()`
    - `getInChunks(method, ids, args, using) → list`
    - `threads(ids) → [{ id, emailIds }]`
    - `keywords(ids) → [{ id, keywords }]`
    - `contactCards() → { cards, state }`; it throws a `JMAPError` without contacts access

- [ ] **Step 1: Write the failing tests**

Create `Server/test/contacts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressSets } from '../src/contacts.js';

const card = (uid, addresses, over = {}) => ({
    id: `id-${uid}`,
    uid,
    kind: 'individual',
    emails: Object.fromEntries(addresses.map((address, index) => [`e${index}`, { address }])),
    ...over,
});

test('every address on a card that is not a group is a contact, lowercased', () => {
    const { contacts, vips } = addressSets([
        card('ada', ['Ada@Example.net', ' ada@work.example ']),
        card('bob', ['bob@example.net']),
        card('team', ['team@example.net'], { kind: 'group', members: { ada: true } }),
        card('org', ['info@example.org'], { kind: 'org' }),
        { id: 'id-bare', uid: 'bare' },
    ]);
    assert.deepEqual([...contacts].sort(), ['ada@example.net', 'ada@work.example', 'bob@example.net', 'info@example.org']);
    assert.deepEqual([...vips], []);
});

test('a card without a kind is an individual', () => {
    const { contacts } = addressSets([{ id: 'x', uid: 'x', emails: { e: { address: 'x@example.net' } } }]);
    assert.deepEqual([...contacts], ['x@example.net']);
});

test('VIPs are the addresses on the cards the vips group names by uid', () => {
    const { contacts, vips } = addressSets([
        card('ada', ['ada@example.net']),
        card('bob', ['bob@example.net']),
        card('cy', ['cy@example.net']),
        card('vips', [], { id: 'not-the-uid', kind: 'group', members: { ada: true, 'id-bob': true, cy: false } }),
    ]);
    assert.deepEqual([...vips], ['ada@example.net']);
    assert.deepEqual([...contacts].sort(), ['ada@example.net', 'bob@example.net', 'cy@example.net']);
});

test('a card named vips that is not a group is not the VIPs group', () => {
    const { vips } = addressSets([
        card('ada', ['ada@example.net']),
        card('vips', ['someone@example.net'], { members: { ada: true } }),
    ]);
    assert.deepEqual([...vips], []);
});

test('no cards, no addresses', () => {
    const { contacts, vips } = addressSets([]);
    assert.equal(contacts.size, 0);
    assert.equal(vips.size, 0);
});
```

In `Server/test/jmap.test.js`, replace `fakeFetch` and `connected` (lines 13-34) with:

```js
// A stand-in for fetch: answers by method name, records every call.
function fakeFetch(answer, sessionBody = session) {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url: String(url), headers: init.headers, body });
        if (String(url).endsWith('/session')) return { ok: true, status: 200, json: async () => sessionBody };
        const responses = body.methodCalls.map(([method, args, id]) => {
            const [name, result] = answer(method, args, calls);
            return [name, result, id];
        });
        return { ok: true, status: 200, json: async () => ({ methodResponses: responses }) };
    };
    return { fetch, calls };
}

async function connected(answer, sessionBody) {
    const { fetch, calls } = fakeFetch(answer, sessionBody);
    const client = new JMAPClient({ token: 'tok', fetch });
    await client.connect();
    return { client, calls };
}
```

and append at the end of the file:

```js

// A session whose token also reads contacts, from an account of its own so
// the two cannot be confused.
const CONTACTS_URN = 'urn:ietf:params:jmap:contacts';
const withContacts = {
    ...session,
    capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {}, [CONTACTS_URN]: {} },
    accounts: {
        acc1: { accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } },
        acc2: { accountCapabilities: { [CONTACTS_URN]: {} } },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acc1', [CONTACTS_URN]: 'acc2' },
};

test('contacts access is read from the session, and the contacts account from primaryAccounts', async () => {
    assert.equal((await connected(() => ['error', {}])).client.contactsAccountId, null);
    assert.equal((await connected(() => ['error', {}], withContacts)).client.contactsAccountId, 'acc2');

    const noCapability = { ...withContacts, capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {} } };
    assert.equal((await connected(() => ['error', {}], noCapability)).client.contactsAccountId, null);

    const noPrimary = { ...withContacts, primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acc1' } };
    assert.equal((await connected(() => ['error', {}], noPrimary)).client.contactsAccountId, null);

    const accountWithout = { ...withContacts, accounts: { ...withContacts.accounts, acc2: { accountCapabilities: {} } } };
    assert.equal((await connected(() => ['error', {}], accountWithout)).client.contactsAccountId, null);
});

test('contact cards are read from the contacts account with the contacts capability, page by page', async () => {
    const all = Array.from({ length: 1200 }, (_, index) => `C${index}`);
    const { client, calls } = await connected((method, args) => {
        if (method === 'ContactCard/get' && args.ids.length === 0) return ['ContactCard/get', { state: 'cs1', list: [] }];
        if (method === 'ContactCard/query') {
            return ['ContactCard/query', { ids: all.slice(args.position, args.position + args.limit), position: args.position, total: all.length }];
        }
        if (method === 'ContactCard/get') return ['ContactCard/get', { state: 'cs1', list: args.ids.map((id) => ({ id, uid: id })) }];
        return ['error', { type: 'unknownMethod' }];
    }, withContacts);

    const { cards, state } = await client.contactCards();
    assert.equal(state, 'cs1');
    assert.deepEqual(cards.map((card) => card.id), all);

    const api = calls.slice(1).map((call) => call.body);
    assert.ok(api.every((body) => JSON.stringify(body.using) === JSON.stringify(['urn:ietf:params:jmap:core', CONTACTS_URN])));
    assert.ok(api.every((body) => body.methodCalls[0][1].accountId === 'acc2'));
    assert.deepEqual(api[0].methodCalls[0], ['ContactCard/get', { accountId: 'acc2', ids: [] }, 'c0']);
    const queries = api.filter((body) => body.methodCalls[0][0] === 'ContactCard/query').map((body) => body.methodCalls[0][1].position);
    assert.deepEqual(queries, [0, 500, 1000]);
    const gets = api.slice(1).filter((body) => body.methodCalls[0][0] === 'ContactCard/get').map((body) => body.methodCalls[0][1]);
    assert.deepEqual(gets.map((args) => args.ids.length), [500, 500, 200]);
    assert.deepEqual(gets[0].properties, ['id', 'uid', 'kind', 'members', 'emails']);
});

test('an account without cards reads as none, and a token without contacts is refused before asking', async () => {
    const { client } = await connected((method) => (method === 'ContactCard/query'
        ? ['ContactCard/query', { ids: [], position: 0, total: 0 }]
        : ['ContactCard/get', { state: 'cs0', list: [] }]), withContacts);
    assert.deepEqual(await client.contactCards(), { cards: [], state: 'cs0' });

    const { client: mailOnly, calls } = await connected(() => ['error', {}]);
    await assert.rejects(mailOnly.contactCards(), /cannot read contacts/);
    assert.equal(calls.length, 1);
});

test('threads and their keywords are asked of the mail account, in helpings', async () => {
    const { client, calls } = await connected((method, args) => (method === 'Thread/get'
        ? ['Thread/get', { list: args.ids.map((id) => ({ id, emailIds: [`${id}-a`, `${id}-b`] })) }]
        : ['Email/get', { list: args.ids.map((id) => ({ id, keywords: {} })) }]));

    assert.deepEqual(await client.threads(['T1']), [{ id: 'T1', emailIds: ['T1-a', 'T1-b'] }]);
    assert.deepEqual(calls.at(-1).body.methodCalls[0], ['Thread/get', { accountId: 'acc1', ids: ['T1'] }, 'c0']);
    assert.deepEqual(calls.at(-1).body.using, ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail']);

    const ids = Array.from({ length: 700 }, (_, index) => `M${index}`);
    assert.equal((await client.keywords(ids)).length, 700);
    const asked = calls.slice(-2).map((call) => call.body.methodCalls[0][1]);
    assert.deepEqual(asked.map((args) => args.ids.length), [500, 200]);
    assert.deepEqual(asked[0].properties, ['keywords']);
    assert.deepEqual(await client.threads([]), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: FAIL.
- `contacts.test.js` fails with `ERR_MODULE_NOT_FOUND` for `../src/contacts.js`.
- In `jmap.test.js`, the contacts-access test fails with `undefined !== null`, and the other three fail with `client.contactCards is not a function` or `client.threads is not a function`.

- [ ] **Step 3: Write the implementation**

Create `Server/src/contacts.js`:

```js
// Contact cards (JSContact, RFC 9553, as JMAP serves them in RFC 9610) into
// the two sets of addresses the rules ask about. Pure.

// Fastmail keeps VIPs as a group card with this uid in the primary contacts
// account; its `members` name cards by uid, not by id.
export const VIPS_UID = 'vips';

const addressesOn = (card) => Object.values(card?.emails ?? {})
    .map((entry) => (typeof entry?.address === 'string' ? entry.address.trim().toLowerCase() : ''))
    .filter(Boolean);

// `contacts`: every address on a card that is not a group. `vips`: every
// address on a card the VIPs group names.
export function addressSets(cards) {
    const group = cards.find((card) => card?.kind === 'group' && card.uid === VIPS_UID);
    const members = new Set(Object.entries(group?.members ?? {}).filter(([, on]) => on === true).map(([uid]) => uid));
    const contacts = new Set();
    const vips = new Set();
    for (const card of cards) {
        const addresses = addressesOn(card);
        if (card?.kind !== 'group') for (const address of addresses) contacts.add(address);
        if (typeof card?.uid === 'string' && members.has(card.uid)) for (const address of addresses) vips.add(address);
    }
    return { contacts, vips };
}
```

In `Server/src/jmap.js`:

1. Replace the line `export const EMAIL_PROPERTIES = ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'subject', 'receivedAt'];` with:

```js
export const CONTACTS = 'urn:ietf:params:jmap:contacts';
export const EMAIL_PROPERTIES = ['id', 'threadId', 'mailboxIds', 'keywords', 'from', 'subject', 'receivedAt'];
export const CONTACT_CARD_PROPERTIES = ['id', 'uid', 'kind', 'members', 'emails'];
```

2. In the constructor, after `this.accountId = null;`, add:

```js
        this.contactsAccountId = null;
```

3. In `connect()`, replace

```js
        if (!this.accountId) throw new JMAPError('session: no mail account');
        return this.session;
```

with

```js
        if (!this.accountId) throw new JMAPError('session: no mail account');
        // Contacts only when the token grants them: the capability in the
        // session, a primary contacts account, and that account holding it
        const contactsAccountId = this.session.primaryAccounts?.[CONTACTS] ?? null;
        const granted = Boolean(this.session.capabilities?.[CONTACTS])
            && typeof contactsAccountId === 'string'
            && Boolean(this.session.accounts?.[contactsAccountId]?.accountCapabilities?.[CONTACTS]);
        this.contactsAccountId = granted ? contactsAccountId : null;
        return this.session;
```

4. Replace the whole `async emails(ids) { … }` method (lines 114-123) with:

```js
    // A /get for any number of ids, in helpings Fastmail will accept, as one list.
    async getInChunks(method, ids, args, using) {
        const list = [];
        for (let from = 0; from < ids.length; from += GET_CHUNK) {
            const result = await this.call(method, { ...args, ids: ids.slice(from, from + GET_CHUNK) }, using);
            list.push(...result.list);
        }
        return list;
    }

    async emails(ids) {
        return this.getInChunks('Email/get', ids, { accountId: this.accountId, properties: EMAIL_PROPERTIES });
    }

    // Each thread with the ids of its messages: `{ id, emailIds }`.
    async threads(ids) {
        return this.getInChunks('Thread/get', ids, { accountId: this.accountId });
    }

    // Only the keywords of each message: `{ id, keywords }`.
    async keywords(ids) {
        return this.getInChunks('Email/get', ids, { accountId: this.accountId, properties: ['keywords'] });
    }

    // Every contact card of the contacts account, and the ContactCard state
    // read before them: a change made while they are read then shows up as a
    // newer state, and they are read again.
    async contactCards() {
        const accountId = this.contactsAccountId;
        if (!accountId) throw new JMAPError('ContactCard: this token cannot read contacts');
        const using = [CORE, CONTACTS];
        const { state } = await this.call('ContactCard/get', { accountId, ids: [] }, using);
        const ids = [];
        for (;;) {
            const page = await this.call('ContactCard/query', { accountId, position: ids.length, limit: GET_CHUNK, calculateTotal: true }, using);
            ids.push(...page.ids);
            if (page.ids.length === 0 || (Number.isInteger(page.total) && ids.length >= page.total)) break;
        }
        const cards = await this.getInChunks('ContactCard/get', ids, { accountId, properties: CONTACT_CARD_PROPERTIES }, using);
        return { cards, state };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: PASS, `ℹ tests 116`, `ℹ fail 0`. The existing tests `'emails asks for exactly the properties…'` and `'a backlog is fetched in helpings…'` still pass through `getInChunks`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Server/src/contacts.js Server/src/jmap.js Server/test/contacts.test.js Server/test/jmap.test.js
git commit -F - <<'EOF'
feat: the push server can read contacts, VIPs and followed threads

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---
### Task 4: The watcher keeps the contacts current

**Files:**
- Modify: `Server/src/watcher.js`:
  - the imports (line 2)
  - `TYPES` (line 15)
  - the constructor (after line 34)
  - the getters (line 50)
  - `connect` (lines 73-74)
  - `subscribePush` (line 117)
  - `startEventSource` (line 141)
  - `receive` (lines 173-176)
  - `process` (lines 192-193)
  - a new `loadContacts` before `badgeCount` (line 328)
  - `status` (line 363)
- Modify: `Server/test/watcher.test.js`: `fakeJMAP` (lines 21-26 and 53-54) and the end of the file (new tests)

**Interfaces:**
- Consumes (Task 3):
  - `jmap.contactsAccountId`
  - `jmap.contactCards() → { cards, state }`
  - `addressSets(cards) → { contacts, vips }`
- Produces, on `AccountWatcher`:
  - `hasContacts`: a boolean getter
  - `types`: a getter, `['Email','Mailbox']` or `['Email','Mailbox','ContactCard']`
  - `contactAddresses` and `vipAddresses`: `Set<string>`
  - `contactsState`: `string | null`
  - `contactsDue`: boolean
  - `loadContacts()`
  - `status().contacts`: boolean
- `http.js` from Task 1 now answers `contacts` truthfully through `hasContacts`.

- [ ] **Step 1: Write the failing tests**

In `Server/test/watcher.test.js`, replace the first lines of `fakeJMAP`, from `function fakeJMAP({ emails = [], …` through `fetch: async () => { throw new Error('no network in tests'); },`, with:

```js
function fakeJMAP({
    emails = [], created = [], counts = { badge: 4 }, refusePush = false, changesError = null,
    contactsAccountId = null, cards = [], cardState = 'cs1',
} = {}) {
    const calls = [];
    const fake = {
        calls, counts, refusePush, onCreate: null,
        accountId: 'acc1', eventSourceUrl: 'https://api.example.net/jmap/event/',
        // `cards`, `cardState` and `cardsError` are properties so a test can
        // change the address book between looks
        contactsAccountId, cards, cardState, cardsError: null,
        contactCards: async () => {
            calls.push(['contacts']);
            if (fake.cardsError) throw fake.cardsError;
            return { cards: fake.cards, state: fake.cardState };
        },
        fetch: async (url) => { calls.push(['eventsource', String(url)]); throw new Error('no network in tests'); },
```

In the same fake, replace

```js
        createPushSubscription: async ({ url, keys }) => {
            calls.push(['subscribe', url, keys]);
```

with

```js
        createPushSubscription: async ({ url, keys, types }) => {
            calls.push(['subscribe', url, keys, types]);
```

Append at the end of the file:

```js


// Contacts and VIPs. The tokens may or may not read contacts, and the
// watcher has to work either way.
const person = (uid, address) => ({ id: `id-${uid}`, uid, kind: 'individual', emails: { e1: { address } } });
const addressBook = () => [
    person('ada', 'Ada@Example.net'),
    person('bob', 'bob@example.net'),
    { id: 'id-vips', uid: 'vips', kind: 'group', members: { ada: true } },
];

test('ContactCard is subscribed to only when the token can read contacts', async () => {
    const without = await setUp();
    assert.deepEqual(without.jmap.calls.find((c) => c[0] === 'subscribe')[3], ['Email', 'Mailbox']);

    const withAccess = await setUp({ contactsAccountId: 'acc2' });
    assert.deepEqual(withAccess.jmap.calls.find((c) => c[0] === 'subscribe')[3], ['Email', 'Mailbox', 'ContactCard']);

    // The event source asks for the same types
    const plain = await setUp({ refusePush: true });
    const fallback = await setUp({ refusePush: true, contactsAccountId: 'acc2' });
    try {
        assert.equal(new URL(plain.jmap.calls.find((c) => c[0] === 'eventsource')[1]).searchParams.get('types'), 'Email,Mailbox');
        assert.equal(new URL(fallback.jmap.calls.find((c) => c[0] === 'eventsource')[1]).searchParams.get('types'), 'Email,Mailbox,ContactCard');
    } finally {
        plain.watcher.stop();
        fallback.watcher.stop();
    }
});

test('the contact sets are built from the cards and the VIPs group when the watcher starts', async () => {
    const t = await setUp({ contactsAccountId: 'acc2', cards: addressBook() });
    assert.deepEqual([...t.watcher.contactAddresses].sort(), ['ada@example.net', 'bob@example.net']);
    assert.deepEqual([...t.watcher.vipAddresses], ['ada@example.net']);
    assert.equal(t.watcher.contactsState, 'cs1');
});

test('a ContactCard change reads the cards again; a notice carrying the state already read does not', async () => {
    const t = await setUp({ contactsAccountId: 'acc2', cards: addressBook() });
    const reads = () => t.jmap.calls.filter((c) => c[0] === 'contacts').length;
    assert.equal(reads(), 1);

    await t.watcher.receive({ '@type': 'StateChange', changed: { acc2: { ContactCard: 'cs1' } } });
    await settle(t);
    assert.equal(reads(), 1);
    assert.equal(t.jmap.calls.filter((c) => c[0] === 'changes').length, 0);

    // Bob becomes a VIP; the notice names the contacts account, not the mail one
    t.jmap.cards = [...addressBook().slice(0, 2), { id: 'id-vips', uid: 'vips', kind: 'group', members: { ada: true, bob: true } }];
    t.jmap.cardState = 'cs2';
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc2: { ContactCard: 'cs2' } } });
    await settle(t);
    assert.equal(reads(), 2);
    assert.deepEqual([...t.watcher.vipAddresses].sort(), ['ada@example.net', 'bob@example.net']);
    assert.equal(t.watcher.contactsState, 'cs2');

    // The same kind of type under the mail account's id is not ours to read
    await t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { ContactCard: 'cs3' } } });
    await settle(t);
    assert.equal(reads(), 2);
});

test('cards that cannot be read are tried again at the next look', async () => {
    const t = await build({ contactsAccountId: 'acc2', cards: addressBook() });
    t.jmap.cardsError = new JMAPError('ContactCard/query: serverFail', { type: 'serverFail' });
    await t.watcher.start();
    assert.equal(t.watcher.notices, 'push', 'the mail is watched regardless');
    assert.equal(t.watcher.vipAddresses.size, 0);
    assert.equal(t.watcher.contactsDue, true);

    t.jmap.cardsError = null;
    t.watcher.notice('poll');
    await settle(t);
    assert.deepEqual([...t.watcher.vipAddresses], ['ada@example.net']);
    assert.equal(t.watcher.contactsDue, false);
});

test('without contacts access nothing is read, the sets stay empty, and health says so', async () => {
    const without = await setUp({ cards: addressBook() });
    assert.equal(without.jmap.calls.filter((c) => c[0] === 'contacts').length, 0);
    assert.equal(without.watcher.vipAddresses.size, 0);
    assert.equal(without.watcher.contactAddresses.size, 0);
    assert.equal(without.watcher.hasContacts, false);
    assert.equal(without.watcher.status().contacts, false);

    const withAccess = await setUp({ contactsAccountId: 'acc2', cards: addressBook() });
    assert.equal(withAccess.watcher.hasContacts, true);
    assert.equal(withAccess.watcher.status().contacts, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: FAIL. The five new watcher tests fail:
- The subscription types element is `undefined` for `['Email','Mailbox','ContactCard']`.
- `t.watcher.contactAddresses` is `undefined` (`TypeError: … is not iterable`).
- `status().contacts` is `undefined`.

Every earlier test still passes.

- [ ] **Step 3: Write the implementation**

In `Server/src/watcher.js`:

1. After `import { alertPayload, badgePayload, selectNotifiable } from './notify.js';` add:

```js
import { addressSets } from './contacts.js';
```

2. Replace `const TYPES = ['Email', 'Mailbox'];` with:

```js
const MAIL_TYPES = ['Email', 'Mailbox'];
const CONTACT_TYPE = 'ContactCard';
```

3. In the constructor, replace

```js
        this.archiveMailboxId = null;
        this.notices = null;
```

with

```js
        this.archiveMailboxId = null;
        // The account's contacts as two sets of lowercased addresses, and the
        // ContactCard state they were read at; empty without contacts access
        this.contactAddresses = new Set();
        this.vipAddresses = new Set();
        this.contactsState = null;
        this.contactsDue = false;
        this.notices = null;
```

4. After `get deviceClientId() { return `fastmail-push-${this.name}`; }` add:

```js
    // Known once the session is read; false until then
    get hasContacts() { return Boolean(this.jmap.contactsAccountId); }
    // ContactCard only with contacts access: a subscription naming a type
    // the token may not read would be refused
    get types() { return this.hasContacts ? [...MAIL_TYPES, CONTACT_TYPE] : MAIL_TYPES; }
```

5. In `connect()`, replace

```js
        if (!this.archiveMailboxId) this.log.warn(`[${this.name}] no Archive folder: the notification's Archive button is off`);
        if (!this.state.emailState) await this.resync();
```

with

```js
        if (!this.archiveMailboxId) this.log.warn(`[${this.name}] no Archive folder: the notification's Archive button is off`);
        if (!this.hasContacts) this.log.warn(`[${this.name}] the token cannot read contacts: VIPs and contacts match nobody`);
        await this.loadContacts();
        if (!this.state.emailState) await this.resync();
```

6. In `subscribePush()`, replace `types: TYPES,` with `types: this.types,`.

7. In `startEventSource()`, replace `url: eventSourceURL(this.jmap.eventSourceUrl, { types: TYPES }),` with `url: eventSourceURL(this.jmap.eventSourceUrl, { types: this.types }),`.

8. In `receive()`, replace

```js
        if (body?.['@type'] === 'StateChange') {
            const changed = body.changed?.[this.jmap.accountId];
            if (changed && TYPES.some((type) => type in changed)) this.notice('change');
        }
```

with

```js
        if (body?.['@type'] === 'StateChange') {
            const mail = body.changed?.[this.jmap.accountId];
            // A notice names each changed type with its new state; the cards
            // are read again only when theirs is not the state already read
            const cards = this.hasContacts ? body.changed?.[this.jmap.contactsAccountId]?.[CONTACT_TYPE] : undefined;
            const cardsChanged = cards !== undefined && cards !== this.contactsState;
            if (cardsChanged) this.contactsDue = true;
            if (cardsChanged || (mail && MAIL_TYPES.some((type) => type in mail))) this.notice('change');
        }
```

9. In `process()`, replace

```js
    async process(source) {
        let changes;
```

with

```js
    async process(source) {
        // Before the mail, so a VIP added a moment ago already counts
        if (this.contactsDue) await this.loadContacts();
        let changes;
```

10. Directly before `async badgeCount() {` add:

```js
    // Both address sets, read afresh. Cards that cannot be read leave the
    // sets as they were and are tried again at the next look, so a hiccup
    // at Fastmail costs VIP alerts for a while, never every alert.
    async loadContacts() {
        this.contactsDue = false;
        if (!this.hasContacts) {
            this.contactAddresses = new Set();
            this.vipAddresses = new Set();
            return;
        }
        try {
            const { cards, state } = await this.jmap.contactCards();
            const { contacts, vips } = addressSets(cards);
            this.contactAddresses = contacts;
            this.vipAddresses = vips;
            this.contactsState = state;
            this.log.info(`[${this.name}] contacts read: ${contacts.size} addresses, ${vips.size} VIP`);
        } catch (error) {
            this.contactsDue = true;
            this.log.warn(`[${this.name}] contacts unreadable (${error.message}); trying again at the next look`);
        }
    }

```

11. In `status()`, replace

```js
            muted: this.devices.tokens(this.name, { alerts: false }).length,
        };
```

with

```js
            muted: this.devices.tokens(this.name, { alerts: false }).length,
            contacts: this.hasContacts,
        };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: PASS, `ℹ tests 121`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Server/src/watcher.js Server/test/watcher.test.js
git commit -F - <<'EOF'
feat: the push server keeps each account's contacts and VIPs current

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---
### Task 5: Each device gets what its own choice asks for

**Files:**
- Modify: `Server/src/watcher.js`:
  - the imports
  - the constructor (junk and trash ids)
  - `connect` (the junk and trash roles)
  - `process` (sending per device)
  - `broadcast`, replaced by `contextFor`, `followedThreads` and `send`
  - `status` (`modes`)
- Modify: `Server/src/devices.js` (`tokens` loses its `alerts` option)
- Modify: `Server/src/notify.js` (`selectNotifiable` removed)
- Modify: `Server/test/watcher.test.js`, `Server/test/devices.test.js`, `Server/test/notify.test.js`
- Modify: `Server/README.md`, `Server/.env.example`

**Interfaces:**
- Consumes:
  - Task 1: `DeviceRegistry.entries(account) → [{ token, notify }]`, `MODES`
  - Task 2: `selectFresh`, `matchesChoice`
  - Task 3: `jmap.threads(ids)`, `jmap.keywords(ids)`
  - Task 4: `vipAddresses`, `contactAddresses`, `hasContacts`, `loadContacts`
- Produces, on `AccountWatcher`:
  - `junkId`, `trashId`
  - `contextFor(fresh, devices) → context`
  - `followedThreads(emails) → Set<threadId>`
  - `send(token, payload, collapseId) → boolean` (false when the device was dropped)
  - `status()` gains `modes: { off, important, inbox, custom }`; `muted` equals `modes.off`
- `DeviceRegistry.tokens(account)` now takes no options.

- [ ] **Step 1: Write the failing tests**

In `Server/test/watcher.test.js`:

1. In `fakeJMAP`'s parameters, replace `contactsAccountId = null, cards = [], cardState = 'cs1',` with:

```js
    contactsAccountId = null, cards = [], cardState = 'cs1', threadMessages = {},
```

2. Directly after the fake's `fetch: async (url) => { … },` line, add:

```js
        // `threadMessages`: thread id → its messages with their keywords
        threadsError: null,
        threads: async (ids) => {
            calls.push(['threads', ids]);
            if (fake.threadsError) throw fake.threadsError;
            return ids.map((id) => ({ id, emailIds: (threadMessages[id] ?? []).map((message) => message.id) }));
        },
        keywords: async (ids) => {
            calls.push(['keywords', ids]);
            return Object.values(threadMessages).flat()
                .filter((message) => ids.includes(message.id))
                .map(({ id, keywords }) => ({ id, keywords }));
        },
```

3. In the fake's `mailboxes`, after `{ id: 'archive', name: 'Archive', role: 'archive', hidden: 0 },` add:

```js
            { id: 'junk', name: 'Spam', role: 'junk', hidden: 0 },
            { id: 'trash', name: 'Trash', role: 'trash', hidden: 0 },
```

4. Replace the whole `function fakeDevices(tokens, muted = []) { … }` with:

```js
const INBOX = { mode: 'inbox', senders: 'everyone', mailboxIds: [] };
const OFF = { mode: 'off', senders: 'everyone', mailboxIds: [] };

// Each token with its choice: inbox, unless `choices` names another
function fakeDevices(tokens, choices = {}) {
    const removed = [];
    const live = () => tokens.filter((t) => !removed.includes(t));
    return {
        removed,
        entries: () => live().map((token) => ({ token, notify: choices[token] ?? INBOX })),
        remove: async (_, t) => { removed.push(t); },
    };
}
```

5. In the test `'one new Inbox message becomes one alert per device, carrying the badge, and is remembered'`, replace

```js
    const saved = await loadState(t.dir, 'personal', silent);
    assert.deepEqual(saved, { emailState: 's1', notified: ['M1'], badge: 4 });
```

with

```js
    // M2 was put to every device too, and matched none: it counts as announced
    const saved = await loadState(t.dir, 'personal', silent);
    assert.deepEqual(saved, { emailState: 's1', notified: ['M1', 'M2'], badge: 4 });
```

6. Replace the first four lines of the test `'a device with alerts off hears only the count, and the count still follows every change'` with:

```js
test('a device whose choice is off hears only the count, and the count still follows every change', async () => {
    const created = ['M1'];
    const emails = [arrival('M1')];
    const t = await setUp({ created, emails }, { devices: fakeDevices(['tok1', 'tok2'], { tok2: OFF }) });
```

7. Append at the end of the file:

```js


// Each device its own choice: the four side by side, on one batch. Ada is a
// VIP, Bob a contact; M5's thread is followed through another message.
const choices = {
    'tok-inbox': INBOX,
    'tok-important': { mode: 'important', senders: 'everyone', mailboxIds: [] },
    'tok-custom': { mode: 'custom', senders: 'contacts', mailboxIds: ['kerk'] },
    'tok-off': OFF,
};
const batch = () => ({
    contactsAccountId: 'acc1',
    cards: addressBook(),
    created: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
    emails: [
        arrival('M1', { from: [{ email: 'stranger@example.net' }] }),
        arrival('M2', { mailboxIds: { kerk: true }, from: [{ email: 'bob@example.net' }] }),
        arrival('M3', { from: [{ name: 'Ada', email: 'ada@example.net' }] }),
        arrival('M4', { mailboxIds: { junk: true }, from: [{ email: 'ADA@example.net' }] }),
        arrival('M5', { mailboxIds: { later: true }, from: [{ email: 'stranger@example.net' }] }),
        arrival('M6', { keywords: { $seen: true }, from: [{ email: 'ada@example.net' }] }),
    ],
    threadMessages: {
        'T-M5': [{ id: 'M5', keywords: {} }, { id: 'M0', keywords: { $followed: true } }],
    },
});
const newMail = (t) => t.watcher.receive({ '@type': 'StateChange', changed: { acc1: { Email: 's1' } } });
const heardBy = (t, tokens) => Object.fromEntries(tokens.map((token) => [
    token, t.apns.sent.filter((s) => s.token === token).map((s) => [s.collapseId, s.payload.aps.badge]),
]));

test('each device hears the new messages its own choice matches', async () => {
    const t = await setUp(batch(), { devices: fakeDevices(Object.keys(choices), choices) });
    await newMail(t);
    await settle(t);
    assert.deepEqual(heardBy(t, Object.keys(choices)), {
        'tok-inbox': [['M1', 4], ['M3', 4]],
        'tok-important': [['M3', 4], ['M5', 4]],
        'tok-custom': [['M2', 4]],
        'tok-off': [],
    });
    const alert = t.apns.sent.find((s) => s.token === 'tok-custom');
    assert.equal(alert.payload.aps.alert.title, 'bob@example.net');
    assert.equal(alert.payload.url, 'https://app.fastmail.com/mail/Inbox/T-M2.M2');
    assert.equal(alert.topic, account.topic);
});

test('a device that got no alert hears a changed count on its own; one that got an alert has it there', async () => {
    const quiet = { ...choices, 'tok-quiet': { mode: 'custom', senders: 'vips', mailboxIds: ['kerk'] } };
    const t = await setUp(batch(), { devices: fakeDevices(Object.keys(quiet), quiet) });
    t.jmap.counts.badge = 5;
    await newMail(t);
    await settle(t);
    assert.deepEqual(heardBy(t, Object.keys(quiet)), {
        'tok-inbox': [['M1', 5], ['M3', 5]],
        'tok-important': [['M3', 5], ['M5', 5]],
        'tok-custom': [['M2', 5]],
        'tok-off': [['badge', 5]],
        'tok-quiet': [['badge', 5]],
    });
    assert.deepEqual(t.apns.sent.find((s) => s.token === 'tok-off').payload, { aps: { badge: 5 } });
});

test('followed threads are looked up only when a device asks for Important, and only for fresh messages', async () => {
    const withoutImportant = { 'tok-inbox': INBOX, 'tok-custom': choices['tok-custom'] };
    const t = await setUp(batch(), { devices: fakeDevices(Object.keys(withoutImportant), withoutImportant) });
    await newMail(t);
    await settle(t);
    assert.equal(t.jmap.calls.filter((c) => c[0] === 'threads' || c[0] === 'keywords').length, 0);

    const u = await setUp(batch(), { devices: fakeDevices(Object.keys(choices), choices) });
    await newMail(u);
    await settle(u);
    assert.deepEqual(u.jmap.calls.filter((c) => c[0] === 'threads').map((c) => c[1]), [['T-M1', 'T-M2', 'T-M3', 'T-M4', 'T-M5']]);
    assert.deepEqual(u.jmap.calls.filter((c) => c[0] === 'keywords').map((c) => c[1]), [['M5', 'M0']]);
});

test('a thread lookup that fails costs only the followed conversations', async () => {
    const t = await setUp(batch(), { devices: fakeDevices(['tok-important'], choices) });
    t.jmap.threadsError = new JMAPError('Thread/get: serverFail', { type: 'serverFail' });
    await newMail(t);
    await settle(t);
    assert.deepEqual(t.apns.sent.map((s) => s.collapseId), ['M3']);
});

test('a device APNs calls dead in the middle of a batch is dropped and sent nothing more', async () => {
    const apns = fakeAPNs((token) => (token === 'tok-inbox' ? { status: 410, reason: 'Unregistered' } : { status: 200, reason: null }));
    const t = await setUp(batch(), { apns, devices: fakeDevices(Object.keys(choices), choices) });
    t.jmap.counts.badge = 5;
    await newMail(t);
    await settle(t);
    assert.deepEqual(t.devices.removed, ['tok-inbox']);
    assert.deepEqual(heardBy(t, ['tok-inbox', 'tok-off']), { 'tok-inbox': [['M1', 5]], 'tok-off': [['badge', 5]] });
});

test('every fresh message is remembered for the account, whether any device was alerted or not', async () => {
    const t = await setUp(batch(), { devices: fakeDevices(['tok-off'], choices) });
    await newMail(t);
    await settle(t);
    assert.equal(t.apns.sent.length, 0);
    assert.deepEqual((await loadState(t.dir, 'personal', silent)).notified, ['M1', 'M2', 'M3', 'M4', 'M5']);
});

test('health counts the devices per choice, and muted is the ones that are off', async () => {
    const five = { ...choices, 'tok-off-2': OFF };
    const t = await setUp(undefined, { devices: fakeDevices(Object.keys(five), five) });
    assert.deepEqual(t.watcher.status(), {
        notices: 'push',
        verified: false,
        lastNotice: null,
        devices: 5,
        muted: 2,
        contacts: false,
        modes: { off: 2, important: 1, inbox: 1, custom: 1 },
    });
});
```

In `Server/test/devices.test.js`, delete the test `'tokens still split on alerts, now read from the choice'` together with the comment line above it (`// Until the watcher sends per device it still asks for the devices with alerts on or off`).

In `Server/test/notify.test.js`:
- Replace the import with:

```js
import {
    selectFresh, senderAddress, matchesChoice, senderName, alertPayload, badgePayload, threadURL,
} from '../src/notify.js';
```

- Delete the two tests `'a fresh unseen message in the Inbox notifies'` and `'outside the Inbox, seen, draft, or already announced do not'`. `'fresh means unseen, not a draft and not announced, wherever the message is'` covers the same ground now.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: FAIL. Every watcher test that processes a notice or reads `status()` fails with `TypeError: this.devices.tokens is not a function`, because the fake now has only `entries`. The other files pass.

- [ ] **Step 3: Write the implementation**

In `Server/src/watcher.js`:

1. Replace `import { alertPayload, badgePayload, selectNotifiable } from './notify.js';` with:

```js
import { alertPayload, badgePayload, matchesChoice, selectFresh } from './notify.js';
import { MODES } from './choice.js';
```

2. In the constructor, replace

```js
        this.archiveMailboxId = null;
        // The account's contacts as two sets
```

with

```js
        this.archiveMailboxId = null;
        this.junkId = null;
        this.trashId = null;
        // The account's contacts as two sets
```

3. In `connect()`, directly before `if (!this.hasContacts) this.log.warn(`, add:

```js
        // Important leaves out what Fastmail filed as junk or deleted
        this.junkId = mailboxes.find((m) => m.role === 'junk')?.id ?? null;
        this.trashId = mailboxes.find((m) => m.role === 'trash')?.id ?? null;
```

4. In `process()`, replace everything from `const emails = await this.jmap.emails(changes.created);` through `if (fresh.length) this.log.info(`[${this.name}] ${fresh.length} new (${source})`);` with:

```js
        const emails = await this.jmap.emails(changes.created);
        const fresh = selectFresh(emails, { notified: new Set(this.state.notified) });
        const devices = this.devices.entries(this.name);
        const context = await this.contextFor(fresh, devices);
        const badge = await this.badgeCount();
        const badgeChanged = badge !== null && badge !== this.state.badge;

        const alerted = new Set();
        for (const { token, notify } of devices) {
            const wanted = fresh.filter((email) => matchesChoice(notify, email, context));
            let alive = true;
            for (const email of wanted) {
                alive = await this.send(token, alertPayload(email, { badge }), email.id);
                if (!alive) break;
                alerted.add(email.id);
            }
            // An alert carries the count; a device that got none hears it on its own
            if (alive && !wanted.length && badgeChanged) await this.send(token, badgePayload(badge), 'badge');
        }

        // Announced for the account: every fresh message has been put to every device
        this.state = rememberNotified(this.state, fresh.map((email) => email.id));
        this.state.emailState = changes.newState;
        this.state.badge = badge;
        await this.persist();
        if (alerted.size) this.log.info(`[${this.name}] ${alerted.size} new (${source})`);
```

5. Replace the whole `broadcast` method, with its comment `// To every device, or only those with alerts on (true) or off (false)`, with:

```js
    // What the rules need beyond the message itself. The followed threads
    // cost two calls, so they are looked up only when a device asks for
    // Important, and only for the threads of this batch.
    async contextFor(fresh, devices) {
        const wantsImportant = devices.some(({ notify }) => notify.mode === 'important');
        return {
            inboxId: this.inboxId,
            junkId: this.junkId,
            trashId: this.trashId,
            vips: this.vipAddresses,
            contacts: this.contactAddresses,
            followedThreadIds: fresh.length && wantsImportant ? await this.followedThreads(fresh) : new Set(),
        };
    }

    // The threads of these messages in which some message carries
    // `$followed`. A lookup that fails costs the followed conversations of
    // this batch, not its other alerts.
    async followedThreads(emails) {
        try {
            const threads = await this.jmap.threads([...new Set(emails.map((email) => email.threadId).filter(Boolean))]);
            const emailIds = [...new Set(threads.flatMap((thread) => thread.emailIds ?? []))];
            const followed = new Set((await this.jmap.keywords(emailIds))
                .filter((email) => email.keywords?.$followed)
                .map((email) => email.id));
            return new Set(threads
                .filter((thread) => (thread.emailIds ?? []).some((id) => followed.has(id)))
                .map((thread) => thread.id));
        } catch (error) {
            this.log.warn(`[${this.name}] followed conversations unreadable (${error.message})`);
            return new Set();
        }
    }

    // One push to one device. False when APNs called the device dead and it
    // was dropped, so the caller sends it nothing more.
    async send(token, payload, collapseId) {
        let result;
        try {
            result = await this.apns.send(token, payload, { topic: this.account.topic, collapseId });
        } catch (error) {
            this.log.warn(`[${this.name}] apns: ${error.message}`);
            return true;
        }
        if (deviceOutcome(result.status, result.reason) === 'remove') {
            await this.devices.remove(this.name, token);
            this.log.info(`[${this.name}] dropped a dead device (${result.reason})`);
            return false;
        }
        if (result.status !== 200) this.log.warn(`[${this.name}] apns ${result.status} ${result.reason ?? ''}`);
        return true;
    }
```

6. Replace the whole `status()` method with:

```js
    status() {
        const devices = this.devices.entries(this.name);
        const modes = Object.fromEntries(MODES.map((mode) => [mode, 0]));
        for (const { notify } of devices) modes[notify.mode] += 1;
        return {
            notices: this.notices,
            verified: this.notices === 'push' ? this.verified : null,
            lastNotice: this.lastNoticeAt,
            devices: devices.length,
            // What muted always meant: no alerts, the count still arrives
            muted: modes.off,
            contacts: this.hasContacts,
            modes,
        };
    }
```

In `Server/src/devices.js`, replace the `tokens` method and its comment with:

```js
    // Every token for the account
    tokens(account) {
        return Object.keys(this.devices[account] || {});
    }
```

In `Server/src/notify.js`, delete the whole `export function selectNotifiable(emails, { inboxId, notified }) { … }` and the blank line after it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: PASS, `ℹ tests 125`, `ℹ fail 0`.

Run: `cd /Users/mdbraber/src/fastmail-custom && grep -rn 'selectNotifiable\|broadcast\|alerts: false\|alerts: true' Server/src`
Expected: no output.

- [ ] **Step 5: Update the README and the example environment**

In `Server/README.md`:

1. Replace the first paragraph's sentence

```
and sends an APNs alert for every message that lands in the Inbox, with the
number of conversations carrying the Triage label as the badge.
```

with

```
and sends each device an APNs alert for the new messages its notification
choice asks for, with the number of conversations carrying the Triage label
as the badge. The choices are the app's: Off; Important (a VIP outside Junk
and Trash, or a conversation you follow); All in inbox; and Custom (chosen
labels, from everyone, your contacts or your VIPs). An app build from before
the choices registers with its on/off switch, which reads as All in inbox or
Off.
```

2. Replace step 2 of "One-time setup"

```
2. **Fastmail tokens**; in each account: Settings → Privacy & Security →
   Manage API tokens → New API token, scope *Mail*. Not read-only: the
   buttons on a notification write, and a read-only token fails them with
   `accountReadOnly` at the moment you press one.
```

with

```
2. **Fastmail tokens**; in each account: Settings → Privacy & Security →
   Manage API tokens → New API token, scopes *Mail* and *Contacts*. Mail
   not read-only: the buttons on a notification write, and a read-only
   token fails them with `accountReadOnly` at the moment you press one.
   Contacts may be read-only; without it VIPs and contacts match nobody,
   and health says `contacts: false`.
```

3. In step 5, replace

```
   `lastNotice`, `devices` and `muted`. A muted device turned alerts off in
   the Settings app and still gets the badge. If `verified` stays `false`
```

with

```
   `lastNotice`, `devices`, `muted` (devices whose choice is Off; they
   still get the badge), `contacts` (whether the token reads contacts) and
   `modes` (devices per choice: `off`, `important`, `inbox`, `custom`).
   If `verified` stays `false`
```

In `Server/.env.example`, replace the first two lines

```
# Fastmail API tokens (Settings → Privacy & Security → Manage API tokens;
# scope: mail, read-only). Leave one empty to skip that account.
```

with

```
# Fastmail API tokens (Settings → Privacy & Security → Manage API tokens;
# scopes: Mail, not read-only, for the notification buttons, and Contacts,
# read-only, for VIPs and contacts). Leave one empty to skip that account.
```

- [ ] **Step 6: Run the full suite**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`
Expected: every part passes, including `ℹ tests 125` from the server. An integration-test crash inside AppKit's `NSWindowStackController` ("expected no items") is a known intermittent fault: re-run once and say so.

- [ ] **Step 7: Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Server/src/watcher.js Server/src/devices.js Server/src/notify.js Server/test/watcher.test.js Server/test/devices.test.js Server/test/notify.test.js Server/README.md Server/.env.example
git commit -F - <<'EOF'
feat: each device gets alerts for what its own notification choice asks for

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---
### Task 6: The link opens a message that is not in the Inbox

The spec keeps `threadURL` (`/mail/Inbox/<thread>.<email>`), but asks for a check that this address opens a message that is not in the Inbox. Important and Custom now alert for such messages. This task measures it in the running Mac app, read-only. It changes code only if the measurement says so.

**Files:**
- Scratch, never committed: `$SCRATCH/link-probe.js`
- Only in outcome A: modify `Server/src/notify.js` (the comment above `threadURL`)
- Only in outcome B: modify `Server/src/notify.js` (`mailboxPath`, `threadURL`, `alertPayload`), `Server/src/watcher.js` (`mailboxes`, the link per device), `Server/test/notify.test.js`, `Server/test/watcher.test.js`

**Interfaces:**
- Consumes: Task 5's `process()` loop, with `notify` and `alertPayload(email, { badge })`.
- Produces, in outcome B only:
  - `mailboxPath(mailbox, byId) → string`
  - `threadURL(email, { inboxId, mailboxes, preferred } = {}) → string`
  - `alertPayload(email, { badge, link })`
  - `AccountWatcher.mailboxes`: the `Mailbox/get` list read at start-up

- [ ] **Step 1: Write the probe**

The probe moves the page the same way the app does for a tapped notification (`WebContainer.stepScript`): `history.pushState` followed by a `popstate` event.

It stays read-only:
- It picks only a conversation whose every message is loaded, already `$seen`, not `$draft`, and in none of the Inbox, Drafts, Junk or Trash. Opening an unread message would mark it read, which is a write.
- If nothing loaded qualifies, it loads the Archive's newest conversations through a store query, the way the userscript's badge counts do, without showing them.
- It returns to its starting address in `finally`.

It prefers a candidate whose first mailbox (by id) is nested, so that the fallback's spelling of a nested path is exercised too.

Create `$SCRATCH/link-probe.js`:

```js
// Read-only probe: does /mail/Inbox/<thread>.<email> open a message that is
// not in the Inbox? And does /mail/<mailbox path>/<thread>.<email> open it?
// Moves only the way the app does for a tapped notification: pushState and a
// popstate. Picks only conversations whose every message is loaded, already
// read and not a draft, so opening one writes nothing. Returns to where it
// started in `finally`.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value.map === 'function') return value.map(item => item);
    if (typeof value.get === 'function') return toArray(value.get('[]'));
    if (typeof value.length === 'number') return Array.prototype.slice.call(value);
    return [];
};
const router = FastMail.router;
const store = FastMail.store;
const { Message, Mailbox, MessageList } = FastMail.classes;
const mail = router.getAppController('mail');
const result = { start: location.pathname + location.search, startApp: router.get('app') };
const roleOf = (box) => { try { return box.get('role') || null; } catch (error) { return null; } };
const parentOf = (box) => { try { return box.get('parent') || null; } catch (error) { return null; } };
const pathOf = (box) => {
    const names = [];
    for (let node = box; node && node.get && names.length < 20; node = parentOf(node)) names.unshift(encodeURIComponent(node.get('name')));
    return names.join('/');
};
const readAndLoaded = (message) => {
    const data = store.getData(message.storeKey);
    return !!data && !!data.keywords && data.keywords.$seen === true && data.keywords.$draft !== true &&
        message.get('isUnread') === false;
};
const SKIP_ROLES = ['inbox', 'drafts', 'junk', 'trash'];
const candidateOf = (message) => {
    try {
        const thread = message.get('thread');
        const whole = thread ? toArray(thread.get('messages')) : [];
        if (!whole.length || !whole.every(readAndLoaded)) return null;
        if (whole.some(m => toArray(m.get('mailboxes')).some(box => SKIP_ROLES.includes(roleOf(box))))) return null;
        const boxes = toArray(message.get('mailboxes'))
            .slice().sort((a, b) => (String(a.get('id')) < String(b.get('id')) ? -1 : 1));
        const id = message.get('id');
        const threadId = thread.get('id');
        if (!boxes.length || typeof id !== 'string' || !id || typeof threadId !== 'string' || !threadId) return null;
        return { message, id, threadId, first: boxes[0], nested: !!parentOf(boxes[0]) };
    } catch (error) {
        return null;
    }
};
const candidates = () => store.getAll(Message).map(candidateOf).filter(Boolean);
const shownId = () => { try { const m = mail.get('message'); return m ? m.get('id') : null; } catch (error) { return null; } };
const step = async (path) => {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await wait(2500);
};
try {
    if (result.startApp !== 'mail') throw new Error('the app is not on mail: open mail first');
    result.loadedMessages = store.getAll(Message).length;
    let found = candidates();
    if (!found.length) {
        // Load the Archive's newest conversations without showing them
        const archive = store.getAll(Mailbox).find(box => roleOf(box) === 'archive');
        if (archive) {
            const params = {
                accountId: archive.get('accountId'),
                where: { inMailbox: archive.get('id') },
                sort: [{ property: 'receivedAt', isAscending: false }],
                collapseThreads: true,
            };
            const query = store.getQuery(Message.getQueryId(params), MessageList, params);
            for (let i = 0; i < 20; i += 1) query.getObjectAt(i);
            await wait(3000);
            store.getAll(Message).forEach((m) => { try { const t = m.get('thread'); if (t) toArray(t.get('messages')); } catch (error) {} });
            await wait(2500);
            result.loadedAfterArchive = store.getAll(Message).length;
            found = candidates();
        }
    }
    if (!found.length) {
        const sample = store.getAll(Message)[0];
        result.candidate = null;
        result.sampleDataKeys = sample ? Object.keys(store.getData(sample.storeKey) || {}) : [];
    } else {
        const pick = found.find(c => c.nested) || found[0];
        result.candidate = { id: pick.id, threadId: pick.threadId, firstMailbox: { role: roleOf(pick.first), path: pathOf(pick.first), nested: pick.nested } };
        result.fastmailUrlBefore = typeof mail.getUrlForMessage === 'function' ? String(mail.getUrlForMessage(pick.message)) : null;
        const conversation = encodeURIComponent(pick.threadId) + '.' + encodeURIComponent(pick.id);

        await step('/mail/Inbox/' + conversation);
        result.inboxLink = { path: location.pathname, shown: shownId(), opens: shownId() === pick.id };

        await step('/mail/' + pathOf(pick.first) + '/' + conversation);
        result.mailboxLink = { path: location.pathname, shown: shownId(), opens: shownId() === pick.id };
        result.fastmailUrlInMailbox = typeof mail.getUrlForMessage === 'function' ? String(mail.getUrlForMessage(pick.message)) : null;
    }
} catch (error) {
    result.threw = String(error) + ' ' + String(error && error.stack).slice(0, 400);
} finally {
    try { await step(result.start); } catch (error) {}
    result.end = location.pathname + location.search;
    result.endApp = router.get('app');
}
return JSON.stringify(result, null, 1);
```

- [ ] **Step 2: Check its syntax**

Run:

```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
{ echo 'async function probe() {'; cat "$SCRATCH/link-probe.js"; echo '}'; } > "$SCRATCH/link-probe-wrapped.js" && node --check "$SCRATCH/link-probe-wrapped.js" && echo ok
```

Expected: `ok`.

- [ ] **Step 3: Run it in the Mac app**

First confirm that `mdbraber.com` is open on mail, with no compose window or dialog in front:

```bash
osascript -e 'tell application "mdbraber.com" to do JavaScript "return location.pathname + \" | \" + FastMail.router.get(\"app\")"'
```

Expected: a path under `/mail/` and `| mail`. Then:

```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
osascript -e "tell application \"mdbraber.com\" to do JavaScript (read POSIX file \"$SCRATCH/link-probe.js\" as «class utf8»)"
osascript -e 'tell application "mdbraber.com" to do JavaScript "return location.pathname + \" | \" + FastMail.router.get(\"app\")"'
```

The last command must print the same path as `start` and `| mail`.

- [ ] **Step 4: Read the outcome**

The JSON has `start`, `candidate`, `inboxLink`, `mailboxLink`, `end` and `endApp`. Decide:

- **`threw` present, or `candidate` is `null`.**
  - Stop. Report the output to the user, including `loadedMessages`, `loadedAfterArchive` and `sampleDataKeys`.
  - Do not loosen the read check (`keywords.$seen === true` on every message of the conversation) to find a candidate, because that could open an unread message.
  - Neither outcome A nor B is taken until the user decides.
- **Outcome A:** `inboxLink.opens` is `true`. The Inbox address works for messages filed elsewhere. Do Step A1 and skip B.
- **Outcome B:** `inboxLink.opens` is `false` and `mailboxLink.opens` is `true`. Do Steps B1-B5.
- **Neither opens.** Stop and report `inboxLink`, `mailboxLink`, `fastmailUrlBefore` and `fastmailUrlInMailbox` to the user. The spelling of a mailbox in the address is then not what this plan assumes.

In every case, `end` must equal `start` and `endApp` must be `"mail"`. If not, return the app to mail by hand and say so.

- [ ] **Step A1 (outcome A only): Record the measurement and commit**

In `Server/src/notify.js`, replace

```js
// Where the message is opened: the Inbox, whatever labels the message
// carries. A banner is read where the mail arrives, not where it is filed.
```

with the following, putting the day the probe ran in place of `<YYYY-MM-DD>`:

```js
// Where the message is opened: the Inbox, whatever labels the message
// carries. A banner is read where the mail arrives, not where it is filed.
// Measured in the Mac app on <YYYY-MM-DD>: this address also opens a
// message that is not in the Inbox, as Important and Custom alerts need.
```

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`. Expected: PASS, `ℹ tests 125`.

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Server/src/notify.js
git commit -F - <<'EOF'
docs: the Inbox link opens a message filed elsewhere too, as measured

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

- [ ] **Step B1 (outcome B only): Write the failing tests**

If `candidate.firstMailbox.nested` was `false`, the probe did not exercise a nested path. The `Parent/Child` spelling then rests on `HomeShortcuts`' existing convention; say so in the report.

In `Server/test/notify.test.js`, add `mailboxPath` to the import:

```js
import {
    selectFresh, senderAddress, matchesChoice, senderName, alertPayload, badgePayload, threadURL, mailboxPath,
} from '../src/notify.js';
```

and insert directly before the test `'an alert names the category whose buttons the app registered'`:

```js
// The Inbox address does not open a message filed elsewhere, so such a
// message is linked through a mailbox it is in.
const boxes = [
    { id: inbox, name: 'Inbox', role: 'inbox', parentId: null },
    { id: 'mbx-archive', name: 'Archive', role: 'archive', parentId: null },
    { id: 'mbx-projects', name: 'Projects', role: null, parentId: null },
    { id: 'mbx-work', name: 'R&D work', role: null, parentId: 'mbx-projects' },
    { id: 'mbx-a', name: 'A label', role: null, parentId: null },
];

test('a message in the Inbox keeps the Inbox address', () => {
    const link = { inboxId: inbox, mailboxes: boxes, preferred: ['mbx-a'] };
    assert.equal(threadURL(email({ mailboxIds: { [inbox]: true, 'mbx-a': true } }), link), 'https://app.fastmail.com/mail/Inbox/T1.M1');
});

test('a message outside the Inbox opens in the first chosen label it carries, spelled as a path', () => {
    const filed = email({ mailboxIds: { 'mbx-a': true, 'mbx-work': true } });
    const link = { inboxId: inbox, mailboxes: boxes, preferred: ['mbx-other', 'mbx-work', 'mbx-a'] };
    assert.equal(threadURL(filed, link), 'https://app.fastmail.com/mail/Projects/R%26D%20work/T1.M1');
    assert.equal(alertPayload(filed, { badge: 1, link }).url, 'https://app.fastmail.com/mail/Projects/R%26D%20work/T1.M1');
});

test('without a chosen label it opens in the first of its mailboxes by id, and unknown ones are passed over', () => {
    const filed = email({ mailboxIds: { 'mbx-work': true, 'mbx-archive': true } });
    assert.equal(threadURL(filed, { inboxId: inbox, mailboxes: boxes }), 'https://app.fastmail.com/mail/Archive/T1.M1');
    assert.equal(threadURL(email({ mailboxIds: { 'mbx-new': true } }), { inboxId: inbox, mailboxes: boxes }), 'https://app.fastmail.com/mail/Inbox/T1.M1');
});

test('a mailbox path stops rather than loop on parents that name each other', () => {
    const x = { id: 'x', name: 'X', parentId: 'y' };
    const y = { id: 'y', name: 'Y', parentId: 'x' };
    assert.equal(mailboxPath(x, new Map([['x', x], ['y', y]])), 'Y/X');
});

```

In `Server/test/watcher.test.js`, in the test `'each device hears the new messages its own choice matches'`, replace

```js
    assert.equal(alert.payload.url, 'https://app.fastmail.com/mail/Inbox/T-M2.M2');
```

with

```js
    assert.equal(alert.payload.url, 'https://app.fastmail.com/mail/Kerk/T-M2.M2');
```

and insert directly before the test `'health counts the devices per choice, and muted is the ones that are off'`:

```js
test('an alert for a message outside the Inbox opens it in a mailbox it is in', async () => {
    const t = await setUp(batch(), { devices: fakeDevices(Object.keys(choices), choices) });
    await newMail(t);
    await settle(t);
    const url = (token, id) => t.apns.sent.find((s) => s.token === token && s.collapseId === id).payload.url;
    assert.equal(url('tok-custom', 'M2'), 'https://app.fastmail.com/mail/Kerk/T-M2.M2');
    assert.equal(url('tok-important', 'M5'), 'https://app.fastmail.com/mail/Later/T-M5.M5');
    assert.equal(url('tok-important', 'M3'), 'https://app.fastmail.com/mail/Inbox/T-M3.M3');
    assert.equal(url('tok-inbox', 'M1'), 'https://app.fastmail.com/mail/Inbox/T-M1.M1');
});

```

- [ ] **Step B2 (outcome B only): Run the tests to verify they fail**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: FAIL.
- `notify.test.js` does not load (`does not provide an export named 'mailboxPath'`).
- The two watcher tests fail: the url is still `…/mail/Inbox/T-M2.M2`.

- [ ] **Step B3 (outcome B only): Write the implementation**

In `Server/src/notify.js`, replace

```js
// Where the message is opened: the Inbox, whatever labels the message
// carries. A banner is read where the mail arrives, not where it is filed.
export function threadURL(email) {
    const conversation = `${encodeURIComponent(email.threadId)}.${encodeURIComponent(email.id)}`;
    return `https://app.fastmail.com/mail/Inbox/${conversation}`;
}
```

with

```js
// A mailbox as an address spells it: its names from the top down, each
// escaped, joined by slashes ("Projects/Work").
export function mailboxPath(mailbox, byId) {
    const names = [];
    const seen = new Set();
    for (let node = mailbox; node && !seen.has(node.id); node = byId.get(node.parentId)) {
        seen.add(node.id);
        names.unshift(encodeURIComponent(node.name));
    }
    return names.join('/');
}

// Where the message is opened. The Inbox when the message is in it, or when
// nothing else is known. Otherwise a mailbox it is in, since the Inbox
// address does not open a message filed elsewhere: the first of `preferred`
// (a Custom choice's labels) it carries, else the first of its mailboxes by id.
export function threadURL(email, { inboxId = null, mailboxes = [], preferred = [] } = {}) {
    const conversation = `${encodeURIComponent(email.threadId)}.${encodeURIComponent(email.id)}`;
    let where = 'Inbox';
    if (inboxId && email.mailboxIds?.[inboxId] !== true) {
        const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
        const known = (id) => email.mailboxIds?.[id] === true && byId.has(id);
        const id = preferred.find(known) ?? Object.keys(email.mailboxIds ?? {}).filter(known).sort()[0];
        if (id) where = mailboxPath(byId.get(id), byId);
    }
    return `https://app.fastmail.com/mail/${where}/${conversation}`;
}
```

In the same file, replace `export function alertPayload(email, { badge }) {` with:

```js
// `link` is what threadURL needs to open the message where it is.
export function alertPayload(email, { badge, link }) {
```

and inside it replace `return { aps, url: threadURL(email), emailId: email.id };` with:

```js
    return { aps, url: threadURL(email, link), emailId: email.id };
```

In `Server/src/watcher.js`:

1. In the constructor, replace

```js
        this.junkId = null;
        this.trashId = null;
```

with

```js
        this.junkId = null;
        this.trashId = null;
        // As read at start-up, for naming a mailbox in a notification's link
        this.mailboxes = [];
```

2. In `connect()`, replace

```js
        const mailboxes = await this.jmap.mailboxes();
        this.inboxId = mailboxes.find((m) => m.role === 'inbox')?.id ?? null;
```

with

```js
        const mailboxes = await this.jmap.mailboxes();
        this.mailboxes = mailboxes;
        this.inboxId = mailboxes.find((m) => m.role === 'inbox')?.id ?? null;
```

3. In `process()`, replace

```js
            const wanted = fresh.filter((email) => matchesChoice(notify, email, context));
            let alive = true;
            for (const email of wanted) {
                alive = await this.send(token, alertPayload(email, { badge }), email.id);
```

with

```js
            const wanted = fresh.filter((email) => matchesChoice(notify, email, context));
            const link = { inboxId: this.inboxId, mailboxes: this.mailboxes, preferred: notify.mode === 'custom' ? notify.mailboxIds : [] };
            let alive = true;
            for (const email of wanted) {
                alive = await this.send(token, alertPayload(email, { badge, link }), email.id);
```

- [ ] **Step B4 (outcome B only): Run the tests to verify they pass**

Run: `cd /Users/mdbraber/src/fastmail-custom/Server && npm test`
Expected: PASS, `ℹ tests 130`, `ℹ fail 0`.

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`
Expected: every part passes.

- [ ] **Step B5 (outcome B only): Commit**

```bash
cd /Users/mdbraber/src/fastmail-custom
git add Server/src/notify.js Server/src/watcher.js Server/test/notify.test.js Server/test/watcher.test.js
git commit -F - <<'EOF'
fix: an alert for a message outside the Inbox opens it where it is

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ESway8SfPAMDCAT3XaHWye
EOF
```

---
### Task 7: Roll-out

**Files:** none tracked. Scratch, never committed: `$SCRATCH/contacts-check.mjs`. The git-ignored `Server/.env` changes by the user's hand.

**Interfaces:**
- Consumes: everything above.
- Produces: the server running the filters, first with `contacts: false`, then with `contacts: true` once the new tokens are in; or a recorded list of what is still outstanding.

Every step here that touches the push server's host waits for the user's go-ahead, given at that time. The host is never named in this plan, in a commit or in any tracked file. The executor gets the host and the service's directory from the user.

"The existing update steps" are:
1. Copy `Server/` into the service's `src/` directory on the host, leaving out `.env`, `secrets/`, `data/`, `test/`, `node_modules/` and `compose.yml`.
2. In the service's directory on the host, run `docker compose up -d --build`.

- [ ] **Step 1: The whole suite, once more**

Run: `cd /Users/mdbraber/src/fastmail-custom && make test`
Expected: every part passes, with the server at `ℹ tests 125`, or `ℹ tests 130` after outcome B of Task 6.

- [ ] **Step 2: Ask the user before deploying with today's tokens**

Tell the user the following, then ask for a go-ahead to redeploy with the existing update steps, and stop until it is given:
- The filters work before the new tokens exist.
- Both accounts will report `contacts: false`.
- Devices already registered keep alerting for the Inbox, or stay muted, as they do now.
- Today's app builds keep registering with `alerts` alone.

- [ ] **Step 3: Deploy (only after the go-ahead)**

Run the existing update steps.

- [ ] **Step 4: Check the health report**

Run on the development Mac. This reads `PUBLIC_URL` from the git-ignored `.env`, so the address is not typed into anything tracked:

```bash
curl -s "$(grep '^PUBLIC_URL=' /Users/mdbraber/src/fastmail-custom/Server/.env | cut -d= -f2-)/healthz"
```

Expected, for each account in `accounts`:
- `notices` is `"push"`, and `verified` becomes `true` within a minute. If it stays `false`, the README's advice applies: restart the service. That also needs the go-ahead.
- `contacts` is `false`.
- `modes` has the four keys `off`, `important`, `inbox` and `custom`, and they add up to `devices`.
- `muted` equals `modes.off`.
- Devices registered before this change count as `inbox`, or as `off` if their alerts were off.

- [ ] **Step 5: Ask the user for the new tokens**

Ask the user to do the following, and stop until they say it is done:
1. In each Fastmail account (Personal and Work), create a new API token with Mail access, not read-only, plus read-only Contacts. The path is Settings → Privacy & Security → Manage API tokens.
2. Replace `FASTMAIL_TOKEN_PERSONAL` and `FASTMAIL_TOKEN_WORK` in `/Users/mdbraber/src/fastmail-custom/Server/.env` themselves.

Tokens are never pasted into this conversation, a tracked file, a commit message or a log.

- [ ] **Step 6: Check the new tokens locally, read-only**

Create `$SCRATCH/contacts-check.mjs`:

```js
// Read-only: with the tokens now in Server/.env, can each account read
// contacts, and how many cards, addresses and VIP addresses come back? Prints
// only booleans and counts: never a token, an address or a name.
import { readFile } from 'node:fs/promises';
import { JMAPClient } from '/Users/mdbraber/src/fastmail-custom/Server/src/jmap.js';
import { addressSets } from '/Users/mdbraber/src/fastmail-custom/Server/src/contacts.js';

const env = Object.fromEntries((await readFile('/Users/mdbraber/src/fastmail-custom/Server/.env', 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]));

for (const name of ['personal', 'work']) {
    const token = env[`FASTMAIL_TOKEN_${name.toUpperCase()}`];
    if (!token) {
        console.log(JSON.stringify({ account: name, configured: false }));
        continue;
    }
    try {
        const jmap = new JMAPClient({ token });
        await jmap.connect();
        const report = { account: name, contacts: jmap.contactsAccountId !== null };
        if (report.contacts) {
            const { cards } = await jmap.contactCards();
            const { contacts, vips } = addressSets(cards);
            Object.assign(report, { cards: cards.length, contactAddresses: contacts.size, vipAddresses: vips.size });
        }
        console.log(JSON.stringify(report));
    } catch (error) {
        console.log(JSON.stringify({ account: name, failed: error.message }));
    }
}
```

Run:

```bash
SCRATCH=/private/tmp/claude-501/-Users-mdbraber-src-fastmail-custom/bec47bb0-6634-4480-9f70-8593ccb71063/scratchpad
node --check "$SCRATCH/contacts-check.mjs" && node "$SCRATCH/contacts-check.mjs"
```

Expected: two lines, each `{"account":…,"contacts":true,"cards":<n>,"contactAddresses":<n>,"vipAddresses":<n>}`, with `cards` above 0. `vipAddresses` is above 0 for an account that has VIPs.
- `"contacts":false` means the token lacks Contacts access: tell the user, and stop.
- `"failed":…` with `session: HTTP 401` means the token was pasted wrongly: tell the user, and stop.

- [ ] **Step 7: Ask the user before putting the tokens on the host**

Ask for a go-ahead to do the following, and stop until it is given:
1. Replace `FASTMAIL_TOKEN_PERSONAL` and `FASTMAIL_TOKEN_WORK` in the service's `.env` on the host with the same values as the local `Server/.env`. The two files are meant to match.
2. Run the existing update steps again, so the container restarts with them.

- [ ] **Step 8: Put the tokens in and restart (only after the go-ahead)**

Copy the two token lines into the host's `.env` without printing them. Then run the existing update steps.

- [ ] **Step 9: Check the health report again**

Run the `curl` from Step 4.
Expected: as in Step 4, but `contacts` is `true` for both accounts.

With the same go-ahead, `docker compose logs --tail 50` in the service's directory shows, for each account:
- `watching, notices by push`
- `contacts read: <n> addresses, <n> VIP`

It shows no `contacts unreadable` warning.

- [ ] **Step 10: Record the result**

Report what passed and what is outstanding, naming each account.

The spec's checks on the iPhone and iPad (the four choices reaching the server in `/healthz` `modes`, and an alert per choice) need plan 3's Notifications page. List them as outstanding for plan 3, not as passed.

---

## Self-review

**Spec coverage** (Part 2 and the server lines of "Testing"):

| Spec requirement | Where |
|---|---|
| `notify` field, its three members, defaults, 400 naming the field | Task 1 (`choice.js`, `http.js`) |
| `alerts` alone, both present (`notify` wins) | Task 1 |
| Registry stores `{registeredAt, notify}`; old `alerts` records read as `inbox`/`off` without a rewrite | Task 1 (`storedChoice`, `entries`, file-unchanged test) |
| Reply `{ ok, notify, contacts }` | Task 1 (reply), Task 4 (`hasContacts`) |
| Considered once: not `$seen`, not `$draft`, not announced | Task 2 (`selectFresh`), Task 5 |
| `off`, `inbox`, `important` (VIP outside Junk/Trash, or followed), `custom` (labels and senders), empty Custom list, sender is first `from` case-insensitive | Task 2 (`matchesChoice`) |
| One pure function with the context of Inbox/Junk/Trash ids, VIP set, contact set, followed thread ids | Task 2, context built in Task 5 |
| Followed threads by `Thread/get` + `Email/get keywords`, only for new messages, only when a device has `important` | Task 3 (`threads`, `keywords`), Task 5 (`contextFor`, `followedThreads`) |
| Alerts per device with today's payload, badge and buttons; badge-only for devices without an alert when the count changed; announced per account | Task 5 |
| Dead-token removal and logging kept | Task 5 (`send`) |
| The link stays `threadURL`; check `/mail/Inbox/<thread>.<email>` for a message not in the Inbox; fallback to first chosen label, else first mailbox by id | Task 6 |
| Contacts from `ContactCard/get` of the primary contacts account; contact set (non-group cards); VIP set (members of the `vips` group by uid) | Task 3 (`contactCards`, `addressSets`) |
| Sets read at start-up and on a `ContactCard` change | Task 4 |
| `ContactCard` subscribed only with contacts access, push and event source | Task 4 (`types`) |
| Without contacts: empty sets, rules match nobody, `/healthz` and registrations say `contacts: false` | Tasks 2, 4, 1 |
| `/healthz` gains `contacts` and `modes`; `muted` is the count of `off` | Tasks 4, 5 |
| Tokens with read-only Contacts in both `.env` files; redeploy only on go-ahead; no host or token in tracked files | Task 7, README and `.env.example` in Task 5 |
| Stage 2 works before the new tokens exist | Task 7, Steps 2-4 |
| Server tests listed under "Testing" | Tasks 1-5 (each named case has a test) |

**Placeholder scan.**
- Every code step carries its code, and every command has its expected output.
- The only value filled in at run time is the date in Step A1's comment, which is measured.

**Type consistency.** These names are spelled the same in every task:
- `MODES`, `SENDERS`, `MAX_MAILBOX_IDS`, `fromAlerts`, `normaliseNotify`, `registrationChoice`, `storedChoice`
- `DeviceRegistry.entries`, `register(account, token, { notify })`, `tokens(account)`
- `selectFresh`, `senderAddress`, `matchesChoice(notify, email, context)`, with context keys `inboxId`, `junkId`, `trashId`, `vips`, `contacts`, `followedThreadIds`
- `CONTACTS`, `CONTACT_CARD_PROPERTIES`, `contactsAccountId`, `getInChunks`, `threads`, `keywords`, `contactCards() → { cards, state }`
- `addressSets(cards) → { contacts, vips }`
- `hasContacts`, `types`, `contactAddresses`, `vipAddresses`, `contactsState`, `contactsDue`, `loadContacts`, `junkId`, `trashId`, `contextFor`, `followedThreads`, `send`, and `status()` with `contacts` and `modes`
- Outcome B only: `mailboxPath`, `threadURL(email, { inboxId, mailboxes, preferred })`, `alertPayload(email, { badge, link })`, `AccountWatcher.mailboxes`

Every task's code was applied in order to a copy of `Server/` and its tests run. The counts above are the measured ones: 94, 107, 116, 121, 125, and 130 with outcome B.

## Notes for the controller

1. **The spec and the contract.**
   - I found no conflict between them.
   - The error text names the field as `notify`, `notify.mode`, `notify.senders`, `notify.mailboxIds` or `alerts`.
   - If plan 3 matches on other spellings, only its messages change.
2. **The reply no longer carries `alerts`.** Installed app builds read only the HTTP status (`PushRegistrar.send()`), so nothing breaks today. If some other client reads `alerts` from the reply, it breaks.
3. **A malformed `alerts` is refused even next to a valid `notify`.** Plan 3 always sends a boolean. If it ever did not, the registration would fail with a 400.
4. **`mailboxIds` are kept exactly as sent**, with no de-duplication or sorting, so that plan 3 can compare the choice it saved with the one acknowledged. If the server normalised them, plan 3 would see a registration as due at every activation.
5. **Every fresh message is remembered as announced**, not only the ones some device was alerted for.
   - Fresh means unseen, not a draft, in any mailbox. This is "considered once" per account, and it keeps a replayed change log from alerting twice.
   - Cost: the 500-entry memory now fills with non-Inbox mail too, so it protects a shorter stretch of the log on a busy account.
6. **The Junk/Trash exclusion applies only to the VIP half of Important, as the spec is worded.** A reply in a followed conversation that lands in Trash still alerts. If that is wrong, it is a one-line change in `matchesChoice` plus one test.
7. **Contacts are read by paging.** `ContactCard/query` runs 500 at a time with `calculateTotal`, then `ContactCard/get` in chunks, rather than `ContactCard/get` with `ids: null`, because Fastmail's `maxObjectsInGet` is 500.
   - Contacts access needs all three of: the capability in the session, a primary contacts account, and that account's `accountCapabilities` entry.
   - If Fastmail leaves out the account entry, contacts read as false. Task 7's `contacts-check.mjs` would show this before deploying with the new tokens.
8. **Failures do not stop the watcher.** A failed contacts read or thread lookup is logged, and the watcher carries on.
   - Contacts are retried at the next look (a notice, or the 5-minute poll).
   - The sets are refreshed only at start-up, on a new `ContactCard` state in a notice, or after a failed read. The poll does not refresh them.
   - Cost: a missed notice leaves the sets stale until the next change or a restart.
9. **What the link probe can and cannot show.**
   - It runs on the Mac app's desktop layout; the phone layout could route an address differently.
   - It exercises a nested mailbox path only if a read, non-Inbox candidate happens to have a nested first mailbox. Otherwise the `Parent/Child` spelling rests on `HomeShortcuts`' existing convention.
   - Outcome B names mailboxes as they were read at start-up, so a label created since start-up is passed over.
   - Cost: a tapped alert opens a list, or the Inbox, instead of the message. It is only noticed on a device.
10. **The roll-out order follows the spec's stage note.** The server deploys with today's tokens first (`contacts: false`), then the tokens are swapped. Every host step, and the token creation, is behind an "ask the user" that stops.
