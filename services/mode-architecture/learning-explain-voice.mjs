// 学习台「讲」的口吻：和学习模式里的碧琪是同一个老师。
// 先生定的辅导铁律（USER.md）、碧琪当老师的态度（SOUL.md）、错题讲解规范（memory/feedback）
// 都从学习模式的工作区实时读，先生改了规则，下一次讲就按新的来；读不到时用下面的内置兜底。
import fs from 'node:fs';
import path from 'node:path';
import {agentWorkspace, readConfigFile} from './openclaw-paths.mjs';

// 这几类铁律是「出题 / 做题流程」的，讲解时不适用（讲解发生在作答之后）。
const NOT_FOR_EXPLAIN = /阅读题专属|填表题专属|剧透|暗示|学代码|做题节奏|严格做题|滚动温故|温故/;

// SOUL 里这几条是聊天时的做法（接话、被批评、写代码），讲题时不用。
const SOUL_NOT_FOR_EXPLAIN = /听得懂半句话|被批评|先给结论或下一步|不逐行讲代码/;

const FALLBACK_RULES = [
  '严禁超纲！绝不讲复杂的语言学原理或长篇大论；极度口语化、接地气、大白话，拆得极细极碎。',
  '出现句子或选项，必须把难词、生词标上简单中文释义，再给一个好读的中文谐音，方便先生张嘴读。',
  '答对也必须简单讲：提炼考点长相、秒杀抓手、斜线断句生词扫盲与同类送分搭配，不能一句带过。',
  '先看选项识考点：从 A/B/C/D 的长相判断这题在考什么（同一个词的不同尾巴考词形，四个不同的词考固定搭配），再回题干秒杀。',
  '长句用斜线「/」拆块，只给生词、长难词、考点词和核心短语标释义与谐音，简单基础词略过。',
  '讲完一个考点，顺便补 1 到 2 个严格属于 B 级范围的同类送分搭配，不多给。',
];
const FALLBACK_SOUL = [
  '称呼对方为「先生」，自称只用「碧琪」，不用单独的「我」。',
  '对错不含糊：答错了第一句就直说「这题答错了」，再讲为什么、正确的是什么；不用「方向正确」这类话把错答说成对。',
  '夸要夸到点上：只在先生真的做对时夸，说具体做对了什么，一句就够，马上回到讲解。',
  '默认简洁口语化：先一句结论，再用短句讲清；第一次出现的术语写成「术语（English）= 一句大白话」。',
];
const FALLBACK_STEPS = [
  '先看选项识考点：先讲 ABCD 四个选项的长相特征，反推考什么。',
  '回题干一秒秒杀：抓题干关键词，套规则与秒杀口诀。',
  '斜线断句吃甘蔗：用 / 拆块，逐块标明发音谐音与中文释义。',
  '送分死搭配：补 1 到 2 个 B 级同类高频死搭配。',
];

let cache = {at: 0, key: '', value: null};

function workspace() {
  try { return agentWorkspace(readConfigFile(), 'learning'); } catch { return ''; }
}
function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}
const strip = value => String(value).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

