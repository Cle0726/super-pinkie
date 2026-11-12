// 子会话的时机提醒：碧琪有 pinkie_session_start（开子会话 / 提出子会话卡片），但用户大多不知道有这个功能，
// 模型也很少自己想起来用。这里由引擎看会话的情况（一条消息里塞了几件互不相干的大活、会话很长了又换了话题、
// 压缩了好几次、用户说了「同时」「后台」），在这一轮的上下文里加一两句提醒，告诉它现在适合用、用哪种发起方式。
//
// 只提醒，不替它开。用户这条消息本身要的活可以直接分头做（in_scope，立刻并行开跑）；自己发现的范围外的后续
// 仍然是一张等用户点的卡片（own_initiative / offer）。授权规则在 session-lineage.mjs 里。
//
// 另一种时机是「这件事别的模式更拿手」：用户常常待在一个模式里什么都问（项目模式里问配色审美、唠嗑模式里要写程序），
// 这里提醒碧琪替用户去问那个模式（pinkie_mode_ask）或者把大活开到那个模式里做，用户不用自己换。
// 纯函数加一点会话内的计数，可单测。
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
    state.set(sessionKey, row = {turns: 0, compactions: 0, kinds: [], lastSwitchHint: -99, tidyAt: 0, modeHintAt: {}, recommended: {}});
  }
  return row;
}

export function noteCompaction(sessionKey = '') { if (sessionKey) entry(sessionKey).compactions += 1; }
export function forgetSessionHints(sessionKey = '') { if (sessionKey) state.delete(sessionKey); else state.clear(); }

// 一条消息里列了几件事：编号或圆点开头、带动作的行。
export function listedTasks(prompt = '') {
  return String(prompt).split('\n').filter(line => /^\s*(?:\d+[.、)）]|[-*•·]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.])\s*\S/.test(line) && ACTION.test(line) && line.trim().length >= 8).length;
}

// 这件事哪个模式更拿手。只在把握大的时候说：这个模式自己的专长也对得上（「做个好看的网页」在项目模式里）就不提。
const MODE_LABEL = {chat: '唠嗑模式', project: '项目模式', ideas: '想法模式', learning: '学习模式'};
const AFFINITY = {
  ideas: /审美|配色|颜色搭配|色调|版式|排版|字体(?:怎么|选|搭)|好看|难看|太土|有点土|很土|高级感|不够高级|更高级|质感|风格(?:怎么|定|选|方向)|设计(?:方向|感|风格|思路)|视觉(?:方向|效果|风格)|(?:起|取)(?:个|一个).{0,4}名|起名|取名|命名|口号|slogan|点子|创意|灵感|脑暴|头脑风暴|brainstorm/i,
  project: /写(?:个|一个|一段)?(?:代码|程序|脚本|函数|接口)|修.{0,6}bug|bug.{0,6}修|报错|跑不起来|编译|部署|重构|单元测试|(?:做|写|搭|开发)(?:个|一个|一款)?.{0,8}(?:网站|网页|小程序|app|应用|工具|插件|系统|后台|爬虫)/i,
  learning: /教我|教教我|给我讲(?:讲|一下|明白)?|讲懂|学会|想学|系统(?:地)?学|入门|怎么学|背(?:单词|书)|背诵|出(?:几道|一些|点)?(?:题|练习)|刷题|备考|考试(?:重点|范围)|复习(?:计划|一下)|错题|这道题|这题怎么/i,
};
const AFFINITY_WHY = {
  ideas: '审美、设计方向、配色版式、起名、点子和取舍',
  project: '写代码、工程实现、调试和把东西做成能用的成品',
  learning: '把东西讲懂、出练习、备考',
};
export function modeAffinity(prompt = '', mode = '') {
  const text = String(prompt || '').trim();
  if (!MODE_LABEL[mode] || text.length < 6) return '';
  if (AFFINITY[mode]?.test(text)) return '';
  const hits = Object.keys(AFFINITY).filter(target => target !== mode && AFFINITY[target].test(text));
  return hits.length === 1 ? hits[0] : '';
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
    hints.push(`这条消息里有${tasks >= 2 ? ` ${tasks} 件` : '几件'}事，用户想同时进行。互不依赖、每件都要做一阵子的大活：第一件在这里做，其余的用 pinkie_session_start 各开一个子会话（initiation 用 in_scope：这是用户这条消息要的活，立刻并行开跑，不用等用户点，汇报会自动送回来）。开之前用一句话告诉用户这几件在分头同时做。几分钟能做完的小事不用分，直接在这里做完。`);
  } else if (tasks >= 3 || (several && text.length >= 200)) {
    hints.push('这条消息里塞了好几件事。先分一下：彼此有关、或者几分钟能做完的，在这里按顺序做完；互不依赖、每件都要做很久的大活，第一件在这里做，其余的用 pinkie_session_start 各开一个子会话（initiation 用 in_scope，一轮最多 3 个，立刻并行开跑、不用等用户点），这样更快，也不会把这个会话塞满。开之前用一句话告诉用户这几件在分头同时做。');
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

  // 这件事别的模式更拿手：同一个去处隔 6 轮才再提一次，「以后可以直接去那个模式」只说一次。
  const target = modeAffinity(text, mode);
  let modeLine = '';
  if (target && row.turns - (row.modeHintAt[target] ?? -99) >= 6) {
    row.modeHintAt[target] = row.turns;
    const name = MODE_LABEL[target], first = !row.recommended[target];
    row.recommended[target] = true;
    modeLine = `这条消息问的是${name}更拿手的事（${AFFINITY_WHY[target]}）。用户不用自己换模式：只要一个回答或判断，就用 pinkie_mode_ask 去问${name}的碧琪（mode 写 ${target}，background 里写上题材、受众、现状和文件路径，那边看不到这段对话），把答案结合这边的情况用自己的话讲，并提一句是请${name}看过的；要那边动手做一件大活，用 pinkie_session_start 并写 mode: ${target}。这边照样能答好的小问题直接答，不用问。`
      + (target === 'learning' ? '用户是想系统地学、练、备考时，建议他直接切到学习模式：那边有学习台（笔记、生词、背一背、练习），别的模式里没有。' : '')
      + (first ? `答完顺带说一句（只说这一次，不反复劝）：以后这类事可以直接去${name}找碧琪，那边的手册和工具更全。` : '');
  }

  if (now.length) { row.kinds.push(now); if (row.kinds.length > 6) row.kinds.shift(); }
  if (!hints.length && !modeLine) return '';
  const blocks = [];
  if (hints.length) blocks.push(['【子会话的时机】系统按这个会话的情况给的提醒（用户多半不知道可以分会话，要由你来判断和提出）：', ...hints.map(line => `- ${line}`), '- 简报要让一个没看过这段对话的人也能开工：做什么、文件在哪、做到什么样算完、不要动什么。分出去不等于停工，这条消息里该在这里做的照常做完；子会话交回的汇报先核对再告诉用户。'].join('\n'));
  if (modeLine) blocks.push('【别的模式更拿手】' + modeLine);
  return blocks.join('\n\n');
}
