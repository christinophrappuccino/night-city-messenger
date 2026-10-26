/**
 * Shard Market — what a player-made shard is worth, and who decides.
 * @file scripts/ui/ShardEncoder/ShardMarket.js
 * @module night-city-messenger
 * @description The Encoder's last beat. A player who just forged something can put a
 *   price on it; the GM's `pricing` mode decides how much say they have:
 *
 *     off      no pricing at all — the section never renders
 *     propose  the player names a figure, the GM approves / counters / denies, and ONLY
 *              then does it land on the item (the dev's locked decision)
 *     free     the player sets it outright (a trusted table)
 *     formula  it is priced automatically from the blank + the DV + the quality
 *
 *   The write itself is always the GM's: `system.price.market` lives on a world item a
 *   player may not own, so `propose` relays through `SHARD_PRICE_REQUEST` and the GM's
 *   own client performs the update. A player can therefore never price their own work
 *   past their GM — the mode is enforced where the write happens, not in the UI.
 */

import { MODULE_ID, SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM, whisperCardHtml } from '../../utils/helpers.js';
import { suggestedPrice } from '../content/EncoderModel.js';
import { shardTerm as T } from '../../utils/shardTerm.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Write the price. GM-only by construction — every path funnels here. */
export async function applyShardPrice(item, price) {
  if (!item || !isGM()) return false;
  const eb = Math.max(0, Math.round(Number(price) || 0));
  try {
    await item.update({ 'system.price.market': eb });
    await item.setFlag(MODULE_ID, 'playerPriced', { at: new Date().toISOString(), price: eb });
    return true;
  } catch (err) {
    log.error('ShardMarket: could not write the price', err);
    return false;
  }
}

/**
 * The GM's side of a proposal: a card with the three answers. Counter re-prompts for a
 * figure. Whatever is decided, the player is told — silence would read as a bug.
 * @returns {Promise<{decision:'approved'|'countered'|'denied', price:number}>}
 */
export async function promptShardPrice({ item, actorName, askedFor, quality, outcome }) {
  const { adminDialog } = await import('../../utils/adminTheme.js');
  return new Promise((resolve) => {
    let done = null;
    const dlg = adminDialog({
      title: 'A player is pricing something they made',
      content: `
        <div style="font:12.5px/1.6 var(--ncm-font-body,sans-serif);color:var(--ncm-text-primary,#e8f4f8)">
          <p><b>${esc(actorName)}</b> wants to list <b>${esc(item?.name || 'a shard')}</b> at
             <b style="color:var(--ncm-accent,#f7c948)">${Math.round(askedFor)} eb</b>.</p>
          <p style="color:var(--ncm-text-secondary,#9fb3c0)">They made it themselves — a
             <b>${esc(outcome)}</b> job, quality ${Math.round(quality)}%.
             Nothing is written to the item unless you say so.</p>
          <label style="display:block;margin-top:10px;font:700 9px var(--ncm-font-display,sans-serif);letter-spacing:.06em;text-transform:uppercase;color:var(--ncm-text-muted,#7a8b99)">Your figure</label>
          <input type="number" name="counter" value="${Math.round(askedFor)}" min="0"
                 style="width:120px;text-align:right;padding:4px 6px;background:var(--ncm-bg-deep,#0a0f14);border:1px solid var(--ncm-border,#2a3a47);border-radius:2px;color:var(--ncm-text-primary,#e8f4f8)">
          <span style="color:var(--ncm-accent,#f7c948);font:700 11px var(--ncm-font-mono,monospace)"> eb</span>
        </div>`,
      buttons: {
        approve: {
          icon: '<i class="fas fa-check"></i>', label: 'Approve',
          callback: () => { done = { decision: 'approved', price: Math.round(askedFor) }; },
        },
        counter: {
          icon: '<i class="fas fa-scale-balanced"></i>', label: 'Counter',
          callback: (html) => {
            const el = (html[0] ?? html).querySelector('[name="counter"]');
            done = { decision: 'countered', price: Math.max(0, Math.round(Number(el?.value) || 0)) };
          },
        },
        deny: {
          icon: '<i class="fas fa-xmark"></i>', label: 'Deny',
          callback: () => { done = { decision: 'denied', price: 0 }; },
        },
      },
      default: 'approve',
      // Closing the window without choosing is a DENY, never a silent approval.
      close: () => resolve(done || { decision: 'denied', price: 0 }),
    }, { width: 460 });
    dlg.render(true);
  });
}

