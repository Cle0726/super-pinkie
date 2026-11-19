#!/usr/bin/env node
// 检查角色卡（personas/metre/roles/*.md）：
// 1. PLAN.md 第 3.1 节的元数据格式、必填项、取值范围、正文三节结构、字数（300..1200）、禁词。
// 2. PLAN.md 第 3.1 节与 R1-2 的「不抄手册」检查：正文里任何连续 40 个字以上，不得原样出现在 reads/skills 引用的文件或工作区手册里。
// 3. PLAN.md 第四节角色清单表（33 张官方卡）的 id、name、group、when、tier、vision、tools、review、deny_commands 与 R3-9 只读角色无 write 检查。
//
// 用法：
//   node tools/metre/roles/lint-cards.mjs                         # 检查 personas/metre/roles/ 下所有现有 .md 卡
//   node tools/metre/roles/lint-cards.mjs --all-33                # 同时要求 33 张官方卡全部齐全
//   node tools/metre/roles/lint-cards.mjs <card.md> [card2.md...] # 检查指定卡文件（支持验收人临时构造的坏卡）
//   node tools/metre/roles/lint-cards.mjs --json                  # 输出 JSON

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const DEFAULT_ROLES_DIR = path.join(REPO_ROOT, 'personas/metre/roles');

export const ALLOWED_GROUPS = new Set(['coding', 'execution', 'research', 'content', 'gate']);
export const ALLOWED_TIERS = new Set(['light', 'mid', 'top']);
export const ALLOWED_TOOLS = new Set(['read', 'write', 'exec', 'net', 'browser', 'media']);
export const ALLOWED_KEYS = new Set([
  'id', 'name', 'group', 'when', 'tier', 'vision', 'tools',
  'deny_commands', 'reads', 'skills', 'review',
]);
export const REQUIRED_KEYS = ['id', 'name', 'group', 'when', 'tier', 'tools'];

export const READONLY_ROLE_IDS = new Set([
  'researcher', 'domain-expert', 'advisor', 'competitor-analyst',
  'code-reviewer', 'security-auditor', 'reviewer', 'fact-checker',
  'qa-tester', 'web-operator',
]);

export const PLANTED_ISSUE_ROLE_IDS = new Set([
  'code-reviewer', 'security-auditor', 'reviewer', 'fact-checker', 'qa-tester',
]);
export const DEFAULT_SAMPLES_DIR = path.join(REPO_ROOT, 'tools/metre/roles/samples');

