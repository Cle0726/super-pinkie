#!/bin/bash
# 备份当前装着的 超級碧琪.app 和它的 LaunchAgents plist，install-cle.sh / restore.sh 都靠这份备份兜底。
# 用法：bash backup-current.sh [--yes]   （不带 --yes 只列计划，什么都不动）
# 参数见 lib.sh 开头。备份先写进 <stamp>.partial，写完 manifest.txt 再改名，没做完的不会被当成备份。
set -euo pipefail
CLE_HERE="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=lib.sh
. "$CLE_HERE/lib.sh"

backup_copy_app() {
  "$DITTO" "$APP" "$PART/$CLE_APP_NAME"
  if [ -f "$APP/$CLE_BUILD_INFO_REL" ]; then cp -p "$APP/$CLE_BUILD_INFO_REL" "$PART/build-info.json"; fi
}

backup_finish() {
  local label state
  {
    printf 'version=1\n'
    printf 'created=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'stamp=%s\n' "$STAMP"
    printf 'app=%s\n' "$APP"
    printf 'app.present=%s\n' "$APP_PRESENT"
    printf 'app.version=%s\n' "$APP_VERSION"
    printf 'app.channel=%s\n' "$APP_CHANNEL"
    printf 'app.commit=%s\n' "$APP_COMMIT"
    for label in $LABELS; do
      state=0
      if [ -f "$PART/LaunchAgents/$label.plist" ]; then state=1; fi
      printf 'plist.%s=%s\n' "$label" "$state"
    done
  } > "$PART/manifest.txt"
  cle_mv_new "$PART" "$FINAL"
  cle_say "备份在 $FINAL："
  cat "$FINAL/manifest.txt"
}

cle_cmd_backup_current() {
  local label info
  if cle_app_running; then cle_problem "碧琪 App 正在运行，请先退出再备份"; fi
  STAMP="$(cle_unique "$BACKUP_DIR" "$(cle_stamp)" .partial)"
  PART="$BACKUP_DIR/$STAMP.partial"
  FINAL="$BACKUP_DIR/$STAMP"
  cle_run "建临时备份目录 $PART" mkdir -p "$PART/LaunchAgents"

  APP_PRESENT=0
  APP_VERSION=""
  APP_CHANNEL=""
  APP_COMMIT=""
  if [ -d "$APP" ]; then
    APP_PRESENT=1
    info="$APP/$CLE_BUILD_INFO_REL"
    APP_VERSION="$(cle_info_field "$info" version)"
    APP_CHANNEL="$(cle_info_field "$info" channel)"
    APP_COMMIT="$(cle_info_field "$info" commit)"
    cle_run "拷 App（version=${APP_VERSION:-?} channel=${APP_CHANNEL:-?}）→ $PART/$CLE_APP_NAME" backup_copy_app
  else
    cle_say "提示：$APP 不存在，只记录状态"
  fi

  for label in $LABELS; do
    if [ -f "$AGENTS/$label.plist" ]; then
      cle_run "拷 $label.plist" cp -p "$AGENTS/$label.plist" "$PART/LaunchAgents/$label.plist"
    else
      cle_say "提示：$AGENTS/$label.plist 不存在，记成没有"
    fi
  done

  cle_run "写 manifest.txt，再把 $PART 改名成 $FINAL" backup_finish
}

cle_main backup-current "$@"
