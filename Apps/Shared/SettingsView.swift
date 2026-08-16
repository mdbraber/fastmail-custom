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
        }
        .formStyle(.grouped)
    }

    private var resolved: String {
        StartView.resolve(startView, default: profile.startURL).absoluteString
    }
}

// The Inbox mode form is generated from InboxModeSettings.options, the same
// catalog the page injection reads, so the screen and the userscript cannot
// drift apart. Changes land in UserDefaults; the pusher in FastmailShellKit
// picks them up from there and applies them to any open window live.
private struct InboxModeSettingsView: View {
    @StateObject private var model = InboxModeSettingsModel()

    var body: some View {
        Form {
            ForEach(InboxModeSettings.options) { option in
                row(for: option)
            }
        }
        .formStyle(.grouped)
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

@MainActor
private final class InboxModeSettingsModel: ObservableObject {
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
