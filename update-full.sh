#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${PINKIE_CONFIG_ROOT:-$HOME/.config/super-pinkie}/install.env"

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "当前目录不是 Git 仓库，请从 GitHub clone 后安装。" >&2
  exit 1
fi

echo "==> 拉取 super-pinkie 更新"
git -C "$REPO_ROOT" fetch --tags origin
git -C "$REPO_ROOT" pull --ff-only origin "$(git -C "$REPO_ROOT" branch --show-current)"

PROVIDER=""
if [[ -f "$CONFIG_FILE" ]]; then
  # This file is written by install-full.sh and contains only shell-escaped local paths/provider id.
  source "$CONFIG_FILE"
  PROVIDER="${PINKIE_PROVIDER:-}"
fi

echo "==> 重新应用完整安装"
if [[ -n "$PROVIDER" ]]; then
  "$REPO_ROOT/install-full.sh" --provider "$PROVIDER"
else
  "$REPO_ROOT/install-full.sh"
fi

echo "已经更新到 $(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
