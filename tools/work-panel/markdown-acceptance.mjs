// Exercise the installed/staged native Markdown module in its real browser graph.
// No gateway, user session, or production window is opened or modified.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {patchSource} from '../../patch/apply-chat-linebreaks.mjs';

const root=process.env.PINKIE_CONTROL_UI_ROOT || '/Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui';
const out=process.env.PINKIE_WORK_OUTPUT || path.join(os.tmpdir(),'pinkie-markdown-acceptance');
fs.mkdirSync(out,{recursive:true});
const assets=path.join(root,'assets');
const name=fs.readdirSync(assets).find(file=>/^markdown-[\w-]+\.js$/.test(file)&&fs.readFileSync(path.join(assets,file),'utf8').includes('markdown-plain-text-fallback'));
if(!name)throw Error('Native Markdown module not found');
let source=fs.readFileSync(path.join(assets,name),'utf8');
if(process.argv.includes('--patch')){const result=patchSource(source);if(result.changed)source=result.out;else assert.equal(result.reason,'already patched');}
const parser=/var ([\w$]+)=new [\w$]+\(\{html:!0,breaks:!0,linkify:!0\}\)/u.exec(source)?.[1];
assert.ok(parser,'Native Markdown parser boundary');
// This export exists only in this loopback test server, never in the App file.
source+='\nexport {'+parser+' as __testParser};';
const sample=process.env.PINKIE_MARKDOWN_FIXTURE ? fs.readFileSync(process.env.PINKIE_MARKDOWN_FIXTURE,'utf8') : [
  '### 判题结果：一对一错',
  '提交的答案是：**B，C**',
  '- **第 1 题** ✅ **答对了！** `take advantage of`（充分利用）。',
  '- **第 2 题** ❌ **答错了！** 正确答案是 **moving**。',
  '按照**【标准四步法】**复盘，再把**每一个短语**联系起来。',
  '---',
  '### 下一步',
  '| 题号 | 结果 |\n| --- | --- |\n| 1 | 正确 |',
].join('\n\n');
const style=fs.readdirSync(assets).find(file=>/^index-[\w-]+\.css$/.test(file));
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://loopback');
  if(url.pathname==='/test'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.end(`<!doctype html><html data-theme-mode="light"><meta charset="utf-8"><link rel="stylesheet" href="/assets/${style}"><style>body{display:block;margin:0;background:#fff8fc;color:#372c3b;font:16px/1.7 system-ui}#result{padding:20px;max-width:72ch;margin:auto;box-sizing:border-box}html[data-theme-mode=dark] body{background:#211a29;color:#f4e4ed}</style><div class="chat-text" id="result"></div><script type="module">import {a as render,o as stream,__testParser as parser} from "/assets/${name}";Object.assign(window,{render,stream,parser,ready:true});</script>`);
  }
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');
  res.end(file===path.join(assets,name)?source:fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const require=createRequire(import.meta.url),{chromium,webkit}=require('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const report={status:'pending',module:name,engines:{}};
try{
  for(const [engine,type] of Object.entries({chromium,webkit})){
    const browser=await type.launch(engine==='chromium'?{channel:'chrome',headless:true}:{headless:true});
    const page=await browser.newPage({viewport:{width:1000,height:900}}),checks=[],errors=[],warnings=[];
    page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='warning')warnings.push(m.text());});
    await page.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
    try{
      await page.goto(base+'/test');await page.waitForFunction(()=>window.ready);
      const main=await page.evaluate(text=>{document.querySelector('#result').innerHTML=window.render(text);return {headings:document.querySelectorAll('#result h3').length,bold:document.querySelectorAll('#result strong').length,lists:document.querySelectorAll('#result li').length,pre:document.querySelectorAll('#result pre').length};},sample);
      assert.ok(main.headings>=2&&main.bold>=4&&main.lists>=2);assert.equal(main.pre,0);checks.push('Prose headings, bold and lists render without a code box');
      if(engine==='chromium')await page.locator('#result').screenshot({path:path.join(out,'reply-day.png')});
      await page.evaluate(()=>document.documentElement.setAttribute('data-theme-mode','dark'));
      if(engine==='chromium')await page.locator('#result').screenshot({path:path.join(out,'reply-night.png')});
      const stream=await page.evaluate(text=>{for(let end=1;end<text.length;end+=31){const html=window.stream(text.slice(0,end));if(/<pre class="code-block">/.test(html))return false;}document.querySelector('#result').innerHTML=window.render(text);return document.querySelectorAll('#result h3').length>=2;},sample);
      assert.equal(stream,true);assert.equal(warnings.length,0);checks.push('Incremental stream and final/history renderer stay consistent');
      const preserved=await page.evaluate(()=>{
        const text='按**【用 `ptr` *读取* [值](https://example.test/)】**复盘\n\n```c\nint *p = &value; // ### literal markdown\n```\n\n公式 $V_{out}=\\frac{R_2}{R_1+R_2}V_{in}$\n\n第一行<br>第二行\n\n<script>window.bad=true</script>';
        document.querySelector('#result').innerHTML=window.render(text);
        return {pre:document.querySelectorAll('#result pre').length,code:document.querySelector('#result pre')?.textContent,nested:!!document.querySelector('#result strong code')&&!!document.querySelector('#result strong a')&&!!document.querySelector('#result strong em'),math:document.querySelector('.pk-math')?.textContent,script:!!window.bad,br:!!document.querySelector('#result br')};
      });
      assert.equal(preserved.pre,1);assert.match(preserved.code,/### literal markdown/);assert.equal(preserved.nested,true);assert.ok(preserved.math.includes('\\frac'));assert.equal(preserved.script,false);assert.equal(preserved.br,true);checks.push('Real code, nested markup, math, line breaks and HTML escaping survive');
      await page.setViewportSize({width:360,height:760});
      const mobile=await page.evaluate(text=>{document.querySelector('#result').innerHTML=window.render(text+'\n\n'+('longword'.repeat(80)));return document.documentElement.scrollWidth<=innerWidth;},sample);
      assert.equal(mobile,true);checks.push('360px prose wraps without horizontal clipping');
      const fallback=await page.evaluate(()=>{const native=window.parser.render;try{window.parser.render=()=>{throw Error('isolated forced parser failure')};document.querySelector('#result').innerHTML=window.render('隔离失败兜底 <script>unsafe</script> '+('x'.repeat(700)));return {readable:!!document.querySelector('.markdown-plain-text-fallback'),pre:!!document.querySelector('#result pre'),script:!!document.querySelector('#result script'),fits:document.documentElement.scrollWidth<=innerWidth};}finally{window.parser.render=native;}});
      assert.deepEqual(fallback,{readable:true,pre:false,script:false,fits:true});checks.push('Unexpected parser errors use escaped wrapping prose');
      assert.equal(errors.length,0);assert.equal(warnings.length,1);assert.match(warnings[0],/isolated forced parser failure/);
      report.engines[engine]={status:'passed',checks,errors};
    }finally{await browser.close();}
  }
  report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
finally{server.close();fs.writeFileSync(path.join(out,'markdown-acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
