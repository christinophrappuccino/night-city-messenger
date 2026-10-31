// Sim: Admin → Phone. The pure rules (phoneModel.js), the REAL PhoneTab over a mocked world + a REAL Handlebars render
// of every view, and the wiring (tab bar, partial, TEMPLATES, css import, every op in the template handled, every
// ncm-ph2 class styled, Call as on Admin Contacts).
//   node dev/tools/sims/test-admin-phone.mjs        (NCM_DUMP=<dir> writes phone-<view>.html)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const M = await import('../../../scripts/ui/AdminPanel/tabs/phoneModel.js');

// ═══ 1. pure rules ═══
const now = 1_000_000;
const calls = [
  { id: 'r1', state: 'ringing', startedAt: now - 10000, from: { name: 'V', number: '+1 555 0101' }, to: { kind: 'npc', name: 'Rogue', contactId: 'rogue', number: '+1 555 0150' }, net: { name: 'CitiNet' } },
  { id: 'l1', state: 'live', startedAt: now - 90000, answeredAt: now - 65000, mode: 'type', from: { name: 'V' }, to: { kind: 'player', name: 'Judy' } },
  { id: 'h1', state: 'held', startedAt: now - 9000, answeredAt: now - 8000, mode: 'loud', from: { name: 'Rache' }, to: { kind: 'player', name: 'Judy' } },
  { id: 'e1', state: 'ended', startedAt: 1, from: {}, to: {} },
];
const live = M.liveBoard(calls, { now, ringMs: 30000, ringsForMe: (c) => c.id === 'r1', roleOf: () => 'watch', voiceOf: () => 'Clipped. Calls everyone kid.' });
ok(live.ringing.length === 1 && live.ringing[0].voice && live.ringing[0].left === 20 && live.ringing[0].pct === 33, 'ringing for you: voice, seconds left, clock');
ok(live.lines.length === 2 && live.lines[0].id === 'l1' && live.lines[0].timer === '1:05', 'switchboard: live first, timer, ended left out');
ok(live.modes.type === 1 && live.modes.loud === 1 && !live.quiet, 'mode tallies');
ok(M.liveBoard([], {}).quiet, 'quiet board');

const lines = {
  '+15550101': { number: '+1 555 0101', owner: { actorId: 'v', name: 'V', kind: 'player' } },
  '+15550612': { number: '+1 555 0612', owner: { actorId: 'v', contactId: 'nix', name: 'Nix', kind: 'player' } },
  '+15550150': { number: '+1 555 0150', owner: { contactId: 'rogue', name: 'Rogue', kind: 'npc' } },
  '+15550999': { number: '+1 555 0999', owner: { contactId: 'gone', name: 'Ghost', kind: 'npc' } },
};
const pcs = [{ actorId: 'v', actorName: 'V', playerName: 'Kiri' }, { actorId: 'jackie', actorName: 'Jackie', playerName: 'Sam' }];
const contacts = [{ id: 'rogue', name: 'Rogue', voice: 'Clipped. Calls everyone kid.' }, { id: 'queen', name: 'Queen of Hearts', identityOf: 'rogue', phone: '+1 555 0342' }, { id: 'nix', name: 'Nix', actorId: 'v' },
  { id: 'sys', name: 'System', sendOnly: true, phone: '1' }, { id: 'quiet', name: 'No Phone' }];
const ng = M.numberGroups({ lines, pcs, contacts });
const g = Object.fromEntries(ng.groups.map((x) => [x.key, x]));
ok(g.players.rows.map((r) => r.name).join(',') === 'V,Nix,Jackie' && g.players.rows[1].kind === 'burner' && g.players.rows[2].kind === 'none', 'players: main, burner under it, no number');
ok(g.npcs.rows.some((r) => r.name === 'Queen of Hearts' && r.alias && r.fromDirectory) && !g.npcs.rows.some((r) => r.name === 'System' || r.name === 'No Phone'), 'NPCs: lines + directory phones; never send-only or numberless');
ok(g.unowned?.rows.length === 1 && g.unowned.rows[0].kind === 'orphan', 'a line whose owner is gone');
ok(ng.noNumber === 1 && !g.players.shut && g.npcs.shut, 'counts + default folds (first open)');
ok(M.numberGroups({ lines, pcs, contacts, q: 'queen' }).groups.every((x) => !x.shut) && M.numberGroups({ lines, pcs, contacts, q: 'queen' }).shown === 1, 'a search opens and narrows');
ok(M.numberGroups({ lines, pcs, contacts, show: 'none' }).shown === 1 && M.numberGroups({ lines, pcs, contacts, show: 'burner' }).shown === 1, 'Show filters');
ok(!M.numberGroups({ lines, pcs, contacts, shut: new Set(['players']) }).groups[0].shut === false, 'the GM fold wins');

