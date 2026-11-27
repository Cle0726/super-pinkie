// QQ 插件适配器（services/messaging-connect/apply-qq-adapter.mjs）的纯逻辑单测。
// 真实的 @openclaw/qqbot 2026.7.1 发布包不在仓库里，也不碰 ~/.openclaw：
// 用只含锚点的合成源码验证四个改写函数（并把注入的代码片段接上假对象实际跑一遍），
// 用临时目录验证预检的拒绝路径，以及拒绝时「一个字节都不写」。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  QQ_ADAPTER_BASELINES,
  adaptQQChannelSource,
  adaptQQGatewaySource,
  adaptQQManifestSource,
  adaptQQSchemaSource,
  applyQQAdapter,
  planQQAdapter,
} from '../services/messaging-connect/apply-qq-adapter.mjs';

const SCRIPT = fileURLToPath(new URL('../services/messaging-connect/apply-qq-adapter.mjs', import.meta.url));
const AsyncFunction = (async () => {}).constructor;
const GATEWAY = 'dist/gateway-pJQppxe4.js';

// gateway 改写依赖的六处锚点（按改写顺序）及其报错标签。
const GATEWAY_ANCHORS = [
  ['pairing imports', '//#region extensions/qqbot/src/engine/group/activation.ts'],
  ['access gate', '\tif (access.senderAccess.decision !== "allow") {\n'],
  ['pairing store', '\t\t\t\tidentity: qqbotIngressIdentity,\n\t\t\t\tcfg: input.cfg\n'],
  ['pairing command owner', '\t\t\tconst commandOwnerAllowFrom = input.isGroup ? [] : input.allowFrom && input.allowFrom.length > 0 ? input.allowFrom : ["*"];'],
  ['direct pairing policy', '\t\t\t\tevent: { mayPair: false },\n\t\t\t\tdmPolicy,'],
  ['pre-queue command gate', '\tconst isGroup = msg.type === "group" || msg.type === "guild";\n'],
];
const GATE_END = '// pinkie-qq-pairing-end';
const CHANNEL_SOURCE = 'function route(sk) {\n\tconst m = sk.match(/qqbot:(c2c|direct|group):([A-F0-9]+)/i);\n\treturn m;\n}\n';
const SCHEMA_SOURCE = 'const QQBotDmPolicySchema = z.enum([\n\t"open",\n\t"allowlist",\n\t"disabled"\n]);\n';
const MANIFEST_ERROR = {message: 'Unknown QQ manifest DM schema structure'};

const count = (text, part) => text.split(part).length - 1;

// 用锚点拼出合成的 gateway 源码，锚点之间夹着填充行，便于检查原有内容是否保留。
function gatewaySource(anchors = GATEWAY_ANCHORS.map(([, anchor]) => anchor)) {
  return anchors.map((anchor, i) => `// filler ${i}\n${anchor}\n`).join('') + '// tail\n';
}

// 生成带 n 处 dmPolicy 枚举的插件清单，结构与发布包的 openclaw.plugin.json 一致。
function manifest(n, indent = 2) {
  const properties = {};
  for (let i = 0; i < n; i++) {
    properties[`slot${i}`] = {dmPolicy: {type: 'string', enum: ['open', 'allowlist', 'disabled'], default: 'open'}};
  }
  return JSON.stringify({id: 'qqbot', configSchema: {type: 'object', properties}}, null, indent) + '\n';
}

// 把注入的私聊配对门禁（连同它所在的原有 if 块）编译成可调用的函数，只用假对象执行。
function gateHarness(out) {
  const start = out.indexOf(GATEWAY_ANCHORS[1][1]);
  const end = out.indexOf(GATE_END) + GATE_END.length;
  const params = ['access', 'event', 'isGroupChat', 'account', 'issuePairingChallenge',
    'upsertChannelPairingRequest', 'sendText', 'buildDeliveryTarget', 'accountToCreds', 'log'];
  return new AsyncFunction(...params, `${out.slice(start, end)}\n\t\treturn "blocked";\n\t}\n\treturn "allowed";`);
}

async function runGate(gate, over = {}) {
  const calls = {issue: [], upsert: [], sent: [], errors: []};
  const ctx = {
    access: {senderAccess: {decision: 'pairing', reasonCode: 'dm_policy_pairing_required'}},
    event: {type: 'c2c', senderId: 'ABC123', messageId: 'm-1'},
    isGroupChat: false,
    account: {accountId: 'acct', appId: 'app-9', config: {dmPolicy: 'pairing'}},
    issue: async opts => { calls.issue.push(opts); },
    ...over,
  };
  const result = await gate(ctx.access, ctx.event, ctx.isGroupChat, ctx.account, ctx.issue,
    async request => { calls.upsert.push(request); },
    async (...args) => { calls.sent.push(args); },
    event => ({to: event.senderId}),
    account => ({appId: account.appId}),
    {error: message => calls.errors.push(message)});
  return {result, calls};
}

