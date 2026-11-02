// Trauma Team + Lawman Backup: the rules, and the real service over a mocked world.
import fs from 'fs';
import { sanitizeEmergency, holdsItem, roleRank, traumaPlan, autoCallDue, backupOptions, backupDefault, backupResult, vitals, DEFAULT_ORGS, TRAUMA_BEATS, BACKUP_BEATS } from '../../../scripts/utils/phoneEmergency.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const read = (p) => fs.readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

/* ── items ── */
const scanner = { name: 'Radio Scanner', type: 'cyberware', system: { isInstalledInActor: false } };
ok(holdsItem([scanner], [{ name: 'radio scanner' }]).how === 'Not installed' && !holdsItem([scanner], [{ name: 'Radio Scanner' }]).counts, 'cyberware not installed does not count');
ok(holdsItem([{ ...scanner, system: { isInstalledInActor: true } }], [{ name: 'Radio Scanner' }]).counts, 'installed does');
ok(holdsItem([{ name: 'Radio Scanner', type: 'gear' }], [{ name: 'Radio Scanner', type: 'cyberware' }]) === null, 'the stored type matters');
ok(holdsItem([{ name: 'Card', type: 'gear' }], [{ name: 'Nope' }, { name: 'Card' }]).counts, 'any one on the list counts');
ok(roleRank([{ type: 'role', name: 'Lawman', system: { rank: 5 } }], 'lawman') === 5 && roleRank([], 'Lawman') === 0, 'a role rank');

/* ── plans ── */
const c = sanitizeEmergency({ trauma: { plans: { v: 'silver' } } });
ok(c.trauma.source === 'hand' && c.trauma.auto && c.trauma.bioItem[0].name === 'Biomonitor', 'the defaults');
ok(traumaPlan(c, { actorId: 'v' }) === 'silver' && traumaPlan(c, { actorId: 'x' }) === 'none', 'by hand');
ok(traumaPlan(c, { actorId: 'x', items: [{ type: 'role', name: 'Exec', system: { rank: 6 } }] }) === 'silver', 'an Exec at rank 6 has Silver');
ok(traumaPlan(c, { actorId: 'x', items: [{ type: 'role', name: 'Exec', system: { rank: 8 } }] }) === 'exec', 'at rank 8, Executive');
ok(traumaPlan(c, { actorId: 'v', items: [{ type: 'role', name: 'Exec', system: { rank: 8 } }] }) === 'exec', 'Teamwork can raise a plan');
const it = sanitizeEmergency({ trauma: { source: 'item', itemSilver: ['S Card'], itemExec: [{ name: 'E Card' }], teamwork: false } });
ok(traumaPlan(it, { actorId: 'v', items: [{ type: 'gear', name: 'S Card' }] }) === 'silver' && traumaPlan(it, { actorId: 'v', items: [{ type: 'gear', name: 'E Card' }, { type: 'gear', name: 'S Card' }] }) === 'exec', 'from an item, the better one wins');
const bio = [{ name: 'Biomonitor', type: 'cyberware', system: { isInstalledInActor: true } }];
ok(autoCallDue(c, { hp: 4, body: 6, wasHp: 10, items: bio }), 'it calls under BODY');
ok(!autoCallDue(c, { hp: 7, body: 6, wasHp: 10, items: bio }) && !autoCallDue(c, { hp: 4, body: 6, wasHp: 10, items: [] }) && !autoCallDue(c, { hp: 4, body: 6, wasHp: 3, items: bio }), 'not above it, not without one, not when healing');
ok(!autoCallDue(sanitizeEmergency({ trauma: { auto: false } }), { hp: 4, body: 6, wasHp: 10, items: bio }), 'and the GM can switch it off');

