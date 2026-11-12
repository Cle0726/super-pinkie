import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND_IDS, WORK_KINDS, classifyWorkKind, evidenceSignals, evidenceGaps, refineKinds, kindRoles, kindPlanSection,
  workStages, workRoleTask, workRoleGate, hasEvidenceBackedReview, artifactPaths, entriesFromMessages, linkBackgroundRuns,
  solverModeFor, adaptiveHint, truncatedFinal, clipToolOutput, producedPaths, roleFromLabel, milestoneCheck, legacyKinds,
  WHILE_WAITING, waitingSection,
} from '../services/mode-architecture/work-kinds.mjs';

// ---------- 分类：真实说法 ----------
// [说法, 期望主活, 模式（默认 chat）]。零基础口语、半句、错别字、粘贴原文、英文、只读、「继续」、问档位本身。
const CORPUS = [
  // code
  ['帮我改一下这个函数，让它支持负数', 'code'],
  ['加个功能：导出的时候带上日期', 'code'],
  ['把 utils.js 里那个 parseDate 重构一下', 'code'],
  ['写一个函数判断是不是闰年，带单元测试', 'code'],
  ['implement a function that merges two sorted lists, with unit tests', 'code'],
  ['帮我写个命令行工具，输入城市名输出天气', 'code'],
  ['这个正则写得不对，帮我改改', 'code'],
  ['写一个记账脚本并测试', 'code'],
  ['修复这个 bug 并运行测试', 'code'],
  ['修复测试失败的 bug，并运行相关测试', 'code'],
  ['调整 services/mode-architecture/index.mjs 的思考档位流程', 'code'],
  // web_ui
  ['做个网页', 'web_ui'],
  ['想要个个人网站', 'web_ui'],
  ['帮我做个记账的', 'web_ui'],
  ['这个页面好丑，帮我改好看点', 'web_ui'],
  ['手机上看着乱糟糟的，调一下', 'web_ui'],
  ['做一个待办清单小工具，数据存本地', 'web_ui'],
  ['做个落地页介绍我的烘焙店', 'web_ui'],
  ['make a landing page for my bakery', 'web_ui'],
  ['做个房贷计算器', 'web_ui'],
  ['首页按钮太小了字也对不齐', 'web_ui'],
  ['做个网页然后发到网上', 'web_ui'],
  ['只看看这个页面哪里丑，先别改', 'web_ui'],
  ['做个网页介绍我的店，配上文案', 'web_ui'],
  ['做一个待办网页并写自动化测试', 'web_ui'],
  ['做一个能增删改查、数据存本地的待办网页，带自动化测试', 'web_ui'],
  ['帮我做个简历网站并部署到 github pages', 'web_ui'],
  ['帮我做个背单词的网页', 'web_ui', 'learning'],
  // app_game_ai
  ['做个打地鼠小游戏', 'app_game_ai'],
  ['帮我做个微信小程序，记录孩子身高', 'app_game_ai'],
  ['做一个能接 deepseek 的聊天机器人', 'app_game_ai'],
  ['写个 chrome 插件，自动把网页翻成中文', 'app_game_ai'],
  ['做个桌面软件，番茄钟', 'app_game_ai'],
  ['做一个贪吃蛇游戏', 'app_game_ai'],
  ['我想做个 app 记录每天喝水', 'app_game_ai'],
  ['build a chatbot for my shop that answers FAQs', 'app_game_ai'],
  // automation
  ['每天早上 8 点自动把下载文件夹整理一下', 'automation'],
  ['帮我弄个能自动整理下载文件夹的东西', 'automation'],
  ['批量改名：把这些照片按日期重命名', 'automation'],
  ['监控这个网页的价格，降价了提醒我', 'automation'],
  ['每周五自动备份我的文档到移动硬盘', 'automation'],
  ['帮我抓一下这个网站的商品价格存到表格', 'automation'],
  ['开机自动打开微信和浏览器', 'automation'],
  ['automate renaming my screenshots every day', 'automation'],
  ['写个 Python 脚本每天自动备份数据库', 'automation'],
  ['帮我写个爬虫抓豆瓣评分', 'automation'],
  ['压缩一下这些图片', 'automation'],
  ['写个脚本把图片批量加水印', 'automation'],
  // video_motion
  ['剪个视频，30 秒，加字幕', 'video_motion'],
  ['做个片头动画', 'video_motion'],
  ['给这段视频配音配乐', 'video_motion'],
  ['把这些照片做成一个卡点视频', 'video_motion'],
  ['做条抖音短视频介绍新品', 'video_motion'],
  ['帮我剪掉视屏开头的 5 秒', 'video_motion'],
  ['make a 15 second intro video for my channel', 'video_motion'],
  ['给视频加中文字幕', 'video_motion'],
  // 11-04 技能路由实测：以前被当成闲聊
  ['剪一个30秒的抖音广告 卖咖啡', 'video_motion'],
  ['帮我配个bgm', 'video_motion'],
  // document
  ['帮我做个 5 页左右的 PPT，给新店员讲讲秋季新品', 'document'],
  ['改一下我的简历', 'document'],
  ['做份年终汇报的幻灯片', 'document'],
  ['给公司写一份年度规划方案', 'document'],
  ['把这份报告排版成 Word', 'document'],
  ['帮我把讲义导出成 pdf', 'document'],
  ['写一份合同，租房用的', 'document'],
  ['做个课件，讲二次函数', 'document'],
  ['make slides for my team meeting', 'document'],
  ['ppt做好看点', 'document'],
  ['做个PPt', 'document'],
  ['这个PPT的字太小了', 'document'],
  // data_charts
  ['写个 python 脚本把 csv 里的手机号去重', 'data_charts'],
  ['帮我统计一下这个月的开销', 'data_charts'],
  ['做个图表看看销量趋势', 'data_charts'],
  ['把成绩单整理一下算平均分', 'data_charts'],
  ['excel 里两列对比一下找出不同', 'data_charts'],
  ['做个销售看板', 'data_charts'],
  ['帮我分析一下这份工资表', 'data_charts'],
  ['plot the monthly revenue from this csv', 'data_charts'],
  ['把这个表格按部门汇总', 'data_charts'],
  ['excle表格帮我算下总和', 'data_charts'],
  ['帮我做个月度预算表', 'data_charts'],
  // image_print
  ['做张海报，周末促销', 'image_print'],
  ['帮我设计个 logo', 'image_print'],
  ['做个头像，可爱一点', 'image_print'],
  ['做一套表情包', 'image_print'],
  ['做个名片要印出来', 'image_print'],
  ['给公众号做个封面图', 'image_print'],
  ['帮我把这张照片抠图换背景', 'image_print'],
  ['design a poster for our concert', 'image_print'],
  ['做个菜单要打印', 'image_print'],
  ['给我的奶茶店起个名字，再做个 logo', 'image_print'],
  ['帮我做个开业物料：海报、朋友圈文案、一条短视频', 'image_print'],
  // writing
  ['写段文案', 'writing'],
  ['帮我写个小红书文案，推荐我们的桂花拿铁', 'writing'],
  ['润色一下这段话：我们公司成立于2010年，一直致力于为客户提供优质的服务和产品，欢迎大家前来参观指导。', 'writing'],
  ['翻译成英文：今天天气很好，我们一起去公园散步吧，顺便买点水果回来，晚上做个水果沙拉。', 'writing'],
  ['写封邮件跟客户道歉，发货晚了', 'writing'],
  ['写个演讲稿，三分钟，讲坚持', 'writing'],
  ['写一首五言绝句：4 行，每行恰好 5 个汉字', 'writing'],
  ['帮我写个朋友圈，祝我妈生日快乐', 'writing'],
  ['write an email to my landlord about the broken heater', 'writing'],
  ['把这段改得口语一点', 'writing'],
  ['写个周报', 'writing'],
  ['给我写一段 100 字左右的自我介绍', 'writing'],
  ['写个文案，不要做成网页', 'writing'],
  ['帮我把下面的进度报告翻译成英文：\n本周完成了登录模块的开发，测试全部通过；已修复 3 个 bug，部署到测试环境；下周计划完成支付模块。', 'writing'],
  ['给孩子出 10 道两位数加法题', 'writing'],
  ['把 report.md 写成 3 段', 'writing'],
  ['帮我写个小红书文案', 'writing', 'learning'],
  // ideas
  ['给我的奶茶店想个名字', 'ideas'],
  ['起个名字，宠物店的', 'ideas'],
  ['出几个公司年会的点子', 'ideas'],
  ['帮我策划一个周末亲子活动', 'ideas'],
  ['给我的猫取个名', 'ideas'],
  ['brainstorm names for a coffee shop', 'ideas'],
  ['小红书选题给点灵感', 'ideas'],
  ['帮我想想周末去哪玩', 'ideas'],
  // debugging
  ['报错了', 'debugging'],
  ['这个网页打不开', 'debugging'],
  ['运行的时候 Traceback (most recent call last): File "a.py", line 3', 'debugging'],
  ['为什么点按钮没反应', 'debugging'],
  ['程序跑不起来，一直闪退', 'debugging'],
  ['npm install 失败了', 'debugging'],
  ['结果不对，平均数算错了', 'debugging'],
  ['my script crashes with an error', 'debugging'],
  ['页面白屏了', 'debugging'],
  ['ppt 打不开了', 'debugging'],
  // environment
  ['能装 ffmpeg 吗', 'environment'],
  ['我电脑好卡', 'environment'],
  ['这台电脑能不能跑本地模型', 'environment'],
  ['帮我装个 python', 'environment'],
  ['硬盘快满了，清理一下空间', 'environment'],
  ['内存够不够剪 4K 视频', 'environment'],
  ['install playwright for me', 'environment'],
  ['我的电脑配置怎么样', 'environment'],
  ['这台 mac 能装 windows 吗', 'environment'],
  // publish
  ['发到网上给朋友看', 'publish'],
  ['把这个网站部署到服务器上', 'publish'],
  ['给我一个链接，别人也能打开', 'publish'],
  ['弄个域名绑上去', 'publish'],
  ['deploy this site to vercel', 'publish'],
  ['用 github pages 发布一下我的作品集', 'publish'],
  ['我想让外地的爸妈也能打开这个相册网页，怎么弄成一个链接', 'publish'],
  ['把做好的小游戏挂到网上', 'publish'],
  ['put my portfolio online so anyone can open it', 'publish'],
  // standard_answer
  ['求方程 x + 4 = 9', 'standard_answer'],
  ['证明根号 2 是无理数', 'standard_answer'],
  ['掷两个骰子点数和为 7 的概率是多少', 'standard_answer'],
  ['算一下 37 × 48 等于多少', 'standard_answer'],
  ['solve for x: 3x - 7 = 11', 'standard_answer'],
  ['一个逻辑题：甲乙丙三人只有一人说真话……', 'standard_answer'],
  ['这题怎么算', 'standard_answer'],
  // tradeoff
  ['比较这两个方案的成本', 'tradeoff'],
  ['MacBook Air 和 Pro 选哪个', 'tradeoff'],
  // 11-02 隔离实测：剪视频、写代码是买来干嘛，不是要做的活
  ['MacBook Air 和 MacBook Pro 我该买哪个？主要剪视频和写代码', 'tradeoff'],
  ['想买个显示器，主要用来剪视频，哪款好', 'tradeoff'],
  ['租房还是买房划算', 'tradeoff'],
  ['vue 和 react 哪个更适合新手', 'tradeoff'],
  ['should I buy the iPhone or the Pixel', 'tradeoff'],
  ['A 方案和 B 方案的优缺点', 'tradeoff'],
  ['这两个耳机哪个音质好', 'tradeoff'],
  // fact_check
  ['核实这个事实并给出处', 'fact_check'],
  ['喝咖啡致癌是真的吗', 'fact_check'],
  ['iPhone 最新版本是多少', 'fact_check'],
  ['现在黄金多少钱一克', 'fact_check'],
  ['iPhone 最新系统版本是多少', 'fact_check'],
  ['安卓最新版本是多少', 'fact_check'],
  ['iPhone 和安卓手机选哪个', 'tradeoff'],
  ['买安卓还是苹果', 'tradeoff'],
  ['做个网页对比 A 和 B 哪个划算', 'web_ui'],
  ['is it true that goldfish have 3 second memory', 'fact_check'],
  ['这个政策什么时候开始执行', 'fact_check'],
  // tutoring（学习模式）
  ['这道题怎么做：求 f(x)=x^3 的导数', 'tutoring', 'learning'],
  ['给我讲讲单调性', 'tutoring', 'learning'],
  ['没听懂极限的定义', 'tutoring', 'learning'],
  ['出几道专升本英语的题', 'tutoring', 'learning'],
  ['请解释闭包是什么', 'tutoring', 'learning'],
  ['帮我排一下复习计划', 'tutoring', 'learning'],
  ['教我背单词的方法', 'tutoring', 'learning'],
  ['这题怎么算', 'tutoring', 'learning'],
  ['帮我写篇英语作文', 'tutoring', 'learning'],
  // craft（没见过的活，按 crafts.md 兜底）
  ['帮我弄个家庭相册的东西', 'craft'],
  ['帮我做个树莓派温度报警器', 'craft'],
  ['帮我做个婚礼请柬的东西', 'craft'],
  ['做个给奶奶用的大字时钟', 'craft'],
  ['帮我做个宝宝成长纪念册', 'craft'],
  ['做一个点菜的东西给我家餐馆用', 'craft'],
  ['帮我做个抽奖的', 'craft'],
  // simple
  ['你好', 'simple'],
  ['谢谢', 'simple'],
  ['在吗', 'simple'],
  ['你是什么模型？', 'simple'],
  ['几点了', 'simple'],
  ['请解释闭包是什么', 'simple'],
  ['全开档和加强档有什么区别？', 'simple'],
  ['长跑档是什么意思', 'simple'],
  ['ok', 'simple'],
  ['早上好！', 'simple'],
  ['我想学剪辑，从哪开始', 'simple'],
  ['你会做视频吗', 'simple'],
  // 只说「继续」：交给调用方沿用上一条
  ['继续', 'pending'],
];

