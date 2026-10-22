/**
 * CyberTimePicker — Format-Aware Timestamp Picker
 * @file scripts/ui/components/CyberTimePicker.js
 * @module night-city-messenger
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
import { playerDialog } from '../../utils/adminTheme.js';

/** Month names for the written month styles (mirrors formatCyberDate's tables). */
const CTP_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CTP_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
    // Month style (number 03 / short Mar / long March) — a written style swaps
    // the month digit-box for a named <select>, so the picker matches what
    // formatCyberDate will render everywhere else.
    try { this._monthStyle = game.settings.get(MODULE_ID, 'dateMonthStyle') || 'number'; } catch { this._monthStyle = 'number'; }

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
        if (gt) initDate = new Date(gt);
        if (initDate && isNaN(initDate.getTime())) initDate = null;
      } catch { /* fall through */ }
      if (!initDate && game.time?.worldTime) {
        initDate = new Date(game.time.worldTime * 1000);
      }
      if (!initDate || isNaN(initDate.getTime())) {
        initDate = new Date();
      }
    }

    // Always use UTC getters — _toISO() appends 'Z' (UTC marker)
    this._year = initDate.getUTCFullYear();
    this._month = initDate.getUTCMonth() + 1;
    this._day = initDate.getUTCDate();
    this._hour = initDate.getUTCHours();
    this._min = initDate.getUTCMinutes();
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
    // Delegate to the REAL formatter — the one source of truth for
    // dateFormat + dateMonthStyle + timeFormat, so the preview (and the
    // `formatted` handed to onSet) can never drift from what the rest of
    // the app renders.
    try { return formatCyberDate(this._toISO()); } catch { /* settings not registered yet */ }
    // Fallback: number-style hand-build (pre-settings edge only).
    let dateStr;
    switch (this._dateFmt) {
      case 'DMY': dateStr = `${this._pad(this._day)}.${this._pad(this._month)}.${this._year}`; break;
      case 'MDY': dateStr = `${this._pad(this._month)}.${this._pad(this._day)}.${this._year}`; break;
      default:    dateStr = `${this._year}.${this._pad(this._month)}.${this._pad(this._day)}`; break;
    }
    let timeStr;
    if (this._use12h) {
      const hr = this._hour % 12 || 12;
      timeStr = `${hr}:${this._pad(this._min)} ${this._hour >= 12 ? 'PM' : 'AM'}`;
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

  // Colours are --ncm-* vars (brand hex as the fallback), so the picker
  // follows whatever opened it: the player theme from :root, or an admin
  // preset when it is tagged ncm-admin-dialog (GM view, config sheets).
  // Input sizing and every hover/focus state live in tab-tools.css
  // (.ncm-ctp-*) — the dialog's own input reset is !important, and an
  // inline style cannot beat it.
  get _S() {
    const T  = 'var(--ncm-text-primary, #e0e0e8)';
    const T2 = 'var(--ncm-text-secondary, #8888a0)';
    const M  = 'var(--ncm-text-muted, #555570)';
    const B  = 'var(--ncm-border, #2a2a45)';
    const D  = 'var(--ncm-bg-deep, #08080e)';
    const C  = 'var(--ncm-secondary, #19f3f7)';
    const MONO = "var(--ncm-font-mono, 'Share Tech Mono', monospace)";
    const BODY = 'var(--ncm-font-body, Rajdhani, sans-serif)';
    return {
      root:        `font-family:${BODY}; color:${T}; user-select:none; overflow:hidden;`,
      presetRow:   `display:flex; gap:4px; flex-wrap:wrap; padding:0 0 10px; border-bottom:1px solid ${B}; margin-bottom:10px;`,
      preset:      `display:inline-flex; align-items:center; gap:4px; font-family:${BODY}; font-size:11px; font-weight:600; color:${T2}; border-radius:2px; padding:3px 7px; cursor:pointer; transition:all 0.15s; white-space:nowrap;`,
      presetIcon:  'font-size:9px;',
      sectionLbl:  `font-family:${BODY}; font-size:10px; font-weight:600; color:${M}; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px;`,
      dateRow:     'display:flex; align-items:flex-end; gap:4px; margin-bottom:14px;',
      fieldGroup:  'display:flex; flex-direction:column; align-items:center; gap:2px; flex-shrink:0;',
      fieldHint:   `font-size:8px; font-weight:600; color:${M}; text-transform:uppercase; letter-spacing:0.06em; line-height:10px;`,
      input:       '',
      inputYear:   '',
      inputMD:     '',
      inputHM:     '',
      sep:         `font-family:${MONO}; font-size:15px; color:${M}; padding:0 1px; line-height:30px;`,
      timeRow:     'display:flex; align-items:flex-end; gap:4px; margin-bottom:14px;',
      colon:       `font-family:${MONO}; font-size:18px; font-weight:700; color:${C}; line-height:30px;`,
      spinCol:     'display:flex; flex-direction:column; justify-content:space-between; height:30px;',
      spinBtn:     '',
      ampmCol:     'display:flex; flex-direction:column; justify-content:space-between; height:30px; margin-left:4px;',
      ampmBtn:     '',
      ampmActive:  '',
      preview:     `background:${D}; border:1px solid ${B}; border-radius:2px; padding:8px 12px; position:relative; overflow:hidden;`,
      previewLbl:  `font-size:8px; font-weight:600; color:${M}; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:6px;`,
      previewDate: `font-family:${MONO}; font-size:17px; font-weight:400; color:${C}; letter-spacing:0.02em; line-height:1.2; margin-bottom:4px; overflow-wrap:anywhere;`,
      previewISO:  `font-family:${MONO}; font-size:10px; color:${M}; letter-spacing:0.02em; overflow-wrap:anywhere;`,
      gradientBar: `position:absolute; top:0; left:0; right:0; height:1px; background:color-mix(in srgb, ${C} 30%, transparent);`,
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

    this._dialog = playerDialog({
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
      // playerDialog inherits the opener's theme: a picker launched from a
      // GM-view / admin-themed window (composer in GM view, a config sheet) is
      // tagged like an admin dialog so it doesn't pop up in the player palette;
      // otherwise it is a player dialog zoomed by the player's Text Size.
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
      <div class="ncm-ctp-preset" data-preset="plus1w" style="${S.preset}"><i class="fas fa-calendar-week" style="${S.presetIcon}"></i> +1 Week</div>
    </div>`;
  }

  // ═══════════════════════════════════════════════
  //  Build Date Section
  // ═══════════════════════════════════════════════

  _buildDateSection() {
    const S = this._S;

    const yearField = `<div style="${S.fieldGroup}">
      <span style="${S.fieldHint}">Year</span>
      <input type="text" class="ncm-ctp-inp" data-field="year" value="${this._year}" maxlength="4" />
    </div>`;

    // Month widget follows the dateMonthStyle setting: number = the 2-digit
    // box; short/long = a named <select> (values stay numeric 1–12 so
    // _readInputs parses either widget identically).
    let monthField;
    if (this._monthStyle === 'short' || this._monthStyle === 'long') {
      const names = this._monthStyle === 'long' ? CTP_MONTHS_LONG : CTP_MONTHS_SHORT;
      const opts = names.map((n, i) => `<option value="${i + 1}"${(i + 1) === this._month ? ' selected' : ''}>${n}</option>`).join('');
      monthField = `<div style="${S.fieldGroup}">
        <span style="${S.fieldHint}">Month</span>
        <select class="ncm-ctp-inp" data-field="month" style="width:${this._monthStyle === 'long' ? '112px' : '72px'} !important;">${opts}</select>
      </div>`;
    } else {
      monthField = `<div style="${S.fieldGroup}">
        <span style="${S.fieldHint}">Month</span>
        <input type="text" class="ncm-ctp-inp" data-field="month" value="${this._pad(this._month)}" maxlength="2" />
      </div>`;
    }

    const dayField = `<div style="${S.fieldGroup}">
      <span style="${S.fieldHint}">Day</span>
      <input type="text" class="ncm-ctp-inp" data-field="day" value="${this._pad(this._day)}" maxlength="2" />
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
      <input type="text" class="ncm-ctp-inp" data-field="hour" value="${hourVal}" maxlength="2" />
    </div>`;

    const hourSpin = `<div style="${S.spinCol}">
      <div class="ncm-ctp-spin" data-spin="hour" data-dir="up"><i class="fas fa-chevron-up"></i></div>
      <div class="ncm-ctp-spin" data-spin="hour" data-dir="down"><i class="fas fa-chevron-down"></i></div>
    </div>`;

    const colon = `<span style="${S.colon}">:</span>`;

    const minField = `<div style="${S.fieldGroup}">
      <span style="${S.fieldHint}">Min</span>
      <input type="text" class="ncm-ctp-inp" data-field="min" value="${this._pad(this._min)}" maxlength="2" />
    </div>`;

    const minSpin = `<div style="${S.spinCol}">
      <div class="ncm-ctp-spin" data-spin="min" data-dir="up"><i class="fas fa-chevron-up"></i></div>
      <div class="ncm-ctp-spin" data-spin="min" data-dir="down"><i class="fas fa-chevron-down"></i></div>
    </div>`;

    let ampmBlock = '';
    if (this._use12h) {
      const amActive = !this._isPM();
      const pmActive = this._isPM();
      ampmBlock = `<div style="${S.ampmCol}">
        <div data-ampm="AM" class="ncm-ctp-ampm${amActive ? ' is-active' : ''}">AM</div>
        <div data-ampm="PM" class="ncm-ctp-ampm${pmActive ? ' is-active' : ''}">PM</div>
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
    </div>`;
  }

  // ═══════════════════════════════════════════════
  //  Events
  // ═══════════════════════════════════════════════

  _bindEvents(html) {
    const self = this;

    // ─── Input changes ('change' too — the month <select> needs it) ───
    html.find('.ncm-ctp-inp').on('input change', function() {
      self._readInputs(html);
      self._updatePreview(html);
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
      html.find('.ncm-ctp-ampm').each(function() {
        this.classList.toggle('is-active', this.dataset.ampm === which);
      });

      self._updatePreview(html);
    });

    // ─── Presets ───
    html.find('.ncm-ctp-preset').on('click', function() {
      self._applyPreset(this.dataset.preset, html);
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
    // The month select's option values are unpadded 1–12; the digit box is padded.
    if (monthEl.length) monthEl.val(monthEl.is('select') ? String(this._month) : this._pad(this._month));
    if (dayEl.length) dayEl.val(this._pad(this._day));
    if (minEl.length) minEl.val(this._pad(this._min));

    if (hourEl.length) {
      hourEl.val(this._use12h ? this._displayHour12() : this._pad(this._hour));
    }

    // Update AM/PM buttons if in 12h mode
    if (this._use12h) {
      html.find('.ncm-ctp-ampm').each((_, el) => {
        const isActive = (el.dataset.ampm === 'AM' && !this._isPM()) ||
                         (el.dataset.ampm === 'PM' && this._isPM());
        el.classList.toggle('is-active', isActive);
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
          if (gt) d = new Date(gt);
          if (d && isNaN(d.getTime())) d = null;
        } catch { /* fall through */ }
        if (!d && game.time?.worldTime) {
          d = new Date(game.time.worldTime * 1000);
        }
        if (!d || isNaN(d.getTime())) d = new Date();
        this._year = d.getUTCFullYear();
        this._month = d.getUTCMonth() + 1;
        this._day = d.getUTCDate();
        this._hour = d.getUTCHours();
        this._min = d.getUTCMinutes();
        break;
      }

      case 'now': {
        const d = new Date();
        this._year = d.getUTCFullYear();
        this._month = d.getUTCMonth() + 1;
        this._day = d.getUTCDate();
        this._hour = d.getUTCHours();
        this._min = d.getUTCMinutes();
        break;
      }

      case 'plus1h': {
        const d = new Date(this._toISO());
        d.setUTCHours(d.getUTCHours() + 1);
        this._year = d.getUTCFullYear();
        this._month = d.getUTCMonth() + 1;
        this._day = d.getUTCDate();
        this._hour = d.getUTCHours();
        this._min = d.getUTCMinutes();
        break;
      }

      case 'plus1d': {
        const d = new Date(this._toISO());
        d.setUTCDate(d.getUTCDate() + 1);
        this._year = d.getUTCFullYear();
        this._month = d.getUTCMonth() + 1;
        this._day = d.getUTCDate();
        this._hour = d.getUTCHours();
        this._min = d.getUTCMinutes();
        break;
      }

      case 'plus1w': {
        const d = new Date(this._toISO());
        d.setUTCDate(d.getUTCDate() + 7);
        this._year = d.getUTCFullYear();
        this._month = d.getUTCMonth() + 1;
        this._day = d.getUTCDate();
        this._hour = d.getUTCHours();
        this._min = d.getUTCMinutes();
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
