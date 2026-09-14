import AppIntents
import FastmailShellKit
import Foundation

struct RegisteredActionOptions: DynamicOptionsProvider {
    func results() async throws -> [String] {
        UserDefaults.standard.stringArray(forKey: IntentSupport.actionNamesKey) ?? []
    }
}

struct OpenFastmail: AppIntent {
    static let title: LocalizedStringResource = "Open Fastmail"
    static let openAppWhenRun = true

    @Parameter(title: "Path")
    var path: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        try IntentSupport.open(path: path)
        return .result()
    }
}

struct GetCurrentLink: AppIntent {
    static let title: LocalizedStringResource = "Get Current Link"
    static let openAppWhenRun = false

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<MailLink> {
        .result(value: MailLink(try await IntentSupport.currentLink()))
    }
}

struct GetURL: AppIntent {
    static let title: LocalizedStringResource = "Get URL"
    static let openAppWhenRun = false

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<URL> {
        .result(value: try await IntentSupport.currentLink().url)
    }
}

struct GetTitle: AppIntent {
    static let title: LocalizedStringResource = "Get Title"
    static let openAppWhenRun = false

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await IntentSupport.currentLink().title)
    }
}

struct RunJavaScript: AppIntent {
    static let title: LocalizedStringResource = "Run JavaScript"
    static let openAppWhenRun = false

    @Parameter(
        title: "JavaScript",
        inputOptions: String.IntentInputOptions(
            capitalizationType: .none,
            multiline: true,
            autocorrect: false,
            smartQuotes: false,
            smartDashes: false
        )
    )
    var script: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await IntentSupport.runJavaScript(script))
    }
}

struct RunScriptAction: AppIntent {
    static let title: LocalizedStringResource = "Run Script Action"
    static let openAppWhenRun = false

    @Parameter(title: "Action", optionsProvider: RegisteredActionOptions())
    var name: String

    @MainActor
    func perform() async throws -> some IntentResult {
        try await IntentSupport.runAction(named: name)
        return .result()
    }
}
