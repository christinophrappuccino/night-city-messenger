/**
 * NodeConsoleApp — the window a player opens at a network node (step 2, 2026-10-29; dev/design/NETWORK-NODES.md).
 * @file scripts/ui/NetworkNodes/NodeConsoleApp.js
 * @module night-city-messenger
 *
 * The dev-approved console (dev/mockups/network-nodes-v2-mock.html §1): the node's real name, hex address, firmware,
 * state, signal, who is on the scene, its alert level and box lock, a live traffic trace (flatlines when off, noise
 * when jammed), and a ticker built from what is really there (utils/networkNodes.js `tickerLines`).
 * Player-facing: it wears the PLAYER theme, plus the network's own colour as --nc.
 *
 * Actions now: Connect (the normal connect path, login dialog included), Switch off / on when the box is not locked
 * (a locked box needs a jack-in — step 3). GM: Edit, Jam. One window per node.
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../../utils/constants.js';
import { log, isGM, formatCyberDate, resolveOperator, resolveHackResolution, canOperate, openOperatorPicker, getOperatorActors } from '../../utils/helpers.js';
import { JACK_ACTIONS, JACK_BUILT, resolveJackIn, jackInDV, movesFor, actionView, lockLayers, jackKey, jackLock, jackResolution, jackGate } from '../../utils/jackIn.js';
import { runJackIn } from './JackInLock.js';
import { requestNetAdjudication, postNetActionCard } from '../content/NetResolve.js';
import { BaseApplication } from '../BaseApplication.js';
import { liveRun, NODE_KINDS, ALERT_LEVELS, NODE_EFFECTS, NODE_PROGRAMS, nodeStateAt, stateLabel, nodeHex, nodeFirmware, tickerLines, activeEffects, nodeProgramKind, familyNodes } from '../../utils/networkNodes.js';
import { showNamePicker } from '../../utils/namePicker.js';
import { editNodeDialog } from './NodeDialogs.js';

export class NodeConsoleApp extends BaseApplication {

  /** @param {string} nodeId */
  constructor(nodeId, options = {}) {
    super(foundry.utils.mergeObject({ id: `ncm-node-${nodeId}` }, options, { inplace: false }));
    this.nodeId = nodeId;
    this._lastState = null;
    this._waveTimer = null;
    /** The open jack-in session on this client: { actorId, rank, moves, used, margin } — null when not jacked in. */
    this._session = null;
    this._busy = false;
  }

  get networkService() { return game.nightcity?.networkService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ['ncm-app', 'ncm-node-console'],
    window: { title: 'Network node', resizable: false, minimizable: true, icon: 'fas fa-tower-broadcast' },
    position: { width: 560, height: 'auto' },
    actions: {
      connect: NodeConsoleApp._onConnect,
      toggle: NodeConsoleApp._onToggle,
      edit: NodeConsoleApp._onEdit,
      inspect: NodeConsoleApp._onInspect,
      jam: NodeConsoleApp._onJam,
      jack: NodeConsoleApp._onJack,
      jackOut: NodeConsoleApp._onJackOut,
      sessAct: NodeConsoleApp._onSessionAction,
      sessKill: NodeConsoleApp._onSessionKill,
      switchOperator: NodeConsoleApp._onSwitchOperator,
      sessRecall: NodeConsoleApp._onSessionRecall,
      sessCollect: NodeConsoleApp._onSessionCollect,
    },
  }, { inplace: false });

  static PARTS = { main: { template: TEMPLATES.NODE_CONSOLE } };

  /**
   * Open the console for a node. Players never open a hidden one.
   * @param {string} nodeId
   */
  static open(nodeId) {
    const ns = game.nightcity?.networkService;
    const node = ns?.getNode?.(nodeId);
    if (!node) return void ui.notifications.warn('That node no longer exists.');
    if (node.hidden && !isGM()) return void ui.notifications.warn('There is nothing there.');
    const existing = foundry.applications?.instances?.get?.(`ncm-node-${nodeId}`);
    if (existing) { existing.render(true); existing.bringToFront?.(); return existing; }
    const app = new NodeConsoleApp(nodeId);
    app.render(true);
    return app;
  }

  get title() {
    const n = this.networkService?.getNode?.(this.nodeId);
    return n ? n.name : 'Network node';
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext?.(options) ?? {};
    const ns = this.networkService;
    const node = ns?.getNode?.(this.nodeId);
    if (!node) return { ...ctx, gone: true, name: 'Gone', state: 'off', ticker: '— no carrier —', bars: [], alertPips: [] };
    const net = ns.getNetwork(node.networkId);
    const now = ns._nowMs();
    const st = nodeStateAt(node, now);
    const up = st === 'on';
    const kind = NODE_KINDS[node.kind] || NODE_KINDS.relay;
    const signal = up ? (net?.signalStrength ?? 0) : 0;
    const scene = game.scenes?.viewed;
    const sameScene = !!scene && scene.id === node.sceneId;
    const reaches = !!ns.getAvailableNetworks().find((n) => n.id === node.networkId);
    const onIt = up && reaches && ns.currentNetworkId === node.networkId && !ns.isDeadZone;
    const boxLocked = !!node.security?.requiresAuth;
    const here = (game.users?.filter?.((u) => u.active && !u.isGM && u.viewedScene === node.sceneId) ?? []).length;
    const fmt = (ts) => (ts ? formatCyberDate(new Date(ts).toISOString(), { timeOnly: true }) : '');
    const lvl = node.alert || 0;
    return {
      ...ctx,
      isGM: isGM(),
      name: node.name, place: node.place, kindLabel: kind.label, icon: kind.icon,
      hex: nodeHex(node.id), firmware: nodeFirmware(node),
      networkName: net?.name || 'Unknown network', color: net?.theme?.color || '#19f3f7',
      state: st, isUp: up, stateLabel: stateLabel(node, now),
      signal, rate: up ? `${(signal / 18).toFixed(1)} kb/s` : st === 'jammed' ? 'noise' : 'no carrier',
      bars: [5, 8, 11, 14].map((h, i) => ({ h, on: signal >= [1, 25, 50, 80][i] })),
      here,
      alertLabel: ALERT_LEVELS[lvl],
      alertPips: [0, 1, 2].map((i) => ({ cls: i < lvl ? (lvl >= 3 && i === 2 ? 'is-a' : 'is-w') : '' })),
      boxLocked,
      onIt,
      canConnect: up && sameScene && reaches && !onIt,
      connectHint: onIt ? `You're on ${net?.name || 'it'}` : !up ? 'Nothing to connect to — it is down'
        : !sameScene ? 'You have to be where it is' : !reaches ? 'Out of reach here' : `Join ${net?.name || 'the network'}${net?.security?.requiresAuth ? ' — it asks for its login' : ''}`,
      canSwitch: isGM() || (!boxLocked && (st === 'on' || st === 'off')),
      ...this._othersHere(node, net, now),
      isJammed: st === 'jammed',
      switchLabel: up ? 'Switch off' : (st === 'jammed' && isGM()) ? 'Unjam' : (st === 'damaged' && isGM()) ? 'Repair' : 'Switch on',
      switchHint: (up && this._othersHere(node, net, now).othersUp) ? `Only this node — ${this._othersHere(node, net, now).othersUp} other node${this._othersHere(node, net, now).othersUp === 1 ? '' : 's'} keep${this._othersHere(node, net, now).othersUp === 1 ? 's' : ''} ${net?.name || 'the network'} up here`
        : isGM() ? (up ? `${net?.name || 'The network'} goes dark on this scene` : st === 'jammed' ? 'GM — end the jam now' : st === 'damaged' ? 'GM — mark it repaired, back on' : 'Bring it back up')
        : boxLocked ? 'The box is locked — jack in to get at it'
          : st === 'damaged' ? 'It is damaged — someone has to repair it'
            : st === 'jammed' ? 'Jammed — it comes back by itself'
              : up ? `${net?.name || 'The network'} goes dark here` : 'Bring it back up',
      ticker: tickerLines(node, net || {}, { now, fmt, symptoms: this._rules().infection.symptoms || isGM() }).join('     ·     '),
      ...this._jackContext(node, net, st, sameScene),
      operator: this._operatorContext(),
      ...this._nodeFlags(node, now),
    };
  }

  /** What is on the node right now — the GM sees all of it; a player sees an infection only as symptoms. */
  _nodeFlags(node, now) {
    const flags = [];
    if (isGM()) {
      for (const e of activeEffects(node, 'taps', now)) flags.push({ tone: 'secret', icon: 'fa-ear-listen', label: `Tapped — ${e.actorName || 'someone'}` });
      for (const e of activeEffects(node, 'backdoors', now)) flags.push({ tone: 'secret', icon: 'fa-door-open', label: `Backdoor — ${e.actorName || 'someone'}` });
      for (const x of node.infections || []) flags.push({ tone: 'bad', icon: NODE_PROGRAMS[x.kind].icon, label: `${NODE_PROGRAMS[x.kind].label} — ${x.actorName || 'someone'}${x.sloppy ? ' (sloppy)' : ''}` });
    }
    const symptoms = !isGM() && (node.infections || []).length > 0 && this._rules().infection.symptoms;
    const jamLeft = node.state === 'jammed' && node.jammedUntil ? Math.max(1, Math.ceil((node.jammedUntil - now) / 60000)) : 0;
    return { flags, hasFlags: flags.length > 0, symptoms, jamLeft, isDamaged: node.state === 'damaged', statusTags: this._statusTags(node, now, { symptoms, jamLeft }) };
  }

  /**
   * The status tags along the top: everything true about this node right now, in its meaning colour — the GM sees
   * all of it (names in the tooltips); a player sees the node's state, its alert, a locked box, being locked out,
   * their own session / tap / backdoor / programs, and an infection only as UNSTABLE (when symptoms are on).
   */
  _statusTags(node, now, { symptoms, jamLeft }) {
    const t = [];
    const add = (tone, icon, label, tip = '') => t.push({ tone, icon, label, tip });
    const st = nodeStateAt(node, now);
    if (st === 'jammed') add('attn', 'fa-wave-square', jamLeft ? `Jammed · ${jamLeft}m` : 'Jammed', 'Off until the jam runs out');
    else if (st === 'off') add('plain', 'fa-power-off', 'Off', 'Switched off — the network may be dark here');
    else if (st === 'damaged') add('bad', 'fa-triangle-exclamation', 'Damaged', 'Off until someone repairs it');
    const lvl = node.alert || 0;
    if (lvl) add(lvl >= 2 ? 'bad' : 'attn', 'fa-bell', `Alert: ${ALERT_LEVELS[lvl]}`, 'Raised by failed attempts');
    if (node.security?.requiresAuth) add('secret', 'fa-lock', 'Box locked', 'Only a jack-in can switch it');
    if (isGM() && node.hidden) add('secret', 'fa-eye-slash', 'Hidden', 'Players cannot see this node');
    const sess = this._session;
    if (sess) {
      const run = sess.actorId ? liveRun(node, sess.actorId, now) : null;
      const ends = run ? ` · this session ends in ${Math.max(1, Math.ceil((run.until - now) / 60000))} min — jacking back in before then keeps the moves you spent` : '';
      add('act', 'fa-plug', `Jacked in · ${Math.max(0, sess.moves - sess.used)} move${sess.moves - sess.used === 1 ? '' : 's'}`, `${game.actors?.get(sess.actorId)?.name || 'GM'} is in the node${ends}`);
    }
    // locked out (the runner this console acts as)
    try {
      const op = resolveOperator();
      const ms = op ? game.nightcity?.securityService?.getLockoutRemaining?.(op.id, jackKey(node)) : 0;
      if (ms > 0) add('bad', 'fa-ban', `Locked out · ${Math.ceil(ms / 60000)}m`, 'Too many failed jack-ins');
    } catch { /* no security service */ }
    const taps = activeEffects(node, 'taps', now), doors = activeEffects(node, 'backdoors', now), infs = node.infections || [];
    const me = sess?.actorId || resolveOperator()?.id || '';
    const names = (list) => [...new Set(list.map((x) => x.actorName || 'someone'))].join(', ');
    if (isGM()) {
      if (taps.length) add('secret', 'fa-ear-listen', `Tapped${taps.length > 1 ? ` ×${taps.length}` : ''}`, `For ${names(taps)}`);
      if (doors.length) add('secret', 'fa-door-open', `Backdoor${doors.length > 1 ? ` ×${doors.length}` : ''}`, `For ${names(doors)}`);
      if (infs.length) add('bad', 'fa-bug', `Infected${infs.length > 1 ? ` ×${infs.length}` : ''}`, infs.map((x) => `${NODE_PROGRAMS[x.kind].label} — ${x.actorName || 'someone'}${x.sloppy ? ' (sloppy)' : ''}`).join(' · '));
    } else {
      if (me && taps.some((x) => x.actorId === me)) add('secret', 'fa-ear-listen', 'Your tap', 'Mail over this network is copied to you');
      if (me && doors.some((x) => x.actorId === me)) add('secret', 'fa-door-open', 'Your backdoor', 'You skip this network\'s login');
      const mine = infs.filter((x) => x.actorId === me);
      if (mine.length) add('secret', 'fa-bug', `Your program${mine.length > 1 ? ` ×${mine.length}` : ''}`, mine.map((x) => x.name || NODE_PROGRAMS[x.kind].label).join(' · '));
      if (symptoms && infs.some((x) => x.actorId !== me)) add('attn', 'fa-heart-crack', 'Unstable', 'Something is wrong with this node');
    }
    return t;
  }

  /** Other UP nodes of the same network on this node's scene — while there are any, switching this one off does not drop the network there. */
  _othersHere(node, net, now) {
    const others = (this.networkService?.getNodes?.({ networkId: node.networkId, sceneId: node.sceneId }) ?? []).filter((n) => n.id !== node.id && nodeStateAt(n, now) === 'on');
    return { othersUp: node.sceneId ? others.length : 0 };
  }

  /** The toast after a switch: say what actually happened to the network. */
  _switchToast(node, turnedOff) {
    const ns = this.networkService;
    const net = ns?.getNetwork?.(node.networkId);
    const left = this._othersHere(node, net, ns?._nowMs?.() ?? Date.now()).othersUp;
    if (!turnedOff) return ui.notifications.info(`${node.name} is back on.`);
    ui.notifications.info(left
      ? `${node.name} is off — but ${left} other node${left === 1 ? '' : 's'} of ${net?.name || 'the network'} on this scene still carr${left === 1 ? 'ies' : 'y'} it. Switch ${left === 1 ? 'that one' : 'them'} off too to drop it here.`
      : `${node.name} is off — ${net?.name || 'the network'} is dark on this scene.`);
  }

  /** WHO this console acts as — the terminal's OPERATOR chip, same rule (resolveOperator), plus the rank it reads. */
  _operatorContext() {
    const rules = this._rules();
    const { actor, rank } = this._runner(rules);
    return {
      name: actor?.name || '', img: actor?.img || '', skill: rules.skill, rank,
      canSwitch: getOperatorActors().length > 1,
      gmFree: !actor && isGM(),
      locked: !!this._session,
    };
  }

  // ═══════════════════════════════ jacking in (step 3) ═══════════════════════════════

  /** Save this session on the node (spent moves, still jacked in). GM with no character: nothing to save. */
  async _saveRun(open) {
    const sess = this._session; if (!sess?.actorId) return;
    const rules = this._rules();
    try {
      await this.networkService?.saveRun(this.nodeId, { actorId: sess.actorId, actorName: game.actors?.get(sess.actorId)?.name || '',
        rank: sess.rank, moves: sess.moves, used: sess.used, open, minutes: rules.session.minutes });
    } catch (e) { console.warn('NCM | saving the node session failed', e); }
  }

  _rules() { try { return resolveJackIn(game.settings.get(MODULE_ID, 'jackInRules')); } catch { return resolveJackIn({}); } }

  /** Who is jacking in, and their rank in the rules' skill (a GM with no character counts as top rank). */
  _runner(rules = this._rules()) {
    const actor = resolveOperator();
    if (!actor) return { actor: null, rank: isGM() ? 10 : 0, stat: null };
    const d = game.nightcity?.skillService?.getSkillData?.(actor, rules.skill) || {};
    return { actor, rank: Number(d.skillLevel) || 0, stat: d.statName && d.statName !== 'none' ? { label: String(d.statName).toUpperCase(), value: Number(d.statValue) || 0 } : null };
  }

  _jackContext(node, net, st, sameScene) {
    const rules = this._rules();
    const { actor, rank } = this._runner(rules);
    if (!this._session && actor && !this._jackedOut) {
      const run = liveRun(node, actor.id, this.networkService?._nowMs?.() ?? 0);
      if (run?.open) this._session = { actorId: actor.id, rank: run.rank, moves: run.moves, used: run.used, margin: 0, resumed: true, kicks: run.kicks || 0 };
    }
    // the GM kicked this runner out (the run's kick count went up) — drop the session here
    if (this._session?.actorId) {
      const run = liveRun(node, this._session.actorId, this.networkService?._nowMs?.() ?? 0);
      if (run && (run.kicks || 0) > (this._session.kicks || 0)) {
        this._session = null; this._jackedOut = true;
        setTimeout(() => { this._flash('fail', 'DISCONNECTED'); ui.notifications.warn(`${node.name} threw you out.`); }, 0);
      }
    }
    const dv = jackInDV(rules, node);
    const sess = this._session;
    if (sess) {
      const left = Math.max(0, sess.moves - sess.used);
      const actions = JACK_ACTIONS.filter((a) => rules.actions[a.key].on && JACK_BUILT.includes(a.key)).map((a) => {
        const v = actionView(rules, a.key, sess.rank);
        const label = a.key === 'switch' ? (st === 'on' ? 'Switch off' : 'Switch on') : v.label;
        const out = v.move && left <= 0;
        return {
          ...v, label, run: v.unlocked && !out && !(a.key === 'jam' && st !== 'on'),
          dvText: a.key === 'insert' ? 'its own DV' : v.dv === null ? 'no roll' : `DV ${v.dv}`, baseText: v.edge ? String(v.baseDv) : '',
          note: !v.unlocked ? `needs ${rules.skill} ${v.need}` : v.edge ? `−${v.edge} for your rank` : v.move ? 'costs a move' : 'free',
          noteTone: !v.unlocked ? 'attn' : v.edge ? 'good' : 'plain',
        };
      });
      const now = this.networkService?._nowMs?.() ?? Date.now();
      const mine = (k) => !!sess.actorId && activeEffects(node, k, now).some((e) => e.actorId === sess.actorId);
      for (const a of actions) {
        if (a.key === 'tap' && mine('taps')) a.have = 'Your tap is listening';
        if (a.key === 'backdoor' && mine('backdoors')) a.have = 'Your backdoor is open';
      }
      const found = Array.isArray(sess.found) ? sess.found.map((f) => {
        const live = f.kind === 'inf' ? node.infections.some((x) => x.id === f.id) : activeEffects(node, f.kind, now).some((x) => x.id === f.id);
        return { ...f, live };
      }).filter((f) => f.live) : null;
      return {
        session: {
          actions, left, total: sess.moves, who: game.actors?.get(sess.actorId)?.name || 'GM', rank: sess.rank, skill: rules.skill,
          pips: Array.from({ length: sess.moves }, (_, i) => ({ on: i < left })),
          swept: Array.isArray(sess.found), found: found || [], foundNone: Array.isArray(sess.found) && !(found || []).length,
          mine: sess.actorId ? node.infections.filter((x) => x.actorId === sess.actorId).map((x) => ({
            id: x.id, family: x.family, icon: NODE_PROGRAMS[x.kind].icon, label: x.name || NODE_PROGRAMS[x.kind].label,
            detail: x.kind === 'worm' ? `on ${familyNodes(this.networkService.getNodes(), x.family).length} node(s)` : x.kind === 'sniffer' ? `${x.loot.length} caught` : x.kind === 'bomb' ? 'armed' : 'listening',
            canCollect: x.kind === 'sniffer' && x.loot.length > 0, sloppy: x.sloppy,
          })) : [],
        },
      };
    }
    const gate = actor && !isGM() ? jackGate(rules, actor, canOperate) : { ok: true };
    const reason = !actor && !isGM() ? 'Pick a character first'
      : !gate.ok ? (gate.reason || 'Not someone who can jack in')
      : (!isGM() && !sameScene) ? 'You have to be where it is'
        : st === 'damaged' ? 'It is damaged — nothing to jack into' : '';
    return {
      session: null,
      canJack: !reason,
      jackHint: reason || `${rules.skill} ${rank} vs DV ${dv} · ${movesFor(rules, rank, 0)} moves`,
    };
  }

  /** Make room for the lock (it covers the console); restored after. */
  _lockHost() {
    const wc = this.element?.querySelector('.window-content');
    if (!wc) return null;
    wc.style.position = 'relative';
    wc.style.minHeight = '470px';
    wc.scrollTop = 0;
    wc.classList.add('is-locking');
    return wc;
  }

  _releaseHost(wc) {
    if (!wc) return;
    wc.style.minHeight = '';
    wc.classList.remove('is-locking');
    this.setPosition?.({ height: 'auto' });
  }

  async _jackIn() {
    if (this._busy) return;
    const ns = this.networkService;
    const node = ns?.getNode(this.nodeId); if (!node) return;
    const net = ns.getNetwork(node.networkId);
    const rules = this._rules();
    const { actor, rank, stat } = this._runner(rules);
    if (!actor && !isGM()) return void ui.notifications.warn('Pick a character to jack in with.');
    if (actor && !isGM()) {
      const gate = jackGate(rules, actor, canOperate);
      if (!gate.ok) return void ui.notifications.warn(gate.reason || 'You cannot jack in.');
    }
    const sec = game.nightcity?.securityService;
    const key = jackKey(node);
    if (actor && sec) {
      if (sec.isLockedOut(actor.id, key)) {
        const ms = sec.getLockoutRemaining?.(actor.id, key) || 0;
        return void ui.notifications.warn(`${net?.name || 'The network'} has locked you out${ms ? ` — ${Math.ceil(ms / 60000)} min` : ''}.`);
      }
      // the network's own login lockout — a failed jack-in counts against its login and the other way round
      const lk = jackLock(rules, net);
      if (lk.maxAttempts > 0) sec.initTracking(actor.id, key, { maxAttempts: lk.maxAttempts, lockoutDuration: lk.lockoutDuration });
    }
    const dv = jackInDV(rules, node);
    const res = jackResolution(rules, node);
    const mode = res === 'inherit' ? resolveHackResolution() : res;
    const layers = lockLayers(node, net).map((l) => ({ ...l, text: l.key === 'box' ? `${node.name} // BOX LOCK` : l.key === 'firmware' ? `FIRMWARE ${nodeFirmware(node)} // ${nodeHex(node.id)}` : `${net?.name || 'NETWORK'} // HANDSHAKE` }));
    const parts = [stat, { label: rules.skill.slice(0, 10), value: rank }].filter(Boolean);
    const anim = {
      color: net?.theme?.color, title: `Jacking in // ${node.name}`, dvLabel: `${rules.skill} · DV ${dv}`, layers, parts, dv,
      bloom: ns.getNodes({ networkId: node.networkId }).length + 4, netName: net?.name, hex: nodeHex(node.id),
    };
    this._busy = true;
    const host = this._lockHost();
    const snd = game.nightcity?.soundService;
    snd?.play?.('hack-start');
    let ok = false, total = dv, d10 = 0, post = null;
    try {
      if (!actor) {
        // a GM with no character: no roll, straight in
        ok = true; total = dv; d10 = Math.max(1, dv - parts.reduce((x, p) => x + p.value, 0));
        const play = runJackIn(host, { ...anim, kind: 'in', result: { d10, total, dv, moves: movesFor(rules, rank, 0) } });
        await play.finished;
      } else if (mode === 'gm') {
        const play = runJackIn(host, { ...anim, kind: 'wait' });
        const req = requestNetAdjudication({ actor, verb: 'Backdoor', action: 'jack-in', title: `Jack into ${node.name}`, skill: rules.skill, dv, hostName: node.name });
        const v = await req.promise;
        if (v.cancelled) { play.destroy(); return; }
        ok = !!v.ok; total = ok ? dv : dv - 3;
        d10 = Math.max(1, Math.min(10, total - parts.reduce((x, p) => x + p.value, 0)));
        play.setVerdict(ok ? 'in' : 'miss', { d10, total, dv, moves: movesFor(rules, rank, ok ? 0 : 0), sub: ok ? undefined : `THE GM CALLED IT · ${node.name.toUpperCase()}` });
        setTimeout(() => snd?.play?.(ok ? 'hack-success' : 'hack-fail'), 1000);
        await play.finished;
      } else {
        const res = await game.nightcity.skillService.performCheck(actor, rules.skill, { dc: dv, deferChat: true, context: `Jack in: ${node.name}`, flavor: `Jacking into ${node.name}` });
        ok = !!res.success; total = res.total; d10 = res.processedRoll ?? res.rollValue;
        post = res.postChat;
        const margin = total - dv;
        const left = sec && actor ? (sec.getState?.(actor.id, key)?.attempts ?? null) : null;
        const play = runJackIn(host, { ...anim, kind: ok ? 'in' : 'miss', result: { d10, total, dv, moves: movesFor(rules, rank, margin),
          sub: ok ? undefined : `${total} VS DV ${dv}${rules.failure.trace ? ' · TRACE FIRED' : ''}${rules.failure.alert ? ' · ALERT ▲' : ''}` } });
        setTimeout(() => { snd?.play?.(ok ? 'hack-success' : 'hack-fail'); try { post?.(); } catch { /* chat */ } }, 4100);
        if (mode === 'flagged') postNetActionCard({ ok, total, dv, skill: rules.skill, verb: 'Backdoor', actorName: actor.name, hostName: node.name, title: `Jack into ${node.name}` });
        void left;
        await play.finished;
      }
    } finally {
      this._busy = false;
      this._releaseHost(host);
    }
    await this._afterJack(node, net, rules, { actor, rank, ok, total, dv });
  }

  async _afterJack(node, net, rules, { actor, rank, ok, total, dv }) {
    const ns = this.networkService;
    const sec = game.nightcity?.securityService;
    const trace = game.nightcity?.traceService;
    const who = actor?.name || 'GM';
    const key = jackKey(node);
    const tr = { actor, action: 'jack-in', targetKind: 'network', targetNetworkId: node.networkId, objectId: `node:${node.id}`, objectName: node.name, dv, margin: total - dv };
    if (ok) {
      if (actor) sec?.recordSuccess?.(actor.id, key);
      const run = actor ? liveRun(node, actor.id, ns._nowMs()) : null;
      this._jackedOut = false;
      if (run) {
        // the node remembers you: the same moves as before, and coming back is noticed
        this._session = { actorId: actor.id, rank: run.rank, moves: run.moves, used: run.used, margin: total - dv, resumed: true, kicks: run.kicks || 0 };
        if (!run.open && rules.session.returnAlert) await ns.bumpNodeAlert(node.id, 1);
        await ns.nodeLog(node.id, who, 'jacked back in');
        if (run.used >= run.moves) ui.notifications.warn(`${node.name} remembers this session — no moves left until it ends.`);
        else ui.notifications.info(`Back in the same session — ${run.moves - run.used} of ${run.moves} moves left.`);
      } else {
        this._session = { actorId: actor?.id || null, rank, moves: movesFor(rules, rank, total - dv), used: 0, margin: total - dv, kicks: 0 };
        await ns.nodeLog(node.id, who, 'jacked in');
      }
      await this._saveRun(true);
      if (actor) trace?.logSuccess?.({ ...tr, outcome: 'success', severity: 'minor' });
    } else {
      if (actor) sec?.recordFailedAttempt?.(actor.id, key);
      if (rules.failure.alert) await ns.bumpNodeAlert(node.id, 1);
      await ns.nodeLog(node.id, '', 'intrusion attempt');
      if (rules.failure.trace && actor) trace?.fireTrace?.({ ...tr, severity: rules.failure.severity });
    }
    this.render();
  }

  /** Run one session action. */
  async _sessionAction(key) {
    const sess = this._session; if (!sess || this._busy) return;
    const ns = this.networkService;
    const node = ns.getNode(this.nodeId); if (!node) return;
    const rules = this._rules();
    const v = actionView(rules, key, sess.rank); if (!v || !v.on || !v.built) return;
    if (!v.unlocked) return void ui.notifications.warn(`That needs ${rules.skill} ${v.need}.`);
    if (v.move && sess.used >= sess.moves) return void ui.notifications.warn('No moves left — jack out.');
    const actor = sess.actorId ? game.actors?.get(sess.actorId) : null;
    const who = actor?.name || 'GM';
    const st = nodeStateAt(node, ns._nowMs());
    if (key === 'insert') return this._insertProgram(node, rules, sess, actor, v);
    if (key === 'sweep') return this._sweep(node, rules, sess, actor, v);
    let ok = true;
    if (v.dv !== null && actor) {
      this._busy = true;
      try {
        const res = await game.nightcity.skillService.performCheck(actor, rules.skill, { dc: v.dv, context: `${v.label}: ${node.name}`,
          reveal: { host: this.element?.querySelector('.window-content'), title: `${v.label} — ${node.name}` } });
        ok = !!res.success;
        sess.lastTotal = res.total;
      } finally { this._busy = false; }
    }
    if (v.move) { sess.used += 1; this._saveRun(true); }
    if (!ok) {
      if (rules.failure.alert) await ns.bumpNodeAlert(node.id, 1);
      if (rules.failure.trace && actor) game.nightcity?.traceService?.fireTrace?.({ actor, action: `node-${key}`, targetKind: 'network', targetNetworkId: node.networkId, objectId: `node:${node.id}`, objectName: node.name, dv: v.dv, severity: 'minor' });
      this._flash('fail', `${v.label.toUpperCase()} FAILED`);
      ui.notifications.warn(`${v.label} failed — the node noticed.`);
      return this.render();
    }
    if (key === 'switch') { const r = await ns.setNodeState(node.id, st === 'on' ? 'off' : 'on', { who }); if (r?.success) { this._flash(st === 'on' ? 'off' : 'on', st === 'on' ? 'POWER DOWN' : 'POWER UP'); this._switchToast(node, st === 'on'); } else ui.notifications.warn(r?.error || 'Nothing happened.'); }
    else if (key === 'jam') {
      const r = await ns.setNodeState(node.id, 'jammed', { minutes: rules.actions.jam.minutes || 30, who });
      if (r?.success) { this._flash('jam', 'JAMMED'); ui.notifications.info(r.relayed ? `Jamming ${node.name} — waiting on the GM's client.` : `${node.name} jammed for ${rules.actions.jam.minutes || 30} min.`); } else ui.notifications.warn(r?.error || 'The jam did not take.');
    }
    else if (key === 'tap' || key === 'backdoor') {
      if (!actor) { ui.notifications.warn(`A ${v.label.toLowerCase()} needs a character to work for — pick one first.`); return this.render(); }
      const kind = key === 'tap' ? 'taps' : 'backdoors';
      const r = await ns.addNodeEffect(node.id, kind, { actorId: actor.id, actorName: actor.name, minutes: rules.actions[key].minutes });
      if (!r?.success) ui.notifications.warn(r?.error || 'It did not take.');
      else this._flash(key, key === 'tap' ? 'LINK ESTABLISHED' : 'BACKDOOR OPEN');
      if (r?.success) ui.notifications.info(key === 'tap'
        ? `Tap set — mail sent over ${ns.getNetwork(node.networkId)?.name || 'the network'} now copies to ${actor.name}'s EXFIL folder${rules.actions.tap.minutes ? ` for ${rules.actions.tap.minutes} min` : ''}.`
        : `Backdoor open — ${actor.name} skips ${ns.getNetwork(node.networkId)?.name || 'the network'}'s login${rules.actions.backdoor.minutes ? ` for ${Math.round(rules.actions.backdoor.minutes / 60)} h` : ''}.`);
    }
    else if (key === 'wipe') {
      const r = await ns.wipeNodeLog(node.id, who);
      if (r?.success) this._flash('wipe', 'LOG SCRUBBED'); else return void ui.notifications.warn(r?.error || 'The log did not change.');
      ui.notifications.info(r?.relayed ? 'You scrub your name off the node log.' : `${r?.wiped ?? 0} line${r?.wiped === 1 ? '' : 's'} wiped from the node log.`);
    }
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element?.querySelector('.ncm-ndc');
    if (!root) return;
    if (this._lastState && this._lastState !== context.state) {
      root.classList.remove('is-glitch'); void root.offsetWidth; root.classList.add('is-glitch');
    }
    this._lastState = context.state;
    this._startWave(root, context.state);
    // live: the node or the network changed (the networkNodes hook, a switch)
    if (!this._subbed) {
      this._subbed = true;
      this._onNodesSetting = (setting) => { if (setting?.key === `${MODULE_ID}.networkNodes`) this._debouncedRender(); };
      Hooks.on('updateSetting', this._onNodesSetting);
      this.subscribe(EVENTS.NETWORK_CHANGED, () => this._debouncedRender());
      this.subscribe(EVENTS.NETWORK_CONNECTED, () => this._debouncedRender());
      this.subscribe(EVENTS.NETWORK_DISCONNECTED, () => this._debouncedRender());
    }
  }

  /** The traffic trace: a rolling line — busy when on, sparse spikes when jammed, flat when off. */
  _startWave(root, state) {
    clearInterval(this._waveTimer);
    const path = root.querySelector('[data-ndc-wave]');
    if (!path) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const amp = state === 'on' ? 18 : state === 'jammed' ? 5 : 0;
    const pts = Array.from({ length: 60 }, () => 26);
    const step = () => {
      pts.shift();
      let y = 26;
      if (amp) y += (Math.random() - 0.5) * 2 * amp * (Math.random() < 0.15 ? 1.4 : 0.6);
      if (state === 'jammed' && Math.random() < 0.2) y += (Math.random() - 0.5) * 30;
      pts.push(y);
      path.setAttribute('d', pts.map((v, i) => `${i ? 'L' : 'M'}${(i * 500 / 59).toFixed(1)} ${Math.max(3, Math.min(49, v)).toFixed(1)}`).join(' '));
    };
    for (let i = 0; i < 60; i++) step();
    if (!reduced && amp) this._waveTimer = setInterval(step, 70);
  }

  async close(options) {
    clearInterval(this._waveTimer);
    if (this._onNodesSetting) Hooks.off('updateSetting', this._onNodesSetting);
    if (this._session) { const s = this._session; this._saveRun(false).catch(() => {}); this._session = null; this.networkService?.nodeLog(this.nodeId, s.actorId ? (game.actors?.get(s.actorId)?.name || 'GM') : 'GM', 'jacked out').catch(() => {}); }
    return super.close(options);
  }

  // ─── actions ───

  static async _onConnect() {
    const node = this.networkService?.getNode(this.nodeId);
    if (!node) return;
    const res = await game.nightcity?.connectToNetwork?.(node.networkId);
    if (res && res.success === false && res.reason && res.reason !== 'auth_failed') ui.notifications.warn(`Could not connect (${res.reason.replace(/_/g, ' ')}).`);
    this.render();
  }

  static async _onToggle() {
    const ns = this.networkService;
    const node = ns?.getNode(this.nodeId);
    if (!node) return;
    const up = nodeStateAt(node, ns._nowMs()) === 'on';
    if (!isGM() && node.security?.requiresAuth) return void ui.notifications.warn('The box is locked.');
    const who = isGM() ? 'GM' : (resolveOperator()?.name || game.user.character?.name || game.user.name);
    const res = await ns.setNodeState(this.nodeId, up ? 'off' : 'on', { who });
    if (!res?.success) return void ui.notifications.warn(res?.error || 'Nothing happened.');
    game.nightcity?.soundService?.play(up ? 'disconnect' : 'connect');
    this._flash(up ? 'off' : 'on', up ? 'POWER DOWN' : 'POWER UP');
    this._switchToast(node, up);
  }

  static _onInspect() { if (isGM()) game.nightcity?.inspectNode?.(this.nodeId); }

  static async _onEdit() {
    if (!isGM()) return;
    const ns = this.networkService;
    const node = ns.getNode(this.nodeId);
    const net = node && ns.getNetwork(node.networkId);
    if (!node || !net) return;
    const edited = await editNodeDialog(node, net);
    if (edited) await ns.saveNode({ ...edited, id: node.id, networkId: node.networkId });
  }

  static async _onJack() { return this._jackIn(); }

  /** OPERATOR chip → the shared FUI picker (the terminal's). Not while jacked in — that session belongs to its runner. */
  static async _onSwitchOperator() {
    if (this._session) return void ui.notifications.warn('Jack out first — this session belongs to its runner.');
    if (!(await openOperatorPicker(this.element))) return;
    this.render();
  }

  static async _onJackOut() {
    const s = this._session; if (!s) return;
    await this._saveRun(false);
    this._session = null; this._jackedOut = true;
    const who = s.actorId ? game.actors?.get(s.actorId)?.name : 'GM';
    await this.networkService?.nodeLog(this.nodeId, who || 'GM', 'jacked out');
    game.nightcity?.soundService?.play?.('disconnect');
    this.render();
  }

  static async _onSessionAction(event, target) { return this._sessionAction(target?.dataset?.key); }

  /** Network programs this character carries on shards (entries flagged uploadable with a Network node verb). */
  _carriedNodePrograms(actor) {
    const shardSvc = game.nightcity?.dataShardService;
    if (!actor || !shardSvc?.isDataShard) return [];
    const out = [];
    for (const shard of (actor.items ?? []).filter((i) => shardSvc.isDataShard(i))) {
      let entries = [];
      try { entries = (shardSvc.getShardMessages(shard) || []).map((e) => shardSvc.exportEntry?.(shard, e) ?? e).filter(Boolean); } catch { entries = []; }
      for (const e of entries) {
        const cd = e.contentData || {};
        const kind = cd.uploadable ? nodeProgramKind(cd.uploadEffect) : null;
        if (!kind) continue;
        out.push({ id: `${shard.id}:${e.messageId}`, kind, name: e.subject || cd.name || NODE_PROGRAMS[kind].label, shard, entry: e, cd });
      }
    }
    return out;
  }

  /**
   * INSERT A SHARD — the terminal's upload, pointed at a node: the program picker + the compile code-stream
   * (UploadConsole), then the verdict console with the clean / glitchy / rejected ladder (SecurityConsole, which also
   * honours GM-decides). The program's own Run DV and skill.
   */
  async _insertProgram(node, rules, sess, actor, v) {
    const ns = this.networkService;
    if (!actor) return void ui.notifications.warn('A program needs a character to run it — pick one first.');
    const progs = this._carriedNodePrograms(actor);
    if (!progs.length) return void ui.notifications.info(`${actor.name} carries no network program. Build one in the shard composer: Uploadable → "Network node · …".`);
    const host = this._lockHost();
    try {
      const { runUploadConsole } = await import('../content/UploadConsole.js');
      const picked = await runUploadConsole({
        host: host || this.element, terminalName: node.name, tag: 'INSERT A SHARD', sub: `plant a network program in ${node.name}`,
        goLabel: 'INSERT', delivery: false, deliveryHint: 'what it does on this network',
        programs: progs.map((p) => ({ name: p.name, description: NODE_PROGRAMS[p.kind].blurb, sourceLabel: `on "${p.shard.name}"`, uploadDV: Number(p.cd.uploadDV) || 15,
          family: 'execute', effectType: `node${p.kind}`, _p: p })),
        outcomeFor: (prog) => ({ what: `<b>${prog.name}</b> — ${NODE_PROGRAMS[prog._p.kind].blurb}`,
          when: prog._p.kind === 'worm' ? `spreads every ${prog._p.cd.uploadParams?.every ?? 3} h, up to ${prog._p.cd.uploadParams?.maxNodes ?? 6} nodes${prog._p.cd.uploadParams?.carry ? `, carrying a ${NODE_PROGRAMS[prog._p.cd.uploadParams.carry]?.label}` : ''}`
            : prog._p.kind === 'bomb' ? `goes off ${prog._p.cd.uploadParams?.delay ?? 2} h after you insert it` : prog._p.kind === 'patch' ? 'right away' : 'from the moment it lands' }),
      });
      if (!picked) return;
      const pick = picked.program._p;
      const { forgeOutcome, forgeQualityFromMargin, stealthDVFromQuality, FORGE_SLOPPY_BAND } = await import('../content/UploadFlow.js');
      const { runSecurityConsole } = await import('../content/SecurityConsole.js');
      const dv = Number(pick.cd.uploadDV) || 15;
      const skill = pick.cd.uploadSkill || rules.skill;
      const res = await runSecurityConsole({
        title: 'Insert', icon: 'fas fa-microchip', accent: 'purple', host: host || this.element,
        intro: `Insert ${pick.name} into ${node.name}?\nBeat DV ${dv} for a clean install. Miss by up to ${FORGE_SLOPPY_BAND} and it still runs — but it's glitchy, and a sweep will find it easily. Miss by more and the node rejects it.`,
        gate: {
          require: true, skill, dv, actor, context: `Insert: ${pick.name}`, flavor: `RUN // DV ${dv}`,
          net: { verb: 'Virus', action: 'node-insert', hostName: node.name, choices: [
            { id: 'clean', label: 'CLEAN INSTALL', tone: 'ok', ok: true, total: dv + 4 },
            { id: 'sloppy', label: 'GLITCHY — IT RUNS', tone: 'warn', ok: true, total: dv - 2 },
            { id: 'reject', label: 'REJECTED', tone: 'fail', ok: false, total: dv - FORGE_SLOPPY_BAND - 2 },
          ] },
        },
        verdictFor: ({ total, dv: gdv }) => {
          const o = forgeOutcome(total ?? gdv, gdv);
          return o === 'clean' ? { label: 'INSTALL CLEAN', tone: 'ok' } : o === 'sloppy' ? { label: 'GLITCHY — IT RUNS', tone: 'warn' } : { label: 'REJECTED', tone: 'fail' };
        },
      });
      if (res.cancelled) return;
      if (v.move) { sess.used += 1; this._saveRun(true); }
      const total = res.total ?? dv;
      const rung = forgeOutcome(total, dv);
      if (rung === 'rejected') {
        if (rules.failure.alert) await ns.bumpNodeAlert(node.id, 1);
        if (rules.failure.trace) game.nightcity?.traceService?.fireTrace?.({ actor, action: 'node-insert', targetKind: 'network', targetNetworkId: node.networkId, objectId: `node:${node.id}`, objectName: node.name, dv, severity: rules.failure.severity });
        this._flash('fail', 'REJECTED');
        ui.notifications.warn(`${pick.name} was rejected — nothing installed, and the node noticed.`);
        return;
      }
      const quality = forgeQualityFromMargin(total, dv);
      const r = await ns.insertProgram(node.id, pick.kind, { name: pick.name, actorId: actor.id, actorName: actor.name, quality,
        stealthDV: stealthDVFromQuality(quality, pick.cd.uploadStealthDV), params: pick.cd.uploadParams || {} });
      if (!r?.success) return void ui.notifications.warn(r?.error || 'It did not install.');
      this._flash('insert', pick.kind === 'patch' ? 'NODE PATCHED' : rung === 'sloppy' ? 'INSTALLED — GLITCHY' : 'INSTALLED');
      ui.notifications.info(pick.kind === 'patch' ? `Patched — ${r.relayed ? 'the node is being cleaned' : `${r.cleaned} infection(s) cleaned`}.` : `${pick.name} installed${rung === 'sloppy' ? ' — glitchy: a sweep will find it easily' : ''}.`);
      if (rung === 'clean') game.nightcity?.traceService?.logSuccess?.({ actor, action: 'node-insert', targetKind: 'network', targetNetworkId: node.networkId, objectId: `node:${node.id}`, objectName: node.name, dv, outcome: 'success', severity: 'minor' });
    } finally {
      this._releaseHost(host);
      this.render();
    }
  }

  /**
   * SYSTEM SWEEP — the terminal's own sweep modal (radar, one roll, the found cards, Defuse), pointed at this node:
   * infections hide behind their stealth DV; taps and backdoors someone else left are always found. Never your own.
   */
  async _sweep(node, rules, sess, actor, v) {
    const ns = this.networkService;
    const { runSystemSweep } = await import('../content/SystemSweep.js');
    const HINT = { worm: 'something is copying itself', tap: 'traffic is being mirrored somewhere', bomb: 'a timer is counting down', sniffer: 'something is recording traffic' };
    const source = {
      name: node.name, sub: `deep-scan ${node.name} for planted programs`,
      list: () => {
        const cur = ns.getNode(node.id); if (!cur) return [];
        const now = ns._nowMs();
        const inf = cur.infections.filter((x) => !sess.actorId || x.actorId !== sess.actorId).map((x) => ({
          id: `inf:${x.id}`, stealthDV: x.stealthDV, icon: NODE_PROGRAMS[x.kind].icon, gmTitle: x.name || NODE_PROGRAMS[x.kind].label,
          gmType: NODE_PROGRAMS[x.kind].label.toUpperCase(), quality: x.quality, by: x.actorName || 'unknown', hint: HINT[x.kind] || 'an unknown process is running' }));
        const fx = Object.keys(NODE_EFFECTS).flatMap((k) => activeEffects(cur, k, now).filter((e) => !sess.actorId || e.actorId !== sess.actorId).map((e) => ({
          id: `${k}:${e.id}`, stealthDV: 0, icon: NODE_EFFECTS[k].icon, gmTitle: `${NODE_EFFECTS[k].label} for ${e.actorName || 'someone'}`, gmType: NODE_EFFECTS[k].label.toUpperCase(),
          by: e.actorName || 'unknown', hint: k === 'taps' ? 'traffic is being mirrored somewhere' : 'a door that should not be open' })));
        return [...inf, ...fx];
      },
      defuse: async (id) => {
        const [kind, fid] = String(id).split(/:(.+)/);
        const who = actor?.name || 'GM';
        if (kind === 'inf') await ns.cleanInfection(node.id, fid, who);
        else await ns.removeNodeEffect(node.id, kind, fid, who);
      },
    };
    if (v.move) { sess.used += 1; this._saveRun(true); }
    const host = this._lockHost();   // room for the sweep panel (the lock's height), scrolled to the top
    try { await runSystemSweep({ actor, host: host || this.element, skill: rules.skill, dv: v.dv ?? 15, source }); }
    finally { this._releaseHost(host); }
    this.render();
  }

  /**
   * A short full-window flash for an action that landed (power down, jam, a tap, a backdoor, a scrubbed log, an
   * install, a failure). Mounted on the WINDOW element so the part's re-render does not cut it short; reduced
   * motion skips it.
   */
  _flash(kind, label) {
    const root = this.element;
    if (!root || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    const ICON = { off: 'fa-power-off', on: 'fa-plug', jam: 'fa-wave-square', tap: 'fa-ear-listen', backdoor: 'fa-door-open', wipe: 'fa-eraser', insert: 'fa-microchip', fail: 'fa-skull' };
    root.querySelectorAll(':scope > .ncm-ndc-flash').forEach((x) => x.remove());
    const el = document.createElement('div');
    el.className = `ncm-ndc-flash is-${kind}`;
    const net = this.networkService?.getNetwork?.(this.networkService?.getNode?.(this.nodeId)?.networkId);
    if (net?.theme?.color) el.style.setProperty('--nc', net.theme.color);
    // Tap = the terminal download's packet stream, node → your Agent; Jam = a spectrum that saturates into noise.
    let scene = '';
    if (kind === 'tap') {
      scene = `<div class="ncm-ndc-flash__link"><span class="ncm-ndc-flash__end"><i class="fas fa-tower-broadcast"></i></span>
        <span class="ncm-ndc-flash__stream">${'<b></b>'.repeat(7)}</span>
        <span class="ncm-ndc-flash__end is-dst"><i class="fas fa-mobile-screen-button"></i></span></div>`;
    } else if (kind === 'jam') {
      const bars = Array.from({ length: 28 }, (_, i) => `<b style="--i:${i};--h:${18 + ((i * 37) % 70)}%"></b>`).join('');
      scene = `<div class="ncm-ndc-flash__spec">${bars}<span class="ncm-ndc-flash__carrier"></span></div>`;
    }
    el.innerHTML = `<div class="ncm-ndc-flash__fx"></div><div class="ncm-ndc-flash__box">${scene}<div class="ncm-ndc-flash__lb"><i class="fas ${ICON[kind] || 'fa-bolt'}"></i><span></span></div></div>`;
    el.querySelector('.ncm-ndc-flash__lb span').textContent = label;
    const long = kind === 'tap' || kind === 'jam';
    if (long) el.classList.add('is-long');
    root.appendChild(el);
    if (kind === 'tap') this.playSound?.('send');
    setTimeout(() => el.remove(), long ? 2500 : 1700);
  }

  /** The planter pulls their program off every node it reached. */
  static async _onSessionRecall(event, target) {
    const sess = this._session; if (!sess?.actorId) return;
    const r = await this.networkService?.recallFamily(target?.dataset?.family, sess.actorId);
    ui.notifications.info(r?.relayed ? 'Recall sent.' : `Recalled from ${r?.nodes ?? 0} node(s).`);
    this.render();
  }

  /** A sniffer's catch → the planter's EXFIL folder. */
  static async _onSessionCollect(event, target) {
    const sess = this._session; if (!sess?.actorId) return;
    const r = await this.networkService?.collectSniffer(this.nodeId, target?.dataset?.infId, sess.actorId);
    if (!r?.success) return void ui.notifications.warn(r?.error || 'Nothing to collect.');
    ui.notifications.info(r.relayed ? 'Collecting — it lands in your EXFIL folder.' : `${r.collected} message(s) to your EXFIL folder.`);
    this.render();
  }

  /** Remove something a sweep found (free — the sweep already paid for finding it). */
  static async _onSessionKill(event, target) {
    const sess = this._session; if (!sess) return;
    const { kind, fxId } = target?.dataset ?? {};
    const who = sess.actorId ? game.actors?.get(sess.actorId)?.name : 'GM';
    const r = kind === 'inf' ? await this.networkService?.cleanInfection(this.nodeId, fxId, who || 'GM') : await this.networkService?.removeNodeEffect(this.nodeId, kind, fxId, who || 'GM');
    if (r?.success) { sess.found = (sess.found || []).filter((f) => f.id !== fxId); ui.notifications.info('Removed.'); }
    else ui.notifications.warn(r?.error || 'Could not remove it.');
    this.render();
  }

  static async _onJam() {
    if (!isGM()) return;
    const r = await this.networkService.setNodeState(this.nodeId, 'jammed', { minutes: 30, who: 'GM' });
    if (r?.success) this._flash('jam', 'JAMMED'); else ui.notifications.warn(r?.error || 'The jam did not take.');
  }
}

log.debug('NodeConsoleApp loaded');