// PLAN.md 第四节：33 张官方角色卡规格表
export const ROLE_SPECS = Object.freeze({
  // 编码（coding）9 张
  'feature-dev': {
    name: '功能开发', group: 'coding',
    when: '在已有项目里加一个说清楚的功能',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec', 'net'],
  },
  'frontend-fix': {
    name: '前端修 bug', group: 'coding',
    when: '页面显示不对、点了没反应、控制台报错',
    tier: 'mid', vision: true, tools: ['read', 'write', 'exec', 'browser', 'net'],
  },
  'backend-fix': {
    name: '后端修 bug', group: 'coding',
    when: '接口报错、数据不对、服务起不来、脚本跑挂',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec', 'net'],
    deny_commands: ['git push', 'npm publish'],
  },
  'test-engineer': {
    name: '测试工程师', group: 'coding',
    when: '给代码补测试、把 bug 变成测试',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec'],
  },
  'code-reviewer': {
    name: '代码审查', group: 'coding',
    when: '交付前检查一份改动',
    tier: 'mid', vision: false, tools: ['read', 'exec'],
  },
  'refactor': {
    name: '重构整理', group: 'coding',
    when: '不改行为，只整理结构',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec'],
  },
  'perf-tuner': {
    name: '性能优化', group: 'coding',
    when: '慢、卡、内存高',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec'],
  },
  'security-auditor': {
    name: '安全检查', group: 'coding',
    when: '上线前查漏洞和泄露',
    tier: 'mid', vision: false, tools: ['read', 'exec', 'net'],
  },
  'upgrader': {
    name: '升级迁移', group: 'coding',
    when: '升依赖、换版本、迁框架',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec', 'net'],
  },

  // 执行（execution）6 张
  'plan-executor': {
    name: '计划执行', group: 'execution',
    when: '按一份写好的计划一步步做',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec', 'net'],
  },
  'batch-runner': {
    name: '批量处理', group: 'execution',
    when: '同一个操作做在一长串对象上',
    tier: 'light', vision: false, tools: ['read', 'write', 'exec'],
  },
  'env-setup': {
    name: '环境搭建', group: 'execution',
    when: '装工具、配环境',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec', 'net'],
  },
  'automation-builder': {
    name: '自动化脚本', group: 'execution',
    when: '定时任务、监控文件夹、批量脚本',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec', 'net'],
  },
  'release-prep': {
    name: '发布准备', group: 'execution',
    when: '打包、发版前检查、写更新说明',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec', 'net'],
    deny_commands: ['git push', 'npm publish', 'gh release'],
  },
  'web-operator': {
    name: '网页操作', group: 'execution',
    when: '在网页上查东西、填表、截图',
    tier: 'mid', vision: true, tools: ['read', 'browser', 'net'],
  },

  // 研究和分析（research）6 张
  'researcher': {
    name: '调研员', group: 'research',
    when: '查资料、收集信息',
    tier: 'light', vision: false, tools: ['read', 'net'],
  },
  'deep-reader': {
    name: '资料精读', group: 'research',
    when: '一大堆文件要读完提炼',
    tier: 'light', vision: false, tools: ['read', 'write'],
  },
  'domain-expert': {
    name: '领域专家', group: 'research',
    when: '某个专业领域的问题（领域写在简报里）',
    tier: 'top', vision: false, tools: ['read', 'net'],
  },
  'advisor': {
    name: '方案顾问', group: 'research',
    when: '几条路选哪条',
    tier: 'mid', vision: false, tools: ['read', 'net'],
  },
  'data-analyst': {
    name: '数据分析师', group: 'research',
    when: '表格、数据、报表',
    tier: 'mid', vision: false, tools: ['read', 'write', 'exec'],
  },
  'competitor-analyst': {
    name: '竞品分析', group: 'research',
    when: '看同类产品怎么做',
    tier: 'light', vision: true, tools: ['read', 'net', 'browser'],
  },

  // 设计和内容（content）9 张
  'visual-designer': {
    name: '视觉设计师', group: 'content',
    when: '定视觉方向、海报、封面、logo',
    tier: 'mid', vision: true, tools: ['read', 'write', 'exec', 'browser', 'media'],
  },
  'ui-replicator': {
    name: '界面还原', group: 'content',
    when: '照参考图或设计稿做页面',
    tier: 'mid', vision: true, tools: ['read', 'write', 'exec', 'browser'],
  },
  'viral-creator': {
    name: '网络爆款师', group: 'content',
    when: '小红书、抖音、B 站、公众号的爆款内容',
    tier: 'mid', vision: false, tools: ['read', 'write', 'net'],
  },
  'writer': {
    name: '写作师', group: 'content',
    when: '文章、讲稿、报告、长文',
    tier: 'mid', vision: false, tools: ['read', 'write', 'net'],
  },
  'editor': {
    name: '编辑校对', group: 'content',
    when: '改错字、改病句、统一用词',
    tier: 'light', vision: false, tools: ['read', 'write'],
  },
  'translator': {
    name: '翻译', group: 'content',
    when: '翻译和本地化',
    tier: 'mid', vision: false, tools: ['read', 'write', 'net'],
  },
  'doc-maker': {
    name: '文档和幻灯片', group: 'content',
    when: 'PPT、Word、PDF',
    tier: 'mid', vision: true, tools: ['read', 'write', 'exec'],
  },
  'motion-video': {
    name: '视频动效师', group: 'content',
    when: '用代码做视频和动画',
    tier: 'mid', vision: true, tools: ['read', 'write', 'exec', 'media'],
  },
  'modeler-3d': {
    name: '3D 建模师', group: 'content',
    when: '3D 模型、场景、产品展示',
    tier: 'mid', vision: true, tools: ['read', 'write', 'exec'],
  },

  // 把关（gate）3 张
  'reviewer': {
    name: '挑刺验收员', group: 'gate',
    when: '别人交回的成果，由另一家模型复核',
    tier: 'mid', vision: true, tools: ['read', 'exec', 'browser'],
    review: 'cross-vendor',
  },
  'fact-checker': {
    name: '事实核查', group: 'gate',
    when: '一篇稿子里的事实要核',
    tier: 'mid', vision: false, tools: ['read', 'net'],
    review: 'cross-vendor',
  },
  'qa-tester': {
    name: '体验测试员', group: 'gate',
    when: '像用户一样把网页、App、小游戏用一遍',
    tier: 'mid', vision: true, tools: ['read', 'exec', 'browser'],
  },
});

