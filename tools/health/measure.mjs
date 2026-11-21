#!/usr/bin/env node
// M0 口径（静态源码盘点，不执行产品代码）：
// - 递归读取 ui/injections 中的 UTF-8 文本。跳过符号链接、vendor/、third-party/、
//   laolao-vendor-* 和 laolao-katex/，以及生成物目录（build、dist、node_modules 等）。
// - CRLF/LF 都算一个换行，末尾换行不多算一行。统计源码拼写（含注释/字符串）：
//   !important、new MutationObserver、setInterval(；分别数 .observe(...) 的字面
//   subtree: true / subtree: !0 调用点（同一观察器可有多个调用点），不含 getAnimations。
//   window.__NAME 仅数直接的 '=' 左值，不含比较/复合赋值；文件内去重，总表按全仓去重。
// - 版本号数的是维护位置而非不同版本值。数头部及注入 JS/CSS、两个 Python 工具里每处
//   字面 ?v=/&v=（含替换/核对用的旧值）；?v=${CONST} 数同文件的字面常量声明一次。
//   runtime 仅数 chat-page-*.js 引用的手写 v；不数 @hash 占位、动态值和生成的 &h=。
//   位置是值首字符的 1 基行列，列用 JS 字符串的 UTF-16 单元计。
// - 巨文件扫描 ui/injections、services、app、desktop/macos、tools、patch、installer。
//   只数源码/脚本/模板扩展名（见 SOURCE_FILE），不把文本数据、报告和二进制当源码；
//   ui/runtime 和 desktop/windows/mac-runtime 不在扫描根内。
// - 补丁仅数 patch/ 顶层 apply-*.mjs。测试分别数门禁的 tests/*.test.{cjs,mjs}、
//   Python *_test.py 和其他 *.test.{js,py}；浏览器数是匹配指定拼写的文件数，不是运行结果。
// - 读取工作树（含新文件），只输出相对路径、排序后的键和 LF JSON，无机器/时间信息。
import {isUtf8} from 'node:buffer';
import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {healthChanges, LINE_LIMIT, readJson} from './ratchet.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HEAD = 'ui/injections/laolao-head.fragment.html';
const SCAN_ROOTS = ['ui/injections', 'services', 'app', 'desktop/macos', 'tools', 'patch', 'installer'];
const VERSION_TOOLS = ['tools/claude-deploy/deploy-work-first.py', 'tools/ui-parity/bundle.py'];
const EXCLUDED_DIR = /^(?:\.git|\.build|build|dist|node_modules|__pycache__|\.venv|vendor|third[-_]?party|laolao-katex)$/i;
const SOURCE_FILE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx|css|scss|html?|pyw?|swift|[zba]?sh|bash|ps[dm]?1|bat|cmd|c|cc|cpp|h|hpp|m|mm|go|rs|rb|lua|sql|patch|diff|plist(?:\.in)?)$/i;
const VERSION_QUERY = /[?&]v=([a-z0-9_][a-z0-9._%+-]*)(?=$|[\s"'`&)>#\\;])/gid;
const OBSERVE_OPTIONS = /\.\s*observe\s*\([^;{}]*?,\s*\{([^{}]*)\}\s*\)/g;
const SUBTREE_OPTION = /(?:^|,)\s*(?:subtree|['"]subtree['"])\s*:\s*(?:true|!\s*0)\s*(?=,|$)/;

function* files(root, dir, recursive = true) {
  if (!fs.lstatSync(path.join(root, dir), {throwIfNoEntry: false})?.isDirectory()) return;
  for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
    if (entry.name.startsWith('laolao-vendor-')) continue;
    const relative = `${dir}/${entry.name}`;
    if (entry.isFile()) yield relative;
    else if (entry.isDirectory() && recursive && !EXCLUDED_DIR.test(entry.name)
      && !(dir === 'tools/study-desk' && entry.name.startsWith('isolated-'))) yield* files(root, relative);
  }
}

async function readSource(root, file) {
  const bytes = await readFile(path.join(root, file));
  if (bytes.includes(0) || !isUtf8(bytes)) return null;
  return bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

async function scanSources(root, filenames, consume) {
  // Bounded parallel reads keep a cold Windows checkout from serializing each
  // disk open without keeping the whole source tree in memory.
  const batch = 16;
  for (let i = 0; i < filenames.length; i += batch) {
    const group = filenames.slice(i, i + batch);
    const sources = await Promise.all(group.map(file => readSource(root, file)));
    for (const [index, file] of group.entries()) if (sources[index] !== null) consume(file, sources[index]);
  }
}

const count = (text, pattern) => [...text.matchAll(pattern)].length;
function lines(text) {
  let total = Number(text.length > 0 && !text.endsWith('\n'));
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) total++;
  return total;
}
const alphabetical = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function injectionMetrics(text, globals) {
  const names = new Set([...text.matchAll(/\bwindow\s*\.\s*(__[\p{ID_Continue}$]+)\s*=(?!=|>)/gu)].map(m => m[1]));
  for (const name of names) globals.add(name);
  return {
    important: count(text, /!\s*important\b/gi),
    lines: lines(text),
    mutationObservers: count(text, /\bnew\s+MutationObserver(?![$\p{ID_Continue}])/gu),
    setIntervals: count(text, /\bsetInterval\s*\(/g),
    subtreeObserverCalls: [...text.matchAll(OBSERVE_OPTIONS)].filter(m => SUBTREE_OPTION.test(m[1])).length,
    windowGlobals: names.size,
  };
}

function versionLocations(file, text, source) {
  const matches = [];
  function collectQueries(fragment, offset = 0) {
    for (const m of fragment.matchAll(VERSION_QUERY)) matches.push([offset + m.indices[1][0], m[1]]);
  }
  if (source === 'runtime') {
    for (const m of text.matchAll(/\bchat-page-[\w-]+\.js\?[^\s"'`<>\\)]+/g)) collectQueries(m[0], m.index);
  } else {
    collectQueries(text);
  }
  if (source === 'injections' && /\.[cm]?js$/.test(file)) {
    const used = new Set([...text.matchAll(/[?&]v=\$\{\s*([\w$]+)\s*\}/g)].map(m => m[1]));
    if (used.size) {
      const declaration = /\b(?:const|let|var)\s+([\w$]+)\s*=\s*(['"`])([a-z0-9_][a-z0-9._%+-]*)\2(?=[ \t]*(?:[;,\n]|$))/gid;
      for (const m of text.matchAll(declaration)) {
        if (used.has(m[1])) matches.push([m.indices[3][0], m[3]]);
      }
    }
  }
  let line = 1, start = 0, end = text.indexOf('\n');
  return matches.sort(([a], [b]) => a - b).map(([index, value]) => {
    while (end !== -1 && end < index) {
      line++;
      start = end + 1;
      end = text.indexOf('\n', start);
    }
    return {column: index - start + 1, file, line, source, value};
  });
}

export async function measure(root = ROOT, {includeTestInventory = true} = {}) {
  if (!fs.statSync(root).isDirectory()) throw new Error('测量位置必须是仓库目录。');
  const globals = new Set(), injections = {}, longFiles = {}, occurrences = [];
  for (const dir of SCAN_ROOTS) {
    const injection = dir === 'ui/injections';
    await scanSources(root, [...files(root, dir)].filter(file => injection || SOURCE_FILE.test(file)), (file, text) => {
      const handwritten = SOURCE_FILE.test(file);
      const size = injection ? (injections[file] = injectionMetrics(text, globals)).lines : lines(text);
      if (handwritten && size > LINE_LIMIT) longFiles[file] = size;
      if (file === HEAD) occurrences.push(...versionLocations(file, text, 'head'));
      else if (injection && /\.(?:[cm]?js|css)$/.test(file)) occurrences.push(...versionLocations(file, text, 'injections'));
    });
  }
  await scanSources(root, VERSION_TOOLS.filter(file => fs.lstatSync(path.join(root, file), {throwIfNoEntry: false})?.isFile()),
    (file, text) => occurrences.push(...versionLocations(file, text, 'tooling')));
  await scanSources(root, [...files(root, 'ui/runtime', false)].filter(file => /^ui\/runtime\/index-.*\.js$/.test(file)),
    (file, text) => occurrences.push(...versionLocations(file, text, 'runtime')));
  occurrences.sort((a, b) => alphabetical(a.file, b.file) || a.line - b.line || a.column - b.column);
  const versionCounts = {head: 0, injections: 0, runtime: 0, tooling: 0};
  for (const row of occurrences) versionCounts[row.source]++;

  const injectionTotals = {important: 0, mutationObservers: 0, setIntervals: 0, subtreeObserverCalls: 0, windowGlobals: globals.size, windowGlobalsPerFileSum: 0};
  for (const metrics of Object.values(injections)) {
    for (const key of ['important', 'mutationObservers', 'setIntervals', 'subtreeObserverCalls']) injectionTotals[key] += metrics[key];
    injectionTotals.windowGlobalsPerFileSum += metrics.windowGlobals;
  }

  const report = {
    injectionTotals,
    injections,
    longFiles,
    manualVersions: {counts: versionCounts, occurrences, total: occurrences.length},
    patchApplyFiles: [...files(root, 'patch', false)].filter(file => /^patch\/apply-.*\.mjs$/.test(file)).length,
  };
  // Informational only: the guard doesn't have to open hundreds of test files.
  if (includeTestInventory) report.tests = await testInventory(root);
  return report;
}

async function testInventory(root) {
  let gatedNodeFiles = 0, pythonDiscoveryFiles = 0, otherTestFiles = 0;
  const testFiles = [], browserFilePaths = [];
  for (const file of files(root, 'tests')) {
    if (/^tests\/[^/]+\.test\.(?:cjs|mjs)$/.test(file)) gatedNodeFiles++;
    else if (/_test\.py$/.test(file)) pythonDiscoveryFiles++;
    else if (/\.test\.(?:[cm]?js|py)$/.test(file)) otherTestFiles++;
    else continue;
    testFiles.push(file);
  }
  await scanSources(root, testFiles, (file, text) => {
    if (/\.launch\(|newPage\(/.test(text)) browserFilePaths.push(file);
  });
  return {browserFilePaths: browserFilePaths.sort(), browserFiles: browserFilePaths.length,
    gatedNodeFiles, otherTestFiles, pythonDiscoveryFiles, total: gatedNodeFiles + pythonDiscoveryFiles + otherTestFiles};
}

export function formatMeasurement(report) {
  return JSON.stringify(report, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value, 2) + '\n';
}

async function main(args) {
  if (args.length === 0) return process.stdout.write(formatMeasurement(await measure()));
  if (args.length === 2 && args[0] === '--root') return process.stdout.write(formatMeasurement(await measure(path.resolve(args[1]))));
  if (args.length !== 1 || args[0] !== '--write-baseline') {
    throw new Error('用法：node tools/health/measure.mjs [--root <对照工作树> | --write-baseline]');
  }
  const file = path.join(ROOT, 'tools/health/baseline.json');
  const current = await measure();
  const {increases} = healthChanges(current, readJson(file));
  if (increases.length) throw new Error(`不能把增长（含例外）写进基线：\n- ${increases.join('\n- ')}`);
  fs.writeFileSync(file, formatMeasurement(current), 'utf8');
  console.log('已同步 tools/health/baseline.json；请与本次改善一起提交。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