// 把注入的入队前门禁编译成函数；process 作为参数传入，避免读到真实环境变量。
function queueHarness(out) {
  const start = out.indexOf(GATEWAY_ANCHORS[5][1]);
  const end = out.indexOf('\t}\n', start) + 3;
  return new AsyncFunction('msg', 'account', 'readChannelAllowFromStore', 'normalizeQQBotAllowFrom',
    'normalizeQQBotSenderId', 'process', `${out.slice(start, end)}\treturn "continue";`);
}

// 建一个临时插件目录；四个目标文件都是「结构可改写、但哈希未经校验」的合成内容。
function tempPackage(t, {pkg = {name: '@openclaw/qqbot', version: '2026.7.1'}} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-qq-adapter-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  if (pkg) fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, GATEWAY), gatewaySource());
  fs.writeFileSync(path.join(root, 'dist/channel-D1UztsnG.js'), CHANNEL_SOURCE);
  fs.writeFileSync(path.join(root, 'dist/config-schema-JZEf1dvB.js'), SCHEMA_SOURCE);
  fs.writeFileSync(path.join(root, 'openclaw.plugin.json'), manifest(2));
  return root;
}

// 记录目录下全部文件与内容，用来断言拒绝时什么都没写、什么都没删。
function snapshot(dir, base = dir, out = {}) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (fs.lstatSync(full).isDirectory()) {
      out[`${rel}/`] = 'dir';
      snapshot(full, base, out);
    } else {
      out[rel] = fs.readFileSync(full, 'utf8');
    }
  }
  return out;
}

test('QQ_ADAPTER_BASELINES 冻结且恰好覆盖四个发布文件', () => {
  assert.ok(Object.isFrozen(QQ_ADAPTER_BASELINES));
  assert.deepEqual(Object.keys(QQ_ADAPTER_BASELINES).sort(), [
    'dist/channel-D1UztsnG.js', 'dist/config-schema-JZEf1dvB.js', GATEWAY, 'openclaw.plugin.json',
  ]);
  for (const digest of Object.values(QQ_ADAPTER_BASELINES)) assert.match(digest, /^[0-9a-f]{64}$/);
  assert.throws(() => { QQ_ADAPTER_BASELINES[GATEWAY] = '0'.repeat(64); }, TypeError);
});

test('adaptQQGatewaySource 在六处锚点各改写一次，原有内容原样保留', () => {
  const out = adaptQQGatewaySource(gatewaySource());
  const importLine = 'import { issuePairingChallenge, upsertChannelPairingRequest, readChannelAllowFromStore } from "openclaw/plugin-sdk/conversation-runtime";\n';
  assert.equal(count(out, importLine), 1);
  assert.ok(out.includes(importLine + GATEWAY_ANCHORS[0][1]));
  assert.ok(out.includes(`${GATEWAY_ANCHORS[1][1]}\t\t// pinkie-qq-pairing-v1:`));
  assert.equal(count(out, 'pinkie-qq-pairing-v1'), 1);
  assert.equal(count(out, GATE_END), 1);
  assert.ok(out.includes('\t\t\t\tidentity: qqbotIngressIdentity,\n\t\t\t\tcfg: input.cfg,\n\t\t\t\tuseDefaultPairingStore: true\n'));
  assert.ok(out.includes('\t\t\t\tevent: { mayPair: !input.isGroup },\n\t\t\t\tdmPolicy,'));
  assert.ok(out.includes(`${GATEWAY_ANCHORS[5][1]}\t// Pairing accounts must reach the access gate before unapproved DM commands.\n`));
  // 被替换掉的三处旧写法不再出现。
  for (const [label, anchor] of GATEWAY_ANCHORS.slice(2, 5)) assert.equal(count(out, anchor), 0, label);
  for (let i = 0; i < GATEWAY_ANCHORS.length; i++) assert.ok(out.includes(`// filler ${i}\n`), `filler ${i}`);
  assert.ok(out.endsWith('// tail\n'));
  // 模板字符串里的 ${...} 必须原样写入，不能被 String.replace 的 $ 替换规则吞掉。
  assert.ok(out.includes('senderIdLine: `QQ ID: ${event.senderId}`,'));
  assert.ok(out.includes('配对码：${code}。确认前不会执行你的消息。'));
});

