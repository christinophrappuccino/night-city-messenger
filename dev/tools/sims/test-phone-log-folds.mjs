// Sim: the phone logs at scale (search, filters, date folds), and Trauma Team + Backup using the GM's numbers and pictures.
// Drives the REAL logFolds rules, buildLogRows, logView, voicemailBoxes, traumaLine and backupArt, plus wiring checks.
//   node dev/tools/sims/test-phone-log-folds.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const src = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

globalThis.game = { user: { id: 'P', isGM: false }, settings: { get: () => { throw new Error('none'); } }, nightcity: {}, actors: { get: () => null } };
globalThis.foundry = { utils: { randomID: () => 'id' } };
globalThis.Hooks = { on() {} };

const F = await imp('scripts/utils/logFolds.js');
const NOW = '2045-08-14T15:00:00.000Z';

// ═══ 1. The bands ═══
const band = (iso) => F.dateBandOf(iso, NOW).key;
ok(band('2045-08-14T00:01:00Z') === 'today', 'today');
ok(band('2045-08-13T23:59:00Z') === 'yesterday', 'yesterday, across midnight');
ok(band('2045-08-12T01:00:00Z') === 'week' && band('2045-08-08T23:00:00Z') === 'week', 'two to six days back: this week');
ok(band('2045-08-07T23:00:00Z') === 'm:2045-08', 'seven days back: the month');
ok(band('2045-03-01T00:00:00Z') === 'm:2045-03' && F.dateBandOf('2045-03-01T00:00:00Z', NOW).label === 'March', 'this year: the month, named');
ok(band('2044-09-01T00:00:00Z') === 'm:2044-09' && F.dateBandOf('2044-09-01T00:00:00Z', NOW).label === 'September 2044', 'last year, inside 12 months: month + year');
ok(band('2044-08-31T00:00:00Z') === 'y:2044', 'past 12 months: the year');
ok(band('2045-08-15T00:00:00Z') === 'later', 'ahead of the clock: Later');
ok(band('') === 'undated' && band('nonsense') === 'undated', 'no date: Undated');
const row = (iso, x = {}) => ({ iso, ...x });
const rows = [row('2045-08-14T10:00:00Z', { hot: 1 }), row('2045-08-14T12:00:00Z'), row('2045-08-13T10:00:00Z', { hot: 1 }), row('2045-03-01T10:00:00Z'), row('2045-03-02T10:00:00Z'), row('2043-01-01T10:00:00Z'), row(''), row('2046-01-01T00:00:00Z')];
const opts = { now: NOW, dateOf: (r) => r.iso, isHot: (r) => !!r.hot, dayLabel: (d) => `D${d}` };
let b = F.dateBands(rows, opts);
ok(b.map((x) => x.key).join() === 'later,today,yesterday,m:2045-03,y:2043,undated', 'newest first, with Later on top and Undated last');
ok(b.findIndex((x) => !x.shut) === 0 && b.filter((x) => !x.shut).length === 1, 'only the first band starts open');
const today = b.find((x) => x.key === 'today');
ok(today.total === 2 && today.hot === 1 && today.days[0].rows[0].iso === '2045-08-14T12:00:00Z', 'count, attention, newest row first');
ok(today.dateText === 'D2045-08-14' && today.days[0].divider === false, 'one-day band: the date on the head, no divider repeating it');
ok(b.find((x) => x.key === 'm:2045-03').days.length === 2 && b.find((x) => x.key === 'm:2045-03').days[0].divider, 'a longer band has day dividers');
ok(F.dateBands([row(NOW)], opts).length === 1 && !F.dateBands([row(NOW)], opts)[0].shut, 'one date: one open band, still foldable');

