// 一条消息一份合同。九档想多深，四档做事多严；份数和打回轮数取大，证据取并集。
// 无限制模式不走这里。界面还没把同一个消息编号传进来时，合同仍然可以按已经登记在同一条请求上的两套选择生成。

const LEVEL_RANK = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']);
const WORK_TIERS = Object.freeze({
  base: {solvers: 0, rounds: 0, critic: false, audit: false, continuationLimit: 3, planList: false},
  boost: {solvers: 0, rounds: 1, critic: false, audit: true, continuationLimit: 6, planList: false},
  full: {solvers: 1, rounds: 2, critic: true, audit: true, continuationLimit: 10, planList: false},
  marathon: {solvers: 0, rounds: 2, critic: true, audit: true, continuationLimit: 40, planList: true},
});
const LEVEL_LAYERS = Object.freeze({
  medium: {solvers: 0, rounds: 0, critic: false, think: true},
  high: {solvers: 0, rounds: 0, critic: false, think: true},
  xhigh: {solvers: 1, rounds: 1, critic: true, think: true},
  max: {solvers: 2, rounds: 2, critic: true, think: false},
  ultra: {solvers: 3, rounds: 3, critic: true, think: false},
});

export const SPAWN_FALLBACK = '没有 sessions_spawn 时不要拒绝执行，自己按不同做法再做一版，再整合。';

const NEGATION = /(?:尚未|还没有|还没|没有|没能|无法|未能|未曾|并未|不曾|没)/;
const CLAIM_VERB = /(?:修改|更改|更新|创建|生成|删除|写入|保存|发布|发送|发给|发出|寄出|上传|下载|部署|安装|修复|完成|做好|做完|做成|剪好|改好|修好|渲染完成|导出完成|通过)/;
const OVERALL_COMPLETION = /(?:(?:全部|所有|整体|任务|最终|完整|完全).{0,16}(?:完成|交付|成功)|(?:完成|交付|成功).{0,16}(?:全部|所有|整体|任务|完整|完全))/;
const IN_PROGRESS = /(?:仍在|还在|正在|等待|排队|后台.{0,8}(?:生成|运行|处理|渲染)|稍后|尚未|未下载|未生成|待完成|被阻塞)/;
const HONEST_INCOMPLETE = /(?:明确.{0,8})?(?:未完成|尚未完成|无法完成|还没(?:有)?(?:完成|做完|搞定)|执行失败|验收失败|验证未通过|被阻塞|需要用户.{0,8}(?:登录|验证|确认|提供)|验证码|人机验证)/;
const ACTION_CLAIM = /(?:(?:已经|已|成功)(?:把|将)?[^。！？\n]{0,18}(?:修改|更改|更新|创建|生成|删除|写入|保存|发布|发送|上传|下载|部署|安装|修复|完成)|(?:已经|已|成功)[^。！？\n]{0,8}(?:调用|使用|运行|执行)|(?:修改|更改|更新|创建|生成|删除|写入|保存|发布|发送|上传|下载|部署|安装|修复)(?:好|完|成功|了)|(?:做|剪|改|修|导出|渲染)(?:好|完|成)了?|(?:测试|检查|核对|验证)(?:已|已经)?(?:完成|通过|成功)|搞定|处理好了|弄好了|做完了|做成了|已修好|已修复)/;
const TEST_CLAIM = /(?:测试|检查|核对|验证)(?:已|已经)?(?:通过|成功)|(?:tests?|checks?)\s+(?:(?:have|has)\s+)?(?:all\s+)?passed/i;
const ENGLISH_NEGATION = /\b(?:not|never|n't|no)\b/i;

export function stripNegatedClaims(text = '') {
  return String(text || '').replace(new RegExp(`${NEGATION.source}[^。！？!?,，;；\\n]{0,48}`, 'g'), (clause) => (
    CLAIM_VERB.test(clause) ? ' ' : clause
  ));
}

export function mergeLayers(first = {}, second = {}) {
  return {
    ...first,
    brevity: Boolean(first.brevity || second.brevity) && !(first.think || second.think),
    think: Boolean(first.think || second.think),
    solvers: Math.max(Number(first.solvers) || 0, Number(second.solvers) || 0),
    rounds: Math.max(Number(first.rounds) || 0, Number(second.rounds) || 0),
    critic: Boolean(first.critic || second.critic),
    audit: true,
  };
}

function levelLayer(level = '', difficulty = '') {
  const name = level === 'adaptive' ? (difficulty === 'hard' ? 'xhigh' : 'low') : level;
  return LEVEL_LAYERS[name] || {solvers: 0, rounds: 0, critic: false, think: false};
}

function unique(values = []) {
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))];
}

