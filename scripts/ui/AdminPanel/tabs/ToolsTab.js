/**
 * ToolsTab — System tools and danger-zone actions.
 * @file scripts/ui/AdminPanel/tabs/ToolsTab.js
 * @module cyberpunkred-messenger
 *
 * No tab-local state, no DOM wire-up, no context fragment —
 * tab-tools.hbs is a grid of action buttons that call these
 * handlers directly via AdminPanelApp's static delegators.
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log, formatCyberDate } from '../../../utils/helpers.js';
import { BaseTab } from '../BaseTab.js';

export class ToolsTab extends BaseTab {

  get key() { return 'tools'; }

  // ═══════════════════════════════════════════════════════════
  //  System Tools
  // ═══════════════════════════════════════════════════════════

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

    await Dialog.prompt({
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

    const dialog = new Dialog({
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
    // Open sound configuration dialog
    ui.notifications.info('Sound settings — coming in a future update.');
  }

  /**
   * Open the email domain configuration dialog.
   * Simple flat list — GMs add whatever domains they want.
   */
  async onManageDomains(event, target) {
    const MODULE_ID_LOCAL = 'cyberpunkred-messenger';
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

    const dialog = new Dialog({
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
    const confirmed = await Dialog.confirm({
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

  // ═══════════════════════════════════════════════════════════
  //  Danger Zone
  // ═══════════════════════════════════════════════════════════

  async onPurgeMessages(event, target) {
    const confirmed = await Dialog.confirm({
      title: '⚠ Purge Messages',
      content: '<p>Select an actor and delete ALL their messages? This cannot be undone.</p>',
    });
    if (!confirmed) return;

    // TODO: Show actor picker, then purge
    ui.notifications.info('Purge feature requires actor selection dialog.');
  }

  async onResetModule(event, target) {
    const confirmed = await Dialog.confirm({
      title: '⚠ RESET MODULE',
      content: '<p style="color: #ff0033;"><strong>This will permanently delete ALL Night City Messenger data.</strong></p><p>All messages, contacts, shards, and settings will be lost. This cannot be undone.</p>',
    });
    if (!confirmed) return;

    // Double-confirm
    const reallyConfirmed = await Dialog.confirm({
      title: '⚠ ARE YOU ABSOLUTELY SURE?',
      content: '<p>Type RESET to confirm — all data will be destroyed.</p>',
    });
    if (!reallyConfirmed) return;

    ui.notifications.warn('Module reset not yet implemented — safety measure.');
  }

  async onRebuildIndex(event, target) {
    ui.notifications.info('Rebuilding journal and contact indices...');
    try {
      await game.nightcity?.messageRepository?.rebuildIndex?.();
      await game.nightcity?.contactRepository?.rebuildIndex?.();
      ui.notifications.info('Index rebuild complete.');
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | Rebuild failed:`, error);
      ui.notifications.error('Rebuild failed. Check console.');
    }
  }
}
