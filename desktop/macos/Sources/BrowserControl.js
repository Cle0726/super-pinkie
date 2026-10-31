/* Pinkie browser control v3. Embedded into BrowserControl.swift; no external
 * browser, account, executable page snippets or background polling required.
 * Community design references: agent-browser snapshot refs; Playwright MCP
 * structured observations. This implementation targets the existing WKWebView.
 */
(() => {
  'use strict';
  if (globalThis.__pinkieBrowserControl?.version === 3) return;
  const selector = 'a[href],button,input:not([type="hidden"]),textarea,select,summary,label[for],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="textbox"],[role="searchbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[role="slider"],[role="spinbutton"],[role="treeitem"]';
  const page = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const state = {refs:new Map(), ids:new WeakMap(), seq:0, revision:0, fingerprint:'', stable:new Map()};
  const clean = (v,n=240) => String(v??'').replace(/\s+/g,' ').trim().slice(0,n);
  const bound = (v,d,max) => Math.max(1,Math.min(max,Number(v)||d));
  const role = el => el.getAttribute('role') || ({A:'link',BUTTON:'button',TEXTAREA:'textbox',SELECT:'combobox',SUMMARY:'button',LABEL:'label',INPUT:({checkbox:'checkbox',radio:'radio',button:'button',submit:'button',search:'searchbox',range:'slider',number:'spinbutton'}[el.type]||'textbox')}[el.tagName]) || (el.isContentEditable?'textbox':'button');
  function name(el) {
    const explicit=el.getAttribute('aria-label');if(explicit)return clean(explicit);
    const labels=el.getAttribute('aria-labelledby');if(labels){const text=labels.split(/\s+/).map(id=>el.ownerDocument.getElementById(id)?.textContent||'').join(' ');if(clean(text))return clean(text);}
    return clean(el.labels?.[0]?.textContent || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.textContent || (['button','submit'].includes(el.type)?el.value:''));
  }
  function geometry(el,viewport=false) {
    if(!el?.isConnected || el.closest?.('[hidden],[inert],[aria-hidden="true"]'))return null;
    const rect=el.getBoundingClientRect(),win=el.ownerDocument.defaultView;
    if(!rect.width||!rect.height||!win)return null;
    if(viewport&&(rect.bottom<=0||rect.right<=0||rect.top>=win.innerHeight||rect.left>=win.innerWidth))return null;
    const style=win.getComputedStyle(el);
    if(style.visibility==='hidden'||style.visibility==='collapse'||style.display==='none'||Number(style.opacity)===0)return null;
    if(typeof el.checkVisibility==='function'&&!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return null;
    return rect;
  }
  function refFor(el) {let ref=state.ids.get(el);if(!ref){ref=page+'e'+(++state.seq);state.ids.set(el,ref);state.refs.set(ref,el);}return ref;}
  function prune() {if(state.refs.size>600)for(const [ref,el]of state.refs)if(!el.isConnected)state.refs.delete(ref);if(state.stable.size>64)state.stable.clear();}
  function walk(root,visit,{maxNodes=14000}={}) {
    const seen=new Set();let nodes=0,truncated=false,stopped=false;
    function descend(current,depth) {
      if(!current||seen.has(current)||stopped||depth>12)return;seen.add(current);
      const doc=current.ownerDocument||current,walker=doc.createTreeWalker(current,1);
      let el=current.nodeType===1?current:walker.nextNode();
      while(el&&!stopped){
        if(++nodes>maxNodes){truncated=stopped=true;break;}
        if(visit(el)===false){truncated=stopped=true;break;}
        if(el.shadowRoot)descend(el.shadowRoot,depth+1);
        if(el.tagName==='IFRAME'){try{if(el.contentDocument?.documentElement&&geometry(el))descend(el.contentDocument,depth+1);}catch{}}
        el=walker.nextNode();
      }
    }
    descend(root,0);return {nodes,truncated};
  }
  function readText(root,maxChars) {
    if(!root)return '';
    const output=[],doc=root.ownerDocument||root,walker=doc.createTreeWalker(root,4);let n,count=0,size=0,previous;
    const visible=new WeakMap();
    while((n=walker.nextNode())&&count++<18000&&size<maxChars){const el=n.parentElement;if(!el||el.closest('script,style,noscript,template,svg,[hidden],[inert],[aria-hidden="true"]'))continue;
      const value=clean(n.nodeValue,maxChars-size);if(!value)continue;
      if(!visible.has(el))visible.set(el,Boolean(geometry(el)));if(!visible.get(el))continue;
      const sep=previous===el?' ':'\n';output.push(sep+value);size+=sep.length+value.length;previous=el;
    }
    return output.join('').trim().slice(0,maxChars);
  }
  function textRoot() {return [...document.querySelectorAll('main,article,[role="main"]')].find(el=>geometry(el))||document.body;}
  function snapshot(p={}) {
    const start=performance.now(),compact=p.compact!==false,limit=bound(p.maxElements,compact?80:200,300),maxChars=bound(p.maxChars,compact?2400:12000,30000),elements=[],frames=[];let optionBudget=32;
    const target=(p.ref||p.selector)?resolve(p):{el:document};if(target.reason)return target;
    const stats=walk(target.el,el=>{if(el.tagName==='IFRAME'&&geometry(el,p.scope!=='page')){let accessible=false;try{accessible=Boolean(el.contentDocument);}catch{}frames.push({ref:refFor(el),title:name(el),accessible});}if(!el.matches(selector))return;const r=geometry(el,p.scope!=='page');if(!r)return;
      const item={ref:refFor(el),role:role(el),name:name(el)};
      if(el.disabled||el.getAttribute('aria-disabled')==='true')item.disabled=true;
      if('checked'in el&&['checkbox','radio'].includes(el.type))item.checked=el.checked;
      if(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)&&el.type!=='password')item.value=clean(el.value,200);
      if(el.type==='password')item.protected=true;
      if(el.type==='range')item.slider=sliderMetrics(el);
      if(el.tagName==='SELECT'){
        const options=el.options,shown=Array.from({length:Math.min(options.length,12,optionBudget)},(_,i)=>options[i]);optionBudget-=shown.length;
        item.options=shown.map(o=>({value:clean(o.value,80),label:clean(o.label,72),...(o.disabled?{disabled:true}:{})}));
        if(options.length>shown.length)item.optionsTruncated=true;
      }
      if(p.includeRects)item.rect={x:r.x,y:r.y,width:r.width,height:r.height};
      elements.push(item);if(elements.length>=limit)return false;
    });
    const root=target.el===document?textRoot():target.el;
    const text=p.includeText===false?'':readText(root,maxChars),fingerprint=JSON.stringify([p.scope||'viewport',text,elements,frames]);
    if(fingerprint!==state.fingerprint){state.revision++;state.fingerprint=fingerprint;}
    const snapshotId=page+':'+state.revision,unchanged=p.since===snapshotId;prune();
    return {title:document.title,snapshotId,readyState:document.readyState,scope:p.scope==='page'?'page':'viewport',text:unchanged?'':text,elements:unchanged?[]:elements,frames:unchanged?[]:frames,unchanged,truncated:stats.truncated,scannedNodes:stats.nodes,elementCount:elements.length,durationMs:Math.round((performance.now()-start)*10)/10};
  }
  function locate(p) {
    const matches=[],limit=bound(p.limit,8,40),needle=clean(p.name||p.text||'',500).toLocaleLowerCase();
    const stats=walk(document,el=>{if(p.selector?!el.matches(p.selector):!el.matches(selector))return;if(p.role&&role(el)!==p.role)return;
      const value=name(el),text=value.toLocaleLowerCase();if(needle&&(p.exact?text!==needle:!text.includes(needle)))return;
      const rect=geometry(el);if(!rect)return;matches.push({ref:refFor(el),role:role(el),name:value,inViewport:Boolean(geometry(el,true))});if(matches.length>=limit)return false;
    });
    return {matches,ambiguous:matches.length>1,truncated:stats.truncated,scannedNodes:stats.nodes};
  }
  function resolve(p) {
    if(p.ref){const el=state.refs.get(p.ref);if(!el?.isConnected)return {reason:'元素引用已失效，请重新 snapshot 或 locate；没有执行操作。',code:'stale-ref'};return {el};}
    if(p.selector){const found=[];walk(document,el=>{if(el.matches(p.selector)){found.push(el);if(found.length>1)return false;}});if(found.length>1)return {reason:'selector 匹配了多个控件，请使用唯一 ref 或更具体的 selector。'};return found[0]?{el:found[0]}:{reason:'目标控件还没有出现。',retryable:true};}
    if(p.name||p.role){const found=locate({...p,limit:2});if(found.matches.length!==1)return {reason:found.matches.length?'有多个同名控件，请用快照 ref 明确目标。':'目标控件还没有出现。',retryable:!found.matches.length};return {el:state.refs.get(found.matches[0].ref)};}
    if(Number.isFinite(p.x)&&Number.isFinite(p.y))return {el:document.elementFromPoint(p.x,p.y)};
    return {reason:'请提供快照 ref、selector 或唯一的 role/name。'};
  }
  function point(el) {
    const r=el.getBoundingClientRect(),win=el.ownerDocument.defaultView;
    const x=(Math.max(0,r.left)+Math.min(win.innerWidth,r.right))/2,y=(Math.max(0,r.top)+Math.min(win.innerHeight,r.bottom))/2;
    return {x,y,r};
  }
  function includes(el,hit) {for(let n=hit;n;n=n.parentElement||n.getRootNode?.().host)if(n===el)return true;return false;}
  function hitTest(el,x,y) {
    const root=el.getRootNode(),hit=(root.elementFromPoint?.(x,y)||el.ownerDocument.elementFromPoint(x,y));
    if(!includes(el,hit)&&!(root.host&&hit===root.host))return null;
    let win=el.ownerDocument.defaultView,px=x,py=y,sx=1,sy=1;
    try {while(win.frameElement){const frame=win.frameElement,rect=frame.getBoundingClientRect(),fx=rect.width/frame.offsetWidth,fy=rect.height/frame.offsetHeight;px=rect.left+(px+frame.clientLeft)*fx;py=rect.top+(py+frame.clientTop)*fy;sx*=fx;sy*=fy;const cover=frame.ownerDocument.elementFromPoint(px,py);if(!includes(frame,cover))return null;win=win.parent;}}
    catch{return null;}
    return {x:px,y:py,sx,sy};
  }
  function targetPoint(el,p={}) {
    const center=point(el);
    if(!p.ref&&!p.selector&&!p.name&&!p.role&&Number.isFinite(p.x)&&Number.isFinite(p.y))return {...center,x:p.x,y:p.y};
    return center;
  }
  function pointerInfo(el,p={}) {
    const {x,y,r}=targetPoint(el,p),hit=hitTest(el,x,y);
    if(!hit)return null;
    return {x:hit.x,y:hit.y,rect:{x:hit.x-(x-r.left)*hit.sx,y:hit.y-(y-r.top)*hit.sy,width:r.width*hit.sx,height:r.height*hit.sy},viewport:{width:innerWidth,height:innerHeight}};
  }
  function sliderMetrics(el) {
    if(el.tagName!=='INPUT'||el.type!=='range')return null;
    const parsedMin=Number(el.min||0),parsedMax=Number(el.max||100),parsedStep=Number(el.step||1);
    const min=Number.isFinite(parsedMin)?parsedMin:0,max=Number.isFinite(parsedMax)?parsedMax:100,value=Number(el.value),step=el.step==='any'?0:Number.isFinite(parsedStep)&&parsedStep>0?parsedStep:1,style=el.ownerDocument.defaultView.getComputedStyle(el);
    const vertical=style.writingMode.startsWith('vertical')||String(style.webkitAppearance).includes('vertical');
    const reverse=vertical?(style.writingMode.startsWith('vertical')?style.direction==='rtl':true):style.direction==='rtl';
    return {min,max,value,step,orientation:vertical?'vertical':'horizontal',reverse};
  }
  function pointerPlan(p) {
    const target=resolve(p);if(target.reason)return target;
    const el=target.el;if(!el||!geometry(el))return {reason:'目标暂时不可见。',retryable:true};
    el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    if(['click','drag','set_slider'].includes(p.operation)&&(el.disabled||el.getAttribute('aria-disabled')==='true'))return {reason:'目标控件暂时不可用。',retryable:true};
    let slider,sliderFrom,sliderTo;
    if(p.operation==='set_slider'){
      slider=sliderMetrics(el);
      if(!slider)return {reason:'set_slider适用于原生range滑杆；自定义滑杆请用drag和回读数值。'};
      const requested=Number(p.sliderValue);if(!Number.isFinite(requested)||requested<slider.min||requested>slider.max||slider.max<=slider.min)return {reason:'滑杆目标超出有效范围。'};
      const r=el.getBoundingClientRect(),vertical=slider.orientation==='vertical',length=vertical?r.height:r.width,inset=Math.min(8,length/8);
      const target=slider.step>0?Math.min(slider.max,slider.min+Math.round((requested-slider.min)/slider.step)*slider.step):requested;
      const spot=value=>{let ratio=(value-slider.min)/(slider.max-slider.min);if(slider.reverse)ratio=1-ratio;return vertical?{x:r.left+r.width/2,y:r.top+inset+ratio*(length-2*inset)}:{x:r.left+inset+ratio*(length-2*inset),y:r.top+r.height/2};};
      sliderFrom=spot(slider.value);sliderTo=spot(target);slider={...slider,target,requested,tolerance:slider.step>0?slider.step*.49:(slider.max-slider.min)/Math.max(1,length)*1.5};
    }
    const info=pointerInfo(el,sliderFrom||p);if(!info)return {reason:'目标被其他内容遮住，尚未操作。',retryable:true};
    const id=String(p.id||'pointer'),old=state.stable.get(id);
    if(['click','drag','set_slider'].includes(p.operation)){
      const value={el,x:info.x,y:info.y,w:info.rect.width,h:info.rect.height};state.stable.set(id,value);
      if(!old||old.el!==el||['x','y','w','h'].some(k=>Math.abs(old[k]-value[k])>1))return {reason:'目标位置还在变化，等待稳定。',retryable:true};
      state.stable.delete(id);
    }
    let to;
    if(sliderTo){to=pointerInfo(el,sliderTo);if(!to)return {reason:'滑杆终点被遮挡，尚未操作。'};}
    if(p.operation==='drag'){
      const endParams={ref:p.toRef,selector:p.toSelector,name:p.toName,role:p.toRole,exact:p.toExact,x:p.toX,y:p.toY},end=resolve(endParams);
      if(end.reason)return end;
      if(!geometry(end.el,true))return {reason:'拖拽终点不在当前可见区域，请先滚动后重新定位。'};
      to=pointerInfo(end.el,endParams);if(!to)return {reason:'拖拽终点被遮挡，尚未按下鼠标。'};
    }
    return {...info,...(to?{to}:{}),...(slider?{slider}:{}),ref:refFor(el),documentToken:page};
  }
  function key(el,value) {
    const codes={Enter:13,Escape:27,Tab:9,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40};if(!(value in codes))return false;
    const win=el.ownerDocument.defaultView,event=new win.KeyboardEvent('keydown',{key:value,code:value,keyCode:codes[value],which:codes[value],bubbles:true,cancelable:true,composed:true});
    const allowed=el.dispatchEvent(event);el.dispatchEvent(new win.KeyboardEvent('keyup',{key:value,code:value,bubbles:true,composed:true}));
    if(value==='Enter'&&allowed){const form=el.closest('form');form?.requestSubmit?.();}
    return true;
  }
  function action(p) {
    if(p.action==='pointer-plan')return pointerPlan(p);
    if(p.action==='pointer-state'){const target=resolve(p);if(target.reason)return target;return {hovered:target.el.matches(':hover')};}
    if(p.action==='slider-value'){const target=resolve(p);if(target.reason)return target;if(p.focus)target.el.focus?.({preventScroll:true});return {slider:sliderMetrics(target.el)};}
    if(p.action==='snapshot')return snapshot(p);
    if(p.action==='locate')return locate(p);
    if(p.action==='read'){const target=(p.ref||p.selector)?resolve(p):{el:textRoot()};if(target.reason)return target;return {title:document.title,text:readText(target.el,bound(p.maxChars,10000,30000))};}
    if(p.action==='wait'){
      const desired=p.waitFor||'visible',hasTarget=Boolean(p.ref||p.selector||p.name||p.role),target=hasTarget?resolve(p):{el:textRoot()};
      if(target.reason){if(target.retryable||target.code==='stale-ref')return {matched:['hidden','detached'].includes(desired)};return target;}
      const el=target.el,visible=Boolean(geometry(el));
      let matched=!hasTarget||({attached:Boolean(el?.isConnected),detached:!el?.isConnected,hidden:!visible,visible,enabled:visible&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!el.readOnly}[desired]??visible);
      if(p.text)matched=matched&&readText(el,30000).includes(String(p.text));return {matched};
    }
    if(p.action==='scroll'&&!p.ref&&!p.selector){if(!Number.isFinite(p.dy)&&!Number.isFinite(p.dx))return {reason:'请提供滚动距离或元素编号。'};window.scrollBy({top:p.dy||0,left:p.dx||0,behavior:'instant'});return {scrolled:true,x:scrollX,y:scrollY};}
    if(p.action==='press'&&!p.ref&&!p.selector&&!p.name){const el=document.activeElement||document.body;if(!key(el,p.key))return {reason:'只支持回车、退出、制表和方向键。'};if(p.key==='Tab'){const list=[];walk(document,n=>{if(n.matches(selector)&&geometry(n)&&!n.disabled&&n.tabIndex>=0)list.push(n);});list[(list.indexOf(el)+1)%list.length]?.focus({preventScroll:true});}return {pressed:p.key};}
    const target=resolve(p);if(target.reason)return target;const el=target.el;if(!el)return {reason:'没有找到目标。'};
    if(!geometry(el))return {reason:'目标暂时不可见。',retryable:true};
    if(p.action==='scroll'&&(Number.isFinite(p.dy)||Number.isFinite(p.dx))){el.scrollBy({top:p.dy||0,left:p.dx||0,behavior:'instant'});return {scrolled:true,ref:refFor(el),x:el.scrollLeft,y:el.scrollTop};}
    el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    if(p.action==='scroll')return {scrolled:true,ref:refFor(el)};
    if(el.disabled||el.getAttribute('aria-disabled')==='true')return {reason:'目标控件暂时不可用。',retryable:true};
    if(['type','select','press'].includes(p.action)){const {x,y}=point(el);if(!hitTest(el,x,y))return {reason:'目标被其他内容遮住，尚未操作。',retryable:true};}
    if(p.action==='click'){
      const {x,y,r}=targetPoint(el,p),globalPoint=hitTest(el,x,y);if(!globalPoint)return {reason:'目标被其他内容遮住，尚未点击。',retryable:true};
      const id=String(p.id||p.ref||p.selector||'click'),old=state.stable.get(id),now=performance.now();state.stable.set(id,{el,x,y,w:r.width,h:r.height,time:old?.time||now});
      if(p.stable!==false&&(!old||old.el!==el||Math.abs(old.x-x)>1||Math.abs(old.y-y)>1||Math.abs(old.w-r.width)>1||Math.abs(old.h-r.height)>1)){state.stable.set(id,{el,x,y,w:r.width,h:r.height,time:now});return {reason:'目标位置还在变化，等待稳定。',retryable:true};}
      state.stable.delete(id);el.focus?.({preventScroll:true});const win=el.ownerDocument.defaultView;
      for(const type of ['pointerdown','mousedown','pointerup','mouseup']){el.dispatchEvent(new (type.startsWith('pointer')?win.PointerEvent:win.MouseEvent)(type,{bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0}));if(!el.isConnected)return {reason:'控件在按下时被页面替换，请先重新观察页面；操作可能已生效。',mayHaveExecuted:true};}
      const pointer=pointerInfo(el,p);el.click();return {clicked:true,ref:refFor(el),x:globalPoint.x,y:globalPoint.y,pointer};
    }
    if(p.action==='select'){
      if(el.tagName!=='SELECT')return {reason:'select 只适用于原生下拉框；自定义下拉框请定位选项后点击。'};
      const options=[...el.options],exact=p.value!==undefined?options.filter(o=>o.value===String(p.value)):[],labels=options.filter(o=>clean(o.label)===clean(p.text??p.value)),matches=exact.length?exact:labels,option=matches.length===1?matches[0]:null;
      if(!option||option.disabled)return {reason:'没有唯一可用的匹配选项。可用选项：'+options.filter(o=>!o.disabled).slice(0,10).map(o=>clean(o.label,60)+' (value='+clean(o.value,80)+')').join('；')};const pointer=pointerInfo(el);el.value=option.value;const win=el.ownerDocument.defaultView;for(const event of ['input','change'])el.dispatchEvent(new win.Event(event,{bubbles:true,composed:true}));return {selected:true,value:option.value,label:option.label,pointer};
    }
    if(p.action==='type'){
      if(typeof p.text!=='string'||p.text.length>131072)return {reason:'输入内容为空或过长。'};if(el.readOnly)return {reason:'目标输入框是只读的。'};
      el.focus?.({preventScroll:true});const win=el.ownerDocument.defaultView;
      if(el.isContentEditable)el.textContent=p.text;
      else {const proto=el.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:el.tagName==='INPUT'?win.HTMLInputElement.prototype:null;if(!proto||el.type==='file')return {reason:'这个控件不支持自动输入。'};Object.getOwnPropertyDescriptor(proto,'value').set.call(el,p.text);}
      const pointer=pointerInfo(el);el.dispatchEvent(new win.InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:p.text}));el.dispatchEvent(new win.Event('change',{bubbles:true,composed:true}));if(p.submit)key(el,'Enter');return {typed:true,length:p.text.length,ref:refFor(el),pointer};
    }
    if(p.action==='press')return key(el,p.key)?{pressed:p.key}:{reason:'按键不支持。'};
    return {reason:'不支持这个页面操作。'};
  }
  globalThis.__pinkieBrowserControl={version:3,documentToken:page,run(p){try{return action(p||{});}catch{return {reason:'网页控件已变化或参数无效，请重新获取快照。'};}}};
})();
