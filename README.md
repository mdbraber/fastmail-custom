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
warranty of any kind. Please do not ask Fastmail for support with it; report
anything that goes wrong here instead.

## What it does

**Triage on one label.** A project label is a message's live state rather than
a folder it has been put in, and one label at a time is the rule. Undecided
mail carries a triage label, which acts as the queue to work through; filing
swaps the triage label for a project one and leaves the message in the Inbox.

**Archive means the same thing everywhere.** Archiving takes the message out of
the Inbox, off the triage label and off its project label, and unpins it, while
a hold label such as Later stays on. It does that in every list: the Inbox, the
triage view, a project label or a hold label.

**Keyboard and actions.** Single keys for filing, snoozing and pinning, with
the snooze period and time of day, the pin key and the snooze key all settable.
E and Y can be swapped so that E archives everywhere. On a phone the message
bar carries the same actions in an order you choose.

**Labels that behave.** Dragging a message onto a label adds it instead of
moving the message; the labels picker files rather than moves; a picker with
one match can apply it for you; labels you name are never treated as projects;
and a label can add its sender to a contact group.

**A sidebar you can read.** Folders, labels and saved searches are separated
into runs, the triage label wears a funnel in the colour of the label it stands
for, counts can be limited to what is in the Inbox, and label names can be
shown without their prefix.

**Colour.** Message rows can be tinted by their label, in the sidebar only if
you prefer, and the triage label can be left out of it so a whole queue does
not go one shade.

**Native windows.** The macOS apps put the page in a real window with the
window buttons set into Fastmail's own header, native tabs with the page fitted
around the tab bar, and the window painted in the colour the page asks for.

**Messages in windows.** A new message opens in the page, in a tab or in a
window of its own, whichever you set, with Option and Command-Option to
override it for one message. Drafts and messages opened with "Open in new
window" get the same treatment, with a band across the top saying who the
message is for or what it is about. Printing works from those windows.

**The rest of the shell.** Downloads to a folder you choose, with safe
attachments opening on their own; a share extension for sending a page or a
link to the app; mailto links, including a small iOS app that asks which
account should take them; an app badge counting the label you name; Shortcuts
actions for opening a path, reading the current link and running JavaScript;
and AppleScript support for the same.

**Push.** On iOS, new mail arrives as a notification with Archive, Later and
Pin on it, sent by the server in this repository so that no Fastmail
credentials sit on the phone.

**Settings.** Everything above is a setting, and the same catalog drives all
three places they appear: the macOS Settings window, the iOS Settings bundle
and the Safari extension's own page.

## What is in here

**Custom mode** (`Userscript/fastmail-custom-mode.user.js`); the userscript
that does the work: one-label triage, where a project label is the live state
of a message and archiving means the same thing in every list. It runs on
`app.fastmail.com` and `app.beta.fastmail.com`, either through a userscript
manager or through the extension below.

**Safari extension** (`SafariExtension/`), a small extension whose only job is
to start Custom mode. Fastmail's content security policy will not run an
inline script, so a userscript manager cannot inject it there; the extension
can. It ships inside a host app, which is why it has to be installed rather
than just enabled.

**Shell apps** (`Apps/`, `Packages/FastmailShellKit/`); native wrappers around
the web app for macOS and iOS, one per account, sharing a Swift package. They
add the things a website cannot: proper windows and tabs, a compose window,
notifications, downloads, share extensions, mailto handling and AppleScript
support. `Apps/Mailto` is a small iOS app that sends mailto links to whichever
account you pick.

**Push server** (`Server/`); new-mail pushes for the iOS apps. It watches each
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
under the same licence and its source stays available; including to people who
only reach it over a network.

## Status

Written for one person's mailbox and offered as-is, in case it is useful to
someone else.
