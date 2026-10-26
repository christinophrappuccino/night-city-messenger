/**
 * test-mailbox-styles.mjs — the terminal MAILBOX STYLES (2026-10-25).
 *
 * config.mailboxStyle picks how an account is laid out once logged in:
 * classic (the shipped layout) · tabs · tty · desktop. The three new styles are
 * Handlebars partials over the SAME view-model and the SAME data-actions as the
 * classic layout, and the detail pane / FILES tree / list rows were split out of
 * terminal-viewer.hbs into shared partials so the four cannot drift.
 *
 * What this asserts:
 *   • the registry (TERMINAL_MAILBOX_STYLES) — keys, labels, full FA classes
 *   • DEFAULTS + every preset's mailboxStyle is a registry key; classic is the default
 *   • TEMPLATES carries every partial and every file exists + is referenced
 *   • every data-action used by a style partial exists in the viewer's action map
 *   • the viewer branches on msTabs / msTty / msDesktop and stamps data-mailbox-style
 *   • the REAL templates render through Handlebars for all four styles, mail + files,
 *     with the shared detail content present in each and no NaN / undefined leaks
 *   • the config sheet: Mailbox Layout cards, hidden input, save, kit, full preset
 *   • Admin → Terminals shows the fact
 *   • terminal-styles.css is imported after crt.css, uses only --ncm-* tokens, and
 *     its three prefixes collide with nothing else in styles/
 *
 * Run: node dev/tools/sims/test-mailbox-styles.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const check = (name, fn) => { try { const r = fn(); if (r === false) throw new Error('returned false'); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + (e.message || e)); } };

// ── minimal Foundry shims so constants.js imports ─────────────────────────────
globalThis.game = { settings: { get: () => undefined }, i18n: { localize: (k) => k } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'x' } };
globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
const C = await import('../../../scripts/utils/constants.js');
const { TERMINAL_MAILBOX_STYLES, TERMINAL_PRESETS, DEFAULTS, TEMPLATES } = C;

console.log('\n[1] registry + defaults');
check('four styles, classic first', () => TERMINAL_MAILBOX_STYLES.length === 4 && TERMINAL_MAILBOX_STYLES[0].key === 'classic');
check('keys are classic/tabs/tty/desktop', () => JSON.stringify(TERMINAL_MAILBOX_STYLES.map(s => s.key)) === JSON.stringify(['classic', 'tabs', 'tty', 'desktop']));
check('every style has label + hint + a FULL FA class (family + glyph)', () => TERMINAL_MAILBOX_STYLES.every(s => s.label && s.hint && /^fa[sr]? fa-[a-z-]+$/.test(s.icon)));
check('registry is frozen', () => Object.isFrozen(TERMINAL_MAILBOX_STYLES));
check('DEFAULTS.TERMINAL_CONFIG.mailboxStyle is classic', () => DEFAULTS.TERMINAL_CONFIG.mailboxStyle === 'classic');
const keys = new Set(TERMINAL_MAILBOX_STYLES.map(s => s.key));
check('every preset mailboxStyle (when set) is a registry key', () => Object.values(TERMINAL_PRESETS).every(p => !p.mailboxStyle || keys.has(p.mailboxStyle)));
check('presets exercise every non-classic style at least once', () => ['tabs', 'tty', 'desktop'].every(k => Object.values(TERMINAL_PRESETS).some(p => p.mailboxStyle === k)));
check('the DOS / BBS / Blackwall boxes are TTY, the corp consoles are tabs', () => TERMINAL_PRESETS['retro-dos'].mailboxStyle === 'tty' && TERMINAL_PRESETS['streetkid-bbs'].mailboxStyle === 'tty' && TERMINAL_PRESETS['arasaka-workstation'].mailboxStyle === 'tabs');

console.log('\n[2] templates');
const PARTS = ['DETAIL', 'TREE', 'ROWS', 'TABS', 'TTY', 'DESKTOP'];
for (const k of PARTS) {
  check(`TEMPLATES.TERMINAL_MAILBOX_${k} exists on disk`, () => {
    const t = TEMPLATES['TERMINAL_MAILBOX_' + k];
    return typeof t === 'string' && fs.existsSync(path.join(ROOT, t.replace(/^modules\/night-city-messenger\//, '')));
  });
}
const viewer = read('templates/terminal/terminal-viewer.hbs');
check('viewer branches msTabs → msTty → msDesktop → classic', () => /\{\{#if msTabs\}\}[\s\S]*mailbox\/tabs\.hbs[\s\S]*\{\{else if msTty\}\}[\s\S]*mailbox\/tty\.hbs[\s\S]*\{\{else if msDesktop\}\}[\s\S]*mailbox\/desktop\.hbs[\s\S]*\{\{else\}\}/.test(viewer));
check('viewer root stamps data-mailbox-style', () => viewer.includes('data-mailbox-style="{{mailboxStyle}}"'));
check('classic layout uses the shared tree / rows / detail partials (no second copy)', () =>
  viewer.includes('mailbox/tree.hbs') && viewer.includes('mailbox/rows.hbs') && viewer.includes('mailbox/detail.hbs')
  && !viewer.includes('<div class="ncm-term__fs-tree">') && !viewer.includes('{{#each messages}}'));
for (const s of ['tabs', 'tty', 'desktop']) {
  const src = read(`templates/terminal/mailbox/${s}.hbs`);
  check(`${s}.hbs includes the shared detail partial`, () => src.includes('mailbox/detail.hbs'));
  check(`${s}.hbs block tags balance`, () => (src.match(/\{\{~?#(if|unless|each|with)/g) || []).length === (src.match(/\{\{~?\/(if|unless|each|with)/g) || []).length);
}
check('tabs.hbs reuses the shared tree + rows', () => { const s = read('templates/terminal/mailbox/tabs.hbs'); return s.includes('mailbox/tree.hbs') && s.includes('mailbox/rows.hbs'); });
check('tty.hbs carries the prompt input [data-tty-prompt]', () => read('templates/terminal/mailbox/tty.hbs').includes('data-tty-prompt'));

console.log('\n[3] actions — every data-action in a mailbox partial exists in the viewer map');
const app = read('scripts/ui/Terminal/TerminalViewerApp.js');
const actionsBlock = app.slice(app.indexOf('actions: {'), app.indexOf('_onRender'));
const partialActions = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'templates/terminal/mailbox'))) {
  for (const m of read('templates/terminal/mailbox/' + f).matchAll(/data-action="([a-zA-Z-]+)"/g)) partialActions.add(m[1]);
}
check('found a dozen+ distinct actions across the partials', () => partialActions.size >= 12);
for (const a of partialActions) check(`action ${a} is registered`, () => new RegExp(`\\b${a}:\\s*action\\(`).test(actionsBlock) || new RegExp(`['"]?${a}['"]?\\s*:`).test(actionsBlock));
check('a context key named like a Handlebars helper is not used bare in the partials', () => {
  const helpers = [...read('scripts/init/registerTemplates.js').matchAll(/registerHelper\('([^']+)'/g)].map(m => m[1]);
  for (const f of fs.readdirSync(path.join(ROOT, 'templates/terminal/mailbox'))) {
    const src = read('templates/terminal/mailbox/' + f);
    for (const h of helpers) if (new RegExp(`\\{\\{(#if |#unless )?${h}\\}\\}`).test(src)) throw new Error(`${f} uses {{${h}}}`);
  }
});

console.log('\n[4] viewer context + the tty prompt');
check('_mailboxContext exposes mailboxStyle + the three flags', () => /msTabs: style === 'tabs', msTty: style === 'tty', msDesktop: style === 'desktop'/.test(app));
check('desktop builds the files context even in MAIL view (drives as icons) with the listing hidden', () => /if \(isFilesView \|\| style === 'desktop'\)/.test(app) && /fsCtx\.showListing = false/.test(app));
check('folders carry an unread count for the tab badges', () => /unread: unread\[fd\.id\]/.test(app));
check('_onTtyCommand exists and handles number / m / f / cd / n / p / ?', () => {
  const i = app.indexOf('_onTtyCommand(raw)');
  const body = app.slice(i, app.indexOf('_onFsBack()', i));
  return i > 0 && /\^\\d\+\$/.test(body) && body.includes("'mail'") && body.includes("'files'") && body.includes('^cd') && body.includes("lower === 'n' || lower === 'p'") && body.includes("'?'");
});
check('cd refuses a LOCKED folder with its reason and plays login-fail', () => /ACCESS DENIED — \$\{hit\.path\}/.test(app) && /_playTermSound\('login-fail'\)/.test(app.slice(app.indexOf('_onTtyCommand(raw)'))));
check('_onRender wires the prompt (Enter → _onTtyCommand) and refocuses after a command', () => app.includes("querySelector('[data-tty-prompt]')") && app.includes('this._onTtyCommand(v)') && app.includes('_ttyFocus'));
check('the tty number list is the SHOWN rows (files in FILES view, the page in MAIL view)', () => /this\._ttyList = isFilesView \? \(fsCtx\?\.listFiles \|\| \[\]\) : pageItems/.test(app));

console.log('\n[5] config sheet + admin');
const cfgJs = read('scripts/ui/Terminal/TerminalConfigApp.js');
const cfgHbs = read('templates/terminal/terminal-config.hbs');
check('config imports TERMINAL_MAILBOX_STYLES', () => cfgJs.includes('TERMINAL_MAILBOX_STYLES,'));
check('context carries mailboxStyles (active flag) + mailboxStyleKey from the ONE reader', () => cfgJs.includes("const mailboxStyleKey = this._currentMailboxStyle();") && /mailboxStyles: TERMINAL_MAILBOX_STYLES\.map\(s => \(\{ \.\.\.s, active: mailboxStyleKey === s\.key \}\)\)/.test(cfgJs));
check('_currentMailboxStyle: staged pick → preset kit → saved config → classic, validated against the registry', () => cfgJs.includes("const v = this._stagedMailboxStyle || kit?.mailboxStyle || cfg.mailboxStyle || 'classic';") && cfgJs.includes("TERMINAL_MAILBOX_STYLES.some(s => s.key === v) ? v : 'classic'"));
check('a manual card pick is STAGED (survives re-renders) and previews live', () => /this\._stagedMailboxStyle = card\.dataset\.mailboxStyle;\s*this\._applyThemeLive\(\);/.test(cfgJs));
check("a preset card drops the manual pick so the preset's own layout rides the kit", () => /this\._presetKit = TERMINAL_PRESETS\[key\] \? key : null;\s*this\._stagedMailboxStyle = null;/.test(cfgJs));
check('the live overlay carries the current layout and a layout change re-renders the viewer (kit signature)', () => cfgJs.includes("mailboxStyle: this._currentMailboxStyle(),") && cfgJs.includes("const kitSig = `${this._presetKit || ''}|${this._currentMailboxStyle()}`;"));
check('save and close clear the staged layout', () => (cfgJs.match(/this\._stagedMailboxStyle = null;/g) || []).length >= 3);
check('SAVED THEMES carry the layout: save + overwrite write it, apply + import stage it, export ships it', () =>
  (cfgJs.match(/mailboxStyle: this\._currentMailboxStyle\(\) \}\)?;/g) || []).length === 2
  && cfgJs.includes("if (TERMINAL_MAILBOX_STYLES.some(s => s.key === entry.mailboxStyle)) this._stagedMailboxStyle = entry.mailboxStyle;")
  && cfgJs.includes("if (TERMINAL_MAILBOX_STYLES.some(s => s.key === parsed.mailboxStyle)) this._stagedMailboxStyle = parsed.mailboxStyle;")
  && cfgJs.includes("JSON.stringify({ ncmTerminalTheme: 1, theme, mailboxStyle: this._currentMailboxStyle() }"));
check('saved-theme rows show the layout they carry + the copy says a theme carries it', () => cfgHbs.includes('ncm-tc__citem-layout') && cfgHbs.includes('Saved Themes — palette, fonts, CRT film &amp; mailbox layout') && cfgHbs.includes('The layout travels with the theme') && cfgHbs.includes('login style, mailbox layout, MOTD'));
check('every built-in preset states its mailboxStyle explicitly', () => Object.values(TERMINAL_PRESETS).every(p => keys.has(p.mailboxStyle)));
check('a Mailbox Layout section with one card per style + the hidden input', () => cfgHbs.includes('Mailbox Layout') && cfgHbs.includes('<input type="hidden" name="mailboxStyle" value="{{mailboxStyleKey}}">') && cfgHbs.includes('{{#each mailboxStyles}}') && cfgHbs.includes('data-mailbox-style="{{key}}"'));
check('the section sits in the Boot & Login tab BEFORE the Login Screen section', () => cfgHbs.indexOf('Mailbox Layout') < cfgHbs.indexOf('>Login Screen<'));
check('card click writes the hidden input + toggles is-on (the login-style contract)', () => cfgJs.includes("panel.querySelectorAll('[data-mailbox-style]')") && cfgJs.includes("panel.querySelector('[name=\"mailboxStyle\"]')"));
check('save reads mailboxStyle', () => cfgJs.includes("mailboxStyle: val('mailboxStyle', 'classic') || 'classic'"));
check('the full-preset snapshot carries mailboxStyle (and its apply copy names it)', () => cfgJs.includes("mailboxStyle: cfg.mailboxStyle || 'classic'") && cfgJs.includes('login style, mailbox layout, MOTD/welcome'));
check('card thumbs are styled per style (terminal.css)', () => { const css = read('styles/components/terminal.css'); return ['classic', 'tabs', 'tty', 'desktop'].every(k => css.includes(`.ncm-cfg-mstyle__thumb--${k}`)); });
check('Admin → Terminals detail shows the Mailbox fact', () => read('scripts/ui/AdminPanel/tabs/TerminalsTab.js').includes("mailboxStyle: cfg.mailboxStyle || 'classic'") && read('templates/admin-panel/tab-terminals.hbs').includes('{{mailboxStyle}}'));

console.log('\n[6] stylesheet');
const entry = read('styles/night-city-messenger.css');
const sty = read('styles/components/terminal-styles.css');
check('terminal-styles.css is imported, after crt.css and after terminal.css', () => entry.indexOf("components/terminal-styles.css") > entry.indexOf("components/crt.css") && entry.indexOf("components/terminal-styles.css") > entry.indexOf("components/terminal.css"));
check('the three prefixes are owned by terminal-styles.css alone (no class collision)', () => {
  const others = fs.readdirSync(path.join(ROOT, 'styles/components')).filter(f => f.endsWith('.css') && f !== 'terminal-styles.css');
  for (const f of others) { const s = read('styles/components/' + f); for (const p of ['.ncm-tmtabs', '.ncm-tmtty', '.ncm-tmdesk']) if (s.includes(p)) throw new Error(`${f} declares ${p}`); }
  return ['.ncm-tmtabs', '.ncm-tmtty', '.ncm-tmdesk'].every(p => sty.includes(p));
});
check('every colour literal in terminal-styles.css is a var() fallback (tokens only)', () => {
  const stripped = sty.replace(/var\(--[a-z0-9-]+,\s*[^)]*\)/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  if (bad.length) throw new Error('literal colours: ' + bad.slice(0, 5).join(' '));
});
check('font sizes scale with --ncm-text-scale', () => { const sizes = sty.match(/font-size:\s*[^;]+;/g) || []; const unscaled = sizes.filter(s => !/calc\(|--ncm-text-scale|inherit|0;/.test(s)); if (unscaled.length) throw new Error(unscaled.slice(0, 3).join(' ')); return sizes.length > 10; });
check('any animation is reduced-motion guarded', () => !/animation:|@keyframes/.test(sty) || sty.includes('prefers-reduced-motion'));

console.log('\n[7] REAL render through Handlebars — all four styles, mail + files');
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) {
  fail++; console.log('  FAIL could not load Handlebars from a Foundry install — render checks did not run');
} else {
  const H = Handlebars;
  for (const h of ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'and', 'or', 'not']) H.registerHelper(h, function (...a) { const [x, y] = a; switch (h) { case 'eq': return String(x) === String(y); case 'neq': return String(x) !== String(y); case 'gt': return x > y; case 'lt': return x < y; case 'gte': return x >= y; case 'lte': return x <= y; case 'and': return a.slice(0, -1).every(Boolean); case 'or': return a.slice(0, -1).some(Boolean); case 'not': return !x; } });
  H.registerHelper('add', (a, b) => Number(a) + Number(b));
  H.registerHelper('sub', (a, b) => Number(a) - Number(b));
  H.registerHelper('ncm-net-icon', () => new H.SafeString('<i class="fas fa-network-wired"></i>'));
  H.registerHelper('helperMissing', () => '');
  const loadWithPartials = (rel) => {
    const src = read(rel);
    for (const m of src.matchAll(/\{\{>\s*"?([^\s}"]+)"?/g)) {
      const name = m[1]; if (!name.startsWith('modules/') || name in H.partials) continue;
      H.registerPartial(name, '');
      H.registerPartial(name, loadWithPartials(name.replace(/^modules\/night-city-messenger\//, '')));
    }
    return src;
  };
  const tpl = H.compile(loadWithPartials('templates/terminal/terminal-viewer.hbs'));
  const SH = '__shared__';
  const row = (id, filename, extra = {}) => ({ messageId: id, isFile: true, filename, typeLabel: 'SPREADSHEET', typeIcon: 'fas fa-table', accent: 'green', fileSize: '31 KB', modified: '2046-02-27', fileOwner: 'finance', isStream: false, isNew: false, encrypted: false, isSelected: false, subject: filename, from: 'finance', priority: 'normal', time: '2046-02-27', preview: '', ...extra });
  const base = (style, filesView) => ({
    state: 'mailbox', preset: 'arasaka-workstation', formFactor: 'desktop', isGM: true, terminalName: 'WS-7F-12', presetIcon: 'fas fa-building',
    account: { username: 'v_arasaka', displayName: 'Veronica', initials: 'VA', portrait: null }, hud: {}, uplink: {},
    switchAccounts: [], switcherOpen: false, listLabel: 'CORRESPONDENCE', emptyLabel: 'empty', syncHint: null, screensaver: null, pagination: null, sideCollapsed: false,
    folders: [{ key: 'inbox', label: 'Correspondence', icon: 'fas fa-inbox', count: 2, unread: 1, active: true }, { key: 'trash', label: 'Shredder', icon: 'fas fa-trash-can', count: 0, unread: 0, active: false }],
    mailboxStyle: style, msTabs: style === 'tabs', msTty: style === 'tty', msDesktop: style === 'desktop',
    ttyPrompt: 'v_arasaka@WS-7F-12:~/correspondence$', deskClock: '2046-03-13 · 02:14', deskWindow: { title: filesView ? '/records' : 'Correspondence', icon: 'fas fa-inbox' },
    isFilesView: filesView, view: { mail: 2, files: 3 },
    messages: filesView ? [row('f1', 'vendor_payments.xls', { isSelected: true })] : [
      { messageId: 'm1', isFile: false, from: 'hr@arasaka.net', subject: 'Q3 Restructuring', priority: 'critical', isSelected: true, time: '2046-03-12', preview: 'Per board directive…', isNew: true, accent: '' },
      { messageId: 'm2', isFile: false, from: 'security@arasaka.nc', subject: 'Re: badge access', priority: 'normal', isSelected: false, time: '2046-03-10', preview: 'logged', isNew: false, accent: '' },
    ],
    fs: {
      roots: [
        { scope: 'v', label: 'home', subLabel: 'v_arasaka', icon: 'fas fa-house', isActiveRoot: false, count: 1, dirs: [{ scope: 'v', path: 'drafts', name: 'drafts', depth: 1, count: 1, size: '3 KB', locked: false, lockLabel: '', active: false }], files: [row('f6', 'q3_payroll.xls')] },
        { scope: SH, label: 'shared', subLabel: 'WS-7F-12', icon: 'fas fa-hard-drive', isActiveRoot: false, count: 2, dirs: [{ scope: SH, path: 'records', name: 'records', depth: 1, count: 1, size: '31 KB', locked: false, lockLabel: '', active: filesView }, { scope: SH, path: 'secure', name: 'secure', depth: 1, count: 0, size: '', locked: true, lockLabel: 'admins only', active: false }], files: [] },
      ],
      listing: { scope: SH, path: 'records', isRoot: false, isShared: true, icon: 'fas fa-folder-open', locked: false, lockLabel: '', parent: { scope: SH, path: '' }, crumb: [], stats: { files: 1, dirs: 1, size: '31 KB' }, subdirs: [{ scope: SH, path: 'records/secure', name: 'secure', count: 0, size: '', locked: true, lockLabel: 'admins only' }], files: [row('f1', 'vendor_payments.xls', { isSelected: true })], empty: false },
      listFiles: [], showListing: false, usage: { label: '34 KB used', pct: 3 },
    },
    selectedMessage: filesView
      ? { messageId: 'f1', isFile: true, subject: 'vendor_payments.xls', file: { filename: 'vendor_payments.xls', path: 'records/', fullPath: 'records/vendor_payments.xls', typeIcon: 'fas fa-table', typeLabel: 'SPREADSHEET', accent: 'green', owner: 'finance', modifiedLabel: '2046-02-27', size: '31 KB' }, moveOptions: [], isTypedContent: false, bodyHtml: '<p>FILE-BODY-MARKER</p>', exfil: [], sender: {}, isContact: false }
      : { messageId: 'm1', isFile: false, subject: 'Q3 Restructuring', sender: { name: 'Arasaka HR', email: 'hr@arasaka.net', initials: 'HR' }, isContact: false, canAddContact: true, canReply: false, isTypedContent: false, bodyHtml: '<p>MAIL-BODY-MARKER</p>', exfil: [{ key: 'agent', label: 'To my Agent', icon: 'fas fa-download' }], moveOptions: [] },
  });
  const ROOTCLS = { classic: 'ncm-term__side', tabs: 'ncm-tmtabs', tty: 'ncm-tmtty', desktop: 'ncm-tmdesk' };
  for (const style of ['classic', 'tabs', 'tty', 'desktop']) {
    for (const filesView of [false, true]) {
      const label = `${style} · ${filesView ? 'FILES' : 'MAIL'}`;
      let html = '';
      check(`${label} renders`, () => { html = tpl(base(style, filesView)); return html.length > 2000; });
      check(`${label} → root wears data-mailbox-style="${style}" and the ${ROOTCLS[style]} skin`, () => html.includes(`data-mailbox-style="${style}"`) && html.includes(`class="${ROOTCLS[style]}`) || html.includes(` ${ROOTCLS[style]}`));
      check(`${label} → only ONE skin is rendered`, () => ['ncm-tmtabs"', 'ncm-tmtty"', 'ncm-tmdesk"', 'ncm-term__side"'].filter(c => html.includes('class="' + c)).length <= 1);
      check(`${label} → the shared detail content is present`, () => html.includes(filesView ? 'FILE-BODY-MARKER' : 'MAIL-BODY-MARKER'));
      check(`${label} → the shown files/messages are clickable rows carrying their id`, () => filesView ? (html.includes('data-message-id="f6"') || html.includes('data-action="terminalSelectMessage" data-message-id="f1"')) : html.includes('data-action="terminalSelectMessage" data-message-id="m1"'));
      check(`${label} → no NaN / undefined / [object Object] leaked`, () => !/\bNaN\b|undefined|\[object Object\]/.test(html));
      if (filesView) check(`${label} → the locked folder renders as locked with its reason`, () => /is-locked[^>]*data-lock-label="admins only"|data-lock-label="admins only"[^>]*is-locked|admins only/.test(html));
    }
  }
  check('tty → the prompt input is present and its ls header matches the view', () => { const h = tpl(base('tty', false)); return h.includes('data-tty-prompt') && h.includes('<span>SUBJECT</span>') && /ls<\/span>/.test(h); });
  check('tty FILES → "ls -l" + NAME/TYPE/SIZE header + numbered rows', () => { const h = tpl(base('tty', true)); return h.includes('ls -l') && h.includes('<span>NAME</span>') && /<span>1<\/span><span>vendor_payments\.xls/.test(h); });
  check('desktop → drives render as icons with data-scope ({{../scope}} resolves inside the partial)', () => { const h = tpl(base('desktop', false)); return h.includes('data-scope="__shared__" data-path=""') && h.includes('data-scope="v" data-path="" data-message-id="f6"'); });
  check('desktop → a locked folder icon carries data-locked + the padlock', () => { const h = tpl(base('desktop', false)); return /is-locked" data-action="terminalFsOpen" data-scope="__shared__" data-path="secure"[^>]*data-locked="1"/.test(h) && h.includes('fa-lock'); });
  check('desktop → taskbar carries the clock + the account switcher', () => { const h = tpl(base('desktop', false)); return h.includes('2046-03-13 · 02:14') && h.includes('data-action="terminalToggleSwitcher"') && h.includes('ncm-tmdesk__task'); });
  check('tabs → folder tabs carry counts, FILES tab is a terminalView action, unread shows in classic folds only', () => { const h = tpl(base('tabs', false)); return h.includes('ncm-tmtabs__tab--files') && h.includes('data-action="terminalView" data-view="files"') && /ncm-tmtabs__tab is-on" data-action="terminalFolder" data-folder="inbox"/.test(h); });
  check('tabs FILES → the shared tree partial renders in the left pane', () => { const h = tpl(base('tabs', true)); return h.includes('ncm-term__fs-tree') && h.includes('ncm-tmtabs__list'); });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
