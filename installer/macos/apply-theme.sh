#!/bin/bash
# Reapply the exact 来啦～老弟 skin after an OpenClaw or 超級碧琪 update.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
USER_HOME="${HOME:?HOME is not set}"
ASSET_ROOT="$REPO_ROOT/ui/assets"
INJECTION_ROOT="$REPO_ROOT/ui/injections"
LAUNCHER_SOURCE="$REPO_ROOT/desktop/macos/Sources/Launcher.swift"
NODE_VERSIONS_ROOT="$USER_HOME/.nvm/versions/node"
LAUNCHER_APP_PATH="${PINKIE_APP_PATH:-/Applications/超級碧琪.app}"
SKIP_APP_BUNDLES="${PINKIE_SKIP_APP_BUNDLES:-0}"

copy_if_changed() {
  local source_file="$1"
  local target_file="$2"
  if [[ ! -f "$target_file" ]] || ! cmp -s "$source_file" "$target_file"; then
    cp "$source_file" "$target_file"
    DID_CHANGE=1
  fi
}

apply_ui_skin() {
  local ui_root="$1"
  local index_file="$ui_root/index.html"
  local asset

  [[ -f "$index_file" ]] || return 0

  for asset in \
    laolao-avatar.png \
    laolao-mode-chat.png \
    laolao-mode-project.png \
    laolao-mode-thinking.png \
    laolao-mode-unrestricted.png \
    laolao-mode-chat-hd.png \
    laolao-mode-project-hd.png \
    laolao-mode-thinking-hd.png \
    laolao-mode-unrestricted-hd.png \
    laolao-mode-transition-chat.png \
    laolao-mode-transition-project.png \
    laolao-mode-transition-thinking.png \
    laolao-mode-transition-unrestricted.png \
    laolao-mode-chat.svg \
    laolao-mode-project.svg \
    laolao-mode-thinking.svg \
    laolao-mode-unrestricted.svg \
    laolao-wallpaper.png \
    laolao-wallpaper-project.png \
    laolao-wallpaper-thinking.png \
    laolao-wallpaper-unrestricted.png \
    laolao-splash.png \
    laolao-theme.css \
    laolao-sidebar.css \
    laolao-sidebar.js \
    laolao-usage-stats.css \
    laolao-usage-stats.js \
    laolao-quota.json \
    laolao-splash.css \
    laolao-splash.js \
    laolao-handoff-bootstrap.js \
    laolao-phrases.js \
    laolao-live-voice.js \
    laolao-mode-switcher.js \
    laolao-image-viewer.js \
    favicon.svg \
    favicon-32.png \
    favicon.ico; do
    if [[ -f "$INJECTION_ROOT/$asset" ]]; then
      copy_if_changed "$INJECTION_ROOT/$asset" "$ui_root/$asset"
    else
      copy_if_changed "$ASSET_ROOT/$asset" "$ui_root/$asset"
    fi
  done

  copy_if_changed "$ASSET_ROOT/laolao-avatar.png" "$ui_root/apple-touch-icon.png"
  copy_if_changed "$ASSET_ROOT/manifest.webmanifest" "$ui_root/manifest.webmanifest"

  if ! grep -Fq './laolao-theme.css' "$index_file"; then
    local temp_index
    temp_index="$(mktemp "$ui_root/.laolao-head.XXXXXX")"
    awk -v fragment="$INJECTION_ROOT/laolao-head.fragment.html" '
      /<\/head>/ {
        while ((getline line < fragment) > 0) print line
        close(fragment)
      }
      { print }
    ' "$index_file" > "$temp_index"
    mv "$temp_index" "$index_file"
    DID_CHANGE=1
  fi

  # New presentation scripts may be added after the original skin is already
  # installed, so inject them independently of the first CSS injection.
  if ! grep -Fq './laolao-sidebar.js' "$index_file"; then
    perl -0pi -e 's{(<script type="module")}{    <script src="./laolao-sidebar.js?v=sidebar6"></script>\n    $1}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-sidebar.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-sidebar.css?v=sidebar6">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  # 顶栏用量统计胶囊：JS 必须紧跟 sidebar.js（依赖其 __laolaoSidebar.gwRequest 句柄）
  if ! grep -Fq './laolao-usage-stats.js' "$index_file"; then
    perl -0pi -e 's{(<script src="\./laolao-sidebar\.js[^"]*"></script>)}{$1\n    <script src="./laolao-usage-stats.js?v=stats7"></script>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-usage-stats.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-usage-stats.css?v=stats7">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-phrases.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-phrases.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-live-voice.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-live-voice.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-mode-switcher.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-mode-switcher.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-image-viewer.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-image-viewer.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-splash.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-splash.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq 'id="laolao-splash"' "$index_file"; then
    local temp_index
    temp_index="$(mktemp "$ui_root/.laolao-body.XXXXXX")"
    awk -v fragment="$INJECTION_ROOT/laolao-body.fragment.html" '
      /<body[^>]*>/ {
        print
        while ((getline line < fragment) > 0) print line
        close(fragment)
        next
      }
      { print }
    ' "$index_file" > "$temp_index"
    mv "$temp_index" "$index_file"
    DID_CHANGE=1
  fi

  # Remove the retired inline splash controller. It competed with the current
  # mode handoff controller and could pull a carried 68% back toward 8%.
  if grep -Fq 'var minimumDuration = 2600;' "$index_file"; then
    perl -0pi -e 's{\s*<script>\s*\(function \(\) \{\s*var splash = document\.getElementById\("laolao-splash"\);(?:(?!</script>)[\s\S])*?var minimumDuration = 2600;(?:(?!</script>)[\s\S])*?\}\)\(\);\s*</script>}{}g' "$index_file"
    DID_CHANGE=1
  fi

  # This synchronous bootstrap runs immediately after the splash markup, so
  # the new document's first painted frame already shows the carried progress.
  if ! grep -Fq './laolao-handoff-bootstrap.js' "$index_file"; then
    perl -0pi -e 's{(<openclaw-app>)}{    <script src="./laolao-handoff-bootstrap.js?v=handoff2"></script>\n    $1}' "$index_file"
    DID_CHANGE=1
  fi

  # Custom assets keep stable filenames so upgrades can restore them. Bump the
  # query version here whenever interaction or transition behavior changes;
  # otherwise WebKit may keep an older local copy after a normal reload.
  if ! grep -Fq './laolao-theme.css?v=theme17' "$index_file"; then
    perl -0pi -e 's{\./laolao-theme\.css(?:\?v=[^"]*)?}{./laolao-theme.css?v=theme17}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-sidebar.js?v=sidebar6' "$index_file"; then
    perl -0pi -e 's{\./laolao-sidebar\.js(?:\?v=[^"]*)?}{./laolao-sidebar.js?v=sidebar6}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-sidebar.css?v=sidebar6' "$index_file"; then
    perl -0pi -e 's{\./laolao-sidebar\.css(?:\?v=[^"]*)?}{./laolao-sidebar.css?v=sidebar6}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-usage-stats.js?v=stats7' "$index_file"; then
    perl -0pi -e 's{\./laolao-usage-stats\.js(?:\?v=[^"]*)?}{./laolao-usage-stats.js?v=stats7}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-usage-stats.css?v=stats7' "$index_file"; then
    perl -0pi -e 's{\./laolao-usage-stats\.css(?:\?v=[^"]*)?}{./laolao-usage-stats.css?v=stats7}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-splash.css?v=splash15' "$index_file"; then
    perl -0pi -e 's{\./laolao-splash\.css(?:\?v=[^"]*)?}{./laolao-splash.css?v=splash15}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-mode-switcher.js?v=mode21' "$index_file"; then
    perl -0pi -e 's{\./laolao-mode-switcher\.js(?:\?v=[^"]*)?}{./laolao-mode-switcher.js?v=mode21}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-splash.js?v=splash17' "$index_file"; then
    perl -0pi -e 's{\./laolao-splash\.js(?:\?v=[^"]*)?}{./laolao-splash.js?v=splash17}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-handoff-bootstrap.js?v=handoff2' "$index_file"; then
    perl -0pi -e 's{\./laolao-handoff-bootstrap\.js(?:\?v=[^"]*)?}{./laolao-handoff-bootstrap.js?v=handoff2}g' "$index_file"
    DID_CHANGE=1
  fi

  if grep -Fq '<title>OpenClaw Control</title>' "$index_file"; then
    perl -0pi -e 's{<title>OpenClaw Control</title>}{<title>来啦～老弟</title>}' "$index_file"
    DID_CHANGE=1
  fi
}

