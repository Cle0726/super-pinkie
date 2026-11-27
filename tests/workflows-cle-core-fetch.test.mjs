// B40 工作流契约测试：core-manifest default 切到 cle 后，任何调用 build-win.ps1 或
// desktop/macos/build.sh 的工作流 job 都必须在构建前单独一步跑 fetch-cle 并把
// PINKIE_CLE_CORE_TARBALL 写进 GITHUB_ENV（CLE_CORE_TOKEN 只留在该下载步，不进构建步），
// 或者显式声明 PINKIE_CORE: openclaw。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');
const BUILD_CMD_RE = /(?:\.[\\/])?build-win\.ps1|\bdesktop\/macos\/build\.sh\b/;

export function parseWorkflowJobs(yamlText) {
  const lines = yamlText.replace(/\r\n/g, '\n').split('\n');
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsIdx === -1) return [];
  const jobs = [];
  let curJob = null;
  let inSteps = false;
  let curStep = null;

  for (let i = jobsIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line) && !line.startsWith('#')) break;
    const jobMatch = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) {
      curJob = { name: jobMatch[1], line: i + 1, headerLines: [], steps: [] };
      jobs.push(curJob);
      inSteps = false;
      curStep = null;
      continue;
    }
    if (!curJob) continue;
    if (/^    steps:\s*$/.test(line)) {
      inSteps = true;
      curStep = null;
      continue;
    }
    if (!inSteps) {
      curJob.headerLines.push(line);
      continue;
    }
    if (/^      -\s/.test(line)) {
      curStep = { startLine: i + 1, lines: [line] };
      curJob.steps.push(curStep);
    } else if (curStep) {
      curStep.lines.push(line);
    }
  }
  return jobs;
}

function stepIfCondition(stepText) {
  const m = /^        if:\s*(.+)$/m.exec(stepText);
  return m ? m[1].trim() : '';
}

function isFetchCleStep(stepText) {
  return (
    /CLE_CORE_TOKEN:\s*\$\{\{\s*secrets\.CLE_CORE_TOKEN\s*\}\}/.test(stepText) &&
    /tools\/core\/manifest\.mjs\s+fetch-cle\b/.test(stepText) &&
    /PINKIE_CLE_CORE_TARBALL=.*GITHUB_ENV/.test(stepText) &&
    !BUILD_CMD_RE.test(stepText)
  );
}

