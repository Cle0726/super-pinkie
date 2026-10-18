// C.le. Studio — browser entry. Loaded by OpenClaw as native plugin UI.
import './styles/tokens.css';
import './styles/shell.css';
import {ensureTheme} from './core/theme.js';
import {startBrandGuard} from './core/brand.js';

const VERSION = '0.1.0';

export default {
  id: 'cle-studio',
  activate(host) {
    if (!ensureTheme()) return () => {};
    const controller = new AbortController();
    const html = document.documentElement;
    html.dataset.cle = VERSION;
    startBrandGuard(controller.signal);
    window.CLE = Object.assign(window.CLE || {}, {version: VERSION, host});
    return () => {
      controller.abort();
      delete html.dataset.cle;
    };
  },
};
