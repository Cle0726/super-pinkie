const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const stage = read('ui/injections/laolao-cle-stage.js');

// Cut a top-level `const X = …;` or `function x(…) {…}` out of the stage source.
function cut(source, start) {
  const at = source.indexOf(start);
  assert.ok(at >= 0, `missing ${start}`);
  let depth = 0;
  for (let i = at; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1;
      if (depth === 0 && start.startsWith('function') && ch === '}') return source.slice(at, i + 1);
    } else if (ch === ';' && depth === 0 && !start.startsWith('function')) return source.slice(at, i + 1);
  }
  throw new Error(`unterminated ${start}`);
}

function load(labels = {}) {
  const parts = [
    cut(stage, 'const VERB ='), cut(stage, 'const TOOL_KIND ='), cut(stage, 'const QUIZ_KINDS ='),
    cut(stage, 'const normTool ='), cut(stage, 'function kindOfCall('), cut(stage, 'function kindOf('),
    cut(stage, 'const firstLine ='), cut(stage, 'const homeless ='), cut(stage, 'function argText('),
    cut(stage, 'const cnNum ='), cut(stage, 'const DONE_WORD ='), cut(stage, 'function runLabel('),
  ];
  const context = {window: {__pinkieToolLabels: labels}};
  vm.runInNewContext(`${parts.join('\n')}\nthis.api = {VERB, TOOL_KIND, kindOfCall, kindOf, argText, runLabel};`, context);
  return context.api;
}
const rows = (...kinds) => kinds.map((k) => ({getAttribute: (name) => (name === 'data-tool-kind' ? k : null)}));

test('web search, page fetch and own tools are no longer counted as files or commands', () => {
  const {kindOfCall, kindOf} = load();
  assert.equal(kindOfCall('web_search'), 'search');
  assert.equal(kindOfCall('pinkie_search'), 'search');
  assert.equal(kindOfCall('web_fetch'), 'fetch');
  assert.equal(kindOfCall('app_browser'), 'browse');
  assert.equal(kindOfCall('learning_activity', {action: 'present', kind: 'single_choice'}), 'quiz');
  assert.equal(kindOfCall('learning_activity', {action: 'present', kind: 'function_plot'}), 'lab');
  assert.equal(kindOfCall('learning_activity', {action: 'resolve'}), 'grade');
  assert.equal(kindOfCall('pinkie_session_start'), 'session');
  assert.equal(kindOfCall('code_edit'), 'edit');
  assert.equal(kindOfCall('run_tests'), 'test');
  assert.equal(kindOf('Web Search'), 'search', 'native title-cased label');
  assert.equal(kindOf('exec'), 'exec');
  assert.equal(kindOf('read'), 'read');
  assert.equal(kindOf('some_new_tool'), 'exec', 'unknown names keep the old fallback');
});

test('Chinese labels from laolao-phrases map back to their category', () => {
  const {kindOf} = load({web_search: '搜索网页', learning_activity: '学习小练习', web_fetch: '看网页'});
  assert.equal(kindOf('搜索网页'), 'search');
  assert.equal(kindOf('学习小练习'), 'quiz');
  assert.equal(kindOf('看网页'), 'fetch');
});

test('every category has a live verb and a finished sentence', () => {
  const {VERB, TOOL_KIND, runLabel} = load();
  for (const kind of new Set(Object.values(TOOL_KIND))) {
    assert.ok(VERB[kind], `verb for ${kind}`);
    assert.doesNotMatch(runLabel(rows(kind)), /工具$/, `own sentence for ${kind}`);
  }
});

test('finished rows read like what was done', () => {
  const {runLabel} = load();
  assert.equal(runLabel(rows('search')), '搜了 1 次网页');
  assert.equal(runLabel(rows('search', 'fetch', 'fetch')), '搜了 1 次网页，看了 2 个网页');
  assert.equal(runLabel(rows('quiz')), '出了一道练习');
  assert.equal(runLabel(rows('exec', 'exec')), '运行了 2 个命令');
  assert.equal(runLabel(rows('search', 'fetch', 'exec')), '搜了 1 次网页，看了 1 个网页，共 3 步');
});

test('the status line shows the search words, and a quiz shows its stem instead of "present"', () => {
  const {argText} = load();
  assert.deepEqual({...argText('web_search', {query: 'San Francisco weather'})}, {text: 'San Francisco weather', mono: false});
  const quiz = argText('learning_activity', {action: 'present', kind: 'single_choice', question: '直角三角形两直角边 3 和 4，斜边是？'});
  assert.equal(quiz.text, '直角三角形两直角边 3 和 4，斜边是？');
  assert.notEqual(argText('learning_activity', {action: 'present', kind: 'batch'}).text, 'present');
});

test('tool labels are Chinese only and cover 碧琪 own tools', () => {
  const phrases = read('ui/injections/laolao-phrases.js');
  const table = /const toolLabels=(\{[\s\S]*?\});/.exec(phrases)[1];
  const labels = vm.runInNewContext(`(${table})`);
  const own = [...read('services/mode-architecture/index.mjs').matchAll(/registerTool\?\.\([^\n]*\{name: '([a-z_]+)'\}/g)].map((m) => m[1]);
  assert.ok(own.length >= 5);
  for (const name of [...own, 'pinkie_session_start', 'learning_activity', 'workbench_read', 'code_edit', 'run_tests', 'plan_update', 'web_gpt_activity']) {
    assert.ok(labels[name], `中文名 for ${name}`);
    assert.doesNotMatch(labels[name], /[a-z]{3,}_/i);
  }
  assert.doesNotMatch(phrases, /`\$\{label\} · \$\{core\}`/, 'English tool name is not appended to the label');
});
