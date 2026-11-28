#!/bin/bash
# 用 C.le. 包替换当前的 超級碧琪.app。旧 App 不删，改名成 超級碧琪.app.cle-replaced-<stamp> 留在原目录，restore.sh 能直接改名回来。
# 用法：bash install-cle.sh [--yes]   （不带 --yes 只列计划，什么都不动）
# 先要有 backup-current.sh 做的完整备份；包怎么认见 lib.sh 的 cle_pkg_refusal（有 core 字段要 core=cle，老包看 channel）。
set -euo pipefail
CLE_HERE="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=lib.sh
. "$CLE_HERE/lib.sh"

install_stage() {
  local why
  rm -rf "$STAGE"
  "$DITTO" "$PKG" "$STAGE"
  why="$(cle_pkg_refusal "$STAGE/$CLE_BUILD_INFO_REL")"
  if [ -n "$why" ]; then
    printf '放进 %s 后 %s\n' "$STAGE" "$why" >&2
    exit 1
  fi
}

install_swap() {
  if [ -d "$APP" ]; then
    if [ -e "$REPLACED" ]; then printf '%s 已存在，不覆盖\n' "$REPLACED" >&2; exit 1; fi
    if ! mv "$APP" "$REPLACED"; then
      printf '挪不动 %s（App 或网关还在跑？先退出再来）\n' "$APP" >&2
      exit 1
    fi
  fi
  if ! mv "$STAGE" "$APP"; then
    if [ -d "$REPLACED" ] && [ ! -e "$APP" ]; then mv "$REPLACED" "$APP"; fi
    printf '新 App 放不进 %s，旧 App 已挪回原处\n' "$APP" >&2
    exit 1
  fi
  printf '%s\t%s\t%s\t%s\n' "$STAMP" "$REPLACED_REC" "$OLD_SIG" "$(cle_app_sig "$APP")" >> "$LATEST/installs.tsv"
}

cle_cmd_install_cle() {
  local present why
  LATEST="$(cle_latest_backup)"
  if [ -z "$LATEST" ]; then cle_problem "$BACKUP_DIR 下没有这个 App 的完整备份，先跑 backup-current.sh"; fi
  present="$(cle_manifest_get "$LATEST/manifest.txt" app.present)"
  if [ "$present" = 1 ] && [ ! -d "$LATEST/$CLE_APP_NAME" ]; then cle_problem "最新备份 $LATEST 不完整（记着有 App，却没拷到）"; fi
  cle_say "兜底备份：$LATEST"
  if [ ! -d "$PKG" ]; then cle_problem "找不到包 $PKG"; fi
  if [ ! -f "$PKG/$CLE_BUILD_INFO_REL" ]; then cle_problem "包里没有 $CLE_BUILD_INFO_REL，认不出 core / channel"; fi
  why="$(cle_pkg_refusal "$PKG/$CLE_BUILD_INFO_REL")"
  if [ -n "$why" ]; then cle_problem "$PKG 的 $why，不装"; fi
  if cle_app_running; then cle_problem "碧琪 App 正在运行，请先退出再装"; fi

  STAMP="$(cle_stamp)"
  STAGE="$APP_DIR/.$CLE_APP_NAME.cle-staging"
  REPLACED="$APP_DIR/$(cle_unique "$APP_DIR" "$CLE_APP_NAME.cle-replaced-$STAMP")"
  REPLACED_REC="-"
  OLD_SIG="-"
  if [ -d "$APP" ]; then
    REPLACED_REC="$REPLACED"
    OLD_SIG="$(cle_app_sig "$APP")"
  fi

  cle_run "检查签名：$CODESIGN --verify --deep $PKG" "$CODESIGN" --verify --deep "$PKG"
  if [ -e "$STAGE" ]; then cle_say "提示：上次留下的 $STAGE 会先清掉"; fi
  cle_run "把包拷进 $STAGE，再核一遍（$(cle_pkg_rule)）" install_stage
  if [ -d "$APP" ]; then
    cle_run "旧 App 改名成 $REPLACED 留着，新 App 放到 $APP，记进 $LATEST/installs.tsv" install_swap
  else
    cle_run "原来没有 App，新 App 放到 $APP，记进 $LATEST/installs.tsv" install_swap
  fi
  if [ "$CLE_YES" = 1 ]; then cle_say "要回到装之前：bash $CLE_HERE/restore.sh --yes"; fi
}

cle_main install-cle "$@"
