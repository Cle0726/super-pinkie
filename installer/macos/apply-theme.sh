#!/bin/bash
# Reapply the exact 来啦～老弟 skin after an OpenClaw or 超級碧琪 update.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
USER_HOME="${HOME:?HOME is not set}"
ASSET_ROOT="$REPO_ROOT/ui/assets"
INJECTION_ROOT="$REPO_ROOT/ui/injections"
LAUNCHER_SOURCE="$REPO_ROOT/desktop/macos/Sources/Launcher.swift"
NODE_VERSIONS_ROOT="$USER_HOME/.nvm/versions/node"
LAUNCHER_APP_PATH="${PINKIE_APP_PATH:-/Applications/超級碧琪.app}"
SKIP_APP_BUNDLES="${PINKIE_SKIP_APP_BUNDLES:-0}"
BUNDLE_BUILD_ONLY="${PINKIE_BUNDLE_BUILD_ONLY:-0}"
PYTHON_BIN="${PINKIE_PYTHON_BIN:-/usr/bin/python3}"

copy_if_changed() {
  local source_file="$1"
  local target_file="$2"
  if [[ ! -f "$target_file" ]] || ! cmp -s "$source_file" "$target_file"; then
    cp "$source_file" "$target_file"
    DID_CHANGE=1
  fi
}

