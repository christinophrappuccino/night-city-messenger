// Sim: the pure rules behind calls (design dev/design/CALLS.md, build plan §11.2) — phone numbers (matching, vanity
// letters, home code, short numbers, the fiction-safe generator + area codes), the call state machine, who owns a
// number, whether a call may be placed, the allowed modes, and the signal-line flavour.
//   node dev/tools/sims/test-call-rules.mjs
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const N = await imp('scripts/utils/phoneNumbers.js');
const M = await imp('scripts/utils/callModel.js');
const P = await imp('scripts/utils/callProfile.js');

// ═══ 1. Numbers: any format, matched normalised ═══
{
  ok(N.normaliseNumber('+1 (555) 0119-07') === '+1555011907', 'a +1 number keeps its country code');
  ok(N.sameNumber('(555) 0119-07', '+1 555 011907'), 'no country code → the home code (+1)');
  ok(!N.sameNumber('+81 555 011907', '555 0119 07'), 'a different country code is a different number');
  ok(N.sameNumber('555 0119 07', '+81 555 011907', '+81'), 'a Tokyo table: no code → +81');
  ok(N.normaliseNumber('1-800-ARASAKA') === '+18002727252', 'vanity letters → keypad digits; a long number already starting with the home code keeps it');
  ok(N.normaliseNumber('00 81 3 1234 5678') === '+81312345678', '00 is the international prefix');
  ok(N.isShortNumber('911') && N.isShortNumber('#77') && N.isShortNumber('TRAUMA') && !N.isShortNumber('+1 911'), 'short service numbers (never with a +)');
  ok(N.normaliseNumber('Trauma') === '#TRAUMA' && N.sameNumber('trauma', 'TRAUMA') && !N.sameNumber('911', '+1 911'), 'short numbers match exactly, never a full number');
  ok(N.normaliseNumber('') === '' && !N.sameNumber('', ''), 'an empty number matches nothing');
  ok(N.displayNumber('  +81 3-1234-5678 ') === '+81 3-1234-5678', 'shown as typed');
}

// ═══ 2. The generator: always a fiction-safe number ═══
{
  for (let seed = 1; seed < 60; seed++) {
    const out = N.generateNumbers({ country: '1', code: '415', count: 4, seed });
    ok(out.length === 4, `seed ${seed}: four numbers`);
    ok(out.every((o) => /^\+1 \(415\) 555-01\d\d$/.test(o.number)), `seed ${seed}: every +1 number is in 555-0100…0199`);
    ok(new Set(out.map((o) => o.number)).size === 4, `seed ${seed}: no duplicates`);
  }
  const a = N.generateNumbers({ country: '1', code: '415', seed: 7 }); const b = N.generateNumbers({ country: '1', code: '415', seed: 7 });
  ok(a.map((o) => o.number).join() === b.map((o) => o.number).join(), 'the same seed shows the same numbers');
  ok(a[0].kind === 'repeating' && a[1].kind === 'run' && a.every((o) => o.fiction), 'one repeating, one run first; flagged fiction');
  const taken = ['+1 (415) 555-0111', '+1 (415) 555-0122', '+1 (415) 555-0133', '+1 (415) 555-0144', '+1 (415) 555-0155', '+1 (415) 555-0166', '+1 (415) 555-0177', '+1 (415) 555-0188', '+1 (415) 555-0199', '+1 (415) 555-0100'];
  ok(N.generateNumbers({ country: '1', code: '415', taken, count: 12, seed: 3 }).every((o) => !taken.includes(o.number)), 'never a taken number');
  ok(N.generateNumbers({ country: '44', code: '20 7946 0', seed: 2 }).every((o) => /^\+44 20 7946 0\d{3}$/.test(o.number)), 'UK London: the Ofcom drama range 020 7946 0000–0999');
  ok(N.generateNumbers({ country: '44', code: '7700 900', seed: 2 }).every((o) => /^\+44 7700 900\d{3}$/.test(o.number)), 'UK mobile: 07700 900000–900999');
  const au = N.generateNumbers({ country: '61', code: '491 570', count: 8, seed: 5 });
  ok(au.length === 8 && au.every((o) => /^\+61 491 570 (006|156|157|158|159|110|313|737)$/.test(o.number)), 'Australia: only the reserved drama numbers');
  ok(N.generateNumbers({ country: '81', code: '3', seed: 1 }).every((o) => o.fiction === false), 'Japan has no official range → flagged');
  ok(N.kindLabel('run').includes('easy') && N.kindLabel('random') === 'random', 'kind words');
  ok(N.AREA_CODES['1'].regions['Night City'][0][0] === '555' && Object.keys(N.AREA_CODES['1'].regions)[0] === 'Night City', 'Night City (555) is the first US region');
  ok(Object.values(N.AREA_CODES).every((c) => c.label && Object.values(c.regions).every((list) => list.every(([code, label]) => code && label))), 'area-code table shape');
  const r = N.sanitizeRegion({ country: 'zz', region: 'nope', code: 'x' });
  ok(r.country === '1' && r.region === 'Night City' && r.code === '555', 'an unknown region → the default');
  ok(N.sanitizeRegion({ country: '1', region: 'California', code: '510' }).code === '510', 'a valid pick survives');
}

