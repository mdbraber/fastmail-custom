import SwiftUI
import FastmailShellKit

@main
struct PersonalApp: App {
    private let profile = Profile.personal(accountID: Profile.accountID(from: .main))

    var body: some Scene {
        WindowGroup {
            AppShell(profile: profile)
        }
        #if os(macOS)
        Settings {
            SettingsView(profile: profile)
        }
        #endif
    }
}
