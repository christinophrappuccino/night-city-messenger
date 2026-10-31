// Sim: Agent → Calls. The REAL callsTab.js context over a mocked CallService, a REAL Handlebars render of the partial
// (off / picker / main), the pure log rows + speed dial, and the wiring guards (every calls-* action in the template is
// handled, every class the template uses is styled, the viewer has three tabs with Drafts/Scheduled as chips).
//   node dev/tools/sims/test-calls-tab.mjs            (NCM_DUMP=<dir> writes calls-main.html / calls-picker.html)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

// ─── a mocked world ───
const settings = { dateFormat: 'YMD', dateMonthStyle: 'short', timeFormat: '24h' };
let isGM = false;
globalThis.game = {
  user: { get isGM() { return isGM; }, id: 'u1' },
  settings: { get: (_m, k) => settings[k] },
  actors: { get: (id) => (id === 'v' ? { id: 'v', name: 'V', getFlag: () => [
    { name: 'Judy Alvarez', phone: '+1 (555) 555-0142', portrait: 'judy.webp' },
    { name: 'Rogue', phone: '+1 (555) 555-0111' },
    { name: 'No Phone', phone: '' },
  ] } : null) },
  nightcity: {},
};
globalThis.ui = { notifications: { warn() {}, info() {} } };

const LOG = [
  { id: 'c1', direction: 'in', outcome: 'missed', seen: false, gameTime: '2045-08-14T21:10:00.000Z', other: { number: '+1 (555) 555-0142' } },
  { id: 'c2', direction: 'out', outcome: 'answered', seconds: 125, gameTime: '2045-08-14T19:02:00.000Z', other: { number: '+1 (555) 555-0111' }, net: { name: 'CitiNet' } },
  { id: 'c3', direction: 'in', outcome: 'answered', seconds: 40, gameTime: '2045-08-13T09:00:00.000Z', other: { number: '+1 (555) 555-0199', name: 'Secret NPC' } },
  { id: 'c4', direction: 'out', outcome: 'declined', gameTime: '2045-08-13T08:00:00.000Z', other: { number: '+1 (555) 555-0142' } },
];
let lines = [{ number: '+1 (555) 555-0101', actorId: 'v', name: 'V', burner: false }, { number: '+1 (555) 555-0612', actorId: 'v', contactId: 'nix', name: 'Nix', burner: true }];
const svc = {
  enabled: true, homeCode: '+1', region: { country: '1', region: 'Night City', code: '555' },
  linesFor: () => lines, numberOfContact: () => null, lines: () => ({ a: { number: '+1 (555) 555-0199', owner: { name: 'Secret NPC' } } }),
  suggestNumbers: ({ count }) => Array.from({ length: count }, (_, i) => ({ number: `+1 (555) 555-01${20 + i}`, kind: i ? 'random' : 'repeat' })),
  getLog: async () => LOG, _net: () => ({ name: 'CitiNet', type: 'PUBLIC', strength: 80 }), _noSignal: () => false,
  markSeen() {}, assignNumber: async () => ({ ok: true }), placeCall: async () => ({ ok: true }),
  getVoicemails: async () => [{ vmId: 'v1', from: { number: '+1 (555) 555-0142', name: 'Judy' }, to: { actorId: 'v' }, text: 'Call me.', kind: 'tts', heard: false, gameTime: '2045-08-14T21:00:00.000Z' }, { vmId: 'v2', from: { number: '+1 (555) 555-0199', name: 'Secret NPC' }, to: { actorId: 'v', contactId: 'nix' }, text: 'Stop digging.', kind: 'typed', heard: true, gameTime: '2045-08-13T21:00:00.000Z' }],
  lineSettings: () => ({ greeting: { kind: 'tts', text: 'Leave it short.', voice: '' }, voicemail: { on: true, dnd: true } }),
  setVoicemailHeard: async () => ({ ok: true }), deleteVoicemail: async () => ({ ok: true }), saveLineSettings: async () => ({ ok: true }),
};
game.nightcity.callService = svc;

const T = await imp('scripts/ui/MessageViewer/callsTab.js');
const viewer = { actorId: 'v', render() {} };

