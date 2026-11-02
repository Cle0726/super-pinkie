#!/bin/bash
# Reapply the exact 来啦～老弟 skin after an OpenClaw or 超級碧琪 update.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
USER_HOME="${HOME:?HOME is not set}"
ASSET_ROOT="$REPO_ROOT/ui/assets"
INJECTION_ROOT="$REPO_ROOT/ui/injections"
PINKIE_NATIVE_SOURCE_DIR="$REPO_ROOT/desktop/macos/pinkie/Sources"
LAUNCHER_SOURCE="$PINKIE_NATIVE_SOURCE_DIR/Launcher.swift"
LAUNCHER_SUPPORT_SOURCES=("$PINKIE_NATIVE_SOURCE_DIR/MaterialPreview.swift" "$PINKIE_NATIVE_SOURCE_DIR/BrowserControl.swift")
NODE_VERSIONS_ROOT="$USER_HOME/.nvm/versions/node"
LAUNCHER_APP_PATH="${PINKIE_APP_PATH:-/Applications/超級碧琪.app}"
SKIP_APP_BUNDLES="${PINKIE_SKIP_APP_BUNDLES:-0}"
BUNDLE_BUILD_ONLY="${PINKIE_BUNDLE_BUILD_ONLY:-0}"
PYTHON_BIN="${PINKIE_PYTHON_BIN:-/usr/bin/python3}"

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
  [[ -f "$index_file" ]] || return 0
  local python_bin="${PINKIE_PYTHON_BIN:-python3}"
  local previous_manifest=""
  [[ ! -f "$ui_root/pinkie-ui-manifest.json" ]] || previous_manifest="$(shasum -a 256 "$ui_root/pinkie-ui-manifest.json")"

  # One source for resources, ordering and versions on BOTH platforms. Run
  # after an installed runtime snapshot too; snapshots must never own the skin.
  "$python_bin" "$REPO_ROOT/tools/ui-parity/bundle.py" install --root "$REPO_ROOT" --control-ui "$ui_root"
  if [[ "$previous_manifest" != "$(shasum -a 256 "$ui_root/pinkie-ui-manifest.json")" ]]; then DID_CHANGE=1; fi

  # Patched native chunks keep their upstream hashed filename. Cache-first
  # would therefore keep serving the pre-patch renderer. Give the local UI
  # network priority and version its disposable cache; offline fallback stays.
  local service_worker="$ui_root/sw.js"
  if [[ -f "$service_worker" ]]; then
    perl -0pi -e '
      s{-clekk-history-render-[0-9]+}{}g;
      s{(const EMBEDDED_CACHE_VERSION = "[^"]*)(";)}{${1}-clekk-history-render-59${2}};
    ' "$service_worker"
    perl -0pi -e '
      s{// Cache-first for hashed assets; network-first for HTML/other\.}{// Network-first for all UI files; cached copies remain an offline fallback.}g;
      s{caches\.match\(event\.request\)\.then\(\n        \(cached\) =>\n          cached \|\|\n          fetch\(event\.request\)\.then\(\(response\) => \{\n            if \(response\.ok\) \{\n              const clone = response\.clone\(\);\n              void caches\.open\(CACHE_NAME\)\.then\(\(cache\) => cache\.put\(event\.request, clone\)\);\n            \}\n            return response;\n          \}\),\n      \)}{fetch(event.request)\n        .then((response) => {\n          if (response.ok) {\n            const clone = response.clone();\n            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));\n          }\n          return response;\n        })\n        .catch(() => caches.match(event.request))}g;
    ' "$service_worker"
  fi

  # Branding changes here contain no inline-script edits.
  perl -0pi -e 's{<title>[^<]*</title>}{<title>超級碧琪</title>}' "$index_file"
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
  local support_file support_fresh=1
  for support_file in "${LAUNCHER_SUPPORT_SOURCES[@]}"; do
    [[ -f "$support_file" ]] || return 0
    [[ "$target_file" -nt "$support_file" ]] || support_fresh=0
  done
  if [[ -x "$target_file" ]] && [[ "$target_file" -nt "$source_file" ]] && (( support_fresh )) \
    && strings "$target_file" | grep -Fq 'super-pinkie.material-preview' \
    && strings "$target_file" | grep -Fq 'laolaoProjectFolder' \
    && strings "$target_file" | grep -Fq 'laolaoRoundtable' \
    && strings "$target_file" | grep -Fq 'laolaoWorkspaceDock' \
    && strings "$target_file" | grep -Fq 'laolaoBrowserWorkspace' \
    && strings "$target_file" | grep -Fq 'laolaoMaterialPreview'; then
    return 0
  fi

  temp_binary="$(mktemp "$app_path/Contents/MacOS/.Launcher.XXXXXX")"
  xcrun swiftc -parse-as-library -O "${LAUNCHER_SUPPORT_SOURCES[@]}" "$source_file" \
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

