# Fastmail Inbox mode injector

A minimal Safari web extension whose only job is to start
`fastmail-inbox-mode.user.js` on `app.fastmail.com` and `app.beta.fastmail.com`.

The two hosts are named outright rather than matched with a subdomain wildcard,
which would take in the marketing site and everything else on `fastmail.com`
along with them. They are separate origins, so `localStorage` is not shared:
each keeps its own `early.js` cache and its own on/off state, while the settings
in extension storage are common to both.

## Why this exists

Fastmail serves:

```
script-src 'self' https://hcaptcha.com https://*.hcaptcha.com 'sha256-3zLaO2X2qEZTc3RBUl/mxyLiXfTsoJcBP4MnIX0mKuU='
```

No `'unsafe-inline'`. A userscript manager runs page-world code by adding an
inline `<script>` to the page, and this policy refuses it — the console shows
*"Refused to execute a script because its hash, its nonce, or 'unsafe-inline'
does not appear in the script-src directive"*. The script therefore never starts,
in any account, on any Fastmail URL.

Running in the content world instead would satisfy CSP, but content scripts live
in an isolated world with no access to `window.FastMail`, and patching Fastmail's
internals is the whole point of the script. The Userscripts extension documents
this as unfixable on its side: *"Currently there is no way to allow extension
content scripts to bypass CSPs in Safari."*

`scripting.executeScript()` is a different path. It does not add anything to the
DOM, so there is nothing for the page to refuse, and `world: "MAIN"` puts the
code in the same context the userscript wanted. The page's CSP is left exactly as
it is — nothing is stripped or weakened. Only an extension can make that call;
userscripts have no `browser.scripting`. See
[quoid/userscripts#954](https://github.com/quoid/userscripts/issues/954).

## Contents

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, scoped to `app.fastmail.com` and `app.beta.fastmail.com` |
| `background.js` | Injects the payload with `world: "MAIN"` on page load |
| `early.js` | Content script at `document_start`, replaying last load's styles |
| `settings.html` / `settings.js` | The options popup |
| `fastmail-inbox-mode.js` | Symlink to the userscript, which is the payload |

The payload guards against running twice, so a duplicate injection is harmless.

## Building

Safari extensions must be delivered inside an app, so this needs converting once:

```sh
xcrun safari-web-extension-converter \
    --app-name "Fastmail Inbox mode" \
    --copy-resources \
    /Users/mdbraber/src/fastmail-customized/safari-extension
```

The app project's `Resources` are symlinks back here, so there is nothing to
copy by hand — but **Xcode resolves them into real files when it builds**, so
every edit needs a rebuild before Safari sees it:

```sh
cd "safari-extension-app/Fastmail Inbox mode"
xcodebuild -project "Fastmail Inbox mode.xcodeproj" \
    -scheme "Fastmail Inbox mode" -configuration Debug \
    -derivedDataPath build build
open "build/Build/Products/Debug/Fastmail Inbox mode.app"
```

Reloading the tab without rebuilding silently runs the previous payload:
`scripting.executeScript({files})` reads the built bundle, not the source.

**Quit the app before rebuilding.** `open` does nothing to an app that is
already running, so it keeps serving the old payload; and replacing the bundle
underneath a running app is what makes the extension vanish from Safari's list
altogether.

```sh
osascript -e 'tell application "Fastmail Inbox mode" to quit'
```

### Signing

The converter leaves `CODE_SIGN_STYLE = Automatic` with no team, which signs
**ad-hoc**. An ad-hoc signature is a new identity every build, so Safari treats
each rebuild as a different extension: it drops out of the list, and getting it
back needs Develop → Allow Unsigned Extensions, which itself resets whenever
Safari restarts.

`DEVELOPMENT_TEAM = D3S5M885YQ` is now set in the project, so builds are signed
with the Apple Development certificate and the identity stays put across
rebuilds. Check it with:

```sh
codesign -dv "build/Build/Products/Debug/Fastmail Inbox mode.app" 2>&1 |
    grep TeamIdentifier
```

`TeamIdentifier=not set` means it fell back to ad-hoc.

After a rebuild the extension still has to be enabled again: Safari → Settings →
Extensions. Each Fastmail web app (`mdbraber.com.app` and friends) keeps its
**own** extensions list, so enable it there too.

## Checking it worked

With a Fastmail tab open:

```js
window.customInboxMode.isOn()
```

The console also logs `Inbox mode ready (Shift-I to toggle)` on load. If the CSP
error still appears, that is the Userscripts copy of the script failing — disable
it there, since this extension now delivers it.
