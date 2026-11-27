// 反馈内容脱敏与纠错分类：
// 底线：绝不写入聊天原文、文件内容、文件路径里的用户名、密钥、网址参数、称呼和姓名。
// 所有落盘和加密上报的记录都只包含枚举标签、受控脱敏后的摘要与双层文本净化。
import {WORK_KINDS} from './work-kinds.mjs';

export const MODE_LABELS = Object.freeze({
  chat: '唠嗑模式',
  project: '项目模式',
  thinking: '想法模式',
  learning: '学习模式',
  none: '无限制模式',
  metre: 'Metre',
});

export const MISTAKE_LABELS = Object.freeze({
  verification_gap: '未实际核验即声称完成或结果仍出错',
  misunderstood_intent: '理解偏离用户意图或答非所问',
  ignored_constraint: '遗漏要求或擅自改动范围外内容',
  wrong_tool_or_path: '文件位置、目录或工具使用不当',
  style_or_length: '回复篇幅过长、格式或语气不合要求',
  factual_or_logic_error: '事实、计算、逻辑或产出内容有误',
  explicit_rule_feedback: '需要调整长期配合规则或避坑习惯',
});

export const DIRECTION_LABELS = Object.freeze({
  verify_before_claim: '先实际运行或核对结果再回复',
  clarify_target: '改用用户指明的真实目标与方向',
  follow_scope: '严格按要求执行并控制改动范围',
  adjust_format_or_tone: '精简篇幅或按指定格式输出',
  stop_behavior: '停止同类错误做法并记住约束',
  redo_or_fix: '修正错误并重新处理',
});

const ALLOWED_MODES = new Set(Object.keys(MODE_LABELS));
const ALLOWED_OUTCOMES = new Set(['success', 'error', 'stopped']);
const ALLOWED_ERROR_KINDS = new Set(['', 'account', 'key', 'missing', 'busy', 'timeout', 'network', 'down', 'other']);
const ALLOWED_SOURCES = new Set(['user_message', 'memory_feedback', 'both']);

const SECRET_TOKEN_RE = /\b(?:sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?)\b/g;
const SECRET_KV_RE = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|passwd|authorization|bearer|token|密钥|令牌|密码|口令)\s*[:=：]?\s*(?:Bearer\s+)?([^\s,;"'<>`]{4,})/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const HOME_PATH_POSIX_RE = /\/(?:Users|home)\/[^/\s"'`<>|;]+(?:\/[^\s"'`<>|;?#]+)*(?:\?[^\s"'`<>|;#]+)?(?:#[^\s"'`<>|;]+)?/g;
const HOME_PATH_WIN_RE = /[A-Za-z]:\\Users\\[^\\\s"'`<>|;]+(?:\\[^\s"'`<>|;?#]+)*(?:\?[^\s"'`<>|;#]+)?(?:#[^\s"'`<>|;]+)?/gi;
const TILDE_USER_RE = /~[A-Za-z0-9._-]{1,32}(?=[\\/])/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>`)\]]+/gi;
const QUERY_PARAM_RE = /\?[A-Za-z0-9_.-]+=[^\s"'`<>)\]]+/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g;
const HONORIFIC_RE = /(?:先生|老板|老弟|女士|小姐)/g;
const SELF_NAME_RE = /(?:(?:叫我|称呼我(?:为)?|我是|名字是)\s*[^\s，。,.!！？;；]{1,12})/g;
const LONG_OPAQUE_RE = /\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/]{36,}={0,2}\b/g;

