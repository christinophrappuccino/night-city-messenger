// Sim: HTML stored in mail and shard content (audit remediation A5a: SEC-13,
// SEC-14, SEC-15).
//
// SEC-15  the mail sanitizer's link check decoded only six named entities, so
//         `javascript&#58;…` became a live link in every viewer (incl. the GM's
//         Admin reading pane). Now: decode every entity form until stable,
//         allowlist http / https / mailto / tel, return the decoded URL.
// SEC-13  the composer put other people's HTML into its editor and quote card
//         unchecked (forward body + its header, drafts, bodies handed in).
//         Quote card → cleanHtml (as the viewer); editable bodies →
//         stripActiveHtml (runs nothing, keeps formatting exactly).
// SEC-14  typed content cleaned the body only for messages; the FALLBACK branch
//         and the payload scan report rendered raw.
//
// Drives the real richText.js, MessageService.buildForward, the composer's
// _initForward, and enrichContent + content-body.hbs through Foundry's own
// Handlebars (skipped if no Foundry install is found).
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const load = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// ── Foundry stubs ──
globalThis.game = {
  user: { isGM: true, id: 'gm' }, users: { activeGM: { id: 'gm' }, get: () => null, find: () => null },
  settings: { get: () => { throw new Error('none'); }, set: async () => {} },
  actors: { get: () => null, contents: [], [Symbol.iterator]: function* () {} }, items: { get: () => null }, journal: { get: () => null, contents: [] },
  i18n: { localize: (s) => s },
  nightcity: { eventBus: { emit() {} }, soundService: { play() {} } },
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
globalThis.foundry = {
  utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'rid', debounce: (f) => f, getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o) },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() },
};
globalThis.fromUuidSync = () => null;

const { cleanHtml, stripActiveHtml } = await load('scripts/utils/richText.js');

// What a browser would act on: decode the attribute value once, drop whitespace / controls.
const browserHref = (v) => v.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&colon;/gi, ':').replace(/&amp;/g, '&').replace(/[\s\u0000-\u001f]/g, '');
const liveScheme = (html) => [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].some((m) => /^(javascript|vbscript|data):/i.test(browserHref(m[1])));

// ═══ 1. SEC-15 — link and image URLs ═══
{
  const attacks = ['javascript&#58;alert(1)', 'javascript&#x3A;alert(1)', 'javascript&colon;alert(1)', 'java&#9;script:alert(1)',
    'javascript&amp;#58;alert(1)', '&#106;avascript:alert(1)', 'javascript&#0000058alert(1)', ' JaVaScRiPt:alert(1)',
    'data:text/html,<b>x</b>', 'vbscript:msgbox(1)', 'javascript&amp;amp;#58;x', 'jav&#x09;ascript:alert(1)'];
  for (const href of attacks) {
    const out = cleanHtml(`<a href="${href}">x</a><img src="${href}">`, { mode: 'mail' });
    ok(!/href=|src=/.test(out) && !liveScheme(out), `blocked: ${href}`);
  }
  const legit = ['https://example.com/a?x=1&y=2', 'http://nc.net/p', 'mailto:v@nc.net', 'tel:555-0100', 'worlds/my world/img.png', '/modules/x/y.png', '#anchor', '//cdn.example/x.png'];
  for (const href of legit) {
    const out = cleanHtml(`<a href="${href}">x</a>`, { mode: 'mail' });
    const m = out.match(/href="([^"]*)"/);
    ok(!!m && browserHref(m[1]) === href.replace(/\s/g, ''), `kept as written: ${href}`);
  }
  ok(/src="worlds\/a b\/c&amp;d\.png"/.test(cleanHtml('<img src="worlds/a b/c&amp;d.png">', { mode: 'mail' })), 'an image path with & round-trips');
}

// ═══ 2. stripActiveHtml — keeps formatting, removes what runs ═══
{
  const same = [
    '<div>line one</div><div><br></div><div>line <i>two</i></div>',
    '<p><b>bold</b> <u>u</u> <s>s</s> <code>c</code></p>',
    '<span style="color:#123456">off-palette</span> and <font color="red">font</font>',
    '<a href="https://x.y/?a=1&amp;b=2">link</a> <img src="worlds/a b/c.png" alt="pic">',
    'plain text, a < b & c',
    '<blockquote data-label="ICE">secret</blockquote>',
  ];
  for (const h of same) ok(stripActiveHtml(h) === h, `unchanged: ${h.slice(0, 50)}`);
  const strips = [
    ['<img src=x onerror="alert(1)">', /onerror/],
    ['<script>alert(1)</script>hi', /script|alert/],
    ['<a href="javascript&#58;alert(1)">x</a>', /href/],
    ['<iframe srcdoc="<script>x</script>"></iframe>ok', /iframe|srcdoc/],
    ['<svg onload=alert(1)><circle/></svg>ok', /svg|onload/],
    ['<div style="background:url(javascript:alert(1))">s</div>', /style/],
    ['<a href="x" ONCLICK="alert(1)">c</a>', /onclick/i],
    ['<base href="https://evil/">x', /base/],
    ['<form action="javascript:alert(1)"><button>b</button></form>after', /form|action/],
    ['<img src="x" srcset="javascript:alert(1) 1x">', /srcset/],
    ['<details open ontoggle=alert(1)>d</details>', /ontoggle/],
    ['<p style="color:re\\64">esc</p>', /style/],
    ['<meta http-equiv="refresh" content="0;url=https://evil">x', /meta|refresh/],
  ];
  for (const [h, bad] of strips) ok(!bad.test(stripActiveHtml(h)), `stripped: ${h.slice(0, 50)}`);
  ok(stripActiveHtml('') === '' && stripActiveHtml(null) === '', 'empty input → empty');
}

