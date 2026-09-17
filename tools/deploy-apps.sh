#!/bin/zsh
# Build and install both shells everywhere: macOS into /Applications, iOS onto
# every paired device that turns up.
#
# Devices are discovered rather than named, so a new phone or an iPad needs no
# change here; set FASTMAIL_DEVICES to a space-separated list of UDIDs to
# target specific ones instead. FASTMAIL_DEPLOY_TRIES bounds the wait for a
# device that is asleep (default 3 attempts, 10s apart): one that has not
# taken the apps by then is off the network rather than busy, and is named at
# the end instead of held on to.
set -o pipefail

cd "${0:a:h}/.." || exit 1

TRIES=${FASTMAIL_DEPLOY_TRIES:-3}
WAIT=${FASTMAIL_DEPLOY_WAIT:-10}

# A device identifier as `devicectl list devices` prints it. That is the
# hardware UDID (00008103-000904293A60801E) since the devices were paired
# again, and was a CoreDevice UUID before; matching only the UUID found no
# devices at all and waited out every try in silence.
DEVICE_ID='[0-9A-Fa-f]{8}-([0-9A-Fa-f]{16}|[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})'

# Build BOTH platforms before touching anything. A relaunched macOS shell or
# an "OK" line printed before the iOS build ran once masked an iOS build
# failure as a successful deploy; the phone kept the old build while the
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
# The iOS apps, in install order. The mailto chooser is iPhone only and has
# no macOS half, which is why the list here is longer than the one above.
APPS=(
  "$(products Personal)/mdbraber.com.app"
  "$(products Work)/nexthealth.nl.app"
  "$(products Mailto)/Mailto.app"
)
NAMES=(personal work mailto)

for app in $APPS; do
  [ -d "$app" ] || { echo "IOS BUILD FAILED (no $app)"; exit 1; }
done

echo "=== install macOS ==="
# Installing also leaves the installed copies the only registered ones, so
# links, AppleScript and Shortcuts reach them rather than a build folder's.
make install-macos CHECK_APPS= || { echo "MACOS INSTALL FAILED"; exit 1; }
echo "MACOS OK"

# A running shell reads userscript.js from its bundle at launch, so it keeps
# serving the old script until restarted. Installing is not deploying.
for app in mdbraber.com nexthealth.nl; do
  if pgrep -x "$app" >/dev/null 2>&1; then
    pkill -x "$app" && sleep 2 && open -a "/Applications/$app.app"
    echo "relaunched $app"
  fi
done

# Check that Shortcuts and AppleScript reach the new copies, now the shells
# run from them (install-macos was told to leave this to here). A failure is
# not a reason to keep the phones waiting, so it is said here and decides the
# exit at the end.
macos_check=0
tools/check-installed-apps.sh || { macos_check=1; echo "MACOS CHECK FAILED"; }

# Every paired device, or the ones named in the environment. Read from the
# listing's own state column rather than from the JSON, whose tunnelState
# reads disconnected for a device that installs perfectly well. A device
# installed to a moment ago reads `connected` instead of `available (paired)`,
# and one missing it waited out every try in silence.
paired_devices () {
  xcrun devicectl list devices 2>/dev/null \
    | grep -E 'available \(paired\)|connected' \
    | grep -oE "$DEVICE_ID"
}

# A friendlier label than the UDID, because the thing a failure usually asks
# for is physical: pick up that device and unlock it.
device_name () {
  xcrun devicectl list devices 2>/dev/null \
    | grep -F "$1" | head -1 | awk '{print $1}'
}

