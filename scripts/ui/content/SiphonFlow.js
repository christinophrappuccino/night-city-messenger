/**
 * SiphonFlow — typed-content action flows (design doc §8c).
 * @file scripts/ui/content/SiphonFlow.js
 * @module cyberpunkred-messenger
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

import { MODULE_ID, SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';

const DEFAULT_SIPHON_SKILL = 'Interface';
const DEFAULT_SIPHON_DV = 15;
const DEFAULT_CRACK_SKILL = 'Interface';
const DEFAULT_CRACK_DV = 15;

/** Max siphonable amount for the account's configured mode. */
export function computeMaxSiphon(banking = {}) {
  const bal = Math.max(0, Number(banking.balance) || 0);
  switch (banking.siphonMode) {
    case 'full': return bal;
    case 'percent': return Math.floor(bal * (Number(banking.siphonPercent) || 25) / 100);
    case 'cap':
    default: {
      const cap = Number(banking.siphonCap);
      return cap > 0 ? Math.min(bal, cap) : bal;
    }
  }
}

/**
 * Run the full siphon flow against a banking entry's RAW contentData.
 * @param {object} args
 * @param {Actor}  args.actor      the player's character (the thief)
 * @param {object} args.raw        the banking entry's raw contentData
 * @param {string} args.itemUuid   the shard/terminal item uuid (for the relay)
 * @param {string} args.messageId  the entry/message id (the journal page)
 */
export async function runSiphon({ actor, raw, itemUuid, messageId }) {
  const banking = raw || {};
  if (banking.siphoned) { ui.notifications.warn('NCM | This account is already drained.'); return; }

  const currency = banking.currency || '€$';
  const accountLabel = banking.accountName || banking.bankName || 'account';
  const max = computeMaxSiphon(banking);
  if (max <= 0) { ui.notifications.warn('NCM | Nothing to siphon from this account.'); return; }

  const amount = await _promptAmount(max, currency, accountLabel);
  if (!amount) return; // cancelled or 0

  const skill = banking.siphonSkill || DEFAULT_SIPHON_SKILL;
  const dv = Number(banking.siphonDV) || DEFAULT_SIPHON_DV;
  const skillSvc = game.nightcity?.skillService;
  if (!skillSvc) { ui.notifications.error('NCM | Skill service unavailable.'); return; }

  const roll = await skillSvc.performCheck(actor, skill, {
    dc: dv, showChat: true,
    context: `Siphon: ${accountLabel}`,
    flavor: `Account Siphon // DV ${dv}`,
  });

  const sound = game.nightcity?.soundService;
  if (roll?.success) {
    await _creditWealth(actor, amount, `NCM: Siphoned ${amount.toLocaleString()} eb from ${accountLabel}`);
    const newCD = _applyDrain(banking, amount, actor);
    await _persistSiphon({ outcome: 'success', itemUuid, messageId, newContentData: newCD, amount, currency, actorName: actor.name, accountLabel });
    sound?.play('shard-decrypt');
    ui.notifications.info(`NCM | Siphoned ${amount.toLocaleString()} ${currency} from ${accountLabel}.`);
  } else {
    sound?.play('hack-fail');
    game.nightcity?.notificationService?.showShardTrace?.({ itemName: accountLabel });
    await _persistSiphon({ outcome: 'fail', itemUuid, messageId, amount, currency, actorName: actor.name, accountLabel });
    ui.notifications.warn(`NCM | Siphon failed — trace fired (rolled ${roll?.total ?? '?'} vs DV ${dv}).`);
  }
}

/** Minimal HTML escape for interpolated dialog strings. */
function _esc(s) { return Handlebars.escapeExpression(String(s ?? '')); }

