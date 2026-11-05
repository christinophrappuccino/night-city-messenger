// Sim: Admin → Messages → Needs a reply as a LIST (dev/mockups/inbox-cleanup-mock.html §3, 2026-11-05; it replaced
// the Desk). Drives the REAL messagesModel rules (filter, search, the four sorts, grouping by NPC / player, pages,
// folds, the answered list), guards the MessagesTab / template / CSS wiring, and renders the REAL template through
// Foundry's Handlebars at scale (120 lines).
//   node dev/tools/sims/test-needs-reply-list.mjs
import { FOUNDRY_APP_PKGS } from './lib/foundryApp.mjs';
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const M = await imp('scripts/ui/AdminPanel/tabs/messagesModel.js');

// ═══ 1. Rules ═══
const H = 3600000, NOW = Date.UTC(2045, 7, 14, 22);
const R = (key, extra = {}) => ({ key, name: key, ownerId: key.split('|')[0], aliasName: '', waiting: 0, oldestWaitTs: 0, newestWaitTs: 0, latestTs: 0, players: [], subject: '', preview: '', whoNames: '', ...extra });
{
  ok(M.DESK_FILTERS.map(f => f[0]).join() === 'all,waiting,answered', 'three filters');
  ok(M.REPLY_SORTS.map(f => f[0]).join() === 'wait,newest,most,npc' && M.REPLY_GROUPS.map(f => f[0]).join() === 'none,npc,player' && M.REPLY_PAGE === 40, 'four sorts, three groupings, 40 a page');
  ok(M.deskPasses(R('a', { waiting: 2 }), 'waiting') && !M.deskPasses(R('a'), 'waiting') && M.deskPasses(R('a'), 'answered') && M.deskPasses(R('a'), 'all'), 'filters');
  const m1 = M.waitMeter(NOW - 6 * H, NOW), m2 = M.waitMeter(NOW - 30 * H, NOW);
  ok(m1.pct === 25 && !m1.hot && m2.pct === 100 && m2.hot && M.waitMeter(0, NOW).pct === 0, 'the wait meter fills across a day, then turns hot');

  const r = R('rogue|q', { name: 'Rogue', aliasName: 'Queen of Hearts', subject: 'Who is this', preview: 'Got your card off a dead courier', whoNames: 'V, Hana Ito', lastFrom: 'V' });
  ok(M.replyMatches(r, '') && M.replyMatches(r, 'queen') && M.replyMatches(r, 'COURIER') && M.replyMatches(r, 'hana rogue') && !M.replyMatches(r, 'hana dex'), 'search: every word, any field, any case');

  const rows = [
    R('vik|', { name: 'Vik', waiting: 1, oldestWaitTs: NOW - 30 * H, newestWaitTs: NOW - 30 * H }),
    R('abe|', { name: 'Abe', waiting: 4, oldestWaitTs: NOW - 10 * H, newestWaitTs: NOW - 1 * H }),
    R('rogue|', { name: 'Rogue', waiting: 2, oldestWaitTs: NOW - 10 * H, newestWaitTs: NOW - 3 * H }),
  ];
  const keys = (l) => l.map(x => x.key).join();
  ok(keys(M.sortReplyRows(rows, 'wait')) === 'vik|,abe|,rogue|', 'longest wait first (ties A–Z)');
  ok(keys(M.sortReplyRows(rows, 'newest')) === 'abe|,rogue|,vik|', 'newest first');
  ok(keys(M.sortReplyRows(rows, 'most')) === 'abe|,rogue|,vik|', 'most waiting first');
  ok(keys(M.sortReplyRows(rows, 'npc')) === 'abe|,rogue|,vik|', 'NPC A–Z');
  ok(keys(M.sortReplyRows(rows, 'bogus')) === 'vik|,abe|,rogue|', 'an unknown sort falls back to the longest wait');

  // at scale: 100 waiting + 30 answered
  const big = [];
  for (let i = 0; i < 100; i++) big.push(R(`npc${String(i).padStart(3, '0')}|`, { name: `NPC ${String(i).padStart(3, '0')}`, waiting: 1 + (i % 3), oldestWaitTs: NOW - (i + 1) * H, newestWaitTs: NOW - H, players: [{ key: `p${i % 5}`, name: `Player ${i % 5}` }, ...(i % 10 === 0 ? [{ key: 'p9', name: 'Player 9' }] : [])] }));
  for (let i = 0; i < 30; i++) big.push(R(`done${i}|`, { name: `Done ${i}`, latestTs: NOW - i * H }));
  const l = M.replyList(big, { nowMs: NOW });
  ok(l.counts.all === 130 && l.counts.waiting === 100 && l.counts.answered === 30, 'counts come from every line');
  ok(l.groups.length === 1 && l.groups[0].rows.length === 40 && l.more === 60 && l.waitingShown === 40, 'a page of 40, 60 more');
  ok(l.groups[0].rows[0].key === 'npc099|' && l.groups[0].rows[0].meter.hot, 'the longest wait leads, hot');
  ok(l.answered.length === 30 && l.answered[0].key === 'done0|' && l.answered.every(x => x.done) && l.answeredMore === 0, 'answered lines: most recent first, their own page');
  const l2 = M.replyList(big, { nowMs: NOW, limit: 80, answeredLimit: 10 });
  ok(l2.waitingShown === 80 && l2.more === 20 && l2.answered.length === 10 && l2.answeredMore === 20, 'Show more grows each page');
  const l3 = M.replyList(big, { nowMs: NOW, selKey: 'npc005|' });
  ok(l3.waitingShown === 95 && l3.groups[0].rows.some(x => x.sel && x.key === 'npc005|') && l3.selShown, 'a marked line far down stretches the page until it shows');
  const l4 = M.replyList(big, { nowMs: NOW, group: 'npc', limit: 200 });
  ok(l4.grouped && l4.groups.length === 100 && l4.groups.every(g => g.n === 1 && g.label), 'by NPC: one group per NPC');
  const l5 = M.replyList(big, { nowMs: NOW, group: 'player', limit: 200 });
  ok(l5.groups.length === 6 && l5.groups.find(g => g.key === 'pl:p9').n === 10 && l5.waitingShown === 100, 'by player: a crowd line sits under each of its players and counts once against the page');
  const l6 = M.replyList(big, { nowMs: NOW, group: 'player', limit: 200, shut: new Set(['pl:p0']) });
  ok(l6.groups.find(g => g.key === 'pl:p0').shut && !l6.groups.find(g => g.key === 'pl:p1').shut, 'a folded group stays folded');
  const l7 = M.replyList(big, { nowMs: NOW, group: 'npc', sort: 'npc', limit: 200 });
  ok(l7.groups[0].label === 'NPC 000' && l7.groups[99].label === 'NPC 099', 'NPC A–Z orders the groups by name');
  const l8 = M.replyList(big, { nowMs: NOW, q: 'npc 01' });   // NPC 001 + NPC 010…019
  ok(l8.matched === 11 && l8.waitingShown === 11 && l8.answered.length === 0, 'search narrows both lists');
  const l9 = M.replyList(big, { nowMs: NOW, filter: 'answered' });
  ok(l9.waitingShown === 0 && l9.answered.length === 30, 'Answered filter: only the answered list');
  const lw = M.replyList(big, { nowMs: NOW, filter: 'waiting' });
  ok(lw.answered.length === 0 && lw.waitingMatched === 100, 'Waiting filter: no answered list');
  ok(M.replyList([], {}).shown === 0 && M.replyList([], {}).groups[0].rows.length === 0, 'an empty world is an empty list');
  ok(typeof M.identityOrder === 'function' && M.identityOrder([{ id: 'a' }, { id: 'b' }], 'b')[0].id === 'b', 'reply-as order kept (Reply picks the identity they wrote to)');
  ok(!('deskQueue' in M) && !('deskThread' in M) && !('deskVoice' in M) && !('deskSentLine' in M) && !('deskDefaultKey' in M), 'the Desk rules are gone');
}

