#!/usr/bin/env node
// M0 口径（静态源码盘点，不执行产品代码）：
// - 范围是整个仓库：git 跟踪的文件加上未跟踪、未被忽略的新文件（不是 git 工作树时逐层列目录）。
//   只排除 tools/health/third-party.json 里逐条写明的第三方/生成物路径，以及
//   skills/community-skills.json 登记的社区技能目录；清单里写了但不存在的路径报错。
//   名字里带 vendor、third-party、katex 的目录不再自动跳过。
// - 要量的文本文件含 NUL 或不是 UTF-8、或者是符号链接，直接报错，不静默跳过。
// - ui/ 下所有手写文件（ui/injections 里除二进制外的全部文件，其他 UI 目录里的源码）逐文件记
//   injections 一节：CRLF/LF 都算一个换行，末尾换行不多算一行。统计源码拼写（含注释/字符串）：
//   !important、new MutationObserver、setInterval(；分别数 .observe(...) 的字面
//   subtree: true / subtree: !0 调用点，不含 getAnimations。window.__NAME 仅数直接的 '=' 左值，
//   文件内去重，总表按全仓去重。绕开这些字面写法的变体另记新指标（见 patterns.mjs）。
// - 版本号数的是维护位置而非不同版本值。数头部、注入 JS/CSS、其他 UI 页面、两个 Python 工具里每处
//   字面 ?v=/&v=（含替换/核对用的旧值）；?v=${CONST} 数同文件的字面常量声明一次；
//   '?v=' + ... 和 ?v=${'...'} 这种拼出来的也算一处。runtime 仅数 chat-page-*.js 引用的手写 v；
//   不数 @hash 占位、动态值和生成的 &h=。位置是值首字符的 1 基行列，列用 JS 字符串的 UTF-16 单元计。
// - 超 1500 行检查覆盖范围内所有源码/脚本/模板扩展名（见 SOURCE_FILE）的文件。
// - 补丁仅数 patch/ 顶层 apply-*.mjs。测试分别数门禁的 tests/*.test.{cjs,mjs}、
//   Python *_test.py 和其他 *.test.{js,py}；浏览器数是匹配指定拼写的文件数，不是运行结果。
// - 只输出相对路径、排序后的键和 LF JSON，无机器/时间信息。
import {isUtf8} from 'node:buffer';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchApplyFileNames} from './patch-list.mjs';
import {indirectMetrics} from './patterns.mjs';
import {adoptUnmeasured, healthChanges, injectionTotals, LINE_LIMIT, loadExceptions, readJson, syncBaseline} from './ratchet.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HEAD = 'ui/injections/laolao-head.fragment.html';
export const UNMEASURED_LIST = 'tools/health/third-party.json';
export const COMMUNITY_SKILLS = 'skills/community-skills.json';
const VERSION_TOOLS = ['tools/claude-deploy/deploy-work-first.py', 'tools/ui-parity/bundle.py'];
const SKIP_DIR = new Set(['.git', 'node_modules']);
const BINARY_FILE = /\.(?:png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|ttf|otf|woff2?|eot|wasm|bcmap|pfb|mp3|mp4|m4a|mov|webm|wav|ogg|pdf|zip|gz|tgz|7z|exe|dll|dylib|so|node|pyc)$/i;
const SOURCE_FILE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx|css|scss|html?|pyw?|swift|[zba]?sh|bash|ps[dm]?1|bat|cmd|c|cc|cpp|h|hpp|m|mm|go|rs|rb|lua|sql|patch|diff|plist(?:\.in)?)$/i;
const VERSION_QUERY = /[?&]v=([a-z0-9_][a-z0-9._%+-]*)(?=$|[\s"'`&)>#\\;])/gid;
const VERSION_CONCAT = /[?&]v=(?:(['"`])\s*\+|\$\{\s*['"`])/g;
const OBSERVE_OPTIONS = /\.\s*observe\s*\([^;{}]*?,\s*\{([^{}]*)\}\s*\)/g;
const SUBTREE_OPTION = /(?:^|,)\s*(?:subtree|['"]subtree['"])\s*:\s*(?:true|!\s*0)\s*(?=,|$)/;
const alphabetical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// 旧口径量过的注入文件（ui/injections 下，不在 vendor/、laolao-katex/ 这类目录里，名字也不以 laolao-vendor- 开头）
// 继续记在 injections 一节；其余 UI 手写文件记在 otherUi，免得新量到的数字抬高 injections 的旧合计。
const LEGACY_SKIPPED_DIR = /^(?:\.git|\.build|build|dist|node_modules|__pycache__|\.venv|vendor|third[-_]?party|laolao-katex)$/i;
function legacyInjection(file) {
  if (!file.startsWith('ui/injections/')) return false;
  const parts = file.split('/').slice(2);
  return !parts.some(part => part.startsWith('laolao-vendor-')) && !parts.slice(0, -1).some(part => LEGACY_SKIPPED_DIR.test(part));
}

function walk(root, dir = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (!entry.isDirectory()) out.push(relative); // 普通文件和符号链接都列出来，后面再分辨
    else if (!SKIP_DIR.has(entry.name)) out.push(...walk(root, relative));
  }
  return out;
}

function sameDirectory(a, b) {
  const real = p => {
    const resolved = fs.realpathSync.native(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  try { return real(a) === real(b); } catch { return false; }
}

// 仓库里的全部文件：跟踪的 + 未跟踪未忽略的。不是 git 工作树（测试用的临时目录）时逐层列目录。
export function repoFiles(root) {
  const top = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {encoding: 'utf8'});
  if (top.status !== 0 || !sameDirectory(top.stdout.trim(), root)) return walk(root).sort(alphabetical);
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {encoding: 'utf8', maxBuffer: 1 << 28});
  if (listed.status !== 0) throw new Error(`git ls-files 失败：${listed.stderr.trim()}`);
  return [...new Set(listed.stdout.split('\0').filter(Boolean))].sort(alphabetical);
}

// 不量的路径：third-party.json 逐条登记的第三方/生成物，加上登记过的社区技能目录。
// listRoot 是读清单的工作树；用 PR 的清单量目标分支时，目标分支还没有的路径不算错（requireExisting=false）。
export function unmeasuredPaths(root, problems = [], {listRoot = root, requireExisting = true} = {}) {
  const entries = [];
  const listFile = path.join(listRoot, UNMEASURED_LIST);
  if (fs.existsSync(listFile)) {
    const list = readJson(listFile);
    if (!Array.isArray(list?.paths)) throw new Error(`${UNMEASURED_LIST} 的 paths 必须是数组。`);
    for (const entry of list.paths) {
      const {path: p, kind, reason} = entry ?? {};
      if (typeof p !== 'string' || !p || /[\\:\x00*?]|^\/|(?:^|\/)\.\.?(?:\/|$)/.test(p)
        || !['third-party', 'generated'].includes(kind) || typeof reason !== 'string' || !reason.trim()) {
        throw new Error(`${UNMEASURED_LIST} 每项要有 path（仓库相对路径，目录以 / 结尾）、kind（third-party 或 generated）和 reason：${JSON.stringify(entry)}`);
      }
      entries.push(p);
    }
  }
  const skillsFile = path.join(listRoot, COMMUNITY_SKILLS);
  if (fs.existsSync(skillsFile)) {
    for (const skill of readJson(skillsFile).skills ?? []) {
      if (typeof skill?.name !== 'string' || !/^\w[\w.-]*$/.test(skill.name)) throw new Error(`${COMMUNITY_SKILLS} 里的技能名不合法：${JSON.stringify(skill?.name)}`);
      entries.push(`skills/${skill.name}/`);
    }
  }
  const seen = new Set();
  for (const p of entries) {
    if (seen.has(p)) problems.push(`不量清单重复写了 ${p}。`);
    seen.add(p);
    const stat = fs.lstatSync(path.join(root, p), {throwIfNoEntry: false});
    if (requireExisting && !(p.endsWith('/') ? stat?.isDirectory() : stat?.isFile())) problems.push(`不量清单里写了但不存在：${p}（目录要以 / 结尾，文件不要）。`);
  }
  return [...seen].sort(alphabetical);
}

async function readSource(root, file) {
  const bytes = await readFile(path.join(root, file));
  if (bytes.includes(0)) return {problem: '含 NUL 字节，体检没法当文本量；源码里请写成 \\0 转义，真是二进制就换成二进制扩展名或登记进不量清单。'};
  if (!isUtf8(bytes)) return {problem: '不是 UTF-8 文本，体检没法量；请转成 UTF-8，真是二进制就换成二进制扩展名或登记进不量清单。'};
  return bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

async function scanSources(root, filenames, problems, consume) {
  // Bounded parallel reads keep a cold Windows checkout from serializing each
  // disk open without keeping the whole source tree in memory.
  const batch = 16;
  for (let i = 0; i < filenames.length; i += batch) {
    const group = filenames.slice(i, i + batch);
    const sources = await Promise.all(group.map(file => readSource(root, file)));
    for (const [index, file] of group.entries()) {
      if (typeof sources[index] === 'string') consume(file, sources[index]);
      else problems.push(`${file} ${sources[index].problem}`);
    }
  }
}

const count = (text, pattern) => [...text.matchAll(pattern)].length;
function lines(text) {
  let total = Number(text.length > 0 && !text.endsWith('\n'));
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) total++;
  return total;
}

function injectionMetrics(text, globals) {
  const names = new Set([...text.matchAll(/\bwindow\s*\.\s*(__[\p{ID_Continue}$]+)\s*=(?!=|>)/gu)].map(m => m[1]));
  for (const name of names) globals.add(name);
  const literal = {
    important: count(text, /!\s*important\b/gi),
    lines: lines(text),
    mutationObservers: count(text, /\bnew\s+MutationObserver(?![$\p{ID_Continue}])/gu),
    setIntervals: count(text, /\bsetInterval\s*\(/g),
    subtreeObserverCalls: [...text.matchAll(OBSERVE_OPTIONS)].filter(m => SUBTREE_OPTION.test(m[1])).length,
    windowGlobals: names.size,
  };
  return {...literal, ...indirectMetrics(text, literal, names)};
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
  if (source !== 'runtime' && source !== 'tooling') {
    for (const m of text.matchAll(VERSION_CONCAT)) matches.push([m.index + 3, '(拼接)']);
  }
  if ((source === 'injections' || source === 'pages') && /\.[cm]?js$/.test(file)) {
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

// strict=false：量不了的文件不抛错，记在 report.problems 里（compare-baseline.mjs 量目标分支时用）。
export async function measure(root = ROOT, {includeTestInventory = true, listRoot = root, strict = true} = {}) {
  if (!fs.statSync(root).isDirectory()) throw new Error('测量位置必须是仓库目录。');
  const problems = [];
  const skipped = unmeasuredPaths(root, problems, {listRoot, requireExisting: path.resolve(listRoot) === path.resolve(root)});
  const skip = file => skipped.some(p => p.endsWith('/') ? file.startsWith(p) : file === p);
  const all = repoFiles(root);
  const targets = [];
  for (const file of all) {
    const counted = file.startsWith('ui/injections/') ? !BINARY_FILE.test(file) : SOURCE_FILE.test(file);
    if (!counted || skip(file)) continue;
    const stat = fs.lstatSync(path.join(root, file), {throwIfNoEntry: false});
    if (!stat) continue; // 工作树里已经删掉、索引里还在
    if (!stat.isFile()) problems.push(`${file} 不是普通文件（符号链接等），体检不跟随；请改成普通文件或登记进 ${UNMEASURED_LIST}。`);
    else targets.push(file);
  }

  const sections = {injections: {}, otherUi: {}}, globals = {injections: new Set(), otherUi: new Set()};
  const longFiles = {}, occurrences = [], pageOccurrences = [];
  await scanSources(root, targets, problems, (file, text) => {
    const ui = file.startsWith('ui/');
    const section = legacyInjection(file) ? 'injections' : 'otherUi';
    const size = ui ? (sections[section][file] = injectionMetrics(text, globals[section])).lines : lines(text);
    if (SOURCE_FILE.test(file) && size > LINE_LIMIT) longFiles[file] = size;
    if (file === HEAD) occurrences.push(...versionLocations(file, text, 'head'));
    else if (section === 'injections' && /\.(?:[cm]?js|css)$/.test(file)) occurrences.push(...versionLocations(file, text, 'injections'));
    else if (ui && /\.(?:[cm]?js|css|html?)$/.test(file)) pageOccurrences.push(...versionLocations(file, text, 'pages'));
    if (VERSION_TOOLS.includes(file)) occurrences.push(...versionLocations(file, text, 'tooling'));
  });
  // ui/runtime 是生成物，不逐文件量；只数它引用 chat-page-*.js 时手写的 v。
  await scanSources(root, all.filter(file => /^ui\/runtime\/index-[^/]*\.js$/.test(file)), problems,
    (file, text) => occurrences.push(...versionLocations(file, text, 'runtime')));
  if (problems.length && strict) throw new Error(`代码体检没法量完：\n- ${problems.join('\n- ')}`);

  const byPlace = (a, b) => alphabetical(a.file, b.file) || a.line - b.line || a.column - b.column;
  occurrences.sort(byPlace);
  pageOccurrences.sort(byPlace);
  const versionCounts = {head: 0, injections: 0, runtime: 0, tooling: 0};
  for (const row of occurrences) versionCounts[row.source]++;
  const report = {
    injectionTotals: injectionTotals(sections.injections, globals.injections.size),
    injections: sections.injections,
    longFiles,
    manualVersions: {counts: versionCounts, occurrences, total: occurrences.length},
    otherUi: sections.otherUi,
    otherUiTotals: injectionTotals(sections.otherUi, globals.otherUi.size),
    pageVersions: {occurrences: pageOccurrences, total: pageOccurrences.length},
    patchApplyFiles: patchApplyFileNames(root, all).length, // 和 tools/health/patch-files.json 的棘轮用同一个判定
  };
  if (!strict) report.problems = problems;
  // Informational only: the guard doesn't have to open hundreds of test files.
  if (includeTestInventory) report.tests = await testInventory(root, all);
  return report;
}

async function testInventory(root, all) {
  let gatedNodeFiles = 0, pythonDiscoveryFiles = 0, otherTestFiles = 0;
  const testFiles = [], browserFilePaths = [];
  for (const file of all) {
    if (!file.startsWith('tests/') || !fs.lstatSync(path.join(root, file), {throwIfNoEntry: false})?.isFile()) continue;
    if (/^tests\/[^/]+\.test\.(?:cjs|mjs)$/.test(file)) gatedNodeFiles++;
    else if (/_test\.py$/.test(file)) pythonDiscoveryFiles++;
    else if (/\.test\.(?:[cm]?js|py)$/.test(file)) otherTestFiles++;
    else continue;
    testFiles.push(file);
  }
  await scanSources(root, testFiles, [], (file, text) => {
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
  if (args.length !== 1 || !['--write-baseline', '--adopt-unmeasured'].includes(args[0])) {
    throw new Error('用法：node tools/health/measure.mjs [--root <对照工作树> | --write-baseline | --adopt-unmeasured]');
  }
  const file = path.join(ROOT, 'tools/health/baseline.json');
  const baseline = readJson(file);
  const current = await measure();
  if (args[0] === '--adopt-unmeasured') {
    // 只补基线里还没有的键；CI 的 compare-baseline.mjs 会拿目标分支的实测值核对补进来的数字。
    fs.writeFileSync(file, formatMeasurement(adoptUnmeasured(current, baseline)), 'utf8');
    console.log('已把以前没量过的文件和指标补进 tools/health/baseline.json，已有数字没动；CI 会和目标分支实测值核对。');
    return;
  }
  // Growth that no exception covers still fails; growth an exception covers is
  // simply not written, and only improved numbers move (see syncBaseline).
  const {increases} = healthChanges(current, baseline, loadExceptions(ROOT));
  if (increases.length) throw new Error(`有没登记例外的增长，不能同步基线：\n- ${increases.join('\n- ')}`);
  fs.writeFileSync(file, formatMeasurement(syncBaseline(current, baseline)), 'utf8');
  console.log('已同步 tools/health/baseline.json（只写入变好的数字）；请与本次改善一起提交。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
