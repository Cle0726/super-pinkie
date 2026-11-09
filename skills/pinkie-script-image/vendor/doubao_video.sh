#!/bin/bash
# 图生视频总入口（豆包「视频生成」模式，doubao_gen.mjs；用户授权：随便用，不用问）
# 用户 2026-10-12：只用 Seedance 2.0 / 2.5；先用免费额度，再用会员（付费）额度，都用完才切号；绝不充值/购买。
# 豆包里登录了多个账号：当前号额度用完（退出码 3）→ doubao_ui.mjs switch 记下并切到今天还没用完的下一个号重试；全都用完 → 退出码 3。
# 用法: bash 工具/doubao_video.sh <首帧图> "<动作描述>" [--model 2.0|2.5] [--ratio 9:16] [--dur 5]     成功时最后一行打印对话 id
# Windows：豆包桌面版（F:\Doubao\app\Doubao.exe，Chromium 内核）加 --remote-debugging-port=9225 启动就能被脚本操作。
cd "$(dirname "$0")/.." || exit 1
DOUBAO="${DOUBAO_EXE:-/f/Doubao/app/Doubao.exe}"
cdp() { curl -s --noproxy '*' --max-time 3 http://127.0.0.1:9225/json >/dev/null; }
if ! cdp; then
  if tasklist //FI "IMAGENAME eq Doubao.exe" 2>/dev/null | grep -qi doubao.exe; then
    echo "豆包已经开着但没带调试端口：先完全退出豆包（托盘里也退出），再重跑这条命令" >&2; exit 4
  fi
  "$DOUBAO" --remote-debugging-port=9225 >/dev/null 2>&1 & disown
  for i in $(seq 1 30); do cdp && break; sleep 1; done
  cdp || { echo "豆包调试端口 9225 没起来" >&2; exit 4; }
  sleep 3
fi
for try in $(seq 1 12); do
  node 工具/doubao_gen.mjs "$@"; rc=$?
  # 用户 2026-10-13：问额度时不点确认，同一个号新开对话再发一遍（还是用这个号的额度，不会换 Mini）；同号最多新开 2 次，还问才换号
  if [ $rc -eq 10 ]; then
    for again in 1 2; do
      echo "问额度：同一个号新开对话重提（第 $again 次）" >&2
      node 工具/doubao_gen.mjs "$@"; rc=$?
      [ $rc -ne 10 ] && break
    done
    [ $rc -eq 10 ] && rc=3
  fi
  [ $rc -ne 3 ] && exit $rc
  echo "账号 $(node 工具/doubao_ui.mjs whoami) 今天额度用完，切下一个号" >&2
  node 工具/doubao_ui.mjs switch >&2 || break
done
echo "所有豆包账号今天的免费和会员额度都用完了 → 这个镜头改用代码做（深度视差/眨眼/遮罩波动等，见 文档/技术地图.md）" >&2
exit 3
