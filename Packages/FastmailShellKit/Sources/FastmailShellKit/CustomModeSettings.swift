import Foundation
import WebKit

/// The Custom mode userscript's settings, mirrored natively.
///
/// One catalog drives everything: the macOS Settings form, the keys the iOS
/// Settings.bundle uses, and the object pushed into the page. Kept in step
/// with the userscript's DEFAULT_SETTINGS (and the Safari extension's
/// settings.js/settings.html, which carry the same options and copy).
///
/// The userscript reads `window.__customModeSettings` once at startup
/// and merges it over its own defaults; a running copy accepts changes
/// through `window.customMode.applySettings(...)`. Both entry points
/// are fed from here.
public enum CustomModeSettings {
    /// The section a setting belongs to. One list of settings, shown as a tab
    /// per group on macOS and a headed section per group on the phone, so the
    /// grouping is decided here once rather than in each screen. `.general`
    /// is the app-level tab the shell already owns (backend, start page,
    /// downloads); the one catalog option that lives there is the app badge.
    public enum Group: String, CaseIterable, Sendable {
        case general
        case appearance
        case labelsFiling
        case snooze
        case keyboard
        case bottomBar

        public var title: String {
            switch self {
            case .general: return "General"
            case .appearance: return "Appearance"
            case .labelsFiling: return "Labels & filing"
            case .snooze: return "Snooze"
            case .keyboard: return "Keyboard"
            case .bottomBar: return "Bottom bar"
            }
        }

        /// The macOS Settings tab's icon.
        public var systemImage: String {
            switch self {
            case .general: return "gearshape"
            case .appearance: return "paintbrush"
            case .labelsFiling: return "tag"
            case .snooze: return "clock"
            case .keyboard: return "keyboard"
            case .bottomBar: return "rectangle.bottomthird.inset.filled"
            }
        }

        /// The custom-mode groups, in display order — everything except the
        /// app-level General tab, which the shell builds itself and only
        /// borrows `.general` catalog options for.
        public static var inboxGroups: [Group] {
            allCases.filter { $0 != .general }
        }
    }

    public struct Option: Identifiable, Sendable {
        public enum Value: Equatable, Sendable {
            case toggle(Bool)
            case text(String)
        }

        /// The bare key the userscript knows this setting by.
        public let key: String
        /// Which settings group this one is shown under.
        public let group: Group
        /// The toggle this one is a sub-option of, if any.
        public let parent: String?
        /// Whether an empty text field is an answer rather than an omission.
        ///
        /// For most text settings it is an omission: a triage label with no
        /// name is not something anyone means, so emptying the field asks
        /// for the default back. But a list of labels has a meaningful
        /// empty — none of them — and without this there was no way to say
        /// it: clearing "Labels that are never projects" put Later straight
        /// back, which is what sent me looking. A hint already promised this
        /// behaviour ("Empty hands the shell its own fallback") and could
        /// not deliver it.
        public let clearable: Bool
        public let title: String
        public let hint: String
        public let defaultValue: Value

        public var id: String { key }

        /// Where the setting lives in UserDefaults. Prefixed so the shell's
        /// own keys (startView, …) and the page's cannot collide with it.
        public var defaultsKey: String { "customMode.\(key)" }

        init(
            _ key: String,
            group: Group,
            parent: String? = nil,
            clearable: Bool = false,
            title: String,
            hint: String,
            default value: Value
        ) {
            self.key = key
            self.group = group
            self.parent = parent
            self.clearable = clearable
            self.title = title
            self.hint = hint
            self.defaultValue = value
        }
    }

    /// The options shown in one group, in catalog order.
    public static func options(in group: Group) -> [Option] {
        options.filter { $0.group == group }
    }

