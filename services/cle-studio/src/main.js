// C.le. Studio — browser entry. Loaded by OpenClaw as native plugin UI.
import './styles/tokens.css';
import './styles/shell.css';
import './rooms/rooms.css';
import './composer/composer.css';
import './styles/bridge.css';
import './process/status.css';
import {ensureTheme} from './core/theme.js';
import {startBrandGuard} from './core/brand.js';
import {mountRooms} from './rooms/rooms.js';
import {mountWelcome} from './rooms/welcome.js';
import {blink} from './rooms/blink.js';
import {mountComposer, composer} from './composer/composer.js';
import {mountGaze} from './composer/gaze.js';
import {loadLegacy} from './legacy/loader.js';
import {installLegacyShim} from './legacy/shim.js';
import {mountStatus} from './process/status.js';

const VERSION = '0.1.0';

export default {
  id: 'cle-studio',
  activate(host) {
    if (!ensureTheme()) return () => {};
    const controller = new AbortController();
    const html = document.documentElement;
    html.dataset.cle = VERSION;
    startBrandGuard(controller.signal);
    // the 2026.7 modules key night mode on data-pinkie-night; mirror the native theme mode
    const syncNight = () => html.toggleAttribute('data-pinkie-night', html.dataset.themeMode === 'dark');
    syncNight();
    const nightObserver = new MutationObserver(syncNight);
    nightObserver.observe(html, {attributes: true, attributeFilter: ['data-theme-mode']});
    controller.signal.addEventListener('abort', () => nightObserver.disconnect(), {once: true});
    const rooms = mountRooms(host, controller.signal);
    mountWelcome(host, controller.signal);
    mountComposer(host, controller.signal);
    mountGaze(controller.signal);
    mountStatus(host, controller.signal);
    installLegacyShim(host, controller.signal);
    const legacy = {};
    loadLegacy(legacy);
    window.CLE = Object.assign(window.CLE || {}, {version: VERSION, host, rooms, blink, legacy, composer});
    return () => {
      controller.abort();
      delete html.dataset.cle;
    };
  },
};
