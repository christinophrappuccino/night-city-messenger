/**
 * NetResolve — netrunning Tier C adjudication + the Tier B NET-action card
 * (design doc §5, `hackResolution`).
 * @file scripts/ui/content/NetResolve.js
 * @module cyberpunkred-messenger
 * @description NCM must never pretend to BE netrunning. When a table sets
 *   `hackResolution: 'gm'` (globally or per-terminal), a gated hack/upload
 *   action does NOT auto-roll — the player's SecurityConsole enters an
 *   AWAITING-GM stage while the GM gets the **NetAdjudicator** prompt here:
 *   what's being attempted, whose NET-action shape it is (§5's `netAction`
 *   vocabulary), and verdict buttons. The table runs the NET however they
 *   already do; the GM calls it; NCM applies state. `'flagged'` keeps the
 *   auto-roll but posts the GM a NET-action card naming the shape.
 *
 *   Protocol (the exfil REQUEST/RESULT precedent — broadcast + userId filter):
 *     player  — NET_RESOLVE_REQUEST { requestId, userId, payload }
 *     GM      — NetAdjudicator modal → NET_RESOLVE_RESULT { requestId, userId,
 *               choiceId | dismissed }
 *     player  — may withdraw while waiting → NET_RESOLVE_CANCEL { requestId }
 *   A GM operating on their own client skips the wire and adjudicates locally
 *   (socket emits don't echo to the sender). DISMISS = the action is withdrawn —
 *   cancelled, NOT failed, so no trace fires and the player can retry.
 *
 *   Framework-free promise modal in the ResidentConsole/SecurityConsole family.
 *   NB: keep backticks out of the template literal (the ResidentConsole lesson —
 *   one inside an HTML comment silently killed the whole modal).
 */

import { SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';

const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));

/** Default two-rung verdict. Callers with an outcome LADDER (the upload's forge
 *  bands) pass their own choices; each carries the synthesized roll `total` the
 *  flow's downstream math reads (forgeOutcome etc.), so Tier C needs zero
 *  caller changes. */
export const DEFAULT_NET_CHOICES = Object.freeze([
  { id: 'pass', label: 'PASS', tone: 'ok', ok: true, total: null },
  { id: 'fail', label: 'FAIL', tone: 'fail', ok: false, total: null },
]);

/** Player-side pending adjudications: requestId → { resolve, choices, onRemoteState }. */
const _pending = new Map();
/** GM-side open prompts: requestId → close(). */
const _openPrompts = new Map();

/**
 * Ask for a Tier C verdict. GM caller → local prompt; player → socket round-trip.
 * @param {object} o
 * @param {Actor}  [o.actor]     the operator
 * @param {string} [o.verb]      NET-action shape ('Backdoor' / 'Control' / …)
 * @param {string} [o.action]    module action key ('crack', 'upload', …)
 * @param {string} [o.title]     what the player is attempting ("Crack Credentials")
 * @param {string} [o.skill] @param {number} [o.dv]   reference for the GM
 * @param {string} [o.hostName]  the target ("DOCK-TERM-4")
 * @param {Array}  [o.choices]   verdict rungs (DEFAULT_NET_CHOICES shape)
 * @param {(minimized:boolean)=>void} [o.onRemoteState]  called when the GM
 *   docks/restores their adjudicator, so the player's console can dock in sync
 *   (the "GM stepped into the run" indicator). Player path only.
 * @returns {{ promise: Promise<{choiceId:string,label:string,tone:string,ok:boolean,total:number|null}|{cancelled:true}>, withdraw: () => void }}
 */
