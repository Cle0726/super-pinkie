import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CARD_IDS, codeSituation, forgetCards, pickCard, workCardBlock} from '../services/mode-architecture/work-cards.mjs';
import {WORK_KINDS, classifyWorkKind} from '../services/mode-architecture/work-kinds.mjs';
import {boundProjectRoot, forgetBrief, projectBrief, projectBriefBlock} from '../services/mode-architecture/project-brief.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-brief-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); };

test('code requests are split by situation', () => {
  assert.equal(codeSituation('帮我看看这段代码有没有问题'), 'review');
  assert.equal(codeSituation('给 utils.py 补几个单元测试'), 'test');
  assert.equal(codeSituation('把这个文件重构一下，拆成几个函数'), 'refactor');
  assert.equal(codeSituation('登录接口报错 500，修一下'), 'bug');
  assert.equal(codeSituation('写一个批量改文件名的脚本'), 'new');
  assert.equal(codeSituation('给记录页加一个按月导出'), 'change');
  assert.equal(codeSituation(''), 'change');
});

test('a code message gets a short card that ends with the full playbook path', () => {
  forgetCards();
  const card = workCardBlock(['code'], '给记录页加一个按月导出', {mode: 'project', sessionKey: 'agent:project:a', playbookRoot: '/ws'});
  assert.match(card, /^【这件活：在已有项目里改代码】/);
  assert.match(card, /不编命令/);
  assert.match(card, /code_edit/);
  assert.match(card, /run_tests/);
  assert.ok(card.endsWith(path.join('/ws', 'playbooks', 'coding.md')));
  assert.ok(card.length < 900, `card is ${card.length} chars`);
});

test('the same card is given in full once per session, again after compaction', () => {
  forgetCards();
  const options = {mode: 'project', sessionKey: 'agent:project:b', playbookRoot: '/ws'};
  const first = workCardBlock(['code'], '登录报错了', options);
  const second = workCardBlock(['code'], '还是报错', options);
  assert.match(first, /1\. 先复现/);
  assert.ok(second.length < 160 && /前面给过/.test(second), second);
  assert.match(workCardBlock(['code'], '写一个爬虫脚本', options), /1\. 技术我来选/, 'a different card is still given in full');
  forgetCards('agent:project:b');
  assert.match(workCardBlock(['code'], '又报错', options), /1\. 先复现/);
});

test('no card for the unrestricted mode, small talk, or kinds without a card', () => {
  forgetCards();
  assert.equal(workCardBlock(['code'], '写个脚本', {mode: 'none'}), '');
  assert.equal(workCardBlock(['simple'], '你好', {mode: 'project'}), '');
  assert.equal(workCardBlock(['writing'], '写一篇小红书', {mode: 'project'}), '');
  assert.equal(workCardBlock([], '', {mode: 'project'}), '');
  assert.equal(pickCard(['writing', 'web_ui'], '做个页面'), 'web_ui');
});

test('every card stays short and points at a playbook that ships in every mode', () => {
  for (const id of CARD_IDS) {
    forgetCards();
    const [kind] = id.split('.');
    const prompts = {review: '帮我看看这段代码', test: '补单元测试', refactor: '重构一下', bug: '报错了', new: '写一个脚本', change: '加个功能'};
    const card = workCardBlock([kind], prompts[id.split('.')[1]] || '做一下', {mode: 'project'});
    assert.ok(card, id);
    assert.ok(card.length <= 900, `${id}: ${card.length}`);
    const book = /playbooks\/([a-z-]+\.md)$/.exec(card)?.[1];
    assert.ok(book, id);
    for (const mode of ['chat', 'project', 'thinking', 'learning']) assert.ok(fs.existsSync(path.join(ROOT, 'personas', mode, 'playbooks', book)), `${mode}/${book}`);
  }
});

test('the code kind routes to the coding playbooks, and they exist', () => {
  assert.deepEqual([...WORK_KINDS.code.playbooks], ['coding.md', 'debugging.md', 'code-stacks.md']);
  assert.ok(classifyWorkKind('把 utils.js 重构一下', {mode: 'project'}).kinds.includes('code'));
});

