# macOS share extension

Date: 2026-10-04

## Purpose

Sharing from any Mac app (Safari, Finder, Preview, a text selection) should be
able to start a new message in either Fastmail shell app. Each app gets its own
entry in the macOS share menu, so choosing the entry chooses the account. The
shared content arrives in a compose window: links and text in the subject and
body, files and images as attachments.

Success means: sharing a web page, a text selection, one image, and several
Finder files to "mdbraber.com" or "nexthealth.nl" each opens a compose window
in that account with the content in place, with no setup and no credentials.

## Decisions already made

- Scope is links, text and files. Files arrive as attachments.
- Files are attached by handing them to Fastmail's compose page, which uploads
  them as if they had been dropped on the message. No Fastmail API token.
- One extension per app. No sheet of its own; the compose window is the editor.
- The iOS share extensions are unchanged.

## What is known about the page

Inspected read-only in the pooled compose window of the running Personal app
(`app.beta.fastmail.com/mail/Inbox/compose?…&ui=minimal`):

- `FastMail.classes.ComposeController.prototype.attachFiles(files)` exists. For
  each entry it creates an attachment object, pushes it onto the controller's
  `attachments`, and asks the view to insert it.
- `FastMail.classes.ComposeView.prototype.drop(event)` is
  `this.get("controller").attachFiles(event.getFiles())`. A dropped file takes
  no other path, so calling `attachFiles` with `File` objects is equivalent to
  a drop.

Not yet verified: attaching a real file this way end to end. It uploads to the
live account and changes the pooled window, so it is the first implementation
step, done with a tiny file in a window that is closed and discarded after.

## Architecture

```
Share menu ─▶ extension (sandboxed)
                │  writes  <group container>/Shares/<id>/manifest.json + files
                │  opens   <scheme>://share?id=<id>
                ▼
             app ─▶ LinkRouter .share(id)
                     ─▶ SharedPayload.take(id)      reads, then deletes folder
                     ─▶ ComposeWindows.compose(mailto:attachments:)
                          ─▶ compose page loads from the existing mailto path
                          ─▶ injection script calls controller.attachFiles
```

### Extension targets

- `PersonalShareMac` and `WorkShareMac`: `type: app-extension`,
  `platform: macOS`, in `project.yml`. Each is embedded in its app with
  `destinationFilters: [macOS]`, beside the existing iOS-only embedding.
- Sources: `Extensions/SharedMac/ShareViewController.swift` (AppKit, shared by
  both) and a per-app `Info.plist` in `Extensions/PersonalShareMac` and
  `Extensions/WorkShareMac`.
- `Info.plist`: extension point `com.apple.share-services`; display name is the
  app's name; `FMURLScheme` (`fastmail-personal` / `fastmail-work`) and
  `FMAppName`, as the iOS extensions carry them. The activation rule accepts
  web URLs, text, images and files, up to 20 items.
- Entitlements: App Sandbox, and the App Group below.
- Bundle identifiers: `com.mdbraber.fastmail-custom.personal.share-mac` and
  `com.mdbraber.fastmail-custom.work.share-mac`.

The extension's view controller shows no content of its own. On appearing it
gathers the input items, writes the payload, opens the app link, and completes
the request. On failure it shows an alert and cancels the request.

### Shared container

- App Group `$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.share`, added
  to both extensions and to `Apps/Personal/macOS.entitlements` and
  `Apps/Work/macOS.entitlements`.
- Layout: `Shares/<uuid>/manifest.json` and `Shares/<uuid>/files/<n>-<name>`.
  The numeric prefix keeps two files with the same name apart.
- Manifest fields: `subject` (string, may be empty), `text` (string, may be
  empty), `url` (string or absent), `files` (array of `{ path, name, type }`
  with `type` a MIME type).

### Payload type (FastmailShellKit)

`SharedPayload.swift`, usable from the app and compiled into the extensions as
a plain source file so both sides share one definition of the manifest:

