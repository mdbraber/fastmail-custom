import Combine
import Foundation

/// A link handed in from outside the view tree, a tapped notification,
/// for AppShell to route as if it had arrived through onOpenURL.
@MainActor
public final class PendingLinks: ObservableObject {
    public static let shared = PendingLinks()

    @Published public var url: URL?

    public init() {}

    public func open(_ url: URL) {
        self.url = url
    }

    /// Only clears when there was something to take: `onAppear` asks on every
    /// appearance, and publishing a change to nothing would be a change.
    public func take() -> URL? {
        guard let taken = url else { return nil }
        url = nil
        return taken
    }
}
