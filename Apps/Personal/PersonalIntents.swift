import AppIntents
import FastmailShellKit
import Foundation

struct ShellIntentsPackage: AppIntentsPackage {
    static var includedPackages: [any AppIntentsPackage.Type] {
        [FastmailShellIntents.self]
    }
}

struct RegisteredActionOptions: DynamicOptionsProvider {
    func results() async throws -> [String] {
        UserDefaults.standard.stringArray(forKey: IntentSupport.actionNamesKey) ?? []
    }
}

struct OpenFastmail: AppIntent {
    static let title: LocalizedStringResource = "Open Fastmail (mdbraber.com)"
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
    static let title: LocalizedStringResource = "Get Current Link (mdbraber.com)"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<MailLink> {
        .result(value: try await IntentSupport.currentLink())
    }
}

struct GetURL: AppIntent {
    static let title: LocalizedStringResource = "Get URL (mdbraber.com)"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<URL> {
        .result(value: try await IntentSupport.currentLink().url)
    }
}

struct GetTitle: AppIntent {
    static let title: LocalizedStringResource = "Get Title (mdbraber.com)"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await IntentSupport.currentLink().title)
    }
}

struct RunJavaScript: AppIntent {
    static let title: LocalizedStringResource = "Run JavaScript (mdbraber.com)"
    static let openAppWhenRun = true

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
    static let title: LocalizedStringResource = "Run Script Action (mdbraber.com)"
    static let openAppWhenRun = true

    @Parameter(title: "Action", optionsProvider: RegisteredActionOptions())
    var name: String

    @MainActor
    func perform() async throws -> some IntentResult {
        try await IntentSupport.runAction(named: name)
        return .result()
    }
}
