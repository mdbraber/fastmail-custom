import Foundation

public enum ThemeColor {
    public static func components(fromHex hex: String) -> (Double, Double, Double)? {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value.hasPrefix("#") { value.removeFirst() }
        if value.count == 3 {
            value = value.map { "\($0)\($0)" }.joined()
        }
        guard value.count == 6, value.allSatisfy({ $0.isHexDigit }) else { return nil }
        guard let number = UInt32(value, radix: 16) else { return nil }
        return (
            Double((number >> 16) & 0xff) / 255.0,
            Double((number >> 8) & 0xff) / 255.0,
            Double(number & 0xff) / 255.0
        )
    }

    public static func isDark(_ rgb: (Double, Double, Double)) -> Bool {
        0.2126 * rgb.0 + 0.7152 * rgb.1 + 0.0722 * rgb.2 < 0.5
    }
}
