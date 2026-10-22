/**
 * SecurityTab — Admin ▸ Security (design doc §7).
 * @file scripts/ui/AdminPanel/tabs/SecurityTab.js
 * @module night-city-messenger
 * @description The GM's one-stop security surface, backed by TraceService + the
 *   resident/recycle-bin/operator-gate backends:
 *     · Activity Log  — every hack/forge/auth event (success + failure), plain
 *       language, color-coded target icons, NEW-since-last-check, filter/search/
 *       page, ↗ deep-link to the exact object, click-to-filter.
 *     · Heat          — per (operator × object), decayed, tiered; Clear + Adjust
 *       (manual set with a reason → chat).
 *     · Planted       — the forgery/infection audit (Fire / Defuse).
 *     · Recycle Bin   — wiped entries (Restore / Purge).
 *     · Operator Access — the capability gate config.
 *   GM-only.
 */

import { BaseTab } from '../BaseTab.js';
import { log, whisperCardHtml } from '../../../utils/helpers.js';
import { SKILL_MAP } from '../../../utils/constants.js';
import { TraceService } from '../../../services/TraceService.js';
import { adminDialog, adminConfirm } from '../../../utils/adminTheme.js';
import { showNamePicker, worldItemEntries, worldRoleEntries, itemImgFor, roleImgFor } from '../../../utils/namePicker.js';

/** slug → plain-language phrase (someone who forgot the jargon still gets it). */
const ACTION_LABELS = {
  siphon: 'Siphoned an account', upload: 'Uploaded a program', 'plant-fired': 'A plant fired',
  unlock: 'Cracked a locked file', crack: 'Cracked credentials', camera: 'Hijacked a camera feed',
  malware: 'Ran malware', payload: 'Ran a program', exfil: 'Exfiltrated data',
  'shard-hack': 'Hacked a data shard', 'shard-layer': 'Hacked a shard layer',
  'shard-login': 'Fumbled a shard password', 'shard-keyitem': 'Wrong key item',
  'net-auth': 'Network password', 'net-hack': 'Network bypass', 'contact-breach': 'Breached a contact',
  'trace-complete': 'TRACE COMPLETE — they found them',
  'terminal-login': 'Terminal login', 'terminal-net': 'Terminal net-join',
  'message-decrypt': 'Decrypted a message', 'message-access': 'Unlocked a message',
};
/** target kind → icon + color class. */
const TARGET_KINDS = {
  terminal: { icon: 'fa-terminal', cls: 'terminal' }, shard: { icon: 'fa-sd-card', cls: 'shard' },
  network: { icon: 'fa-tower-broadcast', cls: 'network' }, message: { icon: 'fa-envelope', cls: 'message' },
  camera: { icon: 'fa-video', cls: 'camera' }, bank: { icon: 'fa-building-columns', cls: 'bank' },
  contact: { icon: 'fa-user', cls: 'contact' },
};
const SEV_LABEL = { hostile: 'Break-in', major: 'Break-in attempt', minor: 'Fumble' };
const HEAT_INC = TraceService.SEVERITIES; // { minor:10, major:20, hostile:35 }
const PAGE = 15;

export class SecurityTab extends BaseTab {
  get key() { return 'security'; }
  get traceService() { return game.nightcity?.traceService; }
  get terminalService() { return game.nightcity?.terminalService; }
  get securityService() { return game.nightcity?.securityService; }

  _filter = 'all';   // all | serious | breakins | fumbles
  _search = '';
  _page = 1;
  _heatPage = 1;
  _plantPage = 1;
  _binPage = 1;
  _opFilter = null;  // click-to-filter: an actorId
  _objFilter = null; // or an objectId

  /** Slice an array into a page view-model { rows, page, maxPage, hasPrev, hasNext, total }. */
  _paginate(arr, page, size) {
    const total = arr.length;
    const maxPage = Math.max(1, Math.ceil(total / size));
    const p = Math.min(Math.max(1, page), maxPage);
    return { rows: arr.slice((p - 1) * size, p * size), page: p, maxPage, hasPrev: p > 1, hasNext: p < maxPage, total, multi: maxPage > 1 };
  }

