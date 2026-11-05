#!/usr/bin/env node
/**
 * measure-world-settings — how big is each NCM world setting in a real world? (stage 2, step 13)
 *
 *   node dev/tools/measure-world-settings.cjs --world <path to a world folder> [--world …] [--all] [--top 15]
 *   node dev/tools/measure-world-settings.cjs --data <Foundry Data folder>      (every world in it)
 *
 * A world setting is sent WHOLE to every connected client each time it is written, so a large one that is written
 * often (an append log) costs bandwidth and an `updateSetting` hook on every client per write. This reads each world's
 * settings database and lists NCM's settings by size, with the entry count for list/map settings and what writes them.
 *
 * Read-only: it COPIES the world's `data/settings` LevelDB folder to a temp folder and opens only the copy (a world
 * that is running holds a LOCK on the original), then deletes the copy. It never opens or writes the world itself.
 * Needs Foundry's LevelDB library (classic-level), found in the Foundry install like gen-macros.cjs does.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_ID = 'night-city-messenger';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const all = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const TOP = Number(opt('--top')) || 15;
const SHOW_ALL = args.includes('--all');

// which settings are append-style logs, their cap in code, and when they are written
const GROWTH = {
  traceLog: 'append log · cap 250 rows · every trace and logged success',
  networkAccessLog: 'append log · cap 500 rows · network logins, switches, denials',
  deliveryFailures: 'append log · cap 100 rows · each failed delivery (keeps a retry copy of the message)',
  npcMailAnswered: 'map · cap 1500 · the GM marks NPC mail answered',
  traceHeat: 'map · cooled entries pruned · each failed trace',
  traceCountdowns: 'list · GM-started countdowns',
  phoneWrittenLogs: 'map of lists · no cap · calls the GM writes by hand',
  overheardCalls: 'scripts · no cap · GM-written',
  scheduledMessages: 'list · sent ones pruned · scheduled mail (full message each)',
  networkNodes: 'map · node log capped at 40 lines each · every node action',
  phoneEmergencyActive: 'list · active emergencies',
};

function findClassicLevel() {
  const { createRequire } = require('module');
  const tries = [];
  if (process.env.NCM_CLASSIC_LEVEL) tries.push(process.env.NCM_CLASSIC_LEVEL);
  tries.push(path.join(__dirname, '..', '..', 'node_modules', 'package.json'));
  for (const base of ['C:/Program Files/Foundry Virtual Tabletop', 'C:/Program Files (x86)/Foundry Virtual Tabletop', '/opt/foundryvtt', '/Applications/Foundry Virtual Tabletop.app/Contents/Resources'])
    tries.push(path.join(base, 'resources', 'app', 'package.json'));
  for (const p of tries) { try { return createRequire(p)('classic-level').ClassicLevel; } catch { /* next */ } }
  try { return require('classic-level').ClassicLevel; } catch { return null; }
}

const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const countOf = (v) => (Array.isArray(v) ? `${v.length} rows` : v && typeof v === 'object' ? `${Object.keys(v).length} keys` : '');

async function measure(worldDir, ClassicLevel) {
  const src = path.join(worldDir, 'data', 'settings');
  if (!fs.existsSync(src)) return { world: path.basename(worldDir), error: 'no data/settings folder' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncm-settings-'));
  try {
    for (const f of fs.readdirSync(src)) if (f !== 'LOCK') fs.copyFileSync(path.join(src, f), path.join(tmp, f));
    const db = new ClassicLevel(tmp, { valueEncoding: 'utf8' });
    await db.open();
    const rows = [];
    for await (const [, raw] of db.iterator()) {
      let doc; try { doc = JSON.parse(raw); } catch { continue; }
      if (!String(doc.key || '').startsWith(`${MODULE_ID}.`)) continue;
      const key = doc.key.slice(MODULE_ID.length + 1);
      let value = doc.value; try { value = JSON.parse(doc.value); } catch { /* a plain string */ }
      rows.push({ key, bytes: Buffer.byteLength(String(doc.value ?? ''), 'utf8'), count: countOf(value), note: GROWTH[key] || '' });
    }
    await db.close();
    rows.sort((a, b) => b.bytes - a.bytes);
    return { world: path.basename(worldDir), rows, total: rows.reduce((s, r) => s + r.bytes, 0) };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

(async () => {
  const ClassicLevel = findClassicLevel();
  if (!ClassicLevel) { console.error('measure-world-settings: classic-level not found (install Foundry, or set NCM_CLASSIC_LEVEL)'); process.exit(1); }
  let worlds = all('--world');
  const data = opt('--data');
  if (data) worlds = worlds.concat(fs.readdirSync(path.join(data, 'worlds')).map((w) => path.join(data, 'worlds', w)).filter((p) => fs.statSync(p).isDirectory()));
  if (!worlds.length) { console.error('usage: --world <world folder> (repeatable) or --data <Foundry Data folder>'); process.exit(1); }
  const summary = [];
  for (const w of worlds) {
    const r = await measure(w, ClassicLevel);
    if (r.error) { console.log(`\n${r.world}: ${r.error}`); continue; }
    if (!r.rows.length) { console.log(`\n${r.world}: no NCM settings`); continue; }
    console.log(`\n${r.world} — ${r.rows.length} NCM world settings, ${kb(r.total)} in all`);
    for (const x of (SHOW_ALL ? r.rows : r.rows.slice(0, TOP))) console.log(`  ${kb(x.bytes).padStart(9)}  ${x.key.padEnd(30)} ${x.count.padEnd(10)} ${x.note}`);
    for (const k of Object.keys(GROWTH)) { const x = r.rows.find((y) => y.key === k); summary.push({ world: r.world, key: k, bytes: x?.bytes || 0, count: x?.count || '' }); }
  }
  // the append logs across every world measured
  console.log('\nappend-style settings, largest seen:');
  for (const k of Object.keys(GROWTH)) {
    const top = summary.filter((s) => s.key === k).sort((a, b) => b.bytes - a.bytes)[0];
    if (top) console.log(`  ${kb(top.bytes).padStart(9)}  ${k.padEnd(22)} ${String(top.count).padEnd(10)} (${top.world})`);
  }
})().catch((e) => { console.error('measure-world-settings:', e.message); process.exit(1); });
