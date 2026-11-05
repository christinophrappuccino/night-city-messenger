// Sim: HTML injection through toasts and admin rendering (audit remediation A4a:
// SEC-03, SEC-11, SEC-12, SEC-19).
//
// Foundry 12 renders `ui.notifications` text as HTML, so a character named
// `<img src=x onerror=…>` ran script on whoever saw a toast (often the GM).
// A4a routes every NCM toast through ncmNotify (scripts/utils/notify.js), which
// escapes the message, and escapes the names in the Admin Overview activity
// feed and the composer's To autocomplete.
//
// Checks: the ncmNotify contract (escape, options, ids, localize, dynamic
// method, no ui); a regression guard that no module code calls
// `ui.notifications` directly; the Overview builders; and the REAL
// MessageComposerApp._renderAutocomplete driven with a hostile name.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const HOSTILE = '<img src=x onerror="window.__pwned=1">';

// ── Foundry stand-ins ──
const shown = [];
const fakeNotifications = {
  _id: 0,
  info(m, o) { shown.push({ kind: 'info', m, o }); return ++this._id; },
  warn(m, o) { shown.push({ kind: 'warn', m, o }); return ++this._id; },
  error(m, o) { shown.push({ kind: 'error', m, o }); return ++this._id; },
  notify(m, t, o) { shown.push({ kind: `notify:${t}`, m, o }); return ++this._id; },
};
globalThis.ui = { notifications: fakeNotifications };
globalThis.game = {
  user: { id: 'gm1', isGM: true },
  users: [],
  actors: { get: () => null, [Symbol.iterator]: function* () {} },
  settings: { get: () => { throw new Error('none'); } },
  i18n: { localize: (k) => (k === 'NCM.Test' ? 'Hello <b>world</b>' : k) },
  nightcity: {},
};
globalThis.foundry = { utils: { randomID: () => 'x', mergeObject: (a, b) => ({ ...a, ...b }), deepClone: (x) => JSON.parse(JSON.stringify(x)) }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c } } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };

const { ncmNotify, escapeHtml } = await import(pathToFileURL(`${ROOT}/scripts/utils/notify.js`).href);

// ═══ 1. ncmNotify contract ═══
{
  shown.length = 0;
  const id = ncmNotify.warn(`NCM | ${HOSTILE} tripped a trace`, { permanent: true });
  ok(typeof id === 'number', 'ncmNotify returns the notification id like ui.notifications does');
  ok(shown[0].kind === 'warn' && shown[0].o?.permanent === true, 'method and options pass through');
  ok(!shown[0].m.includes('<img') && shown[0].m.includes('&lt;img'), 'the message reaches Foundry escaped');
  ok(shown[0].m.includes('"window.__pwned=1"'), 'quotes are left alone in toast text (element body, renders the same)');

  shown.length = 0;
  ncmNotify.info('Q&A > notes'); ncmNotify.error('a < b');
  ok(shown[0].m === 'Q&amp;A &gt; notes' && shown[1].m === 'a &lt; b', '& < > escaped, so they display as themselves');

  shown.length = 0;
  ncmNotify.info('Plain text, no markup.');
  ok(shown[0].m === 'Plain text, no markup.', 'plain text is unchanged');

  shown.length = 0;
  ncmNotify.info(undefined); ncmNotify.info(42); ncmNotify.warn(new Error('boom'));
  ok(shown[0].m === '' && shown[1].m === '42' && shown[2].m === 'Error: boom', 'non-strings are stringified safely');

  shown.length = 0;
  ncmNotify.info('NCM.Test', { localize: true });
  ok(shown[0].m === 'Hello &lt;b&gt;world&lt;/b&gt;' && shown[0].o.localize === false, 'localize: the KEY is looked up first, then escaped; Foundry is not asked to localize again');

  shown.length = 0;
  ncmNotify.notify(HOSTILE, 'warning', { permanent: true });
  ok(shown[0].kind === 'notify:warning' && shown[0].m.startsWith('&lt;img'), 'notify(message, type, options) escapes and passes the type');

  shown.length = 0;
  const ok2 = true;
  ncmNotify[ok2 ? 'info' : 'warn'](HOSTILE);
  ok(shown[0].kind === 'info' && shown[0].m.startsWith('&lt;img'), 'the dynamic form ncmNotify[cond ? … : …](…) works');

  const saved = globalThis.ui; globalThis.ui = undefined;
  let threw = false; let r;
  try { r = ncmNotify.warn('no ui yet'); } catch { threw = true; }
  ok(!threw && r === undefined, 'no ui (very early startup) → returns undefined, never throws');
  globalThis.ui = saved;

  ok(Object.isFrozen(ncmNotify), 'ncmNotify is frozen (cannot be swapped out at runtime)');
  ok(escapeHtml(`a"b'c<d>&`) === 'a&quot;b&#39;c&lt;d&gt;&amp;', 'escapeHtml covers & < > " \' (safe in attributes too)');
  ok(escapeHtml(null) === '' && escapeHtml(0) === '0', 'escapeHtml handles null and numbers');
}

