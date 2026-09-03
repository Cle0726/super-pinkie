#!/usr/bin/env bash
# Full macOS installer for the exact 超級碧琪 build.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_ROOT="${PINKIE_STATE_ROOT:-$HOME/Library/Application Support/SuperPinkie}"
CONFIG_ROOT="${PINKIE_CONFIG_ROOT:-$HOME/.config/super-pinkie}"
BACKUP_ROOT="$STATE_ROOT/backups/$(date +%Y%m%d-%H%M%S)"
PROVIDER=""
INSTALL_INJECTION=1
INSTALL_AGENTS=1
INSTALL_TTS=1
INSTALL_SERVICES=1
PROJECT_AGENT_ADDED=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)
      PROVIDER="${2:-}"
      shift 2
      ;;
    --skip-injection)
      INSTALL_INJECTION=0
      shift
      ;;
    --skip-personas)
      INSTALL_AGENTS=0
      shift
      ;;
    --skip-tts)
      INSTALL_TTS=0
      shift
      ;;
    --no-services)
      INSTALL_SERVICES=0
      shift
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS. Use install-full.ps1 on Windows." >&2
  exit 1
fi

for command_name in git node python3 xcrun; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "missing dependency: $command_name" >&2
    exit 1
  }
done

mkdir -p "$STATE_ROOT" "$CONFIG_ROOT" "$BACKUP_ROOT"
if [[ ! -f "$CONFIG_ROOT/config.json" ]]; then
  cp "$REPO_ROOT/config.example.json" "$CONFIG_ROOT/config.json"
fi

install_persona() {
  local source_dir="$1"
  local target_dir="$2"
  local label="$3"
  mkdir -p "$target_dir"
  for filename in SOUL.md IDENTITY.md; do
    if [[ -e "$target_dir/$filename" || -L "$target_dir/$filename" ]]; then
      echo "    [$label] 保留已有 $filename"
      continue
    fi
    cp "$source_dir/$filename" "$target_dir/$filename"
  done
}

ensure_project_agent() {
  command -v openclaw >/dev/null 2>&1 || return 0
  if ! openclaw agents list --json 2>/dev/null | node -e '
    let source = "";
    process.stdin.on("data", (chunk) => source += chunk);
    process.stdin.on("end", () => {
      try { process.exit(JSON.parse(source).some((agent) => agent.id === "project") ? 0 : 1); }
      catch { process.exit(1); }
    });
  '; then
    openclaw agents add project --non-interactive --workspace "$HOME/.openclaw/workspace-project"
    PROJECT_AGENT_ADDED=1
  fi
  openclaw agents set-identity --agent project --identity-file "$HOME/.openclaw/workspace-project/IDENTITY.md" >/dev/null
  if [[ "$PROJECT_AGENT_ADDED" == "1" ]]; then
    openclaw gateway restart >/dev/null 2>&1 || true
  fi
}

echo "==> 1/6 安装人格文件（原有三套保持原样）"
if [[ "$INSTALL_AGENTS" == "1" ]]; then
  install_persona "$REPO_ROOT/personas/chat" "$HOME/.openclaw/workspace" chat
  install_persona "$REPO_ROOT/personas/project" "$HOME/.openclaw/workspace-project" project
  install_persona "$REPO_ROOT/personas/thinking" "$HOME/.openclaw/workspace-thinking" thinking
  install_persona "$REPO_ROOT/personas/neutral" "$HOME/.openclaw/workspace-unrestricted" neutral
else
  echo "    已跳过"
fi

echo "==> 2/6 安装提示词代理与传输补丁"
if [[ "$INSTALL_INJECTION" == "1" ]]; then
  if [[ -n "$PROVIDER" ]]; then
    "$REPO_ROOT/install.sh" --provider "$PROVIDER" --launchd
  else
    "$REPO_ROOT/install.sh" --launchd
  fi
else
  echo "    已跳过"
fi

if [[ "$INSTALL_AGENTS" == "1" ]]; then
  ensure_project_agent
fi

