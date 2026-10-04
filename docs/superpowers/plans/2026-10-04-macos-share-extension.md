# macOS Share Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each Mac shell app (mdbraber.com, nexthealth.nl) gets a share menu entry that opens a compose window in that account with the shared link and text in subject and body and the shared files attached.

**Architecture:** A sandboxed macOS share extension per app copies the shared content into an App Group folder and opens the app with `<scheme>://share?id=<uuid>`. The app reads the folder, opens a compose window through the existing mailto path, and hands the files to Fastmail's compose page by calling the page's own `ComposeController.attachFiles` with `File` objects rebuilt from base64 chunks.

**Tech Stack:** Swift 6, AppKit, WebKit (`callAsyncJavaScript`), XcodeGen (`project.yml`), swift-testing for the package, XCTest for `Tests/IntegrationTests`.

**Spec:** `docs/superpowers/specs/2026-10-04-macos-share-extension-design.md`

## Global Constraints

- macOS only. The iOS apps and the existing `PersonalShare` / `WorkShare` iOS extensions must build and behave exactly as before.
- Deployment target stays macOS 14.0.
- App Group: `$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.share` in entitlements; the same group read at run time from the `FMShareGroup` Info.plist key, written there as `$(DEVELOPMENT_TEAM).com.mdbraber.fastmail-custom.share`.
- Extension targets: `PersonalShareMac`, `WorkShareMac`; bundle identifiers `com.mdbraber.fastmail-custom.personal.share-mac` and `com.mdbraber.fastmail-custom.work.share-mac`.
- URL schemes: `fastmail-personal`, `fastmail-work`. New command: `share?id=<uuid>`.
- Limits: 20 items per share, 50 MB total (`50 * 1024 * 1024` bytes), refused in the extension before anything is copied.
- Base64 chunks of 512 KB (`512 * 1024` bytes); 15 second wait for the page's compose controller.
- Container layout: `Shares/<uuid>/manifest.json` and `Shares/<uuid>/files/<n>-<name>`.
- No Fastmail credentials, no API calls from the app.
- Comments explain why, in the plain prose the surrounding code uses. Commit messages are one plain sentence, no prefix (see `git log`).
- Work on a branch named `macos-share-extension`, not on `main`.
- `project.yml` is the source of truth; run `make generate` after changing it. Never edit `FastmailShell.xcodeproj` by hand.

## Review Focus