test('the corpus of real requests lands on the right kind of work', () => {
  const misses = CORPUS
    .map(([text, expected, mode = 'chat']) => [text, expected, classifyWorkKind(text, {mode}).kind])
    .filter(([, expected, got]) => expected !== got);
  assert.deepEqual(misses, []);
  assert.ok(CORPUS.length >= 150, `${CORPUS.length} requests`);
  const counts = {};
  for (const [, expected] of CORPUS) counts[expected] = (counts[expected] || 0) + 1;
  for (const id of KIND_IDS) assert.ok((counts[id] || 0) >= 6, `${id} has ${counts[id] || 0} requests`);
});

test('classification reads attachments, ignores pasted source text and negated asks, and hands continuations back', () => {
  assert.equal(classifyWorkKind('帮我看看\n[media attached: /Users/me/Downloads/季度汇报.pptx (application/vnd.openxmlformats-officedocument.presentationml.presentation)]').kind, 'document');
  assert.equal(classifyWorkKind('按部门汇总一下 <file name="工资.xlsx">a,b</file>').kind, 'data_charts');
  assert.equal(classifyWorkKind('这个怎么弄\n[media attached: /tmp/clip.mp4]').kind, 'video_motion');
  // 粘贴来翻译的原文里有「网页」「部署」，按「翻译」那句分。
  assert.equal(classifyWorkKind('翻译成英文：\n我们的网页已经部署到服务器上，下周会做一个新的 PPT 给客户讲解数据看板的用法，请大家提前准备好各自负责的材料，周五之前发给我汇总。').kind, 'writing');
  assert.deepEqual(classifyWorkKind('写个文案，不要做成网页').kinds, ['writing']);
  const again = classifyWorkKind('继续');
  assert.deepEqual([again.kind, again.continuation], ['pending', true]);
  assert.equal(classifyWorkKind('好的，继续吧').continuation, true);
  assert.equal(classifyWorkKind('').kind, 'pending');
  // 问档位本身是简单问答，不按网页、文档走流程。
  assert.equal(classifyWorkKind('全开档做网页和加强档有啥不同？').kind, 'simple');
  // 学习模式：讲题优先；明确要做东西才按那种活。
  assert.equal(classifyWorkKind('出几道导数的练习题', {mode: 'learning'}).kind, 'tutoring');
  assert.equal(classifyWorkKind('帮我做个背单词的网页', {mode: 'learning'}).kind, 'web_ui');
});

