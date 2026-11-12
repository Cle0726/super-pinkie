// 给碧琪的三样写代码工具，加一个「改完自动查语法」的看守：
//   code_edit  改文件：照原文替换；原文对不上时不只说「没找到」，而是把文件里最像的那一段连行号给回去
//   run_tests  跑测试：用项目真实的测试命令，读懂输出，记住改之前的基线，告诉它「哪些是这次弄坏的」
//   code_refs  查引用：一个名字在哪定义、被哪些地方用到
//   CodeWatch  任何写文件的工具动了代码文件之后，引擎自己查一遍语法，有错就在下一次开口前提醒
//
// 为什么要有：小模型写代码最常栽在三处。一是改文件时原文差一个空格就匹配失败，然后整份重写把别的
// 地方弄坏；二是读不懂几百行的测试输出，分不清哪些失败是原来就有的；三是改了函数签名却漏掉调用处。
// 这三样都是引擎可以替它做对的事，不用靠它记住手册里的规矩。
//
// 纯逻辑（applyEdit、parseTestOutput、detectTestCommand、findRefs、quickSyntax）不依赖 OpenClaw，可单测。
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {walkFiles, globToRegExp} from './code-tools.mjs';

const CODE_EXT = /\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts|py|pyi|json|sh|bash|zsh|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|vue|svelte|css|scss|html?|ya?ml|toml|sql|ps1)$/i;
const MAX_EDIT_BYTES = 3 * 1024 * 1024;
const exists = file => { try { fs.accessSync(file); return true; } catch { return false; } };
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function resolveInside(root, sub = '') {
  const base = path.resolve(root);
  const target = path.resolve(base, String(sub || '.'));
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error(`这个工具只动当前项目目录（${base}）里的文件；别处的文件用自带的读写工具。`);
  return target;
}

/* ───────── code_edit：照原文替换，对不上就给出最像的一段 ───────── */