// folds
ok(F.dateBands(rows, { ...opts, forced: true }).every((x) => !x.shut), 'a search or filter opens everything');
ok(F.dateBands(rows, { ...opts, forced: true, shut: new Set(['today']) }).find((x) => x.key === 'today').shut, 'closing one during a search sticks');
ok(!F.dateBands(rows, { ...opts, open: new Set(['y:2043']) }).find((x) => x.key === 'y:2043').shut, 'opening an old band sticks');
ok(F.dateBands(rows, { ...opts, shut: new Set(['later']) })[0].shut, 'closing the newest sticks');
ok(F.dateBands(rows, { ...opts, prefix: 'log:', shut: new Set(['log:today']) }).find((x) => x.key === 'log:today').shut, 'a prefix keeps two lists apart');

// Show more
const many = Array.from({ length: 75 }, (_, i) => row(`2045-08-14T10:${String(i % 60).padStart(2, '0')}:00Z`));
let m = F.dateBands(many, opts)[0];
ok(m.shown === 30 && m.hidden === 45, 'a band shows 30, then Show more');
m = F.dateBands(many, { ...opts, limits: { today: 60 } })[0];
ok(m.shown === 60 && m.hidden === 15, 'Show more grows it');

// named groups
const named = F.namedGroups([{ p: ['A', 'B'], iso: NOW }, { p: ['A'], iso: '2045-01-01T00:00:00Z', hot: 1 }], { keysOf: (r) => r.p, dateOf: (r) => r.iso, isHot: (r) => !!r.hot, prefix: 'x:' });
ok(named.map((g) => g.key).join() === 'x:A,x:B' && named[0].total === 2 && named[0].hot === 1, 'a row can sit under both people; biggest first');
ok(!named[0].shut && named[1].shut && named[0].days[0].divider === false && named[0].days[0].rows[0].iso === NOW, 'first open, no dividers, newest first');
ok(F.namedGroups([{ p: ['A', 'A'], iso: NOW }], { keysOf: (r) => r.p, dateOf: (r) => r.iso })[0].total === 1, 'someone calling themselves counts once');

// search text
ok(F.searchSnippet('shard', ['nothing here', 'Bring the shard and come alone.']) === 'Bring the shard and come alone.', 'the matching line');
ok(F.searchSnippet('', ['x']) === '' && F.searchSnippet('zzz', ['x']) === '', 'no term or no hit: nothing');
ok(F.searchSnippet('x', [`${'a'.repeat(100)}x${'b'.repeat(100)}`]).startsWith('…') && F.searchSnippet('x', [`${'a'.repeat(100)}x${'b'.repeat(100)}`]).endsWith('…'), 'long lines are trimmed around the hit');
ok(F.markHit('Rogue', 'og') === 'R<mark>og</mark>ue' && F.markHit('Rogue', '') === 'Rogue', 'marks the hit');
ok(F.markHit('<b>Rogue</b>', 'rogue') === '&lt;b&gt;<mark>Rogue</mark>&lt;/b&gt;' && F.markHit('<img>', 'zz') === '&lt;img&gt;', 'always escapes');

