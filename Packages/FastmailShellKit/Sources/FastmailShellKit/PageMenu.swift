#if os(macOS)
import AppKit
import SwiftUI
import WebKit

/// One entry of a menu Fastmail's page describes, as its desktop module hands
/// it to Electron: a label, the action a click sends back, and optionally a
/// shortcut and a checkmark.
public struct PageMenuItem: Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case action
        /// Drawn with a checkmark while on; Electron's checkbox and radio
        case toggle(isOn: Bool)
        case separator
    }

    public let kind: Kind
    public let title: String
    public let action: String
    public let isEnabled: Bool
    public let shortcut: PageMenuShortcut?

    static let separator = PageMenuItem(kind: .separator, title: "", action: "", isEnabled: false, shortcut: nil)
}

public struct PageMenuShortcut: Equatable, Sendable {
    public let key: Character
    public let modifiers: EventModifiers

    /// Electron's accelerator, such as "CommandOrControl+N" or
    /// "Control+Meta+V"; nothing for a key a menu cannot show here.
    static func parse(_ accelerator: String?) -> PageMenuShortcut? {
        guard let accelerator, !accelerator.isEmpty else { return nil }
        var parts = accelerator.split(separator: "+").map { String($0) }
        guard let keyName = parts.popLast(), keyName.count == 1 else { return nil }
        var modifiers: EventModifiers = []
        for part in parts {
            switch part.lowercased() {
            case "commandorcontrol", "cmdorctrl", "command", "cmd", "meta", "super":
                modifiers.insert(.command)
            case "control", "ctrl":
                modifiers.insert(.control)
            case "alt", "option", "altgr":
                modifiers.insert(.option)
            case "shift":
                modifiers.insert(.shift)
            default:
                return nil
            }
        }
        return PageMenuShortcut(key: Character(keyName.lowercased()), modifiers: modifiers)
    }
}

/// The File and View entries of the menu the page last described.
public struct PageMenu: Equatable, Sendable {
    public var file: [PageMenuItem] = []
    public var view: [PageMenuItem] = []

    public init(file: [PageMenuItem] = [], view: [PageMenuItem] = []) {
        self.file = file
        self.view = view
    }

    /// The app's own File menu already writes messages (through its own
    /// choice of window or tab) and closes windows, and its View menu already
    /// has full screen; the page's copies of those are left out.
    static let ownActions: Set<String> = ["goCompose"]

    /// Printing sits where a Mac app keeps it, apart from the rest of File
    static let printActions: Set<String> = ["printToPDF", "print"]

    public var fileItems: [PageMenuItem] {
        Self.tidy(file.filter { !Self.printActions.contains($0.action) })
    }

    public var printItems: [PageMenuItem] {
        file.filter { Self.printActions.contains($0.action) }
    }

    public var viewItems: [PageMenuItem] {
        Self.tidy(view)
    }

    public static func parse(_ payload: [String: Any]) -> PageMenu {
        PageMenu(
            file: items(payload["file"]),
            view: items(payload["view"])
        )
    }

    static func items(_ value: Any?) -> [PageMenuItem] {
        (value as? [Any] ?? []).compactMap { entry in
            guard let entry = entry as? [String: Any] else { return nil }
            if entry["type"] as? String == "separator" { return .separator }
            // Roles are Electron's own items (close, full screen, developer
            // tools); the app has its own where they matter.
            guard
                entry["role"] == nil,
                let action = entry["action"] as? String, !action.isEmpty,
                !ownActions.contains(action),
                let label = entry["label"] as? String, !label.isEmpty
            else { return nil }
            let type = entry["type"] as? String
            let kind: PageMenuItem.Kind = (type == "checkbox" || type == "radio")
                ? .toggle(isOn: entry["checked"] as? Bool ?? false)
                : .action
            return PageMenuItem(
                kind: kind,
                title: titleCase(label),
                action: action,
                isEnabled: entry["enabled"] as? Bool ?? true,
                shortcut: PageMenuShortcut.parse(entry["accelerator"] as? String)
            )
        }
    }

