#!/usr/bin/env node
// M0 返工 L5a/L5b：在 CI 里把 PR 的 baseline.json、exceptions.json 和不量清单同 PR 的目标分支比。
// 棘轮测试只拿同一工作树里的 baseline.json 比，所以同时手改基线或例外就能放行；这里补上。
// - 目标分支基线里已有的数字：PR 基线一个都不许比它高；PR 基线也不许删掉目标分支有、而文件还在的键。
// - 目标分支基线里没有的数字（以前没量过的文件、节、指标）：不许高于用本 PR 的量法实测目标分支得到的值；
//   目标分支上不存在的文件按新文件上限算（行数 1500，其余 0）。
// - 合计必须等于逐文件之和。
// - exceptions.json 新增或抬高的条目一律让检查变红，并逐条列出，等协调者认可后再合并。
// - 不量清单（tools/health/third-party.json 和 skills/community-skills.json 登记的技能目录）不许盖住
//   目标分支基线里量过的文件；目标分支已有清单时，新增的条目同样变红并列出。
// - B38：目标分支在 PR 的 merge-base 之后又缩了某个文件（比如 main 缩了 learning.mjs），PR 没改这个文件、
//   基线里还是 merge-base 的数字，这不算 PR 抬高基线：只要不高于 merge-base 基线里的数字就只记一条说明。
//   PR 改过的文件、或者手改基线抬过 merge-base 的数字，照样变红。合计项按这些放过的差值放宽。
// 用法：node tools/health/compare-baseline.mjs --target <目标分支的工作树>
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {measure, repoFiles, UNMEASURED_LIST, unmeasuredPaths} from './measure.mjs';
import {compareLoadedLists, comparePatchLists, loadedPatchNames, patchApplyFileNames, readLoadedList, readPatchList} from './patch-list.mjs';
import {exceptionsByMetric, FILE_SECTIONS, injectionTotals, LINE_LIMIT, loadExceptions, readJson, TOTALS_OF, VERSION_SECTIONS} from './ratchet.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASELINE = 'tools/health/baseline.json', EXCEPTIONS = 'tools/health/exceptions.json';
const SKIP_KEYS = new Set(['tests', 'occurrences']);
const isNumber = value => Number.isSafeInteger(value);
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function leaves(object, prefix = [], out = new Map()) {
  for (const [key, value] of Object.entries(object ?? {})) {
    if (prefix.length === 0 && SKIP_KEYS.has(key)) continue;
    if (SKIP_KEYS.has(key) && key === 'occurrences') continue;
    if (plainObject(value)) leaves(value, [...prefix, key], out);
    else if (isNumber(value)) out.set(JSON.stringify([...prefix, key]), value);
  }
  return out;
}
const at = (object, keys) => keys.reduce((node, key) => node?.[key], object);
const label = keys => keys.join(' › ');

// 目标分支基线没有这个键时允许的最大值：用本 PR 的量法实测目标分支的值；目标分支上没有的文件按新文件上限。
function adoptedLimit(keys, targetMeasured) {
  const measured = at(targetMeasured, keys);
  if (isNumber(measured)) return measured;
  const [section, , metric] = keys;
  if (FILE_SECTIONS.includes(section) && keys.length === 3) return metric === 'lines' ? LINE_LIMIT : 0;
  return 0; // 新的超长文件、新的合计项等：目标分支量不到就不许有
}

// 基线里逐文件的键：injections / otherUi 的 [节, 文件, 指标]，longFiles 的 [longFiles, 文件]。
const fileOf = keys => (FILE_SECTIONS.includes(keys[0]) && keys.length === 3) || (keys[0] === 'longFiles' && keys.length === 2) ? keys[1] : null;
const isTotal = keys => keys.length === 2 && Object.values(TOTALS_OF).includes(keys[0]);