# 更新器可能遇到“/asset”与“./asset”两种等价路径。先统一路径并按资源名
# 去重，避免重复运行主题安装后把同一份脚本执行两次。
dedupe_laolao_asset_tags() {
  local index_file="$1"
  local temp_index
  temp_index="$(mktemp "$(dirname "$index_file")/.laolao-dedupe.XXXXXX")"
  perl -0pe '
    BEGIN { %seen = (); }
    s{(<script\b[^>]*\bsrc="(?:\./|/)?(laolao-[^"?]+)[^"]*"[^>]*>\s*</script>|<link\b[^>]*\bhref="(?:\./|/)?(laolao-[^"?]+)[^"]*"[^>]*>)}{
      my $asset = defined($2) ? $2 : $3;
      $seen{$asset}++ ? "" : $1;
    }gise;
    s{((?:src|href)=")/(laolao-)}{$1 . "./" . $2}ge;
  ' "$index_file" > "$temp_index"
  if cmp -s "$index_file" "$temp_index"; then
    rm -f "$temp_index"
  else
    mv "$temp_index" "$index_file"
    DID_CHANGE=1
  fi
}

apply_ui_skin() {
  local ui_root="$1"
  local index_file="$ui_root/index.html"
  local asset

  [[ -f "$index_file" ]] || return 0

  dedupe_laolao_asset_tags "$index_file"

  # Work on one canonical relative form while patching. The final form is
  # root-relative, so nested SPA routes such as /settings/general never look
  # for the skin under /settings/ and briefly fall back to stock dark UI.
  perl -0pi -e 's{"/laolao-}{"./laolao-}g' "$index_file"
  # Force a fresh stylesheet URL when the visual skin changes. WebKit can keep
  # the previous query-keyed CSS in memory across a gateway reload, which made
  # a small bubble-only adjustment look like it had not been deployed.
  perl -0pi -e 's{(laolao-theme\.css\?v=)theme[0-9]+}{${1}theme46}g' "$index_file"

  for asset in \
    laolao-avatar.png \
    laolao-mode-chat.png \
    laolao-mode-project.png \
    laolao-mode-thinking.png \
    laolao-mode-learning.png \
    laolao-mode-unrestricted.png \
    laolao-mode-chat-hd.png \
    laolao-mode-project-hd.png \
    laolao-mode-thinking-hd.png \
    laolao-mode-learning-hd.png \
    laolao-mode-unrestricted-hd.png \
    laolao-mode-transition-chat.png \
    laolao-mode-transition-project.png \
    laolao-mode-transition-thinking.png \
    laolao-mode-transition-learning.png \
    laolao-mode-transition-unrestricted.png \
    laolao-mode-chat.svg \
    laolao-mode-project.svg \
    laolao-mode-thinking.svg \
    laolao-mode-learning.svg \
    laolao-mode-unrestricted.svg \
    laolao-wallpaper.png \
    laolao-wallpaper-project.png \
    laolao-wallpaper-thinking.png \
    laolao-wallpaper-learning.png \
    laolao-wallpaper-unrestricted.png \
    laolao-splash.png \
    laolao-theme.css \
    laolao-classic-shell.css \
    laolao-ui-subtraction.css \
    laolao-material-preview.css \
    laolao-workspace-focus.css \
    laolao-classic-shell.js \
    laolao-side-layout.css \
    laolao-side-layout.js \
    laolao-memory.css \
    laolao-memory.js \
    laolao-learning-stage.css \
    laolao-learning-stage.js \
    laolao-learning-question.png \
    laolao-motion.js \
    laolao-sidebar.css \
    laolao-sidebar.js \
    laolao-usage-stats.css \
    laolao-usage-stats.js \
    laolao-quota.json \
    laolao-splash.css \
    laolao-splash.js \
    laolao-handoff-bootstrap.js \
    laolao-phrases.js \
    laolao-progress.js \
    laolao-session-list.js \
    laolao-live-voice.js \
    laolao-mode-switcher.js \
    laolao-image-viewer.js \
    laolao-material-preview.js \
    laolao-workspace-focus.js \
    laolao-page-warmup.js \
    laolao-stream-fx.js \
    laolao-link-viewer.js \
    laolao-tool-stream.js \
    laolao-tool-stream.css \
    laolao-party-entry.js \
    laolao-party-avatar-v1.png \
    laolao-deep-think-base.png \
    laolao-deep-think-boost.png \
    laolao-deep-think-full.png \
    laolao-deep-think-marathon.png \
    laolao-deep-think-base.webm \
    laolao-deep-think-boost.webm \
    laolao-deep-think-full.webm \
    laolao-deep-think-marathon.webm \
    laolao-roundtable-entry.js \
    laolao-deep-think.js \
    laolao-web-gpt-collab.js \
    laolao-context-compact.js \
    laolao-resume.js \
    laolao-roundtable-entry-v2.png \
    laolao-roundtable-entry-v2-clean.png \
    favicon.svg \
    favicon-32.png \
    favicon.ico; do
    if [[ -f "$INJECTION_ROOT/$asset" ]]; then
      copy_if_changed "$INJECTION_ROOT/$asset" "$ui_root/$asset"
    else
      copy_if_changed "$ASSET_ROOT/$asset" "$ui_root/$asset"
    fi
  done

  copy_if_changed "$ASSET_ROOT/laolao-avatar.png" "$ui_root/apple-touch-icon.png"
  copy_if_changed "$ASSET_ROOT/manifest.webmanifest" "$ui_root/manifest.webmanifest"

  # 雪崩 lint（2026-09-01 冻结根因：12 个 subtree 观察者 × 全量 mutation
  # record 拷贝 → GC 打满主线程）。部署前静态扫描，防止新补丁把问题写回来：
  #  1) 禁止在 document.body/documentElement 上观察 characterData
  #     （phrases.js 是唯一豁免：措辞中文化刚需，且已 600ms 防抖）；
  #  2) 凡使用 MutationObserver 的文件，必须带节流/断开机制
  #     （requestAnimationFrame / setTimeout / disconnect 任一）。
  local lint_failed=0 js_file
  for js_file in "$ui_root"/laolao-*.js; do
    [[ -f "$js_file" ]] || continue
    if grep -qE 'characterData\s*:\s*true' "$js_file" \
       && grep -qE 'observe\(document\.(body|documentElement)' "$js_file" \
       && [[ "$(basename "$js_file")" != "laolao-phrases.js" ]]; then
      echo "【雪崩lint】禁止: $(basename "$js_file") 在 document 根上观察 characterData（文本节点变异是 mutation record 雪崩大头）" >&2
      lint_failed=1
    fi
    if grep -q 'MutationObserver' "$js_file" \
       && ! grep -qE 'requestAnimationFrame|setTimeout|setInterval|disconnect' "$js_file"; then
      echo "【雪崩lint】警告: $(basename "$js_file") 的 MutationObserver 缺少节流或断开机制" >&2
      lint_failed=1
    fi
  done
  if [[ "$lint_failed" -eq 1 ]]; then
    echo "【雪崩lint】存在高风险观察者模式，已继续部署，但请修正后再发版。" >&2
  fi

  if ! grep -Fq './laolao-theme.css' "$index_file"; then
    local temp_index
    temp_index="$(mktemp "$ui_root/.laolao-head.XXXXXX")"
    awk -v fragment="$INJECTION_ROOT/laolao-head.fragment.html" '
      /<\/head>/ {
        while ((getline line < fragment) > 0) print line
        close(fragment)
      }
      { print }
    ' "$index_file" > "$temp_index"
    mv "$temp_index" "$index_file"
    DID_CHANGE=1
  fi

  # New presentation scripts may be added after the original skin is already
  # installed, so inject them independently of the first CSS injection.
  if ! grep -Fq './laolao-sidebar.js' "$index_file"; then
    perl -0pi -e 's{(<script type="module")}{    <script src="./laolao-sidebar.js?v=sidebar26"></script>\n    $1}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-ui-subtraction.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-ui-subtraction.css?v=subtraction11">\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-ui-subtraction.css?v=subtraction11' "$index_file"; then
    perl -0pi -e 's{\./laolao-ui-subtraction\.css\?v=[^"]*}{./laolao-ui-subtraction.css?v=subtraction11}g' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-sidebar.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-sidebar.css?v=sidebar17">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-classic-shell.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-classic-shell.css?v=classic17">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-side-layout.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-side-layout.css?v=side20">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-memory.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-memory.css?v=memory1">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-learning-stage.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-learning-stage.css?v=learning3">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-material-preview.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-material-preview.css?v=material2">\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-material-preview.css?v=material2' "$index_file"; then
    perl -0pi -e 's{\./laolao-material-preview\.css(?:\?v=[^"]*)?}{./laolao-material-preview.css?v=material2}g' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-workspace-focus.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-workspace-focus.css?v=workspacefocus2">\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-workspace-focus.css?v=workspacefocus2' "$index_file"; then
    perl -0pi -e 's{\./laolao-workspace-focus\.css(?:\?v=[^"]*)?}{./laolao-workspace-focus.css?v=workspacefocus2}g' "$index_file"
    DID_CHANGE=1
  fi

  # 顶栏用量统计胶囊：JS 必须紧跟 sidebar.js（依赖其 __laolaoSidebar.gwRequest 句柄）
  if ! grep -Fq './laolao-usage-stats.js' "$index_file"; then
    perl -0pi -e 's{(<script src="\./laolao-sidebar\.js[^"]*"></script>)}{$1\n    <script src="./laolao-usage-stats.js?v=stats16"></script>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-usage-stats.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-usage-stats.css?v=stats8">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-phrases.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-phrases.js?v=phrases21"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-progress.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-progress.js?v=progress4"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-session-list.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script src="./laolao-session-list.js?v=sessions10"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-phrases.js?v=phrases21' "$index_file"; then
    perl -0pi -e 's{\./laolao-phrases\.js(?:\?v=[^"]*)?}{./laolao-phrases.js?v=phrases21}g' "$index_file"
  fi
  if ! grep -Fq './laolao-progress.js?v=progress4' "$index_file"; then
    perl -0pi -e 's{\./laolao-progress\.js(?:\?v=[^"]*)?}{./laolao-progress.js?v=progress4}g' "$index_file"
    DID_CHANGE=1
  fi

  # live-voice v2: 去掉 characterData 观察（文本节点变异是 mutation record
  # 雪崩的大头）；childList 在流式重建整块 DOM 时仍会触发，功能不受影响。
  if ! grep -Fq './laolao-live-voice.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-live-voice.js?v=voice4"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-live-voice.js?v=voice4' "$index_file"; then
    perl -0pi -e 's{\./laolao-live-voice\.js(?:\?v=[^"]*)?}{./laolao-live-voice.js?v=voice4}g' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-mode-switcher.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-mode-switcher.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-classic-shell.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-classic-shell.js?v=classic15"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-side-layout.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script src="./laolao-side-layout.js?v=side12"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-memory.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-memory.js?v=memory2"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-learning-stage.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-learning-stage.js?v=learning3"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-image-viewer.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-image-viewer.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-material-preview.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-material-preview.js?v=material2"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-material-preview.js?v=material2' "$index_file"; then
    perl -0pi -e 's{\./laolao-material-preview\.js(?:\?v=[^"]*)?}{./laolao-material-preview.js?v=material2}g' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-workspace-focus.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-workspace-focus.js?v=workspacefocus2"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-workspace-focus.js?v=workspacefocus2' "$index_file"; then
    perl -0pi -e 's{\./laolao-workspace-focus\.js(?:\?v=[^"]*)?}{./laolao-workspace-focus.js?v=workspacefocus2}g' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-page-warmup.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-page-warmup.js?v=warmup1"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-page-warmup.js?v=warmup1' "$index_file"; then
    perl -0pi -e 's{\./laolao-page-warmup\.js(?:\?v=[^"]*)?}{./laolao-page-warmup.js?v=warmup1}g' "$index_file"
    DID_CHANGE=1
  fi

  # Stream-fx（v2：去掉 chunk 淡入，只留光标柔和呼吸）— 必须在
  # image-viewer 之后、party-entry 之前加载；它只对 .chat-bubble.streaming
  # 生效，与其它脚本互不干扰。
  if ! grep -Fq './laolao-stream-fx.js?v=stream4' "$index_file"; then
    perl -0pi -e 's{\./laolao-stream-fx\.js(?:\?v=[^"]*)?}{./laolao-stream-fx.js?v=stream4}g' "$index_file"
    DID_CHANGE=1
  fi

  # Browser workspace：所有模式都能从右侧轨道打开原生 WKWebView，
  # 聊天里的网页链接也统一送进去；普通浏览器环境保留 iframe 回退。
  if ! grep -Fq './laolao-link-viewer.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-link-viewer.js?v=link4"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-link-viewer.js?v=link4' "$index_file"; then
    perl -0pi -e 's{\./laolao-link-viewer\.js(?:\?v=[^"]*)?}{./laolao-link-viewer.js?v=link4}g' "$index_file"
    DID_CHANGE=1
  fi

  # Tool-stream v3：MutationObserver 改成 1s 轮询（subtree 观察者在流式
  # 重建 DOM 时会收到每条 mutation record 的副本，叠加 12 个观察者造成
  # GC 雪崩把主线程打满）。v2 只自动展开最后一组；用户手动折叠后不再自动展开。
  if ! grep -Fq './laolao-tool-stream.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-tool-stream.js?v=toolstream4"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-tool-stream.js?v=toolstream4' "$index_file"; then
    perl -0pi -e 's{\./laolao-tool-stream\.js\?v=[^"]*}{./laolao-tool-stream.js?v=toolstream4}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-tool-stream.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-tool-stream.css?v=toolstream1">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  # party-entry v4：MutationObserver 改成 1.5s 轮询（同 tool-stream v3 的
  # mutation record 雪崩问题）。mount() 幂等，轮询足够。
  if ! grep -Fq './laolao-party-entry.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-party-entry.js?v=party4"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-party-entry.js?v=party4' "$index_file"; then
    perl -0pi -e 's{\./laolao-party-entry\.js\?v=[^"]*}{./laolao-party-entry.js?v=party4}g' "$index_file"
    DID_CHANGE=1
  fi
  # roundtable-entry v3：同 party-entry v4，轮询替代 subtree 观察者。
  if ! grep -Fq './laolao-roundtable-entry.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-roundtable-entry.js?v=roundtable3"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-roundtable-entry.js?v=roundtable3' "$index_file"; then
    perl -0pi -e 's{\./laolao-roundtable-entry\.js\?v=[^"]*}{./laolao-roundtable-entry.js?v=roundtable3}g' "$index_file"
    DID_CHANGE=1
  fi

  # 前后台断线恢复: 监听原生前后台事件 + visibilitychange, 回前台时只同步最新五条
  # v2 修复 TDZ ReferenceError (wasBusy 引用越作用域, 导致恢复流程从未执行)
  # v3 观察者在 hook 网关成功后 disconnect（雪崩治理，见 tool-stream v3）
  # v4 假「生成中」自检：recoverCurrentChat 开头 `if (isBusy()) return false`
  #    使得原生恢复路径治不了假 busy（锁住 UI 的就是它要清的那个标记）。新增
  #    reconcileStaleBusy()：界面连续 busy 且后端 sessions.list 确认
  #    hasActiveRun=false 时强制复位，仍无效则保草稿后重载。
  #    关闭开关：localStorage['laolao:stale-busy-reconcile'] = 'off'
  if ! grep -Fq './laolao-resume.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-resume.js?v=resume22"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-resume.js?v=resume22' "$index_file"; then
    perl -0pi -e 's{\./laolao-resume\.js\?v=[^"]*}{./laolao-resume.js?v=resume22}g' "$index_file"
    DID_CHANGE=1
  fi

  # 会话完整记录留在网关/SQLite，WebKit 的 live DOM 永远只放最近五条
  # 可见聊天消息。这里用有界倒扫而非 `filter` 整段历史，避免一次渲染就
  # 临时分配数百条对象。工具桥接状态保持原生折叠，不能在这里硬裁掉。
  local chat_bundle
  for chat_bundle in "$ui_root"/assets/chat-page-*.js; do
    [[ -f "$chat_bundle" ]] || continue
    [[ "$(grep -o 'Showing last ${c} messages' "$chat_bundle" 2>/dev/null | wc -l | tr -d ' ')" == "1" ]] || continue
    perl -0pi -e '
      s{function Zb\(e\)\{return typeof e!=`number`\|\|!Number\.isFinite\(e\)\?(?:100|5000):Math\.max\(1,Math\.min\((?:100|5000),Math\.floor\(e\)\)\)\}}{function Zb(e){return 5}}g;
      s{function Zb\(e\)\{return 5000\}}{function Zb(e){return 5}}g;
      s{r=\(Array\.isArray\(e\.messages\)\?e\.messages:\[\]\)\.filter\(e=>!Li\(e\)\);r=r\.slice\(-(?:n|5|100|5000)\),}{r=(()=>{let t=[],n=Array.isArray(e.messages)?e.messages:[];for(let e=n.length-1;e>=0&&t.length<5;e--){let r=n[e];Li(r)||t.unshift(r)}return t})(),}g;
      s{i\+c>16e6\)break}{i+c>24e4)break}g;
    ' "$chat_bundle"
  done

  # Also revision the entry and lazy chat import URLs. This is the hard
  # guarantee for WebKit instances still controlled by the old cache-first
  # worker: a previously cached URL can no longer match the repaired chunks.
  perl -0pi -e 's{(src="\./assets/index-[^"?]+\.js)(?:\?v=[^"]*)?"}{${1}?v=clekk-history18"}g' "$index_file"
  local entry_bundle
  for entry_bundle in "$ui_root"/assets/index-*.js; do
    [[ -f "$entry_bundle" ]] || continue
  perl -0pi -e 's{(\./chat-page-[A-Za-z0-9_-]+\.js)(?:\?v=[^`"'"'"']*)?}{${1}?v=clekk-history18}g' "$entry_bundle"
  done

  # Patched native chunks keep their upstream hashed filename. Cache-first
  # would therefore keep serving the pre-patch renderer. Give the local UI
  # network priority and version its disposable cache; offline fallback stays.
  local service_worker="$ui_root/sw.js"
  if [[ -f "$service_worker" ]]; then
    perl -0pi -e '
      s{-clekk-history-render-[0-9]+}{}g;
      s{(const EMBEDDED_CACHE_VERSION = "[^"]*)(";)}{${1}-clekk-history-render-18${2}};
    ' "$service_worker"
    perl -0pi -e '
      s{// Cache-first for hashed assets; network-first for HTML/other\.}{// Network-first for all UI files; cached copies remain an offline fallback.}g;
      s{caches\.match\(event\.request\)\.then\(\n        \(cached\) =>\n          cached \|\|\n          fetch\(event\.request\)\.then\(\(response\) => \{\n            if \(response\.ok\) \{\n              const clone = response\.clone\(\);\n              void caches\.open\(CACHE_NAME\)\.then\(\(cache\) => cache\.put\(event\.request, clone\)\);\n            \}\n            return response;\n          \}\),\n      \)}{fetch(event.request)\n        .then((response) => {\n          if (response.ok) {\n            const clone = response.clone();\n            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));\n          }\n          return response;\n        })\n        .catch(() => caches.match(event.request))}g;
    ' "$service_worker"
  fi

  # 极致思考四档按钮 (全模式可用; 破甲与否由注入层按 session 门控)
  if ! grep -Fq './laolao-deep-think.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-deep-think.js?v=deepthink17"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-deep-think.js?v=deepthink17' "$index_file"; then
    perl -0pi -e 's{\./laolao-deep-think\.js\?v=[^"]*}{./laolao-deep-think.js?v=deepthink17}g' "$index_file"
    DID_CHANGE=1
  fi

  # 网页 GPT 协作开关（默认关闭、按会话保存、所有模式可用）。
  if ! grep -Fq './laolao-web-gpt-collab.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-web-gpt-collab.js?v=webgpt15"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-web-gpt-collab.js?v=webgpt15' "$index_file"; then
    perl -0pi -e 's{\./laolao-web-gpt-collab\.js\?v=[^"]*}{./laolao-web-gpt-collab.js?v=webgpt15}g' "$index_file"
    DID_CHANGE=1
  fi

  # 全模式手动上下文整理；直接调用原生 sessions.compact，不往聊天里塞命令。
  if ! grep -Fq './laolao-context-compact.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-context-compact.js?v=contextcompact3"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-context-compact.js?v=contextcompact3' "$index_file"; then
    perl -0pi -e 's{\./laolao-context-compact\.js\?v=[^"]*}{./laolao-context-compact.js?v=contextcompact3}g' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-splash.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-splash.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq 'id="laolao-splash"' "$index_file"; then
    local temp_index
    temp_index="$(mktemp "$ui_root/.laolao-body.XXXXXX")"
    awk -v fragment="$INJECTION_ROOT/laolao-body.fragment.html" '
      /<body[^>]*>/ {
        print
        while ((getline line < fragment) > 0) print line
        close(fragment)
        next
      }
      { print }
    ' "$index_file" > "$temp_index"
    mv "$temp_index" "$index_file"
    DID_CHANGE=1
  fi

  # v2.4.0 briefly inserted the native launcher movie into the web entrance.
  # Keep the two stages separate: native startup is pure video, then the
  # original "来啦～老弟" web entrance takes over.
  if grep -Fq 'laolao-splash__video' "$index_file"; then
    perl -0pi -e 's{\s*<video class="laolao-splash__video"(?:(?!</video>)[\s\S])*?</video>}{}g' "$index_file"
    DID_CHANGE=1
  fi

  # Remove the retired inline splash controller. It competed with the current
  # mode handoff controller and could pull a carried 68% back toward 8%.
  if grep -Fq 'var minimumDuration = 2600;' "$index_file"; then
    perl -0pi -e 's{\s*<script>\s*\(function \(\) \{\s*var splash = document\.getElementById\("laolao-splash"\);(?:(?!</script>)[\s\S])*?var minimumDuration = 2600;(?:(?!</script>)[\s\S])*?\}\)\(\);\s*</script>}{}g' "$index_file"
    DID_CHANGE=1
  fi

  # This synchronous bootstrap runs immediately after the splash markup, so
  # the new document's first painted frame already shows the carried progress.
  if ! grep -Fq './laolao-handoff-bootstrap.js' "$index_file"; then
    perl -0pi -e 's{(<openclaw-app>)}{    <script src="./laolao-handoff-bootstrap.js?v=handoff5"></script>\n    $1}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-motion.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script src="./laolao-motion.js?v=motion2"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  # Custom assets keep stable filenames so upgrades can restore them. Bump the
  # query version here whenever interaction or transition behavior changes;
  # otherwise WebKit may keep an older local copy after a normal reload.
  # 处理旧版 index.html 已经被规范化为 /laolao-* 的情况。
  if ! grep -Fq '/laolao-theme.css?v=theme46' "$index_file"; then
    perl -0pi -e 's{(?:\./|/)laolao-theme\.css(?:\?v=[^"]*)?}{/laolao-theme.css?v=theme46}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq '/laolao-sidebar.js?v=sidebar26' "$index_file"; then
    perl -0pi -e 's{(?:\./|/)laolao-sidebar\.js(?:\?v=[^"]*)?}{/laolao-sidebar.js?v=sidebar26}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-sidebar.css?v=sidebar17' "$index_file"; then
    perl -0pi -e 's{\./laolao-sidebar\.css(?:\?v=[^"]*)?}{./laolao-sidebar.css?v=sidebar17}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq '/laolao-session-list.js?v=sessions10' "$index_file"; then
    perl -0pi -e 's{(?:\./|/)laolao-session-list\.js(?:\?v=[^"]*)?}{/laolao-session-list.js?v=sessions10}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-usage-stats.js?v=stats16' "$index_file"; then
    perl -0pi -e 's{\./laolao-usage-stats\.js(?:\?v=[^"]*)?}{./laolao-usage-stats.js?v=stats16}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-usage-stats.css?v=stats8' "$index_file"; then
    perl -0pi -e 's{\./laolao-usage-stats\.css(?:\?v=[^"]*)?}{./laolao-usage-stats.css?v=stats8}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-splash.css?v=splash18' "$index_file"; then
    perl -0pi -e 's{\./laolao-splash\.css(?:\?v=[^"]*)?}{./laolao-splash.css?v=splash18}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-mode-switcher.js?v=mode36' "$index_file"; then
    perl -0pi -e 's{\./laolao-mode-switcher\.js(?:\?v=[^"]*)?}{./laolao-mode-switcher.js?v=mode36}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-splash.js?v=splash26' "$index_file"; then
    perl -0pi -e 's{\./laolao-splash\.js(?:\?v=[^"]*)?}{./laolao-splash.js?v=splash26}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-handoff-bootstrap.js?v=handoff5' "$index_file"; then
    perl -0pi -e 's{\./laolao-handoff-bootstrap\.js(?:\?v=[^"]*)?}{./laolao-handoff-bootstrap.js?v=handoff5}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-motion.js?v=motion5' "$index_file"; then
    perl -0pi -e 's{\./laolao-motion\.js(?:\?v=[^"]*)?}{./laolao-motion.js?v=motion5}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-classic-shell.css?v=classic17' "$index_file"; then
    perl -0pi -e 's{\./laolao-classic-shell\.css(?:\?v=[^"]*)?}{./laolao-classic-shell.css?v=classic17}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-side-layout.css?v=side20' "$index_file"; then
    perl -0pi -e 's{\./laolao-side-layout\.css(?:\?v=[^"]*)?}{./laolao-side-layout.css?v=side20}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-classic-shell.js?v=classic15' "$index_file"; then
    perl -0pi -e 's{\./laolao-classic-shell\.js(?:\?v=[^"]*)?}{./laolao-classic-shell.js?v=classic15}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-side-layout.js?v=side12' "$index_file"; then
    perl -0pi -e 's{\./laolao-side-layout\.js(?:\?v=[^"]*)?}{./laolao-side-layout.js?v=side12}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-memory.css?v=memory1' "$index_file"; then
    perl -0pi -e 's{\./laolao-memory\.css(?:\?v=[^"]*)?}{./laolao-memory.css?v=memory1}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-memory.js?v=memory2' "$index_file"; then
    perl -0pi -e 's{\./laolao-memory\.js(?:\?v=[^"]*)?}{./laolao-memory.js?v=memory2}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-learning-stage.css?v=learning3' "$index_file"; then
    perl -0pi -e 's{\./laolao-learning-stage\.css(?:\?v=[^"]*)?}{./laolao-learning-stage.css?v=learning3}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-learning-stage.js?v=learning3' "$index_file"; then
    perl -0pi -e 's{\./laolao-learning-stage\.js(?:\?v=[^"]*)?}{./laolao-learning-stage.js?v=learning3}g' "$index_file"
    DID_CHANGE=1
  fi

  # Keep exactly one startup controller. A previous release put the script in
  # both the head and body; on upgrade that produced duplicate timers and
  # duplicate recovery button rows. Remove every copy, then mount the canonical
  # cache-busted one in the head.
  perl -0pi -e 's{[[:space:]]*<script\b[^>]*src="[^"]*laolao-splash\.js(?:\?[^" ]*)?"[^>]*></script>[[:space:]]*}{}g' "$index_file"
  perl -0pi -e 's{</head>}{    <script defer src="./laolao-splash.js?v=splash26"></script>\n</head>}' "$index_file"
  DID_CHANGE=1

  if grep -Fq '<title>OpenClaw Control</title>' "$index_file"; then
    perl -0pi -e 's{<title>OpenClaw Control</title>}{<title>来啦～老弟</title>}' "$index_file"
    DID_CHANGE=1
  fi

  # Static fallback/connection copy can render before the app component. Keep
  # every visible brand surface on CLE Kk; custom-element tag names stay lower
  # case and are therefore untouched.
  if grep -Fq 'OpenClaw' "$index_file"; then
    perl -0pi -e 's{OpenClaw}{CLE Kk}g' "$index_file"
    DID_CHANGE=1
  fi
  local service_worker="$ui_root/sw.js"
  if [[ -f "$service_worker" ]] && grep -Fq 'OpenClaw' "$service_worker"; then
    perl -0pi -e 's{OpenClaw}{CLE Kk}g' "$service_worker"
    DID_CHANGE=1
  fi

  if grep -Fq '"./laolao-' "$index_file"; then
    perl -0pi -e 's{"\./laolao-}{"/laolao-}g' "$index_file"
    DID_CHANGE=1
  fi
  # 旧版 index.html 可能已经使用 /laolao-* 根路径；上面的相对路径
  # 条件不会命中，因此这里无条件校正本次改动涉及的缓存键。
  perl -0pi -e 's{(?:\./|/)laolao-theme\.css(?:\?v=[^" ]*)?}{/laolao-theme.css?v=theme46}g; s{(?:\./|/)laolao-classic-shell\.css(?:\?v=[^" ]*)?}{/laolao-classic-shell.css?v=classic17}g; s{(?:\./|/)laolao-sidebar\.js(?:\?v=[^" ]*)?}{/laolao-sidebar.js?v=sidebar26}g; s{(?:\./|/)laolao-session-list\.js(?:\?v=[^" ]*)?}{/laolao-session-list.js?v=sessions10}g; s{(?:\./|/)laolao-usage-stats\.js(?:\?v=[^" ]*)?}{/laolao-usage-stats.js?v=stats16}g; s{(?:\./|/)laolao-usage-stats\.css(?:\?v=[^" ]*)?}{/laolao-usage-stats.css?v=stats8}g; s{(?:\./|/)laolao-deep-think\.js(?:\?v=[^" ]*)?}{/laolao-deep-think.js?v=deepthink17}g; s{(?:\./|/)laolao-web-gpt-collab\.js(?:\?v=[^" ]*)?}{/laolao-web-gpt-collab.js?v=webgpt15}g; s{(?:\./|/)laolao-context-compact\.js(?:\?v=[^" ]*)?}{/laolao-context-compact.js?v=contextcompact3}g; s{(?:\./|/)laolao-ui-subtraction\.css(?:\?v=[^" ]*)?}{/laolao-ui-subtraction.css?v=subtraction11}g; s{(?:\./|/)laolao-side-layout\.css(?:\?v=[^" ]*)?}{/laolao-side-layout.css?v=side20}g' "$index_file"
}

