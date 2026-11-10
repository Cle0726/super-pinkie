#!/bin/bash
# Plan B: day / night / narrow (480 px) screenshots of every run-status state in
# the App's WebKit, against the fake gateway (never the real App or 18789).
#   python3 scripts/chat-ui-harness/server.py --port 18845 &   (or the launch config)
#   scripts/chat-ui-harness/run-status-shots.sh <outDir> [port]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: run-status-shots.sh <outDir> [port]}"
PORT="${2:-18845}"
WK="${TMPDIR:-/tmp}/wk-runstatus"
[ -x "$WK" ] || swiftc -O "$HERE/wk-host.swift" -o "$WK"
DRIVER="$(cat "$HERE/run-status-shots.js")"
URL="http://127.0.0.1:$PORT/chat?session=agent%3Aunrestricted%3Adashboard%3Aharness0001&laolao-switch=1"
STEP=3500; COUNT=11
mkdir -p "$OUT"
shoot() { # mode env...
  local mode="$1"; shift
  local frames="$OUT/.frames-$mode"; rm -rf "${frames:?}"
  local begin=15000 report=$((26000 + COUNT * STEP + 100000))  # settle wait is up to 60 s
  local log
  # The page reloads itself once or twice while starting: (re)inject until the replay is running.
  local kick="if (!window.__runStatusAuto) { $DRIVER } if (!window.__shotTimes && !window.__shotStarted) { window.__shotStarted = 1; void window.__runStatusAuto($STEP); } 1"
  log="$(env "$@" "$WK" "$URL" "$frames" $(( report / 1000 + 1 )) 2 "12000=$kick" "$begin=$kick" "20000=$kick" "26000=$kick" \
    "$report=JSON.stringify({now: Date.now(), times: window.__shotTimes || []})" 2>/dev/null)"
  printf '%s\n' "$log" > "$frames.log"
  python3 - "$frames" "$OUT" "$mode" "$report" "$frames.log" <<'PY'
import json, os, re, shutil, sys
frames, out, mode, report = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
line = next((l for l in open(sys.argv[5], encoding='utf-8') if l.startswith(f'js@{report} -> ')), None)
if not line: sys.exit(f'{mode}: no report from the page (host stalled); re-run')
data = json.loads(line.split(' -> ', 1)[1])
if len(data['times']) < 12: sys.exit(f'{mode}: replay incomplete ({len(data["times"])} marks); re-run')
names = ['thinking', 'steps', 'background', 'second-version', 'reviewer', 'make-up', 'asking',
         'slower-than-usual', 'done', 'stopped', 'reconnecting']
settle = {'reconnecting': 2600, 'done': 1000, 'stopped': 1500, 'slower-than-usual': 3200}
shots = sorted((int(re.search(r'_(\d+)\.png$', f).group(1)), f) for f in os.listdir(frames) if f.endswith('.png'))
for i, name in enumerate(names):
    want = report - (data['now'] - data['times'][i]) + settle.get(name, 2300)
    ms, f = min(shots, key=lambda s: abs(s[0] - want))
    shutil.copy(os.path.join(frames, f), os.path.join(out, f'{name}-{mode}.png'))
    print(f'{mode} {name}: frame at {ms} ms (wanted {want})')
shutil.rmtree(frames); os.remove(sys.argv[5])
PY
}
# The page's start-up time varies, so a pass can come back incomplete: retry it up to three times.
retry() { local n; for n in 1 2 3; do shoot "$@" && return 0; echo "$1: attempt $n incomplete" >&2; done; return 1; }
retry day WK_LIGHT=1 WK_W=1280 WK_H=820 WK_SNAPW=1280
retry night WK_DARK=1 WK_W=1280 WK_H=820 WK_SNAPW=1280
retry narrow WK_LIGHT=1 WK_W=480 WK_H=820 WK_SNAPW=480
# Session list marks (day / night).
for mode in day night; do
  frames="$OUT/.frames-list-$mode"; rm -rf "$frames"
  if [ "$mode" = day ]; then flag=WK_LIGHT=1; else flag=WK_DARK=1; fi
  env $flag WK_W=1280 WK_H=820 WK_SNAPW=1280 "$WK" "$URL" "$frames" 27 1 "20000=if (!window.__runStatusListShot) { $DRIVER } void window.__runStatusListShot(); 1" >/dev/null
  last="$(ls "$frames" | sort | tail -1)"; cp "$frames/$last" "$OUT/session-list-$mode.png"; rm -rf "$frames"
done
echo "shots in $OUT"
