// 背一背隔离验收用的假组卷和假后端。不连正在运行的网关，不碰真实学习数据。
export const MODES = ['look', 'flip', 'choice', 'truefalse', 'cloze', 'pairs', 'order', 'write', 'meet', 'word2meaning', 'meaning2word', 'listen', 'collocation', 'homophonePairs', 'spell', 'dictate'];
const item = (mode, fields) => ({itemId: mode, cardRef: {book: 'notes', noteId: 'n-' + mode, recallId: 'r-' + mode, wordId: 'w-' + mode}, mode, strength: 1, answer: '', reveal: {question: '', answer: ''}, ...fields, itemId: mode});
export const FIXTURES = {
  look: item('look', {strength: 0, prompt: 'TCP 三次握手的第二步是什么？', reveal: {question: 'TCP 三次握手的第二步是什么？', answer: '服务器回 SYN-ACK。'}}),
  flip: item('flip', {prompt: 'sizeof 一个字符串为什么比 strlen 大 1？', reveal: {answer: '末尾还有一个 \\0。'}}),
  choice: item('choice', {prompt: 'do-while 的循环体至少执行几次？', options: ['可能一次也不执行', '至少一次', '必须是偶数次', '和 while 完全一样'], answer: 1, reveal: {answer: '至少一次'}}),
  truefalse: item('truefalse', {prompt: 'int a[10] 的合法下标是 0 到 9。', options: ['对', '错'], answer: 0, reveal: {answer: '对。下标从 0 到 9。'}}),
  cloze: item('cloze', {prompt: 'be used to {{1}} 表示习惯于，这里的 to 是介词。', answer: ['doing'], bank: ['doing', 'do', 'done', 'to do'], reveal: {answer: 'doing'}}),
  pairs: item('pairs', {prompt: '把左边的问题和右边的答案配上', pairs: {left: ['avoid 后面', 'do-while', '数组下标', 'sizeof 字符串'], right: ['接 doing', '至少一次', '从 0 开始', '比长度多 1']}, answer: [[0, 0], [1, 1], [2, 2], [3, 3]], reveal: {answer: '按左边顺序对应右边。'}}),
  order: item('order', {strength: 3, prompt: '把 TCP 三次握手排成正确顺序', steps: ['客户端发送 SYN', '服务器回复 SYN-ACK', '客户端发送 ACK'], reveal: {answer: 'SYN → SYN-ACK → ACK'}}),
  write: item('write', {strength: 3, prompt: '用一句话写出 do-while 和 while 的差别', judge: 'model', answer: 'do-while 至少执行一次', reveal: {answer: 'do-while 先执行再判断，至少一次。'}}),
  meet: item('meet', {strength: 0, prompt: 'ambulance', speak: 'ambulance', reveal: {question: 'ambulance', answer: '救护车', extra: '/ˈæmbjələns/ · 谐音：俺不能死'}}),
  word2meaning: item('word2meaning', {prompt: 'ambulance', options: ['救护车', '大使馆', '雄心', '含糊的'], answer: 0, reveal: {answer: '救护车'}}),
  meaning2word: item('meaning2word', {prompt: '救护车', options: ['ambulance', 'embassy', 'ambition', 'ambiguous'], answer: 0, reveal: {answer: 'ambulance'}}),
  listen: item('listen', {prompt: '听发音，选出听到的词', speak: 'ambition', options: ['ambition', 'ambulance', 'ambiguous', 'embassy'], answer: 0, reveal: {answer: 'ambition'}}),
  collocation: item('collocation', {prompt: 'have an impact {{1}} the result', answer: ['on'], bank: ['on', 'in', 'to', 'at'], reveal: {answer: 'on'}}),
  homophonePairs: item('homophonePairs', {prompt: '单词对上碧琪编的谐音', pairs: {left: ['ambulance', 'ambition', 'embassy'], right: ['俺不能死', '俺必胜', '安倍喜']}, answer: [[0, 0], [1, 1], [2, 2]], reveal: {answer: '谐音只帮记忆。'}}),
  spell: item('spell', {strength: 3, prompt: '救护车', speak: 'ambulance', answer: 'ambulance', reveal: {answer: 'ambulance'}}),
  dictate: item('dictate', {strength: 3, prompt: '听写这个词', speak: 'embassy', answer: 'embassy', reveal: {answer: 'embassy'}}),
};

