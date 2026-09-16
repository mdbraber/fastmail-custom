#!/bin/zsh
# Leave the apps in /Applications the only copies macOS knows by their bundle
# identifiers.
#
# Every build registers what it built with LaunchServices, trusted, the way
# Xcode registers anything it builds. From then on a Fastmail link, an
# AppleScript `tell application`, and the Shortcuts actions can all reach the
# copy in a build folder instead of the installed app. And when that copy is
# unregistered or deleted, linkd, which reads apps' actions for Shortcuts,
# forgets the actions of that bundle identifier altogether, the installed
# app's too, until the installed app is registered again.
#
# So: unregister every copy outside the installed apps, then register again,
# trusted, each installed app whose identifier lost a copy, so linkd reads its
# actions afresh. Registering is not repeated otherwise, because linkd indexes
# the app on every registration and blocks a bundle that fails too often.
#
#   claim-installed-apps.sh             after a build (the schemes run this)
#   claim-installed-apps.sh --register  after installing: register them all
#   claim-installed-apps.sh --list      print every registered copy
set -u

LS=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
INSTALLED=(
  "/Applications/mdbraber.com.app"
  "/Applications/nexthealth.nl.app"
  "/Applications/Fastmail Custom.app"
)

# Every registered copy as "path<TAB>identifier". The old com.mdbraber.fastmail
# identifiers count too: their copies answer to the same app names.
registered () {
  "$LS" -dump 2>/dev/null | awk '
    function emit() { if (copy != "" && id ~ /^com\.mdbraber\.fastmail/) print copy "\t" id; copy = ""; id = "" }
    /^-+$/ { emit(); next }
    /^path: / { sub(/^path: +/, ""); sub(/ \(0x[0-9a-f]+\)$/, ""); copy = $0 }
    /^identifier: / { sub(/^identifier: +/, ""); id = $0 }
    END { emit() }'
}

installed_copy () {
  local app
  for app in "${INSTALLED[@]}"; do
    case "$1" in "$app"|"$app"/*) return 0 ;; esac
  done
  return 1
}

case "${1:-}" in
  --list) registered; exit 0 ;;
  --register|"") ;;
  *) echo "usage: ${0:t} [--register | --list]" >&2; exit 2 ;;
esac

typeset -A lost
for line in ${(f)"$(registered)"}; do
  copy=${line%%$'\t'*}
  id=${line#*$'\t'}
  installed_copy "$copy" && continue
  if "$LS" -u "$copy" >/dev/null 2>&1; then
    echo "forgot $copy"
    lost[$id]=1
  fi
done

for app in "${INSTALLED[@]}"; do
  [ -d "$app" ] || continue
  id=$(plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist" 2>/dev/null)
  # An extension's identifier extends its app's, so losing one counts.
  wanted=0
  [ "${1:-}" = "--register" ] && wanted=1
  for gone in ${(k)lost}; do
    case "$gone" in "$id"|"$id".*) wanted=1 ;; esac
  done
  [ $wanted -eq 1 ] || continue
  "$LS" -f -R -trusted "$app" && echo "registered $app"
done
exit 0