// ═══ 2. Regression guard: no module code calls ui.notifications directly ═══
{
  const files = [];
  (function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p.replace(/\\/g, '/')); } })(`${ROOT}/scripts`);
  const offenders = [];
  for (const f of files) {
    if (f.endsWith('/scripts/utils/notify.js')) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('ui.notifications')) return;
      // Allowed: code GENERATED as a string for a user macro (NCM's imports don't exist there).
      if (f.endsWith('/scripts/utils/accessPoints.js') && /return `const NCM = game\.nightcity;/.test(line)) return;
      // Allowed: comments
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      offenders.push(`${f.replace(ROOT + '/', '')}:${i + 1}`);
    });
  }
  ok(offenders.length === 0, `no direct ui.notifications call in module code (${offenders.slice(0, 8).join(', ') || 'ok'}${offenders.length > 8 ? '…' : ''})`);

  // every file that uses ncmNotify imports it, with a path that resolves to notify.js
  const missing = [], badPath = [];
  for (const f of files) {
    if (f.endsWith('/scripts/utils/notify.js')) continue;
    const src = readFileSync(f, 'utf8');
    if (!/\bncmNotify\b/.test(src)) continue;
    const m = src.match(/import\s*\{[^}]*\bncmNotify\b[^}]*\}\s*from\s*'([^']+)'/);
    if (!m) { missing.push(f.replace(ROOT + '/', '')); continue; }
    const target = new URL(m[1], pathToFileURL(f)).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    if (!target.replace(/\\/g, '/').endsWith('/scripts/utils/notify.js')) badPath.push(f.replace(ROOT + '/', ''));
  }
  ok(missing.length === 0, `every file using ncmNotify imports it (${missing.join(', ') || 'ok'})`);
  ok(badPath.length === 0, `every ncmNotify import resolves to utils/notify.js (${badPath.join(', ') || 'ok'})`);

  // notify.js has no imports (it is imported almost everywhere; an import could create a cycle)
  ok(!/^\s*import\s/m.test(readFileSync(`${ROOT}/scripts/utils/notify.js`, 'utf8')), 'notify.js imports nothing');

  // the generated macro code still uses ui.notifications (it runs where NCM imports do not exist)
  ok(/ui\.notifications\.warn\("Night City Messenger is not active\."\)/.test(readFileSync(`${ROOT}/scripts/utils/accessPoints.js`, 'utf8')), 'generated access-point macro code is untouched');
}

// ═══ 3. SEC-11: every value in the Overview activity builders is escaped ═══
{
  const src = readFileSync(`${ROOT}/scripts/ui/AdminPanel/AdminPanelApp.js`, 'utf8');
  ok(/import \{ escapeHtml as h \} from '\.\.\/\.\.\/utils\/notify\.js';/.test(src), 'AdminPanelApp imports the escape helper');
  const calls = [...src.matchAll(/this\.tabs\.overview\.logActivity\([^`]*`([^`]*)`/g)].map((m) => m[1]);
  ok(calls.length >= 9, `found the Overview activity builders (${calls.length})`);
  const raw = calls.flatMap((t) => [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim())).filter((e) => !/^h\(/.test(e));
  ok(raw.length === 0, `every \${…} in an Overview activity row goes through h() (${raw.join(' | ') || 'ok'})`);
  const shards = readFileSync(`${ROOT}/scripts/ui/AdminPanel/tabs/ShardsTab.js`, 'utf8');
  ok(/text: `<span class="ncm-activity-actor">\$\{escapeHtml\(actorName\)\}<\/span> \$\{escapeHtml\(text\)\} — <span class="ncm-activity-shard">\$\{escapeHtml\(shardName\)\}<\/span>`/.test(shards), 'ShardsTab activity rows escape their names too');
}

// ═══ 4. SEC-12: the REAL composer autocomplete, fed a hostile name ═══
{
  const { MessageComposerApp } = await import(pathToFileURL(`${ROOT}/scripts/ui/MessageComposer/MessageComposerApp.js`).href);
  let html = '';
  const dropdown = {
    classList: { add() {}, remove() {} },
    set innerHTML(v) { html = v; }, get innerHTML() { return html; },
    querySelectorAll: () => [],
  };
  const t = {
    element: { querySelector: (sel) => (sel.includes('autocomplete-dropdown') ? dropdown : null) },
    _selectedResultIndex: 0,
    fromContact: { name: HOSTILE },
    _searchResults: [
      { name: HOSTILE, email: `${HOSTILE}@nc.net`, initials: '<b>', actorId: 'a"b', known: true, unreachableLabel: HOSTILE },
      { isGroup: true, groupId: 'g"1', name: HOSTILE, memberCount: 2, memberNames: HOSTILE, img: 'x.png" onerror="y' },
    ],
  };
  MessageComposerApp.prototype._renderAutocomplete.call(t, HOSTILE);
  ok(html.length > 0, 'the autocomplete rendered');
  ok(!/<img src=x/.test(html), 'no raw hostile <img> tag in the dropdown');
  ok(!/onerror="window/.test(html) && !/" onerror="y/.test(html), 'no attribute break-out (onerror) in the dropdown');
  ok(html.includes('&lt;img src=x onerror=&quot;window.__pwned=1&quot;&gt;'), 'the name shows as text');
  ok(html.includes('data-raw="&lt;img'), 'the raw-address fallback attribute is escaped (dataset decodes it back)');
  ok(html.includes('data-actor-id="a&quot;b"') && html.includes('data-group-id="g&quot;1"'), 'ids in data-* attributes are escaped');
  // the "In X's contacts" tooltip is escaped twice (Foundry renders tooltips as HTML)
  ok(html.includes('data-tooltip="In &amp;lt;img'), 'tooltip text is escaped twice');
}

console.log(`test-safe-html: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
