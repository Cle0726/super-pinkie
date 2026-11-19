// Metre 角色 agent · 车道 1 机制单测（briefs/metre-roles-1118 PLAN 3.1–3.11 / ACCEPTANCE R1-* / X1–X5 / Z3）。
// 测试内自造假卡，不依赖 personas/metre/roles/ 下的官方卡（车道 2 / 3 并行编写）。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertAllToolsClassified, checkDeniedCommand, checkRoleReportSections, checkRoleToolCall,
  clearRolesCache, extractReportSections, formatReadonlyMutationNotice, formatRoleCardPrompt,
  formatRolesBriefCatalog, isRolePluginToolAllowed, KNOWN_GATEWAY_TOOLS, loadRoles,
  ROLES_AGENT_ID, ROLES_BASE, RoleMutationAuditor, validateRoleCard,
} from '../services/mode-architecture/metre-roles.mjs';
import {chooseRoleModel, vendorOf} from '../services/mode-architecture/metre-models.mjs';
import {
  metreStartRolesAddition, normalizeChildRequest, normalizeMode,
  registerMetreRolesTool, registerSessionLineage, SessionLineage,
} from '../services/mode-architecture/session-lineage.mjs';
import {SessionPrefs} from '../services/mode-architecture/session-prefs.mjs';
import {MetreBoard} from '../services/mode-architecture/metre-board.mjs';
import {ModelHealth} from '../services/mode-architecture/model-health.mjs';
import {sessionHintBlock} from '../services/mode-architecture/session-hints.mjs';
import {registerMetreMemory} from '../services/mode-architecture/metre-memory.mjs';
import modeArchitecturePlugin, {CompletionIntegrityGuard, modeForContext} from '../services/mode-architecture/index.mjs';
import {collect, verifyBaseline} from '../tools/metre/inject-inventory.mjs';

const METRE = 'agent:metre:dashboard:boss';
const PROJECT = 'agent:project:dashboard:parent';
const SELF = 'mm/claude-opus-4-7-high';

// 造一张合法角色卡文本（正文 360+ 字，含三节，无禁词）
function makeCard({
  id = 'backend-fix',
  name = '后端修 bug',
  group = 'coding',
  when = '接口报错、数据不对、服务起不来',
  tier = 'mid',
  vision = null,
  tools = ['read', 'write', 'exec', 'net'],
  deny_commands = null,
  reads = null,
  skills = null,
  review = null,
  body = null,
} = {}) {
  const fm = [
    '---',
    ...(id !== null ? [`id: ${id}`] : []),
    ...(name !== null ? [`name: ${name}`] : []),
    ...(group !== null ? [`group: ${group}`] : []),
    ...(when !== null ? [`when: ${when}`] : []),
    ...(tier !== null ? [`tier: ${tier}`] : []),
    ...(vision !== null ? [`vision: ${vision}`] : []),
    ...(tools !== null ? [`tools: [${tools.join(', ')}]`] : []),
    ...(deny_commands !== null ? [`deny_commands: [${deny_commands.join(', ')}]`] : []),
    ...(reads !== null ? [`reads: [${reads.join(', ')}]`] : []),
    ...(skills !== null ? [`skills: [${skills.join(', ')}]`] : []),
    ...(review !== null ? [`review: ${review}`] : []),
    '---',
  ];
  const defaultBody = [
    '## 做法',
    '1. 先复现：照简报给的步骤，或者写一个最小复现脚本或失败测试，拿到失败输出的原文。复现不了就停下，交回试过的步骤和原文输出，不要猜着改代码。',
    '2. 找根因：顺着报错堆栈往回读源码，说清是哪个文件哪一行、为什么出错。只修根因，不准用空 catch 把错误吞掉了事，也不绕过校验。',
    '3. 补测试：项目里有测试框架时先写一条因该缺陷而失败的测试，再做最小改动让它通过，不顺手重构无关代码、不改格式、不升级依赖。',
    '4. 重跑验证：复现步骤、新加测试与改动文件相关的已有测试全部重跑一遍，保留命令和输出原文作为核验证据。',
    '## 边界',
    '- 只改简报点名的仓库或目录，不推送、不发布、不动真实生产数据；需要改数据时先在副本上操作。',
    '- 简报和这张卡冲突时以简报为准，并在汇报里写明冲突处与处理方式。',
    '## 交回',
    '- 结论：修好了 / 没修好 / 复现不了，三选一。',
    '- 根因：一两句话，带文件和行号。',
    '- 改动：修改与新增的文件清单。',
    '- 证据：修前失败、修后通过的命令和输出原文，每段最多 30 行。',
    '- 没做的和拿不准的。',
  ].join('\n');
  return `${fm.join('\n')}\n${body ?? defaultBody}\n`;
}

function makeRoleEnv(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-roles-test-'));
  t.after(() => {
    clearRolesCache();
    fs.rmSync(root, {recursive: true, force: true});
  });
  const officialDir = path.join(root, 'workspace-metre', 'roles');
  const userDir = path.join(officialDir, 'user');
  const rolesWorkspaceDir = path.join(root, 'workspace-roles');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(officialDir, {recursive: true});
  fs.mkdirSync(userDir, {recursive: true});
  fs.mkdirSync(path.join(rolesWorkspaceDir, 'playbooks'), {recursive: true});
  fs.mkdirSync(path.join(rolesWorkspaceDir, 'skills', 'demo-skill'), {recursive: true});
  fs.writeFileSync(path.join(rolesWorkspaceDir, 'playbooks', 'debugging.md'), '# debugging\n', 'utf8');
  fs.writeFileSync(path.join(rolesWorkspaceDir, 'skills', 'demo-skill', 'SKILL.md'), '# demo skill\n', 'utf8');
  return {root, officialDir, userDir, rolesWorkspaceDir, stateDir};
}

