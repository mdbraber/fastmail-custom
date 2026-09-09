PROJECT = FastmailShell.xcodeproj
LSREGISTER = /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
DEVICE ?= $(shell xcrun devicectl list devices 2>/dev/null | awk '/ available/ {print $$3; exit}')

.PHONY: generate test build-macos install-macos forget-builds build-ios install-ios build-extension install-extension install deploy settings-bundle clean

generate:
	xcodegen generate

# Root.plist is generated and checked in; regenerate whenever the
# CustomModeSettings catalog changes, or `make test` fails on the parity guard
settings-bundle:
	python3 tools/gen-settings-bundle.py

test: generate
	cd Packages/FastmailShellKit && swift test
	xcodebuild -project $(PROJECT) -scheme IntegrationTests -destination 'platform=macOS' test
	cd Server && npm test
	node --check Userscript/fastmail-custom-mode.user.js
	for f in SafariExtension/*.js; do node --check "$$f" || exit 1; done

build-macos: generate
	xcodebuild -project $(PROJECT) -scheme Personal -destination 'platform=macOS' -configuration Release -allowProvisioningUpdates build
	xcodebuild -project $(PROJECT) -scheme Work -destination 'platform=macOS' -configuration Release -allowProvisioningUpdates build

install-macos: build-macos
	rm -rf "/Applications/mdbraber.com.app" "/Applications/nexthealth.nl.app"
	cp -R "$$(xcodebuild -project $(PROJECT) -scheme Personal -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/mdbraber.com.app" /Applications/
	cp -R "$$(xcodebuild -project $(PROJECT) -scheme Work -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/nexthealth.nl.app" /Applications/
	$(MAKE) forget-builds

# Building an app registers it, so the copy in Xcode's build folder claims the
# same bundle identifier as the installed one. Then a Fastmail link, or a page
# handed over from another device, can open the build instead of the app.
forget-builds:
	@for scheme in Personal Work; do \
		dir="$$(xcodebuild -project $(PROJECT) -scheme $$scheme -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')"; \
		for app in "$$dir"/*.app; do \
			[ -d "$$app" ] && $(LSREGISTER) -u "$$app" >/dev/null 2>&1 || true; \
		done; \
	done
	@echo "Only /Applications now claims the apps' bundle identifiers"

build-ios: generate
	xcodebuild -project $(PROJECT) -scheme Personal -destination 'generic/platform=iOS' -configuration Release -allowProvisioningUpdates build
	xcodebuild -project $(PROJECT) -scheme Work -destination 'generic/platform=iOS' -configuration Release -allowProvisioningUpdates build
	xcodebuild -project $(PROJECT) -scheme Mailto -destination 'generic/platform=iOS' -configuration Release -allowProvisioningUpdates build

install-ios: build-ios
	@test -n "$(DEVICE)" || { echo "No available iOS device found. Pass DEVICE=<identifier>, see: xcrun devicectl list devices"; exit 1; }
	xcrun devicectl device install app --device $(DEVICE) "$$(xcodebuild -project $(PROJECT) -scheme Personal -destination 'generic/platform=iOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/mdbraber.com.app"
	xcrun devicectl device install app --device $(DEVICE) "$$(xcodebuild -project $(PROJECT) -scheme Work -destination 'generic/platform=iOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/nexthealth.nl.app"
	xcrun devicectl device install app --device $(DEVICE) "$$(xcodebuild -project $(PROJECT) -scheme Mailto -destination 'generic/platform=iOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/Mailto.app"

# The Safari extension ships inside a host app, which Safari only sees once
# the app is in /Applications. Xcode resolves the extension's symlinks into
# real files as it builds, so the app always carries the current script.
EXTENSION_DIR = SafariExtension/App/Fastmail Custom Mode
EXTENSION_APP = Fastmail Custom Mode.app

build-extension:
	cd "$(EXTENSION_DIR)" && xcodebuild -project "Fastmail Custom Mode.xcodeproj" -scheme "Fastmail Custom Mode" -configuration Release -derivedDataPath build build

install-extension: build-extension
	rm -rf "/Applications/$(EXTENSION_APP)"
	cp -R "$(EXTENSION_DIR)/build/Build/Products/Release/$(EXTENSION_APP)" /Applications/
	@echo "Installed /Applications/$(EXTENSION_APP); enable it in Safari's Extensions settings"

install: install-macos install-ios install-extension

# install-ios takes DEVICE, which defaults to the first device listed, so
# `install` reaches one of them and quietly leaves the others behind. deploy
# is the everywhere version: every paired device, waiting on ones that are
# asleep, and relaunching the macOS shells so they actually load what was
# just installed.
deploy:
	tools/deploy-apps.sh

clean:
	rm -rf build DerivedData $(PROJECT)
