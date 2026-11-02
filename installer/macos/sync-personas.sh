#!/usr/bin/env bash
# Install or update the bundled persona files (manuals and playbooks) without losing the owner's edits.
#
#   sync-personas.sh <personas dir> <openclaw home> <backup dir>
#
# For every bundled file:
#   - missing on this machine            -> copy it in
#   - identical to the bundled one       -> nothing to do
#   - still exactly a version we shipped -> the owner never edited it: back it up, then update it
#   - anything else                      -> the owner's own work: keep it
# The unrestricted mode and DREAMS.md are never replaced once they exist.
# "Versions we shipped" are listed in <personas dir>/shipped-hashes.txt
# (tools/personas/shipped_hashes.py), hashed with carriage returns removed.
set -euo pipefail

PERSONAS_DIR="$1"
OPENCLAW_HOME="$2"
BACKUP_DIR="$3"
SHIPPED="$PERSONAS_DIR/shipped-hashes.txt"

if command -v shasum >/dev/null 2>&1; then
  sha_of() { tr -d '\r' < "$1" | shasum -a 256 | awk '{ print $1 }'; }
else
  sha_of() { tr -d '\r' < "$1" | sha256sum | awk '{ print $1 }'; }
fi

install_file() {
  local src="$1" dst="$2" key="$3" keep="$4" dst_sha
  if [[ ! -e "$dst" && ! -L "$dst" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "    + $key"
    return 0
  fi
  if [[ -L "$dst" || "$keep" == "1" ]]; then
    return 0
  fi
  dst_sha="$(sha_of "$dst")"
  if [[ "$dst_sha" == "$(sha_of "$src")" ]]; then
    return 0
  fi
  if [[ ! -f "$SHIPPED" ]] || ! grep -qxF "$dst_sha $key" "$SHIPPED"; then
    echo "    = $key (kept: edited on this machine)"
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
