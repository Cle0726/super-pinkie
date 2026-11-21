// Work standard rules, completion evidence/receipt helpers, and deliverable inspection logic.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {agentEntries, agentWorkspace, runtimeConfig} from './openclaw-paths.mjs';
import {isChildDelegation, latestChildReport, roleBriefTask} from './session-lineage.mjs';
import {isRolesContext} from './metre-roles.mjs';
import {stripNegatedClaims} from './run-contract.mjs';
import {classifyWorkKind} from './work-kinds.mjs';
import {cleanReplyText} from './reply-hygiene.mjs';
import {getActiveMetreLock} from './metre-lock.mjs';
import {ACTION_CONTINUATION, ACTION_REQUEST, BOOKKEEPING_TOOL, CLE_KK_CONTROL_PATH, CROSS_RUN_EVIDENCE_COPY, DELIVERY_GUARD_TOOL, DIAGNOSTIC_TARGET, ENGLISH_MUTATION_CLAIM, ENGLISH_TEST_CLAIM, EVIDENCE_FILE, HONEST_INCOMPLETE, MUTATING_TOOL, QUESTION_ONLY, READ_ONLY_DIAGNOSTIC_INTENT, REPORTED_MUTATION, RESPONSE_ONLY_FOLLOWUP_ACTION, RESPONSE_ONLY_PREFIX, TIMESTAMP_TAMPERING, WORKFLOW_EVIDENCE_TARGETS, WORK_PRODUCT_CLAIM, intentText, isMutationRequest, startedBackgroundTask} from './mode-constants.mjs';
import {agentFromSessionKey} from './index.mjs';
import {sessionCheckpointRelative} from './watchdog-runtime.mjs';

// 雅叙、营造、堇思、习作四个模式共用的做事标准（挥洒模式不注入）。
// 针对的是所有场景里都会出现的三类毛病：顺着说话、说没有依据的事、草草交差。
export const WORK_STANDARD_RULES = `
做事标准（每个模式、每个任务都适用）：
1. 对错直说，不顺着说。用户的说法、答案或方案有错，第一句就指出错在哪、为什么、正确的是什么；语气可以温和，结论不能含糊。只在真的对时才说「对」或「完全正确」，部分对就说清哪部分对、哪部分错。用户不高兴或坚持时，没有新证据就不改口。
2. 被批评时实事求是。先核对批评是否成立：成立的部分说清具体错在哪、怎么改，然后去改；不成立的部分礼貌地讲明理由。不夸张自责，不附和过头，也不为了平息情绪而全盘认错。
3. 只说有依据的事。事实只来自本轮看过的文件、工具的真实输出、可靠来源或用户给的信息；没看过、没跑过、没查到的，不当成事实写出来。不确定就明说「这是猜测」或「还没核实」，然后能查就去查。不编造文件名、路径、命令结果、链接、数据、版本号、软件功能或引用。
4. 先定好标准再动手。做东西前，先想清楚用户要的成品在什么样子下才算做得好（用途、观众、质量、篇幅或时长、风格），按这个标准做，而不是只求「做出来」。
5. 交付前亲自检查成品。看一遍产物本身：视频用 look-video、网页用 look-page、文档用 look-doc 生成预览图，再用 read 打开看；程序要运行，文字要通读；对照第 4 条的标准，不够好就继续改，不拿半成品交差。复杂和创作类任务值得多花时间、多轮打磨；简单问题直接回答。
6. 卡住先找原因。报错、下载或安装卡住、结果不对时，先查清原因（网络、依赖、权限、参数、版本）再处理；同一个办法失败两次就换思路，不在原地反复等待或重试。
7. 降级要说清楚。如果只能做出比要求差的版本（换了更简陋的做法、缩了范围、少了功能），交付时第一句就说明差距和原因，并给出补救办法，不把降级版说成完成。
8. 做了网页、前端或本地服务，交付前用 app_browser 的 serve 或 open 在 App 侧栏打开，再看一次 snapshot 或截图，确认页面能用。
9. 用户让「打开、看看、播放」网页或视频时，直接用 app_browser 在侧栏打开，让用户看得到；不要只给链接。只需后台抓取资料时用 web_fetch 或 browser，操作其他应用时用 computer。
10. 做出交给用户的成品文件（视频、音频、图片、PDF、演示文稿、文档、表格、压缩包或代码产物）时，最终回复末尾每个文件单独一行写 MEDIA:/绝对路径，最多 6 个。网页用 app_browser 打开，回复附截图并给出网页路径，HTML 文件不要写 MEDIA:（附件通道不支持）。
11. 只附本轮实际完成、检查过的成品，不附中间产物、日志或临时文件；MEDIA: 行不要放进代码块。
12. 本机环境的问题自己解决，不甩给用户。每台电脑的系统、网络和已装软件都不一样：工具报缺命令、缺依赖、没装 Python、连不上、没配 Key、这台电脑不支持某个工具时，先自己查原因、自己装好（装进工作区或用户目录，不用管理员权限）或换一条能走通的路（web_search 不行先用 pinkie_search、再用 browser 打开必应或百度搜，app_browser 或 computer 不可用用 browser 和 exec），做完再交付。不要对用户说「碧琪用不了」「这个功能不支持」「请你去安装」；只有确实需要用户本人提供账号、密码、付款或授权时才请他出手，并说清楚为什么。
13. 记忆找不到时自己再翻。memory_search 没结果或报错，不代表没有记忆：换几个短关键词再搜，或直接用 read 读工作区的 MEMORY.md 和 memory/ 目录、用 exec 按关键词搜这些文件；clekk_memory 里的长期记忆也要看。都翻过仍没有，才说「这件事我这里没有记录」，不说「记忆功能用不了」。
`.trim();

const TOOL_PROGRESS_RULES = `
【工具调用前的进度说明】
- 每次单独调用工具，或开始一组紧密相关的工具调用之前，先用一句简短中文说明接下来要检查、读取或运行什么，以及原因；说清后不要重复。
- 只描述下一步，例如“我先检查消息排序，看看说明文字和工具记录有没有被合并。”不报告尚未发生的结果，不作完成或交付声明，也不把进度句当作最终回复。
- 多次工具调用按实际先后交代必要的下一步；整轮工具结束后，再单独给用户最终答复。
- 计划、自检、规则复述只在内部完成，不写进回复，也不提任何内部规则或检查的名字（例如带【】的规则名）；回复直接从用户需要看到的内容开始。调用工具前仍允许用最多一句话说明要做什么。
`.trim();

// 每次工具调用都是一次完整的模型请求（整段上下文重发一遍）。实测 2026-11-16：一轮 7 次请求对应
// 7 步，其中 5 次 exec 一条一条串行发。像 Claude Code 那样把互不依赖的操作放进同一步，请求次数和等待都少。
export const TOOL_BATCH_RULES = `
【少走几步】每调一次工具就要重新请求一次模型，所以：
- 互不依赖的操作放在同一步里一起调用：要读几个文件、查几个地方、搜几个关键词，一次把这些工具调用全部发出，不要读一个、等结果、再读下一个。
- 几条 shell 命令能合成一条就合成一条（用 && 或 ; 连起来，或写成一个小脚本），一次 exec 跑完；只有后一条要看前一条的结果才分开。
- 一次读够：读文件、看日志时直接读需要的范围，不要每次只看几行再回来翻。
- 只有下一步确实取决于上一步的结果时，才分成先后两步。
`.trim();

// 后台命令结束时由 background-jobs.mjs 发内部消息叫醒碧琪，所以长命令不必挂着干等。
const BACKGROUND_WORK_RULES = `
【长时间命令放后台】
- 预计超过半分钟的命令（构建、渲染、下载、长测试、批量处理）用 exec 的 background: true 放到后台，不要反复 poll、不要 sleep 干等。
- 启动后用一句话告诉用户在跑什么、大概要多久。然后别闲着：先把不依赖这个结果的事做掉——这件活剩下的部分（文案、版式、数据、演示内容）、已经出来的部分先验（抽帧、截图、抽查前几个）、交付说明、检查点。互不依赖的长命令可以同时放后台。
- 等的时候做的事要有用：不推翻已经定下的东西、不为了显得忙去改无关文件、不重复开同一个命令。真的没有不依赖它的事了，才结束这一轮；命令结束时系统会自动叫你继续，那时先读完整输出核对成败，再把等待时做好的部分合进来、补上亲眼验证，然后汇报。
- 后台还没结束的事情不能说成已完成；也不要承诺一个具体时间点会主动汇报。
`.trim();

// Metre 的手册里没有这条运行时事实（后台命令结束会叫醒），压成一句给它；完整版只给老模式。
const METRE_BATCH_LINE = '\n【少走几步】互不依赖的工具调用放同一步一起发；几条命令合成一次 exec。\n';
const METRE_BACKGROUND_LINE = '\n【后台命令】长命令用 exec 的 background: true 放后台，跑完会叫醒你。\n';

// Independent system module shared by all five modes. Keep it separate from
// persona, aesthetics and opinion style so teaching can never dilute the
// execution contract or subtly change a mode's character.
const LEARN_WHILE_DOING_RULES = `
【独立模块：边做边学】
- 首要目标始终是正确、高效、专业地完成当前任务。教学只是辅助：不得降低判断、方案、工具调用、执行效率、代码质量或验收标准，也不得为了好讲而采用更简单但更差的做法。
- 默认边执行边解释，不先倾倒教程。只在遇到可复用、能帮助理解架构/排错/判断方案的重要知识点时，顺手补充当前最值得知道的 1—2 点，然后立即继续工作。
- 解释优先使用“专业术语（英文） = 一句大白话含义”；必要时再用一句说明它在当前项目负责哪一层。第一次引入重要技术，只简述：它是什么、负责什么、专业名称、为什么选它，不自动展开历史、生态或大量替代方案。
- 遇到代码默认讲整体职责、关键逻辑和出问题先查哪一层，不逐行授课；普通实现细节、临时代码和无关背景不主动讲。
- 新知识若与用户以前接触过的概念本质相同，用一句话建立连接，帮助形成跨领域技术直觉。已经解释过的基础概念直接使用术语，只有语境变化时才补一句。
- 教学不得暂停关键工作、频繁考察理解、强行出练习、要求先学再做或把简单任务课程化。若解释会打断执行，先完成并验证，再补极短说明。
- 长期目标是让用户逐渐能听懂行业语言、看懂系统分层、判断方案是否合理并知道故障可能在哪一层；工作保持专家级，表达保持初学者能听懂。
`.trim();

