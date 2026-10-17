import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function isOfficialQrUrl(channel, value) {
  try {
    const url = new URL(value);
    const hosts = channel === 'feishu'
      ? ['accounts.feishu.cn', 'accounts.larksuite.com', 'open.feishu.cn', 'open.larksuite.com'] : ['q.qq.com'];
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname);
  } catch { return false; }
}

function checkedPackage(root, name) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (meta.name !== name || meta.version !== '2026.7.1') throw new Error('连接组件版本不匹配，请更新连接入口。');
}

export async function loadFeishuProvider(root) {
  checkedPackage(root, '@openclaw/feishu');
  const file = path.join(root, 'dist/app-registration-BwQ-aGTe.js');
  if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== 'ebd08048ae68fd05dc0b838d3edfa0abd0ddd4aa5372710c00831c8b5b69cbb1') {
    throw new Error('飞书扫码组件已变化，请更新连接入口。');
  }
  const sdk = await import(pathToFileURL(file).href);
  const probeFile = path.join(root, 'dist/probe-Dxyo9zlw.js');
  if (createHash('sha256').update(fs.readFileSync(probeFile)).digest('hex') !== '0f88da34cd76fbc4cb05e599a06708809bfa90c0e41756507dea95805f82a00b') {
    throw new Error('飞书验证组件已变化，请更新连接入口。');
  }
  const { t: probeFeishu } = await import(pathToFileURL(probeFile).href);
  return {
    async login({ signal, onQr }) {
      await sdk.initAppRegistration('feishu');
      if (signal.aborted) throw new Error('已取消连接。');
      const begin = await sdk.beginAppRegistration('feishu');
      if (signal.aborted) throw new Error('已取消连接。');
      await onQr(begin.qrUrl, begin.expireIn);
      const outcome = await sdk.pollAppRegistration({ ...begin, initialDomain: 'feishu', abortSignal: signal, tp: 'ob_cli_app' });
      if (outcome.status !== 'success') return { status: outcome.status };
      return { status: 'success', credentials: outcome.result };
    },
    async validate(credentials, signal) {
      const domain = credentials.domain === 'lark' ? 'lark' : 'feishu';
      const result = await probeFeishu({ ...credentials, domain }, { timeoutMs: 12000, abortSignal: signal });
      if (!result.ok || signal.aborted) throw new Error('飞书应用没有通过验证，请检查 App ID 和 App Secret。');
      const openId = credentials.openId || await sdk.getAppOwnerOpenId({ ...credentials, domain });
      if (!/^ou_[A-Za-z0-9_-]+$/.test(openId || '')) throw new Error('没有确认飞书帐号身份，请重新扫码。');
      return { ...credentials, domain, openId };
    },
  };
}

export async function loadQqProvider(root) {
  checkedPackage(root, '@openclaw/qqbot');
  const require = createRequire(path.join(root, 'package.json'));
  const connectorRoot = path.resolve(path.dirname(require.resolve('@tencent-connect/qqbot-connector')), '../..');
  const connectorMeta = JSON.parse(fs.readFileSync(path.join(connectorRoot, 'package.json'), 'utf8'));
  if (connectorMeta.version !== '1.1.0') throw new Error('QQ扫码组件版本不匹配，请更新连接入口。');
  // The publisher's CommonJS entry uses .js under type:module; use its ESM build.
  const sdk = await import(pathToFileURL(path.join(connectorRoot, 'dist/esm/index.js')).href);
  return {
    login({ signal, onQr, onExpired }) {
      return new Promise((resolve, reject) => {
        let dispose;
        let settled = false;
        const finish = (run, value) => { if (settled) return; settled = true; dispose?.(); run(value); };
        dispose = sdk.startQrConnect({
          onQrDisplayed: url => { if (!signal.aborted && !settled) void Promise.resolve(onQr(url, 600)).catch(error => finish(reject, error)); },
          onQrExpired: () => { if (!signal.aborted && !settled) onExpired(); },
          onSuccess: accounts => {
            if (signal.aborted || settled) return;
            if (!Array.isArray(accounts) || accounts.length !== 1) { finish(reject, new Error('请在手机QQ里选择一个机器人再连接。')); return; }
            finish(resolve, { status: 'success', credentials: accounts[0] });
          },
          onFailure: () => finish(reject, new Error(signal.aborted ? '已取消连接。' : 'QQ扫码未完成，请重试或手动配置。')),
        }, { displayQrCodeToConsole: false, source: 'openclaw', signal });
        if (signal.aborted) finish(reject, new Error('已取消连接。'));
      });
    },
    async validate(credentials, signal) {
      if (signal.aborted) throw new Error('已取消连接。');
      // Use QQ's official token API before committing manually supplied credentials.
      const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: credentials.appId, clientSecret: credentials.appSecret }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      });
      const result = await response.json();
      if (!response.ok || !result.access_token || signal.aborted) throw new Error('QQ应用没有通过验证，请检查 App ID 和 App Secret。');
      return credentials;
    },
  };
}