  // ─── context ───
  prepareContext() {
    const ts = this.traceService;
    if (!ts) return { security: null };
    const nowSeen = this._seen();
    const rows = [...(ts.getLog() || [])].reverse(); // newest first

    // filter
    let filtered = rows.filter(r => {
      if (this._filter === 'serious' && r.severity === 'minor') return false;
      if (this._filter === 'breakins' && r.severity !== 'hostile') return false;
      if (this._filter === 'fumbles' && r.severity !== 'minor') return false;
      if (this._opFilter && r.actorId !== this._opFilter) return false;
      if (this._objFilter && r.objectId !== this._objFilter) return false;
      if (this._search) {
        const q = this._search.toLowerCase();
        if (!`${r.actorName} ${r.objectName} ${ACTION_LABELS[r.action] || r.action}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const newCount = rows.filter(r => Date.parse(r.ts) > nowSeen).length;
    const total = filtered.length;
    const maxPage = Math.max(1, Math.ceil(total / PAGE));
    if (this._page > maxPage) this._page = maxPage;
    const pageRows = filtered.slice((this._page - 1) * PAGE, this._page * PAGE).map(r => this._enrichRow(r, nowSeen));

    // heat (paginate the hot list — it grows one row per operator×object)
    const heat = this._gatherHeat(ts);
    const heatPage = this._paginate(heat.hot, this._heatPage, 8);
    this._heatPage = heatPage.page;
    // plants + recycle + gate (all paginated + height-capped in CSS)
    const plantsAll = this._gatherPlants();
    const plantsPage = this._paginate(plantsAll, this._plantPage, 8);
    this._plantPage = plantsPage.page;
    const binAll = (ts.getRecycleBin?.() || []).slice().reverse();
    const binPage = this._paginate(binAll, this._binPage, 10);
    this._binPage = binPage.page;
    const bin = binPage.rows;
    const gate = this._gateContext();

    return {
      security: {
        stats: {
          traces24h: rows.filter(r => Date.now() - Date.parse(r.ts) < 86400000).length,
          hot: heat.hot.filter(h => h.value >= 50).length,
          plants: plantsAll.filter(p => p.state === 'armed').length,
          recycle: binAll.length,
        },
        log: {
          rows: pageRows, newCount,
          filter: this._filter, search: this._search,
          activeFilter: this._opFilter || this._objFilter ? (this._opFilterName || this._objFilterName) : '',
          page: this._page, maxPage, total,
          hasPrev: this._page > 1, hasNext: this._page < maxPage,
          alertLevel: this._alertLevel(),
        },
        heat: { ...heat, hot: heatPage.rows, pager: heatPage },
        plants: plantsPage.rows, plantsPager: plantsPage,
        bin: bin.map(b => ({ ...b, agoStr: this._ago(Date.parse(b.ts)) })), binPager: binPage,
        gate,
        countdowns: this._gatherCountdowns(ts),
        net: this._netContext(),
      },
    };
  }

  /** Netrunning Resolution (design §5) — HOW gated hacks resolve, table-wide. */
  _netContext() {
    let mode = 'auto';
    try { mode = game.settings.get('night-city-messenger', 'hackResolution') || 'auto'; } catch { /* not registered */ }
    return { mode, isAuto: mode === 'auto', isFlagged: mode === 'flagged', isGm: mode === 'gm' };
  }

  _enrichRow(r, nowSeen) {
    const tk = TARGET_KINDS[r.targetKind] || null;
    const isFail = r.outcome !== 'success';
    const heatObjId = r.objectId || `label:${String(r.objectName || 'unknown').toLowerCase()}`;
    const heat = isFail ? Math.round(this.traceService.getHeat(heatObjId, r.actorId || 'unknown')) : null;
    return {
      id: r.id, actorName: r.actorName, actorId: r.actorId,
      actionLabel: ACTION_LABELS[r.action] || String(r.action || 'activity').replace(/-/g, ' '),
      objectName: r.objectName, objectId: r.objectId,
      targetKind: r.targetKind, targetIcon: tk?.icon || 'fa-circle-question', targetCls: tk?.cls || '',
      targetUuid: r.targetUuid, targetMessageId: r.targetMessageId, targetContactId: r.targetContactId,
      canOpen: !!(r.targetUuid || r.targetKind === 'network' || r.targetMessageId || r.targetContactId),
      sev: r.severity, sevLabel: SEV_LABEL[r.severity] || r.severity,
      netVerb: r.netVerb || null,
      outcome: r.outcome, isFail,
      roll: (r.dv != null) ? `${r.margin != null ? r.dv + r.margin : '?'} vs ${r.dv}` : '',
      heatDelta: r.heatDelta || 0,
      heat, heatTier: heat != null ? TraceService.tierOf(heat) : '',
      isNew: Date.parse(r.ts) > nowSeen,
      agoStr: this._ago(Date.parse(r.ts)),
    };
  }

  /**
   * Human name for a heat object id. Heat is keyed by bare object id, which
   * may be a WORLD item, an ACTOR-OWNED item (a terminal/shard in someone's
   * inventory), a network id, or a `label:` pseudo-object. Before this, only
   * world items resolved and everything else printed as a raw id ("Brandino
   * has heat on some item ID number" — 2026-09-10). A deleted object is named
   * as such rather than leaking its id.
   * @param {string} objId
   * @returns {string}
   */
  _heatObjectName(objId) {
    const id = String(objId || '');
    if (id.startsWith('label:')) return id.slice(6);
    const world = game.items?.get(id);
    if (world) return world.name;
    for (const actor of game.actors?.contents ?? []) {
      const owned = actor.items?.get?.(id);
      if (owned) return `${owned.name} (${actor.name})`;
    }
    const net = game.nightcity?.networkService?.getNetwork?.(id);
    if (net?.name) return net.name;
    if (id.includes('.')) {
      try { const doc = fromUuidSync(id); if (doc?.name) return doc.name; } catch { /* not a uuid */ }
    }
    return `(deleted object · ${id.slice(0, 8)}…)`;
  }

  _gatherHeat(ts) {
    const map = ts.getHeatMap?.() || {};
    const rows = [];
    for (const [objId, byActor] of Object.entries(map)) {
      for (const actorId of Object.keys(byActor || {})) {
        const value = Math.round(ts.getHeat(objId, actorId));
        if (value <= 0) continue;
        const actor = game.actors?.get(actorId);
        rows.push({
          objectId: objId, actorId,
          objectName: this._heatObjectName(objId),
          actorName: actor?.name || (actorId === 'unknown' ? 'Unknown' : actorId),
          // Escalate is offered from WARM up (design §6b: warm → lockout, hot →
          // ICE, burned → countdown — one GM-gated dialog covers all three).
          value, tier: TraceService.tierOf(value), canEscalate: value >= 25,
        });
      }
    }
    rows.sort((a, b) => b.value - a.value);
    return { hot: rows.filter(r => r.value >= 25), coolingCount: rows.filter(r => r.value < 25).length };
  }

  /**
   * Active trace countdowns, with remaining GAME time — they run on the time
   * provider, so in manual/world-time modes they only tick when the GM advances
   * the clock. Before this list existed, a started countdown was invisible
   * ("I did countdown and nothing happened") until its whispered completion.
   */
  _gatherCountdowns(ts) {
    const now = (() => { try { return game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); } })();
    let gameClock = false;
    try { gameClock = (game.nightcity?.timeService?.getProviderInfo?.()?.effective || 'real-time') !== 'real-time'; } catch { /* real-time */ }
    return (ts.getCountdowns?.() || []).map(c => {
      const remMs = Math.max(0, (c.expiresAt || 0) - now);
      const mins = Math.ceil(remMs / 60000);
      return {
        id: c.id, actorName: c.actorName, objectName: c.objectName, reason: c.reason || '',
        source: (c.source || '').trim() || 'A trace',
        remaining: remMs <= 0 ? 'due' : (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`),
        gameClock,
      };
    });
  }

