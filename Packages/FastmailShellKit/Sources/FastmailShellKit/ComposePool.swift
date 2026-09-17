import Foundation

public enum ComposeURL {
    // The compose window is its own window, so it gets Fastmail's minimal
    // chrome: no sidebar, no list, just the message; ui=minimal.
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
    private let release: (Window) -> Void

    public init(
        create: @escaping () -> Window,
        prepare: @escaping (Window) -> Void,
        release: @escaping (Window) -> Void = { _ in }
    ) {
        self.create = create
        self.prepare = prepare
        self.release = release
    }

    public func preload() {
        guard pooled == nil else { return }
        let window = create()
        prepare(window)
        pooled = window
    }

    public func take() -> Window {
        let window: Window
        if let pooled {
            self.pooled = nil
            window = pooled
        } else {
            window = create()
            prepare(window)
        }
        release(window)
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
    private var opened: [NSWindow] = []
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
                guard let view = ComposeWindows.webView(of: window) else { return }
                // A page loaded to wait unseen must not count as an open
                // window; poolScript says why.
                ComposeWindows.useScripts(pooled: true, in: view.configuration.userContentController)
                view.load(URLRequest(url: composeURL))
            },
            release: { window in ComposeWindows.leavePool(window) }
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

    /// Where a compose tab can go. A compose window will not host one; they
    /// refuse tabs; so a message asked for from inside one opens on its own.
    static func tabHost(_ window: NSWindow?) -> NSWindow? {
        guard let window, window.tabbingMode != .disallowed else { return nil }
        return window
    }

    /// Compose windows are reused, so being a tab is undone before one goes
    /// back to the pool: it leaves the group and refuses tabs again, or the
    /// next message would turn up somewhere nobody put it.
    static func readyForPool(_ window: NSWindow) {
        window.tabGroup?.removeWindow(window)
        window.tabbingMode = .disallowed
    }

    /// A message wears the same chrome as a mailbox, whether it is a tab, a
    /// window pulled out of one, or a window that was never anything else: the
    /// same title bar height, so the tab bar does not jump from tab to tab,
    /// and the same colour behind it, so the band above the message matches
    /// the band above a mailbox.
    static func dress(_ window: NSWindow, like host: NSWindow?) {
        // Only a window joining a group needs the taller title bar, to keep
        // the tab bar from jumping between tabs.
        if host == nil {
            window.toolbar = nil
            window.toolbarStyle = .automatic
        } else {
            raiseTitlebar(of: window)
        }
        // The page is placed by hand from here on, so it is given the whole
        // window to be placed in; including the strip the chrome sits over.
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        if let color = host?.backgroundColor ?? PageChrome.color {
            window.backgroundColor = color
        }
        window.appearance = host?.appearance ?? PageChrome.appearance
    }

