// 活儿种类：先认清一条请求是「哪一种活」，再按这种活的打法定流程、定「做完」要看到的证据。
// 两套档位都用这里——四档「思考强度」（index.mjs：运行单、证据门禁、子任务）和九档「思考等级」的
// 自补档（reasoning.mjs：独立起草的用途、审稿员看什么）。纯函数，不依赖 OpenClaw，可单测。
//
// 证据只认工具记录（index.mjs captureVerificationEvidence 存下的 {name, kind, params, output, ok, sequence}），
// 不认回复里的自述。拿不准的信号宁可不认：漏认只会让碧琪多验一步，错认会放过假完成。

const kind = (id, label, playbooks, extra = {}) => Object.freeze({id, label, playbooks: Object.freeze(playbooks), hands: false, solver: 'answer', ...extra});

// 种类表：和 personas/*/playbooks 的 18 份打法一一对应（crafts.md 是没见过的活的兜底）。
export const WORK_KINDS = Object.freeze({
  code: kind('code', '写代码 / 改程序', ['web-and-ui.md', 'debugging.md'], {hands: true, solver: 'checklist'}),
  web_ui: kind('web_ui', '网页 / 界面 / 小工具', ['web-and-ui.md', 'design-review.md'], {hands: true, solver: 'checklist'}),
  app_game_ai: kind('app_game_ai', 'App / 小游戏 / 接 AI', ['apps-games-ai.md'], {hands: true, solver: 'checklist'}),
  automation: kind('automation', '自动做事 / 批量处理', ['automation.md'], {hands: true, solver: 'checklist'}),
  video_motion: kind('video_motion', '视频 / 动画 / 配音', ['motion-and-video.md'], {hands: true, solver: 'checklist'}),
  document: kind('document', 'PPT / Word / PDF 文档', ['documents-and-slides.md'], {hands: true, solver: 'checklist'}),
  data_charts: kind('data_charts', '表格 / 数据 / 图表', ['data-and-charts.md'], {hands: true, solver: 'checklist'}),
  image_print: kind('image_print', '海报 / 图片 / 印刷品', ['images-and-print.md'], {hands: true, solver: 'checklist'}),
  writing: kind('writing', '文案 / 文章 / 翻译', ['writing.md'], {solver: 'draft'}),
  ideas: kind('ideas', '点子 / 起名 / 策划', ['ideas.md'], {solver: 'draft'}),
  debugging: kind('debugging', '报错 / 跑不起来', ['debugging.md', 'environment.md'], {hands: true, solver: 'checklist'}),
  environment: kind('environment', '装工具 / 这台电脑', ['environment.md', 'machine.md'], {hands: true, solver: 'checklist'}),
  publish: kind('publish', '放到网上 / 分享链接', ['publish-and-share.md'], {hands: true, solver: 'checklist'}),
  standard_answer: kind('standard_answer', '有标准答案的难题', []),
  tradeoff: kind('tradeoff', '方案取舍 / 选哪个', ['ideas.md']),
  fact_check: kind('fact_check', '查事实 / 最新消息', []),
  tutoring: kind('tutoring', '讲题 / 辅导', []),
  craft: kind('craft', '其他动手的活', ['crafts.md'], {hands: true, solver: 'checklist'}),
  simple: kind('simple', '简单问答', []),
});
export const KIND_IDS = Object.freeze(Object.keys(WORK_KINDS));
// 平分时按这个顺序取主活：越具体越靠前。
const SPECIFICITY = ['debugging', 'video_motion', 'document', 'data_charts', 'image_print', 'app_game_ai', 'automation', 'web_ui',
  'environment', 'publish', 'code', 'writing', 'ideas', 'tradeoff', 'fact_check', 'standard_answer', 'tutoring', 'craft', 'simple'];
const TEXT_KINDS = new Set(['writing', 'ideas', 'tradeoff', 'fact_check', 'standard_answer', 'tutoring', 'simple']);
// 「做出来的东西」：和发布、排错同时出现时，主活是要做的那件东西。
const PRODUCT_KINDS = new Set(['web_ui', 'app_game_ai', 'document', 'video_motion', 'image_print', 'data_charts', 'code', 'automation']);

export const isTextKind = (id) => TEXT_KINDS.has(id);
export const isHandsOnKind = (id) => Boolean(WORK_KINDS[id]?.hands);
export const kindLabel = (id) => WORK_KINDS[id]?.label || '';
export const isWorkKind = (id) => Object.prototype.hasOwnProperty.call(WORK_KINDS, id);

// 旧的五类（index.mjs classifyDeliberationTask）对应到新种类：旧运行状态、无限制模式都按这张表。
const LEGACY = {implementation: 'code', standard_answer: 'standard_answer', tradeoff: 'tradeoff', fact_check: 'fact_check', simple: 'simple'};
export function legacyKinds(taskType = '') {
  return LEGACY[taskType] ? [LEGACY[taskType]] : [];
}

// ---------- 分类 ----------

