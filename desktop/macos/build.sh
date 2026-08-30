#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
OUTPUT_ROOT="${PINKIE_BUILD_DIR:-$REPO_ROOT/dist}"
APP_NAME="超級碧琪"
APP_PATH="$OUTPUT_ROOT/$APP_NAME.app"
CONTENTS="$APP_PATH/Contents"

rm -rf "$APP_PATH"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

xcrun swiftc -parse-as-library -O \
  "$SCRIPT_DIR/Sources/Launcher.swift" \
  -framework AppKit \
  -framework AVFoundation \
  -framework Foundation \
  -framework Speech \
  -framework WebKit \
  -o "$CONTENTS/MacOS/Launcher"

cp "$REPO_ROOT/ui/assets/PinkieAppIcon.icns" "$CONTENTS/Resources/PinkieAppIcon.icns"
mkdir -p "$CONTENTS/Resources/SuperPinkie"
for bundle_part in VERSION ui personas installer; do
  ditto "$REPO_ROOT/$bundle_part" "$CONTENTS/Resources/SuperPinkie/$bundle_part"
done

sed \
  -e "s/@VERSION@/$VERSION/g" \
  "$SCRIPT_DIR/Info.plist.in" > "$CONTENTS/Info.plist"

codesign --force --deep --sign - "$APP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$OUTPUT_ROOT/super-pinkie-macos-$VERSION.zip"

echo "$APP_PATH"
