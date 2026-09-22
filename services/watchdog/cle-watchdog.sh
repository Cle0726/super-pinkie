#!/bin/bash
# Keep the local model relay reachable without mistaking an HTTP auth response
# for a dead process. The model/API watchdog above this layer owns request retry;
# this service only repairs a genuinely missing local listener.
#
# 2026-09-14 修复（症状：中继频繁被判死、调用连续失败，看起来"看门狗不会自动重连"）：
#   A) 健康探测原为 0.4s 连接 / 0.8s 总超时，1.5 秒内 2 次失败即判死。
#      中继刷令牌或稍繁忙时 /v1/models 就可能超过 0.8s → 被误判"已死"遭强拆。
#      现改为 1.0s / 2.5s，并要求连续 3 次失败才动手。
#   B) 原来 kill -TERM 后只 sleep 1 秒就启动新实例。实测 cle-cliproxy 优雅关闭
#      需要 4 秒起步（有在途流式请求时可长达 60 秒以上），新实例在旧进程仍占用
#      1466 时启动必然绑定失败 → 看起来"重启了但服务还是空的"。
#      现在改为：TERM → 等端口释放（快路径 2 秒）→ 未释放则继续等优雅退出（再 6 秒）
#      → 仍未释放则升级 SIGKILL → 确认端口空闲后才启动。
#   C) 冷却期被拦下时不再清零失败计数，避免白等一轮。
#   D) 中继输出从 /dev/null 改为落盘（带轮转），否则它为什么退出永远无从查起。

set -u

RELAY_HOST="${PINKIE_RELAY_HOST:-127.0.0.1}"
RELAY_PORT="${PINKIE_RELAY_PORT:-1466}"
CHECK_INTERVAL="${PINKIE_RELAY_CHECK_INTERVAL:-1}"
FAILURE_THRESHOLD="${PINKIE_RELAY_FAILURE_THRESHOLD:-3}"
RESTART_COOLDOWN="${PINKIE_RELAY_RESTART_COOLDOWN:-10}"
PROBE_CONNECT_TIMEOUT="${PINKIE_RELAY_PROBE_CONNECT_TIMEOUT:-1.0}"
PROBE_MAX_TIME="${PINKIE_RELAY_PROBE_MAX_TIME:-2.5}"
FAST_TICKS="${PINKIE_RELAY_FAST_TICKS:-8}"        # 8 × 0.25s = 2 秒：等端口释放的快路径
GRACE_TICKS="${PINKIE_RELAY_GRACE_TICKS:-12}"     # 12 × 0.5s = 6 秒：等优雅退出
KILL_TICKS="${PINKIE_RELAY_KILL_TICKS:-10}"       # 10 × 0.5s = 5 秒：SIGKILL 后等端口
RELAY_BIN="${PINKIE_RELAY_BIN:-/Applications/C.le.控制台.app/Contents/MacOS/cle-cliproxy}"
RELAY_CONFIG="${PINKIE_RELAY_CONFIG:-$HOME/.antigravity_cle/multi_model_api_service/config.json}"
RELAY_STATE="${PINKIE_RELAY_STATE:-$HOME/.antigravity_cle/multi_model_api_service/runtime_state.json}"
LOG_FILE="${PINKIE_RELAY_WATCHDOG_LOG:-/tmp/cle_watchdog.log}"
RELAY_OUT="${PINKIE_RELAY_STDOUT_LOG:-/tmp/cle_relay.log}"

failures=0
last_restart=0

log_line() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

relay_is_reachable() {
  # 401/403 still prove that the HTTP listener is alive. The old watchdog
  # required 200 and therefore killed a healthy relay every eight seconds.
  local status
  status="$(curl -sS --connect-timeout "$PROBE_CONNECT_TIMEOUT" --max-time "$PROBE_MAX_TIME" \
    -o /dev/null -w '%{http_code}' \
    "http://$RELAY_HOST:$RELAY_PORT/v1/models" 2>/dev/null || true)"
  [[ -n "$status" && "$status" != "000" ]]
}

relay_pids() {
  # Match the relay executable only; never terminate the C.le desktop console.
  pgrep -f "${RELAY_BIN}.*--config ${RELAY_CONFIG}" 2>/dev/null || true
}

port_in_use() {
  lsof -nP -iTCP:"$RELAY_PORT" -sTCP:LISTEN -t >/dev/null 2>&1
}

# 等到端口不再被监听；step 为每次轮询间隔（秒），ticks 为轮询次数。
wait_port_free() {
  local step="$1" ticks="$2" i=0
  while (( i < ticks )); do
    if ! port_in_use; then
      sleep 0.3          # 留一点时间让内核完成 socket 收尾
      return 0
    fi
    sleep "$step"
    i=$(( i + 1 ))
  done
  return 1
}

# 停掉旧中继：TERM → 等端口释放 → 超时升级 SIGKILL。返回 0 表示端口已空闲。
stop_relay() {
  local pids pid
  pids="$(relay_pids)"
  if [[ -z "$pids" ]]; then
    # 没有进程但仍有人占着端口（异常残留），先等一等
    wait_port_free 0.5 "$KILL_TICKS" && return 0
    return 1
  fi

  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    kill -TERM "$pid" 2>/dev/null || true
  done <<< "$pids"

  # 快路径：中继会先关闭监听、再慢慢收尾，端口一释放就能起新实例
  wait_port_free 0.25 "$FAST_TICKS" && return 0
  # 慢路径：还在优雅退出中，再给一点时间
  wait_port_free 0.5 "$GRACE_TICKS" && return 0

  log_line "model relay still holds port $RELAY_PORT; escalating to SIGKILL"
  while IFS= read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    kill -KILL "$pid" 2>/dev/null || true
  done <<< "$pids"

  wait_port_free 0.5 "$KILL_TICKS" && return 0
  return 1
}

start_relay() {
  if [[ -f "$RELAY_OUT" ]] && (( $(stat -f %z "$RELAY_OUT" 2>/dev/null || echo 0) > 5242880 )); then
    mv -f "$RELAY_OUT" "$RELAY_OUT.1" 2>/dev/null || true
  fi
  printf '\n=== relay start %s ===\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$RELAY_OUT"
  nohup "$RELAY_BIN" --config "$RELAY_CONFIG" --manifest "$RELAY_STATE" >> "$RELAY_OUT" 2>&1 &
}

restart_relay() {
  local now
  now="$(date +%s)"
  if (( now - last_restart < RESTART_COOLDOWN )); then
    return 1   # 冷却中：保留计数，下个循环继续尝试
  fi

  if [[ ! -x "$RELAY_BIN" || ! -f "$RELAY_CONFIG" || ! -f "$RELAY_STATE" ]]; then
    last_restart="$now"
    log_line "model relay restart skipped because its executable or configuration is missing"
    return 1
  fi

  last_restart="$now"
  log_line "model relay is unreachable after $FAILURE_THRESHOLD checks; restarting once"

  if ! stop_relay; then
    log_line "port $RELAY_PORT could not be freed; deferring start to next cycle"
    last_restart=0        # 允许下个循环立刻重试，不被冷却拖住
    return 1
  fi

  start_relay
  return 0
}

while true; do
  if relay_is_reachable; then
    failures=0
  else
    failures=$(( failures + 1 ))
    if (( failures >= FAILURE_THRESHOLD )); then
      if restart_relay; then
        failures=0
      fi
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
