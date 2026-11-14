// tools-health-1113 D4：项目模式看当前分支的 PR、检查结果和评论。只读：只跑 `gh pr view` / `gh pr checks`，
// 不建 PR、不合并、不评论、不推送。靠本机的 gh（GitHub CLI）；没装或没登录时返回怎么装、怎么登录。
import {execFile} from 'node:child_process';

const FIELDS = 'number,title,state,isDraft,url,headRefName,baseRefName,author,reviewDecision,mergeable,statusCheckRollup,comments,reviews,updatedAt';
const INSTALL = '本机没有 gh（GitHub CLI）。装法：Windows 用 `winget install --id GitHub.cli`，Mac 用 `brew install gh`，或到 https://cli.github.com 下载；装好后在终端运行 `gh auth login` 登录一次。';
const LOGIN = 'gh 还没登录 GitHub。请先生在终端运行 `gh auth login` 登录一次（只需一次），之后再查。';

export function runGh(args, {cwd, timeout = 20_000} = {}) {
  return new Promise(resolve => {
    execFile('gh', args, {cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: {...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1'}},
      (error, stdout, stderr) => resolve({code: error ? (typeof error.code === 'number' ? error.code : error.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '')}));
  });
}

function checksOf(rollup = []) {
  return (Array.isArray(rollup) ? rollup : []).map(c => ({
    name: c.name || c.context || '',
    status: c.status || c.state || '',
    conclusion: c.conclusion || (c.state && c.state !== 'PENDING' ? c.state : ''),
    url: c.detailsUrl || c.targetUrl || '',
  }));
}

export function summarize(pr) {
  const checks = checksOf(pr.statusCheckRollup);
  const failed = checks.filter(c => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED/i.test(c.conclusion));
  const pending = checks.filter(c => !c.conclusion || /PENDING|QUEUED|IN_PROGRESS/i.test(c.status) && !c.conclusion);
  const comments = [...(pr.comments || []).map(c => ({by: c.author?.login || '', at: c.createdAt || '', body: String(c.body || '').slice(0, 600)})),
    ...(pr.reviews || []).filter(r => r.body).map(r => ({by: r.author?.login || '', at: r.submittedAt || '', state: r.state, body: String(r.body || '').slice(0, 600)}))]
    .sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-10);
  return {
    ok: true, number: pr.number, title: pr.title, state: pr.state, draft: Boolean(pr.isDraft), url: pr.url,
    branch: pr.headRefName, base: pr.baseRefName, author: pr.author?.login || '', review: pr.reviewDecision || '', mergeable: pr.mergeable || '',
    checks: {total: checks.length, failed: failed.length, pending: pending.length, passed: checks.length - failed.length - pending.length, list: checks},
    comments, updatedAt: pr.updatedAt,
  };
}

export async function prStatus({cwd, pr, gh = runGh} = {}) {
  const args = ['pr', 'view', ...(pr ? [String(pr)] : []), '--json', FIELDS];
  const res = await gh(args, {cwd});
  const err = `${res.stderr}\n${res.stdout}`;
  if (res.code === 'ENOENT' || /ENOENT|not recognized|command not found/i.test(err)) return {ok: false, reason: 'gh-missing', message: INSTALL};
  if (res.code !== 0) {
    if (/auth login|not logged|authentication/i.test(err)) return {ok: false, reason: 'gh-login', message: LOGIN};
    if (/no pull requests found/i.test(err)) return {ok: true, none: true, message: '当前分支还没有 PR。'};
    if (/not a git repository/i.test(err)) return {ok: false, reason: 'not-git', message: '当前项目文件夹不是 git 仓库。'};
    return {ok: false, reason: 'gh-error', message: (res.stderr || res.stdout).trim().slice(0, 600) || 'gh 查询失败'};
  }
  try { return summarize(JSON.parse(res.stdout)); }
  catch { return {ok: false, reason: 'gh-output', message: 'gh 的输出读不懂：' + res.stdout.slice(0, 200)}; }
}

export function createPrStatusTool(ctx, {rootFor, gh} = {}) {
  return {
    name: 'pr_status', label: '看 PR',
    description: '看当前项目分支在 GitHub 上的 PR：状态、检查（CI）通过 / 失败 / 进行中、最近的评论和审查意见。只读，不建 PR、不合并、不评论。靠本机的 gh；没装或没登录时会说怎么装、怎么登录。pr 可以指定 PR 编号，不给就看当前分支的。',
    parameters: {type: 'object', additionalProperties: false, properties: {pr: {type: 'integer', minimum: 1, description: 'PR 编号；不给就看当前分支的'}}},
    async execute(_toolCallId, params = {}) {
      let value;
      try { value = await prStatus({cwd: rootFor(ctx), pr: params.pr, gh}); }
      catch (error) { value = {ok: false, reason: 'error', message: String(error?.message || error)}; }
      return {content: [{type: 'text', text: JSON.stringify(value)}], details: value, isError: value.ok === false && ['gh-error', 'gh-output', 'error'].includes(value.reason)};
    },
  };
}