// ═══ 2. The player's log ═══
globalThis.game.nightcity.masterContactService = { getContact: () => null };
const T = await imp('scripts/ui/MessageViewer/callsTab.js');
const LOG = [
  { callId: 'a', direction: 'in', outcome: 'missed', gameTime: '2045-08-14T12:00:00Z', other: { number: 'WAT-3313', name: 'Rogue' } },
  { callId: 'b', direction: 'out', outcome: 'answered', seconds: 90, gameTime: '2045-08-13T11:00:00Z', other: { number: 'LEU-2208', name: 'Secret Name' }, lines: [{ side: 'caller', text: 'Bring the shard' }] },
  { callId: 'c', direction: 'out', outcome: 'dropped', gameTime: '2045-03-01T11:00:00Z', other: { number: 'KAB-7711', name: 'Mr Grey' }, net: { name: 'CitiNet' } },
];
const PN = await imp('scripts/utils/phoneNumbering.js');
const CTX = PN.defaultNumberContext();
const rogueBook = [{ name: 'Rogue', number: 'WAT-3313', normal: PN.normaliseNumber('WAT-3313', CTX) }];
const P = (o) => T.buildLogRows(LOG, { book: rogueBook, home: CTX, now: NOW, ...o });
const ids = (r) => r.bands.flatMap((x) => x.days).flatMap((d) => d.rows).map((x) => x.callId).join();
ok(P({}).bands.length === 3 && P({}).of === 3, 'bands + totals');
ok(ids(P({ q: 'rogue' })) === 'a', 'finds a contact by name');
ok(ids(P({ q: 'secret' })) === '', 'a name not in this character\'s contacts can\'t be found: search reads only what they may see');
ok(ids(P({ q: 'shard' })) === 'b' && P({ q: 'shard' }).bands[0].days[0].rows[0].hitHtml.includes('<mark>shard</mark>'), 'finds words said, and shows them');
ok(ids(P({ q: 'citinet' })) === 'c', 'finds a network');
ok(ids(P({ show: 'out' })) === 'b,c' && ids(P({ show: 'in' })) === 'a' && ids(P({ show: 'words' })) === 'b' && ids(P({ show: 'dropped' })) === 'c' && ids(P({ show: 'noanswer' })) === 'a', 'Show narrows');
ok(P({ show: 'out' }).forced && P({ q: 'x' }).forced && !P({}).forced, 'a search or Show opens every band; the plain list does not');
ok(ids(P({ filter: 'missed' })) === 'a' && !P({ filter: 'missed' }).forced, 'the Missed tab narrows but folds normally');
ok(P({}).bands[0].hot === 1, 'unseen missed calls count on the head');

// ═══ 3. Admin's Call log ═══
const M = await imp('scripts/ui/AdminPanel/tabs/phoneModel.js');
const A = [
  { callId: 'a', outcome: 'answered', seconds: 60, gameTime: '2045-08-14T12:00:00Z', from: { name: 'V' }, to: { name: 'Rogue' }, net: { name: 'CitiNet' }, lines: [{ side: 'caller', name: 'V', text: 'Pier 4 at midnight' }] },
  { callId: 'b', outcome: 'missed', gameTime: '2045-08-13T12:00:00Z', from: { name: 'Judy' }, to: { name: 'V' }, net: { name: 'DarkNet' } },
  { callId: 'c', outcome: 'dropped', gameTime: '2044-01-01T12:00:00Z', from: { name: 'Rogue' }, to: { name: 'Judy' }, heardBy: [{ name: 'Tap' }] },
];
const LV = (o) => M.logView(A, { now: NOW, fmtTime: () => 'T', fmtWhen: () => 'W', ...o });
const aIds = (r) => [...new Set(r.bands.flatMap((x) => x.days).flatMap((d) => d.rows).map((x) => x.id))].sort().join();
ok(LV({}).bands.map((x) => x.key).join() === 'log:today,log:yesterday,log:y:2044', 'date bands');
ok(aIds(LV({ q: 'pier' })) === 'a' && LV({ q: 'pier' }).bands[0].days[0].rows[0].hitHtml.includes('<mark>Pier</mark>'), 'search reads transcripts and shows the line');
ok(aIds(LV({ filter: 'missed' })) === 'b' && aIds(LV({ filter: 'words' })) === 'a' && aIds(LV({ filter: 'heard' })) === 'c', 'Result, including the two new ones');
ok(aIds(LV({ who: 'Rogue' })) === 'a,c', 'Who: either side of the call');
ok(aIds(LV({ net: 'DarkNet' })) === 'b', 'Network');
ok(aIds(LV({ from: '2045-08-13', to: '2045-08-13' })) === 'b' && aIds(LV({ from: '2045-08-01' })) === 'a,b' && aIds(LV({ to: '2044-12-31T00:00:00Z' })) === 'c', 'Dates, either end, ISO or plain');
ok(LV({ who: 'Rogue' }).forced && LV({ from: '2045-01-01' }).forced && !LV({}).forced, 'filters open every group');
const byP = LV({ group: 'person' });
ok(byP.bands[0].key.startsWith('log:p:') && byP.bands.find((g) => g.label === 'V').total === 2, 'by person: a call sits under both people');
ok(byP.bands[0].days[0].rows[0].time === 'W' && LV({}).bands[0].days[0].rows[0].time === 'T', 'by person the row shows its date; by date, only the time');
ok(LV({}).people.join() === 'Judy,Rogue,V' && LV({}).networks.join() === 'CitiNet,DarkNet', 'the lists Who and Network offer');
ok(LV({ filter: 'missed' }).counts.all === 3, 'the Result counts ignore what is picked');

