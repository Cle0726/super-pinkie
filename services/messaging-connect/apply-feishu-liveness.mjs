import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyPublisherPatch, planPublisherPatch} from './publisher-patch.mjs';

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

// 报错文案与合并前逐字相同（tests/publisher-patch.test.mjs 锁住）。
export const FEISHU_PATCH = Object.freeze({
  name: '@openclaw/feishu', version: '2026.7.1',
  requirement: 'Feishu liveness patch requires verified @openclaw/feishu 2026.7.1',
  publisher: 'Feishu', patch: 'Feishu liveness', hashLabel: 'Feishu liveness patch', preflight: 'liveness',
  baselines: FEISHU_LIVENESS_BASELINES, patched: PATCHED_HASHES, transforms: TRANSFORMS,
});

export function planFeishuLiveness(root) {
  return planPublisherPatch(root, FEISHU_PATCH);
}

export function applyFeishuLiveness(root) {
  return applyPublisherPatch(root, FEISHU_PATCH);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node apply-feishu-liveness.mjs <verified plugin package>');
  console.log(JSON.stringify(applyFeishuLiveness(process.argv[2]), null, 2));
}
