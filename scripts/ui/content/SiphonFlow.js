/**
 * SiphonFlow — typed-content action flows (design doc §8c).
 * @file scripts/ui/content/SiphonFlow.js
 * @module night-city-messenger
 * @description Shared by the shard viewer (ItemInboxApp) and the terminal viewer
 *   (TerminalViewerApp) — the mechanics that mutate a typed entry's contentData:
 *     · runSiphon      — banking SIPHON FUNDS (amount → security roll → drain/trace)
 *     · runEddiesClaim — eddies CLAIM (confirm → wealth credit → mark claimed)
 *     · runCrack       — credentials CRACK TO REVEAL (skill roll vs crackDV → unlock)
 *   All persistence funnels through `persistContentData`: the entries live in
 *   GM-owned journals, so a GM writes directly and players relay
 *   (`SOCKET_OPS.CONTENT_UPDATE_REQUEST`; the siphon keeps its legacy
 *   `BANK_SIPHON_REQUEST` op for its outcome-toast payload). Wealth credits are
 *   applied locally — the player owns their actor.
 */

import { ncmNotify } from '../../utils/notify.js';
import { MODULE_ID, SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM, isPrimaryGM, formatCyberDate, netVerbFor, runGmMacro, stripMacroRefs, userOwnsActor } from '../../utils/helpers.js';
import { applyContentIntent, sanitizeIntent, computeMaxSiphon, UNLOCK_KINDS, payloadCanRun, chargesAfterRun } from '../../utils/contentIntents.js';
import { runSecurityConsole } from './SecurityConsole.js';
import { rolledNote } from './NetResolve.js';
import { runBankHeist } from './BankHeist.js';
import { grantPtzControl } from './ContentRenderers.js';
import { showNamePicker } from '../../utils/namePicker.js';

const DEFAULT_SIPHON_SKILL = 'Interface';
const DEFAULT_SIPHON_DV = 15;
const DEFAULT_CRACK_SKILL = 'Interface';
const DEFAULT_CRACK_DV = 15;

/** Max siphonable amount for the account's configured mode (lives in contentIntents.js; the GM uses it too). */
export { computeMaxSiphon };

/**
 * Run the full siphon flow against a banking entry's RAW contentData.
 * @param {object} args
 * @param {Actor}  args.actor      the player's character (the thief)
 * @param {object} args.raw        the banking entry's raw contentData
 * @param {string} args.itemUuid   the shard/terminal item uuid (for the relay)
 * @param {string} args.messageId  the entry/message id (the journal page)
 * @param {HTMLElement} [args.host] viewer element (theme source for the console)
 */
export async function runSiphon({ actor, raw, itemUuid, messageId, host = null }) {
  // Credits wealth before the GM writes the drained account (audit DATA-01): with no GM to write
  // it, the account would stay full and pay out again and again. Refuse up front.
  if (!canPersistContent()) return;
  const banking = raw || {};
  if (banking.siphoned) { ncmNotify.warn('NCM | This account is already drained.'); return; }

  const currency = banking.currency || '€$';
  const accountLabel = banking.accountName || banking.bankName || 'account';
  const max = computeMaxSiphon(banking);
  if (max <= 0) { ncmNotify.warn('NCM | Nothing to siphon from this account.'); return; }

  // A frozen account can't be siphoned (status story-hook).
  if (String(banking.status || '').toLowerCase() === 'frozen') { ncmNotify.warn('NCM | This account is FROZEN — no transfers possible.'); return; }

  const skill = banking.siphonSkill || DEFAULT_SIPHON_SKILL;
  const dv = Number(banking.siphonDV) || DEFAULT_SIPHON_DV;
  const force = isGM() && !actor;
  if (!force && !game.nightcity?.skillService) { ncmNotify.error('NCM | Skill service unavailable.'); return; }

  // Failure lockout (SecurityService, game-time deadline, per operator+account).
  const sec = game.nightcity?.securityService;
  const lockTarget = `siphon::${messageId}`;
  const lockEnabled = !!banking.siphonLockout && !!actor && !!sec;
  if (lockEnabled) {
    if (sec.isLockedOut(actor.id, lockTarget)) {
      const secsLeft = Math.ceil((sec.getLockoutRemaining(actor.id, lockTarget) || 0) / 1000);
      ncmNotify.warn(`NCM | Siphon LOCKED OUT — the account's security is watching. Try again in ${secsLeft}s.`);
      return;
    }
    sec.initTracking(actor.id, lockTarget, {
      maxAttempts: Math.max(1, Number(banking.siphonMaxAttempts) || 3),
      lockoutDuration: (Number(banking.siphonLockoutMin) || 30) * 60000,
    });
  }

  // The bespoke siphon FUI: pick the amount, JACK IN rolls the security check
  // (DV scales with the amount if configured), plays the drain animation, then
  // resolves like the old console did.
  const res = await runBankHeist({
    host, bankName: banking.bankName || '', accountLabel, currency,
    max, fromBalance: Number(banking.balance) || 0, skill, dv, actor, force,
    dvScale: !!banking.siphonDVScale, dvPer: Number(banking.siphonDVPer) || 50000,
    // The host item (when known) carries the per-box hackResolution override.
    hostItem: (() => { try { return itemUuid ? fromUuidSync(itemUuid) : null; } catch { return null; } })(),
  });
  if (res.cancelled) return;
  const amount = res.amount || 0;
  if (amount <= 0) return;
  const usedDV = res.dv ?? dv;

  const who = actor?.name || 'GM';
  if (res.ok) {
    if (actor) await _creditWealth(actor, amount, `NCM: Siphoned ${amount.toLocaleString()} eb from ${accountLabel}`);
    const drained = applyContentIntent('banking', banking, { action: 'siphon', amount }, contentCtx(actor));
    await _persistSiphon({ outcome: 'success', messageId, amount, actorId: actor?.id || null, newContentData: drained.ok ? drained.next : null, currency, actorName: who, accountLabel });
    game.nightcity?.traceService?.logSuccess({ actor, action: 'siphon', source: accountLabel, targetKind: 'message', targetMessageId: messageId, severity: 'hostile' });
    ncmNotify.info(`NCM | Siphoned ${amount.toLocaleString()} ${currency} from ${accountLabel}.`);
  } else {
    game.nightcity?.traceService?.fireTrace({ actor, action: 'siphon', source: accountLabel, host, severity: 'hostile' });
    // Lockout → then FREEZE once the attempts are burned (persisted on the
    // account so it's frozen for everyone; GM writes / player relays).
    let frozen = false;
    if (lockEnabled) {
      const { lockedOut } = sec.recordFailedAttempt(actor.id, lockTarget) || {};
      if (lockedOut) {
        frozen = true;
        await persistIntent(messageId, 'banking', banking, { action: 'freeze' }, actor,
          `NCM | ${accountLabel} FROZEN — security locked it after repeated siphon attempts.`);
      }
    }
    await _persistSiphon({ outcome: 'fail', messageId, amount, actorId: actor?.id || null, currency, actorName: who, accountLabel });
    ncmNotify.warn(`NCM | Siphon failed — trace fired${rolledNote(res, usedDV)}.${frozen ? ' The account is now FROZEN.' : ''}`);
  }
}

/** Credit the actor's CPR wealth (the eddies-claim ledger pattern). */
async function _creditWealth(actor, amount, reason) {
  try {
    const wealth = foundry.utils.deepClone(actor.system.wealth);
    wealth.value += amount;
    wealth.transactions = wealth.transactions || [];
    wealth.transactions.push([`Increased by ${amount} to ${wealth.value}`, reason]);
    if (actor.isOwner || isGM()) await actor.update({ 'system.wealth': wealth });
  } catch (err) {
    log.error(`Wealth credit failed: ${err.message}`);
  }
}

/**
 * Persist the outcome — GM applies directly, players relay. The relay carries
 * only what the player did (outcome, amount, who); the GM re-reads the account
 * and drains it within the account's own limit (audit SEC-04).
 */
async function _persistSiphon(payload) {
  if (isGM()) {
    if (payload.outcome === 'success' && payload.newContentData) await applySiphonToJournal(payload.messageId, payload.newContentData);
    _alertGM(payload);
  } else {
    game.nightcity?.socketManager?.emit(SOCKET_OPS.BANK_SIPHON_REQUEST, {
      outcome: payload.outcome === 'success' ? 'success' : 'fail',
      messageId: payload.messageId, amount: payload.amount, actorId: payload.actorId, userId: game.user.id,
    });
  }
}

/** GM-side toast for the consequence feed. */
function _alertGM(p) {
  if (p.outcome === 'success') {
    ncmNotify.warn(`NCM | SIPHON: ${p.actorName} drained ${Number(p.amount).toLocaleString()} ${p.currency} from ${p.accountLabel}.`);
  } else {
    ncmNotify.warn(`NCM | SIPHON TRACE: ${p.actorName} failed to breach ${p.accountLabel} — trace fired.`);
  }
}

/**
 * GM-only: write the drained contentData back onto the journal page that holds
 * the banking entry (works for both shard + terminal pages — found by messageId
 * across all journals). Writes the whole `contentData` object (a nested dot-path
 * flag write is unreliable). Exported for the socket handler.
 */
export async function applySiphonToJournal(messageId, newContentData) {
  if (!isGM() || !messageId || !newContentData) return false;
  const page = _findPayloadPage(messageId)?.page || null;
  if (!page) { log.warn(`Siphon: no journal page for messageId ${messageId}`); return false; }
  return _writeContentData(page, newContentData);
}

/**
 * Write a page's whole contentData. Content actions (claim, crack, siphon, run…)
 * never change which macro an entry links to — only the GM's authoring tools do,
 * and they write the page directly. So a write through here keeps the entry's
 * stored link and drops any other (SEC-02).
 */
async function _writeContentData(page, newContentData) {
  const stored = page.flags?.[MODULE_ID]?.contentData?.effect?.macroId || '';
  const next = stripMacroRefs(newContentData);
  if (stored) next.effect = { ...(next.effect || {}), macroId: stored };
  try {
    await page.update({ [`flags.${MODULE_ID}.contentData`]: next });
    return true;
  } catch (err) {
    log.error(`Content persist failed: ${err.message}`);
    return false;
  }
}

/**
 * GM side: may this sender act on this page, as this character? (audit SEC-04)
 * They must be able to SEE the entry (the page, through its journal's ownership —
 * a shard or terminal journal they read, or their own inbox), and a named
 * character must be theirs.
 * @returns {{ok:true, page, user, actor}|{ok:false, why:string}}
 */
export function checkContentSender(messageId, senderId, actorId = null) {
  const user = senderId ? game.users?.get(senderId) : null;
  if (!user) return { ok: false, why: 'unknown sender' };
  const found = messageId ? _findPayloadPage(messageId) : null;
  if (!found) return { ok: false, why: `no entry ${messageId}` };
  const OBSERVER = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2;
  if (!user.isGM && !found.page.testUserPermission?.(user, OBSERVER)) return { ok: false, why: `${user.name} cannot see that entry` };
  let actor = null;
  if (actorId) {
    if (!userOwnsActor(senderId, actorId)) return { ok: false, why: `${user.name} does not own that character` };
    actor = game.actors?.get(actorId) || null;
  }
  return { ok: true, page: found.page, user, actor };
}

