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
import { registerShardTermHelper } from '../utils/shardTerm.js';

/**
 * Check if the last argument is a Handlebars options object (block mode)
 * vs a plain value (subexpression mode).
 */
function _isBlock(options) {
  return options && typeof options === 'object' && typeof options.fn === 'function';
}

export function registerTemplates(initializer) {
  initializer.register('preInit', 20, 'Template preloading', async () => {
    // Collect all template paths that exist
    const paths = Object.values(TEMPLATES);

    // Preload — Foundry will skip any that don't exist on disk yet
    try {
      await loadTemplates(paths);
      log.info(`Templates preloaded (${paths.length} registered)`);
    } catch (error) {
      // Non-fatal — templates load lazily on first render too
      log.warn('Template preloading had errors (this is OK during early development):', error.message);
    }

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

    Handlebars.registerHelper('and', function () {
      const args = Array.from(arguments);
      const last = args[args.length - 1];
      if (_isBlock(last)) {
        args.pop();
        return args.every(Boolean) ? last.fn(this) : last.inverse(this);
      }
      return args.every(Boolean);
    });

    Handlebars.registerHelper('or', function () {
      const args = Array.from(arguments);
      const last = args[args.length - 1];
      if (_isBlock(last)) {
        args.pop();
        return args.some(Boolean) ? last.fn(this) : last.inverse(this);
      }
      return args.some(Boolean);
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
  });
}
