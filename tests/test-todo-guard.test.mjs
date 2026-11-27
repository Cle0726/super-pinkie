// 守卫：tests/ 里不许出现「带函数体的 TODO 测试」。
// 原因：发版门禁 tools/release-gate/tap.mjs 只把 `# SKIP` 当跳过，`not ok … # TODO` 会被记成新失败，
// 而 known-failures.json 不许加条目；日常 CI 直接用 node --test 跑，TODO 失败不算红，平时看不出来。
// 本文件不改门禁语义，只在源码层面拦住下面三种写法（以及 it / describe / suite 的同类写法）：
//   1. test.todo('名字', () => {...})   —— todo 带了函数体或选项
//   2. test('名字', {todo: ...}, fn)     —— todo 选项会照常运行函数体
//   3. t.todo('原因')                    —— 把正在运行、带函数体的测试标成 TODO
// 合规写法：只登记名字，例如 test.todo('某某问题（待修源码）')。
// 扫描先把注释、字符串、模板字符串和正则的内容抹成空格（长度与换行不变），再按括号配对取参数，
// 所以写在注释或字符串里的样例不会误报。不起浏览器、不联网。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const TEST_FILE = /\.test\.(?:mjs|cjs|js)$/;
const TEST_FUNCS = ['test', 'it', 'describe', 'suite'];
const MODIFIERS = ['only', 'skip', 'todo'];
const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
// 这些符号之后出现的 `/` 是正则开头；`)`、`]`、标识符、数字和字符串之后是除号。
const REGEX_AFTER_PUNCT = /[(,=:[!&|?{};+\-*%<>~^]/;
const OPENERS = '([{', CLOSERS = ')]}';

// 返回与源码等长的两份文本：code 只抹注释；bare 还抹掉字符串、模板字符串和正则的内容（引号、反引号与 ${ } 保留）。
export function maskSource(source) {
  const n = source.length;
  const code = source.split(''), bare = source.split('');
  const blank = (arr, from, to) => {
    for (let k = from; k < to && k < n; k++) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
  };
  const braces = [];
  let i = 0, last = '', lastWord = '';
  const regexAllowed = () => REGEX_AFTER_WORDS.has(lastWord) || (lastWord === '' && (last === '' || REGEX_AFTER_PUNCT.test(last)));
  // 从模板字符串的一段文字开头扫到反引号或 `${`，返回下一个要处理的位置。
  const templateChunk = start => {
    let j = start;
    while (j < n) {
      const ch = source[j];
      if (ch === '\\') j += 2;
      else if (ch === '`') {
        blank(bare, start, j);
        last = ')'; lastWord = '';
        return j + 1;
      } else if (ch === '$' && source[j + 1] === '{') {
        blank(bare, start, j);
        braces.push('tpl');
        last = '{'; lastWord = '';
        return j + 2;
      } else j++;
    }
    blank(bare, start, n);
    return n;
  };
  if (source.startsWith('#!')) {
    const end = source.indexOf('\n');
    i = end < 0 ? n : end;
    blank(code, 0, i); blank(bare, 0, i);
  }
  while (i < n) {
    const c = source[i], d = source[i + 1];
    if (c === '/' && d === '/') {
      let end = source.indexOf('\n', i);
      if (end < 0) end = n;
      blank(code, i, end); blank(bare, i, end);
      i = end;
    } else if (c === '/' && d === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      blank(code, i, end); blank(bare, i, end);
      i = end;
    } else if (c === '\'' || c === '"') {
      // 普通字符串不能跨行：遇到换行就当它结束，免得一处没认出来的写法把后面整个文件吞掉。
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(bare, i + 1, j);
      i = j < n && source[j] === c ? j + 1 : j;
      last = ')'; lastWord = '';
    } else if (c === '`') {
      i = templateChunk(i + 1);
    } else if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < n && source[j] !== '\n') {
        const ch = source[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        j++;
      }
      blank(bare, i + 1, j);
      i = j + 1;
      while (i < n && /[\w$]/.test(source[i])) i++;
      last = ')'; lastWord = '';
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(source[j])) j++;
      lastWord = source.slice(i, j); last = 'a';
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(source[j])) j++;
      last = '0'; lastWord = '';
      i = j;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '}' && braces.at(-1) === 'tpl') {
      braces.pop();
      i = templateChunk(i + 1);
    } else {
      if (c === '{') braces.push('code');
      else if (c === '}') braces.pop();
      last = c; lastWord = '';
      i++;
    }
  }
  return {code: code.join(''), bare: bare.join('')};
}

