/**
 * Admin → Phone → Numbers and Number setup: the GM's side of phone numbers.
 * @file scripts/ui/AdminPanel/tabs/phoneNumbersView.js
 * @module night-city-messenger
 * @description Spec dev/design/PHONE-REVISION.md §5, approved mock dev/mockups/phone-numbers-round2-mock.html. The screens are the
 *   approved ones, built as strings because they re-render often and hold a lot of small state. load() turns the real world into the
 *   shape they read (PEOPLE, ROWS, RET, REQUESTS, SPECIAL); every write goes through CallService, and a write can be undone
 *   from a snapshot unless the world moved on since. Rules live in utils/phoneNumbering.js.
 */

import { ncmNotify, tipText, cssUrl } from '../../../utils/notify.js';
import { MODULE_ID } from '../../../utils/constants.js';
import { getPlayerCharacters, formatCyberDate } from '../../../utils/helpers.js';
import { parseNumber, fullForm, seenFrom as seenWith, placeOf as placeWith, isUnlisted as unlistedWith, asKeys, specialKey, specialList, sanitizeSpecial, matchOrganization, orgKey, sanitizeRules, placesDiff, placesEdited, lineTypes, lineTypesDiff, sanitizeLineType, lineTypeFor, officeKey, sanitizeOffice, OFFICE_LINE } from '../../../utils/phoneNumbering.js';
import { COLS, startingRows, BOOK_ROWS } from '../../../data/phonePlaces.js';
import { CallHud } from '../../Calls/CallHud.js';
import { OVERHEARD_WAYS, OVERHEARD_MARKS, sanitizeScript, sanitizeLine, cluesHeard } from '../../../utils/overheard.js';
import { traumaLine, ORG_KINDS, sanitizeEmergency, traumaPlan, holdsItem, roleRank, norm, PLAN_NAMES, DEFAULT_ORGS, BACKUP_SLOTS, TRAUMA_SLOTS, LINE_TOKENS, EMERGENCY_SOUNDS, voiceSources, voiceHolder, personChanges, badTokens, backupLook } from '../../../utils/phoneEmergency.js';
import { SOUND_INFO } from '../../../utils/soundCatalog.js';
import { CyberTimePicker } from '../../components/CyberTimePicker.js';
import { parseCsv } from '../../../utils/csv.js';
import { identityRole } from '../../../utils/identities.js';
import { tagHue } from '../../../utils/tagHue.js';
import { BUILT_IN_ROLES } from '../../../utils/contactVocab.js';
import { showNamePicker, worldItemEntries } from '../../../utils/namePicker.js';
import { themedPrompt, themedConfirm } from '../../../utils/adminTheme.js';
import { dialogBodyHtml } from '../../../utils/dialogBody.js';
import { newFilePicker } from '../../../utils/compat.js';

export const OVERHEARD_FRAMES = ['ovhome', 'ovstage', 'ovrun', 'oveaves'];
export const NUMBER_FRAMES = ['numbers', 'bulk', 'board', 'requests', 'retired', 'corp', 'shared'];
export const SETUP_FRAMES = ['learn', 'rules', 'places', 'special', 'types', 'ring', 'trauma', 'backup'];
const SP_ACT = { ring: ['Rings you', 'It rings. You answer, or it goes to voicemail with no GM online.', 'it rings'], recording: ['Plays a recording', 'A recording plays, then the line goes dead. Works with no GM online.', 'a recording plays'], voicemail: ['Voicemail', 'Straight to voicemail. You read it later.', 'it goes to voicemail'], nis: ['Not in service', 'They hear "not in service". Good with an alert: you know they tried.', '"not in service"'], dead: ['Dead air', 'It connects to silence.', 'silence'], macro: ['Runs a macro', 'Runs a macro as the person dialling. Open a door, start a trace, show a handout. It needs that player to be allowed to run it.', 'whatever the macro does'] };
const SWITCHBOARDS = {};

/** One tab's state. It lives on the tab so the panel and a pop-out don't share a selection. */
export const newNumberState = () => ({ f: 'numbers', w: 'panel', sel: null, q: '', show: 'all', group: 'kind', shut: new Set(), prop: {}, change: null, addLine: null, okFlags: new Set(), undo: null,
  bulk: null, bulkOff: new Set(), bulkAll: false, dock: null, tile: null, boardCity: null, boardQ: '', rq: '', relOpen: null, learn: 0, part: 'x', tryN: 'WAT-2208', tryAs: '', pOpen: new Set(), tbq: '', edit: null, addPlace: null, addBranch: null, plan: null,
  lgT: '', lgE: null, ovEdit: null, ovRun: null, stStep: 1, lnOpen: null, clq: '', clShow: 'all', lq: '', lshow: 'all', ovHowShut: false, tlSide: 'a', tlVoice: 'text', shSel: null, shPick: null, typ: 'std', hudLive: false, off: null, coTab: 'sw', coQ: '', coShow: 'all', coGroup: 'corp', coOpen: new Set(), coShut: new Set(), corpFrom: 'main', dialExt: '', allOpen: false, bkOrg: 'ncpd', bkGq: '', bkRank: 'all', bkQ: '', ttQ: '', ttShow: 'all', fOpen: new Set(['rl-home', 'sp-who', 'ty-see', 'ttc', 'bkg', 'ev-room']), lineOpen: new Set(), bulkMove: null, reqSee: false, areaOpen: new Set(), areaShut: new Set(), spCall: null, spSel: null, list: '2045', custom: false, listAsk: null, walk: null, scroll: {} });

/* ─── the world, as the screens read it ─── */
let TAB = null, SVC = null, S = null, CTX = null, ROWS = [], REGIONS = {}, HOME = { rc: '', city: '' }, EXTRA_COLS = [], LIMITS = {}, PEOPLE = [], RET = [], REQUESTS = [], SPECIAL = [], ORG_MAP = {};
const SERVICE = {};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = (a) => [...new Set(a)];
const csvCell = (v) => (/[",\n]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? ''));
const hueOf = (s) => tagHue(s);
const initials = (s) => String(s).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const parse = (raw) => parseNumber(raw, CTX);
const seenFrom = (p) => seenWith(p, CTX);
const placeOf = (p) => placeWith(p, CTX);
const isUnlisted = (p) => unlistedWith(p, CTX);
const normSp = specialKey;
const homeCityName = () => REGIONS[HOME.rc]?.cities[HOME.city]?.name || 'your home city';
const specialOf = (service) => SPECIAL.find((x) => normSp(x.num) === service);
const stateOf = (p) => REGIONS[p.rc]?.cities[p.city]?.state || '';
const row = (l) => { const v = l.split('|'); const r = Object.fromEntries(COLS.map((c, i) => [c, v[i] ?? ''])); r.Listed = r.Listed || 'yes'; return r; };
const PCS = () => PEOPLE.filter((p) => p.kind === 'pc');
const byId = (id) => PEOPLE.find((p) => p.id === id);
const allLines = () => PEOPLE.flatMap((p) => p.lines.map((l) => ({ p, l, key: parse(l.n).key })));
const keyOf2 = (n) => parse(n).key;
const holderOf = (key) => allLines().find((x) => x.key === key) || null;
const isRetired = (key) => RET.find((r) => keyOf2(r.n) === key) || null;
const isTaken = (key) => !!holderOf(key) || !!isRetired(key) || REQUESTS.some((r) => keyOf2(r.to) === key);
const rowOfNum = (p) => ROWS.find((r) => r['Region code'] === p.rc && r['City code'] === p.city && (r.Code || '') === (p.ex || ''));
const needList = () => PEOPLE.filter((p) => !p.lines.some((l) => l.kind !== 'shared'));
const rowHeld = (r) => peopleOn(r['Region code'], r['City code'], r.Code).length;
const roleName = (id) => BUILT_IN_ROLES[id]?.label || game.nightcity?.masterContactService?.getCustomRoles?.()?.find?.((r) => r.id === id)?.label || id || '';
const actorRole = (a) => (a?.items?.contents || a?.items || []).find?.((i) => i.type === 'role')?.name || '';
const when = (t) => `<span class="ncm-pn-when">${esc(t)}</span>`;

/** The real world, in the shape the screens read. Rebuilt before every render and every action. */
function load(tab) {
  TAB = tab; SVC = tab.calls; S = tab._pn; CTX = SVC.numberContext;
  S.w = tab.app?.isPopout ? 'pop' : 'panel';
  const stored = SVC._get('phonePlaces', {}) || {};
  ROWS = CTX.rows.map((r) => ({ ...r })); REGIONS = CTX.regions; HOME = CTX.home; EXTRA_COLS = Array.isArray(stored.extra) ? stored.extra : [];
  S.list = ['2045', '2077', 'blank'].includes(stored.list) ? stored.list : '2045'; S.custom = placesEdited(stored);
  const R = SVC.rules; LIMITS = { scope: R.reach === 'home' ? 'city' : R.reach, ownDigits: R.ownDigits, extra: R.extraLines, changeNeedsGm: R.changeNeedsGm };
  ORG_MAP = SVC._get('phoneOrgNames', {}) || {};
  SPECIAL = specialList(SVC._get('phoneSpecial', null));
  for (const k of Object.keys(SERVICE)) delete SERVICE[k];
  for (const x of SPECIAL) if (normSp(x.num)) SERVICE['#' + normSp(x.num)] = x.name || x.num;
  if (!S.spSel || !SPECIAL.some((x) => x.id === S.spSel)) S.spSel = SPECIAL[0]?.id || null;
  if (!S.boardCity) S.boardCity = `${HOME.rc}:${HOME.city}`;
  if (!S.pOpen.size) S.pOpen.add(HOME.rc);
  const mcs = game.nightcity?.masterContactService;
  const contacts = mcs?.getAll?.() || [];
  const pcs = getPlayerCharacters();
  const people = [], byContact = new Map(), byActor = new Map();
  const add = (p) => { people.push({ lines: [], role: '', org: '', loc: '', player: '', img: '', ...p }); return people[people.length - 1]; };
  for (const c of pcs) byActor.set(c.actorId, add({ id: c.actorId, name: c.actorName, kind: 'pc', player: c.playerName || '', role: actorRole(c.actor), img: c.actor?.img || '' }));
  const npcs = [];
  for (const c of contacts) {
    if (c.sendOnly) continue;
    const role = identityRole(contacts, c);
    const pc = c.actorId ? byActor.get(c.actorId) : null;
    if (pc && !role?.isAlias) { pc.org ||= c.organization || ''; pc.loc ||= c.location || ''; byContact.set(c.id, pc); continue; }
    npcs.push({ c, role });
  }
  for (const { c, role } of npcs) {
    const mainId = role?.isAlias ? role.primary?.id : null;
    const p = add({ id: c.id, name: c.name, kind: 'npc', role: roleName(c.role), org: c.organization || '', loc: c.location || '', img: c.portrait || '' });
    p.mainContact = mainId; byContact.set(c.id, p);
    if (c.actorId && !role?.isAlias && !byActor.has(c.actorId)) byActor.set(c.actorId, p);
  }
  for (const p of people) if (p.mainContact) p.aliasOf = byContact.get(p.mainContact)?.id || null;
  // what the lines say
  const saved = SVC.savedNumbers();
  const seen = new Set();
  for (const [key, l] of Object.entries(SVC.lines())) {
    seen.add(key);
    if (l.kind === 'terminal') continue;
    if (Array.isArray(l.members)) {
      for (const m of l.members) { const p = (m.contactId && byContact.get(m.contactId)) || byActor.get(m.actorId); if (p) p.lines.push({ n: l.number, kind: 'shared', why: l.why || 'A shared line.', holders: (saved.get(key) || []).filter((id) => byId2(people, id)), label: l.label || '', off: !!l.off }); }
      continue;
    }
    let p = (l.owner?.contactId && byContact.get(l.owner.contactId)) || (l.owner?.actorId && byActor.get(l.owner.actorId));
    // an owner who has gone: still listed, because the number still answers
    if (!p) { p = add({ id: l.owner?.actorId || l.owner?.contactId || key, name: l.owner?.name || 'Nobody', kind: 'npc', actorOnly: !l.owner?.contactId }); if (l.owner?.actorId) byActor.set(l.owner.actorId, p); }
    const kind = l.kind || (l.owner?.contactId ? 'alias' : 'main');
    p.lines.push({ n: l.number, kind: kind === 'alias' && !p.aliasOf ? 'main' : kind === 'main' && p.aliasOf ? 'alias' : kind, why: l.why || 'Given before reasons were kept.', holders: (saved.get(key) || []).filter((id) => byId2(people, id)), label: l.label || '', off: !!l.off });
  }
  // a number typed straight on a contact's form still counts
  for (const c of contacts) {
    if (!c.phone) continue;
    const k = parseNumber(c.phone, CTX).key;
    if (!k || seen.has(k)) continue;
    const p = byContact.get(c.id); if (!p) continue;
    p.lines.push({ n: c.phone, kind: p.aliasOf ? 'alias' : 'main', why: 'Typed on their contact form.', holders: (saved.get(k) || []).filter((id) => byId2(people, id)), label: '', off: false });
  }
  const rank = { main: 0, alias: 0, extra: 1, burner: 2, shared: 3 };
  for (const p of people) p.lines.sort((a, b) => rank[a.kind] - rank[b.kind]);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const mains = people.filter((p) => !p.aliasOf).sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === 'pc' ? -1 : 1));
  PEOPLE = mains.flatMap((m) => [m, ...people.filter((p) => p.aliasOf === m.id).sort(byName)]);
  if (!S.tryAs) S.tryAs = PCS()[0]?.id || '';
  typesNow(); officesNow();
  S.lgE ??= blankEntry();
  RET = SVC.retired().map((r) => ({ n: r.number || r.key, was: r.was || 'Nobody', why: r.why || 'Retired', at: fmtDay(r.at) })).reverse();
  REQUESTS = SVC.requests().map((r) => { const who = byId(r.actorId)?.name || 'Someone'; const to = seenFrom(parse(r.to));
    return r.kind === 'line' ? { id: r.id, pid: r.actorId, type: 'line', kind: r.lineKind || 'extra', label: r.label || '', to: r.to, say: `${who} wants another line (${to}). They are past your limit of ${LIMITS.extra}.` }
      : { id: r.id, pid: r.actorId, type: 'change', to: r.to, say: `${who} wants ${to} instead of the number they have.` }; }).filter((r) => byId(r.pid));
}
const byId2 = (list, id) => list.some((p) => p.id === id && p.kind === 'pc');
const fmtDay = (t) => { if (!t) return ''; try { return formatCyberDate(t, { dateOnly: true }); } catch { return String(t).slice(0, 10); } };

