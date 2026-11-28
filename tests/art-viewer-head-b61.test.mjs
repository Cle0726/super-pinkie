// B61（backlog，uireview #281 03:08Z 记）：窗口 560 宽时作品库查看器头部比纸面宽（scrollWidth 590 > clientWidth 494），
// 文件名缩成 0、× 被挤出纸面右边。头部（laolao-artifacts.js openViewer）是一行不换行的 flex：文件名、版本条、操作键都 nowrap。
// 修法在 laolao-artifacts.css 末尾：窗口窄于 780 时头部换行，操作键另起一行靠右。820 / 1440 不变。
// 真浏览器里加载真的 laolao-artifacts.css + laolao-metre-skin.css，照 openViewer 的结构搭头部，量 scroll / client、× 和文件名。
// 反例：页面上删掉这条新规则，560 又溢出。另量带「装到桌面」（laolao-desktop-apps.js 插在最前）时 780 / 820 不换行也放得下。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {playwright} from '../tools/study-desk/harness.mjs';

const read = (f) => fs.readFileSync(fileURLToPath(new URL(`../ui/injections/${f}`, import.meta.url)), 'utf8');
const artifacts = read('laolao-artifacts.css');
const skin = read('laolao-metre-skin.css');
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const launch = () => playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
const RULE = '@media (max-width: 779px)';

const page = (mode, install) => `<!doctype html><html ${mode === 'metre' ? 'data-laolao-mode="metre"' : ''}><head></head><body style="margin:0">
<div class="pinkie-art-viewer"><div class="pinkie-art-view"><header class="pinkie-art-view__head"><strong class="pinkie-art-view__title">weekly.md</strong>
<div class="pinkie-art-versions"><span class="pinkie-art-versions__label">版本 1 / 2</span><button class="pinkie-art-ver">‹</button><button class="pinkie-art-ver">›</button><span class="pinkie-art-versions__dot">·</span><button class="pinkie-art-restore">恢复这个版本</button></div>
<div class="pinkie-art-view__actions">${install ? '<button class="pinkie-art-btn pk-apps-install">装到桌面</button>' : ''}<button class="pinkie-art-btn">打开</button><button class="pinkie-art-btn">在文件夹中显示</button><button class="pinkie-art-btn pinkie-art-btn--quiet">从作品库移除</button><button class="pinkie-art-close">×</button></div>
</header><div class="pinkie-art-view__body"></div></div></div></body></html>`;

const measure = (p) => p.evaluate(() => {
  const view = document.querySelector('.pinkie-art-view').getBoundingClientRect();
  const head = document.querySelector('.pinkie-art-view__head');
  const close = head.querySelector('.pinkie-art-close').getBoundingClientRect();
  const title = head.querySelector('.pinkie-art-view__title').getBoundingClientRect();
  return {scroll: head.scrollWidth, client: head.clientWidth, height: Math.round(head.getBoundingClientRect().height),
    closeInside: close.width > 0 && close.right <= view.right + 0.5 && close.left >= view.left - 0.5, titleWidth: Math.round(title.width)};
});

test(`B61: gallery viewer header fits the panel at narrow widths and is unchanged at 820 / 1440 (${engine})`, {timeout: 90_000}, async () => {
  assert.ok(artifacts.includes(RULE), '找不到 B61 那条规则');
  const rule = artifacts.slice(artifacts.indexOf(RULE));
  assert.doesNotMatch(rule.slice(0, rule.indexOf('} }') + 3), /!\s*important/, '不加强制覆盖');
  const browser = await launch();
  try {
    const tab = await browser.newPage({viewport: {width: 420, height: 900}});
    try {
      const at = async (mode, width, {install = false, css = artifacts} = {}) => {
        await tab.setViewportSize({width, height: 900});
        await tab.setContent(page(mode, install));
        await tab.addStyleTag({content: css});
        await tab.addStyleTag({content: skin});
        return await measure(tab);
      };
      for (const mode of ['default', 'metre']) {
        for (const width of [420, 560, 600, 779]) {
          for (const install of [false, true]) {
            const m = await at(mode, width, {install});
            const where = `${mode} ${width}${install ? ' 带「装到桌面」' : ''}`;
            assert.ok(m.scroll <= m.client, `${where}：头部不该比纸面宽（${m.scroll} > ${m.client}）`);
            assert.ok(m.closeInside, `${where}：× 要在纸面里`);
            assert.ok(m.titleWidth >= 40, `${where}：文件名不该被挤成 ${m.titleWidth}px`);
          }
        }
        // 780 起不换行：一行放得下、× 在纸面里（780 带「装到桌面」时文件名按设计省略成 30 多 px，只在 820 / 1440 量文件名宽）
        for (const width of [780, 820, 1440]) {
          for (const install of [false, true]) {
            const m = await at(mode, width, {install});
            const where = `${mode} ${width}${install ? ' 带「装到桌面」' : ''}`;
            assert.ok(m.scroll <= m.client && m.closeInside, `${where}：一行要放得下（${JSON.stringify(m)}）`);
            if (width >= 820) assert.ok(m.titleWidth >= 40, `${where}：文件名不该被挤成 ${m.titleWidth}px`);
            assert.ok(m.height < 60, `${where}：宽窗不换行，头部还是一行（高 ${m.height}）`);
          }
        }
        // 反例：只删掉 B61 那段 @media，560 又溢出、× 出纸面
        const end = artifacts.indexOf('} }', artifacts.indexOf(RULE)) + 3;
        const without = await at(mode, 560, {css: artifacts.slice(0, artifacts.indexOf(RULE)) + artifacts.slice(end)});
        assert.ok(without.scroll > without.client && !without.closeInside, `${mode}：删掉规则后 560 应该又溢出（${JSON.stringify(without)}）`);
      }
    } finally { await tab.close(); }
  } finally {
    await browser.close();
  }
});