export function requestNetAdjudication(o = {}) {
  const choices = (Array.isArray(o.choices) && o.choices.length ? o.choices : DEFAULT_NET_CHOICES)
    .map(c => ({ ...c }));
  const payload = {
    requestId: `nr-${foundry.utils.randomID(8)}`,
    userId: game.user.id,
    actorName: o.actor?.name || game.user?.name || 'An operator',
    verb: o.verb || null,
    action: o.action || null,
    title: o.title || 'a hack',
    skill: o.skill || 'Interface',
    dv: Number(o.dv) || null,
    hostName: o.hostName || '',
    choices: choices.map(({ id, label, tone }) => ({ id, label, tone })),
  };

  const finishWith = (choiceId) => {
    if (choiceId == null) return { cancelled: true };
    const c = choices.find(x => x.id === choiceId) || null;
    if (!c) return { cancelled: true };
    return { choiceId: c.id, label: c.label, tone: c.tone || (c.ok ? 'ok' : 'fail'), ok: !!c.ok, total: c.total ?? null };
  };

  // GM adjudicating their own action — no wire.
  if (isGM()) {
    const promise = runNetAdjudicator(payload).then(finishWith);
    return { promise, withdraw: () => _openPrompts.get(payload.requestId)?.() };
  }

  if (!game.users?.activeGM) {
    ui.notifications.warn('NCM | No GM connected — this table resolves netrunning at the table, so a GM must be online to call it.');
    return { promise: Promise.resolve({ cancelled: true }), withdraw: () => {} };
  }

  let resolveFn;
  const promise = new Promise((resolve) => { resolveFn = resolve; });
  _pending.set(payload.requestId, {
    resolve: (choiceId) => resolveFn(finishWith(choiceId)),
    onRemoteState: typeof o.onRemoteState === 'function' ? o.onRemoteState : null,
  });
  game.nightcity?.socketManager?.emit(SOCKET_OPS.NET_RESOLVE_REQUEST, payload);
  log.debug(`NetResolve: adjudication requested (${payload.requestId}) — ${payload.title} vs DV ${payload.dv}`);

  return {
    promise,
    withdraw: () => {
      if (!_pending.has(payload.requestId)) return;
      _pending.delete(payload.requestId);
      game.nightcity?.socketManager?.emit(SOCKET_OPS.NET_RESOLVE_CANCEL, { requestId: payload.requestId });
      resolveFn({ cancelled: true });
    },
  };
}

/** GM-side socket body for NET_RESOLVE_REQUEST. */
export async function handleNetResolveRequest(data) {
  if (!isGM() || !data?.requestId) return;
  // Multi-GM: only the canonical active GM prompts (the standing one-GM-acts
  // pattern) — otherwise every GM gets a prompt and the losers' verdicts are
  // silently ignored, leaving orphaned modals on their screens.
  if (game.users?.activeGM && game.users.activeGM.id !== game.user.id) return;
  try { game.nightcity?.soundService?.play?.('receive'); } catch { /* no sound */ }
  const choiceId = await runNetAdjudicator(data);
  // The prompt may have been closed by a player withdraw — in that case the
  // pending entry is already gone client-side and this result is ignored there.
  game.nightcity?.socketManager?.emit(SOCKET_OPS.NET_RESOLVE_RESULT, {
    requestId: data.requestId, userId: data.userId, choiceId: choiceId ?? null,
  });
}

/** Player-side socket body for NET_RESOLVE_RESULT. */
export function handleNetResolveResult(data) {
  if (!data?.requestId || data.userId !== game.user.id) return;
  const p = _pending.get(data.requestId);
  if (!p) return;                       // withdrawn while the GM was deciding
  _pending.delete(data.requestId);
  p.resolve(data.choiceId ?? null);
}

/** GM-side socket body for NET_RESOLVE_CANCEL — the player stood down. */
export function handleNetResolveCancel(data) {
  const close = data?.requestId ? _openPrompts.get(data.requestId) : null;
  if (close) { close(); ui.notifications.info('NCM | The operator withdrew the action.'); }
}

/** Player-side socket body for NET_RESOLVE_STATE — the GM docked/restored their
 *  prompt; mirror it onto the waiting console. */
export function handleNetResolveState(data) {
  if (!data?.requestId || data.userId !== game.user.id) return;
  const p = _pending.get(data.requestId);
  p?.onRemoteState?.(!!data.minimized);
}

