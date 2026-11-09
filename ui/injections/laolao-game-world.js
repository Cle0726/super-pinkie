/* 碧琪上岸记 · 上岸之书（学习台视图 gamemap）。
   - 3D：fx 引擎里的立体书场景（registerScene('book')）：书摊在桌上，按区翻页；每区一张底板平铺 + 远景 / 中景 / 前景三层剪纸按铰链立起来；
     节点是立在纸上的小圆牌（迷雾 / 已探索 / 点亮 / 金章四种材质），褪色 = 起雾，怪物占领 = 旁边站一只错题怪；真实灯光 + 软阴影（剪纸形状投影）+ 浮尘。
   - 平面版：同一张地图的 SVG（安静档、设置里选「平面」、WebGL 起不来时）。
   - 点节点 → 关卡卡片（学 / 背 / 守关）→ game.node.start。
   空闲零 rAF：只有翻页、镜头、悬停、浮尘（交互后 6 秒）在动。 */
(() => {
  'use strict';
  if (window.__pinkieGameWorld) return;
  const G = () => window.__pinkieGame;
  const fx = () => window.__pinkieGameFx;
  const desk = () => window.__pinkieStudyDesk;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const STATE = {fog: ['迷雾', 'FOG'], explored: ['已探索', 'EXPLORED'], lit: ['点亮', 'LIT'], gold: ['金章', 'GOLD']};
  const GUARDIAN = {listening: 'echo-bat', vocab: 'block-golem', grammar: 'ink-slime', reading: 'bookworm', translation: 'lost-crane', writing: 'inkpot-imp'};
  // 节点在跨页上的位置：一条 S 形小路，从左页走到右页（x ∈ [-1, 1]，z ∈ [0, 1] 从里到外）。
  function layout(nodes) {
    const n = Math.max(1, nodes.length);
    return nodes.map((node, i) => { const t = n === 1 ? .5 : i / (n - 1); return {node, x: -.82 + 1.64 * t, z: .5 + .28 * Math.sin(t * Math.PI * 1.6 + .4)}; });
  }

  // ───────────── 3D 立体书 ─────────────
  function registerBookScene() {
    const engine = fx(); if (!engine?.registerScene || registerBookScene.done) return; registerBookScene.done = true;
    engine.registerScene('book', async ({THREE, host, opts, settings}) => {
      const g = G(); const night = Boolean(opts.night);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, .1, 80); const camHome = new THREE.Vector3(0, 6.15, 6.35), lookHome = new THREE.Vector3(0, .8, -.1);
      camera.position.copy(camHome); camera.lookAt(lookHome);
      const loader = new THREE.TextureLoader(); const texCache = new Map();
      const tex = url => { if (!url) return Promise.resolve(null); if (texCache.has(url)) return texCache.get(url); const p = new Promise(res => loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null))); texCache.set(url, p); return p; };
      // 桌面 + 光
      scene.background = new THREE.Color(night ? '#120d16' : '#e9ddd2');
      scene.fog = new THREE.Fog(scene.background, 9, 18);
      const deskMat = new THREE.MeshStandardMaterial({color: night ? '#2a1f2b' : '#d9c7b8', roughness: .85});
      const deskPlane = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), deskMat); deskPlane.rotation.x = -Math.PI / 2; deskPlane.position.y = -.08; deskPlane.receiveShadow = true; scene.add(deskPlane);
      const key = new THREE.SpotLight(night ? '#ffd6a8' : '#fff4e6', night ? 80 : 150, 30, .55, .85, 1.5); key.position.set(-3.2, 7.5, 4.2); key.target.position.set(0, 0, 0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0006; key.shadow.normalBias = .02; key.shadow.radius = 5; scene.add(key, key.target);
      scene.add(new THREE.HemisphereLight(night ? '#5a4a78' : '#fff8f0', night ? '#140e18' : '#b9a08f', night ? .4 : 1.05));
      const rim = new THREE.DirectionalLight(night ? '#8fa0ff' : '#ffe2c4', night ? .9 : .6); rim.position.set(4, 3, -5); scene.add(rim);
      // 书：封皮板 + 两页纸（略微翘起）+ 书脊
      const [pageTex, coverTex] = await Promise.all([tex(g.art('world/book/page')), tex(g.art('world/book/cover'))]);
      const W = 3.2, H = 2.2;
      const board = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + .22, .06, H + .2), new THREE.MeshStandardMaterial({color: night ? '#3a1d2e' : '#6b2a45', roughness: .55, map: coverTex || null})); board.position.y = -.05; board.castShadow = true; board.receiveShadow = true; scene.add(board);
      const pageGeo = (() => { const geo = new THREE.PlaneGeometry(W, H, 24, 1); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); const u = (x + W / 2) / W; p.setZ(i, Math.sin(u * Math.PI) * .02 + (1 - u) ** 6 * .06); } geo.computeVertexNormals(); return geo; })();
      const pageMat = new THREE.MeshStandardMaterial({color: '#fbf6ef', roughness: .92, map: pageTex || null});
      const left = new THREE.Mesh(pageGeo, pageMat); left.rotation.x = -Math.PI / 2; left.position.set(-W / 2, .005, 0); left.scale.x = -1; left.receiveShadow = true; scene.add(left);
      const right = new THREE.Mesh(pageGeo, pageMat); right.rotation.x = -Math.PI / 2; right.position.set(W / 2, .005, 0); right.receiveShadow = true; scene.add(right);
      const gutter = new THREE.Mesh(new THREE.PlaneGeometry(.18, H), new THREE.MeshBasicMaterial({color: '#000', transparent: true, opacity: .12, depthWrite: false})); gutter.rotation.x = -Math.PI / 2; gutter.position.y = .012; scene.add(gutter);
      // 剪纸层：底板平铺；远景 / 中景 / 前景立起来（铰链在底边）。阴影用带 alpha 的深度材质，影子跟着剪纸形状。
      const layerGroup = new THREE.Group(); scene.add(layerGroup);
      // 立起来的剪纸：铰链在底边；crop = 只用贴图下面这一截（v 从 0 到 crop），tilt = 立好以后往后仰的角度。
      const mkLayer = ({w, z, x = 0, crop = 1, tilt = 0, depth, maxH}) => {
        const pivot = new THREE.Group(); pivot.position.set(x, .02, z); layerGroup.add(pivot);
        const mat = new THREE.MeshStandardMaterial({transparent: true, alphaTest: .5, roughness: .9, side: THREE.DoubleSide, color: '#ffffff'});
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 1.5), mat); mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.customDepthMaterial = new THREE.MeshDepthMaterial({depthPacking: THREE.RGBADepthPacking, alphaTest: .5});
        pivot.add(mesh); pivot.userData = {mesh, depth, tilt, w, crop, maxH}; return pivot;
      };
      // 剪纸贴图上下常有透明边：按 alpha 找到内容的上下沿，铰链贴着内容底边，不悬空。
      const boundsCache = new WeakMap();
      function alphaBounds(t) {
        if (boundsCache.has(t)) return boundsCache.get(t);
        let out = {v0: 0, v1: 1, aspect: 1.5};
        try { const img = t.image, cw = 96, ch = Math.max(8, Math.round(96 * img.height / img.width)); const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(img, 0, 0, cw, ch); const d = x.getImageData(0, 0, cw, ch).data; let top = -1, bot = -1; for (let y = 0; y < ch; y++) { let n = 0; for (let k = 0; k < cw; k++) if (d[(y * cw + k) * 4 + 3] > 128) n++; if (n > 1) { if (top < 0) top = y; bot = y; } } if (top >= 0) out = {v0: Math.max(0, 1 - (bot + 1) / ch), v1: Math.min(1, 1 - top / ch + 1 / ch), aspect: img.width / img.height}; } catch { /* 画不进 canvas 就整张用 */ }
        boundsCache.set(t, out); return out;
      }
      function fitLayer(l, t) {
        const {mesh, crop, maxH = 9} = l.userData; let {w} = l.userData; if (!t) return;
        const b = alphaBounds(t); const v0 = b.v0, v1 = crop < 1 ? Math.min(b.v1, v0 + crop) : b.v1; let h = w / b.aspect * (v1 - v0); if (h > maxH) { w *= maxH / h; h = maxH; }
        const geo = new THREE.PlaneGeometry(w, h); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
        mesh.geometry.dispose(); mesh.geometry = geo; mesh.position.y = h / 2;
      }
      // 底板（岛）平铺在跨页中间，宽高比只拉伸一点点
      const base = new THREE.Mesh(new THREE.PlaneGeometry(H * .96 * 1.5 * 1.18, H * .96), new THREE.MeshStandardMaterial({transparent: true, alphaTest: .4, roughness: .95})); base.rotation.x = -Math.PI / 2; base.position.set(0, .07, .02); base.receiveShadow = true; scene.add(base);
      // 远景靠书脊后沿、略往后仰；中景偏右（灯塔一类主体）；前景只用最下面那条（码头 / 书 / 贝壳），矮、往后仰，不挡节点。
      const bg = mkLayer({w: W * 2 * .84, z: -H * .5, tilt: .2, depth: 0, maxH: 2.3});
      const mg = mkLayer({w: W * .92, x: W * .5, z: -H * .34, tilt: .08, depth: 1, maxH: 1.9});
      const fg = mkLayer({w: W * 2 * .98, z: H * .52, crop: .17, tilt: -.18, depth: 2});
      const folded = l => -Math.PI / 2 * .985, standing = l => -l.userData.tilt;
      // 节点
      const nodeGroup = new THREE.Group(); scene.add(nodeGroup);
      const haloC = document.createElement('canvas'); haloC.width = haloC.height = 128; { const x = haloC.getContext('2d'); const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); }
      const haloTex = new THREE.CanvasTexture(haloC);
      const fogC = document.createElement('canvas'); fogC.width = fogC.height = 128; { const x = fogC.getContext('2d'); for (let i = 0; i < 14; i++) { const gx = 64 + (Math.random() - .5) * 60, gy = 64 + (Math.random() - .5) * 40, r = 20 + Math.random() * 26; const gr = x.createRadialGradient(gx, gy, 0, gx, gy, r); gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); } }
      const fogTex = new THREE.CanvasTexture(fogC);
      const palette = opts.palette || ['#F7A8C8', '#DB1F74', '#FFE36E'];
      function tokenTexture(label, state) {
        const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
        const fill = {fog: '#cfc8c2', explored: '#fbf6ee', lit: '#fff3f8', gold: '#f6e2b0'}[state] || '#fbf6ee';
        x.fillStyle = fill; x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill();
        x.strokeStyle = state === 'gold' ? '#a87a2c' : state === 'lit' ? palette[1] : 'rgba(58,42,53,.55)'; x.lineWidth = 3; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.stroke();
        x.lineWidth = 1; x.beginPath(); x.arc(64, 64, 46, 0, Math.PI * 2); x.stroke();
        x.fillStyle = state === 'fog' ? 'rgba(58,42,53,.45)' : '#2e2236'; x.font = '900 52px "Songti SC","STSong","Noto Serif SC",serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, 64, 68);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
      }
      const markers = [];
      const metalGold = new THREE.MeshStandardMaterial({color: '#e2bd72', metalness: .55, roughness: .32, emissive: new THREE.Color('#5a3c10'), emissiveIntensity: .35});
      const pinMat = new THREE.MeshStandardMaterial({color: '#3a2a35', roughness: .5}); const ivory = new THREE.MeshStandardMaterial({color: '#efe6da', roughness: .8});
      const shared = new Set(); function clearNodes() { for (const m of markers) { nodeGroup.remove(m.group); m.group.traverse(o => { o.geometry?.dispose?.(); for (const mat of [].concat(o.material || [])) { if (shared.has(mat)) continue; if (mat.userData?.ownMap) mat.map?.dispose?.(); mat.dispose?.(); } }); } markers.length = 0; }
      shared.add(metalGold); shared.add(pinMat); shared.add(ivory);
      async function buildNodes(region) {
        clearNodes();
        const spots = layout(region.nodes || []);
        // 小路：节点之间一串墨点
        const path = new THREE.Group(); nodeGroup.add(path); markers.push({group: path, path: true});
        for (let i = 0; i < spots.length - 1; i++) { const a = spots[i], b = spots[i + 1]; for (let k = 1; k < 7; k++) { const t = k / 7; const d = new THREE.Mesh(new THREE.CircleGeometry(.018, 10), new THREE.MeshBasicMaterial({color: '#3a2a35', transparent: true, opacity: .45})); d.rotation.x = -Math.PI / 2; d.position.set((a.x + (b.x - a.x) * t) * W, .076, (a.z + (b.z - a.z) * t - .5) * H * .9); path.add(d); } }
        for (const [i, s] of spots.entries()) {
          const n = s.node; const grp = new THREE.Group(); grp.position.set(s.x * W, 0, (s.z - .5) * H * .9); grp.userData.node = n; nodeGroup.add(grp);
          const isGuard = n.kind === 'guard' || n.kind === 'boss';
          // 圆牌：边圈（金章 = 金属，其余象牙纸板）+ 正面贴图；整块朝镜头仰一点
          const r0 = isGuard ? .27 : .22;
          const disk = new THREE.Group(); disk.position.y = .46; disk.rotation.x = -.5; grp.add(disk);
          const rim = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, .035, 48), n.state === 'gold' ? metalGold : ivory); rim.rotation.x = Math.PI / 2; rim.castShadow = true; disk.add(rim);
          const face = new THREE.Mesh(new THREE.CircleGeometry(r0 * .93, 48), Object.assign(new THREE.MeshStandardMaterial({map: tokenTexture(isGuard ? '守' : String(i + 1), n.state), roughness: .65, emissive: n.state === 'lit' ? new THREE.Color(palette[1]) : new THREE.Color(0), emissiveIntensity: n.state === 'lit' ? .1 : 0}), {userData: {ownMap: true}})); face.position.z = .019; disk.add(face);
          const back = new THREE.Mesh(new THREE.CircleGeometry(r0 * .93, 32), ivory); back.rotation.y = Math.PI; back.position.z = -.019; disk.add(back);
          disk.userData.hit = [rim, face];
          const pin = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .46, 8), pinMat); pin.position.y = .23; pin.castShadow = true; grp.add(pin);
          const foot = new THREE.Mesh(new THREE.CircleGeometry(.07, 20), pinMat); foot.rotation.x = -Math.PI / 2; foot.position.y = .075; grp.add(foot);
          if (n.state === 'lit' || n.state === 'gold') { const h = new THREE.Sprite(new THREE.SpriteMaterial({map: haloTex, color: n.state === 'gold' ? '#ffd88a' : palette[0], transparent: true, opacity: night ? (n.state === 'gold' ? .9 : .7) : (n.state === 'gold' ? .55 : .4), blending: night ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false})); h.scale.setScalar(isGuard ? .9 : .7); h.position.y = .46; h.position.z = -.04; grp.add(h); }
          const fade = n.state === 'fog' ? .85 : Math.max(0, Math.min(1, n.fade || 0));
          if (fade > .05) { const f = new THREE.Sprite(new THREE.SpriteMaterial({map: fogTex, color: night ? '#9a90b0' : '#d9d2dc', transparent: true, opacity: .2 + fade * .5, depthWrite: false})); f.scale.set(1.3, .62, 1); f.position.y = .22; grp.add(f); }
          if (n.monsters > 0) { const sp = GUARDIAN[region.id] || 'fog-puff'; const mt = await tex(g.art(`monster/${sp}`)); if (mt) { const m = new THREE.Sprite(new THREE.SpriteMaterial({map: mt, transparent: true, alphaTest: .4})); m.scale.setScalar(.42); m.position.set(.3, .23, .05); grp.add(m); } }
          if (n.due > 0) { const d = new THREE.Mesh(new THREE.SphereGeometry(.04, 12, 8), new THREE.MeshBasicMaterial({color: '#d2405c'})); d.position.set(r0 * .78, .46 + r0 * .7, .03); grp.add(d); }
          markers.push({group: grp, disk, node: n, lift: 0});
        }
      }
      // 动画
      const tasks = []; let time = 0, dustUntil = 0, hover = null;
      const ease = {out: k => 1 - (1 - k) ** 4, io: k => k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2};
      function tween(dur, fn, delay = 0) { return new Promise(res => { tasks.push({t0: time + delay, dur, fn, res}); fx()?._kick?.(); }); }
      const dust = (() => { const n = 70, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), seed = []; for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - .5) * 6; pos[i * 3 + 1] = Math.random() * 2.2; pos[i * 3 + 2] = (Math.random() - .5) * 3; seed.push(Math.random() * 10); } geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); const m = new THREE.Points(geo, new THREE.PointsMaterial({map: haloTex, size: .05, color: night ? '#ffd9a0' : '#fff6e0', transparent: true, opacity: night ? .8 : .55, blending: THREE.AdditiveBlending, depthWrite: false})); m.userData.seed = seed; scene.add(m); return m; })();
      let current = null;
      async function show(region, {flip = 0} = {}) {
        const urls = ['base', 'bg', 'mg', 'fg'].map(k => g.art(`${region.art || `world/pretco-b/${region.id}`}/${k}`));
        const loaded = Promise.all(urls.map(tex));
        if (current) { // 折下去 → 翻页
          const old = markers.filter(m => !m.path); await tween(.42, k => { for (const l of [fg, mg, bg]) l.rotation.x = standing(l) + (folded(l) - standing(l)) * ease.io(k); base.material.opacity = 1 - k; for (const m of old) m.group.scale.setScalar(Math.max(.001, 1 - ease.out(Math.min(1, k * 2)))); for (const m of markers) if (m.path) m.group.visible = k < .3; });
          if (flip) { const leaf = new THREE.Mesh(pageGeo, pageMat); leaf.receiveShadow = true; const piv = new THREE.Group(); piv.add(leaf); leaf.rotation.x = -Math.PI / 2; leaf.position.x = flip > 0 ? W / 2 : -W / 2; if (flip < 0) leaf.scale.x = -1; piv.position.y = .03; scene.add(piv); await tween(.55, k => { piv.rotation.z = (flip > 0 ? 1 : -1) * Math.PI * ease.io(k); }); scene.remove(piv); }
        } else for (const l of [fg, mg, bg]) l.rotation.x = folded(l);
        const [tb, tbg, tmg, tfg] = await loaded; current = region;
        base.material.map = tb || pageTex; base.material.opacity = 0; base.material.needsUpdate = true; base.visible = Boolean(tb);
        for (const [l, t] of [[bg, tbg], [mg, tmg], [fg, tfg]]) { const m = l.userData.mesh; fitLayer(l, t); m.material.map = t; m.customDepthMaterial.map = t; m.material.needsUpdate = m.customDepthMaterial.needsUpdate = true; l.visible = Boolean(t); }
        await buildNodes(region);
        for (const mk of markers) if (!mk.path) mk.group.scale.setScalar(.001);
        dustUntil = time + 6;
        // 立起来：远景先、前景最后（expo-out，不回弹）
        const up = [bg, mg, fg].map((l, i) => tween(.8, k => { l.rotation.x = folded(l) + (standing(l) - folded(l)) * ease.out(k); }, i * .12));
        tween(.5, k => { base.material.opacity = k; });
        await Promise.all(up);
        await Promise.all(markers.filter(m => !m.path).map((m, i) => tween(.45, k => { m.group.scale.setScalar(Math.max(.001, ease.out(k))); }, i * .07)));
      }
      const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
      function pick(x, y) { const r = host.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); const hits = ray.intersectObjects(markers.filter(m => !m.path).flatMap(m => m.disk.userData.hit), false); return hits.length ? markers.find(m => !m.path && m.disk.userData.hit.includes(hits[0].object)) : null; }
      function screenOf(mk) { const v = new THREE.Vector3(); mk.disk.getWorldPosition(v); v.project(camera); const r = host.getBoundingClientRect(); return {x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height}; }
      const inst = {
        opaque: false,
        animating: () => tasks.length > 0 || time < dustUntil,
        resize(w, h) { camera.aspect = w / h; camera.fov = w / h < 1.25 ? 40 : 30; camera.updateProjectionMatrix(); },
        update(dt) {
          time += dt;
          for (let i = tasks.length - 1; i >= 0; i--) { const t = tasks[i]; if (time < t.t0) continue; const k = Math.min(1, (time - t.t0) / t.dur); t.fn(k); if (k >= 1) { tasks.splice(i, 1); t.res(); } }
          if (time < dustUntil) { const p = dust.geometry.attributes.position, s = dust.userData.seed; for (let i = 0; i < p.count; i++) { p.setY(i, (p.getY(i) + dt * .05) % 2.2); p.setX(i, p.getX(i) + Math.sin(time * .6 + s[i]) * dt * .03); } p.needsUpdate = true; dust.material.opacity = (night ? .8 : .55) * Math.min(1, (dustUntil - time) / 1.5); }
          for (const m of markers) if (!m.path) { const want = m === hover ? 1 : 0; m.lift += (want - m.lift) * Math.min(1, dt * 12); m.disk.position.y = .46 + m.lift * .08; m.disk.rotation.y = m.lift * .35; }
        },
        render(r) {
          const prev = {tm: r.toneMapping, cs: r.outputColorSpace, sh: r.shadowMap.enabled, ex: r.toneMappingExposure};
          r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = night ? 1 : 1.12; r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
          r.render(scene, camera);
          r.toneMapping = prev.tm; r.outputColorSpace = prev.cs; r.shadowMap.enabled = prev.sh; r.toneMappingExposure = prev.ex;
        },
        show, pick, screenOf, _markers: () => markers.filter(m => !m.path),
        hover(x, y) { const m = x == null ? null : pick(x, y); if (m !== hover) { hover = m; dustUntil = Math.max(dustUntil, time + .6); fx()?._kick?.(); } return m; },
        async focus(mk) { const from = camera.position.clone(), np = mk ? mk.group.position : null, to = mk ? camHome.clone().lerp(new THREE.Vector3(np.x, .5, np.z), .22) : camHome; const lf = new THREE.Vector3(), lt = mk ? lookHome.clone().lerp(new THREE.Vector3(np.x, .4, np.z), .3) : lookHome; const look0 = inst._look || lookHome.clone(); await tween(.6, k => { const e = ease.out(k); camera.position.lerpVectors(from, to, e); lf.lerpVectors(look0, lt, e); camera.lookAt(lf); }); inst._look = lt.clone(); },
        dispose() { clearNodes(); for (const p of texCache.values()) p.then(t => t?.dispose?.()); haloTex.dispose(); fogTex.dispose(); scene.traverse(o => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(x => x.dispose?.()); }); },
      };
      inst.resize(host.clientWidth || 900, host.clientHeight || 600);
      return inst;
    });
  }

  // ───────────── 平面版（SVG） ─────────────
  function flatMap(box, region, onPick) {
    box.replaceChildren();
    const g = G(); const art = g.art(`${region.art || `world/pretco-b/${region.id}`}/base`) || g.art(`${region.art || `world/pretco-b/${region.id}`}/bg`);
    const outer = el('div', 'pkw-flat'); const wrap = el('div', 'pkw-flat__box'); outer.append(wrap); if (art) { const i = el('img', 'pkw-flat__art'); i.src = art; i.alt = ''; wrap.append(i); }
    const spots = layout(region.nodes || []);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 1000 667'); svg.classList.add('pkw-flat__svg');
    const P = s => [500 + s.x * 440, 150 + s.z * 420];
    let d = ''; spots.forEach((s, i) => { const [x, y] = P(s); d += (i ? ' L' : 'M') + x + ' ' + y; });
    svg.innerHTML = `<path d="${d}" class="pkw-path"/>`;
    wrap.append(svg);
    spots.forEach((s, i) => {
      const [x, y] = P(s); const n = s.node; const b = el('button', 'pkw-pin'); b.type = 'button'; b.dataset.state = n.state; b.dataset.kind = n.kind;
      b.style.left = (x / 10) + '%'; b.style.top = (y / 6.67) + '%'; b.style.setProperty('--fade', String(n.state === 'fog' ? .8 : n.fade || 0));
      b.append(el('b', '', n.kind === 'guard' || n.kind === 'boss' ? '守' : String(i + 1)), el('span', 'pkw-pin__name', n.name));
      if (n.monsters > 0) b.append(el('em', 'pkw-pin__mon', `${n.monsters}`));
      if (n.due > 0) b.append(el('i', 'pkw-pin__due'));
      b.setAttribute('aria-label', `${n.name} · ${STATE[n.state]?.[0] || ''}${n.due ? ` · ${n.due} 张到期` : ''}${n.monsters ? ` · ${n.monsters} 只错题怪` : ''}`);
      b.addEventListener('click', () => onPick(n, b.getBoundingClientRect()));
      wrap.append(b);
    });
    box.append(outer);
  }

  // ───────────── 页面 ─────────────
  async function mountMap(host, ctx) {
    host.classList.add('pkw-page');
    const g = G(); const local = ctx.local?.() || {};
    const head = el('header', 'pkb-page__head pks-head');
    const x = el('button', 'pkb-x', '×'); x.type = 'button'; x.setAttribute('aria-label', window.__pinkieGame?.backLabel?.() || '回营地'); x.addEventListener('click', () => (window.__pinkieGame?.goBack ? window.__pinkieGame.goBack() : desk()?.go('today')));
    const t = el('div'); const title = el('h2', '', '上岸之书'); t.append(el('small', 'pkb-kicker', 'ATLAS · VOLUME I'), title);
    const hudBox = el('div', 'pkb-page__hud'); head.append(x, t, hudBox); host.append(head);
    const bar = el('div', 'pkw-bar'); const tabs = el('nav', 'pkw-tabs'); tabs.setAttribute('aria-label', '区域'); const modeSeg = el('div', 'pkg-seg pkw-mode'); bar.append(tabs, modeSeg); host.append(bar);
    const stage = el('div', 'pkw-stage'); const canvasHost = el('div', 'pkw-canvas'); const flatHost = el('div', 'pkw-flathost'); const card = el('div', 'pkw-card'); card.hidden = true; stage.append(canvasHost, flatHost, card); host.append(stage);
    const legend = el('div', 'pkw-legend'); for (const [k, [zh]] of Object.entries(STATE)) { const s = el('span'); s.dataset.state = k; s.append(el('i'), document.createTextNode(zh)); legend.append(s); } legend.append(el('span', 'pkw-legend__fade', '起雾 = 该浇水了'), el('span', 'pkw-legend__mon', '小怪 = 错题怪占着')); host.append(legend);
    try { await Promise.all([g.manifest(), g.forms(), g.state()]); g.hud(hudBox, {compact: true}); } catch { /* HUD 可选 */ }
    let world;
    try { world = await g.call('world', {exam: 'pretco-b'}); } catch (e) { stage.replaceChildren(el('p', 'pkb-empty', e.message || '地图打不开')); return; }
    if (!host.isConnected) return;
    const regions = (world.regions || []).slice().sort((a, b) => a.order - b.order);
    title.textContent = world.title || '上岸之书';
    if (!regions.length) { stage.replaceChildren(el('div', 'pkw-planning', '碧琪在规划路线…')); return; }
    if (world.status === 'generating') bar.append(el('span', 'pkw-gen', '碧琪在按你的生词和错题重排路线，好了会自动换上'));
    let idx = Math.max(0, regions.findIndex(r => r.id === local.mapRegion)); if (local.mapRegion == null) { const firstOpen = regions.findIndex(r => r.nodes.some(n => n.state !== 'gold')); idx = Math.max(0, firstOpen); }
    const fxs = fx()?.settings?.() || {};
    let mode = local.mapMode || (fxs.book === 'flat' || fxs.tier === 'quiet' ? 'flat' : '3d');
    let handle = null;
    for (const [id, label] of [['3d', '立体'], ['flat', '平面']]) { const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-selected', String(id === mode)); b.addEventListener('click', () => { if (mode === id) return; mode = id; local.mapMode = id; modeSeg.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', String(x === b))); apply(); }); modeSeg.append(b); }
    regions.forEach((r, i) => { const lit = r.nodes.filter(n => n.state === 'lit' || n.state === 'gold').length; const b = el('button', 'pkw-tab'); b.type = 'button'; b.setAttribute('aria-selected', String(i === idx)); b.append(el('small', '', `0${i + 1}`), el('b', '', r.name), el('em', 'pkg-num', `${lit}/${r.nodes.length}`)); if (r.nodes.some(n => n.monsters > 0)) b.dataset.mon = '1'; if (r.nodes.some(n => n.due > 0)) b.dataset.due = '1'; b.addEventListener('click', () => go(i)); tabs.append(b); });
    async function go(i) { if (i === idx && (handle || mode === 'flat')) return; const dir = Math.sign(i - idx); idx = i; local.mapRegion = regions[i].id; tabs.querySelectorAll('.pkw-tab').forEach((b, k) => b.setAttribute('aria-selected', String(k === i))); card.hidden = true; if (mode === '3d' && handle?.instance) { await handle.instance.focus(null); handle.instance.show(regions[i], {flip: dir}); } else flatMap(flatHost, regions[i], openCard); }
    async function apply() {
      card.hidden = true;
      if (mode === '3d') {
        registerBookScene(); flatHost.hidden = true; canvasHost.hidden = false; canvasHost.dataset.loading = '1';
        try { handle = fx() ? await fx().scene('book', {host: canvasHost, palette: g.equippedForm()?.palette, night: document.getElementById('pinkie-study-desk')?.dataset.theme === 'night'}) : null; } catch (e) { console.warn('[map] 3D', e); handle = null; }
        delete canvasHost.dataset.loading;
        if (!handle?.instance) { mode = 'flat'; modeSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.textContent === '平面'))); return apply(); }
        await handle.instance.show(regions[idx]);
      } else {
        handle?.close?.(); handle = null; canvasHost.hidden = true; flatHost.hidden = false; flatMap(flatHost, regions[idx], openCard);
      }
    }
    canvasHost.addEventListener('pointermove', e => { if (!handle?.instance) return; const m = handle.instance.hover(e.clientX, e.clientY); canvasHost.style.cursor = m ? 'pointer' : ''; });
    canvasHost.addEventListener('pointerleave', () => handle?.instance?.hover(null));
    canvasHost.addEventListener('click', async e => { if (!handle?.instance) return; const m = handle.instance.pick(e.clientX, e.clientY); if (!m) { card.hidden = true; handle.instance.focus(null); return; } await handle.instance.focus(m); const p = handle.instance.screenOf(m); openCard(m.node, {left: p.x - 10, top: p.y - 10, width: 20, height: 20}); try { fx()?.sfx('sparkle'); } catch { /* ignore */ } });
    function openCard(n, rect) {
      card.replaceChildren(); card.dataset.state = n.state;
      const sr = stage.getBoundingClientRect();
      card.append(el('small', 'pkb-kicker', `${STATE[n.state]?.[1] || ''} · ${regions[idx].name}`), el('h3', '', n.name), el('p', 'pkw-card__sum', n.summary || ''));
      const meta = el('div', 'pkw-card__meta');
      meta.append(el('span', '', STATE[n.state]?.[0] || ''));
      if (n.due) meta.append(el('span', 'is-due', `${n.due} 张到期`)); if (n.monsters) meta.append(el('span', 'is-mon', `${n.monsters} 只错题怪`)); if (n.fade > .3) meta.append(el('span', '', '这片该浇水了'));
      card.append(meta);
      const act = el('div', 'pkw-card__act');
      const btn = (label, mode, primary) => { const b = el('button', primary ? 'pkg-btn' : 'pks-pull pkw-btn', label); b.type = 'button'; b.addEventListener('click', () => g.startNode(n, mode, b)); act.append(b); };
      if (n.kind === 'guard' || n.kind === 'boss') btn('守关', 'guard', true);
      else { btn(n.state === 'fog' ? '学' : '再学一遍', 'learn', n.state === 'fog'); btn('背', 'drill', n.state !== 'fog'); }
      const close = el('button', 'pkb-x pkw-card__x', '×'); close.type = 'button'; close.setAttribute('aria-label', '关上'); close.addEventListener('click', () => { card.hidden = true; handle?.instance?.focus(null); });
      card.append(act, close); card.hidden = false;
      const w = 300, left = Math.min(sr.width - w - 16, Math.max(16, rect.left - sr.left + rect.width / 2 + 52)), top = Math.min(sr.height - 220, Math.max(16, rect.top - sr.top - 40));
      card.style.left = left + 'px'; card.style.top = top + 'px';
    }
    await apply();
    window.__pinkieGameWorld._page = {handle: () => handle, mode: () => mode, regions, go};
    return {unmount() { handle?.close?.(); }, keydown(e) { if (e.key === 'ArrowRight') go(Math.min(regions.length - 1, idx + 1)); if (e.key === 'ArrowLeft') go(Math.max(0, idx - 1)); }};
  }

  function register() {
    const d = desk(); if (!d?.registerView) return false;
    d.registerView('gamemap', {title: '上岸之书', wide: true, mount: (h, c) => mountMap(h, c)});
    return true;
  }
  if (!register()) { const t = setInterval(() => { if (register()) clearInterval(t); }, 150); setTimeout(() => clearInterval(t), 20000); }
  addEventListener('pinkie:gamefx-ready', registerBookScene); registerBookScene();
  window.__pinkieGameWorld = {layout};
})();
