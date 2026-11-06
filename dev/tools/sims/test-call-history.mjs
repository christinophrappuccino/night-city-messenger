// test-call-history — calls the GM writes by hand, and Select on Admin → Phone's Call log / Voicemail
// (tester round 2026-11-06: "a mass select, delete, etc", "allow a creation of call logs", then "creating the logs
// from scratch … who and what, and transcript if there is one").
//   1. the pure rules (utils/callHistory.js): a call with From and To, the page each end gets (withheld masked for the
//      person called), the voicemail and whose box it lands in, a pasted script, CSV out and back in (both layouts)
//   2. the REAL CallService on the shared mock world: one call written to both ends with one id, read back by the
//      editor, the Agent's log and voicemail, Admin → Call log (once); rewrite; delete (both ends); copies; voicemails
//      in a batch; migration v9 from the old setting
//   3. wiring: the editor, Select on both lists, the migration entry
// Run: node dev/tools/sims/test-call-history.mjs
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { createMockWorld } from './lib/world.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const M = 'night-city-messenger';
const quietInfo = console.info; console.info = () => {};

const H = await imp('scripts/utils/callHistory.js');
const { parseCsv } = await imp('scripts/utils/csv.js');

// ═══ 1. the rules ═══
const V = { actorId: 'v', name: 'V', number: 'WAT-0101' }, ROGUE = { contactId: 'rogue', name: 'Rogue', number: 'WAT-0150' }, JUDY = { actorId: 'judy', name: 'Judy', number: 'WAT-0200' };
const talk = H.sanitizeCall({ id: 'c1', from: ROGUE, to: V, out: 'Answered', when: '2045-03-10T21:40:00.000Z', len: '3:10', ty: 'burner',
  lines: [{ side: 'caller', text: 'Job tonight. Afterlife, ten.' }, { side: 'callee', text: "Who's paying?" }, { side: 'caller', text: '' }],
  net: { id: 'citinet', name: 'CitiNet' }, scene: 'Afterlife', heardBy: 'NCPD tap, Netwatch' });