1. Two shared files with the same name (two `IMG_0001.jpg` from different folders): both must arrive as separate attachments. Pinned in Task 2 (`storingTwoFilesWithOneNameKeepsBoth`).
2. A subject or text containing `&`, `+`, `#`, emoji or line breaks: the compose window must show it whole, not cut at the character. Pinned in Task 2 (`mailtoKeepsReservedCharactersAndLineBreaks`).
3. A `share?id=` link sent by another app with a path instead of an id, or a manifest whose file path points outside its folder: nothing outside the share folder may be read or deleted. Pinned in Task 2 (`takeRefusesAnIDThatIsNotAUUID`, `takeDropsAFilePathThatLeavesTheFolder`) and Task 3.
4. An empty file, and a file whose size is an exact multiple of the chunk size: both must arrive with the right byte count. Pinned in Task 4 (`testEmptyAndChunkAlignedFilesArriveWhole`).
5. A file name with quotes, non-ASCII letters or a backslash: the name must reach the page unchanged and must not break the script. Pinned in Task 4 (`testAwkwardFileNameArrivesUnchanged`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `Packages/FastmailShellKit/Sources/FastmailShellKit/SharedPayload.swift` (new) | The manifest, where shares live, writing, taking, sweeping, and the mailto for subject and body. Foundation only, because the extensions compile this one file directly. |
| `Packages/FastmailShellKit/Sources/FastmailShellKit/ComposeAttachments.swift` (new, macOS) | Hands files to a compose page and reports which were not handed over. |
| `Packages/FastmailShellKit/Sources/FastmailShellKit/LinkRouter.swift` | Gains the `share` command and `.share(String)` route. |
| `Packages/FastmailShellKit/Sources/FastmailShellKit/ComposePool.swift` | `ComposeWindows.compose(mailto:…)` gains `attachments` and a completion. |
| `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift` | Handles `.share`, sweeps old shares at launch. |
| `Extensions/SharedMac/ShareViewController.swift` (new) | The extension: gathers items, writes the payload, opens the app. |
| `Extensions/SharedMac/ShareMac.entitlements` (new) | Sandbox and App Group for both extensions. |
| `Extensions/PersonalShareMac/Info.plist`, `Extensions/WorkShareMac/Info.plist` (new) | Per-app extension identity. |
| `Apps/Personal/Info.plist`, `Apps/Work/Info.plist`, `Apps/*/macOS.entitlements`, `project.yml`, `README.md` | Wiring. |

---

### Task 1: Confirm the page accepts a file through `attachFiles`

This is a probe, not product code. It uploads one tiny file to the live Personal account and leaves a draft that is deleted at the end. **Ask the user for a go-ahead before running Step 3**; everything else in the plan rests on this answer.

**Files:** none.

**Interfaces:**
- Produces: the confirmed way to reach the controller, used verbatim in Task 4: `FastMail.getViewFromNode(document.querySelector('.v-Compose'))`, then walk `get('parentView')` until `get('controller')` has an `attachFiles` function.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/mdbraber/src/fastmail-custom
git switch -c macos-share-extension
```

- [ ] **Step 2: Open a compose window that is not the pooled one**

```bash
open 'fastmail-personal://compose?mailto=mailto%3A%3Fsubject%3Dshare-probe'
```

Expected: a compose window appears in mdbraber.com with the subject `share-probe`.

- [ ] **Step 3: Attach a file from script and read the result**

```bash
osascript <<'EOF'
tell application "mdbraber.com"
  set w to first window whose kind is compose and visible is true
  do JavaScript "var F=window.FastMail; var v=F.getViewFromNode(document.querySelector('.v-Compose')); var c=null; while(v&&!c){var x=v.get('controller'); if(x&&typeof x.attachFiles==='function'){c=x}else{v=v.get('parentView')}} if(!c){return 'no controller'} c.attachFiles([new File([new TextEncoder().encode('probe')],'share-probe.txt',{type:'text/plain'})]); return 'attachments: '+c.get('attachments').length;" in w
end tell
EOF
```

Expected: `attachments: 1`, and within a few seconds the compose window shows `share-probe.txt` as an attachment with no error banner.

- [ ] **Step 4: Clean up**

Close the compose window and delete the `share-probe` draft from Drafts.

- [ ] **Step 5: Decide**

If the attachment appeared and uploaded: continue with Task 2. If it did not: stop and report what the page did; the spec's attachment approach needs rethinking with the user before any code is written.

---

### Task 2: `SharedPayload`

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/SharedPayload.swift`
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/SharedPayloadTests.swift`

**Interfaces:**
- Produces:
  - `SharedPayload(subject: String, text: String, url: String?, files: [SharedPayload.File])`
  - `SharedPayload.File(path: String, name: String, type: String)`
  - `SharedPayload.Attachment` with `url: URL`, `name: String`, `type: String`
  - `SharedPayload.Taken` with `payload: SharedPayload`, `attachments: [Attachment]`
  - `static let sizeLimit: Int`, `static let itemLimit: Int`, `static let groupInfoKey: String`
  - `static func root(bundle: Bundle = .main) -> URL?`
  - `static func isValid(id: String) -> Bool`
  - `static func subject(title: String?, fileNames: [String]) -> String`
  - `static func store(_ source: URL, index: Int, id: String, in root: URL) throws -> File`
  - `static func store(_ data: Data, named name: String, index: Int, id: String, in root: URL) throws -> File`
  - `func write(id: String, in root: URL) throws`
  - `static func take(id: String, in root: URL) -> Taken?`
  - `static func remove(id: String, in root: URL)`
  - `static func sweep(olderThan age: TimeInterval = 86_400, now: Date = Date(), in root: URL)`
  - `var mailto: String`

- [ ] **Step 1: Write the failing tests**

`Packages/FastmailShellKit/Tests/FastmailShellKitTests/SharedPayloadTests.swift`:

```swift
import Foundation
import Testing
@testable import FastmailShellKit

private func temporaryRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("SharedPayloadTests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
}

private func sourceFile(named name: String, in folder: String, contents: String, under root: URL) throws -> URL {
    let directory = root.appendingPathComponent("sources/\(folder)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent(name)
    try Data(contents.utf8).write(to: url)
    return url
}

private func fields(of mailto: String) -> [String: String] {
    guard let question = mailto.firstIndex(of: "?") else { return [:] }
    var fields: [String: String] = [:]
    for pair in mailto[mailto.index(after: question)...].split(separator: "&") {
        let parts = pair.split(separator: "=", maxSplits: 1)
        fields[String(parts[0])] = parts.count > 1 ? String(parts[1]).removingPercentEncoding : ""
    }
    return fields
}

@Test func aShareRoundTripsThroughItsFolder() throws {
    let root = try temporaryRoot()
    let id = UUID().uuidString
    let source = try sourceFile(named: "notes.txt", in: "a", contents: "hello", under: root)
    let file = try SharedPayload.store(source, index: 0, id: id, in: root)
    let payload = SharedPayload(subject: "Notes", text: "See attached", url: "https://example.com/", files: [file])
    try payload.write(id: id, in: root)

    let taken = try #require(SharedPayload.take(id: id, in: root))
    #expect(taken.payload == payload)
    #expect(taken.attachments.count == 1)
    #expect(taken.attachments[0].name == "notes.txt")
    #expect(taken.attachments[0].type == "text/plain")
    #expect(try Data(contentsOf: taken.attachments[0].url) == Data("hello".utf8))
}

@Test func storingTwoFilesWithOneNameKeepsBoth() throws {
    let root = try temporaryRoot()
    let id = UUID().uuidString
    let first = try sourceFile(named: "IMG_0001.jpg", in: "a", contents: "one", under: root)
    let second = try sourceFile(named: "IMG_0001.jpg", in: "b", contents: "two", under: root)
    let files = [
        try SharedPayload.store(first, index: 0, id: id, in: root),
        try SharedPayload.store(second, index: 1, id: id, in: root),
    ]
    try SharedPayload(subject: "", text: "", url: nil, files: files).write(id: id, in: root)

    let taken = try #require(SharedPayload.take(id: id, in: root))
    #expect(taken.attachments.map(\.name) == ["IMG_0001.jpg", "IMG_0001.jpg"])
    #expect(try taken.attachments.map { try String(decoding: Data(contentsOf: $0.url), as: UTF8.self) } == ["one", "two"])
}

@Test func storedDataGetsItsNameAndAnUnknownTypeFallsBack() throws {
    let root = try temporaryRoot()
    let id = UUID().uuidString
    let file = try SharedPayload.store(Data([1, 2, 3]), named: "a/b:c.zzzunknown", index: 0, id: id, in: root)
    #expect(file.name == "a-b-c.zzzunknown")
    #expect(file.type == "application/octet-stream")
    #expect(file.path == "files/0-a-b-c.zzzunknown")
}

@Test func takeRefusesAnIDThatIsNotAUUID() throws {
    let root = try temporaryRoot()
    for bad in ["", "..", "../other", "abc", "3F2504E0-4F89-11D3-9A0C-0305E82C3301/.."] {
        #expect(!SharedPayload.isValid(id: bad))
        #expect(SharedPayload.take(id: bad, in: root) == nil)
    }
    #expect(SharedPayload.isValid(id: "3F2504E0-4F89-11D3-9A0C-0305E82C3301"))
}

@Test func takeDropsAFilePathThatLeavesTheFolder() throws {
    let root = try temporaryRoot()
    let id = UUID().uuidString
    try Data("secret".utf8).write(to: root.appendingPathComponent("outside.txt"))
    let payload = SharedPayload(
        subject: "", text: "", url: nil,
        files: [SharedPayload.File(path: "../outside.txt", name: "outside.txt", type: "text/plain")]
    )
    try payload.write(id: id, in: root)
    let taken = try #require(SharedPayload.take(id: id, in: root))
    #expect(taken.attachments.isEmpty)
}

@Test func takeOfAMissingShareIsNothing() throws {
    let root = try temporaryRoot()
    #expect(SharedPayload.take(id: UUID().uuidString, in: root) == nil)
}

@Test func removeDeletesOnlyThatShare() throws {
    let root = try temporaryRoot()
    let kept = UUID().uuidString
    let gone = UUID().uuidString
    try SharedPayload(subject: "a", text: "", url: nil, files: []).write(id: kept, in: root)
    try SharedPayload(subject: "b", text: "", url: nil, files: []).write(id: gone, in: root)
    SharedPayload.remove(id: gone, in: root)
    SharedPayload.remove(id: "../\(kept)", in: root)
    #expect(SharedPayload.take(id: gone, in: root) == nil)
    #expect(SharedPayload.take(id: kept, in: root) != nil)
}

@Test func sweepRemovesOnlySharesOlderThanTheAge() throws {
    let root = try temporaryRoot()
    let old = UUID().uuidString
    let fresh = UUID().uuidString
    try SharedPayload(subject: "old", text: "", url: nil, files: []).write(id: old, in: root)
    try SharedPayload(subject: "fresh", text: "", url: nil, files: []).write(id: fresh, in: root)
    try Data().write(to: root.appendingPathComponent("not-a-share.txt"))
    try FileManager.default.setAttributes(
        [.modificationDate: Date(timeIntervalSinceNow: -2 * 86_400)],
        ofItemAtPath: root.appendingPathComponent(old).path
    )
    SharedPayload.sweep(in: root)
    #expect(SharedPayload.take(id: old, in: root) == nil)
    #expect(SharedPayload.take(id: fresh, in: root) != nil)
    #expect(FileManager.default.fileExists(atPath: root.appendingPathComponent("not-a-share.txt").path))
}

@Test func sweepOfAMissingRootDoesNothing() {
    SharedPayload.sweep(in: URL(fileURLWithPath: "/nonexistent-\(UUID().uuidString)"))
}

@Test func subjectIsTheTitleThenTheFirstFileName() {
    #expect(SharedPayload.subject(title: "A page", fileNames: ["a.pdf"]) == "A page")
    #expect(SharedPayload.subject(title: "  \n", fileNames: ["a.pdf", "b.pdf"]) == "a.pdf")
    #expect(SharedPayload.subject(title: nil, fileNames: []) == "")
}

@Test func mailtoCarriesSubjectTextAndLink() {
    let payload = SharedPayload(subject: "A page", text: "Worth a read", url: "https://example.com/a", files: [])
    let parsed = fields(of: payload.mailto)
    #expect(payload.mailto.hasPrefix("mailto:?"))
    #expect(parsed["subject"] == "A page")
    #expect(parsed["body"] == "Worth a read\r\n\r\nhttps://example.com/a")
}

@Test func mailtoLeavesOutWhatIsEmpty() {
    #expect(SharedPayload(subject: "", text: "", url: nil, files: []).mailto == "mailto:")
    #expect(fields(of: SharedPayload(subject: "", text: "", url: "https://example.com/", files: []).mailto)
        == ["body": "https://example.com/"])
    #expect(fields(of: SharedPayload(subject: "a.pdf", text: "", url: nil, files: []).mailto)
        == ["subject": "a.pdf"])
}