# Why an install failed, in one line. A locked device and a sleeping one both
# refuse in the same place, and only the second is worth waiting out in
# silence; so the difference has to be said rather than retried blindly.
failure_reason () {
  case "$1" in
    *DeviceLocked*|*"device is locked"*|*"The device is locked"*)
      print -r -- "locked; unlock it and this will go through" ;;
    *"developer mode"*|*"Developer Mode"*)
      print -r -- "Developer Mode is off; Settings › Privacy & Security" ;;
    *"not paired"*|*"pairing"*|*"trust"*|*"Trust"*)
      print -r -- "not trusted, accept the trust prompt on the device" ;;
    *"could not be found"*|*"not connected"*|*Unavailable*|*unavailable*)
      print -r -- "not reachable, asleep or off the network" ;;
    *)
      # The first ERROR: line the tool printed, which is the useful one.
      # Split into an array first: subscripting the expansion inline indexes
      # the joined string, and hands back a single character.
      local -a lines
      lines=(${(M)${(f)1}:#ERROR:*})
      print -r -- "${lines[1]:-install failed}" ;;
  esac
}

# Keyed "$udid:$index"; one entry per app per device, so adding an app to
# APPS is the whole change rather than another pair of maps.
typeset -A installed seen last_error told

# Install, keeping the error rather than discarding it, and say why the first
# time a device's reason changes; once per reason, not once per attempt, so a
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

    for i in {1..${#APPS}}; do
      : ${installed[$udid:$i]:=0}
      if [ ${installed[$udid:$i]} -eq 0 ] && install_to $udid "${APPS[$i]}"; then
        installed[$udid:$i]=1; echo "${NAMES[$i]} ok on $udid (try $try)"
      fi
    done
  done

  # Done when something was found and every one of them has every app
  if [ ${#seen} -gt 0 ]; then
    outstanding=0
    for udid in ${(k)seen}; do
      for i in {1..${#APPS}}; do
        [ ${installed[$udid:$i]} -eq 1 ] || outstanding=1
      done
    done
    if [ $outstanding -eq 0 ]; then
      # Only ever the devices that turned up. A paired device that stayed
      # asleep is named rather than passed over in silence: "installed" and
      # "installed everywhere" are not the same claim, and reading one as
      # the other is how a device goes a long time without a build.
      #
      # Skipped means "never installed to", read against what actually was,
      # not against the listing's state column, which reads `connected`
      # rather than `available (paired)` for a device just installed to, and
      # so reported every success as a skip.
      listing=$(xcrun devicectl list devices 2>/dev/null)
      for line in ${(f)listing}; do
        # Xcode's Simulators are listed too, and are never installed to
        [[ "$line" == *simulated* ]] && continue
        other=$(print -r -- "$line" | grep -oE "$DEVICE_ID")
        [ -n "$other" ] || continue
        [ -n "${seen[$other]}" ] && continue
        echo "skipped (not reachable): ${line%% *}"
      done
      echo "installed on ${#seen} device(s): ${(k)seen}"
      if [ $macos_check -ne 0 ]; then
        echo "ALL INSTALLED, BUT THE MAC APPS FAILED THEIR CHECK (see above)"
        exit 1
      fi
      echo "ALL INSTALLED"
      exit 0
    fi
  fi

  [ $try -lt $TRIES ] && sleep $WAIT
done

# Whatever landed still landed, so say which: a device that never woke up is
# a missing device rather than a failed build, and the builds above have
# already had to succeed for this to be reached. The reason goes with it;
# without one, a device that only needed unlocking is indistinguishable from
# a broken build, which is a long way to look for a short answer.
for udid in ${(k)seen}; do
  state=""
  for i in {1..${#APPS}}; do state+="${NAMES[$i]}=${installed[$udid:$i]:-0} "; done
  echo "$(device_name $udid) ($udid): ${state},  ${last_error[$udid]:-no error recorded}"
done
[ ${#seen} -eq 0 ] && echo "no paired devices found"
echo "NOT INSTALLED EVERYWHERE: the devices above did not take the apps within $(( TRIES * WAIT ))s"
if [ $macos_check -ne 0 ]; then
  echo "AND THE MAC APPS FAILED THEIR CHECK (see above)"
  exit 1
fi
exit 0
