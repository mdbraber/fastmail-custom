import Foundation
import WebKit

/// Whether Safari's Web Inspector may attach to the app's web views. The Mac's
/// always may, as they always could; on iPhone and iPad the Enable remote
/// debugging switch decides, for the views already open and every one made
/// later.
public enum WebInspection {
    static let isMac: Bool = {
        #if os(macOS)
        true
        #else
        false
        #endif
    }()

    public static func isAllowed(isMac: Bool, remoteDebugging: Bool) -> Bool {
        isMac || remoteDebugging
    }

    public static func isAllowed(in defaults: UserDefaults = .standard) -> Bool {
        isAllowed(isMac: isMac, remoteDebugging: DevicePreferences.remoteDebugging(in: defaults))
    }

    @MainActor
    public static func apply(to views: [WKWebView], in defaults: UserDefaults = .standard) {
        let allowed = isAllowed(in: defaults)
        for view in views {
            view.isInspectable = allowed
        }
    }
}
