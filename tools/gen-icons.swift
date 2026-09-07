import AppKit
import Foundation

// Draws the shell apps' icons as vectors, in every iOS 18 appearance.
//
// The design is Fastmail's own: a two-tone diagonal field, a white disc, and
// the "M" mark — two triangles. The old icons were rasters lifted from the
// macOS apps (extract-icons.swift), soft at the edges and with no way to make
// a dark variant; this draws the same geometry crisply from a palette.
//
// Light keeps the field. Dark drops it — iOS paints its own dark background
// behind a transparent icon — and either keeps the white disc (--disc white)
// or paints the disc in the brand colour, as Fastmail's own dark icon does
// (--disc brand, the default). Tinted is grayscale on transparency, for iOS to
// colour with the user's tint.
//
//   swift tools/gen-icons.swift preview <outdir>     every variant + preview.png
//   swift tools/gen-icons.swift install [--disc brand|white]
//                                                    writes the app icon sets
//
// The Mac icon (icon-mac.png) is left alone: this is about the phone.

struct Palette {
    let fieldDark: NSColor
    let fieldLight: NSColor
    // The mark on the white disc
    let markLight: NSColor
    let markDark: NSColor
    // The mark on the brand-coloured disc of the dark variant
    let brandMarkLight: NSColor
    let brandMarkDark: NSColor
    // Tinted is grayscale and iOS colours every icon the same, so two apps
    // sharing the mark would be twins; one of them inverts — dark disc,
    // light mark — to stay telling apart.
    let tintedInverted: Bool
}

func hex(_ s: String) -> NSColor {
    let v = UInt32(s.dropFirst(), radix: 16)!
    return NSColor(
        srgbRed: CGFloat((v >> 16) & 0xFF) / 255,
        green: CGFloat((v >> 8) & 0xFF) / 255,
        blue: CGFloat(v & 0xFF) / 255,
        alpha: 1
    )
}

let apps: [(name: String, target: String, palette: Palette)] = [
    ("mdbraber.com", "Personal", Palette(
        fieldDark: hex("#88AA56"), fieldLight: hex("#B7D097"),
        markLight: hex("#AFCA88"), markDark: hex("#506632"),
        brandMarkLight: .white, brandMarkDark: hex("#3F5327"), tintedInverted: false)),
    ("nexthealth.nl", "Work", Palette(
        fieldDark: hex("#377BC4"), fieldLight: hex("#79BFEB"),
        markLight: hex("#F7C951"), markDark: hex("#424F59"),
        brandMarkLight: hex("#F7C951"), brandMarkDark: .white, tintedInverted: true)),
]

// Geometry, in unit coordinates with y down, measured off the old rasters.
let discRadius: CGFloat = 0.30
let mark = (x0: CGFloat(0.322), x1: CGFloat(0.676), y0: CGFloat(0.39), y1: CGFloat(0.607))
let diagonal = (left: CGFloat(0.81), right: CGFloat(0.185))  // where the split meets each edge

// The light icon is opaque — iOS wants the primary icon without an alpha
// channel — while the dark and tinted ones are drawn on transparency.
func bitmap(_ size: Int, alpha: Bool = true) -> NSBitmapImageRep {
    // Always 32 bits a pixel: an opaque icon is RGB with a padding byte, the
    // one alpha-free layout a drawing context accepts, and its PNG still
    // comes out without an alpha channel.
    NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: alpha ? 4 : 3, hasAlpha: alpha, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: size * 4, bitsPerPixel: 32
    )!
}

func draw(into rep: NSBitmapImageRep, _ body: (CGFloat) -> Void) {
    guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
        fatalError("no drawing context for a \(rep.bitsPerPixel)-bit, alpha=\(rep.hasAlpha) bitmap")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    body(CGFloat(rep.pixelsWide))
    NSGraphicsContext.restoreGraphicsState()
}

/// One icon. `field` nil leaves the background transparent; with a field
/// the icon is opaque and rendered without an alpha channel.
func icon(size: Int, field: (NSColor, NSColor)?, disc: NSColor, markLight: NSColor, markDark: NSColor) -> NSBitmapImageRep {
    let rep = bitmap(size, alpha: field == nil)
    draw(into: rep) { s in
        // Unit coords, y down → AppKit
        func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x * s, y: (1 - y) * s) }

        if let (dark, light) = field {
            dark.setFill()
            NSRect(x: 0, y: 0, width: s, height: s).fill()

            let lower = NSBezierPath()
            lower.move(to: p(0, diagonal.left))
            lower.line(to: p(1, diagonal.right))
            lower.line(to: p(1, 1))
            lower.line(to: p(0, 1))
            lower.close()
            light.setFill()
            lower.fill()

            // The faint highlight the original carries along the split
            let edge = NSBezierPath()
            edge.move(to: p(0, diagonal.left))
            edge.line(to: p(1, diagonal.right))
            edge.lineWidth = s * 0.004
            light.blended(withFraction: 0.45, of: .white)!.setStroke()
            edge.stroke()
        }

        let r = s * discRadius
        disc.setFill()
        NSBezierPath(ovalIn: NSRect(x: s / 2 - r, y: s / 2 - r, width: 2 * r, height: 2 * r)).fill()

        // The mark: a light triangle on the left, its apex on the centre,
        // and a dark triangle whose hypotenuse runs corner to corner
        let cx = (mark.x0 + mark.x1) / 2
        let cy = (mark.y0 + mark.y1) / 2
        let lightTri = NSBezierPath()
        lightTri.move(to: p(mark.x0, mark.y0))
        lightTri.line(to: p(mark.x0, mark.y1))
        lightTri.line(to: p(cx, cy))
        lightTri.close()
        markLight.setFill()
        lightTri.fill()

        let darkTri = NSBezierPath()
        darkTri.move(to: p(mark.x0, mark.y1))
        darkTri.line(to: p(mark.x1, mark.y1))
        darkTri.line(to: p(mark.x1, mark.y0))
        darkTri.close()
        markDark.setFill()
        darkTri.fill()
    }
    return rep
}

