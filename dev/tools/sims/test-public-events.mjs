// test-public-events — the events NCM publishes to other modules are ONE table, and it tells the truth
// (stage 2, batch 9: scripts/integrations/publicEvents.js).
//   1. the table is well formed
//   2. every event has a sender, and every send's payload stays inside the documented fields
//   3. the REAL IntegrationBridge mirrors exactly the table; message:received fires once per message
//   4. INTEGRATION.md names every event
// Run: node dev/tools/sims/test-public-events.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const src = Object.fromEntries(walk(path.join(ROOT, 'scripts')).map((f) => [rel(f), readFileSync(f, 'utf8')]));
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const tableFile = 'scripts/integrations/publicEvents.js';
ok(existsSync(path.join(ROOT, tableFile)), `${tableFile} exists`);
if (!existsSync(path.join(ROOT, tableFile))) { console.log(`test-public-events: ${pass} passed, ${fail} failed`); process.exit(1); }
const { PUBLIC_EVENTS, passOnce, DEDUPE_MS } = await imp(tableFile);

// ═══ 1. well formed ═══
const names = PUBLIC_EVENTS.map((e) => e.name);
ok(names.length >= 10 && new Set(names).size === names.length, `${names.length} events, no name twice`);
ok(PUBLIC_EVENTS.every((e) => /^[a-z]+:[A-Za-z]+$/.test(e.name) && e.means && e.firesOn && e.since && Array.isArray(e.fields) && e.fields.length), 'every row has a name, meaning, firing client, since and fields');
ok(Object.isFrozen(PUBLIC_EVENTS), 'the table is frozen');

