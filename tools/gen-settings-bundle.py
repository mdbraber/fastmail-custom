#!/usr/bin/env python3
"""Regenerate each app's Settings.bundle/Root.plist from the option catalog.

The catalog is CustomModeSettings.options, the same one the macOS Settings
form and the page injection read, so it is parsed here rather than copied:
a second table would be one more thing to keep in step, and the whole point
of the catalog is that there is only one. Run this after changing it,
`settingsBundleCarriesEveryCustomModeOption` fails if you forget.

Settings.bundle cannot grey a sub-option out with its parent, so the parent
relationship the form uses is dropped here; the hint carries the meaning.
"""
import plistlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = (ROOT / "Packages/FastmailShellKit/Sources/FastmailShellKit"
                  "/CustomModeSettings.swift")
APPS = ("Personal", "Work")

# One Option(...) entry. `parent:` and `clearable:` are optional and
# deliberately unused here; Settings.bundle greys nothing out, and a text
# field emptied there reaches UserDefaults as an empty string regardless,
# which is exactly what `clearable` asks the resolver to honour. The default
# is a .toggle(bool) or a .text("string").
OPTION = re.compile(
    r'Option\(\s*'
    r'"(?P<key>\w+)",\s*'
    r'group:\s*\.(?P<group>\w+),\s*'
    r'(?:parent:\s*"\w+",\s*)?'
    r'(?:clearable:\s*(?:true|false),\s*)?'
    r'title:\s*"(?P<title>[^"]*)",\s*'
    r'hint:\s*"(?P<hint>[^"]*)",\s*'
    r'default:\s*\.(?:toggle\((?P<toggle>true|false)\)'
    r'|text\("(?P<text>[^"]*)"\))',
    re.S,
)

# The section header each group shows, mirroring CustomModeSettings.Group.title.
# `settingsBundleShowsEveryGroupHeader` fails if these drift. `general` is the
# shell's own section (backend, start page), so its header sits on the first
# hardcoded row and its one catalog option continues under it without a new one.
GROUP_TITLE = {
    "general": "General",
    "appearance": "Appearance",
    "labelsFiling": "Labels & keeping",
    "snooze": "Snooze",
    "keyboard": "Keyboard",
    "bottomBar": "Action bar",
}


def options():
    source = CATALOG.read_text(encoding="utf-8")
    found = []

    for match in OPTION.finditer(source):
        default = (match["toggle"] == "true" if match["toggle"]
                   else match["text"])
        found.append((match["key"], match["group"], default,
                      match["title"], match["hint"]))

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
            "Title": GROUP_TITLE["general"],
            "FooterText": "Beta is Fastmail's test server, with its own "
            "sign-in and settings. Switching reloads the page and asks you "
            "to log in again.",
        },
        {
            "Type": "PSMultiValueSpecifier",
            "Title": "Backend",
            "Key": "backend",
            # Backend.standard in the app; both shells run against beta
            "DefaultValue": "beta",
            "Titles": ["Production", "Beta"],
            "Values": ["production", "beta"],
        },
        {
            "Type": "PSGroupSpecifier",
            "FooterText": "The path to open, such as /mail/Inbox. Empty opens "
            "the default view. Takes effect on the next launch.",
        },
        {
            "Type": "PSTextFieldSpecifier",
            "Title": "Start page",
            "Key": "startView",
            "DefaultValue": "",
            "IsSecure": False,
            "KeyboardType": "URL",
            "AutocapitalizationType": "None",
            "AutocorrectionType": "No",
        },
    ]

    # Read by PushRegistrar under PushPreferences.alertsKey; the badge is
    # not part of the switch. Sits between General and the inbox groups,
    # where the in-app sheet has it.
    notifications = [
        {
            "Type": "PSGroupSpecifier",
            "Title": "Notifications",
            "FooterText": "Off stops the banners for new mail on this "
            "device. The badge keeps counting, and other devices are not "
            "affected.",
        },
        {
            "Type": "PSToggleSwitchSpecifier",
            "Title": "Notify for new mail",
            "Key": "push.alerts",
            "DefaultValue": True,
        },
    ]

    # The General header is already on the backend row above, and start page
    # and the app badge continue under it, so the first header we add is for
    # the group after general.
    last_group = "general"
    for key, group_key, default, title, hint in catalog:
        group = {"Type": "PSGroupSpecifier", "FooterText": hint}
        if group_key != last_group:
            if last_group == "general":
                rows.extend(notifications)
            group["Title"] = GROUP_TITLE[group_key]
            last_group = group_key
        rows.append(group)

        if isinstance(default, bool):
            rows.append({
                "Type": "PSToggleSwitchSpecifier",
                "Title": title,
                "Key": f"customMode.{key}",
                "DefaultValue": default,
            })
        else:
            rows.append({
                "Type": "PSTextFieldSpecifier",
                "Title": title,
                "Key": f"customMode.{key}",
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
