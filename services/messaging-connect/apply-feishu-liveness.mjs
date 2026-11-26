import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Publisher baselines are from the integrity-verified @openclaw/feishu 2026.7.1 tarball.
export const FEISHU_LIVENESS_BASELINES = Object.freeze({
  'dist/client-B7EAV_Ss.js': 'c98982dcf27d7615148faadbf0440234d398d1e4f97919e9db080c135e2664b9',
  'dist/monitor.account-Dr7do33p.js': 'c096cd1658b2b47f4e1554434af54bdbc115c5080627cf0e09a2b63ecfe35c85',
});
const PATCHED_HASHES = Object.freeze({
  'dist/client-B7EAV_Ss.js': '3f346aa3d7958a4ca1404b21fe820b5ab62c8ecbd0905d29985084b271f2a811',
  'dist/monitor.account-Dr7do33p.js': 'ea453b5783ede83919adc9bbdafc389d70f3609b53d4ef23309af3a8fa279cbe',
});
export const FEISHU_PING_TIMEOUT_SEC = 10;
export const FEISHU_HANDSHAKE_TIMEOUT_MS = 15000;
const hash = source => createHash('sha256').update(source).digest('hex');

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Unknown Feishu ${label} structure`);
  return source.replace(before, () => after);
}

export function adaptFeishuClientSource(source) {
  // @larksuiteoapi/node-sdk 1.68 only reads lowercase wsConfig.pingTimeout; without it the
  // pong watchdog never arms. Without handshakeTimeoutMs a stuck reconnect keeps
  // isConnecting=true, so every later reConnect is dropped as a repeat connection.
  const next = replaceOnce(source,
    'const FEISHU_WS_CONFIG = {\n\tPingInterval: 30,\n\tPingTimeout: 3\n};\n',
    'const FEISHU_WS_CONFIG = {\n\tPingInterval: 30,\n\tPingTimeout: 3,\n' +
      '\t// pinkie-feishu-liveness-v1: the SDK reads only the lowercase key.\n' +
      `\tpingTimeout: ${FEISHU_PING_TIMEOUT_SEC}\n};\n` +
      `const FEISHU_WS_HANDSHAKE_TIMEOUT_MS = ${FEISHU_HANDSHAKE_TIMEOUT_MS};\n` + [
        'function watchFeishuWsTransport(wsClient, onActivity) {',
        '\tconst wsConfig = wsClient.wsConfig;',
        '\tif (!wsConfig || typeof wsConfig.setWSInstance !== "function") return;',
        '\tconst setWSInstance = wsConfig.setWSInstance.bind(wsConfig);',
        '\tconst report = () => {',
        '\t\ttry { onActivity(); } catch {}',
        '\t};',
        '\twsConfig.setWSInstance = (wsInstance) => {',
        '\t\tsetWSInstance(wsInstance);',
        '\t\tif (!wsInstance || typeof wsInstance.on !== "function") return;',
        '\t\treport();',
        '\t\twsInstance.on("message", report);',
        '\t};',
        '}',
        ''
      ].join('\n'), 'WS config');
  return replaceOnce(next, [
    '\tconst agent = await getWsProxyAgent();',
    '\treturn new feishuClientSdk.WSClient({',
    '\t\tappId,',
    '\t\tappSecret,',
    '\t\tdomain: resolveDomain(domain),',
    '\t\t...callbacks,',
    '\t\tloggerLevel: feishuClientSdk.LoggerLevel.info,',
    '\t\twsConfig: FEISHU_WS_CONFIG,',
    '\t\t...agent ? { agent } : {}',
    '\t});',
    '}',
    ''
  ].join('\n'), [
    '\tconst agent = await getWsProxyAgent();',
    '\tconst { onTransportActivity, ...sdkCallbacks } = callbacks;',
    '\tconst wsClient = new feishuClientSdk.WSClient({',
    '\t\tappId,',
    '\t\tappSecret,',
    '\t\tdomain: resolveDomain(domain),',
    '\t\t...sdkCallbacks,',
    '\t\tloggerLevel: feishuClientSdk.LoggerLevel.info,',
    '\t\twsConfig: FEISHU_WS_CONFIG,',
    '\t\thandshakeTimeoutMs: FEISHU_WS_HANDSHAKE_TIMEOUT_MS,',
    '\t\t...agent ? { agent } : {}',
    '\t});',
    '\tif (onTransportActivity) watchFeishuWsTransport(wsClient, onTransportActivity);',
    '\treturn wsClient;',
    '}',
    ''
  ].join('\n'), 'WS client factory');
}

export function adaptFeishuMonitorSource(source) {
  // The gateway flags stale-socket only when lastTransportActivityAt is reported;
  // upstream WS mode never reports it, so a half-dead socket stays "connected".
  const next = replaceOnce(source,
    '\t\t\t\t\tlastConnectedAt: connectedAt,\n\t\t\t\t\tlastEventAt: connectedAt,\n\t\t\t\t\tlastError: null\n',
    '\t\t\t\t\tlastConnectedAt: connectedAt,\n\t\t\t\t\tlastEventAt: connectedAt,\n' +
      '\t\t\t\t\tlastTransportActivityAt: connectedAt,\n\t\t\t\t\tlastError: null\n', 'WS connected status');
  return replaceOnce(next,
    '\t\t\t\tonReconnecting: publishWsReconnecting\n\t\t\t});\n',
    '\t\t\t\tonReconnecting: publishWsReconnecting,\n' +
      '\t\t\t\t// pinkie-feishu-liveness-v1: every inbound frame (pong or event) proves transport life.\n' +
      '\t\t\t\tonTransportActivity: () => statusSink?.({ lastTransportActivityAt: Date.now() })\n\t\t\t});\n',
    'WS client callbacks');
}

const TRANSFORMS = Object.freeze({
  'dist/client-B7EAV_Ss.js': adaptFeishuClientSource,
  'dist/monitor.account-Dr7do33p.js': adaptFeishuMonitorSource,
});

export function planFeishuLiveness(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@openclaw/feishu' || pkg.version !== '2026.7.1') throw new Error('Feishu liveness patch requires verified @openclaw/feishu 2026.7.1');
  const plan = Object.entries(FEISHU_LIVENESS_BASELINES).map(([relative, baseline]) => {
    const file = path.join(root, relative);
    if (!fs.lstatSync(file).isFile()) throw new Error(`Feishu publisher target must be a regular file: ${relative}`);
    const source = fs.readFileSync(file, 'utf8'), digest = hash(source);
    if (digest !== baseline && digest !== PATCHED_HASHES[relative]) throw new Error(`Feishu publisher file changed: ${relative}; nothing was written`);
    const next = digest === baseline ? TRANSFORMS[relative](source) : source;
    if (hash(next) !== PATCHED_HASHES[relative]) throw new Error(`Feishu liveness patch hash mismatch: ${relative}; nothing was written`);
    return {file, relative, source, next, mode: fs.statSync(file).mode & 0o777};
  });
  // Check every original backup and temporary destination before the first write.
  for (const item of plan) {
    const backup = `${item.file}.pinkie-original`, temporary = `${item.file}.pinkie-tmp`;
    if (fs.existsSync(backup) && (!fs.lstatSync(backup).isFile() || hash(fs.readFileSync(backup)) !== FEISHU_LIVENESS_BASELINES[item.relative])) {
      throw new Error(`Feishu liveness backup changed: ${item.relative}; nothing was written`);
    }
    if (fs.existsSync(temporary)) throw new Error(`Feishu liveness temporary file already exists: ${item.relative}; nothing was written`);
  }
  return plan;
}

export function applyFeishuLiveness(root) {
  const plan = planFeishuLiveness(root);
  const changed = plan.filter(item => item.source !== item.next);
  // Avoid overwriting a publisher file modified since preflight.
  for (const item of plan) if (fs.readFileSync(item.file, 'utf8') !== item.source) throw new Error('Feishu publisher changed during liveness preflight; nothing was written');
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
  if (!process.argv[2]) throw new Error('Usage: node apply-feishu-liveness.mjs <verified plugin package>');
  console.log(JSON.stringify(applyFeishuLiveness(process.argv[2]), null, 2));
}
