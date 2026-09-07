import Foundation

/// The one notification choice the shell offers on the phone: alerts for
/// new mail on this device, or none. The badge is not part of it; a muted
/// device still gets its count. The server only hears about the switch
/// through a registration, so the app also remembers what it last told
/// the server, and a difference means registering again.
public enum PushPreferences {
    /// Shared with the Settings bundle and the in-app sheet.
    public static let alertsKey = "push.alerts"
    static let acknowledgedKey = "push.alertsAcknowledged"

    public static func alertsEnabled(in defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: alertsKey) as? Bool ?? true
    }

    /// Whether the server's idea of this device is stale: nothing was ever
    /// acknowledged, or the switch moved since.
    public static func registrationDue(in defaults: UserDefaults = .standard) -> Bool {
        guard let acknowledged = defaults.object(forKey: acknowledgedKey) as? Bool else { return true }
        return acknowledged != alertsEnabled(in: defaults)
    }

    /// Called once the server answered a registration carrying `alerts`.
    public static func acknowledge(alerts: Bool, in defaults: UserDefaults = .standard) {
        defaults.set(alerts, forKey: acknowledgedKey)
    }
}
