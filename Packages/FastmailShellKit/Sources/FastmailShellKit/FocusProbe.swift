#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import Foundation
import os

/// Instrumentation for the focus problem: Cmd-Tab does not always bring the
/// app forward, and a click sometimes puts it behind instead.
///
/// The app used to keep windows nobody could see so that its mail page kept
/// running, which is what made activation strange: the system counted them as
/// windows in sight, and neither could become key. They are gone as of
/// 2026-10-05 (see `DockClick`), and this is here to show whether activation is
/// normal now — that a roll call of `vis=1 canKey=1` windows follows every
/// `didBecomeActive`, and that nothing orders a window out behind the app's
/// back. The compose pool still holds a spare ordered out of sight, which is
/// why `vis=0` lines are expected, and `orderOut` ones are not.
///
/// One line per event, then a roll call of every window, to two places. The
/// system log, for watching it live:
///
///     log stream --level debug --style compact \
///       --predicate 'subsystem == "com.mdbraber.fastmail-custom" AND category == "focus"'
///
/// And a file in the app's own container, for reading afterwards:
///
///     ~/Library/Containers/com.mdbraber.fastmail-custom.personal/Data/Library/Logs/focus-probe.log
///
/// On by default while this is being chased; `defaults write
/// com.mdbraber.fastmail-custom.personal FMFocusProbe -bool NO` turns it off.
@MainActor
public enum FocusProbe {
    private static let log = Logger(subsystem: "com.mdbraber.fastmail-custom", category: "focus")
    private static let defaultsKey = "FMFocusProbe"
    private static let started = Date()
    private static var installed = false
    private static var fileURL: URL?
    /// Held so the observers live as long as the app; AppKit does not retain
    /// a selector-based observer for us
    private static var watcher: FocusWatcher?

    private static var enabled: Bool {
        (UserDefaults.standard.object(forKey: defaultsKey) as? Bool) ?? true
    }

    /// Called from `DockClick`, which both Mac apps install as their app
    /// delegate, and the earliest place there is to hear activation from.
    /// Queued rather than assumed, because the delegate adaptor is made before
    /// the app has a main actor to speak of.
    nonisolated public static func installFromOutsideMainActor() {
        Task { @MainActor in install() }
    }

    public static func install() {
        guard enabled, !installed else { return }
        installed = true
        fileURL = prepareFile()
        let watcher = FocusWatcher()
        watcher.start()
        FocusProbe.watcher = watcher
        emit("install policy=\(NSApp.activationPolicy().rawValue) file=\(fileURL?.path ?? "none")")
    }

    /// A focusing decision the app itself made, from `DockClick`,
    /// `ComposeWindows` or `WindowFocus`
    static func note(_ what: String) {
        guard enabled else { return }
        emit(what)
    }

    static func emit(_ what: String, window: NSWindow? = nil) {
        guard enabled else { return }
        let line = "[\(Date().timeIntervalSince(started).rounded(toPlaces: 3))] \(what)"
        let rollCall = (window.map { [$0] } ?? NSApp.windows).map(describe)
        log.log("\(line)")
        for entry in rollCall { log.log("    \(entry)") }
        guard let fileURL else { return }
        var text = line + "\n"
        for entry in rollCall { text += "    \(entry)\n" }
        append(text, to: fileURL)
    }

    /// One window as the system sees it. `vis=1` next to `canKey=0` is the
    /// pair to look for: a window the app can show that the system cannot give
    /// the keyboard to, and `space=0` one the switcher leaves out of sight.
    private static func describe(_ window: NSWindow) -> String {
        let group = window.tabGroup
        let title = window.title.isEmpty ? "-" : window.title
        let frame = window.frame
        return """
        #\(abs(ObjectIdentifier(window).hashValue % 10_000)) \(type(of: window)) "\(title)" \
        vis=\(window.isVisible ? 1 : 0) mini=\(window.isMiniaturized ? 1 : 0) \
        key=\(window.isKeyWindow ? 1 : 0) main=\(window.isMainWindow ? 1 : 0) \
        canKey=\(window.canBecomeKey ? 1 : 0) canMain=\(window.canBecomeMain ? 1 : 0) \
        space=\(window.isOnActiveSpace ? 1 : 0) occl=\(window.occlusionState.contains(.visible) ? 1 : 0) \
        level=\(window.level.rawValue) alpha=\(String(format: "%.2f", window.alphaValue)) \
        size=\(Int(frame.width))x\(Int(frame.height))+\(Int(frame.minX))+\(Int(frame.minY)) \
        behavior=\(window.collectionBehavior.rawValue) \
        tabs=\(group.map { "\($0.windows.count) sel=\($0.selectedWindow === window)" } ?? "-")
        """
    }

