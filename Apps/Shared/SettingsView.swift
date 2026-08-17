import SwiftUI
import FastmailShellKit

struct SettingsView: View {
    let profile: Profile

    var body: some View {
        TabView {
            GeneralSettingsView(profile: profile)
                .tabItem { Label("General", systemImage: "gearshape") }
            InboxModeSettingsView()
                .tabItem { Label("Inbox mode", systemImage: "tray") }
        }
        .frame(width: 500, height: 560)
    }
}

private struct GeneralSettingsView: View {
    let profile: Profile
    @AppStorage(StartView.defaultsKey) private var startView = ""
    @AppStorage(AttachmentOpener.autoOpenDefaultsKey) private var autoOpen = false
    @AppStorage(DownloadManager.folderDefaultsKey) private var downloadFolder = ""

    var body: some View {
        Form {
            Section {
                TextField("Start URL", text: $startView, prompt: Text("https://app.fastmail.com/mail/Inbox"))
                Text(resolved)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            } footer: {
                Text("The full address to open. Must be on app.fastmail.com. Leave empty for the default view. Takes effect in new windows.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            #if os(macOS)
            Section {
                LabeledContent("Download folder") {
                    Text(downloadFolder.isEmpty ? "~/Downloads" : downloadFolder)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                HStack {
                    Button("Choose…") { chooseFolder() }
                    if !downloadFolder.isEmpty {
                        Button("Use ~/Downloads") { downloadFolder = "" }
                    }
                }
                Toggle("Auto-open safe attachments", isOn: $autoOpen)
                Text("When on, a finished download whose content is a document or image opens in its default app instead of previewing. Archives, installers and executables always preview, whatever their name says.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Downloads")
            }
            #endif
        }
        .formStyle(.grouped)
    }

    private var resolved: String {
        StartView.resolve(startView, default: profile.startURL).absoluteString
    }

    #if os(macOS)
    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            downloadFolder = url.path
        }
    }
    #endif
}

// The form itself lives in FastmailShellKit (SettingsUI.swift), shared with
// the phone's in-app sheet; this file only gives it the macOS tab frame.
private struct InboxModeSettingsView: View {
    var body: some View {
        Form {
            InboxModeSettingsForm()
        }
        .formStyle(.grouped)
    }
}
