import AppIntents
import Foundation
import WebKit

public struct FastmailShellIntents: AppIntentsPackage {}

public struct IntentSupportError: Error, CustomLocalizedStringResourceConvertible {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var localizedStringResource: LocalizedStringResource {
        "\(message)"
    }
}

@MainActor
public enum IntentSupport {
    public nonisolated static let actionNamesKey = "automation.actionNames"

    public static func webView() throws -> WKWebView {
        guard let view = WebViewRegistry.shared.active else {
            throw IntentSupportError("No Fastmail window is open.")
        }
        return view
    }

    private struct LinkStrings: Sendable {
        let url: String
        let title: String
        let markdown: String
    }

    static func evaluate<T: Sendable>(
        _ body: String,
        arguments: [String: Any],
        in view: WKWebView,
        transform: @escaping @Sendable (Any?) -> T
    ) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            view.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: transform(value))
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    public static func currentLink() async throws -> MailLink {
        let view = try webView()
        let strings: LinkStrings?
        do {
            strings = try await evaluate(
                "return await window.native.currentLink();",
                arguments: [:],
                in: view
            ) { value in
                guard
                    let dictionary = value as? [String: Any],
                    let url = dictionary["url"] as? String,
                    let title = dictionary["title"] as? String,
                    let markdown = dictionary["markdown"] as? String
                else {
                    return nil
                }
                return LinkStrings(url: url, title: title, markdown: markdown)
            }
        } catch {
            throw IntentSupportError("No message is open.")
        }
        guard let strings, let url = URL(string: strings.url) else {
            throw IntentSupportError("No message is open.")
        }
        let link = MailLink()
        link.url = url
        link.title = strings.title
        link.markdown = strings.markdown
        return link
    }

    public static func runJavaScript(_ script: String) async throws -> String {
        let view = try webView()
        do {
            return try await evaluate(script, arguments: [:], in: view) { Self.text(from: $0) }
        } catch let error as IntentSupportError {
            throw error
        } catch {
            throw IntentSupportError(error.localizedDescription)
        }
    }

    public static func runAction(named name: String) async throws {
        let view = try webView()
        do {
            _ = try await evaluate(
                "return await window.native.runAction(name);",
                arguments: ["name": name],
                in: view
            ) { _ in true }
        } catch let error as IntentSupportError {
            throw error
        } catch {
            throw IntentSupportError("Action “\(name)” failed or is not registered.")
        }
    }

    public static func open(path: String?) throws {
        guard let path, !path.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let trimmed = path.trimmingCharacters(in: .whitespaces)
        let target: URL?
        if trimmed.lowercased().hasPrefix("https://") {
            target = URL(string: trimmed)
        } else {
            target = URL(string: "https://app.fastmail.com" + (trimmed.hasPrefix("/") ? trimmed : "/" + trimmed))
        }
        guard let target, LinkRouter.isFastmailHost(target.host) else {
            throw IntentSupportError("Only app.fastmail.com paths can be opened.")
        }
        try webView().load(URLRequest(url: target))
    }

    nonisolated static func text(from value: Any?) -> String {
        switch value {
        case nil, is NSNull:
            return ""
        case let text as String:
            return text
        case let number as NSNumber:
            return number.stringValue
        default:
            if let value, JSONSerialization.isValidJSONObject(value),
               let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
               let text = String(data: data, encoding: .utf8) {
                return text
            }
            return value.map { String(describing: $0) } ?? ""
        }
    }
}