function matchClose(text, open) {
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (OPENERS.includes(text[k])) depth++;
    else if (CLOSERS.includes(text[k]) && --depth === 0) return k;
  }
  return -1;
}

// 按顶层逗号切开 [from, to)，返回去掉首尾空白的各段位置；空段（如结尾多余的逗号）丢掉。
function splitTopLevel(text, from, to) {
  const parts = [];
  let depth = 0, start = from;
  const push = (s, e) => {
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) parts.push({start: s, end: e});
  };
  for (let k = from; k < to; k++) {
    if (OPENERS.includes(text[k])) depth++;
    else if (CLOSERS.includes(text[k])) depth--;
    else if (text[k] === ',' && depth === 0) { push(start, k); start = k + 1; }
  }
  push(start, to);
  return parts;
}

function isFunctionText(text) {
  if (/^(?:async\s+)?function\b/.test(text)) return true;
  let depth = 0;
  for (let k = 0; k < text.length - 1; k++) {
    if (OPENERS.includes(text[k])) depth++;
    else if (CLOSERS.includes(text[k])) depth--;
    else if (depth === 0 && text[k] === '=' && text[k + 1] === '>') return true;
  }
  return false;
}

// test / it / describe / suite 以及从 node:test 导入时起的别名。
function testFunctionNames(code) {
  const names = new Set(TEST_FUNCS);
  const addAliases = (list, separator) => {
    for (const part of list.split(',')) {
      const [orig, alias = orig] = part.trim().split(separator).map(s => s.trim());
      if ((TEST_FUNCS.includes(orig) || orig === 'default') && alias) names.add(alias);
    }
  };
  const from = String.raw`\s*from\s*(['"])node:test\2`;
  for (const m of code.matchAll(new RegExp(String.raw`\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?` + from, 'g'))) names.add(m[1]);
  for (const m of code.matchAll(new RegExp(String.raw`\bimport\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}` + from, 'g'))) addAliases(m[1], /\s+as\s+/);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])node:test\2\s*\)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])node:test\2\s*\)/g)) addAliases(m[1], /\s*:\s*/);
  return names;
}

