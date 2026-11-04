/*
 * Conversations: a stress test. GM Script macro; needs Conversations switched on and two characters in the world.
 * Makes one conversation, writes LINES through the real service, reports how it held up, and offers to delete it.
 * While it runs, keep a player connected with their Agent open on the conversation, and watch for lag, a sidebar redraw or a repeated toast.
 */
(async () => {
const LINES = 1000;
const BURST = 5; // lines written at once, like five people typing

const svc = game.nightcity?.conversationService;
if (!svc?.enabled) return ui.notifications.warn('Switch on Conversations in Module Settings first.');
const people = game.nightcity.masterContactService.getAll().filter((c) => !c.sendOnly).slice(0, 3);
const pcs = game.actors.filter((a) => a.hasPlayerOwner).slice(0, 3);
const raw = [...pcs.map((a) => ({ actorId: a.id })), ...people.map((c) => ({ contactId: c.id }))];
if (raw.length < 2) return ui.notifications.warn('This needs at least two characters or contacts.');

let sidebar = 0;
const hook = Hooks.on('renderJournalDirectory', () => { sidebar++; });
const made = await svc.start({ as: raw[0], members: raw.slice(1), title: 'NCM stress test (safe to delete)' });
if (!made.ok) { Hooks.off('renderJournalDirectory', hook); return ui.notifications.error(`NCM | ${made.error}`); }
const speakers = svc.get(made.id).members.map((m) => m.key);

const t0 = performance.now();
let failed = 0, slowest = 0;
for (let i = 0; i < LINES; i += BURST) {
  const t = performance.now();
  const sends = [];
  for (let k = 0; k < BURST; k++) sends.push(svc.send(made.id, { asKey: speakers[(i + k) % speakers.length], kind: 'text', text: `Stress line ${i + k + 1}. The quick fixer jumps over the lazy corpo.` }));
  for (const r of await Promise.all(sends)) if (!r?.ok) failed++;
  slowest = Math.max(slowest, performance.now() - t);
  if (i % 100 === 0) ui.notifications.info(`NCM stress: ${i} of ${LINES}`);
}
const secs = (performance.now() - t0) / 1000;
Hooks.off('renderJournalDirectory', hook);

const conv = svc.get(made.id);
const j = game.journal.get(conv.journalId);
const size = JSON.stringify(j.pages.contents.map((p) => p.flags)).length;
const t1 = performance.now();
const shown = svc.lines(made.id).length;
const readMs = performance.now() - t1;
const lastPage = j.pages.contents.at(-1);
const wire = JSON.stringify(Object.values(lastPage.getFlag('night-city-messenger', 'lines') || {})[0] || {}).length;

const report = [
  `${LINES} lines in ${secs.toFixed(1)} s (${(LINES / secs).toFixed(0)} a second)`,
  `failed: ${failed}; last number used: ${conv.lastSeq}`,
  `slowest burst of ${BURST}: ${slowest.toFixed(0)} ms`,
  `pages: ${j.pages.size}; stored: ${(size / 1024).toFixed(0)} KB; about ${wire} bytes a line`,
  `drawing the latest pages: ${shown} lines in ${readMs.toFixed(1)} ms`,
  `Journal sidebar redraws while writing: ${sidebar}`,
];
console.log('NCM stress', report);
const keep = await Dialog.confirm({
  title: 'Conversations stress test',
  content: `<ul>${report.map((r) => `<li>${r}</li>`).join('')}</ul><p>Delete the test conversation?</p>`,
});
if (keep) await svc.destroy(made.id);
})();