const logs = [
  { callId: 'a', outcome: 'answered', seconds: 125, gameTime: '2045-08-14T20:15:00Z', from: { name: 'V' }, to: { name: 'Judy' }, net: { name: 'CitiNet' } },
  { callId: 'b', outcome: 'missed', gameTime: '2045-08-14T19:00:00Z', from: { name: 'Rache' }, to: { name: 'Queen' } },
  { callId: 'c', outcome: 'dropped', gameTime: '2045-08-13T10:00:00Z', from: { name: 'Jackie' }, to: { name: 'Delamain' } },
];
const lv = M.logView(logs, { fmtTime: () => '20:15' });
ok(lv.days.length === 2 && lv.days[0].rows[0].detail === '2:05' && lv.days[0].bad === 1 && lv.days[1].bad === 1, 'log: by day, talk time, bad counts');
ok(lv.counts.missed === 1 && M.logView(logs, { filter: 'dropped' }).total === 1 && M.logView(logs, { q: 'delamain' }).total === 1, 'log filters + search');
ok(M.logView(Array.from({ length: 90 }, (_, i) => ({ ...logs[0], callId: 'x' + i })), { page: 9 }).page === 3, 'paging clamps');
const sv = M.settingsView({ callsEnabled: true, callModes: ['loud', 'type'], callDefaultMode: 'type', callHomeCode: '+44', callRingSeconds: 20, callUnknownNumbers: 'gm' });
ok(sv.modes.filter((m) => m.on).length === 2 && sv.startModes.length === 2 && sv.startModes.find((m) => m.on).key === 'type' && sv.unknown.find((u) => u.on).key === 'gm', 'settings rows');

// ═══ 2. the REAL tab over a mocked world ═══
const settings = { callsEnabled: true, callModes: ['loud', 'type', 'dictate'], callDefaultMode: 'loud', callHomeCode: '+1', callRingSeconds: 30, callUnknownNumbers: 'not-in-service',
  dateFormat: 'YMD', dateMonthStyle: 'short', timeFormat: '24h' };
const users = [{ id: 'u1', isGM: false, name: 'Kiri', character: null }];
const actorV = { id: 'v', name: 'V', img: 'v.webp', hasPlayerOwner: true, type: 'character', testUserPermission: () => true };
const actorJ = { id: 'jackie', name: 'Jackie', img: '', hasPlayerOwner: true, type: 'character', testUserPermission: () => true };
globalThis.game = {
  user: { isGM: true, id: 'gm' }, users, actors: [actorV, actorJ], journal: [],
  settings: { get: (_m, k) => settings[k], set: async (_m, k, v) => { settings[k] = v; } },
  nightcity: {
    masterContactService: { getAll: () => contacts, getContact: (id) => contacts.find((c) => c.id === id) },
    callService: {
      enabled: true, ringMs: 30000, homeCode: '+1',
      allCalls: () => calls.filter((c) => c.state !== 'ended'), _ringsHere: (c) => c.id === 'r1', _role: () => 'watch',
      lines: () => lines, allLogs: () => logs, numberOf: (id) => (id === 'v' ? '+1 555 0101' : ''), numberOfContact: (id) => (id === 'rogue' ? '+1 555 0150' : ''),
    },
  },
};
globalThis.Hooks = { on: () => 1, off: () => {} };
const { PhoneTab } = await import('../../../scripts/ui/AdminPanel/tabs/PhoneTab.js');
const app = { _activeTab: 'phone', isPopout: false, render() {}, element: null };
const tab = new PhoneTab(app);
const ctxs = {};
for (const v of ['live', 'numbers', 'log', 'settings']) { tab._view = v; ctxs[v] = tab.prepareContext().phone2; }
ok(ctxs.live.live.ringing.length === 1 && ctxs.live.nav.find((n) => n.key === 'live').hot, 'tab: live + a hot nav count');
ok(ctxs.numbers.numbers.groups.length === 3 && ctxs.numbers.numbers.show.length === 4, 'tab: numbers');
ok(ctxs.log.log.days.length === 2 && ctxs.log.log.filters.length === 5, 'tab: log');
ok(ctxs.settings.settings.enabled && !ctxs.live.error && !ctxs.numbers.error && !ctxs.log.error, 'tab: settings, no errors');
app._activeTab = 'messages'; ok(tab.prepareContext().phone2 === null, 'built only while the tab is open'); app._activeTab = 'phone';
tab.openTo('numbers'); ok(tab._view === 'numbers', 'openTo picks a view'); tab.openTo('nope'); ok(tab._view === 'numbers', 'openTo ignores junk');

