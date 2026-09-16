PROJECT = FastmailShell.xcodeproj
LSREGISTER = /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
DEVICE ?= $(shell xcrun devicectl list devices 2>/dev/null | awk '/ available/ {print $$3; exit}')

.PHONY: generate test build-macos install-macos forget-builds check-apps build-ios install-ios build-extension install-extension install deploy clean

generate:
	xcodegen generate

test: generate
	cd Packages/FastmailShellKit && swift test
	xcodebuild -project $(PROJECT) -scheme IntegrationTests -destination 'platform=macOS' test
	cd Server && npm test
	node --check Userscript/fastmail-custom-mode.user.js
	for f in SafariExtension/*.js; do node --check "$$f" || exit 1; done

build-macos: generate
	xcodebuild -project $(PROJECT) -scheme Personal -destination 'platform=macOS' -configuration Release -allowProvisioningUpdates build
	xcodebuild -project $(PROJECT) -scheme Work -destination 'platform=macOS' -configuration Release -allowProvisioningUpdates build

# Installing ends by checking that Shortcuts and AppleScript reach the new
# copies. deploy passes CHECK_APPS= and checks after relaunching the apps
# instead, so a failed check cannot keep the phones from their install.
CHECK_APPS ?= tools/check-installed-apps.sh

install-macos: build-macos
	rm -rf "/Applications/mdbraber.com.app" "/Applications/nexthealth.nl.app"
	cp -R "$$(xcodebuild -project $(PROJECT) -scheme Personal -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/mdbraber.com.app" /Applications/
	cp -R "$$(xcodebuild -project $(PROJECT) -scheme Work -destination 'platform=macOS' -configuration Release -showBuildSettings | awk '/ BUILT_PRODUCTS_DIR/ {print $$3}')/nexthealth.nl.app" /Applications/
	tools/claim-installed-apps.sh --register
	$(CHECK_APPS)

# Building an app registers it, so the copy in a build folder claims the same
# bundle identifier as the installed one. Then a Fastmail link, an AppleScript
# or a Shortcuts action can reach the build instead of the app, and deleting
# the build takes the app's actions out of Shortcuts. The Personal and Work
# schemes run this after every build; it is here for everything else.
forget-builds:
	tools/claim-installed-apps.sh

# Shortcuts and AppleScript reach the installed Mac apps, and Shortcuts lists
# their actions
check-apps:
	tools/check-installed-apps.sh

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
EXTENSION_DIR = SafariExtension/App/Fastmail Custom
EXTENSION_APP = Fastmail Custom.app

build-extension:
	cd "$(EXTENSION_DIR)" && xcodebuild -project "Fastmail Custom.xcodeproj" -scheme "Fastmail Custom" -configuration Release -derivedDataPath build -allowProvisioningUpdates build
	tools/claim-installed-apps.sh

install-extension: build-extension
	rm -rf "/Applications/$(EXTENSION_APP)"
	cp -R "$(EXTENSION_DIR)/build/Build/Products/Release/$(EXTENSION_APP)" /Applications/
	tools/claim-installed-apps.sh --register
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
