#!/usr/bin/env node
/**
 * web_fetch under a fake-IP proxy (tools-health-1113 A1).
 *
 * Clash-style "fake-ip" DNS hands every public host two benchmark addresses:
 * IPv4 198.18.0.0/15 and IPv6 2001:2::/48 (www.sohu.com -> 198.18.0.16 and
 * 2001:2::e). The existing switch tools.web.fetch.ssrfPolicy
 * .allowRfc2544BenchmarkRange only lets the IPv4 half through; the IPv6 half
 * is still "benchmarking" special-use, so resolvePinnedHostnameWithPolicy
 * throws "Blocked: resolves to private/internal/special-use IP address" and
 * every web_fetch failed (Mac 9/9 on 11-13; reproduced on Windows against
 * the unpatched 2026.7.1-2 ssrf module the same day).
 *
 * 2001:2::/48 is the IPv6 twin of 198.18.0.0/15 (RFC 5180 benchmarking), so
 * the same switch now covers both. No new config key (2.5.36: an unknown key
 * kept the gateway from starting). Every other private / loopback /
 * link-local / unique-local range stays blocked.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const marker = "/* pinkie-web-fetch-fakeip-v6:v1 */";

const ipv4Line = /(\n([ \t]*)if \(isIpv4Address\(strictIp\)\) return isBlockedSpecialUseIpv4Address\(strictIp, blockOptions\);\n)/u;

export function transform(original) {
  if (original.includes(marker)) return original;
  const start = original.indexOf("function isPrivateIpAddress(");
  if (start < 0) throw new Error("没有找到 isPrivateIpAddress，运行时结构已变化，未覆盖");
  const end = original.indexOf("\n}\n", start);
  const body = original.slice(start, end);
  const match = body.match(ipv4Line);
  if (!match || body.split(match[1]).length !== 2) throw new Error("isPrivateIpAddress 结构已变化，未覆盖");
  const indent = match[2];
  const allow = `${indent}${marker} if (blockOptions.allowRfc2544BenchmarkRange === true && Array.isArray(strictIp.parts) && strictIp.parts[0] === 0x2001 && strictIp.parts[1] === 0x0002 && strictIp.parts[2] === 0) return false;\n`;
  const next = body.replace(match[1], match[1] + allow);
  return original.slice(0, start) + next + original.slice(end);
}

export function findTarget(root) {
  const dist = path.join(root, "dist");
  const hits = fs.readdirSync(dist)
    .filter((n) => /^ssrf-[^.]+\.m?js$/u.test(n))
    .filter((n) => fs.readFileSync(path.join(dist, n), "utf8").includes("function isPrivateIpAddress("));
  if (hits.length !== 1) throw new Error("无法唯一确认 ssrf 模块: " + hits.join(", "));
  return path.join(dist, hits[0]);
}

export function apply(root, {backupRoot} = {}) {
  const file = findTarget(root);
  const original = fs.readFileSync(file, "utf8");
  const next = transform(original);
  if (next === original) return {changed: false, file: path.basename(file)};
  const backup = backupRoot || path.join(process.env.PINKIE_STATE_ROOT
    || path.join(os.homedir(), process.platform === "win32" ? "AppData/Local/SuperPinkie" : "Library/Application Support/SuperPinkie"),
  "backups", `web-fetch-fakeip-v6-${Date.now()}`);
  fs.mkdirSync(backup, {recursive: true});
  fs.copyFileSync(file, path.join(backup, path.basename(file)));
  fs.writeFileSync(file, next);
  return {changed: true, file: path.basename(file), backup};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.OPENCLAW_ROOT;
  if (!root) throw new Error("请设置 OPENCLAW_ROOT");
  console.log(JSON.stringify(apply(root, {backupRoot: process.env.PINKIE_PATCH_BACKUP_ROOT || undefined})));
}
