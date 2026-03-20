/**
 * CyberTimePicker — Format-Aware Timestamp Picker
 * @file scripts/ui/components/CyberTimePicker.js
 * @module cyberpunkred-messenger
 *
 * @description Interactive timestamp dialog with cyberpunk styling.
 *   Reads timeFormat (24h/12h) and dateFormat (YMD/DMY/MDY) from
 *   NCM settings. Defaults to in-game time via TimeService.
 *   Preview mirrors formatCyberDate() output.
 *
 * @example
 *   import { CyberTimePicker } from '../components/CyberTimePicker.js';
 *   CyberTimePicker.open({
 *     value: '2045-03-14T22:47:00.000Z',
 *     onSet: (isoString, formatted) => { ... },
 *     onClear: () => { ... },
 *   });
 */

import { MODULE_ID } from '../../utils/constants.js';
import { formatCyberDate } from '../../utils/helpers.js';

export class CyberTimePicker {

  /**
   * Open the timestamp picker dialog.
   * @param {object} options
   * @param {string} [options.value] - Current ISO timestamp (or empty)
   * @param {string} [options.title='Set Timestamp'] - Dialog title
   * @param {Function} options.onSet - Callback: (isoString, formattedString) => void
   * @param {Function} [options.onClear] - Callback when cleared
   */
  static open(options = {}) {
    const picker = new CyberTimePicker(options);
    picker._render();
  }

  constructor(options) {
    this.onSet = options.onSet || (() => {});
    this.onClear = options.onClear || (() => {});
    this.title = options.title || 'Set Timestamp';

    // ─── Read format settings ───
    try { this._use12h = game.settings.get(MODULE_ID, 'timeFormat') === '12h'; } catch { this._use12h = false; }
    try { this._dateFmt = game.settings.get(MODULE_ID, 'dateFormat') || 'YMD'; } catch { this._dateFmt = 'YMD'; }

    // ─── Initialize from value or game time ───
    let initDate;
    if (options.value) {
      initDate = new Date(options.value);
      if (isNaN(initDate.getTime())) initDate = null;
    }
    if (!initDate) {
      // Default to game time
      const ts = game.nightcity?.timeService;
      try {
        const gt = ts?.getCurrentTime?.();
        initDate = (gt instanceof Date && !isNaN(gt.getTime())) ? gt : null;
      } catch { /* fall through */ }
      if (!initDate && game.time?.worldTime) {
        initDate = new Date(game.time.worldTime * 1000);
      }
      if (!initDate || isNaN(initDate.getTime())) {
        initDate = new Date();
      }
    }

    this._year = initDate.getFullYear();
    this._month = initDate.getMonth() + 1;
    this._day = initDate.getDate();
    this._hour = initDate.getHours();     // Always stored 0-23
    this._min = initDate.getMinutes();
    this._hasValue = !!options.value;

    this._dialog = null;
  }

  // ═══════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════

  _pad(n) { return String(n).padStart(2, '0'); }

  /** Build ISO string from current state */
  _toISO() {
    return `${this._year}-${this._pad(this._month)}-${this._pad(this._day)}T${this._pad(this._hour)}:${this._pad(this._min)}:00.000Z`;
  }

  /** Build formatted string matching formatCyberDate() */
  _toFormatted() {
    // Date portion
    let dateStr;
    switch (this._dateFmt) {
      case 'DMY': dateStr = `${this._pad(this._day)}.${this._pad(this._month)}.${this._year}`; break;
      case 'MDY': dateStr = `${this._pad(this._month)}.${this._pad(this._day)}.${this._year}`; break;
      default:    dateStr = `${this._year}.${this._pad(this._month)}.${this._pad(this._day)}`; break;
    }

    // Time portion
    let timeStr;
    if (this._use12h) {
      let hr = this._hour % 12 || 12;
      const ampm = this._hour >= 12 ? 'PM' : 'AM';
      timeStr = `${hr}:${this._pad(this._min)} ${ampm}`;
    } else {
      timeStr = `${this._pad(this._hour)}:${this._pad(this._min)}`;
    }

    return `${dateStr} // ${timeStr}`;
  }