// ═══ 3. The state machine ═══
{
  const c0 = M.createCall({ from: { userId: 'u1', number: '+1 555 1' }, to: { kind: 'player', number: '+1 555 2' }, now: 1000 });
  ok(c0.state === 'ringing' && c0.outcome === null && c0.id.startsWith('call-'), 'a new call rings');
  const live = M.transition(c0, { type: 'answer', by: 'u2' }, 2000);
  ok(live.state === 'live' && live.answeredAt === 2000 && live.answeredBy === 'u2' && c0.state === 'ringing', 'answer → live (a new object)');
  ok(M.transition(c0, { type: 'decline' }).outcome === 'declined' && M.transition(c0, { type: 'timeout' }).outcome === 'missed', 'decline / timeout');
  ok(M.transition(c0, { type: 'busy' }).outcome === 'busy' && M.transition(c0, { type: 'cancel' }).outcome === 'missed', 'busy / caller hangs up first');
  const held = M.transition(live, { type: 'hold' }, 3000);
  ok(held.state === 'held' && M.transition(held, { type: 'resume' }).state === 'live', 'hold / resume');
  ok(M.transition(held, { type: 'hangup' }, 5000).outcome === 'answered' && M.transition(live, { type: 'drop' }).outcome === 'dropped', 'hang up a held call; a drop');
  const ended = M.transition(live, { type: 'hangup' }, 9000);
  ok(M.transition(ended, { type: 'answer' }) === ended && M.transition(live, { type: 'nope' }) === live, 'a late or unknown event changes nothing');
  ok(M.callSeconds(ended) === 7 && M.callSeconds(c0) === 0, 'seconds on the line');
  ok(M.formatDuration(252) === '4:12' && M.formatDuration(3723) === '1:02:03' && M.formatDuration(0) === '0:00', 'durations');
  ok(M.transition(live, { type: 'mode', mode: 'type' }).mode === 'type' && M.transition(live, { type: 'mode', mode: 'zz' }).mode === 'loud', 'mode switch (only known modes)');
  const dead = M.createEndedCall({ from: {}, to: {} }, 'no-signal', 50);
  ok(dead.state === 'ended' && dead.outcome === 'no-signal' && M.OUTCOMES['no-signal'] === 'No signal', 'a call that never rang');
}