/* one question per fold; a closed head still shows the answer */
const qIsOpen = (k) => S.allOpen || S.fOpen.has(k);
const qsect = (k, ic, q, tone, answer, body) => { const open = qIsOpen(k); return `<div class="ncm-pn-sect ncm-pn-q${open ? ' is-open' : ''}"><button type="button" class="ncm-pn-band ncm-pn-qh" style="--sk:${tone}" data-do="qFold" data-k="${k}" aria-expanded="${open}" data-tooltip="${tipText(open ? 'Fold' : 'Open')} this"><i class="fas fa-chevron-down ch"></i><i class="fas ${ic}"></i> ${esc(q)}<small>${esc(answer)}</small></button>${open ? `<div class="in">${body}</div>` : ''}</div>`; };
function numParts(n) {
  const p = parse(n);
  if (p.service) return `<span class="x">${esc(specialOf(p.service)?.num || p.service)}</span>`;
  const shown = seenFrom(p); let rest = shown; const parts = [];
  const take = (c, re) => { const m = rest.match(re); if (m) { parts.push(`<span class="${c}">${esc(m[0])}</span>`); rest = rest.slice(m[0].length); } };
  take('r', /^\+\d+\s/); if (/^\+/.test(shown) || p.city !== HOME.city || p.rc !== HOME.rc) take('c', /^[A-Z]{2,3}[\s-]/);
  take('x', /^[A-Z]{3}-/); parts.push(`<span class="l">${esc(rest)}</span>`);
  return parts.join('');
}
function pnum(n) {
  if (!n) return '<span class="ncm-pnum is-none">no number</span>';
  return `<span class="ncm-pnum" data-pn="${esc(n)}" tabindex="0">${numParts(n)}</span>`;
}
const pcolor = (n) => `<span class="ncm-pnum is-plain">${numParts(n)}</span>`;
/** Small coloured words: a role, an organization, a place. Colour says which one, never what is wrong. */
const hv = (t, ic) => (t ? `<span class="ncm-pn-hv" style="--tc:${hueOf(t)}">${ic ? `<i class="fas ${ic}"></i>` : ''}${esc(t)}</span>` : '');
const numAt = (r, line) => (r.Code ? `+${r['Region code']} ${r['City code']} ${r.Code}-${line}` : `+${r['Region code']} ${r['City code']}-${line}`);
let seed = 4471; const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
function freeLine(r, near = null, planned = []) {
  const clash = (l) => { const k = keyOf2(numAt(r, l)); return isTaken(k) || planned.includes(k); };
  if (near) { const base = Number(near); for (let d = 1; d < 40; d++) { const l = String(base + d).padStart(4, '0'); if (!clash(l)) return l; } }
  for (let t = 0; t < 20000; t++) { const l = String(1000 + rnd(8900)); if (!clash(l)) return l; }
  return '0000';
}
const isCorp = (r) => r.Category === 'Corporate';
const homeRows = () => ROWS.filter((r) => r['Region code'] === HOME.rc && r['City code'] === HOME.city);
const homeDistricts = () => homeRows().filter((r) => r.Code && r.Category === 'District' && r['Players can pick'] === 'yes' && r.Status === 'live');
/** A name in the contact's Location field, turned into a row. Home city's districts first. */
function rowForLoc(loc) {
  if (!loc) return null;
  const d = (r) => !isCorp(r) && r.Status === 'live';
  const home = homeRows().filter(d), all = ROWS.filter(d);
  const homeCity = String(homeRows()[0]?.City || '').toLowerCase();
  const parts = String(loc).toLowerCase().split(/[,/]/).map((t) => t.replace(/\b(district|area|the|city of)\b/g, '').trim()).filter((t) => t && t !== homeCity);
  for (const l of parts) {
    const hit = home.find((r) => r.District?.toLowerCase() === l) || home.find((r) => r.District?.toLowerCase().includes(l) || (l.length > 3 && l.includes(String(r.District || '~').toLowerCase())))
      || all.find((r) => r.District?.toLowerCase().includes(l)) || all.find((r) => r.City.toLowerCase() === l) || home.find((r) => r.Area?.toLowerCase() === l);
    if (hit) return hit;
  }
  return null;
}
const corpNames = () => uniq(ROWS.filter(isCorp).map((r) => r.District));
const orgMatch = (org) => matchOrganization(org, corpNames(), ORG_MAP);
const sameOrg = (a, b) => { if (!a.org || !b.org) return false; if (a.org === b.org) return true; const x = orgMatch(a.org).corp; return !!x && x === orgMatch(b.org).corp; };
function officeRow(org, cityName) {
  const corp = orgMatch(org).corp; if (!corp) return null;
  return ROWS.find((r) => isCorp(r) && r.District === corp && r.City.toLowerCase() === (cityName || homeRows()[0]?.City || '').toLowerCase()) || null;
}
/** Says so when the Organization did not lead anywhere, instead of quietly using something else. */
function orgNote(p) {
  const m = orgMatch(p.org); const pick = `<label class="ncm-pn-sel" data-tooltip="Everyone whose Organization reads the same goes here too"><span>Office</span><select id="og-${p.id}" data-ch="orgPick" data-org="${esc(p.org)}">${opt('', 'Choose…', true)}${corpNames().map((c) => opt(c, c)).join('')}</select></label>`;
  const nope = btn('Not a corporation', 'fa-ban', 'Stop asking about this name. Everyone with it uses their Location', `data-do="orgNot" data-org="${esc(p.org)}"`);
  if (m.state === 'guess') return `<div class="ncm-pn-check ncm-wk-org"><i class="fas fa-triangle-exclamation"></i><span>Organization says <b>${esc(p.org)}</b>, and no office matches. Did you mean ${esc(m.guess)}?</span>${btn('Use ' + m.guess, 'fa-building', 'Everyone whose Organization reads the same goes here too', `data-do="orgUse" data-org="${esc(p.org)}" data-corp="${esc(m.guess)}"`, 'pri')}${pick}${nope}</div>`;
  if (m.state === 'miss') return `<div class="ncm-pn-check info ncm-wk-org"><i class="fas fa-circle-info"></i><span>Organization says <b>${esc(p.org)}</b>, and no office matches. If it has offices, pick one or add it in Places.</span>${pick}${nope}</div>`;
  if (m.state === 'ok' && !officeRow(p.org, p.loc || homeRows()[0]?.City)) return `<div class="ncm-pn-check info ncm-wk-org"><i class="fas fa-circle-info"></i><span>${esc(m.corp)} has no office in ${esc(p.loc || homeRows()[0]?.City)}. Use the shortcut below for another office, or add a branch in Places.</span></div>`;
  return '';
}
const orgChanged = () => { S.prop = {}; S.bulk = null; S.walk = null; };
const orgDecide = (org, value, text) => undoable(text, async () => { await SVC.saveNumberSetting('phoneOrgNames', { ...ORG_MAP, [orgKey(org)]: value }); orgChanged(); return { ok: true }; });
function suggest(p, planned = {}, force = null) {
  const plannedKeys = Object.values(planned).map((x) => keyOf2(x.n));
  const m = p.aliasOf ? byId(p.aliasOf) : null;
  const mainNum = m ? (planned[m.id]?.n || m.lines[0]?.n) : null;
  const avoid = mainNum ? parse(mainNum).ex : null;
  let r = null, why = '', near = null, src = 'rand';
  const city = p.loc || homeRows()[0]?.City;
  if (force) { r = force; src = 'you'; why = 'You picked ' + (r.District || r.City) + '.'; }
  else if (p.org && officeRow(p.org, city)) {
    r = officeRow(p.org, city); src = 'org';
    why = `Works at ${p.org}, so the ${r.City} office.`;
    const mates = [...PEOPLE.filter((x) => sameOrg(x, p) && x.id !== p.id && x.lines[0]).map((x) => ({ x, n: x.lines[0].n })), ...PEOPLE.filter((x) => sameOrg(x, p) && x.id !== p.id && planned[x.id]).map((x) => ({ x, n: planned[x.id].n }))].filter((y) => parse(y.n).ex === r.Code && parse(y.n).city === r['City code']);
    if (mates.length) { near = parse(mates[0].n).line; why += ` Next to ${mates[0].x.name}'s line.`; }
    if (r.Listed === 'no') why += ' This office is hidden, so players see Unlisted number.';
  } else if (rowForLoc(p.loc) && !(avoid && rowForLoc(p.loc).Code === avoid)) {
    r = rowForLoc(p.loc); src = 'loc'; why = r.Code ? `Their Location says ${p.loc}, so ${r.District}.` : `Their Location says ${p.loc}.`;
  }
  if (!r) {
    const pool = homeDistricts().filter((d) => d.Code !== avoid);
    const any = pool.length ? pool : homeRows().filter((d) => d.Status !== 'dead').length ? homeRows().filter((d) => d.Status !== 'dead') : ROWS.filter((d) => d.Status !== 'dead');
    r = any[rnd(any.length)]; src = m ? 'alias' : 'rand';
    why = m ? `Alias of ${m.name}: kept off their district so the numbers don't link them.` : ["guess","miss"].includes(orgMatch(p.org).state) ? `Their Organization matched no office, so a random district players can pick.` : `Nothing in their details points anywhere, so a random district players can pick.`;
  } else if (m && !force) why += ' Kept off the main identity\'s district.';
  return { n: numAt(r, freeLine(r, near, plannedKeys)), why, src, code: r.Code, rowKey: r['City code'] + '/' + (r.Code || '-') };
}
/** The full written form, each part in its colour. */
function fullHtml(n) { const m = fullForm(parse(n)).match(/^(\+\d+\s)([A-Z]{2,3}[\s-])([A-Z]{3}-)?(\d+)$/); if (!m) return esc(fullForm(parse(n))); return `<span class="ncm-pnum is-plain"><span class="r">${esc(m[1])}</span><span class="c">${esc(m[2])}</span>${m[3] ? `<span class="x">${esc(m[3])}</span>` : ''}<span class="l">${esc(m[4])}</span></span>`; }
const portrait = (o, cls = '') => (o.img ? `<span class="ncm-pn-face has-img ${cls}" style="background-image:url('${esc(cssUrl(o.img))}')" role="img" aria-label="${esc(o.name || 'Portrait')}"></span>` : `<span class="ncm-pn-face ${cls}" style="--tc:${hueOf(o.name || o.num || '?')}">${o.name ? esc(initials(o.name)) : '<i class="fas fa-star-of-life" aria-hidden="true"></i>'}</span>`);
const SRC = { org: ['Organization', 'fa-building', 'var(--ncm-hue-5)'], loc: ['Location', 'fa-location-dot', 'var(--ncm-hue-3)'], alias: ['Alias', 'fa-mask', 'var(--ncm-secret)'], rand: ['Random', 'fa-dice', 'var(--ncm-text-label)'], you: ['Your pick', 'fa-hand-pointer', 'var(--ncm-act)'] };
const srcChip = (pr) => { const [t, ic, c] = SRC[pr.src] || SRC.rand; return `<span class="ncm-tagp" style="--tc:${c}" data-tooltip="What this proposal was based on"><i class="fas ${ic}"></i> ${t}</span>`; };
/** Sense-checks. They warn and never block. */
function flagsOf(p, l) {
  const out = []; const q = parse(l.n), r = rowOfNum(q);
  const k = p.id + '|' + l.n;
  const add = (id, tone, text, fix) => { if (!S.okFlags.has(k + id)) out.push({ id, tone, text, fix, k: k + id }); };
  if (p.aliasOf) { const mn = byId(p.aliasOf)?.lines[0]; if (mn && parse(mn.n).ex === q.ex && parse(mn.n).city === q.city) add('a', 'warn', `Same district as ${byId(p.aliasOf).name}'s main number. A careful runner could link them.`, true); }
  const o = p.org ? officeRow(p.org, REGIONS[q.rc]?.cities[q.city]?.name) : null;
  if (o && q.ex !== o.Code && (l.kind === 'main' || l.kind === 'alias')) add('o', 'warn', `Works at ${p.org}, whose ${o.City} office is ${o.Code}. Fine if this is a personal line.`, true);
  if (!o && p.loc && !p.org) { const lr = rowForLoc(p.loc); if (lr && (lr['City code'] !== q.city || lr['Region code'] !== q.rc)) add('l', 'info', `Their Location says ${p.loc}, but the number is from ${(REGIONS[q.rc]?.cities[q.city]?.name || 'another city')}. Numbers stay with people, so this only matters if you didn't mean it.`, true); }
  if (r?.Status === 'dead') add('d', 'warn', `${r.District} is marked dead. Nothing there should answer.`, true);
  if (r?.Listed === 'no' && l.kind !== 'burner') add('h', 'info', `${r.District} is hidden, so players see this as an Unlisted number.`, false);
  return out;
}
const kindTag = { main: ['Main', 'is-plain', 'fa-sim-card', 'The number this identity gives out.'], alias: ['Alias line', 'is-secret', 'fa-mask', 'Belongs to the alias. Players who hold it never learn who is behind it.'], extra: ['Extra line', 'is-act', 'fa-layer-group', 'A second number on the same identity, with its own label.'], burner: ['Burner', 'is-attn', 'fa-fire', 'A throwaway line. Burned, it retires for good.'], shared: ['Shared', 'is-act', 'fa-users-line', 'Several people answer this number. Manage it under Shared lines.'] };
const tagp = (t, tone, ic, tip) => `<span class="ncm-tagp ${tone}"${tip ? ` data-tooltip="${tipText(tip)}"` : ''}>${ic ? `<i class="fas ${ic}"></i> ` : ''}${esc(t)}</span>`;
const hue = (t, ic, tip) => `<span class="ncm-tagp" style="--tc:${hueOf(t)}"${tip ? ` data-tooltip="${tipText(tip)}"` : ''}>${ic ? `<i class="fas ${ic}"></i> ` : ''}${esc(t)}</span>`;
const face = (p, cls = '') => (p.img ? portrait(p, cls) : `<span class="ncm-pn-face ${cls}" style="--tc:${hueOf(p.name)}">${esc(initials(p.name))}</span>`);
const btn = (label, icon, tip, attrs = '', mod = '') => `<button type="button" class="ncm-ph2-btn${mod ? mod.split(' ').map((m) => ' ncm-ph2-btn--' + m).join('') : ''}" data-tooltip="${tipText(tip)}"${label ? '' : ` aria-label="${esc(tip)}"`} ${attrs}>${icon ? `<i class="fas ${icon}"></i>` : ''}${label ? ' ' + esc(label) : ''}</button>`;
const opt = (v, t, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(t)}</option>`;
const inner = (tabs) => `<div class="ncm-pn-inner" role="tablist">${tabs.map(([f, l, ic, tip, n, hot]) => `<button type="button" role="tab" aria-selected="${S.f === f}" class="${S.f === f ? 'on' : ''}" data-do="frame" data-f="${f}" data-tooltip="${tipText(tip)}"><i class="fas ${ic}"></i> ${esc(l)}${n ? `<span class="ncm-pn-count${hot ? ' hot' : ''}">${n}</span>` : ''}</button>`).join('')}</div>`;
const numbersTabs = () => inner([
  ['numbers', 'People', 'fa-users', 'Every identity and every line they hold'],
  ['board', 'Districts', 'fa-table-cells', 'Who is on which district, and who has no number yet'],
  ['requests', 'Requests', 'fa-inbox', 'What players have asked you to approve', REQUESTS.length, REQUESTS.length > 0],
  ['retired', 'Retired', 'fa-box-archive', 'Numbers that are gone and are never handed out again', RET.length],
  ['corp', 'Corporations', 'fa-building', 'Each office: who answers, and who can be reached through it'],
  ['shared', 'Shared lines', 'fa-users-line', 'One number, several people'],
]);
const setupTabs = () => inner([
  ['learn', 'How it works', 'fa-graduation-cap', 'The number system in five short steps, and a box to try any number'],
  ['rules', 'Rules', 'fa-sliders', 'Home city, what players can pick, approvals, line limits'],
  ['places', 'Places', 'fa-table', 'The table every number comes from. Edit it here or in a spreadsheet'],
  ['special', 'Special numbers', 'fa-star-of-life', 'Numbers that play by their own rules: hidden lines, hotlines, anything', SPECIAL.length],
  ['types', 'Line types', 'fa-layer-group', 'Standard, corporate, burner, payphone, business, and your own'],
  ['trauma', 'Emergency calls', 'fa-truck-medical', 'Trauma Team and Lawman Backup'],
]);
const undoLine = () => (S.undo ? `<div class="ncm-pn-undo"><i class="fas fa-check"></i><span class="grow">${esc(S.undo.text)}</span>${btn('Undo', 'fa-rotate-left', 'Take it back. The numbers go back in the pool, nothing retires', 'data-do="undo"')}<button type="button" data-do="undoClose" aria-label="Dismiss" data-tooltip="Dismiss"><i class="fas fa-xmark"></i></button></div>` : '');
function passesShow(p) {
  switch (S.show) {
    case 'none': return !p.lines.length;
    case 'pc': return p.kind === 'pc';
    case 'npc': return p.kind === 'npc';
    case 'alias': return !!p.aliasOf;
    case 'extra': return p.lines.some((l) => l.kind === 'extra' || l.kind === 'burner');
    case 'off': return p.lines.some((l) => l.off);
    case 'flag': return p.lines.some((l) => flagsOf(p, l).some((f) => f.tone === 'warn'));
    default: return true;
  }
}
function matchesQ(p) {
  const q = S.q.trim().toLowerCase(); if (!q) return true;
  const c = q.replace(/[\s-]/g, '');
  return [p.name, p.role, p.org, p.loc, p.player].join(' ').toLowerCase().includes(q) || p.lines.some((l) => l.n.toLowerCase().replace(/[\s-]/g, '').includes(c) || l.label.toLowerCase().includes(q));
}
function groupsOf(rows) {
  const groups = new Map(); const put = (k, p) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); };
  for (const p of rows) {
    if (S.group === 'kind') put(p.kind === 'pc' ? 'Players' : 'NPCs', p);
    else if (S.group === 'org') put(p.org || 'No organization', p);
    else if (S.group === 'district') { const r = p.lines[0] && rowOfNum(parse(p.lines[0].n)); put(r ? (r.District || r.City) : 'No number', p); }
    else put('Everyone', p);
  }
  return [...groups];
}
function peopleRow(p) {
  const l = p.lines.filter((x) => !x.burned);
  const warn = p.lines.some((x) => flagsOf(p, x).some((f) => f.tone === 'warn'));
  const off = l.some((x) => x.off);
  return `<button type="button" class="ncm-pn-prow${S.sel === p.id ? ' on' : ''}${l.length ? '' : ' is-none'}" data-do="sel" data-id="${p.id}" data-tooltip="Open ${tipText(p.name)}">${face(p)}<span class="bd"><span class="nm">${esc(p.name)}${p.aliasOf ? tagp('alias', 'is-secret') : ''}${warn ? '<i class="fas fa-triangle-exclamation ncm-pn-warnmark" aria-label="Something to check"></i>' : ''}</span>
    <span class="ln">${l[0] ? pcolor(l[0].n) : tagp('no number', 'is-attn', 'fa-user-plus')}${l.length > 1 ? `<span class="ncm-pn-more" data-tooltip="${tipText(l.length - 1)} more line${tipText(l.length === 2 ? '' : 's')}">+${l.length - 1}</span>` : ''}${off ? tagp('off', 'is-attn', 'fa-power-off') : ''}</span>
    <span class="mt">${p.kind === 'pc' ? `<span class="ncm-pn-who">${esc(p.player)}</span>` : ''}${hv(p.role)}${hv(p.org, 'fa-building')}${p.org ? '' : hv(p.loc, 'fa-location-dot')}</span></span></button>`;
}
const lineIsOpen = (p, i) => S.allOpen || S.lineOpen.has(p.id + i) !== (i === 0);
function lineCard(p, l, i) {
  const q = parse(l.n), r = rowOfNum(q), [kt, kc, ki, kh] = kindTag[l.kind];
  const flags = flagsOf(p, l);
  if (S.change && S.change.pid === p.id && S.change.i === i) return changeForm(p, l, i);
  const place = placeOf(q);
  return `<div class="ncm-pn-line is-${l.kind}${l.off ? ' is-off' : ''}">
    <div class="ncm-pn-lhead"><button type="button" class="ncm-pn-lfold" data-do="lineFold" data-k="${esc(p.id + i)}" aria-expanded="${lineIsOpen(p, i)}" aria-label="Details for this line" data-tooltip="${tipText(lineIsOpen(p, i) ? 'Fold' : 'Open')} this line's details"><i class="fas fa-chevron-down ch${lineIsOpen(p, i) ? '' : ' shut'}"></i></button>${pnum(l.n)}${tagp(kt, kc, ki, kh)}${l.label ? hue(l.label, null, 'The label on this line') : ''}${l.off ? tagp('Switched off', 'is-attn', 'fa-power-off', 'Callers hear not in service. Switch it back on any time') : ''}<span class="grow"></span>${(p.kind === 'npc' && !p.actorOnly ? btn('', 'fa-phone', 'Call a player as ' + p.name + ' on this line', `data-do="lineCall" data-id="${p.id}"`, 'ic go') : '')}${btn('', 'fa-clock-rotate-left', 'Write calls into this log by hand', `data-do="lgOpen" data-id="${esc(p.id)}"`, 'ic')}${btn('', 'fa-voicemail', 'Greeting and voicemail for this line', `data-do="lineGreeting" data-n="${esc(l.n)}" data-name="${esc(p.name)}"`, 'ic')}</div>
    ${lineIsOpen(p, i) ? '' : (flags.some((f) => f.tone === 'warn') ? '<div class="ncm-pn-lnote"><i class="fas fa-triangle-exclamation"></i> Something to check</div>' : '')}<div class="ncm-pn-lbody"${lineIsOpen(p, i) ? '' : ' hidden'}><div class="ncm-pn-kv">
      <span class="k" data-tooltip="Where it was issued. A number never says where someone is now."><i class="fas fa-location-dot"></i> Issued in</span><span class="ncm-pn-val" style="--tc:${hueOf(place)}">${esc(place)}${r?.Listed === 'no' ? ' ' + tagp('hidden', 'is-secret', 'fa-eye-slash', 'Out of the directory. Players see Unlisted number') : ''}</span>
      <span class="k" data-tooltip="The whole number, the way someone far away would dial it"><i class="fas fa-hashtag"></i> Written as</span><span>${fullHtml(l.n)}</span>
      <span class="k" data-tooltip="Characters who have this number saved"><i class="fas fa-user-group"></i> Who has it</span><span class="ncm-pn-holders">${l.holders.length ? l.holders.map((h) => hue(byId(h).name)).join('') : '<small>Nobody yet</small>'}</span>
      <span class="k" data-tooltip="What the other person sees, and what a Trace finds"><i class="fas fa-layer-group"></i> Type</span><span><select id="lt-${esc(p.id)}-${i}" data-ch="lineType" data-n="${esc(l.n)}" aria-label="Line type">${TYPES.map((t) => opt(t.id, t.name, lineTypeFor(SVC.lines()[parse(l.n).key], r, TYPES) === t)).join('')}</select></span>
      ${lineTypeFor(SVC.lines()[parse(l.n).key], r, TYPES)?.shows === 'label' ? `<span class="k" data-tooltip="What people see when this line calls them, and what a Trace finds"><i class="fas fa-store"></i> Shows as</span><span><input type="text" id="ll-${esc(p.id)}-${i}" data-in="lineLabel" data-n="${esc(l.n)}" maxlength="24" value="${esc(SVC.lines()[parse(l.n).key]?.label || '')}" placeholder="Name of the business" aria-label="Name this line shows"></span>` : ''}
      <span class="k" data-tooltip="Why this number was chosen. It stays with the line so you remember later."><i class="fas fa-lightbulb"></i> Why</span><span class="ncm-pn-note">${esc(l.why)}</span>
    </div>
    ${flags.map((f) => `<div class="ncm-pn-check ${f.tone === 'info' ? 'info' : ''}"><i class="fas ${f.tone === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation'}"></i><span class="grow">${esc(f.text)}</span>${f.fix ? btn('Looks right', '', 'Stop flagging this', `data-do="okFlag" data-k="${esc(f.k)}"`) : ''}</div>`).join('')}
    <div class="ncm-pn-acts">
      ${l.kind === 'shared' ? '' : btn('Change', 'fa-pen', 'Give this line a new number. The old one retires', `data-do="change" data-id="${p.id}" data-i="${i}"`)}
      ${btn('Share', 'fa-share-nodes', 'Choose who gets this number', `data-do="shareFrom" data-id="${p.id}" data-i="${i}"`)}
      ${btn(l.off ? 'Switch on' : 'Switch off', 'fa-power-off', l.off ? 'Back in service, same number' : 'A lost phone or an unpaid bill. Callers hear not in service until you switch it back on', `data-do="lineOff" data-id="${p.id}" data-i="${i}"`)}
      ${l.kind === 'shared' ? btn('Open', 'fa-users-line', 'Manage this line under Shared lines', `data-do="shGo" data-n="${esc(l.n)}"`) : ''}${l.kind === 'main' || l.kind === 'alias' ? btn('Take it away', 'fa-box-archive', 'They have no number after this. It retires for good', `data-do="retireLine" data-id="${p.id}" data-i="${i}"`, 'bad') : ''}${l.kind === 'burner' ? btn('Burn', 'fa-fire', 'Retire this burner for good', `data-do="retireLine" data-id="${p.id}" data-i="${i}"`, 'bad') : l.kind === 'extra' ? btn('Retire', 'fa-box-archive', 'Retire this line for good', `data-do="retireLine" data-id="${p.id}" data-i="${i}"`, 'bad') : ''}
    </div></div>
  </div>`;
}
const WK = [
  { key: 'rc', label: 'Region', ask: 'Which region is the number from?', col: 'Region code', name: (r) => r.Region, blank: '' },
  { key: 'state', label: 'State', ask: 'Which state? A label only, never dialled.', col: 'State', name: (r) => r.State, blank: 'No state' },
  { key: 'city', label: 'City', ask: 'Which city?', col: 'City code', name: (r) => r.City, blank: '' },
  { key: 'area', label: 'Area', ask: 'Which part of the city? A label only, never dialled.', col: 'Area', name: (r) => r.Area, blank: 'Whole city' },
  { key: 'code', label: 'District', ask: 'Which district or office?', col: 'Code', name: (r) => r.District, blank: 'No district' },
];
const wkPathOf = (r) => Object.fromEntries(WK.map((w) => [w.key, r[w.col] || '']));
const wkRows = (path, upto) => ROWS.filter((r) => r.Status !== 'dead' && WK.slice(0, upto).every((w) => (r[w.col] || '') === path[w.key]));
const wkRow = (path) => wkRows(path, WK.length)[0] || null;
const wkTag = (r) => (r.Status === 'dead' ? '' : [isCorp(r) ? tagp('Corporate', 'is-act', 'fa-building') : '', r.Listed === 'no' ? tagp('Hidden', 'is-secret', 'fa-eye-slash', 'Players see Unlisted number') : '', r['Players can pick'] === 'no' && !isCorp(r) ? tagp('GM only', 'is-plain', '', 'Players cannot pick this one') : ''].join(''));
/** Someone at their organization already on this office, so this number can sit beside theirs. */
const wkMate = (p, r) => PEOPLE.find((x) => sameOrg(x, p) && x.id !== p.id && x.lines[0] && parse(x.lines[0].n).ex === r.Code && parse(x.lines[0].n).city === r['City code']);
function wkRoll(w) {
  const p = byId(w.pid), r = wkRow(w.path); if (!r) { w.sugg = []; return; }
  const mate = wkMate(p, r), out = [], planned = [];
  const add = (line, note) => { out.push({ line, note }); planned.push(keyOf2(numAt(r, line))); };
  if (mate) add(freeLine(r, parse(mate.lines[0].n).line, planned), 'Next to ' + mate.name + "'s line");
  while (out.length < 4) add(freeLine(r, null, planned), '');
  w.sugg = out; w.line = out[0].line; w.own = '';
}
/** Shortcuts from the contact's own details: this is how a Militech contact lands on the Militech office. */
function wkShortcuts(p) {
  const out = [], office = p.org && (officeRow(p.org, p.loc || homeRows()[0]?.City) || ROWS.find((r) => isCorp(r) && r.District === orgMatch(p.org).corp));
  if (office) out.push({ r: office, ic: 'fa-building', text: office.District + ', ' + office.City, tip: 'Their Organization says ' + p.org });
  const loc = rowForLoc(p.loc); if (loc && loc !== office) out.push({ r: loc, ic: 'fa-location-dot', text: p.loc, tip: 'Their Location says ' + p.loc });
  const m = p.aliasOf ? byId(p.aliasOf) : null; if (m?.lines[0]) { const home = homeDistricts().find((d) => d.Code !== parse(m.lines[0].n).ex); if (home) out.push({ r: home, ic: 'fa-mask', text: 'Away from ' + m.name, tip: 'Keeps the alias off the main identity\'s district, so the numbers do not link them' }); }
  return out;
}
function walkHtml(p) {
  const w = S.walk, row = wkRow(w.path), i = WK.findIndex((x) => x.key === w.level), step = i >= 0 ? WK[i] : null;
  const pr = w.start;
  const trail = `<nav class="ncm-wk-trail" aria-label="Where this number comes from">${WK.map((x, n) => { const here = w.level === x.key, r0 = wkRows(w.path, n + 1)[0], val = r0 ? (x.name(r0) || x.blank || '—') : '—'; return `<button type="button" class="${here ? 'on' : ''}" data-do="wkLevel" data-k="${x.key}" data-tooltip="Change the ${tipText(x.label.toLowerCase())}"><small>${x.label}</small>${esc(here ? 'Choosing…' : val)}</button>`; }).join('')}</nav>`;
  let body;
  if (step) {
    const seen = new Map(); for (const r of wkRows(w.path, i)) { const v = r[step.col] || ''; if (!seen.has(v)) seen.set(v, r); }
    const q = (w.q || '').trim().toLowerCase();
    const hit = wkShortcuts(p).map((c) => c.r);
    const opts = [...seen.entries()].map(([v, r]) => ({ v, r, name: step.name(r) || step.blank || v, rec: hit.some((h) => (h[step.col] || '') === v && WK.slice(0, i).every((y) => (h[y.col] || '') === w.path[y.key])) })).filter((o) => !q || (o.name + ' ' + o.v).toLowerCase().includes(q)).sort((a, b) => Number(b.rec) - Number(a.rec));
    body = `<div class="ncm-wk-q"><b>Step ${i + 1} of 5.</b> ${esc(step.ask)}<span class="grow"></span>${i ? btn('Back', 'fa-arrow-left', 'Go back one step', `data-do="wkLevel" data-k="${WK[i - 1].key}"`) : ''}</div>${seen.size > 8 ? `<label class="ncm-pn-srch" data-tooltip="Search this step"><i class="fas fa-magnifying-glass"></i><input type="text" id="wk-q" data-in="wkQ" value="${esc(w.q || '')}" placeholder="Search" aria-label="Search this step"></label>` : ''}<div class="ncm-wk-opts${step.key === 'code' ? ' is-rows' : ''}" data-sc="wko">${opts.map((o) => `<button type="button" class="${o.rec ? 'is-rec' : ''}" data-do="wkPick" data-v="${esc(o.v)}" data-tooltip="${tipText(o.rec ? 'Fits their details' : step.ask)}">${o.rec ? '<i class="fas fa-star" aria-hidden="true"></i>' : ''}<span class="grow">${esc(o.name)}</span>${step.key === 'rc' ? `<small>+${esc(o.v)}</small>` : step.key === 'city' || (step.key === 'code' && o.v) ? `<small>${esc(o.v)}</small>` : ''}${step.key === 'code' ? wkTag(o.r) : ''}</button>`).join('') || '<small>Nothing matches.</small>'}</div>`;
  } else if (row) {
    const typed = /^\d{4}$/.test(w.own || ''), line = typed ? w.own : w.line, n = numAt(row, line), q = parse(n), clash = typed && isTaken(q.key);
    const office = p.org && officeRow(p.org, p.loc || homeRows()[0]?.City);
    const off = office && (office.Code !== row.Code || office['City code'] !== row['City code']);
    const m = p.aliasOf ? byId(p.aliasOf) : null, sameAsMain = m?.lines[0] && parse(m.lines[0].n).ex === row.Code && row.Code;
    const seenName = isCorp(row) ? p.name + ', ' + (p.org || row.District) : row.Listed === 'no' ? 'Unlisted number' : 'The number, unless they have this contact saved';
    body = `<div class="ncm-wk-q"><b>Pick a number from ${esc(row.District || row.City)}.</b><span class="grow"></span>${btn('Try others', 'fa-dice', 'Four more free lines from here', 'data-do="wkRoll"')}</div>
      <div class="ncm-wk-nums">${w.sugg.map((x) => `<button type="button" class="${!typed && x.line === w.line ? 'on' : ''}" data-do="wkLine" data-v="${x.line}" data-tooltip="Pick ${tipText(seenFrom(parse(numAt(row, x.line))))}${tipText(x.note ? '. ' + x.note : '')}">${pnum(numAt(row, x.line))}${x.note ? `<small>${esc(x.note)}</small>` : ''}</button>`).join('')}</div>
      <label class="ncm-pn-f" data-tooltip="Four digits. It says if they are taken">Or choose the digits<input type="text" id="wk-own" data-in="wkOwn" inputmode="numeric" maxlength="4" value="${esc(w.own || '')}" placeholder="4471" autocomplete="off" style="width:90px"></label>
      ${clash ? '<div class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span>That number is taken or retired. Pick another.</span></div>' : ''}
      <div class="ncm-wk-res">${pnum(n)}<small>${esc(placeOf(q))}. From ${esc(homeRows()[0]?.City || 'home')}, people dial ${esc(seenFrom(q))}. From far away, ${esc(fullForm(q))}.</small><small><b>Line type:</b> ${isCorp(row) ? 'Corporate' : 'Standard'}. <b>On a call, players see:</b> ${esc(seenName)}.</small></div>
      ${off ? `<div class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span>Works at ${esc(p.org)}, whose ${esc(office.City)} office is ${esc(office.Code)}. Fine if this is a personal line.</span>${btn('Use their office', 'fa-building', 'Move this number to their office', `data-do="wkJump" data-key="${esc(rowKey2(office))}"`)}</div>` : ''}
      ${sameAsMain ? `<div class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span>This is the same district as ${esc(m.name)}. It could link the alias to them.</span></div>` : ''}`;
  } else body = '<small>Pick a place above.</small>';
  const cuts = wkShortcuts(p);
  return `<div class="ncm-pn-form ncm-wk"><h4><i class="fas fa-route"></i> A number for ${esc(p.name)}</h4><p class="ncm-wk-lede">The same steps your players use. It starts from their details, and you can change any step.</p>
    <div class="ncm-pn-why">${srcChip(pr)}<span class="ncm-pn-note">${esc(pr.why)}</span></div>
    ${orgNote(p)}
    ${cuts.length ? `<div class="ncm-wk-cuts"><small>From their details</small>${cuts.map((c) => `<button type="button" class="${rowKey2(c.r) === (row && rowKey2(row)) ? 'on' : ''}" data-do="wkJump" data-key="${esc(rowKey2(c.r))}" data-tooltip="${tipText(c.tip)}"><i class="fas ${c.ic}"></i> ${esc(c.text)}</button>`).join('')}</div>` : ''}
    ${trail}${body}
    <div class="ncm-pn-acts"><span class="grow"></span>${btn('Cancel', '', 'Give nothing', 'data-do="wkCancel"')}${btn(w.target === 'give' ? 'Give this number' : 'Use this number', 'fa-check', 'Save it', `data-do="wkUse" ${!step && row && !(/^\d{4}$/.test(w.own || '') && isTaken(parse(numAt(row, w.own)).key)) ? '' : 'disabled'}`, 'pri')}</div></div>`;
}
const rowKey2 = (r) => [r['Region code'], r['City code'], r.Code || '-'].join('/');
function openWalk(p, target, extra = {}) { const pr = suggest(p); const r = rowOfNum(parse(pr.n)); const w = { pid: p.id, target, path: wkPathOf(r), level: null, q: '', own: '', start: pr, ...extra }; wkRoll(w); S.walk = w; S.sel = p.id; }
function propCard(p) {
  const pr = S.prop[p.id] ??= suggest(p);
  const q = parse(pr.n);
  return `<div class="ncm-pn-prop"><div class="ncm-pn-line__top">${pnum(pr.n)}<span class="grow"></span>${btn('Try another', 'fa-dice', 'Another free line in the same place', `data-do="reroll" data-id="${p.id}"`)}</div>
    <div class="ncm-pn-why">${srcChip(pr)}<span class="ncm-pn-note">${esc(pr.why)}</span></div>
    ${orgNote(p)}
    <div class="ncm-pn-fr">${btn('Walk through it', 'fa-route', 'The same steps your players use: region, state, city, area, district, number', `data-do="walk" data-id="${p.id}"`)}<span class="grow"></span>${btn('Use this', 'fa-check', 'Give them this number', `data-do="useProp" data-id="${p.id}"`, 'pri')}</div>
  </div>`;
}
function changeForm(p, l, i) {
  const c = S.change, cand = c.typed ? parse(c.typed) : null;
  let st = '';
  if (c.typed) {
    if (!cand.done) st = `<small>${esc(cand.hint || 'Keep typing: district, then four digits.')}</small>`;
    else if (isRetired(cand.key)) st = `<div class="ncm-pn-check"><i class="fas fa-box-archive"></i><span>Retired number. Release it from the Retired tab first if you really want it back.</span></div>`;
    else if (holderOf(cand.key)) st = `<div class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span>${esc(holderOf(cand.key).p.name)} already has this.</span></div>`;
    else st = `<div class="ncm-pn-check info"><i class="fas fa-check"></i><span>${esc(placeOf(cand))}. Free.</span></div>`;
  }
  const usable = c.typed ? (cand.done && !isRetired(cand.key) && !holderOf(cand.key)) : true;
  const n = c.typed && usable ? fullForm(cand) : c.prop.n;
  return `<div class="ncm-pn-form"><h4><i class="fas fa-pen"></i> Change ${esc(fullForm(parse(l.n)))}</h4>
    ${c.typed ? '' : propInline(p, c)}
    <div class="ncm-pn-fr">${btn('Walk through it', 'fa-route', 'The same steps your players use', `data-do="walk" data-id="${p.id}" data-target="change"`)}</div>
    <label class="ncm-pn-f" data-tooltip="Or type the exact number you want">Or type one<input type="text" id="chg-typed" data-in="chgTyped" value="${esc(c.typed || '')}" placeholder="WAT-1234 or +14 DAL CEN-1234" autocomplete="off" spellcheck="false"></label>${st}
    <div class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span>${l.holders.length ? `${l.holders.map((h) => byId(h).name).join(', ')} ${l.holders.length === 1 ? 'has' : 'have'} the old number saved. It will say "not in service" for them.` : 'Nobody has the old number saved.'} The old number retires and is never handed out again.</span></div>
    ${l.holders.length ? `<label class="ncm-pn-chk" data-tooltip="Their saved contact updates to the new number, and they are told"><input type="checkbox" id="chg-push"${c.push ? ' checked' : ''} data-ch="chgPush"><span>Send the new number to ${l.holders.length === 1 ? 'them' : 'all ' + l.holders.length}</span></label>` : ''}
    <div class="ncm-pn-acts">${btn('Change to ' + seenFrom(parse(n)), 'fa-check', usable ? 'Retire the old number and use this one' : 'Pick a number that is free', `data-do="chgGo" ${usable ? '' : 'disabled'}`, 'pri')}${btn('Cancel', '', 'Keep the number as it is', 'data-do="chgCancel"')}</div>
  </div>`;
}
const propInline = (p, c) => `<div class="ncm-pn-line__top">${pnum(c.prop.n)}<span class="grow"></span>${btn('Try another', 'fa-dice', 'Another free line in the same place', 'data-do="chgReroll"')}</div><div class="ncm-pn-why"><i class="fas fa-lightbulb"></i><span>${esc(c.prop.why)}</span></div>`;
function addLineForm(p) {
  const a = S.addLine;
  if (!a || a.pid !== p.id) return p.kind === 'pc' || p.lines.length ? `<div class="ncm-pn-acts">${btn('Add a line', 'fa-plus', 'Give this identity another number: an extra line, a burner or a business', `data-do="addLine" data-id="${p.id}"`)}</div>` : '';
  return `<div class="ncm-pn-form"><h4><i class="fas fa-plus"></i> Add a line</h4>
    <div class="ncm-pn-fr"><div class="ncm-pn-seg" role="group" aria-label="Kind of line"><button type="button" class="${a.kind === 'extra' ? 'on' : ''}" data-do="addKind" data-k="extra" data-tooltip="A second number with its own label, like an old number they kept">Extra line</button><button type="button" class="${a.kind === 'burner' ? 'on' : ''}" data-do="addKind" data-k="burner" data-tooltip="A throwaway. Burned, it retires for good">Burner</button><button type="button" class="${a.kind === 'biz' ? 'on' : ''}" data-do="addKind" data-k="biz" data-tooltip="A shop, club or office. Whoever they call sees the business name, not the person">Business</button></div>
    <label class="ncm-pn-f" data-tooltip="${tipText(a.kind === 'biz' ? 'What people see when this line calls them, and what a Trace finds' : 'A name only the holder sees on their line list')}">${a.kind === 'biz' ? 'Business name' : 'Label'}<input type="text" id="add-label" data-in="addLabel" maxlength="24" value="${esc(a.label)}" placeholder="${a.kind === 'biz' ? 'Name of the business' : 'Work line'}"></label></div>
    <div class="ncm-pn-line__top">${pnum(a.n)}<span class="grow"></span>${btn('Walk through it', 'fa-route', 'The same steps your players use', `data-do="walk" data-id="${p.id}" data-target="add"`)}${btn('Try another', 'fa-dice', 'Another free line', 'data-do="addReroll"')}</div>
    <div class="ncm-pn-acts">${btn('Add it', 'fa-check', 'Add this line', 'data-do="addGo"', 'pri')}${btn('Cancel', '', 'Add nothing', 'data-do="addCancel"')}</div></div>`;
}
function detail(p) {
  if (!p) return '<div class="ncm-ph2-none">Pick someone on the left.</div>';
  if (!ROWS.some((r) => r.Status !== 'dead')) return '<div class="ncm-ph2-none">The place table is empty, so there are no numbers to give. Add a place in Number setup.</div>';
  if (S.walk?.pid === p.id) return walkHtml(p);
  const m = p.aliasOf ? byId(p.aliasOf) : null;
  return `<div class="ncm-pn-dh">${face(p, 'lg')}<div style="min-width:0"><h3>${esc(p.name)}</h3><div class="tags">${p.kind === 'pc' ? tagp('Played by ' + p.player, 'is-plain', 'fa-user') : ''}${p.role ? hue(p.role, null, 'Role') : ''}${p.org ? hue(p.org, 'fa-building', 'Organization') : ''}${p.loc ? hue(p.loc, 'fa-location-dot', 'Location, from their contact details') : ''}${m ? tagp('Alias of ' + m.name, 'is-secret', 'fa-mask', 'Only you can see this. Players who hold this line never learn it') : ''}</div></div></div>
    ${p.lines.length ? `<div class="ncm-pn-seclab"><i class="fas fa-sim-card"></i> ${p.lines.length === 1 ? 'Its line' : p.lines.length + ' lines'}</div>` : ''}${p.lines.map((l, i) => lineCard(p, l, i)).join('')}
    ${p.lines.length ? '' : (p.kind === 'pc' ? `<div class="ncm-pn-check info"><i class="fas fa-circle-info"></i><span>${esc(p.player)} can pick their own in the Calls tab. Or give them one now.</span></div>` : '') + propCard(p)}
    ${addLineForm(p)}`;
}
function viewNumbers() {
  const rows = PEOPLE.filter((p) => passesShow(p) && matchesQ(p));
  const need = needList().length;
  const flagged = PEOPLE.filter((p) => p.lines.some((l) => flagsOf(p, l).some((f) => f.tone === 'warn'))).length;
  return `<header class="ncm-tabhd"><i class="fas fa-sim-card"></i><div><h2>Numbers</h2><p>Every number in the world, who holds it, and why it was picked.</p></div></header>${numbersTabs()}
    ${undoLine()}
    ${need || REQUESTS.length || flagged ? `<div class="ncm-pn-needs"><span class="lbl">Needs you</span>${need ? `<button type="button" data-do="frame" data-f="bulk" data-tooltip="Numbers are proposed from each contact's details. You review them before anything is saved"><b>${need}</b> without a number</button>` : ''}${REQUESTS.length ? `<button type="button" data-do="frame" data-f="requests" data-tooltip="What players asked you to approve"><b>${REQUESTS.length}</b> request${REQUESTS.length === 1 ? '' : 's'}</button>` : ''}${flagged ? `<button type="button" data-do="showFlag" data-tooltip="Show only the ones worth a look"><b>${flagged}</b> to check</button>` : ''}</div>` : ''}
    <div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Search names, roles, organizations, places, numbers and labels"><i class="fas fa-magnifying-glass"></i><input type="text" id="n-q" data-in="q" value="${esc(S.q)}" placeholder="Name or number" aria-label="Search"></label>
      <label class="ncm-pn-sel" data-tooltip="Narrow the list"><span>Show</span><select id="n-show" data-ch="show">${[['all', 'Everyone'], ['none', 'No number'], ['pc', 'Players'], ['npc', 'NPCs'], ['alias', 'Aliases'], ['extra', 'Extra lines and burners'], ['off', 'Switched off'], ['flag', 'Something to check']].map(([k, t]) => opt(k, t, S.show === k)).join('')}</select></label>
      <label class="ncm-pn-sel" data-tooltip="How the list is grouped"><span>Group</span><select id="n-group" data-ch="group">${[['kind', 'Players, NPCs'], ['org', 'Organization'], ['district', 'District'], ['none', 'None']].map(([k, t]) => opt(k, t, S.group === k)).join('')}</select></label>
      
      ${btn('', 'fa-file-export', 'Export every assigned number as a CSV', 'data-do="csvAssigned"', 'ic')}</div>
    <div class="ncm-pn-split"><div class="ncm-pn-list" data-sc="plist">${groupsOf(rows).map(([g, list]) => { const shut = S.shut.has(g); return `<button type="button" class="ncm-pn-gh${shut ? ' is-shut' : ''}" style="--sk:${g === 'Players' ? 'var(--ncm-act)' : g === 'NPCs' ? 'var(--ncm-hue-5)' : g === 'No number' || g === 'No organization' ? 'var(--ncm-attn)' : hueOf(g)}" data-do="fold" data-k="${esc(g)}" aria-expanded="${!shut}" data-tooltip="${tipText(shut ? 'Open' : 'Fold')} this group"><i class="fas fa-chevron-down ch"></i><i class="fas ${g === 'Players' ? 'fa-user' : g === 'NPCs' ? 'fa-masks-theater' : S.group === 'org' ? 'fa-building' : S.group === 'district' ? 'fa-location-dot' : 'fa-users'} gi"></i>${esc(g)}<span class="grow"></span><span class="ncm-pn-count">${list.length}</span></button>${shut ? '' : list.map(peopleRow).join('')}`; }).join('') || '<div class="ncm-ph2-none">Nobody matches.</div>'}</div>
      <div class="ncm-pn-detail" data-sc="pdetail">${detail(byId(S.sel))}</div></div>`;
}
function bulkPlan() {
  if (S.bulk) return S.bulk;
  if (!ROWS.some((r) => r.Status !== 'dead')) return (S.bulk = {});
  const plan = {};
  const list = needList().filter((p) => S.bulkAll || p.kind === 'npc').sort((a, b) => Number(!!a.aliasOf) - Number(!!b.aliasOf));
  for (const p of list) plan[p.id] = suggest(p, plan);
  return (S.bulk = plan);
}
function viewBulk() {
  const plan = bulkPlan(); const ids = Object.keys(plan);
  const on = ids.filter((id) => !S.bulkOff.has(id));
  const dead = needList().filter((p) => p.kind === 'pc');
  return `<header class="ncm-tabhd"><i class="fas fa-wand-magic-sparkles"></i><div><h2>Give numbers</h2><p>Proposed from each contact's details. Nothing is saved until you press Give.</p></div></header>
    <div class="ncm-pn-tb">${btn('Back to People', 'fa-arrow-left', 'Back without giving anything', 'data-do="frame" data-f="numbers"')}${dead.length ? `<label class="ncm-pn-chk" data-tooltip="Players can pick their own in the Calls tab, so they are left out unless you say"><input type="checkbox" id="bulk-all"${S.bulkAll ? ' checked' : ''} data-ch="bulkAll"><span>Include players (${dead.length})</span></label>` : ''}<span class="grow"></span>${btn('Roll them all again', 'fa-dice', 'New lines for everyone on this list. Places stay based on their details', 'data-do="bulkRoll"')}${btn('Give ' + on.length + ' number' + (on.length === 1 ? '' : 's'), 'fa-check', 'Save every ticked row. You can undo straight after', `data-do="bulkGo" ${on.length ? '' : 'disabled'}`, 'pri')}</div>
    <div class="ncm-pn-bsum">${(() => { const c = {}; ids.forEach((id) => { const k = plan[id].src; c[k] = (c[k] || 0) + 1; }); const missed = ids.filter((id) => ['guess', 'miss'].includes(orgMatch(byId(id).org).state)).length; return Object.entries(c).map(([k, n]) => `<span>${srcChip({ src: k })} <b>${n}</b></span>`).join('') + (missed ? `<span class="ncm-wk-orgmiss" data-tooltip="Their Organization did not lead to an office"><i class="fas fa-triangle-exclamation"></i> <b>${missed}</b> to check</span>` : ''); })()}</div>
    <div class="ncm-pn-bulk" data-sc="bulk">${ids.map((id) => { const p = byId(id), pr = plan[id], off = S.bulkOff.has(id); const q = parse(pr.n); const opts = homeRows().filter((r) => r.Code && (!isCorp(r) || orgMatch(p.org).corp === r.District)); return `<div class="ncm-pn-brow${off ? ' off' : ''}"><label data-tooltip="Untick to leave them without a number for now"><input type="checkbox" id="bk-${id}" data-ch="bulkTick" data-id="${id}" aria-label="Give ${esc(p.name)} this number"${off ? '' : ' checked'}></label>${face(p)}<div class="who"><b>${esc(p.name)}</b><span class="mt">${p.aliasOf ? tagp('Alias of ' + byId(p.aliasOf).name, 'is-secret', 'fa-mask') : ''}${hv(p.role)}${hv(p.org, 'fa-building')}${hv(p.loc, 'fa-location-dot')}</span></div><div class="num"><span class="top">${pnum(pr.n)}${srcChip(pr)}</span><small class="ncm-pn-note">${esc(pr.why)}</small>${['guess', 'miss'].includes(orgMatch(p.org).state) ? `<small class="ncm-wk-orgmiss"><i class="fas fa-triangle-exclamation"></i> Organization says ${esc(p.org)}, and no office matches.${orgMatch(p.org).guess ? ' Did you mean ' + esc(orgMatch(p.org).guess) + '?' : ''} Use the walkthrough to fix it.</small>` : ''}</div><div class="bt">${btn('', 'fa-route', 'Walk through it: the same steps your players use', `data-do="walk" data-id="${id}" data-target="bulk"`, 'ic')}${btn('', 'fa-location-dot', 'Quick move to another district here', `data-do="bulkMove" data-id="${id}" aria-expanded="${S.bulkMove === id}"`, 'ic')}${btn('', 'fa-dice', 'Another free line in the same place', `data-do="bulkOne" data-id="${id}"`, 'ic')}</div>${S.allOpen || S.bulkMove === id ? `<div class="mv"><select id="bd-${id}" data-ch="bulkDist" data-id="${id}" aria-label="District for ${esc(p.name)}" data-tooltip="Put them somewhere else">${opts.map((r) => opt(r['City code'] + '/' + r.Code, r.Code + ' ' + r.District, q.ex === r.Code && q.city === r['City code'])).join('')}${opts.some((r) => r.Code === q.ex && q.city === r['City code']) ? '' : opt('', (q.ex || q.city) + ' (elsewhere)', true)}</select></div>` : ''}</div>`; }).join('') || '<div class="ncm-ph2-none">Everyone on this list has a number.</div>'}</div>`;
}
const peopleOn = (rc, city, code) => allLines().filter(({ l }) => { const q = parse(l.n); return q.rc === rc && q.city === city && (q.ex || '') === (code || ''); });
function viewBoard() {
  const [rc, city] = S.boardCity.split(':');
  const rows = ROWS.filter((r) => r['Region code'] === rc && r['City code'] === city);
  const areas = uniq(rows.map((r) => r.Area || (isCorp(r) ? 'Offices' : 'The city')));
  const q = S.boardQ.trim().toLowerCase();
  const cities = uniq(ROWS.map((r) => r['Region code'] + ':' + r['City code'])).filter((c) => { const [a, b] = c.split(':'); return (a === HOME.rc && b === HOME.city) || allLines().some(({ l }) => { const p = parse(l.n); return p.rc === a && p.city === b; }); });
  const armed = S.dock ? byId(S.dock) : null;
  const open = S.tile ? rows.find((r) => (r.Code || '-') === S.tile) : null;
  const need = needList();
  const forced = !!q || !!armed;
  return `<header class="ncm-tabhd"><i class="fas fa-table-cells"></i><div><h2>Districts</h2><p>Who is on what. Pick someone without a number, then click where they belong.</p></div></header>${numbersTabs()}${undoLine()}
    <div class="ncm-pn-tb"><label class="ncm-pn-sel" data-tooltip="Cities with numbers in use, and your home city"><span>City</span><select id="b-city" data-ch="boardCity">${cities.map((c) => { const [a, b] = c.split(':'); const r = ROWS.find((x) => x['Region code'] === a && x['City code'] === b); return opt(c, r.City, c === S.boardCity); }).join('')}</select></label>
      <label class="ncm-pn-srch" data-tooltip="Lights up the districts that hold this person or number"><i class="fas fa-magnifying-glass"></i><input type="text" id="b-q" data-in="boardQ" value="${esc(S.boardQ)}" placeholder="Find a person or number" aria-label="Find a person or number"></label>${btn('', 'fa-angles-down', 'Open every area', 'data-do="areaAll" data-v="open"', 'ic')}${btn('', 'fa-angles-up', 'Fold every area', 'data-do="areaAll" data-v="shut"', 'ic')}</div>
    ${armed ? `<div class="ncm-pn-need"><i class="fas fa-hand-pointer"></i><span class="grow">Click a district for <b>${esc(armed.name)}</b>.</span>${btn('Cancel', '', 'Stop placing them', 'data-do="dockOff"')}</div>` : ''}
    <div class="ncm-pn-board"><div class="ncm-pn-scroll" data-sc="board" style="gap:0">
      ${open ? tray(open, rc, city) : ''}
      ${areas.map((a, ai) => { const inArea = rows.filter((r) => (r.Area || (isCorp(r) ? 'Offices' : 'The city')) === a); const inUse = inArea.flatMap((r) => peopleOn(rc, city, r.Code)); const k = S.boardCity + '|' + a; const shut = !forced && (S.areaShut.has(k) || (!S.areaOpen.has(k) && ai !== 0)); return `<div class="ncm-pn-area${shut ? ' is-shut' : ''}" style="--tc:${hueOf(a)}"><button type="button" class="ncm-pn-areah" data-do="areaFold" data-k="${esc(k)}" aria-expanded="${!shut}" data-tooltip="${tipText(forced ? 'Open while you search or place someone' : 'Fold or open ' + esc(a))}"${forced ? ' data-forced="1"' : ''}><i class="fas fa-chevron-down ch"></i><i class="fas fa-map-pin"></i> ${esc(a)}<span class="grow"></span><span class="sumf">${inUse.slice(0, 5).map(({ p }) => face(p)).join('')}</span><span class="ncm-pn-more">${inArea.length}</span><small>${inArea.length === 1 ? 'place' : 'places'} · ${inUse.length} in use</small></button><div class="ncm-pn-area__b"${shut ? ' inert' : ''}><div class="in"><div class="ncm-pn-tiles">${rows.filter((r) => (r.Area || (isCorp(r) ? 'Offices' : 'The city')) === a).map((r) => { const on = peopleOn(rc, city, r.Code); const hit = q && on.some(({ p, l }) => p.name.toLowerCase().includes(q) || l.n.toLowerCase().replace(/[\s-]/g, '').includes(q.replace(/[\s-]/g, ''))); const lab = r.Code || r['City code']; return `<button type="button" class="ncm-pn-tile${(r.Code || '-') === S.tile || hit ? ' on' : ''}${armed ? ' is-target' : ''}${r.Status === 'dead' ? ' is-dead' : ''}${on.length ? ' has-people' : ''}" data-do="tile" data-k="${esc(r.Code || '-')}" data-tooltip="${tipText((r.District || r.City) + '. ' + (r.Status === 'dead' ? 'Marked dead. ' : '') + (r['Players can pick'] === 'yes' ? 'Players can pick it. ' : 'GM only. ') + (r.Listed === 'no' ? 'Hidden from the directory. ' : '') + on.length + ' of 10,000 lines in use.')}"><span class="code">${esc(lab)}${r['Players can pick'] === 'no' ? '<i class="fas fa-lock is-gm" aria-label="GM only"></i>' : ''}${r.Listed === 'no' ? '<i class="fas fa-eye-slash is-gm" aria-label="Hidden"></i>' : ''}${r.Status === 'dead' ? '<i class="fas fa-skull is-dead" aria-label="Dead"></i>' : ''}</span><span class="name">${esc(r.District || r.City)}</span><span class="faces">${on.slice(0, 4).map(({ p }) => face(p)).join('')}${on.length > 4 ? `<small>+${on.length - 4}</small>` : ''}${on.length ? `<span class="ncm-pn-more" style="margin-left:auto">${on.length}</span>` : '<small class="ncm-pn-empty">empty</small>'}</span></button>`; }).join('')}</div></div></div></div>`; }).join('')}
    </div>
    <div class="ncm-pn-dock"><div class="ncm-pn-mh" data-tooltip="Identities without a number. Pick one, then click a district"><i class="fas fa-user-plus"></i> No number <span class="ncm-pn-count${need.length ? ' hot' : ''}">${need.length}</span></div><div class="ncm-pn-dock__l" data-sc="dock">${need.map((p) => `<button type="button" class="ncm-pn-dockp${S.dock === p.id ? ' on' : ''}" data-do="dock" data-id="${p.id}" data-tooltip="Place ${tipText(p.name)}: pick a district next">${face(p)}<span style="min-width:0">${esc(p.name)}<span class="mt">${p.aliasOf ? tagp('alias', 'is-secret') : hv(p.org || p.role)}</span></span></button>`).join('') || '<div class="ncm-ph2-none">Everyone has one.</div>'}</div></div></div>`;
}
function tray(r, rc, city) {
  const on = peopleOn(rc, city, r.Code);
  const code = r.Code || '-';
  const retired = RET.filter((x) => { const q = parse(x.n); return q.rc === rc && q.city === city && (q.ex || '-') === code; }).length;
  return `<div class="ncm-pn-tray"><div class="ncm-pn-trayh"><span class="ncm-pnum is-plain"><span class="x">${esc(r.Code || r['City code'])}</span></span><b>${esc(r.District || r.City)}</b><span class="ncm-pn-more">${on.length}</span><small>of 10,000 in use</small>${retired ? tagp(retired + ' retired', 'is-plain', 'fa-box-archive') : ''}<span class="grow"></span>
      <label class="ncm-pn-chk" data-tooltip="Players can pick numbers here"><input type="checkbox" id="tr-pick" data-ch="trPick" data-k="${esc(code)}"${r['Players can pick'] === 'yes' ? ' checked' : ''}><span>Pickable</span></label>
      <label class="ncm-pn-chk" data-tooltip="Untick to keep this out of the directory. The numbers still work, and read as Unlisted number"><input type="checkbox" id="tr-list" data-ch="trList" data-k="${esc(code)}"${r.Listed === 'yes' ? ' checked' : ''}><span>Listed</span></label>
      <button type="button" data-do="tile" data-k="${esc(code)}" aria-label="Close" data-tooltip="Close"><i class="fas fa-xmark"></i></button></div>
    ${on.map(({ p, l }) => `<div class="ncm-pn-tray__row">${face(p)}<span><b>${esc(p.name)}</b>${l.label ? ' ' + hv(l.label) : ''}</span><span style="display:flex;align-items:center;gap:6px">${l.kind !== 'main' ? tagp(kindTag[l.kind][0], kindTag[l.kind][1], kindTag[l.kind][2]) : ''}${pnum(l.n)}${btn('', 'fa-arrow-right', 'Open ' + p.name + ' in People', `data-do="openPerson" data-id="${p.id}"`, 'ic')}</span></div>`).join('') || '<small>Nobody has a number here yet.</small>'}</div>`;
}
function viewRequests() {
  return `<header class="ncm-tabhd"><i class="fas fa-inbox"></i><div><h2>Requests</h2><p>What players asked for. Nothing changes until you answer.</p></div></header>${numbersTabs()}${undoLine()}
    <div class="ncm-pn-scroll" data-sc="req"><section class="ncm-pn-mod">${REQUESTS.map((r) => { const p = byId(r.pid); const old = p.lines[0]; return `<div class="ncm-pn-row">${face(p)}<div class="tx"><div class="ncm-pn-rqh"><b>${esc(p.name)}</b>${r.type === 'change' ? tagp('Number change', 'is-attn', 'fa-pen') : tagp('Over their line limit', 'is-attn', 'fa-layer-group')}</div><div>${esc(r.say)}</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px">${r.type === 'change' ? `<span class="ncm-pn-oldnum">${esc(seenFrom(parse(old?.n)))}</span><i class="fas fa-arrow-right" style="font-size:10px;color:var(--ncm-act)"></i>` : tagp(kindTag[r.kind][0], kindTag[r.kind][1], kindTag[r.kind][2])}${pnum(r.to)}</div>${r.type === 'change' && old?.holders.length ? `<small class="ncm-pn-conseq"><i class="fas fa-triangle-exclamation"></i> ${old.holders.length} ${old.holders.length === 1 ? 'person has' : 'people have'} the old number saved. It retires if you approve.</small>` : ''}</div>${btn('Approve', 'fa-check', r.type === 'change' ? 'Change it now. The old number retires' : 'Add this line', `data-do="reqYes" data-id="${r.id}"`, 'go')}${btn('Decline', 'fa-xmark', 'They keep what they have, and are told', `data-do="reqNo" data-id="${r.id}"`)}</div>`; }).join('') || '<div class="ncm-ph2-none">Nothing is waiting.</div>'}</section>
      <section class="ncm-pn-mod"><button type="button" class="ncm-pn-band ncm-pn-qh" data-do="reqSee" aria-expanded="${S.reqSee || S.allOpen}" data-tooltip="What they read while they wait"><i class="fas fa-chevron-down ch${S.reqSee || S.allOpen ? '' : ' shut'}"></i><i class="fas fa-eye"></i> What the player sees meanwhile</button><div class="ncm-pn-mb"${S.reqSee || S.allOpen ? '' : ' hidden'}><div class="ncm-pn-ppl"><div class="ncm-pn-ph" style="--sk:var(--ncm-good)"><h5><i class="fas fa-circle"></i> You're online</h5><div>Waiting for your GM to approve the number they asked for. You keep your number until then.</div></div><div class="ncm-pn-ph" style="--sk:var(--ncm-attn)"><h5><i class="fas fa-moon"></i> No GM online</h5><div>Saved for your GM. They'll see it next time they're on.</div></div></div></div></section></div>`;
}
function viewRetired() {
  const q = S.rq.trim().toLowerCase();
  const list = RET.filter((r) => !q || (r.n + r.was + r.why).toLowerCase().includes(q));
  return `<header class="ncm-tabhd"><i class="fas fa-box-archive"></i><div><h2>Retired</h2><p>Changed, burned or deleted numbers. The generator never hands these out, and no import can bring one back.</p></div></header>${numbersTabs()}${undoLine()}
    <div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Search numbers, who had them, and why they retired"><i class="fas fa-magnifying-glass"></i><input type="text" id="r-q" data-in="rq" value="${esc(S.rq)}" placeholder="Number or name" aria-label="Search retired numbers"></label>${btn('Export', 'fa-file-export', 'Download the retired list as a CSV', 'data-do="csvRetired"')}</div>
    <div class="ncm-pn-scroll" data-sc="ret"><section class="ncm-pn-mod">${list.map((r) => `<div class="ncm-pn-row">${pnum(r.n)}<div class="tx ncm-pn-retx"><b>${esc(r.was)}</b>${tagp(r.why, r.why === 'Burned' ? 'is-bad' : 'is-plain', r.why === 'Burned' ? 'fa-fire' : r.why === 'Contact deleted' ? 'fa-user-slash' : 'fa-pen')}${when(r.at)}</div>${S.relOpen === r.n ? `<div style="flex-basis:100%" class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span class="grow">Anyone who still has this saved would reach whoever gets it next.</span>${btn('Release it', 'fa-unlock', 'The generator can hand it out again', `data-do="relGo" data-n="${esc(r.n)}"`, 'bad')}${btn('Keep it retired', '', 'Leave it retired', 'data-do="relCancel"')}</div>` : btn('Release', 'fa-unlock', 'Let this number be handed out again', `data-do="relAsk" data-n="${esc(r.n)}"`)}</div>`).join('') || '<div class="ncm-ph2-none">No retired numbers match.</div>'}</section></div>`;
}
const LEARN = [
  ['Read a number', 'Click a part of the number. Every number in the game is built from these, and only the parts a caller needs are written.'],
  ['One number, written three ways', 'A number stays the same. What changes is how much a caller needs to dial, based on where the number they call from was issued.'],
  ['The table makes the numbers', 'Each row in Places is one district. Add a row and that district exists, the picker offers it, and the pad can dial it.'],
  ['You decide what players can do', 'Rules set the home city and what players can pick. Each rule says in plain words what it does to them.'],
  ['Hand out numbers three ways', 'Give one from a contact, Give numbers to everyone who has none, or place people on the Districts board.'],
];
const PARTS = { r: ['+72', 'Region', 'Which part of the world issued it. These codes are made up for this game, so none of them is a real dialling code.', 'r'], c: ['NC', 'City', 'The city. State and area exist in the table to help you find a place, but nobody dials them.', 'c'], x: ['WAT', 'District', 'The district, three letters. On the pad the letters are keys, so WAT dials 9-2-8.', 'x'], l: ['4471', 'Line', 'Four digits, 10,000 to a district. A number that retires is never reused.', 'l'] };
function learnStep() {
  const i = S.learn;
  if (i === 0) return `<div class="ncm-pn-anat">${Object.entries(PARTS).map(([k, [t, l, , c]]) => `<button type="button" class="ncm-pn-part${S.part === k ? ' on' : ''}" data-do="part" data-k="${k}" data-tooltip="${tipText(l)}"><code class="ncm-pnum" style="border:0;cursor:inherit"><span class="${c}">${esc(t)}</span></code><small>${esc(l)}</small></button>`).join('')}</div><p style="margin:0;text-align:center;font:14px var(--ncm-font-body);color:var(--ncm-text-primary)">${esc(PARTS[S.part][2])}</p>`;
  if (i === 1) return `<div class="ncm-pn-ppl">${[['Calling from Night City', 'WAT-4471'], ['Calling from Seattle (same region)', 'NC WAT-4471'], ['Calling from Dallas (another region)', '+72 NC WAT-4471']].map(([t, n]) => `<div class="ncm-pn-ph"><h5>${esc(t)}</h5><span class="ncm-pnum is-plain" style="font-size:17px">${n.replace(/^(\+\d+ )?(NC )?(WAT-)(\d+)$/, (_, a, b, c, d) => `${a ? `<span class="r">${a}</span>` : ''}${b ? `<span class="c">${b}</span>` : ''}<span class="x">${c}</span><span class="l">${d}</span>`)}</span></div>`).join('')}</div><p style="margin:0;font:13px var(--ncm-font-body);color:var(--ncm-text-primary)">"From" means where the caller's own number was issued. Someone who keeps a D.C. number in Night City still dials like someone in D.C. Numbers never say where a person is now.</p>`;
  if (i === 2) { const r = ROWS.find((x) => x.Code === 'WAT') || ROWS.find((x) => x.Code) || { 'Region code': '72', Region: 'Pacifica Confederation', 'City code': 'NC', City: 'Night City', Area: 'Watson', Code: 'WAT', District: 'Watson' }; return `<div class="ncm-pn-tw" style="min-height:0;flex:none"><table><thead><tr>${['Region code', 'Region', 'City code', 'City', 'Area', 'Code', 'District'].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody><tr>${['Region code', 'Region', 'City code', 'City', 'Area', 'Code', 'District'].map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr></tbody></table></div><p style="margin:0;font:13px var(--ncm-font-body);color:var(--ncm-text-primary)">That row gives ${pnum('+72 NC WAT-4471')}. A city with no districts in the table dials as ${pnum('+90 PAL-0316')}. Export the table, edit it in a spreadsheet, and bring it back; you see every change before it applies.</p><div class="ncm-pn-acts">${btn('Open Places', 'fa-table', 'Go to the table', 'data-do="frame" data-f="places"')}</div>`; }
  if (i === 3) return `<ul style="margin:0;padding-left:18px;font:13px/1.5 var(--ncm-font-body);color:var(--ncm-text-primary)"><li>${esc(sentence('home'))}</li><li>${esc(sentence('scope'))}</li><li>${esc(sentence('own'))}</li><li>${esc(sentence('appr'))}</li><li>${esc(sentence('extra'))}</li><li>Special numbers break every rule above on purpose: hidden lines, hotlines, anything you want.</li></ul><div class="ncm-pn-acts">${btn('Open Rules', 'fa-sliders', 'Go to the rules', 'data-do="frame" data-f="rules"')}</div>`;
  return `<div class="ncm-pn-ppl"><div class="ncm-pn-ph" style="--sk:var(--ncm-hue-3)"><h5><i class="fas fa-user"></i> One person</h5><div>In People, or on a contact's form. It proposes a number from their details and says why.</div>${btn('Open People', 'fa-users', 'Go to People', 'data-do="frame" data-f="numbers"')}</div><div class="ncm-pn-ph" style="--sk:var(--ncm-attn)"><h5><i class="fas fa-users"></i> Everyone without one</h5><div>A list you review, with one click to undo after.</div>${btn('Give numbers', 'fa-wand-magic-sparkles', 'Go to the review list', 'data-do="frame" data-f="bulk"')}</div><div class="ncm-pn-ph" style="--sk:var(--ncm-hue-5)"><h5><i class="fas fa-table-cells"></i> By hand, on the board</h5><div>Pick a person, click a district. See who is where.</div>${btn('Open Districts', 'fa-table-cells', 'Go to the board', 'data-do="frame" data-f="board"')}</div></div>`;
}
/** What a number tells the GM, and what it tells a chosen character. The same one rule the player's dial box uses. */
function tryResult() {
  const p = parse(S.tryN);
  if (!byId(S.tryAs)) S.tryAs = PCS()[0]?.id || '';
  if (p.empty) return { gm: '<small>Type a number above.</small>', pl: '<small>Type a number above.</small>' };
  if (p.service) {
    const x = specialOf(p.service), lets = x.who === 'all' || x.allow.includes(S.tryAs);
    return { gm: [`<b>${esc(x.num)}</b>: a special number${x.name ? ', ' + esc(x.name) : ''}.`, esc(SP_ACT[x.act][1]), x.seen === 'hidden' ? 'Hidden: nothing hints at it until the whole number is typed.' : 'Listed in the directory.', x.who === 'all' ? 'Anyone gets through.' : 'Gets through: ' + esc(x.allow.map((a) => byId(a).name).join(', ') || 'nobody') + '.', x.alert ? 'You get an alert when it is dialled.' : ''].filter(Boolean).join('<br>'),
      pl: lets ? [`<b>${esc(x.num)}</b>`, x.show === 'name' && x.name ? esc(x.name) : 'No name on screen.', 'Calling it: ' + esc(SP_ACT[x.act][2]) + '.'].join('<br>') : `<b>${esc(x.num)}</b><br>No name.<br>Calling it: "not in service".` };
  }
  if (p.partial || !p.done) { const h = esc(p.hint || `${placeOf(p)}. ${4 - (p.line || '').length} more digits.`); return { gm: h, pl: h }; }
  const h = holderOf(p.key), ret = isRetired(p.key), sw = SWITCHBOARDS[p.key], r = rowOfNum(p);
  const inContacts = h && (h.l.holders.includes(S.tryAs) || h.p.id === S.tryAs);
  const place = isUnlisted(p) ? 'Unlisted number' : placeOf(p);
  const gm = [`<b>${esc(fullForm(p))}</b>`, esc(placeOf(p) || 'Unlisted')];
  if (h) gm.push(`Held by <b>${esc(h.p.name)}</b>${h.p.aliasOf ? ` (alias of ${esc(byId(h.p.aliasOf).name)})` : ''}. ${h.l.holders.length} ${h.l.holders.length === 1 ? 'has' : 'have'} it saved.${h.l.off ? ' Switched off.' : ''}`);
  else if (ret) gm.push(`Retired: ${esc(ret.was)}, ${esc(ret.why.toLowerCase())} ${esc(ret.at)}.`);
  else if (sw) gm.push(`The ${esc(sw)}. Rings for you, or goes to voicemail with no GM online.`);
  else gm.push('Free. If a player dials it, your setting for a number nobody owns decides what happens.');
  if (r?.Listed === 'no') gm.push('Hidden row: players see no place.');
  if (r?.Status === 'dead') gm.push('Dead district.');
  const pl = [`<b>${esc(seenFrom(p))}</b>`, esc(place)];
  if (inContacts) pl.push(`<b>${esc(h.p.name)}</b>, from their contacts.`);
  else if (sw && !isUnlisted(p)) pl.push(`${esc(sw)}, from the directory.`);
  else pl.push('No name. Not in their contacts.');
  pl.push(ret || h?.l.off ? 'Calling it: "not in service".' : h || sw ? 'Calling it: it rings.' : 'Calling it: whatever you set for unowned numbers.');
  return { gm: gm.join('<br>'), pl: pl.join('<br>') };
}
function tryPanes() { const t = tryResult(); return `<div class="ncm-pn-view" style="--sk:var(--ncm-attn)"><h5><i class="fas fa-crown"></i> What you see</h5><div>${t.gm}</div></div><div class="ncm-pn-view" style="--sk:var(--ncm-act)"><h5><i class="fas fa-user"></i> What ${esc(byId(S.tryAs)?.name || 'a player')} sees</h5><div>${t.pl}</div></div>`; }
function viewLearn() {
  return `<header class="ncm-tabhd"><i class="fas fa-graduation-cap"></i><div><h2>How numbers work</h2><p>A made-up system for this game, explained in a minute.</p></div></header>${setupTabs()}
    <div class="ncm-pn-scroll" data-sc="learn"><section class="ncm-pn-mod" style="--sk:var(--ncm-hue-3)"><div class="ncm-pn-mh"><i class="fas fa-shoe-prints"></i> ${S.learn + 1}. ${esc(LEARN[S.learn][0])}<span class="grow"></span><small>Step ${S.learn + 1} of ${LEARN.length}</small></div><div class="ncm-pn-mb"><p style="margin:0;font:13px var(--ncm-font-body);color:var(--ncm-text-label)">${esc(LEARN[S.learn][1])}</p>${learnStep()}<div class="ncm-pn-steps">${LEARN.map((l, i) => `<button type="button" class="${i <= S.learn ? 'on' : ''}" data-do="learnGo" data-i="${i}" aria-label="Step ${i + 1}: ${esc(l[0])}" data-tooltip="${tipText(l[0])}"></button>`).join('')}</div><div class="ncm-pn-acts" style="justify-content:space-between">${btn('Back', 'fa-arrow-left', 'The step before', `data-do="learnGo" data-i="${Math.max(0, S.learn - 1)}" ${S.learn ? '' : 'disabled'}`)}${btn(S.learn === LEARN.length - 1 ? 'Done' : 'Next', 'fa-arrow-right', 'The next step', `data-do="learnGo" data-i="${(S.learn + 1) % LEARN.length}"`, 'pri')}</div></div></section>
    <section class="ncm-pn-mod" style="--sk:var(--ncm-hue-5)"><div class="ncm-pn-mh"><i class="fas fa-vial"></i> Try a number <small>What it means to you, and to a player</small></div><div class="ncm-pn-mb"><div class="ncm-pn-fr"><label class="ncm-pn-f grow" data-tooltip="Any number. Try WAT-2208, WAT-5150, +83 TKY ARA-0042, NCM-1000, TRAUMA">Number<input type="text" id="try-n" data-in="tryN" value="${esc(S.tryN)}" autocomplete="off" spellcheck="false"></label><label class="ncm-pn-f" data-tooltip="Whose eyes to see it through. A name only shows if it's in that character's contacts">As<select id="try-as" data-ch="tryAs">${PCS().map((p) => opt(p.id, p.name, S.tryAs === p.id)).join('')}</select></label></div><div class="ncm-pn-try" id="try-out">${tryPanes()}</div></div></section></div>`;
}
function sentence(k) {
  const home = homeCityName(), region = REGIONS[HOME.rc]?.name || 'your region';
  switch (k) {
    case 'home': return `Players whose number is from ${home} dial the short form, and the picker opens on ${home}.`;
    case 'list': return S.custom ? 'You have edited the table, so players see your own places. Your edits export to a spreadsheet.' : S.list === 'blank' ? 'Players only see places you add. Start in Places, or import a spreadsheet.' : `Players see the ${S.list} names in the picker and directory.`;
    case 'scope': return LIMITS.scope === 'city' ? `Players can only pick districts in ${home}.` : LIMITS.scope === 'region' ? `Players can pick anywhere in ${region}.` : 'Players can pick from any place you left ticked, like a D.C. line someone kept.';
    case 'own': return LIMITS.ownDigits ? 'Players can type the last four digits themselves, as long as nobody has them.' : 'Players choose from a few numbers made for them, and can\'t type their own.';
    case 'appr': return LIMITS.changeNeedsGm ? 'Changing a number waits for your OK, because it retires the old one. A first number never waits.' : 'Players change their number themselves. The old one still retires.';
    case 'extra': return LIMITS.extra === 0 ? 'Players can\'t add lines. You can still give them some.' : `Each player can add ${LIMITS.extra} extra line${LIMITS.extra === 1 ? '' : 's'} or burner${LIMITS.extra === 1 ? '' : 's'} themselves. You can always give more.`;
    default: return '';
  }
}
const rule = (title, tip, ctl, k) => `<div class="ncm-pn-rule"><b data-tooltip="${tipText(tip)}">${esc(title)}</b>${ctl}<div class="now"><i class="fas fa-user"></i><span>${esc(sentence(k))}</span></div></div>`;
const seg = (name, cur, opts) => `<div class="ncm-pn-seg" role="group">${opts.map(([v, t, h]) => `<button type="button" class="${String(cur) === String(v) ? 'on' : ''}" data-do="${name}" data-v="${esc(v)}" data-tooltip="${tipText(h)}">${esc(t)}</button>`).join('')}</div>`;
function viewRules() {
  const cities = uniq(ROWS.map((r) => r['Region code'] + ':' + r['City code']));
  const homeName = homeCityName();
  const listWord = S.custom ? 'Custom' : S.list === 'blank' ? 'Blank' : 'Night City ' + S.list;
  return `<header class="ncm-tabhd"><i class="fas fa-sliders"></i><div><h2>Rules</h2><p>Six questions. The defaults work without touching any of them.</p></div></header>${setupTabs()}${undoLine()}
    <div class="ncm-pn-scroll" data-sc="rules">
    ${qsect('rl-home', 'fa-location-dot', 'Where is this campaign set?', 'var(--ncm-hue-3)', homeName + ' · ' + listWord + ' list', rule('Campaign home', 'Any city in the table. A Texas or overseas campaign works the same way', `<select id="r-home" data-ch="home" aria-label="Campaign home" data-tooltip="Pick the city this campaign is set in">${cities.map((c) => { const [a, b] = c.split(':'); const r = ROWS.find((x) => x['Region code'] === a && x['City code'] === b); return opt(c, r.City + ', ' + r.Region, a === HOME.rc && b === HOME.city); }).join('')}</select>`, 'home') + `<div class="ncm-pn-rule"><b data-tooltip="What the table starts from. Edit a row or import a file and this becomes Custom by itself">Starting list</b><select id="r-era" data-ch="era" aria-label="Starting list" data-tooltip="Pick what the table starts from">${S.custom ? opt('custom', 'Custom (your edits)', true) : ''}${opt('2045', 'Night City 2045 (book)', !S.custom && S.list === '2045')}${opt('2077', 'Night City 2077', !S.custom && S.list === '2077')}${opt('blank', 'Blank: build your own', !S.custom && S.list === 'blank')}</select><div class="now"><i class="fas fa-user"></i><span>${esc(sentence('list'))}</span></div>${S.listAsk ? `<div class="ncm-pn-check" style="grid-column:1/-1"><i class="fas fa-triangle-exclamation"></i><span class="grow">This replaces your edits. Places people hold numbers on stay.</span>${btn('Replace them', 'fa-check', 'Switch to this list. You can undo straight after', 'data-do="listYes"', 'bad')}${btn('Keep my edits', '', 'Stay as you are', 'data-do="listNo"')}</div>` : ''}</div>`)}
    ${qsect('rl-pick', 'fa-user-gear', 'What can players pick?', 'var(--ncm-act)', ({ city: 'Home city', region: 'Home region', all: 'Anywhere' })[LIMITS.scope] + (LIMITS.ownDigits ? ', own digits allowed' : ', no typing digits'), rule('Players can pick from', 'How far the picker reaches. Rows you unticked in Places are never offered', seg('scope', LIMITS.scope, [['city', 'Home city', 'Only the home city'], ['region', 'Home region', 'Anywhere in the home region'], ['all', 'Anywhere', 'Any ticked row']]), 'scope') + rule('Typing their own digits', 'Whether players choose the last four digits', seg('own', LIMITS.ownDigits ? 1 : 0, [[1, 'Allowed', 'They can type digits'], [0, 'Not allowed', 'They choose from a few made for them']]), 'own'))}
    ${qsect('rl-chg', 'fa-pen', 'Can they change a number?', 'var(--ncm-attn)', LIMITS.changeNeedsGm ? 'Only with your OK' : 'Yes, by themselves', rule('Changing a number', 'Whether a change waits for you', seg('appr', LIMITS.changeNeedsGm ? 1 : 0, [[1, 'Needs my OK', 'It lands in Requests'], [0, 'Their choice', 'It happens straight away']]), 'appr'))}
    ${qsect('rl-lin', 'fa-layer-group', 'How many lines can they add?', 'var(--ncm-hue-5)', LIMITS.extra === 0 ? 'None' : String(LIMITS.extra) + ' extra', rule('Extra lines per player', 'Lines and burners a player can add without asking', `<select id="r-extra" data-ch="extra" aria-label="Extra lines per player" data-tooltip="How many lines a player can add without asking">${[0, 1, 2, 3, 5].map((n) => opt(n, n === 0 ? 'None' : String(n), LIMITS.extra === n)).join('')}</select>`, 'extra'))}
    ${qsect('rl-org', 'fa-building', 'Which names mean which office?', 'var(--ncm-hue-1)', Object.keys(ORG_MAP).length ? Object.keys(ORG_MAP).length + ' remembered' : 'Nothing to fix', Object.keys(ORG_MAP).length ? Object.entries(ORG_MAP).map(([k, v]) => `<div class="ncm-pn-orgrow"><span>${esc(k)}</span><b>${esc(v || 'Not a corporation')}</b>${btn('', 'fa-xmark', 'Forget this. It is asked again', `data-do="orgForget" data-k="${esc(k)}"`, 'ic')}</div>`).join('') : '<small>Written differently from an office? Decide once in the walkthrough and it is kept here. The contact itself is never rewritten.</small>')}
    ${qsect('rl-exp', 'fa-file-export', 'Want it in a spreadsheet?', 'var(--ncm-hue-2)', 'Three exports', `<div class="ncm-pn-acts">${btn('Assigned numbers', 'fa-file-csv', 'Every line: who holds it, what kind, its label, why, who has it saved', 'data-do="csvAssigned"')}${btn('Retired numbers', 'fa-file-csv', 'The list that keeps old numbers from coming back', 'data-do="csvRetired"')}${btn('Places table', 'fa-file-csv', 'The table every number comes from', 'data-do="csvPlaces"')}${''}</div><small>Deleted a character or contact? Their numbers retire with them. Factory Reset and Orphan Audit cover numbers too.</small>`)}</div>`;
}
const COL_HELP = { Pick: 'Players can pick numbers here.', Listed: 'Shows in the directory. Untick and the number still works, but reads as Unlisted number.', 'City code': 'Two or three letters. Dialled from outside the city.', City: 'The city name players read.', Code: 'Three letters, the district in a number. People already holding numbers lock this.', District: 'The name players read.', Area: 'Groups districts in the picker. Never dialled.', State: 'Groups cities in the picker. Never dialled.', Category: 'District, Corporate, Military… Your own words are fine.', Status: 'Dead means nothing should answer.', Source: 'Where this came from. Rulebook, Homebrew, anything.', Held: 'How many numbers are in use here.' };
const P_COLS = () => ['Pick', 'Listed', 'City', 'Code', 'District', 'Area', ...(S.w === 'pop' ? ['State'] : []), 'Category', 'Status', ...(S.w === 'pop' ? ['Source'] : []), ...EXTRA_COLS, 'Held'];
function tbHit(r) { const q = S.tbq.trim().toLowerCase(); if (!q) return true; const h = Object.values(r).join(' ').toLowerCase(); return q.split(/\s+/).every((w) => h.includes(w)); }
function categoryTag(cat) { if (!cat) return ''; if (cat === 'District' || cat === 'City') return `<span class="ncm-pn-who">${esc(cat)}</span>`; if (/dead/i.test(cat)) return tagp(cat, 'is-bad', 'fa-skull'); if (/burner/i.test(cat)) return tagp(cat, 'is-attn', 'fa-fire'); return hue(cat, /corp/i.test(cat) ? 'fa-building' : /mil/i.test(cat) ? 'fa-shield-halved' : null); }
function cellsOf(r, i) {
  const held = rowHeld(r);
  if (S.edit === i) {
    const f = (k, id, lock, w) => `<label class="ncm-pn-f"${lock ? ' data-tooltip="People hold numbers here, so this stays"' : ` data-tooltip="${tipText(COL_HELP[k] || 'Your own column')}"`}>${esc(k)}<input type="text" id="${id}" value="${esc(r[k] ?? '')}"${lock ? ' disabled' : ''}${w ? ` style="width:${w}px"` : ''}></label>`;
    return `<td colspan="${P_COLS().length}"><div class="ncm-pn-form" style="white-space:normal"><div class="ncm-pn-fr">${f('Code', 'ed-code', held > 0, 62)}${f('District', 'ed-dist')}${f('Area', 'ed-area')}${f('State', 'ed-state')}${f('Category', 'ed-cat')}${f('Source', 'ed-src')}${EXTRA_COLS.map((c, x) => f(c, 'ed-x' + x)).join('')}<label class="ncm-pn-f" data-tooltip="${tipText(COL_HELP.Status)}">Status<select id="ed-status">${opt('live', 'live', r.Status === 'live')}${opt('dead', 'dead', r.Status === 'dead')}</select></label></div>${held ? `<small>${held} number${held === 1 ? ' is' : 's are'} in use here, so the code stays.</small>` : ''}<div class="ncm-pn-acts">${btn('Save', 'fa-check', 'Save this row', `data-do="edSave" data-i="${i}"`, 'pri')}${btn('Cancel', '', 'Leave it as it was', 'data-do="edCancel"')}</div></div></td>`;
  }
  const cell = { Pick: `<td class="ck"><input type="checkbox" data-ch="rowPick" data-i="${i}" id="pk-${i}" aria-label="Players can pick ${esc(r.District || r.City)}" data-tooltip="${tipText(COL_HELP.Pick)}"${r['Players can pick'] === 'yes' ? ' checked' : ''}></td>`, Listed: `<td class="ck"><input type="checkbox" data-ch="rowList" data-i="${i}" id="ls-${i}" aria-label="List ${esc(r.District || r.City)}" data-tooltip="${tipText(COL_HELP.Listed)}"${r.Listed === 'yes' ? ' checked' : ''}></td>`, Code: `<td class="code">${esc(r.Code || '')}</td>`, Status: `<td>${r.Status === 'dead' ? tagp('dead', 'is-bad') : 'live'}</td>`, Source: `<td data-tooltip="${tipText(r.Source || '')}" style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(r.Source || '')}</td>`, Held: `<td class="act">${held ? `<span class="ncm-pn-count" data-tooltip="${tipText(held)} number${tipText(held === 1 ? '' : 's')} in use here">${held}</span> ` : ''}${btn('', 'fa-pen', 'Edit this row here', `data-do="edit" data-i="${i}"`, 'ic')}${held ? '' : btn('', 'fa-trash', 'Delete this row', `data-do="delRow" data-i="${i}"`, 'ic bad')}</td>` };
  return P_COLS().map((c) => cell[c] ?? `<td class="${c === 'Category' ? 'cat' : c === 'Area' || c === 'State' ? 'dim' : c === 'District' ? 'dist' : ''}">${c === 'City' ? hv(r.City) : c === 'Category' ? categoryTag(r.Category) : esc(r[c] ?? '')}</td>`).join('');
}
function planView() {
  const p = S.plan; if (!p) return '';
  if (p.error) return `<div class="ncm-pn-plan bad">${esc(p.error)} ${btn('Close', '', 'Close this', 'data-do="planNo"')}</div>`;
  return `<div class="ncm-pn-plan"><b>This import would change:</b> ${p.added.length} added · ${p.changed.length} changed · ${p.removed.length} removed${p.extra.length ? ` · your column${p.extra.length > 1 ? 's' : ''} kept: ${esc(p.extra.join(', '))}` : ''}<ul>${p.added.slice(0, 5).map((r) => `<li>+ ${esc(r.Code || r.City)} ${esc(r.District || r.City)}, ${esc(r.City)}</li>`).join('')}${p.removed.slice(0, 3).map((r) => `<li>− ${esc(r.Code)} ${esc(r.District)}</li>`).join('')}${p.kept.map((r) => `<li>Kept ${esc(r.Code)} ${esc(r.District)}: people hold numbers there.</li>`).join('')}${p.problems.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><div class="ncm-pn-acts">${btn('Apply', 'fa-check', 'Replace the table with this file', 'data-do="planYes"', 'go')}${btn('Cancel', '', 'Leave the table as it is', 'data-do="planNo"')}</div></div>`;
}
function addPlaceForm() {
  const a = S.addPlace; if (!a) return '';
  const regions = Object.entries(REGIONS).sort((x, y) => x[1].name.localeCompare(y[1].name));
  const isNew = a.rc === 'new';
  const cc = (a.cc || '').toUpperCase(), ex = (a.ex || '').toUpperCase(), rc = isNew ? a.nrc : a.rc;
  const issues = [];
  if (isNew && a.nrc && !/^\d{2}$/.test(a.nrc)) issues.push('A region code is two digits.');
  if (isNew && REGIONS[a.nrc]) issues.push(`+${a.nrc} is already ${REGIONS[a.nrc].name}.`);
  if (cc && !/^[A-Z]{2,3}$/.test(cc)) issues.push('A city code is two or three letters.');
  if (ex && !/^[A-Z]{3}$/.test(ex)) issues.push('A district code is three letters.');
  if (ROWS.some((r) => r['Region code'] === rc && r['City code'] === cc && (r.Code || '') === ex) && cc) issues.push('That place is already in the table.');
  if (ex) { const c = ROWS.find((r) => r['Region code'] === rc && r['City code'] === cc && r.Code && r.Code !== ex && asKeys(r.Code) === asKeys(ex)); if (c) issues.push(`${c.Code} uses the same pad keys here. Letters still work; the pad can't tell them apart.`); }
  const ready = rc && cc && a.city && !issues.some((t) => !t.includes('pad keys'));
  const reading = ready ? `+${rc} ${cc}${ex ? ' ' + ex + '-' : '-'}1234` : '';
  return `<div class="ncm-pn-form"><h4><i class="fas fa-location-dot"></i> Add a place</h4><div class="ncm-pn-fr">
    <label class="ncm-pn-f" data-tooltip="Which part of the world. Pick one or start a new one">Region<select id="ap-rc" data-ch="apRc">${regions.map(([k, v]) => opt(k, v.name + ' +' + k, a.rc === k)).join('')}${opt('new', 'New region…', isNew)}</select></label>
    ${isNew ? `<label class="ncm-pn-f" data-tooltip="Any name">Region name<input type="text" id="ap-nr" data-in="ap" data-k="nr" value="${esc(a.nr)}"></label><label class="ncm-pn-f" data-tooltip="Two digits, not already used. Make one up">Code<input type="text" id="ap-nrc" data-in="ap" data-k="nrc" value="${esc(a.nrc)}" style="width:54px"></label>` : ''}
    <label class="ncm-pn-f" data-tooltip="Optional. Groups cities in the picker">State<input type="text" id="ap-st" data-in="ap" data-k="st" value="${esc(a.st)}"></label>
    <label class="ncm-pn-f" data-tooltip="The city name">City<input type="text" id="ap-city" data-in="ap" data-k="city" value="${esc(a.city)}"></label>
    <label class="ncm-pn-f" data-tooltip="Two or three letters">City code<input type="text" id="ap-cc" data-in="ap" data-k="cc" value="${esc(a.cc)}" style="width:68px"></label>
    <label class="ncm-pn-f" data-tooltip="Optional. Groups districts in the picker">Area<input type="text" id="ap-ar" data-in="ap" data-k="ar" value="${esc(a.ar)}"></label>
    <label class="ncm-pn-f" data-tooltip="Leave empty for a small place that dials city and four digits">District<input type="text" id="ap-di" data-in="ap" data-k="di" value="${esc(a.di)}"></label>
    <label class="ncm-pn-f" data-tooltip="Three letters">Code<input type="text" id="ap-ex" data-in="ap" data-k="ex" value="${esc(a.ex)}" style="width:62px"></label></div>
    <div id="ap-out">${apOut(reading, issues)}</div>
    <div class="ncm-pn-acts">${btn('Add it', 'fa-check', 'Add this row to the table', 'data-do="apGo"', 'pri')}${btn('Cancel', '', 'Add nothing', 'data-do="apCancel"')}</div></div>`;
}
const apOut = (reading, issues) => `${reading ? `<div class="ncm-pn-why"><i class="fas fa-eye"></i><span>Numbers here read <b style="font-family:var(--ncm-font-mono)">${esc(reading)}</b></span></div>` : '<small>Fill in a city and its code to see how numbers read.</small>'}${issues.map((t) => `<div class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span>${esc(t)}</span></div>`).join('')}`;
function addBranchForm() {
  const a = S.addBranch; if (!a) return '';
  const corps = uniq(ROWS.filter(isCorp).map((r) => r.Code + '|' + r.District)).sort((x, y) => x.split('|')[1].localeCompare(y.split('|')[1]));
  const code = a.corp.split('|')[0];
  const cities = uniq(ROWS.map((r) => r['Region code'] + ':' + r['City code'])).filter((c) => { const [x, y] = c.split(':'); return !ROWS.some((r) => r['Region code'] === x && r['City code'] === y && r.Code === code); }).map((c) => { const [x, y] = c.split(':'); const r = ROWS.find((z) => z['Region code'] === x && z['City code'] === y); return { c, name: r.City, region: r.Region }; }).sort((x, y) => x.name.localeCompare(y.name));
  if (!cities.some((x) => x.c === a.city)) a.city = cities[0]?.c || '';
  const [x, y] = a.city.split(':');
  return `<div class="ncm-pn-form"><h4><i class="fas fa-building"></i> Add a branch</h4><p style="margin:0;font:13px var(--ncm-font-body);color:var(--ncm-text-label)">A branch is a row: the corporation's three letters in one more city.</p><div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="Any corporation already in the table">Corporation<select id="ab-corp" data-ch="abCorp">${corps.map((c) => opt(c, c.split('|')[1] + ' ' + c.split('|')[0], a.corp === c)).join('')}</select></label><label class="ncm-pn-f" data-tooltip="Cities that don't have this office yet">City<select id="ab-city" data-ch="abCity">${cities.map((c) => opt(c.c, c.name + ', ' + c.region, a.city === c.c)).join('')}</select></label><label class="ncm-pn-chk" data-tooltip="The number works but reads as Unlisted number, like Arasaka in Night City 2045"><input type="checkbox" id="ab-hide" data-ch="abHide"${a.hide ? ' checked' : ''}><span>Keep it out of the directory</span></label></div><div class="ncm-pn-why"><i class="fas fa-eye"></i><span>Numbers here read <b style="font-family:var(--ncm-font-mono)">+${esc(x)} ${esc(y)} ${esc(code)}-0100</b></span></div><div class="ncm-pn-acts">${btn('Add it', 'fa-check', 'Add this office', 'data-do="abGo"', 'pri')}${btn('Cancel', '', 'Add nothing', 'data-do="abCancel"')}</div></div>`;
}
function viewPlaces() {
  const hits = ROWS.map((r, i) => ({ r, i })).filter(({ r }) => tbHit(r));
  const regs = uniq(hits.map(({ r }) => r['Region code'])).sort((a, b) => (a === HOME.rc ? -1 : b === HOME.rc ? 1 : (REGIONS[a]?.name || '').localeCompare(REGIONS[b]?.name || '')));
  const forced = !!S.tbq.trim();
  return `<header class="ncm-tabhd"><i class="fas fa-table"></i><div><h2>Places</h2><p>Every number comes from this table. Edit it here, or export it to a spreadsheet and bring it back.</p></div></header>${setupTabs()}${undoLine()}
    <div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Narrow the table, then hide or show everything it finds. Try: arasaka night"><i class="fas fa-magnifying-glass"></i><input type="text" id="tb-q" data-in="tbq" value="${esc(S.tbq)}" placeholder="Find rows" aria-label="Find rows"></label><small>${hits.length} of ${ROWS.length}</small>
      ${btn('', 'fa-eye-slash', 'Hide every row showing here from the directory. The numbers still work', 'data-do="tbHide" data-v="no"', 'ic')}${btn('', 'fa-eye', 'List every row showing here in the directory', 'data-do="tbHide" data-v="yes"', 'ic')}
      <span class="grow"></span><details class="ncm-pn-menu"><summary class="ncm-ph2-btn ncm-ph2-btn--pri" data-tooltip="Add to the table"><i class="fas fa-plus"></i> Add</summary><div class="m"><button type="button" data-do="apOpen" data-tooltip="A region, city or district"><i class="fas fa-location-dot"></i> A place</button><button type="button" data-do="abOpen" data-tooltip="A corporation's office in another city"><i class="fas fa-building"></i> A branch</button></div></details><details class="ncm-pn-menu"><summary class="ncm-ph2-btn" data-tooltip="Work on it in Excel or Sheets. Your own columns are kept"><i class="fas fa-table"></i> Spreadsheet</summary><div class="m"><button type="button" data-do="csvPlaces" data-tooltip="Download the table as a CSV"><i class="fas fa-file-export"></i> Export</button><button type="button" data-do="csvImport" data-tooltip="Load an edited CSV. You see every change before it applies"><i class="fas fa-file-import"></i> Import</button><button type="button" data-do="csvBlank" data-tooltip="An empty CSV with the right columns and one example row"><i class="fas fa-file-circle-plus"></i> Blank template</button><button type="button" data-do="tbReset" data-tooltip="Back to the shipped table. Numbers people hold are not touched"><i class="fas fa-rotate-left"></i> Reset the table</button></div></details><input type="file" id="tbfile" accept=".csv,text/csv" hidden></div>
    ${planView()}${addPlaceForm()}${addBranchForm()}
    <div class="ncm-pn-tw" data-sc="places"><table><thead><tr>${P_COLS().map((c) => `<th class="${c === 'Held' ? 'act' : ''}" data-tooltip="${tipText(COL_HELP[c] || 'Your own column, kept through export and import')}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${regs.map((rc) => { const list = hits.filter(({ r }) => r['Region code'] === rc); const open = forced || S.pOpen.has(rc); const name = list[0].r.Region; return `<tr class="grp${open ? '' : ' is-shut'}" data-do="pFold" data-k="${esc(rc)}" data-tooltip="${tipText(open ? 'Fold' : 'Open')} ${tipText(name)}"><td colspan="${P_COLS().length}" style="--tc:${hueOf(name)}"><i class="fas fa-chevron-down ch"></i>${esc(name)} <span class="ncm-pnum is-plain"><span class="r">+${esc(rc)}</span></span> <span class="ncm-pn-more">${list.length}</span>${rc === HOME.rc ? ' ' + tagp('your campaign', 'is-act', 'fa-location-dot') : ''}</td></tr>${open ? list.map(({ r, i }) => `<tr class="${r['Players can pick'] === 'no' ? 'is-off' : ''}${r.Listed === 'no' ? ' is-hid' : ''}">${cellsOf(r, i)}</tr>`).join('') : ''}`; }).join('')}</tbody></table></div>`;
}
const rowKey = (r) => r['Region code'] + '/' + r['City code'] + '/' + (r.Code || '-');
function planImport(text) {
  const grid = parseCsv(text.replace(/^\uFEFF/, '')); const head = (grid.shift() || []).map((h) => h.trim());
  const missing = ['Region code', 'Region', 'City code', 'City'].filter((c) => !head.includes(c));
  if (missing.length) return { error: 'This file is missing: ' + missing.join(', ') + '.' };
  const extra = head.filter((h) => h && !COLS.includes(h)), rows = [], problems = [];
  grid.forEach((cells, i) => { const r = Object.fromEntries(head.map((h, j) => [h, (cells[j] ?? '').trim()])); r.Code = (r.Code || '').toUpperCase(); r['City code'] = (r['City code'] || '').toUpperCase(); r['Players can pick'] = /^(no|n|false|0)$/i.test(r['Players can pick'] || '') ? 'no' : 'yes'; r.Status = /^dead$/i.test(r.Status || '') ? 'dead' : 'live'; r.Category = r.Category || 'District'; r.Listed = /^(no|n|false|0|hidden)$/i.test(r.Listed || '') ? 'no' : 'yes';
    if (r.Code && !/^[A-Z]{3}$/.test(r.Code)) problems.push(`Row ${i + 2}: ${r.Code} needs to be three letters. Skipped.`); else if (!r['Region code'] || !r['City code']) problems.push(`Row ${i + 2}: needs a region code and a city code. Skipped.`); else if (rows.some((x) => rowKey(x) === rowKey(r))) problems.push(`Row ${i + 2}: ${rowKey(r)} appears twice. Skipped the second.`); else rows.push(r); });
  const was = new Map(ROWS.map((r) => [rowKey(r), r])), now = new Map(rows.map((r) => [rowKey(r), r]));
  const added = rows.filter((r) => !was.has(rowKey(r)));
  const changed = rows.filter((r) => was.has(rowKey(r)) && [...COLS, ...extra].some((c) => (was.get(rowKey(r))[c] ?? '') !== (r[c] ?? '')));
  const gone = ROWS.filter((r) => !now.has(rowKey(r))); const kept = gone.filter((r) => rowHeld(r) > 0), removed = gone.filter((r) => !rowHeld(r));
  return { rows: [...rows, ...kept], extra, added, changed, removed, kept, problems };
}
function spIssues(x) {
  const n = normSp(x.num), out = [];
  if (!n) { out.push(['warn', 'Give it a number. Letters, digits, anything.']); return out; }
  const twin = SPECIAL.find((y) => y !== x && normSp(y.num) === n); if (twin) out.push(['warn', `Another special number already uses this. Only the first would work.`]);
  const clash = SPECIAL.find((y) => y !== x && normSp(y.num) && normSp(y.num) !== n && asKeys(normSp(y.num)) === asKeys(n)); if (clash) out.push(['warn', `${clash.num} uses the same pad keys. Typing letters works, the pad can't tell them apart.`]);
  const q = parseNumber(x.num, { ...CTX, service: {} });
  if (q.done && q.key) {
    const h = holderOf(q.key), ret = isRetired(q.key);
    if (h) out.push(['warn', `${h.p.name} holds this number. The special rule wins, so they would stop getting calls on it.`]);
    else if (ret) out.push(['warn', `This was ${ret.was}'s number. Anyone who saved it reaches this now.`]);
    else out.push(['info', 'It looks like a normal number, so someone could stumble onto it. The generator will never hand it out.']);
  }
  return out;
}
const SP_ICON = { ring: 'fa-phone-volume', recording: 'fa-tape', voicemail: 'fa-voicemail', nis: 'fa-ban', dead: 'fa-volume-xmark', macro: 'fa-terminal' };
const spCallCard = (x, toName) => `<div class="ncm-pn-ring">${x.show === 'name' ? portrait(x, 'lg') : '<span class="ncm-pn-face lg"><i class="fas fa-question" aria-hidden="true"></i></span>'}<div><small class="ncm-pn-ringk"><i class="fas fa-phone-volume"></i> Incoming call</small><b>${esc(x.show === 'name' && x.name ? x.name : 'Unknown caller')}</b>${x.show === 'name' ? `<div>${pcolor(x.num)}</div>` : '<small>Number withheld</small>'}</div></div>`;
function viewSpecial() {
  const x = SPECIAL.find((y) => y.id === S.spSel) || SPECIAL[0];
  const row2 = (y) => `<button type="button" class="ncm-pn-prow${y === x ? ' on' : ''}" data-do="spSel" data-id="${y.id}" data-tooltip="Open ${tipText(y.num || 'the new number')}">${portrait(y)}<span class="bd"><span class="nm">${esc(y.name || 'No name')}${y.seen === 'hidden' ? tagp('hidden', 'is-secret', 'fa-eye-slash') : ''}${y.alert ? '<i class="fas fa-bell ncm-pn-warnmark" aria-label="Alerts you"></i>' : ''}</span><span class="ln"><span class="ncm-pnum is-plain"><span class="${y.seen === 'hidden' ? 'sec' : 'x'}">${esc(y.num || 'New number')}</span></span></span><span class="mt">${hv(SP_ACT[y.act][0], SP_ICON[y.act])}${y.who === 'some' ? tagp('chosen only', 'is-secret', 'fa-user-lock') : ''}</span></span></button>`;
  const f = (k, label, tip, ph = '') => `<label class="ncm-pn-f grow" data-tooltip="${tipText(tip)}">${esc(label)}<input type="text" id="sp-${k}" data-in="sp" data-k="${k}" value="${esc(x?.[k] ?? '')}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></label>`;
  const segF = (k, cur, opts, label, tip) => `<div class="ncm-pn-f"><span data-tooltip="${tipText(tip)}">${esc(label)}</span><div class="ncm-pn-seg" role="group">${opts.map(([v, t, h]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-do="spSet" data-k="${k}" data-v="${v}" data-tooltip="${tipText(h)}">${esc(t)}</button>`).join('')}</div></div>`;
  const issues = x ? spIssues(x) : [];
  const band = (ic, t, tone, sub = '') => `<div class="ncm-pn-band" style="--sk:${tone}"><i class="fas ${ic}"></i> ${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const c = S.spCall;
  const editor = !x ? '<div class="ncm-ph2-none">No special numbers. Add one.</div>' : `
    <div class="ncm-pn-dh">${portrait(x, 'xl')}<div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:5px"><div class="ncm-pn-fr">${f('num', 'Number', 'Anything at all: 666, BLACKWALL, 0, WAT-0000. Case, spaces and dashes do not matter', 'BLACKWALL')}${f('name', 'Name', 'The name players read. Leave it empty for no name', 'Optional')}</div><div class="ncm-pn-acts">${btn(x.img ? 'Change picture' : 'Add a picture', 'fa-image', 'A portrait for this number. It shows when they dial it and when it calls them', 'data-do="spArt"')}${x.img ? btn('', 'fa-xmark', 'Remove the picture', 'data-do="spArtClear"', 'ic') : ''}</div></div></div>
    ${issues.map(([t, m]) => `<div class="ncm-pn-check ${t === 'info' ? 'info' : ''}"><i class="fas ${t === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation'}"></i><span>${esc(m)}</span></div>`).join('')}
    ${qsect('sp-who', 'fa-eye-slash', 'Who can reach it?', 'var(--ncm-secret)', (x.seen === 'hidden' ? 'Hidden' : 'Listed') + ' · ' + (x.who === 'all' ? 'Anyone' : 'Chosen characters'), `<div class="ncm-pn-fr">${segF('seen', x.seen, [['listed', 'Listed', 'It shows in the directory'], ['hidden', 'Hidden', 'No hint anywhere until the whole number is typed']], 'Who sees it', 'Whether players can find it, or have to be told')}${segF('who', x.who, [['all', 'Anyone', 'Anyone who dials it'], ['some', 'Chosen characters', 'Everyone else hears not in service']], 'Who gets through', 'Who it works for')}</div>
    ${x.who === 'some' ? `<div class="ncm-pn-fr">${PCS().map((p) => `<label class="ncm-pn-chk" data-tooltip="${tipText(p.name)} gets through"><input type="checkbox" id="sp-al-${p.id}" data-ch="spAllow" data-id="${p.id}"${x.allow.includes(p.id) ? ' checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}</div>` : ''}`)}
    ${qsect('sp-dial', SP_ICON[x.act], 'What happens when they dial it?', 'var(--ncm-hue-3)', SP_ACT[x.act][0] + (x.alert ? ' · you get an alert' : ''), `<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="What happens when someone dials it">What happens<select id="sp-act" data-ch="spAct">${Object.entries(SP_ACT).map(([k, v]) => opt(k, v[0], x.act === k)).join('')}</select></label>
      ${x.act === 'recording' ? f('text', 'What it says', 'Read out, or use an audio file in Foundry') : ''}${x.act === 'macro' ? `<label class="ncm-pn-f grow" data-tooltip="Any macro in your world">Macro<select id="sp-macro" data-ch="spMacro">${opt('', 'Choose a macro…', !x.macro)}${(game.macros?.contents || []).map((m) => opt(m.id, m.name, x.macro === m.id)).join('')}</select></label>` : ''}</div>
    <small class="ncm-pn-note">${esc(SP_ACT[x.act][1])}</small>
    <label class="ncm-pn-chk" data-tooltip="You get a notice naming who dialled it, even when nothing else happens"><input type="checkbox" id="sp-alert" data-ch="spAlert"${x.alert ? ' checked' : ''}><span>Tell me when someone dials it</span></label>`)}
    ${qsect('sp-show', 'fa-id-badge', 'What does it show?', 'var(--ncm-hue-5)', (x.show === 'name' ? 'Name and picture' : 'Nothing') + ' · a Trace finds ' + ({ name: 'its name', false: 'a false name', dead: 'a dead end' })[x.trace], `<div class="ncm-pn-fr">${segF('show', x.show, [['name', 'Name and picture', 'What you set above'], ['none', 'Nothing', 'No name and no picture']], 'Their screen shows', 'When they dial it, and when it calls them')}
      <label class="ncm-pn-f" data-tooltip="What a Trace on this number reports">A Trace finds<select id="sp-trace" data-ch="spTrace">${[['name', 'Its name'], ['false', 'A false name'], ['dead', 'A dead end']].map(([k, t]) => opt(k, t, x.trace === k)).join('')}</select></label>${x.trace === 'false' ? f('falseName', 'False name', 'The name the Trace reports') : ''}</div>
      <div class="ncm-pn-ph" style="--sk:var(--ncm-hue-5)"><h5><i class="fas fa-mobile-screen"></i> When they dial it</h5><div class="ncm-pn-dh">${x.show === 'name' ? portrait(x, 'lg') : '<span class="ncm-pn-face lg"><i class="fas fa-question" aria-hidden="true"></i></span>'}<div><b>${esc(x.show === 'name' && x.name ? x.name : 'Unknown')}</b><div>${pnum(x.num)}</div></div></div><small>Calling it: ${esc(SP_ACT[x.act][2])}.</small></div>`)}
    ${qsect('sp-call', 'fa-phone', 'Want to call someone from it?', 'var(--ncm-good)', 'It has no NPC behind it. You speak for it', `<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="Who it rings">Call<select id="sp-to" data-ch="spTo">${PCS().map((p) => opt(p.id, p.name, (c?.to || 'v') === p.id)).join('')}</select></label>${btn('Ring them', 'fa-phone', 'Their phone rings from this number. You answer on the GM call screen, like any NPC line', 'data-do="spRing"', 'go')}</div>${spCallCard(x)}<small>The call log and a Trace treat it like any call from this number. Their Save number saves it, even if it is hidden.</small>`)}
    <div class="ncm-pn-acts">${btn('Try it', 'fa-vial', 'See it from the GM and a player side by side', 'data-do="spTry"')}<span class="grow"></span>${btn('Delete', 'fa-trash', 'Remove this number. Saved contacts keep it, and it stops answering', 'data-do="spDel"', 'bad')}</div>`;
  return `<header class="ncm-tabhd"><i class="fas fa-star-of-life"></i><div><h2>Special numbers</h2><p>Numbers that play by their own rules. They ignore the format and are checked first.</p></div></header>${setupTabs()}${undoLine()}
    <div class="ncm-pn-tb">${btn('New special number', 'fa-plus', 'Add a number that plays by its own rules', 'data-do="spNewOne"', 'pri')}<span class="grow"></span>${btn('', 'fa-file-export', 'Export this list as a CSV', 'data-do="csvSpecial"', 'ic')}${''}</div>
    <div class="ncm-pn-split"><div class="ncm-pn-list" data-sc="splist">${SPECIAL.map(row2).join('')}</div><div class="ncm-pn-detail" data-sc="spdetail">${editor}</div></div>`;
}


/* ─── Round 3: line types and corporations ─── */
let TYPES = [], OFFICES = [];
const sampleNumber = (t) => { const c = ROWS.find((r) => (t.shows === 'ownerOrg' ? r.Category === 'Corporate' : r.Category === 'District') && r.Code) || ROWS[0]; return c ? seenFrom(parse(numAt(c, '2208'))) : ''; };
const typeOf = (id) => TYPES.find((t) => t.id === id);
const typesNow = () => { TYPES = lineTypes(SVC._get('phoneLineTypes', {})); };
const officesNow = () => {
  OFFICES = ROWS.filter((r) => r.Category === 'Corporate' && r.Code).map((r) => { const o = SVC.office(r); return { id: officeKey(r), name: r.District, city: r.City, num: numAt(r, OFFICE_LINE), art: o.art, answer: o.answers, greet: o.greet, ext: o.exts, mailbox: o.mailbox, hidden: r.Listed === 'no' }; });
  if (!OFFICES.some((x) => x.id === S.off)) S.off = OFFICES[0]?.id || null;
};
const NOFACE = 'NOFACE';
let HUD = null;
const HUD_SVC = { calls: new Map(), usableModes: ['loud'], offeredModes: ['loud'], modeFor: () => 'loud', homeCode: null, _get: (k, d) => d };
// A copy of the call screen of its own, drawn as the PLAYER sees it (asPlayer) — never by overwriting game.user.isGM (COMPAT-03).
const hudOf = () => (HUD ??= Object.assign(new CallHud(HUD_SVC), { asPlayer: true }));
const NET = { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', strength: 78, color: '' };
let hudN = 0;
/** The real call screen, in this player's own theme colours. Never a hand copy. */
function hudCard({ word = 'Incoming call', name, img, number = '', org = null, ring = 'steady' }) {
  const live = !!S.hudLive, now = Date.now(), id = 'gm' + (++hudN);
  const anon = !number && /^unknown/i.test(name);
  const call = { id, from: { name, number, img: img || '', contactId: null, anon, word: word.replace(/^Incoming · /, '').replace(/^Incoming call$/, ''), ring, showOnly: 'name', org: org?.name || '', orgArt: org?.art || '' }, to: { userId: 'u', name: 'V', number: 'WAT-4471', kind: 'player' }, net: NET, mode: 'loud', state: live ? 'live' : 'ringing', startedAt: now - 2300, answeredAt: live ? now - 128000 : null, endedAt: null, outcome: null };
  HUD_SVC.calls.set(id, call);
  // a GM client normally sees "X is calling": the preview shows what the player gets
  const html = hudOf()._callHtml({ call, role: 'callee' }, {});
  return `<div class="ncm-call-hud ncm-r3-hud">${html}</div>`;
}
const themeSwitch = () => seg3('hudState', 'live', S.hudLive ? 'live' : 'ring', [['ring', 'Ringing', 'How it looks while it rings. The real screen shows no portrait yet'], ['live', 'Picked up', 'Once they answer, the portrait appears']]);
const seg3 = (act, k, cur, opts) => `<div class="ncm-pn-seg" role="group">${opts.map(([v, t, h]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-do="${act}" data-k="${k}" data-v="${esc(v)}" data-tooltip="${tipText(h)}">${esc(t)}</button>`).join('')}</div>`;
const band = (ic, t, tone, sub = '') => `<div class="ncm-pn-band" style="--sk:${tone}"><i class="fas ${ic}"></i> ${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
const sect = (ic, t, tone, body, sub) => `<div class="ncm-pn-sect">${band(ic, t, tone, sub)}<div class="in">${body}</div></div>`;
const faceOf = (name, cls = '', img = '') => (img ? `<span class="ncm-pn-face has-img ${cls}" style="background-image:url('${esc(cssUrl(img))}')" role="img" aria-label="${esc(name)}"></span>` : `<span class="ncm-pn-face ${cls}" style="--tc:${hueOf(name)}">${esc(initials(name))}</span>`);
const pane = (cur, k, h) => (S.allOpen || cur === k ? h : '');
const subTabs = (act, cur, tabs) => `<div class="ncm-r3-subt" role="tablist">${tabs.map(([k, t, ic, tip]) => `<button type="button" role="tab" aria-selected="${cur === k}" class="${cur === k ? 'on' : ''}" data-do="${act}" data-k="${k}" data-tooltip="${tipText(tip)}"><i class="fas ${ic}"></i> ${esc(t)}</button>`).join('')}</div>`;
const COLORS = [['var(--ncm-act)', 'Cyan'], ['var(--ncm-hue-5)', 'Periwinkle'], ['var(--ncm-attn)', 'Amber'], ['var(--ncm-hue-3)', 'Blue'], ['var(--ncm-hue-1)', 'Pink'], ['var(--ncm-good)', 'Green'], ['var(--ncm-secret)', 'Violet'], ['var(--ncm-money)', 'Gold']];
const RINGS = { steady: ['Steady', 'The usual ring'], slow: ['Slow', 'A slow, unhurried ring'], fast: ['Fast', 'Quick and insistent'], flicker: ['Flicker', 'The dial stutters, like a cheap line'] };
const SHOWS = { ownerOrg: ['The person, then where they work', 'Their name first, then the organization from their contact details, like John Anderson, Militech'], owner: ['The holder', 'The name of whoever holds the line'], label: ['A name you set', 'The same name, whoever holds it'], number: ['Only the number', 'No name, even if they know who it is'], place: ['Where it is', 'Type name and district, like Payphone, Kabuki'], none: ['Nothing', 'Number withheld'] };
const TRACES = { owner: ['The holder', 'A Trace names whoever holds it'], label: ['The name you set', 'A Trace stops at the line\'s name'], place: ['Where it is', 'A Trace finds the place, not the person'], dead: ['A dead end', 'A Trace finds nothing'] };
const orgMark = (name, art) => `<span class="ncm-r3-org">${art ? `<img src="${esc(art)}" alt="">` : ''}${esc(name)}</span>`;
const callerName = (t) => (t.shows === 'ownerOrg' ? 'John Anderson' : t.shows === 'owner' ? 'Judy Alvarez' : t.shows === 'label' ? (t.label || t.name) : t.shows === 'number' ? 'Unknown caller' : t.shows === 'place' ? t.name + ', Kabuki' : 'Unknown caller');
const typeMark = (t) => `<span class="ncm-r3-ty" style="--tc:${t.color}" data-tooltip="${tipText(t.name)} line">${esc(t.name)}</span>`;
const typeWord = (t) => (t.word ? 'Incoming · ' + t.word : 'Incoming call');
const typeRing = (t) => hudCard({ word: typeWord(t), name: callerName(t), img: '', ring: t.ring, number: t.shows === 'none' ? '' : sampleNumber(t), org: t.shows === 'ownerOrg' ? { name: 'Militech', art: '' } : null });
const typeLog = (t, when, dir, st) => `<div class="ncm-r3-log"><i class="fas ${dir === 'in' ? 'fa-arrow-down-long' : 'fa-arrow-up-long'}" style="color:var(--ncm-${st === 'Missed' ? 'bad' : 'good'})"></i><span class="nm"><b>${esc(callerName(t))}</b>${t.shows === 'ownerOrg' ? '<span class="ncm-r3-logorg">Militech</span>' : ''}${t.shows === 'none' ? '' : esc(sampleNumber(t))}</span>${typeMark(t)}<span class="st">${esc(st)}</span><span class="ncm-pn-when">${esc(when)}</span></div>`;
function viewTypes() {
  const x = typeOf(S.typ) || TYPES[0];
  const row = (t) => `<button type="button" class="ncm-pn-prow${t === x ? ' on' : ''}" data-do="typ" data-id="${t.id}" data-tooltip="Open ${tipText(t.name)}"><span class="ncm-r3-swatch" style="--tc:${t.color}"></span><span class="bd"><span class="nm">${esc(t.name)}</span><span class="mt"><span class="ncm-pn-who">${t.hold === 'players' ? 'Players can add' : 'You give it out'}</span>${t.burn ? tagp('burns', 'is-attn', 'fa-fire') : ''}${t.ext ? tagp('extensions', 'is-plain', 'fa-hashtag') : ''}${t.fixed ? tagp('in one place', 'is-plain', 'fa-location-dot') : ''}</span></span></button>`;
  const lockTip = 'Standard is what every line is unless you say otherwise';
  const seeWord = SHOWS[x.shows][0] + (x.shows === 'label' && x.label ? ': ' + x.label : '');
  const editor = `
    <div class="ncm-pn-dh"><span class="ncm-r3-swatch lg" style="--tc:${x.color}"></span><label class="ncm-pn-f grow" data-tooltip="What you and players call this kind of line">Name<input type="text" id="ty-name" data-in="typ" data-k="name" value="${esc(x.name)}"${x.builtin ? ' disabled' : ''}></label></div>
    <div class="ncm-pn-ph" style="--sk:${x.color}"><h5>What a player sees</h5><div class="ncm-pn-fr">${themeSwitch()}</div><div class="ncm-r3-scene">${typeRing(x)}</div>${typeLog(x, '22:14', 'in', 'Answered')}</div>
    ${qsect('ty-see', 'fa-mobile-screen', 'What does the other person see?', 'var(--ncm-hue-3)', seeWord + ' · a Trace finds ' + TRACES[x.trace][0].toLowerCase(), `<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="${tipText(SHOWS[x.shows][1])}">Their screen shows<select id="ty-shows" data-ch="typSel" data-k="shows">${Object.entries(SHOWS).map(([k, v]) => opt(k, v[0], x.shows === k)).join('')}</select></label>${x.shows === 'label' ? `<label class="ncm-pn-f grow" data-tooltip="A default. Each line of this type can set its own">Name<input type="text" id="ty-label" data-in="typ" data-k="label" value="${esc(x.label)}"></label>` : ''}<label class="ncm-pn-f" data-tooltip="${tipText(TRACES[x.trace][1])}">A Trace finds<select id="ty-trace" data-ch="typSel" data-k="trace">${Object.entries(TRACES).map(([k, v]) => opt(k, v[0], x.trace === k)).join('')}</select></label></div>`)}
    ${qsect('ty-ring', 'fa-phone-volume', 'How does it ring?', 'var(--ncm-hue-5)', (x.word ? 'Says ' + x.word : 'No word') + ' · ' + RINGS[x.ring][0].toLowerCase() + ' dial', `<label class="ncm-pn-f" data-tooltip="Shown on the call screen and call log, like Incoming · Burner. Empty for an ordinary call">Word on the call screen<input type="text" id="ty-word" data-in="typ" data-k="word" value="${esc(x.word)}" placeholder="None"></label><div class="ncm-pn-f"><span data-tooltip="A small difference in how the dial moves. The colours always come from the player's theme">The dial</span>${seg3('typSet', 'ring', x.ring, Object.entries(RINGS).map(([k, v]) => [k, v[0], v[1]]))}</div>`)}
    ${qsect('ty-mark', 'fa-tag', 'What colour marks it?', 'var(--ncm-hue-3)', (COLORS.find(([c]) => c === x.color) || ['', 'Custom'])[1] + ', in logs and lists only', `<div class="ncm-r3-swatches" role="group" aria-label="Colour">${COLORS.map(([c, n]) => `<button type="button" class="${x.color === c ? 'on' : ''}" style="--tc:${c}" data-do="typSet" data-k="color" data-v="${c}" aria-label="${n}" data-tooltip="${tipText(n)}"></button>`).join('')}</div><small>It never touches the call screen.</small>`)}
    ${qsect('ty-beh', 'fa-sliders', 'What can it do?', 'var(--ncm-act)', [x.hold === 'players' ? 'Players can add it' : 'You give it out', x.burn && 'burns', x.ext && 'switchboard', x.fixed && 'one place'].filter(Boolean).join(' · '), `<div class="ncm-pn-f"><span data-tooltip="Whether players can add this type themselves, within their extra line limit">Who gets one</span>${seg3('typSet', 'hold', x.hold, [['players', 'Players can add', 'Counts against their extra line limit'], ['gm', 'You give it out', 'Only you can create these']])}</div><label class="ncm-pn-chk" data-tooltip="The holder gets a Burn button. Burned means retired for good"><input type="checkbox" id="ty-burn" data-ch="typChk" data-k="burn"${x.burn ? ' checked' : ''}><span>Can be burned</span></label><label class="ncm-pn-chk" data-tooltip="Callers reach a switchboard, and can dial an extension"><input type="checkbox" id="ty-ext" data-ch="typChk" data-k="ext"${x.ext ? ' checked' : ''}><span>Has a switchboard and extensions</span></label><label class="ncm-pn-chk" data-tooltip="Nobody holds it. You place it on a map like a terminal pin, and anyone there can call from it"><input type="checkbox" id="ty-fixed" data-ch="typChk" data-k="fixed"${x.fixed ? ' checked' : ''}><span>Sits in one place</span></label>`)}
    <div class="ncm-pn-acts"><span class="grow"></span>${x.builtin ? '<small>Standard can\'t be deleted.</small>' : btn('Delete', 'fa-trash', 'Remove this type. Its lines become Standard, and keep their numbers', 'data-do="typDel"', 'bad')}</div>`;
  return `<header class="ncm-tabhd"><i class="fas fa-layer-group"></i><div><h2>Line types</h2><p>Kinds of line, and how each one reads to the person on the other end. All yours to edit.</p></div></header>
    ${setupTabs()}${inner([['types', 'Line types', 'fa-layer-group', 'Standard, corporate, burner, payphone, business, and your own'], ['ring', 'What players see', 'fa-mobile-screen', 'Every type on the ring screen and in the call log']])}${undoLine()}
    <div class="ncm-pn-tb">${btn('New line type', 'fa-plus', 'Add your own kind of line', 'data-do="typNew"', 'pri')}</div>
    <div class="ncm-pn-split"><div class="ncm-pn-list" data-sc="tl">${TYPES.map(row).join('')}</div><div class="ncm-pn-detail" data-sc="td">${editor}</div></div>`;
}
function viewRing() {
  return `<header class="ncm-tabhd"><i class="fas fa-mobile-screen"></i><div><h2>What players see</h2><p>The real call screen. Change a type and it changes here.</p></div></header>
    ${setupTabs()}${inner([['types', 'Line types', 'fa-layer-group', 'Standard, corporate, burner, payphone, business, and your own'], ['ring', 'What players see', 'fa-mobile-screen', 'Every type on the ring screen and in the call log']])}
    <div class="ncm-pn-tb">${themeSwitch()}<small>Every type in the same player's theme. The wording and the dial tell them apart.</small></div><div class="ncm-pn-scroll" data-sc="rg"><div class="ncm-r3-gallery">${TYPES.map((t) => `<div class="ncm-pn-ph" style="--sk:${t.color}"><h5>${esc(t.name)}<span class="ncm-r3-dialw">${esc(RINGS[t.ring][0])} dial</span></h5><div class="ncm-r3-scene">${typeRing(t)}</div><small>${t.shows === 'ownerOrg' ? 'Their name first, then where they work. From their contact details, so nothing to set per person.' : t.shows === 'owner' ? 'Their name, if you have them saved. Once picked up, their portrait, or their initials and the swirl if they have none.' : t.shows === 'label' ? 'The same name and picture, whoever is calling.' : t.shows === 'number' ? 'No name, even if you know who holds it.' : t.shows === 'place' ? 'Where the phone is, not who is on it.' : 'Nothing but "Number withheld".'}</small></div>`).join('')}</div>
    <section class="ncm-pn-mod" style="--sk:var(--ncm-act)"><div class="ncm-pn-mh"><i class="fas fa-clock-rotate-left"></i> In the call log</div><div class="ncm-pn-mb">${TYPES.map((t, i) => typeLog(t, ['22:14', '21:40', '20:02', '18:30', '11:15'][i] || '09:00', i % 2 ? 'out' : 'in', i === 2 ? 'Missed' : 'Answered')).join('')}</div></section></div>`;
}
function viewCorp() {
  const o = OFFICES.find((x) => x.id === S.off);
  const row = (x) => `<button type="button" class="ncm-pn-prow${x === o ? ' on' : ''}" data-do="off" data-id="${x.id}" data-tooltip="Open ${tipText(x.name)}, ${tipText(x.city)}">${faceOf(x.name, '', x.art)}<span class="bd"><span class="nm">${esc(x.name)}</span><span class="ln">${pcolor(x.num)}</span><span class="mt">${hv(x.city, 'fa-location-dot')}${x.hidden ? tagp('hidden', 'is-secret', 'fa-eye-slash') : ''}${x.ext.length ? `<span class="ncm-pn-who">${x.ext.length} extension${x.ext.length === 1 ? '' : 's'}</span>` : ''}</span></span></button>`;
  const ansTip = { gm: 'Rings you. With no GM online it goes to voicemail', recording: 'Plays what you wrote, then offers the extensions', vm: 'Straight to voicemail' };
  const editor = `<div class="ncm-pn-dh">${faceOf(o.name, 'xl', o.art)}<div class="grow" style="min-width:0"><h3>${esc(o.name)}</h3><div class="tags">${hue(o.city, 'fa-location-dot')}${tagp('Corporate', 'is-plain', 'fa-building')}</div><div style="margin-top:3px">${pcolor(o.num)}</div><div class="ncm-pn-acts" style="margin-top:5px">${btn(o.art ? 'Change art' : 'Add art', 'fa-image', 'Your own art. The module ships no game logos', 'data-do="corpArt"')}</div></div></div>
    ${subTabs('coTab', S.coTab, [['sw', 'Who answers', 'fa-phone-volume', 'The switchboard, and what callers hear first'], ['ex', 'Extensions', 'fa-hashtag', 'People and departments reached through it'], ['ca', 'When it calls', 'fa-mobile-screen', 'What a player sees when this office rings them'], ['in', 'When they call', 'fa-phone', 'What a player gets on the main number']])}
    ${pane(S.coTab, 'sw', sect('fa-phone-volume', 'The switchboard', 'var(--ncm-hue-3)', `<div class="ncm-pn-f"><span data-tooltip="Who picks up when someone calls the main number">Who answers</span>${seg3('corpAns', 'answer', o.answer, [['gm', 'You', ansTip.gm], ['recording', 'A recording', ansTip.recording], ['vm', 'Voicemail', ansTip.vm]])}</div>${o.answer === 'recording' || o.answer === 'gm' ? `<label class="ncm-pn-f" data-tooltip="What they hear first">Greeting<input type="text" id="co-greet" data-in="corpGreet" value="${esc(o.greet)}"></label>` : ''}`))}
    ${pane(S.coTab, 'ex', sect('fa-hashtag', 'Extensions', 'var(--ncm-act)', `${o.ext.map((e, i) => `<div class="ncm-r3-ext"><span class="ncm-pnum is-plain"><span class="x">x${esc(e.x)}</span></span><span class="grow">${esc(e.who)}</span><label class="ncm-pn-chk" data-tooltip="Listed extensions show on the switchboard. An unlisted one still works if someone knows to type it"><input type="checkbox" id="ex-${i}" data-ch="extList" data-i="${i}"${e.listed ? ' checked' : ''}><span>Listed</span></label>${btn('', 'fa-trash', 'Remove this extension', `data-do="extDel" data-i="${i}"`, 'ic bad')}</div>`).join('') || '<small>None yet. Add a person or a department.</small>'}<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="Digits only">Extension<input type="text" id="ex-x" style="width:72px" placeholder="17"></label><label class="ncm-pn-f grow" data-tooltip="A contact in your directory, or just a department name">Reaches<input type="text" id="ex-who" placeholder="Name or department"></label>${btn('Add', 'fa-plus', 'Add this extension', 'data-do="extAdd"')}</div>`))}
    ${pane(S.coTab, 'ca', sect('fa-mobile-screen', 'When it calls a player', 'var(--ncm-good)', `<label class="ncm-pn-f" data-tooltip="Who the call comes from">Calling from<select id="co-from" data-ch="corpFrom">${o.ext.map((e) => opt(e.x, e.who + ' · x' + e.x, S.corpFrom === e.x)).join('')}${opt('main', 'The switchboard, nobody named', S.corpFrom === 'main' || !o.ext.some((e) => e.x === S.corpFrom))}</select></label>${themeSwitch()}<div class="ncm-r3-scene">${(() => { const e = o.ext.find((y) => y.x === S.corpFrom); const person = e && !/desk|projects|relations|payroll|security/i.test(e.who); return hudCard({ word: 'Incoming · Corporate', name: e ? e.who : o.name, img: person ? '' : o.art, ring: 'slow', number: seenFrom(parse(o.num)), org: e ? { name: o.name, art: o.art } : null }); })()}</div><small>The person comes first and the company sits under them, read from their contact details. If nobody is named, it shows the company. You can still choose Number withheld for any call, and players can Trace that.</small>`))}`;
  // the player's side: dial the main number, land on the switchboard
  const dialled = S.dialExt.trim();
  const hit = o.ext.find((e) => e.x === dialled);
  const listed = o.ext.filter((e) => e.listed);
  const board = `<div class="ncm-pn-ph" style="--sk:var(--ncm-hue-5)"><h5><i class="fas fa-phone"></i> What a player gets on the main number</h5><div class="ncm-r3-board"><div class="ncm-pn-dh">${faceOf(o.name, 'lg', o.art)}<div><b>${esc(o.name)}</b><div>${pcolor(o.num)}</div></div></div>
      ${o.answer === 'vm' ? `<div class="ncm-r3-say"><i class="fas fa-voicemail"></i> Goes straight to voicemail. Messages land with ${esc(game.nightcity?.masterContactService?.getContact?.(o.mailbox)?.name || `${o.name} switchboard`)}.</div>${btn('Change where they land', 'fa-inbox', 'Pick who holds messages left for this office. Leave it and a mailbox is made the first time someone leaves one', 'data-do="corpBox"')}` : `<div class="ncm-r3-say"><i class="fas fa-comment"></i> ${esc(o.greet || 'A person picks up.')}</div>`}
      ${listed.length && o.answer !== 'vm' ? `<div class="ncm-r3-keys">${listed.map((e) => `<button type="button" data-do="extDial" data-x="${esc(e.x)}" data-tooltip="Connect to ${tipText(e.who)}"><span class="ncm-pnum is-plain"><span class="x">x${esc(e.x)}</span></span> ${esc(e.who)}</button>`).join('')}</div>` : ''}
      ${o.ext.length && o.answer !== 'vm' ? `<label class="ncm-pn-f" data-tooltip="Works for unlisted extensions, if you know the number">Dial an extension<input type="text" id="ex-dial" data-in="extDial" value="${esc(S.dialExt)}" placeholder="66" autocomplete="off"></label>` : ''}
      <div id="ex-out">${dialled ? (hit ? `<div class="ncm-pn-check info"><i class="fas fa-phone"></i><span>Connecting to ${esc(hit.who)}.${hit.listed ? '' : ' Not on the menu, but it works.'}</span></div>` : '<div class="ncm-pn-check"><i class="fas fa-ban"></i><span>No such extension.</span></div>') : ''}</div></div></div>`;
  const q = S.coQ.trim().toLowerCase();
  const shown = OFFICES.filter((x) => (!q || (x.name + ' ' + x.city + ' ' + x.num + ' ' + x.ext.map((e) => e.who + ' x' + e.x).join(' ')).toLowerCase().includes(q)) && (S.coShow === 'all' || (S.coShow === 'ext' && x.ext.length) || (S.coShow === 'hidden' && x.hidden) || (S.coShow === 'noart' && !x.art) || (S.coShow === 'gm' && x.answer === 'gm')));
  const gkey = (x) => (S.coGroup === 'city' ? x.city : S.coGroup === 'corp' ? x.name : 'All offices');
  const gnames = uniq(shown.map(gkey)).sort((a, b) => a.localeCompare(b));
  const forced = !!q || S.coShow !== 'all';
  const groups = gnames.map((g, i) => { const list = shown.filter((x) => gkey(x) === g); const has = list.includes(o); const shut = !forced && (S.coShut.has(g) || (!S.coOpen.has(g) && !has && S.coGroup !== 'none' && i !== 0)); return `<button type="button" class="ncm-pn-gh${shut ? ' is-shut' : ''}" style="--sk:${hueOf(g)}" data-do="coFold" data-k="${esc(g)}" aria-expanded="${!shut}" data-tooltip="${tipText(shut ? 'Open' : 'Fold')} ${tipText(g)}"><i class="fas fa-chevron-down ch"></i>${esc(g)}<span class="grow"></span><span class="ncm-pn-count">${list.length}</span></button>${shut ? '' : list.map(row).join('')}`; }).join('') || '<div class="ncm-ph2-none">Nothing matches. Clear the search or filter.</div>';
  return `<header class="ncm-tabhd"><i class="fas fa-building"></i><div><h2>Corporations</h2><p>Each office is a line with a switchboard. Set who answers, and who can be reached through it.</p></div></header>${numbersTabs()}${undoLine()}
    <div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Search companies, cities, numbers and who is on an extension"><i class="fas fa-magnifying-glass"></i><input type="text" id="co-q" data-in="coQ" value="${esc(S.coQ)}" placeholder="Company, city, person" aria-label="Search offices"></label><label class="ncm-pn-sel" data-tooltip="Narrow the list"><span>Show</span><select id="co-show" data-ch="coShow">${[['all', 'All offices'], ['ext', 'Has extensions'], ['gm', 'Rings me'], ['hidden', 'Hidden'], ['noart', 'No art yet']].map(([k, l]) => opt(k, l, S.coShow === k)).join('')}</select></label><label class="ncm-pn-sel" data-tooltip="How the list is grouped"><span>Group</span><select id="co-group" data-ch="coGroup">${[['corp', 'Company'], ['city', 'City'], ['none', 'None']].map(([k, l]) => opt(k, l, S.coGroup === k)).join('')}</select></label><small>${shown.length} of ${OFFICES.length}</small></div>
    <div class="ncm-pn-split"><div class="ncm-pn-list" data-sc="cl">${groups}</div><div class="ncm-pn-detail" data-sc="cd">${editor}${pane(S.coTab, 'in', board)}</div></div>`;
}

/* ─── Overheard calls ─── */
const OV = () => game.nightcity?.overheardService;
const VIA_TONE = { tap: 'is-secret', room: 'is-attn', jack: 'is-act', scanner: 'is-plain' };
const VOICE_OPTS = [['', 'Side default', 'What this side uses unless you say otherwise'], ['text', 'Text', 'Subtitles, typed out'], ['tts', 'Read out', 'The browser reads it aloud, with subtitles']];
const ovScene = (id) => game.scenes?.get(id)?.name || 'Off-screen';
const ovBand = (ic, t, tone, sub = '') => '<div class="ncm-pn-band" style="--sk:' + tone + '"><i class="fas ' + ic + '"></i> ' + esc(t) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
const ovSect = (ic, t, tone, body, sub) => '<div class="ncm-pn-sect">' + ovBand(ic, t, tone, sub) + '<div class="in">' + body + '</div></div>';
const ovTabs = () => '<div class="ncm-pn-inner" role="tablist">' + [['ovhome', 'Your calls', 'fa-ear-listen', 'Every conversation you have written'], ['oveaves', 'Eavesdropping rules', 'fa-sliders', 'Who counts as in the room, which gear matters, what the rolls need']].map(([f, l, ic, tip]) => '<button type="button" role="tab" aria-selected="' + (S.f === f) + '" class="' + (S.f === f ? 'on' : '') + '" data-do="frame" data-f="' + f + '" data-tooltip="' + tipText(tip) + '"><i class="fas ' + ic + '"></i> ' + esc(l) + '</button>').join('') + '</div>';
const ovRunOf = (id) => [...(OV()?.runs?.values() || [])].find((r) => r.script.id === id && !r.ended) || null;
const ovCould = (c) => PCS().filter((p) => actorOf(p.id) && OV().waysOf(actorOf(p.id), c).ways.length);
function viewOvHome() {
  const q = (S.clq || '').trim().toLowerCase(), list = OV().scripts();
  const statusOf = (c) => (ovRunOf(c.id) ? 'running' : c.at ? 'scheduled' : 'ready');
  const shown = list.filter((c) => (!S.clShow || S.clShow === 'all' || statusOf(c) === S.clShow) && (!q || [c.name, c.tag, c.a.name, c.b.name, c.net, ...c.lines.map((x) => x.text)].join(' ').toLowerCase().includes(q))).sort((x, y) => ({ running: 0, scheduled: 1, ready: 2 }[statusOf(x)] - { running: 0, scheduled: 1, ready: 2 }[statusOf(y)]));
  const row = (c) => { const st = statusOf(c), n = ovCould(c), run = ovRunOf(c.id); return '<button type="button" class="ncm-r4-call' + (run ? ' is-live' : '') + '" data-do="ovOpen" data-id="' + esc(c.id) + '" data-tooltip="' + tipText(run ? 'Open the running call' : 'Open and edit') + '"><span class="ic"><i class="fas ' + (run ? 'fa-tower-broadcast' : c.at ? 'fa-clock' : 'fa-scroll') + '"></i></span><span class="grow"><b>' + esc(c.name) + '</b><small>' + esc(c.a.name || '?') + ' and ' + esc(c.b.name || '?') + ' · ' + esc(netName(c.net)) + ' · ' + (c.live ? 'you speak live' : c.lines.length + ' lines') + '</small></span>' + (n.length ? tagp(n.length + ' could hear', 'is-secret', 'fa-ear-listen', n.map((p) => p.name).join(', ')) : tagp('Nobody could hear', 'is-attn', 'fa-triangle-exclamation', 'As things stand, no player has a way in')) + (run ? tagp('Running · line ' + (run.idx + 1) + ' of ' + c.lines.length, 'is-good', 'fa-play') : c.at ? tagp(whenText(c.at), 'is-act', 'fa-clock') : tagp('Ready', 'is-plain')) + '</button>'; };
  return '<header class="ncm-tabhd"><i class="fas fa-ear-listen"></i><div><h2>Overheard calls</h2><p>Conversations your players can listen in on.</p></div></header>' + ovTabs() + undoLine()
    + '<p class="ncm-r4-lede">Write a conversation between two NPCs. It plays whether or not anyone is listening, and players only hear it if they have a way in.</p>'
    + '<div class="ncm-r4-how"><button type="button" class="ncm-r4-howh" data-do="ovHow" aria-expanded="' + !S.ovHowShut + '" data-tooltip="' + tipText(S.ovHowShut ? 'Open' : 'Fold') + ' this"><i class="fas fa-chevron-down ch"></i> How this works</button>' + (S.ovHowShut ? '' : flow([['fa-pen', 'You write it', 'Two NPCs, a network, and what they say.'], ['fa-play', 'You start it', 'Now, or at a game time. Nobody is told.'], ['fa-ear-listen', 'Players get in', 'Nearby, a tap, jacked in, or a scanner. Any time, even mid-call.'], ['fa-hand', 'You decide', 'Nothing notices them unless you say so.']])) + '</div>'
    + '<div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Search names, people, networks and what is said"><i class="fas fa-magnifying-glass"></i><input type="text" id="cl-q" data-in="clq" value="' + esc(S.clq || '') + '" placeholder="Find a call" aria-label="Find a call"></label><label class="ncm-pn-sel" data-tooltip="Narrow the list"><span>Show</span><select id="cl-show" data-ch="clShow">' + [['all', 'All calls'], ['running', 'Running'], ['scheduled', 'Scheduled'], ['ready', 'Ready']].map(([v, t]) => opt(v, t, (S.clShow || 'all') === v)).join('') + '</select></label><small>' + shown.length + ' of ' + list.length + '</small><span class="grow"></span>' + btn('New call', 'fa-plus', 'Write a new conversation', 'data-do="ovNew"', 'pri') + '</div>'
    + '<div class="ncm-pn-scroll ncm-r4-calls" data-sc="cl">' + (shown.map(row).join('') || '<div class="ncm-ph2-none">No calls yet. Write one.</div>') + '</div>';
}
const netName = (id) => game.nightcity?.networkService?.getAllNetworks?.().find?.((n) => n.id === id)?.name || id || 'No network';
function ovSide(c, k, label, tone) {
  const x = c[k], scenes = game.scenes?.contents || [];
  return ovSect('fa-phone', label, tone, '<div class="ncm-pn-f"><span data-tooltip="Any NPC or alias">Who</span>' + btn(x.name || 'Pick someone', 'fa-user', 'Search your directory', 'data-do="ovWho" data-k="' + k + '"') + '</div>'
    + '<label class="ncm-pn-f" data-tooltip="Players near them can overhear this side">Which scene<select id="ov-sc-' + k + '" data-ch="ovSet" data-k="' + k + '.sceneId">' + opt('', 'Off-screen', !x.sceneId) + scenes.map((s) => opt(s.id, s.name, x.sceneId === s.id)).join('') + '</select></label>'
    + (x.sceneId ? '<div class="ncm-pn-f"><span data-tooltip="Where the person on the phone is standing">They are at</span>' + seg3('ovSide', k + '.anchor', x.anchor === 'off' ? 'token' : x.anchor, [['token', 'Their token', 'Follows their token on the scene'], ['spot', 'A spot I click', 'For an NPC with no token']]) + '</div>' : '')
    + '<label class="ncm-pn-f" data-tooltip="What a listener can tell about them. A Trace still works">Listeners see<select id="ov-sh-' + k + '" data-ch="ovSet" data-k="' + k + '.shows">' + [['name', 'Their name'], ['number', 'Their number'], ['anon', 'Nothing, withheld']].map(([v, t]) => opt(v, t, x.shows === v)).join('') + '</select></label>'
    + '<label class="ncm-pn-f" data-tooltip="How their lines play unless a line says otherwise">Their voice<select id="ov-v-' + k + '" data-ch="ovSet" data-k="' + k + '.voice">' + VOICE_OPTS.slice(1).map(([v, t]) => opt(v, t, x.voice === v)).join('') + '</select></label>');
}
function ovSay(c) {
  const q = (S.lq || '').trim().toLowerCase(), shw = S.lshow || 'all', nm = (s) => c[s].name || (s === 'a' ? 'First' : 'Second');
  const list = c.lines.map((x, i) => ({ x, i })).filter(({ x }) => (!q || x.text.toLowerCase().includes(q)) && (shw === 'all' || (shw === 'a' || shw === 'b' ? x.side === shw : x.marks.includes(shw))));
  const row = ({ x, i }) => { const open = S.lnOpen === i; return '<div class="ncm-r4-line' + (open ? ' is-open' : '') + '"><div class="top"><span class="n">' + (i + 1) + '</span><button type="button" class="ncm-r4-side is-' + x.side + '" data-do="lnSide" data-i="' + i + '" data-tooltip="Switch who says this">' + esc(initials(nm(x.side))) + '</button><input type="text" id="ln-' + i + '" data-in="lnText" data-i="' + i + '" value="' + esc(x.text) + '" aria-label="Line ' + (i + 1) + '" data-tooltip="The text is always there: subtitles, the transcript, what a tap copies">' + x.marks.map((k) => tagp(OVERHEARD_MARKS[k][0], OVERHEARD_MARKS[k][1], OVERHEARD_MARKS[k][2], OVERHEARD_MARKS[k][3])).join('') + '<button type="button" class="ncm-r4-more" data-do="lnOpen" data-i="' + i + '" aria-expanded="' + open + '" data-tooltip="Voice, timing and marks for this line"><i class="fas fa-sliders"></i></button>' + btn('', 'fa-trash', 'Delete this line', 'data-do="lnDel" data-i="' + i + '"', 'ic bad') + '</div>'
    + (open ? '<div class="det"><label class="ncm-pn-f" data-tooltip="How this line plays">Voice<select id="lnv-' + i + '" data-ch="lnVoice" data-i="' + i + '">' + VOICE_OPTS.map(([v, t]) => opt(v, t, x.voice === v)).join('') + '</select></label><label class="ncm-pn-f" data-tooltip="Seconds of quiet before this line">Wait<input type="number" id="lnd-' + i + '" min="0" max="30" data-ch="lnDelay" data-i="' + i + '" value="' + x.delay + '" style="width:60px"></label><div class="ncm-pn-f"><span>Marks</span><span class="marks">' + Object.entries(OVERHEARD_MARKS).map(([k, [t, , ic, h]]) => '<button type="button" class="ncm-r4-markb' + (x.marks.includes(k) ? ' on' : '') + '" data-do="lnMark" data-i="' + i + '" data-k="' + k + '" aria-pressed="' + x.marks.includes(k) + '" data-tooltip="' + tipText(h) + '"><i class="fas ' + ic + '"></i> ' + t + '</button>').join('') + '</span></div>' + (x.marks.includes('code') ? '<label class="ncm-pn-f ncm-r4-means" data-tooltip="Listeners never see this">What it really means<input type="text" id="lnm-' + i + '" data-in="lnMeans" data-i="' + i + '" value="' + esc(x.means || '') + '" placeholder="Only you see this"></label>' : '') + '</div>' : '') + '</div>'; };
  return '<div class="ncm-pn-fr"><div class="ncm-pn-f"><span data-tooltip="Written ahead and played out, or you speak for both sides as it happens">How it plays</span>' + seg3('ovDel', 'live', c.live ? 'live' : 'script', [['script', 'From a script', 'Lines are written ahead and play in real time'], ['live', 'I type it live', 'You speak for both sides from the running screen']]) + '</div></div>'
    + (c.live ? '<div class="ncm-pn-check info"><i class="fas fa-keyboard"></i><span>Once it starts, the running screen gets a side switch and a text box.</span></div>'
      : '<div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Find a line"><i class="fas fa-magnifying-glass"></i><input type="text" id="ln-q" data-in="lq" value="' + esc(S.lq || '') + '" placeholder="Find a line" aria-label="Find a line"></label><label class="ncm-pn-sel" data-tooltip="Narrow the lines"><span>Show</span><select id="ln-show" data-ch="lshow">' + [['all', 'All lines'], ['a', nm('a')], ['b', nm('b')], ['clue', 'Clues'], ['lie', 'Lies'], ['code', 'Code words']].map(([v, t]) => opt(v, t, shw === v)).join('') + '</select></label><small>' + list.length + ' of ' + c.lines.length + '</small>' + btn('Add a line', 'fa-plus', 'Add a line at the end, for the other person', 'data-do="lnAdd"') + '</div><div class="ncm-r4-lines" data-sc="ln">' + (list.map(row).join('') || '<small>No lines yet.</small>') + '</div><div class="ncm-r4-legend">' + Object.values(OVERHEARD_MARKS).map(([t, tone, ic, h]) => '<span>' + tagp(t, tone, ic) + '<small>' + esc(h) + '.</small></span>').join('') + '</div>');
}
function ovHear(c) {
  const pcs = PCS(), n = ovCould(c).length;
  const head = n ? '<div class="ncm-pn-check info"><i class="fas fa-ear-listen"></i><span><b>' + n + ' of ' + pcs.length + ' players could hear this.</b> Nobody gets told. They only find out if they listen.</span></div>' : '<div class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span><b>Nobody could hear this.</b> It will still play and leave its record. To change that, move someone onto a scene with them or use a network a player has tapped.</span></div>';
  return head + pcs.map((p) => { const a = actorOf(p.id); if (!a) return ''; const { ways, why } = OV().waysOf(a, c); return '<div class="ncm-r4-hear' + (ways.length ? '' : ' is-no') + '">' + face(p) + '<div class="grow"><b>' + esc(p.name) + '</b><div class="mt">' + (ways.length ? ways.map((x) => tagp(x.text, VIA_TONE[x.k], OVERHEARD_WAYS[x.k].icon, OVERHEARD_WAYS[x.k].tip)).join('') : '<small>No way in. ' + esc(why.join('. ')) + '.</small>') + '</div></div></div>'; }).join('');
}
function viewOvStage() {
  if (!S.ovEdit) { S.f = 'ovhome'; return viewOvHome(); }
  const c = S.ovEdit, step = S.stStep || 1;
  const nets = game.nightcity?.networkService?.getAllNetworks?.() || [];
  const opt2 = (id, k, title, what, on) => '<label class="ncm-pn-chk ncm-r4-opt" data-tooltip="' + tipText(what) + '"><input type="checkbox" id="' + id + '" data-ch="ovChk" data-k="' + k + '"' + (on ? ' checked' : '') + '><span><b>' + esc(title) + '</b><small>' + esc(what) + '</small></span></label>';
  const STEPS = [['Who is talking', 'Two people and a network', () => '<label class="ncm-pn-f" data-tooltip="What this call is called. Only you see it">Name<input type="text" id="ov-name" data-in="ovName" value="' + esc(c.name) + '"></label><div class="ncm-r4-sides">' + ovSide(c, 'a', 'First person', 'var(--ncm-act)') + ovSide(c, 'b', 'Second person', 'var(--ncm-hue-1)') + '</div><label class="ncm-pn-f" data-tooltip="Taps on this network\'s nodes can hear it">Network the call goes over<select id="st-net" data-ch="ovSet" data-k="net">' + opt('', 'None', !c.net) + nets.map((x) => opt(x.id, x.name, c.net === x.id)).join('') + '</select></label>'],
    ['What they say', 'A script, or you speak live', () => ovSay(c)],
    ['Start it', 'Who could hear it, and when it starts', () => ovSect('fa-ear-listen', 'Who could hear this', 'var(--ncm-secret)', ovHear(c), 'Right now. Anyone can still join once it is running') + '<div class="ncm-pn-f"><span data-tooltip="Later uses game time">When it starts</span>' + btn(c.at ? whenText(c.at) : 'When I press Start', 'fa-clock', 'Pick a game time, or clear it', 'data-do="ovWhen"') + (c.at ? btn('', 'fa-xmark', 'Start it by hand instead', 'data-do="ovWhenOff"', 'ic') : '') + '</div>' + opt2('st-rec', 'rec', 'Leave a record on terminals', 'A trail on accounts linked to these two, for players to find later.', c.rec) + opt2('st-enc', 'enc', 'Encrypted', 'Tap, jack-in and scanner get noise without a descrambler. The room still hears it.', c.enc)]];
  const [, , fn] = STEPS[step - 1];
  const live = ovRunOf(c.id);
  return '<header class="ncm-tabhd"><i class="fas fa-pen"></i><div><h2>' + esc(c.name) + '</h2><p>Write the conversation. Players are never on this call.</p></div><div class="ncm-tabhd__end">' + btn('All calls', 'fa-arrow-left', 'Back. What you wrote is saved', 'data-do="ovBack"') + '</div></header>' + undoLine()
    + '<div class="ncm-r4-summary"><b>' + esc(c.a.name || '?') + '</b> <small>' + esc(ovScene(c.a.sceneId)) + '</small> <i class="fas fa-arrows-left-right"></i> <b>' + esc(c.b.name || '?') + '</b> <small>' + esc(ovScene(c.b.sceneId)) + '</small><span class="grow"></span>' + hv(netName(c.net), 'fa-tower-cell') + ' <small>' + (c.live ? 'You speak live' : c.lines.length + ' line' + (c.lines.length === 1 ? '' : 's')) + '</small></div>'
    + '<div class="ncm-r4-stepbar" role="tablist">' + STEPS.map(([x, y], i) => '<button type="button" role="tab" aria-selected="' + (i + 1 === step) + '" class="' + (i + 1 === step ? 'on' : i + 1 < step ? 'done' : '') + '" data-do="stStep" data-i="' + (i + 1) + '" data-tooltip="' + tipText(y) + '"><span class="n">' + (i + 1 < step ? '<i class="fas fa-check"></i>' : i + 1) + '</span>' + esc(x) + '</button>').join('') + '</div>'
    + '<div class="ncm-pn-scroll" data-sc="st' + step + '">' + fn() + '</div>'
    + '<div class="ncm-r4-foot">' + (step > 1 ? btn('Back', 'fa-arrow-left', 'The step before', 'data-do="stStep" data-i="' + (step - 1) + '"') : btn('Delete', 'fa-trash', 'Delete this call', 'data-do="ovDel2"', 'bad')) + '<span class="grow"></span>' + (step < 3 ? btn('Next: ' + STEPS[step][0], 'fa-arrow-right', 'The next step', 'data-do="stStep" data-i="' + (step + 1) + '"', 'pri') : live ? btn('Open it', 'fa-tower-broadcast', 'It is running', 'data-do="ovOpen" data-id="' + esc(c.id) + '"', 'pri') : c.at ? btn('Schedule it', 'fa-clock', 'It starts on its own at that game time', 'data-do="ovBack"', 'pri') : btn('Start the call', 'fa-play', 'It starts playing now', 'data-do="ovStart"', 'pri')) + '</div>';
}
function viewOvRun() {
  const run = OV()?.runs?.get(S.ovRun);
  if (!run) { S.f = 'ovhome'; return viewOvHome(); }
  const c = run.script, total = c.lines.length, pct = total ? Math.round(((run.ended ? total : run.idx + 1) / total) * 100) : 0;
  const nm = (s) => c[s].name || (s === 'a' ? 'First' : 'Second');
  const lines = c.lines.map((x, i) => '<div class="ncm-r4-rl' + (i === run.idx && !run.ended ? ' on' : '') + (i < run.idx || run.ended ? ' done' : '') + '"><button type="button" data-do="ovJump" data-i="' + i + '" data-tooltip="Jump to this line"><span class="ncm-r4-side is-' + x.side + '">' + esc(initials(nm(x.side))) + '</span><span class="tx">' + esc(x.text) + '</span>' + x.marks.map((k) => tagp(OVERHEARD_MARKS[k][0], OVERHEARD_MARKS[k][1], OVERHEARD_MARKS[k][2], OVERHEARD_MARKS[k][3])).join('') + (x.means ? '<small class="ncm-r4-mean">Means: ' + esc(x.means) + '</small>' : '') + '</button></div>').join('');
  const listeners = [...run.listeners.values()];
  const others = PCS().filter((p) => !listeners.some((l) => l.actorId === p.id));
  const compose = c.live && !run.ended ? '<div class="ncm-r5-compose" data-tooltip="Only on your screen. Lines reach each listener garbled by how they got in">' + seg3('tlSide', 'side', S.tlSide || 'a', [['a', nm('a'), 'The next line is theirs. Tab switches'], ['b', nm('b'), 'The next line is theirs. Tab switches']]) + '<input type="text" id="tl-in" data-tl-in placeholder="What ' + esc(nm(S.tlSide || 'a')) + ' says, then Enter" aria-label="What they say" autocomplete="off">' + seg3('tlVoice', 'voice', S.tlVoice || 'text', VOICE_OPTS.slice(1).map(([v, t, h]) => [v, t, h])) + btn('Send', 'fa-paper-plane', 'Enter also sends', 'data-do="tlSend"', 'go') + '<small class="ncm-r5-hint">Enter sends and passes to the other side. Tab switches who is talking.</small></div>' : '';
  return '<header class="ncm-tabhd"><i class="fas fa-tower-broadcast"></i><div><h2>' + esc(c.name) + '</h2><p>' + (run.ended ? 'This call has ended.' : 'Running now. Nothing notices a listener unless you say so.') + '</p></div><div class="ncm-tabhd__end">' + btn('All calls', 'fa-arrow-left', 'Back', 'data-do="frame" data-f="ovhome"') + '</div></header>' + undoLine()
    + '<div class="ncm-r4-transport"><div class="who"><b>' + esc(nm('a')) + '</b> <i class="fas fa-arrows-left-right"></i> <b>' + esc(nm('b')) + '</b> ' + hv(netName(c.net), 'fa-tower-cell') + ' ' + (run.ended ? tagp('Ended', 'is-plain') : c.live ? tagp('You speak', 'is-act', 'fa-keyboard') : run.playing ? tagp('Playing', 'is-good', 'fa-play') : tagp('Paused', 'is-attn', 'fa-pause')) + '<span class="grow"></span><small>Line ' + Math.max(1, Math.min(run.idx + 1, total || 1)) + ' of ' + total + '</small></div><div class="bar"><i style="width:' + pct + '%"></i></div><div class="ncm-pn-acts">' + (run.ended || c.live ? '' : btn(run.playing ? 'Pause' : 'Play', run.playing ? 'fa-pause' : 'fa-play', run.playing ? 'Hold on this line' : 'Carry on', 'data-do="ovPlay"', 'go') + btn('Next line', 'fa-forward-step', 'Skip to the next line', 'data-do="ovNext"')) + '<span class="grow"></span>' + (run.ended ? '' : btn('End the call', 'fa-phone-slash', 'They hang up', 'data-do="ovEnd"', 'bad')) + '</div></div>' + compose
    + '<div class="ncm-pn-split ncm-r3-half"><div class="ncm-pn-detail" data-sc="ru1">' + ovSect('fa-comments', 'What is being said', 'var(--ncm-act)', '<div class="ncm-r4-rlist" data-sc="rl">' + (lines || '<small>Nothing said yet.</small>') + '</div>', 'Click a line to jump') + '</div><div class="ncm-pn-detail" data-sc="ru2">'
    + ovSect('fa-ear-listen', 'Who is listening', 'var(--ncm-secret)', (listeners.map((x) => { const best = Math.min(...Object.keys(x.ways).map((k) => OVERHEARD_WAYS[k].garble)) - (x.enhance || 0), g = Math.max(0, best), cl = cluesHeard(x, c.lines, run.idx); return '<div class="ncm-r4-li">' + faceName(x.name) + '<div class="grow"><b>' + esc(x.name) + '</b><div class="mt">' + Object.keys(x.ways).map((k) => tagp(OVERHEARD_WAYS[k].label, VIA_TONE[k], OVERHEARD_WAYS[k].icon)).join('') + '<small>' + (g ? (100 - g) + '% clear' : 'Clear') + ' · ' + (x.line ? 'joined on line ' + (x.line + 1) : 'from the start') + '</small>' + (cl ? '<small class="ncm-r4-clues">' + (cl.got ? '<i class="fas fa-key"></i> ' : '') + cl.got + ' of ' + cl.of + ' clues so far</small>' : '') + '</div></div>' + btn('Cut', 'fa-scissors', 'Drop just this listener. Their screen says the line went dead', 'data-do="ovCut" data-u="' + esc(x.userId) + '"') + btn('', 'fa-fire', 'Cut them and fire a trace, with heat', 'data-do="ovCutT" data-u="' + esc(x.userId) + '"', 'ic bad') + '</div>'; }).join('') || '<small>Nobody is listening. The call carries on anyway.</small>'))
    + ovSect('fa-hand', 'If you want them to notice', 'var(--ncm-attn)', '<div class="ncm-pn-acts">' + btn('A click on the line', 'fa-ear-deaf', 'Every listener sees: A click on the line. Then play out what the NPCs do', 'data-do="ovClick"') + '</div>' + (run.clickAt !== null ? '<div class="ncm-pn-check info"><i class="fas fa-ear-deaf"></i><span>Every listener saw: A click on the line.</span></div>' : '') + '<small>Only a failed jack-in roll traces by itself, the way it does today.</small>')
    + (others.length ? ovSect('fa-person-walking-arrow-right', 'Everyone else', 'var(--ncm-hue-3)', '<small>They can join at any point and hear from that line on.</small>' + others.map((p) => { const a = actorOf(p.id); if (!a) return ''; const { ways, why } = OV().waysOf(a, c); return '<div class="ncm-r4-hear' + (ways.length ? '' : ' is-no') + '">' + face(p) + '<div class="grow"><b>' + esc(p.name) + '</b><div class="mt">' + (ways.length ? ways.map((x) => tagp(x.text, VIA_TONE[x.k], OVERHEARD_WAYS[x.k].icon, OVERHEARD_WAYS[x.k].tip)).join('') : '<small>No way in. ' + esc(why.join('. ')) + '.</small>') + '</div></div></div>'; }).join('')) : '') + '</div></div>';
}
const faceName = (n) => '<span class="ncm-pn-face" style="--tc:' + hueOf(n) + '">' + esc(initials(n)) + '</span>';
function viewOvEaves() {
  const r = OV().rules;
  const list = (k, label, tip) => '<div class="ncm-pn-f"><span data-tooltip="' + tipText(tip) + '">' + esc(label) + (r[k].length > 1 ? ' <small>any one counts</small>' : '') + '</span><div class="ncm-pn-holders">' + r[k].map((it, i) => '<span class="ncm-item-chip">' + (it.img ? '<img class="ncm-item-art" src="' + esc(it.img) + '" alt="">' : '<span class="ncm-item-art is-none"><i class="fas fa-box"></i></span>') + esc(it.name) + '<button type="button" data-do="evItemOff" data-k="' + k + '" data-i="' + i + '" aria-label="Remove ' + esc(it.name) + '" data-tooltip="Remove"><i class="fas fa-xmark"></i></button></span>').join('') + btn('Add', 'fa-plus', 'Pick items from your world', 'data-do="evItemAdd" data-k="' + k + '"') + '</div></div>';
  return '<header class="ncm-tabhd"><i class="fas fa-sliders"></i><div><h2>Eavesdropping rules</h2><p>Apply to every overheard call. The defaults work without touching any of them.</p></div></header>' + ovTabs() + undoLine() + '<div class="ncm-pn-scroll" data-sc="wa">'
    + qsect('ev-room', 'fa-person-rays', 'Who counts as in the room?', 'var(--ncm-attn)', r.room === 'tokens' ? 'Tokens within ' + r.range + ' squares' : 'Anyone on the same scene', '<div class="ncm-pn-fr"><div class="ncm-pn-f"><span data-tooltip="What counts as near">Near means</span>' + seg3('evSet', 'room', r.room, [['tokens', 'Tokens in range', 'A token within this many squares of the NPC'], ['scene', 'Same scene', 'Anyone on the scene']]) + '</div>' + (r.room === 'tokens' ? '<label class="ncm-pn-f" data-tooltip="Squares">Squares<input type="number" id="ru-range" data-ch="evNum" data-k="range" min="1" max="60" value="' + r.range + '" style="width:70px"></label>' : '') + '</div>' + list('amp', 'Hears further with', 'Carrying this doubles the range') + '<small>Checked when the call starts and whenever a token moves.</small>')
    + qsect('ev-gear', 'fa-screwdriver-wrench', 'What gear matters?', 'var(--ncm-hue-3)', (r.scanner.length + r.desc.length + r.stress.length) + ' items set', list('scanner', 'Radio scanner', 'Shows a Scan button. Hears calls on this scene with no node, heavily garbled') + list('desc', 'Descrambler', 'Needed to hear an encrypted call through anything but the room') + list('stress', 'Voice stress analyzer', 'Flags lines you marked as a lie'))
    + qsect('ev-roll', 'fa-dice-d20', 'What do the rolls need?', 'var(--ncm-act)', 'Enhance DV ' + r.dv + ' · Listen to traffic DV ' + r.jackDv, '<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="The skill Enhance rolls">Enhance rolls<select id="ru-sk" data-ch="evSk">' + ['Interface', 'Electronics/Security Tech', 'Basic Tech', 'Perception'].map((x) => opt(x, x, r.skill === x)).join('') + '</select></label><label class="ncm-pn-f" data-tooltip="Beat it to clear words. Beat it by more to clear more">Against DV<input type="number" id="ru-dv" data-ch="evNum" data-k="dv" min="1" max="40" value="' + r.dv + '" style="width:70px"></label></div><small>Listen to traffic is set with the other node actions, under Security, Hacking rules, Jacking in.</small>')
    + qsect('ev-rec', 'fa-desktop', 'Do these calls leave a trail?', 'var(--ncm-hue-5)', r.records ? 'Yes, on linked terminals' : 'No', '<label class="ncm-pn-chk" data-tooltip="Each call can override this"><input type="checkbox" id="ru-rec" data-ch="evChk" data-k="records"' + (r.records ? ' checked' : '') + '><span>Leave a record on terminal accounts linked to them</span></label>') + '</div>';
}

/* ─── Trauma Team and Backup: setup ─── */
const EM = () => game.nightcity?.emergencyService;
const emCfg = () => sanitizeEmergency(SVC._get('phoneEmergency', {}));
const saveEm = (cfg) => SVC._saveEmergency(cfg);
const emInner = () => '<div class="ncm-pn-inner" role="tablist">' + [['trauma', 'Trauma Team', 'fa-truck-medical', 'Who is covered, when it calls, who answers'], ['backup', 'Lawman Backup', 'fa-shield-halved', 'Who a Lawman reaches, by rank and organization']].map(([f, l, ic, tip]) => '<button type="button" role="tab" aria-selected="' + (S.f === f) + '" class="' + (S.f === f ? 'on' : '') + '" data-do="frame" data-f="' + f + '" data-tooltip="' + tipText(tip) + '"><i class="fas ' + ic + '"></i> ' + esc(l) + '</button>').join('') + '</div>';
const actorOf = (id) => game.actors?.get(id);
const itemsOf = (id) => actorOf(id)?.items?.contents || [];
const itemChip = (it, how, cls) => '<span class="ncm-item-chip ' + cls + '" data-tooltip="' + tipText(how) + '">' + (it.img ? '<img class="ncm-item-art" src="' + esc(it.img) + '" alt="">' : '<span class="ncm-item-art is-none"><i class="fas fa-box"></i></span>') + esc(it.name) + '</span>';
function itemListRow(list, key, label, tip) {
  return '<div class="ncm-pn-f"><span data-tooltip="' + tipText(tip) + '">' + esc(label) + (list.length > 1 ? ' <small>any one counts</small>' : '') + '</span><div class="ncm-pn-holders">' + list.map((it, i) => '<span class="ncm-item-chip">' + (it.img ? '<img class="ncm-item-art" src="' + esc(it.img) + '" alt="">' : '<span class="ncm-item-art is-none"><i class="fas fa-box"></i></span>') + esc(it.name) + '<button type="button" data-do="ttItemOff" data-k="' + key + '" data-i="' + i + '" aria-label="Remove ' + esc(it.name) + '" data-tooltip="Remove"><i class="fas fa-xmark"></i></button></span>').join('') + btn('Add', 'fa-plus', 'Pick items from your world', 'data-do="ttItemAdd" data-k="' + key + '"') + '</div></div>';
}
/* The words and look of a call. One editor: a person, an organization, Trauma Team. A blank box inherits. */
const emPending = new Map();
let emTimer = null;
/** Write what is still waiting from the boxes. Runs before any button, so Play always plays what was typed. */
async function emFlush() {
  clearTimeout(emTimer);
  if (!emPending.size) return;
  const c = emCfg();
  for (const [at, text] of emPending) {
    const cut = at.lastIndexOf('|'), h = voiceHolder(c, at.slice(0, cut)), key = at.slice(cut + 1);
    if (!h) continue;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length) h.voice[key] = lines; else delete h.voice[key];
  }
  emPending.clear();
  await saveEm(c);
}
const soundName = (id) => SOUND_INFO[id]?.label || id;
function emSlots({ slots, scope, kind, own, behind }) {
  const from = voiceSources(slots, behind);
  const row = (s) => {
    const mine = own?.[s.key] || [], inh = from[s.key];
    const src = mine.length ? (mine.length > 1 ? mine.length + ' lines, 1 per call' : 'Changed here') : (inh.from === 'Built in' ? 'Built in' : 'From ' + inh.from);
    const bad = badTokens(mine, kind);
    return '<div class="ncm-emv__slot' + (mine.length ? ' is-own' : '') + (s.title ? ' is-title' : '') + '"><span class="l">' + esc(s.label) + '<small>' + esc(s.hint) + '</small></span>'
      + '<textarea rows="' + Math.max(1, Math.min(4, mine.length || inh.lines.length)) + '" data-in="emLine" data-scope="' + esc(scope) + '" data-k="' + s.key + '" aria-label="' + esc(s.label) + '" placeholder="' + esc(inh.lines.join('\n') || 'Blank: gets a channel number') + '">' + esc(mine.join('\n')) + '</textarea>'
      + '<span class="ncm-emv__src">' + esc(src) + '</span>'
      + (mine.length ? btn('', 'fa-rotate-left', 'Use the inherited words', 'data-do="emClear" data-scope="' + esc(scope) + '" data-k="' + s.key + '"', 'ic') : '<span></span>')
      + (bad.length ? '<div class="ncm-emv__bad"><i class="fas fa-triangle-exclamation"></i> ' + esc(bad.join(', ')) + ' is not a fill-in, so it shows as typed.</div>' : '') + '</div>';
  };
  return '<div class="ncm-emv__tokens">Fill-ins ' + LINE_TOKENS[kind].map((t) => '<button type="button" class="ncm-emv__tok" data-do="emTok" data-t="{' + t + '}" data-tooltip="Puts {' + tipText(t) + '} where you are typing">{' + t + '}</button>').join('') + '</div>'
    + '<div class="ncm-emv__note">Leave a box blank to inherit. Several lines in a box: one is picked each call.</div>'
    + '<div class="ncm-emv__group">Lines</div><div class="ncm-emv__slots">' + slots.filter((s) => !s.title).map(row).join('') + '</div>'
    + '<div class="ncm-emv__group">Titles</div><div class="ncm-emv__slots">' + slots.filter((s) => s.title).map(row).join('') + '</div>';
}
function emLook({ scope, look, behindLabel, behind, img = null }) {
  const a = 'data-scope="' + esc(scope) + '"';
  const fromWord = behindLabel ? 'From ' + behindLabel : 'By kind';
  const lit = look.lights === true ? 'on' : look.lights === false ? 'off' : '';
  const seg = '<div class="ncm-pn-seg" role="group">' + [['', fromWord], ['on', 'On'], ['off', 'Off']].map(([v, t]) => '<button type="button" class="' + (lit === v ? 'on' : '') + '" data-do="emLight" ' + a + ' data-v="' + v + '" data-tooltip="Red and blue at the edges of the screen">' + esc(t) + '</button>').join('') + '</div>';
  const snd = (k, label) => { const cur = look[k] || behind[k]; return '<span class="l" data-tooltip="To replace the file itself, use the Sound Board">' + label + '</span><span class="v"><select id="emv-' + k + '" data-ch="emSound" ' + a + ' data-k="' + k + '" aria-label="' + label + '">' + opt('', fromWord + ' (' + soundName(behind[k]) + ')', !look[k]) + EMERGENCY_SOUNDS.map((id) => opt(id, soundName(id), look[k] === id)).join('') + '</select>' + btn('', 'fa-volume-high', 'Hear ' + soundName(cur), 'data-do="emHear" data-v="' + esc(cur) + '"', 'ic') + '</span>'; };
  return '<div class="ncm-emv__look"><span class="l" data-tooltip="The rings, the sweep, the tracker and the arrival banner">Colour</span><span class="v"><input type="color" id="emv-color" data-ch="emColor" ' + a + ' value="' + esc(look.color || behind.color) + '" aria-label="Colour">' + (look.color ? btn('', 'fa-rotate-left', 'Use the inherited colour', 'data-do="emLookOff" ' + a + ' data-k="color"', 'ic') : '<span>' + esc(fromWord) + '</span>') + '</span>'
    + '<span class="l">Lights</span><span class="v">' + seg + '</span>' + snd('openSound', 'Opening sound') + snd('arriveSound', 'Arrival sound')
    + (img === null ? '' : '<span class="l" data-tooltip="A group\'s own picture still wins">Picture</span><span class="v">' + (img ? '<img class="ncm-r3-bkart" src="' + esc(img) + '" alt="">' : '') + btn(img ? 'Change picture' : 'Add a picture', 'fa-image', 'Shows on this person\'s calls and when their people arrive', 'data-do="emArt" ' + a) + (img ? btn('', 'fa-xmark', 'Remove the picture', 'data-do="emArtOff" ' + a, 'ic') : '') + '<span>Beats ' + esc(behindLabel) + '\'s picture, not a group\'s own</span></span>')
    + '</div>';
}
function emPerson(p, cfg) {
  const orgId = cfg.backup.orgs[cfg.backup.chars[p.id]] ? cfg.backup.chars[p.id] : (cfg.backup.orgs.book ? 'book' : Object.keys(cfg.backup.orgs)[0]);
  const o = cfg.backup.orgs[orgId], me = cfg.backup.people[p.id] || { voice: {}, look: {}, img: '', groups: [] }, scope = 'p:' + p.id, tab = S.bkTab || 'words';
  const word = (r) => (r.r1 === r.r2 ? r.r1 : r.r1 + '-' + r.r2);
  const top = '<div class="ncm-emv__top"><div class="ncm-pn-seg" role="tablist">' + [['words', 'What they say', 'fa-comment'], ['people', 'Their people', 'fa-people-group'], ['look', 'How it looks', 'fa-palette']].map(([k, l, ic]) => '<button type="button" role="tab" aria-selected="' + (tab === k) + '" class="' + (tab === k ? 'on' : '') + '" data-do="bkTabPick" data-v="' + k + '"><i class="fas ' + ic + '"></i> ' + esc(l) + '</button>').join('') + '</div><span class="sp"></span>'
    + btn('Play', 'fa-play', 'Plays this person\'s call on your screen. The dice are only for show, and nothing is saved', 'data-do="emPlay" data-how="backup" data-a="' + esc(p.id) + '"') + btn('Nobody free', 'fa-play', 'The same call when the roll fails', 'data-do="emPlay" data-how="busy" data-a="' + esc(p.id) + '"') + btn('Arrival', 'fa-play', 'The on scene banner. Only you see this one', 'data-do="emPlay" data-how="arrive" data-a="' + esc(p.id) + '"') + '</div>';
  let body = '';
  if (tab === 'words') body = emSlots({ slots: BACKUP_SLOTS, scope, kind: 'backup', own: me.voice, behind: [{ label: o?.name || 'Organization', voice: o?.voice }] });
  if (tab === 'look') body = emLook({ scope, look: me.look, behindLabel: o?.name || 'Organization', behind: backupLook(o?.kind, o?.look), img: me.img || '' });
  if (tab === 'people') body = '<div class="ncm-emv__note">Added to ' + esc(o?.name || 'their organization') + '\'s list for this person only. The same rank rule applies, and at the same rank theirs come first.</div>'
    + '<div class="ncm-emv__group">Theirs</div><div class="ncm-emv__rows">' + (me.groups.map((r, i) => '<div class="ncm-emv__grp"><span class="r" data-tooltip="Rank needed to call them">' + word(r) + '</span><input type="text" id="emg-' + i + '" data-in="emGName" data-i="' + i + '" data-id="' + esc(p.id) + '" value="' + esc(r.name) + '" aria-label="Group name"><span class="end">' + (r.logo ? '<img class="ncm-r3-bkart" src="' + esc(r.logo) + '" alt="">' : '') + btn('', 'fa-image', r.logo ? 'Change this group\'s picture. Shift-click to remove it' : 'Give this group its own picture', 'data-do="emGArt" data-i="' + i + '" data-id="' + esc(p.id) + '"', 'ic') + btn('', 'fa-trash', 'Remove this group', 'data-do="emGDel" data-i="' + i + '" data-id="' + esc(p.id) + '"', 'ic bad') + '</span></div>').join('') || '<small>None yet.</small>') + '</div>'
    + '<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="Lowest Backup rank that can call them">From rank<input type="number" id="emg-a1" min="1" max="10" value="3" style="width:64px"></label><label class="ncm-pn-f" data-tooltip="Highest rank in this band">To<input type="number" id="emg-a2" min="1" max="10" value="4" style="width:64px"></label><label class="ncm-pn-f grow" data-tooltip="Any name">New group<input type="text" id="emg-an" placeholder="A partner, a favour, an old squad"></label>' + btn('Add', 'fa-plus', 'Add this group', 'data-do="emGAdd" data-id="' + esc(p.id) + '"') + '</div>'
    + '<div class="ncm-emv__group">From ' + esc(o?.name || 'their organization') + '</div><div class="ncm-emv__rows">' + ([...(o?.rows || [])].sort((a, b) => a.r1 - b.r1).map((r) => '<div class="ncm-emv__grp is-org"><span class="r">' + word(r) + '</span><span>' + esc(r.name) + '</span><span></span></div>').join('') || '<small>None.</small>') + '</div>';
  return '<div class="ncm-emv">' + top + body + '</div>';
}

/** Both emergency screens open everything once: a folded section beside empty space hid what was in it. */
const emOpenOnce = () => { if (S.emOpened) return; S.emOpened = true; ['ttc', 'tta', 'ttb', 'bkg', 'bkl'].forEach((k) => S.fOpen.add(k)); };
function viewTrauma() {
  emOpenOnce();
  const c = emCfg(), t = c.trauma, q = (S.ttQ || '').trim().toLowerCase();
  const rows = PCS().map((p) => { const plan = traumaPlan(c, { actorId: p.id, items: itemsOf(p.id) }), bio = holdsItem(itemsOf(p.id), t.bioItem); return { p, plan, bio }; });
  const shown = rows.filter(({ p, plan, bio }) => (!q || p.name.toLowerCase().includes(q)) && (!S.ttShow || S.ttShow === 'all' || (S.ttShow === 'plan' && plan !== 'none') || (S.ttShow === 'none' && plan === 'none') || (S.ttShow === 'bio' && bio?.counts)));
  const cover = shown.map(({ p, plan, bio }) => '<div class="ncm-r3-ext">' + face(p) + '<span class="grow"><b>' + esc(p.name) + '</b> ' + (bio ? itemChip(bio.item, bio.how, bio.counts ? 'is-yes' : 'is-warn') : '') + '</span>' + (t.source === 'hand' ? '<select id="tt-p-' + esc(p.id) + '" data-ch="ttPlan" data-id="' + esc(p.id) + '" aria-label="Plan for ' + esc(p.name) + '">' + opt('none', 'No plan', (t.plans[p.id] || 'none') === 'none') + opt('silver', 'Silver', t.plans[p.id] === 'silver') + opt('exec', 'Executive', t.plans[p.id] === 'exec') + '</select>' : tagp(PLAN_NAMES[plan], plan === 'exec' ? 'is-money' : plan === 'silver' ? 'is-act' : 'is-plain')) + '</div>').join('') || '<small>Nobody matches.</small>';
  const with2 = rows.filter((r) => r.plan !== 'none').length;
  const setup = qsect('ttc', 'fa-id-card', 'Who has cover?', 'var(--ncm-act)', with2 + ' with a plan · ' + (t.source === 'hand' ? 'set by you' : 'from an item'), '<div class="ncm-pn-f"><span data-tooltip="The book treats it as a monthly bill, not gear, so by hand is the default">How you track it</span>' + seg3('ttSet', 'source', t.source, [['hand', 'I set it here', 'A plan on each character'], ['item', 'From an item', 'Having the item means having the plan']]) + '</div>'
    + (t.source === 'item' ? itemListRow(t.itemSilver, 'itemSilver', 'Silver item', 'Any character carrying one of these has Silver') + itemListRow(t.itemExec, 'itemExec', 'Executive item', 'Any character carrying one of these has Executive') : '')
    + '<div class="ncm-pn-fr"><label class="ncm-pn-srch" data-tooltip="Find a character"><i class="fas fa-magnifying-glass"></i><input type="text" id="tt-q" data-in="ttQ" value="' + esc(S.ttQ || '') + '" placeholder="Find a character" aria-label="Find a character"></label><label class="ncm-pn-sel" data-tooltip="Narrow the list"><span>Show</span><select id="tt-show" data-ch="ttShow">' + [['all', 'Everyone'], ['plan', 'Has a plan'], ['none', 'No plan'], ['bio', 'Has a Biomonitor']].map(([k, l]) => opt(k, l, (S.ttShow || 'all') === k)).join('') + '</select></label></div><div class="ncm-r3-scrollbox" data-sc="ttc">' + cover + '</div>'
    + '<label class="ncm-pn-chk" data-tooltip="The book gives an Exec cover through Teamwork: Silver at rank 6, Executive at rank 8. Reads their role"><input type="checkbox" id="tt-tw" data-ch="ttChk" data-k="teamwork"' + (t.teamwork ? ' checked' : '') + '><span>Execs get it from their Teamwork rank</span></label>');
  const auto = qsect('tta', 'fa-heart-pulse', 'Does it ever call by itself?', 'var(--ncm-attn)', t.auto ? 'Yes, with ' + (t.bioItem.length > 1 ? 'any of ' + t.bioItem.length + ' items' : 'a ' + (t.bioItem[0]?.name || 'Biomonitor')) : 'No', '<label class="ncm-pn-chk" data-tooltip="An Agent linked to a Biomonitor calls on its own when HP drops below BODY"><input type="checkbox" id="tt-auto" data-ch="ttChk" data-k="auto"' + (t.auto ? ' checked' : '') + '><span>A Biomonitor calls automatically</span></label>' + (t.auto ? itemListRow(t.bioItem, 'bioItem', 'Item that counts', 'Any character carrying this counts as having a Biomonitor') + '<small>Fires when HP drops below BODY.</small>' : '<small>Players press the button themselves.</small>'));
  const line = traumaLine(SPECIAL, t.specialId, specialKey), sp = SPECIAL.find((x) => x.id === line.id);
  const lineRow = '<div class="ncm-pn-f"><span data-tooltip="Dialling this number starts the Trauma Team call, and the call wears its name and picture">The number</span><select id="tt-special" data-ch="ttSpecial">' + SPECIAL.map((x) => opt(x.id, (x.name || 'No name') + ' · ' + x.num, x.id === line.id)).join('') + '</select></div>'
    + (sp ? '<div class="ncm-r3-ext">' + portrait(sp) + '<span class="grow"><b>' + esc(line.name) + '</b> ' + esc(line.number) + '</span>' + btn(sp.img ? 'Change picture' : 'Add a picture', 'fa-image', 'Shows on the call and when they arrive. It is the same picture as under Special numbers', 'data-do="ttArt"') + (sp.img ? btn('', 'fa-xmark', 'Remove the picture', 'data-do="ttArtClear"', 'ic') : '') + '</div>' : '<small>That number was removed, so the call uses TRAUMA with no picture. Add a special number to pick one.</small>');
  const brand = qsect('ttb', 'fa-building', 'What number do they call?', 'var(--ncm-hue-5)', line.number + (t.noPlan === 'refuse' ? ' · no plan is refused' : ' · no plan rings you'), lineRow + '<div class="ncm-pn-f"><span data-tooltip="Someone with no plan dials the number">With no plan</span>' + seg3('ttSet', 'noPlan', t.noPlan, [['refuse', 'Not a subscriber', 'A recording refuses them'], ['ring', 'Rings you', 'You decide what they say']]) + '</div>');
  const voiceN = Object.keys(t.voice).length;
  const words = qsect('ttv', 'fa-comment', 'What does dispatch say?', 'var(--ncm-bad)', voiceN ? voiceN + ' changed' : 'The built-in words', '<div class="ncm-emv"><div class="ncm-emv__top"><span class="ncm-emv__note">One set of words for the whole service.</span><span class="sp"></span>' + btn('Play', 'fa-play', 'Plays it on your screen with the first character. The dice are only for show, and nothing is saved', 'data-do="ttPlay"') + btn('Arrival', 'fa-play', 'The on scene banner. Only you see this one', 'data-do="emPlay" data-how="arrive-tt"') + '</div>' + emSlots({ slots: TRAUMA_SLOTS, scope: 't', kind: 'trauma', own: t.voice, behind: [] }) + '</div>');
  return '<header class="ncm-tabhd"><i class="fas fa-truck-medical"></i><div><h2>Trauma Team</h2><p>A monthly plan, not gear. Team stats stay in the book, pages 223 to 224.</p></div><div class="ncm-tabhd__end">' + btn('See the call', 'fa-play', 'Plays it on your screen with the first character. The dice are only for show, and nothing is saved', 'data-do="ttPlay"') + '</div></header>' + setupTabs() + emInner() + undoLine()
    + flow([['fa-id-card', 'They have a plan', 'Silver or Executive.'], ['fa-droplet', 'They get hurt', 'Any injury can justify a call.'], ['fa-phone', 'The call goes out', 'An Action, or a Biomonitor does it free.'], ['fa-truck-medical', 'They arrive', 'In d6 rounds, first in the order.']])
    + '<div class="ncm-pn-scroll" data-sc="tt1"><div class="ncm-em2"><div class="ncm-em2__c">' + setup + '</div><div class="ncm-em2__c">' + auto + brand + words + '</div></div></div>';
}
function viewBackup() {
  emOpenOnce();
  const c = emCfg(), b = c.backup;
  if (!b.orgs[S.bkOrg]) S.bkOrg = Object.keys(b.orgs)[0] || null;
  const o = b.orgs[S.bkOrg];
  const gq = (S.bkGq || '').trim().toLowerCase(), word = (r) => (r.r1 === r.r2 ? 'Rank ' + r.r1 : 'Rank ' + r.r1 + '-' + r.r2);
  const rows = (o?.rows || []).map((r, i) => ({ r, i })).filter(({ r }) => (!gq || r.name.toLowerCase().includes(gq)) && (!S.bkRank || S.bkRank === 'all' || word(r) === S.bkRank));
  const groups = qsect('bkg', 'fa-people-group', 'Who can they call?', 'var(--ncm-act)', Object.keys(b.orgs).length + ' organizations', '<div class="ncm-pn-fr"><div class="ncm-pn-f grow"><span data-tooltip="A Lawman reaches their own people">Organization</span>' + btn(o?.name || 'Pick one', 'fa-shield-halved', 'Search every organization, by name or by the groups in it', 'data-do="bkOrgPick"') + '</div>' + btn('New', 'fa-plus', 'Add an organization. It starts with placeholder names to rename', 'data-do="bkNew"') + (o ? btn('', 'fa-trash', 'Delete ' + o.name, 'data-do="bkOrgDel"', 'ic bad') : '') + btn('', 'fa-rotate-left', 'Put back the sample organizations', 'data-do="bkOrgReset"', 'ic') + '</div>'
    + (o ? '<div class="ncm-r3-ext">' + faceOf(o.name, '', o.logo) + '<span class="grow"><b>' + esc(o.name) + '</b> <small>' + (o.logo ? 'Shows on their calls and when they arrive.' : 'No picture yet. The call shows only its signal.') + '</small></span><label class="ncm-pn-sel" data-tooltip="Backup is whoever this Lawman can call. Only Police and Government get red and blue lights and a siren"><span>Kind</span><select id="bk-kind" data-ch="bkKind">' + [...new Set([...ORG_KINDS, o.kind])].map((k) => opt(k, k, k === o.kind)).join('') + '</select></label>' + btn(o.logo ? 'Change picture' : 'Add a picture', 'fa-image', 'This organization\'s picture. A group can have its own, which wins', 'data-do="bkArt"') + (o.logo ? btn('', 'fa-xmark', 'Remove the picture', 'data-do="bkArtClear"', 'ic') : '') + '</div>' : '')
    + (!o ? '<small>No organizations. Add one, or put the samples back.</small>' : '<div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Find a group"><i class="fas fa-magnifying-glass"></i><input type="text" id="bk-gq" data-in="bkGq" value="' + esc(S.bkGq || '') + '" placeholder="Find a group" aria-label="Find a group"></label><label class="ncm-pn-sel" data-tooltip="Show one rank"><span>Rank</span><select id="bk-rank" data-ch="bkRank">' + opt('all', 'All', (S.bkRank || 'all') === 'all') + uniq((o?.rows || []).map(word)).map((w) => opt(w, w.replace('Rank ', ''), S.bkRank === w)).join('') + '</select></label></div>'
    + '<div class="ncm-r3-scrollbox" data-sc="bkg">' + (rows.map(({ r, i }) => '<div class="ncm-r3-bkrow"><span class="ncm-r3-rank" data-tooltip="' + tipText(word(r)) + '. Lawmen of this rank or higher can call them">' + (r.r1 === r.r2 ? r.r1 : r.r1 + '-' + r.r2) + '</span><input type="text" id="bk-n-' + i + '" data-in="bkName" data-i="' + i + '" value="' + esc(r.name) + '" aria-label="Group name" data-tooltip="The name players and you see">' + (r.logo ? '<img class="ncm-r3-bkart" src="' + esc(r.logo) + '" alt="">' : '') + btn('', 'fa-image', r.logo ? 'Change this group\'s picture. Shift-click to remove it' : 'Give this group its own picture', 'data-do="bkGArt" data-i="' + i + '"', 'ic') + btn('', 'fa-trash', 'Remove this group', 'data-do="bkDelG" data-i="' + i + '"', 'ic bad') + '</div>').join('') || '<small>Nothing matches.</small>') + '</div>'
    + '<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="Lowest Backup rank that can call them">From rank<input type="number" id="bk-a1" min="1" max="10" value="3" style="width:64px"></label><label class="ncm-pn-f" data-tooltip="A rank can have as many groups as you like">To<input type="number" id="bk-a2" min="1" max="10" value="4" style="width:64px"></label><label class="ncm-pn-f grow" data-tooltip="Any name">New group<input type="text" id="bk-an" placeholder="Harbor Patrol"></label>' + btn('Add', 'fa-plus', 'Add this group', 'data-do="bkAddG"') + '</div><small>The names are placeholders, so rename them for your table. What each rank can call is on pages 158 to 159.</small>'));
  const lq = (S.bkQ || '').trim().toLowerCase();
  const lawmen = PCS().concat(PEOPLE.filter((p) => p.kind === 'npc' && actorOf(p.id))).map((p) => ({ p, rank: roleRank(itemsOf(p.id), 'Lawman') })).filter(({ rank }) => rank > 0);
  const people = lawmen.filter(({ p }) => !lq || p.name.toLowerCase().includes(lq) || S.bkOpen === p.id);
  const editing = lawmen.some(({ p }) => p.id === S.bkOpen);
  const law = qsect('bkl', 'fa-shield-halved', 'Who are your Lawmen?', 'var(--ncm-hue-5)', lawmen.length + (lawmen.length === 1 ? ' Lawman' : ' Lawmen'), '<small>Anyone with the Lawman role. Pick who each one calls, and change anything about their call.</small>' + (lawmen.length > 6 || lq ? '<label class="ncm-pn-srch" data-tooltip="Find a character"><i class="fas fa-magnifying-glass"></i><input type="text" id="bk-q" data-in="bkQ" value="' + esc(S.bkQ || '') + '" placeholder="Find a character" aria-label="Find a character"></label>' : '') + '<div class="ncm-r3-scrollbox' + (editing ? ' is-editing' : '') + '" data-sc="bkl">' + (people.map(({ p, rank }) => '<div class="ncm-r3-ext">' + face(p) + '<span class="grow"><b>' + esc(p.name) + '</b> <small>Rank ' + rank + '</small>' + (personChanges(b.people[p.id]) ? ' <span class="ncm-emv__change">' + personChanges(b.people[p.id]) + (personChanges(b.people[p.id]) === 1 ? ' change' : ' changes') + '</span>' : '') + '</span><select id="bk-o-' + esc(p.id) + '" data-ch="bkOrgOf" data-id="' + esc(p.id) + '" aria-label="Organization for ' + esc(p.name) + '">' + Object.entries(b.orgs).map(([id, x]) => opt(id, x.name, (b.orgs[b.chars[p.id]] ? b.chars[p.id] : b.orgs.book ? 'book' : Object.keys(b.orgs)[0]) === id)).join('') + '</select>' + btn(S.bkOpen === p.id ? 'Close' : 'Customize', S.bkOpen === p.id ? 'fa-chevron-up' : 'fa-pen', 'What this person\'s calls say and look like', 'data-do="bkOpen" data-id="' + esc(p.id) + '"') + '</div>' + (S.bkOpen === p.id ? emPerson(p, c) : '')).join('') || '<small>' + (lq ? 'Nobody matches.' : 'Nobody has the Lawman role yet.') + '</small>') + '</div>');
  const inOrg = lawmen.find(({ p }) => (b.orgs[b.chars[p.id]] ? b.chars[p.id] : b.orgs.book ? 'book' : Object.keys(b.orgs)[0]) === S.bkOrg);
  const orgN = o ? Object.keys(o.voice).length : 0, lookNow = o ? backupLook(o.kind, o.look) : null;
  const orgWords = !o ? '' : qsect('bkv', 'fa-comment', 'What do their calls say?', 'var(--ncm-hue-3)', o.name + ' · ' + (orgN ? orgN + ' changed' : 'the built-in words'), '<div class="ncm-emv"><div class="ncm-emv__top"><span class="ncm-emv__note">Every Lawman in ' + esc(o.name) + ' gets these unless you change them on the person.</span><span class="sp"></span>' + (inOrg ? btn('Play', 'fa-play', 'Plays with ' + inOrg.p.name + '. The dice are only for show, and nothing is saved', 'data-do="emPlay" data-how="backup" data-a="' + esc(inOrg.p.id) + '"') : '') + '</div>' + emSlots({ slots: BACKUP_SLOTS, scope: 'o:' + S.bkOrg, kind: 'backup', own: o.voice, behind: [] }) + '</div>');
  const orgLook = !o ? '' : qsect('bkk', 'fa-palette', 'How do their calls look?', 'var(--ncm-hue-7)', o.name + ' · ' + (lookNow.lights ? 'lights on' : 'no lights'), '<div class="ncm-emv">' + emLook({ scope: 'o:' + S.bkOrg, look: o.look, behindLabel: '', behind: backupLook(o.kind) }) + '</div>');
  return '<header class="ncm-tabhd"><i class="fas fa-shield-halved"></i><div><h2>Lawman Backup</h2><p>The Lawman role ability, on their phone. Rulebook pages 158 to 159.</p></div><div class="ncm-tabhd__end">' + btn('See the call', 'fa-play', 'Plays it on your screen with the first character. The dice are only for show, and nothing is saved', 'data-do="bkPlay"') + '</div></header>' + setupTabs() + emInner() + undoLine()
    + flow([['fa-shield-halved', 'They are a Lawman', 'Rank comes from their role.'], ['fa-dice-d20', 'They call it in', 'An Action. d10, their rank or under.'], ['fa-clock', 'Someone answers', 'd6 rounds until they arrive.'], ['fa-people-group', 'Their people arrive', 'A 6 means one group up.']])
    + '<div class="ncm-pn-scroll" data-sc="bk1"><div class="ncm-em2' + (editing ? ' is-wide' : '') + '">' + (editing ? '<div class="ncm-em2__c">' + law + '</div><div class="ncm-em2__c">' + groups + orgWords + orgLook + '</div>' : '<div class="ncm-em2__c">' + groups + orgWords + orgLook + '</div><div class="ncm-em2__c">' + law + '</div>') + '</div></div>';
}

/* ─── the call log editor ─── */
const OUTS = ['Answered', 'Missed', 'Declined', 'Voicemail', 'Dropped'];
const nowIso = () => { try { return game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString(); } catch { return new Date().toISOString(); } };
const whenText = (t) => { try { return t ? formatCyberDate(t) : ''; } catch { return String(t); } };
const blankEntry = () => ({ id: null, ty: 'std', dir: 'in', pick: '__none', who: '', n: '', out: 'Answered', when: nowIso(), len: '1:30', vm: '', both: false });
/** A target: "o:<actor or contact id>", or "a:<terminal uuid>:<account id>". */
const logParts = (t) => { const [k, ...rest] = String(t || '').split(':'); if (k === 'a') { const acc = rest.pop(); return { kind: 'acct', uuid: rest.join(':'), acc }; } return k === 'o' ? { kind: 'owner', id: rest.join(':') } : { kind: 'none' }; };
const logTerminal = (uuid) => (game.nightcity?.terminalService?.collectTerminals?.() || []).find((i) => i.uuid === uuid);
const logEntries = () => { const t = logParts(S.lgT); if (t.kind === 'owner') return SVC.writtenLog(t.id); if (t.kind === 'acct') { const item = logTerminal(t.uuid); return item ? game.nightcity.terminalService.callEntries(item, t.acc) : []; } return []; };
const logName = () => { const t = logParts(S.lgT); if (t.kind === 'owner') return byId(t.id)?.name || 'Someone'; if (t.kind === 'acct') { const item = logTerminal(t.uuid); const a = item && game.nightcity.terminalService.getAccount(item, t.acc); return item ? `${item.name}: ${a?.username || t.acc}` : 'A terminal'; } return 'Pick a log'; };
const logRow = (e) => { const editing = S.lgE.id === e.id; return `<div class="ncm-r3-lrow${editing ? ' on' : ''}"><i class="fas ${e.out === 'Voicemail' ? 'fa-voicemail' : e.dir === 'in' ? 'fa-arrow-down-long' : 'fa-arrow-up-long'}" style="color:var(--ncm-${e.out === 'Missed' || e.out === 'Dropped' ? 'bad' : 'good'})" aria-hidden="true"></i><span class="nm"><b>${esc(e.who || (e.n ? seenFrom(parse(e.n)) : 'Unknown caller'))}</b>${e.who && e.n ? pcolor(e.n) : ''}${e.vm ? `<em>"${esc(e.vm)}"</em>` : ''}</span><span class="st">${esc(e.out)}${e.len ? ' · ' + esc(e.len) : ''}</span><span class="ncm-pn-when">${esc(whenText(e.when))}</span>${typeMark(typeOf(e.ty || 'std') || TYPES[0])}${e.real ? tagp('Real', 'is-plain', 'fa-phone', 'It happened in play') : tagp('Yours', 'is-secret', 'fa-pen', 'You wrote this. Only you see this label; players see it as any other call')}${btn('', 'fa-pen', 'Edit this entry', `data-do="lgEdit" data-id="${esc(e.id)}"`, 'ic')}${btn('', 'fa-trash', 'Delete this entry', `data-do="lgDel" data-id="${esc(e.id)}"`, 'ic bad')}</div>`; };
function viewLog() {
  const list = logEntries(), e = S.lgE, someone = e.pick === '__other';
  const known = PEOPLE.filter((p) => p.lines[0]);
  const hasTarget = logParts(S.lgT).kind !== 'none';
  const form = `<div class="ncm-pn-form"><h4><i class="fas ${e.id ? 'fa-pen' : 'fa-plus'}"></i> ${e.id ? 'Edit this call' : 'Add a call'}</h4>
    <div class="ncm-pn-fr"><div class="ncm-pn-f"><span data-tooltip="Who called whom">Direction</span>${seg3('lgSet', 'dir', e.dir, [['in', 'Incoming', 'Someone called them'], ['out', 'Outgoing', 'They called someone']])}</div>
    <div class="ncm-pn-f"><span data-tooltip="How it ended">How it went</span>${seg3('lgSet', 'out', e.out, OUTS.map((o) => [o, o, o]))}</div></div>
    <div class="ncm-pn-fr"><label class="ncm-pn-f grow" data-tooltip="Pick someone with a number, or write in anyone">Other person<select id="lg-pick" data-ch="lgPick">${known.map((p) => opt(p.id, p.name, e.pick === p.id)).join('')}${opt('__other', 'Someone else…', someone)}${opt('__none', 'Unknown caller', e.pick === '__none')}</select></label>${someone ? `<label class="ncm-pn-f grow" data-tooltip="Any name, or leave it empty to show only the number">Name<input type="text" id="lg-who" data-in="lg" data-k="who" value="${esc(e.who)}"></label><label class="ncm-pn-f grow" data-tooltip="Any number">Number<input type="text" id="lg-n" data-in="lg" data-k="n" value="${esc(e.n)}" placeholder="WAT-1234"></label>` : ''}</div>
    <div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="The kind of line on the other end. It marks the row">Their line<select id="lg-ty" data-ch="lgTy">${TYPES.map((t) => opt(t.id, t.name, (e.ty || 'std') === t.id)).join('')}</select></label><div class="ncm-pn-f"><span data-tooltip="Game time">When</span>${btn(whenText(e.when) || 'Pick a time', 'fa-clock', 'Game time', 'data-do="lgWhen"')}</div><label class="ncm-pn-f" data-tooltip="Minutes and seconds. Leave empty for a call nobody answered">Length<input type="text" id="lg-len" data-in="lg" data-k="len" value="${esc(e.len)}" style="width:70px"></label></div>
    ${e.out === 'Voicemail' ? `<label class="ncm-pn-f" data-tooltip="What they left. A clue, a threat, anything">What they said<input type="text" id="lg-vm" data-in="lg" data-k="vm" value="${esc(e.vm)}"></label>` : ''}
    ${byId(e.pick) ? `<label class="ncm-pn-chk" data-tooltip="Adds the matching entry to their log too, so the two logs agree"><input type="checkbox" id="lg-both" data-ch="lgBoth"${e.both ? ' checked' : ''}><span>Add it to ${esc(byId(e.pick).name)}'s log too</span></label>` : ''}
    <div class="ncm-pn-acts">${btn(e.id ? 'Save' : 'Add it', 'fa-check', 'Save this entry', `data-do="lgSave" ${hasTarget ? '' : 'disabled'}`, 'pri')}${e.id ? btn('Cancel', '', 'Leave it as it was', 'data-do="lgNew"') : ''}</div></div>`;
  return `<header class="ncm-tabhd"><i class="fas fa-clock-rotate-left"></i><div><h2>Edit a call log</h2><p>Write history for a person or a machine: a missed call, a voicemail, a trail for players to find.</p></div><div class="ncm-tabhd__end">${btn('Call log', 'fa-arrow-left', 'Back to the call log', 'data-do="logBack"')}</div></header>${undoLine()}
    <div class="ncm-pn-tb">${btn(logName(), 'fa-magnifying-glass', 'Search any line or terminal account', 'data-do="lgPickLog"')}<span class="grow"></span>${btn('Fill in a week', 'fa-wand-magic-sparkles', 'Adds a handful of ordinary calls with people who have numbers, so the log looks lived in. You can undo it', `data-do="lgFill" ${hasTarget ? '' : 'disabled'}`)}${btn('', 'fa-file-export', 'Export this log as a CSV', 'data-do="lgCsv"', 'ic')}</div>
    <div class="ncm-pn-split ncm-r3-half"><div class="ncm-pn-detail" data-sc="lg1" style="background:var(--ncm-bg-pane);padding:0;gap:0">${[...list].sort((a, b) => String(b.when).localeCompare(String(a.when))).map(logRow).join('') || `<div class="ncm-ph2-none">${hasTarget ? 'Nothing written yet. Add one, or fill in a week.' : 'Pick whose log to edit.'}</div>`}</div><div class="ncm-pn-detail" data-sc="lg2">${form}<small>Real calls on a person's line stay in their log and are not listed here.</small></div></div>`;
}
/** Write one entry to the open log. */
async function logWrite(entries) {
  const t = logParts(S.lgT);
  if (t.kind === 'owner') return SVC.saveWrittenLog(t.id, entries);
  return { ok: false, error: 'Use logAdd for a terminal.' };
}

/* ─── shared lines ─── */
const flow = (steps) => `<div class="ncm-r3-flow">${steps.map(([ic, t, d], i) => `<div class="st"><span class="n">${i + 1}</span><i class="fas ${ic}"></i><b>${esc(t)}</b><small>${esc(d)}</small></div>`).join('')}</div>`;
const sharedLines = () => Object.values(SVC.lines()).filter((l) => Array.isArray(l.members));
function viewShared() {
  const all = sharedLines();
  const L = all.find((l) => l.number === S.shSel) || all[0] || null;
  const memberName = (m) => m.name || 'Someone';
  const list = all.map((l) => `<button type="button" class="ncm-pn-prow${l === L ? ' on' : ''}" data-do="shSel" data-n="${esc(l.number)}" data-tooltip="Open ${tipText(l.label)}"><span class="ncm-pn-face" style="--tc:${hueOf(l.label)}"><i class="fas fa-users-line" aria-hidden="true"></i></span><span class="bd"><span class="nm">${esc(l.label)}${l.off ? tagp('off', 'is-attn', 'fa-power-off') : ''}</span><span class="ln">${pcolor(l.number)}</span><span class="mt"><span class="ncm-pn-who">${l.members.length} on it</span></span></span></button>`).join('');
  const phone = (m) => { const nm = memberName(m), me = S.shPick === nm; const state = S.shPick ? (me ? '<div class="ncm-pn-check info"><i class="fas fa-phone"></i><span>You picked up. On the call.</span></div>' : `<div class="ncm-pn-check"><i class="fas fa-phone-slash"></i><span>Picked up by ${esc(S.shPick)}.</span></div>`) : btn('Answer', 'fa-phone', `${nm} takes the call`, `data-do="shPick" data-m="${esc(nm)}"`, 'go'); return `<div class="ncm-pn-ph" style="--sk:${me ? 'var(--ncm-good)' : S.shPick ? 'var(--ncm-text-label)' : 'var(--ncm-attn)'}"><h5><i class="fas fa-mobile-screen"></i> ${esc(nm)}'s screen</h5>${S.shPick ? '' : `<small class="ncm-r3-ringk"><i class="fas fa-phone-volume"></i> ${esc(L.label)} is ringing</small>`}${state}</div>`; };
  const detailHtml = !L ? '<div class="ncm-ph2-none">No shared lines yet. A crew phone, a gang hotline, an office line.</div>' : `<section class="ncm-pn-mod" style="--sk:var(--ncm-act)"><div class="ncm-pn-mh"><i class="fas fa-users-line"></i> ${esc(L.label)}</div><div class="ncm-pn-mb">
      <div class="ncm-pn-line__top" style="gap:9px"><span class="ncm-pn-lhead-n">${pcolor(L.number)}</span>${tagp('Shared', 'is-act', 'fa-users-line', 'Rings everyone on it')}<span class="grow"></span>${btn('Change', 'fa-pen', 'New number for everyone. The old one retires', `data-do="shChange" data-n="${esc(L.number)}"`)}${btn('Retire', 'fa-box-archive', 'Retire this line for everyone', `data-do="shRetire" data-n="${esc(L.number)}"`, 'bad')}</div>
      <div class="ncm-pn-f"><span data-tooltip="Everyone here hears it ring, can call out on it, and gets its voicemail">On this line</span><div class="ncm-pn-holders" style="gap:6px">${L.members.map((m, i) => `<span class="ncm-r3-mem">${faceOf(memberName(m))}<b>${esc(memberName(m))}</b><button type="button" data-do="shDel" data-n="${esc(L.number)}" data-i="${i}" aria-label="Take ${esc(memberName(m))} off the line" data-tooltip="Take ${tipText(memberName(m))} off the line. The number stays with the others"><i class="fas fa-xmark"></i></button></span>`).join('')}${btn('Add someone', 'fa-plus', 'Search everyone. An NPC on a line means it can ring you too', `data-do="shFind" data-n="${esc(L.number)}"`)}</div></div></div></section>
    <section class="ncm-pn-mod" style="--sk:var(--ncm-attn)"><div class="ncm-pn-mh"><i class="fas fa-phone-volume"></i> How it looks <small>Press Answer on any of them. Nothing rings for real</small><span class="grow"></span>${btn('Ring again', 'fa-rotate-left', 'Start over', 'data-do="shReset"')}</div><div class="ncm-pn-mb"><div class="ncm-pn-ppl">${L.members.map(phone).join('') || '<small>Nobody is on the line.</small>'}</div></div></section>`;
  return `<header class="ncm-tabhd"><i class="fas fa-users-line"></i><div><h2>Shared lines</h2><p>One number, several people. A crew phone, a gang hotline, an office line.</p></div></header>${numbersTabs()}${undoLine()}
    ${flow([['fa-phone-volume', 'It rings everyone', 'The first to answer takes it.'], ['fa-phone', 'Anyone can call out', 'The other end sees the line, not who dialled.'], ['fa-voicemail', 'One voicemail', 'Everyone on the line gets it.'], ['fa-magnifying-glass-location', 'A Trace finds the line', 'Not who was on it.']])}
    <div class="ncm-pn-tb">${btn('New shared line', 'fa-plus', 'Make a number several people answer', 'data-do="shNew"', 'pri')}</div>
    <div class="ncm-pn-split"><div class="ncm-pn-list" data-sc="shl">${list || '<div class="ncm-ph2-none">None yet.</div>'}</div><div class="ncm-pn-detail" data-sc="shd">${detailHtml}</div></div>`;
}

/* ─── writes ─── */
const toast = (msg) => ncmNotify.info(msg);
const refuse = (r) => { if (r && r.ok === false) { ncmNotify.warn(r.error || 'That did not work.'); return true; } return false; };
const freshBulk = () => { S.bulk = null; };
const ownerOf = (p) => (p.kind === 'pc' || p.actorOnly ? { actorId: p.id } : { contactId: p.id });
const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); toast('Downloaded ' + name); };
const toCsv = () => { const cols = [...COLS, ...EXTRA_COLS]; return [cols, ...ROWS.map((r) => cols.map((c) => r[c] ?? ''))].map((l) => l.map(csvCell).join(',')).join('\n'); };
/** Do a write, and remember how to take it back. */
async function undoable(text, fn) {
  const snap = SVC.phoneSnapshot();
  const r = await fn();
  if (refuse(r)) return false;
  S.undo = { text: typeof text === 'function' ? text(r) : text, snap, after: SVC.phoneSnapshot() };
  return true;
}
const give = (p, n, why, kind = null, label = '') => (kind === 'extra' || kind === 'burner'
  ? SVC.addLine({ ...ownerOf(p), number: n, kind, label, why })
  : SVC.assignNumber({ ...ownerOf(p), number: n, why }));
const saveRules = (patch) => SVC.saveNumberSetting('phoneRules', { ...sanitizeRules(SVC._get('phoneRules', {})), ...patch });
const savePlaces = (rows = ROWS, list = S.list, extra = EXTRA_COLS) => SVC.saveNumberSetting('phonePlaces', placesDiff(rows, list, extra));
const saveSpecial = () => SVC.saveNumberSetting('phoneSpecial', SPECIAL);
const spOf = () => SPECIAL.find((y) => y.id === S.spSel);
const ovDebounce = () => { clearTimeout(TAB._ovT); const c = S.ovEdit; TAB._ovT = setTimeout(() => OV().saveScript(c), 400); };
/** The world's item list has no ids (the same name on many sheets is one item here), so the picker is keyed by name. */
function findWorldItem(name) {
  const n = norm(name), hit = (list) => { for (const i of list ?? []) if (norm(i.name) === n) return i; return null; };
  let doc = hit(game.items);
  if (!doc) for (const a of game.actors ?? []) { doc = hit(a.items); if (doc) break; }
  return doc;
}
/** Pick a list of items: what is already on it starts ticked, and an item no longer in the world stays on it. Null when dismissed. */
export async function pickItems(current, { title = 'Pick items', hint = '' } = {}) {
  const entries = worldItemEntries().map((e) => ({ ...e, id: norm(e.name) }));
  for (const i of current) if (!entries.some((e) => e.id === norm(i.name))) entries.push({ id: norm(i.name), name: i.name, img: i.img || '', sub: 'Not in the world any more' });
  const pick = await showNamePicker({ title, hint, placeholder: 'search items…', multi: true, doneLabel: 'Done', preselected: current.map((i) => norm(i.name)), entries });
  if (!pick) return null;
  return pick.map((p) => { const was = current.find((i) => norm(i.name) === norm(p.name)), doc = findWorldItem(p.name); return { name: p.name, type: was?.type || doc?.type || '', img: p.img || was?.img || '' }; });
}
/** Pick who is on a shared line: characters and directory contacts. */
async function pickMembers(title, current) {
  const key = (m) => (m.actorId ? 'a:' + m.actorId : 'c:' + m.contactId);
  const entries = [...PCS().map((p) => ({ id: 'a:' + p.id, name: p.name, img: p.img, sub: p.player, group: 'Players' })), ...PEOPLE.filter((p) => p.kind === 'npc' && !p.actorOnly).map((p) => ({ id: 'c:' + p.id, name: p.name, img: p.img, sub: p.role || p.org, group: 'NPCs' }))];
  const picked = await showNamePicker({ title: `Who is on ${title}?`, hint: 'Everyone here hears it ring and can call out on it.', placeholder: 'search…', multi: true, doneLabel: 'Done', preselected: current.map(key), entries });
  if (!picked) return null;
  return picked.map((x) => { const id = String(x.id ?? x), e = entries.find((y) => y.id === id); return id.startsWith('a:') ? { actorId: id.slice(2), contactId: null, name: e?.name || '' } : { actorId: null, contactId: id.slice(2), name: e?.name || '' }; });
}
const saveTypes = (list) => SVC.saveNumberSetting('phoneLineTypes', lineTypesDiff(list.map(sanitizeLineType)));
const saveOffice = (patch) => { const all = { ...(SVC._get('phoneOffices', {}) || {}) }; all[S.off] = sanitizeOffice({ ...sanitizeOffice(all[S.off]), ...patch }); return SVC.saveNumberSetting('phoneOffices', all); };
const applyList = (v) => undoable('List swapped. Places people hold numbers on stay.', async () => {
  const base = startingRows(v).map((r) => ({ ...r }));
  const key = (r) => r['Region code'] + '/' + r['City code'] + '/' + (r.Code || '-');
  const kept = ROWS.filter((r) => rowHeld(r) > 0 && !base.some((b) => key(b) === key(r)));
  S.listAsk = null;
  return savePlaces([...base, ...kept], v, EXTRA_COLS);
});

/* ─── what buttons do ─── */
const ACT = {
  frame: (el) => { S.f = el.dataset.f; S.tile = null; S.dock = null; if (S.f === 'bulk') freshBulk(); },
  sel: (el) => { S.sel = el.dataset.id; S.change = null; S.addLine = null; },
  fold: (el) => { const k = el.dataset.k; if (S.shut.has(k)) S.shut.delete(k); else S.shut.add(k); },
  showFlag: () => { S.show = S.show === 'flag' ? 'all' : 'flag'; },
  okFlag: (el) => { S.okFlags.add(el.dataset.k); },
  walk: (el) => { const p = byId(el.dataset.id), target = el.dataset.target || 'give'; if (target === 'bulk') S.f = 'numbers'; openWalk(p, target); },
  wkLevel: (el) => { S.walk.level = el.dataset.k; S.walk.q = ''; },
  wkPick: (el) => { const w = S.walk, i = WK.findIndex((x) => x.key === w.level); w.path[w.level] = el.dataset.v; WK.slice(i + 1).forEach((x) => { w.path[x.key] = null; }); w.q = ''; let n = i + 1; /* a level with one choice still shows, unless nothing is left to choose */ w.level = n < WK.length ? WK[n].key : null; if (!w.level) wkRoll(w); },
  wkJump: (el) => { const w = S.walk, r = ROWS.find((x) => rowKey2(x) === el.dataset.key); if (!r) return false; w.path = wkPathOf(r); w.level = null; wkRoll(w); },
  wkLine: (el) => { S.walk.line = el.dataset.v; S.walk.own = ''; },
  wkRoll: () => { wkRoll(S.walk); },
  wkCancel: () => { const w = S.walk; S.walk = null; if (w.target === 'bulk') S.f = 'bulk'; },
  reroll: (el) => { const p = byId(el.dataset.id), cur = S.prop[p.id]; const r = rowOfNum(parse(cur.n)); S.prop[p.id] = { ...cur, n: numAt(r, freeLine(r)) }; },
  change: (el) => { const p = byId(el.dataset.id), i = Number(el.dataset.i), l = p.lines[i]; const pr = suggest(p); S.change = { pid: p.id, i, prop: pr, typed: '', push: l.holders.length > 0 }; },
  chgReroll: () => { const r = rowOfNum(parse(S.change.prop.n)); S.change.prop = { ...S.change.prop, n: numAt(r, freeLine(r)) }; },
  chgCancel: () => { S.change = null; },
  addLine: (el) => { const p = byId(el.dataset.id); const pr = suggest({ ...p, aliasOf: null, org: '', loc: p.loc }); S.addLine = { pid: p.id, kind: 'extra', label: '', n: pr.n }; },
  addKind: (el) => { S.addLine.kind = el.dataset.k; if (el.dataset.k === 'burner') { const r = ROWS.find((x) => x.Code === 'BRN'); if (r) S.addLine.n = numAt(r, freeLine(r)); if (!S.addLine.label) S.addLine.label = 'Burner'; } },
  addReroll: () => { const r = rowOfNum(parse(S.addLine.n)); S.addLine.n = numAt(r, freeLine(r)); },
  addCancel: () => { S.addLine = null; },
  bulkRoll: () => { freshBulk(); },
  bulkOne: (el) => { const id = el.dataset.id; const r = rowOfNum(parse(S.bulk[id].n)); S.bulk[id] = { ...S.bulk[id], n: numAt(r, freeLine(r, null, Object.values(S.bulk).map((x) => keyOf2(x.n)))) }; },
  dock: (el) => { S.dock = S.dock === el.dataset.id ? null : el.dataset.id; S.tile = null; },
  dockOff: () => { S.dock = null; },
  openPerson: (el) => { S.sel = el.dataset.id; S.f = 'numbers'; S.show = 'all'; S.q = ''; },
  relAsk: (el) => { S.relOpen = el.dataset.n; },
  relCancel: () => { S.relOpen = null; },
  qFold: (el) => { const k = el.dataset.k; if (S.fOpen.has(k)) S.fOpen.delete(k); else S.fOpen.add(k); },
  lineFold: (el) => { const k = el.dataset.k; if (S.lineOpen.has(k)) S.lineOpen.delete(k); else S.lineOpen.add(k); },
  bulkMove: (el) => { S.bulkMove = S.bulkMove === el.dataset.id ? null : el.dataset.id; },
  reqSee: () => { S.reqSee = !S.reqSee; },
  part: (el) => { S.part = el.dataset.k; },
  learnGo: (el) => { S.learn = Number(el.dataset.i); },
  listNo: () => { S.listAsk = null; },
  spSel: (el) => { S.spSel = el.dataset.id; },
  pFold: (el) => { const k = el.dataset.k; if (S.tbq.trim()) return false; if (S.pOpen.has(k)) S.pOpen.delete(k); else S.pOpen.add(k); },
  edit: (el) => { S.edit = Number(el.dataset.i); },
  edCancel: () => { S.edit = null; },
  apOpen: () => { S.addBranch = null; S.addPlace = { rc: HOME.rc, nr: '', nrc: '', st: '', city: '', cc: '', ar: '', di: '', ex: '' }; },
  apCancel: () => { S.addPlace = null; },
  abOpen: () => { S.addPlace = null; const r = ROWS.find((x) => isCorp(x)); S.addBranch = { corp: r.Code + '|' + r.District, city: '', hide: false }; },
  abCancel: () => { S.addBranch = null; },
  planNo: () => { S.plan = null; },
  undoClose: () => { S.undo = null; },
  areaFold: (el) => {
    if (el.dataset.forced) return false;
    const box = el.closest('.ncm-pn-area'), k = el.dataset.k, shut = !box.classList.contains('is-shut');
    box.classList.toggle('is-shut', shut); el.setAttribute('aria-expanded', String(!shut)); box.querySelector('.ncm-pn-area__b').toggleAttribute('inert', shut);
    (shut ? S.areaShut : S.areaOpen).add(k); (shut ? S.areaOpen : S.areaShut).delete(k);
    return false;
  },
  toast: (el) => { toast(el.dataset.msg); return false; },
  shGo: (el) => { S.shSel = el.dataset.n; S.f = 'shared'; },
  shSel: (el) => { S.shSel = el.dataset.n; S.shPick = null; },
  shPick: (el) => { S.shPick = el.dataset.m; },
  shReset: () => { S.shPick = null; },
  shNew: async () => {
    const name = await themedPrompt({ title: 'New shared line', label: 'Next', icon: 'fas fa-users-line', content: dialogBodyHtml({ tone: 'act', icon: 'fas fa-users-line', title: 'A shared line', lead: 'A crew phone, a gang hotline, an office line.', field: { label: 'Name', name: 'name', value: '', placeholder: 'Kabuki crew line' } }), read: (root) => root.querySelector('input[name=name]')?.value?.trim() || null });
    if (!name) return false;
    load(TAB);
    const number = SVC.suggestNumbers({ count: 1 })[0]?.number;
    if (!number) { ncmNotify.warn('The place table is empty.'); return false; }
    const members = await pickMembers(name, []);
    if (!members) return false;
    load(TAB);
    S.shSel = number;
    await undoable(`${name} is on ${seenFrom(parse(number))}.`, () => SVC.createSharedLine({ name, number, members }));
  },
  shFind: async (el) => { const l = SVC.line(el.dataset.n); const members = await pickMembers(l.label, l.members); if (!members) return false; load(TAB); await SVC.setSharedMembers(el.dataset.n, members); },
  shDel: async (el) => { const l = SVC.line(el.dataset.n); await undoable(`Took them off ${l.label}.`, () => SVC.setSharedMembers(el.dataset.n, l.members.filter((_, i) => i !== Number(el.dataset.i)))); },
  shChange: async (el) => {
    const old = el.dataset.n, fresh = SVC.suggestNumbers({ count: 1 })[0]?.number || '';
    const value = await themedPrompt({ title: 'Change the number', label: 'Change it', icon: 'fas fa-pen', content: dialogBodyHtml({ tone: 'act', icon: 'fas fa-pen', title: old, lead: 'A new number for everyone on the line. The old one retires.', field: { label: 'Number', name: 'number', value: fresh, placeholder: 'WAT-4471 or +14 DAL CEN-1234' } }), read: (root) => root.querySelector('input[name=number]')?.value?.trim() || null });
    if (!value) return false;
    load(TAB); S.shSel = fullForm(parse(value));
    await undoable(`Changed to ${value}. ${old} retired.`, () => SVC.changeSharedNumber(old, value));
  },
  shRetire: async (el) => { const n = el.dataset.n; S.shSel = null; await undoable(`${n} retired for good.`, () => SVC.retireLine(n)); },
  logBack: () => { S.f = 'numbers'; S.goView = 'log'; },
  lgOpen: (el) => { S.lgT = 'o:' + el.dataset.id; S.lgE = blankEntry(); S.f = 'editlog'; },
  lgSet: (el) => { S.lgE[el.dataset.k] = el.dataset.v; },
  lgNew: () => { S.lgE = blankEntry(); },
  lgEdit: (el) => { const x = logEntries().find((y) => y.id === el.dataset.id); if (!x) return false; S.lgE = { ...x, pick: (PEOPLE.find((p) => p.name === x.who) || {}).id || (x.who || x.n ? '__other' : '__none'), both: false }; },
  lgWhen: () => { CyberTimePicker.open({ value: S.lgE.when, title: 'When was this call?', onSet: (iso) => { S.lgE.when = iso; TAB.app.render(); } }); return false; },
  lgPickLog: async () => {
    const ts = game.nightcity?.terminalService;
    const entries = [...PEOPLE.filter((p) => !p.actorOnly).map((p) => ({ id: 'o:' + p.id, name: p.name, img: p.img, sub: p.lines[0]?.n || 'no number', group: p.kind === 'pc' ? 'Players' : 'NPCs' })),
      ...(ts?.collectTerminals?.() || []).flatMap((item) => (ts.getConfig(item).accounts || []).map((a) => ({ id: `a:${item.uuid}:${a.id}`, name: `${item.name}: ${a.username || a.id}`, img: item.img, sub: a.displayName || 'Not linked to anyone', group: 'Terminal accounts' })))];
    const pick = await showNamePicker({ title: 'Whose log?', hint: 'Any line or terminal account.', placeholder: 'search…', entries });
    if (!pick?.id) return false;
    load(TAB); S.lgT = pick.id; S.lgE = blankEntry();
  },
  lgDel: async (el) => {
    const t = logParts(S.lgT), id = el.dataset.id;
    if (t.kind === 'owner') { await undoable('Entry deleted.', () => logWrite(logEntries().filter((y) => y.id !== id))); return; }
    const item = logTerminal(t.uuid); if (item) await game.nightcity.terminalService.removeAccountMessage(item, `call-${id}`);
  },
  lgSave: async () => {
    const e = S.lgE, person = byId(e.pick), t = logParts(S.lgT);
    const who = person ? person.name : e.pick === '__none' ? '' : e.who;
    const n = person ? (person.lines[0]?.n || '') : e.pick === '__none' ? '' : e.n;
    if (e.pick === '__other' && !who && !n) { ncmNotify.warn('Give it a name or a number.'); return false; }
    const row = { id: e.id || foundry.utils.randomID(), dir: e.dir, who, n, out: e.out, when: e.when || nowIso(), len: e.out === 'Answered' || e.out === 'Voicemail' ? e.len : '', vm: e.out === 'Voicemail' ? e.vm : '', ty: e.ty || 'std' };
    if (t.kind === 'owner') {
      const list = logEntries();
      await undoable(e.id ? 'Entry saved.' : 'Entry added.', async () => {
        const r = await logWrite(e.id ? list.map((y) => (y.id === e.id ? row : y)) : [...list, row]);
        if (r.ok && e.both && person && !person.actorOnly) { const me = byId(t.id); await SVC.saveWrittenLog(person.id, [...SVC.writtenLog(person.id), { ...row, id: foundry.utils.randomID(), dir: e.dir === 'in' ? 'out' : 'in', who: me?.name || '', n: me?.lines[0]?.n || '' }]); }
        return r;
      });
    } else {
      const item = logTerminal(t.uuid), ts = game.nightcity.terminalService;
      if (!item) return false;
      if (e.id) await ts.removeAccountMessage(item, `call-${e.id}`);
      await ts.addCallEntry(item, t.acc, row);
    }
    S.lgE = blankEntry();
  },
  lgFill: async () => {
    const pool = PEOPLE.filter((p) => p.lines[0] && p.id !== logParts(S.lgT).id), t = logParts(S.lgT);
    if (!pool.length) { ncmNotify.warn('Nobody has a number to fill it with yet.'); return false; }
    const base = Date.parse(nowIso()) || Date.now();
    const made = Array.from({ length: 5 }, (_, i) => { const p = pool[i % pool.length]; const missed = i === 3; return { id: foundry.utils.randomID(), dir: i % 2 ? 'out' : 'in', who: p.name, n: p.lines[0].n, out: missed ? 'Missed' : 'Answered', when: new Date(base - (i + 1) * 31 * 3600000).toISOString(), len: missed ? '' : `${1 + i}:${String(10 + i * 9).padStart(2, '0')}`, vm: '', ty: 'std' }; });
    if (t.kind === 'owner') { const list = logEntries(); await undoable(`Added ${made.length} calls.`, () => logWrite([...list, ...made])); return; }
    const item = logTerminal(t.uuid); if (item) for (const m of made) await game.nightcity.terminalService.addCallEntry(item, t.acc, m);
  },
  lgCsv: () => { download('ncm-call-log.csv', [['Direction', 'Who', 'Number', 'Outcome', 'When', 'Length', 'Voicemail'], ...logEntries().map((e) => [e.dir, e.who, e.n, e.out, e.when, e.len, e.vm])].map((l) => l.map(csvCell).join(',')).join('\n')); return false; },
  ovHow: () => { S.ovHowShut = !S.ovHowShut; },
  ovNew: async () => { const c = sanitizeScript({ name: 'New call', rec: true, a: { shows: 'name' }, b: { shows: 'number' }, lines: [] }); await OV().saveScript(c); S.ovEdit = c; S.stStep = 1; S.lnOpen = null; S.f = 'ovstage'; },
  ovOpen: (el) => { const id = el.dataset.id, run = ovRunOf(id); if (run) { S.ovRun = run.id; S.f = 'ovrun'; return; } S.ovEdit = OV().scripts().find((x) => x.id === id); S.stStep = 1; S.lnOpen = null; S.f = 'ovstage'; },
  ovBack: async () => { await OV().saveScript(S.ovEdit); S.f = 'ovhome'; },
  ovDel2: async () => { const id = S.ovEdit.id; await OV().deleteScript(id); S.ovEdit = null; S.f = 'ovhome'; },
  ovWho: async (el) => { const k = el.dataset.k; const list = (game.nightcity?.masterContactService?.getAll?.() || []).filter((c) => !c.sendOnly); const pick = await showNamePicker({ title: 'Who is talking?', hint: 'Any NPC or alias.', placeholder: 'search people…', entries: list.map((c) => ({ id: c.id, name: c.name, img: c.portrait || '', sub: c.identityOf ? 'alias' : (c.organization || c.role || ''), group: c.identityOf ? 'Aliases' : 'NPCs' })) }); if (!pick?.id) return false; load(TAB); const c = list.find((x) => x.id === pick.id); const side = S.ovEdit[k]; side.contactId = c.id; side.name = c.name; side.number = SVC.numberOfContact(c.id) || ''; await OV().saveScript(S.ovEdit); },
  ovSide: async (el) => { const [k, f] = el.dataset.k.split('.'), v = el.dataset.v; if (f === 'anchor' && v === 'spot') { const pins = game.nightcity?.terminalScenePins; const scene = game.scenes?.get(S.ovEdit[k].sceneId); if (scene && scene !== game.scenes.viewed) await scene.view(); const at = await pins?._pickPoint?.(S.ovEdit[k].name || 'them'); if (!at) return false; S.ovEdit[k].x = at.x; S.ovEdit[k].y = at.y; } S.ovEdit[k].anchor = v; await OV().saveScript(S.ovEdit); },
  ovDel: async (el) => { S.ovEdit.live = el.dataset.v === 'live'; await OV().saveScript(S.ovEdit); },
  stStep: async (el) => { await OV().saveScript(S.ovEdit); S.stStep = Number(el.dataset.i); },
  lnSide: async (el) => { const x = S.ovEdit.lines[Number(el.dataset.i)]; x.side = x.side === 'a' ? 'b' : 'a'; await OV().saveScript(S.ovEdit); },
  lnOpen: (el) => { const i = Number(el.dataset.i); S.lnOpen = S.lnOpen === i ? null : i; },
  lnDel: async (el) => { S.ovEdit.lines.splice(Number(el.dataset.i), 1); S.lnOpen = null; await OV().saveScript(S.ovEdit); },
  lnAdd: async () => { const last = S.ovEdit.lines.at(-1); S.ovEdit.lines.push(sanitizeLine({ side: last?.side === 'a' ? 'b' : 'a', text: '', delay: 1 })); await OV().saveScript(S.ovEdit); },
  lnMark: async (el) => { const x = S.ovEdit.lines[Number(el.dataset.i)], k = el.dataset.k; x.marks = x.marks.includes(k) ? x.marks.filter((m) => m !== k) : [...x.marks, k]; await OV().saveScript(S.ovEdit); },
  ovWhen: () => { CyberTimePicker.open({ value: S.ovEdit.at || nowIso(), title: 'When does it start?', onSet: async (iso) => { S.ovEdit.at = iso; await OV().saveScript(S.ovEdit); TAB.app.render(); } }); return false; },
  ovWhenOff: async () => { S.ovEdit.at = ''; await OV().saveScript(S.ovEdit); },
  ovStart: async () => { const saved = await OV().saveScript(S.ovEdit); const run = OV().start(saved.script); S.ovRun = run.id; S.f = 'ovrun'; },
  ovPlay: () => { const run = OV().runs.get(S.ovRun); OV().setPlaying(S.ovRun, !run.playing); },
  ovNext: () => { OV().next(S.ovRun); },
  ovEnd: async () => { await OV().end(S.ovRun); },
  ovJump: (el) => { OV().jump(S.ovRun, Number(el.dataset.i)); },
  ovClick: () => { OV().click(S.ovRun); },
  ovCut: (el) => { OV().cut(S.ovRun, el.dataset.u); },
  ovCutT: (el) => { OV().cut(S.ovRun, el.dataset.u, { trace: true }); },
  tlSide: (el) => { S.tlSide = el.dataset.v; },
  tlVoice: (el) => { S.tlVoice = el.dataset.v; },
  tlSend: (el) => { const box = el.closest('.ncm-pn').querySelector('[data-tl-in]'); const v = box?.value.trim(); if (!v) return false; OV().say(S.ovRun, S.tlSide || 'a', v, S.tlVoice || 'text'); S.tlSide = (S.tlSide || 'a') === 'a' ? 'b' : 'a'; },
  evSet: async (el) => { const r = OV().rules; r[el.dataset.k] = el.dataset.v; await OV().saveRules(r); },
  evItemOff: async (el) => { const r = OV().rules; r[el.dataset.k].splice(Number(el.dataset.i), 1); await OV().saveRules(r); },
  evItemAdd: async (el) => { const k = el.dataset.k, list = await pickItems(OV().rules[k], { hint: 'Having any one counts. Cyberware counts once installed.' }); if (!list) return false; load(TAB); const r = OV().rules; r[k] = list; await OV().saveRules(r); },
  ttSet: async (el) => { const c = emCfg(); c.trauma[el.dataset.k] = el.dataset.v; await saveEm(c); },
  ttItemOff: async (el) => { const c = emCfg(); c.trauma[el.dataset.k].splice(Number(el.dataset.i), 1); await saveEm(c); },
  ttItemAdd: async (el) => { const k = el.dataset.k, list = await pickItems(emCfg().trauma[k], { hint: 'Having any one of them counts. Cyberware counts once installed.' }); if (!list) return false; load(TAB); const c = emCfg(); c.trauma[k] = list; await saveEm(c); },
  ttArt: () => { const c = emCfg(), line = traumaLine(SPECIAL, c.trauma.specialId, specialKey), x = SPECIAL.find((y) => y.id === line.id); if (!x) return false; newFilePicker({ type: 'image', current: x.img || '', callback: async (path) => { x.img = path; await saveSpecial(); TAB.app.render(); } }).render(true); return false; },
  ttArtClear: async () => { const c = emCfg(), line = traumaLine(SPECIAL, c.trauma.specialId, specialKey), x = SPECIAL.find((y) => y.id === line.id); if (x) { x.img = ''; await saveSpecial(); } },
  bkArt: () => { const c = emCfg(), o = c.backup.orgs[S.bkOrg]; if (!o) return false; newFilePicker({ type: 'image', current: o.logo || '', callback: async (path) => { const c2 = emCfg(); if (c2.backup.orgs[S.bkOrg]) { c2.backup.orgs[S.bkOrg].logo = path; await saveEm(c2); TAB.app.render(); } } }).render(true); return false; },
  bkArtClear: async () => { const c = emCfg(); if (c.backup.orgs[S.bkOrg]) { c.backup.orgs[S.bkOrg].logo = ''; await saveEm(c); } },
  bkGArt: async (el, ev) => {
    const i = Number(el.dataset.i), c = emCfg(), r = c.backup.orgs[S.bkOrg]?.rows[i];
    if (!r) return false;
    if (ev?.shiftKey && r.logo) { r.logo = ''; await saveEm(c); return; }
    newFilePicker({ type: 'image', current: r.logo || '', callback: async (path) => { const c2 = emCfg(), g2 = c2.backup.orgs[S.bkOrg]?.rows[i]; if (g2) { g2.logo = path; await saveEm(c2); TAB.app.render(); } } }).render(true);
    return false;
  },
  bkOpen: (el) => { S.bkOpen = S.bkOpen === el.dataset.id ? null : el.dataset.id; S.scroll.bk1 = 0; S.scroll.bkl = 0; },
  bkTabPick: (el) => { S.bkTab = el.dataset.v; },
  emTok: (el) => { const box = document.activeElement; if (!box?.matches?.('textarea[data-in="emLine"]')) { ncmNotify.info('Click in a box first, then pick a fill-in.'); return false; } box.setRangeText(el.dataset.t, box.selectionStart, box.selectionEnd, 'end'); box.dispatchEvent(new Event('input', { bubbles: true })); return false; },
  emClear: async (el) => { const c = emCfg(), h = voiceHolder(c, el.dataset.scope); if (h) delete h.voice[el.dataset.k]; await saveEm(c); },
  emLight: async (el) => { const c = emCfg(), h = voiceHolder(c, el.dataset.scope); if (!h) return false; if (el.dataset.v === '') delete h.look.lights; else h.look.lights = el.dataset.v === 'on'; await saveEm(c); },
  emLookOff: async (el) => { const c = emCfg(), h = voiceHolder(c, el.dataset.scope); if (h) delete h.look[el.dataset.k]; await saveEm(c); },
  emHear: (el) => { game.nightcity?.soundService?.play?.(el.dataset.v); return false; },
  emArt: (el) => { const scope = el.dataset.scope, h0 = voiceHolder(emCfg(), scope); newFilePicker({ type: 'image', current: h0?.img || '', callback: async (path) => { const c = emCfg(), h = voiceHolder(c, scope); if (h) { h.img = path; await saveEm(c); TAB.app.render(); } } }).render(true); return false; },
  emArtOff: async (el) => { const c = emCfg(), h = voiceHolder(c, el.dataset.scope); if (h) h.img = ''; await saveEm(c); },
  emGAdd: async (el) => { const box = el.closest('.ncm-pn'), v = (id) => box.querySelector('#' + id)?.value; const name = String(v('emg-an') || '').trim(); if (!name) { ncmNotify.warn('Give the group a name.'); return false; } const r1 = Math.min(10, Math.max(1, Number(v('emg-a1')) || 1)); const c = emCfg(), h = voiceHolder(c, 'p:' + el.dataset.id); h.groups.push({ r1, r2: Math.min(10, Math.max(r1, Number(v('emg-a2')) || r1)), name, logo: '' }); await saveEm(c); },
  emGDel: async (el) => { const c = emCfg(), h = voiceHolder(c, 'p:' + el.dataset.id); h.groups.splice(Number(el.dataset.i), 1); await saveEm(c); },
  emGArt: (el, e) => {
    const i = Number(el.dataset.i), who = 'p:' + el.dataset.id, g0 = voiceHolder(emCfg(), who).groups[i];
    if (!g0) return false;
    if (e?.shiftKey && g0.logo) { const c = emCfg(); voiceHolder(c, who).groups[i].logo = ''; saveEm(c).then(() => TAB.app.render()); return false; }
    newFilePicker({ type: 'image', current: g0.logo || '', callback: async (path) => { const c = emCfg(), g = voiceHolder(c, who).groups[i]; if (g) { g.logo = path; await saveEm(c); TAB.app.render(); } } }).render(true);
    return false;
  },
  emPlay: (el) => {
    const how = el.dataset.how, em = game.nightcity?.emergencyHud, svc = EM();
    const a = actorOf(el.dataset.a || PCS()[0]?.id);
    if (!a) { ncmNotify.warn('There is no player character to show it with.'); return false; }
    if (how === 'busy') em?.backup(a, null, { preview: true, previewBusy: true });
    else if (how === 'arrive') em?.arrival(svc.arrivalFor(svc.backupInfo(a)));
    else if (how === 'arrive-tt') em?.arrival(svc.arrivalFor(svc.traumaInfo(a)));
    else em?.backup(a, null, { preview: true });
    return false;
  },
  bkPlay: () => { const a = actorOf((PCS().find((p) => roleRank(itemsOf(p.id), 'Lawman') > 0) || PCS()[0])?.id); if (!a) { ncmNotify.warn('There is no player character to show it with.'); return false; } game.nightcity?.emergencyHud?.backup(a, null, { preview: true }); return false; },
  ttPlay: () => { const a = actorOf(PCS()[0]?.id); if (!a) { ncmNotify.warn('There is no player character to show it with.'); return false; } game.nightcity?.emergencyHud?.trauma(a, a, { preview: true }); return false; },
  bkOrgPick: async () => { const c = emCfg(); const pick = await showNamePicker({ title: 'Which organization?', placeholder: 'search names and groups…', selected: S.bkOrg, entries: Object.entries(c.backup.orgs).map(([id, o]) => ({ id, name: o.name, group: o.kind, sub: o.rows.map((r) => r.name).join(', ') })) }); if (!pick?.id) return false; load(TAB); S.bkOrg = pick.id; S.bkGq = ''; S.bkRank = 'all'; },
  bkNew: async () => { const name = await themedPrompt({ title: 'New organization', label: 'Add it', icon: 'fas fa-shield-halved', content: dialogBodyHtml({ tone: 'act', icon: 'fas fa-shield-halved', title: 'A new organization', lead: 'It starts with placeholder names. Rename any of them.', field: { label: 'Name', name: 'name', value: '', placeholder: 'Harbor Authority' } }), read: (root) => root.querySelector('input[name=name]')?.value?.trim() || null }); if (!name) return false; load(TAB); const c = emCfg(), id = 'o' + foundry.utils.randomID(6); c.backup.orgs[id] = { name, kind: 'Private', rows: DEFAULT_ORGS.book.rows.map((r) => ({ ...r })) }; S.bkOrg = id; await saveEm(c); },
  bkOrgDel: async () => {
    const c0 = emCfg(), id = S.bkOrg, o = c0.backup.orgs[id]; if (!o) return false;
    const using = Object.values(c0.backup.chars).filter((x) => x === id).length;
    const ok = await themedConfirm({ title: 'Delete organization', yes: 'Delete', yesIcon: 'fas fa-trash', bad: true, content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-shield-halved', title: o.name, kind: 'Organization', lead: '**This removes it and its ' + o.rows.length + (o.rows.length === 1 ? ' group.**' : ' groups.**'), goes: using ? [using + (using === 1 ? ' Lawman moves' : ' Lawmen move') + ' to the default organization'] : [] }) });
    if (!ok) return false;
    load(TAB); const c = emCfg(); delete c.backup.orgs[id];
    for (const [who, x] of Object.entries(c.backup.chars)) if (x === id) delete c.backup.chars[who];
    S.bkOrg = Object.keys(c.backup.orgs)[0] || null; S.bkGq = ''; S.bkRank = 'all';
    await saveEm(c);
  },
  bkOrgReset: async () => {
    const ok = await themedConfirm({ title: 'Put back the samples', yes: 'Put them back', yesIcon: 'fas fa-rotate-left', content: dialogBodyHtml({ tone: 'attn', icon: 'fas fa-rotate-left', title: 'Sample organizations', kind: 'Lawman Backup', lead: '**This replaces every organization here with the samples.** Your own names and groups go, and every Lawman goes back to the default. Words and groups you set on a person stay.' }) });
    if (!ok) return false;
    load(TAB); const c = emCfg(); c.backup.orgs = JSON.parse(JSON.stringify(DEFAULT_ORGS)); c.backup.chars = {};
    S.bkOrg = 'book'; S.bkGq = ''; S.bkRank = 'all';
    await saveEm(c);
  },
  bkDelG: async (el) => { const c = emCfg(); if (!c.backup.orgs[S.bkOrg]) return false; c.backup.orgs[S.bkOrg].rows.splice(Number(el.dataset.i), 1); await saveEm(c); },
  bkAddG: async (el) => { const box = el.closest('.ncm-pn'), v = (id) => box.querySelector('#' + id)?.value; const name = String(v('bk-an') || '').trim(); if (!name) { ncmNotify.warn('Give the group a name.'); return false; } const r1 = Number(v('bk-a1')) || 1, r2 = Number(v('bk-a2')) || r1; const c = emCfg(); c.backup.orgs[S.bkOrg].rows.push({ r1, r2, name, logo: '' }); await saveEm(c); },
  hudState: (el) => { S.hudLive = el.dataset.v === 'live'; },
  typ: (el) => { S.typ = el.dataset.id; },
  typNew: async () => { typesNow(); const t = sanitizeLineType({ id: 't' + foundry.utils.randomID(6), name: 'New type', word: 'New' }); S.typ = t.id; await saveTypes([...TYPES, t]); },
  typSet: async (el) => { typesNow(); const x = typeOf(S.typ) || TYPES[0]; x[el.dataset.k] = el.dataset.v; await saveTypes(TYPES); },
  typDel: async () => { typesNow(); const x = typeOf(S.typ); await undoable(`Removed ${x.name}. Its lines read as Standard, with the same numbers.`, () => saveTypes(TYPES.filter((t) => t !== x))); S.typ = 'std'; },
  off: (el) => { S.off = el.dataset.id; S.dialExt = ''; },
  coTab: (el) => { S.coTab = el.dataset.k; },
  coFold: (el) => { const k = el.dataset.k; const shut = !el.classList.contains('is-shut'); (shut ? S.coShut : S.coOpen).add(k); (shut ? S.coOpen : S.coShut).delete(k); },
  corpBox: async () => {
    officesNow();
    const o = OFFICES.find((x) => x.id === S.off), list = (game.nightcity?.masterContactService?.getAll?.() || []);
    const pick = await showNamePicker({ title: 'Where do messages land?', hint: 'Messages left for this office go in this contact\'s inbox, under Call log → Voicemail.', placeholder: 'search people…', allowNone: true, selected: o?.mailbox || null, entries: list.map((c) => ({ id: c.id, name: c.name, img: c.portrait || '', sub: c.organization || c.email || '' })) });
    if (!pick) return false;
    await saveOffice({ mailbox: pick.none ? '' : pick.id });
  },
  corpAns: async (el) => { officesNow(); await saveOffice({ answers: el.dataset.v }); },
  corpArt: () => { officesNow(); const o = OFFICES.find((x) => x.id === S.off); newFilePicker({ type: 'image', current: o?.art || '', callback: async (path) => { load(TAB); officesNow(); await saveOffice({ art: path }); TAB.app.render(); } }).render(true); return false; },
  extAdd: async (el) => { const box = el.closest('.ncm-pn'); const x = box.querySelector('#ex-x')?.value.trim(), who = box.querySelector('#ex-who')?.value.trim(); if (!/^\d+$/.test(x || '') || !who) { ncmNotify.warn('An extension needs digits and a name.'); return false; } officesNow(); const o = OFFICES.find((y) => y.id === S.off); if (o.ext.some((e) => e.x === x)) { ncmNotify.warn('That extension is taken.'); return false; } const c = (game.nightcity?.masterContactService?.getAll?.() || []).find((m) => m.name.toLowerCase() === who.toLowerCase()); await saveOffice({ exts: [...o.ext, { x, who, contactId: c?.id || null, listed: true }] }); },
  extDel: async (el) => { officesNow(); const o = OFFICES.find((y) => y.id === S.off); await saveOffice({ exts: o.ext.filter((_, i) => i !== Number(el.dataset.i)) }); },
  extDial: (el) => { S.dialExt = el.dataset.x; },
  areaAll: (el) => { const [rc, city] = S.boardCity.split(':'); const shut = el.dataset.v === 'shut'; for (const a of uniq(ROWS.filter((r) => r['Region code'] === rc && r['City code'] === city).map((r) => r.Area || (isCorp(r) ? 'Offices' : 'The city')))) { const k = S.boardCity + '|' + a; (shut ? S.areaShut : S.areaOpen).add(k); (shut ? S.areaOpen : S.areaShut).delete(k); } },
  lineCall: (el) => { TAB._callAs(el.dataset.id); return false; },
  lineGreeting: (el) => { TAB._editGreeting(el.dataset.n, el.dataset.name); return false; },
  orgUse: (el) => orgDecide(el.dataset.org, el.dataset.corp, 'Everyone whose Organization reads ' + el.dataset.org + ' now goes to ' + el.dataset.corp + '. No contact was changed.'),
  orgNot: (el) => orgDecide(el.dataset.org, '', el.dataset.org + ' is not a corporation. It will not be asked again.'),
  orgForget: async (el) => { const m = { ...ORG_MAP }; delete m[el.dataset.k]; await SVC.saveNumberSetting('phoneOrgNames', m); orgChanged(); },
  wkUse: async () => {
    const w = S.walk, p = byId(w.pid), r = wkRow(w.path), line = /^\d{4}$/.test(w.own || '') ? w.own : w.line, n = numAt(r, line);
    const sameAsStart = rowKey2(r) === rowKey2(rowOfNum(parse(w.start.n)));
    const why = sameAsStart ? w.start.why : 'You picked ' + (r.District || r.City) + '.';
    const pr = { n, why, src: sameAsStart ? w.start.src : 'you', code: r.Code, rowKey: r['City code'] + '/' + (r.Code || '-') };
    S.walk = null;
    if (w.target === 'bulk') { S.bulk[p.id] = pr; S.f = 'bulk'; return; }
    if (w.target === 'change') { S.change.prop = pr; S.change.typed = ''; return; }
    if (w.target === 'add') { S.addLine.n = n; return; }
    delete S.prop[p.id];
    await undoable(`${p.name} now has ${seenFrom(parse(n))}.`, () => give(p, n, why));
  },
  useProp: async (el) => { const p = byId(el.dataset.id), pr = S.prop[p.id]; delete S.prop[p.id]; await undoable(`${p.name} now has ${seenFrom(parse(pr.n))}.`, () => give(p, pr.n, pr.why)); },
  chgGo: async () => {
    const c = S.change, p = byId(c.pid), l = p.lines[c.i], old = l.n, held = l.holders;
    const cand = c.typed ? parse(c.typed) : null, n = cand ? fullForm(cand) : c.prop.n, why = cand ? 'You typed this one.' : c.prop.why;
    S.change = null;
    await undoable(`${p.name} is now on ${seenFrom(parse(n))}. ${seenFrom(parse(old))} retired.${c.push && held.length ? ' New number sent to ' + held.map((h) => byId(h)?.name).join(', ') + '.' : ''}`, async () => {
      let r;
      if (l.kind === 'extra' || l.kind === 'burner') { r = await SVC.addLine({ ...ownerOf(p), number: n, kind: l.kind, label: l.label, why }); if (r.ok) await SVC.retireLine(old); }
      else r = await give(p, n, why);
      if (r.ok && c.push && held.length) await SVC.pushNewNumber(old, n, held);
      return r;
    });
  },
  retireLine: async (el) => { const p = byId(el.dataset.id), l = p.lines[Number(el.dataset.i)]; await undoable(`${seenFrom(parse(l.n))} retired for good.`, () => (l.kind === 'extra' || l.kind === 'burner' ? SVC.retireLine(l.n) : SVC.releaseNumber(l.n))); },
  lineOff: async (el) => { const p = byId(el.dataset.id), l = p.lines[Number(el.dataset.i)]; const off = !l.off; await undoable(off ? `${seenFrom(parse(l.n))} is switched off. Callers hear not in service, and the holder is told.` : `${seenFrom(parse(l.n))} is back in service.`, () => SVC.setLineOff(l.n, off)); },
  shareFrom: async (el) => { await TAB._shareLine(byId(el.dataset.id), byId(el.dataset.id).lines[Number(el.dataset.i)]); },
  addGo: async () => {
    const a = S.addLine, p = byId(a.pid), biz = a.kind === 'biz', name = String(a.label || '').trim();
    if (biz && !name) { ncmNotify.warn('Give the business a name.'); return false; }
    S.addLine = null;
    await undoable(`Added ${seenFrom(parse(a.n))} to ${p.name}.`, async () => {
      const res = await give(p, a.n, biz ? 'Their business line.' : 'You gave them this one.', biz ? 'extra' : a.kind, name || (a.kind === 'burner' ? 'Burner' : 'Extra line'));
      if (res?.ok !== false && biz) await SVC.setLineType(a.n, { type: 'biz' });
      return res;
    });
  },
  undo: async () => { const u = S.undo; S.undo = null; refuse(await SVC.restorePhoneSnapshot(u.snap, u.after)); freshBulk(); },
  bulkGo: async () => {
    const list = Object.entries(S.bulk).filter(([id]) => !S.bulkOff.has(id));
    S.f = 'numbers'; freshBulk(); S.bulkOff.clear();
    let done = 0;
    await undoable(() => `Gave ${done} number${done === 1 ? '' : 's'}.`, async () => { for (const [id, pr] of list) { const r = await give(byId(id), pr.n, pr.why); if (r.ok) done++; else ncmNotify.warn(`${byId(id).name}: ${r.error}`); } return { ok: true }; });
  },
  tile: async (el) => {
    const k = el.dataset.k; const [rc, city] = S.boardCity.split(':');
    if (S.dock) { const p = byId(S.dock); const r = ROWS.find((x) => x['Region code'] === rc && x['City code'] === city && (x.Code || '-') === k); const pr = suggest(p, {}, r); S.dock = null; S.tile = k; await undoable(`${p.name} is on ${seenFrom(parse(pr.n))}.`, () => give(p, pr.n, pr.why)); return; }
    S.tile = S.tile === k ? null : k;
  },
  reqYes: async (el) => { const r = REQUESTS.find((x) => x.id === el.dataset.id), p = byId(r.pid); await undoable(r.type === 'change' ? `${p.name} is on ${seenFrom(parse(r.to))}. Their old number retired.` : `Added ${seenFrom(parse(r.to))} to ${p.name}.`, () => SVC.answerRequest(r.id, true)); },
  reqNo: async (el) => { const r = REQUESTS.find((x) => x.id === el.dataset.id); await undoable(`Declined. ${byId(r.pid).name} is told.`, () => SVC.answerRequest(r.id, false)); },
  relGo: async (el) => { const n = el.dataset.n; S.relOpen = null; await undoable(`${seenFrom(parse(n))} can be handed out again.`, () => SVC.releaseRetired(n)); },
  listYes: () => applyList(S.listAsk),
  spNewOne: async () => { const x = sanitizeSpecial({ id: 's' + Math.random().toString(36).slice(2, 9), num: 'NEW' + (SPECIAL.length + 1) }); SPECIAL.push(x); S.spSel = x.id; await saveSpecial(); },
  spDel: async () => { const x = spOf(); await undoable(`Removed ${x.num || 'the new number'}.`, () => { SPECIAL = SPECIAL.filter((y) => y !== x); S.spSel = SPECIAL[0]?.id || null; return saveSpecial(); }); },
  spArt: () => { const x = spOf(); newFilePicker({ type: 'image', current: x.img || '', callback: async (path) => { x.img = path; await saveSpecial(); TAB.app.render(); } }).render(true); return false; },
  spArtClear: async () => { spOf().img = ''; await saveSpecial(); },
  spSet: async (el) => { const x = spOf(); x[el.dataset.k] = el.dataset.v; if (el.dataset.k === 'who' && el.dataset.v === 'all') x.allow = []; await saveSpecial(); },
  spRing: async () => { const x = spOf(), to = byId(S.spCall?.to || PCS()[0]?.id), num = to?.lines[0]?.n; if (!num) { ncmNotify.warn('They have no number to ring.'); return false; } refuse(await SVC.placeCall(num, { special: x.id })); return false; },
  spTry: () => { S.tryN = spOf().num; S.f = 'learn'; },
  csvSpecial: () => { download('ncm-special-numbers.csv', [['Number', 'Name', 'Seen', 'When dialled', 'Who gets through', 'Screen shows', 'Trace finds', 'Alert'], ...SPECIAL.map((x) => [x.num, x.name, x.seen, x.act, x.who === 'all' ? 'anyone' : x.allow.map((a) => byId(a)?.name || a).join('; '), x.show, x.trace === 'false' ? x.falseName : x.trace, x.alert ? 'yes' : 'no'])].map((l) => l.map(csvCell).join(',')).join('\n')); return false; },
  scope: (el) => saveRules({ reach: el.dataset.v === 'city' ? 'home' : el.dataset.v }),
  own: (el) => saveRules({ ownDigits: el.dataset.v === '1' }),
  appr: (el) => saveRules({ changeNeedsGm: el.dataset.v === '1' }),
  tbHide: async (el) => { const hits = ROWS.filter(tbHit); hits.forEach((r) => { r.Listed = el.dataset.v; }); await savePlaces(); toast(`${hits.length} row${hits.length === 1 ? '' : 's'} ${el.dataset.v === 'no' ? 'hidden from' : 'listed in'} the directory.`); },
  edSave: async (el) => { const r = ROWS[Number(el.dataset.i)]; const root = el.closest('.ncm-pn'); const v = (id) => root.querySelector('#' + id)?.value.trim() ?? ''; const code = v('ed-code').toUpperCase(); if (code && !/^[A-Z]{3}$/.test(code)) { ncmNotify.warn('A district code is three letters.'); return false; } r.Code = code; r.District = v('ed-dist'); r.Area = v('ed-area'); r.State = v('ed-state'); r.Category = v('ed-cat'); r.Status = v('ed-status'); r.Source = v('ed-src'); EXTRA_COLS.forEach((c, x) => { r[c] = v('ed-x' + x); }); S.edit = null; await savePlaces(); },
  delRow: async (el) => { const i = Number(el.dataset.i), r = ROWS[i]; await undoable(`Removed ${r.Code || r.City}.`, () => savePlaces(ROWS.filter((x) => x !== r))); },
  apGo: async () => { const a = S.addPlace; const isNew = a.rc === 'new'; const rc = isNew ? a.nrc : a.rc; if (!rc || !a.city || !a.cc) { ncmNotify.warn('A place needs a region, a city and a city code.'); return false; } const r = row([rc, isNew ? a.nr || 'New region' : REGIONS[a.rc].name, a.st, a.cc.toUpperCase(), a.city, a.ar, a.ex.toUpperCase(), a.di, a.ex ? 'District' : 'City', 'yes', 'live', 'Homebrew'].join('|')); S.pOpen.add(rc); S.addPlace = null; await undoable(`Added ${a.di || a.city}.`, () => savePlaces([...ROWS, r])); },
  abGo: async () => { const a = S.addBranch; const [code, name] = a.corp.split('|'); const [rc, cc] = a.city.split(':'); const c = ROWS.find((x) => x['Region code'] === rc && x['City code'] === cc); const r = row([rc, c.Region, c.State, cc, c.City, 'Office', code, name, 'Corporate', 'no', 'live', 'Homebrew', a.hide ? 'no' : 'yes'].join('|')); S.pOpen.add(rc); S.addBranch = null; await undoable(`Added ${name} in ${c.City}.`, () => savePlaces([...ROWS, r])); },
  csvPlaces: () => { download('ncm-places.csv', toCsv()); return false; },
  csvBlank: () => { download('ncm-places-template.csv', [COLS, ['99', 'My region', 'My state', 'MC', 'My city', 'Uptown', 'UPT', 'Uptown', 'District', 'yes', 'live', 'Homebrew', 'yes']].map((l) => l.map(csvCell).join(',')).join('\n')); return false; },
  csvAssigned: () => { download('ncm-numbers.csv', [['Number', 'Holder', 'Kind', 'Label', 'Alias of', 'State', 'Why', 'Saved by'], ...allLines().map(({ p, l }) => [fullForm(parse(l.n)), p.name, l.kind, l.label, p.aliasOf ? byId(p.aliasOf)?.name : '', l.off ? 'off' : 'on', l.why, l.holders.map((h) => byId(h)?.name).join('; ')])].map((x) => x.map(csvCell).join(',')).join('\n')); return false; },
  csvRetired: () => { download('ncm-retired.csv', [['Number', 'Was', 'Why', 'When'], ...RET.map((r) => [r.n, r.was, r.why, r.at])].map((x) => x.map(csvCell).join(',')).join('\n')); return false; },
  csvImport: (el) => { el.closest('.ncm-pn').querySelector('#tbfile').click(); return false; },
  planYes: async () => { const p = S.plan; S.plan = null; await undoable('Table replaced from the file. No number anyone holds changed.', () => savePlaces(p.rows, S.list, p.extra)); },
  tbReset: async () => { const held = ROWS.filter((r) => rowHeld(r) > 0 && !BOOK_ROWS.some((b) => (b['Region code'] + '/' + b['City code'] + '/' + (b.Code || '')) === (r['Region code'] + '/' + r['City code'] + '/' + (r.Code || '')))); await undoable('Back to the shipped table. No number anyone holds changed.', () => savePlaces([...startingRows('2045'), ...held], '2045', [])); },
};
const CH = {
  orgPick: (el) => { if (el.value) return orgDecide(el.dataset.org, el.value, 'Everyone whose Organization reads ' + el.dataset.org + ' now goes to ' + el.value + '. No contact was changed.'); },
  show: (el) => { S.show = el.value; }, group: (el) => { S.group = el.value; },
  typSel: async (el) => { typesNow(); const x = typeOf(S.typ) || TYPES[0]; x[el.dataset.k] = el.value; await saveTypes(TYPES); },
  typChk: async (el) => { typesNow(); const x = typeOf(S.typ) || TYPES[0]; x[el.dataset.k] = el.checked; await saveTypes(TYPES); },
  lgTy: (el) => { S.lgE.ty = el.value; }, lgPick: (el) => { S.lgE.pick = el.value; }, lgBoth: (el) => { S.lgE.both = el.checked; },
  ovSet: async (el) => { const k = el.dataset.k; if (k.includes('.')) { const [s, f] = k.split('.'); S.ovEdit[s][f] = el.value; if (f === 'sceneId' && el.value && S.ovEdit[s].anchor === 'off') S.ovEdit[s].anchor = 'token'; if (f === 'sceneId' && !el.value) S.ovEdit[s].anchor = 'off'; } else S.ovEdit[k] = el.value; await OV().saveScript(S.ovEdit); },
  ovChk: async (el) => { S.ovEdit[el.dataset.k] = el.checked; await OV().saveScript(S.ovEdit); },
  lnVoice: async (el) => { S.ovEdit.lines[Number(el.dataset.i)].voice = el.value; await OV().saveScript(S.ovEdit); },
  lnDelay: async (el) => { S.ovEdit.lines[Number(el.dataset.i)].delay = Number(el.value) || 0; await OV().saveScript(S.ovEdit); },
  clShow: (el) => { S.clShow = el.value; }, lshow: (el) => { S.lshow = el.value; },
  evNum: async (el) => { const r = OV().rules; r[el.dataset.k] = Number(el.value); await OV().saveRules(r); },
  evChk: async (el) => { const r = OV().rules; r[el.dataset.k] = el.checked; await OV().saveRules(r); },
  evSk: async (el) => { const r = OV().rules; r.skill = el.value; await OV().saveRules(r); },
  ttSpecial: async (el) => { const c = emCfg(); c.trauma.specialId = el.value; await saveEm(c); },
  emSound: async (el) => { const c = emCfg(), h = voiceHolder(c, el.dataset.scope); if (!h) return; if (el.value) h.look[el.dataset.k] = el.value; else delete h.look[el.dataset.k]; await saveEm(c); },
  emColor: async (el) => { const c = emCfg(), h = voiceHolder(c, el.dataset.scope); if (h) { h.look.color = el.value; await saveEm(c); } },
  bkKind: async (el) => { const c = emCfg(); if (c.backup.orgs[S.bkOrg]) { c.backup.orgs[S.bkOrg].kind = el.value; await saveEm(c); } },
  ttPlan: async (el) => { const c = emCfg(); c.trauma.plans[el.dataset.id] = el.value; await saveEm(c); },
  ttChk: async (el) => { const c = emCfg(); c.trauma[el.dataset.k] = el.checked; await saveEm(c); },
  ttShow: (el) => { S.ttShow = el.value; },
  bkRank: (el) => { S.bkRank = el.value; },
  bkOrgOf: async (el) => { const c = emCfg(); c.backup.chars[el.dataset.id] = el.value; await saveEm(c); },
  lineType: (el) => SVC.setLineType(el.dataset.n, { type: el.value }),
  extList: async (el) => { officesNow(); const o = OFFICES.find((y) => y.id === S.off); o.ext[Number(el.dataset.i)].listed = el.checked; await saveOffice({ exts: o.ext }); },
  corpFrom: (el) => { S.corpFrom = el.value; },
  coShow: (el) => { S.coShow = el.value; }, coGroup: (el) => { S.coGroup = el.value; },
  chgPush: (el) => { S.change.push = el.checked; },
  bulkAll: (el) => { S.bulkAll = el.checked; freshBulk(); },
  bulkTick: (el) => { if (el.checked) S.bulkOff.delete(el.dataset.id); else S.bulkOff.add(el.dataset.id); },
  bulkDist: (el) => { const id = el.dataset.id; const [c, x] = el.value.split('/'); const r = homeRows().find((y) => y['City code'] === c && y.Code === x); if (r) S.bulk[id] = suggest(byId(id), {}, r); },
  boardCity: (el) => { S.boardCity = el.value; S.tile = null; },
  trPick: (el) => { const [rc, c] = S.boardCity.split(':'); const r = ROWS.find((x) => x['Region code'] === rc && x['City code'] === c && (x.Code || '-') === el.dataset.k); r['Players can pick'] = el.checked ? 'yes' : 'no'; return savePlaces(); },
  trList: (el) => { const [rc, c] = S.boardCity.split(':'); const r = ROWS.find((x) => x['Region code'] === rc && x['City code'] === c && (x.Code || '-') === el.dataset.k); r.Listed = el.checked ? 'yes' : 'no'; return savePlaces(); },
  tryAs: (el) => { S.tryAs = el.value; },
  home: (el) => { const [rc, city] = el.value.split(':'); S.boardCity = el.value; S.pOpen.add(rc); return saveRules({ home: { rc, city } }); },
  era: (el) => { const v = el.value; if (v === 'custom') { S.listAsk = null; return; } if (S.custom) { S.listAsk = v; return; } return applyList(v); },
  extra: (el) => saveRules({ extraLines: Number(el.value) }),
  rowPick: (el) => { ROWS[Number(el.dataset.i)]['Players can pick'] = el.checked ? 'yes' : 'no'; return savePlaces(); },
  rowList: (el) => { ROWS[Number(el.dataset.i)].Listed = el.checked ? 'yes' : 'no'; return savePlaces(); },
  apRc: (el) => { S.addPlace.rc = el.value; },
  abCorp: (el) => { S.addBranch.corp = el.value; }, abCity: (el) => { S.addBranch.city = el.value; }, abHide: (el) => { S.addBranch.hide = el.checked; },
  spTo: (el) => { S.spCall = { to: el.value }; },
  spAct: (el) => { spOf().act = el.value; return saveSpecial(); },
  spTrace: (el) => { spOf().trace = el.value; return saveSpecial(); },
  spMacro: (el) => { spOf().macro = el.value; return saveSpecial(); },
  spAlert: (el) => { spOf().alert = el.checked; return saveSpecial(); },
  spAllow: (el) => { const x = spOf(); if (el.checked) x.allow.push(el.dataset.id); else x.allow = x.allow.filter((a) => a !== el.dataset.id); return saveSpecial(); },
};
/* an input returns true when the screen should catch up after a pause; the box keeps its focus and caret */
const INP = {
  typ: (el) => { typesNow(); const x = typeOf(S.typ); if (!x) return false; x[el.dataset.k] = el.value; clearTimeout(TAB._spT); const list = TYPES; TAB._spT = setTimeout(() => saveTypes(list).then(() => TAB.app.render()), 400); return false; },
  lg: (el) => { S.lgE[el.dataset.k] = el.value; return false; },
  clq: (el) => { S.clq = el.value; return true; }, lq: (el) => { S.lq = el.value; return true; },
  ovName: (el) => { S.ovEdit.name = el.value; ovDebounce(); return false; },
  lnText: (el) => { S.ovEdit.lines[Number(el.dataset.i)].text = el.value; ovDebounce(); return false; },
  lnMeans: (el) => { S.ovEdit.lines[Number(el.dataset.i)].means = el.value; ovDebounce(); return false; },
  ttQ: (el) => { S.ttQ = el.value; return true; }, bkGq: (el) => { S.bkGq = el.value; return true; }, bkQ: (el) => { S.bkQ = el.value; return true; },
  lineLabel: (el) => { const n = el.dataset.n, v = el.value; clearTimeout(TAB._llT); TAB._llT = setTimeout(() => SVC.setLineType(n, { label: v.trim() }), 400); return false; },
  emLine: (el) => { emPending.set(el.dataset.scope + '|' + el.dataset.k, el.value); clearTimeout(emTimer); emTimer = setTimeout(() => emFlush().catch((e) => ncmNotify.error('Phone numbers: ' + e.message)), 500); return false; },
  emGName: (el) => { const i = Number(el.dataset.i), who = 'p:' + el.dataset.id, v = el.value; clearTimeout(TAB._spT); TAB._spT = setTimeout(async () => { const c = emCfg(), g = voiceHolder(c, who)?.groups[i]; if (g && v.trim()) { g.name = v.trim().slice(0, 50); await saveEm(c); } }, 400); return false; },
  bkName: (el) => { const i = Number(el.dataset.i), v = el.value; clearTimeout(TAB._spT); TAB._spT = setTimeout(async () => { const c = emCfg(); if (c.backup.orgs[S.bkOrg]?.rows[i]) { c.backup.orgs[S.bkOrg].rows[i].name = v; await saveEm(c); } }, 400); return false; },
  coQ: (el) => { S.coQ = el.value; return true; },
  corpGreet: (el) => { officesNow(); clearTimeout(TAB._spT); const v = el.value; TAB._spT = setTimeout(() => saveOffice({ greet: v }), 400); return false; },
  extDial: (el) => { S.dialExt = el.value; return true; },
  wkQ: (el) => { S.walk.q = el.value; return true; }, wkOwn: (el) => { S.walk.own = el.value.replace(/\D/g, '').slice(0, 4); return true; },
  q: (el) => { S.q = el.value; return true; }, boardQ: (el) => { S.boardQ = el.value; return true; }, rq: (el) => { S.rq = el.value; return true; }, tbq: (el) => { S.tbq = el.value; return true; },
  chgTyped: (el) => { S.change.typed = el.value; return true; },
  addLabel: (el) => { S.addLine.label = el.value; return false; },
  sp: (el) => { spOf()[el.dataset.k] = el.value; clearTimeout(TAB._spT); const list = SPECIAL; TAB._spT = setTimeout(() => SVC.saveNumberSetting('phoneSpecial', list.map(sanitizeSpecial)).then(() => TAB.app.render()), 400); return false; },
  tryN: (el) => { S.tryN = el.value; el.closest('.ncm-pn').querySelector('#try-out').innerHTML = tryPanes(); return false; },
  ap: (el) => { S.addPlace[el.dataset.k] = el.value; const box = document.createElement('div'); box.innerHTML = addPlaceForm(); el.closest('.ncm-pn').querySelector('#ap-out').innerHTML = box.querySelector('#ap-out').innerHTML; return false; },
};

/* ─── the number popover ─── */
let pop = null, popFor = null;
function hidePop() { pop?.remove(); pop = null; popFor = null; }
function showPop(el) {
  if (popFor === el) return; hidePop();
  const n = el.dataset.pn, p = parse(n); const rows = [];
  if (p.service) rows.push([specialOf(p.service)?.num || p.service, 'Special', specialOf(p.service)?.name || '']);
  else if (p.city) { rows.push(['+' + p.rc, 'Region', REGIONS[p.rc]?.name || '']); if (stateOf(p)) rows.push(['', 'State', stateOf(p)]); rows.push([p.city, 'City', REGIONS[p.rc]?.cities[p.city]?.name || '']); const r = rowOfNum(p); if (r?.Area) rows.push(['', 'Area', r.Area]); if (p.ex) rows.push([p.ex, 'District', r?.District || '']); rows.push([p.line, 'Line', '']); }
  const h = p.key ? holderOf(p.key) : null, ret = p.key ? isRetired(p.key) : null, r = p.key ? rowOfNum(p) : null;
  const gm = [h ? `Held by <b>${esc(h.p.name)}</b>${h.p.aliasOf ? ` (alias of ${esc(byId(h.p.aliasOf)?.name)})` : ''}. ${h.l.holders.length} saved it.` : '', ret ? `Retired: ${esc(ret.was)}, ${esc(ret.why.toLowerCase())}.` : '', r?.Listed === 'no' ? 'Hidden row. Players see Unlisted number.' : '', r?.Status === 'dead' ? 'Dead district.' : ''].filter(Boolean).join('<br>');
  pop = document.createElement('div'); pop.className = 'ncm-pn-pop ncm-admin-dialog';
  const theme = el.closest('[data-ncm-admin-theme]')?.dataset.ncmAdminTheme; if (theme) pop.dataset.ncmAdminTheme = theme;
  pop.innerHTML = `<div class="big">${esc(p.city ? fullForm(p) : n)}</div>${rows.map(([c, k, v]) => `<div class="r2"><code>${esc(c)}</code><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}${gm ? `<div class="gm">${gm}</div>` : ''}`;
  document.body.appendChild(pop); popFor = el;
  const a = el.getBoundingClientRect(), b = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(a.left, innerWidth - b.width - 8))}px`;
  pop.style.top = `${a.bottom + b.height + 8 > innerHeight ? Math.max(8, a.top - b.height - 6) : a.bottom + 6}px`;
}

/* ─── render + wiring ─── */

/** The HTML for the open frame. */
export function numbersHtml(tab) {
  load(tab);
  const F = { numbers: viewNumbers, bulk: viewBulk, board: viewBoard, requests: viewRequests, retired: viewRetired, learn: viewLearn, rules: viewRules, places: viewPlaces, special: viewSpecial, types: viewTypes, ring: viewRing, corp: viewCorp, shared: viewShared, editlog: viewLog, trauma: viewTrauma, backup: viewBackup, ovhome: viewOvHome, ovstage: viewOvStage, ovrun: viewOvRun, oveaves: viewOvEaves }[S.f] || viewNumbers;
  return `<div class="ncm-pn">${F()}</div>`;
}

/** How many requests wait, for the nav. */
export const requestCount = (tab) => tab.calls?.requests?.().length || 0;

/** Wire the rendered screen. It is rebuilt on every render, so nothing here needs taking down. */
export function wireNumbers(tab, root) {
  const box = root.querySelector('.ncm-pn');
  hidePop();
  clearInterval(tab._hudT);
  if (box?.querySelector('.ncm-r3-hud')) { const t0 = performance.now(); tab._hudT = setInterval(() => { if (!box.isConnected) { clearInterval(tab._hudT); return; } const t = performance.now() - t0; box.querySelectorAll('.ncm-r3-hud .ncm-ch-badge').forEach((b) => HUD?._paintBadge(b, t)); }, 120); }
  if (!box) return;
  for (const el of box.querySelectorAll('[data-sc]')) { const v = tab._pn.scroll[el.dataset.sc]; if (v) el.scrollTop = v; }
  const remember = () => { for (const el of box.querySelectorAll('[data-sc]')) tab._pn.scroll[el.dataset.sc] = el.scrollTop; };
  const after = (r) => { tab._view = S.goView || (S.f === 'editlog' ? 'logedit' : OVERHEARD_FRAMES.includes(S.f) ? 'overheard' : SETUP_FRAMES.includes(S.f) ? 'setup' : 'numbers'); S.goView = null; if (r !== false) tab.app.render(); };
  // typing a live line: Enter sends and passes to the other side, Tab switches
  box.querySelector('[data-tl-in]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); load(tab); S.tlSide = (S.tlSide || 'a') === 'a' ? 'b' : 'a'; tab.app.render(); }
    else if (e.key === 'Enter') { e.preventDefault(); load(tab); const v = e.target.value.trim(); if (!v) return; OV().say(S.ovRun, S.tlSide || 'a', v, S.tlVoice || 'text'); S.tlSide = (S.tlSide || 'a') === 'a' ? 'b' : 'a'; tab.app.render(); }
  });
  // a save re-renders this tab while someone types, so the scroll memory has to be current before any click or change
  box.addEventListener('scroll', remember, { capture: true, passive: true });
  box.addEventListener('mousedown', (e) => { if (e.target.closest?.('.ncm-emv__tok')) e.preventDefault(); });
  box.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-do]');
    if (!el || el.disabled) return;
    hidePop(); remember(); load(tab);
    if (emPending.size && el.dataset.do !== 'emTok') await emFlush();
    try { after(await ACT[el.dataset.do]?.(el, e)); } catch (err) { console.error('NCM | Phone numbers:', err); ncmNotify.error(`Phone numbers: ${err.message}`); }
  });
  box.addEventListener('change', async (e) => {
    if (e.target.id === 'tbfile') { const f = e.target.files?.[0]; if (f) { const t = await f.text(); load(tab); S.plan = planImport(t); tab.app.render(); } return; }
    const h = e.target.dataset?.ch;
    if (!h || !CH[h]) return;
    remember(); load(tab);
    try { await CH[h](e.target); after(); } catch (err) { console.error('NCM | Phone numbers:', err); ncmNotify.error(`Phone numbers: ${err.message}`); }
  });
  box.addEventListener('input', (e) => {
    const h = e.target.dataset?.in;
    if (!h || !INP[h]) return;
    // the special-number boxes write after a pause: reloading here would drop an edit still waiting
    if (h !== 'sp') load(tab);
    if (INP[h](e.target)) { clearTimeout(tab._pnT); tab._pnT = setTimeout(() => { remember(); tab.app.render(); }, 220); }
  });
  box.addEventListener('mouseover', (e) => { const n = e.target.closest?.('[data-pn]'); if (n) { load(tab); showPop(n); } else hidePop(); });
  box.addEventListener('mouseleave', hidePop);
  box.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-pn]')) { load(tab); showPop(e.target); } });
  box.addEventListener('focusout', (e) => { if (e.target.matches?.('[data-pn]')) hidePop(); });
}