/**
 * GM side: apply a relayed intent. Re-reads the stored entry, checks the sender,
 * computes the change from what is stored, writes it.
 * @returns {Promise<{ok:boolean, why?:string, toast?:string, amount?:number}>}
 */
export async function applyContentRequest(messageId, rawIntent, senderId, actorId = null) {
  if (!isGM()) return { ok: false, why: 'not a GM' };
  const who = checkContentSender(messageId, senderId, actorId);
  if (!who.ok) return who;
  const flags = who.page.flags?.[MODULE_ID] || {};
  const intent = sanitizeIntent(rawIntent);
  const r = applyContentIntent(flags.contentType, flags.contentData || {}, intent, contentCtx(who.actor, who.user));
  if (!r.ok) return r;
  const wrote = await _writeContentData(who.page, r.next);
  return wrote ? { ok: true, toast: r.toast, amount: r.amount } : { ok: false, why: 'the write failed' };
}

/** GM-side socket handler body for BANK_SIPHON_REQUEST. */
export async function handleSiphonRequest(data, senderId) {
  if (!isGM()) return;
  if (data?.outcome === 'success') {
    const r = await applyContentRequest(data.messageId, { action: 'siphon', amount: data.amount }, senderId, data.actorId);
    if (r.ok) ncmNotify.warn(`NCM | ${r.toast}`);
    else log.warn(`Siphon request refused: ${r.why}`);
    return;
  }
  // A failed attempt changes nothing; the GM is told who tried, by names read here.
  const who = checkContentSender(data?.messageId, senderId, data?.actorId);
  if (!who.ok) { log.warn(`Siphon report refused: ${who.why}`); return; }
  const cd = who.page.flags?.[MODULE_ID]?.contentData || {};
  _alertGM({ outcome: 'fail', actorName: who.actor?.name || who.user.name, accountLabel: cd.accountName || cd.bankName || 'account' });
}

// ═══════════════════════════════════════════════════════════
//  Generic contentData persistence (claims / cracks / future actions)
// ═══════════════════════════════════════════════════════════

/**
 * Persist a typed entry's new contentData — GM writes the journal page
 * directly, players relay via SOCKET_OPS.CONTENT_UPDATE_REQUEST. `gmToast`
 * (optional) surfaces the consequence on the GM's screen either way.
 */
/**
 * Can this client actually land a content write? A player's writes RELAY to the
 * GM (the entries live in GM-owned journals), so with no GM connected the write
 * silently evaporates. Flows that do something IRREVERSIBLE first — credit
 * wealth, reveal a secret, deploy — must check this BEFORE acting, or the
 * player gets the payoff while the state never persists (an eddies claim would
 * re-credit on every click).
 * @returns {boolean}
 */
export function canPersistContent({ warn = true } = {}) {
  if (isGM()) return true;
  if (game.users?.activeGM) return true;
  if (warn) ncmNotify.warn('NCM | No GM connected — the GM must be online for this to take effect.');
  return false;
}

/**
 * Persist a typed entry's new contentData.
 *   - GM: writes `newContentData` directly (the GM's own tools, force paths and
 *     player-less actions go through here).
 *   - Player: relays only the INTENT (`{action, index?, kind?, amount?, tripped?}`)
 *     and the acting character; the GM recomputes the change from the stored entry
 *     (audit SEC-04). A player call without an intent is refused.
 * @param {string} messageId
 * @param {object} newContentData what the GM writes
 * @param {string} [gmToast] shown on the GM's own screen (GM path only)
 * @param {object} [intent] what a player's client asks for
 * @param {string|null} [actorId] the acting character (a player's must be theirs)
 */
export async function persistContentData(messageId, newContentData, gmToast = '', intent = null, actorId = null) {
  if (isGM()) {
    const ok = await applySiphonToJournal(messageId, newContentData);
    if (ok && gmToast) ncmNotify.info(gmToast);
    return ok;
  }
  if (!intent?.action) {
    log.warn(`persistContentData: a player write needs an intent (messageId ${messageId}) — refused.`);
    ncmNotify.warn('NCM | That change could not be saved.');
    return false;
  }
  // Player: the entry lives in a GM-owned journal → relay. This silently
  // no-ops with no GM connected (the write has nowhere to land), which reads
  // to the player as "the button did nothing" — say so instead.
  if (!game.users?.activeGM) {
    ncmNotify.warn('NCM | No GM connected — the change could not be saved.');
    log.warn(`persistContentData: no active GM to land the write (messageId ${messageId}).`);
    return false;
  }
  log.debug(`persistContentData: relaying "${intent.action}" to GM (messageId ${messageId}).`);
  game.nightcity?.socketManager?.emit(SOCKET_OPS.CONTENT_UPDATE_REQUEST, {
    messageId, intent: sanitizeIntent(intent), actorId: actorId || null, userId: game.user.id,
  });
  return true;
}

/** Values a content change needs from the writer: who, the game clock, the real clock, the camera clock. */
function contentCtx(actor, user = null) {
  return {
    actorId: actor?.id || null,
    actorName: actor?.name || user?.name || game.user?.name || 'GM',
    nowIso: _nowIso(),
    realIso: new Date().toISOString(),
    realMs: Date.now(),
    clock: _clockStamp(),
  };
}

/** The camera-feed clock string (a looped cam freezes on it). */
function _clockStamp() {
  try { return formatCyberDate(new Date(_nowMs()).toISOString(), { timeOnly: true, seconds: true }); } catch (_) { return ''; }
}

/**
 * Compute a content action with the shared rules and persist it: the GM writes the
 * result, a player relays the intent. One function decides what the action
 * changes, on both sides.
 * @returns {Promise<boolean>}
 */
async function persistIntent(messageId, contentType, cd, intent, actor, gmToast = '') {
  const r = applyContentIntent(contentType, cd || {}, intent, contentCtx(actor));
  if (!r.ok) {
    log.warn(`Content action "${intent.action}" not applied: ${r.why} (messageId ${messageId}).`);
    ncmNotify.warn(`NCM | Nothing changed — ${r.why}.`);
    return false;
  }
  return persistContentData(messageId, r.next, gmToast || `NCM | ${r.toast}`, intent, actor?.id || null);
}

/** GM-side socket handler body for CONTENT_UPDATE_REQUEST. The GM writes its own toast. */
export async function handleContentUpdateRequest(data, senderId) {
  if (!isGM()) return;
  const r = await applyContentRequest(data?.messageId, data?.intent, senderId, data?.actorId);
  if (r.ok) ncmNotify.info(`NCM | ${r.toast}`);
  else log.warn(`Content update refused: ${r.why}`);
}

// ═══════════════════════════════════════════════════════════
//  Eddies claim (shared shard + terminal)
// ═══════════════════════════════════════════════════════════

/**
 * Claim an eddies entry into a character's wealth ledger.
 * @param {object} args { actor, raw: eddies contentData, messageId, sourceLabel }
 * @returns {{success:true, amount:number}|null}
 */
export async function runEddiesClaim({ actor, raw, messageId, sourceLabel = 'data entry', host = null }) {
  const cd = raw || {};
  // Credits wealth BEFORE persisting the claim flag — with no GM to land that
  // write, the eddies could be claimed again and again. Refuse up front.
  if (!canPersistContent()) return null;
  if (cd.claimed) { ncmNotify.warn('NCM | These eddies were already claimed.'); return null; }
  const amount = Number(cd.amount) || 0;
  if (amount <= 0) { ncmNotify.warn('NCM | No eddies to claim.'); return null; }

  // Optional gate: a claim can require a roll if the entry authors one
  // (`claimSkill`/`claimDV`); default off = a styled confirm (immersion only).
  const gated = !!cd.claimRequire && !!actor;
  const res = await runSecurityConsole({
    title: 'Claim Eddies', icon: 'fas fa-sack-dollar', accent: 'gold', host,
    intro: `Transfer ${amount.toLocaleString()} eddies from ${sourceLabel} into your account? This can't be undone.`,
    confirmLabel: 'Claim',
    gate: gated ? { require: true, skill: cd.claimSkill || 'Interface', dv: Number(cd.claimDV) || 9, actor, context: `Claim: ${sourceLabel}`, flavor: `Eddies Claim // DV ${Number(cd.claimDV) || 9}`, net: { verb: 'Control', action: 'claim' } } : null,
    successLabel: 'FUNDS RELEASED', failLabel: 'CLAIM BLOCKED',
  });
  if (res.cancelled) return null;
  if (gated && !res.ok) { ncmNotify.warn(`NCM | Claim failed${rolledNote(res)}.`); return null; }

  await _creditWealth(actor, amount, `NCM: Claimed ${amount.toLocaleString()} eb from ${sourceLabel}`);
  // `claimedAt` is GAME time (the in-fiction "claimed at X"); `claimedRealMs` is
  // REAL time and drives the one-shot claim animation (contentIntents 'claim').
  await persistIntent(messageId, 'eddies', cd, { action: 'claim' }, actor,
    `NCM | ${actor.name} claimed ${amount.toLocaleString()} eb (${sourceLabel}).`);
  game.nightcity?.soundService?.play('eddies-claim');
  ncmNotify.info(`NCM | ${amount.toLocaleString()} eb deposited to ${actor.name}'s ledger.`);
  return { success: true, amount };
}

// ═══════════════════════════════════════════════════════════
//  Credential crack (shared shard + terminal)
// ═══════════════════════════════════════════════════════════

/**
 * Crack a locked credentials entry (entries[entryIndex]) to reveal its secret.
 * DV/skill come from the entry (`crackSkill`/`crackDV`), then the vault-level
 * contentData, then Interface / DV 15. `force` skips the roll (GM audit,
 * mirroring the anon-trace force-reveal precedent).
 * @returns {boolean} true when the entry ends up cracked
 */
export async function runCrack({ actor, raw, entryIndex, messageId, force = false, host = null }) {
  const entries = raw?.entries || [];
  const e = entries[entryIndex];
  if (!e || !e.encrypted || e.cracked) return false;
  const label = e.host || 'host';
  const skill = e.crackSkill || raw.crackSkill || DEFAULT_CRACK_SKILL;
  const dv = Number(e.crackDV ?? raw.crackDV) || DEFAULT_CRACK_DV;

  if (force) {
    // GM force-reveal (no character) — a styled confirm, no roll.
    const res = await runSecurityConsole({
      title: 'Force Decrypt', icon: 'fas fa-unlock-keyhole', accent: 'red', host,
      intro: `Reveal the ${label} credentials without a roll?`, confirmLabel: 'Reveal',
    });
    if (!res.ok) return false;
  } else {
    if (!actor) { ncmNotify.warn('NCM | No character assigned.'); return false; }
    if (!game.nightcity?.skillService) { ncmNotify.error('NCM | Skill service unavailable.'); return false; }
    const res = await runSecurityConsole({
      title: 'Crack Credentials', icon: 'fas fa-unlock-keyhole', accent: 'red', host,
      intro: `Break the encryption protecting the ${label} login.`,
      gate: { require: true, skill, dv, actor, context: `Crack: ${label}`, flavor: `Credential Crack // DV ${dv}`, net: { verb: 'Backdoor', action: 'crack' } },
      successLabel: 'KEY EXPOSED', failLabel: 'CRACK FAILED',
    });
    if (res.cancelled) return false;
    if (!res.ok) { ncmNotify.warn(`NCM | Crack failed${rolledNote(res, dv)}.`); return false; }
  }

  await persistIntent(messageId, 'credentials', raw, { action: 'crack', index: entryIndex }, actor,
    `NCM | ${actor?.name || 'GM'} cracked the ${label} credentials.`);
  game.nightcity?.soundService?.play('shard-decrypt');
  game.nightcity?.traceService?.logSuccess({ actor, action: 'crack', source: label, targetKind: 'message', targetMessageId: messageId, severity: 'major' });
  ncmNotify.info(`NCM | Credentials cracked — the ${label} key is exposed.`);
  return true;
}

