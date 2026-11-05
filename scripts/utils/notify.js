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

/**
 * Text for a `data-tooltip="…"` attribute written into an HTML STRING (audit SEC-16).
 *
 * Foundry 12 shows tooltips with `tooltip.innerHTML = element.dataset.tooltip`
 * (foundry.js, TooltipManager#activate) — there is no plain-text mode. The browser
 * decodes the attribute once, then Foundry parses the result as HTML. So text
 * must be escaped TWICE: once for the attribute, once for the tooltip. That shows
 * every value exactly as written (`R&D`, `<b>` and all), and a name containing
 * markup appears as text instead of running.
 *
 * For a tooltip that is deliberately HTML (built with escapeHtml'd parts), escape
 * the finished HTML once with escapeHtml instead. For `el.dataset.tooltip = …`
 * (no attribute decoding), use escapeHtml once. In templates: {{ncm-tip value}}.
 * @param {*} value
 * @returns {string}
 */
export function tipText(value) {
  return escapeHtml(escapeHtml(value));
}

/** Handlebars' trailing options object (every helper call receives one last). */
const isHbsOptions = (o) => !!o && typeof o === 'object' && 'hash' in o && ('data' in o || 'name' in o || 'loc' in o);

/** Schemes a CSS background image may use. A data URI must be an image. */
const CSS_URL_SCHEMES = new Set(['http', 'https', 'blob']);

/**
 * A picture path for the inside of a quoted CSS `url('…')` (audit SEC-23).
 *
 * Handlebars turns `'` into `&#x27;`, but the browser decodes that back before
 * the CSS is read, so `url('{{img}}')` with `x');position:fixed;…` in the path
 * closed the string and added rules. This returns '' for anything that is not a
 * relative path, an http(s)/blob URL or a data:image URI, and CSS-escapes the
 * characters that end a string or a url() (quotes, backslash, brackets, line
 * breaks). The result has no HTML-special characters of its own; HTML-escape it
 * as usual where it goes into an attribute (templates do that by themselves).
 * In templates: url('{{ncm-css-url img}}').
 * @param {*} value
 * @returns {string}
 */
export function cssUrl(value) {
  const raw = String(value ?? '').trim();
  const probe = raw.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, '');
  if (!probe) return '';
  const head = probe.split(/[/?#]/)[0];
  if (head.includes(':')) {
    const scheme = head.slice(0, head.indexOf(':')).toLowerCase();
    if (!CSS_URL_SCHEMES.has(scheme) && !(scheme === 'data' && /^data:image\//i.test(probe))) return '';
  }
  return raw.replace(/[\\'"()\u0000-\u001f\u007f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
}

/**
 * Register the escaping helpers every NCM template uses:
 *   {{ncm-tip value}}     — escapes once and returns a plain string, which Handlebars
 *                           escapes again, so the attribute holds tipText's double escape.
 *   {{ncm-css-url value}} — cssUrl(), for url('…') inside a style attribute.
 * Called by registerTemplates, and by the sims and previews that render real templates.
 * @param {object} Handlebars
 */
export function registerTipHelper(Handlebars) {
  Handlebars.registerHelper('ncm-tip', (value, options) => (isHbsOptions(value) && options === undefined ? '' : escapeHtml(value)));
  Handlebars.registerHelper('ncm-css-url', (value, options) => (isHbsOptions(value) && options === undefined ? '' : cssUrl(value)));
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
