import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const anchor = 'import { fileURLToPath } from "node:url";';
const prelude = `\n\n// pinkie-wechat-login-isolation-v1\nif (process.argv.length === 6 && process.argv[2] === "channels" && process.argv[3] === "login"\n  && process.argv[4] === "--channel" && process.argv[5] === "openclaw-weixin"\n  && process.env.NO_COLOR === "1" && !process.stdin.isTTY && !process.stdout.isTTY\n  && process.env.PINKIE_WECHAT_LOGIN_ISOLATED !== "1") {\n  const { isolateLegacyWechatCliLogin } = await import("../../services/wechat-connect/legacy-cli-isolation.mjs");\n  isolateLegacyWechatCliLogin();\n}\n`;

export function adaptCliLauncher(source) {
  if (source.includes('pinkie-wechat-login-isolation-v1')) {
    if (!source.includes(anchor + prelude)) throw new Error('Existing CLI isolation patch changed; refusing overwrite');
    return source;
  }
  if (source.split(anchor).length !== 2 || !source.startsWith('#!/usr/bin/env node\n')) {
    throw new Error('Unknown CLI launcher; refusing overwrite');
  }
  return source.replace(anchor, anchor + prelude);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file || !/[/\\]runtime[/\\]openclaw[/\\]openclaw\.mjs$/.test(file)) throw new Error('Expected the installed App OpenClaw launcher');
  const before = fs.readFileSync(file, 'utf8');
  const after = adaptCliLauncher(before);
  if (before !== after) fs.writeFileSync(file, after);
}