// ═══════════════════════════════════════════════════════════
//  Content unlock — roll-to-reveal locked sub-content
// ═══════════════════════════════════════════════════════════

/**
 * Reveal locked sub-content behind a skill roll (the crack pattern — always
 * gated, GM without a character force-reveals via a styled confirm; a miss
 * just fails UNLESS the content carries `traceOnFail: true`, which fires a
 * trace + GM whisper). Three shapes:
 *   · kind 'gallery'  — images[index].locked → decrypt ONE frame (per-image
 *                       `unlockSkill`/`unlockDV` beat the vault-level pair)
 *   · kind 'avlog'    — contentData.locked → unseal the recording
 *                       (media + transcript hidden until then)
 *   · kind 'calendar' — events[index].locked → decrypt ONE fogged event
 *                       (per-event `unlockSkill`/`unlockDV` beat the vault pair)
 *   · kind 'location' — contentData.locked → decrypt the whole pin (image /
 *                       coordinates / intel enricher-stripped until then;
 *                       success stamps `revealedAt` → FUI resolve animation)
 *   · kind 'dossier-face'    — faceLocked → unmask the dossier identity
 *                       (`faceUnlockSkill`/`faceUnlockDV`, `faceTraceOnFail`)
 *   · kind 'dossier-profile' — profile.visibility 'encrypted' → decrypt the
 *                       live combat-profile values (`profile.skill`/`profile.dv`)
 *   · kind 'document' | 'dossier' | 'spreadsheet' — DECLASSIFY all redactions
 *                       (`declassify: true` + `declassifySkill`/`declassifyDV`;
 *                       revealed pieces keep `declassified: true` for the tint)
 * @returns {Promise<boolean>} true = revealed (caller re-renders)
 */
export async function runContentUnlock({ actor, raw, kind, index = -1, messageId, force = false, host = null }) {
  const cd = raw || {};
  // A successful roll that can't persist = the seal visibly holds. Say so first.
  if (!canPersistContent()) return false;
  // Every early-return below reads to the user as "the button did nothing" —
  // log the reason so a failing unlock is diagnosable from the console
  // (debugMode). The common ones: contentData missing (bad entry lookup) and
  // the type's arming flag not set (declassify/locked never authored).
  log.debug(`runContentUnlock: kind=${kind} index=${index} messageId=${messageId} hasRaw=${!!raw} actor=${actor?.name || 'none'} force=${force}`);
  if (!raw) { log.warn(`runContentUnlock: no contentData for messageId ${messageId} (entry lookup failed) — nothing to unlock.`); return false; }
  let label, skill, dv, traceFlag; // traceFlag: per-item override; null → vault-level cd.traceOnFail
  if (kind === 'gallery') {
    const img = (cd.images || [])[index];
    if (!img || !img.locked) return false;
    label = img.label || `frame ${index + 1}`;
    // Per-frame override beats the vault-level pair.
    skill = img.unlockSkill || cd.unlockSkill || DEFAULT_CRACK_SKILL;
    dv = Number(img.unlockDV ?? cd.unlockDV) || DEFAULT_CRACK_DV;
  } else if (kind === 'avlog') {
    if (!cd.locked) return false;
    label = 'the sealed recording';
    skill = cd.unlockSkill || DEFAULT_CRACK_SKILL;
    dv = Number(cd.unlockDV) || DEFAULT_CRACK_DV;
  } else if (kind === 'schematic') {
    const a = (cd.annotations || [])[index];
    if (!a || !a.locked) return false;
    label = 'this marker';
    skill = a.unlockSkill || cd.unlockSkill || DEFAULT_CRACK_SKILL;
    dv = Number(a.unlockDV ?? cd.unlockDV) || DEFAULT_CRACK_DV;
  } else if (kind === 'calendar') {
    const ev = (cd.events || [])[index];
    if (!ev || !ev.locked) return false;
    label = 'this calendar entry';
    skill = ev.unlockSkill || cd.unlockSkill || DEFAULT_CRACK_SKILL;
    dv = Number(ev.unlockDV ?? cd.unlockDV) || DEFAULT_CRACK_DV;
    traceFlag = !!(ev.traceOnFail || cd.traceOnFail);
  } else if (kind === 'location') {
    // Encrypted pin — coordinates/image/intel sealed until decrypted. The
    // reveal stamps `revealedAt` so the enricher can play the FUI resolve
    // animation on the next render (display-only; real-time is fine).
    if (!cd.locked) return false;
    label = 'the location data';
    skill = cd.unlockSkill || DEFAULT_CRACK_SKILL;
    dv = Number(cd.unlockDV) || DEFAULT_CRACK_DV;
    traceFlag = !!cd.traceOnFail;
  } else if (kind === 'dossier-face') {
    if (!cd.faceLocked) return false;
    label = 'the masked identity';
    skill = cd.faceUnlockSkill || DEFAULT_CRACK_SKILL;
    dv = Number(cd.faceUnlockDV) || DEFAULT_CRACK_DV;
    traceFlag = !!cd.faceTraceOnFail;
  } else if (kind === 'dossier-profile') {
    if (!(cd.profile?.enabled && cd.profile.visibility === 'encrypted' && !cd.profile.decrypted)) return false;
    label = 'the combat profile';
    skill = cd.profile.skill || DEFAULT_CRACK_SKILL;
    dv = Number(cd.profile.dv) || DEFAULT_CRACK_DV;
  } else if (kind === 'document' || kind === 'dossier' || kind === 'spreadsheet') {
    if (!cd.declassify) { log.warn(`runContentUnlock: ${kind} has declassify=false — the DECLASSIFY button can't do anything.`); return false; }
    label = 'the redacted sections';
    skill = cd.declassifySkill || DEFAULT_CRACK_SKILL;
    dv = Number(cd.declassifyDV) || DEFAULT_CRACK_DV;
    if (kind === 'document') {
      if (!(cd.paragraphs || []).some(p => p.redacted)) { log.warn('runContentUnlock: document has no redacted paragraphs — nothing to declassify.'); return false; }
    } else if (kind === 'dossier') {
      if (!(cd.sections || []).some(s => s.redacted)) { log.warn('runContentUnlock: dossier has no redacted sections — nothing to declassify.'); return false; }
    } else {
      if (!(cd.redacted || []).length) { log.warn('runContentUnlock: spreadsheet has no redacted cells — nothing to declassify.'); return false; }
    }
  } else { log.warn(`runContentUnlock: unknown unlock kind "${kind}".`); return false; }

  const isCrypt = kind === 'gallery' || kind === 'avlog' || kind === 'schematic' || kind === 'calendar'
    || kind === 'dossier-face' || kind === 'dossier-profile' || kind === 'location';
  if (force) {
    const res = await runSecurityConsole({
      title: isCrypt ? 'Force Decrypt' : 'Force Declassify', icon: 'fas fa-unlock-keyhole', accent: 'red', host,
      intro: `Reveal ${label} without a roll?`, confirmLabel: 'Reveal',
    });
    if (!res.ok) return false;
  } else {
    if (!actor) { ncmNotify.warn('NCM | No character assigned.'); return false; }
    if (!game.nightcity?.skillService) { ncmNotify.error('NCM | Skill service unavailable.'); return false; }
    const res = await runSecurityConsole({
      title: kind === 'avlog' ? 'Unseal Recording'
        : kind === 'dossier-face' ? 'Decrypt Identity'
        : kind === 'dossier-profile' ? 'Decrypt Profile'
        : kind === 'location' ? 'Decrypt Location'
        : (isCrypt ? 'Decrypt Frame' : 'Declassify'),
      icon: 'fas fa-unlock-keyhole', accent: isCrypt ? 'purple' : 'gold', host,
      intro: isCrypt ? `Break the encryption sealing ${label}.` : 'Strip the classification layer off this file.',
      gate: { require: true, skill, dv, actor, context: `Unlock: ${label}`, flavor: `${isCrypt ? 'Decrypt' : 'Declassify'} // DV ${dv}`, net: { verb: 'Backdoor', action: isCrypt ? 'decrypt' : 'declassify' } },
      successLabel: isCrypt ? 'DECRYPTED' : 'DECLASSIFIED', failLabel: 'SEAL HELD',
    });
    if (res.cancelled) return false;
    if (!res.ok) {
      ncmNotify.warn(`NCM | The seal held${rolledNote(res, dv)}.`);
      // Optional consequence: the seal is booby-trapped (`traceOnFail`).
      if (traceFlag ?? cd.traceOnFail) _fireUnlockTrace(actor, label, messageId);
      return false;
    }
  }

  // What each kind changes lives in contentIntents (unlockNext), shared with the GM.
  await persistIntent(messageId, UNLOCK_KINDS[kind], cd, { action: 'unlock', kind, index }, actor,
    `NCM | ${actor?.name || 'GM'} revealed ${label} (${kind}).`);
  game.nightcity?.soundService?.play('shard-decrypt');
  game.nightcity?.traceService?.logSuccess({ actor, action: 'unlock', source: label, targetKind: 'message', targetMessageId: messageId, severity: 'major' });
  ncmNotify.info(isCrypt ? `NCM | ${label} decrypted.` : 'NCM | Redactions lifted.');
  return true;
}

/**
 * GM quick-toggle for a schematic marker's lock (the legend checkbox — flip a
 * point locked/unlocked live at the table without opening the composer).
 * GM-only (the toggle only renders for a GM); no roll, no trace.
 * @returns {Promise<boolean>} true = flipped (caller re-renders)
 */
export async function toggleSchematicLock({ raw, index, messageId }) {
  if (!game.user?.isGM) return false;
  const cd = raw || {};
  const a = (cd.annotations || [])[index];
  if (!a) return false;
  const next = !a.locked;
  await persistContentData(
    messageId,
    { ...cd, annotations: cd.annotations.map((x, i) => (i === index ? { ...x, locked: next } : x)) },
    `NCM | Marker ${index + 1} ${next ? 'locked' : 'revealed'}.`,
  );
  return true;
}