echo "==> 3/6 安装碧琪语音服务"
if [[ "$INSTALL_TTS" == "1" ]]; then
  VENV_ROOT="$STATE_ROOT/venv"
  python3 -m venv "$VENV_ROOT"
  "$VENV_ROOT/bin/python" -m pip install --disable-pip-version-check -q -r "$REPO_ROOT/services/tts/requirements.txt"

  if [[ "$INSTALL_SERVICES" == "1" ]]; then
    TTS_PLIST="$HOME/Library/LaunchAgents/com.super-pinkie.tts.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    sed \
      -e "s|@PYTHON@|$VENV_ROOT/bin/python|g" \
      -e "s|@SERVER@|$REPO_ROOT/services/tts/edge_tts_server.py|g" \
      "$REPO_ROOT/installer/macos/com.super-pinkie.tts.plist.in" > "$TTS_PLIST"
    launchctl bootout "gui/$(id -u)/com.super-pinkie.tts" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$TTS_PLIST"
  fi
else
  echo "    已跳过"
fi

echo "==> 4/6 构建并安装超級碧琪.app"
/usr/bin/python3 "$REPO_ROOT/services/party/setup.py"
/usr/bin/python3 "$REPO_ROOT/services/project-scope/setup.py"
chmod +x "$REPO_ROOT/desktop/macos/build.sh"
PINKIE_BUILD_DIR="$STATE_ROOT/build" "$REPO_ROOT/desktop/macos/build.sh" >/dev/null
SOURCE_APP="$STATE_ROOT/build/超級碧琪.app"
if [[ -n "${PINKIE_APP_ROOT:-}" ]]; then
  APP_ROOT="$PINKIE_APP_ROOT"
  mkdir -p "$APP_ROOT"
elif [[ -w /Applications ]]; then
  APP_ROOT="/Applications"
else
  APP_ROOT="$HOME/Applications"
  mkdir -p "$APP_ROOT"
fi
TARGET_APP="$APP_ROOT/超級碧琪.app"
LEGACY_APP="$APP_ROOT/来啦～老弟.app"
if [[ -d "$TARGET_APP" ]]; then
  mkdir -p "$BACKUP_ROOT/app"
  ditto "$TARGET_APP" "$BACKUP_ROOT/app/超級碧琪.app"
  rm -rf "$TARGET_APP"
fi
if [[ -d "$LEGACY_APP" ]]; then
  mkdir -p "$BACKUP_ROOT/app"
  ditto "$LEGACY_APP" "$BACKUP_ROOT/app/来啦～老弟.app"
  rm -rf "$LEGACY_APP"
fi
ditto "$SOURCE_APP" "$TARGET_APP"

echo "==> 5/6 注入完整 UI 与模式功能"
LEGACY_REAPPLY_PLIST="$HOME/Library/LaunchAgents/com.laolao.theme-reapply.plist"
if [[ -f "$LEGACY_REAPPLY_PLIST" ]]; then
  launchctl bootout "gui/$(id -u)/com.laolao.theme-reapply" >/dev/null 2>&1 || true
  mkdir -p "$BACKUP_ROOT/legacy-launchagents"
  mv "$LEGACY_REAPPLY_PLIST" "$BACKUP_ROOT/legacy-launchagents/"
fi
PINKIE_APP_PATH="$TARGET_APP" "$REPO_ROOT/installer/macos/apply-theme.sh"

echo "==> 6/6 安装更新入口"
UPDATE_PLIST="$HOME/Library/LaunchAgents/com.super-pinkie.reapply.plist"
if [[ "$INSTALL_SERVICES" == "1" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  sed \
    -e "s|@APPLY_SCRIPT@|$REPO_ROOT/installer/macos/apply-theme.sh|g" \
    -e "s|@APP_PATH@|$TARGET_APP|g" \
    "$REPO_ROOT/installer/macos/com.super-pinkie.reapply.plist.in" > "$UPDATE_PLIST"
  launchctl bootout "gui/$(id -u)/com.super-pinkie.reapply" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$UPDATE_PLIST"
else
  echo "    已跳过后台服务注册"
fi

printf 'PINKIE_REPO=%q\n' "$REPO_ROOT" > "$CONFIG_ROOT/install.env"
printf 'PINKIE_PROVIDER=%q\n' "$PROVIDER" >> "$CONFIG_ROOT/install.env"
printf 'PINKIE_APP_PATH=%q\n' "$TARGET_APP" >> "$CONFIG_ROOT/install.env"

echo
echo "安装完成：$TARGET_APP"
echo "更新命令：$REPO_ROOT/update-full.sh"
