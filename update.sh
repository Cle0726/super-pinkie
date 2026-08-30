#!/usr/bin/env bash
# update.sh — pull the latest 超级碧琪 kit from its git remote and re-apply.
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
  git stash pop || true
fi

echo "==> re-applying prompts, patches and proxy"
./install.sh
echo "done. Restart the openclaw gateway if it was running."
