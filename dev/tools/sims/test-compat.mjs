// test-compat — scripts/utils/compat.js reaches every moved Foundry API in the right place on v12 AND on v13
// (stage 2, step 10a). On a faked v13 the old globals are getters that record a "deprecated" warning; compat must
// never read them there. On a faked v12 only the globals exist. Plus: nothing outside compat.js uses the moved names
// (check-deprecations), and the live v12 probe results are recorded in the batch notes.
// Run: node dev/tools/sims/test-compat.mjs
import { spawnSync } from 'child_process';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const C = await import(pathToFileURL(`${ROOT}/scripts/utils/compat.js`).href);

const GLOBALS = ['FilePicker', 'ImagePopout', 'DocumentOwnershipConfig', 'SettingsConfig', 'InteractionLayer', 'renderTemplate', 'loadTemplates', 'getTemplate'];
const clear = () => { for (const g of GLOBALS) delete globalThis[g]; delete globalThis.foundry; delete globalThis.game; };
class V12FP { constructor(o) { this.o = o; this.v = 12; } static browse() { return { v: 12 }; } }
class V13FP { constructor(o) { this.o = o; this.v = 13; } static browse() { return { v: 13 }; } }

// ═══ v12: only the globals ═══
clear();
Object.assign(globalThis, {
  FilePicker: V12FP, ImagePopout: class ImagePopout12 {}, DocumentOwnershipConfig: class DOC12 {}, SettingsConfig: class SC12 {}, InteractionLayer: class IL12 {},
  renderTemplate: async (p, d) => `v12:${p}:${d.x}`, loadTemplates: async (ps) => `v12:${ps.length}`, getTemplate: async (p) => `v12:${p}`,
});
globalThis.foundry = { utils: {} };
globalThis.game = { release: { generation: 12 } };
ok(C.FilePickerClass() === V12FP && C.newFilePicker({ a: 1 }).v === 12 && C.browseFiles('data', 'x').v === 12, 'v12: the file picker is the global');
ok(C.ImagePopoutClass().name === 'ImagePopout12' && C.DocumentOwnershipConfigClass().name === 'DOC12' && C.SettingsConfigClass().name === 'SC12' && C.InteractionLayerClass().name === 'IL12', 'v12: every class is the global');
ok(await C.renderTemplate('t', { x: 1 }) === 'v12:t:1' && await C.loadTemplates(['a', 'b']) === 'v12:2' && await C.getTemplate('t') === 'v12:t', 'v12: the template functions are the globals');
ok(C.foundryGeneration() === 12, 'v12: generation 12');

// ═══ v13: namespaced, and every old global warns when read ═══
clear();
const warned = [];
for (const g of GLOBALS) Object.defineProperty(globalThis, g, { configurable: true, get() { warned.push(g); return g === 'FilePicker' ? V12FP : () => 'deprecated'; } });
globalThis.foundry = { utils: {}, applications: {
  handlebars: { renderTemplate: async (p, d) => `v13:${p}:${d.x}`, loadTemplates: async (ps) => `v13:${ps.length}`, getTemplate: async (p) => `v13:${p}` },
  apps: { FilePicker: Object.assign(class FPBase {}, { implementation: V13FP }), ImagePopout: class ImagePopout13 {}, DocumentOwnershipConfig: class DOC13 {} },
  settings: { SettingsConfig: class SC13 {} },
}, canvas: { layers: { InteractionLayer: class IL13 {} } } };
globalThis.game = { release: { generation: 13 } };
ok(C.FilePickerClass() === V13FP && C.newFilePicker({}).v === 13 && C.browseFiles('data', 'x').v === 13, 'v13: the file picker is the configured implementation');
ok(C.ImagePopoutClass().name === 'ImagePopout13' && C.DocumentOwnershipConfigClass().name === 'DOC13' && C.SettingsConfigClass().name === 'SC13' && C.InteractionLayerClass().name === 'IL13', 'v13: every class comes from its namespace');
ok(await C.renderTemplate('t', { x: 2 }) === 'v13:t:2' && await C.loadTemplates(['a']) === 'v13:1' && await C.getTemplate('t') === 'v13:t', 'v13: the template functions come from foundry.applications.handlebars');
ok(warned.length === 0, `v13: no deprecated global was ever read (read: ${[...new Set(warned)].join(', ') || 'none'})`);
ok(C.foundryGeneration() === 13, 'v13: generation 13');

// ═══ neither ═══
clear(); globalThis.foundry = { utils: {} }; globalThis.game = {};
ok(C.FilePickerClass() === null && C.ImagePopoutClass() === null, 'nothing available → null, not a ReferenceError');
let threw = false; try { C.newFilePicker({}); } catch (e) { threw = /not available/.test(e.message); }
ok(threw, 'newFilePicker says plainly when there is no picker');
let threw2 = false; try { await C.renderTemplate('x', {}); } catch (e) { threw2 = /not available/.test(e.message); }
ok(threw2, 'renderTemplate says plainly when it is missing');
ok(C.foundryGeneration() === 0, 'no game → generation 0');

// ═══ htmlOf ═══
const el = { querySelector: () => 'found' };
ok(C.htmlOf(el) === el, 'htmlOf: an element is returned as it is');
const jq = Object.assign([el], { jquery: '3.7', get(i) { return this[i]; } });
ok(C.htmlOf(jq) === el, 'htmlOf: a jQuery object gives its element');
ok(C.htmlOf(null) === null && C.htmlOf(undefined) === null, 'htmlOf: nothing → null');

// ═══ the codebase uses compat ═══
const r = spawnSync(process.execPath, [`${ROOT}/dev/tools/check-deprecations.mjs`], { encoding: 'utf8' });
ok(r.status === 0, `check-deprecations passes:\n${(r.stderr || r.stdout).trim().split('\n').slice(0, 6).join('\n')}`);

console.log(`test-compat: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