  _gatherPlants() {
    const svc = this.terminalService;
    if (!svc) return [];
    const out = [];
    for (const item of (game.items ?? [])) {
      if (!svc.isTerminal?.(item)) continue;
      for (const r of (svc.getResidents?.(item) || [])) {
        const by = r.provenance?.plantedBy ? game.actors?.get(r.provenance.plantedBy)?.name : null;
        const trig = r.trigger?.kind === 'onDate' ? `on ${new Date(r.trigger.atMs || 0).toISOString().slice(0, 10)}`
          : r.trigger?.kind === 'onLogin' ? `on next login${r.trigger.accountId ? ` (${svc.getAccount?.(item, r.trigger.accountId)?.displayName || r.trigger.accountId})` : ''}`
            : (r.trigger?.kind || 'manual');
        out.push({
          itemId: item.id, id: r.id, effectType: r.effectType, name: r.params?.name || r.effectType,
          hostName: item.name, state: r.state,
          forge: r.provenance?.forgeQuality != null ? `forgery ${r.provenance.forgeQuality}% · scan DV ${r.stealthDV || '?'}` : '',
          by: by || 'unknown', trigger: trig,
          isPlant: r.effectType === 'plant',
        });
      }
    }
    // armed first
    return out.sort((a, b) => (a.state === 'armed' ? -1 : 1) - (b.state === 'armed' ? -1 : 1));
  }

  _gateContext() {
    let gate = {};
    try { gate = game.settings.get('night-city-messenger', 'operatorGate') || {}; } catch { /* not registered */ }
    const groups = (Array.isArray(gate.itemGroups) ? gate.itemGroups : []).map(grp =>
      (Array.isArray(grp) ? grp.map(x => {
        const name = typeof x === 'string' ? x : x?.name;
        return name ? { name, img: (typeof x === 'object' && x?.img) || itemImgFor(name) } : null;
      }).filter(Boolean) : []));
    const roleChips = (gate.roles || []).map(name => ({ name, img: roleImgFor(name) }));
    return {
      mode: gate.mode || 'anyone', logic: gate.logic || 'any',
      roleChips, roleLogic: gate.roleLogic || 'any',
      skillName: gate.skill?.name || '', skillMin: gate.skill?.min || 0,
      skillOptions: Object.keys(SKILL_MAP || {}).sort(),
      groups: groups.length ? groups : [[]],
      allowGM: gate.allowGM !== false,
      // NOTE: the item/role choice lists are deliberately NOT built here. They used to
      // ride the context to fill two <select>s, which meant scanning every actor's
      // items on EVERY render of the tab. The pickers now read them on demand
      // (onGateAddItem / onGateAddRole) — i.e. only when the GM opens one.
    };
  }

