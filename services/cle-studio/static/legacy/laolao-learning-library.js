// Ported for the C.le. native host.
/* Local learning bookshelf and companion reader. No remote scripts. */
(() => {
  'use strict';
  if(window.__pinkieLibrary)return;
  const state={drawer:null,reader:null,button:null,book:null,locations:[],location:1,zoom:1,pdf:null,epub:null,renderTask:null,renderTicket:0,openTicket:0,searchTicket:0,query:'',books:[],busy:false,progressTimer:0,range:null,file:null,split:null,session:''};
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const session=()=>window.CLE?.host?.sessions?.selectedKey||new URL(location.href).searchParams.get('session')||document.querySelector('.sidebar-recent-session--active[data-session-key]')?.dataset.sessionKey||document.querySelector('openclaw-app-shell')?.context?.gateway?.snapshot?.sessionKey||'';
  const learning=()=>{const mode=document.documentElement.dataset.cleRoom;return mode?mode==='learning':session().startsWith('agent:learning:');};
  const rpc=(suffix,params={},timeout=20000)=>{
    const request=window.__laolaoSidebar?.gwRequest;
    if(typeof request!=='function')return Promise.reject(new Error('学习资料库正在连接，请稍后再试'));
    return request('pinkie.learning.library.'+suffix,{...params,sessionKey:session()},timeout);
  };
  const button=(label,action,cls='')=>{const b=el('button',cls,label);b.type='button';b.addEventListener('click',action);return b;};
  const notice=(text,error=false)=>{
    const status=state.drawer?.querySelector('.pinkie-library__status');
    if(status){status.textContent=text;status.dataset.error=error?'1':'0';}
    let toast=document.querySelector('.laolao-learning-toast');
    if(!toast){toast=el('div','laolao-learning-toast');toast.setAttribute('role','status');document.body.append(toast);}
    toast.textContent=text;toast.dataset.error=error?'1':'0';toast.classList.add('is-visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>toast.classList.remove('is-visible'),2800);
  };
  const task=fn=>async event=>{try{await fn(event);}catch(error){notice(error.message||'这次没有完成，请再试一次',true);}};
  const typeLabel=type=>({pdf:'PDF 教材',epub:'EPUB 电子书',article:'网页剪藏'}[type]||type);
  const authorLabel=book=>String(book.author||'').split(/,|https?:\/\//)[0].trim().slice(0,80);
  const icon=()=>{const holder=el('div','pinkie-library__cover');holder.innerHTML='<svg viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M5 3h14v19H5a3 3 0 0 1 0-6h14M5 3a3 3 0 0 0-3 3v13"/><path d="M7 8h8M7 11h6"/></svg>';return holder;};
  function closeShelf(){if(state.drawer){state.drawer.hidden=true;state.drawer.inert=true;}state.button?.setAttribute('aria-expanded','false');}
  async function shelf(){
    if(!learning())return;
    if(!state.drawer){
      const drawer=el('aside','pinkie-library');drawer.setAttribute('aria-label','学习资料库');
      const head=el('header','pinkie-library__header'), heading=el('div');heading.append(el('div','pinkie-library__eyebrow','LEARNING LIBRARY'),el('h2','','我的资料'));head.append(heading,button('×',closeShelf,'pinkie-library__close'));head.lastChild.setAttribute('aria-label','关闭资料库');
      const intro=el('p','pinkie-library__intro','把值得读的资料放在这里，和碧琪一起读、一起记。');
      const actions=el('div','pinkie-library__actions');actions.append(button('＋ 打开电子书',chooseFile,'pinkie-library__primary'),button('剪藏网页',()=>{clip.hidden=!clip.hidden;if(!clip.hidden)clip.querySelector('input').focus();}));
      const search=el('input','pinkie-library__search');search.type='search';search.placeholder='搜索书名，或正文里的中英文关键词…';search.setAttribute('aria-label','搜索学习资料');
      let timer;search.addEventListener('input',()=>{state.query=search.value.trim();clearTimeout(timer);timer=setTimeout(()=>void loadShelf(),230);});
      const status=el('div','pinkie-library__status','');status.setAttribute('role','status');
      const list=el('div','pinkie-library__list');
      const clip=clipForm();clip.hidden=true;
      drawer.append(head,intro,actions,search,status,list,clip);drawer.addEventListener('keydown',event=>{if(event.key==='Escape'){closeShelf();event.stopPropagation();}});
      document.body.append(drawer);state.drawer=drawer;
    }
    state.drawer.hidden=false;state.drawer.inert=false;state.button?.setAttribute('aria-expanded','true');await loadShelf();
  }
  function clipForm(){
    const form=el('form','pinkie-library__clip');form.append(el('h3','','把网页留成阅读版'),el('p','','粘贴你想读的网址。保留原链接和抓取时间，遵守网站的公开访问规则。'));
    const url=el('input');url.type='url';url.required=true;url.placeholder='https://…';url.setAttribute('aria-label','要剪藏的网页网址');
    const label=el('label'), images=el('input');images.type='checkbox';label.append(images,document.createTextNode('需要插图时，缓存可公开访问的图片'));
    const actions=el('div','pinkie-library__clip-actions'), submit=button('保存阅读版',()=>{},'pinkie-library__primary');submit.type='submit';
    actions.append(submit,button('收起',()=>{form.hidden=true;}));form.append(url,label,actions);
    form.addEventListener('submit',task(async event=>{
      event.preventDefault();if(state.busy)return;state.busy=true;submit.disabled=true;submit.textContent='正在读网页…';
      try{const result=await rpc('clip',{url:url.value,explicit:true,cacheImages:images.checked},90000);notice('已保存阅读版');form.hidden=true;await open(result.book.id);await loadShelf();}
      finally{state.busy=false;submit.disabled=false;submit.textContent='保存阅读版';}
    }));return form;
  }
  async function loadShelf(){
    if(!state.drawer||state.drawer.hidden)return;
    const ticket=++state.searchTicket,query=state.query,list=state.drawer.querySelector('.pinkie-library__list'),status=state.drawer.querySelector('.pinkie-library__status');
    status.textContent=query?'在原文里查找…':'正在打开书架…';
    try{
      const [catalog,found]=await Promise.all([rpc('list',{query}),query?rpc('search',{query,limit:20}):Promise.resolve({results:[]})]);
      if(ticket!==state.searchTicket)return;
      state.books=catalog.books||[];list.replaceChildren();
      const matches=found.results||[];
      status.textContent=query?`${state.books.length} 份标题 · ${matches.length} 处原文`:`${state.books.length} 份资料 · 阅读进度自动保存`;
      for(const book of state.books)list.append(bookCard(book));
      for(const hit of matches){const result=button('',task(()=>open(hit.id,{location:hit.location,quote:query})),'pinkie-library__result');result.append(el('span','pinkie-library__title',hit.title),el('small','pinkie-library__meta',hit.label),el('p','',hit.excerpt));list.append(result);}
      if(!state.books.length&&!matches.length)list.append(el('p','pinkie-library__empty',query?'没有找到这段内容，换个关键词试试。':'先放进一本 PDF、一本 EPUB，或剪藏一篇想读的文章。也可以把文件拖到聊天区。'));
    }catch(error){if(ticket===state.searchTicket){status.textContent=error.message;status.dataset.error='1';}}
  }
  function bookCard(book){
    const card=el('article','pinkie-library__card'),body=el('div'),openButton=button('',task(()=>open(book.id)),'pinkie-library__open');
    openButton.append(el('span','pinkie-library__title',book.title),el('span','pinkie-library__meta',typeLabel(book.type)+(authorLabel(book)?' · '+authorLabel(book):'')));
    const meter=el('div','pinkie-library__progress'),fill=el('span'),position=book.progress?.location||1,percent=book.lastOpenedAt?Math.round(position/book.locations*100):0;fill.style.width=percent+'%';meter.append(fill);
    const recent=book.lastOpenedAt?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(book.lastOpenedAt)+' 打开':'还没开始读';
    body.append(openButton,meter,el('span','pinkie-library__meta',`${percent}% · ${book.type==='pdf'?'第 '+position+' 页':book.type==='epub'?'章节位置 '+position:'正文'} · ${recent}`));
    const remove=button('×',()=>{
      if(card.querySelector('.pinkie-library__confirm'))return;
      const confirm=el('div','pinkie-library__confirm');confirm.append(el('p','',`删除《${book.title}》？资料和阅读进度会移出书架，学习笔记仍保留。`),button('确认删除',task(async()=>{await rpc('remove',{id:book.id,confirm:'REMOVE_LEARNING_MATERIAL'});if(state.book?.id===book.id)closeReader();await loadShelf();}),'pinkie-library__primary'),button('保留',()=>confirm.remove()));card.append(confirm);
    },'pinkie-library__remove');remove.setAttribute('aria-label','删除 '+book.title);card.append(icon(),body,remove);return card;
  }
  function chooseFile(){
    if(!learning())return;
    const input=el('input');input.type='file';input.accept='.pdf,.epub,application/pdf,application/epub+zip';input.hidden=true;document.body.append(input);
    input.addEventListener('change',task(async()=>{try{for(const file of input.files||[])await importFile(file);}finally{input.remove();}}),{once:true});input.addEventListener('cancel',()=>input.remove(),{once:true});input.click();
  }
  const base64=bytes=>{let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);};
  async function importFile(file){
    if(state.busy)throw new Error('先等当前资料导入完成');
    state.busy=true;let token;
    try{
      const begin=await rpc('import.begin',{name:file.name,size:file.size});token=begin.token;
      for(let offset=0;offset<file.size;offset+=begin.partBytes){const data=new Uint8Array(await file.slice(offset,offset+begin.partBytes).arrayBuffer());await rpc('import.part',{token,offset,data:base64(data)});notice('正在放进书架 · '+Math.round(Math.min(file.size,offset+data.length)/file.size*100)+'%');}
      notice('正在整理目录和全文索引…');const result=await rpc('import.finish',{token},180000);token=null;
      notice(result.duplicate?'这本书已在书架里':'已放进书架');await open(result.book.id);await loadShelf();return result;
    }finally{state.busy=false;if(token)await rpc('import.abort',{token}).catch(()=>{});}
  }
  async function sourceFile(book){
    const bytes=new Uint8Array(book.bytes);
    for(let offset=0;offset<book.bytes;offset+=256*1024){const part=await rpc('file',{id:book.id,offset});const raw=atob(part.data);for(let i=0;i<raw.length;i++)bytes[offset+i]=raw.charCodeAt(i);}
    return bytes;
  }
  function mountReader(){
    const split=document.querySelector('.chat-pane-cache__pane--active .chat-split-container');if(!split)throw new Error('聊天区还没有准备好');
    if(state.reader?.isConnected&&state.reader.parentElement===split)return;
    state.reader?.remove();state.split?.classList.remove('pinkie-library-layout');state.split=split;
    const reader=el('section','pinkie-reader');reader.setAttribute('aria-label','原文阅读器');
    const head=el('header','pinkie-reader__header'),heading=el('div','pinkie-reader__heading');heading.append(el('h2','pinkie-reader__title'),el('div','pinkie-reader__subtitle'));head.append(heading,button('×',closeReader));head.lastChild.setAttribute('aria-label','关闭阅读器');
    const toolbar=el('div','pinkie-reader__toolbar'),select=el('select');select.setAttribute('aria-label','页码或章节');select.addEventListener('change',task(()=>go(Number(select.value))));
    toolbar.append(button('‹',task(()=>go(state.location-1))),select,button('›',task(()=>go(state.location+1))),button('−',task(()=>zoom(-.1))),el('span','pinkie-reader__zoom','100%'),button('＋',task(()=>zoom(.1))),button('查找',()=>{find.hidden=!find.hidden;if(!find.hidden)find.querySelector('input').focus();}));
    toolbar.children[0].setAttribute('aria-label','上一页或章');toolbar.children[2].setAttribute('aria-label','下一页或章');toolbar.children[3].setAttribute('aria-label','缩小原文');toolbar.children[5].setAttribute('aria-label','放大原文');
    const find=el('form','pinkie-reader__find');find.hidden=true;const query=el('input');query.type='search';query.placeholder='在这份资料里查找…';query.setAttribute('aria-label','查找原文');const submit=button('定位',()=>{});submit.type='submit';find.append(query,submit);find.addEventListener('submit',task(async event=>{event.preventDefault();if(!query.value.trim())return;const matches=await rpc('search',{query:query.value,id:state.book.id,limit:30});state.matches=matches.results||[];state.matchIndex=0;if(!state.matches.length)return notice('这份资料里没有找到');await go(state.matches[0].location,query.value);notice('找到 '+state.matches.length+' 处原文');}));find.append(button('下一处',task(async()=>{if(!state.matches?.length)return;state.matchIndex=(state.matchIndex+1)%state.matches.length;await go(state.matches[state.matchIndex].location,query.value);})));
    const body=el('div','pinkie-reader__body'),content=el('article','pinkie-reader__content');content.dataset.pinkieReading='1';body.append(content);body.addEventListener('scroll',()=>scheduleProgress(),{passive:true});
    const range=el('div','pinkie-reader__range');range.hidden=true;const start=el('input'),end=el('input');for(const field of [start,end]){field.type='number';field.min='1';}start.setAttribute('aria-label','阅读范围起点');end.setAttribute('aria-label','阅读范围终点');range.append(document.createTextNode('范围'),start,document.createTextNode('至'),end,button('开始伴读',task(async()=>{const result=await rpc('chapter',{id:state.book.id,start:Number(start.value),end:Number(end.value)});await send(result.prompt);range.hidden=true;notice('碧琪正在读这段内容，会逐题检查理解');}),'pinkie-library__primary'));
    const footer=el('footer','pinkie-reader__footer');footer.append(el('span','pinkie-reader__position'),button('让碧琪读这一章',()=>{range.hidden=!range.hidden;const chapter=chapterRange();start.value=chapter.start;end.value=chapter.end;start.max=end.max=state.book.locations;}),'');footer.lastChild?.nodeType===3&&footer.lastChild.remove();
    reader.append(head,toolbar,find,body,range,footer);split.prepend(reader);split.classList.add('pinkie-library-layout');state.reader=reader;
  }
  function chapterRange(){
    if(state.book.type!=='pdf')return {start:state.location,end:state.location};
    const entries=state.book.outline||[],current=[...entries].reverse().find(x=>x.location<=state.location),next=entries.find(x=>x.location>state.location),start=current?.location||state.location;
    return {start,end:Math.min(state.book.locations,next?next.location-1:start+4,start+39)};
  }
  async function open(id,anchor={}){
    if(!learning())return;
    const ticket=++state.openTicket;clearTimeout(state.progressTimer);await flushProgress();
    const data=await rpc('book',{id});if(ticket!==state.openTicket)return;
    await releaseBook();state.book=data.book;state.locations=data.locations;state.location=Number(anchor.location||data.book.progress?.location||1);state.zoom=data.book.progress?.zoom||1;state.session=session();
    mountReader();closeShelf();const content=state.reader.querySelector('.pinkie-reader__content');content.textContent='正在打开原文…';
    if(data.book.type==='pdf'){
      await import('/cle/static/legacy/laolao-vendor-pdf-compat.js?v=library1');
      const [pdf,bytes]=await Promise.all([import('/cle/static/legacy/laolao-vendor-pdf.mjs?v=6.4.299'),sourceFile(data.book)]);if(ticket!==state.openTicket)return;
      pdf.GlobalWorkerOptions.workerSrc='/cle/static/legacy/laolao-vendor-pdf-worker.mjs?v=6.4.299';state.pdfAPI=pdf;
      state.pdfTask=pdf.getDocument({data:bytes,isEvalSupported:false,cMapUrl:'/cle/static/legacy/laolao-vendor-pdf-cmaps/',cMapPacked:true,standardFontDataUrl:'/cle/static/legacy/laolao-vendor-pdf-standard-fonts/',wasmUrl:'/cle/static/legacy/laolao-vendor-pdf-wasm/'});state.pdf=await state.pdfTask.promise;
    }else if(data.book.type==='epub'){
      const [epub,bytes]=await Promise.all([import('/cle/static/legacy/laolao-vendor-epub.mjs?v=78914ae'),sourceFile(data.book)]);if(ticket!==state.openTicket)return;
      const archive=epub.unzipSync(bytes),decode=new TextDecoder();
      state.epub=await new epub.EPUB({loadText:async name=>archive[name]?decode.decode(archive[name]):null,loadBlob:async name=>archive[name]?new Blob([archive[name]]):null,getSize:name=>archive[name]?.length||0,sha1:async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-1',bytes))}).init();
      if(state.epub.sections.length!==data.book.locations)throw new Error('电子书目录与索引不一致，请重新导入');
    }
    if(ticket!==state.openTicket)return;
    await go(state.location,anchor.quote||'',anchor.location?0:data.book.progress?.scroll||0);
    return data;
  }
  async function releaseBook(){
    state.renderTask?.cancel();state.renderTask=null;state.epub?.destroy();state.epub=null;
    if(state.pdfTask)await state.pdfTask.destroy().catch(()=>{});state.pdfTask=null;state.pdf=null;
  }
  async function go(location,quote='',scroll=0){
    if(!state.book||!Number.isInteger(location)||location<1||location>state.book.locations)return;
    const ticket=++state.renderTicket;state.renderTask?.cancel();state.location=location;state.quote=quote;
    const reader=state.reader,book=state.book;reader.querySelector('.pinkie-reader__title').textContent=book.title;
    const subtitle=reader.querySelector('.pinkie-reader__subtitle');subtitle.textContent=typeLabel(book.type)+(authorLabel(book)?' · '+authorLabel(book):'');
    if(book.sourceURL){const link=el('a','pinkie-reader__source','原网页');link.href=book.sourceURL;link.target='_blank';link.rel='noopener noreferrer';subtitle.append(document.createTextNode(' · '),link,document.createTextNode(' · '+new Date(book.fetchedAt).toLocaleDateString('zh-CN')));}
    const select=reader.querySelector('.pinkie-reader__toolbar select');if(select.options.length!==state.locations.length){select.replaceChildren();for(const item of state.locations){const option=el('option','',item.label);option.value=item.location;select.append(option);}}
    select.value=location;const controls=reader.querySelector('.pinkie-reader__toolbar').children;controls[0].disabled=location<=1;controls[2].disabled=location>=book.locations;
    const body=reader.querySelector('.pinkie-reader__body'),content=reader.querySelector('.pinkie-reader__content');content.replaceChildren();content.style.fontSize=16*state.zoom+'px';
    reader.querySelector('.pinkie-reader__zoom').textContent=Math.round(state.zoom*100)+'%';
    reader.querySelector('.pinkie-reader__position').textContent=(book.type==='pdf'?`第 ${location} / ${book.locations} 页`:book.type==='epub'?`章节位置 ${location} / ${book.locations}`:'阅读版 · '+book.locations+' 节');
    const range=await rpc('range',{id:book.id,start:location,end:location});if(ticket!==state.renderTicket)return;state.range=range;
    if(book.type==='pdf'){
      const page=await state.pdf.getPage(location);if(ticket!==state.renderTicket)return;
      const fit=Math.max(200,body.clientWidth-44)/page.getViewport({scale:1}).width,viewport=page.getViewport({scale:fit*state.zoom});
      const surface=el('div','pinkie-reader__pdf'),canvas=el('canvas'),text=el('div','textLayer');surface.style.width=viewport.width+'px';surface.style.height=viewport.height+'px';surface.style.setProperty('--total-scale-factor',viewport.scale);
      const scale=Math.min(devicePixelRatio||1,2);canvas.width=Math.ceil(viewport.width*scale);canvas.height=Math.ceil(viewport.height*scale);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';surface.append(canvas,text);content.append(surface);
      state.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:scale===1?null:[scale,0,0,scale,0,0]});
      try{await state.renderTask.promise;}catch(error){if(error.name==='RenderingCancelledException')return;throw error;}
      await new state.pdfAPI.TextLayer({textContentSource:await page.getTextContent(),container:text,viewport}).render();
    }else{
      if(state.epub)await state.epub.sections[location-1].createDocument();
      // HTML comes only from the gateway's inert allowlist, never from raw EPUB.
      content.innerHTML=range.pages[0]?.html||'';
      if(!content.textContent.trim()&&!content.querySelector('img'))content.textContent=range.pages[0]?.text||'这一页没有正文。';
    }
    if(ticket!==state.renderTicket)return;
    body.scrollTop=scroll*Math.max(0,body.scrollHeight-body.clientHeight);if(quote)highlight(quote);await flushProgress();
    window.dispatchEvent(new CustomEvent('pinkie:library-location',{detail:{id:book.id,location,type:book.type}}));
  }
  function findRange(quote){
    const root=state.reader?.querySelector('.pinkie-reader__content');if(!root)return null;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[],chars=[],map=[];let node;
    while(node=walker.nextNode()){if(node.parentElement?.closest('.pinkie-reader__pdf-highlight'))continue;nodes.push(node);for(let i=0;i<node.textContent.length;i++){const normalized=node.textContent[i].normalize('NFKC').toLowerCase();for(const ch of normalized){if(/\s/u.test(ch))continue;chars.push(ch);map.push({node,offset:i});}}}
    const needle=String(quote).normalize('NFKC').toLowerCase().replace(/\s/gu,''),at=chars.join('').indexOf(needle);if(at<0||!needle)return null;
    const start=map[at],end=map[at+needle.length-1],range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset+1);return range;
  }
  function highlight(quote){
    const root=state.reader?.querySelector('.pinkie-reader__content');if(!root)return false;
    root.querySelectorAll('.pinkie-reader__pdf-highlight').forEach(n=>n.remove());root.querySelectorAll('mark').forEach(n=>n.replaceWith(...n.childNodes));
    const range=findRange(quote);if(!range){notice('已回到原文位置，未能准确高亮这段文字');return false;}
    if(state.book.type==='pdf'){
      const surface=root.querySelector('.pinkie-reader__pdf'),bounds=surface.getBoundingClientRect();for(const rect of range.getClientRects()){const mark=el('span','pinkie-reader__pdf-highlight');Object.assign(mark.style,{left:rect.left-bounds.left+'px',top:rect.top-bounds.top+'px',width:rect.width+'px',height:rect.height+'px'});surface.append(mark);}
      const mark=surface.querySelector('.pinkie-reader__pdf-highlight');mark?.scrollIntoView({block:'center',behavior:'instant'});
    }else{
      const mark=el('mark');mark.append(range.extractContents());range.insertNode(mark);mark.scrollIntoView({block:'center',behavior:'instant'});
    }
    return true;
  }
  async function zoom(delta){state.zoom=Math.max(.6,Math.min(2,Math.round((state.zoom+delta)*10)/10));await go(state.location,state.quote);}
  function scheduleProgress(){clearTimeout(state.progressTimer);state.progressTimer=setTimeout(()=>void flushProgress(),500);}
  async function flushProgress(){
    if(!state.book||!state.reader?.isConnected||!learning())return;
    const body=state.reader.querySelector('.pinkie-reader__body'),max=Math.max(0,body.scrollHeight-body.clientHeight),id=state.book.id;
    try{const result=await rpc('progress',{id,location:state.location,zoom:state.zoom,scroll:max?body.scrollTop/max:0});if(state.book?.id===id)state.book=result.book;}catch(error){notice('进度暂未保存：'+error.message,true);}
  }
  function closeReader(){void flushProgress();++state.openTicket;++state.renderTicket;state.reader?.remove();state.reader=null;state.split?.classList.remove('pinkie-library-layout');state.split=null;void releaseBook();state.book=null;}
  async function send(message){const request=window.__laolaoSidebar?.gwRequest;if(!request)throw new Error('聊天正在连接');return request('chat.send',{sessionKey:session(),message,idempotencyKey:crypto.randomUUID()},30000);}
  function selectionSource(selected){if(!state.book||!selected.anchor?.closest('[data-pinkie-reading]'))return null;return {id:state.book.id,title:state.book.title,location:state.location,label:state.locations.find(x=>x.location===state.location)?.label||'',quote:selected.text};}
  async function saveSelection(selected){const source=selectionSource(selected);if(!source)return;const result=await rpc('excerpt',source);notice('已记下书名、位置和原文');window.dispatchEvent(new CustomEvent('pinkie:library-note-saved',{detail:result.note}));return result;}
  async function askSelection(selected){const source=selectionSource(selected);if(!source)return;await send('请用通俗的话解释下面这段原文，并在回答里引用这段话和出处。\n【'+source.title+' · '+source.label+'】\n<file name="选中的原文">\n'+source.quote+'\n</file>\n出处链接：#learning-book='+source.id+'&location='+source.location+'&quote='+encodeURIComponent(source.quote.slice(0,500)));notice('已把这段原文交给碧琪');}
  function reconcile(){
    if(!learning()){closeShelf();state.button?.remove();state.button=null;if(state.reader)closeReader();return;}
    const actions=document.querySelector('.chat-pane-cache__pane--active .agent-chat__composer-lead');
    if(actions){if(!state.button?.isConnected){state.button=button('资料',task(shelf),'laolao-learning-notebook-button pinkie-library-entry');state.button.setAttribute('aria-expanded','false');}if(state.button.parentElement!==actions)actions.prepend(state.button);}
    if(state.reader&&state.book&&!state.reader.isConnected){try{mountReader();void go(state.location,state.quote);}catch{}}
    const selected=session();if(state.session&&selected!==state.session&&state.reader)closeReader();
    const url=new URL(location.href),id=url.searchParams.get('learning_book');if(id&&state.lastURL!==url.href){state.lastURL=url.href;void open(id,{location:Number(url.searchParams.get('learning_location'))||1,quote:url.searchParams.get('learning_quote')||''}).catch(e=>notice(e.message,true));}
  }
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');if(!link)return;const hash=new URL(link.href,location.href).hash;
    if(!hash.startsWith('#learning-book='))return;event.preventDefault();event.stopImmediatePropagation();const p=new URLSearchParams(hash.slice(1));
    void open(p.get('learning-book'),{location:Number(p.get('location'))||1,quote:p.get('quote')||''}).catch(e=>notice(e.message,true));
  },true);
  document.addEventListener('dragover',event=>{if(learning()&&event.target.closest?.('.chat-workbench,.chat-thread')&&[...event.dataTransfer?.types||[]].includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';}},true);
  document.addEventListener('drop',event=>{
    if(!learning()||!event.target.closest?.('.chat-workbench,.chat-thread'))return;
    const files=[...event.dataTransfer?.files||[]].filter(file=>/\.(pdf|epub)$/i.test(file.name));if(!files.length)return;
    event.preventDefault();event.stopImmediatePropagation();void (async()=>{for(const file of files)await importFile(file);})().catch(e=>notice(e.message,true));
  },true);
  for(const name of ['laolao:modechange','pinkie:session-selected'])window.addEventListener(name,reconcile);
  window.addEventListener('pagehide',()=>{clearTimeout(state.progressTimer);void flushProgress();});
  let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.pdf&&state.reader)void go(state.location,state.quote);},250);});
  setInterval(reconcile,1200);
  window.__pinkieLibrary={shelf,open,closeReader,chooseFile,importFile,saveSelection,askSelection,selectionSource,highlight,go,get state(){return state;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reconcile,{once:true});else reconcile();
})();
