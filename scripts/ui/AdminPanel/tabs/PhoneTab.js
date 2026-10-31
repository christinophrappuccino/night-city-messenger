/**
 * Admin → Phone (COMMS) — the GM's side of calls.
 * @file scripts/ui/AdminPanel/tabs/PhoneTab.js
 * @module night-city-messenger
 * @description Mock dev/mockups/admin-phone-mock.html, design dev/design/CALLS.md §10. Four views: LIVE (NPC lines
 *   ringing for the GM — answer as the identity, decline — and the switchboard of every call in the world, with Drop),
 *   NUMBERS (every character and directory contact with a line; give, change, take away), CALL LOG (every call, by day)
 *   and SETTINGS (how calls work at this table). Gathering lives here, the rules in phoneModel.js. Context key `phone2`,
 *   built only while the tab is on screen. Voicemail and transcripts are phase 2 (CALLS.md §11).
 */

import { networkLoad } from '../../../utils/callNet.js';
import { BaseTab } from '../BaseTab.js';
import { MODULE_ID } from '../../../utils/constants.js';
import { getPlayerCharacters, formatCyberDate, resolveDisplayPortrait } from '../../../utils/helpers.js';
import { showNamePicker } from '../../../utils/namePicker.js';
import { themedConfirm, themedPrompt } from '../../../utils/adminTheme.js';
import { dialogBodyHtml } from '../../../utils/dialogBody.js';
import { formatDuration } from '../../../utils/callModel.js';
import { PHONE_VIEWS, LOG_FILTERS, NUMBER_SHOW, liveBoard, numberGroups, logView, settingsView, voicemailBoxes } from './phoneModel.js';
import { GREETING_KINDS, GREETING_LABELS, DEFAULT_GREETING, GREETING_MAX } from '../../../utils/voicemail.js';
import { speak, voices, canSpeak } from '../../Calls/speech.js';
import { VoiceRecorder, micStatus, blobToBase64, playAudio } from '../../Calls/recorder.js';
import { adminDialog } from '../../../utils/adminTheme.js';

const SETTING_KEYS = ['callsEnabled', 'callModes', 'callDefaultMode', 'callHomeCode', 'callRingSeconds', 'callUnknownNumbers', 'callTranscriptNotice',
  'voicemailRecording', 'voicemailMaxSeconds', 'voicemailKeepDays'];

/** Why the GM dropped a call — shown on both ends under "Call dropped". */
const DROP_REASONS = [
  ['signal', 'The signal broke up', 'fas fa-signal'],
  ['jam', 'The line was jammed', 'fas fa-tower-broadcast'],
  ['dead', 'Dead zone — no signal', 'fas fa-ban'],
  ['cut', 'The line went dead', 'fas fa-plug-circle-xmark'],
  ['traced', 'Someone traced the call', 'fas fa-crosshairs'],
];

export class PhoneTab extends BaseTab {
  get key() { return 'phone'; }

  constructor(app) {
    super(app);
    this._view = 'live';
    this._q = '';
    this._show = 'all';
    this._logQ = '';
    this._logFilter = 'all';
    this._logPage = 1;
    this._shut = new Set();
    this._open = new Set();
    this._tick = null;
    /** calls whose typed lines the GM is following on the switchboard */
    this._listen = new Set();
  }

  get calls() { return game.nightcity?.callService; }

  /** Open on a view from openAdminTab('phone', { select: 'numbers' | 'log' | 'settings' | 'live' }). */
  openTo(select) {
    if (PHONE_VIEWS.some(([k]) => k === select)) this._view = select;
  }

  // ═══════════════════════════════ context ═══════════════════════════════

