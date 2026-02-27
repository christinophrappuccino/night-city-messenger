/**
 * Design System Helpers
 * @file scripts/utils/designHelpers.js
 * @module cyberpunkred-messenger
 * @description Utility functions for computing data needed by the Sprint 0
 *   design system partials. Use these in _prepareContext() to build the
 *   objects that Handlebars templates expect.
 */

/**
 * Compute signal bar data for the signal-bar.hbs partial.
 * @param {number} strength — Signal strength 0-100
 * @returns {{ strength: number, quality: string, segments: boolean[] }}
 *
 * @example
 *   import { computeSignalBar } from '../../utils/designHelpers.js';
 *   const signal = computeSignalBar(75);
 *   // → { strength: 75, quality: 'strong', segments: [true, true, true, true, false] }
 */
export function computeSignalBar(strength) {
  const clamped = Math.max(0, Math.min(100, strength));
  const active = Math.ceil(clamped / 20);
  const quality = clamped === 0 ? 'dead'
    : clamped <= 25 ? 'weak'
    : clamped <= 50 ? 'fair'
    : 'strong';

  return {
    strength: clamped,
    quality,
    segments: [1, 2, 3, 4, 5].map(i => i <= active),
  };
}

/**
 * Compute progress bar data for the progress-bar.hbs partial.
 * @param {number} value — Current value
 * @param {number} max — Maximum value
 * @param {string} [label] — Label text
 * @returns {{ value: number, display: string, label?: string, color?: string }}
 */
export function computeProgressBar(value, max, label) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const color = pct <= 25 ? 'danger' : pct <= 50 ? 'warning' : undefined;

  return {
    value: pct,
    display: `${pct}%`,
    label,
    color,
  };
}

/**
 * Build stat grid data from key-value pairs.
 * @param {Array<{label: string, value: string|number, color?: string, pulse?: boolean}>} stats
 * @param {number} [columns] — Fixed column count (2, 3, or 4)
 * @returns {{ stats: Array, columns?: number }}
 */
export function buildStatGrid(stats, columns) {
  return { stats, columns };
}

/**
 * Extract initials from a name (first letter of first and last name).
 * @param {string} name
 * @returns {string} 1-2 character initials
 */
export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Build entity card data for the entity-card.hbs partial.
 * @param {object} params
 * @param {string} params.name
 * @param {string} [params.portrait]
 * @param {string} [params.subtitle]
 * @param {string} [params.role]
 * @param {string} [params.roleLabel]
 * @param {Array} [params.stats]
 * @param {boolean} [params.selected]
 * @param {string} [params.dataId]
 * @returns {object} Ready-to-render entity card context
 */
export function buildEntityCard({ name, portrait, subtitle, role, roleLabel, stats, selected, dataId }) {
  return {
    name,
    portrait: portrait || null,
    initials: portrait ? null : getInitials(name),
    subtitle,
    role,
    roleLabel: roleLabel || role?.toUpperCase(),
    stats: stats || [],
    selected: !!selected,
    dataId,
  };
}

/**
 * Determine priority badge variant from priority string.
 * @param {string} priority — "normal" | "urgent" | "critical"
 * @returns {string} Badge variant class suffix
 */
export function getPriorityBadgeVariant(priority) {
  const map = {
    normal: 'priority-normal',
    urgent: 'priority-urgent',
    critical: 'priority-critical',
  };
  return map[priority] || 'priority-normal';
}