/** A proposed number for a contact, from its details as they stand on the form. */
export function proposeFor(tab, { id = null, name = '', organization = '', location = '' }) {
  load(tab);
  const was = byId(id);
  const pr = suggest({ id: id || '_new', name, kind: 'npc', org: organization, loc: location, lines: [], aliasOf: was?.aliasOf || null });
  return { number: pr.n, why: pr.why };
}

/** What a typed number means, for a form. */
export function readNumber(tab, raw, ownerContactId = null) {
  load(tab);
  const p = parse(raw);
  if (p.empty) return { ok: true, text: '' };
  if (p.service) return { ok: false, text: 'That is a special number.' };
  if (!p.done) return { ok: false, text: p.hint || 'Keep typing: district, then four digits.' };
  if (!rowOfNum(p)) return { ok: false, text: 'That place is not in the table.' };
  if (isRetired(p.key)) return { ok: false, text: 'That number is retired. Pick another.' };
  const h = holderOf(p.key);
  if (h && h.p.id !== ownerContactId) return { ok: false, text: `${h.p.name} already has this.` };
  return { ok: true, text: `${placeOf(p)}.${h ? '' : ' Free.'}` };
}

/** Office names, for a contact form's Organization box. */
export function officeNames(tab) { load(tab); return uniq(ROWS.filter(isCorp).map((r) => r.District)).sort(); }

/** Drop the popover when the tab closes. */
export const closeNumbers = (tab) => { hidePop(); clearInterval(tab?._hudT); };
export const syncFrame = (tab, view) => { if (view === 'logedit') { tab._pn.f = 'editlog'; return; } if (view === 'overheard' && !OVERHEARD_FRAMES.includes(tab._pn.f)) tab._pn.f = 'ovhome'; if (view === 'overheard') return; if (view === 'setup' && !SETUP_FRAMES.includes(tab._pn.f)) tab._pn.f = 'learn'; if (view === 'numbers' && !NUMBER_FRAMES.includes(tab._pn.f)) tab._pn.f = 'numbers'; };
