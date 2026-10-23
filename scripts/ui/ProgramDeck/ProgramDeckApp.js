/**
 * Program Deck — a cyberdeck cartridge reader for the programs on a data shard.
 * @file scripts/ui/ProgramDeck/ProgramDeckApp.js
 * @module night-city-messenger
 * @description Opened from a data shard: the shard's programs (malware/payload) shown as
 *   cartridges seated in slots — click one to pull it into the inspector (the program as
 *   the workshop's synthesis artifact) and act on it (Analyze / Deploy / Execute). Ported
 *   from the dev-approved mock (dev/mockups/shard-program-deck-mock.html). Player-facing:
 *   a disguised, un-analysed program shows as its innocuous COVER cartridge until ANALYZE
 *   reveals it; the GM always sees the real identity. Actions delegate to the same
 *   SiphonFlow flows the shard viewer uses.
 *
 *   Render model mirrors the workshop: the PART template is a bare root; `_mount()` builds
 *   the deck from live data and interactions patch the DOM (an action that mutates state
 *   re-reads + re-mounts).
 */

import { MODULE_ID, TEMPLATES, CONTENT_TYPES } from '../../utils/constants.js';
import { log, isGM, resolveOperator, canEncode } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { runAnalyze, runMalwareDeploy, runPayloadExecute } from '../content/SiphonFlow.js';
import { FAMILY, COVER_TYPES, THREAT_WORD, abilityInfo, programGroup, entryToProgram } from '../content/ProgramModel.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAP = 6;

