// Sim: Admin → Messages → Needs a reply as THE DESK (Version B of
// dev/mockups/admin-needs-reply-rethink-mock.html, 2026-10-28; replaced the
// switchboard). Drives the REAL messagesModel rules (queue order, the wait
// meter, the default pick, the thread's day lines, reply-as order, the voice
// line), guards the MessagesTab / template / CSS wiring, and renders the REAL
// template through Foundry's Handlebars.
//   node dev/tools/sims/test-messages-desk.mjs
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
const R = (key, extra = {}) => ({ key, name: key, waiting: 0, oldestWaitTs: 0, newestWaitTs: 0, latestTs: 0, ...extra });
{
  ok(M.deskPasses(R('a', { waiting: 2 }), 'waiting') && !M.deskPasses(R('a'), 'waiting'), 'Waiting chip: rows with someone waiting');
  ok(M.deskPasses(R('a'), 'answered') && !M.deskPasses(R('a', { waiting: 1 }), 'answered'), 'Answered chip: rows with nobody waiting');
  ok(M.deskPasses(R('a'), 'all') && M.deskPasses(R('a', { waiting: 1 }), 'all'), 'All lines: everything');

  const m1 = M.waitMeter(NOW - 6 * H, NOW), m2 = M.waitMeter(NOW - 30 * H, NOW), m0 = M.waitMeter(0, NOW);
  ok(m1.pct === 25 && !m1.hot && m1.age === 6 * H, 'the wait meter fills across a day (6 h = 25%)');
  ok(m2.pct === 100 && m2.hot, 'past a day the wait is hot and the meter is full');
  ok(m0.pct === 0 && !m0.hot, 'no wait, no meter');
  ok(M.DESK_HOT_MS === 24 * H, 'hot = 24 game hours');

  const rows = [
    R('dex', { latestTs: NOW - 2 * H }), R('rogue', { waiting: 2, oldestWaitTs: NOW - 5 * H, newestWaitTs: NOW - H }),
    R('vik', { waiting: 1, oldestWaitTs: NOW - 30 * H, newestWaitTs: NOW - 30 * H }), R('reg', { latestTs: NOW - 10 * H }),
    R('abe', { waiting: 1, oldestWaitTs: NOW - 5 * H, newestWaitTs: NOW - 5 * H }),
  ];
  const q = M.deskQueue(rows, { filter: 'all', selKey: 'rogue', nowMs: NOW });
  ok(q.waiting.map(r => r.key).join() === 'vik,abe,rogue', 'waiting rows: the longest wait on top (ties A→Z)');
  ok(q.answered.map(r => r.key).join() === 'dex,reg', 'answered rows below, most recent first');
  ok(q.waiting[0].meter.hot && !q.waiting[2].meter.hot && q.answered.every(r => r.done && r.meter.pct === 100), 'rows carry their meter and done state');
  ok(q.waiting.find(r => r.key === 'rogue').sel && q.selShown && !q.waiting[0].sel, 'the picked row is marked, exactly once');
  ok(q.counts.all === 5 && q.counts.waiting === 3 && q.counts.answered === 2 && q.shown === 5, 'chip counts come from every row, not the filtered ones');
  const qw = M.deskQueue(rows, { filter: 'waiting', selKey: 'dex', nowMs: NOW });
  ok(qw.shown === 3 && qw.answered.length === 0 && !qw.selShown && qw.counts.answered === 2, 'a chip narrows what is shown; a hidden pick is reported as not shown');
  ok(M.deskDefaultKey(q) === 'vik' && M.deskDefaultKey(M.deskQueue(rows.filter(r => !r.waiting), { nowMs: NOW })) === 'dex' && M.deskDefaultKey(M.deskQueue([], {})) === null, 'the default pick is the longest wait, else the latest answered, else nothing');

  const DAY = 86400000;
  const t = M.deskThread([{ ts: NOW, id: 'c' }, { ts: NOW - 2 * DAY, id: 'a' }, { ts: NOW - 2 * DAY + H, id: 'b' }], { labelDay: (ts) => `D${Math.floor(ts / DAY)}` });
  ok(t.map(e => e.kind === 'day' ? `[${e.label}]` : e.id).join() === `[D${Math.floor((NOW - 2 * DAY) / DAY)}],a,b,[D${Math.floor(NOW / DAY)}],c`, 'the thread runs oldest first with a day line whenever the day changes');
  ok(M.deskThread([]).length === 0, 'an empty thread has no day line');

  const ids = [{ id: 'main' }, { id: 'al1' }, { id: 'al2' }];
  ok(M.identityOrder(ids, 'al2').map(i => i.id).join() === 'al2,main,al1', 'the identity they wrote to goes first, the rest keep their order');
  ok(M.identityOrder(ids, 'main').map(i => i.id).join() === 'main,al1,al2' && M.identityOrder(ids, 'nope').length === 3 && M.identityOrder(ids, null)[0].id === 'main', 'the main / an unknown / no first leaves the order alone');

  ok(M.deskVoice({ text: ' Clipped. Never says please. ', inherited: true, from: { name: 'Rogue' } }).note === 'from Rogue', 'an inherited voice says whose it is');
  const v = M.deskVoice({ text: 'Short.', inherited: false });
  ok(v.text === 'Short.' && v.note === '' && !v.empty && !v.inherited, 'an own voice has no note');
  ok(M.deskVoice({ text: '  ' }).empty && M.deskVoice(null).empty, 'blank or missing = empty');
  ok(M.deskSentLine({ as: 'Rogue', to: 'V, Rache' }) === 'Sent as Rogue to V, Rache.' && M.deskSentLine({ as: 'Rogue' }) === 'Sent as Rogue.' && M.deskSentLine(null) === '', 'the sent line');
  ok(M.DESK_FILTERS.map(f => f[0]).join() === 'all,waiting,answered', 'three chips');
}