/**
 * CAMERA-FEED actions (gallery mode:'feed') — LOOP a channel onto old footage,
 * CUT it to SIGNAL LOST, RESTORE it (GM), or TAKE CONTROL of a PTZ head.
 * One dispatcher for all four (action `camAction`, data-cam-act on the button —
 * wired in all three viewers, the contentUnlock model):
 * - `control` is CLIENT-SIDE ONLY (a session grant via grantPtzControl —
 *   looking around persists nothing, so it works with no GM online).
 * - `loop`/`cut` persist `looped`/`cut` on the image via persistContentData
 *   (GM-owned journals; players relay — canPersistContent guards first).
 *   A looped cam also freezes `loopedTime` (the stale-timestamp tell).
 * - GM path: force-toggle, no roll (the schemLockToggle model). Player path:
 *   SecurityConsole roll vs the cam's loopDV/cutDV using the gallery's
 *   `camSkill` (default Electronics/Security Tech); a miss can fire the
 *   vault-level traceOnFail.
 * @returns {Promise<boolean>} true = state changed (caller re-renders)
 */
export async function runCamAction({ actor, raw, index, act, messageId, host = null }) {
  const cd = raw || {};
  const img = (cd.images || [])[index];
  if (!img) { log.warn(`runCamAction: no image at index ${index} (messageId ${messageId}).`); return false; }
  const gm = isGM();
  const label = img.label || `CAM_${String(index + 1).padStart(2, '0')}`;
  const skill = cd.camSkill || 'Electronics/Security Tech';
  log.debug(`runCamAction: act=${act} index=${index} messageId=${messageId} gm=${gm} actor=${actor?.name || 'none'}`);

  // ── TAKE CONTROL — PTZ head hijack, session-only (no persistence). ──
  if (act === 'control') {
    if (gm) { grantPtzControl(messageId, index); return true; }
    const dv = Number(img.controlDV) || 9;
    if (!actor) { ncmNotify.warn('NCM | No character assigned.'); return false; }
    const res = await runSecurityConsole({
      title: 'Take Control', icon: 'fas fa-satellite-dish', accent: 'amber', host,
      intro: `Seize the ${label} camera head — until then you're watching its patrol sweep.`,
      gate: { require: true, skill, dv, actor, context: `Camera control: ${label}`, flavor: `Take Control // DV ${dv}`, net: { verb: 'Control', action: 'camera' } },
      successLabel: 'CONTROL SEIZED', failLabel: 'ACCESS DENIED',
    });
    if (res.cancelled) return false;
    if (!res.ok) {
      ncmNotify.warn(`NCM | The camera head refused${rolledNote(res, dv)}.`);
      if (cd.traceOnFail) _fireUnlockTrace(actor, `the ${label} camera`, messageId);
      return false;
    }
    grantPtzControl(messageId, index);
    game.nightcity?.traceService?.logSuccess({ actor, action: 'camera', source: `the ${label} camera`, targetKind: 'message', targetMessageId: messageId, severity: 'major' });
    ncmNotify.info(`NCM | ${label} is yours — drive it.`);
    return true;
  }

  // Everything below writes the journal — a player needs a GM online.
  if (!canPersistContent()) return false;
  const mut = (patch) => ({ ...cd, images: cd.images.map((x, i) => (i === index ? { ...x, ...patch } : x)) });
  const clockStamp = () => {
    try {
      const ms = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
      return formatCyberDate(new Date(ms).toISOString(), { timeOnly: true, seconds: true });
    } catch (_) { return ''; }
  };

  if (act === 'restore') {
    if (!gm) return false; // the chip only renders for a GM
    await persistContentData(messageId, mut({ looped: false, cut: false, loopedTime: '' }),
      `NCM | ${label} restored.`);
    return true;
  }
  if (act !== 'loop' && act !== 'cut') { log.warn(`runCamAction: unknown act "${act}".`); return false; }

  // ── GM force-toggle: no roll, instant table control. ──
  if (gm) {
    if (act === 'loop') {
      await persistContentData(messageId,
        mut(img.looped ? { looped: false, loopedTime: '' } : { looped: true, loopedTime: clockStamp() }),
        `NCM | ${label} ${img.looped ? 'unlooped' : 'looped'}.`);
    } else {
      await persistContentData(messageId, mut({ cut: !img.cut }),
        `NCM | ${label} ${img.cut ? 'restored' : 'cut'}.`);
    }
    return true;
  }

  // ── Player roll. ──
  if (!actor) { ncmNotify.warn('NCM | No character assigned.'); return false; }
  if (!game.nightcity?.skillService) { ncmNotify.error('NCM | Skill service unavailable.'); return false; }
  const isLoop = act === 'loop';
  const dv = isLoop ? (Number(img.loopDV) || 9) : (Number(img.cutDV) || 12);
  const res = await runSecurityConsole({
    title: isLoop ? 'Loop Camera' : 'Cut Feed',
    icon: isLoop ? 'fas fa-rotate' : 'fas fa-scissors', accent: isLoop ? 'amber' : 'red', host,
    intro: isLoop
      ? `Freeze ${label} on old footage — anyone watching sees yesterday's nothing.`
      : `Kill the ${label} channel. The dead screen WILL be noticed eventually.`,
    gate: { require: true, skill, dv, actor, context: `${isLoop ? 'Camera loop' : 'Feed cut'}: ${label}`, flavor: `${isLoop ? 'Loop' : 'Cut'} // DV ${dv}`, net: { verb: 'Control', action: 'camera' } },
    successLabel: isLoop ? 'FEED LOOPED' : 'FEED DOWN', failLabel: 'INTRUSION FLAGGED',
  });
  if (res.cancelled) return false;
  if (!res.ok) {
    ncmNotify.warn(`NCM | The intrusion was flagged${rolledNote(res, dv)}.`);
    if (cd.traceOnFail) _fireUnlockTrace(actor, `the ${label} camera`, messageId);
    return false;
  }
  await persistIntent(messageId, 'gallery', cd, { action: isLoop ? 'camLoop' : 'camCut', index }, actor,
    `NCM | ${actor.name} ${isLoop ? 'looped' : 'cut'} ${label}.`);
  game.nightcity?.traceService?.logSuccess({ actor, action: 'camera', source: `the ${label} camera`, targetKind: 'message', targetMessageId: messageId, severity: 'major' });
  ncmNotify.info(isLoop ? `NCM | ${label} is looping old footage.` : `NCM | ${label} is dark.`);
  return true;
}

/**
 * A booby-trapped seal fired on a failed unlock (`traceOnFail`): player-side
 * trace splash + a GM whisper (client-created ChatMessage — no socket needed).
 */
function _fireUnlockTrace(actor, label, messageId = null) {
  const ts = game.nightcity?.traceService;
  if (ts) { ts.fireTrace({ actor, action: 'unlock', source: label, severity: 'major', targetKind: messageId ? 'message' : undefined, targetMessageId: messageId || undefined }); return; }
  // Fallback if the service isn't up yet — the old inline drama.
  try {
    game.nightcity?.soundService?.play('trace-fire');
    game.nightcity?.notificationService?.showShardTrace?.({ itemName: label });
  } catch (err) { log.warn(`Unlock trace failed: ${err.message}`); }
}

// ═══════════════════════════════════════════════════════════
//  Malware deploy (shared shard + terminal + inbox)
// ═══════════════════════════════════════════════════════════

/**
 * Deploy a MALWARE entry (§8c: "copyable weapon; honeypot variant trips a
 * trace"). A normal deploy marks the file `deployed` and tells the GM (what
 * the program DOES is GM adjudication — the payload-execute model). A
 * `honeypot` fires the trace instead: the player learns the file was a decoy
 * the hard way, and the GM is alerted. Both outcomes persist through
 * persistContentData (GM-owned journals; players relay).
 * @param {object} args { actor, raw: malware contentData, messageId, sourceLabel }
 * @returns {{success:boolean, honeypot?:boolean}|null} null = no-op (not deployable / cancelled)
 */
export async function runMalwareDeploy({ actor, raw, messageId, sourceLabel = 'this system', host = null, unstable = null }) {
  const cd = raw || {};
  if (!canPersistContent()) return null;
  const name = cd.name || 'UNKNOWN.exe';
  if (!cd.deployable) { ncmNotify.warn('NCM | This binary is quarantined — it cannot be run from here.'); return null; }
  if (cd.deployed) { ncmNotify.warn('NCM | Already executed.'); return null; }

  // Optional gate: deploying can require a roll (`deploySkill`/`deployDV`) —
  // e.g. a Basic Tech / Interface check to run it cleanly; default off.
  const gated = !!cd.deployRequire && !!actor;
  // A program on a damaged shard runs UNSTABLE (IntegrityModel.unstableFor):
  // a gated run is harder, and any run may misfire.
  const deployDV = (Number(cd.deployDV) || 9) + (unstable?.dvPenalty || 0);
  const unstableNote = unstable ? ` The file is damaged — ${unstable.misfire}% chance it misfires.` : '';
  const res = await runSecurityConsole({
    title: 'Deploy Malware', icon: 'fas fa-biohazard', accent: 'red', host,
    intro: `Run ${name} on ${sourceLabel}? Whatever it does, it does now.${unstableNote}`,
    confirmLabel: 'Deploy',
    gate: gated ? { require: true, skill: cd.deploySkill || 'Interface', dv: deployDV, actor, context: `Deploy: ${name}`, flavor: `Malware Deploy // DV ${deployDV}`, net: { verb: 'Virus', action: 'malware', hostName: sourceLabel } } : null,
    successLabel: 'PAYLOAD LIVE', failLabel: 'EXECUTION FAULT',
  });
  if (res.cancelled) return null;
  // A failed gated deploy still "runs" — it just misfires loudly (trace), the
  // same consequence surface as a honeypot. Only an outright cancel aborts.
  const glitched = !!unstable && res.ok !== false && Math.random() * 100 < (unstable.misfire || 0);
  const misfired = (gated && !res.ok) || glitched;


  if (cd.honeypot || misfired) {
    // Decoy OR a botched deploy — the payload turns on the operator. Trace fires
    // (log + heat), GM finds out.
    game.nightcity?.traceService?.fireTrace({ actor, action: 'malware', source: name, objectName: sourceLabel, severity: 'hostile' });
    // Linked Black ICE bites the operator on any misfire (shard-security
    // damage path — ATK + 1d10 from the linked actor via ICEService).
    if (cd.iceActorId && actor) {
      try {
        await game.nightcity?.iceService?.applyDamage(actor,
          { encryptionType: 'BLACK_ICE', ice: { source: 'actor', actorId: cd.iceActorId } },
          { context: 'malware', targetName: name });
      } catch (err) { log.error(`Malware ICE damage failed: ${err.message}`); }
    }
    const why = cd.honeypot ? 'tripped the HONEYPOT' : 'botched the deploy of';
    await persistIntent(messageId, 'malware', cd, { action: 'deploy', tripped: true }, actor,
      `NCM | ⚠ ${actor?.name || 'Someone'} ${why} "${name}" (${sourceLabel}).`);
    ncmNotify.warn(cd.honeypot ? `NCM | ${name} was a decoy — a trace just fired.` : `NCM | ${name} misfired — a trace just fired.`);
    return { success: false, honeypot: !!cd.honeypot };
  }

  // Clean deploy. If the malware carries a real module-native effect, run it
  // through the SHARED engine (GM applies directly; a player relays the outcome
  // to the GM) — this is where malware sheds the adjudicate-only stub. Malware
  // with no effect (or `adjudicate`) keeps the GM-adjudicate alert exactly as
  // before, so nothing existing changes behavior.
  const effectType = cd.effect?.type;
  const hasEffect = !!effectType && (effectType !== 'adjudicate' || !!cd.effect?.macroId);
  if (hasEffect) {
    if (isGM()) {
      await applyMalwareEffect({ messageId, actorId: actor?.id || null });
    } else {
      game.nightcity?.socketManager?.emit(SOCKET_OPS.PAYLOAD_EFFECT_REQUEST, {
        kind: 'malware', messageId, actorId: actor?.id || null, outcome: 'success', userId: game.user.id,
      });
    }
  } else {
    await persistIntent(messageId, 'malware', cd, { action: 'deploy' }, actor,
      `NCM | ${actor?.name || 'Someone'} deployed "${name}" (${sourceLabel}) — adjudicate its effect.${cd.description ? ` ${cd.description}` : ''}`);
  }
  game.nightcity?.soundService?.play('hack-success');
  game.nightcity?.traceService?.logSuccess({ actor, action: 'malware', source: name, objectName: sourceLabel, targetMessageId: messageId, severity: 'hostile' });
  ncmNotify.info(`NCM | ${name} executed.${hasEffect ? '' : ' The system takes it from here.'}`);
  return { success: true };
}

