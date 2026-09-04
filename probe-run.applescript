-- probe-run.applescript: run a JavaScript file in Safari's current tab.
-- Read-only by convention; the probes never modify messages.
on run argv
  set js to (read POSIX file (item 1 of argv) as «class utf8»)
  tell application "Safari" to do JavaScript js in current tab of front window
end run
