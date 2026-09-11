#if os(macOS)
import AppKit
import SwiftUI

/// Opening a window hands nothing back, so a new tab is made by opening one and
/// then folding it into the window it was asked for from.
@MainActor
public enum ShellWindows {
    /// Set just before a window is asked for, and taken by the first window
    /// set up afterwards.
    private static var wantsTab = false

    static func takeTabPreference() -> Bool {
        defer { wantsTab = false }
        return wantsTab
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
    /// The preference is left standing until a window takes it: SwiftUI builds
    /// one when it gets round to it, sometimes seconds later, and clearing it
    /// on the next line meant the window that finally arrived was never told
    /// it was meant to be a tab. It is dropped after a while in case no window
    /// ever comes, so an unrelated one later cannot pick it up.
    public static func openAsTab(host: NSWindow?, open: () -> Void) {
        guard let host, host.tabbingMode != .disallowed else {
            open()
            return
        }
        let before = NSApplication.shared.windows
        wantsTab = true
        open()
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
            MainActor.assumeIsolated { _ = takeTabPreference() }
        }
        join(host: host, before: before, tries: 60)
    }

    /// The window is waited for rather than assumed: SwiftUI takes its time
    /// building one, and the first of a session can take seconds, which used
    /// to run the wait out and leave the tab standing as a window of its own.
    private static func join(host: NSWindow, before: [NSWindow], tries: Int) {
        guard tries > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            MainActor.assumeIsolated {
                guard let fresh = opened(before: before, after: NSApplication.shared.windows) else {
                    join(host: host, before: before, tries: tries - 1)
                    return
                }
                // Normally it arrived as a tab already, having been told it
                // preferred one before it was ordered in; there is nothing
                // left to do then.
                guard fresh.tabGroup !== host.tabGroup || fresh.tabGroup == nil else { return }
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
    }
}
#endif