    /// Keeps a window that was opened for a page alive for as long as it is
    /// open, and lets go the moment it closes.
    private func hold(_ window: NSWindow) {
        opened.append(window)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(openedWindowWillClose(_:)),
            name: NSWindow.willCloseNotification,
            object: window
        )
    }

    @objc private func openedWindowWillClose(_ note: Notification) {
        guard let window = note.object as? NSWindow else { return }
        opened.removeAll { $0 === window }
        NotificationCenter.default.removeObserver(
            self, name: NSWindow.willCloseNotification, object: window
        )
    }

    /// How big a message's own window is, and how far it stands off from the
    /// window it was asked from.
    nonisolated static let ownSize = NSSize(width: 780, height: 840)
    private static let standOff: CGFloat = 36

    /// Where a message's window puts its top-left corner: down and to the
    /// right of the window it came from.
    static func topLeft(offsetFrom host: NSRect, by offset: CGFloat) -> NSPoint {
        NSPoint(x: host.minX + offset, y: host.maxY - offset)
    }

    /// Stands the window off from whichever window it was asked from, and
    /// centres it when there is nothing to stand off from.
    static func place(_ window: NSWindow) {
        guard let host = NSApp.keyWindow ?? NSApp.mainWindow, host !== window else {
            window.center()
            return
        }
        window.setFrameTopLeftPoint(topLeft(offsetFrom: host.frame, by: standOff))
    }

    /// The window to take a colour and appearance from: the one this window
    /// has joined, if it has joined one.
    static func chromeSource(for window: NSWindow) -> NSWindow? {
        window.tabGroup?.windows.first { $0 !== window }
    }

    /// Whether a window is wearing a mail window's chrome rather than its own.
    static func isDressed(_ window: NSWindow) -> Bool {
        window.titlebarAppearsTransparent
    }

    /// The band the window buttons sit in: as deep as it takes to leave as
    /// much room under them as over them.
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
    /// own.
    func fitTabbedWindows() {
        for window in NSApp.windows
        where Self.isDressed(window) && Self.webView(of: window) != nil {
            // The colour is asked for again every time: a window is built
            // before any page has said what colour it is, and a window that
            // has joined a group should match the one it joined.
            Self.dress(window, like: Self.chromeSource(for: window))
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
    /// it; the room taken on the left is taken on the right as well.
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

    /// Prints what the window is showing, as a sheet on that window.
    static func print(_ view: WKWebView, in window: NSWindow) {
        let info = NSPrintInfo.shared
        info.horizontalPagination = .fit
        info.isHorizontallyCentered = false
        let operation = view.printOperation(with: info)
        operation.view?.frame = view.bounds
        operation.runModal(
            for: window,
            delegate: nil,
            didRun: nil,
            contextInfo: nil
        )
    }

    /// What the band says: whoever the message is being written to, or; for a
    /// message being read rather than written; what the page calls itself,
    /// which is its subject.
    static func bandTitle(composing: Bool, recipients: String, pageTitle: String) -> String {
        let text = (composing ? recipients : pageTitle)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if composing, text.isEmpty { return "New message" }
        return text
    }

    /// What the window is called in the Window menu.
    static func windowTitle(composing: Bool, pageTitle: String) -> String {
        let subject = pageTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return composing || subject.isEmpty ? "New Message" : subject
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

    /// Watches the To line and says when it changes.
    private static let recipientScript = """
    (function(){
      var sawCompose=false,goneSince=null;
      // WebKit does nothing at all with a page's own print(), so the ask is
      // passed out to the window, which knows how to print its view.
      window.print=function(){
        window.webkit.messageHandlers.fmshellRecipients.postMessage({print:true});
      };
      // Everything below is the page's own business, and a frame inside it
      // has no say in what the window is called or when it closes.
      if(window.top!==window){return;}
      // A window on its own does not always lose the To field once a
      // message is sent: the compose form can stay mounted under a
      // "Sending…" badge that never resolves in this particular window,
      // even though the send itself has already gone through (the message
      // shows up sent, and its own undo lives in whichever window shows
      // it). So the send is not read from the page's own visible state,
      // which can get stuck, but from Fastmail's own compose controller:
      // didSend is what it calls once a send is confirmed, right before it
      // closes its own idea of the compose panel; didSendFail is its
      // sibling for one that failed, and is left alone so a window with
      // something to fix stays open. Patching the prototype catches every
      // compose in this window, not only the one open when this runs, and
      // is retried below until Fastmail has finished loading enough to
      // have it.
      var sent=false;
      function patchSendSignal(){
        try {
          var Ctrl=window.FastMail&&FastMail.classes&&FastMail.classes.ComposeController;
          if(!Ctrl||!Ctrl.prototype||Ctrl.prototype.__fmshellPatched){return;}
          var original=Ctrl.prototype.didSend;
          if(typeof original!=='function'){return;}
          Ctrl.prototype.didSend=function(){
            var result=original.apply(this,arguments);
            sent=true;
            send();
            return result;
          };
          Ctrl.prototype.__fmshellPatched=true;
        } catch(e){}
      }
      // A stuck "Sending…" badge as a fallback, in case Fastmail's own
      // naming for the above ever changes and the patch quietly stops
      // catching anything.
      function isSending(){
        return /Sending(\\.\\.\\.|\\u2026)/.test(document.body.textContent||'');
      }
      function line(){
        var i=document.querySelector('input[id$="-to-input"]');
        if(!i){return null;}
        sawCompose=true;
        if(!sent&&!isSending()){goneSince=null;}
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
      // A message that has been sent, saved or discarded takes its window with
      // it.
      function gone(){
        if(sent){return true;}
        if(!sawCompose){return false;}
        if(!isSending() && document.querySelector('input[id$="-to-input"]')){return false;}
        if(goneSince===null){goneSince=Date.now();setTimeout(send,1200);return false;}
        return Date.now()-goneSince>1000;
      }
      function send(){
        if(pending){return;}
        pending=true;
        // A plain timer, not requestAnimationFrame: rAF callbacks do not run
        // at all once this window is occluded, which is exactly what happens
        // the moment someone sends and switches focus away, and this is the
        // one check that has to keep going anyway to notice the window is
        // done and close it.
        setTimeout(function(){
          pending=false;
          patchSendSignal();
          var to=line();
          var meta=document.querySelector('meta[name="theme-color"]');
          var state={
            color:meta?(meta.content||''):'',
            composing:to!==null,
            to:to===null?'':to,
            title:(document.title||'').trim(),
            gone:gone()
          };
          var key=[state.color,state.composing,state.to,state.title,state.gone].join('|');
          if(key===last){return;}
          last=key;
          window.webkit.messageHandlers.fmshellRecipients.postMessage(state);
        },0);
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

    /// Stands in for WebKit's own window.Notification in a compose window,
    /// which has no harness. WebKit's reports "default" and turns every
    /// request down, and Fastmail, starting up with notifications on and
    /// permission "default", asks and on a refusal switches new-mail and
    /// calendar notifications off in localStorage, which the mailbox window
    /// shares. Every compose page start did that. Answered "denied" here, it
    /// never asks; a compose window shows no notifications either way, the
    /// mailbox window does.
    static let notificationScript = """
    (function(){
      var Shim=function(){};
      Object.defineProperty(Shim,'permission',{get:function(){return 'denied';}});
      Shim.requestPermission=function(callback){
        if(typeof callback==='function'){callback('denied');}
        return Promise.resolve('denied');
      };
      window.Notification=Shim;
    })();
    """

    /// Keeps a compose page waiting in the pool off Fastmail's roll call of
    /// open windows. A page that sees another window open holds new mail back
    /// for up to twenty seconds whenever it is not focused, so a hidden page
    /// on that roll call left the mailbox window slow to show new mail. The
    /// page still says hello, so the others answer and it knows it is not the
    /// master window, the one that shows notifications; it says goodbye
    /// straight after, and answers no roll call until it is opened.
    static let poolScript = """
    (function(){
      var pooled=true,announced=[];
      var post=BroadcastChannel.prototype.postMessage;
      // owm:broadcast before Fastmail knows who is signed in, and
      // owm:<account>:broadcast after.
      function isRollCall(channel){return /^owm:.*broadcast$/.test(channel.name);}
      function forget(channel){
        announced=announced.filter(function(one){return one.channel!==channel;});
      }
      BroadcastChannel.prototype.postMessage=function(message){
        if(!pooled||!message||!isRollCall(this)){return post.apply(this,arguments);}
        if(message.type==='wc:ping'){return;}
        if(message.type==='wc:bye'){forget(this);}
        post.apply(this,arguments);
        if(message.type==='wc:hello'){
          forget(this);
          announced.push({channel:this,wcId:message.wcId});
          post.call(this,{wcId:message.wcId,type:'wc:bye'});
        }
      };
      window.fmshellLeavePool=function(){
        if(!pooled){return;}
        pooled=false;
        announced.forEach(function(one){
          post.call(one.channel,{wcId:one.wcId,type:'wc:hello',url:location.href});
        });
        announced=[];
      };
    })();
    """

    public nonisolated func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        let state = message.body as? [String: Any] ?? [:]
        let recipients = state["to"] as? String ?? ""
        let composing = state["composing"] as? Bool ?? false
        let title = state["title"] as? String ?? ""
        let finished = state["gone"] as? Bool ?? false
        let printing = state["print"] as? Bool ?? false
        let view = message.webView
        MainActor.assumeIsolated {
            guard let window = view?.window ?? NSApp.windows.first(where: {
                Self.webView(of: $0) === view
            }) else { return }
            if printing, let view {
                Self.print(view, in: window)
                return
            }
            if finished {
                window.performClose(nil)
                return
            }
            // The colour comes from the page in this very window, which is
            // the same place a mailbox window gets its own.
            if let color = state["color"] as? String, !color.isEmpty {
                applyTint(color, isDark: nil, to: window)
            }
            Self.recipientsLabel(of: window)?.stringValue =
                Self.bandTitle(composing: composing, recipients: recipients, pageTitle: title)
            window.title = Self.windowTitle(composing: composing, pageTitle: title)
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
        Self.place(window)
        fitTabbedWindows()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// The same window, opened on a message someone asked to write, a mailto
    /// link clicked anywhere on the Mac.
    public func compose(mailto: String, profile: Profile) {
        configure(profile: profile)
        guard let pool else { return }
        let window = pool.take()
        Self.webView(of: window)?
            .load(URLRequest(url: ComposeURL.url(for: profile, mailto: mailto)))
        Self.place(window)
        fitTabbedWindows()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// A window for a page Fastmail asked to open on its own: a draft or a
    /// message opened with "Open in new window".
    public func window(for configuration: WKWebViewConfiguration, size: NSSize) -> WKWebView {
        Self.watchRecipients(in: configuration.userContentController, reportingTo: self)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isInspectable = true
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "New Message"
        // Closed windows are AppKit's to release by default, and this one is
        // already owned here; left to both, it is freed twice, which is a
        // crash on Command-W rather than a closed window.
        window.isReleasedWhenClosed = false
        window.contentView = Self.contents(around: view, size: size)
        window.tabbingMode = .disallowed
        hold(window)
        Self.dress(window, like: Self.chromeSource(for: window))
        fitTabbedWindows()
        // Placed once it is dressed: the chrome it borrows changes its height,
        // and a corner set before that lands somewhere else.
        Self.place(window)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        return view
    }

    /// The same message, written in a tab of the window it was asked from.
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

    /// The page, held in a plain view with room above it for the band.
    private static func contents(around view: WKWebView, size: NSSize) -> NSView {
        let container = NSView(frame: NSRect(origin: .zero, size: size))
        view.frame = container.bounds
        view.autoresizingMask = [.width, .height]
        container.addSubview(view)
        let label = NSTextField(labelWithString: "")
        label.identifier = recipientsID
        label.alignment = .center
        label.lineBreakMode = .byTruncatingTail
        label.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        label.autoresizingMask = [.width, .minYMargin]
        container.addSubview(label)
        return container
    }

    // A window opened for a page Fastmail asked for shares its own
    // WKUserContentController with the page that asked, rather than getting
    // one of its own; that page hands out the same controller again for
    // every message it pops out, so a second popout must not add the
    // handler again or WKUserContentController raises "already added".
    private static var watchedControllers: Set<ObjectIdentifier> = []

    private static func watchRecipients(
        in controller: WKUserContentController,
        reportingTo handler: ComposeWindows
    ) {
        guard watchedControllers.insert(ObjectIdentifier(controller)).inserted else { return }
        controller.add(handler, name: "fmshellRecipients")
        controller.addUserScript(recipientUserScript)
    }

    // Every frame, not only the page's own: a message's body is shown in one
    // of its own, and printing is asked for from in there.
    private static var recipientUserScript: WKUserScript {
        WKUserScript(source: recipientScript, injectionTime: .atDocumentEnd, forMainFrameOnly: false)
    }

    /// The scripts a pool window's pages load with. A WKUserContentController
    /// cannot take back a single script, so the set is laid down afresh; which
    /// is only ever done to a pool window's own controller, never to one a
    /// popout shares with the page it came from.
    static func useScripts(pooled: Bool, in controller: WKUserContentController) {
        controller.removeAllUserScripts()
        controller.addUserScript(recipientUserScript)
        controller.addUserScript(WKUserScript(
            source: notificationScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        guard pooled else { return }
        // Ahead of Fastmail, which says hello as soon as it starts.
        controller.addUserScript(WKUserScript(
            source: poolScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
    }

    /// Puts a window's page on the roll call: the page already there says
    /// hello, and pages it loads from here on carry no pool script.
    static func leavePool(_ window: NSWindow) {
        guard let view = webView(of: window) else { return }
        useScripts(pooled: false, in: view.configuration.userContentController)
        view.evaluateJavaScript("window.fmshellLeavePool&&window.fmshellLeavePool()")
    }

    private func makeWindow() -> NSWindow {
        let configuration = WKWebViewConfiguration()
        #if os(macOS)
        // Its service worker takes its user agent from whichever client
        // started it.
        configuration.applicationNameForUserAgent = WebContainer.electronUserAgentToken
        #endif
        configuration.websiteDataStore = .default()
        let controller = WKUserContentController()
        Self.watchRecipients(in: controller, reportingTo: self)
        configuration.userContentController = controller
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isInspectable = true
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.ownSize),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.title = "New Message"
        window.contentView = Self.contents(around: view, size: Self.ownSize)
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
