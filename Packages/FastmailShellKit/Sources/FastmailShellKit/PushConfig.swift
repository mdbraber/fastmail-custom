import Foundation

/// Where this app registers for pushes, read from Info.plist the way the
/// account id is.
public struct PushConfig: Equatable, Sendable {
    public let server: URL
    public let secret: String

    public init?(host rawHost: String?, secret rawSecret: String?) {
        guard
            let host = Profile.configuredValue(rawHost),
            let secret = Profile.configuredValue(rawSecret),
            !host.contains("://"),
            let server = URL(string: "https://" + host),
            server.host != nil
        else { return nil }
        self.server = server
        self.secret = secret
    }

    public static func from(bundle: Bundle) -> PushConfig? {
        PushConfig(
            host: bundle.object(forInfoDictionaryKey: "FMPushHost") as? String,
            secret: bundle.object(forInfoDictionaryKey: "FMPushSecret") as? String
        )
    }

    /// Which account the server files this device under: the last part of the
    /// bundle identifier, `personal` or `work`.
    public static func account(forBundleIdentifier identifier: String?) -> String? {
        guard let last = identifier?.split(separator: ".").last else { return nil }
        let name = String(last)
        return name == "personal" || name == "work" ? name : nil
    }

    /// The device token as the server files it, and as the Notifications page
    /// shows it: lowercase hex.
    public static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }

    /// Registering again is also how the device changes its mind. `notify` is
    /// the choice; `alerts` says the same as on or off, for a server that
    /// predates `notify` and reads only `alerts`.
    public func registration(
        account: String,
        deviceToken: Data,
        choice: NotificationChoice = NotificationChoice(mode: .inbox)
    ) -> URLRequest {
        var request = URLRequest(url: server.appendingPathComponent("devices"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "account": account,
            "token": Self.hex(deviceToken),
            "alerts": choice.mode != .off,
            "notify": choice.jsonObject,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request
    }

    /// The `contacts` flag of a registration reply, or nothing when the reply
    /// carries no such flag (a server from before it) or is not JSON. Only a
    /// real boolean counts: a JSON 1 is a number, not a flag.
    public static func contacts(fromRegistrationReply data: Data) -> Bool? {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let number = object["contacts"] as? NSNumber,
            CFGetTypeID(number as CFTypeRef) == CFBooleanGetTypeID()
        else { return nil }
        return number.boolValue
    }

    /// A button on a notification, done by the server on this device's behalf.
    public func action(_ action: String, account: String, emailId: String) -> URLRequest {
        var request = URLRequest(url: server.appendingPathComponent("actions"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["account": account, "action": action, "emailId": emailId]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return request
    }
}
