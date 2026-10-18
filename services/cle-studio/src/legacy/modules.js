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
  {id: 'learning', css: ['laolao-learning-stage.css', 'laolao-learning-library.css'], js: ['laolao-learning-stage.js', 'laolao-learning-library.js']},
  {id: 'workbench', css: ['laolao-workbench.css', 'laolao-workbench-notebook.css'], js: ['laolao-workbench.js']},
  {id: 'memory', css: ['laolao-memory.css'], js: ['laolao-memory.js']},
  {id: 'capabilities', css: ['laolao-settings-user.css', 'capabilities.css'], js: ['laolao-capabilities.js']},
  {id: 'thinking', js: ['laolao-deep-think.js', 'laolao-context-compact.js']},
  {id: 'web-gpt', js: ['laolao-web-gpt-collab.js']},
  {id: 'usage', css: ['laolao-usage-stats.css'], js: ['laolao-usage-stats.js']},
  {id: 'voice', js: ['laolao-live-voice.js']},
  {id: 'desensitize', js: ['laolao-desensitize.js']},
  {id: 'companion', css: ['laolao-companion.css'], js: ['laolao-companion.js']},
];
