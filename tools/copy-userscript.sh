#!/bin/sh
set -eu

if [ -z "${USERSCRIPT_PATH:-}" ]; then
    echo "error: USERSCRIPT_PATH is not set; copy Config/Local.xcconfig.example to Config/Local.xcconfig"
    exit 1
fi

if [ ! -f "$USERSCRIPT_PATH" ]; then
    echo "error: user script not found at $USERSCRIPT_PATH"
    exit 1
fi

if ! grep -q "==UserScript==" "$USERSCRIPT_PATH"; then
    echo "error: no ==UserScript== metadata block in $USERSCRIPT_PATH"
    exit 1
fi

DEST="$BUILT_PRODUCTS_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
mkdir -p "$DEST"
cp "$USERSCRIPT_PATH" "$DEST/userscript.js"
