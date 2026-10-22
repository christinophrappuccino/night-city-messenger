// Sim: role icons render everywhere a role is chipped.
// Tester 2026-10-21: "solo and netrunner — their icons don't appear in the
// tags/chips in the contacts". Cause: getRoleIcon returned `fa-gun` with no
// Font Awesome FAMILY class, and FA6 paints nothing for a glyph class on its
// own. Rules asserted here:
//   - getRoleIcon() always returns `fas fa-<name>` (family + glyph), never bare;
//   - every role the contact form offers has a real icon (not the fa-user fallback);
//   - the built-in vocabulary matches the GM's role table (RoleManagerDialog), so
//     a Solo wears the same glyph on a player card and in the admin panel;
//   - a GM custom role resolves to its own icon (explicit list or the live service);
//   - every template that prints {{roleIcon}} prints it as the WHOLE class.
import { pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

globalThis.game = { nightcity: { masterContactService: { getCustomRoles: () => [{ id: 'clown', label: 'Clown', icon: 'masks-theater', color: '#ff0' }] } } };
const H = await import(pathToFileURL(`${ROOT}/scripts/utils/designHelpers.js`).href);

// ── full class, never bare ──
ok(H.getRoleIcon('solo') === 'fas fa-crosshairs', 'solo → fas fa-crosshairs');
ok(H.getRoleIcon('Netrunner') === 'fas fa-terminal', 'case-insensitive: Netrunner → fas fa-terminal');
ok(H.getRoleIcon('') === 'fas fa-user' && H.getRoleIcon(undefined) === 'fas fa-user', 'no role → the user glyph, with its family');
ok(H.getRoleIcon('zzz-unknown') === 'fas fa-user', 'unknown role → fallback, with its family');
ok(/^fas fa-[a-z0-9-]+$/.test(H.getRoleIcon('nomad')), 'shape is `fas fa-name`');

// ── every form role has a real icon ──
const form = readFileSync(`${ROOT}/templates/contact-manager/partials/contact-form.hbs`, 'utf8');
const roleSelect = form.match(/<select[^>]*name="role"[^>]*>[\s\S]*?<\/select>/)?.[0] || '';
ok(roleSelect.length > 0, 'contact form has a role <select>');
const formRoles = [...roleSelect.matchAll(/<option value="([a-z]+)"[^>]*>/g)].map(m => m[1]).filter(r => r && r !== 'npc');
ok(formRoles.length >= 10, `form offers ${formRoles.length} roles`);
for (const r of formRoles) ok(H.getRoleIcon(r) !== 'fas fa-user', `form role "${r}" has its own icon (${H.getRoleIcon(r)})`);

// ── matches the GM's table ──
const rm = readFileSync(`${ROOT}/scripts/ui/GMContactManager/RoleManagerDialog.js`, 'utf8');
const gmTable = [...rm.matchAll(/\{ id: '([a-z]+)',\s+label: '[^']*',\s+icon: '([a-z-]+)'/g)].map(m => [m[1], m[2]]);
ok(gmTable.length >= 10, `GM role table read (${gmTable.length} roles)`);
for (const [id, icon] of gmTable) ok(H.getRoleIcon(id) === `fas fa-${icon}`, `player + GM agree on ${id} → ${icon}`);

// ── custom roles ──
ok(H.getRoleIcon('clown') === 'fas fa-masks-theater', 'custom role from the live service');
ok(H.getRoleIcon('clown', [{ id: 'clown', icon: 'fa-hat-wizard' }]) === 'fas fa-hat-wizard', 'explicit custom list wins; a stored fa- prefix is not doubled');
ok(H.getRoleIcon('clown', [{ id: 'clown', icon: 'fas fa-ghost' }]) === 'fas fa-ghost', 'a stored full class is normalised, not doubled');
ok(H.getRoleIcon('nobody', []) === 'fas fa-user', 'empty custom list → fallback');

// ── templates print the whole class ──
for (const t of ['templates/contact-manager/partials/contact-card.hbs', 'templates/contact-manager/partials/contact-detail.hbs', 'templates/contact-manager/partials/contact-list-item.hbs']) {
  const src = readFileSync(`${ROOT}/${t}`, 'utf8');
  ok(/class="\{\{roleIcon\}\}"/.test(src) && !/class="fas \{\{roleIcon\}\}"/.test(src), `${t.split('/').pop()} renders <i class="{{roleIcon}}">`);
}
ok(!/const roleIcons = \{/.test(readFileSync(`${ROOT}/scripts/ui/ContactManager/ContactManagerApp.js`, 'utf8')), 'Contact Manager has no private role-icon map (reads getRoleIcon)');
// GM Contact Manager: group headers print `fas {{icon}}` with icon = `fa-name`; a ROLE group
// takes its role's glyph from the role table rather than the generic user-tag.
const gmHbs = readFileSync(`${ROOT}/templates/gm-contact-manager/gm-contact-manager.hbs`, 'utf8');
const gmJs = readFileSync(`${ROOT}/scripts/ui/GMContactManager/GMContactManagerApp.js`, 'utf8');
ok(/ncm-gm-group-header__icon fas \{\{icon\}\}/.test(gmHbs) && /this\._groupBy === 'role'\s*\?\s*\('fa-' \+ \(Object\.values\(allRoles\)/.test(gmJs), 'GM Contact Manager role groups wear the role glyph');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