test('gateway 锚点缺失或重复时抛出带标签的错误；改写过的源码不会被二次改写', () => {
  const anchors = GATEWAY_ANCHORS.map(([, anchor]) => anchor);
  for (const [i, [label]] of GATEWAY_ANCHORS.entries()) {
    const error = {message: `Unknown QQ ${label} structure`};
    const missing = anchors.map((anchor, j) => (j === i ? '// gone' : anchor));
    assert.throws(() => adaptQQGatewaySource(gatewaySource(missing)), error);
    const doubled = anchors.flatMap((anchor, j) => (j === i ? [anchor, anchor] : [anchor]));
    assert.throws(() => adaptQQGatewaySource(gatewaySource(doubled)), error);
  }
  const once = adaptQQGatewaySource(gatewaySource());
  assert.throws(() => adaptQQGatewaySource(once), {message: 'Unknown QQ pairing store structure'});
});

test('注入的私聊门禁：只对待配对的私聊发起配对挑战，失败只记日志不外抛', async () => {
  const gate = gateHarness(adaptQQGatewaySource(gatewaySource()));
  const {result, calls} = await runGate(gate);
  assert.equal(result, 'blocked');
  assert.equal(calls.issue.length, 1);
  const opts = calls.issue[0];
  assert.equal(opts.channel, 'qqbot');
  assert.equal(opts.accountId, 'acct');
  assert.equal(opts.senderId, 'ABC123');
  assert.equal(opts.senderIdLine, 'QQ ID: ABC123');
  assert.deepEqual(opts.meta, {pinkieAppId: 'app-9'});
  assert.equal(opts.buildReplyText({code: 'K7Q2'}), '请在碧琪的 QQ 连接卡片输入配对码：K7Q2。确认前不会执行你的消息。');
  await opts.upsertPairingRequest({id: 'ABC123', meta: {x: 1}});
  assert.deepEqual(calls.upsert, [{channel: 'qqbot', accountId: 'acct', id: 'ABC123', meta: {x: 1}}]);
  await opts.sendPairingReply('hi');
  assert.deepEqual(calls.sent, [[{to: 'ABC123'}, 'hi', {appId: 'app-9'}, {msgId: 'm-1'}]]);
  opts.onReplyError();
  assert.deepEqual(calls.errors, ['QQ 配对提示发送失败，请稍后重试。']);

  // dm 类型同样发起挑战。
  assert.equal((await runGate(gate, {event: {type: 'dm', senderId: 'S', messageId: 'm'}})).calls.issue.length, 1);
  // 任一条件不满足都不发挑战，但仍被原有门禁拦下。
  for (const over of [
    {isGroupChat: true},
    {event: {type: 'group', senderId: 'S', messageId: 'm'}},
    {account: {accountId: 'acct', appId: 'a', config: {dmPolicy: 'open'}}},
    {account: {accountId: 'acct', appId: 'a'}},
    {access: {senderAccess: {decision: 'block', reasonCode: 'dm_policy_pairing_required'}}},
    {access: {senderAccess: {decision: 'pairing', reasonCode: 'dm_policy_allowlist'}}},
  ]) {
    const run = await runGate(gate, over);
    assert.equal(run.result, 'blocked', JSON.stringify(over));
    assert.equal(run.calls.issue.length, 0, JSON.stringify(over));
  }
  // 已放行的消息不进入配对分支。
  const allowed = await runGate(gate, {access: {senderAccess: {decision: 'allow'}}});
  assert.equal(allowed.result, 'allowed');
  assert.equal(allowed.calls.issue.length, 0);
  // 配对请求本身抛错时不外抛，只记一条不含细节的日志。
  const failing = await runGate(gate, {issue: async () => { throw new Error('store down'); }});
  assert.equal(failing.result, 'blocked');
  assert.deepEqual(failing.calls.errors, ['QQ 配对请求失败，请稍后重试。']);
});

test('注入后的命令属主规则：配对模式下通配符不算属主', () => {
  const out = adaptQQGatewaySource(gatewaySource());
  const line = out.split('\n').find(text => text.includes('const commandOwnerAllowFrom'));
  const ownerOf = new Function('input', 'dmPolicy', 'normalizedAllowFrom', `${line}\nreturn commandOwnerAllowFrom;`);
  assert.deepEqual(ownerOf({isGroup: true, allowFrom: ['u1']}, 'pairing', ['U1']), []);
  assert.deepEqual(ownerOf({isGroup: false, allowFrom: ['*', 'u1']}, 'pairing', ['*', 'U1']), ['U1']);
  assert.deepEqual(ownerOf({isGroup: false, allowFrom: ['*']}, 'pairing', ['*']), []);
  assert.deepEqual(ownerOf({isGroup: false, allowFrom: []}, 'open', []), ['*']);
  assert.deepEqual(ownerOf({isGroup: false}, 'open', []), ['*']);
  assert.deepEqual(ownerOf({isGroup: false, allowFrom: ['u2']}, 'allowlist', ['U2']), ['u2']);
});

