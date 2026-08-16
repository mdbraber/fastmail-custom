import SwiftUI
import FastmailShellKit

@main
struct PersonalApp: App {
    private let profile = Profile.personal(accountID: Profile.accountID(from: .main))

    var body: some Scene {
        WindowGroup(id: "main") {
            AppShell(profile: profile)
        }
        #if os(macOS)
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
