// tools-health-1113 D2：项目模式开子会话时，项目文件夹是 git 仓库，就给子会话一个独立工作树和分支，
// 父会话和几个子会话各在自己的目录里改，互不踩文件。复用 OpenClaw 自带的「受管工作树」
// （网关方法 worktrees.create / worktrees.remove：放在状态目录 worktrees/<仓库指纹>/<名字>，
// 分支 openclaw/<名字>，删除前先把内容快照到 refs/openclaw/snapshots/<id>，能恢复）。
//
// 子会话每次汇报时看一眼：工作树里没有任何改动（没有未提交的、也没有新提交）就清掉，
// 汇报里写一句；有改动就留着，把分支名和位置写进汇报。**不合并、不推送**，这两件事留给用户。
import {execFile} from 'node:child_process';

export function runGit(cwd, args, {timeout = 15_000} = {}) {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, ...args], {timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024},
      (error, stdout, stderr) => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '')}));
  });
}

export async function isGitRepo(root, {git = runGit} = {}) {
  if (!root) return false;
  const res = await git(root, ['rev-parse', '--is-inside-work-tree']);
  return res.code === 0 && res.stdout.trim() === 'true';
}

/** 项目模式、绑定的文件夹是 git 仓库：建一个工作树；否则返回 null（照旧共用文件夹）。 */
export async function prepareChildWorktree({rpc, root, mode, id, git = runGit}) {
  if (mode !== 'project' || !root || !(await isGitRepo(root, {git}))) return null;
  const name = 'pinkie-' + String(id).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12);
  const record = await rpc('worktrees.create', {repoRoot: root, name}, {admin: true});
  if (!record?.path || !record?.branch) throw new Error('网关没有返回工作树');
  // OpenClaw 记的 baseRef 是字面的 "HEAD"；换成当时的提交号，之后才数得出分支上多了几个提交（11-13 副本实测）。
  const head = await git(record.path, ['rev-parse', 'HEAD']);
  const baseRef = head.code === 0 && /^[0-9a-f]{7,64}$/.test(head.stdout.trim()) ? head.stdout.trim() : '';
  return {id: record.id, path: record.path, branch: record.branch, baseRef, repoRoot: record.repoRoot || root};
}

export async function worktreeChanged(wt, {git = runGit} = {}) {
  const status = await git(wt.path, ['status', '--porcelain']);
  if (status.code !== 0) return true; // 看不清就当有改动，宁可留着
  if (status.stdout.trim()) return true;
  if (!wt.baseRef) return false;
  const ahead = await git(wt.path, ['rev-list', '--count', `${wt.baseRef}..HEAD`]);
  return ahead.code !== 0 || Number(ahead.stdout.trim()) > 0;
}

/** 汇报时调用：没改动就清掉（返回 cleaned），有改动就留着（返回 kept）。 */
export async function settleChildWorktree({rpc, wt, git = runGit}) {
  if (!wt || wt.removed) return null;
  if (await worktreeChanged(wt, {git})) return {kept: true, path: wt.path, branch: wt.branch};
  await rpc('worktrees.remove', {id: wt.id}, {admin: true});
  return {cleaned: true, branch: wt.branch};
}

export function worktreeBrief(wt) {
  return `\n\n【独立工作树】这个子会话在自己的 git 工作树里干活：${wt.path}（分支 ${wt.branch}，从 ${wt.baseRef || '当前提交'} 分出来）。`
    + '只在这个目录里改，不要切换分支、不要合并、不要推送；做完就停在这个分支上，汇报时写清改了什么。';
}

export function worktreeReportLine(settled) {
  if (!settled) return '';
  if (settled.cleaned) return `\n\n（子会话的工作树没有改动，已自动清掉；分支 ${settled.branch} 一并删掉。）`;
  return `\n\n（子会话的改动在分支 ${settled.branch}，工作树位置 ${settled.path}。没有合并、没有推送；要不要合进来由先生决定。）`;
}
