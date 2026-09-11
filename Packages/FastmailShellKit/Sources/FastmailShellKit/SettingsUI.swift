import SwiftUI

// The Custom mode form is generated from CustomModeSettings.options, the same
// catalog the page injection reads, so the screen and the userscript cannot
// drift apart.
public struct CustomModeSettingsForm: View {
    @StateObject private var model = CustomModeSettingsModel()
    private let group: CustomModeSettings.Group

    public init(group: CustomModeSettings.Group) {
        self.group = group
    }

    public var body: some View {
        ForEach(CustomModeSettings.options(in: group)) { option in
            if option.key == "bottomBarSlots" {
                barOrderRows(for: option)
            } else {
                row(for: option)
            }
        }
    }

    // A row is as tall as the platform draws one, and the list is exactly as
    // tall as its rows: a List inside a Form has no height of its own, so it
    // has to be given one, and a guessed one leaves dead space under the last
    // verb.
    #if canImport(UIKit)
    private static let barRowHeight: CGFloat = 44
    #else
    private static let barRowHeight: CGFloat = 28
    #endif

    // A List keeps a little air above its first row and below its last, and
    // the Mac's bordered table draws a hairline around the lot; none of it is
    // part of any row, so it has to be added or the last verb is clipped.
    #if canImport(UIKit)
    private static let barListInset: CGFloat = 16
    #else
    private static let barListInset: CGFloat = 4
    #endif

    // The bar order is dragged, not typed: one row per verb, reordered with
    // onMove and written back as the same comma string the userscript reads.
    //
    // The whole row is the handle, not the word in it: a bare Text is the only
    // thing a drag can start on, so a row is given a shape of its own, the
    // verb's icon, and a grip, and picks up anywhere along its width.
    @ViewBuilder
    private func barOrderRows(for option: CustomModeSettings.Option) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(option.title)
            Text(option.hint)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        List {
            ForEach(model.barOrder, id: \.self) { name in
                barSlotRow(name)
            }
            .onMove { from, to in model.moveBarSlot(from: from, to: to) }
        }
        #if canImport(UIKit)
        .listStyle(.plain)
        .environment(\.editMode, .constant(.active))
        #else
        // The Mac's own table: a hairline box, square-edged rows and the
        // system's alternating row colours, the same list System Settings
        // shows its login items in.
        .listStyle(.bordered(alternatesRowBackgrounds: true))
        #endif
        .frame(
            height: Self.barRowHeight * CGFloat(model.barOrder.count)
                + Self.barListInset
        )
        .scrollDisabled(true)
    }

    @ViewBuilder
    private func barSlotRow(_ name: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: CustomModeSettings.barSlotSymbol(name))
                .foregroundStyle(.secondary)
                .frame(width: 18, alignment: .center)
            Text(name)
            Spacer(minLength: 0)
            #if !canImport(UIKit)
            // iOS draws its own reorder grip in edit mode; the Mac does not.
            Image(systemName: "line.3.horizontal")
                .foregroundStyle(.tertiary)
                .imageScale(.small)
            #endif
        }
        .frame(height: Self.barRowHeight)
        .listRowInsets(EdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 8))
        .listRowSeparator(.hidden)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func row(for option: CustomModeSettings.Option) -> some View {
        let enabled = model.parentIsOn(of: option)
        VStack(alignment: .leading, spacing: 3) {
            switch option.defaultValue {
            case .toggle:
                Toggle(option.title, isOn: model.toggleBinding(for: option))
            case .text(let fallback):
                Text(option.title)
                // A clearable field shows its default as text rather than as a
                // placeholder, because for those two an empty box is
                // ambiguous; never touched, or emptied on purpose, and they
                // mean opposite things.
                TextField(
                    option.title,
                    text: model.textBinding(for: option),
                    prompt: Text(option.clearable ? "none" : fallback)
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
// nothing lives an app-switch away.
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

                // The app badge lives with the General settings; the rest of
                // the catalog follows, one headed section per group.
                Section {
                    CustomModeSettingsForm(group: .general)
                }

                // Notifications are not here: on the phone they belong to
                // Settings → the app, beside iOS's own alert controls, and the
                // Settings bundle carries the same switch.

                ForEach(CustomModeSettings.Group.inboxGroups, id: \.self) { group in
                    Section(group.title) {
                        CustomModeSettingsForm(group: group)
                    }
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

@MainActor
final class CustomModeSettingsModel: ObservableObject {
    private let defaults = UserDefaults.standard

    // The verbs the reorder list offers, in the catalog's own order.
    static let barSlotNames: [String] = {
        guard
            let option = CustomModeSettings.options.first(where: { $0.key == "bottomBarSlots" }),
            case .text(let value) = option.defaultValue
        else { return [] }
        return value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }()

    @Published var barOrder: [String]

    init() {
        barOrder = Self.loadBarOrder(from: UserDefaults.standard)
    }

    private static var barSlotsKey: String {
        CustomModeSettings.options
            .first(where: { $0.key == "bottomBarSlots" })?
            .defaultsKey ?? "customMode.bottomBarSlots"
    }

    // Stored order first, then whatever it does not name, so a value saved
    // by an older build still lists every verb once
    static func loadBarOrder(from defaults: UserDefaults) -> [String] {
        let stored = (defaults.string(forKey: barSlotsKey) ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }

        var order = stored.compactMap { name in
            barSlotNames.first { $0.lowercased() == name }
        }
        for name in barSlotNames where !order.contains(name) {
            order.append(name)
        }
        return order
    }

    func moveBarSlot(from source: IndexSet, to destination: Int) {
        barOrder.move(fromOffsets: source, toOffset: destination)
        defaults.set(barOrder.joined(separator: ", "), forKey: Self.barSlotsKey)
    }

    // A suboption only means anything while the option above it is on, so it
    // follows its parent rather than sitting there looking available; the same
    // rule the extension popup applies.
    func parentIsOn(of option: CustomModeSettings.Option) -> Bool {
        guard
            let parentKey = option.parent,
            let parent = CustomModeSettings.options.first(where: { $0.key == parentKey }),
            case .toggle(let fallback) = parent.defaultValue
        else { return true }
        return defaults.object(forKey: parent.defaultsKey) as? Bool ?? fallback
    }

    func toggleBinding(for option: CustomModeSettings.Option) -> Binding<Bool> {
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

    func textBinding(for option: CustomModeSettings.Option) -> Binding<String> {
        var fallback = ""
        if option.clearable, case .text(let value) = option.defaultValue {
            fallback = value
        }

        return Binding(
            get: { [defaults] in
                // Only the clearable ones fall back here: for the rest an
                // empty box already means the default, so the placeholder
                // tells the truth and there is nothing to spell out
                defaults.string(forKey: option.defaultsKey) ?? fallback
            },
            set: { [weak self] value in
                self?.objectWillChange.send()
                self?.defaults.set(value, forKey: option.defaultsKey)
            }
        )
    }
}
