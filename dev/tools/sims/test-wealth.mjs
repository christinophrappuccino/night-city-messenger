// test-wealth — every change to a character's eddies goes through scripts/utils/wealth.js (stage 2, batch 3).
// Drives the REAL adjustWealth against a mocked actor whose save takes time (like a real server round trip), and
// checks the source: no other file writes `system.wealth`, and each caller kept its own rule.
// Run: node dev/tools/sims/test-wealth.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = (process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url))).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');

// ═══ 1. The real helper ═══
const lib = `${ROOT}/scripts/utils/wealth.js`;
ok(existsSync(lib), 'scripts/utils/wealth.js exists');
if (existsSync(lib)) {
  globalThis.foundry = { utils: { deepClone: (o) => structuredClone(o) } };
  const { adjustWealth, applyWealthChange, ledgerLine, wealthKey } = await import(pathToFileURL(lib).href);

  /** an actor whose update applies after a delay, like a server round trip */
  const makeActor = (wealth, { delay = 15, refuse = false } = {}) => {
    const a = { id: 'a1', saves: 0, system: { wealth: structuredClone(wealth) } };
    a.update = (patch) => new Promise((res, rej) => setTimeout(() => {
      if (refuse) return rej(new Error('User lacks permission to update Actor'));
      a.saves++; a.system.wealth = structuredClone(patch['system.wealth']); res(a);
    }, delay));
    return a;
  };

  // two credits started at the same moment: both land
  {
    const a = makeActor({ value: 1000, transactions: [] });
    await Promise.all([adjustWealth(a, 50, 'claim'), adjustWealth(a, 200, 'refund')]);
    ok(a.system.wealth.value === 1250, `two changes at once both count (1000 + 50 + 200 = ${a.system.wealth.value})`);
    ok(a.system.wealth.transactions.length === 2, 'both ledger lines are kept');
    ok(a.system.wealth.transactions[0][0] === 'Increased by 50 to 1050' && a.system.wealth.transactions[1][0] === 'Increased by 200 to 1250', 'each ledger line shows the balance it left');
  }
  // a credit and a debit at once
  {
    const a = makeActor({ value: 100, transactions: [['old', 'kept']] });
    const [r1, r2] = await Promise.all([adjustWealth(a, -30, 'sent'), adjustWealth(a, 500, 'siphon')]);
    ok(a.system.wealth.value === 570 && r1.after === 70 && r2.before === 70, 'a debit and a credit at once: 100 − 30 + 500 = 570, the second starts where the first ended');
    ok(a.system.wealth.transactions[0][0] === 'old', 'earlier ledger lines are untouched');
  }
  // floor (the composer)
  {
    const a = makeActor({ value: 40, transactions: [] });
    const r = await adjustWealth(a, -100, 'sent', { floor: 0 });
    ok(a.system.wealth.value === 0 && r.after === 0, 'floor: 0 stops at zero (the composer rule)');
    ok(a.system.wealth.transactions[0][0] === 'Decreased by 100 to 0', 'the ledger line names the amount and the floored balance, as before');
    const b = makeActor({ value: 40, transactions: [] });
    await adjustWealth(b, -100, 'encoder');
    ok(b.system.wealth.value === -60, 'no floor: the balance goes where the arithmetic says (the Encoder rule, unchanged)');
  }
  // missing ledger / missing wealth
  {
    const a = makeActor({ value: 10 });
    await adjustWealth(a, 5, 'x');
    ok(a.system.wealth.value === 15 && a.system.wealth.transactions.length === 1, 'a wealth block with no ledger gets one (several writers used to throw here)');
    const b = makeActor(undefined); b.system = {};
    await adjustWealth(b, 7, 'x');
    ok(b.system.wealth.value === 7, 'no wealth block at all starts from 0');
    const c = makeActor({ value: '100', transactions: [] });
    await adjustWealth(c, 5, 'x');
    ok(c.system.wealth.value === 105, 'a value stored as text adds as a number (it used to concatenate to "1005")');
  }
  // failures reject like actor.update did, and the queue keeps going
  {
    const a = makeActor({ value: 10, transactions: [] }, { refuse: true });
    let threw = false; try { await adjustWealth(a, 5, 'x'); } catch { threw = true; }
    ok(threw, 'a refused save rejects, so callers\' existing catch blocks still run');
    a.update = (patch) => { a.system.wealth = patch['system.wealth']; return Promise.resolve(a); };
    await adjustWealth(a, 5, 'x');
    ok(a.system.wealth.value === 15, 'after a failure the next change still runs, from the unchanged balance');
    let threw2 = false; try { await adjustWealth(null, 5, 'x'); } catch { threw2 = true; }
    ok(threw2, 'no actor rejects');
  }
  // pure parts
  {
    const w = { value: 3, transactions: [] };
    const r = applyWealthChange(w, 2, 'r');
    ok(w.value === 3 && w.transactions.length === 0 && r.wealth.value === 5, 'applyWealthChange never mutates its input');
    ok(ledgerLine(-4, 6) === 'Decreased by 4 to 6' && ledgerLine(4, 6) === 'Increased by 4 to 6', 'ledger wording is CPR\'s');
    ok(wealthKey({ id: 'x' }) === 'wealth:x', 'queue key is per character');
  }
  // different characters do not wait on each other
  {
    const a = makeActor({ value: 0, transactions: [] }, { delay: 60 }); const b = makeActor({ value: 0, transactions: [] }, { delay: 5 }); b.id = 'b1';
    let bDoneFirst = false;
    await Promise.all([adjustWealth(a, 1, 'x'), adjustWealth(b, 1, 'x').then(() => { bDoneFirst = a.saves === 0; })]);
    ok(bDoneFirst, 'two different characters are not queued behind each other');
  }
}

