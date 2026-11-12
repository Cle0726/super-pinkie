// 子会话的时机提醒：碧琪有 pinkie_session_start（开子会话 / 提出子会话卡片），但用户大多不知道有这个功能，
// 模型也很少自己想起来用。这里由引擎看会话的情况（一条消息里塞了几件互不相干的大活、会话很长了又换了话题、
// 压缩了好几次、用户说了「同时」「后台」），在这一轮的上下文里加一两句提醒，告诉它现在适合用、用哪种发起方式。
//
// 只提醒，不替它开：自己发现的后续仍然是一张等用户点的卡片（own_initiative / offer），授权规则在
// session-lineage.mjs 里没有变。纯函数加一点会话内的计数，可单测。
const state = new Map();
const MAX_SESSIONS = 500;

const EXPLICIT = /子会话|另开|新开一个|单独开|分出去|放(?:到)?后台|后台(?:跑|做|处理|执行)|开(?:个|一个)新?会话|sub[- ]?session|in (?:the )?background|new session/i;
const PARALLEL = /同时|并行|分头|一起做|分别(?:做|处理|写|改|查)|一边.{1,20}一边|in parallel|at the same time|simultaneously/i;
const ANOTHER = /另外|还有一件事|还有个事|顺便再|顺便把|第二件事|再帮我(?:做|写|查|改|弄)|对了[，,]|by the way|another thing|also,/i;
const ACTION = /做|写|改|修|查|整理|生成|分析|设计|搭|实现|重构|翻译|调研|对比|画|build|write|fix|make|create|research|refactor|design/i;

function entry(sessionKey) {
  let row = state.get(sessionKey);
  if (!row) {
    if (state.size >= MAX_SESSIONS) state.delete(state.keys().next().value);
    state.set(sessionKey, row = {turns: 0, compactions: 0, kinds: [], lastSwitchHint: -99, tidyAt: 0});
  }
  return row;
}

export function noteCompaction(sessionKey = '') { if (sessionKey) entry(sessionKey).compactions += 1; }
export function forgetSessionHints(sessionKey = '') { if (sessionKey) state.delete(sessionKey); else state.clear(); }

// 一条消息里列了几件事：编号或圆点开头、带动作的行。
export function listedTasks(prompt = '') {
  return String(prompt).split('\n').filter(line => /^\s*(?:\d+[.、)）]|[-*•·]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.])\s*\S/.test(line) && ACTION.test(line) && line.trim().length >= 8).length;
}

const real = kinds => (kinds || []).filter(kind => kind && kind !== 'simple' && kind !== 'pending');

// 返回要加进这一轮上下文的提醒（可能是空串），并记下这一轮。
export function sessionHintBlock(sessionKey = '', prompt = '', kinds = [], {mode = ''} = {}) {
  const key = String(sessionKey || '');
  const text = String(prompt || '').trim();
  if (!key || !text || mode === 'none' || key.includes(':pinkie-child:')) return '';
  const row = entry(key);
  row.turns += 1;
  const now = real(kinds);
  const hints = [];
  const tasks = listedTasks(text);
  const several = tasks >= 2 || (ANOTHER.test(text) && text.length >= 60);

  if (EXPLICIT.test(text)) {
    hints.push('用户这条消息明说了要另开会话或放到后台：能独立收尾的那件活用 pinkie_session_start 开子会话，initiation 用 user_asked（立刻开始，不用等点击）。互不依赖的几件活各开一个，同时最多 4 个在跑。');
  } else if (several && PARALLEL.test(text)) {
    hints.push(`这条消息里有${tasks >= 2 ? ` ${tasks} 件` : '几件'}事，用户想同时进行。互不依赖、每件都要做一阵子的大活：第一件在这里做，其余的用 pinkie_session_start 各提一张卡片（initiation 用 offer，用户点「新会话」就并行开跑，点「就在这里」就排在后面做）。几分钟能做完的小事不用分，直接在这里做完。`);
  } else if (tasks >= 3 || (several && text.length >= 200)) {
    hints.push('这条消息里塞了好几件事。先分一下：彼此有关、或者几分钟能做完的，在这里按顺序做完；互不依赖、每件都要做很久的大活，第一件在这里做，其余的用 pinkie_session_start 提成卡片（initiation 用 offer，一轮最多 3 张），这样可以并行，也不会把这个会话塞满。');
  }

  // 很长的会话里换了一件不相干的事
  const long = row.turns >= 14 || row.compactions >= 1;
  const recent = row.kinds.slice(-3).flat();
  if (!hints.length && long && now.length && recent.length && !now.some(kind => recent.includes(kind)) && text.length >= 12 && row.turns - row.lastSwitchHint >= 6) {
    row.lastSwitchHint = row.turns;
    hints.push('这条消息和这个会话前面做的不是一件事，而这个会话已经很长了（前面的内容会占着上下文，也容易串）。如果它是一件要做一阵子的独立的活：先用 pinkie_session_start 提一张卡片（initiation 用 offer，context 用 fresh，简报写全），再用一句话告诉用户「这件事碧琪建议放到一个新会话里做，更快也不会和前面的混在一起；想就在这里做也可以」。几步就能答完的问题直接在这里答，不用提。');
  }

  // 压缩了好几次：建议收尾后换一个干净的会话接着做
  if (row.compactions >= 3 && row.compactions >= row.tidyAt + 2) {
    row.tidyAt = row.compactions;
    hints.push(`这个会话已经压缩过 ${row.compactions} 次，早先的细节在变模糊。手上这件事做到一个段落时，用 pinkie_session_start 提一张「接着做」的卡片（initiation 用 own_initiative，context 用 fresh）：简报里写清目标、已经做完并验证过的、还没做的、关键文件的路径、怎么验证。然后用一句话告诉用户可以点它换到一个干净的会话继续。`);
  }

  if (now.length) { row.kinds.push(now); if (row.kinds.length > 6) row.kinds.shift(); }
  if (!hints.length) return '';
  return ['【子会话的时机】系统按这个会话的情况给的提醒（用户多半不知道可以分会话，要由你来判断和提出）：', ...hints.map(line => `- ${line}`), '- 简报要让一个没看过这段对话的人也能开工：做什么、文件在哪、做到什么样算完、不要动什么。提了卡片不等于停工，这条消息里该在这里做的照常做完；子会话交回的汇报先核对再告诉用户。'].join('\n');
}