/** GM-side handler for a relayed proposal. Registered in SocketHandlers. */
export async function handleShardPriceRequest(data) {
  if (!isGM()) return;
  const { requestId, userId, itemId, actorId, price, quality, outcome } = data || {};
  const actor = game.actors?.get(actorId);
  const item = actor?.items?.get(itemId) || game.items?.get(itemId);
  const sm = game.nightcity?.socketManager;
  if (!item) {
    sm?.emit(SOCKET_OPS.SHARD_PRICE_RESULT, { requestId, userId, decision: 'denied', price: 0, reason: 'the shard could not be found' });
    return;
  }
  const verdict = await promptShardPrice({
    item, actorName: actor?.name || 'A player', askedFor: price, quality, outcome,
  });
  if (verdict.decision !== 'denied') await applyShardPrice(item, verdict.price);
  sm?.emit(SOCKET_OPS.SHARD_PRICE_RESULT, { requestId, userId, ...verdict });
}

/**
 * Ask for a price. Resolves with what actually happened, so the window can tell the
 * player the truth rather than assuming a yes.
 * @returns {Promise<{decision:string, price:number}>}
 */
export function requestShardPrice({ item, actor, price, quality, outcome }) {
  if (isGM()) {
    // A GM pricing their own test shard does not need to ask themselves.
    return applyShardPrice(item, price).then((ok) => ({ decision: ok ? 'approved' : 'denied', price }));
  }
  const sm = game.nightcity?.socketManager;
  if (!sm) return Promise.resolve({ decision: 'denied', price: 0 });
  if (!game.users?.activeGM) {
    ui.notifications?.warn('NCM | No GM is connected, so nobody can approve a price yet.');
    return Promise.resolve({ decision: 'nogm', price: 0 });
  }
  return new Promise((resolve) => {
    const requestId = foundry.utils.randomID(8);
    let settled = false;
    const handler = (res) => {
      if (res?.requestId !== requestId || res?.userId !== game.user.id || settled) return;
      settled = true;
      resolve({ decision: res.decision, price: res.price });
    };
    sm.register(SOCKET_OPS.SHARD_PRICE_RESULT, handler);
    sm.emit(SOCKET_OPS.SHARD_PRICE_REQUEST, {
      requestId, userId: game.user.id, itemId: item.id, actorId: actor?.id,
      price, quality, outcome,
    });
    // A GM who never answers must not leave the window waiting forever.
    setTimeout(() => { if (!settled) { settled = true; resolve({ decision: 'pending', price: 0 }); } }, 120000);
  });
}

/** Tell the GM, in the log, what a player put on the market. */
export function announceShardPrice({ actorName, itemName, price, decision }) {
  try {
    const tone = decision === 'approved' ? 'ok' : decision === 'countered' ? 'info' : 'warn';
    ChatMessage.create({
      whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
      content: whisperCardHtml({
        tone, icon: 'fa-tag', title: `${T('short')} priced`,
        lines: [
          `<b>${esc(actorName)}</b> listed <b>${esc(itemName)}</b>.`,
          decision === 'denied' ? 'You denied the price; nothing was written.'
            : `It now carries <b>${Math.round(price)} eb</b>${decision === 'countered' ? ' (your counter)' : ''}.`,
        ],
      }),
    });
  } catch (err) { log.debug('ShardMarket: could not post the notice', err); }
}

/** The figure the Encoder suggests, given the blank and what the roll bought. */
export function suggestFor({ blankPrice, dv, quality, outcome }) {
  const s = suggestedPrice({ blankPrice, dv });
  if (outcome === 'sloppy') return s.sloppy;
  const q = Math.max(0.4, Math.min(1.2, (Number(quality) || 50) / 80));
  return Math.round(s.clean * q);
}
