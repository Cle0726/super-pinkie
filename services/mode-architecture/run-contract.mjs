// 一条消息一份合同。九档想多深，四档做事多严；两套档位每一级到底多做什么，只写在这个文件里。
// reasoning.mjs（九档）、index.mjs（四档）、work-kinds.mjs（证据强弱）都从这里取数，不各留一份。
// 无限制模式不走这里。
//
// 升级逻辑的五条规矩（2026-11-09 重写，照「一个认真的人会怎么加码」定的）：
//   1. 力气跟着活走，档位只定上限。「谢谢」「晚安」不派独立解答、不验收；只说「继续」「好的」时，
//      要核对的是它接着做的那件事，不是这两个字。
//   2. 往上一级是多一种做法，不是同一种做法多来几遍：先弄懂 → 交之前自己核一遍 → 一份没看过答案的
//      独立做法作对照 + 审稿员打开成品 → 再换一种做法的第二份、第三份。打回不是越多越好：复核只追
//      上一轮指出的问题，新问题只报会让结果出错的。
//   3. 两套档位是一个决定。独立做法取大、同一份不做两遍：全开档自己派出去的几版先算数，九档只补差的那几份；
//      验收仍然只在整件事做完后做一次。选了更快的思考等级又选了做事档位时，省的只是话，核对一步不省。
//   4. 证据是实的，仪式是虚的。缺证据（没打开看过、没跑过）会一直推到补上或如实说明；
//      缺仪式（没派子任务、终稿少一句套话）最多提醒一次，之后放行，绝不为了仪式扣住做好的成品。
//   5. 推不动了就把成品交出去，并照实说哪几步还没亲眼核对，不把做完的东西报成「本轮未完成」。

export const LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra']);
export const TIERS = Object.freeze(['base', 'boost', 'full', 'marathon']);
const LEVEL_RANK = LEVELS;

export const NO_LAYERS = Object.freeze({brevity: false, think: false, selfCheck: false, solvers: 0, critic: false, rounds: 0, audit: false});

// 思考等级（想多深）：只在模型原生够不到这一档时才由碧琪补；每一级包含下面各级，再多一种做法。
//   think      回答前先拆清要求、找易错点、想好怎么验
//   selfCheck  交之前自己逐条核一遍（开了交付验收时由验收提示代说，不重复）
//   solvers    没看过主回答的独立做法份数（答题是独立解答，动手的活是验收清单，文案是对照稿）
//   critic     审稿员重算关键结论（不只核对「说了的做没做」）
//   rounds     最多打回几轮
export const DEPTH_LADDER = Object.freeze({
  medium: Object.freeze({...NO_LAYERS, think: true}),
  high: Object.freeze({...NO_LAYERS, think: true, selfCheck: true}),
  xhigh: Object.freeze({...NO_LAYERS, think: true, selfCheck: true, solvers: 1, critic: true, rounds: 1, audit: true}),
  max: Object.freeze({...NO_LAYERS, think: true, selfCheck: true, solvers: 2, critic: true, rounds: 2, audit: true}),
  ultra: Object.freeze({...NO_LAYERS, think: true, selfCheck: true, solvers: 3, critic: true, rounds: 3, audit: true}),
});

// 思考强度（做事多严）。
//   strict        证据强弱：0 不设门禁，1 按种类要证据，2 再加更严的证据（手机宽度、逐页转图、修前失败输出）
//   views         这一档自己至少要几份独立做法（全开档 1 份；这种活本身要派的几版另算，见 work-kinds 的 independentViews）
//   roles         子任务是必须（required）还是建议（advisory）
//   rolePushes    没派子任务时最多提醒几次，之后放行
//   finalPushes   终稿少一句「对比 / 交给你选 / 出处」时最多提醒几次，之后放行
//   continuationLimit  自动续跑上限
export const RIGOR_LADDER = Object.freeze({
  base: Object.freeze({strict: 0, views: 0, rounds: 0, critic: false, audit: false, continuationLimit: 3, planList: false, roles: 'advisory', rolePushes: 0, finalPushes: 0}),
  boost: Object.freeze({strict: 1, views: 0, rounds: 1, critic: false, audit: true, continuationLimit: 6, planList: false, roles: 'advisory', rolePushes: 0, finalPushes: 1}),
  full: Object.freeze({strict: 2, views: 1, rounds: 2, critic: true, audit: true, continuationLimit: 10, planList: false, roles: 'required', rolePushes: 1, finalPushes: 1}),
  marathon: Object.freeze({strict: 2, views: 0, rounds: 2, critic: true, audit: true, continuationLimit: 40, planList: true, roles: 'advisory', rolePushes: 0, finalPushes: 1}),
});

