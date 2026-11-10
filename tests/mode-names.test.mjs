// 模式统一叫 学习 / 项目 / 无限；旧名「习作 / 营造 / 挥洒」不再出现在用户看得到的服务文字里。
// index.mjs 归计划书 A（合并后再改），setup.py 里生成人格文件的模板由 Fable 负责，先不查。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('services and the UI use the current mode names', () => {
  const run = spawnSync('git', ['grep', '-n', '-E', '习作|营造|挥洒', '--', 'services', 'ui',
    ':!services/mode-architecture/index.mjs', ':!services/mode-architecture/setup.py',
    // 微信适配器要认得改名前已经打过补丁的发布包，那一行里的旧名是用来比对的。
    ':!services/wechat-connect/apply-weixin-adapter.mjs'], {encoding: 'utf8'});
  assert.equal(run.stdout.trim(), '');
});