function makeLineageFixture(t, {roleDirs, config = null, roleMutatedFiles = null} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-roles-lineage-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const defaultConfig = config || {
    agents: {
      defaults: {model: {primary: SELF}},
      list: [
        {id: 'main'}, {id: 'project'}, {id: 'thinking'}, {id: 'learning'},
        {id: 'unrestricted'}, {id: 'metre'}, {id: 'roles', contextInjection: 'never'},
      ],
    },
    models: {
      providers: {
        mm: {
          models: [
            {id: 'claude-opus-4-7-high', input: ['text', 'image']},
            {id: 'workbuddy/deepseek-v4-pro', input: ['text']},
            {id: 'workbuddy/glm-5.3', input: ['text', 'image']},
            {id: 'workbuddy/kimi-k2.7', input: ['text']},
            {id: 'workbuddy/hy4flash-free', input: ['text', 'image']},
            {id: 'workbuddy/deepseek-v4.1-flash', input: ['text']},
            {id: 'gemini-3.6-flash', input: ['text', 'image']},
            {id: 'gpt-oss-120b', input: ['text', 'image']},
          ],
        },
      },
    },
  };
  const entries = new Map();
  const bindings = new Map();
  const running = new Set();
  const stopped = new Set();
  const sent = [];
  const calls = [];
  const add = (key, props = {}) => {
    entries.set(key, {key, sessionId: 'id-' + key, label: '总控', ...props});
    return entries.get(key);
  };
  add(METRE);
  add(PROJECT, {label: '项目'});
  bindings.set(METRE, {root: root, name: 'test-proj'});
  const access = {
    entry: async key => entries.get(key) || null,
    list: async () => ({entries: Object.fromEntries(entries), dir: root}),
    async rpc(method, params) {
      calls.push([method, params]);
      if (method === 'sessions.list') {
        return {
          sessions: [...entries.values()]
            .filter(entry => entry.key.startsWith(`agent:${params.agentId}:`))
            .filter(entry => params.archived !== false || !entry.archivedAt)
            .map(entry => ({...entry, hasActiveRun: running.has(entry.key)})),
        };
      }
      if (method === 'chat.history') return {messages: []};
      if (method === 'sessions.create') {
        add(params.key, {label: params.label || '子会话', model: params.model || ''});
        return {key: params.key, sessionId: 'id-' + params.key, entry: entries.get(params.key)};
      }
      if (method === 'sessions.patch') {
        const entry = entries.get(params.key);
        if (entry && params.archived !== undefined) entry.archivedAt = params.archived ? Date.now() : undefined;
        return {ok: true};
      }
      if (method === 'pinkie.project.bind') {
        if (params.path) bindings.set(params.key, {root: params.path, name: params.name || path.basename(params.path)});
        return {binding: bindings.get(params.key) || null};
      }
      if (method === 'chat.send') {
        sent.push(params);
        return {status: 'ok'};
      }
      if (method === 'chat.abort') {
        running.delete(params.sessionKey);
        stopped.add(params.sessionKey);
        return {ok: true};
      }
      return {ok: true};
    },
  };
  const titles = {access, record: () => ({})};
  const prefs = new SessionPrefs(root);
  const health = new ModelHealth();
  // The rebased runtime marks untried models as unknown, not healthy.
  for (const [provider, value] of Object.entries(defaultConfig.models.providers)) {
    for (const model of value.models) health.models.set(provider + '/' + model.id, {okAt: 1});
  }
  const options = {
    root,
    titles,
    prefs,
    config: () => defaultConfig,
    modelHealth: health,
    roleDirs,
    roleMutatedFiles,
    isBusy: key => running.has(key),
    stopped: key => stopped.has(key),
    stopTimeoutMs: 2000,
    askTimeoutMs: 2000,
  };
  const lineage = new SessionLineage({logger: {warn() {}}}, options);
  return {root, lineage, prefs, health, entries, running, stopped, sent, calls, options, config: defaultConfig};
}

// ---------- R1-1 ★ & X2 ★ ----------
test('R1-1 ★ 读卡与校验：逐项覆盖全部必填字段、格式、字数、工具、reads 越界、skills 降级、用户覆盖、坏格式不抛异常、mtime 即时重载', t => {
  const env = makeRoleEnv(t);

  // 1. 合格卡
  const ok = validateRoleCard(makeCard({reads: ['playbooks/debugging.md'], skills: ['demo-skill']}), {
    fileNameId: 'backend-fix', filePath: 'backend-fix.md', rolesWorkspaceDir: env.rolesWorkspaceDir, stateDir: env.stateDir,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.id, 'backend-fix');
  assert.equal(ok.readsResolved.length, 1);
  assert.equal(ok.skillsResolved.length, 1);

  // 2. 缺每一个必填字段（单独测）
  for (const field of ['id', 'name', 'group', 'when', 'tier', 'tools']) {
    const res = validateRoleCard(makeCard({[field]: null}), {fileNameId: 'backend-fix', rolesWorkspaceDir: env.rolesWorkspaceDir});
    assert.equal(res.ok, false, `缺少 ${field} 应判不合格`);
    assert.ok(res.errors.some(e => e.includes(field)));
  }

  // 3. id 不合规
  for (const badId of ['BadId', 'a', '../evil', 'has space', 'a'.repeat(33)]) {
    const res = validateRoleCard(makeCard({id: badId}), {fileNameId: badId, rolesWorkspaceDir: env.rolesWorkspaceDir});
    assert.equal(res.ok, false, `非法 id ${badId} 应判不合格`);
  }

  // 4. id 和文件名不一致
  const mismatch = validateRoleCard(makeCard({id: 'backend-fix'}), {fileNameId: 'other-name', rolesWorkspaceDir: env.rolesWorkspaceDir});
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some(e => e.includes('不一致')));

  // 5. 正文少于 300 字 / 多于 1200 字 / X2 ★ 1 万字用户卡
  const tooShort = validateRoleCard(makeCard({body: '## 做法\n1. 做。\n## 边界\n- 边界。\n## 交回\n- 结论。'}), {
    fileNameId: 'backend-fix', rolesWorkspaceDir: env.rolesWorkspaceDir,
  });
  assert.equal(tooShort.ok, false);
  assert.ok(tooShort.errors.some(e => e.includes('300')));

  const tooLong = validateRoleCard(makeCard({
    body: `## 做法\n${'一步一步检查并验证结果。'.repeat(120)}\n## 边界\n- 边界。\n## 交回\n- 结论。`,
  }), {fileNameId: 'backend-fix', rolesWorkspaceDir: env.rolesWorkspaceDir});
  assert.equal(tooLong.ok, false);
  assert.ok(tooLong.errors.some(e => e.includes('1200')));

  const tenK = validateRoleCard(makeCard({
    body: `## 做法\n${'测试正文内容。'.repeat(1500)}\n## 边界\n- 边界。\n## 交回\n- 结论。`,
  }), {fileNameId: 'backend-fix', source: 'user', rolesWorkspaceDir: env.rolesWorkspaceDir});
  assert.equal(tenK.ok, false);

  // 6. tools 表外值
  const badTool = validateRoleCard(makeCard({tools: ['read', 'teleport']}), {fileNameId: 'backend-fix', rolesWorkspaceDir: env.rolesWorkspaceDir});
  assert.equal(badTool.ok, false);
  assert.ok(badTool.errors.some(e => e.includes('teleport')));

  // 7. reads 带 .. 或绝对路径 -> 整张卡不合格
  for (const badRead of ['../secret.md', 'playbooks/../../etc/passwd', '/etc/passwd', 'C:/Windows/win.ini']) {
    const res = validateRoleCard(makeCard({reads: [badRead]}), {fileNameId: 'backend-fix', rolesWorkspaceDir: env.rolesWorkspaceDir});
    assert.equal(res.ok, false, `越界 reads ${badRead} 应整张卡不合格`);
  }

  // 8. skills 找不到时只去掉那一项、记提示，卡照样可用
  const missSkill = validateRoleCard(makeCard({skills: ['demo-skill', 'nonexistent-skill-xyz']}), {
    fileNameId: 'backend-fix', rolesWorkspaceDir: env.rolesWorkspaceDir, stateDir: env.stateDir,
  });
  assert.equal(missSkill.ok, true);
  assert.deepEqual(missSkill.skills, ['demo-skill']);
  assert.equal(missSkill.skillsResolved.length, 1);
  assert.ok(missSkill.warnings.some(w => w.includes('nonexistent-skill-xyz')));

  // 9. 用户卡覆盖官方卡 + 标「自定义」；坏元数据不抛异常；修改后即时重载
  fs.writeFileSync(path.join(env.officialDir, 'backend-fix.md'), makeCard({id: 'backend-fix', name: '后端修 bug'}), 'utf8');
  fs.writeFileSync(path.join(env.officialDir, 'broken-card.md'), 'not-frontmatter-at-all\n{{{', 'utf8');
  let reg = loadRoles(env);
  assert.equal(reg.summary.validCount, 1);
  assert.equal(reg.summary.invalidCount, 1);
  assert.equal(reg.byId['backend-fix'].source, 'official');
  assert.equal(reg.byId['backend-fix'].sourceLabel, '官方');

  // 写入同名用户卡 + 1 万字坏用户卡（X2 ★）
  fs.writeFileSync(path.join(env.userDir, 'backend-fix.md'), makeCard({id: 'backend-fix', name: '我的后端修'}), 'utf8');
  fs.writeFileSync(path.join(env.userDir, 'huge-bad.md'), makeCard({
    id: 'huge-bad', name: '超大坏卡',
    body: `## 做法\n${'超过一万字的文本。'.repeat(1200)}\n## 边界\n- 边界。\n## 交回\n- 结论。`,
  }), 'utf8');
  reg = loadRoles(env);
  assert.equal(reg.byId['backend-fix'].source, 'user');
  assert.equal(reg.byId['backend-fix'].sourceLabel, '自定义');
  assert.equal(reg.byId['backend-fix'].name, '我的后端修');
  assert.equal(reg.byId['huge-bad'], undefined);
  assert.ok(reg.invalid.some(item => item.id === 'huge-bad'));

  // 修改文件后下一次调用立即读到新内容
  const userCardPath = path.join(env.userDir, 'backend-fix.md');
  const nextMtime = (fs.statSync(userCardPath).mtimeMs + 5000) / 1000;
  fs.writeFileSync(userCardPath, makeCard({id: 'backend-fix', name: '改版后端修'}), 'utf8');
  fs.utimesSync(userCardPath, nextMtime, nextMtime);
  reg = loadRoles(env);
  assert.equal(reg.byId['backend-fix'].name, '改版后端修');
});

