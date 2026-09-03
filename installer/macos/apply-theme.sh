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

apply_ui_skin() {
  local ui_root="$1"
  local index_file="$ui_root/index.html"
  local asset

  [[ -f "$index_file" ]] || return 0

  # Work on one canonical relative form while patching. The final form is
  # root-relative, so nested SPA routes such as /settings/general never look
  # for the skin under /settings/ and briefly fall back to stock dark UI.
  perl -0pi -e 's{"/laolao-}{"./laolao-}g' "$index_file"

  for asset in \
    laolao-avatar.png \
    laolao-mode-chat.png \
    laolao-mode-project.png \
    laolao-mode-thinking.png \
    laolao-mode-unrestricted.png \
    laolao-mode-chat-hd.png \
    laolao-mode-project-hd.png \
    laolao-mode-thinking-hd.png \
    laolao-mode-unrestricted-hd.png \
    laolao-mode-transition-chat.png \
    laolao-mode-transition-project.png \
    laolao-mode-transition-thinking.png \
    laolao-mode-transition-unrestricted.png \
    laolao-mode-chat.svg \
    laolao-mode-project.svg \
    laolao-mode-thinking.svg \
    laolao-mode-unrestricted.svg \
    laolao-wallpaper.png \
    laolao-wallpaper-project.png \
    laolao-wallpaper-thinking.png \
    laolao-wallpaper-unrestricted.png \
    laolao-splash.png \
    laolao-theme.css \
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
    perl -0pi -e 's{(<script type="module")}{    <script src="./laolao-sidebar.js?v=sidebar14"></script>\n    $1}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-sidebar.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-sidebar.css?v=sidebar17">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  # 顶栏用量统计胶囊：JS 必须紧跟 sidebar.js（依赖其 __laolaoSidebar.gwRequest 句柄）
  if ! grep -Fq './laolao-usage-stats.js' "$index_file"; then
    perl -0pi -e 's{(<script src="\./laolao-sidebar\.js[^"]*"></script>)}{$1\n    <script src="./laolao-usage-stats.js?v=stats11"></script>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-usage-stats.css' "$index_file"; then
    perl -0pi -e 's{</head>}{    <link rel="stylesheet" href="./laolao-usage-stats.css?v=stats7">\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-phrases.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-phrases.js?v=phrases9"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-progress.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-progress.js?v=progress4"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-session-list.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script src="./laolao-session-list.js?v=sessions4"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-phrases.js?v=phrases9' "$index_file"; then
    perl -0pi -e 's{\./laolao-phrases\.js(?:\?v=[^"]*)?}{./laolao-phrases.js?v=phrases9}g' "$index_file"
  fi
  if ! grep -Fq './laolao-progress.js?v=progress4' "$index_file"; then
    perl -0pi -e 's{\./laolao-progress\.js(?:\?v=[^"]*)?}{./laolao-progress.js?v=progress4}g' "$index_file"
    DID_CHANGE=1
  fi

  # live-voice v2: 去掉 characterData 观察（文本节点变异是 mutation record
  # 雪崩的大头）；childList 在流式重建整块 DOM 时仍会触发，功能不受影响。
  if ! grep -Fq './laolao-live-voice.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-live-voice.js?v=voice3"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-live-voice.js?v=voice3' "$index_file"; then
    perl -0pi -e 's{\./laolao-live-voice\.js(?:\?v=[^"]*)?}{./laolao-live-voice.js?v=voice3}g' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-mode-switcher.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-mode-switcher.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-image-viewer.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-image-viewer.js"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  # Stream-fx（v2：去掉 chunk 淡入，只留光标柔和呼吸）— 必须在
  # image-viewer 之后、party-entry 之前加载；它只对 .chat-bubble.streaming
  # 生效，与其它脚本互不干扰。
  if ! grep -Fq './laolao-stream-fx.js?v=stream3' "$index_file"; then
    perl -0pi -e 's{\./laolao-stream-fx\.js(?:\?v=[^"]*)?}{./laolao-stream-fx.js?v=stream3}g' "$index_file"
    DID_CHANGE=1
  fi

  # Link-viewer：拦截聊天内容里的 <a target="_blank"> 点击，避免被
  # WKWebView 静默吞掉（app 没实现 createWebView 代理）。就地打开
  # in-app 预览层，X-Frame-Options 拒绝嵌入时回退到复制网址。
  if ! grep -Fq './laolao-link-viewer.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-link-viewer.js?v=link1"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  # Tool-stream v3：MutationObserver 改成 1s 轮询（subtree 观察者在流式
  # 重建 DOM 时会收到每条 mutation record 的副本，叠加 12 个观察者造成
  # GC 雪崩把主线程打满）。v2 只自动展开最后一组；用户手动折叠后不再自动展开。
  if ! grep -Fq './laolao-tool-stream.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-tool-stream.js?v=toolstream3"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-tool-stream.js?v=toolstream3' "$index_file"; then
    perl -0pi -e 's{\./laolao-tool-stream\.js\?v=[^"]*}{./laolao-tool-stream.js?v=toolstream3}g' "$index_file"
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

  # 前后台断线恢复: 监听原生前后台事件 + visibilitychange, 回前台时重拉会话
  # v2 修复 TDZ ReferenceError (wasBusy 引用越作用域, 导致恢复流程从未执行)
  # v3 观察者在 hook 网关成功后 disconnect（雪崩治理，见 tool-stream v3）
  if ! grep -Fq './laolao-resume.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-resume.js?v=resume5"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-resume.js?v=resume5' "$index_file"; then
    perl -0pi -e 's{\./laolao-resume\.js\?v=[^"]*}{./laolao-resume.js?v=resume5}g' "$index_file"
    DID_CHANGE=1
  fi

  # 极致思考四档按钮 (全模式可用; 破甲与否由注入层按 session 门控)
  if ! grep -Fq './laolao-deep-think.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-deep-think.js?v=deepthink12"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-deep-think.js?v=deepthink12' "$index_file"; then
    perl -0pi -e 's{\./laolao-deep-think\.js\?v=[^"]*}{./laolao-deep-think.js?v=deepthink12}g' "$index_file"
    DID_CHANGE=1
  fi

  # 全模式手动上下文整理；直接调用原生 sessions.compact，不往聊天里塞命令。
  if ! grep -Fq './laolao-context-compact.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script defer src="./laolao-context-compact.js?v=contextcompact1"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  elif ! grep -Fq './laolao-context-compact.js?v=contextcompact1' "$index_file"; then
    perl -0pi -e 's{\./laolao-context-compact\.js\?v=[^"]*}{./laolao-context-compact.js?v=contextcompact1}g' "$index_file"
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
    perl -0pi -e 's{(<openclaw-app>)}{    <script src="./laolao-handoff-bootstrap.js?v=handoff4"></script>\n    $1}' "$index_file"
    DID_CHANGE=1
  fi

  if ! grep -Fq './laolao-motion.js' "$index_file"; then
    perl -0pi -e 's{</head>}{    <script src="./laolao-motion.js?v=motion2"></script>\n</head>}' "$index_file"
    DID_CHANGE=1
  fi

  # Custom assets keep stable filenames so upgrades can restore them. Bump the
  # query version here whenever interaction or transition behavior changes;
  # otherwise WebKit may keep an older local copy after a normal reload.
  if ! grep -Fq './laolao-theme.css?v=theme31' "$index_file"; then
    perl -0pi -e 's{\./laolao-theme\.css(?:\?v=[^"]*)?}{./laolao-theme.css?v=theme31}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-sidebar.js?v=sidebar14' "$index_file"; then
    perl -0pi -e 's{\./laolao-sidebar\.js(?:\?v=[^"]*)?}{./laolao-sidebar.js?v=sidebar14}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-sidebar.css?v=sidebar17' "$index_file"; then
    perl -0pi -e 's{\./laolao-sidebar\.css(?:\?v=[^"]*)?}{./laolao-sidebar.css?v=sidebar17}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-session-list.js?v=sessions4' "$index_file"; then
    perl -0pi -e 's{\./laolao-session-list\.js(?:\?v=[^"]*)?}{./laolao-session-list.js?v=sessions4}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-usage-stats.js?v=stats11' "$index_file"; then
    perl -0pi -e 's{\./laolao-usage-stats\.js(?:\?v=[^"]*)?}{./laolao-usage-stats.js?v=stats11}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-usage-stats.css?v=stats7' "$index_file"; then
    perl -0pi -e 's{\./laolao-usage-stats\.css(?:\?v=[^"]*)?}{./laolao-usage-stats.css?v=stats7}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-splash.css?v=splash18' "$index_file"; then
    perl -0pi -e 's{\./laolao-splash\.css(?:\?v=[^"]*)?}{./laolao-splash.css?v=splash18}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-mode-switcher.js?v=mode25' "$index_file"; then
    perl -0pi -e 's{\./laolao-mode-switcher\.js(?:\?v=[^"]*)?}{./laolao-mode-switcher.js?v=mode25}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-splash.js?v=splash21' "$index_file"; then
    perl -0pi -e 's{\./laolao-splash\.js(?:\?v=[^"]*)?}{./laolao-splash.js?v=splash21}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-handoff-bootstrap.js?v=handoff4' "$index_file"; then
    perl -0pi -e 's{\./laolao-handoff-bootstrap\.js(?:\?v=[^"]*)?}{./laolao-handoff-bootstrap.js?v=handoff4}g' "$index_file"
    DID_CHANGE=1
  fi
  if ! grep -Fq './laolao-motion.js?v=motion2' "$index_file"; then
    perl -0pi -e 's{\./laolao-motion\.js(?:\?v=[^"]*)?}{./laolao-motion.js?v=motion2}g' "$index_file"
    DID_CHANGE=1
  fi

  if grep -Fq '<title>OpenClaw Control</title>' "$index_file"; then
    perl -0pi -e 's{<title>OpenClaw Control</title>}{<title>来啦～老弟</title>}' "$index_file"
    DID_CHANGE=1
  fi

  if grep -Fq '"./laolao-' "$index_file"; then
    perl -0pi -e 's{"\./laolao-}{"/laolao-}g' "$index_file"
    DID_CHANGE=1
  fi
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
    && strings "$target_file" | grep -Fq 'laolaoRoundtable'; then
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

  [[ -d "$bundled_root/ui/assets" ]] || return 0
  copy_if_changed "$REPO_ROOT/ui/launcher-loading.html" "$bundled_root/ui/launcher-loading.html"
  copy_if_changed "$ASSET_ROOT/laolao-splash.mp4" "$bundled_root/ui/assets/laolao-splash.mp4"
  copy_if_changed "$ASSET_ROOT/laolao-splash-video-poster.png" "$bundled_root/ui/assets/laolao-splash-video-poster.png"
  if [[ -f "$bundled_ui/index.html" ]]; then
    apply_ui_skin "$bundled_ui"
  fi
}

