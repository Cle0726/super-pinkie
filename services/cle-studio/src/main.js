// C.le. Studio — browser entry. Loaded by OpenClaw as native plugin UI.
import './styles/tokens.css';
import './styles/shell.css';
import './rooms/rooms.css';
import './composer/composer.css';
import {ensureTheme} from './core/theme.js';
import {startBrandGuard} from './core/brand.js';
import {mountRooms} from './rooms/rooms.js';
import {blink} from './rooms/blink.js';
import {mountComposer} from './composer/composer.js';
import {mountGaze} from './composer/gaze.js';

const VERSION = '0.1.0';

export default {
  id: 'cle-studio',
  activate(host) {
    if (!ensureTheme()) return () => {};
    const controller = new AbortController();
    const html = document.documentElement;
    html.dataset.cle = VERSION;
    startBrandGuard(controller.signal);
    const rooms = mountRooms(host, controller.signal);
    mountComposer(host, controller.signal);
    mountGaze(controller.signal);
    window.CLE = Object.assign(window.CLE || {}, {version: VERSION, host, rooms, blink});
    return () => {
      controller.abort();
      delete html.dataset.cle;
    };
  },
};