// ═══ 1. pure rules ═══
const book = T.phoneBook(viewer);
ok(book.length === 2 && !book.some((b) => b.name === 'No Phone'), 'phone book = contacts WITH a number only');
const rows = T.buildLogRows(LOG, { book, home: '+1' });
ok(rows.counts.all === 4 && rows.counts.missed === 1 && rows.counts.unseen === 1 && rows.counts.out === 2, 'counts');
ok(rows.days.length === 2 && rows.days[0].rows.length === 2, 'grouped by day, newest first as given');
const r3 = rows.days[1].rows[0];
ok(r3.other.name === '+1 (555) 555-0199' && !r3.other.known, 'a caller not in your contacts shows the number, never the name');
ok(rows.days[0].rows[0].other.name === 'Judy Alvarez' && rows.days[0].rows[0].unseen, 'a contact shows by name; unseen missed marked');
ok(rows.days[0].rows[1].detail === '2:05' || /2.?0?5/.test(rows.days[0].rows[1].detail), 'talk time printed');
ok(T.buildLogRows(LOG, { book, filter: 'missed' }).total === 1 && T.buildLogRows(LOG, { book, filter: 'out' }).total === 2, 'filters');
const many = Array.from({ length: 60 }, (_, i) => ({ ...LOG[1], id: 'm' + i }));
const pg = T.buildLogRows(many, { book, page: 9 });
ok(pg.pages === 3 && pg.page === 3 && pg.from === 51 && pg.to === 60, 'paging clamps to the last page');
const sd = T.speedDial(LOG, book, '+1');
ok(sd[0].name === 'Judy Alvarez' && sd.every((x) => x.number), 'speed dial: most called first, numbers only');
isGM = true; ok(T.phoneBook(viewer).some((b) => b.name === 'Secret NPC'), 'the GM knows every number'); isGM = false;

// ═══ 2. the context's three faces ═══
const main = await T.buildCallsContext(viewer);
ok(main.main && main.fromNumber === '+1 (555) 555-0101' && main.keypad.length === 12 && main.dialSvg.includes('<svg'), 'main face');
ok(main.list.days.every((d) => d.label && d.rows.every((r) => r.time)), 'day labels + times formatted');
lines = [];
const pick = await T.buildCallsContext({ actorId: 'v', render() {} });
ok(pick.picker && pick.firstTime && pick.suggestions.length === 4 && pick.suggestions[0].on, 'no number → the picker, first suggestion picked');
ok(pick.codes.some((c) => c.on) && pick.countries.some((c) => c.on), 'region selects + codes carry the current pick');
lines = [{ number: '+1 (555) 555-0101', actorId: 'v', name: 'V', burner: false }];
svc.enabled = false; const off = await T.buildCallsContext(viewer); svc.enabled = true;
ok(off.off && /switched off/.test(off.reason), 'off face says why');

// ═══ 3. a REAL Handlebars render ═══
const tpl = read('templates/message-viewer/partials/calls-tab.hbs');
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { try { Handlebars = createRequire(import.meta.url)('handlebars'); } catch { /* none */ } }
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars — render checks did not run'); }
else {
  Handlebars.registerHelper('eq', (a, b) => String(a) === String(b));
  Handlebars.registerHelper('gt', (a, b) => Number(a) > Number(b));
  Handlebars.registerHelper('or', (...a) => a.slice(0, -1).some(Boolean));
  const render = Handlebars.compile(tpl);
  const mainHtml = render(main), pickHtml = render(pick), offHtml = render(off);
  ok(mainHtml.includes('data-calls-num') && (mainHtml.match(/data-calls-key=/g) || []).length === 12, 'main: number box + 12 keys');
  ok(mainHtml.includes('Judy Alvarez') && mainHtml.includes('+1 (555) 555-0199') && !mainHtml.includes('Secret NPC'), 'main: names only for contacts');
  ok(mainHtml.includes('ncm-calls-sdp') && mainHtml.includes('is-miss') && mainHtml.includes('>New<'), 'main: speed dial, missed row, New tag');
  ok(pickHtml.includes('Pick your number') && (pickHtml.match(/ncm-calls-opt/g) || []).length >= 4 && !pickHtml.includes('data-action="calls-back"'), 'picker: first time, no Cancel');
  ok(offHtml.includes('No calls here') && offHtml.includes('switched off'), 'off render');
  ok(!/NaN|undefined|\[object Object\]/.test(mainHtml + pickHtml + offHtml), 'nothing prints NaN / undefined');
  // the viewer template still compiles with three tabs
  Handlebars.compile(read('templates/message-viewer/message-viewer.hbs'));
  ok(true, 'message-viewer.hbs compiles');
  if (process.env.NCM_DUMP) {
    fs.writeFileSync(path.join(process.env.NCM_DUMP, 'calls-main.html'), mainHtml);
    fs.writeFileSync(path.join(process.env.NCM_DUMP, 'calls-picker.html'), pickHtml);
    fs.writeFileSync(path.join(process.env.NCM_DUMP, 'calls-off.html'), offHtml);
  }
}

