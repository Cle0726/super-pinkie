(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = {pinkie:'碧琪',codex:'紫悦',openclaw:'云宝',claude:'珍奇',gemini:'柔柔',ollama:'苹果嘉儿',user:'铲屎官',system:'派对记录'};
  const engines={pinkie:'主持',codex:'Codex',openclaw:'OpenClaw',claude:'Claude',gemini:'Gemini',ollama:'Ollama'};
  const portraits={pinkie:'/avatar.png',codex:'/twilight.png',openclaw:'/rainbow.png',claude:'/rarity.png',gemini:'/fluttershy.png',ollama:'/applejack.png'};
  const state = {token:'',agents:[],rooms:[],room:null,messages:new Map(),tasks:[],reply:null,query:'',signature:'',polling:false,epoch:0,requests:new Map(),sending:new Set(),hasOlder:false,archived:false,loadingRoom:false,metadataAt:0};
  const drafts=window.PartyDrafts;
  const roomArt=window.PartyRoomArt;
  state.modelCatalog={};state.modelNotes={};state.modelSaving=false;
  const element = (tag, cls='', text='') => {const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
  const toast = text => { $('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,3500); };
  async function api(path, data) {
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),path.startsWith('/api/models')?25000:12000);
    try{
      const response=await fetch(path,{method:data?'POST':'GET',cache:'no-store',signal:controller.signal,headers:data?{'Content-Type':'application/json','X-Party-Token':state.token}:{},body:data?JSON.stringify(data):undefined});
      const value=await response.json();
      if(response.status===403&&data){const fresh=await fetch('/api/bootstrap',{cache:'no-store',signal:controller.signal});if(fresh.ok)state.token=(await fresh.json()).token;}
      if(!response.ok)throw new Error(value.error||'连接暂时中断');return value;
    }catch(error){if(error.name==='AbortError')throw new Error('连接超时，草稿保留了；可重试，不会重复派发已接收的消息。');throw error;}
    finally{clearTimeout(timer);}
  }
  function saveDraft(){
    if(!state.room||state.loadingRoom)return;
    try{drafts.save(localStorage,state.room.id,{text:$('draft').value,reply:state.reply,recipient:$('recipient').value});}
    catch{if(!state.draftWarning){toast('本机草稿存储不可用，退出前请先复制未发送内容');state.draftWarning=true;}}
  }
  function roomHeader(){
    document.title=(state.room?.name?state.room.name+' · ':'')+'派对空间';
    $('conversation').setAttribute('aria-label',state.room?.name||'派对群聊');
    $('room-settings').disabled=!state.room;$('archive-notice').hidden=!state.room?.archived;
    $('draft').disabled=!state.room||!!state.room.archived;
  }
  function avatar(sender, extra='') {
    const node=element('div','avatar '+extra+(sender==='pinkie'?' princess':''));
    if(portraits[sender]){const img=element('img');img.src=portraits[sender];img.alt=names[sender];img.draggable=false;node.append(img);}
    else node.textContent=sender==='user'?'您':(names[sender]||sender).slice(0,1);
    return node;
  }
  async function copy(text){try{await navigator.clipboard.writeText(text);toast('复制好了');}catch{toast('请选中文字，按 ⌘C 复制');}}
  function renderRooms(){
    $('room-count').textContent=state.rooms.filter(r=>!!r.archived===state.archived).length;$('rooms').replaceChildren();
    $('active-rooms').setAttribute('aria-pressed',String(!state.archived));$('archived-rooms').setAttribute('aria-pressed',String(state.archived));
    const filter=$('room-filter').value.trim().toLowerCase();
    for(const room of state.rooms.filter(r=>!!r.archived===state.archived&&r.name.toLowerCase().includes(filter))){
      const button=element('button','room-item'+(room.id===state.room?.id?' active':''));button.type='button';
      const emblem=element('img','room-glyph');emblem.src=roomArt.forRoom(room,state.rooms);emblem.alt='';emblem.draggable=false;button.append(emblem);
      const info=element('div');info.append(element('strong','',room.name),element('small','',room.members.length+' 位伙伴 · 独立项目'));button.append(info);
      button.onclick=()=>selectRoom(room.id);$('rooms').append(button);
    }
  }
  function renderMembers(){
    $('members').replaceChildren();const selected=state.room?.members||['pinkie'];
    $('member-count').textContent=state.room?selected.length+' 位':'';
    for(const agent of state.agents){
      const row=element('div','member'+(!agent.available?' disabled':''));row.append(avatar(agent.id));
      const info=element('div','member-info');info.append(element('strong','',names[agent.id]),element('small','engine',engines[agent.id]),element('small','',agent.available?(selected.includes(agent.id)?'随时可以叫'+names[agent.id]:'还没有加入这个群'):'等待连接，暂不能派工'));
      row.append(info);row.title=names[agent.id]+' · '+(agent.reason||agent.detail);
      const at=element('button','','@');at.type='button';at.title='发消息给'+names[agent.id];at.setAttribute('aria-label',at.title);at.disabled=!(agent.available&&selected.includes(agent.id)&&state.room&&!state.room.archived);at.onclick=()=>{$('recipient').value=agent.id;syncPermission();renderModels();saveDraft();$('draft').focus();};row.append(at);
      $('members').append(row);
    }
    const previous=$('recipient').value;$('recipient').replaceChildren();
    for(const id of selected){const option=element('option','',names[id]+' · '+engines[id]);option.value=id;option.disabled=!state.agents.find(a=>a.id===id)?.available;$('recipient').append(option);}
    if(selected.includes(previous))$('recipient').value=previous;syncPermission();
    $('project-path').textContent=state.room?.path||'每个群单独绑定一个文件夹。';$('copy-path').hidden=!state.room;$('show-project').hidden=!state.room||!window.webkit?.messageHandlers?.laolaoProjectFolder;renderModels();
  }
  function renderModels(){
    const id=$('recipient').value;const selected=state.room?.models?.[id]||'';const picker=$('model');picker.replaceChildren();
    const base=element('option','','跟随本机默认');base.value='';picker.append(base);
    for(const model of state.modelCatalog[id]||[]){const option=element('option','',model.name);option.value=model.id;option.title=model.id;picker.append(option);}
    if(selected&&![...picker.options].some(o=>o.value===selected)){const missing=element('option','',selected+'（待刷新确认）');missing.value=selected;picker.append(missing);}
    picker.value=selected;picker.disabled=!state.room||!!state.room.archived||state.modelSaving;
    $('model-note').textContent=state.modelNotes[id]||'模型按群、按成员分别保存；不改变其他模式。';
  }
  async function loadModels(force=false){
    $('refresh-models').disabled=true;$('model-note').textContent='碧琪正在整理可选模型…';try{const data=await api('/api/models'+(force?'?refresh=1':''));state.modelCatalog=data.models;state.modelNotes=data.notes;renderModels();}catch(e){$('model-note').textContent='模型列表暂时没连上，可先用默认模型，稍后刷新。';}finally{$('refresh-models').disabled=false;}
  }
  $('refresh-models').onclick=()=>loadModels(true);
  $('model').onchange=async()=>{if(!state.room)return;const roomId=state.room.id;const agent=$('recipient').value;const value=$('model').value;state.modelSaving=true;$('model').disabled=true;renderJobs();try{await applyRoomSettings(roomId,{models:{...state.room.models,[agent]:value}});}catch(e){toast(e.message);}finally{state.modelSaving=false;renderModels();renderJobs();}};
  function syncPermission(){const enabled=$('recipient').value==='codex';$('permission-label').hidden=!enabled;if(!enabled)$('permission').value='read-only';}
  function setReply(message){state.reply=message;$('reply-preview').hidden=!message;$('reply-preview').querySelector('span').textContent=message?(names[message.sender]||message.sender)+'：'+message.body:'';}
  function messageNode(message){
    if(message.sender==='system'){
      if(message.kind==='error'){const details=element('details','notice error');details.append(element('summary','','这次没有完成，点开查看原因'),element('pre','',message.body));return details;}
      return element('div','notice',message.body.replace(/Codex/g,'紫悦').replace(/OpenClaw/g,'云宝'));
    }
    const row=element('article','message '+(message.sender==='user'?'user':''));row.dataset.id=String(message.id);row.append(avatar(message.sender));
    const body=element('div','message-body');const meta=element('div','message-meta');
    meta.append(element('strong','',names[message.sender]||message.sender));if(engines[message.sender]&&message.sender!=='pinkie')meta.append(element('span','engine',engines[message.sender]));
    const time=element('time','',new Date(message.created*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));time.dateTime=new Date(message.created*1000).toISOString();time.title=new Date(message.created*1000).toLocaleString();meta.append(time);body.append(meta);
    if(message.kind==='tool'){const details=element('details','tool');details.append(element('summary','','查看实际工具记录'),element('pre','',message.body));body.append(details);}
    else{const bubble=element('div','bubble');if(message.reply){const quoted=state.messages.get(message.reply);const quote=element('div','quoted');if(quoted){quote.append(element('span','quoted-author',(names[quoted.sender]||quoted.sender)+'：'),element('span','quoted-body',quoted.body.slice(0,130)));}else{quote.append(element('span','quoted-author','回复较早的群消息'));}bubble.append(quote);}bubble.append(element('span','bubble-text',message.body));body.append(bubble);}
    const progress=element('span','message-progress');body.append(progress);
    const actions=element('div','message-actions');const reply=element('button','','回复');reply.disabled=!!state.room?.archived;reply.onclick=()=>{setReply(row._message||message);saveDraft();$('draft').focus();};const cp=element('button','','复制');cp.onclick=()=>copy((row._message||message).body);actions.append(reply,cp);body.append(actions);row.append(body);updateLiveNode(row,message);return row;
  }
  function renderMessages(){
    const ordered=[...state.messages.values()].filter(m=>!m.automaticSummary).sort((a,b)=>a.id-b.id);
    // Keep existing bubbles, selected text and expanded tools stable during deltas.
    const container=$('messages');const existing=new Map([...container.children].map(n=>[n.dataset.id,n]));
    let position=container.firstChild;
    for(const message of ordered){
      const key=String(message.id);let node=existing.get(key);const signature=JSON.stringify(message);
      if(!node){node=messageNode(message);node.dataset.id=key;}
      else if(node._signature!==signature){
        if(message.sender==='system'){const next=messageNode(message);next.dataset.id=key;node.replaceWith(next);if(position===node)position=next;node=next;}
        else{const text=node.querySelector('.bubble-text')||node.querySelector('.tool pre');if(text&&text.textContent!==message.body)text.textContent=message.body;updateLiveNode(node,message);node._message=message;}
      }
      node._signature=signature;node._message=message;
      if(node!==position)container.insertBefore(node,position);position=node.nextSibling;existing.delete(key);
    }
    for(const node of existing.values())node.remove();$('empty').hidden=!!state.room&&ordered.length>0;
    $('older').hidden=!state.hasOlder;
  }
  function updateLiveNode(row,message){
    row.dataset.status=message.status||'done';row.setAttribute('aria-busy',String(message.status==='running'));
    const label=row.querySelector('.message-progress');
    if(label)label.textContent=message.status==='running'?(message.kind==='tool'?'正在执行…':'正在回复…'):['failed','cancelled','interrupted'].includes(message.status)?'未完成 · 已保留现有内容':'';
    const summary=row.querySelector('.tool summary');if(summary)summary.textContent=({running:'工具执行中',done:'工具已完成',failed:'工具未完成',cancelled:'工具已停止',interrupted:'工具已中断'}[message.status]||'实际工具记录')+' · 点开查看';
  }
  function connectLive(){
    state.live?.close();state.live=null;state.liveConnected=false;
    if(!state.room||!window.EventSource)return;
    const roomId=state.room.id,epoch=state.epoch;
    const source=new EventSource(`/api/rooms/${roomId}/events`);state.live=source;
    const receive=event=>{
      if(state.room?.id!==roomId||state.epoch!==epoch||state.live!==source)return;
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(data.room?.id!==roomId)return;
      state.liveConnected=true;$('connection').hidden=true;
      if(state.query){clearTimeout(state.liveSearch);state.liveSearch=setTimeout(()=>refresh(),180);return;}
      const timeline=$('timeline');const pinned=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<110;
      if(JSON.stringify(state.room)!==JSON.stringify(data.room)){state.room=data.room;state.rooms=state.rooms.map(r=>r.id===roomId?data.room:r);roomHeader();renderRooms();renderMembers();}
      for(const message of data.messages)state.messages.set(message.id,message);
      const jobsChanged=JSON.stringify(state.tasks)!==JSON.stringify(data.tasks);state.tasks=data.tasks;state.liveVersion++;
      renderMessages();if(jobsChanged)renderJobs();if(pinned)timeline.scrollTop=timeline.scrollHeight;
    };
    source.addEventListener('snapshot',receive);source.addEventListener('patch',receive);
    source.onerror=()=>{if(state.live!==source)return;state.liveConnected=false;$('connection').hidden=false;$('connection').textContent='实时连接正在恢复，已有回复和草稿都保留着。';};
  }
  function renderJobs(){
    $('jobs').replaceChildren();const active=state.tasks.filter(t=>!['done','cancelled','failed','interrupted'].includes(t.status));
    for(const job of active.reverse()){
      const row=element('div','job');const info=element('div','job-info');const title=element('strong','',names[job.agent]);
      if(job.status==='running')title.prepend(element('span','working-dot'));
      info.append(title,element('span','state',' · '+({pending:'等铲屎官点头',queued:'排着队，马上就来',running:'正认真忙着呢'}[job.status]||job.status)),element('p','',job.prompt),element('small','job-model',job.model||'本机默认模型'));row.append(avatar(job.agent),info);
      if(job.status==='pending'){const approve=element('button','','查看并派发');approve.onclick=()=>confirmJob(job);row.append(approve);}
      const stop=element('button','',job.status==='pending'?'不派发':'停止');stop.onclick=async()=>{try{await api(`/api/rooms/${state.room.id}/cancel`,{taskId:job.id});await refresh();}catch(e){toast(e.message);}};row.append(stop);$('jobs').append(row);
    }
    $('send').disabled=!state.room||!!state.room.archived||state.loadingRoom||state.modelSaving||state.sending.has(state.room.id)||state.tasks.some(t=>['running','queued'].includes(t.status));
    const past=state.tasks.filter(t=>['done','failed','cancelled','interrupted'].includes(t.status));
    $('task-count').textContent=past.length?`（最近 ${past.length} 项）`:'';$('task-history').hidden=!past.length;$('past-jobs').replaceChildren();
    for(const job of past){const row=element('div','past-job');const info=element('div');info.append(element('strong','',names[job.agent]+' · '+({done:'已完成',failed:'未完成',cancelled:'已停止',interrupted:'已中断'}[job.status])),element('p','',job.prompt));row.append(info);
      if(job.status!=='done'&&!state.room.archived){const retry=element('button','','重新派发');retry.onclick=async()=>{retry.disabled=true;const roomId=job.room;const key='retry:'+job.id;if(!state.requests.has(key))state.requests.set(key,crypto.randomUUID());try{const result=await api(`/api/rooms/${roomId}/retry`,{taskId:job.id,requestId:state.requests.get(key)});if(state.room?.id!==roomId)return;await refresh();const queued=state.tasks.find(t=>t.id===result.taskId);if(queued?.status==='pending')confirmJob(queued);else toast('这项重试已经处理，请查看任务记录');}catch(e){toast(e.message);}finally{retry.disabled=false;}};row.append(retry);}
      $('past-jobs').append(row);
    }
  }
  function confirmJob(job){
    const dialog=$('approve-dialog');$('approval-desc').textContent=`接收成员：${names[job.agent]} · ${engines[job.agent]}\n回复模型：${job.model||'本机默认'}\n项目目录：${state.room.path}`;
    $('approval-prompt').textContent=job.prompt;$('approval-warning').textContent=job.permission==='workspace-write'?'这次允许 Codex 修改上面的项目目录。不会自动授权发布、支付或其他外部操作。已写入的文件不随“停止”回滚。':'按只读权限执行。模型请求仍会发往该 Agent 已配置的服务商。';
    const roomId=job.room;const confirm=$('approve-confirm');confirm.disabled=false;
    $('approve-cancel').onclick=()=>dialog.close();
    confirm.onclick=async()=>{if(confirm.disabled)return;confirm.disabled=true;try{await api(`/api/rooms/${roomId}/approve`,{taskId:job.id});dialog.close();if(state.room?.id===roomId)await refresh();}catch(e){toast(e.message);}finally{confirm.disabled=false;}};dialog.showModal();
  }
  async function refresh(before){
    if(!state.room)return;const roomId=state.room.id;const epoch=state.epoch;const liveVersion=state.liveVersion;const query=new URLSearchParams();if(before)query.set('before',before);if(state.query)query.set('q',state.query);
    try{
      const data=await api(`/api/rooms/${roomId}?${query}`);if(state.room?.id!==roomId||state.epoch!==epoch)return;
      if(!before&&!state.query&&liveVersion!==state.liveVersion)return;
      if(JSON.stringify(state.room)!==JSON.stringify(data.room)){state.room=data.room;state.rooms=state.rooms.map(r=>r.id===roomId?data.room:r);roomHeader();renderRooms();renderMembers();}
      const timeline=$('timeline');const nearBottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<110;const oldHeight=timeline.scrollHeight;
      const signature=JSON.stringify([data.messages,data.tasks]);
      if(signature!==state.signature||before){if(before||state.messages.size===0)state.hasOlder=data.messages.length===120;for(const message of data.messages)state.messages.set(message.id,message);state.tasks=data.tasks;state.signature=signature;renderMessages();renderJobs();if(before)timeline.scrollTop+=timeline.scrollHeight-oldHeight;else if(nearBottom)timeline.scrollTop=timeline.scrollHeight;}
      $('connection').hidden=true;
    }catch(e){if(state.room?.id!==roomId||state.epoch!==epoch)return;$('connection').hidden=false;$('connection').textContent='连接暂时中断，记录仍然保留。'+e.message;}
  }
  async function selectRoom(id){
    saveDraft();clearTimeout(state.searchTimer);state.loadingRoom=true;
    state.live?.close();state.live=null;state.liveConnected=false;state.liveVersion=0;clearTimeout(state.liveSearch);
    state.epoch++;state.hasOlder=false;state.room=state.rooms.find(r=>r.id===id)||null;state.messages.clear();state.tasks=[];state.signature='';state.query='';$('message-query').value='';
    let saved;try{saved=drafts.read(localStorage,id);}catch{saved=drafts.read(null,id);}setReply(saved.reply);$('draft').value=saved.text;
    const url=new URL(location.href);if(state.room)url.searchParams.set('room',id);else url.searchParams.delete('room');history.replaceState({},'',url);
    roomHeader();renderRooms();renderMembers();if(state.room?.members.includes(saved.recipient))$('recipient').value=saved.recipient;$('permission').value='read-only';syncPermission();renderModels();renderMessages();renderJobs();
    const epoch=state.epoch;await refresh();if(state.epoch===epoch){state.loadingRoom=false;renderJobs();$('timeline').scrollTop=$('timeline').scrollHeight;connectLive();}
  }
  function createDialog(){
    $('invite-members').replaceChildren();
    for(const id of ['codex','openclaw']){const agent=state.agents.find(x=>x.id===id);const label=element('label');const check=element('input');check.type='checkbox';check.value=id;check.checked=!!agent?.available;check.disabled=!agent?.available;label.append(check,avatar(id),document.createTextNode(names[id]+' · '+engines[id]+(agent?.available?'':'（待接入）')));$('invite-members').append(label);}
    $('create-dialog').showModal();$('create-name').focus();
  }
  async function syncMetadata(){
    const data=await api('/api/bootstrap');state.token=data.token;
    const changed=JSON.stringify(state.agents)!==JSON.stringify(data.agents);state.agents=data.agents;state.rooms=data.rooms;state.metadataAt=Date.now();renderRooms();
    if(changed){renderMembers();renderJobs();}
  }
  async function viewArchive(archived){
    state.archived=archived;await selectRoom(state.rooms.find(r=>!!r.archived===archived)?.id);
  }
  async function applyRoomSettings(roomId,data){
    const room=await api(`/api/rooms/${roomId}/update`,data);state.rooms=state.rooms.map(r=>r.id===roomId?room:r);
    if(state.room?.id===roomId){state.room=room;state.archived=!!room.archived;roomHeader();renderMembers();renderMessages();renderJobs();await refresh();}renderRooms();return room;
  }
  function settingsDialog(){
    if(!state.room)return;const room=state.room;const dialog=$('settings-dialog');dialog.dataset.room=room.id;
    $('settings-name').value=room.name;$('settings-path').textContent='绑定项目：'+room.path;$('settings-members').replaceChildren();
    for(const id of ['pinkie','codex','openclaw']){const available=state.agents.find(a=>a.id===id)?.available;const label=element('label');const check=element('input');check.type='checkbox';check.value=id;check.checked=room.members.includes(id);check.disabled=id==='pinkie'||(!available&&!check.checked);label.append(check,avatar(id),document.createTextNode(names[id]+' · '+engines[id]+(!available?'（未连接）':'')));$('settings-members').append(label);}
    $('archive-room').textContent=room.archived?'恢复群聊':'归档群聊';dialog.showModal();
  }
  $('room-settings').onclick=settingsDialog;$('close-settings').onclick=()=>$('settings-dialog').close();
  $('active-rooms').onclick=()=>viewArchive(false);$('archived-rooms').onclick=()=>viewArchive(true);
  $('settings-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;const roomId=$('settings-dialog').dataset.room;button.disabled=true;try{await applyRoomSettings(roomId,{name:$('settings-name').value,members:[...$('settings-members').querySelectorAll('input:checked')].map(x=>x.value)});$('settings-dialog').close();toast('群聊设置已保存');}catch(e){toast(e.message);}finally{button.disabled=false;}};
  $('archive-room').onclick=async()=>{const roomId=$('settings-dialog').dataset.room;const room=state.rooms.find(r=>r.id===roomId);if(!room)return;$('archive-room').disabled=true;try{await applyRoomSettings(roomId,{archived:!room.archived});$('settings-dialog').close();toast(room.archived?'群聊恢复了':'群聊已归档，记录和文件都保留了');}catch(e){toast(e.message);}finally{$('archive-room').disabled=false;}};
  $('restore-room').onclick=async()=>{if(!state.room)return;try{await applyRoomSettings(state.room.id,{archived:false});toast('群聊恢复了');}catch(e){toast(e.message);}};
  $('refresh-members').onclick=async()=>{$('refresh-members').disabled=true;try{await syncMetadata();toast('连接状态已刷新');}catch(e){toast(e.message);}finally{$('refresh-members').disabled=false;}};
  $('new-room').onclick=createDialog;$('welcome-new').onclick=createDialog;$('close-create').onclick=()=>$('create-dialog').close();$('room-filter').oninput=renderRooms;
  $('recipient').onchange=()=>{syncPermission();renderModels();saveDraft();};$('reply-preview').querySelector('button').onclick=()=>{setReply(null);saveDraft();};
  $('draft').oninput=saveDraft;window.addEventListener('pagehide',saveDraft);
  const memberRailKey='pinkie.party.members.collapsed.v1';
  function setMembersCollapsed(collapsed,persist=true){
    document.querySelector('.party-shell').dataset.membersCollapsed=String(collapsed);
    const toggle=$('toggle-members');toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.setAttribute('aria-label',collapsed?'展开成员栏':'收起成员栏');toggle.title=toggle.getAttribute('aria-label');toggle.textContent=collapsed?'‹':'›';
    if(persist)try{localStorage.setItem(memberRailKey,String(collapsed));}catch{}
  }
  let membersInitiallyCollapsed=true;try{membersInitiallyCollapsed=localStorage.getItem(memberRailKey)!=='false';}catch{}
  setMembersCollapsed(membersInitiallyCollapsed,false);
  $('toggle-members').onclick=()=>setMembersCollapsed(document.querySelector('.party-shell').dataset.membersCollapsed!=='true');
  $('copy-path').onclick=()=>copy(state.room.path);
  $('find-message').onclick=()=>{$('search-row').hidden=false;$('message-query').focus();};
  $('close-search').onclick=()=>{clearTimeout(state.searchTimer);state.epoch++;$('search-row').hidden=true;$('message-query').value='';state.query='';state.messages.clear();state.signature='';refresh();};
  $('message-query').oninput=()=>{clearTimeout(state.searchTimer);state.epoch++;state.searchTimer=setTimeout(()=>{state.query=$('message-query').value.trim();state.messages.clear();state.signature='';refresh();},250);};
  $('older').onclick=()=>refresh(Math.min(...state.messages.keys()));
  $('draft').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!$('send').disabled)$('composer').requestSubmit();}};
  $('composer').onsubmit=async event=>{
    event.preventDefault();if(!state.room||state.room.archived||state.loadingRoom||state.modelSaving||!$('draft').value.trim()||state.sending.has(state.room.id))return;const text=$('draft').value.trim();const roomId=state.room.id;const draftRecipient=$('recipient').value;saveDraft();
    const mention=text.match(/^@(碧琪|紫悦|云宝|Codex|OpenClaw)\s+/i);let agent=$('recipient').value;
    if(mention)agent=Object.keys(names).find(id=>names[id].toLowerCase()===mention[1].toLowerCase()||engines[id]?.toLowerCase()===mention[1].toLowerCase())||agent;
    const payload={agent,text,model:state.room.models?.[agent]||'',permission:agent==='codex'?$('permission').value:'read-only',reply:state.reply?.id||null};const key=roomId+JSON.stringify(payload);
    if(!state.requests.has(key)){try{state.requests.set(key,drafts.requestId(localStorage,roomId,payload,()=>crypto.randomUUID()));}catch{state.requests.set(key,crypto.randomUUID());}}
    const requestId=state.requests.get(key);state.sending.add(roomId);renderJobs();
    try{await api(`/api/rooms/${roomId}/send`,{requestId,...payload});state.requests.delete(key);
      try{drafts.acknowledge(localStorage,roomId,requestId);drafts.clearIfUnchanged(localStorage,roomId,{...payload,recipient:draftRecipient});}catch{/* visible draft remains */}
      if(state.room?.id===roomId){if($('draft').value.trim()===text&&state.reply?.id===(payload.reply||undefined)&&$('recipient').value===draftRecipient){$('draft').value='';setReply(null);saveDraft();}await refresh();$('timeline').scrollTop=$('timeline').scrollHeight;}
    }catch(e){toast(e.message);}finally{state.sending.delete(roomId);renderJobs();}
  };
  $('create-form').onsubmit=async event=>{
    event.preventDefault();const submit=$('create-form').querySelector('[type=submit]');submit.disabled=true;
    try{const room=await api('/api/rooms',{name:$('create-name').value,path:$('create-path').value.trim(),members:[...$('invite-members').querySelectorAll('input:checked')].map(x=>x.value)});state.rooms.unshift(room);state.archived=false;$('create-dialog').close();$('create-form').reset();await selectRoom(room.id);}catch(e){toast(e.message);}finally{submit.disabled=false;}
  };
  function chooseFolder(target){
    const bridge=window.webkit?.messageHandlers?.laolaoProjectFolder;if(!bridge){toast('浏览器内请粘贴路径；本机 App 支持直接选择文件夹');return;}
    const requestId=crypto.randomUUID();window.__laolaoProjectFolderResult=result=>{if(result.requestId===requestId&&!result.cancelled)$(target).value=result.path;};bridge.postMessage({action:'choose',requestId,path:$(target).value,context:'party'});
  }
  $('choose-folder').onclick=()=>chooseFolder('create-path');$('choose-project-parent').onclick=()=>chooseFolder('project-parent');
  $('show-project').onclick=()=>window.webkit?.messageHandlers?.laolaoProjectFolder?.postMessage({action:'reveal',path:state.room.path});
  $('new-project').onclick=()=>{$('project-name').value=$('create-name').value;$('project-parent').value='';$('project-dialog').showModal();};
  $('close-project').onclick=()=>$('project-dialog').close();
  $('project-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const result=await api('/api/projects',{parent:$('project-parent').value.trim(),name:$('project-name').value});$('create-path').value=result.path;$('project-dialog').close();toast('新文件夹建好了，已帮你选中');}catch(e){toast(e.message);}finally{button.disabled=false;}};
  const motion=window.PinkieMotion;
  const entranceStarted=performance.now();let entranceProgress=8,entranceTarget=8,entranceComplete=false,lastFrame=entranceStarted;
  const progress=(value,phrase)=>{entranceTarget=Math.max(entranceTarget,value);if(phrase)motion.text($('splash-phrase'),phrase);};
  function entranceTick(now){
    const dt=Math.min(100,now-lastFrame);lastFrame=now;
    entranceProgress+=(entranceTarget-entranceProgress)*(1-Math.exp(-dt/180));
    if(entranceTarget-entranceProgress<.25)entranceProgress=entranceTarget;
    motion.progress($('party-progress-fill'),$('party-percent'),$('party-progress'),entranceProgress);
    if(!entranceComplete)requestAnimationFrame(entranceTick);
  }
  requestAnimationFrame(entranceTick);
  const entranceArt=motion.preload('/entrance.png').then(()=>$('party-splash').classList.add('is-art-ready'));
  const criticalArt=Promise.all(['/wallpaper.png','/brand.png'].map(motion.preload));
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function boot(){
    try{
      const data=await api('/api/bootstrap');state.token=data.token;state.agents=data.agents;state.rooms=data.rooms;
      if(!data.roomManagement||data.partyExperience!==3){progress(entranceProgress,'派对组件已更新，请退出并重新打开「超級碧琪」完成切换。');return;}
      if(/^https?:\/\//.test(data.gatewayURL||'')){$('back-app').href=data.gatewayURL;$('splash-back').href=data.gatewayURL;}
      progress(35,'伙伴名单到啦，碧琪核对一下座位。');
      await Promise.all([entranceArt,criticalArt]);
      progress(65,'把你的聊天记录摆好，不和别的派对混在一起。');
      const id=new URLSearchParams(location.search).get('room');const room=state.rooms.find(r=>r.id===id)||state.rooms.find(r=>!r.archived);state.archived=!!room?.archived;await selectRoom(room?.id);
      if(!$('connection').hidden)throw new Error('群聊页面还未准备好，正在重新连接。');
      await Promise.all([roomArt.forRoom(state.room,state.rooms),...(state.room?.members||['pinkie']).map(id=>portraits[id])].filter(Boolean).map(motion.preload));
      await motion.frames();progress(94,'好了，铲屎官，就差把门轻轻推开。');
      await delay(Math.max(300,(motion.reduced()?400:1900)-(performance.now()-entranceStarted)));
      progress(100,'欢迎回来，铲屎官。今天一起做点什么？');
      // Let the displayed bar reach its target before revealing the page.
      while(entranceProgress<99.5)await delay(40);
      entranceComplete=true;motion.progress($('party-progress-fill'),$('party-percent'),$('party-progress'),100);
      await delay(motion.reduced()?0:160);
      const shell=document.querySelector('.party-shell');shell.classList.add('is-entering');$('party-splash').classList.add('leaving');
      await delay(motion.reduced()?0:520);$('party-splash').hidden=true;shell.inert=false;
      setTimeout(()=>shell.classList.remove('is-entering'),1100);
      // Unused member portraits no longer delay entry or compete with the scene.
      void (async()=>{for(const src of [...roomArt.urls,...Object.values(portraits)]){await motion.preload(src);await delay(120);}})();
      loadModels();
    }
    catch(e){$('connection').hidden=false;$('connection').textContent='派对服务尚未连接：'+e.message;progress(entranceProgress,'门还没准备好，碧琪正在重新连接。也可以先返回聊天。');setTimeout(boot,2500);}
  }
  window.addEventListener('pagehide',()=>{state.live?.close();state.live=null;state.liveConnected=false;});
  window.addEventListener('pageshow',()=>{if(state.room&&!state.live)connectLive();});
  setInterval(async()=>{if(document.hidden||state.polling||!$('party-splash').hidden)return;state.polling=true;try{if(Date.now()-state.metadataAt>15000)await syncMetadata();if(!state.liveConnected)await refresh();}catch(e){$('connection').hidden=false;$('connection').textContent='正在重连，聊天和草稿仍保留。'+e.message;}finally{state.polling=false;}},3000);
  boot();
})();
