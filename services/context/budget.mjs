/** Shared relative policy for native OpenClaw compaction; ultra-long retention mode. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function compactionBudget(window) {
  let policy = {};
  try {
    policy = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/SuperPinkie/context-policy.json'), 'utf8'));
  } catch {}

  // 放宽 triggerRatio 限制，允许高达 0.98，默认 0.95
  const ratio = Number.isFinite(policy.triggerRatio) && policy.triggerRatio >= 0.3 && policy.triggerRatio <= 0.99 ? policy.triggerRatio : 0.95;
  // 最小窗口保底 500,000
  const floor = Number.isFinite(policy.minWindowTokens) && policy.minWindowTokens >= 32768 ? Math.floor(policy.minWindowTokens) : 500000;
  const resolved = Number.isFinite(window) && window > 0 ? Math.floor(window) : 1000000;
  const tokens = Math.max(resolved, floor);
  // 放宽 keepRecentRatio 限制，允许高达 0.95，默认 0.85（保留绝大部分历史）
  const keepRatio = Number.isFinite(policy.keepRecentRatio) && policy.keepRecentRatio >= 0.05 && policy.keepRecentRatio <= 0.98 ? policy.keepRecentRatio : 0.85;
  const threshold = Math.max(1, Math.floor(tokens * ratio));

  return {
    window: tokens,
    threshold: threshold,
    reserve: tokens - threshold,
    keepRecent: Math.max(1, Math.floor(tokens * keepRatio))
  };
}