// ═══ 4. wiring guards ═══
const js = read('scripts/ui/MessageViewer/callsTab.js');
const vhbs = read('templates/message-viewer/message-viewer.hbs');
const acts = new Set([...(tpl + vhbs).matchAll(/data-action="(calls-[a-z-]+)"/g)].map((m) => m[1]));
for (const a of acts) ok(js.includes(`case '${a}'`), `action ${a} is handled`);
const css = read('styles/components/calls-tab.css');
const classes = new Set([...tpl.matchAll(/class="([^"{]+)/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('ncm-calls')));
for (const c of classes) ok(css.includes('.' + c), `class .${c} is styled`);
ok(read('styles/night-city-messenger.css').includes("components/calls-tab.css"), 'stylesheet imported');
ok(!/data-tab="scheduled"|data-tab="drafts"/.test(vhbs) && vhbs.includes('data-tab="calls"'), 'three tabs: Messages · Calls · Shards');
ok(vhbs.includes('data-filter="drafts"') && vhbs.includes('data-filter="scheduled"') && vhbs.includes('ncm-pill--out'), 'Drafts + Scheduled are chips in Messages');
ok(read('scripts/utils/constants.js').includes('VIEWER_CALLS'), 'partial is in TEMPLATES (preloaded)');
ok(/calls-tab\.css/.test(read('styles/night-city-messenger.css')), 'css imported');