test('注入的入队前门禁：配对账号里未配对的私聊直接入队，交给配对门禁处理', async () => {
  const queue = queueHarness(adaptQQGatewaySource(gatewaySource()));
  const env = {MARK: 'isolated'};
  const reads = [];
  const store = paired => async (...args) => { reads.push(args); return paired; };
  const upperAll = list => list.map(id => String(id).toUpperCase());
  const upper = id => String(id).toUpperCase();
  const pairing = {accountId: 'acct', config: {dmPolicy: 'pairing'}};
  const run = (msg, account, read) => queue(msg, account, read, upperAll, upper, {env});

  assert.equal(await run({type: 'c2c', senderId: 'abc'}, pairing, store(['ABC'])), 'continue');
  assert.deepEqual(reads, [['qqbot', env, 'acct']]);
  assert.equal(await run({type: 'c2c', senderId: 'zzz'}, pairing, store(['ABC'])), 'enqueue');
  // 读配对表失败按「未配对」处理，不外抛。
  assert.equal(await run({type: 'c2c', senderId: 'abc'}, pairing, async () => { throw new Error('io'); }), 'enqueue');
  reads.length = 0;
  assert.equal(await run({type: 'group', senderId: 'zzz'}, pairing, store([])), 'continue');
  assert.equal(await run({type: 'guild', senderId: 'zzz'}, pairing, store([])), 'continue');
  assert.equal(await run({type: 'c2c', senderId: 'zzz'}, {accountId: 'acct', config: {dmPolicy: 'open'}}, store([])), 'continue');
  assert.equal(await run({type: 'c2c', senderId: 'zzz'}, {accountId: 'acct'}, store([])), 'continue');
  assert.deepEqual(reads, []);
});

test('adaptQQChannelSource 把审批路由正则收紧到会话键边界，并允许一段可选账号', () => {
  const out = adaptQQChannelSource(CHANNEL_SOURCE);
  assert.equal(count(out, 'sk.match('), 1);
  const route = new Function(`${out}\nreturn route;`)();
  const legacy = new Function(`${CHANNEL_SOURCE}\nreturn route;`)();
  const pick = m => (m ? [m[1], m[2]] : null);
  const cases = [
    ['qqbot:c2c:ABCDEF0123', ['c2c', 'ABCDEF0123']],
    ['agent:main:qqbot:direct:abc123', ['direct', 'abc123']],
    ['agent:main:qqbot:bot-1:group:FF00', ['group', 'FF00']],
    ['agent:main:qqbot:default:c2c:AB12:thread:42', ['c2c', 'AB12']],
    ['xqqbot:c2c:AB12', null],
    ['qqbot:c2c:AB12XYZ', null],
    ['qqbot:c2c:AB12:other', null],
    ['qqbot:a:b:c2c:AB12', null],
    ['qqbot:acc ount:c2c:AB12', null],
  ];
  for (const [key, expected] of cases) assert.deepEqual(pick(route(key)), expected, key);
  // 对照：旧正则会把这两种键误判为可路由。
  assert.deepEqual(pick(legacy('xqqbot:c2c:AB12')), ['c2c', 'AB12']);
  assert.deepEqual(pick(legacy('qqbot:c2c:AB12XYZ')), ['c2c', 'AB12']);
  const error = {message: 'Unknown QQ approval route structure'};
  assert.throws(() => adaptQQChannelSource('function route() {}'), error);
  assert.throws(() => adaptQQChannelSource(CHANNEL_SOURCE + CHANNEL_SOURCE), error);
  assert.throws(() => adaptQQChannelSource(out), error);
});

test('adaptQQSchemaSource 在运行时 DM 策略枚举最前面加入 pairing', () => {
  const out = adaptQQSchemaSource(SCHEMA_SOURCE);
  const values = new Function('z', `${out}\nreturn QQBotDmPolicySchema;`)({enum: list => list});
  assert.deepEqual(values, ['pairing', 'open', 'allowlist', 'disabled']);
  const error = {message: 'Unknown QQ runtime DM schema structure'};
  assert.throws(() => adaptQQSchemaSource(out), error);
  assert.throws(() => adaptQQSchemaSource(SCHEMA_SOURCE.replace('\t"open"', '  "open"')), error);
  assert.throws(() => adaptQQSchemaSource(SCHEMA_SOURCE + SCHEMA_SOURCE), error);
});

