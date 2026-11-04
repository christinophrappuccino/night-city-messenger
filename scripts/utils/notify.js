/**
 * Safe toasts + HTML escaping (audit remediation A4a, finding SEC-03).
 * @file scripts/utils/notify.js
 * @module night-city-messenger
 *
 * Foundry 12's Notifications class does NOT escape: `fetch()` builds each toast
 * as `$(\`<li …>${message}…</li>\`)` (client/ui/notifications.js), so any text
 * shown through `ui.notifications.*` is parsed as HTML. A character or item
 * named `<img src=x onerror=…>` would run script on whoever sees the toast —
 * often the GM.
 *
 * No NCM toast uses markup (checked when this was written: 1,088 calls, none
 * with a tag), so every NCM toast is escaped WHOLE. That changes nothing a user
 * sees — escaped `&`, `<`, `>` render as themselves — and covers every value
 * that reaches a toast: template interpolations, error strings, names.
 *
 * Rules (sim: dev/tools/sims/test-safe-html.mjs):
 *   - module code calls `ncmNotify.info/warn/error/notify`, never
 *     `ui.notifications.*` directly;
 *   - code that is GENERATED as a string for a user macro (accessPoints.js)
 *     still says `ui.notifications`, because NCM's imports do not exist there.
 *
 * This file has no imports on purpose: it is imported almost everywhere.
 */

/**
 * Escape text for an HTML element body or a double/single-quoted attribute.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Text-content escaping for toasts (quotes need no escaping inside an element body). */
function toastText(value) {
  return String(value ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function show(kind, message, options) {
  const n = globalThis.ui?.notifications;
  if (!n) return undefined;
  let text = message;
  let opts = options;
  // Foundry's own `localize` option resolves an i18n key first; do that here so
  // the key, not the escaped result, is what gets looked up.
  if (opts?.localize) {
    text = globalThis.game?.i18n?.localize?.(text) ?? text;
    opts = { ...opts, localize: false };
  }
  return n[kind](toastText(text), opts);
}

/**
 * Drop-in replacement for `ui.notifications` inside NCM. Same method names and
 * return values (the notification id); the message is escaped first.
 */
export const ncmNotify = Object.freeze({
  info: (message, options) => show('info', message, options),
  warn: (message, options) => show('warn', message, options),
  error: (message, options) => show('error', message, options),
  notify: (message, type = 'info', options) => {
    const n = globalThis.ui?.notifications;
    if (!n) return undefined;
    let text = message;
    let opts = options;
    if (opts?.localize) { text = globalThis.game?.i18n?.localize?.(text) ?? text; opts = { ...opts, localize: false }; }
    return n.notify(toastText(text), type, opts);
  },
});
