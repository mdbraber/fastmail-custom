import Testing
import Foundation
@testable import FastmailShellKit

@Test func routesLogAndErrorActions() async {
    let recorded = Recorder()
    let bridge = await NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { await recorded.appendLog($0) },
        onError: { await recorded.appendError($0) }
    )
    await bridge.handle(body: ["action": "log", "payload": ["message": "hello"]])
    await bridge.handle(body: ["action": "error", "payload": ["message": "boom", "stack": "s"]])
    #expect(await recorded.logs == ["hello"])
    #expect(await recorded.errors == ["boom"])
}

@Test func routesThemeAction() async {
    let recorded = Recorder()
    let bridge = await NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onTheme: { await recorded.appendTheme($0, $1) }
    )
    let reply = await bridge.handle(body: ["action": "theme", "payload": ["color": "#d6d8da"]])
    #expect(reply.error == nil)
    #expect(await recorded.themes == ["#d6d8da"])
}

@Test func themeActionCarriesFastmailsOwnDarkFlag() async {
    let recorded = Recorder()
    let bridge = await NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onTheme: { await recorded.appendTheme($0, $1) }
    )
    let reply = await bridge.handle(body: [
        "action": "theme", "payload": ["color": "#1c1c1e", "isDark": true],
    ])
    #expect(reply.error == nil)
    #expect(await recorded.darkFlags == [true])
}

// Fastmail's log-in screen carries no theme object to ask, and its navy
// background used to be read as a dark theme. Nothing is claimed for it.
@Test func themeActionWithoutADarkFlagClaimsNothing() async {
    let recorded = Recorder()
    let bridge = await NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onTheme: { await recorded.appendTheme($0, $1) }
    )
    await bridge.handle(body: ["action": "theme", "payload": ["color": "rgb(36, 57, 89)"]])
    #expect(await recorded.darkFlags == [nil])
}

@Test func themeActionWithoutColorProducesAnError() async {
    let bridge = await NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["action": "theme", "payload": [:]])
    #expect(reply.error != nil)
}

@Test func unknownActionProducesAnError() async {
    let bridge = await NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["action": "teleport", "payload": [:]])
    #expect(reply.error?.contains("teleport") == true)
}

@Test func malformedBodyProducesAnError() async {
    let bridge = await NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["nonsense": 1])
    #expect(reply.error != nil)
}

@Test func normalizedHostStripsCaseAndATrailingDot() {
    #expect(NativeBridge.normalizedHost("App.Fastmail.Com.") == "app.fastmail.com")
    #expect(NativeBridge.normalizedHost("app.fastmail.com") == "app.fastmail.com")
    #expect(NativeBridge.normalizedHost("") == "")
}

@Test func shareWithNeitherURLNorTextProducesAnError() async {
    let bridge = await NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
    let empty = await bridge.handle(body: ["action": "share", "payload": [:]])
    #expect(empty.error != nil)
    let blank = await bridge.handle(body: ["action": "share", "payload": ["text": ""]])
    #expect(blank.error != nil)
}

@Test @MainActor func shareRepliesOnceThePresenterCompletes() async {
    var received: ShareRequest?
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onShare: { request in
            received = request
            request.completion()
        }
    )
    let reply = await bridge.handle(body: [
        "action": "share",
        "payload": [
            "url": "https://app.fastmail.com/mail/Inbox/",
            "text": "Subject line",
            "rect": ["x": 10.0, "y": 20.0, "width": 30.0, "height": 40.0]
        ]
    ])
    #expect(reply.error == nil)
    #expect(received?.url?.absoluteString == "https://app.fastmail.com/mail/Inbox/")
    #expect(received?.text == "Subject line")
    #expect(received?.sourceRect == CGRect(x: 10, y: 20, width: 30, height: 40))
    #expect(received?.items.count == 2)
}

@Test @MainActor func actionsPayloadReportsOnlyStringNames() async {
    var received: [String]?
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onActions: { names in received = names }
    )
    let reply = await bridge.handle(body: [
        "action": "actions",
        "payload": ["names": ["archive-all", 7, "snooze-until-monday"]]
    ])
    #expect(reply.error == nil)
    #expect(received == ["archive-all", "snooze-until-monday"])
}

