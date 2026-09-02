import fs from 'node:fs';
import path from 'node:path';

const MODE_BY_AGENT = Object.freeze({
  main: 'chat',
  project: 'project',
  thinking: 'ideas',
  unrestricted: 'none',
});

const PERSONA_FILES = Object.freeze({
  chat: ['persona/core.md', 'persona/voice_examples.md'],
  project: ['persona/core.md'],
  ideas: ['persona/core.md', 'persona/voice_examples.md'],
  none: [],
});

const ALWAYS_MEMORY_FILES = Object.freeze([
  'memory/INDEX.md',
  'memory/identity.md',
  'memory/context/active.md',
]);

const TIER_LIMITS = Object.freeze({base: 20, boost: 48, full: 96});
const VALID_TIER = /\[deep-think:(base|boost|full)\]/i;

function agentFromSessionKey(key = '') {
  return /^agent:([^:]+):/.exec(key)?.[1] || '';
}

export function modeForContext(ctx = {}) {
  return MODE_BY_AGENT[ctx.agentId || agentFromSessionKey(ctx.sessionKey)] || null;
}

function isInside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function safeWorkspace(ctx = {}) {
  if (typeof ctx.workspaceDir !== 'string' || !path.isAbsolute(ctx.workspaceDir)) return null;
  try {
    return fs.realpathSync(ctx.workspaceDir);
  } catch {
    return null;
  }
}