export function buildContract({
  level = '',
  workTier = '',
  kinds = [],
  mode = '',
  platform = '',
  difficulty = '',
  spawnAvailable = true,
  levelCopies = null,
  levelRounds = null,
  levelCritic = null,
} = {}) {
  const tier = WORK_TIERS[workTier] ? workTier : '';
  const tierLayer = tier ? WORK_TIERS[tier] : null;
  const depthLayer = LEVEL_RANK.includes(level) ? levelLayer(level, difficulty) : {solvers: 0, rounds: 0, critic: false, think: false};
  const depth = {
    solvers: levelCopies == null ? depthLayer.solvers : Number(levelCopies) || 0,
    rounds: levelRounds == null ? depthLayer.rounds : Number(levelRounds) || 0,
    critic: levelCritic == null ? depthLayer.critic : Boolean(levelCritic),
    think: depthLayer.think,
  };
  const merged = tierLayer ? mergeLayers(depth, {
    solvers: tierLayer.solvers,
    rounds: tierLayer.rounds,
    critic: tierLayer.critic,
    think: false,
  }) : {...depth, audit: Boolean(depth.critic)};
  const evidence = unique(kinds);
  if (tierLayer?.audit && !evidence.includes('delivery')) evidence.push('delivery');
  return {
    depth: level || '',
    workTier: tier,
    copies: merged.solvers,
    rounds: merged.rounds,
    evidence,
    review: Boolean(merged.audit || merged.critic || tierLayer?.audit),
    continuationLimit: tierLayer?.continuationLimit || 0,
    planList: Boolean(tierLayer?.planList),
    spawn: spawnAvailable === false ? 'self' : 'subagents',
    think: Boolean(merged.think),
    mode: mode || '',
    platform: platform || '',
  };
}

