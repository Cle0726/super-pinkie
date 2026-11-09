// 技能路由：碧琪按这条消息自己挑出最合适的 1–3 个技能，把路径直接给模型，不用先生指定用哪个。
// 纯函数、无 OpenClaw 依赖：classifyWorkKind 给出活儿种类，这里再按说法挑具体技能；
// index.mjs 负责把名字解析成本机真实路径（工作区 > ~/.openclaw/skills > 碧琪自带），找不到的跳过。
import fs from 'node:fs';
import path from 'node:path';
import {openclawStateDir} from './openclaw-paths.mjs';

// when：这条消息里出现这些说法才用（更具体的排前面）；没有 when 的是这种活的默认技能。
export const SKILL_ROUTES = Object.freeze([
  // 证件照 / 抠图 / 练习纸 / 简历（碧琪自己写的薄技能，底下是开源工具）
  {skill: 'pinkie-id-photo', kinds: ['image_print', 'craft', 'document'], when: /证件照|一寸照?|二寸照?|换底色?|蓝底|红底|白底照|签证照|报名照|简历照|护照照/, why: '证件照：换白 / 蓝 / 红底、标准尺寸、六寸排版（本地跑，不上传照片）'},
  // 批量出图 / 出片：网页版出图 + 豆包图生视频 + 本地加工脚本。排在抠图技能前面：
  // 「抠图做成贴纸」「切贴纸表」这类要的是整套加工链，不是单纯去背景。
  {skill: 'pinkie-script-image', kinds: ['image_print', 'craft', 'automation', 'video_motion'], when: /脚本.{0,6}出图|跑脚本|批量.{0,4}(?:出图|生图|生成图)|一次.{0,3}(?:出|生)\d+张|出一批|连出|多出几张|图生视频|首帧|切贴纸|贴纸表|对比表|深度图|剪影矢量化|去水印|豆包.{0,4}(?:生成|出)|ChatGPT.{0,4}出图|网页.{0,4}生图|做成贴纸/i, why: '批量出图/出片：网页版 ChatGPT 或 Gemini 出图、桌面豆包图生视频，加本地加工（抠图、切贴纸、拼对比表、深度图、剪影、去水印）'},
  {skill: 'pinkie-remove-background', kinds: ['image_print', 'craft', 'automation'], when: /抠图|抠出来|去背景|去掉背景|透明底|透明背景|换背景|白底图/, why: '抠图去背景、换底、批量处理（本地跑）'},
  {skill: 'pinkie-kids-worksheets', kinds: ['document', 'tutoring', 'image_print', 'craft', 'writing', 'standard_answer'], when: /字帖|练字|描红|田字格|米字格|回宫格|生字本|口算|计算题|算术题|练习纸|作业纸/, why: '字帖（田字格 / 米字格、拼音、描红）和口算题卡（带答案），A4 PDF'},
  {skill: 'pinkie-resume', kinds: ['document', 'writing', 'craft'], when: /简历|履历|\bcv\b|resume/i, why: '简历：填一份 YAML 出排版好的 PDF，多套主题，中英文都行'},
  // 图片 / 印刷 / 电商
  {skill: 'xhs-cover-templates', kinds: ['image_print', 'writing', 'web_ui', 'craft'], when: /小红书|红书|笔记封面|笔记首图|\bxhs\b/i, why: '16 套小红书封面现成模板（亮 / 暗两版）'},
  {skill: 'taobao-detail-long-image', kinds: ['image_print', 'web_ui', 'craft'], when: /详情页|详情长图|商品详情|淘宝|天猫|拼多多|京东/, why: '电商详情页长图（750 宽，一屏一屏规划）；配图用碧琪自己的生图工具，不用技能里的 API 脚本'},
  {skill: 'ecommerce-listing-suite', kinds: ['image_print', 'craft'], when: /上架|主图|商品图|产品图|电商图|一套.{0,4}(?:图|主图)/, why: '一套上架图：主图、卖点、场景、细节；配图用碧琪自己的生图工具'},
  {skill: 'selling-point-infographic', kinds: ['image_print', 'craft'], when: /卖点/, why: '商品卖点信息图'},
  {skill: 'size-chart', kinds: ['image_print', 'craft'], when: /尺码/, why: '尺码表'},
  {skill: 'model-try-on', kinds: ['image_print', 'craft'], when: /试穿|上身图|模特.{0,4}(?:穿|上身)/, why: '模特上身图（用碧琪自己的生图工具）'},
  {skill: 'lifestyle-scene', kinds: ['image_print', 'craft'], when: /场景图|使用场景/, why: '商品场景图'},
  {skill: 'multi-angle-set', kinds: ['image_print', 'craft'], when: /多角度|多个角度/, why: '商品多角度图'},
  {skill: 'amazon-a-plus', kinds: ['image_print', 'web_ui', 'craft'], when: /a\+|亚马逊|amazon/i, why: '亚马逊 A+ 页面'},
  {skill: 'sale-banner', kinds: ['image_print', 'web_ui', 'craft'], when: /促销|大促|双十一|双11|618|满减|秒杀/, why: '电商促销横幅'},
  {skill: 'banner-design', kinds: ['image_print', 'web_ui', 'craft'], when: /横幅|banner|头图|首图|封面|广告图|轮播图|朋友圈图|公众号/i, why: '横幅、头图、封面、广告图的版式和尺寸'},
  {skill: 'ip-as-logo', kinds: ['image_print', 'craft', 'ideas'], when: /ip形象|吉祥物|卡通.{0,4}(?:logo|形象|头像)|拟人|萌.{0,4}(?:logo|形象)|可爱.{0,4}(?:logo|形象)/i, why: '极简可爱的 IP 形象 logo'},
  {skill: 'brand', kinds: ['image_print', 'web_ui', 'craft', 'ideas'], when: /logo|标志|品牌|vi\b|字标|名片|店招|门头/i, why: '品牌和 logo：配色、字体、用法一整套'},
  {skill: 'slack-gif-creator', kinds: ['image_print', 'video_motion', 'craft'], when: /gif|表情包|动图|贴纸/i, why: '做 GIF 动图、表情包'},
  {skill: 'genai-mesh-gradient', kinds: ['image_print', 'web_ui', 'document'], when: /渐变|弥散|mesh/i, why: '渐变背景'},
  {skill: 'algorithmic-art', kinds: ['image_print', 'web_ui', 'app_game_ai', 'craft'], when: /生成艺术|图案|纹理|分形|艺术感|抽象/i, why: '用代码做生成艺术、图案、纹理'},
  {skill: 'canvas-design', kinds: ['image_print', 'craft'], why: '海报、印刷品、艺术感视觉的设计方法（带字体）'},
  // 图解和图表
  {skill: 'archify', kinds: ['craft', 'image_print', 'document', 'data_charts', 'code', 'web_ui', 'tutoring', 'writing'], when: /架构图|系统图|部署图|时序图|er ?图|实体关系|状态图|数据流|泳道|类图/i, why: '架构图、时序图、ER 图、状态图等，可交互单页 HTML，能导出图片'},
  {skill: 'dashmotion', kinds: ['craft', 'image_print', 'document', 'code', 'web_ui', 'video_motion'], when: /会动的?.{0,4}(?:流程图|架构图|示意图)|动态.{0,2}(?:流程图|架构图)|动画.{0,2}(?:流程图|架构图)/, why: '会动的流程图、架构图（连线在流动）'},
  {skill: 'pretty-mermaid', kinds: ['craft', 'image_print', 'document', 'data_charts', 'code', 'writing', 'tutoring'], when: /mermaid|流程图|甘特图|思维导图|脑图|时序图/i, why: 'Mermaid 流程图、甘特图、思维导图，渲染成好看的 SVG / PNG'},
  {skill: 'infographic-creator', kinds: ['data_charts', 'image_print', 'document', 'writing', 'craft', 'tutoring'], when: /信息图|长图|一图读懂|图解|流程图|步骤图|时间线|时间轴|对比图|层级|组织架构|金字塔|漏斗|知识卡片/i, why: 'AntV 信息图：约 200 种现成版式，写几行就出图'},
  {skill: 'antv-g6-graph', kinds: ['data_charts', 'image_print', 'web_ui', 'craft'], when: /关系图|网络图|知识图谱|拓扑|树图|人物关系/, why: '关系图、网络图、树图（AntV G6）'},
  {skill: 'officecli-data-dashboard', kinds: ['data_charts', 'document'], when: /(?:excel|表格).{0,6}(?:看板|仪表盘|dashboard)|(?:看板|仪表盘).{0,6}(?:excel|表格)/i, why: 'Excel 数据看板'},
  {skill: 'officecli-financial-model', kinds: ['data_charts', 'document'], when: /财务模型|三张?报?表|现金流|利润表|资产负债|估值模型|收入预测|营收预测/, why: '财务模型（Excel）'},
  {skill: 'officecli-xlsx', kinds: ['data_charts', 'document', 'automation'], when: /excel|xlsx|电子表格|表格|公式|透视表|工资表|预算表|报表|考勤表/i, why: '做 / 改 Excel：公式、条件格式、冻结窗格、图表'},
  {skill: 'antv-g2-chart', kinds: ['data_charts', 'web_ui', 'document'], when: /图表|柱状|折线|饼图|散点|雷达|热力图|趋势图|统计图|chart/i, why: 'AntV G2 图表（本地渲染）'},
  // 网页 / 界面 / 3D / 游戏
  {skill: 'design-taste-frontend', kinds: ['web_ui'], why: '网页审美：从获奖网站总结的方向库，先定方向再做，截图自查，避免 AI 模板味'},
  {skill: 'ui-ux-pro-max', kinds: ['web_ui', 'app_game_ai'], why: '先查设计系统：按行业挑风格、配色、字体、UX 规则'},
  {skill: 'frontend-design', kinds: ['web_ui', 'app_game_ai'], why: '做出不俗气、有设计感的前端界面'},
  {skill: 'threejs-fundamentals', kinds: ['web_ui', 'app_game_ai', 'craft'], when: /3d|三维|立体|three\.?js|webgl|模型展示|360.{0,3}(?:展示|旋转)/i, why: '3D 网页基础：场景、相机、灯光、动画循环'},
  {skill: 'threejs-loaders', kinds: ['web_ui', 'app_game_ai', 'craft'], when: /glb|gltf|\.obj|模型文件|导入.{0,4}模型/i, why: '加载 3D 模型文件'},
  {skill: 'threejs-shaders', kinds: ['web_ui', 'app_game_ai', 'craft'], when: /着色器|shader|粒子|光效|炫酷特效/i, why: '着色器特效、粒子'},
  {skill: 'threejs-interaction', kinds: ['web_ui', 'app_game_ai', 'craft'], when: /3d.{0,10}(?:点击|拖|交互|控制|旋转)/i, why: '3D 交互：点击、拖拽、视角控制'},
  {skill: 'game-jam-mode', kinds: ['app_game_ai'], when: /限时|game ?jam|赶紧做.{0,4}游戏|快速.{0,4}游戏/i, why: '限时做完一个小游戏'},
  {skill: 'game-prototype', kinds: ['app_game_ai'], when: /游戏|game/i, why: '快速做出能玩的游戏原型'},
  {skill: 'game-designer', kinds: ['app_game_ai'], when: /玩法|关卡|手感|游戏设计|好玩/, why: '游戏设计：玩法、关卡、手感'},
  {skill: 'game-balance-check', kinds: ['app_game_ai'], when: /数值|平衡|太难|太简单/, why: '游戏数值平衡'},
  {skill: 'design-system', kinds: ['web_ui', 'app_game_ai'], when: /设计系统|组件库|设计规范|token|一整套界面/i, why: '搭一套设计系统'},
  {skill: 'ui-styling', kinds: ['web_ui', 'app_game_ai'], when: /tailwind|shadcn|样式|配色不好|好看点|美化/i, why: 'Tailwind / shadcn 的样式做法'},
  {skill: 'web-artifacts-builder', kinds: ['web_ui', 'app_game_ai'], when: /react|单页|小工具|应用|计算器|看板|后台|仪表盘|dashboard/i, why: '复杂单页应用（React + 组件）'},
  {skill: 'browser-testing-with-devtools', kinds: ['web_ui', 'app_game_ai', 'debugging'], when: /控制台|devtools|开发者工具|网页.{0,6}(?:慢|卡|报错|白屏)/i, why: '用浏览器开发者工具查网页问题'},
  {skill: 'webapp-testing', kinds: ['web_ui', 'app_game_ai', 'debugging'], when: /测试|点一遍|试一下|试用|自测|bug|点不动|没反应/i, why: '用浏览器自动点一遍网页、截图验证'},
  // 文档 / PPT / PDF
  {skill: 'officecli-pitch-deck', kinds: ['document'], when: /路演|融资|招商|投资人|pitch|\bbp\b|商业计划/i, why: '路演 / 融资 deck'},
  {skill: 'ppt-master', kinds: ['document', 'tutoring'], when: /ppt|pptx|幻灯片|演示文稿|课件|汇报|路演|答辩|述职|deck|keynote/i, why: '可编辑 .pptx 全流程：课件、汇报、路演，品牌模板、图标、动画（第一次用要下载，放后台）'},
  {skill: 'morph-ppt', kinds: ['document', 'tutoring'], when: /ppt|pptx|幻灯片|演示文稿|课件|汇报|路演|答辩|述职|deck/i, why: '50 多种现成 PPT 风格（.pptx 成品）和平滑切换动画'},
  {skill: 'frontend-slides', kinds: ['document', 'web_ui', 'tutoring'], when: /网页版|网页幻灯片|html.{0,4}(?:幻灯片|演示|slides)|在线演示|reveal/i, why: '网页版幻灯片（动画丰富的 HTML）'},
  {skill: 'officecli-academic-paper', kinds: ['document', 'writing'], when: /论文|毕业设计|开题报告|学术|期刊|参考文献/, why: '论文的 Word 排版'},
  {skill: 'officecli-word-form', kinds: ['document'], when: /表单|申请表|登记表|报名表|调查表/, why: 'Word 表单'},
  {skill: 'officecli-docx', kinds: ['document', 'writing'], when: /word|docx|文档|公文|红头|通知|报告|手册|说明书|合同|方案|规划|计划书|申请书|总结/i, why: '做 / 改 Word：目录、页码、编号、表格、排版'},
  {skill: 'pdf', kinds: ['document', 'writing', 'data_charts'], when: /pdf/i, why: 'PDF：生成、读取，渲染成图片检查排版'},
  {skill: 'theme-factory', kinds: ['document', 'web_ui', 'image_print'], when: /主题|配色|风格统一/i, why: '10 套现成主题配色和字体，PPT、文档、网页都能套'},
  {skill: 'officecli', kinds: ['document'], why: 'Word / Excel / PPT 总入口（officecli 单文件命令行，不用装 Office），交付前质检'},
  // 视频 / 动效：总入口 + 按片子类型
  {skill: 'reverse-any-video', kinds: ['video_motion'], when: /照着.{0,8}(?:视频|片子)|模仿.{0,8}(?:视频|片子)|复刻|拆解.{0,6}视频|做成一样的/i, why: '照着一个现成视频拆解、复刻'},
  {skill: 'style-sampling', kinds: ['video_motion', 'image_print', 'web_ui'], when: /参考.{0,6}风格|这种风格|照着这个风格|同款风格|按这张图的感觉/i, why: '从参考图 / 网页里取风格'},
  {skill: 'product-walkthrough', kinds: ['video_motion'], when: /产品演示|功能演示|产品介绍|录屏讲解|操作演示/i, why: '产品演示视频'},
  {skill: 'launch-film', kinds: ['video_motion'], when: /发布|上线|新品|首发|launch/i, why: '新品发布片'},
  {skill: 'explainer-video', kinds: ['video_motion', 'tutoring'], when: /讲解|科普|解释|原理|是什么|为什么/i, why: '讲解 / 科普视频'},
  {skill: 'tutorial-video', kinds: ['video_motion', 'tutoring'], when: /教程|教学|怎么用|手把手|步骤/i, why: '教程视频'},
  {skill: 'social-ad', kinds: ['video_motion'], when: /广告|投放|带货|抖音|快手|视频号|竖屏/i, why: '短视频广告'},
  {skill: 'event-promo', kinds: ['video_motion'], when: /活动|宣传|预告|邀请|开业|促销|倒计时/i, why: '活动宣传片'},
  {skill: 'data-story', kinds: ['video_motion', 'data_charts'], when: /数据.{0,6}(?:视频|动画|讲)|年度报告|年终总结|数字会动/i, why: '数据会动的讲述视频'},
  {skill: 'testimonial-video', kinds: ['video_motion'], when: /口碑|好评|客户说|用户评价|证言/i, why: '口碑 / 好评视频'},
  {skill: 'brand-film', kinds: ['video_motion'], when: /品牌片|品牌故事|企业宣传|形象片/i, why: '品牌片'},
  {skill: 'feature-update', kinds: ['video_motion'], when: /更新|新功能|版本/i, why: '新功能 / 版本更新视频'},
  {skill: 'teaser-video', kinds: ['video_motion'], when: /预告|悬念|teaser|先导/i, why: '预告片'},
  {skill: 'narrated-video', kinds: ['video_motion'], when: /配音|旁白|解说|口播|讲述/i, why: '带旁白配音的视频'},
  {skill: 'slideshow', kinds: ['video_motion', 'document'], when: /相册|照片.{0,4}(?:视频|轮播)|ppt.{0,4}(?:转|做成)视频|电子相册|卡点/i, why: '照片 / PPT 做成视频'},
  {skill: 'motion-film', kinds: ['video_motion', 'image_print'], when: /动效|motion|动态海报|片头|片尾|标题动画/i, why: '动效短片、片头片尾'},
  {skill: 'lemo-opuscar', kinds: ['video_motion'], when: /短片|电影感|片子|风格|纪录|动画片|水墨|像素|复古|胶片|微缩|剪纸|皮影|手绘/i, why: '66 种用代码做的片子风格（水墨、像素、剪纸、纪录片……）'},
  {skill: 'media-use', kinds: ['video_motion', 'image_print', 'audio'], when: /配乐|音乐|bgm|音效|配音|字幕|素材|调色|滤镜/i, why: '配乐、音效、配音、字幕、调色'},
  {skill: 'hyperframes-registry', kinds: ['video_motion'], when: /特效|转场|故障|胶片|crt|glitch|粒子|光效|图表动画|地图动画/i, why: '现成的动效积木（约 400 件）'},
  {skill: 'hyperframes', kinds: ['video_motion'], why: '视频 / 动画的总入口（HyperFrames：HTML 做视频）'},
  // 文案 / 营销 / 点子
  {skill: 'naming', kinds: ['ideas', 'writing'], when: /起名|取名|名字|店名|品牌名|命名|叫什么好/, why: '起名：隐喻法，查重名和域名'},
  {skill: 'copy-editing', kinds: ['writing'], when: /改.{0,4}文案|润色.{0,4}文案|文案.{0,4}(?:改|润色|优化)/, why: '文案修改润色'},
  {skill: 'copywriting', kinds: ['writing', 'web_ui'], when: /文案|广告语|slogan|标语|宣传语|产品介绍|落地页/i, why: '营销文案：落地页、广告、产品介绍'},
  {skill: 'social', kinds: ['writing', 'ideas'], when: /小红书|公众号|朋友圈|微博|抖音.{0,4}文案|帖子|社媒|内容日历/, why: '社交媒体内容：帖子、话题、发布节奏'},
  {skill: 'emails', kinds: ['writing'], when: /营销邮件|邮件序列|开发信|推广邮件|newsletter/i, why: '营销邮件和邮件序列'},
  {skill: 'ad-creative', kinds: ['writing', 'image_print', 'ideas'], when: /广告(?:创意|投放|素材)|投放素材|信息流广告/, why: '广告创意和投放素材'},
  {skill: 'marketing-ideas', kinds: ['ideas', 'writing'], when: /营销|推广|引流|拉新|涨粉|获客|曝光/, why: '营销点子大全'},
  {skill: 'offers', kinds: ['ideas', 'writing'], when: /优惠|促销方案|满减|套餐|会员卡|活动方案/, why: '促销和优惠方案'},
  {skill: 'pricing', kinds: ['ideas', 'tradeoff'], when: /定价|价格策略|怎么定价|收费模式/, why: '定价策略'},
  {skill: 'launch', kinds: ['ideas', 'writing'], when: /发布会|上新|新品发布|产品发布/, why: '产品发布方案'},
  {skill: 'product-marketing', kinds: ['ideas', 'writing'], when: /产品定位|卖点提炼|差异化|竞品/, why: '产品定位和卖点'},
  {skill: 'content-strategy', kinds: ['ideas', 'writing'], when: /内容规划|选题|内容策略|账号定位/, why: '内容规划'},
  {skill: 'cro', kinds: ['web_ui', 'ideas'], when: /转化率|注册率|落地页.{0,4}(?:优化|转化)/, why: '转化率优化'},
  {skill: 'idea-refine', kinds: ['ideas'], when: /想法|这个主意|能不能做成|可行吗|方案打磨/, why: '把模糊的想法打磨成能做的方案'},
  // 写代码 / 排错 / 长活
  {skill: 'systematic-debugging', kinds: ['debugging'], why: '先复现、找根因、再修，不瞎改'},
  {skill: 'performance-optimization', kinds: ['code', 'web_ui', 'debugging', 'app_game_ai'], when: /性能|太慢|卡顿|加载慢|优化速度/, why: '性能优化'},
  {skill: 'security-and-hardening', kinds: ['code', 'web_ui', 'publish'], when: /安全|漏洞|加固|注入|xss|密码存/i, why: '安全加固'},
  {skill: 'code-review-and-quality', kinds: ['code'], when: /审查|review|代码质量|看看.{0,4}代码/i, why: '代码审查'},
  {skill: 'code-simplification', kinds: ['code'], when: /化简|简化|重构|太乱/, why: '代码化简'},
  {skill: 'api-and-interface-design', kinds: ['code', 'app_game_ai'], when: /接口设计|api ?设计|设计.{0,4}接口/i, why: '接口设计'},
  {skill: 'spec-driven-development', kinds: ['code', 'app_game_ai', 'web_ui'], when: /需求文档|规格|spec\b|prd/i, why: '先写规格再写代码'},
  {skill: 'shipping-and-launch', kinds: ['publish', 'code', 'web_ui'], when: /上线|发布到|部署/, why: '上线前检查'},
  {skill: 'test-driven-development', kinds: ['code'], when: /功能|实现|写一个|写个|改一下|函数|脚本|接口|算法|逻辑/i, why: '先写会失败的测试，再写代码'},
  {skill: 'writing-plans', kinds: ['code', 'app_game_ai', 'automation', 'web_ui'], when: /完整的|一整套|系统|平台|大项目|从零|很多功能|多个页面|长期/i, why: '大活先写计划：拆成能验证的小步'},
  {skill: 'verification-before-completion', kinds: ['code', 'debugging', 'automation', 'app_game_ai'], why: '说做完之前先拿到真凭据'},
  // 2026-11-04 追加的开源模板。只新增，不改上面已有的判断。
  {skill: 'huashu-design', kinds: ['image_print', 'web_ui', 'document', 'craft'], when: /花书|huashu|设计风格库|三个方向里挑/i, why: '92 种带样张的设计风格：网页、App 原型、可编辑 PPT、信息图、小红书图文'},
  {skill: 'kami', kinds: ['document', 'writing', 'craft'], when: /kami|一页纸简介|推荐信|财报点评|纸面排版/i, why: '纸面排版模板：简历、一页纸、推荐信、财报点评、幻灯片，出 PDF / PNG / PPT'},
  {skill: 'poster-studio', kinds: ['image_print', 'craft'], when: /乔木画布|poster-studio|社媒海报工作台/i, why: '乔木画布：小红书封面、知识卡片、社媒海报工作台'},
  {skill: 'cover-xiaohongshu', kinds: ['image_print', 'craft'], when: /封面样图|封面排版库|cover-xiaohongshu/i, why: '小红书封面样图和排版库'},
  {skill: 'baoyan-poster', kinds: ['image_print', 'document'], when: /保研分享会|讲座海报|宣讲会海报|分享会海报/i, why: '讲座 / 分享会 / 宣讲会海报：改 YAML 出 54 套配色的可编辑 PPTX'},
  {skill: 'cuhk-poster', kinds: ['image_print', 'document'], when: /中文大学海报|港中文海报|cuhk.?海报/i, why: '香港中文大学海报模板'},
  {skill: 'paper2poster', kinds: ['document', 'image_print'], when: /论文海报|学术海报|paper2poster/i, why: '把论文生成学术海报'},
  {skill: 'jinba-pptx', kinds: ['document'], when: /咨询风.{0,6}(?:ppt|幻灯片)|麦肯锡风|jinba/i, why: '咨询公司风格的可编辑 PPT'},
  {skill: 'academic-pptx', kinds: ['document', 'tutoring'], when: /学术会议.{0,8}(?:ppt|幻灯片)|研讨会幻灯片|academic ppt/i, why: '学术会议、研讨会幻灯片'},
  {skill: 'claude-pptx-skills', kinds: ['document'], when: /幻灯片母版|pptx母版|企业幻灯片模板/i, why: '19 个幻灯片母版和版式技能'},
  {skill: 'editable-pptx', kinds: ['document'], when: /分层可编辑|可编辑形状的幻灯片/i, why: '分层、可编辑形状的 PowerPoint'},
  {skill: 'polished-slides', kinds: ['document'], when: /设计师级.{0,6}幻灯片|精修幻灯片/i, why: '把幻灯片做成设计师级版式'},
  {skill: 'image-to-pptx', kinds: ['document', 'image_print'], when: /图片转成?.{0,4}ppt|图转成可编辑幻灯片|框架图转/i, why: '图片、框架图转成可编辑 PPT'},
  {skill: 'md-wechat', kinds: ['writing', 'web_ui'], when: /公众号排版|微信排版|26 套主题/i, why: '公众号 Markdown 排版，26 套主题'},
  {skill: 'md2wechat-lite', kinds: ['writing'], when: /markdown转公众号|公众号 markdown/i, why: 'Markdown 转公众号排版'},
  {skill: 'billryan-resume', kinds: ['document', 'writing'], when: /latex简历|英文简历模板|billryan/i, why: '英文 LaTeX 简历模板'},
  {skill: 'resume-chinese', kinds: ['document', 'writing'], when: /中文latex简历|中文简历模板/i, why: '中文 LaTeX 简历模板'},
  {skill: 'king-of-pigeon', kinds: ['document', 'writing'], when: /保研简历|保研文书|夏令营简历/i, why: '计算机保研简历和文书模板'},
  {skill: 'latex-templates', kinds: ['document'], when: /latex论文模板|学位论文模板库|latex模板大全/i, why: '学位论文和简历 LaTeX 模板合集'},
  {skill: 'easy-paper', kinds: ['document', 'writing'], when: /typst中文论文|typst写论文/i, why: '开箱即用的 Typst 中文论文模板'},
  {skill: 'hust-typst', kinds: ['document'], when: /华科毕业论文|华中科技大学.{0,8}论文|hust.{0,6}typst/i, why: '华中科技大学毕业论文 Typst 模板'},
  {skill: 'pkuthss-typst', kinds: ['document'], when: /北大毕业论文|北京大学.{0,8}论文|pkuthss/i, why: '北京大学学位论文 Typst 模板'},
  {skill: 'bupt-typst', kinds: ['document'], when: /北邮毕设|北京邮电.{0,8}论文/i, why: '北京邮电大学毕设 Typst 模板'},
  {skill: 'sjtu-thesis', kinds: ['document'], when: /上交毕业论文|上海交通.{0,8}学位论文|sjtu.{0,8}thesis/i, why: '上海交通大学学位论文 Typst 模板'},
  {skill: 'quarto-chinese', kinds: ['document', 'writing'], when: /quarto中文|quarto写论文/i, why: 'Quarto 中文论文模板'},
  {skill: 'html-email', kinds: ['writing', 'web_ui'], when: /html邮件|响应式邮件|邮件模板/i, why: '响应式 HTML 邮件模板'},
  {skill: 'mailgun-email', kinds: ['writing', 'web_ui'], when: /交易邮件|订单邮件|transactional email/i, why: '交易、订单类 HTML 邮件模板'},
  {skill: 'cerberus-email', kinds: ['writing', 'web_ui'], when: /新闻邮件模板|newsletter模板|cerberus/i, why: '新闻邮件、响应式邮件版式'},
  {skill: 'marp-academic', kinds: ['document'], when: /marp|markdown幻灯片/i, why: '学术风 Marp 幻灯片主题'},
  {skill: 'marpstyle', kinds: ['document'], when: /marp主题|marp风格/i, why: '多套好看的 Marp 主题'},
  {skill: 'thu-marp', kinds: ['document', 'tutoring'], when: /清华组会|清华slides|thu slides/i, why: '清华大学组会 Marp 幻灯片'},
  {skill: 'slidev-academic', kinds: ['document', 'web_ui'], when: /slidev/i, why: '学术风 Slidev 主题'},
  {skill: 'slidev-neversink', kinds: ['document', 'web_ui'], when: /neversink/i, why: 'Slidev Neversink 主题'},
  {skill: 'typst-poster', kinds: ['image_print', 'document'], when: /typst海报/i, why: 'Typst 学术海报模板'},
  {skill: 'beamer-execushares', kinds: ['document'], when: /beamer|latex幻灯片/i, why: '现代极简 Beamer 幻灯片主题'},
  {skill: 'beamer-arguelles', kinds: ['document'], when: /arguelles/i, why: '排版向的极简 Beamer 主题 Arguelles'},
]);

