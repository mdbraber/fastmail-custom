import SwiftUI
import FastmailShellKit

@main
struct PersonalApp: App {
    private let profile = Profile.personal(accountID: Profile.accountID(from: .main))
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PushRegistrar.self) private var pushRegistrar
    #endif
    #if os(macOS)
    @NSApplicationDelegateAdaptor(DockClick.self) private var dockClick
    #endif

    init() {
        // One for the whole app, before its first window: Fastmail Custom's
        // settings follow each Fastmail account to your other devices
        FastmailCustomSettingsSync.install()
    }

    var body: some Scene {
        WindowGroup(id: "main") {
            AppShell(profile: profile)
        }
        #if os(macOS)
        // Links from outside go to the app delegate, DockClick, which says
        // why; a window group that took them would open a window for each.
        .handlesExternalEvents(matching: [])
        .windowStyle(.hiddenTitleBar)
        .commands { ShellCommands() }
        #endif
        #if os(macOS)
        Settings {
            SettingsView(profile: profile)
        }
        #endif
    }
}