const FORBIDDEN_PERSONA_WORDS = ['碧琪', '先生', '老板', '导员'];
const FORBIDDEN_VAGUE_PHRASES = ['注意质量', '认真细致', '精益求精', '写得好', '质量高'];

export function parseFrontmatterAndBody(rawText) {
  const errors = [];
  if (rawText.includes('\r\n')) {
    errors.push('文件包含 CRLF (\\r\\n) 换行符，仓库要求 LF 换行');
  }
  const text = rawText.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    return {meta: null, body: '', errors: [...errors, '开头缺少 --- 元数据分隔行']};
  }
  const endIdx = text.indexOf('\n---\n', 4);
  if (endIdx === -1) {
    return {meta: null, body: '', errors: [...errors, '缺少结束的 --- 元数据分隔行']};
  }
  const fmBlock = text.slice(4, endIdx);
  const body = text.slice(endIdx + 5);
  const meta = {};
  const arrayKeys = new Set(['tools', 'deny_commands', 'reads', 'skills']);
  const scalarKeys = new Set(['id', 'name', 'group', 'when', 'tier', 'vision', 'review']);

  const lines = fmBlock.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      errors.push(`元数据第 ${i + 2} 行不允许空行`);
      continue;
    }
    const m = /^([a-z_]+):\s*(.+)$/.exec(line);
    if (!m) {
      errors.push(`元数据第 ${i + 2} 行格式非法（只能是 "key: 值" 或 "key: [a, b]"）：${line}`);
      continue;
    }
    const [, key, rawVal] = m;
    if (!ALLOWED_KEYS.has(key)) {
      errors.push(`元数据含未知字段：${key}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      errors.push(`元数据字段重复：${key}`);
      continue;
    }
    const val = rawVal.trim();
    if (arrayKeys.has(key)) {
      if (!val.startsWith('[') || !val.endsWith(']')) {
        errors.push(`字段 ${key} 必须是 [a, b] 列表格式：${val}`);
        continue;
      }
      const inner = val.slice(1, -1).trim();
      const items = inner ? inner.split(',').map(s => s.trim()) : [];
      if (items.some(it => !it || it.startsWith('"') || it.startsWith("'"))) {
        errors.push(`字段 ${key} 列表项不能为空或带引号：${val}`);
        continue;
      }
      meta[key] = items;
    } else if (scalarKeys.has(key)) {
      if (val.startsWith('[') || val.startsWith('"') || val.startsWith("'")) {
        errors.push(`字段 ${key} 必须是单值字符串（不加引号）：${val}`);
        continue;
      }
      meta[key] = val;
    }
  }
  return {meta, body, errors};
}

export function isSafeRelativeWorkspacePath(relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  if (relPath.startsWith('/') || relPath.startsWith('\\') || /^[a-zA-Z]:/.test(relPath)) return false;
  if (relPath.includes('\\')) return false;
  const parts = relPath.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) return false;
  return true;
}

export function resolveReadFile(relPath, {repoRoot = REPO_ROOT, workspaceRoot = ''} = {}) {
  if (!isSafeRelativeWorkspacePath(relPath)) return '';
  const candidates = [
    workspaceRoot && path.join(workspaceRoot, relPath),
    path.join(repoRoot, 'personas/project', relPath),
    path.join(repoRoot, 'personas/thinking', relPath),
    path.join(repoRoot, 'personas/metre', relPath),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {}
  }
  return '';
}

export function resolveSkillMd(skillName, {repoRoot = REPO_ROOT, workspaceRoot = ''} = {}) {
  if (!skillName || /[/\\]|\.\./.test(skillName)) return '';
  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), '.openclaw');
  const managedDir = process.env.PINKIE_MANAGED_SKILLS_DIR || '';
  const roots = [
    workspaceRoot && path.join(workspaceRoot, 'skills'),
    path.join(repoRoot, 'skills'),
    path.join(stateDir, 'skills'),
    path.join(stateDir, 'pinkie-skills'),
    managedDir,
  ].filter(Boolean);
  for (const r of roots) {
    const f = path.join(r, skillName, 'SKILL.md');
    try {
      if (fs.statSync(f).isFile()) return f;
    } catch {}
  }
  return '';
}

function collectAllWorkspaceManuals(repoRoot = REPO_ROOT) {
  const manuals = new Map();
  const dirs = [
    {dir: path.join(repoRoot, 'personas/project/playbooks'), prefix: 'playbooks/'},
    {dir: path.join(repoRoot, 'personas/thinking/refs'), prefix: 'refs/'},
  ];
  for (const {dir, prefix} of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.md')) continue;
      const full = path.join(dir, entry);
      try {
        if (fs.statSync(full).isFile()) {
          manuals.set(`${prefix}${entry}`, fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n'));
        }
      } catch {}
    }
  }
  return manuals;
}

// 检查正文是否有连续 minLen（默认 40）个字以上原样出现在目标文本中。
// 同时检查：
// 1. 原文直接匹配（去除换行符差异后连续 40 字）
// 2. 折叠空白后的连续 40 字匹配
export function findCopiedSubstring(bodyText, refText, minLen = 40) {
  const cleanBody = bodyText.replace(/\r\n/g, '\n').trim();
  const cleanRef = refText.replace(/\r\n/g, '\n');

  const variants = [
    {b: cleanBody, r: cleanRef},
    {b: cleanBody.replace(/\s+/g, ' '), r: cleanRef.replace(/\s+/g, ' ')},
    {b: cleanBody.replace(/\s+/g, ''), r: cleanRef.replace(/\s+/g, '')},
  ];

  for (const {b, r} of variants) {
    const bChars = [...b];
    if (bChars.length < minLen || r.length < minLen) continue;
    for (let i = 0; i <= bChars.length - minLen; i++) {
      const slice = bChars.slice(i, i + minLen).join('');
      if (r.includes(slice)) {
        return slice;
      }
    }
  }
  return null;
}

export function validateBodyStructure(body) {
  const errors = [];
  const trimmed = body.trim();
  const charCount = [...trimmed].length;
  const codeUnitCount = trimmed.length;
  if (charCount < 300 || codeUnitCount < 300) {
    errors.push(`正文字数不足 300 字（当前 ${charCount} 字）`);
  }
  if (charCount > 1200 || codeUnitCount > 1200) {
    errors.push(`正文字数超过 1200 字（当前 ${codeUnitCount} 字）`);
  }

  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(trimmed)) !== null) {
    headings.push({level: match[1].length, title: match[2].trim(), raw: match[0], index: match.index});
  }
  const expectedHeadings = ['做法', '边界', '交回'];
  if (
    headings.length !== 3 ||
    headings.some((h, idx) => h.level !== 2 || h.title !== expectedHeadings[idx])
  ) {
    errors.push(
      `正文必须且只能依次包含 "## 做法"、"## 边界"、"## 交回" 三节（当前标题：${headings.map(h => h.raw).join(' / ') || '无'}）`,
    );
  } else {
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].index + headings[i].raw.length;
      const end = i + 1 < headings.length ? headings[i + 1].index : trimmed.length;
      const sectionContent = trimmed.slice(start, end).trim();
      if (!sectionContent) {
        errors.push(`"## ${headings[i].title}" 小节内容不能为空`);
      }
    }
  }

  for (const word of FORBIDDEN_PERSONA_WORDS) {
    if (trimmed.includes(word)) {
      errors.push(`正文不得出现人设或禁用词「${word}」`);
    }
  }
  for (const phrase of FORBIDDEN_VAGUE_PHRASES) {
    if (trimmed.includes(phrase)) {
      errors.push(`正文不得出现无法检查的空话「${phrase}」`);
    }
  }
  return {errors, charCount: codeUnitCount};
}

export function lintCardFile(filePath, {
  repoRoot = REPO_ROOT,
  workspaceRoot = '',
  checkTableSpec = true,
  checkAllManualsForCopy = true,
} = {}) {
  const absPath = path.resolve(filePath);
  const fileNameId = path.basename(absPath, '.md');
  let rawText;
  try {
    rawText = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    return {file: absPath, id: fileNameId, ok: false, errors: [`无法读取文件：${err.message}`], warnings: []};
  }

  const {meta, body, errors: parseErrors} = parseFrontmatterAndBody(rawText);
  const errors = [...parseErrors];
  const warnings = [];
  if (!meta) {
    return {file: absPath, id: fileNameId, ok: false, errors, warnings};
  }

  for (const reqKey of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(meta, reqKey)) {
      errors.push(`缺少必填字段：${reqKey}`);
    }
  }

  if (meta.id !== undefined) {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(meta.id)) {
      errors.push(`id 不符合 ^[a-z][a-z0-9-]{1,31}$：${meta.id}`);
    }
    if (meta.id !== fileNameId) {
      errors.push(`id (${meta.id}) 与文件名 (${fileNameId}.md) 不一致`);
    }
  }

  if (meta.name !== undefined) {
    const nameLen = [...meta.name].length;
    if (!meta.name || nameLen > 8 || !/[\u4e00-\u9fff]/.test(meta.name)) {
      errors.push(`name 必须含中文且不超过 8 个字（当前 ${nameLen} 字：${meta.name}）`);
    }
    if (meta.name.includes('导员')) {
      errors.push(`name 不得为导员或辅导类角色：${meta.name}`);
    }
  }

  if (meta.group !== undefined && !ALLOWED_GROUPS.has(meta.group)) {
    errors.push(`group 取值非法：${meta.group}（允许：${[...ALLOWED_GROUPS].join('/')}）`);
  }

  if (meta.when !== undefined) {
    const whenLen = [...meta.when].length;
    if (!meta.when || whenLen > 30) {
      errors.push(`when 不能为空且不超过 30 个字（当前 ${whenLen} 字：${meta.when}）`);
    }
  }

  if (meta.tier !== undefined && !ALLOWED_TIERS.has(meta.tier)) {
    errors.push(`tier 取值非法：${meta.tier}（允许：light/mid/top）`);
  }

  if (meta.vision !== undefined && meta.vision !== 'true' && meta.vision !== 'false') {
    errors.push(`vision 只能是 true 或 false：${meta.vision}`);
  }

  if (Array.isArray(meta.tools)) {
    if (meta.tools.length === 0) {
      errors.push('tools 不能为空列表');
    }
    const seen = new Set();
    for (const t of meta.tools) {
      if (!ALLOWED_TOOLS.has(t)) {
        errors.push(`tools 含表外工具类别：${t}`);
      }
      if (seen.has(t)) {
        errors.push(`tools 含重复项：${t}`);
      }
      seen.add(t);
    }
  }

  if (meta.review !== undefined && meta.review !== 'cross-vendor') {
    errors.push(`review 只能是 cross-vendor：${meta.review}`);
  }

  // 检查 reads 路径合法性与引用文件存在性
  const referencedFiles = new Map();
  if (Array.isArray(meta.reads)) {
    for (const rel of meta.reads) {
      if (!isSafeRelativeWorkspacePath(rel)) {
        errors.push(`reads 路径非法（禁止 .. 或绝对路径）：${rel}`);
        continue;
      }
      const resolved = resolveReadFile(rel, {repoRoot, workspaceRoot});
      if (!resolved) {
        errors.push(`reads 引用的文件在角色工作区中不存在：${rel}`);
      } else {
        referencedFiles.set(rel, fs.readFileSync(resolved, 'utf8'));
      }
    }
  }

  // 检查 skills（PLAN 3.3：找不到的技能记提示，卡照样能用；找得到的纳入不抄检查）
  if (Array.isArray(meta.skills)) {
    for (const sk of meta.skills) {
      if (!sk || /[/\\]|\.\./.test(sk)) {
        errors.push(`skills 名称非法：${sk}`);
        continue;
      }
      const resolved = resolveSkillMd(sk, {repoRoot, workspaceRoot});
      if (!resolved) {
        warnings.push(`skills 引用的技能本机未找到（运行时会自动忽略）：${sk}`);
      } else {
        referencedFiles.set(`skill:${sk}`, fs.readFileSync(resolved, 'utf8'));
      }
    }
  }

  // 正文结构与字数检查
  const {errors: bodyErrors, charCount} = validateBodyStructure(body);
  errors.push(...bodyErrors);

  // 「不抄手册」检查：正文任何连续 40 字以上不得原样出现在 reads/skills 或工作区手册中
  const manualsToCheck = new Map(referencedFiles);
  if (checkAllManualsForCopy) {
    for (const [k, v] of collectAllWorkspaceManuals(repoRoot)) {
      if (!manualsToCheck.has(k)) manualsToCheck.set(k, v);
    }
  }
  for (const [refName, refContent] of manualsToCheck.entries()) {
    const copied = findCopiedSubstring(body, refContent, 40);
    if (copied) {
      errors.push(`正文存在与 ${refName} 连续 40 字以上完全相同的片段：「${copied}」`);
    }
  }

  // 对照 PLAN 第四节角色清单表（当 id 在官方 33 张卡表中时核对）
  if (checkTableSpec && meta.id && Object.prototype.hasOwnProperty.call(ROLE_SPECS, meta.id)) {
    const spec = ROLE_SPECS[meta.id];
    if (meta.name !== spec.name) {
      errors.push(`与 PLAN 第四节表不一致：name 应为「${spec.name}」，实际为「${meta.name}」`);
    }
    if (meta.group !== spec.group) {
      errors.push(`与 PLAN 第四节表不一致：group 应为「${spec.group}」，实际为「${meta.group}」`);
    }
    if (meta.when !== spec.when) {
      errors.push(`与 PLAN 第四节表不一致：when 应为「${spec.when}」，实际为「${meta.when}」`);
    }
    if (meta.tier !== spec.tier) {
      errors.push(`与 PLAN 第四节表不一致：tier 应为「${spec.tier}」，实际为「${meta.tier}」`);
    }
    const actualVision = meta.vision === 'true';
    if (actualVision !== Boolean(spec.vision)) {
      errors.push(`与 PLAN 第四节表不一致：vision 应为 ${Boolean(spec.vision)}，实际为 ${actualVision}`);
    }
    const actualTools = Array.isArray(meta.tools) ? meta.tools : [];
    if (
      actualTools.length !== spec.tools.length ||
      actualTools.some((t, idx) => t !== spec.tools[idx])
    ) {
      errors.push(`与 PLAN 第四节表不一致：tools 应为 [${spec.tools.join(', ')}]，实际为 [${actualTools.join(', ')}]`);
    }
    const actualReview = meta.review || '';
    const expectedReview = spec.review || '';
    if (actualReview !== expectedReview) {
      errors.push(`与 PLAN 第四节表不一致：review 应为「${expectedReview || '(无)'}」，实际为「${actualReview || '(无)'}」`);
    }
    if (spec.deny_commands) {
      const actualDeny = Array.isArray(meta.deny_commands) ? meta.deny_commands : [];
      for (const reqCmd of spec.deny_commands) {
        if (!actualDeny.includes(reqCmd)) {
          errors.push(`与 PLAN 第四节表不一致：deny_commands 缺少「${reqCmd}」`);
        }
      }
    }
    if (READONLY_ROLE_IDS.has(meta.id) && actualTools.includes('write')) {
      errors.push(`R3-9 违规：只读角色 ${meta.id} 的 tools 不得包含 write`);
    }
  }

  return {
    file: absPath,
    id: meta.id || fileNameId,
    name: meta.name || '',
    group: meta.group || '',
    tier: meta.tier || '',
    vision: meta.vision === 'true',
    tools: meta.tools || [],
    review: meta.review || '',
    deny_commands: meta.deny_commands || [],
    reads: meta.reads || [],
    skills: meta.skills || [],
    charCount,
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function lintCards({
  targets = [],
  requireAll33 = false,
  repoRoot = REPO_ROOT,
} = {}) {
  const files = [];
  if (targets.length === 0) {
    if (fs.existsSync(DEFAULT_ROLES_DIR)) {
      for (const name of fs.readdirSync(DEFAULT_ROLES_DIR).sort()) {
        if (name.endsWith('.md')) {
          files.push(path.join(DEFAULT_ROLES_DIR, name));
        }
      }
    }
  } else {
    for (const t of targets) {
      const resolved = path.resolve(t);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        for (const name of fs.readdirSync(resolved).sort()) {
          if (name.endsWith('.md')) files.push(path.join(resolved, name));
        }
      } else {
        files.push(resolved);
      }
    }
  }

  const results = files.map(f => lintCardFile(f, {repoRoot}));
  const globalErrors = [];

  if (requireAll33) {
    const foundIds = new Set(results.map(r => r.id));
    for (const expectedId of Object.keys(ROLE_SPECS)) {
      if (!foundIds.has(expectedId)) {
        globalErrors.push(`缺少 PLAN 第四节规定的官方角色卡：${expectedId}.md`);
      }
    }
    for (const r of results) {
      if (!Object.prototype.hasOwnProperty.call(ROLE_SPECS, r.id)) {
        globalErrors.push(`存在不在 PLAN 第四节 33 张清单中的额外角色卡：${r.id}.md`);
      }
    }
  }

  const ok = results.length > 0 && results.every(r => r.ok) && globalErrors.length === 0;
  return {ok, count: results.length, results, globalErrors};
}

export function lintSampleFile(samplePath) {
  const absPath = path.resolve(samplePath);
  const fileId = path.basename(absPath, '.json');
  const errors = [];
  let raw;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    return {file: absPath, id: fileId, ok: false, errors: [`无法读取样题文件：${err.message}`]};
  }
  if (raw.includes('\r\n')) {
    errors.push('样题文件包含 CRLF (\\r\\n) 换行符，仓库要求 LF');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {file: absPath, id: fileId, ok: false, errors: [...errors, `JSON 解析失败：${err.message}`]};
  }
  if (parsed.role !== fileId) {
    errors.push(`role (${parsed.role}) 与文件名 (${fileId}.json) 不一致`);
  }
  if (!Array.isArray(parsed.samples) || parsed.samples.length !== 2) {
    errors.push(`每张卡必须配 2 道样题（当前 ${Array.isArray(parsed.samples) ? parsed.samples.length : 0} 道）`);
  } else {
    parsed.samples.forEach((s, idx) => {
      const tag = `第 ${idx + 1} 题 (${s?.id || '?'})`;
      if (!s || typeof s.brief !== 'string' || s.brief.trim().length < 20) {
        errors.push(`${tag} 缺少有效 brief`);
      }
      if (!Array.isArray(s?.files) || s.files.length === 0) {
        errors.push(`${tag} 缺少要准备的文件列表 files`);
      } else {
        for (const f of s.files) {
          if (!f?.path || typeof f.content !== 'string') {
            errors.push(`${tag} files 项缺少 path 或 content`);
          }
        }
      }
      if (!Array.isArray(s?.checks) || s.checks.length < 2) {
        errors.push(`${tag} checks 检查项不足 2 条`);
      } else {
        for (const c of s.checks) {
          if (typeof c !== 'string' || !c.trim()) {
            errors.push(`${tag} checks 含空检查项`);
          } else {
            for (const vague of FORBIDDEN_VAGUE_PHRASES) {
              if (c.includes(vague)) {
                errors.push(`${tag} 检查项包含主观空话「${vague}」：${c}`);
              }
            }
          }
        }
      }
      if (PLANTED_ISSUE_ROLE_IDS.has(fileId)) {
        if (!Array.isArray(s?.planted_issues) || s.planted_issues.length !== 3) {
          errors.push(`${tag} 审查/把关类角色 (${fileId}) 的样题必须埋 3 个问题（planted_issues 长度为 3）`);
        }
      }
    });
  }
  return {file: absPath, id: fileId, ok: errors.length === 0, errors};
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const requireAll33 = args.includes('--all-33');
  const checkSamples = args.includes('--samples');
  const targets = args.filter(a => !a.startsWith('--'));

  const summary = lintCards({targets, requireAll33});
  if (checkSamples) {
    summary.sampleResults = summary.results.map(r =>
      lintSampleFile(path.join(DEFAULT_SAMPLES_DIR, `${r.id}.json`)),
    );
    if (!summary.sampleResults.every(sr => sr.ok)) {
      summary.ok = false;
    }
  }
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    if (summary.count === 0) {
      console.error('未找到任何角色卡文件 (.md)');
    }
    for (const r of summary.results) {
      const rel = path.relative(REPO_ROOT, r.file).replace(/\\/g, '/');
      if (r.ok) {
        console.log(`PASS  ${r.id.padEnd(20)} (${r.charCount} 字)  ${rel}`);
      } else {
        console.error(`FAIL  ${r.id.padEnd(20)}  ${rel}`);
        for (const e of r.errors) console.error(`  - ${e}`);
      }
      for (const w of r.warnings) console.warn(`  ! ${w}`);
    }
    if (checkSamples && summary.sampleResults) {
      console.log('');
      for (const sr of summary.sampleResults) {
        const rel = path.relative(REPO_ROOT, sr.file).replace(/\\/g, '/');
        if (sr.ok) {
          console.log(`PASS  sample:${sr.id.padEnd(13)}  ${rel}`);
        } else {
          console.error(`FAIL  sample:${sr.id.padEnd(13)}  ${rel}`);
          for (const e of sr.errors) console.error(`  - ${e}`);
        }
      }
    }
    for (const ge of summary.globalErrors) {
      console.error(`GLOBAL FAIL: ${ge}`);
    }
    const passed = summary.results.filter(r => r.ok).length;
    console.log(`\n合计：${passed}/${summary.count} 张通过${summary.globalErrors.length ? `，全局错误 ${summary.globalErrors.length} 项` : ''}`);
  }
  process.exit(summary.ok ? 0 : 1);
}
