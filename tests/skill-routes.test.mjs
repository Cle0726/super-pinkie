import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SKILL_ROUTES, readRange, resolveSkillFile, routeSkills, skillRouteBlock} from '../services/mode-architecture/skill-routes.mjs';
import {classifyWorkKind} from '../services/mode-architecture/work-kinds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'skills');
const manifest = JSON.parse(fs.readFileSync(path.join(SKILLS, 'community-skills.json'), 'utf8'));
const names = manifest.skills.map(s => s.name);
const own = (manifest.own || []).map(s => s.name);
const route = (text, mode = 'main') => routeSkills(classifyWorkKind(text, {mode}).kinds, text).map(r => r.skill);

test('every routed skill ships, and every shipped community skill is complete and licensed', () => {
  const shipped = new Set([...names, ...own, 'deep-think', 'pinkie-deep-research', 'web-gpt-collab']);
  for (const name of own) {
    const md = fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
    assert.match(md, /^---\ndisable-model-invocation: true\n/, `${name} must stay out of the catalog`);
    assert.match(md, new RegExp(`^name: ${name}$`, 'm'));
  }
  for (const item of manifest.skills.filter(s => s.fetch)) {
    const md = fs.readFileSync(path.join(SKILLS, item.name, 'SKILL.md'), 'utf8');
    assert.match(md, new RegExp(`fetch_skill\\.py" ${item.name}`), `${item.name} stub must say how to download`);
    assert.ok(fs.readdirSync(path.join(SKILLS, item.name)).length <= 4, `${item.name} is downloaded on first use, not shipped`);
  }
  assert.ok(fs.existsSync(path.join(SKILLS, 'pinkie-skill-library', 'fetch_skill.py')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(SKILLS, 'pinkie-skill-library', 'community-skills.json'), 'utf8')).skills.length, names.length);
  for (const r of SKILL_ROUTES) assert.ok(shipped.has(r.skill), `${r.skill} is routed but not shipped`);
  assert.equal(new Set(names).size, names.length, 'duplicate skill names');
  for (const name of names) {
    const dir = path.join(SKILLS, name);
    const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    assert.match(md, /^---\ndisable-model-invocation: true\n/, `${name} must stay out of the 18k skill catalog`);
    assert.match(md, new RegExp(`^name: ["']?${name}["']?$`, 'm'), `${name} frontmatter name`);
    assert.ok(['LICENSE', 'LICENSE.txt', 'LICENSE.md'].some(f => fs.existsSync(path.join(dir, f))), `${name} has no license`);
    assert.ok(fs.existsSync(path.join(dir, 'SOURCE.md')), `${name} has no SOURCE.md`);
    assert.ok(statSize(md) <= 256_000, `${name} SKILL.md is over OpenClaw's 256 KB limit`);
    for (const file of walk(dir)) assert.ok(!/\.(?:mp4|mov|webm|mkv)$/i.test(file), `${file}: sample videos are not shipped`);
  }
  const index = fs.readFileSync(path.join(SKILLS, 'pinkie-skill-library', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(index, /disable-model-invocation/, 'the index is the one catalog entry');
  for (const name of [...own, ...names]) assert.ok(index.includes(`\`../${name}/SKILL.md\``), `${name} missing from the index`);
  const notices = fs.readFileSync(path.join(SKILLS, 'THIRD_PARTY_SKILLS.md'), 'utf8');
  for (const name of names) assert.ok(notices.includes(`| ${name} |`), `${name} missing from THIRD_PARTY_SKILLS.md`);
});

test('both builds ship the manifest, the index and the notices', () => {
  const mac = fs.readFileSync(path.join(ROOT, 'desktop/macos/build.sh'), 'utf8');
  const win = fs.readFileSync(path.join(ROOT, 'build-win.ps1'), 'utf8');
  for (const text of [mac, win]) {
    assert.match(text, /community-skills\.json/);
    assert.match(text, /pinkie-skill-library/);
    assert.match(text, /THIRD_PARTY_SKILLS\.md/);
  }
  for (const file of ['services/mode-architecture/setup.py', 'installer/macos/apply-theme.sh']) {
    assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /skill-routes\.mjs/, `${file} must install the router`);
  }
  const shared = fs.readFileSync(path.join(ROOT, 'services/mode-architecture/index.mjs'), 'utf8');
  for (const needle of ['skillRouteBlock(', 'waitingSection(', 'runningBackgroundJobs(', "'\\n' + BACKGROUND_WORK_RULES + '\\n'"]) {
    assert.ok(shared.includes(needle), `shared mode engine lacks ${needle}`);
  }
});