  prepareContext() {
    if (this.app._activeTab !== 'phone') return { phone2: null };
    const s = this.calls;
    if (!s) return { phone2: { missing: true } };
    const ctx = {
      view: this._view, enabled: s.enabled, isPopout: !!this.app.isPopout,
      nav: PHONE_VIEWS.map(([key, label, icon]) => ({ key, label, icon, on: key === this._view })),
    };
    const mcs = game.nightcity?.masterContactService;
    try {
      // LIVE is cheap and drives the nav count, so it is always built
      const live = liveBoard(s.allCalls(), {
        now: Date.now(), ringMs: s.ringMs, ringsForMe: (c) => s._ringsHere(c), roleOf: (c) => s._role(c),
        voiceOf: (id) => mcs?.getContact?.(id)?.voice || '', listening: this._listen,
      });
      for (const id of [...this._listen]) if (!s.calls.has(id)) this._listen.delete(id);
      ctx.nav.find((n) => n.key === 'live').count = live.ringing.length || live.lines.length || 0;
      ctx.nav.find((n) => n.key === 'live').hot = live.ringing.length > 0;
      // voicemail: the nav counts unheard messages left for NPCs (the ones only the GM can pick up)
      const vmb = voicemailBoxes(s.allVoicemails?.() || [], {
        ownerName: (v) => (v.ownerIsContact ? mcs?.getContact?.(v.ownerId)?.name : game.actors?.get(v.ownerId)?.name) || v.to?.name || 'Unknown',
        isNpc: (v) => v.ownerIsContact || !game.actors?.get(v.ownerId)?.hasPlayerOwner,
        fmt: (t) => formatCyberDate(t), shut: this._shut, open: this._open,
      });
      const vmNav = ctx.nav.find((n) => n.key === 'vm');
      if (vmNav) { vmNav.count = vmb.npcUnheard; vmNav.hot = vmb.npcUnheard > 0; }
      if (this._view === 'vm') ctx.vm = vmb;
      if (this._view === 'live') { ctx.live = live; ctx.load = this._load(s); }

      if (this._view === 'numbers') {
        const pcs = getPlayerCharacters().map((p) => ({ ...p, img: p.actor?.img || '' }));
        const contacts = (mcs?.getAll?.() || []).map((c) => ({ ...c, img: c.portrait || '' }));
        const n = numberGroups({ lines: s.lines(), pcs, contacts, q: this._q, show: this._show, shut: this._shut, open: this._open });
        ctx.numbers = { ...n, q: this._q, show: NUMBER_SHOW.map(([k, l]) => ({ k, l, on: k === this._show })) };
      }
      if (this._view === 'log') {
        const v = logView(s.allLogs(), {
          q: this._logQ, filter: this._logFilter, page: this._logPage,
          fmtDay: (d) => formatCyberDate(`${d}T12:00:00.000Z`, { dateOnly: true }),
          fmtTime: (t) => formatCyberDate(t, { timeOnly: true }),
        });
        this._logPage = v.page;
        ctx.log = { ...v, q: this._logQ, filters: LOG_FILTERS.map(([k, l]) => ({ k, l, n: v.counts[k] || 0, on: k === this._logFilter })) };
      }
      if (this._view === 'settings') {
        const vals = Object.fromEntries(SETTING_KEYS.map((k) => { try { return [k, game.settings.get(MODULE_ID, k)]; } catch { return [k, undefined]; } }));
        ctx.settings = settingsView(vals, { modesAvailable: ['loud', 'type', 'dictate'] });
        const recs = (s.allVoicemails?.() || []).filter((v) => v.kind === 'audio' && v.audio);
        ctx.settings.recordings = recs.length;
        ctx.settings.recordingsInline = recs.filter((v) => String(v.audio).startsWith('data:')).length;
      }
    } catch (err) {
      console.error('NCM | Phone tab:', err);
      ctx.error = err.message;
    }
    return { phone2: ctx };
  }

  // ═══════════════════════════════ DOM ═══════════════════════════════

