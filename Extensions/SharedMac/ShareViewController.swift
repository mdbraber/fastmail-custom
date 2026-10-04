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
    /// is how an image comes from an app that has not saved it. The size is
    /// settled when the item is gathered, so one that cannot be read is
    /// refused there instead of counting as nothing.
    private enum Item {
        case file(URL, size: Int)
        case data(Data, name: String)

        var size: Int {
            switch self {
            case .file(_, let size): return size
            case .data(let data, _): return data.count
            }
        }

        var name: String {
            switch self {
            case .file(let url, _): return url.lastPathComponent
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
        let title = inputs.compactMap { $0.attributedTitle?.string }.first { !$0.isEmpty }
        var texts = inputs.compactMap { $0.attributedContentText?.string }
        var link: URL?
        var items: [Item] = []
        var total = 0

        // An extension has little memory to spare, so what is too many or too
        // large is refused before it is read, not after.
        let providers = inputs.flatMap { $0.attachments ?? [] }
        let carried = providers.filter {
            $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
                || $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
        }
        guard carried.count <= SharedPayload.itemLimit else {
            throw Refusal(message: "No more than \(SharedPayload.itemLimit) files can be shared at once.")
        }
        let tooLarge = Refusal(message: "These files are larger than the 50 MB a message can carry.")

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier),
               let url = await Self.url(from: provider, type: .fileURL), url.isFileURL {
                let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
                if values?.isDirectory == true {
                    throw Refusal(message: "Folders can't be shared; share the files inside instead.")
                }
                guard let size = values?.fileSize else {
                    throw Refusal(message: "\(url.lastPathComponent) could not be read.")
                }
                total += size
                guard total <= SharedPayload.sizeLimit else { throw tooLarge }
                items.append(.file(url, size: size))
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                      let url = await Self.url(from: provider, type: .url), !url.isFileURL {
                if link == nil { link = url }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                      let data = await Self.data(from: provider, type: .image) {
                total += data.count
                guard total <= SharedPayload.sizeLimit else { throw tooLarge }
                items.append(.data(data, name: Self.imageName(for: provider, index: items.count)))
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                      let text = await Self.text(from: provider) {
                texts.append(text)
            }
        }

        let message = SharedPayload.message(
            title: title, texts: texts, link: link?.absoluteString, fileNames: items.map(\.name)
        )
        guard link != nil || !message.text.isEmpty || !message.subject.isEmpty || !items.isEmpty else {
            throw Refusal(message: "Nothing shareable arrived.")
        }

        let id = UUID().uuidString
        do {
            var files: [SharedPayload.File] = []
            for (index, item) in items.enumerated() {
                switch item {
                case .file(let url, _):
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    files.append(try SharedPayload.store(url, index: index, id: id, in: root))
                case .data(let data, let name):
                    files.append(try SharedPayload.store(data, named: name, index: index, id: id, in: root))
                }
            }
            let payload = SharedPayload(
                subject: message.subject,
                text: message.text,
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
