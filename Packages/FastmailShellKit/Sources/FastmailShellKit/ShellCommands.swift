#if os(macOS)
import AppKit
import ObjectiveC
import SwiftUI

/// Opening a window hands nothing back, so a new tab is made by opening one and
/// then folding it into the window it was asked for from.
///
/// The fold has to happen while the window is still off screen, and that is
/// earlier than anything of ours would otherwise hear about it: by the time the
/// page's view is put into the window AppKit has already ordered it in, and a
/// window told only then that it would rather be a tab stays a window of its
/// own — it stands there on its own for a moment and is folded in afterwards,
/// in full view. So the window is caught on its way in instead, at the one call
/// every window makes before the screen has it.
@MainActor
public enum ShellWindows {
    /// The window a tab was asked for from, held from the moment it is asked
    /// for until the window that answers is caught on its way in. It is not
    /// cleared on the next line: SwiftUI builds the window when it gets round
    /// to it, sometimes seconds later, and letting go of the host straight away
    /// left the window that finally arrived with nothing to join.
    private static weak var pendingHost: NSWindow?

    /// Whether the window on its way in is the one a tab was asked for, and if
    /// so what it should join. Only a window being shown for the first time
    /// counts, and only one AppKit would have grouped anyway: a message being
    /// written refuses tabs, and a window of another kind answers to another
    /// name.
    static func host(folding window: NSWindow, ordering place: NSWindow.OrderingMode) -> NSWindow? {
        guard
            place != .out,
            !window.isVisible,
            window.tabbingMode != .disallowed,
            let host = pendingHost,
            host !== window,
            host.tabbingIdentifier == window.tabbingIdentifier
        else { return nil }
        pendingHost = nil
        return host
    }

    /// AppKit offers nothing to listen to this early, so the call a window
    /// makes to be shown is where the fold goes. Swapped once, and idle
    /// whenever no tab has been asked for, which is nearly always.
    private static var catchesWindows = false

    private static func catchWindowsOnTheirWayIn() {
        guard !catchesWindows else { return }
        guard
            let shown = class_getInstanceMethod(NSWindow.self, #selector(NSWindow.order(_:relativeTo:))),
            let folded = class_getInstanceMethod(NSWindow.self, #selector(NSWindow.fmshellOrder(_:relativeTo:)))
        else { return }
        method_exchangeImplementations(shown, folded)
        catchesWindows = true
    }

    /// The window that appeared, if one did. A compose window opening at the
    /// same moment must not be taken for it, and those refuse to be tabs,
    /// which is the difference worth reading.
    public static func opened(before: [NSWindow], after: [NSWindow]) -> NSWindow? {
        let known = Set(before.map(ObjectIdentifier.init))
        return after.first {
            !known.contains(ObjectIdentifier($0)) && $0.tabbingMode != .disallowed
        }
    }

    /// Open one and make it a tab of the window in front.
    ///
    /// The host is left standing until a window takes it, and dropped after a
    /// while in case no window ever comes, so an unrelated one later cannot
    /// pick it up.
    public static func openAsTab(host: NSWindow?, open: () -> Void) {
        guard let host, host.tabbingMode != .disallowed else {
            open()
            return
        }
        catchWindowsOnTheirWayIn()
        let before = NSApplication.shared.windows
        pendingHost = host
        open()
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
            MainActor.assumeIsolated { pendingHost = nil }
        }
        join(host: host, before: before, tries: 60)
    }

    /// The safety net, for a window that somehow reached the screen without
    /// being caught: better a tab folded in late than a window left standing
    /// where a tab was asked for. It is waited for rather than assumed, since
    /// SwiftUI takes its time and the first window of a session can take
    /// seconds.
    private static func join(host: NSWindow, before: [NSWindow], tries: Int) {
        guard tries > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            MainActor.assumeIsolated {
                guard let fresh = opened(before: before, after: NSApplication.shared.windows) else {
                    join(host: host, before: before, tries: tries - 1)
                    return
                }
                // Normally it arrived as a tab already, having been folded in
                // on its way to the screen; there is nothing left to do then.
                guard fresh.tabGroup !== host.tabGroup || fresh.tabGroup == nil else { return }
                host.addTabbedWindow(fresh, ordered: .above)
                fresh.makeKeyAndOrderFront(nil)
            }
        }
    }
}

