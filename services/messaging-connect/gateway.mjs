import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { listChannelPairingRequests, approveChannelPairingCode, readChannelAllowFromStore, removeChannelAllowFromStoreEntry } from 'openclaw/plugin-sdk/conversation-runtime';
import { MessagingLoginManager } from './manager.mjs';
import { loadFeishuProvider, loadQqProvider } from './official-providers.mjs';

export default {
  id: 'pinkie-messaging-connect', name: '碧琪飞书与QQ连接',
  register(api) {
    const stateDir = api.runtime.state.resolveStateDir();
    let scopePromise;
    const loadScope = () => scopePromise ||= import(pathToFileURL(path.join(stateDir, 'extensions/pinkie-project-scope/index.mjs')).href)
      .then(({ ProjectScope }) => new ProjectScope());
    let scope;
    const makeQr = async url => {
      const candidates = [process.argv[1], path.join(process.resourcesPath || '', 'SuperPinkie/runtime/openclaw/openclaw.mjs')];
      const entry = candidates.find(file => typeof file === 'string' && path.isAbsolute(file) && fs.existsSync(file));
      if (!entry) throw new Error('没有找到扫码运行时。');
      return createRequire(entry)('qrcode').toDataURL(url, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
    };
    const shared = { stateDir, makeQr, config: () => api.runtime.config.current(),
      resolveRoute: params => api.runtime.channel.routing.resolveAgentRoute(params),
      mutate: mutate => api.runtime.config.mutateConfigFile({ base: 'source', afterWrite: { mode: 'auto' }, mutate }) };
    const feishu = new MessagingLoginManager({ ...shared, channel: 'feishu', title: '飞书', agentId: 'learning', label: '学习模式',
      accountId: 'pinkie-learning', loadProvider: () => loadFeishuProvider(path.join(stateDir, 'extensions/feishu')) });
    const qq = new MessagingLoginManager({ ...shared, channel: 'qqbot', title: 'QQ', agentId: 'project', label: '项目模式',
      accountId: 'pinkie-project', loadProvider: () => loadQqProvider(path.join(stateDir, 'extensions/qqbot')),
      validateProject: root => { if (!scope) throw new Error('项目选择还没有准备好，请稍后再试。'); return scope.validateRoot(root); },
      projectBinding: sessionKey => scope?.binding({ sessionKey }),
      bindProject: (sessionKey, root) => scope.bind(sessionKey, root, path.basename(root)),
      readAllowed: () => readChannelAllowFromStore('qqbot', process.env, 'pinkie-project'),
      listRequests: () => listChannelPairingRequests('qqbot', process.env, 'pinkie-project'),
      approve: code => approveChannelPairingCode({ channel: 'qqbot', code, accountId: 'pinkie-project', env: process.env }),
      clearApproved: async () => {
        for (const id of await readChannelAllowFromStore('qqbot', process.env, 'pinkie-project')) {
          await removeChannelAllowFromStoreEntry({ channel: 'qqbot', entry: id, accountId: 'pinkie-project', env: process.env });
        }
      },
    });
    const register = (prefix, manager) => {
      const method = (suffix, scopeName, run) => api.registerGatewayMethod(`${prefix}.${suffix}`, async ({ params, respond, context }) => {
        try {
          if (manager === qq) scope ||= await loadScope();
          manager.runtimeSnapshot = () => context.getRuntimeSnapshot();
          respond(true, await run(params || {}));
        } catch (error) {
          const message = /^[\u4e00-\u9fff]/.test(error?.message || '') ? error.message : '连接未完成，请刷新状态后重试。';
          respond(false, undefined, { code: 'INVALID_REQUEST', message });
        }
      }, { scope: scopeName });
      method('status', 'operator.read', () => manager.status());
      method('login.start', 'operator.admin', params => manager.start(params));
      method('login.manual', 'operator.admin', params => manager.manual(params));
      method('login.cancel', 'operator.admin', params => manager.cancel(params));
      method('disconnect', 'operator.admin', params => manager.disconnect(params));
      if (manager === qq) method('login.verify', 'operator.admin', params => manager.verify(params));
    };
    register('pinkie.feishu', feishu); register('pinkie.qq', qq);
    api.registerService({ id: 'pinkie-messaging-connect', start() { feishu.stopped = false; qq.stopped = false; },
      stop() { feishu.stop(); qq.stop(); } });
  },
};