const p = (re, w) => ({re, w});
const PATTERNS = {
  publish: [
    p(/(?:发|放|部署|上传|挂|传|托管)(?:布)?(?:到|上)(?:网上|网站上?|服务器|线上|公网|云上?|github|gitee|vercel|netlify|cloudflare)/i, 5),
    p(/(?:域名|云服务器|服务器上|vps|github ?pages|vercel|netlify|cloudflare ?pages|内网穿透|ngrok|公网(?:访问|能打开)?|上线)/i, 3),
    p(/(?:给|发给|让)(?:我的)?(?:外地的|远方的|老家的)?(?:朋友|别人|同学|客户|同事|家人|爸妈|父母|爸爸|妈妈|家里人|老师|大家|所有人|任何人).{0,10}(?:链接|网址|打开|访问|看(?:到|看)?)/, 4),
    p(/(?:生成|给我|发我|弄|做|变)(?:成)?(?:一个|个)?(?:分享|公开|在线)?(?:链接|网址)(?!.{0,4}(?:里|中|上))/, 3),
    p(/\b(?:deploy|hosting|host (?:it|this|my)|publish (?:it|the site|my site)|put (?:it|this|my [\w-]+(?: site| page)?) online|make (?:it|this) public|anyone can (?:open|see|access)|share(?:able)? link)\b/i, 4),
  ],
  automation: [
    p(/(?:每天|每晚|每早|每周|每月|每小时|每隔|定时|定期|开机(?:自动|就)|到点(?:就)?|按时)/, 3),
    p(/自动(?:地)?(?:整理|备份|下载|发送|发|提醒|签到|同步|处理|运行|跑|执行|归类|分类|清理|改名|重命名|抓|监控|转换|压缩|回复|汇总|生成)/, 4),
    p(/(?:批量|一键)(?:改名|重命名|处理|转换|转格式|压缩|下载|导出|替换|整理|加水印|生成|改尺寸|裁剪)/, 4),
    p(/(?:盯着|监控|监听|守着)(?:这个|我的)?(?:文件夹|目录|网页|网站|价格|邮箱|库存)/, 4),
    p(/(?:爬|抓取|抓一下|抓下|抓|采集)(?:一下)?.{0,6}(?:网页|网站|数据|价格|信息|评论|商品|评分|新闻|榜单)|爬虫/, 5),
    p(/(?:批量|一批|这些|所有|全部|整个文件夹).{0,6}(?:压缩|裁剪|改尺寸|调色|加水印|转格式|转成|转换|改名)|(?:压缩|裁剪|改尺寸|加水印|转格式|转换|改名)(?:一下)?(?:这些|所有|全部|一批)/, 4),
    p(/(?:后台(?:一直|常驻)?(?:运行|跑着?)|常驻|守护进程|launchd|launchctl|crontab|计划任务|定时任务|schtasks|开机启动)/i, 3),
    p(/\b(?:cron|scheduled?|every (?:day|morning|night|hour|week)|automate|automatically|batch[- ]rename|watch (?:the|a|my) folder|scrape|scraping|scraper)\b/i, 3),
  ],
  video_motion: [
    p(/(?:视频|视屏|短片|片头|片尾|宣传片|vlog|剪辑|剪个|剪一下|剪成|剪掉|配音|配乐|字幕|动画片|mg动画|转场|短视频|抖音视频|渲染成|录屏|旁白|口播|卡点|混剪)/i, 4),
    p(/(?:动画|动图|gif)/i, 2),
    p(/\b(?:video|subtitles?|captions? (?:for|on) (?:the|my) (?:video|clip)|voice ?-?over|intro clip|motion graphics?|animation|render (?:a|the) (?:video|clip)|mp4)\b/i, 4),
  ],
  document: [
    p(/(?:ppt|pptx|幻灯片|演示文稿|课件|keynote|汇报材料|路演稿|slides?\b|deck\b)/i, 5),
    p(/(?:word文档|word 文档|docx|简历|论文排版|排版成|公文|红头文件|通知书|合同|说明书|标书|申请书|证明信|pdf|讲义|宣传册)/i, 4),
    p(/(?:报告|文档|手册|方案书|计划书)/, 2),
    p(/\b(?:resume|cv\b|word doc(?:ument)?|pdf|report (?:document|in word))\b/i, 3),
  ],
  data_charts: [
    p(/(?:excel|excle|exel|xlsx|xls\b|csv|表格|电子表|统计|图表|预算|收支|开支|支出|花销|开销|对账|柱状图|折线图|饼图|散点图|看板|仪表盘|透视表|汇总|求和|平均(?:数|值|分)|中位数|账单|报表|成绩单?|销量|销售额|流水|工资表)/i, 4),
    p(/(?:数据(?!存|保存|放|丢|不丢|库))/, 2),
    p(/(?:算一下|算算|统计一下).{0,12}(?:多少|总共|一共|平均|占比|比例)/, 2),
    p(/\b(?:spreadsheet|chart|plot|graph|dashboard|pivot|pandas|csv|excel|average|sum up|statistics)\b/i, 3),
  ],
  image_print: [
    p(/(?:海报|封面|头像|logo|标志设计|图标|表情包|插画|配图|壁纸|名片|传单|菜单|邀请函|横幅|易拉宝|贺卡|明信片|宣传单|产品图|主图|头图|门头|招牌|贴纸|印刷|打印出来|印出来|出血)/i, 4),
    p(/(?:画一(?:张|幅|个)|生成(?:一张|一幅|几张)?(?:图|图片|照片)|做(?:一)?张图|p图|修图|抠图|换背景|去水印|改图)/i, 4),
    p(/(?:压缩|裁剪|改尺寸|调色|加水印|转格式|转成|去背景)(?:一下)?.{0,6}(?:图片|照片|图)/, 3),
    p(/\b(?:poster|logo|avatar|icon set|banner|flyer|business card|illustration|thumbnail|cover image|draw (?:a|an|me)|generate an image)\b/i, 4),
  ],
  app_game_ai: [
    p(/(?:小游戏|游戏|小程序|手机app|手机 app|安卓|ios|桌面软件|桌面应用|exe\b|浏览器插件|浏览器扩展|chrome ?插件|油猴|聊天机器人|群机器人|知识库|写作助手|ai ?助手|pwa)/i, 4),
    p(/(?:做|写|开发|搞)(?:一个|个|一款|款)?\s*(?:app|应用|软件|工具软件)/i, 4),
    p(/(?:插件|扩展程序|小程序|小游戏)/, 1),
    p(/接(?:入|上|一下)?(?:ai|大模型|gpt|chatgpt|deepseek|claude|gemini|豆包|文心|通义|模型|api)/i, 4),
    p(/\b(?:game|mini ?program|mobile app|desktop app|chrome extension|browser extension|chat ?bot|discord bot|telegram bot|electron|tauri)\b/i, 4),
  ],
  web_ui: [
    p(/(?:网页|网站|页面|主页|官网|落地页|个人站|博客|前端|html|css|登录页|导航栏)/i, 4),
    // 「记账」「待办」「计算器」默认按网页小工具做（crafts.md 活儿地图）；明说是脚本、表格、App 时让给那一种。
    p(/(?:小工具|计算器|记账|待办|todo|表单)/i, 3),
    p(/(?:界面|ui\b|布局|排版乱|响应式|手机上看|配色|好丑|太丑|难看|好看点|怪怪的|乱糟糟|按钮|字太小|对不齐)/i, 3),
    p(/\b(?:web ?page|website|landing page|front-?end|html|css|ui|layout|responsive|homepage|portfolio site)\b/i, 4),
  ],
  code: [
    p(/(?:改|修|加|写|实现|重构|优化|补|删掉|去掉)(?:一下|个|一个|几个)?(?:这个|这段|那个|我的)?(?:函数|代码|脚本|接口|功能|模块|逻辑|测试|单元测试|类|方法|正则|sql|算法)/i, 4),
    p(/(?:写代码|改代码|代码修改|写程序|编程|写个程序|写一个程序|python脚本|python 脚本|shell ?脚本|命令行工具|cli 工具|单元测试|测试用例|自动化测试|端到端测试|e2e 测试|写测试|加测试|补测试|跑测试|重构)/i, 4),
    p(/(?:代码|函数|脚本|程序|接口|api\b|bug|正则|sql\b|python|javascript|typescript|java\b|c\+\+|golang|rust\b|node\b|npm\b|git\b)/i, 2),
    p(/\b(?:refactor|implement|unit tests?|write (?:a|the) (?:script|function|program|test)|fix (?:the|this|a) (?:bug|function|code|test))\b/i, 4),
    p(/(?:正则|函数|代码|脚本|sql|接口|方法).{0,12}(?:不对|有问题|写错|改改|改一下|改下|优化一下|重写)/i, 4),
    p(/(?:写|改|编写|实现)(?:一个|个|一段|段)?[^，。,.！？!?\s]{0,6}?(?:脚本|程序|函数)/, 5),
    p(/(?:调整|修改|改|更新|重构|优化|实现)[^。\n]{0,40}\.(?:m?js|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|sh|ps1|c|cc|cpp|h|rb|php)\b/i, 5),
    p(/(?:修复?|修好|修一下|解决|fix)(?:一下|掉)?(?:这个|那个|个|这几个)?.{0,8}?(?:bug|缺陷)|(?:运行|跑一下|跑跑)(?:相关)?测试/i, 5),
    p(/```/, 2),
  ],
  debugging: [
    p(/(?:报错|出错|错误提示|异常|崩溃|闪退|打不开|跑不起来|运行不了|启动不了|装不上|没反应|不动了|卡住了|卡死|白屏|黑屏|不显示|显示不出|结果不对|算错了|不对劲|失败了|一直失败|404|500 错误|连不上|traceback|stack ?trace)/i, 5),
    p(/\b(?:error|exception|failed|failing|crash(?:es|ed)?|doesn'?t work|does not work|not working|won'?t (?:start|open|run))\b/i, 3),
  ],
  environment: [
    p(/(?:装|安装|卸载|升级|更新)(?:一下|个|上|好)?\s*(?:python|node|nodejs|ffmpeg|git|java|jdk|软件|工具|插件|库|包|环境|驱动|浏览器|playwright|homebrew|brew|conda|pip|npm|字体|imagemagick|libreoffice|office)/i, 5),
    p(/(?:电脑|内存|硬盘|显卡|cpu|gpu|配置|这台|机器|芯片).{0,12}(?:能不能|够不够|跑得动|带得动|扛得住|会不会卡|卡不卡|行不行)|(?:能不能|够不够|跑得动|带得动|扛得住).{0,8}(?:电脑|内存|硬盘|显卡|配置)/i, 6),
    p(/(?:能不能装|能装吗|能(?:不能)?装.{0,12}(?:吗|么)|装得了|这台\s*(?:mac|电脑|机器|笔记本|windows|pc)|电脑(?:好|很|太|有点)?(?:卡|慢)|电脑(?:能不能|能否|够不够|扛得住|带得动|跑得动)|内存(?:够|不够|满)|硬盘(?:满|不够|快满|空间)|磁盘空间|清理(?:一下)?(?:空间|硬盘|电脑|缓存|垃圾|内存)|这台电脑|我的电脑|我这电脑|显卡|cpu|gpu|几核|什么芯片|配置(?:怎么样|够不够|如何))/i, 4),
    p(/\b(?:install|uninstall|upgrade (?:python|node|ffmpeg)|my (?:mac|computer|laptop|pc)|disk space|ram\b|free memory|is my (?:mac|computer|laptop) (?:fast|good|enough))\b/i, 4),
  ],
  writing: [
    p(/(?:文案|文章|小红书|公众号|朋友圈|微博|推文|邮件|演讲稿|讲稿|致辞|发言稿|主持词|祝福语?|贺词|情书|检讨|自我介绍|简介|标语|slogan|广告语|宣传语|诗|歌词|故事|小说|作文|周报|日报|月报|年终总结|工作总结|总结一下|帖子|道歉信|请假条|感谢信|推荐信|求职信|台词|脚本文案|口播稿)/i, 4),
    p(/(?:翻译|翻成|译成|译为|润色|改写|重写|校对|缩写|扩写|精简一下|改得?(?:更)?(?:通顺|口语|正式)|改成.{0,6}(?:口吻|语气|风格))/i, 5),
    p(/写(?:一|个|篇|段|封|首|份|几句)?.{0,6}?(?:话|文字|东西|段子|评论|回复)/, 2),
    p(/出\s*[0-9一二三四五六七八九十几]*\s*道.{0,10}题|出(?:一|几)?套(?:卷子|题)/, 4),
    p(/(?:写成|改成|分成|缩成|扩成)\s*[0-9一二三四五六七八九十两几]+\s*(?:段|句|行|点|条|部分)/, 4),
    p(/(?:恰好|正好|刚好|整整)\s*[0-9一二三四五六七八九十两百]+\s*个?(?:汉字|字|句|行|段)|每(?:一)?(?:行|句|段)[^。；\n]{0,10}[0-9一二三四五六七八九十]+\s*个?(?:汉字|字)|藏头/, 3),
    p(/\b(?:write|rewrite|polish|proofread|translate|essay|article|email|caption|copywriting|blog post|speech|poem|story|tweet)\b/i, 4),
  ],
  ideas: [
    p(/(?:起(?:个|一个|几个)?名(?:字)?|取(?:个|一个|几个)?名(?:字)?|想(?:个|几个|一个)?名字|店名|品牌名|昵称|网名|策划|活动方案|怎么玩|玩法|给点建议)/, 4),
    p(/(?:点子|主意|创意|灵感|脑暴|头脑风暴|选题|出几个|想几个|有什么想法)/, 5),
    p(/(?:帮我想想|想想|推荐几个|有什么好(?:的)?).{0,8}(?:去哪|哪里玩|玩什么|吃什么|礼物|活动|节目|主题)/, 4),
    p(/\b(?:name ideas|names? for|brainstorm|ideas? for|come up with|tagline ideas|plan (?:an|a) (?:event|party|trip))\b/i, 4),
  ],
  tradeoff: [
    p(/(?:取舍|利弊|优缺点|对比一下|比较一下|哪个(?:更)?(?:好|合适|适合|划算|值|靠谱)|选哪|怎么选|推荐哪|值不值|划不划算|还是.{1,16}(?:好|呢|合适|划算)|二选一|该买哪|该选哪|(?:买|选|用|学|去|换)[^，。,.!?！？]{1,12}还是[^，。,.!?！？]{1,12}$)/, 4),
    p(/哪(?:个|款|家|种|台|部)(?!.{0,4}(?:报错|打不开)).{0,8}(?:好|更好|值得|划算|合适|适合|靠谱|耐用)/, 4),
    p(/(?:比较|对比).{0,12}(?:成本|价格|优劣|好坏|区别|差异|哪个|方案|性价比)|(?:成本|价格|优劣|好坏|区别|差异|性价比).{0,6}(?:比较|对比)/, 4),
    p(/(?:方案|对比|比较)/, 1),
    p(/\b(?:compare|comparison|trade-?offs?|which (?:one|option|is better)|pros and cons|should i (?:buy|choose|pick|use)|vs\.?)\b/i, 4),
  ],
  fact_check: [
    p(/(?:查证|核实|是真的吗|真的假的|是不是真的|谣言|辟谣|出处|来源可靠|最新(?:的)?.{0,6}?(?:消息|版本|规定|政策|价格|进展|型号)|(?:目前|现在)(?:最新)?.{0,6}?(?:版本|型号)是(?:多少|什么|哪)|现在.{0,8}(?:多少钱|什么价|价格|汇率)|多少钱一(?:克|斤|个|两)|当前(?:价格|版本|政策)|什么时候(?:发布|上市|开始|截止|执行|实施)|官方(?:说|消息)|是否属实)/, 4),
    p(/\b(?:fact.?check|is it true|verify (?:whether|if|that)|latest (?:version|news|price)|how much does .{1,30} cost now)\b/i, 4),
  ],
  standard_answer: [
    p(/(?:解方程|求方程|方程组|证明|推导|逻辑题|数学题|奥数|概率|几何|数列|积分|导数|极限|求解|多少种(?:方法|情况)?|最优解|复杂度|标准答案|算出|计算(?!器|机)(?:一下|出)?|算一下|算算)/, 4),
    p(/\d+\s*[+\-×x*/÷^]\s*\d+/, 2),
    p(/(?:怎么|如何)(?:算|计算|求解?|解)(?!决)/, 4),
    p(/\b(?:prove that|solve for|calculate|derive|probability|equation|integral|derivative)\b/i, 4),
  ],
  tutoring: [
    p(/(?:讲讲|讲一下|讲解|给我讲|怎么做|怎么解|这题|这道题|不懂|没听懂|没看懂|为什么是|什么意思|教我|教一下|复习|知识点|考点|错题|出(?:几)?道题|练习题|背单词|记单词|考试|备考|专升本|四级|六级|b级)/i, 4),
  ],
};

const GREETING = /^(?:你好|您好|在吗|在不在|谢谢|多谢|谢啦|好的|好|嗯+|哦+|噢+|ok|okay|收到|早上好|早安|中午好|下午好|晚上好|晚安|早|拜拜|再见|哈+|嘿|hi|hello|hey|thanks?|thank you)[!！。.~～\s]*$/i;
const META_QUESTION = /^(?:你是谁|你叫什么|你是什么模型|你用的什么模型|现在几点|几点了|今天(?:几号|星期几|周几)|你能做什么|你会什么|(?:你)?(?:会|能|可以)(?:不会|不能)?(?:做|写|画|剪|弄|帮我做)[^，。,.!?！？]{0,10}(?:吗|么|不))[？?!！。\s]*$/;
// 「我想学剪辑，从哪开始」是在问怎么学，不是让碧琪动手。
const LEARN_ADVICE = /(?:想学|怎么学|从哪(?:里)?开始|入门|学习路线|有什么(?:书|课|教程)推荐)/;
const TIER_QUESTION = /(?:基础档|加强档|全开档|长跑档|思考强度|思考等级|档位|max档|ultra档|adaptive)[^。！？!?\n]{0,16}(?:是什么|什么意思|啥意思|区别|有什么用|怎么用|该选|选哪|有啥不同|哪个好|[？?])/i;
const CONTINUATION = /^(?:(?:好|好的|可以|对|嗯|明白了|收到|ok)[，,、\s]*)?(?:继续|接着(?:做|来)?|往下|做下去|继续完成|go on|continue)(?:吧|啊|呀)?[！!。,.\s]*$/iu;
const WRITING_DELIVERABLE = /(?:文案|配文|文章|讲稿|演讲稿|发言稿|口播稿|邮件|(?:道歉|感谢|推荐|求职)信|写(?:一|个|段|篇|封|条|几)|翻译|润色|\b(?:write|copy(?:writing)?|caption|email|article)\b)/i;
const NEGATED_CLAUSE = /(?:不要|别|无需|不用|不需要|不必|禁止|千万别|先别|暂时不)[^。！？!?；;，,\n]{0,40}/g;
const MAKE_PRODUCT = /(?:做|写|开发|搭|建|生成|制作|弄)(?:一个|个|一份|份|一套|套|一条|条)?.{0,8}?(网页|网站|页面|主页|官网|app|应用|小程序|游戏|ppt|幻灯片|视频|海报|表格|图表|小工具)/i;
const PRODUCT_NOUN = [[/网页|网站|页面|主页|官网|小工具/, 'web_ui'], [/app|应用|小程序|游戏/, 'app_game_ai'], [/ppt|幻灯片/, 'document'],
  [/视频/, 'video_motion'], [/海报/, 'image_print'], [/表格|图表/, 'data_charts']];
// 「把做好的小游戏挂到网上」「这个相册网页」：东西已经有了，要做的是别的事（发布、排错），不是再做一个。
const DONE_PRODUCT = /(?:做|写|弄|搞|生成|制作)(?:好|完)了?的|(?:这个|我的|现有的|已有的)(?:相册|作品集)?(?:网页|网站|页面|小游戏|游戏|作品集|相册|app|小程序|小工具)/i;
const ACTION_HINT = /(?:帮我|给我|替我|请)?(?:做|弄|搞|生成|制作|整|出)(?:一个|个|一份|份|一套|套|一张|张|一下)?[一-龥a-z]{1,12}/i;
const ATTACH_EXT = /(?:\[media attached:[^\]\n]*?|<file\b[^>]*?name="[^"]*?|(?:^|[\s"'(（])(?:\/|~\/|[A-Za-z]:\\|\.{0,2}\/)?[^\s"'<>]+?)\.(pptx?|key|docx?|pdf|xlsx|xlsm|xls|csv|tsv|numbers|mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|png|jpe?g|webp|heic|gif|html?)(?=$|[\s"'`)\]）,，。;；:])/gim;
const ATTACH_KIND = {ppt: 'document', pptx: 'document', key: 'document', doc: 'document', docx: 'document', pdf: 'document',
  xlsx: 'data_charts', xlsm: 'data_charts', xls: 'data_charts', csv: 'data_charts', tsv: 'data_charts', numbers: 'data_charts',
  mp4: 'video_motion', mov: 'video_motion', m4v: 'video_motion', webm: 'video_motion', mkv: 'video_motion', avi: 'video_motion',
  mp3: 'video_motion', wav: 'video_motion', m4a: 'video_motion', gif: 'video_motion', html: 'web_ui', htm: 'web_ui'};
