/**
 * UploadFlow — the player→machine direction (design doc §4). The inverse of
 * exfil: carry a program (from a shard or the Agent) and, while logged into a
 * terminal, PUSH it onto the box. v1 = PLANT — install a forged content entry as
 * a resident the next login finds (thread #2 lifecycle) via a FORGE roll vs the
 * box's security.
 *
 * Split mirrors the rest of the content actions: the ROLL runs client-side
 * (SecurityConsole → SkillService.performCheck), the INSTALL is GM-owned
 * (residents live in the GM-owned terminalState), so a GM installs directly and a
 * player relays via SOCKET_OPS.TERMINAL_RESIDENT_REQUEST (the exfil/session relay
 * pattern). Roll margin → forgeQuality → stealthDV: a clean forgery is hard for
 * ANALYZE to catch; a botched one leaves tells.
 *
 * @file scripts/ui/content/UploadFlow.js
 * @module cyberpunkred-messenger
 */

import { MODULE_ID, SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { runSecurityConsole } from './SecurityConsole.js';
import { canPersistContent, _applyNativeEffect } from './SiphonFlow.js';

const DEFAULT_UPLOAD_SKILL = 'Interface';
const DEFAULT_UPLOAD_DV = 15;

/**
 * How far BELOW the DV a forge can land and still install (sloppily).
 * The FORGE check is a LADDER, not a coin flip:
 *   margin >= 0        → CLEAN     — a good forgery; high quality, high stealthDV
 *   margin -1..-BAND   → SLOPPY    — it lands, but it's junk; ANALYZE will flag it
 *   margin < -BAND     → REJECTED  — the box refuses the file; nothing installs
 * The old model installed on ANY committed roll, so a botch was indistinguishable
 * from a near miss and there was no floor — you could fail by 12 and still plant.
 * Tune here; the console/toast copy derives from this number.
 */
export const FORGE_SLOPPY_BAND = 4;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Roll margin → forge quality (0–100). Hitting the DV exactly = 50 (mediocre). */
export function forgeQualityFromMargin(total, dv) {
  const margin = (Number(total) || 0) - (Number(dv) || 0);
  return clamp(Math.round(50 + margin * 8), 5, 100);
}

/**
 * Which rung of the ladder a roll landed on.
 * @param {number} total roll total @param {number} dv the forge DV
 * @returns {'clean'|'sloppy'|'rejected'}
 */
export function forgeOutcome(total, dv) {
  const margin = (Number(total) || 0) - (Number(dv) || 0);
  if (margin >= 0) return 'clean';
  if (margin >= -FORGE_SLOPPY_BAND) return 'sloppy';
  return 'rejected';
}

/**
 * The slot a plant occupies: one program aimed at one mailbox on one box.
 * Re-uploading the same program to the same target REPLACES that plant instead of
 * stacking a second copy — otherwise a player who rolls badly and retries leaves a
 * pile of armed duplicates, and the GM's next login prompt fires every one of them
 * (the "it uploads all the failed tries as well" bug). Fiction: you pushed the file
 * again, it overwrote. Only ARMED plants are replaceable — a FIRED one already
 * landed, so a re-upload is genuinely a new file.
 */
export function residentSlotKey({ effectType = 'plant', accountId = null, name = '' } = {}) {
  return `${effectType}::${accountId || 'any'}::${String(name).toLowerCase().trim()}`;
}

/** Higher forge quality = a cleaner forgery = a higher DV for ANALYZE to catch it. */
export function stealthDVFromQuality(forgeQuality, override) {
  if (Number(override)) return Number(override);
  return clamp(Math.round(6 + (Number(forgeQuality) || 0) / 8), 8, 20);
}

function _nowIso() {
  try { return new Date(game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now()).toISOString(); }
  catch { return new Date().toISOString(); }
}

/**
 * Run an UPLOAD. Rolls the FORGE check and resolves it on the three-band ladder
 * (see FORGE_SLOPPY_BAND): a clean or sloppy forge installs the resident (GM
 * direct / player relay, replacing any armed plant in the same slot); a rejected
 * one installs NOTHING. A miss of either kind can still fire the trace.
 * @param {object} a
 * @param {Actor}  a.actor      the operator running the upload
 * @param {object} a.program    { name, effectType:'plant', params:{ entry }, trigger?, uploadSkill?, uploadDV?, stealthDV?, traceOnFail?, sourceLabel? }
 * @param {Item}   a.targetItem the terminal being uploaded to
 * @param {string} [a.accountId] target mailbox (defaults to the program's / trigger's account)
 * @param {HTMLElement} [a.host] viewer element (SecurityConsole inherits its theme)
 * @returns {Promise<{success:boolean, outcome:'clean'|'sloppy'|'rejected', forgeQuality:number}|null>}
 *   null = cancelled / blocked. success=false only for 'rejected' (nothing installed).
 */
export async function runUpload({ actor, program, targetItem, accountId = null, host = null }) {
  const p = program || {};
  const term = game.nightcity?.terminalService;
  if (!term?.isTerminal?.(targetItem)) { ui.notifications.warn('NCM | You can only upload to a terminal you are logged into.'); return null; }
  if (!canPersistContent()) return null;                    // the install relays — needs a GM online
  if (!actor) { ui.notifications.warn('NCM | No operator assigned to run the upload.'); return null; }

  const skill = p.uploadSkill || DEFAULT_UPLOAD_SKILL;
  const dv = Number(p.uploadDV) || DEFAULT_UPLOAD_DV;
  const name = p.name || 'payload';
  // EXECUTE = a malware/payload verb (installs a keylog/backdoor/Black-ICE resident);
  // PLANT = drop the file itself. Same three-band ladder + install engine — only the
  // copy differs (a botched INSTALL is glitchy, a botched FORGE is sloppy).
  const isExecute = (p.family === 'execute') || (!!p.effectType && p.effectType !== 'plant');

  const tgtAcct = accountId || p.params?.accountId || p.trigger?.accountId || null;

  const res = await runSecurityConsole({
    title: 'Upload', icon: 'fas fa-upload', accent: 'purple', host,
    // Spell the ladder out. The player should know BEFORE committing that a near
    // miss still lands something a SWEEP can catch and a bad miss lands nothing —
    // that's the whole risk of pushing a program you rolled badly on.
    intro: isExecute
      ? `Push ${name} onto ${targetItem.name}?\n`
        + `Beat DV ${dv} for a clean install. `
        + `Miss by up to ${FORGE_SLOPPY_BAND} and it still runs — but it's glitchy, and a SWEEP will flag it. `
        + `Miss by more and the box rejects it.`
      : `Push ${name} onto ${targetItem.name}?\n`
        + `Beat DV ${dv} and the forgery is clean. `
        + `Miss by up to ${FORGE_SLOPPY_BAND} and it still lands — but it's sloppy, and a scan will flag it as FORGED. `
        + `Miss by more and the box refuses the file.`,
    gate: {
      require: true, skill, dv, actor, context: `Upload: ${name}`, flavor: `${isExecute ? 'RUN' : 'FORGE'} // DV ${dv}`,
      // Netrunning tiers (design §5): 'gm' hands the GM the LADDER, not pass/fail —
      // each rung carries a synthesized total inside its band so the downstream
      // forgeOutcome/forgeQuality math reads the verdict unchanged.
      net: {
        verb: isExecute ? 'Virus' : 'Control', action: 'upload', hostItem: targetItem, hostName: targetItem.name,
        choices: isExecute ? [
          { id: 'clean', label: 'CLEAN INSTALL', tone: 'ok', ok: true, total: dv + 4 },
          { id: 'sloppy', label: 'GLITCHY — IT RUNS', tone: 'warn', ok: true, total: dv - 2 },
          { id: 'reject', label: 'REJECTED', tone: 'fail', ok: false, total: dv - FORGE_SLOPPY_BAND - 2 },
        ] : [
          { id: 'clean', label: 'CLEAN FORGE', tone: 'ok', ok: true, total: dv + 4 },
          { id: 'sloppy', label: 'SLOPPY — IT LANDS', tone: 'warn', ok: true, total: dv - 2 },
          { id: 'reject', label: 'REJECTED', tone: 'fail', ok: false, total: dv - FORGE_SLOPPY_BAND - 2 },
        ],
      },
    },
    verdictFor: ({ total, dv: gateDv }) => {
      const o = forgeOutcome(total ?? gateDv, gateDv);
      if (o === 'clean') return { label: isExecute ? 'INSTALL CLEAN' : 'FORGE CLEAN', tone: 'ok' };
      if (o === 'sloppy') return { label: isExecute ? 'GLITCHY — IT RUNS' : 'SLOPPY — IT LANDS', tone: 'warn' };
      return { label: isExecute ? 'REJECTED — REFUSED' : 'REJECTED — FILE REFUSED', tone: 'fail' };
    },
  });
  if (res.cancelled) return null;

  const outcome = forgeOutcome(res.total ?? dv, dv);
  const forgeQuality = forgeQualityFromMargin(res.total ?? dv, dv);
  const margin = (res.total ?? dv) - dv;

  // A missed push can trip an alarm whether or not it landed — the trace funnel
  // owns the drama + log + heat.
  if (outcome !== 'clean' && p.traceOnFail) {
    game.nightcity?.traceService?.fireTrace({ actor, action: 'upload', source: name, hostItem: targetItem, dv, margin, severity: 'hostile' });
  }

  // REJECTED — nothing installs, so there's nothing for the GM to fire later.
  // (The console already played the fail sound.)
  if (outcome === 'rejected') {
    ui.notifications.warn(`NCM | ${targetItem.name} refused ${name} — the ${isExecute ? 'push' : 'forge'} was too far off (missed DV ${dv} by ${Math.abs(margin)}).`);
    return { success: false, outcome, forgeQuality };
  }

  // RUN — an instant utility that operates on the box itself (scanner reveals hidden
  // accounts, skeleton-key clears locks, jammer drops the uplink). It runs NOW against
  // this terminal and leaves nothing behind (no resident to sweep).
  if (p.family === 'run') {
    let report = '';
    try { report = await _applyNativeEffect(p.effectType, { hostItem: targetItem, page: null, actor, cd: {} }); }
    catch (e) { log.warn('Upload run-effect failed', e); }
    const result = report || `${name} ran, but found nothing.`;
    try {
      await ChatMessage.create({
        whisper: [game.user.id],
        speaker: { alias: name },
        content: `<div style="border-left:3px solid #19f3f7;padding:6px 10px;font-size:13px;line-height:1.5;background:rgba(25,243,247,.06);"><b>${name}</b> ran on <b>${targetItem.name}</b><br>${result}</div>`,
      });
    } catch (e) { /* whisper is a bonus */ }
    if (outcome === 'clean') game.nightcity?.traceService?.logSuccess({ actor, action: 'analyze', source: name, hostItem: targetItem, severity: 'minor' });
    ui.notifications.info(`NCM | ${name} — ${result}`);
    return { success: true, outcome, ran: true, report: result };
  }

  const resident = {
    effectType: p.effectType || 'plant',
    params: { ...(p.params || {}), accountId: tgtAcct, name },
    trigger: p.trigger || { kind: 'onLogin', ...(tgtAcct ? { accountId: tgtAcct } : {}) },
    provenance: { plantedBy: actor.id, plantedAt: _nowIso(), forgeQuality, sourceLabel: p.sourceLabel || 'uploaded program' },
    stealthDV: stealthDVFromQuality(forgeQuality, p.stealthDV),
    // Re-uploading the same program at the same mailbox overwrites that plant
    // rather than stacking another armed copy (see residentSlotKey).
    slotKey: residentSlotKey({ effectType: p.effectType || 'plant', accountId: tgtAcct, name }),
  };

  // Install — GM direct; a player relays (terminalState is GM-owned).
  if (isGM()) {
    await term.installResident(targetItem, resident);
  } else {
    game.nightcity?.socketManager?.emit(SOCKET_OPS.TERMINAL_RESIDENT_REQUEST, {
      itemUuid: targetItem.uuid, resident, userId: game.user.id,
    });
  }

  // NOTE: no sound here — the SecurityConsole owns the climax sound (the standing
  // rule; this used to double-play hack-success/hack-fail on top of the console).
  if (outcome === 'clean') game.nightcity?.traceService?.logSuccess({ actor, action: 'upload', source: name, hostItem: targetItem, severity: 'hostile' });
  const sloppyTail = isExecute ? ' — but it\'s glitchy; a sweep will flag it.' : ' — but the forge is sloppy; a scan will flag it.';
  ui.notifications.info(`NCM | ${name} ${isExecute ? 'installed on' : 'uploaded to'} ${targetItem.name}${outcome === 'clean' ? '.' : sloppyTail}`);
  return { success: true, outcome, forgeQuality };
}

/**
 * GM-side handler for TERMINAL_RESIDENT_REQUEST. Two ops:
 *  · install (default) — a player's upload relay (arms a resident).
 *  · defuse — a player's SYSTEM SWEEP defused a resident (state:'defused').
 * Both write the GM-owned terminalState.
 */
export async function handleResidentRequest(data) {
  if (!isGM()) return;
  try {
    const item = data?.itemUuid ? fromUuidSync(data.itemUuid) : null;
    const term = game.nightcity?.terminalService;
    if (!item || !term) throw new Error('Terminal/service not found');
    if (!item.getFlag(MODULE_ID, 'isTerminal')) throw new Error('Not a terminal');
    if (data.op === 'defuse') {
      if (!data.residentId) throw new Error('No resident id to defuse');
      await term.updateResident(item, data.residentId, { state: 'defused' });
      return;
    }
    await term.installResident(item, data.resident || {});
  } catch (err) { log.error(`Resident relay failed: ${err.message}`); }
}
