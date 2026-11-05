/**
 * Register Templates & Handlebars Helpers
 * @file scripts/init/registerTemplates.js
 * @module night-city-messenger
 * @description Preloads Handlebars templates and registers custom helpers.
 *              All comparison/logic helpers work as BOTH:
 *                - Block helpers:    {{#eq a b}}yes{{else}}no{{/eq}}
 *                - Subexpressions:   {{#if (eq a b)}}yes{{/if}}
 */

import { TEMPLATES, MODULE_ID } from '../utils/constants.js';
import { log, formatCyberDate, truncate } from '../utils/helpers.js';
import { registerTipHelper } from '../utils/notify.js';
import { registerShardTermHelper } from '../utils/shardTerm.js';
import { registerTagHueHelper, setRoleColorResolver } from '../utils/tagHue.js';

/**
 * Check if the last argument is a Handlebars options object (block mode)
 * vs a plain value (subexpression mode).
 */
function _isBlock(options) {
  return options && typeof options === 'object' && typeof options.fn === 'function';
}

/** Handlebars' trailing options argument (every helper call gets one, block or subexpression). */
function _isOptions(o) {
  return !!o && typeof o === 'object' && 'hash' in o && ('data' in o || 'name' in o || 'loc' in o);
}

export function registerTemplates(initializer) {
  // Synchronous (audit COMPAT-01): the helpers register now and the template fetch is STARTED, not awaited.
  // Awaiting ~110 fetches here held every later init task (settings, the canvas layer, keybindings, the
  // enricher) behind the network, and on a slow host they landed after Foundry's init had finished — the
  // keybindings then threw. The returned promise is part of `initDone`, which the ready phase waits for.
  initializer.register('preInit', 20, 'Template preloading', () => {
    // ─── Comparison Helpers (block + subexpression safe) ───

    Handlebars.registerHelper('eq', function (a, b, options) {
      const result = a === b;
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    Handlebars.registerHelper('neq', function (a, b, options) {
      const result = a !== b;
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    Handlebars.registerHelper('gt', function (a, b, options) {
      const result = a > b;
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    Handlebars.registerHelper('lt', function (a, b, options) {
      const result = a < b;
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    Handlebars.registerHelper('gte', function (a, b, options) {
      const result = a >= b;
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    Handlebars.registerHelper('lte', function (a, b, options) {
      const result = a <= b;
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    // ─── Logic Helpers (block + subexpression safe) ───

    // These REPLACE Foundry's own and/or for every template in the game (Foundry's token HUD among them), so they must
    // drop Handlebars' trailing options object EVERY time, block or not. The old versions only dropped it for a block, so
    // a subexpression `(or a b)` also counted the options object, which is always truthy: `(or locked …)` came out true
    // and the token HUD's elevation box rendered disabled for everyone (testers 2026-11-03, v2.0.7).
    Handlebars.registerHelper('and', function (...args) {
      const options = _isOptions(args[args.length - 1]) ? args.pop() : null;
      const result = args.every(Boolean);
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    Handlebars.registerHelper('or', function (...args) {
      const options = _isOptions(args[args.length - 1]) ? args.pop() : null;
      const result = args.some(Boolean);
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    Handlebars.registerHelper('not', function (val, options) {
      const result = !val;
      if (_isBlock(options)) return result ? options.fn(this) : options.inverse(this);
      return result;
    });

    // ─── Utility Helpers ───

    Handlebars.registerHelper('ncm-date', (timestamp) => formatCyberDate(timestamp));

    Handlebars.registerHelper('ncm-truncate', (str, len) => {
      return truncate(str, typeof len === 'number' ? len : 50);
    });

    Handlebars.registerHelper('truncate', function (str, len) {
      if (!str) return '';
      if (str.length <= len) return str;
      return str.substring(0, len) + '…';
    });

    Handlebars.registerHelper('substring', (str, start, end) => {
      if (!str) return '';
      return String(str).substring(start, end);
    });

    Handlebars.registerHelper('lower', (str) => (str || '').toLowerCase());
    Handlebars.registerHelper('upper', (str) => (str || '').toUpperCase());
    Handlebars.registerHelper('add', (a, b) => (a || 0) + (b || 0));
    Handlebars.registerHelper('sub', (a, b) => (a || 0) - (b || 0));
    // 0→A, 1→B … (option labels); wraps past Z back to A.
    Handlebars.registerHelper('letter', (i) => String.fromCharCode(65 + (((i || 0) % 26) + 26) % 26));

    // Tooltip text (audit SEC-16). Foundry renders data-tooltip as HTML after the
    // browser decodes the attribute, so a value needs escaping twice: this helper
    // escapes once and returns a plain string, which Handlebars escapes again.
    // Every {{…}} inside a data-tooltip="…" in the templates goes through it
    // (sim: test-tooltip-text).
    registerTipHelper(Handlebars);
    registerTagHueHelper(Handlebars);
    setRoleColorResolver((id) => (game.nightcity?.masterContactService?.getCustomRoles?.() || []).find((r) => r.id === id)?.color || null);
    Handlebars.registerHelper('ncm-json', (context) => JSON.stringify(context, null, 2));
    Handlebars.registerHelper('ncm-isGM', () => game.user?.isGM);
    // What players call a shard (the `shardTerm` setting) — see utils/shardTerm.js.
    registerShardTermHelper(Handlebars);
    Handlebars.registerHelper('join', (arr, separator) => {
      if (!Array.isArray(arr)) return '';
      return arr.join(typeof separator === 'string' ? separator : ', ');
    });

    // ─── Network Icon Helper (supports FA icon or custom image) ───

    Handlebars.registerHelper('ncm-net-icon', function (theme) {
      if (!theme) return new Handlebars.SafeString('<i class="fas fa-wifi"></i>');
      if (theme.iconMode === 'image' && theme.customImage) {
        const src = Handlebars.escapeExpression(theme.customImage);
        return new Handlebars.SafeString(`<img src="${src}" alt="" class="ncm-net-icon-img">`);
      }
      const icon = Handlebars.escapeExpression(theme.icon || 'fa-wifi');
      return new Handlebars.SafeString(`<i class="fas ${icon}"></i>`);
    });

    // ─── Anonymous Mask Avatar ───
    // Renders the self-contained masked avatar for an anonymous sender. Pure CSS
    // layers keyed by data-anon-style (see styles/components/anon-mask.css). Never
    // uses the real portrait — the recipient never receives it (truly hidden).
    Handlebars.registerHelper('ncm-anon-avatar', function (style, label) {
      const s = ['filtered', 'scrambled', 'ghost', 'monolith'].includes(style) ? style : 'scrambled';
      let inner;
      if (s === 'ghost') {
        inner = '<span class="ncm-anon-av__ghost"></span>';
      } else if (s === 'monolith') {
        const n = Handlebars.escapeExpression(typeof label === 'string' && label ? label : '07');
        inner = `<span class="ncm-anon-av__slab"><span class="ncm-anon-av__so">SOUND</span><span class="ncm-anon-av__so">ONLY</span><span class="ncm-anon-av__num">${n}</span></span>`;
      } else if (s === 'filtered') {
        inner = '<span class="ncm-anon-av__face"></span><span class="ncm-anon-av__vignette"></span>';
      } else { // scrambled
        inner = '<span class="ncm-anon-av__face"></span><span class="ncm-anon-av__noise"></span><span class="ncm-anon-av__tear"></span><span class="ncm-anon-av__rgb-r"></span><span class="ncm-anon-av__rgb-b"></span><span class="ncm-anon-av__vignette"></span>';
      }
      return new Handlebars.SafeString(`<span class="ncm-anon-av" data-anon-style="${s}">${inner}</span>`);
    });

    log.info('Handlebars helpers registered');

    // Preload — Foundry will skip any that don't exist on disk yet. Non-fatal: templates load lazily on first render too.
    const paths = Object.values(TEMPLATES);
    return loadTemplates(paths)
      .then(() => log.info(`Templates preloaded (${paths.length} registered)`))
      .catch((error) => log.warn('Template preloading had errors (this is OK during early development):', error?.message));
  });
}
