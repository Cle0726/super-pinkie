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
for bundle_part in VERSION ui personas installer patch; do
  ditto "$REPO_ROOT/$bundle_part" "$CONTENTS/Resources/SuperPinkie/$bundle_part"
done
for service in party roundtable tts; do
  mkdir -p "$CONTENTS/Resources/SuperPinkie/services/$service"
  cp "$REPO_ROOT/services/$service/"*.py "$CONTENTS/Resources/SuperPinkie/services/$service/"
done
cp "$REPO_ROOT/services/party/identities.json" "$CONTENTS/Resources/SuperPinkie/services/party/identities.json"
cp "$REPO_ROOT/services/party/openclaw-live.mjs" "$CONTENTS/Resources/SuperPinkie/services/party/openclaw-live.mjs"
mkdir -p "$CONTENTS/Resources/SuperPinkie/services/context"
for context_file in context_budget.py setup.py budget.mjs policy.json; do
  cp "$REPO_ROOT/services/context/$context_file" "$CONTENTS/Resources/SuperPinkie/services/context/$context_file"
done
mkdir -p "$CONTENTS/Resources/SuperPinkie/services/project-scope"
for scope_file in index.mjs setup.py package.json openclaw.plugin.json; do
  cp "$REPO_ROOT/services/project-scope/$scope_file" "$CONTENTS/Resources/SuperPinkie/services/project-scope/"
done

sed \
  -e "s/@VERSION@/$VERSION/g" \
  "$SCRIPT_DIR/Info.plist.in" > "$CONTENTS/Info.plist"

codesign --force --deep --sign - "$APP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$OUTPUT_ROOT/super-pinkie-macos-$VERSION.zip"

echo "$APP_PATH"
