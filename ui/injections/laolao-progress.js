/* Shared by all four modes. Native streaming owns rendering and session routing. */
(() => {
  'use strict';
  // v2 is a one-time, user-requested upgrade. It re-enables only public
  // commentary and real tool events; hidden reasoning remains untouched.
  const version='laolao:public-progress:v2';
  let applied=false,scheduled=false;
  const seen=new WeakSet();
  function prepare(){
    scheduled=false;
    let migrated=applied;try{migrated=migrated||localStorage.getItem(version)==='1';}catch{}
    for(const pane of document.querySelectorAll('openclaw-chat-pane')){
      const state=pane.state;
      if(!state?.settings||typeof state.applySettings!=='function')continue;
      // UI alias only; never rewrite identity files or model messages. Keep the
      // native renderer in charge so names, composer and welcome stay in sync.
      if(/^agent:(main|project|thinking|unrestricted):/.test(state.sessionKey||'') && /^(?:Assistant|助手|main|project|thinking|unrestricted)$/i.test(state.assistantName||'')){
        state.assistantName='碧琪';state.requestUpdate?.();
      }
      if(!migrated){
        state.applySettings({...state.settings,chatShowToolCalls:true,chatPersistCommentary:true});
        applied=true;
      }
      if(!seen.has(pane)){
        seen.add(pane);pane.classList.add('pinkie-public-progress');
      }
    }
    if(applied&&!migrated)try{localStorage.setItem(version,'1');}catch{}
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(prepare);}}
  function start(){schedule();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('laolao:modechange',schedule);
})();
