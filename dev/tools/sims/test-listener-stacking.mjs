// Sim: handlers bound once, not once per render (audit remediation D4: PERF-02, PERF-03).
//
//   PERF-02  Create Network added an Enter handler to its window frame on every render (the frame survives renders)
//            and _doCreate had no in-flight guard: after N re-renders one Enter created N networks.
//   PERF-03  the composer added a keydown handler to its frame and a selectionchange handler to the page on every
//            render; close() removed only the last — Escape closed N times, and closed composers stayed in memory.
// Runs the REAL method source (lifted from the files) on fake elements that count listeners.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').split('\r').join('');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The source of one method (by name) out of a class file. */
const grab = (src, name) => {
  const at = src.search(new RegExp(`\\n  (?:async )?${name}\\(`));
  if (at < 0) throw new Error(`no ${name}`);
  const open = src.indexOf('{', src.indexOf(')', at));
  let d = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') d++; if (src[i] === '}' && --d === 0) break; }
  return src.slice(at, i + 1);
};
const counter = () => {
  const ls = new Map();
  return {
    ls,
    addEventListener(t, fn) { (ls.get(t) || ls.set(t, new Set()).get(t)).add(fn); },
    removeEventListener(t, fn) { ls.get(t)?.delete(fn); },
    count(t) { return ls.get(t)?.size || 0; },
    fire(t, e) { for (const fn of [...(ls.get(t) || [])]) fn(e); },
  };
};

// ═══ 1. Composer: keydown on the frame ═══
const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
{
  const MessageComposerApp = { _onSend() { this.sent = (this.sent || 0) + 1; }, _onQueueMessage() {} };
  const C = new Function('MessageComposerApp', `return class { ${grab(comp, '_setupKeyboardShortcuts')} }`)(MessageComposerApp);
  const c = new C();
  c.element = counter();
  let closes = 0; c.close = () => { closes += 1; };
  c._setupKeyboardShortcuts(); c._setupKeyboardShortcuts(); c._setupKeyboardShortcuts();   // three renders
  ok(c.element.count('keydown') === 1, 'three renders leave ONE keydown handler on the composer frame');
  c.element.fire('keydown', { key: 'Escape', preventDefault() {} });
  ok(closes === 1, 'Escape closes once');
}

// ═══ 2. Composer: selectionchange on the page ═══
{
  globalThis.document = counter();
  const editor = counter();
  const C = new Function(`return class { ${grab(comp, '_setupEditorStateTracking')} }`)();
  const c = new C();
  c.element = { querySelector: (s) => (s.includes('editor-content') ? editor : null), contains: () => false };
  c._setupEditorStateTracking(); c._setupEditorStateTracking(); c._setupEditorStateTracking();
  ok(document.count('selectionchange') === 1, 'three renders leave ONE page-wide selectionchange handler');
  // close() removes it
  const closeSrc = comp.slice(comp.indexOf('if (this._editorStateHandler) {'), comp.indexOf('this._editorStateHandler = null;') + 40);
  ok(/document\.removeEventListener\('selectionchange', this\._editorStateHandler\)/.test(closeSrc), 'close() removes it');
  document.removeEventListener('selectionchange', c._editorStateHandler);
  ok(document.count('selectionchange') === 0, '…leaving nothing behind (closed composers can be freed)');
}

// ═══ 3. Create Network: one create at a time ═══
const cnd = read('scripts/ui/NetworkManagement/CreateNetworkDialog.js');
{
  const C = new Function(`return class { ${grab(cnd, '_doCreate')} }`)();
  const d = new C();
  let creates = 0;
  d._doCreateNow = async () => { creates += 1; await sleep(30); return 'net'; };
  const [a, b, c2] = await Promise.all([d._doCreate(false), d._doCreate(false), d._doCreate(true)]);
  ok(creates === 1 && a === 'net' && b === undefined && c2 === undefined, 'Enter + clicks while the first create is saving make ONE network');
  await d._doCreate(false);
  ok(creates === 2, 'a later create still works (the guard lets go)');
  d._doCreateNow = async () => { throw new Error('bad'); };
  await d._doCreate(false).catch(() => {});
  d._doCreateNow = async () => { creates += 1; };
  await d._doCreate(false);
  ok(creates === 3, 'a failed create does not leave the dialog stuck');
}
ok(/if \(!this\._enterBound\) \{\s*this\._enterBound = true;\s*html\.addEventListener\('keydown'/.test(cnd), 'Create Network binds its Enter handler once');

// ═══ 4. Create Network actually opens: its template renders ONE root element ═══
// (Found by the D4 Foundry run: the footer sat beside the body, AppV2 refused the part — "must render a single HTML
// element" — and the dialog had not opened since the AppV2 port.)
{
  const { existsSync } = await import('fs');
  const { createRequire } = await import('module');
  let HB = null;
  for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app']) {
    if (!existsSync(`${p}/package.json`)) continue;
    try { HB = createRequire(`${p}/package.json`)('handlebars'); break; } catch { /* keep looking */ }
  }
  if (!HB) console.log('test-listener-stacking: section 4 SKIPPED (no Foundry install found for Handlebars)');
  else {
    const reg = read('scripts/init/registerTemplates.js');
    const body = reg.match(/function _isBlock[\s\S]*?\n}\n/)[0] + reg.match(/function _isOptions[\s\S]*?\n}\n/)[0]
      + reg.match(/    Handlebars\.registerHelper\('eq'[\s\S]*?Handlebars\.registerHelper\('not'[\s\S]*?\}\);/)[0];
    new Function('Handlebars', body)(HB);
    HB.registerHelper('ncm-tip', (v) => String(v ?? ''));
    HB.helperMissing = function () { return ''; };
    const html = HB.compile(read('templates/dialogs/create-network.hbs'))({ data: { theme: {}, security: {}, availability: {} }, presets: [{ key: 'blank', label: 'Blank', active: true }] });
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    let depth = 0, roots = 0;
    for (const m of html.matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
      const n = m[1].toLowerCase(), closing = m[0][1] === '/', self = m[2] === '/' || VOID.has(n);
      if (closing) depth--; else { if (depth === 0) roots++; if (!self) depth++; }
    }
    ok(roots === 1 && depth === 0, `the Create Network template renders one root element (${roots})`);
    ok(/ncm-create-net__footer/.test(html), '…with the footer buttons inside it');
  }
}

console.log(`test-listener-stacking: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
