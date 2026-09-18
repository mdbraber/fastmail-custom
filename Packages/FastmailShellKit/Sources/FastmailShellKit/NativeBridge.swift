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
    /// A Fastmail Custom setting the page has changed. The key is bare; the
    /// caller adds the namespace.
    private let onSetting: @MainActor (String, Any) -> Void
    private let onNotify: @MainActor (MailNotification) -> Void
    private let onDismissNotifications: @MainActor ([String]) -> Void
    private let onShowWindow: @MainActor () -> Void
    /// The message the page is showing, or nothing when it is showing a list.
    private let onSubject: @MainActor (String?) -> Void
    /// Asked where to put a message, and answers where it put it; so a page
    /// told "inline" knows to go ahead and open one itself.
    private let onCompose: @MainActor (String) -> String
    /// Asked where to put a draft the page is about to open, by its id, and
    /// answers where it put it; `fastmail` leaves the draft to the page.
    private let onEditDraft: @MainActor (String) -> String
    /// What the Notifications page draws from; nothing where there is no such
    /// page, which is the Mac.
    private let onNotificationState: @MainActor () async -> NotificationState?
    /// Keeps a choice the page made and registers it; answers the choice as
    /// saved, or nothing where there is no such page.
    private let onSetNotifications: @MainActor (NotificationChoice) -> NotificationChoice?
    private let onOpenNotificationSettings: @MainActor () -> Void
    /// The Fastmail account the page is on, already checked, for settings sync.
    private let onAccount: @MainActor (String) -> Void
    /// The settings page's "Sync settings with iCloud" switch.
    private let onSettingsSync: @MainActor (Bool) -> Void
    /// The Mac's stand-in for window.Notification.permission, since a
    /// WKWebView's own copy of that API cannot be granted.
    private let onNotificationPermission: @MainActor () async -> String
    /// The Mac's stand-in for window.Notification.requestPermission().
    private let onRequestNotificationPermission: @MainActor () async -> String
    /// The File and View menus the page describes, as Fastmail's desktop
    /// module hands them to Electron, from the page that sent them.
    private let onMenu: @MainActor ([String: Any], WKWebView?) -> Void
    /// Print the page, or save it as a PDF; answered once that is done.
    private let onPrint: @MainActor (WKWebView?) async -> Void
    private let onPrintToPDF: @MainActor (WKWebView?) async -> Void
    /// Brings forward the window whose page is named this, as Electron does
    /// for Fastmail's desktop app; answers whether there was one.
    private let onFocusWindow: @MainActor (String) async -> Bool
    /// The page closing its own window, which WebKit leaves undone.
    private let onCloseWindow: @MainActor (WKWebView?) -> Void

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
        onSetting: @escaping @MainActor (String, Any) -> Void = { _, _ in },
        onNotify: @escaping @MainActor (MailNotification) -> Void = { _ in },
        onDismissNotifications: @escaping @MainActor ([String]) -> Void = { _ in },
        onShowWindow: @escaping @MainActor () -> Void = {},
        onSubject: @escaping @MainActor (String?) -> Void = { _ in },
        onCompose: @escaping @MainActor (String) -> String = { _ in ComposeMode.inline.rawValue },
        // Nothing that has not been wired up takes a draft off Fastmail's hands
        onEditDraft: @escaping @MainActor (String) -> String = { _ in ComposeMode.leaveItToFastmail },
        onNotificationState: @escaping @MainActor () async -> NotificationState? = { nil },
        onSetNotifications: @escaping @MainActor (NotificationChoice) -> NotificationChoice? = { _ in nil },
        onOpenNotificationSettings: @escaping @MainActor () -> Void = {},
        onAccount: @escaping @MainActor (String) -> Void = { _ in },
        onSettingsSync: @escaping @MainActor (Bool) -> Void = { _ in },
        onNotificationPermission: @escaping @MainActor () async -> String = { "denied" },
        onRequestNotificationPermission: @escaping @MainActor () async -> String = { "denied" },
        onMenu: @escaping @MainActor ([String: Any], WKWebView?) -> Void = { _, _ in },
        onPrint: @escaping @MainActor (WKWebView?) async -> Void = { _ in },
        onPrintToPDF: @escaping @MainActor (WKWebView?) async -> Void = { _ in },
        onFocusWindow: @escaping @MainActor (String) async -> Bool = { _ in false },
        onCloseWindow: @escaping @MainActor (WKWebView?) -> Void = { _ in }
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
        self.onSetting = onSetting
        self.onNotify = onNotify
        self.onDismissNotifications = onDismissNotifications
        self.onShowWindow = onShowWindow
        self.onSubject = onSubject
        self.onCompose = onCompose
        self.onEditDraft = onEditDraft
        self.onNotificationState = onNotificationState
        self.onSetNotifications = onSetNotifications
        self.onOpenNotificationSettings = onOpenNotificationSettings
        self.onAccount = onAccount
        self.onSettingsSync = onSettingsSync
        self.onNotificationPermission = onNotificationPermission
        self.onRequestNotificationPermission = onRequestNotificationPermission
        self.onMenu = onMenu
        self.onPrint = onPrint
        self.onPrintToPDF = onPrintToPDF
        self.onFocusWindow = onFocusWindow
        self.onCloseWindow = onCloseWindow
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
        case "setting":
            guard
                let key = payload["key"] as? String,
                FastmailCustomSettings.isWritableSettingKey(key)
            else {
                return BridgeReply(value: nil, error: "setting payload has no usable key")
            }
            // A JavaScript true and a JavaScript 1 both arrive as NSNumber,
            // and `as? Bool` accepts either; a count stored where a flag
            // belongs would then read back as true forever. Ask CoreFoundation
            // which one it really is.
            let value: Any
            if let number = payload["value"] as? NSNumber,
               CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() {
                value = number.boolValue
            } else if let text = payload["value"] as? String {
                value = text
            } else {
                return BridgeReply(value: nil, error: "setting value must be a boolean or a string")
            }
            onSetting(key, value)
            return BridgeReply(value: nil, error: nil)
        case "subject":
            let subject = payload["title"] as? String
            if let webView {
                WebViewRegistry.shared.setSubject(subject, for: webView)
            }
            onSubject(subject)
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
        case "compose":
            guard let mode = payload["mode"] as? String, !mode.isEmpty else {
                return BridgeReply(value: nil, error: "compose has no mode")
            }
            return BridgeReply(value: onCompose(mode), error: nil)
        case "editDraft":
            guard let id = payload["id"] as? String, !id.isEmpty else {
                return BridgeReply(value: nil, error: "editDraft has no id")
            }
            return BridgeReply(value: onEditDraft(id), error: nil)
        case "showWindow":
            onShowWindow()
            return BridgeReply(value: nil, error: nil)
        case "notificationState":
            guard let state = await onNotificationState() else {
                return BridgeReply(value: nil, error: "notification settings are not available here")
            }
            // Text rather than an object: a reply's value is a string, and
            // the harness parses it
            return BridgeReply(value: state.json, error: nil)
        case "setNotifications":
            switch NotificationChoice.parse(payload) {
            case .failure(let invalid):
                return BridgeReply(value: nil, error: "setNotifications: \(invalid.message)")
            case .success(let choice):
                guard let saved = onSetNotifications(choice) else {
                    return BridgeReply(value: nil, error: "notification settings are not available here")
                }
                return BridgeReply(value: saved.json, error: nil)
            }
        case "openNotificationSettings":
            onOpenNotificationSettings()
            return BridgeReply(value: nil, error: nil)
        case "account":
            // The id becomes part of every store key, so it is checked here
            guard
                let accountId = payload["accountId"] as? String,
                SettingsSyncRules.isValidAccountId(accountId)
            else {
                return BridgeReply(value: nil, error: "account payload has no usable accountId")
            }
            onAccount(accountId)
            return BridgeReply(value: nil, error: nil)
        case "settingsSync":
            // A real boolean only, for the reason the setting action gives
            guard
                let number = payload["enabled"] as? NSNumber,
                CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID()
            else {
                return BridgeReply(value: nil, error: "settingsSync enabled must be a boolean")
            }
            onSettingsSync(number.boolValue)
            return BridgeReply(value: nil, error: nil)
        case "notificationPermission":
            return BridgeReply(value: await onNotificationPermission(), error: nil)
        case "requestNotificationPermission":
            return BridgeReply(value: await onRequestNotificationPermission(), error: nil)
        case "setMenu":
            guard let menu = payload["menu"] as? [String: Any] else {
                return BridgeReply(value: nil, error: "setMenu payload has no menu")
            }
            onMenu(menu, webView)
            return BridgeReply(value: nil, error: nil)
        case "print":
            await onPrint(webView)
            return BridgeReply(value: nil, error: nil)
        case "printToPDF":
            await onPrintToPDF(webView)
            return BridgeReply(value: nil, error: nil)
        case "focusWindow":
            guard let name = payload["name"] as? String, !name.isEmpty else {
                return BridgeReply(value: nil, error: "focusWindow has no name")
            }
            let found = await onFocusWindow(name)
            return BridgeReply(value: found ? "true" : "false", error: nil)
        case "closeWindow":
            onCloseWindow(webView)
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
