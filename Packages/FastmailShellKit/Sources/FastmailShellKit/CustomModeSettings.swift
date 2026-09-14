import Foundation
import WebKit

/// The Custom mode userscript's settings, mirrored natively.
public enum CustomModeSettings {
    /// Where every Custom mode setting lives in UserDefaults. Prefixed so the
    /// shell's own keys (backend, startView, push.mode, push.senders,
    /// push.mailboxIds, push.contacts and push.acknowledged) and the page's
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

    /// The badge label as the app has it before the page has ever run.
    /// The one default Swift still carries, because HomeShortcuts builds the
    /// home-screen menu from it at launch.
    public static let badgeLabelDefault = "Triage"

    /// The settings as the userscript should see them: everything stored
    /// under the namespace, with the prefix taken off.
    ///
    /// Swift holds no list of the options — the userscript's catalogue is
    /// canonical — so this collects a namespace rather than walking a table.
    /// A key the page has stopped using travels one more time and is ignored;
    /// a key Swift has never heard of travels correctly the first time.
    /// Defaults are not filled in here: the page merges its own.
    public static func current(from defaults: UserDefaults = .standard) -> [String: Any] {
        var settings: [String: Any] = [:]
        for (key, value) in defaults.dictionaryRepresentation() where key.hasPrefix(keyPrefix) {
            let bare = String(key.dropFirst(keyPrefix.count))
            guard isWritableSettingKey(bare) else { continue }
            if let number = value as? NSNumber,
               CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID() {
                settings[bare] = number.boolValue
            } else if let text = value as? String {
                settings[bare] = text
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

    /// What tells the page that its host can sync these settings, and
    /// whether the host's switch is on. Nothing where no sync component was
    /// installed, so the page draws no switch there.
    static func syncLine(_ syncEnabled: Bool?) -> String {
        guard let syncEnabled else { return "" }
        return "\nwindow.__customModeSync = {\"enabled\":\(syncEnabled)};"
    }

    /// Writes the settings global before anything else runs, so the payload
    /// finds it when it starts; the WKUserScript counterpart of the Safari
    /// extension injecting settings ahead of its payload.
    @MainActor
    public static func bootstrapScript(
        from defaults: UserDefaults = .standard,
        syncEnabled: Bool? = nil
    ) -> WKUserScript {
        WKUserScript(
            source: "window.__customModeSettings = \(json(from: defaults));" + syncLine(syncEnabled),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    }

    /// Pushes the settings into a page that is already running. The globals
    /// are refreshed as well so a payload injected later still reads the
    /// latest, and the sync switch's state is in place before the page is
    /// told to apply.
    public static func applyScriptSource(
        from defaults: UserDefaults = .standard,
        syncEnabled: Bool? = nil
    ) -> String {
        """
        window.__customModeSettings = \(json(from: defaults));\(syncLine(syncEnabled))
        if (window.customMode) window.customMode.applySettings(window.__customModeSettings);
        """
    }
}