// 要碧琪动手做东西的说法。活儿分类偶尔漏判（比如「剪个抖音广告」被当成闲聊）时，靠它 + 技能的具体说法兜底。
const ACTION = /(?:帮我|给我|替我|麻烦|请)?(?:做|剪|写|画|设计|出|生成|制作|整|弄|拍|配|搞)(?:个|一个|一份|一张|一段|一套|几张|几个|点)?/;
const ASKING_ONLY = /^(?:什么是|.{0,20}(?:是什么|什么意思|怎么回事|为什么|对吗|吗)[？?]?)$/;

export function routeSkills(kinds = [], prompt = '', {limit = 3, available = null} = {}) {
  const text = String(prompt || '');
  // 「小红书是什么？」是在问，不是要做（分类器会把它算成写作）；「能帮我做个小红书封面吗？」照样配。
  if (ASKING_ONLY.test(text.trim()) && !ACTION.test(text)) return [];
  let wanted = new Set(kinds);
  const unsure = !wanted.size || (wanted.size === 1 && (wanted.has('simple') || wanted.has('pending')));
  if (unsure) {
    if (!ACTION.test(text)) return [];
    const direct = SKILL_ROUTES.filter(r => r.when && r.when.test(text) && (!available || available.has(r.skill)));
    if (!direct.length) return [];
    wanted = new Set(direct[0].kinds.slice(0, 1));
    kinds = [...wanted];
  }
  const specific = [], fallback = [];
  for (const route of SKILL_ROUTES) {
    if (!route.kinds.some(k => wanted.has(k))) continue;
    if (available && !available.has(route.skill)) continue;
    if (route.when) { if (route.when.test(text)) specific.push(route); }
    else fallback.push(route);
  }
  // 主活的默认技能永远留一个位置（比如做视频一定带上 hyperframes 总入口）。
  const primary = kinds[0];
  const primaryDefault = fallback.find(r => r.kinds[0] === primary || r.kinds.includes(primary));
  const picked = [];
  const add = r => { if (r && !picked.some(p => p.skill === r.skill) && picked.length < limit) picked.push(r); };
  if (primaryDefault && ['video_motion'].includes(primary)) add(primaryDefault);
  for (const r of specific) add(r);
  for (const r of fallback) add(r);
  return picked;
}