// ---------- R1-3 / R1-4 ★ / R1-5 ★ / R1-6 ★ / R1-7 / R1-9 / R1-10 / R1-11 ★ / X1 ★ ----------
test('R1-3..R1-11 & X1 ★ 派活参数、roles 路由、mode 忽略、pinkie_roles、pinkie_mode_ask、metreRoles 总开关、对抗输入', async t => {
  const env = makeRoleEnv(t);
  fs.writeFileSync(path.join(env.officialDir, 'researcher.md'), makeCard({
    id: 'researcher', name: '调研员', group: 'research', when: '查资料收集信息', tier: 'light', tools: ['read', 'net'],
  }), 'utf8');
  fs.writeFileSync(path.join(env.officialDir, 'backend-fix.md'), makeCard({
    id: 'backend-fix', name: '后端修 bug', group: 'coding', tier: 'mid', tools: ['read', 'write', 'exec', 'net'],
    deny_commands: ['git push', 'npm publish'], reads: ['playbooks/debugging.md'],
  }), 'utf8');
  fs.writeFileSync(path.join(env.officialDir, 'bad-one.md'), '---\nid: bad-one\n---\n太短\n', 'utf8');

  const f = makeLineageFixture(t, {roleDirs: env});
  const tools = [];
  const fakeApi = {on() {}, registerTool: (factory, options) => tools.push({factory, options}), logger: {warn() {}}};
  const lineage = registerSessionLineage(fakeApi, {...f.options, root: f.root + '-reg'});
  registerMetreRolesTool(fakeApi, lineage);
  const toolFor = (name, sessionKey) => tools.find(x => x.options.name === name)?.factory({sessionKey}) || null;

  // R1-3: 坏卡不出现在 role enum，pinkie_roles 列出坏卡及原因
  const startTool = toolFor('pinkie_session_start', METRE);
  assert.deepEqual(startTool.parameters.properties.role.enum.sort(), ['backend-fix', 'researcher']);
  assert.ok(!startTool.parameters.properties.role.enum.includes('bad-one'));
  const rolesTool = toolFor('pinkie_roles', METRE);
  assert.ok(rolesTool);
  const listRes = await rolesTool.execute('c1', {});
  assert.equal(listRes.details.summary.validCount, 2);
  assert.equal(listRes.details.summary.invalidCount, 1);
  assert.equal(listRes.details.invalid[0].id, 'bad-one');
  const detailRes = await rolesTool.execute('c2', {id: 'backend-fix'});
  assert.equal(detailRes.details.id, 'backend-fix');
  assert.match(detailRes.details.body, /## 做法/);

  // R1-9: 老模式没有 pinkie_roles；Metre 独做时收起 pinkie_roles
  assert.equal(toolFor('pinkie_roles', PROJECT), null);
  f.prefs.setSession(METRE, {dispatch: 'solo'});
  assert.equal(toolFor('pinkie_roles', METRE), null);
  assert.equal(toolFor('pinkie_session_start', METRE), null);
  f.prefs.setSession(METRE, {dispatch: 'dispatch'});

  // R1-6 ★: 老模式工具参数里没有 role，传 mode: roles 在任何模式都被拒，sessionHintBlock 不提 roles
  const projStart = toolFor('pinkie_session_start', PROJECT);
  assert.equal(projStart.parameters.properties.role, undefined);
  assert.equal(projStart.parameters.properties.of, undefined);
  assert.throws(() => normalizeMode('roles'));
  assert.throws(() => normalizeMode('roles', {metre: true}));
  assert.doesNotMatch(sessionHintBlock(PROJECT, '同时做一个网站和调研报告', ['web_ui'], {mode: 'project'}), /\broles\b/i);

  // R1-4 ★: Metre 写 role，不写 mode 也能开；写了 mode 不起作用并在结果里说明
  const r1 = await lineage.start(METRE, 'run1', {
    title: '调研对比', prompt: '查一下两个开源库的区别', initiation: 'user_asked', role: 'researcher',
  }, 'call-1');
  assert.ok(r1.key.startsWith('agent:roles:pinkie-child:'), r1.key);
  assert.equal(r1.role, 'researcher');
  assert.equal(r1.roleName, '调研员');
  const rec1 = lineage.lineage()[r1.key];
  assert.equal(rec1.metreRole, 'researcher');
  assert.equal(rec1.metreRoleSource, 'official');
  assert.ok(rec1.metreRoleHash && rec1.metreRoleHash.length === 64);
  // 第一条消息（R1-12 ★）：带角色新开头，无 REPORT_NOTE
  const sent1 = f.sent.find(s => s.sessionKey === r1.key);
  assert.match(sent1.message, /这份简报来自 Metre，角色：调研员。做法和汇报格式见角色卡。/);
  assert.doesNotMatch(sent1.message, /你最后一条回复就是交回去的汇报/);

  const r2 = await lineage.start(METRE, 'run1', {
    title: '修后端', prompt: '复现并修 /api/ping 500 错误', initiation: 'user_asked', role: 'backend-fix', mode: 'project',
  }, 'call-2');
  assert.ok(r2.key.startsWith('agent:roles:pinkie-child:'));
  assert.match(r2.note, /带角色时 mode 不起作用/);

  // R1-7: 不存在的 role 被拒且列出合法值
  await assert.rejects(
    lineage.start(METRE, 'run1', {title: '不存在', prompt: '测试', initiation: 'user_asked', role: 'no-such-role'}, 'call-bad'),
    /可用角色：.*backend-fix.*researcher|researcher.*backend-fix/,
  );

  // X1 ★: ../x、空字符串、超长字符串均被拒，网关不出错
  for (const evil of ['../x', '', 'a'.repeat(400), 'foo/bar']) {
    await assert.rejects(
      lineage.start(METRE, 'run1', {title: '对抗', prompt: '测试', initiation: 'user_asked', role: evil}, 'call-x1'),
      /role 不合法/,
    );
  }

  // R1-10: Metre 的 pinkie_mode_ask 带 role
  const askPromise = lineage.ask(METRE, 'run2', {role: 'researcher', question: '这个协议最新版本号是多少？'}, 'ask-r1');
  await new Promise(resolve => setTimeout(resolve, 25));
  const askSent = f.sent.find(s => s.sessionKey.startsWith('agent:roles:pinkie-child:') && s.message.includes('最新版本号'));
  assert.ok(askSent, 'pinkie_mode_ask 带 role 应开在 roles agent 上');
  const waiter = lineage.waiters.get(askSent.sessionKey);
  assert.ok(waiter);
  waiter('最新正式版是 v2.4（来源：官方文档）。');
  const askOut = await askPromise;
  assert.equal(askOut.role, 'researcher');
  assert.equal(askOut.roleName, '调研员');
  assert.match(askOut.answer, /v2\.4/);

  // R1-11 ★: 关闭 metreRoles 后，role / of / pinkie_roles 全消失，与改动前快照逐字一致
  const baseline = JSON.parse(fs.readFileSync(path.resolve('briefs/metre-roles-1118/main-inject-baseline.json'), 'utf8'));
  f.prefs.setGlobal({metreRoles: false});
  assert.equal(toolFor('pinkie_roles', METRE), null);
  const startOff = toolFor('pinkie_session_start', METRE);
  const askOff = toolFor('pinkie_mode_ask', METRE);
  assert.equal(startOff.parameters.properties.role, undefined);
  assert.equal(startOff.parameters.properties.of, undefined);
  assert.deepEqual(
    {name: startOff.name, label: startOff.label, description: startOff.description, parameters: startOff.parameters},
    baseline.metreToolsBefore.pinkie_session_start,
  );
  assert.deepEqual(
    {name: askOff.name, label: askOff.label, description: askOff.description, parameters: askOff.parameters},
    baseline.metreToolsBefore.pinkie_mode_ask,
  );
});

// ---------- R1-8 ★: 600 字预算与 40 张用户卡 ----------
test('R1-8 ★ METRE_START_TEXT 角色段不超过 600 字，造 40 张用户卡仍 <= 600 字并出现「还有 N 张」', t => {
  const env = makeRoleEnv(t);
  fs.writeFileSync(path.join(env.officialDir, 'backend-fix.md'), makeCard({id: 'backend-fix', name: '后端修 bug', group: 'coding'}), 'utf8');
  fs.writeFileSync(path.join(env.officialDir, 'researcher.md'), makeCard({id: 'researcher', name: '调研员', group: 'research', tier: 'light', tools: ['read', 'net']}), 'utf8');
  for (let i = 1; i <= 40; i++) {
    const id = `custom-role-${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(env.userDir, `${id}.md`), makeCard({id, name: `自建卡${i}`, group: 'execution'}), 'utf8');
  }
  const reg = loadRoles(env);
  assert.equal(reg.summary.validCount, 42);
  const text = metreStartRolesAddition(reg);
  assert.ok([...text].length <= 600 && text.length <= 600, `角色段超长：${text.length} 字\n${text}`);
  assert.match(text, /还有 \d+ 张自定义角色，用 pinkie_roles 看/);
  assert.ok(text.includes('backend-fix 后端修 bug'), '应优先列出官方卡');
  assert.ok(text.includes('researcher 调研员'), '应优先列出官方卡');
});

// ---------- R1-12 ★ / R1-13 ★ / R1-14 ★ / R1-15 ★ / X3 ★ ----------
test('R1-12..R1-15 & X3 ★ 每轮注入、压缩后仍在、运行中改卡不串版、多实例即时生效、roles 注入纯净无禁词', async t => {
  const env = makeRoleEnv(t);
  fs.writeFileSync(path.join(env.officialDir, 'backend-fix.md'), makeCard({
    id: 'backend-fix', name: '后端修 bug', reads: ['playbooks/debugging.md'], skills: ['demo-skill'],
  }), 'utf8');

  // R1-14 ★ + X3 ★：两个独立实例（同磁盘角色目录）
  const f1 = makeLineageFixture(t, {roleDirs: env});
  const f2 = makeLineageFixture(t, {roleDirs: env});
  const firstRun = await f1.lineage.start(METRE, 'r1', {
    title: '第一单', prompt: '修接口', initiation: 'user_asked', role: 'backend-fix',
  }, 'c1');
  const origHash = f1.lineage.lineage()[firstRun.key].metreRoleHash;
  const origCard = f1.lineage.roleCardForSession(firstRun.key);

  // 第 1、2、3 轮注入一致且格式符合 PLAN 3.5
  const prompt1 = formatRoleCardPrompt(origCard);
  const prompt2 = formatRoleCardPrompt(f1.lineage.roleCardForSession(firstRun.key));
  const prompt3 = formatRoleCardPrompt(f1.lineage.roleCardForSession(firstRun.key));
  assert.equal(prompt1, prompt2);
  assert.equal(prompt2, prompt3);
  assert.match(prompt1, /^【角色卡：后端修 bug】Metre 派你做这一单。下面是这类活的做法，这一单的具体要求在简报里。/);
  assert.match(prompt1, /开工前先完整读：/);
  assert.ok(prompt1.includes(path.join(env.rolesWorkspaceDir, 'playbooks', 'debugging.md')));
  assert.ok(prompt1.includes(path.join(env.rolesWorkspaceDir, 'skills', 'demo-skill', 'SKILL.md')));

  // 中途修改磁盘上的卡文件
  const cardFile = path.join(env.officialDir, 'backend-fix.md');
  const newBody = [
    '## 做法',
    '1. 这是改版后的第一步：先抓最新日志并写最小复现脚本，拿到明确失败信息原文后再定位代码，绝不凭感觉修改任何文件或跳过复现。',
    '2. 找根因：追踪完整调用链与错误栈，确认具体文件行号和触发条件，不允许用空异常捕获掩盖问题或绕开核心校验逻辑。',
    '3. 最小修改并补回归测试：先写一条因该缺陷而失败的测试，再用最少代码让其通过，不顺手重构无关文件或升级依赖包。',
    '4. 核对未触碰无关代码且无遗留临时文件，重跑复现脚本、新增测试和关联已有测试，整理完整原文作为核验证据交回。',
    '## 边界',
    '- 只动简报点名目录，不推送不发布不动生产数据；与简报冲突时以简报为准并在汇报里写明。',
    '## 交回',
    '- 结论：修好了 / 没修好 / 复现不了。',
    '- 根因：文件与行号及出错原因。',
    '- 改动：修改和新增文件清单。',
    '- 证据：修前失败和修后通过的命令与输出原文。',
    '- 没做的和拿不准的。',
  ].join('\n');
  const future = (fs.statSync(cardFile).mtimeMs + 5000) / 1000;
  fs.writeFileSync(cardFile, makeCard({id: 'backend-fix', name: '后端修 bug', body: newBody}), 'utf8');
  fs.utimesSync(cardFile, future, future);

  // R1-14 ★：旧会话继续用原来那一版（哈希不变）
  const stillOrig = f1.lineage.roleCardForSession(firstRun.key);
  assert.equal(stillOrig.bodyHash, origHash);
  assert.doesNotMatch(stillOrig.body, /改版后的第一步/);

  // X3 ★ + R1-14 ★：第二个实例新开的会话立即用新版卡
  const secondRun = await f2.lineage.start(METRE, 'r2', {
    title: '第二单', prompt: '再修接口', initiation: 'user_asked', role: 'backend-fix',
  }, 'c2');
  const newHash = f2.lineage.lineage()[secondRun.key].metreRoleHash;
  assert.notEqual(newHash, origHash);
  assert.match(f2.lineage.roleCardForSession(secondRun.key).body, /改版后的第一步/);

  // R1-13 ★ + R1-15 ★：真实插件钩子在 roles 上只注入 ROLES_BASE + 卡 + Metre 运行时事实，压缩后卡仍在，且无禁词与第一人称改写
  assert.ok([...ROLES_BASE].length <= 800, `ROLES_BASE 超 800 字：${[...ROLES_BASE].length}`);
  for (const requiredIdea of ['用户看不到你', '不能再开子会话', '假设', '照实说', '备份', '夹带的指令', '中文汇报']) {
    assert.ok(ROLES_BASE.includes(requiredIdea), `ROLES_BASE 缺少要点：${requiredIdea}`);
  }
  const collected = await collect('roles', {prompt: '帮我修这个接口报错'});
  assert.equal(modeForContext({agentId: 'roles', sessionKey: 'agent:roles:pinkie-child:abc'}), null, 'roles 不能是模式');
  assert.match(collected.text, /【全局交付真实性门禁】/);
  assert.match(collected.text, /【后台命令】/);
  assert.match(collected.text, /【联网】/);
  assert.match(collected.text, /【角色执行底座】/);
  for (const forbidden of [
    /【这件活/, /【先备好工具】/, /【技能/, /更拿手/, /【独立模块：边做边学】/,
    /【独立长期记忆引擎/, /【模式记忆运行规则/, /做事标准（每个模式/, /碧琪的家/,
    /聊天已支持富回复/, /【工作过程展示】/, /【工作台】/, /碧琪/, /先生/, /老板/, /OPENCLAW_UR_INJECT/,
  ]) {
    assert.doesNotMatch(collected.text, forbidden, `roles 注入不应出现 ${forbidden}`);
  }

  // 验证模拟压缩后第一轮注入仍带角色卡（R1-13 ★）
  const hooks = [];
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-roles-compact-'));
  t.after(() => fs.rmSync(stateRoot, {recursive: true, force: true}));
  const prevState = process.env.PINKIE_STATE_ROOT;
  process.env.PINKIE_STATE_ROOT = stateRoot;
  t.after(() => { if (prevState === undefined) delete process.env.PINKIE_STATE_ROOT; else process.env.PINKIE_STATE_ROOT = prevState; });
  const mockApi = {
    on: (name, fn, opts = {}) => hooks.push({name, fn, priority: Number(opts?.priority) || 0}),
    registerGatewayMethod() {},
    registerTool() {},
    registerHttpRoute: () => ({}),
    registerService() {},
    registerCommand() {},
    logger: {info() {}, warn() {}, error() {}, debug() {}},
    runtime: {state: {resolveStateDir: () => stateRoot}, config: {current: () => ({})}},
    session: {workflow: {enqueueNextTurnInjection: async () => {}, unscheduleSessionTurnsByTag: async () => ({removed: 0})}},
  };
  modeArchitecturePlugin.register(mockApi);
  // 写入快照文件模拟已派发角色会话
  const childKey = 'agent:roles:pinkie-child:compaction001';
  const sessionsDir = path.join(stateRoot, 'sessions');
  fs.mkdirSync(sessionsDir, {recursive: true});
  fs.writeFileSync(path.join(sessionsDir, 'session-role-snapshots.json'), JSON.stringify({[childKey]: origCard}, null, 2), 'utf8');
  const ctx = {agentId: 'roles', sessionKey: childKey, runId: 'r-compact'};
  for (const h of hooks.filter(x => x.name === 'before_compaction')) await h.fn({}, ctx);
  for (const h of hooks.filter(x => x.name === 'after_compaction')) await h.fn({}, ctx);
  const promptHooks = hooks.filter(x => x.name === 'before_prompt_build').sort((a, b) => b.priority - a.priority);
  const outParts = [];
  for (const h of promptHooks) {
    const out = await h.fn({prompt: '继续刚才未完的工作', messages: [], runId: 'r-after-compact'}, ctx);
    if (out?.appendSystemContext) outParts.push(out.appendSystemContext);
  }
  const afterCompactText = outParts.join('\n');
  assert.match(afterCompactText, /【角色卡：后端修 bug】/);
  assert.match(afterCompactText, /【角色执行底座】/);

  // 验证 reply_payload_sending 不对 roles 做第一人称改写
  const sendHooks = hooks.filter(x => x.name === 'reply_payload_sending');
  let evt = {payload: {text: '我已经复现并修复了这个接口。'}};
  for (const h of sendHooks) {
    const out = await h.fn(evt, ctx);
    if (out?.payload) evt = {...evt, payload: out.payload};
  }
  assert.equal(evt.payload.text, '我已经复现并修复了这个接口。');
});

// ---------- R1-20 ★ / R1-21 ★ / R1-22 ★ / R1-23 ----------
test('R1-20 ★ / R1-21 ★ / R1-22 ★ / R1-23 工具归类完整性、只读拦截、deny_commands 对抗、只读改动审计提醒', async t => {
  // R1-20 ★: 全部 58 个网关工具均有归类；加一个未归类假工具立刻报错
  assert.equal(assertAllToolsClassified(KNOWN_GATEWAY_TOOLS), true);
  assert.throws(() => assertAllToolsClassified([...KNOWN_GATEWAY_TOOLS, 'mystery_unmapped_tool_999']), /mystery_unmapped_tool_999/);

  // 插件按卡过滤
  const researcherCard = validateRoleCard(makeCard({
    id: 'researcher', name: '调研员', group: 'research', tier: 'light', tools: ['read', 'net'],
  }), {fileNameId: 'researcher'});
  assert.equal(isRolePluginToolAllowed('pinkie_search', researcherCard), true);
  assert.equal(isRolePluginToolAllowed('code_search', researcherCard), true);
  assert.equal(isRolePluginToolAllowed('code_edit', researcherCard), false);
  assert.equal(isRolePluginToolAllowed('app_browser', researcherCard), false);
  assert.equal(isRolePluginToolAllowed('pinkie_session_start', researcherCard), false);
  assert.equal(isRolePluginToolAllowed('plan_update', researcherCard), false);
  assert.equal(isRolePluginToolAllowed('ask_user', researcherCard), false);
  assert.equal(isRolePluginToolAllowed('clekk_memory', researcherCard), false);
  assert.equal(isRolePluginToolAllowed('metre_memory', researcherCard), false);

  // R1-21 ★: 只读卡调 write / edit / exec 被拦，blockReason 与 PLAN 一字不差
  const wBlock = checkRoleToolCall(researcherCard, 'write', {path: 'a.txt'});
  assert.equal(wBlock.block, true);
  assert.equal(wBlock.blockReason, '这个角色（调研员）不能用 write 类工具。需要的改动写进汇报，交给 Metre。');
  const eBlock = checkRoleToolCall(researcherCard, 'exec', {command: 'ls'});
  assert.equal(eBlock.block, true);
  assert.equal(eBlock.blockReason, '这个角色（调研员）不能用 exec 类工具。需要的改动写进汇报，交给 Metre。');
  assert.equal(checkRoleToolCall(researcherCard, 'read', {path: 'a.txt'}).block, false);
  assert.equal(checkRoleToolCall(researcherCard, 'web_fetch', {url: 'https://example.com'}).block, false);

  // R1-22 ★: deny_commands 全部对抗用例
  const deny = ['git push', 'npm publish'];
  for (const blockedCmd of [
    'git push',
    '  git push',
    'echo a && git push',
    'echo a; git push',
    'echo a | git push',
    'echo a || git push',
    'git push origin x',
    'GIT   PUSH origin main',
    'echo ok\ngit push',
    '$(git push)',
    'npm   publish --access public',
  ]) {
    assert.equal(checkDeniedCommand(blockedCmd, deny).blocked, true, `应拦截命令：${blockedCmd}`);
  }
  for (const allowedCmd of [
    'git status',
    'git pushx',
    'git pushx origin main',
    'echo "git push"',
    'npm test',
  ]) {
    assert.equal(checkDeniedCommand(allowedCmd, deny).blocked, false, `不应拦截命令：${allowedCmd}`);
  }

  // R1-23: 只读角色（含 exec、无 write）通过 exec 改了文件 -> 汇报前带提醒并列出文件
  const env = makeRoleEnv(t);
  fs.writeFileSync(path.join(env.officialDir, 'reviewer.md'), makeCard({
    id: 'reviewer', name: '挑刺验收员', group: 'gate', tier: 'mid', tools: ['read', 'exec'], review: 'cross-vendor',
  }), 'utf8');
  const auditor = new RoleMutationAuditor();
  const f = makeLineageFixture(t, {roleDirs: env, roleMutatedFiles: key => auditor.list(key)});
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-ro-audit-'));
  t.after(() => fs.rmSync(workDir, {recursive: true, force: true}));
  const started = await f.lineage.start(METRE, 'r-ro', {
    title: '验收', prompt: '检查目录', initiation: 'user_asked', role: 'reviewer',
  }, 'c-ro');
  auditor.beforeExec(started.key, 'exec-1', [workDir]);
  fs.writeFileSync(path.join(workDir, 'sneaky.txt'), 'mutated by exec\n', 'utf8');
  const diff = auditor.afterExec(started.key, 'exec-1');
  assert.deepEqual(diff, ['sneaky.txt']);
  const childRec = f.lineage.lineage()[started.key];
  await f.lineage.report(started.key, childRec, '## 结论\n通过\n## 根因\n无\n## 改动\n无\n## 证据\n见输出\n## 没做的和拿不准的\n无', 'run-ro');
  const reportCard = f.lineage.state(METRE).cards.at(-1);
  assert.match(reportCard.text, /注意：只读角色 挑刺验收员 改了这些文件：sneaky\.txt/);
  assert.equal(reportCard.roleName, '挑刺验收员');
});

test('a role child that completes on an automatic retry still reports to Metre once', async t => {
  const env = makeRoleEnv(t);
  fs.writeFileSync(path.join(env.officialDir, 'backend-fix.md'), makeCard(), 'utf8');
  const f = makeLineageFixture(t, {roleDirs: env});
  const board = new MetreBoard({root: path.join(f.root, 'board'), lineage: f.lineage,
    metreRoleCatalog: () => f.lineage.rolesRegistry()});
  const task = await f.lineage.start(METRE, 'parent-run', {
    title: '恢复后汇报', prompt: '检查失败的回归', initiation: 'user_asked', role: 'backend-fix',
  }, 'dispatch-once');
  const [dispatch] = f.sent;
  const ctx = {sessionKey: task.key};
  assert.equal(dispatch.sessionKey, task.key);
  f.lineage.begin({runId: dispatch.idempotencyKey, prompt: dispatch.message}, ctx);
  const report = '## 结论\n修好了\n## 根因\n测试夹具\n## 改动\n无\n## 证据\n两项测试通过\n## 没做的和拿不准的\n无';
  const success = runId => ({runId, success: true, messages: [{role: 'assistant', content: report, stopReason: 'stop'}]});
  // index.mjs delegates a retrying turn to the watchdog before it calls lineage.ended.
  // The original dispatched turn is still in the map, but the new prompt is internal.
  const retry = `pinkie-watchdog-${dispatch.idempotencyKey}-1`;
  f.lineage.begin({runId: retry, prompt: '[pinkie-watchdog] 【自动续接保护】从未完成处继续'}, ctx);
  await f.lineage.ended(success(retry), ctx);
  await f.lineage.ended(success(retry), ctx); // repeated end event
  const official = (await f.lineage.cards(METRE)).cards.filter(card => card.kind === 'report');
  assert.equal(official.length, 1);
  assert.equal(official[0].childKey, task.key);
  assert.equal(official[0].role, 'backend-fix');
  assert.equal(official[0].roleName, '后端修 bug');
  assert.equal(official[0].text, report);
  const view = await board.board(METRE);
  assert.equal(view.overview.returned, 1);
  assert.equal(view.sessions[0].reports, 1);
  assert.equal(view.sessions[0].status, 'done');
  assert.equal(view.timeline.filter(event => event.kind === 'report').length, 1);
  assert.equal(f.sent.filter(item => item.sessionKey === task.key).length, 1);

  // Neither a direct user turn nor a watchdog replay of that user turn is a report.
  f.lineage.begin({runId: 'direct', prompt: '我只是在子会话里问，你不用汇报'}, ctx);
  f.lineage.begin({runId: 'pinkie-watchdog-direct-1', prompt: '[pinkie-watchdog] 【自动续接保护】继续'}, ctx);
  await f.lineage.ended(success('pinkie-watchdog-direct-1'), ctx);
  assert.equal((await board.board(METRE)).sessions[0].reports, 1);
});

test('a role brief heading does not make a read-only request require a write', async t => {
  const env = makeRoleEnv(t);
  fs.writeFileSync(path.join(env.officialDir, 'researcher.md'), makeCard({
    id: 'researcher', name: '调研员', group: 'research', tier: 'light', tools: ['read', 'net'],
  }), 'utf8');
  const f = makeLineageFixture(t, {roleDirs: env});
  const source = path.join(f.root, 'source-a.md');
  fs.writeFileSync(source, '本地夹具', 'utf8');
  async function decision(prompt, withRead) {
    const task = await f.lineage.start(METRE, 'test-parent', {
      title: '核对门禁', prompt, initiation: 'user_asked', role: 'researcher',
    }, prompt);
    const sent = f.sent.find(item => item.sessionKey === task.key);
    const ctx = {agentId: 'roles', sessionKey: task.key, runId: sent.idempotencyKey};
    const guard = new CompletionIntegrityGuard();
    guard.begin({prompt: sent.message}, ctx);
    if (withRead) {
      const tool = {toolName: 'read', toolCallId: 'one-read', params: {path: source}};
      guard.beforeTool(tool, ctx);
      guard.afterTool({...tool, result: '本地夹具'}, ctx);
    }
    return guard.finalize({lastAssistantMessage: '原文：本地夹具。'}, ctx);
  }
  const onlyRead = '请调用工具读取 source-a.md 并告诉我内容。不修改文件。';
  assert.equal(await decision(onlyRead, true), undefined);
  assert.match((await decision(onlyRead, false))?.reason || '', /没有任何真实执行工具记录/);
  assert.match((await decision('请修改文件 source-a.md 并运行测试', true))?.reason || '', /没有任何真实执行工具记录/);
});

// ---------- R1-24 ★ & R1-25 ★ ----------
test('R1-24 ★ / R1-25 ★ 模型挑选（五条件逐一测 + 缺条件报错 + okAt 优先）与 14 厂家 vendorOf + cross-vendor 校验', async t => {
  // R1-25 ★: 至少 12 个厂家（这里测 15 个），含路由前缀、:free、思考强度后缀
  const vendorCases = [
    ['mm/workbuddy/deepseek-v4-pro', 'deepseek'],
    ['mm/workbuddy/deepseek-v4.1-flash:free', 'deepseek'],
    ['mm/workbuddy/glm-5.3-flash-high', 'zhipu'],
    ['zhipu/glm-5', 'zhipu'],
    ['mm/workbuddy/kimi-k3.1-pro-thinking', 'moonshot'],
    ['mm/workbuddy/hy4flash-free', 'tencent'],
    ['mm/kiro/qwen3-coder-next', 'qwen'],
    ['mm/doubao-web/auto', 'bytedance'],
    ['mm/claude-opus-4-7-xhigh', 'anthropic'],
    ['openai/gpt-6-sol-high', 'openai'],
    ['google/gemini-3.6-flash:free', 'google'],
    ['xai/grok-4.6@eu', 'xai'],
    ['mm/workbuddy/minimax-m3.1-flash', 'minimax'],
    ['mm/workbuddy/mimo-v2.6-pro', 'xiaomi'],
    ['mm/workbuddy/step-5-preview', 'stepfun'],
    ['openrouter/mistral-large-latest', 'mistral'],
  ];
  for (const [modelId, expected] of vendorCases) {
    assert.equal(vendorOf(modelId), expected, `vendorOf(${modelId})`);
  }

  // R1-24 ★: 五个条件逐一验证 + 缺条件明确报错
  const cfg = {
    models: {
      providers: {
        mm: {
          models: [
            {id: 'claude-opus-4-7-high', input: ['text', 'image']},     // top, self
            {id: 'workbuddy/deepseek-v4-pro', input: ['text']},         // mid, no vision, toolsStable
            {id: 'workbuddy/glm-5.3', input: ['text', 'image']},        // mid, vision, toolsStable
            {id: 'workbuddy/hy4flash-free', input: ['text', 'image']},  // light, vision, toolsStable
            {id: 'gpt-oss-120b', input: ['text', 'image']},             // mid, vision, toolsWeak
          ],
        },
      },
    },
  };
  const health = new ModelHealth();
  // okAt 优先：把 glm-5.3 标为最近跑通过，mid 档不要求看图时也优先选它
  health.models.set('mm/workbuddy/glm-5.3', {okAt: Date.now()});
  const pickedMid = chooseRoleModel({
    config: cfg, health, selfModel: SELF,
    roleCard: {id: 'backend-fix', name: '后端修 bug', tier: 'mid', vision: false, tools: ['read', 'write', 'exec']},
  });
  assert.equal(pickedMid.model, 'mm/workbuddy/glm-5.3');

  // 条件 1：档位（无 top 非自身模型 -> 报缺「与 Metre 自身不同」或「档位为 top」）
  assert.throws(
    () => chooseRoleModel({
      config: cfg, health, selfModel: SELF,
      roleCard: {id: 'domain-expert', name: '领域专家', tier: 'top', vision: false, tools: ['read']},
    }),
    /与 Metre 自身.*不同/,
  );

  // 条件 2：vision（把 glm-5.3 标为失败，剩下 deepseek 无 vision、gpt-oss toolsWeak -> 缺 vision）
  const hNoVision = new ModelHealth();
  hNoVision.models.set('mm/workbuddy/deepseek-v4-pro', {okAt: 1});
  hNoVision.models.set('mm/workbuddy/glm-5.3', {failAt: Date.now(), reason: '503'});
  hNoVision.models.set('mm/gpt-oss-120b', {failAt: Date.now(), reason: '503'});
  assert.throws(
    () => chooseRoleModel({
      config: cfg, health: hNoVision, selfModel: SELF,
      roleCard: {id: 'ui-replicator', name: '界面还原', tier: 'mid', vision: true, tools: ['read', 'write']},
    }),
    /支持看图/,
  );

  // 条件 3：toolsStable（只有 gpt-oss-120b 满足 mid + vision 时，要求 exec/write -> 报缺 toolsStable）
  const cfgWeakOnly = {models: {providers: {mm: {models: [{id: 'gpt-oss-120b', input: ['text', 'image']}]}}}};
  const healthyButWeak = new ModelHealth();
  healthyButWeak.models.set('mm/gpt-oss-120b', {okAt: 1});
  assert.throws(
    () => chooseRoleModel({
      config: cfgWeakOnly, health: healthyButWeak, selfModel: SELF,
      roleCard: {id: 'backend-fix', name: '后端修 bug', tier: 'mid', vision: false, tools: ['read', 'exec']},
    }),
    /工具调用稳定/,
  );

  // 条件 4：健康（所有 light 档不健康 -> 报缺模型健康）
  const hUnhealthy = new ModelHealth();
  hUnhealthy.models.set('mm/workbuddy/hy4flash-free', {failAt: Date.now(), reason: '429'});
  assert.throws(
    () => chooseRoleModel({
      config: cfg, health: hUnhealthy, selfModel: SELF,
      roleCard: {id: 'researcher', name: '调研员', tier: 'light', vision: false, tools: ['read', 'net']},
    }),
    /模型健康/,
  );

  // R1-25 ★: cross-vendor 写了 of 时拒绝同厂家；自动挑选避开同厂家；没写 of 时放行并带提醒
  const env = makeRoleEnv(t);
  fs.writeFileSync(path.join(env.officialDir, 'backend-fix.md'), makeCard({id: 'backend-fix', name: '后端修 bug', tier: 'mid'}), 'utf8');
  fs.writeFileSync(path.join(env.officialDir, 'reviewer.md'), makeCard({
    id: 'reviewer', name: '挑刺验收员', group: 'gate', tier: 'mid', vision: false, tools: ['read', 'exec'], review: 'cross-vendor',
  }), 'utf8');
  const f = makeLineageFixture(t, {roleDirs: env});
  const devChild = await f.lineage.start(METRE, 'r-cv', {
    title: '开发', prompt: '实现接口', initiation: 'user_asked', role: 'backend-fix', model: 'mm/workbuddy/deepseek-v4-pro',
  }, 'c-dev');
  // 同厂家显式 model 被拒
  await assert.rejects(
    f.lineage.start(METRE, 'r-cv', {
      title: '复核同厂', prompt: '检查', initiation: 'user_asked', role: 'reviewer',
      of: [devChild.key], model: 'mm/workbuddy/deepseek-v4-pro',
    }, 'c-rev-same'),
    /同一厂家（deepseek）/,
  );
  // 自动挑模型应避开 deepseek（挑到 zhipu/glm-5.3 或 kimi）
  const revAuto = await f.lineage.start(METRE, 'r-cv', {
    title: '复核换厂', prompt: '检查', initiation: 'user_asked', role: 'reviewer', of: [devChild.key],
  }, 'c-rev-auto');
  assert.notEqual(vendorOf(revAuto.model), 'deepseek');
  // 没写 of 时放行，结果里有提醒
  const revNoOf = await f.lineage.start(METRE, 'r-cv', {
    title: '无of复核', prompt: '检查', initiation: 'user_asked', role: 'reviewer',
  }, 'c-rev-noof');
  assert.match(revNoOf.note, /没写 of，没法保证换一家/);
});

// ---------- R1-26 / R1-28 ★ / R1-29 ★ / R1-30 / X5 ----------
test('R1-26 / R1-28 ★ / R1-29 ★ / R1-30 / X5 汇报检查、主 MD 字数、上限与全停、不碰 Metre 记忆、断网可用', async t => {
  const env = makeRoleEnv(t);
  fs.writeFileSync(path.join(env.officialDir, 'backend-fix.md'), makeCard({id: 'backend-fix', name: '后端修 bug'}), 'utf8');
  const f = makeLineageFixture(t, {roleDirs: env});

  // R1-26: 缺段提醒，齐全无提醒；交付门禁照常生效
  const card = loadRoles(env).byId['backend-fix'];
  const partial = checkRoleReportSections(card, '## 结论\n修好了\n## 改动\nindex.mjs');
  assert.equal(partial.ok, false);
  assert.ok(partial.missing.includes('根因'));
  assert.ok(partial.missing.includes('证据'));
  assert.match(partial.notice, /缺少角色卡「交回」要求的段落/);

  const complete = checkRoleReportSections(card, '## 结论\n修好了\n## 根因\n第 10 行\n## 改动\na.js\n## 证据\npassed\n## 没做的和拿不准的\n无');
  assert.equal(complete.ok, true);
  assert.equal(complete.notice, '');

  const guard = new CompletionIntegrityGuard();
  const rCtx = {agentId: 'roles', sessionKey: 'agent:roles:pinkie-child:gate1', runId: 'run-g1'};
  guard.begin({prompt: '修改文件并跑测试'}, rCtx);
  const gDecision = guard.finalize({lastAssistantMessage: '已经全部修好并测试通过。'}, rCtx);
  assert.equal(gDecision?.action, 'revise', '交付真实性门禁对 roles 照常生效');

  // R1-28 ★: personas/metre/AGENTS.md 包含 3.11 原句且注入总字数 <= 6500
  const agentsMd = fs.readFileSync(path.resolve('personas/metre/AGENTS.md'), 'utf8');
  assert.ok(agentsMd.includes('有合适的角色就写上 `role`：做法、边界和汇报格式角色卡里都有，简报只写目标、背景和这一单特有的要求。'));
  const metreCollect = await collect('metre');
  assert.ok(metreCollect.total <= 6500, `Metre 总注入字数 ${metreCollect.total} 超 6500`);

  // R1-29 ★: 角色子会话计入同时在跑上限、累计上限，并被全停停下
  f.prefs.setGlobal({metreMaxRunning: 2, metreRequestCap: 3});
  const c1 = await f.lineage.start(METRE, 'rcap', {title: '一', prompt: '做一', initiation: 'user_asked', role: 'backend-fix'}, 'cap1');
  f.running.add(c1.key);
  const c2 = await f.lineage.start(METRE, 'rcap', {title: '二', prompt: '做二', initiation: 'user_asked', role: 'backend-fix'}, 'cap2');
  f.running.add(c2.key);
  await assert.rejects(
    f.lineage.start(METRE, 'rcap', {title: '三', prompt: '做三', initiation: 'user_asked', role: 'backend-fix'}, 'cap3'),
    /已有 2 个子会话在跑/,
  );
  const stoppedRes = await f.lineage.stopAll(METRE);
  assert.equal(stoppedRes.ok, true);
  assert.equal(stoppedRes.stopped, 2);
  assert.equal(f.running.size, 0);

  // R1-30: roles 会话拿不到 metre_memory 工具且不注入 Metre 项目记忆
  const memRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metre-roles-mem-'));
  t.after(() => fs.rmSync(memRoot, {recursive: true, force: true}));
  const memHooks = [];
  const memTools = [];
  const memApi = {
    on: (name, fn) => memHooks.push({name, fn}),
    registerTool: (factory, opts) => memTools.push({factory, opts}),
    registerGatewayMethod() {},
    logger: {warn() {}},
  };
  registerMetreMemory(memApi, {root: memRoot, stateRoot: memRoot, bindingsFile: path.join(memRoot, 'bindings.json')});
  const roleCtx = {agentId: 'roles', sessionKey: 'agent:roles:pinkie-child:mem01'};
  for (const mt of memTools) assert.equal(mt.factory(roleCtx), null, 'roles 不得拥有 metre_memory 工具');
  for (const mh of memHooks.filter(h => h.name === 'before_prompt_build')) {
    assert.equal(await mh.fn({prompt: '查项目记忆'}, roleCtx), undefined);
  }
  assert.deepEqual(fs.readdirSync(memRoot), [], 'roles 不应写任何 Metre 项目记忆文件');

  // X5: 断网时 pinkie_roles、派活与挑模型不发任何网络请求
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN_OFFLINE'); };
  try {
    const info = f.lineage.rolesInfo(METRE, {});
    assert.equal(info.summary.validCount, 1);
    const chosen = chooseRoleModel({
      config: f.config, health: f.health, selfModel: SELF,
      roleCard: card,
    });
    assert.ok(chosen.model);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ---------- Z3a ★ & Z3c ★: 五个老模式逐字一致性快照回归 ----------
test('Z3a ★ & Z3c ★ 五个老模式注入与工具定义快照和 R0 基准逐字一致', async () => {
  const res = await verifyBaseline(path.resolve('briefs/metre-roles-1118/main-inject-baseline.json'));
  assert.equal(res.ok, true, `老模式基线被意外改动：${res.diffs.join('; ')}`);
});
