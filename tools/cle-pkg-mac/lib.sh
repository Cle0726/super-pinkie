# shellcheck shell=bash
# tools/cle-pkg-mac 三件套共用：参数、安全检查、[计划]/[执行]。由 backup-current.sh / install-cle.sh / restore.sh source。
# 退出码对齐 tools/cle-pkg-win：0 完成；1 失败；2 没带 --yes，只列计划；3 拒绝（路径或工具不安全）；64 用法错。
#
# 可调的环境变量（都不设就是本机默认）：
#   CLE_APP_DIR        App 所在目录，默认 /Applications（App 是 $CLE_APP_DIR/超級碧琪.app）
#   CLE_BACKUP_DIR     备份目录，默认 ~/Library/Application Support/SuperPinkie-cle-pkg/backups
#   CLE_AGENTS_DIR     LaunchAgents 目录，默认 ~/Library/LaunchAgents
#   CLE_LABELS         要管的 LaunchAgents label，空格分隔
#   CLE_PKG            C.le. 包（.app），默认 tools/cle-pkg-mac/out/超級碧琪.app
#   CLE_EXPECT_CHANNEL 包的 build-info channel 必须是它才装，默认 cle
#   CLE_LAUNCHCTL / CLE_PGREP / CLE_CODESIGN / CLE_DITTO  替换系统命令（自测用假的）
#   CLE_ISO_ROOT       隔离模式：所有路径必须在它下面，launchctl/pgrep/codesign 不许用真的

CLE_APP_NAME="超級碧琪.app"
CLE_DEFAULT_LABELS="ai.openclaw.watchdog ai.openclaw.gateway com.openclaw.urproxy"
CLE_BUILD_INFO_REL="Contents/Resources/SuperPinkie/build-info.json"

cle_say() { printf '%s\n' "$*"; }
cle_refuse() { printf '拒绝：%s\n' "$*" >&2; exit 3; }
cle_die() { printf '失败：%s\n' "$*" >&2; exit 1; }

cle_usage() {
  local extra=""
  if [ "$CLE_CMD" = restore ]; then extra=" [--backup <备份目录名>]"; fi
  printf '用法：bash %s.sh [--yes]%s\n' "$CLE_CMD" "$extra" >&2
  exit 64
}

cle_stamp() { date +%Y%m%d-%H%M%S; }

# 纯字符串规范化成绝对路径（不跟符号链接，也不要求路径存在）。
cle_abspath() {
  local p="$1" out="" seg rest
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  rest="$p/"
  while [ -n "$rest" ]; do
    seg="${rest%%/*}"
    rest="${rest#*/}"
    case "$seg" in
      ''|.) ;;
      ..) out="${out%/*}" ;;
      *) out="$out/$seg" ;;
    esac
  done
  printf '%s\n' "${out:-/}"
}

cle_inside() { # 路径 根：路径等于根或在根下面
  if [ "$1" = "$2" ] || [ "$2" = / ]; then return 0; fi
  case "$1" in "$2"/*) return 0 ;; esac
  return 1
}

cle_unique() { # 父目录 名字 [还要避开的后缀...]
  local parent="$1" base="$2" name n=1 taken s
  shift 2
  name="$base"
  while :; do
    taken=0
    for s in "" "$@"; do
      if [ -e "$parent/$name$s" ]; then taken=1; fi
    done
    if [ "$taken" = 0 ]; then break; fi
    n=$((n + 1))
    name="$base-$n"
  done
  printf '%s\n' "$name"
}

cle_info_field() { # build-info.json 键：只认一行里的 "键": "值"
  local v
  if [ ! -f "$1" ]; then return 0; fi
  v="$(sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1")"
  printf '%s\n' "${v%%$'\n'*}"
}

# App 的指纹：build-info.json 的 cksum；没有 build-info 就是 -（认不出，不拿来比）。
cle_app_sig() {
  local f="$1/$CLE_BUILD_INFO_REL"
  if [ ! -f "$f" ]; then printf '%s\n' -; return 0; fi
  cksum < "$f" | awk '{print $1 "-" $2}'
}

cle_manifest_get() { # manifest.txt 键
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "$2="*) printf '%s\n' "${line#*=}"; return 0 ;; esac
  done < "$1"
  return 0
}

cle_parse() {
  CLE_YES=0
  CLE_BACKUP_NAME=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --yes) CLE_YES=1 ;;
      --backup)
        if [ "$CLE_CMD" != restore ] || [ $# -lt 2 ]; then cle_usage; fi
        case "$2" in ''|.|..|*/*) cle_usage ;; esac
        CLE_BACKUP_NAME="$2"
        shift
        ;;
      *) cle_usage ;;
    esac
    shift
  done
}

