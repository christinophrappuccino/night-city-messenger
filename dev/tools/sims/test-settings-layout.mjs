// test-settings-layout — Module Settings in sections (stage 2, step 18). Every visible NCM setting (config: true,
// in any file) is placed in exactly one section of SETTINGS_LAYOUT, every key there is a real visible setting, and
// the section names stay plain. Then layOutSettings runs over a tiny DOM that behaves like Foundry's settings
// window (rows found through their input names) and must put each row under its heading, unknown rows in "Other",
// and leave rows of other packages alone. Live check: dev/tools/live-smoke.mjs opens the real window on v12 / v13.
// Run: node dev/tools/sims/test-settings-layout.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let L;
try { L = await import(pathToFileURL(path.join(ROOT, 'scripts/ui/settingsLayout.js')).href); }
catch (e) { ok(false, `scripts/ui/settingsLayout.js loads (${e.message})`); console.log(`test-settings-layout: ${pass} passed, ${fail} failed`); process.exit(1); }

// ═══ 1. every visible setting is placed once ═══
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const visible = new Set();
for (const f of walk(path.join(ROOT, 'scripts'))) {
  const t = read(f);
  // a register call's options run to the first `});` — config: true inside it makes the setting visible
  for (const m of t.matchAll(/settings\.register\(\s*MODULE_ID,\s*(['"])([\w-]+)\1,\s*\{([\s\S]*?)\}\);/g)) if (/config:\s*true/.test(m[3])) visible.add(m[2]);
}
ok(visible.size >= 40, `found the visible settings (${visible.size})`);
const placed = L.SETTINGS_LAYOUT.flatMap((s) => s.keys);
const dup = placed.filter((k, i) => placed.indexOf(k) !== i);
ok(dup.length === 0, `no setting is in two sections (${dup.join(', ')})`);
const missing = [...visible].filter((k) => !placed.includes(k));
ok(missing.length === 0, `every visible setting has a section — add it to SETTINGS_LAYOUT (${missing.join(', ')})`);
const ghost = placed.filter((k) => !visible.has(k));
ok(ghost.length === 0, `every key in the layout is a visible setting (${ghost.join(', ')})`);
ok(L.SETTINGS_LAYOUT.every((s) => s.title && s.title.length < 32 && !/—/.test(s.title) && typeof s.hint === 'string'), 'section titles are short and plain, each has a hint');
ok(L.SETTINGS_LAYOUT[0].title === 'Systems' && L.SETTINGS_LAYOUT[0].keys.includes('networkSimulationEnabled'), 'the on/off switches come first');

// ═══ 2. layOutSettings over a Foundry-like DOM ═══
class El {
  constructor(tag, attrs = {}) { this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.parentElement = null; this.textContent = ''; this.classList = { contains: (c) => (this.attrs.class || '').split(/\s+/).includes(c) }; }
  set className(v) { this.attrs.class = v; } get className() { return this.attrs.class || ''; }
  get firstChild() { return this.children[0] || null; }
  get previousSibling() { const p = this.parentElement; if (!p) return null; const i = p.children.indexOf(this); return i > 0 ? p.children[i - 1] : null; }
  get nextSibling() { const p = this.parentElement; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  appendChild(c) { if (c.isFrag) { for (const k of [...c.children]) this.appendChild(k); return c; } c.remove?.(); c.parentElement = this; this.children.push(c); return c; }
  insertBefore(c, ref) { if (c.isFrag) { for (const k of [...c.children]) this.insertBefore(k, ref); return c; } c.remove?.(); c.parentElement = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
  matches(sel) {
    let m;
    if ((m = sel.match(/^\[name="(.+)"\]$/))) return this.attrs.name === m[1];
    if ((m = sel.match(/^\[name\^="(.+)"\]$/))) return (this.attrs.name || '').startsWith(m[1]);
    if ((m = sel.match(/^\.(.+)$/))) return this.classList.contains(m[1]);
    if (/^[a-z]+$/.test(sel)) return this.tagName === sel.toUpperCase();
    return false;
  }
  *all() { for (const c of this.children) { yield c; yield* c.all(); } }
  querySelectorAll(sel) { return [...this.all()].filter((e) => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let e = this; while (e && !e.matches(sel)) e = e.parentElement; return e; }
}
globalThis.document = { createElement: (t) => new El(t), createDocumentFragment: () => Object.assign(new El('#frag'), { isFrag: true }) };
globalThis.Hooks = { on() {} };

const row = (name) => { const g = new El('div', { class: 'form-group' }); g.appendChild(new El('input', { name })); return g; };
const section = new El('section');
section.appendChild(new El('h2'));
section.appendChild(row('other-module.x'));
// NCM rows in registration order (shuffled vs the layout), plus one the layout does not know
const keys = ['debugMode', 'subjectThreading', 'callsEnabled', 'dateFormat', 'brandNewSetting', 'networkSimulationEnabled'];
for (const k of keys) section.appendChild(row(`night-city-messenger.${k}`));
L.layOutSettings(section);
const seq = section.children.map((c) => (c.classList.contains('ncm-settings-head') ? `#${c.children.length ? c.textContent : c.textContent}` : (c.querySelector('input')?.attrs.name || c.tagName)));
const heads = section.children.filter((c) => c.classList.contains('ncm-settings-head')).map((h) => h.textContent);
ok(heads.join() === 'Systems,Mail,Date & time,Advanced,Other', `headings in layout order, only for sections with a row (${heads.join(' / ')})`);
const after = (key) => { const i = section.children.findIndex((c) => c.querySelector('input')?.attrs.name === `night-city-messenger.${key}`); let j = i - 1; while (j >= 0 && !section.children[j].classList.contains('ncm-settings-head')) j--; return section.children[j]?.textContent; };
ok(after('networkSimulationEnabled') === 'Systems' && after('callsEnabled') === 'Systems', 'switches under Systems');
ok(section.children.findIndex((c) => c.querySelector('input')?.attrs.name === 'night-city-messenger.networkSimulationEnabled') < section.children.findIndex((c) => c.querySelector('input')?.attrs.name === 'night-city-messenger.callsEnabled'), 'rows follow the layout order inside a section');
ok(after('subjectThreading') === 'Mail' && after('dateFormat') === 'Date & time' && after('debugMode') === 'Advanced', 'each row under its own heading');
ok(after('brandNewSetting') === 'Other', 'a setting the layout does not know lands in Other (it never disappears)');
ok(section.children[0].tagName === 'H2' && section.children[1].querySelector('input')?.attrs.name === 'other-module.x', "another package's row and the category title stay where they were");
const n1 = section.children.length;
L.layOutSettings(section);
ok(section.children.length === n1 && section.children.filter((c) => c.classList.contains('ncm-settings-head')).length === 5, 'running it again changes nothing (no duplicate headings)');

// ═══ 3. wiring ═══
const UI = read(path.join(ROOT, 'scripts/init/registerUIComponents.js'));
ok(/initializer\.register\('init', \d+, 'Settings layout', \(\) => registerSettingsLayout\(\)\);/.test(UI), 'the hook is installed at init');
ok(/Hooks\.on\('renderSettingsConfig'/.test(read(path.join(ROOT, 'scripts/ui/settingsLayout.js'))), 'it runs on renderSettingsConfig (v12 and v13 both fire it)');
ok(/@import 'components\/settings-layout\.css';/.test(read(path.join(ROOT, 'styles/night-city-messenger.css'))), 'the heading styles are imported');

console.log(`test-settings-layout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
