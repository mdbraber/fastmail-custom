#!/bin/zsh
# Check that Shortcuts and AppleScript reach the Mac apps in /Applications,
# and that Shortcuts has their actions. Says what is wrong and exits non-zero
# when any of that is not so.
#
# Shortcuts gets an app's actions from linkd, which indexes the copy that was
# registered last. An index can fail without a word anywhere but linkd's own
# log (on 2026-09-14 every action went missing that way), so this waits for
# linkd to have indexed the installed copy itself, and for Shortcuts to list
# every action that copy declares. FASTMAIL_CHECK_WAIT bounds the wait, in
# seconds (default 90).
set -u

cd "${0:a:h}/.." || exit 1

APPS=("/Applications/mdbraber.com.app" "/Applications/nexthealth.nl.app")
WAIT=${FASTMAIL_CHECK_WAIT:-90}
TOOLS="$HOME/Library/Shortcuts/ToolKit/Tools-active"
LINKD=("$HOME"/Library/Daemon\ Containers/*/Data/database/linkd.metadatastore.sqlite3(N))
failed=0

problem () {
  echo "  ✗ $*"
  failed=1
}

# What AppleScript and Shortcuts launch: the copy LaunchServices hands back
# for an app's name and for its bundle identifier.
resolved () {
  osascript -l JavaScript - "$1" "$2" <<'EOF'
function run(argv) {
  ObjC.import("AppKit");
  const ws = $.NSWorkspace.sharedWorkspace;
  const byId = ws.URLForApplicationWithBundleIdentifier(argv[1]);
  const byName = ws.fullPathForApplication(argv[0]);
  return [byId.isNil() ? "" : byId.path.js, byName.isNil() ? "" : byName.js].join("\n");
}
EOF
}

actions_declared () {
  osascript -l JavaScript - "$1" <<'EOF'
function run(argv) {
  ObjC.import("Foundation");
  const text = $.NSString.stringWithContentsOfFileEncodingError(argv[0], 4, null);
  return text.isNil() ? "" : Object.keys(JSON.parse(text.js).actions || {}).sort().join("\n");
}
EOF
}

query () {
  sqlite3 -readonly -cmd ".timeout 3000" "$1" "$2" 2>/dev/null
}

for app in "${APPS[@]}"; do
  name=${${app:t}%.app}
  echo "$name"
  if [ ! -d "$app" ]; then
    problem "not installed at $app"
    continue
  fi
  id=$(plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist")

  # Registered copies other than this one
  others=(${(f)"$(tools/claim-installed-apps.sh --list | awk -F '\t' -v id="$id" -v app="$app" '$2 == id && $1 != app { print $1 }')"})
  for other in $others; do problem "also registered: $other"; done

  # AppleScript and Shortcuts launch it from here
  paths=(${(f)"$(resolved "$name" "$id")"})
  [ "${paths[1]:-}" = "$app" ] || problem "its bundle identifier opens ${paths[1]:-nothing}, not $app"
  [ "${paths[2]:-}" = "$app" ] || problem "the name $name opens ${paths[2]:-nothing}, not $app"

  # AppleScript's dictionary is there
  sdef=$(plutil -extract OSAScriptingDefinition raw "$app/Contents/Info.plist" 2>/dev/null)
  [ -n "$sdef" ] && [ -f "$app/Contents/Resources/$sdef" ] || problem "no AppleScript dictionary in the app"

  # If it is running, it is this copy that runs
  for pid in ${(f)"$(pgrep -x "$name")"}; do
    exe=$(ps -o comm= -p "$pid")
    case "$exe" in "$app"/*) ;; *) problem "running from $exe" ;; esac
  done

  # Shortcuts has every action this copy declares, indexed from this copy
  metadata="$app/Contents/Resources/Metadata.appintents"
  declared=(${(f)"$(actions_declared "$metadata/extract.actionsdata")"})
  if [ ${#declared} -eq 0 ]; then
    problem "the app declares no Shortcuts actions"
    continue
  fi
  deadline=$((SECONDS + WAIT))
  while :; do
    indexed_from=""
    [ ${#LINKD} -gt 0 ] && indexed_from=$(query "${LINKD[1]}" "select url from bundles where bundleID = '$id';")
    listed=(${(f)"$(query "$TOOLS" "select id from Tools where id like '$id.%';")"})
    missing=()
    for action in $declared; do
      (( ${listed[(Ie)$id.$action]} )) || missing+=($action)
    done
    from_here=1
    [ ${#LINKD} -gt 0 ] && [ "$indexed_from" != "file://$app/" ] && [ "$indexed_from" != "$app/" ] && from_here=0
    [ $from_here -eq 1 ] && [ ${#missing} -eq 0 ] && break
    [ $SECONDS -ge $deadline ] && break
    sleep 3
  done
  if [ $from_here -eq 0 ]; then
    problem "linkd has not indexed this copy (its record: ${indexed_from:-none})"
  fi
  if [ ${#missing} -gt 0 ]; then
    problem "Shortcuts lacks ${#missing} of ${#declared} actions: ${(j:, :)missing}"
  fi
  if [ $from_here -eq 0 ] || [ ${#missing} -gt 0 ]; then
    if [ -f "$metadata/extract.packagedata" ] && grep -q '"includes" *: *\[ *"' "$metadata/extract.packagedata"; then
      problem "its metadata includes an App Intents package, which linkd fails to confirm in these apps"
    fi
    /usr/bin/log show --last 10m --style compact \
      --predicate "process == \"linkd\" && messageType == error && eventMessage CONTAINS \"$id\"" 2>/dev/null \
      | grep -v '^Timestamp' | tail -3 | cut -c1-240 | sed 's/^/    linkd: /'
  fi
  [ $failed -eq 0 ] && echo "  ✓ Shortcuts and AppleScript reach $app, with ${#declared} actions"
done

exit $failed
