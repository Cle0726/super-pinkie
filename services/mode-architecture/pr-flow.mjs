// 编程模式（Metre）里的「PR 一条龙」后端（新功能第 5 项，m5，11-25）。设计：build/quick-run/设计-PR一条龙.md。
// 三步：审查（列问题，按严重程度排，每条带文件和行）→ 跟进（看 CI、跟 main、按意见改、回评论）→ 合并。
// 规矩：
//   - 只在 Metre 会话、只在用户绑了的文件夹里；不是 git 仓库 / 没装 gh / gh 没登录 → ready:false + 一句话，不报错。
//   - 用用户自己 gh 的登录：碧琪不读、不存、不打印令牌；输出里像令牌的串先抹掉再给界面。
//   - 合并只走 pinkie.pr.merge，而且要界面传来的 confirm = "<号>@<头>" 和当前头一致、不是草稿、CI 全绿。
//     审查和跟进里任何一步都不会调 gh pr merge（契约测试锁着）。
//   - 跟 main 只 merge（不变基、不 force）；有冲突就 merge --abort、报冲突文件，停下。
// 怎么跑命令、怎么问引擎都由外面注入（run / ask / fix），测试里换成假的。
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const METRE = /^agent:metre:/;
const TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const SEVERITY = ['high', 'medium', 'low'];
const PR_FIELDS = 'number,title,url,state,isDraft,headRefName,headRefOid,baseRefName,mergeable,reviewDecision,statusCheckRollup';

export const redact = (text) => String(text ?? '').replace(TOKEN, '[已隐去]');
const fail = (message, code = 'INVALID_REQUEST') => Object.assign(new Error(message), {code});
const num = (n) => { const v = Number(n); if (!Number.isInteger(v) || v <= 0) throw fail('PR 号不对'); return v; };

// 默认的跑命令：execFile、不经过 shell、带超时；gh 关掉交互提示和更新提醒。返回 {code, stdout, stderr}，不抛。
export function defaultRun(children = new Set()) {
  return (cmd, args, {cwd, timeout = 120_000} = {}) => new Promise((resolve) => {
    const env = {...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1'};
    const child = execFile(cmd, args, {cwd, timeout, env, windowsHide: true, maxBuffer: 16 * 1024 * 1024}, (error, stdout, stderr) => {
      children.delete(child);
      resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: redact(stderr || error?.message || '')});
    });
    children.add(child);
  });
}

// 审查结果：引擎回的字里找 JSON 数组（```json 块或第一个 [...]），每条 {severity, file, line, title, detail}。
// 解析不了就把原文当一条 low，不白屏。按 high → medium → low 排。
export function parseFindings(text) {
  const raw = String(text ?? '');
  const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
  let list = null;
  try { const v = JSON.parse(block); list = Array.isArray(v) ? v : Array.isArray(v?.findings) ? v.findings : null; } catch {}
  if (!list) return raw.trim() ? [{severity: 'low', file: '', line: 0, title: '引擎的审查没按格式回，原文如下', detail: redact(raw.trim()).slice(0, 4000)}] : [];
  return list.filter((f) => f && typeof f === 'object').map((f) => ({
    severity: SEVERITY.includes(String(f.severity).toLowerCase()) ? String(f.severity).toLowerCase() : 'low',
    file: String(f.file ?? '').slice(0, 400), line: Math.max(0, Number.parseInt(f.line, 10) || 0),
    title: redact(f.title ?? '').slice(0, 200), detail: redact(f.detail ?? '').slice(0, 4000),
  })).sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity));
}

const checksGreen = (rollup) => Array.isArray(rollup) && rollup.length > 0
  && rollup.every((c) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(String(c.conclusion || c.state || '').toUpperCase()));

export function reviewPrompt({pr, diff}) {
  return [
    `审查这个 PR：#${pr.number}「${pr.title}」（${pr.headRefName} → ${pr.baseRefName}）。只读，不要改文件、不要提交、不要合并。`,
    '找真正的问题（错误、漏掉的情况、安全、和说明不符），不要挑风格。',
    '只回一个 JSON 数组，每条 {"severity":"high|medium|low","file":"相对路径","line":行号,"title":"一句话","detail":"为什么、怎么改"}；没有问题就回 []。',
    '', '```diff', diff.slice(0, 200_000), '```',
  ].join('\n');
}

