// 活儿卡：按这条消息是哪种活，把这种活最要紧的几步直接放到消息旁边。
//
// 为什么要有：常驻手册里写了「先读对应的打法」，小模型经常不读就动手（11-01、11-11 的隔离实测
// 都看到了）；让它多花一轮去读一份 8 千字的文件，它读了也记不全。卡片只有几百字、只讲这一种活、
// 不用它自己决定要不要看。大模型照卡片最后一行去读完整打法，做得更深。
//
// 纯函数，不依赖 OpenClaw，可单测。卡片的文字和 personas/*/playbooks 里的打法是同一套做法的
// 短版；改打法时一起改。证据门禁和档位不在这里，这里只提醒、不拦。
import path from 'node:path';

// 写代码这一种活再分六种情况：做法差别大，混成一张卡小模型分不清该照哪条做。
const CODE_SITUATIONS = Object.freeze([
  ['review', /(?:帮我|给我)?(?:看看|看一下|检查|审查|review|评审|讲讲|讲一下|解释|读一下|读懂).{0,12}(?:代码|程序|脚本|函数|项目|仓库|实现|写得|pr\b)|(?:代码|程序|脚本|函数).{0,10}(?:有没有问题|有什么问题|对不对|怎么样|什么意思|是干嘛的|在干什么)|code\s*review/i],
  ['test', /(?:写|补|加|添加|完善).{0,8}(?:测试|单测|单元测试|用例)|测试覆盖|\b(?:unit\s*tests?|pytest|jest|vitest)\b/i],
  ['refactor', /重构|整理.{0,6}(?:代码|结构)|拆分|拆成|抽出来|抽成|简化.{0,6}(?:代码|逻辑)|优化.{0,6}(?:代码|结构|写法)|去重|refactor|clean\s*up/i],
  ['bug', /报错|出错|错误|bug|崩溃|闪退|跑不起来|运行不了|打不开|没反应|不生效|不工作|不对|失败|异常|修一?下|修复|修好|报\s*\d{3}|为什么|怎么回事|只.{0,4}一次|冲突|卡住|死循环|traceback|exception|error|undefined|\bnull\b|\bfix\b|\bfail/i],
  ['new', /(?:写|做|开发|搭|创建|生成|新建|弄|搞|整)(?:一个|个|一套|一份)?.{0,14}(?:脚本|程序|工具|小工具|命令行|爬虫|插件|服务|接口|项目|机器人|bot|cli|api)|实现(?:一个|个)|从零|从头|\bimplement an?\b/i],
  ['change', /./],
]);

export function codeSituation(prompt = '') {
  const text = String(prompt || '');
  return CODE_SITUATIONS.find(([, re]) => re.test(text))?.[0] || 'change';
}

