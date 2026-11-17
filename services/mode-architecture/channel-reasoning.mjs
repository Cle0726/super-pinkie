import {createSessionAccess} from './session-titles.mjs';

// 用户 2026-11-16：「飞书和微信不要用这个思考了」。网页里的「思考了」实时滚动保留（全局
// reasoningDefault 仍是 stream）；聊天软件里的会话一律把会话级 reasoningLevel 设成 off。
// OpenClaw 没有按渠道的思考开关，但会话级设置优先于全局默认：网关 get-reply 和飞书的
// 流式卡片思考预览（resolveFeishuReasoningPreviewEnabled）都先看会话自己的 reasoningLevel。
export const CHAT_APP_CHANNELS = Object.freeze(['feishu', 'lark', 'openclaw-weixin', 'weixin', 'wechat', 'pinkie-wechat']);
const CHANNEL_SESSION = new RegExp(`^agent:[^:]+:(?:${CHAT_APP_CHANNELS.join('|')})(?::|$)`);
const DEFAULT_AGENTS = Object.freeze(['main', 'project', 'thinking', 'learning', 'unrestricted', 'metre']);

export const isChatAppSession = key => CHANNEL_SESSION.test(String(key || ''));
export const isChatAppChannel = id => CHAT_APP_CHANNELS.includes(String(id || '').toLowerCase());

/** 需要补成 off 的会话：聊天软件会话里还没明确设成 off 的。 */
export function sessionsToQuiet(entries) {
  return Object.entries(entries || {})
    .filter(([key, entry]) => isChatAppSession(key) && entry && entry.reasoningLevel !== 'off')
    .map(([key]) => key);
}

export function createChannelReasoningGuard(api, {access = createSessionAccess(api), agents} = {}) {
  const agentIds = () => {
    const listed = (agents || api.runtime?.config?.loadConfig?.()?.agents?.list || api.config?.agents?.list || [])
      .map(item => (typeof item === 'string' ? item : item?.id)).filter(Boolean);
    return listed.length ? listed : [...DEFAULT_AGENTS];
  };
  async function sweep() {
    const patched = [];
    for (const agentId of agentIds()) {
      let entries;
      try { ({entries} = await access.list(agentId)); } catch { continue; }
      for (const key of sessionsToQuiet(entries)) {
        try {
          await access.rpc('sessions.patch', {key, agentId, reasoningLevel: 'off'});
          patched.push(key);
        } catch (error) {
          api.logger?.warn?.(`[channel-reasoning] patch failed agent=${agentId} reason=${error?.message || 'unknown'}`);
        }
      }
    }
    if (patched.length) api.logger?.info?.(`[channel-reasoning] reasoning off for ${patched.length} chat-app session(s)`);
    return patched;
  }
  let running = null;
  const run = () => (running ??= sweep().finally(() => { running = null; }));
  return {
    sweep: run,
    /** message_received：聊天软件来的消息先把会话关掉思考（新会话第一条可能来不及，第二条起生效）。 */
    onMessage(event, ctx, sessionKey) {
      const channel = ctx?.channelId ?? ctx?.channel ?? event?.channel ?? event?.provider;
      if (isChatAppChannel(channel) || isChatAppSession(sessionKey ?? ctx?.sessionKey)) return run();
      return null;
    },
  };
}