export function auditWorkflowText(fileName, yamlText) {
  const violations = [];
  const topBeforeJobs = yamlText.split(/^jobs:\s*$/m)[0] || '';
  const workflowOpenclaw = /^\s*PINKIE_CORE:\s*['"]?openclaw['"]?\s*$/m.test(topBeforeJobs);

  for (const job of parseWorkflowJobs(yamlText)) {
    const jobHeader = job.headerLines.join('\n');
    const jobOpenclaw = workflowOpenclaw || /^\s*PINKIE_CORE:\s*['"]?openclaw['"]?\s*$/m.test(jobHeader);

    job.steps.forEach((step, idx) => {
      const text = step.lines.join('\n');
      const codeLines = step.lines.filter((l) => !/^\s*#/.test(l)).join('\n');
      if (!BUILD_CMD_RE.test(codeLines)) return;

      const stepOpenclaw = jobOpenclaw || /^\s*PINKIE_CORE:\s*['"]?openclaw['"]?\s*$/m.test(codeLines);
      if (stepOpenclaw) return;

      if (/CLE_CORE_TOKEN/.test(codeLines)) {
        violations.push(`${fileName}:${step.startLine} (${job.name}): build step must not receive CLE_CORE_TOKEN directly; isolate it in a prior fetch-cle step`);
        return;
      }

      const buildIf = stepIfCondition(codeLines);
      const priorFetch = job.steps.slice(0, idx).find((prev) => {
        const prevCode = prev.lines.filter((l) => !/^\s*#/.test(l)).join('\n');
        if (!isFetchCleStep(prevCode)) return false;
        const fetchIf = stepIfCondition(prevCode);
        return fetchIf === '' || fetchIf === buildIf;
      });

      if (!priorFetch) {
        violations.push(`${fileName}:${step.startLine} (${job.name}): invokes desktop builder without prior fetch-cle -> PINKIE_CLE_CORE_TARBALL step (or PINKIE_CORE: openclaw)`);
      }
    });
  }
  return violations;
}

test('all GitHub workflows building desktop packages pre-fetch C.le. core tarball in an isolated token step', () => {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
  assert.ok(files.length >= 7, 'expected repository workflow files');
  const violations = [];
  let checkedBuildJobs = 0;

  for (const file of files) {
    const text = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
    for (const job of parseWorkflowJobs(text)) {
      if (job.steps.some((s) => BUILD_CMD_RE.test(s.lines.filter((l) => !/^\s*#/.test(l)).join('\n')))) {
        checkedBuildJobs += 1;
      }
    }
    violations.push(...auditWorkflowText(file, text));
  }

  assert.ok(checkedBuildJobs >= 9, `expected at least 9 desktop package build jobs across workflows, found ${checkedBuildJobs}`);
  assert.deepEqual(violations, []);
});

test('workflow audit catches missing fetch-cle, token leaked to build step, wrong step order, and mismatched conditions', () => {
  const good = [
    'name: sample',
    'jobs:',
    '  win:',
    '    runs-on: windows-latest',
    '    steps:',
    '      - name: Download C.le. core tarball (SHA-256)',
    '        if: env.PACKAGE == \'build\'',
    '        shell: bash',
    '        env:',
    '          CLE_CORE_TOKEN: ${{ secrets.CLE_CORE_TOKEN }}',
    '        run: |',
    '          tgz="$(node tools/core/manifest.mjs fetch-cle --cache-dir "$RUNNER_TEMP/core-cache")"',
    '          printf \'PINKIE_CLE_CORE_TARBALL=%s\\n\' "$tgz" >> "$GITHUB_ENV"',
    '      - name: Build',
    '        if: env.PACKAGE == \'build\'',
    '        run: .\\build-win.ps1',
  ].join('\n');
  assert.deepEqual(auditWorkflowText('good.yml', good), []);

  const missing = [
    'jobs:',
    '  mac:',
    '    runs-on: macos-15',
    '    steps:',
    '      - name: Build Mac',
    '        run: ./desktop/macos/build.sh',
  ].join('\n');
  assert.equal(auditWorkflowText('missing.yml', missing).length, 1);

  const leakedToken = [
    'jobs:',
    '  win:',
    '    runs-on: windows-latest',
    '    steps:',
    '      - name: Build with token exposed',
    '        env:',
    '          CLE_CORE_TOKEN: ${{ secrets.CLE_CORE_TOKEN }}',
    '        run: .\\build-win.ps1',
  ].join('\n');
  assert.match(auditWorkflowText('leaked.yml', leakedToken)[0], /must not receive CLE_CORE_TOKEN directly/);

  const wrongOrder = [
    'jobs:',
    '  win:',
    '    runs-on: windows-latest',
    '    steps:',
    '      - name: Build first',
    '        run: .\\build-win.ps1',
    '      - name: Download after',
    '        env:',
    '          CLE_CORE_TOKEN: ${{ secrets.CLE_CORE_TOKEN }}',
    '        run: |',
    '          tgz="$(node tools/core/manifest.mjs fetch-cle)"',
    '          echo "PINKIE_CLE_CORE_TARBALL=$tgz" >> "$GITHUB_ENV"',
  ].join('\n');
  assert.equal(auditWorkflowText('order.yml', wrongOrder).length, 1);

  const explicitOpenclaw = [
    'jobs:',
    '  win:',
    '    runs-on: windows-latest',
    '    env:',
    '      PINKIE_CORE: openclaw',
    '    steps:',
    '      - name: Build openclaw',
    '        run: .\\build-win.ps1',
  ].join('\n');
  assert.deepEqual(auditWorkflowText('openclaw.yml', explicitOpenclaw), []);
});
