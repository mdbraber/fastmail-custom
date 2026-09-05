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
    @AppStorage(Backend.defaultsKey) private var backendName = Backend.production.rawValue
    @AppStorage(AttachmentOpener.autoOpenDefaultsKey) private var autoOpen = false
    @AppStorage(DownloadManager.folderDefaultsKey) private var downloadFolder = ""

    var body: some View {
        Form {
            Section {
                Picker("Backend", selection: $backendName) {
                    ForEach(Backend.allCases, id: \.rawValue) { backend in
                        Text(backend.title).tag(backend.rawValue)
                    }
                }
            } footer: {
                Text("Beta is Fastmail's test server. It is a separate sign-in with its own settings, so switching reloads the page and asks you to log in again.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                TextField(
                    "Start page",
                    text: $startView,
                    prompt: Text("/mail/Inbox")
                )
                Text(resolved)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            } footer: {
                Text("A path on the selected server, such as /mail/Inbox. The backend above decides which server it opens on. Leave empty for the default view. Takes effect in new windows.")
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
        StartView.resolve(
            startView,
            default: profile.startURL,
            backend: Backend.resolve(backendName)
        ).absoluteString
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