  // ─── render / listeners ───
  onRender() {
    const el = this.app.element;
    if (!el) return;
    // mark the log seen (this tab is active when onRender runs)
    try { game.settings.set('night-city-messenger', 'securityLogSeen', Date.now()); } catch { /* no */ }

    const search = el.querySelector('[data-sec-search]');
    if (search && !search.dataset.wired) {
      search.dataset.wired = '1';
      search.addEventListener('input', foundry.utils.debounce((e) => { this._search = e.target.value; this._page = 1; this.app.render(false); }, 200));
    }
    const alertSel = el.querySelector('[data-sec-alert]');
    if (alertSel && !alertSel.dataset.wired) {
      alertSel.dataset.wired = '1';
      alertSel.addEventListener('change', (e) => { try { game.settings.set('night-city-messenger', 'securityAlertLevel', e.target.value); } catch { /* no */ } });
    }
    // Live repaint — heat decays and countdowns tick continuously, but nothing
    // writes a setting while they do, so the setting-change refresh never fires.
    // A slow 30s repaint keeps the bars/remaining-times honest while the tab is
    // on screen (cheap: render only when Security is the active tab).
    if (!this._liveTick) {
      this._liveTick = setInterval(() => {
        if (this.app?._activeTab === 'security' && this.app?.rendered && !this.app.minimized) this.app.render(false);
      }, 30000);
    }

    // Operator Access — dim the requirement block when set to "Anyone" so the
    // gate reads at a glance (the requirements are moot until it's gated). Purely
    // visual; onSaveGate still reads whatever's in the DOM.
    const gateReqs = el.querySelector('[data-gate-reqs]');
    const gateModeVal = () => el.querySelector('[name="gateMode"]:checked')?.value || 'anyone';
    const syncGate = () => {
      const ungated = gateModeVal() === 'anyone';
      gateReqs?.classList.toggle('is-ungated', ungated);
      el.querySelectorAll('.ncm-sec-admin-gate__mode').forEach(m => m.classList.toggle('on', m.querySelector('input')?.checked));
    };
    el.querySelectorAll('[name="gateMode"]').forEach(r => {
      if (r.dataset.wiredDim) return;
      r.dataset.wiredDim = '1';
      r.addEventListener('change', syncGate);
    });
    syncGate();

    // Netrunning Resolution — saves on change (selects need a manual listener,
    // the standing data-action-on-select gotcha).
    const hackSel = el.querySelector('[data-sec-hackres]');
    if (hackSel && !hackSel.dataset.wired) {
      hackSel.dataset.wired = '1';
      hackSel.addEventListener('change', async (e) => {
        try {
          await game.settings.set('night-city-messenger', 'hackResolution', e.target.value);
          ui.notifications.info('NCM | Netrunning resolution saved.');
          this.app.render(false);
        } catch (err) { ui.notifications.error(`NCM | Could not save: ${err.message}`); }
      });
    }
  }

  onClose() {
    if (this._liveTick) { clearInterval(this._liveTick); this._liveTick = null; }
    super.onClose?.();
  }

  /**
   * Resolve a heat object (its `objectId`) into concrete SecurityService lockout
   * target keys — the missing map behind design §6b's warm tier. Heat is keyed by
   * bare object id, but lockouts are keyed granularly (`termId::acctId`, the
   * shard id, the network id), so an escalation lockout has to fan out:
   *  · a TERMINAL → every account key (locks the whole box for that actor)
   *  · a DATA SHARD → the shard id (its own lockout key)
   *  · a NETWORK → the network id (the standalone Agent connect gate; a terminal's
   *    own net-join uses a compound key, so that path is not covered here — noted)
   *  · a `label:` object (no real item) → nothing lockable
   * @returns {{ targets: string[], kind: string, note?: string }}
   */
  _lockoutScope(objectId) {
    if (!objectId || String(objectId).startsWith('label:')) return { targets: [], kind: 'none' };
    const MOD = 'night-city-messenger';
    const item = game.items?.get(objectId);
    if (item?.getFlag?.(MOD, 'isTerminal')) {
      const svc = this.terminalService;
      const accts = svc?.getAccounts?.(item, { includeHidden: true }) || [];
      return { targets: accts.map(a => `${item.id}::${a.id}`), kind: 'terminal' };
    }
    if (item?.getFlag?.(MOD, 'isDataShard')) return { targets: [item.id], kind: 'shard' };
    if (game.nightcity?.networkService?.getNetwork?.(objectId)) {
      return { targets: [objectId], kind: 'network', note: 'the Agent connect gate (a terminal’s own net-join is keyed separately)' };
    }
    return { targets: [], kind: 'unknown' };
  }

