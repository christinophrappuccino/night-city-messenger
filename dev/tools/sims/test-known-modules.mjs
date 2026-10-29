// Players → Who they know: the modules (Orbit, Roles, Waiting, the Contact card) over the same list.
// Mock: dev/mockups/admin-who-they-know-modules-mock.html
import fs from 'node:fs';
const root = new URL('../../../', import.meta.url);
const M = await import(new URL('scripts/ui/AdminPanel/tabs/contactsModel.js', root));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

ok(M.knRing(0) === 0 && M.knRing(7) === 0 && M.knRing(8) === 1 && M.knRing(30) === 1 && M.knRing(31) === 2 && M.knRing(null) === 3, 'rings: week / month / longer / never');
const rows = [
  { id: 'a', name: 'Rogue', role: 'fixer', roleLabel: 'Fixers', roleIcon: 'fas fa-handshake', days: 0, waiting: 2, mail: 14 },
  { id: 'b', name: 'Dex', role: 'fixer', roleLabel: 'Fixers', roleIcon: 'fas fa-handshake', days: 12, waiting: 0, mail: 3 },
  { id: 'c', name: 'Goro', role: 'corp', roleLabel: 'Corpos', roleIcon: 'fas fa-briefcase', days: 2, waiting: 1, mail: 7 },
  { id: 'd', name: 'Royce', role: 'solo', roleLabel: 'Solos', roleIcon: 'fas fa-crosshairs', days: null, waiting: 0, mail: 0 },
  { id: 'e', name: 'Misty', role: '', days: 90, waiting: 0, mail: 1 },
];
ok(M.knPasses(rows[0], { ring: 0 }) && !M.knPasses(rows[1], { ring: 0 }), 'ring filter');
ok(M.knPasses(rows[2], { roles: ['corp', 'solo'] }) && !M.knPasses(rows[0], { roles: ['corp'] }) && M.knPasses(rows[4], { roles: [''] }), 'roles filter (OR), "no role" pickable');
ok(M.knPasses(rows[2], { ring: 0, roles: ['corp'] }) && !M.knPasses(rows[2], { ring: 1, roles: ['corp'] }), 'ring AND roles');

const m = M.knownModules(rows, { size: 280, ring: 0, roles: [], sel: 'c' });
ok(m.rings.length === 4 && m.rings[0].on && m.rings.map(r => r.n).join() === '2,1,1,1', 'rings: counts + the picked one lit');
ok(m.rings.every((r, i) => !i || r.r > m.rings[i - 1].r) && m.rings[3].r <= 140, 'rings grow outward and fit the frame');
ok(m.dots.length === 5 && m.dots.every(d => Math.hypot(d.x, d.y) <= 140), 'every contact is a dot inside the orbit');
ok(m.dots.find(d => d.id === 'b').dim && !m.dots.find(d => d.id === 'a').dim, 'dots outside the filter dim');
ok(m.dots.find(d => d.id === 'c').sel && m.dots.find(d => d.id === 'a').r > m.dots.find(d => d.id === 'd').r, 'picked dot marked; more mail = bigger dot');
ok(m.dots.find(d => d.id === 'a').hueKey === 'role:fixer' && m.dots.find(d => d.id === 'e').hueKey === '', 'dots coloured by role');
const ring0 = m.dots.filter(d => ['a', 'c'].includes(d.id)).map(d => Math.hypot(d.x, d.y));
const ring3 = Math.hypot(m.dots.find(d => d.id === 'd').x, m.dots.find(d => d.id === 'd').y);
ok(ring0.every(r => r < ring3), 'this-week dots sit inside never-written ones');
ok(M.knownModules(rows).dots.find(d => d.id === 'a').x === M.knownModules(rows).dots.find(d => d.id === 'a').x, 'positions are stable between renders');
ok(m.bars.map(b => b.key).join() === 'corp,fixer,solo,' && m.bars.find(b => b.key === 'fixer').n === 2, 'one bar per role, "no role" last');
ok(m.bars.find(b => b.key === 'fixer').waiting && !m.bars.find(b => b.key === 'solo').waiting, 'waiting cap per role');
ok(m.bars.find(b => b.key === 'fixer').h > m.bars.find(b => b.key === 'solo').h, 'bar height = how many');
const m2 = M.knownModules(rows, { roles: ['corp'] });
ok(m2.bars.find(b => b.key === 'corp').on && m2.bars.find(b => b.key === 'fixer').dim, 'picked bars lit, others dim');
ok(m.waiting.map(r => r.id).join() === 'a,c' && m.waitingTotal === 3, 'waiting list: most recent first, total');
ok(M.knownModules([]).dots.length === 0 && M.knownModules([]).bars.length === 0, 'empty is fine');

const js = fs.readFileSync(new URL('scripts/ui/AdminPanel/tabs/ContactsTab.js', root), 'utf8');

