/**
 * Register Call System
 * @file scripts/init/registerCallSystem.js
 * @module night-city-messenger
 * @description Calls (dev/design/CALLS.md, build plan §11).
 *   init/40    → key bindings (answer / decline / hold — rebindable in Configure Controls)
 *   ready/125  → CallService + the call HUD + socket handlers + the network watch
 *   ready/126  → game.nightcity launchers (placeCall, openCalls)
 */

import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';
import { CallService } from '../services/CallService.js';
import { CallHud } from '../ui/Calls/CallHud.js';

export function registerCallSystem(initializer) {

  // ─── Key bindings: only act while a call is on screen (they return false otherwise, so the key passes through) ───
  initializer.register('init', 40, 'Call key bindings', () => {
    const bind = (name, label, key, which) => game.keybindings.register(MODULE_ID, name, {
      name: label, hint: 'Only while a call is ringing or live.',
      editable: [{ key }],
      onDown: () => !!game.nightcity?.callHud?.key?.(which),
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });
    bind('callAnswer', 'Calls: answer', 'KeyY', 'answer');
    bind('callDecline', 'Calls: decline / hang up', 'KeyN', 'decline');
    bind('callHold', 'Calls: hold & answer / swap back', 'KeyH', 'hold');
    bind('callDeclineWaiting', 'Calls: decline the waiting call', 'KeyD', 'declineWaiting');
  });

  initializer.register('ready', 125, 'CallService', () => {
    const service = new CallService();
    game.nightcity.callService = service;
    const hud = new CallHud(service);
    hud.init();
    game.nightcity.callHud = hud;

    const sm = game.nightcity.socketManager;
    sm.register(SOCKET_OPS.CALL, (data, sender) => service.handleSocket(data, sender));
    sm.register(SOCKET_OPS.CALL_LOG_REQUEST, (data) => service.handleLogRequest(data).catch((e) => log.warn(`Calls: log request failed: ${e.message}`)));
    sm.register(SOCKET_OPS.CALL_AUDIO, (data, sender) => service.handleAudio(data, sender).catch((e) => log.warn(`Calls: a recording failed: ${e.message}`)));
    sm.register(SOCKET_OPS.CALL_VM_REQUEST, (data, sender) => service.handleVoicemailRequest(data, sender).catch((e) => log.warn(`Calls: voicemail request failed: ${e.message}`)));
    sm.register(SOCKET_OPS.CALL_LINE_REQUEST, (data, sender) => service.handleLineRequest(data, sender).catch((e) => log.warn(`Calls: line request failed: ${e.message}`)));

    // the GM's client clears recordings older than the keep setting (their words stay), once per session
    if (game.user.isGM && game.users.activeGM?.id === game.user.id) setTimeout(() => service.purgeRecordings().then((r) => { if (r?.count) log.info(`Calls: cleared ${r.count} old recording(s)`); }).catch(() => {}), 15000);

    // a call-log or voicemail page appeared / changed / went: the Agent's Calls tab and Admin → Phone refresh
    const pageHook = (page) => {
      const f = page?.flags?.[MODULE_ID];
      if (f?.callLog || f?.voicemail) game.nightcity.eventBus.emit(EVENTS.CALL_LOGGED, { kind: f.callLog ? 'log' : 'voicemail' });
    };
    for (const h of ['createJournalEntryPage', 'updateJournalEntryPage', 'deleteJournalEntryPage']) Hooks.on(h, pageHook);

    // losing signal mid-call drops it
    game.nightcity.eventBus.on(EVENTS.NETWORK_CHANGED, () => service.checkSignal());
    log.info('CallService initialized');
  });

  initializer.register('ready', 126, 'Call launchers', () => {
    /** Place a call from this client (the operator character, or `as` an identity — GM). */
    game.nightcity.placeCall = async (number, as = {}) => {
      const r = await game.nightcity.callService?.placeCall(number, as);
      if (r && !r.ok && r.error) ui.notifications?.warn(r.error);
      return r;
    };
  });
}