export function sanitizeFeedbackText(input, maxLen = 240) {
  let text = String(input ?? '').normalize('NFKC');
  if (!text) return '';
  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(URL_RE, (raw) => {
      try {
        const u = new URL(raw);
        return `${u.protocol}//${u.hostname}${u.pathname && u.pathname !== '/' ? '/...' : ''}`;
      } catch {
        return '<URL>';
      }
    })
    .replace(HOME_PATH_POSIX_RE, '<USER_HOME>')
    .replace(HOME_PATH_WIN_RE, '<USER_HOME>')
    .replace(TILDE_USER_RE, '<USER_HOME>')
    .replace(QUERY_PARAM_RE, '')
    .replace(SECRET_TOKEN_RE, '<REDACTED>')
    .replace(BEARER_RE, 'Bearer <REDACTED>')
    .replace(SECRET_KV_RE, '<REDACTED>')
    .replace(EMAIL_RE, '<EMAIL>')
    .replace(PHONE_RE, '<PHONE>')
    .replace(IP_RE, '<IP>')
    .replace(LONG_OPAQUE_RE, '<REDACTED>')
    .replace(SELF_NAME_RE, '<USER>')
    .replace(HONORIFIC_RE, '用户')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text.slice(0, maxLen);
}

export function sanitizeModelRef(model = '') {
  const raw = sanitizeFeedbackText(String(model || '').trim(), 120);
  if (!raw) return 'unknown';
  const cleaned = raw.replace(/[^A-Za-z0-9._:/@-]/g, '').slice(0, 120);
  return cleaned || 'unknown';
}

export function sanitizeToolName(name = '') {
  const cleaned = String(name || '').trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  return cleaned;
}

export function sanitizeWorkKind(kind = '') {
  const value = String(kind || '').trim();
  if (value === 'pending' || value === 'unknown') return value;
  return Object.hasOwn(WORK_KINDS, value) ? value : 'unknown';
}

export function sanitizeFeedbackValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value == null) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return sanitizeFeedbackText(value, 240);
  if (Array.isArray(value)) {
    return value.slice(0, 32).map(item => sanitizeFeedbackValue(item, depth + 1)).filter(item => item !== undefined);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const next = sanitizeFeedbackValue(v, depth + 1);
      if (next !== undefined) out[k] = next;
    }
    return out;
  }
  return undefined;
}

// id 是本机 randomUUID() 生成的记录主键，不是用户内容：只按字符白名单收窄，不能走文本脱敏。
// 否则 UUID 末段偶尔恰好是「1[3-9] 开头的 11 位数字」，会被 PHONE_RE 改写成 <PHONE>（约 0.03%），
// 落盘 id 就和内存里记下的 correctionId 对不上，replaceItem 静默找不到记录（tests/feedback.test.mjs:181 偶发）。
function sanitizeRecordId(id) {
  return String(id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 48);
}

export function sanitizeFeedbackRecord(record = {}) {
  return {...sanitizeFeedbackRecordFields(record), id: sanitizeRecordId(record?.id)};
}