apply_bundle_icon() {
  local app_path="$1"
  local icon_name="$2"
  local resources="$app_path/Contents/Resources"
  local plist="$app_path/Contents/Info.plist"
  local target_icon="$resources/$icon_name.icns"
  local current_icon

  [[ -d "$app_path" && -f "$plist" ]] || return 0
  current_icon="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$plist" 2>/dev/null || true)"

  if [[ "$current_icon" != "$icon_name" ]] || ! cmp -s "$ASSET_ROOT/PinkieAppIcon.icns" "$target_icon"; then
    copy_if_changed "$ASSET_ROOT/PinkieAppIcon.icns" "$target_icon"
    if /usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$plist" >/dev/null 2>&1; then
      /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile $icon_name" "$plist"
    else
      /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string $icon_name" "$plist"
    fi
    DID_CHANGE=1
  fi
}

rebuild_launcher_if_needed() {
  local app_path="$1"
  local source_file="$LAUNCHER_SOURCE"
  local target_file="$app_path/Contents/MacOS/Launcher"
  local temp_binary

  [[ -f "$source_file" && -d "$app_path/Contents/MacOS" ]] || return 0
  if [[ -x "$target_file" ]] && [[ "$target_file" -nt "$source_file" ]] \
    && strings "$target_file" | grep -Fq 'laolaoProjectFolder' \
    && strings "$target_file" | grep -Fq 'laolaoRoundtable' \
    && strings "$target_file" | grep -Fq 'laolaoWorkspaceDock' \
    && strings "$target_file" | grep -Fq 'laolaoBrowserWorkspace' \
    && strings "$target_file" | grep -Fq 'laolaoMaterialPreview'; then
    return 0
  fi

  temp_binary="$(mktemp "$app_path/Contents/MacOS/.Launcher.XXXXXX")"
  xcrun swiftc -parse-as-library -O "$source_file" \
    -framework AppKit \
    -framework AVFoundation \
    -framework Foundation \
    -framework Speech \
    -framework WebKit \
    -o "$temp_binary"
  chmod 755 "$temp_binary"
  mv "$temp_binary" "$target_file"
  DID_CHANGE=1
}

