#if os(macOS)
import AppKit
import SwiftUI

/// Opening a window hands nothing back, so a new tab is made by opening one and
/// then folding it into the window it was asked for from.
@MainActor
public enum ShellWindows {
    /// The window that appeared, if one did. A compose window opening at the
    /// same moment must not be taken for it, and those refuse to be tabs, which
    /// is the difference worth reading.
    public static func opened(before: [NSWindow], after: [NSWindow]) -> NSWindow? {
        let known = Set(before.map(ObjectIdentifier.init))
        return after.first {
            !known.contains(ObjectIdentifier($0)) && $0.tabbingMode != .disallowed
        }
    }

    /// Open one and make it a tab of the window in front.
    ///
    /// Asking for a window does not produce one straight away, so the joining
    /// waits and looks again a few times rather than once. If the window in
    /// front is one that refuses tabs — a compose window — the new one is left
    /// standing on its own rather than forced somewhere it does not belong.
    public static func openAsTab(host: NSWindow?, open: () -> Void) {
        guard let host, host.tabbingMode != .disallowed else {
            open()
            return
        }
        let before = NSApplication.shared.windows
        open()
        join(host: host, before: before, tries: 8)
    }

    private static func join(host: NSWindow, before: [NSWindow], tries: Int) {
        guard tries > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            MainActor.assumeIsolated {
                guard let fresh = opened(before: before, after: NSApplication.shared.windows) else {
                    join(host: host, before: before, tries: tries - 1)
                    return
                }
                host.addTabbedWindow(fresh, ordered: .above)
                fresh.makeKeyAndOrderFront(nil)
            }
        }
    }
}

public struct ShellCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    public init() {}

    public var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Message") {
                NotificationCenter.default.post(name: .fmshellCompose, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)
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
        }
        CommandGroup(after: .toolbar) {
            Button("Reload Page") {
                NotificationCenter.default.post(name: .fmshellReload, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)
        }
        CommandGroup(after: .importExport) {
            Button("Share Message…") {
                NotificationCenter.default.post(name: .fmshellShare, object: nil)
            }
        }
    }
}
#endif
