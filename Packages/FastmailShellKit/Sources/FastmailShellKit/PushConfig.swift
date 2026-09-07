import Foundation

/// Where this app registers for pushes, read from Info.plist the way the
/// account id is. A host rather than a URL, because `//` starts a comment
/// in the xcconfig it comes from; the scheme is always https.
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

    /// Which account the server files this device under: the last part of
    /// the bundle identifier, `personal` or `work`. An extension's identifier
    /// ends in something else and gets nothing.
    public static func account(forBundleIdentifier identifier: String?) -> String? {
        guard let last = identifier?.split(separator: ".").last else { return nil }
        let name = String(last)
        return name == "personal" || name == "work" ? name : nil
    }

    public func registration(account: String, deviceToken: Data) -> URLRequest {
        var request = URLRequest(url: server.appendingPathComponent("devices"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["account": account, "token": token])
        return request
    }
}
