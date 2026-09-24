import Combine
import Foundation

/// A link handed in from outside the view tree, a tapped notification,
/// for AppShell to route as if it had arrived through onOpenURL. A mail
/// notification also carries `message`, the EmailPush that Fastmail's own
/// `openMessage` reads, so the tap opens through its goMessage rather than a
/// step that an idle window's stale store cannot show.
public struct PendingLink: Equatable, Sendable {
    public let url: URL
    public let message: String?

    public init(url: URL, message: String? = nil) {
        self.url = url
        self.message = message
    }
}

@MainActor
public final class PendingLinks: ObservableObject {
    public static let shared = PendingLinks()

    @Published public var url: URL?
    /// The EmailPush beside the last-opened url, set for a mail notification.
    /// Read out with the url in `take`; nothing for any other link.
    public private(set) var message: String?

    public init() {}

    public func open(_ url: URL, message: String? = nil) {
        // Set before the published url, so an observer that takes on the change
        // finds the message already there.
        self.message = message
        self.url = url
    }

    /// Only clears when there was something to take: `onAppear` asks on every
    /// appearance, and publishing a change to nothing would be a change.
    public func take() -> PendingLink? {
        guard let url else { return nil }
        let taken = PendingLink(url: url, message: message)
        self.url = nil
        message = nil
        return taken
    }
}
