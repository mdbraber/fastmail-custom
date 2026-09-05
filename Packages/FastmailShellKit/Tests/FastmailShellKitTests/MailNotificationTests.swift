import Foundation
import Testing
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

@Test func aNotificationWithoutAnIdOrTitleIsRefused() {
    #expect(MailNotification.parse(["title": "x"]) == nil)
    #expect(MailNotification.parse(["id": "x"]) == nil)
    #expect(MailNotification.parse(["id": "", "title": "x"]) == nil)
}

@Test func missingOptionalFieldsHaveSafeDefaults() throws {
    let notification = try #require(MailNotification.parse(["id": "M2", "title": "Bob"]))
    #expect(notification.body == "")
    #expect(notification.sound == false)
    #expect(notification.threadId == nil)
    #expect(notification.dataJSON == "{}")
}

#if os(macOS)
@Test func aNotificationIsNotShownWhileTheAppIsFrontmost() {
    #expect(NotificationPresenter.shouldPresent(appActive: true) == false)
    #expect(NotificationPresenter.shouldPresent(appActive: false) == true)
}
#endif