/* ── backup ── */
const ncpd = DEFAULT_ORGS.ncpd;
ok(backupOptions(ncpd, 4).every((r) => r.r1 <= 4) && backupOptions(ncpd, 4).length === 4, 'your rank or below');
ok(backupDefault(ncpd, 4).r1 === 3 && backupDefault(ncpd, 0) === null, 'the strongest you can call');
const from = backupDefault(ncpd, 4);
ok(backupResult(ncpd, from, { d10: 8, rank: 4 }).ok === false, 'over your rank, nobody');
const a = backupResult(ncpd, from, { d10: 4, rank: 4, d6: 3 });
ok(a.ok && a.rounds === 3 && a.who === from.name && !a.up, 'at your rank, they answer');
const up = backupResult(ncpd, from, { d10: 1, rank: 4, d6: 6, second: 2 });
ok(up.up && up.rounds === 2 && backupOptions(ncpd, 10).find((r) => r.name === up.who).r1 > from.r2, 'a 6 brings the next group up, and a second die sets the rounds');
const top = backupDefault(ncpd, 10);
ok(backupResult(ncpd, top, { d10: 1, rank: 10, d6: 6, second: 1 }).who.includes('two groups'), 'nobody above: twice as many');
ok(Object.keys(sanitizeEmergency({}).backup.orgs).length === 10, 'ten sample organizations');
{
  const names = Object.values(sanitizeEmergency({}).backup.orgs).flatMap((o) => o.rows.map((x) => x.name.toLowerCase()));
  // the book's table stays in the book: these are its row names, spelled so this file does not repeat them whole
  for (const w of ['corporate sec', 'local beat', 'sheriff\'s dep', 'recovery zone', 'c-swat', 'national law']) ok(!names.some((n) => n.includes(w)), 'no sample group copies the book: ' + w);
  ok(sanitizeEmergency({ backup: { orgs: {} } }).backup.orgs && Object.keys(sanitizeEmergency({ backup: { orgs: {} } }).backup.orgs).length === 0, 'every organization can be deleted, and stays deleted');
}
ok(Object.keys(sanitizeEmergency({ backup: { orgs: { a: { name: 'X', rows: [{ r1: 12, r2: 1, name: '' }] } } } }).backup.orgs).length === 1, 'a GM list replaces them');
ok(sanitizeEmergency({ backup: { orgs: { a: { rows: [{ r1: 12, r2: 1 }] } } } }).backup.orgs.a.rows[0].r1 === 10, 'ranks stay in range');
ok(sanitizeEmergency(null).trauma.noPlan === 'refuse', 'nothing stored is fine');
ok(vitals(2, 38).bpm > vitals(30, 38).bpm, 'the heart speeds up');
ok(TRAUMA_BEATS.at(-1) >= 9000 && BACKUP_BEATS.at(-1) >= 9000, 'at least nine seconds');

