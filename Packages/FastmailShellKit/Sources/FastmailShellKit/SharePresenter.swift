import Combine
import SwiftUI
import WebKit

#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

public struct ShareRequest: Identifiable {
    public let id = UUID()
    public let url: URL?
    public let text: String?
    public let sourceRect: CGRect?
    public let completion: @MainActor () -> Void

    var items: [Any] {
        var items: [Any] = []
        if let text, !text.isEmpty { items.append(text) }
        if let url { items.append(url) }
        return items
    }
}

@MainActor
final class SharePresenter: NSObject {
    private weak var webView: WKWebView?
    private let model: ShellModel
    private var subscription: AnyCancellable?
    #if !canImport(UIKit)
    private var activePicker: NSSharingServicePicker?
    private var activeCompletion: (@MainActor () -> Void)?
    #endif

    init(model: ShellModel, webView: WKWebView) {
        self.model = model
        self.webView = webView
        super.init()
        subscription = model.$shareRequest
            .compactMap { $0 }
            .sink { [weak self] request in
                self?.present(request)
            }
    }

    private func anchor(for request: ShareRequest) -> CGRect {
        guard let webView else { return .zero }
        if let rect = request.sourceRect, webView.bounds.intersects(rect) {
            return rect
        }
        return CGRect(x: webView.bounds.midX - 1, y: webView.bounds.midY - 1, width: 2, height: 2)
    }

    private func finish(_ request: ShareRequest) {
        if model.shareRequest?.id == request.id {
            model.shareRequest = nil
        }
        request.completion()
    }

    private func present(_ request: ShareRequest) {
        guard let webView, !request.items.isEmpty else {
            finish(request)
            return
        }
        #if canImport(UIKit)
        guard let presenter = topViewController() else {
            finish(request)
            return
        }
        let controller = UIActivityViewController(
            activityItems: request.items, applicationActivities: nil
        )
        controller.completionWithItemsHandler = { [weak self] _, _, _, _ in
            self?.finish(request)
        }
        if let popover = controller.popoverPresentationController {
            popover.sourceView = webView
            popover.sourceRect = anchor(for: request)
        }
        presenter.present(controller, animated: true)
        #else
        let picker = NSSharingServicePicker(items: request.items)
        picker.delegate = self
        activePicker = picker
        activeCompletion = { [weak self] in self?.finish(request) }
        picker.show(relativeTo: anchor(for: request), of: webView, preferredEdge: .minY)
        #endif
    }

    #if canImport(UIKit)
    private func topViewController() -> UIViewController? {
        var top = webView?.window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
    #endif
}

#if !canImport(UIKit)
extension SharePresenter: @preconcurrency NSSharingServicePickerDelegate {
    func sharingServicePicker(
        _ sharingServicePicker: NSSharingServicePicker,
        didChoose service: NSSharingService?
    ) {
        sharingServicePicker.delegate = nil
        activePicker = nil
        let done = activeCompletion
        activeCompletion = nil
        done?()
    }
}
#endif