// ═══════════════════════════════════════════════════════════
//  PAYLOAD — utility program execution (overhaul 2026-07-12)
// ═══════════════════════════════════════════════════════════
//
//  PAYLOAD is the operator's TOOL (icebreaker/skeletonKey/scanner/jammer, or a
//  GM-adjudicated program), the utility sibling of the hostile MALWARE type.
//  Two halves, mirroring the malware/siphon split:
//    · The gate ROLL runs client-side (the player rolls their own skill via the
//      SecurityConsole) — like crack/siphon.
//    · The EFFECT (host mutations: unseal sibling files, clear lockouts, scan,
//      drop the uplink) + the payload's own state write are applied GM-SIDE,
//      because the host + the entry journal are GM-owned. A GM runs it directly;
//      a player relays the roll OUTCOME via SOCKET_OPS.PAYLOAD_EFFECT_REQUEST and
//      the GM's applyPayloadEffect does everything. ONE writer, no races.
//    · A linked world Macro runs GM-side too (consistent perms).
//    · Timed effects set active + expiresAt (game clock); the GM reaper flips
//      them to done at expiry and restores reversible ones (jammer → uplink).

const DEFAULT_EXEC_SKILL = 'Interface';
const DEFAULT_EXEC_DV = 9;

/**
 * Execute a PAYLOAD (client entry point). Rolls the optional gate, then applies
 * the effect GM-side (direct) or relays the outcome to the GM (player).
 * @param {object} a { actor, raw: payload contentData, messageId, sourceLabel, host, force }
 * @returns {Promise<{success:boolean}|null>} null = no-op / cancelled
 */
export async function runPayloadExecute({ actor, raw, messageId, sourceLabel = 'this system', host = null, force = false, unstable = null }) {
  const cd = raw || {};
  const name = cd.name || 'PROGRAM.EXE';
  // The GM applies the effect (audit DATA-20): without one the roll would be spent for nothing.
  if (!canPersistContent()) return null;
  // Each run spends a charge (audit DATA-08); no charges left = used up.
  if (!payloadCanRun(cd)) { ncmNotify.warn('NCM | This program has no charges left.'); return null; }

  const gated = !!cd.executeRequire;
  const skill = cd.executeSkill || DEFAULT_EXEC_SKILL;
  // A program on a damaged shard runs UNSTABLE: harder to run, and it may misfire.
  const dv = (Number(cd.executeDV) || DEFAULT_EXEC_DV) + (unstable?.dvPenalty || 0);
  const fxLabel = _payloadEffectName(cd.effect?.type);
  const unstableNote = unstable && !force ? ` The file is damaged — ${unstable.misfire}% chance it misfires.` : '';

  // Wipe / Corrupt go after files chosen now, on the host they are running on.
  let targets = null;
  if (TARGETED_VERBS.includes(cd.effect?.type) && !cd.effect?.params?.messageIds?.length) {
    const page = _findPayloadPage(messageId)?.page;
    const hostItem = page ? _resolvePayloadHost(page) : null;
    if (!hostItem) { ncmNotify.warn('NCM | This program has nothing to run on.'); return null; }
    targets = await pickHostFiles(hostItem, { verb: cd.effect.type, accountId: page.flags?.[MODULE_ID]?.accountId || null, excludeId: messageId });
    if (!targets) return null;
  }

  let outcome = 'success';
  if (force || (!gated)) {
    // GM force-run OR an ungated program → styled confirm (immersion only).
    const res = await runSecurityConsole({
      title: `Run ${name}`, icon: 'fas fa-play', accent: 'purple', host,
      intro: `Execute ${name} on ${sourceLabel}? ${fxLabel} routine engages.${unstableNote}`,
      confirmLabel: 'RUN',
    });
    if (res.cancelled || !res.ok) return null;
  } else {
    if (!actor) { ncmNotify.warn('NCM | No character assigned to run this.'); return null; }
    if (!game.nightcity?.skillService) { ncmNotify.error('NCM | Skill service unavailable.'); return null; }
    const res = await runSecurityConsole({
      title: `Run ${name}`, icon: 'fas fa-play', accent: 'purple', host,
      intro: `Execute ${name} on ${sourceLabel}. ${fxLabel} routine — a clean run needs the check.${unstableNote}`,
      gate: { require: true, skill, dv, actor, context: `Execute: ${name}`, flavor: `Program Execute // DV ${dv}`, net: { verb: netVerbFor(cd.effect?.type) || 'Control', action: 'execute', hostName: sourceLabel } },
      successLabel: 'EXECUTION CLEAN', failLabel: 'EXECUTION FAULT',
    });
    if (res.cancelled) return null;
    outcome = res.ok ? 'success' : 'fail';
  }
  if (outcome === 'success' && unstable && !force && Math.random() * 100 < (unstable.misfire || 0)) {
    outcome = 'fail';
    ncmNotify.warn(`NCM | ${name} is damaged — it misfired.`);
  }

  // GM applies directly; a player relays the outcome (GM owns the host + journal).
  if (isGM()) {
    await applyPayloadEffect({ messageId, actorId: actor?.id || null, outcome, targets });
  } else {
    game.nightcity?.socketManager?.emit(SOCKET_OPS.PAYLOAD_EFFECT_REQUEST, {
      messageId, actorId: actor?.id || null, outcome, targets, userId: game.user.id,
    });
    ncmNotify.info(outcome === 'success' ? `NCM | ${name} sent to the host…` : `NCM | ${name} misfired…`);
  }
  return { success: outcome === 'success' };
}

/** Friendly effect name for prompts. */
function _payloadEffectName(type) {
  return ({ icebreaker: 'Icebreaker', skeletonKey: 'Skeleton-key', scanner: 'Scanner', jammer: 'Jammer' })[type] || 'Program';
}

/**
 * GM-side: apply a payload's outcome — write its runtime state, run the
 * module-native effect + linked macro (on success), fire a trace (on a gated
 * fail), and alert the GM. Called directly on the GM client and by the
 * PAYLOAD_EFFECT_REQUEST socket handler for player runs.
 * @param {object} a { messageId, actorId, outcome:'success'|'fail' }
 */
export async function applyPayloadEffect({ messageId, actorId, outcome, targets = null }) {
  if (!isGM() || !messageId) return;
  const found = _findPayloadPage(messageId);
  if (!found) { log.warn(`Payload: no journal page for ${messageId}`); return; }
  const { page } = found;
  const cd = page.flags?.[MODULE_ID]?.contentData || {};
  const actor = actorId ? game.actors?.get(actorId) : null;
  const name = cd.name || 'PROGRAM.EXE';
  const iso = _nowIso();
  const effectType = cd.effect?.type || 'adjudicate';

  if (outcome === 'fail') {
    // Trace funnel owns the drama + GM alert + log + heat (design §6a).
    game.nightcity?.traceService?.fireTrace({ actor, action: 'payload', source: name, host: page?.parent, severity: 'hostile' });
    await _writePayloadContent(page, { ...cd, executed: true, executedBy: actorId, executedAt: iso, tripped: true, charges: chargesAfterRun(cd) });
    return;
  }

  // Success — apply the module-native effect (host mutations + a report string).
  const hostItem = _resolvePayloadHost(page);
  let report = '';
  try {
    const runCd = targets?.length ? { ...cd, effect: { ...cd.effect, params: { ...cd.effect?.params, messageIds: targets } } } : cd;
    report = await _applyNativeEffect(effectType, { page, hostItem, actor, cd: runCd });
  } catch (err) { log.error(`Payload effect "${effectType}" failed: ${err.message}`); }

  // Linked Macro (GM-run) — only a macro a GM wrote (SEC-02).
  if (cd.effect?.macroId) await runGmMacro(cd.effect.macroId, { actor, item: hostItem }, `Payload "${name}"`);

  // Timed effect → active window on the game clock.
  const duration = Number(cd.effect?.duration) || 0;
  const timed = duration > 0;
  const expiresAt = timed ? new Date(_nowMs() + duration).toISOString() : null;

  await _writePayloadContent(page, {
    ...cd,
    executed: true, executedBy: actorId, executedAt: iso, tripped: false, killed: false, charges: chargesAfterRun(cd),
    active: timed, expiresAt,
    scanReport: report || cd.scanReport || '',
  });

  game.nightcity?.soundService?.play('hack-success');
  const fx = _payloadEffectName(effectType);
  game.nightcity?.traceService?.logSuccess({ actor, action: 'payload', source: name, hostItem, targetMessageId: messageId, severity: 'hostile' });
  _payloadGmAlert(`${actor?.name || 'Someone'} ran "${name}" (${fx}) on ${hostItem?.name || 'a host'}${report ? ` — ${_stripTags(report)}` : ''}.`);
  ncmNotify.info(`NCM | ${name} executed.${report ? ' ' + _stripTags(report) : ''}`);
}

/** Program verbs a player's upload may hand to the GM to run on a box (the ones that write it). */
const UPLOAD_RUN_VERBS = Object.freeze(['icebreaker', 'wipe', 'corrupt', 'forgeAccount', 'adjudicate']);

/** Message ids on the same journal as `page` (files a program on it may target), never the program itself. */
function _sameJournalIds(page, ids, excludeId = null) {
  if (!Array.isArray(ids)) return [];
  const here = new Set((page?.parent?.pages?.contents || [...(page?.parent?.pages || [])]).map((p) => p.flags?.[MODULE_ID]?.messageId).filter(Boolean));
  return [...new Set(ids.map(String))].filter((id) => here.has(id) && id !== excludeId);
}

/**
 * Is this relayed program run allowed? (audit SEC-04 / A3a) The sender must see the
 * program's entry and own the named character; the entry must be in a state where
 * the request makes sense (not already run, actually running for a kill, a clean
 * deployable malware for an effect); a payload's targets must be files on its own host.
 * @returns {{ok:true, targets?:string[]}|{ok:false, why:string}}
 */