// 结算页的几种样子：普通、首次盖章 + 罐满、考前安静版。罐子和连续章的数字彼此对得上。
export const SUMMARIES = {
  normal: {stars: 12, accuracy: .8, ms: 252000, maxCombo: 3, firstFinishToday: false, streak: {current: 2, stampedToday: true, weekKind: ['stamped', 'stamped', 'future', 'future', 'future', 'future', 'future']}, jar: {today: 12, goal: 30, filledNow: false}, quiet: false, nextSuggestion: {source: 'notes', scope: {kind: 'more'}, label: '再背一组'}},
  full: {stars: 20, accuracy: 1, ms: 180000, maxCombo: 10, firstFinishToday: true, streak: {current: 6, stampedToday: true, weekKind: ['stamped', 'stamped', 'stamped', 'leave', 'stamped', 'stamped', 'future']}, jar: {today: 30, goal: 30, filledNow: true}, quiet: false, nextSuggestion: {source: 'notes', scope: {kind: 'more'}, label: '再背一组'}},
  quiet: {stars: 8, accuracy: .7, ms: 200000, maxCombo: 2, firstFinishToday: true, streak: {current: 5, stampedToday: true, leaveUsedYesterday: true, weekKind: ['stamped', 'stamped', 'stamped', 'leave', 'stamped', 'future', 'future']}, jar: {today: 18, goal: 30, filledNow: false}, quiet: true, nextSuggestion: null},
};

// control.finishFails：前几次 drill.finish 直接报错，用来验结算失败时不编成绩。
export function drillHandler(control = {}) {
  const sessions = new Map();
  return async (method, params = {}) => {
    const name = method.replace(/^pinkie\.learning\./, '');
    if (name === 'drill.settings.get') return {size: 10, jarGoal: 30, flipOnly: false};
    if (name === 'drill.settings.set') return {ok: true};
    if (name === 'drill.session') {
      const mode = params.scope?.ids?.[0];
      const one = FIXTURES[mode] ? structuredClone(FIXTURES[mode]) : null;
      const items = one ? [one] : MODES.map(id => structuredClone(FIXTURES[id]));
      const sessionId = 'qa-' + Math.random().toString(16).slice(2);
      sessions.set(sessionId, {items, answers: []});
      return {sessionId, items, pending: params.scope?.flag === 'pending' ? 4 : 0, dueLeft: items.length, settings: {soundDefault: true}};
    }
    if (name === 'drill.answer') {
      const session = sessions.get(params.sessionId);
      session?.answers.push(params);
      return {rating: params.correct ? (params.hinted || params.verdict === 'partial' ? 'fuzzy' : 'remembered') : 'forgot', stars: params.correct && params.firstTry ? 1 : 0, requeue: !params.correct};
    }
    if (name === 'drill.learned') return {ok: true};
    if (name === 'drill.judge') {
      const text = String(params.text || '');
      if (!text.trim() || text.includes('错')) return {verdict: 'wrong', missing: ['至少一次'], comment: '先记「至少一次」'};
      if (text.includes('部分')) return {verdict: 'partial', missing: ['while 可能一次也不执行'], comment: '差在 while 那边'};
      return {verdict: 'correct', missing: [], comment: '意思对了'};
    }
    if (name === 'drill.finish') {
      if (control.finishFails > 0) { control.finishFails -= 1; throw new Error('结算请求超时'); }
      const session = sessions.get(params.sessionId);
      const first = (session?.answers || []).filter(a => a.firstTry);
      const right = first.filter(a => a.correct).length;
      return {stars: right + 5, accuracy: first.length ? right / first.length : 1, ms: 240000, maxCombo: right, firstFinishToday: true, streak: {current: 3, best: 3, stampedToday: true, leaveUsedYesterday: false}, jar: {today: 12, goal: 30, filledNow: false}, leaveNotes: 1, quiet: false, nextSuggestion: {source: 'notes', scope: {kind: 'more'}, label: '再背一组新的'}};
    }
    if (name === 'drill.cheer') return {line: '计算机网络这组，握手的顺序你已经能自己排了。'};
    if (name === 'chat.history') return {messages: []};
    if (name === 'chat.send') return {runId: 'qa', status: 'started'};
    return {};
  };
}

