import Foundation

public enum ComposeURL {
    // The compose window is its own window, so it gets Fastmail's minimal
    // chrome: no sidebar, no list, just the message — ui=minimal. Built
    // from components rather than pasted, so the account and the flag are
    // encoded the same way whichever is present.
    public static func url(for profile: Profile) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = profile.backend.host
        components.path = "/mail/Inbox/compose"
        var items: [URLQueryItem] = []
        if let accountID = profile.accountID {
            items.append(URLQueryItem(name: "u", value: accountID))
        }
        items.append(URLQueryItem(name: "ui", value: "minimal"))
        components.queryItems = items
        return components.url!
    }
}

extension ComposeURL {
    // A window opened for a mailto takes the path that is known to carry a
    // message, with the minimal chrome a window of its own wants: no sidebar,
    // no list, just what you are writing.
    public static func url(for profile: Profile, mailto: String) -> URL {
        LinkRouter.composeURL(
            mailto: mailto,
            accountID: profile.accountID,
            backend: profile.backend,
            minimalChrome: true
        )
    }
}

@MainActor
public final class ComposePool<Window: AnyObject> {
    private(set) var pooled: Window?
    private let create: () -> Window
    private let prepare: (Window) -> Void

    public init(create: @escaping () -> Window, prepare: @escaping (Window) -> Void) {
        self.create = create
        self.prepare = prepare
    }

    public func preload() {
        guard pooled == nil else { return }
        let window = create()
        prepare(window)
        pooled = window
    }

    public func take() -> Window {
        if let pooled {
            self.pooled = nil
            return pooled
        }
        let window = create()
        prepare(window)
        return window
    }

    public func shouldRecycle(_ window: Window) -> Bool {
        guard pooled == nil else { return false }
        prepare(window)
        pooled = window
        return true
    }
}

#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import WebKit

