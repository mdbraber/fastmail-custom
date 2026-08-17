import SwiftUI

// The Inbox mode form is generated from InboxModeSettings.options, the same
// catalog the page injection reads, so the screen and the userscript cannot
// drift apart. Changes land in UserDefaults; the pusher picks them up from
// there and applies them to any open window live.
public struct InboxModeSettingsForm: View {
    @StateObject private var model = InboxModeSettingsModel()

    public init() {}

    public var body: some View {
        ForEach(InboxModeSettings.options) { option in
            row(for: option)
        }
    }

    @ViewBuilder
    private func row(for option: InboxModeSettings.Option) -> some View {
        let enabled = model.parentIsOn(of: option)
        VStack(alignment: .leading, spacing: 3) {
            switch option.defaultValue {
            case .toggle:
                Toggle(option.title, isOn: model.toggleBinding(for: option))
            case .text(let fallback):
                Text(option.title)
                TextField(
                    option.title,
                    text: model.textBinding(for: option),
                    prompt: Text(fallback)
                )
                .labelsHidden()
                .autocorrectionDisabled()
                #if canImport(UIKit)
                .textInputAutocapitalization(.never)
                #endif
            }
            Text(option.hint)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, option.parent == nil ? 0 : 18)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }
}

// The in-app settings screen for the phone: the same catalog form the macOS
// Settings window shows, opened from the page's App settings menu item, so
// nothing lives an app-switch away. Changes apply to the open page live.
public struct MobileSettingsSheet: View {
    private let profile: Profile
    @AppStorage(StartView.defaultsKey) private var startView = ""
    @Environment(\.dismiss) private var dismiss

    public init(profile: Profile) {
        self.profile = profile
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(
                        "Start URL",
                        text: $startView,
                        prompt: Text("https://app.fastmail.com/mail/Inbox")
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
                } header: {
                    Text("General")
                } footer: {
                    Text("Must be on app.fastmail.com; empty for the default view. Takes effect on the next launch.")
                }

                Section("Inbox mode") {
                    InboxModeSettingsForm()
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
        StartView.resolve(startView, default: profile.startURL).absoluteString
    }
}

@MainActor
final class InboxModeSettingsModel: ObservableObject {
    private let defaults = UserDefaults.standard

    // A suboption only means anything while the option above it is on, so it
    // follows its parent rather than sitting there looking available — the
    // same rule the extension popup applies.
    func parentIsOn(of option: InboxModeSettings.Option) -> Bool {
        guard
            let parentKey = option.parent,
            let parent = InboxModeSettings.options.first(where: { $0.key == parentKey }),
            case .toggle(let fallback) = parent.defaultValue
        else { return true }
        return defaults.object(forKey: parent.defaultsKey) as? Bool ?? fallback
    }

    func toggleBinding(for option: InboxModeSettings.Option) -> Binding<Bool> {
        let fallback: Bool
        if case .toggle(let value) = option.defaultValue { fallback = value } else { fallback = false }
        return Binding(
            get: { [defaults] in
                defaults.object(forKey: option.defaultsKey) as? Bool ?? fallback
            },
            set: { [weak self] value in
                self?.objectWillChange.send()
                self?.defaults.set(value, forKey: option.defaultsKey)
            }
        )
    }

    func textBinding(for option: InboxModeSettings.Option) -> Binding<String> {
        Binding(
            get: { [defaults] in
                defaults.string(forKey: option.defaultsKey) ?? ""
            },
            set: { [weak self] value in
                self?.objectWillChange.send()
                self?.defaults.set(value, forKey: option.defaultsKey)
            }
        )
    }
}