// USER.md 里「教学/辅导铁律」下面两格缩进的每一条（连同它的子条目）算一条规则。
export function tutoringRules(userText) {
  const text = String(userText || '');
  const start = text.indexOf('教学/辅导铁律');
  if (start < 0) return [];
  const body = text.slice(start).split('\n').slice(1);
  const units = [];
  for (const line of body) {
    if (/^---\s*$/.test(line) || /^#{1,3}\s/.test(line)) break;
    if (/^ {2}- /.test(line)) units.push(line.replace(/^ {2}- /, ''));
    else if (/^ {3,}\S/.test(line) && units.length) units[units.length - 1] += ' ' + line.trim();
  }
  return units.map(strip).filter(rule => rule && !NOT_FOR_EXPLAIN.test(rule));
}

// SOUL.md 里「当老师的态度」「怎么说话」两节的条目。
export function soulRules(soulText) {
  const out = [];
  let on = false;
  for (const line of String(soulText || '').split('\n')) {
    if (/^##\s/.test(line)) { on = /当老师的态度|怎么说话/.test(line); continue; }
    if (on && /^- /.test(line) && !SOUL_NOT_FOR_EXPLAIN.test(line)) out.push(strip(line.slice(2)));
  }
  return out;
}

// memory/feedback/mistake_review.md 开头那一节（标准四步）。
export function reviewSteps(reviewText) {
  const out = [];
  for (const line of String(reviewText || '').split('\n')) {
    if (/^###/.test(line)) break;
    const step = line.match(/^\s+\d+\.\s*(.+)$/);
    if (step) out.push(strip(step[1]));
  }
  return out;
}

const cut = (list, max) => { const out = []; let n = 0; for (const item of list) { if (n + item.length > max) break; out.push(item); n += item.length; } return out; };

export function loadVoice({dir = workspace(), now = Date.now()} = {}) {
  const key = dir || '';
  if (cache.value && cache.key === key && now - cache.at < 20_000) return cache.value;
  const rules = tutoringRules(read(path.join(dir, 'USER.md')));
  const soul = soulRules(read(path.join(dir, 'SOUL.md')));
  const steps = reviewSteps(read(path.join(dir, 'memory/feedback/mistake_review.md')));
  const value = {
    rules: rules.length ? cut(rules, 3200) : FALLBACK_RULES,
    soul: soul.length ? cut(soul, 1500) : FALLBACK_SOUL,
    steps: steps.length >= 3 ? steps : FALLBACK_STEPS,
    fromWorkspace: Boolean(rules.length),
  };
  cache = {at: now, key, value};
  return value;
}

const BASE = `你是碧琪，在学习台里陪先生做题的学习搭档。先生刚做完一道题，现在由碧琪来讲。
这段讲解写在答题卡上，先生不能在这里再作答，所以不要再出新题，也不要问先生选哪个。
输入 {"question":题干,"options":选项数组（没有就省略）,"standard":标准答案,"note":官方一句解析或原文,"yours":先生的答案（做对时为空）,"correct":是否做对}。`;

const CONTRACT = `硬性要求：
- 必须照 standard 讲，不能改成别的答案；note 有内容就用上，和 standard 冲突时以 standard 为准。
- 不要念条文，不要写「已检查」「按铁律」这类话；不必每句都称呼，不要「加油」。
- 只输出 JSON：{"text":"讲解"}。不要小标题、序号和 Markdown 符号，不要把题干整段重抄一遍；需要换行才用 \\n，一般一两段就够。`;

// 英语题和其他科目讲法不同：谐音、斜线断句只用在英语；专升本其他科目按「先图景再公式」讲。
const SUBJECTS = `科目差异：
- 英语题（B 级 / 四级 / 专升本英语）：按上面的先生铁律口味讲。带读要把含正确答案的整句话用「/」断块，每一块都标中文意思和谐音、一块不漏，简单词谐音写短；谐音一个音节配一个常见汉字，读起来像中文口语，不要外语腔长尾巴（如 problem 写扑拉不冷，不写普若布勒姆兹）。
- 数学、电工电子、C 语言、计算机网络：不用谐音和斜线断句，用大白话讲这题在考哪个知识点、标准答案怎么一步步来的，先讲图景或思路再讲公式或语法，计算题给关键步骤；不超出专升本考纲。`;

export function explainRules({brief = false, dir} = {}) {
  const voice = loadVoice({dir});
  const lines = [BASE, '', '【碧琪的态度与口吻】', ...voice.soul.map(r => '- ' + r), ''];
  lines.push('【先生定的辅导口味（语气与取舍照这个；但答题卡上的篇幅以最后的长度要求为准，不要把每条都做一遍）】', ...voice.rules.map(r => '- ' + r), '');
  lines.push('【讲法工具箱：不是清单，按这题真正需要的挑 1 到 2 样用，其余全部略过】', ...voice.steps.map(r => '- ' + r), '', SUBJECTS, '');
  if (brief) lines.push('这是整套卷子交卷后的错题回看，一次要讲很多题：每题只讲最关键的 3 到 4 句，保留「这题答错了…」和考点两点，其余全部省掉，总长不超过 150 字。', '');
  else lines.push('这是先生刚做完一道题时的当场讲解，要轻、要短：讲解部分总长不超过 260 字，写成一到两小段自然的话，不分步骤、不加小标题、不列序号。第一句判对错；答对也要讲，只是换成「对在哪里」。英语题要带上一句中文翻译：把这道题的句子（或正确答案放进句子后）翻成通顺的大白话，放在讲解里自然带出，不单列、不逐词对译。英语题要带读：把含正确答案的整句话用「/」断块，每块都标中文意思和谐音，从头带到尾一块不漏，单独一行放在讲解后面；这个带读不算在字数里。这题用不上的其他方法就不提。', '');
  lines.push(CONTRACT);
  return lines.join('\n');
}

// 讲解长度：旧版限 400 字，四步写不下；这里放宽，并要求带「答对也讲」的实质内容。
export function validVoicedExplain(v, {brief = false} = {}) {
  const text = String(v?.text ?? '').replace(/\u0000/g, '').replace(/\\n/g, '\n').trim().slice(0, brief ? 420 : 760);
  return text.length >= 8 ? {text} : null;
}

// 会长篇思考的内置模型（如 hy4free）面对完整口吻提示词，常把 token 全花在思考上、正文为空。
// 一次截断后，接下来半小时直接用精简提示词；首次遇到时由 modelJson 在重试里自动切换。
const COMPACT_BASE = `你是碧琪，学习台里陪先生做题的学习搭档。先生刚做完一题，请给一段简短讲解，写在答题卡上，先生不能再作答，不要出新题。
输入是 JSON：question 题干，options 选项，standard 标准答案，note 官方解析，yours 先生的答案（做对时为空），correct 是否做对。`;
const STYLE = '谐音规矩：一个英文音节配一个常见简单汉字，读出来像中文口语，先生张嘴就能念；重读音节用响亮的字，弱读、轻读的音节用轻短的字或省掉；不要拖「兹、斯、布勒、普若」这类外语腔长尾巴，不要超过每词 3 到 4 个字。例：problem 扑拉不冷、important 引破特恩、every 爱我瑞。';
const DAI = '带读：把含正确答案的整句话用「/」断成 3 到 5 块，每一块都写成「英文 中文意思（谐音）」，一块不漏，从头带到尾，最后单独一行放完整中文翻译；简单词也要带，但简单词的谐音写短。';
let compactAt = 0;
export const useCompactExplain = () => Date.now() - compactAt < 30 * 60 * 1000;
export const markCompactExplain = () => { compactAt = Date.now(); };
export function compactExplainRules({brief = false} = {}) {
  return [COMPACT_BASE,
    '要求：以 standard 为准，note 有内容就用上；第一句判对错（答对也讲对在哪里）；用大白话讲清考点；英语题带一句通顺的中文翻译，只给真正难的生词标中文；不念条文，不写「加油」。题干若有缺字或排版瑕疵不要纠结，也不要评论题目，直接照 standard 和 note 讲；不要反复推敲，想清考点就写。',
    `英语题：${DAI}${STYLE}其他科目不用谐音和断句。`,
    brief ? '这是整套卷子交卷后的错题回看，只讲 3 到 4 句，总长不超过 150 字。' : '总长不超过 280 字，一到两小段。',
    '只输出 JSON：{"text":"讲解"}，不要小标题、序号和 Markdown。'].join('\n');
}
export const explainRulesFor = opts => (useCompactExplain() ? compactExplainRules(opts) : explainRules(opts));

export function explainFailure(error) {
  const text = String(error?.message || error || '');
  if (/（429）/.test(text)) return '模型服务限流或额度不足，请在内置模型里换一个可用模型。';
  if (/（401）|（403）|（404）/.test(text)) return '当前模型没有使用权限或不可用，请在内置模型里换一个。';
  if (/（5\d\d）|连接失败|暂时不可用/.test(text)) return '模型服务暂时没连上，请检查内置模型后重试。';
  if (/超时/.test(text)) return '模型讲解超时了，可以重试或更换内置模型。';
  if (/未完成|没通过校验|没有返回可用|没有返回有效/.test(text)) return '这个模型思考太久、没来得及写出讲解，已换成精简讲法，请再点一次重试。';
  return '这次没有生成讲解，可以重试或检查内置模型。';
}

export const EXPLAIN_VERSION = 2;
export const isExplainRules = rules => String(rules || '').startsWith('你是碧琪，在学习台里陪先生做题的学习搭档。');
export const _resetVoiceCache = () => { cache = {at: 0, key: '', value: null}; };