sync_launcher_resources() {
  local app_path="$1"
  local bundled_root="$app_path/Contents/Resources/SuperPinkie"
  local bundled_ui="$bundled_root/runtime/openclaw/dist/control-ui"
  local service_file source_file

  [[ -d "$bundled_root/ui/assets" ]] || return 0
  # The launcher executes apply-bundled.sh from inside the app. Keep this
  # bootstrap in sync with the source so an installed hotfix cannot be undone
  # by an older self-mutating bootstrap on the next cold launch.
  copy_if_changed "$REPO_ROOT/installer/macos/apply-bundled.sh" "$bundled_root/installer/macos/apply-bundled.sh"
  copy_if_changed "$REPO_ROOT/installer/macos/apply-theme.sh" "$bundled_root/installer/macos/apply-theme.sh"
  copy_if_changed "$REPO_ROOT/ui/launcher-loading.html" "$bundled_root/ui/launcher-loading.html"
  copy_if_changed "$ASSET_ROOT/laolao-splash.mp4" "$bundled_root/ui/assets/laolao-splash.mp4"
  copy_if_changed "$ASSET_ROOT/laolao-splash-video-poster.png" "$bundled_root/ui/assets/laolao-splash-video-poster.png"
  # Keep every bundled web surface aligned with the hotfix source. Party and
  # Roundtable are served from this source tree rather than control-ui, while
  # a future repair/manual install may consume the raw injection tree. Leaving
  # either copy stale makes an update appear successful but keeps the old UI.
  mkdir -p \
    "$bundled_root/ui/injections" \
    "$bundled_root/ui/assets" \
    "$bundled_root/ui/party" \
    "$bundled_root/ui/roundtable" \
    "$bundled_root/services/party" \
    "$bundled_root/services/roundtable"
  for source_file in "$INJECTION_ROOT"/*; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/injections/$(basename "$source_file")"
  done
  for source_file in "$ASSET_ROOT"/*; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/assets/$(basename "$source_file")"
  done
  for source_file in "$REPO_ROOT/ui/party"/*; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/party/$(basename "$source_file")"
  done
  for source_file in "$REPO_ROOT/ui/roundtable"/*; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/ui/roundtable/$(basename "$source_file")"
  done
  for service_file in identities.json live.py openclaw-live.mjs server.py setup.py usage.py; do
    copy_if_changed \
      "$REPO_ROOT/services/party/$service_file" \
      "$bundled_root/services/party/$service_file"
  done
  copy_if_changed \
    "$REPO_ROOT/services/roundtable/server.py" \
    "$bundled_root/services/roundtable/server.py"
  # The state-root rule moved into its own top-level module so the context
  # budget, the usage ledger and the installers cannot drift apart. Hotfixing
  # the consumers into a bundle that predates it would leave the cold-launch
  # repair crashing on a missing file, so ship the module with them.
  copy_if_changed \
    "$REPO_ROOT/services/state_root.py" \
    "$bundled_root/services/state_root.py"
  # The managed launcher installs these two OpenClaw extensions from its own
  # bundled service tree on every cold launch. Keep that tree aligned with the
  # hotfix source as well; otherwise a restart silently restores stale hook
  # policy and can reintroduce tool blocking even though ~/.openclaw/extensions
  # was already repaired.
  mkdir -p \
    "$bundled_root/services/context" \
    "$bundled_root/services/project-scope" \
    "$bundled_root/services/mode-architecture" \
    "$bundled_root/services/chatgpt-collab" \
    "$bundled_root/skills/deep-think" \
    "$bundled_root/skills/web-gpt-collab" \
    "$bundled_root/patch" \
    "$bundled_root/proxy"
  for service_file in context_budget.py setup.py budget.mjs policy.json; do
    copy_if_changed \
      "$REPO_ROOT/services/context/$service_file" \
      "$bundled_root/services/context/$service_file"
  done
  for service_file in index.mjs setup.py package.json openclaw.plugin.json; do
    copy_if_changed \
      "$REPO_ROOT/services/project-scope/$service_file" \
      "$bundled_root/services/project-scope/$service_file"
  done
  for service_file in index.mjs memory.mjs learning.mjs web-gpt-activity.mjs web-gpt-connection.mjs setup.py package.json openclaw.plugin.json; do
    copy_if_changed \
      "$REPO_ROOT/services/mode-architecture/$service_file" \
      "$bundled_root/services/mode-architecture/$service_file"
  done
  while IFS= read -r -d '' source_file; do
    relative_path="${source_file#"$REPO_ROOT/services/chatgpt-collab/"}"
    target_file="$bundled_root/services/chatgpt-collab/$relative_path"
    mkdir -p "$(dirname "$target_file")"
    copy_if_changed "$source_file" "$target_file"
  done < <(find "$REPO_ROOT/services/chatgpt-collab" -type f -print0)
  copy_if_changed "$REPO_ROOT/skills/deep-think/SKILL.md" "$bundled_root/skills/deep-think/SKILL.md"
  copy_if_changed "$REPO_ROOT/skills/web-gpt-collab/SKILL.md" "$bundled_root/skills/web-gpt-collab/SKILL.md"
  # Cold launch repairs the pinned runtime from this directory. Keep these
  # scripts aligned with source so a restart cannot restore an older policy.
  for source_file in "$REPO_ROOT/patch"/*.mjs; do
    [[ -f "$source_file" ]] || continue
    copy_if_changed "$source_file" "$bundled_root/patch/$(basename "$source_file")"
  done
  copy_if_changed "$REPO_ROOT/proxy/mm-retry-proxy.py" "$bundled_root/proxy/mm-retry-proxy.py"
  if [[ -f "$bundled_ui/index.html" ]]; then
    apply_ui_skin "$bundled_ui"
  fi
}

install_model_retry_proxy() {
  local source_script="$REPO_ROOT/proxy/mm-retry-proxy.py"
  local target_script="$USER_HOME/bin/mm-retry-proxy.py"
  local backup_root changed=0 label plist_args
  [[ -f "$source_script" ]] || return 0
  mkdir -p "$(dirname "$target_script")"
  if [[ -f "$target_script" ]] && ! cmp -s "$source_script" "$target_script"; then
    backup_root="$USER_HOME/Library/Application Support/SuperPinkie/backups/model-proxy-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_root"
    cp -p "$target_script" "$backup_root/mm-retry-proxy.py"
  fi
  if [[ ! -f "$target_script" ]] || ! cmp -s "$source_script" "$target_script"; then
    copy_if_changed "$source_script" "$target_script"
    changed=1
  fi
  chmod 755 "$target_script"
  [[ "$changed" == "1" ]] || return 0
  # Restart only the four known proxy jobs whose saved ProgramArguments point
  # at this exact script. Cookies, model accounts and gateway sessions live in
  # separate stores and are never touched here.
  for label in \
    com.openclaw.mm-retry-proxy \
    com.openclaw.mm-retry-proxy-force \
    com.openclaw.mm-retry-proxy-codex \
    com.openclaw.mm-retry-proxy-codex-oc; do
    plist_args="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$USER_HOME/Library/LaunchAgents/$label.plist" 2>/dev/null || true)"
    [[ "$plist_args" == *"$target_script"* ]] || continue
    launchctl kickstart -k "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  done
}

# 主题注入会改动 App 包内资源；无论中途哪个可选补丁失败，都必须在
# 退出前重新封装签名，否则 LaunchServices 会把整个 App 判定为损坏。
reseal_app_on_exit() {
  local exit_code=$?
  trap - EXIT
  local needs_reseal="${DID_CHANGE:-0}"
  # Some bundled-runtime patches edit files directly and cannot update the
  # shell-level DID_CHANGE flag. Check the envelope itself as a second guard;
  # otherwise the next LaunchServices launch would see a stale sealed-resource
  # hash even though the sync command reported success.
  if [[ "$needs_reseal" != "1" && -d "$LAUNCHER_APP_PATH" ]] \
      && ! codesign --verify --deep --strict "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
    needs_reseal=1
  fi
  if [[ "${SKIP_APP_BUNDLES:-0}" != "1" && "$needs_reseal" == "1" && -d "$LAUNCHER_APP_PATH" ]]; then
    local preserved_ok=1
    if ! codesign --force --deep --sign - --preserve-metadata=identifier,requirements,entitlements,flags,runtime "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
      preserved_ok=0
    fi
    # codesign can return success while retaining a stale nested
    # CodeResources entry (for example after an optional roundtable asset was
    # removed). Verify the resulting envelope, not only the signing command.
    if [[ "$preserved_ok" != "1" ]] \
        || ! codesign --verify --deep --strict "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
      # A replaced nested resource can make the old entitlement envelope
      # impossible to preserve (macOS reports a sealed-resource mismatch).
      # Fall back to a fresh ad-hoc envelope so a UI-only sync never leaves
      # the installed App unlaunchable. The launcher keeps its bundle ID and
      # runtime flags; the CUA helper remains separately signed.
      if ! codesign --force --deep --options runtime --sign - "$LAUNCHER_APP_PATH" >/dev/null 2>&1 \
          || ! codesign --verify --deep --strict "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
        echo "error: failed to reseal $LAUNCHER_APP_PATH" >&2
        [[ "$exit_code" -eq 0 ]] && exit_code=1
      else
        echo "warning: resealed $LAUNCHER_APP_PATH with a fresh local signature" >&2
      fi
    fi
    # Local builds are ad-hoc signed. Without an explicit designated
    # requirement macOS derives identity from the CDHash, which changes after
    # every hotfix and makes an already-enabled permission look ungranted.
    # Re-sign only the outer App envelope with the same stable identity used by
    # desktop/macos/build.sh; vendor-signed CuaDriver remains untouched.
    if codesign -dvv "$LAUNCHER_APP_PATH" 2>&1 | grep -Fq 'Signature=adhoc'; then
      if ! codesign --force --options runtime --sign - \
          --requirements '=designated => identifier "com.cle0726.super-pinkie"' \
          "$LAUNCHER_APP_PATH" >/dev/null 2>&1 \
          || ! codesign -dr - "$LAUNCHER_APP_PATH" 2>&1 \
            | grep -Fq 'designated => identifier "com.cle0726.super-pinkie"'; then
        echo "error: failed to preserve CLE Kk's stable local permission identity" >&2
        [[ "$exit_code" -eq 0 ]] && exit_code=1
      fi
    fi
    if ! codesign --verify --deep --strict "$LAUNCHER_APP_PATH" >/dev/null 2>&1; then
      echo "error: updated CLE Kk App signature did not verify" >&2
      [[ "$exit_code" -eq 0 ]] && exit_code=1
    fi
  fi
  exit "$exit_code"
}

sync_agent_avatars() {
  mkdir -p \
    "$USER_HOME/.openclaw/workspace/avatars" \
    "$USER_HOME/.openclaw/workspace-project/avatars" \
    "$USER_HOME/.openclaw/workspace-thinking/avatars" \
    "$USER_HOME/.openclaw/workspace-learning/avatars" \
    "$USER_HOME/.openclaw/workspace-unrestricted/avatars"
  copy_if_changed "$ASSET_ROOT/laolao-mode-chat-hd.png" "$USER_HOME/.openclaw/workspace/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-project-hd.png" "$USER_HOME/.openclaw/workspace-project/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-thinking-hd.png" "$USER_HOME/.openclaw/workspace-thinking/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-learning-hd.png" "$USER_HOME/.openclaw/workspace-learning/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-unrestricted-hd.png" "$USER_HOME/.openclaw/workspace-unrestricted/avatars/unrestricted-mode.png"
}

install_relay_watchdog() {
  local source_script="$REPO_ROOT/services/watchdog/cle-watchdog.sh"
  local source_plist="$REPO_ROOT/services/watchdog/ai.openclaw.watchdog.plist.in"
  local target_script="$USER_HOME/.openclaw/scripts/cle_watchdog.sh"
  local target_plist="$USER_HOME/Library/LaunchAgents/ai.openclaw.watchdog.plist"
  local backup_root should_reload=0

  [[ -f "$source_script" && -f "$source_plist" ]] || return 0
  mkdir -p "$(dirname "$target_script")" "$(dirname "$target_plist")"
  if [[ -f "$target_script" ]] && ! cmp -s "$source_script" "$target_script"; then
    backup_root="$USER_HOME/Library/Application Support/SuperPinkie/backups/relay-watchdog-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_root"
    cp -p "$target_script" "$backup_root/cle_watchdog.sh"
  fi
  if [[ ! -f "$target_script" ]] || ! cmp -s "$source_script" "$target_script"; then
    copy_if_changed "$source_script" "$target_script"
    should_reload=1
  fi
  chmod 755 "$target_script"
  sed "s|@SCRIPT@|$target_script|g" "$source_plist" > "$target_plist.tmp"
  if [[ ! -f "$target_plist" ]] || ! cmp -s "$target_plist.tmp" "$target_plist"; then
    mv "$target_plist.tmp" "$target_plist"
    should_reload=1
  else
    rm -f "$target_plist.tmp"
  fi
  if ! launchctl print "gui/$(id -u)/ai.openclaw.watchdog" >/dev/null 2>&1; then
    should_reload=1
  fi
  if [[ "$should_reload" == "1" ]]; then
    launchctl bootout "gui/$(id -u)/ai.openclaw.watchdog" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$target_plist"
  fi
}

OPENCLAW_ROOT="${OPENCLAW_ROOT:-}"
if [[ -z "$OPENCLAW_ROOT" ]]; then
  # The managed App owns the gateway it is about to update. Prefer that
  # runtime before PATH: a shell shim named `openclaw` is not a package root
  # and has no `dist/` tree to patch.
  BUNDLED_RUNTIME="${PINKIE_APP_PATH:-/Applications/超級碧琪.app}/Contents/Resources/SuperPinkie/runtime/openclaw"
  if [[ -f "$BUNDLED_RUNTIME/openclaw.mjs" ]]; then
    OPENCLAW_ROOT="$BUNDLED_RUNTIME"
  fi
fi
if [[ -z "$OPENCLAW_ROOT" ]]; then
  if command -v openclaw >/dev/null 2>&1; then
    openclaw_entry="$(command -v openclaw)"
    openclaw_entry="$(realpath "$openclaw_entry" 2>/dev/null || readlink "$openclaw_entry" 2>/dev/null || printf '%s' "$openclaw_entry")"
    openclaw_candidate="$(cd "$(dirname "$openclaw_entry")" && pwd)"
    if [[ -f "$openclaw_candidate/openclaw.mjs" ]]; then
      OPENCLAW_ROOT="$openclaw_candidate"
    fi
  fi
fi
if [[ -z "$OPENCLAW_ROOT" ]]; then
  for candidate in "$NODE_VERSIONS_ROOT"/*/lib/node_modules/openclaw; do
    if [[ -f "$candidate/openclaw.mjs" ]]; then
      OPENCLAW_ROOT="$candidate"
    fi
  done
fi

DID_CHANGE=0
trap reseal_app_on_exit EXIT
if [[ "$BUNDLE_BUILD_ONLY" != "1" ]]; then
  sync_agent_avatars
  install_model_retry_proxy
  install_relay_watchdog
fi
if [[ -n "$OPENCLAW_ROOT" ]]; then
  apply_ui_skin "$OPENCLAW_ROOT/dist/control-ui"
  if [[ "$BUNDLE_BUILD_ONLY" != "1" && -f "$REPO_ROOT/services/party/usage.py" ]]; then
    # Reuse the existing stats scheduler; don't add another background job.
    if [[ -f "$USER_HOME/.openclaw/laolao-stats-sync.py" ]]; then
      if ! cmp -s "$REPO_ROOT/services/party/usage.py" "$USER_HOME/.openclaw/laolao-stats-sync.py"; then
        mkdir -p "$USER_HOME/Library/Application Support/SuperPinkie/backups"
        USAGE_BACKUP="$(mktemp -d "$USER_HOME/Library/Application Support/SuperPinkie/backups/usage-sync-XXXXXX")"
        cp -p "$USER_HOME/.openclaw/laolao-stats-sync.py" "$USAGE_BACKUP/laolao-stats-sync.py"
      fi
      copy_if_changed "$REPO_ROOT/services/party/usage.py" "$USER_HOME/.openclaw/laolao-stats-sync.py"
    fi
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$PYTHON_BIN" "$REPO_ROOT/services/party/usage.py"
  fi
  if [[ -f "$REPO_ROOT/patch/apply-context-budget.mjs" ]]; then
    CONTEXT_NODE="$(command -v node 2>/dev/null || true)"
    if [[ -z "$CONTEXT_NODE" && -x "$OPENCLAW_ROOT/../../../bin/node" ]]; then
      CONTEXT_NODE="$OPENCLAW_ROOT/../../../bin/node"
    fi
    if [[ -z "$CONTEXT_NODE" ]]; then
      echo "error: Node is required for model-aware context protection" >&2
      exit 1
    fi
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-context-budget.mjs"
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-compaction-boundary-recovery.mjs"
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-loopback-model-reliability.mjs"
    if [[ "$BUNDLE_BUILD_ONLY" != "1" ]]; then
      "$PYTHON_BIN" "$REPO_ROOT/services/context/setup.py"
      # Update the live extensions too. A hotfix that changes only the App's
      # bundled source would otherwise leave the current gateway on stale
      # watchdog and project-tool logic until a later cold launch.
      "$PYTHON_BIN" "$REPO_ROOT/services/project-scope/setup.py"
      "$PYTHON_BIN" "$REPO_ROOT/services/mode-architecture/setup.py"
    fi
    # 图片白名单扩展：允许个人目录和精确的 ~/.openclaw/workspace* 工作区
    # 显示本轮产出；整个 ~/.openclaw 配置目录仍不在白名单中。
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-image-access.mjs"
    # Control UI 也有一层独立的浏览器预检。让它和网关使用相同的工作区
    # 边界，否则前端会在发请求前错误显示 "Outside allowed folders"。
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-control-ui-workspace-media.mjs"
    # The native material viewer uses an opaque clekk-material: URL. Keep the
    # strict Control UI CSP, but allow that one in-app scheme for image/PDF
    # rendering; this does not grant the agent any new filesystem or tool access.
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-material-preview-csp.mjs"
    # The managed desktop gateway is loopback-only and belongs to the user.
    # OpenClaw's owner-only sender filter would otherwise strip gateway,
    # nodes and cron from every CLE Kk mode even when tools.profile=full.
    if [[ -f "$REPO_ROOT/patch/apply-local-unrestricted-policy.mjs" ]]; then
      OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-local-unrestricted-policy.mjs"
    fi
    # 首轮即向模型公开已配对节点的完整 Computer Use v2 动作；否则
    # list_apps / accessibility / bring_to_front 会被旧版 v1 参数表隐藏。
    if ! OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-computer-v2.mjs"; then
      echo "warning: Computer Use v2 patch skipped because this runtime has no matching chunk" >&2
    fi
  fi
  # apply-context-budget/apply-image-access may regenerate the control-ui
  # entrypoint, so refresh the skin cache key after all runtime patches finish.
  if [[ -f "$OPENCLAW_ROOT/dist/control-ui/index.html" ]]; then
    perl -0pi -e 's{(laolao-theme\.css\?v=)theme[0-9]+}{${1}theme46}g' "$OPENCLAW_ROOT/dist/control-ui/index.html"
  fi
else
  echo "error: CLE Kk compatibility runtime not found; set OPENCLAW_ROOT and retry" >&2
  exit 1
fi

if [[ "$SKIP_APP_BUNDLES" != "1" ]]; then
  sync_launcher_resources "$LAUNCHER_APP_PATH"
  rebuild_launcher_if_needed "$LAUNCHER_APP_PATH"
  apply_bundle_icon "$LAUNCHER_APP_PATH" "PinkieAppIcon"

  if [[ "$DID_CHANGE" == "1" ]]; then
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -f "$LAUNCHER_APP_PATH"
    touch "$LAUNCHER_APP_PATH"
  fi
fi
