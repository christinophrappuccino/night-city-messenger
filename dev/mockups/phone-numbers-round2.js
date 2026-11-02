/* Round 2 mock: the GM's side of numbers. A self-contained model over the shared place table; nothing is wired to the module. */
const q0 = new URLSearchParams(location.search);
const hueOf = (s) => { let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return `var(--ncm-hue-${(h % 8) + 1})`; };
const initials = (s) => String(s).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/* ─── the world ─── */
const pc = (id, name, player, role, lines = []) => ({ id, name, kind: 'pc', player, role, org: '', loc: '', lines, email: id + '@nightcity.net' });
const npc = (id, name, role, org, loc, lines = [], extra = {}) => ({ id, name, kind: 'npc', role, org, loc, lines, email: name.split(' ')[0].toLowerCase() + '@nightcity.net', ...extra });
const ln = (n, kind, why, holders = [], label = '') => ({ n, kind, why, holders, label });
const PEOPLE = [
  pc('v', 'Veronica A.', 'Alex', 'Netrunner', [ln('+72 NC WAT-4471', 'main', 'They picked this themselves in the Calls tab.', ['ra', 'ks']), ln('+10 DC CAP-8812', 'extra', 'They added this line themselves.', [], 'Old D.C. line'), ln('+72 NC BRN-7719', 'burner', 'They added this line themselves.', [], 'Burner')]),
  pc('ra', 'Rache', 'Sam', 'Solo', [ln('+72 NC KAB-3301', 'main', 'They picked this themselves in the Calls tab.', ['v'])]),
  pc('ks', 'Kid Static', 'Morgan', 'Tech', [ln('+72 NC LCH-6130', 'main', 'You gave them this one.', ['v'])]),
  pc('dx', 'Dex Moreno', 'Riley', 'Media'),
  npc('ju', 'Judy Alvarez', 'Techie', '', 'Watson', [ln('+72 NC WAT-2208', 'main', 'Lives in Watson, so a Watson number.', ['v', 'ks'])]),
  npc('ro', 'Rogue', 'Fixer', '', 'North Heywood', [ln('+72 NC NHW-2087', 'main', 'Works out of North Heywood.', ['v', 'ra'])]),
  npc('si', 'Silver', 'Fixer', '', '', [ln('+72 NC NHW-2090', 'alias', 'You typed this one.', ['v'])], { aliasOf: 'ro' }),
  npc('mv', 'Marcus Vance', 'Corporate', 'Petrochem', 'Dallas', [ln('+14 DAL CEN-3345', 'main', 'Based in Dallas.', ['v'])]),
  npc('hm', 'Haruka Mori', 'Corporate', 'Arasaka', 'Tokyo', [ln('+83 TKY ARA-0142', 'main', 'Works at Arasaka, so the Tokyo office.', [])]),
  npc('lr', 'Lena Ruiz', 'Ripperdoc', '', 'Watson', [ln('+14 DAL CEN-7120', 'main', 'You typed this one.', ['ra'])]),
  npc('mo', 'Mama Okoye', 'Fixer', '', 'Kabuki'),
  npc('gw', 'Ghostwire', 'Fixer', '', '', [], { aliasOf: 'mo' }),
  npc('or', 'Dr. Ortega', 'Ripperdoc', '', 'Little China'),
  npc('tv', 'Tess Valdez', 'Corporate', 'Militech', 'Night City'),
  npc('hc', 'Harlan Cole', 'Corporate', 'Militech', 'Night City'),
  npc('oz', 'Ozzie Fenn', 'Medtech', 'Trauma Team', 'Night City'),
  npc('cb', 'Cal Brandt', 'Corporate', 'Arasaka', 'Night City'),
  npc('sa', 'Sister Anne', 'Civilian', '', 'Little Europe'),
  npc('nx', 'Nix', 'Netrunner', '', ''),
  npc('pd', 'Priya Das', 'Corporate', 'Militech Security', 'Night City'),
  npc('wt', 'Wes Tanaka', 'Corporate', 'Milltech', 'Night City'),
  npc('br', 'Brick', 'Solo', 'Maelstrom', ''),
];
const PCS = () => PEOPLE.filter((p) => p.kind === 'pc');
const byId = (id) => PEOPLE.find((p) => p.id === id);
const main = (p) => (p?.aliasOf ? byId(p.aliasOf) : p);
const EMAIL_KNOWN = { ju: ['v', 'ks'], ro: ['v', 'ra', 'ks'], si: [], mv: ['v'], hm: [], lr: [], mo: ['ra'], or: ['v'] };
let RET = [
  { n: '+72 NC WAT-5150', was: 'Rache', why: 'Changed', at: '2045-03-02' },
  { n: '+72 NC WAT-1234', was: 'A burner of Veronica A.', why: 'Burned', at: '2045-02-11' },
  { n: '+72 NC WAT-7000', was: 'Deleted contact: Pike', why: 'Contact deleted', at: '2045-01-28' },
  { n: '+72 NC NHW-3000', was: 'Rogue', why: 'Burned', at: '2044-12-19' },
];
let REQUESTS = [
  { id: 'r1', pid: 'ra', type: 'change', to: '+72 NC SDO-4410', say: 'Rache wants a Santo Domingo number.' },
  { id: 'r2', pid: 'v', type: 'line', kind: 'burner', label: 'Second burner', to: '+72 NC BRN-2204', say: 'Veronica A. wants another burner. They are already past your limit of 1 extra line.' },
];
const SWITCHBOARDS = { TKYARA0042: 'Arasaka switchboard', DCMIL0100: 'Militech switchboard', ZIG0100: 'Ziggurat switchboard' };

/* Special numbers: anything the GM wants, playing by its own rules. Checked before the normal format. */
const SAMPLE_ART = ['player-hack-shard', 'gm-force-decrypt', 'player-contacts', 'gm-toggle-deadzone'].map((n) => '../../assets/icons/macros/' + n + '.svg');
const spNew = (o) => ({ id: 's' + Math.random().toString(36).slice(2, 7), num: '', name: '', img: '', seen: 'hidden', act: 'ring', text: '', macro: '', who: 'all', allow: [], show: 'name', trace: 'name', falseName: '', alert: false, ...o });
let SPECIAL = [
  spNew({ id: 's1', num: 'TRAUMA', name: 'Trauma Team', seen: 'listed' }),
  spNew({ id: 's2', num: 'NCPD', name: 'Night City Police', seen: 'listed' }),
  spNew({ id: 's3', num: 'BLACKWALL', act: 'macro', macro: 'Open the Blackwall handout', show: 'none', trace: 'dead', alert: true }),
  spNew({ id: 's4', num: '666', name: 'The Voice', img: SAMPLE_ART[0], act: 'recording', text: 'You should not have this number.', who: 'some', allow: ['ks'], trace: 'false', falseName: 'Pacifica Water Board', alert: true }),
];
const normSp = (v) => String(v || '').toUpperCase().replace(/[\s-]/g, '');
function syncSpecial() { for (const k of Object.keys(SERVICE)) delete SERVICE[k]; for (const x of SPECIAL) if (normSp(x.num)) SERVICE[normSp(x.num)] = x.name || x.num; }
const specialOf = (service) => SPECIAL.find((x) => normSp(x.num) === service);
syncSpecial();
const SP_ACT = { ring: ['Rings you', 'It rings. You answer, or it goes to voicemail with no GM online.', 'it rings'], recording: ['Plays a recording', 'A recording plays, then the line goes dead. Works with no GM online.', 'a recording plays'], voicemail: ['Voicemail', 'Straight to voicemail. You read it later.', 'it goes to voicemail'], nis: ['Not in service', 'They hear "not in service". Good with an alert: you know they tried.', '"not in service"'], dead: ['Dead air', 'It connects to silence.', 'silence'], macro: ['Runs a macro', 'Runs a macro as the person dialling. Open a door, start a trace, show a handout. It needs that player to be allowed to run it.', 'whatever the macro does'] };

/* ─── state ─── */
const S = { f: q0.get('f') || 'numbers', w: q0.get('w') === 'pop' ? 'pop' : 'panel', t: q0.get('t') || 'clean-dark', sel: q0.get('sel') || 'ro', q: '', show: 'all', group: 'kind', shut: new Set(), prop: {}, change: null, addLine: null, okFlags: new Set(), undo: null,
  bulk: null, bulkOff: new Set(), bulkAll: false, dock: null, tile: null, boardCity: '72:NC', boardQ: '', rq: '', relOpen: null, learn: 0, part: 'x', tryN: 'SEA DWN-2210', tryAs: 'v', pOpen: new Set(['72']), tbq: '', edit: null, addPlace: null, addBranch: null, plan: null, shTab: q0.get('sh') || 'share', shP: q0.get('p') || 'si', shWhat: 'number', shLine: 0, shTo: new Set(['ra']), reqDone: [], saved: false, traced: false, plView: 'none', allOpen: q0.get('all') === '1', fOpen: new Set(['rl-home', 'sp-who']), lineOpen: new Set(), bulkMove: null, reqSee: false, whoQ: '', whoShow: 'all', areaOpen: new Set(), areaShut: new Set(), spCall: null, spSel: 's3', list: '2045', custom: false, listAsk: null };

