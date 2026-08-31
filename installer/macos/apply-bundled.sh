#!/usr/bin/env bash
# First-launch setup used by the packaged macOS App.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_ROOT="${PINKIE_STATE_ROOT:-$HOME/Library/Application Support/SuperPinkie}"
MARKER="$STATE_ROOT/bundled-personas-$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"

mkdir -p "$STATE_ROOT"

# The pre-release skin used a watcher that restores its own stale three-mode
# files whenever index.html changes. Disable and preserve it before applying
# the bundled release so it cannot roll a fresh install backward.
LEGACY_REAPPLY_PLIST="$HOME/Library/LaunchAgents/com.laolao.theme-reapply.plist"
if [[ -f "$LEGACY_REAPPLY_PLIST" ]]; then
  LEGACY_BACKUP_ROOT="$STATE_ROOT/backups/legacy-launchagents-$(date +%Y%m%d-%H%M%S)"
  launchctl bootout "gui/$(id -u)/com.laolao.theme-reapply" >/dev/null 2>&1 || true
  mkdir -p "$LEGACY_BACKUP_ROOT"
  mv "$LEGACY_REAPPLY_PLIST" "$LEGACY_BACKUP_ROOT/"
fi

if [[ ! -f "$MARKER" ]]; then
  BACKUP_ROOT="$STATE_ROOT/backups/bundled-$(date +%Y%m%d-%H%M%S)"
  install_persona() {
    local source_dir="$1"
    local target_dir="$2"
    local label="$3"
    mkdir -p "$target_dir"
    for filename in SOUL.md IDENTITY.md; do
      if [[ -f "$target_dir/$filename" ]]; then
        mkdir -p "$BACKUP_ROOT/$label"
        cp "$target_dir/$filename" "$BACKUP_ROOT/$label/$filename"
      fi
      cp "$source_dir/$filename" "$target_dir/$filename"
    done
  }
  install_persona "$REPO_ROOT/personas/chat" "$HOME/.openclaw/workspace" chat
  install_persona "$REPO_ROOT/personas/project" "$HOME/.openclaw/workspace-project" project
  install_persona "$REPO_ROOT/personas/thinking" "$HOME/.openclaw/workspace-thinking" thinking
  install_persona "$REPO_ROOT/personas/neutral" "$HOME/.openclaw/workspace-unrestricted" neutral
  OPENCLAW_BIN="$(command -v openclaw 2>/dev/null || true)"
  if [[ -z "$OPENCLAW_BIN" ]]; then
    for candidate in "$HOME"/.nvm/versions/node/*/bin/openclaw /opt/homebrew/bin/openclaw /usr/local/bin/openclaw; do
      if [[ -x "$candidate" ]]; then
        OPENCLAW_BIN="$candidate"
        break
      fi
    done
  fi
  if [[ -n "$OPENCLAW_BIN" ]]; then
    PROJECT_AGENT_ADDED=0
    if ! "$OPENCLAW_BIN" agents list --json 2>/dev/null | grep -Eq '"id"[[:space:]]*:[[:space:]]*"project"'; then
      "$OPENCLAW_BIN" agents add project --non-interactive --workspace "$HOME/.openclaw/workspace-project"
      PROJECT_AGENT_ADDED=1
    fi
    "$OPENCLAW_BIN" agents set-identity --agent project --identity-file "$HOME/.openclaw/workspace-project/IDENTITY.md" >/dev/null
    if [[ "$PROJECT_AGENT_ADDED" == "1" ]]; then
      "$OPENCLAW_BIN" gateway restart >/dev/null 2>&1 || true
    fi
  fi
  touch "$MARKER"
fi

PINKIE_SKIP_APP_BUNDLES=1 "$SCRIPT_DIR/apply-theme.sh"