test('project mode gives a code card to coding requests the classifier leaves as simple', () => {
  const card = (prompt, mode = 'project') => pickCard(classifyWorkKind(prompt, {mode}).kinds, prompt, {mode});
  assert.equal(card('实现一个 LRU 缓存'), 'code.new');
  assert.equal(card('加个暗色模式'), 'code.change');
  assert.equal(card('add pagination to the users endpoint'), 'code.change');
  assert.equal(card('登录接口报 500 了'), 'code.bug');
  assert.equal(card('为什么我的 for 循环只跑一次'), 'code.bug');
  assert.equal(card('合并冲突了帮我解决'), 'code.bug');
  assert.equal(card('这个函数是干嘛的'), 'code.review');
  assert.equal(card('把这个 Python 2 的脚本升级到 3'), 'code.change');
  assert.equal(card('这个项目怎么跑起来'), 'code.change');
  assert.equal(card('给这个项目加一个导出 CSV 的函数'), 'code.change');
  assert.equal(card('fix the failing test in auth.test.ts'), 'debugging');
  // 不是在要改代码的，不给卡
  for (const prompt of ['你好', '谢谢', '今天天气怎么样', '你是什么模型', '帮我写一篇小红书文案', '给我讲个笑话', '好的']) assert.ok(!card(prompt).startsWith('code.'), prompt);
  // 别的模式不放宽
  assert.equal(card('加个暗色模式', 'chat'), '');
  assert.equal(card('实现一个 LRU 缓存', 'thinking'), '');
});

test('project brief reads real commands from package.json and never invents a test command', () => {
  const root = tmp();
  write(path.join(root, 'package.json'), JSON.stringify({type: 'module', scripts: {dev: 'vite', lint: 'eslint .', test: 'echo "Error: no test specified" && exit 1', seed: 'node seed.js'}, dependencies: {react: '^19', vite: '^7'}}));
  write(path.join(root, 'pnpm-lock.yaml'), '');
  write(path.join(root, 'src/App.jsx'), '');
  write(path.join(root, 'node_modules/x/index.js'), '');
  write(path.join(root, 'README.md'), '# demo');
  write(path.join(root, 'AGENTS.md'), 'rules');
  write(path.join(root, '.git/HEAD'), 'ref: refs/heads/feature/导出\n');
  const brief = projectBrief(root);
  assert.match(brief, /Node\.js（React、Vite）/);
  assert.match(brief, /包管理器 pnpm/);
  assert.match(brief, /启动：pnpm run dev（= vite）/);
  assert.match(brief, /没有可用的 test 命令，不要直接跑 npm test/);
  assert.match(brief, /检查：pnpm run lint/);
  assert.match(brief, /其他脚本：seed/);
  assert.match(brief, /项目自己的规矩：AGENTS\.md/);
  assert.match(brief, /当前分支 feature\/导出/);
  assert.match(brief, /src\/：App\.jsx/);
  assert.match(brief, /不用看的：node_modules/);
  assert.ok(!/node_modules\/：/.test(brief));
  assert.ok(brief.length <= 1400);
});

test('project brief handles Python, plain web pages, unknown and missing folders', () => {
  const py = tmp();
  write(path.join(py, 'requirements.txt'), 'flask\npytest\n');
  write(path.join(py, 'app.py'), '');
  write(path.join(py, 'tests/test_app.py'), '');
  const brief = projectBrief(py);
  assert.match(brief, /Python（Flask）/);
  assert.match(brief, /还没有虚拟环境/);
  assert.match(brief, /测试：python -m pytest -q/);
  assert.match(brief, /没有 git/);

  const web = tmp();
  write(path.join(web, '我的 页面/index.html'), '<p>');
  write(path.join(web, 'index.html'), '<p>');
  assert.match(projectBrief(web), /纯网页/);

  const unknown = tmp();
  write(path.join(unknown, 'notes.txt'), 'x');
  assert.match(projectBrief(unknown), /没认出来/);

  assert.equal(projectBrief(tmp()), '', 'an empty folder has nothing to say');
  assert.equal(projectBrief(path.join(os.tmpdir(), 'no-such-folder-pinkie')), '');
  assert.equal(projectBrief(''), '');
});

test('a broken package.json is reported, not thrown', () => {
  const root = tmp();
  write(path.join(root, 'package.json'), '{oops');
  assert.match(projectBrief(root), /解析不了/);
});

