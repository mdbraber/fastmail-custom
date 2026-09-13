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
    @ObservedObject private var settings = SettingsPresenter.shared
    @ObservedObject private var pendingLinks = PendingLinks.shared
    @ObservedObject private var pendingActions = PendingActions.shared
    @AppStorage(Backend.defaultsKey) private var backendName = Backend.standard.rawValue
    @Environment(\.scenePhase) private var scenePhase
    #if canImport(UIKit)
    @ObservedObject private var lock = ScreenLock.shared
    /// Links handed in while the screen lock is up, opened once it opens.
    @State private var heldLinks: [URL] = []
    #endif

    public init(profile: Profile) {
        self.profile = profile
    }

    /// What the web view opens. On iPhone and iPad a remembered page comes
    /// first; the Mac opens its Start page as it always has.
    private var launchURL: URL {
        #if canImport(UIKit)
        live.launchURL(readingFrom: .standard)
        #else
        live.startURL(readingFrom: .standard)
        #endif
    }

    // The profile as the setting currently has it. Everything that builds an
    // address reads it from here, so nothing is left pointing at the server
    // the app was launched against.
    private var live: Profile {
        profile.on(Backend.resolve(backendName))
    }

    // The app's own activity type, which Info.plist lists as well. Hung off
    // the bundle identifier, so the personal app continues the personal app.
    private var activityType: String {
        Continuity.activityType(bundleID: Bundle.main.bundleIdentifier)
            ?? "com.mdbraber.fastmail-custom.browse"
    }

    public var body: some View {
        ZStack(alignment: .top) {
            // Keyed on the backend so choosing the other server builds a new
            // web view rather than steering the old one there.
            WebContainer(profile: live, model: model, loadURL: launchURL)
                .ignoresSafeArea()
                .id(backendName)
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
            route(url)
        }
        // Handoff: the page open here offered to the same app on your other
        // device, and to a browser on a device that does not have it. The Mac
        // publishes it from the window instead, in ContinuityBeacon.
        #if canImport(UIKit)
        .userActivity(activityType, isActive: Continuity.advertised(model.pageURL) != nil) { activity in
            guard let url = Continuity.advertised(model.pageURL) else { return }
            Continuity.describe(
                activity,
                url: url,
                title: Continuity.title(subject: model.pageSubject, fallback: live.displayName)
            )
        }
        #endif
        .onContinueUserActivity(activityType) { activity in
            // Routed like any other link, so a page belonging to the other
            // account still ends up in the other account's app.
            guard let target = Continuity.target(of: activity) else { return }
            route(target)
        }
        #if canImport(UIKit)
        .sheet(isPresented: $settings.isPresented) {
            MobileSettingsSheet(profile: profile)
        }
        .onAppear {
            // The registrar asks for permission at launch; this puts the last
            // badge back once the app is on screen, and opens the notification
            // that launched it, if one did.
            BadgeController.shared.reapply()
            // With the lock on, the cover goes up and the app asks, before
            // anything that launched it is opened.
            lock.scenePhaseChanged(scenePhase)
            // The push names production; the page is on whichever server is selected
            if let url = pendingLinks.take() { route(live.backend.rehost(url)) }
            if !lock.holdsLinks, let action = pendingActions.take() { model.pendingAction = action }
        }
        .onChange(of: scenePhase) {
            lock.scenePhaseChanged(scenePhase)
            releaseHeldLinks()
            // Coming back to the front is when a badge permission just granted
            // in Settings first takes effect, and when a number that drifted
            // while the app slept gets corrected.
            if scenePhase == .active {
                BadgeController.shared.reapply()
                PushRegistrar.current?.becameActive()
            }
        }
        .onChange(of: lock.state.isLocked) {
            releaseHeldLinks()
        }
        .onChange(of: model.pageURL) {
            // Remember last viewed page: saved as it changes, while the switch is on
            DevicePreferences.recordPage(model.pageURL)
        }
        .onChange(of: pendingLinks.url) {
            // A tapped notification, routed exactly as a link from outside
            if let url = pendingLinks.take() { route(live.backend.rehost(url)) }
        }
        .onChange(of: pendingActions.name) {
            // A shortcut that asks the page to do something rather than to go
            // somewhere; search, which has no address of its own. The runner
            // holds it until the page can answer, and the lock holds it until
            // it has opened.
            guard !lock.holdsLinks else { return }
            if let action = pendingActions.take() { model.pendingAction = action }
        }
        #else
        .onAppear {
            ComposeWindows.shared.configure(profile: live)
            NotificationPresenter.shared.install()
            TabSwitcher.install()
            NotificationPresenter.shared.onClick = { data in
                // Hand the click to the page's service worker, which wrote the
                // payload and knows how to open the message
                guard let view = WebViewRegistry.shared.active else { return }
                let literal = String(data: try! JSONEncoder().encode(data), encoding: .utf8) ?? "\"{}\""
                view.callAsyncJavaScript(
                    "window.native && window.native.notificationClicked && window.native.notificationClicked(\(literal));",
                    arguments: [:], in: nil, in: .page, completionHandler: nil
                )
            }
        }
        .onChange(of: backendName) {
            ComposeWindows.shared.configure(profile: live)
        }
        // Without this the window group treats every URL handed to the app as
        // grounds for a new window, so a mailto arrived with a second copy of
        // the whole shell behind it.
        .handlesExternalEvents(preferring: ["*"], allowing: ["*"])
        #endif
    }

    /// A link from outside the page: opened now, or, on iPhone and iPad while
    /// the screen lock is up or about to be, held until it has opened.
    private func route(_ url: URL) {
        #if canImport(UIKit)
        if lock.holdsLinks {
            heldLinks.append(url)
            return
        }
        #endif
        handle(url)
    }

    #if canImport(UIKit)
    /// Opens what waited behind the lock, once the lock has opened.
    private func releaseHeldLinks() {
        guard !lock.holdsLinks else { return }
        let waiting = heldLinks
        heldLinks.removeAll()
        for url in waiting { handle(url) }
        if let action = pendingActions.take() { model.pendingAction = action }
    }
    #endif

    private func handle(_ url: URL) {
        switch LinkRouter.route(url, profile: live) {
        case .load(let target):
            model.pendingLoad = target
        case .refuse(let message):
            model.banner = message
        case .handoff(let target):
            openInOtherApp(target)
        case .compose(let mailto):
            #if canImport(AppKit) && !targetEnvironment(macCatalyst)
            // A message gets a window of its own rather than displacing
            // whatever you were reading.
            ComposeWindows.shared.compose(mailto: mailto, profile: live)
            #else
            model.pendingLoad = LinkRouter.composeURL(
                mailto: mailto, accountID: live.accountID, backend: live.backend
            )
            #endif
        }
    }

    private func openInOtherApp(_ target: URL) {
        let model = model
        let name = live.displayName
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
