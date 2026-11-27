// L78（PLAN 7.1-6）：从现在起改内核行为一律去 cle-core 改、发新的内核小版本，碧琪只更新 core-manifest.json
// 里的版本号，不再新增补丁。tools/health/patch-files.json 按名字登记现有的 patch/apply-*.mjs，只许删、不许加：
// - 棘轮测试（tests/code-health-ratchet.test.mjs）：工作树里多出清单里没有的补丁就红；清单里有、文件已经删了也红，
//   提示从清单里删掉这一行，所以清单只会变短。
// - compare-baseline.mjs：PR 的清单不许比目标分支的清单多出名字，「加补丁 + 顺手登记进清单」照样红；
//   目标分支还没有清单时（本 PR 首次引入），清单里的名字必须都是目标分支上已经有的补丁文件。
// 按名字而不是按个数，删一个再加一个、个数不变也拦得住。判定哪些文件算补丁只有这里一处：measure.mjs 里
// baseline.json 的 patchApplyFiles 也用它数，二者不会各数各的。apply-all.mjs 是总入口，照旧算在内。
import fs from 'node:fs';
import path from 'node:path';
import {readJson} from './ratchet.mjs';

export const PATCH_LIST = 'tools/health/patch-files.json';
const PATCH_FILE = /^patch\/apply-[^/]*\.mjs$/;
const GO_TO_CORE = '改内核行为一律去 cle-core 改、发新的内核小版本，碧琪只更新 core-manifest.json 里的版本号';

// files：仓库相对路径（measure.mjs 的 repoFiles）。只数 patch/ 顶层的普通文件，符号链接和目录不算。
export function patchApplyFileNames(root, files) {
  return files.filter(file => PATCH_FILE.test(file) && fs.lstatSync(path.join(root, file), {throwIfNoEntry: false})?.isFile()).sort();
}

// 没有清单返回 null（目标分支在本 PR 之前）；有清单但格式不对直接报错，不静默放行。
export function readPatchList(root) {
  const file = path.join(root, PATCH_LIST);
  if (!fs.existsSync(file)) return null;
  const files = readJson(file)?.files;
  if (!Array.isArray(files) || files.some(name => typeof name !== 'string' || !PATCH_FILE.test(name))) {
    throw new Error(`${PATCH_LIST} 的 files 必须是 patch/apply-*.mjs 路径的数组。`);
  }
  const seen = new Set();
  for (const name of files) {
    if (seen.has(name)) throw new Error(`${PATCH_LIST} 里重复登记：${name}。`);
    seen.add(name);
  }
  return files;
}

// 棘轮：current 是工作树里实际的补丁文件，allowed 是清单。
export function patchListChanges(current, allowed) {
  const have = new Set(current), listed = new Set(allowed ?? []);
  if (allowed === null) return {added: [`缺少 ${PATCH_LIST}：补丁清单只许删、不许加，不能整个去掉。`], removed: []};
  return {
    added: current.filter(file => !listed.has(file)).map(file =>
      `${file}：新增了内核补丁。${GO_TO_CORE}；不要把它登记进 ${PATCH_LIST}。`),
    removed: allowed.filter(file => !have.has(file)).map(file =>
      `${file}：补丁文件已经删了，请从 ${PATCH_LIST} 删掉这一行（清单只许变短）。`),
  };
}

// CI 和目标分支比：PR 清单里的每个名字，目标分支的清单里都要有；目标分支还没有清单时，目标分支上要真有这个补丁文件。
export function comparePatchLists({prList, targetList, targetFiles}) {
  const failures = [], notes = [];
  if (prList === null) {
    if (targetList !== null) failures.push(`PR 删掉了 ${PATCH_LIST}：补丁清单只许删条目，不能整个去掉。`);
    return {failures, notes};
  }
  const allowed = new Set(targetList ?? targetFiles);
  for (const file of prList) {
    if (allowed.has(file)) continue;
    failures.push(targetList === null
      ? `${PATCH_LIST} 登记了目标分支上没有的补丁：${file}。${GO_TO_CORE}。`
      : `${PATCH_LIST} 新增登记：${file}。补丁清单只许删、不许加；${GO_TO_CORE}。`);
  }
  if (targetList === null) notes.push(`目标分支还没有 ${PATCH_LIST}（本 PR 首次引入）；只检查清单里的名字都是目标分支上已有的补丁文件。`);
  const removed = (targetList ?? []).filter(file => !prList.includes(file));
  if (removed.length) notes.push(`补丁清单减少：${removed.join('、')}。`);
  return {failures, notes};
}