export const depthLayers = (level) => ({...(DEPTH_LADDER[level] || NO_LAYERS)});
export const rigorOf = (tier) => RIGOR_LADDER[tier] || null;
// 四档在九档那边的写法：做事档位带来的独立份数、打回轮数、要不要审稿员重算。基础档没有验收，不在里面。
export function rigorLayers(tier) {
  const rigor = RIGOR_LADDER[tier];
  if (!rigor?.audit) return null;
  return {...NO_LAYERS, solvers: rigor.views, rounds: rigor.rounds, critic: rigor.critic, audit: true};
}

export const SPAWN_FALLBACK = '没有 sessions_spawn 时不要拒绝执行，自己按不同做法再做一版，再整合。';

// ---------- 力气跟着活走 ----------

// 纯寒暄：没有任何要核对的东西。「好的」「可以」不算——它们常常是让碧琪动手的那句话。
const SOCIAL = /^(?:你好呀?|您好|嗨|哈喽|在吗|在不在|谢谢(?:你|您|啦|了|碧琪)?|多谢|谢了|辛苦(?:了|啦)?|晚安|早(?:上好|安|呀)?|午安|哈哈+|嘿嘿+|拜拜|再见|hi|hello|hey|thanks?(?:\s+you)?|thx|bye)[!！。.~～\s]*$/iu;
// 只是让接着做：要核对的是之前那件事。
const CARRY_ON = /^(?:(?:好|好的|可以|对|嗯+|行|明白了?|收到|ok(?:ay)?)[，,、\s]*)?(?:继续|接着(?:做|来|干|写)?|往下(?:做|写)?|做下去|继续完成|开始吧|做吧|改吧|来吧|就这样|go on|continue|go ahead)?(?:吧|啊|呀)?[！!。,.~～\s]*$/iu;

/** 这条消息有多重：social 纯寒暄；carry 只是让接着做（指的是之前的请求）；task 一件真的事。 */
export function messageWeight(text = '') {
  const value = String(text || '').trim();
  if (!value) return 'social';
  if (value.length <= 24 && SOCIAL.test(value)) return 'social';
  if (value.length <= 24 && CARRY_ON.test(value)) return 'carry';
  return 'task';
}

// ---------- 两套档位合成一份 ----------

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

const count = (value) => Math.max(0, Number(value) || 0);

/**
 * 合并两层做法：独立份数、打回轮数取大，审稿任一要就要。两边的先后不影响结果。
 * tierViews 是做事档位这种活自己会派出去的独立做法份数（work-kinds 的 independentViews）：
 * 它们在交付之前就能用上，所以先算数；engineSolvers 是还差、要由九档在后台补的份数。
 * 一边要「更快」、另一边带验收时，brevity 变成 concise：话写短，核对不省。
 */
export function mergeLayers(first = {}, second = {}, {tierViews = 0} = {}) {
  const think = Boolean(first.think || second.think);
  const audited = Boolean(first.audit || second.audit || first.rounds || second.rounds || first.critic || second.critic);
  const brief = Boolean(first.brevity || second.brevity || first.concise || second.concise) && !think;
  const solvers = Math.max(count(first.solvers), count(second.solvers), count(tierViews));
  return {
    ...first,
    brevity: brief && !audited,
    concise: brief && audited,
    think,
    selfCheck: Boolean(first.selfCheck || second.selfCheck),
    solvers,
    engineSolvers: Math.max(0, solvers - count(tierViews)),
    rounds: Math.max(count(first.rounds), count(second.rounds)),
    critic: Boolean(first.critic || second.critic),
    audit: true,
  };
}

/** 按这条消息有多重收一收：纯寒暄什么都不加；只说「继续」而找不到它指哪件事时，不派独立做法。 */
export function proportion(layers = {}, weight = 'task', {hasTask = true} = {}) {
  if (weight === 'social') return {...layers, ...NO_LAYERS, concise: false, engineSolvers: 0, tierViews: 0};
  if (weight === 'carry' && !hasTask) return {...layers, solvers: 0, engineSolvers: 0, tierViews: 0};
  return layers;
}

