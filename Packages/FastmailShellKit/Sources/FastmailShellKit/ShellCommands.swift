#if os(macOS)
import SwiftUI

public struct ShellCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    public init() {}

    public var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Message") {
                NotificationCenter.default.post(name: .fmshellCompose, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)
            Button("New Window") {
                openWindow(id: "main")
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])
        }
        CommandGroup(after: .toolbar) {
            Button("Reload Page") {
                NotificationCenter.default.post(name: .fmshellReload, object: nil)
            }
            .keyboardShortcut("r", modifiers: .command)
        }
        CommandGroup(after: .importExport) {
            Button("Share Message…") {
                NotificationCenter.default.post(name: .fmshellShare, object: nil)
            }
        }
    }
}
#endif
