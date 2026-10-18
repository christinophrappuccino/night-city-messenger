/**
 * Shard integrity — the rules, the service, the viewer's view-model, the wiring.
 * @file tools/sims/test-integrity.mjs
 *
 *     node tools/sims/test-integrity.mjs
 *
 * Drives the REAL IntegrityModel, the REAL DataShardService integrity methods (on
 * a mocked item + journal), the REAL ItemInboxApp view-model methods, and renders
 * the REAL content-body.hbs + item-inbox.hbs through Foundry's own Handlebars
 * (skipped when no Foundry install is found). Design: docs/SHARD-INTEGRITY.md.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const section = (s) => console.log(`\n── ${s} ──`);
const ok = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (err) { console.log(`  ✗ ${name}\n      ${err.message}`); fail++; }
};

// ── Foundry stubs ──────────────────────────────────────────────────────────
const emitted = [];
const settings = {};
globalThis.game = {
  user: { isGM: true, id: 'gm' }, users: { activeGM: { id: 'gm' } },
  settings: { get: (m, k) => settings[k], set: async () => {} },
  actors: { get: () => null, contents: [] }, items: { get: () => null }, journal: { get: () => null, contents: [] },
  i18n: { localize: (s) => s },
  nightcity: { socketManager: { emit: (op, d) => emitted.push({ op, d }) }, eventBus: { emit() {} }, soundService: { play() {} } },
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Hooks = { on() {}, off() {}, once() {}, call() {}, callAll() {} };
globalThis.CONFIG = {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const merge = (a, b) => {
  const out = clone(a);
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k], v) : clone(v);
  }
  return out;
};
globalThis.foundry = {
  utils: {
    deepClone: clone, mergeObject: (a, b) => merge(a, b), randomID: () => 'rid', debounce: (f) => f,
    getProperty: (o, p) => p.split('.').reduce((a, k) => a?.[k], o),
  },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B }, instances: new Map() },
};
globalThis.fromUuidSync = () => null;

const M = await load('scripts/ui/content/IntegrityModel.js');
const { MODULE_ID, CONTENT_TYPES } = await load('scripts/utils/constants.js');
const { BUILTIN_EXAMPLES } = await load('scripts/ui/content/EntryTemplates.js');
const CR = await load('scripts/ui/content/ContentRenderers.js');
const { DataShardService } = await load('scripts/services/DataShardService.js');

const examples = () => Object.entries(BUILTIN_EXAMPLES).map(([t, e], i) => ({ ...clone(e), id: `ex-${t}-${i}`, messageId: `ex-${t}-${i}` }));

// ═══════════════════════════════════════════════════════════════════════════
section('config');

await ok('an empty block resolves to every default (no migration needed)', () => {
  const c = M.resolveIntegrity({});
  assert.equal(c.enabled, false);
  assert.equal(c.mode, 'cosmetic');
  assert.equal(c.legibility, 'rough');
  assert.equal(c.effects.steady, true);
  assert.equal(c.protectMoney, true);
  assert.equal(c.programsGlitchy, true);
  assert.equal(c.recon.enabled, true);
  assert.equal(c.dead.salvage, true);
});
await ok('zero is a real value (threshold, chance, hardening, degrade)', () => {
  const c = M.resolveIntegrity({ corruptionThreshold: 0, corruptionChance: 0, hardening: 0, degradePerFailure: 0 });
  assert.equal(c.corruptionThreshold, 0);
  assert.equal(c.corruptionChance, 0);
  assert.equal(c.degradePerFailure, 0);
});
await ok('legacy chance as a fraction reads the same; a typed percent is understood', () => {
  assert.equal(M.resolveIntegrity({ corruptionChance: 0.3 }).corruptionChance, 0.3);
  assert.equal(M.resolveIntegrity({ corruptionChance: 30 }).corruptionChance, 0.3);
});
await ok('junk is sanitised, not trusted', () => {
  const c = M.resolveIntegrity({ mode: 'x', legibility: 'x', loss: 'x', hardening: 500, recon: { step: '7' }, dead: { list: 'x' } });
  assert.equal(c.mode, 'cosmetic'); assert.equal(c.legibility, 'rough'); assert.equal(c.loss, 'parts');
  assert.equal(c.hardening, 90); assert.equal(c.recon.step, '25'); assert.equal(c.dead.list, 'list');
});

// ═══════════════════════════════════════════════════════════════════════════
section('tiers + garble');

await ok('tier bands', () => {
  assert.deepEqual([100, 75, 74, 50, 49, 25, 24, 1, 0].map(M.tierOf),
    ['clean', 'clean', 'light', 'light', 'heavy', 'heavy', 'severe', 'severe', 'bricked']);
});
await ok('garble rates rise with tier and with legibility', () => {
  for (const leg of ['readable', 'rough', 'hard']) {
    assert.ok(M.garbleRate(leg, 'light') < M.garbleRate(leg, 'heavy') && M.garbleRate(leg, 'heavy') < M.garbleRate(leg, 'severe'));
  }
  assert.ok(M.garbleRate('readable', 'severe') < M.garbleRate('hard', 'severe'));
  assert.equal(M.garbleRate('hard', 'clean'), 0);
});
await ok('garble is seeded — the same entry garbles the same way every render', () => {
  const s = 'Convoy manifest attached — ETA 0400.';
  assert.equal(M.garbleString(s, 0.3, 'e1'), M.garbleString(s, 0.3, 'e1'));
  assert.notEqual(M.garbleString(s, 0.3, 'e1'), M.garbleString(s, 0.3, 'e2'));
});
await ok('garble never touches markup', () => {
  const out = M.garbleString('<b>bold</b> text <i class="x">here</i>', 1, 'm');
  assert.ok(out.includes('<b>') && out.includes('</b>') && out.includes('<i class="x">'), out);
});

// ═══════════════════════════════════════════════════════════════════════════
section('loss — monotonic + per type');

await ok('raising the level only ever adds lost units (reconstruct gives back the newest first)', () => {
  for (let k = 0; k < 60; k++) {
    const at = (l) => M.isUnitLost('entryX', k, l);
    assert.ok(!at(0.25) || at(0.5)); assert.ok(!at(0.5) || at(0.75)); assert.ok(!at(0.75) || at(1));
  }
});
await ok('every built-in example survives applyLoss at every level, and is fully lost at 1', () => {
  const cfg = M.resolveIntegrity({ enabled: true, mode: 'mechanical', protectMoney: false, programsGlitchy: false });
  for (const e of examples()) {
    for (const lv of [0, 0.25, 0.5, 0.75]) M.applyLoss(clone(e), lv, cfg);
    assert.ok(M.applyLoss(clone(e), 1, cfg).gone, `${e.contentType} not gone at 1`);
  }
});
await ok('protected money is never lost: a cred drop keeps every eb, a bank keeps its balances', () => {
  const cfg = M.resolveIntegrity({ mode: 'mechanical' });
  const ex = examples();
  const ed = ex.find((e) => e.contentType === 'eddies');
  const d1 = M.applyLoss(ed, 1, cfg);
  assert.equal(d1.special, 'safe'); assert.ok(!d1.gone); assert.equal(ed.contentData.amount, 25000);
  const bk = ex.find((e) => e.contentType === 'banking');
  const before = bk.contentData.transactions.map((t) => t.amount);
  const d2 = M.applyLoss(bk, 1, cfg);
  assert.ok(!d2.gone); assert.equal(bk.contentData.balance, 2419650);
  assert.deepEqual(bk.contentData.transactions.map((t) => t.amount), before);
});
await ok('unprotected money really loses eb', () => {
  const cfg = M.resolveIntegrity({ mode: 'mechanical', protectMoney: false });
  const ed = examples().find((e) => e.contentType === 'eddies');
  M.applyLoss(ed, 0.5, cfg);
  assert.equal(ed.contentData.amount, 12500);
});
await ok('damaged programs turn unstable instead of disappearing', () => {
  const cfg = M.resolveIntegrity({ mode: 'mechanical' });
  const p = examples().find((e) => e.contentType === 'payload');
  const d = M.applyLoss(p, 1, cfg);
  assert.equal(d.special, 'glitchy'); assert.ok(!d.gone);
  assert.deepEqual(M.unstableFor(0.5, cfg), { dvPenalty: 2, misfire: 25 });
  assert.equal(M.unstableFor(0, cfg), null);
  assert.equal(M.unstableFor(0.5, M.resolveIntegrity({ programsGlitchy: false })), null);
});
await ok("'whole' loss is the old all-or-nothing", () => {
  const cfg = M.resolveIntegrity({ mode: 'mechanical', loss: 'whole' });
  const s = examples().find((e) => e.contentType === 'spreadsheet');
  assert.ok(!M.applyLoss(clone(s), 0.25, cfg).gone);
  assert.ok(M.applyLoss(clone(s), 0.5, cfg).gone);
});
await ok('legacy `corrupted: true` reads as fully lost; corruption wins when present', () => {
  assert.equal(M.entryLevel({ corrupted: true }), 1);
  assert.equal(M.entryLevel({ corrupted: true, corruption: 0.25 }), 0.25);
  assert.equal(M.entryLevel({}), 0);
});

// ═══════════════════════════════════════════════════════════════════════════
section('hits + recovery');

await ok('hardening slows damage but never stops it', () => {
  assert.equal(M.effectiveHit(15, 0), 15);
  assert.equal(M.effectiveHit(15, 40), 9);
  assert.equal(M.effectiveHit(1, 90), 1);
  assert.equal(M.effectiveHit(0, 40), 0);
});
await ok('reconstruct DV climbs with damage; success/failure move the level', () => {
  const cfg = M.resolveIntegrity({});
  assert.equal(M.reconDV(0.25, cfg), 15); assert.equal(M.reconDV(1, cfg), 21);
  assert.equal(M.afterRecon(0.75, true, cfg), 0.5);
  assert.equal(M.afterRecon(0.75, false, cfg), 1);
  assert.equal(M.afterRecon(0.75, true, M.resolveIntegrity({ recon: { step: 'all' } })), 0);
  assert.equal(M.afterRecon(0.5, false, M.resolveIntegrity({ recon: { worsen: false } })), 0.5);
});
await ok('the dead-screen trace steps down per hit then runs flat', () => {
  const g = M.traceGeometry([100, 85, 70, 0]);
  assert.equal((g.d.match(/ H/g) || []).length, 3);
  assert.ok(g.flatX > 0 && g.flatX < g.W);
  assert.deepEqual(g.labels, [100, 85, 70, 0]);
});

// ═══════════════════════════════════════════════════════════════════════════
section('the service — real DataShardService methods');

/** A shard item + its journal, recording writes in order. */
function mockShard(integrity, entries) {
  const writes = [];
  const pages = entries.map((e, i) => ({
    id: `p${i}`,
    flags: { [MODULE_ID]: { type: 'shard-message', messageId: e.id, contentType: e.contentType, subject: e.subject, contentData: e.contentData, corruption: e.corruption ?? 0, corrupted: false } },
    async update(u) { writes.push({ kind: 'page', u }); for (const [k, v] of Object.entries(u)) { if (k.startsWith(`flags.${MODULE_ID}.`)) this.flags[MODULE_ID][k.slice(MODULE_ID.length + 7)] = v; } },
  }));
  const journal = {
    pages,
    async updateEmbeddedDocuments(_t, ups) {
      writes.push({ kind: 'pages', n: ups.length });
      for (const u of ups) { const p = pages.find((x) => x.id === u._id); for (const [k, v] of Object.entries(u)) if (k !== '_id') p.flags[MODULE_ID][k.slice(MODULE_ID.length + 7)] = v; }
    },
  };
  const flags = { isDataShard: true, journalId: 'J', config: { integrity }, state: {} };
  const item = {
    id: 'I', uuid: 'Item.I', name: 'Courier shard',
    getFlag: (_m, k) => flags[k],
    async update(u) {
      writes.push({ kind: 'item', u });
      for (const [k, v] of Object.entries(u)) {
        const keys = k.replace(`flags.${MODULE_ID}.`, '').split('.');
        let o = flags; while (keys.length > 1) { const kk = keys.shift(); o = (o[kk] ??= {}); } o[keys[0]] = v;
      }
    },
    async unsetFlag() {}, async setFlag(_m, k, v) { flags[k] = v; },
  };
  game.journal.get = () => journal;
  return { item, journal, pages, writes, flags };
}
const svc = new DataShardService();
const msgs = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, contentType: 'spreadsheet', subject: `S${i}`, contentData: {} }));

