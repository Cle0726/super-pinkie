import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decryptFeedbackEnvelope,
  encryptFeedbackEnvelope,
  generateFeedbackKeypair,
  publicKeyFingerprint,
} from '../services/mode-architecture/feedback-crypto.mjs';
import {
  aggregateFeedback,
  decryptRecordsFromDir,
  renderHtmlReport,
  renderMarkdownReport,
  runKeygen,
} from '../tools/feedback/read.mjs';

test('X25519 + AES-256-GCM envelope encrypts and decrypts cleanly with PEM and base64 public keys', () => {
  const pair = generateFeedbackKeypair();
  assert.match(pair.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.match(pair.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.equal(publicKeyFingerprint(pair.publicKeyDerBase64), pair.fingerprint);

  const payload = {
    schema: 1,
    appVersion: '2.5.49',
    records: [
      {id: '1', type: 'usage', mode: 'project', workKind: 'code', outcome: 'success', model: 'mm/gemini-2.5-flash'},
      {id: '2', type: 'correction', mode: 'chat', mistakeKind: 'verification_gap', summary: '在「唠嗑模式」中未核实即回复'},
    ],
  };

  for (const pub of [pair.publicKeyDerBase64, pair.publicKeyPem]) {
    const envelope = encryptFeedbackEnvelope(payload, pub);
    assert.equal(envelope.v, 1);
    const wire = JSON.stringify(envelope);
    assert.doesNotMatch(wire, /gemini-2\.5-flash|verification_gap|唠嗑模式|project/);
    const decoded = decryptFeedbackEnvelope(envelope, pair.privateKeyPem);
    assert.deepEqual(decoded, payload);
  }
});

test('wrong key or tampered ciphertext fails decryption', () => {
  const pairA = generateFeedbackKeypair();
  const pairB = generateFeedbackKeypair();
  const envelope = encryptFeedbackEnvelope({hello: 'world'}, pairA.publicKeyDerBase64);

  assert.throws(() => decryptFeedbackEnvelope(envelope, pairB.privateKeyPem));

  const tamperedCt = {...envelope, ct: Buffer.from('tampered-ciphertext').toString('base64')};
  assert.throws(() => decryptFeedbackEnvelope(tamperedCt, pairA.privateKeyPem));

  const badAlg = {...envelope, alg: 'none'};
  assert.throws(() => decryptFeedbackEnvelope(badAlg, pairA.privateKeyPem));
});

test('read.mjs keygen refuses writing inside a git repo unless forced, and protects against accidental overwrite', () => {
  const repoDir = path.resolve(import.meta.dirname, '..');
  assert.throws(() => runKeygen(['--out-dir', path.join(repoDir, 'tmp-keys')]), /Git 仓库/);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-keygen-'));
  const first = runKeygen(['--out-dir', outDir]);
  assert.ok(fs.existsSync(first.privFile));
  assert.ok(fs.existsSync(first.pubFile));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(first.privFile).mode & 0o777, 0o600);
  }
  assert.throws(() => runKeygen(['--out-dir', outDir]), /已存在/);
});

test('read.mjs decrypts encrypted batch files and generates summary Markdown + HTML reports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-read-'));
  const pair = generateFeedbackKeypair();
  const batch1 = encryptFeedbackEnvelope({
    schema: 1,
    records: [
      {
        id: 'u1', type: 'usage', at: '2026-11-18T02:00:00.000Z', appVersion: '2.5.49',
        channel: 'release', platform: 'darwin', arch: 'arm64', mode: 'project',
        workKind: 'code', tools: ['read', 'edit', 'exec'], failedTools: [], outcome: 'success',
        durationMs: 4000, model: 'mm/gemini-2.5-flash',
      },
      {
        id: 'u2', type: 'usage', at: '2026-11-18T03:00:00.000Z', appVersion: '2.5.49',
        channel: 'release', platform: 'win32', arch: 'x64', mode: 'learning',
        workKind: 'tutoring', tools: ['read'], failedTools: ['read'], outcome: 'error',
        errorKind: 'timeout', durationMs: 8000, model: 'openai/gpt-5',
      },
      {
        id: 'c1', type: 'correction', at: '2026-11-18T03:05:00.000Z', appVersion: '2.5.49',
        channel: 'release', platform: 'darwin', arch: 'arm64', mode: 'project',
        prevWorkKind: 'code', mistakeKind: 'verification_gap', correctionDirection: 'verify_before_claim',
        summary: '在「项目模式 · 写代码 / 改程序」中出现「未实际核验即声称完成或结果仍出错」，用户要求「先实际运行或核对结果再回复」。',
      },
    ],
  }, pair.publicKeyDerBase64);

  fs.mkdirSync(path.join(dir, 'reports/2026-11-18'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'reports/2026-11-18/batch1.enc.json'), JSON.stringify(batch1));
  fs.writeFileSync(path.join(dir, 'reports/2026-11-18/corrupt.enc.json'), '{not-json');

  const decrypted = decryptRecordsFromDir(dir, pair.privateKeyPem);
  assert.equal(decrypted.fileCount, 2);
  assert.equal(decrypted.batchCount, 1);
  assert.equal(decrypted.failedFiles, 1);
  assert.equal(decrypted.records.length, 3);

  const stats = aggregateFeedback(decrypted.records);
  assert.equal(stats.usageCount, 2);
  assert.equal(stats.correctionCount, 1);
  assert.equal(stats.byVersion[0].key, '2.5.49');
  assert.equal(stats.byMistake[0].key, 'verification_gap');

  const md = renderMarkdownReport(stats, decrypted);
  assert.match(md, /超級碧琪 · 改进反馈汇总报告/);
  assert.match(md, /2\.5\.49/);
  assert.match(md, /项目模式/);
  assert.match(md, /未实际核验即声称完成/);

  const html = renderHtmlReport(stats, decrypted);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /超级碧琪|超級碧琪/);
  assert.match(html, /未实际核验即声称完成/);

  // 端到端通过 CLI 执行 tools/feedback/read.mjs
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-cli-key-'));
  const privFile = path.join(keyDir, 'priv.pem');
  fs.writeFileSync(privFile, pair.privateKeyPem, {mode: 0o600});
  const mdOut = path.join(keyDir, 'report.md');
  const htmlOut = path.join(keyDir, 'report.html');
  const cliScript = path.resolve(import.meta.dirname, '../tools/feedback/read.mjs');
  const stdout = execFileSync(process.execPath, [
    cliScript, '--dir', dir, '--key', privFile, '--out', mdOut, '--html', htmlOut,
  ], {encoding: 'utf8'});
  assert.match(stdout, /超級碧琪 · 改进反馈汇总报告/);
  assert.ok(fs.existsSync(mdOut));
  assert.ok(fs.existsSync(htmlOut));
});