/* one question per fold; a closed head still shows the answer */
const qIsOpen = (k) => S.allOpen || S.fOpen.has(k);
const qsect = (k, ic, q, tone, answer, body) => { const open = qIsOpen(k); return `<div class="ncm-pn-sect ncm-pn-q${open ? ' is-open' : ''}"><button type="button" class="ncm-pn-band ncm-pn-qh" style="--sk:${tone}" data-do="qFold" data-k="${k}" aria-expanded="${open}" data-tooltip="${open ? 'Fold' : 'Open'} this"><i class="fas fa-chevron-down ch"></i><i class="fas ${ic}"></i> ${esc(q)}<small>${esc(answer)}</small></button>${open ? `<div class="in">${body}</div>` : ''}</div>`; };
/* ─── numbers ─── */
const keyOf2 = (n) => parse(n).key;
const allLines = () => PEOPLE.flatMap((p) => p.lines.filter((l) => !l.burned).map((l) => ({ p, l, key: keyOf2(l.n) })));
const holderOf = (key) => allLines().find((x) => x.key === key) || null;
const isRetired = (key) => RET.find((r) => keyOf2(r.n) === key) || null;
const isTaken = (key) => !!SERVICE[key] || !!holderOf(key) || !!SWITCHBOARDS[key] || !!isRetired(key) || REQUESTS.some((r) => keyOf2(r.to) === key);
const rowOfNum = (p) => ROWS.find((r) => r['Region code'] === p.rc && r['City code'] === p.city && (r.Code || '') === (p.ex || ''));
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
const when = (t) => `<span class="ncm-pn-when">${esc(t)}</span>`;
const numAt = (r, line) => (r.Code ? `+${r['Region code']} ${r['City code']} ${r.Code}-${line}` : `+${r['Region code']} ${r['City code']}-${line}`);
let seed = 4471; const rnd = (n) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
function freeLine(r, near = null, planned = []) {
  const clash = (l) => { const k = keyOf2(numAt(r, l)); return isTaken(k) || planned.includes(k); };
  if (near) { const base = Number(near); for (let d = 1; d < 40; d++) { const l = String(base + d).padStart(4, '0'); if (!clash(l)) return l; } }
  for (;;) { const l = String(1000 + rnd(8900)); if (!clash(l)) return l; }
}
const isCorp = (r) => r.Category === 'Corporate';
const homeRows = () => ROWS.filter((r) => r['Region code'] === HOME.rc && r['City code'] === HOME.city);
const homeDistricts = () => homeRows().filter((r) => r.Code && r.Category === 'District' && r['Players can pick'] === 'yes' && r.Status === 'live');
/** A name in the contact's Location field, turned into a row. Home city's districts first. */
function rowForLoc(loc) {
  if (!loc) return null; const l = loc.toLowerCase();
  const d = (r) => !isCorp(r) && r.Status === 'live';
  const home = homeRows().filter(d);
  if (l === String(homeRows()[0]?.City).toLowerCase()) return null;
  return home.find((r) => r.District?.toLowerCase().includes(l)) || ROWS.filter(d).find((r) => r.District?.toLowerCase().includes(l)) || ROWS.filter(d).find((r) => r.City.toLowerCase() === l) || null;
}
/* ─── matching an Organization to the place table ─── */
const ORG_NOISE = new Set(['the', 'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'llc', 'group', 'international', 'intl', 'security', 'division', 'global', 'holdings', 'of', 'and']);
const orgWords = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !ORG_NOISE.has(w));
const orgKey = (t) => orgWords(t).join(' ') || String(t || '').trim().toLowerCase();
const corpNames = () => uniq(ROWS.filter(isCorp).map((r) => r.District));
/** What the GM decided for an Organization that did not match: an office name, or '' for not a corporation. */
let ORG_MAP = {};
function wordDist(a, b) { if (Math.abs(a.length - b.length) > 2) return 9; let prev = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[b.length]; }
/** ok = every distinctive word of a corp is in the text. guess = its first word, or one word a typo away. Never guesses silently. */
function orgMatch(org) {
  if (!String(org || '').trim()) return { state: 'none' };
  const k = orgKey(org);
  if (k in ORG_MAP) return ORG_MAP[k] ? { state: 'ok', corp: ORG_MAP[k], remembered: true } : { state: 'notCorp' };
  const words = orgWords(org), corps = corpNames().map((c) => ({ c, w: orgWords(c) }));
  const full = corps.find((x) => x.w.length && x.w.every((y) => words.includes(y)));
  if (full) return { state: 'ok', corp: full.c };
  const part = corps.find((x) => x.w[0] && words.includes(x.w[0])) || corps.find((x) => x.w[0] && x.w[0].length > 4 && words.some((y) => wordDist(y, x.w[0]) <= 2));
  return part ? { state: 'guess', guess: part.c } : { state: 'miss' };
}
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
/** A decision changes what is proposed for everyone with that name. */
function orgChanged() { for (const p of PEOPLE) delete S.prop[p.id]; if (S.bulk) { for (const id of Object.keys(S.bulk)) S.bulk[id] = suggest(byId(id)); } if (S.walk) { const w = S.walk, p = byId(w.pid); openWalk(p, w.target); } }
function orgDecide(org, value, text) { const k = orgKey(org), was = ORG_MAP[k], had = k in ORG_MAP; ORG_MAP[k] = value; orgChanged(); S.undo = { text, fn: () => { if (had) ORG_MAP[k] = was; else delete ORG_MAP[k]; orgChanged(); } }; }
/** Give one: propose from the contact's own details, and say why. */
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
    r = pool[rnd(pool.length)]; src = m ? 'alias' : 'rand';
    why = m ? `Alias of ${m.name}: kept off their district so the numbers don't link them.` : ["guess","miss"].includes(orgMatch(p.org).state) ? `Their Organization matched no office, so a random district players can pick.` : `Nothing in their details points anywhere, so a random district players can pick.`;
  } else if (m && !force) why += ' Kept off the main identity\'s district.';
  return { n: numAt(r, freeLine(r, near, plannedKeys)), why, src, code: r.Code, rowKey: r['City code'] + '/' + (r.Code || '-') };
}
/** The full written form, each part in its colour. */
function fullHtml(n) { const m = fullForm(parse(n)).match(/^(\+\d+\s)([A-Z]{2,3}[\s-])([A-Z]{3}-)?(\d+)$/); if (!m) return esc(fullForm(parse(n))); return `<span class="ncm-pnum is-plain"><span class="r">${esc(m[1])}</span><span class="c">${esc(m[2])}</span>${m[3] ? `<span class="x">${esc(m[3])}</span>` : ''}<span class="l">${esc(m[4])}</span></span>`; }
const portrait = (o, cls = '') => (o.img ? `<span class="ncm-pn-face has-img ${cls}" style="background-image:url('${esc(o.img)}')" role="img" aria-label="${esc(o.name || 'Portrait')}"></span>` : `<span class="ncm-pn-face ${cls}" style="--tc:${hueOf(o.name || o.num || '?')}">${o.name ? esc(initials(o.name)) : '<i class="fas fa-star-of-life" aria-hidden="true"></i>'}</span>`);
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
  if (!o && p.loc && !p.org) { const lr = rowForLoc(p.loc); if (lr && (lr['City code'] !== q.city || lr['Region code'] !== q.rc)) add('l', 'info', `Their Location says ${p.loc}, but the number is from ${REGIONS[q.rc].cities[q.city].name}. Numbers stay with people, so this only matters if you didn't mean it.`, true); }
  if (r?.Status === 'dead') add('d', 'warn', `${r.District} is marked dead. Nothing there should answer.`, true);
  if (r?.Listed === 'no' && l.kind !== 'burner') add('h', 'info', `${r.District} is hidden, so players see this as an Unlisted number.`, false);
  return out;
}
function give(p, n, why, kind = null, label = '') {
  const l = ln(n, kind || (p.aliasOf ? 'alias' : 'main'), why, [], label); p.lines.push(l); return l;
}
const kindTag = { main: ['Main', 'is-plain', 'fa-sim-card', 'The number this identity gives out.'], alias: ['Alias line', 'is-secret', 'fa-mask', 'Belongs to the alias. Players who hold it never learn who is behind it.'], extra: ['Extra line', 'is-act', 'fa-layer-group', 'A second number on the same identity, with its own label.'], burner: ['Burner', 'is-attn', 'fa-fire', 'A throwaway line. Burned, it retires for good.'] };
const tagp = (t, tone, ic, tip) => `<span class="ncm-tagp ${tone}"${tip ? ` data-tooltip="${esc(tip)}"` : ''}>${ic ? `<i class="fas ${ic}"></i> ` : ''}${esc(t)}</span>`;
const hue = (t, ic, tip) => `<span class="ncm-tagp" style="--tc:${hueOf(t)}"${tip ? ` data-tooltip="${esc(tip)}"` : ''}>${ic ? `<i class="fas ${ic}"></i> ` : ''}${esc(t)}</span>`;
const face = (p, cls = '') => `<span class="ncm-pn-face ${cls}" style="--tc:${hueOf(p.name)}">${esc(initials(p.name))}</span>`;
const btn = (label, icon, tip, attrs = '', mod = '') => `<button type="button" class="ncm-ph2-btn${mod ? mod.split(' ').map((m) => ' ncm-ph2-btn--' + m).join('') : ''}" data-tooltip="${esc(tip)}"${label ? '' : ` aria-label="${esc(tip)}"`} ${attrs}>${icon ? `<i class="fas ${icon}"></i>` : ''}${label ? ' ' + esc(label) : ''}</button>`;
const opt = (v, t, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(t)}</option>`;
const inner = (tabs) => `<div class="ncm-pn-inner" role="tablist">${tabs.map(([f, l, ic, tip, n, hot]) => `<button type="button" role="tab" aria-selected="${S.f === f}" class="${S.f === f ? 'on' : ''}" data-do="frame" data-f="${f}" data-tooltip="${esc(tip)}"><i class="fas ${ic}"></i> ${esc(l)}${n ? `<span class="ncm-pn-count${hot ? ' hot' : ''}">${n}</span>` : ''}</button>`).join('')}</div>`;
const needList = () => PEOPLE.filter((p) => !p.lines.length);
const numbersTabs = () => inner([
  ['numbers', 'People', 'fa-users', 'Every identity and every line they hold'],
  ['board', 'Districts', 'fa-table-cells', 'Who is on which district, and who has no number yet'],
  ['requests', 'Requests', 'fa-inbox', 'What players have asked you to approve', REQUESTS.length, REQUESTS.length > 0],
  ['retired', 'Retired', 'fa-box-archive', 'Numbers that are gone and are never handed out again', RET.length],
]);
const setupTabs = () => inner([
  ['learn', 'How it works', 'fa-graduation-cap', 'The number system in five short steps, and a box to try any number'],
  ['rules', 'Rules', 'fa-sliders', 'Home city, what players can pick, approvals, line limits'],
  ['places', 'Places', 'fa-table', 'The table every number comes from. Edit it here or in a spreadsheet'],
  ['special', 'Special numbers', 'fa-star-of-life', 'Numbers that play by their own rules: hidden lines, hotlines, anything', SPECIAL.length],
]);
const undoLine = () => (S.undo ? `<div class="ncm-pn-undo"><i class="fas fa-check"></i><span class="grow">${esc(S.undo.text)}</span>${btn('Undo', 'fa-rotate-left', 'Take it back. The numbers go back in the pool, nothing retires', 'data-do="undo"')}<button type="button" data-do="undoClose" aria-label="Dismiss" data-tooltip="Dismiss"><i class="fas fa-xmark"></i></button></div>` : '');

/* ─── Numbers → People ─── */
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
  return `<button type="button" class="ncm-pn-prow${S.sel === p.id ? ' on' : ''}${l.length ? '' : ' is-none'}" data-do="sel" data-id="${p.id}" data-tooltip="Open ${esc(p.name)}">${face(p)}<span class="bd"><span class="nm">${esc(p.name)}${p.aliasOf ? tagp('alias', 'is-secret') : ''}${warn ? '<i class="fas fa-triangle-exclamation ncm-pn-warnmark" aria-label="Something to check"></i>' : ''}</span>
    <span class="ln">${l[0] ? pcolor(l[0].n) : tagp('no number', 'is-attn', 'fa-user-plus')}${l.length > 1 ? `<span class="ncm-pn-more" data-tooltip="${l.length - 1} more line${l.length === 2 ? '' : 's'}">+${l.length - 1}</span>` : ''}${off ? tagp('off', 'is-attn', 'fa-power-off') : ''}</span>
    <span class="mt">${p.kind === 'pc' ? `<span class="ncm-pn-who">${esc(p.player)}</span>` : ''}${hv(p.role)}${hv(p.org, 'fa-building')}${p.org ? '' : hv(p.loc, 'fa-location-dot')}</span></span></button>`;
}
const lineIsOpen = (p, i) => S.allOpen || S.lineOpen.has(p.id + i) !== (i === 0);
function lineCard(p, l, i) {
  const q = parse(l.n), r = rowOfNum(q), [kt, kc, ki, kh] = kindTag[l.kind];
  const flags = flagsOf(p, l);
  if (S.change && S.change.pid === p.id && S.change.i === i) return changeForm(p, l, i);
  const place = placeOf(q);
  return `<div class="ncm-pn-line is-${l.kind}${l.off ? ' is-off' : ''}">
    <div class="ncm-pn-lhead"><button type="button" class="ncm-pn-lfold" data-do="lineFold" data-k="${esc(p.id + i)}" aria-expanded="${lineIsOpen(p, i)}" aria-label="Details for this line" data-tooltip="${lineIsOpen(p, i) ? 'Fold' : 'Open'} this line's details"><i class="fas fa-chevron-down ch${lineIsOpen(p, i) ? '' : ' shut'}"></i></button>${pnum(l.n)}${tagp(kt, kc, ki, kh)}${l.label ? hue(l.label, null, 'The label on this line') : ''}${l.off ? tagp('Switched off', 'is-attn', 'fa-power-off', 'Callers hear not in service. Switch it back on any time') : ''}<span class="grow"></span>${btn('', 'fa-phone', 'Call a player as ' + p.name + ' on this line', 'data-do="toast" data-msg="Opens the GM call screen on this line"', 'ic go')}${btn('', 'fa-voicemail', 'Greeting and voicemail for this line', 'data-do="toast" data-msg="Opens this line\'s greeting (already built)"', 'ic')}</div>
    ${lineIsOpen(p, i) ? '' : (flags.some((f) => f.tone === 'warn') ? '<div class="ncm-pn-lnote"><i class="fas fa-triangle-exclamation"></i> Something to check</div>' : '')}<div class="ncm-pn-lbody"${lineIsOpen(p, i) ? '' : ' hidden'}><div class="ncm-pn-kv">
      <span class="k" data-tooltip="Where it was issued. A number never says where someone is now."><i class="fas fa-location-dot"></i> Issued in</span><span class="ncm-pn-val" style="--tc:${hueOf(place)}">${esc(place)}${r?.Listed === 'no' ? ' ' + tagp('hidden', 'is-secret', 'fa-eye-slash', 'Out of the directory. Players see Unlisted number') : ''}</span>
      <span class="k" data-tooltip="The whole number, the way someone far away would dial it"><i class="fas fa-hashtag"></i> Written as</span><span>${fullHtml(l.n)}</span>
      <span class="k" data-tooltip="Characters who have this number saved"><i class="fas fa-user-group"></i> Who has it</span><span class="ncm-pn-holders">${l.holders.length ? l.holders.map((h) => hue(byId(h).name)).join('') : '<small>Nobody yet</small>'}</span>
      <span class="k" data-tooltip="Why this number was chosen. It stays with the line so you remember later."><i class="fas fa-lightbulb"></i> Why</span><span class="ncm-pn-note">${esc(l.why)}</span>
    </div>
    ${flags.map((f) => `<div class="ncm-pn-check ${f.tone === 'info' ? 'info' : ''}"><i class="fas ${f.tone === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation'}"></i><span class="grow">${esc(f.text)}</span>${f.fix ? btn('Looks right', '', 'Stop flagging this', `data-do="okFlag" data-k="${esc(f.k)}"`) : ''}</div>`).join('')}
    <div class="ncm-pn-acts">
      ${btn('Change', 'fa-pen', 'Give this line a new number. The old one retires', `data-do="change" data-id="${p.id}" data-i="${i}"`)}
      ${btn('Share', 'fa-share-nodes', 'Choose who gets this number', `data-do="shareFrom" data-id="${p.id}" data-i="${i}"`)}
      ${btn(l.off ? 'Switch on' : 'Switch off', 'fa-power-off', l.off ? 'Back in service, same number' : 'A lost phone or an unpaid bill. Callers hear not in service until you switch it back on', `data-do="lineOff" data-id="${p.id}" data-i="${i}"`)}
      ${l.kind === 'burner' ? btn('Burn', 'fa-fire', 'Retire this burner for good', `data-do="retireLine" data-id="${p.id}" data-i="${i}"`, 'bad') : l.kind === 'extra' ? btn('Retire', 'fa-box-archive', 'Retire this line for good', `data-do="retireLine" data-id="${p.id}" data-i="${i}"`, 'bad') : ''}
    </div></div>
  </div>`;
}
/* ─── Walk through it: the same five steps players get in Get a number. One component in the build, with a GM mode. ─── */
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
  const trail = `<nav class="ncm-wk-trail" aria-label="Where this number comes from">${WK.map((x, n) => { const here = w.level === x.key, r0 = wkRows(w.path, n + 1)[0], val = r0 ? (x.name(r0) || x.blank || '—') : '—'; return `<button type="button" class="${here ? 'on' : ''}" data-do="wkLevel" data-k="${x.key}" data-tooltip="Change the ${x.label.toLowerCase()}"><small>${x.label}</small>${esc(here ? 'Choosing…' : val)}</button>`; }).join('')}</nav>`;
  let body;
  if (step) {
    const seen = new Map(); for (const r of wkRows(w.path, i)) { const v = r[step.col] || ''; if (!seen.has(v)) seen.set(v, r); }
    const q = (w.q || '').trim().toLowerCase();
    const hit = wkShortcuts(p).map((c) => c.r);
    const opts = [...seen.entries()].map(([v, r]) => ({ v, r, name: step.name(r) || step.blank || v, rec: hit.some((h) => (h[step.col] || '') === v && WK.slice(0, i).every((y) => (h[y.col] || '') === w.path[y.key])) })).filter((o) => !q || (o.name + ' ' + o.v).toLowerCase().includes(q)).sort((a, b) => Number(b.rec) - Number(a.rec));
    body = `<div class="ncm-wk-q"><b>Step ${i + 1} of 5.</b> ${esc(step.ask)}<span class="grow"></span>${i ? btn('Back', 'fa-arrow-left', 'Go back one step', `data-do="wkLevel" data-k="${WK[i - 1].key}"`) : ''}</div>${seen.size > 8 ? `<label class="ncm-pn-srch" data-tooltip="Search this step"><i class="fas fa-magnifying-glass"></i><input type="text" id="wk-q" data-in="wkQ" value="${esc(w.q || '')}" placeholder="Search" aria-label="Search this step"></label>` : ''}<div class="ncm-wk-opts${step.key === 'code' ? ' is-rows' : ''}" data-sc="wko">${opts.map((o) => `<button type="button" class="${o.rec ? 'is-rec' : ''}" data-do="wkPick" data-v="${esc(o.v)}" data-tooltip="${o.rec ? 'Fits their details' : esc(step.ask)}">${o.rec ? '<i class="fas fa-star" aria-hidden="true"></i>' : ''}<span class="grow">${esc(o.name)}</span>${step.key === 'rc' ? `<small>+${esc(o.v)}</small>` : step.key === 'city' || (step.key === 'code' && o.v) ? `<small>${esc(o.v)}</small>` : ''}${step.key === 'code' ? wkTag(o.r) : ''}</button>`).join('') || '<small>Nothing matches.</small>'}</div>`;
  } else if (row) {
    const typed = /^\d{4}$/.test(w.own || ''), line = typed ? w.own : w.line, n = numAt(row, line), q = parse(n), clash = typed && isTaken(q.key);
    const office = p.org && officeRow(p.org, p.loc || homeRows()[0]?.City);
    const off = office && (office.Code !== row.Code || office['City code'] !== row['City code']);
    const m = p.aliasOf ? byId(p.aliasOf) : null, sameAsMain = m?.lines[0] && parse(m.lines[0].n).ex === row.Code && row.Code;
    const seenName = isCorp(row) ? p.name + ', ' + (p.org || row.District) : row.Listed === 'no' ? 'Unlisted number' : 'The number, unless they have this contact saved';
    body = `<div class="ncm-wk-q"><b>Pick a number from ${esc(row.District || row.City)}.</b><span class="grow"></span>${btn('Try others', 'fa-dice', 'Four more free lines from here', 'data-do="wkRoll"')}</div>
      <div class="ncm-wk-nums">${w.sugg.map((x) => `<button type="button" class="${!typed && x.line === w.line ? 'on' : ''}" data-do="wkLine" data-v="${x.line}" data-tooltip="Pick ${esc(seenFrom(parse(numAt(row, x.line))))}${x.note ? '. ' + esc(x.note) : ''}">${pnum(numAt(row, x.line))}${x.note ? `<small>${esc(x.note)}</small>` : ''}</button>`).join('')}</div>
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
    ${cuts.length ? `<div class="ncm-wk-cuts"><small>From their details</small>${cuts.map((c) => `<button type="button" class="${rowKey2(c.r) === (row && rowKey2(row)) ? 'on' : ''}" data-do="wkJump" data-key="${esc(rowKey2(c.r))}" data-tooltip="${esc(c.tip)}"><i class="fas ${c.ic}"></i> ${esc(c.text)}</button>`).join('')}</div>` : ''}
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
  if (!a || a.pid !== p.id) return p.kind === 'pc' || p.lines.length ? `<div class="ncm-pn-acts">${btn('Add a line', 'fa-plus', 'Give this identity another number: an extra line or a burner', `data-do="addLine" data-id="${p.id}"`)}</div>` : '';
  return `<div class="ncm-pn-form"><h4><i class="fas fa-plus"></i> Add a line</h4>
    <div class="ncm-pn-fr"><div class="ncm-pn-seg" role="group" aria-label="Kind of line"><button type="button" class="${a.kind === 'extra' ? 'on' : ''}" data-do="addKind" data-k="extra" data-tooltip="A second number with its own label, like an old number they kept">Extra line</button><button type="button" class="${a.kind === 'burner' ? 'on' : ''}" data-do="addKind" data-k="burner" data-tooltip="A throwaway. Burned, it retires for good">Burner</button></div>
    <label class="ncm-pn-f" data-tooltip="A name only the holder sees on their line list">Label<input type="text" id="add-label" data-in="addLabel" value="${esc(a.label)}" placeholder="Work line"></label></div>
    <div class="ncm-pn-line__top">${pnum(a.n)}<span class="grow"></span>${btn('Walk through it', 'fa-route', 'The same steps your players use', `data-do="walk" data-id="${p.id}" data-target="add"`)}${btn('Try another', 'fa-dice', 'Another free line', 'data-do="addReroll"')}</div>
    <div class="ncm-pn-acts">${btn('Add it', 'fa-check', 'Add this line', 'data-do="addGo"', 'pri')}${btn('Cancel', '', 'Add nothing', 'data-do="addCancel"')}</div></div>`;
}
function detail(p) {
  if (!p) return '<div class="ncm-ph2-none">Pick someone on the left.</div>';
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
    <div class="ncm-pn-split"><div class="ncm-pn-list" data-sc="plist">${groupsOf(rows).map(([g, list]) => { const shut = S.shut.has(g); return `<button type="button" class="ncm-pn-gh${shut ? ' is-shut' : ''}" style="--sk:${g === 'Players' ? 'var(--ncm-act)' : g === 'NPCs' ? 'var(--ncm-hue-5)' : g === 'No number' || g === 'No organization' ? 'var(--ncm-attn)' : hueOf(g)}" data-do="fold" data-k="${esc(g)}" aria-expanded="${!shut}" data-tooltip="${shut ? 'Open' : 'Fold'} this group"><i class="fas fa-chevron-down ch"></i><i class="fas ${g === 'Players' ? 'fa-user' : g === 'NPCs' ? 'fa-masks-theater' : S.group === 'org' ? 'fa-building' : S.group === 'district' ? 'fa-location-dot' : 'fa-users'} gi"></i>${esc(g)}<span class="grow"></span><span class="ncm-pn-count">${list.length}</span></button>${shut ? '' : list.map(peopleRow).join('')}`; }).join('') || '<div class="ncm-ph2-none">Nobody matches.</div>'}</div>
      <div class="ncm-pn-detail" data-sc="pdetail">${detail(byId(S.sel))}</div></div>`;
}

/* ─── bulk review ─── */
function bulkPlan() {
  if (S.bulk) return S.bulk;
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
    <div class="ncm-pn-bulk" data-sc="bulk">${ids.map((id) => { const p = byId(id), pr = plan[id], off = S.bulkOff.has(id); const q = parse(pr.n); const opts = homeRows().filter((r) => r.Code && (!isCorp(r) || r.District.toLowerCase().startsWith((p.org || '~').toLowerCase()))); return `<div class="ncm-pn-brow${off ? ' off' : ''}"><label data-tooltip="Untick to leave them without a number for now"><input type="checkbox" id="bk-${id}" data-ch="bulkTick" data-id="${id}" aria-label="Give ${esc(p.name)} this number"${off ? '' : ' checked'}></label>${face(p)}<div class="who"><b>${esc(p.name)}</b><span class="mt">${p.aliasOf ? tagp('Alias of ' + byId(p.aliasOf).name, 'is-secret', 'fa-mask') : ''}${hv(p.role)}${hv(p.org, 'fa-building')}${hv(p.loc, 'fa-location-dot')}</span></div><div class="num"><span class="top">${pnum(pr.n)}${srcChip(pr)}</span><small class="ncm-pn-note">${esc(pr.why)}</small>${['guess', 'miss'].includes(orgMatch(p.org).state) ? `<small class="ncm-wk-orgmiss"><i class="fas fa-triangle-exclamation"></i> Organization says ${esc(p.org)}, and no office matches.${orgMatch(p.org).guess ? ' Did you mean ' + esc(orgMatch(p.org).guess) + '?' : ''} Use the walkthrough to fix it.</small>` : ''}</div><div class="bt">${btn('', 'fa-route', 'Walk through it: the same steps your players use', `data-do="walk" data-id="${id}" data-target="bulk"`, 'ic')}${btn('', 'fa-location-dot', 'Quick move to another district here', `data-do="bulkMove" data-id="${id}" aria-expanded="${S.bulkMove === id}"`, 'ic')}${btn('', 'fa-dice', 'Another free line in the same place', `data-do="bulkOne" data-id="${id}"`, 'ic')}</div>${S.allOpen || S.bulkMove === id ? `<div class="mv"><select id="bd-${id}" data-ch="bulkDist" data-id="${id}" aria-label="District for ${esc(p.name)}" data-tooltip="Put them somewhere else">${opts.map((r) => opt(r['City code'] + '/' + r.Code, r.Code + ' ' + r.District, q.ex === r.Code && q.city === r['City code'])).join('')}${opts.some((r) => r.Code === q.ex && q.city === r['City code']) ? '' : opt('', (q.ex || q.city) + ' (elsewhere)', true)}</select></div>` : ''}</div>`; }).join('') || '<div class="ncm-ph2-none">Everyone on this list has a number.</div>'}</div>`;
}

