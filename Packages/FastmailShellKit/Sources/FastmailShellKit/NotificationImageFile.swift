#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit

/// The sender's picture as a file a notification can attach, which macOS
/// shows beside the text.
///
/// An attachment has to be a file, and of images only PNG, JPEG and GIF are
/// taken; anything else the page hands over (a sender's BIMI logo is SVG) is
/// drawn into a PNG first. Whatever does not decode as an image is left out,
/// and the notification goes without a picture.
enum NotificationImageFile {
    /// The size Fastmail's service worker asks contact photos at
    static let side: CGFloat = 212

    static var directory: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("NotificationImages", isDirectory: true)
    }

    static func write(_ image: NotificationImage, into directory: URL = directory) -> URL? {
        guard let decoded = NSImage(data: image.data), decoded.size.width > 0, decoded.size.height > 0 else {
            return nil
        }
        let stored: (data: Data, pathExtension: String)?
        switch image.mediaType {
        case "image/png": stored = (image.data, "png")
        case "image/jpeg": stored = (image.data, "jpg")
        case "image/gif": stored = (image.data, "gif")
        default: stored = png(of: decoded).map { ($0, "png") }
        }
        guard let stored else { return nil }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(stored.pathExtension)
            try stored.data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    /// Drawn at `side` along its longer edge, keeping its shape
    static func png(of image: NSImage) -> Data? {
        let scale = side / max(image.size.width, image.size.height)
        let width = max(1, Int((image.size.width * scale).rounded()))
        let height = max(1, Int((image.size.height * scale).rounded()))
        guard
            let bitmap = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
            ),
            let context = NSGraphicsContext(bitmapImageRep: bitmap)
        else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        image.draw(in: NSRect(x: 0, y: 0, width: width, height: height))
        NSGraphicsContext.restoreGraphicsState()
        return bitmap.representation(using: .png, properties: [:])
    }
}
#endif
