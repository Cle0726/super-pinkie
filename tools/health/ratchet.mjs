// Shared by the test, --write-baseline, --adopt-unmeasured and compare-baseline.mjs so that
// updating the baseline cannot silently allow growth.
import fs from 'node:fs';
import path from 'node:path';

export const LINE_LIMIT = 1500;
export const SYNC_HINT = '数字变好了，请运行 `node tools/health/measure.mjs --write-baseline` 同步基线，并与本次改善一起提交。';
// 逐文件记指标的两节：injections 是 2026-11 以前就量的注入文件；otherUi 是以前没量过的 UI 手写文件
// （ui/party、ui/roundtable 等页面，以及放在 vendor 目录或 laolao-vendor-* 名下的手写文件），单独合计，
// 不并进 injections 的旧数字。
export const FILE_SECTIONS = ['injections', 'otherUi'];
export const TOTALS_OF = {injections: 'injectionTotals', otherUi: 'otherUiTotals'};
// 手写版本号：manualVersions 是旧口径（头部、注入、runtime、两个工具）；pageVersions 是其他 UI 文件里的。
export const VERSION_SECTIONS = ['manualVersions', 'pageVersions'];

const LABEL = {
  important: '!important（强制覆盖）',
  lines: '行数',
  manualVersions: '手写版本号',
  pageVersions: '其他 UI 文件里的手写版本号',
  mutationObservers: 'MutationObserver（变化观察器）',
  setIntervals: 'setInterval（定时器）',
  subtreeObserverCalls: '监听子树的 observe 调用',
  windowGlobals: 'window.__ 全局名',
  // L4：绕开上面字面写法的变体（tools/health/patterns.mjs），各自单独计数、不并进上面的旧数字。
  importantIndirect: '绕开字面的 !important（注释拆开、转义、setProperty(..., "important")）',
  mutationObserverRefs: '不以 new MutationObserver 字面出现的观察器引用',
  observeUnclear: '看不出是否监听子树的 observe 调用（选项是变量、展开或 call/apply）',
  setIntervalRefs: '不以 setInterval( 字面出现的定时器引用',
  windowGlobalsIndirect: '绕开 window.__x = 的全局名（globalThis、方括号、||=、defineProperty 等）',
};
export const INJECTION_METRICS = Object.keys(LABEL).filter(key => !VERSION_SECTIONS.includes(key));
const SUMMED = INJECTION_METRICS.filter(key => key !== 'lines' && key !== 'windowGlobals');
const EMPTY_VERSIONS = {occurrences: [], total: 0};
const unionKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
const natural = value => Number.isSafeInteger(value) && value >= 0;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const newFileLimit = metric => metric === 'lines' ? LINE_LIMIT : 0;

// 总表：各指标按文件求和；windowGlobals 是这一节去重后的名字数，另记逐文件之和。
export function injectionTotals(files, uniqueGlobals) {
  const totals = Object.fromEntries(SUMMED.map(key => [key, 0]));
  totals.windowGlobals = uniqueGlobals;
  totals.windowGlobalsPerFileSum = 0;
  for (const metrics of Object.values(files)) {
    for (const key of SUMMED) totals[key] += metrics[key] ?? 0;
    totals.windowGlobalsPerFileSum += metrics.windowGlobals ?? 0;
  }
  return totals;
}

