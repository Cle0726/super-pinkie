#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSET_DIR="$ROOT_DIR/ui/assets"
SOURCE_DIR="$ASSET_DIR/deep-think/source-video"

render_tier() {
  local name="$1"
  local source="$SOURCE_DIR/tier-${2}-${name}.mp4"

  if [[ ! -f "$source" ]]; then
    echo "error: missing generated tier video: $source" >&2
    exit 1
  fi

  ffmpeg -hide_banner -loglevel error -y \
    -i "$source" -an \
    -vf "scale=384:384:flags=lanczos,format=yuv420p" \
    -c:v libvpx-vp9 -row-mt 1 -crf 28 -b:v 0 \
    "$ASSET_DIR/laolao-deep-think-${name}.webm"

  ffmpeg -hide_banner -loglevel error -y \
    -ss 0.08 -i "$source" -frames:v 1 \
    -vf "scale=384:384:flags=lanczos" \
    "$ASSET_DIR/laolao-deep-think-${name}.png"
}

render_tier base 1
render_tier boost 2
render_tier full 3
render_tier marathon 4
