/* Round 5 mock: the screens no earlier round showed. Not wired to the module. The call screen and node console are the REAL ones. */
const q0 = new URLSearchParams(location.search);
const { CallHud, typeOutMs, nodeTpl } = window.NCM_PICK;
const hueOf = (s) => { let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return `var(--ncm-hue-${(h % 8) + 1})`; };
const initials = (s) => String(s).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const tagp = (t, tone, ic, tip) => `<span class="ncm-tagp ${tone}"${tip ? ` data-tooltip="${esc(tip)}"` : ''}>${ic ? `<i class="fas ${ic}"></i> ` : ''}${esc(t)}</span>`;
const btn = (label, icon, tip, attrs = '', mod = '') => `<button type="button" class="ncm-ph2-btn${mod ? mod.split(' ').map((m) => ' ncm-ph2-btn--' + m).join('') : ''}" data-tooltip="${esc(tip)}"${label ? '' : ` aria-label="${esc(tip)}"`} ${attrs}>${icon ? `<i class="fas ${icon}"></i>` : ''}${label ? ' ' + esc(label) : ''}</button>`;
const seg = (act, cur, opts) => `<div class="ncm-pn-seg" role="group">${opts.map(([v, t, h]) => `<button type="button" class="${cur === v ? 'on' : ''}" data-do="${act}" data-v="${esc(v)}" data-tooltip="${esc(h)}">${esc(t)}</button>`).join('')}</div>`;
const face = (n) => `<span class="ncm-ph2-face" style="--tc:${hueOf(n)}">${esc(initials(n))}</span>`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = { f: q0.get('f') || 'trauma', t: q0.get('t') || 'clean-dark', w: q0.get('w') === 'pop' ? 'pop' : 'panel',
  outT: q0.get('o') || 'called', plan: 'silver', outB: q0.get('o') || 'answers',
  beat: -1, rounds: 0, arrived: false, ended: false, hungUp: false, sub: null,
  live: { rounds: 3, arrived: false, filt: 'all', open: null, active: null, q: null }, tl: { side: 'a', voice: 'text', lines: [{ side: 'a', text: 'The shipment moved. Pier 4, midnight.' }], draft: '' },
  rg: { anchor: 'token', rule: 'tokens', walls: false, wall: false, who: q0.get('who') || 'Rache', dist: Number(q0.get('dist')) || 5, squares: 6, scene: 'same' }, pr: { room: 'prompt', tap: 'prompt', scanned: false, heard: false }, nodeHeard: false, pay: { ringing: false, near: true, calling: false } };

/* ─── the REAL call screen ─── */
const hudService = { calls: new Map(), usableModes: [], offeredModes: [], modeFor: () => 'loud', _get: (k, d) => d };
const HUD = new CallHud(hudService); HUD._other = (c) => c.from; let hudN = 0;
const NET = { id: 'CITINET', name: 'CitiNet', type: 'PUBLIC', strength: 78, color: '#19f3f7' };
/** Every state below is the real _callHtml. What is added goes in the frame the real card already has and one panel under its meta line. */
function realCard({ name, number = '', state, kind, keys, net = NET, feed = '', panel = '', why = '', stopLabel, frameWord }) {
  const id = 'r5c' + (++hudN), now = Date.now();
  const call = { id, from: { name, number, img: 'NOFACE', contactId: null }, to: { userId: 'u1', name: 'V', number: '', kind: 'player' }, net, mode: 'loud', state, startedAt: now - 2300, answeredAt: now - 48000, endedAt: null, outcome: null, dropReason: why };
  hudService.calls.set(id, call);
  let html = HUD._callHtml({ call, role: 'caller' }, {});
  if (kind) html = html.replaceAll('data-dec="Holocall"', `data-dec="${esc(kind)}"`).replaceAll('>Holocall<', `>${esc(kind)}<`).replaceAll('data-dec="Calling…"', `data-dec="${esc(kind)}"`).replaceAll('>Calling…<', `>${esc(kind)}<`);
  if (stopLabel) html = html.replace('Hang up', esc(stopLabel));
  if (frameWord) html = html.replace('● LIVE', esc(frameWord));
  html = html.replace('<img src="NOFACE" alt="">', feed);
  if (panel) html = html.includes('<div class="ncm-ch-keys">') ? html.replace('<div class="ncm-ch-keys">', panel + '<div class="ncm-ch-keys">') : html.replace('</div></div>', panel + '</div></div>');
  return html;
}
const hudT0 = performance.now();
setInterval(() => { const t = performance.now() - hudT0; document.querySelectorAll('.ncm-r5-hud .ncm-ch-badge').forEach((b) => HUD._paintBadge(b, t)); }, 120);
function typeIn(el, text) { if (!el) return; if (reduced()) { el.textContent = text; return; } const ms = typeOutMs(text), t0 = performance.now(); el.textContent = ''; const tick = (now) => { if (!el.isConnected) return; const k = Math.ceil(Math.min(1, (now - t0) / ms) * text.length); el.textContent = text.slice(0, k); if (k < text.length) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
const subLine = (who, text) => `<div class="ncm-ch-subs ncm-r5-subs"><div class="ncm-ch-sublines"><div class="ncm-ch-sub now"><b>${esc(who)}:</b> <span class="tx" data-type="${esc(text)}"></span></div></div></div>`;

/* ─── moving pictures in the real frame ─── */
const vitals = (hp, max) => { const low = hp / max; return { bpm: low < .2 ? 148 : low < .5 ? 118 : 76, wob: low < .2 ? 1 : .35 }; };
function runCanvases() {
  document.querySelectorAll('canvas[data-ecg],canvas[data-wave]').forEach((c) => {
    if (c.dataset.on) return; c.dataset.on = '1'; const g = c.getContext('2d'), W = c.width, H = c.height, isWave = 'wave' in c.dataset, col = c.dataset.col || '#ff5a66', t0 = performance.now(); let x = 0, last = H / 2, jit = 0;
    const frame = (now) => {
      if (!c.isConnected) return;
      if (isWave) { g.clearRect(0, 0, W, H); const tx = c.dataset.wave === 'tx', burst = c.dataset.wave === 'static'; g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); for (let i = 0; i < W; i += 2) { const k = i / W, env = burst ? 1 : Math.sin(k * Math.PI), a = burst ? Math.random() * H * .46 : (tx ? H * .38 : H * .05) * env * (.45 + .55 * Math.abs(Math.sin((now - t0) / 170 + i * .15))); const y = H / 2 + (i % 4 ? a : -a); i ? g.lineTo(i, y) : g.moveTo(i, y); } g.stroke(); requestAnimationFrame(frame); return; }
      const { bpm, wob } = vitals(Number(c.dataset.hp), Number(c.dataset.max)), period = 60000 / bpm, ph = ((now - t0) % period) / period;
      const blip = ph < .08 ? -Math.sin(ph / .08 * Math.PI) * H * .4 : ph < .13 ? Math.sin((ph - .08) / .05 * Math.PI) * H * .16 : ph > .3 && ph < .42 ? -Math.sin((ph - .3) / .12 * Math.PI) * H * .08 : 0; jit += (Math.random() - .5) * wob; jit *= .9;
      const y = H / 2 + blip + jit * 2; g.fillStyle = 'rgba(8,9,13,.09)'; g.fillRect(0, 0, W, H); g.clearRect(x + 2, 0, 10, H); g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, last); x = (x + 1.4) % W; g.lineTo(x, y); if (x > 2) g.stroke(); last = y; requestAnimationFrame(frame);
    };
    if (reduced()) { g.strokeStyle = col; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, H / 2); [.2, .23, .26, .29, .32].forEach((k, i) => g.lineTo(W * k, H / 2 + [0, -H * .36, H * .15, 0, 0][i])); g.lineTo(W, H / 2); g.stroke(); return; }
    requestAnimationFrame(frame);
  });
}
const ecg = (hp, max) => `<div class="ncm-r5-feed"><canvas data-ecg data-hp="${hp}" data-max="${max}" width="132" height="146" aria-label="Heart trace"></canvas><span class="rd"><b>${hp}</b>/${max} HP</span></div>`;
const wave = (mode, col) => `<div class="ncm-r5-feed"><canvas data-wave="${mode}" data-col="${col}" width="132" height="146" aria-label="Radio signal"></canvas><span class="rd">TAC-3</span></div>`;
const steps = (names, at) => `<div class="ncm-r5-steps">${names.map((n, i) => `<span class="${i < at ? 'done' : i === at ? 'on' : ''}">${i < at ? '<i class="fas fa-check"></i>' : ''}${esc(n)}</span>`).join('')}</div>`;
const die = (n, sides, rolling) => `<span class="ncm-r5-die${rolling ? ' is-rolling' : ''}" data-tooltip="${sides === 10 ? 'd10' : 'd6'}"><i class="fas fa-dice-d20"></i><b>${rolling ? '?' : n}</b></span>`;
const pips = (left, of, ic) => `<span class="ncm-r5-pips" aria-label="${left} rounds left">${Array.from({ length: of }, (_, i) => `<i class="fas ${ic}${i < left ? ' on' : ''}"></i>`).join('')}</span>`;

