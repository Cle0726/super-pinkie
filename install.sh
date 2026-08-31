#!/usr/bin/env bash
# install.sh — deploy the unrestricted-prompt kit for an OpenClaw gateway.
#
# What it does:
#   1. Copies prompts/ into ~/.openclaw/ (UR_PROMPTS_DIR overrides)
#   2. Installs the rewrite proxy and starts it (nohup; optionally launchd)
#   3. Patches the OpenClaw model transports (both layers)
#   4. Optionally points a provider at the proxy (--provider <id>)
#
# Usage:
#   ./install.sh                       # prompts + proxy + patch
#   ./install.sh --provider mm         # also point the "mm" provider at the proxy
#   ./install.sh --launchd             # also install a LaunchAgent for the proxy
#   ./install.sh --remove              # uninstall: strip patches + stop proxy
#
# Environment:
#   UR_PROMPTS_DIR    prompts destination (default ~/.openclaw)
#   UR_PROXY_PORT     proxy listen port (default 1467)
#   UR_UPSTREAM_PORT  model relay port (default 1466)
#   OPENCLAW_ROOT     openclaw package dir (auto-detected from PATH otherwise)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPTS_DIR="${UR_PROMPTS_DIR:-$HOME/.openclaw}"
PROXY_PORT="${UR_PROXY_PORT:-1467}"
UPSTREAM_PORT="${UR_UPSTREAM_PORT:-1466}"
PROXY_SCRIPT="$REPO_DIR/proxy/mm-retry-proxy.py"
PATCH_SCRIPT="$REPO_DIR/patch/reapply-unrestricted-patch.mjs"
LAUNCHD_LABEL="com.openclaw.urproxy"
MODE="${1:-install}"

if [[ "$MODE" == "--remove" ]]; then
  echo "==> stripping transport patches"
  node "$PATCH_SCRIPT" --remove || true
  echo "==> stopping proxy"
  pkill -f "mm-retry-proxy.py" 2>/dev/null || true
  if [[ -f "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist" ]]; then
    launchctl unload "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
    echo "==> LaunchAgent removed"
  fi
  echo "done. Config baseUrl changes (if any) must be reverted manually."
  exit 0
fi

echo "==> 1/4 copying prompts -> $PROMPTS_DIR"
mkdir -p "$PROMPTS_DIR"
cp "$REPO_DIR"/prompts/unrestricted-prompt-*.txt "$PROMPTS_DIR/"
echo "    $(ls "$REPO_DIR"/prompts/unrestricted-prompt-*.txt | wc -l | tr -d ' ') prompt files installed"

echo "==> 2/4 patching OpenClaw transports"
node "$PATCH_SCRIPT"
node "$REPO_DIR/patch/apply-context-budget.mjs"
python3 "$REPO_DIR/services/context/setup.py"

echo "==> 3/4 starting rewrite proxy on :$PROXY_PORT -> :$UPSTREAM_PORT"
pkill -f "mm-retry-proxy.py" 2>/dev/null || true
sleep 1
nohup python3 "$PROXY_SCRIPT" "$PROXY_PORT" >/tmp/openclaw-mm-retry-proxy.log 2>&1 &
sleep 2
curl -sf "http://127.0.0.1:$PROXY_PORT/health" >/dev/null && echo "    proxy healthy" || { echo "    WARNING: proxy health check failed (see /tmp/openclaw-mm-retry-proxy.log)"; }

if [[ "$*" == *"--launchd"* ]]; then
  echo "==> 3b installing LaunchAgent (auto-restart)"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$PROXY_SCRIPT</string>
    <string>$PROXY_PORT</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>UR_PROXY_UPSTREAM_PORT</key><string>$UPSTREAM_PORT</string>
    <key>UR_PROXY_PROMPTS_DIR</key><string>$PROMPTS_DIR</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/openclaw-mm-retry-proxy.log</string>
  <key>StandardErrorPath</key><string>/tmp/openclaw-mm-retry-proxy.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist" 2>/dev/null || true
  launchctl load "$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
  echo "    LaunchAgent installed"
fi

if [[ "$*" == *"--provider"* ]]; then
  PROVIDER_ID=""
  for i in "$@"; do
    if [[ "$i" == "--provider" ]]; then PROVIDER_ID="next"; continue; fi
    if [[ "$PROVIDER_ID" == "next" ]]; then PROVIDER_ID="$i"; break; fi
  done
  if [[ -n "$PROVIDER_ID" && -f "$HOME/.openclaw/openclaw.json" ]] && command -v jq >/dev/null; then
    echo "==> 4/4 pointing provider '$PROVIDER_ID' at the proxy"
    TMP_CFG="$(mktemp)"
    jq --arg p "$PROVIDER_ID" --arg u "http://127.0.0.1:$PROXY_PORT/v1" \
       ".models.providers[\$p].baseUrl = \$u" \
       "$HOME/.openclaw/openclaw.json" > "$TMP_CFG"
    cp "$TMP_CFG" "$HOME/.openclaw/openclaw.json"
    rm -f "$TMP_CFG"
    echo "    done. Restart the openclaw gateway for it to take effect."
  else
    echo "==> 4/4 (skipped) point your provider's baseUrl at http://127.0.0.1:$PROXY_PORT/v1 manually"
  fi
fi

echo
echo "All set. Restart the openclaw gateway, then in an unrestricted-mode session send the"
echo "verification token to confirm the injection is live (see README.md)."