export function checkPayloadRequest(data, senderId) {
  const who = checkContentSender(data?.messageId, senderId, data?.actorId);
  if (!who.ok) return who;
  const f = who.page.flags?.[MODULE_ID] || {};
  const cd = f.contentData || {};
  if (data.kind === 'malware') {
    if (f.contentType !== 'malware') return { ok: false, why: 'not a malware entry' };
    if (!cd.deployable || cd.deployed || cd.honeypot) return { ok: false, why: 'that malware cannot run cleanly' };
    const t = cd.effect?.type;
    if (!t || (t === 'adjudicate' && !cd.effect?.macroId)) return { ok: false, why: 'that malware has no effect' };
    return { ok: true };
  }
  if (f.contentType !== 'payload') return { ok: false, why: 'not a program entry' };
  if (data.outcome === 'kill') return cd.active && !cd.killed ? { ok: true } : { ok: false, why: 'nothing is running' };
  if (data.outcome !== 'success' && data.outcome !== 'fail') return { ok: false, why: `unknown outcome "${data.outcome}"` };
  if (!payloadCanRun(cd)) return { ok: false, why: 'no charges left' };
  return { ok: true, targets: data.targets ? _sameJournalIds(who.page, data.targets, data.messageId) : null };
}

/**
 * Is this relayed upload run allowed? The sender must own the character, the verb must
 * be one that writes a box, the box must be a terminal, and file targets must be on it.
 * (Which program a player may push, from which shard, is checked with the terminal relays, A3c.)
 * @returns {Promise<{ok:true, params:object}|{ok:false, why:string}>}
 */
export async function checkUploadRunRequest(data, senderId) {
  const user = senderId ? game.users?.get(senderId) : null;
  if (!user) return { ok: false, why: 'unknown sender' };
  if (!data?.actorId || !userOwnsActor(senderId, data.actorId)) return { ok: false, why: `${user.name} does not own that character` };
  if (!UPLOAD_RUN_VERBS.includes(data.effectType)) return { ok: false, why: `"${data.effectType}" is not a program a player can run on a box` };
  const host = data.itemUuid ? await fromUuid(data.itemUuid) : null;
  if (!host?.getFlag?.(MODULE_ID, 'isTerminal')) return { ok: false, why: 'the target is not a terminal' };
  const params = stripMacroRefs(data.params && typeof data.params === 'object' ? data.params : {});
  if (params.messageIds) {
    const journal = game.journal?.get(host.getFlag(MODULE_ID, 'journalId'));
    const here = new Set((journal?.pages?.contents || []).map((p) => p.flags?.[MODULE_ID]?.messageId).filter(Boolean));
    params.messageIds = [...new Set(params.messageIds.map(String))].filter((id) => here.has(id));
  }
  return { ok: true, params };
}

/** GM-side socket handler body for PAYLOAD_EFFECT_REQUEST (payload + malware + upload runs). */
export async function handlePayloadEffectRequest(data, senderId) {
  if (!isGM()) return;
  // A relayed upload never names its own macro: the GM reads it from the program's
  // shard entry (`source`) inside applyUploadRun (SEC-02).
  if (data?.kind === 'uploadRun') {
    const ok = await checkUploadRunRequest(data, senderId);
    if (!ok.ok) { log.warn(`Upload run refused: ${ok.why}`); return; }
    await applyUploadRun({ ...stripMacroRefs(data), params: ok.params, macroId: '', userId: senderId });
    return;
  }
  const ok = checkPayloadRequest(data, senderId);
  if (!ok.ok) { log.warn(`Program request refused: ${ok.why}`); return; }
  if (data.kind === 'malware') { await applyMalwareEffect({ messageId: data.messageId, actorId: data.actorId }); return; }
  if (data.outcome === 'kill') { await applyPayloadKill({ messageId: data.messageId, actorId: data.actorId }); return; }
  await applyPayloadEffect({ messageId: data.messageId, actorId: data.actorId, outcome: data.outcome, targets: ok.targets || null });
}

/**
 * GM-side: the macro a program links to, read from the program's OWN shard entry
 * (the data the GM's tools wrote), never from a request (audit SEC-02).
 * @param {{itemUuid: string, entryId: string}} source - the carried shard + the entry's messageId
 * @returns {Promise<string>} the macro id, or '' when there is none / it can't be found
 */
export async function programMacroId(source) {
  const { itemUuid, entryId } = source || {};
  if (!itemUuid || !entryId) return '';
  try {
    const shard = await fromUuid(itemUuid);
    if (!shard) return '';
    const journalId = shard.getFlag?.(MODULE_ID, 'journalId');
    const journal = journalId ? game.journal?.get(journalId) : null;
    const page = journal?.pages?.find?.((p) => p.flags?.[MODULE_ID]?.messageId === entryId);
    return page?.flags?.[MODULE_ID]?.contentData?.effect?.macroId || '';
  } catch (err) {
    log.warn(`Program macro lookup failed: ${err.message}`);
    return '';
  }
}

/**
 * GM-side: a player pushed a program that changes the host (Icebreaker, Wipe, Corrupt, Backdoor, a custom routine).
 * The host's journal and config are the GM's to write; the report goes back to the player as a whisper.
 */
export async function applyUploadRun({ itemUuid, effectType, params = {}, actorId, name = 'program', description = '', macroId = '', source = null, userId }) {
  if (!isGM()) return '';
  const hostItem = itemUuid ? await fromUuid(itemUuid) : null;
  if (!hostItem) return '';
  const actor = actorId ? game.actors?.get(actorId) : null;
  let report = '';
  try { report = await _applyNativeEffect(effectType, { page: null, hostItem, actor, cd: { description, effect: { type: effectType, params: stripMacroRefs(params) } } }); }
  catch (err) { log.error(`Upload run "${effectType}" failed: ${err.message}`); }
  // The linked macro comes from the program's own shard entry when we know it,
  // never from the request (SEC-02); runGmMacro still requires a GM author.
  const linked = source ? await programMacroId(source) : macroId;
  if (linked) await runGmMacro(linked, { actor, item: hostItem }, `Program "${name}"`);
  _payloadGmAlert(`${actor?.name || 'Someone'} ran "${name}" on ${hostItem.name}${report ? ` — ${_stripTags(report)}` : ''}.`);
  if (userId && !game.users?.get(userId)?.isGM) {
    const safe = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    try { await ChatMessage.create({ whisper: [userId], speaker: { alias: name }, content: `<b>${safe(name)}</b> ran on <b>${safe(hostItem.name)}</b><br>${safe(_stripTags(report) || 'It ran. Nothing comes back.')}` }); } catch { /* the whisper is a bonus */ }
  }
  return report;
}

/**
 * Apply a MALWARE entry's module-native effect on a clean deploy. The hostile
 * twin of applyPayloadEffect: it reuses the SAME effect engine (_applyNativeEffect)
 * + linked Macro, but writes malware's own `deployed` state schema (not payload's
 * `executed`/`active`), so the malware enricher/composer/reaper contracts are
 * untouched. GM-side only (host mutations + the GM-owned page write); a player
 * reaches it via handlePayloadEffectRequest with kind:'malware'. Effects are
 * treated as INSTANT here (a timed malware fires-and-forgets — the payload reaper
 * only reaps contentType 'payload'); timed/triggered malware is a later slice.
 * @param {object} a { messageId, actorId }
 */
export async function applyMalwareEffect({ messageId, actorId }) {
  if (!isGM() || !messageId) return;
  const found = _findPayloadPage(messageId);
  if (!found) { log.warn(`Malware: no journal page for ${messageId}`); return; }
  const { page } = found;
  const cd = page.flags?.[MODULE_ID]?.contentData || {};
  const actor = actorId ? game.actors?.get(actorId) : null;
  const name = cd.name || 'UNKNOWN.exe';
  const iso = _nowIso();
  const effectType = cd.effect?.type || 'adjudicate';
  const hostItem = _resolvePayloadHost(page);

  let report = '';
  try { report = await _applyNativeEffect(effectType, { page, hostItem, actor, cd }); }
  catch (err) { log.error(`Malware effect "${effectType}" failed: ${err.message}`); }

  if (cd.effect?.macroId) await runGmMacro(cd.effect.macroId, { actor, item: hostItem }, `Malware "${name}"`);

  await _writePayloadContent(page, {
    ...cd, deployed: true, deployedBy: actorId, deployedAt: iso, tripped: false,
    scanReport: report || cd.scanReport || '',
  });
  _payloadGmAlert(`${actor?.name || 'Someone'} deployed "${name}" (${_payloadEffectName(effectType)}) on ${hostItem?.name || 'a host'}${report ? ` — ${_stripTags(report)}` : ''}.`);
}

/**
 * GM reaper — flip timed payload effects to done once the game clock passes
 * their expiresAt (and restore reversible ones, e.g. jammer → uplink). Runs on
 * an interval registered in registerTerminalSystem, mirroring the self-destruct
 * reaper. Idempotent: skips already-inactive/killed payloads.
 */
export async function reapExpiredPayloads() {
  if (!isPrimaryGM()) return;   // one GM reaps (INT-01)
  const now = _nowMs();
  for (const j of game.journal) {
    for (const p of j.pages.contents) {
      const f = p.flags?.[MODULE_ID];
      if (f?.contentType !== 'payload') continue;
      const c = f.contentData;
      if (!c?.active || c.killed || !c.expiresAt) continue;
      if (new Date(c.expiresAt).getTime() > now) continue;
      await _reversePayloadEffect(c.effect?.type, _resolvePayloadHost(p));
      await _writePayloadContent(p, { ...c, active: false });
      log.debug(`Payload effect "${c.name || '?'}" expired — flipped to done`);
    }
  }
}

/**
 * Kill a running (timed) payload effect early. Reverses reversible effects
 * (jammer → restore uplink) and marks the payload killed. GM direct / player
 * relay (a plain contentData write via persistContentData, plus a host reversal
 * that only the GM can do — so the player path relays through the same effect op
 * with outcome 'kill').
 */
export async function runPayloadKill({ actor, raw, messageId, host = null }) {
  const cd = raw || {};
  if (!cd.active || cd.killed) { ncmNotify.warn('NCM | Nothing is running.'); return null; }
  const res = await runSecurityConsole({
    title: 'Terminate Process', icon: 'fas fa-stop', accent: 'red', host,
    intro: `Kill the running ${cd.name || 'program'} effect now?`, confirmLabel: 'KILL',
  });
  if (!res.ok) return null;
  if (isGM()) {
    await applyPayloadKill({ messageId, actorId: actor?.id || null });
  } else {
    game.nightcity?.socketManager?.emit(SOCKET_OPS.PAYLOAD_EFFECT_REQUEST, {
      messageId, actorId: actor?.id || null, outcome: 'kill', userId: game.user.id,
    });
  }
  return { success: true };
}

/** GM-side: end a running payload effect + reverse reversible ones. */
export async function applyPayloadKill({ messageId, actorId }) {
  if (!isGM() || !messageId) return;
  const found = _findPayloadPage(messageId);
  if (!found) return;
  const { page } = found;
  const cd = page.flags?.[MODULE_ID]?.contentData || {};
  await _reversePayloadEffect(cd.effect?.type, _resolvePayloadHost(page));
  await _writePayloadContent(page, { ...cd, active: false, killed: true });
  const actor = actorId ? game.actors?.get(actorId) : null;
  _payloadGmAlert(`${actor?.name || 'Someone'} terminated "${cd.name || 'a program'}".`);
}

