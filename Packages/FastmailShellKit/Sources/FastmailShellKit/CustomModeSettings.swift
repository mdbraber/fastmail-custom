import Foundation
import WebKit

/// The Custom mode userscript's settings, mirrored natively.
public enum CustomModeSettings {
    /// The section a setting belongs to. One list of settings, shown as a tab
    /// per group on macOS and a headed section per group on the phone, so the
    /// grouping is decided here once rather than in each screen.
    public enum Group: String, CaseIterable, Sendable {
        case general
        case appearance
        case labelsFiling
        case grouping
        case snooze
        case keyboard
        case bottomBar

        public var title: String {
            switch self {
            case .general: return "General"
            case .appearance: return "Appearance"
            case .labelsFiling: return "Labels & keeping"
            case .grouping: return "Groups"
            case .snooze: return "Snooze"
            case .keyboard: return "Keyboard"
            case .bottomBar: return "Action bar"
            }
        }

        /// The macOS Settings tab's icon.
        public var systemImage: String {
            switch self {
            case .general: return "gearshape"
            case .appearance: return "paintbrush"
            case .labelsFiling: return "tag"
            case .grouping: return "rectangle.3.group"
            case .snooze: return "clock"
            case .keyboard: return "keyboard"
            case .bottomBar: return "rectangle.bottomthird.inset.filled"
            }
        }

