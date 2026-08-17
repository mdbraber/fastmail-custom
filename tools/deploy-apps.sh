#!/bin/zsh
# Build and install both shells everywhere: macOS into /Applications, iOS onto
# every paired device that turns up.
#
# Devices are discovered rather than named, so a new phone or an iPad needs no
# change here; set FASTMAIL_DEVICES to a space-separated list of UDIDs to
# target specific ones instead. FASTMAIL_DEPLOY_TRIES bounds the wait for a
# device that is asleep (default 60 attempts, 20s apart).
set -o pipefail

cd "${0:a:h}/.." || exit 1

TRIES=${FASTMAIL_DEPLOY_TRIES:-60}

echo "=== macOS build+install ==="
make install-macos || { echo "MACOS INSTALL FAILED"; exit 1; }

# A build re-registers the DerivedData copies with LaunchServices, which then
# hands scheme and mailto links to a copy inside a build directory. Unregister
# those and re-assert the installed ones.
LS=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
BP=$(xcodebuild -project FastmailShell.xcodeproj -scheme Personal -destination 'platform=macOS' -configuration Release -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR/ {print $3; exit}')
for app in mdbraber.com nexthealth.nl; do
  [ -n "$BP" ] && "$LS" -u "$BP/$app.app" >/dev/null 2>&1
  "$LS" -f "/Applications/$app.app" >/dev/null 2>&1
done
echo "MACOS OK"

# A running shell reads userscript.js from its bundle at launch, so it keeps
# serving the old script until restarted. Installing is not deploying.
for app in mdbraber.com nexthealth.nl; do
  if pgrep -x "$app" >/dev/null 2>&1; then
    pkill -x "$app" && sleep 2 && open -a "/Applications/$app.app"
    echo "relaunched $app"
  fi
done

echo "=== iOS build ==="
make build-ios || { echo "IOS BUILD FAILED"; exit 1; }

products () {
  xcodebuild -project FastmailShell.xcodeproj -scheme "$1" \
    -destination 'generic/platform=iOS' -configuration Release \
    -showBuildSettings 2>/dev/null | awk '/ BUILT_PRODUCTS_DIR/ {print $3; exit}'
}
P_APP="$(products Personal)/mdbraber.com.app"
W_APP="$(products Work)/nexthealth.nl.app"

for app in "$P_APP" "$W_APP"; do
  [ -d "$app" ] || { echo "IOS BUILD FAILED (no $app)"; exit 1; }
done

# Every paired device, or the ones named in the environment. Read from the
# listing's own "available (paired)" column rather than from the JSON, whose
# tunnelState reads disconnected for a device that installs perfectly well.
paired_devices () {
  xcrun devicectl list devices 2>/dev/null \
    | grep 'available (paired)' \
    | grep -oE '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
}

typeset -A done_p done_w seen

for try in $(seq 1 $TRIES); do
  devices=(${(f)"$(paired_devices)"})
  if [ -n "$FASTMAIL_DEVICES" ]; then devices=(${=FASTMAIL_DEVICES}); fi

  for udid in $devices; do
    [ -n "$udid" ] || continue
    seen[$udid]=1
    : ${done_p[$udid]:=0} ${done_w[$udid]:=0}

    if [ ${done_p[$udid]} -eq 0 ] && \
       xcrun devicectl device install app --device $udid "$P_APP" >/dev/null 2>&1; then
      done_p[$udid]=1; echo "personal ok on $udid (try $try)"
    fi
    if [ ${done_w[$udid]} -eq 0 ] && \
       xcrun devicectl device install app --device $udid "$W_APP" >/dev/null 2>&1; then
      done_w[$udid]=1; echo "work ok on $udid (try $try)"
    fi
  done

  # Done when something was found and every one of them has both apps
  if [ ${#seen} -gt 0 ]; then
    outstanding=0
    for udid in ${(k)seen}; do
      { [ ${done_p[$udid]} -eq 1 ] && [ ${done_w[$udid]} -eq 1 ] } || outstanding=1
    done
    [ $outstanding -eq 0 ] && { echo "BOTH INSTALLED"; exit 0; }
  fi

  sleep 20
done

# Whatever landed still landed, so say which: a device that never woke up
# should read as a missing device rather than as a failed build
for udid in ${(k)seen}; do
  echo "$udid: personal=${done_p[$udid]} work=${done_w[$udid]}"
done
[ ${#seen} -eq 0 ] && echo "no paired devices found"
echo "IOS INSTALL TIMED OUT"
exit 1