const CARDS = Object.freeze({
  'code.change': {
    title: '在已有项目里改代码',
    book: 'coding.md',
    steps: [
      '先看现场：列顶层目录，读包清单里的脚本段和 README，找到真实的启动、测试命令；读不到就说没找到，不编命令。有 git 先 git status。',
      '改之前先用 run_tests 把现有测试跑一遍：它会记下基线（原来过几条、失败几条），改完再跑时直接告诉你哪些是这次弄坏的。',
      '用 code_search 从用户看得见的字（界面文字、报错原文、接口地址）搜到要改的地方；大文件先用它的 outline 看大纲。把那个函数完整读完，再读一个调用它的地方。',
      '找一个项目里已有的同类写法照着写：命名、目录、报错方式、用的库都跟它一样。库的用法先查装的版本，不凭记忆。',
      '一次改一件事，改完就跑。改已有文件用 code_edit：先读到要改的那段，照原文给 old_text；对不上时它会给出文件里最像的一段，照那段重来，不整份重写别人的大文件。',
      '改函数的参数、返回值或名字之前，先用 code_refs 查出它的定义和每个调用处，一处不漏地改掉；同类问题有几处就找出几处。',
      '改完先用 code_check 查到没有错误；最后一次改动之后必须再用 run_tests 跑一次（没有测试就真运行一次）并读完结果，照真实条数汇报。只做到哪一步就只说到哪一步，不说「应该可以」。',
    ],
  },
  'code.new': {
    title: '从零写一个程序',
    book: 'coding.md',
    steps: [
      '技术我来选：用户电脑上最容易跑起来的那个（双击能开的网页，或 Python 脚本）；交付时一句话说为什么。不问用户用什么语言。',
      '一个项目一个文件夹，代码、测试、数据分开；git init；密钥和依赖目录写进 .gitignore。',
      '先跑通最短的一条路（能输入、能看到结果、关掉再开数据还在），验证过再一样一样加功能，每加一样跑一次。',
      '依赖能不加就不加；要加就写进依赖清单并装进项目自己的环境，不往系统里装。',
      '有计算和数据处理就写测试：正常的、空的、边界上的、格式不对的；故意改错一处确认测试会失败。',
      '路径用库来拼，读写文件写明 utf-8，Mac 和 Windows 都要能跑。',
      '配一个双击就能启动的文件和十行以内的 README，自己照着从头启动一遍再交。',
    ],
  },
  'code.bug': {
    title: '修 bug',
    book: 'debugging.md',
    steps: [
      '先复现：自己把出错的那一步跑一遍，亲眼看到错误。复现不了先别改。',
      '读完整的报错原文：Python 看最后一行和最后一个指向自己代码的位置；Node 看第一个 Error。',
      '只想一个最可能的原因，用最小的动作验证它（打印那个变量、单跑那一行、查装的版本），验证对了再改。',
      '改根因，只改这一处。不用 try/catch 或默认值把错误盖住，不为了变绿去改测试或跳过测试。',
      '重跑出错的那一步看到成功，再用 run_tests 跑全部测试，确认没有新弄坏的；能加一条防止它再坏的测试就加。',
      '用 code_search 搜一下项目里有没有同样写法的地方，一起改或者告诉用户在哪。',
      '同一个办法失败两次就换思路：查官方文档、读库的源码、缩成最小的例子。',
    ],
  },
  'code.test': {
    title: '写测试、补测试',
    book: 'coding.md',
    steps: [
      '先看项目里已有的测试怎么写、放在哪，照它的样子写；先用 run_tests 把现有测试跑一遍。',
      '先读懂被测的代码真正的行为，再写；测的是「应该怎样」，不是把现在的输出抄下来当答案。',
      '每个函数至少覆盖：正常的、空的、边界上的（0、负数、超长、重复）、格式不对的、出错的那条路。',
      '每条测试只验一件事，名字写清在验什么；不依赖网络、当前时间和别的测试留下的数据。',
      '写完故意把被测代码改错一处，确认测试真的会失败，再改回来。',
      '测试暴露出代码的真问题时，告诉用户并修代码，不把测试改成迁就错误的样子。',
      '最后用 run_tests 跑全部测试，报出通过和失败的真实条数。',
    ],
  },
  'code.refactor': {
    title: '整理、重构代码',
    book: 'coding.md',
    steps: [
      '行为一点不能变。先用 run_tests 跑测试，全绿才开始；没有测试就先给要动的部分补几条，或者记下一组真实的输入输出当对照。',
      '先说清这次整理的范围和不动什么；不借机加功能、升级依赖、改格式。',
      '一小步一小步来（改一个名字、抽一个函数、挪一个文件），每一步之后都用 run_tests 跑一次，出现「这次弄坏的」就先修回来。',
      '改名和挪文件之前用 code_refs 查出每个引用它的地方，改完再查一次旧名字确认没有剩下的；再用 code_check 查一遍。',
      '删代码之前用 code_refs 确认确实没人用；拿不准就留着并告诉用户。',
      '做完对比整理前后的输出是一样的，再读一遍全部改动。',
    ],
  },
  'code.review': {
    title: '看代码、讲代码',
    book: 'code-review.md',
    steps: [
      '能跑就先跑一遍（run_tests，或者一组普通输入），跑出来的错比读出来的猜测可靠。',
      '按顺序看：对不对 → 边界（空的、超大的、重复的、格式不对的）→ 会不会弄坏别的 → 安全 → 错误处理 → 可读性。',
      '只报有把握的问题：每个都要说得出「什么输入下、会出什么错」，最好写两三行例子真的跑出来。',
      '看着怪但没错的、只是写法不同的，不报成错。认真看过没发现问题就说没发现，不凑数。',
      '每个问题给三样：在哪（文件和行）、怎么会出错、怎么改（给出改好的那几行）。按严重程度排。',
      '用户只让看、没让改：只指出，不动他的文件。',
    ],
  },
  debugging: {
    title: '排错',
    book: 'debugging.md',
    steps: [
      '先复现，亲眼看到错误；读完整的报错原文，记下关键的一两行。',
      '只想一个最可能的原因，用最小的动作验证它，对了再改；错了换下一个。',
      '「找不到命令」「没有这个属性」「不是函数」这类先查装没装、装的是哪个版本，不猜。',
      '改根因，只改这一处；不把错误盖住。',
      '重跑出错的那一步看到成功才算好了。',
      '同一个办法失败两次就换思路，不原地重试第三次。',
      '跟用户说的时候用大白话：是什么原因、我怎么修的、现在好了没有。',
    ],
  },
  web_ui: {
    title: '做网页、界面、小工具',
    book: 'web-and-ui.md',
    steps: [
      '做成双击就能打开的页面，不依赖外网（库下到本地）；已有风格就在那套风格里做。',
      '用真内容做，不用「标题一」「示例文字」占位。',
      '先做出能点的最小一版，跑通主要的那个操作，再加别的。',
      '做完用截图工具截桌面和手机两种宽度，把截图打开亲眼看；同时看浏览器控制台有没有红字。',
      '把主要的操作真的点一遍：输入、保存、刷新后数据还在、输错时有提示。',
      '按 playbooks/design-review.md 的看法至少改一轮；自己看着别扭的不交。',
      '交付时说怎么打开、数据存在哪，附上截图。',
    ],
  },
  data_charts: {
    title: '处理数据、做图表',
    book: 'data-and-charts.md',
    steps: [
      '先看数据本身：读前几行，数一数行数，看每一列是什么、有没有空的、重复的、格式不统一的。',
      '原文件不动，结果另存一份新文件。',
      '清洗的每一步都说得出规则；删掉或改掉了多少行要数出来告诉用户。',
      '算出来的总数拿另一种算法或手算几行对一遍；数字不凭感觉写。',
      '图表的标题写结论（「三月支出比二月多两成」），不写题目；坐标轴有单位；一张图只讲一件事。',
      '生成的表格和图打开亲眼看：中文有没有变方框、数字对不对得上。',
    ],
  },
  automation: {
    title: '自动化、批量处理',
    book: 'automation.md',
    steps: [
      '先在一份复制出来的小样上跑，不直接动用户的真文件。',
      '会删除、移动、覆盖的操作，先只打印「打算怎么动」的清单，看过没问题再真做。',
      '批量处理要能重复跑：跑到一半断了，再跑一次不会重复处理、不会弄乱。',
      '每个文件单独处理、单独记成败；一个出错不影响其他的，最后报出成功几个、失败几个、失败的是哪些。',
      '说了「自动」就要真的自动：关掉界面后还在跑的才算，要验证这一点。',
      '常驻后台、开机自启这类要先问用户，并给一键停止和卸载的办法。',
    ],
  },
});

