import Testing
@testable import FastmailShellKit

private let realHeader = """
// ==UserScript==
// @name         Fastmail Custom mode
// @namespace    mdbraber
// @version      1.0
// @description  Sticky Inbox filter on labels
// @author       Someone
// @match        https://app.fastmail.com/*
// @run-at       document-idle
// @inject-into  context
// @grant        none
// ==/UserScript==

(function () { 'use strict'; })();
"""

@Test func parsesTheRealHeader() throws {
    let meta = try MetadataParser.parse(realHeader)
    #expect(meta.name == "Fastmail Custom mode")
    #expect(meta.matches == ["https://app.fastmail.com/*"])
    #expect(meta.runAt == .documentIdle)
    #expect(meta.grants == ["none"])
}

@Test func missingBlockThrows() {
    #expect(throws: MetadataParseError.blockMissing) {
        try MetadataParser.parse("(function () {})();")
    }
}

@Test func runAtDefaultsToDocumentIdle() throws {
    let source = """
    // ==UserScript==
    // @name  X
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).runAt == .documentIdle)
}

@Test func unknownRunAtFallsBackToDocumentIdle() throws {
    let source = """
    // ==UserScript==
    // @run-at  whenever
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).runAt == .documentIdle)
}

@Test func collectsMultipleMatches() throws {
    let source = """
    // ==UserScript==
    // @match https://app.fastmail.com/*
    // @match https://www.fastmail.com/*
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).matches.count == 2)
}

@Test func unknownDirectivesAreIgnoredNotFatal() throws {
    let source = """
    // ==UserScript==
    // @wibble something
    // @match https://app.fastmail.com/*
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).matches == ["https://app.fastmail.com/*"])
}

@Test func directivesAfterTheClosingLineAreIgnored() throws {
    let source = """
    // ==UserScript==
    // @match https://app.fastmail.com/*
    // ==/UserScript==
    // @match https://evil.example.com/*
    """
    #expect(try MetadataParser.parse(source).matches == ["https://app.fastmail.com/*"])
}

@Test func bothMarkersOnOneLineThrows() {
    #expect(throws: MetadataParseError.blockMissing) {
        try MetadataParser.parse("// ==UserScript== ==/UserScript==")
    }
}

@Test func emptyStringThrows() {
    #expect(throws: MetadataParseError.blockMissing) {
        try MetadataParser.parse("")
    }
}

@Test func onlyClosingMarkerThrows() {
    #expect(throws: MetadataParseError.blockMissing) {
        try MetadataParser.parse("// ==/UserScript==")
    }
}

@Test func closingMarkerBeforeOpeningMarkerWithValidBlockAfter() throws {
    let source = """
    // ==/UserScript==
    // ==UserScript==
    // @match https://example.com/*
    // ==/UserScript==
    """
    #expect(try MetadataParser.parse(source).matches == ["https://example.com/*"])
}

@Test func adjacentMarkersYieldsEmptyMatches() throws {
    let source = """
    // ==UserScript==
    // ==/UserScript==
    """
    let meta = try MetadataParser.parse(source)
    #expect(meta.matches == [])
    #expect(meta.runAt == .documentIdle)
}
