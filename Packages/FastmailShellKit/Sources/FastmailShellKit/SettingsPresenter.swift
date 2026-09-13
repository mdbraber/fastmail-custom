import SwiftUI

#if canImport(AppKit)
import AppKit
#endif

@MainActor
public final class SettingsPresenter: ObservableObject {
    public static let shared = SettingsPresenter()

    /// Whether the Device settings page is over the app, on iPhone and iPad.
    @Published public var isPresented = false

    /// The page's Device settings row. On iPhone and iPad it slides the Device
    /// settings page in from the right; on the Mac it opens the Settings window.
    public func open() {
        #if canImport(UIKit)
        withAnimation(.easeInOut(duration: 0.3)) { isPresented = true }
        #else
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        NSApp.activate(ignoringOtherApps: true)
        #endif
    }

    #if canImport(UIKit)
    /// The page's back arrow: it slides out the way it came.
    public func close() {
        withAnimation(.easeInOut(duration: 0.3)) { isPresented = false }
    }
    #endif
}