// 习作模式自己的方法模块。它与通用“边做边学”分开，避免把教学规则
// 混进人格或审美；其他模式不会载入这一段。
const LEARNING_MODE_RULES = `
【习作模式方法模块】
- 默认讲解要短、白话、口语化：先一句说结论，再用短句说明；能三句话讲清就不写三段，除非用户明确要求深入展开。
- 先锁定用户真正要解决的问题、已有基础和验收标准；能继续推进时不要把决定退回给用户。
- 根据任务按需选用：苏格拉底提问、双层解释、反向拆解、纵横分析、事实核查、专家会诊、第一性原理、跨领域借解、双向钢人论证、最小实验。
- 解释是执行的伴随物：先做关键动作，再在关键节点补 1—2 个可复用知识点；不把实际工作改写成教程或报告。
- 复杂任务必须把方法落成文件、运行结果、测试或其他可验收产物；模型文字、计划和“应该可以”不算完成。
- 事实、推断、假设和未知分开写；新证据推翻旧判断时直接修正。隐藏天赋与人生设计方法只有在用户主动要求时才启用。
`.trim();

function completionRunKey(event = {}, ctx = {}) {
  // Session key is present on prompt, tool, finalize, and end hooks.  Prefer it
  // over runId so a provider retry cannot split one user turn into unrelated
  // integrity records.
  return String(ctx.sessionKey || event.sessionKey || event.runId || ctx.runId || '');
}

function resultText(value, limit = 12_000) {
  if (typeof value === 'string') return value.slice(0, limit);
  try { return JSON.stringify(value).slice(0, limit); } catch { return String(value || '').slice(0, limit); }
}

function toolResultFailed(event = {}, output = '') {
  if (event.error || event.isError === true) return true;
  const value = event.result && typeof event.result === 'object' ? event.result : {};
  const details = value.details && typeof value.details === 'object' ? value.details : value;
  if (details.isError === true || details.ok === false) return true;
  if (Number.isFinite(Number(details.exitCode)) && Number(details.exitCode) !== 0) return true;
  if (/(?:"status"\s*:\s*"(?:error|failed|blocked|packet_invalid|timeout)"|command exited with code [1-9]|(?:^|\n)\s*traceback\b|(?:^|\n)\s*(?:error|failed|failure)\s*:|timed out)/i.test(output)) return true;
  return false;
}

// A model should not have to remember the name of a host-only tool in order
// for a real verifier run to count.  The result still has to come from the
// locked verifier path and contain strict PASS JSON; this helper only unwraps
// the different result envelopes used by the CLI and embedded transports.
function hasPassVerifierReceipt(value, seen = new Set()) {
  if (value == null) return false;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return false;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && (
        String(parsed.status || '').toUpperCase() === 'PASS' && parsed.verified === true
      )) return true;
      if (parsed && typeof parsed === 'object') return hasPassVerifierReceipt(parsed, seen);
    } catch {}
    // Some host envelopes escape the verifier JSON once more.
    try {
      const unescaped = text.replace(/\\"/g, '"');
      const parsed = JSON.parse(unescaped);
      return Boolean(parsed && typeof parsed === 'object'
        && String(parsed.status || '').toUpperCase() === 'PASS' && parsed.verified === true);
    } catch {}
    return false;
  }
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some(item => hasPassVerifierReceipt(item, seen));
}

function executedLockedVerifier(state, entry = {}) {
  if (!state?.skills?.size || entry.failed || !/(?:^|_)exec(?:$|_)/i.test(String(entry.name || ''))) return false;
  const command = String(entry.params?.command || entry.params?.cmd || '');
  if (!/(?:^|[;&|]\s*)python(?:3|\d*(?:\.\d+)?)?\b/i.test(command)) return false;
  for (const contract of state.skills.values()) {
    if (!contract?.verifier || !command.includes(String(contract.verifier))) continue;
    if (!hasPassVerifierReceipt(entry.output) && !hasPassVerifierReceipt(entry.result)) continue;
    try {
      if (verifierContractReason(contract.skillFile?.path || '', contract)) return false;
    } catch { return false; }
    return true;
  }
  return false;
}

function toolCallKey(event = {}) {
  return String(event.toolCallId || event.tool_call_id || event.callId || event.call_id
    || `${event.runId || ''}:${event.toolName || ''}`);
}

// Built-in file tools return a host-generated structured receipt.  On some
// OpenClaw transports the before/after hook call id is missing or changes, so
// the pre-write snapshot cannot be paired even though the host explicitly
// reports that it changed the file.  Trust only boolean fields on the
// structured result object (never matching model-visible output text), and
// only for the known file mutation tools.
function hostFileMutationReceipt(toolName = '', result = null) {
  if (!/^(?:write|edit|apply_patch|code_edit)$/i.test(String(toolName || ''))
      || !result || typeof result !== 'object') return false;
  const candidates = [
    result,
    result.details,
    result.structuredContent,
    result.structuredContent?.details,
  ].filter(value => value && typeof value === 'object' && !Array.isArray(value));
  if (candidates.some(value => value.changed === true || value.created === true
    || value.modified === true || value.deleted === true || value.applied === true)) return true;
  // OpenClaw 自带工具的成功回执：edit 带非空 diff，write 回「Successfully wrote N bytes」，
  // apply_patch 回「Success. Updated the following files」。
  if (candidates.some(value => typeof value.diff === 'string' && /^[-+]/m.test(value.diff))) return true;
  const text = resultText(result, 2_000);
  return /Successfully (?:wrote [1-9]\d* bytes|replaced [1-9]\d* block)|Success\. Updated the following files/i.test(text);
}

