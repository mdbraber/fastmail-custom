#if os(macOS)
import SwiftUI
import Testing
@testable import FastmailShellKit

// The menu Fastmail's desktop module hands to Electron, as the live page
// built it, with the app switch its module puts ahead of View
private func fastmailsMenu() -> [String: Any] { [
    "file": [
        ["label": "Compose", "enabled": true, "accelerator": "CommandOrControl+N", "action": "goCompose"],
        ["label": "New event", "action": "createEvent"],
        ["label": "New contact", "action": "createContact"],
        ["label": "New Masked Email address", "action": "createMaskedEmail"],
        ["type": "separator"],
        ["role": "close"],
        ["type": "separator"],
        ["label": "Export as PDF…", "enabled": false, "action": "printToPDF"],
        ["type": "separator"],
        ["label": "Print", "enabled": false, "accelerator": "CommandOrControl+P", "action": "print"]
    ],
    "edit": [["role": "cut"]],
    "view": [
        ["label": "Mail", "type": "radio", "action": "goMail", "accelerator": "CommandOrControl+1", "checked": true, "enabled": true],
        ["label": "Contacts", "type": "radio", "action": "goContacts", "accelerator": "CommandOrControl+2", "checked": false],
        ["type": "separator"],
        ["label": "Go to…", "action": "goFolderFilter", "accelerator": "Shift+CommandOrControl+O"],
        ["type": "separator"],
        ["label": "Show reading pane", "type": "checkbox", "checked": true, "accelerator": "Control+Meta+V", "action": "toggleReadingPane"],
        ["label": "Show message previews", "type": "checkbox", "checked": false, "action": "togglePreview"],
        ["type": "separator"],
        ["role": "togglefullscreen"]
    ],
    "about": [["label": "Check for updates", "action": "checkUpdate"]]
] }

@Test func fileLeavesComposeAndCloseToTheAppAndPrintingApart() {
    let menu = PageMenu.parse(fastmailsMenu())
    #expect(menu.fileItems.map(\.title) == ["New Event", "New Contact", "New Masked Email Address"])
    #expect(menu.fileItems.map(\.action) == ["createEvent", "createContact", "createMaskedEmail"])
    #expect(menu.printItems.map(\.title) == ["Export As PDF…", "Print"])
    #expect(menu.printItems.allSatisfy { !$0.isEnabled })
    #expect(menu.printItems.last?.shortcut == PageMenuShortcut(key: "p", modifiers: .command))
}

@Test func viewKeepsTheAppSwitchAndChecksAndDropsElectronsOwnFullScreen() {
    let items = PageMenu.parse(fastmailsMenu()).viewItems
    #expect(items.map(\.title) == [
        "Mail", "Contacts", "", "Go To…", "", "Show Reading Pane", "Show Message Previews"
    ])
    #expect(items[0].kind == .toggle(isOn: true))
    #expect(items[1].kind == .toggle(isOn: false))
    #expect(items[2].kind == .separator)
    #expect(items[0].shortcut == PageMenuShortcut(key: "1", modifiers: .command))
    #expect(items[3].shortcut == PageMenuShortcut(key: "o", modifiers: [.command, .shift]))
    #expect(items[5].shortcut == PageMenuShortcut(key: "v", modifiers: [.command, .control]))
    #expect(items[6].shortcut == nil)
}

@Test func acceleratorsTheMenuCannotShowAreLeftOff() {
    #expect(PageMenuShortcut.parse("CommandOrControl+Plus") == nil)
    #expect(PageMenuShortcut.parse("Hyper+K") == nil)
    #expect(PageMenuShortcut.parse("") == nil)
    #expect(PageMenuShortcut.parse("Alt+CmdOrCtrl+K") == PageMenuShortcut(key: "k", modifiers: [.command, .option]))
}

@Test func nothingUsableMakesAnEmptyMenu() {
    let menu = PageMenu.parse(["file": [["type": "separator"], ["role": "quit"], ["label": "No action"]], "view": "nonsense"])
    #expect(menu.fileItems.isEmpty)
    #expect(menu.printItems.isEmpty)
    #expect(menu.viewItems.isEmpty)
}

@Test func exportedFilesAreNamedAfterTheMessage() {
    #expect(PagePrinter.fileName(for: "Re: Plans 2026/2027") == "Re- Plans 2026-2027.pdf")
    #expect(PagePrinter.fileName(for: "  ") == "Message.pdf")
    #expect(PagePrinter.fileName(for: nil) == "Message.pdf")
}
#endif