    /// No separator at either end or next to another, which is what is left
    /// once the page's own copies are taken out.
    static func tidy(_ items: [PageMenuItem]) -> [PageMenuItem] {
        var tidied: [PageMenuItem] = []
        for item in items {
            if item.kind == .separator, tidied.last?.kind == .separator || tidied.isEmpty { continue }
            tidied.append(item)
        }
        if tidied.last?.kind == .separator { tidied.removeLast() }
        return tidied
    }

    /// Fastmail writes its labels in sentence case and Electron shows them as
    /// they come; a Mac menu capitalises every word, as Fastmail's own app
    /// ends up showing them.
    static func titleCase(_ label: String) -> String {
        label.split(separator: " ", omittingEmptySubsequences: false).map { word in
            guard let first = word.first else { return String(word) }
            return first.uppercased() + word.dropFirst()
        }.joined(separator: " ")
    }
}

/// The menus each page described, and the one for the window in front, which
/// is what the menu bar shows. A click goes back to that same page.
@MainActor
public final class PageMenus: ObservableObject {
    public static let shared = PageMenus()

    @Published public private(set) var current = PageMenu()

    private struct Entry {
        weak var view: WKWebView?
        var menu: PageMenu
    }

    private var entries: [ObjectIdentifier: Entry] = [:]
    private var observers: [NSObjectProtocol] = []

    private init() {
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didBecomeMainNotification] {
            observers.append(NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { _ in
                MainActor.assumeIsolated { PageMenus.shared.refresh() }
            })
        }
    }

    public func set(_ menu: PageMenu, for view: WKWebView) {
        entries = entries.filter { $0.value.view != nil }
        entries[ObjectIdentifier(view)] = Entry(view: view, menu: menu)
        refresh()
    }

    func refresh() {
        let menu = WebViewRegistry.shared.active.flatMap { entries[ObjectIdentifier($0)]?.menu } ?? PageMenu()
        if menu != current { current = menu }
    }

    public func activate(_ action: String) {
        WebViewRegistry.shared.active?.callAsyncJavaScript(
            "return !!(window.native && window.native.menuActivate && window.native.menuActivate(action));",
            arguments: ["action": action], in: nil, in: .page, completionHandler: nil
        )
    }
}

/// Printing a page's view, for Fastmail's own Print and Export As PDF; each
/// answers once the print sheet or save is done, which is when Fastmail puts
/// its page back.
@MainActor
public enum PagePrinter {
    public static func print(_ view: WKWebView) async {
        guard let window = view.window else { return }
        await run(view.printOperation(with: printInfo()), of: view, in: window)
    }

    public static func exportPDF(_ view: WKWebView, suggestedName: String?) async {
        guard let window = view.window else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = fileName(for: suggestedName)
        guard await panel.beginSheetModal(for: window) == .OK, let url = panel.url else { return }
        let info = printInfo()
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url
        let operation = view.printOperation(with: info)
        operation.showsPrintPanel = false
        await run(operation, of: view, in: window)
    }

    nonisolated static func fileName(for subject: String?) -> String {
        let cleaned = (subject ?? "")
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (cleaned.isEmpty ? "Message" : cleaned) + ".pdf"
    }

    private static func printInfo() -> NSPrintInfo {
        let info = NSPrintInfo.shared.copy() as? NSPrintInfo ?? NSPrintInfo()
        info.horizontalPagination = .fit
        info.isHorizontallyCentered = false
        return info
    }

    private static func run(_ operation: NSPrintOperation, of view: WKWebView, in window: NSWindow) async {
        operation.view?.frame = view.bounds
        await withCheckedContinuation { continuation in
            let waiter = PrintWaiter(continuation)
            operation.runModal(
                for: window,
                delegate: waiter,
                didRun: #selector(PrintWaiter.printOperationDidRun(_:success:contextInfo:)),
                contextInfo: nil
            )
        }
    }
}

private final class PrintWaiter: NSObject {
    private var continuation: CheckedContinuation<Void, Never>?
    private var keepAlive: PrintWaiter?

    init(_ continuation: CheckedContinuation<Void, Never>) {
        self.continuation = continuation
        super.init()
        keepAlive = self
    }

    @objc func printOperationDidRun(
        _ operation: NSPrintOperation,
        success: Bool,
        contextInfo: UnsafeMutableRawPointer?
    ) {
        continuation?.resume()
        continuation = nil
        keepAlive = nil
    }
}
#endif
