/**
 * NodeInspectorApp — the GM's look inside a network node (2026-10-29, dev-approved mock dev/mockups/node-inspector-mock.html).
 * @file scripts/ui/NetworkNodes/NodeInspectorApp.js
 * @module night-city-messenger
 *
 * One admin window per node: everything affecting it right now — state, alert, infections, taps, backdoors, the
 * runners' saved sessions, who is locked out — each with its control, plus an Add strip for planting things yourself
 * (a quest infection, an NPC's tap, a jam, a log line, damage). Opened from Admin → Networks → a node (Inspect), the
 * console's GM Inspect, and the pin's right-click (`game.nightcity.inspectNode`).
 *
 * Every write is the GM's own (no relay). The Add forms are read from the DOM on submit; while one is open a node
 * update does not re-render the window (it would wipe what is being typed) — it re-renders when the form closes.
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { isGM, formatCyberDate } from '../../utils/helpers.js';
import { adminWait } from '../../utils/adminTheme.js';
import { showNamePicker, documentEntries } from '../../utils/namePicker.js';
import { BaseApplication } from '../BaseApplication.js';
import { NODE_KINDS, ALERT_LEVELS, NODE_EFFECTS, NODE_PROGRAMS, nodeStateAt, nodeHex, activeEffects, familyNodes } from '../../utils/networkNodes.js';
import { resolveJackIn, jackKey, jackLock } from '../../utils/jackIn.js';
import { editNodeDialog } from './NodeDialogs.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mins = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 120 ? `${Math.round(m / 60)} h` : `${m} min`; };
const RES = [['', 'Follow the rules'], ['inherit', 'Netrunning resolution'], ['auto', 'Roll it'], ['flagged', 'Roll + flag it'], ['gm', 'I decide']];
const ADDS = [['infection', 'fa-bug', 'Infection'], ['taps', 'fa-ear-listen', 'Tap'], ['backdoors', 'fa-door-open', 'Backdoor'], ['jam', 'fa-wave-square', 'Jam'], ['log', 'fa-scroll', 'Log line'], ['damage', 'fa-triangle-exclamation', 'Damage']];
const PLANT = ['worm', 'tap', 'bomb', 'sniffer'];

export class NodeInspectorApp extends BaseApplication {
  static ADMIN_THEMED = true;

  constructor(nodeId, options = {}) {
    super(foundry.utils.mergeObject({ id: `ncm-node-inspect-${nodeId}` }, options, { inplace: false }));
    this.nodeId = nodeId;
    /** Which Add form is open ('' = none). */
    this._add = '';
    this._stale = false;
  }

  get networkService() { return game.nightcity?.networkService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ['ncm-app', 'ncm-node-inspector'],
    window: { title: 'Inspect node', resizable: true, minimizable: true, icon: 'fas fa-magnifying-glass' },
    position: { width: 780, height: 680 },
    actions: {
      state: NodeInspectorApp._act, alert: NodeInspectorApp._act, flag: NodeInspectorApp._act, add: NodeInspectorApp._act,
      addCancel: NodeInspectorApp._act, addSubmit: NodeInspectorApp._act, pick: NodeInspectorApp._act, pickActor: NodeInspectorApp._act,
      unjam: NodeInspectorApp._act, jamMore: NodeInspectorApp._act, infEdit: NodeInspectorApp._act, infClean: NodeInspectorApp._act,
      infRecall: NodeInspectorApp._act, infLoot: NodeInspectorApp._act, fxDel: NodeInspectorApp._act, runMove: NodeInspectorApp._act,
      runKick: NodeInspectorApp._act, runReset: NodeInspectorApp._act, lockClear: NodeInspectorApp._act, console: NodeInspectorApp._act,
      edit: NodeInspectorApp._act,
    },
  }, { inplace: false });

  static PARTS = { main: { template: TEMPLATES.NODE_INSPECTOR } };

  /** Open (or raise) the inspector for a node. GM only. */
  static open(nodeId) {
    if (!isGM()) return void ui.notifications.warn('Only the GM can inspect a node.');
    if (!game.nightcity?.networkService?.getNode?.(nodeId)) return void ui.notifications.warn('That node no longer exists.');
    const existing = foundry.applications?.instances?.get?.(`ncm-node-inspect-${nodeId}`);
    if (existing) { existing.render(true); existing.bringToFront?.(); if (existing.minimized) existing.maximize?.(); return existing; }
    const app = new NodeInspectorApp(nodeId);
    app.render(true);
    return app;
  }

  get title() {
    const n = this.networkService?.getNode?.(this.nodeId);
    return n ? `Inspect node — ${n.name}` : 'Inspect node';
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext?.(options) ?? {};
    const ns = this.networkService;
    const node = ns?.getNode?.(this.nodeId);
    if (!node) return { ...ctx, gone: true };
    const net = ns.getNetwork(node.networkId);
    const now = ns._nowMs();
    const st = nodeStateAt(node, now);
    const kind = NODE_KINDS[node.kind] || NODE_KINDS.relay;
    const scene = game.scenes?.get?.(node.sceneId);
    const rules = (() => { try { return resolveJackIn(game.settings.get(MODULE_ID, 'jackInRules')); } catch { return resolveJackIn({}); } })();
    const jamLeft = st === 'jammed' && node.jammedUntil ? node.jammedUntil - now : 0;
    const lastBy = (re) => [...(node.log || [])].reverse().find((e) => re.test(e.what || ''));
    const time = (ts) => (ts ? formatCyberDate(new Date(ts).toISOString(), { timeOnly: true }) : '');
    const actorName = (id, fallback = '') => game.actors?.get(id)?.name || fallback || 'Someone';
    const all = Object.values(ns._nodeMap?.() || {});

    // ── what is affecting it ──
    const stateRow = st === 'on' ? null : (() => {
      const by = lastBy(st === 'jammed' ? /^jammed/ : st === 'damaged' ? /^damaged/ : /^switched off/);
      return {
        icon: st === 'jammed' ? 'fa-wave-square' : st === 'damaged' ? 'fa-triangle-exclamation' : 'fa-power-off',
        tone: st === 'damaged' ? 'bad' : st === 'jammed' ? 'attn' : 'plain',
        label: st === 'jammed' ? 'Jammed' : st === 'damaged' ? 'Damaged' : 'Switched off', by: by?.who || '',
        detail: st === 'jammed' ? `Back on in ${mins(jamLeft)}${by ? ` · since ${time(by.ts)}` : ''}` : st === 'damaged' ? 'Off until someone repairs it' : `Off${by ? ` since ${time(by.ts)}` : ''}`,
        isJam: st === 'jammed',
      };
    })();
    const infections = (node.infections || []).map((i) => {
      const P = NODE_PROGRAMS[i.kind];
      const bits = [];
      if (i.kind === 'worm') bits.push(`on ${familyNodes(all.map((x) => ns.getNode(x.id)).filter(Boolean), i.family).length} node(s)`, i.nextAt ? `next hop in ${mins(i.nextAt - now)}` : 'at its limit');
      if (i.kind === 'bomb') bits.push(`goes off in ${mins(i.fireAt - now)}`);
      if (i.kind === 'sniffer') bits.push(`${i.loot.length} of ${i.cap} mails caught`);
      if (i.carry) bits.push(`carries a ${NODE_PROGRAMS[i.carry].label.toLowerCase()}`);
      bits.push(`a sweep finds it at DV ${i.stealthDV}`);
      return { id: i.id, family: i.family, icon: P.icon, label: i.name || P.label, kindLabel: P.label, by: i.actorName || '', sloppy: i.sloppy,
        quest: i.quest, note: i.note, detail: bits.join(' · '), isSniffer: i.kind === 'sniffer', loot: i.loot.length, isWorm: i.kind === 'worm' };
    });
    const effects = Object.keys(NODE_EFFECTS).flatMap((k) => activeEffects(node, k, now).map((e) => ({
      kind: k, id: e.id, icon: NODE_EFFECTS[k].icon, label: NODE_EFFECTS[k].label, by: e.actorName || actorName(e.actorId),
      detail: (k === 'taps' ? `Copies mail sent from ${scene?.name || 'its scene'} over ${net?.name || 'the network'}` : `Skips the ${net?.name || 'network'} login`)
        + (e.until ? ` · ${mins(e.until - now)} left` : ' · until removed'),
    })));
    const runs = (node.runs || []).filter((r) => now < r.until).map((r) => ({
      actorId: r.actorId, name: r.actorName || actorName(r.actorId), open: r.open, left: Math.max(0, r.moves - r.used), moves: r.moves,
      canGive: r.used > 0, detail: `${rules.skill} ${r.rank} · ${Math.max(0, r.moves - r.used)} of ${r.moves} moves left · ends in ${mins(r.until - now)}`,
    }));
    const lk = jackLock(rules, net);
    const sec = game.nightcity?.securityService;
    const lockouts = (sec?.knownForTarget?.(jackKey(node)) || []).map((x) => ({
      actorId: x.actorId, name: actorName(x.actorId), locked: x.lockoutRemaining > 0,
      detail: x.lockoutRemaining > 0 ? `Locked out of ${net?.name || 'the network'} · ${mins(x.lockoutRemaining)} left · counts for its login too`
        : `${x.attempts} of ${x.maxAttempts || lk.maxAttempts} tries used on ${net?.name || 'the network'}`,
    }));
    const quiet = !stateRow && !infections.length && !effects.length && !runs.length && !lockouts.length;

    const alert = node.alert || 0;
    const resNow = node.override?.resolution || '';
    return {
      ...ctx, gone: false,
      name: node.name, icon: kind.icon, kindLabel: kind.label, hex: nodeHex(node.id), color: net?.theme?.color || '#19f3f7',
      netName: net?.name || 'Unknown network', sceneName: scene?.name || 'No scene',
      states: [['on', 'On'], ['off', 'Off'], ['jammed', 'Jammed'], ['damaged', 'Damaged']].map(([v, l]) => ({
        v, l, on: st === v, tone: v === 'on' ? 'good' : v === 'damaged' ? 'bad' : v === 'jammed' ? 'attn' : 'plain', t: v === 'jammed' && jamLeft ? mins(jamLeft) : '',
      })),
      alertWord: ALERT_LEVELS[alert], alertTone: alert >= 2 ? 'bad' : alert ? 'attn' : 'good', alertPips: [1, 2, 3].map((i) => ({ on: i <= alert })),
      canDown: alert > 0, canUp: alert < ALERT_LEVELS.length - 1,
      res: RES.map(([v, l]) => ({ v, l, on: v === resNow })),
      flags: [
        { key: 'locked', icon: 'fa-lock', label: 'Box locked', on: !!node.security?.requiresAuth, tip: 'Only a jack-in can switch it' },
        { key: 'hidden', icon: 'fa-eye-slash', label: 'Hidden', on: !!node.hidden, tip: 'Players cannot see it or its pins' },
        { key: 'traffic', icon: 'fa-wave-square', label: 'Show traffic', on: node.showTraffic !== false, tip: 'Packet chatter in its ticker' },
      ],
      lockNote: lk.fromNetwork ? `Failed jack-ins use ${net?.name}'s login lockout: ${lk.maxAttempts} tries, ${mins(lk.lockoutDuration)}.`
        : `${net?.name || 'The network'} has no login lockout, so jack-ins use the Jacking in rules: ${lk.maxAttempts} tries, ${mins(lk.lockoutDuration)}.`,
      stateRow, infections, effects, runs, lockouts, quiet,
      counts: { inf: infections.length, fx: effects.length, runs: runs.length, locks: lockouts.length },
      adds: ADDS.map(([k, icon, label]) => ({ k, icon, label, open: this._add === k })),
      add: this._add, addInf: this._add === 'infection', addFx: this._add === 'taps' || this._add === 'backdoors', addFxTap: this._add === 'taps',
      addJam: this._add === 'jam', addLog: this._add === 'log', addDamage: this._add === 'damage',
      plants: PLANT.map((k) => ({ k, icon: NODE_PROGRAMS[k].icon, label: NODE_PROGRAMS[k].label, on: k === 'worm', blurb: NODE_PROGRAMS[k].blurb })),
      log: [...(node.log || [])].reverse().map((e) => ({ t: time(e.ts), who: e.who, what: e.what, wiped: !!e.wiped })),
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;
    root.querySelector('.ncm-nin')?.style.setProperty('--nc', context.color || '#19f3f7');
    // who decides — a select needs a change listener (data-action fires on click)
    root.querySelector('[data-nin-res]')?.addEventListener('change', (ev) => this._setResolution(ev.target.value));
    if (!this._hooked) {
      this._hooked = true;
      this._onSetting = (setting) => {
        if (setting?.key !== `${MODULE_ID}.networkNodes`) return;
        if (this._add) { this._stale = true; return; }
        if (this._debouncedRender) this._debouncedRender(); else this.render();
      };
      Hooks.on('updateSetting', this._onSetting);
      // heat / lockout state lives in SecurityService, not the setting: refresh the times every 30 s
      this._tick = setInterval(() => { if (!this._add) this.render(); }, 30000);
    }
  }

  async close(options) {
    if (this._onSetting) Hooks.off('updateSetting', this._onSetting);
    clearInterval(this._tick);
    return super.close(options);
  }

  /** One dispatcher for every button (data-action names the op). */
  static async _act(event, target) {
    const op = target?.dataset?.action;
    try { await this._run(op, target.dataset, target); } catch (e) { console.error('NCM | node inspector', e); ui.notifications.error(`NCM | Node inspector: ${e.message}`); }
  }

  async _run(op, ds, target) {
    const ns = this.networkService;
    const node = ns.getNode(this.nodeId); if (!node) return;
    const net = ns.getNetwork(node.networkId);
    const sec = game.nightcity?.securityService;
    const done = (r, ok) => { if (r && r.success === false) ui.notifications.warn(r.error || 'Nothing changed.'); else if (ok) ui.notifications.info(ok); };
    switch (op) {
      case 'state':
        if (ds.v === 'jammed') { this._add = 'jam'; return this.render(); }
        return done(await ns.setNodeState(node.id, ds.v, { who: 'GM' }));
      case 'alert': return done(await ns.bumpNodeAlert(node.id, Number(ds.d) || 0));
      case 'flag': {
        const on = !target.classList.contains('is-on');
        if (ds.key === 'hidden') {
          await ns.saveNode({ ...node, hidden: on });
          await game.nightcity?.terminalScenePins?.setNodeHidden?.(node.id, on);
          return;
        }
        if (ds.key === 'locked') return done(await ns.saveNode({ ...node, security: { ...(node.security || {}), requiresAuth: on } }));
        if (ds.key === 'traffic') return done(await ns.saveNode({ ...node, showTraffic: on }));
        return;
      }
      case 'add': this._add = this._add === ds.k ? '' : ds.k; this._pickedActor = null; return this.render();
      case 'addCancel': this._add = ''; this._pickedActor = null; this._stale = false; return this.render();
      case 'pick': {
        // a chip group: only one lit; the form remembers the value in data-v
        const grp = target.closest('[data-pick-group]');
        grp?.querySelectorAll('[data-action="pick"]').forEach((b) => b.classList.toggle('is-on', b === target));
        if (grp) grp.dataset.v = ds.v;
        const form = target.closest('.ncm-nin__form');
        if (form && grp?.dataset.pickGroup === 'kind') form.dataset.kind = ds.v;
        return;
      }
      case 'pickActor': {
        const pick = await showNamePicker({ title: 'Pick a character', entries: documentEntries(game.actors?.contents || [], { group: 'folder' }), placeholder: 'Search characters…' });
        if (!pick || pick.none) return;
        const actor = game.actors?.get(pick.id);
        this._pickedActor = actor ? { id: actor.id, name: actor.name } : null;
        const form = target.closest('.ncm-nin__form');
        const lbl = form?.querySelector('[data-actor-label]');
        if (lbl) lbl.textContent = actor?.name || 'Pick…';
        const nameIn = form?.querySelector('[name="by"]');
        if (nameIn && !nameIn.value) nameIn.value = actor?.name || '';
        return;
      }
      case 'addSubmit': return this._submit(node, net, target.closest('.ncm-nin__form'));
      case 'unjam': return done(await ns.setNodeState(node.id, 'on', { who: 'GM' }), `${node.name} is back on.`);
      case 'jamMore': {
        const left = node.jammedUntil ? Math.max(0, node.jammedUntil - ns._nowMs()) : 0;
        return done(await ns.setNodeState(node.id, 'jammed', { minutes: Math.round(left / 60000) + 30, who: 'GM' }));
      }
      case 'infEdit': return this._editInfection(node, ds.id);
      case 'infClean': return done(await ns.cleanInfection(node.id, ds.id, 'GM'), 'Cleaned off this node.');
      case 'infRecall': return done(await ns.recallFamily(ds.family, ''), 'Removed from every node it reached.');
      case 'infLoot': return this._showLoot(node, ds.id);
      case 'fxDel': return done(await ns.removeNodeEffect(node.id, ds.kind, ds.id, 'GM'));
      case 'runMove': {
        const run = (node.runs || []).find((r) => r.actorId === ds.actorId);
        return done(await ns.setRunUsed(node.id, ds.actorId, (run?.used || 0) - 1), 'A move given back.');
      }
      case 'runKick': return this._kick(node, net, ds.actorId);
      case 'runReset': return done(await ns.clearRun(node.id, ds.actorId), 'Session reset — their next jack-in starts fresh.');
      case 'lockClear': sec?.clearFor?.(ds.actorId, [jackKey(node)]); ui.notifications.info('Lockout cleared.'); return this.render();
      case 'console': return game.nightcity?.openNode?.(node.id);
      case 'edit': {
        const edited = await editNodeDialog(node, net);
        if (edited) await ns.saveNode({ ...edited, id: node.id, networkId: node.networkId });
        return;
      }
    }
  }

  async _setResolution(v) {
    const ns = this.networkService;
    const node = ns.getNode(this.nodeId); if (!node) return;
    const override = { ...(node.override || {}) };
    if (v) override.resolution = v; else delete override.resolution;
    await ns.saveNode({ ...node, override });
  }

  /** Read an Add form and write it. */
  async _submit(node, net, form) {
    if (!form) return;
    const ns = this.networkService;
    const val = (n) => form.querySelector(`[name="${n}"]`)?.value?.trim() ?? '';
    const num = (n, d) => { const x = Number(val(n)); return Number.isFinite(x) && val(n) !== '' ? x : d; };
    const chk = (n) => !!form.querySelector(`[name="${n}"]`)?.checked;
    const grp = (g) => form.querySelector(`[data-pick-group="${g}"]`)?.dataset.v;
    let r;
    let ok = '';
    switch (this._add) {
      case 'infection': {
        const kind = grp('kind') || 'worm';
        const actor = this._pickedActor;
        if ((kind === 'tap' || kind === 'sniffer') && !actor) return void ui.notifications.warn('A tap or sniffer needs a character to send what it catches to — pick one.');
        r = await ns.insertProgram(node.id, kind, {
          actorId: actor?.id || '', actorName: val('by') || actor?.name || 'Unknown', name: val('name') || NODE_PROGRAMS[kind].label,
          quality: 70, stealthDV: num('dv', 15), quest: chk('quest'), note: val('note'),
          params: { every: num('every', 3), maxNodes: num('max', 4), delay: num('delay', 2), cap: num('cap', 20) },
        });
        if (r?.success !== false) await ns.nodeLog(node.id, val('by') || 'unknown', `installed ${val('name') || NODE_PROGRAMS[kind].label}`);
        ok = `${val('name') || NODE_PROGRAMS[kind].label} planted on ${node.name}.`;
        break;
      }
      case 'taps': case 'backdoors': {
        const actor = this._pickedActor;
        if (!actor) return void ui.notifications.warn('Pick the character it is for.');
        r = await ns.addNodeEffect(node.id, this._add, { actorId: actor.id, actorName: actor.name, minutes: Number(grp('dur')) || 0 });
        ok = `${NODE_EFFECTS[this._add].label} added for ${actor.name}.`;
        break;
      }
      case 'jam': {
        const m = Number(grp('dur')) || 30;
        r = await ns.setNodeState(node.id, 'jammed', { minutes: m, who: val('who') || 'GM' });
        if (r?.success !== false && val('line')) await ns.nodeLog(node.id, val('who') || '', val('line'));
        ok = `${node.name} jammed.`;
        break;
      }
      case 'log':
        if (!val('what')) return void ui.notifications.warn('Write what happened.');
        r = await ns.nodeLog(node.id, val('who'), val('what'));
        break;
      case 'damage':
        r = await ns.setNodeState(node.id, 'damaged', { who: val('who') || 'GM' });
        if (r?.success !== false && val('line')) await ns.nodeLog(node.id, val('who') || '', val('line'));
        ok = `${node.name} is damaged — off until repaired.`;
        break;
    }
    if (r && r.success === false) return void ui.notifications.warn(r.error || 'Nothing changed.');
    if (ok) ui.notifications.info(ok);
    this._add = ''; this._pickedActor = null; this._stale = false;
    this.render();
  }

  async _editInfection(node, id) {
    const inf = node.infections.find((x) => x.id === id); if (!inf) return;
    let out = null;
    await adminWait({
      title: `Edit — ${inf.name}`,
      content: `<div class="ncm-nin-dlg">
        <label><span>Name players see after a sweep</span><input type="text" name="name" value="${esc(inf.name)}"></label>
        <label><span>Who planted it</span><input type="text" name="by" value="${esc(inf.actorName)}"></label>
        <label><span>A sweep finds it at DV</span><input type="number" name="dv" min="0" max="40" value="${inf.stealthDV}"></label>
        <label><span>Note (only you see it)</span><input type="text" name="note" value="${esc(inf.note)}"></label>
        <label class="chk"><input type="checkbox" name="quest" ${inf.quest ? 'checked' : ''}> Quest — tell me when a player cleans it</label></div>`,
      buttons: {
        save: { icon: '<i class="fas fa-check"></i>', label: 'Save', callback: (html) => {
          const q = (n) => (html[0] ?? html).querySelector(`[name="${n}"]`);
          out = { name: q('name').value.trim() || inf.name, actorName: q('by').value.trim(), stealthDV: Math.max(0, Math.min(40, Number(q('dv').value) || 0)), note: q('note').value.trim(), quest: q('quest').checked };
        } },
        cancel: { label: 'Cancel' },
      },
      default: 'save',
    }, { classes: ['dialog', 'ncm-nin-dialog'], width: 380 });
    if (out) { const r = await this.networkService.updateInfection(node.id, id, out); if (r?.success === false) ui.notifications.warn(r.error); }
  }

  async _showLoot(node, id) {
    const inf = node.infections.find((x) => x.id === id); if (!inf) return;
    const rows = inf.loot.length ? inf.loot.slice().reverse().map((m) => `<div class="row"><b>${esc(m.subject || '(no subject)')}</b><span>${esc(m.from)} → ${esc(m.to)}</span></div>`).join('')
      : '<div class="none">Nothing caught yet.</div>';
    await adminWait({ title: `${inf.name} — what it caught`, content: `<div class="ncm-nin-dlg ncm-nin-loot">${rows}</div>`, buttons: { ok: { label: 'Close' } }, default: 'ok' },
      { classes: ['dialog', 'ncm-nin-dialog'], width: 440 });
  }

  /** Kick a runner: their session ends; optionally hit them and lock them out of the network. */
  async _kick(node, net, actorId) {
    const actor = game.actors?.get(actorId);
    const name = actor?.name || (node.runs || []).find((r) => r.actorId === actorId)?.actorName || 'them';
    const ice = game.nightcity?.iceService?.resolveICE?.(net?.security || {}) || { formula: '3d6' };
    const rules = (() => { try { return resolveJackIn(game.settings.get(MODULE_ID, 'jackInRules')); } catch { return resolveJackIn({}); } })();
    const lk = jackLock(rules, net);
    let out = null;
    await adminWait({
      title: `Kick ${name} out of ${node.name}`,
      content: `<div class="ncm-nin-dlg">
        <p>Their session ends now; the moves they spent stay spent.</p>
        <label class="chk"><input type="checkbox" name="hit"> Hit them on the way out</label>
        <label><span>Damage</span><input type="text" name="formula" value="${esc(ice.formula)}"></label>
        <label class="chk"><input type="checkbox" name="lock"> Lock them out of ${esc(net?.name || 'the network')}</label>
        <label><span>For (minutes)</span><input type="number" name="min" min="1" value="${Math.round(lk.lockoutDuration / 60000)}"></label></div>`,
      buttons: {
        kick: { icon: '<i class="fas fa-right-from-bracket"></i>', label: 'Kick', callback: (html) => {
          const q = (n) => (html[0] ?? html).querySelector(`[name="${n}"]`);
          out = { hit: q('hit').checked, formula: q('formula').value.trim() || '3d6', lock: q('lock').checked, min: Math.max(1, Number(q('min').value) || 60) };
        } },
        cancel: { label: 'Cancel' },
      },
      default: 'kick',
    }, { classes: ['dialog', 'ncm-nin-dialog'], width: 380 });
    if (!out) return;
    const r = await this.networkService.kickRun(node.id, actorId, 'GM');
    if (r?.success === false) return void ui.notifications.warn(r.error);
    if (out.hit && actor) {
      await game.nightcity?.iceService?.applyDamage?.(actor, { encryptionType: 'BLACK_ICE', ice: { source: 'custom', customDamage: out.formula, customName: `${node.name} countermeasure` } },
        { context: 'network', targetName: node.name });
    }
    if (out.lock && actorId) game.nightcity?.securityService?.forceLockoutMany?.(actorId, [jackKey(node)], { durationMs: out.min * 60000, reason: 'Kicked out of a node', label: net?.name || node.name });
    ui.notifications.info(`${name} is out of ${node.name}.`);
  }
}
