#if canImport(UIKit)
import SwiftUI
import UIKit

/// The Device settings page on iPhone and iPad, reached from the Device
/// settings row in Fastmail's Settings. It lies over the whole screen with the
/// web view still loaded underneath, and every change saves at once.
public struct DeviceSettingsPage: View {
    private let onClose: () -> Void
    @ObservedObject private var lock = ScreenLock.shared
    @AppStorage(StartView.defaultsKey) private var startView = ""
    @AppStorage(DevicePreferences.rememberPageKey) private var rememberPage = false
    @AppStorage(DevicePreferences.inAppBrowserKey) private var inAppBrowser = true
    @State private var method = ScreenLock.method()

    public init(onClose: @escaping () -> Void) {
        self.onClose = onClose
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(method.title, isOn: Binding(
                        get: { lock.isEnabled },
                        set: { lock.setEnabled($0) }
                    ))
                    .disabled(!method.canLock && !lock.isEnabled)
                } footer: {
                    Text(method.footer)
                }

                Section {
                    Toggle("Remember last viewed page", isOn: Binding(
                        get: { rememberPage },
                        set: { DevicePreferences.setRememberPage($0) }
                    ))
                    LabeledContent("Start page") {
                        TextField("Start page", text: $startView, prompt: Text("/mail/Inbox"))
                            .multilineTextAlignment(.trailing)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .keyboardType(.URL)
                    }
                } footer: {
                    Text("Used when Remember last viewed page is off. Empty opens Fastmail's default view.")
                }

                Section {
                    Toggle("Use in-app browser for external links", isOn: $inAppBrowser)
                }

                Section {
                    LabeledContent("Version", value: AppVersion.text())
                }

                Section {
                    NavigationLink("Show Advanced Settings") {
                        BackendSettingsPage()
                    }
                }
            }
            .navigationTitle("Device settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onClose) {
                        Image(systemName: "chevron.backward")
                            .fontWeight(.semibold)
                    }
                    .accessibilityLabel("Back")
                }
            }
        }
        // A passcode set or removed in the Settings app changes what the
        // switch is called and whether it can turn on.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            method = ScreenLock.method()
        }
    }
}

/// Show Advanced Settings: which server the app talks to, and whether Safari's
/// Web Inspector may attach.
struct BackendSettingsPage: View {
    @AppStorage(Backend.defaultsKey) private var backendName = Backend.standard.rawValue
    @AppStorage(DevicePreferences.remoteDebuggingKey) private var remoteDebugging = true

    var body: some View {
        Form {
            Section {
                ForEach(Backend.allCases, id: \.rawValue) { backend in
                    Button {
                        // The web view is keyed on this, so a change reloads
                        // the page on the other server.
                        guard Backend.resolve(backendName) != backend else { return }
                        backendName = backend.rawValue
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(backend.title)
                                    .foregroundStyle(Color.primary)
                                Text(backend.host)
                                    .font(.footnote)
                                    .foregroundStyle(Color.secondary)
                            }
                            Spacer()
                            if Backend.resolve(backendName) == backend {
                                Image(systemName: "checkmark")
                                    .fontWeight(.semibold)
                                    .foregroundStyle(Color.accentColor)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                }
            } header: {
                Text("Server backend")
            } footer: {
                Text("Beta is Fastmail's test server, with its own sign-in and settings. Switching reloads the page and asks you to log in again.")
            }

            Section {
                Toggle("Enable remote debugging", isOn: $remoteDebugging)
            } header: {
                Text("Debugging")
            }
        }
        .navigationTitle("Backend")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: remoteDebugging) {
            WebInspection.apply(to: WebViewRegistry.shared.views)
        }
    }
}
#endif