sync_agent_avatars() {
  mkdir -p \
    "$USER_HOME/.openclaw/workspace/avatars" \
    "$USER_HOME/.openclaw/workspace-project/avatars" \
    "$USER_HOME/.openclaw/workspace-thinking/avatars" \
    "$USER_HOME/.openclaw/workspace-unrestricted/avatars"
  copy_if_changed "$ASSET_ROOT/laolao-mode-chat-hd.png" "$USER_HOME/.openclaw/workspace/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-project-hd.png" "$USER_HOME/.openclaw/workspace-project/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-thinking-hd.png" "$USER_HOME/.openclaw/workspace-thinking/avatars/pinkie-pie.png"
  copy_if_changed "$ASSET_ROOT/laolao-mode-unrestricted-hd.png" "$USER_HOME/.openclaw/workspace-unrestricted/avatars/unrestricted-mode.png"
}

install_relay_watchdog() {
  local source_script="$REPO_ROOT/services/watchdog/cle-watchdog.sh"
  local source_plist="$REPO_ROOT/services/watchdog/ai.openclaw.watchdog.plist.in"
  local target_script="$USER_HOME/.openclaw/scripts/cle_watchdog.sh"
  local target_plist="$USER_HOME/Library/LaunchAgents/ai.openclaw.watchdog.plist"
  local backup_root

  [[ -f "$source_script" && -f "$source_plist" ]] || return 0
  mkdir -p "$(dirname "$target_script")" "$(dirname "$target_plist")"
  if [[ -f "$target_script" ]] && ! cmp -s "$source_script" "$target_script"; then
    backup_root="$USER_HOME/Library/Application Support/SuperPinkie/backups/relay-watchdog-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_root"
    cp -p "$target_script" "$backup_root/cle_watchdog.sh"
  fi
  copy_if_changed "$source_script" "$target_script"
  chmod 755 "$target_script"
  sed "s|@SCRIPT@|$target_script|g" "$source_plist" > "$target_plist.tmp"
  if [[ ! -f "$target_plist" ]] || ! cmp -s "$target_plist.tmp" "$target_plist"; then
    mv "$target_plist.tmp" "$target_plist"
  else
    rm -f "$target_plist.tmp"
  fi
  launchctl bootout "gui/$(id -u)/ai.openclaw.watchdog" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$target_plist"
}

