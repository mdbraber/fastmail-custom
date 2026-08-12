import Testing
import Foundation
@testable import FastmailShellKit

@Test func routesLogAndErrorActions() async {
    let recorded = Recorder()
    let bridge = await NativeBridge(
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
        onLog: { _ in },
        onError: { _ in },
        onTheme: { await recorded.appendTheme($0) }
    )
    let reply = await bridge.handle(body: ["action": "theme", "payload": ["color": "#d6d8da"]])
    #expect(reply.error == nil)
    #expect(await recorded.themes == ["#d6d8da"])
}

@Test func themeActionWithoutColorProducesAnError() async {
    let bridge = await NativeBridge(onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["action": "theme", "payload": [:]])
    #expect(reply.error != nil)
}

@Test func unknownActionProducesAnError() async {
    let bridge = await NativeBridge(onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["action": "teleport", "payload": [:]])
    #expect(reply.error?.contains("teleport") == true)
}

@Test func malformedBodyProducesAnError() async {
    let bridge = await NativeBridge(onLog: { _ in }, onError: { _ in })
    let reply = await bridge.handle(body: ["nonsense": 1])
    #expect(reply.error != nil)
}

actor Recorder {
    var logs: [String] = []
    var errors: [String] = []
    var themes: [String] = []
    func appendLog(_ value: String) { logs.append(value) }
    func appendError(_ value: String) { errors.append(value) }
    func appendTheme(_ value: String) { themes.append(value) }
}
