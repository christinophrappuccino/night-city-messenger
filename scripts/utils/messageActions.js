/**
 * Message actions (API v2 2.3.0): other modules can put buttons under a message in the inbox, and can decide whether
 * the quick-reply box shows for a message. NCM itself registers nothing here; it only draws what modules give it.
 * @file scripts/utils/messageActions.js
 * @module night-city-messenger
 * @description A provider is a function (message, context) => actions | null, called each time a message is shown.
 *   message: { id, threadId, subject, from, fromActorId, fromContactId, toActorId, toContactId, timestamp, read, sent }
 *   context: { actorId (whose inbox), isGM }
 *   An action: { label, icon? ('fa-…'), tooltip?, primary?, disabled?, run: () => any }. A provider can also return
 *   { actions, note } to add a short line of text above its buttons. A quick-reply rule is (message, context) =>
 *   true | false | undefined: false hides the quick-reply box for that message (any rule saying false wins).
 *   Errors in a provider are caught and logged; they never break the inbox.
 */

import { tipText } from './notify.js';

const providers = new Map();
const replyRules = new Map();
let seq = 0;
const key = (id, p) => (typeof id === 'string' && id.trim() ? id.trim().slice(0, 60) : `${p}${++seq}`);
const icon = (v) => (/^fa-[a-z0-9-]+$/.test(v || '') ? v : '');
const text = (v, n) => String(v ?? '').slice(0, n);

/** @returns {string} the id it's registered under (registering the same id again replaces it) */
export function addActionProvider(fn, id) { if (typeof fn !== 'function') throw new Error('A provider must be a function.'); const k = key(id, 'act'); providers.set(k, fn); return k; }
export function removeActionProvider(id) { return providers.delete(id); }
export function addQuickReplyRule(fn, id) { if (typeof fn !== 'function') throw new Error('A rule must be a function.'); const k = key(id, 'qr'); replyRules.set(k, fn); return k; }
export function removeQuickReplyRule(id) { return replyRules.delete(id); }

/** What a module sees of a message: ids and headers, never the body. */
export function messageView(m) {
  if (!m) return null;
  return { id: m.messageId ?? m.id ?? null, threadId: m.threadId ?? null, subject: m.subject ?? '', from: m.from ?? '', fromActorId: m.fromActorId ?? null, fromContactId: m.fromContactId ?? null,
    toActorId: m.toActorId ?? null, toContactId: m.toContactId ?? null, timestamp: m.timestamp ?? null, read: !!m.status?.read, sent: !!(m.isSent || m.status?.sent) };
}

function collect(msg, ctx) {
  const out = [];
  for (const [k, fn] of providers) {
    let r; try { r = fn(msg, ctx); } catch (err) { console.warn(`night-city-messenger | message actions "${k}"`, err); continue; }
    if (!r) continue;
    const list = Array.isArray(r) ? r : Array.isArray(r.actions) ? r.actions : [];
    const note = !Array.isArray(r) && r.note ? text(r.note, 240) : '';
    const actions = list.filter((a) => a && a.label && typeof a.run === 'function').slice(0, 6).map((a, i) => ({ id: `${k}:${i}`, label: text(a.label, 60), icon: icon(a.icon), tooltip: text(a.tooltip, 200), primary: !!a.primary, disabled: !!a.disabled, run: a.run }));
    if (actions.length || note) out.push({ k, note, actions });
  }
  return out;
}
export function quickReplyShown(msg, ctx) {
  for (const [k, fn] of replyRules) { try { if (fn(msg, ctx) === false) return false; } catch (err) { console.warn(`night-city-messenger | quick-reply rule "${k}"`, err); } }
  return true;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Draw the actions for the shown message under its action bar, and hide the quick reply if a rule says so.
 * @param {HTMLElement} root the viewer's element @param {object} message the enriched message @param {object} ctx
 */
export function paintMessageActions(root, message, ctx) {
  root?.querySelectorAll('.ncm-viewer__ext-actions').forEach((n) => n.remove());
  if (!root || !message) return;
  const msg = messageView(message);
  const qr = root.querySelector('.ncm-viewer__quick-reply'); if (qr) qr.hidden = !quickReplyShown(msg, ctx);
  const groups = collect(msg, ctx); if (!groups.length) return;
  const host = document.createElement('div'); host.className = 'ncm-viewer__ext-actions';
  host.innerHTML = groups.map((g) => `<div class="ncm-viewer__ext-group" data-provider="${esc(g.k)}">${g.note ? `<div class="ncm-viewer__ext-note">${esc(g.note)}</div>` : ''}<div class="ncm-viewer__ext-row">${g.actions.map((a) => `<button type="button" class="ncm-btn ${a.primary ? 'ncm-btn--primary' : 'ncm-btn--secondary'} ncm-btn--sm" data-ext-action="${esc(a.id)}"${a.disabled ? ' disabled' : ''}${a.tooltip ? ` data-tooltip="${tipText(a.tooltip)}"` : ''}>${a.icon ? `<i class="fas ${a.icon}"></i> ` : ''}${esc(a.label)}</button>`).join('')}</div></div>`).join('');
  const run = new Map(groups.flatMap((g) => g.actions.map((a) => [a.id, a.run])));
  host.addEventListener('click', async (e) => { const b = e.target.closest('[data-ext-action]'); if (!b || b.disabled) return; b.disabled = true; try { await run.get(b.dataset.extAction)?.(); } catch (err) { console.warn('night-city-messenger | message action', err); } finally { b.disabled = false; } });
  const bar = root.querySelector('.ncm-viewer__detail-actions'); if (bar) bar.after(host); else (qr || root.querySelector('.ncm-viewer__detail'))?.append(host);
}

/** Redraw the open inboxes (a module's actions changed: a choice was picked, a rule changed). */
export function refreshViewers() {
  const apps = globalThis.foundry?.applications?.instances; if (!apps) return 0; let n = 0;
  for (const app of apps.values()) if (app?.constructor?.name === 'MessageViewerApp' && app.rendered) { app.render(); n++; }
  return n;
}
