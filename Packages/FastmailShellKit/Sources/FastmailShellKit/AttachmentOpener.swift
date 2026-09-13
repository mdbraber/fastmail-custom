import Foundation
import UniformTypeIdentifiers

#if canImport(UIKit)
import UIKit
import QuickLook
#else
import AppKit
import Quartz
#endif

public enum AttachmentOpener {
    public static let autoOpenDefaultsKey = "downloads.autoOpen"

    static let allowed: [UTType] = [
        .pdf, .plainText, .rtf,
        .png, .jpeg, .gif, .heic, .webP,
        UTType("com.apple.ical.ics") ?? .calendarEvent
    ]

    nonisolated static func sniffedType(of data: Data) -> UTType? {
        func starts(with bytes: [UInt8], at offset: Int = 0) -> Bool {
            guard data.count >= offset + bytes.count else { return false }
            return Array(data[offset..<(offset + bytes.count)]) == bytes
        }
        func ascii(_ text: String) -> [UInt8] { Array(text.utf8) }

        if starts(with: ascii("%PDF")) { return .pdf }
        if starts(with: [0x89, 0x50, 0x4E, 0x47]) { return .png }
        if starts(with: [0xFF, 0xD8, 0xFF]) { return .jpeg }
        if starts(with: ascii("GIF8")) { return .gif }
        if starts(with: ascii("RIFF")), starts(with: ascii("WEBP"), at: 8) { return .webP }
        if starts(with: ascii("ftypheic"), at: 4) || starts(with: ascii("ftypheix"), at: 4) ||
            starts(with: ascii("ftypmif1"), at: 4) { return .heic }
        if starts(with: ascii("{\\rtf")) { return .rtf }
        if starts(with: ascii("BEGIN:VCALENDAR")) {
            return UTType("com.apple.ical.ics") ?? .calendarEvent
        }
        if isPlausibleText(data) { return .plainText }
        return nil
    }

    nonisolated static func isPlausibleText(_ data: Data) -> Bool {
        guard !data.isEmpty else { return false }
        let sample = data.prefix(1024)
        let allowedControl: Set<UInt8> = [0x09, 0x0A, 0x0D]
        guard !sample.contains(where: { $0 < 0x20 && !allowedControl.contains($0) }) else {
            return false
        }
        return String(data: sample, encoding: .utf8) != nil
    }

    nonisolated static func shouldAutoOpen(data: Data, enabled: Bool) -> Bool {
        guard enabled, let type = sniffedType(of: data) else { return false }
        return allowed.contains { type.conforms(to: $0) }
    }

    @MainActor
    public static func handle(fileURL: URL, defaults: UserDefaults = .standard) {
        #if !canImport(UIKit)
        let enabled = defaults.bool(forKey: autoOpenDefaultsKey)
        if enabled,
            let handle = try? FileHandle(forReadingFrom: fileURL),
            let data = try? handle.read(upToCount: 1024),
            shouldAutoOpen(data: data, enabled: enabled) {
            try? handle.close()
            NSWorkspace.shared.open(fileURL)
            return
        }
        #endif
        PreviewPresenter.shared.preview(fileURL)
    }
}

@MainActor
final class PreviewPresenter: NSObject {
    static let shared = PreviewPresenter()

    private var current: URL?
    #if canImport(UIKit)
    private var controller: QLPreviewController?
    #endif

    func preview(_ url: URL) {
        current = url
        #if canImport(UIKit)
        let controller = QLPreviewController()
        controller.dataSource = self
        self.controller = controller
        // From the app's window, so a download finishing while the lock is
        // up shows beneath the cover rather than on top of it.
        AppWindow.topViewController()?.present(controller, animated: true)
        #else
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.dataSource = self
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
        #endif
    }
}

#if canImport(UIKit)
extension PreviewPresenter: @preconcurrency QLPreviewControllerDataSource {
    func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        current == nil ? 0 : 1
    }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (current ?? URL(fileURLWithPath: "/dev/null")) as NSURL
    }
}
#else
extension PreviewPresenter: @preconcurrency QLPreviewPanelDataSource {
    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        current == nil ? 0 : 1
    }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        (current ?? URL(fileURLWithPath: "/dev/null")) as NSURL
    }
}
#endif