/* ─── the district board ─── */
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
      ${areas.map((a, ai) => { const inArea = rows.filter((r) => (r.Area || (isCorp(r) ? 'Offices' : 'The city')) === a); const inUse = inArea.flatMap((r) => peopleOn(rc, city, r.Code)); const k = S.boardCity + '|' + a; const shut = !forced && (S.areaShut.has(k) || (!S.areaOpen.has(k) && ai !== 0)); return `<div class="ncm-pn-area${shut ? ' is-shut' : ''}" style="--tc:${hueOf(a)}"><button type="button" class="ncm-pn-areah" data-do="areaFold" data-k="${esc(k)}" aria-expanded="${!shut}" data-tooltip="${forced ? 'Open while you search or place someone' : 'Fold or open ' + esc(a)}"${forced ? ' data-forced="1"' : ''}><i class="fas fa-chevron-down ch"></i><i class="fas fa-map-pin"></i> ${esc(a)}<span class="grow"></span><span class="sumf">${inUse.slice(0, 5).map(({ p }) => face(p)).join('')}</span><span class="ncm-pn-more">${inArea.length}</span><small>${inArea.length === 1 ? 'place' : 'places'} · ${inUse.length} in use</small></button><div class="ncm-pn-area__b"${shut ? ' inert' : ''}><div class="in"><div class="ncm-pn-tiles">${rows.filter((r) => (r.Area || (isCorp(r) ? 'Offices' : 'The city')) === a).map((r) => { const on = peopleOn(rc, city, r.Code); const hit = q && on.some(({ p, l }) => p.name.toLowerCase().includes(q) || l.n.toLowerCase().replace(/[\s-]/g, '').includes(q.replace(/[\s-]/g, ''))); const lab = r.Code || r['City code']; return `<button type="button" class="ncm-pn-tile${(r.Code || '-') === S.tile || hit ? ' on' : ''}${armed ? ' is-target' : ''}${r.Status === 'dead' ? ' is-dead' : ''}${on.length ? ' has-people' : ''}" data-do="tile" data-k="${esc(r.Code || '-')}" data-tooltip="${esc((r.District || r.City) + '. ' + (r.Status === 'dead' ? 'Marked dead. ' : '') + (r['Players can pick'] === 'yes' ? 'Players can pick it. ' : 'GM only. ') + (r.Listed === 'no' ? 'Hidden from the directory. ' : '') + on.length + ' of 10,000 lines in use.')}"><span class="code">${esc(lab)}${r['Players can pick'] === 'no' ? '<i class="fas fa-lock is-gm" aria-label="GM only"></i>' : ''}${r.Listed === 'no' ? '<i class="fas fa-eye-slash is-gm" aria-label="Hidden"></i>' : ''}${r.Status === 'dead' ? '<i class="fas fa-skull is-dead" aria-label="Dead"></i>' : ''}</span><span class="name">${esc(r.District || r.City)}</span><span class="faces">${on.slice(0, 4).map(({ p }) => face(p)).join('')}${on.length > 4 ? `<small>+${on.length - 4}</small>` : ''}${on.length ? `<span class="ncm-pn-more" style="margin-left:auto">${on.length}</span>` : '<small class="ncm-pn-empty">empty</small>'}</span></button>`; }).join('')}</div></div></div></div>`; }).join('')}
    </div>
    <div class="ncm-pn-dock"><div class="ncm-pn-mh" data-tooltip="Identities without a number. Pick one, then click a district"><i class="fas fa-user-plus"></i> No number <span class="ncm-pn-count${need.length ? ' hot' : ''}">${need.length}</span></div><div class="ncm-pn-dock__l" data-sc="dock">${need.map((p) => `<button type="button" class="ncm-pn-dockp${S.dock === p.id ? ' on' : ''}" data-do="dock" data-id="${p.id}" data-tooltip="Place ${esc(p.name)}: pick a district next">${face(p)}<span style="min-width:0">${esc(p.name)}<span class="mt">${p.aliasOf ? tagp('alias', 'is-secret') : hv(p.org || p.role)}</span></span></button>`).join('') || '<div class="ncm-ph2-none">Everyone has one.</div>'}</div></div></div>`;
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

/* ─── requests + retired ─── */
function viewRequests() {
  return `<header class="ncm-tabhd"><i class="fas fa-inbox"></i><div><h2>Requests</h2><p>What players asked for. Nothing changes until you answer.</p></div></header>${numbersTabs()}${undoLine()}
    <div class="ncm-pn-scroll" data-sc="req"><section class="ncm-pn-mod">${REQUESTS.map((r) => { const p = byId(r.pid); const old = p.lines[0]; return `<div class="ncm-pn-row">${face(p)}<div class="tx"><div class="ncm-pn-rqh"><b>${esc(p.name)}</b>${r.type === 'change' ? tagp('Number change', 'is-attn', 'fa-pen') : tagp('Over their line limit', 'is-attn', 'fa-layer-group')}</div><div>${esc(r.say)}</div><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px">${r.type === 'change' ? `<span class="ncm-pn-oldnum">${esc(seenFrom(parse(old?.n)))}</span><i class="fas fa-arrow-right" style="font-size:10px;color:var(--ncm-act)"></i>` : tagp(kindTag[r.kind][0], kindTag[r.kind][1], kindTag[r.kind][2])}${pnum(r.to)}</div>${r.type === 'change' && old?.holders.length ? `<small class="ncm-pn-conseq"><i class="fas fa-triangle-exclamation"></i> ${old.holders.length} ${old.holders.length === 1 ? 'person has' : 'people have'} the old number saved. It retires if you approve.</small>` : ''}</div>${btn('Approve', 'fa-check', r.type === 'change' ? 'Change it now. The old number retires' : 'Add this line', `data-do="reqYes" data-id="${r.id}"`, 'go')}${btn('Decline', 'fa-xmark', 'They keep what they have, and are told', `data-do="reqNo" data-id="${r.id}"`)}</div>`; }).join('') || '<div class="ncm-ph2-none">Nothing is waiting.</div>'}</section>
      <section class="ncm-pn-mod"><button type="button" class="ncm-pn-band ncm-pn-qh" data-do="reqSee" aria-expanded="${S.reqSee || S.allOpen}" data-tooltip="What they read while they wait"><i class="fas fa-chevron-down ch${S.reqSee || S.allOpen ? '' : ' shut'}"></i><i class="fas fa-eye"></i> What the player sees meanwhile</button><div class="ncm-pn-mb"${S.reqSee || S.allOpen ? '' : ' hidden'}><div class="ncm-pn-ppl"><div class="ncm-pn-ph" style="--sk:var(--ncm-good)"><h5><i class="fas fa-circle"></i> You're online</h5><div>Waiting for your GM to approve <b>SDO-4410</b>. You keep your number until then.</div></div><div class="ncm-pn-ph" style="--sk:var(--ncm-attn)"><h5><i class="fas fa-moon"></i> No GM online</h5><div>Saved for your GM. They'll see it next time they're on.</div></div></div></div></section></div>`;
}
function viewRetired() {
  const q = S.rq.trim().toLowerCase();
  const list = RET.filter((r) => !q || (r.n + r.was + r.why).toLowerCase().includes(q));
  return `<header class="ncm-tabhd"><i class="fas fa-box-archive"></i><div><h2>Retired</h2><p>Changed, burned or deleted numbers. The generator never hands these out, and no import can bring one back.</p></div></header>${numbersTabs()}${undoLine()}
    <div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Search numbers, who had them, and why they retired"><i class="fas fa-magnifying-glass"></i><input type="text" id="r-q" data-in="rq" value="${esc(S.rq)}" placeholder="Number or name" aria-label="Search retired numbers"></label>${btn('Export', 'fa-file-export', 'Download the retired list as a CSV', 'data-do="csvRetired"')}</div>
    <div class="ncm-pn-scroll" data-sc="ret"><section class="ncm-pn-mod">${list.map((r) => `<div class="ncm-pn-row">${pnum(r.n)}<div class="tx ncm-pn-retx"><b>${esc(r.was)}</b>${tagp(r.why, r.why === 'Burned' ? 'is-bad' : 'is-plain', r.why === 'Burned' ? 'fa-fire' : r.why === 'Contact deleted' ? 'fa-user-slash' : 'fa-pen')}${when(r.at)}</div>${S.relOpen === r.n ? `<div style="flex-basis:100%" class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span class="grow">Anyone who still has this saved would reach whoever gets it next.</span>${btn('Release it', 'fa-unlock', 'The generator can hand it out again', `data-do="relGo" data-n="${esc(r.n)}"`, 'bad')}${btn('Keep it retired', '', 'Leave it retired', 'data-do="relCancel"')}</div>` : btn('Release', 'fa-unlock', 'Let this number be handed out again', `data-do="relAsk" data-n="${esc(r.n)}"`)}</div>`).join('') || '<div class="ncm-ph2-none">No retired numbers match.</div>'}</section></div>`;
}

