# Fastmail Custom

A personal set of tools for using Fastmail. I wanted to be able to quickly triage incoming messages (add a label in the Inbox so it feels less cluttered). That spun eh, a little out of control... :-)
I merged all my previously written Fastmail tweaks and ideas into this repo and it's now my daily driver. It supports all the features the stock Fastmail apps offer plus more.

## Features

| | | | |
|---|---|---|---|
| <img width="620" alt="CleanShot 2026-09-15 at 08 54 17@2x" src="https://github.com/user-attachments/assets/1451fe56-e2ef-46f5-9762-b75a8bdf4140" /> | <img width="620" alt="CleanShot 2026-09-15 at 08 54 38@2x" src="https://github.com/user-attachments/assets/6c638117-d91d-417f-b651-961c9d8d2206" /> | <img width="620" alt="CleanShot 2026-09-15 at 08 54 54@2x" src="https://github.com/user-attachments/assets/be372f0a-e840-4603-b769-efe55fc0e8da" /> | <img width="620" alt="CleanShot 2026-09-15 at 08 55 16@2x" src="https://github.com/user-attachments/assets/4c00e4bf-0dd5-4765-8b8a-b6a58192c47a" /> |

**Triage**

- 🏷️ **Inbox triage**: quick add a label to inbox message or archive
- 📦 **Keep or Archive**: keeping allows to add a label, archiving strips all project labels/pins
- 👥 **Add sender to group via label**: add to a specific label and the sender gets automatically added to a Contacts group (like Hey.com)

**Grouping**
- 🗃️ **Custom groups**: Fastmail recently introduced "Mailbox groups" - create as
  many custom groups as you like, change the built-in groups and easily switch between them

**Snoozing**
- ⏰ **Snooze presets**: your own list of times on Fastmail's own Snooze
  button, one whose time has passed greyed out rather than offered.

**User experience**

- 🪟 **Native UI (macOS) with tabs**: Fastmail runs in a WKWebView (fast, energy-efficient) and supports tabs
- ✉️ **Compose inline, window or tab (macOS)**: compose messages without losing focus
- ↗️ **Pop-out windows (macOS)**: open any message or draft in its own window.
- 🖨️ **Printing**: print a message from its window.
- ⬇️ **Downloads**: attachments go to a folder you choose.
- 📮 **mailto handling**: mail links open in the right account on iOS (via a separate app showing a chooser).
- 🤝 **Handoff (iOS / macOS)**: carry on with the same message on your other device, or in its browser.
- 📱 **Home screen shortcuts (iOS)**: long-press the icon on iPhone or iPad for Inbox, your triage label, Compose and Search.
- 🔒 **App lock (iOS)**: iPhone and iPad can ask for Face ID, Touch ID or your passcode before mail shows.
- 🌐 **In-app browser**: links leaving the app can open in in-app browser or your default browser
- ⚙️ **Shared settings**: the same settings on Mac, iPhone and in Safari, kept in sync through iCloud when you turn that on.

**Appearance**

- 🗂️ **Grouped sidebar**: folders, labels and saved searches kept apart with sections
- 🔻 **Triage icon**: the triage label has its own icon
- 🔢 **Filtered counts**: counts show the number with the filter applied
- 🎨 **Label colours**: show the full message row in the label color

 **Notifications**
 - 🔔 **Push notifications**: choose Off, Important, All in Inbox or labels of your own per device; a banner carries Archive, Later and Pin. Push notifications needs the server component (see `Server/`)

**Scripting support**
- 🤖 **Shortcuts, AppleScript and the menu bar**: get URL / Title or Markdown Link via AppleScript or Shortcuts.
  Also allow running custom JavaScript to fully customize your experience

## Repository

**Custom mode** (`Userscript/fastmail-custom-mode.user.js`) is the userscript
that does the work: one-label triage, where a project label is the live state
of a message and archiving means the same thing in every list. It runs on
`app.fastmail.com` and `app.beta.fastmail.com`, either through a userscript
manager or through the extension below.

**Safari extension** (`SafariExtension/`) is a small extension whose only job is
to start Custom mode. Fastmail's content security policy will not run an
inline script, so a userscript manager cannot inject it there; the extension
can. It ships inside a host app, which is why it has to be installed rather
than just enabled.

**Shell apps** (`Apps/`, `Packages/FastmailShellKit/`) are native wrappers around
the web app for macOS and iOS, one per account, sharing a Swift package. They
add the things a website cannot: proper windows and tabs, a compose window,
notifications, downloads, share extensions, mailto handling, an app lock,
Handoff between devices and AppleScript support. `Apps/Mailto` is a small iOS
app that sends mailto links to whichever account you pick.

**Push server** (`Server/`) sends new-mail pushes to the iOS apps: one alert
per device for what its own notification choice asks for, everything,
important senders and VIPs, or labels you pick, reading contacts and VIPs
over JMAP so the API tokens live on the server rather than on the phone. See
`Server/README.md`.

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


## Building

You need Xcode, [XcodeGen](https://github.com/yonaskolb/XcodeGen) and Node.

```sh
cp Config/Local.xcconfig.example Config/Local.xcconfig   # then fill it in
make generate        # write the Xcode project from project.yml
make test            # package, integration and server tests, plus a syntax check
make install-macos   # build both macOS apps into /Applications
make install-ios     # install onto a paired device (DEVICE=… to choose one)
make deploy          # both of the above, everywhere: /Applications and every paired iOS device
make install-extension
```

`Config/Local.xcconfig` holds your development team, the two account
identifiers and the push server's details. It is deliberately not checked in;
the example file shows the shape.

## Not affiliated with Fastmail

This is an independent, personal project. It is **not affiliated with,
endorsed by, sponsored by, or supported by Fastmail Pty Ltd** in any way.
"Fastmail" is their name and trademark, used here only to say which service
these tools work with.

Nothing here is an official client. It changes the Fastmail web app from the
outside, so it can break whenever Fastmail changes theirs, and it comes with no
warranty of any kind. Please do not ask Fastmail for support with it; report
anything that goes wrong here instead.

## Licence

GNU Affero General Public License, version 3 or later. The full text is in
[LICENSE](LICENSE).

In short: use it, change it and pass it on, as long as what you pass on stays
under the same licence and its source stays available.
