// Sim: the shared searchable world picker (tester, 2026-10-20: "it's tedious to
// scroll through hundreds of items… a search, filter or default directory").
// Drives the REAL namePicker helpers (folderPathOf / documentEntries /
// matchesPicker) with mocked Foundry documents, then static drift guards: no
// world-collection <select> survives, every picker call site imports the
// picker, the burn-dialog CSS carries no literal greys. Second sweep (same day,
// dev: "cover all our bases"): the eight remaining copies/selects are gone, the
// picker has a non-admin mode for immersive windows, and nothing can grow a new
// hand-rolled picker-row builder or a hidden-attribute filter. Redesign (same day):
// the picker owns name-picker.css under ncm-pkr-*; the old .ncm-burn-* host is gone.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

globalThis.game = { items: [], actors: [] };
globalThis.ui = { notifications: { warn: () => {} } };
const { folderPathOf, documentEntries, matchesPicker, UNFILED_GROUP, showNamePicker } =
  await import(pathToFileURL(`${ROOT}/scripts/utils/namePicker.js`).href);

// ── Mock documents with a folder tree: NPCs / Arasaka / Execs ──
const fNpcs = { name: 'NPCs', folder: null };
const fArasaka = { name: 'Arasaka', folder: fNpcs };
const fExecs = { name: 'Execs', folder: fArasaka };
const fScenes = { name: 'Night City', folder: null };
const docs = [
  { id: 'a1', name: 'Yorinobu Arasaka', img: 'y.webp', type: 'npc', folder: fExecs },
  { id: 'a2', name: 'Rogue', img: 'r.webp', type: 'npc', folder: fNpcs },
  { id: 'a3', name: 'V', img: '', type: 'character', folder: null, hasPlayerOwner: true },
  { id: 'a4', name: 'Adam Smasher', img: 's.webp', type: 'npc', folder: fArasaka },
  { id: 'a5', name: '', img: 'x.webp', type: 'npc', folder: null }, // nameless → dropped
];

// ═══ folderPathOf ═══
ok(folderPathOf(docs[0]) === 'NPCs / Arasaka / Execs', 'nested folder path reads root → leaf');
ok(folderPathOf(docs[1]) === 'NPCs', 'single folder');
ok(folderPathOf(docs[2]) === '', 'unfiled → empty string');
ok(folderPathOf(null) === '', 'null-safe');
{ // a folder cycle must not hang
  const loop = { name: 'A', folder: null }; loop.folder = loop;
  ok(typeof folderPathOf({ folder: loop }) === 'string', 'a folder cycle terminates');
}

// ═══ documentEntries ═══
const entries = documentEntries(docs, { note: (d) => d.type });
ok(entries.length === 4, 'nameless documents are dropped');
ok(entries.map(e => e.name).join('|') === 'Adam Smasher|Rogue|V|Yorinobu Arasaka', 'sorted by name');
const yori = entries.find(e => e.id === 'a1');
ok(yori.sub === 'NPCs / Arasaka / Execs' && yori.group === 'NPCs', 'sub = full path, chip group = TOP-level folder');
ok(entries.find(e => e.id === 'a3').group === UNFILED_GROUP, 'unfiled documents group under "Unfiled"');
ok(entries.find(e => e.id === 'a3').img === 'icons/svg/item-bag.svg', 'missing img → fallback');
ok(documentEntries(docs, { fallbackImg: 'icons/svg/map.svg' }).find(e => e.id === 'a3').img === 'icons/svg/map.svg', 'fallback image is configurable');
ok(yori.note === 'npc', 'note callback lands on the entry');
ok(documentEntries(docs, { group: 'type' }).find(e => e.id === 'a3').group === 'character', 'group:"type" chips by document type');
ok(documentEntries(docs, { group: (d) => d.hasPlayerOwner ? 'Players' : 'World' }).find(e => e.id === 'a3').group === 'Players', 'group callback');
ok(documentEntries([{ _id: 'legacy', name: 'Idx', thumb: 't.webp' }])[0].id === 'legacy', 'index-shaped docs (_id/thumb) work too');
ok(documentEntries(null).length === 0 && documentEntries(undefined).length === 0, 'null/undefined collections → []');

