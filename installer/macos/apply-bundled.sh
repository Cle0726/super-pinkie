#!/usr/bin/env bash
# First-launch setup used by the packaged macOS App.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_ROOT="${PINKIE_STATE_ROOT:-$HOME/Library/Application Support/SuperPinkie}"
MARKER="$STATE_ROOT/bundled-personas-$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
PYTHON_BIN="${PINKIE_PYTHON_BIN:-/usr/bin/python3}"

mkdir -p "$STATE_ROOT"

# 产品设定防护（正式版才做事：包里 build-info.json 的 guard 为 true；开发版立刻退出）。
# 校验签名清单，把被改过的人设/手册/插件/自带技能换回包里的官方版本，openclaw.json 只修产品键。
# 放在 setup 之前：被关掉的插件要先打开，setup 才不会报「插件被禁用」。出错不挡启动。
GUARD_NODE="$REPO_ROOT/runtime/bin/node"
if [[ -f "$REPO_ROOT/build-info.json" && -x "$GUARD_NODE" && -f "$REPO_ROOT/installer/guard/guard.mjs" ]]; then
  "$GUARD_NODE" "$REPO_ROOT/installer/guard/guard.mjs" startup --app-state "$STATE_ROOT" >/dev/null 2>&1 || true
fi

# Older CLE Kk builds installed OpenClaw's global KeepAlive LaunchAgent.  That
# service survives the App, starts with a different Node executable identity,
# and can take port 18789 before the self-contained Launcher gets a chance to
# start its own gateway.  Besides keeping old runtime code alive, this makes
# macOS show/recheck permissions for several indistinguishable "node" rows.
# Migrate only the exact legacy job whose plist points back into this App's
# private runtime; unrelated OpenClaw installations are deliberately ignored.
migrate_legacy_managed_gateway() {
  local legacy_plist="$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"
  local legacy_label legacy_args backup_root
  [[ "${PINKIE_MANAGED_GATEWAY:-0}" == "1" && -f "$legacy_plist" ]] || return 0
  legacy_label="$(/usr/libexec/PlistBuddy -c 'Print :Label' "$legacy_plist" 2>/dev/null || true)"
  legacy_args="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$legacy_plist" 2>/dev/null || true)"
  [[ "$legacy_label" == "ai.openclaw.gateway" ]] || return 0
  [[ "$legacy_args" == *"$REPO_ROOT/runtime/openclaw/"* ]] || return 0
  [[ "$legacy_args" == *"gateway"* ]] || return 0

  backup_root="$STATE_ROOT/backups/legacy-launchagents-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup_root"
  launchctl bootout "gui/$(id -u)/ai.openclaw.gateway" >/dev/null 2>&1 || true
  mv "$legacy_plist" "$backup_root/ai.openclaw.gateway.plist"
}