/** Shared corner dock for minimized net-resolution prompts — the GM's docked
 *  adjudicator AND the player console's docked AWAITING stage both chip into it
 *  (created on demand, removed when the last chip leaves). Exported for
 *  SecurityConsole. */
export function netadjDock() {
  let dock = document.getElementById('ncm-netadj-dock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'ncm-netadj-dock';
    document.body.appendChild(dock);
  }
  return dock;
}

/**
 * The GM's verdict prompt (FUI family — framework-free promise modal).
 *
 * NOT actually modal in spirit: the whole point of Tier C is that the table
 * runs the NET on the tabletop FIRST — which means the GM must be able to
 * switch scenes, move tokens, roll the run, and only then call it. So the
 * prompt carries a **RUN THE NET (minimize)** control that docks it to a
 * bottom-right chip, freeing the entire Foundry UI; clicking the chip brings
 * the verdict back. The promise stays pending the whole time (the player's
 * console keeps waiting, and their withdraw still closes chip and prompt both).
 *
 * @param {object} p the serializable request payload (see requestNetAdjudication)
 * @param {HTMLElement} [host] element to append into (theme source); default body
 * @returns {Promise<string|null>} the chosen choice id, or null on dismiss
 */
export function runNetAdjudicator(p = {}, host = null) {
  return new Promise((resolve) => {
    const mount = host || document.body;
    const choices = Array.isArray(p.choices) && p.choices.length ? p.choices : DEFAULT_NET_CHOICES;
    const verbLine = p.verb
      ? `<div class="ncm-netadj__verb"><i class="fas fa-diagram-project"></i> NET shape: <b>${esc(p.verb)}</b></div>`
      : '';
    const dvLine = p.dv
      ? `<div class="ncm-netadj__ref">${esc(p.skill || 'Interface')} vs DV <b>${p.dv}</b> — reference only; your run decides.</div>`
      : '';
    const btns = choices.map(c =>
      `<button type="button" class="ncm-netadj__btn ncm-netadj__btn--${esc(c.tone || 'ok')}" data-na="${esc(c.id)}">${esc(c.label)}</button>`
    ).join('');

    const el = document.createElement('div');
    el.className = 'ncm-netadj-backdrop';
    el.innerHTML = `
      <div class="ncm-netadj" data-ct-color="purple" role="dialog" aria-modal="true">
        <span class="ncm-netadj__br ncm-netadj__br--tl"></span><span class="ncm-netadj__br ncm-netadj__br--tr"></span>
        <span class="ncm-netadj__br ncm-netadj__br--bl"></span><span class="ncm-netadj__br ncm-netadj__br--br"></span>
        <div class="ncm-netadj__top"><i class="fas fa-scale-balanced"></i><span>NET ACTION // ADJUDICATE</span>
          <span class="ncm-netadj__topspacer"></span>
          <button type="button" class="ncm-netadj__minbtn" data-na-min data-tooltip="Dock this prompt and run the NET on the tabletop — click the chip to come back and call it"><i class="fas fa-window-minimize"></i> RUN THE NET</button>
        </div>
        <div class="ncm-netadj__lead"><b>${esc(p.actorName || 'An operator')}</b> is attempting <b>${esc(p.title || 'a hack')}</b>${p.hostName ? ` on <b>${esc(p.hostName)}</b>` : ''}.</div>
        ${verbLine}
        ${dvLine}
        <div class="ncm-netadj__note">This table resolves netrunning at the table — <b>RUN THE NET</b> docks this prompt so you can switch scenes and run it however your game does, then click the chip to call it. DISMISS withdraws the action: nothing happens, no trace, the operator can retry.</div>
        <div class="ncm-netadj__actions">
          <button type="button" class="ncm-netadj__btn ncm-netadj__btn--ghost" data-na="__dismiss">DISMISS</button>
          <span class="ncm-netadj__spacer"></span>
          ${btns}
        </div>
      </div>`;
    mount.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-open'));

    let settled = false;
    let minimized = false;
    let chip = null;

    const removeChip = () => {
      chip?.remove(); chip = null;
      const dock = document.getElementById('ncm-netadj-dock');
      if (dock && !dock.childElementCount) dock.remove();
    };

    // Mirror the GM's dock state onto the waiting player's console (only for a
    // relayed request — a GM adjudicating their OWN action has no remote player).
    const notifyPlayer = (min) => {
      if (!p.requestId || !p.userId || p.userId === game.user.id) return;
      game.nightcity?.socketManager?.emit(SOCKET_OPS.NET_RESOLVE_STATE, {
        requestId: p.requestId, userId: p.userId, minimized: min,
      });
    };

    const restore = () => {
      if (settled || !minimized) return;
      minimized = false;
      removeChip();
      el.classList.remove('is-min');
      notifyPlayer(false);
    };

    const minimize = () => {
      if (settled || minimized) return;
      minimized = true;
      el.classList.add('is-min');
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ncm-netadj-chip';
      chip.innerHTML = `<i class="fas fa-scale-balanced"></i>`
        + `<span class="t">NET ACTION PENDING<b>${esc(p.actorName || 'An operator')} · ${esc(p.title || 'a hack')}</b></span>`
        + `<span class="h">call it</span>`;
      chip.addEventListener('click', restore);
      netadjDock().appendChild(chip);
      notifyPlayer(true);
    };

    const finish = (choiceId) => {
      if (settled) return; settled = true;
      if (p.requestId) _openPrompts.delete(p.requestId);
      removeChip();
      el.classList.remove('is-open'); el.classList.add('is-closing');
      setTimeout(() => el.remove(), 200);
      document.removeEventListener('keydown', onKey, true);
      resolve(choiceId);
    };
    if (p.requestId) _openPrompts.set(p.requestId, () => finish(null));

    // ESC while docked must NOT silently withdraw a run in progress — the chip
    // is the only way back in that state.
    const onKey = (e) => { if (e.key === 'Escape' && !minimized) { e.preventDefault(); finish(null); } };
    document.addEventListener('keydown', onKey, true);

    el.addEventListener('click', (e) => {
      if (settled) return;
      if (e.target.closest?.('[data-na-min]')) return minimize();
      if (e.target === el) return;                    // deliberate: no backdrop-dismiss — a mis-click must not withdraw a live table call
      const id = e.target.closest?.('[data-na]')?.dataset.na;
      if (!id) return;
      finish(id === '__dismiss' ? null : id);
    });
  });
}

