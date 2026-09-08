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
  assert.match(resume,/setInterval[\s\S]*5000/);
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

test('history projection rebuilds are surfaced and retried with bounded backoff',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  const sidebar=read('ui/injections/laolao-sidebar.js');
  assert.match(resume,/session history is rebuilding/);
  assert.match(resume,/historyRebuildRetryAttempt/);
  assert.match(resume,/pinkie:session-history-rebuilding/);
  assert.match(resume,/Math\.min\(8_000/);
  assert.match(resume,/pinkie:history-rebuilding/);
  assert.match(sidebar,/pinkie:history-rebuilding/);
  assert.match(sidebar,/errorCode|errorText/);
});

test('history recovery paginates the legacy 100-message window and merges without duplicates',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/HISTORY_PAGE_SIZE = 250/);
  assert.match(resume,/offset/);
  assert.match(resume,/hasMore/);
  assert.match(resume,/nextOffset/);
  assert.match(resume,/chat\.history pagination did not advance/);
  assert.match(resume,/mergeCompleteHistory/);
  assert.match(resume,/chatHistoryPagination/);
  assert.match(resume,/history-count-regressed/);
  assert.match(resume,/session-changed/);
});

test('history recovery fences stale websocket results to the active session and client',()=>{
  const resume=read('ui/injections/laolao-resume.js');
  assert.match(resume,/gatewayClient\(\) !== client/);
  assert.match(resume,/currentSessionKey\(\) !== sessionKey/);
  assert.match(resume,/__laolaoHistoryStatus/);
  assert.match(resume,/__laolaoHistoryTestHooks/);
});

test('internal watchdog, tier controller and gateway-restart turns stay in the transcript but are hidden from the chat UI',()=>{
  const phrases=read('ui/injections/laolao-phrases.js');
  assert.match(phrases,/Your previous turn was interrupted by a gateway restart/);
  assert.match(phrases,/internal=raw===watchdogSentinel \|\| raw===restartRecoveryNotice/);
  assert.match(phrases,/raw\?\.startsWith\(watchdogControlPrefix\)/);
  assert.match(phrases,/raw\?\.startsWith\(tierControlPrefix\)/);
  assert.match(phrases,/bubble\.hidden=true/);
  assert.match(phrases,/bubble\.style\.setProperty\('display','none','important'\)/);
  assert.match(phrases,/hiddenCount===bubbles\.length/);
  assert.match(phrases,/hideInternalRecoveryTurns\(\);/);
  assert.doesNotMatch(phrases,/ACTIVE_UNRESTRICTED_RULESET_LOADED/);
});