await ok('a hit lowers integrity, records history + who, and writes pages BEFORE the item', async () => {
  const { item, writes, flags } = mockShard({ enabled: true, mode: 'mechanical', currentIntegrity: 40, corruptionThreshold: 50, corruptionChance: 1 }, msgs(3));
  const r = await svc.degradeIntegrity(item, { by: 'V' });
  assert.equal(r.newIntegrity, 25);
  assert.equal(r.damaged.length, 3);
  assert.equal(writes[0].kind, 'pages', 'entry damage must land before the item update the viewer re-renders on');
  assert.equal(writes.at(-1).kind, 'item');
  assert.deepEqual(flags.config.integrity.history, [40, 25]);
  assert.equal(flags.config.integrity.lastHit.by, 'V');
});
await ok('the threshold is a PERCENT — with Max 200, 90 points (45%) is under a 50% threshold', async () => {
  const { item, pages } = mockShard({ enabled: true, mode: 'mechanical', maxIntegrity: 200, currentIntegrity: 105, degradePerFailure: 15, corruptionThreshold: 50, corruptionChance: 1 }, msgs(1));
  await svc.degradeIntegrity(item);
  assert.equal(pages[0].flags[MODULE_ID].corruption, 0.25);
});
await ok('cosmetic mode never touches entries', async () => {
  const { item, writes } = mockShard({ enabled: true, mode: 'cosmetic', currentIntegrity: 20, corruptionChance: 1 }, msgs(2));
  await svc.degradeIntegrity(item);
  assert.ok(!writes.some((w) => w.kind === 'pages'));
});
await ok('hardening reduces the hit', async () => {
  const { item } = mockShard({ enabled: true, currentIntegrity: 100, hardening: 40 }, msgs(0));
  assert.equal((await svc.degradeIntegrity(item)).newIntegrity, 91);
});
await ok('a PLAYER relays instead of writing (this is why players never corrupted anything)', async () => {
  const { item, writes } = mockShard({ enabled: true, mode: 'mechanical', currentIntegrity: 40, corruptionChance: 1 }, msgs(2));
  game.user.isGM = false; emitted.length = 0;
  const r = await svc.degradeIntegrity(item, { by: 'V' });
  game.user.isGM = true;
  assert.ok(r.relayed); assert.equal(writes.length, 0);
  assert.equal(emitted[0].op, 'shard:integrityRequest');
  assert.equal(emitted[0].d.op, 'degrade'); assert.equal(emitted[0].d.itemUuid, 'Item.I');
});
await ok('a full restore repairs every entry and clears history + salvage attempts', async () => {
  const { item, pages, flags } = mockShard({ enabled: true, mode: 'mechanical', currentIntegrity: 0, history: [100, 0], salvaged: ['a1'] },
    [{ ...msgs(1)[0], corruption: 1 }, { ...msgs(2)[1], corruption: 0.5 }]);
  await svc.setIntegrity(item, 100);
  assert.ok(pages.every((p) => p.flags[MODULE_ID].corruption === 0 && p.flags[MODULE_ID].corrupted === false));
  assert.deepEqual(flags.config.integrity.history, []); assert.deepEqual(flags.config.integrity.salvaged, []);
});
await ok('salvage: a success brings it back damaged; a failure only spends the attempt', async () => {
  const a = mockShard({ enabled: true, mode: 'mechanical', currentIntegrity: 0 }, msgs(2));
  await svc.salvageShard(a.item, 'v1', true);
  assert.equal(a.flags.config.integrity.currentIntegrity, 20);
  assert.ok(a.pages.every((p) => p.flags[MODULE_ID].corruption === 0.75));
  const b = mockShard({ enabled: true, mode: 'mechanical', currentIntegrity: 0 }, msgs(1));
  await svc.salvageShard(b.item, 'v1', false);
  assert.equal(b.flags.config.integrity.currentIntegrity, 0); assert.deepEqual(b.flags.config.integrity.salvaged, ['v1']);
});
await ok('an uploaded copy carries its damage; a fully lost entry cannot leave the chip', () => {
  const ex = examples();
  const chat = ex.find((e) => e.contentType === 'chatlog');
  const { item } = mockShard({ enabled: true, mode: 'mechanical' }, []);
  const copy = svc.exportEntry(item, { ...chat, corruption: 0.75 });
  assert.ok(JSON.stringify(copy).includes(M.LOST), 'the copy should carry the loss');
  assert.equal(copy.corruption, undefined);
  assert.equal(svc.exportEntry(item, { ...chat, corruption: 1 }), null);
  assert.equal(svc.exportEntry(item, chat), chat, 'an undamaged entry is passed through untouched');
});

