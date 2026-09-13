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

    /// The page an action reads from or runs against.
    public static func webView() throws -> WKWebView {
        guard let view = WebViewRegistry.shared.active else {
            throw IntentSupportError("No Fastmail window is open. Open the app once, then run this again.")
        }
        return view
    }

    /// The page for an action that reads from it or runs against it. On
    /// iPhone and iPad nothing is read or run while the screen lock is up, or
    /// would be the moment the app is in front again, so a Shortcut cannot
    /// return the mail behind the lock.
    private static func unlockedWebView() throws -> WKWebView {
        #if canImport(UIKit)
        if ScreenLock.shared.holdsLinks {
            throw IntentSupportError("Open and unlock the app first.")
        }
        #endif
        return try webView()
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
        let view = try unlockedWebView()
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
        // The page's own address names whichever server this shell talks to,
        // and both shells talk to beta.
        let canonical = Backend.canonical(url)
        let link = MailLink()
        link.url = canonical
        link.title = strings.title
        link.markdown = MailLink.markdown(title: strings.title, url: canonical)
        return link
    }

    public static func runJavaScript(_ script: String) async throws -> String {
        let view = try unlockedWebView()
        do {
            return try await evaluate(script, arguments: [:], in: view) { Self.text(from: $0) }
        } catch let error as IntentSupportError {
            throw error
        } catch {
            throw IntentSupportError(error.localizedDescription)
        }
    }

    public static func runAction(named name: String) async throws {
        let view = try unlockedWebView()
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
            let host = Backend.current().host
            target = URL(string: "https://" + host + (trimmed.hasPrefix("/") ? trimmed : "/" + trimmed))
        }
        guard let target, LinkRouter.isFastmailHost(target.host) else {
            throw IntentSupportError("Only Fastmail paths can be opened.")
        }
        #if canImport(UIKit)
        // Handed to the shell as a home screen shortcut hands its page, so
        // AppShell routes it like any link from outside, and while the screen
        // lock is up it waits until the lock has opened.
        PendingLinks.shared.open(target)
        #else
        try webView().load(URLRequest(url: target))
        #endif
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
