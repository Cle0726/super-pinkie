#!/usr/bin/env bash
# First-launch setup used by the packaged macOS App.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_ROOT="${PINKIE_STATE_ROOT:-$HOME/Library/Application Support/SuperPinkie}"
MARKER="$STATE_ROOT/bundled-personas-$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"

mkdir -p "$STATE_ROOT"

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
  install_persona "$REPO_ROOT/personas/thinking" "$HOME/.openclaw/workspace-thinking" thinking
  install_persona "$REPO_ROOT/personas/neutral" "$HOME/.openclaw/workspace-unrestricted" neutral
  touch "$MARKER"
fi

PINKIE_SKIP_APP_BUNDLES=1 "$SCRIPT_DIR/apply-theme.sh"
