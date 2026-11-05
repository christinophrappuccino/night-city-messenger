// Sim: start-up order + helper independence (audit remediation C1: COMPAT-01, FBL-07, FBL-01).
//
//   COMPAT-01  init awaited ~110 template fetches BEFORE registering settings, the canvas layer, keybindings and the
//              @NCM enricher. Foundry does not await an async init hook, so on a slow host those landed after init
//              ended: the keybindings threw ("You cannot register a Keybinding after the init hook").
//   FBL-07     the ready phase did not wait for init, so ready tasks could read settings not yet registered.
//   FBL-01     16 template spots only worked with NCM's own block/n-ary comparison helpers; another module's
//              2-argument helpers (social-navigator registers eq/and/or… in init) would break them.
//
// 1. Loads the REAL scripts/main.js with a fake Foundry, fires `init` and checks every registration happened before
//    the hook returned, while the template fetch is still pending; then that `ready` waits for it.
// 2. Renders the converted template spots through the REAL Handlebars with social-navigator's helpers loaded AFTER
//    NCM's (when that module is installed).
// 3. Guard: no comparison BLOCK helper and no and/or with more than 2 arguments anywhere in templates/.
import { FOUNDRY_APP_DIRS } from './lib/foundryApp.mjs';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ═══ 1. Start-up order (a fake Foundry) ═══
{
  const hooks = { once: {}, on: {} };
  let initEnded = false;
  const reg = { settings: 0, keybindings: 0, helpers: new Set(), layers: false, enrichers: 0, readyTask: false, settingsLate: [] };
  let releaseTemplates;
  const templatesPending = new Promise((r) => { releaseTemplates = r; });
  const noop = () => {};
  const C = class { constructor() {} static get DEFAULT_OPTIONS() { return {}; } };
  globalThis.Hooks = {
    once: (n, fn) => { (hooks.once[n] ||= []).push(fn); },
    on: (n, fn) => { (hooks.on[n] ||= []).push(fn); return 1; },
    off: noop, call: noop, callAll: noop,
  };
  globalThis.CONFIG = { Canvas: { layers: {} }, TextEditor: { enrichers: [] } };
  Object.defineProperty(CONFIG.Canvas.layers, 'ncmControls', { set(v) { reg.layers = !initEnded && !!v; this._ncm = v; }, get() { return this._ncm; }, configurable: true });
  const enr = CONFIG.TextEditor.enrichers; const push = enr.push.bind(enr);
  enr.push = (...a) => { if (!initEnded) reg.enrichers += a.length; return push(...a); };
  globalThis.InteractionLayer = class { static get layerOptions() { return {}; } };
  globalThis.Handlebars = { registerHelper: (n) => { if (!initEnded) reg.helpers.add(n); }, registerPartial: noop, escapeExpression: (s) => String(s ?? ''), SafeString: class { constructor(s) { this.s = s; } toString() { return this.s; } } };
  globalThis.loadTemplates = () => templatesPending;
  globalThis.foundry = {
    utils: { mergeObject: (a, b) => ({ ...a, ...b }), deepClone: (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o))), randomID: () => 'r', getRoute: (p) => p },
    applications: { api: { ApplicationV2: C, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: C }, instances: new Map(), apps: {} },
    canvas: { layers: { InteractionLayer: globalThis.InteractionLayer } },
  };
  for (const n of ['Application', 'FormApplication', 'Dialog', 'DocumentSheet', 'ImagePopout', 'FilePicker', 'DocumentOwnershipConfig', 'TextEditor', 'ContextMenu']) globalThis[n] ??= C;
  globalThis.CONST = { KEYBINDING_PRECEDENCE: { NORMAL: 0, PRIORITY: 1, DEFERRED: 2 }, DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };
  globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 };
  globalThis.ui = { notifications: { info: noop, warn: noop, error: noop } };
  globalThis.game = {
    user: { id: 'gm', isGM: true },
    users: Object.assign([], { get: () => null, find: () => null, filter: () => [] }),
    settings: {
      register: () => { if (!initEnded) reg.settings += 1; },
      registerMenu: noop,
      // log.debug asks for debugMode while the first tasks are logged; it is guarded and falls back to quiet.
      get: (m, k) => { if (!reg.settings && k !== 'debugMode') reg.settingsLate.push(k); return undefined; },
      settings: new Map(),
    },
    keybindings: { register: () => { if (initEnded) throw new Error('You cannot register a Keybinding after the init hook'); reg.keybindings += 1; } },
    modules: new Map(), system: { id: 'cyberpunk-red-core' }, world: { id: 'w' },
  };
  try {
    await import(pathToFileURL(`${ROOT}/scripts/main.js`).href);
  } catch (err) {
    ok(false, `main.js imports with a fake Foundry (${err.message})`);
  }
  ok((hooks.once.init || []).length === 1 && (hooks.once.ready || []).length === 1, 'main.js registers one init and one ready hook');
  const initFn = hooks.once.init?.[0];
  if (initFn) {
    const r = initFn();
    initEnded = true;   // Foundry carries on the moment the hook returns
    ok(!(r && typeof r.then === 'function'), 'the init hook is not async (Foundry would not wait for it)');
    ok(reg.settings > 50, `settings registered before init ended (${reg.settings})`);
    ok(reg.keybindings >= 1, `keybindings registered before init ended (${reg.keybindings})`);
    ok(reg.layers, 'the canvas layer is in CONFIG before init ended');
    ok(reg.enrichers >= 1, 'the @NCM enricher is registered before init ended');
    ok(['eq', 'and', 'or', 'not', 'ncm-tip'].every((h) => reg.helpers.has(h)), 'the Handlebars helpers are registered before init ended');
    ok(!reg.settingsLate.length, `nothing read a setting before settings were registered${reg.settingsLate.length ? ` (${reg.settingsLate.join(', ')})` : ''}`);
  }
  // ready waits for init to finish (the template fetch is still pending)
  const readyFn = hooks.once.ready?.[0];
  if (readyFn) {
    const logs = [];
    const orig = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
    const p = readyFn();
    await new Promise((r) => setTimeout(r, 30));
    const ranEarly = logs.some((l) => /Running phase: ready/.test(l));
    console.log = orig;
    ok(!ranEarly, 'ready does not run while init is still loading templates');
    releaseTemplates();
    await Promise.race([p, new Promise((r) => setTimeout(r, 200))]);
  }
}