test('routing picks the specific skill for what the user said', () => {
  const cases = [
    ['帮我做个小红书封面 讲租房避坑', 'xhs-cover-templates'],
    ['给我的奶茶店做个logo', 'brand'],
    ['剪一个30秒的抖音广告 卖咖啡', 'social-ad'],
    ['做个水墨风格的中秋短片', 'lemo-opuscar'],
    ['照着这个视频做一个一样的', 'reverse-any-video'],
    ['做个产品演示视频', 'product-walkthrough'],
    ['把这个流程做成一张信息图', 'infographic-creator'],
    ['做个记账网页', 'ui-ux-pro-max'],
    ['做个表情包GIF', 'slack-gif-creator'],
    ['帮我做个周报PPT', 'ppt-master'],
    ['做一份讲解光合作用的课件', 'morph-ppt'],
    ['做个融资路演的PPT', 'officecli-pitch-deck'],
    ['做个网页版的幻灯片', 'frontend-slides'],
    ['帮我做个工资表 excel 带公式', 'officecli-xlsx'],
    ['把这份合同排成 word 文档', 'officecli-docx'],
    ['画一张系统架构图', 'archify'],
    ['画个项目甘特图', 'pretty-mermaid'],
    ['做个3D产品展示页面', 'threejs-fundamentals'],
    ['做个打地鼠小游戏', 'game-prototype'],
    ['帮我做淘宝详情页', 'taobao-detail-long-image'],
    ['帮我做个一寸蓝底证件照', 'pinkie-id-photo'],
    ['把这张图抠出来换成白底', 'pinkie-remove-background'],
    ['给孩子做一张田字格字帖', 'pinkie-kids-worksheets'],
    ['出100道20以内口算题', 'pinkie-kids-worksheets'],
    ['帮我做一份简历', 'pinkie-resume'],
    ['给我的奶茶店起个名字', 'naming'],
    ['帮我写个产品文案', 'copywriting'],
    ['做个公司官网', 'design-taste-frontend'],
    ['把这个pdf转成图片看看排版', 'pdf'],
    ['npm test 报错了', 'systematic-debugging'],
    ['能帮我做个小红书封面吗？', 'xhs-cover-templates'],
    ['帮我做个婚礼请柬', 'canvas-design'],
  ];
  const misses = cases.map(([text, skill]) => [text, skill, route(text)]).filter(([, skill, got]) => !got.includes(skill));
  assert.deepEqual(misses, []);
  for (const [text] of cases) assert.ok(route(text).length <= 3, text);
  // 做视频永远带上总入口
  assert.ok(route('剪一个30秒的抖音广告 卖咖啡').includes('hyperframes'));
});

test('chat, questions and thanks get no skills', () => {
  for (const text of ['你好', '谢谢', '长跑档是什么意思？', '帮我写封邮件跟客户道歉', '小红书是什么？', '什么是信息图？']) {
    assert.deepEqual(route(text), [], text);
  }
});

test('the block resolves real paths (workspace > state dir > bundled), and never runs in unrestricted mode', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-routes-'));
  try {
    const bundled = path.join(temp, 'bundled'), state = path.join(temp, 'state'), workspace = path.join(temp, 'ws');
    for (const [root, name] of [[bundled, 'brand'], [bundled, 'canvas-design'], [state, 'brand'], [workspace, 'canvas-design']]) {
      fs.mkdirSync(path.join(root, name), {recursive: true});
      fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
    }
    fs.mkdirSync(path.join(state, 'skills', 'brand'), {recursive: true});
    fs.renameSync(path.join(state, 'brand', 'SKILL.md'), path.join(state, 'skills', 'brand', 'SKILL.md'));
    fs.mkdirSync(path.join(workspace, 'skills', 'canvas-design'), {recursive: true});
    fs.renameSync(path.join(workspace, 'canvas-design', 'SKILL.md'), path.join(workspace, 'skills', 'canvas-design', 'SKILL.md'));
    const opts = {workspace, stateDir: state, managedDir: bundled};
    assert.equal(resolveSkillFile('brand', opts), path.join(state, 'skills', 'brand', 'SKILL.md'));
    assert.equal(resolveSkillFile('canvas-design', opts), path.join(workspace, 'skills', 'canvas-design', 'SKILL.md'));
    assert.equal(resolveSkillFile('banner-design', opts), '');
    const text = '给我的奶茶店做个logo';
    const kinds = classifyWorkKind(text).kinds;
    const block = skillRouteBlock(kinds, text, {...opts, mode: 'main', playbook: 'playbooks/images-and-print.md'});
    assert.match(block, /【这件活先用这些现成的技能】/);
    assert.ok(block.includes(path.join(state, 'skills', 'brand', 'SKILL.md')));
    assert.match(block, /以打法为准.*playbooks\/images-and-print\.md/);
    assert.equal(skillRouteBlock(kinds, text, {...opts, mode: 'none'}), '');
    assert.equal(skillRouteBlock(kinds, text, {workspace: path.join(temp, 'nothing'), stateDir: path.join(temp, 'nothing'), managedDir: path.join(temp, 'nothing'), mode: 'main'}), '');
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});