  /** Get the 12h display hour */
  _displayHour12() { return this._hour % 12 || 12; }

  /** Is PM? */
  _isPM() { return this._hour >= 12; }

  // ═══════════════════════════════════════════════
  //  Inline Styles
  // ═══════════════════════════════════════════════

  get _S() {
    return {
      root:        'font-family:Rajdhani,sans-serif; color:#e0e0e8; user-select:none; overflow:hidden;',
      presetRow:   'display:flex; gap:4px; flex-wrap:wrap; padding:0 0 10px; border-bottom:1px solid #1a1a2e; margin-bottom:10px;',
      preset:      'display:inline-flex; align-items:center; gap:4px; font-family:Rajdhani,sans-serif; font-size:11px; font-weight:600; color:#8888a0; background:rgba(136,136,160,0.06); border:1px solid rgba(136,136,160,0.15); border-radius:3px; padding:3px 7px; cursor:pointer; transition:all 0.15s; white-space:nowrap;',
      presetIcon:  'font-size:9px;',
      sectionLbl:  'font-family:Rajdhani,sans-serif; font-size:10px; font-weight:600; color:#555570; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;',
      dateRow:     'display:flex; align-items:center; gap:4px; margin-bottom:14px;',
      fieldGroup:  'display:flex; flex-direction:column; align-items:center; gap:2px;',
      fieldHint:   'font-size:8px; font-weight:600; color:#444460; text-transform:uppercase; letter-spacing:0.06em;',
      input:       'font-family:Share Tech Mono,monospace; font-size:15px; color:#e0e0e8; background:#12121a; border:1px solid #2a2a45; border-radius:3px; padding:5px 3px; text-align:center; width:100%; outline:none; transition:border-color 0.15s;',
      inputYear:   'width:64px;',
      inputMD:     'width:42px;',
      inputHM:     'width:42px;',
      sep:         'font-family:Share Tech Mono,monospace; font-size:15px; color:#444460; padding:0 1px; margin-top:10px;',
      timeRow:     'display:flex; align-items:center; gap:4px; margin-bottom:14px;',
      colon:       'font-family:Share Tech Mono,monospace; font-size:18px; font-weight:700; color:#19f3f7; margin-top:10px;',
      spinCol:     'display:flex; flex-direction:column; gap:1px; margin-top:10px;',
      spinBtn:     'display:flex; align-items:center; justify-content:center; width:18px; height:14px; background:#12121a; border:1px solid #2a2a45; border-radius:2px; color:#555570; cursor:pointer; font-size:7px; transition:all 0.1s;',
      ampmCol:     'display:flex; flex-direction:column; gap:2px; margin-top:10px; margin-left:4px;',
      ampmBtn:     'display:flex; align-items:center; justify-content:center; font-family:Share Tech Mono,monospace; font-size:10px; font-weight:400; width:32px; height:18px; background:#12121a; border:1px solid #2a2a45; border-radius:2px; color:#555570; cursor:pointer; transition:all 0.15s; letter-spacing:0.04em;',
      ampmActive:  'color:#19f3f7; border-color:rgba(25,243,247,0.4); background:rgba(25,243,247,0.08); font-weight:700;',
      preview:     'background:#08080e; border:1px solid #1e1e30; border-radius:4px; padding:8px 12px; position:relative; overflow:hidden;',
      previewLbl:  'font-size:8px; font-weight:600; color:#444460; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:6px;',
      previewDate: 'font-family:Share Tech Mono,monospace; font-size:18px; font-weight:400; color:#19f3f7; letter-spacing:0.03em; text-shadow:0 0 12px rgba(25,243,247,0.25); line-height:1; margin-bottom:4px;',
      previewISO:  'font-family:Share Tech Mono,monospace; font-size:10px; color:#444460; letter-spacing:0.02em;',
      scanlines:   'position:absolute; top:0; left:0; right:0; bottom:0; background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(25,243,247,0.008) 2px,rgba(25,243,247,0.008) 4px); pointer-events:none;',
      gradientBar: 'position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(25,243,247,0.15) 30%,rgba(25,243,247,0.15) 70%,transparent);',
    };
  }

