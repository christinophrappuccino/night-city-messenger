/**
 * Template Helpers — Handlebars Registration
 * @file scripts/init/registerTemplates.js
 * @module cyberpunkred-messenger
 * @description Registers Handlebars helpers and preloads template partials.
 */

const MODULE_ID = 'cyberpunkred-messenger';

/**
 * Register custom Handlebars helpers for NCM templates.
 * Called during the Foundry `init` hook.
 */
export function registerHandlebarsHelpers() {

  // ── Comparison Helpers ──

  /** Equality check: {{#eq a b}}...{{/eq}} */
  Handlebars.registerHelper('eq', function (a, b, options) {
    if (arguments.length === 3) {
      // Block helper: {{#eq a b}}...{{else}}...{{/eq}}
      return a === b ? options.fn(this) : options.inverse(this);
    }
    // Inline: {{eq a b}} → boolean
    return a === b;
  });

  /** Not-equal: {{#neq a b}}...{{/neq}} */
  Handlebars.registerHelper('neq', function (a, b, options) {
    return a !== b ? options.fn(this) : options.inverse(this);
  });

  /** Greater than: {{#gt a b}}...{{/gt}} */
  Handlebars.registerHelper('gt', function (a, b, options) {
    if (arguments.length === 3) {
      return a > b ? options.fn(this) : options.inverse(this);
    }
    return a > b;
  });

  /** Less than: {{#lt a b}}...{{/lt}} */
  Handlebars.registerHelper('lt', function (a, b, options) {
    if (arguments.length === 3) {
      return a < b ? options.fn(this) : options.inverse(this);
    }
    return a < b;
  });

  /** Greater than or equal: {{#gte a b}} */
  Handlebars.registerHelper('gte', function (a, b, options) {
    return a >= b ? options.fn(this) : options.inverse(this);
  });

  // ── Logical Helpers ──

  /** And: {{#and a b}}...{{/and}} */
  Handlebars.registerHelper('and', function () {
    const args = Array.from(arguments);
    const options = args.pop();
    return args.every(Boolean) ? options.fn(this) : options.inverse(this);
  });

  /** Or: {{#or a b}}...{{/or}} */
  Handlebars.registerHelper('or', function () {
    const args = Array.from(arguments);
    const options = args.pop();
    return args.some(Boolean) ? options.fn(this) : options.inverse(this);
  });

  /** Not: {{#not val}}...{{/not}} */
  Handlebars.registerHelper('not', function (val, options) {
    return !val ? options.fn(this) : options.inverse(this);
  });

  // ── String Helpers ──

  /** Truncate: {{truncate text 100}} */
  Handlebars.registerHelper('truncate', function (str, len) {
    if (!str) return '';
    if (str.length <= len) return str;
    return str.substring(0, len) + '…';
  });

  /** Lowercase: {{lower text}} */
  Handlebars.registerHelper('lower', function (str) {
    return (str || '').toLowerCase();
  });

  /** Uppercase: {{upper text}} */
  Handlebars.registerHelper('upper', function (str) {
    return (str || '').toUpperCase();
  });

  // ── Math Helpers ──

  /** Add: {{add a b}} */
  Handlebars.registerHelper('add', function (a, b) {
    return (a || 0) + (b || 0);
  });

  /** Subtract: {{sub a b}} */
  Handlebars.registerHelper('sub', function (a, b) {
    return (a || 0) - (b || 0);
  });

  console.log(`${MODULE_ID} | Handlebars helpers registered`);
}

/**
 * Preload template partials for fast rendering.
 * Called during the Foundry `init` hook.
 */
export async function preloadTemplates() {
  const paths = [
    `modules/${MODULE_ID}/templates/message-viewer/message-viewer.hbs`,
    `modules/${MODULE_ID}/templates/message-viewer/partials/message-list-item.hbs`,
    `modules/${MODULE_ID}/templates/message-viewer/partials/message-detail.hbs`,
    `modules/${MODULE_ID}/templates/message-viewer/partials/empty-state-list.hbs`,
    `modules/${MODULE_ID}/templates/message-viewer/partials/empty-state-detail.hbs`,
    // Add more partials as they're created in future sprints
  ];

  return loadTemplates(paths);
}
