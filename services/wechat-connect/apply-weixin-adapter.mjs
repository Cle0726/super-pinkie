import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HASHES = {
  'src/messaging/process-message.ts': '05f4bb55cb74c014a22b879c75a0a1dc2084d4d1c6120fcaa18d84464a3a6efa',
  'dist/src/messaging/process-message.js': 'f411870309327b202fb23687970510311869723984463bb7882cfaf234f7582a',
};
const hash = text => createHash('sha256').update(text).digest('hex');
export function adaptWechatMessageSource(source) {
  const anchor = /^([ \t]*)const receivedAt = Date\.now\(\);$/m;
  const route = /sessionKey: route\.mainSessionKey,/g;
  if ((source.match(anchor) || []).length === 0 || [...source.matchAll(route)].length !== 1) throw new Error('Unknown Weixin message structure');
  const updated = source.replace(anchor, (_, indent) => `${indent}// pinkie-wechat-owner-scope-v1: authorize before commands or media work.\n${indent}const scannerUserId = loadWeixinAccount(deps.accountId)?.userId?.trim();\n${indent}if (!scannerUserId || full.from_user_id !== scannerUserId) {\n${indent}    deps.errLog("微信发送者未授权，忽略这条消息。");\n${indent}    return;\n${indent}}\n${indent}const scannerRoute = deps.channelRuntime.routing.resolveAgentRoute({\n${indent}    cfg: deps.config, channel: "openclaw-weixin", accountId: deps.accountId,\n${indent}    peer: { kind: "direct", id: scannerUserId },\n${indent}});\n${indent}if (scannerRoute.agentId !== "unrestricted" || scannerRoute.lastRoutePolicy !== "session"\n${indent}    || !scannerRoute.sessionKey.startsWith(\x60agent:unrestricted:openclaw-weixin:\x24{deps.accountId}:direct:\x60)) {\n${indent}    deps.errLog("微信还没有接到独立的无限模式会话，忽略这条消息。");\n${indent}    return;\n${indent}}\n${indent}// pinkie-wechat-owner-scope-end\n${indent}const receivedAt = Date.now();`);
  return updated.replace(route, 'sessionKey: route.lastRoutePolicy === "main" ? route.mainSessionKey : route.sessionKey,');
}
export function planWeixinAdapter(root) {
  if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version !== '2.4.9') throw new Error('Weixin adapter requires verified version 2.4.9');
  const files = Object.entries(HASHES).map(([rel, expected]) => {
    const file = path.join(root, rel), source = fs.readFileSync(file, 'utf8');
    if (hash(source) === expected) return {file, source, next: adaptWechatMessageSource(source)};
    if (source.includes('pinkie-wechat-owner-scope-v1')) {
      // Reverse just this adapter, then check the publisher's exact baseline.
      const restored = source.replace(/^[ \t]*\/\/ pinkie-wechat-owner-scope-v1: authorize before commands or media work\.[\s\S]*?^[ \t]*\/\/ pinkie-wechat-owner-scope-end\n/gm, '')
        .replace('sessionKey: route.lastRoutePolicy === "main" ? route.mainSessionKey : route.sessionKey,', 'sessionKey: route.mainSessionKey,');
      if (hash(restored) === expected && source === adaptWechatMessageSource(restored)) return {file, source, next: source};
    }
    throw new Error(`Weixin publisher file changed: ${rel}; nothing was written`);
  });
  return files;
}
export function applyWeixinAdapter(root) {
  const plan = planWeixinAdapter(root); // Verify every file before any write.
  const written = [];
  try {
    for (const item of plan) if (item.next !== item.source) {
      fs.writeFileSync(`${item.file}.pinkie-original`, item.source, {flag: 'wx'});
      fs.writeFileSync(`${item.file}.pinkie-tmp`, item.next);
      fs.renameSync(`${item.file}.pinkie-tmp`, item.file); written.push(item);
    }
  } catch (error) { for (const item of written) fs.writeFileSync(item.file, item.source); throw error; }
  return plan.map(item => ({file: item.file, changed: item.source !== item.next, sha256: hash(item.next)}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) throw new Error('Usage: node apply-weixin-adapter.mjs <verified plugin package>');
  console.log(JSON.stringify(applyWeixinAdapter(root), null, 2));
}
