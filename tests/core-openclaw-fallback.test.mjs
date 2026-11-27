// L79 / PLAN K5-4「保留退路」：core-manifest.json 的 default 已经是 cle（B40），
// 但切换以后至少两个正式版里 OpenClaw 这条路都要保持能打包，CI 里两条路照常都跑。
// 这里守住三件事：
//   1. CI 的「C.le. 内核」job 每个 PR 和 main 推送都照常装 npm openclaw、在它上面打全部补丁；
//   2. 所有打包工作流里下载 C.le. 内核那一步都只在 default=cle 时才要令牌，
//      所以把 default 改回 openclaw 时打包不会因为缺 CLE_CORE_TOKEN 失败；
//   3. 把 default 改回 openclaw 后，清单工具确实选中 openclaw，且不需要任何令牌或 cle 地址。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_REPO_ROOT, loadCoreManifest, resolveCoreSelection } from '../tools/core/manifest.mjs';

const ROOT = DEFAULT_REPO_ROOT;
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const CLE_GATE = 'if [[ "$(node tools/core/manifest.mjs field core)" == "cle" ]]; then';

// 把工作流切成 { job, text } 的步骤列表（只认仓库里现有的两格缩进 job、六格缩进步骤写法）。
export function workflowSteps(yaml) {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsIdx < 0) return [];
  const steps = [];
  let job = '';
  let cur = null;
  for (let i = jobsIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    const jobMatch = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) {
      job = jobMatch[1];
      cur = null;
      continue;
    }
    if (/^      -\s/.test(line)) {
      cur = { job, text: line };
      steps.push(cur);
    } else if (cur && (/^       /.test(line) || line.trim() === '')) {
      cur.text += `\n${line}`;
    } else {
      cur = null;
    }
  }
  return steps;
}

export function jobBlock(yaml, name) {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i]) || (/^\S/.test(lines[i]) && !lines[i].startsWith('#'))) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

// CI 里 OpenClaw 这条路：每个 PR 和 main 推送都跑，装 npm openclaw，打全部补丁，失败不能被吞。
export function auditOpenclawLane(ciYaml) {
  const problems = [];
  const ci = ciYaml.replace(/\r\n/g, '\n');
  const top = ci.split(/^jobs:\s*$/m)[0] || '';
  if (!/^  push:\n    branches: \[main\]$/m.test(top)) problems.push('ci.yml no longer runs on push to main');
  if (!/^  pull_request:/m.test(top)) problems.push('ci.yml no longer runs on pull_request');
  const job = jobBlock(ci, 'cle-core-checks');
  if (!job) {
    problems.push('cle-core-checks job is missing');
    return problems;
  }
  const ifLine = /^    if:\s*(.+)$/m.exec(job);
  if (ifLine && !/^github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository$/.test(ifLine[1].trim())) {
    problems.push(`cle-core-checks job condition narrowed: ${ifLine[1].trim()}`);
  }
  if (/continue-on-error:\s*true/.test(job)) problems.push('cle-core-checks swallows failures (continue-on-error)');
  if (!/node tools\/core\/manifest\.mjs install --core openclaw --prefix "\$official"/.test(job)) {
    problems.push('cle-core-checks no longer installs npm openclaw (--core openclaw)');
  }
  if (!/node tools\/core\/verify-cle-patches\.mjs --openclaw-root "\$official\/node_modules\/openclaw"/.test(job)) {
    problems.push('cle-core-checks no longer applies Pinkie patches on the OpenClaw core');
  }
  return problems;
}

// 打包用的下载步骤只在 default=cle 时要令牌；cle-core-checks 本身就是测 C.le. 的，必须无条件要。
export function auditFetchGates(fileName, yaml) {
  const problems = [];
  let gated = 0;
  for (const step of workflowSteps(yaml)) {
    const code = step.text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    if (!/tools\/core\/manifest\.mjs fetch-cle\b/.test(code)) continue;
    if (fileName === 'ci.yml' && step.job === 'cle-core-checks') continue;
    const gate = code.indexOf(CLE_GATE);
    const fetch = code.search(/manifest\.mjs fetch-cle\b/);
    const tokenCheck = code.indexOf('CLE_CORE_TOKEN is not configured');
    if (gate < 0 || gate > fetch || (tokenCheck >= 0 && gate > tokenCheck)) {
      problems.push(`${fileName} (${step.job}): C.le. download is not gated on default core == cle, so a default=openclaw rollback would still demand CLE_CORE_TOKEN`);
    } else {
      gated += 1;
    }
  }
  return { problems, gated };
}

test('K5-4: CI keeps installing and patching the OpenClaw core on every PR and main push', () => {
  assert.deepEqual(auditOpenclawLane(read('.github/workflows/ci.yml')), []);
});

