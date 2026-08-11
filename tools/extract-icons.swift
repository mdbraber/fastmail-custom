import AppKit
import Foundation

struct Source {
    let app: String
    let target: String
}

let sources = [
    Source(app: "/Users/mdbraber/Applications/mdbraber.com.app", target: "Apps/Personal"),
    Source(app: "/Users/mdbraber/Applications/nexthealth.nl.app", target: "Apps/Work")
]

func render(_ image: NSImage, size: CGFloat, opaque: Bool, bleed: CGFloat) -> Data {
    let pixels = Int(size)
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixels,
        pixelsHigh: pixels,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let full = NSRect(x: 0, y: 0, width: size, height: size)
    if opaque {
        NSColor.white.setFill()
        full.fill()
    }
    let inset = -size * (bleed - 1) / 2
    image.draw(in: full.insetBy(dx: inset, dy: inset))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let contents = """
{
  "images" : [
    {
      "filename" : "icon-ios.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "filename" : "icon-mac.png",
      "idiom" : "mac",
      "scale" : "1x",
      "size" : "512x512"
    }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
"""

for source in sources {
    let icon = NSWorkspace.shared.icon(forFile: source.app)
    let set = "\(source.target)/Assets.xcassets/AppIcon.appiconset"
    try! FileManager.default.createDirectory(atPath: set, withIntermediateDirectories: true)
    try! render(icon, size: 1024, opaque: true, bleed: 1.18)
        .write(to: URL(fileURLWithPath: "\(set)/icon-ios.png"))
    try! render(icon, size: 512, opaque: false, bleed: 1.0)
        .write(to: URL(fileURLWithPath: "\(set)/icon-mac.png"))
    try! contents.write(toFile: "\(set)/Contents.json", atomically: true, encoding: .utf8)

    let root = "\(source.target)/Assets.xcassets"
    try! "{\n  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 }\n}"
        .write(toFile: "\(root)/Contents.json", atomically: true, encoding: .utf8)
    print("wrote \(set)")
}
