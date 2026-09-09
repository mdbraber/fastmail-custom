#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit

/// Command and a number picks a tab, the way a browser does, and only while
/// there are tabs to pick. The sidebar's own jump to a source, which used to
/// have these keys, moved to Option-Command and a number to make room.
@MainActor
public enum TabSwitcher {
    private static var monitor: Any?

    public static func install() {
        guard monitor == nil else { return }
        // The event is read here rather than passed on: a monitor's closure
        // belongs to no actor, and only the number needs to cross.
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            guard
                claims(event.modifierFlags),
                let digit = digit(from: event.charactersIgnoringModifiers)
            else { return event }
            return MainActor.assumeIsolated { select(digit) } ? nil : event
        }
    }

    /// True when a tab was picked, and the keystroke goes no further.
    private static func select(_ digit: Int) -> Bool {
        guard
            let group = NSApp.keyWindow?.tabGroup,
            let index = target(digit: digit, count: group.windows.count)
        else { return false }
        group.selectedWindow = group.windows[index]
        return true
    }

    /// Ours only with Command alone; Option-Command is the sidebar's. Only
    /// the four modifiers anyone holds are weighed: a number key reports the
    /// numeric keypad as well, and a strict comparison threw every press away.
    nonisolated static func claims(_ flags: NSEvent.ModifierFlags) -> Bool {
        flags.intersection([.command, .option, .control, .shift]) == .command
    }

    /// Which tab a number means, or nothing when the keystroke is not ours.
    nonisolated static func target(digit: Int, count: Int) -> Int? {
        guard count > 1, (1...9).contains(digit) else { return nil }
        // Nine is the last tab wherever it falls; the rest count from the left.
        if digit == 9 { return count - 1 }
        guard digit <= count else { return nil }
        return digit - 1
    }

    nonisolated static func digit(from characters: String?) -> Int? {
        guard
            let characters,
            characters.count == 1,
            let value = Int(characters),
            (1...9).contains(value)
        else { return nil }
        return value
    }
}
#endif
