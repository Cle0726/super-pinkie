/* Keep the study desk's pinned libraries separate from the existing App motion. */
(() => {
  window.__pinkieDeskPreviousVendors = Object.fromEntries(
    ['gsap', 'SplitText', 'DrawSVGPlugin', 'confetti', 'TweenLite', 'TweenMax', 'TimelineLite', 'TimelineMax',
      'CSSPlugin', 'Power0', 'Power1', 'Power2', 'Power3', 'Power4', 'Linear', 'Quad', 'Cubic', 'Quart', 'Quint',
      'Strong', 'Sine', 'Expo', 'Circ', 'Elastic', 'Back', 'Bounce', 'SteppedEase'].map(name => [name, window[name]])
  );
})();