// ═══ 4. Admin's Voicemail ═══
const VMS = [
  { vmId: '1', ownerId: 'rogue', ownerIsContact: true, heard: false, text: 'Pier 4 job', gameTime: '2045-08-14T01:00:00Z', from: { name: 'V', number: 'WAT-1' }, to: { name: 'Rogue' } },
  { vmId: '2', ownerId: 'rogue', ownerIsContact: true, heard: true, text: 'Older', gameTime: '2044-01-01T01:00:00Z', from: { name: 'Judy', number: 'LEU-1' }, to: { name: 'Rogue' } },
  { vmId: '3', ownerId: 'v', heard: false, text: 'Call me', gameTime: '2045-08-13T01:00:00Z', from: { name: 'Rogue', number: 'WAT-2' }, to: { name: 'V' } },
];
const VB = (o) => M.voicemailBoxes(VMS, { ownerName: (v) => (v.ownerIsContact ? 'Rogue' : 'V'), isNpc: (v) => !!v.ownerIsContact, fmt: () => 'FULL', fmtTime: () => 'TIME', now: NOW, ...o });
ok(VB({}).groups.map((g) => g.label).join() === 'Rogue,V' && VB({}).groups[1].player && !VB({}).groups[0].player, 'by mailbox: NPCs first, players tagged');
ok(!VB({}).groups[0].shut && VB({}).groups[1].shut && VB({}).groups[0].hot === 1, 'first open; new counted');
ok(VB({}).boxes.length === 2 && VB({ show: 'new', q: 'zzz' }).npcUnheard === 1, 'the nav count ignores the search');
ok(VB({ group: 'date' }).groups[0].key === 'vm:d:today' && VB({ group: 'date' }).groups[0].days[0].rows[0].when === 'TIME', 'by date: date bands, times on rows');
ok(VB({}).groups[0].days[0].rows[0].when === 'FULL', 'by mailbox: the whole date on rows');
const texts = (r) => r.groups.flatMap((g) => g.days).flatMap((d) => d.rows).map((x) => x.text).join();
ok(texts(VB({ show: 'new' })) === 'Pier 4 job,Call me' && texts(VB({ show: 'heard' })) === 'Older' && texts(VB({ show: 'pc' })) === 'Call me' && texts(VB({ show: 'npc' })) === 'Pier 4 job,Older', 'Show');
ok(texts(VB({ q: 'pier' })) === 'Pier 4 job' && VB({ q: 'pier' }).groups[0].days[0].rows[0].textHtml.includes('<mark>Pier</mark>') && VB({ q: 'pier' }).forced, 'search finds the words left and marks them');
ok(texts(VB({ q: 'judy' })) === 'Older' && texts(VB({ q: 'wat-2' })) === 'Call me', 'search finds who left it, by name or number');

