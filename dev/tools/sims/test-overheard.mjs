// Overheard calls: the rules, and the real service over a mocked world.
import { garbleLine, garbleFor, waysFor, cluesHeard, sanitizeScript, sanitizeEavesdrop, plainHeard } from '../../../scripts/utils/overheard.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };

/* ── garble ── */
const T = 'The shipment moved tonight at Pier four';
ok(garbleLine('l1', T, 0) === T, 'clear is clear');
const full = garbleLine('l1', T, 100);
ok(!/shipment|moved|Pier/.test(full), 'at full garble no real word is in the output');
const half = garbleLine('l1', T, 50), less = garbleLine('l1', T, 20);
const shown = (h) => plainHeard(h).split(/\s+/).filter((w) => T.split(' ').includes(w));
ok(shown(half).every((w) => shown(less).includes(w)), 'lowering the garble only ever reveals more');
ok(garbleLine('l1', T, 50) === half, 'the same line garbles the same way every time');
ok(garbleLine('x', '<script>', 0) === '&lt;script&gt;' && !garbleLine('x', '<b>a</b> c', 10).includes('<b>'), 'text is escaped');

/* ── best way wins ── */
const L = { ways: { tap: 0, room: 2 }, side: 'a', enhance: 0 };
ok(garbleFor(L, 'a', 3) === 0, 'in the room on their side: clean');
ok(garbleFor(L, 'b', 3) === 55, 'the other side, by the tap');
ok(garbleFor(L, 'a', 1) === 55, 'before they walked up, only the tap');
ok(garbleFor({ ways: { room: 0 }, side: 'a' }, 'b', 0) === null, 'in the room hears one side only');
ok(garbleFor({ ways: { tap: 5 } }, 'a', 3) === null, 'nothing before they joined');
ok(garbleFor({ ways: { tap: 0 } }, 'a', 0, { enc: true }) === 100, 'encrypted: noise without a descrambler');
ok(garbleFor({ ways: { tap: 0 } }, 'a', 0, { enc: true, hasDesc: true }) === 55, 'with one, as usual');
ok(garbleFor({ ways: { room: 0 }, side: 'a' }, 'a', 0, { enc: true }) === 0, 'the room still hears it');
ok(garbleFor({ ways: { tap: 0 }, enhance: 20 }, 'a', 0) === 35, 'Enhance clears more');
ok(garbleFor({ ways: { tap: 0 }, enhance: 90 }, 'a', 0, { enc: true }) === 100, 'Enhance cannot beat encryption');

/* ── ways in ── */
const rules = sanitizeEavesdrop({});
const c = { a: { name: 'Rogue' }, b: { name: 'Marcus' }, enc: false };
const base = { here: null, dist: Infinity, tap: null, jack: null, hasAmp: false, hasScanner: false, hasDesc: false };
ok(rules.range === 6 && rules.dv === 15 && rules.jackDv === 11, 'the defaults');
ok(waysFor(base, c, rules).ways.length === 0 && waysFor(base, c, rules).why.length > 0, 'no way in says why');
ok(waysFor({ ...base, here: 'a', dist: 5 }, c, rules).ways[0].k === 'room', 'close enough');
ok(waysFor({ ...base, here: 'a', dist: 6.4 }, c, rules).ways.length === 1 && waysFor({ ...base, here: 'a', dist: 7 }, c, rules).ways.length === 0, 'half a square of grace');
ok(waysFor({ ...base, here: 'a', dist: 12, hasAmp: true }, c, rules).ways.length === 1, 'a hearing item doubles it');
ok(waysFor({ ...base, here: 'a', dist: 99 }, c, { ...rules, room: 'scene' }).ways.length === 1, 'or the same scene');
ok(waysFor({ ...base, tap: { node: 'Relay' } }, c, rules).ways[0].k === 'tap', 'a tap');
ok(waysFor({ ...base, jack: { node: 'Relay' } }, c, rules).ways[0].k === 'jack', 'a node session');
ok(waysFor({ ...base, here: 'a', dist: 99, hasScanner: true }, c, rules).ways[0].k === 'scanner', 'a scanner on the scene');
ok(waysFor({ ...base, hasScanner: true }, c, rules).ways.length === 0, 'a scanner elsewhere hears nothing');
const enc = { ...c, enc: true };
ok(waysFor({ ...base, tap: { node: 'R' } }, enc, rules).ways.length === 0 && waysFor({ ...base, tap: { node: 'R' } }, enc, rules).why.some((w) => w.includes('descrambler')), 'encrypted says why');
ok(waysFor({ ...base, tap: { node: 'R' }, hasDesc: true }, enc, rules).ways.length === 1, 'a descrambler opens it');

