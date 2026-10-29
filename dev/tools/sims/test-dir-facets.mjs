// Directory → Filter facets: OR within a kind, AND across kinds; "none" picks; wiring guards.
import fs from 'node:fs';
const root = new URL('../../../', import.meta.url);
const { passesFacets, facetKey } = await import(new URL('scripts/ui/AdminPanel/tabs/contactsModel.js', root));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const fixer = { role: 'fixer', organization: 'Arasaka', trust: 3 };
const exec = { role: 'corpo', organization: 'Arasaka ', trust: 1 };
const nomad = { role: 'nomad', organization: '', trust: 0 };
ok(passesFacets(fixer, []), 'no picks = everyone');
ok(passesFacets(fixer, ['role:fixer', 'role:corpo']) && passesFacets(exec, ['role:fixer', 'role:corpo']), 'roles OR');
ok(!passesFacets(nomad, ['role:fixer', 'role:corpo']), 'unpicked role out');
ok(passesFacets(exec, ['role:corpo', 'org:Arasaka']), 'org trimmed, AND across');
ok(!passesFacets(fixer, ['role:corpo', 'org:Arasaka']), 'AND across fails');
ok(passesFacets(nomad, ['org:']) && !passesFacets(fixer, ['org:']), 'No organization');
ok(passesFacets({}, ['role:']) && facetKey('trust', {}) === 'trust:0', 'No role / trust default');
ok(passesFacets(fixer, ['trust:3', 'trust:4']) && !passesFacets(exec, ['trust:3']), 'trust');
const js = fs.readFileSync(new URL('scripts/ui/AdminPanel/tabs/ContactsTab.js', root), 'utf8');
const hbs = fs.readFileSync(new URL('templates/admin-panel/tab-contacts.hbs', root), 'utf8');
ok(/passesFacets\(c, this\._facets\)/.test(js), 'hit() applies facets');
ok(/this\._facets\.length > 0/.test(js), 'facets force groups open');
ok(/case 'facetOff'/.test(js) && /case 'facetClear'/.test(js), 'ops');
ok(hbs.includes('{{{ct2.dir.facetPicker}}}') && hbs.includes('data-op="facetOff"'), 'template');
ok(!/[Oo]rganisation/.test(js + hbs), 'spelling');
// ── Role Manager (rebuilt in the same round) ──
const rm = fs.readFileSync(new URL('scripts/ui/GMContactManager/RoleManagerDialog.js', root), 'utf8');
const rmCss = fs.readFileSync(new URL('styles/components/role-manager.css', root), 'utf8');
ok(!/_dialog\.close\(\)/.test(rm), 'Role Manager repaints in place (never closes/reopens itself)');
ok(/import \{ BUILT_IN_ROLES \} from '\.\.\/\.\.\/utils\/contactVocab\.js'/.test(rm), 'one role table');
for (const k of ['data-rq', 'data-rchip', 'data-rnew', 'data-rcol', 'data-rhex', 'data-ric', 'data-iq', 'data-rsave', 'data-rdel', 'data-rdup', 'data-rcancel'])
  ok(rm.includes(k) && (rm.match(new RegExp(`\\[${k}\\]`, 'g')) || []).length > 0, `${k} rendered + handled`);
ok(!/#[0-9a-f]{6}/i.test(rmCss.replace(/#0b0d12/gi, '')), 'Role Manager CSS uses tokens only');
ok(fs.readFileSync(new URL('styles/night-city-messenger.css', root), 'utf8').includes("components/role-manager.css"), 'stylesheet imported');
const { tagHue, setRoleColorResolver } = await import(new URL('scripts/utils/tagHue.js', root));
setRoleColorResolver((id) => (id === 'smuggler' ? '#123456' : null));
ok(tagHue('role:smuggler') === '#123456' && tagHue('role:solo').startsWith('var(--ncm-hue-') && tagHue('Arasaka').startsWith('var(--ncm-hue-'), 'a coloured custom role wears its colour; others keep the hue');
setRoleColorResolver(null);
ok(/setRoleColorResolver\(/.test(fs.readFileSync(new URL('scripts/init/registerTemplates.js', root), 'utf8')), 'resolver registered');

console.log(`test-dir-facets: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
