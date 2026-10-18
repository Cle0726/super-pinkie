#!/bin/bash
# Trace every Codex line drawing (assets-src/v5/{d,e}/line-*.png) into the plugin's art/line/<name>.json
R="$HOME/release-superpinkie"; OUT="$R/repo/services/cle-studio/static/art/line"; mkdir -p "$OUT"
for f in "$R"/assets-src/v5/d/line-*.png "$R"/assets-src/v5/e/line-*.png; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .png); name=${name#line-}
  "$R/tools/.venv/bin/python" "$R/tools/lineart.py" "$f" "$OUT/$name.json" --image "$OUT/$name.webp" --svg "$R/logs/line/$name.svg" | sed "s#^.*/##"
done
