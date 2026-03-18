/**
 * DateRangePicker — Reusable date range selection dialog
 * @file scripts/ui/components/DateRangePicker.js
 * @module cyberpunkred-messenger
 *
 * @description Visual calendar with click-to-select range, quick presets,
 *   and TimeService integration. Styled for NCM cyberpunk aesthetic.
 *   Usable from AdminPanel, MessageViewer, or anywhere else.
 *
 * @example
 *   import { DateRangePicker } from '../components/DateRangePicker.js';
 *   DateRangePicker.open({
 *     from: '2045-03-01',
 *     to: '2045-03-18',
 *     onApply: (from, to) => { ... },
 *     onClear: () => { ... },
 *   });
 */

import { MODULE_ID } from '../../utils/constants.js';

export class DateRangePicker {

  /**
   * Open the date range picker dialog.
   * @param {object} options
   * @param {string} [options.from] - Initial from date (YYYY-MM-DD)
   * @param {string} [options.to] - Initial to date (YYYY-MM-DD)
   * @param {string} [options.title='Select Date Range'] - Dialog title
   * @param {Function} options.onApply - Callback: (fromStr, toStr) => void
   * @param {Function} [options.onClear] - Callback when cleared
   */
  static open(options = {}) {
    const picker = new DateRangePicker(options);
    picker._render();
  }

  constructor(options) {
    this.onApply = options.onApply || (() => {});
    this.onClear = options.onClear || (() => {});
    this.title = options.title || 'Select Date Range';

    // Get "today" from TimeService
    const ts = game.nightcity?.timeService;
    const now = ts ? new Date(ts.getCurrentTime()) : new Date();
    this._today = this._dateStr(now);

    // Selected range
    this._from = options.from || '';
    this._to = options.to || '';

    // Currently viewed month (start of month)
    const initDate = this._from ? new Date(this._from + 'T00:00:00') : now;
    this._viewYear = initDate.getFullYear();
    this._viewMonth = initDate.getMonth();

    // Selection state: null, 'from', 'complete'
    this._selectState = (this._from && this._to) ? 'complete' : (this._from ? 'from' : null);

    this._dialog = null;
  }

  // ═══════════════════════════════════════════════
  //  Rendering
  // ═══════════════════════════════════════════════