  /** Escalate — GM picks a consequence: lock them out, a "corp found you" countdown, or Black ICE now. */
  onEscalate(event, target) {
    const { objectId, actorId, objectName, actorName } = target?.dataset || {};
    const MOD = 'night-city-messenger';
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const iceActors = (game.actors ?? []).filter(a => a.type === 'blackIce' || a.type === 'black-ice' || a.getFlag?.(MOD, 'isBlackICE') || /black\s*ice/i.test(a.name || ''));
    const iceOpts = iceActors.length ? iceActors.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('') : '<option value="">— no Black ICE actors in world —</option>';
    const scope = this._lockoutScope(objectId);
    const lockRow = scope.targets.length
      ? `<div class="ncm-esc__row"><label>Minutes</label><input type="number" name="lk" value="60" min="1" class="ncm-esc__num"><span class="ncm-esc__hint">locks ${scope.kind === 'terminal' ? `all ${scope.targets.length} account(s)` : `this ${scope.kind}`}${scope.note ? ` — ${esc(scope.note)}` : ''}</span></div>`
      : `<div class="ncm-esc__hint ncm-esc__hint--block">Nothing lockable — this heat is on an unresolved label, not a terminal/shard/network.</div>`;
    adminDialog({
      title: 'Escalate — trace consequence', content: `
        <div class="ncm-esc">
          <div class="ncm-esc__lede">Consequences for <b>${esc(actorName)}</b> — heat on <b>${esc(objectName)}</b>.</div>

          <div class="ncm-esc__opt ncm-esc__opt--lock">
            <div class="ncm-esc__opt-hd"><span class="ncm-esc__tag">A</span><i class="fas fa-lock"></i> Lock them out<span class="ncm-esc__warm">WARM+</span></div>
            ${lockRow}
          </div>

          <div class="ncm-esc__opt ncm-esc__opt--cd">
            <div class="ncm-esc__opt-hd"><span class="ncm-esc__tag">B</span><i class="fas fa-hourglass-half"></i> Someone closes in <span class="ncm-esc__sub">countdown</span></div>
            <div class="ncm-esc__row"><label>Who</label><input type="text" name="cdsrc" placeholder="Arasaka, a fixer, the Maelstrom… (optional)" class="ncm-esc__grow"></div>
            <div class="ncm-esc__row"><label>Minutes</label><input type="number" name="mn" value="30" min="1" class="ncm-esc__num"></div>
            <div class="ncm-esc__row"><label>Warn</label><input type="text" name="cdwarn" placeholder="player-facing cue (optional) — overrides the default" class="ncm-esc__grow"></div>
          </div>

          <div class="ncm-esc__opt ncm-esc__opt--ice">
            <div class="ncm-esc__opt-hd"><span class="ncm-esc__tag">C</span><i class="fas fa-skull"></i> Black ICE strikes now</div>
            <div class="ncm-esc__row"><label>ICE</label><select name="ice" class="ncm-esc__grow">${iceOpts}</select></div>
          </div>

          <div class="ncm-esc__foot">
            <input type="text" name="rs" placeholder="reason (optional) — an in-fiction cue" class="ncm-esc__reason">
            <label class="ncm-esc__check"><input type="checkbox" name="tp"> also warn the player</label>
          </div>
        </div>`,
      buttons: {
        lockout: { label: 'Lock out', icon: '<i class="fas fa-lock"></i>', callback: async (html) => {
          const s = this._lockoutScope(objectId);
          if (!s.targets.length) { ui.notifications.warn('NCM | Nothing lockable for this heat entry.'); return; }
          const minutes = Math.max(1, Number(html.find('[name="lk"]').val()) || 60);
          const sec = this.securityService;
          const reason = String(html.find('[name="rs"]').val() || '');
          if (!actorId || !sec?.forceLockoutMany) { ui.notifications.warn('NCM | Security service unavailable, or no operator on this heat entry.'); return; }
          // ONE call: applies locally, broadcasts to every client (lockout
          // state is client-local — without the sync the player just logged
          // back in), kicks live sessions, and toasts the operator once.
          sec.forceLockoutMany(actorId, s.targets, {
            durationMs: minutes * 60000,
            reason: reason || `trace escalation on ${objectName}`,
            label: objectName,
          });
          const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
          if (gmIds.length) ChatMessage.create({
            content: whisperCardHtml({
              tone: 'danger', icon: 'fa-lock', title: 'Lockout',
              lines: [`<b>${esc(actorName)}</b> locked out of <b>${esc(objectName)}</b> for <b>${minutes} min</b>.`, reason ? `<span class="ncm-cc__sub"><i>${esc(reason)}</i></span>` : ''],
            }), whisper: gmIds,
          });
          if (html.find('[name="tp"]').is(':checked')) {
            const a = game.actors?.get(actorId);
            const owners = a ? (game.users?.filter(u => !u.isGM && a.testUserPermission?.(u, 'OWNER')).map(u => u.id) ?? []) : [];
            if (owners.length) ChatMessage.create({
              content: whisperCardHtml({ tone: 'danger', icon: 'fa-lock', title: 'Locked Out', lines: [`<b>${reason ? esc(reason) + ' ' : ''}You're locked out — the system slammed the door.</b>`] }),
              whisper: owners,
            });
          }
          this.app.render(false);
        } },
        countdown: { label: 'Start countdown', icon: '<i class="fas fa-hourglass-half"></i>', callback: async (html) => {
          const minutes = Number(html.find('[name="mn"]').val()) || 30;
          await this.traceService?.startCountdown?.(objectId, actorId, {
            minutes,
            source: String(html.find('[name="cdsrc"]').val() || ''),
            reason: String(html.find('[name="rs"]').val() || ''),
            playerWarning: String(html.find('[name="cdwarn"]').val() || ''),
            tellPlayer: html.find('[name="tp"]').is(':checked'), objectName,
          });
          this.app.render(false);
        } },
        ice: { label: 'Wake ICE', icon: '<i class="fas fa-skull"></i>', callback: async (html) => {
          const iceId = html.find('[name="ice"]').val();
          const op = actorId ? game.actors?.get(actorId) : null;
          if (!iceId || !op) { ui.notifications.warn('NCM | Pick a Black ICE actor and a valid operator.'); return; }
          try {
            await game.nightcity?.iceService?.applyDamage?.(op, { encryptionType: 'BLACK_ICE', ice: { source: 'actor', actorId: iceId } }, { context: 'trace', targetName: objectName });
            const reason = String(html.find('[name="rs"]').val() || '');
            const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
            if (gmIds.length) ChatMessage.create({
              content: whisperCardHtml({
                tone: 'danger', icon: 'fa-skull', title: 'Black ICE',
                lines: [`Black ICE struck <b>${esc(op.name)}</b> off the trace on <b>${esc(objectName)}</b>.`, reason ? `<span class="ncm-cc__sub"><i>${esc(reason)}</i></span>` : ''],
              }), whisper: gmIds,
            });
          } catch (err) { log.warn(`Escalate ICE failed: ${err.message}`); }
          this.app.render(false);
        } },
        cancel: { label: 'Cancel' },
      }, default: 'countdown',
    }, { classes: ['ncm-esc-dialog'], width: 440 }).render(true);
  }