/**
 * Tier B ('flagged') — after the auto-roll, whisper the GM a card naming the
 * NET-action shape so the table can fold the result into their run (or veto it
 * by hand). Client-created whisper (players can whisper GMs — the anon-trace
 * precedent). Fire-and-forget.
 * @param {object} o { verb, action, title, actorName, hostName, skill, dv, total, ok }
 */
export function postNetActionCard(o = {}) {
  try {
    const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
    if (!gmIds.length) return;
    const tone = o.ok ? 'ok' : 'fail';
    const outcome = o.ok ? 'PASS' : 'FAIL';
    const roll = o.total != null ? `${esc(o.skill || 'Interface')} <b>${o.total}</b> vs DV <b>${o.dv ?? '?'}</b>` : `vs DV <b>${o.dv ?? '?'}</b>`;
    const content =
      `<div class="ncm-netcard ncm-netcard--${tone}">`
      + `<div class="ncm-netcard__hd"><i class="fas fa-diagram-project"></i> NET ACTION${o.verb ? ` // ${esc(o.verb)}` : ''}</div>`
      + `<div class="ncm-netcard__what"><b>${esc(o.actorName || 'An operator')}</b> — ${esc(o.title || 'a hack')}${o.hostName ? ` on <b>${esc(o.hostName)}</b>` : ''}</div>`
      + `<div class="ncm-netcard__roll">${roll} — <b class="ncm-netcard__oc">${outcome}</b></div>`
      + `<div class="ncm-netcard__note">Flagged so you can fold it into the run (hackResolution: flagged).</div>`
      + `</div>`;
    ChatMessage.create({ content, whisper: gmIds });
  } catch (err) { log.warn(`NET-action card failed: ${err.message}`); }
}