function patchPaths(params = {}) {
  const text = resultText(params, 200_000);
  const paths = [];
  for (const match of text.matchAll(/\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*([^\n]+)|(?:^|[\s"'])((?:\/|[A-Za-z]:[\\/])[^\s"']+)/g)) {
    const value = String(match[1] || match[2] || '').trim();
    if (value) paths.push(value);
  }
  return [...new Set(paths)];
}

// 工具参数里的相对路径（write/edit 的 path: "cle-lab/x.py"）是相对 agent 工作区的。以前这里只收绝对路径，
// 相对路径的写入/修改一律看不见，门禁就误判「执行型修改任务没有主机确认的文件变化」（2026-10-12 实测）。
let agentWorkspaceCache = null;
let agentWorkspaceConfig = null;
function agentWorkspaceDir(ctx = {}) {
  if (typeof ctx.workspaceDir === 'string' && path.isAbsolute(ctx.workspaceDir)) return ctx.workspaceDir;
  try {
    // `--profile` 之后状态目录不一定是 ~/.openclaw，config 也可能已经由插件 API 交过来。
    const config = agentWorkspaceConfig || runtimeConfig(null);
    agentWorkspaceConfig = config;
    if (!agentWorkspaceCache) {
      agentWorkspaceCache = new Map();
      for (const agent of agentEntries(config)) {
        const dir = agentWorkspace(config, agent.id);
        if (dir && path.isAbsolute(dir)) agentWorkspaceCache.set(agent.id, dir);
      }
    }
    const agentId = String(ctx.agentId || agentFromSessionKey(String(ctx.sessionKey || '')) || 'main');
    return agentWorkspaceCache.get(agentId) || agentWorkspace(config, agentId) || '';
  } catch {
    return '';
  }
}

function toolTargetPaths(toolName = '', params = {}, baseDir = '') {
  const name = String(toolName || '').toLowerCase();
  const values = [];
  for (const key of ['path', 'file_path', 'filePath', 'target', 'destination', 'dest', 'outputPath', 'output_path']) {
    const value = params?.[key];
    if (typeof value === 'string' && value.trim()) values.push(value.trim());
  }
  if (name === 'apply_patch' || name.includes('patch')) values.push(...patchPaths(params));
  // A small, conservative extraction for shell commands. It is only used to
  // prove a host-side file effect; unknown commands remain valid tool events.
  if (name === 'exec' || name.endsWith('_exec')) {
    values.push(...execTargetPaths(params, baseDir));
  }
  const resolved = values.map(value => (path.isAbsolute(value) || !baseDir ? value
    : path.resolve(baseDir, value.replace(/^~(?=\/|$)/, os.homedir()))));
  return [...new Set(resolved)].filter(value => path.isAbsolute(value));
}

// exec 命令里会被写到的文件。相对路径按 cwd / 开头的 `cd 目录 &&` / 工作区解析——
// 2026-10-12 实测：`python3 -c "…open('cle-lab/t3-sales/report.html','w')…"` 生成的报告、
// `cat > notes/a.md <<EOF` 写的笔记都只给了相对路径，前后快照里根本没有它们，
// 门禁就判「执行型修改任务没有主机确认的文件变化」。顺序：明确的写文件调用 →
// 重定向/tee/cp/mv/sed -i 等目标 → 其余带引号的路径（调用方只取前若干个做快照）。
const WINDOWS_PATHS = path.sep === '\\';
function execTargetPaths(params = {}, baseDir = '') {
  const command = String(params?.command || params?.cmd || '');
  const cwdParam = String(params?.cwd || params?.workdir || '').replace(/^~(?=\/|$)/, os.homedir());
  let base = cwdParam ? (path.isAbsolute(cwdParam) || !baseDir ? cwdParam : path.resolve(baseDir, cwdParam)) : baseDir;
  const cdPrefix = command.match(/^\s*cd\s+(["']?)([^\s"';&|]+)\1\s*&&/);
  if (cdPrefix && base) base = path.resolve(base, cdPrefix[2].replace(/^~(?=\/|$)/, os.homedir()));
  const out = [];
  if (cwdParam && path.isAbsolute(base || '')) out.push(base);
  const add = (raw) => {
    let value = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
    // 反斜杠在 Mac / Linux 的命令里是转义，带它的多半不是文件名；Windows 的路径却全是反斜杠
    // （C:\Users\…\report.pptx）。原来一律丢掉，Windows 上命令写出的文件门禁一个都看不见，
    // 就误报「执行型修改任务没有主机确认的文件变化」。
    if (!value || value.length > 400 || value.includes('://') || (WINDOWS_PATHS ? /[*?$`{}<>|\n]/ : /[*?$`\\{}<>|\n]/).test(value)) return;
    if (/^(?:\/dev\/|-)/.test(value) || /^&\d?$/.test(value)) return;
    value = value.replace(/^~(?=\/|$)/, os.homedir());
    if (path.isAbsolute(value)) out.push(value);
    else if (base) out.push(path.resolve(base, value));
  };
  for (const match of command.matchAll(/\b(?:open|writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|write_text|write_bytes|to_csv|to_excel|to_json|savefig|save|Path)\(\s*[rRbBfF]?(["'])([^"'\n]+)\1/g)) add(match[2]);
  for (const match of command.matchAll(/(?<![<0-9&>])>>?\s*(["']?)([^\s"'&|;<>()]+)\1/g)) add(match[2]);
  for (const match of command.matchAll(/\b(?:touch|mkdir|rm|mv|cp|tee|chmod|sips|ffmpeg|ln|Out-File|Set-Content|Add-Content|New-Item|Copy-Item|Move-Item|Remove-Item)\b([^\n;&|<>]*)/gi)) {
    for (const token of match[1].trim().split(/\s+/)) if (token && !token.startsWith('-')) add(token);
  }
  for (const match of command.matchAll(/\bsed\s+-i(?:\s*''|\s*"")?\s+(?:'[^'\n]*'|"[^"\n]*"|\S+)\s+([^\n;&|<>]+)/g)) {
    for (const token of match[1].trim().split(/\s+/)) if (token && !token.startsWith('-')) add(token);
  }
  for (const match of command.matchAll(/["'](\/[^"'\n]+)["']/g)) add(match[1]);
  // Windows 的绝对路径，引号里可以有空格（"C:\Users\My Name\out.docx"）。
  if (WINDOWS_PATHS) for (const match of command.matchAll(/["']([A-Za-z]:[\\/][^"'\n]+)["']/g)) add(match[1]);
  for (const match of command.matchAll(/["']((?:~\/|\.{1,2}\/)?[^\s"'\/\n:]+(?:\/[^\s"'\n]+)+|[^\s"'\/\n]+\.[A-Za-z][A-Za-z0-9]{0,7})["']/g)) add(match[1]);
  return out;
}

function snapshotFile(file) {
  const target = String(file || '');
  if (!target || !path.isAbsolute(target)) return {path: target, exists: false};
  try {
    const stat = fs.statSync(target);
    const snapshot = {path: target, exists: true, size: stat.size, mtimeMs: stat.mtimeMs};
    // Hash small files so a same-size edit cannot be mistaken for no effect.
    if (stat.isFile() && stat.size <= 4 * 1024 * 1024) {
      snapshot.hash = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    }
    return snapshot;
  } catch {
    return {path: target, exists: false};
  }
}

function compareSnapshot(before = {}) {
  const after = snapshotFile(before.path);
  const changed = before.exists !== after.exists
    || before.size !== after.size
    || (before.hash && after.hash && before.hash !== after.hash)
    || (!before.hash && before.mtimeMs !== after.mtimeMs);
  return {...after, changed: Boolean(changed)};
}

function compactJson(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, depth < 2 ? 16_000 : 4_000);
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 80).map(item => compactJson(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      if (/(?:cookie|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)/i.test(key)) {
        output[key] = '[redacted]';
      } else output[key] = compactJson(item, depth + 1);
    }
    return output;
  }
  return String(value).slice(0, 4_000);
}

function compactToolEvidence(entry = {}) {
  const params = entry.params && typeof entry.params === 'object' ? entry.params : {};
  const kept = {};
  for (const key of [
    'path', 'file_path', 'filePath', 'target', 'destination', 'dest', 'outputPath', 'output_path',
    'run_dir', 'action', 'kind', 'url', 'targetUrl', 'targetId', 'target_id', 'cwd', 'workdir',
  ]) {
    if (params[key] !== undefined) kept[key] = compactJson(params[key]);
  }
  for (const key of ['command', 'cmd']) {
    if (typeof params[key] === 'string') kept[key] = params[key].slice(0, 16_000);
  }
  // Browser/computer actions often nest the semantic action under request.
  if (params.request && typeof params.request === 'object') kept.request = compactJson(params.request);
  return {
    name: String(entry.name || '').slice(0, 160),
    failed: Boolean(entry.failed),
    output: String(entry.output || '').slice(0, 8_000),
    params: kept,
    effects: compactJson(entry.effects || []),
    at: Number(entry.at) || 0,
  };
}

function fileSha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isPathInside(file, root) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function existingPathInside(file, root) {
  try {
    const rootReal = fs.realpathSync(path.resolve(root));
    const fileReal = fs.realpathSync(path.resolve(file));
    return isPathInside(fileReal, rootReal);
  } catch { return false; }
}

function assertRunOutputPath(file, runDir) {
  const requested = path.resolve(file), root = path.resolve(runDir);
  if (!isPathInside(requested, root)) throw new Error('证据输出必须位于本轮运行目录');
  let ancestor = requested;
  while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
  const realRoot = fs.realpathSync(root), realAncestor = fs.realpathSync(ancestor);
  if ((realAncestor !== realRoot && !isPathInside(realAncestor, realRoot))
      || (fs.existsSync(requested) && fs.lstatSync(requested).isSymbolicLink())) {
    throw new Error('证据输出路径不能通过符号链接离开本轮运行目录');
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function parseIsoMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function probeImageFile(file) {
  const checked = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
    encoding: 'utf8', timeout: 15_000, maxBuffer: 256 * 1024,
  });
  if (checked.status !== 0) throw new Error(`图片无法解码：${file}`);
  const width = Number(/pixelWidth:\s*(\d+)/i.exec(checked.stdout || '')?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/i.exec(checked.stdout || '')?.[1]);
  if (!width || !height || fs.statSync(file).size < 1024) throw new Error(`图片不是有效证据：${file}`);
  return {width, height};
}

function probeVideoFile(file) {
  const checked = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,sample_rate',
    '-of', 'json', file,
  ], {encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024});
  if (checked.status !== 0) throw new Error(`视频无法解析：${file}`);
  let data;
  try { data = JSON.parse(checked.stdout || '{}'); } catch { throw new Error(`视频探测结果无效：${file}`); }
  const video = (data.streams || []).find(stream => stream.codec_type === 'video');
  if (!video || Number(data.format?.duration || 0) < 2) throw new Error(`视频缺少有效画面或时长不足：${file}`);
  return {data, video, audio: (data.streams || []).find(stream => stream.codec_type === 'audio')};
}

function evidenceItems(data = {}, ...keys) {
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}

function evidencePath(item = {}, ...keys) {
  for (const key of keys) if (typeof item?.[key] === 'string' && item[key].trim()) return path.resolve(item[key]);
  return '';
}

function trustedUiEntry(entry = {}) {
  return !entry.failed && /(?:^|_)(?:browser|computer|cua|screen)(?:$|_)/i.test(String(entry.name || ''));
}

function entryText(entry = {}) {
  return `${toolArgumentsText(entry)}\n${String(entry.output || '')}`;
}

function entryMentionsFile(entry = {}, file = '') {
  const resolved = path.resolve(String(file || ''));
  const text = entryText(entry);
  return Boolean(resolved && (text.includes(resolved) || text.includes(path.basename(resolved))));
}

function trustedCapture(active = [], file = '', since = 0) {
  return active.find(entry => entry.at >= since && trustedUiEntry(entry)
    && /(?:screenshot|capture|snapshot|截屏|截图)/i.test(entryText(entry))
    && entryMentionsFile(entry, file));
}

function trustedDoubaoSubmit(entry = {}) {
  const text = entryText(entry);
  if (/(?:SUBMISSION_BLOCKED|NOT_SUBMITTED|BLOCKED|尚未实现|未提交|STAGE_READY|draft_only)/i.test(text)) return false;
  if (trustedUiEntry(entry)) {
    return /(?:doubao|豆包)/i.test(text)
      && /"(?:action|kind)"\s*:\s*"(?:click|press|submit)"/i.test(toolArgumentsText(entry))
      && /(?:SUBMITTED|GENERATING|QUEUED|已提交|生成中|排队中|任务\s*(?:ID|标识))/i.test(text);
  }
  if (!/(?:^|_)exec(?:$|_)/i.test(String(entry.name || ''))) return false;
  const command = String(entry.params?.command || entry.params?.cmd || '');
  return /\/Library\/Mac\/自动化管理\/scripts\/desktop\/doubao_adapter_macos\.py\b/.test(command)
    && /--action\s+submit\b/.test(command)
    && /"status"\s*:\s*"(?:SUBMITTED|GENERATING|QUEUED|SUCCESS)"/i.test(text);
}

function faststartOk(file) {
  try {
    const handle = fs.openSync(file, 'r');
    try {
      const size = Math.min(fs.statSync(file).size, 8 * 1024 * 1024);
      const buffer = Buffer.alloc(size); fs.readSync(handle, buffer, 0, size, 0);
      const moov = buffer.indexOf('moov'), mdat = buffer.indexOf('mdat');
      return moov >= 0 && mdat >= 0 && moov < mdat;
    } finally { fs.closeSync(handle); }
  } catch { return false; }
}

function isLikelyActionRequest(prompt = '') {
  const text = intentText(prompt);
  // A bare “继续” can mean continue an explanation. Integrity retries retain
  // the original action prompt, so this ambiguous one-word message must not
  // be upgraded into a mutation request on its own.
  if (ACTION_CONTINUATION.test(text)) return false;
  // Prompts such as “只回复：连通性测试通过，不要调用工具” are answer-only
  // checks.  Do not let action words inside the requested sentence (测试、完成)
  // arm the delivery gate.  An explicit follow-up action still wins, e.g.
  // “只回复结果，然后运行测试”。
  if (RESPONSE_ONLY_PREFIX.test(text)) {
    const remainder = text.replace(RESPONSE_ONLY_PREFIX, '').trim();
    if (!RESPONSE_ONLY_FOLLOWUP_ACTION.test(remainder)) return false;
  }
  if (!ACTION_REQUEST.test(text)) return false;
  // A pure “why/how” question is answer work, not an implicit permission to
  // mutate files. Explicit action verbs still win when both appear.
  if (QUESTION_ONLY.test(text) && !/(?:帮我|请你|直接|现在就|落地|动手|改成|修复好|执行一下|跑一下)/i.test(text)) return false;
  if (/(?:调用|执行|运行|打开|删除|安装|部署|打包|测试|验证)/i.test(text)) return true;
  if (/(?:skill|技能|工作|任务|项目|文件|文件夹|目录|图片|图像|视频|素材|程序|脚本|代码|应用|\bapp\b|页面|网页|网站|\bui\b|发布|下载)/i.test(text)) return true;
  // 11-04 隔离实测 R-ad：「剪一个 15 秒的竖屏抖音广告……出 MP4 给我」没被认成执行型，交付检查整段跳过。
  if (/(?:\bmp4\b|\bmov\b|\bgif\b|\bpptx?\b|\bxlsx\b|\bexcel\b|\bpdf\b|\bdocx?\b|\bword\b|广告|短片|片子|海报|封面|长图|信息图|幻灯片|演示文稿|表格|字帖|简历|证件照|logo)/i.test(text)) return true;
  if (/(?:帮我|请你|给我|直接|现在就).{0,12}(?:改|修|做|生成|创建|制作|更新|替换|移动|重命名|完成)/i.test(text)) return true;
  return false;
}

// 小应用、表单、图表直接在聊天里交付时，回复里的 ```app / ui / chart / mermaid 代码块
// 本身就是成品，不需要工具记录。只在用户没有要求文件、目录、运行或测试时这样算。
const INLINE_DELIVERABLE = /```(?:app|ui|chart|mermaid)[ \t]*\n[\s\S]{40,}?```/;
const FILE_OR_RUN_REQUEST = /(?:文件|目录|文件夹|路径|保存|存到|存成|写进|写入|工作区|仓库|项目里|\.(?:html?|jsx?|tsx?|py|md|json|css|txt|csv)\b|运行|执行|跑一下|测试|部署|安装|下载|上传|发布)/i;
// 只有按钮 / 方案卡片的 ui 块是在问用户下一步，本身不是成品。
function choiceOnlyUiBlock(body = '') {
  try {
    const value = JSON.parse(body);
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      && (Array.isArray(value.buttons) || Array.isArray(value.cards))
      && !value.fields && !value.checklist;
  } catch {
    return false;
  }
}
// 11-04 隔离实测 routes-l R-ad：交了 MP4、末尾附「满意，直接导出 / 微调文案」三个按钮，
// 这里把按钮当成聊天里交付的成品，亲眼看和素材来源两项交付检查整段跳过。
// 回复交出了文件（MEDIA: 附件，或正文写了成品文件的路径——附件发不出去时运行时会把 MEDIA: 换成
// 「Media failed」，routes-i R-ad-2 就是这样），或这一轮做出了文件、ui 块只是下一步按钮：成品是文件，照常查。
// 开工前用按钮问用户（这一轮还没做出文件）保持原样。
function inlineDeliveryOnly(prompt = '', reply = '', state = null) {
  const text = String(reply || '');
  if (!INLINE_DELIVERABLE.test(text) || FILE_OR_RUN_REQUEST.test(intentText(prompt))) return false;
  if (replyDeliveredKinds(text).length > 0) return false;
  const inline = text.replace(/```ui[ \t]*\n([\s\S]*?)```/g, (block, body) => (choiceOnlyUiBlock(body) ? ' ' : block));
  if (!INLINE_DELIVERABLE.test(inline)
      && (state?.tools || []).some(entry => !entry.failed && producedDeliverables(entry, state.prompt).length > 0)) return false;
  return true;
}

function isReadOnlyDiagnosticRequest(prompt = '') {
  const text = String(prompt || '').trim();
  return Boolean(text && !isMutationRequest(text)
    && READ_ONLY_DIAGNOSTIC_INTENT.test(text)
    && DIAGNOSTIC_TARGET.test(text));
}

// 回复里用 ``` 或 ` 引用的是命令输出、测试结果、代码，不是碧琪对任务状态的陈述。
// 2026-10-12 实测：待办程序的测试输出「未完成排在已完成前面」被当成「承认没做完」，
// 和「全部通过」一起判成自相矛盾。
function proseOnly(value = '') {
  return String(value || '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

// 「被我喊停时仍在运行」「执行停的时候还在写」讲的是当时的状态，不是现在还在跑（11-15 隔离实测 S6 g：
// 全停之后的汇报被判「已完成又仍在生成」，正确的回复后面被追加「还没能确认」）。
// 11-16 隔离实测 S6 h：「所有子会话都是完成状态，没有还在运行的」是否定，也不算还在跑。
const PAST_PROGRESS = /(?:(?:的时候|那时|当时|之前|(?<![同随此暂])时)[“”"'「」『』]?\s*|(?:没有|没|并没有|不再|不是|并非)\s*)(?:仍在|还在|正在)/g;
function withoutPastProgress(value = '') {
  return String(value || '').replace(PAST_PROGRESS, ' ');
}

function actionClaimText(reply = '') {
  return stripNegatedClaims(proseOnly(reply));
}

function hasReportedMutation(reply = '') {
  const text = actionClaimText(reply);
  return REPORTED_MUTATION.test(text) || WORK_PRODUCT_CLAIM.test(text) || ENGLISH_MUTATION_CLAIM.test(text);
}

// 本轮放到后台、还没看到结束的 exec 会话。命令结束时碧琪会被叫醒接着做（background-jobs.mjs），
// 所以「已在后台运行，跑完告诉你」是诚实的进行中状态，不是只预告不做事。
const BACKGROUND_FINISHED_CLAIM = /(?:已经?|全部|都|均)(?:完成|做完|跑完|搞定|结束)|(?<![等待])(?:做完|跑完|搞定|完成)了/;
function backgroundStillRunning(state) {
  const running = new Set();
  for (const entry of state?.tools || []) {
    const name = String(entry?.name || '').toLowerCase();
    const output = String(entry?.output || '');
    const started = /(?:^|_)exec$/.test(name) && !entry.failed && output.match(/Command still running \(session ([\w.-]+),/);
    if (started) running.add(started[1]);
    if (name !== 'process') continue;
    const id = String(entry.params?.sessionId || '');
    if (/Process exited with (?:code|signal)/.test(output) || ['kill', 'remove'].includes(String(entry.params?.action || ''))) running.delete(id);
  }
  return running.size > 0;
}

function isHonestIncomplete(value = '') {
  // A report can explicitly say that an expected failed probe does *not*
  // mean the overall task is incomplete. Do not invert that negation.
  const text = proseOnly(value).replace(
    /(?:不代表|并非|不是|不等于|不能说明|并不意味着).{0,12}(?:任务|整体|本轮)?未完成/gi, '',
  );
  if (!HONEST_INCOMPLETE.test(text)) return false;
  if (/(?:之前|此前|上一轮|刚才|曾经).{0,12}(?:未完成|失败|阻塞)/i.test(text)) return false;
  // “未完成项：无”是在声明全部完成，不能利用“未完成”三个字绕过。
  if (/(?:未完成|阻塞|失败|待处理)(?:项|内容|问题)?\s*[:：]?\s*(?:无|没有|0|零|none)|(?:没有|不存在|并无).{0,8}(?:未完成|阻塞|失败|待处理)/i.test(text)) return false;
  return /(?:(?:本轮|当前|目前|整体|任务|最终|仍然|仍|还).{0,18}(?:未完成|无法完成|执行失败|验收失败|验证未通过|被阻塞)|(?:未完成|无法完成|执行失败|验收失败|验证未通过|被阻塞).{0,40}(?:因为|原因|需要|缺少|验证码|人机验证|登录|权限|网络|额度|平台))/i.test(text);
}

function skillProjectRoot(skillFile) {
  const parts = path.resolve(skillFile).split(path.sep);
  const index = parts.lastIndexOf('skills');
  if (index <= 0) return path.dirname(path.dirname(skillFile));
  return parts.slice(0, index).join(path.sep) || path.sep;
}

function verifierSkillFile(verifier) {
  return path.join(path.dirname(path.dirname(path.resolve(verifier))), 'SKILL.md');
}

function contractTimeBoundary() {
  // Date.now() loses sub-millisecond ordering, and a fixed age allowance
  // rejects legitimate Skills installed immediately before a task. Use the
  // filesystem's own clock before the model can execute its first tool.
  let directory;
  try {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-kk-contract-clock-'));
    const marker = path.join(directory, 'boundary');
    fs.writeFileSync(marker, '', {flag: 'wx', mode: 0o600});
    // NTFS quantizes ctime to a ~100 ns tick, so a file written immediately
    // after this marker can land on the SAME ctime as the marker (measured at
    // ~14% on Windows).  stableContractFile rejects only timestamps strictly
    // AFTER the boundary, so that collision let a verifier overwritten this
    // turn pass as pre-existing -- a real hole, and the flaky source of the
    // `creating or changing a verifier...` test.  Wait past the tick so every
    // subsequent write is guaranteed to be strictly later.  One millisecond is
    // ample and costs nothing next to a real turn.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    const contractCutoffNs = fs.statSync(marker, {bigint: true}).ctimeNs.toString();
    return {startedAt: Date.now(), contractCutoffNs};
  } catch {
    // The older boundary is conservative when the temporary directory is
    // unavailable; it never grants a new contract authority after tool work.
    const startedAt = Date.now();
    return {startedAt, contractCutoffNs: (BigInt(startedAt) * 1_000_000n).toString()};
  } finally {
    if (directory) {
      try { fs.rmSync(directory, {recursive: true, force: true}); } catch {}
    }
  }
}

function stableContractFile(file, state) {
  try {
    const requested = path.resolve(String(file || ''));
    if (!requested) return null;
    const link = fs.lstatSync(requested);
    // A symlink can point outside the Skill project and can be swapped while
    // the model is running. Completion contracts must bind to a real file.
    if (link.isSymbolicLink()) return null;
    const realpath = fs.realpathSync(requested);
    const stat = fs.statSync(realpath, {bigint: true});
    if (!stat.isFile()) return null;
    const threshold = BigInt(state.contractCutoffNs || (BigInt(Math.floor(state.startedAt || 0)) * 1_000_000n));
    // birth/ctime catches a file created during this turn even when its mtime
    // was copied from an older file. mtime also catches in-place edits.
    // Some Linux CI filesystems quantize ctime/birthtime to the same tick for
    // a fixture created immediately before the boundary marker. Equality is
    // therefore not evidence that the model created the contract this turn;
    // only a timestamp strictly after the boundary is rejected. Hashes and
    // full identity snapshots below still detect any later replacement.
    if ([stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs].some(value => value > 0n && value > threshold)) return null;
    return {
      path: requested,
      realpath,
      dev: Number(stat.dev) || 0,
      ino: Number(stat.ino) || 0,
      birthtimeMs: Number(stat.birthtimeMs) || 0,
      ctimeMs: Number(stat.ctimeMs) || 0,
      mtimeMs: Number(stat.mtimeMs) || 0,
      birthtimeNs: stat.birthtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
      mtimeNs: stat.mtimeNs.toString(),
    };
  } catch { return null; }
}

function contractFileChanged(file = {}) {
  try {
    const requested = path.resolve(String(file.path || ''));
    const link = fs.lstatSync(requested);
    if (link.isSymbolicLink()) return true;
    const realpath = fs.realpathSync(requested);
    const stat = fs.statSync(realpath, {bigint: true});
    return realpath !== String(file.realpath || realpath)
      || !stat.isFile()
      || (Number(file.dev) > 0 && Number(stat.dev) !== Number(file.dev))
      || (Number(file.ino) > 0 && Number(stat.ino) !== Number(file.ino))
      || Number(stat.birthtimeMs) !== Number(file.birthtimeMs)
      || Number(stat.ctimeMs) !== Number(file.ctimeMs)
      || Number(stat.mtimeMs) !== Number(file.mtimeMs)
      || (file.birthtimeNs && stat.birthtimeNs.toString() !== file.birthtimeNs)
      || (file.ctimeNs && stat.ctimeNs.toString() !== file.ctimeNs)
      || (file.mtimeNs && stat.mtimeNs.toString() !== file.mtimeNs);
  } catch { return true; }
}

function registerVerifier(state, skillFile, verifier) {
  const resolvedSkill = path.resolve(skillFile);
  // Reading a modified contract again must never bless the new contents.
  if (state.skills.has(resolvedSkill)) return true;
  if (state.missingVerifiers.has(resolvedSkill)) return false;
  const skill = stableContractFile(skillFile, state);
  const verifierFile = stableContractFile(verifier, state);
  if (!skill || !verifierFile) return false;
  const skillHash = createHash('sha256').update(fs.readFileSync(skillFile)).digest('hex');
  const verifierHash = createHash('sha256').update(fs.readFileSync(verifier)).digest('hex');
  const dependencies = [];
  const pipelineValidator = path.join(path.dirname(skillFile), 'scripts', 'pipeline_state.py');
  if (fs.existsSync(pipelineValidator)) {
    const dependency = stableContractFile(pipelineValidator, state);
    if (!dependency) return false;
    dependencies.push({...dependency, hash: fileSha256(pipelineValidator)});
  }
  state.skills.set(path.resolve(skillFile), {
    verifier: path.resolve(verifier),
    skillFile: skill,
    verifierFile,
    skillHash,
    verifierHash,
    dependencies,
  });
  return true;
}

function skillHasVerifier(skillFile) {
  try { return fs.existsSync(path.join(path.dirname(String(skillFile)), 'tools', 'verify_completion.py')); } catch { return false; }
}

function missingVerifierReason(state) {
  const missing = [...(state.contractSkills || [])].filter(skillFile => state.missingVerifiers.has(skillFile) || !state.skills.has(skillFile));
  return missing.length ? `已读取的 Skill 没有独立 verify_completion.py，不能由执行模型自行验收完成：${missing.join('、')}` : '';
}

function verifierContractReason(skillFile, contract = {}) {
  try {
    if (!contract.skillFile || !contract.verifierFile || contractFileChanged(contract.skillFile)
        || contractFileChanged(contract.verifierFile)) return `本轮真实性契约文件被替换或修改：${skillFile}`;
    if (fileSha256(skillFile) !== contract.skillHash) return `本轮读取后又修改了 Skill 契约：${skillFile}`;
    if (fileSha256(contract.verifier) !== contract.verifierHash) return `本轮修改了真实性校验器：${contract.verifier}`;
    const dependencies = Array.isArray(contract.dependencies) ? contract.dependencies : [];
    if (/douyin-ai-video-workflow/i.test(skillFile)
        && !dependencies.some(item => /[\\/]scripts[\\/]pipeline_state\.py$/i.test(String(item?.path || '')))) {
      return '视频工作流的全阶段验证器没有被锁定在本轮契约中';
    }
    for (const item of dependencies) {
      if (!item?.path || contractFileChanged(item) || fileSha256(item.path) !== item.hash) return `本轮修改了真实性校验依赖：${item?.path || 'unknown'}`;
    }
  } catch {
    return `真实性校验器或其依赖在本轮消失或不可读：${contract.verifier || skillFile}`;
  }
  return '';
}

function toolArgumentsText(entry = {}) {
  try { return JSON.stringify(entry.params || {}); } catch { return String(entry.params || ''); }
}

function toolEffectKind(entry = {}) {
  if (!entry || entry.failed) return '';
  const name = String(entry.name || '').toLowerCase();
  if (BOOKKEEPING_TOOL.test(name)) return '';
  const args = toolArgumentsText(entry);
  if (Array.isArray(entry.effects) && entry.effects.some(effect => effect.changed)) return 'host-file-change';
  // “工具返回成功”不等于文件真的变化。write/edit/apply_patch 只有前后
  // 快照发生变化才算实际效果，防止空写工具加一次假 read 绕过。
  if (/^(?:write|edit|apply_patch)$/i.test(name)) return '';
  if (MUTATING_TOOL.test(name) || name === 'pinkie_model_capability') return 'host-tool';
  // 网页 GPT 出图 / 出视频、视频生成：文件是工具自己落盘的，成功返回就是一次真实产出
  // （11-17 网页 GPT 实测：图已出、ls/file 也查过，回复后面还是被挂上「还没核实」）。
  if (/^(?:video_generate|videogen)$/.test(name)
      || name === 'web_gpt' && /"action"\s*:\s*"(?:image|video)"/i.test(args)) return 'produced-media';
  if (/(?:browser|computer|screen|cua)/i.test(name)
      && /"(?:action|kind)"\s*:\s*"(?:click|type|fill|upload_file|press|drag|navigate|open|close)"/i.test(args)) {
    return 'ui-action';
  }
  if (/(?:send|publish|upload|download|install|deploy|create|delete|update|move)/i.test(name)) return 'external-action';
  if (/(?:^|_)exec(?:$|_)/i.test(name)) {
    const command = String(entry.params?.command || entry.params?.cmd || '');
    if (/(?:^|[;&|]\s*)(?:git\s+(?:push|commit)|npm\s+(?:install|publish)|pnpm\s+(?:install|publish)|pip\s+install|brew\s+install|openclaw\s+(?:skills\s+(?:install|update|remove|publish|sync)|gateway\s+(?:restart|stop))|clawhub\s+(?:skill\s+publish|sync)|open\s|osascript\s|mkdir\s|rm\s|mv\s|cp\s|chmod\s|ffmpeg\s|codesign\s|xcodebuild\s|docker\s+(?:build|push)|(?:python\d*|node)\s+[\s\S]*(?:write|create|generate|download|publish))/i.test(command)) {
      return 'executed-action';
    }
  }
  return '';
}

function toolIsMechanicalCheck(entry = {}) {
  if (!entry || entry.failed) return false;
  const name = String(entry.name || '').toLowerCase();
  const args = toolArgumentsText(entry);
  if (name === DELIVERY_GUARD_TOOL) return /"action"\s*:\s*"verify"/i.test(args)
    || hasPassVerifierReceipt(entry.output);
  if (name === 'pinkie_model_capability') return true;
  if (/^(?:read|view_image|open_file|inspect|validate|verify|test|check)(?:$|_)/i.test(name)) return true;
  if (/(?:browser|computer|screen|cua)/i.test(name)
      && /"(?:action|kind)"\s*:\s*"(?:snapshot|screenshot|status|inspect|find|open|navigate|check_permissions|get_(?:desktop|window)_state|get_screen_size|get_accessibility_tree)"/i.test(args)) return true;
  if (/(?:^|_)exec(?:$|_)/i.test(name)) {
    const command = String(entry.params?.command || entry.params?.cmd || '');
    // PowerShell/cmd readbacks are checks too. A pipeline that also writes is
    // not an independent check, even when it starts with Get-Content or type.
    const windowsCheck = /(?:^|[;&|("'\s])(?:Get-Content|Get-Item|Get-ChildItem|Test-Path|Select-String|Compare-Object|Measure-Object|Get-FileHash|findstr|type|dir|fc)(?:\s|$)/i.test(command);
    const windowsWrite = /\b(?:Set-Content|Add-Content|Out-File|Copy-Item|Move-Item|Remove-Item|New-Item|Rename-Item|Clear-Content)\b|(?:^|[^<])>{1,2}(?!&)/i.test(command);
    if (windowsCheck && !windowsWrite) return true;
    if (/verify_completion\.py\b/i.test(command)) return true;
    if (/(?:^|[;&|(]\s*)(?:look-(?:video|page|doc)\b|markitdown\b|pdftotext\b|pdfinfo\b|tesseract\b|magick\s+identify\b|test\s|\[\s*!?\s*-[efdsrcwx]\s+|pytest\b|python\s+-m\s+(?:pytest|unittest)|npm\s+(?:test|run\s+(?:test|lint|build))|pnpm\s+(?:test|run\s+(?:test|lint|build))|node\s+--check|tsc\b|eslint\b|ruff\b|mypy\b|cargo\s+(?:test|check)|go\s+test|swift\s+test|xcodebuild\b|ffprobe\b|file\s|stat\s|ls\s|find\s|rg\s|git\s+(?:diff|status)|codesign\s+--verify|openclaw\s+(?:gateway\s+status|status|doctor|skills\s+(?:list|check)))/i.test(command)) return true;
    // 实测里常见、却被漏判的核对方式：python3 -m unittest、直接跑测试文件、node --test、golden/check
    // 脚本、curl 测接口、cat/diff/cmp/wc/grep 读回结果、lsof/ps 看端口和进程（2026-10-12 长任务测试）。
    if (/(?:^|[;&|(]\s*)(?:python\d*(?:\.\d+)?\s+(?:-\w+\s+)*(?:-m\s+(?:pytest|unittest|doctest|py_compile|json\.tool)\b|\S*(?:^|[\/_-])tests?(?:[\/_.-]\S*)?\.py\b|\S*_test\.py\b)|node\s+(?:--test\b|\S*(?:test|spec)\S*\.[cm]?js\b)|npx\s+(?:jest|vitest|mocha|tsc|eslint)\b|(?:bun|deno)\s+test\b|make\s+(?:test|check)\b|(?:\.\/|(?:ba|z)?sh\s+)\S*(?:test|golden|check|verify|smoke)\S*\.sh\b|curl\s|wget\s|cat\s|head\s|tail\s|wc\s|diff\s|cmp\s|grep\s|egrep\s|jq\s|sqlite3\s|unzip\s+-l|zipinfo\s|tar\s+-?t|shasum\s|md5\s|lsof\s|nc\s+-z|ps\s|pgrep\s|plutil\s+-p|xmllint\s|sed\s+-n\s)/i.test(command)) return true;
    // 只读的 python -c 校验（json.load、读文件、断言）；带写文件 / 删除的不算。
    return /(?:^|[;&|(]\s*)python\d*(?:\.\d+)?\s+-c\s/i.test(command)
      && !/(?:open\([^)]*['"][wax]|\.write\(|unlink|remove|rmtree|rename|shutil\.(?:copy|move))/i.test(command);
  }
  return false;
}

// 收尾清理：只是 `rm` 掉本轮自己用 write 建的文件（测试文件、临时文件）。它前面那次真正的改动
// 若已核验过，就不该再因为「删完没复查」把整份最终回复退回去（2026-10-12 实测：读→改→复读→删
// 测试文件，最终回复被判未核验）。删除任何本轮之前就存在的东西仍然要求复查。
function cleanupTargets(entry = {}) {
  if (!/(?:^|_)exec(?:$|_)/i.test(String(entry.name || ''))) return null;
  const command = String(entry.params?.command || entry.params?.cmd || '').trim();
  const match = /^rm\s+((?:-[a-zA-Z]+\s+)*)([^;&|<>`$(){}*?\n]+)$/.exec(command);
  if (!match) return null;
  const targets = match[2].trim().split(/\s+/).map(item => item.replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return targets.length ? targets : null;
}

function isTurnCleanup(state, index) {
  const targets = cleanupTargets(state.tools[index]);
  if (!targets) return false;
  const earlier = state.tools.slice(0, index).filter(entry => entry && !entry.failed);
  const written = new Set();
  for (const entry of earlier) {
    if (String(entry.name || '').toLowerCase() !== 'write') continue;
    const target = String(entry.params?.path || entry.params?.file_path || entry.params?.filePath || '');
    if (target) written.add(path.basename(target));
  }
  // 也算本轮用命令建出来的临时文件：> / >> 重定向、heredoc、touch、tee、cp 目标、-o 输出。
  const createdByCommand = (name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:>>?|\\btouch\\b[^\\n;&|]*|\\btee\\b[^\\n;&|]*|\\bcp\\b[^\\n;&|]*|\\s-o\\s*|--output[=\\s])\\s*['"]?[^\\s'";&|]*${escaped}(?![\\w.-])`);
    return earlier.some(entry => /(?:^|_)exec(?:$|_)/i.test(String(entry.name || ''))
      && pattern.test(String(entry.params?.command || entry.params?.cmd || '')));
  };
  return targets.every(target => {
    const name = path.basename(target);
    return written.has(name) || createdByCommand(name);
  });
}


// Work-first changes are limited to the four ordinary parent sessions.
function workFirstContext(ctx = {}) {
  if (getActiveMetreLock()?.isLockedSession?.(ctx.sessionKey)) return false;
  return /^agent:(?:main|project|thinking|learning|metre):/.test(String(ctx.sessionKey || ''))
    && !/:(?:subagent|internal-session-effects|cron|heartbeat):/.test(String(ctx.sessionKey || ''));
}
function workFirstTextTask(prompt = '') {
  const text = intentText(prompt);
  if (FILE_OR_RUN_REQUEST.test(text) || /(?:调用|skill|技能|发布|发到|发送到|发给|上传|安装|启动|图片|图像|海报|视频|音频|网页|页面|网站|程序|脚本|代码|应用|工具|头像|头图|图标|招牌|门头|logo)/i.test(text)) return false;
  if (/(?:起.{0,4}名字|想.{0,8}(?:名字|名称|标题)|取.{0,4}名|写(?:一段|段|一份|份|个)?(?:话|文案|祝福|简介|介绍|文章|故事|邮件|总结|计划)|润色|改写|翻译)/.test(text)) return true;
  // 「做个小红书文案」「出几个活动点子」这类只交文字的活：交付就是回复本身（档位升级 2026-11-02）。
  const kinds = classifyWorkKind(text).kinds;
  return kinds.length > 0 && kinds.every(id => id === 'writing' || id === 'ideas');
}
function workFirstProgressNote(entry = {}, ctx = {}) {
  const name = String(entry.name || '').toLowerCase();
  if (/^(?:plan_update|update_plan|todo_write|todowrite)$/.test(name)) return true;
  if (!/^(?:write|edit|apply_patch)$/.test(name)) return false;
  const params = entry.params || {};
  const target = String(params.path || params.file_path || params.filePath || '');
  const relative = sessionCheckpointRelative(ctx.sessionKey || '').replace(/\\/g, '/');
  return Boolean(ctx.sessionKey && target.replace(/\\/g, '/').endsWith('/' + relative));
}
function workFirstBackgroundResult(prompt = '') {
  return /^A background task completed\. Use this result to reply to the user in your normal assistant voice\.[\s\S]*\n\s*source:\s*(?:image_generation|video_generation)\b/.test(String(prompt || ''));
}
function waitingForGeneratedMedia(event = {}) {
  const messages = Array.isArray(event.messages) ? event.messages : [];
  const last = messages.at(-1)?.message || messages.at(-1);
  return startedBackgroundTask(last);
}
function workFirstReplyText(text, ctx = {}) {
  const clean = cleanReplyText(text);
  if (!workFirstContext(ctx)) return clean;
  // Local HTML is opened in the browser; the media transport rejects it.
  // Retain the path so the deliverable remains available.
  return clean.replace(/^[ \t]*MEDIA:[ \t]*((?:\/|~\/|[A-Za-z]:[\\/])[^\r\n]*?\.html?)[ \t]*$/gim, '$1');
}

function claimedVerification(reply = '') {
  const text = proseOnly(reply).replace(/(?:尚未|没有|还没|没能|无法|未曾|未).{0,6}(?:测试|验证|核对|检查|读回|复查|截图|预览)/g, '');
  const check = /(?:(?:已|已经|成功|做过|完成).{0,12}(?:测试|验证|核对|检查|读回|复查|截图|预览)|(?:测试|验证|核对|检查|读回|复查|截图|预览).{0,12}(?:通过|完成|成功|过))/i.test(text);
  const test = /(?:(?:测试|单测|用例).{0,10}(?:通过|成功|完成|跑过|过了)|(?:跑|运行).{0,8}(?:测试|单测|用例).{0,8}(?:通过|成功|完成|过))/i.test(text)
    || ENGLISH_TEST_CLAIM.test(text);
  return {check: check || test, test};
}

function claimedVisualInspection(reply = '') {
  const text = proseOnly(reply).replace(/(?:尚未|没有|还没|没能|无法|未曾|未).{0,6}(?:截图|预览|看过|亲眼看)/g, '');
  return /(?:(?:已|已经|亲自|亲眼).{0,12}(?:截图|预览|看过|打开.{0,6}看)|(?:截图|预览|打开成品).{0,12}(?:看过|检查过|核对过))/i.test(text);
}

function toolIsTestCheck(entry = {}) {
  if (!entry || entry.failed) return false;
  const name = String(entry.name || '').toLowerCase();
  if (/^(?:test|run_tests|run_test|unit_test)$/.test(name)) return true;
  if (!/(?:^|_)exec(?:$|_)/.test(name)) return false;
  const command = String(entry.params?.command || entry.params?.cmd || '');
  return /\b(?:pytest|vitest|jest|mocha|Invoke-Pester)\b|\b(?:python\d*(?:\.\d+)?\s+-m\s+(?:pytest|unittest)|node\s+--test|(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+test)|(?:go|cargo|dotnet|mvn|gradle)\s+test)\b/i.test(command);
}

// 这块要改的活交给了子会话：这一轮真的开出了子会话，或者这一轮是子会话交回「做成了」的汇报叫醒的。
// 改动和验证由子会话那边的门禁把关，父会话这一轮没有自己的文件变化不算谎报。
// 汇报是「没做成」时不算：父会话不能把没做成转述成做成了。父会话这一轮自己动了文件，照常检查那些改动。
function delegatedWork(state) {
  if (state.tools.some(isChildDelegation)) return true;
  if (!state.sessionReport) return false;
  const report = latestChildReport(state.sessionReport);
  return Boolean(report && !report.failed);
}

function deliveryTaskPrompt(prompt, ctx, key = '') {
  return isRolesContext({agentId: ctx.agentId, sessionKey: ctx.sessionKey || key}) ? roleBriefTask(prompt) : prompt;
}

function effectVerificationReason(state, ctx = {}, reply = '') {
  const prompt = deliveryTaskPrompt(state.prompt, ctx);
  const mutationRun = (isLikelyActionRequest(prompt) && isMutationRequest(prompt))
    || (workFirstContext(ctx) && hasReportedMutation(reply));
  if (!mutationRun) return '';
  const effectIndex = state.tools.findLastIndex((entry, index) => Boolean(toolEffectKind(entry)) && !isTurnCleanup(state, index)
    && !(workFirstContext(ctx) && workFirstProgressNote(entry, ctx)));
  if (effectIndex < 0) return delegatedWork(state) ? '' : '执行型修改任务没有主机确认的文件变化或外部操作结果';
  const effect = state.tools[effectIndex];
  const claimed = workFirstContext(ctx) ? claimedVerification(reply) : {check: true, test: false};
  if (!claimed.check) return '';
  const satisfies = claimed.test ? toolIsTestCheck : toolIsMechanicalCheck;
  // A tool returning "ok" only proves that the call ended.  It does not prove
  // that a remote send/publish/upload reached the requested state, so external
  // actions need the same independent follow-up inspection as local changes.
  if (state.tools.slice(effectIndex + 1).some(satisfies)) return '';
  // A single build/test command can both produce and verify its artifact.
  if (satisfies(effect)) return '';
  return `最后一次实际改动（${effect.name}）之后没有读取、测试或检查真实结果`;
}

// ---------- 两道「提醒一次」的门禁：看过成品再交付、说了要做就去做 ----------
// 交付物：做出来要给用户看的成品。
const DELIVERABLE_EXT = /\.(mp4|mov|m4v|webm|gif|png|jpe?g|webp|svg|pdf|pptx?|key|docx?|xlsx|html?)(?=$|[\s"'`)\],;:|])/i;
const DELIVERABLE_KIND = {
  mp4: '视频', mov: '视频', m4v: '视频', webm: '视频', gif: '动图', png: '图片', jpg: '图片', jpeg: '图片',
  webp: '图片', svg: '图片', pdf: '文档', ppt: '演示文稿', pptx: '演示文稿', key: '演示文稿', doc: '文档',
  docx: '文档', xlsx: '表格', html: '网页', htm: '网页',
};
const DOCUMENT_KINDS = new Set(['文档', '演示文稿', '表格']);
const PAGE_TASK = /网页|网站|页面|落地页|主页|官网|海报|界面|landing|website|web\s*page/i;
const PRODUCING_COMMAND = /\b(?:ffmpeg|remotion|render|magick|convert|montage|marp|mmdc|manim|blender|python\d*|node|npx|sips|qlmanage|rsvg-convert|pdftoppm|curl|wget|yt-dlp)\b/i;
const LOOK_HELPER = /\blook-(?:video|page|doc)\b/;
const LOOKABLE_IMAGE = /\.(?:png|jpe?g|webp|gif)$/i;
const DOCUMENT_TEXT_CHECK = /\b(?:look-doc|markitdown|pdftotext|pdftoppm)\b|(?:python\d*)[^\n]*(?:pptx|docx|openpyxl|pypdf|Presentation\(|Document\()/i;

function toolParamPaths(entry = {}) {
  const params = entry.params && typeof entry.params === 'object' ? entry.params : {};
  return ['path', 'file_path', 'filePath', 'image', 'target', 'destination', 'outputPath', 'output_path']
    .map(key => params[key]).filter(value => typeof value === 'string' && value);
}

function producedDeliverables(entry = {}, prompt = '') {
  if (!entry || entry.failed) return [];
  const name = String(entry.name || '').toLowerCase();
  const command = String(entry.params?.command || entry.params?.cmd || '');
  if (LOOK_HELPER.test(command)) return [];
  const candidates = [];
  for (const effect of Array.isArray(entry.effects) ? entry.effects : []) {
    if (effect?.changed && effect.exists !== false) candidates.push(String(effect.path || ''));
  }
  if (/^(?:write|edit|apply_patch)$/.test(name)) candidates.push(...toolParamPaths(entry));
  if (/(?:^|_)exec(?:$|_)/.test(name) && PRODUCING_COMMAND.test(command)) candidates.push(...command.split(/\s+/));
  const kinds = new Set();
  for (const raw of candidates) {
    // 命令里的网址（核对链接、下载地址）不是本轮做出来的文件：t5 调研里一段 urllib 核对链接的脚本
    // 含 https://…/index.html，曾被误判成「做出了网页却没预览」（2026-10-12）。
    const candidate = String(raw || '').replace(/^[\s'"(\[]+|[\s'"),;\]]+$/g, '');
    if (!candidate || /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) || candidate.includes('://')) continue;
    if (/[\\/]node_modules[\\/]/.test(candidate)) continue;
    const match = DELIVERABLE_EXT.exec(candidate);
    if (!match) continue;
    const kind = DELIVERABLE_KIND[match[1].toLowerCase()];
    if (kind === '网页' && !PAGE_TASK.test(prompt)) continue;
    kinds.add(kind);
  }
  return [...kinds];
}

function looksAtContent(entry = {}) {
  if (!entry || entry.failed) return false;
  const name = String(entry.name || '').toLowerCase();
  if (/^(?:read|view_image|image|open_file)$/.test(name)) return toolParamPaths(entry).some(value => LOOKABLE_IMAGE.test(value));
  return /(?:browser|computer|screen|cua)/.test(name)
    && /"(?:action|kind)"\s*:\s*"(?:screenshot|snapshot)"/i.test(toolArgumentsText(entry));
}

function contentInspectionReason(state) {
  let last = -1;
  const kinds = new Set();
  state.tools.forEach((entry, index) => {
    const produced = producedDeliverables(entry, state.prompt);
    if (!produced.length) return;
    last = index;
    produced.forEach(kind => kinds.add(kind));
  });
  if (last < 0) return '';
  const after = state.tools.slice(last + 1);
  if (after.some(looksAtContent)) return '';
  const documentsOnly = [...kinds].every(kind => DOCUMENT_KINDS.has(kind));
  if (documentsOnly && after.some(entry => !entry.failed
      && DOCUMENT_TEXT_CHECK.test(String(entry.params?.command || entry.params?.cmd || '')))) return '';
  return `本轮做出了${[...kinds].join('、')}，但做完之后没有亲自看过成品内容（只查文件在不在、时长或大小不算）。`
    + '用 look-video、look-page 或 look-doc 生成预览图，再用 read 打开看一遍，对照用户的要求，不满意就改好再交付';
}

// 视频里的画面、配音、音乐是碧琪生成或下载来的，交付时要说清从哪来、能不能商用（motion-and-video.md 第 117 行）。
// 11-04 隔离实测 R-ad 三轮都漏：手册写了、等待清单也写了，交付那一刻没有东西提醒。
// 不靠猜它用了哪个工具做素材（routes-e：生图在上一轮、配音是 Python 里调 say、背景音乐是 cp 来的，一条都没认出来）：
// 交了视频、回复没说来源，除非用户这句话明确是拿他自己的素材来剪，就提醒一次。
const ASSET_MAKING_TOOL = /^(?:image_generate|video_generate|music_generate|tts|speech|text_to_speech)$/i;
const ASSET_MAKING_COMMAND = /(?:\bedge-tts\b|\bsay\s+-v\b|['"]say['"]\s*,\s*['"]-v|\bpiper\b|wavfile\.write|\baevalsrc\b|\banoisesrc\b|\bsine=|(?:\bcurl\b|\bwget\b)[^\n]*\.(?:mp3|wav|m4a|aac|jpe?g|png|webp|mp4|mov)\b)/i;
const USER_SUPPLIED_MEDIA = /(?:这(?:个|段|些|条|几个?)(?:视频|片子|素材|照片|图片|录像|音频|录音|镜头)|我(?:拍|录|剪)的|我的(?:视频|素材|照片|录像|录音)|附件|上传的|发给你的|\.(?:mp4|mov|m4v|avi|mkv|mp3|wav|m4a|jpe?g|png|heic)\b)/i;
// 要同时说出从哪来、能不能商用。routes-f 只写了「有实拍随时发我替换」就被放过了：那不是交代来源。
const SOURCE_ORIGIN = /(?:来源|出处|来自|取自|生成|合成|AI|图库|曲库|素材库|(?:先生|你|您)(?:给|提供|发来)的|程序画|代码画|自己画|TTS|edge-tts|\bsay\b|晓晓|云希|婷婷|Xiaoxiao|Yunxi|Tingting)/i;
const SOURCE_RIGHTS = /(?:可(?:以)?商用|不(?:能|可)商用|商用|版权|授权|免费可用|开源许可)/;

// 回复里用 MEDIA: 交出去的文件。11-04 routes-i R-ad：成片是后台 Python 脚本里调 ffmpeg 写出来的，
// 工具记录里一个 .mp4 都没有（exec 只有 python3 render.py），只看工具就认不出交了视频。
// 附件发不出去时运行时把 MEDIA: 换成「Media failed」（routes-i R-ad-2），正文里写出的成品绝对路径一样算交付。
const REPLY_FILE_PATH = /(?:^|[\s`'"(（：:])((?:\/|~\/|[A-Za-z]:\\)[^\s`'"]*\.(?:mp4|mov|m4v|webm|gif|png|jpe?g|webp|svg|pdf|pptx?|key|docx?|xlsx))(?=$|[\s`'"),，。；;:：\]])/gim;
function replyDeliveredKinds(reply = '') {
  const kinds = new Set();
  const text = String(reply || '');
  const paths = [...text.matchAll(/^\s*MEDIA:\s*(\S+)/gim)].map(match => match[1])
    .concat([...text.replace(/```[\s\S]*?(?:```|$)/g, ' ').matchAll(REPLY_FILE_PATH)].map(match => match[1]));
  for (const file of paths) {
    const ext = DELIVERABLE_EXT.exec(file.replace(/[\s'"),;\]]+$/, ''));
    if (ext && DELIVERABLE_KIND[ext[1].toLowerCase()]) kinds.add(DELIVERABLE_KIND[ext[1].toLowerCase()]);
  }
  return [...kinds];
}

// 提醒里附上工具记录能证实的来路。11-04 routes-m R-ad：画面和配乐是 Python urllib 从图库下的，
// 只收到「说清从哪来」的提醒，它凭印象写成了「产品样图为 AI 生成、配乐为无版权合成」。
const DOWNLOAD_CALL = /(?:\bcurl\b|\bwget\b|urlretrieve|urlopen|requests\.get|httpx\.get|\bfetch\(|aria2c|yt-dlp)/i;
function assetProvenance(state) {
  const hosts = new Set();
  const voices = new Set();
  for (const entry of state.tools || []) {
    if (entry.failed) continue;
    const text = [entry.params?.command, entry.params?.cmd, entry.params?.content].filter(Boolean).join('\n');
    if (!text) continue;
    if (DOWNLOAD_CALL.test(text)) {
      for (const match of text.matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=[/:'"\s?]|$)/gi)) {
        const host = match[1].toLowerCase();
        if (!/^(?:localhost|127\.|0\.0\.0\.0)/.test(host)) hosts.add(host);
      }
    }
    if (/\bedge-tts\b/.test(text)) voices.add('edge-tts');
    if (/\bsay\s+-v\b|['"]say['"]\s*,\s*['"]-v/.test(text)) voices.add('macOS 自带的 say');
    if (/\bpiper\b/.test(text)) voices.add('piper');
  }
  const facts = [];
  if (hosts.size) facts.push(`从 ${[...hosts].slice(0, 4).join('、')} 下载过素材`);
  if (voices.size) facts.push(`配音用 ${[...voices].join('、')} 在本机合成`);
  return facts.length ? `工具记录里能看到：${facts.join('；')}。照这些如实写，没生成成功的不要写成 AI 生成` : '';
}

function sourceDisclosureReason(state, reply = '') {
  if (!state.tools.some(entry => producedDeliverables(entry, state.prompt).includes('视频'))
      && !replyDeliveredKinds(reply).includes('视频')) return '';
  const prose = proseOnly(reply);
  if (SOURCE_ORIGIN.test(prose) && SOURCE_RIGHTS.test(prose)) return '';
  const madeAssets = state.tools.some(entry => !entry.failed && (ASSET_MAKING_TOOL.test(String(entry.name || ''))
    || ASSET_MAKING_COMMAND.test(String(entry.params?.command || entry.params?.cmd || ''))));
  if (!madeAssets && USER_SUPPLIED_MEDIA.test(String(state.prompt || ''))) return '';
  const facts = assetProvenance(state);
  return `交付的视频没说清素材从哪来：补一句配音、音乐、画面各自是生成的、用户给的还是图库 / 曲库下载的，能不能商用；画面是生成的或图库里的普通产品，就直说「换成你们店的实拍再发」${facts ? `。${facts}` : ''}`;
}

// 回复最后说「这就去做」却就此结束：预告不等于做了。
const PROMISE_TAIL = /(?:这就(?:去|开始|动手|做|弄|安排)|马上(?:去|开始|动手|处理|做|弄|安排)|现在就(?:去|开始|动手)|稍等(?:一下|片刻|一会儿?)?|请稍候|接下来(?:碧琪|我)?(?:会|就|先|来|去|马上)|(?:碧琪|我)(?:先|这就|马上|立刻|立即)(?:去|来|开始|动手)|等(?:碧琪|我)(?:一下|一会儿?|做完|弄好))/;
const PROMISE_BLOCKER = /(?:需要|请|等|麻烦)(?:先生|老板)|(?:先生|老板)(?:确认|决定|选|同意|提供|告诉|回复)|无法|不能|没法|做不到|卡在|卡住|阻塞|失败|报错|权限|缺少|额度|网络/;

// 回复只是「准备向用户汇报 / 下面汇报」就结束：汇报本身没有给出来（2026-10-12 t4：做完重构、测试全过，
// 最终回复却只有一句「碧琪准备向用户汇报。」）。
// 11-04 隔离实测 R-infographic：图做好了，最后一句是「现在进行正式回复。」就结束了。
const REPORT_ANNOUNCE_TAIL = /(?:准备|这就|马上|现在|下面|接下来|即将|开始)(?:就)?(?:向|给|跟)?(?:先生|老板|您)?(?:做个?|进行|开始|来)?(?:正式|最终的?|最后的?)?(?:汇报|报告|总结|说明结果|交付结果|交付|回复|答复|回答)[。.!！~～]*$/;

export function promiseWithoutActionReason(reply = '') {
  const text = String(reply || '').trim();
  const tail = text.slice(-140);
  if (tail && text.length <= 200 && REPORT_ANNOUNCE_TAIL.test(tail) && !/[？?]/.test(tail)) {
    return '回复最后只说准备汇报，这一轮就结束了，用户并没有看到汇报。直接给出完整的最终汇报：结果是什么、怎么验证的、还有什么没做或要注意';
  }
  if (!tail || !PROMISE_TAIL.test(tail) || /[？?]/.test(tail) || PROMISE_BLOCKER.test(tail)) return '';
  return '回复最后说要去做，但这一轮就此结束了，事情并没有做。不要只预告，直接调用工具把它做完，做完再回复';
}

function evidenceTamperingReason(state) {
  for (const entry of state.tools) {
    const args = toolArgumentsText(entry);
    if (TIMESTAMP_TAMPERING.test(args)) return '检测到修改文件时间戳的命令，不能把旧产物伪装成本轮新增成果';
    if (CROSS_RUN_EVIDENCE_COPY.test(args)) return '检测到跨运行目录复制旧图片、视频或证据，不能冒充本轮真实产出';
    if (EVIDENCE_FILE.test(args)) {
      if (/^(?:write|edit|apply_patch)$/i.test(entry.name)) {
        return '发布、提交、QC 或状态证据由通用写文件工具直接生成，缺少对应真实动作';
      }
      if (/\b(?:python\d*\s+-c|node\s+-e)\b/i.test(args)
          && /(?:write_text|json\.dump|open\s*\([^)]*[wa]['"]|copy(?:2|file)?\s*\()/i.test(args)) {
        return '发布、提交、QC 或状态证据由临时脚本手写或复制，不能作为独立验收证据';
      }
    }
  }
  return '';
}

function toolPolicyViolation(toolName = '', params = {}) {
  let args;
  try { args = JSON.stringify(params || {}); } catch { args = String(params || ''); }
  if (CLE_KK_CONTROL_PATH.test(args)) {
    return '执行控制面、档位状态和审计记录仅由宿主运行层维护，模型不能读取或修改';
  }
  if (/document\.cookie|localStorage\.(?:getItem|setItem)\s*\([^)]*(?:token|auth|session)|(?:authorization|cookie)\s*[:=]/i.test(args)) {
    return '禁止读取或导出登录 Cookie、令牌和会话凭据；浏览器应直接复用现有登录态';
  }
  if (TIMESTAMP_TAMPERING.test(args)) {
    return '禁止修改文件时间戳来伪装本轮新产物';
  }
  if (CROSS_RUN_EVIDENCE_COPY.test(args)) {
    return '禁止跨运行目录复制旧图片、视频或验收证据';
  }
  if (EVIDENCE_FILE.test(args)) {
    if (/^(?:write|edit|apply_patch)$/i.test(String(toolName))) {
      return '提交、发布、QC 和状态证据必须由对应专用执行器产生，不能直接手写';
    }
    if (/\b(?:python\d*\s+-c|node\s+-e)\b/i.test(args)
        && /(?:write_text|json\.dump|open\s*\([^)]*[wa]['"]|copy(?:2|file)?\s*\()/i.test(args)) {
      return '临时脚本不能手写或复制提交、发布、QC 和状态证据';
    }
    if (/(?:^|[\s;&|])(?:echo|printf|tee)\b|(?:^|[^<])>{1,2}\s*[^&]/i.test(args)) {
      return 'Shell 重定向不能手写提交、发布、QC 和状态证据';
    }
  }
  return '';
}

function workflowRunDir(entry = {}) {
  // Prefer the raw command. JSON.stringify escapes quoted paths (\"...\"),
  // which previously made a perfectly valid --run-dir "path with spaces"
  // invisible to the guard and left the record tool unusable.
  const raw = entry?.params?.command || entry?.params?.cmd || '';
  const args = String(raw || toolArgumentsText(entry));
  const match = /--run-dir\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))/i.exec(args);
  return match ? path.resolve(match[1] || match[2] || match[3]) : '';
}

function workflowExpectedCounts(initEntry = {}) {
  const runDir = workflowRunDir(initEntry);
  if (!runDir) return {};
  try {
    const value = JSON.parse(fs.readFileSync(path.join(runDir, 'reports', 'production_spec.json'), 'utf8'));
    return {
      images: Number.isInteger(value.shot_count) ? value.shot_count : undefined,
      videos: Number.isInteger(value.generation_unit_count) ? value.generation_unit_count : undefined,
    };
  } catch {
    return {};
  }
}

function douyinWorkflowReason(state) {
  const enabled = [...state.loadedSkills].some(value => /[\\/]douyin-ai-video-workflow[\\/]SKILL\.md$/i.test(value));
  if (!enabled) return '';
  const initIndex = state.tools.findIndex(entry => /pipeline_state\.py[\s\S]*\binit\b/i.test(toolArgumentsText(entry)));
  if (initIndex < 0) return '视频工作流没有在本轮初始化独立 RUN_ID';
  const active = state.tools.slice(initIndex + 1).filter(entry => !entry.failed);
  const generatedStoryboards = active.filter(entry => {
    if (!/(?:image_generate|imagegen)/i.test(entry.name)) return false;
    return !/"action"\s*:\s*"(?:list|status|inspect)"/i.test(toolArgumentsText(entry));
  });
  const browserStoryboardRequests = active.filter(entry => {
    const args = toolArgumentsText(entry);
    return /browser/i.test(entry.name)
      && /"(?:action|kind)"\s*:\s*"(?:type|fill)"/i.test(args)
      && /chatgpt\.com/i.test(args + entry.output);
  });
  const webGptStoryboards = active.filter(entry => entry.name === 'web_gpt' && /"action"\s*:\s*"image"/.test(toolArgumentsText(entry)));
  const imageRequestCount = generatedStoryboards.length + browserStoryboardRequests.length + webGptStoryboards.length;
  if (imageRequestCount === 0) return '本轮没有真实提交新的分镜生成请求；查看旧图或 image_generate list 不算生成';

  const submittedVideos = active.filter(entry => {
    const combined = toolArgumentsText(entry) + '\n' + entry.output;
    if (!/(?:doubao|豆包)/i.test(combined)) return false;
    if (/(?:SUBMISSION_BLOCKED|NOT_SUBMITTED|BLOCKED|尚未实现|未提交)/i.test(combined)) return false;
    return /(?:--action\s+submit|"action"\s*:\s*"submit"|点击.{0,12}(?:生成|发送)|提交.{0,12}(?:成功|accepted|submitted))/i.test(combined);
  });
  if (submittedVideos.length === 0) return '本轮没有豆包/视频模型的真实提交成功记录';

  const expected = workflowExpectedCounts(state.tools[initIndex]);
  if (expected.images && imageRequestCount < expected.images) {
    return `分镜计划需要 ${expected.images} 次真实生成提交，本轮工具记录只有 ${imageRequestCount} 次`;
  }
  if (expected.videos && submittedVideos.length < expected.videos) {
    return `视频计划需要 ${expected.videos} 次真实模型提交，本轮工具记录只有 ${submittedVideos.length} 次`;
  }

  const published = active.some(entry => {
    const args = toolArgumentsText(entry);
    const combined = args + '\n' + entry.output;
    return /browser/i.test(entry.name)
      && /xiaohongshu\.com|xhslink\.com/i.test(combined)
      && /"(?:action|kind)"\s*:\s*"(?:click|type|fill|upload_file)"/i.test(args);
  });
  const reopenedPublicPage = active.some(entry => {
    const combined = toolArgumentsText(entry) + '\n' + entry.output;
    return /xiaohongshu\.com\/(?:explore|discovery\/item)\/|xhslink\.com\//i.test(combined)
      && /(?:snapshot|open|navigate)/i.test(combined);
  });
  if (!published || !reopenedPublicPage) return '本轮没有真实发布操作以及随后重新打开公开作品页的工具证据';
  for (const [kind, relative] of Object.entries(WORKFLOW_EVIDENCE_TARGETS)) {
    const record = state.authorityRecords?.get(kind);
    if (!record) return `缺少由成果核验工具生成的受控证据：${relative}`;
    try {
      if (fileSha256(record.path) !== record.sha256) return `受控证据写入后又被修改：${relative}`;
    } catch {
      return `受控证据已丢失或不可读：${relative}`;
    }
  }
  return '';
}

function verificationFailure(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '校验器没有返回结果';
  try {
    const parsed = JSON.parse(trimmed);
    const issues = Array.isArray(parsed.issues) ? parsed.issues.filter(Boolean) : [];
    if (issues.length) return issues.join('；');
    return parsed.message || parsed.status || trimmed.slice(0, 800);
  } catch {
    return trimmed.slice(0, 800);
  }
}

export {
  TOOL_PROGRESS_RULES,
  BACKGROUND_WORK_RULES,
  METRE_BATCH_LINE,
  METRE_BACKGROUND_LINE,
  LEARN_WHILE_DOING_RULES,
  LEARNING_MODE_RULES,
  completionRunKey,
  resultText,
  toolResultFailed,
  hasPassVerifierReceipt,
  executedLockedVerifier,
  toolCallKey,
  hostFileMutationReceipt,
  patchPaths,
  agentWorkspaceCache,
  agentWorkspaceConfig,
  agentWorkspaceDir,
  toolTargetPaths,
  WINDOWS_PATHS,
  execTargetPaths,
  snapshotFile,
  compareSnapshot,
  compactJson,
  compactToolEvidence,
  fileSha256,
  isPathInside,
  existingPathInside,
  assertRunOutputPath,
  writeJsonAtomic,
  parseIsoMs,
  probeImageFile,
  probeVideoFile,
  evidenceItems,
  evidencePath,
  trustedUiEntry,
  entryText,
  entryMentionsFile,
  trustedCapture,
  trustedDoubaoSubmit,
  faststartOk,
  isLikelyActionRequest,
  INLINE_DELIVERABLE,
  FILE_OR_RUN_REQUEST,
  choiceOnlyUiBlock,
  inlineDeliveryOnly,
  isReadOnlyDiagnosticRequest,
  proseOnly,
  PAST_PROGRESS,
  withoutPastProgress,
  actionClaimText,
  hasReportedMutation,
  BACKGROUND_FINISHED_CLAIM,
  backgroundStillRunning,
  isHonestIncomplete,
  skillProjectRoot,
  verifierSkillFile,
  contractTimeBoundary,
  stableContractFile,
  contractFileChanged,
  registerVerifier,
  skillHasVerifier,
  missingVerifierReason,
  verifierContractReason,
  toolArgumentsText,
  toolEffectKind,
  toolIsMechanicalCheck,
  cleanupTargets,
  isTurnCleanup,
  workFirstContext,
  workFirstTextTask,
  workFirstProgressNote,
  workFirstBackgroundResult,
  waitingForGeneratedMedia,
  workFirstReplyText,
  claimedVerification,
  claimedVisualInspection,
  toolIsTestCheck,
  delegatedWork,
  deliveryTaskPrompt,
  effectVerificationReason,
  DELIVERABLE_EXT,
  DELIVERABLE_KIND,
  DOCUMENT_KINDS,
  PAGE_TASK,
  PRODUCING_COMMAND,
  LOOK_HELPER,
  LOOKABLE_IMAGE,
  DOCUMENT_TEXT_CHECK,
  toolParamPaths,
  producedDeliverables,
  looksAtContent,
  contentInspectionReason,
  ASSET_MAKING_TOOL,
  ASSET_MAKING_COMMAND,
  USER_SUPPLIED_MEDIA,
  SOURCE_ORIGIN,
  SOURCE_RIGHTS,
  REPLY_FILE_PATH,
  replyDeliveredKinds,
  DOWNLOAD_CALL,
  assetProvenance,
  sourceDisclosureReason,
  PROMISE_TAIL,
  PROMISE_BLOCKER,
  REPORT_ANNOUNCE_TAIL,
  evidenceTamperingReason,
  toolPolicyViolation,
  workflowRunDir,
  workflowExpectedCounts,
  douyinWorkflowReason,
  verificationFailure,
};
