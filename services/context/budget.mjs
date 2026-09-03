/** Shared relative policy for native OpenClaw compaction; ultra-long retention mode. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function compactionBudget(window) {
  let policy = {};
  try {
    policy = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/SuperPinkie/context-policy.json'), 'utf8'));
  } catch {}

  // 所有模式使用同一条硬边界：实际窗口到 85% 才允许压缩。
  const ratio = 0.85;
  // 已知模型必须尊重它声明的真实最大窗口，不能把 128K 假装成 500K；
  // 只有完全未知时才使用本机配置的一百万 fallback。
  const fallback = Number.isFinite(policy.unknownContextWindow) && policy.unknownContextWindow > 0
    ? Math.floor(policy.unknownContextWindow) : 1000000;
  const tokens = Number.isFinite(window) && window > 0 ? Math.floor(window) : fallback;
  // 放宽 keepRecentRatio 限制，允许高达 0.95，默认 0.85（保留绝大部分历史）
  const keepRatio = Number.isFinite(policy.keepRecentRatio) && policy.keepRecentRatio >= 0.05 && policy.keepRecentRatio <= 0.98 ? policy.keepRecentRatio : 0.85;
  const threshold = Math.max(1, Math.floor(tokens * ratio));
  const requestedKeep = Math.max(1, Math.floor(tokens * keepRatio));
  // 保留用户设定的高留存偏好，但压缩结果必须比触发线至少低 5%，
  // 否则 85% 触发后会立刻再次压缩，甚至来不及生成下一段回复。
  const workingHeadroom = Math.max(1024, Math.floor(tokens * 0.05));
  const keepRecent = Math.min(requestedKeep, Math.max(1, threshold - workingHeadroom));

  return {
    window: tokens,
    threshold: threshold,
    reserve: tokens - threshold,
    keepRecent
  };
}