// ═══ matchesPicker — the filter rule ═══
ok(matchesPicker(yori, '', ''), 'no query, no chip → visible');
ok(matchesPicker(yori, 'yori', ''), 'query matches the name');
ok(matchesPicker(yori, 'arasaka', ''), 'query matches the folder PATH (the "default directory" ask)');
ok(!matchesPicker(yori, 'rogue', ''), 'query that matches nothing hides the row');
ok(matchesPicker(yori, '', 'NPCs'), 'active chip = its top folder → visible');
ok(!matchesPicker(yori, '', UNFILED_GROUP), 'active chip ≠ its group → hidden even with no query');
ok(!matchesPicker(yori, 'yori', UNFILED_GROUP), 'chip AND query both apply');
ok(matchesPicker({ name: 'X' }, '', ''), 'entries without sub/group are safe');

// ═══ showNamePicker builds markup with chips / none row / selected ═══
{
  // Capture the adminDialog content without a DOM: stub Dialog-ish object via adminTheme's import.
  const adminTheme = await import(pathToFileURL(`${ROOT}/scripts/utils/adminTheme.js`).href);
  let captured = null;
  const origDialog = globalThis.Dialog;
  globalThis.Dialog = class { constructor(data) { captured = data; } render() {} close() {} };
  globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }) } };
  showNamePicker({ title: 'T', entries, allowNone: '— none —', selected: 'a2' });
  globalThis.Dialog = origDialog;
  const html = captured?.content || '';
  ok(html.includes('ncm-pkr__chips'), 'chips render when entries carry ≥2 groups');
  ok((html.match(/class="ncm-pkr__chip"/g) || []).length === 2 && html.includes('data-group="NPCs"') && html.includes(`data-group="${UNFILED_GROUP}"`), 'one chip per group plus the All chip');
  ok((html.match(/ncm-pkr__group"/g) || []).length === 2 && /ncm-pkr__group"><i class="fas fa-folder"><\/i>NPCs<b>3<\/b>/.test(html), 'a sticky folder header per group, with its count, while All is active');
  ok(html.indexOf('>NPCs<b>') < html.indexOf('data-id="a1"') && html.indexOf('data-id="a1"') < html.indexOf(`>${UNFILED_GROUP}<b>`), 'rows sit under their own header (grouped order, caller\'s group order kept)');
  ok(!html.includes('<button class="ncm-pkr__chip'), 'chips are spans, not buttons (admin-theme restyles every dialog button)');
  ok(html.includes('ncm-pkr__row--none') && html.includes('— none —'), 'allowNone renders the none row');
  ok(/data-id="a2"[^>]*|is-selected[^>]*data-id="a2"/.test(html) && html.includes('is-selected'), 'selected id is highlighted');
  ok(html.includes('ncm-pkr__sub"><i class="fas fa-folder"></i>NPCs / Arasaka / Execs<'), 'folder path renders as the sub-line');
  ok(html.includes('class="ncm-pkr__q"') && html.includes('ncm-pkr__count') && html.includes('ncm-pkr__clear'), 'search bar carries the live count and a clear');
  ok(html.includes('ncm-pkr__foot') && html.includes('<kbd>↑↓</kbd>'), 'the status strip states the keys');
  ok(!html.includes('<select') && !html.includes('ncm-burn-'), 'the picker itself has no native select and no legacy class');
  const one = documentEntries([docs[1], docs[3]].map(d => ({ ...d, folder: fNpcs })));
  captured = null; globalThis.Dialog = class { constructor(data) { captured = data; } render() {} close() {} };
  showNamePicker({ title: 'T', entries: one });
  globalThis.Dialog = origDialog;
  ok(!(captured?.content || '').includes('ncm-pkr__chips') && !(captured?.content || '').includes('ncm-pkr__group'), 'a single group renders no chips and no headers (nothing to choose between)');
  captured = null; globalThis.Dialog = class { constructor(data) { captured = data; } render() {} close() {} };
  showNamePicker({ title: 'T', entries, multi: true });
  globalThis.Dialog = origDialog;
  ok((captured?.content || '').includes('ncm-pkr__check') && !(captured?.content || '').includes('ncm-pkr__sel-ic') && captured?.buttons?.done, 'multi mode renders check squares, no single-pick check, and a Done button');
  // 2026-10-21 (dev): admin-theme.css forces `color: inherit` on every span in an admin
  // dialog, which beat the check square's `color: transparent` — every box showed a tick
  // before anything was picked. The glyph is hidden by OPACITY now; and the chip row
  // WRAPS instead of hiding its overflow behind a scrollbar-less scroller.
  {
    const css = readFileSync(`${ROOT}/styles/components/name-picker.css`, 'utf8');
    ok(/.ncm-pkr__check > i {[^}]*opacity: 0/.test(css) && /.is-picked .ncm-pkr__check > i {[^}]*opacity: 1/.test(css), 'multi check glyph is hidden by opacity until picked (immune to the admin colour rule)');
    ok(!/.ncm-pkr__check {[^}]*color: transparent/.test(css), 'no colour-transparent trick on the check square');
    ok(/.ncm-pkr__chips {[^}]*flex-wrap: wrap/.test(css) && !/.ncm-pkr__chips {[^}]*scrollbar-width: none/.test(css), 'filter chips wrap; no hidden horizontal scroller');
  }
  void adminTheme;
}

// ═══ Drift guards ═══
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n); const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(js|hbs)$/.test(n)) out.push(p);
  }
  return out;
}
const files = [...walk(`${ROOT}/scripts`), ...walk(`${ROOT}/templates`)];
{
  // No JS-built <select> whose options are mapped from a world collection.
  const offenders = [];
  for (const f of files.filter(f => f.endsWith('.js'))) {
    const src = readFileSync(f, 'utf8');
    // One STATEMENT that maps a whole world collection into <option>s. ICE pickers
    // (a handful of Black ICE actors) are a deliberate small enum and stay native.
    const re = /game\.(items|actors|scenes|macros)(?:(?!;)[\s\S]){0,400}?\.map\((?:(?!;)[\s\S]){0,200}?<option/g;
    for (const m of src.matchAll(re)) {
      if (!/black\s*ice|blackIce/i.test(m[0])) { offenders.push(f.replace(ROOT + '/', '')); break; }
    }
  }
  ok(offenders.length === 0, `no JS builds <option>s from game.items/actors/scenes/macros (${offenders.join(', ') || 'none'})`);
  // No template iterates a world-collection option list.
  const tplOffenders = files.filter(f => f.endsWith('.hbs')).filter(f => /#each (availableActors|actorOptions|pl\.macroOptions)\b/.test(readFileSync(f, 'utf8')));
  ok(tplOffenders.length === 0, `no template renders availableActors/actorOptions/macroOptions as options (${tplOffenders.map(f => f.replace(ROOT + '/', '')).join(', ') || 'none'})`);
  // Every file that calls showNamePicker imports it.
  const bad = files.filter(f => f.endsWith('.js') && !f.endsWith('namePicker.js')).filter(f => {
    const src = readFileSync(f, 'utf8');
    return /showNamePicker\(/.test(src) && !/import \{[^}]*showNamePicker[^}]*\} from ['"][^'"]*namePicker\.js['"]/.test(src);
  });
  ok(bad.length === 0, `every showNamePicker call site imports it (${bad.map(f => f.replace(ROOT + '/', '')).join(', ') || 'none'})`);
  // Every surface routes through the picker — the first seven plus the second sweep's eight.
  for (const f of ['scripts/ui/AdminPanel/tabs/ShardsTab.js', 'scripts/ui/AdminPanel/tabs/TerminalsTab.js', 'scripts/ui/Terminal/TerminalViewerApp.js',
    'scripts/ui/ItemInbox/DataShardComposer.js', 'scripts/ui/ContactManager/ContactManagerApp.js', 'scripts/ui/GMContactManager/GMContactManagerApp.js',
    'scripts/ui/AdminPanel/tabs/SecurityTab.js', 'scripts/ui/AdminPanel/tabs/ToolsTab.js', 'scripts/ui/ShardEncoder/ShardEncoderApp.js', 'scripts/ui/ShardEncoder/EncoderConfigApp.js',
    'scripts/ui/Terminal/TerminalConfigApp.js', 'scripts/ui/ItemInbox/ItemInboxConfig.js', 'scripts/ui/NetworkManagement/NetworkManagementApp.js', 'scripts/ui/NetworkManagement/NetworkAuthDialog.js']) {
    ok(/showNamePicker\(/.test(readFileSync(`${ROOT}/${f}`, 'utf8')), `${f} uses the picker`);
  }
  // Picker CSS: its own file, imported, tokens only (no literal colour at all), and
  // nothing else carries a picker rule — the old .ncm-burn-dialog host was a class
  // collision with the Email Setup burn-confirm's content wrapper.
  const pkrCss = readFileSync(`${ROOT}/styles/components/name-picker.css`, 'utf8');
  ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(pkrCss), 'name-picker.css carries no literal colour');
  ok(/@import 'components\/name-picker\.css';/.test(readFileSync(`${ROOT}/styles/night-city-messenger.css`, 'utf8')), 'name-picker.css is imported');
  const strays = walk(`${ROOT}/styles`).filter(f => f.endsWith('.css') && !f.endsWith('name-picker.css') && /\.ncm-pkr|\.ncm-burn-(row|list|search|chip|hint|name|sub|type|tag|pick|footer|empty|main|none)/.test(readFileSync(f, 'utf8')));
  ok(strays.length === 0, `no other stylesheet styles the picker (${strays.map(f => f.replace(ROOT + '/', '')).join(', ') || 'none'})`);
  ok(/\.ncm-pkr-dialog, \.ncm-pkr-dialog \*/.test(readFileSync(`${ROOT}/styles/base/scrollbars.css`, 'utf8')), 'scrollbars.css themes the picker dialog');
  // The contact-form partial is shared by BOTH managers: both must pass a label + register the action.
  const gmHbs = readFileSync(`${ROOT}/templates/gm-contact-manager/gm-contact-manager.hbs`, 'utf8');
  ok((gmHbs.match(/linkedActorName=/g) || []).length === 2, 'GM Contact Manager passes linkedActorName to both form invocations');
  // The player Contact Manager's form binds to `editingContact` — a bare `contact`
  // there was a ReferenceError at render ("contacts won't open", 2026-10-20).
  const pcm = readFileSync(`${ROOT}/scripts/ui/ContactManager/ContactManagerApp.js`, 'utf8');
  ok(/linkedActorName = \(game\.user\.isGM && editingContact\?\.actorId\)/.test(pcm) && !/&& contact\?\.actorId/.test(pcm),
    'player Contact Manager reads the linked actor from editingContact (not a free contact variable)');
  for (const f of ['scripts/ui/ContactManager/ContactManagerApp.js', 'scripts/ui/GMContactManager/GMContactManagerApp.js']) {
    ok(/pickLinkedActor:\s+\w+\._onPickLinkedActor/.test(readFileSync(`${ROOT}/${f}`, 'utf8')), `${f} registers the pickLinkedActor action`);
  }
}

// ═══ Second sweep: the copies are gone and nothing can grow a new one ═══
{
  const rel = (f) => f.replace(ROOT + '/', '');
  const js = files.filter(f => f.endsWith('.js'));
  // 1. Only namePicker.js builds a picker row — every other builder was a drifted copy
  //    (burn target, two key-item pickers, the account key item, the gate choosers, the Encoder key).
  const rowBuilders = js.filter(f => !f.endsWith('namePicker.js') && /class="ncm-(pkr__row|burn-row)/.test(readFileSync(f, 'utf8')));
  ok(rowBuilders.length === 0, `no hand-rolled picker row builder outside namePicker.js (${rowBuilders.map(rel).join(', ') || 'none'})`);
  const legacy = [...js, ...files.filter(f => f.endsWith('.hbs'))].filter(f => /ncm-burn-(row|list|search|chip|hint|main|sub|type|tag|pick|footer|empty|none)/.test(readFileSync(f, 'utf8')));
  ok(legacy.length === 0, `no script or template references the retired .ncm-burn-* picker classes (${legacy.map(rel).join(', ') || 'none'})`);
  // 2. No search filter toggles the hidden ATTRIBUTE on a row — the Encoder's key-item search was dead for that reason.
  const hiddenFilters = js.filter(f => /\.hidden\s*=\s*!!q\b/.test(readFileSync(f, 'utf8')));
  ok(hiddenFilters.length === 0, `no picker filters by the hidden attribute (${hiddenFilters.map(rel).join(', ') || 'none'})`);
  // 3. No template renders a world ACTOR list as <option>s — the GM Contact Manager's two share
  //    selects were {{#each}} loops, which the JS-only guard above never saw.
  const tplActorOpts = files.filter(f => f.endsWith('.hbs')).filter(f => /\{\{#each [^}]*(?:[Aa]ctors|NPCs|shareTarget\w*)\b[^}]*\}\}\s*<option/.test(readFileSync(f, 'utf8')));
  ok(tplActorOpts.length === 0, `no template renders an actor list as <option>s (${tplActorOpts.map(rel).join(', ') || 'none'})`);
  const gmHbs2 = readFileSync(`${ROOT}/templates/gm-contact-manager/gm-contact-manager.hbs`, 'utf8');
  ok(!/pushTargetActor|pushAllTargetActor|shareTargetNPCs/.test(gmHbs2) && /data-action="pushToPlayer"/.test(gmHbs2) && /data-action="pushAllToPlayer"/.test(gmHbs2),
    'GM Contact Manager share buttons survive, the whole-world share selects do not');
  ok(/_pickShareTarget\(/.test(readFileSync(`${ROOT}/scripts/ui/GMContactManager/GMContactManagerApp.js`, 'utf8')), 'both share handlers pick the target through the picker');
  // 4. itemPicker.js is deleted and nothing imports it or styles its classes.
  ok(!existsSync(`${ROOT}/scripts/utils/itemPicker.js`), 'itemPicker.js is gone');
  const ipRefs = [...js, ...walk(`${ROOT}/styles`).filter(f => f.endsWith('.css'))].filter(f => /from ['"][^'"]*itemPicker\.js['"]|ncm-ip-item|ncm-item-picker-dialog|ncm-itempick/.test(readFileSync(f, 'utf8')));
  ok(ipRefs.length === 0, `no import or style refers to the old item picker (${ipRefs.map(rel).join(', ') || 'none'})`);
  // 5. Player-facing callers open the picker on the PLAYER theme.
  for (const f of ['scripts/ui/ShardEncoder/ShardEncoderApp.js', 'scripts/ui/Terminal/TerminalViewerApp.js', 'scripts/ui/NetworkManagement/NetworkAuthDialog.js']) {
    ok(/admin: false,/.test(readFileSync(`${ROOT}/${f}`, 'utf8')), `${f} opens the picker with admin:false`);
  }
  // 6. admin:false really is a plain Dialog (no admin-theme class), the default really is tagged.
  {
    const origDialog = globalThis.Dialog;
    let opts = null;
    globalThis.Dialog = class { constructor(data, o) { opts = o; } render() {} close() {} };
    showNamePicker({ title: 'T', entries, admin: false });
    const plain = opts;
    showNamePicker({ title: 'T', entries });
    const tagged = opts;
    globalThis.Dialog = origDialog;
    ok(Array.isArray(plain?.classes) && plain.classes.includes('ncm-pkr-dialog') && !plain.classes.includes('ncm-admin-dialog'), 'admin:false → .ncm-pkr-dialog without the admin-theme class');
    ok(plain?.width === 440 && tagged?.width === 440, 'the dialog opens at the designed width');
    ok(Array.isArray(tagged?.classes) && tagged.classes.includes('ncm-admin-dialog'), 'default → tagged for the admin theme');
  }
  // 7. The network-auth dialog resolves its operator the one sanctioned way.
  ok(!/game\.user\?*\.character/.test(readFileSync(`${ROOT}/scripts/ui/NetworkManagement/NetworkAuthDialog.js`, 'utf8')), 'NetworkAuthDialog never reads game.user.character directly (resolveOperator)');
  // 8. The Security tab lost its 150-row cap along with its private copies of the entry builders.
  const sec = readFileSync(`${ROOT}/scripts/ui/AdminPanel/tabs/SecurityTab.js`, 'utf8');
  ok(!/slice\(0, 150\)|_availableItems|_availableRoles|_openNamePicker/.test(sec) && /worldItemEntries\(\)/.test(sec) && /worldRoleEntries\(\)/.test(sec), 'Security tab uses the shared entry builders (no 150 cap, no private copies)');
  // 9. Purge Messages picks its target in the picker, with the "everything" row intact.
  const tools = readFileSync(`${ROOT}/scripts/ui/AdminPanel/tabs/ToolsTab.js`, 'utf8');
  ok(/id: 'all-inboxes'/.test(tools) && /showNamePicker\(\{\s*title: '⚠ Purge Messages'/.test(tools) && !/ncm-purge-target/.test(tools), 'Purge Messages routes through the picker and keeps the ALL-inboxes row');
  // 10. isCarrier is the ONE gear filter (the picker exports it).
  ok(/export const isCarrier/.test(readFileSync(`${ROOT}/scripts/utils/namePicker.js`, 'utf8')), 'namePicker exports isCarrier');
}

console.log(`\ntest-world-picker: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