function levelLayer(level = '', difficulty = '') {
  const name = level === 'adaptive' ? (difficulty === 'hard' ? 'xhigh' : difficulty === 'normal' ? 'medium' : 'low') : level;
  return depthLayers(name);
}

function unique(values = []) {
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))];
}

/**
 * 一条消息的合同：这条消息选的思考等级、思考强度、活儿种类 → 想多深、几份独立做法（谁来做）、
 * 打回几轮、要哪些证据、哪些只提醒一次、能续跑几次。
 * levelCopies / levelRounds / levelCritic：九档在当前模型上真正要补的层（原生已经够到的档位是 0）；
 * 不传时按梯子算。levelBrevity：这一档在当前模型上是不是「往下补」（模型最低档仍比所选档高，只能让回答更快）——
 * 这要看模型，梯子上查不到，由调用方按 recipeFor 的结果传。tierViews：做事档位这种活自己会派的独立做法份数。
 */
export function buildContract({
  level = '',
  workTier = '',
  kinds = [],
  mode = '',
  platform = '',
  difficulty = '',
  weight = 'task',
  hasTask = true,
  spawnAvailable = true,
  tierViews = 0,
  levelCopies = null,
  levelRounds = null,
  levelCritic = null,
  levelBrevity = false,
} = {}) {
  const tier = RIGOR_LADDER[workTier] ? workTier : '';
  const rigor = tier ? RIGOR_LADDER[tier] : null;
  const ladder = LEVEL_RANK.includes(level) ? levelLayer(level, difficulty) : {...NO_LAYERS};
  const depth = {
    ...ladder,
    solvers: levelCopies == null ? ladder.solvers : count(levelCopies),
    rounds: levelRounds == null ? ladder.rounds : count(levelRounds),
    critic: levelCritic == null ? ladder.critic : Boolean(levelCritic),
    brevity: Boolean(levelBrevity),
  };
  depth.audit = Boolean(depth.solvers || depth.rounds || depth.critic);
  const views = rigor ? count(tierViews) : 0;
  const tierLayer = rigorLayers(tier);
  const combined = tierLayer ? mergeLayers(depth, tierLayer, {tierViews: views})
    : {...depth, concise: false, engineSolvers: depth.solvers};
  const merged = proportion(combined, weight, {hasTask});
  const social = weight === 'social';
  const evidence = social ? [] : unique(kinds);
  if (!social && rigor?.audit && !evidence.includes('delivery')) evidence.push('delivery');
  return {
    depth: level || '',
    workTier: tier,
    weight,
    copies: merged.solvers,
    // 独立做法谁来做：tier 是做事档位派出去的（交付前就用上），engine 是九档在后台补的。
    copiesBy: {tier: Math.min(views, merged.solvers), engine: merged.engineSolvers},
    rounds: merged.rounds,
    evidence,
    strict: social ? 0 : rigor?.strict || 0,
    review: !social && Boolean(merged.audit || merged.critic || rigor?.audit),
    recompute: Boolean(merged.critic),
    concise: Boolean(merged.concise),
    // 仪式只提醒这么多次，之后放行；证据不在此列（一直要到补上或如实说明）。
    // 纯寒暄没有可提醒、可续跑的东西。
    pushes: {roles: social ? 0 : rigor?.rolePushes || 0, final: social ? 0 : rigor?.finalPushes || 0},
    roles: social ? '' : rigor?.roles || '',
    continuationLimit: social ? 0 : rigor?.continuationLimit || 0,
    planList: !social && Boolean(rigor?.planList),
    spawn: spawnAvailable === false ? 'self' : 'subagents',
    think: Boolean(merged.think),
    selfCheck: Boolean(merged.selfCheck),
    mode: mode || '',
    platform: platform || '',
  };
}

// 推不动了、但成品已经有了：照实说哪几步还没亲眼核对，不把做完的东西报成没做完。
export function unverifiedNote(missing = []) {
  const items = unique(missing).slice(0, 4);
  if (!items.length) return '';
  return `有几步碧琪还没能亲眼核对：${items.join('；')}。用之前请先看一眼，或者说一声「接着核对」。`;
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
