// Functional modules carried over from the 2026.7 skin. Each file lives in static/legacy/
// (a reworked copy, never the original). Order matters: dependencies first.
// Add entries here as modules are ported; `enabled: false` keeps a module out without deleting it.
export const LEGACY_MODULES = [
  {id: 'rich', css: ['laolao-rich.css'], js: ['laolao-rich.js']},
  {id: 'plan', js: ['laolao-plan.js']},
  {id: 'ask-user', css: ['laolao-ask-user.css'], js: ['laolao-ask-user.js']},
  {id: 'images', css: ['image-viewer.css'], js: ['laolao-image-viewer.js']},
  {id: 'browser', css: ['browser.css', 'laolao-material-preview.css'], js: ['laolao-link-viewer.js', 'laolao-material-preview.js']},
  {id: 'selection', js: ['laolao-selection-actions.js']},
  {id: 'learning-inline', css: ['laolao-learning-inline.css','laolao-learning-practice.css'], js: ['laolao-learning-practice.js','laolao-learning-inline.js']},
  {id: 'learning', css: ['laolao-learning-stage.css', 'laolao-learning-library.css'], js: ['laolao-learning-stage.js', 'laolao-learning-library.js']},
  {id: 'workbench', css: ['laolao-workbench.css', 'laolao-workbench-notebook.css'], js: ['laolao-workbench.js']},
  {id: 'memory', css: ['laolao-memory.css'], js: ['laolao-memory.js']},
  {id: 'capabilities', css: ['laolao-settings-user.css', 'capabilities.css'], js: ['laolao-capabilities.js']},
  {id: 'thinking', js: ['laolao-deep-think.js', 'laolao-context-compact.js']},
  {id: 'web-gpt', js: ['laolao-web-gpt-collab.js']},
  {id: 'usage', css: ['laolao-usage-stats.css'], js: ['laolao-usage-stats.js']},
  {id: 'voice', js: ['laolao-live-voice.js']},
  {id: 'desensitize', js: ['laolao-desensitize.js']},
  {id: 'presentation', css: ['presentation.css'], js: ['laolao-laser-pointer.js']},
  {id: 'companion', css: ['laolao-companion.css'], js: ['laolao-cat-rig.js', 'laolao-companion.js']},
  // Model + reasoning picker: brand tabs, per-family slider stops, route-preserving save.
  // Shell look is being redesigned, so this ships behaviour without a stylesheet for now.
  {id: 'model-picker', js: ['laolao-model-picker.js']},
  // Sidebar: ejects the native nav/online/session lists and mounts the original grouped
  // sidebar (pins, folder projects, search, archive, cleanup, more ›) under .sidebar-brand.
  // Order: autohide needs #cle-sidebar to exist later; the entry mounts the list module.
  {id: 'sidebar', css: ['laolao-sidebar.css', 'laolao-sidebar-surface.css'], js: ['laolao-sidebar-autohide.js', 'laolao-session-list.js', 'laolao-sidebar.js']},
];
