/**
 * Terminal ADMIN ACCESS — the pure rules (2026-10-26).
 *
 * Tester: "Admin should be able to browse the accounts, and have rights to their
 * files/messages — almost like View As User — then back out and choose another
 * account." An account with `isAdmin` may VIEW another account on the same
 * machine: its mailbox and its home files, without that account's credentials.
 *
 * Per terminal (`config.adminAccess`, absent keys → defaults, so every existing
 * terminal gets it with no migration):
 *   browse     — admins may view other accounts at all            (default on)
 *   seeHidden  — hidden accounts appear in the admin's View-as list (default on)
 *   rights     — 'full' | 'read' while viewing                    (default full)
 * Per account: `privateFromAdmin` — never viewable (listed greyed out).
 *
 * The LABEL players see ("ADMIN OVERRIDE", "SYSOP"…) belongs to the THEME:
 * `config.theme.adminLabel`, else the preset's `adminLabel`, else the default.
 *
 * No Foundry globals — the sims drive it directly.
 */

export const ADMIN_LABEL_DEFAULT = 'ADMIN OVERRIDE';
export const ADMIN_ACCESS_DEFAULTS = Object.freeze({ browse: true, seeHidden: true, rights: 'full' });

/** The terminal's admin-access settings, sanitised over the defaults. */
export function resolveAdminAccess(cfg) {
  const a = (cfg && typeof cfg.adminAccess === 'object' && cfg.adminAccess) || {};
  return {
    browse: a.browse !== false,
    seeHidden: a.seeHidden !== false,
    rights: a.rights === 'read' ? 'read' : 'full',
  };
}

/**
 * What players see an admin's view called. The terminal's own theme value wins,
 * then its preset's, then the default. Always upper-case, at most 24 chars.
 * @param {object} cfg terminal config
 * @param {object} [presets] TERMINAL_PRESETS
 */
export function adminLabelFor(cfg, presets = {}) {
  const theme = (cfg && typeof cfg.theme === 'object' && cfg.theme) || {};
  const raw = String(theme.adminLabel || presets?.[theme.preset]?.adminLabel || ADMIN_LABEL_DEFAULT).trim();
  return (raw || ADMIN_LABEL_DEFAULT).toUpperCase().slice(0, 24);
}

/**
 * May `viewer` view `target`? Returns `{ ok, listed, reason }`:
 *   ok     — can open it now
 *   listed — appears in the View-as list (a private account is listed, dead)
 * `visible(account)` is the caller's network check (a network-gated account the
 * machine cannot reach is neither listed nor viewable).
 */
export function adminViewVerdict(cfg, viewer, target, { visible = () => true } = {}) {
  const no = (reason, listed = false) => ({ ok: false, listed, reason });
  if (!viewer?.isAdmin) return no('not an admin account');
  const access = resolveAdminAccess(cfg);
  if (!access.browse) return no('admin viewing is switched off on this terminal');
  if (!target || target.id === viewer.id) return no('that is your own account');
  if (!visible(target)) return no('that account is not reachable on this uplink');
  if (target.hidden && !access.seeHidden) return no('hidden');
  if (target.privateFromAdmin) return no('private from admin', true);
  return { ok: true, listed: true, reason: '' };
}

/** The View-as list for a viewer: every account the verdict lists, in config order. */
export function adminViewTargets(cfg, viewer, { visible = () => true } = {}) {
  return (cfg?.accounts || [])
    .map((t) => ({ account: t, verdict: adminViewVerdict(cfg, viewer, t, { visible }) }))
    .filter((r) => r.verdict.listed);
}

/** Is this exfil / content action blocked by read-only viewing? (changes the box) */
export const ADMIN_READONLY_BLOCKS = Object.freeze(['wipe', 'send']);
export function adminReadOnlyBlocks(action) { return ADMIN_READONLY_BLOCKS.includes(action); }
