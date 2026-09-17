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

// MARK: The setting action

private func settingsDefaults(_ name: String) -> UserDefaults {
    let suite = "NativeBridgeTests.\(name)"
    let defaults = UserDefaults(suiteName: suite)!
    defaults.removePersistentDomain(forName: suite)
    return defaults
}

@Test @MainActor func settingActionWritesABooleanAndAString() async {
    let defaults = settingsDefaults(#function)
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetting: { key, value in defaults.set(value, forKey: FastmailCustomSettings.defaultsKey(for: key)) }
    )
    let first = await bridge.handle(body: [
        "action": "setting", "payload": ["key": "labelColours", "value": false],
    ])
    let second = await bridge.handle(body: [
        "action": "setting", "payload": ["key": "triageLabel", "value": "Todo"],
    ])
    #expect(first.error == nil)
    #expect(second.error == nil)
    #expect(defaults.object(forKey: "fastmailCustom.labelColours") as? Bool == false)
    #expect(defaults.string(forKey: "fastmailCustom.triageLabel") == "Todo")
}

// The prefix is the whole guard: whatever the page sends lands under
// fastmailCustom., a namespace nothing else uses, so a key that happens to spell
// a shell setting writes a Fastmail Custom one and leaves the shell alone.
@Test @MainActor func settingActionCannotReachAShellSetting() async {
    let defaults = settingsDefaults(#function)
    defaults.set("production", forKey: Backend.defaultsKey)
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetting: { key, value in defaults.set(value, forKey: FastmailCustomSettings.defaultsKey(for: key)) }
    )
    let reply = await bridge.handle(body: [
        "action": "setting", "payload": ["key": "backend", "value": "beta"],
    ])
    #expect(reply.error == nil)
    #expect(defaults.string(forKey: Backend.defaultsKey) == "production")
    #expect(defaults.string(forKey: "fastmailCustom.backend") == "beta")
}

// A dot would let a key path out of the namespace, so it is refused before
// anything is written; so is anything else that is not letters and digits.
@Test @MainActor func settingActionRefusesAKeyThatIsNotPlain() async {
    var written: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetting: { key, _ in written.append(key) }
    )
    for key in ["push.alerts", "1st", "has space", "has-hyphen", "", "fastmailCustom.triageLabel"] {
        let reply = await bridge.handle(body: [
            "action": "setting", "payload": ["key": key, "value": "x"],
        ])
        #expect(reply.error != nil, "\(key) should be refused")
    }
    #expect(written.isEmpty)
}

// JavaScript's 1 and true both cross the bridge as an NSNumber, and a number
// stored where a flag belongs reads back as true. Only a real boolean counts.
@Test @MainActor func settingActionRefusesAValueThatIsNeitherFlagNorText() async {
    var written: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetting: { key, _ in written.append(key) }
    )
    // 1 and 0 are boxed as NSNumber deliberately: a bare Swift Int literal in
    // an Any array is not the object real bridge traffic hands over, and the
    // naive `as? Bool` this guard replaces only misfires on an actual
    // NSNumber, so a bare literal would pass whether the guard is right or not.
    for value in [NSNumber(value: 1), NSNumber(value: 0), 2.5, ["a"], [:] as [String: String]] as [Any] {
        let reply = await bridge.handle(body: [
            "action": "setting", "payload": ["key": "labelColours", "value": value],
        ])
        #expect(reply.error != nil)
    }
    let missing = await bridge.handle(body: ["action": "setting", "payload": ["key": "labelColours"]])
    #expect(missing.error != nil)
    #expect(written.isEmpty)
}

// MARK: The Notifications page

private func replyObject(_ reply: BridgeReply) throws -> [String: Any] {
    let text = try #require(reply.value)
    return try #require(JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
}

// A reply carries a string, so the state travels as JSON text the harness parses
@Test @MainActor func notificationStateAnswersTheAppsStateAsJSON() async throws {
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onNotificationState: {
            NotificationState(
                choice: NotificationChoice(mode: .important),
                permission: .undetermined, pushToken: nil, contacts: true
            )
        }
    )
    let reply = await bridge.handle(body: ["action": "notificationState", "payload": [:]])
    #expect(reply.error == nil)
    let object = try replyObject(reply)
    #expect(object["mode"] as? String == "important")
    #expect(object["permission"] as? String == "undetermined")
    #expect(object["pushToken"] is NSNull)
    #expect(object["contacts"] as? Bool == true)
}

// The Mac passes no handlers: the page never asks there, and if it did it
// would be told no rather than handed a made-up state
@Test @MainActor func withoutHandlersTheNotificationActionsAreRefused() async {
    let bridge = NativeBridge(expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in })
    let state = await bridge.handle(body: ["action": "notificationState", "payload": [:]])
    let set = await bridge.handle(body: ["action": "setNotifications", "payload": ["mode": "off"]])
    #expect(state.error != nil)
    #expect(set.error != nil)
}