// 比较时忽略的差别：缩进、行尾空白、连续空白的个数、弯引号和直引号。
const normLine = line => line.trim().replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const indentOf = line => /^[ \t]*/.exec(line)[0];
const stripBlankEdges = lines => {
  let start = 0, end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
};
function bigrams(text) {
  const set = new Map();
  for (let i = 0; i < text.length - 1; i += 1) { const key = text.slice(i, i + 2); set.set(key, (set.get(key) || 0) + 1); }
  return set;
}
// 两行有多像，0 到 1。
export function lineSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a), right = bigrams(b);
  let shared = 0;
  for (const [key, count] of left) shared += Math.min(count, right.get(key) || 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

function nearestBlock(lines, wanted) {
  const want = wanted.map(normLine);
  const have = lines.map(normLine);
  const size = want.length;
  let best = {score: 0, start: -1};
  if (size === 1) {
    for (let i = 0; i < have.length; i += 1) {
      const score = lineSimilarity(want[0], have[i]);
      if (score > best.score) best = {score, start: i};
    }
    return best.score >= 0.5 ? {...best, size: 1} : null;
  }
  // 先找出原文每一行在文件里出现的位置，只算那些至少有一行对得上的窗口，大文件也快。
  const starts = new Set();
  const index = new Map();
  have.forEach((line, i) => { if (line) { if (!index.has(line)) index.set(line, []); index.get(line).push(i); } });
  want.forEach((line, offset) => { for (const at of index.get(line) || []) if (at - offset >= 0) starts.add(at - offset); });
  for (const start of starts) {
    let score = 0;
    for (let k = 0; k < size && start + k < have.length; k += 1) score += want[k] === have[start + k] ? 1 : lineSimilarity(want[k], have[start + k]) * 0.6;
    score /= size;
    if (score > best.score) best = {score, start};
  }
  return best.score >= 0.35 ? {...best, size: Math.min(size, lines.length - best.start)} : null;
}

const numbered = (lines, start, end) => lines.slice(start, end).map((line, i) => `${String(start + i + 1).padStart(4)}  ${line}`).join('\n');

// 返回 {ok, content, count, startLine, endLine, fuzzy} 或 {ok:false, reason, message}。
export function applyEdit(original, oldText, newText, {replaceAll = false} = {}) {
  const crlf = /\r\n/.test(original);
  const content = original.replace(/\r\n/g, '\n');
  const oldLf = String(oldText ?? '').replace(/\r\n/g, '\n');
  const newLf = String(newText ?? '').replace(/\r\n/g, '\n');
  const finish = (text, extra) => ({ok: true, content: crlf ? text.replace(/\n/g, '\r\n') : text, ...extra});
  if (!oldLf) return {ok: false, reason: 'empty', message: 'old_text 不能是空的：要给出文件里要被换掉的那一段原文。'};
  if (oldLf === newLf) return {ok: false, reason: 'same', message: 'old_text 和 new_text 一模一样，没有要改的东西。'};
  const lineAt = offset => content.slice(0, offset).split('\n').length;

  // 1. 一字不差
  const hits = [];
  for (let at = content.indexOf(oldLf); at !== -1; at = content.indexOf(oldLf, at + oldLf.length)) hits.push(at);
  if (hits.length === 1 || (hits.length > 1 && replaceAll)) {
    const text = hits.length === 1 ? content.slice(0, hits[0]) + newLf + content.slice(hits[0] + oldLf.length) : content.split(oldLf).join(newLf);
    const startLine = lineAt(hits[0]);
    return finish(text, {count: hits.length, startLine, endLine: startLine + newLf.split('\n').length - 1});
  }
  if (hits.length > 1) {
    return {ok: false, reason: 'multiple', message: `这段原文在文件里出现了 ${hits.length} 次（第 ${hits.slice(0, 12).map(lineAt).join('、')} 行）。把 old_text 往上或往下多带两三行，让它只对得上一处；真的要全部替换就传 replace_all: true。`};
  }

  // 2. 只有空白、缩进、引号样式不同：按文件里的真实缩进对上
  const lines = content.split('\n');
  const wanted = stripBlankEdges(oldLf.split('\n'));
  if (!wanted.length) return {ok: false, reason: 'empty', message: 'old_text 只有空行，没法定位。'};
  const want = wanted.map(normLine);
  const loose = [];
  for (let i = 0; i + want.length <= lines.length; i += 1) {
    if (normLine(lines[i]) !== want[0]) continue;
    let same = true;
    for (let k = 1; k < want.length; k += 1) if (normLine(lines[i + k]) !== want[k]) { same = false; break; }
    if (same) loose.push(i);
  }
  if (loose.length === 1 || (loose.length > 1 && replaceAll)) {
    const fresh = stripBlankEdges(newLf.split('\n'));
    const from = indentOf(wanted.find(line => line.trim()) || '');
    let out = lines;
    for (const start of [...loose].reverse()) {
      const to = indentOf(out.slice(start, start + want.length).find(line => line.trim()) || '');
      const moved = fresh.map(line => {
        if (!line.trim() || from === to) return line;
        if (line.startsWith(from)) return to + line.slice(from.length);
        return to + line.trimStart();
      });
      out = [...out.slice(0, start), ...moved, ...out.slice(start + want.length)];
    }
    return finish(out.join('\n'), {count: loose.length, startLine: loose[0] + 1, endLine: loose[0] + Math.max(fresh.length, 1), fuzzy: true});
  }
  if (loose.length > 1) {
    return {ok: false, reason: 'multiple', message: `这段原文在文件里对得上 ${loose.length} 处（第 ${loose.slice(0, 12).map(i => i + 1).join('、')} 行）。把 old_text 多带几行上下文，让它只对得上一处；真的要全部替换就传 replace_all: true。`};
  }

  // 3. 对不上：把最像的那一段给回去，让它照文件里的原样再来一次
  const near = nearestBlock(lines, wanted);
  if (!near) return {ok: false, reason: 'nomatch', message: '文件里没有这段原文，也没有相近的段落。这个文件可能不是你以为的那个，或者已经被改过了：先用 code_search 搜其中最特别的一行，或者重新读这个文件再改。'};
  const from = Math.max(0, near.start - 2), to = Math.min(lines.length, near.start + near.size + 2);
  const differ = [];
  for (let k = 0; k < near.size; k += 1) if (normLine(lines[near.start + k] ?? '') !== want[k]) differ.push(near.start + k + 1);
  return {
    ok: false, reason: 'nomatch', nearest: {startLine: near.start + 1, endLine: near.start + near.size},
    message: [
      `没有一字不差对得上的地方。文件里最像的是第 ${near.start + 1}–${near.start + near.size} 行（${differ.length ? `第 ${differ.slice(0, 10).join('、')} 行和你给的不一样` : '只差在行的多少上'}）：`,
      numbered(lines, from, to),
      '照上面文件里的原样重写 old_text（不带行号）再调用一次；如果这一段不是你要改的地方，用 code_search 另找。不要因为对不上就整份重写这个文件。',
    ].join('\n'),
  };
}

/* ───────── 快速语法检查：只查能在一秒内查完的 ───────── */

const pythonBin = root => {
  for (const candidate of ['.venv/bin/python', 'venv/bin/python', '.venv/Scripts/python.exe', 'venv/Scripts/python.exe']) if (root && exists(path.join(root, candidate))) return path.join(root, candidate);
  return process.platform === 'win32' ? 'python' : 'python3';
};
const PY_SYNTAX = 'import ast,sys\ntry:\n    ast.parse(open(sys.argv[1],encoding="utf-8-sig").read(),sys.argv[1])\nexcept SyntaxError as e:\n    print(f"{e.lineno}:{e.msg}");sys.exit(1)\n';

// 返回 null（没查，或者没问题）或 {line, message}。只报语法层面的错，类型和风格交给 code_check。
export function quickSyntax(file, {root = ''} = {}) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const run = (command, args) => spawnSync(command, args, {encoding: 'utf8', timeout: 8000, windowsHide: true, env: {...process.env, NO_COLOR: '1'}});
  try {
    if (ext === 'json') {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      // tsconfig、VS Code 设置这类允许注释的 JSON 不按严格 JSON 查
      if (/(?:^|[\\/])(?:tsconfig|jsconfig)[^\\/]*\.json$|[\\/]\.vscode[\\/]/.test(file)) return null;
      try { JSON.parse(text); return null; } catch (error) {
        const at = /position (\d+)/.exec(error.message);
        return {line: at ? text.slice(0, Number(at[1])).split('\n').length : 1, message: `JSON 写坏了：${error.message}`};
      }
    }
    if (['js', 'mjs', 'cjs'].includes(ext)) {
      const result = run(process.execPath, ['--check', file]);
      if (result.error || result.status === 0 || result.status === null) return null;
      const stderr = String(result.stderr || '');
      const line = /:(\d+)\s*\n/.exec(stderr);
      const message = stderr.split('\n').find(text => /^\w*Error/.test(text)) || '语法错误';
      return {line: line ? Number(line[1]) : 1, message};
    }
    if (['py', 'pyi'].includes(ext)) {
      const result = run(pythonBin(root), ['-c', PY_SYNTAX, file]);
      if (result.error || result.status !== 1) return null;
      const out = /^(\d+):(.*)$/m.exec(String(result.stdout || ''));
      return out ? {line: Number(out[1]), message: `SyntaxError: ${out[2].trim()}`} : null;
    }
    if (['sh', 'bash'].includes(ext) && process.platform !== 'win32') {
      const result = run('bash', ['-n', file]);
      if (result.error || result.status === 0 || result.status === null) return null;
      const out = /line (\d+):\s*(.*)/.exec(String(result.stderr || ''));
      return {line: out ? Number(out[1]) : 1, message: out ? out[2] : 'shell 语法错误'};
    }
  } catch { /* 查不了就当没查 */ }
  return null;
}

