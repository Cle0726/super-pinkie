/* Independent sidebar DOM: never move Lit-owned native session nodes. */
(() => {
  'use strict';
  const cache=new Map(),loading=new Map();
  let current=null,revision=0,archived=false,query='',limit=30,signature='',lastMode='';
  const el=(tag,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
  function button(text,label,action){const b=el('button','laolao-managed-button',text);b.type='button';b.setAttribute('aria-label',label);b.title=label;b.onclick=action;return b;}
  function invalidate(){for(const entry of cache.values())entry.stale=true;revision++;signature='';if(current)void load(current.api);}
  async function load(api){
    const key=api.mode+'|'+archived;
    if(loading.has(key)||cache.has(key)&&!cache.get(key).stale)return;
    const version=revision,archiveView=archived;
    const job=api.gwRequest('sessions.list',{agentId:api.agentId,archived:archiveView,includeDerivedTitles:true,limit:1000});loading.set(key,job);
    try{
      const data=await job;if(version!==revision)return;
      const rows=(data.sessions||[]).filter(s=>s.key?.startsWith('agent:'+api.agentId+':'));
      cache.set(key,{rows,at:Date.now()});
    }catch(error){cache.set(key,{rows:cache.get(key)?.rows||[],error:error.message,at:Date.now()});if(current?.api.mode===api.mode)api.toast('会话列表暂未刷新：'+error.message);}
    finally{if(loading.get(key)===job)loading.delete(key);signature='';if(current)render(current.section,current.api);}
  }
  const title=s=>[s.label,s.derivedTitle,s.title,s.displayName,s.name].find(v=>typeof v==='string'&&v.trim()&&!/^agent:/.test(v))||(s.key?.endsWith(':main')?'主会话':'未命名会话');
  function timeLabel(value){const minutes=Math.max(0,Math.floor((Date.now()-(Number(value)||0))/60000));return !value?'':minutes<1?'刚刚':minutes<60?minutes+'分':minutes<1440?Math.floor(minutes/60)+'小时':Math.floor(minutes/1440)+'天';}
  function row(s,api){
    const n=el('div','sidebar-recent-session session-row-host');n.dataset.sessionKey=s.key;
    n.classList.toggle('sidebar-recent-session--active',s.key===api.currentKey);
    const link=el('a','sidebar-recent-session__link');link.href='/chat?session='+encodeURIComponent(s.key);link.title=title(s);
    link.append(el('span','sidebar-recent-session__name',title(s)));
    link.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();api.navigateSession(s.key);};
    const aside=el('span','session-row-aside');aside.append(el('span','session-row-trail',timeLabel(s.updatedAt)));
    const actions=el('span','laolao-row-actions');
    if(archived){
      actions.append(
        button('↶','恢复会话：'+title(s),async e=>{const b=e.currentTarget;b.disabled=true;try{await api.patchSession(s.key,{archived:false});api.toast('会话已恢复，记录和项目绑定都保留');}catch(error){api.toast(error.message);}finally{b.disabled=false;}}),
        button('⋯','管理已归档会话：'+title(s),e=>api.sessionMenu(e.currentTarget,s.key,title(s),true))
      );
    } else actions.append(button('⋯','管理会话：'+title(s),e=>api.sessionMenu(e.currentTarget,s.key,title(s),false)));
    aside.append(actions);n.append(link,aside);return n;
  }
  function group(id,name,rows,api,project){
    const n=el('section','laolao-group');n.dataset.laolaoGroup=id;
    const head=el('div','laolao-group__head');const collapsed=!!api.state.collapsed[id];
    const toggle=button(collapsed?'›':'⌄',(collapsed?'展开':'收起')+name,()=>api.toggleGroup(id));toggle.classList.add('laolao-group__toggle');toggle.setAttribute('aria-expanded',String(!collapsed));
    const label=el('span','laolao-group__label',name);label.onclick=()=>api.toggleGroup(id);
    head.append(toggle,label,el('span','laolao-group__count',String(rows.length||'')));
    if(project){
      const add=button('＋','在项目「'+name+'」中新建会话',async()=>{add.disabled=true;try{await api.createProjectSession(name);}finally{add.disabled=false;}});add.classList.add('laolao-group__action');
      const settings=button('⋯','管理项目「'+name+'」',e=>api.openProjectSettings(e.currentTarget,name));settings.classList.add('laolao-group__action');head.append(add,settings);
      const path=api.state.projectFolders[name];
      if(path){const open=button('打开','在 Finder 中打开项目「'+name+'」',()=>api.revealProject(path));open.classList.add('laolao-group__action','laolao-group__open');head.insertBefore(open,settings);}
    }
    n.append(head);
    if(!collapsed){
      const list=el('div','laolao-group__list');for(const s of rows)list.append(row(s,api));
      if(!rows.length)list.append(el('div','laolao-group__empty',loading.size?'正在读取…':project?'点 ＋ 开始一个会话':'暂无会话'));
      if(project&&api.state.projectFolders[name]){const p=el('div','laolao-project__path',api.state.projectFolders[name].replace(/^\/Users\/[^/]+/,'~'));p.title=api.state.projectFolders[name];n.append(p);}
      n.append(list);
    }
    return n;
  }
  function render(section,api){
    current={section,api};
    if(lastMode!==api.mode){lastMode=api.mode;query='';archived=false;limit=30;signature='';}
    const key=api.mode+'|'+archived;void load(api);
    // Only our DOM is rebuilt. Native list remains mounted and can reconcile safely.
    section.classList.add('laolao-managed-sessions');
    let host=section.querySelector('#laolao-session-manager');
    if(!host){host=el('div');host.id='laolao-session-manager';section.append(host);signature='';}
    const rows=cache.get(key)?.rows||[];
    const next=JSON.stringify([api.mode,archived,query,limit,rows,api.state,api.currentKey,Math.floor(Date.now()/60000)]);
    if(signature===next)return;signature=next;
    let search=host.querySelector('.laolao-session-search');
    if(!search){search=el('input','laolao-session-search');search.type='search';search.placeholder='搜索当前模式的会话';search.setAttribute('aria-label','搜索当前模式的会话');search.oninput=()=>{query=search.value;signature='';render(current.section,current.api);};}
    search.value=query;
    let controls=host.querySelector('.laolao-session-controls');
    if(!controls){controls=el('div','laolao-session-controls');controls.append(search);host.append(controls);}
    for(const n of [...controls.children])if(n!==search)n.remove();
    controls.append(button(archived?'‹ 返回':'归档',archived?'返回进行中的会话':'查看已归档会话',()=>{archived=!archived;limit=30;signature='';render(section,api);}));
    const old=host.querySelector('.laolao-managed-groups');const groups=el('div','laolao-managed-groups');
    const filtered=rows.filter(s=>title(s).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    if(archived)groups.append(group('__archive','已归档',filtered,api));
    else{
      const pinned=filtered.filter(s=>api.state.pins.includes(s.key));if(pinned.length)groups.append(group('__pins','置顶',pinned,api));
      const heading=el('div','laolao-group__head');heading.append(el('span','laolao-group__label','项目文件夹'));
      const add=button('＋ 打开文件夹','选择文件夹并建立项目',()=>api.addFolderProject());add.classList.add('laolao-group__action','laolao-group__add-project');heading.append(add);groups.append(heading);
      const assigned=new Set();
      for(const [name,keys] of Object.entries(api.state.projects)){
        keys.forEach(k=>assigned.add(k));
        const projectRows=filtered.filter(s=>keys.includes(s.key)&&!api.state.pins.includes(s.key));
        if(query&&!projectRows.length&&!name.toLowerCase().includes(query.toLowerCase()))continue;
        groups.append(group('proj:'+name,name,projectRows,api,true));
      }
      const recent=filtered.filter(s=>!assigned.has(s.key)&&!api.state.pins.includes(s.key));
      groups.append(group('__recent','最近',recent.slice(0,limit),api));
      if(recent.length>limit)groups.append(button('显示更多会话','显示更多当前模式会话',()=>{limit+=30;signature='';render(section,api);}));
    }
    if(old)old.replaceWith(groups);else host.append(groups);
  }
  function chooseFolder(value,request){
    return new Promise(resolve=>{
      const mask=el('div','laolao-modal-mask');const dialog=el('form','laolao-modal');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
      dialog.append(el('h3','laolao-modal__title','选择项目文件夹'),el('p','laolao-modal__body','浏览器不能直接取得本机文件夹路径。粘贴完整路径即可，App 内仍可使用系统选择器。'));
      const input=el('input','laolao-menu__input');input.value=value||'';input.placeholder='/完整路径/项目文件夹';input.setAttribute('aria-label','项目文件夹完整路径');dialog.append(input);
      const error=el('p','laolao-modal__body');error.setAttribute('role','status');dialog.append(error);
      const actions=el('div','laolao-modal__buttons');const cancel=button('取消','取消选择文件夹',()=>finish(null));const ok=button('使用这个文件夹','确认项目文件夹',()=>{});ok.type='submit';actions.append(cancel,ok);dialog.append(actions);mask.append(dialog);document.body.append(mask);
      function finish(result){mask.remove();resolve(result);}
      dialog.onsubmit=async e=>{e.preventDefault();ok.disabled=true;try{const result=await request('pinkie.project.validate',{path:input.value.trim()});finish({path:result.path,name:result.path.split('/').filter(Boolean).pop()});}catch(e){error.textContent=e.message;}finally{ok.disabled=false;}};
      mask.onkeydown=e=>{if(e.key==='Escape')finish(null);};input.focus();
    });
  }
  window.PinkieSessionList={render,invalidate,chooseFolder};
  let refreshTimer;
  window.addEventListener('laolao:sessions-changed',()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(invalidate,250);});
  setInterval(()=>{if(current&&!document.hidden)invalidate();},20000);
})();