/* ── the real service ── */
{
  const store = { phoneEmergency: {}, phoneEmergencyActive: [] };
  const mk = (id, items, hp = 30) => ({ id, name: id.toUpperCase(), items: { contents: items }, system: { derivedStats: { hp: { value: hp, max: 38 } }, stats: { body: { value: 6 } } }, testUserPermission: (u) => u.id === 'u1', hasPlayerOwner: true });
  const v = mk('v', bio, 30), law = mk('law', [{ type: 'role', name: 'Lawman', system: { rank: 5 } }]);
  const sent = [], chats = [];
  let dice = [];
  globalThis.game = {
    user: { id: 'gm', isGM: true }, scenes: { viewed: { id: 'sc', name: 'Pier 4' } }, combat: null, dice3d: null,
    users: Object.assign([{ id: 'gm', isGM: true, active: true }, { id: 'u1', isGM: false, active: true }], { activeGM: { id: 'gm' }, get: (id) => ({ id }) }),
    actors: { get: (id) => ({ v, law }[id]) },
    settings: { get: (_, k) => { if (k in store) return store[k]; throw new Error('no ' + k); }, set: async (_, k, val) => { store[k] = val; } },
    nightcity: { socketManager: { emit: (op, d) => sent.push(d) }, timeService: { getCurrentTime: () => '2045-03-14T21:47:00.000Z' }, skillService: { _showDice3d: async () => {} }, emergencyHud: { arrival: (s) => sent.push({ shown: s }) } },
  };
  globalThis.foundry = { utils: { randomID: () => 'id' + (sent.length + chats.length + Math.random()) } };
  globalThis.Roll = class { constructor(f) { this.f = f; } async evaluate() { this.total = dice.shift(); return this; } };
  globalThis.ChatMessage = { create: async (d) => chats.push(d), getSpeaker: () => ({}), applyRollMode: () => {} };
  globalThis.Hooks = { on() {}, off() {} };
  const { EmergencyService } = await import('../../../scripts/services/EmergencyService.js');
  const s = new EmergencyService();
  await s.saveConfig(sanitizeEmergency({ trauma: { plans: { v: 'exec' } }, backup: { chars: { law: 'ncpd' } } }));
  ok(s.planFor(v) === 'exec' && s.planFor(law) === 'none', 'the plan reads from settings');
  ok(s.rankOf(law) === 5 && s.orgOf(law) === 'ncpd' && s.defaultGroup(law).r1 === 5, 'rank and organization');
  const info = s.traumaInfo(v);
  dice = [3];
  const rounds = await s.rollTrauma(info);
  ok(rounds === 3 && chats.length === 1 && chats[0].content.includes('ncm-cc') && chats[0].content.includes('Executive'), 'the d6 posts a card in the chat family');
  await s.register(info, rounds);
  ok(s.active().length === 1 && s.planInUse('v') && s.active()[0].left === 3, 'it is on its way, and the plan is in use');
  const id = s.active()[0].id;
  await s.minusRound(id); ok(s.active()[0].left === 2, 'a round passes');
  await s.arrive(id);
  ok(s.active()[0].arrived && sent.some((x) => x.op === 'arrive') && s.planInUse('v'), 'they arrive, and the plan stays in use until the job is over');
  await s.remove(id); ok(!s.planInUse('v'), 'job over');
  chats.length = 0;
  const b = s.backupInfo(law);
  dice = [8];
  const d10 = await s.rollBackupAnswer(b);
  ok(d10 === 8 && chats[0].content.includes('Nobody free') && chats[0].content.includes('ncm-cc--fail'), 'a miss posts its own card');
  dice = [6, 2];
  const res = await s.rollBackupRounds(b, 3);
  ok(res.rounds === 2 && res.up && chats[1].content.includes('Second d6'), 'a 6 rolls again, and says so');
  // the Biomonitor
  sent.length = 0;
  v.system.derivedStats.hp.value = 4;
  await s.onHpChange(v, 30);
  ok(sent.some((x) => x.op === 'auto' && x.userId === 'u1'), 'it rings its owner\'s screen');
  sent.length = 0; store.phoneEmergencyActive = [{ id: 'x', kind: 'trauma', payerId: 'v' }];
  await s.onHpChange(v, 30);
  ok(!sent.some((x) => x.op === 'auto'), 'not while the plan is in use');
  // a forged request
  store.phoneEmergencyActive = [];
  await s.handleSocket({ op: 'add', row: { id: 'r', actorId: 'law' } }, 'u1');
  ok(store.phoneEmergencyActive.length === 1, 'an owner may register');
  game.actors.get = (i) => ({ id: i, testUserPermission: () => false });
  await s.handleSocket({ op: 'add', row: { id: 'r2', actorId: 'zzz' } }, 'someone');
  ok(store.phoneEmergencyActive.length === 1, 'someone else may not');
}

/* ── wiring ── */
const hud = read('scripts/ui/Calls/EmergencyHud.js');
ok(hud.includes('this.hud._callHtml(') && !/ncm-ch-call is-/.test(hud), 'the real call screen, never a copy');
ok(hud.includes('this.still') && hud.includes('prefers-reduced-motion'), 'a still frame when motion is off');
const em = read('styles/components/emergency-call.css');
ok(read('styles/night-city-messenger.css').includes('emergency-call.css') && em.includes('.ncm-r5-layer'), 'the stylesheet is imported');
ok(!/\.mk-/.test(em), 'no page chrome came along');
ok(read('scripts/init/registerCallSystem.js').includes('SOCKET_OPS.CALL_EMERGENCY') && read('scripts/utils/constants.js').includes('CALL_EMERGENCY'), 'the socket is registered');
const set = read('scripts/core/SettingsManager.js');
ok(set.includes("'phoneEmergency'") && set.includes("'phoneEmergencyActive'"), 'the settings exist');

console.log(`test-emergency: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
