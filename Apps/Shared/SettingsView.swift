import SwiftUI
import FastmailShellKit

struct SettingsView: View {
    let profile: Profile

    var body: some View {
        // Only the shell's own settings are here now. Everything about the
        // mail interface is in the page, under Fastmail's own Settings, where
        // one panel serves the Mac, the phone and Safari alike.
        TabView {
            GeneralSettingsView(profile: profile)
                .tabItem { Label("General", systemImage: "gearshape") }
            #if os(macOS)
            ComposeSettingsView()
                .tabItem { Label("Compose", systemImage: "square.and.pencil") }
            NotificationsSettingsView()
                .tabItem { Label("Notifications", systemImage: "bell") }
            DownloadsSettingsView()
                .tabItem { Label("Downloads", systemImage: "arrow.down.circle") }
            #endif
        }
        .frame(width: 500, height: 340)
    }
}

private struct GeneralSettingsView: View {
    let profile: Profile
    @AppStorage(StartView.defaultsKey) private var startView = ""
    @AppStorage(Backend.defaultsKey) private var backendName = Backend.production.rawValue
    @AppStorage(DevicePreferences.rememberPageKey) private var rememberPage = false

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
                Toggle("Remember last page", isOn: Binding(
                    get: { rememberPage },
                    set: { DevicePreferences.setRememberPage($0) }
                ))
                TextField(
                    "Start page",
                    text: $startView,
                    prompt: Text("/mail/Inbox")
                )
            } footer: {
                Text("The path to open, such as /mail/Inbox; empty opens the default view. Used when Remember last page is off, or nothing has been saved yet. Takes effect in new windows.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

#if os(macOS)
private struct ComposeSettingsView: View {
    @AppStorage(ComposeMode.defaultsKey) private var composeMode = ComposeMode.fallback.rawValue
    @AppStorage(ComposeMode.editDraftDefaultsKey) private var editDraftFollows = ComposeMode.editDraftFallback

    var body: some View {
        Form {
            Section {
                Picker("Compose opens", selection: $composeMode) {
                    ForEach(ComposeMode.allCases, id: \.rawValue) { mode in
                        Text(mode.title).tag(mode.rawValue)
                    }
                }
            } footer: {
                Text("What the C key and the Compose button do. Hold Option for Fastmail's own compose in the page, Command and Option for a tab.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                Toggle("Drafts open the same way", isOn: $editDraftFollows)
            } footer: {
                Text("Carrying on with a draft goes where the setting above says, rather than where Fastmail would put it.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

// Which mail notifies is Fastmail's own Notifications page on the Mac; how a
// banner reads is the app's, since the app draws it.
private struct NotificationsSettingsView: View {
    @AppStorage(PushPreferences.previewsKey) private var previews = true

    var body: some View {
        Form {
            Section {
                Toggle("Show previews", isOn: $previews)
            } footer: {
                Text("A banner shows the subject above the start of the message, rather than the subject alone.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

private struct DownloadsSettingsView: View {
    @AppStorage(AttachmentOpener.autoOpenDefaultsKey) private var autoOpen = false
    @AppStorage(DownloadManager.folderDefaultsKey) private var downloadFolder = ""
    @AppStorage(DownloadManager.askEachTimeDefaultsKey) private var askEachTime = false

    // Safari's own shape for this picker: the fixed folder first, then
    // whichever other folder was chosen last, if any, then the two choices
    // that are not a folder at all.
    private enum Choice: Hashable {
        case downloads
        case custom(String)
        case askEachTime
        case chooseOther
    }

    private var choice: Choice {
        if askEachTime { return .askEachTime }
        if !downloadFolder.isEmpty { return .custom(downloadFolder) }
        return .downloads
    }

    var body: some View {
        Form {
            Section {
                Picker("File download location", selection: Binding(
                    get: { choice },
                    set: { selection in
                        switch selection {
                        case .downloads:
                            askEachTime = false
                            downloadFolder = ""
                        case .custom(let path):
                            askEachTime = false
                            downloadFolder = path
                        case .askEachTime:
                            askEachTime = true
                        case .chooseOther:
                            chooseFolder()
                        }
                    }
                )) {
                    Label("Downloads", systemImage: "folder").tag(Choice.downloads)
                    if case .custom(let path) = choice {
                        Label(
                            FileManager.default.displayName(atPath: path),
                            systemImage: "folder"
                        ).tag(Choice.custom(path))
                    }
                    Divider()
                    Text("Ask for each download").tag(Choice.askEachTime)
                    Text("Other…").tag(Choice.chooseOther)
                }
                Toggle("Auto-open safe attachments", isOn: $autoOpen)
                Text("Downloaded documents and images open in their default app. Archives, installers and executables always preview.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        askEachTime = false
        downloadFolder = url.path
    }
}
#endif