// ═══ 2. senders and payloads ═══
const consts = src['scripts/utils/constants.js'];
const evBlock = consts.slice(consts.indexOf('export const EVENTS = Object.freeze({'), consts.indexOf('\n});', consts.indexOf('export const EVENTS = Object.freeze({')));
const keyOf = Object.fromEntries([...evBlock.matchAll(/^\s*([A-Z_0-9]+)\s*:\s*'([^']+)'/gm)].map((m) => [m[2], m[1]]));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** top-level keys of the object literal starting at text[i] === '{' */
function topKeys(text, i) {
  let d = 0, j = i, buf = '', keys = [];
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '{' || c === '[' || c === '(') { d++; if (d === 1) continue; }
    if (c === '}' || c === ']' || c === ')') { d--; if (d === 0) break; }
    if (d === 1) buf += c; else if (d > 1 && (c === ',' )) buf += ' ';
  }
  // split the depth-1 text on commas; each part is `key: value`, `key`, or `...spread`
  for (const part of buf.split(',')) { const p = part.trim(); if (!p || p.startsWith('...')) continue; const m = p.match(/^['"]?([A-Za-z_$][\w$]*)['"]?\s*(:|$)/); if (m) keys.push(m[1]); }
  return keys;
}
const sends = {};   // name -> [{ file, keys }]
for (const [f, t0] of Object.entries(src)) {
  const t = strip(t0);
  for (const e of PUBLIC_EVENTS) {
    const k = keyOf[e.name];
    const re = new RegExp(`_?emit\\??\\.?\\(([^\\n;]*?)(${k ? `EVENTS\\.${k}\\b(?:\\s*\\?\\?\\s*'[^']*')?` : '(?!)'}|'${e.name.replace(':', '\\:')}')`, 'g');
    for (const m of t.matchAll(re)) {
      const after = m.index + m[0].length;
      const brace = t.indexOf('{', after); const close = t.indexOf(')', after);
      const keys = brace >= 0 && (close < 0 || brace < close || t.slice(after, brace).trim().startsWith(',')) && t.slice(after, brace).replace(/[\s,:?A-Z_.']/g, '') === '' ? topKeys(t, brace) : [];
      (sends[e.name] ||= []).push({ file: f, keys });
    }
  }
}
const silent = names.filter((n) => !sends[n]?.length);
ok(silent.length === 0, `every published event has a sender (none for: ${silent.join(', ')})`);
const undocumented = [];
for (const e of PUBLIC_EVENTS) for (const s of sends[e.name] || []) for (const k of s.keys) if (!e.fields.includes(k)) undocumented.push(`${e.name} in ${s.file}: "${k}"`);
ok(undocumented.length === 0, `every payload field a sender writes is documented:\n  ${[...new Set(undocumented)].join('\n  ')}`);
const parsed = Object.values(sends).flat().filter((s) => s.keys.length).length;
ok(parsed >= 12, `send sites whose payload was read (${parsed})`);

// ═══ 3. the real bridge ═══
const calls = [];
globalThis.Hooks = { callAll: (n, d) => calls.push([n, d]), on() {}, once() {}, off() {} };
globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
const quiet = console.log; console.log = () => {};
const { EventBus } = await imp('scripts/core/EventBus.js');
const bus = EventBus.getInstance();
const mod = { id: 'night-city-messenger' };
globalThis.game = { nightcity: { eventBus: bus, timeService: null }, modules: { get: () => mod }, user: { isGM: true } };
const { initializeIntegrationBridge } = await imp('scripts/integrations/IntegrationBridge.js');
await initializeIntegrationBridge();
console.log = quiet;
for (const n of names) bus.emit(n, { messageId: `m-${n}` });
const hooked = calls.filter(([n]) => n.startsWith('night-city-messenger.') && n !== 'night-city-messenger.apiReady').map(([n]) => n.replace('night-city-messenger.', ''));
ok(names.every((n) => hooked.includes(n)), 'every table event is mirrored as a night-city-messenger.<name> hook');
calls.length = 0; bus.emit('network:changed', {}); bus.emit('shard:stateChanged', {});
ok(calls.length === 0, 'an internal event that is not in the table is not published');
calls.length = 0;
bus.emit('message:received', { messageId: 'x1', from: 'socket' });
bus.emit('message:received', { messageId: 'x1', from: 'journal sync' });
bus.emit('message:received', { messageId: 'x2' });
ok(calls.filter(([n]) => n === 'night-city-messenger.message:received').length === 2 && calls[0][1].from === 'socket', 'message:received fires once per message (the second copy of x1 is dropped), and different messages both fire');
calls.length = 0; bus.emit('message:sent', { messageId: 's1' }); bus.emit('message:sent', { messageId: 's1' });
ok(calls.length === 2, 'events not marked once are passed on every time');
ok(/^1\.\d+\.\d+$/.test(mod.api?.apiVersion || '') && Number(mod.api.apiVersion.split('.')[1]) >= 1 && mod.api.publicEvents === PUBLIC_EVENTS, `the api object carries the table (apiVersion ${mod.api?.apiVersion}, 1.1.0 or later)`);
// passOnce, pure
const seen = new Map();
ok(passOnce(seen, { messageId: 'a' }, 0) && !passOnce(seen, { messageId: 'a' }, 100) && passOnce(seen, { messageId: 'a' }, DEDUPE_MS + 101), 'passOnce drops a repeat within the window and forgets after it');
ok(passOnce(seen, {}, 0) && passOnce(seen, {}, 0), 'a payload with no messageId is always passed on');
ok(!/MIRRORED_EVENTS/.test(src['scripts/integrations/IntegrationBridge.js']), 'the bridge has no list of its own any more');

// ═══ 4. the integration doc ═══
const doc = existsSync(path.join(ROOT, 'INTEGRATION.md')) ? readFileSync(path.join(ROOT, 'INTEGRATION.md'), 'utf8') : '';
const undoc = names.filter((n) => !doc.includes(`…${n}\``) && !doc.includes(`night-city-messenger.${n}`));
ok(undoc.length === 0, `INTEGRATION.md names every published event (missing: ${undoc.join(', ')})`);
ok(/scripts\/integrations\/publicEvents\.js/.test(doc) && /once\s+per message per client/.test(doc), 'INTEGRATION.md points at the table and says message:received fires once');

console.log(`test-public-events: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
