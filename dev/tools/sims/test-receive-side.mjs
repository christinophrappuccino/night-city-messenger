// Sim: what a client accepts from another client (audit remediation A5b:
// SEC-09, SEC-10, SEC-20, SEC-23 / FBL-04).
//
//   SEC-09  a watch picture or edit is taken only from the share's operator, and only
//           data-* keys, plain class names and safe custom properties reach the copy's root.
//   SEC-20  cleanMirror is an allowlist (elements, URL attributes, inline styles).
//   SEC-10  the overheard HUD takes messages only from a GM, and a line's HTML is
//           rebuilt on receipt: text plus the garble spans, nothing else.
//   SEC-23  a picture path inside url('…') cannot close the CSS string ({{ncm-css-url}} / cssUrl).
//   FBL-04  stored mail keeps a module token only as a whole colour/font value, no fallback.
//
// cleanMirror itself needs a real DOM: the Foundry macro dev/tools/test-a5b-receive-side.macro.js
// runs it with a hostile picture. Here: the pure rules, the real WatchService and
// OverheardService socket handlers, a real Handlebars render, and source guards.
import fs from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (rel) => fs.readFileSync(join(ROOT, rel), 'utf8');
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const walk = (dir, ext, out = []) => { for (const e of fs.readdirSync(join(ROOT, dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`; e.isDirectory() ? walk(p, ext, out) : p.endsWith(ext) && out.push(p); } return out; };

// ── Foundry stand-ins ──
const users = new Map([['gm', { id: 'gm', isGM: true, active: true }], ['p1', { id: 'p1', isGM: false, active: true }], ['p2', { id: 'p2', isGM: false, active: true }]]);
globalThis.game = {
  user: { id: 'p1', name: 'Player', isGM: false },
  users: { get: (id) => users.get(id) || null, activeGM: users.get('gm'), filter: (fn) => [...users.values()].filter(fn), [Symbol.iterator]: () => users.values() },
  settings: { get: () => undefined }, actors: { get: () => null }, nightcity: {}, i18n: { localize: (s) => s },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'id' } };
globalThis.Hooks = { on() {}, once() {}, off() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.CONFIG = {};
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? ''), registerHelper() {} };

// ═══ 1. cssUrl (SEC-23) ═══
const { cssUrl, registerTipHelper, escapeHtml } = await imp('scripts/utils/notify.js');
ok(cssUrl('worlds/x/a b.webp') === 'worlds/x/a b.webp', 'a plain relative path is unchanged');
ok(cssUrl('https://cdn.example/p.png') === 'https://cdn.example/p.png', 'http(s) kept');
ok(cssUrl('data:image/png;base64,AAAA') === 'data:image/png;base64,AAAA', 'data:image kept');
ok(cssUrl('javascript:alert(1)') === '' && cssUrl('java\tscript:alert(1)') === '' && cssUrl('data:text/html,<b>') === '', 'other schemes refused');
const breakout = "img/x');position:fixed;inset:0;background:red;('";
const cu = cssUrl(breakout);
ok(!/['"()]/.test(cu), 'quotes and brackets are CSS-escaped');
ok(cu.startsWith('img/x\\27 \\29 ;position:fixed'), 'escaped as CSS hex escapes');
ok(cssUrl("x');position:fixed") === '', 'a path that reads as an unknown scheme is refused');
ok(cssUrl(null) === '' && cssUrl('') === '', 'empty → empty');

// ═══ 2. A real Handlebars render of url('{{ncm-css-url}}') ═══
let H = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { H = createRequire(p)('handlebars').create(); break; } catch { /* next */ }
}
if (!H) { fail++; console.error('FAIL: could not load Handlebars — render checks did not run'); }
else {
  registerTipHelper(H);
  const html = H.compile(`<span style="background-image:url('{{ncm-css-url img}}')"></span>`)({ img: breakout });
  const decoded = /style="([^"]*)"/.exec(html)[1].replace(/&#x27;/g, "'").replace(/&#x3D;/g, '=').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  // Everything the browser's CSS parser sees stays inside the one url('…').
  ok(/^background-image:url\('[^']*'\)$/.test(decoded), `the path cannot close the CSS string (${decoded.slice(0, 60)})`);
  ok(H.compile(`{{ncm-css-url img}}`)({ img: 'javascript:alert(1)' }) === '', 'a script URL renders as nothing');
}

// ═══ 3. Every url('…') with a value goes through the escape ═══
const bareTpl = [];
for (const f of walk('templates', '.hbs')) for (const m of read(f).matchAll(/url\(\s*['"]?\{\{(?!ncm-css-url\b)([^}]*)\}\}/g)) bareTpl.push(`${f}: ${m[1]}`);
ok(bareTpl.length === 0, `templates: url('{{…}}') uses ncm-css-url (${bareTpl.slice(0, 4).join(' | ')})`);
const bareJs = [];
for (const f of walk('scripts', '.js')) for (const m of read(f).matchAll(/url\(\s*['"]\$\{(?!cssUrl\(|esc\(cssUrl\()([^}]*)\}/g)) bareJs.push(`${f}: ${m[1]}`);
ok(bareJs.length === 0, `code: url('\${…}') uses cssUrl (${bareJs.slice(0, 4).join(' | ')})`);

// ═══ 4. cleanStyle keeps tokens only as whole colour/font values (FBL-04) ═══
const { cleanHtml } = await imp('scripts/utils/richText.js');
const c = (h) => cleanHtml(h, { mode: 'mail' });
ok(!/position|inset/.test(c('<p style="position:var(--ncm-x,fixed);inset:var(--ncm-x,0)">y</p>')), 'a var() fallback cannot smuggle position / inset');
ok(!/style/.test(c('<span style="color:var(--ncm-x, red)">z</span>')), 'a token with a fallback is dropped');
ok(!/style/.test(c('<span style="width:var(--ncm-big)">z</span>')), 'a token on a layout property is dropped');
ok(c('<span style="color:var(--ncm-secondary);font-family:var(--ncm-font-mono);font-size:0.9em">t</span>') === '<span style="color:var(--ncm-secondary);font-family:var(--ncm-font-mono);font-size:0.9em">t</span>', "the composer's own timestamp insert survives unchanged");
ok(/background-color:var\(--ncm-accent\)/.test(c('<b style="background-color:var(--ncm-accent)">k</b>')), 'a token on background-color is kept');
ok(/border-top:1px solid var\(--ncm-border\)/.test(c('<div class="ncm-signature" style="border-top:1px solid var(--ncm-border)">s</div>')), "the old signature block's thin border is kept");
ok(c('<p style="border:900px solid var(--ncm-x);border-top:1px solid var(--ncm-x, red)">a</p>') === '<p>a</p>', 'a thick border, or one with a fallback, is dropped');

// ═══ 5. The watch mirror rules (SEC-09 / SEC-20) ═══
const { mirrorUrlOk, mirrorVars, mirrorClasses, mirrorData, mirrorStyle } = await imp('scripts/utils/watchMirror.js');
ok(mirrorUrlOk('modules/x.png') && mirrorUrlOk('https://a/b') && mirrorUrlOk('#frag') && mirrorUrlOk('data:image/png;base64,AA') && mirrorUrlOk(''), 'safe URLs pass');
ok(!mirrorUrlOk('javascript:alert(1)') && !mirrorUrlOk('java\tscript:alert(1)') && !mirrorUrlOk(' JAVASCRIPT:x') && !mirrorUrlOk('data:text/html,x') && !mirrorUrlOk('vbscript:x'), 'script URLs fail, tab or case tricks included');
ok(JSON.stringify(mirrorData({ 'data-terminal-preset': 'arasaka', onanimationstart: 'alert(1)', 'data-x" onload="y': 1, style: 'x' })) === '{"data-terminal-preset":"arasaka"}', 'only data-* keys reach the copy root');
ok(mirrorClasses('ncm-app ncm-terminal-app " onload=x <b>') === 'ncm-app ncm-terminal-app', 'only plain class names');
ok(mirrorVars("--ncm-primary:#f00;color:red;--x:url(javascript:alert(1));--y:}body{display:none;--ncm-wallpaper:url('worlds/w.webp')") === "--ncm-primary:#f00;--ncm-wallpaper:url('worlds/w.webp')", 'only safe custom properties');
ok(mirrorStyle('color:red;background:url(javascript:x);width:expression(alert(1))') === 'color:red', 'inline styles drop script URLs and expression()');
ok(mirrorStyle("background-image:url('modules/a.png')") === "background-image:url('modules/a.png')", 'an inline picture survives');
const mir = read('scripts/utils/watchMirror.js');
ok(/MIRROR_DROP = new Set\(\[[^\]]*'style'[^\]]*'base'[^\]]*'set'/.test(mir), 'style, base and set elements are dropped');
ok(/!MIRROR_TAGS\.has\(tag\)\) \{ n\.replaceWith\(\.\.\.n\.childNodes\)/.test(mir), 'an element not on the allowlist is unwrapped');
ok(/mirrorData\(snap\.data\)/.test(mir) && /mirrorClasses\(snap\.cls\)/.test(mir) && /mirrorVars\(snap\.rootVars\)/.test(mir) && /mirrorVars\(snap\.wcVars\)/.test(mir), 'mountMirror filters the root it applies');

// ═══ 6. The real WatchService: who may send what (SEC-09) ═══
const { WatchService } = await imp('scripts/services/WatchService.js');
const sent = [];
const w = new WatchService({ socket: { emit: (op, data) => sent.push(data) }, snapshot: () => null });
const updates = [];
w._openWindow = () => ({ update: (s) => updates.push(s), ended() {}, tooBig() {} });
w._showChip = () => {}; w._removeChip = () => {};
w.onSocket({ type: 'offer', shareId: 'p2:term', userId: 'p2', who: 'Rache', what: 'WS-7F' }, 'p2');
ok(w.offers.has('p2:term'), 'an offer from its operator is taken');
w.onSocket({ type: 'offer', shareId: 'p2:fake', userId: 'p2', who: 'x', what: 'y' }, 'gm');
ok(!w.offers.has('p2:fake'), "an offer in someone else's name is dropped");
w.onSocket({ type: 'offer', shareId: 'p2:nosender', userId: 'p2', who: 'x', what: 'y' });
ok(!w.offers.has('p2:nosender'), 'a packet with no verified sender is dropped');
w.watch('p2:term');
w.onSocket({ type: 'snap', shareId: 'p2:term', userIds: ['p1'], seq: 1, snap: { html: 'from p2' } }, 'p2');
ok(updates.at(-1)?.html === 'from p2', "the operator's picture is shown");
w.onSocket({ type: 'snap', shareId: 'p2:term', userIds: ['p1'], seq: 2, snap: { html: 'forged', data: { onanimationstart: 'alert(1)' } } }, 'gm');
ok(updates.at(-1)?.html === 'from p2', "a picture from anyone else is dropped (even a GM's)");
w.onSocket({ type: 'edit', shareId: 'p2:term', userIds: ['p1'], seq: 2, edit: [0, 0, 'X'] }, 'p1');
ok(updates.at(-1)?.html === 'from p2', 'an edit from anyone else is dropped');
w.onSocket({ type: 'end', shareId: 'p2:term' }, 'gm');
ok(w.offers.has('p2:term'), 'only the operator can end a share');
// The operator's side: join / leave in another user's name.
game.user.id = 'p2';
const op = new WatchService({ socket: { emit: (o, d) => sent.push(d) }, snapshot: () => ({ html: 'x' }) });
const rec = { app: { id: 'term' }, shareId: 'p2:term', watchers: new Set(['p1']), seq: 0 };
op.shares.set('term', rec);
op._syncObserver = () => {}; op._paintButton = () => {}; op._send = () => {};
op.onSocket({ type: 'leave', shareId: 'p2:term', userId: 'p1' }, 'gm');
ok(rec.watchers.has('p1'), "a leave in someone else's name is dropped");
op.onSocket({ type: 'join', shareId: 'p2:term', userId: 'gm' }, 'p1');
ok(!rec.watchers.has('gm'), "a join in someone else's name is dropped");
op.onSocket({ type: 'leave', shareId: 'p2:term', userId: 'p1' }, 'p1');
ok(!rec.watchers.has('p1'), 'a watcher can leave for themselves');
op.onUserGone('p2');
game.user.id = 'p1';

// ═══ 7. Overheard calls (SEC-10) ═══
const { safeHeardHtml, garbleLine } = await imp('scripts/utils/overheard.js');
const g = garbleLine('l1', 'meet me at <b>Afterlife</b> & bring R&D', 50);
ok(safeHeardHtml(g) === g, 'a real garbled line passes through unchanged');
const hostile = safeHeardHtml('<img src=x onerror=alert(1)> hi <span class="ncm-r4-gl">▒░</span><span class="ncm-r4-gl" onclick="x">▒░</span>');
ok(!/<img|<span class="ncm-r4-gl" onclick/.test(hostile) && /<span class="ncm-r4-gl">▒░<\/span>/.test(hostile), 'anything but a garble span shows as text');
ok(safeHeardHtml(null) === null, "can't hear this side stays null");
const { OverheardService } = await imp('scripts/services/OverheardService.js');
const got = [];
game.nightcity.overheardHud = { receive: (d) => got.push(d) };
const svc = Object.create(OverheardService.prototype);
await svc.handleSocket({ op: 'line', runId: 'r', line: { html: 'x' }, userIds: ['p1'] }, 'p2');
ok(got.length === 0, 'a HUD message from a player is dropped');
await svc.handleSocket({ op: 'joined', runId: 'r', userIds: ['p1'] }, null);
ok(got.length === 0, 'a HUD message with no verified sender is dropped');
await svc.handleSocket({ op: 'joined', runId: 'r', userIds: ['p1'] }, 'gm');
ok(got.length === 1, 'a HUD message from the GM is shown');
ok(/d\.line = \{ \.\.\.d\.line, html: safeHeardHtml\(d\.line\.html\) \}/.test(read('scripts/ui/Calls/OverheardHud.js')), 'the HUD rebuilds a line before it is drawn');

console.log(`test-receive-side: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
