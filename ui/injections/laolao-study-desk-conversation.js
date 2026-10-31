/* 学习台独立对话。只使用 desk-chat 会话，绝不读取或复用外面的普通聊天。 */
(() => {
  'use strict';
  if(window.__pinkieStudyConversation)return;
  const desk=()=>window.__pinkieStudyDesk,doc=document.documentElement,states=new Map();
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  let panel=null,thread=null,input=null,status=null,sendButton=null,stopButton=null,fullHost=null,currentKey='',timer=0;
  const key=()=>desk()?.conversationKey?.()||'';
  const active=()=>Boolean(panel?.isConnected&&!panel.hidden&&doc.dataset.pinkieStudyDesk==='desk'&&doc.dataset.laolaoMode==='learning');
  const state=()=>{const k=key();if(!states.has(k))states.set(k,{messages:[],draft:'',loaded:false,loading:null,running:false,runId:null,started:0,version:0});return states.get(k);};
  const request=(method,params={},timeout=30000)=>{const k=key();if(!/^agent:learning:desk-chat:/.test(k))throw Error('学习台对话还没有准备好');return desk().request(method,{...params,sessionKey:k},timeout);};
  const messageText=m=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n'):String(m?.text||'');
  const stamp=m=>{const n=Number(m.timestamp??m.at??m.createdAt);return Number.isFinite(n)?n<1e11?n*1000:n:Date.parse(m.timestamp||m.at||m.createdAt)||0;};
  function inline(host,text){
    const re=/\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;let at=0;
    for(const m of text.matchAll(re)){host.append(document.createTextNode(text.slice(at,m.index)));if(m[1])host.append(el('strong','',m[1]));else if(m[2])host.append(el('code','',m[2]));else{const a=el('a','',m[3]);a.href=m[4];a.target='_blank';a.rel='noopener noreferrer';host.append(a);}at=m.index+m[0].length;}host.append(document.createTextNode(text.slice(at)));
  }
  function markup(host,text){
    for(const [i,part]of String(text).split(/```[^\n]*\n([\s\S]*?)```/g).entries()){
      if(i%2){const pre=el('pre');pre.append(el('code','',part));host.append(pre);continue;}
      for(const line of part.split('\n')){if(!line.trim())continue;const p=el('p',/^[-*]\s/.test(line)?'pk-chat-list':'');inline(p,line.replace(/^#{1,6}\s+/,'').replace(/^[-*]\s+/,''));host.append(p);}
    }
  }
  function references(message){
    const refs=[],seen=new Set();
    const visit=(value,depth=0)=>{if(!value||depth>6)return;if(Array.isArray(value)){value.forEach(v=>visit(v,depth+1));return;}if(typeof value==='string'){if(value.length<200000&&/"(?:inline|kind)"/.test(value))try{visit(JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g,'')),depth+1);}catch{}return;}if(typeof value!=='object')return;
      if(value.v===1&&typeof value.kind==='string'&&value.id&&value.sessionKey===key()){const id=value.kind+':'+value.id;if(!seen.has(id)){seen.add(id);refs.push(value);}return;}
      for(const name of ['inline','details','value','result','content','text','cards'])if(value[name])visit(value[name],depth+1);
    };visit(message);return refs;
  }
  function render(){
    if(!panel||currentKey!==key())return;const s=state(),nearBottom=thread.scrollHeight-thread.scrollTop-thread.clientHeight<100;thread.replaceChildren();
    if(!s.messages.length&&!s.loading)thread.append(el('p','pk-chat-empty','接着问碧琪，或者带着左页的考点来聊。'));
    for(const [i,m]of s.messages.entries()){
      const text=messageText(m),refs=references(m);if(!['user','assistant','toolResult','tool'].includes(m.role)||!text.trim()&&!refs.length)continue;
      if(m.role==='user'&&/^\[\[CLEKK_LEARNING_(?:START|ANSWER|NEXT|BATCH)_V1\]\]/.test(text))continue;
      if(['toolResult','tool'].includes(m.role)&&!refs.length)continue;
      const group=el('article','chat-group '+(m.role==='user'?'user':'assistant')),bubble=el('div','chat-bubble');
      bubble.dataset.messageId=String(m.id||m.messageId||`${m.role}-${stamp(m)}-${i}`);bubble.dataset.messageText=text;
      if(m.partial)bubble.classList.add('streaming');
      if(!['toolResult','tool'].includes(m.role))markup(bubble,text);
      for(const ref of refs){const slot=el('div');slot.dataset.pinkieLearningSlot='desk-'+i;slot.pinkieLearningSession=key();slot.pinkieLearningCards=[ref];bubble.append(slot);if(['desk_card','desk_receipt','desk_plan'].includes(ref.kind))window.__pinkieDeskChat?.bind(slot,[ref],key());else window.__pinkieLearningInline?.mount(ref,slot);}
      group.append(bubble);thread.append(group);
    }
    if(s.running)thread.append(el('p','pk-chat-working','碧琪在想…'));
    status.textContent=s.error||'';sendButton.disabled=s.running||!input.value.trim();stopButton.hidden=!s.running;
    if(nearBottom)thread.scrollTop=thread.scrollHeight;
    window.dispatchEvent(new Event('pinkie:desk-conversation-rendered'));
  }
  async function loadHistory({force=false}={}){
    const k=key(),s=state();if(s.loading)return s.loading;if(s.loaded&&!force)return;
    s.loading=request('chat.history',{limit:200}).then(result=>{if(k!==key())return;const messages=(result.messages||[]).filter(m=>!m.sessionKey||m.sessionKey===k);s.messages=messages;s.loaded=true;s.error='';if(s.running&&messages.some(m=>m.role==='assistant'&&stamp(m)>=s.started&&messageText(m).trim()))s.running=false;}).catch(error=>{if(k===key())s.error='对话暂时没读到：'+error.message;}).finally(()=>{s.loading=null;if(k===key())render();});return s.loading;
  }
  function scheduleFallback(){
    clearTimeout(timer);if(!active()||!state().running)return;
    timer=setTimeout(async()=>{if(!active())return;const s=state();if(Date.now()-s.started>180000){s.running=false;s.error='还没收到完整回复，可以稍后重试。';render();return;}await loadHistory({force:true});scheduleFallback();},2200);
  }
  function ensure(){
    if(panel)return;
    panel=el('aside','pk-ink pk-study-chat');panel.id='pinkie-desk-chat';panel.setAttribute('aria-label','学习台独立对话');panel.hidden=true;
    const head=el('header','pk-chat-head'),label=el('span','','学习台对话'),exit=el('button','','回普通聊天');exit.type='button';exit.addEventListener('click',()=>desk().go('chat'));head.append(label,exit);
    thread=el('div','chat-thread pk-chat-thread');thread.setAttribute('role','log');thread.setAttribute('aria-label','学习台聊天记录');thread.tabIndex=0;
    const composer=el('form','pk-chat-compose'),mark=el('span','pk-chat-pencil');mark.append(desk().icon('pencil',{size:'xs'}));input=el('textarea');input.rows=1;input.placeholder='接着问碧琪…';input.setAttribute('aria-label','学习台聊天输入');
    sendButton=el('button','pk-chat-send','发送');sendButton.type='submit';sendButton.disabled=true;stopButton=el('button','pk-chat-stop','停止');stopButton.type='button';stopButton.hidden=true;
    stopButton.addEventListener('click',async()=>{const s=state();try{await request('chat.abort',{runId:s.runId});s.running=false;s.error='已停止';clearTimeout(timer);render();}catch(error){s.error=error.message;render();}});
    input.addEventListener('input',()=>{state().draft=input.value;sendButton.disabled=state().running||!input.value.trim();});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!sendButton.disabled)composer.requestSubmit();}});
    composer.addEventListener('submit',event=>{event.preventDefault();const text=input.value.trim();if(text&&!state().running)void send(text).catch(()=>{});});
    const close=el('button','pk-chat-fold','⌘J 收起');close.type='button';close.addEventListener('click',()=>window.__pinkieDeskSplit?.close());composer.append(mark,input,sendButton,stopButton,close);
    status=el('p','pk-chat-status');status.setAttribute('role','status');panel.append(head,thread,status,composer);document.body.append(panel);
  }
  function sync(){
    ensure();const shown=doc.dataset.pinkieStudyDesk==='desk'&&Boolean(document.getElementById('pinkie-study-desk'))&&doc.dataset.laolaoMode==='learning';
    const full=Boolean(fullHost?.isConnected),side=shown&&window.__pinkieDeskSplit?.isOpen?.();
    if(!shown||!full&&!side){panel.hidden=true;clearTimeout(timer);doc.removeAttribute('data-pinkie-desk-chat-active');return;}
    const parent=full?fullHost:document.body;if(panel.parentElement!==parent)parent.append(panel);panel.hidden=false;panel.classList.toggle('is-side',!full);doc.setAttribute('data-pinkie-desk-chat-active','');
    if(currentKey!==key()){currentKey=key();input.value=state().draft;render();}void loadHistory();scheduleFallback();
    window.dispatchEvent(new Event('pinkie:desk-conversation-ready'));
  }
  function open(){
    if(doc.dataset.pinkieStudyDesk!=='desk')desk().go(desk().local().deskView==='deskchat'?'today':desk().local().deskView||'today');
    if(!fullHost?.isConnected)window.__pinkieDeskSplit?.open();sync();return panel;
  }
  async function send(text){
    if(!String(text).trim())return;open();await loadHistory();const k=key(),s=state();if(s.running)throw Error('等碧琪说完，或先点停止');
    const message=String(text).trim(),id=crypto.randomUUID();s.started=Date.now();s.error='';s.running=true;s.runId=null;s.draft='';input.value='';s.messages.push({id:'desk-user-'+id,role:'user',content:message,timestamp:s.started});render();
    try{const result=await request('chat.send',{message,idempotencyKey:id},30000);if(k!==key())return result;s.runId=result.runId||id;scheduleFallback();return result;}
    catch(error){if(k===key()){s.running=false;s.error='发送失败：'+error.message;s.draft=message;input.value=message;render();}throw error;}
  }
  window.addEventListener('pinkie:gateway-event',event=>{
    const e=event.detail,p=e?.payload;if(e?.event!=='chat'||p?.sessionKey!==key())return;const s=state();if(p.runId&&s.runId&&p.runId!==s.runId)return;
    if(p.message){const m={...p.message,role:'assistant',id:p.message.id||'desk-run-'+p.runId,partial:p.state==='delta'};const old=s.messages.findIndex(x=>x.id===m.id);if(old>=0)s.messages[old]=m;else s.messages.push(m);}
    if(['final','error','aborted'].includes(p.state)){s.running=false;clearTimeout(timer);s.error=p.state==='error'?p.errorMessage||'回复暂时中断了':'';if(active())void loadHistory({force:true});}render();
  });
  desk()?.registerView('deskchat',{title:'学习台对话',mount(host){fullHost=host;host.classList.add('pk-chat-page');sync();return{unmount(){fullHost=null;sync();}};}});
  const retry=async id=>{open();const result=await request('pinkie.learning.attempts.retry',{id});const activity=result.current||result.activity;if(activity){state().messages.push({role:'assistant',id:'desk-retry-'+activity.id,timestamp:Date.now(),inline:{v:1,kind:'quiz',id:activity.id,sessionKey:key(),revision:result.revision||0}});render();}return result;};
  window.__pinkieStudyConversation={active,sessionKey:key,open,send,retry,sync,root:()=>panel,thread:()=>thread,focus:()=>{open();input.focus();},reload:()=>loadHistory({force:true})};
  for(const name of ['pinkie:study-desk-view','pinkie:study-desk-mounted','pinkie:session-selected','pinkie:desk-split-changed'])window.addEventListener(name,sync);
  window.addEventListener('pinkie:study-desk-unmount',()=>{if(panel)panel.hidden=true;fullHost=null;clearTimeout(timer);doc.removeAttribute('data-pinkie-desk-chat-active');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else sync();});
  sync();
})();