/* ─── Trauma Team ─── */
const TT = { name: 'Veronica A.', hp: 4, max: 38, body: 6, where: 'Pier 4, Night City', roll: 3, plan: { silver: ['Silver plan', 'is-act'], exec: ['Executive plan', 'is-money'] } };
const TT_STEPS = ['Plan', 'Location', 'Dispatch', 'En route'];
const T_BEATS = [0, 2200, 4200, 6400, 9400];
function traumaHud() {
  const plan = TT.plan[S.plan][0];
  if (S.outT === 'noplan') return realCard({ name: 'TRAUMA', number: 'TRAUMA', state: 'ended', why: 'This number is for subscribers.', net: NET });
  if (S.outT === 'nosignal') return realCard({ name: 'TRAUMA TEAM', number: 'TRAUMA', state: 'ended', why: S.auto ? 'Your Biomonitor could not get a signal. No call went out.' : 'No signal. The call did not go out.', net: NET });
  const auto = S.outT === 'auto', word = auto ? 'Biomonitor alert' : 'Emergency';
  if (S.beat < 1) return realCard({ name: 'TRAUMA TEAM', number: 'TRAUMA', state: 'dialing', kind: word, keys: [] });
  const b = S.beat, at = Math.min(b - 1, 3);
  const lines = [`<b>Checking your plan.</b>`, `<b>${esc(plan)} active.</b> Finding you.`, `<b>${esc(TT.where)}.</b> Sending a team.`, ''];
  const body = S.hungUp ? '' : b >= 4 ? `<div class="ncm-r5-row">${die(TT.roll, 6)}<span><b>AV-4 inbound.</b> ${S.rounds ? `${S.rounds} round${S.rounds === 1 ? '' : 's'} out, first in the order.` : 'Arriving now.'}</span>${pips(S.rounds, TT.roll, 'fa-truck-medical')}</div>` : b === 3 ? `<div class="ncm-r5-row">${die('', 6, true)}<span>${lines[2]}</span></div>` : `<div class="ncm-r5-row"><span class="ncm-r5-scan"></span><span>${lines[b - 1]}</span></div>`;
  return realCard({ name: 'TRAUMA TEAM', number: 'TRAUMA', state: 'live', kind: word, feed: ecg(TT.hp, TT.max), frameWord: S.plan === 'exec' ? 'EXECUTIVE' : 'SILVER', panel: `<div class="ncm-r5-em">${steps(TT_STEPS, b >= 4 ? 4 : at)}${body}</div>` });
}
function viewTrauma() {
  const out = S.outT, ok = out === 'called' || out === 'auto';
  const sub = ok && S.beat >= 3 && !S.arrived ? subLine('Dispatch', S.beat >= 4 ? 'Trauma Team dispatch. We have your location. Stay where you are.' : 'Stand by.') : '';
  const auto = out === 'auto' && S.beat >= 0 ? `<div class="ncm-r5-alert"><i class="fas fa-heart-pulse"></i> HP ${TT.hp} is under BODY ${TT.body}. Your Biomonitor is calling for you.</div>` : '';
  return `<div class="mk-frame"><div class="ncm-r5-ctrl"><label class="ncm-pn-f" data-tooltip="How the call started"><span>Case</span></label>${seg('oT', out, [['called', 'They called', 'An Action, any time they are hurt'], ['auto', 'Biomonitor', 'It calls by itself, for free'], ['noplan', 'No plan', 'No Trauma Team button; they dialled it anyway'], ['nosignal', 'No signal', 'A dead zone or a jammed node']])}${seg('oP', S.plan, [['silver', 'Silver', 'Silver plan'], ['exec', 'Executive', 'Executive plan']])}<span class="grow"></span>${btn('Play it again', 'fa-rotate-left', 'From the top', 'data-do="replay"')}${ok && S.beat >= 4 && !S.arrived ? btn('Mock: a round passes', 'fa-forward-step', 'In play this follows the combat tracker, or the GM presses it', 'data-do="roundT"') : ''}${ok && S.beat >= 4 && !S.hungUp && !S.arrived ? btn('Mock: hang up', 'fa-phone-slash', 'They hang up. The team still comes', 'data-do="hangT"') : ''}</div>
    <div class="ncm-r5-scene ${ok && !S.arrived ? 'is-trauma' : ''}${ok && S.arrived ? ' is-ttarrive' : ''}" id="scene" style="${ok && !S.arrived ? `--beat:${60 / vitals(TT.hp, TT.max).bpm}s` : ''}">
      ${S.arrived ? `<div class="ncm-r5-arrive is-tt"><span class="beam"></span><span class="beam b"></span><div class="in"><i class="fas fa-truck-medical"></i><b>TRAUMA TEAM ON SCENE</b><small>${esc(TT.where)} · first in the order</small></div></div>` : ''}
      ${auto}
      ${S.hungUp && !S.arrived ? `<div class="ncm-r5-mini"><i class="fas fa-truck-medical"></i><b>Trauma Team</b> ${pips(S.rounds, TT.roll, 'fa-truck-medical')}<small>${S.rounds} round${S.rounds === 1 ? '' : 's'}</small></div>` : !S.arrived ? `<div class="ncm-call-hud ncm-r5-hud" style="--ch-ring:#ff5a66;--ch-live:#ff5a66;--ch-key:#fff">${traumaHud()}</div>${sub}` : ''}
    </div><div class="ncm-r5-under">${chatLog()}${gmSees(ok ? `<b>Veronica A. called Trauma Team.</b> ${TT.plan[S.plan][0]}. HP ${TT.hp}/${TT.max}. ${esc(TT.where)}. d6 rolled ${TT.roll}.` : out === 'noplan' ? 'Nothing. By rule it just refuses. You can have it ring you instead (Setup → Trauma Team).' : 'Nothing went out, so nothing reaches you. It shows in their call log.')}</div></div>`;
}