test('one request with several deliverables keeps the main one first and the rest as extra kinds', () => {
  assert.deepEqual(classifyWorkKind('做个网页然后发到网上').kinds, ['web_ui', 'publish']);
  assert.deepEqual(classifyWorkKind('这个网页打不开').kinds, ['debugging', 'web_ui']);
  assert.deepEqual(classifyWorkKind('帮我做个简历网站并部署到 github pages').kinds, ['web_ui', 'publish'], 'the résumé is the site content, not a Word file');
  assert.deepEqual(classifyWorkKind('把做好的小游戏挂到网上').kinds, ['publish'], 'nothing new to build: only the publish needs proof');
  assert.ok(classifyWorkKind('做一个待办网页并写自动化测试').kinds.includes('code'), 'a test the user asked for is evidence too');
  assert.ok(!classifyWorkKind('做个网页介绍我的店').kinds.includes('code'));
  const opening = classifyWorkKind('帮我做个开业物料：海报、朋友圈文案、一条短视频').kinds;
  assert.deepEqual(opening.slice(0, 1), ['image_print']);
  assert.ok(opening.includes('video_motion') && opening.includes('writing'));
  // 朋友圈是发到哪，不是另要一段文案；明说要文案、配文才另算文字活。
  assert.deepEqual(classifyWorkKind('做张周末促销海报，要发朋友圈').kinds, ['image_print']);
  assert.deepEqual(classifyWorkKind('做张海报，再写段朋友圈配文').kinds, ['image_print', 'writing']);
  // 只是问版本、问选哪个时，提到的产品名不另要动手证据。
  assert.deepEqual(classifyWorkKind('安卓最新版本是多少').kinds, ['fact_check']);
  assert.deepEqual(classifyWorkKind('iPhone 和安卓手机选哪个').kinds, ['tradeoff']);
});

// ---------- 证据信号：用真实记录的形状 ----------
// 形状照 index.mjs captureVerificationEvidence：{name, kind, params(JSON 字符串，≤2000 字), output(≤2000 字), ok, sequence}；
// 参数和输出照 tools/work-first-eval/results/ 里 Gemini 3.8 Flash 的真实工具调用。
let seq = 0;
function rec(name, params, output = '', {ok = true, kind = ''} = {}) {
  const command = String(params?.command || '');
  const guessed = kind || (/^(?:write|edit|apply_patch)$/.test(name) ? 'mutation'
    : name === 'exec' ? (/\btest\b|pytest|vitest|jest|playwright/.test(command) ? 'test' : 'command')
      : /^(?:plan_update)$/.test(name) ? 'note' : /read|search|web|browser|fetch|open|list/.test(name) ? 'source' : 'other');
  seq += 1;
  return {name, kind: guessed, params: JSON.stringify(params).slice(0, 2000), output: clipToolOutput(output), ok, sequence: seq, at: seq};
}
const sig = (entry) => evidenceSignals(entry).sort();
const P = '/Users/Admin/碧琪实测/20261101/r1/A-ugly-project';

test('page work: writes, look-page desktop and mobile, reading the screenshot, the app browser', () => {
  assert.deepEqual(sig(rec('write', {path: 'index.html', content: '<!doctype html>'}, `Successfully wrote 7973 bytes to ${P}/index.html`)), ['mutation', 'produced:page']);
  // 内容在前、参数被截到 2000 字时路径丢了：从写入结果里认。
  const long = rec('write', {content: '<!DOCTYPE html>'.padEnd(3000, 'x'), path: `${P}/index.html`}, `Successfully wrote 7007 bytes to ${P}/index.html`);
  assert.ok(!long.params.includes('"path"'));
  assert.deepEqual(sig(long), ['mutation', 'produced:page']);
  assert.deepEqual(sig(rec('edit', {edits: [{oldText: 'a', newText: 'b'}]}, `Successfully replaced 2 block(s) in ${P}/index.html.`)), ['mutation', 'produced:page']);
  assert.deepEqual(sig(rec('edit', {edits: []}, '{"status": "error", "tool": "edit", "error": "Could not find edits[0]"}', {ok: false})), []);
  const desk = rec('exec', {command: 'look-page index.html'}, '网页：index.html\n标题：我的小店，整页高度 1016px，电脑尺寸\n控制台报错：0 条\n截图：index.preview.png\n下一步：用 read 打开截图看效果；手机端加 --mobile 再看一次。');
  assert.ok(sig(desk).includes('screenshot'));
  assert.ok(!sig(desk).includes('mobile_screenshot'));
  assert.ok(!sig(desk).some(s => s.startsWith('produced:')), 'a preview screenshot is not a deliverable');
  const both = rec('exec', {command: 'look-page index.html && look-page index.html --mobile'}, '截图：index.preview.png\n标题：x，整页高度 844px，手机尺寸\n截图：index.mobile.preview.png');
  assert.ok(sig(both).includes('mobile_screenshot'));
  assert.deepEqual(sig(rec('read', {path: 'index.preview.png', limit: 10}, 'Read image file [image/png]')), ['image_viewed', 'source']);
  assert.deepEqual(sig(rec('read', {path: `${P}/slide_1.png`}, 'Read image file [image/jpeg]\n[Image: original 3840x2160, displayed at 2000x1125.]')), ['image_viewed', 'source']);
  assert.ok(!sig(rec('read', {path: 'index.html'}, '<!doctype html><html>')).includes('image_viewed'));
  const shot = rec('app_browser', {action: 'screenshot', fullPage: true}, '{"coordinateSpace":"document-image","message":"浏览器截图已保存，用 image 工具查看。","path":"/tmp/pinkie-snapshot-4a99/99bd.png","viewport":{"width":744,"height":610},"width":744,"height":1118,"ok":true}');
  assert.ok(sig(shot).includes('screenshot') && !sig(shot).includes('mobile_screenshot'));
  const phone = rec('app_browser', {action: 'screenshot'}, '{"path":"/tmp/pinkie-snapshot-4a99/a1.png","viewport":{"width":390,"height":844},"ok":true}');
  assert.ok(sig(phone).includes('mobile_screenshot'));
  // 看图工具读不到（路径不在允许目录）不算看过。
  assert.deepEqual(sig(rec('image', {image: '/tmp/pinkie-snapshot-4a99/99bd.png', prompt: '看排版'}, '{\n  "status": "error",\n  "tool": "image",\n  "error": "Local media path is not under an allowed directory: /tmp/x.png"\n}')), []);
  assert.ok(sig(rec('image', {image: `${P}/index.preview.png`, prompt: '看排版'}, '页面整体留白合理……')).includes('image_viewed'));
  // 11-02 隔离实测：自己写的 Playwright 脚本只在输出里说截了图；which look-page 只是看装没装；README 正文提到 index.html 不算改网页。
  assert.ok(sig(rec('exec', {command: 'python3 verify_e2e.py'}, 'Desktop screenshot generated: shot-desktop.png\nMobile screenshot generated: shot-mobile.png')).includes('screenshot'));
  assert.ok(sig(rec('exec', {command: 'python3 verify_e2e.py'}, 'E2E tests and screenshots updated cleanly.')).includes('screenshot'));
  assert.ok(!sig(rec('exec', {command: 'which look-page || true; python3 -c "import playwright"'}, '/usr/local/bin/look-page')).includes('screenshot'));
  assert.deepEqual(sig(rec('write', {path: `${P}/使用说明.md`, content: '双击 index.html 就能打开'}, `Successfully wrote 30 bytes to ${P}/使用说明.md`)), ['mutation']);
  const local = rec('app_browser', {action: 'open', url: `file://${P}/index.html`}, '{"open":true,"observation":{"readyState":"complete"}}');
  assert.ok(sig(local).includes('browser_open') && !sig(local).includes('public_url_ok'));
  assert.deepEqual(sig(rec('app_browser', {action: 'open', url: 'file:///x.html'}, '{"ok":false,"reason":"当前 App 的侧栏浏览器尚未连接"}', {ok: false})), []);
});