// ═══ 3. a REAL Handlebars render ═══
const tpl = read('templates/admin-panel/tab-phone.hbs');
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars — render checks did not run'); }
else {
  Handlebars.registerHelper('eq', (a, b) => String(a) === String(b));
  Handlebars.registerHelper('gt', (a, b) => Number(a) > Number(b));
  Handlebars.registerHelper('or', (...a) => a.slice(0, -1).some(Boolean));
  Handlebars.registerHelper('join', (arr, sep) => (Array.isArray(arr) ? arr.join(typeof sep === 'string' ? sep : ', ') : ''));
  const render = Handlebars.compile(tpl);
  const html = Object.fromEntries(Object.entries(ctxs).map(([v, c]) => [v, render({ activeTab: 'phone', phone2: c })]));
  ok(html.live.includes('Answer as Rogue') && html.live.includes('Clipped') && html.live.includes('data-ph-since') && html.live.includes('data-op="drop"'), 'live render');
  ok(html.numbers.includes('Give one') && html.numbers.includes('burner') && html.numbers.includes('no longer exists') && html.numbers.includes('is-shut'), 'numbers render');
  ok(html.log.includes('Judy') && html.log.includes('2:05') && html.log.includes('1 missed or dropped'), 'log render');
  ok(html.settings.includes('data-ph-set="callModes"') && html.settings.includes('value="+1"'), 'settings render');
  ok(!/NaN|undefined|\[object Object\]/.test(Object.values(html).join('')), 'nothing prints NaN / undefined');
  if (process.env.NCM_DUMP) for (const [v, h] of Object.entries(html)) fs.writeFileSync(path.join(process.env.NCM_DUMP, `phone-${v}.html`), h);
}

