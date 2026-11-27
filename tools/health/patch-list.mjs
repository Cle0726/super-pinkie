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

// L86：上面只按 patch/apply-*.mjs 的文件名登记，但真正决定「打哪些补丁」的是加载名单——apply-all.mjs 的 ORDER、
// installer/macos/apply-theme.sh、install.sh。名单里本来就有不叫 apply-*.mjs 的 reapply-unrestricted-patch.mjs，
// 换个名字（不叫 apply-*、放进 patch/ 子目录、改成 .js）的新补丁照样能被名单加载，绕过上面的检查。所以
// patch-files.json 的 loaded 再按名字登记加载名单里出现的全部补丁，同样只减不增：
// - 棘轮测试：名单里出现 loaded 没登记的名字就红；名单删掉一项是绿的（loaded 里没人加载的旧名字不拦，K5 一起清）。
// - compare-baseline.mjs：PR 的 loaded 不许比目标分支的 loaded 多出名字；目标分支还没有 loaded 时（本 PR 首次引入），
//   名字必须是从目标分支加载名单里读得出来的。
export const LOAD_LISTS = Object.freeze([
  {file: 'patch/apply-all.mjs', kind: 'order'},
  {file: 'installer/macos/apply-theme.sh', kind: 'path'},
  {file: 'install.sh', kind: 'path'},
]);
const LOADED_NAME = /^patch\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[cm]?js$/;
// 脚本里的 patch/<名字>.mjs（含子目录、反斜杠）；mypatch/ 之类不算。
const PATH_REF = /(?<![A-Za-z0-9_.-])patch[/\\]((?:[A-Za-z0-9_.-]+[/\\])*[A-Za-z0-9_.-]+\.[cm]?js)(?![A-Za-z0-9_])/g;
const QUOTED = /(['"`])([^'"`\n]*)\1/g;
const ORDER_BLOCK = /\bconst\s+ORDER\s*=\s*\[([\s\S]*?)\]/;

function loadedName(file, ref) {
  const name = path.posix.normalize(`patch/${ref.replace(/\\/g, '/').replace(/^\.\//, '')}`);
  if (!LOADED_NAME.test(name)) throw new Error(`${file} 的加载名单里有看不懂的补丁路径：${ref}。加载名单检查不能静默放行。`);
  return name;
}

// 从一份加载名单的文本里读出它加载的补丁（patch/ 开头的仓库相对路径，去重排序）。
export function loadListEntries({file, kind}, text) {
  const source = text.replace(/^\uFEFF/, '');
  let refs;
  if (kind === 'order') {
    const block = ORDER_BLOCK.exec(source)?.[1];
    if (block === undefined) throw new Error(`${file} 里找不到 const ORDER = [...]，加载名单检查不能静默放行。`);
    const body = block.replace(/\/\/[^\n]*/g, '');
    refs = [...body.matchAll(QUOTED)].map(match => match[2]);
    if (body.replace(QUOTED, '').replace(/[\s,]/g, '')) throw new Error(`${file} 的 ORDER 里只能写补丁名的字符串字面量。`);
  } else {
    refs = [...source.matchAll(PATH_REF)].map(match => match[1]);
  }
  return [...new Set(refs.map(ref => loadedName(file, ref)))].sort();
}

// 工作树里各加载名单实际加载的补丁。名单文件不在了就跳过（整份名单删掉只会让加载的补丁变少）。
export function loadedPatchNames(root) {
  const byFile = {};
  for (const list of LOAD_LISTS) {
    const file = path.join(root, list.file);
    if (!fs.lstatSync(file, {throwIfNoEntry: false})?.isFile()) continue;
    byFile[list.file] = loadListEntries(list, fs.readFileSync(file, 'utf8'));
  }
  return {byFile, names: [...new Set(Object.values(byFile).flat())].sort()};
}

// 没有清单、或清单里还没有 loaded 返回 null；格式不对直接报错。
export function readLoadedList(root) {
  const file = path.join(root, PATCH_LIST);
  if (!fs.existsSync(file)) return null;
  const loaded = readJson(file)?.loaded;
  if (loaded === undefined) return null;
  if (!Array.isArray(loaded) || loaded.some(name => typeof name !== 'string' || !LOADED_NAME.test(name))) {
    throw new Error(`${PATCH_LIST} 的 loaded 必须是 patch/ 下补丁路径的数组。`);
  }
  const seen = new Set();
  for (const name of loaded) {
    if (seen.has(name)) throw new Error(`${PATCH_LIST} 的 loaded 里重复登记：${name}。`);
    seen.add(name);
  }
  return loaded;
}

// 棘轮：current 是 loadedPatchNames 的结果，allowed 是 loaded。名单里多出没登记的名字就红；
// 名单删掉一项是绿的（任务要求「删名单项绿」），loaded 里已经没人加载的名字只作说明，提示顺手删掉那一行。
export function loadedListChanges({byFile, names}, allowed) {
  if (allowed === null) return {added: [`${PATCH_LIST} 缺少 loaded：加载名单只许删、不许加，不能整个去掉。`], unused: []};
  const listed = new Set(allowed), have = new Set(names);
  const where = name => Object.keys(byFile).filter(file => byFile[file].includes(name)).join('、');
  return {
    added: names.filter(name => !listed.has(name)).map(name =>
      `${where(name)} 加载了没登记的补丁 ${name}。${GO_TO_CORE}；不要把它登记进 ${PATCH_LIST} 的 loaded。`),
    unused: allowed.filter(name => !have.has(name)).map(name =>
      `${name}：加载名单里已经没有它了，可以从 ${PATCH_LIST} 的 loaded 删掉这一行。`),
  };
}

// CI 和目标分支比：PR 的 loaded 里每个名字，目标分支的 loaded 里都要有；目标分支还没有 loaded 时，要在目标分支的加载名单里。
export function compareLoadedLists({prList, targetList, targetNames}) {
  const failures = [], notes = [];
  if (prList === null) {
    if (targetList !== null) failures.push(`PR 删掉了 ${PATCH_LIST} 的 loaded：加载名单登记只许删条目，不能整个去掉。`);
    return {failures, notes};
  }
  const allowed = new Set(targetList ?? targetNames);
  for (const name of prList) {
    if (allowed.has(name)) continue;
    failures.push(targetList === null
      ? `${PATCH_LIST} 的 loaded 登记了目标分支加载名单里没有的补丁：${name}。${GO_TO_CORE}。`
      : `${PATCH_LIST} 的 loaded 新增登记：${name}。加载名单只许删、不许加；${GO_TO_CORE}。`);
  }
  if (targetList === null) notes.push(`目标分支还没有 ${PATCH_LIST} 的 loaded（本 PR 首次引入）；只检查登记的名字都在目标分支的加载名单里。`);
  const removed = (targetList ?? []).filter(name => !prList.includes(name));
  if (removed.length) notes.push(`加载名单登记减少：${removed.join('、')}。`);
  return {failures, notes};
}