test('very long SKILL.md files say where to stop reading', () => {
  const file = path.join(SKILLS, 'social-ad', 'SKILL.md');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const appendix = lines.findIndex(line => /^#{1,3}\s*(?:\d+\.\s*)?appendix\b/i.test(line));
  assert.ok(appendix > 100);
  assert.match(readRange(file), new RegExp(`^只读第 1–${appendix} 行`));
  assert.equal(readRange(path.join(SKILLS, 'brand', 'SKILL.md')), '');
  const block = skillRouteBlock(['video_motion'], '剪一个30秒的抖音广告 卖咖啡', {managedDir: SKILLS, mode: 'main'});
  assert.match(block, /social-ad.*只读第 1–\d+ 行/);
});

function statSize(text) { return Buffer.byteLength(text); }
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full); else yield full;
  }
}

// ---------- 接到插件里：每条消息的系统上下文 ----------
test('the plugin prompt carries routed skills, the while-waiting list and still-running jobs; unrestricted gets none', async t => {
  delete process.env.PINKIE_MANAGED_GATEWAY;
  delete process.env.OPENCLAW_SERVICE_KIND;
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-routes-state-'));
  const previousState = process.env.PINKIE_STATE_ROOT, previousManaged = process.env.PINKIE_MANAGED_SKILLS_DIR;
  process.env.PINKIE_STATE_ROOT = stateRoot;
  process.env.PINKIE_MANAGED_SKILLS_DIR = SKILLS;
  const {ModeArchitecture} = await import('../services/mode-architecture/index.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-routes-ws-'));
  const STATE = Symbol.for('pinkie.backgroundJobs.v1');
  const hadShared = Boolean(globalThis[STATE]);
  t.after(() => {
    fs.rmSync(root, {recursive: true, force: true});
    fs.rmSync(stateRoot, {recursive: true, force: true});
    if (previousState === undefined) delete process.env.PINKIE_STATE_ROOT; else process.env.PINKIE_STATE_ROOT = previousState;
    if (previousManaged === undefined) delete process.env.PINKIE_MANAGED_SKILLS_DIR; else process.env.PINKIE_MANAGED_SKILLS_DIR = previousManaged;
    if (!hadShared) delete globalThis[STATE];
  });
  for (const dir of ['persona', 'memory/context/sessions']) fs.mkdirSync(path.join(root, dir), {recursive: true});
  fs.writeFileSync(path.join(root, 'persona/core.md'), 'persona');
  const runtime = new ModeArchitecture();
  const sessionKey = 'agent:main:routes';
  const context = runtime.prompt({prompt: '剪一个30秒的抖音广告 卖咖啡', messages: []}, {agentId: 'main', sessionKey, workspaceDir: root}).appendSystemContext;
  assert.match(context, /【这件活先用这些现成的技能】/);
  assert.ok(context.includes(path.join(SKILLS, 'social-ad', 'SKILL.md')));
  assert.match(context, /【这件活放后台等的时候】.*抽帧/);
  assert.match(context, /【长时间命令放后台】[\s\S]*真的没有不依赖它的事了，才结束这一轮/);
  assert.doesNotMatch(context, /【后台还在跑】/);
  const chat = runtime.prompt({prompt: '你好', messages: []}, {agentId: 'main', sessionKey, workspaceDir: root}).appendSystemContext;
  assert.doesNotMatch(chat, /【这件活先用这些现成的技能】|【这件活放后台等的时候】/);
  globalThis[STATE] ||= {jobs: new Map(), timer: null};
  globalThis[STATE].jobs.set('bg-test', {id: 'bg-test', sessionKey, state: 'running', command: 'npx hyperframes render  index.html', startedAt: Date.now() - 5 * 60_000});
  try {
    const busy = runtime.prompt({prompt: '顺便问一下，封面用什么颜色好？', messages: []}, {agentId: 'main', sessionKey, workspaceDir: root}).appendSystemContext;
    assert.match(busy, /【后台还在跑】「npx hyperframes render index\.html」（已跑约 5 分钟）/);
  } finally { globalThis[STATE].jobs.delete('bg-test'); }
  const free = runtime.prompt({prompt: '剪一个30秒的抖音广告 卖咖啡', messages: []}, {agentId: 'unrestricted', sessionKey: 'agent:unrestricted:x', workspaceDir: root}).appendSystemContext || '';
  assert.doesNotMatch(free, /【这件活先用这些现成的技能】|【这件活放后台等的时候】/);
});

