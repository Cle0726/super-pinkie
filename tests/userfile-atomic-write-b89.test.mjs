// B89（自选普查：services/ 直接覆盖写）：写到一半出错（磁盘满、进程被杀）时，原文件不能被截断。
// 反例做法：把 fs.writeFileSync 换成「对目标文件只写进去一半，然后抛 ENOSPC」，看原文件还在不在。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LongTermMemoryStore} from '../services/mode-architecture/memory.mjs';
import {QuietMode} from '../services/mode-architecture/quiet-mode.mjs';

// 名字里带 marker 的写入（目标文件本身或它旁边的临时文件）写一半就抛 ENOSPC，其余照常。
function failHalfway(t, marker) {
  const real = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', function (file, data, options) {
    if (typeof file === 'string' && path.basename(file).includes(marker)) {
      const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      real.call(fs, file, text.slice(0, Math.floor(text.length / 2)));
      throw Object.assign(new Error(`ENOSPC: no space left on device, write '${file}'`), {code: 'ENOSPC'});
    }
    return real.call(fs, file, data, options);
  });
  return () => t.mock.restoreAll();
}

test('B89：改称呼时写 USER.md 写到一半出错，用户原来的 USER.md 一字不少，也不留临时文件', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'b89-user-'));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const root = path.join(home, '.openclaw/workspace');
  fs.mkdirSync(path.join(root, 'memory'), {recursive: true});
  const memory = new LongTermMemoryStore({home, stateRoot: path.join(home, 'state'), now: () => 1_900_000_000_000});
  const ctx = {mode: 'chat', agentId: 'main', sessionKey: 'agent:main:main', workspaceDir: root};
  const userFile = path.join(root, 'USER.md');
  const original = '# USER.md - About Your Human\n\n- **Name:** 明\n- **What to call them:** 小明\n\n## 我自己写的笔记\n'
    + '喜欢简短的回答，周末不谈工作。\n'.repeat(40);
  fs.writeFileSync(userFile, original);

  const restore = failHalfway(t, 'USER.md');
  memory.captureExplicit(ctx, '以后叫我阿明');
  restore();

  assert.equal(fs.readFileSync(userFile, 'utf8'), original, '写一半出错后 USER.md 被截断了');
  assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith('.tmp')), [], '留下了临时文件');

  // 不出错时照常改那一行，其余内容不动。
  memory.captureExplicit(ctx, '以后叫我阿明');
  const after = fs.readFileSync(userFile, 'utf8');
  assert.match(after, /What to call them:\*\* 阿明/);
  assert.equal(after, original.replace('小明', '阿明'));
});

test('B89：安静模式偏好写到一半出错，存盘的旧偏好还读得回来', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b89-quiet-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'quiet-mode.json');
  const q = new QuietMode({file});
  q.setPrefs({pauseChannels: true});
  assert.equal(new QuietMode({file}).prefs.pauseChannels, true);

  const restore = failHalfway(t, 'quiet-mode.json');
  q.setPrefs({pauseChannels: false});
  restore();

  assert.equal(new QuietMode({file}).prefs.pauseChannels, true, '写一半出错后偏好文件坏了，读回默认值');
  assert.deepEqual(fs.readdirSync(dir).filter(name => name !== 'quiet-mode.json'), [], '留下了临时文件');

  q.setPrefs({pauseChannels: false});
  assert.equal(new QuietMode({file}).prefs.pauseChannels, false);
});