function sanitizeFeedbackRecordFields(record = {}) {
  const type = record?.type === 'correction' ? 'correction' : 'usage';
  const mode = ALLOWED_MODES.has(record?.mode) ? record.mode : 'chat';
  const base = {
    id: String(record?.id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 48),
    type,
    at: sanitizeFeedbackText(record?.at || '', 40),
    appVersion: sanitizeFeedbackText(record?.appVersion || '', 32),
    channel: record?.channel === 'release' ? 'release' : 'dev',
    platform: sanitizeFeedbackText(record?.platform || '', 24),
    arch: sanitizeFeedbackText(record?.arch || '', 24),
    mode,
  };
  if (type === 'usage') {
    const tools = Array.isArray(record?.tools)
      ? [...new Set(record.tools.map(sanitizeToolName).filter(Boolean))].slice(0, 24)
      : [];
    const failedTools = Array.isArray(record?.failedTools)
      ? [...new Set(record.failedTools.map(sanitizeToolName).filter(Boolean))].slice(0, 12)
      : [];
    const workKinds = Array.isArray(record?.workKinds)
      ? [...new Set(record.workKinds.map(sanitizeWorkKind).filter(Boolean))].slice(0, 3)
      : [];
    return sanitizeFeedbackValue({
      ...base,
      workKind: sanitizeWorkKind(record?.workKind),
      workKinds,
      tools,
      failedTools,
      toolCalls: Math.max(0, Math.min(10_000, Math.round(Number(record?.toolCalls) || 0))),
      outcome: ALLOWED_OUTCOMES.has(record?.outcome) ? record.outcome : 'success',
      errorKind: ALLOWED_ERROR_KINDS.has(record?.errorKind) ? record.errorKind : (record?.errorKind ? 'other' : ''),
      durationMs: Math.max(0, Math.min(86_400_000, Math.round(Number(record?.durationMs) || 0))),
      model: sanitizeModelRef(record?.model),
      retried: Boolean(record?.retried),
    });
  }
  const mistakeKind = Object.hasOwn(MISTAKE_LABELS, record?.mistakeKind)
    ? record.mistakeKind
    : 'factual_or_logic_error';
  const correctionDirection = Object.hasOwn(DIRECTION_LABELS, record?.correctionDirection)
    ? record.correctionDirection
    : 'redo_or_fix';
  const prevWorkKind = sanitizeWorkKind(record?.prevWorkKind);
  const tags = Array.isArray(record?.tags)
    ? [...new Set(record.tags.filter(tag => ALLOWED_TOPIC_TAGS.has(tag)))].slice(0, 6)
    : [];
  const prevTools = Array.isArray(record?.prevTools)
    ? [...new Set(record.prevTools.map(sanitizeToolName).filter(Boolean))].slice(0, 16)
    : [];
  const summary = buildCorrectionSummary({
    mode,
    prevWorkKind,
    mistakeKind,
    correctionDirection,
  });
  return sanitizeFeedbackValue({
    ...base,
    source: ALLOWED_SOURCES.has(record?.source) ? record.source : 'user_message',
    prevWorkKind,
    prevTools,
    prevOutcome: ALLOWED_OUTCOMES.has(record?.prevOutcome) ? record.prevOutcome : 'success',
    model: sanitizeModelRef(record?.model),
    mistakeKind,
    correctionDirection,
    tags,
    summary,
  });
}

const ALLOWED_TOPIC_TAGS = new Set([
  '未先验证',
  '理解偏差',
  '遗漏要求',
  '擅自改动',
  '路径/位置错误',
  '工具选用',
  '回复过长',
  '格式不符',
  '逻辑/结果有误',
  '重复犯错',
  '规则偏好',
]);

