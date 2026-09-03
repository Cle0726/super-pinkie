const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('an upstream failure restores the real composer without fabricating an input box',()=>{
  const phrases=read('ui/injections/laolao-phrases.js');
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(phrases,/pinkie:run-failed/);
  assert.match(phrases,/session file changed while embedded prompt lock was released/);
  assert.match(resume,/addEventListener\("pinkie:run-failed"/);
  assert.match(resume,/clearVisualBusyState\(\)/);
  assert.match(resume,/sessions\.list/);
  assert.match(resume,/agent-chat__composer-combobox textarea/);
  assert.doesNotMatch(resume,/createElement\(["'](?:textarea|input)["']\)/);
});

test('composer recovery is low-frequency and voice implementation stays separate',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/setInterval[\s\S]*2500/);
  assert.match(resume,/document\.hidden/);
  assert.ok(fs.existsSync(path.join(__dirname,'../ui/injections/laolao-live-voice.js')));
});

test('foreground recovery never clicks stop and only a real manual stop cancels watchdog retry',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/\.chat-send-btn--stop/);
  assert.match(resume,/pinkie\.watchdog\.cancel/);
  assert.match(resume,/await refreshSession\(\)/);
  assert.doesNotMatch(resume,/stopBtn\.click\(\)/);
  assert.doesNotMatch(resume,/syntheticStop/);
});

test('internal watchdog, tier controller and gateway-restart turns stay in the transcript but are hidden from the chat UI',()=>{
  const phrases=read('ui/injections/laolao-phrases.js');
  assert.match(phrases,/Your previous turn was interrupted by a gateway restart/);
  assert.match(phrases,/internal=raw===watchdogSentinel \|\| raw===restartRecoveryNotice/);
  assert.match(phrases,/raw\?\.startsWith\(tierControlPrefix\)/);
  assert.match(phrases,/bubble\.hidden=true/);
  assert.match(phrases,/bubble\.style\.setProperty\('display','none','important'\)/);
  assert.match(phrases,/hiddenCount===bubbles\.length/);
  assert.match(phrases,/hideInternalRecoveryTurns\(\);/);
  assert.doesNotMatch(phrases,/ACTIVE_UNRESTRICTED_RULESET_LOADED/);
});
