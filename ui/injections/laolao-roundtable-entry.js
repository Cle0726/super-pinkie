/* Independent relay-model roundtable, next to Party Space in the workspace rail. */
(() => {
  const assetURL = new URL('laolao-roundtable-entry-v2-clean.png', document.currentScript?.src || location.href).href;
  const style = document.createElement('style');
  style.textContent = `
    #pinkie-roundtable-entry{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:100px;margin:5px 2px 20px;padding:8px 0;flex-shrink:0;border:0;border-radius:18px;color:#8d546b;background:linear-gradient(180deg,#fffafc12,#fff8fbb8 48%,#f0d9e16b);text-decoration:none;user-select:none;-webkit-user-select:none;transition:background .24s,transform .24s,box-shadow .24s}
    #pinkie-roundtable-entry img{width:48px;height:48px;object-fit:contain;pointer-events:none;-webkit-user-drag:none;filter:drop-shadow(0 5px 7px #58263825);transition:transform .32s}
    #pinkie-roundtable-entry span{writing-mode:vertical-rl;font-size:11px;font-weight:550;letter-spacing:3px;line-height:1}
    #pinkie-roundtable-entry:hover{background:#fff9fbd9;box-shadow:inset 0 0 0 1px #c88aa126}#pinkie-roundtable-entry:hover img{transform:translateY(-2px) rotate(2deg) scale(1.04)}
    #pinkie-roundtable-entry:focus-visible{outline:2px solid #c6819e;outline-offset:-2px}
    .chat-workspace-rail:not(.chat-workspace-rail--collapsed) #pinkie-roundtable-entry{flex-direction:row;min-height:58px;margin:7px 12px 12px;padding:7px 10px}
    .chat-workspace-rail:not(.chat-workspace-rail--collapsed) #pinkie-roundtable-entry img{width:42px;height:42px}.chat-workspace-rail:not(.chat-workspace-rail--collapsed) #pinkie-roundtable-entry span{writing-mode:horizontal-tb;letter-spacing:2px}
    @media(prefers-reduced-motion:reduce){#pinkie-roundtable-entry,#pinkie-roundtable-entry img{transition:none}}
  `;
  document.head.append(style);
  let scheduled=false;
  const mount=()=>{
    scheduled=false;
    const rail=document.querySelector('.chat-workspace-rail');let link=document.getElementById('pinkie-roundtable-entry');
    if(!rail){link?.remove();return;}
    if(link?.parentElement===rail)return;link?.remove();link=document.createElement('a');link.id='pinkie-roundtable-entry';link.href='http://127.0.0.1:18891/';link.title='进入灵感圆桌';link.setAttribute('aria-label','进入灵感圆桌');
    const art=document.createElement('img');art.src=assetURL;art.alt='';art.draggable=false;const label=document.createElement('span');label.textContent='灵感圆桌';link.append(art,label);
    link.onclick=event=>{const native=window.webkit?.messageHandlers?.laolaoRoundtable;if(native){event.preventDefault();native.postMessage({action:'open'});}};rail.append(link);
  };
  new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(mount);}}).observe(document.documentElement,{childList:true,subtree:true});mount();
})();
