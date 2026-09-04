-- probe-run.applescript: run a JavaScript file in Safari's Fastmail tab.
-- Read-only by convention; the probes never modify messages.
--
-- The tab is found by URL across every window, beta first, so a run does
-- not depend on which tab happens to be in front. With no Fastmail tab open
-- it falls back to the current tab of the front window, where the probe
-- reports "Can't find variable: FastMail".
on run argv
  set js to (read POSIX file (item 1 of argv) as «class utf8»)
  tell application "Safari"
    set target to missing value
    repeat with prefix in {"https://app.beta.fastmail.com/", "https://app.fastmail.com/"}
      if target is missing value then
        repeat with w in windows
          repeat with t in tabs of w
            if target is missing value then
              set u to URL of t
              if u is not missing value then
                if (u as text) starts with (prefix as text) then set target to t
              end if
            end if
          end repeat
        end repeat
      end if
    end repeat
    if target is missing value then set target to current tab of front window
    do JavaScript js in target
  end tell
end run
