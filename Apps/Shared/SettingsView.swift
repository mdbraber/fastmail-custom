import SwiftUI
import FastmailShellKit

struct SettingsView: View {
    let profile: Profile

    var body: some View {
        // Only the shell's own settings are here now. Everything about the
        // mail interface is in the page, under Fastmail's own Settings, where
        // one panel serves the Mac, the phone and Safari alike.
        GeneralSettingsView(profile: profile)
            .frame(width: 500, height: 460)
    }
}

private struct GeneralSettingsView: View {
    let profile: Profile
    @AppStorage(StartView.defaultsKey) private var startView = ""
    @AppStorage(Backend.defaultsKey) private var backendName = Backend.production.rawValue
    @AppStorage(AttachmentOpener.autoOpenDefaultsKey) private var autoOpen = false
    @AppStorage(DownloadManager.folderDefaultsKey) private var downloadFolder = ""
    @AppStorage(ComposeMode.defaultsKey) private var composeMode = ComposeMode.fallback.rawValue

    var body: some View {
        Form {
            Section {
                Picker("Backend", selection: $backendName) {
                    ForEach(Backend.allCases, id: \.rawValue) { backend in
                        Text(backend.title).tag(backend.rawValue)
                    }
                }
            } footer: {
                Text("Beta is Fastmail's test server, with its own sign-in and settings. Switching reloads the page and asks you to log in again.")
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
                Text("The path to open, such as /mail/Inbox. Empty opens the default view. Takes effect in new windows.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            #if os(macOS)
            Section {
                Picker("New message opens", selection: $composeMode) {
                    ForEach(ComposeMode.allCases, id: \.rawValue) { mode in
                        Text(mode.title).tag(mode.rawValue)
                    }
                }
            } header: {
                Text("Compose")
            } footer: {
                Text("What the C key and the Compose button do. Hold Option for Fastmail's own compose in the page, Command and Option for a tab.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
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
                Text("Downloaded documents and images open in their default app. Archives, installers and executables always preview.")
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
