#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
OUTPUT_ROOT="${PINKIE_BUILD_DIR:-$REPO_ROOT/dist}"
APP_NAME="超級碧琪"
APP_PATH="$OUTPUT_ROOT/$APP_NAME.app"
CONTENTS="$APP_PATH/Contents"
RUNTIME_ROOT="$CONTENTS/Resources/SuperPinkie/runtime"

NODE_BIN="${PINKIE_NODE_BIN:-$(command -v node 2>/dev/null || true)}"
OPENCLAW_BIN="${PINKIE_OPENCLAW_BIN:-$(command -v openclaw 2>/dev/null || true)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "error: 构建机没有可用的 Node.js" >&2
  exit 1
fi
if [[ -z "$OPENCLAW_BIN" || ! -x "$OPENCLAW_BIN" ]]; then
  echo "error: 构建机没有可用的 OpenClaw" >&2
  exit 1
fi
NODE_BIN="$(realpath "$NODE_BIN")"
OPENCLAW_ENTRY="$(realpath "$OPENCLAW_BIN")"
OPENCLAW_ROOT="$(dirname "$OPENCLAW_ENTRY")"
if [[ ! -f "$OPENCLAW_ROOT/package.json" || ! -f "$OPENCLAW_ROOT/openclaw.mjs" ]]; then
  echo "error: 无法确认 OpenClaw 包目录：$OPENCLAW_ROOT" >&2
  exit 1
fi

PYTHON_DRIVER="${PINKIE_PYTHON_BIN:-}"
if [[ -z "$PYTHON_DRIVER" ]]; then
  for candidate in \
    "$HOME/.workbuddy/binaries/python/envs/default/bin/python" \
    "$(command -v python3 2>/dev/null || true)"; do
    if [[ -x "$candidate" ]] && "$candidate" -c 'import edge_tts' >/dev/null 2>&1; then
      PYTHON_DRIVER="$candidate"
      break
    fi
  done
fi
if [[ -z "$PYTHON_DRIVER" || ! -x "$PYTHON_DRIVER" ]]; then
  echo "error: 构建机没有同时带 edge-tts 的 Python；可通过 PINKIE_PYTHON_BIN 指定" >&2
  exit 1
fi
PYTHON_BASE="$("$PYTHON_DRIVER" -c 'import sys; print(sys.base_prefix)')"
PYTHON_SITE_PACKAGES="$("$PYTHON_DRIVER" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
PYTHON_LICENSE="$("$PYTHON_DRIVER" -c 'import pathlib,sysconfig; print(pathlib.Path(sysconfig.get_paths()["stdlib"])/"LICENSE.txt")')"
NODE_ROOT="$(cd "$(dirname "$NODE_BIN")/.." && pwd)"
NPM_ROOT="$NODE_ROOT/lib/node_modules/npm"
if [[ ! -f "$NPM_ROOT/bin/npm-cli.js" ]]; then
  echo "error: 构建机的 Node.js 没有配套 npm" >&2
  exit 1
fi
NODE_VERSION="$("$NODE_BIN" --version | sed 's/^v//')"
NPM_VERSION="$("$NODE_BIN" "$NPM_ROOT/bin/npm-cli.js" --version)"
OPENCLAW_VERSION="$("$NODE_BIN" -e 'console.log(require(process.argv[1]).version)' "$OPENCLAW_ROOT/package.json")"
PYTHON_VERSION="$("$PYTHON_DRIVER" -c 'import sys; print(".".join(map(str,sys.version_info[:3])))')"

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
cp "$REPO_ROOT/services/process_io.py" "$CONTENTS/Resources/SuperPinkie/services/process_io.py"
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
mkdir -p "$CONTENTS/Resources/SuperPinkie/services/mode-architecture"
for architecture_file in index.mjs setup.py package.json openclaw.plugin.json; do
  cp "$REPO_ROOT/services/mode-architecture/$architecture_file" "$CONTENTS/Resources/SuperPinkie/services/mode-architecture/"
done
mkdir -p "$CONTENTS/Resources/SuperPinkie/services/watchdog"
cp "$REPO_ROOT/services/watchdog/cle-watchdog.sh" "$CONTENTS/Resources/SuperPinkie/services/watchdog/cle-watchdog.sh"
cp "$REPO_ROOT/services/watchdog/ai.openclaw.watchdog.plist.in" "$CONTENTS/Resources/SuperPinkie/services/watchdog/ai.openclaw.watchdog.plist.in"
mkdir -p "$CONTENTS/Resources/SuperPinkie/skills/deep-think"
cp "$REPO_ROOT/skills/deep-think/SKILL.md" "$CONTENTS/Resources/SuperPinkie/skills/deep-think/SKILL.md"

