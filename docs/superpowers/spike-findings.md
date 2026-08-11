# Spike findings — 2026-08-11

Milestone 0 gate for the Fastmail shell. A bare `WKWebView` in a throwaway
`swiftc` app, loading `https://app.fastmail.com`, sampling the page every two
seconds and printing on change.

Account identifiers, message identifiers, and message subjects observed during
the spike are deliberately not reproduced here.

## Login

**PASS.** Password plus TOTP completed in a bare `WKWebView` with no
`WKAppBoundDomains` declared and no Associated Domains. The session persisted in
the default `WKWebsiteDataStore`.

Paste did not work with ⌘V during login. This was an artifact of the spike, not
of WebKit: the throwaway app installs no menu bar, so standard editing key
equivalents have nothing to route through. Right-click paste worked. The real
app must keep the standard Edit menu that SwiftUI's `WindowGroup` provides.

## window.FastMail

**Present**, on both the login page and the mail app. All four keys the Inbox
mode script depends on resolve:

```
store, classes, router, getViewFromNode
```

`FastMail.router.getAppController('mail')` returns a controller once the mail app
has loaded, and `.v-MailboxSource` is drawn. The script's `isReady()` gate is
therefore satisfiable.

## Service workers

**Running.** `'serviceWorker' in navigator` is true and
`navigator.serviceWorker.controller` is non-null on `app.fastmail.com`.

This disproves the design's assumption that WebKit ties service workers to
app-bound domains and that they would be unavailable. Script injection works in
the same configuration, so the two are not in tension. Platform constraint 3 and
Risk 1 in the spec are withdrawn.

## Subject selector

Both candidates resolve under the `WKWebView` user agent:

| Selector | Result |
|---|---|
| `.v-Thread-title h1` | resolves to the subject alone |
| `.v-MailboxItem.is-focused .v-MailboxItem-subject` | resolves to the same subject |

## Document titles

Three shapes observed, which is why `document.title` is a fallback rather than
the source:

| Context | Shape |
|---|---|
| Login | `Log in \| Fastmail` |
| Mailbox, unread present | `<count> • <mailbox> \| Fastmail` |
| Message open, unread present | `<count> • <mailbox> – <subject> \| Fastmail` |
| Message open, no unread (observed earlier in Safari) | `In <filter> • <mailbox> – <subject> \| Fastmail` |

The unread count appears as a prefix when non-zero, so the prefix is not stable
and cannot be assumed. The subject is still separated by an ordinary-spaced
U+2013 en dash in every message-open case.

The count in the title is a second possible source for the unread badge,
independent of the sidebar.

## Actions menu

**The menu does not contain "Show details".** Opened on a selected message, the
single visible `.v-Menu` contains:

```
Reply, Reply to all, Forward, Forward as attachment, Edit as new, Print,
Download, Add rule from message…, Block <sender>…, Show raw message,
View as text, Send a copy…, Delete
```

The spec's rule of identifying this menu by an option labelled `Show details`
would never match. `Show details` is the separate details toggle on the message
card, which controls `div.v-Message-details.is-notshown`.

Replacement rule: identify the message actions menu as the visible `.v-Menu`
containing options labelled both `Reply` and `Forward`. Requiring two labels
avoids matching a menu that happens to carry a single common verb.

Exactly one `.v-Menu` was visible while the menu was open, but several exist in
the DOM at other times, so the visibility filter is still required.

## Share icon

**None exists.** Scanning every distinct `svg.v-Icon` class for
`share|export|link|forward|out` returned only `i-forward`. There is no `i-share`
in Fastmail's sprite, so the injected Share item must carry an inlined 24×24 SVG
path matching the existing convention.

## User agent

```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)
```

No `Version` or `Safari` token. Fastmail served the full application regardless
and did not present a browser-unsupported interstitial.

## Verdict

Gate **passed**. Login, `window.FastMail`, script injection, and both subject
selectors all work. Two spec corrections follow: service workers are available,
and the actions-menu identification rule must change from `Show details` to
`Reply` plus `Forward`.
