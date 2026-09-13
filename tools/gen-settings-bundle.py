#!/usr/bin/env python3
"""Regenerate each app's Settings.bundle/Root.plist.

Only the shell's own settings are here: the backend and the start page decide
whether a page can load at all, and the alerts switch belongs beside iOS's own
notification controls. Everything about the mail interface is in the page, in
Custom mode's own settings page, which is the same on every platform.

This stays a generator rather than two checked-in plists because the two apps
need identical copies, and `settingsBundleCarriesNoCustomModeRow` fails if
they drift.
"""
import plistlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPS = ("Personal", "Work")

SPECIFIERS = [
    {
        "Type": "PSGroupSpecifier",
        "Title": "General",
        "FooterText": "Beta is Fastmail's test server, with its own sign-in "
        "and settings. Switching reloads the page and asks you to log in "
        "again.",
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
        "FooterText": "The path to open, such as /mail/Inbox. Empty opens the "
        "default view. Takes effect on the next launch.",
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
    # Read by PushRegistrar under PushPreferences.alertsKey; the badge is not
    # part of the switch.
    {
        "Type": "PSGroupSpecifier",
        "Title": "Notifications",
        "FooterText": "Off stops the banners for new mail on this device. The "
        "badge keeps counting, and other devices are not affected.",
    },
    {
        "Type": "PSToggleSwitchSpecifier",
        "Title": "Notify for new mail",
        "Key": "push.alerts",
        "DefaultValue": True,
    },
    {
        "Type": "PSGroupSpecifier",
        "FooterText": "Everything else is in the Fastmail page, under "
        "Fastmail's own Settings, so it is the same on every device you use.",
    },
]


def main():
    root = {"PreferenceSpecifiers": SPECIFIERS}

    for app in APPS:
        path = ROOT / "Apps" / app / "Settings.bundle" / "Root.plist"
        with open(path, "wb") as handle:
            plistlib.dump(root, handle, sort_keys=False)
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