  _render() {
    const content = `<div class="ncm-drp" style="font-family:Rajdhani,sans-serif; color:#eeeef4; min-width:340px; user-select:none;">
      ${this._buildPresets()}
      ${this._buildHeader()}
      ${this._buildCalendar()}
      ${this._buildFooter()}
    </div>`;

    this._dialog = new Dialog({
      title: this.title,
      content,
      buttons: {
        apply: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Apply',
          callback: () => {
            if (this._from) this.onApply(this._from, this._to);
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
      default: 'apply',
      render: (html) => this._bindEvents(html),
    }, {
      width: 380,
      height: 'auto',
      classes: ['ncm-time-config-dialog'],
    });

    this._dialog.render(true);
  }

  _rerender() {
    if (!this._dialog?.element?.length) return;
    const container = this._dialog.element.find('.ncm-drp');
    if (!container.length) return;
    container.html(`
      ${this._buildPresets()}
      ${this._buildHeader()}
      ${this._buildCalendar()}
      ${this._buildFooter()}
    `);
    this._bindEvents(this._dialog.element);
  }

  // ═══════════════════════════════════════════════
  //  Components
  // ═══════════════════════════════════════════════

  _buildPresets() {
    const S = {
      row: 'display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;',
      btn: 'padding:3px 10px; background:transparent; border:1px solid #2a2a45; border-radius:2px; color:#8888a0; font-family:Rajdhani,sans-serif; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; cursor:pointer; transition:all 0.15s;',
    };

    return `<div style="${S.row}">
      <div class="ncm-drp-preset" data-preset="today" style="${S.btn}">Today</div>
      <div class="ncm-drp-preset" data-preset="7d" style="${S.btn}">Last 7 Days</div>
      <div class="ncm-drp-preset" data-preset="30d" style="${S.btn}">Last 30 Days</div>
      <div class="ncm-drp-preset" data-preset="month" style="${S.btn}">This Month</div>
      <div class="ncm-drp-preset" data-preset="prevmonth" style="${S.btn}">Last Month</div>
    </div>`;
  }

  _buildHeader() {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const label = `${monthNames[this._viewMonth]} ${this._viewYear}`;

    return `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
      <div class="ncm-drp-nav" data-dir="prev" style="width:26px; height:26px; display:flex; align-items:center; justify-content:center; cursor:pointer; border:1px solid #2a2a45; border-radius:2px; color:#8888a0; font-size:10px; transition:all 0.15s;">
        <i class="fas fa-chevron-left"></i>
      </div>
      <span style="font-size:14px; font-weight:700; letter-spacing:0.04em; color:#eeeef4;">${label}</span>
      <div class="ncm-drp-nav" data-dir="next" style="width:26px; height:26px; display:flex; align-items:center; justify-content:center; cursor:pointer; border:1px solid #2a2a45; border-radius:2px; color:#8888a0; font-size:10px; transition:all 0.15s;">
        <i class="fas fa-chevron-right"></i>
      </div>
    </div>`;
  }

  _buildCalendar() {
    const days = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    let html = '<div style="background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; overflow:hidden;">';

    // Day headers
    html += '<div style="display:grid; grid-template-columns:repeat(7,1fr); border-bottom:1px solid #2a2a45;">';
    for (const d of days) {
      html += `<div style="text-align:center; padding:4px 0; font-family:Share Tech Mono,monospace; font-size:9px; color:#8888a0; text-transform:uppercase;">${d}</div>`;
    }
    html += '</div>';

    // Calendar grid
    html += '<div style="display:grid; grid-template-columns:repeat(7,1fr);">';

    const firstDay = new Date(this._viewYear, this._viewMonth, 1);
    const lastDay = new Date(this._viewYear, this._viewMonth + 1, 0);
    // Monday = 0, Sunday = 6
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    // Padding cells for days before the 1st
    for (let i = 0; i < startDow; i++) {
      html += '<div style="padding:6px; text-align:center;"></div>';
    }

    // Day cells
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = this._dateStr(new Date(this._viewYear, this._viewMonth, d));
      const isToday = dateStr === this._today;
      const isFrom = dateStr === this._from;
      const isTo = dateStr === this._to;
      const inRange = this._isInRange(dateStr);

      let bg = 'transparent';
      let color = '#e0e0e8';
      let border = 'transparent';
      let fontWeight = '600';

      if (isFrom || isTo) {
        bg = 'rgba(25,243,247,0.15)';
        color = '#19f3f7';
        border = 'rgba(25,243,247,0.4)';
        fontWeight = '800';
      } else if (inRange) {
        bg = 'rgba(25,243,247,0.05)';
        color = '#c0c0d0';
      }

      const todayDot = isToday ? '<div style="width:3px; height:3px; background:#F65261; border-radius:50%; margin:1px auto 0;"></div>' : '';

      html += `<div class="ncm-drp-day" data-date="${dateStr}" style="padding:4px 2px; text-align:center; cursor:pointer; transition:all 0.1s; background:${bg}; border:1px solid ${border}; border-radius:1px;">
        <div style="font-family:Share Tech Mono,monospace; font-size:11px; color:${color}; font-weight:${fontWeight}; line-height:1.4;">${d}</div>
        ${todayDot}
      </div>`;
    }

    html += '</div></div>';
    return html;
  }

  _buildFooter() {
    const fromDisplay = this._from || '—';
    const toDisplay = this._to || '—';
    const hint = !this._from ? 'Click a date to set start'
      : this._selectState === 'from' ? 'Click another date to set end'
      : 'Range selected';

    return `<div style="display:flex; align-items:center; justify-content:space-between; margin-top:8px; padding:6px 10px; background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-family:Share Tech Mono,monospace; font-size:11px; color:#19f3f7;">${fromDisplay}</span>
        <span style="font-size:10px; color:#555570;">→</span>
        <span style="font-family:Share Tech Mono,monospace; font-size:11px; color:#19f3f7;">${toDisplay}</span>
      </div>
      <span style="font-family:Rajdhani,sans-serif; font-size:9px; color:#555570; font-weight:600;">${hint}</span>
    </div>`;
  }

  // ═══════════════════════════════════════════════
  //  Events
  // ═══════════════════════════════════════════════

  _bindEvents(html) {
    // Day clicks
    html.find('.ncm-drp-day').on('click', (e) => {
      const dateStr = e.currentTarget.dataset.date;
      if (!dateStr) return;
      this._onDayClick(dateStr);
    });

    // Hover preview — direct DOM manipulation, no rerender
    html.find('.ncm-drp-day').on('mouseenter', (e) => {
      if (this._selectState !== 'from') return;
      const hoverDate = e.currentTarget.dataset.date;
      if (!hoverDate || !this._from) return;

      const from = this._from < hoverDate ? this._from : hoverDate;
      const to = this._from < hoverDate ? hoverDate : this._from;

      html.find('.ncm-drp-day').each((_, el) => {
        const d = el.dataset.date;
        if (!d) return;
        const isEndpoint = d === from || d === to;
        const inRange = d >= from && d <= to;

        if (isEndpoint) {
          el.style.background = 'rgba(25,243,247,0.15)';
          el.style.borderColor = 'rgba(25,243,247,0.4)';
          el.querySelector('div').style.color = '#19f3f7';
        } else if (inRange) {
          el.style.background = 'rgba(25,243,247,0.05)';
          el.style.borderColor = 'transparent';
          el.querySelector('div').style.color = '#c0c0d0';
        } else {
          el.style.background = 'transparent';
          el.style.borderColor = 'transparent';
          el.querySelector('div').style.color = '#e0e0e8';
        }
      });
    });

    // Reset hover styles on mouse leave from grid
    html.find('.ncm-drp-day').on('mouseleave', () => {
      // Only reset if still in 'from' selection mode — the rerender on click handles final state
    });

    // Nav arrows
    html.find('.ncm-drp-nav').on('click', (e) => {
      const dir = e.currentTarget.dataset.dir;
      if (dir === 'prev') {
        this._viewMonth--;
        if (this._viewMonth < 0) { this._viewMonth = 11; this._viewYear--; }
      } else {
        this._viewMonth++;
        if (this._viewMonth > 11) { this._viewMonth = 0; this._viewYear++; }
      }
      this._rerender();
    });

    // Presets
    html.find('.ncm-drp-preset').on('click', (e) => {
      const preset = e.currentTarget.dataset.preset;
      this._applyPreset(preset);
    });

    // Hover styles on nav/preset
    html.find('.ncm-drp-nav, .ncm-drp-preset').on('mouseenter', function() {
      this.style.borderColor = 'rgba(25,243,247,0.3)';
      this.style.color = '#19f3f7';
    }).on('mouseleave', function() {
      this.style.borderColor = '#2a2a45';
      this.style.color = '#8888a0';
    });
  }

  _onDayClick(dateStr) {
    if (!this._from || this._selectState === 'complete') {
      // Start new selection
      this._from = dateStr;
      this._to = '';
      this._selectState = 'from';
      this._previewTo = '';
    } else if (this._selectState === 'from') {
      // Complete the range
      if (dateStr < this._from) {
        // Clicked before start — swap
        this._to = this._from;
        this._from = dateStr;
      } else if (dateStr === this._from) {
        // Same day — single day range
        this._to = dateStr;
      } else {
        this._to = dateStr;
      }
      this._selectState = 'complete';
      this._previewTo = '';
    }
    this._rerender();
  }

  _applyPreset(preset) {
    const today = new Date(this._today + 'T00:00:00');

    switch (preset) {
      case 'today':
        this._from = this._today;
        this._to = this._today;
        break;
      case '7d': {
        const d = new Date(today);
        d.setDate(d.getDate() - 6);
        this._from = this._dateStr(d);
        this._to = this._today;
        break;
      }
      case '30d': {
        const d = new Date(today);
        d.setDate(d.getDate() - 29);
        this._from = this._dateStr(d);
        this._to = this._today;
        break;
      }
      case 'month':
        this._from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
        this._to = this._today;
        break;
      case 'prevmonth': {
        const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
        const m = today.getMonth() === 0 ? 12 : today.getMonth();
        const lastDay = new Date(y, m, 0).getDate();
        this._from = `${y}-${String(m).padStart(2, '0')}-01`;
        this._to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        break;
      }
    }

    this._selectState = 'complete';

    // Navigate view to the from date
    const fromDate = new Date(this._from + 'T00:00:00');
    this._viewYear = fromDate.getFullYear();
    this._viewMonth = fromDate.getMonth();

    this._rerender();
  }

  // ═══════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════

  _dateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  _isInRange(dateStr) {
    if (!this._from) return false;

    // Preview range while selecting
    if (this._selectState === 'from' && this._previewTo) {
      const from = this._from < this._previewTo ? this._from : this._previewTo;
      const to = this._from < this._previewTo ? this._previewTo : this._from;
      return dateStr >= from && dateStr <= to;
    }

    if (!this._to) return false;
    return dateStr >= this._from && dateStr <= this._to;
  }
}