const hbs = fs.readFileSync(new URL('templates/admin-panel/tab-contacts.hbs', root), 'utf8');
const css = fs.readFileSync(new URL('styles/components/admin-panel/tab-contacts.css', root), 'utf8');
// ── the modules live on the character's own inner tab (Profile · At a glance, 2026-10-28) ──
{ const gi = hbs.indexOf('{{#if onGlance}}');
  const glance = hbs.slice(gi, hbs.indexOf('{{/with}}', hbs.indexOf('ncm-ct2-km__card', gi)) + 2000);
  ok(gi > 0 && glance.includes('{{#with kn.mods}}') && glance.includes('ncm-ct2-km__orbit') && glance.includes('ncm-ct2-km__eq') && glance.includes('ncm-ct2-km__wait') && glance.includes('ncm-ct2-km__cd'), 'At a glance holds the orbit, roles, waiting and the contact card');
  const main = hbs.slice(hbs.indexOf('{{#if ptabs}}'), gi);
  ok(main.includes('{{#if onMain}}') && main.includes('ncm-ct2-knnav') && main.includes('Groups they hold') && !main.includes('{{#with kn.mods}}'), 'Profile keeps the list, groups and identities, not the modules');
  ok(hbs.includes('data-op="pTab"') && /case 'pTab': this._pTab =/.test(js) && js.includes('this._pTabFor !== p.actorId'), 'inner tab switches by tabAct and resets for another character');
  ok(js.includes("label: 'At a glance'") && js.includes("label: 'Profile'"), 'plain tab names');
  ok(!hbs.includes('knMods') && !js.includes('_knMods') && !css.includes('km__toggle'), 'the Hide/Show toggle is gone (its own tab now)'); }
for (const op of ['knRing', 'knRole', 'knPick', 'knClear', 'pTab']) ok(js.includes(`case '${op}'`) && hbs.includes(`data-op="${op}"`), `op ${op} wired`);
ok(/known = known\.filter\(\(c\) => knPasses\(/.test(js), 'the list under the modules is narrowed by them');
ok(hbs.includes('{{#with kn.mods}}') && hbs.includes('ncm-ct2-km__orbit') && hbs.includes('ncm-ct2-km__eq') && hbs.includes('ncm-ct2-km__wait') && hbs.includes('ncm-ct2-km__cd'), 'four modules rendered');
ok(hbs.includes('data-op="replyAs"') && hbs.includes('data-op="sendAs"') && hbs.includes('data-op="pOpenContact"'), 'card buttons use the existing ops');
ok(!/\(concat /.test(hbs), 'no concat helper (not registered)');
ok(css.includes('prefers-reduced-motion') && /sweep-g { display: none/.test(css) && hbs.includes('from="0 0 0" to="360 0 0"'), 'the sweep turns about the centre (SVG rotate) and hides for reduced motion');
ok(css.includes('.ncm-admin-panel--pop .ncm-ct2-km {'), 'pop-out puts the orbit beside the others');
// ── Groups they hold: the rack (option A of admin-groups-held-modules-mock.html) ──
ok(M.ghState({ fromYou: false }) === 'own' && M.ghState({ fromYou: true, gone: true }) === 'gone' && M.ghState({ fromYou: true, stale: true }) === 'stale' && M.ghState({ fromYou: true }) === 'sync', 'tile states');
const tiles = [{ name: 'Crew', state: 'sync' }, { name: 'Afterlife', state: 'stale' }, { name: 'Family', state: 'own' }, { name: 'Old jobs', state: 'gone' }, { name: 'Bandmates', state: 'own' }];
const rk = M.groupRack(tiles);
ok(rk.tiles.map(t => t.name).join() === 'Afterlife,Old jobs,Crew,Bandmates,Family', 'out of date first, then deleted, in sync, their own');
ok(rk.counts.all === 5 && rk.counts.you === 3 && rk.counts.own === 2 && rk.counts.stale === 1 && rk.counts.gone === 1, 'counts');
ok(M.groupRack(tiles, 'own').tiles.every(t => t.state === 'own') && M.groupRack(tiles, 'you').tiles.length === 3, 'filters');
ok(M.groupRack(tiles.filter(t => t.state !== 'gone'), 'gone').filter === 'all', 'an emptied filter lets go');
ok(M.groupRack(tiles).filters.find(f => f.k === 'stale').tone === 'attn' && !M.groupRack([{ name: 'x', state: 'sync' }]).filters.some(f => f.k === 'stale'), 'chips only when they have something; stale is amber');
const df = M.ghDiff(['a', 'b', 'c'], ['a', 'c', 'd']);
ok(df.added.join() === 'b' && df.removed.join() === 'd', 'what changed since the push');
const tpl2 = hbs.slice(hbs.indexOf('Groups they hold'));
for (const op of ['ghF', 'ghSel', 'ghPush']) ok(js.includes(`case '${op}'`) && hbs.includes(`data-op="${op}"`), `op ${op} wired`);
ok(tpl2.includes('data-op="pGroupUpdate"') && tpl2.includes('data-op="pGroupTake"') && tpl2.includes('is-ghost'), 'update / take back / push tiles');
ok(hbs.includes('data-fold-mod="rack"') && hbs.includes('data-fold-mod="list"') && js.includes('_wireFolds(root)'), 'rack and contact list fold (DOM-only)');
ok(hbs.includes('data-kn-jump=') && js.includes("j.dataset.knJump") && js.includes("classList.toggle('is-here'"), 'jump strip scrolls to a group and lights where you are');
ok(!/\(gt /.test(tpl2.slice(0, 4000)), 'no gt helper in the rack (not in every renderer)');
console.log(`test-known-modules: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