export class PrFlow {
  constructor({scope, run, ask, fix, gh = 'gh', git = 'git'} = {}) {
    this.children = new Set();
    this.scopeOf = scope; this.run = run || defaultRun(this.children); this.ask = ask; this.fix = fix;
    this.gh = gh; this.git = git;
    this.progress = new Map(); // sessionKey → {step, phase, detail, at}
  }

  where(params = {}) {
    const key = String(params.sessionKey || '');
    if (!METRE.test(key)) throw fail('PR 一条龙只在 Metre 的会话里用');
    const scope = this.scopeOf(params);
    if (!scope?.bound) return {key, scope, why: '先给这个会话绑一个项目文件夹（git 仓库）。'};
    return {key, scope, why: ''};
  }
  note(key, step, phase, detail = '') { const p = {step, phase, detail: redact(detail).slice(0, 400), at: Date.now()}; this.progress.set(key, p); return p; }
  async sh(cmd, args, cwd) { return this.run(cmd, args, {cwd}); }
  async json(args, cwd) { const r = await this.sh(this.gh, args, cwd); if (r.code !== 0) throw fail(redact(r.stderr).trim().slice(0, 300) || 'gh 没成功'); return JSON.parse(r.stdout || 'null'); }

  async ready(params) {
    const {key, scope, why} = this.where(params);
    if (why) return {key, scope, ready: false, why};
    if ((await this.sh(this.git, ['rev-parse', '--is-inside-work-tree'], scope.root)).code !== 0) return {key, scope, ready: false, why: '这个文件夹不是 git 仓库。'};
    const auth = await this.sh(this.gh, ['auth', 'status'], scope.root);
    if (auth.code === 127 || /ENOENT|not found|不是内部或外部命令/i.test(auth.stderr)) return {key, scope, ready: false, why: '本机没装 gh（GitHub 命令行）。'};
    if (auth.code !== 0) return {key, scope, ready: false, why: '本机 gh 还没登录：在终端里跑 gh auth login。'};
    return {key, scope, ready: true, why: ''};
  }

  async status(params) {
    const r = await this.ready(params);
    if (!r.ready) return {ready: false, why: r.why, progress: this.progress.get(r.key) || null};
    const cwd = r.scope.root;
    const view = await this.sh(this.gh, ['pr', 'view', '--json', PR_FIELDS], cwd);
    const list = await this.sh(this.gh, ['pr', 'list', '--limit', '10', '--json', 'number,title,headRefName,isDraft'], cwd);
    return {ready: true, why: '', current: view.code === 0 ? JSON.parse(view.stdout) : null,
      recent: list.code === 0 ? JSON.parse(list.stdout) : [], progress: this.progress.get(r.key) || null};
  }

  async review(params) {
    const r = await this.ready(params); if (!r.ready) throw fail(r.why);
    const n = num(params.number), cwd = r.scope.root;
    if (typeof this.ask !== 'function') throw fail('引擎台还没接上，先在 Metre 里选一个引擎。');
    this.note(r.key, 'review', 'running', `#${n} 读改动`);
    const pr = await this.json(['pr', 'view', String(n), '--json', PR_FIELDS], cwd);
    const diff = await this.sh(this.gh, ['pr', 'diff', String(n)], cwd);
    if (diff.code !== 0) { this.note(r.key, 'review', 'failed', diff.stderr); throw fail('拿不到这个 PR 的改动：' + redact(diff.stderr).slice(0, 200)); }
    this.note(r.key, 'review', 'running', `#${n} 引擎在审`);
    const answer = await this.ask(r.key, reviewPrompt({pr, diff: diff.stdout}), {readOnly: true});
    const findings = parseFindings(answer);
    this.note(r.key, 'review', 'done', `#${n} ${findings.length} 条`);
    return {number: n, head: pr.headRefOid, findings};
  }

