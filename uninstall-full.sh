#!/usr/bin/env bash
set -euo pipefail

STATE_ROOT="${PINKIE_STATE_ROOT:-$HOME/Library/Application Support/SuperPinkie}"
CONFIG_ROOT="${PINKIE_CONFIG_ROOT:-$HOME/.config/super-pinkie}"
APP_PATH="/Applications/来啦～老弟.app"

if [[ -f "$CONFIG_ROOT/install.env" ]]; then
  source "$CONFIG_ROOT/install.env"
  APP_PATH="${PINKIE_APP_PATH:-$APP_PATH}"
fi

for label in com.super-pinkie.tts com.super-pinkie.reapply; do
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
done

rm -f \
  "$HOME/Library/LaunchAgents/com.super-pinkie.tts.plist" \
  "$HOME/Library/LaunchAgents/com.super-pinkie.reapply.plist"

"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install.sh" --remove || true

if [[ -d "$APP_PATH" ]]; then
  TRASH_TARGET="$HOME/.Trash/来啦～老弟-$(date +%Y%m%d-%H%M%S).app"
  mv "$APP_PATH" "$TRASH_TARGET"
  echo "App 已移到废纸篓：$TRASH_TARGET"
fi

echo "人格备份、聊天、记忆和项目数据均已保留在原位置。"
echo "若确认不再需要，可手动删除：$STATE_ROOT"
