// Access points step 3 — placing on a scene: pins, step-on areas (Regions), hidden / revealed.
// node dev/tools/sims/test-access-place.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const MID = 'night-city-messenger';

const A = await import('../../../scripts/utils/accessPoints.js');

// ═══ 1. pure rules ═══
const p0 = A.sanitizePlacement({ how: 'weird', where: 'x', range: -4, size: 9, hidden: 1 });
ok(p0.how === 'pin' && p0.where === 'view' && p0.range === 0 && p0.size === 2 && p0.hidden === true, 'sanitize: unknowns fall back, range clamps at 0, size to a known one');
ok(A.sanitizePlacement({ range: 99 }).range === 30, 'range capped at 30');
const rect = A.areaRect({ x: 500, y: 300 }, 2, 100);
ok(rect.x === 400 && rect.y === 200 && rect.width === 200 && rect.height === 200, 'area: centred square in grid squares');
const ref = A.accessRef('terminal', 'Item.ws');
const src = A.accessRegionScript(ref, 'WS */ 7F');
let parsed = true; try { new (Object.getPrototypeOf(async function () {}).constructor)('scene', 'region', 'behavior', 'event', `{${src}\n}`); } catch { parsed = false; }
ok(parsed, 'the step-on script parses the way Foundry runs it');
ok(src.includes('event.user?.isSelf') && src.includes('game.user.isGM') && src.includes('tok.actor?.isOwner') && src.includes('"kind":"terminal"'), 'the script acts only for the mover, never the GM, only for a token they own');
ok(!src.includes('*/') && !src.includes('`'), 'a name cannot break out of the comment; no backticks');
ok(/click the map/.test(A.placementHint({ where: 'click' })) && /never triggers/.test(A.placementHint({ how: 'area' })) && /within 3 squares/.test(A.placementHint({ how: 'pin', range: 3 })) && /Hidden/.test(A.placementHint({ hidden: true })), 'the hint says what will happen');
const html = A.placementDialogHtml({ ref, info: { name: '<WS>' }, place: { how: 'both', hidden: true, size: 3 }, sceneName: 'Tower' });
ok(html.includes('data-how="both"') && html.includes('&lt;WS&gt;') && html.includes('value="3" selected') && /data-v="1"[^>]*>|is-on" data-v="1"/.test(html), 'dialog: the chosen way in, escaped name, area size, hidden picked');

// ═══ 2. the REAL placer over a mocked scene ═══
const created = [];
const mkDoc = (type, data, scene) => {
  const flags = data.flags?.[MID] ?? {};
  const doc = { documentName: type, id: `${type}${created.length}`, ...data, parent: scene,
    getFlag: (s, k) => (s === MID ? flags[k] : undefined),
    setFlag: async (s, k, v) => { flags[k] = v; },
    update: async (u) => { Object.assign(doc, u); for (const [k, v] of Object.entries(u)) if (k.startsWith(`flags.${MID}.`)) flags[k.split('.').pop()] = v; doc._updated = u; },
    behaviors: { contents: (data.behaviors || []).map((b, i) => ({ id: `b${i}`, ...b })) },
    updateEmbeddedDocuments: async (t, rows) => { doc._behaviorUpdates = rows; },
  };
  return doc;
};
const scene = { id: 's1', name: 'Tower 7F', grid: { size: 100 }, notes: [], regions: [],
  createEmbeddedDocuments: async (type, rows) => rows.map(r => { const d = mkDoc(type, r, scene); created.push(d); (type === 'Note' ? scene.notes : scene.regions).push(d); return d; }) };
const term = { id: 'ws', uuid: 'Item.ws', name: 'WS-7F-12', img: 'ws.png', getFlag: (s, k) => ({ isTerminal: true, journalId: 'jT' })[k] };
const shard = { id: 'bag', uuid: 'Actor.a.Item.bag', name: 'Go-bag', img: 'bag.png', getFlag: (s, k) => ({ isDataShard: true, journalId: 'jS' })[k] };
const journals = [{ id: 'jT', getFlag: () => undefined }, { id: 'jS', getFlag: () => undefined }];
let hiddenMade = 0;
globalThis.game = {
  user: { isGM: true }, scenes: { get: (id) => (id === 's1' ? scene : null) }, items: { get: () => null },
  journal: { get: (id) => journals.find(j => j.id === id) || null, find: (fn) => journals.find(fn) || null },
  nightcity: { terminalService: { getConfig: () => ({ terminalName: '', scenePin: { range: 0 } }) }, dataShardService: { getConfig: () => ({ shardName: '' }) } },
  settings: { get: () => ({}) },
};
globalThis.JournalEntry = { create: async (d) => { hiddenMade++; const j = { id: 'jHidden', ...d, getFlag: (s, k) => d.flags?.[MID]?.[k] }; journals.push(j); return j; } };
globalThis.canvas = { scene, stage: { pivot: { x: 1000, y: 600 } } };
globalThis.CONST = { TEXT_ANCHOR_POINTS: { BOTTOM: 1 }, REGION_VISIBILITY: { LAYER: 0 } };
globalThis.ui = { notifications: { info: () => {}, warn: (m) => { globalThis._warn = m; } } };
globalThis.Hooks = { on: () => 1 };
globalThis.fromUuidSync = (u) => ({ 'Item.ws': term, 'Actor.a.Item.bag': shard })[u] ?? null;
const { TerminalScenePins, isAccessPin } = await import('../../../scripts/integrations/TerminalScenePins.js');
const pins = new TerminalScenePins();

const both = await pins.placeAccess(term, { how: 'both', where: 'view', range: 3, size: 2, hidden: false, sceneId: 's1' });
const note = scene.notes[0], region = scene.regions[0];
ok(both.length === 2 && note && region, 'Both = a pin AND an area');
ok(note.x === 1000 && note.y === 600 && note.entryId === 'jT', 'the pin lands at the view centre and points at the terminal journal (visible)');
ok(note.getFlag(MID, 'accessKind') === 'terminal' && note.getFlag(MID, 'terminalItemId') === 'ws' && note.getFlag(MID, 'accessRange') === 3, 'pin flags: kind, the old terminal flags kept, its own reach');
ok(isAccessPin(note), 'it reads as an access pin');
const sh = region.shapes[0];
ok(sh.type === 'rectangle' && sh.x === 900 && sh.y === 500 && sh.width === 200, 'the area is a 2×2-square rectangle centred on the spot');
ok(region.behaviors.contents[0].type === 'executeScript' && region.behaviors.contents[0].system.events[0] === 'tokenEnter' && region.behaviors.contents[0].disabled === false, 'area behaviour: a script on token enter, switched on');
ok(region.getFlag(MID, 'access').id === 'Item.ws' && region.visibility === 0, 'area flags carry the ref; only visible on the Regions layer');

await pins.placeAccess(shard, { how: 'pin', where: 'view', hidden: true, sceneId: 's1' });
const hidPin = scene.notes[1];
ok(hidPin.entryId === 'jHidden' && hiddenMade === 1 && hidPin.texture.tint, 'a hidden pin points at the GM-only placeholder journal (made once) and is tinted');
ok(hidPin.getFlag(MID, 'accessKind') === 'shard' && hidPin.getFlag(MID, 'terminalItemId') === undefined, 'shards can be pinned (no terminal flags)');
await pins.placeAccess(shard, { how: 'area', where: 'view', hidden: true, sceneId: 's1' });
ok(hiddenMade === 1, 'the placeholder journal is reused');
const hidArea = scene.regions[1];
ok(hidArea.behaviors.contents[0].disabled === true && hidArea.getFlag(MID, 'accessHidden') === true, 'a hidden area has its behaviour switched off');

await pins.setHidden(hidPin, false);
ok(hidPin._updated.entryId === 'jS' && hidPin._updated['texture.tint'] === null && hidPin.getFlag(MID, 'accessHidden') === false, 'reveal: back to the shard journal, tint cleared');
await pins.setHidden(hidArea, false);
ok(hidArea._behaviorUpdates?.[0]?.disabled === false && hidArea.getFlag(MID, 'accessHidden') === false, 'reveal an area: behaviour on');
await pins.setHidden(note, true);
ok(note._updated.entryId === 'jHidden', 'hide a visible pin');

ok(await pins.placeAccess({ name: 'Pistol', getFlag: () => undefined }, {}) === undefined && /terminal or a shard/.test(globalThis._warn), 'a plain item is refused');

// ═══ 3. wiring ═══
const ap = read('scripts/integrations/AccessPoints.js');
ok(ap.includes("label: 'Place on a scene…'") && ap.includes('export async function openPlaceDialog'), 'the menu opens the placement dialog (terminals AND shards)');
ok(ap.includes("classes: [...THEMED_DIALOG_CLASSES, 'ncm-plc-dialog']"), 'the dialog is themed (keeps Foundry\'s dialog class)');
const tsp = read('scripts/integrations/TerminalScenePins.js');
ok(/_kindOf\(item\) === 'shard'\) game\.nightcity\?\.openDataShard/.test(tsp), 'a shard pin opens the shard');
ok(tsp.includes("noteDoc.getFlag(MODULE_ID, 'accessRange')"), 'the pin\'s own reach wins in the range gate');
ok(tsp.includes("label: 'Reveal to players'") && tsp.includes("label: 'Hide from players'"), 'right-click: Reveal / Hide');
ok(tsp.includes("'-=isDataShard'") && tsp.includes("deleteEmbeddedDocuments('Region'"), 'unconverting / deleting cleans pins AND areas');
const at = read('scripts/ui/AdminPanel/tabs/AccessTab.js');
ok(at.includes("how: 'area'") && at.includes("case 'ptHide'") && at.includes("'createRegion'"), 'Access tab lists areas, toggles hidden, follows Region changes');
ok(read('scripts/ui/AdminPanel/tabs/accessModel.js').includes("['hid', 'Hidden', 'secret',"), 'a Hidden stat');
ok(read('styles/components/ncm-dialog.css').includes('.ncm-plc[data-how="pin"] .ncm-plc__only-area'), 'reach / size rows follow the chosen way in');

// ═══ 4. the dialog renders (real markup + real cascade is the probe; here: no NaN / undefined) ═══
ok(!/undefined|NaN/.test(html), 'dialog markup has no undefined / NaN');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