export function readJson(file) {
  // A UTF-8 BOM from a Windows editor isn't part of the JSON document.
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

// 例外分两层，免得同时开着的界面 PR 都去改 exceptions.json 同一条的 value / reason 而互相冲突：
// - tools/health/exceptions.json：基础条目（数组，{file, metric, value, reason}），和以前一样；
// - tools/health/exceptions.d/*.json：每个 PR 自己一个文件（数组，{file, metric, add, reason}），
//   只能给 exceptions.json 里已有的同一条 file + metric 加数（add 是正整数）。
// 生效值 = value + 所有 add 之和，原因拼在后面；ratchet、--write-baseline 和 CI 的目标分支对比都只看生效值，
// 所以「抬高例外要协调者认可」照旧，「只允许准确计数」「没用到要删」也照旧按生效值算。
// 两个 PR 各加 2 行：各自分支上各自的文件，合并后 add 相加，正好等于两边都合进来的实测值。
export const EXCEPTIONS_FILE = 'tools/health/exceptions.json';
export const EXCEPTION_DELTAS_DIR = 'tools/health/exceptions.d';
export function loadExceptions(root) {
  const base = path.join(root, EXCEPTIONS_FILE);
  const entries = fs.existsSync(base) ? readJson(base) : [];
  if (!Array.isArray(entries)) throw new Error(`${EXCEPTIONS_FILE} 必须是数组。`);
  const dir = path.join(root, EXCEPTION_DELTAS_DIR);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort() : [];
  if (!names.length) return entries;
  const merged = entries.map(entry => ({...entry}));
  const byKey = new Map(merged.map(entry => [`${entry.file}\0${entry.metric}`, entry]));
  for (const name of names) {
    const deltas = readJson(path.join(dir, name));
    if (!Array.isArray(deltas)) throw new Error(`${EXCEPTION_DELTAS_DIR}/${name} 必须是数组。`);
    for (const delta of deltas) {
      const {file, metric, add, reason} = delta ?? {};
      if (!Number.isSafeInteger(add) || add <= 0 || typeof reason !== 'string' || !reason.trim()) {
        throw new Error(`${EXCEPTION_DELTAS_DIR}/${name}：每条要有 file、metric、add（正整数）和 reason。`);
      }
      const target = byKey.get(`${file}\0${metric}`);
      if (!target) throw new Error(`${EXCEPTION_DELTAS_DIR}/${name}：${file} 的 ${metric} 在 ${EXCEPTIONS_FILE} 里没有基础条目；新例外要写进 ${EXCEPTIONS_FILE}。`);
      target.value += add;
      target.reason = `${target.reason} ${reason.trim()}（${name}，+${add}）`;
      target.deltas = [...(target.deltas ?? []), {name, add}];   // 「没被用到」时告诉人改哪几个文件
    }
  }
  return merged;
}

export function exceptionsByMetric(entries) {
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

function versionCounts(section) {
  const counts = new Map();
  for (const {file} of section.occurrences) counts.set(file, (counts.get(file) ?? 0) + 1);
  return counts;
}

export function healthChanges(current, baseline, exceptions = []) {
  const increases = [], decreases = [];
  const approved = exceptionsByMetric(exceptions);
  const used = new Set();
  const allows = (file, metric, value) => {
    const key = `${file}\0${metric}`;
    if (approved.get(key) !== value) return false;
    used.add(key);
    return true;
  };

  function check(file, metric, actual, limit, hasBaseline) {
    if (!natural(limit)) throw new Error(`${file} 的基线缺少有效的 ${metric}。`);
    const from = `${file}：${LABEL[metric]}`;
    if (actual > limit && !allows(file, metric, actual)) {
      increases.push(`${from}增加（${hasBaseline ? '基线' : '新文件上限'} ${limit} → 当前 ${actual}）。`);
    } else if (hasBaseline && actual < limit) {
      decreases.push(`${from}减少（基线 ${limit} → 当前 ${actual}）。`);
    }
  }

  for (const section of FILE_SECTIONS) {
    const before = baseline[section] ?? {}, after = current[section] ?? {};
    for (const file of unionKeys(after, before)) {
      const old = before[file], now = after[file];
      for (const metric of INJECTION_METRICS) {
        // 基线里没有这一项（文件或指标以前没量过）按新文件上限算：行数 1500，其余 0。
        const measured = old !== undefined && Object.hasOwn(old, metric);
        check(file, metric, now?.[metric] ?? 0, measured ? old[metric] : newFileLimit(metric), measured);
      }
    }
  }

  const perFile = file => FILE_SECTIONS.some(section => current[section]?.[file] || baseline[section]?.[file]);
  for (const file of unionKeys(current.longFiles, baseline.longFiles)) {
    if (perFile(file)) continue; // already checked line by line above
    const old = baseline.longFiles[file], now = current.longFiles[file];
    if (now !== undefined) check(file, 'lines', now, old ?? LINE_LIMIT, old !== undefined);
    else decreases.push(`${file}：行数减少（基线 ${old} → 当前不超过 ${LINE_LIMIT} 行或文件已删除）。`);
  }

  for (const section of VERSION_SECTIONS) {
    const old = baseline[section] ?? EMPTY_VERSIONS, now = current[section] ?? EMPTY_VERSIONS;
    if (!natural(old.total) || old.total !== old.occurrences?.length) throw new Error(`${section} 基线总数与位置清单不一致。`);
    if (now.total > old.total) {
      const before = versionCounts(old), after = versionCounts(now);
      let approvedGrowth = 0;
      const growing = [];
      for (const file of [...after.keys()].sort()) {
        const was = before.get(file) ?? 0, count = after.get(file);
        if (count <= was) continue;
        if (allows(file, section, count)) approvedGrowth += count - was;
        else growing.push(`${file}（${was} → ${count}）`);
      }
      if (now.total - approvedGrowth > old.total) {
        increases.push(`${LABEL[section]}总数增加（基线 ${old.total} → 当前 ${now.total}）。增加的文件：${growing.join('、')}。`);
      }
    } else if (now.total < old.total) {
      decreases.push(`${LABEL[section]}总数减少（基线 ${old.total} → 当前 ${now.total}）。`);
    }
  }
  // An exception nothing needs is a dormant pass for future growth: report it.
  const deltasOf = new Map(exceptions.map(entry => [`${entry.file}\0${entry.metric}`, entry.deltas ?? []]));
  const unused = [...approved.keys()].filter(key => !used.has(key)).sort().map(key => {
    const [file, metric] = key.split('\0');
    const deltas = deltasOf.get(key) ?? [];
    if (!deltas.length) return `${file}：${LABEL[metric]} 的例外（value ${approved.get(key)}）没有被用到，请从 tools/health/exceptions.json 删除。`;
    // 生效值里有增量：先动增量文件（各 PR 自己的），增量都删完还多再改 exceptions.json 的基础值，免得又去改那条大家共用的数字。
    const parts = deltas.map(({name, add}) => `${EXCEPTION_DELTAS_DIR}/${name} +${add}`).join('、');
    const baseValue = approved.get(key) - deltas.reduce((sum, {add}) => sum + add, 0);
    return `${file}：${LABEL[metric]} 的例外（生效值 ${approved.get(key)} = ${EXCEPTIONS_FILE} 的基础值 ${baseValue} + ${parts}）没有被用到：先减小或删掉 ${EXCEPTION_DELTAS_DIR} 里对应的增量文件；增量都删完还多，再改 ${EXCEPTIONS_FILE} 的基础值（实际值等于基线时整条删掉）。`;
  });
  return {increases, decreases, unused};
}

// --write-baseline: keep every number at min(baseline, current). Growth covered by
// an exception is NOT written (the exception keeps allowing it), and files the
// baseline never measured get the new-file limit at most, so nothing ever rises.
export function syncBaseline(current, baseline) {
  const synced = {};
  for (const section of FILE_SECTIONS) {
    const before = baseline[section] ?? {}, files = {};
    for (const file of Object.keys(current[section] ?? {}).sort()) {
      const old = before[file], now = current[section][file];
      files[file] = Object.fromEntries(INJECTION_METRICS.map(metric => {
        const limit = old && Object.hasOwn(old, metric) ? old[metric] : newFileLimit(metric);
        return [metric, Math.min(now[metric] ?? 0, limit)];
      }));
    }
    synced[section] = files;
    const key = TOTALS_OF[section], oldTotals = baseline[key] ?? {};
    const perFileSum = Object.values(files).reduce((sum, metrics) => sum + metrics.windowGlobals, 0);
    const unique = Math.min(current[key]?.windowGlobals ?? perFileSum, oldTotals.windowGlobals ?? Infinity, perFileSum);
    const totals = injectionTotals(files, unique);
    for (const name of Object.keys(totals)) if (natural(oldTotals[name])) totals[name] = Math.min(totals[name], oldTotals[name]);
    synced[key] = totals;
  }
  synced.longFiles = {};
  for (const file of Object.keys(current.longFiles).sort()) {
    const section = FILE_SECTIONS.find(name => synced[name][file]);
    if (section) {
      if (synced[section][file].lines > LINE_LIMIT) synced.longFiles[file] = synced[section][file].lines;
    } else if (baseline.longFiles[file] !== undefined) {
      synced.longFiles[file] = Math.min(current.longFiles[file], baseline.longFiles[file]);
    }
  }
  for (const section of VERSION_SECTIONS) {
    const old = baseline[section], now = current[section] ?? EMPTY_VERSIONS;
    synced[section] = old === undefined ? (now.total === 0 ? now : EMPTY_VERSIONS) : now.total <= old.total ? now : old;
  }
  synced.patchApplyFiles = Math.min(current.patchApplyFiles, baseline.patchApplyFiles ?? current.patchApplyFiles);
  // The test inventory is informational and not ratcheted; keep the recorded
  // snapshot so a sync never makes any existing number in the file go up.
  if (baseline.tests !== undefined) synced.tests = baseline.tests;
  return synced;
}

// --adopt-unmeasured：只把基线里还没有的键（以前没量过的文件、节和指标）按当前值补进去，
// 已有的键一个都不动（棘轮照样拿已有的数字比）。补进来的数字由 compare-baseline.mjs 在 CI 里
// 和目标分支用同一套量法实测的值比，所以不能借它放行本次新增的问题。
export function adoptUnmeasured(current, baseline) {
  const fill = (old, now) => {
    if (old === undefined) return now;
    if (!plainObject(old) || !plainObject(now)) return old;
    const out = {...old};
    for (const key of Object.keys(now)) out[key] = fill(old[key], now[key]);
    return out;
  };
  const adopted = fill(baseline, current);
  if (baseline.tests === undefined) delete adopted.tests; // informational, never adopted
  return adopted;
}