        /// The custom-mode groups, in display order; everything except the
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
        public let clearable: Bool
        /// Whether the value runs to several lines. The value kind stays
        /// `.text`; this only tells the form to draw an editor rather than a
        /// field, and tells the iOS Settings bundle to leave it alone, since
        /// a PSTextFieldSpecifier is one line and cannot hold it.
        public let multiline: Bool
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
            multiline: Bool = false,
            title: String,
            hint: String,
            default value: Value
        ) {
            self.key = key
            self.group = group
            self.parent = parent
            self.clearable = clearable
            self.multiline = multiline
            self.title = title
            self.hint = hint
            self.defaultValue = value
        }
    }

    /// The options shown in one group, in catalog order.
    public static func options(in group: Group) -> [Option] {
        options.filter { $0.group == group }
    }

    /// The symbol a bar verb is drawn with in the reorder list, so a row in
    /// Settings is recognisable as the button it places. Named here beside
    /// the catalog, since the list of verbs is the catalog's own.
    /// The verb's own glyph: the shape the bar draws for it, carried in the
    /// apps' shared asset catalog so the list you order the bar in shows the
    /// same pictures as the bar itself. Five are Fastmail's, traced from the
    /// icons its own buttons wear; Keep is the mode's, from the same points
    /// the script draws it with; and none of them has a system symbol that is
    /// actually the same drawing, which is why they are carried rather than
    /// approximated. Its own Snooze is an alarm clock, for one, and a plain
    /// clock was standing in for it.
    public static func barSlotGlyph(_ slot: String) -> String {
        switch slot.lowercased() {
        case "snooze": return "BarSnooze"
        case "pin": return "BarPin"
        case "keep": return "BarKeep"
        case "archive": return "BarArchive"
        case "move": return "BarMove"
        case "labels": return "BarLabels"
        case "delete": return "BarDelete"
        default: return ""
        }
    }

    /// The nearest system symbol, for a bundle without the catalog in it.
    public static func barSlotSymbol(_ slot: String) -> String {
        switch slot.lowercased() {
        case "snooze": return "alarm"
        case "pin": return "pin"
        case "keep": return "tray.and.arrow.down"
        case "archive": return "archivebox"
        case "move": return "folder"
        case "labels": return "tag"
        case "delete": return "trash"
        default: return "square"
        }
    }

    /// Where every Custom mode setting lives in UserDefaults. Prefixed so the
    /// shell's own keys (backend, startView, push.alerts) and the page's
    /// cannot collide, and so the page can be given the whole namespace
    /// without being given anything else.
    public static let keyPrefix = "customMode."

    public static func defaultsKey(for key: String) -> String { keyPrefix + key }

    /// A key the page is allowed to write. Letters and digits only, starting
    /// with a letter. Swift keeps no list of the options — the userscript's
    /// catalogue is canonical — so the namespace is the guard: a key that
    /// passes this can only ever name something under `customMode.`, and a
    /// dot, which is the only way to climb out of a key path, is not in the
    /// pattern.
    public static func isWritableSettingKey(_ key: String) -> Bool {
        guard let first = key.first, first.isASCII, first.isLetter else { return false }
        return key.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    // Grouped in display order. The group decides where a setting is shown, a
    // macOS tab, a phone section, an iOS Settings.bundle header; while the
    // key, default and copy stay exactly as the userscript and the parity
    // tests expect.
    public static let options: [Option] = [
        // General; the app-level tab the shell owns; the badge is its one
        // catalog setting.
        Option(
            "appBadgeLabel",
            group: .general,
            clearable: true,
            title: "Badge label",
            hint: "The app icon shows how many conversations carry this label. Empty uses the Inbox count.",
            default: .text("Triage")
        ),

        // Appearance; how the sidebar and rows look, no behaviour.
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

        // Labels & filing; what labels mean and how filing works.
        Option(
            "triageLabel",
            group: .labelsFiling,
            title: "Triage label",
            hint: "Added to every incoming message by your rule; removed by keeping it somewhere or archiving it.",
            default: .text("Triage")
        ),
        Option(
            "excludedLabels",
            group: .labelsFiling,
            clearable: true,
            title: "Labels that are never projects",
            hint: "Destinations that hold mail rather than queue it; archive leaves them on, and Shift-E archives into one. Comma-separated paths.",
            default: .text("Later, Feedbin")
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
            "backToListAfterTriage",
            group: .labelsFiling,
            title: "Back to the list when triage runs out",
            hint: "Keeping steps to the next message only while that message still carries the triage label; otherwise the message list comes back.",
            default: .toggle(true)
        ),
        Option(
            "dragAdditive",
            group: .labelsFiling,
            title: "Dragging adds a label",
            hint: "A drop keeps the message under that label and leaves it in the Inbox. Option moves it.",
            default: .toggle(true)
        ),
        Option(
            "labelsShortcut",
            group: .labelsFiling,
            title: "Keep instead of move",
            hint: "Keeps the message under a project label and leaves it in the Inbox; one already kept just loses its triage label. Shift-V keeps it somewhere else, Option-V moves.",
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

        // Groups; the message list split into named sections. Fastmail offers
        // none, by age, pinned first, unread first and one custom split per
        // mailbox; the userscript adds Labels, which is built from the label
        // tree, and everything written here.
        Option(
            "groupings",
            group: .grouping,
            clearable: true,
            multiline: true,
            title: "Your groupings",
            hint: "One block each: a line naming the grouping, then indented “Name = search” lines, then a bare line for everything else. Fastmail’s own search syntax, so an unrecognised word becomes a text search rather than an error. Renaming a grouping loses it on the mailboxes using it.",
            default: .text("by age (urgent first)\n  Triage = in:Triage OR is:unread\n  Pinned = is:pinned\n  Today = date:today\n  Yesterday = date:yesterday\n  This week = after:1w\n  This month = after:1m\n  Older")
        ),

        // Snooze; the snooze action and its defaults, kept together.
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

        // Keyboard; the remaining single-key bindings.
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

        // The action bar: one list of verbs, drawn along the bottom of the
        // screen on iPhone and across the top of the message on iPad. The
        // stored keys keep their old names so a saved value survives.
        Option(
            "bottomBarSlots",
            group: .bottomBar,
            title: "Action bar actions",
            hint: "In order; the bar along the bottom on iPhone, and across the top of a message on iPad and the Mac. What fits shows, the rest go under More.",
            default: .text("Snooze, Pin, Keep, Archive, Labels, Move, Delete")
        ),
        Option(
            "bottomBarItems",
            group: .bottomBar,
            clearable: true,
            title: "Items on the bottom bar",
            hint: "How many verbs the bar along the bottom of the screen draws before More. Empty fits as many as it can measure.",
            default: .text("")
        ),
        Option(
            "topBarItems",
            group: .bottomBar,
            clearable: true,
            title: "Items on the top bar",
            hint: "The same count for the bar across the top of a message, on iPad and on the Mac. Empty fits as many as it can measure.",
            default: .text("")
        )
    ]

    /// The settings as the userscript should see them: stored value if one
    /// exists, the default otherwise.
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
    /// finds it when it starts; the WKUserScript counterpart of the Safari
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
