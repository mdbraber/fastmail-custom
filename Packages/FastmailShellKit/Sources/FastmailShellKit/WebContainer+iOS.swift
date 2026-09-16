#if canImport(UIKit)
import SwiftUI
import WebKit

extension WebContainer: UIViewRepresentable {
    public func makeCoordinator() -> WebCoordinator {
        WebCoordinator(model: model, startURL: loadURL)
    }

    public func makeUIView(context: Context) -> KeyboardFocusView {
        KeyboardFocusView(webView: makeWebView(coordinator: context.coordinator))
    }

    public func updateUIView(_ uiView: KeyboardFocusView, context: Context) {}
}

/// Holds the web view and keeps the keyboard on it. A hardware keyboard's keys
/// reach the page only while the web view is first responder, and on iPad
/// nothing made it so but a tap the page let through. Fastmail cancels the
/// touch of nearly every tap it handles itself, a message row's among them,
/// so tapping around the list never handed the keyboard over, and j, k or c
/// did nothing until a tap happened to land on plain text.
///
/// The tap is watched from this view rather than from the web view: WebKit
/// holds back every gesture recognizer on the web view until the page has
/// answered the touch, and fails them when the page cancels it.
@MainActor
public final class KeyboardFocusView: UIView, UIGestureRecognizerDelegate {
    let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        webView.frame = bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(webView)

        // Only watches: the page still gets every touch, when it would have
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesEnded = false
        tap.delegate = self
        addGestureRecognizer(tap)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    /// On screen, the keyboard goes to the page straight away, so a shortcut
    /// works before anything has been tapped. A beat later, once the window
    /// has become key.
    override public func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { return }
        DispatchQueue.main.async { [weak self] in self?.takeKeyboard() }
    }

    @objc private func tapped() {
        takeKeyboard()
    }

    /// Only while this window is key. While the screen lock is up its cover's
    /// window is, and the keyboard stays there rather than reaching the mail
    /// behind it.
    private func takeKeyboard() {
        guard window?.isKeyWindow == true else { return }
        webView.becomeFirstResponder()
    }

    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}
#endif
