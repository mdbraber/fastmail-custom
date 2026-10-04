#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import Testing
@testable import FastmailShellKit

@Test @MainActor func nothingIsSaidWhenEveryFileWasAttached() {
    #expect(ComposeAttachments.notAttachedMessage([]) == nil)
}

@Test @MainActor func oneFileIsNamedOnItsOwn() {
    #expect(ComposeAttachments.notAttachedMessage(["report.pdf"]) == "Could not attach report.pdf.")
}

@Test @MainActor func severalFilesAreCountedAndNamedInOrder() {
    #expect(
        ComposeAttachments.notAttachedMessage(["a.pdf", "b.png", "c.zip"])
            == "Could not attach 3 files: a.pdf, b.png, c.zip"
    )
}
#endif
