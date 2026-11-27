#!/usr/bin/env bash
# update.sh — pull the latest 超級碧琪 kit from its git remote and re-apply.
# Usage: ./update.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> pulling updates from origin"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: this kit is not a git checkout (clone it from the repo instead of downloading a zip)."
  exit 1
fi

git fetch origin
if ! git pull --ff-only origin; then
  echo "local changes detected; stashing and retrying"
  git stash push -m "super-pinkie-update-$(date +%s)" || true
  git pull --ff-only origin
  if ! git stash pop; then
    echo "error: your local changes conflict with the update and were NOT re-applied cleanly." >&2
    echo "they are still saved in 'git stash list'; resolve the conflicts, then re-run ./install.sh." >&2
    exit 1
  fi
fi

echo "==> re-applying prompts, patches and proxy"
./install.sh
echo "done. Restart the C.le. gateway if it was running."
