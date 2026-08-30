#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_URL="${PINKIE_REPOSITORY_URL:-https://github.com/Cle0726/super-pinkie.git}"
INSTALL_ROOT="${PINKIE_REPOSITORY_ROOT:-$HOME/Library/Application Support/SuperPinkie/repository}"

command -v git >/dev/null 2>&1 || {
  echo "需要先安装 Git。" >&2
  exit 1
}

if [[ -d "$INSTALL_ROOT/.git" ]]; then
  git -C "$INSTALL_ROOT" fetch origin
  git -C "$INSTALL_ROOT" pull --ff-only origin main
else
  mkdir -p "$(dirname "$INSTALL_ROOT")"
  git clone --branch main "$REPOSITORY_URL" "$INSTALL_ROOT"
fi

chmod +x "$INSTALL_ROOT/install-full.sh" "$INSTALL_ROOT/update-full.sh"
exec "$INSTALL_ROOT/install-full.sh" "$@"
