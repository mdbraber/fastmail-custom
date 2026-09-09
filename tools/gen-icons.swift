import AppKit
import Foundation

// Draws the shell apps' icons as vectors, in every iOS 18 appearance.

struct Palette {
    let fieldDark: NSColor
    let fieldLight: NSColor
    // The mark's large triangle on the white disc; the small one is yellow
    // everywhere, and in the dark variant the large one goes white
    let markDark: NSColor
    // Tinted is grayscale and iOS colours every icon the same, so two apps
    // sharing the mark would be twins.
    let tintedRing: Bool
}

let markYellow = hex("#F7C951")  // Fastmail's own

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
        markDark: hex("#506632"), tintedRing: false)),
    ("nexthealth.nl", "Work", Palette(
        fieldDark: hex("#377BC4"), fieldLight: hex("#79BFEB"),
        markDark: hex("#424F59"), tintedRing: true)),
]

// Geometry, in unit coordinates with y down. The mark is a box: a light
// triangle on its left half with the apex at the centre, and a dark triangle
// whose hypotenuse runs from the bottom-left corner to the top-right one.
struct Mark { let x0, x1, y0, y1: CGFloat }
struct Geometry {
    let split: (left: CGFloat, right: CGFloat)  // where the split meets each edge
    let mark: Mark
}

let discRadius: CGFloat = 0.30
// On the disc, measured off the old rasters
let onDisc = Geometry(split: (0.81, 0.185), mark: Mark(x0: 0.322, x1: 0.676, y0: 0.39, y1: 0.607))
// In the dark circle, measured off Fastmail's own dark icon: the circle is
// three quarters the icon wide, the split passes through its centre, and the
// mark grows to 43% of the icon wide, its hypotenuse still on the split.
let circleRadius: CGFloat = 0.375
let inCircle = Geometry(split: (0.835, 0.165), mark: Mark(x0: 0.285, x1: 0.715, y0: 0.356, y1: 0.644))