@Test func mailtoDoesNotRepeatALinkAlreadyInTheText() {
    let payload = SharedPayload(subject: "", text: "Look: https://example.com/a", url: "https://example.com/a", files: [])
    #expect(fields(of: payload.mailto)["body"] == "Look: https://example.com/a")
}

@Test func mailtoKeepsReservedCharactersAndLineBreaks() {
    let payload = SharedPayload(subject: "R&D + Q#3 = 100% 🎉", text: "one\ntwo\r\nthree", url: nil, files: [])
    let raw = payload.mailto
    #expect(!raw.dropFirst("mailto:?".count).contains(" "))
    #expect(raw.components(separatedBy: "&").count == 2)
    #expect(!raw.contains("+") && !raw.contains("#"))
    let parsed = fields(of: raw)
    #expect(parsed["subject"] == "R&D + Q#3 = 100% 🎉")
    #expect(parsed["body"] == "one\r\ntwo\r\nthree")
}
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd Packages/FastmailShellKit && swift test --filter SharedPayloadTests`
Expected: build failure, `cannot find 'SharedPayload' in scope`.

- [ ] **Step 3: Write `SharedPayload.swift`**

```swift
import Foundation
import UniformTypeIdentifiers

/// What a share extension hands to its app. The extension is sandboxed and
/// the files it is given cannot be read by the app, so it copies them into a
/// folder both can reach, in an App Group container, beside a manifest that
/// says what was shared. Foundation only: the extensions compile this file
/// on its own rather than link the whole kit.
public struct SharedPayload: Codable, Equatable, Sendable {
    public struct File: Codable, Equatable, Sendable {
        /// Relative to the share's folder.
        public let path: String
        public let name: String
        /// A MIME type.
        public let type: String

        public init(path: String, name: String, type: String) {
            self.path = path
            self.name = name
            self.type = type
        }
    }

    public struct Attachment: Equatable, Sendable {
        public let url: URL
        public let name: String
        public let type: String
    }

    public struct Taken: Equatable, Sendable {
        public let payload: SharedPayload
        public let attachments: [Attachment]
    }

    public var subject: String
    public var text: String
    public var url: String?
    public var files: [File]

    public init(subject: String, text: String, url: String?, files: [File]) {
        self.subject = subject
        self.text = text
        self.url = url
        self.files = files
    }

    public static let groupInfoKey = "FMShareGroup"
    /// Fastmail's limit for one message.
    public static let sizeLimit = 50 * 1024 * 1024
    public static let itemLimit = 20

    /// Where shares live, or nothing when the bundle names no group or was
    /// not signed into it.
    public static func root(bundle: Bundle = .main) -> URL? {
        guard
            let group = bundle.object(forInfoDictionaryKey: groupInfoKey) as? String,
            !group.isEmpty,
            let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
        else {
            return nil
        }
        return container.appendingPathComponent("Shares", isDirectory: true)
    }

    /// The id arrives in a link any app on the Mac can open, and names a
    /// folder to read and then delete, so it has to be an id and nothing else.
    public static func isValid(id: String) -> Bool {
        UUID(uuidString: id) != nil
    }

    static func folder(id: String, in root: URL) -> URL? {
        guard isValid(id: id) else { return nil }
        return root.appendingPathComponent(id, isDirectory: true)
    }

    public static func subject(title: String?, fileNames: [String]) -> String {
        let title = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty { return title }
        return fileNames.first ?? ""
    }

    /// Copies a file into the share. The index in front of the name keeps two
    /// files with one name apart.
    public static func store(_ source: URL, index: Int, id: String, in root: URL) throws -> File {
        let file = try slot(named: source.lastPathComponent, index: index, id: id, in: root)
        try FileManager.default.copyItem(at: source, to: file.url)
        return file.entry
    }

    public static func store(_ data: Data, named name: String, index: Int, id: String, in root: URL) throws -> File {
        let file = try slot(named: name, index: index, id: id, in: root)
        try data.write(to: file.url)
        return file.entry
    }

    private static func slot(named name: String, index: Int, id: String, in root: URL) throws -> (url: URL, entry: File) {
        guard let folder = folder(id: id, in: root) else { throw CocoaError(.fileNoSuchFile) }
        let files = folder.appendingPathComponent("files", isDirectory: true)
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        var safe = name
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        if safe.isEmpty { safe = "File" }
        let path = "files/\(index)-\(safe)"
        let type = UTType(filenameExtension: (safe as NSString).pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"
        return (folder.appendingPathComponent(path), File(path: path, name: safe, type: type))
    }

    public func write(id: String, in root: URL) throws {
        guard let folder = Self.folder(id: id, in: root) else { throw CocoaError(.fileNoSuchFile) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: folder.appendingPathComponent("manifest.json"), options: .atomic)
    }

    /// Reads a share without removing it: the files are still needed until
    /// they have been handed to the compose page. A file whose path leads
    /// out of the share's folder is left out.
    public static func take(id: String, in root: URL) -> Taken? {
        guard
            let folder = folder(id: id, in: root),
            let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
            let payload = try? JSONDecoder().decode(SharedPayload.self, from: data)
        else {
            return nil
        }
        let base = folder.standardizedFileURL.path + "/"
        let attachments = payload.files.compactMap { file -> Attachment? in
            let url = folder.appendingPathComponent(file.path).standardizedFileURL
            guard url.path.hasPrefix(base), FileManager.default.fileExists(atPath: url.path) else { return nil }
            return Attachment(url: url, name: file.name, type: file.type)
        }
        return Taken(payload: payload, attachments: attachments)
    }

    public static func remove(id: String, in root: URL) {
        guard let folder = folder(id: id, in: root) else { return }
        try? FileManager.default.removeItem(at: folder)
    }

    /// Removes shares that never reached the app: the link was not opened,
    /// or the app quit before it took them.
    public static func sweep(olderThan age: TimeInterval = 86_400, now: Date = Date(), in root: URL) {
        let entries = (try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.contentModificationDateKey]
        )) ?? []
        for entry in entries where isValid(id: entry.lastPathComponent) {
            let modified = (try? entry.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? now
            if now.timeIntervalSince(modified) > age {
                try? FileManager.default.removeItem(at: entry)
            }
        }
    }

    /// Subject and body as the mailto the compose path already takes: the
    /// text, then the link on a line of its own unless the text has it.
    public var mailto: String {
        var body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url, !url.isEmpty, !body.contains(url) {
            body += (body.isEmpty ? "" : "\n\n") + url
        }
        body = body
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\n", with: "\r\n")
        var fields: [String] = []
        if !subject.isEmpty { fields.append("subject=" + Self.encode(subject)) }
        if !body.isEmpty { fields.append("body=" + Self.encode(body)) }
        return "mailto:" + (fields.isEmpty ? "" : "?" + fields.joined(separator: "&"))
    }