// ═══ 5. Call buttons on contacts + message senders ═══
const { CallService } = await imp('scripts/services/CallService.js');
const cs = Object.create(CallService.prototype);
cs.lines = () => ({ a: { number: '+1 555 555 0150', owner: { contactId: 'm1', name: 'Rogue' } }, b: { number: '+1 555 555 0160', owner: { actorId: 'judy', name: 'Judy' } } });
game.nightcity.masterContactService = { isSendOnly: (e) => e === 'system@localhost', getContact: () => null };
ok(cs.numberForContact({ phone: '+1 555 555 0101' }) === '+1 555 555 0101', 'a contact with its own phone');
ok(cs.numberForContact({ masterContactId: 'm1' }) === '+1 555 555 0150', 'a copy of a directory entry rings its line');
ok(cs.numberForContact({ actorId: 'judy' }) === '+1 555 555 0160', 'a linked character rings its line');
ok(cs.numberForContact({ email: 'system@localhost', phone: '1' }) === '' && cs.numberForContact({ sendOnly: true, phone: '1' }) === '', 'never a send-only address');
ok(cs.numberForContact({ name: 'nobody' }) === '' && cs.numberForContact(null) === '', 'no number → no button');
const cm = read('scripts/ui/ContactManager/ContactManagerApp.js');
ok(/callContact:\s+ContactManagerApp\._onCallContact/.test(cm) && cm.includes('_callNumber = calls?.enabled'), 'Contact Manager: action + per-contact number');
for (const p of ['contact-card', 'contact-detail', 'contact-list-item']) ok(/\{\{#if _callNumber\}\}[\s\S]*?data-action="callContact"/.test(read(`templates/contact-manager/partials/${p}.hbs`)), `${p}: Call only with a number`);
const md = read('templates/message-viewer/partials/message-detail.hbs'); const mv = read('scripts/ui/MessageViewer/MessageViewerApp.js');
ok(md.includes('data-action="call-sender"') && mv.includes("case 'call-sender'") && /!isAnonMasked && !senderSendOnly && !msg\.status\?\.sent/.test(mv), 'message sender: Call, never masked / system / own sent copy');

// ═══ 6. Theme Customizer → Calls ═══
const tc = read('templates/theme-customizer/theme-customizer.hbs'); const tcj = read('scripts/ui/ThemeCustomizer/ThemeCustomizerApp.js');
ok(tc.includes('{{#if calls}}') && tc.includes('data-call-scheme') && tc.includes('data-call-color="ring"') && tc.includes('data-call-silent'), 'Theme Customizer: schemes, custom colours, silent');
ok(tcj.includes('calls: this._callsContext()') && /'callScheme'/.test(tcj) && /'callSilent'/.test(tcj) && tcj.includes('callHud?.render'), 'saved to the client settings + the HUD repaints');
ok(['ncm', '2077', 'theme', 'custom'].every((k) => tcj.includes(`key: '${k}'`)) && read('scripts/ui/Calls/CallHud.js').includes("s.scheme === '2077'"), 'the four schemes match the HUD');

// ═══ 7. Phase 2 — the transcript drawer in the player's own log ═══
{
  const typed = [
    { ...LOG[1], id: 'k1', direction: 'out', lines: [{ side: 'caller', name: 'V', text: 'On my way.' }, { side: 'callee', name: 'Rogue', text: 'Pier 4.' }] },
    { ...LOG[2], id: 'k2', direction: 'in', lines: [{ side: 'caller', name: 'Secret NPC', text: 'Stop asking questions.' }, { side: 'callee', name: 'V', text: 'Who is this?' }] },
  ];
  const rows = T.buildLogRows(typed, { book, home: '+1' }).days.flatMap((d) => d.rows);
  const out = rows.find((r) => r.id === 'k1'), inc = rows.find((r) => r.id === 'k2');
  ok(out.transcript[0].who === 'You' && out.transcript[0].mine && out.transcript[1].who === 'Rogue', 'an outgoing call: my lines are "You", theirs by the contact name');
  ok(inc.transcript[0].who === '+1 (555) 555-0199' && inc.transcript[1].who === 'You', 'an unknown caller stays a number in the transcript too — never the stored name');
  ok(!JSON.stringify(inc.transcript).includes('Secret NPC'), 'the hidden name is not in the view at all');
  if (Handlebars) {
    const html = Handlebars.compile(tpl)({ ...main, list: { ...main.list, days: [{ day: 'x', label: 'Today', rows: [out] }] } });
    ok(html.includes('ncm-calls-tr') && html.includes('On my way.') && html.includes('class="l mine"'), 'render: the transcript fold');
  }
  ok(read('styles/components/calls-tab.css').includes('.ncm-calls-tr'), '.ncm-calls-tr styled');
}

// ═══ 8. Phase 3a — the Voicemail list, My line, the badge ═══
{
  if (!lines.some((l) => l.contactId === 'nix')) lines = [...lines, { number: '+1 (555) 555-0612', actorId: 'v', contactId: 'nix', name: 'Nix', burner: true }];
  const vmView = await (async () => { T.callsState(viewer).filter = 'vm'; const c = await T.buildCallsContext(viewer); T.callsState(viewer).filter = 'all'; return c; })();
  ok(vmView.vmView && vmView.vm.rows.length === 2 && vmView.vm.unheard === 1, 'the Voicemail pill: every message, the unheard count');
  const r1 = vmView.vm.rows.find((r) => r.vmId === 'v1'), r2 = vmView.vm.rows.find((r) => r.vmId === 'v2');
  ok(r1.who === 'Judy Alvarez' && r1.tts && r2.who === '+1 (555) 555-0199' && !r2.known, 'names by the contacts rule (a stranger is a number)');
  ok(r2.forLine === 'Nix', 'a message left on a burner says which line');
  ok(await T.missedCount(viewer) === 1 + 1, 'the tab badge: unseen missed calls + unheard voicemail');
  T.callsState(viewer).view = 'myline';
  const ml = await T.buildCallsContext(viewer);
  T.callsState(viewer).view = 'main';
  ok(ml.myline && ml.myline.kinds.length === 4 && ml.myline.kinds.find((k) => k.on).k === 'tts' && ml.myline.text === 'Leave it short.' && ml.myline.dnd === true, 'My line: the number\'s own greeting and switches');
  if (Handlebars) {
    const render = Handlebars.compile(tpl);
    const vh = render(vmView);
    ok(vh.includes('ncm-calls-vm is-new') && vh.includes('data-action="calls-vm-play"') && vh.includes('for Nix') && !vh.includes('data-calls-num'.repeat(2)), 'render: the voicemail list');
    const mh = render(ml);
    ok(mh.includes('My line') && mh.includes('data-calls-mlk="tts"') && mh.includes('data-calls-ml-dnd checked') && mh.includes('data-action="calls-ml-save"'), 'render: My line');
    ok(render(main).includes('data-action="calls-myline"'), 'the My line button beside Call as');
    if (process.env.NCM_DUMP) { fs.writeFileSync(path.join(process.env.NCM_DUMP, 'calls-vm.html'), vh); fs.writeFileSync(path.join(process.env.NCM_DUMP, 'calls-myline.html'), mh); }
  }
  const vhbs = read('templates/message-viewer/message-viewer.hbs');
  ok(vhbs.includes('data-f="vm"') && vhbs.includes('calls.vm.unheard'), 'the Voicemail pill in the Calls row');
}

console.log(`test-calls-tab: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
