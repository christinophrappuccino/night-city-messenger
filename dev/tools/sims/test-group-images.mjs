// Group pictures + the redesigned Players → Edit / Add-an-alias dialogs (2026-10-29).
// node dev/tools/sims/test-group-images.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

const G = await import('../../../scripts/services/ContactGroupService.js');
const M = await import('../../../scripts/ui/AdminPanel/tabs/contactsModel.js');
const P = await import('../../../scripts/utils/personDialogs.js');

// ═══ group pictures ═══
ok(G.sanitizeGroup({ name: 'Crew', img: 'worlds/x/crew.webp' }).img === 'worlds/x/crew.webp', 'a path survives');
ok(G.sanitizeGroup({ name: 'Crew' }).img === '', 'no picture = empty');
for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'x" onerror="1', ' vbscript:x']) ok(G.sanitizeGroupImg(bad) === '', `refused: ${bad}`);
ok(G.sanitizeGroupImg('data:image/png;base64,AA') !== '' && G.sanitizeGroupImg('https://a.b/c.png') !== '', 'an image data URI and a URL are fine');
const a = { name: 'Crew', color: '#fff', members: [] };
ok(M.groupSig(a) !== M.groupSig({ ...a, img: 'x.png' }), 'changing the picture makes a pushed copy "out of date"');
const svc = read('scripts/services/ContactGroupService.js');
ok(/sanitizeGroup\(\{ \.\.\.group, id: undefined, sharedFrom/.test(svc), 'a pushed copy is the whole group (picture included)');

const ed = read('scripts/ui/ContactGroups/GroupEditorDialog.js');
ok(ed.includes('class="ncm-cge__img"') && ed.includes('data-browse-img') && ed.includes("draft.img = root.querySelector('.ncm-cge__img')"), 'the editor has a picture row (path + Browse + preview) and saves it');
ok(/browse files here/.test(ed), 'a player without file-browser rights is told to paste a path');
const cm = read('scripts/ui/ContactManager/ContactManagerApp.js');
ok(cm.includes("img: g.img || ''") && cm.includes('img: openChip.img'), 'player Contact Manager chip + tray get the picture');
const panel = read('templates/contact-manager/partials/contact-groups-panel.hbs');
ok(panel.includes('ncm-cgr__chip-img') && panel.includes('ncm-cgr__tray-img'), 'chip + tray draw it');
const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
ok((comp.match(/img: (g|group)\.img \|\| ''/g) || []).length === 2 && comp.includes("r.img ? `<img src="), 'composer: the group chip and the autocomplete row carry the picture');
ok(read('templates/message-composer/message-composer.hbs').includes('{{#if isGroup}}{{#if img}}<img src="{{img}}"'), 'composer chip draws it');
const ct = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
ok((ct.match(/img: (g|m)\.img \|\| /g) || []).length >= 4, 'admin Groups list / detail + the Players rack get it');
ok(ct.includes("img: g.img || '', icon: 'fas fa-users', color: g.color"), 'Players → Push a group: the picker shows the group picture (else a users icon in its colour)');
ok(read('scripts/utils/namePicker.js').includes('ncm-pkr__art--ic'), 'the name picker draws an icon for a row with no picture');
ok(read('scripts/ui/AdminPanel/tabs/contactsMap.js').includes('img: g.img || undefined') && read('scripts/ui/AdminPanel/tabs/MessagesTab.js').includes('img: gr.img || undefined') && read('scripts/ui/AdminPanel/tabs/MessagesTab.js').includes('img: g.img || undefined'), 'map Group highlight + Messages Who / Send-to pickers show it too');
const tc = read('templates/admin-panel/tab-contacts.hbs');
ok(tc.includes('ncm-ct2-gimg') && tc.includes('ncm-ct2-gimg--lg') && (tc.match(/ncm-ct2-gr__img/g) || []).length >= 3, 'admin templates draw it');
const css = read('styles/components/contact-groups.css') + read('styles/components/admin-panel/tab-contacts.css');
for (const c of ['ncm-cgr__chip-img', 'ncm-cgr__tray-img', 'ncm-cge__pic', 'ncm-ct2-gimg', 'ncm-ct2-gr__img']) ok(css.includes(`.${c}`), `styled: ${c}`);

// ═══ the player edit dialog ═══
ok(P.looksLikeAddress('sam@nightcity.net') && P.looksLikeAddress('v@crs.net'), 'addresses with an "s" pass (the old check refused them)');
ok(!P.looksLikeAddress('sam nightcity') && !P.looksLikeAddress('a b@c') && !P.looksLikeAddress('@x'), 'non-addresses fail');
ok(!/\[\^s@\]/.test(ct), 'the broken /[^s@]/ check is gone');
const html = P.playerEditHtml({ name: 'Rache <B>', email: 'r@x.nc', img: '', playedBy: ['Sam'], aliases: [{ name: 'Rache', email: 'r@x.nc', main: true }, { name: 'Ghost', email: 'g@d.nc' }] });
ok(html.includes('Rache &lt;B&gt;') && html.includes('played by Sam') && html.includes('ncm-pe__main') && (html.match(/ncm-pe__al\b/g) || []).length === 2, 'card: escaped name, who plays them, aliases as cards, main starred');
ok(html.includes('class="ncm-pe__face is-empty"') && P.playerEditHtml({ name: 'Rache Bartmoss' }).includes('>RB<'), 'no picture = initials');
ok(html.includes('data-pe-alias') && html.includes('data-pe-sheet') && html.includes('data-pe-err'), 'Add an alias / Open sheet buttons + an inline address error');
ok(P.playerEditHtml({ name: 'X', aliases: [] }).includes('No aliases yet'), 'empty alias state');
ok(P.aliasDialogHtml({ ofName: 'Rache' }).includes("never Rache's face"), 'alias dialog says a blank picture never borrows their face');
ok(ct.includes("classes: [...THEMED_DIALOG_CLASSES, 'ncm-pe-dialog']") && ct.includes('_wirePersonDialog('), 'both open as themed dialogs with the shared live wiring');
ok(read('styles/components/ncm-dialog.css').includes('.ncm-pe__card'), 'styled');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
