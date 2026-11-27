#!/bin/bash
# 回到 backup-current.sh 备份时的样子：App 和 LaunchAgents plist。
# 用法：bash restore.sh [--yes] [--backup <备份目录名>]   （不带 --yes 只列计划，什么都不动；不指定备份就用最新的完整备份）
# 现装的 App、多出来或不一样的 plist 都不删，挪进 <备份>/after-install/<stamp>/。
# install-cle.sh 留下的 .cle-replaced-<stamp> 如果和备份是同一个 App，直接改名回来；否则从备份拷回。
set -euo pipefail
CLE_HERE="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=lib.sh
. "$CLE_HERE/lib.sh"

restore_move_away() { # 源 目标：先原地改名（挪不动就是还在用），再挪进 after-install
  local tmp="$APP_DIR/$CLE_APP_NAME.cle-removing-$STAMP"
  if [ -e "$tmp" ]; then printf '%s 已存在，不覆盖\n' "$tmp" >&2; exit 1; fi
  if ! mv "$1" "$tmp"; then
    printf '挪不动 %s（App 或网关还在跑？先退出再来）\n' "$1" >&2
    exit 1
  fi
  cle_mv_new "$tmp" "$2"
}

restore_copy_back() {
  local tmp="$APP_DIR/.$CLE_APP_NAME.cle-restoring"
  rm -rf "$tmp"
  "$DITTO" "$SRC/$CLE_APP_NAME" "$tmp"
  cle_mv_new "$tmp" "$APP"
}

restore_plist() { # label：现有的挪走，拷回备份里的，再 bootstrap
  local plist="$AGENTS/$1.plist"
  "$LAUNCHCTL" bootout "$DOMAIN/$1" >/dev/null 2>&1 || true
  if [ -e "$plist" ]; then cle_mv_new "$plist" "$AFTER/LaunchAgents/$1.plist"; fi
  mkdir -p "$AGENTS"
  cp -p "$SRC/LaunchAgents/$1.plist" "$plist"
  if ! "$LAUNCHCTL" bootstrap "$DOMAIN" "$plist"; then
    printf '提示：%s bootstrap 没成功，plist 已经放回，重新登录或手动 bootstrap 即可\n' "$1" >&2
  fi
}

restore_plist_away() { # label：备份里没有、现在有的，bootout 后挪走
  "$LAUNCHCTL" bootout "$DOMAIN/$1" >/dev/null 2>&1 || true
  cle_mv_new "$AGENTS/$1.plist" "$AFTER/LaunchAgents/$1.plist"
}

restore_record() {
  {
    printf 'backup=%s\n' "$SRC"
    printf 'at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'app=%s\n' "$APP"
  } > "$AFTER/restore.txt"
}

# 从 installs.tsv 找能直接改名回来的旧 App：在 App 目录里、名字对、指纹和备份一样。其余记成 LEFTOVERS（一行一个）。
restore_scan_installs() {
  local tsv="$SRC/installs.tsv" stamp replaced old_sig new_sig
  SOURCE=""
  LEFTOVERS=""
  if [ ! -f "$tsv" ]; then return 0; fi
  while IFS="$(printf '\t')" read -r stamp replaced old_sig new_sig || [ -n "${stamp:-}" ]; do
    case "$replaced" in "$APP_DIR/$CLE_APP_NAME.cle-replaced-"*) ;; *) continue ;; esac
    case "${replaced#"$APP_DIR/"}" in */*) continue ;; esac
    if [ ! -d "$replaced" ] || [ -L "$replaced" ]; then continue; fi
    if [ -z "$SOURCE" ] && [ "$PRESENT" = 1 ] && [ "$BACKUP_SIG" != - ] \
      && [ "$(cle_app_sig "$replaced")" = "$BACKUP_SIG" ]; then
      SOURCE="$replaced"
    else
      LEFTOVERS="$LEFTOVERS$replaced
"
    fi
  done < "$tsv"
}

cle_cmd_restore() {
  local label n=0 left
  SRC="$(cle_latest_backup "$CLE_BACKUP_NAME")"
  if [ -z "$SRC" ]; then
    if [ -n "$CLE_BACKUP_NAME" ]; then cle_problem "$BACKUP_DIR 下没有叫 $CLE_BACKUP_NAME 的完整备份"; fi
    cle_problem "$BACKUP_DIR 下没有这个 App 的完整备份"
  fi
  cle_say "来源备份：$SRC"
  PRESENT="$(cle_manifest_get "$SRC/manifest.txt" app.present)"
  if [ "$PRESENT" = 1 ] && [ ! -d "$SRC/$CLE_APP_NAME" ]; then cle_problem "备份 $SRC 不完整（记着有 App，却没拷到）"; fi
  if cle_app_running; then cle_problem "碧琪 App 正在运行，请先退出再还原"; fi

  BACKUP_SIG=-
  if [ "$PRESENT" = 1 ]; then BACKUP_SIG="$(cle_app_sig "$SRC/$CLE_APP_NAME")"; fi
  STAMP="$(cle_stamp)"
  AFTER="$SRC/after-install/$(cle_unique "$SRC/after-install" "$STAMP")"
  restore_scan_installs

  cle_run "建 $AFTER，放还原前的现状" mkdir -p "$AFTER/LaunchAgents"
  if [ -d "$APP" ]; then cle_run "现装的 App 挪到 $AFTER/app" restore_move_away "$APP" "$AFTER/app"; fi
  while IFS= read -r left; do
    if [ -z "$left" ]; then continue; fi
    n=$((n + 1))
    cle_run "和备份对不上的旧 App $left 挪到 $AFTER/replaced-$n" restore_move_away "$left" "$AFTER/replaced-$n"
  done <<EOF
$LEFTOVERS
EOF
  if [ "$PRESENT" = 1 ]; then
    if [ -n "$SOURCE" ]; then
      cle_run "把 $SOURCE 改名回 $APP（和备份是同一个 App）" cle_mv_new "$SOURCE" "$APP"
    else
      cle_run "从备份拷回 App → $APP" restore_copy_back
    fi
  else
    cle_say "备份时没有 App：只把现装的挪走，不放新的"
  fi

  for label in $LABELS; do
    if [ -f "$SRC/LaunchAgents/$label.plist" ]; then
      if [ -f "$AGENTS/$label.plist" ] && cmp -s "$SRC/LaunchAgents/$label.plist" "$AGENTS/$label.plist"; then
        cle_say "跳过 $label.plist：和备份一样"
      else
        cle_run "放回 $label.plist（bootout → 拷回 → bootstrap $DOMAIN）" restore_plist "$label"
      fi
    elif [ -e "$AGENTS/$label.plist" ]; then
      cle_run "备份里没有 $label.plist：bootout 后挪到 $AFTER/LaunchAgents" restore_plist_away "$label"
    else
      cle_say "跳过 $label.plist：备份里和现在都没有"
    fi
  done

  cle_run "写 $AFTER/restore.txt" restore_record
}

cle_main restore "$@"