// ═══ 2. Wiring ═══
const js = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
const hbs = read('templates/admin-panel/tab-messages.hbs');
const css = read('styles/components/admin-panel/tab-messages.css');
const hier = read('styles/components/admin-panel/admin-hierarchy.css');
const view = hbs.slice(hbs.indexOf('NEEDS A REPLY — THE LIST'), hbs.indexOf('ALL MAIL')) + hbs.slice(hbs.indexOf('{{#*inline "ncmMsg2RqRow"}}'), hbs.indexOf('{{/inline}}', hbs.indexOf('ncmMsg2RqRow')));
{
  const ops = [...new Set([...view.matchAll(/data-op="([a-zA-Z]+)"/g)].map(m => m[1]))];
  ok(ops.length >= 10, `the list has its controls (${ops.join(', ')})`);
  for (const op of ops) ok(new RegExp(`case '${op}'`).test(js), `onAct handles ${op}`);
  ok(!/data-owner="(?!messages")/.test(view), 'data-owner is only ever the tab router (the inbox owner rides as data-owner-id)');
  ok(/case 'rqInbox':[^\n]*inboxOwner: d\.ownerId/.test(js), 'the inbox button reads data-owner-id');
  ok(/replyList\(rows, \{/.test(js) && /_rq = ''/.test(js) && /_rSort = 'wait'/.test(js) && /_rGroup = 'none'/.test(js) && /_rLimit = REPLY_PAGE/.test(js), 'the tab keeps search, sort, group and page as state');
  ok(/wireSearch\('\[data-msg2-rqsearch\]', '_rq'/.test(js), 'the search box is debounced like the other two');
  ok(!/_deskDetail|_deskFolds|_setDeskFold|_onReplySend|_anonBlock|_drafts|_deskSent|_replyAnon|scopeId\('rpas'\)|DESK_FOLDS|deskThread|deskVoice/.test(js), 'no Desk code left in the tab');
  ok(!/ncm-msg2-desk|ncm-msg2-dq|ncm-msg2-sendbtn|deskIdent|replySend|deskFold/.test(hbs), 'no Desk markup left in the template');
  ok(!/ncm-msg2-desk|ncm-msg2-dq|ncm-msg2-sendbtn|dd--upl/.test(css) && !/ncm-msg2-desk|ncm-msg2-dq|ncm-msg2-sendbtn/.test(hier), 'no Desk rules left in the CSS');
  ok(!/\.\.\//.test(view), 'no ../ in the list markup');
  ok(!/\{\{\s*(sub|gt|lt|add|concat|lower|upper|join|not|and|or)\s*\}\}/.test(view), 'no helper-name fields in the list markup');
  const used = [...new Set([...view.matchAll(/ncm-msg2-rq[a-z_-]*/g)].map(m => m[0]))];
  ok(used.length >= 12, `the list uses its own ncm-msg2-rq* classes (${used.length})`);
  for (const c of used) ok(css.includes(`.${c}`), `class .${c} is styled`);
  const block = css.slice(css.indexOf('Needs a reply — THE LIST'), css.indexOf('All mail — the CALENDAR'));
  ok(block.length > 2000 && !/#[0-9a-f]{3,8}\b/i.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), 'list CSS: tokens only, no literal hex');
  ok(/--ncm-attn/.test(block) && /--ncm-bad/.test(block) && /--ncm-secret/.test(block) && /--ncm-good/.test(block), 'meaning colours: amber waiting, red hot, violet alias, green answered');
  ok(/button:is\(\.ncm-msg2-rq__gh, \.ncm-msg2-rq__sep, \.ncm-msg2-rq__more\)[^{]*\{[^}]*width: 100% !important/.test(block), 'the list’s own buttons are reset off Foundry’s button look');
  ok(/label\.ncm-msg2-rq__find \{[^}]*text-transform: none/.test(block), 'the search field opts out of the uppercase label rule');
}

// ═══ 3. REAL render, at scale ═══
let HB = null;
for (const p of [...FOUNDRY_APP_PKGS]) {
  if (!existsSync(p)) continue;
  try { HB = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!HB) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  HB.registerHelper('eq', (a, b) => String(a) === String(b));
  HB.registerHelper('gt', (a, b) => Number(a) > Number(b));
  { const { registerTipHelper } = await import(new URL('../../../scripts/utils/notify.js', import.meta.url).href); registerTipHelper(HB); }
  { const { registerTagHueHelper } = await imp('scripts/utils/tagHue.js'); registerTagHueHelper(HB); }
  const render = HB.compile(hbs);
  const face = (n) => ({ name: n, img: '', initials: n.slice(0, 2).toUpperCase() });
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(R(`npc${i}|${i % 7 === 0 ? 'al' : ''}`, {
    name: `NPC ${i}`, aliasName: i % 7 === 0 ? `Mask ${i}` : '', waiting: 1 + (i % 3), oldestWaitTs: NOW - (i + 1) * H, newestWaitTs: NOW - H,
    players: [{ key: `p${i % 4}`, name: `Runner ${i % 4}` }], faces: [face(`Runner ${i % 4}`)], moreFaces: i % 9 === 0 ? 2 : 0, whoNames: `Runner ${i % 4}`, playersN: 1, messages: 1 + (i % 3),
    npc: face(`NPC ${i}`), subject: `Job ${i}`, lastFrom: `Runner ${i % 4}`, preview: `Text <b>${i}</b> & more`, openId: `m${i}`, waitAge: `${i + 1}h`, doneLine: '', typed: i === 97,
  }));
  for (let i = 0; i < 12; i++) rows.push(R(`done${i}|`, { name: `Done ${i}`, latestTs: NOW - i * H, faces: [], players: [], npc: face(`Done ${i}`), subject: `Old ${i}`, lastFrom: '', preview: '', openId: `d${i}`, doneLine: `answered ${i}h ago`, playersN: 0, messages: 0 }));
  const ctxFor = ({ filter = 'all', q = '', sort = 'wait', group = 'none', limit = 40, shut = new Set(), answeredOpen = false, selKey = null } = {}) => {
    const list = M.replyList(rows, { filter, q, sort, group, limit, nowMs: NOW, shut, selKey });
    return { activeTab: 'messages', msg2: { isReply: true, nav: [], head: [], reply: {
      filt: filter, filtLabel: M.DESK_FILTERS.find(([k]) => k === filter)[1], filtCount: list.counts[filter], includeGm: false, quietOn: true, showQuiet: true, quietN: 3,
      chips: M.DESK_FILTERS.map(([key, label]) => ({ key, label, count: list.counts[key], on: key === filter })),
      sorts: M.REPLY_SORTS.map(([key, label]) => ({ key, label, on: key === sort })), groupBys: M.REPLY_GROUPS.map(([key, label]) => ({ key, label, on: key === group })),
      sortLabel: M.REPLY_SORTS.find(([k]) => k === sort)[1], groupLabel: M.REPLY_GROUPS.find(([k]) => k === group)[1], grouped: list.grouped,
      q, searching: !!q, playersWaiting: 4, linesWaiting: list.counts.waiting, oldestAge: '100h',
      list, groups: list.groups, hasWaiting: list.waitingShown > 0, showWaiting: filter !== 'answered',
      answered: list.answered, hasAnswered: list.answeredMatched > 0, answeredOpen: filter === 'answered' || answeredOpen, answeredN: list.answeredMatched,
      more: list.more, moreN: Math.min(40, list.more), answeredMore: list.answeredMore,
      matchLine: q ? `${list.matched} of ${list.total} lines match` : '', emptyText: q ? 'Nothing matches the search.' : 'Nothing waiting. Nice.',
    } } };
  };
  const bad = (h) => /undefined|\[object Object\]|NaN/.test(h);
  const rowsIn = (h) => (h.match(/class="ncm-msg2-rq__row /g) || []).length;
  {
    const html = render(ctxFor());
    ok(!bad(html), 'renders with no undefined / [object Object] / NaN');
    ok(rowsIn(html) === 40 && html.includes('Show 40 more · 60 left'), '100 waiting lines render a page of 40 and offer the rest');
    ok(html.includes('data-op="rqDoneFold"') && html.includes('Answered<span class="n">12</span>') && !html.includes('data-key="done0|"'), 'the answered lines sit folded under their heading');
    ok(html.indexOf('data-key="npc99|"') < html.indexOf('data-key="npc97|"') && html.indexOf('data-key="npc97|"') > 0, 'the longest wait first');
    ok(/ncm-msg2-rq__row\s+is-hot"[^>]*data-key="npc99\|"/.test(html.replace(/\s+/g, ' ')), 'a day-old wait is hot');
    ok(html.includes('<b>Runner 3:</b> Text &lt;b&gt;99&lt;/b&gt; &amp; more'), 'the preview is escaped text, after who wrote it');
    ok(/data-op="rqReply" data-key="npc98\|al"[^>]*><i class="fas fa-mask"><\/i> Reply/.test(html) && /data-op="rqReply" data-key="npc99\|"[^>]*><i class="fas fa-reply"><\/i> Reply/.test(html), 'Reply wears a mask on an alias line');
    ok(html.includes('data-op="rqInbox" data-key="npc99|" data-owner-id="npc99" data-message-id="m99"') && html.includes('data-op="markAnswered" data-key="npc99|"'), 'each line opens its inbox at the message, or ✓');
    ok(html.includes('<span class="more">+2</span>') && html.includes('fa-user-ninja ty'), 'a crowd shows +N faces; terminal-typed mail is flagged');
    ok(html.includes('data-msg2-rqsearch') && html.includes('data-op="rqSort" data-sort="most"') && html.includes('data-op="rqGroup" data-group="player"') && html.includes('data-op="rFilt" data-f="waiting"'), 'the toolbar: search, Sort ▾ (sort + group), Show ▾');
    ok(html.includes('<b>4</b>&nbsp;waiting on 100 · oldest 100h'), 'the summary counts players, lines and the oldest wait');
    ok(html.includes('3 NPC inboxes nobody has written to'), 'quiet inboxes are a count');
  }
  {
    const html = render(ctxFor({ answeredOpen: true }));
    ok(rowsIn(html) === 52 && html.includes('data-key="done0|"') && /ncm-msg2-rq__row\s+is-done/.test(html), 'the Answered fold opens');
    const done = html.slice(html.indexOf('data-key="done0|"'));
    ok(done.slice(0, 1500).includes('answered 0h ago') && !done.slice(0, done.indexOf('</div>\n</div>') + 1).includes('data-op="markAnswered"'), 'an answered line says when, and has no ✓');
  }
  {
    const html = render(ctxFor({ group: 'player', limit: 200, shut: new Set(['pl:p1']) }));
    ok(!bad(html) && (html.match(/class="ncm-msg2-rq__gh/g) || []).length === 4 && html.includes('<b>Runner 0</b>'), 'grouped by player: a heading each');
    ok(/ncm-msg2-rq__gh is-shut[^"]*" data-action="tabAct" data-owner="messages" data-op="rqFold" data-key="pl:p1"/.test(html) && rowsIn(html) === 75, 'a folded group hides its lines');
    ok(html.includes('<span class="g">· By player</span>'), 'Sort ▾ says the grouping');
  }
  {
    const html = render(ctxFor({ q: 'npc 1' }));
    ok(html.includes('ncm-msg2-rq__match') && html.includes('data-op="rqClear"') && rowsIn(html) > 0, 'searching shows how many match and a clear button');
    const none = render(ctxFor({ q: 'zzzz' }));
    ok(none.includes('Nothing matches the search.') && rowsIn(none) === 0, 'no hits says so');
  }
  {
    const html = render(ctxFor({ filter: 'answered' }));
    ok(rowsIn(html) === 12 && !html.includes('Show 40 more'), 'the Answered filter lists only answered lines, open');
  }
  {
    const c = ctxFor(); Object.assign(c.msg2.reply, { list: M.replyList([], {}), groups: M.replyList([], {}).groups, hasWaiting: false, hasAnswered: false, linesWaiting: 0, more: 0, answered: [], answeredN: 0 });
    const html = render(c);
    ok(!bad(html) && html.includes('Nothing waiting. Nice.') && html.includes('Nobody waiting'), 'an empty list says so');
  }
}

console.log(`\ntest-needs-reply-list: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
