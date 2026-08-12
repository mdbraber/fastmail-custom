import Foundation
import WebKit

public struct BridgeReply: Equatable, Sendable {
    public let value: String?
    public let error: String?
}

@MainActor
public final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let onLog: (String) async -> Void
    private let onError: (String) async -> Void
    private let onTheme: (String) async -> Void

    public init(
        onLog: @escaping (String) async -> Void,
        onError: @escaping (String) async -> Void,
        onTheme: @escaping (String) async -> Void = { _ in }
    ) {
        self.onLog = onLog
        self.onError = onError
        self.onTheme = onTheme
    }

    @discardableResult
    public func handle(body: [String: Any]) async -> BridgeReply {
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
            await onTheme(color)
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
            let body = message.body as? [String: Any] ?? [:]
            let reply = await handle(body: body)
            replyHandler(reply.value, reply.error)
        }
    }
}
