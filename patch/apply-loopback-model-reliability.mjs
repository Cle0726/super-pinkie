/** Disable SDK-level duplicate retries for loopback model relays.
 *
 * Local relays already own their retry/fallback policy. Letting the OpenAI SDK
 * retry the entire relay request again can multiply a bounded recovery window
 * into several minutes while the UI correctly remains busy. Explicit runtime
 * maxRetries still wins; remote providers retain their upstream defaults.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const marker = '/* pinkie-loopback-model-reliability:v1 */';
const originalRetry = '...options?.maxRetries !== void 0 ? { maxRetries: options.maxRetries } : {}';
const loopbackRetry = `${marker}\n\t\t\t\t...options?.maxRetries !== void 0 ? { maxRetries: options.maxRetries } : /^https?:\\/\\/(?:127(?:\\.\\d{1,3}){3}|localhost|\\[::1\\])(?::|\\/|$)/i.test(String(model.baseUrl || "")) ? { maxRetries: 0 } : {}`;

export function transform(source) {
  if (source.includes(marker)) return source;
  const matches = source.split(originalRetry).length - 1;
  if (matches !== 1) {
    throw new Error(`OpenClaw 模型传输代码结构已变化，未覆盖（maxRetries matches=${matches}）`);
  }
  return source.replace(originalRetry, loopbackRetry);
}

export function apply(root, {backupRoot} = {}) {
  const dist = path.join(root, 'node_modules', '@openclaw', 'ai', 'dist');
  if (!fs.existsSync(dist)) throw new Error(`缺少 @openclaw/ai 运行时：${dist}`);
  const candidates = fs.readdirSync(dist)
    .filter((name) => /^openai-completions-[^.]+\.mjs$/.test(name));
  const targets = candidates.filter((name) => {
    const source = fs.readFileSync(path.join(dist, name), 'utf8');
    return source.includes(marker) || source.includes(originalRetry);
  });
  if (targets.length !== 1) {
    throw new Error(`无法唯一确认 OpenAI completions 传输模块：${targets.join(', ') || 'none'}`);
  }
  const file = path.join(dist, targets[0]);
  const original = fs.readFileSync(file, 'utf8');
  const next = transform(original);
  if (next === original) return {changed: false, file: targets[0]};
  const backup = backupRoot || path.join(
    os.homedir(),
    process.platform === 'win32' ? 'AppData/Local/SuperPinkie/backups' : 'Library/Application Support/SuperPinkie/backups',
    `loopback-model-reliability-${Date.now()}`,
  );
  fs.mkdirSync(backup, {recursive: true, mode: 0o700});
  fs.copyFileSync(file, path.join(backup, path.basename(file)));
  if (fs.readFileSync(file, 'utf8') !== original) throw new Error('模型传输模块正在被更新，未覆盖');
  fs.writeFileSync(file, next);
  return {changed: true, backup, file: targets[0]};
}

function resolveRoot() {
  if (process.env.OPENCLAW_ROOT) return process.env.OPENCLAW_ROOT;
  const command = process.platform === 'win32' ? 'where' : 'which';
  const entries = execFileSync(command, ['openclaw'], {encoding: 'utf8'}).trim().split(/\r?\n/);
  for (const entry of entries) {
    const dir = path.dirname(fs.realpathSync(entry));
    const root = [dir, path.join(dir, 'node_modules', 'openclaw')]
      .find((candidate) => fs.existsSync(path.join(candidate, 'dist')));
    if (root) return root;
  }
  throw new Error('无法找到 OpenClaw 包目录，请明确设置 OPENCLAW_ROOT');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(apply(resolveRoot(), {
    backupRoot: process.env.PINKIE_PATCH_BACKUP_ROOT || undefined,
  })));
}