const ATTACH_WEIGHT = {document: 3, data_charts: 3, video_motion: 3, web_ui: 2};

// 用户粘贴进来要翻译/润色/总结的原文：只按那句指令分，不按原文里的词分。
const TEXT_TASK = '(?:翻译|翻成|译成|译为|润色|改写|重写|转述|总结|概括|摘要|提炼|校对|纠错|缩写|扩写|精简)';
const TEXT_HEAD = new RegExp(`^(?:请|帮我|麻烦|能不能|可以)?\\s*(?:把|将)?[^\\n：:]{0,16}?${TEXT_TASK}[^\\n：:]{0,30}[：:\\n]`, 'i');
const TEXT_TAIL = new RegExp(`\\n\\s*(?:请|帮我|麻烦)?\\s*(?:把|将)?\\s*(?:(?:上面|以上|上述|这段|这些)(?:的)?){0,2}(?:内容|文字|文本|话|段落|报告)?\\s*${TEXT_TASK}[^\\n]{0,30}$`, 'i');
const TEXT_EN = /^(?:please\s+|can you\s+)?(?:translate|summari[sz]e|proofread|rewrite|paraphrase|polish)\b[^\n:]{0,40}[:\n]/i;

function instructionText(prompt = '') {
  return String(prompt || '')
    .replace(/\[deep-think:(?:base|boost|full|marathon)\]/gi, '')
    .replace(/\n\s*【(?:学习)?工作台】[\s\S]*$/, '')
    .replace(/<file\b[^>]*>[\s\S]*?<\/file\s*>/gi, ' ')
    .replace(/<file\b[^>]*>[\s\S]*$/gi, ' ')
    .replace(/<<<EXTERNAL_UNTRUSTED_CONTENT>>>[\s\S]*?(?:<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>|$)/gi, ' ')
    .replace(/^\s*\[media attached:[^\r\n]*\]\s*$/gim, ' ')
    .trim();
}

function pastedSourceInstruction(text = '') {
  const head = TEXT_HEAD.exec(text) || TEXT_EN.exec(text);
  if (head && text.length - head[0].length >= 40) return head[0];
  const tail = TEXT_TAIL.exec(text);
  if (tail && text.length - tail[0].length >= 40) return tail[0];
  return null;
}

function attachmentKinds(prompt = '') {
  const found = new Map();
  for (const match of String(prompt || '').matchAll(ATTACH_EXT)) {
    const id = ATTACH_KIND[String(match[1] || '').toLowerCase().replace('jpeg', 'jpg')];
    if (id) found.set(id, Math.max(found.get(id) || 0, ATTACH_WEIGHT[id] || 1));
  }
  return found;
}

/**
 * 认出这条请求是哪种活。返回 {kind, kinds, scores}：kind 是主活，kinds 是主活 + 附带活（证据取并集）。
 * mode：chat / project / ideas / learning / none（index.mjs 的显示模式名）。学习模式默认是讲题辅导，
 * 除非明确要做东西。continuation 只说「继续」时，交给调用方沿用上一条真实请求。
 */
export function classifyWorkKind(prompt = '', {mode = ''} = {}) {
  const raw = instructionText(prompt);
  const attached = attachmentKinds(prompt);
  if (!raw && !attached.size) return {kind: 'pending', kinds: [], scores: {}};
  if (CONTINUATION.test(raw)) return {kind: 'pending', kinds: [], scores: {}, continuation: true};
  if (GREETING.test(raw) || META_QUESTION.test(raw) || TIER_QUESTION.test(raw)) return {kind: 'simple', kinds: ['simple'], scores: {simple: 1}};
  const pasted = raw.length > 60 ? pastedSourceInstruction(raw) : null;
  const text = (pasted !== null ? pasted : raw).replace(NEGATED_CLAUSE, ' ');
  const scores = {};
  for (const [id, rules] of Object.entries(PATTERNS)) {
    let score = 0;
    for (const rule of rules) if (rule.re.test(text)) score += rule.w;
    if (score) scores[id] = score;
  }
  if (pasted !== null) scores.writing = Math.max(scores.writing || 0, 6);
  for (const [id, weight] of attached) scores[id] = (scores[id] || 0) + weight;
  // 「做个简历网站」：要做的是网站，「简历」只是内容。
  const done = DONE_PRODUCT.test(text);
  const made = done ? '' : MAKE_PRODUCT.exec(text)?.[1]?.toLowerCase();
  const madeKind = made ? PRODUCT_NOUN.find(([re]) => re.test(made))?.[1] : '';
  if (madeKind) scores[madeKind] = (scores[madeKind] || 0) + 2;
  if (LEARN_ADVICE.test(text) && !made) for (const id of Object.keys(scores)) if (isHandsOnKind(id)) delete scores[id];
  // 学习模式：讲题优先；只有明确要做东西（文件、网页、视频……）才按那种活。
  if (mode === 'learning') {
    const homework = /(?:作文|作业|这题|道题|习题|练习|阅读理解|论文|考试)/.test(text);
    const making = Object.entries(scores).some(([id, score]) => isHandsOnKind(id) && score >= 4 && ACTION_HINT.test(text))
      || ((scores.writing || 0) >= 4 && /(?:写|翻译|润色|改写)/.test(text) && !homework);
    if (!making) {
      scores.tutoring = Math.max(scores.tutoring || 0, 5, (scores.standard_answer || 0) + 1, (scores.writing || 0) + 1);
      if (homework) delete scores.writing;
    }
  } else {
    delete scores.tutoring;
  }
  // 代码那一组的泛词（「代码」「python」）只是线索；没有动手的动词就不算写代码。
  if ((scores.code || 0) < 4) delete scores.code;
  const ranked = Object.entries(scores).filter(([, score]) => score >= 3)
    .sort((a, b) => b[1] - a[1] || SPECIFICITY.indexOf(a[0]) - SPECIFICITY.indexOf(b[0]));
  if (!ranked.length) {
    if (ACTION_HINT.test(text) && /(?:做|弄|搞|生成|制作|整)/.test(text) && text.length >= 4) return {kind: 'craft', kinds: ['craft'], scores};
    if (raw.length > 700 && /(?:为什么|原因|如何判断|是否成立|怎么算|怎么证明)/.test(raw)) return {kind: 'standard_answer', kinds: ['standard_answer'], scores};
    return {kind: mode === 'learning' ? 'tutoring' : 'simple', kinds: [mode === 'learning' ? 'tutoring' : 'simple'], scores};
  }
  let primary = ranked[0][0];
  const present = new Set(ranked.map(([id]) => id));
  // 「做网页再发到网上」主活是网页；「网页打不开」主活是排错。
  // 「做网页再发到网上」主活是网页；「把这个网站部署上去」主活才是发布。
  if (primary === 'publish' && made) {
    const product = ranked.find(([id]) => PRODUCT_KINDS.has(id) && id !== 'code');
    if (product) primary = product[0];
  }
  // 现成的东西要发出去：主活是发布，东西本身没改，不再按「做网页 / 做游戏」要证据。
  const publishOnly = done && (scores.publish || 0) >= 5;
  if (publishOnly) primary = 'publish';
  // 「安卓最新版本是多少」「iPhone 和安卓选哪个」：只提到产品名、没让做东西，是查事实 / 取舍。
  if (isHandsOnKind(primary) && !ACTION_HINT.test(text)) {
    const question = ['tradeoff', 'fact_check'].find((id) => (scores[id] || 0) >= 4 && (scores[primary] || 0) <= scores[id]);
    if (question) primary = question;
  }
  // 「做个网页对比 A 和 B 哪个划算」：明说要做的东西是主活，对比只是内容。
  if (madeKind && present.has(madeKind) && ['tradeoff', 'fact_check', 'standard_answer', 'ideas'].includes(primary)) primary = madeKind;
  if (present.has('debugging') && primary !== 'debugging' && (scores.debugging || 0) >= 5) primary = 'debugging';
  // 写脚本去做批量处理、做数据：脚本是手段，主活是自动化 / 数据。
  if (primary === 'code') for (const id of ['automation', 'data_charts']) if ((scores[id] || 0) >= 4) { primary = id; break; }
  const kinds = [primary];
  for (const [id, score] of ranked) {
    if (id === primary || kinds.length >= 3) continue;
    if (publishOnly && PRODUCT_KINDS.has(id)) continue;
    // 「做个简历网站」：简历只是网站的内容，没有要交的 Word / PDF，不按文档要证据。
    if (id === 'document' && made && primary !== 'document' && !/(?:ppt|幻灯片|演示文稿|课件|word|docx|pdf|keynote)/i.test(text)) continue;
    // 附带活只收「另有一样要交的东西」：文字类只在主活也是文字类、或分数够高时才算。
    if (isTextKind(id) && isHandsOnKind(primary) && score < 4) continue;
    // 「做张海报要发朋友圈」：朋友圈是发到哪，不是另要一段文案；明说要写文案、配文才算。
    if (id === 'writing' && isHandsOnKind(primary) && !WRITING_DELIVERABLE.test(text)) continue;
    // 网页、自动化里写代码是顺带的；用户点名要测试时，测试证据也要算上。
    if (id === 'code' && ['web_ui', 'app_game_ai', 'automation', 'debugging', 'data_charts'].includes(primary) && !/(?:测试|test)/i.test(text)) continue;
    if (['tradeoff', 'fact_check', 'standard_answer', 'simple'].includes(id) && kinds.some(isHandsOnKind)) continue;
    if (id === 'tutoring') continue;
    // 问题类主活（查事实、取舍、算题）没让做东西时，提到的产品名不另要动手证据。
    if (isHandsOnKind(id) && ['fact_check', 'tradeoff', 'standard_answer'].includes(primary) && !ACTION_HINT.test(text)) continue;
    // 「这个 PPT 的字太小」：说的是这份文件，不是另有一个网页。
    if (id === 'web_ui' && score < 5 && ['document', 'image_print', 'video_motion', 'data_charts'].includes(primary)) continue;
    if (id === 'web_ui' && score < 4 && ['code', 'automation', 'app_game_ai'].includes(primary)) continue;
    kinds.push(id);
  }
  return {kind: primary, kinds, scores};
}

// ---------- 证据信号 ----------