    private static func encode(_ text: String) -> String {
        let unreserved = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        return text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd Packages/FastmailShellKit && swift test --filter SharedPayloadTests`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/SharedPayload.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/SharedPayloadTests.swift
git commit -m "Describe a share handed from an extension to its app"
```

---

### Task 3: The `share` link command

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/LinkRouter.swift` (the `Route` enum and `routeCommand`)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift` (the `switch` in `handle`, so the package still compiles)
- Test: `Packages/FastmailShellKit/Tests/FastmailShellKitTests/LinkRouterTests.swift`

**Interfaces:**
- Consumes: `SharedPayload.isValid(id:)`.
- Produces: `LinkRouter.Route.share(String)`, returned for `<scheme>://share?id=<uuid>`.

- [ ] **Step 1: Write the failing tests**

Append to `LinkRouterTests.swift` (it uses free `@Test` functions and the file's own `profile()` and `url(_:)` helpers):

```swift
@Test func shareCarriesTheIDOfWhatWasShared() {
    let id = "3F2504E0-4F89-11D3-9A0C-0305E82C3301"
    #expect(LinkRouter.route(url("fastmail-personal://share?id=\(id)"), profile: profile()) == .share(id))
}

@Test func shareWithoutAUsableIDIsRefused() {
    let refused = LinkRouter.Route.refuse("The link had nothing to share.")
    #expect(LinkRouter.route(url("fastmail-personal://share"), profile: profile()) == refused)
    #expect(LinkRouter.route(url("fastmail-personal://share?id="), profile: profile()) == refused)
    #expect(LinkRouter.route(url("fastmail-personal://share?id=..%2F..%2FDocuments"), profile: profile()) == refused)
    #expect(LinkRouter.route(url("fastmail-personal://share?id=abc"), profile: profile()) == refused)
}
```

- [ ] **Step 2: Run to see them fail**

Run: `cd Packages/FastmailShellKit && swift test --filter LinkRouterTests`
Expected: build failure, `type 'LinkRouter.Route' has no member 'share'`.

- [ ] **Step 3: Add the route**

In `LinkRouter.swift`, add a case to `Route` after `compose`:

```swift
        /// Something handed over by the share extension, named by the id of
        /// the folder it was left in.
        case share(String)
```

In `routeCommand`, add before `default:`:

```swift
        case "share":
            guard
                let id = items.first(where: { $0.name == "id" })?.value,
                SharedPayload.isValid(id: id)
            else {
                return .refuse("The link had nothing to share.")
            }
            return .share(id)
```

In `AppShell.swift`, in `handle(_:message:)`, add a case to the `switch LinkRouter.route(url, profile: live)` after the `.handoff` case, so the switch stays exhaustive. Task 5 replaces its body:

```swift
        case .share:
            PageToast.show("Sharing is not available here.")
```

- [ ] **Step 4: Run to see them pass**

Run: `cd Packages/FastmailShellKit && swift test --filter LinkRouterTests`
Expected: all pass, including the existing ones.

- [ ] **Step 5: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/LinkRouter.swift Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift Packages/FastmailShellKit/Tests/FastmailShellKitTests/LinkRouterTests.swift
git commit -m "Route a share link to the share it names"
```

---

### Task 4: Handing files to the compose page

**Files:**
- Create: `Packages/FastmailShellKit/Sources/FastmailShellKit/ComposeAttachments.swift`
- Test: `Tests/IntegrationTests/ComposeAttachmentsTests.swift`

**Interfaces:**
- Consumes: `SharedPayload.Attachment` (`url`, `name`, `type`).
- Produces (macOS only, `@MainActor`):
  - `ComposeAttachments.chunkSize: Int`
  - `ComposeAttachments.attach(_ files: [SharedPayload.Attachment], to view: WKWebView, timeout: TimeInterval = 15) async -> [String]`, the names of the files that were **not** handed over, empty on full success.
  - `ComposeAttachments.load(_ request: URLRequest, attaching files: [SharedPayload.Attachment], in view: WKWebView) async -> [String]`, the same result, after loading `request` first.
  - `ComposeAttachments.report(notAttached names: [String])`, an alert naming them; does nothing for an empty list.

- [ ] **Step 1: Write the failing tests**

`Tests/IntegrationTests/ComposeAttachmentsTests.swift`:

```swift
import XCTest
import WebKit
@testable import FastmailShellKit

// The share extension's files reach a message by being handed to Fastmail's
// compose page as File objects, the way a drop hands them over. The page
// here stands in for Fastmail's: a compose node, a view found from it, and a
// controller a level up that records what attachFiles was given.
@MainActor
final class ComposeAttachmentsTests: XCTestCase {
    private var webView: WKWebView!
    private var folder: URL!

    override func setUp() async throws {
        folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("ComposeAttachmentsTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDown() async throws {
        webView = nil
        try? FileManager.default.removeItem(at: folder)
    }

    private static let composePage = """
    <html><body><div class="v-Compose"></div><script>
    window.attached = [];
    var controller = { attachFiles: function (files) { for (var i = 0; i < files.length; i += 1) { window.attached.push(files[i]); } } };
    var parent = { get: function (key) { return key === 'controller' ? controller : null; } };
    var leaf = { get: function (key) { return key === 'parentView' ? parent : null; } };
    window.FastMail = { getViewFromNode: function () { return leaf; } };
    </script></body></html>
    """

    private func load(_ html: String) async throws {
        webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.loadHTMLString(html, baseURL: URL(string: "https://app.fastmail.com/")!)
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if try await webView.evaluateJavaScript("document.readyState === 'complete'") as? Bool == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("page did not load")
    }

    private func file(named name: String, type: String, bytes: Data) throws -> SharedPayload.Attachment {
        let url = folder.appendingPathComponent(UUID().uuidString)
        try bytes.write(to: url)
        return SharedPayload.Attachment(url: url, name: name, type: type)
    }

    /// Name, type, size and the sum of the bytes of everything attached.
    private func attached() async throws -> [[String: Any]] {
        let result = try await webView.callAsyncJavaScript("""
        const out = [];
        for (const f of window.attached) {
            const bytes = new Uint8Array(await f.arrayBuffer());
            let sum = 0;
            for (const b of bytes) { sum += b; }
            out.push({ name: f.name, type: f.type, size: f.size, sum: sum, isFile: f instanceof File });
        }
        return out;
        """, contentWorld: .page)
        return result as? [[String: Any]] ?? []
    }

    private func pattern(_ count: Int) -> Data {
        Data((0..<count).map { UInt8($0 % 251) })
    }

    private func sum(_ data: Data) -> Int {
        data.reduce(0) { $0 + Int($1) }
    }

    func testAFileLargerThanAChunkArrivesWhole() async throws {
        try await load(Self.composePage)
        let bytes = pattern(ComposeAttachments.chunkSize + 10)
        let failed = await ComposeAttachments.attach(
            [try file(named: "report.pdf", type: "application/pdf", bytes: bytes)], to: webView
        )
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files[0]["name"] as? String, "report.pdf")
        XCTAssertEqual(files[0]["type"] as? String, "application/pdf")
        XCTAssertEqual(files[0]["size"] as? Int, bytes.count)
        XCTAssertEqual(files[0]["sum"] as? Int, sum(bytes))
        XCTAssertEqual(files[0]["isFile"] as? Bool, true)
    }

    func testSeveralFilesArriveInOrder() async throws {
        try await load(Self.composePage)
        let failed = await ComposeAttachments.attach([
            try file(named: "IMG_0001.jpg", type: "image/jpeg", bytes: Data([1, 2, 3])),
            try file(named: "IMG_0001.jpg", type: "image/jpeg", bytes: Data([4, 5])),
            try file(named: "notes.txt", type: "text/plain", bytes: Data([6])),
        ], to: webView)
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.map { $0["name"] as? String }, ["IMG_0001.jpg", "IMG_0001.jpg", "notes.txt"])
        XCTAssertEqual(files.map { $0["sum"] as? Int }, [6, 9, 6])
    }

    func testEmptyAndChunkAlignedFilesArriveWhole() async throws {
        try await load(Self.composePage)
        let aligned = pattern(ComposeAttachments.chunkSize * 2)
        let failed = await ComposeAttachments.attach([
            try file(named: "empty.txt", type: "text/plain", bytes: Data()),
            try file(named: "aligned.bin", type: "application/octet-stream", bytes: aligned),
        ], to: webView)
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.map { $0["size"] as? Int }, [0, aligned.count])
        XCTAssertEqual(files[1]["sum"] as? Int, sum(aligned))
    }

    func testAwkwardFileNameArrivesUnchanged() async throws {
        try await load(Self.composePage)
        let name = "Überweisung \"final\" 'v2' \\ `x` ${y} 日本.pdf"
        let failed = await ComposeAttachments.attach(
            [try file(named: name, type: "application/pdf", bytes: Data([7]))], to: webView
        )
        XCTAssertEqual(failed, [])
        let files = try await attached()
        XCTAssertEqual(files.first?["name"] as? String, name)
    }

    func testAPageWithoutAComposeControllerReportsEveryFile() async throws {
        try await load("<html><body><p>Not compose</p></body></html>")
        let failed = await ComposeAttachments.attach([
            try file(named: "a.txt", type: "text/plain", bytes: Data([1])),
            try file(named: "b.txt", type: "text/plain", bytes: Data([2])),
        ], to: webView, timeout: 0.5)
        XCTAssertEqual(failed, ["a.txt", "b.txt"])
    }

    func testAPageMarkedStaleIsNotAttachedTo() async throws {
        try await load(Self.composePage)
        _ = try await webView.callAsyncJavaScript(ComposeAttachments.staleScript, contentWorld: .page)
        let failed = await ComposeAttachments.attach(
            [try file(named: "a.txt", type: "text/plain", bytes: Data([1]))], to: webView, timeout: 0.5
        )
        XCTAssertEqual(failed, ["a.txt"])
        let files = try await attached()
        XCTAssertEqual(files.count, 0)
    }

    func testAFileThatCannotBeReadIsReportedAndTheRestAttach() async throws {
        try await load(Self.composePage)
        let missing = SharedPayload.Attachment(
            url: folder.appendingPathComponent("gone"), name: "gone.txt", type: "text/plain"
        )
        let failed = await ComposeAttachments.attach(
            [missing, try file(named: "here.txt", type: "text/plain", bytes: Data([1]))], to: webView
        )
        XCTAssertEqual(failed, ["gone.txt"])
        let files = try await attached()
        XCTAssertEqual(files.map { $0["name"] as? String }, ["here.txt"])
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `make generate && xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test -only-testing:IntegrationTests/ComposeAttachmentsTests`
Expected: build failure, `cannot find 'ComposeAttachments' in scope`.

- [ ] **Step 3: Write `ComposeAttachments.swift`**

```swift
#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import WebKit

/// Hands files to Fastmail's compose page. A file dropped on a message ends
/// in the compose controller's attachFiles, and nothing else; so files that
/// arrived from the share extension are rebuilt in the page as File objects
/// and given to that same function, and the page uploads them as its own.
@MainActor
public enum ComposeAttachments {
    /// How much of a file goes to the page at a time. The bytes cross as
    /// base64 text, and one string for a whole 50 MB file is more than a
    /// single message to the page should carry.
    static let chunkSize = 512 * 1024

    /// The compose controller, found from the compose node the way the page
    /// finds a view from any node. A page marked stale is one about to be
    /// navigated away from; its controller is not the message's.
    private static let findController = """
    function fmshellComposeController() {
        if (window.__fmshellStale) { return null; }
        var F = window.FastMail;
        var node = document.querySelector('.v-Compose');
        if (!F || !F.getViewFromNode || !node) { return null; }
        var view = F.getViewFromNode(node);
        while (view && view.get) {
            var controller = view.get('controller');
            if (controller && typeof controller.attachFiles === 'function') { return controller; }
            view = view.get('parentView');
        }
        return null;
    }
    """

    static let staleScript = "window.__fmshellStale = true;"

    private static let readyScript = findController + "return !!fmshellComposeController();"

    private static let beginScript = """
    window.__fmshellShare = window.__fmshellShare || {};
    window.__fmshellShare[key] = [];
    """

    private static let appendScript = """
    var binary = atob(chunk);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) { bytes[i] = binary.charCodeAt(i); }
    window.__fmshellShare[key].push(bytes);
    """

    private static let finishScript = findController + """
    var parts = (window.__fmshellShare || {})[key];
    if (window.__fmshellShare) { delete window.__fmshellShare[key]; }
    var controller = fmshellComposeController();
    if (!parts || !controller) { return false; }
    controller.attachFiles([new File(parts, name, { type: type })]);
    return true;
    """

    /// Loads the message, then attaches. The page already in the window is a
    /// compose page too, with a controller of its own, so it is marked first:
    /// only the page that the load brings is attached to.
    static func load(
        _ request: URLRequest, attaching files: [SharedPayload.Attachment], in view: WKWebView
    ) async -> [String] {
        _ = try? await view.callAsyncJavaScript(staleScript, contentWorld: .page)
        view.load(request)
        return await attach(files, to: view)
    }

    /// The names of the files that could not be handed to the page.
    static func attach(
        _ files: [SharedPayload.Attachment], to view: WKWebView, timeout: TimeInterval = 15
    ) async -> [String] {
        guard await waitForController(in: view, timeout: timeout) else {
            return files.map(\.name)
        }
        var failed: [String] = []
        for file in files {
            if !(await attach(file, to: view)) { failed.append(file.name) }
        }
        return failed
    }

    private static func waitForController(in view: WKWebView, timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if (try? await view.callAsyncJavaScript(readyScript, contentWorld: .page)) as? Bool == true {
                return true
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        } while Date() < deadline
        return false
    }

    private static func attach(_ file: SharedPayload.Attachment, to view: WKWebView) async -> Bool {
        guard let data = try? Data(contentsOf: file.url, options: .mappedIfSafe) else { return false }
        let key = UUID().uuidString
        do {
            _ = try await view.callAsyncJavaScript(beginScript, arguments: ["key": key], contentWorld: .page)
            var offset = 0
            while offset < data.count {
                let end = min(offset + chunkSize, data.count)
                let chunk = data.subdata(in: offset..<end).base64EncodedString()
                _ = try await view.callAsyncJavaScript(
                    appendScript, arguments: ["key": key, "chunk": chunk], contentWorld: .page
                )
                offset = end
            }
            let handed = try await view.callAsyncJavaScript(
                finishScript,
                arguments: ["key": key, "name": file.name, "type": file.type],
                contentWorld: .page
            )
            return handed as? Bool == true
        } catch {
            return false
        }
    }

    /// Says which files did not make it. The message itself is open, with
    /// its subject and text, and the files are still where they were shared
    /// from, so they can be attached by hand.
    public static func report(notAttached names: [String]) {
        guard !names.isEmpty else { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = names.count == 1
            ? "A file could not be attached"
            : "\(names.count) files could not be attached"
        alert.informativeText = names.joined(separator: "\n")
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
#endif
```

- [ ] **Step 4: Run to see them pass**

Run: `xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test -only-testing:IntegrationTests/ComposeAttachmentsTests`
Expected: 7 tests pass.

Then confirm the package still builds for iOS, where this file compiles to nothing:
Run: `xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'generic/platform=iOS' -configuration Debug build CODE_SIGNING_ALLOWED=NO | tail -3`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/ComposeAttachments.swift Tests/IntegrationTests/ComposeAttachmentsTests.swift
git commit -m "Hand files to the compose page the way a drop does"
```

---

### Task 5: The app takes a share and opens it as a message

After this task a share can be driven end to end by hand, before any extension exists: a folder written into the group container plus `open fastmail-personal://share?id=…`.

**Files:**
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/ComposePool.swift` (`ComposeWindows.compose(mailto:profile:mode:)`, about line 609)
- Modify: `Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift` (the `.share` case in `handle`, and the macOS `.onAppear`)
- Modify: `Apps/Personal/macOS.entitlements`, `Apps/Work/macOS.entitlements`
- Modify: `Apps/Personal/Info.plist`, `Apps/Work/Info.plist`

**Interfaces:**
- Consumes: `SharedPayload.root()`, `.take(id:in:)`, `.remove(id:in:)`, `.sweep(in:)`, `.mailto`; `ComposeAttachments.load(_:attaching:in:)`, `.report(notAttached:)`; `LinkRouter.Route.share`.
- Produces: `ComposeWindows.compose(mailto: String, profile: Profile, mode: ComposeMode = .window, attachments: [SharedPayload.Attachment] = [], attached: (@MainActor ([String]) -> Void)? = nil)`. Existing callers compile unchanged.

- [ ] **Step 1: Add the App Group to both Mac apps**

In `Apps/Personal/macOS.entitlements` and `Apps/Work/macOS.entitlements`, add inside the top-level `<dict>`, after the `ubiquity-kvstore-identifier` entry:

```xml
    <!-- Where the share extension leaves what was shared with this app.
         The extension is sandboxed, and files it was given cannot be read
         from here, so it copies them into this group's container. -->
    <key>com.apple.security.application-groups</key>
    <array>
        <string>$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.share</string>
    </array>
```

In `Apps/Personal/Info.plist` and `Apps/Work/Info.plist`, add inside the top-level `<dict>`:

```xml
    <key>FMShareGroup</key>
    <string>$(DEVELOPMENT_TEAM).com.mdbraber.fastmail-custom.share</string>
```

- [ ] **Step 2: Let a compose window take attachments**

In `ComposePool.swift`, replace the signature and the load of `compose(mailto:profile:mode:)`. The method currently begins:

```swift
    public func compose(mailto: String, profile: Profile, mode: ComposeMode = .window) {
        configure(profile: profile)
        guard let pool else { return }
        // A link from another app finds this one inactive, with no key window
        let host = mode == .tab ? Self.tabHost(NSApp.keyWindow) ?? Self.mailboxWindow() : nil
        let window = pool.take()
        Self.webView(of: window)?
            .load(URLRequest(url: ComposeURL.url(for: profile, mailto: mailto)))
```

Change it to:

```swift
    /// `attachments` are files to hand to the page once the message is open,
    /// as the share extension leaves them; `attached` hears the names of any
    /// that could not be.
    public func compose(
        mailto: String,
        profile: Profile,
        mode: ComposeMode = .window,
        attachments: [SharedPayload.Attachment] = [],
        attached: (@MainActor ([String]) -> Void)? = nil
    ) {
        configure(profile: profile)
        guard let pool else {
            attached?(attachments.map(\.name))
            return
        }
        // A link from another app finds this one inactive, with no key window
        let host = mode == .tab ? Self.tabHost(NSApp.keyWindow) ?? Self.mailboxWindow() : nil
        let window = pool.take()
        let request = URLRequest(url: ComposeURL.url(for: profile, mailto: mailto))
        if attachments.isEmpty {
            Self.webView(of: window)?.load(request)
            attached?([])
        } else if let view = Self.webView(of: window) {
            Task { @MainActor in
                attached?(await ComposeAttachments.load(request, attaching: attachments, in: view))
            }
        } else {
            attached?(attachments.map(\.name))
        }
```

Leave the rest of the method (tabbing, placing, bringing forward) as it is.

- [ ] **Step 3: Handle the share route and sweep at launch**

In `AppShell.swift`, replace the `.share` case added in Task 3 with:

```swift
        case .share(let id):
            #if canImport(AppKit) && !targetEnvironment(macCatalyst)
            guard
                let root = SharedPayload.root(),
                let taken = SharedPayload.take(id: id, in: root)
            else {
                PageToast.show("What was shared could not be read.")
                return
            }
            // Always a window of its own: what was shared is a new message,
            // whatever the Compose button is set to do.
            ComposeWindows.shared.compose(
                mailto: taken.payload.mailto, profile: live, attachments: taken.attachments
            ) { notAttached in
                // The page holds the files now, or never will; either way
                // the copies have done their work.
                SharedPayload.remove(id: id, in: root)
                ComposeAttachments.report(notAttached: notAttached)
            }
            #else
            PageToast.show("Sharing is not available here.")
            #endif
```

In the macOS `.onAppear` block (the one that begins `ComposeWindows.shared.configure(profile: live)`), add as its second statement:

```swift
            // Shares that never arrived: the link was not opened, or the app
            // quit before it took them.
            if let root = SharedPayload.root() { SharedPayload.sweep(in: root) }
```

- [ ] **Step 4: Run every test**

Run: `cd Packages/FastmailShellKit && swift test`
Expected: all pass.

Run: `xcodebuild -project FastmailShell.xcodeproj -scheme IntegrationTests -destination 'platform=macOS' test | tail -5`
Expected: `** TEST SUCCEEDED **`

- [ ] **Step 5: Install and drive a share by hand**

```bash
make install-macos
```

Quit and reopen mdbraber.com, then:

```bash
TEAM=$(codesign -d --entitlements - /Applications/mdbraber.com.app 2>/dev/null | grep -A2 application-groups | grep -oE '[A-Z0-9]{10}' | head -1)
ROOT="$HOME/Library/Group Containers/$TEAM.com.mdbraber.fastmail-custom.share/Shares"
ID=$(uuidgen)
mkdir -p "$ROOT/$ID/files"
printf 'hello from a hand-made share' > "$ROOT/$ID/files/0-hello.txt"
cat > "$ROOT/$ID/manifest.json" <<EOF
{"subject":"Hand-made share","text":"Body text","url":"https://example.com/","files":[{"path":"files/0-hello.txt","name":"hello.txt","type":"text/plain"}]}
EOF
open "fastmail-personal://share?id=$ID"
sleep 20; ls "$ROOT"
```

Expected: `TEAM` is not empty (if it is, the App Group entitlement did not make it into the signed app; fix that before going on). A compose window opens in mdbraber.com with subject `Hand-made share`, a body of `Body text` then `https://example.com/`, and `hello.txt` attached and uploaded. The final `ls` no longer lists the id. Discard the draft afterwards.

Then check the refusal: `open "fastmail-personal://share?id=$(uuidgen)"`. Expected: the toast `What was shared could not be read.` and no compose window.

- [ ] **Step 6: Commit**

```bash
git add Packages/FastmailShellKit/Sources/FastmailShellKit/ComposePool.swift Packages/FastmailShellKit/Sources/FastmailShellKit/AppShell.swift Apps/Personal/macOS.entitlements Apps/Work/macOS.entitlements Apps/Personal/Info.plist Apps/Work/Info.plist
git commit -m "Open what was shared with the app as a message with its files attached"
```

---

### Task 6: The share extensions

**Files:**
- Create: `Extensions/SharedMac/ShareViewController.swift`
- Create: `Extensions/SharedMac/ShareMac.entitlements`
- Create: `Extensions/PersonalShareMac/Info.plist`
- Create: `Extensions/WorkShareMac/Info.plist`
- Modify: `project.yml` (two targets, two embeddings)
- Modify: `README.md` (line 112, the `Extensions/` row)

**Interfaces:**
- Consumes: `SharedPayload` (compiled into the extension from its source file), the `share?id=` command from Task 3, the app behaviour from Task 5.

- [ ] **Step 1: Entitlements**

`Extensions/SharedMac/ShareMac.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- A share extension on the Mac only loads sandboxed. -->
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <!-- The folder the app reads what was shared from; the app cannot read
         the files this extension was given, so they are copied there. -->
    <key>com.apple.security.application-groups</key>
    <array>
        <string>$(TeamIdentifierPrefix)com.mdbraber.fastmail-custom.share</string>
    </array>
</dict>
</plist>
```

- [ ] **Step 2: Info.plists**

`Extensions/PersonalShareMac/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundleDisplayName</key>
    <string>mdbraber.com</string>
    <key>CFBundlePackageType</key>
    <string>XPC!</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>$(MACOSX_DEPLOYMENT_TARGET)</string>
    <key>FMURLScheme</key>
    <string>fastmail-personal</string>
    <key>FMAppName</key>
    <string>mdbraber.com</string>
    <key>FMShareGroup</key>
    <string>$(DEVELOPMENT_TEAM).com.mdbraber.fastmail-custom.share</string>
    <key>NSExtension</key>
    <dict>
        <key>NSExtensionPointIdentifier</key>
        <string>com.apple.share-services</string>
        <key>NSExtensionPrincipalClass</key>
        <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
        <key>NSExtensionAttributes</key>
        <dict>
            <key>NSExtensionActivationRule</key>
            <dict>
                <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
                <integer>1</integer>
                <key>NSExtensionActivationSupportsText</key>
                <true/>
                <key>NSExtensionActivationSupportsFileWithMaxCount</key>
                <integer>20</integer>
                <key>NSExtensionActivationSupportsImageWithMaxCount</key>
                <integer>20</integer>
            </dict>
        </dict>
    </dict>
</dict>
</plist>
```

`Extensions/WorkShareMac/Info.plist` is the same file with three values changed: `CFBundleDisplayName` → `nexthealth.nl`, `FMURLScheme` → `fastmail-work`, `FMAppName` → `nexthealth.nl`. Write it out in full; do not symlink.

- [ ] **Step 3: The view controller**

`Extensions/SharedMac/ShareViewController.swift`:

```swift
import AppKit
import UniformTypeIdentifiers

/// Share to a Fastmail shell on the Mac: what was shared becomes a new
/// message in the app this extension belongs to. Nothing is shown here; the
/// compose window is where the message is written. The content is copied
/// into a folder the app can read, and the app is opened on a link naming it.
final class ShareViewController: NSViewController {
    private static let scheme = Bundle.main.object(forInfoDictionaryKey: "FMURLScheme") as? String ?? ""
    private static let appName = Bundle.main.object(forInfoDictionaryKey: "FMAppName") as? String ?? "Fastmail"
    private var handled = false

    /// A file as it was shared: somewhere on disk, or only as bytes, which
    /// is how an image comes from an app that has not saved it.
    private enum Item {
        case file(URL)
        case data(Data, name: String)

        var size: Int {
            switch self {
            case .file(let url):
                return (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
            case .data(let data, _):
                return data.count
            }
        }

        var name: String {
            switch self {
            case .file(let url): return url.lastPathComponent
            case .data(_, let name): return name
            }
        }
    }

    private struct Refusal: Error {
        let message: String
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 1, height: 1))
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        guard !handled else { return }
        handled = true
        Task { @MainActor in
            do {
                try await share()
                extensionContext?.completeRequest(returningItems: nil)
            } catch let refusal as Refusal {
                reject(refusal.message)
            } catch {
                reject("That could not be shared with \(Self.appName).")
            }
        }
    }

    private func share() async throws {
        guard let context = extensionContext, let root = SharedPayload.root() else {
            throw Refusal(message: "\(Self.appName) has nowhere to receive this.")
        }
        let inputs = context.inputItems.compactMap { $0 as? NSExtensionItem }
        var title = inputs.compactMap { $0.attributedTitle?.string }.first { !$0.isEmpty }
        var texts = inputs.compactMap { $0.attributedContentText?.string }.filter { !$0.isEmpty }
        var link: URL?
        var items: [Item] = []

        for provider in inputs.flatMap({ $0.attachments ?? [] }) {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
               let url = await Self.url(from: provider, type: .fileURL), url.isFileURL {
                items.append(.file(url))
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                      let url = await Self.url(from: provider, type: .url), !url.isFileURL {
                if link == nil { link = url }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                      let data = await Self.data(from: provider, type: .image) {
                items.append(.data(data, name: Self.imageName(for: provider, index: items.count)))
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                      let text = await Self.text(from: provider), !text.isEmpty, !texts.contains(text) {
                texts.append(text)
            }
        }

        // Safari gives the page's title as the text of a shared page; a
        // title said twice is a subject, not a body.
        if title == nil, link != nil, texts.count == 1, !texts[0].contains("\n") {
            title = texts.removeFirst()
        }
        let text = texts.joined(separator: "\n\n")

        guard link != nil || !text.isEmpty || !items.isEmpty else {
            throw Refusal(message: "Nothing shareable arrived.")
        }
        guard items.count <= SharedPayload.itemLimit else {
            throw Refusal(message: "No more than \(SharedPayload.itemLimit) files can be shared at once.")
        }
        guard items.reduce(0, { $0 + $1.size }) <= SharedPayload.sizeLimit else {
            throw Refusal(message: "These files are larger than the 50 MB a message can carry.")
        }

        let id = UUID().uuidString
        do {
            var files: [SharedPayload.File] = []
            for (index, item) in items.enumerated() {
                switch item {
                case .file(let url):
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    files.append(try SharedPayload.store(url, index: index, id: id, in: root))
                case .data(let data, let name):
                    files.append(try SharedPayload.store(data, named: name, index: index, id: id, in: root))
                }
            }
            let payload = SharedPayload(
                subject: SharedPayload.subject(title: title, fileNames: items.map(\.name)),
                text: text,
                url: link?.absoluteString,
                files: files
            )
            try payload.write(id: id, in: root)
        } catch {
            SharedPayload.remove(id: id, in: root)
            throw Refusal(message: "The shared items could not be copied for \(Self.appName).")
        }

        guard
            let command = URL(string: "\(Self.scheme)://share?id=\(id)"),
            NSWorkspace.shared.open(command)
        else {
            SharedPayload.remove(id: id, in: root)
            throw Refusal(message: "\(Self.appName) could not be opened.")
        }
    }

    private static func url(from provider: NSItemProvider, type: UTType) async -> URL? {
        let item = try? await provider.loadItem(forTypeIdentifier: type.identifier)
        return item as? URL
            ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
            ?? (item as? String).flatMap(URL.init(string:))
    }

    private static func text(from provider: NSItemProvider) async -> String? {
        let item = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
        return item as? String
            ?? (item as? Data).flatMap { String(data: $0, encoding: .utf8) }
            ?? (item as? NSAttributedString)?.string
    }

    private static func data(from provider: NSItemProvider, type: UTType) async -> Data? {
        await withCheckedContinuation { continuation in
            _ = provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
                continuation.resume(returning: data)
            }
        }
    }

    /// An image shared as bytes has no name of its own; it gets one that
    /// says what kind of image it is.
    private static func imageName(for provider: NSItemProvider, index: Int) -> String {
        let kind = provider.registeredTypeIdentifiers
            .compactMap { UTType($0) }
            .first { $0.conforms(to: .image) && $0.preferredFilenameExtension != nil }
        let base = provider.suggestedName.flatMap { $0.isEmpty ? nil : $0 } ?? "Image \(index + 1)"
        let ext = kind?.preferredFilenameExtension ?? "png"
        return (base as NSString).pathExtension.isEmpty ? "\(base).\(ext)" : base
    }

    private func reject(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = Self.appName
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
    }
}
```

- [ ] **Step 4: Targets in `project.yml`**

Under `targets:`, in `Personal.dependencies`, add after the existing `PersonalShare` entry:

```yaml
      - target: PersonalShareMac
        embed: true
        destinationFilters: [macOS]
```

In `Work.dependencies`, after the `WorkShare` entry:

```yaml
      - target: WorkShareMac
        embed: true
        destinationFilters: [macOS]
```

After the `WorkShare` target, add:

```yaml
  # The Mac's share menu: what was shared becomes a new message in the app
  # the extension sits in. SharedPayload is compiled in as a file, not through
  # the package, which links far more than an extension may use.
  PersonalShareMac:
    type: app-extension
    platform: macOS
    sources:
      - path: Extensions/PersonalShareMac
      - path: Extensions/SharedMac
      - path: Packages/FastmailShellKit/Sources/FastmailShellKit/SharedPayload.swift
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.mdbraber.fastmail-custom.personal.share-mac
        PRODUCT_NAME: PersonalShareMac
        INFOPLIST_FILE: Extensions/PersonalShareMac/Info.plist
        GENERATE_INFOPLIST_FILE: NO
        CODE_SIGN_ENTITLEMENTS: Extensions/SharedMac/ShareMac.entitlements
        ENABLE_HARDENED_RUNTIME: YES
        SKIP_INSTALL: YES

  WorkShareMac:
    type: app-extension
    platform: macOS
    sources:
      - path: Extensions/WorkShareMac
      - path: Extensions/SharedMac
      - path: Packages/FastmailShellKit/Sources/FastmailShellKit/SharedPayload.swift
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.mdbraber.fastmail-custom.work.share-mac
        PRODUCT_NAME: WorkShareMac
        INFOPLIST_FILE: Extensions/WorkShareMac/Info.plist
        GENERATE_INFOPLIST_FILE: NO
        CODE_SIGN_ENTITLEMENTS: Extensions/SharedMac/ShareMac.entitlements
        ENABLE_HARDENED_RUNTIME: YES
        SKIP_INSTALL: YES
```

In `README.md`, change the `Extensions/` row of the layout table to:

```markdown
| `Extensions/` | The share extensions: on iPhone and iPad they open a Fastmail link in the app, on the Mac they start a message from what was shared |
```

- [ ] **Step 5: Build, install, and see the extensions registered**

```bash
make install-macos
pluginkit -m -p com.apple.share-services | grep fastmail-custom
codesign -d --entitlements - "/Applications/mdbraber.com.app/Contents/PlugIns/PersonalShareMac.appex" 2>/dev/null | grep -E 'app-sandbox|fastmail-custom.share'
```

Expected: the build succeeds; `pluginkit` lists `com.mdbraber.fastmail-custom.personal.share-mac` and `com.mdbraber.fastmail-custom.work.share-mac`; the `codesign` output shows both the sandbox and the group. If `pluginkit` lists nothing, open each app once and look in System Settings → General → Login Items & Extensions → Sharing, where the two entries may need switching on.

Also confirm iOS still builds:
Run: `xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'generic/platform=iOS' -configuration Debug build CODE_SIGNING_ALLOWED=NO | tail -3`
Expected: `** BUILD SUCCEEDED **`, and the product has `PersonalShare.appex` but no `PersonalShareMac.appex`.

- [ ] **Step 6: Settle whether the extension may open the app's link**

In Safari, open any page, choose Share → mdbraber.com.

Expected: a compose window opens in mdbraber.com. If it does, go to Step 7.

If instead the alert `mdbraber.com could not be opened.` appears, the sandbox is refusing `NSWorkspace.shared.open`. Apply the spec's fallback, and only then:

In `ShareViewController.share()`, replace the final `guard … NSWorkspace.shared.open(command) …` block with:

```swift
        // The sandbox does not let this extension open the app's link, so
        // the app is told by name instead. A sandboxed process may post a
        // distributed notification only without a dictionary, so the id
        // travels as the notification's object.
        let appID = (Bundle.main.bundleIdentifier ?? "").replacingOccurrences(of: ".share-mac", with: "")
        guard !NSRunningApplication.runningApplications(withBundleIdentifier: appID).isEmpty else {
            SharedPayload.remove(id: id, in: root)
            throw Refusal(message: "Open \(Self.appName) first, then share again.")
        }
        DistributedNotificationCenter.default().postNotificationName(
            Notification.Name("\(appID).share"), object: id, userInfo: nil, deliverImmediately: true
        )
```

and in `AppShell.swift`'s macOS `.onAppear`, after the sweep line, add:

```swift
            // The share extension, when the sandbox will not let it open a
            // link: it names the share in a notification instead.
            if let appID = Bundle.main.bundleIdentifier {
                let scheme = live.urlScheme
                DistributedNotificationCenter.default().addObserver(
                    forName: Notification.Name("\(appID).share"), object: nil, queue: .main
                ) { note in
                    guard let id = note.object as? String, SharedPayload.isValid(id: id) else { return }
                    MainActor.assumeIsolated {
                        if let url = URL(string: "\(scheme)://share?id=\(id)") { PendingLinks.shared.open(url) }
                    }
                }
            }
```

Reinstall and repeat the Safari share. Tell the user this fallback was needed and that, with it, sharing only works while the app is running; the spec's "launch it by bundle identifier" is not possible from the sandbox if opening a link is not.

- [ ] **Step 7: Manual checks, in both apps**

For each of mdbraber.com and nexthealth.nl, discarding the draft after each:

| Share | Expected in the compose window |
|-------|-------------------------------|
| A page from Safari | Subject is the page title; body is the page's address |
| A text selection in Safari | Subject is the page title; body is the selection, then the address |
| A text selection in TextEdit | No subject; body is the selection |
| One image from Preview | Subject is the image's name; the image attached |
| Three files from Finder, two with the same name from different folders | Subject is the first file's name; three attachments |
| A Finder file over 50 MB | No compose window; alert "These files are larger than the 50 MB a message can carry." |
| A Finder file with the app quit | The app launches and the compose window opens with the file attached |
| Two shares one right after the other | Two compose windows, each with its own content |

After the last check: `ls "$HOME/Library/Group Containers/"*.com.mdbraber.fastmail-custom.share/Shares` is empty.

- [ ] **Step 8: Full test run and commit**

Run: `make test`
Expected: every suite passes.

```bash
git add Extensions/SharedMac Extensions/PersonalShareMac Extensions/WorkShareMac project.yml README.md
git commit -m "Share links, text and files from the Mac's share menu into a new message"
```

(If Step 6's fallback was applied, `AppShell.swift` is part of this commit too.)
