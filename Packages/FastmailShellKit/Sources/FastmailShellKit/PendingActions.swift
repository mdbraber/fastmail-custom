import Combine
import Foundation

/// A page action handed in from outside the view tree, a home screen
/// shortcut, for AppShell to pass on once there is a page to ask.
///
/// The sibling of PendingLinks, and for the same reason: a shortcut can be
/// what launches the app, so what it asks for has to wait somewhere until
/// there is a web view to ask. Links go one way, things the page has to do
/// itself the other; search is one, because Fastmail has no address for it.
@MainActor
public final class PendingActions: ObservableObject {
    public static let shared = PendingActions()

    @Published public var name: String?

    public init() {}

    public func run(_ name: String) {
        self.name = name
    }

    /// Only clears when there was something to take: `onAppear` asks on every
    /// appearance, and publishing a change to nothing would be a change.
    public func take() -> String? {
        guard let taken = name else { return nil }
        name = nil
        return taken
    }
}