export const CARD_IDS = Object.freeze(Object.keys(CARDS));

// 活儿分类器（work-kinds.mjs）是给档位和证据门禁用的，认得保守：「实现一个 LRU 缓存」「加个暗色模式」
// 「add pagination to the users endpoint」都会落到「简单问答」（11-11 试了 19 条常见的编程请求，10 条如此）。
// 门禁那边宁可漏认；卡片只是提醒，认错一次的代价是多几百字，所以项目模式里这里认得宽一些。
const STRONG_CODE = /代码|函数|接口|组件|仓库|源码|单测|单元测试|重构|编译|构建|依赖|报\s*\d{3}|合并冲突|\b(?:repo|endpoint|api|bug|refactor|implement|function|class|component|commit|merge|branch|unit\s*tests?)\b|\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|c|h|cpp|cs|rb|php|vue|svelte|sql|sh|ps1|json|ya?ml|toml|css|scss|html)\b/i;
const LOOSE_CODE = /脚本|程序|项目|功能|实现|模式|页面|按钮|循环|变量|数组|字段|数据库|命令行|README|跑起来|升级到|迁移|\b(?:add|fix|update|remove|rename|write|create|build|run|test|tests|script|page|button|feature|loop|error)\b/i;
const CHANGE_VERB = /加个|加一个|加上|添加|新增|改一?下|改成|改为|换成|去掉|删掉|实现|写个|写一个|做个|做一个|升级|迁移|优化|修|解决|怎么跑|为什么|怎么回事|\b(?:add|fix|update|remove|rename|write|create|build|implement|make|why|how)\b/i;
const CODE_ADJACENT = new Set(['code', 'debugging', 'automation', 'web_ui', 'app_game_ai']);