test('documents: the deliverable itself is made, read back, rendered to page images', () => {
  const make = rec('exec', {command: '/Users/Admin/碧琪实测/iso-wf/state/agent-env/bin/python3 generate_pptx.py'}, 'PPTX 成功生成并同步: 奶茶店秋季新品培训-新伙伴实操指引.pptx');
  assert.deepEqual(sig(make), ['produced:doc', 'run']);
  const readBack = rec('exec', {command: "/Users/Admin/碧琪实测/iso-wf/state/agent-env/bin/python3 -c \"\nimport pptx, pypdf\nprs = pptx.Presentation('奶茶店秋季新品培训-新伙伴实操指引.pptx')\nprint(f'PPTX Slide count: {len(prs.slides)}')\nreader = pypdf.PdfReader('奶茶店秋季新品培训-新伙伴实操指引.pdf')\nprint(f'PDF Page count: {len(reader.pages)}')\n\""}, 'PPTX Slide count: 5\n  Slide 1 notes length: 124 chars\nPDF Page count: 5');
  const read = sig(readBack);
  assert.ok(read.includes('opened_deliverable:pptx') && read.includes('opened_deliverable:pdf'));
  assert.ok(!read.some(s => s.startsWith('produced:')), 'reading a deck back is not making another one');
  const look = sig(rec('exec', {command: 'look-doc 季度汇报.pptx'}, '文档：季度汇报.pptx\n共 8 页\n预览图：季度汇报.preview.png'));
  assert.ok(look.includes('opened_deliverable:pptx') && look.includes('doc_render'));
  const soffice = sig(rec('exec', {command: 'soffice --headless --convert-to pdf 简历.docx && pdftoppm -png -r 80 简历.pdf page'}, 'convert 简历.docx -> 简历.pdf using filter : writer_pdf_Export'));
  assert.ok(soffice.includes('opened_deliverable:docx') && soffice.includes('doc_render'));
  assert.ok(sig(rec('pdf', {path: `${P}/report.pdf`}, '第 1 页：季度汇报……')).includes('opened_deliverable:pdf'));
  // 用网页替身渲染出来的页面图不是交付文件本身。
  const stand = sig(rec('exec', {command: 'python3 render_slides.py'}, '导出预览图: slide_1.png\n导出 PDF: /x/slides.pdf'));
  assert.ok(!stand.some(s => s.startsWith('opened_deliverable:')) && !stand.includes('doc_render'));
  assert.deepEqual(producedPaths('marp --pptx deck.md -o deck.pptx'), ['deck.pptx']);
  assert.deepEqual(producedPaths('python3 make.py', '图表已保存至: 各科平均成绩.png'), ['各科平均成绩.png']);
});

test('video, data, images, automation, machine checks and publishing each have their own proof', () => {
  const cut = sig(rec('exec', {command: 'ffmpeg -y -i raw.mp4 -ss 5 -c copy cut.mp4'}, 'frame=  300 fps=0.0 q=-1.0 Lsize=    2048kB time=00:00:10.00'));
  assert.ok(cut.includes('produced:video'));
  assert.ok(sig(rec('exec', {command: 'ffprobe -v error -show_entries format=duration visual_combined.mp4'}, '[FORMAT]\nduration=10.000000\n[/FORMAT]')).includes('render_probe'));
  const lookVideo = sig(rec('exec', {command: 'look-video osmanthus_latte_10s.mp4 9'}, '视频：osmanthus_latte_10s.mp4\n时长：10.0 秒，画面 1080x1920，音轨：aac\n预览图（9 帧，从左到右、从上到下按时间顺序）：osmanthus_latte_10s.preview.png'));
  assert.ok(lookVideo.includes('frames_extracted') && lookVideo.includes('render_probe'));
  assert.ok(!lookVideo.includes('produced:image'), 'the frame contact sheet is not a deliverable');
  assert.ok(sig(rec('exec', {command: 'python3 calc.py'}, '语文平均分: 81.40\n数学平均分: 81.60\n英语平均分: 82.80')).includes('recomputed'));
  assert.ok(sig(rec('exec', {command: "python3 -c \"import pandas as pd; print(pd.read_csv('a.csv').sum())\""}, 'total    1234')).includes('recomputed'));
  assert.ok(!sig(rec('exec', {command: 'ls -la'}, 'total 16\n-rw-r--r-- 1 Admin staff 19 Nov 1 08:29 a.csv')).includes('recomputed'));
  assert.deepEqual(sig(rec('image_generate', {prompt: 'A cute cat', aspectRatio: '1:1'}, 'Background task started for image generation (3a18b62e).')), ['produced:image']);
  assert.ok(sig(rec('exec', {command: 'sips -g pixelWidth -g pixelHeight -g dpiWidth poster.png'}, '  pixelWidth: 2480\n  dpiWidth: 300.000')).length >= 0);
  for (const command of ['launchctl load ~/Library/LaunchAgents/com.pinkie.tidy.plist', 'schtasks /create /tn tidy /tr C:\\tidy.cmd /sc daily /st 08:00', '(crontab -l 2>/dev/null; echo "0 8 * * * /usr/bin/python3 /Users/me/tidy.py") | crontab -']) {
    assert.ok(sig(rec('exec', {command}, '')).includes('schedule_registered') || sig(rec('exec', {command}, 'ok')).includes('schedule_registered'), command);
  }
  // 只查看、而且是空的：不算注册了。
  assert.ok(!sig(rec('exec', {command: 'crontab -l'}, 'crontab: no crontab for Admin')).includes('schedule_registered'));
  assert.ok(sig(rec('exec', {command: 'launchctl list | grep com.pinkie.tidy'}, '-\t0\tcom.pinkie.tidy')).includes('schedule_registered'));
  assert.ok(sig(rec('cron', {action: 'add', schedule: '0 8 * * *'}, '{"ok":true}')).includes('schedule_registered'));
  for (const command of ['bash ~/.openclaw/workspace/playbooks/machine-check.sh', 'python3 --version', 'which ffmpeg', 'sysctl -n hw.memsize', 'df -h /']) {
    assert.ok(sig(rec('exec', {command}, 'x 1')).includes('machine_probe'), command);
  }
  const deployed = sig(rec('exec', {command: 'vercel --prod --yes'}, 'Production: https://bakery-xyz.vercel.app [3s]'));
  assert.ok(deployed.includes('deploy'));
  assert.ok(sig(rec('exec', {command: 'curl -sI https://me.github.io/site/'}, 'HTTP/2 200\ncontent-type: text/html')).includes('public_url_ok'));
  assert.ok(!sig(rec('exec', {command: 'curl -sI http://127.0.0.1:54291/'}, 'HTTP/1.1 200 OK')).includes('public_url_ok'));
  assert.ok(sig(rec('web_fetch', {url: 'https://me.github.io/site/'}, '<html><title>我的小店</title> 每天新鲜出炉 ……')).includes('public_url_ok'));
  assert.ok(!sig(rec('web_fetch', {url: 'http://localhost:3000/'}, '<html><title>我的小店</title> ……')).includes('public_url_ok'));
  assert.deepEqual(sig(rec('plan_update', {items: [{id: 'step-1', status: 'completed'}]}, '{"title":"工作计划"}', {kind: 'note'})), ['note']);
});