test('the Windows build layout (repo services + Mac snapshot overlay) routes too', async t => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-winstage-'));
  t.after(() => fs.rmSync(stage, {recursive: true, force: true}));
  fs.cpSync(path.join(ROOT, 'services/mode-architecture'), path.join(stage, 'mode-architecture'), {recursive: true});
  const snapshot = path.join(ROOT, 'desktop/windows/mac-runtime');
  for (const line of fs.readFileSync(path.join(snapshot, 'SHA256SUMS'), 'utf8').split('\n')) {
    const rel = line.split('  ')[1]?.trim();
    if (rel?.startsWith('services/mode-architecture/')) fs.copyFileSync(path.join(snapshot, rel), path.join(stage, rel.slice('services/'.length)));
  }
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-winstage-ws-'));
  t.after(() => fs.rmSync(ws, {recursive: true, force: true}));
  fs.mkdirSync(path.join(ws, 'persona'), {recursive: true});
  const script = `
    const {ModeArchitecture} = await import(${JSON.stringify(path.join(stage, 'mode-architecture/index.mjs'))});
    const warn = console.warn; let warned = ''; console.warn = (...a) => { warned += a.join(' '); };
    const c = new ModeArchitecture().prompt({prompt: '做个记账网页', messages: []}, {agentId: 'main', sessionKey: 'agent:main:w', workspaceDir: ${JSON.stringify(ws)}}).appendSystemContext;
    console.warn = warn;
    process.stdout.write(JSON.stringify({route: c.includes('【这件活先用这些现成的技能】'), waiting: c.includes('【这件活放后台等的时候】'), rules: c.includes('【长时间命令放后台】'), warned}));`;
  const {spawnSync} = await import('node:child_process');
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-winstage-state-'));
  t.after(() => fs.rmSync(stateRoot, {recursive: true, force: true}));
  const env = {...process.env, PINKIE_STATE_ROOT: stateRoot, PINKIE_MANAGED_SKILLS_DIR: SKILLS, OPENCLAW_STATE_DIR: path.join(stateRoot, 'oc')};
  delete env.PINKIE_MANAGED_GATEWAY; delete env.OPENCLAW_SERVICE_KIND;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {env, encoding: 'utf8', timeout: 60_000});
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {route: true, waiting: true, rules: true, warned: ''});
});

test('a final that only announces the reply is sent back', async () => {
  const {promiseWithoutActionReason} = await import('../services/mode-architecture/index.mjs');
  const announced = '一切就绪，可以向老板交付最终成品。包含核心图表、四个阶段的清晰拆解与指引说明。\n依据交付规范：\n1. 第一句直接给出结果；\n2. 附上 MEDIA 行指引最终图片文件；\n\n现在进行正式回复。';
  assert.match(promiseWithoutActionReason(announced), /只说准备汇报/);
  assert.match(promiseWithoutActionReason('碧琪准备向先生汇报。'), /只说准备汇报/);
  assert.equal(promiseWithoutActionReason('报销流程信息图做好了：MEDIA:/tmp/flow.png\n四步从左到右，每步一句说明。'), '');
});