cle_settings() {
  : "${HOME:?没有 HOME}"
  APP_DIR="$(cle_abspath "${CLE_APP_DIR:-/Applications}")"
  APP="${APP_DIR%/}/$CLE_APP_NAME"
  BACKUP_DIR="$(cle_abspath "${CLE_BACKUP_DIR:-$HOME/Library/Application Support/SuperPinkie-cle-pkg/backups}")"
  AGENTS="$(cle_abspath "${CLE_AGENTS_DIR:-$HOME/Library/LaunchAgents}")"
  PKG="$(cle_abspath "${CLE_PKG:-$CLE_HERE/out/$CLE_APP_NAME}")"
  LABELS="$(printf '%s' "${CLE_LABELS:-$CLE_DEFAULT_LABELS}" | tr -s '[:space:]' ' ')"
  LABELS="${LABELS# }"
  LABELS="${LABELS% }"
  LAUNCHCTL="${CLE_LAUNCHCTL:-launchctl}"
  PGREP="${CLE_PGREP:-pgrep}"
  CODESIGN="${CLE_CODESIGN:-codesign}"
  DITTO="${CLE_DITTO:-ditto}"
  EXPECT_CHANNEL="${CLE_EXPECT_CHANNEL:-cle}"
  ISO_ROOT=""
  if [ -n "${CLE_ISO_ROOT:-}" ]; then ISO_ROOT="$(cle_abspath "$CLE_ISO_ROOT")"; fi
  DOMAIN="gui/$(id -u)"
}

cle_check_label() {
  case "$1" in
    ''|.*|*[!A-Za-z0-9._-]*) cle_refuse "LaunchAgents label「$1」不合法" ;;
  esac
}

cle_guard_path() { # 名称 路径
  local lower
  lower="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in *.rollback-*) cle_refuse "$1 $2 是 rollback 目录，这个脚本不碰（等用户定）" ;; esac
  if [ -n "$ISO_ROOT" ] && ! cle_inside "$2" "$ISO_ROOT"; then
    cle_refuse "隔离模式：$1 $2 不在 $ISO_ROOT 里"
  fi
}

cle_guard_tool() { # 变量名 当前值 真命令名
  if [ -n "$ISO_ROOT" ] && [ "${2##*/}" = "$3" ]; then
    cle_refuse "隔离模式：要用 $1 指到假的 $3，不能用真的"
  fi
}

cle_check_safety() {
  local label
  cle_guard_path "App" "$APP"
  cle_guard_path "备份目录" "$BACKUP_DIR"
  cle_guard_path "LaunchAgents 目录" "$AGENTS"
  if [ "$CLE_CMD" = install-cle ]; then cle_guard_path "C.le. 包" "$PKG"; fi
  if [ "$APP_DIR" = / ]; then cle_refuse "App 目录 $APP_DIR 是盘根，不像安装目录"; fi
  if cle_inside "$BACKUP_DIR" "$APP" || cle_inside "$APP" "$BACKUP_DIR"; then cle_refuse "备份目录和 App 不能互相包含"; fi
  if cle_inside "$AGENTS" "$APP" || cle_inside "$APP" "$AGENTS"; then cle_refuse "LaunchAgents 目录和 App 不能互相包含"; fi
  if cle_inside "$PKG" "$APP" || cle_inside "$APP" "$PKG"; then cle_refuse "C.le. 包和 App 不能是同一个，也不能互相包含"; fi
  for label in $LABELS; do cle_check_label "$label"; done
  cle_guard_tool CLE_LAUNCHCTL "$LAUNCHCTL" launchctl
  cle_guard_tool CLE_PGREP "$PGREP" pgrep
  cle_guard_tool CLE_CODESIGN "$CODESIGN" codesign
}

