// Sim: the chat cards (the Esper readout, 2026-10-20). Started from the tester
// report on Share to Chat ("GM Intercept — Not visible to players" on a public
// message, body cut at 200 chars, HTML shown as tags). Drives the REAL
// MessageService.shareToChat / chatBodyHtml / splitChatBody, the REAL
// MessagesTab.onShareToChat, the REAL whisperCardHtml / postNetActionCard, and
// ChatCards.rowAffordance; renders the five REAL templates through Foundry's
// Handlebars; then static guards on the stylesheet and the retired pieces.
import { pathToFileURL } from 'url';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
const tpl = (name) => readFileSync(`${ROOT}/templates/chat/${name}.hbs`, 'utf8');
const compiled = {};
const render = (name, ctx) => { if (!Handlebars) return `<stub>${JSON.stringify(ctx)}</stub>`; compiled[name] ??= Handlebars.compile(tpl(name)); return compiled[name](ctx); };

const created = [];
let lastCtx = null;
globalThis.renderTemplate = async (path, ctx) => { lastCtx = ctx; return render(path.split('/').pop().replace('.hbs', ''), ctx); };
globalThis.ChatMessage = { create: async (d) => { created.push(d); return d; }, getSpeaker: ({ actor } = {}) => (actor ? { actor: actor.id, alias: actor.name } : { alias: 'GM' }) };
const master = [{ id: 'mc-rogue', name: 'Rogue', email: 'rogue@afterlife.nc', actorId: 'rogue', portrait: 'rogue.webp' }];
const settings = { dateFormat: 'DMY', dateMonthStyle: 'short', timeFormat: '24h' };
globalThis.game = {
  user: { id: 'u', isGM: true, name: 'Game Master', character: null },
  users: [{ id: 'u', isGM: true }],
  actors: { get: (id) => ({ v: { id: 'v', name: 'V', img: 'v.webp' }, rogue: { id: 'rogue', name: 'Rogue-Fixer', img: 'rf.webp' } })[id] || null },
  settings: { get: (m, k) => settings[k] },
  nightcity: {
    masterContactService: { getContact: (id) => master.find((c) => c.id === id) || null, getByActorId: (id) => master.find((c) => c.actorId === id) || null, getByEmail: (e) => master.find((c) => c.email === e) || null, isSendOnly: (e) => e === 'system@localhost' },
    timeService: { getCurrentTime: () => '2077-10-20T22:14:00.000Z' },
  },
  journal: [],
};
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: (m) => { throw new Error(m); } } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'id' } };
// NetResolve escapes through the Handlebars global Foundry provides
globalThis.Handlebars = Handlebars || { escapeExpression: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) };