  onRender() {
    const root = this.element?.querySelector('.ncm-ph2');
    if (!root) return;
    // searches re-render after a pause (never per key)
    root.querySelectorAll('[data-ph-q]').forEach((q) => q.addEventListener('input', () => {
      clearTimeout(this._qT);
      this._qT = setTimeout(() => {
        if (q.dataset.phQ === 'log') { this._logQ = q.value; this._logPage = 1; } else this._q = q.value;
        this.app.render();
      }, 220);
    }));
    // selects (a <select> with data-action fires on click, not change)
    root.querySelectorAll('select[data-ph-sel]').forEach((sel) => sel.addEventListener('change', () => {
      if (sel.dataset.phSel === 'show') this._show = sel.value;
      this.app.render();
    }));
    // settings write as they change
    root.querySelectorAll('[data-ph-set]').forEach((el) => el.addEventListener('change', () => this._saveSetting(el)));
    // folds: DOM only
    root.querySelectorAll('[data-ph-fold]').forEach((h) => h.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const g = h.closest('[data-ph-group]');
      if (!g) return;
      const key = g.dataset.phGroup;
      const shut = !g.classList.contains('is-shut');
      g.classList.toggle('is-shut', shut);
      h.setAttribute('aria-expanded', String(!shut));
      if (shut) { this._shut.add(key); this._open.delete(key); } else { this._open.add(key); this._shut.delete(key); }
    }));
    // timers + ring clocks tick on the live DOM
    clearInterval(this._tick);
    if (root.querySelector('[data-ph-since], [data-ph-ring]')) {
      const ringMs = this.calls?.ringMs || 30000;
      const step = () => {
        if (!root.isConnected) { clearInterval(this._tick); return; }
        const now = Date.now();
        root.querySelectorAll('[data-ph-since]').forEach((el) => { el.textContent = formatDuration(Math.max(0, Math.round((now - Number(el.dataset.phSince)) / 1000))); });
        root.querySelectorAll('[data-ph-ring]').forEach((el) => {
          const t0 = Number(el.dataset.phRing);
          el.style.setProperty('--p', `${Math.min(100, Math.max(0, (now - t0) / ringMs * 100))}%`);
          const left = el.parentElement?.querySelector('[data-ph-left]');
          if (left) left.textContent = `${Math.max(0, Math.round((ringMs - (now - t0)) / 1000))} s`;
        });
      };
      this._tick = setInterval(step, 1000);
    }
  }

  onClose() {
    clearInterval(this._tick);
    clearTimeout(this._qT);
  }

  // ═══════════════════════════════ actions ═══════════════════════════════

  async onAct(op, event, target) {
    const d = target.dataset;
    const s = this.calls;
    switch (op) {
      case 'view': this._view = d.view; return this.app.render();
      case 'clearQ': if (d.which === 'log') this._logQ = ''; else this._q = ''; return this.app.render();
      case 'foldAll': {
        const open = d.open === '1';
        this._shut.clear(); this._open.clear();
        for (const g of this.element?.querySelectorAll('.ncm-ph2 [data-ph-group]') ?? []) (open ? this._open : this._shut).add(g.dataset.phGroup);
        return this.app.render();
      }
      case 'logFilter': this._logFilter = d.f || 'all'; this._logPage = 1; return this.app.render();
      case 'logPage': this._logPage = Math.max(1, this._logPage + Number(d.d || 0)); return this.app.render();
      // live
      case 'answer': s?.answer(d.id); return this.app.render();
      case 'decline': s?.decline(d.id); return this.app.render();
      case 'hangup': s?.hangup(d.id); return this.app.render();
      case 'drop': {
        const why = await showNamePicker({ title: 'Drop the call', hint: 'Both sides see the call drop, and this reason under it.', placeholder: 'search reasons…',
          entries: DROP_REASONS.map(([id, name, icon]) => ({ id, name, icon })) });
        if (why?.id) s?.drop(d.id, DROP_REASONS.find((r) => r[0] === why.id)?.[1] || undefined);
        return this.app.render();
      }
      case 'glitch': s?.glitch(d.id); return;
      case 'callAs': return this._callAs(d.contactId);
      // voicemail
      case 'vmPlay': speak(d.text || '', { voice: d.voice || '' }); if (d.heard !== '1') await s?.setVoicemailHeard(d.ownerId, d.vm, true); return this.app.render();
      case 'vmHeard': await s?.setVoicemailHeard(d.ownerId, d.vm, d.heard === '1'); return this.app.render();
      case 'vmDel': {
        const ok = await themedConfirm({ title: 'Delete voicemail', bad: true, yes: 'Delete', yesIcon: 'fas fa-trash',
          content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-voicemail', title: 'Delete this voicemail?', lead: 'It cannot be brought back.' }) });
        if (ok) await s?.deleteVoicemail(d.ownerId, d.vm);
        return this.app.render();
      }
      case 'vmCallBack': {
        const as = d.toContact ? { contactId: d.toContact } : { actorId: d.toActor };
        const r = await s?.placeCall(d.number, as);
        if (r && !r.ok && r.error) ui.notifications?.warn(r.error);
        this._view = 'live'; return this.app.render();
      }
      case 'vmReply': {
        const mcs = game.nightcity?.masterContactService;
        const fromContact = d.toContact ? mcs?.getContact?.(d.toContact) : null;
        return game.nightcity?.composeMessage?.({ ...(fromContact ? { fromContact } : { fromActorId: d.toActor }), toActorId: d.fromActor || null, toContactId: d.fromContact || null, subject: 'Re: your message' });
      }
      case 'greeting': return this._editGreeting(d.number, d.name);
      case 'purge': {
        const days = this.calls?.keepDays || 0;
        if (!days) { ui.notifications?.info('Keep recordings is set to forever — set a number of days first.'); return; }
        const ok = await themedConfirm({ title: 'Purge old recordings', bad: true, yes: 'Purge', yesIcon: 'fas fa-broom',
          content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-broom', title: `Recordings older than ${days} days`,
            lead: 'Their recordings are cleared from the voicemails; any words they had stay.',
            hint: 'Files already saved in the world\'s **ncm-voicemail** folder stay on disk — Foundry cannot delete files. Delete them in your file browser if you need the space.' }) });
        if (!ok) return;
        const r = await this.calls.purgeRecordings(days);
        ui.notifications?.info(`Cleared ${r.count} recording${r.count === 1 ? '' : 's'}.`);
        return this.app.render();
      }
      case 'listen': if (this._listen.has(d.id)) this._listen.delete(d.id); else this._listen.add(d.id); return this.app.render();
      // numbers
      case 'give': return this._give();
      case 'change': return this._change({ actorId: d.actorId || null, contactId: d.contactId || null, name: d.name, number: d.number });
      case 'release': return this._release(d.number, d.name);
      case 'openContact': return game.nightcity?.openAdminTab?.('contacts', { select: d.contactId });
      default: return false;
    }
  }

  // ═══════════════════════════════ helpers ═══════════════════════════════

  /** Edit any number's greeting + voicemail switches (an NPC's, or a player's on their behalf). */
  async _editGreeting(number, name) {
    const s = this.calls;
    if (!s || !number) return;
    const set = s.lineSettings(number);
    const g = set.greeting;
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const content = dialogBodyHtml({ tone: 'act', icon: 'fas fa-voicemail', title: name || number, sub: number, kind: 'Line',
      extraHtml: `<div class="ncm-ph2-gr" data-kind="${g.kind}">
        <label class="ncm-ph2-gr__row"><span>Greeting</span><select name="kind">${GREETING_KINDS.map((k) => `<option value="${k}"${k === g.kind ? ' selected' : ''}>${GREETING_LABELS[k]}</option>`).join('')}</select></label>
        <div class="ncm-ph2-gr__rec">${this.calls.recordingOn && micStatus().ok ? '<button type="button" data-gr-rec><i class="fas fa-circle"></i> Record</button>' : `<span class="hint">${esc(!this.calls.recordingOn ? 'Recordings are switched off (Settings).' : micStatus().reason)}</span>`}
          <button type="button" data-gr-play><i class="fas fa-play"></i> Play</button><span class="hint" data-gr-rect>${g.audio ? 'A recording is saved.' : 'Up to 20 seconds.'}</span></div>
        <textarea name="text" rows="3" maxlength="${GREETING_MAX}" placeholder="${esc(DEFAULT_GREETING)}">${esc(g.text)}</textarea>
        ${canSpeak() ? `<label class="ncm-ph2-gr__row ncm-ph2-gr__voice"><span>Voice</span><select name="voice"><option value="">This browser's default voice</option></select></label>` : ''}
        <div class="ncm-ph2-gr__row"><button type="button" data-gr-preview><i class="fas fa-play"></i> Preview</button><span class="hint">Voices are this computer's; another computer may read it in its own default voice.</span></div>
        <label class="ncm-ph2-gr__chk"><input type="checkbox" name="on"${set.voicemail.on ? ' checked' : ''}> Take messages</label>
        <label class="ncm-ph2-gr__chk"><input type="checkbox" name="dnd"${set.voicemail.dnd ? ' checked' : ''}> Do not disturb — calls go straight to voicemail</label>
      </div>` });
    let out = null;
    let clip = null; let rec = null;
    await new Promise((resolve) => {
      adminDialog({
        title: 'Greeting & voicemail', content,
        buttons: {
          no: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
          yes: { icon: '<i class="fas fa-check"></i>', label: 'Save', callback: (html) => {
            const root = html[0] ?? html;
            out = { greeting: { kind: root.querySelector('[name=kind]').value, text: root.querySelector('[name=text]').value, voice: root.querySelector('[name=voice]')?.value || '' },
              voicemail: { on: root.querySelector('[name=on]').checked, dnd: root.querySelector('[name=dnd]').checked } };
          } },
        },
        default: 'yes',
        render: (html) => {
          const root = html[0] ?? html;
          const box = root.querySelector('.ncm-ph2-gr');
          root.querySelector('[name=kind]')?.addEventListener('change', (e) => { box.dataset.kind = e.target.value; });
          const sel = root.querySelector('[name=voice]');
          if (sel) voices().then((list) => { sel.innerHTML = `<option value="">This browser's default voice</option>` + list.map((v) => `<option value="${esc(v.name)}"${v.name === g.voice ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join(''); });
          const rect = root.querySelector('[data-gr-rect]');
          root.querySelector('[data-gr-rec]')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            if (rec?.recording) { clip = await rec.stop(); rec = null; btn.innerHTML = '<i class="fas fa-rotate-left"></i> Again'; if (rect) rect.textContent = `${formatDuration(clip.ms / 1000)} recorded — Save to keep it`; return; }
            rec = new VoiceRecorder();
            try { await rec.start({ maxMs: 20000, onTick: (ms) => { if (rect) rect.textContent = `${formatDuration(ms / 1000)} / 0:20`; }, onLimit: () => btn.click() }); btn.innerHTML = '<i class="fas fa-square"></i> Stop'; }
            catch (err) { ui.notifications?.warn(err.message); rec = null; }
          });
          root.querySelector('[data-gr-play]')?.addEventListener('click', () => { const src = clip?.blob ? URL.createObjectURL(clip.blob) : g.audio; if (src) playAudio(src); else ui.notifications?.info('Nothing recorded yet.'); });
          root.querySelector('[data-gr-preview]')?.addEventListener('click', () => {
            const kind = root.querySelector('[name=kind]').value;
            const text = kind === 'default' ? DEFAULT_GREETING : (root.querySelector('[name=text]').value || DEFAULT_GREETING);
            if (kind === 'tts' || kind === 'default') speak(text, { voice: sel?.value || '' });
            else ui.notifications?.info(`Callers will see: “${text}”`);
          });
        },
        close: () => { rec?.cancel?.(); resolve(); },
      }, { width: 460, classes: ['dialog', 'ncm-themed-dialog'] }).render(true);
    });
    if (!out) return;
    let r;
    if (out.greeting.kind === 'recorded') {
      if (clip?.blob?.size) r = await s.saveRecordedGreeting(number, out, { base64: await blobToBase64(clip.blob), mime: clip.mime, ms: clip.ms });
      else if (g.audio) r = await s.saveLineSettings(number, { ...out, greeting: { ...out.greeting, audio: g.audio, duration: g.duration } });
      else { ui.notifications?.warn('Record a greeting first.'); return; }
    } else r = await s.saveLineSettings(number, out);
    if (!r.ok) ui.notifications?.warn(r.error); else ui.notifications?.info(`${name || number}: greeting saved.`);
    return this.app.render();
  }

  /** NETWORK LOAD: calls on each network right now and today, and the networks a node is cutting on the viewed scene. */
  _load(s) {
    const ns = game.nightcity?.networkService;
    let today = '';
    try { today = String(game.nightcity?.timeService?.getCurrentTime?.() || '').slice(0, 10); } catch { /* no clock */ }
    const nets = (ns?.getAllNetworks?.() || []).map((n) => ({ id: n.id, name: n.name, color: n.theme?.color || n.color || '' }));
    let blocks = {};
    try { blocks = ns?.getSceneBlocks?.(game.scenes?.viewed?.id) || {}; } catch { /* none */ }
    return networkLoad({ calls: s.allCalls(), logs: s.allLogs(), nets, today, blocks });
  }

  /** Call a player's character (or anyone with a number) as an NPC identity. */
  async _callAs(contactId = null) {
    const s = this.calls; const mcs = game.nightcity?.masterContactService;
    if (!s) return;
    let id = contactId;
    if (!id) {
      const npcs = (mcs?.getAll?.() || []).filter((c) => !c.sendOnly && s.numberOfContact(c.id));
      if (!npcs.length) { ui.notifications?.warn('No NPC has a number yet — give one in Phone → Numbers.'); return; }
      const pick = await showNamePicker({ title: 'Call as…', hint: 'The NPC (or alias) the call comes from.', placeholder: 'search NPCs…',
        entries: npcs.map((c) => ({ id: c.id, name: c.name, img: resolveDisplayPortrait({ contactId: c.id }) || 'icons/svg/mystery-man.svg', sub: s.numberOfContact(c.id) })) });
      if (!pick?.id) return;
      id = pick.id;
    }
    if (!s.numberOfContact(id)) { ui.notifications?.warn('That contact has no number — give them one first.'); return; }
    const targets = getPlayerCharacters().map((p) => ({ id: p.actorId, name: p.actorName, img: p.actor?.img || '', sub: s.numberOf(p.actorId) || 'no number', group: 'Players' }))
      .filter((t) => t.sub !== 'no number');
    if (!targets.length) { ui.notifications?.warn("No player's character has a number yet."); return; }
    const who = await showNamePicker({ title: `Call as ${mcs?.getContact?.(id)?.name || 'NPC'}…`, hint: 'Who to ring.', placeholder: 'search characters…', entries: targets });
    if (!who?.id) return;
    const how = await showNamePicker({ title: 'Their screen shows…', hint: 'A withheld number shows as Unknown caller; they can try to trace it.',
      entries: [{ id: 'show', name: `${mcs?.getContact?.(id)?.name || 'The NPC'} — ${s.numberOfContact(id)}`, icon: 'fas fa-id-badge' },
        { id: 'anon', name: 'Number withheld', icon: 'fas fa-user-secret' }] });
    if (!how?.id) return;
    const r = await s.placeCall(s.numberOf(who.id), { contactId: id, anon: how.id === 'anon' });
    if (r && !r.ok && r.error) ui.notifications?.warn(r.error);
    this._view = 'live';
    return this.app.render();
  }

  /** Give a number: pick a character (players first) or a directory contact, then the number. */
  async _give() {
    const s = this.calls; const mcs = game.nightcity?.masterContactService;
    const entries = [
      ...getPlayerCharacters().map((p) => ({ id: `a:${p.actorId}`, name: p.actorName, img: p.actor?.img || '', sub: s.numberOf(p.actorId) || 'no number yet', group: "Players' characters" })),
      ...(mcs?.getAll?.() || []).filter((c) => !c.sendOnly).map((c) => ({ id: `c:${c.id}`, name: c.name, img: resolveDisplayPortrait({ contactId: c.id }) || 'icons/svg/mystery-man.svg',
        sub: s.numberOfContact(c.id) || (c.identityOf ? 'alias · no number' : 'no number yet'), group: 'Directory' })),
    ];
    const pick = await showNamePicker({ title: 'Give a number', hint: 'Who gets it? Someone who already has one gets a new one.', placeholder: 'search…', entries });
    if (!pick?.id) return;
    const [k, id] = [pick.id.slice(0, 1), pick.id.slice(2)];
    return this._change({ actorId: k === 'a' ? id : null, contactId: k === 'c' ? id : null, name: pick.name, number: '' });
  }

  async _change({ actorId, contactId, name, number }) {
    const s = this.calls;
    const fresh = s.suggestNumbers({ count: 1 })[0]?.number || '';
    const value = await themedPrompt({
      title: number ? 'Change the number' : 'Give a number', label: 'Use this number', icon: 'fas fa-sim-card',
      content: dialogBodyHtml({ tone: 'act', icon: 'fas fa-sim-card', title: name || 'Number', sub: number ? `now ${number}` : 'no number yet',
        lead: 'A made-up number from the fiction range is filled in. Type any number you like instead.',
        field: { label: 'Number', name: 'number', value: fresh, placeholder: '+1 (555) 555-0123' },
        hint: number ? 'The old number stops working: calling it gives **not in service**.' : '' }),
      read: (root) => root.querySelector('input[name=number]')?.value?.trim() || null,
    });
    if (!value) return;
    const r = await s.assignNumber({ actorId, contactId, number: value });
    if (!r.ok) ui.notifications?.warn(r.error);
    else ui.notifications?.info(`${name || 'They'} now answer on ${r.number || value}.`);
    return this.app.render();
  }

  async _release(number, name) {
    const ok = await themedConfirm({ title: 'Take the number away', bad: true, yes: 'Take it away', yesIcon: 'fas fa-fire',
      content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-fire', title: number, sub: name || '',
        lead: 'Anyone who calls it hears **not in service**.', goes: ['the number'], stays: ['the call log', 'their contacts and mail'] }) });
    if (!ok) return;
    await this.calls?.releaseNumber(number);
    return this.app.render();
  }

  async _saveSetting(el) {
    const key = el.dataset.phSet;
    let val;
    if (key === 'callModes') {
      val = [...this.element.querySelectorAll('[data-ph-set="callModes"]:checked')].map((c) => c.value);
      if (!val.length) { ui.notifications?.warn('Leave at least one way to talk.'); el.checked = true; return; }
    } else if (el.type === 'checkbox') val = el.checked;
    else if (key === 'callRingSeconds') val = Math.min(120, Math.max(5, Number(el.value) || 30));
    else if (key === 'voicemailMaxSeconds') val = Math.min(180, Math.max(10, Number(el.value) || 60));
    else if (key === 'voicemailKeepDays') val = Math.min(3650, Math.max(0, Math.round(Number(el.value) || 0)));
    else if (key === 'callHomeCode') { const d = String(el.value).replace(/\D/g, ''); val = d ? `+${d}` : '+1'; }
    else val = el.value;
    if (!SETTING_KEYS.includes(key)) return;
    try {
      await game.settings.set(MODULE_ID, key, val);
      // a start mode that was just switched off falls back to the first one left
      if (key === 'callModes' && !val.includes(game.settings.get(MODULE_ID, 'callDefaultMode'))) await game.settings.set(MODULE_ID, 'callDefaultMode', val[0]);
    } catch (err) { ui.notifications?.error(`Could not save: ${err.message}`); }
    this.app.render();
  }
}
