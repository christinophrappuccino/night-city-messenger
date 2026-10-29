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
import { log, whisperCardHtml, gateSkillsOf } from '../../../utils/helpers.js';
import { SKILL_MAP } from '../../../utils/constants.js';
import { TraceService } from '../../../services/TraceService.js';
import { adminDialog, adminConfirm } from '../../../utils/adminTheme.js';
import { showNamePicker, worldItemEntries, worldRoleEntries, itemImgFor, roleImgFor } from '../../../utils/namePicker.js';
import { gateSummary } from '../../content/EncoderModel.js';
import { CMV_MODES, sanitizeCmvConfig, cmvSummary, cmvChip } from '../../../utils/countermeasures.js';
import { JACK_ACTIONS, JACK_BUILT, resolveJackIn, rulesSummary, CPR_ROLES } from '../../../utils/jackIn.js';
import { ScopePicker } from '../../../utils/scopePicker.js';
import { tagHue } from '../../../utils/tagHue.js';
import {
  thermometers, HEAT_BANDS, HEAT_MARKS, normEvent, sliceOK, chipOK, whoOrder, filterLog, pickCount, seismograph, annotateLog, sevPips,
  spikeRange, brushRange, stamp, clock, kindIcon, kindName, KIND_LIST, SEV_LIST, SEV_HEAT,
  RESULTS, TRACE_MODES, SORTS, ZOOMS,
} from './securityModel.js';