// The light icon is opaque; iOS wants the primary icon without an alpha
// channel; while the dark and tinted ones are drawn on transparency.
func bitmap(_ size: Int, alpha: Bool = true) -> NSBitmapImageRep {
    // Always 32 bits a pixel: an opaque icon is RGB with a padding byte, the
    // one alpha-free layout a drawing context accepts, and its PNG still comes
    // out without an alpha channel.
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

/// One icon. `field` nil leaves the background transparent; a field fills the
/// icon, which is then opaque and rendered without an alpha channel, unless
/// `clipRadius` cuts it to a circle on transparency.
func icon(size: Int, field: (NSColor, NSColor)?, clipRadius: CGFloat? = nil, disc: NSColor?,
          geometry: Geometry, markLight: NSColor, markDark: NSColor, ring: Bool = false) -> NSBitmapImageRep {
    let rep = bitmap(size, alpha: field == nil || clipRadius != nil)
    draw(into: rep) { s in
        // Unit coords, y down → AppKit
        func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x * s, y: (1 - y) * s) }
        func circle(_ radius: CGFloat) -> NSBezierPath {
            let r = s * radius
            return NSBezierPath(ovalIn: NSRect(x: s / 2 - r, y: s / 2 - r, width: 2 * r, height: 2 * r))
        }

        if let (dark, light) = field {
            NSGraphicsContext.saveGraphicsState()
            if let clipRadius { circle(clipRadius).addClip() }
            defer { NSGraphicsContext.restoreGraphicsState() }

            dark.setFill()
            NSRect(x: 0, y: 0, width: s, height: s).fill()

            let split = geometry.split
            let lower = NSBezierPath()
            lower.move(to: p(0, split.left))
            lower.line(to: p(1, split.right))
            lower.line(to: p(1, 1))
            lower.line(to: p(0, 1))
            lower.close()
            light.setFill()
            lower.fill()

            // The faint highlight the original carries along the split
            let edge = NSBezierPath()
            edge.move(to: p(0, split.left))
            edge.line(to: p(1, split.right))
            edge.lineWidth = s * 0.004
            light.blended(withFraction: 0.45, of: .white)!.setStroke()
            edge.stroke()
        }

        if let disc {
            let path = circle(discRadius)
            if ring {
                path.lineWidth = s * 0.055
                disc.setStroke()
                path.stroke()
            } else {
                disc.setFill()
                path.fill()
            }
        }

        let mark = geometry.mark
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

enum Variant { case light, dark, tinted }

func render(_ variant: Variant, _ pal: Palette, size: Int = 1024) -> NSBitmapImageRep {
    switch variant {
    case .light:
        return icon(size: size, field: (pal.fieldDark, pal.fieldLight), disc: .white,
                    geometry: onDisc, markLight: markYellow, markDark: pal.markDark)
    case .dark:
        // The mark straight on the halves: its hypotenuse lies on the split,
        // so the yellow triangle sits on the dark half and the white one on
        // the light half
        return icon(size: size, field: (pal.fieldDark, pal.fieldLight), clipRadius: circleRadius, disc: nil,
                    geometry: inCircle, markLight: markYellow, markDark: .white)
    case .tinted:
        // Grayscale for iOS to colour, light on transparency. A filled white
        // disc carries the mark in grays; a ring carries it in light tones.
        return pal.tintedRing
            ? icon(size: size, field: nil, disc: .white,
                   geometry: onDisc, markLight: hex("#BDBDBD"), markDark: .white, ring: true)
            : icon(size: size, field: nil, disc: .white,
                   geometry: onDisc, markLight: hex("#BDBDBD"), markDark: hex("#4A4A4A"))
    }
}

func png(_ rep: NSBitmapImageRep) -> Data { rep.representation(using: .png, properties: [:])! }

// ----------------------------------------------------------------------
// Preview: every variant of both apps on a dark home screen, corners
// rounded, the dark ones over iOS's dark gradient and the tinted one as
// iOS would colour it with a sample tint.
// ----------------------------------------------------------------------

func preview(to path: String) {
    let columns: [(header: String, variant: Variant)] = [
        ("Light", .light), ("Dark", .dark), ("Tinted (sample tint)", .tinted),
    ]
    let tile = 220, gap = 36, labelH = 34, nameW = 150
    let rows = apps.count
    let width = nameW + columns.count * (tile + gap) + gap
    let height = gap + 40 + rows * (tile + labelH + gap)
    let rep = bitmap(max(width, height))  // square is fine; we only use the top-left
    draw(into: rep) { side in
        hex("#000000").setFill()
        NSRect(x: 0, y: 0, width: side, height: side).fill()

        let font = NSFont.systemFont(ofSize: 18, weight: .medium)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white]

        for (row, app) in apps.enumerated() {
            let y = side - CGFloat(gap + 40 + row * (tile + labelH + gap)) - CGFloat(tile)
            NSAttributedString(string: app.name, attributes: attrs)
                .draw(at: NSPoint(x: CGFloat(gap), y: y + CGFloat(tile) / 2 - 10))

            for (col, column) in columns.enumerated() {
                let x = CGFloat(nameW + gap + col * (tile + gap))
                let rect = NSRect(x: x, y: y, width: CGFloat(tile), height: CGFloat(tile))

                NSGraphicsContext.saveGraphicsState()
                NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.height * 0.225).addClip()
                if column.variant != .light {
                    // iOS's dark icon background
                    NSGradient(starting: hex("#2C2C2E"), ending: hex("#0B0B0C"))!.draw(in: rect, angle: -90)
                }
                let img = NSImage(size: rect.size)
                img.addRepresentation(render(column.variant, app.palette, size: tile))
                img.draw(in: rect)
                if column.variant == .tinted {
                    // What iOS makes of the grayscale: white takes the tint,
                    // the grays a darker tint, a multiply with a sample blue
                    hex("#6C8CFF").setFill()
                    rect.fill(using: .multiply)
                }
                NSGraphicsContext.restoreGraphicsState()

                if row == 0 {
                    NSAttributedString(string: column.header, attributes: attrs)
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

func install() {
    for app in apps {
        let set = "Apps/\(app.target)/Assets.xcassets/AppIcon.appiconset"
        try! png(render(.light, app.palette)).write(to: URL(fileURLWithPath: "\(set)/icon-ios.png"))
        try! png(render(.dark, app.palette)).write(to: URL(fileURLWithPath: "\(set)/icon-ios-dark.png"))
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
    install()
default:
    print("usage: swift tools/gen-icons.swift preview <outdir> | install")
}
