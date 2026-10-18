// Li An 主动提问：给先生一张带 2–4 个选项的提问卡。
//
// 这个工具不阻塞等待。它把问题写进工具结果后立即返回，模型随即结束本轮；
// 先生在聊天页点选后，选择作为下一条普通消息发回来。这样提问不会让一轮
// 运行长时间挂起，也不会被看门狗当成“中断”而自动续跑。
//
// 工具结果以 ASK_MARKER + JSON 开头：网关的 chat.history 会去掉工具调用参数，
// 但保留工具结果，刷新后聊天页仍能从这里还原还没回答的提问卡。

export const ASK_USER_TOOL = 'ask_user';
export const ASK_MARKER = '[[PINKIE_ASK_V1]]';
export const ASK_ANSWER_PREFIX = '【回答 Li An 的提问】';

const MAX_QUESTION = 400;
const MAX_HEADER = 12;
const MAX_LABEL = 40;
const MAX_DESCRIPTION = 160;

export const ASK_USER_RULES = `
【主动提问】
- 需要先生在几个明确方向里拍板（方案取舍、范围、风格、要不要做有风险或不可撤销的操作），或缺少一个关键偏好、问了能明显少返工时，调用 ask_user，给一个问题和 2–4 个选项，每个选项附一句说明利弊；推荐的放第一个，并在标签后写“（推荐）”。不要在正文里列选项让先生手打。
- 能从项目、记录或常识自己判断的事不要问；一次只问真正卡住的那一件事。选项互斥；确实需要多选时设 multi_select。先生总能选“其他”自己写，不用为此加选项。
- 调用 ask_user 后本轮就此停下：最多再说一句“选好我就接着做”，不要继续调用工具，也不要替先生假设答案。先生的选择会以“${ASK_ANSWER_PREFIX}”开头作为下一条消息发来，收到后按选择继续原来的任务。
`.trim();

const clean = (value, limit) => String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);

/** Validate and normalize the model's arguments; throws a Chinese message the model can act on. */
export function normalizeAskParams(params = {}) {
  const question = clean(params.question, MAX_QUESTION);
  if (!question) throw new Error('ask_user 需要 question：用一句话写清要先生决定什么');
  const raw = Array.isArray(params.options) ? params.options : [];
  const options = raw.map((option) => (typeof option === 'string'
    ? {label: clean(option, MAX_LABEL), description: ''}
    : {label: clean(option?.label, MAX_LABEL), description: clean(option?.description, MAX_DESCRIPTION)}))
    .filter((option) => option.label);
  const labels = new Set(options.map((option) => option.label));
  if (options.length < 2 || options.length > 4) throw new Error('ask_user 需要 2–4 个选项');
  if (labels.size !== options.length) throw new Error('ask_user 的选项标签不能重复');
  return {
    question,
    header: clean(params.header, MAX_HEADER),
    options,
    multiSelect: params.multi_select === true || params.multiSelect === true,
  };
}

export function askToolResultText(record) {
  return `${ASK_MARKER}${JSON.stringify(record)}\n已把问题展示给先生，正在等先生选择。本轮到此为止：不要继续调用工具，也不要替先生假设答案；先生的选择会作为下一条消息发来。`;
}

/** Parse a stored ask_user tool result back into its question card. */
export function parseAskToolResult(text = '') {
  const value = String(text || '');
  const start = value.indexOf(ASK_MARKER);
  if (start < 0) return null;
  const body = value.slice(start + ASK_MARKER.length).split('\n')[0];
  try {
    const record = JSON.parse(body);
    return record && typeof record.question === 'string' && Array.isArray(record.options) ? record : null;
  } catch {
    return null;
  }
}

export function createAskUserTool() {
  return {
    name: ASK_USER_TOOL,
    label: '向你提问',
    description: '需要先生在几个明确方案中拍板、或缺少一个关键偏好时调用：在聊天页弹出一张提问卡，给 2–4 个可点选的选项（先生也可以选“其他”自己写）。调用后本轮立即结束，等先生的选择作为下一条消息发来。不要用正文列选项代替。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        question: {type: 'string', description: '要先生决定的问题，一句话，以问号结尾'},
        header: {type: 'string', description: '可选，2–6 个字的小标题，例如“方案”“范围”'},
        options: {
          type: 'array', minItems: 2, maxItems: 4,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              label: {type: 'string', description: '1–8 个字的选项名；推荐项放第一个并在后面写“（推荐）”'},
              description: {type: 'string', description: '一句话说明选这个会怎样、利弊是什么'},
            },
            required: ['label'],
          },
        },
        multi_select: {type: 'boolean', description: '选项可以同时选多个时设为 true'},
      },
      required: ['question', 'options'],
    },
    async execute(toolCallId, params = {}) {
      try {
        const record = {id: String(toolCallId || ''), ...normalizeAskParams(params)};
        return {content: [{type: 'text', text: askToolResultText(record)}], details: record, isError: false};
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {content: [{type: 'text', text: message}], details: {error: message}, isError: true};
      }
    },
  };
}

const isAskName = (name) => String(name || '') === ASK_USER_TOOL;
const messageOf = (entry) => (entry?.message && typeof entry.message === 'object' ? entry.message : entry);

/**
 * True when a transcript tail ends with a successful ask_user call: the turn
 * is deliberately waiting for the user, not an interrupted tool lane.
 */
export function endsWithUserQuestion(messages = []) {
  const tail = (Array.isArray(messages) ? messages.slice(-8) : []).map(messageOf).filter(Boolean);
  const last = tail.at(-1);
  if (!last) return false;
  if (/^(?:toolResult|tool_result|tool)$/i.test(String(last.role || ''))) {
    if (!isAskName(last.toolName || last.tool_name || last.name)) return false;
    return last.isError !== true;
  }
  if (String(last.role || '') !== 'assistant') return false;
  const parts = Array.isArray(last.content) ? last.content : [];
  return parts.some((part) => /^tool_?(?:call|use)$/i.test(String(part?.type || '').replace(/[-\s]/g, '_')) && isAskName(part?.name))
    && !parts.some((part) => /^tool_?(?:call|use)$/i.test(String(part?.type || '').replace(/[-\s]/g, '_')) && !isAskName(part?.name));
}