/** Amount picker dialog. Resolves a clamped integer, or null on cancel/0. */
function _promptAmount(max, currency, label) {
  return new Promise(resolve => {
    let chosen = null;
    new Dialog({
      title: 'Siphon Funds',
      content: `
        <div style="font-family:var(--ncm-font-body,sans-serif);color:var(--ncm-text-secondary,#bdbdd0)">
          <p style="margin:0 0 8px">Transfer from <b>${_esc(label)}</b> to your account.
          Max <b>${max.toLocaleString()} ${_esc(currency)}</b>.</p>
          <p style="margin:0 0 4px;font-size:11px;opacity:.8">A security check fires on transfer — fail and a trace is logged.</p>
          <input type="number" name="amt" min="1" max="${max}" value="${max}" style="width:100%;padding:6px;background:#0a0a0f;color:#ededf0;border:1px solid #2a2a45;border-radius:4px">
        </div>`,
      buttons: {
        go: {
          icon: '<i class="fas fa-hand-holding-dollar"></i>', label: 'Attempt Siphon',
          callback: html => {
            const v = Math.floor(Number(html.find('input[name="amt"]').val()) || 0);
            chosen = Math.max(0, Math.min(max, v)) || null;
          },
        },
        cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
      },
      default: 'go',
      close: () => resolve(chosen),
    }).render(true);
  });
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

/** Build the drained contentData: lower balance, prepend a txn, lock it. */
function _applyDrain(banking, amount, actor) {
  const newBal = (Number(banking.balance) || 0) - amount;
  const iso = game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString();
  const d = new Date(iso);
  const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
  const txn = { date, desc: `Siphoned by ${actor.name}`, amount, type: 'debit', category: 'flagged' };
  return { ...banking, balance: newBal, siphoned: true, transactions: [txn, ...(banking.transactions || [])] };
}

/** Persist the outcome — GM applies directly, players relay. */
async function _persistSiphon(payload) {
  if (isGM()) {
    if (payload.outcome === 'success') await applySiphonToJournal(payload.messageId, payload.newContentData);
    _alertGM(payload);
  } else {
    game.nightcity?.socketManager?.emit(SOCKET_OPS.BANK_SIPHON_REQUEST, { ...payload, userId: game.user.id });
  }
}

/** GM-side toast for the consequence feed. */
function _alertGM(p) {
  if (p.outcome === 'success') {
    ui.notifications.warn(`NCM | SIPHON: ${p.actorName} drained ${Number(p.amount).toLocaleString()} ${p.currency} from ${p.accountLabel}.`);
  } else {
    ui.notifications.warn(`NCM | SIPHON TRACE: ${p.actorName} failed to breach ${p.accountLabel} — trace fired.`);
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
  let page = null;
  for (const j of game.journal) {
    const p = j.pages.find(pg => pg.flags?.[MODULE_ID]?.messageId === messageId);
    if (p) { page = p; break; }
  }
  if (!page) { log.warn(`Siphon: no journal page for messageId ${messageId}`); return false; }
  try {
    await page.update({ [`flags.${MODULE_ID}.contentData`]: newContentData });
    return true;
  } catch (err) {
    log.error(`Siphon persist failed: ${err.message}`);
    return false;
  }
}

/** GM-side socket handler body for BANK_SIPHON_REQUEST. */
export async function handleSiphonRequest(data) {
  if (!isGM()) return;
  if (data.outcome === 'success') await applySiphonToJournal(data.messageId, data.newContentData);
  _alertGM(data);
}

// ═══════════════════════════════════════════════════════════
//  Generic contentData persistence (claims / cracks / future actions)
// ═══════════════════════════════════════════════════════════

/**
 * Persist a typed entry's new contentData — GM writes the journal page
 * directly, players relay via SOCKET_OPS.CONTENT_UPDATE_REQUEST. `gmToast`
 * (optional) surfaces the consequence on the GM's screen either way.
 */
export async function persistContentData(messageId, newContentData, gmToast = '') {
  if (isGM()) {
    const ok = await applySiphonToJournal(messageId, newContentData);
    if (ok && gmToast) ui.notifications.info(gmToast);
    return ok;
  }
  game.nightcity?.socketManager?.emit(SOCKET_OPS.CONTENT_UPDATE_REQUEST, {
    messageId, newContentData, gmToast, userId: game.user.id,
  });
  return true;
}

/** GM-side socket handler body for CONTENT_UPDATE_REQUEST. */
export async function handleContentUpdateRequest(data) {
  if (!isGM()) return;
  await applySiphonToJournal(data.messageId, data.newContentData);
  if (data.gmToast) ui.notifications.info(data.gmToast);
}

// ═══════════════════════════════════════════════════════════
//  Eddies claim (shared shard + terminal)
// ═══════════════════════════════════════════════════════════

/**
 * Claim an eddies entry into a character's wealth ledger.
 * @param {object} args { actor, raw: eddies contentData, messageId, sourceLabel }
 * @returns {{success:true, amount:number}|null}
 */
export async function runEddiesClaim({ actor, raw, messageId, sourceLabel = 'data entry' }) {
  const cd = raw || {};
  if (cd.claimed) { ui.notifications.warn('NCM | These eddies were already claimed.'); return null; }
  const amount = Number(cd.amount) || 0;
  if (amount <= 0) { ui.notifications.warn('NCM | No eddies to claim.'); return null; }

  const confirm = await Dialog.confirm({
    title: 'Claim Eddies',
    content: '<p>Transfer these eddies to your account? This cannot be undone.</p>',
  });
  if (!confirm) return null;

  await _creditWealth(actor, amount, `NCM: Claimed ${amount.toLocaleString()} eb from ${sourceLabel}`);
  const iso = game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString();
  await persistContentData(messageId,
    { ...cd, claimed: true, claimedBy: actor.id, claimedAt: new Date(iso).toISOString() },
    `NCM | ${actor.name} claimed ${amount.toLocaleString()} eb (${sourceLabel}).`);
  game.nightcity?.soundService?.play('eddies-claim');
  ui.notifications.info(`NCM | ${amount.toLocaleString()} eb deposited to ${actor.name}'s ledger.`);
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
export async function runCrack({ actor, raw, entryIndex, messageId, force = false }) {
  const entries = raw?.entries || [];
  const e = entries[entryIndex];
  if (!e || !e.encrypted || e.cracked) return false;
  const host = e.host || 'host';

  if (!force) {
    if (!actor) { ui.notifications.warn('NCM | No character assigned.'); return false; }
    const skill = e.crackSkill || raw.crackSkill || DEFAULT_CRACK_SKILL;
    const dv = Number(e.crackDV ?? raw.crackDV) || DEFAULT_CRACK_DV;
    const skillSvc = game.nightcity?.skillService;
    if (!skillSvc) { ui.notifications.error('NCM | Skill service unavailable.'); return false; }
    const roll = await skillSvc.performCheck(actor, skill, {
      dc: dv, showChat: true, context: `Crack: ${host}`, flavor: `Credential Crack // DV ${dv}`,
    });
    if (!roll?.success) {
      game.nightcity?.soundService?.play('hack-fail');
      ui.notifications.warn(`NCM | Crack failed (rolled ${roll?.total ?? '?'} vs DV ${dv}).`);
      return false;
    }
  }

  const newEntries = entries.map((x, i) => (i === entryIndex ? { ...x, cracked: true } : x));
  await persistContentData(messageId, { ...raw, entries: newEntries },
    `NCM | ${actor?.name || 'GM'} cracked the ${host} credentials.`);
  game.nightcity?.soundService?.play('shard-decrypt');
  ui.notifications.info(`NCM | Credentials cracked — the ${host} key is exposed.`);
  return true;
}
