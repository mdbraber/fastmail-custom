import Foundation
import WebKit
#if canImport(AppKit)
import AppKit
#endif

@MainActor
public final class DownloadManager: NSObject, ObservableObject {
    public struct Item: Identifiable, Equatable, Sendable {
        public enum State: Equatable, Sendable {
            case active
            case finished
            case failed
            case cancelled
        }

        public let id: UUID
        public var filename: String
        public var state: State
        public var fractionComplete: Double
        public var totalIsKnown: Bool
        public var byteText: String
        public var fileURL: URL?
    }

    public static let shared = DownloadManager()

    @Published public private(set) var items: [Item] = []
    public var revealThreshold: TimeInterval = 0.5
    public var defaults: UserDefaults = .standard
    var onFinished: (@MainActor (Item) -> Void)?
    var onIssue: (@MainActor (String) -> Void)?

    private var downloads: [UUID: WKDownload] = [:]
    private var identifiers: [ObjectIdentifier: UUID] = [:]
    private var observations: [UUID: NSKeyValueObservation] = [:]
    private var pendingReveal: [UUID: Item] = [:]

    public static let folderDefaultsKey = "downloads.folder"
    public static let askEachTimeDefaultsKey = "downloads.askEachTime"

    nonisolated static func uniqueFilename(_ filename: String, taken: (String) -> Bool) -> String {
        guard taken(filename) else { return filename }
        let stem = (filename as NSString).deletingPathExtension
        let ext = (filename as NSString).pathExtension
        var counter = 2
        while true {
            let candidate = ext.isEmpty ? "\(stem) (\(counter))" : "\(stem) (\(counter)).\(ext)"
            if !taken(candidate) { return candidate }
            counter += 1
        }
    }

    nonisolated static func destinationDirectory(chosenPath: String?, fileManager: FileManager = .default) -> URL {
        #if canImport(UIKit)
        return fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        #else
        if let chosenPath, !chosenPath.isEmpty {
            var isDirectory: ObjCBool = false
            if fileManager.fileExists(atPath: chosenPath, isDirectory: &isDirectory), isDirectory.boolValue {
                return URL(fileURLWithPath: chosenPath)
            }
        }
        return fileManager.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        #endif
    }

    public func adopt(_ download: WKDownload) {
        download.delegate = self
        let id = UUID()
        identifiers[ObjectIdentifier(download)] = id
        downloads[id] = download
    }

    public func cancel(_ id: UUID) {
        downloads[id]?.cancel { _ in }
        let url = (pendingReveal[id] ?? items.first { $0.id == id })?.fileURL
        if let url {
            try? FileManager.default.removeItem(at: url)
        }
        if pendingReveal.removeValue(forKey: id) != nil {
            cleanup(id)
            return
        }
        change(id) { $0.state = .cancelled }
        cleanup(id)
    }

    public func clearInactive() {
        items.removeAll { $0.state != .active }
    }

    func begin(id: UUID, filename: String, fileURL: URL?) {
        pendingReveal[id] = Item(
            id: id, filename: filename, state: .active,
            fractionComplete: 0, totalIsKnown: false, byteText: "", fileURL: fileURL
        )
        let delay = revealThreshold
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            self?.reveal(id)
        }
    }

    func finish(id: UUID) {
        if var item = pendingReveal.removeValue(forKey: id) {
            item.state = .finished
            onFinished?(item)
            cleanup(id)
            return
        }
        change(id) { $0.state = .finished }
        if let item = items.first(where: { $0.id == id }) {
            onFinished?(item)
        }
        cleanup(id)
    }

    func fail(id: UUID, message: String?) {
        let url = (pendingReveal[id] ?? items.first { $0.id == id })?.fileURL
        if let url {
            try? FileManager.default.removeItem(at: url)
        }
        if let message {
            onIssue?(message)
        }
        if pendingReveal.removeValue(forKey: id) != nil {
            cleanup(id)
            return
        }
        change(id) { item in
            if item.state == .active { item.state = .failed }
        }
        cleanup(id)
    }

    private func reveal(_ id: UUID) {
        guard let item = pendingReveal.removeValue(forKey: id) else { return }
        items.append(item)
    }

    private func change(_ id: UUID, _ mutate: (inout Item) -> Void) {
        if var item = pendingReveal[id] {
            mutate(&item)
            pendingReveal[id] = item
            return
        }
        if let index = items.firstIndex(where: { $0.id == id }) {
            mutate(&items[index])
        }
    }

    private func cleanup(_ id: UUID) {
        observations[id]?.invalidate()
        observations[id] = nil
        if let download = downloads.removeValue(forKey: id) {
            identifiers[ObjectIdentifier(download)] = nil
        }
    }

    private func identifier(for download: WKDownload) -> UUID {
        if let id = identifiers[ObjectIdentifier(download)] { return id }
        let id = UUID()
        identifiers[ObjectIdentifier(download)] = id
        downloads[id] = download
        return id
    }

    private func observeProgress(_ download: WKDownload, id: UUID) {
        observations[id] = download.progress.observe(
            \.fractionCompleted, options: [.initial, .new]
        ) { [weak self] progress, _ in
            let fraction = progress.fractionCompleted
            let known = progress.totalUnitCount > 0
            let text = progress.localizedAdditionalDescription ?? ""
            Task { @MainActor [weak self] in
                self?.change(id) { item in
                    item.fractionComplete = fraction
                    item.totalIsKnown = known
                    item.byteText = text
                }
            }
        }
    }
}

extension DownloadManager: WKDownloadDelegate {
    public func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping @MainActor @Sendable (URL?) -> Void
    ) {
        let id = identifier(for: download)
        #if canImport(AppKit)
        if defaults.bool(forKey: Self.askEachTimeDefaultsKey) {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = suggestedFilename
            panel.canCreateDirectories = true
            panel.begin { [weak self] result in
                guard let self, result == .OK, let destination = panel.url else {
                    completionHandler(nil)
                    return
                }
                self.begin(id: id, filename: destination.lastPathComponent, fileURL: destination)
                self.observeProgress(download, id: id)
                completionHandler(destination)
            }
            return
        }
        #endif
        let directory = Self.destinationDirectory(
            chosenPath: defaults.string(forKey: Self.folderDefaultsKey)
        )
        let filename = Self.uniqueFilename(suggestedFilename) { candidate in
            FileManager.default.fileExists(
                atPath: directory.appendingPathComponent(candidate).path
            )
        }
        let destination = directory.appendingPathComponent(filename)
        begin(id: id, filename: filename, fileURL: destination)
        observeProgress(download, id: id)
        completionHandler(destination)
    }

    public func downloadDidFinish(_ download: WKDownload) {
        finish(id: identifier(for: download))
    }

    public func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let cancelled = (error as NSError).code == NSURLErrorCancelled
        fail(
            id: identifier(for: download),
            message: cancelled ? nil : "Download failed: \(error.localizedDescription)"
        )
    }
}