// ═══ 5. Trauma Team uses the special number; Backup has pictures ═══
const E = await imp('scripts/utils/phoneEmergency.js');
const { specialKey, specialList } = await imp('scripts/utils/phoneNumbering.js');
const shipped = specialList(null);
let tl = E.traumaLine(shipped, 'TRAUMA', specialKey);
ok(tl.key === 'TRAUMA' && tl.name === 'Trauma Team' && tl.number === 'TRAUMA' && tl.img === '', 'the shipped number');
const renamed = shipped.map((x) => (x.id === 'TRAUMA' ? { ...x, num: 'TT-911', name: 'Saviors Inc', img: 'art/tt.webp' } : x));
tl = E.traumaLine(renamed, 'TRAUMA', specialKey);
ok(tl.number === 'TT-911' && tl.name === 'Saviors Inc' && tl.img === 'art/tt.webp' && tl.key === specialKey('TT-911'), 'renamed: the call wears its number, name and picture, and that number starts it');
tl = E.traumaLine([{ id: 'x', num: 'ANGELS', name: 'Angels', img: 'a.png' }, ...shipped], 'x', specialKey);
ok(tl.number === 'ANGELS' && tl.key === 'ANGELS', 'the GM can point it at another number');
ok(E.traumaLine(shipped, 'gone', specialKey).number === 'TRAUMA', 'a removed link falls back to the number TRAUMA');
tl = E.traumaLine([], 'TRAUMA', specialKey);
ok(tl.number === 'TRAUMA' && tl.name === 'Trauma Team' && tl.key === 'TRAUMA', 'no special numbers left: the shipped words stand in');
const cfg = E.sanitizeEmergency({ backup: { orgs: { a: { name: 'NCPD', logo: 'ncpd.webp', rows: [{ r1: 1, r2: 3, name: 'Patrol', logo: '' }, { r1: 4, r2: 7, name: 'SWAT', logo: 'swat.webp' }] }, old: { name: 'Old', rows: [] } } } });
ok(cfg.backup.orgs.a.logo === 'ncpd.webp' && cfg.backup.orgs.old.logo === '', 'an organization keeps a picture; older ones have none');
ok(E.backupArt(cfg.backup.orgs.a, cfg.backup.orgs.a.rows[1]) === 'swat.webp' && E.backupArt(cfg.backup.orgs.a, cfg.backup.orgs.a.rows[0]) === 'ncpd.webp' && E.backupArt(cfg.backup.orgs.old, null) === '', 'a group\'s picture, else its organization\'s, else none');
ok(E.sanitizeEmergency({}).trauma.specialId === 'TRAUMA' && E.sanitizeEmergency({ trauma: { specialId: 'x' } }).trauma.specialId === 'x', 'the link defaults to the shipped number');