test('K5-4: every packaging workflow asks for the C.le. token only when default core is cle', () => {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  const problems = [];
  let gated = 0;
  for (const file of files) {
    const res = auditFetchGates(file, fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8'));
    problems.push(...res.problems);
    gated += res.gated;
  }
  assert.deepEqual(problems, []);
  // build / ci windows-build / release-candidate x2 / release x2 / ui-parity x2 / windows-smoke / update-probe
  assert.ok(gated >= 10, `expected at least 10 gated C.le. download steps, found ${gated}`);
});

test('K5-4: flipping default back to openclaw selects the npm openclaw core with no token or cle URL', () => {
  const real = loadCoreManifest(ROOT);
  assert.equal(real.default, 'cle', 'this test describes the post-B40 state; update it together with core-manifest.json');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-l79-flip-'));
  try {
    const flipped = JSON.parse(read('core-manifest.json'));
    flipped.default = 'openclaw';
    fs.writeFileSync(path.join(tmp, 'core-manifest.json'), `${JSON.stringify(flipped, null, 2)}\n`);

    const sel = resolveCoreSelection(loadCoreManifest(tmp), '');
    assert.equal(sel.core, 'openclaw');
    assert.equal(sel.spec.version, real.openclaw.version);
    assert.equal(sel.spec.url, undefined, 'the openclaw core needs no private download URL');

    const env = { ...process.env, PINKIE_CORE: '' };
    for (const name of ['CLE_CORE_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'PINKIE_CLE_CORE_TARBALL']) delete env[name];
    const cli = path.join(ROOT, 'tools', 'core', 'manifest.mjs');
    const field = spawnSync(process.execPath, [cli, 'field', 'core', '--root', tmp], { encoding: 'utf8', env });
    assert.equal(field.status, 0, field.stderr);
    assert.equal(field.stdout, 'openclaw', 'the workflow gate `field core == cle` is false after the flip');
    const info = spawnSync(process.execPath, [cli, 'info', '--root', tmp], { encoding: 'utf8', env });
    assert.equal(info.status, 0, info.stderr);
    assert.deepEqual(
      JSON.parse(info.stdout),
      { core: 'openclaw', default: 'openclaw', node: real.node, version: real.openclaw.version, url: null, sha256: null },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('K5-4: the OpenClaw patch run lists only patch files that exist (a missing one would be skipped silently)', () => {
  const source = read('tools/core/verify-cle-patches.mjs');
  const block = /const RUNTIME_PATCHES = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, 'RUNTIME_PATCHES list not found');
  const listed = [...block[1].matchAll(/'([^']+\.mjs)'/g)].map((m) => m[1]);
  assert.ok(listed.length >= 17, `expected the 17 runtime patches, found ${listed.length}`);
  const missing = listed.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  assert.deepEqual(missing, []);
});

test('fallback audits catch a dropped OpenClaw install, swallowed failures, narrowed triggers and ungated token steps', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.deepEqual(auditOpenclawLane(ci), []);

  const noInstall = ci.replace(/\n.*manifest\.mjs install --core openclaw.*/, '');
  assert.match(auditOpenclawLane(noInstall).join('\n'), /no longer installs npm openclaw/);
  const noPatch = ci.replace(/\n.*verify-cle-patches\.mjs --openclaw-root "\$official.*/, '');
  assert.match(auditOpenclawLane(noPatch).join('\n'), /no longer applies Pinkie patches/);
  const swallowed = ci.replace('    env:\n      PINKIE_CORE: cle', '    continue-on-error: true\n    env:\n      PINKIE_CORE: cle');
  assert.match(auditOpenclawLane(swallowed).join('\n'), /swallows failures/);
  const narrowed = ci.replace(
    "    if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository",
    "    if: github.event_name == 'workflow_dispatch'",
  );
  assert.match(auditOpenclawLane(narrowed).join('\n'), /condition narrowed/);
  const noMainPush = ci.replace('  push:\n    branches: [main]\n', '');
  assert.match(auditOpenclawLane(noMainPush).join('\n'), /push to main/);
  const noJob = ci.replace('  cle-core-checks:', '  cle-core-renamed:');
  assert.match(auditOpenclawLane(noJob).join('\n'), /job is missing/);

  const ungated = [
    'jobs:',
    '  win:',
    '    runs-on: windows-latest',
    '    steps:',
    '      - name: Download C.le. core tarball (SHA-256)',
    '        shell: bash',
    '        env:',
    '          CLE_CORE_TOKEN: ${{ secrets.CLE_CORE_TOKEN }}',
    '        run: |',
    '          if [[ -z "${CLE_CORE_TOKEN:-}" ]]; then',
    '            echo "::error::CLE_CORE_TOKEN is not configured, so the C.le. core cannot be packaged."',
    '            exit 1',
    '          fi',
    '          tgz="$(node tools/core/manifest.mjs fetch-cle --cache-dir "$RUNNER_TEMP/core-cache")"',
    '          printf \'PINKIE_CLE_CORE_TARBALL=%s\\n\' "$tgz" >> "$GITHUB_ENV"',
    '      - name: Build',
    '        run: .\\build-win.ps1',
  ].join('\n');
  assert.equal(auditFetchGates('sample.yml', ungated).problems.length, 1);
  const gatedText = ungated.replace(
    '        run: |\n          if [[ -z',
    `        run: |\n          ${CLE_GATE}\n          if [[ -z`,
  );
  assert.deepEqual(auditFetchGates('sample.yml', gatedText), { problems: [], gated: 1 });
});
