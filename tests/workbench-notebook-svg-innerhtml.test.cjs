// P1 innerHTML 普查（#96 linux2）PR ②：工作台笔记本 SVG 输出的复发测试。
// laolao-workbench-notebook.js 渲染 .ipynb 的 `image/svg+xml` 输出时，原来直接 `wrap.innerHTML = svg`。
// 别人给的 notebook 里，SVG 输出可以带 <script>、<foreignObject>、onload 这类东西，打开就会进页面 DOM。
// 修法：SVG 编码成 data: URL 放进 <img>，图片上下文里的 SVG 不执行脚本、不加载外链。
// 这里用假 DOM 跑真文件，经 window.__pinkieNotebook.render 渲染，检查没有任何节点被写过 innerHTML。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-workbench-notebook.js'), 'utf8');

function el(tag = 'div') {
  const node = {
    tagName: tag.toUpperCase(), className: '', textContent: '', value: '', src: '', alt: '', type: '', title: '',
    disabled: false, rows: 0, spellcheck: true, dataset: {}, children: [], innerHTMLWrites: [],
    set innerHTML(v) { this.innerHTMLWrites.push(String(v)); },
    get innerHTML() { return this.innerHTMLWrites.at(-1) || ''; },
    setAttribute() {}, addEventListener() {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    querySelectorAll() { return []; },
  };
  return node;
}

function walk(node, out = []) {
  out.push(node);
  for (const child of node.children || []) if (child && typeof child === 'object') walk(child, out);
  return out;
}

function renderNotebook(outputs) {
  const window = {dispatchEvent() {}};
  const document = {createElement: (tag) => el(tag)};
  vm.runInNewContext(source, {window, document, CustomEvent: function () {}, setTimeout: () => 1, console});
  const host = el('div');
  window.__pinkieNotebook.render(host, {path: 'shared/evil.ipynb', cells: [{cellType: 'code', source: 'plot()', outputs}]});
  return walk(host);
}

const SVG_ATTACK = '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwnedSvg=1"><script>window.__pwnedScript=1</script>'
  + '<foreignObject><img src=x onerror="window.__pwnedImg=1"></foreignObject><circle r="4"/></svg>';

test('notebook 的 SVG 输出不再写进 innerHTML，改成 <img> 的 data: URL', () => {
  const nodes = renderNotebook([{output_type: 'display_data', data: {'image/svg+xml': SVG_ATTACK}}]);
  const writes = nodes.flatMap((n) => n.innerHTMLWrites);
  assert.deepEqual(writes, [], 'SVG 输出不应写进任何节点的 innerHTML');
  const wrap = nodes.find((n) => n.className === 'pk-nb-svg');
  assert.ok(wrap, 'SVG 输出区照常挂上');
  const img = wrap.children.find((n) => n.tagName === 'IMG');
  assert.ok(img, 'SVG 放进 <img>，图片上下文不执行脚本');
  assert.ok(img.src.startsWith('data:image/svg+xml;charset=utf-8,'), 'src 是 SVG 的 data: URL');
  assert.equal(decodeURIComponent(img.src.slice('data:image/svg+xml;charset=utf-8,'.length)), SVG_ATTACK, 'SVG 内容原样编码，不丢字符');
  assert.ok(!/[<>"]/.test(img.src), 'data: URL 里尖括号和引号都已编码');
});

test('nbformat 多行数组形式的 SVG 按原样拼接；PNG / 纯文本输出不受影响', () => {
  const lines = ['<svg xmlns="http://www.w3.org/2000/svg">\n', '<rect width="2" height="2"/>\n', '</svg>'];
  const nodes = renderNotebook([
    {output_type: 'execute_result', data: {'image/svg+xml': lines, 'text/plain': ['<Figure ', 'size 2x2>']}},
    {output_type: 'display_data', data: {'image/png': 'iVBORw0KGgo='}},
  ]);
  const svgImg = nodes.find((n) => n.tagName === 'IMG' && n.src.startsWith('data:image/svg+xml'));
  assert.equal(decodeURIComponent(svgImg.src.split(',').slice(1).join(',')), lines.join(''), '数组形式按 join("") 拼回，不是逗号分隔');
  const result = nodes.find((n) => n.className === 'pk-nb-result');
  assert.equal(result.textContent, '<Figure size 2x2>', 'text/plain 照常按纯文本显示');
  const png = nodes.find((n) => n.className === 'pk-nb-image');
  assert.equal(png.src, 'data:image/png;base64,iVBORw0KGgo=', 'PNG 输出照旧');
  assert.deepEqual(nodes.flatMap((n) => n.innerHTMLWrites), []);
});
