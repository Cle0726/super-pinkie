// write / edit 遇到 no-op（写入内容与原文件相同、oldText 与 newText 相同）时，
// OpenClaw 2026.7.1 的工具结果带 terminate: true。一批工具结果全是 terminate 时
// agent 循环直接结束（proxy 的 shouldTerminateToolBatch），不再发下一次模型请求；
// 会话最后一条是 stopReason=toolUse、没有最终文字的助手消息，embedded-agent 判成
// incomplete turn，用户看到空回复。
// 这里只去掉三处 no-op 结果上的 terminate，提示文字原样保留：模型照常收到
// 「No changes made …」后继续回复。真正写入和报错路径本来就不带 terminate。
// 内核去掉这三处 terminate 后此补丁可退役。

export const marker = '/* pinkie-noop-write-continue:v1 */';

const site = (tabs, tail) => {
  const result = `${tabs}...textResult(\`No changes made to \${path}. ${tail}\`, void 0)`;
  return [`${result},\n${tabs}terminate: true\n`, `${result} ${marker}\n`];
};

export const SITES = [
  site('\t\t\t\t\t\t', 'The replacement text is identical to the original.'),
  site('\t\t\t\t\t\t', 'The replacement produced identical content.'),
  site('\t\t\t\t\t', 'The file already has identical content.'),
];

export function transform(source) {
  if (source.includes(marker)) return {changed: false, reason: 'already-patched', text: source};
  let text = source;
  for (const [from, to] of SITES) {
    if (text.split(from).length !== 2) return {changed: false, reason: 'unsupported-runtime', text: source};
    text = text.replace(from, () => to);
  }
  return {changed: true, reason: 'patched', text};
}

// CLI: OPENCLAW_ROOT=<openclaw package> node patch/apply-noop-write-continue.mjs
import {applyDist as pinkieApplyDist} from './lib-apply-dist.mjs';
import {fileURLToPath as pinkieFileURL} from 'node:url';
import pinkiePath from 'node:path';
if (process.argv[1] && pinkiePath.resolve(process.argv[1]) === pinkieFileURL(import.meta.url)) {
  if (!process.env.OPENCLAW_ROOT) throw new Error('Set OPENCLAW_ROOT to the active OpenClaw package');
  console.log(JSON.stringify(pinkieApplyDist(process.env.OPENCLAW_ROOT, 'noop-write-continue', [transform])));
}