// ═══ 3. SEC-13 — forward header + composer entry points ═══
{
  const { MessageService } = await load('scripts/services/MessageService.js');
  const hostile = '<img src=x onerror="alert(1)">';
  const orig = { from: `${hostile}@nc.net`, to: 'v@nc.net', timestamp: '2045-08-14T08:00:00Z', subject: `Hi ${hostile}`, body: `<p>Original <b>body</b></p>${hostile}`, messageId: 'm1', threadId: 't1', references: [] };
  const fwd = MessageService.prototype.buildForward.call({ _buildReferences: () => [] }, orig, 'a', '', '');
  ok(fwd && !/From: <img/.test(fwd.body) && /From: &lt;img/.test(fwd.body), 'forward header escapes From');
  ok(/Subject: Hi &lt;img/.test(fwd.body), 'forward header escapes Subject');
  ok(fwd.subject === `FWD: Hi ${hostile}`, 'the subject FIELD stays plain text (templates escape it)');

  const { MessageComposerApp } = await load('scripts/ui/MessageComposer/MessageComposerApp.js');
  const t = { originalMessage: orig, fromActorId: 'a', messageService: { buildForward: (...a) => MessageService.prototype.buildForward.call({ _buildReferences: () => [] }, ...a) } };
  MessageComposerApp.prototype._initForward.call(t);
  // "onerror" may appear as escaped TEXT (the header shows the name); never as an attribute of a real tag
  ok(typeof t.body === 'string' && !/<[a-z][^>]*\son\w+\s*=/i.test(t.body), 'composer forward: no live event handler reaches the editor');
  ok(/From: &lt;img/.test(t.body), 'composer forward: the hostile sender name shows as text');
  ok(/<p>Original <b>body<\/b><\/p>/.test(t.body), 'composer forward: the original formatting survives');

  const cmp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
  ok(/this\.body = stripActiveHtml\(options\.body \|\| ''\);/.test(cmp), 'composer: a body handed in is stripped');
  ok(/this\.body = stripActiveHtml\(draft\.body \|\| ''\);/.test(cmp), 'composer: a restored draft is stripped');
  ok(/body: cleanHtml\(orig\.body \|\| '', \{ mode: 'mail' \}\),/.test(cmp), 'composer: the quote card is cleaned like the viewer');
  ok(/this\.body = stripActiveHtml\(fwd\.body\);/.test(cmp), 'composer: the forward body is stripped');
  ok(/\{\{\{originalMessageCard\.body\}\}\}/.test(read('templates/message-composer/message-composer.hbs')), 'the quote card is still rendered as HTML (formatting kept)');
}

// ═══ 4. SEC-14 — typed content: fallback body + scan report, through the real template ═══
{
  const { enrichContent } = await load('scripts/ui/content/ContentRenderers.js');
  const hostile = '<img src=x onerror="window.__x=1">';
  const unknown = enrichContent({ contentType: 'not-a-real-type', body: `<p>keep <b>this</b></p>${hostile}`, subject: 's', timestamp: '2045-01-01T00:00:00Z' }, { isGM: true, interactive: false });
  ok(!/onerror/.test(unknown.body || ''), 'unknown content type: body cleaned');
  ok(/<b>this<\/b>/.test(unknown.body || ''), 'unknown content type: formatting kept');
  const payload = enrichContent({ contentType: 'payload', subject: 'p', timestamp: '2045-01-01T00:00:00Z', contentData: { name: 'Prog', effect: { type: 'scanner' }, executed: true, scanReport: `SCAN — account ${hostile}` } }, { isGM: true, interactive: false });
  ok(!/onerror/.test(payload.contentData?.scanReport || '') && /SCAN/.test(payload.contentData?.scanReport || ''), 'payload scan report cleaned, text kept');

  const CANDIDATES = ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json'];
  let HB = null;
  for (const p of CANDIDATES) { if (!fs.existsSync(p)) continue; try { HB = createRequire(p)('handlebars'); break; } catch { /* next */ } }
  if (!HB) {
    console.log('  ~ template render skipped — no Handlebars from a Foundry install');
  } else {
    const cmpH = (fn) => function (a, b, o) { const r = fn(a, b); return o?.fn ? (r ? o.fn(this) : o.inverse(this)) : r; };
    for (const [n, f] of [['eq', (a, b) => a === b], ['neq', (a, b) => a !== b], ['gt', (a, b) => a > b], ['lt', (a, b) => a < b], ['gte', (a, b) => a >= b], ['lte', (a, b) => a <= b]]) HB.registerHelper(n, cmpH(f));
    { const { registerTipHelper } = await import(new URL('../../../scripts/utils/notify.js', import.meta.url).href); registerTipHelper(HB); }
    HB.registerHelper('and', (...a) => a.slice(0, -1).every(Boolean)); HB.registerHelper('or', (...a) => a.slice(0, -1).some(Boolean));
    HB.registerHelper('not', (v) => !v); HB.registerHelper('add', (a, b) => (a || 0) + (b || 0)); HB.registerHelper('helperMissing', () => '');
    const tpl = HB.compile(read('templates/content/content-body.hbs'));
    const htmlUnknown = tpl(unknown);
    ok(!/<img src="?x"? onerror/i.test(htmlUnknown) && /<b>this<\/b>/.test(htmlUnknown), 'rendered FALLBACK branch: no live handler, formatting kept');
    const htmlPayload = tpl(payload);
    ok(!/onerror/i.test(htmlPayload), 'rendered payload card: the scan report carries no handler');
  }
}

console.log(`test-stored-html: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
