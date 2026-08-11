import Foundation

public struct ScriptBundle: Equatable, Sendable {
    public let harness: String
    public let userScript: String
    public let overlay: String?
    public let metadata: UserScriptMetadata
}

public enum ScriptStoreError: Error, Equatable {
    case harnessMissing
    case userScriptMissing
}

public protocol ResourceLoading: Sendable {
    func string(named name: String) -> String?
}

public struct BundleResourceLoader: ResourceLoading {
    private let bundles: [Bundle]

    public init(bundles: [Bundle]) {
        self.bundles = bundles
    }

    public init() {
        self.init(bundles: [.main, .module])
    }

    public func string(named name: String) -> String? {
        for bundle in bundles {
            guard let url = bundle.url(forResource: name, withExtension: nil) else { continue }
            if let contents = try? String(contentsOf: url, encoding: .utf8) { return contents }
        }
        return nil
    }
}

public struct ScriptStore {
    private let loader: ResourceLoading
    private let overlayName: String?

    public init(loader: ResourceLoading, overlayName: String?) {
        self.loader = loader
        self.overlayName = overlayName
    }

    public func load() throws -> ScriptBundle {
        guard let harness = loader.string(named: "harness.js") else {
            throw ScriptStoreError.harnessMissing
        }
        guard let userScript = loader.string(named: "userscript.js") else {
            throw ScriptStoreError.userScriptMissing
        }
        let metadata = try MetadataParser.parse(userScript)
        let overlay = overlayName.flatMap { loader.string(named: $0) }
        return ScriptBundle(
            harness: harness,
            userScript: userScript,
            overlay: overlay,
            metadata: metadata
        )
    }
}
