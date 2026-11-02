#!/bin/bash
# 摸清这台电脑（Mac / Linux）：配置、现在的余量、已有工具，并给出建议档位。
# 用法：bash machine-check.sh            只看结果
#       bash machine-check.sh --save     同时把结果写进各模式工作区的 TOOLS.md（只替换自动检测那一段）
#       bash machine-check.sh --net      顺便测一下国内镜像和 GitHub 通不通（每个最多等 4 秒）
# 只读检测，不安装、不修改任何东西（--save 只改 TOOLS.md 里标记好的那一段）。
# Windows 用同目录的 machine-check.ps1。

SAVE=0; NET=0
for arg in "$@"; do
  case "$arg" in
    --save) SAVE=1 ;;
    --net) NET=1 ;;
  esac
done

OS="$(uname -s)"; ARCH="$(uname -m)"
gb() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1073741824 }'; }
has() { command -v "$1" >/dev/null 2>&1; }

CPU=""; CORES=""; PCORES=""; RAM_B=0; AVAIL_B=0; GPU=""; GPU_KIND="none"; VRAM_GB=0
DISK_GB=""; POWER=""; OSNAME=""

if [ "$OS" = "Darwin" ]; then
  OSNAME="macOS $(sw_vers -productVersion 2>/dev/null)"
  CPU="$(sysctl -n machdep.cpu.brand_string 2>/dev/null)"
  CORES="$(sysctl -n hw.ncpu 2>/dev/null)"
  PCORES="$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null)"
  RAM_B="$(sysctl -n hw.memsize 2>/dev/null)"
  FREE_PCT="$(memory_pressure -Q 2>/dev/null | awk -F': ' '/free percentage/ { gsub("%", "", $2); print $2 }')"
  [ -n "$FREE_PCT" ] && AVAIL_B="$(awk -v t="$RAM_B" -v p="$FREE_PCT" 'BEGIN { printf "%.0f", t * p / 100 }')"
  DISP="$(system_profiler SPDisplaysDataType -detailLevel mini 2>/dev/null)"
  if [ "$ARCH" = "arm64" ]; then
    GPU_KIND="apple"
    GCORES="$(printf '%s\n' "$DISP" | awk -F': ' '/Total Number of Cores/ { print $2; exit }')"
    GPU="Apple 芯片 GPU${GCORES:+ ${GCORES} 核}，和内存共用"
  else
    GPU="$(printf '%s\n' "$DISP" | awk -F': ' '/Chipset Model/ { print $2 }' | paste -sd '/' -)"
    VRAM_TXT="$(printf '%s\n' "$DISP" | awk -F': ' '/VRAM/ { print $2; exit }')"
    [ -n "$VRAM_TXT" ] && GPU="$GPU（显存 $VRAM_TXT）"
    case "$GPU" in *NVIDIA*|*AMD*|*Radeon*) GPU_KIND="discrete" ;; *) GPU_KIND="integrated" ;; esac
  fi
  if pmset -g batt 2>/dev/null | head -1 | grep -q "Battery Power"; then
    POWER="用电池（$(pmset -g batt | awk 'NR==2 { print $3 }' | tr -d ';')）"
  else
    POWER="插电"
  fi
else
  OSNAME="$(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-Linux}")"
  CPU="$(awk -F': ' '/model name/ { print $2; exit }' /proc/cpuinfo 2>/dev/null)"
  CORES="$(nproc 2>/dev/null)"
  RAM_B="$(awk '/MemTotal/ { print $2 * 1024 }' /proc/meminfo 2>/dev/null)"
  AVAIL_B="$(awk '/MemAvailable/ { print $2 * 1024 }' /proc/meminfo 2>/dev/null)"
  has lspci && GPU="$(lspci 2>/dev/null | awk -F': ' '/VGA|3D/ { print $2 }' | paste -sd '/' -)"
  GPU_KIND="integrated"
  POWER="未知"
  [ -r /sys/class/power_supply/AC/online ] && { [ "$(cat /sys/class/power_supply/AC/online)" = "1" ] && POWER="插电" || POWER="用电池"; }
