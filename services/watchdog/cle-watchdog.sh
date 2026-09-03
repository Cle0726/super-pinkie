#!/bin/bash
# Keep the local model relay reachable without mistaking an HTTP auth response
# for a dead process. The model/API watchdog above this layer owns request retry;
# this service only repairs a genuinely missing local listener.

set -u

RELAY_HOST="${PINKIE_RELAY_HOST:-127.0.0.1}"
RELAY_PORT="${PINKIE_RELAY_PORT:-1466}"
CHECK_INTERVAL="${PINKIE_RELAY_CHECK_INTERVAL:-2}"
FAILURE_THRESHOLD="${PINKIE_RELAY_FAILURE_THRESHOLD:-2}"
RESTART_COOLDOWN="${PINKIE_RELAY_RESTART_COOLDOWN:-20}"
RELAY_BIN="${PINKIE_RELAY_BIN:-/Applications/C.le.控制台.app/Contents/MacOS/cle-cliproxy}"
RELAY_CONFIG="${PINKIE_RELAY_CONFIG:-$HOME/.antigravity_cle/multi_model_api_service/config.json}"
RELAY_STATE="${PINKIE_RELAY_STATE:-$HOME/.antigravity_cle/multi_model_api_service/runtime_state.json}"
LOG_FILE="${PINKIE_RELAY_WATCHDOG_LOG:-/tmp/cle_watchdog.log}"

failures=0
last_restart=0

log_line() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

relay_is_reachable() {
  # 401/403 still prove that the HTTP listener is alive. The old watchdog
  # required 200 and therefore killed a healthy relay every eight seconds.
  local status
  status="$(curl -sS --connect-timeout 1 --max-time 2 -o /dev/null -w '%{http_code}' \
    "http://$RELAY_HOST:$RELAY_PORT/v1/models" 2>/dev/null || true)"
  [[ -n "$status" && "$status" != "000" ]]
}

restart_relay() {
  local now pid
  now="$(date +%s)"
  if (( now - last_restart < RESTART_COOLDOWN )); then
    return
  fi
  last_restart="$now"
  log_line "model relay is unreachable after $FAILURE_THRESHOLD checks; restarting once"

  # Match the relay executable only; never terminate the C.le desktop console.
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    kill -TERM "$pid" 2>/dev/null || true
  done < <(pgrep -f "${RELAY_BIN}.*--config ${RELAY_CONFIG}" 2>/dev/null || true)
  sleep 1

  if [[ ! -x "$RELAY_BIN" || ! -f "$RELAY_CONFIG" || ! -f "$RELAY_STATE" ]]; then
    log_line "model relay restart skipped because its executable or configuration is missing"
    return
  fi
  nohup "$RELAY_BIN" --config "$RELAY_CONFIG" --manifest "$RELAY_STATE" >/dev/null 2>&1 &
}

while true; do
  if relay_is_reachable; then
    failures=0
  else
    failures=$((failures + 1))
    if (( failures >= FAILURE_THRESHOLD )); then
      restart_relay
      failures=0
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