/* ─── Lawman Backup ─── */
const BK = { name: 'Rache', rank: 5, org: 'NCPD', group: 'Street Patrol', up: 'Regional Deputies', where: 'Pier 4' };
const B_STEPS = ['Transmit', 'Roll', 'Units', 'En route'];
const B_BEATS = [0, 1800, 4600, 7200, 9600];
const bkRoll = () => ({ answers: { d10: 4, d6: 3 }, up: { d10: 2, d6: 6 }, busy: { d10: 8, d6: 0 } }[S.outB]);
function backupHud() {
  const o = bkRoll(), busy = S.outB === 'busy', col = '#6db3ff', b = S.beat, group = S.outB === 'up' ? BK.up : BK.group;
  if (b < 1) return realCard({ name: BK.org + ' DISPATCH', number: 'NCPD', state: 'dialing', kind: 'Radio' });
  const eta = S.outB === 'up' ? 4 : o.d6;
  let body = '';
  if (S.retry) body = `<div class="ncm-r5-row"><span class="ncm-r5-scan"></span><span>Trying again.</span></div>`;
  else if (b === 1) body = `<div class="ncm-r5-row"><span class="ncm-r5-scan"></span><span><b>Transmitting.</b> ${esc(BK.org)} · TAC-3</span></div>`;
  else if (b === 2) body = `<div class="ncm-r5-row">${die('', 10, true)}<span>Rank ${BK.rank}: you need ${BK.rank} or lower.</span></div>`;
  else if (busy) body = `<div class="ncm-r5-row">${die(o.d10, 10)}<span><b>No units free.</b> Rolled ${o.d10}, needed ${BK.rank} or lower. Try again next Turn.</span></div>`;
  else if (b === 3) body = `<div class="ncm-r5-row">${die(o.d10, 10)}<span><b>${esc(group)} responding.</b> Rolled ${o.d10}.${S.outB === 'up' ? ` The d6 came up 6, so the next group up answers.` : ''}</span></div>`;
  else body = `<div class="ncm-r5-row">${die(eta, 6)}<span><b>${esc(group)} inbound.</b> ${S.rounds ? `${S.rounds} round${S.rounds === 1 ? '' : 's'} out.` : 'Arriving now.'}</span>${pips(S.rounds, eta, 'fa-shield-halved')}</div>`;
  const signal = busy && b >= 3 ? 'static' : b <= 2 ? 'tx' : 'idle';
  return realCard({ name: BK.org + ' DISPATCH', number: 'NCPD', state: 'live', kind: 'Radio', stopLabel: 'Release', frameWord: 'TAC-3', feed: wave(signal, busy && b >= 3 ? '#ff7b7b' : col), panel: `<div class="ncm-r5-em">${steps(B_STEPS, busy && b >= 3 ? 1 : b >= 4 ? 4 : b - 1)}${body}${busy && b >= 3 ? `<div class="ncm-r5-row">${btn('Call again', 'fa-rotate-right', S.nextTurn ? 'Another Action, another roll' : 'Available on your next Turn', `data-do="bkRetry"${S.nextTurn ? '' : ' disabled'}`, S.nextTurn ? 'go' : '')}</div>` : ''}</div>` });
}
function viewBackup() {
  const busy = S.outB === 'busy';
  const sub = S.beat >= 1 && !S.arrived ? subLine(S.beat >= 3 && !busy ? 'Dispatch' : S.beat >= 3 ? 'Dispatch' : BK.name, S.beat >= 3 ? (busy ? 'All units committed. Hold your position.' : 'Copy. Units rolling to Pier 4.') : 'Officer needs assistance, Pier 4.') : '';
  return `<div class="mk-frame"><div class="ncm-r5-ctrl"><label class="ncm-pn-f" data-tooltip="What the dice did"><span>Case</span></label>${seg('oB', S.outB, [['answers', 'They answer', 'd10 at or under Backup rank'], ['up', 'Stronger group', 'The d6 came up 6, so the next group up'], ['busy', 'Nobody free', 'd10 over their rank. Try again next Turn']])}<span class="grow"></span>${btn('Play it again', 'fa-rotate-left', 'From the top', 'data-do="replay"')}${busy && S.beat >= 3 && !S.nextTurn ? btn('Mock: next Turn', 'fa-forward-step', 'In play this follows the combat tracker', 'data-do="nextTurn"') : ''}${!busy && S.beat >= 4 && !S.arrived ? btn('Mock: a round passes', 'fa-forward-step', 'In play this follows the combat tracker, or the GM presses it', 'data-do="roundB"') : ''}</div>
    <div class="ncm-r5-scene ${!S.arrived && !busy && S.beat >= 3 ? 'is-backup' : ''}${S.arrived ? ' is-bkarrive' : ''}" id="scene">
      ${S.arrived ? `<div class="ncm-r5-arrive is-bk"><span class="beam"></span><span class="beam b"></span><div class="in"><i class="fas fa-shield-halved"></i><b>${esc(BK.org)} ON SCENE</b><small>${esc(S.outB === 'up' ? BK.up : BK.group)} · ${esc(BK.where)}</small></div></div>` : `<div class="ncm-call-hud ncm-r5-hud" style="--ch-ring:#6db3ff;--ch-live:#6db3ff;--ch-key:#fff">${backupHud()}</div>${sub}`}
    </div><div class="ncm-r5-under">${chatLog()}${gmSees(busy ? `<b>Rache called for backup</b> and rolled ${bkRoll().d10} against rank ${BK.rank}. Nobody came. Nothing for you to do.` : `<b>Rache called for backup.</b> ${esc(BK.org)} ${esc(S.outB === 'up' ? BK.up : BK.group)} arrive in ${S.outB === 'up' ? 4 : bkRoll().d6} rounds at ${esc(BK.where)}.`)}</div></div>`;
}
const chatCard = (tone, kind, who, num, of, verdict, line, ro) => `<div class="ncm-cc ncm-cc--${tone}" data-tooltip="Posted the moment the die lands. It follows the roll mode, so a player can whisper it"><div class="ncm-cc__rec"><span class="ncm-cc__kind">${esc(kind)}</span><span class="ncm-cc__time">21:47</span><span class="ncm-cc__sub"><span>${esc(who)}</span><span>Pier 4</span></span></div><div class="ncm-cc__hero"><i class="ncm-cc__tr"></i><i class="ncm-cc__bl"></i><div class="ncm-cc__numrow"><div class="ncm-cc__num">${num}${of ? `<small>/ ${of}</small>` : ''}</div><div class="ncm-cc__verdict">${esc(verdict)}<span>${esc(line)}</span></div></div></div><div class="ncm-cc__ro">${ro.map(([k, v]) => `<div><div class="ncm-cc__k">${esc(k)}</div><div class="ncm-cc__v">${esc(v)}</div></div>`).join('')}</div></div>`;
function chatLog() {
  const cards = [];
  if (S.f === 'trauma' && ['called', 'auto'].includes(S.outT) && S.beat >= 4) cards.push(chatCard('gm', 'Trauma Team', TT.name, TT.roll, '', 'Rounds out', 'First in the order on arrival', [['Plan', TT.plan[S.plan][0].replace(' plan', '')], ['1d6', String(TT.roll)], ['Called by', S.outT === 'auto' ? 'Biomonitor' : TT.name]]));
  if (S.f === 'backup') { const o = bkRoll(), busy = S.outB === 'busy', group = S.outB === 'up' ? BK.up : BK.group; if (S.beat >= 3) cards.push(chatCard(busy ? 'fail' : 'ok', 'Backup', BK.name, o.d10, BK.rank, busy ? 'No units free' : 'They answer', busy ? 'Try again next Turn' : group, [['Rank', String(BK.rank)], ['1d10', String(o.d10)]])); if (!busy && S.beat >= 4) cards.push(chatCard('gm', 'Backup', BK.name, S.outB === 'up' ? 4 : o.d6, '', 'Rounds out', group, S.outB === 'up' ? [['First d6', '6'], ['Group', 'Next one up'], ['Second d6', '4']] : [['1d6', String(o.d6)], ['Group', BK.group]])); }
  return `<div class="ncm-r5-chat"><div class="hd"><i class="fas fa-comments"></i> Chat log</div>${cards.join('') || '<small>Nothing rolled yet. The card lands with the die.</small>'}</div>`;
}
const gmSees = (html) => `<div class="ncm-r5-gm"><i class="fas fa-eye"></i><span><small>The GM gets</small> ${html} ${btn('See it on Live', 'fa-tower-broadcast', 'Your row on Live', 'data-do="go" data-f="live"')}</span></div>`;

