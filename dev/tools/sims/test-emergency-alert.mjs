// The GM hears about an emergency call, and Backup rings before anyone picks up. Drives the real EmergencyService.
import { readFileSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

const toasts = [], sounds = [], emitted = [], opened = [];
const settings = { phoneEmergency: {}, phoneEmergencyActive: [], notifyGmEmergency: true };
globalThis.game = {
  user: { id: 'gm', isGM: true }, users: { activeGM: { id: 'gm' }, filter: () => [] }, scenes: { viewed: { id: 's1', name: 'Pacifica Docks' } }, combat: null,
  settings: { get: (m, k) => { if (k in settings) return settings[k]; throw new Error('none'); }, set: async (m, k, v) => { settings[k] = v; } },
  actors: { get: () => null },
  nightcity: { socketManager: { emit: (op, d) => emitted.push([op, d]) }, soundService: { play: (id) => sounds.push(id) }, notificationService: { showToastV2: (t) => { toasts.push(t); } }, openAdminTab: (tab, o) => opened.push([tab, o]) },
};
globalThis.Hooks = { on() {}, off() {} };
globalThis.foundry = { utils: { randomID: () => 'id' } };
globalThis.ui = { notifications: { warn() {}, info() {} } };

const { EmergencyService } = await import('../../../scripts/services/EmergencyService.js');
const svc = new EmergencyService();

// a Backup call
const backup = { kind: 'backup', name: 'Rache', org: 'NCPD', group: 'NCPD Detectives', place: 'Pacifica Docks' };
svc.announce(backup);
ok(emitted.length === 1 && emitted[0][1].op === 'started' && emitted[0][1].name === 'Rache', 'a call tells the other clients');
ok(!toasts.length, 'and the GM who placed it does not alert themselves');
await svc.handleSocket(emitted[0][1], 'u1');
ok(toasts.length === 1 && toasts[0].title === 'Backup called', 'a GM gets a toast');
ok(toasts[0].detail.includes('Rache') && toasts[0].detail.includes('Pacifica Docks') && toasts[0].detail.includes('NCPD: NCPD Detectives'), 'saying who, where and who they are calling');
ok(sounds.join() === 'em-alert', 'and one short tone');
toasts[0].onAction();
ok(opened[0][0] === 'phone' && opened[0][1].select === 'live', 'its button opens Live');

// Trauma Team
toasts.length = 0;
svc.gmAlert({ kind: 'trauma', name: 'V', patient: 'Rache', place: 'Docks', plan: 'Silver', auto: false });
ok(toasts[0].title === 'Trauma Team called' && toasts[0].detail.includes('Rache at Docks') && toasts[0].detail.includes('Silver plan') && toasts[0].detail.includes('called by V'), 'Trauma Team says who it is for and who called');
toasts.length = 0;
svc.gmAlert({ kind: 'trauma', name: 'Rache', patient: 'Rache', place: 'Docks', plan: 'Executive', auto: true });
ok(toasts[0].title.includes('Biomonitor') && !toasts[0].detail.includes('called by'), 'a Biomonitor says so');

// nobody at the screen
toasts.length = 0; emitted.length = 0;
svc.announce({ kind: 'trauma', name: 'Rache', patient: 'Rache', place: 'Docks', plan: 'silver' }, { auto: true, here: true });
ok(toasts.length === 1, 'an auto-call with nobody at the screen still reaches the GM rolling it');

// a player
toasts.length = 0; sounds.length = 0;
game.user.isGM = false;
await svc.handleSocket({ op: 'started', kind: 'backup', name: 'Rache', place: 'Docks', org: 'NCPD' }, 'u1');
ok(!toasts.length && !sounds.length, 'a player never gets the GM alert');
game.user.isGM = true;

// the switch
settings.notifyGmEmergency = false;
svc.gmAlert({ kind: 'backup', name: 'Rache', place: 'Docks', org: 'NCPD' });
ok(!toasts.length && !sounds.length, 'the setting switches it off');
settings.notifyGmEmergency = true;

// the clock: outside combat a team comes by itself
const E = await import('../../../scripts/utils/phoneEmergency.js');
const row = (x) => ({ id: 'a', kind: 'backup', name: 'Rache', org: 'NCPD', group: 'Patrol', place: 'Docks', sceneId: '', left: 2, rounds: 2, ...x });
const set = (x) => { settings.phoneEmergencyActive = [row(x)]; svc._tickAt = new Map(); };
const left = () => settings.phoneEmergencyActive[0]?.left;
set({});
await svc.tickRounds(1000);
ok(left() === 2, 'the first look only starts the clock');
await svc.tickRounds(1000 + E.ROUND_MS - 1);
ok(left() === 2, 'not before a round has passed');
await svc.tickRounds(1000 + E.ROUND_MS);
ok(left() === 1, 'a round passes by itself');
emitted.length = 0;
await svc.tickRounds(1000 + E.ROUND_MS * 2);
ok(!settings.phoneEmergencyActive.length && emitted.some(([, d]) => d.op === 'arrive'), 'when they run out, the team arrives and everyone is told');

set({});
await svc.tickRounds(0);
game.combat = { started: true, round: 1 };
await svc.tickRounds(E.ROUND_MS * 5);
ok(left() === 2, 'in combat the clock leaves it alone');
await svc.onCombatRound();
ok(left() === 1, 'combat counts it, even for a team called before the fight');
game.combat = null;
await svc.tickRounds(E.ROUND_MS * 5 + 1);
ok(left() === 1, 'and the fight ending does not bank a round');
await svc.tickRounds(E.ROUND_MS * 6 + 1);
ok(left() === 0 || !settings.phoneEmergencyActive.length, 'the clock picks up after it');

set({});
await svc.tickRounds(0);
game.paused = true;
await svc.tickRounds(E.ROUND_MS * 9);
ok(left() === 2, 'a paused game stops time');
game.paused = false;
await svc.tickRounds(E.ROUND_MS * 9 + 1);
ok(left() === 2, 'and pausing banks nothing');

set({});
await svc.tickRounds(0);
await svc.toggleHold('a');
ok(settings.phoneEmergencyActive[0].held === true, 'Hold sticks');
await svc.tickRounds(E.ROUND_MS * 3);
ok(left() === 2, 'a held team does not count down');
game.combat = { started: true };
await svc.onCombatRound();
ok(left() === 2, 'not in combat either');
game.combat = null;
await svc.minusRound('a');
ok(left() === 1, 'the GM can still move them by hand');
await svc.toggleHold('a');
await svc.tickRounds(E.ROUND_MS * 3 + 1);
ok(left() === 1, 'Resume starts a fresh round');

set({ arrived: true, left: 0 });
await svc.tickRounds(0); await svc.tickRounds(E.ROUND_MS * 9);
ok(settings.phoneEmergencyActive.length === 1, 'an arrived Trauma Team is left alone until the job is over');
game.users.activeGM = { id: 'other' };
set({});
await svc.tickRounds(0); await svc.tickRounds(E.ROUND_MS * 2);
ok(left() === 2, 'only the active GM runs the clock');
game.users.activeGM = { id: 'gm' };
game.user.isGM = false;
set({});
await svc.tickRounds(0); await svc.tickRounds(E.ROUND_MS * 2);
ok(left() === 2, 'a player never does');
game.user.isGM = true;
ok(E.miniWhy({ held: true }).includes('holding') && E.miniWhy({}, { combatOn: true }).includes('combat') && E.miniWhy({}).includes('6 seconds'), 'the strip says what it means');

// a preview's dice
const thrown = [];
await svc.showDie('1d10', 4);
ok(!thrown.length, 'no Dice So Nice, no problem');
game.dice3d = { showForRoll: async (r, u, sync) => { thrown.push({ r, sync }); } };
globalThis.Roll = class { constructor(f) { this.formula = f; this.terms = [{ results: [{ result: 9 }] }]; this.total = 9; } async evaluate() { return this; } };
const posted = emitted.length;
await svc.showDie('1d10', 4);
ok(thrown[0].r.terms[0].results[0].result === 4 && thrown[0].r.formula === '1d10', 'a preview shows the die it needs');
ok(thrown[0].sync === false, 'on this screen only');
ok(emitted.length === posted, 'and tells nobody');
delete game.dice3d;

// the chat card
const cards = [];
globalThis.ChatMessage = { create: async (d) => { cards.push(d); return d; }, getSpeaker: () => ({}), applyRollMode: (d, mode) => { if (mode !== 'publicroll') d.whisper = ['gm']; } };
settings.phoneSpecial = [{ id: 'TRAUMA', num: 'TRAUMA', name: 'Trauma Team', img: '' }];
settings.emergencyChatCard = true;
game.settings.get = ((orig) => (m, k) => (m === 'core' && k === 'rollMode' ? (settings.rollMode || 'publicroll') : orig(m, k)))(game.settings.get);
await svc._callCard({ kind: 'backup', name: 'Rache', org: 'NCPD', place: 'Docks' });
ok(cards[0].content.includes('Rache is calling for backup') && cards[0].content.includes('NCPD · Docks') && !cards[0].whisper, 'Backup: the whole table sees who is calling, and where');
await svc._callCard({ kind: 'trauma', name: 'V', patient: 'Rache', place: 'Docks' });
ok(cards[1].content.includes('V is calling Trauma Team for Rache'), 'Trauma Team says who it is for');
await svc._callCard({ kind: 'trauma', name: 'Rache', patient: 'Rache', place: 'Docks' }, { auto: true });
ok(cards[2].content.includes('Biomonitor is calling Trauma Team'), 'a Biomonitor says so');
settings.rollMode = 'gmroll';
await svc._callCard({ kind: 'backup', name: 'Rache', org: 'NCPD', place: 'Docks' });
ok(cards[3].whisper, 'a whispered call stays whispered');
settings.rollMode = 'publicroll';
await svc._callCard({ kind: 'backup', name: '<b>x</b>', org: 'N', place: 'D' });
ok(!cards[4].content.includes('<b>x</b>'), 'names are escaped');
settings.emergencyChatCard = false;
const nCards = cards.length;
await svc._callCard({ kind: 'backup', name: 'Rache', org: 'N', place: 'D' });
ok(cards.length === nCards, 'the setting switches it off');
settings.emergencyChatCard = true;

// the phone button + the New menu
const Ui = read('scripts/init/registerUIComponents.js'), Msg = read('scripts/init/registerMessagingSystem.js');
ok(/name: 'ncm-phone'/.test(Ui) && /openPhone\?\.\(\)/.test(Ui) && /callsOn/.test(Ui), 'a phone button, when calls are on');
ok(/ns\.openPhone = async/.test(Msg) && /_openFilter = 'calls'/.test(Msg) && /"Phone": "Phone"/.test(read('languages/en.json')), 'it opens the Calls tab');
const MsgT = read('templates/admin-panel/tab-messages.hbs');
ok(!/sendAsPicker/.test(MsgT) && /ncm-msg2-newmenu/.test(MsgT) && /data-op="sendAsPick"/.test(MsgT) && /case 'sendAsPick':/.test(read('scripts/ui/AdminPanel/tabs/MessagesTab.js')), 'Send as moved into the New menu');

// wiring
const Hud = read('scripts/ui/Calls/EmergencyHud.js');
ok((Hud.match(/if \(preview\) await svc\.showDie/g) || []).length === 3, 'every die in a preview call is thrown');
ok(/async _roll\(formula\)[\s\S]{0,160}_showDice3d/.test(read('scripts/services/EmergencyService.js')), 'a real call throws real dice, for everyone');
ok(/class="ncm-r5-mini" data-mini=/.test(Hud) && /miniWhy\(e/.test(Hud), 'the strip is a button that explains itself');
const Tpl = read('templates/admin-panel/tab-phone.hbs');
ok(/data-op="emHold"/.test(Tpl) && /case 'emHold':/.test(read('scripts/ui/AdminPanel/tabs/PhoneTab.js')), 'Live has Hold');
ok(/setInterval\(\(\) => service\.tickRounds\(\)/.test(read('scripts/services/EmergencyService.js')), 'the clock runs');
ok((Hud.match(/if \(!preview\) svc\.announce\(info/g) || []).length === 2, 'both calls announce, and a preview never does');
ok(Hud.indexOf('svc.announce(info, { auto })') > Hud.indexOf("return this._noSignalCard(scene, callName"), 'a call with no signal never went out, so it does not announce');
const backupCode = Hud.slice(Hud.indexOf('async backup('));
ok(/_sound\(look\.openSound\)/.test(backupCode) && /call-ringback/.test(backupCode) && /if \(i === 1\) \{ this\._sound\('em-radio-in'\)/.test(backupCode), 'Backup opens, rings, then the radio picks up');
ok(existsSync(new URL('../../../assets/sounds/calls/em-alert.wav', import.meta.url)), 'the tone exists');
const Cat = read('scripts/utils/soundCatalog.js'), C = read('scripts/utils/constants.js');
ok(Cat.includes("'em-alert':") && C.includes("'em-alert':"), 'it is on the Sound Board');
ok(/register\(MODULE_ID, 'notifyGmEmergency'/.test(read('scripts/core/SettingsManager.js')), 'the setting is registered');

console.log(`test-emergency-alert: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