function prose(reply = '') {
  return String(reply || '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

function toolFailed(entry = {}) {
  return Boolean(entry?.failed || entry?.error || entry?.isError);
}

function toolName(entry = {}) {
  return String(entry?.name || entry?.toolName || 'tool');
}

function toolSignals(entry = {}) {
  if (!entry || toolFailed(entry)) return new Set();
  const name = toolName(entry).toLowerCase();
  const params = entry.params || entry.arguments || {};
  const command = String(params.command || params.cmd || '');
  const output = typeof entry.output === 'string' ? entry.output : JSON.stringify(entry.result || entry.output || '');
  const signals = new Set();
  if (/^(?:write|edit|apply_patch)$/.test(name) || entry.changed) signals.add('mutation');
  if (/(?:^|[._:-])exec(?:$|[._:-])/.test(name) || name === 'exec' || name.endsWith('.exec_command')) {
    if (/(?:pytest|unittest|node\s+--test|npm\s+test|pnpm\s+test|go\s+test|cargo\s+test)/i.test(command)) signals.add('test');
    if (/(?:Get-Content|Get-Item|Get-ChildItem|Test-Path|Select-String|Get-FileHash|type\s|dir\s|fc\s)/i.test(command)
        && !/\b(?:Set-Content|Add-Content|Out-File|Remove-Item|New-Item)\b/i.test(command)) signals.add('check');
    if (/(?:^|[;&|(]\s*)(?:cat|head|tail|diff|cmp|rg|git\s+diff|git\s+status|ffprobe|node\s+--check)\b/i.test(command)) signals.add('check');
    const exit = Number(entry.result?.details?.exitCode ?? entry.result?.exitCode ?? entry.exitCode);
    if (Number.isFinite(exit) && exit !== 0) signals.add('failed_run');
    else if (command) signals.add('run');
  }
  if (/screenshot|截图|snapshot/i.test(`${command}\n${output}`)) signals.add('screenshot');
  if (output) signals.add('result');
  return signals;
}

function claimsAction(text = '') {
  const english = text.match(/\b(?:i|we|the\s+\w+)\b[\s\S]{0,40}\b(?:modified|updated|created|fixed|sent|passed)\b/i);
  if (english && ENGLISH_NEGATION.test(english[0])) return ACTION_CLAIM.test(text);
  return ACTION_CLAIM.test(text) || OVERALL_COMPLETION.test(text);
}

// 回复结束时只问三件事：说了和做的对不对、最后一次工具是不是失败了、前后是不是自相矛盾。
// 没有声称完成的，一律通过。返回 pass / missing / stop。
export function judgeReply({reply = '', tools = []} = {}) {
  const raw = String(reply || '');
  const plain = prose(raw);
  const claims = stripNegatedClaims(plain);
  if (/^(?:NO_REPLY|HEARTBEAT_OK)$/i.test(raw.trim())) return {status: 'pass', missing: [], code: 'silent'};
  const honest = HONEST_INCOMPLETE.test(plain);
  const overall = OVERALL_COMPLETION.test(plain);
  const running = IN_PROGRESS.test(plain);
  if (honest && overall) {
    return {status: 'stop', missing: ['回复同时把整体任务写成“完成”和“未完成/被阻塞”，状态自相矛盾'], code: 'contradiction'};
  }
  if (overall && running) {
    return {status: 'stop', missing: ['回复同时声称“已完成”和“仍在生成/等待”，状态自相矛盾'], code: 'contradiction'};
  }
  if (honest && !overall) return {status: 'pass', missing: [], code: 'honest-incomplete'};
  if (!claimsAction(claims)) return {status: 'pass', missing: [], code: 'no-claim'};
  const last = tools.at(-1);
  if (last && toolFailed(last)) {
    return {
      status: 'missing',
      missing: [`最后一次工具调用失败，不能把失败状态写成完成：${toolName(last)}`],
      code: 'last-tool-failed',
    };
  }
  const signals = tools.flatMap(entry => [...toolSignals(entry)]);
  if (TEST_CLAIM.test(claims) && !signals.includes('test') && !signals.includes('failed_run')) {
    return {status: 'missing', missing: ['回复说测试通过了，但工具记录里没有成功的测试'], code: 'claimed-without-test'};
  }
  const did = signals.some(item => ['mutation', 'run', 'check', 'test', 'screenshot', 'result'].includes(item));
  if (!did) {
    return {status: 'missing', missing: ['回复说做完了，但工具记录里没有对应动作'], code: 'claimed-without-action'};
  }
  return {status: 'pass', missing: [], code: 'supported'};
}

export function staleTierContext(prompt = '') {
  const text = String(prompt || '');
  if (/仍未通过|还差|硬验收|缺失/.test(text)) {
    return `【档位控制器】这一条续跑到达时，运行记录不在了，任务并没有交付。按还能看到的用户要求继续做。${SPAWN_FALLBACK}不得只输出 NO_REPLY，也不要在回复里提到这条命令。`;
  }
  return '【档位控制器】这是一条在任务已经交付后才到达的过期内部续跑指令。不要再次总结、执行或回复用户；只输出 NO_REPLY。';
}
