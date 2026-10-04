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

@Test func storingASymlinkStoresWhatItPointsTo() throws {
    let root = try temporaryRoot()
    let id = UUID().uuidString
    let realFile = try sourceFile(named: "real.txt", in: "a", contents: "content", under: root)
    let symlinkPath = root.appendingPathComponent("sources/b/link.txt")
    try FileManager.default.createDirectory(at: symlinkPath.deletingLastPathComponent(), withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: symlinkPath, withDestinationURL: realFile)
    let file = try SharedPayload.store(symlinkPath, index: 0, id: id, in: root)
    let payload = SharedPayload(subject: "", text: "", url: nil, files: [file])
    try payload.write(id: id, in: root)

    let taken = try #require(SharedPayload.take(id: id, in: root))
    #expect(taken.attachments.count == 1)
    #expect(taken.attachments[0].name == "link.txt")
    #expect(try Data(contentsOf: taken.attachments[0].url) == Data("content".utf8))
    let isSymlink = try taken.attachments[0].url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink ?? false
    #expect(!isSymlink)
}

@Test func takeDropsASymlinkThatLeavesTheFolder() throws {
    let root = try temporaryRoot()
    let id = UUID().uuidString
    try Data("secret".utf8).write(to: root.appendingPathComponent("outside.txt"))
    let payload = SharedPayload(
        subject: "", text: "", url: nil,
        files: [SharedPayload.File(path: "files/0-link.txt", name: "link.txt", type: "text/plain")]
    )
    try payload.write(id: id, in: root)
    let folder = root.appendingPathComponent(id)
    let filesFolder = folder.appendingPathComponent("files", isDirectory: true)
    try FileManager.default.createDirectory(at: filesFolder, withIntermediateDirectories: true)
    let linkPath = filesFolder.appendingPathComponent("0-link.txt")
    let outsidePath = root.appendingPathComponent("outside.txt")
    try FileManager.default.createSymbolicLink(at: linkPath, withDestinationURL: outsidePath)

    let taken = try #require(SharedPayload.take(id: id, in: root))
    #expect(taken.attachments.isEmpty)
}