/** The Security sub-tabs (2026-10-27 redesign — dev/mockups/admin-security-redesign-mock.html). */
const VIEWS = [
  { key: 'live', icon: 'fa-bolt', label: 'Live' },
  { key: 'activity', icon: 'fa-list-check', label: 'Activity' },
  { key: 'heat', icon: 'fa-fire', label: 'Heat' },
  { key: 'machines', icon: 'fa-server', label: 'Machines' },
  { key: 'rules', icon: 'fa-sliders', label: 'Hacking rules' },
];
const HACK_RES = [
  { value: 'auto', label: 'Auto-roll', blurb: 'Rolls the check and applies the result. Most tables stay here.' },
  { value: 'flagged', label: '+ NET card', blurb: 'Same, and whispers you a card naming the NET action.' },
  { value: 'gm', label: 'GM adjudicates', blurb: 'No auto-roll: the player waits while you call pass or fail.' },
];
const ROLE_ROLL = [
  { value: 'stat', label: 'Stat + rank', blurb: 'TECH + Interface rank + 1d10 (the module default).' },
  { value: 'rank', label: 'Rank only', blurb: 'Interface rank + 1d10 (the rulebook).' },
];

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
  'cmv-scan': 'Scanned the defences', 'admin-view': 'Viewed another account', 'send-as': 'Sent mail as an account',
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
  _view = 'live';    // the sub-tab — the tab always opens on Live
  // Heat thermometers: the picked operator (and optionally one of their objects).
  _heatSel = { actorId: null, objectId: null };
  // Activity seismograph: zoom, the picked time range / spike, the Key toggle (DOM-only, remembered).
  _sg = { zoom: 'session', range: null, sel: null, legend: false };
  _lookFrom = null;  // the "last look" snapshot, taken when Activity opens (the stamp moves on while it is open)
  _sgLast = {};      // picker id → last value JSON (a popover opening or closing is not a change)
  _folds = new Set(); // open rule cards (Hacking rules) — DOM-toggled, remembered here

  /** openAdminTab('security', { select }) — a sub-tab key opens that view. */
  openTo(select) { if (VIEWS.some(v => v.key === select)) this._view = select; }

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
    if (!VIEWS.some(v => v.key === this._view)) this._view = 'live';
    // "Last look": snapshot the stamp when Activity opens, so the marker and the divider hold
    // still while the GM works the view (onRender moves the stamp on every render there).
    if (this._view === 'activity') { if (this._lookFrom == null) this._lookFrom = this._seen(); } else this._lookFrom = null;
    const nowSeen = this._seen();
    const rows = [...(ts.getLog() || [])].reverse(); // newest first
    const newCount = rows.filter(r => Date.parse(r.ts) > nowSeen).length;
    // Heavy builds (the trace, the thermometers) only while Security AND that view are on screen.
    const active = this.app?._activeTab === 'security';

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
    const countdowns = this._gatherCountdowns(ts);
    const hotAll = heat.hot.filter(h => h.value >= 50);
    const armed = plantsAll.filter(p => p.state === 'armed');
    const stats = {
      traces24h: rows.filter(r => this._now() - Date.parse(r.ts) < 86400000).length,
      hot: hotAll.length,
      countdowns: countdowns.length,
      plants: armed.length,
      recycle: binAll.length,
    };
    const navCount = {
      live: stats.countdowns + stats.hot + stats.plants, activity: newCount,
      heat: stats.hot + stats.countdowns, machines: stats.plants, rules: 0,
    };
    const navCls = { live: 'hot', activity: 'new', heat: 'hot', machines: '', rules: '' };
    const view = this._view;
    const isOpen = (k) => this._folds.has(k);

    return {
      security: {
        view,
        isLive: view === 'live', isActivity: view === 'activity', isHeat: view === 'heat',
        isMachines: view === 'machines', isRules: view === 'rules',
        nav: VIEWS.map(v => ({ ...v, on: v.key === view, count: navCount[v.key] || 0, cls: navCls[v.key] })),
        stats,
        // LIVE — one queue for everything the GM can act on right now.
        queue: { countdowns, hot: hotAll, armed, empty: !countdowns.length && !hotAll.length && !armed.length },
        peek: rows.slice(0, 5).map(r => this._enrichRow(r, nowSeen)),
        rules: {
          folds: { res: isOpen('res'), op: isOpen('op'), cmv: isOpen('cmv'), role: isOpen('role'), jack: isOpen('jack') },
          jack: this._jackContext(),
          res: HACK_RES.map(o => ({ ...o, on: o.value === this._netContext().mode })),
          resLabel: (HACK_RES.find(o => o.value === this._netContext().mode) || HACK_RES[0]).label,
          opSummary: this._gateSummaryChip(),
          role: this._roleRollContext(),
          cmv: this._cmvContext(),
        },
        log: { newCount, alertLevel: this._alertLevel() },
        // ACTIVITY: the seismograph + the log under it (built only while it is on screen)
        sg: active && view === 'activity' ? this._activityContext(rows) : null,
        heat: { ...heat, hot: heatPage.rows, pager: heatPage },
        // HEAT: the thermometers (built only while it is on screen)
        thermo: active && view === 'heat' ? this._heatContext(heat, ts) : null,
        plants: plantsPage.rows, plantsPager: plantsPage,
        bin: bin.map(b => ({ ...b, agoStr: this._ago(Date.parse(b.ts)) })), binPager: binPage,
        gate,
        countdowns,
        net: this._netContext(),
      },
    };
  }

  /** The folded Operator-access card's one-line summary. */
  _gateSummaryChip() {
    let gate = {};
    try { gate = game.settings.get('night-city-messenger', 'operatorGate') || {}; } catch { /* not registered */ }
    const s = gateSummary(gate);
    if (!s.gated) return { off: true, text: 'Anyone' };
    if (s.inert) return { off: true, text: 'Gated — nothing set (anyone)' };
    return { off: false, text: `Only ${s.parts.join(' or ')}` };
  }

  /** Role ability rolls (the `roleAbilityRoll` world setting, also in Module Settings). */
  _roleRollContext() {
    let mode = 'stat';
    try { mode = game.settings.get('night-city-messenger', 'roleAbilityRoll') || 'stat'; } catch { /* not registered */ }
    return { opts: ROLE_ROLL.map(o => ({ ...o, on: o.value === mode })), label: (ROLE_ROLL.find(o => o.value === mode) || ROLE_ROLL[0]).label };
  }

  /** Countermeasure visibility card (world default). Rules: utils/countermeasures.js. */
  _cmvContext() {
    let stored = {};
    try { stored = game.settings.get('night-city-messenger', 'countermeasureVisibility') || {}; } catch { /* not registered */ }
    const c = sanitizeCmvConfig(stored);
    const e = c.expert;
    const parts = [];
    if (e.roles.length) parts.push(...e.roles.map(r => `${r}s`));
    if (e.skills.length) parts.push(...e.skills.map(s => `${s.name} ${s.min}+`));
    if (e.itemGroups.length) parts.push(...e.itemGroups.map(g => `a ${g.map(i => i.name).join(' + ')}`));
    const skills = Object.keys(SKILL_MAP || {}).sort();
    return {
      modes: Object.entries(CMV_MODES).map(([value, m]) => ({ value, ...m, on: value === c.mode })),
      roleChips: e.roles.map(name => ({ name, img: roleImgFor(name) })),
      gearChips: e.itemGroups.map(g => ({ name: g.map(i => i.name).join(' + '), img: g[0]?.img || itemImgFor(g[0]?.name) })),
      skillRowsHtml: e.skills.map(s => this._gateSkillRowHtml(s, 'cmv')).join(''),
      scanSkills: c.scan.skills,
      scanSkillOpts: skills.filter(s => !c.scan.skills.includes(s)),
      scanDV: c.scan.dv, identifyBy: c.scan.identifyBy, failTraced: c.scan.failTraced,
      hide: c.hide, hideDV: c.hideDV,
      summary: cmvSummary(c, parts),
      chip: cmvChip(c),
      expertOff: c.mode === 'open' || c.mode === 'scan',
      scanOff: c.mode === 'open' || c.mode === 'experts',
    };
  }

  // ─── the generic per-tab action (data-action="tabAct" data-owner="security" data-op=…) ───
  async onAct(op, event, target) {
    const d = target?.dataset || {};
    switch (op) {
      case 'view': {
        if (!VIEWS.some(v => v.key === d.view)) return;
        this._view = d.view;
        this.app.render(false);
        this.app.element?.querySelector('.ncm-admin-content')?.scrollTo?.({ top: 0 });
        return;
      }
      case 'fold': {
        // DOM-only: unsaved edits inside another rule card must survive.
        const card = target.closest('[data-fold]');
        if (!card) return;
        const open = !card.classList.contains('open');
        card.classList.toggle('open', open);
        target.closest('[aria-expanded]')?.setAttribute('aria-expanded', String(open));
        if (open) this._folds.add(card.dataset.fold); else this._folds.delete(card.dataset.fold);
        return;
      }
      case 'hackres': return this._saveSetting('hackResolution', d.value, 'Netrunning resolution saved.');
      case 'roleRoll': return this._saveSetting('roleAbilityRoll', d.value, 'Role ability rolls saved.');
      case 'cmvSave': return this._saveCmv();
      case 'jackSave': return this._saveJack();
      case 'jackReset': {
        const ok = await adminConfirm({ title: 'Jacking in — defaults', content: '<p>Put every Jacking in rule back to the module\'s defaults?</p>' });
        if (!ok) return;
        await game.settings.set('night-city-messenger', 'jackInRules', {});
        ui.notifications.info('NCM | Jacking in rules reset.');
        return this.app.render(false);
      }
      case 'cmvAddRole': return this._cmvPick('role', target);
      case 'cmvAddGear': return this._cmvPick('gear', target);
      case 'cmvAddSkill': {
        const list = this.app.element?.querySelector('[data-cmv-skills]');
        list?.querySelector('.ncm-cmv-none')?.remove();
        list?.insertAdjacentHTML('beforeend', this._gateSkillRowHtml({ name: '', min: 4 }, 'cmv'));
        return;
      }
      case 'cmvSkillDel': target.closest('[data-cmv-skill-row]')?.remove(); return;
      case 'cmvChipDel': target.closest('.ncm-cmv-chip')?.remove(); return;

      // ── HEAT thermometers ──
      case 'heatPick': {
        if (!d.actorId) return;
        this._heatSel = { actorId: d.actorId, objectId: null };
        return this.app.render(false);
      }
      case 'heatObj': {
        this._heatSel.objectId = this._heatSel.objectId === d.objectId ? null : (d.objectId || null);
        return this.app.render(false);
      }
      case 'heatClearActor': {
        // Clear with no object picked = every object this operator has heat on.
        const ts = this.traceService;
        const map = ts?.getHeatMap?.() || {};
        for (const [objId, byActor] of Object.entries(map)) if (byActor && d.actorId in byActor) await ts.setHeat?.(objId, d.actorId, 0, {});
        this._heatSel.objectId = null;
        return this.app.render(false);
      }

      // ── ACTIVITY seismograph ──
      case 'sgZoom': {
        if (!ZOOMS[d.zoom]) return;
        this._sg.zoom = d.zoom;
        return this.app.render(false);
      }
      case 'sgKey': {
        // pure display: flip the key in place, remember it for the next render
        this._sg.legend = !this._sg.legend;
        this.app.element?.querySelector('[data-sg-key]')?.toggleAttribute('hidden', !this._sg.legend);
        target.classList?.toggle('on', this._sg.legend);
        target.setAttribute?.('aria-pressed', String(this._sg.legend));
        return;
      }
      case 'sgSel': {
        // a log row → find it on the trace (the hour view jumps out to the session if it's off screen)
        const id = d.eid || null;
        this._sg.sel = this._sg.sel === id ? null : id;
        const r = (this.traceService?.getLog?.() || []).find(x => x.id === id);
        if (r && this._sg.zoom === 'hour' && Date.parse(r.ts) < this._now() - ZOOMS.hour.span) this._sg.zoom = 'session';
        return this.app.render(false);
      }
      case 'sgSpike': {
        // click on the trace: the nearest event, ±4 min; empty space clears
        const t = Number(d.t);
        if (d.eid && Number.isFinite(t)) { this._sg.sel = d.eid; this._sg.range = spikeRange(t, this._now()); }
        else { this._sg.sel = null; this._sg.range = null; }
        this._page = 1;
        return this.app.render(false);
      }
      case 'sgBrush': {
        const a = Number(d.a), b = Number(d.b);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return;
        this._sg.range = brushRange(a, b, this._now());
        this._sg.sel = null; this._page = 1;
        return this.app.render(false);
      }
      case 'sgWho': {
        // a name in the log or a lane label → only that character (again = everyone)
        const ids = this._sgIds();
        const cur = ScopePicker.value(ids.who);
        ScopePicker.set(ids.who, cur.length === 1 && cur[0] === d.who ? [] : [d.who]);
        this._sgLast[ids.who] = JSON.stringify(ScopePicker.value(ids.who));
        this._page = 1;
        return this.app.render(false);
      }
      case 'sgObj': {
        this._objFilter = this._objFilter === d.objectId ? null : (d.objectId || null);
        this._objFilterName = d.objectName || '';
        this._page = 1;
        return this.app.render(false);
      }
      case 'sgUnpick': {
        const ids = this._sgIds();
        if (d.key === 'range') { this._sg.range = null; this._sg.sel = null; }
        else if (d.key === 'obj') this._objFilter = null;
        else if (d.key === 'res') ScopePicker.set(ids.res, ['all']);
        else if (ids[d.key]) ScopePicker.set(ids[d.key], ScopePicker.value(ids[d.key]).filter(v => v !== d.v));
        if (ids[d.key]) this._sgLast[ids[d.key]] = JSON.stringify(ScopePicker.value(ids[d.key]));
        this._page = 1;
        return this.app.render(false);
      }
      case 'sgClearAll': {
        const ids = this._sgIds();
        for (const k of ['who', 'kind', 'sev', 'verb']) ScopePicker.set(ids[k], []);
        ScopePicker.set(ids.res, ['all']);
        for (const id of Object.values(ids)) this._sgLast[id] = JSON.stringify(ScopePicker.value(id));
        this._objFilter = null; this._sg.range = null; this._sg.sel = null; this._filter = 'all'; this._search = ''; this._page = 1;
        return this.app.render(false);
      }
      case 'sgChip': {
        this._filter = ['all', 'serious', 'fumbles'].includes(d.chip) ? d.chip : 'all';
        this._page = 1;
        return this.app.render(false);
      }
      default: log.warn(`SecurityTab: unknown op ${op}`);
    }
  }

  /** The Jacking in card (network nodes, utils/jackIn.js). */
  _jackContext() {
    let stored = {};
    try { stored = game.settings.get('night-city-messenger', 'jackInRules') || {}; } catch { /* not registered */ }
    const r = resolveJackIn(stored);
    const skills = Object.keys(SKILL_MAP);
    if (!skills.includes(r.skill)) skills.unshift(r.skill);
    return {
      summary: rulesSummary(r),
      dv: r.dv,
      skills: skills.map(k => ({ k, on: k === r.skill })),
      res: [['inherit', 'Same as Netrunning resolution'], ['auto', 'Roll it'], ['flagged', 'Roll it, flag it for me'], ['gm', 'I decide (run it at the table)']].map(([v, l]) => ({ v, l, on: v === r.resolution })),
      dials: r.dials,
      moves: r.dials.movesTable,
      failure: r.failure,
      symptoms: r.infection.symptoms,
      session: r.session,
      gateFrom: [['anyone', 'Anyone'], ['operator', 'Same as Terminal operator access'], ['own', 'Only…']].map(([v, l]) => ({ v, l, on: v === r.gateFrom })),
      gateOwn: r.gateFrom === 'own',
      gateRoles: CPR_ROLES.map((n) => ({ n, on: r.gate.roles.some((x) => x.toLowerCase() === n.toLowerCase()) })),
      gateSkills: [0, 1, 2].map((i) => { const g = r.gate.skills[i] || { name: '', min: 4 }; return { i, min: g.min || 4, opts: [{ k: '', l: '—', on: !g.name }, ...skills.map((k) => ({ k, l: k, on: k === g.name }))] }; }),
      gateAll: r.gate.logic === 'all',
      sevs: [['minor', 'Minor'], ['major', 'Major'], ['hostile', 'Hostile']].map(([v, l]) => ({ v, l, on: v === r.failure.severity })),
      actions: JACK_ACTIONS.map(a => ({ key: a.key, label: a.label, icon: a.icon, ...r.actions[a.key], dvBlank: r.actions[a.key].dv === null,
        later: !JACK_BUILT.includes(a.key), hasTime: ['jam', 'backdoor', 'sweep'].includes(a.key) })),
    };
  }

  /** Read the Jacking in card back and save it. */
  async _saveJack() {
    const el = this.app.element?.querySelector('[data-jack-card]');
    if (!el) return;
    const q = (n) => el.querySelector(`[name="${n}"]`);
    const num = (n, d) => { const v = parseInt(q(n)?.value, 10); return Number.isFinite(v) ? v : d; };
    const chk = (n) => !!q(n)?.checked;
    const actions = {};
    for (const a of JACK_ACTIONS) {
      const dvRaw = q(`jk-dv-${a.key}`)?.value;
      actions[a.key] = {
        dv: dvRaw === '' || dvRaw === undefined ? null : parseInt(dvRaw, 10),
        min: num(`jk-min-${a.key}`, a.min),
        minutes: num(`jk-time-${a.key}`, a.minutes),
        move: chk(`jk-move-${a.key}`),
        on: chk(`jk-on-${a.key}`),
      };
    }
    const rules = resolveJackIn({
      skill: q('jk-skill')?.value, dv: num('jk-dv', 15), resolution: q('jk-res')?.value,
      dials: {
        unlocks: chk('jk-unlocks'), edge: chk('jk-edge'), edgeCap: num('jk-edgecap', 3),
        moves: chk('jk-moves'), movesMargin: num('jk-margin', 5),
        movesTable: [0, 1, 2, 3].map(i => ({ rank: num(`jk-mr-${i}`, 1), moves: num(`jk-mm-${i}`, 2) })),
      },
      failure: { trace: chk('jk-trace'), severity: q('jk-sev')?.value, alert: chk('jk-alert'), maxAttempts: num('jk-tries', 3), lockoutMinutes: num('jk-lock', 60) },
      infection: { symptoms: chk('jk-symptoms') },
      session: { minutes: num('jk-sessmin', 60), returnAlert: chk('jk-return') },
      gateFrom: el.querySelector('[name="jk-gatefrom"]:checked')?.value || 'anyone',
      gate: {
        roles: [...el.querySelectorAll('[name="jk-grole"]:checked')].map((x) => x.value),
        skills: [0, 1, 2].map((i) => ({ name: q(`jk-gs-${i}`)?.value || '', min: num(`jk-gm-${i}`, 4) })).filter((x) => x.name),
        logic: q('jk-glogic')?.value === 'all' ? 'all' : 'any',
      },
      actions,
    });
    try {
      await game.settings.set('night-city-messenger', 'jackInRules', rules);
      ui.notifications.info('NCM | Jacking in rules saved.');
    } catch (err) { ui.notifications.error(`NCM | Could not save: ${err.message}`); }
    this.app.render(false);
  }

  async _saveSetting(key, value, msg) {
    if (!value) return;
    try {
      await game.settings.set('night-city-messenger', key, value);
      ui.notifications.info(`NCM | ${msg}`);
    } catch (err) { ui.notifications.error(`NCM | Could not save: ${err.message}`); }
    this.app.render(false);
  }

  /** Expert role / gear chooser (shared world picker), appended DOM-only. */
  _cmvPick(kind, target) {
    const sel = kind === 'role' ? '[data-cmv-roles]' : '[data-cmv-gear]';
    const chips = this.app.element?.querySelector(sel);
    if (!chips) return;
    const taken = new Set([...chips.querySelectorAll('[data-name]')].map(c => c.dataset.name));
    showNamePicker({
      title: kind === 'role' ? 'Add an expert role' : 'Add expert gear',
      hint: kind === 'role' ? 'A character carrying this CPR role item counts as an expert.' : 'A character carrying this item counts as an expert. Matched by item name.',
      entries: kind === 'role' ? worldRoleEntries() : worldItemEntries(), taken,
      placeholder: kind === 'role' ? 'search roles…' : 'search gear…',
      onPick: (pick) => {
        if (!pick?.name || taken.has(pick.name)) return;
        chips.querySelector('.ncm-cmv-none')?.remove();
        const esc = Handlebars.escapeExpression;
        const fallback = kind === 'role' ? 'icons/svg/upgrade.svg' : 'icons/svg/item-bag.svg';
        chips.insertAdjacentHTML('beforeend', `<span class="ncm-cmv-chip" data-name="${esc(pick.name)}" data-img="${esc(pick.img || '')}"><img src="${esc(pick.img || fallback)}" alt="">${esc(pick.name)} <i class="fas fa-xmark" data-action="tabAct" data-owner="security" data-op="cmvChipDel" aria-label="Remove"></i></span>`);
      },
    });
  }

  /** Read the Countermeasure Visibility card out of the DOM and save the world setting. */
  async _saveCmv() {
    const el = this.app.element?.querySelector('[data-cmv-card]');
    if (!el) return;
    const q = (s) => el.querySelector(s);
    const chk = (n) => !!q(`[name="${n}"]`)?.checked;
    const num = (n, d) => { const v = parseInt(q(`[name="${n}"]`)?.value, 10); return Number.isFinite(v) ? v : d; };
    const cfg = sanitizeCmvConfig({
      mode: q('[name="cmvMode"]:checked')?.value || 'open',
      expert: {
        roles: [...el.querySelectorAll('[data-cmv-roles] [data-name]')].map(c => c.dataset.name),
        skills: [...el.querySelectorAll('[data-cmv-skill-row]')].map(r => ({
          name: (r.querySelector('.ncm-sec-admin-gate__skill')?.value || '').trim(),
          min: parseInt(r.querySelector('.ncm-sec-admin-gate__skmin')?.value, 10) || 0,
        })),
        itemGroups: [...el.querySelectorAll('[data-cmv-gear] [data-name]')].map(c => [{ name: c.dataset.name, img: c.dataset.img || '' }]),
      },
      scan: {
        skills: [...el.querySelectorAll('[data-cmv-scan] [data-name]')].map(c => c.dataset.name),
        dv: num('cmvScanDV', 15), identifyBy: num('cmvIdentifyBy', 5), failTraced: chk('cmvFailTraced'),
      },
      hide: { ice: chk('cmvHideIce'), iceDetail: chk('cmvHideIceDetail'), attempts: chk('cmvHideAttempts'), trace: chk('cmvHideTrace') },
      hideDV: chk('cmvHideDV'),
    });
    try {
      await game.settings.set('night-city-messenger', 'countermeasureVisibility', cfg);
      ui.notifications.info('NCM | Countermeasure visibility saved.');
    } catch (err) { ui.notifications.error(`NCM | Could not save: ${err.message}`); }
    this.app.render(false);
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
    return { hot: rows.filter(r => r.value >= 25), coolingCount: rows.filter(r => r.value < 25).length, all: rows };
  }

  /** What KIND of thing a heat object is, for the thermometer detail's icon + sub-label. */
  _heatObjectKind(objId) {
    const id = String(objId || '');
    if (id.startsWith('label:')) return { icon: 'fa-circle-question', kindLabel: '' };
    const MOD = 'night-city-messenger';
    let item = game.items?.get(id) || null;
    if (!item) for (const a of game.actors?.contents ?? []) { item = a.items?.get?.(id) || null; if (item) break; }
    if (item?.getFlag?.(MOD, 'isTerminal')) return { icon: 'fa-terminal', kindLabel: 'Terminal' };
    if (item?.getFlag?.(MOD, 'isDataShard')) return { icon: 'fa-sd-card', kindLabel: 'Shard' };
    if (game.nightcity?.networkService?.getNetwork?.(id)) return { icon: 'fa-tower-broadcast', kindLabel: 'Network' };
    return { icon: item ? 'fa-box' : 'fa-circle-question', kindLabel: item ? 'Item' : '' };
  }

  /** HEAT view — one thermometer per operator (dev/mockups/admin-security-heat-modules-mock.html, version A). */
  _heatContext(heat, ts) {
    const rows = (heat.all || []).map(r => ({ ...r, ...this._heatObjectKind(r.objectId) }));
    const m = thermometers(rows, ts.getCountdowns?.() || [], { nowMs: this._now(), selActorId: this._heatSel.actorId, selObjectId: this._heatSel.objectId });
    if (m.sel) { this._heatSel.actorId = m.sel.actorId; if (!m.sel.objectSelected) this._heatSel.objectId = null; }
    const bands = HEAT_BANDS.map(([tier, h]) => ({ tier, h }));
    const marks = HEAT_MARKS.map(v => ({ v }));
    for (const g of m.gauges) { g.bands = bands; g.hue = tagHue(g.actorName); }
    if (m.sel) m.sel.hue = tagHue(m.sel.actorName);
    return { ...m, scale: marks };
  }

  /** The game clock, in ms (every trace row is stamped through the time provider). */
  _now() {
    try { return this.traceService?._nowMs?.() ?? game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); }
  }

  /** The five slice pickers + Trace + Sort. They hold their own state (ScopePicker), keyed per window. */
  _sgIds() {
    const n = (k) => this.scopeId(`sg-${k}`);
    return { who: n('who'), kind: n('kind'), sev: n('sev'), res: n('res'), verb: n('verb'), trace: n('trace'), sort: n('sort') };
  }

  _sgWire(ids) {
    if (this._sgWired === ids.who) return;
    this._sgWired = ids.who;
    for (const [k, id] of Object.entries(ids)) {
      ScopePicker.on(id, (v) => {
        const sig = JSON.stringify(v);
        if (this._sgLast[id] !== sig) { this._sgLast[id] = sig; if (k !== 'trace') this._page = 1; }
        this.app.render(false);
      });
    }
    const def = { res: 'all', trace: 'bad', sort: 'new' };
    for (const [k, v] of Object.entries(def)) if (!ScopePicker.value(ids[k]).length) ScopePicker.set(ids[k], [v]);
    for (const [, id] of Object.entries(ids)) this._sgLast[id] = JSON.stringify(ScopePicker.value(id));
  }

  /** The slice set the toolbar holds right now. */
  _sgFilter(ids) {
    return {
      who: ScopePicker.value(ids.who), kind: ScopePicker.value(ids.kind), sev: ScopePicker.value(ids.sev),
      verb: ScopePicker.value(ids.verb), res: ScopePicker.value(ids.res)[0] || 'all', objectId: this._objFilter || null,
    };
  }

  _actionLabel(action) { return ACTION_LABELS[action] || String(action || 'activity').replace(/-/g, ' '); }

  /**
   * ACTIVITY view — the seismograph above the log (dev/mockups/admin-security-seismograph-mock.html,
   * version A). Rules in securityModel.js; this gathers, hands the pickers their counts and
   * shapes the log rows (deep links stay the existing `_enrichRow` ones).
   */
  _activityContext(rowsNewestFirst) {
    const ids = this._sgIds();
    this._sgWire(ids);
    const now = this._now();
    const look = this._lookFrom ?? this._seen();
    const events = rowsNewestFirst.map((r, i) => normEvent(r, i));
    const byId = new Map(events.map(e => [e.id, e]));
    const order = whoOrder(events);
    const f = this._sgFilter(ids);
    const mode = ScopePicker.value(ids.trace)[0] || 'bad';
    const sort = ScopePicker.value(ids.sort)[0] || 'new';
    if (this._sg.sel && !byId.has(this._sg.sel)) this._sg.sel = null;
    const hueOf = (e) => tagHue(e.whoName);
    const labelOf = (e) => this._actionLabel(e.action);

    // ── the toolbar: counts are "what you'd see if you picked only this" ──
    const without = (k) => ({ ...f, [k]: k === 'res' ? 'all' : [] });
    const who = order.map(w => {
      const mine = events.filter(e => e.who === w.who && sliceOK(without('who'), e));
      const h = mine.reduce((s, e) => s + e.heat, 0);
      return { id: w.who, name: w.name, color: tagHue(w.name), icon: 'fa-user', count: mine.length, meta: h ? `+${h} heat` : 'no heat' };
    });
    const kinds = KIND_LIST.filter(([k]) => events.some(e => e.kind === k))
      .map(([k, l, ic]) => ({ id: k, name: l, icon: ic, count: pickCount(events, without('kind'), 'kind', k) }));
    const sevs = SEV_LIST.map(([k, l]) => ({ id: k, name: l, icon: 'fa-signal', color: k === 'minor' ? 'var(--ncm-text-label)' : 'var(--ncm-bad)', count: pickCount(events, without('sev'), 'sev', k), meta: `+${SEV_HEAT[k]} heat on a failure` }));
    const verbSet = [...new Set(events.map(e => e.verb).filter(Boolean))].sort();
    const verbs = [...verbSet.map(v => ({ id: v, name: v, icon: 'fa-code-branch', color: 'var(--ncm-secret)', count: pickCount(events, without('verb'), 'verb', v) })),
      ...(events.some(e => !e.verb) ? [{ id: 'none', name: 'No NET verb', icon: 'fa-minus', count: pickCount(events, without('verb'), 'verb', 'none') }] : [])];
    const results = RESULTS.map(([k, l]) => ({ id: k, name: l, icon: k === 'fail' ? 'fa-xmark' : k === 'ok' ? 'fa-check' : 'fa-check-double', color: k === 'fail' ? 'var(--ncm-bad)' : k === 'ok' ? 'var(--ncm-good)' : 'var(--ncm-text-label)', count: pickCount(events, without('res'), 'res', k) }));
    const tools = {
      who: ScopePicker.html(ids.who, { label: 'Who', icon: 'fa-user', noun: 'person', nouns: 'people', allLabel: 'Anyone', multi: true, countLabel: 'events', items: who }),
      kind: ScopePicker.html(ids.kind, { label: 'Target', icon: 'fa-crosshairs', noun: 'kind', nouns: 'targets', allLabel: 'Any', multi: true, countLabel: 'events', items: kinds }),
      sev: ScopePicker.html(ids.sev, { label: 'Severity', icon: 'fa-signal', noun: 'severity', nouns: 'severities', allLabel: 'Any', multi: true, countLabel: 'events', items: sevs }),
      res: ScopePicker.html(ids.res, { label: 'Result', icon: 'fa-check-double', noun: 'result', nouns: 'results', items: results, countLabel: 'events' }),
      verb: ScopePicker.html(ids.verb, { label: 'Action', icon: 'fa-code-branch', noun: 'NET verb', nouns: 'NET verbs', allLabel: 'Any', multi: true, countLabel: 'events', items: verbs }),
      trace: ScopePicker.html(ids.trace, { label: 'Trace', icon: 'fa-wave-square', noun: 'trace', nouns: 'traces', items: TRACE_MODES.map(([k, l, d]) => ({ id: k, name: l, meta: d, icon: k === 'lanes' ? 'fa-bars' : 'fa-wave-square' })) }),
      sort: ScopePicker.html(ids.sort, { label: 'Sort', icon: 'fa-arrow-down-wide-short', noun: 'order', nouns: 'orders', items: SORTS.map(([k, l]) => ({ id: k, name: l, icon: 'fa-arrow-down-wide-short' })) }),
    };

    // ── what is narrowing the view: one line of removable pills ──
    const pills = [];
    for (const w of f.who) { const o = order.find(x => x.who === w); pills.push({ key: 'who', v: w, label: o?.name || w, col: tagHue(o?.name || w), sw: true }); }
    for (const k of f.kind) pills.push({ key: 'kind', v: k, label: kindName(k), icon: kindIcon(k) });
    for (const k of f.sev) pills.push({ key: 'sev', v: k, label: (SEV_LIST.find(([x]) => x === k) || [k, k])[1] });
    if (f.res !== 'all') pills.push({ key: 'res', v: f.res, label: f.res === 'fail' ? 'Failed only' : 'Succeeded only' });
    for (const k of f.verb) pills.push({ key: 'verb', v: k, label: k === 'none' ? 'No NET verb' : k });
    if (f.objectId) pills.push({ key: 'obj', v: f.objectId, label: `on ${this._objFilterName || events.find(e => e.objectId === f.objectId)?.target || 'that object'}`, icon: 'fa-bullseye' });
    if (this._sg.range) pills.push({ key: 'range', v: '', label: `${clock(this._sg.range[0])}–${clock(this._sg.range[1])}`, icon: 'fa-clock', isTime: true });

    // ── the trace ──
    const trace = seismograph(events, { f, mode, zoom: this._sg.zoom, nowMs: now, lastSeen: look, range: this._sg.range, sel: this._sg.sel, hueOf, labelOf });
    const zooms = Object.entries(ZOOMS).map(([k, z]) => ({ key: k, label: z.label, on: k === this._sg.zoom }));

    // ── the log under it ──
    const L = filterLog(events, { f, chip: this._filter, q: this._search, range: this._sg.range, sort, order: order.map(o => o.who), label: labelOf });
    const pg = annotateLog(L, { page: this._page, size: PAGE, sort, lastSeen: look });
    this._page = pg.page;
    const logRows = pg.rows.map(({ e, isNew, div }) => {
      const base = this._enrichRow(e.raw, look);
      return {
        ...base, eid: e.id, whoKey: e.who, isNew, div, ok: e.ok, sev: e.sev,
        when: stamp(e.t, now), whenFull: `${new Date(e.t).toISOString().slice(0, 16).replace('T', ' ')} · ${base.agoStr}`,
        hue: tagHue(e.whoName), pips: sevPips(e.sev),
        rollTotal: e.total ?? '?', rollDv: e.dv, hasRoll: e.dv != null && e.dv > 0,
        heatLabel: e.heat ? `+${e.heat}` : '—', hasHeat: !!e.heat,
        sel: this._sg.sel === e.id,
      };
    });
    const chipBase = events.filter(e => filterLog([e], { f, q: this._search, range: this._sg.range, label: labelOf }).length);
    const chips = [['all', 'All'], ['serious', 'Serious'], ['fumbles', 'Fumbles']].map(([k, l]) => ({ key: k, label: l, on: this._filter === k, n: chipBase.filter(e => chipOK(k, e)).length }));
    const shown = filterLog(events, { f, range: this._sg.range }).length;
    const newSince = events.filter(e => e.t > look).length;
    const nameOf = (e) => (e ? `${e.whoName} · ${labelOf(e)}` : '');
    return {
      tools, pills, anyPills: pills.length > 0, trace, zooms, legend: this._sg.legend,
      laneMode: trace.lanesMode,
      totals: trace.tot,
      events: events.length, nowLabel: clock(now),
      lookLabel: look ? stamp(look, now) : 'never', newSince,
      filtered: pills.length > 0, shown,
      sel: this._sg.sel ? nameOf(byId.get(this._sg.sel)) : '',
      log: {
        rows: logRows, chips, search: this._search,
        page: pg.page, pages: pg.pages, multi: pg.pages > 1, from: pg.from, to: pg.to, total: pg.total,
        hasPrev: pg.hasPrev, hasNext: pg.hasNext,
        prevLabel: pg.timeSort ? (sort === 'old' ? 'Older' : 'Newer') : 'Back',
        nextLabel: pg.timeSort ? (sort === 'old' ? 'Newer' : 'Older') : 'Next',
      },
    };
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
          // a sloppy forgery (under 45%) is the one a SWEEP or ANALYZE will catch — shown amber
          forgeSloppy: r.provenance?.forgeQuality != null && r.provenance.forgeQuality < 45,
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
      // One row per qualifying skill, each with its own minimum rank.
      skillRowsHtml: (gateSkillsOf(gate).length ? gateSkillsOf(gate) : [{ name: '', min: 0 }])
        .map(s => this._gateSkillRowHtml(s)).join(''),
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
    // Mark the log seen only when the full log is on screen — the Activity
    // sub-tab's "N new" count would otherwise clear the moment Live renders.
    // Stamped on the GAME clock: trace rows are game-time, so a real-time stamp could never compare.
    if (this._view === 'activity') {
      try { game.settings.set('night-city-messenger', 'securityLogSeen', this._now()); } catch { /* no */ }
      this._wireSeismograph(el);
    }
    // the toolbar pickers' popovers are portals on <body> — place any open one under its button
    ScopePicker.after();

    // Keyboard: the stat tiles, fold headers and option cards are role=button
    // elements carrying a data-action — Enter / Space clicks them. (Wired once per window.)
    if (this._keyHost !== el) {
      this._keyHost = el;
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const t = e.target.closest?.('[data-owner="security"][role="button"]');
        if (!t || t.tagName === 'BUTTON' || !el.contains(t)) return;
        e.preventDefault(); t.click();
      });
    }

    // Countermeasure visibility card: dim the expert / scan blocks the chosen
    // mode does not use, and add scan skills from the short skill select (DOM-only).
    const cmvCard = el.querySelector('[data-cmv-card]');
    if (cmvCard && !cmvCard.dataset.wired) {
      cmvCard.dataset.wired = '1';
      const sync = () => {
        const m = cmvCard.querySelector('[name="cmvMode"]:checked')?.value || 'open';
        cmvCard.querySelector('[data-cmv-expert]')?.classList.toggle('is-ungated', m === 'open' || m === 'scan');
        cmvCard.querySelector('[data-cmv-scanblock]')?.classList.toggle('is-ungated', m === 'open' || m === 'experts');
      };
      cmvCard.querySelectorAll('[name="cmvMode"]').forEach(r => r.addEventListener('change', sync));
      const add = cmvCard.querySelector('[data-cmv-scan-add]');
      add?.addEventListener('change', () => {
        const name = add.value; add.value = '';
        const box = cmvCard.querySelector('[data-cmv-scan]');
        if (!name || !box || box.querySelector(`[data-name="${CSS.escape(name)}"]`)) return;
        box.querySelector('.ncm-cmv-none')?.remove();
        const esc = Handlebars.escapeExpression;
        add.insertAdjacentHTML('beforebegin', `<span class="ncm-cmv-chip" data-name="${esc(name)}">${esc(name)} <i class="fas fa-xmark" data-action="tabAct" data-owner="security" data-op="cmvChipDel" aria-label="Remove"></i></span>`);
        add.querySelector(`option[value="${CSS.escape(name)}"]`)?.remove();
      });
      sync();
    }

    const search = el.querySelector('[data-sec-search]');
    if (search && !search.dataset.wired) {
      search.dataset.wired = '1';
      search.addEventListener('input', foundry.utils.debounce((e) => {
        this._search = e.target.value; this._page = 1; this._searchCaret = e.target.selectionStart; this.app.render(false);
      }, 200));
      // typing re-renders the tab — put the caret back where it was
      if (this._searchCaret != null) {
        const c = this._searchCaret; this._searchCaret = null;
        search.focus(); try { search.setSelectionRange(c, c); } catch { /* not a text input */ }
      }
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

    // Netrunning Resolution / Role ability rolls are option cards (tabAct ops
    // 'hackres' / 'roleRoll') — they save on click, as the old select did on change.
  }

  onClose() {
    if (this._liveTick) { clearInterval(this._liveTick); this._liveTick = null; }
    this._sgAbort?.abort(); this._sgAbort = null;
    super.onClose?.();
  }

  /**
   * The seismograph's pointer work — DOM-only until something is picked:
   *  · hover → the nearest event within 8px gets a tooltip + a ring (no render)
   *  · click → that event ±4 min (op sgSpike); empty space clears the pick
   *  · drag  → a live band follows the pointer, release = that range (op sgBrush)
   * One set of document listeners per window (re-renders replace the plot, not the listeners),
   * each guarded to this window's plot, torn down in onClose.
   */
  _wireSeismograph(el) {
    if (this._sgAbort && this._sgHost === el) return;
    this._sgAbort?.abort();
    this._sgAbort = new AbortController();
    this._sgHost = el;
    const sig = { signal: this._sgAbort.signal };
    const plotOf = (t) => (t instanceof Element ? t.closest('[data-sg-plot]') : null);
    const geo = (plot, ev) => {
      const r = plot.getBoundingClientRect();
      const W = Number(plot.dataset.w) || r.width || 1;
      const sx = W / (r.width || W);
      const x = Math.max(0, Math.min(W, (ev.clientX - r.left) * sx));
      const y = (ev.clientY - r.top) * sx;
      const t0 = Number(plot.dataset.t0), t1 = Number(plot.dataset.t1);
      return { x, y, W, sx, ms: (px) => t0 + (px / W) * (t1 - t0) };
    };
    const nearest = (plot, x, y) => {
      const lanes = plot.dataset.lanes === '1';
      const lane = lanes ? Math.floor((y - 2) / 46) : null;
      let best = null, bd = 8;
      plot.querySelectorAll('[data-eid]').forEach((m) => {
        if (lanes && Number(m.dataset.lane) !== lane) return;
        const d = Math.abs(Number(m.dataset.x) - x) - (m.dataset.ok === '1' ? 0 : 1.5);
        if (d < bd) { bd = d; best = m; }
      });
      return best;
    };
    const tipOf = (plot) => plot.closest('[data-sg]')?.querySelector('[data-sg-tip]');
    const hideTip = (plot) => {
      const tip = tipOf(plot); if (tip) tip.hidden = true;
      plot.querySelectorAll('.is-hov').forEach((m) => m.classList.remove('is-hov'));
    };
    const showTip = (plot, m) => {
      plot.querySelectorAll('.is-hov').forEach((n) => { if (n !== m) n.classList.remove('is-hov'); });
      m.classList.add('is-hov');
      const tip = tipOf(plot); if (!tip) return;
      const D = m.dataset;
      tip.querySelector('[data-k="t"]').textContent = D.tipT || '';
      const w = tip.querySelector('[data-k="who"]'); w.textContent = D.tipWho || ''; w.style.color = D.col || '';
      tip.querySelector('[data-k="what"]').textContent = D.tipWhat || '';
      tip.querySelector('[data-k="tgt"]').textContent = D.tipTgt || '';
      const res = tip.querySelector('[data-k="res"]'); res.textContent = D.ok === '1' ? 'OK' : 'Failed'; res.className = D.ok === '1' ? 'good' : 'bad';
      const ht = tip.querySelector('[data-k="heat"]'); ht.textContent = Number(D.heat) ? ` · +${D.heat} heat` : '';
      tip.hidden = false;
      const gut = Number(plot.dataset.gut) || 64, W = Number(plot.dataset.w) || 688;
      tip.style.left = `${Math.min(W - 190, Math.max(0, Number(D.x) - 90)) + gut}px`;
      tip.style.top = `${Math.max(0, Number(D.y) - 58) + 26}px`;
    };
    let down = null;
    document.addEventListener('mousedown', (ev) => {
      const plot = plotOf(ev.target);
      if (!plot || !el.contains(plot) || ev.button !== 0) return;
      const g = geo(plot, ev);
      down = { plot, x: g.x, y: g.y, moved: false };
      ev.preventDefault();
    }, sig);
    document.addEventListener('mousemove', (ev) => {
      if (down) {
        const g = geo(down.plot, ev);
        if (Math.abs(g.x - down.x) > 4) {
          down.moved = true; hideTip(down.plot);
          const band = down.plot.querySelector('[data-sg-live]');
          if (band) { const a = Math.min(g.x, down.x), b = Math.max(g.x, down.x); band.hidden = false; band.style.left = `${a / g.sx}px`; band.style.width = `${(b - a) / g.sx}px`; }
          down.to = g.x;
        }
        return;
      }
      const plot = plotOf(ev.target);
      const host = el.querySelector('[data-sg-plot]');
      if (!plot) { if (host) hideTip(host); return; }
      if (!el.contains(plot)) return;
      const g = geo(plot, ev);
      const m = nearest(plot, g.x, g.y);
      if (m) showTip(plot, m); else hideTip(plot);
    }, sig);
    document.addEventListener('mouseup', (ev) => {
      if (!down) return;
      const { plot, moved, x, y } = down; down = null;
      const g = geo(plot, ev);
      if (moved) return void this.onAct('sgBrush', ev, { dataset: { a: g.ms(Math.min(x, g.x)), b: g.ms(Math.max(x, g.x)) } });
      const m = nearest(plot, x, y);
      return void this.onAct('sgSpike', ev, { dataset: m ? { eid: m.dataset.eid, t: m.dataset.t } : {} });
    }, sig);
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
    chips.querySelector('.ncm-sec-admin-gate__none')?.remove();
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
    // The Role block is NOT a gear OR-group, so look in its own requirement box
    // (it searched the gear groups, found nothing, and dropped every pick).
    const chips = target?.closest('.ncm-sec-admin-gate__req')?.querySelector('[data-role-chips]')
      || this.app.element?.querySelector('[data-role-chips]');
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
      if (kind === 'network') return ns?.openAdminTab?.('networks', { select: uuid ? `show:${uuid}` : 'view:all' });
      if (kind === 'message' && msg) return this._openMessage(msg);
      if (kind === 'contact' && contact) return this._openContactManager(contact);
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
  /** Deep-link a contact into Admin → Contacts (the GM Contact Manager window is folded into that tab). */
  async _openContactManager(contactId) {
    try { await game.nightcity.openAdminTab('contacts', { select: contactId }); }
    catch { ui.notifications.info('NCM | Open Admin → Contacts to review this contact.'); }
  }

  // ─── heat actions ───
  async onHeatClear(event, target) {
    const { objectId, actorId } = target?.dataset || {};
    if (objectId && actorId) { await this.traceService?.setHeat?.(objectId, actorId, 0, {}); this.app.render(false); }
  }
  async onHeatClearAll() {
    adminConfirm({ title: 'Clear all heat', content: '<p>Reset every operator’s heat to zero?</p>', yes: async () => { try { await game.settings.set('night-city-messenger', 'traceHeat', {}); } catch {} this.app.render(false); } });
  }
  /**
   * Set one operator's heat on one object (Heat → Selected → Adjust). A big live number with its
   * tier word, a slider marked with the tier bands, quick steps, the reason the player may notice,
   * and whether to tell them. (2026-10-29, dev: "the Adjust dialog can use some design love".)
   */
  onHeatAdjust(event, target) {
    const { objectId, actorId, objectName, actorName, value } = target?.dataset || {};
    const esc = Handlebars.escapeExpression;
    const cur = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const STEPS = [-10, -5, 5, 10];
    const content = `
      <div class="ncm-heatadj" data-tier="${TraceService.tierOf(cur)}">
        <div class="ncm-heatadj__who"><i class="fas fa-user-secret"></i><b>${esc(actorName || 'Someone')}</b><span>on</span><b>${esc(objectName || 'this object')}</b></div>
        <div class="ncm-heatadj__dial">
          <div class="ncm-heatadj__num"><input type="number" name="hv" value="${cur}" min="0" max="100" step="1" aria-label="Heat"><span class="ncm-heatadj__of">/ 100</span></div>
          <div class="ncm-heatadj__tier" data-heat-tier>${TraceService.tierOf(cur)}</div>
          <div class="ncm-heatadj__was">was ${cur}</div>
        </div>
        <div class="ncm-heatadj__track">
          <input type="range" name="hs" min="0" max="100" step="1" value="${cur}" aria-label="Heat slider">
          <div class="ncm-heatadj__bands" aria-hidden="true"><span class="cold">cold</span><span class="warm">warm 25</span><span class="hot">hot 50</span><span class="burned">burned 80</span></div>
        </div>
        <div class="ncm-heatadj__steps">${STEPS.map(n => `<button type="button" data-heat-step="${n}">${n > 0 ? '+' : '−'}${Math.abs(n)}</button>`).join('')}<button type="button" data-heat-step="clear" class="clear"><i class="fas fa-snowflake"></i> Clear</button></div>
        <label class="ncm-heatadj__k" for="ncm-heatadj-r">Why, in the fiction <small>optional — shown in the chat card</small></label>
        <input type="text" id="ncm-heatadj-r" name="hr" placeholder="e.g. a camera caught their face in the lobby">
        <label class="ncm-heatadj__tell"><input type="checkbox" name="tp"><span>Also tell the player</span></label>
      </div>`;
    adminDialog({
      title: 'Adjust heat', content,
      render: (html) => {
        const root = (html[0] ?? html).querySelector?.('.ncm-heatadj') || html.find?.('.ncm-heatadj')[0];
        if (!root) return;
        const num = root.querySelector('[name="hv"]'), range = root.querySelector('[name="hs"]'), tierEl = root.querySelector('[data-heat-tier]');
        const paint = (v, from) => {
          v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
          if (from !== 'num') num.value = v;
          if (from !== 'range') range.value = v;
          const t = TraceService.tierOf(v);
          root.dataset.tier = t; tierEl.textContent = t;
          range.style.setProperty('--v', `${v}%`);
        };
        num.addEventListener('input', () => paint(num.value, 'num'));
        range.addEventListener('input', () => paint(range.value, 'range'));
        root.querySelectorAll('[data-heat-step]').forEach(b => b.addEventListener('click', (ev) => {
          ev.preventDefault();
          const st = b.dataset.heatStep;
          paint(st === 'clear' ? 0 : (Number(num.value) || 0) + Number(st));
        }));
        paint(cur);
      },
      buttons: {
        set: { icon: '<i class="fas fa-temperature-half"></i>', label: 'Set heat', callback: async (html) => {
          const v = Math.max(0, Math.min(100, Math.round(Number(html.find('[name="hv"]').val()) || 0)));
          const reason = String(html.find('[name="hr"]').val() || '');
          const tellPlayer = html.find('[name="tp"]').is(':checked');
          await this.traceService?.setHeat?.(objectId, actorId, v, { reason, tellPlayer, objectName });
          this.app.render(false);
        } },
        cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
      }, default: 'set',
    }, { classes: ['ncm-heatadj-dialog'], width: 380 }).render(true);
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
      skills: Array.from(el.querySelectorAll('[data-gate-skill-row]'))
        .map(r => ({ name: (r.querySelector('.ncm-sec-admin-gate__skill')?.value || '').trim(), min: parseInt(r.querySelector('.ncm-sec-admin-gate__skmin')?.value) || 0 }))
        .filter(s => s.name),
      skill: { name: '', min: 0 },
      itemGroups: groups,
      actors: [], allowGM: el.querySelector('[name="gateAllowGM"]')?.checked !== false,
    };
    try { await game.settings.set('night-city-messenger', 'operatorGate', gate); ui.notifications.info('NCM | Terminal operator access saved.'); }
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

  /** One skill row of the gate: skill select · at rank · N · or higher · ✕. Inputs unnamed (onSaveGate walks the rows). */
  _gateSkillRowHtml({ name = '', min = 0 } = {}, kind = 'gate') {
    const esc = Handlebars.escapeExpression;
    const skills = Object.keys(SKILL_MAP || {}).sort();
    if (name && !skills.includes(name)) skills.unshift(name);
    const opts = `<option value="" ${name ? '' : 'selected'}>— none —</option>`
      + skills.map(s => `<option value="${esc(s)}" ${s === name ? 'selected' : ''}>${esc(s)}</option>`).join('');
    // Two rule cards share this row; each needs its own marker so neither save reads the other's rows.
    const marker = kind === 'cmv' ? 'data-cmv-skill-row' : 'data-gate-skill-row';
    const rm = kind === 'cmv' ? 'data-action="tabAct" data-owner="security" data-op="cmvSkillDel"' : 'data-action="securityGateRemoveSkill"';
    return `<div class="ncm-sec-admin-gate__skrow" ${marker}>
      <select class="ncm-sec-admin-gate__skill" aria-label="Skill">${opts}</select>
      <span class="ncm-sec-admin-fhint">at rank</span><input type="number" class="ncm-sec-admin-gate__skmin" value="${Number(min) || 0}" min="0" max="10" style="width:56px" aria-label="Minimum rank"><span class="ncm-sec-admin-fhint">or higher</span>
      <button type="button" class="ncm-sec-admin-btn sm ncm-sec-admin-gate__skrm" ${rm} aria-label="Remove this skill"><i class="fas fa-xmark"></i></button>
    </div>`;
  }
  onGateAddSkill() {
    const list = this.app.element?.querySelector('[data-gate-skills]');
    if (list) list.insertAdjacentHTML('beforeend', this._gateSkillRowHtml());
  }
  onGateRemoveSkill(event, target) {
    const list = target?.closest('[data-gate-skills]');
    target?.closest('[data-gate-skill-row]')?.remove();
    // Always leave one (empty) row to type into.
    if (list && !list.querySelector('[data-gate-skill-row]')) list.insertAdjacentHTML('beforeend', this._gateSkillRowHtml());
  }

  // ─── helpers ───
  _seen() { try { return Number(game.settings.get('night-city-messenger', 'securityLogSeen')) || 0; } catch { return 0; } }
  _alertLevel() { try { return game.settings.get('night-city-messenger', 'securityAlertLevel') || 'serious'; } catch { return 'serious'; } }
  _ago(ms) {
    if (!ms) return '';
    const s = Math.max(0, Math.floor((this._now() - ms) / 1000));   // trace rows + recycle-bin stamps are game time
    if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
  }
}