// ═══ 4. wiring ═══
const js = read('scripts/ui/AdminPanel/tabs/PhoneTab.js');
for (const op of new Set([...tpl.matchAll(/data-op="([a-zA-Z]+)"/g)].map((m) => m[1]))) ok(js.includes(`case '${op}'`), `op ${op} handled`);
const css = read('styles/components/admin-panel/tab-phone.css');
const classes = new Set([...tpl.matchAll(/class="([^"{]+)/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('ncm-ph2')));
for (const c of classes) ok(css.includes('.' + c), `.${c} styled`);
ok(!/#[0-9a-f]{3,8}\b/i.test(css), 'tokens only');
const panel = read('templates/admin-panel/admin-panel.hbs');
ok(/data-tab-group="comms"[\s\S]*?data-tab="phone"[\s\S]*?data-tab-group="net"/.test(panel) && panel.includes('tab-phone.hbs'), 'Phone sits in COMMS + its partial');
ok(read('scripts/utils/constants.js').includes('ADMIN_TAB_PHONE') && read('styles/components/admin-panel.css').includes('tab-phone.css'), 'TEMPLATES + css import');
const ap = read('scripts/ui/AdminPanel/AdminPanelApp.js');
ok(ap.includes('phone: new PhoneTab(this)') && ap.includes('...this.tabs.phone.prepareContext()') && ap.includes('EVENTS.CALL_RINGING'), 'panel: tab, context spread, live re-render');
ok(read('templates/admin-panel/tab-contacts.hbs').includes('data-op="callAs"') && read('scripts/ui/AdminPanel/tabs/ContactsTab.js').includes("case 'callAs'"), 'Call as on Admin Contacts');
const cs = read('scripts/services/CallService.js');
ok(cs.includes('allCalls()') && cs.includes('allLogs()') && cs.includes('noSignal: !isGM() && this._noSignal()'), 'service: GM readers; an NPC caller ignores the GM\'s own signal');

// ═══ 5. Phase 2 — Listen in, transcripts, the notice ═══
{
  const typedCall = { ...calls[1], id: 't1', lines: [{ id: 'a', side: 'caller', text: 'Evelyn is gone.' }, { id: 'b', side: 'callee', text: 'Jig-Jig Street.' }] };
  const lb = M.liveBoard([typedCall], { now, listening: new Set(['t1']) });
  ok(lb.lines[0].listening && lb.lines[0].lineCount === 2 && lb.lines[0].heard[0].name === 'V' && lb.lines[0].heard[1].name === 'Judy', 'Listen in: the switchboard row carries the lines, named');
  const lv2 = M.logView([{ ...logs[0], lines: [{ side: 'caller', name: 'V', text: 'Pier 4 at midnight' }] }]);
  ok(lv2.days[0].rows[0].transcript.length === 1 && M.logView([{ ...logs[0], lines: [{ side: 'caller', name: 'V', text: 'Pier 4 at midnight' }] }], { q: 'pier 4' }).total === 1, 'the log row carries its transcript, and search reads it');
  ok(M.settingsView({ callTranscriptNotice: false }).notice === false && M.settingsView({}).notice === true, 'the notice setting row (on by default)');
  ok(M.settingsView({ callModes: ['loud', 'type', 'dictate'] }, { modesAvailable: ['loud', 'type'] }).modes.length === 2, 'the settings card offers only the built modes');
  if (Handlebars) {
    const render = Handlebars.compile(tpl);
    const html = render({ activeTab: 'phone', phone2: { ...ctxs.live, live: lb } });
    ok(html.includes('data-op="listen"') && html.includes('Listening') && html.includes('Evelyn is gone.') && html.includes('only you see this'), 'render: Listen + the heard lines');
    const lh = render({ activeTab: 'phone', phone2: { ...ctxs.log, log: { ...ctxs.log.log, days: lv2.days } } });
    ok(lh.includes('ncm-ph2-tr') && lh.includes('Transcript · 1 line') && lh.includes('Pier 4 at midnight'), 'render: the transcript fold in the log');
    const sh = render({ activeTab: 'phone', phone2: ctxs.settings });
    ok(sh.includes('data-ph-set="callTranscriptNotice"'), 'render: the notice switch');
  }
  ok(js.includes("case 'listen'") && js.includes("'callTranscriptNotice'"), 'the tab handles Listen and saves the notice');
  ok(read('scripts/ui/AdminPanel/AdminPanelApp.js').includes('EVENTS.CALL_LINE, EVENTS.VOICEMAIL_LEFT, EVENTS.CALL_LOGGED]'), 'the Phone tab follows new lines live');
  for (const c of ['ncm-ph2-listen', 'ncm-ph2-tr', 'ncm-ph2-btn--on']) ok(css.includes('.' + c), `.${c} styled`);
}

// ═══ 6. Phase 3a — Voicemail boxes, the greeting button ═══
{
  const vms = [
    { vmId: 'a', ownerId: 'rogue', ownerIsContact: true, from: { name: 'V', number: '+1 555 0101', actorId: 'v' }, to: { contactId: 'rogue', name: 'Rogue' }, text: 'Pier 4 job — call me.', kind: 'typed', heard: false, gameTime: '2045-08-14T22:41:00Z' },
    { vmId: 'b', ownerId: 'rogue', ownerIsContact: true, from: { name: 'Rache', number: '+1 555 0118' }, to: { contactId: 'queen', name: 'Queen of Hearts' }, text: 'You owe me.', kind: 'tts', heard: true },
    { vmId: 'c', ownerId: 'v', ownerIsContact: false, from: { name: 'Judy' }, to: { actorId: 'v', name: 'V' }, text: 'Evelyn is gone.', kind: 'typed', heard: false },
  ];
  const vb = M.voicemailBoxes(vms, { ownerName: (v) => (v.ownerIsContact ? 'Rogue' : 'V'), isNpc: (v) => v.ownerIsContact, fmt: () => '22:41' });
  ok(vb.boxes.map((b) => b.ownerId).join() === 'rogue,v' && vb.boxes[0].unheard === 1 && vb.npcUnheard === 1, 'boxes: NPCs first, unheard counted; the nav counts only NPC messages');
  ok(!vb.boxes[0].shut && vb.boxes[1].shut, 'folds: the first box open');
  ok(vb.boxes[0].rows[1].toName === 'Queen of Hearts' && vb.boxes[0].rows[1].tts, 'a message left for an alias says which identity, and that it is read out');
  if (Handlebars) {
    const html = Handlebars.compile(tpl)({ activeTab: 'phone', phone2: { view: 'vm', enabled: true, nav: [], vm: vb } });
    ok(html.includes('data-op="vmCallBack"') && html.includes('data-op="vmReply"') && html.includes('data-owner-id="rogue"') && html.includes('Pier 4 job'), 'render: the Voicemail view');
    ok(!/data-owner="rogue"/.test(html), 'the owner id never reuses data-owner (that is the tab routing key)');
    if (process.env.NCM_DUMP) fs.writeFileSync(path.join(process.env.NCM_DUMP, 'phone-vm.html'), html);
  }
  ok(js.includes("case 'greeting'") && tpl.includes('data-op="greeting"') && js.includes('saveLineSettings(number, out)'), 'Numbers: the greeting & voicemail button');
  ok(/setVoicemailHeard\(d\.ownerId/.test(js) && /deleteVoicemail\(d\.ownerId/.test(js), 'the handlers read the owner id');
}

console.log(`test-admin-phone: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
