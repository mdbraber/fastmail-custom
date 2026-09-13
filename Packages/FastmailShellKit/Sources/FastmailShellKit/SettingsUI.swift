import SwiftUI

// The in-app settings screen for the phone: opened from the page's App
// settings menu item, so nothing lives an app-switch away. Custom mode's own
// settings are drawn by the page itself now; this sheet carries only the
// shell's three.
public struct MobileSettingsSheet: View {
    private let profile: Profile
    @AppStorage(StartView.defaultsKey) private var startView = ""
    @AppStorage(Backend.defaultsKey) private var backendName = Backend.standard.rawValue
    @Environment(\.dismiss) private var dismiss

    public init(profile: Profile) {
        self.profile = profile
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Backend", selection: $backendName) {
                        ForEach(Backend.allCases, id: \.rawValue) { backend in
                            Text(backend.title).tag(backend.rawValue)
                        }
                    }
                } header: {
                    Text("General")
                } footer: {
                    Text("Beta is Fastmail's test server, with its own sign-in and settings. Switching reloads the page and asks you to log in again.")
                }

                Section {
                    TextField(
                        "Start page",
                        text: $startView,
                        prompt: Text("/mail/Inbox")
                    )
                    .autocorrectionDisabled()
                    #if canImport(UIKit)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                    Text(resolved)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                } footer: {
                    Text("The path to open, such as /mail/Inbox. Empty opens the default view. Takes effect on the next launch.")
                }

                // Custom mode's own settings used to follow here, one section
                // per group; now the page draws them itself.
                Section {
                } footer: {
                    Text("Everything else lives in the page, under Fastmail's own Settings, so it is the same on every device you use.")
                }
            }
            .navigationTitle("Settings")
            #if canImport(UIKit)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var resolved: String {
        StartView.resolve(
            startView,
            default: profile.startURL,
            backend: Backend.resolve(backendName)
        ).absoluteString
    }
}