export class ProgramDeckApp extends BaseApplication {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-program-deck',
    classes: ['ncm-app', 'ncm-program-deck'],
    window: { title: 'Program Deck', icon: 'fas fa-hard-drive', resizable: true, minimizable: true },
    position: { width: 880, height: 600 },
  }, { inplace: false });

  static PARTS = { main: { template: TEMPLATES.PROGRAM_DECK } };

  constructor(options = {}) {
    super(options);
    this.item = options.item ?? null;
    this.selId = null;
  }

  get title() { return this.item ? `Program Deck — ${this.item.name}` : 'Program Deck'; }
  async _prepareContext() { return {}; }
  _onRender(context, options) { super._onRender(context, options); this._mount(); }

  g(id) { return this.element?.querySelector('#' + id) ?? document.getElementById(id); }

  /** The shard's program entries (malware/payload). */
  _programs() {
    if (!this.item) return [];
    try {
      return (game.nightcity?.dataShardService?.getShardMessages(this.item) || [])
        .filter((e) => e.contentType === CONTENT_TYPES.MALWARE || e.contentType === CONTENT_TYPES.PAYLOAD);
    } catch { return []; }
  }

  /** What the viewer perceives — a disguised, unrevealed program reads as its cover. */
  _view(e) {
    const cd = e.contentData || {};
    const revealed = isGM() || !cd.disguised || cd.sniffed || cd.deployed || cd.tripped;
    const prog = entryToProgram(e);
    const fam = programGroup(prog);
    const info = abilityInfo(prog.verb);
    if (revealed) {
      const blurb = prog.verb === 'plant' ? 'leaves a forged file for whoever looks next' : (info?.blurb || 'runs a routine you describe');
      return {
        name: cd.program || cd.name || 'program',
        icon: cd.iconClass || (e.contentType === CONTENT_TYPES.MALWARE ? 'fas fa-biohazard' : 'fas fa-virus'),
        fam, famWord: FAMILY[fam]?.word || 'Program', blurb, real: true,
        threat: Number(cd.threat) || 0, type: e.contentType === CONTENT_TYPES.MALWARE ? 'Malware' : 'Payload',
        disguised: !!cd.disguised,
      };
    }
    const passLabel = COVER_TYPES.find((c) => c.value === cd.disguiseType)?.label || 'a plain note';
    return {
      name: cd.name || 'file', icon: cd.coverIcon || 'fas fa-note-sticky', fam: 'Utility', famWord: 'Unidentified',
      blurb: `looks like ${passLabel}. A scan reports nothing.`, real: false, passLabel,
      detectDV: Number(cd.sniffDV) || 15, type: 'Unknown',
    };
  }

  _mount() {
    const root = this.g('pd'); if (!root) return;
    const progs = this._programs();
    if (this.selId == null || !progs.some((e) => e.id === this.selId)) this.selId = progs[0]?.id ?? null;

    if (!progs.length) {
      root.style.setProperty('--fam', 'var(--ncm-secondary,#19f3f7)');
      root.innerHTML = `${this._headHTML(0)}<div class="ncm-pd-empty" style="flex:1;display:flex;align-items:center;justify-content:center;padding:30px;text-align:center;font-family:var(--ncm-font-body,sans-serif);font-size:12.5px;color:var(--ncm-text-muted,#7a8b99);">No programs on this shard.<br>A GM builds them in the Malware Workshop.</div>`;
      this._wire(root);
      return;
    }

    const sel = progs.find((e) => e.id === this.selId) || progs[0];
    const sv = this._view(sel);
    root.style.setProperty('--fam', FAMILY[sv.fam]?.v || 'var(--ncm-secondary,#19f3f7)');
    root.innerHTML = `
      ${this._headHTML(progs.length)}
      <div class="ncm-pd-rack">${this._rackHTML(progs)}</div>
      <div class="ncm-pd-insp">
        <div class="ncm-pd-insp__stage">
          <div class="ncm-pd-core"><span class="ncm-pd-ring"></span><span class="ncm-pd-ring ncm-pd-ring--2"></span><span class="ncm-pd-core__chip"><i class="${esc(sv.icon)}"></i></span></div>
          <div class="ncm-pd-stage__n">${esc(sv.name)}</div>
          <div class="ncm-pd-stage__pass">${sv.real ? (sv.disguised ? 'the real thing' : 'no disguise') : 'passes for ' + esc(sv.passLabel)}</div>
          <div class="ncm-pd-stage__fam">${esc(sv.famWord)}</div>
        </div>
        <div class="ncm-pd-detail">${this._detailHTML(sel, sv)}</div>
      </div>`;
    this._wire(root);
  }

  _headHTML(used) {
    return `<div class="ncm-pd-hd">
      <div class="ncm-pd-hd__ic"><i class="fas fa-hard-drive"></i></div>
      <div><div class="ncm-pd-hd__n">${esc(this.item?.name || 'Data Shard')}</div><div class="ncm-pd-hd__s">Program deck${isGM() ? ' · GM lens' : ''}</div></div>
      <div class="ncm-pd-hd__cap"><div class="ncm-pd-hd__caplbl">${used} / ${CAP} slots</div>
        <div class="ncm-pd-hd__slots">${Array.from({ length: CAP }, (_, i) => `<b class="${i < used ? 'on' : ''}"></b>`).join('')}</div></div>
    </div>`;
  }

  _rackHTML(progs) {
    const cart = (e) => {
      const v = this._view(e), lf = FAMILY[v.fam]?.v || 'var(--ncm-secondary)';
      const led = v.real ? 'var(--ncm-success,#00d97e)' : 'var(--ncm-warning,#ffab00)';
      return `<div class="ncm-pd-cart ${e.id === this.selId ? 'sel' : ''}" style="--lf:${lf};--led:${led}" data-act="pick" data-v="${e.id}">
        <div class="ncm-pd-cart__body"><span class="ncm-pd-cart__led"></span>
          <div class="ncm-pd-cart__chip"><i class="${esc(v.icon)}"></i></div>
          <div class="ncm-pd-cart__n">${esc(v.name)}</div>
          <div class="ncm-pd-cart__t">${v.real ? esc(v.type) : 'Unknown'}</div>
        </div></div>`;
    };
    const empty = `<div class="ncm-pd-cart ncm-pd-cart--empty" style="--lf:var(--ncm-border)"><div class="ncm-pd-cart__body"><div class="ncm-pd-cart__chip"><i class="fas fa-plus"></i></div><div class="ncm-pd-cart__n" style="color:var(--ncm-text-muted)">empty</div><div class="ncm-pd-cart__t">slot</div></div></div>`;
    // The FIRST empty slot is a door into the Encoder's Program branch — the
    // netrunner's way to make their own cartridge. Only when the GM allows it
    // AND this operator qualifies under the authoring gate; otherwise the slot
    // stays a plain "empty" rather than a button that opens and refuses.
    const mayEncode = canEncode(resolveOperator()).ok;
    const newSlot = `<div class="ncm-pd-cart ncm-pd-cart--empty ncm-pd-cart--new" style="--lf:var(--ncm-secondary,#19f3f7)" data-act="encode" data-tooltip="Build a program of your own" data-tooltip-direction="UP"><div class="ncm-pd-cart__body"><div class="ncm-pd-cart__chip"><i class="fas fa-plus"></i></div><div class="ncm-pd-cart__n">New</div><div class="ncm-pd-cart__t">program</div></div></div>`;
    let html = progs.map(cart).join('');
    for (let i = progs.length; i < CAP; i++) html += (mayEncode && i === progs.length) ? newSlot : empty;
    return html;
  }

  _detailHTML(e, v) {
    const fact = (icon, k, val) => `<div class="ncm-pd-fact"><span class="ncm-pd-fact__i"><i class="fas ${icon}"></i></span><span><span class="ncm-pd-fact__k">${k}</span><span class="ncm-pd-fact__v">${val}</span></span></div>`;
    const cd = e.contentData || {};
    if (!v.real) {
      const tag = `<span class="ncm-pd-tag ncm-pd-tag--hidden"><i class="fas fa-mask"></i>Unidentified — analyze to reveal</span>`;
      return `<div class="ncm-pd-detail__does">${esc(v.blurb)}</div>
        <div class="ncm-pd-facts">${fact('fa-file', 'Reads as', esc(v.passLabel))}${fact('fa-triangle-exclamation', 'Threat', 'unknown')}${fact('fa-database', 'Status', tag)}</div>
        <div class="ncm-pd-actions"><button class="ncm-pd-btn ncm-pd-btn--go" data-act="analyze" data-v="${e.id}"><i class="fas fa-magnifying-glass"></i>Analyze · DV ${v.detectDV}</button></div>`;
    }
    const tag = `<span class="ncm-pd-tag ncm-pd-tag--known"><i class="fas fa-check"></i>Identified</span>`;
    const threat = `<span class="ncm-pd-threat">${[0, 1, 2, 3].map((j) => `<b class="${j < v.threat ? 'on' : ''}"></b>`).join('')}</span> ${THREAT_WORD[v.threat]}`;
    const isMal = e.contentType === CONTENT_TYPES.MALWARE;
    const spent = isMal ? cd.deployed : cd.executed;
    const goBtn = spent
      ? `<button class="ncm-pd-btn" disabled style="opacity:.5"><i class="fas fa-check"></i>${isMal ? 'Deployed' : 'Executed'}</button>`
      : `<button class="ncm-pd-btn ncm-pd-btn--go" data-act="${isMal ? 'deploy' : 'execute'}" data-v="${e.id}"><i class="fas ${isMal ? 'fa-bolt' : 'fa-play'}"></i>${isMal ? 'Deploy' : 'Execute'}</button>`;
    return `<div class="ncm-pd-detail__does">It <b>${esc(v.blurb)}</b>.</div>
      <div class="ncm-pd-facts">
        ${fact('fa-shapes', 'Kind', `${esc(v.type)} · ${esc(v.famWord)}`)}
        ${fact('fa-triangle-exclamation', 'If found', threat)}
        ${fact(v.disguised ? 'fa-mask' : 'fa-eye', 'Disguise', v.disguised ? 'Was posing as a cover — now identified.' : 'None — it is what it is.')}
        ${fact('fa-database', 'Status', tag)}
      </div>
      <div class="ncm-pd-actions"><button class="ncm-pd-btn" data-act="analyze" data-v="${e.id}"><i class="fas fa-magnifying-glass"></i>Analyze</button>${goBtn}</div>`;
  }

  _wire(root) {
    if (this._wired) return;
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-act]'); if (!t) return;
      const act = t.dataset.act, v = t.dataset.v;
      if (act === 'pick') { this.selId = v; this._mount(); }
      else if (act === 'analyze') this._analyze(v);
      else if (act === 'deploy') this._deploy(v);
      else if (act === 'execute') this._execute(v);
      else if (act === 'encode') game.nightcity?.openEncoder?.({ stage: 'program', actor: resolveOperator() });
    });
    this._wired = true;
  }

  // ── actions (delegate to the shared player flows) ──
  async _analyze(id) {
    const e = this._programs().find((x) => x.id === id); if (!e) return;
    try {
      const ok = await runAnalyze({ actor: resolveOperator(), raw: e.contentData, contentType: e.contentType, messageId: id, host: this.element });
      if (ok) { this.selId = id; this._mount(); }
    } catch (err) { log.error('Deck analyze failed', err); }
  }
  async _deploy(id) {
    const e = this._programs().find((x) => x.id === id); if (!e || e.contentType !== CONTENT_TYPES.MALWARE) return;
    try {
      const actor = resolveOperator();
      await runMalwareDeploy({ actor, raw: e.contentData, messageId: id, sourceLabel: this.item.name, host: this.element, unstable: game.nightcity?.dataShardService?.programInstability(this.item, e) });
      this.selId = id; this._mount();
    } catch (err) { log.error('Deck deploy failed', err); }
  }
  async _execute(id) {
    const e = this._programs().find((x) => x.id === id); if (!e || e.contentType !== CONTENT_TYPES.PAYLOAD) return;
    try {
      const actor = resolveOperator();
      await runPayloadExecute({ actor, raw: e.contentData, messageId: id, sourceLabel: this.item.name, host: this.element, force: isGM() && !actor, unstable: game.nightcity?.dataShardService?.programInstability(this.item, e) });
      this.selId = id; this._mount();
    } catch (err) { log.error('Deck execute failed', err); }
  }
}