test('adaptQQManifestSource 恰好改写两处 dmPolicy 枚举并保留原缩进', () => {
  for (const indent of [2, '\t']) {
    const out = adaptQQManifestSource(manifest(2, indent));
    const expected = JSON.parse(manifest(2, indent));
    for (const slot of Object.values(expected.configSchema.properties)) slot.dmPolicy.enum.unshift('pairing');
    assert.equal(out, JSON.stringify(expected, null, indent) + '\n');
    assert.throws(() => adaptQQManifestSource(out), MANIFEST_ERROR);
  }
  for (const n of [0, 1, 3]) assert.throws(() => adaptQQManifestSource(manifest(n)), MANIFEST_ERROR);
  // Windows 换行的清单不认识，宁可拒绝也不半改。
  assert.throws(() => adaptQQManifestSource(manifest(2).replace(/\n/g, '\r\n')), MANIFEST_ERROR);
});

test('planQQAdapter 只接受已校验的 @openclaw/qqbot 2026.7.1', t => {
  assert.throws(() => planQQAdapter(tempPackage(t, {pkg: null})), {code: 'ENOENT'});
  const error = {message: 'QQ adapter requires verified @openclaw/qqbot 2026.7.1'};
  for (const pkg of [{name: '@openclaw/qqbot', version: '2026.7.2'}, {name: 'qqbot', version: '2026.7.1'}, {}]) {
    assert.throws(() => planQQAdapter(tempPackage(t, {pkg})), error, JSON.stringify(pkg));
  }
  const broken = tempPackage(t, {pkg: null});
  fs.writeFileSync(path.join(broken, 'package.json'), '{not json');
  assert.throws(() => planQQAdapter(broken), SyntaxError);
});

test('planQQAdapter 拒绝缺失或不是普通文件的发布目标', t => {
  const missing = tempPackage(t);
  fs.rmSync(path.join(missing, GATEWAY));
  assert.throws(() => planQQAdapter(missing), {code: 'ENOENT'});

  const error = {message: `QQ publisher target must be a regular file: ${GATEWAY}`};
  const folder = tempPackage(t);
  fs.rmSync(path.join(folder, GATEWAY));
  fs.mkdirSync(path.join(folder, GATEWAY));
  assert.throws(() => planQQAdapter(folder), error);

  // 符号链接同样拒绝；Windows 无权限建链接时跳过这一小段。
  const linked = tempPackage(t);
  const target = path.join(linked, GATEWAY);
  fs.renameSync(target, `${target}.real`);
  try {
    fs.symlinkSync(`${target}.real`, target);
  } catch (err) {
    if (err.code === 'EPERM') return;
    throw err;
  }
  assert.throws(() => planQQAdapter(linked), error);
});

test('哈希未经校验的发布文件：plan 与 apply 都拒绝，且一个字节都不写', t => {
  const root = tempPackage(t);
  const before = snapshot(root);
  const error = {message: `QQ publisher file changed: ${GATEWAY}; nothing was written`};
  // 即使内容结构完全可改写，只要哈希对不上发布基线就不动。
  assert.throws(() => planQQAdapter(root), error);
  assert.throws(() => applyQQAdapter(root), error);
  assert.deepEqual(snapshot(root), before);

  // 留着旧的备份与临时文件时也一样：不删、不改、不新增。
  fs.writeFileSync(path.join(root, `${GATEWAY}.pinkie-tmp`), 'stale');
  fs.writeFileSync(path.join(root, `${GATEWAY}.pinkie-original`), 'old');
  const withLeftovers = snapshot(root);
  assert.throws(() => applyQQAdapter(root), error);
  assert.deepEqual(snapshot(root), withLeftovers);
});

test('命令行入口：缺参数报用法，校验失败非零退出、无输出、不写文件', t => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], {encoding: 'utf8'});
  const usage = run();
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /Usage: node apply-qq-adapter\.mjs <verified plugin package>/);
  assert.equal(usage.stdout, '');

  const root = tempPackage(t);
  const before = snapshot(root);
  const refused = run(root);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /QQ publisher file changed: dist\/gateway-pJQppxe4\.js; nothing was written/);
  assert.equal(refused.stdout, '');
  assert.deepEqual(snapshot(root), before);
});
