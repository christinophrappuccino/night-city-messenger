/**
 * Watching over someone's shoulder: WatchService + its hooks.
 * @file scripts/init/registerWatchSystem.js
 * @module night-city-messenger
 */

import { SOCKET_OPS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';
import { WatchService } from '../services/WatchService.js';
import { WatchWindowApp } from '../ui/Watch/WatchWindowApp.js';

export function registerWatchSystem(initializer) {
  initializer.register('ready', 127, 'WatchService', () => {
    const service = new WatchService();
    game.nightcity.watchService = service;
    service._openWindow = (offer) => { const win = new WatchWindowApp(offer); win.render(true); return win; };
    game.nightcity.socketManager?.register(SOCKET_OPS.WATCH, (data, sender) => {
      try { service.onSocket(data, sender); } catch (err) { log.error(`Watch socket: ${err.message}`); }
    });
    Hooks.on('renderApplicationV2', (app) => { try { service.onRender(app); } catch (err) { log.debug(`Watch render: ${err.message}`); } });
    Hooks.on('closeApplicationV2', (app) => { try { service.stopShare(app, { closing: true }); } catch (err) { log.debug(`Watch close: ${err.message}`); } });
    Hooks.on('userConnected', (user, connected) => { if (!connected) service.onUserGone(user.id); });
    service.hello();
  });
}