@MainActor
public final class ComposeWindows: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    public static let shared = ComposeWindows()

    private var pool: ComposePool<NSWindow>?
    private var configuredURL: URL?
    private nonisolated(unsafe) var observers: [NSObjectProtocol] = []

    // Called again when the backend changes. A pooled window has already been
    // preloaded with the old server's compose page, so the pool is rebuilt
    // rather than kept: reusing it would open a window on the server the app
    // is no longer signed in to.
    public func configure(profile: Profile) {
        let composeURL = ComposeURL.url(for: profile)
        guard configuredURL != composeURL else { return }
        configuredURL = composeURL
        pool = ComposePool(
            create: { [weak self] in self?.makeWindow() ?? NSWindow() },
            prepare: { window in
                ComposeWindows.readyForPool(window)
                ComposeWindows.webView(of: window)?.load(URLRequest(url: composeURL))
            }
        )
        pool?.preload()
        guard observers.isEmpty else { return }
        observers.append(NotificationCenter.default.addObserver(
            forName: .fmshellCompose, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { ComposeWindows.shared.compose() }
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: .fmshellComposeInTab, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated {
                ComposeWindows.shared.compose(inTabOf: NSApp.keyWindow)
            }
        })
    }

    /// Where a compose tab can go. A compose window will not host one — they
    /// refuse tabs — so a message asked for from inside one opens on its own.
    static func tabHost(_ window: NSWindow?) -> NSWindow? {
        guard let window, window.tabbingMode != .disallowed else { return nil }
        return window
    }

    /// Compose windows are reused, so being a tab is undone before one goes
    /// back to the pool: it leaves the group and refuses tabs again, or the
    /// next message would turn up somewhere nobody put it. The chrome stays —
    /// every message wears it — and is re-fitted for a window standing alone.
    static func readyForPool(_ window: NSWindow) {
        window.tabGroup?.removeWindow(window)
        window.tabbingMode = .disallowed
    }

    /// A message wears the same chrome as a mailbox, whether it is a tab, a
    /// window pulled out of one, or a window that was never anything else:
    /// the same title bar height, so the tab bar does not jump from tab to
    /// tab, and the same colour behind it, so the band above the message
    /// matches the band above a mailbox. Joining a window it takes the colour
    /// from there; on its own, from whatever the pages last asked for.
    static func dress(_ window: NSWindow, like host: NSWindow?) {
        raiseTitlebar(of: window)
        // The page is placed by hand from here on, so it is given the whole
        // window to be placed in — including the strip the chrome sits over.
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        if let color = host?.backgroundColor ?? PageChrome.color {
            window.backgroundColor = color
        }
        window.appearance = host?.appearance ?? PageChrome.appearance
    }

    /// Whether a window is wearing a mail window's chrome rather than its own.
    static func isDressed(_ window: NSWindow) -> Bool {
        window.titlebarAppearsTransparent
    }

    /// The band the window buttons sit in: as deep as it takes to leave as
    /// much room under them as over them. It comes out at the height of the
    /// header a mailbox page keeps above itself, which is why a message pulled
    /// out into its own window still starts on the same line as one.
    static func band(of window: NSWindow) -> CGFloat? {
        window.layoutIfNeeded()
        guard
            let close = window.standardWindowButton(.closeButton),
            let container = close.superview
        else { return nil }
        let frame = container.convert(close.frame, to: nil)
        let fromTop = window.frame.height - frame.maxY
        return fromTop * 2 + close.frame.height
    }

    /// Where a message's page has to start. In a tab it is below the bar with
    /// the same air its neighbours leave there; on its own there is no bar to
    /// clear, and the band holding the window buttons is all it needs.
    static func pageTop(barBottom: CGFloat?, air: CGFloat?, band: CGFloat) -> CGFloat {
        guard let barBottom, let air else { return band }
        return barBottom + air
    }

    /// Keeps every compose window wearing a mail window's chrome lined up,
    /// whether it is still a tab or has been pulled out into a window of its
    /// own. Called whenever any window's page is measured, since that is when
    /// the answer can have changed.
    func fitTabbedWindows() {
        for window in NSApp.windows
        where window.delegate === self && Self.isDressed(window) {
            // The colour is asked for again every time: a window is built
            // before any page has said what colour it is, and a window that
            // has joined a group should match the one it joined.
            Self.dress(window, like: window.tabGroup?.windows.first { $0 !== window })
            guard let band = Self.band(of: window) else { continue }
            let hasBar = window.tabGroup?.isTabBarVisible == true
            Self.setTopInset(
                Self.pageTop(
                    barBottom: hasBar ? contentTopInset(of: window) - tabBarBottomPadding : nil,
                    air: FullScreenObserver.airAroundTabBar,
                    band: band
                ),
                band: band,
                in: window
            )
        }
    }

    /// The page is held in a plain view rather than being the window's whole
    /// content, so there is somewhere for the band above it to come from: the
    /// window's own colour, showing through, with who the message is going to
    /// written across it.
    static func setTopInset(_ inset: CGFloat, band: CGFloat, in window: NSWindow) {
        guard let container = window.contentView,
              let view = webView(of: window) else { return }
        view.frame = NSRect(
            x: 0,
            y: 0,
            width: container.bounds.width,
            height: max(0, container.bounds.height - inset)
        )
        guard let label = recipientsLabel(of: window) else { return }
        label.frame = labelFrame(
            in: container.bounds,
            band: band,
            buttonsRight: buttonsRight(of: window),
            height: ceil(label.fittingSize.height)
        )
    }

    /// Where the recipients are written: level with the window buttons, well
    /// clear of them, and centred in the window rather than in what is left of
    /// it — the room taken on the left is taken on the right as well.
    static func labelFrame(
        in bounds: NSRect,
        band: CGFloat,
        buttonsRight: CGFloat,
        height: CGFloat
    ) -> NSRect {
        let margin = buttonsRight + 12
        return NSRect(
            x: margin,
            y: bounds.height - band / 2 - height / 2,
            width: max(0, bounds.width - margin * 2),
            height: height
        )
    }

    /// What the band says: whoever the message is addressed to, and nothing
    /// at all while it is addressed to no one.
    static func bandTitle(recipients: String) -> String {
        recipients.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func buttonsRight(of window: NSWindow) -> CGFloat {
        guard
            let zoom = window.standardWindowButton(.zoomButton),
            let container = zoom.superview
        else { return 78 }
        return container.convert(zoom.frame, to: nil).maxX
    }

    private static let recipientsID = NSUserInterfaceItemIdentifier("fmshell.recipients")

    static func recipientsLabel(of window: NSWindow) -> NSTextField? {
        window.contentView?.subviews
            .compactMap { $0 as? NSTextField }
            .first { $0.identifier == recipientsID }
    }

    /// Watches the To line and says when it changes. The field is found by the
    /// input Fastmail hangs its "To" label on, and read together with the
    /// names already entered beside it, so the band says the same as the row.
    private static let recipientScript = """
    (function(){
      function line(){
        var i=document.querySelector('input[id$="-to-input"]');
        if(!i){return '';}
        var w=i.closest('.v-EmailInput');
        var tokens=w?w.querySelector('ul.v-EmailInput-tokens'):null;
        // Each recipient carries its own Remove button; the band wants the
        // name, not the button beside it.
        var names=tokens?Array.prototype.map.call(
          tokens.querySelectorAll('li'),
          function(item){
            var copy=item.cloneNode(true);
            Array.prototype.forEach.call(
              copy.querySelectorAll('button'),
              function(button){button.remove();}
            );
            return copy.textContent.replace(/\\s+/g,' ').trim();
          }
        ).filter(Boolean).join(', '):'';
        var typed=(i.value||'').trim();
        return [names,typed].filter(Boolean).join(' ');
      }
      var last=null,pending=false;
      function send(){
        if(pending){return;}
        pending=true;
        requestAnimationFrame(function(){
          pending=false;
          var text=line();
          if(text===last){return;}
          last=text;
          window.webkit.messageHandlers.fmshellRecipients.postMessage(text);
        });
      }
      ['input','keyup','click','focusout'].forEach(function(name){
        document.addEventListener(name,send,true);
      });
      new MutationObserver(send).observe(
        document.documentElement,{subtree:true,childList:true}
      );
      send();
    })();
    """

    public nonisolated func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        let text = message.body as? String ?? ""
        let view = message.webView
        MainActor.assumeIsolated {
            guard let window = view?.window ?? NSApp.windows.first(where: {
                Self.webView(of: $0) === view
            }) else { return }
            Self.recipientsLabel(of: window)?.stringValue =
                Self.bandTitle(recipients: text)
        }
    }

    static func webView(of window: NSWindow) -> WKWebView? {
        window.contentView?.subviews.compactMap { $0 as? WKWebView }.first
    }

    deinit {
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    public func compose() {
        guard let pool else { return }
        let window = pool.take()
        fitTabbedWindows()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// The same window, opened on a message someone asked to write — a mailto
    /// link clicked anywhere on the Mac. The pooled window was preloaded blank,
    /// so this one has a page to fetch before it can be typed in.
    ///
    /// The profile comes with the message rather than being remembered from
    /// setup: a mailto can be what launched the app, arriving before the shell
    /// has appeared and configured anything, and a message that quietly went
    /// nowhere would be the worst way to find that out. Configuring twice is
    /// free — it returns on the second call.
    public func compose(mailto: String, profile: Profile) {
        configure(profile: profile)
        guard let pool else { return }
        let window = pool.take()
        Self.webView(of: window)?
            .load(URLRequest(url: ComposeURL.url(for: profile, mailto: mailto)))
        fitTabbedWindows()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// The same message, written in a tab of the window it was asked from.
    /// The page is Fastmail's minimal one either way, and the window keeps its
    /// ordinary title bar, so the message sits below the tab bar rather than
    /// behind it.
    public func compose(inTabOf host: NSWindow?) {
        guard let pool else { return }
        guard let host = Self.tabHost(host) else {
            compose()
            return
        }
        let window = pool.take()
        window.tabbingMode = .preferred
        Self.dress(window, like: host)
        host.addTabbedWindow(window, ordered: .above)
        window.makeKeyAndOrderFront(nil)
        fitTabbedWindows()
        NSApp.activate()
    }

    private func makeWindow() -> NSWindow {
        let configuration = WKWebViewConfiguration()
        #if os(macOS)
        // Its service worker takes its user agent from whichever client
        // started it. Without this token a compose window can restart
        // Fastmail's worker into the branch that hands the main window's
        // notifications to a WKWebView that never shows them.
        configuration.applicationNameForUserAgent = WebContainer.electronUserAgentToken
        #endif
        configuration.websiteDataStore = .default()
        let controller = WKUserContentController()
        controller.add(self, name: "fmshellRecipients")
        controller.addUserScript(WKUserScript(
            source: Self.recipientScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))
        configuration.userContentController = controller
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isInspectable = true
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.title = "New Message"
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 760, height: 640))
        view.frame = container.bounds
        view.autoresizingMask = [.width, .height]
        container.addSubview(view)
        let label = NSTextField(labelWithString: "")
        label.identifier = Self.recipientsID
        label.alignment = .center
        label.lineBreakMode = .byTruncatingTail
        label.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        label.autoresizingMask = [.width, .minYMargin]
        container.addSubview(label)
        window.contentView = container
        window.delegate = self
        Self.dress(window, like: nil)
        window.center()
        return window
    }

    public func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard let pool, sender.delegate === self else { return true }
        if pool.shouldRecycle(sender) {
            sender.orderOut(nil)
            return false
        }
        return true
    }
}
#endif