fi

if has nvidia-smi; then
  NV="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)"
  if [ -n "$NV" ]; then
    GPU_KIND="nvidia"
    VRAM_GB="$(printf '%s' "$NV" | awk -F', ' '{ printf "%.0f", $2 / 1024 }')"
    GPU="$(printf '%s' "$NV" | awk -F', ' '{ print $1 }')（显存 ${VRAM_GB} GB）"
  fi
fi

DISK_GB="$(df -k "$HOME" 2>/dev/null | awk 'NR==2 { printf "%.0f", $4 / 1048576 }')"
RAM_GB="$(gb "${RAM_B:-0}")"
AVAIL_GB="$(gb "${AVAIL_B:-0}")"

# ---------- 已有工具（只看在不在，不运行可能弹出安装窗口的系统占位命令）
CLT=0; [ "$OS" != "Darwin" ] && CLT=1; [ "$OS" = "Darwin" ] && xcode-select -p >/dev/null 2>&1 && CLT=1
tool_line() {
  local name="$1" path
  path="$(command -v "$name" 2>/dev/null)" || return
  case "$path" in /usr/bin/python3|/usr/bin/git) [ "$CLT" = 1 ] || { printf '%s（系统占位，未装开发者工具）' "$name"; return; } ;; esac
  printf '%s' "$name"
}
TOOLS=""
for t in python3 uv node npm git ffmpeg magick brew soffice blender look-page look-video look-doc; do
  s="$(tool_line "$t")"; [ -n "$s" ] && TOOLS="$TOOLS${TOOLS:+、}$s"
done
APPS=""
if [ "$OS" = "Darwin" ]; then
  [ -d "/Applications/Google Chrome.app" ] && APPS="${APPS}${APPS:+、}Chrome"
  [ -d "/Applications/Microsoft Edge.app" ] && APPS="${APPS}${APPS:+、}Edge"
  [ -d "/Applications/Blender.app" ] && APPS="${APPS}${APPS:+、}Blender"
  [ -d "/Applications/LibreOffice.app" ] && APPS="${APPS}${APPS:+、}LibreOffice"
  [ -d "/Applications/Microsoft PowerPoint.app" ] && APPS="${APPS}${APPS:+、}PowerPoint"
  [ -d "/Applications/Keynote.app" ] && APPS="${APPS}${APPS:+、}Keynote"
fi
ENC=""
has ffmpeg && ENC="$(ffmpeg -hide_banner -encoders 2>/dev/null | grep -oE 'h264_videotoolbox|hevc_videotoolbox|h264_nvenc|hevc_nvenc|h264_qsv|h264_amf|h264_vaapi' | sort -u | awk '{ printf "%s%s", (NR > 1 ? "、" : ""), $0 }')"

# ---------- 档位：先按配置定，再按现在的余量提醒
RAM_I="$(printf '%.0f' "$RAM_GB")"; CORES_I="${CORES:-0}"
TIER="轻"
if [ "$RAM_I" -ge 32 ] && { [ "$GPU_KIND" = "apple" ] || [ "${VRAM_GB:-0}" -ge 8 ]; }; then TIER="重"
elif [ "${VRAM_GB:-0}" -ge 12 ] && [ "$RAM_I" -ge 16 ]; then TIER="重"
elif [ "$RAM_I" -ge 16 ] && [ "$CORES_I" -ge 8 ]; then TIER="中"
fi
case "$TIER" in
  轻) BUDGET="视频先出 480p 样片、成片默认 720p（1080p 先实测估时）；同一时间只跑一个重活；不在本机跑大模型（语音转字幕用 small 及以下）；3D 网页像素比封顶 1.5；批量处理分批。" ;;
  中) BUDGET="视频样片 540p、成片 1080p；可以同时跑两个重活；语音转字幕可用 medium / turbo；本地小模型能跑但慢，先实测。" ;;
  重) BUDGET="成片 1080p–4K 都可以；可以并行；语音转字幕用 large；本地 7B–14B 模型、补帧、Blender 渲染可以试，先跑一小段估时。" ;;