migrate_legacy_managed_gateway

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
  # Once per version: manuals and playbooks follow this version (old copies backed up); memory untouched.
  bash "$SCRIPT_DIR/sync-personas.sh" "$REPO_ROOT/personas" "$HOME/.openclaw" "$BACKUP_ROOT/personas"
  OPENCLAW_BIN="${PINKIE_OPENCLAW_BIN:-$(command -v openclaw 2>/dev/null || true)}"
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
    LEARNING_AGENT_ADDED=0
    # This validates the OpenClaw configuration. Reuse the result while it is
    # unchanged rather than starting the full CLI once for each existing mode.
    if ! AGENTS_JSON="$("$OPENCLAW_BIN" agents list --json 2>/dev/null)"; then
      AGENTS_JSON=""
    fi
    UNCHANGED_IDENTITIES=""
    if [[ "${PINKIE_MANAGED_GATEWAY:-0}" == "1" && -f "$SCRIPT_DIR/agent-setup-plan.py" ]]; then
      UNCHANGED_IDENTITIES="$("$PYTHON_BIN" "$SCRIPT_DIR/agent-setup-plan.py" "$REPO_ROOT/runtime/openclaw/package.json" "$OPENCLAW_BIN" 2>/dev/null || true)"
    fi
    if ! printf '%s\n' "$AGENTS_JSON" | grep -Eq '"id"[[:space:]]*:[[:space:]]*"project"'; then
      "$OPENCLAW_BIN" agents add project --non-interactive --workspace "$HOME/.openclaw/workspace-project"
      PROJECT_AGENT_ADDED=1
    fi
    if [[ "$PROJECT_AGENT_ADDED" == "1" || " $UNCHANGED_IDENTITIES " != *" project "* ]]; then
      "$OPENCLAW_BIN" agents set-identity --agent project --identity-file "$HOME/.openclaw/workspace-project/IDENTITY.md" >/dev/null
    fi
    if [[ "$PROJECT_AGENT_ADDED" == "1" ]]; then
      # Adding a mode changes the config, so fetch a fresh view for learning.
      if ! AGENTS_JSON="$("$OPENCLAW_BIN" agents list --json 2>/dev/null)"; then
        AGENTS_JSON=""
      fi
    fi
    if ! printf '%s\n' "$AGENTS_JSON" | grep -Eq '"id"[[:space:]]*:[[:space:]]*"learning"'; then
      "$OPENCLAW_BIN" agents add learning --non-interactive --workspace "$HOME/.openclaw/workspace-learning"
      LEARNING_AGENT_ADDED=1
    fi
    if [[ "$LEARNING_AGENT_ADDED" == "1" || " $UNCHANGED_IDENTITIES " != *" learning "* ]]; then
      "$OPENCLAW_BIN" agents set-identity --agent learning --identity-file "$HOME/.openclaw/workspace-learning/IDENTITY.md" >/dev/null
    fi
    # Metre（briefs/metre-mode-1113）：工作区只有 AGENTS / IDENTITY / SOUL 三份，由 sync-personas.sh 放好。
    METRE_AGENT_ADDED=0
    if [[ "$LEARNING_AGENT_ADDED" == "1" ]]; then
      if ! AGENTS_JSON="$("$OPENCLAW_BIN" agents list --json 2>/dev/null)"; then
        AGENTS_JSON=""
      fi
    fi
    if ! printf '%s\n' "$AGENTS_JSON" | grep -Eq '"id"[[:space:]]*:[[:space:]]*"metre"'; then
      "$OPENCLAW_BIN" agents add metre --non-interactive --workspace "$HOME/.openclaw/workspace-metre"
      METRE_AGENT_ADDED=1
    fi
    if [[ "$METRE_AGENT_ADDED" == "1" || " $UNCHANGED_IDENTITIES " != *" metre "* ]]; then
      "$OPENCLAW_BIN" agents set-identity --agent metre --identity-file "$HOME/.openclaw/workspace-metre/IDENTITY.md" >/dev/null
    fi
    if [[ ("$PROJECT_AGENT_ADDED" == "1" || "$LEARNING_AGENT_ADDED" == "1" || "$METRE_AGENT_ADDED" == "1") && "${PINKIE_MANAGED_GATEWAY:-0}" != "1" ]]; then
      "$OPENCLAW_BIN" gateway restart >/dev/null 2>&1 || true
    fi
  fi
  touch "$MARKER"
fi

# Dedicated group agents only; never rewrite the four existing personas here.
if [[ -f "$REPO_ROOT/services/party/setup.py" ]]; then
  "$PYTHON_BIN" "$REPO_ROOT/services/party/setup.py"
fi
# A managed desktop build already contains the exact themed control UI that was
# sealed into the app at build/update time. Reapplying the bundled source over
# that same signed runtime on every launch both rolls newer hotfixes backward
# and invalidates the app's resource signature. External/manual installs still
# need the compatibility path below; the self-contained App must stay immutable.
if [[ "${PINKIE_MANAGED_GATEWAY:-0}" != "1" ]]; then
  PINKIE_SKIP_APP_BUNDLES=1 "$SCRIPT_DIR/apply-theme.sh"
fi
if [[ -f "$REPO_ROOT/services/project-scope/setup.py" ]]; then
  "$PYTHON_BIN" "$REPO_ROOT/services/project-scope/setup.py"
fi
if [[ -f "$REPO_ROOT/services/mode-architecture/setup.py" ]]; then
  "$PYTHON_BIN" "$REPO_ROOT/services/mode-architecture/setup.py"
fi
if [[ -f "$REPO_ROOT/services/first-person-renderer/setup.py" ]]; then
  "$PYTHON_BIN" "$REPO_ROOT/services/first-person-renderer/setup.py"
fi
