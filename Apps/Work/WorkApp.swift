import SwiftUI
import FastmailShellKit

@main
struct WorkApp: App {
    var body: some Scene {
        WindowGroup {
            AppShell(profile: .work(accountID: Profile.accountID(from: .main)))
        }
    }
}