  /** Append a gate chip (DOM-only — onSaveGate reads the chips back out). */
  _appendChip(chips, { name, img }, fallbackImg) {
    if (!chips || !name) return;
    if ([...chips.querySelectorAll('[data-item-name]')].some(c => c.dataset.itemName === name)) return;
    const span = document.createElement('span');
    span.className = 'ncm-sec-admin-chip'; span.dataset.itemName = name;
    span.innerHTML = `<img src="${Handlebars.escapeExpression(img || fallbackImg)}" alt="">`
      + `${Handlebars.escapeExpression(name)} <i class="fas fa-xmark" data-action="securityGateRemoveItem"></i>`;
    chips.appendChild(span);
  }

  _chipNames(chips) { return new Set([...(chips?.querySelectorAll('[data-item-name]') || [])].map(c => c.dataset.itemName)); }

  /** "+ item…" — pick a carryable world item for THIS OR-group. */
  onGateAddItem(event, target) {
    const chips = target?.closest('.ncm-sec-admin-gate__grp')?.querySelector('[data-gate-group-chips]');
    showNamePicker({
      title: 'Add required gear',
      hint: 'Everything in one group is required together (AND). Matched by item name.',
      entries: worldItemEntries(), taken: this._chipNames(chips), placeholder: 'search gear…',
      onPick: (pick) => this._appendChip(chips, pick, 'icons/svg/item-bag.svg'),
    });
  }

  /** "+ role…" — pick a CPR role. */
  onGateAddRole(event, target) {
    const chips = target?.closest('.ncm-sec-admin-gate__grp')?.querySelector('[data-role-chips]');
    showNamePicker({
      title: 'Add allowed role',
      hint: 'A character qualifies by carrying this CPR role item.',
      entries: worldRoleEntries(), taken: this._chipNames(chips), placeholder: 'search roles…',
      onPick: (pick) => this._appendChip(chips, pick, 'icons/svg/upgrade.svg'),
    });
  }

  // ─── log actions ───
  onFilter(event, target) { this._filter = target?.dataset?.filter || 'all'; this._page = 1; this.app.render(false); }
  onPage(event, target) { const d = target?.dataset?.dir; this._page += (d === 'next' ? 1 : -1); this.app.render(false); }
  onHeatPage(event, target) { this._heatPage += (target?.dataset?.dir === 'next' ? 1 : -1); this.app.render(false); }
  onPlantPage(event, target) { this._plantPage += (target?.dataset?.dir === 'next' ? 1 : -1); this.app.render(false); }
  onBinPage(event, target) { this._binPage += (target?.dataset?.dir === 'next' ? 1 : -1); this.app.render(false); }

