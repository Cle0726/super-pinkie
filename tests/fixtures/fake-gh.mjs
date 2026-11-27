// 假 gh（只给 tests/pr-flow-e2e.test.mjs 用）：PR 状态存在 $FAKE_GH_DIR/state.json，远端是 $FAKE_GH_DIR/origin.git 这个真的裸仓库。
// 头和差异都从裸仓库里真取（git rev-parse / git diff），合并在一个临时克隆里真做再推回去。每次调用记进 calls.jsonl。
// CI 结果由测试写进 state.ci[<头>]（SUCCESS / FAILURE），没写就是 PENDING。
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = process.env.FAKE_GH_DIR;
const file = path.join(dir, 'state.json');
const origin = path.join(dir, 'origin.git');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({args, cwd: process.cwd()}) + '\n');
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {prs: [], ci: {}, comments: []};
const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2));
const git = (a, cwd = origin) => execFileSync('git', a, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg, code = 1) => { process.stderr.write(msg + '\n'); process.exit(code); };
const head = (pr) => git(['rev-parse', `refs/heads/${pr.headRefName}`]);
const find = (n) => {
  if (n && /^\d+$/.test(n)) return state.prs.find((p) => p.number === Number(n)) || die(`no pull requests found for ${n}`);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], process.cwd());
  return state.prs.find((p) => p.headRefName === branch && p.state === 'OPEN') || die(`no pull requests found for branch "${branch}"`);
};
const view = (pr) => {
  const sha = head(pr), ci = state.ci[sha];
  return {number: pr.number, title: pr.title, url: `https://example.test/pr/${pr.number}`, state: pr.state, isDraft: pr.isDraft, headRefName: pr.headRefName,
    headRefOid: sha, baseRefName: pr.baseRefName, mergeable: 'MERGEABLE', reviewDecision: '',
    statusCheckRollup: [{name: 'CI', ...(ci ? {conclusion: ci, status: 'COMPLETED'} : {state: 'PENDING', status: 'IN_PROGRESS'})}]};
};
const pick = (obj) => { const f = opt('--json'); if (!f) return obj; const o = {}; for (const k of f.split(',')) o[k] = obj[k]; return o; };
const [a, b, n] = args;

if (a === 'auth' && b === 'status') { if (process.env.FAKE_GH_LOGGED_OUT) die('You are not logged into any GitHub hosts.'); process.stdout.write('Logged in to example.test\n'); }
else if (a === 'pr' && b === 'create') {
  const pr = {number: state.prs.length + 1, title: opt('--title'), headRefName: opt('--head'), baseRefName: opt('--base') || 'main', state: 'OPEN', isDraft: args.includes('--draft')};
  head(pr); state.prs.push(pr); save(); process.stdout.write(`https://example.test/pr/${pr.number}\n`);
}
else if (a === 'pr' && b === 'view') process.stdout.write(JSON.stringify(pick(view(find(n && !n.startsWith('-') ? n : undefined)))));
else if (a === 'pr' && b === 'list') process.stdout.write(JSON.stringify(state.prs.filter((p) => p.state === 'OPEN').map((p) => pick(view(p)))));
else if (a === 'pr' && b === 'diff') { const pr = find(n); process.stdout.write(git(['diff', `refs/heads/${pr.baseRefName}...refs/heads/${pr.headRefName}`]) + '\n'); }
else if (a === 'pr' && b === 'checks') {
  const ci = state.ci[head(find(n))];
  process.stdout.write(JSON.stringify([{name: 'CI', state: ci || 'PENDING', bucket: ci === 'SUCCESS' ? 'pass' : ci === 'FAILURE' ? 'fail' : 'pending', link: ''}]));
}
else if (a === 'pr' && b === 'comment') { const pr = find(n); state.comments.push({number: pr.number, body: fs.readFileSync(opt('--body-file'), 'utf8')}); save(); process.stdout.write(`https://example.test/pr/${pr.number}#c${state.comments.length}\n`); }
else if (a === 'pr' && b === 'merge') {
  const pr = find(n), sha = head(pr);
  if (!args.includes('--merge')) die('only --merge is supported here');
  if (opt('--match-head-commit') !== sha) die(`head branch was modified (expected ${opt('--match-head-commit')}, is ${sha})`);
  if (pr.state !== 'OPEN') die('pull request is not open');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-gh-merge-'));
  try {
    git(['clone', '-q', '-b', pr.baseRefName, origin, tmp], dir);
    git(['merge', '--no-ff', '-q', '-m', `Merge pull request #${pr.number}`, `origin/${pr.headRefName}`], tmp);
    git(['push', '-q', 'origin', `HEAD:refs/heads/${pr.baseRefName}`], tmp);
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
  pr.state = 'MERGED'; save(); process.stdout.write(`Merged pull request #${pr.number}\n`);
}
else die(`fake gh: unsupported ${args.join(' ')}`, 2);
