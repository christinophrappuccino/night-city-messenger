// Sim: the pure rules behind calls (design dev/design/CALLS.md, build plan §11.2) — phone numbers (matching, vanity
// letters, home code, short numbers, the fiction-safe generator + area codes), the call state machine, who owns a
// number, whether a call may be placed, the allowed modes, and the signal-line flavour.
//   node dev/tools/sims/test-call-rules.mjs
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const M = await imp('scripts/utils/callModel.js');
const P = await imp('scripts/utils/callProfile.js');

// §1 and §2 moved: reading and generating numbers are tested in test-phone-numbering.mjs.

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
  const world = { 
    actors: [{ id: 'v', name: 'V', phone: '+72 NC WAT-7742', playerOwned: true, userIds: ['u1'] },
      { id: 'rache', name: 'Rache', phone: '+72 NC WAT-1860', playerOwned: true, userIds: ['u2'] },
      { id: 'tak', name: 'Takemura', phone: '+83 TKY ARA-0091', playerOwned: false }],
    contacts: [{ id: 'rogue', name: 'Rogue', phone: '+72 NC WAT-1907' },
      { id: 'nix', name: 'Nix', phone: '+72 NC WAT-1208', actorId: 'v' },
      { id: 'tt', name: 'Trauma Team', phone: 'TRAUMA' },
      { id: 'sys', name: 'System', phone: '+72 NC WAT-0001', sendOnly: true }] };
  const v = M.resolveCallee('+72 NC WAT-7742', world);
  ok(v.kind === 'player' && v.actorId === 'v' && v.userIds[0] === 'u1', 'a character’s number rings their player');
  ok(M.resolveCallee('+83 TKY ARA-0091', world).kind === 'npc', 'an NPC actor’s number is an NPC line (the GM answers)');
  const rogue = M.resolveCallee('WAT-1907', world);
  ok(rogue.kind === 'npc' && rogue.contactId === 'rogue', 'a directory contact’s number → NPC');
  const nix = M.resolveCallee('+72 NC WAT-1208', world);
  ok(nix.kind === 'player' && nix.contactId === 'nix' && nix.actorId === 'v' && nix.userIds[0] === 'u1', 'a player’s burner rings that player, as the burner');
  const t = M.resolveCallee('trauma', world); ok(t.special && t.name === 'Trauma Team' && t.normal === '#TRAUMA', 'a special number: no owner, the GM speaks for it');
  ok(M.canCall({ fromNumber: '+72 NC WAT-7742', callee: t }).toGm, 'and it rings the GM');
  ok(M.resolveCallee('+72 NC WAT-9999', world).kind === 'unowned' && M.resolveCallee('', world).kind === 'unowned', 'unowned');
  ok(M.canCall({ fromNumber: '+72 NC WAT-7742', callee: rogue }).ok && M.canCall({ fromNumber: '+72 NC WAT-7742', callee: rogue }).toGm, 'calling an NPC goes to the GM');
  ok(M.canCall({ enabled: false, fromNumber: 'x', callee: rogue }).reason.includes('off'), 'calls switched off');
  ok(M.canCall({ fromNumber: '', callee: rogue }).reason.includes('number'), 'no number of your own');
  ok(M.canCall({ fromNumber: '+72 NC WAT-7742', callee: v }).reason.includes('own'), 'calling yourself');
  ok(M.canCall({ fromNumber: '555 1', callee: rogue, noSignal: true }).outcome === 'no-signal', 'no signal');
  ok(M.canCall({ fromNumber: '555 1', callee: M.resolveCallee('+72 NC WAT-0001', world) }).outcome === 'not-in-service', 'a send-only line does not take calls');
  const un = M.resolveCallee('+72 NC WAT-9999', world);
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
  const a = P.callProfile({ name: 'Rogue', number: '+72 NC WAT-1907', net: { name: 'CitiNet', type: 'PUBLIC', strength: 78 } });
  const b = P.callProfile({ name: 'Rogue', number: '+72 NC WAT-1907', net: { name: 'CitiNet', type: 'PUBLIC', strength: 78 } });
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
