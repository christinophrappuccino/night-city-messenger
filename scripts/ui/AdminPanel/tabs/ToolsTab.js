/**
 * ToolsTab — System tools and danger-zone actions.
 * @file scripts/ui/AdminPanel/tabs/ToolsTab.js
 * @module night-city-messenger
 *
 * No tab-local state, no DOM wire-up, no context fragment —
 * tab-tools.hbs is a grid of action buttons that call these
 * handlers directly via AdminPanelApp's static delegators.
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log, formatCyberDate } from '../../../utils/helpers.js';
import { BaseTab } from '../BaseTab.js';
import { MessageRepository } from '../../../data/MessageRepository.js';
import { adminDialog, adminConfirm, adminPrompt } from '../../../utils/adminTheme.js';
import { gatherResetPlan, runFactoryReset } from '../../../core/FactoryReset.js';

export class ToolsTab extends BaseTab {

  get key() { return 'tools'; }

  /** Admin-panel appearance presets (separate from the player theme). */
  static ADMIN_PRESETS = [
    { key: 'clean-dark',    label: 'Clean Dark',    desc: 'Calm slate dashboard' },
    { key: 'clean-light',   label: 'Clean Light',   desc: 'Bright, max legibility' },
    { key: 'high-contrast', label: 'High Contrast', desc: 'Accessibility-first' },
  ];

  /** Admin-panel text-size steps (percent) - see AdminPanelApp._applyAdminTextScale. */
  static ADMIN_TEXT_SCALES = [100, 115, 130, 150];

  prepareContext() {
    const theme = this.settingsManager?.getAdminTheme?.() || {};
    const current = theme.preset || 'clean-dark';
    const scale = Number(theme.textScale) || 100;
    return {
      adminThemePresets: ToolsTab.ADMIN_PRESETS.map(p => ({ ...p, active: p.key === current })),
      adminTextScales: ToolsTab.ADMIN_TEXT_SCALES.map(v => ({ value: v, label: `${v}%`, active: v === scale })),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  System Tools
  // ═══════════════════════════════════════════════════════════

  /** Switch the GM Admin Panel's own theme preset and re-render. */
  async onSetAdminTheme(event, target) {
    const preset = target?.dataset?.preset;
    if (!preset) return;
    await this.settingsManager?.setAdminTheme?.({ preset });
    log.info(`Admin: appearance set to "${preset}"`);
    this.render(true);
  }

  /** Set the Admin Panel's own text size (client setting) and re-render. */
  async onSetAdminTextScale(event, target) {
    const scale = Number(target?.dataset?.scale);
    if (!scale) return;
    await this.settingsManager?.setAdminTheme?.({ textScale: scale });
    log.info(`Admin: text size set to ${scale}%`);
    this.render(true);
  }

  onOpenThemeCustomizer(event, target) {
    game.nightcity?.openThemeCustomizer?.();
    log.info('Admin: Opening Theme Customizer');
  }

  async onForceRefreshAll(event, target) {
    ui.notifications.info('Force-refreshing all connected clients...');
    game.socket?.emit(`module.${MODULE_ID}`, {
      type: 'forceRefresh',
    });
    // Also refresh local
    this.render(true);
  }

  onRefreshStats(event, target) {
    this.render(true);
  }

  async onExportLogs(event, target) {
    try {
      const messages = [];
      for (const actor of game.actors) {
        const actorMsgs = await game.nightcity?.messageService?.getMessages(actor.id) ?? [];
        messages.push(...actorMsgs.map(m => ({ actor: actor.name, ...m })));
      }

      const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ncm-messages-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);

      ui.notifications.info(`Exported ${messages.length} messages.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Export failed:`, error);
      ui.notifications.error('Export failed. Check console.');
    }
  }

  async onHealthCheck(event, target) {
    const checks = [];
    checks.push(`MessageService: ${game.nightcity?.messageService ? '✓' : '✗'}`);
    checks.push(`NetworkService: ${game.nightcity?.networkService ? '✓' : '✗'}`);
    checks.push(`DataShardService: ${game.nightcity?.dataShardService ? '✓' : '✗'}`);
    checks.push(`MasterContactService: ${game.nightcity?.masterContactService ? '✓' : '✗'}`);
    checks.push(`SchedulingService: ${game.nightcity?.schedulingService ? '✓' : '✗'}`);
    checks.push(`ThemeService: ${game.nightcity?.themeService ? '✓' : '✗'}`);
    checks.push(`SoundService: ${game.nightcity?.soundService ? '✓' : '✗'}`);

    const allOk = checks.every(c => c.includes('✓'));

    await adminPrompt({
      title: 'NCM Health Check',
      content: `<div style="font-family: monospace; font-size: 12px; line-height: 1.6;">
        <p>${checks.join('<br>')}</p>
        <p style="margin-top: 8px; color: ${allOk ? '#00ff41' : '#ff0033'};">
          ${allOk ? '● ALL SYSTEMS NOMINAL' : '● SYSTEM DEGRADED — Check console'}
        </p>
      </div>`,
      callback: () => {},
    });
  }

  onOpenTimeSettings(event, target) {
    const ts = game.nightcity?.timeService;
    if (!ts) {
      ui.notifications.warn('NCM | TimeService not available.');
      return;
    }

    const info = ts.getProviderInfo();
    const currentTime = info.currentTime;
    const currentDate = currentTime ? new Date(currentTime) : new Date();
    let initFormat = '24H';
    try { initFormat = game.settings.get(MODULE_ID, 'timeFormat') === '12h' ? '12H' : '24H'; } catch { /* default */ }
    let initDateFmt = 'YMD';
    try { initDateFmt = game.settings.get(MODULE_ID, 'dateFormat') || 'YMD'; } catch { /* default */ }
    const dateFmtLabels = { YMD: 'Y.M.D', DMY: 'D.M.Y', MDY: 'M.D.Y' };

    // Pre-fill date/time inputs
    const dateVal = `${currentDate.getUTCFullYear()}-${String(currentDate.getUTCMonth() + 1).padStart(2, '0')}-${String(currentDate.getUTCDate()).padStart(2, '0')}`;
    const timeVal = `${String(currentDate.getUTCHours()).padStart(2, '0')}:${String(currentDate.getUTCMinutes()).padStart(2, '0')}`;

    // Pre-fill disguised with a Night City date if not already set
    let disDateVal = '2045-03-18';
    let disTimeVal = '22:00';
    try {
      const existing = game.settings.get(MODULE_ID, 'disguisedBaseTime');
      if (existing) {
        const d = new Date(existing);
        disDateVal = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        disTimeVal = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      }
    } catch { /* use defaults */ }

    // Status badges
    const scBadge = info.hasSimpleCalendar
      ? '<span style="color:#00ff41;">● Detected</span>'
      : '<span style="color:#555570;">○ Not found</span>';
    const stBadge = info.hasSmallTime
      ? '<span style="color:#00ff41;">● Detected</span>'
      : '<span style="color:#555570;">○ Not found</span>';

    // Shared styles
    const S = {
      panel: 'background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; padding:10px 14px; margin-bottom:10px;',
      label: 'font-family:Rajdhani,sans-serif; font-size:10px; font-weight:700; color:#8888a0; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;',
      value: 'font-family:Share Tech Mono,monospace; font-size:13px; color:#eeeef4;',
      monoSm: 'font-family:Share Tech Mono,monospace; font-size:10px; color:#8888a0;',
      row: 'display:flex; align-items:center; gap:10px; margin-bottom:6px;',
      input: 'background:#12121a; border:1px solid #2a2a45; color:#eeeef4; font-family:Share Tech Mono,monospace; font-size:12px; padding:5px 8px; border-radius:2px; outline:none;',
      select: 'background:#12121a; border:1px solid #2a2a45; color:#eeeef4; font-family:Rajdhani,sans-serif; font-size:13px; font-weight:600; padding:5px 8px; border-radius:2px; width:100%; outline:none;',
      btn: 'background:transparent; border:1px solid #2a2a45; color:#8888a0; font-family:Rajdhani,sans-serif; font-size:11px; font-weight:700; text-transform:uppercase; padding:5px 14px; border-radius:2px; cursor:pointer; transition:all 0.15s;',
      btnCyan: 'border-color:rgba(25,243,247,0.3); color:#19f3f7;',
      btnGold: 'border-color:rgba(247,201,72,0.3); color:#f7c948;',
      sep: 'height:1px; background:#2a2a45; margin:10px 0;',
      hint: 'font-family:Rajdhani,sans-serif; font-size:10px; font-weight:500; color:#6a6a88; margin-top:2px; line-height:1.4;',
    };

    const content = `
      <div style="font-family:Rajdhani,sans-serif; color:#eeeef4; min-width:380px;">

        <!-- Status Panel -->
        <div style="${S.panel}">
          <div style="${S.row}">
            <div style="flex:1;">
              <div style="${S.label}">Current Mode</div>
              <div style="${S.value}">${info.label}${info.isAuto ? ` <span style="color:#19f3f7;">→ ${info.effectiveLabel}</span>` : ''}</div>
            </div>
            <div style="flex:1;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <div style="${S.label} margin-bottom:0;">Current Time</div>
                <div style="display:flex; gap:4px;">
                  <button id="ncm-tc-datefmt-toggle" style="${S.btn} font-size:9px !important; padding:2px 8px !important;"><i class="fas fa-calendar-days" style="font-size:7px;"></i> <span id="ncm-tc-datefmt-label">${dateFmtLabels[initDateFmt]}</span></button>
                  <button id="ncm-tc-12h-toggle" style="${S.btn} font-size:9px !important; padding:2px 8px !important;"><i class="fas fa-clock" style="font-size:7px;"></i> <span id="ncm-tc-12h-label">${initFormat}</span></button>
                </div>
              </div>
              <div style="${S.value}" id="ncm-tc-clock">—</div>
            </div>
          </div>
          <div style="${S.sep}"></div>
          <div style="${S.row} margin-bottom:0;">
            <div style="flex:1;">
              <div style="${S.monoSm}"><i class="fas fa-calendar" style="font-size:8px; margin-right:4px;"></i> SimpleCalendar: ${scBadge}</div>
            </div>
            <div style="flex:1;">
              <div style="${S.monoSm}"><i class="fas fa-clock" style="font-size:8px; margin-right:4px;"></i> SmallTime: ${stBadge}</div>
            </div>
          </div>
        </div>

        <!-- Mode Selector -->
        <div style="${S.panel}">
          <div style="${S.label}">Time Provider</div>
          <select id="ncm-tc-mode" style="${S.select}">
            <option value="auto" ${info.mode === 'auto' ? 'selected' : ''}>Auto-Detect (recommended)</option>
            <option value="simple-calendar" ${info.mode === 'simple-calendar' ? 'selected' : ''} ${!info.hasSimpleCalendar ? 'disabled' : ''}>SimpleCalendar${!info.hasSimpleCalendar ? ' (not installed)' : ''}</option>
            <option value="world-time" ${info.mode === 'world-time' ? 'selected' : ''}>Foundry World Time${info.hasSmallTime ? ' (SmallTime)' : ''}</option>
            <option value="real-time" ${info.mode === 'real-time' ? 'selected' : ''}>Real-World Time</option>
            <option value="manual" ${info.mode === 'manual' ? 'selected' : ''}>Manual (GM Set)</option>
            <option value="disguised" ${info.mode === 'disguised' ? 'selected' : ''}>Disguised Time</option>
          </select>
          <div style="${S.hint}" id="ncm-tc-hint">Select how NCM determines in-game time.</div>
        </div>

        <!-- Disguised Time Config -->
        <div id="ncm-tc-disguised" style="${S.panel} ${info.mode === 'disguised' ? '' : 'display:none;'}">
          <div style="${S.label}"><i class="fas fa-masks-theater" style="font-size:9px; margin-right:4px; color:#f7c948;"></i> Disguised Time — Set Fictional Date</div>
          <div style="${S.hint} margin-bottom:8px;">The clock ticks in real-time but displays your chosen date. Set your Night City date and hit "Anchor" — the clock starts ticking from there.</div>
          <div style="${S.row}">
            <input type="date" id="ncm-tc-dis-date" value="${disDateVal}" style="${S.input} flex:1;">
            <input type="time" id="ncm-tc-dis-time" value="${disTimeVal}" style="${S.input} width:100px;">
            <button id="ncm-tc-dis-set" style="${S.btn} ${S.btnGold}"><i class="fas fa-anchor" style="font-size:9px;"></i> Anchor</button>
          </div>
          <div id="ncm-tc-dis-preview" style="border:1px solid #2a2a45; border-radius:2px; overflow:hidden; margin-bottom:8px;">
            <div style="display:flex; gap:0;">
              <div style="flex:1; padding:8px 12px; background:#12121a;">
                <div style="font-family:Share Tech Mono,monospace; font-size:9px; color:#8888a0; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px;"><i class="fas fa-globe" style="font-size:7px; margin-right:3px;"></i> Real World</div>
                <div id="ncm-tc-dis-real" style="font-family:Share Tech Mono,monospace; font-size:14px; color:#8888a0; line-height:1.2;">—</div>
              </div>
              <div style="width:1px; background:#2a2a45;"></div>
              <div style="flex:1; padding:8px 12px; background:rgba(247,201,72,0.02);">
                <div style="font-family:Share Tech Mono,monospace; font-size:9px; color:#f7c948; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:4px;"><i class="fas fa-city" style="font-size:7px; margin-right:3px;"></i> Night City Time</div>
                <div id="ncm-tc-dis-fake" style="font-family:Share Tech Mono,monospace; font-size:14px; color:#f7c948; line-height:1.2;">—</div>
              </div>
            </div>
          </div>
          <div style="${S.row} margin-bottom:0;">
            <button id="ncm-tc-dis-reanchor" style="${S.btn}"><i class="fas fa-rotate" style="font-size:9px;"></i> Re-Anchor Now</button>
            <div style="${S.hint} flex:1; margin-top:0;">Freezes current displayed time and restarts the clock from there. Use after session breaks.</div>
          </div>
        </div>

        <!-- Manual Time Config -->
        <div id="ncm-tc-manual" style="${S.panel} ${info.mode === 'manual' ? '' : 'display:none;'}">
          <div style="${S.label}"><i class="fas fa-hand" style="font-size:9px; margin-right:4px; color:#19f3f7;"></i> Manual Time — GM Controls</div>
          <div style="${S.hint} margin-bottom:8px;">Time only changes when you change it. Set a specific date/time or advance by increments.</div>
          <div style="${S.row}">
            <input type="date" id="ncm-tc-man-date" value="${dateVal}" style="${S.input} flex:1;">
            <input type="time" id="ncm-tc-man-time" value="${timeVal}" style="${S.input} width:100px;">
            <button id="ncm-tc-man-set" style="${S.btn} ${S.btnCyan}"><i class="fas fa-clock" style="font-size:9px;"></i> Set</button>
          </div>
          <div style="${S.label} margin-top:6px;">Quick Advance</div>
          <div style="${S.row} margin-bottom:0; gap:6px; flex-wrap:wrap;">
            <button class="ncm-tc-advance" data-seconds="60" style="${S.btn}">+1 min</button>
            <button class="ncm-tc-advance" data-seconds="300" style="${S.btn}">+5 min</button>
            <button class="ncm-tc-advance" data-seconds="1800" style="${S.btn}">+30 min</button>
            <button class="ncm-tc-advance" data-seconds="3600" style="${S.btn}">+1 hr</button>
            <button class="ncm-tc-advance" data-seconds="21600" style="${S.btn}">+6 hr</button>
            <button class="ncm-tc-advance" data-seconds="86400" style="${S.btn}">+1 day</button>
          </div>
        </div>

      </div>`;

    const dialog = adminDialog({
      title: 'NCM Time Configuration',
      content,
      buttons: {
        apply: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Apply Mode',
          callback: async (html) => {
            const mode = html.find('#ncm-tc-mode').val();
            await ts.setMode(mode);
            this.render(true);
          },
        },
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close',
        },
      },
      default: 'apply',
      render: (html) => {
        const modeSelect = html.find('#ncm-tc-mode');
        const disguisedPanel = html.find('#ncm-tc-disguised');
        const manualPanel = html.find('#ncm-tc-manual');
        const hintEl = html.find('#ncm-tc-hint');

        // ── Clock elements ──
        const clockEl = html.find('#ncm-tc-clock');
        const realClockEl = html.find('#ncm-tc-dis-real');
        const fakeClockEl = html.find('#ncm-tc-dis-fake');
        const toggleBtn = html.find('#ncm-tc-12h-toggle');
        const toggleLabel = html.find('#ncm-tc-12h-label');
        const dialogOpenedAt = Date.now();

        // Init toggle label from setting
        const _is12h = () => {
          try { return game.settings.get(MODULE_ID, 'timeFormat') === '12h'; } catch { return false; }
        };
        toggleLabel.text(_is12h() ? '12H' : '24H');

        // Shorthand: format with seconds using the global setting
        const _fmt = (isoStr) => formatCyberDate(isoStr, { seconds: true });

        // ── 12h/24h toggle — persists to setting, affects ALL clocks module-wide ──
        toggleBtn.on('click', async (e) => {
          e.preventDefault();
          const newFormat = _is12h() ? '24h' : '12h';
          await game.settings.set(MODULE_ID, 'timeFormat', newFormat);
          toggleLabel.text(newFormat === '12h' ? '12H' : '24H');
          updateAllClocks();
        });

        // ── Date format toggle — cycles YMD → DMY → MDY ──
        const dateFmtBtn = html.find('#ncm-tc-datefmt-toggle');
        const dateFmtLabel = html.find('#ncm-tc-datefmt-label');
        const _dateFmtLabels = { YMD: 'Y.M.D', DMY: 'D.M.Y', MDY: 'M.D.Y' };
        const _dateFmtCycle = { YMD: 'DMY', DMY: 'MDY', MDY: 'YMD' };

        dateFmtBtn.on('click', async (e) => {
          e.preventDefault();
          let current = 'YMD';
          try { current = game.settings.get(MODULE_ID, 'dateFormat') || 'YMD'; } catch { /* */ }
          const next = _dateFmtCycle[current] || 'YMD';
          await game.settings.set(MODULE_ID, 'dateFormat', next);
          dateFmtLabel.text(_dateFmtLabels[next]);
          updateAllClocks();
        });

        // ── Update all clocks ──
        const updateAllClocks = () => {
          // Main status clock
          clockEl.text(_fmt(ts.getCurrentTime()));

          // Disguised preview — only if visible
          if (disguisedPanel.is(':visible')) {
            realClockEl.text(_fmt(new Date().toISOString()));

            const date = html.find('#ncm-tc-dis-date').val();
            const time = html.find('#ncm-tc-dis-time').val();
            if (!date || !time) {
              fakeClockEl.text('Set date & time above');
              fakeClockEl.css('color', '#555570');
            } else {
              const baseMs = new Date(`${date}T${time}:00`).getTime();
              if (isNaN(baseMs)) {
                fakeClockEl.text('Invalid date');
                fakeClockEl.css('color', '#555570');
              } else {
                const elapsed = Date.now() - dialogOpenedAt;
                fakeClockEl.text(_fmt(new Date(baseMs + elapsed).toISOString()));
                fakeClockEl.css('color', '#f7c948');
              }
            }
          }
        };

        // Initial render + tick every second
        updateAllClocks();
        const clockInterval = setInterval(() => {
          if (!clockEl.closest('body').length) { clearInterval(clockInterval); return; }
          updateAllClocks();
        }, 1000);

        // Update preview when disguised inputs change
        html.find('#ncm-tc-dis-date, #ncm-tc-dis-time').on('change input', updateAllClocks);

        const hints = {
          'auto': 'Automatically picks the best available time source. Currently resolves to: ' + info.effectiveLabel,
          'simple-calendar': 'Uses SimpleCalendar\'s game clock. Requires the SimpleCalendar module.',
          'world-time': 'Uses Foundry\'s built-in world time. Compatible with SmallTime and other modules that control game.time.worldTime.',
          'real-time': 'Uses your real-world wall clock. Timestamps will reflect actual time.',
          'manual': 'Time only advances when you manually set or advance it. Full GM control.',
          'disguised': 'Real-time clock that displays a fictional date. Set "Night City, March 2045" and it ticks forward in sync with real time.',
        };

        // Mode switching
        modeSelect.on('change', () => {
          const m = modeSelect.val();
          disguisedPanel.toggle(m === 'disguised');
          manualPanel.toggle(m === 'manual');
          hintEl.text(hints[m] || '');
          updateAllClocks();
        });

        // Disguised: Anchor button
        html.find('#ncm-tc-dis-set').on('click', async () => {
          const date = html.find('#ncm-tc-dis-date').val();
          const time = html.find('#ncm-tc-dis-time').val();
          if (!date || !time) return;
          const iso = new Date(`${date}T${time}:00`).toISOString();
          await ts.setDisguisedTime(iso);
          modeSelect.val('disguised');
          disguisedPanel.show();
          manualPanel.hide();
          hintEl.text(hints['disguised']);
          ui.notifications.info(`NCM | Disguised time anchored to ${date} ${time}`);
        });

        // Disguised: Re-anchor button
        html.find('#ncm-tc-dis-reanchor').on('click', async () => {
          await ts.reanchorDisguisedTime();
          ui.notifications.info('NCM | Disguised time re-anchored to current displayed time.');
        });

        // Manual: Set button
        html.find('#ncm-tc-man-set').on('click', async () => {
          const date = html.find('#ncm-tc-man-date').val();
          const time = html.find('#ncm-tc-man-time').val();
          if (!date || !time) return;
          const iso = new Date(`${date}T${time}:00`).toISOString();
          await ts.setManualTime(iso);
          modeSelect.val('manual');
          manualPanel.show();
          disguisedPanel.hide();
          hintEl.text(hints['manual']);
          ui.notifications.info(`NCM | Manual time set to ${date} ${time}`);
        });

        // Manual: Quick advance buttons
        html.find('.ncm-tc-advance').on('click', async (e) => {
          const secs = parseInt(e.currentTarget.dataset.seconds, 10);
          if (!secs) return;
          // If not in manual mode, switch first
          if (ts._mode !== 'manual') {
            await ts.setManualTime(ts.getCurrentTime());
            modeSelect.val('manual');
            manualPanel.show();
            disguisedPanel.hide();
          }
          await ts.advanceManualTime(secs);
          // Update the date/time inputs to reflect new time
          const newTime = new Date(ts.getCurrentTime());
          html.find('#ncm-tc-man-date').val(`${newTime.getUTCFullYear()}-${String(newTime.getUTCMonth() + 1).padStart(2, '0')}-${String(newTime.getUTCDate()).padStart(2, '0')}`);
          html.find('#ncm-tc-man-time').val(`${String(newTime.getUTCHours()).padStart(2, '0')}:${String(newTime.getUTCMinutes()).padStart(2, '0')}`);
        });
      },
    }, {
      width: 460,
      height: 'auto',
      classes: ['ncm-time-config-dialog'],
    });

    dialog.render(true);
  }

  onOpenSoundSettings(event, target) {
    // Sound settings live in the Theme Customizer's Effects panel (volume slider)
    // — this is just a shortcut to that tab, not a separate surface.
    game.nightcity?.openThemeCustomizer?.({ activeTab: 'effects' });
  }

  /**
   * Open the email domain configuration dialog.
   * Simple flat list — GMs add whatever domains they want.
   */
  async onManageDomains(event, target) {
    const MODULE_ID_LOCAL = 'night-city-messenger';
    let domainList = [];
    try {
      const raw = game.settings.get(MODULE_ID_LOCAL, 'emailDomains');
      domainList = Array.isArray(raw) ? [...raw] : [];
    } catch { /* empty */ }

    const defaultDomain = game.settings.get(MODULE_ID_LOCAL, 'emailDefaultDomain') || 'nightcity.net';

    // Helper to build a single domain row
    const _buildRow = (domain = '') => `
      <div class="ncm-domain-row">
        <i class="fas fa-at ncm-domain-row__icon"></i>
        <div class="ncm-domain-row__field">
          <input type="text" class="ncm-domain-row__input" data-field="domain"
                 value="${domain}" placeholder="example.net" />
        </div>
        <button type="button" class="ncm-domain-row__clear" title="Remove domain">
          <i class="fas fa-xmark"></i>
        </button>
      </div>`;

    const rowsHTML = domainList.length
      ? domainList.map(d => _buildRow(d)).join('')
      : '';

    const dialogContent = `
      <div class="ncm-domain-dialog">
        <div class="ncm-domain-dialog__header">
          <div class="ncm-domain-dialog__title">Email Domains</div>
          <div class="ncm-domain-dialog__hint">Add domains players can pick during email setup.</div>
        </div>

        <div class="ncm-domain-dialog__default">
          <span class="ncm-domain-dialog__default-label">Default Domain</span>
          <div class="ncm-domain-dialog__default-field">
            <input type="text" class="ncm-domain-row__input" id="ncm-default-domain"
                   value="${defaultDomain}" placeholder="nightcity.net" />
          </div>
          <span class="ncm-domain-dialog__default-hint">fallback</span>
        </div>

        <div class="ncm-domain-dialog__divider"></div>

        <div class="ncm-domain-dialog__list-label">Additional Domains</div>
        <div class="ncm-domain-dialog__list" id="ncm-domain-list">
          ${rowsHTML}
        </div>

        <button type="button" class="ncm-domain-dialog__add" id="ncm-add-domain">
          <i class="fas fa-plus"></i> Add Domain
        </button>

        <div class="ncm-domain-dialog__divider"></div>

        <div class="ncm-domain-dialog__footer">
          <label class="ncm-domain-dialog__custom-toggle">
            <input type="checkbox" id="ncm-allow-custom" ${(game.settings.get(MODULE_ID_LOCAL, 'emailAllowCustomDomains') ?? true) ? 'checked' : ''} />
            Allow players to type custom domains
          </label>
        </div>
      </div>
    `;

    const dialog = adminDialog({
      title: 'Email Domain Configuration',
      content: dialogContent,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: 'Save',
          callback: async (html) => {
            const domains = [];
            html.find('.ncm-domain-row [data-field="domain"]').each((_, input) => {
              const v = input.value?.trim();
              if (v) domains.push(v);
            });

            const newDefault = html.find('#ncm-default-domain').val()?.trim() || 'nightcity.net';
            const allowCustom = html.find('#ncm-allow-custom').is(':checked');

            await game.settings.set(MODULE_ID_LOCAL, 'emailDomains', domains);
            await game.settings.set(MODULE_ID_LOCAL, 'emailDefaultDomain', newDefault);
            await game.settings.set(MODULE_ID_LOCAL, 'emailAllowCustomDomains', allowCustom);

            const total = domains.length + 1; // +1 for default
            ui.notifications.info(`NCM | Saved ${total} domain${total !== 1 ? 's' : ''}.`);
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel',
        },
      },
      default: 'save',
      render: (html) => {
        const list = html.find('#ncm-domain-list')[0];

        // Add domain button
        html.find('#ncm-add-domain').on('click', () => {
          const temp = document.createElement('div');
          temp.innerHTML = _buildRow().trim();
          const row = temp.firstElementChild;
          list.appendChild(row);
          // Wire remove
          row.querySelector('.ncm-domain-row__clear')?.addEventListener('click', () => row.remove());
          // Focus the new input
          row.querySelector('.ncm-domain-row__input')?.focus();
        });

        // Wire existing remove buttons
        html.find('.ncm-domain-row__clear').on('click', function () {
          this.closest('.ncm-domain-row')?.remove();
        });
      },
    }, {
      classes: ['ncm-pick-dialog'],
      width: 460,
      height: 'auto',
    });

    dialog.render(true);
  }

  /**
   * Reorganize NCM journals into subfolders with human-readable names.
   * Runs the migration tool from MessageRepository.
   */
  async onReorganizeJournals(event, target) {
    const confirmed = await adminConfirm({
      title: 'Reorganize Journals',
      content: `<p>This will:</p>
        <ul style="margin: 8px 0 8px 16px; font-size: 13px;">
          <li>Create subfolders: <b>Inboxes</b>, <b>NPC Mail</b>, <b>Data Shards</b>, <b>Deleted</b></li>
          <li>Rename journals to readable names (e.g. "V — Inbox")</li>
          <li>Rename message pages (e.g. "Rogue — Need your help | 03/15/2045")</li>
          <li>Move journals into correct subfolders</li>
        </ul>
        <p>This is safe to run multiple times and won't delete any data.</p>`,
    });
    if (!confirmed) return;

    const repo = game.nightcity?.messageRepository;
    if (!repo) return ui.notifications.error('NCM | MessageRepository not available.');

    const stats = await repo.migrateJournalOrganization();
    const total = stats.inboxes + stats.contacts + stats.shards;
    if (total > 0 || stats.pages > 0) {
      ui.notifications.info(
        `NCM | Done: ${stats.inboxes} inbox(es), ${stats.contacts} NPC mail, ${stats.shards} shard(s), ${stats.pages} page(s) renamed.`
      );
    } else {
      ui.notifications.info('NCM | Journals are already organized — nothing to do.');
    }
  }

  /**
   * Import / reinstall the NCM macro compendiums into world folders.
   *
   * This IS the explicit "reinstall": the compendium packs are canonical and
   * never auto-write to the world. Each click imports missing macros and
   * overwrites the body/name/img of macros this module created (flag
   * `managed: true`). Macros the GM authored or un-managed are never touched.
   */
  async onImportMacros(event, target) {
    const confirmed = await adminConfirm({
      title: 'Import / Reinstall NCM Macros',
      content: `<p>Import the Night City Messenger macro compendiums into your world:</p>
        <ul style="margin: 8px 0 8px 16px; font-size: 13px;">
          <li>Folders <b>NCM — Player Tools</b> and <b>NCM — GM Tools</b></li>
          <li>Missing macros are created; module-managed macros are reset to the shipped version</li>
          <li>Your own macros and any you've detached are <b>never</b> overwritten</li>
        </ul>
        <p>Player Tools are shared with players (Observer); GM Tools stay GM-only.</p>`,
    });
    if (!confirmed) return;

    const specs = [
      { pack: `${MODULE_ID}.ncm-macros-player`, folder: 'NCM — Player Tools' },
      { pack: `${MODULE_ID}.ncm-macros-gm`, folder: 'NCM — GM Tools' },
    ];

    let created = 0;
    let updated = 0;
    let skipped = 0;

    try {
      for (const spec of specs) {
        const pack = game.packs.get(spec.pack);
        if (!pack) {
          ui.notifications.warn(`NCM | Compendium "${spec.pack}" not found — is the module fully loaded?`);
          continue;
        }

        let folder = game.folders.find(f => f.type === 'Macro' && f.name === spec.folder);
        if (!folder) folder = await Folder.create({ name: spec.folder, type: 'Macro' });

        const sources = await pack.getDocuments();
        for (const src of sources) {
          const sourceId = src.getFlag(MODULE_ID, 'sourceId') ?? src.id;
          const existing = game.macros.find(m => m.getFlag(MODULE_ID, 'sourceId') === sourceId);

          const data = {
            name: src.name,
            type: 'script',
            img: src.img,
            scope: 'global',
            command: src.command,
            folder: folder.id,
            ownership: { default: src.ownership?.default ?? 0 },
            flags: { [MODULE_ID]: { managed: true, sourceId } },
          };

          if (!existing) {
            await Macro.create(data);
            created++;
          } else if (existing.getFlag(MODULE_ID, 'managed') === true) {
            await existing.update(data);
            updated++;
          } else {
            skipped++; // GM detached this one — leave it alone
          }
        }
      }

      log.info(`NCM macros: ${created} created, ${updated} reset, ${skipped} preserved`);
      ui.notifications.info(
        `NCM | Macros installed — ${created} new, ${updated} reset to shipped, ${skipped} preserved.`
      );
    } catch (error) {
      console.error(`${MODULE_ID} | Macro import failed:`, error);
      ui.notifications.error('NCM | Macro import failed. Check console.');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Danger Zone
  // ═══════════════════════════════════════════════════════════

  async onPurgeMessages(event, target) {
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // ── Gather purge targets: character/contact inboxes + data shards ──
    const inboxTargets = [];
    for (const journal of game.journal ?? []) {
      const info = MessageRepository.identifyInbox(journal);
      if (!info) continue;
      const count = journal.pages.filter(p => p.flags?.[MODULE_ID]?.messageId).length;
      if (count === 0) continue;
      const name = info.isContact
        ? (this.masterContactService?.getContact?.(info.ownerId)?.name || journal.name || 'Contact')
        : (game.actors?.get(info.ownerId)?.name || journal.name || 'Actor');
      inboxTargets.push({
        key: `inbox:${journal.id}`,
        group: info.isContact ? 'Contact Inboxes' : 'Character Inboxes',
        label: `${name} (${count})`,
        journalId: journal.id,
        count,
      });
    }

    const shardTargets = [];
    for (const shard of this._collectDataShards()) {
      const count = (this.dataShardService?.getShardMessages?.(shard) ?? []).length;
      if (count === 0) continue;
      shardTargets.push({
        key: `shard:${shard.uuid}`,
        group: 'Data Shards',
        label: `${shard.name} (${count})`,
        shardUuid: shard.uuid,
        count,
      });
    }

    const all = [...inboxTargets, ...shardTargets];
    if (all.length === 0) {
      ui.notifications.info('NCM | No messages to purge.');
      return;
    }

    // ── Build the grouped picker ──
    const inboxTotal = inboxTargets.reduce((s, t) => s + t.count, 0);
    const groups = {};
    for (const t of all) (groups[t.group] ||= []).push(t);
    let optionsHtml = '<option value="">— Select a target —</option>';
    if (inboxTargets.length > 0) {
      optionsHtml += `<option value="all-inboxes">⚠ ALL inboxes — character + contact (${inboxTotal})</option>`;
    }
    for (const [group, items] of Object.entries(groups)) {
      optionsHtml += `<optgroup label="${esc(group)}">`;
      for (const t of items) optionsHtml += `<option value="${esc(t.key)}">${esc(t.label)}</option>`;
      optionsHtml += '</optgroup>';
    }

    const content = `
      <div class="ncm-purge-dialog">
        <p>Choose what to purge. The number in parentheses is the message count. This permanently deletes those messages and <strong>cannot be undone</strong>.</p>
        <select id="ncm-purge-target" name="target" style="width:100%; margin-top:6px;">${optionsHtml}</select>
      </div>`;

    let selected = null;
    await new Promise((resolve) => {
      adminDialog({
        title: '⚠ Purge Messages',
        content,
        buttons: {
          purge: {
            icon: '<i class="fas fa-trash"></i>',
            label: 'Purge…',
            callback: (html) => { selected = html.find('#ncm-purge-target').val() || null; },
          },
          cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
        },
        default: 'cancel',
        close: () => resolve(),
      }).render(true);
    });

    if (!selected) return;

    // Resolve the confirm label + count.
    let label, count;
    if (selected === 'all-inboxes') { label = 'ALL inboxes'; count = inboxTotal; }
    else { const t = all.find(x => x.key === selected); label = t?.label ?? 'target'; count = t?.count ?? 0; }

    const confirmed = await adminConfirm({
      title: '⚠ Confirm Purge',
      content: `<p>Permanently delete <strong>${count}</strong> message(s) from <strong>${esc(label)}</strong>?</p><p style="color:#ff0033;"><strong>This cannot be undone.</strong></p>`,
    });
    if (!confirmed) return;

    // ── Execute ──
    try {
      let deleted = 0;
      if (selected === 'all-inboxes') {
        for (const t of inboxTargets) deleted += await this._purgeInboxJournal(t.journalId);
      } else if (selected.startsWith('inbox:')) {
        deleted += await this._purgeInboxJournal(all.find(x => x.key === selected)?.journalId);
      } else if (selected.startsWith('shard:')) {
        deleted += await this._purgeShard(all.find(x => x.key === selected)?.shardUuid);
      }
      log.info(`Purged ${deleted} message(s) from ${label}`);
      ui.notifications.info(`NCM | Purged ${deleted} message(s) from ${label}.`);
      this.app?.render?.(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Purge failed:`, error);
      ui.notifications.error('NCM | Purge failed. Check console.');
    }
  }

  /** Collect every data-shard Item (world + actor-owned). */
  _collectDataShards() {
    const shards = [];
    for (const item of game.items ?? []) {
      if (item.getFlag(MODULE_ID, 'isDataShard') === true) shards.push(item);
    }
    for (const actor of game.actors ?? []) {
      for (const item of actor.items ?? []) {
        if (item.getFlag(MODULE_ID, 'isDataShard') === true) shards.push(item);
      }
    }
    return shards;
  }

  /** Delete every message page in an inbox journal (keeps the empty inbox). */
  async _purgeInboxJournal(journalId) {
    const journal = journalId ? game.journal?.get(journalId) : null;
    if (!journal) return 0;
    const pageIds = journal.pages.filter(p => p.flags?.[MODULE_ID]?.messageId).map(p => p.id);
    if (pageIds.length === 0) return 0;
    await journal.deleteEmbeddedDocuments('JournalEntryPage', pageIds);
    return pageIds.length;
  }

  /** Delete every entry from a data shard (keeps the shard item). */
  async _purgeShard(shardUuid) {
    const shard = shardUuid ? await fromUuid(shardUuid) : null;
    if (!shard) return 0;
    const entries = this.dataShardService?.getShardMessages?.(shard) ?? [];
    let n = 0;
    for (const entry of entries) {
      const r = await this.dataShardService?.removeMessage?.(shard, entry.messageId);
      if (r?.success) n++;
    }
    return n;
  }

  // ═══════════════════════════════════════════════════════════
  //  Orphan Audit — find & clean NCM data whose owner is gone
  // ═══════════════════════════════════════════════════════════

  /**
   * Scan for orphans: inbox journals whose actor/master-contact no longer
   * exists, scene pins pointing at deleted terminal items, and heat entries
   * for deleted actors. Reports findings and offers a confirmed cleanup.
   */
  async onOrphanAudit(event, target) {
    const found = this._gatherOrphans();
    const total = found.inboxes.length + found.pins.length + found.heatActors.length;

    if (total === 0) {
      ui.notifications.info('NCM | Orphan audit clean — nothing to remove.');
      return;
    }

    const li = (s) => `<li>${s}</li>`;
    const lines = [];
    if (found.inboxes.length) {
      lines.push(`<p><strong>${found.inboxes.length}</strong> inbox journal(s) whose owner no longer exists:</p><ul>` +
        found.inboxes.map(o => li(`${o.journal.name} <em>(${o.isContact ? 'contact' : 'actor'} ${o.ownerId})</em>`)).join('') + '</ul>');
    }
    if (found.pins.length) {
      lines.push(`<p><strong>${found.pins.length}</strong> scene pin(s) pointing at deleted terminals:</p><ul>` +
        found.pins.map(p => li(`"${p.note.label || p.note.text || 'unnamed pin'}" on ${p.scene.name}`)).join('') + '</ul>');
    }
    if (found.heatActors.length) {
      lines.push(`<p><strong>${found.heatActors.length}</strong> heat entr(ies) keyed to deleted actors.</p>`);
    }

    let doClean = false;
    await new Promise((resolve) => {
      adminDialog({
        title: 'Orphan Audit',
        content: `<div style="max-height:320px;overflow-y:auto;overflow-x:hidden">${lines.join('')}<p>Remove all of the above? Message pages inside a removed inbox are deleted with it.</p></div>`,
        buttons: {
          clean:  { icon: '<i class="fas fa-broom"></i>', label: 'Clean Up', callback: () => { doClean = true; } },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'cancel',
        close: () => resolve(),
      }).render(true);
    });
    if (!doClean) return;

    try {
      let removed = 0;
      for (const o of found.inboxes) { await o.journal.delete(); removed++; }
      for (const p of found.pins)    { await p.note.delete();    removed++; }
      if (found.heatActors.length) {
        const map = foundry.utils.deepClone(game.settings.get(MODULE_ID, 'traceHeat') ?? {});
        for (const { objectId, actorId } of found.heatActors) {
          if (map[objectId]) {
            delete map[objectId][actorId];
            if (Object.keys(map[objectId]).length === 0) delete map[objectId];
            removed++;
          }
        }
        await game.settings.set(MODULE_ID, 'traceHeat', map);
      }
      log.info(`Orphan audit removed ${removed} orphaned record(s)`);
      ui.notifications.info(`NCM | Orphan audit removed ${removed} orphaned record(s).`);
      this.app?.render?.(false);
    } catch (error) {
      console.error(`${MODULE_ID} | Orphan cleanup failed:`, error);
      ui.notifications.error('NCM | Orphan cleanup failed. Check console.');
    }
  }

  /**
   * Factory Reset — Danger Zone. Shows a census of everything the reset will
   * touch, requires the GM to type RESET, then runs {@link runFactoryReset}
   * (which reloads every client). The "reset world settings" checkbox lets a
   * GM wipe the DATA but keep networks / the master directory / templates.
   */
  async onFactoryReset(event, target) {
    if (!game.user?.isGM) return;
    const plan = gatherResetPlan();
    const li = (s) => `<li>${s}</li>`;
    const rows = [
      li(`<b>${plan.journals}</b> NCM journal(s) — inboxes, NPC mail, shard &amp; terminal journals — and the <b>${plan.folders}</b>-folder "Night City Messenger" tree`),
      li(`<b>${plan.pins}</b> terminal scene pin(s)`),
      li(`<b>${plan.managedMacros}</b> module-installed macro(s) (your own macros are kept)`),
      ...plan.flagged.map(f => li(`<b>${f.count}</b> NCM flag block(s) on <code>${f.label}</code> — contacts, emails, shard/terminal conversions, scene networks…`)),
    ];
    const content = `
      <div style="max-height:360px; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:8px;">
        <p style="margin:0; color:var(--ncm-danger); font-weight:700;">
          <i class="fas fa-triangle-exclamation"></i> This returns the world to "NCM was never installed". It cannot be undone — back up the world first.
        </p>
        <ul style="margin:0 0 0 16px; padding:0;">${rows.join('')}</ul>
        <label class="ncm-fr-opt" style="display:flex; align-items:center; gap:8px; text-transform:none; font-weight:400; cursor:pointer;">
          <input type="checkbox" name="resetSettings" checked>
          <span>Also reset <b>${plan.settings}</b> world setting(s) to defaults — networks, master contact directory, spam / entry / theme templates, security log &amp; heat, module preferences. Untick to wipe the data but keep your configuration.</span>
        </label>
        <p style="margin:0; font-size:11px; color:var(--ncm-text-secondary);">Compendium packs and each player's own client preferences (theme, sound) are never touched. Every client reloads when it finishes.</p>
        <label style="display:flex; flex-direction:column; gap:4px; text-transform:none; font-weight:400;">
          <span>Type <b>RESET</b> to enable the button:</span>
          <input type="text" name="confirmWord" autocomplete="off" spellcheck="false" style="font-family:var(--ncm-font-mono); letter-spacing:.1em;">
        </label>
      </div>`;

    let go = false;
    let resetSettings = true;
    await new Promise((resolve) => {
      const dlg = adminDialog({
        title: 'Factory Reset — Night City Messenger',
        content,
        buttons: {
          reset: {
            icon: '<i class="fas fa-bomb"></i>',
            label: 'Factory Reset',
            callback: (html) => {
              const word = (html.find('[name="confirmWord"]').val() || '').trim().toUpperCase();
              if (word !== 'RESET') { ui.notifications.warn('NCM | Type RESET to confirm.'); return; }
              resetSettings = html.find('[name="resetSettings"]').is(':checked');
              go = true;
            },
          },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'cancel',
        render: (html) => {
          // The button starts disabled and only arms once the word is typed —
          // a click-through on a reset dialog must be impossible.
          const btn = html.find('button[data-button="reset"]');
          btn.prop('disabled', true);
          html.find('[name="confirmWord"]').on('input', (e) => {
            btn.prop('disabled', (e.currentTarget.value || '').trim().toUpperCase() !== 'RESET');
          });
        },
        close: () => resolve(),
      }, { width: 520, classes: ['ncm-time-config-dialog'] });
      dlg.render(true);
    });
    if (!go) return;

    try {
      ui.notifications.info('NCM | Factory reset running…');
      const r = await runFactoryReset({ resetSettings, reload: true });
      ui.notifications.info(
        `NCM | Factory reset done — ${r.journals} journal(s), ${r.pins} pin(s), ${r.macros} macro(s), `
        + `${r.stripped} flag block(s), ${r.settings} setting(s). Reloading.`,
        { permanent: true }
      );
    } catch (error) {
      console.error(`${MODULE_ID} | Factory reset failed:`, error);
      ui.notifications.error(`NCM | Factory reset failed: ${error?.message || error}. Check the console; the world may be partly reset.`, { permanent: true });
    }
  }

  /** Collect every orphaned inbox journal, stale terminal scene pin, and dead-actor heat entry. */
  _gatherOrphans() {
    const inboxes = [];
    for (const journal of game.journal ?? []) {
      const info = MessageRepository.identifyInbox(journal);
      if (!info) continue;
      const exists = info.isContact
        ? !!this.masterContactService?.getContact?.(info.ownerId)
        : !!game.actors?.get(info.ownerId);
      if (!exists) inboxes.push({ journal, ...info });
    }

    const pins = [];
    for (const scene of game.scenes ?? []) {
      for (const note of scene.notes ?? []) {
        const itemId = note.getFlag?.(MODULE_ID, 'terminalItemId');
        if (itemId && !game.items?.get(itemId)) pins.push({ scene, note });
      }
    }

    const heatActors = [];
    let heatMap = {};
    try { heatMap = game.settings.get(MODULE_ID, 'traceHeat') ?? {}; } catch { /* setting absent */ }
    for (const [objectId, byActor] of Object.entries(heatMap)) {
      for (const actorId of Object.keys(byActor ?? {})) {
        if (!game.actors?.get(actorId)) heatActors.push({ objectId, actorId });
      }
    }

    return { inboxes, pins, heatActors };
  }
}
