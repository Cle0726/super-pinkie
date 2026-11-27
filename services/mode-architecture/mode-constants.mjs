// Mode constants, task classification, local setup failure detection, and watchdog/provider failure helpers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {isUnresolvedSessionKey} from './session-titles.mjs';
import {RIGOR_LADDER, SPAWN_FALLBACK} from './run-contract.mjs';
import {WORK_ROLE_LABELS} from './work-kinds.mjs';
import {endsWithUserQuestion} from './ask.mjs';
import {agentFromSessionKey, deliberationRequirements, modeForContext} from './deliberation-audit.mjs';
import {resultText, toolResultFailed, workFirstContext} from './evidence-rules.mjs';

const MODE_BY_AGENT = Object.freeze({
  main: 'chat',
  project: 'project',
  thinking: 'ideas',
  learning: 'learning',
  unrestricted: 'none',
  // Metre：给最强模型用的总控模式（briefs/metre-mode-1113）。没有人设文件，注入按 METRE_* 规则取舍。
  metre: 'metre',
});

const PERSONA_FILES = Object.freeze({
  chat: ['persona/core.md', 'persona/voice_examples.md'],
  project: ['persona/core.md'],
  ideas: ['persona/core.md', 'persona/voice_examples.md'],
  learning: ['persona/core.md', 'persona/voice_examples.md', 'persona/methods.md'],
  none: [],
  metre: [],
});

const ALWAYS_MEMORY_FILES = Object.freeze([
  'memory/INDEX.md',
  'memory/identity.md',
]);

