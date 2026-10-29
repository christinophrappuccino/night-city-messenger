// Admin → Spam layout (2026-10-28, dev: "a two column with quick blast and templates… the markers below it
// just a clickable drop down… a three column"). Renders the REAL tab-spam.hbs through Foundry's Handlebars and
// checks: Quick Blast · Category dropdown · Templates actions share ONE top row; the category pill row is gone;
// the dropdown lists every category with its count; SpamTab wires a change listener (a <select> data-action
// fires on click). NCM_DUMP=<dir> writes the rendered HTML for a headless look.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };

const HB_CANDIDATES = ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json'];
let Handlebars = null;
for (const p of HB_CANDIDATES) { if (!existsSync(p)) continue; try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* next */ } }

const tpl = read('templates/admin-panel/tab-spam.hbs');
const js = read('scripts/ui/AdminPanel/tabs/SpamTab.js');
const css = read('styles/components/admin-panel/tab-spam.css');

// ── source checks ──
ok(!/ncm-spam-pills/.test(tpl), 'the category pill row is gone');
ok(!/§3 — CUSTOM CREATOR/.test(tpl) && /ncm-spam-lib__detail">[\s\S]{0,200}\{\{#if spamShowCreator\}\}/.test(tpl), 'the creator section under the library is gone; the form is the first branch of the preview pane');
ok(/<select class="ncm-spam-catsel" data-spam-category/.test(tpl), 'the Category dropdown is a <select data-spam-category>');
ok(/querySelector\('\[data-spam-category\]'\)[\s\S]{0,80}addEventListener\('change'/.test(js), 'SpamTab listens for change on the dropdown');
ok(/spamCategoryActive:/.test(js), 'the context carries the active category (tints the card)');
// recipients: ONE multi picker per place instead of a chip per character (dev: "I have a lot of characters")
ok(!/data-action="spamToggleRecipient"/.test(tpl) && !/{{#each spamPlayerActors}}/.test(tpl), 'no chip-per-character recipient lists in the template');
ok(/{{{spamToPicker}}}/.test(tpl) && /{{{spamToPicker2}}}/.test(tpl), 'Quick Blast and the template Send bar each embed the recipient picker');
ok(/multi: true/.test(js) && /'__all'/.test(js) && /this._recipients = new Set/.test(js), 'the picker is multi-select with an Every player row and writes the shared _recipients');
ok(/ScopePicker.after()/.test(js), 'SpamTab places the picker popovers after render');
for (const c of ['ncm-spam-top', 'ncm-spam-topcard', 'ncm-spam-topcard--cat', 'ncm-spam-topcard--tmpl', 'ncm-spam-catsel', 'ncm-spam-blast-bar__go', 'ncm-spam-topcard__acts', 'ncm-spam-topcard__k'])
  ok(css.includes(`.${c}`), `.${c} is styled`);
ok(!/#[0-9a-f]{3,6}\b/i.test(css.slice(css.indexOf('── Top row (2026-10-28'))), 'the new top-row CSS uses tokens only');

// ── render ──
if (!Handlebars) { console.log('(Handlebars not found — render checks skipped)'); }
else {
  const H = Handlebars.create();
  H.registerHelper('eq', (a, b) => a === b);
  { const { registerTagHueHelper } = await import(new URL('scripts/utils/tagHue.js', ROOT)); registerTagHueHelper(H); }
  const { ScopePicker } = await import(new URL('scripts/utils/scopePicker.js', ROOT));
  const picker = (id) => ScopePicker.html(id, { noun: 'player', nouns: 'players', icon: 'fa-user-group', label: 'To', multi: true, allLabel: 'Pick players', pinned: [{ id: '__all', name: 'Every player', icon: 'fa-users' }], items: [{ id: 'v', name: 'V' }, { id: 'r', name: 'Rache' }] });
  ScopePicker.set('sim-to', ['v']);
  const cats = [['ad', 'Ads', 'fas fa-bullhorn', 6], ['scam', 'Scams', 'fas fa-mask', 4], ['corp', 'Corporate', 'fas fa-building', 3]];
  const ctx = (filter) => ({
    activeTab: 'spam',
    spamPlayerActors: [{ id: 'v', name: 'V', initial: 'V', color: '#3fd0e2', selected: true }, { id: 'r', name: 'Rache', initial: 'R', color: '#f2994a', selected: false }],
    spamAllSelected: false, spamBlastCount: 3, spamCategoryFilter: filter,
    spamCategoryCounts: { all: 13, custom: 2 },
    spamCategoryList: cats.map(([key, label, icon, count]) => ({ key, label, icon, count, active: key === filter })),
    spamCategoryActive: cats.map(([key, label, icon]) => ({ key, label, icon })).find((c) => c.key === filter) || null,
    spamTemplates: [{ id: 't1', subject: 'Hot deals', fromName: 'MegaMart', category: 'ad', categoryIcon: 'fas fa-bullhorn', isActive: true }],
    spamSelectedTemplate: null, spamToPicker: picker('sim-to'), spamToPicker2: picker('sim-to2'),
    spamShowCreator: filter === 'scam', spamEditingId: null, spamCreatorData: { fromName: '', fromEmail: '', category: 'scam', subject: '', body: '', networkFilter: '' }, spamNetworks: [],
  });
  const render = H.compile(tpl);
  for (const filter of ['all', 'scam']) {
    const out = render(ctx(filter));
    if (process.env.NCM_DUMP) writeFileSync(`${process.env.NCM_DUMP}/spam-${filter}.html`, out);
    const top = (out.match(/<div class="ncm-spam-top">[\s\S]*?<div class="ncm-spam-lib">/) || [''])[0];
    ok(/ncm-spam-blast-bar/.test(top) && /ncm-spam-topcard--cat/.test(top) && /ncm-spam-topcard--tmpl/.test(top), `${filter}: Quick Blast, Category and Templates share the top row`);
    ok(/All templates \(13\)/.test(top) && /Ads \(6\)/.test(top) && /Your own \(2\)/.test(top), `${filter}: the dropdown lists every category with its count`);
    ok(new RegExp(`<option value="${filter}" selected`).test(top), `${filter}: the picked category is selected`);
    ok(/data-action="spamToggleCreator"/.test(top) && /data-action="spamImportTemplates"/.test(top) && /data-action="spamExportTemplates"/.test(top), `${filter}: New / Import / Export sit in the Templates card`);
    ok(/data-scope-btn="sim-to"/.test(top) && !/ncm-spam-chip/.test(top), `${filter}: Quick Blast shows one To picker, no chips`);
    ok(!/undefined|NaN|\[object Object\]/.test(out.replace(/data-tooltip="[^"]*"/g, '')), `${filter}: renders with no undefined/NaN`);
    { const detail = (out.match(/<div class="ncm-spam-lib__detail">[\s\S]*$/) || [''])[0];
      if (filter === 'scam') ok(/ncm-spam-creator/.test(detail) && !/ncm-spam-detail__empty/.test(detail), 'New template: the form renders IN the preview pane, replacing the empty state');
      else ok(!/ncm-spam-creator/.test(out) && /ncm-spam-detail__empty/.test(detail), 'no creator open: the preview pane shows its empty state, no form anywhere'); }
  }
}
console.log(`test-spam-layout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
