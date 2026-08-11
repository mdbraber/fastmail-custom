import Testing
import Foundation
@testable import FastmailShellKit

private func bundle(userScript: String, overlay: String? = nil) -> ScriptBundle {
    ScriptBundle(
        harness: "HARNESS_SOURCE",
        userScript: userScript,
        overlay: overlay,
        metadata: UserScriptMetadata(
            name: "X",
            matches: ["https://app.fastmail.com/*"],
            runAt: .documentIdle,
            grants: ["none"]
        )
    )
}

private func firstJSONArgument(of source: String) throws -> String {
    let marker = "window.__fmshell.boot("
    guard let markerRange = source.range(of: marker) else {
        throw NSError(domain: "test", code: 1)
    }
    var index = markerRange.upperBound
    guard source[index] == "\"" else {
        throw NSError(domain: "test", code: 2)
    }
    index = source.index(after: index)
    var escaped = false
    while index < source.endIndex {
        let char = source[index]
        if escaped {
            escaped = false
        } else if char == "\\" {
            escaped = true
        } else if char == "\"" {
            let literal = String(source[markerRange.upperBound...index])
            let data = literal.data(using: .utf8)!
            let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            return value as! String
        }
        index = source.index(after: index)
    }
    throw NSError(domain: "test", code: 3)
}

@Test func bootstrapContainsHarnessThenBootCall() throws {
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.hasPrefix("HARNESS_SOURCE"))
    #expect(source.contains("window.__fmshell.boot("))
}

@Test func userScriptSurvivesQuotesNewlinesAndScriptTags() throws {
    let hostile = "var s = \"a'b\\\"c\";\nif (a </script> b) {}\n\u{2028}\u{2029} emoji 🙂 tail"
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: hostile))
    #expect(try firstJSONArgument(of: source) == hostile)
}

@Test func absentOverlayIsEncodedAsNullAndDoesNotThrow() throws {
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.contains(", null, "))
}

@Test func presentOverlayRoundTrips() throws {
    let overlay = "var x = \"overlay_content, with, commas\";"
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: "BODY", overlay: overlay))
    let overlayLiteral = try extractSecondArgument(of: source)
    #expect(overlayLiteral == overlay)
}

@Test func metadataIsPassedAsRunAtAndMatches() throws {
    let source = try ScriptInjector.bootstrap(from: bundle(userScript: "BODY"))
    #expect(source.contains("\"runAt\":\"document-idle\"") || source.contains("\"runAt\": \"document-idle\""))
    let metadata = try extractThirdArgument(of: source)
    #expect(metadata.contains("\"matches\""))
    #expect(metadata.contains("app.fastmail.com"))
}

private func extractSecondArgument(of source: String) throws -> String {
    let marker = "window.__fmshell.boot("
    guard let markerRange = source.range(of: marker) else {
        throw NSError(domain: "test", code: 1)
    }
    var index = markerRange.upperBound
    guard source[index] == "\"" else {
        throw NSError(domain: "test", code: 2)
    }
    index = source.index(after: index)
    var escaped = false
    while index < source.endIndex {
        let char = source[index]
        if escaped {
            escaped = false
        } else if char == "\\" {
            escaped = true
        } else if char == "\"" {
            index = source.index(after: index)
            break
        }
        index = source.index(after: index)
    }
    while index < source.endIndex && (source[index] == "," || source[index] == " ") {
        index = source.index(after: index)
    }
    guard index < source.endIndex else {
        throw NSError(domain: "test", code: 4)
    }
    if source[index] == "n" {
        let end = source.index(index, offsetBy: 4)
        if String(source[index..<end]) == "null" {
            return "null"
        }
    }
    guard source[index] == "\"" else {
        throw NSError(domain: "test", code: 5)
    }
    index = source.index(after: index)
    let startQuote = source.index(before: index)
    escaped = false
    while index < source.endIndex {
        let char = source[index]
        if escaped {
            escaped = false
        } else if char == "\\" {
            escaped = true
        } else if char == "\"" {
            let literal = String(source[startQuote...index])
            let data = literal.data(using: .utf8)!
            let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            return value as! String
        }
        index = source.index(after: index)
    }
    throw NSError(domain: "test", code: 6)
}

private func extractThirdArgument(of source: String) throws -> String {
    let marker = "window.__fmshell.boot("
    guard let markerRange = source.range(of: marker) else {
        throw NSError(domain: "test", code: 1)
    }
    var searchStart = markerRange.upperBound
    var parenCount = 1
    var escaped = false
    var index = searchStart
    while index < source.endIndex && parenCount > 0 {
        let char = source[index]
        if escaped {
            escaped = false
        } else if char == "\\" {
            escaped = true
        } else if char == "\"" {
            var stringIndex = source.index(after: index)
            var stringEscaped = false
            while stringIndex < source.endIndex {
                let stringChar = source[stringIndex]
                if stringEscaped {
                    stringEscaped = false
                } else if stringChar == "\\" {
                    stringEscaped = true
                } else if stringChar == "\"" {
                    index = stringIndex
                    break
                }
                stringIndex = source.index(after: stringIndex)
            }
        } else if char == "(" {
            parenCount += 1
        } else if char == ")" {
            parenCount -= 1
        }
        index = source.index(after: index)
    }
    let beforeParen = source.index(before: index)
    var extractStart = source.index(before: beforeParen)
    while extractStart > searchStart && (source[extractStart] == " " || source[extractStart] == ",") {
        extractStart = source.index(before: extractStart)
    }
    var objectStart = extractStart
    if source[objectStart] != "{" {
        var braceIndex = source.index(before: objectStart)
        while braceIndex >= searchStart && source[braceIndex] != "{" {
            if braceIndex == searchStart {
                throw NSError(domain: "test", code: 3)
            }
            braceIndex = source.index(before: braceIndex)
        }
        objectStart = braceIndex
    }
    if source[objectStart] != "{" {
        throw NSError(domain: "test", code: 4)
    }
    var braceCount = 0
    var objIndex = objectStart
    var objEscaped = false
    while objIndex < source.endIndex {
        let char = source[objIndex]
        if objEscaped {
            objEscaped = false
        } else if char == "\\" {
            objEscaped = true
        } else if char == "\"" {
            var stringIndex = source.index(after: objIndex)
            var stringEscaped = false
            while stringIndex < source.endIndex {
                let stringChar = source[stringIndex]
                if stringEscaped {
                    stringEscaped = false
                } else if stringChar == "\\" {
                    stringEscaped = true
                } else if stringChar == "\"" {
                    objIndex = stringIndex
                    break
                }
                stringIndex = source.index(after: stringIndex)
            }
        } else if char == "{" {
            braceCount += 1
        } else if char == "}" {
            braceCount -= 1
            if braceCount == 0 {
                let endIndex = source.index(after: objIndex)
                return String(source[objectStart..<endIndex])
            }
        }
        objIndex = source.index(after: objIndex)
    }
    throw NSError(domain: "test", code: 5)
}