// ═══════════════════════════════════════════════════════════════════════════
section('the index strip — real ItemInboxApp view-model');

let ItemInboxApp = null;
try { ({ ItemInboxApp } = await load('scripts/ui/ItemInbox/ItemInboxApp.js')); }
catch (err) { console.log(`  ~ skipped — ItemInboxApp did not import here (${err.message})`); }
if (ItemInboxApp) {
  const chipsFor = (gm, level, cfgOver = {}) => {
    game.user.isGM = gm;
    const ex = examples().filter((e) => ['spreadsheet', 'chatlog', 'eddies', 'payload'].includes(e.contentType));
    const entries = ex.map((e) => ({ ...e, corruption: e.contentType === 'chatlog' ? 1 : level }));
    const integrity = { enabled: true, cfg: M.resolveIntegrity({ enabled: true, mode: 'mechanical', ...cfgOver }) };
    const app = Object.create(ItemInboxApp.prototype);
    app._playerContactEmails = new Set();
    const enriched = entries.map((e) => app._enrichWithIntegrity(e, integrity)).filter(Boolean);
    const chips = app._buildIndexChips(entries.filter((e) => enriched.some((x) => x.id === e.id)), 0, null);
    app._applyIntegrityToChips(chips, enriched);
    game.user.isGM = true;
    return { entries, enriched, chips };
  };
  await ok('LEAK: a heavily damaged entry\'s chip shows the same garbled title as its card (players)', () => {
    const { entries, enriched, chips } = chipsFor(false, 0.75);
    const sheet = entries.find((e) => e.contentType === 'spreadsheet');
    const chip = chips.find((c) => c.id === sheet.id);
    const card = enriched.find((e) => e.id === sheet.id);
    assert.notEqual(chip.title, sheet.subject, 'the chip printed the real title');
    assert.equal(chip.title, card.subject, 'chip and card disagree');
  });
  await ok('LEAK: a lost entry\'s chip says "Sector lost", not its title (players)', () => {
    const { entries, chips } = chipsFor(false, 0.25);
    const chat = entries.find((e) => e.contentType === 'chatlog');
    const chip = chips.find((c) => c.id === chat.id);
    assert.equal(chip.title, 'Sector lost');
    assert.ok(chip.ig.gone && chip.iconClass.includes('file-circle-xmark'));
  });
  await ok('chips carry the meter; protected money carries none; programs read unstable', () => {
    const { entries, chips } = chipsFor(false, 0.5);
    const by = (t) => chips.find((c) => c.id === entries.find((e) => e.contentType === t).id);
    assert.deepEqual(by('spreadsheet').ig.meter, [true, true, false, false]);
    assert.equal(by('eddies').ig.damaged, false, 'protected money should not look damaged');
    assert.ok(by('payload').ig.glitchy);
  });
  await ok('the GM sees real titles and the exact % in a tooltip', () => {
    const { entries, chips } = chipsFor(true, 0.75);
    const sheet = entries.find((e) => e.contentType === 'spreadsheet');
    const chip = chips.find((c) => c.id === sheet.id);
    assert.equal(chip.title, sheet.subject);
    assert.ok(chip.ig.tooltip.startsWith('75% damaged'));
  });
  await ok('hidden lost entries are gone from the strip for players, kept for the GM', () => {
    assert.ok(!chipsFor(false, 0.25, { hideLost: true }).chips.some((c) => c.title === 'Sector lost'));
    assert.equal(chipsFor(true, 0.25, { hideLost: true }).chips.length, 4);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
section('real templates (Foundry Handlebars)');

const CANDIDATES = [
  'C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json',
  'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json',
];
let HB = null;
for (const p of CANDIDATES) {
  if (!fs.existsSync(p)) continue;
  try { HB = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!HB) {
  console.log('  ~ skipped — no Handlebars from a Foundry install');
} else {
  const cmp = (fn) => function (a, b, o) { const r = fn(a, b); return o?.fn ? (r ? o.fn(this) : o.inverse(this)) : r; };
  HB.registerHelper('eq', cmp((a, b) => a === b)); HB.registerHelper('gt', cmp((a, b) => a > b)); HB.registerHelper('lt', cmp((a, b) => a < b));
  HB.registerHelper('gte', cmp((a, b) => a >= b)); HB.registerHelper('lte', cmp((a, b) => a <= b)); HB.registerHelper('neq', cmp((a, b) => a !== b));
  HB.registerHelper('and', (...a) => a.slice(0, -1).every(Boolean)); HB.registerHelper('or', (...a) => a.slice(0, -1).some(Boolean));
  HB.registerHelper('not', (v) => !v); HB.registerHelper('add', (a, b) => (a || 0) + (b || 0));
  HB.registerHelper('helperMissing', () => '');
  const body = HB.compile(read('templates/content/content-body.hbs'));
  HB.registerPartial('modules/night-city-messenger/templates/content/content-body.hbs', read('templates/content/content-body.hbs'));
  const cfg = M.resolveIntegrity({ enabled: true, mode: 'mechanical' });

  await ok('LEAK: lost data never reaches the DOM (chat / document / syslog / calendar)', () => {
    for (const t of ['chatlog', 'document', 'syslog', 'calendar']) {
      const e = examples().find((x) => x.contentType === t);
      const orig = clone(e);
      M.applyLoss(e, 0.75, cfg);
      const html = body(CR.enrichContent(e, { isGM: false, interactive: true }));
      const units = { chatlog: ['messages', 'text'], document: ['paragraphs', 'text'], syslog: ['lines', 'msg'], calendar: ['events', 'title'] }[t];
      const lostOnes = orig.contentData[units[0]].filter((u, k) => {
        if (t === 'chatlog') return false;   // chat lost-ness is checked below by kind
        return M.isUnitLost(e.id, k, 0.75) && typeof u[units[1]] === 'string' && u[units[1]].length > 12;
      });
      for (const u of lostOnes) {
        const probe = u[units[1]].replace(/<[^>]+>/g, '').slice(0, 24);
        assert.ok(!html.includes(probe), `${t}: "${probe}" leaked`);
      }
      assert.ok(html.includes(M.LOST) || t === 'chatlog', `${t}: no lost marker rendered`);
    }
    const chat = examples().find((x) => x.contentType === 'chatlog');
    const before = clone(chat);
    M.applyLoss(chat, 0.75, cfg);
    const html = body(CR.enrichContent(chat, { isGM: false, interactive: true }));
    const gone = before.contentData.messages.filter((m) => m.kind !== 'system' && m.text)
      .filter((m, k) => M.isUnitLost(chat.id, before.contentData.messages.filter((x) => x.kind !== 'system').indexOf(m), 0.75));
    for (const m of gone) assert.ok(!html.includes(m.text), `chat leaked "${m.text}"`);
    assert.ok(html.includes('packet lost'));
  });

  await ok('item-inbox.hbs renders the state word, damage bar, lost entry, and dead screen', () => {
    HB.registerHelper('ncm-isGM', () => false);
    const tpl = HB.compile(read('templates/item-inbox/item-inbox.hbs'));
    const entry = (over) => ({
      id: 'e1', accentColor: 'cyan', entryIcon: 'fas fa-table', contentTypeLabel: 'Spreadsheet', subject: 'Q3', isMessage: false,
      ig: { damaged: true, showBar: true, pct: 50, meter: [true, true, false, false], summary: '5 of 24 cells unreadable', recon: { dv: 17 }, delay: '1.00' },
      ...over,
    });
    const base = { hasItem: true, igOn: true, integrityEnabled: true, integrityPercent: 38, integrityTier: 'heavy', igLegibility: 'rough', igScan: 1, igTear: 1, igSteady: 1, igStateWord: 'Unstable', hasEntries: true };
    const html = tpl({ ...base, visibleEntries: [entry({}), entry({ id: 'e2', ig: { damaged: true, gone: true, recon: { dv: 21 } } })] });
    assert.ok(html.includes('data-integrity-tier="heavy"') && html.includes('data-integrity-legibility="rough"'));
    assert.ok(html.includes('ncm-ig-state--heavy') && html.includes('Unstable'));
    assert.ok(html.includes('5 of 24 cells unreadable') && html.includes('Reconstruct · DV 17'));
    assert.ok(html.includes('Sector lost') && html.includes('Reconstruct · DV 21'));
    assert.ok(!html.includes('DATA CORRUPTED'), 'the old overlay must not render');

    const dead = tpl({ ...base, integrityTier: 'bricked', isDestroyed: true, shardDisplayName: 'Courier',
      igDead: { max: 100, lost: 3, breaches: 7, lastBy: 'V', trace: M.traceGeometry([100, 50, 0]), traceLabel: '100 → 50 → 0', rows: [{ icon: 'fas fa-table', label: 'Spreadsheet', name: '▓▒░' }], showList: true, showCount: true, salvage: { dv: 22, pct: 20 } } });
    assert.ok(dead.includes('Data unrecoverable') && dead.includes('Attempt salvage · DV 22') && dead.includes('100 → 50 → 0'));
    assert.ok(!dead.includes('ncm-shard-destroyed"'), 'integrity death uses the new screen, not the old panel');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
section('wiring');

await ok('stylesheet is imported, after content-types', () => {
  const css = read('styles/night-city-messenger.css');
  const a = css.indexOf("components/content-types.css"), b = css.indexOf("components/shard-integrity.css");
  assert.ok(a > -1 && b > a);
});
await ok('every viewer action the template uses is registered', () => {
  const app = read('scripts/ui/ItemInbox/ItemInboxApp.js');
  for (const a of ['igReconstruct', 'igRepair', 'igSalvage', 'igRestore', 'igPeek']) assert.ok(app.includes(`${a}: ItemInboxApp._on`), a);
});
await ok('every admin action the template uses is registered with a delegator', () => {
  const app = read('scripts/ui/AdminPanel/AdminPanelApp.js');
  for (const a of ['damageShard', 'toggleShardDamageRoll', 'setShardEntryDamage', 'repairAllShardEntries', 'openShardEntry']) {
    assert.ok(app.includes(`${a}: AdminPanelApp._on`), a);
    assert.ok(read('templates/admin-panel/tab-shards.hbs').includes(`data-action="${a}"`), `${a} not in template`);
  }
});
await ok('LEAK: a bricked shard shows no index strip (it would print the names the dead screen scrambles)', () => {
  assert.ok(/showIndexStrip: totalEntryCount > 1 && !\(state\.destroyed === true \|\| integrity\.isBricked\)/.test(read('scripts/ui/ItemInbox/ItemInboxApp.js')));
});
await ok('the relay op exists and the GM handles it', () => {
  assert.ok(read('scripts/utils/constants.js').includes("SHARD_INTEGRITY_REQUEST: 'shard:integrityRequest'"));
  assert.ok(read('scripts/integrations/SocketHandlers.js').includes('SOCKET_OPS.SHARD_INTEGRITY_REQUEST'));
});
await ok('config save no longer heals the shard (current carried over, not reset to Max)', () => {
  const src = read('scripts/ui/ItemInbox/ItemInboxConfig.js');
  assert.ok(!/currentIntegrity:\s*parseInt\(val\('integrityMax'\)\)/.test(src));
  assert.ok(src.includes('_collectIntegrity(val, checked)'));
});
await ok('the program run flows honour instability', () => {
  const sf = read('scripts/ui/content/SiphonFlow.js');
  assert.ok(/runMalwareDeploy\(\{[^)]*unstable = null/.test(sf) && /runPayloadExecute\(\{[^)]*unstable = null/.test(sf));
  assert.ok(read('scripts/ui/ProgramDeck/ProgramDeckApp.js').includes('programInstability'));
});
await ok('templates are balanced', () => {
  for (const f of ['templates/item-inbox/item-inbox.hbs', 'templates/item-inbox/item-inbox-config.hbs', 'templates/admin-panel/tab-shards.hbs']) {
    const s = read(f).replace(/\{\{!--[\s\S]*?--\}\}/g, '');
    const o = (s.match(/\{\{~?#(if|unless|each|with)\b/g) || []).length, c = (s.match(/\{\{~?\/(if|unless|each|with)\b/g) || []).length;
    assert.equal(o, c, `${f} ${o}/${c}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