const EXT = {
  page: /\.(?:html?|css|jsx?|tsx?|vue|svelte)$/i,
  doc: /\.(?:pptx?|key|docx?|pdf|odp|odt|pages|rtf)$/i,
  sheet: /\.(?:xlsx|xlsm|xls|csv|tsv|numbers|ods)$/i,
  video: /\.(?:mp4|mov|m4v|webm|mkv|avi|gif)$/i,
  audio: /\.(?:mp3|wav|m4a|aac|flac|ogg)$/i,
  image: /\.(?:png|jpe?g|webp|svg|heic|bmp|tiff?)$/i,
  script: /\.(?:py|mjs|cjs|js|ts|sh|bash|zsh|ps1|bat|cmd|rb|go|rs|java|kt|swift|c|cc|cpp|h|sql|plist|service)$/i,
};
const PATH_IN_TEXT = /(?:^|[\s"'`(=:：，,])((?:~\/|\/|[A-Za-z]:[\\/]|\.{1,2}\/)?[^\s"'`<>|;*?(){}，,：；]+?\.(?:html?|css|jsx?|tsx?|vue|svelte|pptx?|key|docx?|pdf|odp|odt|pages|rtf|xlsx|xlsm|xls|csv|tsv|numbers|ods|mp4|mov|m4v|webm|mkv|avi|gif|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|svg|heic|bmp|tiff?|py|mjs|cjs|ts|sh|ps1|bat|rb|go|rs|sql|plist))(?=$|\.(?:$|\s)|[\s"'`),;:：，。\]}|])/gi;
const PREVIEW_NAME = /(?:\.preview\.|preview|screenshot|截图|快照|snapshot|[\\/_-]frames?[\\/_.-]|帧|thumb|contact[-_]?sheet|montage|pinkie-snapshot|\.mobile\.)/i;
const MEDIA_EXT = 'html?|pptx?|key|docx?|pdf|odp|odt|pages|rtf|xlsx|xlsm|xls|csv|tsv|numbers|ods|mp4|mov|m4v|webm|mkv|avi|gif|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|svg|heic|bmp|tiff?';
// 只认「保存到 / 输出到」的那个文件是做出来的：读回检查（python-pptx 打开、look-doc）不算又做了一次。
const SAVE_CALL = new RegExp(`(?:\\.save|savefig|write_image|to_excel|to_csv|to_html|to_file|writeFile(?:Sync)?|write_text|write_bytes|save_as|output_file|toFile|write)\\(\\s*(?:(?:path|filename|fp)\\s*=\\s*)?[rf]?['"\`]([^'"\`]+\\.(?:${MEDIA_EXT}))['"\`]`, 'gi');
const OUTPUT_FLAG = new RegExp(`(?:^|\\s)(?:-o|--output|--out|-O|--outfile|--output-file)(?:=|\\s+)['"]?([^\\s'"]+\\.(?:${MEDIA_EXT}))`, 'gi');
const REDIRECT = new RegExp(`[^<>2&]>{1,2}\\s*['"]?([^\\s'"&|;]+\\.(?:${MEDIA_EXT}))`, 'gi');
const LAST_MEDIA_ARG = new RegExp(`\\b(?:ffmpeg|magick|convert|montage|sips|rsvg-convert|cwebp|gifski)\\b[^;&|]*?\\s['"]?([^\\s'"]+\\.(?:${MEDIA_EXT}))['"]?\\s*(?=$|&&|;|\\|)`, 'gim');
// 实测输出：「图表已保存至: x.png」「PPTX 成功生成并同步: x.pptx」「导出 PDF: /…/x.pdf」。
const SAVED_OUTPUT = new RegExp(`(?:SAVED|Saved|saved(?: to| as)?|Wrote|wrote|Written to|写入|已保存(?:至|到|在)?|保存(?:到|为|至|在)|已生成|生成了|成功生成(?:并[一-龥]{1,3})?|生成成功|导出(?:到|为|至)?(?:\\s*(?:PDF|PPTX?|DOCX?|图片|文件))?|Output(?: file)?|输出(?:到|文件)?|Created|created)\\s*[：:]?\\s*['"]?((?:~\\/|\\/|[A-Za-z]:[\\\\/]|\\.{0,2}\\/)?[^\\s"'<>，,]+\\.(?:${MEDIA_EXT}))`, 'g');
const IMAGE_QUERY = /\bsips\b(?=[^;&|]*\s(?:-g|--getProperty)\s)(?![^;&|]*\s(?:--out|-o)\s)|\b(?:magick\s+)?identify\b/;
const CHECK_TOOL = /\b(?:look-(?:page|doc|video)|ffprobe|pdftoppm|pdftotext|pdfinfo|markitdown|qlmanage|mdls|exiftool)\b|--convert-to\b/i;
const OPEN_CALL = /(?:Presentation|Document|load_workbook|PdfReader|PdfFileReader|open_workbook|pdfplumber\.open|fitz\.open|read_excel|read_csv|convert_from_path|(?:Presentations|Documents|Workbooks)\.Open)\(\s*(?:r?['"])([^'"]+\.(?:pptx?|docx?|pdf|xlsx|xlsm|xls|csv))['"]/gi;
const TEST_COMMAND = /(?:\btest\b|pytest|vitest|jest|mocha|cargo\s+test|go\s+test|unittest|playwright\s+test|cypress|node\s+--test|npm\s+(?:run\s+)?test|pnpm\s+test|yarn\s+test|deno\s+test|bun\s+test)/i;
const RUN_COMMAND = /(?:^|[;&|(]\s*|\s|\/)(?:node|python\d*(?:\.\d+)?|py\s|deno|bun|ruby|go\s+run|cargo\s+run|java\s|php\s|bash\s+\S+\.sh|sh\s+\S+\.sh|zsh\s+\S+\.sh|pwsh|powershell|\.\/[\w.-]+|npm\s+(?:run\s+\w+|start)|pnpm\s+(?:run\s+\w+|start|dev)|yarn\s+(?:start|dev)|npx\s+\S+|open\s+\S+\.app|osascript)\b/i;
const INSPECT_ONLY = /^\s*(?:ls|cat|head|tail|pwd|which|where|echo|mkdir|cd|wc|find|grep|rg|tree|stat|file|du|df|open)\b[^;&|]*$/i;
const SCREENSHOT_COMMAND = /\blook-page\b|\bscreencapture\b|--screenshot\b|\bwkhtmltoimage\b|\bshot-scraper\b|capture-website|\.screenshot\s*\(|\bpage\.screenshot\b|\bplaywright\b[\s\S]{0,400}screenshot/i;
const MOBILE_MARK = /--mobile\b|\biPhone\b|\bPixel\s?\d|is_mobile|isMobile|devices\s*\[|viewport[^}]{0,40}?width["'\s:=]+(?:3[2-9]\d|4[0-7]\d)\b|['"]width['"]\s*:\s*(?:3[2-9]\d|4[0-7]\d)\b|--window-size[=\s](?:3[2-9]\d|4[0-7]\d),|手机(?:尺寸|宽度)/i;
const SHOT_OUTPUT = /(?:截图|screenshots?(?: saved)?)\s*[：:][^\n]{0,200}?\.(?:png|jpe?g|webp)\b/i;
const FRAME_COMMAND = /\blook-video\b|\bffmpeg\b[\s\S]{0,600}(?:-frames:v|-vframes|\bfps=|select=|thumbnail|tile=)/i;
const PROBE_COMMAND = /\bffprobe\b|\blook-video\b|\bmediainfo\b|\b(?:ls\s+-[a-z]*l|stat|du|mdls)\b[^;&|]*\.(?:mp4|mov|m4v|webm|mkv|avi|gif)\b/i;
// Windows 上用 PowerPoint / Word 的 COM 导出、Mac 上用 Keynote（documents-and-slides.md 第四节的几条路）也算打开了交付文件。
const OFFICE_APP = /-ComObject\s+(?:PowerPoint|Word|Excel)\.Application|tell application "(?:Keynote|Pages|Numbers|Microsoft PowerPoint|Microsoft Word|Microsoft Excel)"/i;
const DOC_OPEN_COMMAND = /\blook-doc\b|\bmarkitdown\b|\bpdftotext\b|\bpdftoppm\b|\bpdfinfo\b|\bqlmanage\b|--convert-to\b|-ComObject\s+(?:PowerPoint|Word|Excel)\.Application|tell application "(?:Keynote|Pages|Numbers|Microsoft PowerPoint|Microsoft Word|Microsoft Excel)"|\b(?:python\d*(?:\.\d+)?|node)\b[\s\S]{0,1200}(?:Presentation\(|Document\(|load_workbook\(|PdfReader\(|fitz\.open|pdfplumber|pypdf|python-pptx|from pptx|from docx|import pptx|import docx|mammoth|officeparser|pdf2image|convert_from_path)/i;
const DOC_RENDER_COMMAND = /\blook-doc\b|--convert-to\s+(?:png|jpg|pdf)|\bpdftoppm\b|\bqlmanage\s+-t\b|\bmagick\b[^\n]{0,200}\.pdf|\bsips\b[^\n]{0,200}-s\s+format\s+png|convert_from_path|pdf2image|get_pixmap|\.SaveAs\([^)]*,\s*(?:32|17)\s*\)|ExportAsFixedFormat|\bexport\b[^\n]{0,200}\bas\s+PDF\b/i;
const COMPUTE_COMMAND = /\b(?:python\d*(?:\.\d+)?|node|deno|bun|ruby|Rscript|sqlite3|duckdb|julia|bc|awk|qalc)\b[\s\S]{0,2000}(?:pandas|\bpd\.|openpyxl|xlrd|csv|numpy|\bnp\.|statistics|sum\(|mean|median|groupby|pivot|describe\(|sqlite|duckdb|polars|read_excel|read_csv|Fraction|sympy|math\.|round\(|print\([^)]*[+\-*/][^)]*\)|console\.log\([^)]*[+\-*/][^)]*\)|reduce\(|SELECT\s)/i;
// 注册成自动：真的登记了（load / 写入 crontab / 建计划任务 / 常驻启动）。只查看（list、crontab -l、/query）
// 要看到有内容、没报错才算——空列表或「no crontab」不能当成已注册。
// 印刷品的尺寸 / 分辨率核对：sips -g、identify、pdfinfo、exiftool，或程序里读 dpi。
const PRINT_PROBE = /\b(?:identify|sips\s+(?:-g|--getProperty)|pdfinfo|exiftool|mdls)\b|\bdpi\b|dpiWidth|\.info\.get\(\s*['"]dpi/i;
const SCHEDULE_COMMAND = /\blaunchctl\s+(?:load|bootstrap|enable|kickstart)\b|\bcrontab\s+(?!-[lr]\b)\S|\bschtasks(?:\.exe)?\s+\/(?:create|run)\b|\b(?:Register|Start)-ScheduledTask\b|\bsystemctl\s+--user\s+(?:enable|start)\b|\bpm2\s+(?:start|save)\b|\bnohup\b|\bat\s+\d{1,2}:\d{2}\b/i;
const SCHEDULE_QUERY = /\blaunchctl\s+(?:list|print)\b|\bcrontab\s+-l\b|\bschtasks(?:\.exe)?\s+\/query\b|\bGet-ScheduledTask\b|\bsystemctl\s+--user\s+status\b|\bpm2\s+(?:list|ls|status)\b/i;
const SCHEDULE_EMPTY = /no crontab|could not find|not found|找不到|不存在|ERROR:|cannot find|does not exist|inactive \(dead\)/i;
const MACHINE_COMMAND = /machine-check\.(?:sh|ps1)|\bsysctl\s+(?:-n\s+)?(?:hw|machdep)|\bvm_stat\b|\bdf\s+-h\b|\bmemory_pressure\b|\bsystem_profiler\b|\bsw_vers\b|\buname\s+-[a-z]*m|\btop\s+-l\b|\bpmset\s+-g\b|Get-CimInstance|Get-ComputerInfo|\bsysteminfo\b|\bwmic\b|Get-PSDrive|\bnvidia-smi\b|\bfree\s+-h\b|\blscpu\b|\b(?:which|where(?:\.exe)?|command\s+-v|type\s+-a|Get-Command)\s+\S|\S+\s+(?:--version|-V\b|-version\b)|\bpy\s+-3\s+--version|\bbrew\s+list\b|\bpip\d*\s+(?:show|list)\b|\bnpm\s+(?:ls|list)\b/i;
const DEPLOY_COMMAND = /\b(?:vercel|netlify|surge|wrangler|gh-pages|firebase\s+deploy|rsync|scp|sftp|lftp|git\s+push|cloudflared|ngrok|caddy|nginx\s+-s|pm2\s+start|docker\s+push|fly\s+deploy|railway\s+up)\b/i;
const PRIVATE_HOST = /^(?:localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|[^/]*\.local\b|file:)/i;

function paramsObject(entry = {}) {
  const value = entry.params;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null;
  try { return JSON.parse(value); } catch { return null; }
}

// 工具结果里模型真正看到的正文：content 里的文字（图片记成 {"type":"image"}），不要 JSON 外壳。
// OpenClaw 的 after_tool_call 给的是整个结果对象 {content, details}：外壳里 exitCode、durationMs、pid 会被当成
// 「程序算出来的数字」，正文里的换行也会变成字面的 \n，截图路径就认不出来了。
export function toolResultText(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return result == null ? '' : String(result);
  const content = Array.isArray(result.content) ? result.content : null;
  const text = content
    ? content.map(part => part?.type === 'text' ? String(part.text ?? '') : part?.type === 'image' ? '{"type":"image"}' : '').filter(Boolean).join('\n')
    : '';
  if (text) return text;
  if (typeof result.details?.aggregated === 'string' && result.details.aggregated) return result.details.aggregated;
  try { return JSON.stringify(result); } catch { return String(result); }
}

// 工具输出存进记录前的截断：头尾都留。测试汇总、退出码、「已保存到 …」多在最后，只留开头会把它们丢掉。
export function clipToolOutput(text = '', max = 2000) {
  const value = String(text || '');
  if (value.length <= max) return value;
  const tail = Math.floor(max * 0.4);
  return `${value.slice(0, max - tail - 3)}\n…\n${value.slice(-tail)}`;
}

// 一条工具记录（captureVerificationEvidence 存的，或测试里手写的同一形状）整理成好判断的样子。
export function normalizeEntry(entry = {}) {
  const params = paramsObject(entry);
  const paramsText = typeof entry.params === 'string' ? entry.params : JSON.stringify(entry.params || {});
  const command = String(params?.command || params?.cmd || params?.script || (/"command"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(paramsText)?.[1] || '').replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  const name = String(entry.name || entry.toolName || '').toLowerCase();
  const action = String(params?.action || params?.kind || (/"action"\s*:\s*"([^"]+)"/.exec(paramsText)?.[1] || '')).toLowerCase();
  return {name, action, params, paramsText, command, output: String(entry.output || ''), ok: entry.ok !== false,
    kind: String(entry.kind || ''), seq: Number(entry.sequence) || Number(entry.at) || 0};
}

function pathsIn(text = '') {
  const found = [];
  for (const match of String(text || '').matchAll(PATH_IN_TEXT)) {
    const value = match[1].replace(/^['"(]+|['"),.;:]+$/g, '');
    if (value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/(?:^|[\\/])node_modules[\\/]/.test(value)) found.push(value);
  }
  return found;
}

// 这条命令真正写出来的文件（保存调用、-o 参数、重定向、ffmpeg/magick 的最后一个参数、输出里的「已保存」）。
export function producedPaths(command = '', output = '') {
  const found = new Set();
  const take = (re, text) => { for (const match of String(text || '').matchAll(re)) found.add(match[1]); };
  const cmd = String(command || '');
  if (!CHECK_TOOL.test(cmd) || /\b(?:ffmpeg|magick|python\d*|node)\b/.test(cmd.replace(/look-(?:page|doc|video)/g, ''))) {
    take(SAVE_CALL, cmd); take(OUTPUT_FLAG, cmd); take(REDIRECT, cmd);
    // sips -g、magick identify 只是查看尺寸，不算又做了一张图。
    if (!IMAGE_QUERY.test(cmd)) take(LAST_MEDIA_ARG, cmd);
  }
  take(SAVED_OUTPUT, String(output || '').slice(0, 1600));
  return [...found].filter(file => !/^[a-z][a-z0-9+.-]*:\/\//i.test(file));
}

function groupOf(file = '') {
  for (const [group, re] of Object.entries(EXT)) if (re.test(file)) return group;
  return '';
}

function paramPaths(n) {
  const params = n.params || {};
  return ['path', 'file_path', 'filePath', 'image', 'target', 'destination', 'outputPath', 'output_path', 'file', 'filename', 'url']
    .map(key => params[key]).filter(value => typeof value === 'string' && value);
}

const IMAGE_READ_TOOL = /^(?:read|view_image|open_file|read_file|workbench_read)$/;
// 长命令被 OpenClaw 放到后台：exec 只回「Command still running (session X, pid N)」，真正的输出要等 process poll/log。
const BACKGROUND_START = /Command still running \(session ([\w-]+)/;
const PROCESS_EXIT = /Process exited with code (\d+)/;
const BROWSER_TOOL = /(?:^|_)(?:browser|computer|screen|cua)(?:$|_)|^app_browser$/;
const HAS_INLINE_IMAGE = /"type"\s*:\s*"image"|Read image file|\[image\/(?:png|jpe?g|webp)\]/i;
const ERROR_OUTPUT = /"status"\s*:\s*"error"|"ok"\s*:\s*false|not under an allowed directory|ENOENT|no such file|找不到/i;

/**
 * 一条工具记录带了哪些证据信号。返回字符串数组：
 * mutation / produced:<组> / test / run / failed_run / screenshot / mobile_screenshot / image_viewed / frames_extracted /
 * render_probe / opened_deliverable:<扩展名> / doc_render / recomputed / schedule_registered / public_url_ok /
 * machine_probe / print_probe / browser_open / interacted / deploy / source / note
 */
export function evidenceSignals(entry = {}) {
  const n = normalizeEntry(entry);
  const signals = new Set();
  const {name, action, command, output} = n;
  const okish = n.ok && !(name !== 'exec' && ERROR_OUTPUT.test(output.slice(0, 400)));
  if (n.kind === 'note') { signals.add('note'); return [...signals]; }
  if (n.kind === 'mutation' || /^(?:write|edit|apply_patch|create|update|delete|move)$/.test(name)) {
    if (!n.ok) return [];
    signals.add('mutation');
    // 参数在记录里会被截到 2000 字，内容在前时路径就丢了；写入结果里还有一份（「Successfully wrote N bytes to PATH」）。
    for (const file of [...paramPaths(n), ...pathsIn(n.paramsText.slice(0, 600)), ...pathsIn(n.output.slice(0, 400))]) {
      const group = groupOf(file);
      if (group && !(group === 'image' && PREVIEW_NAME.test(file))) signals.add(`produced:${group}`);
    }
    return [...signals];
  }
  const exec = /(?:^|[._:-])(?:exec|shell|bash|terminal|run|process)(?:$|[._:-])/.test(name) || name === 'exec';
  if (exec && command) {
    // 只是在后台启动了：算「跑起来了」（启动服务、常驻进程），测试、重算、产物都要等 process 回来的输出（见 linkBackgroundRuns）。
    if (n.ok && BACKGROUND_START.test(output)) {
      if (RUN_COMMAND.test(command) && !INSPECT_ONLY.test(command)) signals.add('run');
      if (SCHEDULE_COMMAND.test(command)) signals.add('schedule_registered');
      return [...signals];
    }
    if (!n.ok) {
      signals.add('failed_run');
      if (TEST_COMMAND.test(command)) signals.add('failed_test');
      return [...signals];
    }
    if (TEST_COMMAND.test(command) || n.kind === 'test') signals.add('test');
    if (RUN_COMMAND.test(command) && !INSPECT_ONLY.test(command)) signals.add('run');
    // 没有 look-page 的电脑（别人的 Mac、Windows）照 web-and-ui.md 第五节跑 shot.py：命令里看不出截图，输出里有「截图：x.png」。
    if (SCREENSHOT_COMMAND.test(command) || SHOT_OUTPUT.test(output)) {
      signals.add('screenshot');
      if (MOBILE_MARK.test(command) || /手机尺寸|[-_.]mobile[\w.-]*\.(?:png|jpe?g|webp)\b/i.test(output)) signals.add('mobile_screenshot');
    }
    if (FRAME_COMMAND.test(command)) signals.add('frames_extracted');
    if (PROBE_COMMAND.test(command) && /\d/.test(output)) signals.add('render_probe');
    if (DOC_OPEN_COMMAND.test(command)) {
      const opened = CHECK_TOOL.test(command) || OFFICE_APP.test(command) ? pathsIn(command) : [...command.matchAll(OPEN_CALL)].map(match => match[1]);
      for (const file of opened) {
        const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
        if (ext && (EXT.doc.test(file) || EXT.sheet.test(file))) signals.add(`opened_deliverable:${ext}`);
      }
      if (DOC_RENDER_COMMAND.test(command)) signals.add('doc_render');
    }
    const numbersOut = (output.match(/\d+(?:\.\d+)?/g) || []).length;
    if ((COMPUTE_COMMAND.test(command) && /\d/.test(output))
        || (/\b(?:python\d*(?:\.\d+)?|node|Rscript|sqlite3|duckdb|julia)\b/.test(command) && !INSPECT_ONLY.test(command) && numbersOut >= 2)) signals.add('recomputed');
    if (SCHEDULE_COMMAND.test(command) || (SCHEDULE_QUERY.test(command) && /\S/.test(output) && !SCHEDULE_EMPTY.test(output))) signals.add('schedule_registered');
    if (MACHINE_COMMAND.test(command)) signals.add('machine_probe');
    if (PRINT_PROBE.test(command) && /\d/.test(output)) signals.add('print_probe');
    if (DEPLOY_COMMAND.test(command)) signals.add('deploy');
    const curl = /\bcurl\b[^\n]*?(https?:\/\/[^\s"'<>]+)/i.exec(command);
    if (curl && !PRIVATE_HOST.test(curl[1].replace(/^https?:\/\//i, '')) && /(?:HTTP\/[\d.]+\s+(?:200|301|302|304)|<html|<!doctype|"status"\s*:\s*200)/i.test(output)) signals.add('public_url_ok');
    for (const file of producedPaths(command, output)) {
      const group = groupOf(file);
      if (!group || group === 'script' || PREVIEW_NAME.test(file)) continue;
      signals.add(`produced:${group}`);
    }
    return [...signals];
  }
  if (!okish) return [...signals];
  if (IMAGE_READ_TOOL.test(name)) {
    const files = paramPaths(n);
    if (files.some(file => EXT.image.test(file)) && (HAS_INLINE_IMAGE.test(output) || !output || !ERROR_OUTPUT.test(output))) signals.add('image_viewed');
    for (const file of files) {
      const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
      if (ext && (EXT.doc.test(file) || EXT.sheet.test(file)) && output.length > 20) signals.add(`opened_deliverable:${ext}`);
    }
  }
  if (name === 'image' || name === 'image_view' || name === 'vision') signals.add('image_viewed');
  if (name === 'pdf') {
    signals.add('opened_deliverable:pdf');
  }
  if (name === 'image_generate' || name === 'imagegen') signals.add('produced:image');
  if (BROWSER_TOOL.test(name)) {
    if (/^(?:screenshot|capture)$/.test(action)) {
      signals.add('screenshot');
      if (HAS_INLINE_IMAGE.test(output)) signals.add('image_viewed');
      if (/"viewport"\s*:\s*\{\s*"width"\s*:\s*(?:3[2-9]\d|4[0-7]\d)\b|"width"\s*:\s*(?:3[2-9]\d|4[0-7]\d)\s*,\s*"height"/.test(output) || MOBILE_MARK.test(n.paramsText)) signals.add('mobile_screenshot');
    }
    if (/^(?:open|navigate|serve|goto|show_file|reload)$/.test(action)) {
      signals.add('browser_open');
      const url = String(n.params?.url || '');
      if (/^https?:\/\//i.test(url) && !PRIVATE_HOST.test(url.replace(/^https?:\/\//i, ''))) signals.add('public_url_ok');
    }
    if (/^(?:click|type|batch|press|fill|select|scroll|snapshot|eval|evaluate)$/.test(action)) signals.add('interacted');
  }
  if (name === 'web_fetch' || name === 'fetch' || /(?:^|_)fetch$/.test(name)) {
    const url = String(n.params?.url || '');
    if (/^https?:\/\//i.test(url) && !PRIVATE_HOST.test(url.replace(/^https?:\/\//i, '')) && output.length > 20) signals.add('public_url_ok');
  }
  if (name === 'cron' && /^(?:add|create|update|run)$/.test(action)) signals.add('schedule_registered');
  if (name === 'learning_activity' && /math_check|c_program|compute/.test(n.paramsText)) signals.add('recomputed');
  if (/read|search|web|fetch|open|list|inspect|find/.test(name)) signals.add('source');
  return [...signals];
}

/**
 * 把后台命令的结果接回命令本身：process poll/log 看到「Process exited with code N」时，
 * 按「这条命令 + 这次的输出」重新当一条 exec 记录判断（数据重算的数字、测试结果、导出的文件都在这里）。
 * 还在跑、被 kill 的 poll 不算。
 */
export function linkBackgroundRuns(entries = []) {
  const started = new Map();
  return (Array.isArray(entries) ? entries : []).map(entry => {
    const n = normalizeEntry(entry);
    if (n.command && n.name !== 'process') {
      const id = BACKGROUND_START.exec(n.output)?.[1];
      if (id) started.set(id, n.command);
      return entry;
    }
    if (n.name !== 'process' || !/^(?:poll|log|wait)$/.test(n.action)) return entry;
    const id = String(n.params?.sessionId || /"sessionId"\s*:\s*"([^"]+)"/.exec(n.paramsText)?.[1] || '');
    const code = PROCESS_EXIT.exec(n.output)?.[1];
    const command = started.get(id);
    if (!command || code === undefined) return entry;
    return {...entry, name: 'exec', params: {command}, ok: code === '0', kind: ''};
  });
}

// 一串工具记录 → [{seq, signals}]，只留成功的、按发生顺序。
function signalRows(entries = []) {
  return linkBackgroundRuns(entries).map(entry => ({seq: normalizeEntry(entry).seq, signals: new Set(evidenceSignals(entry)), entry}))
    .filter(row => row.signals.size)
    .sort((a, b) => a.seq - b.seq);
}

// 过程中改判：做出了 .pptx 就是文档、出了 .mp4 就是视频、注册了定时就是自动化。只往更具体的方向改。
// 主活只在原来是泛泛的（简单问答、没认出来的活）时被替换；文案、点子、代码里做出的文件只加成附带活。
const GENERIC_PRIMARY = new Set(['simple', 'craft', 'pending']);
const PRODUCED_KIND = {doc: 'document', video: 'video_motion', sheet: 'data_charts', image: 'image_print', page: 'web_ui'};
export function refineKinds(kinds = [], entry = {}, {mode = ''} = {}) {
  if (mode === 'none') return null;
  const current = Array.isArray(kinds) ? kinds.filter(isWorkKind) : [];
  if (current[0] === 'tutoring') return null;
  const signals = evidenceSignals(entry);
  const found = [];
  for (const signal of signals) {
    if (signal.startsWith('produced:')) {
      const id = PRODUCED_KIND[signal.slice(9)];
      // 网页、代码活里顺手生成的图片（图标、示意图）不把整件事改判成「海报」。
      if (id === 'image_print' && current.some(k => ['web_ui', 'app_game_ai', 'video_motion', 'document', 'data_charts', 'code'].includes(k))) continue;
      if (id === 'web_ui' && current.some(k => ['app_game_ai', 'automation', 'code', 'debugging', 'data_charts'].includes(k))) continue;
      if (id) found.push(id);
    }
    if (signal === 'schedule_registered') found.push('automation');
  }
  const next = [...current];
  for (const id of found) {
    if (next.includes(id)) continue;
    if (!next.length || GENERIC_PRIMARY.has(next[0])) next.unshift(id); else if (next.length < 4) next.push(id);
  }
  // 简单问答、没认出来的活只是占位：认出具体的活之后就让位。
  const cleaned = next.filter(id => !(GENERIC_PRIMARY.has(id) && next.length > 1));
  return cleaned.join('|') === current.join('|') ? null : cleaned;
}

// ---------- 每档要什么 ----------

const MOBILE_HINT = /(?:手机|移动端|小程序|微信|app|ios|安卓|android|iphone|pwa|竖屏|mobile|phone)/i;
const AUTO_HINT = /(?:自动|定时|每天|每晚|每早|每周|每月|每小时|每隔|开机|后台|常驻|到点|按时|监控|盯着|cron|schedule|automat|every (?:day|hour|week|morning))/i;
const PRINT_HINT = /(?:印刷|打印|印出来|出血|毫米|mm\b|a4|a5|名片|传单|易拉宝|展板|横幅|dpi|cmyk)/i;
// 讲题时要验算的是「有具体计算」的题（求 f(x)…、解方程、算式），不是「讲讲导数的定义」这种概念题。
const MATH_HINT = /(?:计算|算一下|算出|求(?!助|职|学)|解方程|方程组?[：:]|证明|=|[a-z]\s*\(\s*[a-z]\s*\)|\d+\s*[+\-×x*/÷^]\s*\d+|\d[^。？?\n]{0,20}多少|多少[^。？?\n]{0,20}\d)/i;

// 档位在流程里的强弱：base 只照打法做、不加硬门禁；boost 起按种类要证据；full 再多做几版；
// marathon 用 full 的证据标准（终审要打开成品）但不强派子任务，靠检查点里程碑推进。
const STRICT = {base: 0, boost: 1, full: 2, marathon: 2};

/**
 * 这几种活在这一档要的子任务（全开档）。roles 是必须做完的，caps 是允许派的上限。
 */
export function kindRoles(kinds = [], tier = 'boost') {
  const primary = kinds[0] || '';
  const roles = {}, caps = {};
  const cap = (role, count) => { caps[role] = Math.max(caps[role] || 0, count); };
  if (primary === 'ideas') cap('drafter', 3);
  if (tier === 'full' || tier === 'marathon') {
    const required = tier === 'full';
    const need = (role, count, max = count) => { if (required) roles[role] = count; cap(role, max); };
    if (['writing', 'ideas'].includes(primary)) need('drafter', 2, 3);
    else if (['web_ui', 'app_game_ai', 'image_print', 'document', 'video_motion', 'craft'].includes(primary)) { need('drafter', 1); need('reviewer', 1); }
    else if (primary === 'data_charts') need('recomputer', 1, 2);
    // 有标准答案的题本来就有 2 个独立求解互相对照，复算只作可选，不再强派一个重复的。
    else if (primary === 'standard_answer') cap('recomputer', 2);
    else if (['code', 'debugging', 'automation'].includes(primary)) need('tester', 1);
    else if (primary === 'tutoring') need('drafter', 1);
  }
  return {roles, caps};
}

const GAP = {
  test_after_change: '缺少本轮测试命令及结果：改完之后还没跑测试或真运行一次',
  run_after_change: '还没真的启动或运行过一次',
  page_viewed: '改完的页面还没截图打开看过',
  mobile_viewed: '还没看过手机宽度的截图',
  screen_viewed: '还没截图打开看过运行起来的样子',
  scheduled: '要求自动运行，但还没看到注册成定时或常驻的输出',
  ran_once: '还没在测试文件夹或 dry-run 上真跑过一次',
  video_probe: '成片还没核对过时长或文件大小',
  video_frames: '成片还没抽帧打开看过',
  doc_opened: '交出去的文件本身还没打开或转成图片核对过',
  doc_pages_viewed: '交出去的文件还没转成页面图片打开看过',
  recomputed: '关键数字还没用程序算过',
  numbers_found: '回复里的关键数字在本轮计算输出里找不到',
  chart_viewed: '做出来的图表图片还没打开看过',
  image_viewed: '做出来的图片还没打开看过',
  print_checked: '要印刷的成品还没核对过尺寸和分辨率',
  fix_passed: '修完之后还没用同一步骤再跑一次看到通过',
  reproduced: '修之前还没复现到问题（失败输出或截图）',
  machine_probe: '本轮还没跑检测或版本命令（TOOLS.md 里的旧记录不算）',
  public_url: '发布后的公开地址还没从外面打开过',
  craft_checked: '做出来的东西还没真的打开或运行过',
  tutoring_checked: '讲解里的关键计算还没验算过',
};
export const WORK_GAPS = Object.freeze(GAP);

function lastSeq(rows, predicate) {
  let last = -Infinity;
  for (const row of rows) if (predicate(row.signals)) last = Math.max(last, row.seq);
  return last;
}
const hasProduced = (signals, ...groups) => groups.some(group => signals.has(`produced:${group}`));
const anySignal = (signals, ...names) => names.some(name => signals.has(name));
function after(rows, seq, predicate) {
  return rows.some(row => row.seq > seq && predicate(row.signals));
}
// 先截图、后打开图片：同一条（浏览器截图直接回图）或后面任意一条打开图片都算看过。
function viewedAfter(rows, seq, shotPredicate) {
  for (const row of rows) {
    if (row.seq <= seq || !shotPredicate(row.signals)) continue;
    if (row.signals.has('image_viewed')) return true;
    if (rows.some(later => later.seq > row.seq && later.signals.has('image_viewed'))) return true;
  }
  return false;
}

const YEARLIKE = /^(?:19|20)\d{2}$/;
function keyNumbers(text = '', exclude = '') {
  const skip = new Set((String(exclude || '').match(/\d+(?:\.\d+)?/g) || []).map(value => value.replace(/\.0+$/, '')));
  const values = (String(text || '').replace(/(\d),(?=\d{3})/g, '$1').match(/\d+(?:\.\d+)?%?/g) || [])
    .map(value => value.replace(/%$/, '').replace(/\.0+$/, ''))
    .filter(value => value.replace('.', '').length >= 3 && !YEARLIKE.test(value) && !skip.has(value));
  return [...new Set(values)].slice(0, 12);
}

/**
 * 这几种活在这一档还缺哪些证据。entries 是本轮的工具记录（成功失败都可以传，会自己挑）。
 * 返回 [{id, text}]；文字说的是用户能懂的缺口，续跑提示也直接用这句。
 */
export function evidenceGaps(kinds = [], tier = 'boost', entries = [], {prompt = '', reply = ''} = {}) {
  const level = STRICT[tier] ?? 1;
  if (level < 1) return [];
  const rows = signalRows(entries);
  const gaps = [];
  const add = (id) => { if (!gaps.some(gap => gap.id === id)) gaps.push({id, text: GAP[id]}); };
  const lastMutation = lastSeq(rows, s => s.has('mutation'));
  const changeSeq = (...groups) => lastSeq(rows, s => hasProduced(s, ...groups));
  const anyRow = (predicate) => rows.some(row => predicate(row.signals));
  for (const id of kinds) {
    if (id === 'code') {
      if (!after(rows, lastMutation === -Infinity ? Infinity : lastMutation, s => anySignal(s, 'test', 'run'))) add('test_after_change');
    } else if (id === 'web_ui') {
      const changed = Math.max(changeSeq('page'), lastMutation);
      if (!viewedAfter(rows, changed, s => s.has('screenshot'))) add('page_viewed');
      else if (level >= 2 && !viewedAfter(rows, changed, s => s.has('mobile_screenshot'))) add('mobile_viewed');
    } else if (id === 'app_game_ai') {
      const changed = lastMutation;
      if (!after(rows, changed, s => anySignal(s, 'run', 'test', 'browser_open', 'screenshot'))) add('run_after_change');
      if (!viewedAfter(rows, changed, s => s.has('screenshot'))) add('screen_viewed');
      else if (level >= 2 && MOBILE_HINT.test(prompt) && !viewedAfter(rows, changed, s => s.has('mobile_screenshot'))) add('mobile_viewed');
    } else if (id === 'automation') {
      const changed = lastSeq(rows, s => s.has('mutation') && hasProduced(s, 'script'));
      const base = changed === -Infinity ? lastMutation : changed;
      if (!after(rows, base, s => anySignal(s, 'run', 'test'))) add('ran_once');
      if (AUTO_HINT.test(prompt) && !anyRow(s => s.has('schedule_registered'))) add('scheduled');
    } else if (id === 'video_motion') {
      const made = changeSeq('video');
      if (!after(rows, made, s => s.has('render_probe'))) add('video_probe');
      if (!viewedAfter(rows, made, s => s.has('frames_extracted'))) add('video_frames');
    } else if (id === 'document') {
      const made = changeSeq('doc');
      const opened = rows.some(row => row.seq > made && [...row.signals].some(sig => /^opened_deliverable:(?:pptx?|key|docx?|pdf|odp|odt|pages|rtf)$/.test(sig)));
      if (!opened) add('doc_opened');
      else if (level >= 2 && !viewedAfter(rows, made, s => s.has('doc_render'))) add('doc_pages_viewed');
    } else if (id === 'data_charts') {
      if (!anyRow(s => anySignal(s, 'recomputed', 'test'))) add('recomputed');
      const chart = changeSeq('image');
      if (chart !== -Infinity && !after(rows, chart, s => s.has('image_viewed'))) add('chart_viewed');
      const numbers = keyNumbers(reply, prompt);
      if (numbers.length >= 2) {
        const outputs = (entries || []).map(entry => String(entry?.output || '').replace(/(\d),(?=\d{3})/g, '$1')).join('\n');
        if (!numbers.some(value => outputs.includes(value))) add('numbers_found');
      }
    } else if (id === 'image_print') {
      if (!after(rows, changeSeq('image'), s => s.has('image_viewed'))) add('image_viewed');
      if (PRINT_HINT.test(prompt) && !after(rows, changeSeq('image', 'doc'), s => s.has('print_probe'))) add('print_checked');
    } else if (id === 'debugging') {
      const firstMutation = rows.find(row => row.signals.has('mutation'))?.seq ?? Infinity;
      if (lastMutation === -Infinity) {
        if (!anyRow(s => anySignal(s, 'failed_run', 'run', 'test', 'screenshot', 'image_viewed', 'browser_open'))) add('reproduced');
      } else {
        if (!after(rows, lastMutation, s => anySignal(s, 'test', 'run', 'screenshot', 'browser_open'))) add('fix_passed');
        if (level >= 2 && !rows.some(row => row.seq < firstMutation && anySignal(row.signals, 'failed_run', 'failed_test', 'test', 'run', 'screenshot', 'image_viewed', 'browser_open', 'source'))) add('reproduced');
      }
    } else if (id === 'environment') {
      if (!anyRow(s => s.has('machine_probe'))) add('machine_probe');
    } else if (id === 'publish') {
      if (!after(rows, Math.max(lastMutation, lastSeq(rows, s => s.has('deploy'))), s => s.has('public_url_ok'))) add('public_url');
    } else if (id === 'craft') {
      if (!after(rows, lastMutation, s => anySignal(s, 'image_viewed', 'run', 'test', 'render_probe', 'doc_render', 'browser_open') || [...s].some(sig => sig.startsWith('opened_deliverable:')))) add('craft_checked');
    } else if (id === 'tutoring') {
      if (MATH_HINT.test(prompt) && level >= 1 && !anyRow(s => anySignal(s, 'recomputed', 'run', 'test'))) add('tutoring_checked');
    }
  }
  return gaps;
}

// 进度面板上「已用 / 待用」的环节：每种活的环节名 + 判断是否真的用过。
const STAGES = {
  code: [['读懂代码', s => s.read], ['修改', s => s.mutated], ['改完测试', s => s.testedAfter]],
  web_ui: [['做页面', s => s.mutated], ['截图看过', s => s.pageViewed], ['手机宽度', s => s.mobileViewed]],
  app_game_ai: [['做出来', s => s.mutated], ['真运行', s => s.ran], ['截图看过', s => s.pageViewed]],
  automation: [['写好脚本', s => s.mutated], ['真跑一次', s => s.ran], ['注册成自动', s => s.scheduled]],
  video_motion: [['出片', s => s.has('produced:video')], ['核对时长', s => s.has('render_probe')], ['抽帧看过', s => s.framesViewed]],
  document: [['做出文件', s => s.has('produced:doc') || s.mutated], ['打开交付文件', s => s.docOpened], ['转图看过', s => s.docRendered]],
  data_charts: [['程序计算', s => s.has('recomputed')], ['出图表', s => s.has('produced:image')], ['看过图表', s => s.has('image_viewed')]],
  image_print: [['出图', s => s.has('produced:image') || s.mutated], ['打开看过', s => s.has('image_viewed')]],
  writing: [['写稿', s => s.replied], ['核对硬要求', s => s.replied]],
  ideas: [['几个方向', s => s.replied], ['给出推荐', s => s.replied]],
  debugging: [['复现', s => s.reproduced], ['修改', s => s.mutated], ['同一步骤复测', s => s.testedAfter]],
  environment: [['跑检测', s => s.has('machine_probe')]],
  publish: [['发布', s => s.has('deploy') || s.mutated], ['从外面打开', s => s.has('public_url_ok')]],
  craft: [['做出来', s => s.mutated], ['打开或运行过', s => s.checked]],
  tutoring: [['讲思路', s => s.replied], ['检查题', s => s.replied]],
};

export function workStages(kinds = [], entries = [], {replied = false} = {}) {
  const rows = signalRows(entries);
  const all = new Set(rows.flatMap(row => [...row.signals]));
  const lastMutation = lastSeq(rows, s => s.has('mutation'));
  const firstMutation = rows.find(row => row.signals.has('mutation'))?.seq ?? Infinity;
  const state = {
    has: (signal) => all.has(signal),
    read: rows.some(row => row.signals.has('source')),
    mutated: all.has('mutation'),
    testedAfter: lastMutation !== -Infinity && after(rows, lastMutation, s => anySignal(s, 'test', 'run')),
    ran: anyRowOf(rows, s => anySignal(s, 'run', 'test', 'browser_open')),
    pageViewed: viewedAfter(rows, -Infinity, s => s.has('screenshot')),
    mobileViewed: viewedAfter(rows, -Infinity, s => s.has('mobile_screenshot')),
    scheduled: all.has('schedule_registered'),
    framesViewed: viewedAfter(rows, -Infinity, s => s.has('frames_extracted')),
    docOpened: [...all].some(sig => sig.startsWith('opened_deliverable:')),
    docRendered: viewedAfter(rows, -Infinity, s => s.has('doc_render')),
    reproduced: rows.some(row => row.seq < firstMutation && anySignal(row.signals, 'failed_run', 'failed_test')),
    checked: anyRowOf(rows, s => anySignal(s, 'image_viewed', 'run', 'test', 'doc_render', 'browser_open')),
    replied,
  };
  const stages = [];
  for (const id of kinds) {
    for (const [label, used] of STAGES[id] || []) {
      if (stages.some(stage => stage.label === label)) continue;
      stages.push({label, used: Boolean(used(state))});
    }
  }
  return stages;
}
function anyRowOf(rows, predicate) { return rows.some(row => predicate(row.signals)); }

// ---------- 运行单片段 ----------

const TIER_NAMES = {base: '基础档', boost: '加强档', full: '全开档', marathon: '长跑档'};
export const tierName = (tier) => TIER_NAMES[tier] || '加强档';

// 每种活：步骤（3–4 条）+ 「算做完」要的证据（用户能懂的说法）。
const STEPS = {
  code: ['写代码/修 bug：先读相关代码和现有测试，想清楚怎么复现、怎么验证', '改动尽量小，只改和需求有关的地方', '改完跑测试；没有测试就真运行一次，看输出'],
  web_ui: ['先定给谁用、在电脑还是手机上看', '做好或改好页面；数据存本机、能导出备份', '改完截图（look-page，手机加 --mobile；没有就用打法里的 shot.py），用 read 打开截图亲眼看，不对就改'],
  app_game_ai: ['先做能直接打开的最小可用版本（游戏先做一关）', '真的启动或运行一次；游戏自己玩一局', '截图用 read 看过；说清装到手机或上架还差什么'],
  automation: ['先在测试文件夹或 dry-run 上真跑一次，不动真文件', '要「自动」就真的注册成定时或常驻（launchctl / 计划任务 / crontab），再查一次注册状态', '说清怎么停、日志在哪、出错会怎样'],
  video_motion: ['按片种选工具（代码动画 / 剪素材 / 图片做成片）', '先出 3–5 秒小样确认，再出全片', '抽帧拼图（look-video，没有就照打法用 ffmpeg）并用 read 看，ffprobe 核对时长和音轨'],
  document: ['先定交什么格式：要改的给 .docx / .pptx，要看的给 PDF', '用打法里的工具做出交付文件本身，不交 HTML 替身', '把交付的那个文件转成图片逐页看（look-doc，或打法里 soffice / PowerPoint / Keynote 导出 PDF 再转图）'],
  data_charts: ['原文件不动，结果另存新文件', '用程序算，不心算；关键数字换一种算法再对一遍', '图表标题写结论；做完打开图表图片看'],
  image_print: ['生图做底，中文字用代码排上去，不让生图写字', '原尺寸和缩小图各看一眼', '要印的按毫米尺寸加出血，导出后核对尺寸和分辨率'],
  writing: ['先定给谁看、在哪看、看完要他干嘛', '写完读一遍顺不顺；有字数、行数要求就逐条数清', '用户的每条硬要求都对一遍再交'],
  ideas: ['给 3 个真不同的方向，每个一句理由', '说出推荐哪个、为什么', '能做小样就做一个'],
  debugging: ['先复现，拿到失败输出或截图', '找到根因再改，改动尽量小', '用同一步骤再跑一次，看到通过'],
  environment: ['先跑一次 playbooks 里的 machine-check（Windows 用 .ps1）或版本命令，拿到现在的数据', '缺东西就装进用户空间或碧琪自己的环境，不动系统', '装完跑一下版本号；改好的用法记进 TOOLS.md'],
  publish: ['先问清给谁看、能不能公开', '选最省事的路发布，密钥不进网页', '发布后从外面真打开一次公开地址'],
  standard_answer: ['独立解，关键数字真的算出来', '用程序或换一种方法验算', '候选结论不一致时查到原因再交'],
  tradeoff: ['不同立场各写一版', '列出差异和代价', '交给用户选（可以说推荐哪个）'],
  fact_check: ['先找官方和一手来源，打开确认', '至少两个可区分的来源交叉核对', '写清查的日期和拿不准的地方'],
  tutoring: ['先弄清卡在哪', '讲思路和关键一步，不直接替他写答案', '讲完出一道小检查题'],
  craft: ['按 crafts.md 第二节五步：先弄清这一行怎么算好、找成熟工具、想好怎么亲眼看到结果', '先做最小的样子，对了再放大', '按第一步定的标准复查再交'],
  simple: ['简单问题：直接回答，不派子任务、不走流程；进度面板会显示「此问题无需多方案，已直接回答」'],
};
const PROOF = {
  code: '最后一次改动之后跑过测试或真运行过，看到通过的输出',
  web_ui: '改完的页面截图用 read 打开看过',
  app_game_ai: '真的启动或运行过，并且截图打开看过',
  automation: '真跑过一次；要求自动的，还要看到注册成功的输出',
  video_motion: '成片真的生成（核对过时长或大小），并且抽帧图打开看过',
  document: '交出去的那个 .pptx / .docx / .pdf 本身打开或转成图片看过',
  data_charts: '关键数字用程序算过、能在输出里找到；做了图就打开看过',
  image_print: '做好的图片用 read 打开看过；要印的还核对过尺寸和分辨率',
  writing: '用户的每条硬要求（字数、格式、语气、必须有的内容）都满足',
  ideas: '有几个真不同的方向和明确的推荐',
  debugging: '修完之后用同一步骤跑过并通过',
  environment: '本轮真跑过检测或版本命令（TOOLS.md 里的旧记录不算）',
  publish: '发布后的公开地址从外面真打开过（本机地址不算）',
  standard_answer: '关键结果用程序或第二种方法验算过',
  tradeoff: '回复里有代价对比，并交给用户选',
  fact_check: '两个可区分的来源，并说明拿不准的地方',
  tutoring: '讲解里的关键计算验算过，最后有检查题',
  craft: '做出来的东西真的打开或运行过',
  simple: '',
};
const FULL_EXTRA_PROOF = {
  web_ui: '；还要看过手机宽度（390 左右）的截图',
  document: '；还要每页转成图片看过',
  debugging: '；还要有修之前的失败输出或截图',
  app_game_ai: '；要在手机上用的还要看过手机宽度的截图',
};
const ROLE_PLAN = {
  writing: '派 2–3 个子任务，label 写「独立起草·1」「独立起草·2」，各走一个不同方向；比较后选最好的一版交，不拼接',
  ideas: '派 2–3 个子任务，label 写「独立起草·1」「独立起草·2」，各想一个方向；比较后给 2–3 个方向和推荐',
  hands: '动手前派 1 个「独立起草」写验收清单和最容易翻车的 3 处（清单写进检查点）；做完派 1 个「看图审稿」打开截图或成品挑毛病，只修被证实的问题',
  numbers: '派 1–2 个「独立复算」用不同方法算关键数字；对不上就查到原因再交',
  tester: '派 1 个「用户视角试用」按用户会怎么用去试（跑命令、点页面），失败就修完复测',
  tutoring: '派 1 个「独立起草」写另一种讲法 + 1 道检查题；不替用户答题',
};
function rolePlanFor(primary) {
  if (['writing', 'ideas', 'tutoring'].includes(primary)) return ROLE_PLAN[primary];
  if (['web_ui', 'app_game_ai', 'image_print', 'document', 'video_motion', 'craft'].includes(primary)) return ROLE_PLAN.hands;
  if (['data_charts', 'standard_answer'].includes(primary)) return ROLE_PLAN.numbers;
  if (['code', 'debugging', 'automation'].includes(primary)) return ROLE_PLAN.tester;
  return '';
}

function playbookLine(kinds, {playbookRoot = '', mode = ''} = {}) {
  if (mode === 'none') return '';
  const files = [...new Set(kinds.flatMap(id => WORK_KINDS[id]?.playbooks || []))].slice(0, 3);
  if (!files.length) return '';
  const join = (file) => playbookRoot ? `${String(playbookRoot).replace(/[\\/]+$/, '')}/playbooks/${file}` : `playbooks/${file}`;
  return `先完整读 ${files.map(join).join('、')}（写完整路径），照里面的做法和验收做。`;
}

/**
 * 运行单里「这种活怎么做」那一段：标题、读打法、步骤、算做完要的证据、全开档多做几版。
 * kinds 为空时（还没收到问题）只给一句。
 */
export function kindPlanSection(kinds = [], tier = 'boost', {playbookRoot = '', mode = ''} = {}) {
  const name = tierName(tier);
  if (!kinds.length) return [`【做事流程：${name}】`, '先认清这条请求是哪种活，再按系统随后给出的这种活的流程做。'];
  const primary = kinds[0];
  const label = kinds.map(kindLabel).filter(Boolean).join(' + ');
  const lines = [`【做事流程：${name} · ${label}】`];
  if (primary === 'simple') return [...lines, ...STEPS.simple];
  const book = playbookLine(kinds, {playbookRoot, mode});
  if (book) lines.push(book);
  const steps = [...STEPS[primary] || []];
  for (const id of kinds.slice(1)) {
    const extra = STEPS[id]?.at(-1);
    if (extra && !steps.includes(extra) && steps.length < 5) steps.push(extra);
  }
  steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  const level = STRICT[tier] ?? 1;
  const proofs = kinds.map(id => PROOF[id]).filter(Boolean);
  if (proofs.length) {
    const extra = level >= 2 ? kinds.map(id => FULL_EXTRA_PROOF[id] || '').join('') : '';
    lines.push(level >= 1
      ? `算做完要有：${proofs.join('；')}${extra}。系统会按本轮工具记录核对，缺了会推你补；拿不到就照实说没做完。`
      : `做完照打法自己的验收做一遍：${proofs.join('；')}。`);
  }
  if (tier === 'full') {
    const roles = rolePlanFor(primary);
    if (roles) lines.push(`全开档多做几版：${roles}。子任务只给原始需求和必要材料，不给你的草稿；批评要附反例、截图里的具体位置、失败输出或出处，没证据的丢弃。`);
  }
  return lines;
}

// 长跑档里程碑的「验证」写法：按这种活该怎么验。
export function milestoneCheck(kinds = []) {
  return PROOF[kinds[0]] || '怎么确认做好了';
}

// ---------- 子任务 ----------

export const WORK_ROLE_LABELS = Object.freeze({drafter: '独立起草', recomputer: '独立复算', reviewer: '看图审稿', tester: '用户视角试用'});
export const WORK_ROLES = Object.freeze(Object.keys(WORK_ROLE_LABELS));

export function roleFromLabel(text = '') {
  const value = String(text || '').toLowerCase();
  if (/drafter|\bdraft(?:ing)?\b|独立起草|起草/.test(value)) return 'drafter';
  if (/recomput|recalc|独立复算|复算|重算/.test(value)) return 'recomputer';
  if (/reviewer|看图审稿|审稿|看图/.test(value)) return 'reviewer';
  if (/\btester\b|user.?test|用户视角|试用|测试员/.test(value)) return 'tester';
  return '';
}

const DRAFT_ANGLES = {
  writing: ['照用户说的场景写最稳妥、最像真人的一版', '换一个切入角度或结构写（比如先讲故事、反着说、换一个读者视角）', '写一版更短、更有记忆点的'],
  ideas: ['从用户最可能在意的价值出发想一个方向', '从完全不同的气质或人群出发想一个方向', '想一个大胆、少见但说得通的方向'],
  tutoring: ['换一种讲法：用生活里的例子或画图的方式讲同一个知识点'],
};

// 子任务正文：只给原始需求和必要材料，不给父会话的草稿或猜测。
export function workRoleTask(role, {kinds = [], prompt = '', ordinal = 0, artifacts = [], candidates = []} = {}) {
  const primary = kinds[0] || '';
  const ask = `原始用户需求：\n${String(prompt || '').slice(0, 10_000)}`;
  if (role === 'drafter' && (primary === 'writing' || primary === 'ideas')) {
    const angles = DRAFT_ANGLES[primary];
    return [
      `你只负责独立起草一版，不看也不沿用别人的草稿。这一版的方向：${angles[ordinal % angles.length]}`,
      ask,
      primary === 'ideas'
        ? '输出：一个方向的名字/点子（可以 3–5 个同方向的候选），每个一句理由，最后一句说这个方向适合什么情况。'
        : '输出：完整的一版成稿，最后单独一行说这一版的取舍。用户有字数、行数、格式要求的，逐条满足并自己数清。',
    ].join('\n\n');
  }
  if (role === 'drafter' && primary === 'tutoring') {
    return [
      '你只负责写另一种讲法，不替用户答题，也不给出用户作业题的最终答案。',
      DRAFT_ANGLES.tutoring[0],
      ask,
      '输出：一段换了讲法的讲解（讲思路和关键一步），再出 1 道同类的小检查题，答案单独放在最后。',
    ].join('\n\n');
  }
  if (role === 'drafter') {
    return [
      `你只负责写验收清单，不动手做成品，不改任何文件。这是一件「${kindLabel(primary) || '动手的活'}」。`,
      ask,
      '输出三部分：①验收清单 5–8 条，每条能核对（写清看什么、多少算合格）；②最容易翻车的 3 处；③每条用什么工具怎么验证（截图、抽帧、转图片、真运行、重算……）。不写泛泛的建议。',
    ].join('\n\n');
  }
  if (role === 'recomputer') {
    return [
      '你只负责独立复算关键数字：用和常规不同的方法算（换公式、换工具、逐条手工核对一部分），可以运行程序；只读数据文件，不改原文件。',
      ask,
      '输出：每个关键数字的结果、你用的方法、能复核的计算过程或程序输出。算不出来的写明缺什么。',
    ].join('\n\n');
  }
  if (role === 'reviewer') {
    const list = artifacts.length ? `要打开核对的成品和截图：\n${artifacts.slice(0, 12).map(file => `- ${file}`).join('\n')}` : '先在工作目录里找到本轮做出来的成品和截图。';
    return [
      '你只负责看图审稿，挑真实存在的毛病，不重做、不改文件。用 read 打开截图和成品本身（网页看截图，文档看转出的页面图，视频看抽帧图）。',
      ask,
      list,
      '每条问题都要写清证据：在哪张图、第几页/第几帧、什么位置、看到了什么，或者引用失败输出。没有证据的猜测不要写；没有问题就写「没有发现问题」。最多 6 条，按严重程度排。',
    ].join('\n\n');
  }
  if (role === 'tester') {
    return [
      '你只负责按用户会怎么用去试，不修改代码或文件。真的跑命令、打开页面、点按钮、用一组真实输入走一遍。',
      ask,
      artifacts.length ? `本轮改动或做出的文件：\n${artifacts.slice(0, 12).map(file => `- ${file}`).join('\n')}` : '',
      '输出：每一步做了什么、实际输出是什么；失败就贴失败输出原文。最后一句：能不能交给用户用。',
    ].filter(Boolean).join('\n\n');
  }
  return '';
}

// 派子任务前的先后：审稿要等成品做出来，试用要等代码改出来。返回拦截原因，空串放行。
export function workRoleGate(role, entries = []) {
  const rows = signalRows(entries);
  const made = rows.some(row => row.signals.has('mutation') || [...row.signals].some(sig => sig.startsWith('produced:')));
  if (role === 'reviewer' && !made) return '先把成品做出来并截图或转成图片，再派看图审稿。';
  if (role === 'tester' && !made) return '先把代码或脚本改出来，再派用户视角试用。';
  return '';
}

// 审稿结果要有证据：图里的位置、页码帧号、引用的原文或失败输出；「没有发现问题」也算有效结果。
export function hasEvidenceBackedReview(text = '') {
  const value = String(text || '');
  const noFindings = /(?:没有发现问题|未发现问题|没有可证实的问题|没发现问题)/;
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .filter(line => !noFindings.test(line) && /(?:问题|错误|不对|遮挡|挡住|溢出|错位|对不齐|太小|太大|看不清|乱码|方框|截断|缺|漏|重叠|模糊|不一致|失败|报错)/.test(line));
  if (!lines.length) return noFindings.test(value);
  const evidence = /(?:第\s*\d+\s*(?:页|帧|张|行|秒|屏)|截图|图里|图中|画面|左上|右上|左下|右下|顶部|底部|中间|标题|按钮|「[^」]{1,40}」|“[^”]{1,40}”|"[^"]{1,40}"|\.(?:png|jpe?g|webp|pdf|pptx|docx|html?)\b|https?:\/\/|输出|报错|失败的?(?:测试|命令))/;
  return lines.every(line => evidence.test(line));
}

// 本轮做出来的文件和截图（给审稿员和看图审稿子任务打开用）。entries 是工具记录。
export function artifactPaths(entries = [], {limit = 16} = {}) {
  const found = [];
  const push = (file) => {
    const value = String(file || '').trim();
    if (!value || found.includes(value) || /(?:^|[\\/])node_modules[\\/]/.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return;
    if (!/\.(?:html?|pptx?|key|docx?|pdf|xlsx|xlsm|xls|csv|mp4|mov|m4v|webm|gif|mp3|wav|m4a|png|jpe?g|webp|svg)$/i.test(value)) return;
    found.push(value);
  };
  for (const entry of linkBackgroundRuns(entries)) {
    const n = normalizeEntry(entry);
    if (!n.ok) continue;
    for (const file of paramPaths(n)) push(file);
    if (n.command) for (const file of pathsIn(n.command)) push(file);
    for (const file of producedPaths(n.command, n.output)) push(file);
    // 「截图：index.preview.png」「预览图（9 帧）：x.preview.png」「"path":"/tmp/…png"」这几行里的文件。
    for (const line of n.output.slice(0, 2400).split(/\r?\n/)) {
      if (/(?:截图|预览图|SAVED|Saved|saved|wrote|写入|已保存|保存到|导出|输出|output|"path")/i.test(line)) for (const file of pathsIn(line)) push(file);
    }
  }
  return found.slice(-limit);
}

// 从对话消息（runEmbeddedAgent / agent_end 的 messages）里取工具记录，形状和 captureVerificationEvidence 一样。
export function entriesFromMessages(messages = []) {
  const calls = new Map();
  const rows = [];
  let sequence = 0;
  const textOf = (content) => typeof content === 'string' ? content
    : Array.isArray(content) ? content.map(part => part?.type === 'image' ? '{"type":"image"}' : String(part?.text || '')).join('\n') : '';
  for (const entry of Array.isArray(messages) ? messages : []) {
    const message = entry?.message && typeof entry.message === 'object' ? entry.message : entry;
    if (!message) continue;
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && ['toolCall', 'tool_use', 'toolUse'].includes(part.type)) calls.set(part.id, {name: part.name, params: part.arguments ?? part.input ?? {}});
      }
    } else if (message.role === 'toolResult' || message.role === 'tool') {
      const call = calls.get(message.toolCallId) || {};
      const name = String(message.toolName || message.name || call.name || '');
      const output = textOf(message.content).slice(0, 2000);
      sequence += 1;
      rows.push({
        name, params: call.params || {}, output, sequence,
        ok: !(message.isError === true || message.error) && !/(?:"status"\s*:\s*"error"|command exited with code [1-9])/i.test(output),
        kind: /^(?:write|edit|apply_patch)$/i.test(name) ? 'mutation' : /^(?:plan_update|update_plan)$/i.test(name) ? 'note' : '',
      });
    }
  }
  return rows;
}

// ---------- 九档补强用 ----------

// 独立起草（reasoning.mjs 的独立解答 pass）按种类换用途：答题类独立解答、动手类写验收清单、文字类独立写一版。
export function solverModeFor(kinds = []) {
  const primary = kinds[0] || '';
  if (WORK_KINDS[primary]?.solver === 'draft') return 'draft';
  if (isHandsOnKind(primary)) return 'checklist';
  return 'answer';
}

// Adaptive：动手的活、报错、写代码、硬性计数写作按难题（XHigh 路线），一句话聊天按简单。
export function adaptiveHint(kinds = []) {
  const primary = kinds[0] || '';
  if (!primary || primary === 'pending') return '';
  if (primary === 'simple') return 'easy';
  if (isHandsOnKind(primary)) return 'hard';
  return '';
}

// 一个字的终稿：做了很多工具调用，最后只吐出几个字（REPORT 第九节「碧」）。
export function truncatedFinal(reply = '', toolCount = 0) {
  const text = String(reply || '').trim();
  if (toolCount < 5 || !text) return false;
  if (/^(?:NO_REPLY|HEARTBEAT_OK)$/i.test(text) || /MEDIA:|```|https?:\/\//i.test(text)) return false;
  return [...text.replace(/\s/g, '')].length < 10;
}
