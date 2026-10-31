// C.le. Studio — browser entry. Loaded by OpenClaw as native plugin UI.
import './styles/tokens.css';
import './styles/shell.css';
import './styles/glass.css';
import './rooms/rooms.css';
import './rooms/backdrop.css';
import './composer/composer.css';
import './styles/bridge.css';
import './process/status.css';
import './process/gazefx.css';
import './composer/keys.css';
import './process/effects.css';
import './learning/study.css';
import './styles/tiers.css';
import './line/line.css';
import {ensureTheme} from './core/theme.js';
import {beginActivation} from './core/activation.js';
import {retainSkin} from './core/skin.js';
import {startBrandGuard} from './core/brand.js';
import {mountRooms} from './rooms/rooms.js';
import {mountWelcome} from './rooms/welcome.js';
import {mountBackdrop} from './rooms/backdrop.js';
import {mountGazeFx} from './process/gazefx.js';
import {mountKeys} from './composer/keys.js';
import {blink} from './rooms/blink.js';
import {mountComposer, composer, mountToolFold} from './composer/composer.js';
import {mountGaze} from './composer/gaze.js';
import {mountReasoning} from './composer/reasoning.js';   // after gaze: its styles override models.css
import {loadLegacy} from './legacy/loader.js';
import {installLegacyShim, makeHostFacade} from './legacy/shim.js';
import {mountUtilities} from './legacy/utilities.js';
import {mountStatus} from './process/status.js';
import {mountTranscript} from './process/transcript.js';
import {mountPrune} from './core/prune.js';
import {mountViewport} from './core/viewport.js';
import {mountRecovery} from './recovery/recovery.js';
import {mountStudy} from './learning/study.js';
import {mountSplash} from './splash/splash.js';
import {initModes} from './core/modes.js';
import {mountLineDecor} from './line/decorate.js';

const VERSION = '0.1.0';

export default {
  id: 'cle-studio',
  activate(host) {
    const controller = beginActivation();
    // Classic scripts outlive the host activation. Publish the safe facade before
    // installLegacyShim can notify them about a new session or room.
    const legacyHost = makeHostFacade();
    window.CLE = Object.assign(window.CLE || {}, {host: legacyHost});
    // The brand guard has to run even on the activation that decides to reload for the theme:
    // that activation still paints a document, and the router writes "— OpenClaw" into the title
    // on its first render. Leaving the guard until after ensureTheme() returns true meant the
    // very first session kept the upstream title and sidebar labels.
    try { startBrandGuard(controller.signal); } catch (error) { console.error('[cle] brand guard failed', error); }
    if (!ensureTheme()) return controller.dispose;
    const html = document.documentElement;
    html.dataset.cle = VERSION;
    html.dataset.cleActive = '1';
    retainSkin(import.meta.url);
    initModes();
    // the 2026.7 modules key night mode on data-pinkie-night; mirror the native theme mode
    const syncNight = () => html.toggleAttribute('data-pinkie-night', html.dataset.themeMode === 'dark');
    syncNight();
    const nightObserver = new MutationObserver(syncNight);
    nightObserver.observe(html, {attributes: true, attributeFilter: ['data-theme-mode']});
    controller.signal.addEventListener('abort', () => nightObserver.disconnect(), {once: true});
    // each part stands alone: one failing module must never take the brand, the rooms or the composer down
    const safe = (name, fn) => { try { return fn(); } catch (error) { console.error(`[cle] ${name} failed`, error); return null; } };
    safe('prune', () => mountPrune(controller.signal));
    safe('viewport', () => mountViewport(controller.signal));
    safe('splash', () => mountSplash(controller.signal));
    safe('line-decor', () => mountLineDecor(controller.signal));
    const rooms = safe('rooms', () => mountRooms(host, controller.signal));
    safe('backdrop', () => mountBackdrop(controller.signal));
    safe('welcome', () => mountWelcome(host, controller.signal));
    safe('composer', () => mountComposer(host, controller.signal));
    safe('gaze', () => mountGaze(controller.signal));
    safe('gazefx', () => mountGazeFx(controller.signal));
    safe('keys', () => mountKeys(controller.signal));
    safe('reasoning', () => mountReasoning(controller.signal));
    safe('tool-fold', () => mountToolFold(controller.signal));
    safe('status', () => mountStatus(host, controller.signal));
    safe('transcript', () => mountTranscript(controller.signal));
    safe('recovery', () => mountRecovery(host, controller.signal));
    safe('study', () => mountStudy(host, controller.signal));
    safe('shim', () => installLegacyShim(host, controller.signal));
    const utilities = safe('utilities', () => mountUtilities(host, controller.signal));
    const legacy = {};
    safe('legacy', () => loadLegacy(legacy));
    window.CLE = Object.assign(window.CLE || {}, {version: VERSION, host: legacyHost, rooms, blink, legacy, composer, utilities});
    return controller.dispose;
  },
};
