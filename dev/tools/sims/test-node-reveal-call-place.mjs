// Tester round 2026-11-06: (1) a node pin revealed on its own left the node hidden ("There is nothing there");
// (2) the call badge sat at a fixed 76/74px, over Foundry's second scene-control column.
// node dev/tools/sims/test-node-reveal-call-place.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const MID = 'night-city-messenger';

// ═══ 1. revealing a node's pin / area reveals the node ═══
const nodes = { n1: { id: 'n1', name: 'Tower relay', kind: 'relay', hidden: true }, n2: { id: 'n2', name: 'Open relay', kind: 'relay', hidden: false } };
const saves = [];
const toasts = [];
const mkDoc = (type, flags, extra = {}) => {
  const doc = { documentName: type, id: `${type}-${Math.random().toString(36).slice(2, 6)}`, ...extra,
    getFlag: (s, k) => (s === MID ? flags[k] : undefined),
    setFlag: async (s, k, v) => { flags[k] = v; },
    update: async (u) => { doc._updated = u; for (const [k, v] of Object.entries(u)) if (k.startsWith(`flags.${MID}.`)) flags[k.split('.').pop()] = v; },
    behaviors: { contents: [{ id: 'b0', disabled: true }] },
    updateEmbeddedDocuments: async (t, rows) => { doc._beh = rows; },
  };
  return doc;
};
const journals = [{ id: 'jNodes', getFlag: (s, k) => (k === 'networkNodes' || k === 'nodePins' || k === 'nodesJournal' ? true : undefined) }, { id: 'jHidden', getFlag: (s, k) => (k === 'hiddenAccessPoints' ? true : undefined) }];
globalThis.game = {
  user: { isGM: true }, users: [], scenes: [], items: { get: () => null },
  journal: { get: (id) => journals.find(j => j.id === id) || null, find: (fn) => journals.find(fn) || null, filter: (fn) => journals.filter(fn) },
  nightcity: { networkService: { getNode: (id) => (nodes[id] ? { ...nodes[id] } : null), saveNode: async (n) => { saves.push(n); nodes[n.id] = { ...n }; return { success: true, node: n }; } } },
  settings: { get: () => ({}) },
};
globalThis.JournalEntry = { create: async (d) => { const j = { id: 'jNew', ...d, getFlag: (s, k) => d.flags?.[MID]?.[k] }; journals.push(j); return j; } };
globalThis.ui = { notifications: { info: (m) => toasts.push(['info', m]), warn: (m) => toasts.push(['warn', m]), error: () => {} } };
globalThis.Hooks = { on: () => 1 };
globalThis.CONST = { TEXT_ANCHOR_POINTS: { BOTTOM: 1 }, REGION_VISIBILITY: { LAYER: 0 } };
const { TerminalScenePins } = await import('../../../scripts/integrations/TerminalScenePins.js');
const pins = new TerminalScenePins();

const pin = mkDoc('Note', { accessKind: 'node', accessNode: 'n1', accessHidden: true });
await pins.setHidden(pin, false);
ok(pin.getFlag(MID, 'accessHidden') === false, 'the pin is revealed');
ok(saves.length === 1 && saves[0].id === 'n1' && saves[0].hidden === false, 'revealing the pin of a hidden node reveals the node');
ok(toasts.some(([, m]) => /Tower relay is no longer hidden/.test(m)), 'the GM is told the node came out too');

saves.length = 0;
nodes.n1.hidden = true;
const area = mkDoc('Region', { access: { kind: 'node', id: 'n1' }, accessHidden: true });
await pins.setHidden(area, false);
ok(area._beh?.[0]?.disabled === false && saves.length === 1 && saves[0].hidden === false, 'revealing a node area reveals the node too');

saves.length = 0;
await pins.setHidden(mkDoc('Note', { accessKind: 'node', accessNode: 'n1', accessHidden: false }), true);
ok(saves.length === 0 && nodes.n1.hidden === false, 'hiding one pin never hides the node');

saves.length = 0;
await pins.setHidden(mkDoc('Note', { accessKind: 'node', accessNode: 'n2', accessHidden: true }), false);
ok(saves.length === 0, 'a node that is already visible is not re-saved');

// the inspector / Networks tab path: node saved visible first, then every pin revealed — no second save, no loop
saves.length = 0;
const p2 = mkDoc('Note', { accessKind: 'node', accessNode: 'n2', accessHidden: true });
globalThis.game.scenes = [{ notes: [p2], regions: [] }];
await pins.setNodeHidden('n2', false);
ok(p2.getFlag(MID, 'accessHidden') === false && saves.length === 0, 'setNodeHidden(false) reveals pins without re-saving the node');

const tsp = read('scripts/integrations/TerminalScenePins.js');
ok(/node\.hidden && !doc\.getFlag\(MODULE_ID, 'accessHidden'\)/.test(tsp) && /isGM\(\) && node\.hidden/.test(tsp), 'a GM opening a visible pin of a hidden node is warned (worlds from before the fix)');