// ═══ 2. The converted spots render with another module's 2-argument helpers ═══
let HB = null;
for (const p of [...FOUNDRY_APP_DIRS]) {
  if (!existsSync(`${p}/package.json`)) continue;
  try { HB = createRequire(`${p}/package.json`)('handlebars'); break; } catch { /* keep looking */ }
}
const SN = `${ROOT}/../social-navigator/scripts/utils/handlebars-helpers.js`;
if (!HB) console.log('test-init-order: section 2 SKIPPED (no Foundry install found for Handlebars)');
else {
  const src = readFileSync(`${ROOT}/scripts/init/registerTemplates.js`, 'utf8').split('\r').join('');
  const body = src.match(/function _isBlock[\s\S]*?\n}\n/)[0] + src.match(/function _isOptions[\s\S]*?\n}\n/)[0]
    + src.match(/    Handlebars\.registerHelper\('eq'[\s\S]*?Handlebars\.registerHelper\('not'[\s\S]*?\}\);/)[0];
  new Function('Handlebars', body)(HB);
  let snLoaded = false;
  if (existsSync(SN)) {
    globalThis.Handlebars = HB;
    try { const m = await import(pathToFileURL(SN).href); m.registerHandlebarsHelpers?.(); snLoaded = true; } catch (err) { console.log(`test-init-order: social-navigator helpers not loadable (${err.message}) — rendering with NCM's only`); }
  }
  // the module still also works with ONLY plain 2-argument helpers, whoever registered them
  if (!snLoaded) for (const [n, f] of Object.entries({ eq: (a, b) => a === b, and: (a, b) => a && b, or: (a, b) => a || b, not: (a) => !a })) HB.registerHelper(n, f);
  const empty = HB.compile(readFileSync(`${ROOT}/templates/message-viewer/partials/empty-state-list.hbs`, 'utf8'));
  const want = { inbox: 'fa-inbox', unread: 'fa-check-double', sent: 'fa-paper-plane', saved: 'fa-bookmark', spam: 'fa-shield-alt', trash: 'fa-recycle', other: 'fa-inbox' };
  for (const [filter, icon] of Object.entries(want)) {
    const html = empty({ currentFilter: filter });
    ok(html.includes(icon) && (html.match(/<i class="fas /g) || []).length === 1, `empty list "${filter}" shows its one icon${snLoaded ? ' (social-navigator helpers loaded last)' : ''}`);
  }
  ok(/All caught up/.test(empty({ currentFilter: 'unread' })) && /Hit <strong>Compose/.test(empty({ currentFilter: 'sent' })), 'and its words');
  const line = readFileSync(`${ROOT}/templates/message-viewer/message-viewer.hbs`, 'utf8').split(/\r?\n/).find((l) => /\(and \(eq currentFilter 'unread'\) counts\.unread\)/.test(l));
  const div = HB.compile(`${line}STRIP{{/if}}`);
  ok(!/STRIP/.test(div({ counts: { unread: 2 }, currentFilter: 'inbox' })) && /STRIP/.test(div({ counts: { unread: 2 }, currentFilter: 'unread' })) && !/STRIP/.test(div({ counts: { unread: 0 }, currentFilter: 'unread' })), 'the drafts/scheduled divider shows exactly when it should');
}

// ═══ 3. Guard: templates use only 2-argument subexpressions ═══
{
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.hbs') ? [join(d, e.name)] : []));
  const argsOf = (s, i) => { const out = []; let depth = 0, cur = '', q = null; for (; i < s.length; i++) { const c = s[i]; if (q) { cur += c; if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; cur += c; continue; } if (c === '(') { depth++; cur += c; continue; } if (c === ')') { if (!depth) { if (cur.trim()) out.push(cur.trim()); return out; } depth--; cur += c; continue; } if (/\s/.test(c) && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; } cur += c; } return out; };
  const bad = [];
  for (const f of walk(`${ROOT}/templates`)) {
    const s = readFileSync(f, 'utf8').replace(/\{\{!--[\s\S]*?--\}\}/g, '').replace(/\{\{![\s\S]*?\}\}/g, '');
    const re = /\{\{\{?~?([\s\S]*?)~?\}?\}\}/g; let m;
    while ((m = re.exec(s))) {
      const b = m[1];
      if (/^\s*#(eq|neq|gt|lt|gte|lte|and|or|not)\b/.test(b)) bad.push(`${f}: block {{#${b.trim().split(/\s/)[0].slice(1)}}}`);
      const sub = /\((and|or)\s/g; let k;
      while ((k = sub.exec(b))) if (argsOf(b, k.index + k[0].length).length > 2) bad.push(`${f}: (${k[1]} …) with more than 2 arguments`);
    }
  }
  ok(!bad.length, `templates use comparison helpers only as 2-argument subexpressions${bad.length ? `: ${bad.slice(0, 3).join(' | ')}` : ''}`);
}

console.log(`test-init-order: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
