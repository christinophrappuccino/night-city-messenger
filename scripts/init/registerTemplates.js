/**
 * Register Templates & Handlebars Helpers
 * @file scripts/init/registerTemplates.js
 * @module cyberpunkred-messenger
 * @description Preloads Handlebars templates and registers custom helpers.
 */

import { TEMPLATES, MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';
import { formatCyberDate, truncate } from '../utils/helpers.js';

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

    // ─── Handlebars Helpers ───

    Handlebars.registerHelper('ncm-date', (timestamp) => {
      return formatCyberDate(timestamp);
    });

    Handlebars.registerHelper('ncm-truncate', (str, len) => {
      return truncate(str, typeof len === 'number' ? len : 50);
    });

    Handlebars.registerHelper('ncm-eq', (a, b) => a === b);
    Handlebars.registerHelper('ncm-neq', (a, b) => a !== b);
    Handlebars.registerHelper('ncm-gt', (a, b) => a > b);
    Handlebars.registerHelper('ncm-or', (...args) => {
      args.pop(); // Remove Handlebars options arg
      return args.some(Boolean);
    });
    Handlebars.registerHelper('ncm-and', (...args) => {
      args.pop();
      return args.every(Boolean);
    });

    Handlebars.registerHelper('ncm-json', (context) => {
      return JSON.stringify(context, null, 2);
    });

    Handlebars.registerHelper('ncm-isGM', () => game.user?.isGM);

    log.info('Handlebars helpers registered');
  });
}