    static func frontApp() -> String {
        let app = NSWorkspace.shared.frontmostApplication
        return "\(app?.localizedName ?? "?") (\(app?.bundleIdentifier ?? "?"))"
    }

    // MARK: - The file

    private static func prepareFile() -> URL? {
        guard
            let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
        else { return nil }
        let directory = library.appendingPathComponent("Logs", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Not sandboxed, so this is ~/Library/Logs proper: name the file for
        // the app, or the two shells write over each other
        let name = Bundle.main.bundleIdentifier ?? "fastmail-custom"
        let url = directory.appendingPathComponent("focus-probe-\(name).log")
        // A few days of chasing is plenty; keep it small enough to read
        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 400_000 {
            try? FileManager.default.removeItem(at: url)
        }
        return url
    }

    private static func append(_ text: String, to url: URL) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        guard let data = "\(stamp) \(text)".data(using: .utf8) else { return }
        guard let handle = try? FileHandle(forWritingTo: url) else {
            try? data.write(to: url)
            return
        }
        defer { try? handle.close() }
        handle.seekToEndOfFile()
        handle.write(data)
    }
}

/// The notifications themselves. A selector-based observer on the main actor,
/// so the windows it reads may be read without a Sendable dance around them.
@MainActor
private final class FocusWatcher: NSObject {
    /// Last occlusion state per window, so a window that keeps saying the same
    /// thing does not fill the log
    private var occluded: [ObjectIdentifier: Bool] = [:]

    func start() {
        let center = NotificationCenter.default
        for name in [
            NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
            NSApplication.didHideNotification, NSApplication.didUnhideNotification,
        ] {
            center.addObserver(self, selector: #selector(appEvent(_:)), name: name, object: nil)
        }
        for name in [
            NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
            NSWindow.didBecomeMainNotification, NSWindow.didResignMainNotification,
            NSWindow.didMiniaturizeNotification, NSWindow.didDeminiaturizeNotification,
            NSWindow.willCloseNotification,
        ] {
            center.addObserver(self, selector: #selector(windowEvent(_:)), name: name, object: nil)
        }
        // Occlusion is what WebKit makes its hiding decisions from, and the
        // company window exists to lie about it
        center.addObserver(
            self, selector: #selector(occlusionEvent(_:)),
            name: NSWindow.didChangeOcclusionStateNotification, object: nil
        )
        // Which app took the front when ours let go: the two shells look alike
        // in the switcher, and one of them may be what lands instead
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(workspaceEvent(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    @objc private func appEvent(_ note: Notification) {
        let what = switch note.name {
        case NSApplication.didBecomeActiveNotification: "app didBecomeActive"
        case NSApplication.didResignActiveNotification: "app didResignActive"
        case NSApplication.didHideNotification: "app didHide"
        default: "app didUnhide"
        }
        FocusProbe.emit("\(what) frontNow=\(FocusProbe.frontApp())")
    }

    @objc private func windowEvent(_ note: Notification) {
        let what = switch note.name {
        case NSWindow.didBecomeKeyNotification: "becameKey"
        case NSWindow.didResignKeyNotification: "resignedKey"
        case NSWindow.didBecomeMainNotification: "becameMain"
        case NSWindow.didResignMainNotification: "resignedMain"
        case NSWindow.didMiniaturizeNotification: "miniaturized"
        case NSWindow.didDeminiaturizeNotification: "deminiaturized"
        default: "willClose"
        }
        guard let window = note.object as? NSWindow else {
            FocusProbe.emit("window \(what)")
            return
        }
        FocusProbe.emit("window \(what) \(type(of: window))", window: window)
    }

    @objc private func occlusionEvent(_ note: Notification) {
        guard let window = note.object as? NSWindow else { return }
        let now = window.occlusionState.contains(.visible)
        let id = ObjectIdentifier(window)
        if occluded[id] == now { return }
        occluded[id] = now
        // Only the mail windows matter here, so a roll call would be noise
        FocusProbe.emit("occlusion \(now ? "visible" : "hidden") \(type(of: window))", window: window)
    }

    @objc private func workspaceEvent(_ note: Notification) {
        let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        FocusProbe.emit(
            "workspace front=\(app?.localizedName ?? "?") (\(app?.bundleIdentifier ?? "?"))"
        )
    }
}

private extension TimeInterval {
    func rounded(toPlaces places: Int) -> TimeInterval {
        let factor = pow(10.0, Double(places))
        return (self * factor).rounded() / factor
    }
}
#endif
