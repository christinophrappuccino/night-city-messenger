/**
 * Register Call System
 * @file scripts/init/registerCallSystem.js
 * @module night-city-messenger
 * @description Calls (dev/design/CALLS.md, build plan §11).
 *   init/40    → key bindings (answer / decline / hold — rebindable in Configure Controls)
 *   ready/125  → CallService + the call HUD + socket handlers + the network watch
 *   ready/126  → game.nightcity launchers (placeCall, openCalls)
 */

import { ncmNotify } from '../utils/notify.js';
import { OverheardService } from '../services/OverheardService.js';
import { OverheardHud } from '../ui/Calls/OverheardHud.js';
import { EmergencyService, wireEmergency } from '../services/EmergencyService.js';
import { EmergencyHud } from '../ui/Calls/EmergencyHud.js';
import { ConversationService } from '../services/ConversationService.js';
import { MODULE_ID, EVENTS, SOCKET_OPS } from '../utils/constants.js';
import { log, isPrimaryGM } from '../utils/helpers.js';
import { CallService } from '../services/CallService.js';
import { CallHud } from '../ui/Calls/CallHud.js';
import { PayphoneService } from '../services/PayphoneService.js';
import { PayphoneBooth } from '../ui/Calls/PayphoneBooth.js';

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

  // Conversations is a FEATURE (utils/features.js): the service object always exists, so the UI can ask it
  // `enabled`, but when it is off its hooks are never wired and its socket ops get the "switched off" stand-in.
  initializer.register('ready', 124, 'ConversationService', () => {
    const service = new ConversationService();
    game.nightcity.conversationService = service;
    const sm = game.nightcity.socketManager;
    sm.register(SOCKET_OPS.CONVERSATION_REQUEST, (data, sender) => service.handleRequest(data, sender).catch((e) => log.warn(`Conversations: a request failed: ${e.message}`)), { feature: 'conversations' });
    sm.register(SOCKET_OPS.CONVERSATION_RESULT, (data) => service.handleResult(data), { feature: 'conversations' });
  });
  initializer.register('ready', 124, 'Conversations: hooks', () => game.nightcity.conversationService.wire(), { feature: 'conversations' });
  initializer.register('postReady', 23, 'Conversations: held lines', () => game.nightcity.conversationService.restorePending(), { feature: 'conversations' });

  // Calls, Payphones, Emergency lines and Overheard calls are FEATURES (utils/features.js, stage 2 step 15). The four
  // services always exist (numbers, payphones and scripts are data the GM can still edit, and much of the UI asks
  // `callService?.enabled`), but a part that is off has no screen, no hooks, no timers, and its socket ops are dropped.
  initializer.register('ready', 125, 'CallService', () => {
    const service = new CallService();
    game.nightcity.callService = service;
    game.nightcity.emergencyService = new EmergencyService();
    game.nightcity.overheardService = new OverheardService();
    game.nightcity.payphoneService = new PayphoneService();
    // numbers are data: a deleted character or terminal gives its number back whether or not calls are on
    Hooks.on('deleteActor', (actor) => service.retireOwner({ actorId: actor.id, why: 'Character deleted' }));
    Hooks.on('deleteItem', (item) => { if (isPrimaryGM() && service.lineOfItem(item.uuid)) service.setTerminalNumber(item, { number: null }); });

    const sm = game.nightcity.socketManager;
    const calls = { feature: 'calls' };
    sm.register(SOCKET_OPS.CALL, (data, sender) => service.handleSocket(data, sender), calls);
    sm.register(SOCKET_OPS.CALL_LOG_REQUEST, (data, sender) => service.handleLogRequest(data, sender ?? null).catch((e) => log.warn(`Calls: log request failed: ${e.message}`)), calls);
    sm.register(SOCKET_OPS.CALL_AUDIO, (data, sender) => service.handleAudio(data, sender).catch((e) => log.warn(`Calls: a recording failed: ${e.message}`)), calls);
    sm.register(SOCKET_OPS.CALL_VM_REQUEST, (data, sender) => service.handleVoicemailRequest(data, sender).catch((e) => log.warn(`Calls: voicemail request failed: ${e.message}`)), calls);
    sm.register(SOCKET_OPS.CALL_LINE_REQUEST, (data, sender) => service.handleLineRequest(data, sender).catch((e) => log.warn(`Calls: line request failed: ${e.message}`)), calls);
    sm.register(SOCKET_OPS.CALL_EMERGENCY, (data, sender) => game.nightcity.emergencyService.handleSocket(data, sender).catch((e) => log.warn(`Emergency: ${e.message}`)), { feature: 'emergency' });
    sm.register(SOCKET_OPS.CALL_OVERHEARD, (data, sender) => game.nightcity.overheardService.handleSocket(data, sender), { feature: 'overheard' });
    sm.register(SOCKET_OPS.PAYPHONE, (data, sender) => game.nightcity.payphoneService.handleSocket(data, sender), { feature: 'payphones' });
    log.info('CallService initialized');
  });

  initializer.register('ready', 125, 'Calls: call screen and live calls', () => {
    const service = game.nightcity.callService;
    const hud = new CallHud(service);
    hud.init();
    game.nightcity.callHud = hud;

    // the GM's client clears recordings older than the keep setting (their words stay), once per session
    if (isPrimaryGM()) setTimeout(() => service.purgeRecordings().then((r) => { if (r?.count) log.info(`Calls: cleared ${r.count} old recording(s)`); }).catch(() => {}), 15000);

    // a call-log or voicemail page appeared / changed / went: the Agent's Calls tab and Admin → Phone refresh
    const pageHook = (page) => {
      const f = page?.flags?.[MODULE_ID];
      if (f?.callLog || f?.voicemail) game.nightcity.eventBus.emit(EVENTS.CALL_LOGGED, { kind: f.callLog ? 'log' : 'voicemail' });
    };
    for (const h of ['createJournalEntryPage', 'updateJournalEntryPage', 'deleteJournalEntryPage']) Hooks.on(h, pageHook);

    // Someone left (closed the tab, lost the connection, reloaded): every client ends the calls they were a
    // party to and clears their payphone handsets (audit DATA-17, DATA-21). Nothing else would ever end them.
    Hooks.on('userConnected', (user, connected) => {
      if (connected || !user?.id) return;
      service.onUserGone(user.id);
      if (game.nightcity.payphoneService?.enabled) game.nightcity.payphoneService.onUserGone(user.id);
    });

    // losing signal mid-call drops it
    game.nightcity.eventBus.on(EVENTS.NETWORK_CHANGED, () => service.checkSignal());
  }, { feature: 'calls' });

  initializer.register('ready', 125, 'Calls: emergency lines', () => {
    const emergency = game.nightcity.emergencyService;
    game.nightcity.emergencyHud = new EmergencyHud(emergency, game.nightcity.callService);
    wireEmergency(emergency);
  }, { feature: 'emergency' });

  initializer.register('ready', 125, 'Calls: overheard calls', () => {
    const overheard = game.nightcity.overheardService;
    game.nightcity.overheardHud = new OverheardHud(overheard, game.nightcity.callService);
    overheard.wire();
  }, { feature: 'overheard' });

  // payphones: a booth is a caller identity on CallService; this owns reach, who is on it, the ring and the speaker
  initializer.register('ready', 125, 'Calls: payphones', () => {
    const payphones = game.nightcity.payphoneService;
    game.nightcity.payphoneBooth = new PayphoneBooth(payphones);
    payphones.init();
    game.nightcity.payphoneBooth.init();
  }, { feature: 'payphones' });

  initializer.register('ready', 126, 'Call launchers', () => {
    /** Place a call from this client (the operator character, or `as` an identity — GM). */
    game.nightcity.placeCall = async (number, as = {}) => {
      const r = await game.nightcity.callService?.placeCall(number, as);
      if (r && !r.ok && r.error) ncmNotify.warn(r.error);
      return r;
    };
    /** Open a payphone's booth (by id), as a link would: no reach check. */
    game.nightcity.openPayphone = (id) => game.nightcity.payphoneService?.open(id, { skipReach: true });
  });
}