test('tests and runs: failures are failures, and a run started in the background only counts when it finishes', () => {
  assert.deepEqual(sig(rec('exec', {command: 'npm test'}, '# tests 12\n# pass 12\n# fail 0')), ['test']);
  assert.deepEqual(sig(rec('exec', {command: 'npm test'}, '# fail 2\n(Command exited with code 1)', {ok: false})), ['failed_run', 'failed_test']);
  assert.ok(sig(rec('exec', {command: 'node app.js'}, 'listening on 3000')).includes('run'));
  // 后台启动：exec 只说「还在跑」。测试、重算都要等 process 回来的结果。
  const started = rec('exec', {command: 'npm test'}, 'Command still running (session dawn-glade, pid 29891). Use process (list/poll/log/write/send-keys/submit/paste/kill/clear/remove) for follow-up.');
  assert.ok(!sig(started).includes('test'));
  const calc = rec('exec', {command: 'python3 calc_and_plot.py'}, 'Command still running (session brisk-fox, pid 29892). Use process for follow-up.');
  assert.deepEqual(sig(calc), ['run'], 'a started script is running, nothing more yet');
  const still = rec('process', {action: 'poll', sessionId: 'brisk-fox', timeout: 5000}, '(no new output)\n\nProcess still running.');
  const done = rec('process', {action: 'poll', sessionId: 'brisk-fox', timeout: 5000}, 'Matplotlib is building the font cache; this may take a moment.\n语文平均分: 81.40\n数学平均分: 81.60\n英语平均分: 82.80\n图表已保存至: 各科平均成绩.png\n\n\nProcess exited with code 0.');
  assert.deepEqual(sig(done), [], 'on its own a poll does not know its command');
  const linked = linkBackgroundRuns([calc, still, done]);
  assert.equal(linked[1], still, 'a poll of a run still going is left alone');
  assert.equal(linked[2].name, 'exec');
  const after = sig(linked[2]);
  assert.ok(after.includes('recomputed') && after.includes('produced:image'), after.join(','));
  const failedPoll = rec('process', {action: 'poll', sessionId: 'dawn-glade'}, 'FAIL tests/a.test.js\n\nProcess exited with code 1.');
  assert.ok(sig(linkBackgroundRuns([started, failedPoll])[1]).includes('failed_test'));
  // 证据门禁按接上之后的结果判断。
  assert.deepEqual(evidenceGaps(['data_charts'], 'boost', [calc, still, done], {reply: '语文 81.4，数学 81.6，英语 82.8'}).map(gap => gap.id), ['chart_viewed']);
  assert.equal(clipToolOutput('a'.repeat(5000) + 'Process exited with code 0.').endsWith('Process exited with code 0.'), true);
  assert.equal(clipToolOutput('short'), 'short');
  assert.ok(clipToolOutput('x'.repeat(9000)).length <= 2000);
});

// ---------- 每档缺什么 ----------

const gapIds = (kinds, tier, entries, extra = {}) => evidenceGaps(kinds, tier, entries, extra).map(gap => gap.id);
const page = () => rec('write', {path: 'index.html', content: '<html>'}, `Successfully wrote 6 bytes to ${P}/index.html`);
const lookDesk = () => rec('exec', {command: 'look-page index.html'}, '截图：index.preview.png');
const lookPhone = () => rec('exec', {command: 'look-page index.html --mobile'}, '手机尺寸\n截图：index.mobile.preview.png');
const view = (file) => rec('read', {path: file}, 'Read image file [image/png]');

test('web pages: boost wants the changed page seen, full also wants the phone width, and a later edit resets it', () => {
  assert.deepEqual(gapIds(['web_ui'], 'boost', [page()]), ['page_viewed']);
  assert.deepEqual(gapIds(['web_ui'], 'boost', [page(), lookDesk()]), ['page_viewed'], 'taking a screenshot without opening it is not seeing it');
  const seen = [page(), lookDesk(), view('index.preview.png')];
  assert.deepEqual(gapIds(['web_ui'], 'boost', seen), []);
  assert.deepEqual(gapIds(['web_ui'], 'full', seen), ['mobile_viewed']);
  assert.deepEqual(gapIds(['web_ui'], 'marathon', seen), ['mobile_viewed'], 'marathon uses the full-tier standard');
  assert.deepEqual(gapIds(['web_ui'], 'full', [...seen, lookPhone(), view('index.mobile.preview.png')]), []);
  assert.deepEqual(gapIds(['web_ui'], 'boost', [...seen, page()]), ['page_viewed'], 'an edit after the look needs another look');
  assert.deepEqual(gapIds(['web_ui'], 'base', [page()]), [], 'base adds no hard gate');
  assert.equal(evidenceGaps(['web_ui'], 'boost', [page()])[0].text, '改完的页面还没截图打开看过');
  // 网页 + 发布：两样都要。
  assert.deepEqual(gapIds(['web_ui', 'publish'], 'boost', seen), ['public_url']);
  const live = [...seen, rec('exec', {command: 'npx gh-pages -d .'}, 'Published'), rec('web_fetch', {url: 'https://me.github.io/shop/'}, '<html><title>我的小店</title> 每天新鲜出炉')];
  assert.deepEqual(gapIds(['web_ui', 'publish'], 'boost', live), []);
});

test('documents: boost opens the deliverable itself, full also looks at every page as an image', () => {
  const make = rec('exec', {command: 'python3 generate_pptx.py'}, 'PPTX 成功生成并同步: 秋季新品.pptx');
  assert.deepEqual(gapIds(['document'], 'boost', [make]), ['doc_opened']);
  // 只看了网页替身渲染出来的图：不算看过交出去的 PPT。
  const stand = [make, rec('exec', {command: 'python3 render_slides.py'}, '导出预览图: slide_1.png'), view('slide_1.png')];
  assert.deepEqual(gapIds(['document'], 'boost', stand), ['doc_opened']);
  const readBack = rec('exec', {command: "python3 -c \"from pptx import Presentation; p = Presentation('秋季新品.pptx'); print(len(p.slides))\""}, '5');
  assert.deepEqual(gapIds(['document'], 'boost', [make, readBack]), []);
  assert.deepEqual(gapIds(['document'], 'full', [make, readBack]), ['doc_pages_viewed']);
  const rendered = [make, rec('exec', {command: 'look-doc 秋季新品.pptx'}, '共 5 页\n预览图：秋季新品.preview.png'), view('秋季新品.preview.png')];
  assert.deepEqual(gapIds(['document'], 'full', rendered), []);
  // 改了又生成一次：之前的核对作废。
  assert.deepEqual(gapIds(['document'], 'boost', [make, readBack, rec('exec', {command: 'python3 generate_pptx.py'}, 'PPTX 成功生成: 秋季新品.pptx 已保存到 /x/秋季新品.pptx')]), ['doc_opened']);
});