  // ═══════════════════════════════════════════════
  //  Rendering
  // ═══════════════════════════════════════════════

  _render() {
    const content = `<div class="ncm-ctp-dialog" style="${this._S.root}">
      ${this._buildPresets()}
      ${this._buildDateSection()}
      ${this._buildTimeSection()}
      ${this._buildPreview()}
    </div>`;

    this._dialog = new Dialog({
      title: this.title,
      content,
      buttons: {
        set: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Set',
          callback: () => {
            this.onSet(this._toISO(), this._toFormatted());
          },
        },
        clear: {
          icon: '<i class="fas fa-eraser"></i>',
          label: 'Clear',
          callback: () => { this.onClear(); },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Cancel',
        },
      },
      default: 'set',
      render: (html) => this._bindEvents(html),
    }, {
      width: 320,
      height: 'auto',
      classes: ['ncm-time-config-dialog', 'ncm-ctp-wrapper'],
    });

    this._dialog.render(true);
  }

  _rerender() {
    if (!this._dialog?.element?.length) return;
    const container = this._dialog.element.find('.ncm-ctp-dialog');
    if (!container.length) return;
    container.html(`
      ${this._buildPresets()}
      ${this._buildDateSection()}
      ${this._buildTimeSection()}
      ${this._buildPreview()}
    `);
    this._bindEvents(this._dialog.element);
  }

  // ═══════════════════════════════════════════════
  //  Build Presets
  // ═══════════════════════════════════════════════

  _buildPresets() {
    const S = this._S;
    return `<div style="${S.presetRow}">
      <div class="ncm-ctp-preset" data-preset="game" style="${S.preset}"><i class="fas fa-gamepad" style="${S.presetIcon}"></i> Game Time</div>
      <div class="ncm-ctp-preset" data-preset="now" style="${S.preset}"><i class="fas fa-bolt" style="${S.presetIcon}"></i> Real Now</div>
      <div class="ncm-ctp-preset" data-preset="plus1h" style="${S.preset}"><i class="fas fa-forward" style="${S.presetIcon}"></i> +1 Hour</div>
      <div class="ncm-ctp-preset" data-preset="plus1d" style="${S.preset}"><i class="fas fa-calendar-plus" style="${S.presetIcon}"></i> +1 Day</div>
    </div>`;
  }

  // ═══════════════════════════════════════════════
  //  Build Date Section
  // ═══════════════════════════════════════════════

  _buildDateSection() {
    const S = this._S;

    const yearField = `<div style="${S.fieldGroup}">
      <span style="${S.fieldHint}">Year</span>
      <input type="text" class="ncm-ctp-inp" data-field="year" style="${S.input} ${S.inputYear}" value="${this._year}" maxlength="4" />
    </div>`;

    const monthField = `<div style="${S.fieldGroup}">
      <span style="${S.fieldHint}">Month</span>
      <input type="text" class="ncm-ctp-inp" data-field="month" style="${S.input} ${S.inputMD}" value="${this._pad(this._month)}" maxlength="2" />
    </div>`;

    const dayField = `<div style="${S.fieldGroup}">
      <span style="${S.fieldHint}">Day</span>
      <input type="text" class="ncm-ctp-inp" data-field="day" style="${S.input} ${S.inputMD}" value="${this._pad(this._day)}" maxlength="2" />
    </div>`;

    const sep = `<span style="${S.sep}">.</span>`;

    let fields;
    switch (this._dateFmt) {
      case 'DMY': fields = dayField + sep + monthField + sep + yearField; break;
      case 'MDY': fields = monthField + sep + dayField + sep + yearField; break;
      default:    fields = yearField + sep + monthField + sep + dayField; break;
    }

    return `<div style="${S.sectionLbl}">Date</div>
      <div style="${S.dateRow}">${fields}</div>`;
  }

  // ═══════════════════════════════════════════════
  //  Build Time Section
  // ═══════════════════════════════════════════════

  _buildTimeSection() {
    const S = this._S;

    const hourVal = this._use12h ? this._displayHour12() : this._pad(this._hour);

    const hourField = `<div style="${S.fieldGroup}">
      <span style="${S.fieldHint}">Hour</span>
      <input type="text" class="ncm-ctp-inp" data-field="hour" style="${S.input} ${S.inputHM}" value="${hourVal}" maxlength="2" />
    </div>`;

    const hourSpin = `<div style="${S.spinCol}">
      <div class="ncm-ctp-spin" data-spin="hour" data-dir="up" style="${S.spinBtn}"><i class="fas fa-chevron-up"></i></div>
      <div class="ncm-ctp-spin" data-spin="hour" data-dir="down" style="${S.spinBtn}"><i class="fas fa-chevron-down"></i></div>
    </div>`;

    const colon = `<span style="${S.colon}">:</span>`;

    const minField = `<div style="${S.fieldGroup}">
      <span style="${S.fieldHint}">Min</span>
      <input type="text" class="ncm-ctp-inp" data-field="min" style="${S.input} ${S.inputHM}" value="${this._pad(this._min)}" maxlength="2" />
    </div>`;

    const minSpin = `<div style="${S.spinCol}">
      <div class="ncm-ctp-spin" data-spin="min" data-dir="up" style="${S.spinBtn}"><i class="fas fa-chevron-up"></i></div>
      <div class="ncm-ctp-spin" data-spin="min" data-dir="down" style="${S.spinBtn}"><i class="fas fa-chevron-down"></i></div>
    </div>`;

    let ampmBlock = '';
    if (this._use12h) {
      const amActive = !this._isPM();
      const pmActive = this._isPM();
      ampmBlock = `<div style="${S.ampmCol}">
        <div class="ncm-ctp-ampm" data-ampm="AM" style="${S.ampmBtn} ${amActive ? S.ampmActive : ''}">AM</div>
        <div class="ncm-ctp-ampm" data-ampm="PM" style="${S.ampmBtn} ${pmActive ? S.ampmActive : ''}">PM</div>
      </div>`;
    }

    return `<div style="${S.sectionLbl}">Time</div>
      <div style="${S.timeRow}">
        ${hourField}${hourSpin}${colon}${minField}${minSpin}${ampmBlock}
      </div>`;
  }

  // ═══════════════════════════════════════════════
  //  Build Preview
  // ═══════════════════════════════════════════════

  _buildPreview() {
    const S = this._S;
    return `<div style="${S.preview}">
      <div style="${S.gradientBar}"></div>
      <div style="${S.previewLbl}">Formatted Output</div>
      <div class="ncm-ctp-preview-cyber" style="${S.previewDate}">${this._toFormatted()}</div>
      <div class="ncm-ctp-preview-iso" style="${S.previewISO}">→ ${this._toISO()}</div>
      <div style="${S.scanlines}"></div>
    </div>`;
  }

  // ═══════════════════════════════════════════════
  //  Events
  // ═══════════════════════════════════════════════

  _bindEvents(html) {
    const self = this;

    // ─── Input changes ───
    html.find('.ncm-ctp-inp').on('input', function() {
      self._readInputs(html);
      self._updatePreview(html);
    });

    // ─── Input focus highlight ───
    html.find('.ncm-ctp-inp').on('focus', function() {
      this.style.borderColor = '#19f3f7';
      this.style.boxShadow = '0 0 4px rgba(25,243,247,0.1)';
    }).on('blur', function() {
      this.style.borderColor = '#2a2a45';
      this.style.boxShadow = 'none';
    });

    // ─── Spin buttons ───
    html.find('.ncm-ctp-spin').on('click', function() {
      const field = this.dataset.spin;
      const dir = this.dataset.dir === 'up' ? 1 : -1;

      if (field === 'hour') {
        self._hour = ((self._hour + dir) + 24) % 24;
      } else if (field === 'min') {
        self._min = ((self._min + dir) + 60) % 60;
      }

      self._syncInputs(html);
      self._updatePreview(html);
    });

    // Spin hover
    html.find('.ncm-ctp-spin').on('mouseenter', function() {
      this.style.color = '#19f3f7';
      this.style.borderColor = 'rgba(25,243,247,0.3)';
      this.style.background = 'rgba(25,243,247,0.06)';
    }).on('mouseleave', function() {
      this.style.color = '#555570';
      this.style.borderColor = '#2a2a45';
      this.style.background = '#12121a';
    });

    // ─── AM/PM toggle ───
    html.find('.ncm-ctp-ampm').on('click', function() {
      const which = this.dataset.ampm;
      const hourInput = html.find('.ncm-ctp-inp[data-field="hour"]');
      let displayHr = parseInt(hourInput.val()) || 12;
      if (displayHr < 1) displayHr = 12;
      if (displayHr > 12) displayHr = 12;

      if (which === 'AM') {
        self._hour = displayHr === 12 ? 0 : displayHr;
      } else {
        self._hour = displayHr === 12 ? 12 : displayHr + 12;
      }

      // Update button states
      const S = self._S;
      html.find('.ncm-ctp-ampm').each(function() {
        const isActive = this.dataset.ampm === which;
        this.style.cssText = S.ampmBtn + (isActive ? S.ampmActive : '');
      });

      self._updatePreview(html);
    });

    // AM/PM hover
    html.find('.ncm-ctp-ampm').on('mouseenter', function() {
      if (!this.style.cssText.includes('font-weight:700')) {
        this.style.color = '#19f3f7';
        this.style.borderColor = 'rgba(25,243,247,0.3)';
      }
    }).on('mouseleave', function() {
      if (!this.style.cssText.includes('font-weight:700')) {
        this.style.color = '#555570';
        this.style.borderColor = '#2a2a45';
      }
    });

    // ─── Presets ───
    html.find('.ncm-ctp-preset').on('click', function() {
      self._applyPreset(this.dataset.preset, html);
    });

    // Preset hover
    html.find('.ncm-ctp-preset').on('mouseenter', function() {
      this.style.color = '#19f3f7';
      this.style.borderColor = 'rgba(25,243,247,0.3)';
      this.style.background = 'rgba(25,243,247,0.06)';
    }).on('mouseleave', function() {
      this.style.color = '#8888a0';
      this.style.borderColor = 'rgba(136,136,160,0.15)';
      this.style.background = 'rgba(136,136,160,0.06)';
    });
  }

  // ═══════════════════════════════════════════════
  //  Read / Sync Inputs
  // ═══════════════════════════════════════════════

  /** Read input values into state */
  _readInputs(html) {
    const yearEl = html.find('.ncm-ctp-inp[data-field="year"]');
    const monthEl = html.find('.ncm-ctp-inp[data-field="month"]');
    const dayEl = html.find('.ncm-ctp-inp[data-field="day"]');
    const hourEl = html.find('.ncm-ctp-inp[data-field="hour"]');
    const minEl = html.find('.ncm-ctp-inp[data-field="min"]');

    if (yearEl.length) this._year = parseInt(yearEl.val()) || this._year;
    if (monthEl.length) {
      const m = parseInt(monthEl.val());
      if (m >= 1 && m <= 12) this._month = m;
    }
    if (dayEl.length) {
      const d = parseInt(dayEl.val());
      if (d >= 1 && d <= 31) this._day = d;
    }
    if (minEl.length) {
      const m = parseInt(minEl.val());
      if (m >= 0 && m <= 59) this._min = m;
    }

    if (hourEl.length) {
      const h = parseInt(hourEl.val());
      if (this._use12h) {
        // 12h mode: convert display hour + AM/PM → 24h internal
        let display = h;
        if (isNaN(display) || display < 1) display = 12;
        if (display > 12) display = 12;
        if (this._isPM()) {
          this._hour = display === 12 ? 12 : display + 12;
        } else {
          this._hour = display === 12 ? 0 : display;
        }
      } else {
        if (h >= 0 && h <= 23) this._hour = h;
      }
    }
  }

  /** Write state back to inputs (after spin/preset) */
  _syncInputs(html) {
    const yearEl = html.find('.ncm-ctp-inp[data-field="year"]');
    const monthEl = html.find('.ncm-ctp-inp[data-field="month"]');
    const dayEl = html.find('.ncm-ctp-inp[data-field="day"]');
    const hourEl = html.find('.ncm-ctp-inp[data-field="hour"]');
    const minEl = html.find('.ncm-ctp-inp[data-field="min"]');

    if (yearEl.length) yearEl.val(this._year);
    if (monthEl.length) monthEl.val(this._pad(this._month));
    if (dayEl.length) dayEl.val(this._pad(this._day));
    if (minEl.length) minEl.val(this._pad(this._min));

    if (hourEl.length) {
      hourEl.val(this._use12h ? this._displayHour12() : this._pad(this._hour));
    }

    // Update AM/PM buttons if in 12h mode
    if (this._use12h) {
      const S = this._S;
      html.find('.ncm-ctp-ampm').each((_, el) => {
        const isActive = (el.dataset.ampm === 'AM' && !this._isPM()) ||
                         (el.dataset.ampm === 'PM' && this._isPM());
        el.style.cssText = S.ampmBtn + (isActive ? S.ampmActive : '');
      });
    }
  }

  /** Update preview text */
  _updatePreview(html) {
    html.find('.ncm-ctp-preview-cyber').text(this._toFormatted());
    html.find('.ncm-ctp-preview-iso').text(`→ ${this._toISO()}`);
  }

  // ═══════════════════════════════════════════════
  //  Presets
  // ═══════════════════════════════════════════════

  _applyPreset(preset, html) {
    switch (preset) {
      case 'game': {
        const ts = game.nightcity?.timeService;
        let d;
        try {
          const gt = ts?.getCurrentTime?.();
          d = (gt instanceof Date && !isNaN(gt.getTime())) ? gt : null;
        } catch { /* fall through */ }
        if (!d && game.time?.worldTime) {
          d = new Date(game.time.worldTime * 1000);
        }
        if (!d || isNaN(d.getTime())) d = new Date();
        this._year = d.getFullYear();
        this._month = d.getMonth() + 1;
        this._day = d.getDate();
        this._hour = d.getHours();
        this._min = d.getMinutes();
        break;
      }

      case 'now': {
        const d = new Date();
        this._year = d.getFullYear();
        this._month = d.getMonth() + 1;
        this._day = d.getDate();
        this._hour = d.getHours();
        this._min = d.getMinutes();
        break;
      }

      case 'plus1h': {
        const d = new Date(this._toISO());
        d.setHours(d.getHours() + 1);
        this._year = d.getFullYear();
        this._month = d.getMonth() + 1;
        this._day = d.getDate();
        this._hour = d.getHours();
        this._min = d.getMinutes();
        break;
      }

      case 'plus1d': {
        const d = new Date(this._toISO());
        d.setDate(d.getDate() + 1);
        this._year = d.getFullYear();
        this._month = d.getMonth() + 1;
        this._day = d.getDate();
        this._hour = d.getHours();
        this._min = d.getMinutes();
        break;
      }
    }

    this._syncInputs(html);
    this._updatePreview(html);
  }

  // ═══════════════════════════════════════════════
  //  Static Format Helper (for trigger display)
  // ═══════════════════════════════════════════════

  /**
   * Format an ISO string for trigger display, respecting current settings.
   * Falls back to formatCyberDate() if available.
   * @param {string} iso - ISO timestamp string
   * @returns {string} Formatted display string
   */
  static formatForDisplay(iso) {
    if (!iso) return '';
    try {
      return formatCyberDate(iso);
    } catch {
      // Fallback if formatCyberDate isn't available yet
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString();
    }
  }
}
