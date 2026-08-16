import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private static let scheme = Bundle.main.object(forInfoDictionaryKey: "FMURLScheme") as? String ?? ""
    private static let appName = Bundle.main.object(forInfoDictionaryKey: "FMAppName") as? String ?? "Fastmail"
    private var handled = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !handled else { return }
        handled = true
        Task { await handleShare() }
    }

    private func handleShare() async {
        guard let context = extensionContext else { return }
        let providers = context.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] }
        guard let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
        }) else {
            reject("Nothing shareable arrived.")
            return
        }
        let item = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier)
        let url = item as? URL
            ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
            ?? (item as? String).flatMap(URL.init(string:))
        guard
            let url,
            url.scheme?.lowercased() == "https",
            url.host?.lowercased() == "app.fastmail.com"
        else {
            reject("Only app.fastmail.com links can open in \(Self.appName).")
            return
        }
        guard let command = URL(string: "\(Self.scheme)://open?url=\(Self.encode(url.absoluteString))") else {
            reject("That link could not be encoded.")
            return
        }
        let opened = await withCheckedContinuation { continuation in
            context.open(command) { continuation.resume(returning: $0) }
        }
        if opened {
            context.completeRequest(returningItems: nil)
        } else {
            reject("\(Self.appName) could not be opened.")
        }
    }

    private func reject(_ message: String) {
        let alert = UIAlertController(title: Self.appName, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
        })
        present(alert, animated: true)
    }

    private static func encode(_ text: String) -> String {
        let unreserved = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        return text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }
}
