# Fastmail Custom

A personal set of tools for using Fastmail: a userscript that reshapes the web
app around one-label triage, a Safari extension that runs it, native shell apps
for macOS and iOS, and a small server that pushes new-mail notifications to the
phone.

## Not affiliated with Fastmail

This is an independent, personal project. It is **not affiliated with,
endorsed by, sponsored by, or supported by Fastmail Pty Ltd** in any way.
"Fastmail" is their name and trademark, used here only to say which service
these tools work with.

Nothing here is an official client. It changes the Fastmail web app from the
outside, so it can break whenever Fastmail changes theirs, and it comes with no
warranty of any kind. Please do not ask Fastmail for support with it — report
anything that goes wrong here instead.

## What is in here

**Custom mode** (`Userscript/fastmail-custom-mode.user.js`) — the userscript
that does the work: one-label triage, where a project label is the live state
of a message and archiving means the same thing in every list. It runs on
`app.fastmail.com` and `app.beta.fastmail.com`, either through a userscript
manager or through the extension below.

**Safari extension** (`SafariExtension/`) — a small extension whose only job is
to start Custom mode. Fastmail's content security policy will not run an
inline script, so a userscript manager cannot inject it there; the extension
can. It ships inside a host app, which is why it has to be installed rather
than just enabled.

**Shell apps** (`Apps/`, `Packages/FastmailShellKit/`) — native wrappers around
the web app for macOS and iOS, one per account, sharing a Swift package. They
add the things a website cannot: proper windows and tabs, a compose window,
notifications, downloads, share extensions, mailto handling and AppleScript
support. `Apps/Mailto` is a small iOS app that sends mailto links to whichever
account you pick.

**Push server** (`Server/`) — new-mail pushes for the iOS apps. It watches each
mailbox over JMAP and sends an Apple Push Notification for what lands in the
Inbox, so the API tokens live on the server rather than on the phone. See
`Server/README.md`.

## Building

You need Xcode, [XcodeGen](https://github.com/yonaskolb/XcodeGen) and Node.

```sh
cp Config/Local.xcconfig.example Config/Local.xcconfig   # then fill it in
make generate        # write the Xcode project from project.yml
make test            # package, integration and server tests, plus a syntax check
make install-macos   # build both macOS apps into /Applications
make install-ios     # install onto a paired device (DEVICE=… to choose one)
make install-extension
```

`Config/Local.xcconfig` holds your development team, the two account
identifiers and the push server's details. It is deliberately not checked in;
the example file shows the shape.

## Layout

| Path | What it is |
| --- | --- |
| `Userscript/` | Custom mode itself |
| `SafariExtension/` | The extension that runs it, and its host app |
| `Apps/` | The macOS and iOS apps |
| `Extensions/` | The share extensions |
| `Packages/FastmailShellKit/` | The shared shell: web view, windows, links, settings |
| `Server/` | The push server |
| `Tests/` | Integration tests that run the real scripts in a web view |
| `tools/` | Build and deploy helpers |

## Licence

GNU Affero General Public License, version 3 or later. The full text is in
[LICENSE](LICENSE).

In short: use it, change it and pass it on, as long as what you pass on stays
under the same licence and its source stays available — including to people who
only reach it over a network.

## Status

Written for one person's mailbox and offered as-is, in case it is useful to
someone else.
