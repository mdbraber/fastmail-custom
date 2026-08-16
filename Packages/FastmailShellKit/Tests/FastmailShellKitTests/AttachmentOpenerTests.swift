import Foundation
import Testing
import UniformTypeIdentifiers
@testable import FastmailShellKit

private func bytes(_ text: String) -> Data { Data(text.utf8) }

@Test func theAllowlistAdmitsPDFAndImages() {
    #expect(AttachmentOpener.shouldAutoOpen(data: bytes("%PDF-1.7 rest"), enabled: true))
    #expect(AttachmentOpener.shouldAutoOpen(data: Data([0x89, 0x50, 0x4E, 0x47, 0]), enabled: true))
    #expect(AttachmentOpener.shouldAutoOpen(data: Data([0xFF, 0xD8, 0xFF, 0xE0]), enabled: true))
    #expect(AttachmentOpener.shouldAutoOpen(data: bytes("GIF89a..."), enabled: true))
    #expect(AttachmentOpener.shouldAutoOpen(data: bytes("{\\rtf1 hello}"), enabled: true))
    #expect(AttachmentOpener.shouldAutoOpen(data: bytes("BEGIN:VCALENDAR\nEND:VCALENDAR"), enabled: true))
}

@Test func archivesDiskImagesAndExecutablesAreRefused() {
    let zip = Data([0x50, 0x4B, 0x03, 0x04, 0, 0])
    let macho = Data([0xCF, 0xFA, 0xED, 0xFE, 0, 0])
    let elf = Data([0x7F, 0x45, 0x4C, 0x46, 0, 0])
    #expect(!AttachmentOpener.shouldAutoOpen(data: zip, enabled: true))
    #expect(!AttachmentOpener.shouldAutoOpen(data: macho, enabled: true))
    #expect(!AttachmentOpener.shouldAutoOpen(data: elf, enabled: true))
}

@Test func theSettingOffRefusesEverything() {
    #expect(!AttachmentOpener.shouldAutoOpen(data: bytes("%PDF-1.7"), enabled: false))
}

@Test func aSpoofedExtensionDoesNotMatterBecauseOnlyContentIsSniffed() {
    let zipPretendingToBePDF = Data([0x50, 0x4B, 0x03, 0x04]) + bytes("...evil.pdf...")
    #expect(AttachmentOpener.sniffedType(of: zipPretendingToBePDF) == nil)
    #expect(!AttachmentOpener.shouldAutoOpen(data: zipPretendingToBePDF, enabled: true))
}

@Test func binaryGarbageIsNotPlausibleText() {
    #expect(!AttachmentOpener.isPlausibleText(Data([0x00, 0x01, 0x02])))
    #expect(AttachmentOpener.isPlausibleText(bytes("just some notes\n")))
}