// mergeBaseBaseline / changedFiles（B38）：PR 相对 merge-base 的基线和改过的文件。两个都给了才按 merge-base 放宽，
// 缺一个就和以前一样逐项跟目标分支严格比。
export function compareBaselines({prBaseline, targetBaseline, targetMeasured, prMeasured,
  prExceptions, targetExceptions, prSkipped, targetSkipped, targetHasList, mergeBaseBaseline = null, changedFiles = null}) {
  const failures = [], notes = [];
  const pr = leaves(prBaseline), target = leaves(targetBaseline);
  const base = mergeBaseBaseline && changedFiles ? leaves(mergeBaseBaseline) : null;
  const changed = new Set(changedFiles ?? []);
  const slack = new Map(); // 合计项能放宽多少：「合计节\0指标」→ 放过的逐文件差值之和
  const totalsLater = [];

  for (const [key, value] of pr) {
    const keys = JSON.parse(key);
    if (target.has(key)) {
      const was = target.get(key);
      if (value <= was) continue;
      const file = fileOf(keys);
      // 目标分支在 merge-base 之后缩了这个文件，PR 没改它，基线也没高过 merge-base：不是 PR 抬的。
      if (base && file && !changed.has(file) && base.has(key) && value <= base.get(key)) {
        notes.push(`目标分支在 merge-base 之后缩了 PR 没改的文件，不算抬高：${label(keys)}（目标分支 ${was}，PR 基线 ${value}，merge-base ${base.get(key)}）。`);
        if (FILE_SECTIONS.includes(keys[0])) {
          // windowGlobals 合计是去重数，去重数减少不会超过逐文件之和的减少，所以同一份差值也能放宽它。
          const names = keys[2] === 'windowGlobals' ? ['windowGlobals', 'windowGlobalsPerFileSum'] : [keys[2]];
          for (const name of names) slack.set(`${TOTALS_OF[keys[0]]}\0${name}`, (slack.get(`${TOTALS_OF[keys[0]]}\0${name}`) ?? 0) + value - was);
        }
        continue;
      }
      if (base && isTotal(keys)) { totalsLater.push({key, keys, value, was}); continue; }
      failures.push(`基线被抬高：${label(keys)}（目标分支 ${was} → PR ${value}）。`);
    } else {
      const limit = adoptedLimit(keys, targetMeasured);
      if (value > limit) failures.push(`新补进基线的数字高于目标分支实测：${label(keys)}（目标分支实测 ${limit} → PR 基线 ${value}）。`);
    }
  }
  // 合计项只放宽上面放过的那部分逐文件差值；多出来的还是抬高。
  for (const {keys, value, was} of totalsLater) {
    const allowed = slack.get(`${keys[0]}\0${keys[1]}`) ?? 0;
    if (value > was + allowed) failures.push(`基线被抬高：${label(keys)}（目标分支 ${was} → PR ${value}${allowed ? `，其中 ${allowed} 是目标分支缩了 PR 没改的文件` : ''}）。`);
    else notes.push(`合计项高出目标分支的部分都来自目标分支缩了 PR 没改的文件，不算抬高：${label(keys)}（目标分支 ${was} → PR ${value}）。`);
  }
  for (const [key, value] of target) {
    if (pr.has(key)) continue;
    const keys = JSON.parse(key);
    const [section, file] = keys;
    // 文件删掉了、或者超长文件缩到 1500 行以内，键自然消失；其余删键等于把上限放宽成新文件上限。
    const gone = (FILE_SECTIONS.includes(section) && !prMeasured[section]?.[file])
      || (section === 'longFiles' && prMeasured.longFiles[file] === undefined);
    if (!gone) failures.push(`基线删掉了目标分支已有的键：${label(keys)}（目标分支 ${value}），文件还在，删掉等于放宽上限。`);
  }

  for (const section of FILE_SECTIONS) {
    const totals = prBaseline[TOTALS_OF[section]];
    if (!totals) continue;
    const rebuilt = injectionTotals(prBaseline[section] ?? {}, totals.windowGlobals);
    for (const name of Object.keys(rebuilt)) {
      if (totals[name] !== rebuilt[name]) failures.push(`${TOTALS_OF[section]}.${name} 不等于逐文件之和（基线写 ${totals[name]}，逐文件合计 ${rebuilt[name]}）。`);
    }
    if (totals.windowGlobals > totals.windowGlobalsPerFileSum) failures.push(`${TOTALS_OF[section]}.windowGlobals 大于逐文件之和。`);
  }
  for (const section of VERSION_SECTIONS) {
    const versions = prBaseline[section];
    if (versions && versions.total !== versions.occurrences?.length) failures.push(`${section}.total 与位置清单条数不一致。`);
  }

  const before = exceptionsByMetric(targetExceptions), after = exceptionsByMetric(prExceptions);
  for (const [key, value] of after) {
    const [file, metric] = key.split('\0');
    const old = before.get(key);
    if (old === undefined) failures.push(`exceptions.json 新增例外，需协调者逐条认可：${file} 的 ${metric} = ${value}。`);
    else if (value > old) failures.push(`exceptions.json 抬高例外，需协调者逐条认可：${file} 的 ${metric}（${old} → ${value}）。`);
    else if (value < old) notes.push(`例外降低：${file} 的 ${metric}（${old} → ${value}）。`);
  }
  for (const key of before.keys()) if (!after.has(key)) notes.push(`例外已删除：${key.replace('\0', ' 的 ')}。`);

  const measuredBefore = new Set([...FILE_SECTIONS.flatMap(section => Object.keys(targetBaseline[section] ?? {})),
    ...Object.keys(targetBaseline.longFiles ?? {})]);
  const targetEntries = new Set(targetSkipped);
  for (const entry of prSkipped) {
    const covered = [...measuredBefore].filter(file => entry.endsWith('/') ? file.startsWith(entry) : file === entry);
    if (covered.length) failures.push(`不量清单盖住了目标分支量过的文件：${entry}（${covered.slice(0, 5).join('、')}${covered.length > 5 ? ' 等' : ''}）。`);
    else if (targetHasList && !targetEntries.has(entry)) failures.push(`不量清单新增条目，需协调者认可：${entry}。`);
  }
  if (!targetHasList) notes.push(`目标分支还没有 ${UNMEASURED_LIST}（本 PR 首次引入）；只检查清单没有盖住目标分支量过的文件。`);
  for (const problem of targetMeasured.problems ?? []) notes.push(`目标分支有量不了的文件（不影响本检查）：${problem}`);
  return {failures, notes};
}

