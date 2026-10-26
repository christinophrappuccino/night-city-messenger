/**
 * Phase 6 Verification
 * @file scripts/tests/Phase6Verification.js
 * @module night-city-messenger
 * @description Automated smoke checks for the terminal-era feature surface:
 *              TerminalService, TraceService (heat/countdowns), residents,
 *              the program-effect registry, upload/forge, operator gating,
 *              the Security tab's settings, and the workshop/deck launchers.
 *              Presence + contract checks in the Phase 2–5 mould (zero
 *              gameplay writes — safe to run in any world).
 *              Registered via ModuleInitializer in registerTerminalSystem;
 *              manual run: game.nightcity.verifyPhase6().
 */

import { MODULE_ID, TEMPLATES, SOCKET_OPS, DEFAULTS } from '../utils/constants.js';
import { canOperate, resolveOperator, getOperatorActors } from '../utils/helpers.js';
import { PROGRAM_EFFECTS, programEffectInfo } from '../ui/content/ContentRenderers.js';
import { forgeOutcome, forgeQualityFromMargin } from '../ui/content/UploadFlow.js';

export class Phase6Verification {

  /** @type {Array<{id: string, label: string, passed: boolean, detail: string}>} */
  _results = [];

  async run() {
    console.group(`%c${MODULE_ID} | Phase 6 Verification`, 'color: #19f3f7; font-weight: bold;');

    // ─── 6.01: TerminalService ───
    await this._check('6.01', 'TerminalService available', () => {
      const svc = game.nightcity?.terminalService;
      if (!svc) return { passed: false, detail: 'TerminalService not on game.nightcity' };
      const methods = ['isTerminal', 'convertToTerminal', 'getConfig', 'getState', 'getAccounts',
        'getAccountMessages', 'addAccountMessage', 'getFolders', 'getUplink', 'requiresAuth',
        'recordLoginSuccess', 'recordLoginFailure', 'getLoginLog', 'getLastLogin',
        'mirrorDeliveryToAccounts', 'exfilToInbox', 'exfilToShard', 'forceUnlock', 'relock'];
      const missing = methods.filter(m => typeof svc[m] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing methods: ${missing.join(', ')}` };
      return { passed: true, detail: `TerminalService: ${methods.length} methods verified` };
    });

    // ─── 6.02: Residents (triggered programs) ───
    await this._check('6.02', 'Resident lifecycle methods', () => {
      const svc = game.nightcity?.terminalService;
      const methods = ['getResidents', 'installResident', 'updateResident', 'removeResident',
        'fireResident', 'reapResidents', 'checkActionResidents', 'checkHeatResidents',
        'forgeBackdoorAccount', 'reapForgedAccounts'];
      const missing = methods.filter(m => typeof svc?.[m] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };
      return { passed: true, detail: `Resident lifecycle: ${methods.length} methods verified` };
    });

    // ─── 6.03: TraceService (funnel + heat + countdowns) ───
    await this._check('6.03', 'TraceService available', () => {
      const svc = game.nightcity?.traceService;
      if (!svc) return { passed: false, detail: 'TraceService not on game.nightcity' };
      const methods = ['fireTrace', 'logSuccess', 'recordTrace', 'getHeatMap', 'getHeat',
        'bumpHeat', 'setHeat', 'startCountdown', 'cancelCountdown', 'reapCountdowns'];
      const missing = methods.filter(m => typeof svc[m] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };
      return { passed: true, detail: `TraceService: ${methods.length} methods verified` };
    });

    // ─── 6.04: Security-era world settings ───
    await this._check('6.04', 'Security/authoring world settings registered', () => {
      const names = ['traceLog', 'traceHeat', 'traceCountdowns', 'operatorGate', 'recycleBin',
        'residentFireMode', 'hackResolution', 'programLibrary', 'entryTemplates',
        'terminalPresetLibrary', 'terminalThemePresets', 'exfilFolderName'];
      const missing = [];
      for (const n of names) {
        try { game.settings.get(MODULE_ID, n); } catch { missing.push(n); }
      }
      if (missing.length > 0) return { passed: false, detail: `Not registered: ${missing.join(', ')}` };
      return { passed: true, detail: `${names.length} world settings registered` };
    });

    // ─── 6.05: Security-era client settings ───
    await this._check('6.05', 'Security client settings registered', () => {
      const names = ['securityAlertLevel', 'securityLogSeen', 'operatorActorId'];
      const missing = [];
      for (const n of names) {
        try { game.settings.get(MODULE_ID, n); } catch { missing.push(n); }
      }
      if (missing.length > 0) return { passed: false, detail: `Not registered: ${missing.join(', ')}` };
      return { passed: true, detail: `${names.length} client settings registered` };
    });

    // ─── 6.06: Socket relays for the player→machine arc ───
    await this._check('6.06', 'Terminal/trace socket handlers registered', () => {
      const handlers = game.nightcity?.socketManager?._handlers;
      if (!handlers?.has) return { passed: false, detail: 'SocketManager handlers unavailable' };
      const ops = [
        'SHARD_PRICE_REQUEST',
        'TERMINAL_EXFIL_REQUEST', 'TERMINAL_SESSION_REQUEST', 'TERMINAL_NET_REQUEST',
        'TERMINAL_RESIDENT_REQUEST', 'TRACE_REQUEST', 'CONTENT_UPDATE_REQUEST',
        'NET_RESOLVE_REQUEST', 'SECURITY_LOCKOUT', 'SECURITY_NOTIFY'];
      const missing = ops.filter(k => !SOCKET_OPS[k] || !handlers.has(SOCKET_OPS[k]));
      if (missing.length > 0) return { passed: false, detail: `Missing handlers: ${missing.join(', ')}` };
      return { passed: true, detail: `${ops.length} socket handlers registered` };
    });

    // ─── 6.07: Launch functions ───
    await this._check('6.07', 'Terminal-era launchers registered', () => {
      const ns = game.nightcity;
      const fns = ['openTerminal', 'openMalwareWorkshop', 'openProgramDeck', 'openEncoder'];
      const missing = fns.filter(f => typeof ns?.[f] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };
      return { passed: true, detail: `${fns.length} launchers available` };
    });

    // ─── 6.08: Macro API terminal extensions ───
    await this._check('6.08', 'Terminal macro API extensions', () => {
      const api = game.nightcity?.messenger;
      const fns = ['convertToTerminal', 'addTerminalAccount', 'addTerminalMessage',
        'forceUnlockTerminal', 'relockTerminal'];
      const missing = fns.filter(f => typeof api?.[f] !== 'function');
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };
      return { passed: true, detail: `MacroAPI: ${fns.length} terminal functions registered` };
    });

    // ─── 6.09: Program-effect registry sanity ───
    await this._check('6.09', 'PROGRAM_EFFECTS registry well-formed', () => {
      const entries = Object.entries(PROGRAM_EFFECTS || {});
      if (entries.length === 0) return { passed: false, detail: 'PROGRAM_EFFECTS empty' };
      const bad = entries.filter(([, v]) =>
        !v?.label || !Array.isArray(v?.modes) || v.modes.length === 0 ||
        v.modes.some(m => m !== 'instant' && m !== 'triggered'));
      if (bad.length > 0) return { passed: false, detail: `Malformed entries: ${bad.map(([k]) => k).join(', ')}` };
      const fallback = programEffectInfo('definitely-not-a-verb');
      if (fallback !== PROGRAM_EFFECTS.adjudicate) return { passed: false, detail: 'Unknown verb does not fall back to adjudicate' };
      return { passed: true, detail: `${entries.length} effects, all with label + valid modes; fallback OK` };
    });

    // ─── 6.10: Forge ladder math ───
    await this._check('6.10', 'Forge outcome ladder (clean / sloppy / rejected)', () => {
      const cases = [
        [15, 15, 'clean'],    // margin 0 → clean
        [20, 15, 'clean'],    // beat it → clean
        [14, 15, 'sloppy'],   // -1 → sloppy but lands
        [11, 15, 'sloppy'],   // -4 → edge of the band
        [10, 15, 'rejected'], // -5 → nothing installs
      ];
      const wrong = cases.filter(([t, dv, want]) => forgeOutcome(t, dv) !== want);
      if (wrong.length > 0) return { passed: false, detail: `Wrong rungs: ${wrong.map(c => c.join('/')).join(' · ')}` };
      const qHigh = forgeQualityFromMargin(25, 15);
      const qLow = forgeQualityFromMargin(12, 15);
      if (!(qHigh > qLow)) return { passed: false, detail: 'forgeQuality not monotonic with margin' };
      return { passed: true, detail: 'Ladder rungs + quality monotonicity verified' };
    });

    // ─── 6.11: Operator identity + capability gate ───
    await this._check('6.11', 'Operator helpers exported', () => {
      const fns = { canOperate, resolveOperator, getOperatorActors };
      const missing = Object.entries(fns).filter(([, f]) => typeof f !== 'function').map(([n]) => n);
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };
      return { passed: true, detail: 'canOperate / resolveOperator / getOperatorActors available' };
    });

    // ─── 6.12: Templates loadable ───
    await this._check('6.12', 'Phase 6 templates loadable', async () => {
      const paths = [
        TEMPLATES.TERMINAL_VIEWER,
        TEMPLATES.TERMINAL_CONFIG,
        TEMPLATES.ADMIN_TAB_SECURITY,
        TEMPLATES.MALWARE_WORKSHOP,
        TEMPLATES.PROGRAM_DECK,
        TEMPLATES.SHARD_ENCODER,
        TEMPLATES.ENCODER_CONFIG,
        TEMPLATES.CONTENT_BODY,
      ];
      const results = [];
      for (const path of paths) {
        try {
          const response = await fetch(path);
          results.push({ path, ok: response.ok });
        } catch {
          results.push({ path, ok: false });
        }
      }
      const failed = results.filter(r => !r.ok);
      if (failed.length > 0) return { passed: false, detail: `Missing templates: ${failed.map(f => f.path).join(', ')}` };
      return { passed: true, detail: `${results.length} templates accessible` };
    });

    // ─── 6.14: Shard Encoder (player authoring) ───
    await this._check('6.14', 'Shard Encoder model + settings', async () => {
      const problems = [];
      for (const key of ['encoderConfig', 'legibilityPrefs']) {
        try { game.settings.get(MODULE_ID, key); } catch { problems.push(`setting ${key} unregistered`); }
      }
      const M = await import('../ui/content/EncoderModel.js');
      const cfg = M.resolveEncoderConfig(game.settings.get(MODULE_ID, 'encoderConfig') || {});
      if (!cfg.tiers?.length) problems.push('no blank tiers resolved');
      if (cfg.tiers.filter(t => t.fallback).length !== 1) problems.push('there must be exactly one fallback tier');
      if (Object.keys(cfg.types || {}).length !== 18) problems.push(`expected 18 content types, got ${Object.keys(cfg.types || {}).length}`);
      // The lock ceiling must never leave a player with nothing lockable.
      for (const total of [0, 12, 17, 25]) {
        if (!(M.lockOptions(cfg, { cryptoTotal: total }).maxDV > 0)) problems.push(`lock ceiling empty at ${total}`);
      }
      // A forged file's scan DV must stay on the same scale ANALYZE reads.
      const q = M.contentEfficiency({ total: 20, dv: 15 });
      if (!(q.scanDV >= 8 && q.scanDV <= 20)) problems.push(`content scan DV out of range: ${q.scanDV}`);
      if (!M.PRICING_MODES[cfg.pricing]) problems.push(`unknown pricing mode ${cfg.pricing}`);
      // The ladder must agree with the upload arc's — one ladder for the module.
      const { FORGE_SLOPPY_BAND } = await import('../ui/content/UploadFlow.js');
      if (FORGE_SLOPPY_BAND !== M.SLOPPY_BAND) problems.push(`ladder band mismatch: upload ${FORGE_SLOPPY_BAND} vs encoder ${M.SLOPPY_BAND}`);
      if (M.encodeOutcome(18, 18) !== 'clean' || M.encodeOutcome(14, 18) !== 'sloppy' || M.encodeOutcome(13, 18) !== 'rejected') {
        problems.push('encodeOutcome rungs are wrong');
      }
      // Every offered program verb must have a real applier behind it.
      const { PROGRAM_EFFECTS } = await import('../ui/content/ContentRenderers.js');
      for (const key of Object.values(M.FAMILY_ABILITIES).flat()) {
        if (!PROGRAM_EFFECTS[key]) problems.push(`offered verb "${key}" is not in PROGRAM_EFFECTS`);
      }
      if (problems.length) return { passed: false, detail: problems.join('; ') };
      return { passed: true, detail: `${cfg.tiers.length} blank tiers, 18 types, ladder band ${M.SLOPPY_BAND}, pricing ${cfg.pricing}` };
    });

    // ─── 6.15: Legibility (the Encoder's accessibility options) ───
    await this._check('6.15', 'Legibility options apply and clamp', async () => {
      const L = await import('../utils/legibility.js');
      const problems = [];
      const p = L.normalizeLegibility({ textScale: 9999, contrast: 1, motion: 'disco' });
      if (p.textScale !== L.LEGIBILITY_RANGES.textScale.max) problems.push('text size does not clamp');
      if (p.contrast !== L.LEGIBILITY_RANGES.contrast.min) problems.push('contrast does not clamp');
      if (p.motion !== 'full') problems.push('an unknown motion value is not rejected');
      if (L.effectiveMotion({ motion: 'full' }, { animationsEnabled: false }) !== 'off') problems.push('motion can be raised above the module pref');
      const el = document.createElement('div');
      L.applyLegibility(el, { ...L.LEGIBILITY_DEFAULTS, textScale: 120, density: 'roomy' });
      if (el.style.getPropertyValue('--ncm-lg-text') !== '1.2') problems.push('--ncm-lg-text not stamped');
      if (el.dataset.lgDensity !== 'roomy') problems.push('density not stamped');
      if (problems.length) return { passed: false, detail: problems.join('; ') };
      return { passed: true, detail: `${Object.keys(L.LEGIBILITY_PRESETS).length} presets, prefs clamp, motion only lowers` };
    });

    // ─── 6.16: Shard integrity (dev/design/SHARD-INTEGRITY.md) ───
    await this._check('6.16', 'Shard integrity — rules, service, relay', async () => {
      const M = await import('../ui/content/IntegrityModel.js');
      const ds = game.nightcity?.dataShardService;
      const problems = [];
      for (const fn of ['getIntegrityConfig', 'checkIntegrity', 'degradeIntegrity', 'setIntegrity', 'setEntryCorruption',
        'repairAllEntries', 'repairIntegrity', 'salvageShard', 'exportEntry', 'programInstability', 'handleIntegrityRequest']) {
        if (typeof ds?.[fn] !== 'function') problems.push(`dataShardService.${fn} missing`);
      }
      if (!SOCKET_OPS.SHARD_INTEGRITY_REQUEST) problems.push('SHARD_INTEGRITY_REQUEST op missing');
      if (typeof game.nightcity?.messenger?.damageShard !== 'function') problems.push('macro API damageShard missing');
      const c = M.resolveIntegrity({ corruptionThreshold: 0, corruptionChance: 0 });
      if (c.corruptionThreshold !== 0 || c.corruptionChance !== 0) problems.push('zero is not a legal threshold/chance');
      if (M.effectiveHit(15, 40) !== 9 || M.effectiveHit(1, 90) !== 1) problems.push('hardening maths wrong');
      for (let k = 0; k < 20; k++) if (M.isUnitLost('p6', k, 0.25) && !M.isUnitLost('p6', k, 0.5)) problems.push('loss is not monotonic');
      if (problems.length) return { passed: false, detail: problems.join('; ') };
      return { passed: true, detail: 'model + 11 service methods + relay op + macro API' };
    });

    // ─── 6.13: Prior phases intact ───
    // ─── 6.17: Shard editing rule + the state relay + the re-encode door ───
    await this._check('6.17', 'Shard editing — rule, state relay, re-encode', async () => {
      const M = await import('../ui/content/EncoderModel.js');
      const H = await import('../utils/helpers.js');
      const ds = game.nightcity?.dataShardService;
      const problems = [];
      if (M.resolveShardEditing({}) !== 'locked') problems.push('a GM-made shard must default to locked');
      if (M.resolveShardEditing({ playerMade: { actorId: 'x' } }) !== 'maker') problems.push('a player-made shard must default to maker');
      if (M.resolveShardEditing({ playerEditing: 'qualified' }) !== 'qualified') problems.push('an explicit rule must win');
      if (typeof H.canEditShard !== 'function') problems.push('canEditShard missing');
      for (const fn of ['handleStateRequest', 'reencodeShard', '_writeDecrypted', '_relayState', '_canWriteItem']) {
        if (typeof ds?.[fn] !== 'function') problems.push(`dataShardService.${fn} missing`);
      }
      if (!SOCKET_OPS.SHARD_STATE_REQUEST) problems.push('SHARD_STATE_REQUEST op missing');
      if (typeof game.nightcity?.openEncoder !== 'function') problems.push('openEncoder launcher missing');
      const cfg = M.resolveEncoderConfig(game.nightcity?.settingsManager?.getEncoderConfigRaw?.() ?? {});
      if (typeof cfg.reencode?.allowed !== 'boolean') problems.push('reencode.allowed is not resolved');
      if (problems.length) return { passed: false, detail: problems.join('; ') };
      return { passed: true, detail: `3 edit modes, state relay ops decrypt/session/decryptPage/destroy, re-encode ${cfg.reencode.allowed ? 'on' : 'off'} at DV +${cfg.reencode.dv}` };
    });

    // ─── 6.18: Terminal file repository (shared volume · folders · gates · boot speed) ───
    await this._check('6.18', 'Terminal files — rules, service, views', async () => {
      const F = await import('../utils/terminalFiles.js');
      const ts = game.nightcity?.terminalService;
      const problems = [];
      if (F.SHARED_SCOPE !== '__shared__') problems.push('SHARED_SCOPE changed');
      if (F.normalizeFolderPath('/a//b/') !== 'a/b') problems.push('normalizeFolderPath');
      if (F.gatePasses({ mode: 'admin' }, { isAdmin: false })) problems.push('admin gate let a non-admin through');
      if (!F.gatePasses({ mode: 'clearance', min: 2 }, { clearance: 'LEVEL 3' })) problems.push('clearance 3 must pass min 2');
      for (const fn of ['getAllMessages', 'getSharedMessages', 'getFileFolders', 'canOpenFolder', 'buildFileTree', 'saveFileFolder', 'renameFileFolder', 'removeFileFolder', 'moveFile']) {
        if (typeof ts?.[fn] !== 'function') problems.push(`terminalService.${fn} missing`);
      }
      if (!TEMPLATES.TERMINAL_CONFIG_CONTENT) problems.push('TEMPLATES.TERMINAL_CONFIG_CONTENT missing');
      else { try { await getTemplate(TEMPLATES.TERMINAL_CONFIG_CONTENT); } catch { problems.push('config-content partial fails to load'); } }
      const { TerminalViewerApp } = await import('../ui/Terminal/TerminalViewerApp.js');
      const hold = TerminalViewerApp.bootHoldMs;
      if (typeof hold !== 'function') problems.push('bootHoldMs missing');
      else {
        if (!(hold({ speed: 'fast' }) < hold({ speed: 'normal' }) && hold({ speed: 'normal' }) < hold({ speed: 'dramatic' }))) problems.push('boot speeds are not ordered fast < normal < dramatic');
        if (hold({ speed: 'custom', customSeconds: 7 }) !== 7000) problems.push('custom seconds not honoured');
      }
      if (!(DEFAULTS.TERMINAL_CONFIG.files?.folders instanceof Array)) problems.push('DEFAULTS.TERMINAL_CONFIG.files.folders missing');
      if (problems.length) return { passed: false, detail: problems.join('; ') };
      return { passed: true, detail: 'shared scope, gate rules, 9 service methods, config-content partial, boot speed ladder' };
    });

    // ─── 6.19: Mailbox styles (classic · tabs · tty · desktop) + the shared CRT film ───
    await this._check('6.19', 'Mailbox styles — registry, partials, viewer flags, CRT film', async () => {
      const C = await import('../utils/constants.js');
      const problems = [];
      const styles = C.TERMINAL_MAILBOX_STYLES;
      if (!Array.isArray(styles) || styles.length !== 4 || styles[0].key !== 'classic') problems.push('TERMINAL_MAILBOX_STYLES is not the 4-entry registry');
      if (DEFAULTS.TERMINAL_CONFIG.mailboxStyle !== 'classic') problems.push('default mailboxStyle is not classic');
      const keys = new Set((styles || []).map(s => s.key));
      for (const [k, p] of Object.entries(C.TERMINAL_PRESETS || {})) if (!keys.has(p.mailboxStyle)) problems.push(`preset ${k} has no valid mailboxStyle (a theme must carry its layout)`);
      for (const k of ['DETAIL', 'TREE', 'ROWS', 'TABS', 'TTY', 'DESKTOP']) {
        const t = TEMPLATES['TERMINAL_MAILBOX_' + k];
        if (!t) { problems.push(`TEMPLATES.TERMINAL_MAILBOX_${k} missing`); continue; }
        try { await getTemplate(t); } catch { problems.push(`mailbox partial ${k} fails to load`); }
      }
      const { TerminalViewerApp } = await import('../ui/Terminal/TerminalViewerApp.js');
      if (typeof TerminalViewerApp.prototype._onTtyCommand !== 'function') problems.push('_onTtyCommand missing (TTY prompt)');
      for (const a of ['terminalView', 'terminalFsOpen', 'terminalFsBack', 'terminalFolder', 'terminalSelectMessage']) {
        if (!TerminalViewerApp.DEFAULT_OPTIONS?.actions?.[a]) problems.push(`viewer action ${a} missing`);
      }
      const crt = await import('../utils/crt.js');
      if (!Array.isArray(crt.CRT_STYLES) || !crt.CRT_STYLES.some(s => s.key === 'off')) problems.push('CRT_STYLES missing an off entry');
      if (typeof crt.applyCrt !== 'function' || typeof crt.resolveCrt !== 'function') problems.push('crt helpers missing');
      if (crt.resolveCrt({ crt: { style: 'nonsense' } }).style === 'nonsense') problems.push('resolveCrt accepted an unknown style');
      if (problems.length) return { passed: false, detail: problems.join('; ') };
      return { passed: true, detail: '4 styles, 6 partials load, tty prompt, 5 shared actions, CRT film helpers' };
    });

    // ─── 6.20: Admin access — an admin account views another account ───
    await this._check('6.20', 'Admin access — rules, label, service + viewer, partials', async () => {
      const C = await import('../utils/constants.js');
      const A = await import('../utils/terminalAdmin.js');
      const problems = [];
      if (JSON.stringify(DEFAULTS.TERMINAL_CONFIG.adminAccess) !== JSON.stringify(A.ADMIN_ACCESS_DEFAULTS)) problems.push('DEFAULTS.TERMINAL_CONFIG.adminAccess drifted from terminalAdmin defaults');
      if (DEFAULTS.TERMINAL_ACCOUNT.privateFromAdmin !== false) problems.push('account default privateFromAdmin is not false');
      for (const [k, p] of Object.entries(C.TERMINAL_PRESETS || {})) if (!p.adminLabel) problems.push(`preset ${k} has no adminLabel`);
      const cfg = { accounts: [{ id: 'a', isAdmin: true }, { id: 'b' }, { id: 'c', privateFromAdmin: true }] };
      if (!A.adminViewVerdict(cfg, cfg.accounts[0], cfg.accounts[1]).ok) problems.push('admin cannot view a normal account');
      if (A.adminViewVerdict(cfg, cfg.accounts[0], cfg.accounts[2]).ok) problems.push('a private account was viewable');
      if (A.adminViewVerdict(cfg, cfg.accounts[1], cfg.accounts[0]).ok) problems.push('a non-admin could view');
      const svc = game.nightcity?.terminalService;
      for (const m of ['adminViewVerdict', 'adminViewTargets']) if (typeof svc?.[m] !== 'function') problems.push(`TerminalService.${m} missing`);
      const { TerminalViewerApp } = await import('../ui/Terminal/TerminalViewerApp.js');
      for (const a of ['terminalAdminView', 'terminalAdminBack', 'terminalAdminPick']) if (!TerminalViewerApp.DEFAULT_OPTIONS?.actions?.[a]) problems.push(`viewer action ${a} missing`);
      for (const m of ['_boxId', '_boxMessages', '_startAdminView', '_adminReadOnly']) if (typeof TerminalViewerApp.prototype[m] !== 'function') problems.push(`viewer ${m} missing`);
      for (const k of ['TERMINAL_ADMIN_BAR', 'TERMINAL_ADMIN_LIST']) {
        if (!TEMPLATES[k]) { problems.push(`TEMPLATES.${k} missing`); continue; }
        try { await getTemplate(TEMPLATES[k]); } catch { problems.push(`${k} fails to load`); }
      }
      if (problems.length) return { passed: false, detail: problems.join('; ') };
      return { passed: true, detail: 'defaults, 12 theme labels, verdict matrix, service + viewer methods, 3 actions, 2 partials' };
    });

    await this._check('6.13', 'Core services intact (Phase 1-5 regression)', () => {
      const ns = game.nightcity;
      const required = [
        'eventBus', 'settingsManager', 'socketManager',
        'messageService', 'notificationService', 'networkService', 'securityService',
        'dataShardService', 'skillService', 'schedulingService', 'masterContactService',
        'terminalService', 'traceService',
      ];
      const missing = required.filter(s => !ns?.[s]);
      if (missing.length > 0) return { passed: false, detail: `Missing: ${missing.join(', ')}` };
      return { passed: true, detail: `All ${required.length} services intact` };
    });

    // ─── Summary ───
    const passed = this._results.filter(r => r.passed).length;
    const total = this._results.length;
    const allPassed = passed === total;

    console.log(
      `%c${allPassed ? '✅' : '⚠️'} Phase 6 Verification: ${passed}/${total} checks passed`,
      `color: ${allPassed ? '#19f3f7' : '#F65261'}; font-weight: bold; font-size: 1.1em;`
    );

    console.groupEnd();
    return { passed, total, allPassed, results: this._results };
  }

  /**
   * Run a single check.
   * @param {string} id
   * @param {string} label
   * @param {Function} fn
   * @private
   */
  async _check(id, label, fn) {
    try {
      const result = await fn();
      this._results.push({ id, label, ...result });

      const icon = result.passed ? '✅' : '❌';
      const color = result.passed ? '#19f3f7' : '#F65261';
      console.log(`%c  ${icon} [${id}] ${label}: ${result.detail}`, `color: ${color}`);
    } catch (error) {
      this._results.push({ id, label, passed: false, detail: `Error: ${error.message}` });
      console.log(`%c  ❌ [${id}] ${label}: Error — ${error.message}`, 'color: #F65261');
    }
  }
}
