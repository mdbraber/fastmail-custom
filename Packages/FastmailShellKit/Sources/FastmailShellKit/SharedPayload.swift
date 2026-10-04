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
    /// files with one name apart. If the source is a symlink, the real file is
    /// copied instead so nothing outside the share can be read through it.
    public static func store(_ source: URL, index: Int, id: String, in root: URL) throws -> File {
        let file = try slot(named: source.lastPathComponent, index: index, id: id, in: root)
        try FileManager.default.copyItem(at: source.resolvingSymlinksInPath(), to: file.url)
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
    /// out of the share's folder, or which is a symbolic link, is left out.
    public static func take(id: String, in root: URL) -> Taken? {
        guard
            let folder = folder(id: id, in: root),
            let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
            let payload = try? JSONDecoder().decode(SharedPayload.self, from: data)
        else {
            return nil
        }
        let baseResolved = folder.resolvingSymlinksInPath().path + "/"
        let attachments = payload.files.compactMap { file -> Attachment? in
            let url = folder.appendingPathComponent(file.path)
            let isSymlink = (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) ?? false
            guard !isSymlink else { return nil }
            let resolvedURL = url.resolvingSymlinksInPath()
            guard resolvedURL.path.hasPrefix(baseResolved), FileManager.default.fileExists(atPath: resolvedURL.path) else { return nil }
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