enum Variant { case light, darkWhiteDisc, darkBrandDisc, tinted }

func render(_ variant: Variant, _ pal: Palette, size: Int = 1024) -> NSBitmapImageRep {
    switch variant {
    case .light:
        return icon(size: size, field: (pal.fieldDark, pal.fieldLight), disc: .white,
                    markLight: pal.markLight, markDark: pal.markDark)
    case .darkWhiteDisc:
        return icon(size: size, field: nil, disc: .white,
                    markLight: pal.markLight, markDark: pal.markDark)
    case .darkBrandDisc:
        return icon(size: size, field: nil, disc: pal.fieldDark,
                    markLight: pal.brandMarkLight, markDark: pal.brandMarkDark)
    case .tinted:
        // Grayscale for iOS to colour. Inverted, the disc goes dark and the
        // mark's heavy triangle white — the shape its dark icon has.
        return pal.tintedInverted
            ? icon(size: size, field: nil, disc: hex("#4A4A4A"),
                   markLight: hex("#BDBDBD"), markDark: .white)
            : icon(size: size, field: nil, disc: .white,
                   markLight: hex("#BDBDBD"), markDark: hex("#4A4A4A"))
    }
}

func png(_ rep: NSBitmapImageRep) -> Data { rep.representation(using: .png, properties: [:])! }

// ----------------------------------------------------------------------
// Preview: every variant of both apps on a dark home screen, corners
// rounded, the dark ones over iOS's dark gradient and the tinted one as
// iOS would colour it with a sample tint.
// ----------------------------------------------------------------------

func preview(to path: String) {
    let tile = 220, gap = 36, labelH = 34, nameW = 150
    let cols = 4, rows = apps.count
    let width = nameW + cols * (tile + gap) + gap
    let height = gap + rows * (tile + labelH + gap) + 40
    let rep = bitmap(width) // square is fine; we only use the top part
    _ = height
    draw(into: rep) { _ in
        hex("#000000").setFill()
        NSRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(width)).fill()

        let font = NSFont.systemFont(ofSize: 18, weight: .medium)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white]
        let headers = ["Light", "Dark — white disc", "Dark — brand disc", "Tinted (sample tint)"]

        for (row, app) in apps.enumerated() {
            let y = CGFloat(width) - CGFloat(gap + 40 + row * (tile + labelH + gap)) - CGFloat(tile)
            NSAttributedString(string: app.name, attributes: attrs)
                .draw(at: NSPoint(x: CGFloat(gap), y: y + CGFloat(tile) / 2 - 10))

            let variants: [Variant] = [.light, .darkWhiteDisc, .darkBrandDisc, .tinted]
            for (col, variant) in variants.enumerated() {
                let x = CGFloat(nameW + gap + col * (tile + gap))
                let rect = NSRect(x: x, y: y, width: CGFloat(tile), height: CGFloat(tile))

                NSGraphicsContext.saveGraphicsState()
                NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.height * 0.225).addClip()
                if variant != .light {
                    // iOS's dark icon background
                    NSGradient(starting: hex("#2C2C2E"), ending: hex("#0B0B0C"))!.draw(in: rect, angle: -90)
                }
                let img = NSImage(size: rect.size)
                img.addRepresentation(render(variant, app.palette, size: tile))
                img.draw(in: rect)
                if variant == .tinted {
                    // What iOS makes of the grayscale: white takes the tint,
                    // the grays a darker tint — a multiply with a sample blue
                    hex("#6C8CFF").setFill()
                    rect.fill(using: .multiply)
                }
                NSGraphicsContext.restoreGraphicsState()

                if row == 0 {
                    NSAttributedString(string: headers[col], attributes: attrs)
                        .draw(at: NSPoint(x: x, y: y + CGFloat(tile) + 10))
                }
            }
        }
    }
    try! png(rep).write(to: URL(fileURLWithPath: path))
    print("wrote \(path)")
}

// ----------------------------------------------------------------------
// Install: the icon sets, with the appearance variants declared
// ----------------------------------------------------------------------

func install(disc: Variant) {
    for app in apps {
        let set = "Apps/\(app.target)/Assets.xcassets/AppIcon.appiconset"
        try! png(render(.light, app.palette)).write(to: URL(fileURLWithPath: "\(set)/icon-ios.png"))
        try! png(render(disc, app.palette)).write(to: URL(fileURLWithPath: "\(set)/icon-ios-dark.png"))
        try! png(render(.tinted, app.palette)).write(to: URL(fileURLWithPath: "\(set)/icon-ios-tinted.png"))

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
              "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
              "filename" : "icon-ios-dark.png",
              "idiom" : "universal",
              "platform" : "ios",
              "size" : "1024x1024"
            },
            {
              "appearances" : [ { "appearance" : "luminosity", "value" : "tinted" } ],
              "filename" : "icon-ios-tinted.png",
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
        try! contents.write(toFile: "\(set)/Contents.json", atomically: true, encoding: .utf8)
        print("wrote \(set)")
    }
}

let args = CommandLine.arguments.dropFirst()
switch args.first {
case "preview":
    let out = args.dropFirst().first ?? "."
    try! FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
    preview(to: "\(out)/preview.png")
case "install":
    let disc: Variant = args.contains("--disc") && args.last == "white" ? .darkWhiteDisc : .darkBrandDisc
    install(disc: disc)
default:
    print("usage: swift tools/gen-icons.swift preview <outdir> | install [--disc brand|white]")
}
