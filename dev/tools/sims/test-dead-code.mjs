// test-dead-code — the module carries no code nothing reaches (stage 2, batch 5), and stays that way.
//   - every scripts/ file is loaded from main.js (static or dynamic import)
//   - every EVENTS key is used; every event something waits for is sent by something
//   - every public hook mirror (IntegrationBridge) has a sender
//   - every socket op that is sent has a receiver
// A static search: an event sent through a variable would not be seen. Each rule lists what it found.
// Run: node dev/tools/sims/test-dead-code.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const files = walk(path.join(ROOT, 'scripts'));
const src = Object.fromEntries(files.map((f) => [rel(f), readFileSync(f, 'utf8')]));
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // comments name things they don't use
const all = Object.entries(src).filter(([k]) => k !== 'scripts/utils/constants.js').map(([, t]) => code(t)).join('\n');
const consts = src['scripts/utils/constants.js'] || '';
const block = (name) => { const i = consts.indexOf(`export const ${name} = Object.freeze({`); if (i < 0) return {}; const j = consts.indexOf('\n});', i); return Object.fromEntries([...consts.slice(i, j).matchAll(/^\s*([A-Z_0-9]+)\s*:\s*'([^']+)'/gm)].map((m) => [m[1], m[2]])); };

// 1. every file is reachable from main.js
{
  const edges = (f) => {
    const t = code(src[f] || '');
    const specs = [...t.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g), ...t.matchAll(/(?:^|\n)\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/g), ...t.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    return specs.map((s) => rel(path.resolve(path.dirname(path.join(ROOT, f)), s)));
  };
  const seen = new Set(); const stack = ['scripts/main.js'];
  while (stack.length) { const f = stack.pop(); if (seen.has(f) || !(f in src)) continue; seen.add(f); stack.push(...edges(f)); }
  const orphans = Object.keys(src).filter((f) => !seen.has(f));
  ok(orphans.length === 0, `every scripts/ file is loaded from main.js (nothing loads: ${orphans.join(', ')})`);
  for (const f of ['scripts/integrations/EmailSettingsIntegration.js', 'scripts/ui/dialogs/PlayerEmailSetup.js', 'scripts/utils/validators.js'])
    ok(!existsSync(path.join(ROOT, f)), `${f} (unused since early 2026) is gone`);
}

// 2. events
{
  const EV = block('EVENTS');
  ok(Object.keys(EV).length > 40, `EVENTS read from constants.js (${Object.keys(EV).length})`);
  const used = (k) => new RegExp(`EVENTS\\.${k}\\b`).test(all) || all.includes(`'${EV[k]}'`);
  const unused = Object.keys(EV).filter((k) => !used(k));
  ok(unused.length === 0, `every EVENTS key is used (unused: ${unused.join(', ')})`);
  // sent = named inside an emit(…) / a service's own _emit(…) call on one line (covers `_emit(c ? EVENTS.A : EVENTS.B, …)`)
  const sent = (k) => new RegExp(`_?emit\\??\\.?\\([^\\n]*EVENTS\\.${k}\\b`).test(all) || new RegExp(`_?emit\\??\\.?\\(\\s*'${EV[k].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(all);
  const waited = Object.keys(EV).filter((k) => new RegExp(`(?:\\.on|subscribe)\\(\\s*EVENTS\\.${k}\\b`).test(all));
  const deaf = waited.filter((k) => !sent(k));
  ok(deaf.length === 0, `every event something waits for is sent (never sent: ${deaf.join(', ')})`);

  // public hook mirrors
  // the table (publicEvents.js, batch 9), or the older inline list in the bridge
  const pe = src['scripts/integrations/publicEvents.js'] || src['scripts/integrations/IntegrationBridge.js'] || '';
  const list = (pe.match(/export const PUBLIC_EVENTS = Object\.freeze\(\[([\s\S]*?)\]\);/) || pe.match(/const MIRRORED_EVENTS = \[([\s\S]*?)\];/) || [])[1] || '';
  const mirrored = [...code(list).matchAll(/(?:name: |^\s*)'([a-z]+:[A-Za-z]+)'/gm)].map((m) => m[1]);
  ok(mirrored.length >= 10, `IntegrationBridge mirrors read (${mirrored.length})`);
  const byValue = Object.fromEntries(Object.entries(EV).map(([k, v]) => [v, k]));
  const silent = mirrored.filter((v) => !(byValue[v] ? sent(byValue[v]) : new RegExp(`emit\\??\\.?\\(\\s*'${v}'`).test(all)));
  ok(silent.length === 0, `every public hook (night-city-messenger.<event>) has a sender (never sent: ${silent.join(', ')})`);
  ok(!/contacts:burned|contacts:verified/.test(list), 'the two hooks that could never fire are no longer offered');
  ok(/Removed 2026-11-05:\*\* `…contacts:burned` and `…contacts:verified`/.test(existsSync(path.join(ROOT, 'INTEGRATION.md')) ? readFileSync(path.join(ROOT, 'INTEGRATION.md'), 'utf8') : ''), 'INTEGRATION.md says they were removed and why');
}

// 3. socket ops
{
  const OPS = block('SOCKET_OPS');
  const sentOps = Object.keys(OPS).filter((k) => new RegExp(`emit\\??\\.?\\(\\s*SOCKET_OPS\\.${k}\\b`).test(all));
  const received = (k) => new RegExp(`(?:register\\(\\s*|awaitGmResult\\([^,]+,\\s*)SOCKET_OPS\\.${k}\\b`).test(all);
  const unheard = sentOps.filter((k) => !received(k));
  ok(unheard.length === 0, `every socket op that is sent has a receiver (sent to nobody: ${unheard.join(', ')})`);
  ok(!('SHARD_STATE_CHANGED' in OPS) && !('TERMINAL_STATE_CHANGED' in OPS), 'the two broadcasts nobody received are gone');
  ok(!/_broadcastStateChange/.test(all), 'no _broadcastStateChange left');
}

// 4. specific leftovers
ok(!/showShardExpired/.test(all), 'the "Shard expired" toast nothing could trigger is gone');

console.log(`test-dead-code: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
