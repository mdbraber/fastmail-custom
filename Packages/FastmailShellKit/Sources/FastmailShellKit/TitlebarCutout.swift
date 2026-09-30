#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
import ObjectiveC
import WebKit

/// Lets a popover from the page's header lie over the tab bar, as Safari's
/// address suggestions do. The tab bar belongs to the title bar, which AppKit
/// keeps above the content, so nothing the page draws can cover it; instead
/// the popover's shape is cut out of the title bar, for drawing and for
/// clicks, while it is open. The title bar's container is a private view,
/// found by its class name; without it nothing is cut and the page moves the
/// popover below the tabs itself.
@MainActor
enum TitlebarCutout {
    private static let containerClassName = "NSTitlebarContainerView"
    nonisolated(unsafe) private static var holeKey: UInt8 = 0

    /// Cuts `rect`, given in the page's coordinates, out of the title bar of
    /// the window showing `webView`, or closes the cut with no rect. Answers
    /// whether the popover can be seen over the tab bar.
    static func show(_ rect: CGRect?, radius: CGFloat, of webView: WKWebView) -> Bool {
        guard let window = webView.window, let container = titlebarContainer(of: window) else { return false }
        guard let rect, window.tabGroup?.isTabBarVisible == true else {
            close(container)
            return true
        }
        guard catchClicks(on: type(of: container)), let layer = container.layer else { return false }

        let inView = webView.isFlipped
            ? rect
            : CGRect(x: rect.minX, y: webView.bounds.height - rect.maxY, width: rect.width, height: rect.height)
        let hole = webView.convert(inView, to: container)

        let path = CGMutablePath()
        path.addRect(container.bounds)
        let corner = min(radius, hole.width / 2, hole.height / 2)
        path.addRoundedRect(in: hole, cornerWidth: corner, cornerHeight: corner)
        let mask = (layer.mask as? CAShapeLayer) ?? CAShapeLayer()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        mask.fillRule = .evenOdd
        mask.frame = container.bounds
        mask.path = path
        layer.mask = mask
        CATransaction.commit()

        // Clicks are asked of the title bar in its parent's coordinates
        objc_setAssociatedObject(
            container, &holeKey,
            NSValue(rect: container.convert(hole, to: container.superview)),
            .OBJC_ASSOCIATION_RETAIN_NONATOMIC
        )
        return true
    }

    private static func close(_ container: NSView) {
        container.layer?.mask = nil
        objc_setAssociatedObject(container, &holeKey, nil, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    private static func titlebarContainer(of window: NSWindow) -> NSView? {
        window.contentView?.superview?.subviews.first {
            NSStringFromClass(type(of: $0)) == containerClassName
        }
    }

    /// A mask hides the title bar but still lets it take the clicks, so its
    /// hit test is taught to pass over the hole, leaving the click to the
    /// page below. Swapped once, for the title bar's own class; one with no
    /// hole goes on as before.
    private static var catchesClicks = false

    private static func catchClicks(on type: AnyClass) -> Bool {
        if catchesClicks { return true }
        let selector = #selector(NSView.hitTest(_:))
        guard let method = class_getInstanceMethod(type, selector) else { return false }

        typealias HitTest = @convention(c) (NSView, Selector, NSPoint) -> NSView?
        let original = unsafeBitCast(method_getImplementation(method), to: HitTest.self)
        let replacement: @convention(block) (NSView, NSPoint) -> NSView? = { view, point in
            if let hole = objc_getAssociatedObject(view, &holeKey) as? NSValue, hole.rectValue.contains(point) {
                return nil
            }
            return original(view, selector, point)
        }
        let implementation = imp_implementationWithBlock(replacement)
        // Added to the class itself when it only inherits the method, so
        // every other view keeps NSView's own
        if !class_addMethod(type, selector, implementation, method_getTypeEncoding(method)) {
            method_setImplementation(method, implementation)
        }
        catchesClicks = true
        return true
    }
}
#endif