apply_bundle_icon() {
  local app_path="$1"
  local icon_name="$2"
  local resources="$app_path/Contents/Resources"
  local plist="$app_path/Contents/Info.plist"
  local target_icon="$resources/$icon_name.icns"
  local current_icon

  [[ -d "$app_path" && -f "$plist" ]] || return 0
  current_icon="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$plist" 2>/dev/null || true)"

  if [[ "$current_icon" != "$icon_name" ]] || ! cmp -s "$ASSET_ROOT/PinkieAppIcon.icns" "$target_icon"; then
    copy_if_changed "$ASSET_ROOT/PinkieAppIcon.icns" "$target_icon"
    if /usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$plist" >/dev/null 2>&1; then
      /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile $icon_name" "$plist"
    else
      /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string $icon_name" "$plist"
    fi
    DID_CHANGE=1
  fi
}

rebuild_launcher_if_needed() {
  local app_path="$1"
  local source_file="$LAUNCHER_SOURCE"
  local target_file="$app_path/Contents/MacOS/Launcher"
  local temp_binary

  [[ -f "$source_file" && -d "$app_path/Contents/MacOS" ]] || return 0
  if [[ -x "$target_file" ]] && [[ "$target_file" -nt "$source_file" ]] \
    && strings "$target_file" | grep -Fq 'laolaoProjectFolder'; then
    return 0
  fi

  temp_binary="$(mktemp "$app_path/Contents/MacOS/.Launcher.XXXXXX")"
  xcrun swiftc -parse-as-library -O "$source_file" \
    -framework AppKit \
    -framework AVFoundation \
    -framework Foundation \
    -framework Speech \
    -framework WebKit \
    -o "$temp_binary"
  chmod 755 "$temp_binary"
  mv "$temp_binary" "$target_file"
  DID_CHANGE=1
}