// ═══ 2. where the call badge sits ═══
const H = await import('../../../scripts/ui/Calls/hudPlace.js');
const rect = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h });
const fakeDoc = (map) => ({
  querySelectorAll: (sel) => (map[sel] || []).map(r => ({ getBoundingClientRect: () => r })),
  querySelector: (sel) => (map[sel]?.[0] ? { getBoundingClientRect: () => map[sel][0] } : null),
  documentElement: { style: { props: {}, setProperty(k, v) { this.props[k] = v; } } },
});
ok(JSON.stringify(H.autoPlace(fakeDoc({}))) === JSON.stringify({ left: 76, top: 74 }), 'nothing to dodge: the old spot');
// v12: main column 46px + an open tools column out to ~108px; scene bar to 52px
const v12 = fakeDoc({ '#controls ol.control-tools': [rect(10, 70, 46, 400), rect(60, 70, 48, 300)], '#navigation': [rect(120, 12, 1400, 40)] });
const a = H.autoPlace(v12);
ok(a.left === 124 && a.top === 74, `v12: clears the open tools column (got ${a.left}/${a.top})`);
const v13 = fakeDoc({ '#scene-controls-layers': [rect(8, 60, 40, 500)], '#scene-controls-tools': [rect(50, 60, 40, 300)], '#scene-navigation': [rect(100, 10, 900, 80)] });
const b = H.autoPlace(v13);
ok(b.left === 106 && b.top === 104, `v13: clears both menus and a tall scene bar (got ${b.left}/${b.top})`);
ok(H.autoPlace(fakeDoc({ '#controls ol.control-tools': [rect(10, 700, 300, 40)] })).left === 76, 'a column far below the badge does not push it');
ok(H.autoPlace(fakeDoc({ '#controls ol.control-tools': [rect(10, 70, 0, 0)] })).left === 76, 'a collapsed (zero-size) tools column is ignored');
const c = H.clampPlace({ left: 5000, top: -50 }, 1600, 900);
ok(c.left === 1440 && c.top === 8, 'a saved spot is kept on screen');
H.applyPlace({ left: 130, top: 80 }, v12);
ok(v12.documentElement.style.props['--ncm-ch-left'] === '130px' && v12.documentElement.style.props['--ncm-ch-top'] === '80px', 'the spot is written to <html> (the emergency screen reads it too)');
const store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
H.savePlace({ left: 400, top: 300 });
ok(H.currentPlace(v12).left === 400, "the player's own spot wins over the measured one");
H.savePlace(null);
ok(H.currentPlace(v12).left === 124, 'cleared (double-click): back to the measured spot');
globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
ok(H.loadPlace() === null && (H.savePlace({ left: 1, top: 1 }), true), 'blocked storage never throws');

// the probe: anything clickable on the badge's rows, from any module
const el = (cls, inside = []) => ({ cls, closest: (sel) => (sel.split(',').map(s => s.trim()).some(s => s === cls || inside.includes(s)) ? {} : null) });
const probeDoc = (fn) => { const d = { body: { b: 1 }, documentElement: { h: 1 } }; d.elementsFromPoint = (x, y) => fn(x, y, d); return d; };
// core controls 8–56px, a module's toolbar 64–150px (with a 10px gap between buttons), canvas after
const ctl = el('#controls-li'), mod = el('.other-mod-btn'), board = el('#board'), hudEl = el('.ncm-ch-pic', ['#ncm-call-hud']);
const busy = probeDoc((x) => (x <= 56 ? [ctl] : x >= 64 && x <= 150 && !(x > 100 && x < 110) ? [mod] : [board]));
const s1 = H.scanLeft(busy, 74);
ok(s1 >= 150 + 16 && s1 <= 150 + 6 + 16 + 6, `a module's own column beside the controls is cleared (got ${s1})`);
ok(H.scanLeft(probeDoc(() => [board]), 74) === 0, 'nothing but canvas: no push');
const covered = probeDoc((x) => (x <= 200 ? [hudEl, ctl] : [board]));
ok(H.scanLeft(covered, 74) >= 200, 'the probe sees past our own badge to the controls under it');
const win = probeDoc((x) => (x <= 300 ? [el('.window-content', ['.app'])] : [board]));
ok(H.scanLeft(win, 74) === 0, 'an open window is not dodged (windows move; the badge should not chase them)');
const far = probeDoc((x) => (x >= 200 && x <= 260 ? [mod] : [board]));
ok(H.scanLeft(far, 74) === 0, 'a button floating out in the scene is not part of the left column');

const hud = read('scripts/ui/Calls/CallHud.js');
ok(/DRAG_HANDLES = '.*ncm-ch-pic.*ncm-ch-chip'/.test(hud) && hud.includes("e.target.closest('[data-act], [data-mode], [data-dict], input, textarea, button')"), 'drag by the portrait / dial / name too, never by a key');
ok(/if \(fresh && !this\._dragging\) applyPlace\(currentPlace\(\)\)/.test(hud), 'each new call measures again');
ok(hud.includes("Hooks.on('renderSceneControls'") && hud.includes("addEventListener('pointerdown', (e) => this._onGripDown(e))"), 'the badge re-measures when the controls change and can be dragged');
ok(hud.includes('grip: true }') && /grip: withGrip = false/.test(hud), 'only the live badge has a grip (previews, Emergency and Overheard reuse the markup)');
const css = read('styles/components/call-hud.css');
ok(/\.ncm-ch-grip \{[^}]*pointer-events: auto/.test(css) && /\.ncm-ch-call \{[^}]*position: relative/.test(css), 'the grip takes the pointer inside a click-through HUD');
ok(read('styles/components/emergency-call.css').includes('var(--ncm-ch-left, 76px)'), 'the emergency screen still reads the same spot');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
