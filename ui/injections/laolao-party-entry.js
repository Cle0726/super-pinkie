/* Independent party space, mounted only in the chat's right workspace rail. */
(() => {
  const assetURL = new URL('laolao-party-avatar-v1.png', document.currentScript?.src || location.href).href;
  const style = document.createElement('style');
  style.textContent = `
    #pinkie-party-entry{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;margin:auto 2px 0;padding:9px 0;min-height:96px;flex-shrink:0;border:0;border-radius:18px;color:#b04e81;background:linear-gradient(180deg,#fff5fb00,#fff5fb99 40%,#fbdcf155);text-decoration:none;user-select:none;-webkit-user-select:none;transition:background .2s,transform .2s}
    #pinkie-party-entry img{width:32px;height:32px;object-fit:cover;border-radius:50%;pointer-events:none;-webkit-user-drag:none;box-shadow:0 2px 9px #c06a9930;transition:transform .25s}
    #pinkie-party-entry span{writing-mode:vertical-rl;font-size:11px;font-weight:500;letter-spacing:4px;line-height:1}
    #pinkie-party-entry:hover{background:#fff5fbc9}#pinkie-party-entry:hover img{transform:translateY(-2px) rotate(-5deg)}
    #pinkie-party-entry:focus-visible{outline:2px solid #df8db6;outline-offset:-2px}
    .chat-workspace-rail:not(.chat-workspace-rail--collapsed) #pinkie-party-entry{flex-direction:row;min-height:54px;margin:auto 12px 0;padding:8px}
    .chat-workspace-rail:not(.chat-workspace-rail--collapsed) #pinkie-party-entry span{writing-mode:horizontal-tb;letter-spacing:2px}
    @media(prefers-reduced-motion:reduce){#pinkie-party-entry,#pinkie-party-entry img{transition:none}}
  `;
  document.head.append(style);
  let scheduled = false;
  const mount = () => {
    scheduled = false;
    const rail = document.querySelector('.chat-workspace-rail');
    let link = document.getElementById('pinkie-party-entry');
    if (!rail) { link?.remove(); return; }
    if (link?.parentElement === rail) return;
    link?.remove();
    link = document.createElement('a');link.id = 'pinkie-party-entry';link.href = 'http://127.0.0.1:18889/';
    link.title = '进入碧琪的派对空间';link.setAttribute('aria-label', '进入派对空间');
    const art = document.createElement('img');art.src = assetURL;art.alt = '';art.draggable = false;
    const label = document.createElement('span');label.textContent = '派对空间';link.append(art,label);
    link.onclick = event => {const native = window.webkit?.messageHandlers?.laolaoParty;if (native) {event.preventDefault();native.postMessage({action:'open'});}};
    rail.append(link);
  };
  new MutationObserver(() => {if (!scheduled) {scheduled = true;requestAnimationFrame(mount);}}).observe(document.documentElement,{childList:true,subtree:true});
  mount();
})();
