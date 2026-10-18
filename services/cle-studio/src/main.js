// C.le. Studio — browser entry. Loaded by OpenClaw as native plugin UI.
import './styles/tokens.css';
import './styles/shell.css';
import './rooms/rooms.css';
import './composer/composer.css';
import './styles/bridge.css';
import './process/status.css';
import './learning/study.css';
import './styles/tiers.css';
import './line/line.css';
import {ensureTheme} from './core/theme.js';
import {startBrandGuard} from './core/brand.js';
import {mountRooms} from './rooms/rooms.js';
import {mountWelcome} from './rooms/welcome.js';
import {blink} from './rooms/blink.js';
import {mountComposer, composer} from './composer/composer.js';
import {mountGaze} from './composer/gaze.js';
import {loadLegacy} from './legacy/loader.js';
import {installLegacyShim} from './legacy/shim.js';
import {mountUtilities} from './legacy/utilities.js';
import {mountStatus} from './process/status.js';
import {mountStudy} from './learning/study.js';
import {mountSplash} from './splash/splash.js';
import {initModes} from './core/modes.js';

const VERSION = '0.1.0';

export default {
  id: 'cle-studio',
  activate(host) {
    if (!ensureTheme()) return () => {};
    const controller = new AbortController();
    const html = document.documentElement;
    html.dataset.cle = VERSION;
    initModes();
    try { startBrandGuard(controller.signal); } catch (error) { console.error('[cle] brand guard failed', error); }
    // the 2026.7 modules key night mode on data-pinkie-night; mirror the native theme mode
    const syncNight = () => html.toggleAttribute('data-pinkie-night', html.dataset.themeMode === 'dark');
    syncNight();
    const nightObserver = new MutationObserver(syncNight);
    nightObserver.observe(html, {attributes: true, attributeFilter: ['data-theme-mode']});
    controller.signal.addEventListener('abort', () => nightObserver.disconnect(), {once: true});
    // each part stands alone: one failing module must never take the brand, the rooms or the composer down
    const safe = (name, fn) => { try { return fn(); } catch (error) { console.error(`[cle] ${name} failed`, error); return null; } };
    safe('splash', () => mountSplash(controller.signal));
    const rooms = safe('rooms', () => mountRooms(host, controller.signal));
    safe('welcome', () => mountWelcome(host, controller.signal));
    safe('composer', () => mountComposer(host, controller.signal));
    safe('gaze', () => mountGaze(controller.signal));
    safe('status', () => mountStatus(host, controller.signal));
    safe('study', () => mountStudy(host, controller.signal));
    safe('shim', () => installLegacyShim(host, controller.signal));
    const utilities = safe('utilities', () => mountUtilities(host, controller.signal));
    const legacy = {};
    safe('legacy', () => loadLegacy(legacy));
    window.CLE = Object.assign(window.CLE || {}, {version: VERSION, host, rooms, blink, legacy, composer, utilities});
    return () => {
      controller.abort();
      delete html.dataset.cle;
    };
  },
};