# 带 --yes 才执行；步骤在开了 set -e 的子 shell 里跑，任何一条命令失败都算这一步失败。
cle_run() { # 描述 命令...
  local desc="$1" rc
  shift
  if [ "$CLE_YES" != 1 ]; then
    printf '[计划] %s\n' "$desc"
    return 0
  fi
  printf '[执行] %s\n' "$desc"
  set +e
  ( set -e; "$@" )
  rc=$?
  set -e
  if [ "$rc" != 0 ]; then cle_die "这一步没做完（退出码 $rc）：$desc"; fi
}

cle_end() {
  if [ "$CLE_YES" = 1 ]; then
    cle_say "完成。"
    exit 0
  fi
  cle_say "没带 --yes：上面只是计划，什么都没动。"
  exit 2
}

cle_problem() {
  if [ "$CLE_YES" = 1 ]; then cle_die "$*"; fi
  printf '[会失败] %s\n' "$*"
  cle_end
}

cle_app_running() { "$PGREP" -f "$APP/Contents/MacOS/" >/dev/null 2>&1; }

# 只认写完 manifest.txt、而且记的是同一个 App 的备份（.partial 是没做完的）；按名字排序，一行一个。
cle_complete_backups() {
  local d
  if [ ! -d "$BACKUP_DIR" ]; then return 0; fi
  for d in "$BACKUP_DIR"/*; do
    case "$d" in *.partial) continue ;; esac
    if [ -d "$d" ] && [ ! -L "$d" ] && [ -f "$d/manifest.txt" ] \
      && [ "$(cle_manifest_get "$d/manifest.txt" app)" = "$APP" ]; then
      printf '%s\n' "$d"
    fi
  done
}

cle_latest_backup() { # [备份目录名]
  local d last=""
  while IFS= read -r d; do
    if [ -z "$d" ]; then continue; fi
    if [ -z "${1:-}" ] || [ "${d##*/}" = "$1" ]; then last="$d"; fi
  done <<EOF
$(cle_complete_backups)
EOF
  printf '%s\n' "$last"
}

cle_mv_new() { # 源 目标：目标必须不存在（mv 到已有目录会塞进去）
  if [ -e "$2" ]; then cle_die "$2 已存在，不覆盖"; fi
  mv "$1" "$2"
}

cle_main() { # 命令 参数...
  CLE_CMD="$1"
  shift
  cle_parse "$@"
  cle_settings
  cle_check_safety
  if [ "$CLE_YES" = 1 ]; then
    cle_say "$CLE_CMD：动手（--yes）"
  else
    cle_say "$CLE_CMD：只列计划，不动手（没带 --yes）"
  fi
  cle_say "  App            $APP"
  cle_say "  备份目录       $BACKUP_DIR"
  cle_say "  LaunchAgents   $AGENTS（$LABELS）"
  if [ "$CLE_CMD" = install-cle ]; then cle_say "  C.le. 包       $PKG（要求 channel=$EXPECT_CHANNEL）"; fi
  cle_say "  系统命令       launchctl=$LAUNCHCTL pgrep=$PGREP codesign=$CODESIGN ditto=$DITTO"
  if [ -n "$ISO_ROOT" ]; then cle_say "  隔离根         $ISO_ROOT"; fi
  "cle_cmd_${CLE_CMD//-/_}"
  cle_end
}