/**
 * SNIFF a suspected disguised file — roll to unmask a payload wearing a cover
 * type. On success the payload's `sniffed` flag flips (it renders as its real
 * self thereafter); a miss just fails (optional traceOnFail). Note: the PLAYER
 * can only invoke this on a file they suspect — the action is offered on every
 * entry via the viewer's "scan file" affordance, and no-ops on non-disguised or
 * already-sniffed content, so it can't be used to probe which files are real.
 */
/**
 * ANALYZE — the player-facing scan, offered on EVERY typed file (the GM-only
 * REVEAL stays as the force path). Rolls vs the file's `sniffDV`; a disguised
 * payload is unmasked, a clean file reports "no anomalies" — so scanning is a
 * real, sometimes-wasted choice rather than a tell. A clean file is rolled
 * against the same DV so the console beat is identical either way (a player
 * can't infer "it's a trap" from the dialog itself).
 * @returns {Promise<boolean>} true = something was revealed (caller re-renders)
 */
export async function runAnalyze({ actor, raw, contentType, messageId, host = null }) {
  const cd = raw || {};
  // Reveals a secret before persisting  — pointless (and misleading)
  // if the write can't land.
  if (!canPersistContent()) return false;
  const isDisguised = (contentType === 'payload' || contentType === 'malware') && cd.disguised && !cd.sniffed;
  const dv = Number(cd.sniffDV) || 9;
  const skill = cd.sniffSkill || DEFAULT_EXEC_SKILL;

  // GM with no character: force-reveal a disguise, else just report.
  if (!actor) {
    if (!isGM()) { ncmNotify.warn('NCM | No character assigned.'); return false; }
    if (!isDisguised) { ncmNotify.info('NCM | Nothing hidden in this file.'); return false; }
    return runPayloadSniff({ actor: null, raw: cd, messageId, force: true, host });
  }

  const res = await runSecurityConsole({
    title: 'Analyze File', icon: 'fas fa-magnifying-glass', accent: 'purple', host,
    intro: 'Pull the file apart — headers, checksum, packing. See what it really is.',
    gate: { require: true, skill, dv, actor, context: 'File analysis', flavor: `File Analysis // DV ${dv}`, net: { verb: 'Eye-Dee', action: 'analyze' } },
    successLabel: 'ANALYSIS COMPLETE', failLabel: 'INCONCLUSIVE',
  });
  if (res.cancelled) return false;
  if (!res.ok) {
    // A disguised file shows what its cover says a scan should find.
    ncmNotify.info(isDisguised && cd.coverScan ? `NCM | Scan: ${cd.coverScan}` : 'NCM | The scan comes back inconclusive.');
    // A booby-trapped disguise can bite a failed probe.
    if (isDisguised && cd.traceOnFail) _fireUnlockTrace(actor, 'a suspicious file', messageId);
    return false;
  }
  if (!isDisguised) {
    ncmNotify.info('NCM | Scan clean — no anomalies. It is what it says it is.');
    game.nightcity?.soundService?.play('shard-decrypt');
    return false;
  }
  // Disguise exposed — persist the reveal (same write as the GM's REVEAL).
  await persistIntent(messageId, contentType, cd, { action: 'sniff' }, actor,
    `NCM | ${actor.name} exposed a disguised payload (${cd.name || 'unknown'}).`);
  game.nightcity?.soundService?.play('shard-decrypt');
  ncmNotify.warn(`NCM | It's not what it looks like — ${cd.name || 'a payload'} was hiding in there.`);
  return true;
}

export async function runPayloadSniff({ actor, raw, messageId, force = false, host = null }) {
  const cd = raw || {};
  if (!cd.disguised || cd.sniffed) { ncmNotify.info('NCM | Nothing unusual about this file.'); return false; }
  const dv = Number(cd.sniffDV) || 9;
  const skill = cd.sniffSkill || DEFAULT_EXEC_SKILL;
  if (force) {
    const res = await runSecurityConsole({ title: 'Force Reveal', icon: 'fas fa-mask', accent: 'purple', host, intro: 'Strip this file’s disguise without a roll?', confirmLabel: 'Reveal' });
    if (!res.ok) return false;
  } else {
    if (!actor) { ncmNotify.warn('NCM | No character assigned.'); return false; }
    const res = await runSecurityConsole({
      title: 'Analyze File', icon: 'fas fa-magnifying-glass', accent: 'purple', host,
      intro: 'Something about this file reads wrong. Take a closer look.',
      gate: { require: true, skill, dv, actor, context: 'File analysis', flavor: `File Sniff // DV ${dv}` },
      successLabel: 'DISGUISE EXPOSED', failLabel: 'LOOKS CLEAN',
    });
    if (res.cancelled) return false;
    if (!res.ok) {
      ncmNotify.info('NCM | Looks like an ordinary file.');
      if (cd.traceOnFail) _fireUnlockTrace(actor, 'a suspicious file', messageId);
      return false;
    }
  }
  // Payload and malware disguise the same way; the GM re-reads the stored type.
  await persistIntent(messageId, 'payload', cd, { action: 'sniff' }, actor,
    `NCM | ${actor?.name || 'GM'} unmasked a disguised payload ("${cd.name || 'file'}").`);
  game.nightcity?.soundService?.play('shard-decrypt');
  ncmNotify.warn(`NCM | That "${String(cd.disguiseType || 'file').toUpperCase()}" was a disguised program.`);
  return true;
}

// ── Payload internals (GM-side) ──────────────────────────────

function _nowMs() { try { return game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); } }
function _nowIso() { try { return new Date(_nowMs()).toISOString(); } catch { return new Date().toISOString(); } }
function _stripTags(s) { return String(s ?? '').replace(/<[^>]*>/g, ''); }

/** Locate the journal page for a payload messageId (first hit across journals). */
function _findPayloadPage(messageId) {
  for (const j of game.journal) {
    const p = j.pages.find(pg => pg.flags?.[MODULE_ID]?.messageId === messageId);
    if (p) return { page: p, journal: j };
  }
  return null;
}

/** Write a payload page's whole contentData block (GM-owned). */
async function _writePayloadContent(page, newCd) {
  try { await page.update({ [`flags.${MODULE_ID}.contentData`]: newCd }); return true; }
  catch (err) { log.error(`Payload content write failed: ${err.message}`); return false; }
}

/** GM whisper + toast for a payload event (the malware-alert precedent). */
function _payloadGmAlert(text) {
  try {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
    if (gmIds.length) ChatMessage.create({ content: `<b>NCM payload:</b> ${esc(text)}`, whisper: gmIds });
  } catch (err) { log.warn(`Payload GM alert failed: ${err.message}`); }
}

/**
 * Resolve the host item a payload lives on, from its journal page. Terminals
 * tag the journal with linkedItemId; shards point item.journalId → journal.
 */
function _resolvePayloadHost(page) {
  const journal = page?.parent;
  if (!journal) return null;
  const linkedId = journal.getFlag?.(MODULE_ID, 'linkedItemId');
  if (linkedId) {
    const byUuid = journal.getFlag?.(MODULE_ID, 'linkedItemUuid');
    const it = (byUuid && fromUuidSync?.(byUuid)) || game.items?.get(linkedId) || null;
    if (it) return it;
  }
  // Shard fallback: the item whose journalId points back at this journal.
  const all = [...(game.items ?? [])];
  for (const a of game.actors ?? []) all.push(...(a.items ?? []));
  return all.find(it => it.getFlag?.(MODULE_ID, 'journalId') === journal.id) || null;
}

/**
 * Apply a module-native payload effect on the host. Returns a short HTML/plain
 * report string (shown in the payload's scan panel + GM alert). Effects that
 * don't fit the host type degrade to an empty report (the GM adjudication alert
 * still fires).
 */
export async function _applyNativeEffect(type, { page, hostItem, actor, cd }) {
  // A run from an upload has no page of its own: it works on the host's journal.
  const journal = page?.parent ?? (hostItem ? game.journal?.get(hostItem.getFlag?.(MODULE_ID, 'journalId')) : null);
  switch (type) {
    case 'icebreaker': {
      // Unseal every sibling typed entry in the same journal.
      if (!journal) return '';
      let unsealed = 0;
      for (const p of journal.pages.contents) {
        if (p.id === page?.id) continue;
        const f = p.flags?.[MODULE_ID];
        const c = f?.contentData;
        if (!c || !f.contentType) continue;
        const next = _unsealContentData(f.contentType, c);
        if (next) { await p.update({ [`flags.${MODULE_ID}.contentData`]: next }); unsealed++; }
      }
      return unsealed ? `${unsealed} file${unsealed === 1 ? '' : 's'} unsealed` : 'no sealed files found';
    }
    case 'skeletonKey': {
      const sec = game.nightcity?.securityService;
      const term = game.nightcity?.terminalService;
      if (hostItem && term?.isTerminal?.(hostItem)) {
        let cleared = 0;
        for (const acct of (term.getConfig(hostItem).accounts || [])) { sec?.resetAllForTarget?.(`${hostItem.id}::${acct.id}`); cleared++; }
        for (const iface of (term.getConfig(hostItem).connection?.interfaces || [])) sec?.resetAllForTarget?.(`${hostItem.id}::net::${iface.networkId}`);
        return `${cleared} account lock${cleared === 1 ? '' : 's'} cleared`;
      }
      if (hostItem) { sec?.resetAllForTarget?.(hostItem.id); return 'host lockout cleared'; }
      return '';
    }
    case 'scanner': {
      const term = game.nightcity?.terminalService;
      if (hostItem && term?.isTerminal?.(hostItem)) {
        const accts = term.getConfig(hostItem).accounts || [];
        const hidden = accts.filter(a => a.hidden).map(a => a.username || a.id);
        const gated = accts.filter(a => a.network?.restricted).length;
        const bits = [];
        if (hidden.length) bits.push(`hidden accounts: ${hidden.join(', ')}`);
        if (gated) bits.push(`${gated} off-net account${gated === 1 ? '' : 's'}`);
        return bits.length ? `SCAN — ${bits.join(' · ')}` : 'SCAN — no hidden objects detected';
      }
      // Shard host: count sealed/off-net sibling entries.
      const journal2 = page?.parent;
      let sealed = 0;
      for (const p of (journal2?.pages?.contents || [])) {
        const c = p.flags?.[MODULE_ID]?.contentData;
        if (c && (c.locked || c.declassify || (c.entries || []).some(e => e.encrypted))) sealed++;
      }
      return sealed ? `SCAN — ${sealed} sealed file${sealed === 1 ? '' : 's'} present` : 'SCAN — nothing hidden';
    }
    case 'jammer': {
      const term = game.nightcity?.terminalService;
      if (hostItem && term?.isTerminal?.(hostItem)) { await term.setUplink(hostItem, null); return 'uplink suppressed — host is LOCAL ONLY'; }
      return '';
    }
    case 'wipe': {
      // Soft-purge target entries to the GM recycle bin (§4g) — recoverable,
      // NEVER a hard delete. Targets sibling pages in the host journal by
      // messageId (authored in effect.params.messageIds). No targets = no-op,
      // so a misconfigured wipe can't nuke a whole mailbox.
      if (!journal) return '';
      const ids = Array.isArray(cd.effect?.params?.messageIds) ? cd.effect.params.messageIds : [];
      if (!ids.length) return 'nothing targeted to wipe';
      let wiped = 0;
      for (const id of ids) {
        const target = journal.pages.find(pg => pg.flags?.[MODULE_ID]?.messageId === id);
        if (!target || target.id === page?.id) continue; // never wipe the program itself
        if (await _quarantinePage(target, { host: hostItem, actor })) wiped++;
      }
      return wiped ? `${wiped} file${wiped === 1 ? '' : 's'} wiped — recoverable from the recycle bin` : 'targets not found';
    }
    case 'corrupt': {
      // The reversible sabotage — redact target sibling entries IN PLACE (design
      // §1). Recoverable via the existing DECLASSIFY roll (sets declassify:true +
      // a DV), NEVER removed. Only redactable types (document/dossier) can be
      // corrupted this way; others are honestly skipped (nothing to reverse into).
      if (!journal) return '';
      const ids = Array.isArray(cd.effect?.params?.messageIds) ? cd.effect.params.messageIds : [];
      if (!ids.length) return 'nothing targeted to corrupt';
      const dv = Number(cd.effect?.params?.declassifyDV) || 9;
      let done = 0, skipped = 0;
      for (const id of ids) {
        const target = journal.pages.find(pg => pg.flags?.[MODULE_ID]?.messageId === id);
        if (!target || target.id === page?.id) continue;   // never corrupt the program itself
        const f = target.flags?.[MODULE_ID];
        const next = _corruptContentData(f?.contentType, f?.contentData, dv);
        if (next) { await target.update({ [`flags.${MODULE_ID}.contentData`]: next }); done++; }
        else skipped++;
      }
      const bits = [];
      if (done) bits.push(`${done} file${done === 1 ? '' : 's'} corrupted — DECLASSIFY (DV ${dv}) to restore`);
      if (skipped) bits.push(`${skipped} skipped (no redactable content)`);
      return bits.join(' · ') || 'targets not found';
    }
    case 'forgeAccount': {
      // Write a hidden backdoor account on the host terminal (instant variant of
      // the triggered resident). Delegates to TerminalService (it owns accounts +
      // the 24h expiry + the runner cred whisper). No-op on a non-terminal host.
      const term = game.nightcity?.terminalService;
      if (!(hostItem && term?.isTerminal?.(hostItem))) return 'no terminal host for the backdoor';
      const res = await term.forgeBackdoorAccount(hostItem, { actor, params: cd.effect?.params || {} });
      return res?.success ? `forged backdoor "${res.username}" (${res.expiresLabel})` : `backdoor forge failed: ${res?.error || 'unknown'}`;
    }
    default: return cd?.description || ''; // adjudicate — GM handles it via the alert, with the GM's own words
  }
}

