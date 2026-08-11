import Foundation

public struct Profile: Equatable, Sendable {
    public let id: String
    public let displayName: String
    public let startURL: URL
    public let overlayScriptName: String?
    public let urlScheme: String
    public let accountID: String?

    public init(
        id: String,
        displayName: String,
        startURL: URL,
        overlayScriptName: String?,
        urlScheme: String,
        accountID: String?
    ) {
        self.id = id
        self.displayName = displayName
        self.startURL = startURL
        self.overlayScriptName = overlayScriptName
        self.urlScheme = urlScheme
        self.accountID = accountID
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
            accountID: normalizedAccountID(accountID)
        )
    }

    public static func work(accountID: String?) -> Profile {
        Profile(
            id: "work",
            displayName: "nexthealth.nl",
            startURL: URL(string: "https://app.fastmail.com/")!,
            overlayScriptName: "userscript.work.js",
            urlScheme: "fastmail-work",
            accountID: normalizedAccountID(accountID)
        )
    }

    public static func accountID(from bundle: Bundle) -> String? {
        normalizedAccountID(bundle.object(forInfoDictionaryKey: "FMAccountID") as? String)
    }

    static func normalizedAccountID(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("$(") else { return nil }
        return trimmed
    }
}
