// 学习台「讲」的口吻：和学习模式里的碧琪是同一个老师。
// 用户定的辅导铁律（USER.md）、碧琪当老师的态度（SOUL.md）、错题讲解规范（memory/feedback）
// 都从学习模式的工作区实时读，用户改了规则，下一次讲就按新的来；读不到时用下面的内置兜底。
import fs from 'node:fs';
import path from 'node:path';
import {agentWorkspace, readConfigFile} from './openclaw-paths.mjs';
import {readVerifiedBundleFile} from './settings-guard.mjs';

// 出题流程不用于答题卡；工作区里旧的「斜线+括号串」逐词带读法不带进答题卡，统一按下面的「词一行、行行紧贴」模板。
const NOT_FOR_EXPLAIN = /阅读题专属|填表题专属|剧透|暗示|学代码|做题节奏|严格做题|滚动温故|温故|逐词带读法/;

// SOUL 里这几条是聊天时的做法（接话、被批评、写代码），讲题时不用。
const SOUL_NOT_FOR_EXPLAIN = /听得懂半句话|被批评|先给结论或下一步|不逐行讲代码|专业术语|一句大白话/;

const FALLBACK_RULES = [
  '严禁超纲！绝不讲复杂的语言学原理或长篇大论；极度口语化、接地气、大白话。',
  '【做题两步金口诀】：1. 先看选项识考点（看 ABCD 长相或中文找茬）；2. 回题干秒杀（抓关键词对位秒选）。答对也必须按这套讲清。',
  '【B级四套极简秒杀抢分战法】：1. 英译汉单选：不看英文，先在 ABCD 中文里找茬找不同，圈出差异词再回英文对位秒选；2. 词形填空：四大变身尾巴公式（-ly 副词、-tion/-ment 名词、-er/-or 人、-ed/-ing 动词形容词）；3. 单选铁律：介词后（in/on/at/of/for/about/with/without 等）闭眼抓 -ing；4. 阅读理解：无脑连连看（抓大写、数字、特殊生词直接回原文找原词复现，答案就在原句或邻近句）。',
  '逐词带读一个词都不许省：连 This / will / of / and / the / a / is / to / what / out 这类小词也要逐词一行（单词 谐音 中文，不用括号）。',
  '讲完一个考点，补 1 到 2 个严格属于 B 级范围的送分搭配，固定搭配变身时剥壳认原形骨架，最后给一句极简钉牢口诀。',
];
const FALLBACK_SOUL = [
  '自称只用「碧琪」，不用单独的「我」。',
  '对错不含糊：答错第一句直说答错了和正确答案，不用「方向正确」把错答说成对。',
  '默认简洁直白：短行、大留白，一句废话不多说，直接给考场能拿分的抓手。',
];
const FALLBACK_STEPS = [
  '先看选项识考点：看 ABCD 长相或中文找茬，反推考什么、抓手在哪。',
  '回题干秒杀：拎出含空半句翻大白话，对位秒选并排掉干扰项。',
  '逐词带读与一块块大白话：整句逐词一行不漏小词，再按意群块连成整句通译，并逐词扫清四个选项。',
  '送分搭配与一句话钉牢：补 1 到 2 个 B 级高频送分搭配，最后一句口诀钉牢。',
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

// 独立的讲解调用看不到 USER.md，把用户偏好的称呼带进提示词。
export function preferredAddress(text = '') {
  const match = String(text).match(/^[-*\s]*\*{0,2}What to call them:?\*{0,2}:?[ \t]*(.*)$/mi);
  const value = strip(match?.[1] || '').replace(/^_?\(optional\)_?$/i, '').trim();
  return value && value.length <= 20 ? value : '';
}
export const addressRule = address => address
  ? `称呼：用户希望被叫「${address}」，在自然的地方叫一次就够，不必句句都叫。`
  : '不加「先生」「老板」之类的称呼，要称呼就用「你」。';

const cut = (list, max) => { const out = []; let n = 0; for (const item of list) { if (n + item.length > max) break; out.push(item); n += item.length; } return out; };

export function loadVoice({dir = workspace(), now = Date.now()} = {}) {
  const key = dir || '';
  if (cache.value && cache.key === key && now - cache.at < 20_000) return cache.value;
  const user = read(path.join(dir, 'USER.md'));
  const rules = tutoringRules(user);
  const soul = soulRules(readVerifiedBundleFile('learning', dir, 'SOUL.md'));
  const steps = reviewSteps(read(path.join(dir, 'memory/feedback/mistake_review.md')));
  const value = {
    rules: rules.length ? cut(rules, 3200) : FALLBACK_RULES,
    soul: soul.length ? cut(soul, 1500) : FALLBACK_SOUL,
    steps: steps.length >= 3 ? steps : FALLBACK_STEPS,
    fromWorkspace: Boolean(rules.length),
    address: preferredAddress(user),
  };
  cache = {at: now, key, value};
  return value;
}

const BASE = `你是碧琪，在学习台里陪用户做题的学习搭档。用户刚做完一道题，现在由碧琪来讲。
这段讲解写在答题卡上，用户不能在这里再作答，所以不要再出新题，也不要问用户选哪个。
输入 {"question":题干,"options":选项数组,"standard":标准答案,"note":官方解析或原文,"yours":用户的答案（做对时为空）,"correct":是否做对,"qkind":题型,"point":考点,"base":括号原词}。`;

const STYLE = '谐音规矩（地道中文化、张嘴顺口）：直接用常见简单汉字连读，像平时说中文词一样顺嘴；尽量吞掉英文词尾生硬辅音，少拖「克、特、德、斯、兹、布勒、普若」长尾巴，每词 1 到 3 字（长词最多 4 字）；多词短语的谐音中间用「·」连起来、不打空格。例：find out 饭·奥、depend on 弟盆·昂、take effect 忒·一费、apply for 阿扑来·佛、important 引破疼、problem 扑拉不冷、while driving 外·拽英。';

const LAYOUT = `英语题答题卡固定按下面 6 个板块输出（板块之间空一行 \\n\\n，严禁用 Markdown 的 # / ** / 表格，严禁写「消化好发继续」「上一轮已核对」「加油」等聊天话）：

开头一句：答错写「选了 <yours>，答错了。正确答案是 <standard>。」（没填yours就写「答错了，正确答案是 <standard>。」）；答对写「答对了，选 <standard>。」

先看选项识考点
用 1 句大白话看选项长相定考点（结合 point）并指明抓手词。若是词形填空无选项，看括号原词 base 交代套四大尾巴公式（-ly 副词 / -tion,-ment 名词 / -er,-or 人 / -ed,-ing 动词形容词）；若是英译汉单选，先在 ABCD 中文里找茬圈差异词；若是阅读题，指明抓大写/数字/生词回原文定位。

回题干秒杀
先把含空的关键半句拎出来，下一行写「＝ 对应大白话中文」；空一行再用 1 到 2 行大白话推答案（结尾写「→ 正确答案 ＝ 中文 ✅」）；空一行排掉先生错选和其余干扰项（结尾带 ❌）。凡提到的英文词都顺手带中文，固定搭配变形/被动/插词要剥壳认原形，介词后闭眼抓 -ing。

逐词带读
把含正确答案的那 1 句完整英文从头到尾逐词拆开，严格「一词一行、行行紧贴」，每行写成「单词 谐音 中文」（不用括号、不用斜线；This / will / of / and / the / a / is / to / what / out 等小词一个不许漏；正确答案那个词行末加 ✅）。
只给其中的生词、长词、考点词在行末附一条极短快速记忆法，格式为「｜ 记：拆词/画面/熟词联想（≤14字）」；简单小词（this/will/your/the/a/is/to/of/in/out 等）不要硬编，直接留空不写。

一块块大白话
把刚才那句按说话停顿切成 2 到 4 块，每块一行写成「英文短块 → 这块的大白话中文」；空一行写「整句：完整通顺中文翻译。」

四个选项逐词扫
有英文选项时，把 A/B/C/D 四个选项逐个一行写成「选项英文 谐音 中文意思 ｜ 记：极短快速记忆法」（正确项加 ✅；短语谐音用「·」连接不打空格；记忆法限 14 字以内，优先用词根拆词、动词+方向画面或熟词联想，实在没好法子就省略「｜ 记：…」不硬编）。词形填空无选项时，改为扫盲括号原词 base 及常见变形词（2 到 3 行，每行附尾巴/拆词速记）；英译汉单选选项为中文时，改为扫盲题干决定选项的 2 到 4 个英文关键词（附速记）。

送分搭配
写 1 到 2 条本题核心搭配或 B 级同类高频送分搭配，每条一行「英文 ＝ 中文（附一句易记要点/防变身骨架）」。
空一行收尾写：
一句话钉牢：用一句极简大白话口诀把这题考点钉死。

标准范例（完全照这个呼吸感和结构）：
选了 A，答错了。正确答案是 C（find out）。

先看选项识考点
bring up / put on / find out / take in 四个都是「动词＋小词」短语 → 考短语辨析，抓手在宾语 problem（问题）。

回题干秒杀
help your safety officer ______ what the problem is
＝ 帮安全员 ______ 问题到底是什么

对「问题」做的动作，只能是「查出、弄清」
→ find out ＝ 找出、查明 ✅

排掉 A（bring up）：bring up 是「提出（话题）／抚养（孩子）」，放进句子讲不通 ❌
put on 穿上 / take in 吸收、收留 也都搭不上 ❌

逐词带读
This 泽 这个
record 瑞考 记录 ｜ 记：re再+cord心→记在心上
will 威 将会
help 嗨欧 帮助
your 尤 你的
safety 塞夫梯 安全 ｜ 记：safe安全+ty名词尾巴
officer 奥菲瑟 员、官 ｜ 记：office办公室+er人
find 饭 找出 ✅
out 奥 出来
what 沃 什么
the 泽 这个
problem 扑拉不冷 问题 ｜ 记：solve a problem 解决问题
is 伊 是

一块块大白话
This record will help → 这份记录会帮
your safety officer → 你的安全员
find out what the problem is → 查出问题出在哪

整句：这份记录能帮安全员查出问题所在。

四个选项逐词扫
bring up 不瑞应·昂扑 提出／抚养 ｜ 记：bring带+up往上→带大/端上台
put on 铺·昂 穿上 ｜ 记：put放+on身上→穿上
find out 饭·奥 找出、查明 ✅ ｜ 记：find找+out出来→查明
take in 忒·硬 吸收、收留、欺骗 ｜ 记：take拿+in里面→收进来

送分搭配
find out ＝ 找出、查明（把事情弄明白）
help sb. do sth. ＝ 帮某人做某事（help 后面接动词原形，所以这里 find 不加 s）

一句话钉牢：宾语是 problem / truth / answer 这类「要弄明白的东西」→ 找 find out。`;

// 第二种按键「带读+搭配」：给靠固定搭配秒选做对、但不会读也看不懂整句的题专用，跳过解题分析，专注带读、翻透整句、扩展 B 级固定搭配。
const READ_LAYOUT = `用户做完题后点了「带读+搭配」，想读懂完整句子。不要再讲「先看选项识考点」「回题干秒杀」「排干扰项」「四个选项逐词扫」。
固定只按下面 3 个板块输出（板块之间空一行 \\n\\n，严禁用 Markdown 的 # / ** / 表格，严禁写「消化好发继续」「上一轮已核对」「加油」等聊天话）：

开头一句：写「这句帮你带读翻透，再补几条 B 级高频固定搭配（答案：<standard>）。」

逐词带读
把含正确答案的那 1 句完整英文从头到尾逐词拆开，严格「一词一行、行行紧贴」，每行写成「单词 谐音 中文」（不用括号、不用斜线；This / will / of / and / the / a / is / to / what / out 等小词一个不许漏；正确答案那个词行末加 ✅）。
只给其中的生词、长词、考点词在行末附一条极短快速记忆法，格式为「｜ 记：拆词/画面/熟词联想（≤14字）」；简单小词（this/will/your/the/a/is/to/of/in/out 等）不要硬编，直接留空不写。

一块块大白话
把刚才那句按说话停顿切成 2 到 4 块，每块一行写成「英文短块 → 这块的大白话中文」；空一行写「整句：完整通顺中文翻译。」

B级固定搭配扩展
围绕本题的核心动词、介词或短语，补充 3 到 5 条严格属于英语 B 级高频必考的同类或关联固定搭配（把本题那条放第 1 条，后面扩展同类高频送分搭配）。每条一行写成「英文搭配 ＝ 中文意思（附一句极短记忆法或考场防变身要点）」。
空一行收尾写：
一句话钉牢：用一句极简大白话口诀把这组搭配钉死。

标准范例（完全照这个呼吸感和结构）：
这句帮你带读翻透，再补几条 B 级高频固定搭配（答案：C find out）。

逐词带读
This 泽 这个
record 瑞考 记录 ｜ 记：re再+cord心→记在心上
will 威 将会
help 嗨欧 帮助
your 尤 你的
safety 塞夫梯 安全 ｜ 记：safe安全+ty名词尾巴
officer 奥菲瑟 员、官 ｜ 记：office办公室+er人
find 饭 找出 ✅
out 奥 出来
what 沃 什么
the 泽 这个
problem 扑拉不冷 问题 ｜ 记：solve a problem 解决问题
is 伊 是

一块块大白话
This record will help → 这份记录会帮
your safety officer → 你的安全员
find out what the problem is → 查出问题出在哪

整句：这份记录能帮安全员查出问题所在。

B级固定搭配扩展
find out ＝ 找出、查明（记：find找+out出来→把真相找出来）
carry out ＝ 执行、实施（记：carry扛+out出来→把计划扛出来落地）
work out ＝ 算出、解决（记：work干活+out出来→干出结果）
point out ＝ 指出（记：point手指+out向外→伸手指出来）
help sb. do sth. ＝ 帮某人做某事（考场常考 help 后接动词原形）

一句话钉牢：out 结尾表「弄出来」——查明 find out、执行 carry out、解决 work out、指出 point out。`;

const CONTRACT = `硬性要求：
- 必须照 standard 讲，不能改成别的答案；note 有内容就用上，和 standard 冲突时以 standard 为准。
- 不要念条文，不要写「已检查」「按铁律」「上一轮已核对」「消化好发继续」「加油」等话，不要署名或报模型名。
- 只输出 JSON：{"text":"讲解"}。板块标题直接单独占一行，不要 Markdown 符号（#、**、-）和表格。`;

// 段落翻译（translate-passage）专用完整精讲模板：绝不套用选择题话术，必须从第 1 句到最后 1 句全部拆解翻译 + 全文逐词带读！
const TRANSLATE_PASSAGE_LAYOUT = `这是一道「英译汉段落翻译（实用文）」主观题，不是选择题！
严禁写「选了…」「没有 A/B/C/D 选项」「先看选项识考点」「四个选项逐词扫」；严禁只讲第一句就收尾！
核心铁律：原文有几句英文，就必须从「第 1 句」一路讲到「最后 1 句」，一句不漏地全部拆解翻译、全部逐词带读！

固定按下面 5 个板块输出（板块之间空一行 \\n\\n，严禁用 Markdown 的 # / ** / 表格，严禁写「消化好发继续」「上一轮已核对」「加油」等聊天话）：

开头一句：先用 1 句大白话直说用户这版译文的问题或得分亮点（空白或只写了一半就直说漏翻了后半段，绝不写「选了」），下一行完整写出：
完整官方译文：<standard>

审题与扣分点
结合 yours（用户的译文）和 note（评分要点 / 阅卷评语），用 2 到 3 行大白话指出：
1. 你这版具体翻错了哪几个关键表达、漏掉了原文哪几句（若用户译文全对或基本完整，指出本段考场最容易丢分的 2 个词/句型）；
2. 这类实用文翻译的拿分顺手招：按原文句子顺序一句句切主干，先保大意完整再润色。

逐句精讲与拆译
把 question 里的全部英文句子按顺序编号（第 1 句、第 2 句、第 3 句……直到最后一句，一句都不许省！）：
每句严格按下面格式写，句与句之间空一行：
第 N 句
英文短块 1 → 这块的大白话中文
英文短块 2 → 这块的大白话中文
（按说话停顿切成 2 到 4 块）
整句：这句对应的完整通顺中文译文（紧扣官方参考译文）。
避坑：一句话点破这句最容易翻错的词或句型（没有明显坑可省略这行）。

全文逐词带读
把 question 里的全部英文句子从头到尾每一句都逐词拆开，按「第 1 句」「第 2 句」……分段（每句头写一行「第 N 句」，下面严格「一词一行、行行紧贴」，每行「单词 谐音 中文」；不用括号、不用斜线；the / a / is / to / of / if / and / for / you 等小词一个不许漏！只给生词、长词、高频考点词在行末附「｜ 记：≤14字速记」，简单小词不硬编）。

核心高频搭配
从全篇挑出 4 到 6 条 B 级必考高频词组或实用文句型，每条一行「英文搭配 ＝ 中文意思（附一句极短记忆法或翻译要点）」。

一句话钉牢：用一句极简大白话口诀把这篇段落翻译的得分骨架钉死。`;

const TRANSLATE_PASSAGE_READ_LAYOUT = `这是一道「英译汉段落翻译（实用文）」题，用户点了「带读+搭配」，想把整段每一句都读懂翻透。
严禁只带读第一句！必须把 question 里的全部英文句子从「第 1 句」到「最后 1 句」全部逐词带读、全部逐句拆译，一句不漏！

固定按下面 4 个板块输出（板块之间空一行 \\n\\n，严禁用 Markdown 的 # / ** / 表格，严禁写「消化好发继续」「上一轮已核对」「加油」等聊天话）：

开头一句：写「这篇段落翻译帮你把全篇每一句逐词带读翻透，再补几条 B 级高频固定搭配。」下一行写出：
完整官方译文：<standard>

全文逐词带读
把 question 里的全部英文句子从头到尾每一句逐词拆开，每句前写一行「第 N 句」，下面严格「一词一行、行行紧贴」，每行「单词 谐音 中文」（不用括号、不用斜线；小词一个不许漏；生词/考点词行末附「｜ 记：≤14字速记」）。

逐句拆译
按「第 1 句」「第 2 句」……覆盖全篇每一句，每句按意群拆 2 到 4 行「英文短块 → 这块的大白话中文」，紧接着一行「整句：这句对应的完整通顺中文译文。」（句与句之间空一行）。

B级固定搭配扩展
围绕本段的核心动词、短语与实用文句型，补充 4 到 6 条 B 级高频固定搭配，每条一行「英文搭配 ＝ 中文意思（附极短记忆法或翻译要点）」。

一句话钉牢：用一句极简大白话口诀把这组高频搭配钉死。`;

const WRITING_LAYOUT = `这是一道「英语 B 级应用文写作」主观题，不是选择题！
严禁写「选了…」「没有 A/B/C/D 选项」「先看选项识考点」「四个选项逐词扫」。
必须覆盖完整范文的全部句子和写作格式要件！

固定按下面 5 个板块输出（板块之间空一行 \\n\\n，严禁用 Markdown 的 # / ** / 表格，严禁写「消化好发继续」「上一轮已核对」「加油」等聊天话）：

开头一句：先用 1 句大白话直说用户这版作文的亮点与扣分点（若空白或偏题直说），下一行完整写出：
完整官方范文：<standard>

审题与格式要件
结合题目要求和 note（评分要点 / 阅卷评语），用 2 到 4 行大白话讲清：
1. 这类应用文必备格式（称呼、正文要点、落款/日期）和必写信息点；
2. 用户这版（yours）具体缺了哪些要点或哪处语法/拼写最该改。

范文逐句拆译
把官方范文的正文全部句子按「第 1 句」「第 2 句」……逐句拆解（每句不漏！），每句拆 2 到 4 行「英文短块 → 中文意思」，紧接着一行「整句：这句对应的完整中文意思。」（句与句之间空一行）。

范文逐词带读
把官方范文里的核心正文句子按「第 1 句」「第 2 句」……逐词拆开，严格「一词一行、行行紧贴」，每行「单词 谐音 中文」（生词/考点词行末附「｜ 记：≤14字速记」）。

写作万能模板与搭配
拎出 4 到 6 条考场直接能套进同类作文的万能句型或高频搭配，每条一行「英文模板/搭配 ＝ 中文用途（附套用提示）」。

一句话钉牢：用一句极简大白话口诀把这类应用文的格式和万能骨架钉死。`;

const WRITING_READ_LAYOUT = `这是一道「英语 B 级应用文写作」题，用户点了「带读+搭配」，想把官方范文全篇读透并背下套句。
固定按下面 4 个板块输出（板块之间空一行 \\n\\n，严禁用 Markdown 的 # / ** / 表格，严禁写「消化好发继续」「上一轮已核对」「加油」等聊天话）：

开头一句：写「这篇官方范文帮你逐句带读翻透，再拎出考场直接能套的 B 级高频搭配。」下一行写出：
完整官方范文：<standard>

范文逐词带读
把官方范文正文全部句子按「第 1 句」「第 2 句」……逐词拆开，严格「一词一行、行行紧贴」，每行「单词 谐音 中文」（小词不漏，生词/亮点词行末附「｜ 记：≤14字速记」）。

范文逐句拆译
覆盖官方范文全部句子，每句标「第 N 句」，按意群写「英文短块 → 中文」，紧接着一行「整句：完整中文意思。」（句与句之间空一行）。

B级固定搭配扩展
补充 4 到 6 条考场写作高频实用搭配与万能句型，每条一行「英文搭配 ＝ 中文意思（附套用要点）」。

一句话钉牢：用一句极简大白话口诀钉牢这类作文的套路。`;

const isLongPassageKind = qkind => qkind === 'translate-passage' || qkind === 'writing';
function layoutFor({mode = 'full', qkind = ''} = {}) {
  const readOnly = mode === 'read';
  if (qkind === 'translate-passage') return readOnly ? TRANSLATE_PASSAGE_READ_LAYOUT : TRANSLATE_PASSAGE_LAYOUT;
  if (qkind === 'writing') return readOnly ? WRITING_READ_LAYOUT : WRITING_LAYOUT;
  return readOnly ? READ_LAYOUT : LAYOUT;
}

// 英语题和其他科目讲法不同：谐音、带读只用在英语；其他科目只写大白话思路。
const SUBJECTS = `科目差异：
- 英语题（B 级 / 四级 / 专升本英语）：严格按上面的模板输出。${STYLE}
- 数学、电工电子、C 语言、计算机网络：不用谐音、逐词带读和一块块大白话，只用「先看选项识考点 / 回题干秒杀 / 一句话钉牢」三小段大白话讲清考点和关键一步。`;

const READ_SUBJECTS = `科目差异：
- 英语题（B 级 / 四级 / 专升本英语）：严格按上面的带读模板输出。${STYLE}
- 数学、电工电子、C 语言、计算机网络：不用谐音和逐词带读，直接大白话翻译题干条件并补充 2 到 3 条同类必背公式或结论。`;

export function explainRules({brief = false, mode = 'full', qkind = '', dir} = {}) {
  const readOnly = !brief && mode === 'read';
  const longKind = !brief && isLongPassageKind(qkind);
  const voice = loadVoice({dir});
  const rules = (readOnly || longKind)
    ? voice.rules.filter(r => !/先看选项识考点|回题干秒杀|答对也必讲|做题两步|秒杀抢分战法|英译汉单选|词形填空|单选铁律/.test(r))
    : voice.rules;
  const steps = (readOnly || longKind) ? [] : voice.steps.filter(s => !/逐词带读|斜线断句/.test(s));
  const lines = [BASE, '', '【碧琪的态度与口吻】', '- ' + addressRule(voice.address), ...voice.soul.map(r => '- ' + r), ''];
  if (rules.length) {
    const label = longKind
      ? '【用户定的辅导口味（排版严格按下面的整段/范文全篇逐句精讲模板执行，严禁漏句）】'
      : readOnly
        ? '【用户定的辅导口味（排版严格按下面的 3 板块带读模板执行）】'
        : '【用户定的辅导口味（排版严格按下面的 6 板块模板执行）】';
    lines.push(label, ...rules.map(r => '- ' + r), '');
  }
  if (steps.length) lines.push('【讲法步骤】', ...steps.map(r => '- ' + r), '');
  lines.push(readOnly ? READ_SUBJECTS : SUBJECTS, '');
  if (brief) lines.push('这是整套卷子交卷后的错题回看，一次要看很多题：每题只写「答错了，正确答案是…」+「回题干秒杀」+「一句话钉牢」，总长不超过 150 字。', '');
  else lines.push(layoutFor({mode: readOnly ? 'read' : 'full', qkind}), '');
  lines.push(CONTRACT);
  return lines.join('\n');
}

// 讲解长度：普通题上限 2800 字；整段翻译 / 写作需逐句拆译 + 全文逐词带读，放宽到 9000 字避免腰斩后半段。
export function validVoicedExplain(v, {brief = false, long = false} = {}) {
  const maxLen = brief ? 650 : long ? 9000 : 2800;
  const text = String(v?.text ?? '').replace(/\u0000/g, '').replace(/\\n/g, '\n').trim().slice(0, maxLen);
  return text.length >= 8 ? {text} : null;
}

// 会长篇思考的内置模型（如 hy4free）面对完整口吻提示词，常把 token 全花在思考上、正文为空。
// 一次截断后，接下来半小时直接用精简提示词；首次遇到时由 modelJson 在重试里自动切换。
const COMPACT_BASE = `你是碧琪，学习台里陪用户做题的学习搭档。用户刚做完一题，请写在答题卡上，用户不能再作答，不要出新题。
输入 JSON：question 题干，options 选项，standard 标准答案，note 官方解析，yours 用户的答案（做对时为空），correct 是否做对，qkind 题型，point 考点，base 括号原词。`;
let compactAt = 0;
export const useCompactExplain = () => Date.now() - compactAt < 30 * 60 * 1000;
export const markCompactExplain = () => { compactAt = Date.now(); };
export function compactExplainRules({brief = false, mode = 'full', qkind = '', dir} = {}) {
  const readOnly = !brief && mode === 'read';
  return [COMPACT_BASE, addressRule(loadVoice({dir}).address),
    '要求：以 standard 为准，note 有内容就用上。不念条文，不写「加油」「消化好发继续」。',
    brief
      ? '这是整套卷子交卷后的错题回看：每题只写答案信号、错因和一句口诀，总长不超过 150 字。'
      : `${layoutFor({mode: readOnly ? 'read' : 'full', qkind})}\n英语题：${STYLE}其他科目只写大白话解题思路和一句话钉牢。`,
    '只输出 JSON：{"text":"讲解"}，不要 Markdown 符号和表格。'].join('\n');
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

export const EXPLAIN_VERSION = 10;
export const SUBJECTIVE_EXPLAIN_VERSION = 11;
export const explainVersionFor = qkind => (isLongPassageKind(qkind) ? SUBJECTIVE_EXPLAIN_VERSION : EXPLAIN_VERSION);
export const isExplainRules = rules => /^你是碧琪，在?学习台里陪(?:用户|先生)做题的学习搭档。/.test(String(rules || ''));
export const _resetVoiceCache = () => { cache = {at: 0, key: '', value: null}; };
