#!/bin/zsh
# 把网页版 ChatGPT 下载的 ~/Downloads/pk__<slot 用 __ 分隔>.png 搬到 art/study-game/raw/<slot>.png（已有就留成 .alt-<时间>.png）。
R=/Users/Admin/release-superpinkie/art/study-game/raw
L=/Users/Admin/release-superpinkie/art/study-game/logs/mover.log
while true; do
  for f in ~/Downloads/pk__*.png(N); do
    s=${${f:t:r}#pk__}; s=${s//__//}
    mkdir -p "$R/${s:h}"
    if [[ -f "$R/$s.png" ]]; then mv "$f" "$R/$s.alt-$(date +%s).png"; else mv "$f" "$R/$s.png"; fi
    echo "$(date -u +%FT%TZ) $s" >> $L
  done
  sleep 5
done