// 在本机找技能文件夹：工作区 skills/ > ~/.openclaw/skills/ > 已经按需下载好的大技能（pinkie-skills/）
// > 碧琪自带（PINKIE_MANAGED_SKILLS_DIR；大技能在这里只是一份「第一次用时下载」的说明）。
export function resolveSkillFile(name, {workspace = '', stateDir = openclawStateDir(), managedDir = process.env.PINKIE_MANAGED_SKILLS_DIR || ''} = {}) {
  const roots = [workspace && path.join(workspace, 'skills'), stateDir && path.join(stateDir, 'skills'), stateDir && path.join(stateDir, 'pinkie-skills'), managedDir].filter(Boolean);
  for (const root of roots) {
    const file = path.join(root, name, 'SKILL.md');
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return '';
}

// 有的 SKILL.md 有 160 KB（后半截是「附录：内嵌文件」，和文件夹里的 templates/、scripts/ 一模一样）。
// 读工具一次只给 50 KB / 2000 行，小模型常常读了开头就开工、或者在附录里打转：直接告诉它读到哪一行为止。
const APPENDIX = /^#{1,3}\s*(?:\d+\.\s*)?(?:appendix|附录)\b/i;
export function readRange(file, {minBytes = 60_000} = {}) {
  try {
    const size = fs.statSync(file).size;
    if (size < minBytes) return '';
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex(line => APPENDIX.test(line));
    const folder = path.dirname(file);
    const kept = at > 0 && ['templates', 'scripts', 'examples', 'references'].some(name => fs.existsSync(path.join(folder, name)));
    if (kept) return `只读第 1–${at} 行（第 ${at + 1} 行起是附录，里面的文件在这个技能文件夹里已经有了；一次读不完就用 offset 接着读）`;
    return `文件很长（${lines.length} 行），一次读不完就用 offset 接着读，读完再动手`;
  } catch { return ''; }
}

export function skillRouteBlock(kinds = [], prompt = '', {workspace = '', stateDir = openclawStateDir(), managedDir, mode = '', playbook = ''} = {}) {
  if (mode === 'none') return '';
  const routes = routeSkills(kinds, prompt, {limit: 6});
  const found = [];
  for (const r of routes) {
    const file = resolveSkillFile(r.skill, {workspace, stateDir, managedDir});
    if (file) found.push({...r, file});
    if (found.length >= 3) break;
  }
  if (!found.length) return '';
  const lines = ['【这件活先用这些现成的技能】系统已按这条消息挑好，不用问先生用哪个。动手前把下面每个 SKILL.md 读完（标了读到哪一行的读到那一行；同一会话读过、还记得清楚的不用重读），照它的做法、模板和素材做；读的时候不用告诉先生。'];
  found.forEach((r, i) => {
    const range = readRange(r.file);
    lines.push(`${i + 1}. ${r.skill}：${r.why}。路径：${r.file}${range ? `。${range}` : ''}`);
  });
  lines.push(`技能和碧琪的打法冲突时以打法为准：先做出来、不问一串问题、交付前亲眼验证${playbook ? `（${playbook}）` : ''}。技能里要下载的依赖照样自己装好，记进下载账本。`);
  return lines.join('\n');
}