# The shipped App owns its runtime. User configuration, model keys, history and
# workspaces remain in ~/.openclaw and are deliberately not copied into it.
mkdir -p "$RUNTIME_ROOT/bin" "$RUNTIME_ROOT/licenses"
cp "$NODE_BIN" "$RUNTIME_ROOT/bin/node"
ditto --norsrc --noextattr "$NPM_ROOT" "$RUNTIME_ROOT/node_modules/npm"
ditto --norsrc --noextattr "$OPENCLAW_ROOT" "$RUNTIME_ROOT/openclaw"
ln -s "../openclaw/openclaw.mjs" "$RUNTIME_ROOT/bin/openclaw"
ln -s "../node_modules/npm/bin/npm-cli.js" "$RUNTIME_ROOT/bin/npm"
ln -s "../node_modules/npm/bin/npx-cli.js" "$RUNTIME_ROOT/bin/npx"
chmod 755 "$RUNTIME_ROOT/bin/node" "$RUNTIME_ROOT/openclaw/openclaw.mjs"

ditto --norsrc --noextattr "$PYTHON_BASE" "$RUNTIME_ROOT/python"
BUNDLED_PURELIB="$("$RUNTIME_ROOT/python/bin/python3" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
if [[ "$PYTHON_SITE_PACKAGES" != "$BUNDLED_PURELIB" ]]; then
  mkdir -p "$BUNDLED_PURELIB"
  ditto --norsrc --noextattr "$PYTHON_SITE_PACKAGES" "$BUNDLED_PURELIB"
fi
"$RUNTIME_ROOT/python/bin/python3" -c 'import aiohttp,edge_tts,sqlite3,ssl' >/dev/null

cp "$OPENCLAW_ROOT/LICENSE" "$RUNTIME_ROOT/licenses/OpenClaw-LICENSE"
cp "$NODE_ROOT/LICENSE" "$RUNTIME_ROOT/licenses/Node.js-LICENSE"
cp "$NPM_ROOT/LICENSE" "$RUNTIME_ROOT/licenses/npm-LICENSE"
cp "$PYTHON_LICENSE" "$RUNTIME_ROOT/licenses/Python-LICENSE.txt"
cp "$SCRIPT_DIR/THIRD_PARTY_NOTICES.md" "$RUNTIME_ROOT/THIRD_PARTY_NOTICES.md"
sed \
  -e "s/@ARCH@/$(uname -m)/g" \
  -e "s/@NODE_VERSION@/$NODE_VERSION/g" \
  -e "s/@NPM_VERSION@/$NPM_VERSION/g" \
  -e "s/@OPENCLAW_VERSION@/$OPENCLAW_VERSION/g" \
  -e "s/@PYTHON_VERSION@/$PYTHON_VERSION/g" \
  "$SCRIPT_DIR/runtime-manifest.json.in" > "$RUNTIME_ROOT/runtime-manifest.json"

# Patch the copied OpenClaw package before signing. Build-only mode never
# touches the user's config, personas or history.
PATH="$RUNTIME_ROOT/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
OPENCLAW_ROOT="$RUNTIME_ROOT/openclaw" \
PINKIE_OPENCLAW_BIN="$RUNTIME_ROOT/bin/openclaw" \
PINKIE_PYTHON_BIN="$RUNTIME_ROOT/python/bin/python3" \
PINKIE_PATCH_BACKUP_ROOT="$RUNTIME_ROOT/patch-originals" \
PINKIE_BUNDLE_BUILD_ONLY=1 \
PINKIE_SKIP_APP_BUNDLES=1 \
  /bin/bash "$REPO_ROOT/installer/macos/apply-theme.sh"

sed \
  -e "s/@VERSION@/$VERSION/g" \
  "$SCRIPT_DIR/Info.plist.in" > "$CONTENTS/Info.plist"

codesign --force --deep --sign - "$APP_PATH"
codesign --verify --deep --strict "$APP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$OUTPUT_ROOT/super-pinkie-macos-$VERSION.zip"

echo "$APP_PATH"
