// Sim: Admin → Contacts → Directory → an NPC → "Who's writing to them" — the SWITCHBOARD.
// Mock: dev/mockups/admin-npc-orbit-mock.html (version C).
// Drives the pure rules (contactsModel.npcSwitchboard), the REAL ContactsTab._mail +
// _switchboardContext over a mocked world, the ops, and renders the REAL template
// snippet (between the sb:start / sb:end markers) through Foundry's Handlebars.
//   Run: node dev/tools/sims/test-npc-switchboard.mjs        (NCM_DUMP=<dir> writes a headless harness)
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
const read = (f) => readFileSync(`${ROOT}/${f}`, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const M = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/contactsModel.js`).href);

// ═══ 1. Pure rules ═══
const D = 86400000, NOW = Date.UTC(2077, 0, 20, 12);
const ids = [{ id: 'r', name: 'Rogue Amendiares' }, { id: 'q', name: 'Queen of Hearts' }];
const row = (key, name, d, sent, ident, extra = {}) => ({ ts: NOW - d * D, sent, ident, key, name, isPc: ['v', 'judy', 'rache'].includes(key), subject: `${name} ${d}`, journalId: 'j', pageId: `p-${key}-${d}`, ...extra });
const rows = [
  row('v', 'V', 0.5, false, 'r'), row('v', 'V', 1, false, 'r'), row('v', 'V', 2, true, 'r'), row('v', 'V', 6, true, 'q'), row('v', 'V', 9, false, 'q'),
  row('judy', 'Judy', 9, false, 'q'), row('judy', 'Judy', 12, true, 'r'),
  row('rache', 'Rache', 5, true, 'q'), row('rache', 'Rache', 7, false, 'q'),
  row('e:dex@x', 'Dexter', 2, false, 'r'), row('e:dex@x', 'Dexter', 3, true, 'r'),
  row('e:spam@x', 'Junk', 1, false, 'r', { spam: true }),
];
const knowers = [{ key: 'panam', name: 'Panam', actorId: 'panam', isPc: true }, { key: 'v', name: 'V', actorId: 'v', isPc: true }];
const sb = M.npcSwitchboard({ identities: ids, rows, knowers, now: NOW, sel: null });
const P = Object.fromEntries(sb.people.map((p) => [p.key, p]));
ok(!P['e:spam@x'], 'spam never reaches the switchboard');
ok(sb.people.length === 5 && P.panam?.never && P.panam.count === 0, 'knowers who never wrote sit on the rim; a knower who wrote is one dot');
ok(P.v.waiting === 2 && P.judy.waiting === 1 && P.rache.waiting === 0 && P['e:dex@x'].waiting === 1, 'waiting = mail in newer than the last mail out');
ok(P.v.arrow.theirs && !P.rache.arrow.theirs && !P.panam.arrow, 'arrow: they wrote last (theirs) / answered (yours) / none when never written');
ok(!('queue' in sb) && sb.firstWaiting === 'judy' && sb.waitingPeople === 3 && sb.waitingTotal === 4, 'no reply queue: the longest wait is the default pick, totals kept');
ok(P.judy.waitMsgs[0].ident === 'q', 'the waiting mail remembers the identity it reached (alias)');
ok(P.v.waitMsgs[0].ident === 'r' && P.v.waitMsgs[0].pageId === 'p-v-0.5', 'a reply answers the NEWEST unanswered message, as the identity it reached');
ok(P.judy.waitLabel === '9d' && M.sbAge(30 * 60 * 1000) === '<1h' && M.sbAge(5 * 3600000) === '5h' && M.sbAge(20 * D) === '3w', 'wait labels');
const rad = (k) => P[k].radius;
ok(rad('judy') < sb.oweR && rad('v') < sb.oweR && rad('e:dex@x') < sb.oweR, 'everyone waiting sits inside the "your turn" ring');
ok(rad('judy') < rad('e:dex@x'), 'the longer the wait, the closer to the hub');
ok(rad('rache') > sb.oweR && rad('panam') === sb.neverR, 'answered people sit out in the even band; never-written on the rim');
ok(sb.people.every((p) => Math.hypot(p.x, p.y) <= sb.half - 10), 'every dot fits the dial');
ok(sb.people.filter((p) => p.label).every((p) => Math.abs(p.label.x) < sb.half && Math.abs(p.label.y) < sb.half), 'labels stay on the dial');
const top = (p) => { const a = ((p.angle % 360) + 360) % 360; return a >= 245 && a <= 295; };
ok(!sb.people.some(top), 'no dot in the top gap the ring labels use');
// wedges
ok(sb.wedges.length === 2 && sb.wedges[0].id === 'r' && !sb.wedges[0].isAlias && sb.wedges[1].isAlias, 'one wedge per identity, main first');
ok(Math.abs((sb.wedges[0].a0 + sb.wedges[0].a1) / 2 - 180) < 0.01, 'the main identity is centred on the left');
ok(Math.abs(sb.wedges.reduce((n, w) => n + (w.a1 - w.a0), 0) - 360) < 0.05, 'wedges make one full turn');
const w0 = M.sbWedges([{ id: 'a' }, { id: 'b' }], { a: 99, b: 1 });
ok(w0[1].a1 - w0[1].a0 >= 39.9 && w0[1].a1 - w0[1].a0 < 41 && Math.abs(w0[0].a1 - w0[0].a0 - 320) < 0.1, 'a quiet alias keeps a readable minimum wedge');
ok(/A 40 40 0 1 1/.test(M.sbAnnulus(22, 40, 0, 360)), 'a single identity draws a full ring');
// lines plug into the wedge written to
const vLinks = P.v.links.map((l) => l.tone);
ok(vLinks.length === 2 && vLinks.includes('owe') && vLinks.includes('alias'), 'V has two lines: owed on the main, plain violet on the alias');
ok(P.judy.links.length === 2 && P.judy.links.some((l) => l.tone === 'owe') && P.judy.links.some((l) => l.tone === 'main'), 'Judy: owed on the alias she wrote to, plain on the main');
ok(P.panam.links.length === 0, 'never written = no line');
// filter by identity
const sq = M.npcSwitchboard({ identities: ids, rows, knowers, now: NOW, ident: 'q' });
const SQ = Object.fromEntries(sq.people.map((p) => [p.key, p]));
ok(SQ['e:dex@x'].dim && !SQ.judy.dim && !SQ.v.dim, 'identity filter dims people who never wrote to it');
ok(sq.firstWaiting === 'judy' && sq.waitingPeople === 1, 'filtered: only mail waiting on that identity counts');
ok(sq.people.every((p) => p.links.every((l) => l.tone !== 'main')), 'filtered: only that identity’s lines');
ok(sq.wedges.find((w) => w.id === 'r').dim && sq.wedges.find((w) => w.id === 'q').on, 'the picked wedge is lit, the other dims');
// colour rules
ok(P.judy.mix < P.v.mix && P.rache.mix === 100, 'waiting pulls the dot toward amber, longer = more');
ok(P.rache.bright === 1 && P.panam.bright === 0.55, 'recency is brightness');
ok(M.npcSwitchboard({ identities: ids, rows: [], knowers: [] }).empty, 'empty is fine');
{ const jr = rows.map((r) => ({ ...r, messageId: r.pageId }));
  const a = M.npcSwitchboard({ identities: ids, rows: jr, knowers, now: NOW, answered: { 'p-judy-9': '2077-01-20T00:00:00Z', 'p-v-0.5': 'x' } });
  const A = Object.fromEntries(a.people.map((p) => [p.key, p]));
  ok(A.judy.waiting === 0 && A.judy.radius > a.oweR && a.firstWaiting !== 'judy', 'a GM ✓ (npcMailAnswered) answers it: no longer waiting, back out past the your-turn ring');
  ok(A.v.waiting === 1 && A.v.waitMsgs[0].pageId === 'p-v-1', 'ticking one of two leaves the other waiting');
  const s2 = M.npcSwitchboard({ identities: ids, rows: jr.map((r) => r.key === 'judy' ? { ...r, messageId: r.messageId + '-sent' } : r), knowers, now: NOW, answered: { 'p-judy-9': 'x' } });
  ok(s2.people.find((p) => p.key === 'judy').waiting === 0, 'matched by base id (-sent stripped), the Needs a reply rule'); }
ok(M.npcSwitchboard({ identities: ids, rows, knowers, now: NOW, sel: 'judy' }).pick.key === 'judy', 'the picked correspondent comes back');

// ═══ 2. The REAL ContactsTab over a mocked world ═══
const flags = new Map();
const mkActor = (id, name, player, role = '') => { flags.set(id, { contacts: [] }); return { id, name, type: 'character', hasPlayerOwner: player, img: '', items: role ? [{ type: 'role', name: role }] : [], getFlag: (m, k) => flags.get(id)[k], testUserPermission: () => player }; };
const actors = new Map([['v', mkActor('v', 'V', true, 'Solo')], ['judy', mkActor('judy', 'Judy Alvarez', true, 'Tech')], ['panam', mkActor('panam', 'Panam Palmer', true, 'Nomad')]]);
const journals = [];
const mkPage = (id, f) => ({ id, name: f.subject, flags: { [MOD]: f } });
const pages = [
  mkPage('p1', { messageId: 'm1', subject: 'Re: the Konpeki job', fromActorId: 'v', from: 'v@nc.net', toContactId: 'c-rogue', timestamp: '2077-01-20T00:00:00Z', status: { read: false } }),
  mkPage('p2', { messageId: 'm2-sent', subject: 'Afterlife. Tonight.', toActorId: 'v', to: 'v@nc.net', fromContactId: 'c-rogue', timestamp: '2077-01-18T00:00:00Z', status: { sent: true } }),
  mkPage('p3', { messageId: 'm3', subject: 'Did Clouds ever pay up?', fromActorId: 'judy', from: 'judy@mox.nc', toContactId: 'c-queen', timestamp: '2077-01-11T00:00:00Z', status: { read: true } }),
  mkPage('p4', { messageId: 'm4', subject: 'Splitting the take', from: 'dex@nightcity.net', toContactId: 'c-rogue', timestamp: '2077-01-17T00:00:00Z', status: { read: false } }),
  mkPage('p5', { messageId: 'm5', subject: 'BUY NOW', from: 'spam@junk.nc', toContactId: 'c-rogue', timestamp: '2077-01-19T00:00:00Z', status: { spam: true } }),
];
journals.push({ id: 'j-rogue', name: 'Rogue — Mail', folder: null, flags: { [MOD]: { type: 'contactInbox', contactId: 'c-rogue' } }, pages: Object.assign([...pages], { contents: pages, get: (pid) => pages.find((p) => p.id === pid) }) });
const opened = [];
const settingsStore = { npcMailAnswered: {} };
globalThis.game = {
  user: { id: 'gm', isGM: true }, users: Object.assign([], { find: () => null }),
  actors: { get: (id) => actors.get(id) || null, get contents() { return [...actors.values()]; } },
  settings: { get: (m, k) => settingsStore[k], set: async () => {} },
  get journal() { return Object.assign(journals, { get: (id) => journals.find((j) => j.id === id) }); },
  nightcity: {
    timeService: { getCurrentTimeMs: () => Date.UTC(2077, 0, 20, 12) },
    messageRepository: { _pageToMessage: (p) => ({ ...p.flags[MOD], pageId: p.id }) },
    composeMessage: (o) => opened.push(['compose', o]), openComposer: (o) => opened.push(['composer', o]),
  },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'x' } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: (m) => opened.push(['warn', m]), error: () => {} } };
globalThis.CSS = { escape: (s) => String(s) };
globalThis.__ncmScopePickerWired = true;
const { ContactsTab } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/ContactsTab.js`).href);
const all = [
  { id: 'c-rogue', name: 'Rogue Amendiares', email: 'rogue@afterlife.nc', role: 'fixer', trust: 3, relationships: { v: { trust: 4 } } },
  { id: 'c-queen', name: 'Queen of Hearts', email: 'queen@hush.nc', identityOf: 'c-rogue' },
  { id: 'c-dex', name: 'Dexter DeShawn', email: 'dex@nightcity.net', role: 'fixer' },
];
const app = { _activeTab: 'contacts', render: () => {}, _relativeTime: () => '1h ago' };
const tab = new ContactsTab(app);
tab._renders = 0; tab.render = () => { tab._renders++; };
const mail = tab._mail(all);
const rec = mail.byContact.get('c-rogue').recent;
ok(rec.every((r) => r.journalId === 'j-rogue' && r.pageId && 'ident' in r && 'withEmail' in r && 'spam' in r), 'the mail index rows carry journal/page/identity/address/spam');
ok(mail.byContact.get('c-queen')?.recent.some((r) => r.ident === 'c-queen'), 'mail to the alias is filed under the alias identity');
const pcs = [...actors.values()].map((a) => ({ actorId: a.id, name: a.name, player: a.id === 'v' ? 'Sam' : '', img: '', initials: a.name[0], actor: a, list: [], email: '' }));
flags.get('panam').contacts.push({ id: 'pc1', name: 'Rogue Amendiares', email: 'rogue@afterlife.nc', masterContactId: 'c-rogue' });
const kx = M.knowIndex(Object.fromEntries(pcs.map((p) => [p.actorId, flags.get(p.actorId).contacts])));
const ctx = tab._switchboardContext(all, all[0], pcs, kx, mail);
const CP = Object.fromEntries(ctx.people.map((p) => [p.key, p]));
ok(ctx && ctx.wedges.length === 2 && ctx.wedges[1].isAlias, 'the NPC group (main + alias) is one switchboard');
ok(!CP['e:spam@junk.nc'] && CP['e:dex@nightcity.net']?.name === 'Dexter DeShawn' && !CP['e:dex@nightcity.net'].isPc, 'a contact-only NPC correspondent is named from the directory, spam left out');
ok(CP.v.isPc && CP.v.waiting === 1 && CP.judy.waiting === 1 && CP.panam.never, 'players, waiting, never-written knowers');
ok(/fill:color-mix\(in oklab, var\(--ncm-hue-\d\) \d+%, var\(--ncm-attn\)\)/.test(CP.v.dotStyle) && /stroke:/.test(CP['e:dex@nightcity.net'].dotStyle) && CP.panam.dotStyle === '', 'dot styles: players filled (role hue → amber), NPCs outlined, never-written dashed');
ok(ctx.firstWaiting === 'judy' && ctx.card.key === 'judy', 'the card opens on the longest wait');
ok(ctx.card.reply.as === 'c-queen' && ctx.card.reply.pageId === 'p3' && ctx.card.asId === 'c-queen', 'reply + Write-as default to the identity she wrote to');
ok(ctx.card.trust && ctx.card.trust.segs.every((s) => s.cid === 'c-rogue' && s.actorId === 'judy') && ctx.card.knows === false, 'trust segments carry contact + character; Judy does not hold Rogue → Share');
ok(ctx.people.every((p) => p.msgs === undefined), 'no raw rows leak into the template context');
settingsStore.npcMailAnswered = { m3: '2077-01-20T00:00:00Z' };
{ const c2 = tab._switchboardContext(all, all[0], pcs, kx, mail); ok(c2.firstWaiting !== 'judy' && c2.people.find((p) => p.key === 'judy').waiting === 0, 'the tab reads npcMailAnswered: a ticked conversation stops waiting'); }
settingsStore.npcMailAnswered = {};
ok(tab._switchboardContext(all, { id: 'c-lone', name: 'Nobody' }, pcs, kx, mail) === null, 'no mail and nobody holds them → no module');
// ops
tab._switchboardContext(all, all[0], pcs, kx, mail);
await tab.onAct('sbPick', {}, { dataset: { key: 'v' } });
ok(tab._sbSel === 'v' && tab._switchboardContext(all, all[0], pcs, kx, mail).card.key === 'v', 'sbPick picks a correspondent');
await tab.onAct('sbAs', {}, { dataset: { ident: 'c-queen' } });
ok(tab._switchboardContext(all, all[0], pcs, kx, mail).card.asId === 'c-queen', 'sbAs switches Write as');
await tab.onAct('sbIdent', {}, { dataset: { ident: 'c-queen' } });
{ const ci = tab._switchboardContext(all, all[0], pcs, kx, mail); ok(ci.firstWaiting === 'judy' && ci.waitingPeople === 1 && ci.chips.find((c) => c.id === 'c-queen').on, 'sbIdent narrows to one identity'); }
await tab.onAct('sbIdent', {}, { dataset: { ident: '' } });
ok(tab._sbIdent === 'all', 'the All chip lets go');
tab._contact = (id) => all.find((c) => c.id === id) || null;
await tab.onAct('sbReply', {}, { dataset: { journal: 'j-rogue', page: 'p3', as: 'c-queen' } });
const rep = opened.find((o) => o[0] === 'composer');
ok(rep && rep[1].mode === 'reply' && rep[1].fromContactId === 'c-queen' && rep[1].originalMessage.messageId === 'm3', 'sbReply opens a reply as the identity it reached');
await tab.onAct('sbWrite', {}, { dataset: { as: 'c-queen', actor: 'v', email: 'v@nc.net' } });
const wr = opened.find((o) => o[0] === 'compose');
ok(wr && wr[1].fromContact?.id === 'c-queen' && wr[1].toActorId === 'v' && wr[1].to === 'v@nc.net', 'sbWrite writes as a contact-only identity to the character');
const other = all[2];
tab._switchboardContext(all, other, pcs, kx, mail);
ok(tab._sbSel === null && tab._sbIdent === 'all', 'state resets when another NPC is opened');
// inner tabs: Profile · Correspondents
{ const sbR = tab._switchboardContext(all, all[0], pcs, kx, mail);
  let t = tab._detailTabs(all[0], sbR);
  ok(t.onMain && t.sb === null && t.dtabs.map((x) => x.label).join() === 'Profile,Correspondents' && t.dtabs[0].on, 'opens on Profile, the switchboard is not built into it');
  ok(t.dtabs[1].count === sbR.waitingTotal && t.dtabs[1].attn, 'the Correspondents tab counts who is waiting (amber)');
  await tab.onAct('dTab', {}, { dataset: { tab: 'corr' } });
  t = tab._detailTabs(all[0], sbR);
  ok(!t.onMain && t.sb === sbR && t.dtabs[1].on, 'dTab switches to Correspondents and survives a re-render');
  t = tab._detailTabs(all[2], sbR);
  ok(t.onMain && tab._dTab === 'main', 'another NPC opens on Profile again');
  await tab.onAct('dTab', {}, { dataset: { tab: 'corr' } });
  t = tab._detailTabs(all[2], null);
  ok(t.onMain && t.dtabs === null, 'nobody writing → no inner tabs, Profile only'); }

