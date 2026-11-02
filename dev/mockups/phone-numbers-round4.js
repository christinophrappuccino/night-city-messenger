/* Round 4 mock: overheard NPC calls (phase 6). Not wired to the module. The call screen is the REAL CallHud. */
const q0 = new URLSearchParams(location.search);
const { ScopePicker, showNamePicker, CallHud } = window.NCM_PICK;
const hueOf = (s) => { let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return `var(--ncm-hue-${(h % 8) + 1})`; };
const initials = (s) => String(s).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const tagp = (t, tone, ic, tip) => `<span class="ncm-tagp ${tone}"${tip ? ` data-tooltip="${esc(tip)}"` : ''}>${ic ? `<i class="fas ${ic}"></i> ` : ''}${esc(t)}</span>`;
const hv = (t, ic) => (t ? `<span class="ncm-pn-hv" style="--tc:${hueOf(t)}">${ic ? `<i class="fas ${ic}"></i>` : ''}${esc(t)}</span>` : '');
const btn = (label, icon, tip, attrs = '', mod = '') => `<button type="button" class="ncm-ph2-btn${mod ? mod.split(' ').map((m) => ' ncm-ph2-btn--' + m).join('') : ''}" data-tooltip="${esc(tip)}"${label ? '' : ` aria-label="${esc(tip)}"`} ${attrs}>${icon ? `<i class="fas ${icon}"></i>` : ''}${label ? ' ' + esc(label) : ''}</button>`;
const opt = (v, t, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(t)}</option>`;
const seg = (act, k, cur, opts) => `<div class="ncm-pn-seg" role="group">${opts.map(([v, t, h]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-do="${act}" data-k="${k}" data-v="${esc(v)}" data-tooltip="${esc(h)}">${esc(t)}</button>`).join('')}</div>`;
const band = (ic, t, tone, sub = '') => `<div class="ncm-pn-band" style="--sk:${tone}"><i class="fas ${ic}"></i> ${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
const sect = (ic, t, tone, body, sub) => `<div class="ncm-pn-sect">${band(ic, t, tone, sub)}<div class="in">${body}</div></div>`;
const face = (n, cls = '') => `<span class="ncm-pn-face ${cls}" style="--tc:${hueOf(n)}">${esc(initials(n))}</span>`;
const flow = (steps) => `<div class="ncm-r3-flow">${steps.map(([t, d], i) => `<div class="st"><span class="n">${i + 1}</span><b>${esc(t)}</b><small>${esc(d)}</small></div>`).join('')}</div>`;
const inner = (tabs) => `<div class="ncm-pn-inner" role="tablist">${tabs.map(([f, l, ic, tip]) => `<button type="button" role="tab" aria-selected="${S.f === f}" class="${S.f === f ? 'on' : ''}" data-do="frame" data-f="${f}" data-tooltip="${esc(tip)}"><i class="fas ${ic}"></i> ${esc(l)}</button>`).join('')}</div>`;
const backTo = (f, label) => btn(label, 'fa-arrow-left', 'Back', `data-do="go" data-f="${f}"`);
const undoLine = () => (S.undo ? `<div class="ncm-pn-undo"><i class="fas fa-check"></i><span class="grow">${esc(S.undo.text)}</span>${S.undo.fn ? btn('Undo', 'fa-rotate-left', 'Take it back', 'data-do="undo"') : ''}<button type="button" data-do="undoClose" aria-label="Dismiss" data-tooltip="Dismiss"><i class="fas fa-xmark"></i></button></div>` : '');

/* ─── the world ─── */
const NPCS = ['Rogue', 'Silver', 'Marcus Vance', 'Haruka Mori', 'Tess Valdez', 'Harlan Cole', 'Judy Alvarez', 'Lena Ruiz', 'Dr. Ortega', 'Mama Okoye', 'Sister Anne', 'Nix', 'Cal Brandt', 'Ozzie Fenn', 'Ada Kovac', 'Bram Oyelaran', 'Cass Moreno', 'Dita Vance', 'Eli Sato', 'Faye Lindqvist', 'Gus Ramirez', 'Hana Ito', 'Ivo Petrov', 'Jun Park'];
const npcItems = () => NPCS.map((n) => ({ id: n, name: n, group: n === 'Silver' ? 'Aliases' : 'NPCs', icon: n === 'Silver' ? 'fa-mask' : 'fa-user-tie', meta: n === 'Silver' ? 'alias of Rogue' : '' }));
const SCENES = ['Off-screen', 'Afterlife', 'Pier 4', 'Kabuki Night Market', 'Militech Tower, 40th floor', 'Watson clinic'];
const NETS = ['CitiNet', 'Afterlife Darknet', 'Militech Secure', 'NCPD Net'];
const l = (side, text, voice = '', delay = 1, marks = []) => ({ id: Math.random().toString(36).slice(2, 8), side, text, voice, delay, marks });
const LIB = [
  { id: 'pier', name: 'The Pier 4 shipment', tag: 'Job hook', a: 'Rogue', b: 'Marcus Vance', aLoc: 'Pier 4', bLoc: 'Off-screen', net: 'CitiNet', at: '', lines: [l('a', 'The shipment moved. Pier 4, midnight.', '', 1, ['clue']), l('b', 'Who else knows about this?'), l('a', 'Nobody. You have my word.', '', 2, ['lie']), Object.assign(l('b', 'Tell the gardener the crows are nesting early.', '', 1, ['code']), { means: 'Get rid of the witness tonight.' }), l('a', 'Understood. Burn this line after tonight.'), l('b', 'Already done. Do not call again.')] },
  { id: 'fixer', name: 'Fixer checks a rumour', tag: 'Rumour', a: 'Rogue', b: 'Nix', aLoc: 'Afterlife', bLoc: 'Kabuki Night Market', net: 'Afterlife Darknet', at: '', lines: [l('a', 'Heard your crew hit the clinic.'), l('b', 'Not us. Ask the Maelstrom.', '', 1, ['lie'])] },
  { id: 'exec', name: 'Exec threatens a witness', tag: 'Threat', a: 'Haruka Mori', b: 'Dr. Ortega', aLoc: 'Militech Tower, 40th floor', bLoc: 'Watson clinic', net: 'Militech Secure', at: 'Tonight, 23:00', lines: [l('a', 'You saw nothing at the Tower.'), l('b', 'I saw what I saw.'), l('a', 'Your daughter starts school on Monday, yes?')] },
  { id: 'cop', name: 'Dirty cop gets a tip', tag: 'Corruption', a: 'Cal Brandt', b: 'Ozzie Fenn', aLoc: 'Off-screen', bLoc: 'Off-screen', net: 'NCPD Net', at: '', lines: [l('a', 'Raid is Thursday. Move your stock.', '', 1, ['clue']), l('b', 'Same price as last time?')] },
  { id: 'ripper', name: 'Ripperdoc wants payment', tag: 'Rumour', a: 'Dr. Ortega', b: 'Mama Okoye', aLoc: 'Watson clinic', bLoc: 'Off-screen', net: 'CitiNet', at: '', lines: [l('a', 'Your friend still owes me for the arm.'), l('b', 'He is good for it.', '', 1, ['lie'])] },
];
/* where the players are right now: the real build reads tokens, taps and node sessions */
const WORLD = {
  'Veronica A.': { scene: 'Pier 4', dist: 14, tap: { node: 'Pier 4 relay', net: 'CitiNet', scene: 'Pier 4' } },
  Rache: { scene: 'Pier 4', dist: 5 },
  'Kid Static': { scene: 'Pier 4', dist: 20, jack: { node: 'Pier 4 relay', net: 'CitiNet', scene: 'Pier 4' } },
  'Dex Moreno': { scene: 'Afterlife', dist: 0 },
};
const WAYS = {
  room: { label: 'In the room', icon: 'fa-person-rays', garble: 0, tip: 'Near one side. Hears that side only, clean. No roll.' },
  tap: { label: 'A tap on a node', icon: 'fa-plug', garble: 55, tip: 'Both sides, live. Garbled by signal and by how well the tap was made.' },
  jack: { label: 'Jacked in', icon: 'fa-network-wired', garble: 30, tip: 'A node session action, Listen to traffic. A roll and a move. Both sides.' },
  scanner: { label: 'A radio scanner', icon: 'fa-tower-observation', garble: 75, tip: 'Gear. Calls on this scene with no node. Heavier garble. Both sides.' },
};
let LISTENERS = [{ id: 'v', name: 'Veronica A.', via: 'tap', detail: 'Tap on the Pier 4 relay', garble: 55, line: 0 }, { id: 'ra', name: 'Rache', via: 'room', side: 'a', detail: 'In the room with Rogue, so one side only', garble: 0, line: 1 }];
const GEAR = itemEntries();
const syncScan = () => { if (!hasItem(S.asChar, RULES.scanner)) S.ways.delete('scanner'); };
const RULES = { room: 'tokens', range: 6, amp: ['Amplified Hearing'], scanner: ['Radio Scanner/Music Player', 'Radio Scanner (Cyberaudio)'], desc: ['Scrambler/Descrambler'], stress: ['Voice Stress Analyzer'], skill: 'Interface', dv: 15, jackDv: 11, records: true };

const S = { f: q0.get('f') || 'home', running: true, callId: 'pier', howOpen: true, clq: '', clShow: 'all', cutIds: new Set(), waySince: {}, clickAt: null, back: 'run', w: q0.get('w') === 'pop' ? 'pop' : 'panel', t: q0.get('t') || 'clean-dark', a: 'Rogue', b: 'Marcus Vance', aLoc: 'Pier 4', bLoc: 'Off-screen', net: 'CitiNet', aId: 'name', bId: 'number', aVoice: 'text', bVoice: 'tts', delivery: 'script', when: 'now', rec: true, enc: false, lines: LIB[0].lines.map((x) => ({ ...x })), script: 'pier', lq: '', lshow: 'all', idx: 2, playing: false, ended: false, ways: new Set(['tap']), enhance: 0, sideRoom: 'a', saved: false, asChar: q0.get('as') || 'Veronica A.', stStep: Number(q0.get('step')) || 1, lnOpen: null, wOpen: new Set(['room']), gearOpen: false, noticeOpen: false, scanned: false, jackList: false, undo: null, clickSent: false };

/* ─── the pure rules: garble decided before anything reaches a listener ─── */
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
/** The real word never reaches the page for a word this listener has not earned. Each word has a fixed threshold, so lowering the garble only ever reveals more. */
function garbleText(id, text, level) {
  if (level <= 0) return esc(text);
  return text.split(/(\s+)/).map((w, i) => { if (/^\s*$/.test(w)) return w; const cut = (hash(id + ':' + i) % 100); return cut < level ? `<span class="ncm-r4-gl">${'▒░▓▒░'.repeat(2).slice(0, Math.max(2, w.length))}</span>` : esc(w); }).join('');
}
/** Best per side wins. null means this listener cannot hear that side at all. */
function garbleFor(side, i = S.idx) {
  const options = [];
  for (const k of S.ways) { if ((S.waySince[k] || 0) > i) continue; if (k === 'room' && S.sideRoom !== side) continue; let g = WAYS[k].garble; if (S.enc && k !== 'room') g = hasItem(S.asChar, RULES.desc) ? g : 100; options.push(g); }
  if (!options.length) return null;
  return Math.max(0, Math.min(...options) - (S.enhance && Math.min(...options) < 100 ? S.enhance : 0));
}
/** Every way in this character has for this call, or why they have none. Reads the sheet, the map, their taps and their node session. */
function waysFor(who, c = S) {
  const w = WORLD[who], out = [], why = [], here = w.scene === c.aLoc ? 'a' : w.scene === c.bLoc ? 'b' : null, near = here === 'a' ? c.a : c.b;
  const clearOk = !c.enc || hasItem(who, RULES.desc);
  const carried = (x) => x && x.net === c.net && [c.aLoc, c.bLoc].includes(x.scene);
  if (!here) why.push('Not on a scene with ' + c.a + ' or ' + c.b);
  else { const range = RULES.range * (hasItem(who, RULES.amp) ? 2 : 1); if (RULES.room === 'scene' || w.dist <= range) out.push({ k: 'room', side: here, text: (RULES.room === 'scene' ? 'On the scene with ' : w.dist + ' squares from ') + near + ', so one side only' }); else why.push(w.dist + ' squares from ' + near + ', and they need to be within ' + range); }
  const viaNet = (k, x, text, none) => { if (carried(x)) { if (clearOk) out.push({ k, text }); else why.push(none + ", but it's encrypted and they have no descrambler"); } };
  viaNet('tap', w.tap, 'Tap on the ' + w.tap?.node, 'Has a tap on the ' + w.tap?.node);
  viaNet('jack', w.jack, 'Jacked into the ' + w.jack?.node + ': a roll and a move', 'Jacked into the ' + w.jack?.node);
  if (here && hasItem(who, RULES.scanner)) { if (clearOk) out.push({ k: 'scanner', text: 'Radio scanner on this scene' }); else why.push("Has a scanner, but it's encrypted and they have no descrambler"); }
  if (!w.tap && !w.jack && !out.some((x) => x.k === 'scanner') && !why.some((x) => x.startsWith('Has a scanner'))) why.push('No tap, no node session and no scanner');
  else if (w.tap && !carried(w.tap)) why.push('Their tap is not on a node this call goes through');
  else if (w.jack && !carried(w.jack)) why.push('Their node session is not on this call');
  return { ways: out, why };
}
const couldCount = (c = S) => Object.keys(WORLD).filter((n) => waysFor(n, c).ways.length).length;
const nameOf = (side) => (side === 'a' ? S.a : S.b);
function callerLabel() { for (const sd of ['a', 'b']) { if (garbleFor(sd) === null) continue; const m = sd === 'a' ? S.aId : S.bId; if (m === 'name') return nameOf(sd); if (m === 'number') return '+72 NC NHW-2087'; } return 'Unknown caller'; }

/* ─── the REAL call screen ─── */
const NET = { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', strength: 78, color: '#19f3f7' };
const hudService = { calls: new Map(), usableModes: [], offeredModes: [], modeFor: () => 'loud', _get: (k, d) => d };
const HUD = new CallHud(hudService); HUD._other = (c) => c.from; let hudN = 0;
function interceptCard() {
  const id = 'r4c' + (++hudN), now = Date.now();
  const call = { id, from: { name: callerLabel(), number: '', img: 'NOFACE', contactId: null }, to: { userId: 'u1', name: 'V', number: '', kind: 'player' }, net: { ...NET, name: S.net }, mode: 'loud', state: 'live', startedAt: now - 2300, answeredAt: now - 48000, endedAt: null, outcome: null };
  hudService.calls.set(id, call);
  let html = HUD._callHtml({ call, role: 'callee' }, {});
  html = html.replaceAll('Holocall', 'Intercept').replace('Hang up', 'Stop listening');
  html = html.replace('<img src="NOFACE" alt="">', `<span class="ncm-ch-ini" aria-hidden="true"><span class="sw"><span class="tr"></span><span class="dot"></span><span class="dot b"></span></span><b><i class="fas fa-ear-listen"></i></b></span>`);
  return `<div class="ncm-call-hud ncm-r3-hud" style="--ch-ring:#F65261;--ch-live:#b87aff;--ch-key:#f7c948">${html}</div>`;
}
const hudT0 = performance.now();
setInterval(() => { const t = performance.now() - hudT0; document.querySelectorAll('.ncm-r3-hud .ncm-ch-badge').forEach((b) => HUD._paintBadge(b, t)); }, 120);
/** Subtitles in the real .ncm-ch-sub markup. */
function subsHtml() {
  if (S.ended) return '<div class="ncm-ch-sublines"><div class="ncm-ch-sub typing">The call has ended.</div></div>';
  if (!S.ways.size) return '<div class="ncm-ch-sublines"><div class="ncm-ch-sub typing">You are not listening to anything.</div></div>';
  const first = Math.min(...[...S.ways].map((k) => S.waySince[k] || 0)), from = Math.max(first, S.idx - 3);
  const rows = S.lines.slice(from, S.idx + 1).map((x, n) => { const i = from + n, g = garbleFor(x.side, i), last = i === S.idx; const clickNote = S.clickAt === i ? '<div class="ncm-ch-sub typing">A click on the line.</div>' : ''; if (g === null) return `<div class="ncm-ch-sub${last ? ' now' : ''}" data-line="${x.id}"><b>Other side:</b><span class="tx ncm-r4-none">[can't hear this side]</span></div>${clickNote}`; const flag = hasItem(S.asChar, RULES.stress) && x.marks.includes('lie') && g < 100 ? '<span class="ncm-r4-stress"><i class="fas fa-wave-square"></i> voice stress</span>' : ''; const who = (x.side === 'a' ? S.aId : S.bId) === 'name' ? nameOf(x.side) : (x.side === 'a' ? 'Side A' : 'Side B'); return `<div class="ncm-ch-sub${last ? ' now' : ''}" data-line="${x.id}"><b>${esc(who)}:</b><span class="tx">${garbleText(x.id, x.text, g)}</span>${flag}</div>${clickNote}`; }).join('');
  return '<div class="ncm-ch-sublines">' + (first > 0 && from === first ? `<div class="ncm-ch-sub typing">Picked up on line ${first + 1}. Earlier lines were missed.</div>` : '') + rows + '</div>';
}
/* The real call's type-out (CallHud._renderSubs): same speed, same caret. Garbled words stay garbled while they type: the real word is never on the page. */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function typeIn(el) {
  if (reduced()) return;
  const tx = el?.querySelector('.tx'); if (!tx) return;
  const parts = [...tx.childNodes].map((n) => ({ text: n.textContent, cls: n.nodeType === 1 ? n.className : '' }));
  const plain = parts.map((p) => p.text).join(''); const ms = window.NCM_PICK.typeOutMs(plain), t0 = performance.now();
  const paint = (k) => { tx.textContent = ''; let left = k; for (const p of parts) { if (left <= 0) break; const piece = p.text.slice(0, left); left -= piece.length; if (p.cls) { const sp = document.createElement('span'); sp.className = p.cls; sp.textContent = piece; tx.appendChild(sp); } else tx.appendChild(document.createTextNode(piece)); } };
  paint(0); tx.insertAdjacentHTML('afterend', '<span class="caret"></span>');
  const done = () => { if (tx.isConnected) { paint(plain.length); el.querySelector('.caret')?.remove(); } };
  const tick = (now) => { if (!tx.isConnected) return; const k = Math.ceil(Math.min(1, (now - t0) / ms) * plain.length); paint(k); if (k < plain.length) requestAnimationFrame(tick); else done(); };
  requestAnimationFrame(tick); setTimeout(done, ms + 200);
}
function typeFresh() { const id = S.fresh; if (!id) return; S.fresh = null; document.querySelectorAll(`[data-line="${id}"]`).forEach(typeIn); }

/* ─── Stage a call ─── */
ScopePicker.on('sa', () => { const v = ScopePicker.value('sa')[0]; if (v && v !== S.a) { S.a = v; draw(); } });
ScopePicker.on('sb', () => { const v = ScopePicker.value('sb')[0]; if (v && v !== S.b) { S.b = v; draw(); } });
ScopePicker.on('lib', () => { const v = ScopePicker.value('lib')[0]; if (v && v !== S.script) { const x = LIB.find((y) => y.id === v); S.script = v; S.lines = x.lines.map((y) => ({ ...y })); S.idx = 0; draw(); } });
const VOICES = [['', 'Side default', 'What this side uses unless you say otherwise'], ['text', 'Text', 'Subtitles, typed out'], ['tts', 'Read out', 'The browser reads it aloud, with subtitles'], ['audio', 'Recorded', 'A clip you record or upload. Its text is the subtitle']];
const MARKS = { clue: ['Clue', 'is-good', 'fa-key', 'The line that matters. Only you see this mark, and the running screen counts who has heard it'], lie: ['Lie', 'is-bad', 'fa-wave-square', 'A listener with a voice stress analyzer sees this line flagged. Nobody else can tell'], code: ['Code word', 'is-secret', 'fa-user-secret', 'Listeners hear the words as written. Only you see what it really means'] };
const VOICE_WORD = { '': 'Side default', text: 'Text', tts: 'Read out', audio: 'Recorded' };
function stageSummary() { const lines = S.lines.length; return `<b>${esc(S.a)}</b> <small>${esc(S.aLoc)}</small> <i class="fas fa-arrows-left-right"></i> <b>${esc(S.b)}</b> <small>${esc(S.bLoc)}</small> <span class="grow"></span> ${hv(S.net, 'fa-tower-cell')} <small>${S.delivery === 'live' ? 'You speak live' : lines + ' line' + (lines === 1 ? '' : 's')}</small>`; }
function stageWho() {
  const side = (s, loc, id, voice, pick, label, tone) => { ScopePicker.set(pick, [s]); return sect('fa-phone', label, tone, `<div class="ncm-pn-f" data-tooltip="Any NPC or alias"><span>Who</span>${ScopePicker.html(pick, { noun: 'person', nouns: 'people', icon: 'fa-user', items: npcItems() })}</div><label class="ncm-pn-f" data-tooltip="Players near them can overhear this side">Where they are<select id="${pick}-loc" data-ch="setS" data-k="${pick === 'sa' ? 'aLoc' : 'bLoc'}">${SCENES.map((x) => opt(x, x, loc === x)).join('')}</select></label><label class="ncm-pn-f" data-tooltip="What a listener can tell about them. A Trace still works">Listeners see<select id="${pick}-id" data-ch="setS" data-k="${pick === 'sa' ? 'aId' : 'bId'}">${[['name', 'Their name'], ['number', 'Their number'], ['anon', 'Nothing, withheld']].map(([v, t]) => opt(v, t, id === v)).join('')}</select></label><label class="ncm-pn-f" data-tooltip="How their lines play unless a line says otherwise">Their voice<select id="${pick}-v" data-ch="setS" data-k="${pick === 'sa' ? 'aVoice' : 'bVoice'}">${VOICES.slice(1).map(([v, t]) => opt(v, t, voice === v)).join('')}</select></label>`); };
  return `<div class="ncm-r4-sides">${side(S.a, S.aLoc, S.aId, S.aVoice, 'sa', 'First person', 'var(--ncm-act)')}${side(S.b, S.bLoc, S.bId, S.bVoice, 'sb', 'Second person', 'var(--ncm-hue-1)')}</div>
    <label class="ncm-pn-f" data-tooltip="Taps on this network's nodes can hear it">Network the call goes over<select id="st-net" data-ch="setS" data-k="net">${NETS.map((x) => opt(x, x, S.net === x)).join('')}</select></label>`;
}
function stageSay() {
  ScopePicker.set('lib', [S.script]);
  const libPick = ScopePicker.html('lib', { noun: 'script', nouns: 'scripts', icon: 'fa-scroll', items: LIB.map((x) => ({ id: x.id, name: x.name, group: x.tag, icon: 'fa-scroll', meta: x.lines.length + ' lines · ' + x.lines.map((y) => y.text).join(' ') })) });
  const q = S.lq.trim().toLowerCase();
  const list = S.lines.map((x, i) => ({ x, i })).filter(({ x }) => (!q || x.text.toLowerCase().includes(q)) && (S.lshow === 'all' || (S.lshow === 'a' || S.lshow === 'b' ? x.side === S.lshow : x.marks.includes(S.lshow))));
  const row = ({ x, i }) => { const open = S.lnOpen === i; return `<div class="ncm-r4-line${open ? ' is-open' : ''}"><div class="top"><span class="n">${i + 1}</span><button type="button" class="ncm-r4-side is-${x.side}" data-do="lnSide" data-i="${i}" data-tooltip="Switch who says this">${esc(initials(nameOf(x.side)))}</button><input type="text" id="ln-${i}" data-in="lnText" data-i="${i}" value="${esc(x.text)}" aria-label="Line ${i + 1}" data-tooltip="The text is always there: subtitles, the transcript, what a tap copies">${x.marks.map((k) => tagp(MARKS[k][0], MARKS[k][1], MARKS[k][2], MARKS[k][3])).join('')}<button type="button" class="ncm-r4-more" data-do="lnOpen" data-i="${i}" aria-expanded="${open}" data-tooltip="Voice, timing and marks for this line"><i class="fas fa-sliders"></i></button>${btn('', 'fa-trash', 'Delete this line', `data-do="lnDel" data-i="${i}"`, 'ic bad')}</div>${open ? `<div class="det"><label class="ncm-pn-f" data-tooltip="How this line plays">Voice<select id="lnv-${i}" data-ch="lnVoice" data-i="${i}">${VOICES.map(([v, t]) => opt(v, t, x.voice === v)).join('')}</select></label>${x.voice === 'audio' ? btn('Record', 'fa-microphone', 'Record or upload this line', 'data-do="toast" data-msg="Uses the voicemail recorder"') : ''}<label class="ncm-pn-f" data-tooltip="Seconds of quiet before this line">Wait<input type="number" id="lnd-${i}" min="0" max="30" data-ch="lnDelay" data-i="${i}" value="${x.delay}" style="width:60px"></label><div class="ncm-pn-f"><span>Marks</span><span class="marks">${Object.entries(MARKS).map(([k, [t, tone, ic, h]]) => `<button type="button" class="ncm-r4-markb${x.marks.includes(k) ? ' on' : ''}" data-do="lnMark" data-i="${i}" data-k="${k}" aria-pressed="${x.marks.includes(k)}" data-tooltip="${esc(h)}"><i class="fas ${ic}"></i> ${t}</button>`).join('')}</span></div>${x.marks.includes('code') ? `<label class="ncm-pn-f ncm-r4-means" data-tooltip="Listeners never see this">What it really means<input type="text" id="lnm-${i}" data-in="lnMeans" data-i="${i}" value="${esc(x.means || '')}" placeholder="Only you see this"></label>` : ''}</div>` : ''}</div>`; };
  return `<div class="ncm-pn-fr"><div class="ncm-pn-f"><span data-tooltip="Written ahead and played out, or you speak for both sides as it happens">How it plays</span>${seg('setV', 'delivery', S.delivery, [['script', 'From a script', 'Lines are written ahead and play in real time'], ['live', 'I type it live', 'You speak for both sides from the call screen']])}</div>${S.delivery === 'script' ? `<span class="ncm-pn-f grow" data-tooltip="Reusable scripts. Search names, tags and what is said"><span>Start from</span>${libPick}</span>${btn('Save', 'fa-floppy-disk', 'Add this script to the library', 'data-do="libSave"')}${btn('', 'fa-file-export', 'Export the library', 'data-do="toast" data-msg="Downloads the library as JSON"', 'ic')}${btn('', 'fa-file-import', 'Import scripts. You see every change first', 'data-do="toast" data-msg="Plan-first import"', 'ic')}` : ''}</div>
    ${S.delivery === 'live' ? '<div class="ncm-pn-check info"><i class="fas fa-keyboard"></i><span>Once it starts, the call screen gets a side switch and a text box. Each line can be text, read out, or held to record.</span></div>' : `<div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Find a line"><i class="fas fa-magnifying-glass"></i><input type="text" id="ln-q" data-in="lq" value="${esc(S.lq)}" placeholder="Find a line" aria-label="Find a line"></label><label class="ncm-pn-sel" data-tooltip="Narrow the lines"><span>Show</span><select id="ln-show" data-ch="lshow">${[['all', 'All lines'], ['a', S.a], ['b', S.b], ['clue', 'Clues'], ['lie', 'Lies'], ['code', 'Code words']].map(([v, t]) => opt(v, t, S.lshow === v)).join('')}</select></label><small>${list.length} of ${S.lines.length}</small>${btn('Add a line', 'fa-plus', 'Add a line at the end, for the other person', 'data-do="lnAdd"')}</div><div class="ncm-r4-lines" data-sc="ln">${list.map(row).join('') || '<small>Nothing matches.</small>'}</div><div class="ncm-r4-legend">${Object.values(MARKS).map(([t, tone, ic, h]) => `<span>${tagp(t, tone, ic)}<small>${esc(h)}.</small></span>`).join('')}</div>`}`;
}
/** One row per player: how they could get in, or why they can't. */
function hearPanel(c = S) {
  const names = Object.keys(WORLD), n = couldCount(c);
  const head = n ? `<div class="ncm-pn-check info" id="hear-head"><i class="fas fa-ear-listen"></i><span><b>${n} of ${names.length} players could hear this.</b> Nobody gets told. They only find out if they listen.</span></div>` : `<div class="ncm-pn-check" id="hear-head"><i class="fas fa-triangle-exclamation"></i><span><b>Nobody could hear this.</b> It will still play and leave its record. To change that, move someone onto a scene with them or use a network a player has tapped.</span></div>`;
  return head + names.map((name) => { const { ways, why } = waysFor(name, c); return `<div class="ncm-r4-hear${ways.length ? '' : ' is-no'}">${face(name)}<div class="grow"><b>${esc(name)}</b><div class="mt">${ways.length ? ways.map((x) => tagp(x.text, VIA_TONE[x.k], WAYS[x.k].icon, WAYS[x.k].tip)).join('') : `<small>No way in. ${esc(why.join('. '))}.</small>`}</div></div>${ways.length ? btn('', 'fa-eye', 'See what ' + name + ' would see', `data-do="preview" data-name="${esc(name)}"`, 'ic') : ''}</div>`; }).join('');
}
function stageFinal() {
  const opt2 = (id, k, title, what) => `<label class="ncm-pn-chk ncm-r4-opt" data-tooltip="${esc(what)}"><input type="checkbox" id="${id}" data-ch="setC" data-k="${k}"${S[k] ? ' checked' : ''}><span><b>${esc(title)}</b><small>${esc(what)}</small></span></label>`;
  return `${sect('fa-ear-listen', 'Who could hear this', 'var(--ncm-secret)', hearPanel(), 'Right now. Anyone can still join once it is running')}<div class="ncm-pn-f"><span data-tooltip="Later uses game time">When it starts</span>${seg('setV', 'when', S.when, [['now', 'When I press Start', 'Right away'], ['later', 'At a game time', 'Starts on its own later']])}</div>${opt2('st-rec', 'rec', 'Leave a record on terminals', 'A trail on the machines of this network, for players to find later.')}${opt2('st-enc', 'enc', 'Encrypted', 'Tap, jack-in and scanner get noise without a descrambler. The room still hears it.')}`;
}
const STAGE_STEPS = [['Who is talking', 'Two people and a network', stageWho], ['What they say', 'A script, or you speak live', stageSay], ['Start it', 'Who could hear it, and when it starts', stageFinal]];
function viewStage() {
  const n = S.stStep - 1, [t, d, fn] = STAGE_STEPS[n];
  return `<header class="ncm-tabhd"><i class="fas fa-pen"></i><div><h2>${esc(callName())}</h2><p>Write the conversation. Players are never on this call.</p></div><div class="ncm-tabhd__end">${backTo('home', 'All calls')}</div></header>${undoLine()}
  <div class="ncm-r4-summary">${stageSummary()}</div>
  <div class="ncm-r4-stepbar" role="tablist">${STAGE_STEPS.map(([x, y], i) => `<button type="button" role="tab" aria-selected="${i === n}" class="${i === n ? 'on' : i < n ? 'done' : ''}" data-do="stStep" data-i="${i + 1}" data-tooltip="${esc(y)}"><span class="n">${i < n ? '<i class="fas fa-check"></i>' : i + 1}</span>${esc(x)}</button>`).join('')}</div>
  <div class="ncm-pn-scroll" data-sc="st${n}">${fn()}</div>
  <div class="ncm-r4-foot">${n ? btn('Back', 'fa-arrow-left', 'The step before', `data-do="stStep" data-i="${n}"`) : '<span></span>'}<span class="grow"></span>${n < 2 ? btn('Next: ' + STAGE_STEPS[n + 1][0], 'fa-arrow-right', 'The next step', `data-do="stStep" data-i="${n + 2}"`, 'pri') : btn(S.when === 'now' ? 'Start the call' : 'Schedule it', 'fa-play', S.when === 'now' ? 'It starts playing now' : 'It starts on its own at that game time', 'data-do="startCall"', 'pri')}</div>`;
}

/* ─── Your calls ─── */
const callName = () => LIB.find((x) => x.id === S.callId)?.name || 'New call';
const statusOf = (c) => (S.running && c.id === S.callId ? 'running' : c.at ? 'scheduled' : 'ready');
function viewHome() {
  const q = S.clq.trim().toLowerCase();
  const passes = (c) => (S.clShow === 'all' || statusOf(c) === S.clShow) && (!q || [c.name, c.tag, c.a, c.b, c.net, ...c.lines.map((x) => x.text)].join(' ').toLowerCase().includes(q));
  const order = { running: 0, scheduled: 1, ready: 2 };
  const list = LIB.filter(passes).sort((x, y) => order[statusOf(x)] - order[statusOf(y)]);
  const row = (c) => { const st = statusOf(c), n = couldCount(c), live = st === 'running'; return `<button type="button" class="ncm-r4-call${live ? ' is-live' : ''}" data-do="openCall" data-id="${c.id}" data-tooltip="${live ? 'Open the running call' : 'Open and edit'}"><span class="ic"><i class="fas ${live ? 'fa-tower-broadcast' : c.at ? 'fa-clock' : 'fa-scroll'}"></i></span><span class="grow"><b>${esc(c.name)}</b><small>${esc(c.a)} and ${esc(c.b)} · ${esc(c.net)} · ${c.lines.length} lines</small></span>${n ? tagp(n + ' could hear', 'is-secret', 'fa-ear-listen', Object.keys(WORLD).filter((x) => waysFor(x, c).ways.length).join(', ')) : tagp('Nobody could hear', 'is-attn', 'fa-triangle-exclamation', 'As things stand, no player has a way in')}${live ? tagp('Running · line ' + (S.idx + 1) + ' of ' + c.lines.length, 'is-good', 'fa-play') : c.at ? tagp(c.at, 'is-act', 'fa-clock') : tagp('Ready', 'is-plain')}</button>`; };
  return `<header class="ncm-tabhd"><i class="fas fa-ear-listen"></i><div><h2>Overheard calls</h2><p>Conversations your players can listen in on.</p></div></header>${undoLine()}
  <p class="ncm-r4-lede">Write a conversation between two NPCs. It plays whether or not anyone is listening, and players only hear it if they have a way in.</p>
  <div class="ncm-r4-how"><button type="button" class="ncm-r4-howh" data-do="howFold" aria-expanded="${S.howOpen}" data-tooltip="${S.howOpen ? 'Fold' : 'Open'} this"><i class="fas fa-chevron-down ch"></i> How this works</button>${S.howOpen ? flow([['You write it', 'Two NPCs, a network, and what they say.'], ['You start it', 'Now, or at a game time. Nobody is told.'], ['Players get in', 'Nearby, a tap, jacked in, or a scanner. Any time, even mid-call.'], ['You decide', 'Nothing notices them unless you say so.']]) : ''}</div>
  <div class="ncm-pn-tb"><label class="ncm-pn-srch" data-tooltip="Search names, people, networks and what is said"><i class="fas fa-magnifying-glass"></i><input type="text" id="cl-q" data-in="clq" value="${esc(S.clq)}" placeholder="Find a call" aria-label="Find a call"></label><label class="ncm-pn-sel" data-tooltip="Narrow the list"><span>Show</span><select id="cl-show" data-ch="clShow">${[['all', 'All calls'], ['running', 'Running'], ['scheduled', 'Scheduled'], ['ready', 'Ready']].map(([v, t]) => opt(v, t, S.clShow === v)).join('')}</select></label><small>${list.length} of ${LIB.length}</small><span class="grow"></span>${btn('New call', 'fa-plus', 'Write a new conversation', 'data-do="newCall"', 'pri')}</div>
  <div class="ncm-pn-scroll ncm-r4-calls" data-sc="cl">${list.map(row).join('') || '<small>Nothing matches.</small>'}</div>`;
}

/* ─── It is running ─── */
const VIA_TONE = { tap: 'is-secret', room: 'is-attn', jack: 'is-act', scanner: 'is-plain' };
function runLines() { return S.lines.map((x, i) => `<div class="ncm-r4-rl${i === S.idx && !S.ended ? ' on' : ''}${i < S.idx || S.ended ? ' done' : ''}" data-line="${x.id}"><button type="button" data-do="jump" data-i="${i}" data-tooltip="Jump to this line"><span class="ncm-r4-side is-${x.side}">${esc(initials(nameOf(x.side)))}</span><span class="tx">${esc(x.text)}</span>${x.marks.map((k) => tagp(MARKS[k][0], MARKS[k][1], MARKS[k][2], MARKS[k][3])).join('')}${x.means ? `<small class="ncm-r4-mean">Means: ${esc(x.means)}</small>` : ''}</button></div>`).join(''); }
/** How many clue lines so far reached this listener, by the side they can hear and the line they joined on. */
function cluesHeard(x) { const clues = S.lines.map((y, i) => ({ y, i })).filter(({ y, i }) => y.marks.includes('clue') && i <= S.idx); if (!S.lines.some((y) => y.marks.includes('clue'))) return ''; const got = clues.filter(({ y, i }) => i >= x.line && (x.via !== 'room' || y.side === x.side)).length; return `<small class="ncm-r4-clues">${got ? '<i class="fas fa-key"></i> ' : ''}${got} of ${clues.length} clue${clues.length === 1 ? '' : 's'} so far</small>`; }
function viewRun() {
  const pct = S.lines.length ? Math.round(((S.ended ? S.lines.length : S.idx + 1) / S.lines.length) * 100) : 0;
  const inOn = new Set(LISTENERS.map((x) => x.name));
  const others = Object.keys(WORLD).filter((n) => !inOn.has(n) && !S.cutIds.has(n));
  const joinRow = (name) => { const { ways, why } = waysFor(name); return `<div class="ncm-r4-hear${ways.length ? '' : ' is-no'}">${face(name)}<div class="grow"><b>${esc(name)}</b><div class="mt">${ways.length ? ways.map((x) => tagp(x.text, VIA_TONE[x.k], WAYS[x.k].icon, WAYS[x.k].tip)).join('') : `<small>No way in. ${esc(why.join('. '))}.</small>`}</div></div>${ways.length ? btn('Mock: they join', 'fa-ear-listen', 'In play the player chooses this. They hear from the current line on', `data-do="mockJoin" data-name="${esc(name)}"`) : btn('Mock: they walk over', 'fa-person-walking', 'In play this is their token moving. They get the Listen prompt, even mid-call', `data-do="mockWalk" data-name="${esc(name)}"`)}</div>`; };
  return `<header class="ncm-tabhd"><i class="fas fa-tower-broadcast"></i><div><h2>${esc(callName())}</h2><p>${S.ended ? 'This call has ended.' : 'Running now. Nothing notices a listener unless you say so.'}</p></div><div class="ncm-tabhd__end">${backTo('home', 'All calls')}</div></header>${undoLine()}
  <div class="ncm-r4-transport"><div class="who"><b>${esc(S.a)}</b> <i class="fas fa-arrows-left-right"></i> <b>${esc(S.b)}</b> ${hv(S.net, 'fa-tower-cell')} ${S.ended ? tagp('Ended', 'is-plain') : S.playing ? tagp('Playing', 'is-good', 'fa-play') : tagp('Paused', 'is-attn', 'fa-pause')}<span class="grow"></span><small id="ru-pos">Line ${Math.min(S.idx + 1, S.lines.length)} of ${S.lines.length}</small></div><div class="bar"><i style="width:${pct}%"></i></div><div class="ncm-pn-acts">${btn(S.playing ? 'Pause' : 'Play', S.playing ? 'fa-pause' : 'fa-play', S.playing ? 'Hold on this line' : 'Carry on', 'data-do="playToggle"', 'go')}${btn('Next line', 'fa-forward-step', 'Skip to the next line', 'data-do="step"')}<span class="grow"></span>${btn('End the call', 'fa-phone-slash', 'They hang up', 'data-do="endCall"', 'bad')}</div></div>
  <div class="ncm-pn-split ncm-r3-half"><div class="ncm-pn-detail" data-sc="ru1">${sect('fa-comments', 'What is being said', 'var(--ncm-act)', `<div class="ncm-r4-rlist" id="ru-lines" data-sc="rl">${runLines()}</div>`, 'Click a line to jump')}</div>
    <div class="ncm-pn-detail" data-sc="ru2">${sect('fa-ear-listen', 'Who is listening', 'var(--ncm-secret)', `${LISTENERS.map((x) => `<div class="ncm-r4-li">${face(x.name)}<div class="grow"><b>${esc(x.name)}</b><div class="mt">${tagp(WAYS[x.via].label, VIA_TONE[x.via], WAYS[x.via].icon, x.detail)}<small>${x.garble ? (100 - x.garble) + '% clear' : 'Clear'} · ${x.line ? 'joined on line ' + (x.line + 1) : 'from the start'}</small>${cluesHeard(x)}</div></div>${btn('', 'fa-eye', 'See what ' + x.name + ' sees', `data-do="preview" data-name="${esc(x.name)}"`, 'ic')}${btn('Cut', 'fa-scissors', 'Drop just this listener. Their screen says the line went dead', `data-do="cut" data-id="${x.id}"`)}${btn('', 'fa-fire', 'Cut them and fire a trace, with heat', `data-do="cutTrace" data-id="${x.id}"`, 'ic bad')}</div>`).join('') || '<small>Nobody is listening. The call carries on anyway.</small>'}`)}
      ${sect('fa-hand', 'If you want them to notice', 'var(--ncm-attn)', `<div class="ncm-pn-acts">${btn('A click on the line', 'fa-ear-deaf', 'Every listener sees: A click on the line. Then play out what the NPCs do', 'data-do="click"')}</div>${S.clickAt !== null ? '<div class="ncm-pn-check info"><i class="fas fa-ear-deaf"></i><span>Every listener saw: A click on the line.</span></div>' : ''}<small>Only a failed jack-in roll traces by itself, the way it does today.</small>`)}
      ${others.length ? sect('fa-person-walking-arrow-right', 'Everyone else', 'var(--ncm-hue-3)', '<small>They can join at any point and hear from that line on.</small>' + others.map(joinRow).join('')) : ''}</div></div>`;
}

/* ─── A player listening ─── */
const WAY_FLOW = {
  room: { line: 'You overhear someone on a call nearby.', how: 'A prompt when they are in range of someone on a call, even mid-call. Never automatic.', go: 'Listen' },
  tap: { line: 'Your tap on the Pier 4 relay is picking up a call.', how: 'An alert from a tap they already planted, or planted just now.', go: 'Listen' },
  jack: { line: 'Node console: Listen to traffic. 1 call on this node.', how: 'A session action. A roll, and a move.', go: 'Listen to traffic' },
  scanner: { line: 'Radio scanner: 1 call on this scene.', how: 'A Scan button while they carry a scanner. Works with no node.', go: 'Scan and listen' },
};
function viewListen() {
  const way = (k) => { const w = WAYS[k], f = WAY_FLOW[k], on = S.ways.has(k), has = waysFor(S.asChar).ways.find((x) => x.k === k); const blocked = k === 'scanner' && !hasItem(S.asChar, RULES.scanner) && !on; return `<div class="ncm-r4-wayc${on ? ' on' : ''}"><div class="hd"><i class="fas ${w.icon}"></i><b>${esc(w.label)}</b>${on ? tagp('Listening', 'is-good') : has ? tagp('Open to them now', 'is-act', '', has.text) : tagp('Not right now', 'is-plain')}</div><div class="line">${esc(blocked ? 'No scanner on their sheet, so no Scan button.' : f.line)}</div><small>${esc(f.how)}</small>${k === 'room' && hasItem(S.asChar, RULES.amp) ? itemChip(holdsItem(S.asChar, RULES.amp).item, 'Hears twice as far', 'is-yes') : ''}${k === 'scanner' && hasItem(S.asChar, RULES.scanner) ? itemChip(holdsItem(S.asChar, RULES.scanner).item, holdsItem(S.asChar, RULES.scanner).how, 'is-yes') : ''}<div class="ncm-pn-fr">${btn(on ? 'Stop' : f.go, on ? 'fa-xmark' : 'fa-ear-listen', w.tip, `id="w-${k}" data-do="wayTog" data-k="${k}" aria-pressed="${on}"${blocked ? ' disabled' : ''}`, on ? '' : 'go')}${k === 'room' ? `<label class="ncm-pn-sel" data-tooltip="They only hear the person they are near"><span>Near</span><select id="w-near" data-ch="near">${opt('a', S.a, S.sideRoom === 'a')}${opt('b', S.b, S.sideRoom === 'b')}</select></label>` : ''}</div></div>`; };
  const meter = ([sd, g]) => `<div class="ncm-r4-meter"><span class="ncm-r4-side is-${sd}">${esc(initials(nameOf(sd)))}</span><span class="bar"><i style="width:${g === null ? 0 : 100 - g}%"></i></span><span class="pc">${g === null ? "Can't hear" : g === 0 ? 'Clear' : g >= 100 ? 'Noise' : (100 - g) + '% clear'}</span></div>`;
  const listening = S.ways.size > 0;
  return `<header class="ncm-tabhd"><i class="fas fa-eye"></i><div><h2>What ${esc(S.asChar)} sees</h2><p>A preview of the player's screen, not a screen you use.</p></div><div class="ncm-tabhd__end">${backTo(S.back, 'Back')}</div></header>${undoLine()}
  <div class="ncm-pn-scroll" data-sc="li"><div class="ncm-r4-as"><label class="ncm-pn-sel" data-tooltip="Whose sheet to read"><span>Listening as</span><select id="as-char" data-ch="asChar">${Object.keys(SHEETS).map((n) => opt(n, n, S.asChar === n)).join('')}</select></label>${[['Radio scanner', RULES.scanner], ['Descrambler', RULES.desc], ['Voice stress analyzer', RULES.stress], ['Hears further with', RULES.amp]].filter(([, l]) => l.length).map(([label, l]) => { const h = holdsItem(S.asChar, l); return itemChip(h ? h.item : l[0], h ? h.how : "Doesn't have it", h ? (h.counts ? 'is-yes' : 'is-warn') : 'is-no', label + ': any of ' + l.join(', ')); }).join('')}</div><div class="ncm-r4-ways">${Object.keys(WAYS).map(way).join('')}</div>
    ${listening ? `<div class="ncm-r3-scene ncm-r4-hud">${interceptCard()}<div class="ncm-ch-subs ncm-r4-subs" id="li-subs">${subsHtml()}</div></div>
    <div class="ncm-r4-tools"><div class="ncm-r4-meters">${['a', 'b'].map((sd) => meter([sd, garbleFor(sd)])).join('')}</div><div class="ncm-pn-acts">${btn('Enhance', 'fa-wand-magic-sparkles', RULES.skill + ' against DV ' + RULES.dv + '. Beat it by more and more words clear', 'data-do="enhance"', 'go')}${btn('Save', 'fa-floppy-disk', 'To your EXFIL folder, as garbled as you heard it, from the line you joined on', 'data-do="save"')}${btn('', 'fa-play', 'Mock only: run or pause the call', 'data-do="playToggle"', 'ic')}${btn('', 'fa-forward-step', 'Mock only: the next line', 'data-do="step"', 'ic')}</div></div>
    ${S.enhanceMsg ? `<div class="ncm-pn-check ${S.enhanceOk ? 'info' : ''}"><i class="fas fa-wand-magic-sparkles"></i><span>${esc(S.enhanceMsg)}</span></div>` : ''}${S.saved ? '<div class="ncm-pn-check info"><i class="fas fa-floppy-disk"></i><span>Saved to EXFIL as an audio log. Recorded lines keep their clips.</span></div>' : ''}` : '<div class="ncm-ph2-none">Not listening. Pick a way in above.</div>'}
    <label class="ncm-pn-chk ncm-r4-enc" data-tooltip="Set when you write the call. Tap, jack-in and scanner need a descrambler"><input type="checkbox" id="g-en" data-ch="setC" data-k="enc"${S.enc ? ' checked' : ''}><span>This call is encrypted</span></label></div>`;
}

/* ─── Rules ─── */
const itemRow = (k, label, tip) => itemListRow(RULES[k], k, label, tip, 'pickItem', 'itemOff', btn);
function viewWays() {
  const fold = (k, ic, tone, q, answer, body) => { const open = S.wOpen.has(k); return `<div class="ncm-pn-sect ncm-r4-q${open ? ' is-open' : ''}"><button type="button" class="ncm-pn-band ncm-r4-qh" style="--sk:${tone}" data-do="wFold" data-k="${k}" aria-expanded="${open}" data-tooltip="${open ? 'Fold' : 'Open'} this"><i class="fas fa-chevron-down ch"></i><i class="fas ${ic}"></i> ${esc(q)}<small>${esc(answer)}</small></button>${open ? `<div class="in">${body}</div>` : ''}</div>`; };
  return `<header class="ncm-tabhd"><i class="fas fa-sliders"></i><div><h2>Eavesdropping rules</h2><p>Apply to every overheard call. The defaults work without touching any of them.</p></div></header>
  <div class="ncm-pn-scroll" data-sc="wa">${fold('room', 'fa-person-rays', 'var(--ncm-attn)', 'Who counts as in the room?', RULES.room === 'tokens' ? 'Tokens within ' + RULES.range + ' squares' : 'Anyone on the same scene', `<div class="ncm-pn-fr"><div class="ncm-pn-f"><span data-tooltip="What counts as near">Near means</span>${seg('ruleV', 'room', RULES.room, [['tokens', 'Tokens in range', 'A token within this many squares of the NPC'], ['scene', 'Same scene', 'Anyone on the scene']])}</div>${RULES.room === 'tokens' ? `<label class="ncm-pn-f" data-tooltip="Squares">Squares<input type="number" id="ru-range" data-ch="ruleN" data-k="range" min="1" max="60" value="${RULES.range}" style="width:70px"></label>` : ''}</div>${itemRow('amp', 'Hears further with', 'Carrying this doubles the range')}<small>${RULES.room === 'tokens' ? `A player's token within ${RULES.range} squares of an NPC gets the Listen prompt.` : 'Anyone on the same scene as an NPC gets the Listen prompt.'}</small>`)}
    ${fold('gear', 'fa-screwdriver-wrench', 'var(--ncm-hue-3)', 'What gear matters?', (RULES.scanner.length + RULES.desc.length + RULES.stress.length) + ' items set', `${itemRow('scanner', 'Radio scanner', 'Shows a Scan button. Hears calls on this scene with no node, heavily garbled')}${itemRow('desc', 'Descrambler', 'Needed to hear an encrypted call through anything but the room')}${itemRow('stress', 'Voice stress analyzer', 'Flags lines you marked as a lie')}`)}
    ${fold('rolls', 'fa-dice-d20', 'var(--ncm-act)', 'What do the rolls need?', 'Enhance DV ' + RULES.dv + ' · Listen to traffic DV ' + RULES.jackDv, `<div class="ncm-pn-fr"><label class="ncm-pn-f" data-tooltip="The skill Enhance rolls">Enhance rolls<select id="ru-sk" data-ch="ruleS" data-k="skill">${['Interface', 'Electronics/Security Tech', 'Basic Tech', 'Perception'].map((x) => opt(x, x, RULES.skill === x)).join('')}</select></label><label class="ncm-pn-f" data-tooltip="Beat it to clear words. Beat it by more to clear more">Against DV<input type="number" id="ru-dv" data-ch="ruleN" data-k="dv" min="1" max="40" value="${RULES.dv}" style="width:70px"></label><label class="ncm-pn-f" data-tooltip="The node session action. Also costs a move">Listen to traffic DV<input type="number" id="ru-jk" data-ch="ruleN" data-k="jackDv" min="1" max="40" value="${RULES.jackDv}" style="width:70px"></label></div>`)}
    ${fold('rec', 'fa-desktop', 'var(--ncm-hue-5)', 'Do these calls leave a trail?', RULES.records ? 'Yes, on the network\'s terminals' : 'No', `<label class="ncm-pn-chk" data-tooltip="Each staged call can override this"><input type="checkbox" id="ru-rec" data-ch="ruleC" data-k="records"${RULES.records ? ' checked' : ''}><span>Leave a record on the network's terminals</span></label>`)}</div>`;
}

/* ─── draw ─── */
const FRAMES = {
  home: { nav: 'over', view: viewHome, note: '<b>Your calls.</b> The new front door: one sentence says what this is, and each call says who could hear it. Press New call or open any call. Pier 4 is already running.' },
  stage: { nav: 'over', view: viewStage, note: '<b>Write one.</b> Three steps. Step 3 lists each player and how they could get in, or why they can\'t. Try setting both people to Off-screen, or turning on Encrypted. Open a line with the sliders button to set its marks; each mark says what it does.' },
  run: { nav: 'over', view: viewRun, note: '<b>Running.</b> Only reachable once a call has started. Everyone else shows how they could still join: press Mock: they walk over on Dex, then Mock: they join. They hear from that line on.' },
  listen: { nav: 'over', view: viewListen, note: '<b>What a player sees.</b> Opened from the eye button on a player. It is a preview, with the real call screen. Join late and it says what was missed. Switch who is listening: gear is read from their sheet.' },
  ways: { nav: 'setup', view: viewWays, note: '<b>Setup → Eavesdropping rules.</b> Moved out of the call flow, since you set them once. Each gear question takes as many items as you like, and having any one is enough.' },
};
const NAV = [['live', 'Live', 'fa-tower-broadcast'], ['numbers', 'Numbers', 'fa-sim-card'], ['over', 'Overheard calls', 'fa-ear-listen'], ['setup', 'Setup', 'fa-sliders'], ['log', 'Call log', 'fa-list'], ['vm', 'Voicemail', 'fa-voicemail'], ['settings', 'Settings', 'fa-gear']];
const navHtml = (cur) => `<nav class="ncm-ph2-nav" role="tablist">${NAV.map(([k, t, ic]) => `<button type="button" role="tab" aria-selected="${cur === k}" class="ncm-ph2-navbtn${cur === k ? ' on' : ''}" data-do="nav" data-k="${k}" data-tooltip="${k === 'over' ? 'Conversations between NPCs that players can overhear' : k === 'setup' ? 'Rules you set once' : 'See the Round 2 mock'}"><i class="fas ${ic}"></i> ${esc(t)}</button>`).join('')}</nav>`;
const win = document.getElementById('win'), stage = document.getElementById('stage'), tipEl = document.getElementById('mk-tip');
const memo = new Map();
function draw() {
  stage.querySelectorAll('[data-sc]').forEach((el) => memo.set(el.dataset.sc, el.scrollTop));
  const a = document.activeElement; const focus = a?.id && stage.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  const F = FRAMES[S.f];
  document.querySelectorAll('.mk-bar [data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === S.f));
  document.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === S.t));
  document.querySelectorAll('[data-w]').forEach((b) => b.classList.toggle('on', b.dataset.w === S.w));
  document.getElementById('note').innerHTML = F.note;
  win.setAttribute('data-ncm-admin-theme', S.t); win.classList.toggle('is-wide', S.w === 'pop');
  win.style.setProperty('--mk-w', S.w === 'pop' ? '1120px' : '820px'); win.style.setProperty('--mk-h', S.w === 'pop' ? '780px' : '760px');
  stage.innerHTML = `<div class="mk-tabs"><span class="g">COMMS</span><span class="t">Contacts</span><span class="t on">Phone</span></div><div class="mk-body"><div class="ncm-ph2">${navHtml(F.nav)}<div class="ncm-pn">${F.view()}</div></div></div>`;
  stage.querySelectorAll('[data-sc]').forEach((el) => { const v = memo.get(el.dataset.sc); if (v) el.scrollTop = v; });
  ScopePicker.after();
  typeFresh();
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(focus.s, focus.e); } catch { /* not text */ } } }
}
/* moving the call on only touches the parts that change, so the real card keeps animating */
function paintProgress() { const a = document.getElementById('li-subs'); if (a) a.innerHTML = subsHtml(); const b = document.getElementById('ru-lines'); if (b) b.innerHTML = runLines(); const c = document.getElementById('ru-pos'); if (c) c.textContent = `Line ${Math.min(S.idx + 1, S.lines.length)} of ${S.lines.length}`; const d = document.querySelector('.ncm-r4-transport .bar i'); if (d) d.style.width = `${Math.round(((S.ended ? S.lines.length : S.idx + 1) / S.lines.length) * 100)}%`; }
function step() { clearTimeout(playT); if (S.idx >= S.lines.length - 1) { S.ended = true; S.playing = false; draw(); return; } S.idx++; S.fresh = S.lines[S.idx].id; paintProgress(); typeFresh(); if (S.playing) schedule(); }
let playT = null;
function schedule() { clearTimeout(playT); const cur = S.lines[S.idx], next = S.lines[S.idx + 1]; const wait = window.NCM_PICK.typeOutMs(cur?.text || '') + 900 + (next?.delay || 0) * 1000; playT = setTimeout(step, wait); }
function setPlay(on) { S.playing = on; clearTimeout(playT); if (on) schedule(); }
function loadCall(c) { Object.assign(S, { callId: c.id, a: c.a, b: c.b, aLoc: c.aLoc, bLoc: c.bLoc, net: c.net, script: c.id, lines: c.lines.map((x) => ({ ...x })), idx: 0, ended: false, when: c.at ? 'later' : 'now' }); S.running = false; setPlay(false); }
let toastT; function toast(m) { const t = document.getElementById('mk-toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
const ACT = {
  nav: (el) => { const k = el.dataset.k; if (k === 'over') S.f = 'home'; else if (k === 'setup') S.f = 'ways'; else { toast('See the Round 2 mock'); return false; } },
  howFold: () => { S.howOpen = !S.howOpen; },
  openCall: (el) => { const c = LIB.find((x) => x.id === el.dataset.id); if (S.running && c.id === S.callId) { S.f = 'run'; return; } loadCall(c); S.f = 'stage'; S.stStep = 1; },
  newCall: () => { S.callId = null; Object.assign(S, { a: 'Rogue', b: 'Marcus Vance', aLoc: 'Off-screen', bLoc: 'Off-screen', net: 'CitiNet', lines: [l('a', ''), l('b', '')], script: '' }); S.f = 'stage'; S.stStep = 1; S.running = false; setPlay(false); },
  preview: (el) => { const name = el.dataset.name; S.back = S.f; S.undo = null; S.asChar = name; const w = LISTENERS.find((x) => x.name === name); S.ways = new Set(w ? [w.via] : waysFor(name).ways.map((x) => x.k).slice(0, 1)); S.waySince = {}; for (const k of S.ways) S.waySince[k] = w ? w.line : S.running ? S.idx : 0; if (w?.side) S.sideRoom = w.side; S.f = 'listen'; },
  mockJoin: (el) => { const name = el.dataset.name, x = waysFor(name).ways[0]; LISTENERS.push({ id: name, name, via: x.k, side: x.side, detail: x.text, garble: WAYS[x.k].garble, line: S.idx }); S.undo = { text: name + ' is listening from line ' + (S.idx + 1) + '. They missed everything before it.' }; },
  mockWalk: (el) => { const name = el.dataset.name; Object.assign(WORLD[name], { scene: S.aLoc === 'Off-screen' ? S.bLoc : S.aLoc, dist: 3 }); S.undo = { text: name + ' walked into range and got the Listen prompt.' }; },
  stStep: (el) => { S.stStep = Number(el.dataset.i); },
  lnOpen: (el) => { const i = Number(el.dataset.i); S.lnOpen = S.lnOpen === i ? null : i; },
  wayTog: (el) => { const k = el.dataset.k; if (S.ways.has(k)) S.ways.delete(k); else { S.ways.add(k); S.waySince[k] = S.idx; } },
  wFold: (el) => { const k = el.dataset.k; if (S.wOpen.has(k)) S.wOpen.delete(k); else S.wOpen.add(k); },
  go: (el) => { S.f = el.dataset.f; }, toast: (el) => { toast(el.dataset.msg); return false; },
  undo: () => { S.undo?.fn?.(); S.undo = null; }, undoClose: () => { S.undo = null; },
  setV: (el) => { S[el.dataset.k] = el.dataset.v; },
  lnSide: (el) => { const x = S.lines[Number(el.dataset.i)]; x.side = x.side === 'a' ? 'b' : 'a'; },
  lnMark: (el) => { const x = S.lines[Number(el.dataset.i)], k = el.dataset.k; x.marks = x.marks.includes(k) ? x.marks.filter((m) => m !== k) : [...x.marks, k]; },
  lnDel: (el) => { const i = Number(el.dataset.i), x = S.lines[i]; S.lines.splice(i, 1); S.undo = { text: 'Line deleted.', fn: () => S.lines.splice(i, 0, x) }; },
  lnAdd: () => { const last = S.lines[S.lines.length - 1]; S.lines.push(l(last?.side === 'a' ? 'b' : 'a', '')); },
  libSave: () => { const id = 'n' + Date.now().toString(36); LIB.push({ id, name: S.a + ' and ' + S.b, tag: 'Saved', lines: S.lines.map((x) => ({ ...x })) }); S.script = id; S.undo = { text: 'Saved to the library.' }; },
  startCall: () => { if (S.when === 'later') { const c = LIB.find((x) => x.id === S.callId); if (c) c.at = 'Tonight, 23:00'; S.f = 'home'; S.undo = { text: 'Scheduled. It starts on its own at that game time.' }; return; } const c = LIB.find((x) => x.id === S.callId); if (c) { c.at = ''; } S.running = true; S.idx = 0; S.ended = false; S.clickAt = null; LISTENERS = []; S.cutIds = new Set(); S.f = 'run'; S.fresh = S.lines[0]?.id; setPlay(true); },
  playToggle: () => { if (S.ended) { S.idx = 0; S.ended = false; S.fresh = S.lines[0]?.id; } setPlay(!S.playing); },
  step: () => { step(); return false; }, jump: (el) => { S.idx = Number(el.dataset.i); S.ended = false; S.fresh = S.lines[S.idx]?.id; paintProgress(); typeFresh(); if (S.playing) schedule(); return false; },
  endCall: () => { setPlay(false); S.ended = true; S.running = false; }, click: () => { S.clickAt = S.idx; },
  cut: (el) => { const i = LISTENERS.findIndex((x) => x.id === el.dataset.id), x = LISTENERS[i]; LISTENERS.splice(i, 1); S.cutIds.add(x.name); S.undo = { text: `${x.name} is off the line.`, fn: () => { LISTENERS.splice(i, 0, x); S.cutIds.delete(x.name); } }; },
  cutTrace: (el) => { const i = LISTENERS.findIndex((x) => x.id === el.dataset.id), x = LISTENERS[i]; LISTENERS.splice(i, 1); S.cutIds.add(x.name); S.undo = { text: `${x.name} is off the line, and a trace fired on them.` }; },
  enhance: () => { const base = 9, d = window.__d10 ?? (1 + Math.floor(Math.random() * 10)), total = base + d, m = total - RULES.dv; if (total > RULES.dv) { S.enhance = Math.min(60, S.enhance + 15 + m * 3); S.enhanceOk = true; S.enhanceMsg = `Rolled ${total} against DV ${RULES.dv}. More of it comes through.`; } else { S.enhanceOk = false; S.enhanceMsg = `Rolled ${total} against DV ${RULES.dv}. Nothing clears.`; } },
  save: () => { S.saved = true; },
  ruleV: (el) => { RULES[el.dataset.k] = el.dataset.v; },
  pickItem: (el) => { const k = el.dataset.k; showNamePicker({ title: 'Pick items', hint: 'Tick as many as you like. Having any one of them is enough', entries: GEAR, multi: true, preselected: itemList(RULES[k]), doneLabel: 'Use these', placeholder: 'search items…' }).then((p) => { if (!p) return; RULES[k] = p.map((x) => x.name); syncScan(); draw(); }); return false; },
  itemOff: (el) => { const k = el.dataset.k; RULES[k] = RULES[k].filter((n) => n !== el.dataset.name); syncScan(); },
};
const CH = {
  clShow: (el) => { S.clShow = el.value; },
  setS: (el) => { S[el.dataset.k] = el.value; }, setC: (el) => { S[el.dataset.k] = el.checked; }, lshow: (el) => { S.lshow = el.value; },
  lnVoice: (el) => { S.lines[Number(el.dataset.i)].voice = el.value; }, lnDelay: (el) => { S.lines[Number(el.dataset.i)].delay = Number(el.value) || 0; },
  near: (el) => { S.sideRoom = el.value; },
  asChar: (el) => { S.asChar = el.value; syncScan(); },
  ruleN: (el) => { RULES[el.dataset.k] = Number(el.value) || 0; }, ruleS: (el) => { RULES[el.dataset.k] = el.value; }, ruleC: (el) => { RULES[el.dataset.k] = el.checked; },
};
const INP = { clq: (el) => { S.clq = el.value; return true; }, lnMeans: (el) => { S.lines[Number(el.dataset.i)].means = el.value; return false; }, lq: (el) => { S.lq = el.value; return true; }, lnText: (el) => { S.lines[Number(el.dataset.i)].text = el.value; return false; } };
document.addEventListener('click', (e) => {
  const bar = e.target.closest('.mk-bar button');
  if (bar) { if (bar.dataset.f) S.f = bar.dataset.f; if (bar.dataset.t) S.t = bar.dataset.t; if (bar.dataset.w) S.w = bar.dataset.w; draw(); return; }
  const el = e.target.closest('[data-do]'); if (!el || !stage.contains(el) || el.disabled) return;
  if (ACT[el.dataset.do]?.(el) !== false) draw();
});
document.addEventListener('change', (e) => { const h = e.target.dataset?.ch; if (h && CH[h]) { CH[h](e.target); draw(); } });
document.addEventListener('input', (e) => { const h = e.target.dataset?.in; if (h && INP[h] && INP[h](e.target)) draw(); });
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest?.('[data-tooltip]'); if (!t) { tipEl.hidden = true; return; }
  tipEl.textContent = t.dataset.tooltip; tipEl.hidden = false; const r = t.getBoundingClientRect(), pr = tipEl.getBoundingClientRect();
  tipEl.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - pr.width / 2, innerWidth - pr.width - 6))}px`; tipEl.style.top = `${r.top - pr.height - 6 < 4 ? r.bottom + 6 : r.top - pr.height - 6}px`;
});
draw();
window.NCM_R4 = { S, draw, step, typeIn, garbleFor, garbleText, LIB, LISTENERS: () => LISTENERS, RULES, WORLD, waysFor, couldCount };