/* ─── how it works ─── */
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
  if (i === 0) return `<div class="ncm-pn-anat">${Object.entries(PARTS).map(([k, [t, l, , c]]) => `<button type="button" class="ncm-pn-part${S.part === k ? ' on' : ''}" data-do="part" data-k="${k}" data-tooltip="${esc(l)}"><code class="ncm-pnum" style="border:0;cursor:inherit"><span class="${c}">${esc(t)}</span></code><small>${esc(l)}</small></button>`).join('')}</div><p style="margin:0;text-align:center;font:14px var(--ncm-font-body);color:var(--ncm-text-primary)">${esc(PARTS[S.part][2])}</p>`;
  if (i === 1) return `<div class="ncm-pn-ppl">${[['Calling from Night City', 'WAT-4471'], ['Calling from Seattle (same region)', 'NC WAT-4471'], ['Calling from Dallas (another region)', '+72 NC WAT-4471']].map(([t, n]) => `<div class="ncm-pn-ph"><h5>${esc(t)}</h5><span class="ncm-pnum is-plain" style="font-size:17px">${n.replace(/^(\+\d+ )?(NC )?(WAT-)(\d+)$/, (_, a, b, c, d) => `${a ? `<span class="r">${a}</span>` : ''}${b ? `<span class="c">${b}</span>` : ''}<span class="x">${c}</span><span class="l">${d}</span>`)}</span></div>`).join('')}</div><p style="margin:0;font:13px var(--ncm-font-body);color:var(--ncm-text-primary)">"From" means where the caller's own number was issued. Someone who keeps a D.C. number in Night City still dials like someone in D.C. Numbers never say where a person is now.</p>`;
  if (i === 2) { const r = ROWS.find((x) => x.Code === 'WAT'); return `<div class="ncm-pn-tw" style="min-height:0;flex:none"><table><thead><tr>${['Region code', 'Region', 'City code', 'City', 'Area', 'Code', 'District'].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody><tr>${['Region code', 'Region', 'City code', 'City', 'Area', 'Code', 'District'].map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr></tbody></table></div><p style="margin:0;font:13px var(--ncm-font-body);color:var(--ncm-text-primary)">That row gives ${pnum('+72 NC WAT-4471')}. A city with no districts in the table dials as ${pnum('+90 PAL-0316')}. Export the table, edit it in a spreadsheet, and bring it back; you see every change before it applies.</p><div class="ncm-pn-acts">${btn('Open Places', 'fa-table', 'Go to the table', 'data-do="frame" data-f="places"')}</div>`; }
  if (i === 3) return `<ul style="margin:0;padding-left:18px;font:13px/1.5 var(--ncm-font-body);color:var(--ncm-text-primary)"><li>${esc(sentence('home'))}</li><li>${esc(sentence('scope'))}</li><li>${esc(sentence('own'))}</li><li>${esc(sentence('appr'))}</li><li>${esc(sentence('extra'))}</li><li>Special numbers break every rule above on purpose: hidden lines, hotlines, anything you want.</li></ul><div class="ncm-pn-acts">${btn('Open Rules', 'fa-sliders', 'Go to the rules', 'data-do="frame" data-f="rules"')}</div>`;
  return `<div class="ncm-pn-ppl"><div class="ncm-pn-ph" style="--sk:var(--ncm-hue-3)"><h5><i class="fas fa-user"></i> One person</h5><div>In People, or on a contact's form. It proposes a number from their details and says why.</div>${btn('Open People', 'fa-users', 'Go to People', 'data-do="frame" data-f="numbers"')}</div><div class="ncm-pn-ph" style="--sk:var(--ncm-attn)"><h5><i class="fas fa-users"></i> Everyone without one</h5><div>A list you review, with one click to undo after.</div>${btn('Give numbers', 'fa-wand-magic-sparkles', 'Go to the review list', 'data-do="frame" data-f="bulk"')}</div><div class="ncm-pn-ph" style="--sk:var(--ncm-hue-5)"><h5><i class="fas fa-table-cells"></i> By hand, on the board</h5><div>Pick a person, click a district. See who is where.</div>${btn('Open Districts', 'fa-table-cells', 'Go to the board', 'data-do="frame" data-f="board"')}</div></div>`;
}
/** What a number tells the GM, and what it tells a chosen character. The same one rule the player's dial box uses. */
function tryResult() {
  const p = parse(S.tryN);
  if (p.empty) return { gm: '<small>Type a number above.</small>', pl: '<small>Type a number above.</small>' };
  if (p.service) {
    const x = specialOf(p.service), as = byId(S.tryAs), lets = x.who === 'all' || x.allow.includes(as.id);
    return { gm: [`<b>${esc(x.num)}</b>: a special number${x.name ? ', ' + esc(x.name) : ''}.`, esc(SP_ACT[x.act][1]), x.seen === 'hidden' ? 'Hidden: nothing hints at it until the whole number is typed.' : 'Listed in the directory.', x.who === 'all' ? 'Anyone gets through.' : 'Gets through: ' + esc(x.allow.map((a) => byId(a).name).join(', ') || 'nobody') + '.', x.alert ? 'You get an alert when it is dialled.' : ''].filter(Boolean).join('<br>'),
      pl: lets ? [`<b>${esc(x.num)}</b>`, x.show === 'name' && x.name ? esc(x.name) : 'No name on screen.', 'Calling it: ' + esc(SP_ACT[x.act][2]) + '.'].join('<br>') : `<b>${esc(x.num)}</b><br>No name.<br>Calling it: "not in service".` };
  }
  if (p.partial || !p.done) { const h = esc(p.hint || `${placeOf(p)}. ${4 - (p.line || '').length} more digits.`); return { gm: h, pl: h }; }
  const h = holderOf(p.key), ret = isRetired(p.key), sw = SWITCHBOARDS[p.key], r = rowOfNum(p);
  const as = byId(S.tryAs);
  const inContacts = h && (h.l.holders.includes(as.id) || h.p.id === as.id);
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
function tryPanes() { const t = tryResult(); return `<div class="ncm-pn-view" style="--sk:var(--ncm-attn)"><h5><i class="fas fa-crown"></i> What you see</h5><div>${t.gm}</div></div><div class="ncm-pn-view" style="--sk:var(--ncm-act)"><h5><i class="fas fa-user"></i> What ${esc(byId(S.tryAs).name)} sees</h5><div>${t.pl}</div></div>`; }
function viewLearn() {
  return `<header class="ncm-tabhd"><i class="fas fa-graduation-cap"></i><div><h2>How numbers work</h2><p>A made-up system for this game, explained in a minute.</p></div></header>${setupTabs()}
    <div class="ncm-pn-scroll" data-sc="learn"><section class="ncm-pn-mod" style="--sk:var(--ncm-hue-3)"><div class="ncm-pn-mh"><i class="fas fa-shoe-prints"></i> ${S.learn + 1}. ${esc(LEARN[S.learn][0])}<span class="grow"></span><small>Step ${S.learn + 1} of ${LEARN.length}</small></div><div class="ncm-pn-mb"><p style="margin:0;font:13px var(--ncm-font-body);color:var(--ncm-text-label)">${esc(LEARN[S.learn][1])}</p>${learnStep()}<div class="ncm-pn-steps">${LEARN.map((l, i) => `<button type="button" class="${i <= S.learn ? 'on' : ''}" data-do="learnGo" data-i="${i}" aria-label="Step ${i + 1}: ${esc(l[0])}" data-tooltip="${esc(l[0])}"></button>`).join('')}</div><div class="ncm-pn-acts" style="justify-content:space-between">${btn('Back', 'fa-arrow-left', 'The step before', `data-do="learnGo" data-i="${Math.max(0, S.learn - 1)}" ${S.learn ? '' : 'disabled'}`)}${btn(S.learn === LEARN.length - 1 ? 'Done' : 'Next', 'fa-arrow-right', 'The next step', `data-do="learnGo" data-i="${(S.learn + 1) % LEARN.length}"`, 'pri')}</div></div></section>
    <section class="ncm-pn-mod" style="--sk:var(--ncm-hue-5)"><div class="ncm-pn-mh"><i class="fas fa-vial"></i> Try a number <small>What it means to you, and to a player</small></div><div class="ncm-pn-mb"><div class="ncm-pn-fr"><label class="ncm-pn-f grow" data-tooltip="Any number. Try WAT-2208, WAT-5150, +83 TKY ARA-0042, NCM-1000, TRAUMA">Number<input type="text" id="try-n" data-in="tryN" value="${esc(S.tryN)}" autocomplete="off" spellcheck="false"></label><label class="ncm-pn-f" data-tooltip="Whose eyes to see it through. A name only shows if it's in that character's contacts">As<select id="try-as" data-ch="tryAs">${PCS().map((p) => opt(p.id, p.name, S.tryAs === p.id)).join('')}</select></label></div><div class="ncm-pn-try" id="try-out">${tryPanes()}</div></div></section></div>`;
}

/* ─── rules ─── */
function sentence(k) {
  const home = REGIONS[HOME.rc].cities[HOME.city].name, region = REGIONS[HOME.rc].name;
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
const rule = (title, tip, ctl, k) => `<div class="ncm-pn-rule"><b data-tooltip="${esc(tip)}">${esc(title)}</b>${ctl}<div class="now"><i class="fas fa-user"></i><span>${esc(sentence(k))}</span></div></div>`;
const seg = (name, cur, opts) => `<div class="ncm-pn-seg" role="group">${opts.map(([v, t, h]) => `<button type="button" class="${String(cur) === String(v) ? 'on' : ''}" data-do="${name}" data-v="${esc(v)}" data-tooltip="${esc(h)}">${esc(t)}</button>`).join('')}</div>`;
function viewRules() {
  const cities = uniq(ROWS.map((r) => r['Region code'] + ':' + r['City code']));
  const homeName = REGIONS[HOME.rc].cities[HOME.city].name;
  const listWord = S.custom ? 'Custom' : S.list === 'blank' ? 'Blank' : 'Night City ' + S.list;
  return `<header class="ncm-tabhd"><i class="fas fa-sliders"></i><div><h2>Rules</h2><p>Six questions. The defaults work without touching any of them.</p></div></header>${setupTabs()}${undoLine()}
    <div class="ncm-pn-scroll" data-sc="rules">
    ${qsect('rl-home', 'fa-location-dot', 'Where is this campaign set?', 'var(--ncm-hue-3)', homeName + ' · ' + listWord + ' list', rule('Campaign home', 'Any city in the table. A Texas or overseas campaign works the same way', `<select id="r-home" data-ch="home" aria-label="Campaign home" data-tooltip="Pick the city this campaign is set in">${cities.map((c) => { const [a, b] = c.split(':'); const r = ROWS.find((x) => x['Region code'] === a && x['City code'] === b); return opt(c, r.City + ', ' + r.Region, a === HOME.rc && b === HOME.city); }).join('')}</select>`, 'home') + `<div class="ncm-pn-rule"><b data-tooltip="What the table starts from. Edit a row or import a file and this becomes Custom by itself">Starting list</b><select id="r-era" data-ch="era" aria-label="Starting list" data-tooltip="Pick what the table starts from">${S.custom ? opt('custom', 'Custom (your edits)', true) : ''}${opt('2045', 'Night City 2045 (book)', !S.custom && S.list === '2045')}${opt('2077', 'Night City 2077', !S.custom && S.list === '2077')}${opt('blank', 'Blank: build your own', !S.custom && S.list === 'blank')}</select><div class="now"><i class="fas fa-user"></i><span>${esc(sentence('list'))}</span></div>${S.listAsk ? `<div class="ncm-pn-check" style="grid-column:1/-1"><i class="fas fa-triangle-exclamation"></i><span class="grow">This replaces your edits. Places people hold numbers on stay.</span>${btn('Replace them', 'fa-check', 'Switch to this list. You can undo straight after', 'data-do="listYes"', 'bad')}${btn('Keep my edits', '', 'Stay as you are', 'data-do="listNo"')}</div>` : ''}</div>`)}
    ${qsect('rl-pick', 'fa-user-gear', 'What can players pick?', 'var(--ncm-act)', ({ city: 'Home city', region: 'Home region', all: 'Anywhere' })[LIMITS.scope] + (LIMITS.ownDigits ? ', own digits allowed' : ', no typing digits'), rule('Players can pick from', 'How far the picker reaches. Rows you unticked in Places are never offered', seg('scope', LIMITS.scope, [['city', 'Home city', 'Only the home city'], ['region', 'Home region', 'Anywhere in the home region'], ['all', 'Anywhere', 'Any ticked row']]), 'scope') + rule('Typing their own digits', 'Whether players choose the last four digits', seg('own', LIMITS.ownDigits ? 1 : 0, [[1, 'Allowed', 'They can type digits'], [0, 'Not allowed', 'They choose from a few made for them']]), 'own'))}
    ${qsect('rl-chg', 'fa-pen', 'Can they change a number?', 'var(--ncm-attn)', LIMITS.changeNeedsGm ? 'Only with your OK' : 'Yes, by themselves', rule('Changing a number', 'Whether a change waits for you', seg('appr', LIMITS.changeNeedsGm ? 1 : 0, [[1, 'Needs my OK', 'It lands in Requests'], [0, 'Their choice', 'It happens straight away']]), 'appr'))}
    ${qsect('rl-lin', 'fa-layer-group', 'How many lines can they add?', 'var(--ncm-hue-5)', LIMITS.extra === 0 ? 'None' : String(LIMITS.extra) + ' extra', rule('Extra lines per player', 'Lines and burners a player can add without asking', `<select id="r-extra" data-ch="extra" aria-label="Extra lines per player" data-tooltip="How many lines a player can add without asking">${[0, 1, 2, 3, 5].map((n) => opt(n, n === 0 ? 'None' : String(n), LIMITS.extra === n)).join('')}</select>`, 'extra'))}
    ${qsect('rl-org', 'fa-building', 'Which names mean which office?', 'var(--ncm-hue-1)', Object.keys(ORG_MAP).length ? Object.keys(ORG_MAP).length + ' remembered' : 'Nothing to fix', Object.keys(ORG_MAP).length ? Object.entries(ORG_MAP).map(([k, v]) => `<div class="ncm-pn-kv"><span>${esc(k)}</span><b>${esc(v || 'Not a corporation')}</b>${btn('', 'fa-xmark', 'Forget this. It is asked again', `data-do="orgForget" data-k="${esc(k)}"`, 'ic')}</div>`).join('') : '<small>Written differently from an office? Decide once in the walkthrough and it is kept here. The contact itself is never rewritten.</small>')}
    ${qsect('rl-exp', 'fa-file-export', 'Want it in a spreadsheet?', 'var(--ncm-hue-2)', 'Four exports', `<div class="ncm-pn-acts">${btn('Assigned numbers', 'fa-file-csv', 'Every line: who holds it, what kind, its label, why, who has it saved', 'data-do="csvAssigned"')}${btn('Retired numbers', 'fa-file-csv', 'The list that keeps old numbers from coming back', 'data-do="csvRetired"')}${btn('Places table', 'fa-file-csv', 'The table every number comes from', 'data-do="csvPlaces"')}${btn('Address directory', 'fa-address-book', 'Tools → Email Domains & Addresses. Its CSV gains a Phone column, so one file can load both', 'data-do="toast" data-msg="The address directory CSV gains a Phone column"')}</div><small>Deleted a character or contact? Their numbers retire with them. Factory Reset and Orphan Audit cover numbers too.</small>`)}</div>`;
}

/* ─── places ─── */
const COL_HELP = { Pick: 'Players can pick numbers here.', Listed: 'Shows in the directory. Untick and the number still works, but reads as Unlisted number.', 'City code': 'Two or three letters. Dialled from outside the city.', City: 'The city name players read.', Code: 'Three letters, the district in a number. People already holding numbers lock this.', District: 'The name players read.', Area: 'Groups districts in the picker. Never dialled.', State: 'Groups cities in the picker. Never dialled.', Category: 'District, Corporate, Military… Your own words are fine.', Status: 'Dead means nothing should answer.', Source: 'Where this came from. Rulebook, Homebrew, anything.', Held: 'How many numbers are in use here.' };
const P_COLS = () => ['Pick', 'Listed', 'City', 'Code', 'District', 'Area', ...(S.w === 'pop' ? ['State'] : []), 'Category', 'Status', ...(S.w === 'pop' ? ['Source'] : []), ...EXTRA_COLS, 'Held'];
const rowHeld = (r) => peopleOn(r['Region code'], r['City code'], r.Code).length;
function tbHit(r) { const q = S.tbq.trim().toLowerCase(); if (!q) return true; const h = Object.values(r).join(' ').toLowerCase(); return q.split(/\s+/).every((w) => h.includes(w)); }
function categoryTag(cat) { if (!cat) return ''; if (cat === 'District' || cat === 'City') return `<span class="ncm-pn-who">${esc(cat)}</span>`; if (/dead/i.test(cat)) return tagp(cat, 'is-bad', 'fa-skull'); if (/burner/i.test(cat)) return tagp(cat, 'is-attn', 'fa-fire'); return hue(cat, /corp/i.test(cat) ? 'fa-building' : /mil/i.test(cat) ? 'fa-shield-halved' : null); }
function cellsOf(r, i) {
  const held = rowHeld(r);
  if (S.edit === i) {
    const f = (k, id, lock, w) => `<label class="ncm-pn-f"${lock ? ' data-tooltip="People hold numbers here, so this stays"' : ` data-tooltip="${esc(COL_HELP[k] || 'Your own column')}"`}>${esc(k)}<input type="text" id="${id}" value="${esc(r[k] ?? '')}"${lock ? ' disabled' : ''}${w ? ` style="width:${w}px"` : ''}></label>`;
    return `<td colspan="${P_COLS().length}"><div class="ncm-pn-form" style="white-space:normal"><div class="ncm-pn-fr">${f('Code', 'ed-code', held > 0, 62)}${f('District', 'ed-dist')}${f('Area', 'ed-area')}${f('State', 'ed-state')}${f('Category', 'ed-cat')}${f('Source', 'ed-src')}${EXTRA_COLS.map((c, x) => f(c, 'ed-x' + x)).join('')}<label class="ncm-pn-f" data-tooltip="${esc(COL_HELP.Status)}">Status<select id="ed-status">${opt('live', 'live', r.Status === 'live')}${opt('dead', 'dead', r.Status === 'dead')}</select></label></div>${held ? `<small>${held} number${held === 1 ? ' is' : 's are'} in use here, so the code stays.</small>` : ''}<div class="ncm-pn-acts">${btn('Save', 'fa-check', 'Save this row', `data-do="edSave" data-i="${i}"`, 'pri')}${btn('Cancel', '', 'Leave it as it was', 'data-do="edCancel"')}</div></div></td>`;
  }
  const cell = { Pick: `<td class="ck"><input type="checkbox" data-ch="rowPick" data-i="${i}" id="pk-${i}" aria-label="Players can pick ${esc(r.District || r.City)}" data-tooltip="${esc(COL_HELP.Pick)}"${r['Players can pick'] === 'yes' ? ' checked' : ''}></td>`, Listed: `<td class="ck"><input type="checkbox" data-ch="rowList" data-i="${i}" id="ls-${i}" aria-label="List ${esc(r.District || r.City)}" data-tooltip="${esc(COL_HELP.Listed)}"${r.Listed === 'yes' ? ' checked' : ''}></td>`, Code: `<td class="code">${esc(r.Code || '')}</td>`, Status: `<td>${r.Status === 'dead' ? tagp('dead', 'is-bad') : 'live'}</td>`, Source: `<td data-tooltip="${esc(r.Source || '')}" style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(r.Source || '')}</td>`, Held: `<td class="act">${held ? `<span class="ncm-pn-count" data-tooltip="${held} number${held === 1 ? '' : 's'} in use here">${held}</span> ` : ''}${btn('', 'fa-pen', 'Edit this row here', `data-do="edit" data-i="${i}"`, 'ic')}${held ? '' : btn('', 'fa-trash', 'Delete this row', `data-do="delRow" data-i="${i}"`, 'ic bad')}</td>` };
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
      <span class="grow"></span><details class="ncm-pn-menu"><summary class="ncm-ph2-btn ncm-ph2-btn--pri" data-tooltip="Add to the table"><i class="fas fa-plus"></i> Add</summary><div class="m"><button type="button" data-do="apOpen" data-tooltip="A region, city or district"><i class="fas fa-location-dot"></i> A place</button><button type="button" data-do="abOpen" data-tooltip="A corporation's office in another city"><i class="fas fa-building"></i> A branch</button></div></details><details class="ncm-pn-menu"><summary class="ncm-ph2-btn" data-tooltip="Work on it in Excel or Sheets. Your own columns are kept"><i class="fas fa-table"></i> Spreadsheet</summary><div class="m"><button type="button" data-do="csvPlaces" data-tooltip="Download the table as a CSV"><i class="fas fa-file-export"></i> Export</button><button type="button" data-do="csvImport" data-tooltip="Load an edited CSV. You see every change before it applies"><i class="fas fa-file-import"></i> Import</button><button type="button" data-do="csvSample" data-tooltip="Adds a district and a Gang turf column, removes Outskirts"><i class="fas fa-flask"></i> Try a sample import</button><button type="button" data-do="csvBlank" data-tooltip="An empty CSV with the right columns and one example row"><i class="fas fa-file-circle-plus"></i> Blank template</button><button type="button" data-do="tbReset" data-tooltip="Back to the shipped table. Numbers people hold are not touched"><i class="fas fa-rotate-left"></i> Reset the table</button></div></details><input type="file" id="tbfile" accept=".csv,text/csv" hidden></div>
    ${planView()}${addPlaceForm()}${addBranchForm()}
    <div class="ncm-pn-tw" data-sc="places"><table><thead><tr>${P_COLS().map((c) => `<th class="${c === 'Held' ? 'act' : ''}" data-tooltip="${esc(COL_HELP[c] || 'Your own column, kept through export and import')}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${regs.map((rc) => { const list = hits.filter(({ r }) => r['Region code'] === rc); const open = forced || S.pOpen.has(rc); const name = list[0].r.Region; return `<tr class="grp${open ? '' : ' is-shut'}" data-do="pFold" data-k="${esc(rc)}" data-tooltip="${open ? 'Fold' : 'Open'} ${esc(name)}"><td colspan="${P_COLS().length}" style="--tc:${hueOf(name)}"><i class="fas fa-chevron-down ch"></i>${esc(name)} <span class="ncm-pnum is-plain"><span class="r">+${esc(rc)}</span></span> <span class="ncm-pn-more">${list.length}</span>${rc === HOME.rc ? ' ' + tagp('your campaign', 'is-act', 'fa-location-dot') : ''}</td></tr>${open ? list.map(({ r, i }) => `<tr class="${r['Players can pick'] === 'no' ? 'is-off' : ''}${r.Listed === 'no' ? ' is-hid' : ''}">${cellsOf(r, i)}</tr>`).join('') : ''}`; }).join('')}</tbody></table></div>`;
}
const toCsv = () => { const cols = [...COLS, ...EXTRA_COLS]; return [cols, ...ROWS.map((r) => cols.map((c) => r[c] ?? ''))].map((l) => l.map(csvCell).join(',')).join('\n'); };
function parseCsv(text) { const out = []; let f = '', r = [], q = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; } else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; r.push(f); f = ''; if (r.some((x) => x.trim())) out.push(r); r = []; } else f += c; } r.push(f); if (r.some((x) => x.trim())) out.push(r); return out; }
const rowKey = (r) => r['Region code'] + '/' + r['City code'] + '/' + (r.Code || '-');
function planImport(text) {
  const grid = parseCsv(text.replace(/^﻿/, '')); const head = (grid.shift() || []).map((h) => h.trim());
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
const sampleCsv = () => { const cols = [...COLS, 'Gang turf']; const lines = ROWS.filter((r) => r.Code !== 'OUT').map((r) => cols.map((c) => (c === 'Gang turf' ? (r.Code === 'KAB' ? 'Tyger Claws' : '') : r[c] ?? ''))); lines.push(['72', 'Pacifica Confederation', 'Northern California', 'NC', 'Night City', 'Northside', 'NOR', 'Northside Industrial', 'District', 'yes', 'live', 'Homebrew', 'yes', 'Maelstrom']); return [cols, ...lines].map((l) => l.map(csvCell).join(',')).join('\n'); };
const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); toast('Downloaded ' + name); };

