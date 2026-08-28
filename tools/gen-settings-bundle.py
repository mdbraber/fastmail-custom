#!/usr/bin/env python3
"""Regenerate each app's Settings.bundle/Root.plist from the option catalog.

The catalog is InboxModeSettings.options, the same one the macOS Settings
form and the page injection read, so it is parsed here rather than copied:
a second table would be one more thing to keep in step, and the whole point
of the catalog is that there is only one. Run this after changing it —
`settingsBundleCarriesEveryInboxModeOption` fails if you forget.

Settings.bundle cannot grey a sub-option out with its parent, so the parent
relationship the form uses is dropped here; the hint carries the meaning.
"""
import plistlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = (ROOT / "Packages/FastmailShellKit/Sources/FastmailShellKit"
                  "/InboxModeSettings.swift")
APPS = ("Personal", "Work")

# One Option(...) entry. `parent:` and `clearable:` are optional and
# deliberately unused here — Settings.bundle greys nothing out, and a text
# field emptied there reaches UserDefaults as an empty string regardless,
# which is exactly what `clearable` asks the resolver to honour. The default
# is a .toggle(bool) or a .text("string").
OPTION = re.compile(
    r'Option\(\s*'
    r'"(?P<key>\w+)",\s*'
    r'(?:parent:\s*"\w+",\s*)?'
    r'(?:clearable:\s*(?:true|false),\s*)?'
    r'title:\s*"(?P<title>[^"]*)",\s*'
    r'hint:\s*"(?P<hint>[^"]*)",\s*'
    r'default:\s*\.(?:toggle\((?P<toggle>true|false)\)'
    r'|text\("(?P<text>[^"]*)"\))',
    re.S,
)


def options():
    source = CATALOG.read_text(encoding="utf-8")
    found = []

    for match in OPTION.finditer(source):
        default = (match["toggle"] == "true" if match["toggle"]
                   else match["text"])
        found.append((match["key"], default, match["title"], match["hint"]))

    # A catalog that stopped parsing would otherwise write a plist with the
    # options silently missing, and the guard test is the only thing that
    # would notice
    declared = source.count("Option(")
    if len(found) != declared:
        sys.exit(f"error: parsed {len(found)} of {declared} options in "
                 f"{CATALOG.name}; the Option(...) shape has changed")

    return found


def specifiers(catalog):
    rows = [
        {
            "Type": "PSGroupSpecifier",
            "FooterText": "The full address to open, for example "
            "https://app.fastmail.com/mail/Archive. Must be on "
            "app.fastmail.com. Leave empty for the default view. Takes "
            "effect next time the app starts.",
        },
        {
            "Type": "PSTextFieldSpecifier",
            "Title": "Start URL",
            "Key": "startView",
            "DefaultValue": "",
            "IsSecure": False,
            "KeyboardType": "URL",
            "AutocapitalizationType": "None",
            "AutocorrectionType": "No",
        },
    ]

    for index, (key, default, title, hint) in enumerate(catalog):
        group = {"Type": "PSGroupSpecifier", "FooterText": hint}
        if index == 0:
            group["Title"] = "Inbox mode"
        rows.append(group)

        if isinstance(default, bool):
            rows.append({
                "Type": "PSToggleSwitchSpecifier",
                "Title": title,
                "Key": f"inboxMode.{key}",
                "DefaultValue": default,
            })
        else:
            rows.append({
                "Type": "PSTextFieldSpecifier",
                "Title": title,
                "Key": f"inboxMode.{key}",
                "DefaultValue": default,
                "IsSecure": False,
                "AutocapitalizationType": "None",
                "AutocorrectionType": "No",
            })

    return rows


def main():
    catalog = options()
    root = {"PreferenceSpecifiers": specifiers(catalog)}

    for app in APPS:
        path = ROOT / "Apps" / app / "Settings.bundle" / "Root.plist"
        with open(path, "wb") as handle:
            plistlib.dump(root, handle, sort_keys=False)
        print(f"wrote {path.relative_to(ROOT)}")

    print(f"{len(catalog)} options from {CATALOG.name}")


if __name__ == "__main__":
    main()