ok(talk.lines.length === 2 && talk.net.name === 'CitiNet' && talk.scene === 'Afterlife' && talk.heardBy.join() === 'NCPD tap,Netwatch' && talk.len === '3:10', 'a call keeps its transcript (empty lines dropped), network, place, heard-by and length');
ok(H.sanitizeCall({ out: 'Missed', lines: [{ text: 'x' }], why: 'y', vm: 'z' }).lines.length === 0, 'a missed call has no transcript, no drop reason, no voicemail');
ok(H.sanitizeCall({ out: 'Dropped', why: 'Signal lost', lines: [{ text: 'Hel' }] }).why === 'Signal lost', 'a dropped call keeps why, and what was said before it dropped');
const v1 = H.sanitizeCall({ id: 'o1', dir: 'in', who: 'Padre', n: 'HEY-0001', out: 'Answered', when: '2045-01-01T00:00:00Z' }, { owner: V });
ok(v1.from.name === 'Padre' && v1.to.actorId === 'v', 'a first-version entry (dir / who) reads as a call against its owner');
ok(/One end/.test(H.callProblem(H.sanitizeCall({ from: { name: 'A' }, to: { name: 'B' }, when: '2045-01-01T00:00:00Z' }))), 'one end must be a person');
ok(/same person/.test(H.callProblem(H.sanitizeCall({ from: V, to: V, when: '2045-01-01T00:00:00Z' }))), 'From and To cannot be the same person');
ok(/left for someone/.test(H.callProblem(H.sanitizeCall({ from: V, to: { name: 'X' }, out: 'Voicemail', vm: 'hi', when: '2045-01-01T00:00:00Z' }))), 'a voicemail needs a person in To');
ok(H.callOwners(talk).join() === 'rogue,v', 'it goes into both ends\' logs');
const pFrom = H.callToLog(talk, 'from'), pTo = H.callToLog(talk, 'to');
ok(pFrom.callId === 'w:c1' && pTo.callId === 'w:c1' && pFrom.direction === 'out' && pTo.direction === 'in' && pTo.lines.length === 2 && pTo.mode === 'type' && pTo.net.name === 'CitiNet' && pTo.heardBy[0].name === 'NCPD tap', 'both pages: one call id, their direction, the transcript, network and heard-by');
const anon = H.sanitizeCall({ ...talk, anon: true });
const aTo = H.callToLog(anon, 'to'), aFrom = H.callToLog(anon, 'from');
ok(aTo.anonCall && aTo.other.name === 'Unknown caller' && !aTo.other.number && aTo.from.name === 'Unknown caller', 'withheld: the person called sees Unknown caller, no number');
ok(!aFrom.anonCall && aFrom.from.name === 'Rogue', '…the caller\'s own page is not masked');
ok(H.callToLog(H.sanitizeCall({ ...talk, out: 'Declined' }), 'to').outcome === 'missed', 'a declined call reads as missed for the person called, like a real call');
const vmc = H.sanitizeCall({ id: 'c2', from: ROGUE, to: V, out: 'Voicemail', when: '2045-03-10T22:00:00.000Z', vm: 'Pick up.', kind: 'tts' });
const vm = H.callToVoicemail(vmc, { voice: 'Gravel' });
ok(vm.vmId === 'vm-w-c2' && vm.callId === 'w:c2' && vm.written && !vm.heard && vm.voice === 'Gravel' && H.voicemailBoxOf(vmc) === 'v', 'a voicemail: in To\'s box, unheard, read out in the line voice');
ok(H.callToVoicemail(H.sanitizeCall({ ...vmc, anon: true })).from.name === 'Unknown caller', 'a withheld voicemail does not name the caller');
const cp = H.copyCallTo(vmc, JUDY, 'c3');
ok(cp.id === 'c3' && cp.to.actorId === 'judy' && cp.from.contactId === 'rogue' && cp.vm === 'Pick up.', 'a copy to someone else swaps To');
const sc = H.parseScript("Rogue: Job tonight.\nV: Who's paying?\nThe client.\ncaller: Ten sharp.\nBob: hm", { fromName: 'Rogue', toName: 'V' });
ok(sc.map((l) => l.side).join() === 'caller,callee,caller,caller,callee' && sc[0].text === 'Job tonight.' && sc[2].text === 'The client.' && sc[4].text === 'Bob: hm', 'a pasted script: names pick the side, a line with no name (or an unknown one) takes the other side');
// CSV out and back
const rows = H.historyCsvRows([talk, vmc]);
const csv = rows.map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(',')).join('\n');
let n = 0;
const people = [{ id: 'v', name: 'V', actor: true, number: 'WAT-0101' }, { id: 'rogue', name: 'Rogue', actor: false, number: 'WAT-0150' }];
const back = H.historyFromTable(parseCsv(csv), { people, types: ['std', 'burner'], nets: [{ id: 'citinet', name: 'CitiNet' }], newId: () => 'n' + (++n) });
ok(back.calls.length === 2 && !back.problems.length, 'calls exported as CSV read back whole');
const b0 = back.calls[0];
ok(b0.from.contactId === 'rogue' && b0.to.actorId === 'v' && b0.lines.length === 2 && b0.lines[1].side === 'callee' && b0.net.id === 'citinet' && b0.scene === 'Afterlife' && b0.ty === 'burner' && b0.heardBy.length === 2, '…both ends, the transcript (multi-line cell), network, place, line type and heard-by survive');
ok(back.calls[1].kind === 'tts' && back.calls[1].vm === 'Pick up.' && !back.calls[1].heard, '…and the voicemail');
ok(back.calls.every((x) => x.id.startsWith('n')), 'imported calls get new ids');
const old = H.historyFromTable(parseCsv('Direction,Who,Number,Outcome,When\nout,Judy,WAT-0200,Answered,2045-01-01T00:00:00Z'), { owner: V, people: [{ id: 'judy', name: 'Judy', actor: true }] });
ok(old.calls.length === 1 && old.calls[0].from.actorId === 'v' && old.calls[0].to.actorId === 'judy', 'a file in the first layout is read against the log it is imported into');
ok(/one person's log/.test(H.historyFromTable(parseCsv('Direction,Who,Outcome,When\nin,X,Answered,2045-01-01T00:00:00Z')).problems[0]), '…and asks for one when there is none');
const bad = H.historyFromTable(parseCsv('From,To,Outcome,When\nRogue,V,Shouted,2045-01-01T00:00:00Z\nRogue,V,Answered,yesterday\nNobody,Nobody else,Answered,2045-01-01T00:00:00Z\nRogue,V,Missed,2045-01-02T00:00:00Z'), { people });
ok(bad.calls.length === 1 && bad.problems.length === 3 && bad.problems.some((p) => /Outcome/.test(p)) && bad.problems.some((p) => /When/.test(p)) && bad.problems.some((p) => /One end/.test(p)), 'bad rows are named and skipped, the good one is kept');

// ═══ 1b. the Call history list: search, Show, Group, dates, folds ═══
{
  const mk = (id, o) => H.sanitizeCall({ id, when: '2045-03-10T10:00:00.000Z', ...o });
  const list = [
    { ...mk('a', { from: ROGUE, to: V, out: 'Answered', lines: [{ side: 'caller', text: 'The Afterlife at ten' }], when: '2045-03-12T09:00:00.000Z' }), real: true },
    mk('b', { from: V, to: JUDY, out: 'Missed', when: '2045-03-12T08:00:00.000Z' }),
    mk('c', { from: ROGUE, to: V, out: 'Voicemail', vm: 'Pick up.', when: '2045-03-01T08:00:00.000Z' }),
    mk('d', { from: { name: 'Padre', number: 'HEY-1' }, to: V, out: 'Declined', when: '2044-12-01T08:00:00.000Z' }),
  ];
  const L = (o) => H.historyList(list, { me: V, now: '2045-03-12T12:00:00.000Z', ...o });
  const all = L({});
  ok(all.of === 4 && all.total === 4 && !all.forced && all.counts.play === 1 && all.counts.yours === 3 && all.counts.in === 3 && all.counts.out === 1 && all.counts.vm === 1 && all.counts.missed === 2 && all.counts.said === 1, 'counts for every Show option');
  ok(all.groups.map((g) => g.label).join('|') === 'Today|March|December 2044' && !all.groups[0].shut && all.groups[1].shut, 'by date: Today, the month, an older year; the first open, the rest folded');
  ok(L({ q: 'afterlife' }).total === 1 && L({ q: 'pick up' }).total === 1 && L({ q: 'hey-1' }).total === 1 && L({ q: 'judy' }).total === 1, 'search: transcript, voicemail words, numbers, names');
  ok(L({ q: 'judy' }).forced && !L({ q: 'judy' }).groups.some((g) => g.shut), 'a search opens every group');
  ok(L({ show: 'out' }).total === 1 && L({ show: 'play' }).total === 1 && L({ show: 'vm' }).total === 1 && L({ show: 'said' }).total === 1, 'Show narrows');
  ok(L({ from: '2045-03-01', to: '2045-03-05' }).total === 1, 'dates narrow (inclusive)');
  const byP = L({ group: 'person' });
  ok(byP.groups.map((g) => `${g.label}:${g.total}`).join() === 'Rogue:2,Judy:1,Padre:1', 'by person: grouped by the other end, busiest first');
  const flat = L({ group: 'none' });
  ok(flat.groups.length === 1 && flat.groups[0].flat && flat.groups[0].days[0].rows.map((x) => x.c.id).join() === 'a,b,c,d', 'no groups: one flat list, newest first');
  ok(L({ shut: new Set(['lg:today']) }).groups[0].shut && L({ open: new Set(['lg:m:2045-03']) }).groups[1].shut === false, 'the GM\'s own folds win');
}

// ═══ 2. the real service ═══
const world = await createMockWorld({
  users: [{ id: 'gm1', name: 'GM', isGM: true }, { id: 'p1', name: 'Kiri' }],
  actors: [{ id: 'v', name: 'V', type: 'character', owners: ['p1'] }, { id: 'judy', name: 'Judy', type: 'character', owners: ['p1'] }],
  journals: [
    { id: 'jv', name: 'V — Inbox', flags: { [M]: { type: 'inbox', actorId: 'v' } } },
    { id: 'jj', name: 'Judy — Inbox', flags: { [M]: { type: 'inbox', actorId: 'judy' } } },
    { id: 'jr', name: 'Rogue — Mail', flags: { [M]: { type: 'contactInbox', contactId: 'rogue' } } },
  ],
  settings: { phoneWrittenLogs: { v: [{ id: 'old1', dir: 'in', who: 'Padre', n: 'HEY-0001', out: 'Voicemail', when: '2045-01-05T09:00:00.000Z', len: '0:20', vm: 'Old message', ty: 'std' }] } },
  realSettings: true,
});
const owners = { jv: 'v', jj: 'judy', jr: 'rogue' };
class Repo { static identifyInbox(j) { const o = owners[j.id]; return o ? { ownerId: o, isContact: o === 'rogue' } : null; } }
const repo = Object.assign(new Repo(), { getInboxJournal: async (id) => game.journal.get(Object.keys(owners).find((k) => owners[k] === id)) || null });
globalThis.game.nightcity = { messageRepository: repo, masterContactService: { getContact: (id) => (id === 'rogue' ? { id, name: 'Rogue' } : null), getAll: () => [] } };
globalThis.foundry.utils.randomID ??= () => Math.random().toString(36).slice(2, 12);
const { CallService } = await imp('scripts/services/CallService.js');
const svc = new CallService();
svc.eventBus = { emit() {}, on() {}, off() {} };
const pages = (jid, k) => game.journal.get(jid).pages.contents.filter((p) => p.flags?.[M]?.[k]);
const logIds = (jid) => pages(jid, 'callLog').map((p) => p.flags[M].callLog.callId);

ok(svc.historyEntries('v').length === 1 && svc.historyEntries('v')[0].legacy, 'before migration: the old setting entry still shows');
let r = await svc.writeCalls([talk, vmc]);
ok(r.ok && r.ids.join() === 'c1,c2', 'writeCalls writes');
ok(logIds('jv').filter((x) => x === 'w:c1').length === 1 && logIds('jr').filter((x) => x === 'w:c1').length === 1, 'one call, a page in each end\'s inbox, the same id');
ok(pages('jv', 'voicemail').length === 1 && !pages('jr', 'voicemail').length, 'the voicemail is only in the box of the person it was left for');
const vEd = svc.historyEntries('v'), rEd = svc.historyEntries('rogue');
ok(vEd.some((c) => c.id === 'c1' && c.lines.length === 2) && rEd.some((c) => c.id === 'c1'), 'the editor reads the call back from either end\'s log, transcript included');
const vLog = await svc.getLog('v');
const c1 = vLog.find((l) => l.callId === 'w:c1');
ok(c1 && c1.direction === 'in' && c1.lines.length === 2 && c1.net.name === 'CitiNet' && c1.scene === 'Afterlife', 'V\'s Agent log: incoming, with the transcript, network and place');
ok((await svc.getVoicemails('v')).some((x) => x.callId === 'w:c2' && !x.heard), 'V\'s Voicemail list has the voicemail, unheard');
ok(svc.allLogs().filter((l) => l.callId === 'w:c1').length === 1, 'Admin → Call log shows the call ONCE');

// an NPC-to-NPC-less call: only one person on it
await svc.writeCalls([H.sanitizeCall({ id: 'c4', from: { name: 'Some fixer', number: '555-0100' }, to: JUDY, out: 'Missed', when: '2045-03-11T09:00:00.000Z' })]);
ok(logIds('jj').includes('w:c4'), 'a call from someone written in lands only in the person\'s log');

// rewrite
r = await svc.rewriteHistory({ ...talk, lines: [{ side: 'caller', text: 'Changed.' }], len: '0:30' });
ok(r.ok && logIds('jv').filter((x) => x === 'w:c1').length === 1 && logIds('jr').filter((x) => x === 'w:c1').length === 1 && pages('jv', 'callLog').find((p) => p.flags[M].callLog.callId === 'w:c1').flags[M].callLog.lines[0].text === 'Changed.', 'rewrite replaces both ends\' pages, keeping the id');

// copies
await svc.writeCalls([H.copyCallTo(vmc, JUDY, 'c5')]);
ok(pages('jj', 'voicemail').some((p) => p.flags[M].voicemail.callId === 'w:c5') && logIds('jr').includes('w:c5'), 'a copy to Judy: her voicemail, and a line in Rogue\'s log');

// delete
r = await svc.deleteCalls(['w:c1']);
ok(!logIds('jv').includes('w:c1') && !logIds('jr').includes('w:c1'), 'deleting a call removes it from both ends');
r = await svc.deleteCalls(['w:c2']);
ok(!pages('jv', 'voicemail').some((p) => p.flags[M].voicemail.callId === 'w:c2'), '…and a written voicemail goes with its call');
await game.journal.get('jv').createEmbeddedDocuments('JournalEntryPage', [{ name: 'c', flags: { [M]: { callLog: { callId: 'real1', direction: 'in', gameTime: '2045-03-12T00:00:00Z' } } } }, { name: 'vmr', flags: { [M]: { voicemail: { vmId: 'vmr1', callId: 'real1', text: 'hi' } } } }]);
await game.journal.get('jj').createEmbeddedDocuments('JournalEntryPage', [{ name: 'c', flags: { [M]: { callLog: { callId: 'real1', direction: 'out', gameTime: '2045-03-12T00:00:00Z' } } } }]);
r = await svc.deleteCalls(['real1', 'w:old1']);
ok(!logIds('jv').includes('real1') && !logIds('jj').includes('real1'), 'Admin → Call log delete: a real call goes from both sides');
ok(pages('jv', 'voicemail').some((p) => p.flags[M].voicemail.vmId === 'vmr1'), '…a voicemail left during a REAL call stays (it is deleted from Voicemail)');
ok(!(game.settings.get(M, 'phoneWrittenLogs').v || []).length, '…and an old setting entry is removed from the setting');

// voicemails in a batch
const jvm = pages('jj', 'voicemail')[0].flags[M].voicemail.vmId;
r = await svc.voicemailsBatch([{ ownerId: 'v', vmId: 'vmr1' }, { ownerId: 'judy', vmId: jvm }], 'heard');
ok(r.count === 2 && pages('jv', 'voicemail')[0].flags[M].voicemail.heard === true && pages('jj', 'voicemail')[0].flags[M].voicemail.heard === true, 'Mark heard across two mailboxes');
r = await svc.voicemailsBatch([{ ownerId: 'v', vmId: 'vmr1' }], 'new');
ok(pages('jv', 'voicemail')[0].flags[M].voicemail.heard === false, 'Mark new');
r = await svc.voicemailsBatch([{ ownerId: 'v', vmId: 'vmr1' }, { ownerId: 'judy', vmId: jvm }], 'delete');
ok(r.count === 2 && !pages('jv', 'voicemail').length && !pages('jj', 'voicemail').length, 'Delete across two mailboxes');

// migration v9
await game.settings.set(M, 'phoneWrittenLogs', { judy: [{ id: 'm1', dir: 'in', who: 'Padre', out: 'Voicemail', when: '2045-01-01T00:00:00.000Z', vm: 'Old' }, { id: 'm2', dir: 'out', who: 'Vik', out: 'Answered', when: '2045-01-02T00:00:00.000Z', len: '1:00' }], ghost: [{ id: 'g1', out: 'Missed', when: '2045-01-01T00:00:00.000Z' }] });
let mig = await svc.migrateWrittenLogs();
ok(mig.moved === 2 && mig.kept === 1, 'migration: an owner with an inbox moves, one without is kept');
ok(logIds('jj').includes('w:m1') && logIds('jj').includes('w:m2') && !pages('jj', 'voicemail').length, '…as log pages; an old voicemail stays a log line (no surprise Voicemail)');
const left = game.settings.get(M, 'phoneWrittenLogs');
ok(!left.judy && left.ghost?.length === 1, '…the moved owner leaves the setting, the other stays');
const count = logIds('jj').length;
mig = await svc.migrateWrittenLogs();
ok(logIds('jj').length === count, 'migration run twice writes nothing twice');
ok(svc.historyEntries('judy').find((c) => c.id === 'm2')?.to.name === 'Vik', 'a migrated entry opens in the editor as a call');

// the editor's list: real calls too, read-only, with their voicemail words
await game.journal.get('jj').createEmbeddedDocuments('JournalEntryPage', [{ name: 'c', flags: { [M]: { callLog: { callId: 'real9', direction: 'in', outcome: 'voicemail', seconds: 75, gameTime: '2045-03-13T00:00:00.000Z', from: ROGUE, to: JUDY, net: { name: 'CitiNet' } } } } },
  { name: 'v', flags: { [M]: { voicemail: { vmId: 'vm9', callId: 'real9', text: 'Call me.', heard: false } } } }]);
const r9 = svc.historyEntries('judy', { real: true }).find((c) => c.real);
ok(r9 && r9.callId === 'real9' && r9.out === 'Voicemail' && r9.vm === 'Call me.' && r9.len === '1:15' && r9.from.name === 'Rogue' && r9.net.name === 'CitiNet', 'Call history lists a real call too, read-only, with its voicemail words');
ok(!svc.historyEntries('judy').some((c) => c.real), '…only when asked (the written list stays written)');

// a player cannot write
await world.as('p1', async () => ok((await svc.writeCalls([talk])).ok === false && (await svc.deleteCalls(['w:c4'])).ok === false, 'a player is refused'));

// ═══ 3. wiring ═══
const view = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js'), tab = read('scripts/ui/AdminPanel/tabs/PhoneTab.js'), hbs = read('templates/admin-panel/tab-phone.hbs'), mr = read('scripts/core/MigrationRunner.js');
ok(/if \(t\.kind === 'owner'\) return SVC\.historyEntries\(t\.id, \{ real: true \}\)/.test(view) && !/saveWrittenLog|blankEntry|formEntry/.test(view), 'the editor reads and writes pages as calls, never the old setting');
ok(/data-do="lgWho"/.test(view) && /lgWho: async/.test(view) && !/data-ch="lgEnd"/.test(view) && /lgCopy: /.test(view) && /lgDelReal: async/.test(view) && /<h2>Call history<\/h2>/.test(view)
  && (hbs.match(/> Call history<\/button>/g) || []).length === 2 && /data-op="logEdit" data-out="Voicemail"/.test(hbs), 'From / To are pickers; real calls can be copied or deleted; Call history on Calls and Voicemail');
ok(/endFields\('f', 'From'/.test(view) && /endFields\('t', 'To'/.test(view) && /data-do="lgSwap"/.test(view), 'the form has From, To and Swap');
ok(['lgLineAdd', 'lgLineDel', 'lgLineSide', 'lgScriptToggle', 'lgScriptUse', 'lgSwap', 'lgCsvIn', 'lgPlanYes', 'lgAudio', 'lgAlso'].every((k) => new RegExp(`\\b${k}: `).test(view)), 'transcript lines, paste a script, swap, import, recording, copies');
ok(/lgLine: \(el\) =>/.test(view) && /lgScript: \(el\) =>/.test(view) && /lgEnd: \(el\) =>/.test(view) && /lgNet: \(el\) =>/.test(view) && /lgFlag: \(el\) =>/.test(view), 'typing a line, the script box, the ends, network and the ticks are handled');
ok(/id="lg-anon"/.test(view) && /id="lg-why"/.test(view) && /id="lg-heardby"/.test(view) && /id="lg-net"/.test(view) && /id="lg-scene"/.test(view), 'details: withheld, why it dropped, heard by, network, where');
ok(/e\.target\.id === 'lgfile'/.test(view) && /historyFromTable\(parseCsv\(text\)/.test(view), 'the CSV import plans before it writes');
ok(/if \(u\?\.revert\) \{ refuse\(await u\.revert\(\)\); return; \}/.test(view), 'Undo runs a revert for page writes');
ok(['pickMode', 'pickRow', 'pickAll', 'pickDel', 'pickHeard'].every((k) => tab.includes(`case '${k}'`)), 'Select on the Call log and Voicemail lists');
ok((hbs.match(/data-op="pickMode"/g) || []).length >= 4 && /data-which="log" data-k="\{\{id\}\}"/.test(hbs) && /data-which="vm" data-k="\{\{key\}\}"/.test(hbs), 'both lists have the Select button, the bar and ticking rows');
ok(/DATA_SCHEMA_VERSION = 9;/.test(mr) && /to: 9,[\s\S]{0,400}migrateWrittenLogs/.test(mr), 'migration v9 is registered');
ok(['lgFold', 'lgFoldAll', 'lgMore', 'lgDates', 'lgDatesOff', 'lgListClear'].every((k) => view.includes(`  ${k}: `)) && view.includes('lgQ: (el) => { S.lgQ = el.value; return true; }') && /id="lg-show"/.test(view) && /id="lg-group"/.test(view), 'the list has search, Show, Group, dates, folds and Show more');
ok(read('styles/components/admin-panel/tab-phone.css').includes('.ncm-ph2-pickbar') && read('styles/components/admin-panel/tab-phone.css').includes('.ncm-lg-tl'), 'the Select bar and the transcript rows are styled');

console.info = quietInfo;
console.log(`test-call-history: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