sync_launcher_resources() {
  local app_path="$1"
  local bundled_root="$app_path/Contents/Resources/SuperPinkie"
  local bundled_ui="$bundled_root/runtime/openclaw/dist/control-ui"
  local service_file source_file

  [[ -d "$bundled_root/ui/assets" ]] || return 0
  # The launcher executes apply-bundled.sh from inside the app. Keep this
  # bootstrap in sync with the source so an installed hotfix cannot be undone
  # by an older self-mutating bootstrap on the next cold launch.
  copy_if_changed "$REPO_ROOT/installer/macos/apply-bundled.sh" "$bundled_root/installer/macos/apply-bundled.sh"
  copy_if_changed "$REPO_ROOT/installer/macos/apply-theme.sh" "$bundled_root/installer/macos/apply-theme.sh"
  mkdir -p "$bundled_root/tools/ui-parity"
  copy_if_changed "$REPO_ROOT/tools/ui-parity/bundle.py" "$bundled_root/tools/ui-parity/bundle.py"
  copy_if_changed "$REPO_ROOT/ui/parity-policy.json" "$bundled_root/ui/parity-policy.json"
  copy_if_changed "$REPO_ROOT/ui/control-ui.index.html" "$bundled_root/ui/control-ui.index.html"
  mkdir -p "$bundled_root/ui/runtime"
  for source_file in "$REPO_ROOT/ui/runtime"/*.js; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/runtime/$(basename "$source_file")"
  done
  # Both paths contain the same Pinkie sources: the explicit path is used by
  # this installer, and the canonical path is used by existing repair tools.
  local native_file native_target
  for native_target in "$bundled_root/desktop/macos/Sources" "$bundled_root/desktop/macos/pinkie/Sources"; do
    mkdir -p "$native_target"
    for native_file in Launcher.swift MaterialPreview.swift BrowserControl.swift BrowserControl.js; do
      copy_if_changed "$PINKIE_NATIVE_SOURCE_DIR/$native_file" "$native_target/$native_file"
    done
  done
  copy_if_changed "$REPO_ROOT/ui/launcher-loading.html" "$bundled_root/ui/launcher-loading.html"
  copy_if_changed "$ASSET_ROOT/laolao-splash.mp4" "$bundled_root/ui/assets/laolao-splash.mp4"
  copy_if_changed "$ASSET_ROOT/laolao-splash-video-poster.png" "$bundled_root/ui/assets/laolao-splash-video-poster.png"
  # Keep every bundled web surface aligned with the hotfix source. Party and
  # Roundtable are served from this source tree rather than control-ui, while
  # a future repair/manual install may consume the raw injection tree. Leaving
  # either copy stale makes an update appear successful but keeps the old UI.
  mkdir -p \
    "$bundled_root/ui/injections" \
    "$bundled_root/ui/assets" \
    "$bundled_root/ui/party" \
    "$bundled_root/ui/roundtable" \
    "$bundled_root/services/party" \
    "$bundled_root/services/roundtable"
  for source_file in "$INJECTION_ROOT"/*; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/injections/$(basename "$source_file")"
  done
  local nested_file nested_root nested_target
  for nested_root in "$INJECTION_ROOT/vendor" "$ASSET_ROOT/study-desk" "$ASSET_ROOT/fonts"; do
    [[ -d "$nested_root" ]] || continue
    if [[ "$nested_root" == "$INJECTION_ROOT/"* ]]; then nested_target="$bundled_root/ui/injections"; else nested_target="$bundled_root/ui/assets"; fi
    while IFS= read -r -d '' nested_file; do
      local relative_file="${nested_file#"${nested_root%/*}"/}"
      mkdir -p "$(dirname "$nested_target/$relative_file")"
      copy_if_changed "$nested_file" "$nested_target/$relative_file"
    done < <(find "$nested_root" -type f -print0)
  done
  for source_file in "$ASSET_ROOT"/*; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/assets/$(basename "$source_file")"
  done
  for source_file in "$REPO_ROOT/ui/party"/*; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/party/$(basename "$source_file")"
  done
  for source_file in "$REPO_ROOT/ui/roundtable"/*; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/roundtable/$(basename "$source_file")"
  done
  for service_file in identities.json live.py openclaw-live.mjs server.py setup.py usage.py; do
    copy_if_changed \
      "$REPO_ROOT/services/party/$service_file" \
      "$bundled_root/services/party/$service_file"
  done
  copy_if_changed \
    "$REPO_ROOT/services/roundtable/server.py" \
    "$bundled_root/services/roundtable/server.py"
  # The state-root rule moved into its own top-level module so the context
  # budget, the usage ledger and the installers cannot drift apart. Hotfixing
  # the consumers into a bundle that predates it would leave the cold-launch
  # repair crashing on a missing file, so ship the module with them.
  copy_if_changed \
    "$REPO_ROOT/services/state_root.py" \
    "$bundled_root/services/state_root.py"
  # The managed launcher installs these two OpenClaw extensions from its own
  # bundled service tree on every cold launch. Keep that tree aligned with the
  # hotfix source as well; otherwise a restart silently restores stale hook
  # policy and can reintroduce tool blocking even though ~/.openclaw/extensions
  # was already repaired.
  mkdir -p \
    "$bundled_root/services/context" \
    "$bundled_root/services/project-scope" \
    "$bundled_root/services/mode-architecture" \
    "$bundled_root/services/chatgpt-collab" \
    "$bundled_root/skills/deep-think" \
    "$bundled_root/skills/web-gpt-collab" \
    "$bundled_root/patch" \
    "$bundled_root/proxy"
  for service_file in context_budget.py setup.py budget.mjs policy.json; do
    copy_if_changed \
      "$REPO_ROOT/services/context/$service_file" \
      "$bundled_root/services/context/$service_file"
  done
  for service_file in index.mjs setup.py package.json openclaw.plugin.json; do
    copy_if_changed \
      "$REPO_ROOT/services/project-scope/$service_file" \
      "$bundled_root/services/project-scope/$service_file"
  done
  for service_file in index.mjs memory.mjs learning.mjs learning-visuals.mjs learning-explore.mjs learning-devices.mjs learning-labs.mjs learning-practice.mjs learning-compute.mjs learning-c-trace.mjs learning-engine.py learning-requirements.txt learning-pact.mjs learning-desk.mjs learning-exams.mjs learning-vocab.mjs learning-almanac.mjs learning-holidays-cn.json learning-refs.mjs learning-recall.mjs learning-companion.mjs learning-lesson.mjs learning-materials.mjs learning-materials-jobs.mjs learning-materials-extract.mjs learning-zsb.mjs learning-zsb-gen.mjs learning-zsb-data.json learning-zsb-items.json openclaw-paths.mjs companion.mjs reasoning.mjs work-kinds.mjs background-jobs.mjs work-status.mjs model-sync.mjs web-gpt-activity.mjs web-gpt-connection.mjs web-gpt-project-context.mjs ask.mjs reply-hygiene.mjs app-browser.mjs file-delivery.mjs app-guide.mjs rich-runtime.mjs workbench.mjs workbench-lsp.mjs workbench-ext.mjs nb_runner.py nb_bootstrap.py setup.py package.json openclaw.plugin.json; do
    if [[ -f "$REPO_ROOT/services/mode-architecture/$service_file" ]]; then
      copy_if_changed \
        "$REPO_ROOT/services/mode-architecture/$service_file" \
        "$bundled_root/services/mode-architecture/$service_file"
    fi
  done
  # Older app packages can receive UI first, before the staged plugin.
  if [[ -f "$REPO_ROOT/services/mode-architecture/learning-library.mjs" ]]; then
    copy_if_changed "$REPO_ROOT/services/mode-architecture/learning-library.mjs" "$bundled_root/services/mode-architecture/learning-library.mjs"
  fi
  # Learning library backend vendor, kept with the plugin in app bundles.
  if [[ -d "$REPO_ROOT/services/mode-architecture/vendor" ]]; then
    while IFS= read -r -d '' source_file; do
      relative_path="${source_file#"$REPO_ROOT/services/mode-architecture/"}"
      target_file="$bundled_root/services/mode-architecture/$relative_path"
      mkdir -p "$(dirname "$target_file")"
      copy_if_changed "$source_file" "$target_file"
    done < <(find "$REPO_ROOT/services/mode-architecture/vendor" -type f -print0)
  fi
  while IFS= read -r -d '' source_file; do
    relative_path="${source_file#"$REPO_ROOT/services/chatgpt-collab/"}"
    target_file="$bundled_root/services/chatgpt-collab/$relative_path"
    mkdir -p "$(dirname "$target_file")"
    copy_if_changed "$source_file" "$target_file"
  done < <(find "$REPO_ROOT/services/chatgpt-collab" -type f -print0)
  copy_if_changed "$REPO_ROOT/skills/deep-think/SKILL.md" "$bundled_root/skills/deep-think/SKILL.md"
  copy_if_changed "$REPO_ROOT/skills/web-gpt-collab/SKILL.md" "$bundled_root/skills/web-gpt-collab/SKILL.md"
  # Cold launch repairs the pinned runtime from this directory. Keep these
  # scripts aligned with source so a restart cannot restore an older policy.
  for source_file in "$REPO_ROOT/patch"/*.mjs; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/patch/$(basename "$source_file")"
  done
  copy_if_changed "$REPO_ROOT/proxy/mm-retry-proxy.py" "$bundled_root/proxy/mm-retry-proxy.py"
  if [[ -f "$bundled_ui/index.html" ]]; then
    apply_ui_skin "$bundled_ui"
  fi
}

install_model_retry_proxy() {
  local source_script="$REPO_ROOT/proxy/mm-retry-proxy.py"
  local target_script="$USER_HOME/bin/mm-retry-proxy.py"
  local backup_root changed=0 label plist_args
  [[ -f "$source_script" ]] || return 0
  mkdir -p "$(dirname "$target_script")"
  if [[ -f "$target_script" ]] && ! cmp -s "$source_script" "$target_script"; then
    backup_root="$USER_HOME/Library/Application Support/SuperPinkie/backups/model-proxy-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_root"
    cp -p "$target_script" "$backup_root/mm-retry-proxy.py"
  fi
  if [[ ! -f "$target_script" ]] || ! cmp -s "$source_script" "$target_script"; then
    copy_if_changed "$source_script" "$target_script"
    changed=1
  fi
  chmod 755 "$target_script"
  [[ "$changed" == "1" ]] || return 0
  # Restart only the four known proxy jobs whose saved ProgramArguments point
  # at this exact script. Cookies, model accounts and gateway sessions live in
  # separate stores and are never touched here.
  for label in \
    com.openclaw.mm-retry-proxy \
    com.openclaw.mm-retry-proxy-force \
    com.openclaw.mm-retry-proxy-codex \
    com.openclaw.mm-retry-proxy-codex-oc; do
    plist_args="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$USER_HOME/Library/LaunchAgents/$label.plist" 2>/dev/null || true)"
    [[ "$plist_args" == *"$target_script"* ]] || continue
    launchctl kickstart -k "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  done
}

# 主题注入会改动 App 包内资源；无论中途哪个可选补丁失败，都必须在
# 退出前重新封装签名，否则 LaunchServices 会把整个 App 判定为损坏。
reseal_app_on_exit() {
  local exit_code=$?
  trap - EXIT
  local needs_reseal="${DID_CHANGE:-0}"
  # Some bundled-runtime patches edit files directly and cannot update the
  # shell-level DID_CHANGE flag. Check the envelope itself as a second guard;
  # otherwise the next LaunchServices launch would see a stale sealed-resource
  # hash even though the sync command reported success.
  if [[ "$needs_reseal" != "1" && -d "$LAUNCHER_APP_PATH" ]] \
      && ! codesign --verify --deep --strict "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
    needs_reseal=1
  fi
  if [[ "${SKIP_APP_BUNDLES:-0}" != "1" && "$needs_reseal" == "1" && -d "$LAUNCHER_APP_PATH" ]]; then
    local preserved_ok=1
    if ! codesign --force --deep --sign - --preserve-metadata=identifier,requirements,entitlements,flags,runtime "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
      preserved_ok=0
    fi
    # codesign can return success while retaining a stale nested
    # CodeResources entry (for example after an optional roundtable asset was
    # removed). Verify the resulting envelope, not only the signing command.
    if [[ "$preserved_ok" != "1" ]] \
        || ! codesign --verify --deep --strict "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
      # A replaced nested resource can make the old entitlement envelope
      # impossible to preserve (macOS reports a sealed-resource mismatch).
      # Fall back to a fresh ad-hoc envelope so a UI-only sync never leaves
      # the installed App unlaunchable. The launcher keeps its bundle ID and
      # runtime flags; the CUA helper remains separately signed.
      if ! codesign --force --deep --options runtime --sign - "$LAUNCHER_APP_PATH" >/dev/null 2>&1 \
          || ! codesign --verify --deep --strict "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
        echo "error: failed to reseal $LAUNCHER_APP_PATH" >&2
        [[ "$exit_code" -eq 0 ]] && exit_code=1
      else
        echo "warning: resealed $LAUNCHER_APP_PATH with a fresh local signature" >&2
      fi
    fi
    # Local builds are ad-hoc signed. Without an explicit designated
    # requirement macOS derives identity from the CDHash, which changes after
    # every hotfix and makes an already-enabled permission look ungranted.
    # Re-sign only the outer App envelope with the same stable identity used by
    # desktop/macos/build.sh; vendor-signed CuaDriver remains untouched.
    if codesign -dvv "$LAUNCHER_APP_PATH" 2>&1 | grep -Fq 'Signature=adhoc'; then
      if ! codesign --force --options runtime --sign - \
          --requirements '=designated => identifier "com.cle0726.super-pinkie"' \
          "$LAUNCHER_APP_PATH" >/dev/null 2>&1 \
          || ! codesign -dr - "$LAUNCHER_APP_PATH" 2>&1 \
            | grep -Fq 'designated => identifier "com.cle0726.super-pinkie"'; then
        echo "error: failed to preserve CLE Kk's stable local permission identity" >&2
        [[ "$exit_code" -eq 0 ]] && exit_code=1
      fi
    fi
    if ! codesign --verify --deep --strict "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
      echo "error: updated CLE Kk App signature did not verify" >&2
      [[ "$exit_code" -eq 0 ]] && exit_code=1
    fi
  fi
  exit "$exit_code"
}

sync_agent_avatars() {
  mkdir -p \
    "$USER_HOME/.openclaw/workspace/avatars" \
    "$USER_HOME/.openclaw/workspace-project/avatars" \
    "$USER_HOME/.openclaw/workspace-thinking/avatars" \
    "$USER_HOME/.openclaw/workspace-learning/avatars" \
    "$USER_HOME/.openclaw/workspace-unrestricted/avatars"
  copy_if_changed "$ASSET_ROOT/laolao-mode-chat-hd.png" "$USER_HOME/.openclaw/workspace/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-project-hd.png" "$USER_HOME/.openclaw/workspace-project/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-thinking-hd.png" "$USER_HOME/.openclaw/workspace-thinking/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-learning-hd.png" "$USER_HOME/.openclaw/workspace-learning/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-unrestricted-hd.png" "$USER_HOME/.openclaw/workspace-unrestricted/avatars/unrestricted-mode.png"
}

install_relay_watchdog() {
  local source_script="$REPO_ROOT/services/watchdog/cle-watchdog.sh"
  local source_plist="$REPO_ROOT/services/watchdog/ai.openclaw.watchdog.plist.in"
  local target_script="$USER_HOME/.openclaw/scripts/cle_watchdog.sh"
  local target_plist="$USER_HOME/Library/LaunchAgents/ai.openclaw.watchdog.plist"
  local backup_root should_reload=0

  [[ -f "$source_script" && -f "$source_plist" ]] || return 0
  mkdir -p "$(dirname "$target_script")" "$(dirname "$target_plist")"
  if [[ -f "$target_script" ]] && ! cmp -s "$source_script" "$target_script"; then
    backup_root="$USER_HOME/Library/Application Support/SuperPinkie/backups/relay-watchdog-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_root"
    cp -p "$target_script" "$backup_root/cle_watchdog.sh"
  fi
  if [[ ! -f "$target_script" ]] || ! cmp -s "$source_script" "$target_script"; then
    copy_if_changed "$source_script" "$target_script"
    should_reload=1
  fi
  chmod 755 "$target_script"
  sed "s|@SCRIPT@|$target_script|g" "$source_plist" > "$target_plist.tmp"
  if [[ ! -f "$target_plist" ]] || ! cmp -s "$target_plist.tmp" "$target_plist"; then
    mv "$target_plist.tmp" "$target_plist"
    should_reload=1
  else
    rm -f "$target_plist.tmp"
  fi
  if ! launchctl print "gui/$(id -u)/ai.openclaw.watchdog" >/dev/null 2>&1; then
    should_reload=1
  fi
  if [[ "$should_reload" == "1" ]]; then
    launchctl bootout "gui/$(id -u)/ai.openclaw.watchdog" >/dev/null 2>&1 || true
    # bootout 返回后 launchd 可能还在收尾，紧接着 bootstrap 会报「5: Input/output error」，
    # 看门狗就此没装上，中继断了也没人重连。多试几次。
    local attempt
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      launchctl bootstrap "gui/$(id -u)" "$target_plist" 2>/dev/null && break
      sleep 1
    done
    if ! launchctl print "gui/$(id -u)/ai.openclaw.watchdog" >/dev/null 2>&1; then
      echo "warning: ai.openclaw.watchdog did not load; run: launchctl bootstrap gui/$(id -u) $target_plist" >&2
    fi
  fi
}

OPENCLAW_ROOT="${OPENCLAW_ROOT:-}"
if [[ -z "$OPENCLAW_ROOT" ]]; then
  # The managed App owns the gateway it is about to update. Prefer that
  # runtime before PATH: a shell shim named `openclaw` is not a package root
  # and has no `dist/` tree to patch.
  BUNDLED_RUNTIME="${PINKIE_APP_PATH:-/Applications/超級碧琪.app}/Contents/Resources/SuperPinkie/runtime/openclaw"
  if [[ -f "$BUNDLED_RUNTIME/openclaw.mjs" ]]; then
    OPENCLAW_ROOT="$BUNDLED_RUNTIME"
  fi
fi
if [[ -z "$OPENCLAW_ROOT" ]]; then
  if command -v openclaw >/dev/null 2>&1; then
    openclaw_entry="$(command -v openclaw)"
    openclaw_entry="$(realpath "$openclaw_entry" 2>/dev/null || readlink "$openclaw_entry" 2>/dev/null || printf '%s' "$openclaw_entry")"
    openclaw_candidate="$(cd "$(dirname "$openclaw_entry")" && pwd)"
    if [[ -f "$openclaw_candidate/openclaw.mjs" ]]; then
      OPENCLAW_ROOT="$openclaw_candidate"
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
trap reseal_app_on_exit EXIT
if [[ "$BUNDLE_BUILD_ONLY" != "1" ]]; then
  sync_agent_avatars
  install_model_retry_proxy
  install_relay_watchdog
fi
if [[ -n "$OPENCLAW_ROOT" ]]; then
  if [[ "$BUNDLE_BUILD_ONLY" != "1" && -f "$REPO_ROOT/services/party/usage.py" ]]; then
    # Reuse the existing stats scheduler; don't add another background job.
    if [[ -f "$USER_HOME/.openclaw/laolao-stats-sync.py" ]]; then
      if ! cmp -s "$REPO_ROOT/services/party/usage.py" "$USER_HOME/.openclaw/laolao-stats-sync.py"; then
        mkdir -p "$USER_HOME/Library/Application Support/SuperPinkie/backups"
        USAGE_BACKUP="$(mktemp -d "$USER_HOME/Library/Application Support/SuperPinkie/backups/usage-sync-XXXXXX")"
        cp -p "$USER_HOME/.openclaw/laolao-stats-sync.py" "$USAGE_BACKUP/laolao-stats-sync.py"
      fi
      copy_if_changed "$REPO_ROOT/services/party/usage.py" "$USER_HOME/.openclaw/laolao-stats-sync.py"
    fi
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$PYTHON_BIN" "$REPO_ROOT/services/party/usage.py"
  fi
  if [[ -f "$REPO_ROOT/patch/apply-context-budget.mjs" ]]; then
    CONTEXT_NODE="$(command -v node 2>/dev/null || true)"
    if [[ -z "$CONTEXT_NODE" && -x "$OPENCLAW_ROOT/../../../bin/node" ]]; then
      CONTEXT_NODE="$OPENCLAW_ROOT/../../../bin/node"
    fi
    if [[ -z "$CONTEXT_NODE" ]]; then
      echo "error: Node is required for model-aware context protection" >&2
      exit 1
    fi
    # Browser transformations (timeline/math/drafts/media/delivery) are already
    # included in ui/runtime, shared with Windows and installed last below.
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-context-budget.mjs"
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-history-image-thumbnails.mjs"
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-compaction-boundary-recovery.mjs"
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-loopback-model-reliability.mjs"
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-work-thinking.mjs"
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-thinking-capabilities.mjs"
    if [[ "$BUNDLE_BUILD_ONLY" != "1" ]]; then
      "$PYTHON_BIN" "$REPO_ROOT/services/context/setup.py"
      # Update the live extensions too. A hotfix that changes only the App's
      # bundled source would otherwise leave the current gateway on stale
      # watchdog and project-tool logic until a later cold launch.
      "$PYTHON_BIN" "$REPO_ROOT/services/project-scope/setup.py"
      "$PYTHON_BIN" "$REPO_ROOT/services/mode-architecture/setup.py"
    fi
    # 图片白名单扩展：允许个人目录和精确的 ~/.openclaw/workspace* 工作区
    # 显示本轮产出；整个 ~/.openclaw 配置目录仍不在白名单中。
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-image-access.mjs"
    # The native material viewer uses an opaque clekk-material: URL. Keep the
    # strict Control UI CSP, but allow that one in-app scheme for image/PDF
    # rendering; this does not grant the agent any new filesystem or tool access.
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-material-preview-csp.mjs"
    # The managed desktop gateway is loopback-only and belongs to the user.
    # OpenClaw's owner-only sender filter would otherwise strip gateway,
    # nodes and cron from every CLE Kk mode even when tools.profile=full.
    if [[ -f "$REPO_ROOT/patch/apply-local-unrestricted-policy.mjs" ]]; then
      OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-local-unrestricted-policy.mjs"
    fi
    # 首轮即向模型公开已配对节点的完整 Computer Use v2 动作；否则
    # list_apps / accessibility / bring_to_front 会被旧版 v1 参数表隐藏。
    if ! OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-computer-v2.mjs"; then
      echo "warning: Computer Use v2 patch skipped because this runtime has no matching chunk" >&2
    fi
  fi
  # Runtime patches can regenerate the entrypoint. The FINAL skin must always
  # come from the shared source, after every patch, just like Windows overlays.
  if [[ -f "$OPENCLAW_ROOT/dist/control-ui/index.html" ]]; then
    apply_ui_skin "$OPENCLAW_ROOT/dist/control-ui"
  fi
else
  echo "error: CLE Kk compatibility runtime not found; set OPENCLAW_ROOT and retry" >&2
  exit 1
fi

if [[ "$SKIP_APP_BUNDLES" != "1" ]]; then
  sync_launcher_resources "$LAUNCHER_APP_PATH"
  rebuild_launcher_if_needed "$LAUNCHER_APP_PATH"
  apply_bundle_icon "$LAUNCHER_APP_PATH" "PinkieAppIcon"

  if [[ "$DID_CHANGE" == "1" ]]; then
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -f "$LAUNCHER_APP_PATH"
    touch "$LAUNCHER_APP_PATH"
  fi
fi
