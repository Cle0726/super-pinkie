(() => {
  const previous = window.__pinkieDeskPreviousVendors || {};
  const gsap = window.gsap?.version === '3.13.0' ? window.gsap : null;
  window.__pinkieDeskVendors = {gsap, SplitText: window.SplitText, DrawSVGPlugin: window.DrawSVGPlugin, confetti: window.confetti};
  if (gsap) gsap.registerPlugin(...[window.SplitText, window.DrawSVGPlugin].filter(Boolean));
  for (const name of Object.keys(previous)) {
    if (previous[name] === undefined) delete window[name];
    else window[name] = previous[name];
  }
  delete window.__pinkieDeskPreviousVendors;
})();