/* ───────── run_tests：认命令、读输出、记基线 ───────── */

const nodeRunner = root => (exists(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : exists(path.join(root, 'yarn.lock')) ? 'yarn' : exists(path.join(root, 'bun.lockb')) || exists(path.join(root, 'bun.lock')) ? 'bun' : 'npm');
const quote = value => (/^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`);

// 这个项目的测试命令。认不出来返回 null，不编。
export function detectTestCommand(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  if (pkg) {
    const script = pkg.scripts?.test;
    if (typeof script === 'string' && !/no test specified/i.test(script)) {
      const runner = nodeRunner(root);
      return {command: `${runner} test`, label: `package.json 的 test 脚本（${clip(script, 60)}）`, joiner: runner === 'npm' || runner === 'pnpm' ? ' -- ' : ' '};
    }
    const dir = ['tests', 'test', '__tests__'].find(name => exists(path.join(root, name)));
    let hasNodeTests = false;
    try { hasNodeTests = Boolean(dir) && fs.readdirSync(path.join(root, dir)).some(name => /\.(?:test|spec)\.(?:mjs|cjs|js)$/.test(name)); } catch { /* 没有就算了 */ }
    if (hasNodeTests) return {command: 'node --test', label: `没有 test 脚本，${dir}/ 里有 *.test.js，用 Node 自带的测试`, joiner: ' '};
  }
  const pyText = ['pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'setup.cfg', 'tox.ini'].map(name => { try { return fs.readFileSync(path.join(root, name), 'utf8'); } catch { return ''; } }).join('\n').toLowerCase();
  const pyDir = ['tests', 'test'].find(name => exists(path.join(root, name)));
  let hasPy = Boolean(pyText) || exists(path.join(root, 'setup.py'));
  if (!hasPy) { try { hasPy = fs.readdirSync(root).some(name => name.endsWith('.py')); } catch { /* 读不了 */ } }
  if (hasPy && !pkg?.scripts?.test) {
    const bin = pythonBin(root);
    const python = quote(path.isAbsolute(bin) ? path.relative(root, bin) : bin);
    if (/pytest/.test(pyText) || exists(path.join(root, 'pytest.ini')) || exists(path.join(root, 'conftest.py')) || (pyDir && exists(path.join(root, pyDir, 'conftest.py')))) return {command: `${python} -m pytest -q`, label: 'pytest', joiner: ' '};
    if (pyDir) return {command: `${python} -m unittest discover -s ${pyDir} -v`, label: `${pyDir}/ 目录，用 unittest`, joiner: ' '};
    let loose = false;
    try { loose = fs.readdirSync(root).some(name => /^test_.*\.py$|_test\.py$/.test(name)); } catch { /* 读不了 */ }
    if (loose) return {command: `${python} -m unittest discover -v -p "*test*.py"`, label: '根目录的 test_*.py，用 unittest', joiner: ' '};
  }
  const table = [
    ['Cargo.toml', 'cargo test', 'Rust'], ['go.mod', 'go test ./...', 'Go'], ['pom.xml', 'mvn -q test', 'Maven'],
    ['build.gradle', process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test', 'Gradle'],
    ['build.gradle.kts', process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test', 'Gradle'],
    ['pubspec.yaml', 'flutter test', 'Flutter'], ['Package.swift', 'swift test', 'Swift'],
  ];
  const found = table.find(([file]) => exists(path.join(root, file)));
  if (found) return {command: found[1], label: found[2], joiner: ' '};
  try { if (fs.readdirSync(root).some(name => /\.(?:sln|csproj)$/i.test(name))) return {command: 'dotnet test', label: '.NET', joiner: ' '}; } catch { /* 读不了 */ }
  return null;
}

const stripAnsi = text => text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r(?!\n)/g, '\n');

// 从测试输出里读出：过了几条、失败几条、失败的是哪些、第一个失败的原文。各家框架的写法都认。
export function parseTestOutput(raw = '', exitCode = 0) {
  const text = stripAnsi(String(raw));
  const lines = text.split('\n');
  const failed = new Set();
  let passed = null, failedCount = null, skipped = null, framework = '';
  const num = value => Number(value);
  const set = (name, p, f, s) => { framework = framework || name; if (p != null) passed = (passed ?? 0) + p; if (f != null) failedCount = (failedCount ?? 0) + f; if (s != null) skipped = (skipped ?? 0) + s; };
  let match;
  // pytest：「3 failed, 10 passed, 1 skipped in 0.5s」；失败行「FAILED tests/x.py::test_a - 原因」
  for (const line of lines) {
    if ((match = /^(?:FAILED|ERROR)\s+(\S+::\S+|\S+\.py)(?:\s+-\s.*)?$/.exec(line.trim()))) failed.add(match[1]);
  }
  const pytestSummary = lines.findLast(line => /\b\d+ (?:passed|failed|errors?)\b.*\bin [\d.]+s/.test(line));
  if (pytestSummary) {
    const grab = word => { const found = new RegExp(`(\\d+) ${word}`).exec(pytestSummary); return found ? num(found[1]) : 0; };
    set('pytest', grab('passed'), grab('failed') + grab('errors?'), grab('skipped'));
  }
  // unittest：「Ran 5 tests」「FAILED (failures=1, errors=1)」；失败行「FAIL: test_x (mod.Class)」
  if (!framework && (match = /^Ran (\d+) tests? in/m.exec(text))) {
    const total = num(match[1]);
    const tail = /^FAILED \(([^)]*)\)/m.exec(text);
    const part = word => { const found = tail && new RegExp(`${word}=(\\d+)`).exec(tail[1]); return found ? num(found[1]) : 0; };
    const bad = part('failures') + part('errors');
    const skip = part('skipped') || num((/^OK \(skipped=(\d+)\)/m.exec(text) || [])[1] || 0);
    set('unittest', total - bad - skip, bad, skip);
    for (const line of lines) if ((match = /^(?:FAIL|ERROR): (\S+) \(([^)]+)\)/.exec(line))) failed.add(`${match[2]}.${match[1]}`);
  }
  // Node 自带测试：「# pass 5」「# fail 1」或「ℹ pass 5」；失败行「not ok 3 - 名字」「✖ 名字」
  if (!framework && (match = /^(?:#|ℹ) pass (\d+)/m.exec(text))) {
    const fail = /^(?:#|ℹ) fail (\d+)/m.exec(text), skip = /^(?:#|ℹ) skipped (\d+)/m.exec(text);
    set('node:test', num(match[1]), fail ? num(fail[1]) : 0, skip ? num(skip[1]) : 0);
    for (const line of lines) {
      if ((match = /^\s*not ok \d+ - (.+?)\s*(?:#.*)?$/.exec(line))) failed.add(match[1]);
      else if ((match = /^\s*✖ (.+?)(?: \([\d.]+ms\))?$/.exec(line)) && !/^failing tests/.test(match[1])) failed.add(match[1]);
    }
  }
  // Jest：「Tests:  1 failed, 5 passed, 6 total」；Vitest：「Tests  1 failed | 5 passed (6)」
  if (!framework && (match = /^\s*Tests:?\s+(.*)$/m.exec(text)) && /passed|failed/.test(match[1])) {
    const grab = word => { const found = new RegExp(`(\\d+) ${word}`).exec(match[1]); return found ? num(found[1]) : 0; };
    set(/\|/.test(match[1]) ? 'vitest' : 'jest', grab('passed'), grab('failed'), grab('skipped') + grab('todo'));
    for (const line of lines) {
      let hit;
      if ((hit = /^\s*(?:✕|×)\s+(.+?)(?: \(?\d+ ?ms\)?)?$/.exec(line))) failed.add(hit[1]);
      else if ((hit = /^\s*●\s+(.+ › .+)$/.exec(line))) failed.add(hit[1]);
      else if ((hit = /^\s*FAIL\s+(\S+\s+>\s+.+)$/.exec(line))) failed.add(hit[1]);
    }
  }
  // Mocha：「5 passing」「1 failing」
  if (!framework && (match = /^\s*(\d+) passing/m.exec(text))) {
    const fail = /^\s*(\d+) failing/m.exec(text), pend = /^\s*(\d+) pending/m.exec(text);
    set('mocha', num(match[1]), fail ? num(fail[1]) : 0, pend ? num(pend[1]) : 0);
    for (const line of lines) if ((match = /^\s+\d+\) (.+)$/.exec(line))) failed.add(match[1].replace(/:$/, ''));
  }
  // Go：「--- FAIL: TestX」「ok  pkg」；Rust：「test result: FAILED. 3 passed; 1 failed; 0 ignored」
  if (!framework && /^(?:--- (?:FAIL|PASS)|ok\s+\S+|FAIL\s+\S+)/m.test(text)) {
    let pass = 0, fail = 0;
    for (const line of lines) {
      if ((match = /^\s*--- FAIL: (\S+)/.exec(line))) { failed.add(match[1]); fail += 1; }
      else if (/^\s*--- PASS: /.test(line)) pass += 1;
    }
    const okPackages = (text.match(/^ok\s+\S+/gm) || []).length;
    set('go test', pass || okPackages, fail || (text.match(/^FAIL\s+\S+/gm) || []).length);
  }
  if (!framework && /^test result: /m.test(text)) {
    for (const found of text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)) set('cargo test', num(found[1]), num(found[2]), num(found[3]));
    for (const line of lines) if ((match = /^test (\S+) \.\.\. FAILED/.exec(line))) failed.add(match[1]);
  }
  if (failedCount == null && failed.size) failedCount = failed.size;
  // 第一个失败从哪一行开始：各家失败段落的开头
  const startAt = lines.findIndex(line => /^=+ (?:FAILURES|ERRORS) =+$|^_{3,} .+ _{3,}$|^(?:FAIL|ERROR): \S+ \(|^\s*not ok \d+|^\s*✖ |^\s*● .+ › |^\s*--- FAIL: |^---- .+ stdout ----$|^\s+1\) |^Traceback \(most recent call last\)|^\s*(?:Assertion|Type|Reference|Syntax)Error\b|panicked at/.test(line));
  const detail = startAt >= 0 ? lines.slice(startAt, startAt + 45) : [];
  const ok = exitCode === 0 && !(failedCount > 0);
  return {ok, framework, passed, failed: failedCount, skipped, failedNames: [...failed].slice(0, 200), detail: detail.join('\n').trimEnd(), tail: lines.slice(-40).join('\n').trim()};
}

const baselines = new Map();
const MAX_BASELINES = 200;
export const forgetBaselines = () => baselines.clear();

function gitDirty(root) {
  try {
    const result = spawnSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true});
    return result.status === 0 ? Boolean(String(result.stdout).trim()) : null;
  } catch { return null; }
}

// 这一次和基线比：新坏了哪些、修好了哪些。名字读得出来按名字比，读不出来按条数比。
export function compareWithBaseline(base, now) {
  if (!base) return null;
  if (base.failedNames.length || now.failedNames.length) {
    const before = new Set(base.failedNames), after = new Set(now.failedNames);
    return {broke: [...after].filter(name => !before.has(name)), fixed: [...before].filter(name => !after.has(name)), stillFailing: [...after].filter(name => before.has(name))};
  }
  if (base.failed != null && now.failed != null) return {brokeCount: Math.max(0, now.failed - base.failed), fixedCount: Math.max(0, base.failed - now.failed)};
  return null;
}

export function formatTestReport({command, exitCode, seconds, timedOut, parsed, comparison, baselineNote, filtered}) {
  const out = [`测试命令：${command}（退出码 ${exitCode ?? '无'}，用时 ${seconds} 秒${timedOut ? '，超时被停掉了' : ''}）`];
  if (parsed.passed != null || parsed.failed != null) out.push(`结果：通过 ${parsed.passed ?? '?'} 条，失败 ${parsed.failed ?? 0} 条${parsed.skipped ? `，跳过 ${parsed.skipped} 条` : ''}${parsed.framework ? `（${parsed.framework}）` : ''}`);
  else out.push(exitCode === 0 ? '结果：命令成功结束，但没读出条数；看下面的输出确认真的跑了测试。' : '结果：命令失败，没读出条数；看下面的输出，可能是测试没跑起来（缺依赖、命令不对、语法错）。');
  if (comparison) {
    if (comparison.broke) {
      if (comparison.broke.length) out.push(`这次弄坏的（基线里是好的，现在失败）${comparison.broke.length} 条：\n${comparison.broke.slice(0, 15).map(name => `  - ${name}`).join('\n')}`);
      if (comparison.fixed.length) out.push(`修好的 ${comparison.fixed.length} 条：${comparison.fixed.slice(0, 8).join('、')}`);
      if (comparison.stillFailing.length) out.push(`原来就失败、现在还失败的 ${comparison.stillFailing.length} 条（不是这次弄坏的）：${comparison.stillFailing.slice(0, 8).join('、')}`);
      if (!comparison.broke.length && !comparison.fixed.length) out.push('和基线比：没有新坏的，也没有新修好的。');
    } else {
      if (comparison.brokeCount) out.push(`和基线比：失败多了 ${comparison.brokeCount} 条，是这次改动弄坏的。`);
      else if (comparison.fixedCount) out.push(`和基线比：失败少了 ${comparison.fixedCount} 条。`);
      else out.push('和基线比：失败条数没变。');
    }
  } else if (parsed.failedNames.length) out.push(`失败的：\n${parsed.failedNames.slice(0, 15).map(name => `  - ${name}`).join('\n')}`);
  if (baselineNote) out.push(baselineNote);
  if (filtered) out.push('这次只跑了一部分（带了 filter），不和基线比，也不能代表全部测试；交付前不带 filter 再跑一次。');
  if (!parsed.ok || timedOut) {
    out.push(parsed.detail ? `第一个失败的原文：\n${clip(parsed.detail, 3500)}` : `输出的最后一段：\n${clip(parsed.tail, 3500)}`);
    out.push('先读懂上面的原文再改：改代码的根因，不改测试去迁就，不跳过测试。');
  }
  return out.join('\n');
}

function runCommand(command, {cwd, timeoutMs}) {
  return new Promise(resolve => {
    const started = Date.now();
    let output = '', timedOut = false, done = false;
    const child = spawn(command, {cwd, shell: true, windowsHide: true, env: {...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1'}});
    const take = chunk => { output += chunk.toString('utf8'); if (output.length > 2_000_000) output = output.slice(-1_500_000); };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const finish = code => { if (done) return; done = true; clearTimeout(timer); resolve({exitCode: code, output, timedOut, seconds: Math.round((Date.now() - started) / 100) / 10}); };
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch { /* 已经结束 */ } }, timeoutMs);
    child.on('error', error => { output += `\n${error.message}`; finish(-1); });
    child.on('close', code => finish(code));
  });
}

const reply = (text, details, isError = false) => ({content: [{type: 'text', text}], details, ...(isError ? {isError: true} : {})});

export function createRunTestsTool(ctx, {rootFor, run = runCommand} = {}) {
  return {
    name: 'run_tests', label: '跑测试',
    description: [
      '跑当前项目的测试并读懂结果。不用自己拼测试命令，也不用自己数输出：系统认出项目真实的测试命令（npm / pnpm / pytest / unittest / node --test / cargo / go / gradle 等），返回通过和失败的条数、失败的是哪些、第一个失败的原文。',
      '它会记住基线：这个会话里第一次跑的结果记为「改之前」。之后每次跑都会告诉你哪些是这次改动弄坏的、哪些原来就失败。所以动手改代码之前先跑一次。',
      '参数都可以不传。filter：只跑一部分（文件路径或测试名，原样接在命令后面）。command：项目的测试命令认不出来或认错时，自己给完整命令。baseline: true：把这次结果重新记为基线（只在确认当前代码就是「改之前」时用）。',
      '改完代码、说「完成」之前必须不带 filter 再跑一次，并照返回的真实条数汇报。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        filter: {type: 'string', description: '只跑这一部分：测试文件路径或测试名'},
        command: {type: 'string', description: '完整的测试命令；只在自动认不出或认错时传'},
        baseline: {type: 'boolean', description: '把这次结果记为新的基线'},
        timeout: {type: 'integer', minimum: 10, maximum: 1800, description: '最多等多少秒，默认 300'},
      },
    },
    async execute(toolCallId, params = {}) {
      try {
        const root = rootFor(ctx);
        const detected = params.command ? {command: String(params.command).trim(), label: '你给的命令', joiner: ' '} : detectTestCommand(root);
        if (!detected) return reply('没认出这个项目的测试命令（没有 test 脚本、pytest、测试目录这些）。先看 README 和包清单里怎么跑测试，再用 command 参数把完整命令传进来；项目确实没有测试，就先给要改的部分写几条。', {error: 'no-test-command'}, true);
        const filter = String(params.filter || '').trim();
        const command = filter ? `${detected.command}${detected.joiner}${filter}` : detected.command;
        const result = await run(command, {cwd: root, timeoutMs: (params.timeout || 300) * 1000});
        const parsed = parseTestOutput(result.output, result.exitCode);
        const key = `${ctx?.sessionKey || ''}|${root}`;
        let base = baselines.get(key), baselineNote = '', comparison = null;
        if (!filter && !result.timedOut) {
          if (!base || params.baseline) {
            if (baselines.size >= MAX_BASELINES) baselines.delete(baselines.keys().next().value);
            const dirty = gitDirty(root);
            base = {failedNames: parsed.failedNames, failed: parsed.failed, passed: parsed.passed};
            baselines.set(key, base);
            baselineNote = `这次结果记为基线${parsed.failed ? `（原来就有 ${parsed.failed} 条失败，不算你弄坏的，但要告诉用户）` : ''}。${dirty ? '注意：工作区里已经有没提交的改动，如果其中有你这轮改的，这个基线就不是改之前的样子。' : ''}改完再跑一次，系统会对比出哪些是这次弄坏的。`;
          } else comparison = compareWithBaseline(base, parsed);
        }
        const text = formatTestReport({command, exitCode: result.exitCode, seconds: result.seconds, timedOut: result.timedOut, parsed, comparison, baselineNote, filtered: Boolean(filter)});
        return reply(text, {command, exitCode: result.exitCode, timedOut: result.timedOut, passed: parsed.passed, failed: parsed.failed, skipped: parsed.skipped, failedNames: parsed.failedNames.slice(0, 50), comparison, ok: parsed.ok && !result.timedOut});
      } catch (error) {
        const message = String(error?.message || error);
        return reply(message, {error: message}, true);
      }
    },
  };
}

export function createCodeEditTool(ctx, {rootFor, watch = null} = {}) {
  return {
    name: 'code_edit', label: '改代码',
    description: [
      '改当前项目里的一个文件：把 old_text 这段原文换成 new_text。改已有的代码文件优先用它。',
      '比普通的替换可靠在三处：缩进、空白、换行符（Windows 的 CRLF）和你给的不完全一样时也能对上，并保持文件原来的缩进和换行；真的对不上时，会把文件里最像的那一段连行号给你，照着重写 old_text 再调一次就行，不要因为对不上就整份重写文件；改完自动查语法，并把改动后的那几行给你看，不用再读一遍。',
      'old_text 要带够上下文，让它在文件里只对得上一处（通常连同上下各一两行）；同样的改动要做很多处时传 replace_all: true。',
      '新建文件：old_text 传空串，new_text 是整份内容（文件已存在时不会覆盖）。path 相对项目根目录。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        path: {type: 'string', description: '要改的文件，相对项目根目录'},
        old_text: {type: 'string', description: '文件里要被换掉的原文；新建文件时传空串'},
        new_text: {type: 'string', description: '换成什么'},
        replace_all: {type: 'boolean', description: '对得上的每一处都替换'},
      },
      required: ['path', 'old_text', 'new_text'],
    },
    async execute(toolCallId, params = {}) {
      try {
        const root = rootFor(ctx);
        const file = resolveInside(root, params.path);
        const relative = path.relative(root, file).split(path.sep).join('/');
        const oldText = String(params.old_text ?? ''), newText = String(params.new_text ?? '');
        let result, created = false;
        if (!exists(file)) {
          if (oldText) return reply(`没有 ${relative} 这个文件。用 code_search 的 files 模式按名字找一下真实路径；要新建它，old_text 传空串。`, {error: 'missing'}, true);
          fs.mkdirSync(path.dirname(file), {recursive: true});
          fs.writeFileSync(file, newText);
          created = true;
          result = {count: 1, startLine: 1, endLine: Math.min(newText.split('\n').length, 12), content: newText};
        } else {
          if (!oldText) return reply(`${relative} 已经存在，不会整份覆盖。要改其中一段，old_text 给出那段原文。`, {error: 'exists'}, true);
          const stat = fs.statSync(file);
          if (!stat.isFile() || stat.size > MAX_EDIT_BYTES) return reply(`${relative} 不是普通文件或者太大，不能用这个工具改。`, {error: 'unsupported'}, true);
          const buffer = fs.readFileSync(file);
          if (buffer.subarray(0, 4096).includes(0)) return reply(`${relative} 是二进制文件，不能当文字改。`, {error: 'binary'}, true);
          const original = buffer.toString('utf8');
          result = applyEdit(original, oldText, newText, {replaceAll: Boolean(params.replace_all)});
          if (!result.ok) return reply(`${relative}：${result.message}`, {error: result.reason, nearest: result.nearest}, true);
          fs.writeFileSync(file, result.content);
        }
        const lines = result.content.replace(/\r\n/g, '\n').split('\n');
        const from = Math.max(0, result.startLine - 3), to = Math.min(lines.length, result.endLine + 2);
        const out = [created ? `已新建 ${relative}（${lines.length} 行）。` : `已改 ${relative}${result.count > 1 ? `，共 ${result.count} 处，第一处在` : ''}第 ${result.startLine}–${result.endLine} 行。${result.fuzzy ? '你给的原文和文件里的缩进或空白不完全一样，已按文件里的缩进对上。' : ''}`];
        out.push(`现在的样子：\n${numbered(lines, from, Math.min(to, from + 40))}`);
        const problem = CODE_EXT.test(file) ? quickSyntax(file, {root}) : null;
        if (problem) out.push(`语法检查没过：第 ${problem.line} 行，${problem.message}。现在就修，修好之前不要接着改别的。`);
        else if (/\.(?:js|mjs|cjs|py|pyi|json|sh|bash)$/i.test(file)) out.push('语法检查通过（只查了语法；类型和整体检查用 code_check，行为用 run_tests）。');
        watch?.record(ctx?.sessionKey, file, problem);
        return reply(out.join('\n'), {changed: true, created, path: relative, absolutePath: file, count: result.count, startLine: result.startLine, endLine: result.endLine, fuzzy: Boolean(result.fuzzy), syntaxError: problem || undefined});
      } catch (error) {
        const message = String(error?.message || error);
        return reply(message, {error: message}, true);
      }
    },
  };
}

/* ───────── code_refs：定义在哪、谁在用 ───────── */

const definitionPattern = name => new RegExp([
  `(?:^|\\s)(?:async\\s+)?(?:def|function\\*?|class|interface|type|enum|struct|trait|fn|func|module|namespace)\\s+(?:\\([^)]*\\)\\s*)?${name}\\b`,
  `(?:^|\\s)(?:export\\s+)?(?:default\\s+)?(?:const|let|var|val)\\s+${name}\\s*(?::[^=]+)?=`,
  `^\\s*(?:public|private|protected|static|async|override|final|abstract|\\s)*${name}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{\\s*$`,
  `^\\s*(?:public|private|protected|internal|static|final|abstract|override|virtual|\\s)+[\\w<>\\[\\],.?]+\\s+${name}\\s*\\(`,
  `^\\s*${name}\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*=>|\\w+\\s*=>)`,
  `^${name}\\s*=`,
].join('|'));

export function findRefs(root, symbol, {glob = '', path: sub = '', max = 80, timeoutMs = 8000} = {}) {
  const name = String(symbol || '').trim();
  if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) throw new Error('symbol 要传一个名字（函数名、类名、变量名），不带括号和点。');
  const base = resolveInside(root, sub);
  const prefix = path.relative(root, base).split(path.sep).join('/');
  const scope = globToRegExp(glob);
  const word = new RegExp(`(?<![\\p{L}\\p{N}_$])${escapeRegExp(name)}(?![\\p{L}\\p{N}_$])`, 'u');
  const isDefinition = definitionPattern(escapeRegExp(name));
  const definitions = [], uses = [];
  let total = 0, files = 0;
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  for (const relative of walkFiles(base, {deadline})) {
    if (Date.now() > deadline) { timedOut = true; break; }
    const shown = prefix ? `${prefix}/${relative}` : relative;
    if (scope && !scope.test(shown)) continue;
    if (!CODE_EXT.test(relative) || /\.min\.(?:js|css)$|\.map$/.test(relative)) continue;
    let text;
    try {
      const file = path.join(base, relative);
      if (fs.statSync(file).size > 1_500_000) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    if (!text.includes(name)) continue;
    let hit = false;
    text.split('\n').forEach((line, index) => {
      if (!word.test(line)) return;
      hit = true; total += 1;
      const entry = {file: shown, line: index + 1, text: clip(line.trim(), 200)};
      const comment = /^\s*(?:\/\/|#|\*|\/\*|<!--)/.test(line);
      if (!comment && isDefinition.test(line)) definitions.push(entry);
      else if (uses.length < max) uses.push({...entry, ...(comment ? {comment: true} : {})});
    });
    if (hit) files += 1;
  }
  return {symbol: name, definitions: definitions.slice(0, 20), uses, total, files, truncated: total - definitions.length > uses.length, timedOut};
}

export function formatRefs(result) {
  if (!result.total) return `项目里没有「${result.symbol}」这个名字（按整个词找，区分大小写）。检查拼写和大小写，或者用 code_search 搜一部分。它也可能来自装的库，不在项目自己的代码里。`;
  const out = [];
  if (result.definitions.length) {
    out.push(`「${result.symbol}」的定义（${result.definitions.length} 处）：`);
    for (const item of result.definitions) out.push(`  ${item.file}:${item.line}: ${item.text}`);
  } else out.push(`没找到「${result.symbol}」在项目里的定义（可能来自库，或者是动态生成的）。`);
  const uses = result.uses.filter(item => !item.comment), comments = result.uses.filter(item => item.comment);
  out.push(`\n用到它的地方（${result.total - result.definitions.length} 处，在 ${result.files} 个文件里${result.truncated ? '，没列全' : ''}）：`);
  let last = '';
  for (const item of uses) { if (item.file !== last) { out.push(`\n${item.file}`); last = item.file; } out.push(`  ${item.line}: ${item.text}`); }
  if (comments.length) out.push(`\n另有 ${comments.length} 处在注释里：${comments.slice(0, 6).map(item => `${item.file}:${item.line}`).join('、')}`);
  out.push('\n改它的参数、返回值或名字时，上面每一处都要看过、该改的都改掉；字符串里拼出来的名字和别的语言的调用这里找不全，再用 code_search 搜一次。');
  if (result.timedOut) out.push('项目很大，没搜完；用 path 指到子目录再查。');
  return out.join('\n');
}

export function createCodeRefsTool(ctx, {rootFor} = {}) {
  return {
    name: 'code_refs', label: '查引用',
    description: '查一个名字（函数、类、变量）在项目里哪里定义、被哪些地方用到。按整个词找，自动跳过依赖和构建产物。改函数的参数、返回值、名字之前，或者要删一段代码之前先查它，把每个调用处都看到；读不懂一个函数从哪来时也用它。只读。symbol 传名字本身；可用 path 限定子目录、glob 限定文件类型。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        symbol: {type: 'string', description: '名字本身，如 parseOrder、UserService'},
        path: {type: 'string', description: '只在这个子目录里找'},
        glob: {type: 'string', description: '只看这类文件，如 "*.py"'},
        max: {type: 'integer', minimum: 1, maximum: 300, description: '最多列多少处，默认 80'},
      },
      required: ['symbol'],
    },
    async execute(toolCallId, params = {}) {
      try {
        const result = findRefs(rootFor(ctx), params.symbol, {glob: params.glob, path: params.path, max: params.max || 80});
        return reply(formatRefs(result), result);
      } catch (error) {
        const message = String(error?.message || error);
        return reply(message, {error: message}, true);
      }
    },
  };
}

/* ───────── CodeWatch：写文件的工具动了代码之后，自己查一遍语法 ───────── */

const WRITE_TOOL = /^(?:write|edit|apply_patch|multi_edit|write_file|edit_file)$/i;

export class CodeWatch {
  constructor({check = quickSyntax} = {}) {
    this.check = check;
    this.problems = new Map(); // sessionKey -> Map(file -> {line, message})
  }

  record(sessionKey, file, problem) {
    const key = String(sessionKey || '');
    if (!key || !file) return;
    let files = this.problems.get(key);
    if (!files) {
      if (this.problems.size >= 300) this.problems.delete(this.problems.keys().next().value);
      this.problems.set(key, files = new Map());
    }
    if (problem) files.set(file, problem); else files.delete(file);
    if (!files.size) this.problems.delete(key);
  }

  // after_tool_call：自带的写文件工具成功之后查它动过的文件。
  afterTool(event = {}, ctx = {}, {baseDirs = []} = {}) {
    const name = String(event.toolName || '');
    if (!WRITE_TOOL.test(name) || event.error || event.result?.isError) return;
    const params = event.params && typeof event.params === 'object' ? event.params : {};
    const raw = [];
    for (const key of ['path', 'file_path', 'filePath']) if (typeof params[key] === 'string' && params[key].trim()) raw.push(params[key].trim());
    if (/patch/i.test(name)) for (const value of Object.values(params)) if (typeof value === 'string') for (const match of value.matchAll(/^\*\*\* (?:Add|Update) File:\s*([^\r\n]+)/gm)) raw.push(match[1].trim());
    for (const value of [...new Set(raw)].slice(0, 12)) {
      if (!CODE_EXT.test(value)) continue;
      const candidates = path.isAbsolute(value) ? [value] : baseDirs.filter(Boolean).map(dir => path.resolve(dir, value));
      const file = candidates.find(exists);
      if (!file) continue;
      this.record(ctx.sessionKey, file, this.check(file, {root: baseDirs.find(Boolean) || ''}));
    }
  }

  // 下一次开口前：把还没修的语法错放到眼前。给之前重新查一遍，已经修好的不再提。
  block(sessionKey) {
    const files = this.problems.get(String(sessionKey || ''));
    if (!files?.size) return '';
    const lines = [];
    for (const [file] of [...files]) {
      const problem = exists(file) ? this.check(file) : null;
      if (!problem) { files.delete(file); continue; }
      files.set(file, problem);
      lines.push(`- ${file} 第 ${problem.line} 行：${problem.message}`);
    }
    if (!files.size) this.problems.delete(String(sessionKey || ''));
    if (!lines.length) return '';
    return `【改过的文件有语法错】系统在你写完文件之后自动查的，现在仍然没过：\n${lines.slice(0, 8).join('\n')}\n先把这些修好并确认通过，再做别的；修好之前不能说完成。`;
  }

  forget(sessionKey = '') { if (sessionKey) this.problems.delete(sessionKey); else this.problems.clear(); }
}

// 工具（workbench.mjs）和钩子（index.mjs）共用的那一个看守。
export const codeWatch = new CodeWatch();
