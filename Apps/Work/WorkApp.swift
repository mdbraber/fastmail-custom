import SwiftUI
import FastmailShellKit

@main
struct WorkApp: App {
    private let profile = Profile.work(accountID: Profile.accountID(from: .main))
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PushRegistrar.self) private var pushRegistrar
    #endif

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
