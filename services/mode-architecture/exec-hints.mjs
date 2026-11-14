// tools-health-1113 C2：exec 明显在干专用工具的活（读文件、搜代码、抓网页）时，
// 在**正常结果**后面附 Fable 写好的一句提示（PLAN 第五节原文）。不拦命令、不改出错标记。
// 这句话本身写着「这条只提醒一次」，所以一个会话最多出现一次（自然也满足「每类一次」）。
//
// 命令在 before_tool_call 里按 toolCallId 记下；结果落进会话记录时（tool_result_persist，同步钩子）
// 判断要不要附这一句。只看命令的第一段（管道、&&、; 之前），免得 `npm test | head` 这类误判。

export const EXEC_HINT = '提示：读文件用 read，搜代码用 code_search，抓网页用 web_fetch，会比命令行省事。这条只提醒一次。';

const READ = /^(?:cat|head|tail|less|more|type|get-content|gc)\b|^sed\s+-n\b/i;
const SEARCH = /^(?:grep|egrep|fgrep|rg|ag|ack|findstr|select-string|sls)\b|^git\s+grep\b/i;
const FETCH = /^(?:curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm)\b|^python[0-9.]*(?:\.exe)?\s+(?:-\S+\s+)*-c\b.*\b(?:urllib|requests\.get|urlopen|httpx)\b/i;

/** 'read' | 'search' | 'fetch' | null */
export function execCategory(command) {
  if (typeof command !== 'string') return null;
  const first = command.trim().replace(/^(?:sudo\s+|&\s*)/i, '').split(/\s*(?:\|\||&&|\||;|\r?\n)\s*/)[0] || '';
  if (FETCH.test(command.trim()) && /^python/i.test(first)) return 'fetch';
  if (READ.test(first)) return 'read';
  if (SEARCH.test(first)) return 'search';
  if (FETCH.test(first)) return 'fetch';
  return null;
}

function isError(message) {
  return Boolean(message?.isError) || message?.details?.status === 'error' || message?.details?.status === 'failed';
}

export function createExecHints({maxPending = 500} = {}) {
  const pending = new Map(); // toolCallId -> command
  const hinted = new Set(); // sessionKey
  return {
    remember(event = {}, ctx = {}) {
      if (String(event.toolName || '') !== 'exec') return;
      const id = String(event.toolCallId || ctx.toolCallId || '');
      if (!id) return;
      pending.set(id, String(event.params?.command ?? ''));
      if (pending.size > maxPending) pending.delete(pending.keys().next().value);
    },
    annotate(event = {}, ctx = {}) {
      const tool = String(event.toolName || ctx.toolName || '');
      if (tool !== 'exec' || event.isSynthetic) return undefined;
      const id = String(event.toolCallId || ctx.toolCallId || '');
      const command = pending.get(id);
      pending.delete(id);
      const sessionKey = String(ctx.sessionKey || '');
      const message = event.message;
      if (!message || !sessionKey || hinted.has(sessionKey) || isError(message) || !execCategory(command)) return undefined;
      hinted.add(sessionKey);
      const note = {type: 'text', text: EXEC_HINT};
      const content = Array.isArray(message.content) ? [...message.content, note] : [{type: 'text', text: String(message.content ?? '')}, note];
      return {message: {...message, content}};
    },
    forget(sessionKey) { hinted.delete(String(sessionKey || '')); },
  };
}

export function registerExecHints(api, hints = createExecHints()) {
  api.on?.('before_tool_call', (event, ctx) => { try { hints.remember(event, ctx); } catch {} return undefined; });
  api.on?.('tool_result_persist', (event, ctx) => { try { return hints.annotate(event, ctx); } catch { return undefined; } });
  api.on?.('session_end', (event, ctx) => { try { hints.forget(ctx?.sessionKey || event?.sessionKey); } catch {} });
  return hints;
}
