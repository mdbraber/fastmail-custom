import Combine
import Foundation

/// A link handed in from outside the view tree — a tapped notification —
/// for AppShell to route as if it had arrived through onOpenURL.
@MainActor
public final class PendingLinks: ObservableObject {
    public static let shared = PendingLinks()

    @Published public var url: URL?

    public init() {}

    public func open(_ url: URL) {
        self.url = url
    }

    public func take() -> URL? {
        defer { url = nil }
        return url
    }
}
