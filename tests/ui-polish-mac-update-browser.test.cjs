const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {spawn,execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
let playwright;
try { playwright = require(process.env.PINKIE_PLAYWRIGHT_PATH || 'playwright'); } catch {}
const root=path.join(__dirname,'..'),ui=path.join(root,'ui/injections'),worker=path.join(root,'installer/macos/stage-git-update.py');

test('Mac dialog receives real Git download events while the installed checkout stays untouched', {skip: !playwright, timeout:60000}, async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pinkie-mac-ui-'));
  const env={...process.env,HOME:path.join(temp,'home'),PINKIE_STATE_ROOT:path.join(temp,'state'),PINKIE_CONFIG_ROOT:path.join(temp,'config'),GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
  fs.mkdirSync(env.HOME,{recursive:true});fs.mkdirSync(env.PINKIE_CONFIG_ROOT,{recursive:true});
  const git=(...args)=>execFileSync('git',args,{env,stdio:['ignore','pipe','pipe']}).toString().trim();
  const remote=path.join(temp,'remote.git'),writer=path.join(temp,'writer'),installed=path.join(temp,'installed');
  git('init','--bare',remote);git('init','-b','main',writer);
  git('-C',writer,'config','user.email','test@example.invalid');git('-C',writer,'config','user.name','Test');
  fs.writeFileSync(path.join(writer,'update-full.sh'),'#!/bin/sh\n');fs.writeFileSync(path.join(writer,'VERSION'),'1.0.0\n');
  fs.writeFileSync(path.join(writer,'CHANGELOG.md'),'# 更新\n## 1.1.0\n- 第一个变化\n- 第二个变化\n- 第三个变化\n');
  git('-C',writer,'add','.');git('-C',writer,'commit','-m','initial');git('-C',writer,'remote','add','origin',remote);git('-C',writer,'push','origin','main');
  git('clone','--branch','main',pathToFileURL(remote).href,installed);
  const old=git('-C',installed,'rev-parse','HEAD');
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  fs.writeFileSync(path.join(env.PINKIE_CONFIG_ROOT,'install.env'),'PINKIE_REPO='+quote(installed)+'\n');
  // More than Git's default unpack threshold forces a transferred pack and
  // exercises its real byte progress instead of local loose-object output.
  fs.mkdirSync(path.join(writer,'payload'));
  for(let i=0;i<120;i++)fs.writeFileSync(path.join(writer,'payload',String(i)),randomBytes(32*1024));
  fs.writeFileSync(path.join(writer,'VERSION'),'1.1.0\n');
  git('-C',writer,'add','.');git('-C',writer,'commit','-m','new version');git('-C',writer,'push','origin','main');
  const browser=await playwright.chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage();
  const events=[];let callbacks=Promise.resolve();
  try {
    await page.exposeFunction('__testNativeCall', message => {
      const process=spawn('python3',[worker,message.action],{env});let buffer='';
      process.stdout.setEncoding('utf8');process.stdout.on('data',data=>{
        buffer+=data;let at;
        while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;
          const packet=JSON.parse(line);events.push(packet);
          callbacks=callbacks.then(()=>page.evaluate(({packet,id})=>{
            if(packet.type==='progress')window.__pinkieUpdateProgress(packet.event);
            else if(packet.type==='result')window.__pinkieUpdateResult(id,packet.value);
          },{packet,id:message.request}));
        }
      });
      process.stderr.resume();
      return new Promise((resolve,reject)=>{process.on('error',reject);process.on('close',()=>callbacks.then(resolve,reject));});
    });
    await page.setContent('<!doctype html><html data-laolao-mode="chat"><head></head><body></body></html>');
    await page.addStyleTag({path:path.join(ui,'laolao-update-dialog.css')});await page.addScriptTag({path:path.join(ui,'laolao-update-dialog.js')});
    await page.evaluate(()=>{window.__pinkieMacUpdaterV2=true;window.webkit={messageHandlers:{laolaoUpdate:{postMessage:payload=>void window.__testNativeCall(payload)}}};window.__pinkieUpdateDialog.open()});
    await page.getByRole('heading',{name:'有新版本啦'}).waitFor({timeout:15000});
    await page.getByRole('button',{name:'开始下载'}).click();
    await page.getByRole('heading',{name:'准备好了'}).waitFor({timeout:30000});
    const downloads=events.filter(x=>x.type==='progress'&&x.event.stage==='download');
    assert.ok(downloads.length>0,'Git did not report any byte progress');
    assert.ok(downloads.at(-1).event.downloaded>2*1024*1024);
    assert.equal(downloads.at(-1).event.total,null);
    assert.equal(await page.locator('.pinkie-upd__summary > span').innerText(),'第一个变化');assert.equal(await page.locator('.pinkie-upd__notes li').count(),2);
    assert.equal(git('-C',installed,'rev-parse','HEAD'),old);
    assert.ok(fs.existsSync(path.join(env.PINKIE_STATE_ROOT,'updates/prepared-git.json')));
  } finally {await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
});
