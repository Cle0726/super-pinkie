// 技能路由：碧琪按这条消息自己挑出最合适的 1–3 个技能，把路径直接给模型，不用先生指定用哪个。
// 纯函数、无 OpenClaw 依赖：classifyWorkKind 给出活儿种类，这里再按说法挑具体技能；
// index.mjs 负责把名字解析成本机真实路径（工作区 > ~/.openclaw/skills > 碧琪自带），找不到的跳过。
import fs from 'node:fs';
import path from 'node:path';
import {openclawStateDir} from './openclaw-paths.mjs';

// when：这条消息里出现这些说法才用（更具体的排前面）；没有 when 的是这种活的默认技能。
export const SKILL_ROUTES = Object.freeze([
  // 图片 / 印刷
  {skill: 'xhs-cover-templates', kinds: ['image_print', 'writing', 'web_ui', 'craft'], when: /小红书|红书|笔记封面|笔记首图|\bxhs\b/i, why: '16 套小红书封面现成模板（亮 / 暗两版）'},
  {skill: 'banner-design', kinds: ['image_print', 'web_ui', 'craft'], when: /横幅|banner|头图|首图|封面|广告图|电商主图|轮播图|朋友圈图|公众号/i, why: '横幅、头图、封面、广告图的版式和尺寸'},
  {skill: 'brand', kinds: ['image_print', 'web_ui', 'craft', 'ideas'], when: /logo|标志|品牌|vi\b|字标|名片|店招|门头/i, why: '品牌和 logo：配色、字体、用法一整套'},
  {skill: 'slack-gif-creator', kinds: ['image_print', 'video_motion', 'craft'], when: /gif|表情包|动图|贴纸/i, why: '做 GIF 动图、表情包'},
  {skill: 'algorithmic-art', kinds: ['image_print', 'web_ui', 'app_game_ai', 'craft'], when: /生成艺术|图案|纹理|粒子|流体|分形|艺术感|抽象/i, why: '用代码做生成艺术、图案、粒子'},
  {skill: 'canvas-design', kinds: ['image_print', 'craft'], why: '海报、印刷品、艺术感视觉的设计方法（带字体）'},
  // 信息图（放在数据、文档、图片里都可能出现）
  {skill: 'infographic-creator', kinds: ['data_charts', 'image_print', 'document', 'writing', 'craft', 'tutoring'], when: /信息图|长图|一图读懂|图解|流程图|步骤图|时间线|时间轴|对比图|架构图|层级|组织架构|金字塔|漏斗|思维导图|知识卡片/i, why: 'AntV 信息图：约 200 种现成版式，写几行就出图'},
  // 网页 / 界面
  {skill: 'ui-ux-pro-max', kinds: ['web_ui', 'app_game_ai'], why: '先查设计系统：按行业挑风格、配色、字体、UX 规则'},
  {skill: 'frontend-design', kinds: ['web_ui', 'app_game_ai'], why: '做出不俗气、有设计感的前端界面'},
  {skill: 'design-system', kinds: ['web_ui', 'app_game_ai'], when: /设计系统|组件库|设计规范|token|一整套界面/i, why: '搭一套设计系统'},
  {skill: 'ui-styling', kinds: ['web_ui', 'app_game_ai'], when: /tailwind|shadcn|样式|配色不好|好看点|美化/i, why: 'Tailwind / shadcn 的样式做法'},
  {skill: 'web-artifacts-builder', kinds: ['web_ui', 'app_game_ai'], when: /react|单页|小工具|应用|计算器|看板|后台|仪表盘|dashboard/i, why: '复杂单页应用（React + 组件）'},
  {skill: 'webapp-testing', kinds: ['web_ui', 'app_game_ai', 'debugging'], when: /测试|点一遍|试一下|试用|自测|bug|点不动|没反应/i, why: '用浏览器自动点一遍网页、截图验证'},
  // 文档 / PPT
  {skill: 'slides', kinds: ['document', 'tutoring'], when: /ppt|幻灯片|演示|汇报|路演|答辩|述职|课件|slides?\b|deck|keynote/i, why: '演示稿的结构、每页版式和文案套路（它本身做网页版幻灯片；先生要 PPT 时只借结构和版式，交付照打法做 .pptx）'},
  {skill: 'theme-factory', kinds: ['document', 'web_ui', 'image_print'], when: /ppt|幻灯片|演示|报告|文档|主题|配色|风格统一/i, why: '10 套现成主题配色和字体，PPT、文档、网页都能套'},
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
  {skill: 'media-use', kinds: ['video_motion', 'image_print', 'audio'], when: /配乐|音乐|bgm|音效|配音|字幕|素材|抠图|去背景|调色|滤镜/i, why: '配乐、音效、配音、字幕、抠图、调色'},
  {skill: 'hyperframes-registry', kinds: ['video_motion'], when: /特效|转场|故障|胶片|crt|glitch|粒子|光效|图表动画|地图动画/i, why: '现成的动效积木（约 400 件）'},
  {skill: 'hyperframes', kinds: ['video_motion'], why: '视频 / 动画的总入口（HyperFrames：HTML 做视频）'},
  // 写代码 / 排错 / 长活
  {skill: 'systematic-debugging', kinds: ['debugging'], why: '先复现、找根因、再修，不瞎改'},
  {skill: 'test-driven-development', kinds: ['code'], when: /功能|实现|写一个|写个|改一下|函数|脚本|接口|算法|逻辑/i, why: '先写会失败的测试，再写代码'},
  {skill: 'writing-plans', kinds: ['code', 'app_game_ai', 'automation', 'web_ui'], when: /完整的|一整套|系统|平台|大项目|从零|很多功能|多个页面|长期/i, why: '大活先写计划：拆成能验证的小步'},
  {skill: 'verification-before-completion', kinds: ['code', 'debugging', 'automation', 'app_game_ai'], why: '说做完之前先拿到真凭据'},
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

// 在本机找技能文件夹：工作区 skills/ > ~/.openclaw/skills/ > 碧琪自带（PINKIE_MANAGED_SKILLS_DIR）。
export function resolveSkillFile(name, {workspace = '', stateDir = openclawStateDir(), managedDir = process.env.PINKIE_MANAGED_SKILLS_DIR || ''} = {}) {
  const roots = [workspace && path.join(workspace, 'skills'), stateDir && path.join(stateDir, 'skills'), managedDir].filter(Boolean);
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