/* ── clues ── */
const lines = sanitizeScript({ lines: [{ side: 'a', marks: ['clue'] }, { side: 'b', marks: ['clue'] }, { side: 'a' }] }).lines;
ok(cluesHeard({ ways: { tap: 0 } }, lines, 2).got === 2, 'all of them');
ok(cluesHeard({ ways: { room: 0 }, side: 'a' }, lines, 2).got === 1, 'one side only');
ok(cluesHeard({ ways: { tap: 1 } }, lines, 2).got === 1, 'from the line they joined on');
ok(cluesHeard({ ways: {} }, [{ marks: [] }], 0) === null, 'no clues, nothing to count');
ok(sanitizeScript({ lines: [{ marks: ['nope', 'lie'], delay: 99 }] }).lines[0].marks.join() === 'lie', 'an unknown mark is dropped');
ok(sanitizeScript(null).a.anchor === 'off', 'nothing stored is fine');

/* ── the real service ── */
{
  const store = { overheardCalls: {}, phoneEavesdrop: {}, callsEnabled: true, overheardEnabled: true };   // both on: a feature since step 15
  const flags = {};
  const tok = (actorId, x, hidden = false) => ({ actorId, x, y: 0, hidden });
  const scene = { id: 'sc', name: 'Pier 4', grid: { size: 100 }, tokens: [tok('npc', 0), tok('v', 500), tok('far', 5000), tok('sneak', 100, true)] };
  const mk = (id, items = []) => ({ id, name: id.toUpperCase(), items: { contents: items }, testUserPermission: (u) => u.id === 'u-' + id });
  const actors = { v: mk('v', [{ name: 'Voice Stress Analyzer', type: 'gear' }]), far: mk('far'), sneak: mk('sneak') };
  const sent = [];
  const users = [{ id: 'gm', isGM: true, active: true }, { id: 'u-v', isGM: false, active: true }, { id: 'u-far', isGM: false, active: true }, { id: 'u-sneak', isGM: false, active: true }];
  globalThis.game = {
    user: users[0], users: Object.assign(users.slice(), { activeGM: users[0], get: (id) => users.find((u) => u.id === id), filter: (f) => users.filter(f), find: (f) => users.find(f) }),
    actors: Object.assign(Object.values(actors), { get: (id) => actors[id], contents: Object.values(actors) }), scenes: { get: (id) => (id === 'sc' ? scene : null) }, journal: [],
    settings: { get: (_, k) => { if (k in store) return store[k]; throw new Error('no ' + k); }, set: async (_, k, v) => { store[k] = v; } },
    nightcity: { socketManager: { emit: (op, d) => sent.push(d) }, eventBus: { emit() {} }, timeService: { getCurrentTime: () => '2045-03-14T21:00:00.000Z' },
      masterContactService: { getContact: (id) => ({ c1: { id: 'c1', actorId: 'npc' }, c2: { id: 'c2', actorId: null } }[id] || null) },
      networkService: { getNodes: () => [{ id: 'n1', name: 'Relay', sceneId: 'sc', state: 'on', taps: [{ actorId: 'far', until: 0 }], runs: [] }], _nowMs: () => Date.now() },
      messageRepository: { createMessage: async (id, m) => { flags.saved = m; return { success: true }; } }, traceService: { fireTrace: (o) => { flags.trace = o; } }, overheardHud: { receive: () => {} } },
  };
  globalThis.Hooks = { on() {}, off() {} };
  globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 12) } };
  // getPlayerCharacters reads users + actors
  for (const a of Object.values(actors)) a.hasPlayerOwner = true;
  users[1].character = actors.v; users[2].character = actors.far; users[3].character = actors.sneak;
  const { OverheardService } = await import('../../../scripts/services/OverheardService.js');
  const s = new OverheardService();
  const script = sanitizeScript({ id: 's1', name: 'The shipment', net: 'cn', a: { contactId: 'c1', name: 'Rogue', sceneId: 'sc', anchor: 'token' }, b: { contactId: 'c2', name: 'Marcus', shows: 'anon' }, rec: false,
    lines: [{ id: 'l0', side: 'a', text: 'The shipment moved.', marks: ['clue'] }, { id: 'l1', side: 'b', text: 'Who else knows about this?' }, { id: 'l2', side: 'a', text: 'Nobody at all.', marks: ['lie'] }] });
  await s.saveScript(script);
  ok(s.scripts().length === 1, 'a call is saved');
  const f = s.factsFor(actors.v, script);
  ok(f.here === 'a' && f.dist === 5, 'distance from their token, in squares');
  ok(s.factsFor(actors.far, script).tap?.node === 'Relay', 'a tap on a node of that network, on their scene');
  ok(s.factsFor(actors.sneak, script).here === null, 'a hidden token does not count for a player');
  const run = s.start({ ...script, live: true });
  const prompts = sent.filter((x) => x.op === 'prompt');
  ok(prompts.some((p) => p.userIds[0] === 'u-v' && p.way === 'room'), 'someone in range is asked');
  ok(prompts.some((p) => p.userIds[0] === 'u-far' && p.way === 'tap'), 'a tap asks too');
  ok(!run.listeners.size, 'nobody listens by themselves');
  const n = prompts.length; s._offer(run); ok(sent.filter((x) => x.op === 'prompt').length === n, 'it asks once per call');
  run.script.lines = script.lines; run.idx = -1;
  await s.handleSocket({ op: 'join', runId: run.id, way: 'room', actorId: 'v' }, 'u-v');
  ok(run.listeners.has('u-v') && run.listeners.get('u-v').side === 'a', 'they join by choosing to');
  await s.handleSocket({ op: 'join', runId: run.id, way: 'tap', actorId: 'v' }, 'u-v');
  ok(run.listeners.get('u-v').ways.tap === undefined, 'a way they do not have is refused');
  await s.handleSocket({ op: 'join', runId: run.id, way: 'tap', actorId: 'far' }, 'u-v');
  ok(!run.listeners.has('u-far'), 'and nobody joins as someone else');
  await s.handleSocket({ op: 'join', runId: run.id, way: 'tap', actorId: 'far' }, 'u-far');
  sent.length = 0;
  s.next(run.id); s.next(run.id); s.next(run.id);
  const toV = sent.filter((x) => x.op === 'line' && x.userIds[0] === 'u-v'), toFar = sent.filter((x) => x.op === 'line' && x.userIds[0] === 'u-far');
  ok(toV[0].line.html === 'The shipment moved.', 'in the room, clean');
  ok(toV[1].line.html === null, "the other side can't be heard");
  ok(!JSON.stringify(toV[1]).includes('Who else knows'), 'and its words never leave the GM');
  ok(toV[2].line.stress, 'a lie shows on a voice stress analyzer');
  ok(toV[1].line.who === 'Other side' && toFar[1].line.who === 'Side B', 'a withheld side has no name');
  ok(!toFar[0].line.stress && !JSON.stringify(toFar).includes('"means"') && !JSON.stringify(toFar).includes('"marks"'), 'marks stay with the GM');
  const before = toFar[0].line.html;
  sent.length = 0;
  await s.handleSocket({ op: 'enhance', runId: run.id, amount: 55 }, 'u-far');
  const again = sent.filter((x) => x.op === 'line')[0];
  ok(again.again && again.line.html === 'The shipment moved.' && before !== again.line.html, 'Enhance sends what they heard again, clearer');
  await s.handleSocket({ op: 'save', runId: run.id }, 'u-v');
  ok(flags.saved?.contentType === 'avlog' && flags.saved.metadata.recovered && flags.saved.contentData.transcript.some((l) => l.text.includes("can't hear")), 'Save goes to EXFIL, as heard');
  s.cut(run.id, 'u-far', { trace: true });
  ok(!run.listeners.has('u-far') && flags.trace?.action === 'overheard', 'a cut with a trace');
  sent.length = 0; s.click(run.id); ok(sent.some((x) => x.op === 'click' && x.userIds[0] === 'u-v'), 'a click on the line');
  sent.length = 0; s.say(run.id, 'b', 'Live words'); ok(run.script.lines.at(-1).text === 'Live words' && sent.some((x) => x.op === 'line'), 'typed live');
  sent.length = 0; await s.end(run.id); ok(run.ended && sent.some((x) => x.op === 'ended'), 'the end reaches listeners');
  await s.handleSocket({ op: 'join', runId: run.id, way: 'room', actorId: 'v' }, 'u-v'); ok(sent.some((x) => x.op === 'none'), 'an ended call takes nobody');
  // scheduled
  await s.saveScript({ ...script, id: 's2', at: '2045-03-14T20:00:00.000Z', live: true });
  s.tick();
  ok([...s.runs.values()].some((r) => r.script.id === 's2'), 'a scheduled call starts on the game clock');
  for (const r of s.runs.values()) clearTimeout(r.timer);
}

console.log(`test-overheard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
