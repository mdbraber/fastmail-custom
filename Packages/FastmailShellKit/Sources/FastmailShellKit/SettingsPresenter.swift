import SwiftUI

#if canImport(AppKit)
import AppKit
#endif

@MainActor
public final class SettingsPresenter: ObservableObject {
    public static let shared = SettingsPresenter()

    @Published public var isPresented = false

    public func open() {
        #if canImport(UIKit)
        isPresented = true
        #else
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        NSApp.activate(ignoringOtherApps: true)
        #endif
    }
}
