/**
 * SecurityAuthAdapters
 * @file scripts/ui/NetworkManagement/SecurityAuthAdapters.js
 * @module cyberpunkred-messenger
 * @description Source adapters for the shared security auth dialog
 *              (NetworkAuthDialog). Each adapter normalizes a secured object
 *              into the network-shaped view-model the dialog renders
 *              ({ id, name, type, theme, description, security }) and provides
 *              the four source-specific operations the dialog performs:
 *              refresh / checkPassword / checkSkill / grant.
 *
 *              The dialog is otherwise source-agnostic: SecurityService keys
 *              off `targetId` (a network id, or `terminalId::accountId`), and
 *              ICE / lockout / skill resolution read the shared SECURITY_BLOCK.
 */

import { resolveTerminalSound } from '../../utils/helpers.js';

/**
 * Network adapter — preserves the original NetworkService-backed behavior
 * exactly (the service auth methods own their success sounds, the
 * `_authenticatedNetworks` grant, and the AUTH_SUCCESS/FAILURE events).
 */
export class NetworkAuthAdapter {
  constructor(networkId) {
    this.networkId = networkId;
    this.targetId = networkId;
  }

  get _svc() { return game.nightcity?.networkService; }

  /** @returns {object|null} network-shaped { id, name, type, theme, description, security } */
  refresh() {
    return this._svc?.getNetwork(this.networkId) ?? null;
  }

  checkPassword(password) {
    return this._svc?.authenticatePassword(this.networkId, password) ?? { success: false };
  }

  checkSkill(total, skillName) {
    return this._svc?.authenticateSkillCheck(this.networkId, total, skillName) ?? { success: false };
  }

  /** Mark the network authenticated (GM bypass + on-complete). */
  grant() {
    this._svc?.grantAuth?.(this.networkId);
    this._svc?._authenticatedNetworks?.add?.(this.networkId);
  }
}

/**
 * Terminal-account adapter — a terminal login is a shared SECURITY_BLOCK
 * behind an account, so password/skill checks read that block directly
 * (the dialog plays the sounds; there's no service grant — the caller's
 * resolve callback drives `TerminalViewerApp._loginSuccess`).
 */
export class TerminalAuthAdapter {
  /**
   * @param {Item} item @param {string} accountId
   */
  constructor(item, accountId) {
    this.item = item;
    this.accountId = accountId;
    const svc = game.nightcity?.terminalService;
    this.targetId = svc?.getAuthDescriptor?.(item, accountId)?.targetId ?? `${item?.id}::${accountId}`;
  }

  get _svc() { return game.nightcity?.terminalService; }
  get _sound() { return game.nightcity?.soundService; }

  /** Play through the terminal's sound set (config.soundSet remap/shaping). */
  _play(soundId) {
    const s = resolveTerminalSound(this._svc?.getConfig(this.item)?.soundSet || 'default', soundId);
    this._sound?.playStyled?.(s.id, { rate: s.rate, volume: s.volume });
  }

  /**
   * Terminal accounts have no network type/theme/level — synthesize a
   * network-shaped display object so the dialog renders unchanged. The theme
   * color follows the terminal's own primary so the dialog accent matches.
   */
  refresh() {
    const account = this._svc?.getAccount(this.item, this.accountId);
    if (!account) return null;
    const theme = this._svc?.getConfig(this.item)?.theme || {};
    return {
      id: this.accountId,
      name: account.displayName || account.username || 'Account',
      type: 'terminal',
      theme: { icon: 'fa-user-lock', color: theme.primary || '#F65261' },
      description: account.role || (account.isAdmin ? 'Administrator' : 'Terminal account'),
      security: account.security || {},
    };
  }

  /** Compare against the account's stored password (mirrors NetworkService). */
  checkPassword(password) {
    const sec = this._svc?.getAccount(this.item, this.accountId)?.security || {};
    if (!sec.requiresAuth) return { success: true };
    if (sec.password && password === sec.password) {
      this._play('login-success');
      return { success: true };
    }
    this._play('login-fail');
    return { success: false, reason: 'invalid_password' };
  }

  /** Pre-rolled total vs the account's bypass DV (mirrors NetworkService). */
  checkSkill(total, skillName) {
    const sec = this._svc?.getAccount(this.item, this.accountId)?.security || {};
    if (!sec.requiresAuth) return { success: true };
    const dc = sec.bypassDC ?? 15;
    if (total >= dc) {
      this._play('hack-success');
      return { success: true };
    }
    this._play('hack-fail');
    return { success: false, reason: 'skill_check_failed' };
  }

  /** No service-side grant for terminals — the resolve callback logs in. */
  grant() { /* intentional no-op */ }
}
