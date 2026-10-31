#!/usr/bin/env bash

# C.le.'s historical source directory is kept for its existing tests and
# browser test host. Pinkie has a separate, installed-App-derived source tree.
native_sources_for_brand() {
  local macos_dir="$1"
  local cle_brand="${2:-0}"
  if [[ "$cle_brand" == 1 ]]; then
    printf '%s\n' "$macos_dir/Sources"
  else
    printf '%s\n' "$macos_dir/pinkie/Sources"
  fi
}