test('the brief follows the session binding, is given once, and again when the project changes', () => {
  forgetBrief();
  const state = tmp();
  const project = tmp();
  write(path.join(project, 'package.json'), JSON.stringify({scripts: {start: 'node a.js'}}));
  write(path.join(state, 'project-scope/bindings.json'), JSON.stringify({'agent:project:s1': {root: project, name: 'demo', created: 1}}));
  assert.equal(boundProjectRoot('agent:project:s1', {stateRoot: state}), project);
  assert.equal(boundProjectRoot('agent:project:other', {stateRoot: state}), '');
  assert.equal(boundProjectRoot('agent:project:s1', {stateRoot: tmp()}), '', 'no bindings file');
  assert.match(projectBriefBlock('agent:project:s1', {stateRoot: state}), /启动：npm start/);
  assert.equal(projectBriefBlock('agent:project:s1', {stateRoot: state}), '', 'not repeated');
  assert.equal(projectBriefBlock('agent:project:other', {stateRoot: state}), '', 'unbound session');
  const later = new Date(Date.now() + 5000);
  write(path.join(project, 'package.json'), JSON.stringify({scripts: {start: 'node b.js'}}));
  fs.utimesSync(path.join(project, 'package.json'), later, later);
  assert.match(projectBriefBlock('agent:project:s1', {stateRoot: state}), /node b\.js/, 'changed package.json is re-read');
  forgetBrief('agent:project:s1');
  assert.match(projectBriefBlock('agent:project:s1', {stateRoot: state}), /node b\.js/, 'given again after compaction');
});

test('end to end: the real prompt hook adds the card and the project brief for a coding message, and not for small talk', async (t) => {
  const {ModeArchitecture} = await import('../services/mode-architecture/index.mjs');
  forgetCards(); forgetBrief();
  const state = tmp(), workspace = tmp(), project = tmp();
  write(path.join(project, 'package.json'), JSON.stringify({scripts: {dev: 'vite', test: 'vitest run'}}));
  write(path.join(project, 'src/main.js'), '');
  const sessionKey = 'agent:project:e2e';
  write(path.join(state, 'project-scope/bindings.json'), JSON.stringify({[sessionKey]: {root: project, name: 'demo', created: 1}}));
  const before = process.env.PINKIE_STATE_ROOT;
  process.env.PINKIE_STATE_ROOT = state;
  t.after(() => { if (before === undefined) delete process.env.PINKIE_STATE_ROOT; else process.env.PINKIE_STATE_ROOT = before; });
  const runtime = new ModeArchitecture();
  const ctx = {agentId: 'project', sessionKey, workspaceDir: workspace};
  const first = runtime.prompt({prompt: '加个暗色模式', messages: []}, ctx).appendSystemContext;
  assert.match(first, /【这件活：在已有项目里改代码】/);
  assert.ok(first.includes(path.join(workspace, 'playbooks', 'coding.md')), 'the playbook path is absolute, inside the mode workspace');
  assert.match(first, /【项目速览】/);
  assert.match(first, /测试：npm test（= vitest run）/);
  const second = runtime.prompt({prompt: '给 parser.js 再加一个参数', messages: []}, ctx).appendSystemContext;
  assert.match(second, /前面给过的那张要点卡/);
  assert.doesNotMatch(second, /【项目速览】/, 'the brief is not repeated while the project is unchanged');
  const chat = runtime.prompt({prompt: '谢谢', messages: []}, ctx).appendSystemContext;
  assert.doesNotMatch(chat, /【这件活/);
  runtime.afterCompaction({}, {sessionKey});
  const again = runtime.prompt({prompt: '登录接口报 500 了', messages: []}, ctx).appendSystemContext;
  assert.match(again, /【这件活：修 bug】\S*\n?[\s\S]*1\. 先复现/);
  assert.match(again, /【项目速览】/, 'given again after compaction');
  const unrestricted = runtime.prompt({prompt: '加个暗色模式', messages: []}, {agentId: 'unrestricted', sessionKey: 'agent:unrestricted:x', workspaceDir: workspace}).appendSystemContext || '';
  assert.doesNotMatch(unrestricted, /【这件活/);
});