@Test func javaScriptResultsCoerceToText() {
    #expect(IntentSupport.text(from: nil) == "")
    #expect(IntentSupport.text(from: NSNull()) == "")
    #expect(IntentSupport.text(from: "hello") == "hello")
    #expect(IntentSupport.text(from: NSNumber(value: 42)) == "42")
    #expect(IntentSupport.text(from: NSNumber(value: true)) == "1")
    #expect(IntentSupport.text(from: ["b": 2, "a": 1]) == #"{"a":1,"b":2}"#)
}

@Test func domRectParsingAcceptsBothNamingsAndRefusesEmpty() {
    #expect(
        NativeBridge.rect(fromDOMRect: ["x": 1.0, "y": 2.0, "width": 3.0, "height": 4.0]) ==
        CGRect(x: 1, y: 2, width: 3, height: 4)
    )
    #expect(
        NativeBridge.rect(fromDOMRect: ["left": 5, "top": 6, "width": 7, "height": 8]) ==
        CGRect(x: 5, y: 6, width: 7, height: 8)
    )
    #expect(NativeBridge.rect(fromDOMRect: ["x": 1.0, "y": 2.0, "width": 0.0, "height": 4.0]) == nil)
    #expect(NativeBridge.rect(fromDOMRect: ["x": 1.0, "y": 2.0]) == nil)
    #expect(NativeBridge.rect(fromDOMRect: nil) == nil)
}

actor Recorder {
    var logs: [String] = []
    var errors: [String] = []
    var themes: [String] = []
    var darkFlags: [Bool?] = []
    func appendLog(_ value: String) { logs.append(value) }
    func appendError(_ value: String) { errors.append(value) }
    func appendTheme(_ value: String, _ isDark: Bool?) {
        themes.append(value)
        darkFlags.append(isDark)
    }
}

@Test @MainActor func notifyRoutesAParsedNotification() async {
    var received: MailNotification?
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onNotify: { received = $0 }
    )
    let reply = await bridge.handle(body: ["action": "notify", "payload": [
        "id": "M1", "title": "Ada", "body": "hi", "sound": true, "data": "{}"
    ]])
    #expect(reply.error == nil)
    #expect(received?.id == "M1")
    #expect(received?.sound == true)
}

@Test @MainActor func notifyWithoutATitleIsAnError() async {
    let bridge = NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["action": "notify", "payload": ["id": "M1"]])
    #expect(reply.error != nil)
}

@Test @MainActor func dismissAndShowWindowRoute() async {
    var dismissed: [String] = []
    var shown = 0
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onDismissNotifications: { dismissed = $0 },
        onShowWindow: { shown += 1 }
    )
    _ = await bridge.handle(body: ["action": "dismissNotifications", "payload": ["ids": ["a", "b", 3]]])
    _ = await bridge.handle(body: ["action": "showWindow", "payload": [:]])
    #expect(dismissed == ["a", "b"])
    #expect(shown == 1)
}

// The page asks for a message; the app says where it put it, so that a page
// told "inline" can go ahead and open one itself.
@Test @MainActor func composeAsksTheAppAndIsToldWhereItWent() async {
    var asked: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onCompose: { mode in
            asked.append(mode)
            return mode == "default" ? "window" : mode
        }
    )
    let reply = await bridge.handle(body: [
        "action": "compose",
        "payload": ["mode": "default"]
    ])
    #expect(asked == ["default"])
    #expect(reply.value == "window")
    #expect(reply.error == nil)
}

@Test @MainActor func composeWithoutAModeIsRefused() async {
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onCompose: { _ in "window" }
    )
    let reply = await bridge.handle(body: ["action": "compose", "payload": [:]])
    #expect(reply.error != nil)
}

// The page reports the message it is showing, which titles the window and the
// Handoff banner on another device. Leaving a message reports nothing, and
// that has to arrive too, or the title outlives the message.
@Test @MainActor func subjectPayloadIsReportedAndCanBeEmpty() async {
    var received: [String?] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onSubject: { received.append($0) }
    )
    let reply = await bridge.handle(body: [
        "action": "subject", "payload": ["title": "Dinner on Friday"],
    ])
    await bridge.handle(body: ["action": "subject", "payload": [:]])
    #expect(reply.error == nil)
    #expect(received == ["Dinner on Friday", nil])
}
