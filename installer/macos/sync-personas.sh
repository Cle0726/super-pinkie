#!/usr/bin/env bash
# Install or update the bundled persona files (manuals and playbooks).
#
#   sync-personas.sh <personas dir> <openclaw home> <backup dir>
#
# Manuals and playbooks follow the official version. For every bundled file:
#   - missing on this machine       -> copy it in
#   - identical to the bundled one  -> nothing to do
#   - different                     -> back it up, then replace it
# The unrestricted mode and DREAMS.md are never replaced once they exist.
# Memory and the owner's own files (USER.md, TOOLS.md, MEMORY.md, memory/) are
# not bundled, so they are never touched.
set -euo pipefail

PERSONAS_DIR="$1"
OPENCLAW_HOME="$2"
BACKUP_DIR="$3"

install_file() {
  local src="$1" dst="$2" key="$3" keep="$4"
  if [[ ! -e "$dst" && ! -L "$dst" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "    + $key"
    return 0
  fi
  if [[ -L "$dst" || "$keep" == "1" ]]; then
    return 0
  fi
  if cmp -s "$src" "$dst"; then
    return 0
  fi
  mkdir -p "$BACKUP_DIR/$(dirname "$key")"
  cp -p "$dst" "$BACKUP_DIR/$key"
  cp "$src" "$dst"
  echo "    ~ $key (updated, old copy in backups)"
}

sync_mode() {
  local mode="$1" target="$2" src rel keep
  [[ -d "$PERSONAS_DIR/$mode" ]] || return 0
  mkdir -p "$target"
  while IFS= read -r -d '' src; do
    rel="${src#"$PERSONAS_DIR/$mode/"}"
    keep=0
    if [[ "$mode" == "neutral" || "$rel" == "DREAMS.md" ]]; then
      keep=1
    fi
    install_file "$src" "$target/$rel" "$mode/$rel" "$keep"
  done < <(find "$PERSONAS_DIR/$mode" -type f ! -name '.DS_Store' -print0 | sort -z)
  if [[ -d "$target/playbooks" ]]; then
    find "$target/playbooks" -maxdepth 1 -name '*.sh' -exec chmod +x {} + 2>/dev/null || true
  fi
}

sync_mode chat "$OPENCLAW_HOME/workspace"
sync_mode project "$OPENCLAW_HOME/workspace-project"
sync_mode thinking "$OPENCLAW_HOME/workspace-thinking"
sync_mode learning "$OPENCLAW_HOME/workspace-learning"
sync_mode neutral "$OPENCLAW_HOME/workspace-unrestricted"
