#!/usr/bin/env bash
# There is one product shell. The former alternate cat shell is retired.
native_sources_for_brand() {
  local macos_dir="$1"
  if [[ "${2:-0}" != 0 ]]; then
    echo "error: only the 超級碧琪 native shell is supported" >&2
    return 1
  fi
  printf '%s\n' "$macos_dir/pinkie/Sources"
}