// ═══ 2. Wiring ═══
const js = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
const hbs = read('templates/admin-panel/tab-messages.hbs');
const css = read('styles/components/admin-panel/tab-messages.css');
const deskHbs = hbs.slice(hbs.indexOf('NEEDS A REPLY'), hbs.indexOf('ALL MAIL')) + hbs.slice(hbs.indexOf('{{#*inline "ncmMsg2DeskReplyMenu"}}'), hbs.indexOf('{{/inline}}', hbs.indexOf('ncmMsg2DeskReplyMenu')));
{
  ok(/deskQueue\(rows, \{ filter: this\._rFilt/.test(js) && /deskDefaultKey\(/.test(js) && /deskThread\(items2/.test(js) && /deskVoice\(/.test(js) && /identityOrder\(items/.test(js), 'MessagesTab gathers; messagesModel decides order, default, thread, voice');
  ok(/_rFilt = 'all'/.test(js), 'the desk opens on All lines');
  for (const op of ['convSel', 'rFilt', 'includeGm', 'replySend', 'replyComposer', 'replyAnon', 'markAnswered', 'deskIdent', 'deskContact', 'deskQuiet', 'deskFoldQ', 'deskFoldP']) {
    ok((deskHbs.includes(`data-op="${op}"`) || (op === 'convSel' && hbs.includes('{{#*inline "ncmMsg2DeskRow"}}') && hbs.includes('data-op="convSel"'))) && new RegExp(`case '${op}'`).test(js), `op ${op}: in the template and handled`);
  }
  ok(!/switchBoard\(|answerSlot\(|trafficDays\(|_swSent|_swQuietOpen|data-msg2-swfold/.test(js), 'no switchboard wiring left in the tab');
  ok(!/ncm-msg2-sw/.test(hbs) && !/ncm-msg2-sw/.test(css), 'no switchboard classes left in the template or CSS');
  ok(/this\._deskSent = \{ key: plan\.g\.key/.test(js) && deskHbs.includes('{{#if sentLine}}'), 'an inline reply leaves a "Sent as …" line in the box');
  ok(hbs.includes('{{#*inline "ncmMsg2DeskRow"}}') && deskHbs.includes('{{> ncmMsg2DeskRow}}'), 'the queue row is one inline partial');
  ok(deskHbs.includes('data-msg2-draft data-key="{{@root.msg2.reply.desk.key}}"'), 'the draft box keeps the per-conversation draft via @root (not ../ through blocks)');
  ok(!/\.\.\//.test(deskHbs), 'no ../ anywhere in the desk markup');
  ok(!/\{\{\s*(sub|gt|lt|add|concat|lower|upper|join)\b/.test(deskHbs), 'no helper-name fields in the desk markup');
  ok(deskHbs.includes('data-op="deskContact" data-contact-id="{{contactId}}" data-actor-id="{{actorId}}"') && deskHbs.includes('How they talk') && deskHbs.includes('No voice yet'), 'the persona reads the Voice and opens the contact to edit it');
  ok(deskHbs.includes('Open in the full composer') && deskHbs.includes('data-op="replyComposer"'), 'the full composer is one click away, with the draft');
  ok(deskHbs.includes('data-msg2-scroll="thread"') && deskHbs.includes('data-msg2-scroll="deskq"') && /k === 'thread'/.test(js), 'the thread and the queue scroll in their own boxes (scroll memo on the thread)');
  const used = [...new Set([...hbs.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)).filter(c => /^ncm-msg2-(desk|dq)/.test(c)))];
  ok(used.length > 20, `the desk uses its own ncm-msg2-desk* / ncm-msg2-dq* classes (${used.length})`);
  for (const c of used) ok(css.includes(`.${c}`), `class .${c} is styled`);
  const block = css.slice(css.indexOf('THE DESK'), css.indexOf('/* ═══', css.indexOf('THE DESK') + 10));
  ok(block.length > 2000 && !/#[0-9a-f]{3,8}\b/i.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), 'desk CSS: tokens only, no literal hex');
  ok(/--ncm-attn/.test(block) && /--ncm-secret/.test(block) && /--ncm-good/.test(block) && /--ncm-bad/.test(block), 'meaning colours: amber waiting, red hot, violet alias, green answered');
  ok(/ncm-admin-panel--pop \.ncm-msg2-desk \{ grid-template-columns/.test(block), 'the pop-out widens the columns');
  ok(!/\.ncm-msg2-(desk|dq)[a-z_-]*[\s{,:.]/.test(css.split('THE DESK')[0]), 'the ncm-msg2-desk / ncm-msg2-dq prefixes were free before');
}

// ═══ 3. REAL render ═══
let HB = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!existsSync(p)) continue;
  try { HB = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!HB) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  HB.registerHelper('eq', (a, b) => String(a) === String(b));
  { const { registerTagHueHelper } = await imp('scripts/utils/tagHue.js'); registerTagHueHelper(HB); }
  const render = HB.compile(hbs);
  const face = (n) => ({ name: n, img: '', initials: n.slice(0, 2).toUpperCase() });
  const rows = [
    R('rogue|', { name: 'Rogue', waiting: 2, oldestWaitTs: NOW - 5 * H, newestWaitTs: NOW - H, subline: 'RE: Meet', faces: [face('V'), face('Rache')], whoNames: 'V, Rache', playersN: 2, messages: 3, age: '1h', waitAge: '5h', npc: face('Rogue') }),
    R('rogue|q', { name: 'Rogue', aliasName: 'Queen of Hearts', waiting: 1, oldestWaitTs: NOW - 30 * H, newestWaitTs: NOW - 30 * H, subline: 'Who?', faces: [face('V')], whoNames: 'V', playersN: 1, messages: 1, age: '1d', waitAge: '1d', npc: face('Rogue') }),
    R('dex|', { name: 'Dexter', latestTs: NOW - 3 * H, subline: 'answered 3h ago', faces: [], whoNames: '', playersN: 0, messages: 0, age: '3h', waitAge: '', npc: face('Dexter') }),
  ];
  const ctxFor = (selKey, filter = 'all', { noDesk = false, voiceEmpty = false, qShut = false, pShut = false, quiet = true, anonOn = false } = {}) => {
    const queue = M.deskQueue(rows, { filter, selKey, nowMs: NOW });
    const desk = (selKey && !noDesk) ? {
      key: selKey, ownerId: 'rogue', npcName: 'Rogue', aliasName: selKey === 'rogue|q' ? 'Queen of Hearts' : '',
      head: { players: 'V', faces: [face('V')], subject: 'Who?', msgCount: 2, waiting: 1, subline: 'Alias of Rogue · with V' },
      entries: M.deskThread([
        { ts: NOW - 2 * 86400000, ...face('V'), addr: 'v@nc.net', subject: 'Hey', bodyHtml: '<p>First.</p>', time: '10:00', when: 'x', age: '2d', mine: false, waiting: false, messageId: 'm0' },
        { ts: NOW - 30 * H, ...face('Queen of Hearts'), addr: '', subject: '', bodyHtml: '<p>Who is this?</p>', time: '16:00', when: 'y', age: '1d', mine: true, waiting: false, messageId: 'r0' },
        { ts: NOW - H, ...face('V'), addr: '', subject: 'Who?', bodyHtml: '<p>Got your card.</p>', time: '21:00', when: 'z', age: '1h', mine: false, waiting: true, messageId: 'm1', typist: '' },
      ], { labelDay: (ts) => `day ${Math.floor(ts / 86400000)}` }),
      msgCount: 3, typedNotes: [], hasTyped: false,
      compose: { replyAsName: 'Queen of Hearts', fromAddr: 'qoh@ghost.box', toLine: 'V', toMany: false, toCount: 1, canReply: true, waiting: 1, draft: 'half-written', anonOk: true, anon: anonOn, sentLine: '',
        identities: [{ id: 'c:mc-queen', name: 'Queen of Hearts', icon: 'fa-masks-theater', isAlias: true, meta: 'alias of Rogue', addr: 'qoh@ghost.box', on: true, wrote: true }, { id: 'c:mc-rogue', name: 'Rogue', icon: 'fa-user-tie', isAlias: false, meta: 'main', addr: 'rogue@afterlife.nc', on: false, wrote: false }], manyIds: true, idCount: 2 },
      persona: {
        ...face('Queen of Hearts'), addr: 'qoh@ghost.box', isAlias: true, mainName: 'Rogue', role: { label: 'Fixer', icon: 'fa-handshake', hue: 'role:fixer' }, org: 'Afterlife',
        voice: voiceEmpty ? { text: '', note: '', empty: true, inherited: false } : { text: 'Clipped. Never says please.', note: 'from Rogue', empty: false, inherited: true },
        contactId: 'mc-queen', actorId: 'rogue', hasVoiceTarget: true,
        identities: [{ id: 'c:mc-queen', name: 'Queen of Hearts', icon: 'fa-masks-theater', isAlias: true, meta: 'alias of Rogue', addr: 'qoh@ghost.box', on: true }, { id: 'c:mc-rogue', name: 'Rogue', icon: 'fa-user-tie', isAlias: false, meta: 'main', addr: 'rogue@afterlife.nc', on: false }],
        manyIds: true, wroteToName: 'Queen of Hearts', wroteToIsPicked: true,
        said: [{ text: 'Who is this?', when: 'y' }], hasSaid: true, inboxOwnerId: 'rogue',
      },
    } : null;
    return { activeTab: 'messages', msg2: { isReply: true, nav: [], head: [], reply: {
      filt: filter, filtLabel: M.DESK_FILTERS.find(([k]) => k === filter)[1], filtCount: queue.counts[filter], includeGm: false, quietOn: quiet, showQuiet: quiet, qShut, pShut, chips: M.DESK_FILTERS.map(([key, label]) => ({ key, label, count: queue.counts[key], on: key === filter })),
      playersWaiting: 3, linesWaiting: queue.counts.waiting, quietN: 4, queue, hasQueue: queue.shown > 0, emptyText: 'Nothing waiting. Nice.', desk } } };
  };
  const bad = (h) => /undefined|\[object Object\]|NaN/.test(h);
  {
    const html = render(ctxFor('rogue|q'));
    ok(!bad(html), 'renders with no undefined / [object Object] / NaN');
    ok((html.match(/class="ncm-msg2-dq /g) || []).length === 3, 'one queue row per conversation');
    const iQ = html.indexOf('data-key="rogue|q"'), iR = html.indexOf('data-key="rogue|"'), iSep = html.indexOf('ncm-msg2-desk__sep'), iD = html.indexOf('data-key="dex|"');
    ok(iQ > 0 && iR > iQ && iSep > iR && iD > iSep, 'the longest wait first, then the rest, then Answered under its own line');
    ok(/ncm-msg2-dq is-sel[^"]*is-hot"/.test(html) && html.includes('style="width:100%"'), 'the picked day-old wait is hot with a full meter');
    ok(/<b>3<\/b> waiting/.test(html) && html.includes('title="3 players waiting on 2 lines"') && html.includes('ncm-msg2-desk__qhd'), 'the queue head is one row and counts the players waiting');
    ok(html.includes('data-op="rFilt" data-f="waiting"') && /<span class="v">All lines<\/span> <span class="c">3<\/span>/.test(html), 'Show ▾ names the current filter and its count; the filters are menu items');
    ok(!html.includes('ncm-msg2-desk__chips') && !html.includes('ncm-msg2-desk__foot') && !html.includes('ncm-msg2-desk__acts'), 'the chip row, the footer and the wrapping action row are gone');
    ok(html.includes('4 NPC inboxes nobody has written to'), 'quiet inboxes are a count, not rows');
    ok((html.match(/class="ncm-msg2-desk__day"/g) || []).length === 3 && html.indexOf('day ') < html.indexOf('First.'), 'the thread opens with a day line and splits the three days');
    ok(/ncm-msg2-b me /.test(html) && /ncm-msg2-b  new"/.test(html.replace(/\s+"/g, '"')) || /ncm-msg2-b\s+new"/.test(html), 'the NPC\'s reply sits on the right; the unanswered message is marked');
    ok(html.includes('Reply as Queen of Hearts') && html.includes('qoh@ghost.box') && html.includes('>half-written</textarea>') && html.includes('data-key="rogue|q"'), 'reply as the identity, from its address, the draft kept under the conversation key');
    ok(html.includes('Clipped. Never says please.') && html.includes('from Rogue') && html.includes('data-op="deskContact" data-contact-id="mc-queen"'), 'the persona reads the inherited voice and can open the contact');
    ok(/ncm-msg2-dd__item is-on is-cur is-alias" data-action="tabAct" data-owner="messages" data-op="deskIdent" data-id="c:mc-queen"/.test(html) && html.includes('data-op="deskIdent" data-id="c:mc-rogue"') && html.includes('they wrote here'), 'Reply as ▾ lists the identities, the picked one lit, the one they wrote to marked');
    ok(!html.includes('ncm-msg2-desk__ids'), 'the persona no longer repeats the identity list');
    const bar = html.slice(html.indexOf('ncm-msg2-desk__bar'), html.indexOf('ncm-msg2-desk__who'));
    ok(!bar.includes('markAnswered') && bar.includes('ncm-msg2-desk__as') && bar.includes('<b>Queen of Hearts</b>') && bar.includes('ncm-msg2-sendbtn') && bar.includes('data-op="replyAnon"') && bar.includes('data-op="replyComposer"') && /class="nid">2</.test(html), 'one bar: "as <identity ▾> → to V", then Reply as whose ▾ shows the identity count and holds anonymous + the full composer');
    const hd = html.slice(html.indexOf('ncm-msg2-desk__hd'), html.indexOf('ncm-msg2-desk__feed'));
    ok(/class="ncm-msg2-desk__wait"[^>]*data-op="markAnswered"/.test(hd) && hd.includes('1 waiting') && hd.includes('Mark answered'), 'Mark answered lives on the waiting flag in the conversation head');
    ok((html.match(/data-op="deskIdent" data-id="c:mc-rogue"/g) || []).length === 2, 'the identity chip and the Reply ▾ open the same menu');
    ok(html.includes('data-op="deskFoldQ"') && html.includes('data-op="deskFoldP"'), 'both folds are reachable');
    ok(html.includes('data-op="markAnswered"') && html.includes('data-op="replyComposer"') && html.includes('data-action="openMsgInInbox" data-inbox-owner="rogue"'), 'mark answered, the full composer and the inbox are all reachable');
    ok(!html.includes('you are answering as someone else'), 'no warning while answering as the identity they wrote to');
  }
  {
    const html = render(ctxFor('rogue|q', 'all', { voiceEmpty: true }));
    ok(html.includes('No voice yet') && /is-empty/.test(html), 'an empty voice invites adding one');
  }
  {
    const c = ctxFor('rogue|q'); c.msg2.reply.desk.persona.wroteToIsPicked = false;
    ok(render(c).includes('you are answering as someone else'), 'answering as another identity warns in the persona');
  }
  {
    const html = render(ctxFor('rogue|q', 'all', { qShut: true }));
    ok(!bad(html) && html.includes('ncm-msg2-desk is-qshut') && html.includes('ncm-msg2-desk__rail') && !html.includes('ncm-msg2-desk__q"') && (html.match(/data-op="convSel"/g) || []).length === 3, 'the queue folds to a rail of faces that still pick a line');
    ok(/class="f is-sel"[^>]*data-key="rogue\|q"/.test(html) && /class="ct is-hot">1</.test(html), 'the rail marks the picked line and the hot wait');
  }
  {
    const html = render(ctxFor('rogue|q', 'all', { pShut: true }));
    ok(html.includes('is-pshut') && !html.includes('ncm-msg2-desk__who'), 'the persona folds away');
  }
  {
    const html = render(ctxFor('rogue|q', 'all', { quiet: false, anonOn: true }));
    ok(!html.includes('nobody has written to</div>') && html.includes('class="anon"') && html.includes('ncm-msg2-sendbtn is-anon') && html.includes('— anonymously'), 'quiet inboxes hidden unless asked for; anonymous tags the bar and recolours Reply');
  }
  {
    const html = render(ctxFor(null, 'all', { noDesk: true }));
    ok(!bad(html) && html.includes('Pick a line to answer it.') && !html.includes('ncm-msg2-desk__box'), 'nothing picked: a prompt, no reply box');
  }
  {
    const html = render(ctxFor('dex|', 'waiting', { noDesk: true }));
    ok(!html.includes('data-key="dex|"') && (html.match(/class="ncm-msg2-dq /g) || []).length === 2, 'the Waiting chip hides the answered row');
  }
  {
    const c = ctxFor(null, 'all', { noDesk: true }); c.msg2.reply.queue = M.deskQueue([], {}); c.msg2.reply.hasQueue = false; c.msg2.reply.linesWaiting = 0;
    const html = render(c);
    ok(!bad(html) && html.includes('Nothing waiting. Nice.') && html.includes('Nobody waiting'), 'an empty desk says so');
  }
}

console.log(`\ntest-messages-desk: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
