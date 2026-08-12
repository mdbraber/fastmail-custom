import SwiftUI
import FastmailShellKit

@main
struct WorkApp: App {
    private let profile = Profile.work(accountID: Profile.accountID(from: .main))

    var body: some Scene {
        WindowGroup {
            AppShell(profile: profile)
        }
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        #endif
        #if os(macOS)
        Settings {
            SettingsView(profile: profile)
        }
        #endif
    }
}