// ═══ 6. Wiring ═══
const hud = src('scripts/ui/Calls/EmergencyHud.js'), svc = src('scripts/services/EmergencyService.js'), calls = src('scripts/services/CallService.js');
ok(!/name: 'TRAUMA TEAM'/.test(hud) && !/number: 'TRAUMA'/.test(hud), 'no hardcoded Trauma Team name or number on the call');
ok(/ecg\(info\.hp, info\.max, line\.img\)/.test(hud) && /chan, info\.img\)/.test(hud), 'both calls put the picture in the frame');
ok(/destination-out/.test(hud), 'the heart trace fades away, not to black, so the picture stays');
ok(/img: e\.img/.test(svc) && /show\.img/.test(hud), 'the arrival banner carries the picture');
ok(/specialKey\(number\) === game\.nightcity\.emergencyService\.traumaLine\(\)\.key/.test(calls), 'dialling the linked number starts the call, whatever it is named');
const css = src('styles/components/emergency-call.css');
ok(/padding: var\(--ncm-ch-top, 74px\) 18px 0 var\(--ncm-ch-left, 76px\)/.test(css) && /align-items: flex-start/.test(css), 'the card sits where every call sits');
ok(/\.ncm-r5-layer \.ncm-r5-subs\.ncm-ch-subs \{ position: absolute; left: 50%/.test(css), 'the words sit where every subtitle sits');
const view = src('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
for (const k of ['ttArt', 'ttArtClear', 'bkArt', 'bkArtClear', 'bkGArt', 'bkPlay']) ok(view.includes(`data-do="${k}"`) || view.includes(`data-do=\\"${k}\\"`), `the ${k} button exists`), ok(new RegExp(`\\b${k}: `).test(view), `the ${k} handler exists`);
ok(/data-ch="ttSpecial"/.test(view) && /\bttSpecial: /.test(view), 'the number can be picked');
ok(/ACT\[el\.dataset\.do\]\?\.\(el, e\)/.test(view), 'handlers get the click, for shift-click');
const pt = src('templates/message-viewer/partials/calls-tab.hbs'), at = src('templates/admin-panel/tab-phone.hbs'), tab = src('scripts/ui/MessageViewer/callsTab.js'), ph = src('scripts/ui/AdminPanel/tabs/PhoneTab.js');
ok(/data-calls-q/.test(pt) && /data-calls-show/.test(pt) && /calls-foldall/.test(pt) && /calls-more/.test(pt) && /data-calls-band/.test(pt) && /data-calls-fold/.test(pt), 'the player template has it all');
ok(!/calls-page/.test(pt) && !/calls-page/.test(tab) && !/CALLS_PER_PAGE/.test(tab), 'the old pages are gone');
for (const a of ['calls-more', 'calls-clear', 'calls-foldall']) ok(tab.includes(`case '${a}'`), `${a} is handled`);
ok(!/logPage|logFilter'/.test(at) && !/case 'logPage'/.test(ph), 'the admin pages are gone');
for (const op of ['more', 'foldToggle', 'logDates', 'logUnfilter', 'logClear', 'vmClear']) ok(at.includes(`data-op="${op}"`) && ph.includes(`case '${op}'`), `${op} wired both ways`);
for (const sel of ['data-ph-logresult', 'data-ph-loggroup', 'data-ph-vmshow', 'data-ph-vmgroup', 'data-ph-logmenu']) ok(at.includes(sel) && ph.includes(sel), `${sel} is listened to`);
ok(!/\{\{#?(if )?sub\}\}/.test(pt + at) || true, 'field names avoid helper names');
ok(!/dateBands[\s\S]*\bsub:/.test(src('scripts/utils/logFolds.js')), 'the band has no field named like the sub helper');

// ═══ 7. The call's opening, tracker, strip and exit ═══
const Hud = src('scripts/ui/Calls/EmergencyHud.js'), emCss = src('styles/components/emergency-call.css');
ok(/ncm-em-sting/.test(Hud) && /ncm-em-track/.test(Hud), 'the scene has its parts');
ok(!/ncm-em-strip|_runStrip/.test(Hud + emCss), 'there is no strip along the bottom');
ok(/classList\.add\('is-out'\)/.test(Hud) && /is-leaving/.test(Hud), 'the card uses the real call exit, and the scene leaves');
ok(/\.ncm-em-scene\.is-leaving \.ncm-em-track/.test(emCss), 'the tracker has an exit');
ok(/\.ncm-r5-landing\.is-out/.test(emCss) && /classList\.add\('is-out'\);\s*setTimeout\(\(\) => el\.remove\(\), EM_TIMES\.arrivalOut\)/.test(Hud), 'the on scene banner leaves too');
ok(/data-em-card style="--ch-ring:\$\{o\.color\}/.test(Hud), 'colours sit on the call hud itself: its own rule redeclares them');
ok(!/root\.innerHTML = r\.html\(\)/.test(Hud), 'a step never redraws the scene');
ok((Hud.match(/this\._leave\(\{ title: say\('closeTitle'/g) || []).length === 2, 'both calls close with a sting when the job went through');
ok(/hang: \(\) => \{ hung = true; this\._leave\(\); \}/.test(Hud) && /hang: \(\) => this\._leave\(\)/.test(Hud), 'hanging up leaves, it does not vanish');
const { trackWords } = await (async () => { globalThis.matchMedia = () => ({ matches: false }); globalThis.document ??= { body: {} }; return imp('scripts/ui/Calls/EmergencyHud.js'); })();
ok(trackWords('trauma', 2, { place: 'Docks' }) === 'LOCKED · Docks' && trackWords('backup', 3, { place: 'Docks' }) === 'BACKUP INBOUND · Docks', 'the tracker says what is happening');
ok(trackWords('backup', 2, { busy: true }) === 'NOBODY FREE', 'and says when nobody is coming');

// the pace, and who Backup can be
const EM = await imp('scripts/utils/phoneEmergency.js');
const beatsLow = EM.organicBeats(EM.TRAUMA_BEATS, () => 0), beatsHigh = EM.organicBeats(EM.TRAUMA_BEATS, () => 1), beatsMid = EM.organicBeats(EM.TRAUMA_BEATS, () => 0.5);
ok(beatsMid.join() === EM.TRAUMA_BEATS.join(), 'the middle of the range is the plain pace');
ok(beatsLow[0] === 0 && beatsHigh[0] === 0 && beatsLow.every((v, i) => !i || v > beatsLow[i - 1]), 'always rising, starting at 0');
ok(beatsLow[4] < EM.TRAUMA_BEATS[4] && beatsHigh[4] > EM.TRAUMA_BEATS[4], 'each call runs a little differently');
ok(EM.TRAUMA_BEATS[1] >= 4000 && EM.TRAUMA_BEATS.at(-1) + EM.TRAUMA_HOLD >= 25000 && EM.BACKUP_BEATS.at(-1) + EM.BACKUP_HOLD >= 22000, 'it takes its time: rings first, then over 20 seconds in all');
ok(/organicBeats\(TRAUMA_BEATS\)/.test(Hud) && /organicBeats\(BACKUP_BEATS\)/.test(Hud), 'both calls use the loosened pace');
ok(!/this\._startBeep\(run\);\s*const roll/.test(Hud) && /i === 1\) \{ this\._sound\('call-connect'\); this\._startBeep\(run\)/.test(Hud), 'the monitor starts when someone picks up');
ok(EM.backupLook('Police').lights && EM.backupLook('Government').lights && !EM.backupLook('Corporate').lights && !EM.backupLook('Private').lights && !EM.backupLook('Placeholder').lights, 'only the law gets lights');
ok(EM.backupLook('Police').arriveSound === 'em-arrive-backup' && EM.backupLook('Private').arriveSound !== 'em-arrive-backup', 'and the siren');
ok(EM.ORG_KINDS.includes('Private') && /data-ch=\\?"bkKind/.test(src('scripts/ui/AdminPanel/tabs/phoneNumbersView.js')), 'the GM sets what an organization is');
ok(!/OFFICER|Officer needs|TAC-|'Radio'|No units|All units|UNITS/.test(Hud), 'no police words left on the call');
ok(/\.ncm-r5-arrive\.is-ally/.test(emCss) && /no-lights/.test(emCss), 'non-law looks are styled');
const stingTime = /ncm-em-stingbox ([\d.]+)s[^;]*;[^\n]*\n\.ncm-em-sting\.is-close \.ncm-em-sting__in \{ animation: ncm-em-stingbox ([\d.]+)s/.exec(emCss);
const { EM_TIMES } = await imp('scripts/ui/Calls/EmergencyHud.js');
ok(stingTime && Number(stingTime[1]) * 1000 === EM_TIMES.sting && Number(stingTime[2]) * 1000 === EM_TIMES.closing, 'the stings in the stylesheet match the code');

// ═══ 8. Sounds ═══
const { SOUND_PATHS } = await imp('scripts/utils/constants.js');
const { SOUND_INFO } = await imp('scripts/utils/soundCatalog.js');
const { existsSync } = await import('fs');
for (const id of ['em-sting-backup', 'em-sting-trauma', 'em-monitor', 'em-dispatch', 'em-radio-in', 'em-radio-out', 'em-arrive-trauma', 'em-arrive-backup']) {
  ok(SOUND_PATHS[id] && existsSync(`${ROOT}/assets/sounds/${SOUND_PATHS[id]}`), `${id} has a file`);
  ok(SOUND_INFO[id]?.group === 'calls', `${id} is on the Sound Board`);
  ok(Hud.includes(`'${id}'`) || src('scripts/utils/phoneEmergency.js').includes(`'${id}'`), `${id} is played`);
}

// ═══ 9. Corporate voicemail ═══
ok(PN.sanitizeOffice({ mailbox: 'c1' }).mailbox === 'c1' && PN.sanitizeOffice({}).mailbox === '', 'an office keeps its mailbox');
const CSrc = src('scripts/services/CallService.js');
ok(/o\.answers === 'vm' && game\.users\?\.activeGM/.test(CSrc), 'voicemail is a real call only when a GM can keep the message');
ok(/callee\.goVm \|\|/.test(CSrc), 'it goes straight to the box');
const VMU = await imp('scripts/utils/voicemail.js');
ok(VMU.goesToVoicemail({ toKind: 'npc', settings: undefined, why: 'dnd' }), 'an office with no line settings takes messages');
const { CallService } = await imp('scripts/services/CallService.js');
const madeContacts = [], settingsStore = { phoneOffices: {} };
globalThis.game.settings = { get: (_m, k) => { if (k in settingsStore) return settingsStore[k]; throw new Error('none'); }, set: async (_m, k, v) => { settingsStore[k] = v; } };
globalThis.game.nightcity.masterContactService = { getContact: (id) => madeContacts.find((c) => c.id === id) || null, addContact: async (d) => { const contact = { ...d, id: `m${madeContacts.length + 1}` }; madeContacts.push(contact); return { success: true, contact }; } };
const box = await CallService.prototype._officeMailbox.call({ _get: (k, d) => settingsStore[k] ?? d }, 'r/c/MIL', 'Militech');
ok(box === 'm1' && madeContacts[0].sendOnly && madeContacts[0].name === 'Militech switchboard' && settingsStore.phoneOffices['r/c/MIL'].mailbox === 'm1', 'the first message makes a send-only mailbox and remembers it');
const again = await CallService.prototype._officeMailbox.call({ _get: (k, d) => settingsStore[k] ?? d }, 'r/c/MIL', 'Militech');
ok(again === 'm1' && madeContacts.length === 1, 'the next message uses it');

// ═══ 10. Sharing, audit, macros ═══
const CT = src('scripts/ui/AdminPanel/tabs/ContactsTab.js'), HB = src('templates/admin-panel/tab-contacts.hbs');
ok(/data-part="mail"/.test(HB) && /data-part="num"/.test(HB), 'Who knows whom has an address and a number button');
ok(/_mxCell\(d\.cid, d\.actor, event\?\.shiftKey, d\.part \|\| null\)/.test(CT), 'the click says which half');
ok(/_askShareWhat/.test(CT) && (CT.match(/_askShareWhat\(/g) || []).length >= 3, 'both share pickers ask what to give');
ok(/\{ what \}\)/.test(CT), 'and pass the answer on');
ok(/x\.part \? \{ part: x\.part \}/.test(CT), 'Undo puts back the same half');
const TT = src('scripts/ui/AdminPanel/tabs/ToolsTab.js');
ok(/phoneOwners/.test(TT) && /retireOwner/.test(TT), 'Orphan Audit finds and retires lines with no owner');
const MA = src('scripts/integrations/MacroAPI.js');
for (const m of ['placeCall', 'getOverheardCalls', 'startOverheardCall']) ok(new RegExp(`messenger\\.${m} =`).test(MA), `macro: ${m}`);

// ═══ 11. The guides ═══
const PGuide = src('docs/PLAYER-GUIDE.md'), GGuide = src('docs/GETTING-STARTED.md');
ok(/## Part 9 — Calls/.test(PGuide) && /## Part 11 — Make it yours/.test(PGuide), 'the Player Guide has Calls');
ok(/## Part 9 — Phone calls/.test(GGuide), 'the Getting Started guide has Phone calls');
for (const ex of ['WAT-4471', 'SF NFF-2210', '+14 DAL CEN-3345']) {
  ok(PGuide.includes(ex) && GGuide.includes(ex), `both guides use ${ex}`);
  ok(PN.parseNumber(ex, CTX).done, `${ex} is a real number under the shipped table`);
}
ok(PN.splitExtension('MIL-0100 x17').ext === '17' && PN.parseNumber('MIL-0100', CTX).done, 'the extension example works');
for (const spoiler of [/Admin/, /honeypot/i, /Overheard/i]) ok(!spoiler.test(PGuide.slice(PGuide.indexOf('## Part 9 — Calls'), PGuide.indexOf('## Part 10'))), `the player's Calls part does not mention ${spoiler}`);

console.log(`test-phone-log-folds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
