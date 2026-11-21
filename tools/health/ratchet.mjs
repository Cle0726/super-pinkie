// Shared by the test and --write-baseline so updating the baseline cannot silently allow growth.
import fs from 'node:fs';

export const LINE_LIMIT = 1500;
export const SYNC_HINT = '数字变好了，请运行 `node tools/health/measure.mjs --write-baseline` 同步基线，并与本次改善一起提交。';

const LABEL = {
  important: '!important（强制覆盖）',
  lines: '行数',
  manualVersions: '手写版本号',
  mutationObservers: 'MutationObserver（变化观察器）',
  setIntervals: 'setInterval（定时器）',
  subtreeObserverCalls: '监听子树的 observe 调用',
  windowGlobals: 'window.__ 全局名',
};
const INJECTION_METRICS = Object.keys(LABEL).filter(key => key !== 'manualVersions');
const unionKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
const natural = value => Number.isSafeInteger(value) && value >= 0;

export function readJson(file) {
  // A UTF-8 BOM from a Windows editor isn't part of the JSON document.
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function exceptionsByMetric(entries) {
  if (!Array.isArray(entries)) throw new Error('tools/health/exceptions.json 必须是数组。');
  const byKey = new Map();
  for (const {file, metric, value, reason} of entries) {
    if (typeof file !== 'string' || !file.includes('/') || /[\\:\x00]|^(?:\/|\.\/)|(?:^|\/)\.\.(?:\/|$)/.test(file)
      || !Object.hasOwn(LABEL, metric) || !natural(value) || typeof reason !== 'string' || !reason.trim()) {
      throw new Error('例外必须有 file（仓库相对路径）、metric（检测项）、value（允许的整数值）和 reason（原因）。');
    }
    const key = `${file}\0${metric}`;
    if (byKey.has(key)) throw new Error(`例外重复：${file} 的 ${metric}。`);
    byKey.set(key, value);
  }
  return byKey;
}

function versionCounts(report) {
  const counts = new Map();
  for (const {file} of report.manualVersions.occurrences) counts.set(file, (counts.get(file) ?? 0) + 1);
  return counts;
}

export function healthChanges(current, baseline, exceptions = []) {
  const increases = [], decreases = [];
  const approved = exceptionsByMetric(exceptions);
  const allows = (file, metric, value) => approved.get(`${file}\0${metric}`) === value;

  function check(file, metric, actual, limit, hasBaseline) {
    if (!natural(limit)) throw new Error(`${file} 的基线缺少有效的 ${metric}。`);
    const from = `${file}：${LABEL[metric]}`;
    if (actual > limit && !allows(file, metric, actual)) {
      increases.push(`${from}增加（${hasBaseline ? '基线' : '新文件上限'} ${limit} → 当前 ${actual}）。`);
    } else if (hasBaseline && actual < limit) {
      decreases.push(`${from}减少（基线 ${limit} → 当前 ${actual}）。`);
    }
  }

  for (const file of unionKeys(current.injections, baseline.injections)) {
    const old = baseline.injections[file], now = current.injections[file];
    for (const metric of INJECTION_METRICS) {
      const limit = old ? old[metric] : metric === 'lines' ? LINE_LIMIT : 0;
      check(file, metric, now?.[metric] ?? 0, limit, Boolean(old));
    }
  }

  for (const file of unionKeys(current.longFiles, baseline.longFiles)) {
    if (current.injections[file] || baseline.injections[file]) continue; // already checked line by line above
    const old = baseline.longFiles[file], now = current.longFiles[file];
    if (now !== undefined) check(file, 'lines', now, old ?? LINE_LIMIT, old !== undefined);
    else decreases.push(`${file}：行数减少（基线 ${old} → 当前不超过 ${LINE_LIMIT} 行或文件已删除）。`);
  }

  const oldVersions = baseline.manualVersions.total, newVersions = current.manualVersions.total;
  if (!natural(oldVersions) || oldVersions !== baseline.manualVersions.occurrences.length) {
    throw new Error('手写版本号基线总数与位置清单不一致。');
  }
  if (newVersions > oldVersions) {
    const before = versionCounts(baseline), after = versionCounts(current);
    let approvedGrowth = 0;
    const growing = [];
    for (const file of [...after.keys()].sort()) {
      const old = before.get(file) ?? 0, now = after.get(file);
      if (now <= old) continue;
      if (allows(file, 'manualVersions', now)) approvedGrowth += now - old;
      else growing.push(`${file}（${old} → ${now}）`);
    }
    if (newVersions - approvedGrowth > oldVersions) {
      increases.push(`手写版本号总数增加（基线 ${oldVersions} → 当前 ${newVersions}）。增加的文件：${growing.join('、')}。`);
    }
  } else if (newVersions < oldVersions) {
    decreases.push(`手写版本号总数减少（基线 ${oldVersions} → 当前 ${newVersions}）。`);
  }
  return {increases, decreases};
}