    // Grouped in display order. The group decides where a setting is shown —
    // a macOS tab, a phone section, an iOS Settings.bundle header — while the
    // key, default and copy stay exactly as the userscript and the parity
    // tests expect.
    public static let options: [Option] = [
        // General — the app-level tab the shell owns; the badge is its one
        // catalog setting.
        Option(
            "appBadgeLabel",
            group: .general,
            clearable: true,
            title: "Badge label",
            hint: "The app icon shows how many conversations carry this label. Empty uses the Inbox count.",
            default: .text("Triage")
        ),

        // Appearance — how the sidebar and rows look, no behaviour.
        Option(
            "labelColours",
            group: .appearance,
            title: "Colour rows by label",
            hint: "Rows take the colour of a label they carry.",
            default: .toggle(true)
        ),
        Option(
            "labelColoursSidebarOnly",
            group: .appearance,
            parent: "labelColours",
            title: "Only labels in the sidebar",
            hint: "Plain tags stay uncoloured.",
            default: .toggle(true)
        ),
        Option(
            "labelColoursSkipTriage",
            group: .appearance,
            parent: "labelColours",
            title: "Ignore the triage label",
            hint: "Every undecided message carries it; its colour would tint everything.",
            default: .toggle(true)
        ),
        Option(
            "sidebarSeparators",
            group: .appearance,
            title: "Separate folders from labels",
            hint: "A line between the system folders and your labels.",
            default: .toggle(true)
        ),
        Option(
            "hideLoneExpando",
            group: .appearance,
            title: "Hide the Labels collapse arrow",
            hint: "Hidden while only one account is shown.",
            default: .toggle(true)
        ),
        Option(
            "hideInboxLabel",
            group: .appearance,
            title: "Hide the Inbox tag",
            hint: "Hidden where every message is in the Inbox anyway.",
            default: .toggle(true)
        ),
        Option(
            "stripLabelPrefix",
            group: .appearance,
            title: "Show only the label’s own name",
            hint: "“Work” instead of “Projects/Work”. Hover for the full path.",
            default: .toggle(true)
        ),

        // Labels & filing — what labels mean and how filing works.
        Option(
            "triageLabel",
            group: .labelsFiling,
            title: "Triage label",
            hint: "Added to every incoming message by your rule; removed by keeping, filing or archiving.",
            default: .text("Triage")
        ),
        Option(
            "excludedLabels",
            group: .labelsFiling,
            clearable: true,
            title: "Labels that are never projects",
            hint: "Filing destinations that hold mail rather than queue it; archive leaves them on. Comma-separated paths.",
            default: .text("Later")
        ),
        Option(
            "contactGroupLabels",
            group: .labelsFiling,
            clearable: true,
            title: "Labels that add the sender to a contact group",
            hint: "Applying one adds the sender to the contact group of the same name, creating it if needed. Comma-separated paths.",
            default: .text("")
        ),
        Option(
            "dragAdditive",
            group: .labelsFiling,
            title: "Dragging adds a label",
            hint: "A drop files the message and keeps it in the Inbox. Option moves it.",
            default: .toggle(true)
        ),
        Option(
            "labelsShortcut",
            group: .labelsFiling,
            title: "File instead of move",
            hint: "Files under a project label and keeps the message in the Inbox; one already filed just loses its triage label. Shift-V refiles, Option-V moves.",
            default: .toggle(true)
        ),
        Option(
            "labelsSidebarOnly",
            group: .labelsFiling,
            parent: "labelsShortcut",
            title: "Only labels in the sidebar",
            hint: "The picker hides Trash, Spam and plain tags; typing still finds any label.",
            default: .toggle(true)
        ),
        Option(
            "labelsAutoSave",
            group: .labelsFiling,
            parent: "labelsShortcut",
            title: "Apply the only match automatically",
            hint: "A single remaining match is applied and the picker closes.",
            default: .toggle(true)
        ),
        Option(
            "stickyInboxFilter",
            group: .labelsFiling,
            title: "Filter a project label to the Inbox",
            hint: "Its list opens showing only what is still in the Inbox, since that is the queue and the rest is history. Turning the filter off holds while you stay on that label.",
            default: .toggle(true)
        ),
        Option(
            "filteredLabelCounts",
            group: .labelsFiling,
            title: "Count only what is in the Inbox",
            hint: "A project label’s badge counts the same messages its filtered list shows, rather than everything it has ever held.",
            default: .toggle(true)
        ),

        // Snooze — the snooze action and its defaults, kept together.
        Option(
            "snoozeKey",
            group: .snooze,
            title: "Snooze key",
            hint: "Opens the snooze dialog with the default period filled in.",
            default: .text("w")
        ),
        Option(
            "snoozeDefault",
            group: .snooze,
            title: "Default snooze period",
            hint: "A number and d, w or m for days, weeks or months, such as 2w.",
            default: .text("2w")
        ),
        Option(
            "snoozeTime",
            group: .snooze,
            title: "Snooze time of day",
            hint: "When a snoozed message returns, as HH:MM.",
            default: .text("08:00")
        ),

        // Keyboard — the remaining single-key bindings.
        Option(
            "urgentKey",
            group: .keyboard,
            title: "Pin key",
            hint: "Pins or unpins the selection.",
            default: .text("s")
        ),
        Option(
            "swapArchiveExpand",
            group: .keyboard,
            title: "Swap E and Y",
            hint: "E archives and Y expands, the reverse of Fastmail’s default. H still archives.",
            default: .toggle(true)
        ),

        // Bottom bar — the action bar's ordered actions.
        Option(
            "bottomBarSlots",
            group: .bottomBar,
            title: "Bottom bar actions",
            hint: "In order; what fits on screen shows, the rest go under More.",
            default: .text("Snooze, Pin, Archive, Labels, File, Delete, Move")
        )
    ]