private extension NSWindow {
    /// Swapped with `order(_:relativeTo:)`, so a window asking to be shown
    /// arrives here first and the name below reaches what AppKit would have
    /// done. A window meant for a tab joins its group while it is still off
    /// screen, and is never seen standing on its own.
    @objc dynamic func fmshellOrder(_ place: NSWindow.OrderingMode, relativeTo otherWindow: Int) {
        if let host = ShellWindows.host(folding: self, ordering: place) {
            tabbingMode = .preferred
            host.addTabbedWindow(self, ordered: .above)
        }
        fmshellOrder(place, relativeTo: otherWindow)
    }
}

public struct ShellCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    /// What Fastmail's page puts in File and View, for the window in front
    @ObservedObject private var pageMenus = PageMenus.shared

    public init() {}

    public var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Message") {
                NotificationCenter.default.post(name: .fmshellCompose, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)
            Button("New Message in Tab") {
                NotificationCenter.default.post(name: .fmshellComposeInTab, object: nil)
            }
            .keyboardShortcut("n", modifiers: [.command, .option])
            Button("New Tab") {
                ShellWindows.openAsTab(host: NSApplication.shared.keyWindow) {
                    openWindow(id: "main")
                }
            }
            .keyboardShortcut("t", modifiers: .command)
            Button("New Window") {
                openWindow(id: "main")
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
            let items = pageMenus.current.fileItems
            if !items.isEmpty {
                Divider()
                PageMenuEntries(items: items)
            }
        }
        CommandGroup(replacing: .printItem) {
            PageMenuEntries(items: pageMenus.current.printItems)
        }
        CommandGroup(before: .toolbar) {
            let items = pageMenus.current.viewItems
            if !items.isEmpty {
                PageMenuEntries(items: items)
                Divider()
            }
        }
        CommandGroup(after: .toolbar) {
            Button("Reload Page") {
                NotificationCenter.default.post(name: .fmshellReload, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)
            // Safari's own key for it. There is no Develop menu here to put
            // it under, and the page cancels the right-click that would
            // otherwise offer Inspect Element, so without this the apps have
            // no console at all.
            Button("Show Web Inspector") {
                NotificationCenter.default.post(name: .fmshellInspect, object: nil)
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
        }
        CommandGroup(after: .importExport) {
            Button("Share Message…") {
                NotificationCenter.default.post(name: .fmshellShare, object: nil)
            }
        }
        // What the Shortcuts actions read and run, for the window in front
        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Copy URL") {
                NotificationCenter.default.post(name: .fmshellCopyURL, object: nil)
            }
            Button("Copy Title") {
                NotificationCenter.default.post(name: .fmshellCopyTitle, object: nil)
            }
            Button("Copy Markdown Link") {
                NotificationCenter.default.post(name: .fmshellCopyMarkdownLink, object: nil)
            }
        }
        CommandGroup(after: .textEditing) {
            Button("Search") {
                NotificationCenter.default.post(name: .fmshellSearch, object: nil)
            }
            .keyboardShortcut("f", modifiers: [.command, .option])
        }
    }
}

/// A page's menu entries, drawn as the Mac draws its own
struct PageMenuEntries: View {
    let items: [PageMenuItem]

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
            switch item.kind {
            case .separator:
                Divider()
            case .action:
                Button(item.title) { PageMenus.shared.activate(item.action) }
                    .disabled(!item.isEnabled)
                    .pageShortcut(item.shortcut)
            case .toggle(let isOn):
                Toggle(item.title, isOn: Binding(
                    get: { isOn },
                    set: { _ in PageMenus.shared.activate(item.action) }
                ))
                .disabled(!item.isEnabled)
                .pageShortcut(item.shortcut)
            }
        }
    }
}

private extension View {
    @ViewBuilder
    func pageShortcut(_ shortcut: PageMenuShortcut?) -> some View {
        if let shortcut {
            keyboardShortcut(KeyEquivalent(shortcut.key), modifiers: shortcut.modifiers)
        } else {
            self
        }
    }
}
#endif
