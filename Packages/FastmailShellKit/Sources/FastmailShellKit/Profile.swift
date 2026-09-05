import Foundation

public struct Profile: Equatable, Sendable {
    public let id: String
    public let displayName: String
    public let startURL: URL
    public let overlayScriptName: String?
    public let urlScheme: String
    public let accountID: String?
    public let handoffScheme: String?
    /// Which server this profile is pointed at. Carried rather than looked up
    /// so the pieces that build addresses — compose, link routing, the host
    /// the bridge expects — cannot disagree with the page that is actually
    /// loaded, whatever the defaults say by the time they are asked.
    public let backend: Backend

    public init(
        id: String,
        displayName: String,
        startURL: URL,
        overlayScriptName: String?,
        urlScheme: String,
        accountID: String?,
        handoffScheme: String? = nil,
        backend: Backend = .production
    ) {
        self.id = id
        self.displayName = displayName
        self.startURL = startURL
        self.overlayScriptName = overlayScriptName
        self.urlScheme = urlScheme
        self.accountID = accountID
        self.handoffScheme = handoffScheme
        self.backend = backend
    }

    /// The same profile pointed at another server.
    public func on(_ backend: Backend) -> Profile {
        Profile(
            id: id,
            displayName: displayName,
            startURL: startURL,
            overlayScriptName: overlayScriptName,
            urlScheme: urlScheme,
            accountID: accountID,
            handoffScheme: handoffScheme,
            backend: backend
        )
    }

    /// The address to open, which is two settings at once: the backend says
    /// which server, the start view says which page on it. `startURL` is the
    /// profile's own default and stands in for the second when it is unset.
    public func startURL(readingFrom defaults: UserDefaults) -> URL {
        let backend = Backend.current(defaults)
        return StartView.resolve(
            defaults.string(forKey: StartView.defaultsKey),
            default: startURL,
            backend: backend
        )
    }

    /// The host the page will be on, which is what the native bridge is told
    /// to expect and what the injected harness is gated to.
    public func host(readingFrom defaults: UserDefaults) -> String {
        Backend.current(defaults).host
    }
}

extension Profile {
    public static func personal(accountID: String?) -> Profile {
        Profile(
            id: "personal",
            displayName: "mdbraber.com",
            startURL: URL(string: "https://app.fastmail.com/")!,
            overlayScriptName: "userscript.personal.js",
            urlScheme: "fastmail-personal",
            accountID: normalizedAccountID(accountID),
            handoffScheme: "fastmail-work"
        )
    }

    public static func work(accountID: String?) -> Profile {
        Profile(
            id: "work",
            displayName: "nexthealth.nl",
            startURL: URL(string: "https://app.fastmail.com/")!,
            overlayScriptName: "userscript.work.js",
            urlScheme: "fastmail-work",
            accountID: normalizedAccountID(accountID),
            handoffScheme: "fastmail-personal"
        )
    }

    public static func accountID(from bundle: Bundle) -> String? {
        normalizedAccountID(bundle.object(forInfoDictionaryKey: "FMAccountID") as? String)
    }

    static func normalizedAccountID(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // Empty, an unsubstituted build setting, or the example placeholder all
        // mean "not configured". Treat them as absent so the compose URL omits
        // u= and Fastmail opens the app's active account, rather than pointing
        // at a bogus account and landing on the account picker.
        guard !trimmed.isEmpty,
              !trimmed.hasPrefix("$("),
              trimmed != "replace-me"
        else { return nil }
        return trimmed
    }
}