const TOPIC_TAG_RULES = [
  ['未先验证', /(?:(?:没|未|不)\s*(?:运行|跑|测|测试|验证|核实|核对|检查|看)|没看|胡说|瞎编|假装|根本没好|还是报错|还是不行|still broken|didn'?t (?:verify|test|check))/i],
  ['理解偏差', /(?:理解错|搞错|弄错|弄反|答非所问|不是这个意思|我说的是|我没让你|不是让你|misunderstood|not what i meant)/i],
  ['遗漏要求', /(?:漏了|漏掉|忘了|没加|少了一|没按|少做了|missed|forgot|ignored)/i],
  ['擅自改动', /(?:擅自|自作主张|乱改|别动|不要改|怎么把.*改了|还原|revert|without asking)/i],
  ['路径/位置错误', /(?:路径错|目录错|写错地方|找错文件|错文件|wrong (?:path|file|dir|folder))/i],
  ['工具选用', /(?:用错工具|别用|不要用.*改用|换个工具|wrong tool)/i],
  ['回复过长', /(?:太长|太啰嗦|废话|精简|简短|长篇大论|别写报告|too long|verbose)/i],
  ['格式不符', /(?:格式不对|别分点|不要分点|别用\s*markdown|表格|分段|format)/i],
  ['逻辑/结果有误', /(?:写错|算错|逻辑错|不对|错了|有误|还是错|incorrect|wrong)/i],
  ['重复犯错', /(?:又犯|又错|怎么又|几次了|说过多少次|again|still)/i],
  ['规则偏好', /(?:以后|下次|不要再|别再|记住|从今以后|always|never again)/i],
];

const MISTAKE_RULES = [
  ['verification_gap', /(?:(?:没|未|不)\s*(?:运行|跑|测|测试|验证|核实|核对|检查|看)|假装|瞎说|胡编|根本没好|还是报错|还是不行|没生效|didn'?t (?:verify|test|check|run)|still broken|doesn'?t work)/i],
  ['wrong_tool_or_path', /(?:路径错|目录错|写错地方|找错文件|错文件|选错工具|用错工具|wrong (?:path|file|directory|folder|tool))/i],
  ['style_or_length', /(?:太长|太啰嗦|废话太多|简短点|精简|长篇大论|格式不对|别分点|别写报告|太生硬|语气不对|too long|verbose|wrong format)/i],
  ['ignored_constraint', /(?:没按|违反|不遵守|擅自|自作主张|漏了|漏掉|忘了|少了一|没加上|怎么把.*改了|不要乱改|ignored|missed|without asking)/i],
  ['misunderstood_intent', /(?:理解错|搞错|弄错|弄反|答非所问|不是这个意思|我说的是|我指的不是|我没让你|不是让你|misunderstood|not what i meant)/i],
  ['factual_or_logic_error', /(?:写错|改错|算错|逻辑错|不对|错了|有误|还是错|incorrect|wrong answer)/i],
  ['explicit_rule_feedback', /(?:以后不要|以后别|不要再|别再|下次记住|记住以后|从今以后.*(?:不要|别)|never again)/i],
];

const DIRECTION_RULES = [
  ['verify_before_claim', /(?:先验证|先测试|先跑|先运行|先看|核实|核对|确认再|run tests|verify first)/i],
  ['adjust_format_or_tone', /(?:简短|精简|直接说|换个格式|别分点|别写报告|语气|short|concise|format)/i],
  ['follow_scope', /(?:只改|别动|不要乱改|按要求|别漏|还原|keep|only change|follow)/i],
  ['clarify_target', /(?:我说的是|我指的是|应该是|其实是要|i meant|instead of)/i],
  ['stop_behavior', /(?:别再|不要再|以后别|以后不要|禁止|停止|never|stop)/i],
  ['redo_or_fix', /(?:重做|重写|重新|改过来|再改|修复|fix|redo)/i],
];

// 明确对着碧琪纠错的信号（避免把「帮我改一下这个表格里的错误」当成纠正碧琪）
const CORRECTION_TARGET_PINKIE = /(?:^(?:不对|错了|搞错了|弄错了|不是这样|不是这个意思|我不是让你|我没让你|别再|不要再|下次别|以后别|以后不要|太啰嗦|太长了|格式不对|还是报错|还是不对|没生效|怎么又|又错了|漏掉了|你搞错|你理解错|你写错|你改错|你算错|你漏了|你忘了|你没)|(?:你|碧琪|刚才|上面|这一版|这次)[^。！？\n]{0,12}(?:理解错|搞错|弄错|弄反|答非所问|写错|改错|算错|找错|漏了|漏掉|忘了|没按|没验证|没测试|没核实|胡说|瞎编|太长|太啰嗦|格式不对|擅自|自作主张|还是错|还是报错|还是不行)|(?:不要再|别再|以后(?:不要|别)|下次(?:不要|别)|记住(?:以后)?(?:不要|别))[^。！？\n]{1,30})/i;

// 非纠错的普通任务开头（如「帮我修一下这个报错」「请把代码里的错误改掉」）
const TASK_NOT_CORRECTION = /^(?:请|帮我|麻烦|帮忙|能不能|可以)?\s*(?:看下|看看|修一下|修复|排查|查一下|改一下|分析一下)?\s*(?:这个|这段|这份|那个|我的)?(?:报错|错误|bug|代码|文件|脚本|表格|公式)/i;

export function buildCorrectionSummary({
  mode = 'chat',
  prevWorkKind = 'unknown',
  mistakeKind = 'factual_or_logic_error',
  correctionDirection = 'redo_or_fix',
} = {}) {
  const modeLabel = MODE_LABELS[mode] || '对话模式';
  const kindLabel = WORK_KINDS[prevWorkKind]?.label || (prevWorkKind === 'unknown' ? '一般任务' : prevWorkKind);
  const mistakeLabel = MISTAKE_LABELS[mistakeKind] || MISTAKE_LABELS.factual_or_logic_error;
  const directionLabel = DIRECTION_LABELS[correctionDirection] || DIRECTION_LABELS.redo_or_fix;
  return sanitizeFeedbackText(
    `在「${modeLabel} · ${kindLabel}」中出现「${mistakeLabel}」，用户要求「${directionLabel}」。`,
    220,
  );
}

function classifyTextSignals(text = '') {
  let mistakeKind = 'factual_or_logic_error';
  for (const [kind, re] of MISTAKE_RULES) {
    if (re.test(text)) { mistakeKind = kind; break; }
  }
  let correctionDirection = 'redo_or_fix';
  for (const [dir, re] of DIRECTION_RULES) {
    if (re.test(text)) { correctionDirection = dir; break; }
  }
  const tags = [];
  for (const [tag, re] of TOPIC_TAG_RULES) {
    if (re.test(text)) tags.push(tag);
  }
  if (!tags.length) tags.push('逻辑/结果有误');
  return {mistakeKind, correctionDirection, tags: tags.slice(0, 6)};
}

export function detectUserCorrection(prompt = '', {
  hasPriorTurn = false,
  mode = 'chat',
  prevWorkKind = 'unknown',
  prevTools = [],
  prevOutcome = 'success',
} = {}) {
  const text = String(prompt || '').normalize('NFKC').trim();
  if (!text || text.length < 2) return null;
  // 只有确认存在上一轮或明确立规矩（不要再 / 以后别）时才判纠错
  const explicitRule = /(?:以后(?:不要|别)|下次(?:不要|别)|不要再|别再|从今以后.*(?:不要|别)|记住(?:以后)?(?:不要|别))/.test(text);
  if (!hasPriorTurn && !explicitRule) return null;
  if (!explicitRule && TASK_NOT_CORRECTION.test(text) && !CORRECTION_TARGET_PINKIE.test(text)) return null;
  if (!CORRECTION_TARGET_PINKIE.test(text)) return null;

  const {mistakeKind, correctionDirection, tags} = classifyTextSignals(text);
  return {
    source: 'user_message',
    mode,
    prevWorkKind: sanitizeWorkKind(prevWorkKind),
    prevTools,
    prevOutcome,
    mistakeKind,
    correctionDirection,
    tags,
    summary: buildCorrectionSummary({mode, prevWorkKind, mistakeKind, correctionDirection}),
  };
}

export function classifyFeedbackRule(text = '', {
  mode = 'chat',
  prevWorkKind = 'unknown',
  prevTools = [],
  prevOutcome = 'success',
} = {}) {
  const raw = String(text || '').normalize('NFKC').trim();
  if (!raw || raw.length < 3) return null;
  // 仅当记忆条款明显是纠偏、避坑或负向约束时计为纠错记录（不把普通事实如「用户住北京」算作纠错）
  const correctiveSignal = /(?:不要|别再|禁止|不得|避免|纠正|修正|搞错|写错|漏|太长|太啰嗦|先验证|先测|先看|先核对|格式|以后.*(?:必须|一律|直接|先|少|短))/i.test(raw);
  if (!correctiveSignal) return null;

  const {mistakeKind, correctionDirection, tags} = classifyTextSignals(raw);
  return {
    source: 'memory_feedback',
    mode,
    prevWorkKind: sanitizeWorkKind(prevWorkKind),
    prevTools,
    prevOutcome,
    mistakeKind,
    correctionDirection,
    tags,
    summary: buildCorrectionSummary({mode, prevWorkKind, mistakeKind, correctionDirection}),
  };
}
