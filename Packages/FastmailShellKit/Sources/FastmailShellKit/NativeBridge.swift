import Foundation
import WebKit

public struct BridgeReply: Equatable, Sendable {
    public let value: String?
    public let error: String?
}

@MainActor
public final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let expectedHost: String
    private let onLog: (String) async -> Void
    private let onError: (String) async -> Void
    private let onTheme: (String, Bool?) async -> Void
    private let onDragRegions: (CGRect, [CGRect]) async -> Void
    private let onShare: @MainActor (ShareRequest) -> Void
    private let onBadge: @MainActor (Int) -> Void
    private let onActions: @MainActor ([String]) -> Void
    private let onOpenSettings: @MainActor () -> Void
    private let onNotify: @MainActor (MailNotification) -> Void
    private let onDismissNotifications: @MainActor ([String]) -> Void
    private let onShowWindow: @MainActor () -> Void

    public init(
        expectedHost: String,
        onLog: @escaping (String) async -> Void,
        onError: @escaping (String) async -> Void,
        onTheme: @escaping (String, Bool?) async -> Void = { _, _ in },
        onDragRegions: @escaping (CGRect, [CGRect]) async -> Void = { _, _ in },
        onShare: @escaping @MainActor (ShareRequest) -> Void = { $0.completion() },
        onBadge: @escaping @MainActor (Int) -> Void = { _ in },
        onActions: @escaping @MainActor ([String]) -> Void = { _ in },
        onOpenSettings: @escaping @MainActor () -> Void = {},
        onNotify: @escaping @MainActor (MailNotification) -> Void = { _ in },
        onDismissNotifications: @escaping @MainActor ([String]) -> Void = { _ in },
        onShowWindow: @escaping @MainActor () -> Void = {}
    ) {
        self.expectedHost = expectedHost
        self.onLog = onLog
        self.onError = onError
        self.onTheme = onTheme
        self.onDragRegions = onDragRegions
        self.onShare = onShare
        self.onBadge = onBadge
        self.onActions = onActions
        self.onOpenSettings = onOpenSettings
        self.onNotify = onNotify
        self.onDismissNotifications = onDismissNotifications
        self.onShowWindow = onShowWindow
    }

    static func rect(from values: [Double]) -> CGRect? {
        guard values.count == 4, values[2] > 0, values[3] > 0 else { return nil }
        return CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
    }

    nonisolated static func rect(fromDOMRect payload: [String: Any]?) -> CGRect? {
        guard let payload else { return nil }
        func number(_ keys: String...) -> Double? {
            for key in keys {
                if let value = payload[key] as? Double { return value }
                if let value = payload[key] as? Int { return Double(value) }
            }
            return nil
        }
        guard
            let x = number("x", "left"),
            let y = number("y", "top"),
            let width = number("width"),
            let height = number("height"),
            width > 0, height > 0
        else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }

    @discardableResult
    public func handle(body: [String: Any], from webView: WKWebView? = nil) async -> BridgeReply {
        guard let action = body["action"] as? String else {
            return BridgeReply(value: nil, error: "message has no action")
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        switch action {
        case "log":
            await onLog(payload["message"] as? String ?? "")
            return BridgeReply(value: nil, error: nil)
        case "error":
            await onError(payload["message"] as? String ?? "unknown error")
            return BridgeReply(value: nil, error: nil)
        case "theme":
            guard let color = payload["color"] as? String else {
                return BridgeReply(value: nil, error: "theme payload missing color")
            }
            // isDark is Fastmail's own answer. It is absent on pages that
            // have no theme to ask, and absent means unknown, not light.
            await onTheme(color, payload["isDark"] as? Bool)
            return BridgeReply(value: nil, error: nil)
        case "dragRegions":
            guard let values = payload["drag"] as? [Double], let drag = Self.rect(from: values) else {
                return BridgeReply(value: nil, error: "dragRegions payload has no usable drag rect")
            }
            let noDrag = (payload["noDrag"] as? [[Double]] ?? []).compactMap(Self.rect(from:))
            await onDragRegions(drag, noDrag)
            return BridgeReply(value: nil, error: nil)
        case "badge":
            let count = (payload["count"] as? Int) ??
                (payload["count"] as? Double).map(Int.init)
            guard let count else {
                return BridgeReply(value: nil, error: "badge payload missing count")
            }
            onBadge(count)
            return BridgeReply(value: nil, error: nil)
        case "actions":
            let names = (payload["names"] as? [Any] ?? []).compactMap { $0 as? String }
            onActions(names)
            return BridgeReply(value: nil, error: nil)
        case "openSettings":
            onOpenSettings()
            return BridgeReply(value: nil, error: nil)
        case "subject":
            if let webView {
                WebViewRegistry.shared.setSubject(payload["title"] as? String, for: webView)
            }
            return BridgeReply(value: nil, error: nil)
        case "share":
            let url = (payload["url"] as? String).flatMap(URL.init(string:))
            let text = payload["text"] as? String
            guard url != nil || text?.isEmpty == false else {
                return BridgeReply(value: nil, error: "share payload has neither url nor text")
            }
            let rect = Self.rect(fromDOMRect: payload["rect"] as? [String: Any])
            await withCheckedContinuation { continuation in
                onShare(ShareRequest(url: url, text: text, sourceRect: rect) {
                    continuation.resume()
                })
            }
            return BridgeReply(value: nil, error: nil)
        case "notify":
            guard let notification = MailNotification.parse(payload) else {
                return BridgeReply(value: nil, error: "notify payload needs an id and a title")
            }
            onNotify(notification)
            return BridgeReply(value: nil, error: nil)
        case "dismissNotifications":
            let ids = (payload["ids"] as? [Any] ?? []).compactMap { $0 as? String }
            onDismissNotifications(ids)
            return BridgeReply(value: nil, error: nil)
        case "showWindow":
            onShowWindow()
            return BridgeReply(value: nil, error: nil)
        default:
            return BridgeReply(value: nil, error: "unknown action: \(action)")
        }
    }

    public nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        Task { @MainActor in
            let frameInfo = message.frameInfo
            guard frameInfo.isMainFrame else {
                replyHandler(nil, "rejected: message did not originate from the main frame")
                return
            }
            guard !expectedHost.isEmpty else {
                replyHandler(nil, "rejected: no expected host is configured")
                return
            }
            guard Self.normalizedHost(frameInfo.securityOrigin.host) == Self.normalizedHost(expectedHost) else {
                replyHandler(nil, "rejected: message originated from an unexpected origin")
                return
            }
            let body = message.body as? [String: Any] ?? [:]
            let reply = await handle(body: body, from: message.webView)
            replyHandler(reply.value, reply.error)
        }
    }

    nonisolated static func normalizedHost(_ host: String) -> String {
        var host = host.lowercased()
        if host.hasSuffix(".") {
            host.removeLast()
        }
        return host
    }
}
