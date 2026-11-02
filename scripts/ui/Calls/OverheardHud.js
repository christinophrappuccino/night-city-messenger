/**
 * Overheard calls on a player's screen: the prompt, and the intercept.
 * @file scripts/ui/Calls/OverheardHud.js
 * @module night-city-messenger
 * @description The real call screen (`CallHud._callHtml`) with the word Intercept, Stop listening and no talk modes. Lines arrive
 *   already garbled, and type out like a real call; garbled words type as garble. Spec PHONE-REVISION.md §12, §17.
 */

import { CallHud } from './CallHud.js';
import { typeOutMs } from '../../utils/callModel.js';
import { resolveOperator } from '../../utils/helpers.js';
import { OVERHEARD_WAYS } from '../../utils/overheard.js';
import { speak } from './speech.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduced = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export class OverheardHud {
  constructor(service, calls) {
    this.service = service; this.calls = calls;
    this.fake = { calls: new Map(), usableModes: [], offeredModes: [], modeFor: () => 'loud', _get: (k, d) => d, homeCode: calls?.homeCode };
    this.hud = new CallHud(this.fake);
    this.hud._other = (c) => c.from;
    this.cur = null; this.root = null; this.prompts = null;
  }

  /** What the GM's client sent. */
  receive(d) {
    if (d.op === 'prompt') return this._prompt(d);
    if (d.op === 'none') { ui.notifications?.info(d.way === 'scanner' ? 'Nothing on the air here.' : 'You pick up nothing.'); return; }
    if (d.op === 'joined') { this.cur = { runId: d.runId, label: d.label, net: d.net, from: d.from, skill: d.skill, dv: d.dv, lines: new Map(), note: '', enhanced: 0, saved: false }; this._paint(); return; }
    if (!this.cur || this.cur.runId !== d.runId) { if (d.op === 'saved' && d.ok) ui.notifications?.info('Saved to your EXFIL folder.'); return; }
    if (d.op === 'line') { const had = this.cur.lines.has(d.line.i); this.cur.lines.set(d.line.i, d.line); this._subs(had || d.again ? null : d.line.id); if (d.line.tts && !d.again) speak(this._spoken(d.line)); return; }
    if (d.op === 'click') { this.cur.note = 'A click on the line.'; this._subs(); return; }
    if (d.op === 'ended') { this.cur.note = 'The call has ended.'; this.cur.over = true; this._paint(); setTimeout(() => this._close(), 5000); return; }
    if (d.op === 'cut') { this.cur.note = 'The line went dead.'; this.cur.over = true; this._paint(); setTimeout(() => this._close(), 4000); return; }
    if (d.op === 'saved') { this.cur.saved = !!d.ok; ui.notifications?.[d.ok ? 'info' : 'warn'](d.ok ? 'Saved to your EXFIL folder.' : 'It could not be saved.'); }
  }

  /** Only the words they caught are read out. */
  _spoken(line) { const box = document.createElement('div'); box.innerHTML = line.html || ''; box.querySelectorAll('.ncm-r4-gl').forEach((n) => n.remove()); return box.textContent; }

  _mount() {
    if (this.root?.isConnected) return this.root;
    this.root = document.createElement('div');
    this.root.className = 'ncm-r5-layer ncm-r4-intercept';
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => this._click(e));
    return this.root;
  }

  _paint() {
    const c = this.cur; if (!c) return;
    const id = 'ov', now = Date.now();
    const call = { id, from: { name: c.label, number: '', img: 'NOFACE', contactId: null }, to: { userId: game.user.id, name: '', number: '', kind: 'player' }, net: { id: 'x', name: c.net || '', type: '', strength: 60, color: '' }, mode: 'loud', state: 'live', startedAt: now - 2300, answeredAt: now, endedAt: null, outcome: null };
    this.fake.calls.set(id, call);
    let html = this.hud._callHtml({ call, role: 'caller' }, {});
    html = html.replaceAll('Holocall', 'Intercept').replace('Hang up', 'Stop listening');
    html = html.replace('<img src="NOFACE" alt="">', '<span class="ncm-ch-ini" aria-hidden="true"><span class="sw"><span class="tr"></span><span class="dot"></span><span class="dot b"></span></span><b><i class="fas fa-ear-listen"></i></b></span>');
    this._mount().innerHTML = `<div class="ncm-r5-scene"><div class="ncm-call-hud ncm-r5-hud" style="--ch-ring:#F65261;--ch-live:#b87aff;--ch-key:#f7c948">${html}</div><div class="ncm-ch-subs ncm-r5-subs" data-ov-subs></div><div class="ncm-r4-tools"><button type="button" data-ov="enhance" data-tooltip="${esc(c.skill)} against DV ${esc(c.dv)}. Beat it by more and more words clear"><i class="fas fa-wand-magic-sparkles"></i> Enhance</button><button type="button" data-ov="save" data-tooltip="To your EXFIL folder, as garbled as you heard it, from the line you joined on"><i class="fas fa-floppy-disk"></i> Save</button></div></div>`;
    this._subs();
    clearInterval(this._tick);
    const t0 = performance.now();
    this._tick = setInterval(() => { if (!this.root?.isConnected) return clearInterval(this._tick); this.root.querySelectorAll('.ncm-ch-badge').forEach((b) => this.hud._paintBadge(b, performance.now() - t0)); }, 120);
  }

  _subs(fresh = null) {
    const c = this.cur, box = this.root?.querySelector('[data-ov-subs]'); if (!c || !box) return;
    const list = [...c.lines.values()].sort((a, b) => a.i - b.i).slice(-4);
    const head = c.from > 0 && list[0]?.i === c.from ? `<div class="ncm-ch-sub typing">Picked up on line ${c.from + 1}. Earlier lines were missed.</div>` : '';
    box.innerHTML = `<div class="ncm-ch-sublines">${head}${list.map((x, n) => (x.html === null ? `<div class="ncm-ch-sub"><b>${esc(x.who)}:</b><span class="tx ncm-r4-none">[can't hear this side]</span></div>` : `<div class="ncm-ch-sub${n === list.length - 1 ? ' now' : ''}" data-line="${esc(x.id)}"><b>${esc(x.who)}:</b> <span class="tx">${x.html}</span>${x.stress ? '<span class="ncm-r4-stress"><i class="fas fa-wave-square"></i> voice stress</span>' : ''}</div>`)).join('')}${c.note ? `<div class="ncm-ch-sub typing">${esc(c.note)}</div>` : ''}${!list.length && !c.note ? '<div class="ncm-ch-sub typing">Listening…</div>' : ''}</div>`;
    if (fresh && !reduced()) this._typeIn(box.querySelector(`[data-line="${CSS.escape(fresh)}"]`));
  }

  /** Same speed as a real call. Garbled words stay garbled while they type. */
  _typeIn(el) {
    const tx = el?.querySelector('.tx'); if (!tx) return;
    const parts = [...tx.childNodes].map((n) => ({ text: n.textContent, cls: n.nodeType === 1 ? n.className : '' }));
    const plain = parts.map((p) => p.text).join(''), ms = typeOutMs(plain), t0 = performance.now();
    const paint = (k) => { tx.textContent = ''; let left = k; for (const p of parts) { if (left <= 0) break; const piece = p.text.slice(0, left); left -= piece.length; if (p.cls) { const sp = document.createElement('span'); sp.className = p.cls; sp.textContent = piece; tx.appendChild(sp); } else tx.appendChild(document.createTextNode(piece)); } };
    paint(0);
    const tick = (now) => { if (!tx.isConnected) return; const k = Math.ceil(Math.min(1, (now - t0) / ms) * plain.length); paint(k); if (k < plain.length) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  async _click(e) {
    const c = this.cur; if (!c) return;
    const act = e.target.closest?.('[data-act]')?.dataset.act, ov = e.target.closest?.('[data-ov]')?.dataset.ov;
    if (act === 'hangup') { if (!c.over) this.service.leave(c.runId); this._close(); return; }
    if (ov === 'save') { this.service.saveHeard(c.runId); return; }
    if (ov === 'enhance') {
      const actor = resolveOperator(); if (!actor) return;
      const r = await game.nightcity?.skillService?.performCheck?.(actor, c.skill, { dc: c.dv, context: 'Cleaning up an intercept', ask: { title: 'Enhance' }, reveal: { title: 'Enhancing the signal', ctx: 'Clearing the noise', ok: 'Words come through', no: 'Nothing new' } });
      if (r?.cancelled) return;
      if (r?.success) this.service.enhanceBy(c.runId, 15 + Math.max(0, (Number(r.total) || 0) - c.dv) * 5);
    }
  }

  _close() { clearInterval(this._tick); this.cur = null; this.root?.remove(); this.root = null; }

  /** A toast with Listen and Leave it. It asks once per call, and declining is final for that call. */
  _prompt(d) {
    let box = document.getElementById('ncm-r4-prompts');
    if (!box) { box = document.createElement('div'); box.id = 'ncm-r4-prompts'; document.body.appendChild(box); }
    const room = d.way === 'room', way = OVERHEARD_WAYS[d.way];
    const el = document.createElement('div');
    el.className = 'ncm-toast ncm-toast--info ncm-r5-toast';
    el.style.setProperty('--toast-color', room ? '#ffb454' : '#b87aff');
    el.innerHTML = `<div class="ncm-toast__accent"></div><div class="ncm-toast__icon"><i class="fas ${way.icon}"></i></div><div class="ncm-toast__body"><div class="ncm-toast__title">${room ? 'Someone nearby is on a call' : 'Your tap is picking up a call'}</div><div class="ncm-toast__detail">${esc(d.text)}. You could listen in.</div><div class="ncm-r5-tacts"><button type="button" data-go><i class="fas fa-ear-listen"></i> Listen</button><button type="button" data-no>Leave it</button></div></div>`;
    box.appendChild(el);
    const off = () => el.remove();
    el.querySelector('[data-go]').addEventListener('click', () => { this.service.join(d.runId, d.way, d.actorId); off(); });
    el.querySelector('[data-no]').addEventListener('click', off);
    setTimeout(off, 30000);
  }
}