@Test @MainActor func setNotificationsSavesTheParsedChoiceAndAnswersWhatWasSaved() async throws {
    var saved: [NotificationChoice] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetNotifications: { choice in
            saved.append(choice)
            return choice
        }
    )
    let reply = await bridge.handle(body: [
        "action": "setNotifications",
        "payload": ["mode": "custom", "senders": "contacts", "mailboxIds": ["P2F"]],
    ])
    #expect(reply.error == nil)
    #expect(saved == [NotificationChoice(mode: .custom, senders: .contacts, mailboxIds: ["P2F"])])
    let object = try replyObject(reply)
    #expect(object["mode"] as? String == "custom")
    #expect(object["mailboxIds"] as? [String] == ["P2F"])
}

@Test @MainActor func setNotificationsRefusesABadChoiceBeforeSavingAnything() async {
    var saved = 0
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSetNotifications: { choice in
            saved += 1
            return choice
        }
    )
    let payloads: [[String: Any]] = [
        [:],
        ["mode": "loud"],
        ["mode": "custom", "senders": "friends"],
        ["mode": "custom", "mailboxIds": [""]],
    ]
    for payload in payloads {
        let reply = await bridge.handle(body: ["action": "setNotifications", "payload": payload])
        #expect(reply.error?.hasPrefix("setNotifications: ") == true)
    }
    #expect(saved == 0)
}

@Test @MainActor func openNotificationSettingsReachesTheApp() async {
    var opened = 0
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onOpenNotificationSettings: { opened += 1 }
    )
    let reply = await bridge.handle(body: ["action": "openNotificationSettings", "payload": [:]])
    #expect(reply.error == nil)
    #expect(reply.value == nil)
    #expect(opened == 1)
}

// MARK: Settings sync

@Test @MainActor func accountActionHandsOnAValidAccountId() async {
    var reported: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onAccount: { reported.append($0) }
    )
    let reply = await bridge.handle(body: ["action": "account", "payload": ["accountId": "u1234abcd"]])
    #expect(reply.error == nil)
    #expect(reported == ["u1234abcd"])
}

// The id becomes part of every store key, so anything that could not be one
// is refused before the app hears of it
@Test @MainActor func accountActionRefusesEmptyOverlongAndBadlyFormedIds() async {
    var reported: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onAccount: { reported.append($0) }
    )
    let payloads: [[String: Any]] = [
        [:],
        ["accountId": ""],
        ["accountId": String(repeating: "a", count: 33)],
        ["accountId": "u1234.abcd"],
        ["accountId": "u1234 abcd"],
        ["accountId": "ü1234abcd"],
        ["accountId": NSNumber(value: 1234)],
    ]
    for payload in payloads {
        let reply = await bridge.handle(body: ["action": "account", "payload": payload])
        #expect(reply.error != nil, "\(payload) should be refused")
    }
    #expect(reported.isEmpty)
}

// JavaScript's 1 and true both cross as NSNumber; only a real boolean counts
@Test @MainActor func settingsSyncActionTakesARealBooleanOnly() async {
    var received: [Bool] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com", onLog: { _ in }, onError: { _ in },
        onSettingsSync: { received.append($0) }
    )
    let on = await bridge.handle(body: ["action": "settingsSync", "payload": ["enabled": true]])
    let off = await bridge.handle(body: ["action": "settingsSync", "payload": ["enabled": false]])
    #expect(on.error == nil)
    #expect(off.error == nil)
    for value in [NSNumber(value: 1), NSNumber(value: 0), "true", [:] as [String: String]] as [Any] {
        let reply = await bridge.handle(body: ["action": "settingsSync", "payload": ["enabled": value]])
        #expect(reply.error != nil)
    }
    let missing = await bridge.handle(body: ["action": "settingsSync", "payload": [:]])
    #expect(missing.error != nil)
    #expect(received == [true, false])
}

// Fastmail's desktop app brings another of its windows forward by that
// window's name; the app says whether it had one, so the page can open a
// window after all when it did not.
@Test @MainActor func focusWindowAsksTheAppByNameAndIsToldWhetherItWasThere() async {
    var asked: [String] = []
    let bridge = NativeBridge(
        expectedHost: "app.fastmail.com",
        onLog: { _ in },
        onError: { _ in },
        onFocusWindow: { name in
            asked.append(name)
            return name == "open"
        }
    )
    let found = await bridge.handle(body: ["action": "focusWindow", "payload": ["name": "open"]])
    let missing = await bridge.handle(body: ["action": "focusWindow", "payload": ["name": "gone"]])
    let nameless = await bridge.handle(body: ["action": "focusWindow", "payload": [:]])
    #expect(asked == ["open", "gone"])
    #expect(found.value == "true")
    #expect(missing.value == "false")
    #expect(nameless.error != nil)
}
