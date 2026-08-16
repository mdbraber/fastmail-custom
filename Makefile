PROJECT = FastmailShell.xcodeproj
DEVICE ?= $(shell xcrun devicectl list devices 2>/dev/null | awk '/ available/ {print $$3; exit}')

.PHONY: generate test build-macos install-macos build-ios install-ios install clean

generate:
	xcodegen generate

test: generate
	cd Packages/FastmailShellKit && swift test
	xcodebuild -project $(PROJECT) -scheme IntegrationTests -destination 'platform=macOS' test

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

clean:
	rm -rf build DerivedData $(PROJECT)