  // ─── program authoring shortcuts (the workshop owns create + library) ───
  onNewProgram() { game.nightcity?.openMalwareWorkshop?.(); }
  onProgramLibrary() { game.nightcity?.openMalwareWorkshop?.({ openLibrary: true }); }
  onClearLog() {
    adminConfirm({ title: 'Clear activity log', content: '<p>Delete the whole activity log? Heat is unaffected.</p>', yes: async () => { await this.traceService?.clearLog?.(); this.app.render(false); } });
  }
  onFilterActor(event, target) { this._opFilter = target?.dataset?.actorId || null; this._opFilterName = target?.textContent?.trim(); this._objFilter = null; this._page = 1; this.app.render(false); }
  onFilterObject(event, target) { this._objFilter = target?.dataset?.objectId || null; this._objFilterName = target?.dataset?.objectName; this._opFilter = null; this._page = 1; this.app.render(false); }
  onClearFilter() { this._opFilter = this._objFilter = null; this._page = 1; this.app.render(false); }
  async onJump(event, target) {
    const { uuid, kind, msg, contact } = target?.dataset || {};
    try {
      const ns = game.nightcity;
      if (kind === 'terminal' && uuid) { const it = fromUuidSync(uuid); return ns?.openTerminal?.(it || uuid); }
      if (kind === 'shard' && uuid) { const it = fromUuidSync(uuid); return ns?.openDataShard?.(it || uuid); }
      if (kind === 'network') return ns?.openNetworkManagement?.();
      if (kind === 'message' && msg) return this._openMessage(msg);
      if (kind === 'contact' && contact) return this._openContactManager();
      if (uuid) { const it = fromUuidSync(uuid); if (it?.sheet) return it.sheet.render(true); }
      ui.notifications.info('NCM | No quick-open for this target — open it manually.');
    } catch (err) { log.warn(`Security jump failed: ${err.message}`); }
  }
  /** Open the journal page that stores a message (deep-link by messageId). */
  _openMessage(messageId) {
    for (const j of (game.journal ?? [])) {
      const p = j.pages.find(pg => pg.flags?.['night-city-messenger']?.messageId === messageId);
      if (p) { try { j.sheet.render(true, { pageId: p.id }); } catch { j.sheet.render(true); } return; }
    }
    ui.notifications.info('NCM | That message is no longer stored.');
  }
  async _openContactManager() {
    try { const { GMContactManagerApp } = await import('../../GMContactManager/GMContactManagerApp.js'); new GMContactManagerApp().render(true); }
    catch { ui.notifications.info('NCM | Open the GM Contact Manager to review this contact.'); }
  }

  // ─── heat actions ───
  async onHeatClear(event, target) {
    const { objectId, actorId } = target?.dataset || {};
    if (objectId && actorId) { await this.traceService?.setHeat?.(objectId, actorId, 0, {}); this.app.render(false); }
  }
  async onHeatClearAll() {
    adminConfirm({ title: 'Clear all heat', content: '<p>Reset every operator’s heat to zero?</p>', yes: async () => { try { await game.settings.set('night-city-messenger', 'traceHeat', {}); } catch {} this.app.render(false); } });
  }
  onHeatAdjust(event, target) {
    const { objectId, actorId, objectName, actorName, value } = target?.dataset || {};
    const cur = Number(value) || 0;
    adminDialog({
      title: 'Set heat', content: `
        <div style="font:13px var(--ncm-font-body,sans-serif);line-height:1.6;">
          <p><b>${actorName}</b> on <b>${objectName}</b></p>
          <div style="display:flex;gap:8px;align-items:center;margin:6px 0;"><label style="width:70px;">Heat</label><input type="number" name="hv" value="${cur}" min="0" max="100" style="width:70px;"></div>
          <div style="margin:6px 0;"><input type="text" name="hr" placeholder="reason (optional) — an in-fiction cue" style="width:100%;"></div>
          <label style="font-size:12px;"><input type="checkbox" name="tp"> also tell the player</label>
        </div>`,
      buttons: {
        set: { label: 'Apply → post to chat', callback: async (html) => {
          const v = Number(html.find('[name="hv"]').val()); const reason = String(html.find('[name="hr"]').val() || '');
          const tellPlayer = html.find('[name="tp"]').is(':checked');
          await this.traceService?.setHeat?.(objectId, actorId, v, { reason, tellPlayer, objectName });
          this.app.render(false);
        } },
        cancel: { label: 'Cancel' },
      }, default: 'set',
    }).render(true);
  }

  /** Call off a running trace countdown. */
  async onCountdownCancel(event, target) {
    const id = target?.dataset?.countdownId;
    if (id) { await this.traceService?.cancelCountdown?.(id); this.app.render(false); }
  }

  // ─── plant actions ───
  async onDefuse(event, target) {
    const { itemId, residentId } = target?.dataset || {};
    const item = game.items?.get(itemId);
    if (item) { await this.terminalService?.updateResident?.(item, residentId, { state: 'defused' }); this.app.render(false); }
  }
  async onFireResident(event, target) {
    const { itemId, residentId } = target?.dataset || {};
    const item = game.items?.get(itemId);
    const r = this.terminalService?.getResidents?.(item)?.find(x => x.id === residentId);
    if (item && r) { await this.terminalService?.fireResident?.(item, r, {}); this.app.render(false); }
  }
  async onRemoveResident(event, target) {
    const { itemId, residentId } = target?.dataset || {};
    const item = game.items?.get(itemId);
    if (item) { await this.terminalService?.removeResident?.(item, residentId); this.app.render(false); }
  }