/* ─── special numbers ─── */
function spIssues(x) {
  const n = normSp(x.num), out = [];
  if (!n) { out.push(['warn', 'Give it a number. Letters, digits, anything.']); return out; }
  const twin = SPECIAL.find((y) => y !== x && normSp(y.num) === n); if (twin) out.push(['warn', `Another special number already uses this. Only the first would work.`]);
  const clash = SPECIAL.find((y) => y !== x && normSp(y.num) && normSp(y.num) !== n && asKeys(normSp(y.num)) === asKeys(n)); if (clash) out.push(['warn', `${clash.num} uses the same pad keys. Typing letters works, the pad can't tell them apart.`]);
  const keep = SERVICE[n]; delete SERVICE[n]; const q = parse(x.num); if (keep !== undefined) SERVICE[n] = keep;
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
  const row2 = (y) => `<button type="button" class="ncm-pn-prow${y === x ? ' on' : ''}" data-do="spSel" data-id="${y.id}" data-tooltip="Open ${esc(y.num || 'the new number')}">${portrait(y)}<span class="bd"><span class="nm">${esc(y.name || 'No name')}${y.seen === 'hidden' ? tagp('hidden', 'is-secret', 'fa-eye-slash') : ''}${y.alert ? '<i class="fas fa-bell ncm-pn-warnmark" aria-label="Alerts you"></i>' : ''}</span><span class="ln"><span class="ncm-pnum is-plain"><span class="${y.seen === 'hidden' ? 'sec' : 'x'}">${esc(y.num || 'New number')}</span></span></span><span class="mt">${hv(SP_ACT[y.act][0], SP_ICON[y.act])}${y.who === 'some' ? tagp('chosen only', 'is-secret', 'fa-user-lock') : ''}</span></span></button>`;
  const f = (k, label, tip, ph = '') => `<label class="ncm-pn-f grow" data-tooltip="${esc(tip)}">${esc(label)}<input type="text" id="sp-${k}" data-in="sp" data-k="${k}" value="${esc(x?.[k] ?? '')}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></label>`;
  const segF = (k, cur, opts, label, tip) => `<div class="ncm-pn-f"><span data-tooltip="${esc(tip)}">${esc(label)}</span><div class="ncm-pn-seg" role="group">${opts.map(([v, t, h]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-do="spSet" data-k="${k}" data-v="${v}" data-tooltip="${esc(h)}">${esc(t)}</button>`).join('')}</div></div>`;
  const issues = x ? spIssues(x) : [];
  const band = (ic, t, tone, sub = '') => `<div class="ncm-pn-band" style="--sk:${tone}"><i class="fas ${ic}"></i> ${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const c = S.spCall;
  const editor = !x ? '<div class="ncm-ph2-none">No special numbers. Add one.</div>' : `
    <div class="ncm-pn-dh">${portrait(x, 'xl')}<div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:5px"><div class="ncm-pn-fr">${f('num', 'Number', 'Anything at all: 666, BLACKWALL, 0, WAT-0000. Case, spaces and dashes do not matter', 'BLACKWALL')}${f('name', 'Name', 'The name players read. Leave it empty for no name', 'Optional')}</div><div class="ncm-pn-acts">${btn(x.img ? 'Change picture' : 'Add a picture', 'fa-image', 'A portrait for this number. It shows when they dial it and when it calls them', 'data-do="spArt"')}${x.img ? btn('', 'fa-xmark', 'Remove the picture', 'data-do="spArtClear"', 'ic') : ''}</div></div></div>
    ${issues.map(([t, m]) => `<div class="ncm-pn-check ${t === 'info' ? 'info' : ''}"><i class="fas ${t === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation'}"></i><span>${esc(m)}</span></div>`).join('')}
    ${qsect('sp-who', 'fa-eye-slash', 'Who can reach it?', 'var(--ncm-secret)', (x.seen === 'hidden' ? 'Hidden' : 'Listed') + ' · ' + (x.who === 'all' ? 'Anyone' : 'Chosen characters'), `<div class="ncm-pn-fr">${segF('seen', x.seen, [['listed', 'Listed', 'It shows in the directory'], ['hidden', 'Hidden', 'No hint anywhere until the whole number is typed']], 'Who sees it', 'Whether players can find it, or have to be told')}${segF('who', x.who, [['all', 'Anyone', 'Anyone who dials it'], ['some', 'Chosen characters', 'Everyone else hears not in service']], 'Who gets through', 'Who it works for')}</div>
    ${x.who === 'some' ? `<div class="ncm-pn-fr">${PCS().map((p) => `<label class="ncm-pn-chk" data-tooltip="${esc(p.name)} gets through"><input type="checkbox" id="sp-al-${p.id}" data-ch="spAllow" data-id="${p.id}"${x.allow.includes(p.id) ? ' checked' : ''}><span>${esc(p.name)}</span></label>`).join('')}</div>` : ''}`)}
    ${qsect('sp-dial', SP_ICON[x.act], 'What happens when they dial it?', 'var(--ncm-hue-3)', SP_ACT[x.act][0] + (x.alert ? ' · you get an alert' : ''), `<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="What happens when someone dials it">What happens<select id="sp-act" data-ch="spAct">${Object.entries(SP_ACT).map(([k, v]) => opt(k, v[0], x.act === k)).join('')}</select></label>
      ${x.act === 'recording' ? f('text', 'What it says', 'Read out, or use an audio file in Foundry') : ''}${x.act === 'macro' ? `<label class="ncm-pn-f grow" data-tooltip="Any macro in your world">Macro<select id="sp-macro" data-ch="spMacro">${['Open the Blackwall handout', 'Start a trace', 'Unlock the door'].map((m) => opt(m, m, x.macro === m)).join('')}</select></label>` : ''}</div>
    <small class="ncm-pn-note">${esc(SP_ACT[x.act][1])}</small>
    <label class="ncm-pn-chk" data-tooltip="You get a notice naming who dialled it, even when nothing else happens"><input type="checkbox" id="sp-alert" data-ch="spAlert"${x.alert ? ' checked' : ''}><span>Tell me when someone dials it</span></label>`)}
    ${qsect('sp-show', 'fa-id-badge', 'What does it show?', 'var(--ncm-hue-5)', (x.show === 'name' ? 'Name and picture' : 'Nothing') + ' · a Trace finds ' + ({ name: 'its name', false: 'a false name', dead: 'a dead end' })[x.trace], `<div class="ncm-pn-fr">${segF('show', x.show, [['name', 'Name and picture', 'What you set above'], ['none', 'Nothing', 'No name and no picture']], 'Their screen shows', 'When they dial it, and when it calls them')}
      <label class="ncm-pn-f" data-tooltip="What a Trace on this number reports">A Trace finds<select id="sp-trace" data-ch="spTrace">${[['name', 'Its name'], ['false', 'A false name'], ['dead', 'A dead end']].map(([k, t]) => opt(k, t, x.trace === k)).join('')}</select></label>${x.trace === 'false' ? f('falseName', 'False name', 'The name the Trace reports') : ''}</div>
      <div class="ncm-pn-ph" style="--sk:var(--ncm-hue-5)"><h5><i class="fas fa-mobile-screen"></i> When they dial it</h5><div class="ncm-pn-dh">${x.show === 'name' ? portrait(x, 'lg') : '<span class="ncm-pn-face lg"><i class="fas fa-question" aria-hidden="true"></i></span>'}<div><b>${esc(x.show === 'name' && x.name ? x.name : 'Unknown')}</b><div>${pnum(x.num)}</div></div></div><small>Calling it: ${esc(SP_ACT[x.act][2])}.</small></div>`)}
    ${qsect('sp-call', 'fa-phone', 'Want to call someone from it?', 'var(--ncm-good)', 'It has no NPC behind it. You speak for it', `<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="Who it rings">Call<select id="sp-to" data-ch="spTo">${PCS().map((p) => opt(p.id, p.name, (c?.to || 'v') === p.id)).join('')}</select></label>${btn('Ring them', 'fa-phone', 'Their phone rings from this number. You answer on the GM call screen, like any NPC line', 'data-do="spRing"', 'go')}</div>${spCallCard(x)}<small>The call log and a Trace treat it like any call from this number. Their Save number saves it, even if it is hidden.</small>`)}
    <div class="ncm-pn-acts">${btn('Try it', 'fa-vial', 'See it from the GM and a player side by side', 'data-do="spTry"')}<span class="grow"></span>${btn('Delete', 'fa-trash', 'Remove this number. Saved contacts keep it, and it stops answering', 'data-do="spDel"', 'bad')}</div>`;
  return `<header class="ncm-tabhd"><i class="fas fa-star-of-life"></i><div><h2>Special numbers</h2><p>Numbers that play by their own rules. They ignore the format and are checked first.</p></div></header>${setupTabs()}${undoLine()}
    <div class="ncm-pn-tb">${btn('New special number', 'fa-plus', 'Add a number that plays by its own rules', 'data-do="spNewOne"', 'pri')}<span class="grow"></span>${btn('', 'fa-file-export', 'Export this list as a CSV', 'data-do="csvSpecial"', 'ic')}${btn('', 'fa-file-import', 'Import a CSV. You see every change before it applies', 'data-do="toast" data-msg="Same plan-first import as Places"', 'ic')}</div>
    <div class="ncm-pn-split"><div class="ncm-pn-list" data-sc="splist">${SPECIAL.map(row2).join('')}</div><div class="ncm-pn-detail" data-sc="spdetail">${editor}</div></div>`;
}

