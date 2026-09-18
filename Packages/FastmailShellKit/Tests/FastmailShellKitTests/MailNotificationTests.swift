import Foundation
import Testing
#if os(macOS)
import AppKit
#endif
@testable import FastmailShellKit

@Test func aNotificationParsesFromTheBridgePayload() throws {
    let payload: [String: Any] = [
        "id": "M1", "title": "Ada", "body": "Re: engine", "sound": true,
        "threadId": "T1", "data": "{\"emailId\":\"M1\"}"
    ]
    let notification = try #require(MailNotification.parse(payload))
    #expect(notification.id == "M1")
    #expect(notification.title == "Ada")
    #expect(notification.body == "Re: engine")
    #expect(notification.sound == true)
    #expect(notification.threadId == "T1")
    #expect(notification.dataJSON == "{\"emailId\":\"M1\"}")
}

// With previews on, the subject moves up to the subtitle and the start of the
// text becomes the body; off, or with no text, Fastmail's words stand alone
@Test func aPreviewIsShownOnlyWhenPreviewsAreOn() throws {
    let notification = try #require(MailNotification.parse([
        "id": "M1", "title": "Ada", "body": "Engines", "subject": "Engines", "preview": "Dear Charles, the engine works."
    ]))
    #expect(notification.lines(previews: true) == ("Engines", "Dear Charles, the engine works."))
    #expect(notification.lines(previews: false) == ("", "Engines"))

    let untitled = try #require(MailNotification.parse([
        "id": "M2", "title": "Ada", "body": "New message", "subject": "", "preview": "Hello"
    ]))
    #expect(untitled.lines(previews: true) == ("(no subject)", "Hello"))

    let textless = try #require(MailNotification.parse(["id": "M3", "title": "Ada", "body": "Engines"]))
    #expect(textless.lines(previews: true) == ("", "Engines"))
}

@Test func aNotificationWithoutAnIdOrTitleIsRefused() {
    #expect(MailNotification.parse(["title": "x"]) == nil)
    #expect(MailNotification.parse(["id": "x"]) == nil)
    #expect(MailNotification.parse(["id": "", "title": "x"]) == nil)
}

@Test func missingOptionalFieldsHaveSafeDefaults() throws {
    let notification = try #require(MailNotification.parse(["id": "M2", "title": "Bob"]))
    #expect(notification.subject == "")
    #expect(notification.preview == "")
    #expect(notification.body == "")
    #expect(notification.sound == false)
    #expect(notification.threadId == nil)
    #expect(notification.dataJSON == "{}")
}

// One message reported twice, by Fastmail's own notification and by the
// page script's fallback, or by two windows, shows once
@Test func aMessageIdIsShownOnceWithinTheHour() {
    var recent = RecentNotificationIds()
    let start = Date(timeIntervalSince1970: 1_000_000)
    #expect(recent.isRepeat("M1", now: start) == false)
    #expect(recent.isRepeat("M1", now: start.addingTimeInterval(5)) == true)
    #expect(recent.isRepeat("M2", now: start.addingTimeInterval(5)) == false)
    #expect(recent.isRepeat("M1", now: start.addingTimeInterval(RecentNotificationIds.window + 1)) == false)
}

// A 1×1 PNG
private let pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

@Test func aNotificationCarriesTheSendersPictureFromItsIcon() throws {
    let notification = try #require(MailNotification.parse([
        "id": "M1", "title": "Ada", "icon": "data:image/png;base64," + pngBase64
    ]))
    let image = try #require(notification.image)
    #expect(image.mediaType == "image/png")
    #expect(image.data == Data(base64Encoded: pngBase64))
}

@Test func onlyASmallBase64ImageIsTakenAsAPicture() throws {
    let refused = [
        "https://example.com/avatar.png",
        "/static/favicons/FM-Notification-Icon-196.png",
        "data:text/html;base64,PGI+aGk8L2I+",
        "data:image/png,not-base64",
        "data:image/png;base64,",
        "data:image/png;base64," + String(repeating: "A", count: NotificationImage.maxBytes / 3 * 4 + 8)
    ]
    for icon in refused {
        let notification = try #require(MailNotification.parse(["id": "M1", "title": "Ada", "icon": icon]))
        #expect(notification.image == nil, "\(icon.prefix(40))")
    }
    #expect(NotificationImage.parse(dataURL: "data:IMAGE/SVG+XML;BASE64,PHN2Zy8+")?.mediaType == "image/svg+xml")
}

#if os(macOS)
@Test func aPictureBecomesAFileANotificationCanAttach() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }

    let png = try #require(NotificationImage.parse(dataURL: "data:image/png;base64," + pngBase64))
    let pngFile = try #require(NotificationImageFile.write(png, into: directory))
    #expect(pngFile.pathExtension == "png")
    #expect(try Data(contentsOf: pngFile) == png.data)

    // A BIMI logo is SVG, which an attachment does not take: drawn as a PNG
    let svg = #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="100" height="50" fill="red"/></svg>"#
    let logo = NotificationImage(mediaType: "image/svg+xml", data: Data(svg.utf8))
    let logoFile = try #require(NotificationImageFile.write(logo, into: directory))
    #expect(logoFile.pathExtension == "png")
    let drawn = try #require(NSBitmapImageRep(data: try Data(contentsOf: logoFile)))
    #expect(drawn.pixelsWide == 212)
    #expect(drawn.pixelsHigh == 106)

    // Not an image, whatever it says
    #expect(NotificationImageFile.write(NotificationImage(mediaType: "image/png", data: Data("hello".utf8)), into: directory) == nil)
}

@Test func aNotificationIsNotShownWhileTheAppIsFrontmost() {
    #expect(NotificationPresenter.shouldPresent(appActive: true) == false)
    #expect(NotificationPresenter.shouldPresent(appActive: false) == true)
}
#endif
