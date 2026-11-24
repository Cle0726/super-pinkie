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
// 用法：node tools/health/compare-baseline.mjs --target <目标分支的工作树>
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {measure, repoFiles, UNMEASURED_LIST, unmeasuredPaths} from './measure.mjs';
import {exceptionsByMetric, FILE_SECTIONS, injectionTotals, LINE_LIMIT, readJson, TOTALS_OF, VERSION_SECTIONS} from './ratchet.mjs';

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

export function compareBaselines({prBaseline, targetBaseline, targetMeasured, prMeasured,
  prExceptions, targetExceptions, prSkipped, targetSkipped, targetHasList}) {
  const failures = [], notes = [];
  const pr = leaves(prBaseline), target = leaves(targetBaseline);

  for (const [key, value] of pr) {
    const keys = JSON.parse(key);
    if (target.has(key)) {
      if (value > target.get(key)) failures.push(`基线被抬高：${label(keys)}（目标分支 ${target.get(key)} → PR ${value}）。`);
    } else {
      const limit = adoptedLimit(keys, targetMeasured);
      if (value > limit) failures.push(`新补进基线的数字高于目标分支实测：${label(keys)}（目标分支实测 ${limit} → PR 基线 ${value}）。`);
    }
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

async function main(args) {
  if (args.length !== 2 || args[0] !== '--target') throw new Error('用法：node tools/health/compare-baseline.mjs --target <目标分支的工作树>');
  const targetRoot = path.resolve(args[1]);
  if (!fs.statSync(targetRoot, {throwIfNoEntry: false})?.isDirectory()) throw new Error(`目标分支工作树不存在：${targetRoot}`);
  const readOr = (root, file, fallback) => fs.existsSync(path.join(root, file)) ? readJson(path.join(root, file)) : fallback;
  repoFiles(targetRoot); // 早点发现目标工作树不是 git 仓库
  const result = compareBaselines({
    prBaseline: readJson(path.join(ROOT, BASELINE)),
    targetBaseline: readOr(targetRoot, BASELINE, {injections: {}, longFiles: {}}),
    targetMeasured: await measure(targetRoot, {includeTestInventory: false, listRoot: ROOT, strict: false}),
    prMeasured: await measure(ROOT, {includeTestInventory: false}),
    prExceptions: readOr(ROOT, EXCEPTIONS, []),
    targetExceptions: readOr(targetRoot, EXCEPTIONS, []),
    prSkipped: unmeasuredPaths(ROOT),
    targetSkipped: fs.existsSync(path.join(targetRoot, UNMEASURED_LIST)) ? unmeasuredPaths(targetRoot) : [],
    targetHasList: fs.existsSync(path.join(targetRoot, UNMEASURED_LIST)),
  });
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