/* ─── sharing (this lands in Contacts) ─── */
const shareTabs = () => `<div class="ncm-pn-inner" role="tablist">${[['share', 'Share', 'fa-share-nodes', 'Hand over an email, a number, or both'], ['who', 'Who knows whom', 'fa-table-cells-large', 'Who holds what. Email and number are separate'], ['form', 'Contact form', 'fa-id-card', 'Setting a number while you edit a contact']].map(([k, l, ic, tip]) => `<button type="button" role="tab" aria-selected="${S.shTab === k}" class="${S.shTab === k ? 'on' : ''}" data-do="shTab" data-k="${k}" data-tooltip="${esc(tip)}"><i class="fas ${ic}"></i> ${esc(l)}</button>`).join('')}</div>`;
const holdsNum = (p, pcId) => p.lines.some((l) => l.holders.includes(pcId));
const holdsMail = (p, pcId) => (EMAIL_KNOWN[p.id] || []).includes(pcId);
function viewShare() {
  const people = PEOPLE.filter((p) => p.kind === 'npc');
  const p = byId(S.shP); const l = p.lines[S.shLine] || p.lines[0];
  const body = S.shTab === 'who' ? whoView() : S.shTab === 'form' ? formView() : (() => {
    const wantNum = S.shWhat !== 'email', wantMail = S.shWhat !== 'number';
    const targets = PCS().map((c) => { const hasN = l ? l.holders.includes(c.id) : false, hasM = holdsMail(p, c.id); const adds = [wantMail && !hasM ? 'email' : '', wantNum && l && !hasN ? 'number' : ''].filter(Boolean); const has = [hasM ? 'email' : '', hasN ? 'number' : ''].filter(Boolean); return { c, adds, has }; });
    const m = p.aliasOf ? byId(p.aliasOf) : null;
    const to = [...S.shTo].map(byId);
    return `<div class="ncm-pn-split" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"><div class="ncm-pn-detail" data-sc="sh1" style="background:var(--ncm-bg-pane)">
      <label class="ncm-pn-f" data-tooltip="Who you are sharing">1. Who are you sharing?<select id="sh-p" data-ch="shP">${people.map((x) => opt(x.id, x.name + (x.aliasOf ? ' (alias)' : ''), x.id === S.shP)).join('')}</select></label>
      <div class="ncm-pn-f"><span data-tooltip="A player only gets what you hand over. A contact can be a number with no email, or the other way round">2. What do they get?</span><div class="ncm-pn-seg" role="group">${[['both', 'Both', 'Their email and their number'], ['email', 'Email', 'Just the email'], ['number', 'Number', 'Just the number']].map(([k, t, h]) => `<button type="button" class="${S.shWhat === k ? 'on' : ''}" data-do="shWhat" data-v="${k}" data-tooltip="${esc(h)}">${t}</button>`).join('')}</div></div>
      ${wantNum && p.lines.length > 1 ? `<label class="ncm-pn-f" data-tooltip="Which of their lines to hand over">Which line<select id="sh-line" data-ch="shLine">${p.lines.map((x, i) => opt(i, seenFrom(parse(x.n)) + (x.label ? ' ' + x.label : ''), i === S.shLine)).join('')}</select></label>` : ''}
      ${wantNum && !p.lines.length ? `<div class="ncm-pn-check"><i class="fas fa-triangle-exclamation"></i><span>${esc(p.name)} has no number yet.</span>${btn('Give one', 'fa-sim-card', 'Open them in People', `data-do="openPerson" data-id="${p.id}"`)}</div>` : ''}
      <div class="ncm-pn-f"><span data-tooltip="Sharing again adds what's missing and never makes a second contact">3. Who gets it?</span>${targets.map(({ c, adds, has }) => `<label class="ncm-pn-chk ncm-pn-shto" data-tooltip="Share with ${esc(c.name)}"><input type="checkbox" id="sh-to-${c.id}" data-ch="shTo" data-id="${c.id}"${S.shTo.has(c.id) ? ' checked' : ''}>${face(c)}<span class="bd"><b>${esc(c.name)}</b><span class="mt">${has.map((h) => tagp('has ' + h, 'is-good', h === 'email' ? 'fa-envelope' : 'fa-phone')).join('')}${adds.map((h) => tagp('adds ' + h, 'is-act', 'fa-plus')).join('')}${has.length || adds.length ? '' : '<small>Nothing to add</small>'}</span></span></label>`).join('')}</div>
      ${btn('Share', 'fa-share-nodes', 'Hand it over to the ticked characters', 'data-do="shGo"', 'pri')}</div>
      <div class="ncm-pn-detail" data-sc="sh2"><div class="ncm-pn-ph" style="--sk:var(--ncm-act)"><h5><i class="fas fa-gift"></i> What ${esc(to[0]?.name || 'they')} will get</h5><div class="ncm-pn-dh">${face(p)}<b>${esc(p.name)}</b></div>${wantMail ? `<div class="ncm-pn-why"><i class="fas fa-envelope"></i><span style="color:var(--ncm-text-addr)">${esc(p.email)}</span></div>` : ''}${wantNum && l ? `<div class="ncm-pn-why"><i class="fas fa-phone"></i>${pnum(l.n)}</div>` : ''}${!wantMail ? '<small>You have their number, not their email.</small>' : !wantNum ? '<small>You have their email, not their number.</small>' : ''}</div>
      ${m ? `<div class="ncm-pn-check secret"><i class="fas fa-mask"></i><span><b>Safe for an alias.</b> They get the name ${esc(p.name)}, its picture and what you ticked. They do not get ${esc(m.name)}, ${esc(m.name)}'s number, or the character behind it, and a Trace stops at ${esc(p.name)} unless you reveal more.</span></div>` : ''}
      <small>Taking back works the same way: remove just the number, just the email, or the contact.</small></div></div>`;
  })();
  return `<header class="ncm-tabhd"><i class="fas fa-address-book"></i><div><h2>Sharing contacts</h2><p>Email and number are separate things to hand over.</p></div></header>${shareTabs()}${undoLine()}${body}`;
}
function whoView() {
  const q = S.whoQ.trim().toLowerCase();
  const people = PEOPLE.filter((p) => p.kind === 'npc' && (p.lines.length || EMAIL_KNOWN[p.id]?.length) && (!q || (p.name + ' ' + p.role + ' ' + p.org).toLowerCase().includes(q)) && (S.whoShow === 'all' || (S.whoShow === 'none' && !PCS().some((c) => holdsNum(p, c.id) || holdsMail(p, c.id))) || (S.whoShow === 'num' && PCS().some((c) => holdsNum(p, c.id) && !holdsMail(p, c.id))) || (S.whoShow === 'mail' && PCS().some((c) => holdsMail(p, c.id) && !holdsNum(p, c.id)))));
  return `<div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Search contacts by name, role or organization"><i class="fas fa-magnifying-glass"></i><input type="text" id="who-q" data-in="whoQ" value="${esc(S.whoQ)}" placeholder="Find a contact" aria-label="Find a contact"></label><label class="ncm-pn-sel" data-tooltip="Narrow the table"><span>Show</span><select id="who-show" data-ch="whoShow">${[['all', 'Everyone'], ['num', 'Number but no email'], ['mail', 'Email but no number'], ['none', 'Nobody has them']].map(([k, l]) => opt(k, l, S.whoShow === k)).join('')}</select></label></div><div class="ncm-pn-scroll ncm-pn-mx" data-sc="who"><table><thead><tr><th>Contact</th>${PCS().map((c) => `<th><span class="thp">${face(c)}${esc(c.name)}</span></th>`).join('')}</tr></thead><tbody>${people.map((p) => `<tr><td><span class="cn">${face(p)}<span><b>${esc(p.name)}</b>${p.aliasOf ? ' ' + tagp('alias', 'is-secret') : ''}<span class="mt">${hv(p.role)}${hv(p.org, 'fa-building')}</span></span></span></td>${PCS().map((c) => { const m = holdsMail(p, c.id), n = holdsNum(p, c.id); return `<td><span class="ncm-pn-pair"><button type="button" class="${m ? 'on' : ''}" data-do="mxMail" data-p="${p.id}" data-c="${c.id}" aria-pressed="${m}" aria-label="${esc(c.name)} ${m ? 'has' : 'lacks'} ${esc(p.name)}'s email" data-tooltip="${m ? 'Has the email. Click to take it back' : 'No email. Click to share it'}"><i class="fas fa-envelope"></i></button><button type="button" class="${n ? 'on' : ''}" data-do="mxNum" data-p="${p.id}" data-c="${c.id}" aria-pressed="${n}" aria-label="${esc(c.name)} ${n ? 'has' : 'lacks'} ${esc(p.name)}'s number" data-tooltip="${p.lines.length ? (n ? 'Has the number. Click to take it back' : 'No number. Click to share it') : 'This contact has no number yet'}" ${p.lines.length ? '' : 'disabled'}><i class="fas fa-phone"></i></button></span></td>`; }).join('')}</tr>`).join('') || '<tr><td colspan="9"><small>Nothing matches.</small></td></tr>'}</tbody></table></div>`;
}
function formView() {
  const p = byId('or'); const pr = S.prop.or ??= suggest(p);
  return `<div class="ncm-pn-scroll" data-sc="form"><section class="ncm-pn-mod" style="--sk:var(--ncm-hue-3)"><div class="ncm-pn-mh"><i class="fas fa-id-card"></i> Editing ${esc(p.name)} <small>Contacts → Directory → edit</small></div><div class="ncm-pn-mb"><div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="Their in-world address">Email<input type="text" id="cf-mail" value="${esc(p.email)}"></label><label class="ncm-pn-f grow" data-tooltip="Type one, or press Generate. Letters, spaces and dashes don't matter">Number<input type="text" id="cf-num" value="${esc(seenFrom(parse(pr.n)))}"></label>${btn('Generate', 'fa-wand-magic-sparkles', 'Propose a number from this contact\'s details', 'data-do="cfGen"')}</div><div class="ncm-pn-why">${srcChip(pr)}<span class="ncm-pn-note">${esc(pr.why)}</span></div></div></section>
    <section class="ncm-pn-mod" style="--sk:var(--ncm-hue-5)"><div class="ncm-pn-mh"><i class="fas fa-file-csv"></i> Address directory CSV <small>Tools → Email Domains & Addresses</small></div><div class="ncm-pn-mb"><div class="ncm-pn-tw" style="min-height:0;flex:none"><table><thead><tr><th>name</th><th>email</th><th data-tooltip="New. A row can set the email, the number, or both. A number that is taken or retired is flagged in the plan">phone</th><th>kind</th></tr></thead><tbody><tr><td>Judy Alvarez</td><td>judy@nightcity.net</td><td>+72 NC WAT-2208</td><td>contact</td></tr><tr><td>Dr. Ortega</td><td></td><td>LCH-3120</td><td>contact</td></tr></tbody></table></div><small>Same rule as today: you see a plan first, and a blank never clears anything.</small></div></section></div>`;
}

/* ─── what players get from all of this ─── */
function viewPlayer() {
  return `<header class="ncm-tabhd"><i class="fas fa-user"></i><div><h2>What players get</h2><p>Small additions across the Agent, shards and terminals. Click the numbers.</p></div></header>
  <div class="ncm-pn-scroll" data-sc="pl"><div class="ncm-pn-ppl">
    <h4 class="ncm-pn-grp">Contacts</h4><div class="ncm-pn-ph" style="--sk:var(--ncm-good)"><h5><i class="fas fa-phone"></i> A contact you only have the number for</h5><div class="ncm-pn-dh">${face(byId('si'))}<b>Silver</b></div>${pl('+72 NC NHW-2090')}<small>You have their number, not their email.</small><div class="ncm-pn-acts">${btn('Call', 'fa-phone', 'Call Silver', 'data-do="toast" data-msg="Calls Silver"', 'go')}</div></div>
    <div class="ncm-pn-ph" style="--sk:var(--ncm-text-addr)"><h5><i class="fas fa-envelope"></i> A contact you only have the email for</h5><div class="ncm-pn-dh">${face(byId('mo'))}<b>Mama Okoye</b></div><span style="color:var(--ncm-text-addr)">mama@nightcity.net</span><small>You have their email, not their number. There is no Call button, even if the GM's directory has one.</small><div class="ncm-pn-acts">${btn('Message', 'fa-envelope', 'Write to Mama Okoye', 'data-do="toast" data-msg="Opens the composer"')}</div></div>
    <h4 class="ncm-pn-grp">Calls</h4><div class="ncm-pn-ph" style="--sk:var(--ncm-act)"><h5><i class="fas fa-clock-rotate-left"></i> A number in your call log</h5><div class="ncm-pn-why"><i class="fas fa-phone-arrow-down-left"></i>${pl('+72 NC SDO-4410')}</div><small>Santo Domingo. Missed, 22:14.</small>${S.saved ? `<div class="ncm-pn-check info"><i class="fas fa-check"></i><span>Saved as "SDO number". A contact can be just a number, with no name yet.</span></div>` : `<div class="ncm-pn-acts">${btn('Save number', 'fa-floppy-disk', 'Add it to your contacts. A name is optional', 'data-do="plSave"')}</div>`}</div>
    <div class="ncm-pn-ph" style="--sk:var(--ncm-secret)"><h5><i class="fas fa-user-secret"></i> A withheld call</h5>${S.traced ? `<div class="ncm-pn-why"><i class="fas fa-magnifying-glass-location"></i>${pl('+72 NC NHW-2090')}</div><small>Traced: Silver, on CitiNet. Silver is an alias, so it stops there. This goes in the GM's Security log, and adds heat if it fails.</small><div class="ncm-pn-acts">${btn('Save number', 'fa-floppy-disk', 'Traced, so now you can', 'data-do="toast" data-msg="Saved"')}</div>` : `<div><b>Number withheld</b></div><small>Nothing to save until it's traced.</small><div class="ncm-pn-acts">${btn('Trace', 'fa-magnifying-glass-location', 'Roll to find the number and the network the caller is on', 'data-do="plTrace"')}</div>`}</div>
    <h4 class="ncm-pn-grp">Numbers you find</h4><div class="ncm-pn-ph" style="--sk:var(--ncm-act)"><h5><i class="fas fa-message"></i> A number in a message</h5><div class="ncm-pn-cc"><small>From Rogue</small><div>Job's real. Call my guy at ${pl('WAT-2208')} before midnight.</div></div><small>Numbers in mail become links. Clicking one fills the dial box and never says whose it is.</small></div>
    <div class="ncm-pn-ph" style="--sk:var(--ncm-hue-5)"><h5><i class="fas fa-microchip"></i> A number in a shard or on a terminal</h5><div class="ncm-pn-cc"><small>Personnel record · Phone</small>${pl('+14 DAL CEN-3345')}</div><small>Same link in shard files, terminal mail and files.</small></div>
    <h4 class="ncm-pn-grp">Handing it out, and when it can't work</h4><div class="ncm-pn-ph" style="--sk:var(--ncm-good)"><h5><i class="fas fa-share-nodes"></i> Share my number</h5><div class="ncm-pn-cc"><div class="ncm-pn-dh">${face(byId('v'))}<b>Veronica A.</b></div>${pl('WAT-4471')}<div class="ncm-pn-acts">${btn('Save number', 'fa-floppy-disk', 'Add Veronica A. to your contacts', 'data-do="toast" data-msg="Saved"')}${btn('Call', 'fa-phone', 'Call this number', 'data-do="toast" data-msg="Fills the dial box"', 'go')}</div></div><small>A card posted to chat. The player picks who sees it, and which line.</small></div>
    <div class="ncm-pn-ph" style="--sk:var(--ncm-attn)"><h5><i class="fas fa-power-off"></i> A line the GM switched off</h5><div class="ncm-pn-cc"><small>Your number</small>${pl('WAT-4471')}<div>This line is switched off. Calls can't reach you.</div></div><small>Anyone calling it hears "not in service". It comes back with the same number.</small></div>
    <div class="ncm-pn-ph" style="--sk:var(--ncm-attn)"><h5><i class="fas fa-moon"></i> When a GM isn't online</h5><div class="ncm-pn-cc"><small>Your number</small><div>Changing it needs your GM. Saved: they'll see it next time they're on.</div></div><small>Same plain line for an extra line over the limit, and for a business with nobody to answer (it goes to voicemail).</small></div>
  </div></div>`;
}
const pl = (n) => { const q = parse(n); const shown = seenFrom(q); return `<button type="button" data-do="plDial" data-n="${esc(n)}" data-tooltip="Open the dial box with this number" style="display:inline"><span class="ncm-pnum" style="cursor:pointer">${numParts(n)}</span></button>`; };

/* ─── draw ─── */
const FRAMES = {
  numbers: { tab: 'Phone', nav: 'numbers', view: viewNumbers, note: '<b>Numbers → People.</b> Every identity and every line. Pick Rogue\'s alias Silver for a sense-check. Pick Tess Valdez and press Walk through it: the same five steps players get, starting on the Militech office because of the Organization field. Change warns who loses the old number. Search works on names and numbers.' },
  bulk: { tab: 'Phone', nav: 'numbers', view: viewBulk, note: '<b>Give numbers.</b> Each row is proposed from the contact\'s details, with the reason. Harlan lands next to Tess. The alias Ghostwire stays off Mama Okoye\'s district. Give them, then Undo.' },
  board: { tab: 'Phone', nav: 'numbers', view: viewBoard, note: '<b>Numbers → Districts.</b> Pick someone from No number on the right, then click a tile. Click a tile with nobody armed to see who is on it. Tiles show GM-only and hidden. Area heads fold: the first starts open, the rest closed, and a closed head still shows who is in it. Searching or placing someone opens them all.' },
  requests: { tab: 'Phone', nav: 'numbers', view: viewRequests, note: '<b>Numbers → Requests.</b> Number changes and extra lines over the limit. Approving a change retires the old number.' },
  retired: { tab: 'Phone', nav: 'numbers', view: viewRetired, note: '<b>Numbers → Retired.</b> Release asks first, because anyone who saved the number would reach its next owner.' },
  learn: { tab: 'Phone', nav: 'setup', view: viewLearn, note: '<b>Number setup → How it works.</b> Shown first the first time a GM opens this, reopenable any time. Try a number shows what you see and what a player sees, side by side. Try WAT-5150 (retired), NCM-1000 (hidden), WAT-2208 as Rache (not in their contacts).' },
  rules: { tab: 'Phone', nav: 'setup', view: viewRules, note: '<b>Number setup → Rules.</b> Each sentence changes as you change the rule. Set Campaign home to Dallas and every number form follows. Edit anything in Places and Starting list reads Custom by itself.' },
  places: { tab: 'Phone', nav: 'setup', view: viewPlaces, note: '<b>Number setup → Places.</b> Pick and Listed are on the left now. Pencil edits a row here. A row people hold numbers on locks its code and can\'t be deleted. Hover any column head. Try find "arasaka night", Hide, Place and Branch.' },
  special: { tab: 'Phone', nav: 'setup', view: viewSpecial, note: '<b>Number setup → Special numbers.</b> Anything, with its own rules and portrait. TRAUMA and NCPD live here now. Try typing a number someone holds, like WAT-2208. A hidden one gives no hint in the dial box until the whole number is typed. Each can call players itself: there is no NPC behind it, you speak for it.' },
  share: { tab: 'Contacts', nav: null, view: viewShare, note: '<b>Contacts: sharing.</b> Email, Number or Both, per push. Sharing again adds what\'s missing. Silver shows the alias rule. Who knows whom has two buttons per cell. Contact form has Generate.' },
  player: { tab: 'Agent', nav: null, view: viewPlayer, note: '<b>Player side.</b> What the sharing rules, clickable numbers, Save number, Trace and Share my number look like. Shown here in the player palette; final layout goes with the Calls tab.' },
};
const win = document.getElementById('win'), stage = document.getElementById('stage');
const scrollMemo = new Map();
function draw() {
  stage.querySelectorAll('[data-sc]').forEach((el) => scrollMemo.set(el.dataset.sc, el.scrollTop));
  const memo = stage.querySelector('.mk-body-in'); if (memo) scrollMemo.set('__body', memo.scrollTop);
  const a = document.activeElement; const focus = a?.id && stage.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  const F = FRAMES[S.f];
  document.querySelectorAll('[data-f]').forEach((b) => { if (b.closest('.mk-bar')) b.classList.toggle('on', b.dataset.f === S.f); });
  document.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === S.t));
  document.querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('on', b.dataset.w === S.w));
  document.getElementById('note').innerHTML = F.note;
  const player = S.f === 'player';
  win.classList.toggle('mk-player', player); win.classList.toggle('ncm-admin-panel', !player); win.classList.toggle('is-wide', S.w === 'pop');
  if (player) win.removeAttribute('data-ncm-admin-theme'); else win.setAttribute('data-ncm-admin-theme', S.t);
  win.style.setProperty('--mk-w', S.w === 'pop' ? '1120px' : '820px'); win.style.setProperty('--mk-h', S.w === 'pop' ? '780px' : '760px');
  const req = REQUESTS.length;
  const nav = F.nav ? `<nav class="ncm-ph2-nav" role="tablist">${[['live', 'Live', 'fa-tower-broadcast'], ['numbers', 'Numbers', 'fa-sim-card', 'numbers'], ['setup', 'Number setup', 'fa-sliders', 'learn'], ['log', 'Call log', 'fa-list'], ['vm', 'Voicemail', 'fa-voicemail'], ['settings', 'Settings', 'fa-gear']].map(([k, l, ic, to]) => `<button type="button" role="tab" aria-selected="${F.nav === k}" class="ncm-ph2-navbtn${F.nav === k ? ' on' : ''}" data-do="${to ? 'frame' : 'toast'}" ${to ? `data-f="${to}"` : 'data-msg="Unchanged in this round"'} data-tooltip="${to === 'numbers' ? 'Who holds what' : to === 'learn' ? 'How numbers work, the rules, and the place table' : 'Unchanged in this round'}"><i class="fas ${ic}"></i> ${l}${k === 'numbers' && req ? `<span class="ncm-ph2-navct hot">${req}</span>` : ''}</button>`).join('')}</nav>` : '';
  stage.innerHTML = `<div class="mk-tabs">${F.tab === 'Agent' ? '<span class="t">Messages</span><span class="t">Shards</span><span class="t on">Calls</span>' : `<span class="g">COMMS</span><span class="t${F.tab === 'Messages' ? ' on' : ''}">Messages</span><span class="t${F.tab === 'Contacts' ? ' on' : ''}">Contacts</span><span class="t${F.tab === 'Phone' ? ' on' : ''}">Phone</span><span class="t">Spam</span><span class="g">NET</span><span class="t">Networks</span><span class="t">Security</span>`}</div><div class="mk-body mk-body-in" tabindex="-1"><div class="ncm-ph2">${nav}<div class="ncm-pn">${F.view()}</div></div></div>`;
  stage.querySelectorAll('[data-sc]').forEach((el) => { const v = scrollMemo.get(el.dataset.sc); if (v) el.scrollTop = v; });
  const b = stage.querySelector('.mk-body-in'); if (b && scrollMemo.get('__body')) b.scrollTop = scrollMemo.get('__body');
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(focus.s, focus.e); } catch { /* not text */ } } }
}
function applyList(v) {
  const was = { rows: ROWS, list: S.list, custom: S.custom, home: HOME };
  const base = v === 'blank' ? [] : [...(v === '2077' ? ERA_2077 : BOOK_ROWS.filter(isNcDistrict)), ...BOOK_ROWS.filter((r) => !isNcDistrict(r))].map((r) => ({ ...r }));
  const kept = ROWS.filter((r) => rowHeld(r) > 0 && !base.some((b) => rowKey(b) === rowKey(r)));
  ROWS = [...base, ...kept]; S.list = v; S.custom = false; S.listAsk = null; buildTables();
  if (!REGIONS[HOME.rc]?.cities[HOME.city]) { HOME = { rc: ROWS[0]['Region code'], city: ROWS[0]['City code'] }; buildTables(); }
  S.undo = { text: (v === 'blank' ? 'Table cleared.' : 'List swapped.') + (kept.length ? ' Kept ' + kept.length + ' place' + (kept.length === 1 ? '' : 's') + ' people hold numbers on.' : ''), fn: () => { ROWS = was.rows; S.list = was.list; S.custom = was.custom; HOME = was.home; buildTables(); } };
}
const tipEl = document.getElementById('mk-tip');
let toastT; function toast(msg) { const t = document.getElementById('mk-toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
const freshBulk = () => { S.bulk = null; };
function retire(n, was, why) { RET = [{ n: fullForm(parse(n)), was, why, at: '2045-03-14' }, ...RET]; }

/* ─── what buttons do ─── */
const ACT = {
  frame: (el) => { S.f = el.dataset.f; S.tile = null; S.dock = null; if (S.f === 'bulk') freshBulk(); },
  toast: (el) => { toast(el.dataset.msg); return false; },
  sel: (el) => { S.sel = el.dataset.id; S.change = null; S.addLine = null; },
  fold: (el) => { const k = el.dataset.k; if (S.shut.has(k)) S.shut.delete(k); else S.shut.add(k); },
  showFlag: () => { S.show = S.show === 'flag' ? 'all' : 'flag'; },
  okFlag: (el) => { S.okFlags.add(el.dataset.k); },
  orgUse: (el) => { orgDecide(el.dataset.org, el.dataset.corp, 'Everyone whose Organization reads ' + el.dataset.org + ' now goes to ' + el.dataset.corp + '. No contact was changed.'); },
  orgNot: (el) => { orgDecide(el.dataset.org, '', el.dataset.org + ' is not a corporation. It will not be asked again.'); },
  orgForget: (el) => { delete ORG_MAP[el.dataset.k]; orgChanged(); },
  walk: (el) => { const p = byId(el.dataset.id), target = el.dataset.target || 'give'; if (target === 'bulk') S.f = 'numbers'; openWalk(p, target); },
  wkLevel: (el) => { S.walk.level = el.dataset.k; S.walk.q = ''; },
  wkPick: (el) => { const w = S.walk, i = WK.findIndex((x) => x.key === w.level); w.path[w.level] = el.dataset.v; WK.slice(i + 1).forEach((x) => { w.path[x.key] = null; }); w.q = ''; let n = i + 1; /* a level with one choice still shows, unless nothing is left to choose */ w.level = n < WK.length ? WK[n].key : null; if (!w.level) wkRoll(w); },
  wkJump: (el) => { const w = S.walk, r = ROWS.find((x) => rowKey2(x) === el.dataset.key); if (!r) return false; w.path = wkPathOf(r); w.level = null; wkRoll(w); },
  wkLine: (el) => { S.walk.line = el.dataset.v; S.walk.own = ''; },
  wkRoll: () => { wkRoll(S.walk); },
  wkCancel: () => { const w = S.walk; S.walk = null; if (w.target === 'bulk') S.f = 'bulk'; },
  wkUse: () => { const w = S.walk, p = byId(w.pid), r = wkRow(w.path), line = /^\d{4}$/.test(w.own || '') ? w.own : w.line, n = numAt(r, line), mate = wkMate(p, r); const sameAsStart = rowKey2(r) === rowKey2(rowOfNum(parse(w.start.n))); const why = sameAsStart ? w.start.why : 'You picked ' + (r.District || r.City) + '.'; const pr = { n, why, src: sameAsStart ? w.start.src : 'you', code: r.Code, rowKey: r['City code'] + '/' + (r.Code || '-') }; S.walk = null; if (w.target === 'bulk') { S.bulk[p.id] = pr; S.f = 'bulk'; } else if (w.target === 'change') { S.change.prop = pr; S.change.typed = ''; } else if (w.target === 'add') { S.addLine.n = n; } else { give(p, n, why); delete S.prop[p.id]; S.undo = { text: `${p.name} now has ${seenFrom(parse(n))}.`, fn: () => { p.lines.pop(); } }; } },
  reroll: (el) => { const p = byId(el.dataset.id), cur = S.prop[p.id]; const r = rowOfNum(parse(cur.n)); S.prop[p.id] = { ...cur, n: numAt(r, freeLine(r)) }; },
  useProp: (el) => { const p = byId(el.dataset.id), pr = S.prop[p.id]; give(p, pr.n, pr.why); delete S.prop[p.id]; S.undo = { text: `${p.name} now has ${seenFrom(parse(pr.n))}.`, fn: () => { p.lines.pop(); } }; },
  change: (el) => { const p = byId(el.dataset.id), i = Number(el.dataset.i), l = p.lines[i]; const pr = suggest(p); S.change = { pid: p.id, i, prop: pr, typed: '', push: l.holders.length > 0 }; },
  chgReroll: () => { const r = rowOfNum(parse(S.change.prop.n)); S.change.prop = { ...S.change.prop, n: numAt(r, freeLine(r)) }; },
  chgCancel: () => { S.change = null; },
  chgGo: () => { const c = S.change, p = byId(c.pid), l = p.lines[c.i], old = l.n, held = l.holders; const cand = c.typed ? parse(c.typed) : null; const n = cand ? fullForm(cand) : c.prop.n; retire(old, p.name, 'Changed'); l.n = n; l.why = cand ? 'You typed this one.' : c.prop.why; if (!c.push) l.holders = []; S.change = null; S.undo = { text: `${p.name} is now on ${seenFrom(parse(n))}. ${seenFrom(parse(old))} retired.${c.push && held.length ? ' New number sent to ' + held.map((h) => byId(h).name).join(', ') + '.' : ''}`, fn: () => { l.n = old; l.holders = held; RET = RET.filter((r) => keyOf2(r.n) !== keyOf2(old)); } }; },
  retireLine: (el) => { const p = byId(el.dataset.id), i = Number(el.dataset.i), l = p.lines[i]; retire(l.n, l.kind === 'burner' ? 'A burner of ' + p.name : p.name, l.kind === 'burner' ? 'Burned' : 'Retired'); p.lines.splice(i, 1); S.undo = { text: `${seenFrom(parse(l.n))} retired for good.`, fn: () => { p.lines.splice(i, 0, l); RET = RET.filter((r) => keyOf2(r.n) !== keyOf2(l.n)); } }; },
  shareFrom: (el) => { S.f = 'share'; S.shTab = 'share'; S.shP = byId(el.dataset.id).kind === 'npc' ? el.dataset.id : 'si'; S.shLine = Number(el.dataset.i) || 0; S.shWhat = 'number'; },
  addLine: (el) => { const p = byId(el.dataset.id); const pr = suggest({ ...p, aliasOf: null, org: '', loc: p.loc }); S.addLine = { pid: p.id, kind: 'extra', label: '', n: pr.n }; },
  addKind: (el) => { S.addLine.kind = el.dataset.k; if (el.dataset.k === 'burner') { const r = ROWS.find((x) => x.Code === 'BRN'); if (r) S.addLine.n = numAt(r, freeLine(r)); if (!S.addLine.label) S.addLine.label = 'Burner'; } },
  addReroll: () => { const r = rowOfNum(parse(S.addLine.n)); S.addLine.n = numAt(r, freeLine(r)); },
  addCancel: () => { S.addLine = null; },
  addGo: () => { const a = S.addLine, p = byId(a.pid); give(p, a.n, 'You gave them this one.', a.kind, a.label || (a.kind === 'burner' ? 'Burner' : 'Extra line')); S.addLine = null; S.undo = { text: `Added ${seenFrom(parse(a.n))} to ${p.name}.`, fn: () => { p.lines.pop(); } }; },
  undo: () => { S.undo?.fn?.(); S.undo = null; freshBulk(); },
  undoClose: () => { S.undo = null; },
  bulkRoll: () => { freshBulk(); },
  bulkOne: (el) => { const id = el.dataset.id; const r = rowOfNum(parse(S.bulk[id].n)); S.bulk[id] = { ...S.bulk[id], n: numAt(r, freeLine(r, null, Object.values(S.bulk).map((x) => keyOf2(x.n)))) }; },
  bulkGo: () => { const given = []; for (const [id, pr] of Object.entries(S.bulk)) { if (S.bulkOff.has(id)) continue; const p = byId(id); give(p, pr.n, pr.why); given.push(p); } S.f = 'numbers'; freshBulk(); S.bulkOff.clear(); S.undo = { text: `Gave ${given.length} number${given.length === 1 ? '' : 's'}.`, fn: () => given.forEach((p) => p.lines.pop()) }; },
  dock: (el) => { S.dock = S.dock === el.dataset.id ? null : el.dataset.id; S.tile = null; },
  dockOff: () => { S.dock = null; },
  tile: (el) => {
    const k = el.dataset.k; const [rc, city] = S.boardCity.split(':');
    if (S.dock) { const p = byId(S.dock); const r = ROWS.find((x) => x['Region code'] === rc && x['City code'] === city && (x.Code || '-') === k); const pr = suggest(p, {}, r); give(p, pr.n, pr.why); S.dock = null; S.tile = k; S.undo = { text: `${p.name} is on ${seenFrom(parse(pr.n))}.`, fn: () => { p.lines.pop(); } }; return; }
    S.tile = S.tile === k ? null : k;
  },
  openPerson: (el) => { S.sel = el.dataset.id; S.f = 'numbers'; S.show = 'all'; S.q = ''; },
  reqYes: (el) => { const r = REQUESTS.find((x) => x.id === el.dataset.id), p = byId(r.pid); REQUESTS = REQUESTS.filter((x) => x !== r); if (r.type === 'change') { const l = p.lines[0], old = l.n; retire(old, p.name, 'Changed'); l.n = r.to; l.why = 'They asked for this and you approved it.'; S.undo = { text: `${p.name} is on ${seenFrom(parse(r.to))}. ${seenFrom(parse(old))} retired.`, fn: () => { l.n = old; RET = RET.filter((x) => keyOf2(x.n) !== keyOf2(old)); REQUESTS.unshift(r); } }; } else { give(p, r.to, 'They asked for this and you approved it.', r.kind, r.label); S.undo = { text: `Added ${seenFrom(parse(r.to))} to ${p.name}.`, fn: () => { p.lines.pop(); REQUESTS.unshift(r); } }; } },
  reqNo: (el) => { const r = REQUESTS.find((x) => x.id === el.dataset.id); REQUESTS = REQUESTS.filter((x) => x !== r); S.undo = { text: `Declined. ${byId(r.pid).name} is told.`, fn: () => { REQUESTS.unshift(r); } }; },
  relAsk: (el) => { S.relOpen = el.dataset.n; },
  relCancel: () => { S.relOpen = null; },
  relGo: (el) => { const r = RET.find((x) => x.n === el.dataset.n); RET = RET.filter((x) => x !== r); S.relOpen = null; S.undo = { text: `${seenFrom(parse(r.n))} can be handed out again.`, fn: () => { RET.unshift(r); } }; },
  areaFold: (el) => {
    if (el.dataset.forced) return false;
    const box = el.closest('.ncm-pn-area'), k = el.dataset.k, shut = !box.classList.contains('is-shut');
    box.classList.toggle('is-shut', shut); el.setAttribute('aria-expanded', String(!shut)); box.querySelector('.ncm-pn-area__b').toggleAttribute('inert', shut);
    (shut ? S.areaShut : S.areaOpen).add(k); (shut ? S.areaOpen : S.areaShut).delete(k);
    return false;
  },
  areaAll: (el) => { const [rc, city] = S.boardCity.split(':'); const shut = el.dataset.v === 'shut'; for (const a of uniq(ROWS.filter((r) => r['Region code'] === rc && r['City code'] === city).map((r) => r.Area || (isCorp(r) ? 'Offices' : 'The city')))) { const k = S.boardCity + '|' + a; (shut ? S.areaShut : S.areaOpen).add(k); (shut ? S.areaOpen : S.areaShut).delete(k); } },
  qFold: (el) => { const k = el.dataset.k; if (S.fOpen.has(k)) S.fOpen.delete(k); else S.fOpen.add(k); },
  lineFold: (el) => { const k = el.dataset.k; if (S.lineOpen.has(k)) S.lineOpen.delete(k); else S.lineOpen.add(k); },
  bulkMove: (el) => { S.bulkMove = S.bulkMove === el.dataset.id ? null : el.dataset.id; },
  reqSee: () => { S.reqSee = !S.reqSee; },
  part: (el) => { S.part = el.dataset.k; },
  learnGo: (el) => { S.learn = Number(el.dataset.i); },
  listYes: () => { applyList(S.listAsk); },
  listNo: () => { S.listAsk = null; },
  lineOff: (el) => { const p = byId(el.dataset.id), l = p.lines[Number(el.dataset.i)]; l.off = !l.off; S.undo = { text: l.off ? `${seenFrom(parse(l.n))} is switched off. Callers hear not in service, and ${p.name} is told.` : `${seenFrom(parse(l.n))} is back in service.`, fn: () => { l.off = !l.off; } }; },
  spSel: (el) => { S.spSel = el.dataset.id; },
  spNewOne: () => { const x = spNew({}); SPECIAL.push(x); S.spSel = x.id; },
  spDel: () => { const i = SPECIAL.findIndex((x) => x.id === S.spSel), x = SPECIAL[i]; SPECIAL.splice(i, 1); S.spSel = SPECIAL[0]?.id || null; syncSpecial(); S.undo = { text: `Removed ${x.num || 'the new number'}.`, fn: () => { SPECIAL.splice(i, 0, x); S.spSel = x.id; syncSpecial(); } }; },
  spArt: () => { const x = SPECIAL.find((y) => y.id === S.spSel); const i = SAMPLE_ART.indexOf(x.img); x.img = SAMPLE_ART[(i + 1) % SAMPLE_ART.length]; toast('In Foundry this opens the file picker. Any image works.'); },
  spArtClear: () => { SPECIAL.find((y) => y.id === S.spSel).img = ''; },
  spSet: (el) => { const x = SPECIAL.find((y) => y.id === S.spSel); x[el.dataset.k] = el.dataset.v; if (el.dataset.k === 'who' && el.dataset.v === 'all') x.allow = []; },
  spRing: () => { const x = SPECIAL.find((y) => y.id === S.spSel); const to = byId(S.spCall?.to || 'v'); toast(`${to.name}'s phone rings from ${x.num || 'this number'}.`); return false; },
  spTry: () => { const x = SPECIAL.find((y) => y.id === S.spSel); S.tryN = x.num; S.f = 'learn'; },
  csvSpecial: () => { download('ncm-special-numbers.csv', [['Number', 'Name', 'Seen', 'When dialled', 'Who gets through', 'Screen shows', 'Trace finds', 'Alert'], ...SPECIAL.map((x) => [x.num, x.name, x.seen, x.act, x.who === 'all' ? 'anyone' : x.allow.map((a) => byId(a).name).join('; '), x.show, x.trace === 'false' ? x.falseName : x.trace, x.alert ? 'yes' : 'no'])].map((l) => l.map(csvCell).join(',')).join('\n')); return false; },
  scope: (el) => { LIMITS.scope = el.dataset.v; },
  own: (el) => { LIMITS.ownDigits = el.dataset.v === '1'; },
  appr: (el) => { LIMITS.changeNeedsGm = el.dataset.v === '1'; },
  pFold: (el) => { const k = el.dataset.k; if (S.tbq.trim()) return false; if (S.pOpen.has(k)) S.pOpen.delete(k); else S.pOpen.add(k); },
  tbHide: (el) => { const hits = ROWS.filter(tbHit); hits.forEach((r) => { r.Listed = el.dataset.v; }); toast(`${hits.length} row${hits.length === 1 ? '' : 's'} ${el.dataset.v === 'no' ? 'hidden from' : 'listed in'} the directory.`); },
  edit: (el) => { S.edit = Number(el.dataset.i); },
  edCancel: () => { S.edit = null; },
  edSave: (el) => { const r = ROWS[Number(el.dataset.i)]; const v = (id) => document.getElementById(id)?.value.trim() ?? ''; const code = v('ed-code').toUpperCase(); if (code && !/^[A-Z]{3}$/.test(code)) { toast('A district code is three letters.'); return false; } r.Code = code; r.District = v('ed-dist'); r.Area = v('ed-area'); r.State = v('ed-state'); r.Category = v('ed-cat'); r.Status = v('ed-status'); r.Source = v('ed-src'); EXTRA_COLS.forEach((c, x) => { r[c] = v('ed-x' + x); }); S.edit = null; buildTables(); },
  delRow: (el) => { const i = Number(el.dataset.i), r = ROWS[i]; ROWS.splice(i, 1); buildTables(); S.undo = { text: `Removed ${r.Code || r.City}.`, fn: () => { ROWS.splice(i, 0, r); buildTables(); } }; },
  apOpen: () => { S.addBranch = null; S.addPlace = { rc: HOME.rc, nr: '', nrc: '', st: '', city: '', cc: '', ar: '', di: '', ex: '' }; },
  apCancel: () => { S.addPlace = null; },
  apGo: () => { const a = S.addPlace; const isNew = a.rc === 'new'; const rc = isNew ? a.nrc : a.rc; if (!rc || !a.city || !a.cc) { toast('A place needs a region, a city and a city code.'); return false; } const r = row([rc, isNew ? a.nr || 'New region' : REGIONS[a.rc].name, a.st, a.cc.toUpperCase(), a.city, a.ar, a.ex.toUpperCase(), a.di, a.ex ? 'District' : 'City', 'yes', 'live', 'Homebrew'].join('|')); ROWS.push(r); buildTables(); S.pOpen.add(rc); S.addPlace = null; S.undo = { text: `Added ${a.di || a.city}.`, fn: () => { ROWS.splice(ROWS.indexOf(r), 1); buildTables(); } }; },
  abOpen: () => { S.addPlace = null; const r = ROWS.find((x) => isCorp(x)); S.addBranch = { corp: r.Code + '|' + r.District, city: '', hide: false }; },
  abCancel: () => { S.addBranch = null; },
  abGo: () => { const a = S.addBranch; const [code, name] = a.corp.split('|'); const [rc, cc] = a.city.split(':'); const c = ROWS.find((x) => x['Region code'] === rc && x['City code'] === cc); const r = row([rc, c.Region, c.State, cc, c.City, 'Office', code, name, 'Corporate', 'no', 'live', 'Homebrew', a.hide ? 'no' : 'yes'].join('|')); ROWS.push(r); buildTables(); S.pOpen.add(rc); S.addBranch = null; S.undo = { text: `Added ${name} in ${c.City}.`, fn: () => { ROWS.splice(ROWS.indexOf(r), 1); buildTables(); } }; },
  csvPlaces: () => { download('ncm-places.csv', toCsv()); return false; },
  csvBlank: () => { download('ncm-places-template.csv', [COLS, ['99', 'My region', 'My state', 'MC', 'My city', 'Uptown', 'UPT', 'Uptown', 'District', 'yes', 'live', 'Homebrew', 'yes']].map((l) => l.map(csvCell).join(',')).join('\n')); return false; },
  csvAssigned: () => { download('ncm-numbers.csv', [['Number', 'Holder', 'Kind', 'Label', 'Alias of', 'State', 'Why', 'Saved by'], ...allLines().map(({ p, l }) => [fullForm(parse(l.n)), p.name, l.kind, l.label, p.aliasOf ? byId(p.aliasOf).name : '', l.off ? 'off' : 'on', l.why, l.holders.map((h) => byId(h).name).join('; ')])].map((x) => x.map(csvCell).join(',')).join('\n')); return false; },
  csvRetired: () => { download('ncm-retired.csv', [['Number', 'Was', 'Why', 'When'], ...RET.map((r) => [r.n, r.was, r.why, r.at])].map((x) => x.map(csvCell).join(',')).join('\n')); return false; },
  csvImport: () => { document.getElementById('tbfile').click(); return false; },
  csvSample: () => { S.plan = planImport(sampleCsv()); },
  planNo: () => { S.plan = null; },
  planYes: () => { const was = ROWS, ec = EXTRA_COLS; ROWS = S.plan.rows; EXTRA_COLS = S.plan.extra; S.plan = null; buildTables(); S.undo = { text: 'Table replaced from the file. No number anyone holds changed.', fn: () => { ROWS = was; EXTRA_COLS = ec; buildTables(); } }; },
  tbReset: () => { S.custom = false; S.list = '2045'; const was = ROWS; const held = ROWS.filter((r) => rowHeld(r) > 0 && !BOOK_ROWS.some((b) => rowKey(b) === rowKey(r))); ROWS = [...BOOK_ROWS.map((r) => ({ ...r })), ...held]; buildTables(); S.undo = { text: 'Back to the shipped table. No number anyone holds changed.', fn: () => { ROWS = was; buildTables(); } }; },
  shTab: (el) => { S.shTab = el.dataset.k; },
  shWhat: (el) => { S.shWhat = el.dataset.v; },
  shGo: () => { const p = byId(S.shP), l = p.lines[S.shLine] || p.lines[0]; const to = [...S.shTo]; const before = { mail: [...(EMAIL_KNOWN[p.id] || [])], holders: l ? [...l.holders] : [] }; let n = 0; for (const c of to) { if (S.shWhat !== 'number' && !holdsMail(p, c)) { (EMAIL_KNOWN[p.id] ??= []).push(c); n++; } if (S.shWhat !== 'email' && l && !l.holders.includes(c)) { l.holders.push(c); n++; } } S.undo = { text: n ? `Shared ${p.name} with ${to.map((c) => byId(c).name).join(', ')}. No second contact was made.` : 'They already had that. Nothing to add.', fn: () => { EMAIL_KNOWN[p.id] = before.mail; if (l) l.holders = before.holders; } }; },
  mxMail: (el) => { const a = (EMAIL_KNOWN[el.dataset.p] ??= []); const i = a.indexOf(el.dataset.c); if (i >= 0) a.splice(i, 1); else a.push(el.dataset.c); },
  mxNum: (el) => { const l = byId(el.dataset.p).lines[0]; const i = l.holders.indexOf(el.dataset.c); if (i >= 0) l.holders.splice(i, 1); else l.holders.push(el.dataset.c); },
  cfGen: () => { delete S.prop.or; },
  plDial: (el) => { toast('Dial box opens with ' + seenFrom(parse(el.dataset.n))); return false; },
  plSave: () => { S.saved = true; },
  plTrace: () => { S.traced = true; },
};
const CH = {
  orgPick: (el) => { if (el.value) orgDecide(el.dataset.org, el.value, 'Everyone whose Organization reads ' + el.dataset.org + ' now goes to ' + el.value + '. No contact was changed.'); },
  show: (el) => { S.show = el.value; }, group: (el) => { S.group = el.value; },
  propDist: (el) => { const p = byId(el.dataset.id); const [c, x] = el.value.split('/'); const r = homeRows().find((y) => y['City code'] === c && y.Code === x); if (r) S.prop[p.id] = suggest(p, {}, r); },
  chgPush: (el) => { S.change.push = el.checked; },
  bulkAll: (el) => { S.bulkAll = el.checked; freshBulk(); },
  bulkTick: (el) => { if (el.checked) S.bulkOff.delete(el.dataset.id); else S.bulkOff.add(el.dataset.id); },
  bulkDist: (el) => { const id = el.dataset.id; const [c, x] = el.value.split('/'); const r = homeRows().find((y) => y['City code'] === c && y.Code === x); if (r) S.bulk[id] = suggest(byId(id), {}, r); },
  boardCity: (el) => { S.boardCity = el.value; S.tile = null; },
  trPick: (el) => { const [rc, c] = S.boardCity.split(':'); const r = ROWS.find((x) => x['Region code'] === rc && x['City code'] === c && (x.Code || '-') === el.dataset.k); r['Players can pick'] = el.checked ? 'yes' : 'no'; buildTables(); },
  trList: (el) => { const [rc, c] = S.boardCity.split(':'); const r = ROWS.find((x) => x['Region code'] === rc && x['City code'] === c && (x.Code || '-') === el.dataset.k); r.Listed = el.checked ? 'yes' : 'no'; },
  tryAs: (el) => { S.tryAs = el.value; },
  home: (el) => { const [rc, city] = el.value.split(':'); HOME = { rc, city }; buildTables(); S.boardCity = el.value; S.pOpen.add(rc); },
  era: (el) => { const v = el.value; if (v === 'custom') { S.listAsk = null; return; } if (S.custom) { S.listAsk = v; return; } applyList(v); },
  extra: (el) => { LIMITS.extra = Number(el.value); },
  rowPick: (el) => { ROWS[Number(el.dataset.i)]['Players can pick'] = el.checked ? 'yes' : 'no'; buildTables(); },
  rowList: (el) => { ROWS[Number(el.dataset.i)].Listed = el.checked ? 'yes' : 'no'; },
  apRc: (el) => { S.addPlace.rc = el.value; },
  abCorp: (el) => { S.addBranch.corp = el.value; }, abCity: (el) => { S.addBranch.city = el.value; }, abHide: (el) => { S.addBranch.hide = el.checked; },
  spTo: (el) => { S.spCall = { to: el.value }; },
  spAct: (el) => { SPECIAL.find((y) => y.id === S.spSel).act = el.value; },
  spTrace: (el) => { SPECIAL.find((y) => y.id === S.spSel).trace = el.value; },
  spMacro: (el) => { SPECIAL.find((y) => y.id === S.spSel).macro = el.value; },
  spAlert: (el) => { SPECIAL.find((y) => y.id === S.spSel).alert = el.checked; },
  spAllow: (el) => { const x = SPECIAL.find((y) => y.id === S.spSel); if (el.checked) x.allow.push(el.dataset.id); else x.allow = x.allow.filter((a) => a !== el.dataset.id); },
  whoShow: (el) => { S.whoShow = el.value; },
  shP: (el) => { S.shP = el.value; S.shLine = 0; }, shLine: (el) => { S.shLine = Number(el.value); },
  shTo: (el) => { if (el.checked) S.shTo.add(el.dataset.id); else S.shTo.delete(el.dataset.id); },
};
for (const k of ['edSave', 'tbHide', 'apGo', 'abGo', 'delRow', 'planYes']) { const f = ACT[k]; ACT[k] = (el) => { const r = f(el); if (r !== false) S.custom = true; return r; }; }
for (const k of ['rowPick', 'rowList', 'trPick', 'trList']) { const f = CH[k]; CH[k] = (el) => { f(el); S.custom = true; }; }
const INP_WK = { wkQ: (el) => { S.walk.q = el.value; return true; }, wkOwn: (el) => { S.walk.own = el.value.replace(/\D/g, '').slice(0, 4); return true; } };
const INP = { ...INP_WK,
  whoQ: (el) => { S.whoQ = el.value; return true; },
  q: (el) => { S.q = el.value; return true; }, boardQ: (el) => { S.boardQ = el.value; return true; }, rq: (el) => { S.rq = el.value; return true; }, tbq: (el) => { S.tbq = el.value; return true; },
  chgTyped: (el) => { S.change.typed = el.value; return true; },
  addLabel: (el) => { S.addLine.label = el.value; return false; },
  sp: (el) => { const x = SPECIAL.find((y) => y.id === S.spSel); x[el.dataset.k] = el.value; if (el.dataset.k === 'num' || el.dataset.k === 'name') syncSpecial(); return true; },
  tryN: (el) => { S.tryN = el.value; document.getElementById('try-out').innerHTML = tryPanes(); return false; },
  ap: (el) => { S.addPlace[el.dataset.k] = el.value; const form = addPlaceForm(); const box = document.createElement('div'); box.innerHTML = form; document.getElementById('ap-out').innerHTML = box.querySelector('#ap-out').innerHTML; return false; },
};
document.addEventListener('click', (e) => {
  const bar = e.target.closest('.mk-bar button');
  if (bar) { if (bar.dataset.f) { S.f = bar.dataset.f; if (S.f === 'bulk') freshBulk(); } if (bar.dataset.t) S.t = bar.dataset.t; if (bar.dataset.w) S.w = bar.dataset.w; draw(); return; }
  const el = e.target.closest('[data-do]');
  if (!el || !stage.contains(el) || el.disabled) return;
  const r = ACT[el.dataset.do]?.(el);
  if (r !== false) draw();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'tbfile') { const f = e.target.files?.[0]; if (f) f.text().then((t) => { S.plan = planImport(t); draw(); }); return; }
  const h = e.target.dataset?.ch; if (h && CH[h]) { CH[h](e.target); draw(); }
});
document.addEventListener('input', (e) => { const h = e.target.dataset?.in; if (h && INP[h] && INP[h](e.target)) draw(); });
document.addEventListener('mouseover', (e) => {
  const n = e.target.closest?.('[data-pn]'); if (n) { showPop(n); tipEl.hidden = true; return; }
  if (!e.target.closest?.('.ncm-pn-pop')) hidePop();
  const t = e.target.closest?.('[data-tooltip]'); if (!t) { tipEl.hidden = true; return; }
  tipEl.textContent = t.dataset.tooltip; tipEl.hidden = false; const r = t.getBoundingClientRect(), pr = tipEl.getBoundingClientRect();
  tipEl.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - pr.width / 2, innerWidth - pr.width - 6))}px`; tipEl.style.top = `${r.top - pr.height - 6 < 4 ? r.bottom + 6 : r.top - pr.height - 6}px`;
});
document.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-pn]')) showPop(e.target); });
document.addEventListener('focusout', (e) => { if (e.target.matches?.('[data-pn]')) hidePop(); });
let pop = null, popFor = null;
function hidePop() { pop?.remove(); pop = null; popFor = null; }
function showPop(el) {
  if (popFor === el) return; hidePop();
  const n = el.dataset.pn, p = parse(n); const rows = [];
  if (p.service) rows.push([specialOf(p.service)?.num || p.service, 'Special', p.name]);
  else { rows.push(['+' + p.rc, 'Region', REGIONS[p.rc].name]); if (stateOf(p)) rows.push(['', 'State', stateOf(p)]); rows.push([p.city, 'City', REGIONS[p.rc].cities[p.city].name]); if (p.ex) rows.push([p.ex, 'District', REGIONS[p.rc].cities[p.city].ex[p.ex] || '']); rows.push([p.line, 'Line', '']); }
  const h = p.key ? holderOf(p.key) : null, ret = p.key ? isRetired(p.key) : null, r = p.key ? rowOfNum(p) : null;
  const gm = [h ? `Held by <b>${esc(h.p.name)}</b>${h.p.aliasOf ? ` (alias of ${esc(byId(h.p.aliasOf).name)})` : ''}` : ret ? `Retired: ${esc(ret.was)}` : p.service ? '' : 'Nobody holds this', r?.Listed === 'no' ? 'Players see Unlisted number' : ''].filter(Boolean);
  pop = document.createElement('div'); pop.className = 'ncm-pn-pop'; pop.innerHTML = `<div class="big">${esc(p.service ? (specialOf(p.service)?.num || p.service) : fullForm(p))}</div>${rows.map(([c, k, v]) => `<div class="r2"><code>${esc(c)}</code><small>${k}</small><span>${esc(v)}</span></div>`).join('')}${gm.length ? `<div class="gm">${gm.join('<br>')}</div>` : ''}`;
  win.appendChild(pop); popFor = el;
  const a = el.getBoundingClientRect(), b = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(a.left, innerWidth - b.width - 8))}px`; pop.style.top = `${a.bottom + b.height + 8 > innerHeight ? Math.max(8, a.top - b.height - 6) : a.bottom + 6}px`;
}
draw();
window.NCM_R2 = { orgMatch, ORG_MAP: () => ORG_MAP, wkRow, S, parse, suggest, flagsOf, byId, PEOPLE, draw, ROWS: () => ROWS, RET: () => RET, tryResult, officeRow, rowForLoc, REQUESTS: () => REQUESTS, HOME: () => HOME };
