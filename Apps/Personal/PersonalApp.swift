import SwiftUI
import FastmailShellKit

@main
struct PersonalApp: App {
    var body: some Scene {
        WindowGroup {
            AppShell(profile: .personal(accountID: Profile.accountID(from: .main)))
        }
    }
}
