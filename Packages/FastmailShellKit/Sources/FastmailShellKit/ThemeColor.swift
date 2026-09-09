import Foundation

public enum ThemeColor {
    public static func components(from value: String) -> (Double, Double, Double)? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("rgb") { return componentsFromFunctional(trimmed) }
        return components(fromHex: trimmed)
    }

    static func componentsFromFunctional(_ value: String) -> (Double, Double, Double)? {
        guard let open = value.firstIndex(of: "("), let close = value.lastIndex(of: ")") else {
            return nil
        }
        let parts = value[value.index(after: open)..<close]
            .split(whereSeparator: { $0 == "," || $0 == "/" || $0 == " " })
            .map { String($0) }
            .filter { !$0.isEmpty }
        guard parts.count >= 3 else { return nil }
        let channels = parts.prefix(3).compactMap { Double($0) }
        guard channels.count == 3, channels.allSatisfy({ $0 >= 0 && $0 <= 255 }) else { return nil }
        if parts.count >= 4 {
            guard let alpha = Double(parts[3]), alpha >= 0.99 else { return nil }
        }
        return (channels[0] / 255.0, channels[1] / 255.0, channels[2] / 255.0)
    }

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
}
