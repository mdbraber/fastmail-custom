import Foundation

/// Apple's Handoff: the page open here offered to the same app on another
/// device, and to a browser on a device that does not have the app.
///
/// Named for the system feature rather than `handoff`, which in this project
/// already means passing a link to the other account's app.
public enum Continuity {
    /// The key the address travels under, so a continued activity carries the
    /// page even where `webpageURL` is dropped.
    static let urlKey = "url"

    /// One activity type per app, hung off its bundle identifier, so the
    /// personal app continues the personal app and never the work one. The
    /// same string is listed in Info.plist under NSUserActivityTypes; a device
    /// only offers an activity the receiving app has claimed.
    public static func activityType(bundleID: String?) -> String? {
        guard
            let trimmed = bundleID?.trimmingCharacters(in: .whitespacesAndNewlines),
            !trimmed.isEmpty
        else { return nil }
        return trimmed + ".browse"
    }

    /// The address worth handing over, or nothing. A blank view between loads,
    /// a login sent elsewhere and this app's own scheme are all pages another
    /// device cannot usefully take over.
    public static func advertised(_ url: URL?) -> URL? {
        guard
            let url,
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            components.scheme?.lowercased() == "https",
            LinkRouter.isFastmailHost(components.host)
        else { return nil }
        // The marker that says a link was passed between the two accounts is a
        // message to this app, not part of the page's address.
        let kept = (components.queryItems ?? []).filter { $0.name != "handoff" }
        components.queryItems = kept.isEmpty ? nil : kept
        return components.url
    }

    public static func describe(_ activity: NSUserActivity, url: URL, title: String?) {
        activity.webpageURL = url
        activity.title = title
        activity.userInfo = [urlKey: url.absoluteString]
        activity.requiredUserInfoKeys = [urlKey]
        activity.isEligibleForHandoff = true
    }

    public static func target(of activity: NSUserActivity) -> URL? {
        let carried = (activity.userInfo?[urlKey] as? String).flatMap(URL.init(string:))
        return advertised(carried ?? activity.webpageURL)
    }

    /// What the Handoff banner reads. The page's own subject when it has one,
    /// so the other device offers the message by name.
    public static func title(subject: String?, fallback: String) -> String {
        let trimmed = subject?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? fallback : trimmed
    }
}