const TIER_LIMITS = Object.freeze({base: 20, boost: 48, full: 96, marathon: 512});
// 续跑上限和其他档位数字都在 run-contract.mjs 的 RIGOR_LADDER，这里只取用。
export const TIER_RETRY_LIMITS = Object.freeze(Object.fromEntries(Object.entries(RIGOR_LADDER).map(([tier, rigor]) => [tier, rigor.continuationLimit])));
const SOLVER_LIMITS = Object.freeze({base: 3, boost: 3, full: 3, marathon: 3});
const UPGRADE_ROLES = Object.freeze(['decomposer', 'pipeline', 'debater', 'verifier', 'assumption']);
const ROLE_LABELS = Object.freeze({
  planner: '规划', solver: '求解', critic: '批评', judge: '仲裁',
  decomposer: '递归分解', pipeline: '独立流水线', debater: '多轮对抗',
  verifier: '真实验证', assumption: '假设审查', countercritic: '反批评',
  // 全开档按活儿种类多做几版（work-kinds.mjs）：独立起草、独立复算、看图审稿、用户视角试用。
  ...WORK_ROLE_LABELS,
});
const TASK_WORKFLOWS = Object.freeze({
  pending: {label: '等待本轮问题', stages: ['收到问题'], roles: {}},
  simple: {label: '此问题无需多方案，已直接回答', stages: ['此问题无需多方案，已直接回答'], roles: {}},
  implementation: {label: '写代码 / 修 bug', stages: ['复现', '修改', '测试'], roles: {}},
  standard_answer: {label: '有标准答案的难题', stages: ['独立解法', '验算', '必要时裁决'], roles: {solver: 2}},
  tradeoff: {label: '方案 / 取舍类', stages: ['不同立场', '对比代价', '交给用户选择'], roles: {solver: 2}},
  fact_check: {label: '查事实', stages: ['多来源核对', '标注出处与不确定性'], roles: {}},
});
const VALID_TIER = /\[deep-think:(base|boost|full|marathon)\]/i;
// 所有档位连续两次没有新证据时停止，避免只重复重试没有变化的做法。
const NO_PROGRESS_LIMIT = 2;
// 被拦下的上一版回复留多少字：推不动时它就是交给用户的成品（stopReport），不能截在中间。
const DRAFT_KEEP = 60_000;
const RETRY_DIFFERENCE = /这次和上次不同\s*[：:]\s*(换思路|换信息|换模型)[，,、\s：:]+(.{4,})/i;
const GATE_RESEARCH = /(?:COMPLETION_TRUTH_RULES|completionClaimed|scheduleIntegrityRetry|integrityRetryLimit|verify_completion\.py|delivery_guard.{0,30}(?:代码|实现|规则|门禁)|(?:通过|绕过|构造).{0,24}(?:验收|门禁|completion|integrity)|(?:--test-name-pattern|--grep)[= ]?.{0,100}(?:integrity|门禁|验收|completion|delivery))/i;
const MODE_ARCHITECTURE_SOURCE = /services[\\/ ]mode-architecture[\\/ ]index\.mjs/i;
const MODE_ARCHITECTURE_TASK = /(?:services[\\/ ]mode-architecture[\\/ ]index\.mjs|模式架构|mode-architecture|deliberationRequirements|思考档位.{0,16}(?:流程|逻辑|映射)|极致思考.{0,16}(?:流程|档位))/i;
const COMPLETION_CLAIM = /(?:100%|全部|完整|真正|真实|已经|已|成功).{0,24}(?:完成|交付|提交|生成|下载|发布|执行|修复|处理)|(?:完成|交付|提交|生成|下载|发布|执行|修复|处理).{0,16}(?:完毕|成功|完成)/i;
const DELIVERY_CLAIM = /(?:搞定|处理好了|弄好了|做完了|做成了|已按要求|可以用了|没问题了|已经可以|一切就绪|顺利交付|已落实|已修好|已修复)/i;
const WORK_ACTION_CLAIM = /(?:(?:已经|已|成功)(?:把|将)?[^。！？\n]{0,18}(?:修改|更改|更新|创建|生成|删除|写入|保存|发布|发送|上传|下载|部署|安装|修复|完成)|(?:已经|已|成功)[^。！？\n]{0,8}(?:调用|使用|运行|执行)[^。！？\n]{0,12}(?:skill|技能)|(?:修改|更改|更新|创建|生成|删除|写入|保存|发布|发送|上传|下载|部署|安装|修复)(?:好|完|成功|了)|(?:测试|检查|核对|验证|运行|执行|构建|打包|修复|交付)(?:已|已经)?(?:完成|通过|成功)|交付(?:成果|文件|结果|成品)(?:如下|在|是))/i;
const WORK_PRODUCT_CLAIM = /(?:(?:已经|已|成功)[^。！？\n]{0,12}(?:剪好|做好|改好|修好|渲染完成|导出完成)|(?:做|剪|改|修|导出|渲染)(?:好|完|成)了?)/i;
const REPORTED_MUTATION = /(?:(?:已经|已|成功)(?:把|将)?[^。！？\n]{0,18}(?:修改|更改|更新|创建|生成|删除|写入|保存|发布|发送|上传|下载|部署|安装|修复)|(?:修改|更改|更新|创建|生成|删除|写入|保存|发布|发送|上传|下载|部署|安装|修复)(?:好|完|成功|了))/i;
const REPORTED_EXTERNAL_ACTION = /(?:(?:已经|已|成功)(?:把|将)?[^。！？\n]{0,18}(?:发送|发给|发出|寄出|上传|发布|保存|写入|下载|部署|删除|安装)|(?:发送|发给|发出|寄出|上传|发布|保存|写入|下载|部署|删除|安装)(?:好|完|成功|了))/i;
const ENGLISH_MUTATION_CLAIM = /\b(?:(?:i|we)(?:'ve|\s+have)?\s+(?:successfully\s+)?(?:modified|changed|updated|created|fixed|saved|sent|published|uploaded|downloaded|deleted|deployed|installed)|(?:the\s+)?(?:files?|emails?|messages?|pages?|sites?|apps?|projects?)\s+(?:has|have|was|were)(?:\s+been)?\s+(?:successfully\s+)?(?:modified|changed|updated|created|fixed|saved|sent|published|uploaded|downloaded|deleted|deployed|installed))\b/i;
const ENGLISH_EXTERNAL_ACTION = /\b(?:(?:i|we)(?:'ve|\s+have)?\s+(?:successfully\s+)?(?:sent|published|uploaded|downloaded|deployed|installed)|(?:the\s+)?(?:emails?|messages?|files?|pages?|sites?|apps?)\s+(?:has|have|was|were)(?:\s+been)?\s+(?:successfully\s+)?(?:sent|published|uploaded|downloaded|deployed|installed))\b/i;
const ENGLISH_TEST_CLAIM = /\b(?:(?:the\s+)?(?:tests?|checks?|builds?)\s+(?:(?:have|has)\s+)?(?:all\s+)?(?:passed|succeeded|completed)|(?:i|we)(?:'ve|\s+have)?\s+(?:successfully\s+)?(?:ran|executed)\s+(?:the\s+)?tests?)\b/i;
// A failed *probe* can be an expected, completed test result. The contradiction
// guard should look for an unfinished overall state, not any word "失败".
const IN_PROGRESS_CLAIM = /(?:仍在|还在|正在|等待|排队|后台.{0,8}(?:生成|运行|处理|渲染)|稍后|尚未|未下载|未生成|待完成|被阻塞)/i;
const HONEST_INCOMPLETE = /(?:明确.{0,8})?(?:未完成|尚未完成|无法完成|还没(?:有)?(?:完成|做完|搞定)|执行失败|验收失败|验证未通过|被阻塞|需要用户.{0,8}(?:登录|验证|确认|提供)|验证码|人机验证)/i;
const ACTION_REQUEST = /(?:调用|执行|运行|修改|改|修复|修|做|生成|创建|制作|下载|上传|发布|打开|删除|安装|部署|打包|测试|验证|完成|剪辑|剪成|剪掉|剪一|渲染|合成|导出|转换|转成|压缩|配音|配乐|绘制|画一|抠图|拼接|录屏|截图).{0,30}(?:skill|技能|工作|任务|项目|文件|图片|视频|程序|脚本|应用|app)?/i;
const MUTATION_REQUEST = /(?:修改|改|修复|修|做|生成|创建|制作|下载|上传|发布|删除|删|清理|清空|清除|安装|部署|打包|写入|更新|替换|移动|重命名|完成).{0,36}(?:skill|技能|工作|任务|项目|文件|图片|视频|程序|脚本|应用|app|它|这个|该)?/i;
const QUESTION_ONLY = /(?:为什么|为何|怎么回事|什么原因|如何理解|能不能|有没有办法|是不是|是否|请解释|问一下|想知道|？|\?)/i;
const ACTION_CONTINUATION = /^(?:继续|接着|往下|开始吧|动手吧|加强(?:一下)?|优化(?:一下)?|完善(?:一下)?|升级(?:一下)?|修复(?:啊|吧)?)[！!。.\s]*$/i;
const NEGATED_MUTATION_CLAUSE = /(?:不要|无需|不需要|禁止|严禁|勿|不可|不能|不(?=修改|改动|创建|删除|写入|更新)|仅(?:需|限)?只读)[^。！？!?；;，,:：\n]{0,80}(?:修改|改|修复|修|做|生成|创建|制作|下载|上传|发布|删除|安装|部署|打包|写入|更新|替换|移动|重命名|完成)[^。！？!?；;，,:：\n]{0,80}(?=[。！？!?；;，,:：\n]|$)/gi;
function promptInstructionText(prompt = '') {
  // Attachment wrappers contain source material, not new user instructions.
  // An unclosed file/untrusted block consumes the rest of the prompt.
  return String(prompt || '')
    .replace(/^\s*\[media attached:[^\r\n]*\]\s*$/gim, '')
    .replace(/<file\b[^>]*>[\s\S]*?<\/file\s*>/gi, '')
    .replace(/<file\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<<<EXTERNAL_UNTRUSTED_CONTENT>>>[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/gi, '')
    .replace(/<<<EXTERNAL_UNTRUSTED_CONTENT>>>[\s\S]*$/gi, '')
    .trim();
}
// 工作台说明是附加上下文，不是用户的任务。无限制模式保留原来的处理方式。
function workFirstPrompt(prompt = '', mode = '') {
  const text = String(prompt || '');
  return mode === 'none' ? text : text.replace(/\n\s*【(?:学习)?工作台】[\s\S]*$/, '');
}
function hasAttachedSourceContent(prompt = '') {
  return /(?:^\s*\[media attached:|<file\b|<<<EXTERNAL_UNTRUSTED_CONTENT>>>)/im.test(String(prompt || ''));
}
// 「翻译：<一段粘贴的文字>」「把下面这段总结一下：…」「……\n\n翻成英文」——
// 粘贴进来的原文里出现「已完成」「测试通过」，是原文的内容，不是碧琪在汇报
// 自己的进度。只要指令本身是对这段文字做翻译/润色/总结一类的事，回复里
// 转述的完成字样就不能触发交付门禁（2026-10-08：翻译一份进度报告被连打
// 三次回票，最后回复被吞）。返回指令那一小段；不是这类请求就返回 null。
const TEXT_TASK = '(?:翻译|翻成|译成|译为|润色|改写|重写|转述|总结|概括|摘要|提炼|校对|纠错|缩写|扩写|解释|讲解|分析|读一下|看看)';
const TEXT_TASK_HEAD = new RegExp(`^(?:请|帮我|麻烦|能不能|可以)?\\s*(?:把|将)?\\s*(?:(?:下面|以下|这段|这篇|这些|如下|这个)(?:的)?){0,2}(?:内容|文字|文本|话|段落|报告|消息)?\\s*${TEXT_TASK}[^\\n：:]{0,30}[：:\\n]`, 'i');
const TEXT_TASK_TAIL = new RegExp(`\\n\\s*(?:请|帮我|麻烦)?\\s*(?:把|将)?\\s*(?:(?:上面|以上|上述|这段|这些)(?:的)?){0,2}(?:内容|文字|文本|话|段落|报告)?\\s*${TEXT_TASK}[^\\n]{0,30}$`, 'i');
const TEXT_TASK_EN = /^(?:please\s+|can you\s+)?(?:translate|summari[sz]e|proofread|rewrite|paraphrase|polish|explain)\b[^\n:]{0,40}[:\n]/i;
function inlineSourceInstruction(prompt = '') {
  const text = promptInstructionText(prompt).replace(/^(?:\s*\[[^\]\n]{1,200}\]\s*\n)+/, '').trim();
  const head = TEXT_TASK_HEAD.exec(text) || TEXT_TASK_EN.exec(text);
  if (head && text.length - head[0].length >= 40) return head[0];
  const tail = TEXT_TASK_TAIL.exec(text);
  if (tail && text.length - tail[0].length >= 40) return tail[0];
  return null;
}
// “都完成前不要回复”“完成后再总结”只描述先后顺序；“修复后的版本”“改动过的
// 文件”只描述状态；“改成用 X 方法”“改按规则—例子—结论组织”只换做法或回答
// 格式。它们都不是在要求改动或产出什么，不能让只读的检查任务被当成必须有
// 写入证据的修改任务。
const ORDER_OR_STYLE_PHRASE = /(?:(?:都|全部|全都|均)?完成(?:之?前|之?后|以后|时)|(?:修复|修改|改动|更新|升级|安装|部署|生成|创建|优化)(?:之?后|以后|过)的|改(?:成|为|用|按)[^。！？!?；;，,\n]{0,24}?(?:方法|方式|思路|格式|顺序|组织|结构|风格|口吻|语气|写法|说法|角度|步骤))/g;
function intentText(prompt = '') {
  return promptInstructionText(prompt).replace(ORDER_OR_STYLE_PHRASE, '');
}
function isMutationRequest(prompt = '') {
  // Negated safety wording such as “只读，不要修改/创建/删除文件” must not
  // turn an observation into a file-changing task. Keep a positive mutation
  // elsewhere in the same prompt intact (for example: “修改 A，不要删除 B”).
  // 「每做一步之前先说一句」是对说明方式的要求，不是要动手改东西。
  const text = intentText(prompt).replace(NEGATED_MUTATION_CLAUSE, '').replace(/每(?:做|执行|进行)一步[^。！？!?\n]*/g, '')
    // 「最后修改时间」是文件属性，不是要改文件。
    .replace(/(?:最后|最近|上次)?修改(?:时间|日期|记录)/g, '');
  if (/(?:只读|只查看|只看|只读取|只列出|不(?:删|改|动)(?![\u4e00-\u9fa5]{0,1}(?:除|动|写))|仅(?:需|限)?(?:调用|执行|查看|读取)|不要(?:修改|创建|删除|写入|更新))/i.test(text)) {
    // Generic “做/完成” near a later mention of 文件 describes a completed
    // *check* just as often as a write. Require an actual positive write verb.
    const explicitMutation = /(?:修改|改动|修复|生成|创建|制作|下载|上传|发布|安装|部署|打包|写入|更新|替换|移动|重命名).{0,36}(?:skill|技能|工作|任务|项目|文件|图片|视频|程序|脚本|应用|app|它|这个|该)?/i;
    if (!explicitMutation.test(text)) return false;
  }
  return MUTATION_REQUEST.test(text);
}

export function classifyDeliberationTask(prompt = '', mode = '') {
  const text = promptInstructionText(workFirstPrompt(prompt, mode)).replace(VALID_TIER, '').trim();
  if (!text) return 'pending';
  if (isMutationRequest(text)
      || /(?:写代码|修(?:复)?bug|修复故障|实现功能|重构代码|编写脚本|改代码|代码修改|fix(?:ing)? a bug|debug(?:ging)?|implement(?:ing)?|refactor(?:ing)?)/i.test(text)
      || (mode !== 'none' && /写(?:一个|个|一段|段)?.{0,12}(?:脚本|程序|代码|网页|页面|小工具|插件|函数)/i.test(text))) {
    return 'implementation';
  }
  if (/(?:方案|取舍|利弊|优缺点|对比|比较|选哪|哪个更好|怎么选|推荐哪|成本.{0,12}比较|compare|trade.?off|which (?:one|option)|pros and cons)/i.test(text)) {
    return 'tradeoff';
  }
  if (/(?:查证|核实|事实|来源|出处|真假|是否属实|最新(?:消息|版本|规定|价格)|当前(?:价格|版本|政策)|谁是|何时|哪一年|来源可靠吗|fact.?check|verify (?:whether|if|that))/i.test(text)) {
    return 'fact_check';
  }
  if (/(?:解方程|求方程|计算|证明|推导|逻辑题|数学题|标准答案|多步推理|复杂问题|难题|求解|why does|prove that|solve for|calculate|derive)/i.test(text)
      || (text.length > 700 && /(?:为什么|原因|如何判断|是否成立|怎么算|怎么证明)/i.test(text))) {
    return 'standard_answer';
  }
  return 'simple';
}

function normalizedTaskType(value = '') {
  return Object.prototype.hasOwnProperty.call(TASK_WORKFLOWS, value) ? value : 'simple';
}
// A response-only smoke test is not permission to execute work.  Keep this
// guard before ACTION_REQUEST because the requested reply may itself contain
// words such as “测试/完成”, which otherwise look like an action request.
const RESPONSE_ONLY_PREFIX = /^(?:请(?:你)?\s*)?(?:只|仅)(?:需|要)?(?:回复|回答|输出|说)(?:\s*[:：,，]?)/i;
const RESPONSE_ONLY_FOLLOWUP_ACTION = /(?:然后|并且|同时|再|之后|接着|随后|并|且)\s*(?:调用|使用|执行|运行|修改|改|修复|生成|创建|制作|下载|上传|发布|删除|安装|部署|打包|写入|更新|替换|移动|重命名|测试|验证)/i;
const READ_ONLY_DIAGNOSTIC_INTENT = /(?:只读|不要(?:进行)?(?:任何)?操作|不操作|不要(?:点击|输入|修改|改动|创建|删除|写入|更新)|(?:只|仅)(?:需|要)?(?:检查|查看|读取|返回|回复|输出))/i;
const DIAGNOSTIC_TARGET = /(?:权限|辅助功能|屏幕录制|状态|连通|健康|网关|端口|进程|模型|额度|桌面|屏幕|尺寸|版本|签名|身份)/i;
const EXECUTION_TOOL = /(?:^|_)(?:exec|write|edit|apply_patch|browser|computer|cua|imagegen|create|update|delete|move|send|publish|upload|download|install|deploy|pinkie_model_capability)(?:$|_)/i;
const OBSERVATION_TOOL = /(?:^|_)(?:read|view|inspect|find|search|list|status|open_file|file_fetch|dir_fetch|dir_list)(?:$|_)/i;
const MUTATING_TOOL = /^(?:write|edit|apply_patch|create|update|delete|move|upload|download|image_generate|imagegen|pinkie_model_capability)$/i;
// Bookkeeping tools change nothing outside the chat (a checklist the UI shows),
// even though their names contain "update".
const BOOKKEEPING_TOOL = /^(?:plan_update|update_plan)$/i;
const SKILL_PATH = /(?:^|[\\/])SKILL\.md$/i;
const VERIFIER_PATH = /(?:^|[\\/])tools[\\/]verify_completion\.py$/i;
const EVIDENCE_FILE = /(?:pipeline_state|submission_ledger|video_ledger|qc_report|publish_receipt|publication_verification|cleanup_report)\.json|(?:published|public_page|cleanup_desktop)\.png|public_page_evidence\.txt/i;
const DELIVERY_GUARD_TOOL = 'delivery_guard';
const WORKFLOW_EVIDENCE_TARGETS = Object.freeze({
  submission_ledger: 'reports/submission_ledger.json',
  video_ledger: 'reports/video_ledger.json',
  qc_report: 'reports/qc_report.json',
  publish_receipt: 'publish/publish_receipt.json',
  publication_verification: 'publish/publication_verification.json',
  cleanup_report: 'reports/cleanup_report.json',
});
const CLE_KK_CONTROL_PATH = /(?:Library[\\/]Application Support[\\/]SuperPinkie[\\/]cle-kk|\.openclaw[\\/](?:extensions[\\/]pinkie-mode-architecture|pinkie-deep-think))/i;
const TIMESTAMP_TAMPERING = /(?:\bos\.utime\s*\(|\butime\s*\(|(?:^|[;&|]\s*)touch\s+(?:-[^\s]+\s+)*)/i;
const CROSS_RUN_EVIDENCE_COPY = /(?:shutil\.(?:copy|copy2|copyfile)|\bcp\s|\brsync\s)[\s\S]{0,1200}(?:[\\/]runs[\\/]|[\\/]output[\\/])[\s\S]{0,1200}(?:[\\/]runs[\\/]|[\\/]output[\\/])/i;
// Provider account pools can report an exhausted account as a successful HTTP
// response whose stream contains "subscription usage limit"/"quota exhausted".
// Treat that as recoverable so the next watchdog turn can be routed to another
// configured account; it is not a permanent billing/configuration failure for
// the whole pool.
const TRANSIENT_FAILURE = /(?:timeout|timed out|network|fetch failed|econn|connection[_ -](?:reset|closed)|socket|upstream|overload|rate.?limit|subscription.{0,32}(?:usage|quota).{0,24}limit|(?:usage|quota).{0,24}(?:exhausted|limit(?:ed)?|remaining)|insufficient[_ -]?quota|terminated|abort(?:ed|error)?|incomplete(?: turn| response)?|without (?:a )?(?:final )?(?:reply|response)|missing (?:final )?assistant|empty (?:final )?(?:reply|response)|session file changed while embedded prompt lock was released|EmbeddedAttemptSessionTakeoverError|\b429\b|\b50[234]\b|temporar|try again)/i;
// A provider quota response is not a network outage. Retrying the same
// provider forever makes the UI look like it is reconnecting and burns quota.
// The watchdog uses this classifier to make a bounded fallback switch.
const PROVIDER_ACCOUNT_FAILURE = /(?:you(?:'|’)ve reached (?:your )?(?:codex )?subscription usage limit|subscription usage limit|usage limit(?: exceeded| reached)?|quota(?:[ _-]+(?:exhausted|exceeded|depleted|reached))|insufficient credits|billing limit|rate limit reached|auth[_ -]?unavailable|no auth available|no account|account unavailable|暂无账号)/i;
// 上游暂时连不上（11-17 实测：免费模型的代理一时「no auth available」/ 503，几秒内重试 5 次全失败，任务就此停住，
// 之后上游恢复了也没人接着做）。这类不是账号额度用完，换别家模型也不是用户要的：原模型不变，隔得越来越久地接着试，
// 最长等几个小时，上游一恢复就从断点续上。
export const PROVIDER_OUTAGE = /(?:\b50[234]\b|auth[_ -]?unavailable|no auth available|service unavailable|temporarily unavailable|bad gateway|gateway time-?out|overloaded|connection (?:refused|reset|closed)|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network error|LLM request failed|upstream (?:error|unavailable)|timed? ?out)/i;
const PROVIDER_QUOTA = /(?:usage limit|quota(?:[ _-]+(?:exhausted|exceeded|depleted|reached))|insufficient credits|billing limit|subscription)/i;
export const WATCHDOG_OUTAGE_DELAYS_MS = Object.freeze([10_000, 20_000, 40_000, 80_000, 160_000, 300_000]);
const WATCHDOG_OUTAGE_MAX_ATTEMPTS = Math.max(6, Number(process.env.PINKIE_WATCHDOG_OUTAGE_MAX_ATTEMPTS) || 60);
export const isProviderOutage = reason => PROVIDER_OUTAGE.test(String(reason || '')) && !PROVIDER_QUOTA.test(String(reason || ''));
const WATCHDOG_ACCOUNT_FALLBACKS = Object.freeze([
  'mm/gemini-3.7-flash-tiered',
  'clekk/gpt-5.6-luna',
  'mm/gemini-3.6-flash-tiered',
  'clekk/gpt-5.6-terra',
]);
const GATEWAY_RECOVERY_FAILURE = /(?:GatewayDrainingError|gateway is draining|restart drain|admission (?:is )?closed|session transcript projection is rebuilding|transcript projection is rebuilding|projection is rebuilding|gateway restarting|gateway not ready|审计日志正被写入)/i;
const AUDIT_CORRUPTION_FAILURE = /(?:审计链断裂|审计日志不可读|状态摘要不一致|状态文件不可读)/i;
// OpenClaw has already run its own compaction recovery before agent_end emits
// this terminal error. Replaying the same oversized transcript cannot shrink
// it; it only starts another multi-minute compaction and burns quota forever.
// The aws-quick gateway rejects a single frame over ~63000 bytes with
// `context_length_exceeded` / "64 KB message limit"; replaying it is the same dead end.
const CONTEXT_OVERFLOW_FAILURE = /(?:context overflow|prompt too large for (?:the )?model|maximum context length|context[ _]length[ _]exceeded|too many (?:input )?tokens|64 ?KB message limit|bytes after shortening, over \d+)/i;
// Different from a plain over-limit request: this message means the native
// compactor did create/re-map a checkpoint but could not hand control back to
// the interrupted turn.  It is safe to make one bounded continuation attempt
// from CLE Kk's own checkpoint capsule; blindly retrying every context overflow
// would just replay the same oversized prompt forever.
const AUTO_COMPACTION_RECOVERY_FAILURE = /(?:auto[ -]?compaction.{0,96}(?:could not recover|cannot recover|failed|unable to recover)|compacted (?:history|transcript).{0,96}(?:could not recover|failed)|自动(?:上下文)?压缩.{0,96}(?:无法|不能|未能).{0,32}(?:恢复|续接)|压缩后.{0,96}(?:无法|不能|未能).{0,32}(?:恢复|续接))/i;
const CONTINUATION_ONLY_PROMPT = /^(?:(?:好|好的|可以|对|嗯|明白了|收到)[，,、\s]*)?(?:继续|接着|往下|做下去|继续完成)(?:吧|啊|呀)?[！!。,.\s]*$/u;
const PERMANENT_FAILURE = /(?:cancel(?:led|ed) by (?:the )?user|user (?:cancelled|canceled|aborted)|abort requested|cancel requested|stopped by (?:the )?user|unauthori[sz]ed|invalid api.?key|permission|forbidden|unsupported model|unknown model|model (?:not found|does not exist)|billing|policy)/i;
// These checks came from the Windows runtime snapshot. Keep its bounded
// recovery behavior on Windows while the macOS watchdog remains unchanged.
const LOCAL_SETUP_FAILURES = [
  [/(?:cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|\bENOENT\b|no such file or directory)/i,
    '碧琪缺少运行需要的文件，没有自动重试。请重新安装或更新碧琪。'],
  [/(?:unknown method|method not found)/i,
    '碧琪的核心插件没有完整加载，没有自动重试。请重启碧琪；还不行就重新安装。'],
  [/(?:\b404\b|not[_ ]found[_ ]error|page not found)/i,
    '模型服务地址不对（404），没有自动重试。请在设置里检查模型服务地址。'],
];
const LOCAL_SERVICE_DOWN = /(?:ECONNREFUSED|connection refused|\bconnection error\b)/i;
const LOCAL_SERVICE_DOWN_RETRIES = 2;
const LOCAL_SERVICE_DOWN_MESSAGE = '连不上模型服务，试了两次都没连上，先停下了。请确认模型代理已经启动、地址没写错、网络是通的，然后再发一次。';
const DISPATCH_SETUP_FAILURE = /(?:GatewayCredentialsRequiredError|requires credentials before opening a websocket|cannot find module|ERR_MODULE_NOT_FOUND|\bENOENT\b)/i;
const WATCHDOG_DISPATCH_FAILURE_LIMIT = 8;
const WATCHDOG_MAX_ATTEMPTS = Math.max(3, Number(process.env.PINKIE_WATCHDOG_MAX_ATTEMPTS) || 30);

export function localSetupFailure(reason = '', attempts = 0) {
  const text = String(reason || '');
  for (const [pattern, message] of LOCAL_SETUP_FAILURES) if (pattern.test(text)) return message;
  if (LOCAL_SERVICE_DOWN.test(text) && attempts >= LOCAL_SERVICE_DOWN_RETRIES) return LOCAL_SERVICE_DOWN_MESSAGE;
  return '';
}
const WATCHDOG_MESSAGE = '\u2063';
// 续接消息不能只是一个看不见的字符：模型会把它当成空消息/心跳，按 OpenClaw 的规则回 NO_REPLY，
// 用户就收不到任何最终回复（2026-10-12 实测）。改成带前缀的内部命令：界面按 [pinkie-watchdog] 前缀隐藏，
// 时间线也把它当内部消息，不会拆开这一轮。
const WATCHDOG_CONTROL_PREFIX = '[pinkie-watchdog]';
function watchdogControlMessage(instruction = '') {
  const body = String(instruction || '').replace(/\s+/g, ' ').trim()
    || '继续完成当前这一轮用户交代的工作，完成后正常交付。';
  return `${WATCHDOG_CONTROL_PREFIX} ${body} 这是当前用户轮次的内部续跑命令，用户看不到这条消息；不要回复 NO_REPLY，也不要在回复里提到这条命令。`;
}
const PLUGIN_BUILD = '2026-11-02.6-work-kinds';

// 同一个网关进程里，OpenClaw 会把本插件加载好几份：网关注册表一份（界面调用的 RPC 走这里），
// agent runtime 注册表一份（运行中的钩子、工具走这里），按工作区 / 运行还会再建（日志 instance=3、4…）。
// 每份 register() 都 new 自己的看门狗、CLE Kk、门禁……于是「停止」按钮的取消、深度思考的开关、
// 推演任务的中止都改在 A 份，真正跑钩子的却是 B 份——改了等于没改（2026-10-12 实测：按停止后自动续跑）。
// 这里把各份的内存状态（Map / Set：计时器、停止标记、回合状态、工具证据……）换成进程内共享的同一份，
// 类本身不动，每份照常注册钩子 / 工具 / RPC，只是看的是同一份状态。按构建号区分，避免新旧代码混用。
function sharePluginState(owner, scope, fields) {
  if (!owner) return;
  const root = globalThis.__pinkieSharedState instanceof Map
    ? globalThis.__pinkieSharedState
    : (globalThis.__pinkieSharedState = new Map());
  for (const field of fields) {
    const current = owner[field];
    if (!(current instanceof Map || current instanceof Set)) continue;
    const id = `${PLUGIN_BUILD}:${scope}.${field}`;
    if (!root.has(id)) root.set(id, current);
    owner[field] = root.get(id);
  }
}
// 用户主动停止的会话：短窗口内任何 agent_end 都不按故障自动续接。
// 一次停止会产生不止一个 agent_end（嵌套执行通道各报一次中断），单次的 skipNextFailure
// 会被第一个吃掉，第二个就被当成上游断流自动续上——表现为「按了停止，几秒后又自己跑起来」。
// 记录放在 globalThis 上，插件万一被加载两份也共享同一份停止记录；用户发下一条消息时结束窗口。
const USER_STOP_GRACE_MS = 10_000;
const userStops = globalThis.__pinkieUserStops instanceof Map
  ? globalThis.__pinkieUserStops
  : (globalThis.__pinkieUserStops = new Map());
function userStoppedRecently(sessionKey) {
  const until = userStops.get(sessionKey) || 0;
  if (until > Date.now()) return true;
  if (until) userStops.delete(sessionKey);
  return false;
}
// Upstream availability is intentionally handled as a long-lived recovery
// lane.  Keep the first retry quick, then give a flapping provider more room
// instead of exhausting the visible turn after only a few seconds.  Operators
// can tune these without changing the mode or prompt configuration.
// 一次模型调用超过这么久还没结束、这一轮又失败了：多半是一口气生成的东西太长（整份 PPT 脚本、整页网页），
// 被卡死恢复中止。11-04 隔离实测 R-ppt：同一个 8 页脚本连写三次，每次 385 秒被掐断，什么都没留下。
export const WATCHDOG_STALLED_GENERATION_MS = Math.max(60_000,
  Number(process.env.PINKIE_WATCHDOG_STALLED_GENERATION_MS) || 240_000);
const WATCHDOG_RETRY_MAX_DELAY_MS = Math.max(750,
  Number(process.env.PINKIE_WATCHDOG_RETRY_MAX_DELAY_MS) || 3_000);
const WATCHDOG_GATEWAY_BACKOFF_INITIAL_MS = Math.max(250,
  Number(process.env.PINKIE_WATCHDOG_GATEWAY_BACKOFF_INITIAL_MS) || 500);
const WATCHDOG_GATEWAY_BACKOFF_MAX_MS = Math.max(2_000,
  Number(process.env.PINKIE_WATCHDOG_GATEWAY_BACKOFF_MAX_MS) || 5_000);
const WATCHDOG_ACTIVITY_POLL_MS = Math.max(250,
  Number(process.env.PINKIE_WATCHDOG_ACTIVITY_POLL_MS) || 500);
const WATCHDOG_QUIET_FENCE_MS = Math.max(750,
  Number(process.env.PINKIE_WATCHDOG_QUIET_FENCE_MS) || 1_500);
const WATCHDOG_CLI_TIMEOUT_MS = Math.max(2_000,
  // A busy OpenClaw session lane can legitimately take well over five
  // seconds to acknowledge chat.send. Killing the CLI at five seconds is
  // ambiguous: the gateway may already have accepted the turn, and blindly
  // resending then creates two invisible runs that fight over the JSONL.
  Number(process.env.PINKIE_WATCHDOG_CLI_TIMEOUT_MS) || 30_000);
const TIER_CONTROL_PREFIX = '[pinkie-tier-control]';
const TIER_FAILED_TURN_LIMIT = 6;
const TIER_FAILED_TURN_BASE_MS = 30_000;
const TIER_FAILED_TURN_MAX_MS = 8 * 60_000;
const TIER_FAILED_TURN_RESET_CAP_MS = 15 * 60_000;
const DISPLAY_PRICING_VERSION = 2;
const pinkieStateRoot = () => process.env.PINKIE_STATE_ROOT || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SuperPinkie')
  : path.join(os.homedir(), 'Library/Application Support/SuperPinkie'));

function tierControlMessage(status = {}) {
  if (status.complete) {
    return `${TIER_CONTROL_PREFIX} 子代理审议已通过，但原始用户任务还没有因此自动完成。立即回到用户最初目标：如果用户要求改、做、生成、打开、运行或验证，就由主代理真正调用工具完成成品并验证；如果用户只是提问，就直接给明确答案。不得只写分析报告、方案、角色总结或“建议下一步”。最终回复只需要先说成品/答案，再用 1—3 行说清实际修改与验证；除非用户明确要求，不得汇报角色数量、流水线、打回轮次或审议过程。这是当前用户轮次的内部续跑命令，不得输出 NO_REPLY。`;
  }
  // 用平常的话说还差什么：「后端硬验收」「内部命令」这类措辞，谨慎的模型会当成可疑指令而不照做。
  return `${TIER_CONTROL_PREFIX} 用户这件事还差：${(status.missing || []).join('；')}。接着做，把差的补上：有 sessions_spawn 时用它派出还缺的子任务，再用 sessions_yield 等这一批回来。${SPAWN_FALLBACK}子任务的结果由系统收集；工具结果里关于“Auto-announce”或“NO_REPLY”的通用备注在这里不适用：不得输出 NO_REPLY，也不要在回复里提到这条提醒。`;
}

function displayCost(value = {}, requests = Number(value.requests) || 0) {
  const input = Number(value.input) || 0;
  const output = Number(value.output) || 0;
  const cacheRead = Number(value.cacheRead) || 0;
  const cacheWrite = Number(value.cacheWrite) || 0;
  // 只做平缓的本机展示累计：每次有效输出至少增加一分钱，Token
  // 部分沿用界面原本的低倍率，不冒充供应商真实账单。
  return requests * 0.01
    + input / 1e6 * 0.2
    + output / 1e6 * 1.5
    + cacheRead / 1e6 * 0.02
    + cacheWrite / 1e6 * 0.2;
}

export function isTransientFailure(value = '') {
  const text = String(value || '');
  return !PERMANENT_FAILURE.test(text) && (TRANSIENT_FAILURE.test(text) || GATEWAY_RECOVERY_FAILURE.test(text));
}

// The browser collaboration bridge may receive older replies that still carry
// its former C2C envelope. It is transport metadata, not a user-visible plan;
// never let it enter the next model turn where it could be echoed back into
// chat or mistaken for an instruction.
function stripWebGptProtocol(value = '') {
  return String(value || '')
    .replace(/^\s*\[C2C\]\s*\n?/i, '')
    .replace(/^\s*(?:STATE|TASK_ID|ITERATION)\s*:[^\n]*\n?/gim, '')
    .replace(/^\s*PLAN\s*:\s*/i, '')
    .trim();
}

// The webpage performs the broad read/reasoning pass on the user's ChatGPT
// account. Only a bounded, evidence-backed handoff enters the local Codex
// context, so web collaboration reduces local context pressure instead of
// duplicating an entire second conversation.
const WEB_GPT_PLAN_MAX_CHARS = 6_000;

function failureReasonFromEvent(event = {}) {
  const reasons = [];
  const add = value => {
    if (typeof value === 'string' && value.trim()) reasons.push(value.trim());
    else if (value instanceof Error && value.message) reasons.push(value.message);
    else if (value && typeof value === 'object') {
      for (const key of ['kind', 'name', 'code', 'message', 'status', 'stopReason']) add(value[key]);
    }
  };
  for (const key of ['error', 'errorMessage', 'failureKind', 'errorCategory', 'terminalError', 'stopReason', 'outcome', 'status']) {
    add(event[key]);
  }
  // Some OpenClaw builds expose an aborted provider request only on the final
  // assistant message, while agent_end itself has no error string.
  const messages = Array.isArray(event.messages) ? event.messages.slice(-6) : [];
  for (const entry of messages) {
    const message = entry?.message && typeof entry.message === 'object' ? entry.message : entry;
    if (!message || message.role !== 'assistant') continue;
    add(message.error);
    add(message.errorMessage);
    add(message.stopReason);
  }
  return [...new Set(reasons)].join(' ');
}

function startedBackgroundTask(message) {
  if (!/^(?:toolResult|tool_result)$/i.test(String(message?.role || ''))) return false;
  const details = message?.details;
  if (details?.async === true && /^(?:started|running|queued)$/i.test(String(details.status || ''))) return true;
  return /Background task started for \w+ generation\b/.test(resultText(message?.content ?? message?.result));
}

function yieldedTurn(message) {
  if (!/^(?:toolResult|tool_result)$/i.test(String(message?.role || ''))) return false;
  if (!/^sessions_yield$/i.test(String(message?.toolName || message?.name || ''))) return false;
  return !message?.isError && (message?.details?.status === 'yielded' || /"status"\s*:\s*"yielded"/.test(resultText(message?.content ?? message?.result)));
}

// 这一轮以 sessions_yield 收尾：有意停下等子任务，不是「没写最终回复」。
function endsWithYield(messages = []) {
  const list = (Array.isArray(messages) ? messages.slice(-8) : []).map(entry => (
    entry?.message && typeof entry.message === 'object' ? entry.message : entry
  ));
  const lastAssistant = [...list].reverse().find(message => message?.role === 'assistant');
  const trailing = list.slice(list.lastIndexOf(lastAssistant) + 1)
    .filter(message => /^(?:toolResult|tool_result)$/i.test(String(message?.role || '')));
  return trailing.length > 0 && trailing.every(yieldedTurn);
}

function hasIncompleteToolTurn(event = {}, reason = '', ctx = {}) {
  // A turn that ends on ask_user is deliberately waiting for the user's
  // choice; resuming it would answer the question on the user's behalf.
  if (endsWithUserQuestion(event.messages)) return false;
  const incomplete = /(?:incomplete(?:[_ -](?:turn|response))?|non[_ -]?deliverable[_ -]?terminal[_ -]?turn)/i.test(reason);
  // Preserve legacy behavior outside the four work-first parent modes.
  if (incomplete && !workFirstContext(ctx)) return true;
  const messages = (Array.isArray(event.messages) ? event.messages.slice(-8) : []).map(entry => (
    entry?.message && typeof entry.message === 'object' ? entry.message : entry
  ));
  const lastAssistant = [...messages].reverse().find(message => message?.role === 'assistant');
  const lastMessage = messages.at(-1);
  // image_generate / video tools hand back "Background task started" and the
  // host yields the turn until the completion event arrives. That wait is the
  // intended terminal state, not a missing final reply.
  const assistantIndex = messages.lastIndexOf(lastAssistant);
  const trailingResults = messages.slice(assistantIndex + 1)
    .filter(message => /^(?:toolResult|tool_result)$/i.test(String(message?.role || '')));
  if (trailingResults.length && trailingResults.every(startedBackgroundTask)) return false;
  // A known async handoff takes precedence over the host's generic
  // non-deliverable marker. Its completion event owns the next turn.
  if (incomplete) return true;
  // A transport can report success=true after returning a failed toolResult,
  // without another assistant event or a useful top-level error. Treat that
  // as an incomplete tool lane so the model immediately retries only the
  // failed operation after checking existing effects.
  if (/^(?:toolResult|tool_result)$/i.test(String(lastMessage?.role || ''))
      && toolResultFailed(lastMessage, resultText(lastMessage?.content ?? lastMessage?.result))) {
    return true;
  }
  // Newer hosts may mark the outer run success=true after a tool result even
  // though the model never produced the required terminal assistant reply.
  // The transcript shape is authoritative here; transport success only means
  // the tool loop did not throw.
  return /^(?:toolUse|tool_use)$/i.test(String(lastAssistant?.stopReason || ''));
}

function failedAssistantMessage(message = {}) {
  return message?.role === 'assistant'
    && /^(?:error|aborted)$/i.test(String(message.stopReason || message.stop_reason || ''));
}

function endedWithFailedAssistant(event = {}) {
  const messages = Array.isArray(event.messages) ? event.messages : [];
  const last = messages.at(-1);
  return failedAssistantMessage(last?.message || last);
}

// API 断链恢复属于会话层能力，不应只覆盖四个 UI 模式。实际运行时
// OpenClaw 可能使用自定义 agentId（例如本地模型/工作区插件），但仍然
// 会提供标准的 agent:<id>:<session> 会话键。只排除子代理，避免把同一
// 次任务的内部子会话再次注入；可通过 PINKIE_WATCHDOG_ALL=0 回退到旧的
// “仅 CLE Kk 主模式”行为，便于兼容需要自行管理重试的部署。
function isWatchdogParentContext(ctx = {}) {
  const sessionKey = String(ctx.sessionKey || '');
  if (!sessionKey || isUnresolvedSessionKey(sessionKey) || /:(?:subagent|internal-session-effects):/.test(sessionKey)) return false;
  if (String(process.env.PINKIE_WATCHDOG_ALL || '1') === '0') return Boolean(modeForContext(ctx));
  return Boolean(ctx.agentId || agentFromSessionKey(sessionKey));
}

function safeTag(sessionKey) {
  let hash = 2166136261;
  for (const char of sessionKey) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `pinkie-watchdog-${(hash >>> 0).toString(16)}`;
}

function shortReason(reason = '') {
  return String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 240) || '未知错误';
}

function resolveGatewayCliEntry() {
  const bundled = '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/openclaw.mjs';
  const candidates = [
    process.env.PINKIE_OPENCLAW_ENTRY,
    process.env.OPENCLAW_ROOT && path.join(process.env.OPENCLAW_ROOT, 'openclaw.mjs'),
    bundled,
    process.argv[1],
  ].filter(Boolean).map(String);
  return candidates.find(entry => fs.existsSync(entry)
    && /(?:[\\/]openclaw\.mjs|[\\/]openclaw[\\/]dist[\\/]index\.js)$/i.test(entry)) || '';
}

function isInternalExecutionSession(sessionKey = '') {
  return /:(?:subagent|internal-session-effects):/.test(String(sessionKey || '')) || isUnresolvedSessionKey(sessionKey);
}

function runProcess(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        // The bundled gateway CLI prints its structured failure (including
        // GatewayDrainingError / projection-rebuilding details) to stdout and
        // then exits non-zero.  Keep both streams on the Error so the retry
        // loop can select its recovery backoff instead of hammering the
        // draining gateway every few seconds.
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolve({stdout, stderr});
    });
  });
}

const COMPLETION_TRUTH_RULES = `
【全局交付真实性门禁】
- “模型说完成了”、状态文件里的 COMPLETED、脚本打印 SUCCESS/SUBMITTED、应用进程存在，都不是完成证据；它们只能表示某一步被尝试。
- 用户要求执行、修改、生成、下载、发布或调用 Skill 时，必须先真实调用工具，再核对任务完成后的客观状态。没有可验收产物时只能说“未完成/仍在处理/被阻塞”，绝不能写完成报告。
- PREPARED、STAGED、SUBMITTED、INSPECTED、QUEUED、后台生成中都属于中间状态，不得冒充最终交付。外部生成任务必须等产物实际下载到本轮目标目录并通过格式、尺寸/时长、时间戳和可读性检查。
- 读取 Skill 后，如果同目录存在 tools/verify_completion.py，最终声称完成前必须让系统真实性校验通过；禁止修改、绕过或伪造该校验器和验收回执。
- 需要机器回执的 Skill 只能调用“成果核验”工具写入受控证据，并在最后调用同一工具的 verify 动作；通用 write、临时脚本或模型文字不能生成权威回执。
- 禁止复制旧运行的图片、视频、发布截图或回执冒充本轮成果；禁止用 touch、os.utime、改系统时间等方式伪造“本轮新生成”。发布回执、公开页凭据和 QC 结果必须由对应真实动作及专用适配器产生，不能用 write 或临时 Python/Node 脚本手写。
- 工具失败后保留旧成果，不覆盖旧文件来伪装本轮成功；修复后必须重新验证。无法继续时说清真实阻塞和已保留内容。
`.trim();

export {
  MODE_BY_AGENT,
  PERSONA_FILES,
  ALWAYS_MEMORY_FILES,
  TIER_LIMITS,
  SOLVER_LIMITS,
  UPGRADE_ROLES,
  ROLE_LABELS,
  TASK_WORKFLOWS,
  VALID_TIER,
  NO_PROGRESS_LIMIT,
  DRAFT_KEEP,
  RETRY_DIFFERENCE,
  GATE_RESEARCH,
  MODE_ARCHITECTURE_SOURCE,
  MODE_ARCHITECTURE_TASK,
  COMPLETION_CLAIM,
  DELIVERY_CLAIM,
  WORK_ACTION_CLAIM,
  WORK_PRODUCT_CLAIM,
  REPORTED_MUTATION,
  REPORTED_EXTERNAL_ACTION,
  ENGLISH_MUTATION_CLAIM,
  ENGLISH_EXTERNAL_ACTION,
  ENGLISH_TEST_CLAIM,
  IN_PROGRESS_CLAIM,
  HONEST_INCOMPLETE,
  ACTION_REQUEST,
  MUTATION_REQUEST,
  QUESTION_ONLY,
  ACTION_CONTINUATION,
  NEGATED_MUTATION_CLAUSE,
  promptInstructionText,
  workFirstPrompt,
  hasAttachedSourceContent,
  TEXT_TASK,
  TEXT_TASK_HEAD,
  TEXT_TASK_TAIL,
  TEXT_TASK_EN,
  inlineSourceInstruction,
  ORDER_OR_STYLE_PHRASE,
  intentText,
  isMutationRequest,
  normalizedTaskType,
  RESPONSE_ONLY_PREFIX,
  RESPONSE_ONLY_FOLLOWUP_ACTION,
  READ_ONLY_DIAGNOSTIC_INTENT,
  DIAGNOSTIC_TARGET,
  EXECUTION_TOOL,
  OBSERVATION_TOOL,
  MUTATING_TOOL,
  BOOKKEEPING_TOOL,
  SKILL_PATH,
  VERIFIER_PATH,
  EVIDENCE_FILE,
  DELIVERY_GUARD_TOOL,
  WORKFLOW_EVIDENCE_TARGETS,
  CLE_KK_CONTROL_PATH,
  TIMESTAMP_TAMPERING,
  CROSS_RUN_EVIDENCE_COPY,
  TRANSIENT_FAILURE,
  PROVIDER_ACCOUNT_FAILURE,
  PROVIDER_QUOTA,
  WATCHDOG_OUTAGE_MAX_ATTEMPTS,
  WATCHDOG_ACCOUNT_FALLBACKS,
  GATEWAY_RECOVERY_FAILURE,
  AUDIT_CORRUPTION_FAILURE,
  CONTEXT_OVERFLOW_FAILURE,
  AUTO_COMPACTION_RECOVERY_FAILURE,
  CONTINUATION_ONLY_PROMPT,
  PERMANENT_FAILURE,
  LOCAL_SETUP_FAILURES,
  LOCAL_SERVICE_DOWN,
  LOCAL_SERVICE_DOWN_RETRIES,
  LOCAL_SERVICE_DOWN_MESSAGE,
  DISPATCH_SETUP_FAILURE,
  WATCHDOG_DISPATCH_FAILURE_LIMIT,
  WATCHDOG_MAX_ATTEMPTS,
  WATCHDOG_MESSAGE,
  WATCHDOG_CONTROL_PREFIX,
  watchdogControlMessage,
  PLUGIN_BUILD,
  sharePluginState,
  USER_STOP_GRACE_MS,
  userStops,
  userStoppedRecently,
  WATCHDOG_RETRY_MAX_DELAY_MS,
  WATCHDOG_GATEWAY_BACKOFF_INITIAL_MS,
  WATCHDOG_GATEWAY_BACKOFF_MAX_MS,
  WATCHDOG_ACTIVITY_POLL_MS,
  WATCHDOG_QUIET_FENCE_MS,
  WATCHDOG_CLI_TIMEOUT_MS,
  TIER_CONTROL_PREFIX,
  TIER_FAILED_TURN_LIMIT,
  TIER_FAILED_TURN_BASE_MS,
  TIER_FAILED_TURN_MAX_MS,
  TIER_FAILED_TURN_RESET_CAP_MS,
  DISPLAY_PRICING_VERSION,
  pinkieStateRoot,
  tierControlMessage,
  displayCost,
  stripWebGptProtocol,
  WEB_GPT_PLAN_MAX_CHARS,
  failureReasonFromEvent,
  startedBackgroundTask,
  yieldedTurn,
  endsWithYield,
  hasIncompleteToolTurn,
  failedAssistantMessage,
  endedWithFailedAssistant,
  isWatchdogParentContext,
  safeTag,
  shortReason,
  resolveGatewayCliEntry,
  isInternalExecutionSession,
  runProcess,
  COMPLETION_TRUTH_RULES,
};