test('video, data, images, automation, environment, publishing, debugging, code and craft gaps', () => {
  const film = rec('exec', {command: 'ffmpeg -y -i a.mp4 -vf scale=1080:1920 out.mp4'}, 'frame=300');
  assert.deepEqual(gapIds(['video_motion'], 'boost', [film]), ['video_probe', 'video_frames']);
  const probed = [film, rec('exec', {command: 'ffprobe -v error -show_entries format=duration out.mp4'}, 'duration=10.000000')];
  assert.deepEqual(gapIds(['video_motion'], 'boost', probed), ['video_frames']);
  assert.deepEqual(gapIds(['video_motion'], 'boost', [...probed, rec('exec', {command: 'look-video out.mp4 9'}, '时长：10.0 秒\n预览图（9 帧）：out.preview.png')]), ['video_frames'], 'frames extracted but never opened');
  assert.deepEqual(gapIds(['video_motion'], 'boost', [...probed, rec('exec', {command: 'look-video out.mp4 9'}, '时长：10.0 秒\n预览图（9 帧）：out.preview.png'), view('out.preview.png')]), []);

  assert.deepEqual(gapIds(['data_charts'], 'boost', [], {reply: '平均 81.4'}), ['recomputed']);
  const calc = rec('exec', {command: 'python3 calc.py'}, '语文 81.40\n数学 81.60');
  assert.deepEqual(gapIds(['data_charts'], 'boost', [calc], {reply: '语文平均 81.4，数学 81.6'}), []);
  assert.deepEqual(gapIds(['data_charts'], 'boost', [calc], {reply: '语文平均 85.2，数学 90.3'}), ['numbers_found'], 'numbers the program never printed');
  const chart = rec('exec', {command: 'python3 plot.py'}, '已保存到 trend.png\n1200 1350');
  assert.deepEqual(gapIds(['data_charts'], 'boost', [chart]), ['chart_viewed']);
  assert.deepEqual(gapIds(['data_charts'], 'boost', [chart, view('trend.png')]), []);

  const art = rec('image_generate', {prompt: 'poster'}, 'Background task started');
  assert.deepEqual(gapIds(['image_print'], 'boost', [art]), ['image_viewed']);
  assert.deepEqual(gapIds(['image_print'], 'boost', [art, view('poster.png')]), []);
  assert.deepEqual(gapIds(['image_print'], 'boost', [art, view('poster.png')], {prompt: '做个名片要印出来'}), ['print_checked']);
  assert.deepEqual(gapIds(['image_print'], 'boost', [art, view('poster.png'), rec('exec', {command: 'sips -g pixelWidth -g dpiWidth card.png'}, 'pixelWidth: 1063\ndpiWidth: 300')], {prompt: '做个名片要印出来'}), []);

  const script = rec('write', {path: 'tidy.py', content: 'import os'}, 'Successfully wrote 9 bytes to /x/tidy.py');
  const prompt = '每天早上 8 点自动把下载文件夹整理一下';
  assert.deepEqual(gapIds(['automation'], 'boost', [script], {prompt}), ['ran_once', 'scheduled']);
  const dry = rec('exec', {command: 'python3 tidy.py --dry-run ~/Downloads-test'}, '将移动 12 个文件');
  assert.deepEqual(gapIds(['automation'], 'boost', [script, dry], {prompt}), ['scheduled']);
  assert.deepEqual(gapIds(['automation'], 'boost', [script, dry, rec('exec', {command: 'launchctl load ~/Library/LaunchAgents/com.pinkie.tidy.plist && launchctl list | grep tidy'}, '-\t0\tcom.pinkie.tidy')], {prompt}), []);
  assert.deepEqual(gapIds(['automation'], 'boost', [script, dry], {prompt: '批量改名：把这些照片按日期重命名'}), [], 'a one-off batch job does not need registering');

  assert.deepEqual(gapIds(['environment'], 'boost', []), ['machine_probe']);
  assert.deepEqual(gapIds(['environment'], 'boost', [rec('exec', {command: 'bash playbooks/machine-check.sh'}, '芯片：Apple M2\n内存：16 GB')]), []);

  assert.deepEqual(gapIds(['publish'], 'boost', [rec('app_browser', {action: 'open', url: 'http://127.0.0.1:54291/'}, '{"open":true}')]), ['public_url']);

  assert.deepEqual(gapIds(['debugging'], 'boost', []), ['reproduced']);
  const failing = rec('exec', {command: 'node app.js'}, "TypeError: Cannot read properties of undefined\n(Command exited with code 1)", {ok: false});
  const fix = rec('edit', {path: 'app.js', edits: []}, 'Successfully replaced 1 block(s) in /x/app.js.');
  const rerun = rec('exec', {command: 'node app.js'}, 'listening on 3000');
  assert.deepEqual(gapIds(['debugging'], 'boost', [fix]), ['fix_passed']);
  assert.deepEqual(gapIds(['debugging'], 'boost', [fix, rerun]), []);
  assert.deepEqual(gapIds(['debugging'], 'full', [fix, rerun]), ['reproduced'], 'full wants the failure seen before the fix');
  assert.deepEqual(gapIds(['debugging'], 'full', [failing, fix, rerun]), []);

  const early = rec('exec', {command: 'npm test'}, '# pass 3');
  const change = rec('edit', {path: 'utils.js', edits: []}, 'Successfully replaced 1 block(s) in /x/utils.js.');
  assert.deepEqual(gapIds(['code'], 'boost', [early, change]), ['test_after_change'], 'a test before the last change does not count');
  assert.deepEqual(gapIds(['code'], 'boost', [change, rec('exec', {command: 'npm test'}, '# pass 3')]), []);

  const made = rec('write', {path: 'album/index.html', content: '<html>'}, 'Successfully wrote 6 bytes to /x/album/index.html');
  assert.deepEqual(gapIds(['craft'], 'boost', [made]), ['craft_checked']);
  assert.deepEqual(gapIds(['craft'], 'boost', [made, rec('app_browser', {action: 'open', url: 'file:///x/album/index.html'}, '{"open":true}')]), []);

  assert.deepEqual(gapIds(['tutoring'], 'boost', [], {prompt: '求 f(x)=x^3 在 x=2 处的导数'}), ['tutoring_checked']);
  assert.deepEqual(gapIds(['tutoring'], 'boost', [], {prompt: '给我讲讲单调性'}), []);
  assert.deepEqual(gapIds(['tutoring'], 'boost', [], {prompt: '给我讲讲导数的定义'}), [], 'a concept question has nothing to recompute');
  assert.deepEqual(gapIds(['tutoring'], 'boost', [], {prompt: '掷两个骰子点数和为 7 的概率是多少'}), ['tutoring_checked']);
  for (const kind of ['writing', 'ideas', 'tradeoff', 'fact_check', 'standard_answer', 'simple']) {
    assert.deepEqual(gapIds([kind], 'full', []), [], `${kind} has no tool gate here`);
  }
});

// ---------- 过程中改判 ----------

test('the kind of work sharpens as the products show up, but only towards more specific', () => {
  const pptx = rec('exec', {command: 'python3 make.py'}, '已保存到 /x/汇报.pptx');
  assert.deepEqual(refineKinds(['simple'], pptx), ['document']);
  assert.deepEqual(refineKinds(['craft'], rec('exec', {command: 'ffmpeg -i a.mov out.mp4'}, 'frame=1')), ['video_motion']);
  assert.deepEqual(refineKinds(['writing'], pptx), ['writing', 'document'], 'a writing job that also hands over a deck keeps both');
  assert.equal(refineKinds(['web_ui'], rec('image_generate', {prompt: 'icon'}, 'started')), null, 'an icon made for a page does not turn it into a poster job');
  assert.equal(refineKinds(['code'], rec('write', {path: 'index.html'}, 'Successfully wrote 1 bytes to /x/index.html')), null);
  assert.deepEqual(refineKinds(['code'], rec('exec', {command: 'launchctl load ~/Library/LaunchAgents/com.x.plist'}, '')), ['code', 'automation']);
  assert.equal(refineKinds(['tutoring'], pptx), null, 'tutoring never turns into a making job');
  assert.equal(refineKinds(['simple'], pptx, {mode: 'none'}), null, 'unrestricted mode keeps the old five types');
  assert.equal(refineKinds(['document'], pptx), null, 'already the same kind');
});

// ---------- 全开档的子任务、运行单 ----------

test('the full tier asks each kind of work for its own extra versions', () => {
  assert.deepEqual(kindRoles(['writing'], 'full'), {roles: {drafter: 2}, caps: {drafter: 3}});
  assert.deepEqual(kindRoles(['ideas'], 'full').roles, {drafter: 2});
  assert.deepEqual(kindRoles(['ideas'], 'boost'), {roles: {}, caps: {drafter: 3}}, 'ideas may always try other directions');
  for (const kind of ['web_ui', 'app_game_ai', 'image_print', 'document', 'video_motion', 'craft']) {
    assert.deepEqual(kindRoles([kind], 'full').roles, {drafter: 1, reviewer: 1}, kind);
  }
  assert.deepEqual(kindRoles(['data_charts'], 'full'), {roles: {recomputer: 1}, caps: {recomputer: 2}});
  assert.deepEqual(kindRoles(['standard_answer'], 'full'), {roles: {}, caps: {recomputer: 2}}, 'two independent solves already cross-check');
  for (const kind of ['code', 'debugging', 'automation']) assert.deepEqual(kindRoles([kind], 'full').roles, {tester: 1}, kind);
  assert.deepEqual(kindRoles(['tutoring'], 'full').roles, {drafter: 1});
  assert.deepEqual(kindRoles(['web_ui'], 'marathon').roles, {}, 'marathon moves by milestones instead of forced helpers');
  assert.deepEqual(kindRoles(['web_ui'], 'marathon').caps, {drafter: 1, reviewer: 1});
  assert.deepEqual(kindRoles(['web_ui'], 'boost'), {roles: {}, caps: {}});
});