// ═══ 4. Who owns a number; may it be called ═══
{
  const world = { homeCode: '+1',
    actors: [{ id: 'v', name: 'V', phone: '+1 (555) 0177-42', playerOwned: true, userIds: ['u1'] },
      { id: 'rache', name: 'Rache', phone: '555 0118-60', playerOwned: true, userIds: ['u2'] },
      { id: 'tak', name: 'Takemura', phone: '+81 3-5544-0091', playerOwned: false }],
    contacts: [{ id: 'rogue', name: 'Rogue', phone: '+1 (555) 0119-07' },
      { id: 'nix', name: 'Nix', phone: '+1 (555) 0612-08', actorId: 'v' },
      { id: 'tt', name: 'Trauma Team', phone: 'TRAUMA' },
      { id: 'sys', name: 'System', phone: '555 0000-01', sendOnly: true }] };
  const v = M.resolveCallee('555 0177 42', world);
  ok(v.kind === 'player' && v.actorId === 'v' && v.userIds[0] === 'u1', 'a character’s number rings their player');
  ok(M.resolveCallee('+81 3 5544 0091', world).kind === 'npc', 'an NPC actor’s number is an NPC line (the GM answers)');
  const rogue = M.resolveCallee('(555) 0119-07', world);
  ok(rogue.kind === 'npc' && rogue.contactId === 'rogue', 'a directory contact’s number → NPC');
  const nix = M.resolveCallee('555-0612-08', world);
  ok(nix.kind === 'player' && nix.contactId === 'nix' && nix.actorId === 'v' && nix.userIds[0] === 'u1', 'a player’s burner rings that player, as the burner');
  ok(M.resolveCallee('trauma', world).contactId === 'tt', 'a short service number');
  ok(M.resolveCallee('555 9999 99', world).kind === 'unowned' && M.resolveCallee('', world).kind === 'unowned', 'unowned');
  ok(M.canCall({ fromNumber: '+1 555 0177 42', callee: rogue }).ok && M.canCall({ fromNumber: '+1 555 0177 42', callee: rogue }).toGm, 'calling an NPC goes to the GM');
  ok(M.canCall({ enabled: false, fromNumber: 'x', callee: rogue }).reason.includes('off'), 'calls switched off');
  ok(M.canCall({ fromNumber: '', callee: rogue }).reason.includes('number'), 'no number of your own');
  ok(M.canCall({ fromNumber: '555 0177 42', callee: v }).reason.includes('own'), 'calling yourself');
  ok(M.canCall({ fromNumber: '555 1', callee: rogue, noSignal: true }).outcome === 'no-signal', 'no signal');
  ok(M.canCall({ fromNumber: '555 1', callee: M.resolveCallee('555 0000-01', world) }).outcome === 'not-in-service', 'a send-only line does not take calls');
  const un = M.resolveCallee('555 9999 99', world);
  ok(M.canCall({ fromNumber: '555 1', callee: un }).outcome === 'not-in-service' && M.canCall({ fromNumber: '555 1', callee: un, unknownNumbers: 'gm' }).toGm, 'unowned: not in service, or ring the GM');
}

// ═══ 5. Modes ═══
{
  ok(M.allowedModes(['loud', 'type', 'dictate'], { dictate: false }).join() === 'loud,type', 'Dictate drops where the browser can’t');
  ok(M.allowedModes(['dictate'], {}).join() === 'loud', 'never empty');
  ok(M.allowedModes(['type', 'loud'], {}).join() === 'loud,type', 'the chip order stays fixed');
  ok(M.defaultMode('type', ['loud', 'type']) === 'type' && M.defaultMode('dictate', ['loud']) === 'loud', 'the default mode, if allowed');
  ok(M.CALL_MODES.every((m) => M.MODE_INFO[m]?.label && M.MODE_INFO[m].tip), 'every mode has a label and a tooltip');
}

// ═══ 6. The signal line ═══
{
  const a = P.callProfile({ name: 'Rogue', number: '+1 (555) 0119-07', net: { name: 'CitiNet', type: 'PUBLIC', strength: 78 } });
  const b = P.callProfile({ name: 'Rogue', number: '+1 (555) 0119-07', net: { name: 'CitiNet', type: 'PUBLIC', strength: 78 } });
  ok(a.hex === b.hex && a.ch === b.ch, 'the same caller always reads the same');
  ok(P.callProfile({ name: 'X', net: { type: 'CORPORATE' } }).cipher === 'AES-512' && P.callProfile({ name: 'X', net: { type: 'UNDERGROUND' } }).cipher === 'ONION', 'network type → cipher');
  ok(a.q === 'strong' && a.lockRings === 2 && P.callProfile({ net: { strength: 20 } }).lockRings === 99, 'strength → how fast the code locks');
  ok(P.callProfile({ anon: true, number: '555' }).src === 'ID masked' && a.src === 'src 550-11907'.replace('550-11907', a.src.slice(4)), 'anonymous hides the source');
  const ring1 = P.signalLine(a, 'ring', 1, () => '?'); const ring3 = P.signalLine(a, 'ring', 3, () => '?');
  ok(ring1.parts[2].text.includes('?') && !ring3.parts[2].text.includes('?'), 'the code resolves ring by ring');
  ok(P.signalLine(P.callProfile({ net: { strength: 10 } }), 'ring', 9).warn && P.signalLine(a, 'live').lead === 'Signal locked' && P.signalLine(a, 'end').lead === 'Signal lost', 'weak / locked / lost');
}

console.log(`test-call-rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