const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);
const { MessagesTab } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/MessagesTab.js`).href);
const { whisperCardHtml, chatCardTime } = await import(pathToFileURL(`${ROOT}/scripts/utils/helpers.js`).href);
const { rowAffordance, rowIsContact } = await import(pathToFileURL(`${ROOT}/scripts/integrations/ChatCards.js`).href);
const { postNetActionCard } = await import(pathToFileURL(`${ROOT}/scripts/ui/content/NetResolve.js`).href);
const svc = Object.create(MessageService.prototype);

// ═══ chatBodyHtml ═══
ok(MessageService.chatBodyHtml('<p>Hi <b>V</b></p>') === '<p>Hi <b>V</b></p>', 'an HTML body passes through untouched');
ok(MessageService.chatBodyHtml('line one\nline two') === 'line one<br>line two', 'a plain-text body keeps its line breaks');
ok(MessageService.chatBodyHtml('a < b & c') === 'a &lt; b &amp; c', 'plain text is escaped, never rendered raw');
ok(MessageService.chatBodyHtml(null) === '', 'null-safe');

// ═══ splitChatBody — the fold ═══
const SHORT = '<p>Job is on. Afterlife, 23:00.</p><p>Do not be late.</p>';
const para = (n) => `<p>${'The job is simple and the pay is not. '.repeat(n).trim()}</p>`;
const LONG = para(8) + para(8) + para(8) + '<ul><li>Deck</li><li>Badge</li></ul>';   // ~930 chars of text
{
  const s = MessageService.splitChatBody(SHORT);
  ok(!s.isLong && s.head === SHORT && s.tail === '', 'a short body is not split');
  const l = MessageService.splitChatBody(LONG);
  ok(l.isLong && l.head === para(8) && l.tail === LONG.slice(para(8).length), 'a long body cuts after the first paragraph, never mid-tag');
  ok(l.moreLines >= 6 && l.moreLines <= 20, `the hidden-line estimate is sane (${l.moreLines})`);
  const manyBlocks = MessageService.splitChatBody('<p>a</p>'.repeat(10));
  ok(manyBlocks.isLong, 'many short paragraphs also fold (block count)');
  const plain = MessageService.splitChatBody(MessageService.chatBodyHtml('x'.repeat(800) + '\n' + 'y'.repeat(100)));
  ok(plain.isLong && plain.head.endsWith('<br>') && plain.tail.startsWith('y'), 'a plain-text body folds at its first line break');
}

// ═══ chatCardTime follows the GM's date settings ═══
ok(/^20 Oct 2077\b.*22:14$/.test(chatCardTime('2077-10-20T22:14:00.000Z')), `chatCardTime formats a stamp in the configured order/month style (${chatCardTime('2077-10-20T22:14:00.000Z')})`);
ok(chatCardTime() === chatCardTime('2077-10-20T22:14:00.000Z'), 'with no argument it reads the time provider');

// ═══ the player share ═══
{
  created.length = 0;
  await svc.shareToChat({
    messageId: 'm1', subject: 'Afterlife tonight', body: LONG, priority: 'urgent', timestamp: '2077-10-20T21:00:00.000Z',
    from: 'rogue@afterlife.nc', fromActorId: 'rogue', to: 'v@nightcity.net', toActorId: 'v', network: 'CitiNet',
  }, 'v');
  const html = created[0]?.content || '';
  const c = lastCtx;
  ok(created.length === 1 && !created[0].whisper, 'one public chat message');
  ok(html.includes('class="ncm-cc ') && html.includes('ncm-cc__rec') && html.includes('ncm-cc__hero'), 'it is the readout family');
  ok(html.includes(chatCardTime('2077-10-20T21:00:00.000Z')) && /20 Oct 2077/.test(html) && /21:00/.test(html), 'the record line prints the MESSAGE\'s own game-time stamp in the GM format');
  ok(html.includes('via V') && html.includes('CitiNet'), 'record line: via + network');
  ok(c.from.name === 'Rogue' && c.from.addr === 'rogue@afterlife.nc' && c.from.portrait === 'rogue.webp', 'From: directory name, address, directory portrait');
  ok(html.includes('data-ncm-email="rogue@afterlife.nc"') && html.includes('data-ncm-actor="rogue"') && html.includes('data-ncm-contact="mc-rogue"'), 'the From row carries the ids the add-contact hook needs');
  ok(html.includes('class="ncm-cc__slot"'), 'the rows carry an empty slot for the per-client affordance');
  ok(c.isLong && html.includes('<details class="ncm-cc__fold" open>') && html.includes(`${c.moreLines} more lines`) && html.includes('collapse'), 'a long body folds, OPEN by default');
  ok((html.match(/The job is simple and the pay is not\./g) || []).length === 24 && html.includes('<li>Badge</li>'), 'the WHOLE body ships as HTML');
  ok(html.includes('ncm-cc__flag">urgent'), 'priority is a flag line');
  ok(!/Intercept|Not visible/i.test(html), 'no intercept wording anywhere');
  // short body: no fold
  created.length = 0;
  await svc.shareToChat({ messageId: 'm2', subject: 's', body: SHORT, from: 'rogue@afterlife.nc', to: 'v@nightcity.net' }, 'v');
  ok(!lastCtx.isLong && !created[0].content.includes('<details'), 'a short body renders without a fold');
}
// masked anonymous: alias, no ids
{
  created.length = 0;
  await svc.shareToChat({ messageId: 'm3', subject: 's', body: 'b', from: 'unknown@void.net', fromActorId: 'rogue', to: 'v@nightcity.net', toActorId: 'v', anonymous: { enabled: true, alias: 'GHOST-7', role: 'sender' } }, 'v');
  const html = created[0].content;
  ok(lastCtx.from.name === 'GHOST-7' && !lastCtx.from.email && !lastCtx.from.actorId, 'a masked sender shares as its alias with NO ids');
  const p1 = html.indexOf('<div class="ncm-cc__p"'), p2 = html.indexOf('<div class="ncm-cc__p"', p1 + 1);
  const fromRow = html.slice(p1, p2);
  ok(p1 >= 0 && p2 > p1 && !/data-ncm-(email|actor|contact)=/.test(fromRow) && /GHOST-7/.test(fromRow), 'the masked From row carries no add-contact data (nothing to leak)');
}

// ═══ the admin share: same card, via GM ═══
{
  const page = { id: 'p1', name: 'Afterlife tonight', flags: { [MOD]: { messageId: 'm1', subject: 'Afterlife tonight', body: LONG, from: 'rogue@afterlife.nc', fromActorId: 'rogue', to: 'v@nightcity.net', toActorId: 'v', timestamp: '2077-10-20T21:00:00.000Z', status: {} } }, text: { content: LONG } };
  game.journal = [{ id: 'j1', name: 'V — Inbox', flags: { [MOD]: { type: 'inbox', actorId: 'v' } }, pages: [page] }];
  const tab = Object.create(MessagesTab.prototype);
  tab.app = { messageService: svc, messageRepository: null, masterContactService: game.nightcity.masterContactService };
  created.length = 0;
  await tab.onShareToChat({ preventDefault() {}, stopPropagation() {} }, { closest: () => ({ dataset: { messageId: 'm1' } }), dataset: {} });
  const html = created[0]?.content || '';
  ok(created.length === 1 && html.includes('ncm-cc--gm') && html.includes('via GM'), 'the admin share is the same card, GM-toned, "via GM"');
  ok((html.match(/The job is simple and the pay is not\./g) || []).length === 24 && !/Intercept|Not visible/i.test(html), 'whole body, no intercept header');
}

// ═══ rowAffordance — the per-client decision ═══
{
  const contacts = [{ email: 'rogue@afterlife.nc' }, { masterContactId: 'mc-kerry' }, { linkedActorId: 'panam' }];
  const o = { viewerActorId: 'v', contacts, isSendOnly: (e) => e === 'system@localhost' };
  ok(rowAffordance({ email: 'judy@mox.nc', actorId: 'judy' }, o) === 'add', 'a stranger → Add');
  ok(rowAffordance({ email: 'ROGUE@afterlife.nc' }, o) === 'in', 'known by address (case-insensitive) → in contacts');
  ok(rowAffordance({ contactId: 'mc-kerry', email: 'k@x' }, o) === 'in', 'known by directory id → in contacts');
  ok(rowAffordance({ actorId: 'panam', email: 'p@x' }, o) === 'in', 'known by linked actor → in contacts');
  ok(rowAffordance({ email: 'v@nightcity.net', actorId: 'v' }, o) === null, 'yourself → nothing');
  ok(rowAffordance({ email: 'system@localhost' }, o) === null, 'a send-only address → nothing');
  ok(rowAffordance({ email: 'a@x, b@y' }, o) === null, 'a group copy\'s joined address → nothing');
  ok(rowAffordance({ name: 'GHOST-7' }, o) === null, 'a row with no ids (masked) → nothing');
  ok(rowIsContact(contacts, { email: 'rogue@afterlife.nc' }) && !rowIsContact(contacts, { email: 'x@y' }), 'rowIsContact matches the three keys');
}

// ═══ the other templates render in the family ═══
if (Handlebars) {
  const hack = render('hack-result', { actorName: 'V', skillName: 'Interface', statName: 'TECH', statValue: 7, skillLevel: 4, rollValue: 10, processedRoll: 17, rollChanged: true, total: 28, dc: 19, success: true, isCritical: true, marginAbs: 9, contextLine: 'siphon', when: '20 Oct 2077 22:43', networkDisplay: 'Arasaka Subnet' });
  ok(hack.includes('ncm-cc--ok') && hack.includes('ncm-cc__num">28<small>/ 19') && hack.includes('Passed by 9') && hack.includes('10 <small>→ 17') && hack.includes('critical, exploding 10'), 'hack-result: total in the brackets, verdict in words, die shown raw → processed, crit flag');
  const fail = render('hack-result', { actorName: 'V', skillName: 'Interface', statName: 'TECH', statValue: 6, skillLevel: 2, rollValue: 1, processedRoll: -6, rollChanged: true, total: 4, dc: 16, success: false, isFumble: true, luckSpent: 2, marginAbs: 12, when: 'w', networkDisplay: 'n' });
  ok(fail.includes('ncm-cc--fail') && fail.includes('Failed by 12') && fail.includes('fumble, subtractive 1') && fail.includes('Luck') && fail.includes('+2'), 'hack-result: fail tone, fumble flag, Luck readout');
  const ice = render('ice-retaliation', { iceName: 'Hellhound', iceImg: 'ice.webp', iceClassDisplay: 'BLACK ICE · ATK 6', actorName: 'V', damage: 11, rollLine: 'ATK 6 + 1d10 (5)', hpBefore: 35, hpAfter: 24, contextLabel: 'Data Shard', networkDisplay: 'Arasaka Subnet', when: 'w' });
  ok(ice.includes('ncm-cc--ice') && ice.includes('ncm-cc__num">11<') && ice.includes('damage to V') && ice.includes('HP before') && ice.includes('>24<'), 'ice-retaliation: damage in the brackets, HP before/after readouts');
  const mal = render('malware-analysis', { actorName: 'V', source: 'promo@bangme.nc', subject: 'FREE braindance', malwareType: 'Worm', when: 'w', networkDisplay: 'CitiNet' });
  ok(mal.includes('ncm-cc--mal') && mal.includes('ncm-cc__whisper">GM only') && mal.includes('Worm<small>in “FREE braindance”'), 'malware-analysis: violet, GM-only strip, finding as the hero');
  const bc = render('network-broadcast', { networkName: 'CitiNet', message: 'Curfew in Watson', when: 'w' });
  ok(bc.includes('Network notice') && bc.includes('Curfew in Watson') && bc.includes('ncm-cc__hero'), 'network-broadcast: the notice is the hero');
  for (const [n, h] of Object.entries({ hack, fail, ice, mal, bc })) ok(!/ncm-cc__(header|badge|body|footer|scanline|whisper">Whispered|msg-body)|ncm-ice-card|ncm-payload-card/.test(h), `${n}: no legacy classes`);
}

// ═══ the JS-built cards join the family ═══
{
  const w = whisperCardHtml({ tone: 'warn', title: 'NCM trace', lines: ['A trace is closing in on <b>V</b>.', '<span class="ncm-cc__sub">Heat 35 → 55</span>'] });
  ok(w.startsWith('<div class="ncm-cc ncm-cc--gm">') && w.includes('ncm-cc__rec') && w.includes('ncm-cc__whisper">GM only') && w.includes('ncm-cc__line">A trace') && !w.includes('ncm-wcard'), 'whisperCardHtml emits the family (amber, GM only, lines)');
  ok(whisperCardHtml({ tone: 'danger' }).includes('ncm-cc--fail') && whisperCardHtml({ tone: 'ok' }).includes('ncm-cc--ok') && whisperCardHtml({ tone: 'purple' }).includes('ncm-cc--mal'), 'whisper tones map onto the family');
  created.length = 0;
  postNetActionCard({ verb: 'Backdoor', title: 'a breach', actorName: 'V', hostName: 'Arasaka node', skill: 'Interface', dv: 15, total: 19, ok: true });
  const n = created[0]?.content || '';
  ok(created[0]?.whisper?.length === 1 && n.includes('ncm-cc ncm-cc--ok') && n.includes('NET action') && n.includes('<span>Backdoor</span>') && n.includes('ncm-cc__num">19<small>/ 15') && n.includes('Passed') && !n.includes('ncm-netcard'), 'postNetActionCard emits the family (GM whisper, total in brackets)');
}

// ═══ static guards ═══
{
  const css = readFileSync(`${ROOT}/styles/chat/chat-cards.css`, 'utf8');
  const bare = (css.replace(/var\([^)]*\)/g, '').match(/#[0-9a-f]{3,8}\b/gi) || []).filter((h) => h.toLowerCase() !== '#000');
  ok(bare.length === 0, `every colour in chat-cards.css is a token with a fallback (bare: ${bare.join(', ') || 'none'})`);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/ncm-ice-card|ncm-payload-card|ncm-wcard|ncm-netcard|scanline|border-left: 3px/.test(rules), 'no legacy card vocabulary, no accent bar, no scanline film (rules, not comments)');
  ok(!/\.ncm-netcard/.test(readFileSync(`${ROOT}/styles/components/net-adjudicator.css`, 'utf8')), 'the old Tier B card rules are gone');
  for (const t of ['network-event', 'payload-executed', 'intercepted-message']) ok(!existsSync(`${ROOT}/templates/chat/${t}.hbs`), `${t}.hbs is deleted`);
  const consts = readFileSync(`${ROOT}/scripts/utils/constants.js`, 'utf8');
  ok(!/CHAT_NETWORK_EVENT|CHAT_PAYLOAD_EXECUTED|CHAT_INTERCEPTED_MSG/.test(consts), 'their TEMPLATES entries are gone (a preload of a missing file would 404)');
  ok(/registerChatCardHooks\(\)/.test(readFileSync(`${ROOT}/scripts/init/registerMessagingSystem.js`, 'utf8')), 'the add-contact hook is registered with the messaging wiring');
  for (const [f, re] of [['scripts/services/SkillService.js', /when: chatCardTime\(\)/], ['scripts/services/ICEService.js', /hpBefore: currentHP/], ['scripts/ui/MessageViewer/MessageViewerApp.js', /when: chatCardTime\(\)/], ['scripts/ui/AdminPanel/tabs/NetworksTab.js', /when: chatCardTime\(\)/]]) {
    ok(re.test(readFileSync(`${ROOT}/${f}`, 'utf8')), `${f} feeds the new template fields`);
  }
  const mt = readFileSync(`${ROOT}/scripts/ui/AdminPanel/tabs/MessagesTab.js`, 'utf8');
  const handler = mt.slice(mt.indexOf('async onShareToChat('), mt.indexOf('\n  }\n', mt.indexOf('async onShareToChat(')));
  ok(!/renderTemplate|ChatMessage\.create|slice\(0, 200\)/.test(handler) && /shareToChat\?\.\(message, null, \{ sharedBy: 'GM' \}\)/.test(handler), 'the admin handler calls the service, never its own card');
  ok(!/ncm-wcard__line--sub/.test(readFileSync(`${ROOT}/scripts/services/TraceService.js`, 'utf8') + readFileSync(`${ROOT}/scripts/ui/AdminPanel/tabs/SecurityTab.js`, 'utf8')), 'the whisper builders use the family\'s sub-line class');
  if (!Handlebars) { fail++; console.error('FAIL: Handlebars not found in a Foundry install — the render checks ran against a stub'); }
}

console.log(`\ntest-chat-cards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