function readWorkspaceFile(root, relative, maxChars = 25_600) {
  const requested = path.resolve(root, relative);
  if (!isInside(root, requested) || !fs.existsSync(requested)) return '';
  let resolved;
  try {
    resolved = fs.realpathSync(requested);
  } catch {
    return '';
  }
  if (!isInside(root, resolved) || !fs.statSync(resolved).isFile()) return '';
  const text = fs.readFileSync(resolved, 'utf8');
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n\n[文件超过全量加载上限，请先精简后再继续累积]`;
}

function section(relative, content) {
  return content ? `\n--- ${relative}（本轮从当前模式工作区完整重载）---\n${content.trim()}\n` : '';
}

export function buildDeliberationPlan(tier, mode) {
  const normalizedTier = TIER_LIMITS[tier] ? tier : 'boost';
  const upgrades = {
    chat: '加强档增加：假设审查员 + 固定两轮对抗；只用于确实复杂的求助。',
    project: '加强档增加：真实执行验证 + 模块递归分解（递归深度最多 2）。',
    ideas: '加强档增加：反批评 + 两条独立完整流水线后再做元仲裁。',
    none: '加强档按任务选两项：可执行产物优先“执行验证+递归分解”；创意任务优先“反批评+多流水线”；高风险判断优先“假设审查+多轮对抗”。',
  }[mode] || '';
  const tierRule = normalizedTier === 'base'
    ? '只运行第 0—4 层标准流水线，不启用六项升级。'
    : normalizedTier === 'boost'
      ? upgrades
      : '在标准流水线上启用全部六项升级：递归分解、多流水线自洽、多轮对抗、真实执行验证、假设审查、反批评。执行验证仅在存在可验证产物时运行；反批评只复核被否决候选，避免空转。';
  return `
【极致思考运行单：${normalizedTier} / ${mode}】
这是用户手动开启的一次性审议任务，必须真实调用子代理工具，不能只在正文里模拟角色。

标准流水线：
0. Planner ×1：拆任务并给出可逐条打勾的验收清单。
1. Solver ×3~5：同批并行，框架必须不同；复杂度低取 3，高取 5。
2. Critic ×2~3：同批并行，分别查逻辑、边界、原需求覆盖；只列问题。
3. Judge ×1：逐条核对验收清单并裁定。
4. 不通过才打回，最多 2 轮；到点必须从现有候选交付最优结果。

本档规则：${tierRule}

派生规则（强制）：
- 只用 sessions_spawn 的原生 subagent；context="fork"、runtime="subagent"、mode="run"。
- 不传 agentId、cwd、model、thinking；由当前 session 原样继承 agent、工作区、模型和思考设置。
- taskName 使用稳定英文句柄；label 只写 UI 显示名（如“规划师”“求解·边界”“批评·需求”“仲裁者”），不得创建或改名任何 agent id。
- 每批最多并行 5 个；启动一批后用 sessions_yield 等完成事件，不轮询 sessions_list/history。
- 递归深度硬上限 2；多流水线最多 3 条；辩论最多 3 轮；本次总派生上限 ${TIER_LIMITS[normalizedTier]}。
- 中间产物只进当前模式的 memory/context/deliberation/ 或子会话记录，不进入长期记忆。只有 Judge 的稳定结论经过判别后才能写 feedback/semantic。
- 最终先交付说人话的结论或成品，再用 2~4 行报告实际使用的角色数、打回轮数和验证结果。
`.trim();
}

export class ModeArchitecture {
  constructor() {
    this.active = new Map();
    this.recentCompaction = new Map();
  }

  arm(sessionKey, tier) {
    const agent = agentFromSessionKey(sessionKey);
    const mode = MODE_BY_AGENT[agent];
    if (!mode || !TIER_LIMITS[tier]) throw new Error('只支持四种模式与基础/加强/全开三档');
    const run = {tier, mode, count: 0, limit: TIER_LIMITS[tier]};
    this.active.set(sessionKey, run);
    return {mode, tier, text: buildDeliberationPlan(tier, mode)};
  }

  prompt(event, ctx) {
    const mode = modeForContext(ctx);
    const root = safeWorkspace(ctx);
    if (!mode || !root) return;
    const blocks = [];
    for (const relative of PERSONA_FILES[mode]) {
      blocks.push(section(relative, readWorkspaceFile(root, relative, relative.endsWith('core.md') ? 20_000 : 12_000)));
    }
    for (const relative of ALWAYS_MEMORY_FILES) {
      blocks.push(section(relative, readWorkspaceFile(root, relative)));
    }
    const sessionKey = ctx.sessionKey || '';
    const tier = VALID_TIER.exec(event.prompt || '')?.[1]?.toLowerCase();
    if (tier && sessionKey) {
      const armed = this.arm(sessionKey, tier);
      blocks.push('\n' + armed.text + '\n');
    }
    const reloaded = this.recentCompaction.get(sessionKey);
    if (reloaded) {
      blocks.push('\n【压缩后重载】上面的 persona/core、INDEX、identity、active 已从磁盘重新完整载入；不要依赖摘要中的旧副本。\n');
      this.recentCompaction.delete(sessionKey);
    }
    blocks.push(`
【四模式记忆运行规则：${mode}】
- 只读写当前 workspace 下的 persona/ 与 memory/；不得读取其他三个模式的对应目录。
- 用户明确说“记住”时写 memory/feedback/；普通信息先判重、判价值，不值得就不写。
- 闲置沉淀写 memory/episodic/YYYY-MM-DD.md；稳定事实覆盖更新 memory/identity.md，不能堆互相矛盾的版本。
- 当前任务状态只写 memory/context/active.md；结束即清空或归档。审议草稿只进 memory/context/deliberation/。
- INDEX.md 硬上限 25KB/200 行；接近上限先合并同类项，把细节移到 semantic/feedback/reference。
- 上下文接近自动压缩阈值时，先把必要的稳定事实和用户纠正写盘；压缩后以本轮磁盘重载内容为准。
`.trim());
    return {appendSystemContext: blocks.filter(Boolean).join('')};
  }

  beforeTool(event, ctx) {
    if (event.toolName !== 'sessions_spawn' || !modeForContext(ctx)) return;
    const params = {...(event.params || {})};
    const state = this.active.get(ctx.sessionKey || '');
    if (state && state.count >= state.limit) {
      return {block: true, blockReason: `极致思考已达到本档总派生上限 ${state.limit}，请立即仲裁并交付现有最优结果。`};
    }
    if (state) state.count += 1;
    // 标准派生：同 agent、同 workspace、同模型、同思考设置。显示名只走 label/taskName。
    delete params.agentId;
    delete params.cwd;
    delete params.model;
    delete params.thinking;
    delete params.resumeSessionId;
    delete params.streamTo;
    params.runtime = 'subagent';
    params.context = 'fork';
    params.mode = 'run';
    params.thread = false;
    return {params};
  }

  spawned(event, ctx) {
    const parent = ctx.requesterSessionKey || '';
    const state = this.active.get(parent);
    if (state && event.childSessionKey) this.active.set(event.childSessionKey, state);
  }

  ended(event) {
    if (event.targetSessionKey) this.active.delete(event.targetSessionKey);
  }

  beforeCompaction(_event, ctx) {
    if (ctx.sessionKey) this.recentCompaction.set(ctx.sessionKey, Date.now());
  }

  afterCompaction(_event, ctx) {
    if (ctx.sessionKey) this.recentCompaction.set(ctx.sessionKey, Date.now());
  }
}

export default {
  id: 'pinkie-mode-architecture',
  name: '超級碧琪四模式运行层',
  register(api) {
    const architecture = new ModeArchitecture();
    api.registerGatewayMethod('pinkie.deepThink.arm', async ({params, respond}) => {
      try {
        const sessionKey = String(params?.sessionKey || '');
        const tier = String(params?.tier || '');
        const armed = architecture.arm(sessionKey, tier);
        const result = await api.session.workflow.enqueueNextTurnInjection({
          sessionKey,
          text: armed.text,
          placement: 'append_context',
          ttlMs: 120_000,
          idempotencyKey: `deep-think-${Date.now()}-${tier}`,
          metadata: {tier, mode: armed.mode},
        });
        respond(true, {armed: result.enqueued, tier, mode: armed.mode});
      } catch (error) {
        respond(false, undefined, {code: 'INVALID_REQUEST', message: error.message});
      }
    }, {scope: 'operator.admin'});
    api.on('before_prompt_build', (event, ctx) => architecture.prompt(event, ctx), {priority: -12000});
    api.on('before_tool_call', (event, ctx) => architecture.beforeTool(event, ctx), {priority: -12000});
    api.on('subagent_spawned', (event, ctx) => architecture.spawned(event, ctx));
    api.on('subagent_ended', event => architecture.ended(event));
    api.on('before_compaction', (event, ctx) => architecture.beforeCompaction(event, ctx));
    api.on('after_compaction', (event, ctx) => architecture.afterCompaction(event, ctx));
  },
};
