#if os(macOS)
import SwiftUI

public struct ShellCommands: Commands {
    public init() {}

    public var body: some Commands {
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
