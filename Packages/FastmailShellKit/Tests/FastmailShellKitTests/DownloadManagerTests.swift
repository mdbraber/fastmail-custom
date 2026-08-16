import Foundation
import Testing
@testable import FastmailShellKit

@MainActor
private func waitForReveal(_ manager: DownloadManager, count: Int = 1) async throws {
    for _ in 0..<200 where manager.items.count < count {
        try await Task.sleep(nanoseconds: 20_000_000)
    }
    #expect(manager.items.count >= count)
}

@Test func collisionsGetNumberedSuffixesBeforeTheExtension() {
    var taken: Set<String> = ["report.pdf", "report (2).pdf"]
    #expect(DownloadManager.uniqueFilename("report.pdf") { taken.contains($0) } == "report (3).pdf")
    #expect(DownloadManager.uniqueFilename("fresh.pdf") { taken.contains($0) } == "fresh.pdf")
    taken = ["README"]
    #expect(DownloadManager.uniqueFilename("README") { taken.contains($0) } == "README (2)")
}

@Test @MainActor func aDownloadFinishingInsideTheThresholdNeverPublishes() async throws {
    let manager = DownloadManager()
    manager.revealThreshold = 0.1
    var finished: DownloadManager.Item?
    manager.onFinished = { finished = $0 }
    let id = UUID()
    manager.begin(id: id, filename: "tiny.pdf", fileURL: nil)
    manager.finish(id: id)
    try await Task.sleep(nanoseconds: 250_000_000)
    #expect(manager.items.isEmpty)
    #expect(finished?.state == .finished)
}

@Test @MainActor func aSlowDownloadPublishesAfterTheThreshold() async throws {
    let manager = DownloadManager()
    manager.revealThreshold = 0.05
    let id = UUID()
    manager.begin(id: id, filename: "big.zip", fileURL: nil)
    try await waitForReveal(manager)
    #expect(manager.items.count == 1)
    #expect(manager.items.first?.state == .active)
    manager.finish(id: id)
    #expect(manager.items.first?.state == .finished)
}

@Test @MainActor func cancellingRemovesThePartialFile() async throws {
    let manager = DownloadManager()
    manager.revealThreshold = 0.01
    let partial = FileManager.default.temporaryDirectory
        .appendingPathComponent("partial-\(UUID().uuidString).bin")
    try Data([1, 2, 3]).write(to: partial)
    let id = UUID()
    manager.begin(id: id, filename: partial.lastPathComponent, fileURL: partial)
    try await waitForReveal(manager)
    manager.cancel(id)
    #expect(!FileManager.default.fileExists(atPath: partial.path))
    #expect(manager.items.first?.state == .cancelled)
}

@Test @MainActor func failureRemovesThePartialFileAndReportsOnce() async throws {
    let manager = DownloadManager()
    manager.revealThreshold = 0.01
    var issues: [String] = []
    manager.onIssue = { issues.append($0) }
    let partial = FileManager.default.temporaryDirectory
        .appendingPathComponent("failing-\(UUID().uuidString).bin")
    try Data([9]).write(to: partial)
    let id = UUID()
    manager.begin(id: id, filename: partial.lastPathComponent, fileURL: partial)
    try await waitForReveal(manager)
    manager.fail(id: id, message: "Download failed: network")
    #expect(!FileManager.default.fileExists(atPath: partial.path))
    #expect(manager.items.first?.state == .failed)
    #expect(issues.count == 1)
}

@Test @MainActor func clearInactiveKeepsOnlyActiveDownloads() async throws {
    let manager = DownloadManager()
    manager.revealThreshold = 0.01
    let finished = UUID()
    let active = UUID()
    manager.begin(id: finished, filename: "done.pdf", fileURL: nil)
    manager.begin(id: active, filename: "going.pdf", fileURL: nil)
    try await waitForReveal(manager, count: 2)
    manager.finish(id: finished)
    manager.clearInactive()
    #expect(manager.items.map(\.filename) == ["going.pdf"])
}

@Test func aMissingChosenFolderFallsBack() {
    let fallback = DownloadManager.destinationDirectory(chosenPath: "/nonexistent/path/xyz")
    let none = DownloadManager.destinationDirectory(chosenPath: nil)
    #expect(fallback == none)
}
