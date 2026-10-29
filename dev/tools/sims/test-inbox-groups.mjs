// Messages → Inboxes: view chips, group by kind/role/org, sort, folds.
import fs from 'node:fs';
const root = new URL('../../../', import.meta.url);
const M = await import(new URL('scripts/ui/AdminPanel/tabs/messagesModel.js', root));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const rows = [
  { name: 'V', isPlayer: true, total: 4, unread: 1, lastTs: 50 },
  { name: 'Rache', isPlayer: true, total: 0, unread: 0, lastTs: 0, noInbox: true },
  { name: 'Rogue', role: 'fixer', roleLabel: 'Fixers', org: 'Afterlife', total: 9, unread: 3, lastTs: 90 },
  { name: 'Wakako', role: 'fixer', roleLabel: 'Fixers', org: 'Tyger Claws', total: 2, unread: 0, lastTs: 70 },
  { name: 'Takemura', role: 'exec', roleLabel: 'Execs', org: 'Arasaka', total: 1, unread: 1, lastTs: 95 },
  { name: 'Bob', role: '', org: '', total: 0, unread: 0, lastTs: 0 },
  { name: 'Ghost', orphan: true, total: 3, unread: 0, lastTs: 10 },
];
const c = M.inboxViewCounts(rows);
ok(c.all === 7 && c.pc === 2 && c.npc === 4 && c.unread === 3 && c.empty === 2 && c.bad === 1 && c.quiet === 0, 'view counts');
const kind = M.groupInboxes(rows);
ok(kind.map(g => g.key).join() === 'pc,npc,bad', 'kind: players, NPCs, then attention');
ok(kind[1].unread === 4 && kind[1].count === 4, 'group unread + count');
const role = M.groupInboxes(rows, { by: 'role' });
ok(role.map(g => g.label).join('|') === 'Players’ characters|Execs|Fixers|No role|Owner gone', 'role groups, none last, players first, orphans last');
const org = M.groupInboxes(rows, { by: 'org' });
ok(org[0].key === 'pc' && org.at(-2).label === 'No organization' && org.at(-1).key === 'bad', 'org groups');
ok(M.groupInboxes(rows, { sort: 'recent' })[1].rows.map(r => r.name).join() === 'Takemura,Rogue,Wakako,Bob', 'recent sort');
ok(M.groupInboxes(rows, { sort: 'unread' })[1].rows[0].name === 'Rogue', 'unread sort');
ok(M.groupInboxes(rows, { sort: 'name' })[1].rows[0].name === 'Bob', 'name sort');
ok(M.groupInboxes(rows)[1].rows[0].name === 'Takemura', 'the default sort is Latest mail');
ok(M.groupInboxes(rows.filter(r => M.inboxPasses('unread', r))).every(g => g.rows.every(r => r.unread)), 'unread view');
const js = fs.readFileSync(new URL('scripts/ui/AdminPanel/tabs/MessagesTab.js', root), 'utf8');
const hbs = fs.readFileSync(new URL('templates/admin-panel/tab-messages.hbs', root), 'utf8');
ok(js.includes("case 'ibFoldAll'") && hbs.includes('data-op="ibFoldAll"') && ['show', 'group', 'sort'].every(k => hbs.includes('data-msg2-ibsel="' + k + '"')) && js.includes("sel.dataset.msg2Ibsel === 'sort'"), 'Show / Group / Sort are selects wired on change; fold-all is an op');
ok(hbs.includes('data-msg2-ibfold="{{key}}"') && /\[data-msg2-ibfold\]/.test(js) && hbs.includes('data-ib-group="{{key}}"') && js.includes("head.closest('[data-ib-group]')"), 'groups fold in place');
ok(/forced = !!q \|\| this\._ibView !== 'all'/.test(js), 'search / a view opens every group');
// ── The default-fold rule ──
{
  const shut = new Set(), open = new Set();
  const st = (g, o = {}) => M.foldShut(g.key, { defaultOpen: M.inboxGroupDefaultOpen(g.key), shut, open, ...o });
  ok(!st(role[0]) && role.slice(1).every(g => st(g)), 'default: Players open; NPC role groups and Needs attention closed');
  ok(!st(kind[0]) && st(kind[1]) && st(kind[2]), 'kind grouping: Players open, NPCs + orphans closed');
  ok(role.every(g => !st(g, { forced: true })), 'search / non-All view opens every group');
  M.recordFold('pc', true, shut, open); M.recordFold('role:fixer', false, shut, open);
  ok(st(role[0]) && !st(role.find(g => g.key === 'role:fixer')), 'the GM’s choices last for the session');
  const foldAll = js.slice(js.indexOf("case 'ibFoldAll'"), js.indexOf("case 'ibFoldAll'") + 400);
  ok(js.includes('inboxGroupDefaultOpen(g.key)') && js.includes('this._ibShut.clear(); this._ibOpen.clear();') && foldAll.includes('recordFold'), 'tab uses the rule; regroup resets; fold-all records');
  const head = hbs.split(/\r?\n/).find(l => l.includes('data-msg2-ibfold="{{key}}"')) || '';
  ok(head.includes('<span class="cnt">{{count}}</span>') && head.includes('{{#if unread}}<span class="u"') && !head.includes('shut}}<span'), 'a group header (open or closed) carries count + unread');
}
// ── The Mailroom (2026-10-29): sorts that explain themselves, postmarks, envelopes, the belt ──
{
  const DAY = 86400000, NOW = 100 * DAY;
  const R = [
    { name: 'Busy', total: 9, unread: 0, lastTs: NOW - DAY, busy: 9 },
    { name: 'Waiting', total: 3, unread: 2, lastTs: NOW - 3 * DAY, oldestUnreadTs: NOW - 5 * DAY, busy: 3 },
    { name: 'Also waiting', total: 4, unread: 2, lastTs: NOW - 2 * DAY, oldestUnreadTs: NOW - 2 * DAY, busy: 4 },
    { name: 'Dusty', total: 2, unread: 0, lastTs: NOW - 20 * DAY, busy: 0, quietDays: 20 },
    { name: 'Never', total: 0, unread: 0, lastTs: 0, busy: 0 },
  ];
  const order = (sort) => M.sortInboxes(R, sort).map(r => r.name).join();
  ok(order('recent') === 'Busy,Also waiting,Waiting,Dusty,Never', 'Latest mail: newest first');
  ok(order('unread') === 'Waiting,Also waiting,Busy,Dusty,Never', 'Most unread: a tie goes to whoever has waited longest');
  ok(order('busy') === 'Busy,Also waiting,Waiting,Dusty,Never', 'Busiest: the most mail in 14 days');
  ok(order('quiet') === 'Dusty,Waiting,Also waiting,Busy,Never', 'Quietest: the longest silence first, never-mailed last');
  ok(order('name').startsWith('Also waiting,Busy'), 'A–Z');
  const age = (ts) => Math.round((NOW - ts) / DAY) + 'd';
  ok(M.slotMetric(R[1], 'unread', age) === '2 unread · waiting 5d' && M.slotMetric(R[0], 'busy', age) === '9 in 14 days' && M.slotMetric(R[3], 'quiet', age) === 'quiet 20d' && M.slotMetric(R[4], 'recent', age) === 'empty', 'every slot prints the number its sort uses');
  ok(M.slotMetric({ orphan: true }, 'recent') === 'its owner was deleted' && M.slotMetric({ noInbox: true }, 'recent') === 'no inbox yet', 'orphans and missing inboxes say so');
  ok(M.inboxPasses('quiet', R[3]) && !M.inboxPasses('quiet', R[4]) && !M.inboxPasses('quiet', R[0]), 'Quiet 7d+ means had mail, none for a week');
  ok(M.INBOX_SORTS.every(s => s.length === 3 && s[2]), 'every sort carries its one-line meaning');
  ok(M.postmarkCode('CitiNet') === 'CTN' && M.postmarkCode('Arasaka CorpNet') === 'ACN' && M.postmarkCode('NCPD') === 'NCP' && M.postmarkCode('') === '???', 'postmark codes');
  const msgs = [{ _ts: NOW - 1000, read: false }, { _ts: NOW - DAY - 1000, read: true }, { _ts: NOW - 30 * DAY, read: true }];
  const t = M.inboxTraffic(msgs, NOW);
  ok(t.length === 14 && t[13].n === 1 && t[13].unread === 1 && t[12].n === 1 && t.reduce((n, d) => n + d.n, 0) === 2, '14 game days, today last, older mail left out');
  ok(['ibSel', 'ibClose', 'ibDelete', 'ibWrite', 'ibRead', 'ibExport', 'ibPurge'].every(op => js.includes("case '" + op + "'") && hbs.includes('data-op="' + op + '"'))
    && !/ibNet|ibBelt|ibJump|ibMore|ncm-mr-/.test(hbs + js), 'every Inboxes op is in the template and handled; nothing of the Mailroom is left');
  ok(!/data-owner="messages"[^>\n]*data-owner="/.test(hbs) && /data-owner-id="\{\{ownerId\}\}"/.test(hbs) && js.includes('d.ownerId'), 'a slot names its mailbox in data-owner-id (data-owner is the tab)');
  ok(js.includes("document.removeEventListener('keydown', this._ibKeys)") && js.includes('_wireInboxes(ib)'), 'the keyboard handler is removed on close');
}
console.log(`test-inbox-groups: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
