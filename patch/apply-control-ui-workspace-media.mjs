/**
 * Makes Control UI's browser-side attachment preflight agree with the
 * server-side local-media boundary.
 *
 * The gateway correctly decides whether it can issue a ticket, but the chat
 * bundle rejects an absolute path before that request when the path is outside
 * its stale browser allowlist. Extend preflight to ordinary user-home files so
 * generated project files can be opened. The native bridge still verifies the
 * real file and sensitive paths after a click; this patch does not read bytes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const marker = "/* pinkie-control-ui-workspace-media:v2 */";
const previousInjected = '/* pinkie-control-ui-workspace-media:v1 */function laolaoWorkspaceMediaPathAllowed(e){let t=IS(e);if(!t)return!1;t=RS(t);return/^(?:\\/Users\\/[^/]+|\\/home\\/[^/]+|[a-z]:\\/Users\\/[^/]+)\\/.openclaw\\/workspace(?:-[a-z0-9][a-z0-9._-]*)?(?:\\/|$)/i.test(t)}function zS(e,t){if(FS(e)||laolaoWorkspaceMediaPathAllowed(e))return!0;';
const needle = "function zS(e,t){if(FS(e))return!0;";
const injected = `${marker}function laolaoHomeMediaPathAllowed(e){let t=IS(e);if(!t)return!1;t=RS(t);const n=t.toLowerCase();if(/(?:^|\\/)\\.ssh(?:\\/|$)|\\/library\\/keychains(?:\\/|$)/i.test(n))return!1;const o=n.match(/\\/\\.openclaw(?:\\/([^/]+))?/i);if(o&&!/^workspace(?:-[a-z0-9][a-z0-9._-]*)?$/.test(o[1]||""))return!1;return/^(?:\\/Users\\/[^/]+|\\/home\\/[^/]+|[a-z]:\\/Users\\/[^/]+)\\/.+$/i.test(t)}function zS(e,t){if(FS(e)||laolaoHomeMediaPathAllowed(e))return!0;`;

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) {
    throw new Error("Control UI 图片预检代码结构已变化，未覆盖: " + from);
  }
  return text.replace(from, to);
}

export function transform(original) {
  if (original.includes(marker)) return original;
  if (original.includes(previousInjected)) return original.replace(previousInjected, injected);
  return replaceOnce(original, needle, injected);
}

export function apply(root, { backupRoot } = {}) {
  const assets = path.join(root, "dist", "control-ui", "assets");
  const candidates = fs.readdirSync(assets).filter((name) => /^chat-page-[\w-]+\.js$/.test(name));
  if (candidates.length !== 1) {
    throw new Error("无法唯一确认 Control UI chat-page 模块: " + candidates.join(", "));
  }
  const file = path.join(assets, candidates[0]);
  const original = fs.readFileSync(file, "utf8");
  const next = transform(original);
  if (next === original) return { changed: false, file: candidates[0] };

  if (fs.readFileSync(file, "utf8") !== original) {
    throw new Error("Control UI chat-page 模块正在被更新，未覆盖");
  }
  const backup = backupRoot || path.join(
    os.homedir(),
    "Library/Application Support/SuperPinkie/backups",
    "control-ui-workspace-media-" + Date.now()
  );
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  fs.copyFileSync(file, path.join(backup, candidates[0]));
  fs.writeFileSync(file, next);
  return { changed: true, backup, file: candidates[0] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error("无法找到 OpenClaw 包目录，请明确设置 OPENCLAW_ROOT");
  console.log(JSON.stringify(apply(root, {
    backupRoot: process.env.PINKIE_PATCH_BACKUP_ROOT || undefined,
  })));
}
