-- probe-run.applescript: run a JavaScript file in Safari's Fastmail tab.
-- Read-only by convention; the probes never modify messages.
--
-- The tab is found by URL across every window, so a run does not depend on
-- which tab happens to be in front. Among Fastmail tabs, one where Inbox
-- mode is running wins (the extension may not be permitted on every host);
-- failing that, beta before production. With no Fastmail tab open at all it
-- falls back to the current tab of the front window, where the probe
-- reports "Can't find variable: FastMail".
--
-- The script's last expression is what gets printed. A top-level `return`
-- prints nothing, so a probe is a bare expression or an IIFE returning one.
on run argv
  set js to (read POSIX file (item 1 of argv) as «class utf8»)
  tell application "Safari"
    set candidates to {}
    repeat with prefix in {"https://app.beta.fastmail.com/", "https://app.fastmail.com/"}
      repeat with w in windows
        repeat with t in tabs of w
          set u to URL of t
          if u is not missing value then
            if (u as text) starts with (prefix as text) then set end of candidates to t
          end if
        end repeat
      end repeat
    end repeat
    set target to missing value
    repeat with t in candidates
      if target is missing value then
        try
          if (do JavaScript "!!window.customInboxMode" in t) is true then set target to t
        end try
      end if
    end repeat
    if target is missing value and (count of candidates) > 0 then set target to item 1 of candidates
    if target is missing value then set target to current tab of front window
    do JavaScript js in target
  end tell
end run