function hasTodoKey(code, bare, arg) {
  const close = matchClose(bare, arg.start);
  if (close < 0) return false;
  return splitTopLevel(bare, arg.start + 1, close).some(({start, end}) =>
    /^todo\s*(?:[:(]|$)/.test(bare.slice(start, end)) || /^(['"])todo\1\s*:/.test(code.slice(start, end)));
}

// 扫一份测试源码，返回违规列表 [{line, kind, message, snippet}]。
export function scanSource(source) {
  const {code, bare} = maskSource(source);
  const names = testFunctionNames(code);
  const lines = source.split(/\r?\n/);
  const findings = [];
  const report = (index, kind, message) => {
    let line = 1;
    for (let k = 0; k < index; k++) if (source.charCodeAt(k) === 10) line++;
    findings.push({line, kind, message, snippet: lines[line - 1].trim().slice(0, 160)});
  };
  for (const m of bare.matchAll(/[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/g)) {
    const before = bare.slice(Math.max(0, m.index - 40), m.index).trimEnd();
    // 「/re/.test(」「foo().test(」之类不是从标识符开头的调用链；函数声明的参数表也不是调用。
    if (before.endsWith('.') || /\bfunction\s*\*?$/.test(before)) continue;
    const segs = m[0].slice(0, -1).split('.').map(s => s.trim());
    const last = segs.at(-1), prev = segs.at(-2);
    const isTodo = last === 'todo' && segs.length > 1;
    const isTest = names.has(last) || (names.has(prev) && MODIFIERS.includes(last));
    if (!isTodo && !isTest) continue;
    const callee = segs.join('.');
    if (isTodo && !names.has(prev)) {
      report(m.index, 'context-todo', `${callee}() 会把正在运行、带函数体的测试标成 TODO，失败时输出 not ok … # TODO`);
      continue;
    }
    const open = m.index + m[0].length - 1;
    const close = matchClose(bare, open);
    if (close < 0) continue;
    const args = splitTopLevel(bare, open + 1, close);
    if (isTodo && (args.length > 1 || args.some(({start, end}) => isFunctionText(bare.slice(start, end))))) {
      report(m.index, 'todo-body', `${callee}(…) 带了函数体或选项：TODO 只能登记名字，例如 ${callee}('…（待修源码）')`);
      continue;
    }
    if (args.some(arg => bare[arg.start] === '{' && hasTodoKey(code, bare, arg))) {
      report(m.index, 'todo-option', `${callee}(…) 用了 {todo: …} 选项：函数体照常运行，失败时输出 not ok … # TODO`);
    }
  }
  return findings;
}

// 递归扫 <root>/tests 下的 *.test.mjs / *.test.cjs / *.test.js（跳过 node_modules 与点开头的目录）。
export function scanTests(root) {
  const files = [], findings = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && TEST_FILE.test(entry.name)) {
        const file = path.relative(root, full).split(path.sep).join('/');
        files.push(file);
        for (const finding of scanSource(fs.readFileSync(full, 'utf8'))) findings.push({file, ...finding});
      }
    }
  };
  walk(path.join(root, 'tests'));
  return {files, findings};
}

const repo = fileURLToPath(new URL('../', import.meta.url));

test('tests/ 里没有带函数体的 test.todo 与 {todo} 选项（发版门禁会把 not ok … # TODO 记成失败）', () => {
  const {files, findings} = scanTests(repo);
  assert.ok(files.length > 0, '一个测试文件都没扫到，检查形同虚设');
  assert.ok(files.includes('tests/test-todo-guard.test.mjs'), '应扫到本文件自身');
  if (findings.length) {
    assert.fail([
      `发现 ${findings.length} 处会让发版门禁记失败的 TODO 写法（tools/release-gate/tap.mjs 只把 # SKIP 当跳过）：`,
      ...findings.map(f => `- ${f.file}:${f.line} ${f.message}\n    ${f.snippet}`),
      '改法：删掉函数体和 todo 选项，只写 test.todo(\'名字（待修源码）\')；要跑的断言就让它正常通过。',
    ].join('\n'));
  }
});

const kindsOf = source => scanSource(source).map(f => f.kind);

test('违规样例：带函数体的 todo、todo 选项、t.todo 都会被抓到', () => {
  const cases = [
    ['test.todo 带箭头函数', "test.todo('x', () => { assert.fail('坏'); });", ['todo-body']],
    ['test.todo 带 async 函数', "test.todo('x', async t => {});", ['todo-body']],
    ['test.todo 带 function', "test.todo('x', function () {});", ['todo-body']],
    ['test.todo 带选项和函数', "test.todo('x', {timeout: 5}, () => {});", ['todo-body']],
    ['test.todo 只给函数', 'test.todo(() => {});', ['todo-body']],
    ['test.todo 带函数引用', "test.todo('x', check);", ['todo-body']],
    ['todo 选项为 true', "test('x', {todo: true}, () => {});", ['todo-option']],
    ['todo 选项在后面', "test('x', {timeout: 1, todo: '待修'}, fn);", ['todo-option']],
    ['带引号的 todo 键', "test('x', {'todo': true}, fn);", ['todo-option']],
    ['简写 todo 键', "const todo = true;\ntest('x', {todo}, fn);", ['todo-option']],
    ['it.todo 带函数', "it.todo('x', () => {});", ['todo-body']],
    ['describe.todo 带函数', "describe.todo('x', () => {});", ['todo-body']],
    ['suite 带 todo 选项', "suite('x', {todo: 1}, () => {});", ['todo-option']],
    ['describe 里的同类写法', "describe('s', () => {\n  it.todo('y', () => {});\n  it('z', {todo: 1}, () => {});\n});", ['todo-body', 'todo-option']],
    ['test.only 带 todo 选项', "test.only('x', {todo: true}, fn);", ['todo-option']],
    ['describe 带 todo 选项', "describe('s', {todo: true}, () => {});", ['todo-option']],
    ['子测试 t.test 带 todo 选项', "test('x', async t => {\n  await t.test('y', {todo: true}, () => {});\n});", ['todo-option']],
    ['t.todo 标记运行中的测试', "test('x', t => {\n  t.todo('原因');\n  assert.fail();\n});", ['context-todo']],
    ['别名导入', "import {test as nodeTest} from 'node:test';\nnodeTest.todo('x', () => {});", ['todo-body']],
    ['require 别名', "const {it: spec} = require('node:test');\nspec('x', {todo: true}, () => {});", ['todo-option']],
    ['命名空间导入', "import * as nt from 'node:test';\nnt.test.todo('x', () => {});", ['todo-body']],
    ['模板字符串名字', 'test.todo(`名字 ${1 + 2}`, () => {});', ['todo-body']],
  ];
  for (const [name, source, kinds] of cases) assert.deepEqual(kindsOf(source), kinds, name);
});

test('违规样例：跨行写法报在调用起始行，CRLF 不影响行号', () => {
  const source = ['// 第一行注释', 'test.todo(', "  'x',", '  () => {', '  },', ');'].join('\r\n');
  assert.deepEqual(scanSource(source).map(({line, kind}) => ({line, kind})), [{line: 2, kind: 'todo-body'}]);
});

test('合规样例不报：无函数体的 todo、注释与字符串里的样例、无关的 todo 字段', () => {
  const cases = [
    ['只有名字', "test.todo('drill-qa.mjs 的检查匹配不到（待修源码）');"],
    ['结尾多一个逗号', 'test.todo("x",);'],
    ['it / describe 只有名字', "it.todo('x');\ndescribe.todo('y');\nsuite.todo(name);"],
    ['别名只有名字', "import {test as nodeTest} from 'node:test';\nnodeTest.todo('x');"],
    ['行注释', "// test.todo('x', () => {})\ntest('ok', () => {});"],
    ['块注释', "/* test('x', {todo: true}, fn) */\ntest('ok', () => {});"],
    ['字符串', "const s = \"test.todo('x', () => {})\";\nconst s2 = 'test(\\'x\\', {todo: true}, fn)';"],
    ['模板字符串', 'const tpl = `test.todo(\'x\', () => {}) ${"{todo: true}"}`;'],
    ['正则', String.raw`assert.match(out, /test\.todo\('x', \(\) => \{\}\)/);` + '\n' + String.raw`const hit = /\.todo\(/.test(line);`],
    ['普通对象里的 todo 字段', "const fixture = {todo: 3};\ntest('x', () => {\n  assert.deepEqual(count({todo: 1}), fixture);\n});"],
    ['skip / timeout 选项', "test('x', {skip: '原因'}, fn);\ntest('y', {timeout: 1000}, fn);"],
    ['除号不当正则', "const half = total / 2, r = a / b / c;\ntest.todo('ok');"],
    ['return 后的正则', "function f() { return /'/.test(x); }\ntest.todo('ok');"],
    ['函数声明不算调用', 'function test(name, {todo}) {}'],
  ];
  for (const [name, source] of cases) assert.deepEqual(scanSource(source), [], name);
});

test('遮罩自检：长度与换行不变，注释和字符串内容被抹掉', () => {
  const source = "a('s(t)r'); // c(\n/* x{ */ b(`t ${c('u')} v`, /re(/g);\r\n";
  const {code, bare} = maskSource(source);
  assert.equal(code.length, source.length);
  assert.equal(bare.length, source.length);
  assert.equal(bare.split(/\r?\n/).length, source.split(/\r?\n/).length);
  assert.equal(code.split('\n')[0].trimEnd(), "a('s(t)r');");
  assert.equal(bare.split('\n')[0].trimEnd(), "a('     ');");
  assert.equal(bare.split('\n')[1].trim(), "b(`  ${c(' ')}  `, /   /g);");
});

test('目录扫描：递归扫 tests/ 下三种扩展名，不扫辅助文件，返回相对路径', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-todo-guard-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const files = {
    'tests/bad.test.cjs': "test.todo('x', () => {});\n",
    'tests/good.test.js': "test.todo('x');\n",
    'tests/sub/nested.test.mjs': "\nit('y', {todo: true}, () => {});\n",
    'tests/helper.mjs': "test.todo('x', () => {});\n",
    'tests/node_modules/dep.test.mjs': "test.todo('x', () => {});\n",
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
    fs.writeFileSync(path.join(dir, file), text);
  }
  const result = scanTests(dir);
  assert.deepEqual(result.files, ['tests/bad.test.cjs', 'tests/good.test.js', 'tests/sub/nested.test.mjs']);
  assert.deepEqual(result.findings.map(({file, line, kind}) => ({file, line, kind})), [
    {file: 'tests/bad.test.cjs', line: 1, kind: 'todo-body'},
    {file: 'tests/sub/nested.test.mjs', line: 2, kind: 'todo-option'},
  ]);
});
