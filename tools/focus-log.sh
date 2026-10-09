#!/bin/bash
# What the Mac shells think their windows are doing, while the focus problem is
# being chased. FocusProbe writes one event and a roll call of every window to
# each app's own container; this reads both, side by side.
#
#   tools/focus-log.sh follow     watch both as it happens
#   tools/focus-log.sh            the last 60 events of each
#   tools/focus-log.sh clear      empty both, before a repro
#   tools/focus-log.sh off        stop the probing (on by default; `on` again)
#
# Reading it: every `didBecomeActive` should be followed by `becameKey` on a
# window with `vis=1 canKey=1`. A `vis=1 canKey=0` window in sight, or an
# activation with no `becameKey` after it, is the bug. `vis=0` alone is normal
# (the compose pool's spare waits ordered out); an `orderOut` of a window that
# was in sight a moment ago is not.
set -euo pipefail

apps="personal work"
apps_long="personal work"
container() { echo "$HOME/Library/Logs/focus-probe-com.mdbraber.fastmail-custom.$1.log"; }

probe() {  # probe <on|off>
    for app in $apps; do
        defaults write "com.mdbraber.fastmail-custom.$app" FMFocusProbe -bool "$1"
    done
    echo "focus probing is $1 for both apps; restart them for it to take effect"
}

case "${1:-tail}" in
    follow)
        files=()
        for app in $apps; do
            file=$(container "$app"); [ -f "$file" ] || : > "$file"
            files+=("$file")
        done
        tail -n 0 -F "${files[@]}"
        ;;
    clear)
        for app in $apps; do : > "$(container "$app")" 2>/dev/null || true; done
        echo "cleared"
        ;;
    off) probe false ;;
    on)  probe true ;;
    tail)
        for app in $apps; do
            file=$(container "$app")
            echo "===== $app  ${file}"
            [ -f "$file" ] && tail -n 60 "$file" || echo "  (nothing logged yet)"
        done
        ;;
    *) echo "usage: focus-log.sh [follow|tail|clear|on|off]" >&2; exit 2 ;;
esac