/* the beats: one list per call, the card keeps animating between them. Reduced motion jumps to the last. */
let timers = [];
function clearBeats() { timers.forEach(clearTimeout); timers = []; }
function skipBeats() { if (!timers.length) return false; clearBeats(); const list = S.f === 'trauma' ? T_BEATS : B_BEATS; if (S.beat >= list.length - 1) return false; S.beat = list.length - 1; return true; }
function play() {
  clearBeats(); Object.assign(S, { beat: 0, arrived: false, hungUp: false, nextTurn: false, retry: false });
  const isT = S.f === 'trauma', list = isT ? T_BEATS : B_BEATS;
  S.rounds = isT ? TT.roll : (S.outB === 'up' ? 4 : bkRoll().d6);
  if (isT && !['called', 'auto'].includes(S.outT)) { S.beat = 0; return; }
  if (reduced() || q0.has('still')) { S.beat = list.length - 1; return; }
  list.forEach((ms, i) => { if (i) timers.push(setTimeout(() => { S.beat = i; S.autoDraw = true; draw(); }, ms)); });
}

/* ─── Live ─── */
const NPC_OTHERS = ['Marcus Vance', 'Haruka Mori', 'Lena Ruiz', 'Dr. Ortega', 'Mama Okoye', 'Sister Anne', 'Nix', 'Cal Brandt', 'Ozzie Fenn'];
const liveQ = () => S.live.q ??= [
  { id: 'c1', caller: 'Rache', to: 'Militech', ext: 'x17', kind: 'corp', wait: 41, asks: 'Tess Valdez', seen: 'Tess Valdez, Militech', voice: 'Clipped, tired, always on another call.', alts: [['Tess Valdez', 'They asked for her', 'Asked for'], ['Militech switchboard', 'They see: Militech', 'Militech, Night City'], ['Harlan Cole', 'Security', 'Militech, Night City'], ['Priya Das', 'Security', 'Militech, Night City']] },
  { id: 'c2', caller: 'Kid Static', to: 'Afterlife front desk', kind: 'shared', wait: 26, asks: 'Rogue', seen: 'Afterlife', note: 'A shared line. Rogue and Judy Alvarez both answer it.', alts: [['Rogue', 'On this line', 'On this line'], ['Judy Alvarez', 'On this line', 'On this line']] },
  { id: 'c3', caller: 'Veronica A.', to: '666', kind: 'special', wait: 18, asks: 'The Voice', seen: 'The Voice', note: 'A special number. It plays its recording unless you take it.', alts: [['The Voice', 'No NPC behind it. You speak for it', 'This number']] },
  { id: 'c4', caller: 'Dex Moreno', to: 'Judy Alvarez', kind: 'npc', wait: 9, asks: 'Judy Alvarez', seen: 'Judy Alvarez', voice: 'Warm, teasing, swears a lot.', alts: [['Judy Alvarez', 'They called her', 'Asked for']] },
  { id: 'c5', caller: 'Rache', to: 'KAB-0417', kind: 'pay', wait: 4, asks: 'Someone there', seen: 'Payphone, Kabuki', note: 'A payphone. Veronica is in reach and can pick up first.', alts: [['Someone there', 'A passer-by', 'At the phone']] },
];
const QKIND = { corp: ['Company', 'fa-building'], shared: ['Shared line', 'fa-users'], special: ['Special', 'fa-star-of-life'], npc: ['NPC', 'fa-user'], pay: ['Payphone', 'fa-phone'] };
const mmss = (n) => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
function queueRow(c, i) {
  const L = S.live, open = (L.open ?? liveQ().find((x) => x.state !== 'hold')?.id) === c.id, held = c.state === 'hold', k = QKIND[c.kind];
  const head = `<button type="button" class="hd" data-do="qOpen" data-id="${c.id}" aria-expanded="${open}" data-tooltip="${open ? 'Fold' : 'Open'} this call"><span class="pos">${i + 1}</span><span class="grow"><b>${esc(c.caller)}</b> calling <b>${esc(c.to)}</b>${c.ext ? ` <b class="mono">${esc(c.ext)}</b>` : ''}</span>${tagp(k[0], c.kind === 'special' ? 'is-secret' : 'is-plain', k[1])}${held ? tagp('On hold ' + mmss(c.wait), 'is-attn', 'fa-pause', 'Their clock has stopped. They see: On hold') : `<span class="ncm-ph2-tm" data-tooltip="How long they have waited. At 30 s it goes to voicemail">${mmss(c.wait)}</span>`}</button>`;
  if (!open) return `<div class="ncm-r5-q${held ? ' is-held' : ''}">${head}</div>`;
  const v = c.voice ? `<div class="voice"><i class="fas fa-comment-dots"></i> ${esc(c.voice)}</div>` : c.note ? `<small>${esc(c.note)}</small>` : '';
  return `<div class="ncm-r5-q is-open${held ? ' is-held' : ''}">${head}<div class="bd">${v}<small>They will see: <b>${esc(c.seen)}</b></small><div class="acts">${btn('Answer as ' + c.asks, 'fa-phone', 'They see: ' + c.seen, `data-do="qAns" data-id="${c.id}" data-as="${esc(c.asks)}"`, 'go')}${btn('Answer as…', 'fa-magnifying-glass', 'Anyone at this company, or any NPC. Search and filter', `data-do="qPick" data-id="${c.id}"`)}${held ? btn('Back to ringing', 'fa-phone-volume', 'Starts their clock again', `data-do="qRing" data-id="${c.id}"`) : btn('Hold', 'fa-pause', 'They see On hold, and it stops their clock so it will not go to voicemail', `data-do="qHold" data-id="${c.id}"`)}${btn('', 'fa-voicemail', 'Send to voicemail', `data-do="qVm" data-id="${c.id}"`, 'ic')}${btn('', 'fa-phone-slash', 'Decline. They hear it ring out', `data-do="qVm" data-id="${c.id}"`, 'ic bad')}</div></div></div>`;
}
function viewLive() {
  const L = S.live, q = liveQ();
  const shown = q.filter((c) => L.filt === 'all' || (L.filt === 'hold' ? c.state === 'hold' : c.kind === L.filt));
  const emergency = !L.arrived ? `<div class="ncm-r5-alarm"><span class="ncm-ph2-face ic"><i class="fas fa-truck-medical"></i></span><div class="grow"><div class="who"><b>Trauma Team</b> for <b>Veronica A.</b> ${tagp('Silver', 'is-act', 'fa-shield-heart')}</div><small>HP 4 of 38 · Pier 4 · Called by Biomonitor</small><div class="ncm-r5-row">${pips(L.rounds, 3, 'fa-truck-medical')}<small>${L.rounds} round${L.rounds === 1 ? '' : 's'} out · no combat running, so you move it on</small></div></div><div class="acts">${btn('−1 round', 'fa-backward-step', 'Follows the combat tracker when there is one', 'data-do="liveRound"')}${btn('They arrive', 'fa-truck-medical', 'Plays the arrival for everyone on the scene', 'data-do="liveArrive"', 'go')}${btn('', 'fa-xmark', 'Call it off. Veronica sees the line drop', 'data-do="toast" data-msg="The team turns back"', 'ic bad')}</div></div>` : `<div class="ncm-pn-check info"><i class="fas fa-truck-medical"></i><span>Trauma Team is on scene at Pier 4. Everyone looking at that scene saw it. The rest is in your book, pages 223 to 224.</span></div>`;
  const act = L.active ? `<div class="ncm-r5-active"><i class="fas fa-phone"></i><span class="grow">You are <b>${esc(L.active.as)}</b>, talking to <b>${esc(L.active.caller)}</b>.<small>Answering another call puts this one on hold.</small></span>${btn('Pass to…', 'fa-right-left', 'Put them through to someone else in the company. They hear: One moment', 'data-do="qPass"')}${btn('', 'fa-phone-slash', 'Hang up', 'data-do="qEnd"', 'ic bad')}</div>` : '';
  return `<div class="ncm-r5-admin"><nav class="ncm-ph2-nav">${['Live', 'Numbers', 'Overheard calls', 'Setup', 'Call log', 'Voicemail', 'Settings'].map((n, i) => `<button type="button" class="ncm-ph2-navbtn${i ? '' : ' on'}" data-do="toast" data-msg="See Rounds 2 to 4" data-tooltip="See Rounds 2 to 4">${esc(n)}</button>`).join('')}</nav>
  <header class="ncm-tabhd"><i class="fas fa-tower-broadcast"></i><div><h2>Live</h2><p>Every call happening now, and the queue of calls for you.</p></div></header>
  <section class="ncm-ph2-mod"><div class="ncm-ph2-mh"><i class="fas fa-truck-medical"></i><b>Emergencies</b><small>They come first, and never wait in the queue</small></div>${emergency}
    <div class="ncm-r5-alarm is-bk"><span class="ncm-ph2-face ic"><i class="fas fa-shield-halved"></i></span><div class="grow"><div class="who"><b>Backup</b> for <b>Rache</b> ${tagp('NCPD', 'is-act')}</div><small>Street Patrol · Pier 4</small><div class="ncm-r5-row">${pips(2, 3, 'fa-shield-halved')}<small>2 rounds out</small></div></div><div class="acts">${btn('−1 round', 'fa-backward-step', 'Follows the combat tracker when there is one', 'data-do="toast" data-msg="1 round out"')}${btn('They arrive', 'fa-shield-halved', 'Plays the arrival for everyone on the scene', 'data-do="toast" data-msg="NCPD on scene"', 'go')}</div></div></section>
  <section class="ncm-ph2-mod ncm-ph2-mod--ring"><div class="ncm-ph2-mh"><i class="fas fa-phone-volume"></i><b>Call queue</b><small>${q.length} waiting, longest first</small></div>${act}
    <div class="ncm-pn-tb"><label class="ncm-pn-sel" data-tooltip="Show one kind of call"><span>Show</span><select id="q-filt" data-ch="qFilt">${[['all', 'All calls'], ['corp', 'Companies'], ['npc', 'NPCs'], ['shared', 'Shared lines'], ['special', 'Special numbers'], ['pay', 'Payphones'], ['hold', 'On hold']].map(([v, t]) => `<option value="${v}"${L.filt === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label><span class="grow"></span>${btn('Hold everyone', 'fa-pause', 'A breather. Nobody goes to voicemail while you catch up', 'data-do="qHoldAll"')}${btn('Voicemail for all', 'fa-voicemail', 'Clears the queue. Each caller hears that person\'s greeting', 'data-do="qVmAll"')}</div>
    <div class="ncm-r5-qlist" data-sc="q">${shown.map((c) => queueRow(c, q.indexOf(c))).join('') || '<div class="ncm-ph2-none">Nobody is waiting.</div>'}</div></section>
  <section class="ncm-ph2-mod"><div class="ncm-ph2-mh"><i class="fas fa-ear-listen"></i><b>Overheard calls running</b><small>Two NPCs, and who is listening</small></div>
    <div class="ncm-r5-over"><i class="fas fa-tower-broadcast"></i><div class="grow"><b>The Pier 4 shipment</b><small>Rogue and Marcus Vance · line 3 of 6 · 2 listening</small></div>${face('Veronica A.')}${face('Rache')}${btn('Open', 'fa-up-right-from-square', 'The running screen', 'data-do="go" data-f="typelive"')}</div></section>
  <section class="ncm-ph2-mod"><div class="ncm-ph2-mh"><i class="fas fa-shuffle"></i><b>Switchboard</b><small>Every other call, as it works today</small></div><div class="ncm-ph2-none">Unchanged from what is built.</div></section></div>`;
}
function qAnswer(id, as) { const L = S.live, q = liveQ(), i = q.findIndex((x) => x.id === id), c = q[i]; if (L.active) { q.push({ ...L.active.call, state: 'hold', wait: 0 }); toast(L.active.caller + ' is on hold.'); } q.splice(q.indexOf(c), 1); L.active = { as, caller: c.caller, call: c }; L.open = null; }
function pickFor(c, title) { const entries = [...c.alts.map(([name, sub, group]) => ({ id: name, name, sub, group, icon: 'fas fa-user-tie' })), ...NPC_OTHERS.filter((n) => !c.alts.some(([x]) => x === n)).map((n) => ({ id: n, name: n, sub: 'NPC', group: 'Anyone else', icon: 'fas fa-user' }))]; return window.NCM_PICK.showNamePicker({ title, hint: 'Who picks up? Search, or filter by company', entries, placeholder: 'search people…' }); }

/* ─── in range ─── */
function viewRange() {
  const R = S.rg, doubled = R.who === 'Rache', range = (Number(R.squares) || 0) * (doubled ? 2 : 1);
  const placed = R.anchor !== 'off', same = placed && R.scene === 'same', byScene = R.rule === 'scene', near = byScene || Number(R.dist) <= range + .5, blocked = R.walls && R.wall && !byScene, inRange = same && near && !blocked;
  const check = (ok, text) => `<div class="ncm-r5-chk ${ok === null ? 'na' : ok ? 'ok' : 'no'}"><i class="fas ${ok === null ? 'fa-minus' : ok ? 'fa-check' : 'fa-xmark'}"></i><span>${esc(text)}</span></div>`;
  const px = Math.min(760, 140 + Number(R.dist) * 26), ringR = byScene ? 0 : range * 26;
  return `<div class="mk-frame"><div class="ncm-r5-ctrl"><div class="ncm-pn-f" data-tooltip="Set on the call. Where the person on the phone is standing"><span>Rogue is at</span>${seg('rgAnchor', R.anchor, [['token', 'Their token', 'Follows their token on the scene'], ['spot', 'A spot I click', 'For an NPC with no token, or one you have not placed'], ['off', 'Off-screen', 'Nobody can be in the room with them']])}</div><div class="ncm-pn-f" data-tooltip="Eavesdropping rules, under Setup"><span>Near means</span>${seg('rgRule', R.rule, [['tokens', 'Tokens in range', 'A token within this many squares'], ['scene', 'Same scene', 'Anyone on the scene']])}</div><label class="ncm-pn-chk" data-tooltip="Eavesdropping rules. Uses the walls on your map"><input type="checkbox" id="rg-walls" data-ch="rgWalls"${R.walls ? ' checked' : ''}><span>Walls block it</span></label></div>
    <div class="ncm-r5-map is-range"><span class="grid"></span>${placed && !byScene ? `<span class="rng${inRange ? ' on' : ''}" style="width:${ringR * 2}px;height:${ringR * 2}px;margin:${-ringR}px"></span>` : ''}${placed ? '<span class="tok npc" data-tooltip="Rogue, on a call">RO</span>' : ''}${R.wall ? '<span class="wall" data-tooltip="A wall on the map"></span>' : ''}${R.scene === 'same' ? `<span class="tok pc${inRange ? ' on' : ''}" style="left:${px}px" data-tooltip="${esc(R.who)}">${esc(R.who.slice(0, 2).toUpperCase())}</span>` : ''}${inRange ? toastHtml('fa-person-rays', 'Someone nearby is on a call', 'Rogue, about ' + R.dist + ' squares away. You could listen in.', btn('Listen', 'fa-ear-listen', 'Hears the side nearby, from this line on', 'data-do="toast" data-msg="The intercept screen opens"', 'go') + btn('Leave it', '', 'It will not ask again on this call', 'data-do="toast" data-msg="It stays quiet"'), '#ffb454') : ''}</div>
    <div class="ncm-r5-ctrl"><label class="ncm-pn-f" data-tooltip="Whose token, and whose sheet"><span>Player</span><select id="rg-who" data-ch="rgWho">${['Rache', 'Veronica A.'].map((n) => `<option value="${esc(n)}"${R.who === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label><label class="ncm-pn-f ncm-r5-slide" data-tooltip="Mock: drag their token"><span>Token is ${esc(R.dist)} squares away</span><input type="range" id="rg-dist" data-ch="rgDist" min="1" max="24" value="${esc(R.dist)}"></label>${btn(R.wall ? 'Mock: remove the wall' : 'Mock: wall between them', 'fa-border-all', 'Only matters with Walls block it on', 'data-do="rgWall"')}${btn(R.scene === 'same' ? 'Mock: they change scene' : 'Mock: they come back', 'fa-map', 'On another scene', 'data-do="rgScene"')}</div>
    <div class="ncm-r5-chks"><b>${inRange ? 'They get the prompt.' : 'No prompt.'}</b>
      ${check(placed, placed ? (R.anchor === 'token' ? 'Rogue has a token on this scene' : 'You clicked where Rogue is') : 'Rogue is off-screen, so nobody can be in the room. A tap, node or scanner still can')}
      ${check(same && placed ? true : placed ? false : null, same ? 'The player has a token on that scene' : 'The player is on another scene')}
      ${byScene ? check(null, 'Same scene is enough, so distance does not count') : check(same && placed ? near : null, R.dist + ' squares away. Needs ' + range + (doubled ? ' (6 doubled by Amplified Hearing)' : ''))}
      ${R.walls && !byScene ? check(same && placed ? !R.wall : null, R.wall ? 'A wall is in the way' : 'No wall in the way') : ''}
      <small>Checked when the call starts and whenever a token moves, so walking up mid-call works. It asks once per call, and hidden NPC tokens still count. Measured centre to centre, the same way terminal pins measure their reach.</small></div></div>`;
}

/* ─── I type it live ─── */
function viewTypeLive() {
  const T = S.tl, who = T.side === 'a' ? 'Rogue' : 'Marcus Vance';
  return `<div class="mk-frame"><div class="ncm-r5-scene" id="scene"><div class="ncm-call-hud ncm-r5-hud" style="--ch-ring:#b87aff;--ch-live:#b87aff;--ch-key:#f7c948">${realCard({ name: 'Rogue and Marcus Vance', state: 'live', kind: 'Overheard call', stopLabel: 'End the call', frameWord: '2 LISTENING', feed: `<div class="ncm-r5-feed"><span class="ncm-r5-listen"><i class="fas fa-ear-listen"></i><b>2</b></span></div>` })}</div>
    <div class="ncm-ch-subs ncm-r5-subs"><div class="ncm-ch-sublines">${T.lines.slice(-3).map((x, i, a) => `<div class="ncm-ch-sub${i === a.length - 1 ? ' now' : ''}"><b>${esc(x.side === 'a' ? 'Rogue' : 'Marcus Vance')}:</b> <span class="tx"${i === a.length - 1 && T.fresh ? ` data-type="${esc(x.text)}"` : ''}>${i === a.length - 1 && T.fresh ? '' : esc(x.text)}</span></div>`).join('')}</div></div></div>
    <div class="ncm-r5-compose" data-tooltip="Only on the GM's screen. Lines reach each listener garbled by how they got in">
      ${seg('tlSide', T.side, [['a', 'Rogue', 'The next line is theirs. Tab switches'], ['b', 'Marcus Vance', 'The next line is theirs. Tab switches']])}
      <input type="text" id="tl-in" data-in="tlDraft" value="${esc(T.draft)}" placeholder="What ${esc(who)} says, then Enter" aria-label="What ${esc(who)} says" autocomplete="off">
      ${seg('tlVoice', T.voice, [['text', 'Text', 'Subtitles, typed out'], ['tts', 'Read out', 'The browser reads it aloud, with subtitles'], ['rec', 'Hold to speak', 'Records your voice. Dictate fills in the words where it can']])}
      ${btn('Send', 'fa-paper-plane', 'Enter also sends', 'data-do="tlSend"', 'go')}
      <small class="ncm-r5-hint">Enter sends and passes to the other side. Tab switches who is talking. Lines marked Clue, Lie or Code word are a click away in the running screen.</small>
    </div></div>`;
}

/* ─── player prompts + scan + node console ─── */
const seenToast = new Set();
function toastHtml(icon, title, detail, acts, color) { const again = seenToast.has(title); seenToast.add(title); return `<div class="ncm-toast ncm-toast--info ncm-r5-toast${again ? ' is-seen' : ''}" style="--toast-color:${color}"><div class="ncm-toast__accent"></div><div class="ncm-toast__icon"><i class="fas ${icon}"></i></div><div class="ncm-toast__body"><div class="ncm-toast__title">${esc(title)}</div><div class="ncm-toast__detail">${esc(detail)}</div><div class="ncm-r5-tacts">${acts}</div></div></div>`; }
function viewPrompts() {
  const P = S.pr;
  const nodeCtx = { state: 'on', color: '#19f3f7', hex: '0xB57F', networkName: 'CitiNet', firmware: 'RELAY-OS 4.2', isUp: true, icon: 'fas fa-tower-cell', signal: 78, here: 3, name: 'Pier 4 relay', kindLabel: 'Relay', place: 'Pier 4', stateLabel: 'On', rate: '', statusTags: [{ tone: 'act', icon: 'fa-plug', label: 'Jacked in · 2 moves' }], operator: { name: 'Kid Static', img: '', skill: 'Interface', rank: 5 }, bars: [{ on: 1, h: 5 }, { on: 1, h: 8 }, { on: 1, h: 11 }, { on: 0, h: 14 }], alertPips: [{ cls: '' }, { cls: '' }, { cls: '' }], alertLabel: 'Quiet', session: { pips: [{ on: 1 }, { on: 1 }, { on: 0 }], left: 2, total: 3, who: 'Kid Static', formula: 'Interface 5 + d10', actions: [
    { key: 'listen', run: true, icon: 'fa-ear-listen', label: 'Listen to traffic', have: S.nodeHeard ? 'Listening' : '1 call on this node', blurb: 'Hear both sides, part garbled.', dvText: 'DV 11', note: 'costs a move', noteTone: 'attn' },
    { key: 'tap', run: true, icon: 'fa-plug', label: 'Tap this node', blurb: 'Copy what passes through.', dvText: 'DV 11', note: 'costs a move', noteTone: 'attn' },
    { key: 'jam', run: true, icon: 'fa-wave-square', label: 'Jam it', blurb: 'Take the network down here.', dvText: 'DV 7', note: 'costs a move', noteTone: 'attn' },
    { key: 'sweep', run: true, icon: 'fa-binoculars', label: 'System sweep', blurb: 'See what someone left here.', dvText: 'DV 9', note: 'free', noteTone: 'good' }] }, ticker: [{ text: 'relay handshake ok' }], connectHint: '', jackHint: '', switchHint: '', switchLabel: 'Switch off' };
  return `<div class="mk-frame">
    <div class="ncm-r5-two"><div><h4>1 · In range of someone on a call</h4><div class="ncm-r5-scene is-small">${P.room === 'prompt' ? toastHtml('fa-person-rays', 'Someone nearby is on a call', 'Rogue, about 5 squares away. You could listen in.', `${btn('Listen', 'fa-ear-listen', 'Hears the side nearby, from this line on', 'data-do="prRoom" data-v="on" id="pr-room"', 'go')}${btn('Leave it', '', 'It stays quiet. It will not ask again on this call', 'data-do="prRoom" data-v="off"')}`, '#ffb454') : P.room === 'on' ? `<div class="ncm-r5-note"><i class="fas fa-ear-listen"></i> The intercept screen from Round 4 opens, picking up on this line.</div>` : `<div class="ncm-r5-note">Left it. Nothing else appears.</div>`}</div><small>Never automatic. It appears when they come in range, even mid-call, and waits about 30 seconds. It does not interrupt with a sound louder than a message toast.</small></div>
    <div><h4>2 · Their tap hears a call</h4><div class="ncm-r5-scene is-small">${P.tap === 'prompt' ? toastHtml('fa-plug', 'Your tap picked something up', 'A live call on the Pier 4 relay.', `${btn('Listen', 'fa-ear-listen', 'Both sides, part garbled', 'data-do="prTap" data-v="on" id="pr-tap"', 'go')}${btn('Let it record', 'fa-floppy-disk', 'A copy lands in EXFIL when the call ends', 'data-do="prTap" data-v="off"')}`, '#b87aff') : `<div class="ncm-r5-note"><i class="fas fa-${P.tap === 'on' ? 'ear-listen' : 'floppy-disk'}"></i> ${P.tap === 'on' ? 'The intercept screen opens.' : 'A copy lands in EXFIL when the call ends.'}</div>`}</div><small>Uses the module's normal toast. Stacks with other toasts rather than covering them.</small></div></div>
    <div class="ncm-r5-two"><div><h4>3 · Scan, in the Calls tab</h4><div class="ncm-r5-agent"><div class="ncm-r5-scanbar">${itemChip('Radio Scanner/Music Player', 'Carried', 'is-yes')}<span class="grow"></span>${btn(P.scanned ? 'Scan again' : 'Scan', 'fa-satellite-dish', 'Looks for calls on this scene, with no node needed', 'data-do="prScan" id="pr-scan"', 'go')}</div>${P.scanned ? `<div class="ncm-r5-scanres"><div class="ncm-r5-row"><i class="fas fa-wave-square"></i><span class="grow"><b>1 call on this scene</b><small>Heavily garbled. Someone at Pier 4.</small></span>${btn('Listen', 'fa-ear-listen', 'Hears both sides, about a quarter clear', 'data-do="toast" data-msg="The intercept screen opens"', 'go')}</div></div>` : ''}<div class="ncm-r5-dim">The rest of the Calls tab: your line, the dial pad, your log</div></div><small>This strip sits at the top of the Calls tab, only while their sheet has a scanner. No scanner, no strip.</small></div>
    <div><h4>4 · Listen to traffic, in the real node console</h4><div class="ncm-node-console-wrap">${nodeTpl(nodeCtx)}</div><small>The real template, with one new action in the session list.</small></div></div></div>`;
}

/* ─── payphones ─── */
function viewPay() {
  const P = S.pay;
  return `<div class="mk-frame"><div class="ncm-r5-ctrl">${btn(P.ringing ? 'Mock: it stops' : 'Mock: someone calls it', 'fa-phone-volume', 'Rache dials KAB-0417', 'data-do="payRing"')}${btn(P.near ? 'Mock: token walks away' : 'Mock: token walks over', 'fa-person-walking', 'In reach or not', 'data-do="payNear"')}</div>
    <div class="ncm-r5-map"><span class="grid"></span><span class="ring${P.ringing ? ' is-ringing' : ''}"></span><button type="button" class="pin${P.ringing ? ' is-ringing' : ''}" data-do="payOpen" id="pay-pin" data-tooltip="Payphone. Double-click on the map, like any access point"><i class="fas fa-phone"></i></button><span class="lab">Payphone, Kabuki</span><span class="tok${P.near ? ' near' : ''}" data-tooltip="Veronica A.">VA</span>
      ${P.ringing && P.near ? toastHtml('fa-phone-volume', 'A payphone is ringing', 'Right next to you.', `${btn('Pick up', 'fa-phone', 'Answer it. The caller sees: Payphone, Kabuki', 'data-do="toast" data-msg="Answered" id="pay-up"', 'go')}${btn('Let it ring', '', 'Anyone else near it can still answer', 'data-do="payRing"')}`, '#ffb454') : ''}
      ${P.calling === 'far' ? `<div class="ncm-r5-note ncm-r5-mapnote"><i class="fas fa-person-walking"></i> You are too far away.</div>` : ''}</div>
    ${P.calling === true ? `<div class="ncm-r5-agent"><div class="ncm-r5-scanbar"><i class="fas fa-phone"></i><span class="grow"><b>Calling from the payphone</b><small>KAB-0417, Kabuki. Whoever you call sees this place, not you. A Trace finds the place.</small></span>${btn('Use my own line', 'fa-sim-card', 'Back to your number', 'data-do="payClose"')}</div><div class="ncm-r5-dim">The real dial pad, with Calling as set to this payphone</div></div>` : ''}
    <div class="ncm-r5-gm"><i class="fas fa-eye"></i><span><small>The GM</small> places it with the same <b>Place on a scene…</b> dialog as a terminal: a pin, a step-on area or both, reach in squares, hidden until revealed. It is listed under Access points, with its number under Numbers. It holds no owner, and only its call log is saved. ${btn('See it on Live', 'fa-tower-broadcast', 'A call to it, on Live', 'data-do="go" data-f="live"')}</span></div></div>`;
}

/* ─── draw ─── */
const FRAMES = {
  trauma: { title: 'Trauma Team', view: viewTrauma, player: true, note: '<b>Trauma Team.</b> Your real call screen, in emergency colours. About nine seconds. The rolled card lands in the chat log with the die, and a click on the scene skips ahead. Press Mock: a round passes to the end for the arrival.' },
  backup: { title: 'Lawman Backup', view: viewBackup, player: true, note: '<b>Lawman Backup.</b> A radio, not a call. About nine seconds. Each die lands with its chat card, and a click on the scene skips ahead. Try Stronger group and Nobody free.' },
  live: { title: 'Live', view: viewLive, note: '<b>Admin → Live.</b> The only frame here that follows Dark, Light and Contrast. Emergencies stay on top; everything else is a queue, longest wait first, with one call open at a time. Answer as… opens the real picker with search and filters. Try Hold everyone, then answer two calls.' },
  typelive: { title: 'I type it live', view: viewTypeLive, player: true, note: '<b>I type it live.</b> An overheard call with no script. Type a line and press Enter: it goes out and passes to the other person. Tab switches who is talking.' },
  prompts: { title: 'Player prompts', view: viewPrompts, player: true, note: '<b>What players actually get.</b> The real toast, a Scan strip in the Calls tab, and the real node console with Listen to traffic added.' },
  range: { title: 'In range', view: viewRange, player: true, note: '<b>How in range works.</b> Drag the slider, or change the player: Rache has Amplified Hearing, which doubles the range. Try Off-screen and Walls block it. The prompt appears the moment they are close enough, even mid-call.' },
  pay: { title: 'Payphones', view: viewPay, player: true, note: '<b>Payphones.</b> Lowest priority: uncommon in the setting, so it is built last and can slip. A pin on the map, using access points. Double-click it to call from it. When someone calls it, the pin rings for anyone in reach. Press the pin, then try walking away.' },
};
const win = document.getElementById('win'), stage = document.getElementById('stage'), tipEl = document.getElementById('mk-tip');
function draw() {
  const a = document.activeElement, focus = a?.id && stage.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  const F = FRAMES[S.f];
  document.querySelectorAll('.mk-bar [data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === S.f));
  document.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === S.t));
  document.getElementById('note').innerHTML = F.note;
  win.setAttribute('data-ncm-admin-theme', F.player ? 'clean-dark' : S.t); win.classList.toggle('is-player', !!F.player);
  stage.innerHTML = `<div class="ncm-ph2"><div class="ncm-pn">${F.view()}</div></div>`;
  stage.querySelectorAll('[data-type]').forEach((el) => typeIn(el, el.dataset.type)); S.tl.fresh = false;
  runCanvases();
  if (focus) { const el = document.getElementById(focus.id); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(focus.s, focus.e); } catch { /* not text */ } } }
}
let toastT; function toast(m) { const t = document.getElementById('mk-toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200); }
const roundDown = (done) => { S.rounds = Math.max(0, S.rounds - 1); if (!S.rounds) { S.arrived = true; done?.(); } };
const ACT = {
  go: (el) => { S.f = el.dataset.f; if (S.f === 'trauma' || S.f === 'backup') play(); else clearBeats(); },
  toast: (el) => { toast(el.dataset.msg); return false; },
  oT: (el) => { S.outT = el.dataset.v; play(); }, oP: (el) => { S.plan = el.dataset.v; play(); }, oB: (el) => { S.outB = el.dataset.v; play(); },
  replay: () => { play(); }, roundT: () => { roundDown(); }, roundB: () => { roundDown(); }, hangT: () => { S.hungUp = true; },
  nextTurn: () => { S.nextTurn = true; }, bkRetry: () => { S.outB = 'answers'; play(); },
  liveRound: () => { S.live.rounds = Math.max(0, S.live.rounds - 1); if (!S.live.rounds) S.live.arrived = true; }, liveArrive: () => { S.live.arrived = true; },
  qOpen: (el) => { const id = el.dataset.id, cur = S.live.open ?? liveQ().find((x) => x.state !== 'hold')?.id; S.live.open = cur === id ? '' : id; },
  qAns: (el) => { qAnswer(el.dataset.id, el.dataset.as); },
  qPick: (el) => { const c = liveQ().find((x) => x.id === el.dataset.id); pickFor(c, 'Answer as').then((p) => { if (p && !p.none) { qAnswer(c.id, p.name); draw(); } }); return false; },
  qPass: () => { const a = S.live.active; pickFor(a.call, 'Pass to').then((p) => { if (p && !p.none) { a.as = p.name; toast(a.caller + ' hears: One moment. You are now ' + p.name + '.'); draw(); } }); return false; },
  qEnd: () => { S.live.active = null; },
  qHold: (el) => { const c = liveQ().find((x) => x.id === el.dataset.id); c.state = 'hold'; S.live.open = null; },
  qRing: (el) => { liveQ().find((x) => x.id === el.dataset.id).state = ''; },
  qVm: (el) => { const q = liveQ(); q.splice(q.findIndex((x) => x.id === el.dataset.id), 1); S.live.open = null; toast('Sent to voicemail'); },
  qHoldAll: () => { liveQ().forEach((c) => { c.state = 'hold'; }); S.live.open = null; },
  qVmAll: () => { S.live.q = []; toast('Everyone went to voicemail'); },
  rgAnchor: (el) => { S.rg.anchor = el.dataset.v; }, rgRule: (el) => { S.rg.rule = el.dataset.v; }, rgWall: () => { S.rg.wall = !S.rg.wall; }, rgScene: () => { S.rg.scene = S.rg.scene === 'same' ? 'other' : 'same'; },
  tlSide: (el) => { S.tl.side = el.dataset.v; }, tlVoice: (el) => { S.tl.voice = el.dataset.v; }, tlSend: () => { sendLine(); },
  prRoom: (el) => { S.pr.room = el.dataset.v; }, prTap: (el) => { S.pr.tap = el.dataset.v; }, prScan: () => { S.pr.scanned = true; },
  payRing: () => { S.pay.ringing = !S.pay.ringing; }, payNear: () => { S.pay.near = !S.pay.near; if (S.pay.calling === 'far') S.pay.calling = false; }, payOpen: () => { S.pay.calling = S.pay.near ? true : 'far'; }, payClose: () => { S.pay.calling = false; },
};
function sendLine() { const T = S.tl, v = T.draft.trim(); if (!v) return; T.lines.push({ side: T.side, text: v }); T.draft = ''; T.fresh = true; T.side = T.side === 'a' ? 'b' : 'a'; }
document.addEventListener('click', (e) => {
  const bar = e.target.closest('.mk-bar button');
  if (bar) { if (bar.dataset.f) { S.f = bar.dataset.f; if (S.f === 'trauma' || S.f === 'backup') play(); else clearBeats(); } if (bar.dataset.t) S.t = bar.dataset.t; draw(); return; }
  const n = e.target.closest('.ncm-ndc__sa[data-key="listen"]'); if (n) { S.nodeHeard = true; toast('Rolled against DV 11. The intercept screen opens.'); draw(); return; }
  const el = e.target.closest('[data-do]');
  if (!el && e.target.closest('#scene') && (S.f === 'trauma' || S.f === 'backup')) { if (skipBeats()) draw(); return; }
  if (!el || !stage.contains(el) || el.disabled) return;
  if (ACT[el.dataset.do]?.(el) !== false) draw();
});
document.addEventListener('change', (e) => { const id = e.target.id; if (id === 'q-filt') { S.live.filt = e.target.value; S.live.open = null; draw(); } else if (id === 'rg-walls') { S.rg.walls = e.target.checked; draw(); } else if (id === 'rg-who') { S.rg.who = e.target.value; draw(); } else if (id === 'rg-dist') { S.rg.dist = Number(e.target.value); draw(); } });
document.addEventListener('input', (e) => { if (e.target.dataset?.in === 'tlDraft') S.tl.draft = e.target.value; });
document.addEventListener('keydown', (e) => { if (e.target.id !== 'tl-in') return; if (e.key === 'Enter') { e.preventDefault(); sendLine(); draw(); document.getElementById('tl-in')?.focus(); } else if (e.key === 'Tab') { e.preventDefault(); S.tl.side = S.tl.side === 'a' ? 'b' : 'a'; draw(); document.getElementById('tl-in')?.focus(); } });
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest?.('[data-tooltip]'); if (!t) { tipEl.hidden = true; return; }
  tipEl.textContent = t.dataset.tooltip; tipEl.hidden = false; const r = t.getBoundingClientRect(), pr = tipEl.getBoundingClientRect();
  tipEl.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - pr.width / 2, innerWidth - pr.width - 6))}px`; tipEl.style.top = `${r.top - pr.height - 6 < 4 ? r.bottom + 6 : r.top - pr.height - 6}px`;
});
if (S.f === 'trauma' || S.f === 'backup') play();
draw();
window.NCM_R5 = { S, draw, play, clearBeats, vitals, T_BEATS, B_BEATS };
