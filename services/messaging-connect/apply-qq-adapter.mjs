import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Publisher baselines are from the integrity-verified @openclaw/qqbot 2026.7.1 tarball.
export const QQ_ADAPTER_BASELINES = Object.freeze({
  'dist/gateway-pJQppxe4.js': '4bf32cc98470b09a1267818ae94119446848f16a1224787544a7742c3d47df38',
  'dist/channel-D1UztsnG.js': 'd0cdfa6f07578f8db5cf24e73c34fb1eb4de6c0a62075bad06cf6881bd603db6',
  'dist/config-schema-JZEf1dvB.js': 'f7d6d7b47f281ce8e7d3aec9cdf14c38e2068055d4281ce08a030306a2d1d1ba',
  'openclaw.plugin.json': '6909073974d40bb53c780575be3d1224e8f706ad44e4426c3805f4374b9a824f',
});
const PATCHED_HASHES = Object.freeze({
  'dist/gateway-pJQppxe4.js': 'd89d80672fad56922a8e85cc8b91ef0711c8c2e1c5a6d73387e21b6a926804e1',
  'dist/channel-D1UztsnG.js': '960fe6ab199117825678358d0ec4413c2c80077b27ddc8c9ea2190d1ef8c41d3',
  'dist/config-schema-JZEf1dvB.js': 'e8e1414387c75f7ea59872b7362451be3b287e1c84930f93ab583bd13c0c2151',
  'openclaw.plugin.json': 'f8e50832f2ba0bb34bc40de9e2c1aaf7f7c969f262f471de321bd9e9cf8c7962',
});
const hash = source => createHash('sha256').update(source).digest('hex');

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Unknown QQ ${label} structure`);
  return source.replace(before, after);
}

export function adaptQQGatewaySource(source) {
  let next = replaceOnce(source,
    '//#region extensions/qqbot/src/engine/group/activation.ts',
    'import { issuePairingChallenge, upsertChannelPairingRequest, readChannelAllowFromStore } from "openclaw/plugin-sdk/conversation-runtime";\n' +
      '//#region extensions/qqbot/src/engine/group/activation.ts', 'pairing imports');
  const block = '\tif (access.senderAccess.decision !== "allow") {\n';
  next = replaceOnce(next, block, block + [
    '\t\t// pinkie-qq-pairing-v1: issue a challenge before media work or agent dispatch.',
    '\t\tif (!isGroupChat && (event.type === "c2c" || event.type === "dm")',
    '\t\t\t&& account.config?.dmPolicy === "pairing"',
    '\t\t\t&& access.senderAccess.decision === "pairing"',
    '\t\t\t&& access.senderAccess.reasonCode === "dm_policy_pairing_required") {',
    '\t\t\ttry {',
    '\t\t\t\tawait issuePairingChallenge({',
    '\t\t\t\t\tchannel: "qqbot", accountId: account.accountId, senderId: event.senderId,',
    '\t\t\t\t\tsenderIdLine: `QQ ID: ${event.senderId}`,',
    '\t\t\t\t\tmeta: { pinkieAppId: account.appId },',
    '\t\t\t\t\tupsertPairingRequest: ({ id, meta }) => upsertChannelPairingRequest({',
    '\t\t\t\t\t\tchannel: "qqbot", accountId: account.accountId, id, meta',
    '\t\t\t\t\t}),',
    '\t\t\t\t\tbuildReplyText: ({ code }) => `请在 C.le. 的 QQ 连接卡片输入配对码：${code}。确认前不会执行你的消息。`,',
    '\t\t\t\t\tsendPairingReply: text => sendText(buildDeliveryTarget(event), text, accountToCreds(account), { msgId: event.messageId }),',
    '\t\t\t\t\tonReplyError: () => log?.error("QQ 配对提示发送失败，请稍后重试。")',
    '\t\t\t\t});',
    '\t\t\t} catch { log?.error("QQ 配对请求失败，请稍后重试。"); }',
    '\t\t}',
    '\t\t// pinkie-qq-pairing-end',
    ''
  ].join('\n'), 'access gate');
  next = replaceOnce(next,
    '\t\t\t\tidentity: qqbotIngressIdentity,\n\t\t\t\tcfg: input.cfg\n',
    '\t\t\t\tidentity: qqbotIngressIdentity,\n\t\t\t\tcfg: input.cfg,\n\t\t\t\tuseDefaultPairingStore: true\n', 'pairing store');
  next = replaceOnce(next,
    '\t\t\tconst commandOwnerAllowFrom = input.isGroup ? [] : input.allowFrom && input.allowFrom.length > 0 ? input.allowFrom : ["*"];',
    '\t\t\tconst commandOwnerAllowFrom = input.isGroup ? [] : dmPolicy === "pairing" ? normalizedAllowFrom.filter(entry => entry !== "*") : input.allowFrom && input.allowFrom.length > 0 ? input.allowFrom : ["*"];', 'pairing command owner');
  next = replaceOnce(next,
    '\t\t\t\tevent: { mayPair: false },\n\t\t\t\tdmPolicy,',
    '\t\t\t\tevent: { mayPair: !input.isGroup },\n\t\t\t\tdmPolicy,', 'direct pairing policy');
  return replaceOnce(next,
    '\tconst isGroup = msg.type === "group" || msg.type === "guild";\n',
    '\tconst isGroup = msg.type === "group" || msg.type === "guild";\n' + [
      '\t// Pairing accounts must reach the access gate before unapproved DM commands.',
      '\tif (!isGroup && account.config?.dmPolicy === "pairing") {',
      '\t\tconst paired = await readChannelAllowFromStore("qqbot", process.env, account.accountId).catch(() => []);',
      '\t\tif (!normalizeQQBotAllowFrom(paired).includes(normalizeQQBotSenderId(msg.senderId))) return "enqueue";',
      '\t}',
      ''
    ].join('\n'), 'pre-queue command gate');
}

export function adaptQQChannelSource(source) {
  return replaceOnce(source,
    'const m = sk.match(/qqbot:(c2c|direct|group):([A-F0-9]+)/i);',
    'const m = sk.match(/(?:^|:)qqbot:(?:[^:\\s]+:)?(c2c|direct|group):([A-F0-9]+)(?=$|:thread:)/i);', 'approval route');
}

export function adaptQQSchemaSource(source) {
  return replaceOnce(source,
    'const QQBotDmPolicySchema = z.enum([\n\t"open",',
    'const QQBotDmPolicySchema = z.enum([\n\t"pairing",\n\t"open",', 'runtime DM schema');
}

export function adaptQQManifestSource(source) {
  const target = /("dmPolicy":\s*\{\s*"type": "string",\s*"enum":\s*\[\n)([ \t]*)"open",/g;
  if ([...source.matchAll(target)].length !== 2) throw new Error('Unknown QQ manifest DM schema structure');
  return source.replace(target, '$1$2"pairing",\n$2"open",');
}

const TRANSFORMS = Object.freeze({
  'dist/gateway-pJQppxe4.js': adaptQQGatewaySource,
  'dist/channel-D1UztsnG.js': adaptQQChannelSource,
  'dist/config-schema-JZEf1dvB.js': adaptQQSchemaSource,
  'openclaw.plugin.json': adaptQQManifestSource,
});

export function planQQAdapter(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@openclaw/qqbot' || pkg.version !== '2026.7.1') throw new Error('QQ adapter requires verified @openclaw/qqbot 2026.7.1');
  const plan = Object.entries(QQ_ADAPTER_BASELINES).map(([relative, baseline]) => {
    const file = path.join(root, relative);
    if (!fs.lstatSync(file).isFile()) throw new Error(`QQ publisher target must be a regular file: ${relative}`);
    const source = fs.readFileSync(file, 'utf8'), digest = hash(source);
    if (digest !== baseline && digest !== PATCHED_HASHES[relative]) throw new Error(`QQ publisher file changed: ${relative}; nothing was written`);
    const next = digest === baseline ? TRANSFORMS[relative](source) : source;
    if (hash(next) !== PATCHED_HASHES[relative]) throw new Error(`QQ adapter patch hash mismatch: ${relative}; nothing was written`);
    return {file, relative, source, next, mode: fs.statSync(file).mode & 0o777};
  });
  // Check every original backup and temporary destination before the first write.
  for (const item of plan) {
    const backup = `${item.file}.pinkie-original`, temporary = `${item.file}.pinkie-tmp`;
    if (fs.existsSync(backup) && (!fs.lstatSync(backup).isFile() || hash(fs.readFileSync(backup)) !== QQ_ADAPTER_BASELINES[item.relative])) {
      throw new Error(`QQ adapter backup changed: ${item.relative}; nothing was written`);
    }
    if (fs.existsSync(temporary)) throw new Error(`QQ adapter temporary file already exists: ${item.relative}; nothing was written`);
  }
  return plan;
}

export function applyQQAdapter(root) {
  const plan = planQQAdapter(root);
  const changed = plan.filter(item => item.source !== item.next);
  // Avoid overwriting a publisher file modified since preflight.
  for (const item of plan) if (fs.readFileSync(item.file, 'utf8') !== item.source) throw new Error('QQ publisher changed during adapter preflight; nothing was written');
  const written = [], backups = [], temporary = [];
  try {
    for (const item of changed) {
      const backup = `${item.file}.pinkie-original`, temp = `${item.file}.pinkie-tmp`;
      if (!fs.existsSync(backup)) {
        fs.writeFileSync(backup, item.source, {flag: 'wx', mode: item.mode}); backups.push(backup);
      }
      fs.writeFileSync(temp, item.next, {flag: 'wx', mode: item.mode}); temporary.push(temp);
    }
    for (const item of changed) {
      fs.renameSync(`${item.file}.pinkie-tmp`, item.file); written.push(item);
    }
  } catch (error) {
    for (const item of written) fs.writeFileSync(item.file, item.source, {mode: item.mode});
    for (const file of temporary) fs.rmSync(file, {force: true});
    for (const file of backups) fs.rmSync(file, {force: true});
    throw error;
  }
  return plan.map(item => ({file: item.file, changed: item.source !== item.next, sha256: hash(item.next)}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node apply-qq-adapter.mjs <verified plugin package>');
  console.log(JSON.stringify(applyQQAdapter(process.argv[2]), null, 2));
}
