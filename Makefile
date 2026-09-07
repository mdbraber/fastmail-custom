PROJECT = FastmailShell.xcodeproj
DEVICE ?= $(shell xcrun devicectl list devices 2>/dev/null | awk '/ available/ {print $$3; exit}')

.PHONY: generate test build-macos install-macos build-ios install-ios install deploy settings-bundle clean

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
	xcodebuild -project $(PROJECT) -scheme Personal -destination 'platform=macOS' -configuration Release build
	xcodebuild -project $(PROJECT) -scheme Work -destination 'platform=macOS' -configuration Release build

install-macos: build-macos
	rm -rf "/Applications/mdbraber.com.app" "/Applications/nexthealth.nl.app"
	cp -R "$$(xcodebuild -project $(PROJECT) -scheme Personal -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/mdbraber.com.app" /Applications/
	cp -R "$$(xcodebuild -project $(PROJECT) -scheme Work -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/nexthealth.nl.app" /Applications/

build-ios: generate
	xcodebuild -project $(PROJECT) -scheme Personal -destination 'generic/platform=iOS' -configuration Release -allowProvisioningUpdates build
	xcodebuild -project $(PROJECT) -scheme Work -destination 'generic/platform=iOS' -configuration Release -allowProvisioningUpdates build

install-ios: build-ios
	@test -n "$(DEVICE)" || { echo "No available iOS device found. Pass DEVICE=<identifier>, see: xcrun devicectl list devices"; exit 1; }
	xcrun devicectl device install app --device $(DEVICE) "$$(xcodebuild -project $(PROJECT) -scheme Personal -destination 'generic/platform=iOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/mdbraber.com.app"
	xcrun devicectl device install app --device $(DEVICE) "$$(xcodebuild -project $(PROJECT) -scheme Work -destination 'generic/platform=iOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/nexthealth.nl.app"

install: install-macos install-ios

# install-ios takes DEVICE, which defaults to the first device listed, so
# `install` reaches one of them and quietly leaves the others behind. deploy
# is the everywhere version: every paired device, waiting on ones that are
# asleep, and relaunching the macOS shells so they actually load what was
# just installed.
deploy:
	tools/deploy-apps.sh

clean:
	rm -rf build DerivedData $(PROJECT)
