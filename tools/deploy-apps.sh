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

# Build BOTH platforms before touching anything. A relaunched macOS shell or
# an "OK" line printed before the iOS build ran once masked an iOS build
# failure as a successful deploy — the phone kept the old build while the
# output read like everything shipped. So both builds must succeed here, and
# only then does anything get installed or relaunched.
echo "=== build macOS ==="
make build-macos || { echo "MACOS BUILD FAILED"; exit 1; }

echo "=== build iOS ==="
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

echo "=== install macOS ==="
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

# Every paired device, or the ones named in the environment. Read from the
# listing's own "available (paired)" column rather than from the JSON, whose
# tunnelState reads disconnected for a device that installs perfectly well.
paired_devices () {
  xcrun devicectl list devices 2>/dev/null \
    | grep 'available (paired)' \
    | grep -oE '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
}

# A friendlier label than the UDID, because the thing a failure usually asks
# for is physical: pick up that device and unlock it.
device_name () {
  xcrun devicectl list devices 2>/dev/null \
    | grep -F "$1" | head -1 | awk '{print $1}'
}

# Why an install failed, in one line. A locked device and a sleeping one both
# refuse in the same place, and only the second is worth waiting out in
# silence — so the difference has to be said rather than retried blindly.
failure_reason () {
  case "$1" in
    *DeviceLocked*|*"device is locked"*|*"The device is locked"*)
      print -r -- "locked — unlock it and this will go through" ;;
    *"developer mode"*|*"Developer Mode"*)
      print -r -- "Developer Mode is off — Settings › Privacy & Security" ;;
    *"not paired"*|*"pairing"*|*"trust"*|*"Trust"*)
      print -r -- "not trusted — accept the trust prompt on the device" ;;
    *"could not be found"*|*"not connected"*|*Unavailable*|*unavailable*)
      print -r -- "not reachable — asleep or off the network" ;;
    *)
      # The first ERROR: line the tool printed, which is the useful one.
      # Split into an array first: subscripting the expansion inline indexes
      # the joined string, and hands back a single character.
      local -a lines
      lines=(${(M)${(f)1}:#ERROR:*})
      print -r -- "${lines[1]:-install failed}" ;;
  esac
}

typeset -A done_p done_w seen last_error told

# Install, keeping the error rather than discarding it, and say why the first
# time a device's reason changes — once per reason, not once per attempt, so a
# long wait stays readable.
install_to () {
  local udid=$1 app=$2 out reason
  if out=$(xcrun devicectl device install app --device $udid "$app" 2>&1); then
    return 0
  fi
  reason=$(failure_reason "$out")
  last_error[$udid]="$reason"
  if [ "${told[$udid]}" != "$reason" ]; then
    echo "$(device_name $udid) ($udid): $reason"
    told[$udid]="$reason"
  fi
  return 1
}

for try in $(seq 1 $TRIES); do
  devices=(${(f)"$(paired_devices)"})
  if [ -n "$FASTMAIL_DEVICES" ]; then devices=(${=FASTMAIL_DEVICES}); fi

  for udid in $devices; do
    [ -n "$udid" ] || continue
    seen[$udid]=1
    : ${done_p[$udid]:=0} ${done_w[$udid]:=0}

    if [ ${done_p[$udid]} -eq 0 ] && install_to $udid "$P_APP"; then
      done_p[$udid]=1; echo "personal ok on $udid (try $try)"
    fi
    if [ ${done_w[$udid]} -eq 0 ] && install_to $udid "$W_APP"; then
      done_w[$udid]=1; echo "work ok on $udid (try $try)"
    fi
  done

  # Done when something was found and every one of them has both apps
  if [ ${#seen} -gt 0 ]; then
    outstanding=0
    for udid in ${(k)seen}; do
      { [ ${done_p[$udid]} -eq 1 ] && [ ${done_w[$udid]} -eq 1 ] } || outstanding=1
    done
    if [ $outstanding -eq 0 ]; then
      # Only ever the devices that turned up. A paired device that stayed
      # asleep is named rather than passed over in silence: "installed" and
      # "installed everywhere" are not the same claim, and reading one as
      # the other is how a device goes a long time without a build.
      #
      # Skipped means "never installed to", read against what actually was —
      # not against the listing's state column, which reads `connected`
      # rather than `available (paired)` for a device just installed to, and
      # so reported every success as a skip.
      listing=$(xcrun devicectl list devices 2>/dev/null)
      for line in ${(f)listing}; do
        other=$(print -r -- "$line" | grep -oE '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}')
        [ -n "$other" ] || continue
        [ -n "${seen[$other]}" ] && continue
        echo "skipped (not reachable): ${line%% *}"
      done
      echo "installed on ${#seen} device(s): ${(k)seen}"
      echo "BOTH INSTALLED"
      exit 0
    fi
  fi

  sleep 20
done

# Whatever landed still landed, so say which: a device that never woke up
# should read as a missing device rather than as a failed build. The reason
# goes with it — without one, a device that only needed unlocking is
# indistinguishable from a broken build, which is a long way to look for a
# short answer.
for udid in ${(k)seen}; do
  echo "$(device_name $udid) ($udid): personal=${done_p[$udid]} work=${done_w[$udid]} — ${last_error[$udid]:-no error recorded}"
done
[ ${#seen} -eq 0 ] && echo "no paired devices found"
echo "IOS INSTALL TIMED OUT"
exit 1
