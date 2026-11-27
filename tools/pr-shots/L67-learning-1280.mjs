#!/usr/bin/env node
// L67（#96）B11 学习模式整页走查：在 main 上按 1280 / 820 × 日 / 夜 重拍学习模式各页。
// 只是给 b11-learning-walkthrough.mjs 换宽度（默认 1440 / 820），量法、页面、report.json 格式完全相同。
// 用法同 minimal.mjs：node tools/pr-shots/L67-learning-1280.mjs --out <目录>（经 .github/workflows/pr-shots.yml 跑，本机不开浏览器）。
process.env.PINKIE_WALK_WIDTHS = process.env.PINKIE_WALK_WIDTHS || '1280,820';
await import('./b11-learning-walkthrough.mjs');