/** Verbs that need files picked on the target when they run. */
export const TARGETED_VERBS = Object.freeze(['wipe', 'corrupt']);

/**
 * Pick the files a Wipe or Corrupt goes after, on the host, when it runs. Lists what this operator can reach on that
 * host and never the program itself. @returns {Promise<string[]|null>} message ids; null = backed out
 */
export async function pickHostFiles(hostItem, { verb = 'wipe', accountId = null, excludeId = null } = {}) {
  const term = game.nightcity?.terminalService;
  const isTerm = term?.isTerminal?.(hostItem);
  const list = isTerm
    ? (accountId ? term.getAccountMessages(hostItem, accountId) : term.getAllMessages?.(hostItem)) || []
    : (game.nightcity?.dataShardService?.getShardMessages?.(hostItem) || []);
  const entries = list.filter((m) => (m.messageId ?? m.id) !== excludeId).map((m) => ({
    id: m.messageId ?? m.id, name: m.file?.name || m.subject || m.contentData?.name || 'file',
    img: 'icons/svg/book.svg', sub: m.contentType || 'message', group: m.envelope === 'file' ? 'Files' : 'Mail',
  }));
  if (!entries.length) { ncmNotify.warn('NCM | There is nothing here to go after.'); return null; }
  const picked = await showNamePicker({ title: verb === 'wipe' ? 'What should it wipe?' : 'What should it corrupt?', entries, multi: true, admin: false, doneLabel: verb === 'wipe' ? 'Wipe these' : 'Corrupt these', placeholder: 'search files…' });
  const ids = (Array.isArray(picked) ? picked : []).map((p) => p?.id ?? p).filter(Boolean);
  return ids.length ? ids : null;
}

/**
 * Redact-corrupt one typed entry's contentData IN PLACE (the `corrupt` verb).
 * The mirror-image of `_unsealContentData`'s declassify branch: it SETS the
 * redaction + `declassify:true` (+ a DV) so the existing DECLASSIFY roll reverses
 * it exactly. Returns a new contentData object, or null when the type has no
 * redactable content (documents use `paragraphs`, dossiers use `sections`).
 * @param {string} type @param {object} c @param {number} dv
 */
function _corruptContentData(type, c, dv) {
  if (!c) return null;
  let changed = false; const out = { ...c };
  if (Array.isArray(c.paragraphs) && c.paragraphs.some(p => p.text && !p.redacted)) {
    out.paragraphs = c.paragraphs.map(p => (p.text ? { ...p, redacted: true, declassified: false } : p));
    changed = true;
  }
  if (Array.isArray(c.sections) && c.sections.some(s => s.text && !s.redacted)) {
    out.sections = c.sections.map(s => (s.text ? { ...s, redacted: true, declassified: false } : s));
    changed = true;
  }
  if (!changed) return null;
  out.declassify = true;
  out.declassified = false;
  if (!Number(out.declassifyDV)) out.declassifyDV = Number(dv) || 9;
  return out;
}

// ═══════════════════════════════════════════════════════════
//  Recycle bin — the `wipe` quarantine (design §4g)
// ═══════════════════════════════════════════════════════════
//
//  A `wipe` never hard-deletes: the target page is moved verbatim into a
//  GM-owned world setting, and the owner sees it gone. Only the GM can
//  Restore-to-origin or Empty (the one true delete) — from the Admin Security
//  tab (thread #5). All GM-side (the setting + the page delete are GM-owned).

const RECYCLE_SETTING = 'recycleBin';

/**
 * Every quarantined (wiped) entry:
 * [{ id, ts, hostId, hostName, journalId, pageName, contentType, pageData, wipedBy, wipedByName }].
 */
export function getRecycleBin() {
  try { return game.settings.get(MODULE_ID, RECYCLE_SETTING) ?? []; }
  catch { return []; }
}

/** Move one page into the recycle bin, then delete it. GM-only. Returns true on success. */
async function _quarantinePage(page, { host = null, actor = null } = {}) {
  if (!isGM() || !page) return false;
  try {
    const journal = page.parent;
    const record = {
      id: `rb-${foundry.utils.randomID(8)}`,
      ts: _nowIso(),
      hostId: host?.id || null,
      hostName: host?.name || journal?.name || 'unknown host',
      journalId: journal?.id || null,
      pageName: page.name,
      contentType: page.flags?.[MODULE_ID]?.contentType || null,
      pageData: page.toObject(),          // full page incl. flags — restorable verbatim
      wipedBy: actor?.id || null,
      wipedByName: actor?.name || 'Unknown',
    };
    const bin = getRecycleBin().map(r => ({ ...r }));
    bin.push(record);
    await game.settings.set(MODULE_ID, RECYCLE_SETTING, bin);
    await page.delete();
    log.debug(`Recycle-bin: quarantined "${record.pageName}" from ${record.hostName}`);
    return true;
  } catch (err) { log.error(`Recycle-bin quarantine failed: ${err.message}`); return false; }
}

/** Restore a wiped entry to its origin journal (recreates the page). GM-only. */
export async function restoreWiped(recordId) {
  if (!isGM()) return false;
  const bin = getRecycleBin();
  const rec = bin.find(r => r.id === recordId);
  if (!rec) return false;
  try {
    const journal = rec.journalId ? game.journal?.get(rec.journalId) : null;
    if (!journal) { ncmNotify.warn('NCM | Origin journal is gone — cannot restore in place.'); return false; }
    await journal.createEmbeddedDocuments('JournalEntryPage', [rec.pageData]);
    await game.settings.set(MODULE_ID, RECYCLE_SETTING, bin.filter(r => r.id !== recordId));
    log.debug(`Recycle-bin: restored "${rec.pageName}" to ${journal.name}`);
    return true;
  } catch (err) { log.error(`Recycle-bin restore failed: ${err.message}`); return false; }
}

/** Permanently drop records from the recycle bin (all if ids omitted). GM-only — the one true delete. */
export async function emptyRecycleBin(ids = null) {
  if (!isGM()) return;
  const next = Array.isArray(ids) ? getRecycleBin().filter(r => !ids.includes(r.id)) : [];
  await game.settings.set(MODULE_ID, RECYCLE_SETTING, next);
  log.debug(`Recycle-bin: emptied ${Array.isArray(ids) ? ids.length + ' record(s)' : 'all'}`);
}

/** Reverse a reversible timed effect on expiry/kill (only jammer restores). */
async function _reversePayloadEffect(type, hostItem) {
  if (type !== 'jammer' || !hostItem) return;
  const term = game.nightcity?.terminalService;
  if (term?.isTerminal?.(hostItem)) {
    try { await term.setUplink(hostItem, '__DEFAULT__'); } catch (err) { log.warn(`Jammer restore failed: ${err.message}`); }
  }
}

/**
 * Unseal one typed entry's contentData for the icebreaker effect. Returns a new
 * contentData object if anything changed, else null. Mirrors the reveals from
 * runContentUnlock/runCrack but applied wholesale, GM-side.
 */
function _unsealContentData(type, c) {
  let changed = false; const out = { ...c };
  if (Array.isArray(c.images) && c.images.some(i => i.locked)) { out.images = c.images.map(i => (i.locked ? { ...i, locked: false } : i)); changed = true; }
  if (c.locked) { out.locked = false; changed = true; }
  if (Array.isArray(c.entries) && c.entries.some(e => e.encrypted && !e.cracked)) { out.entries = c.entries.map(e => (e.encrypted ? { ...e, cracked: true } : e)); changed = true; }
  if (c.declassify) {
    if (Array.isArray(c.paragraphs) && c.paragraphs.some(p => p.redacted)) { out.paragraphs = c.paragraphs.map(p => (p.redacted ? { ...p, redacted: false, declassified: true } : p)); out.declassified = true; changed = true; }
    if (Array.isArray(c.sections) && c.sections.some(s => s.redacted)) { out.sections = c.sections.map(s => (s.redacted ? { ...s, redacted: false, declassified: true } : s)); out.declassified = true; changed = true; }
    if (Array.isArray(c.redacted) && c.redacted.length) { out.redacted = []; out.declassified = true; changed = true; }
  }
  return changed ? out : null;
}