  // ─── recycle actions ───
  async onRestore(event, target) {
    const id = target?.dataset?.recId;
    const flow = await import('../../content/SiphonFlow.js');
    if (await flow.restoreWiped?.(id)) { ui.notifications.info('NCM | Restored.'); this.app.render(false); }
  }
  async onPurge(event, target) {
    const id = target?.dataset?.recId;
    adminConfirm({ title: 'Purge', content: '<p>Permanently delete this wiped entry? This cannot be undone.</p>', yes: async () => { const flow = await import('../../content/SiphonFlow.js'); await flow.emptyRecycleBin?.([id]); this.app.render(false); } });
  }
  onEmptyBin() {
    adminConfirm({ title: 'Empty recycle bin', content: '<p>Permanently delete <b>all</b> wiped entries?</p>', yes: async () => { const flow = await import('../../content/SiphonFlow.js'); await flow.emptyRecycleBin?.(); this.app.render(false); } });
  }

  // ─── gate save (reads the form) ───
  async onSaveGate() {
    const el = this.app.element; if (!el) return;
    const val = (n) => el.querySelector(`[name="${n}"]`)?.value ?? '';
    const groups = Array.from(el.querySelectorAll('[data-gate-group]'))
      .map(g => Array.from(g.querySelectorAll('.ncm-sec-admin-chip')).map(c => ({ name: c.dataset.itemName, img: c.querySelector('img')?.getAttribute('src') || '' })).filter(x => x.name))
      .filter(g => g.length);
    const roles = Array.from(el.querySelectorAll('[data-role-chips] .ncm-sec-admin-chip')).map(c => c.dataset.itemName).filter(Boolean);
    const gate = {
      // gateMode is a radio group — read the CHECKED one, not the first match.
      mode: el.querySelector('[name="gateMode"]:checked')?.value || 'anyone', logic: val('gateLogic') || 'any',
      roles, roleLogic: val('gateRoleLogic') || 'any',
      skill: { name: val('gateSkill').trim(), min: parseInt(val('gateSkillMin')) || 0 },
      itemGroups: groups,
      actors: [], allowGM: el.querySelector('[name="gateAllowGM"]')?.checked !== false,
    };
    try { await game.settings.set('night-city-messenger', 'operatorGate', gate); ui.notifications.info('NCM | Operator access saved.'); }
    catch (err) { log.error(`Gate save failed: ${err.message}`); }
    this.app.render(false);
  }
  onGateAddGroup() {
    const wrap = this.app.element?.querySelector('[data-gate-groups]');
    if (!wrap) return;
    const n = wrap.querySelectorAll('[data-gate-group]').length;   // existing option count
    const row = document.createElement('div'); row.className = 'ncm-sec-admin-gate__grp'; row.dataset.gateGroup = '1';
    row.innerHTML = this._gateGroupInner(n);
    const btnRow = wrap.querySelector('button[data-action="securityGateAddGroup"]')?.closest('div');
    if (btnRow) wrap.insertBefore(row, btnRow); else wrap.appendChild(row);
    this._renumberGateGroups();
  }
  /** Inner markup of one OR-group (index n) — a header with a remove ✕, the AND
   *  chip strip, and the "+ item" button. Shared by add + kept in sync with the hbs. */
  _gateGroupInner(n) {
    return `<div class="ncm-sec-admin-gate__grphd"><span class="ncm-sec-admin-gate__opt">Option ${String.fromCharCode(65 + n)}</span>`
      + `<span class="ncm-sec-admin-gate__andhint">carry ALL of these</span><span class="grow"></span>`
      + `<button type="button" class="ncm-sec-admin-gate__rm" data-action="securityGateRemoveGroup" data-tooltip="Remove this option"><i class="fas fa-xmark"></i></button></div>`
      + `<span class="ncm-sec-admin-gate__chips" data-gate-group-chips></span>`
      + `<button type="button" class="ncm-sec-admin-btn sm" data-action="securityGateAddItem"><i class="fas fa-plus"></i> item</button>`;
  }
  /** Re-letter the Option A/B/C headers after add/remove (DOM order is the truth). */
  _renumberGateGroups() {
    const wrap = this.app.element?.querySelector('[data-gate-groups]');
    wrap?.querySelectorAll('[data-gate-group]').forEach((g, i) => {
      const lbl = g.querySelector('.ncm-sec-admin-gate__opt');
      if (lbl) lbl.textContent = `Option ${String.fromCharCode(65 + i)}`;
    });
  }
  onGateRemoveGroup(event, target) {
    const wrap = this.app.element?.querySelector('[data-gate-groups]');
    const groups = wrap?.querySelectorAll('[data-gate-group]');
    // Never remove the last group — an empty gate should keep one placeholder row.
    if (groups && groups.length <= 1) { target?.closest('[data-gate-group]')?.querySelector('[data-gate-group-chips]')?.replaceChildren(); return; }
    target?.closest('[data-gate-group]')?.remove();
    this._renumberGateGroups();
  }
  onGateRemoveItem(event, target) { target?.closest('.ncm-sec-admin-chip')?.remove(); }

  // ─── helpers ───
  _seen() { try { return Number(game.settings.get('night-city-messenger', 'securityLogSeen')) || 0; } catch { return 0; } }
  _alertLevel() { try { return game.settings.get('night-city-messenger', 'securityAlertLevel') || 'serious'; } catch { return 'serious'; } }
  _ago(ms) {
    if (!ms) return '';
    const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
  }
}