OPENCLAW_ROOT="${OPENCLAW_ROOT:-}"
if [[ -z "$OPENCLAW_ROOT" ]]; then
  if command -v openclaw >/dev/null 2>&1; then
    openclaw_entry="$(command -v openclaw)"
    openclaw_entry="$(realpath "$openclaw_entry" 2>/dev/null || readlink "$openclaw_entry" 2>/dev/null || printf '%s' "$openclaw_entry")"
    if [[ -f "$openclaw_entry" ]]; then
      OPENCLAW_ROOT="$(cd "$(dirname "$openclaw_entry")" && pwd)"
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
if [[ "$BUNDLE_BUILD_ONLY" != "1" ]]; then
  sync_agent_avatars
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
    if [[ "$BUNDLE_BUILD_ONLY" != "1" ]]; then
      "$PYTHON_BIN" "$REPO_ROOT/services/context/setup.py"
    fi
    # 图片白名单扩展：让 ~/Desktop, ~/Downloads, ~/Documents, ~/.workbuddy,
    # ~/WorkBuddy 下的本地文件可以在控制界面里正常显示，不再报
    # "Outside allowed folders"。和 context-budget 一样幂等、可重复执行。
    OPENCLAW_ROOT="$OPENCLAW_ROOT" "$CONTEXT_NODE" "$REPO_ROOT/patch/apply-image-access.mjs"
  fi
else
  echo "error: OpenClaw installation not found; set OPENCLAW_ROOT and retry" >&2
  exit 1
fi

if [[ "$SKIP_APP_BUNDLES" != "1" ]]; then
  sync_launcher_resources "$LAUNCHER_APP_PATH"
  rebuild_launcher_if_needed "$LAUNCHER_APP_PATH"
  apply_bundle_icon "$LAUNCHER_APP_PATH" "PinkieAppIcon"

  if [[ "$DID_CHANGE" == "1" ]]; then
    # Reseal the standalone local launcher only; keep the official App signed by OpenClaw.
    codesign --force --sign - --preserve-metadata=identifier,entitlements,flags,runtime "$LAUNCHER_APP_PATH" >/dev/null 2>&1 || true
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" -f "$LAUNCHER_APP_PATH"
    touch "$LAUNCHER_APP_PATH"
  fi
fi