// 这条消息该给哪张卡。只管和写代码最近的几种活；别的种类返回空，行为不变。
export function pickCard(kinds = [], prompt = '', {mode = ''} = {}) {
  const text = String(prompt || '');
  if (mode === 'project' && text.trim().length >= 4) {
    const unsure = !kinds.length || kinds.every(kind => kind === 'simple' || kind === 'pending');
    // 没认出种类：说法像在要改代码的，按写代码给卡。
    if (unsure && (STRONG_CODE.test(text) || (LOOSE_CODE.test(text) && CHANGE_VERB.test(text)))) return `code.${codeSituation(text)}`;
    // 认成了别的活（「给这个项目加一个导出 CSV 的功能」被认成做表格），但明说了是在代码里动手。
    if (!unsure && !kinds.some(kind => CODE_ADJACENT.has(kind)) && STRONG_CODE.test(text) && CHANGE_VERB.test(text)) return `code.${codeSituation(text)}`;
  }
  for (const kind of kinds) {
    if (kind === 'code') return `code.${codeSituation(text)}`;
    if (CARDS[kind]) return kind;
  }
  return '';
}

const seenBySession = new Map();
const MAX_SESSIONS = 400;

// 压缩之后卡片正文已经不在上下文里了，下一条消息重新给完整版。
export function forgetCards(sessionKey = '') {
  if (sessionKey) seenBySession.delete(sessionKey);
  else seenBySession.clear();
}

export function workCardBlock(kinds = [], prompt = '', {mode = '', sessionKey = '', playbookRoot = ''} = {}) {
  if (mode === 'none') return '';
  const id = pickCard(kinds, prompt, {mode});
  const card = CARDS[id];
  if (!card) return '';
  const book = playbookRoot ? path.join(playbookRoot, 'playbooks', card.book) : `playbooks/${card.book}`;
  let seen = null;
  if (sessionKey) {
    seen = seenBySession.get(sessionKey);
    if (!seen) {
      if (seenBySession.size >= MAX_SESSIONS) seenBySession.delete(seenBySession.keys().next().value);
      seenBySession.set(sessionKey, seen = new Set());
    }
  }
  // 同一个会话里同一张卡只给一次完整版，之后只提一行，省下每轮重复的字数。
  if (seen?.has(id)) return `【这件活：${card.title}】照这个会话前面给过的那张要点卡做（先看现场、小步改、改完真的跑过再说完成）。完整做法：${book}`;
  seen?.add(id);
  const lines = [`【这件活：${card.title}】系统按这条消息认出的种类给的要点，照着做；这是做法，不用念给用户听。`];
  card.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  lines.push(`要做深、或者碰到上面没写的情况，读完整做法：${book}`);
  return lines.join('\n');
}