test('every tier and kind gets a short plan that names its playbook and its proof', () => {
  for (const tier of ['base', 'boost', 'full', 'marathon']) {
    for (const kind of KIND_IDS) {
      const text = kindPlanSection([kind], tier, {playbookRoot: '/Users/me/.openclaw/workspace-project'}).join('\n');
      assert.ok(text.length <= 1200, `${tier}/${kind}: ${text.length}`);
      assert.match(text, new RegExp(`【做事流程：.{2,3}档 · ${WORK_KINDS[kind].label.replace(/[/()]/g, '.')}】`));
      for (const book of WORK_KINDS[kind].playbooks) if (kind !== 'simple') assert.ok(text.includes(`/Users/me/.openclaw/workspace-project/playbooks/${book}`), `${tier}/${kind} reads ${book}`);
    }
  }
  const boost = kindPlanSection(['document'], 'boost').join('\n');
  assert.match(boost, /交出去的那个 \.pptx \/ \.docx \/ \.pdf 本身打开或转成图片看过/);
  assert.match(boost, /系统会按本轮工具记录核对/);
  assert.match(kindPlanSection(['document'], 'base').join('\n'), /做完照打法自己的验收做一遍/);
  assert.match(kindPlanSection(['document'], 'full').join('\n'), /每页转成图片看过[\s\S]*全开档多做几版：动手前派 1 个「独立起草」/);
  assert.match(kindPlanSection(['writing'], 'full').join('\n'), /独立起草·1/);
  assert.doesNotMatch(kindPlanSection(['web_ui'], 'marathon').join('\n'), /全开档多做几版/);
  assert.doesNotMatch(kindPlanSection(['web_ui'], 'boost', {mode: 'none'}).join('\n'), /playbooks\//, 'unrestricted mode reads no playbooks');
  assert.deepEqual(kindPlanSection([], 'boost'), ['【做事流程：加强档】', '先认清这条请求是哪种活，再按系统随后给出的这种活的流程做。']);
  assert.match(kindPlanSection(['simple'], 'full').join('\n'), /直接回答，不派子任务/);
  // 多种活：步骤和证据都带上附带活的。
  const both = kindPlanSection(['web_ui', 'publish'], 'boost').join('\n');
  assert.match(both, /网页 \/ 界面 \/ 小工具 \+ 放到网上/);
  assert.match(both, /发布后从外面真打开一次公开地址/);
  assert.equal(milestoneCheck(['video_motion']), '成片真的生成（核对过时长或大小），并且抽帧图打开看过');
});

// ---------- 子任务正文、先后、审稿证据 ----------

test('helper tasks get only the original request, and each role does its own job', () => {
  const ask = '帮我写个小红书文案，推荐我们的桂花拿铁';
  const one = workRoleTask('drafter', {kinds: ['writing'], prompt: ask, ordinal: 0});
  const two = workRoleTask('drafter', {kinds: ['writing'], prompt: ask, ordinal: 1});
  assert.ok(one.includes(ask) && two.includes(ask));
  assert.notEqual(one.split('\n')[0], two.split('\n')[0], 'each drafter takes a different direction');
  assert.match(one, /不看也不沿用别人的草稿/);
  assert.match(workRoleTask('drafter', {kinds: ['web_ui'], prompt: '做个网页'}), /只负责写验收清单，不动手做成品/);
  assert.match(workRoleTask('drafter', {kinds: ['tutoring'], prompt: '这题怎么做'}), /不替用户答题/);
  const review = workRoleTask('reviewer', {kinds: ['web_ui'], prompt: '做个网页', artifacts: ['/x/index.html', '/x/index.preview.png']});
  assert.match(review, /- \/x\/index\.preview\.png/);
  assert.match(review, /不重做、不改文件/);
  assert.match(workRoleTask('tester', {kinds: ['code'], prompt: '修 bug'}), /不修改代码或文件/);
  assert.match(workRoleTask('recomputer', {kinds: ['data_charts'], prompt: '算平均分'}), /只读数据文件，不改原文件/);
  assert.equal(workRoleTask('nobody', {kinds: ['code']}), '');
  assert.deepEqual(['drafter', 'recomputer', 'reviewer', 'tester'].map(role => roleFromLabel({drafter: '独立起草·1', recomputer: '独立复算', reviewer: '看图审稿·2', tester: '用户视角试用'}[role])), ['drafter', 'recomputer', 'reviewer', 'tester']);
  assert.equal(roleFromLabel('solver-1'), '');
});

test('a reviewer waits for something to look at, and its findings must point at evidence', () => {
  assert.match(workRoleGate('reviewer', []), /先把成品做出来/);
  assert.match(workRoleGate('tester', [rec('read', {path: 'a.js'}, 'x')]), /先把代码或脚本改出来/);
  assert.equal(workRoleGate('reviewer', [page()]), '');
  assert.equal(workRoleGate('drafter', []), '');
  assert.equal(hasEvidenceBackedReview('没有发现问题'), true);
  assert.equal(hasEvidenceBackedReview('1. 排版有问题，不够好看'), false);
  assert.equal(hasEvidenceBackedReview('1. 第 3 页标题被图片挡住了一半\n2. index.mobile.preview.png 里底部按钮溢出屏幕'), true);
  assert.equal(hasEvidenceBackedReview('1. 第 3 页标题被挡住\n2. 颜色有问题'), false, 'every finding needs its evidence');
  // 11-02 隔离实测 K-full-max-web：标题行写问题、证据写在下面的小点里，也算有证据
  assert.equal(hasEvidenceBackedReview('发现以下 2 处真实存在的问题：\n\n### 1. 移动端导航缺少菜单入口（严重）\n- 证据位置：shot-mobile.png 顶部导航栏\n- 看到现象：只剩店名\n\n### 2. 次级按钮边框过淡\n- 证据位置：shot-desktop.png 首屏按钮区'), true);
  assert.equal(hasEvidenceBackedReview('### 1. 标题被遮挡\n- 证据：shot.png 顶部\n### 2. 配色不一致\n- 感觉不太协调'), false, 'a finding block without any evidence still fails');
});

test('artifact paths and tool records come out of real message shapes', () => {
  const messages = [
    {role: 'user', content: '做个网页'},
    {role: 'assistant', content: [{type: 'toolCall', id: 'c1', name: 'write', arguments: {path: `${P}/index.html`, content: '<html>'}}]},
    {role: 'toolResult', toolCallId: 'c1', toolName: 'write', content: [{type: 'text', text: `Successfully wrote 6 bytes to ${P}/index.html`}], isError: false},
    {role: 'assistant', content: [{type: 'toolCall', id: 'c2', name: 'exec', arguments: {command: 'look-page index.html --mobile'}}]},
    {role: 'toolResult', toolCallId: 'c2', toolName: 'exec', content: [{type: 'text', text: '截图：index.mobile.preview.png'}], isError: false},
    {role: 'assistant', content: [{type: 'toolCall', id: 'c3', name: 'read', arguments: {path: 'index.mobile.preview.png'}}]},
    {role: 'toolResult', toolCallId: 'c3', toolName: 'read', content: [{type: 'text', text: 'Read image file [image/png]'}, {type: 'image', data: 'x'}]},
    {role: 'assistant', content: [{type: 'toolCall', id: 'c4', name: 'exec', arguments: {command: 'node -e "x"'}}]},
    {role: 'toolResult', toolCallId: 'c4', toolName: 'exec', content: [{type: 'text', text: 'not global\n\n(Command exited with code 1)'}], isError: true},
    {role: 'assistant', content: [{type: 'text', text: '做好了'}]},
  ];
  const entries = entriesFromMessages(messages);
  assert.deepEqual(entries.map(entry => [entry.name, entry.kind, entry.ok]), [['write', 'mutation', true], ['exec', '', true], ['read', '', true], ['exec', '', false]]);
  assert.deepEqual(gapIds(['web_ui'], 'full', entries), []);
  assert.deepEqual(artifactPaths(entries), [`${P}/index.html`, 'index.html', 'index.mobile.preview.png']);
  assert.deepEqual(artifactPaths([rec('exec', {command: 'ls node_modules/x/a.png'}, ''), rec('read', {path: 'notes.md'}, 'x')]), []);
});

test('nine-stop helpers: what an independent pass is for, adaptive hints, one-word finals, legacy types', () => {
  assert.equal(solverModeFor(['web_ui']), 'checklist');
  assert.equal(solverModeFor(['writing']), 'draft');
  assert.equal(solverModeFor(['ideas']), 'draft');
  assert.equal(solverModeFor(['standard_answer']), 'answer');
  assert.equal(solverModeFor([]), 'answer');
  assert.equal(adaptiveHint(['document']), 'hard');
  assert.equal(adaptiveHint(['simple']), 'easy');
  assert.equal(adaptiveHint(['writing']), 'normal');
  assert.equal(adaptiveHint(['standard_answer']), 'hard');
  assert.equal(adaptiveHint([]), '');
  assert.equal(truncatedFinal('碧', 5), true);
  assert.equal(truncatedFinal('碧', 4), false, 'few tools: a short answer can be the whole answer');
  assert.equal(truncatedFinal('好的，已经做完并截图核对过了。', 9), false);
  assert.equal(truncatedFinal('MEDIA:/x/a.png', 9), false);
  assert.equal(truncatedFinal('NO_REPLY', 9), false);
  assert.deepEqual(legacyKinds('implementation'), ['code']);
  assert.deepEqual(legacyKinds('pending'), []);
});

test('machines without the look-* tools: the playbook fallbacks count as the same proof', () => {
  // web-and-ui.md 第五节的 shot.py：桌面和手机各一张。
  const shot = sig(rec('exec', {command: 'python shot.py index.html'}, '截图：shot-desktop.png  shot-mobile.png\n控制台报错：无'));
  assert.ok(shot.includes('screenshot') && shot.includes('mobile_screenshot'), shot.join(','));
  assert.deepEqual(gapIds(['web_ui'], 'full', [page(), rec('exec', {command: 'python shot.py index.html'}, '截图：shot-desktop.png  shot-mobile.png'), view('shot-desktop.png'), view('shot-mobile.png')]), []);
  // Windows：PowerPoint 的 COM 导出 PDF，再 pdftoppm 转图。
  const com = sig(rec('exec', {command: '$a = New-Object -ComObject PowerPoint.Application; $p = $a.Presentations.Open("C:\\Users\\me\\秋季新品.pptx", $true, $false, $false); $p.SaveAs("C:\\Users\\me\\秋季新品.pdf", 32); $p.Close(); $a.Quit()'}, ''));
  assert.ok(com.includes('opened_deliverable:pptx') && com.includes('doc_render'), com.join(','));
  // Mac 没有 look-doc：Keynote 导出 PDF。
  const keynote = sig(rec('exec', {command: 'osascript -e \'tell application "Keynote" to export (open POSIX file "/Users/me/deck.pptx") to POSIX file "/Users/me/deck.pdf" as PDF\''}, ''));
  assert.ok(keynote.includes('opened_deliverable:pptx') && keynote.includes('doc_render'), keynote.join(','));
  assert.ok(sig(rec('exec', {command: "python3 -c \"from pdf2image import convert_from_path; [p.save(f'page{i}.png') for i, p in enumerate(convert_from_path('report.pdf'))]\""}, '')).includes('doc_render'));
  // 没有 look-video：ffmpeg 抽帧拼图（motion-and-video.md）。
  const frames = sig(rec('exec', {command: 'ffmpeg -i 成片.mp4 -vf "fps=9/10,scale=360:-1,tile=3x3" -frames:v 1 抽帧.png'}, ''));
  assert.ok(frames.includes('frames_extracted') && !frames.includes('produced:image'), frames.join(','));
  // Windows 的检测脚本和版本命令。
  assert.ok(sig(rec('exec', {command: 'powershell -ExecutionPolicy Bypass -File playbooks\\machine-check.ps1'}, 'CPU: 8 核')).includes('machine_probe'));
  assert.ok(sig(rec('exec', {command: 'Get-Command py, node -ErrorAction SilentlyContinue'}, 'py C:\\Windows\\py.exe')).includes('machine_probe'));
  // 运行单里提到没有 look-* 时怎么办。
  assert.match(kindPlanSection(['web_ui'], 'boost').join('\n'), /没有就用打法里的 shot\.py/);
});

test('a slide deck is checked on the deck itself, not on an HTML / PDF twin (isolated run K-deck-marathon)', () => {
  const made = rec('exec', {command: 'python3 generate_pptx.py'}, `PPTX 成功生成: ${P}/plan.pptx`);
  const twin = rec('exec', {command: 'python3 generate_pdf.py && pdfinfo plan.pdf'}, `已生成: ${P}/plan.pdf\nPages: 8`);
  const twinPages = rec('exec', {command: 'pdftoppm -png -r 150 plan.pdf slides_preview/page'}, '');
  const look = rec('read', {path: 'slides_preview/page-1.png'}, 'Read image file [image/png]');
  const pptxText = rec('exec', {command: `python3 -c "from pptx import Presentation; print(len(Presentation('${P}/plan.pptx').slides))"`}, '8');
  const ids = (tier, entries) => evidenceGaps(['document'], tier, entries).map(gap => gap.id);
  const view = () => rec('read', {path: 'deck/page-1.png'}, 'Read image file [image/png]');
  // 只看了替身：加强档也不算打开过交付文件。
  assert.deepEqual(ids('boost', [made, twin, twinPages, look]), ['doc_opened']);
  // python-pptx 打开幻灯片本身：加强档够了；全开档还要把幻灯片本身转图看。
  assert.deepEqual(ids('boost', [made, twin, twinPages, look, pptxText]), []);
  assert.deepEqual(ids('full', [made, twin, twinPages, look, pptxText]), ['doc_pages_viewed']);
  // soffice 把 .pptx 转成 PDF，再把这份 PDF 转图看：算。
  const convert = rec('exec', {command: `soffice --headless --convert-to pdf ${P}/plan.pptx --outdir out`}, `convert ${P}/plan.pptx -> out/plan.pdf`);
  const deckPages = rec('exec', {command: 'pdftoppm -png out/plan.pdf deck/page'}, '');
  assert.deepEqual(ids('full', [made, twin, twinPages, look, pptxText, convert, deckPages, view()]), []);
  // look-doc 直接看 .pptx 也算。
  assert.deepEqual(ids('full', [made, rec('exec', {command: `look-doc ${P}/plan.pptx`}, '第 1 页：deck/page-1.png'), view()]), []);
});

test('automation: test fixtures do not turn the job into document work, and a bare launchctl list proves nothing (isolated run K-auto-boost)', () => {
  const fixture = rec('exec', {command: 'echo "测试" > 下载/市场分析报告.pdf && python3 organize_downloads.py'}, '已移动 1 个文件到 下载/文档/市场分析报告.pdf');
  assert.equal(refineKinds(['automation'], fixture), null);
  assert.equal(refineKinds(['code'], fixture), null);
  assert.ok(!sig(rec('exec', {command: 'launchctl list | head -n 10'}, 'PID\tStatus\tLabel\n-\t0\tcom.apple.x')).includes('schedule_registered'));
  assert.ok(sig(rec('exec', {command: 'launchctl list com.biqi.organize'}, '{ "Label" = "com.biqi.organize"; }')).includes('schedule_registered'));
  assert.ok(sig(rec('exec', {command: 'launchctl list | grep biqi'}, '-\t0\tcom.biqi.organize')).includes('schedule_registered'));
});

test('a named source file before the verb is code work; visible UI tweaks in a .js stay web work', () => {
  assert.equal(classifyWorkKind('给 utils.js 里的 parseDate 加上对 2026/11/02 这种斜杠写法的支持，带测试', {mode: 'project'}).kind, 'code');
  assert.equal(classifyWorkKind('修一下 main.go 里的空指针', {mode: 'project'}).kind, 'code');
  assert.equal(classifyWorkKind('给 api.py 加个重试，带测试', {mode: 'project'}).kind, 'code');
  assert.equal(classifyWorkKind('把 app.js 里的按钮颜色改成蓝色', {mode: 'project'}).kind, 'web_ui');
});

test('every hands-on kind says what to do while a background command runs; text kinds say nothing', () => {
  for (const id of KIND_IDS) {
    if (WORK_KINDS[id].hands) assert.ok(WHILE_WAITING[id]?.length >= 2, `${id} has no while-waiting list`);
    else assert.equal(waitingSection([id]), '', id);
  }
  assert.match(waitingSection(['video_motion']), /^【这件活放后台等的时候】.*1）.*抽帧.*TOOLS\.md「这台电脑」/);
  assert.equal(waitingSection([]), '');
});