    /// The settings as the userscript should see them: stored value if one
    /// exists, the default otherwise.
    ///
    /// An empty text field means one of two things, and which one depends on
    /// the setting rather than on the value. For most it is an omission and
    /// the default comes back. For a `clearable` one it is an answer — none
    /// of them — and it is passed through as the empty string, which the
    /// userscript's own merge then lays over its default.
    ///
    /// Never set and set-to-empty are told apart by the presence of the key,
    /// not by the value, so a field nobody has touched still gets the
    /// default even where empty would have been honoured.
    /// Until the mode was renamed on 2026-09-07 these lived under an
    /// `inboxMode.` prefix. Each is carried over once, so nothing anybody
    /// chose is lost; a value already written under the new name wins, and
    /// the old key is dropped so this happens exactly once. Cheap enough to
    /// run at every read: after the first pass there is nothing left to find.
    static func migrateLegacyKeys(in defaults: UserDefaults) {
        for option in options {
            let legacy = "inboxMode.\(option.key)"
            guard let value = defaults.object(forKey: legacy) else { continue }
            if defaults.object(forKey: option.defaultsKey) == nil {
                defaults.set(value, forKey: option.defaultsKey)
            }
            defaults.removeObject(forKey: legacy)
        }
    }

    public static func current(from defaults: UserDefaults = .standard) -> [String: Any] {
        migrateLegacyKeys(in: defaults)
        var settings: [String: Any] = [:]
        for option in options {
            switch option.defaultValue {
            case .toggle(let fallback):
                settings[option.key] = defaults.object(forKey: option.defaultsKey) as? Bool ?? fallback
            case .text(let fallback):
                guard let stored = defaults.string(forKey: option.defaultsKey) else {
                    settings[option.key] = fallback
                    continue
                }

                let trimmed = stored.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty {
                    settings[option.key] = trimmed
                } else {
                    settings[option.key] = option.clearable ? "" : fallback
                }
            }
        }
        return settings
    }

    static func json(from defaults: UserDefaults) -> String {
        guard
            let data = try? JSONSerialization.data(
                withJSONObject: current(from: defaults),
                options: [.sortedKeys]
            ),
            let json = String(data: data, encoding: .utf8)
        else { return "{}" }
        return json
    }

    /// Writes the settings global before anything else runs, so the payload
    /// finds it when it starts — the WKUserScript counterpart of the Safari
    /// extension injecting settings ahead of its payload.
    @MainActor
    public static func bootstrapScript(from defaults: UserDefaults = .standard) -> WKUserScript {
        WKUserScript(
            source: "window.__customModeSettings = \(json(from: defaults));",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    /// Pushes the settings into a page that is already running. The global is
    /// refreshed as well so a payload injected later still reads the latest.
    public static func applyScriptSource(from defaults: UserDefaults = .standard) -> String {
        """
        window.__customModeSettings = \(json(from: defaults));
        if (window.customMode) window.customMode.applySettings(window.__customModeSettings);
        """
    }
}