const git = (root, args) => {
  const run = spawnSync('git', ['-C', root, ...args], {encoding: 'utf8', maxBuffer: 1 << 28});
  return run.status === 0 ? run.stdout : null;
};

// B38：PR 工作树（HEAD 加上没提交的改动）相对 merge-base 改过的文件，和 merge-base 上的 baseline.json。
// 算不出来（浅克隆没有共同祖先、目标工作树不在同一个仓库、merge-base 上还没有基线）就两个都给 null，
// compareBaselines 照以前逐项跟目标分支严格比。
export function mergeBaseInfo(prRoot, targetRoot) {
  const none = why => ({mergeBaseBaseline: null, changedFiles: null, note: `没按 merge-base 放宽（${why}），逐项跟目标分支严格比。`});
  const targetHead = git(targetRoot, ['rev-parse', 'HEAD'])?.trim();
  if (!targetHead) return none('读不到目标工作树的 HEAD');
  const mergeBase = git(prRoot, ['merge-base', 'HEAD', targetHead])?.trim();
  if (!mergeBase) return none('算不出 PR 和目标分支的 merge-base，可能是浅克隆');
  const diffed = git(prRoot, ['diff', '--name-only', '--no-renames', '-z', mergeBase]);
  const untracked = git(prRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (diffed === null || untracked === null) return none('列不出 PR 改过的文件');
  const text = git(prRoot, ['show', `${mergeBase}:${BASELINE}`]);
  if (text === null) return none(`merge-base ${mergeBase.slice(0, 8)} 上没有 ${BASELINE}`);
  const changedFiles = [...new Set([...diffed.split('\0'), ...untracked.split('\0')].filter(Boolean))].sort();
  return {mergeBaseBaseline: JSON.parse(text.replace(/^﻿/, '')), changedFiles,
    note: `merge-base ${mergeBase.slice(0, 8)}，PR 改过 ${changedFiles.length} 个文件；目标分支在这之后缩了、PR 没改的文件不算 PR 抬高。`};
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--target') throw new Error('用法：node tools/health/compare-baseline.mjs --target <目标分支的工作树>');
  const targetRoot = path.resolve(args[1]);
  if (!fs.statSync(targetRoot, {throwIfNoEntry: false})?.isDirectory()) throw new Error(`目标分支工作树不存在：${targetRoot}`);
  const readOr = (root, file, fallback) => fs.existsSync(path.join(root, file)) ? readJson(path.join(root, file)) : fallback;
  repoFiles(targetRoot); // 早点发现目标工作树不是 git 仓库
  const {mergeBaseBaseline, changedFiles, note} = mergeBaseInfo(ROOT, targetRoot);
  console.log(`说明：${note}`);
  const result = compareBaselines({
    mergeBaseBaseline, changedFiles,
    prBaseline: readJson(path.join(ROOT, BASELINE)),
    targetBaseline: readOr(targetRoot, BASELINE, {injections: {}, longFiles: {}}),
    targetMeasured: await measure(targetRoot, {includeTestInventory: false, listRoot: ROOT, strict: false}),
    prMeasured: await measure(ROOT, {includeTestInventory: false}),
    prExceptions: loadExceptions(ROOT),
    targetExceptions: loadExceptions(targetRoot),
    prSkipped: unmeasuredPaths(ROOT),
    targetSkipped: fs.existsSync(path.join(targetRoot, UNMEASURED_LIST)) ? unmeasuredPaths(targetRoot) : [],
    targetHasList: fs.existsSync(path.join(targetRoot, UNMEASURED_LIST)),
  });
  // L78（PLAN 7.1-6）：补丁清单只许删、不许加，PR 改清单放行新补丁这条路在这里堵上。
  const patches = comparePatchLists({prList: readPatchList(ROOT), targetList: readPatchList(targetRoot),
    targetFiles: patchApplyFileNames(targetRoot, repoFiles(targetRoot))});
  result.failures.push(...patches.failures);
  result.notes.push(...patches.notes);
  // L86：加载名单（apply-all.mjs ORDER、apply-theme.sh、install.sh）登记同样只许删、不许加，换名字的新补丁也拦得住。
  const loaded = compareLoadedLists({prList: readLoadedList(ROOT), targetList: readLoadedList(targetRoot),
    targetNames: loadedPatchNames(targetRoot).names});
  result.failures.push(...loaded.failures);
  result.notes.push(...loaded.notes);
  for (const note of result.notes) console.log(`说明：${note}`);
  if (result.failures.length) {
    console.error(`代码体检基线对比没通过（和目标分支比）：\n- ${result.failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('代码体检基线对比通过：基线没有任何一项高于目标分支，例外和不量清单没有新增或抬高。');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