  // steps：ci / main / fix / reply 任选；fix 要 findings，reply 要 body 和 confirm:true（界面上点了「发」）。
  async followUp(params) {
    const r = await this.ready(params); if (!r.ready) throw fail(r.why);
    const n = num(params.number), cwd = r.scope.root, steps = new Set([].concat(params.steps || []));
    const out = {number: n};
    const pr = await this.json(['pr', 'view', String(n), '--json', PR_FIELDS], cwd);
    if (steps.has('ci')) {
      this.note(r.key, 'ci', 'running', `#${n} 看 CI`);
      const c = await this.sh(this.gh, ['pr', 'checks', String(n), '--json', 'name,state,bucket,link'], cwd);
      out.ci = c.stdout.trim() ? JSON.parse(c.stdout) : [];
      this.note(r.key, 'ci', 'done', `${out.ci.length} 项`);
    }
    if (steps.has('main')) {
      this.note(r.key, 'main', 'running', `跟 ${pr.baseRefName}`);
      const cur = (await this.sh(this.git, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).stdout.trim();
      if (cur !== pr.headRefName) { this.note(r.key, 'main', 'failed', '分支不对'); throw fail(`当前分支是 ${cur}，不是这个 PR 的 ${pr.headRefName}，先切过去。`); }
      await this.sh(this.git, ['fetch', 'origin', pr.baseRefName], cwd);
      const m = await this.sh(this.git, ['merge', '--no-edit', `origin/${pr.baseRefName}`], cwd);
      if (m.code !== 0) {
        const u = await this.sh(this.git, ['diff', '--name-only', '--diff-filter=U'], cwd);
        await this.sh(this.git, ['merge', '--abort'], cwd);
        out.main = {merged: false, conflicts: u.stdout.split(/\r?\n/).filter(Boolean)};
        this.note(r.key, 'main', 'failed', `有冲突：${out.main.conflicts.length} 个文件，已撤回`);
        return out;
      }
      out.main = {merged: true, conflicts: []};
      this.note(r.key, 'main', 'done', '已跟上');
    }
    if (steps.has('fix')) {
      if (typeof this.fix !== 'function') throw fail('引擎台还没接上，改不了。');
      const picked = parseFindings(JSON.stringify(params.findings || []));
      if (!picked.length) throw fail('先选要改的审查意见。');
      this.note(r.key, 'fix', 'running', `按 ${picked.length} 条意见改`);
      out.fix = await this.fix(r.key, {number: n, branch: pr.headRefName, findings: picked});
      this.note(r.key, 'fix', 'done', '');
    }
    // 推送：跟上 base、引擎改完提交以后，要推到 PR 分支 CI 才会跑新头。只推当前分支、只用普通 push（不 force），被拒就停。
    // 「改」只是把活交给引擎（异步），推送要等引擎改完、在引擎台里看过再单独点。
    if (steps.has('push')) {
      this.note(r.key, 'push', 'running', `推到 ${pr.headRefName}`);
      const cur = (await this.sh(this.git, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).stdout.trim();
      if (cur !== pr.headRefName) { this.note(r.key, 'push', 'failed', '分支不对'); throw fail(`当前分支是 ${cur}，不是这个 PR 的 ${pr.headRefName}，先切过去。`); }
      const p = await this.sh(this.git, ['push', 'origin', `HEAD:refs/heads/${pr.headRefName}`], cwd);
      if (p.code !== 0) { this.note(r.key, 'push', 'failed', p.stderr); throw fail('没推上去（不会强推；远端有新提交就先「跟上」再推）：' + redact(p.stderr).slice(0, 200)); }
      out.push = {pushed: true, head: (await this.sh(this.git, ['rev-parse', 'HEAD'], cwd)).stdout.trim()};
      this.note(r.key, 'push', 'done', out.push.head.slice(0, 8));
    }
    if (steps.has('reply')) {
      const body = String(params.body || '').trim();
      if (!body) throw fail('回评论要先写好正文。');
      if (params.confirm !== true) throw fail('回评论要你在界面上点「发」。');
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pk-pr-')), 'body.md');
      fs.writeFileSync(file, body);
      try {
        const c = await this.sh(this.gh, ['pr', 'comment', String(n), '--body-file', file], cwd);
        if (c.code !== 0) throw fail('评论没发出去：' + redact(c.stderr).slice(0, 200));
        out.reply = {url: c.stdout.trim()};
      } finally { fs.rmSync(path.dirname(file), {recursive: true, force: true}); }
      this.note(r.key, 'reply', 'done', '');
    }
    return out;
  }

  // 只有界面上点了「合并」才会来这里。confirm 必须是 "<号>@<头>"，和现在的头一致。
  async merge(params) {
    const r = await this.ready(params); if (!r.ready) throw fail(r.why);
    const n = num(params.number), cwd = r.scope.root;
    const pr = await this.json(['pr', 'view', String(n), '--json', PR_FIELDS], cwd);
    if (params.confirm !== `${n}@${pr.headRefOid}`) throw fail('PR 的头变了或没确认，重新看一眼再点合并。', 'CONFLICT');
    if (pr.state !== 'OPEN') throw fail('这个 PR 不是打开的。');
    if (pr.isDraft) throw fail('还是草稿，先改成可以审查。');
    if (!checksGreen(pr.statusCheckRollup)) throw fail('CI 还没全绿，不能合并。');
    this.note(r.key, 'merge', 'running', `#${n}`);
    const m = await this.sh(this.gh, ['pr', 'merge', String(n), '--merge', '--match-head-commit', pr.headRefOid], cwd);
    if (m.code !== 0) { this.note(r.key, 'merge', 'failed', m.stderr); throw fail('没合并成：' + redact(m.stderr).slice(0, 200)); }
    this.note(r.key, 'merge', 'done', `#${n} 已合并`);
    return {number: n, merged: true, head: pr.headRefOid};
  }

  stop(params = {}) {
    const key = String(params.sessionKey || '');
    for (const child of this.children) { try { child.kill(); } catch {} }
    this.children.clear();
    return {stopped: true, progress: this.note(key, this.progress.get(key)?.step || '', 'stopped', '已停')};
  }
}

// 接引擎台：engines.mjs 把桥放在 globalThis[Symbol.for('pinkie.engines.v1')].bridge（metre-board 里注册，可能晚于这里），用时再取。
// ask：用这个会话选的引擎和模型开一段**计划模式**（不改文件）的新对话，等它跑完，取最后一条回答。
// fix：开一段普通对话，把选中的意见交给它改；返回线程号，进度在引擎台里看、能停。
export function engineAdapter({bridge = () => globalThis[Symbol.for('pinkie.engines.v1')]?.bridge, wait = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 15 * 60_000, everyMs = 2000} = {}) {
  const pick = (key) => {
    const b = bridge(); if (!b) throw fail('外部引擎还没打开：在 Metre 的引擎菜单里打开并选一个引擎。');
    const pref = b.sessions.get(key) || {};
    if (!pref.engine || pref.engine === 'metre' || !pref.model) throw fail('先在 Metre 的引擎菜单里给这个会话选一个外部引擎和模型。');
    return {b, pref, folder: b.folderFor(key)};
  };
  return {
    async ask(key, text) {
      const {b, pref, folder} = pick(key);
      const {threadId} = await b.start({folder, engine: pref.engine, model: pref.model, text, plan: true, title: 'PR 审查'});
      for (const end = Date.now() + timeoutMs; Date.now() < end; await wait(everyMs)) {
        const s = await b.thread(threadId);
        if (!s.activeRunId) {
          if (s.status === 'failed') throw fail('引擎审查没跑完：' + redact(s.error?.text || '').slice(0, 200));
          return [...(s.items || [])].reverse().find((i) => i.kind === 'reply' && !i.streaming)?.text || '';
        }
      }
      await b.stop({threadId}).catch(() => {});
      throw fail('引擎审查超时，已停下。');
    },
    async fix(key, {number, branch, findings}) {
      const {b, pref, folder} = pick(key);
      const list = findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? ':' + f.line : ''} ${f.title}${f.detail ? ' —— ' + f.detail : ''}`).join('\n');
      const text = `在分支 ${branch} 上按下面的审查意见改 PR #${number}，改完提交（不要推送、不要合并、不要变基）：\n${list}`;
      const {threadId} = await b.start({folder, engine: pref.engine, model: pref.model, text, title: `改 PR #${number}`});
      return {threadId};
    },
  };
}

export function registerPrFlow(api, options = {}) {
  const engine = options.ask || options.fix ? {} : engineAdapter(options.engine);
  const flow = options.flow || new PrFlow({ask: engine.ask, fix: engine.fix, ...options});
  const method = (name, scope, fn) => api.registerGatewayMethod(name, async ({params, respond}) => {
    try { respond(true, await fn(params || {})); }
    catch (error) { respond(false, undefined, {code: error.code === 'CONFLICT' ? 'CONFLICT' : 'INVALID_REQUEST', message: redact(error.message || '操作未完成。').slice(0, 400)}); }
  }, {scope});
  method('pinkie.pr.status', 'operator.read', (p) => flow.status(p));
  method('pinkie.pr.review', 'operator.admin', (p) => flow.review(p));
  method('pinkie.pr.followUp', 'operator.admin', (p) => flow.followUp(p));
  method('pinkie.pr.merge', 'operator.admin', (p) => flow.merge(p));
  method('pinkie.pr.stop', 'operator.admin', (p) => flow.stop(p));
  return flow;
}
