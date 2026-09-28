const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('native ChatGPT bridge counts assistant turns even when wrappers have no frame', () => {
  const native = read('desktop/macos/Sources/Launcher.swift');
  const selector = "document.querySelectorAll('[data-message-author-role=\"assistant\"]')";
  assert.equal(native.split(selector).length - 1, 2);
  assert.doesNotMatch(native, /querySelectorAll\('\[data-message-author-role="assistant"\]'\)\)\.filter\(visible\)/);
  assert.match(native, /replyBody\?\.innerText \|\| replyBody\?\.textContent/);
  assert.match(native, /private func verifyChatGPTSubmission\(/);
  assert.match(native, /userCount > baselineUserCount \|\| \(!userId\.isEmpty && userId != baselineUserId\)/);
  assert.match(native, /网页发送键已触发，但 ChatGPT 没有新增用户消息/);
  assert.match(native, /if attempt < 80, evalError == nil/);
  assert.match(native, /ChatGPT 仍在生成上一条回复/);
  assert.match(native, /ChatGPT 输入框重载，已恢复待发文字/);
  assert.match(native, /message: message,\s*requestId: requestId/);
});

test('web GPT collaboration is opt-in and scoped per session', () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  assert.match(ui, /laolao:web-gpt-collab:/);
  assert.match(ui, /const preference = localStorage\.getItem\(storageKey\(\)\)/);
  assert.match(ui, /if \(preference === "1"\) return true/);
  assert.match(ui, /if \(preference === "0"\) return false/);
  assert.match(ui, /return projectAutoEnabled\(\)/);
  assert.match(ui, /project:auto:/);
  assert.match(ui, /sessionKey\(\) && workspace/);
  assert.match(ui, /data-action="project-auto"/);
  assert.match(ui, /本项目新会话自动开启/);
  assert.match(ui, /else if \(projectAutoEnabled\(\)\) localStorage\.setItem\(storageKey\(\), "0"\)/);
  assert.doesNotMatch(ui, /rpc\("pinkie\.webGpt\.arm"/);
  assert.match(ui, /pinkie\.webGpt\.projectContext/);
  assert.match(ui, /pinkie\.webGpt\.activity\.get/);
  assert.match(ui, /pinkie\.webGpt\.activity\.append/);
  assert.match(ui, /browserControl\("send"/);
  assert.match(ui, /browserControl\("send", \{text: message\}, 45_000\)/);
  assert.match(ui, /browserControl\("findPlugin"/);
  assert.match(ui, /browserControl\("activatePlugin"/);
  assert.match(ui, /pluginSelected\(snapshot, connectorName\)/);
  assert.match(ui, /ChatGPT 插件.*连接失败；没有发送任务/);
  assert.match(ui, /waitForChatGPTReply/);
  assert.doesNotMatch(ui, /rpc\("pinkie\.webGpt\.inject"/);
  assert.match(ui, /pinkie\.webGpt\.connection\.bindConversation/);
  assert.match(ui, /recoveredFromStaleConversation/);
  assert.match(ui, /原来保存的 ChatGPT 会话已失效/);
  assert.match(ui, /A slow saved chat is not a lost chat/);
  assert.match(ui, /原 ChatGPT 会话暂时没有加载完成，已保留会话绑定和原消息/);
  assert.match(ui, /bridge\.postMessage\(\{action: "open", url: home\}\)/);
  assert.match(ui, /未绑定项目 · 仅网页对话/);
  assert.match(ui, /No local project files were supplied or read/);
  assert.match(ui, /Never inspect Pinkie\/OpenClaw memory/);
  assert.match(ui, /修复前记录，内部工作区连接现已停用/);
  assert.match(ui, /现在已经禁止读取碧琪记忆和内部工作区/);
  assert.match(ui, /const syncSession =/);
  assert.match(ui, /renderActivity\(\);\s*void loadActivity\(\);\s*void loadConnection\(\);/);
  assert.match(ui, /observedSessionKey = next/);
  assert.match(ui, /消息仍在输入框，未调用本地模型/);
  assert.match(ui, /本轮请求已排队/);
  assert.match(ui, /发往网页 GPT/);
  assert.match(ui, /网页 GPT 返回/);
  assert.match(ui, /activity\.get", \{sessionKey: key, limit: 1, offset: activityOffset\}/);
  assert.match(ui, /data-page="older"/);
  assert.match(ui, /document\.createElement\("details"\)/);
  assert.doesNotMatch(ui, /events\.slice\(\)\.reverse\(\)\.map/);
  assert.doesNotMatch(ui, /laolao-web-gpt-panel__explain/);
  assert.doesNotMatch(ui, /本会话协作<\/strong>/);
  assert.match(ui, /尚未向网页 GPT 发送/);
  assert.match(ui, /loadProjectContext\(preview\)/);
  assert.match(ui, /网页 GPT 协作已关闭，恢复普通聊天/);
  assert.match(ui, /单击开启网页 GPT 协作，双击管理/);
  assert.match(ui, /data-action="use-tailscale"/);
  assert.match(ui, /pinkie\.webGpt\.connection\.useTailscale/);
  assert.match(ui, /addEventListener\("dblclick"/);
  assert.match(ui, /buttonClickTimer = setTimeout\([\s\S]*?toggle\(\)/);
  assert.match(ui, /ensureCollaborationConnection/);
  assert.match(ui, /rpc\(\)\("pinkie\.webGpt\.chatStatus", connectionParams\(\), 12_000\)/);
  assert.match(ui, /pinkie\.webGpt\.connection\.start/);
  assert.match(ui, /return false;\s*};\s*\n\s*const connectionAction/);
  assert.match(ui, /ensureChatGPTReady\(useProjectConnector\)/);
  assert.match(ui, /buildControlMessage\(preview, false,/);
  assert.match(ui, /本轮只发送用户文字；没有项目文件正文/);
  assert.match(ui, /不要输出 C2C、STATE、TASK_ID、ITERATION/);
  assert.match(ui, /read_file before making conclusions/);
  assert.match(ui, /listing alone is never inspection/);
  assert.match(ui, /search_workspace for a named error/);
  assert.match(ui, /files read with paths\/lines/);
  assert.doesNotMatch(ui, /Reply with \[C2C\] STATE: PLAN/);
  assert.doesNotMatch(ui, /localStorage\.setItem\(storageKey\(\), "1"\)[\s\S]{0,80}render\(\);\s*$/);
});

test('project auto setting follows new sessions without crossing projects or overriding a manual off', () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  const preferences = ui.slice(ui.indexOf('  const storageKey ='), ui.indexOf('  const toast ='));
  assert.ok(preferences.includes('const projectAutoEnabled ='));
  const values = new Map();
  let activeSession = 'agent:learning:dashboard:first';
  let activeWorkspace = '/projects/english';
  const context = {
    PREFIX: 'laolao:web-gpt-collab:',
    sessionKey: () => activeSession,
    selectedWorkspace: () => activeWorkspace,
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    encodeURIComponent,
  };
  vm.runInNewContext(`${preferences}\nglobalThis.prefs = {enabled, storageKey, projectAutoKey};`, context);
  assert.equal(context.prefs.enabled(), false);
  values.set(context.prefs.projectAutoKey(), '1');
  assert.equal(context.prefs.enabled(), true);
  activeSession = 'agent:learning:dashboard:second';
  assert.equal(context.prefs.enabled(), true);
  values.set(context.prefs.storageKey(), '0');
  assert.equal(context.prefs.enabled(), false);
  activeSession = 'agent:learning:dashboard:third';
  assert.equal(context.prefs.enabled(), true);
  activeWorkspace = '/projects/math';
  assert.equal(context.prefs.enabled(), false);
  activeWorkspace = '';
  assert.equal(context.prefs.enabled(), false);
});

test('bound project remains detectable when the sidebar has not initialized', () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  const selector = ui.slice(ui.indexOf('  const selectedWorkspace ='), ui.indexOf('  const connectionParams ='));
  const context = {
    sessionKey: () => 'agent:learning:dashboard:current',
    $: () => ({getAttribute: () => '当前项目 · /projects/english'}),
    window: {__laolaoSidebar: undefined},
    Object,
    String,
  };
  vm.runInNewContext(`${selector}\nglobalThis.selectedWorkspace = selectedWorkspace;`, context);
  assert.equal(context.selectedWorkspace(), '/projects/english');
});

test('a new Pinkie session does not mistake another ChatGPT conversation for the home page', () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  const selector = ui.slice(ui.indexOf('  const sameConversation ='), ui.indexOf('  const currentConnectorName ='));
  const context = {URL};
  vm.runInNewContext(`${selector}\nglobalThis.sameConversation = sameConversation;`, context);
  assert.equal(context.sameConversation('https://chatgpt.com/?surface=work', 'https://chatgpt.com/'), true);
  assert.equal(context.sameConversation('https://chatgpt.com/c/another-chat', 'https://chatgpt.com/'), false);
  assert.equal(context.sameConversation('https://chatgpt.com/plugins', 'https://chatgpt.com/'), false);
});

test('gateway uses hidden next-turn injection instead of rewriting the composer', () => {
  const plugin = read('services/mode-architecture/index.mjs');
  assert.match(plugin, /registerGatewayMethod\('pinkie\.webGpt\.arm'/);
  assert.match(plugin, /enqueueNextTurnInjection/);
  assert.match(plugin, /\[pinkie:web-gpt-relayed-plan\]/);
  assert.match(plugin, /placement: 'append_context'/);
  assert.match(plugin, /createWebGptActivityTool/);
  assert.match(plugin, /registerWebGptActivityGateway/);
  assert.match(plugin, /registerWebGptConnectionGateway/);
  assert.match(plugin, /stripWebGptProtocol/);
  assert.match(plugin, /WEB_GPT_PLAN_MAX_CHARS = 6_000/);
  assert.match(plugin, /replace\(\/\^\\s\*\\\[C2C\\\]/);
});

test('plain web conversation displays ChatGPT answer without starting the local model', () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  assert.match(ui, /This is a direct web conversation\. Answer the user directly/);
  assert.match(ui, /const useProjectConnector = await ensureCollaborationConnection\(\)/);
  assert.match(ui, /return false;\s*};\s*\n\s*const connectionAction/);
  assert.match(ui, /rpc\("chat\.inject", \{[\s\S]*?label: "网页 ChatGPT"/);
  assert.match(ui, /return "web-direct"/);
  assert.match(ui, /parseFileRequest\(reply\)/);
  assert.match(ui, /本轮提供的项目文件/);
  assert.match(ui, /webChatSurface === "chat"/);
  assert.match(ui, /browserControl\("selectChat"\)/);
  assert.match(ui, /当前网页会话属于工作模式；已阻止发送/);
  assert.match(ui, /if \(!switched\?\.selected\) return false/);
  assert.match(ui, /return "blocked"/);
  assert.match(ui, /if \(result === "blocked"\) return/);
  assert.match(ui, /if \(result === "web-direct"\) \{[\s\S]*?return;[\s\S]*?\}\s*bypassOnce = true;\s*send\(\)/);
  assert.match(ui, /window\.__laolaoRefreshCurrentChat\?\.\(\)/);
});

test('an empty completed ChatGPT turn fails quickly instead of hanging for minutes', async () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  const source = ui.slice(ui.indexOf('  const waitForChatGPTReply ='), ui.indexOf('  const sendAndWaitForReply ='));
  let snapshots = 0;
  const context = {
    connection: {workspace: ''},
    sessionKey: () => 'agent:learning:dashboard:blank',
    wait: async () => {},
    browserControl: async () => {
      snapshots += 1;
      return {assistantCount: 2, latestAssistant: '', generating: false, conversationUrl: 'https://chatgpt.com/c/blank'};
    },
    bindConversation: async () => { throw new Error('blank chat must not be saved'); },
  };
  vm.runInNewContext(`${source}\nglobalThis.waitForChatGPTReply = waitForChatGPTReply;`, context);
  await assert.rejects(() => context.waitForChatGPTReply(1), error => error.code === 'EMPTY_WEB_GPT_REPLY');
  assert.equal(snapshots, 6);
});

test('reply detection follows message identity when the web page virtualizes old turns', async () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  const source = ui.slice(ui.indexOf('  const waitForChatGPTReply ='), ui.indexOf('  const sendAndWaitForReply ='));
  let bound = '';
  const context = {
    connection: {workspace: ''},
    sessionKey: () => 'agent:learning:dashboard:virtualized',
    wait: async () => {},
    browserControl: async () => ({assistantCount: 4, assistantId: 'turn-new', latestAssistant: 'Hi! 👋', generating: false,
      conversationUrl: 'https://chatgpt.com/c/virtualized'}),
    bindConversation: async url => { bound = url; },
  };
  vm.runInNewContext(`${source}\nglobalThis.waitForChatGPTReply = waitForChatGPTReply;`, context);
  assert.equal(await context.waitForChatGPTReply({assistantCount: 4, assistantId: 'turn-old'}), 'Hi! 👋');
  assert.equal(bound, 'https://chatgpt.com/c/virtualized');
});

test('a blank web reply never silently resends the same user message', async () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  const source = ui.slice(ui.indexOf('  const sendAndWaitForReply ='), ui.indexOf('  const prepare ='));
  let sends = 0;
  const context = {
    browserControl: async operation => { assert.equal(operation, 'send'); sends += 1; return {sent: true, assistantCount: 1}; },
    waitForChatGPTReply: async () => { throw Object.assign(new Error('blank'), {code: 'EMPTY_WEB_GPT_REPLY'}); },
  };
  vm.runInNewContext(`${source}\nglobalThis.sendAndWaitForReply = sendAndWaitForReply;`, context);
  await assert.rejects(() => context.sendAndWaitForReply('hi', 'agent:learning:dashboard:blank'),
    error => error.code === 'EMPTY_WEB_GPT_REPLY');
  assert.equal(sends, 1);
  assert.match(ui, /label: "网页 GPT 异常"/);
  assert.match(ui, /原消息仍在输入框，本轮未调用本地模型/);
});

test('deep-think interception does not trigger a local run after direct web reply', async () => {
  const ui = read('ui/injections/laolao-deep-think.js');
  const source = ui.slice(ui.indexOf('  const afterArm ='), ui.indexOf('  const closeMenu ='));
  let armed = 0;
  let disarmed = 0;
  let localSends = 0;
  let refreshed = 0;
  class TextArea {
    constructor() { this.value = '测试问题'; }
    dispatchEvent() {}
  }
  const input = new TextArea();
  const context = {
    latestStatus: null,
    armSelected: async () => { armed += 1; },
    disarmCurrent: async () => { disarmed += 1; },
    $: () => input,
    HTMLTextAreaElement: TextArea,
    Event,
    toast: () => {},
    queueMicrotask,
    window: {
      __laolaoWebGptPrepareNextTurn: async () => 'web-direct',
      __laolaoRefreshCurrentChat: async () => { refreshed += 1; },
    },
    bypassSend: false,
  };
  vm.runInNewContext(`${source}\nglobalThis.afterArm = afterArm;`, context);
  await context.afterArm(() => { localSends += 1; });
  assert.equal(armed, 1);
  assert.equal(disarmed, 1);
  assert.equal(localSends, 0);
  assert.equal(refreshed, 1);
  assert.equal(input.value, '');
});

test('collaboration panel exposes honest activity and maintainable account controls', () => {
  const ui = read('ui/injections/laolao-web-gpt-collab.js');
  const connection = read('services/mode-architecture/web-gpt-connection.mjs');
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  assert.match(ui, /连接与账号/);
  assert.match(ui, /pinkie\.webGpt\.connection\.get/);
  assert.match(ui, /pinkie\.webGpt\.connection\.pair/);
  assert.match(ui, /UNPAIR_CURRENT_WEB_GPT/);
  assert.match(ui, /reset-chatgpt-session/);
  assert.match(ui, /https:\/\/chatgpt\.com\/plugins/);
  assert.match(ui, /laolao-web-gpt-connection__confirm/);
  assert.match(ui, /Number\(bridge\?\.tokenCount \|\| 0\) > 0/);
  assert.match(ui, /fatalTunnel/);
  assert.match(ui, /bridge\?\.publicReady === true/);
  assert.match(ui, /聊天模式可只读发送项目文本/);
  assert.match(ui, /图片和视频尚未接入这条聊天路径/);
  assert.doesNotMatch(ui, /\bconfirm\(/);
  assert.match(connection, /pinkie\.webGpt\.connection\.start/);
  assert.match(connection, /pinkie\.webGpt\.connection\.useTailscale/);
  assert.match(connection, /pinkie\.webGpt\.connection\.clearConversation/);
  assert.match(connection, /pinkie\.webGpt\.connection\.bindConversation/);
  assert.match(connection, /pinkie\.webGpt\.connection\.unpair/);
  assert.match(connection, /pinkie-session-conversations\.json/);
  assert.match(connection, /new-pinkie-session/);
  assert.match(connection, /sessionScoped: true/);
  assert.match(connection, /\['start', '-w', workspace, '--tunnel', '--json'\]/);
  assert.doesNotMatch(connection, /sandbox-allow/);
  assert.match(launcher, /resetChatGPTBrowserSession/);
  assert.match(launcher, /handleChatGPTControl/);
  assert.match(launcher, /case "findPlugin"/);
  assert.match(launcher, /case "activatePlugin"/);
  assert.match(launcher, /case "selectChat"/);
  assert.match(launcher, /chatMode/);
  assert.match(launcher, /pluginNeedsRetry/);
  assert.match(launcher, /data-testid=\"send-button\"/);
  assert.match(launcher, /data-message-author-role=\"assistant\"/);
  assert.match(launcher, /window\.__laolaoBrowserControlResult/);
  assert.match(launcher, /name\.hasSuffix\("\.chatgpt\.com"\)/);
  assert.match(launcher, /name\.hasSuffix\("\.openai\.com"\)/);
});

test('bundled bridge stays read-only and isolated from Codex state', () => {
  const skill = read('skills/web-gpt-collab/SKILL.md');
  const setup = read('services/mode-architecture/setup.py');
  const bridge = read('services/chatgpt-collab/runtime/dist/mcp/server.js');
  const tunnelBridge = read('services/chatgpt-collab/runtime/dist/bridge/server.js');
  const scopes = read('services/chatgpt-collab/runtime/dist/auth/store.js');
  const provenance = read('services/chatgpt-collab/UPSTREAM.md');
  assert.match(skill, /不要运行 `sandbox-allow`/);
  assert.match(skill, /聊天模式的项目文件/);
  assert.match(skill, /web_gpt_activity/);
  assert.match(skill, /analyze_media/);
  assert.match(skill, /图片、视频分析尚未接入/);
  assert.match(skill, /宿主已完成网页收发/);
  assert.match(skill, /不要再次打开网页/);
  assert.match(skill, /workspace、memory、persona/);
  assert.match(skill, /不需要 OpenAI API Key/);
  assert.match(skill, /不能偷偷切到「工作」模式或本地模型/);
  assert.match(bridge, /analyze_media/);
  assert.match(tunnelBridge, /TailscaleFunnel/);
  assert.match(bridge, /workspace\.media\.read/);
  assert.match(bridge, /raw video is never sent/);
  assert.match(scopes, /workspace\.media\.read/);
  assert.match(setup, /web-gpt-collab/);
  assert.match(setup, /C2C_STATE_DIR/);
  assert.match(provenance, /9663b88753e35c76796c5bce000293e0bd22cd9e/);
  assert.ok(fs.existsSync(path.join(root, 'services/chatgpt-collab/runtime/bin/c2c.js')));
});

test('macOS installer and App bundle include the collaboration UI, skill and runtime', () => {
  const installer = read('installer/macos/apply-theme.sh');
  const build = read('desktop/macos/build.sh');
  assert.match(installer, /laolao-web-gpt-collab\.js\?v=webgpt32/);
  assert.match(installer, /web-gpt-project-context\.mjs/);
  assert.match(installer, /services\/chatgpt-collab/);
  assert.match(installer, /skills\/web-gpt-collab/);
  assert.match(build, /services\/chatgpt-collab/);
  assert.match(build, /web-gpt-collab/);
});