sync_agent_avatars() {
  mkdir -p \
    "$USER_HOME/.openclaw/workspace/avatars" \
    "$USER_HOME/.openclaw/workspace-project/avatars" \
    "$USER_HOME/.openclaw/workspace-thinking/avatars" \
    "$USER_HOME/.openclaw/workspace-unrestricted/avatars"
  copy_if_changed "$ASSET_ROOT/laolao-mode-chat-hd.png" "$USER_HOME/.openclaw/workspace/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-project-hd.png" "$USER_HOME/.openclaw/workspace-project/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-thinking-hd.png" "$USER_HOME/.openclaw/workspace-thinking/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-unrestricted-hd.png" "$USER_HOME/.openclaw/workspace-unrestricted/avatars/unrestricted-mode.png"
}

OPENCLAW_ROOT="${OPENCLAW_ROOT:-}"
if [[ -z "$OPENCLAW_ROOT" ]]; then
  if command -v openclaw >/dev/null 2>&1; then
    openclaw_entry="$(command -v openclaw)"
    openclaw_entry="$(realpath "$openclaw_entry" 2>/dev/null || readlink "$openclaw_entry" 2>/dev/null || printf '%s' "$openclaw_entry")"
    if [[ -f "$openclaw_entry" ]]; then
      OPENCLAW_ROOT="$(cd "$(dirname "$openclaw_entry")" && pwd)"
    fi
  fi
fi
if [[ -z "$OPENCLAW_ROOT" ]]; then
  for candidate in "$NODE_VERSIONS_ROOT"/*/lib/node_modules/openclaw; do
    if [[ -f "$candidate/openclaw.mjs" ]]; then
      OPENCLAW_ROOT="$candidate"
    fi
  done
fi

DID_CHANGE=0
sync_agent_avatars
if [[ -n "$OPENCLAW_ROOT" ]]; then
  apply_ui_skin "$OPENCLAW_ROOT/dist/control-ui"
else
  echo "error: OpenClaw installation not found; set OPENCLAW_ROOT and retry" >&2
  exit 1
fi

if [[ "$SKIP_APP_BUNDLES" != "1" ]]; then
  rebuild_launcher_if_needed "$LAUNCHER_APP_PATH"
  apply_bundle_icon "$LAUNCHER_APP_PATH" "PinkieAppIcon"

  if [[ "$DID_CHANGE" == "1" ]]; then
    # Reseal the standalone local launcher only; keep the official App signed by OpenClaw.
    codesign --force --sign - --preserve-metadata=identifier,entitlements,flags,runtime "$LAUNCHER_APP_PATH" >/dev/null 2>&1 || true
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -f "$LAUNCHER_APP_PATH"
    touch "$LAUNCHER_APP_PATH"
  fi
fi