esac
NOTES=""
awk -v a="$AVAIL_GB" 'BEGIN { exit !(a > 0 && a < 2) }' && NOTES="${NOTES}现在可用内存不到 2 GB：重活前先关掉不用的程序，或者再降一档。"
case "$POWER" in 用电池*) NOTES="${NOTES}正在用电池：长时间渲染或转码前提醒插电，不插电就降一档。" ;; esac
[ -n "$DISK_GB" ] && [ "$DISK_GB" -lt 10 ] && NOTES="${NOTES}硬盘剩余不到 10 GB：渲染、装大软件前先说清要占多少空间。"
[ "$RAM_I" -le 4 ] && NOTES="${NOTES}内存只有 4 GB 左右：浏览器截图、渲染都要一次一个，处理大文件要分块。"

NETLINE=""
if [ "$NET" = 1 ] && has curl; then
  probe() { curl -s -o /dev/null -m 4 -w '%{http_code}' "$1" 2>/dev/null | grep -qE '^[23]' && printf '通' || printf '不通'; }
  NETLINE="npm 国内镜像 $(probe https://registry.npmmirror.com/)；pip 清华镜像 $(probe https://pypi.tuna.tsinghua.edu.cn/simple/pip/)；GitHub $(probe https://github.com)；HuggingFace 国内镜像 $(probe https://hf-mirror.com)"
fi

DATE="$(date +%Y-%m-%d)"
REPORT="## 这台电脑（machine-check 自动检测，${DATE}）

- 系统：${OSNAME}（${ARCH}）
- 处理器：${CPU:-未知}，${CORES:-?} 个线程${PCORES:+（其中性能核 ${PCORES} 个）}
- 内存：${RAM_GB} GB（检测时可用约 ${AVAIL_GB} GB）
- 显卡：${GPU:-未识别}
- 硬盘：用户目录所在盘剩余约 ${DISK_GB:-?} GB
- 供电：${POWER:-未知}
- 视频硬件编码：${ENC:-没有（或没装 ffmpeg）}
- 已有命令：${TOOLS:-（都没找到）}${APPS:+
- 已有应用：${APPS}}${NETLINE:+
- 网络：${NETLINE}}
- **建议档位：${TIER}**。${BUDGET}${NOTES:+
- **现在要注意：**${NOTES}}
- 档位只是起点：重活先跑一小段量时间再估总时长（见 playbooks/machine.md），实测速度另记在 TOOLS.md 的「实测速度」一节（写在这段外面，重新检测不会冲掉）。"

printf '%s\n' "$REPORT"

if [ "$SAVE" = 1 ]; then
  HERE="$(cd "$(dirname "$0")" && pwd)"
  STATE="$(dirname "$(dirname "$HERE")")"
  for ws in workspace workspace-project workspace-thinking workspace-learning; do
    dir="$STATE/$ws"; [ -d "$dir" ] || continue
    f="$dir/TOOLS.md"; tmp="$f.machine-check.tmp"
    [ -f "$f" ] || printf '# TOOLS.md - 本机说明\n' > "$f"
    # 去掉旧的自动检测段和文件末尾的空行，其它内容原样保留
    awk '/<!-- machine-check:start -->/ { skip = 1; next } /<!-- machine-check:end -->/ { skip = 0; next }
         !skip { line[++n] = $0 } END { while (n > 0 && line[n] ~ /^[[:space:]]*$/) n--; for (i = 1; i <= n; i++) print line[i] }' "$f" > "$tmp" || continue
    { cat "$tmp"; printf '\n<!-- machine-check:start -->\n%s\n<!-- machine-check:end -->\n' "$REPORT"; } > "$tmp.2" && mv "$tmp.2" "$f"
    rm -f "$tmp"
    echo "已写入：$f"
  done
fi
