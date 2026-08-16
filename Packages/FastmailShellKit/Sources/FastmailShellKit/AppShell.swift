import SwiftUI

#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

public struct AppShell: View {
    private let profile: Profile
    @StateObject private var model = ShellModel()
    @ObservedObject private var downloads = DownloadManager.shared

    public init(profile: Profile) {
        self.profile = profile
    }

    public var body: some View {
        ZStack(alignment: .top) {
            WebContainer(profile: profile, model: model, loadURL: profile.startURL(readingFrom: .standard))
                .ignoresSafeArea()
            if let banner = model.banner {
                HStack(alignment: .top) {
                    Text(banner)
                        .font(.callout)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Button("Dismiss") { model.banner = nil }
                        .buttonStyle(.plain)
                }
                .padding(12)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                .padding(12)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            if !downloads.items.isEmpty {
                DownloadsPanel(
                    items: downloads.items,
                    onCancel: { downloads.cancel($0) },
                    onDismiss: { downloads.clearInactive() }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.default, value: model.banner)
        .animation(.default, value: downloads.items)
        .onOpenURL { url in
            handle(url)
        }
        #if !canImport(UIKit)
        .onAppear {
            ComposeWindows.shared.configure(profile: profile)
        }
        #endif
    }

    private func handle(_ url: URL) {
        switch LinkRouter.route(url, profile: profile) {
        case .load(let target):
            model.pendingLoad = target
        case .refuse(let message):
            model.banner = message
        case .handoff(let target):
            openInOtherApp(target)
        }
    }

    private func openInOtherApp(_ target: URL) {
        let model = model
        let name = profile.displayName
        let loadLocally: @MainActor () -> Void = {
            model.banner = "This link belongs to your other account; \(name) opened it instead."
            if let inner = LinkRouter.handoffTarget(target) {
                model.pendingLoad = inner
            }
        }
        #if canImport(UIKit)
        UIApplication.shared.open(target, options: [:]) { opened in
            if !opened {
                loadLocally()
            }
        }
        #else
        if !NSWorkspace.shared.open(target) {
            loadLocally()
        }
        #endif
    }
}

private struct DownloadsPanel: View {
    let items: [DownloadManager.Item]
    let onCancel: (UUID) -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Downloads")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if items.allSatisfy({ $0.state != .active }) {
                    Button {
                        onDismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            ForEach(items) { item in
                row(item)
            }
        }
        .padding(12)
        .frame(width: 300)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .padding(14)
    }

    @ViewBuilder
    private func row(_ item: DownloadManager.Item) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(item.filename)
                    .font(.callout)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                switch item.state {
                case .active:
                    Button {
                        onCancel(item.id)
                    } label: {
                        Image(systemName: "xmark.circle")
                    }
                    .buttonStyle(.plain)
                case .finished:
                    #if os(macOS)
                    Button("Show in Finder") {
                        if let url = item.fileURL {
                            NSWorkspace.shared.activateFileViewerSelecting([url])
                        }
                    }
                    .font(.caption)
                    #else
                    Button("Open") {
                        if let url = item.fileURL {
                            PreviewPresenter.shared.preview(url)
                        }
                    }
                    .font(.caption)
                    #endif
                case .failed:
                    Text("Failed")
                        .font(.caption)
                        .foregroundStyle(.red)
                case .cancelled:
                    Text("Cancelled")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if item.state == .active {
                if item.totalIsKnown {
                    ProgressView(value: item.fractionComplete)
                } else {
                    ProgressView()
                        .controlSize(.small)
                }
                if !item.byteText.isEmpty {
                    Text(item.byteText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