// ═══ 2. Source: one writer, callers keep their rules ═══
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; };
const writers = walk(`${ROOT}/scripts`).map((p) => p.split(path.sep).join('/'))
  .filter((p) => !p.endsWith('/scripts/utils/wealth.js'))
  .filter((p) => /['"]system\.wealth['"]|wealth\.transactions\.push/.test(readFileSync(p, 'utf8')));
ok(writers.length === 0, `no file but utils/wealth.js writes system.wealth (still writing: ${writers.map((p) => p.replace(ROOT + '/', '')).join(', ')})`);

const has = (f, re, what) => { const t = existsSync(`${ROOT}/${f}`) ? read(f) : ''; ok(re.test(t), `${f}: ${what}`); };
has('scripts/ui/MessageComposer/MessageComposerApp.js', /adjustWealth\(actor, -amount, `NCM: Sent \$\{amount\.toLocaleString\(\)\} eb via message`, \{ floor: 0 \}\)/, 'sending eddies still never goes below 0');
has('scripts/ui/MessageComposer/MessageComposerApp.js', /if \(!isGM && amount > currentWealth\)/, 'a player still cannot send more than they have');
has('scripts/ui/MessageViewer/MessageViewerApp.js', /if \(actor\.isOwner \|\| game\.user\.isGM\) \{\n\s*await adjustWealth\(actor, amount, `NCM: Received/, 'Claim still credits only an owned character (or as GM)');
has('scripts/services/DataShardService.js', /adjustWealth\(actor, -amount, `NCM: Claim of .* could not be recorded — reversed`\)/, 'an unrecorded shard claim is still reversed');
has('scripts/services/SchedulingService.js', /if \(!(?:actor\?\.system\?\.wealth|hasWealth\(actor\)) \|\| !\(actor\.isOwner \|\| isGM\(\)\)\) return failed\(\);/, 'a scheduled refund still checks the character before paying (utils/cpr.js hasWealth since step 10b)');
has('scripts/ui/ShardEncoder/ShardEncoderApp.js', /if \(!actor\) throw new Error\('No operator to pay for it\.'\);\n\s*await adjustWealth\(actor, -amount, reason\);/, 'the Encoder still throws with no operator, and pays with no floor');
for (const f of ['scripts/ui/content/SiphonFlow.js', 'scripts/ui/Terminal/TerminalViewerApp.js'])
  has(f, /if \(actor\.isOwner \|\| isGM\(\)\) await adjustWealth\(actor, amount, reason\);/, 'credits only an owned character (or as GM)');

console.log(`test-wealth: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