// ═══ 3. Wiring ═══
const js = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
const hbs = read('templates/admin-panel/tab-contacts.hbs');
const css = read('styles/components/admin-panel/tab-contacts.css');
const a = hbs.indexOf('sb:start'), b = hbs.indexOf('sb:end');
const snip = hbs.slice(hbs.lastIndexOf('{{!--', a), hbs.indexOf('--}}', b) + 4);
ok(a > 0 && b > a && hbs.indexOf('{{#if dtabs}}') < a && hbs.indexOf('{{#if onMain}}', b) > b && hbs.indexOf('{{#if onMain}}', b) < hbs.indexOf('Who knows {{whoLabel}}'), 'the switchboard sits in the NPC detail on its own inner tab; Profile holds the rest');
ok(!/queue/i.test(snip) && !/sb__q|sbq/.test(snip) && !/sb__q|sb__reply/.test(css) && !/queue/.test(js.slice(js.indexOf('_switchboardContext('), js.indexOf('_draftFrom('))), 'the reply queue is gone (template, context, CSS)');
ok(/case 'dTab': this._dTab =/.test(js) && hbs.includes('data-op="dTab"') && js.includes("label: 'Correspondents'") && js.includes("label: 'Profile'"), 'inner tabs Profile · Correspondents switch by tabAct');
ok(js.includes("if (this._dTabFor !== c.id) { this._dTabFor = c.id; this._dTab = 'main'; }"), 'opening another NPC returns to Profile');
ok(['Directory', 'Players', 'Groups', 'Who knows whom'].every((t) => new RegExp('<header class="ncm-tabhd"><i class="fas [a-z0-9-]+"></i><div><h2>' + t + '</h2><p>[^<]+</p></div></header>').test(hbs)), 'every Contacts sub-tab opens with a page title + description');
ok(['isDirectory', 'isPlayers', 'isGroups', 'isMatrix'].every((k) => { const i = hbs.indexOf('{{#if ct2.' + k + '}}'); return i > 0 && hbs.slice(i, i + 120).includes('ncm-tabhd'); }), 'the title is the first thing in each sub-tab');
for (const op of ['sbPick', 'sbIdent', 'sbAs', 'sbReply', 'sbWrite']) ok(js.includes(`case '${op}'`) && snip.includes(`data-op="${op}"`), `op ${op} wired`);
for (const op of ['trustPlayer', 'whoToggle', 'recentOpen', 'pInbox']) ok(snip.includes(`data-op="${op}"`) && js.includes(`case '${op}'`), `reuses ${op}`);
ok(!snip.includes('data-fold-mod="sb"') && !js.includes('_sbShut'), 'no fold on its own tab');
ok(!/\.\.\//.test(snip) && !/@root/.test(snip), 'no ../ or @root in the snippet');
ok(!/\(concat |\(lower |\(gt |\{\{sub\}\}|\{\{lower\}\}/.test(snip), 'no unregistered / colliding helpers');
const classes = [...new Set([...snip.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /^ncm-ct2-sb[\w-]*$/.test(c)))];
ok(classes.length >= 6 && classes.every((c) => css.includes(`.${c}`)), `every ncm-ct2-sb class styled (${classes.filter((c) => !css.includes(`.${c}`)).join(', ') || 'all'})`);
const sbCss = css.slice(css.indexOf('the SWITCHBOARD'));
ok(!/#[0-9a-f]{3,8}\b/i.test(sbCss), 'tokens only');
ok(/prefers-reduced-motion/.test(sbCss) && /link\.owe[^}]*animation: none/.test(sbCss.replace(/\n/g, ' ')), 'reduced motion stops the flowing lines and halos');
ok(!/transform-origin/.test(sbCss), 'no CSS rotation');
ok(/--sb-attn-text: color-mix\(in oklab, var\(--ncm-attn\) 72%, var\(--ncm-text-heading\)\)/.test(sbCss), 'amber text has a darker-on-light twin');

// ═══ 4. The REAL snippet through Handlebars ═══
const HB = ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json'];
let Handlebars = null;
for (const p of HB) { if (!existsSync(p)) continue; try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* next */ } }
if (!Handlebars) { fail++; console.error('FAIL: Handlebars not found (Foundry install) — template not rendered'); }
else {
  const H = Handlebars.create();
  const render = H.compile(snip);
  tab._sbSel = null; tab._sbIdent = 'all'; tab._sbAs = null;
  const sbc = tab._switchboardContext(all, all[0], pcs, kx, mail);
  const html = render({ sb: sbc });
  ok(!/undefined|\[object Object\]|NaN/.test(html), 'renders with no undefined / NaN');
  ok((html.match(/class="wedge /g) || []).length === 2 && /class="wedge alias/.test(html), 'two wedges, the alias one violet');
  ok((html.match(/data-op="sbPick"/g) || []).length === sbc.people.length && !/Reply queue/.test(html), 'every dot picks; no reply queue');
  ok(/class="link owe/.test(html) && /class="dir theirs/.test(html) && /class="dot never/.test(html), 'owed lines, their-turn arrows, never-written dots');
  ok(/data-op="sbReply" data-journal="j-rogue" data-page="p3" data-as="c-queen"/.test(html), 'the card’s reply button carries the page and the identity');
  ok(/data-op="trustPlayer" data-id="c-rogue" data-actor="judy" data-v="1"/.test(html), 'card trust segments carry contact + character');
  ok(/data-op="whoToggle" data-id="c-rogue" data-actor="judy"/.test(html) && /Share Rogue with Judy Alvarez/.test(html), 'Share when the character does not hold the NPC');
  ok(/viewBox="-168 -168 336 336"/.test(html), 'viewBox centred on the hub');
  if (process.env.NCM_DUMP) {
    for (const t of ['clean-dark', 'clean-light']) {
      writeFileSync(`${process.env.NCM_DUMP}/sb-${t}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>sb</title>
<link rel="stylesheet" href="/_vendor/foundry2.css"><link rel="stylesheet" href="/_vendor/cpr.css"><link rel="stylesheet" href="/_vendor/fa/css/all.min.css">
<link rel="stylesheet" href="/styles/night-city-messenger.css"><link rel="stylesheet" href="/styles/themes/admin-theme.css">
<style>body{margin:0;padding:16px;background:#1b1b22} .mk-win,.mk-win .ncm-app{position:relative!important;inset:auto!important;transform:none!important;max-height:none!important}</style></head>
<body><div class="mk-win ncm-app ncm-admin-panel" data-ncm-admin-theme="${t}" style="width:470px"><div class="ncm-admin-panel"><div class="ncm-ct2" data-owner="contacts"><div class="ncm-ct2-detail" style="padding:10px;background:var(--ncm-bg-pane-alt)">${html}</div></div></div></div></body></html>`);
    }
  }
}

console.log(`test-npc-switchboard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