- `SharedPayload` (Codable): the manifest.
- `SharedPayload.write(to:)` used by the extension.
- `SharedPayload.take(id:in:)` used by the app: validates that `id` is a UUID
  (the id comes from a link any app can open, so it must not be a path),
  reads the manifest, and returns it with file URLs, leaving out any file
  whose path leads outside the share's folder. `SharedPayload.remove(id:in:)`
  deletes the folder once the attachments have been handed to the page, or
  straight away when there are none.
- `SharedPayload.sweep(olderThan:in:)`: called at launch, removes share folders
  older than a day, for shares that never reached the app.
- `SharedPayload.mailto`: builds the `mailto:?subject=…&body=…` the existing
  compose path takes. Subject is the shared page title, else the first file's
  name, else empty. Body is the shared text, then the link on its own line.

### Routing

- `LinkRouter.Route` gains `.share(String)`. `routeCommand` handles
  `share` with a required `id` query item; a missing or non-UUID id is
  `.refuse("The link had nothing to share.")`.
- `AppShell.route` handles `.share` on macOS by taking the payload and calling
  `ComposeWindows.shared.compose(mailto:profile:attachments:)`. On iOS the
  route is refused; nothing sends it there.

### Attaching in the compose window

`ComposeWindows.compose(mailto:profile:mode:)` gains an `attachments: [URL]`
parameter, default empty. Shares always use `.window` mode.

After the compose page has loaded, a new `ComposeAttachments` helper (its own
file; `ComposePool.swift` is already 900 lines) does the work:

1. Waits for a live compose controller in the page, polling as the existing
   send-signal patch does, with a 15 second limit.
2. For each file, sends the bytes to the page in base64 chunks of 512 KB
   through `callAsyncJavaScript`, which the page accumulates into a `Blob`.
3. Builds `new File([blob], name, { type })` and calls
   `controller.attachFiles([file])` once per file.
4. Reports back per file whether it was handed over.

The script lives in a Swift string beside the helper, as the existing compose
scripts do, and runs in the page's own content world, since it needs
`window.FastMail`.

## Failure handling

- Total size over 50 MB (Fastmail's message size limit): the extension refuses
  with an alert before copying anything.
- No usable content in the share: alert "Nothing shareable arrived.", cancel.
- App link cannot be opened: alert, cancel, and remove the folder just written.
- Payload missing or unreadable in the app: the app's usual toast for a link
  it cannot open, and no compose window.
- Compose controller or `attachFiles` not found within the limit, or a file
  fails to hand over: the compose window stays open with subject and body, and
  an alert names the files that were not attached. The payload folder is still
  deleted; the originals are untouched where they were shared from.

## Open point to verify first

Whether a sandboxed macOS share extension may open the app's custom link with
`NSWorkspace.shared.open`. If it may not, the extension posts a distributed
notification named after the app's bundle identifier, carrying the share id,
and the app observes it; in that case the app must already be running, so the
extension first launches it by bundle identifier. This is settled by the first
build of the extension, before the app side is written.

## Testing

- Unit (`Packages/FastmailShellKit/Tests`): manifest round trip; `take`
  rejecting ids that are not UUIDs; `sweep` by age; `mailto` building for
  link-only, text-only, files-only and mixed shares, including `&` and `+` in
  a subject; `LinkRouter` share route and its refusals.
- Integration (`Tests/IntegrationTests`): the injection script against a page
  with a fake `FastMail.classes.ComposeController`, following
  `ComposePoolScriptTests`: files arrive with the right name, type and bytes
  across a chunk boundary; a missing controller reports failure.
- Manual, in both apps: a page from Safari, a text selection, one image from
  Preview, three files from Finder, a share over the size limit, and a share
  while the app is not running.

## Out of scope

- Sharing into a draft that is already open.
- Choosing recipients or editing in the extension.
- Inline images in the body; images arrive as attachments.
- Any change to the iOS apps or extensions.
