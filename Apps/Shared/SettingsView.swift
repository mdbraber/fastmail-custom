import SwiftUI
import FastmailShellKit

struct SettingsView: View {
    let profile: Profile
    @AppStorage(StartView.defaultsKey) private var startView = ""

    var body: some View {
        Form {
            TextField("Start URL", text: $startView, prompt: Text("https://app.fastmail.com/mail/Inbox"))
                .textFieldStyle(.roundedBorder)
            Text(resolved)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Text("The full address to open. Must be on app.fastmail.com. Leave empty for the default view. Takes effect in new windows.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(width: 460)
    }

    private var resolved: String {
        StartView.resolve(startView, default: profile.startURL).absoluteString
    }
}
