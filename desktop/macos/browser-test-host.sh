#!/usr/bin/env bash
# C.le. browser acceptance host — build and launch an isolated copy of the real
# Launcher against the test gateway (19789 / profile cle).
#
# Why a separate host: the shipped app owns its bundled runtime, its gateway on
# 18789, its CUA driver and its state in ~/Library/Application Support/SuperPinkie.
# Attaching a freshly built Launcher to any of those would restart live services
# and mix live sessions into a test run. This host reuses the same
# Launcher.swift/BrowserControl.swift/MaterialPreview.swift sources, but:
#   * runs from its own .app with its own bundle id  (com.cle0726.super-pinkie.browser-test)
#   * keeps logs/state under $CLE_TEST_STATE_ROOT    (never the live folder)
#   * never spawns/kills a gateway, never starts the CUA driver, never updates
#   * only ever connects to 127.0.0.1:19789
#
# The main controller runs this; it is intentionally not started by CI.
#
#   ./browser-test-host.sh --build            # compile the .app, do not launch
#   ./browser-test-host.sh --run              # build (if needed) then open it
#   ./browser-test-host.sh --print-env        # show resolved paths
#
# Environment overrides:
#   CLE_TEST_PORT         default 19789
#   CLE_TEST_BUNDLE_ID    default com.cle0726.super-pinkie.browser-test
#   CLE_TEST_STATE_ROOT   default ~/Library/Application Support/SuperPinkie/browser-test
#   CLE_TEST_BUILD_DIR    default <repo>/dist/browser-test
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT="${CLE_TEST_PORT:-19789}"
BUNDLE_ID="${CLE_TEST_BUNDLE_ID:-com.cle0726.super-pinkie.browser-test}"
STATE_ROOT="${CLE_TEST_STATE_ROOT:-$HOME/Library/Application Support/SuperPinkie/browser-test}"
BUILD_ROOT="${CLE_TEST_BUILD_DIR:-$REPO_ROOT/dist/browser-test}"
APP_NAME="C.le. Browser Test"
APP_PATH="$BUILD_ROOT/$APP_NAME.app"
CONTENTS="$APP_PATH/Contents"
RESOURCES="$CONTENTS/Resources/SuperPinkie"
RUNTIME="$RESOURCES/runtime"
VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION" 2>/dev/null || echo 0.0.0)"

die() { echo "error: $*" >&2; exit 1; }

# The host needs a real OpenClaw package for its runtime. Prefer an explicitly
# provided one, then the developer install, never the live app bundle (which
# must stay untouched and is usually running).
resolve_openclaw_root() {
  local candidate
  for candidate in \
    "${CLE_TEST_OPENCLAW_ROOT:-}" \
    "$HOME/release-superpinkie/sandbox/openclaw-pristine" \
    "$HOME/Library/Application Support/SuperPinkie/dev/cle-stage/npm/lib/node_modules/openclaw" \
    "$(npm root -g 2>/dev/null || true)/openclaw"; do
    [[ -n "$candidate" ]] || continue
    if [[ -f "$candidate/package.json" && -f "$candidate/openclaw.mjs" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_node() {
  local candidate
  for candidate in "${CLE_TEST_NODE_BIN:-}" "$(command -v node 2>/dev/null || true)" \
    /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    # The bundled runtime only needs node itself; npm is not required here.
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

print_env() {
  cat <<EOF
repo        $REPO_ROOT
app         $APP_PATH
bundle id   $BUNDLE_ID
gateway     http://127.0.0.1:$PORT/
state       $STATE_ROOT
openclaw    $(resolve_openclaw_root || echo "(not found)")
node        $(resolve_node || echo "(not found)")
EOF
}

build() {
  local node openclaw
  node="$(resolve_node)" || die "no node found; set CLE_TEST_NODE_BIN"
  openclaw="$(resolve_openclaw_root)" || die "no OpenClaw package found; set CLE_TEST_OPENCLAW_ROOT"

  rm -rf "$APP_PATH"
  mkdir -p "$CONTENTS/MacOS" "$RESOURCES" "$RUNTIME/bin" "$STATE_ROOT/logs"

  echo "==> compiling Launcher (same sources as the app)"
  xcrun swiftc -parse-as-library -O \
    "$SCRIPT_DIR/Sources/MaterialPreview.swift" \
    "$SCRIPT_DIR/Sources/BrowserControl.swift" \
    "$SCRIPT_DIR/Sources/Launcher.swift" \
    -framework AppKit -framework AVFoundation -framework Foundation \
    -framework Speech -framework WebKit \
    -o "$CONTENTS/MacOS/Launcher"

  echo "==> staging runtime (node + openclaw)"
  cp "$node" "$RUNTIME/bin/node"
  chmod 755 "$RUNTIME/bin/node"
  # Copy without mutating the source package (never write into the developer's
  # install or the live bundle).
  ditto --norsrc --noextattr "$openclaw" "$RUNTIME/openclaw"
  ln -sfn "../openclaw/openclaw.mjs" "$RUNTIME/bin/openclaw"

  # The web UI, persona text and static art come from this worktree so the host
  # renders exactly the code under review.
  local part
  for part in VERSION ui personas; do
    [[ -d "$REPO_ROOT/$part" ]] && ditto --norsrc --noextattr "$REPO_ROOT/$part" "$RESOURCES/$part"
  done

  cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>C.le. Browser Test</string>
  <key>CFBundleExecutable</key><string>Launcher</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>C.le. Browser Test</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMultipleInstancesProhibited</key><false/>
</dict>
</plist>
PLIST

  echo "==> signing ad-hoc with a stable requirement"
  codesign --force --deep --options runtime --sign - "$APP_PATH"
  codesign --force --options runtime --sign - \
    --requirements "=designated => identifier \"$BUNDLE_ID\"" \
    "$APP_PATH" >/dev/null
  codesign --verify --deep --strict "$APP_PATH"
  echo "built: $APP_PATH"
}

run() {
  [[ -x "$CONTENTS/MacOS/Launcher" ]] || die "host not built; run --build first"
  [[ -d "$STATE_ROOT" ]] || mkdir -p "$STATE_ROOT/logs"
  echo "==> launching against 127.0.0.1:$PORT (no gateway is started or replaced)"
  env \
    PINKIE_TEST_HOST=1 \
    PINKIE_GATEWAY_URL="http://127.0.0.1:$PORT/" \
    PINKIE_STATE_ROOT="$STATE_ROOT" \
    PINKIE_CONFIG_PATH="$STATE_ROOT/config.json" \
    OPENCLAW_NO_AUTO_UPDATE=1 \
    CUA_DRIVER_RS_UPDATE_CHECK=false \
    "$CONTENTS/MacOS/Launcher"
}

case "${1:---run}" in
  --build) build ;;
  --run) [[ -x "$CONTENTS/MacOS/Launcher" ]] || build; run ;;
  --print-env) print_env ;;
  *) die "unknown option: $1 (use --build, --run or --print-env)" ;;
esac
