/**
 * NcmDialog — every NCM dialog, on Foundry's DialogV2 frame, taking the v1 Dialog's settings (stage 2).
 * @file scripts/utils/ncmDialog.js
 * @module night-city-messenger
 *
 * Foundry's v1 `Dialog` is deprecated in v13 and removed in v16. NCM opens all its dialogs through the wrappers in
 * adminTheme.js (adminDialog / adminConfirm / adminPrompt / adminWait and the player* twins, 138 calls); those
 * now build this class instead, so no call site changed. It takes the v1 shapes and keeps their behaviour:
 *
 *   new NcmDialog({ title, content, buttons: { key: { icon: '<i class="…">', label, callback(html, event) } },
 *                   default: 'key', render(html), close(html) }, { classes, width, height, resizable, minimizable, id })
 *
 *   - a button's callback runs, then the dialog closes; `close` runs on EVERY close (after a button too) — themedConfirm
 *     relies on that order;
 *   - callbacks get jQuery-wrapped HTML like v1 did (`html.find(…)`, `html[0]`), when jQuery is there;
 *   - Enter on a field submits the focused button or the default; Escape closes; Enter in a textarea is a newline;
 *   - confirm / prompt / wait resolve exactly like v1's (prompt REJECTS on close by default — callers .catch it).
 *
 * The inner markup is v1's (.dialog-content / .dialog-buttons / button.dialog-button[data-button]) in a plain div —
 * not a <form>, so Foundry's and the system's form styles never reach a dialog body — which keeps every existing dialog
 * rule and the code that reaches into a dialog working. styles/components/dialog-v2.css has only what the V2 frame
 * changes. Mock: dev/mockups/dialog-v2-mock.html (v1 beside V2, real cascade, v12 + v13 core styles).
 */
import { ncmNotify } from './notify.js';

/** v1 html argument: jQuery when Foundry still ships it (v12–v13), the element otherwise. */
const asHtml = (el) => (typeof globalThis.jQuery === 'function' ? globalThis.jQuery(el) : el);
/** `<i class="fas fa-check"></i>` → `fas fa-check` (v1 icons are markup, V2 icons are a class). */
const iconClass = (html) => String(html || '').match(/class\s*=\s*["']([^"']+)["']/)?.[1] || '';
let _NcmDialog = null;
const escAttr = (s) => String(s ?? '').replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * The class, built on first use: Foundry's DialogV2 is not there when a sim (or anything outside Foundry) imports this
 * file, and adminTheme.js — which nearly every window imports — imports it.
 * @returns {typeof DialogV2}
 */
export function NcmDialogClass() {
  if (_NcmDialog) return _NcmDialog;
  const { DialogV2 } = foundry.applications.api;
  _NcmDialog = class NcmDialog extends DialogV2 {
    /**
     * @param {object} data    v1 Dialog data
     * @param {object} [options] v1 Dialog options (classes, width, height, resizable, minimizable, id)
     */
    constructor(data = {}, options = {}) {
      const entries = Object.entries(data.buttons || {});
      // DialogV2 needs at least one button; a v1 dialog with none had none to show — keep it hidden.
      const buttons = entries.length
        ? entries.map(([key, b]) => ({ action: `ncmb-${key}`, key, label: b?.label ?? key, icon: iconClass(b?.icon), default: key === data.default }))
        : [{ action: 'ncmb-none', key: '', label: 'Close', class: 'ncm-dialog-nobutton' }];
      // Each button's ACTION is namespaced (`ncmb-<key>`): a v1 button keyed `close` would otherwise replace the frame's
      // own close action (DialogV2 registers one action per button). `data-button` keeps the v1 key for code and CSS.
      const classes = [...new Set([...(Array.isArray(options.classes) ? options.classes : []), 'ncm-dialog-v2'])].filter((c) => c !== 'dialog');
      super({
        ...(options.id ? { id: options.id } : {}),
        classes,
        window: { title: data.title ?? '', resizable: !!options.resizable, minimizable: options.minimizable !== false },
        position: { width: options.width ?? 400, height: options.height ?? 'auto' },
        content: data.content ?? '',
        buttons,
      });
      /** the v1 data (buttons with their callbacks, default, render, close) */
      this.data = { ...data, buttons: Object.fromEntries(entries) };
      this._ncmCloseCalled = false;
    }

    /** v1 html for callbacks: the whole window, jQuery-wrapped. */
    _v1Html() { return asHtml(this.element); }

    /** @override — v1's inner markup, in a div (see the file header). */
    async _renderHTML() {
      const body = document.createElement('div');
      body.className = 'ncm-dialog-body';
      const btns = Object.values(this.options.buttons).map((b) => `<button type="button" class="dialog-button ${escAttr(b.key)}${b.default ? ' default' : ''}${b.class ? ` ${escAttr(b.class)}` : ''}" data-button="${escAttr(b.key)}" data-action="${escAttr(b.action)}">${b.icon ? `<i class="${escAttr(b.icon)}"></i>` : ''}${b.label}</button>`).join('');
      body.innerHTML = `<div class="dialog-content">${this.options.content ?? ''}</div><div class="dialog-buttons">${btns}</div>`;
      return body;
    }

    /** @override — v1 called `render(html)` with the content on every render. */
    _onRender(context, options) {
      super._onRender?.(context, options);
      if (this.data.render instanceof Function) {
        try { this.data.render(asHtml(this.element.querySelector('.window-content') || this.element)); }
        catch (err) { console.error('NCM | dialog render callback failed', err); }
      }
      // The default button takes focus (so Enter and the keyboard work) unless focus is already in the dialog's CONTENT
      // — a prompt's render callback focuses its field; content with its own autofocus got it from show(). Anywhere
      // else does not count: showing a <dialog> focuses its first focusable element, the header's close button, which
      // left Enter on Close (v12 tester run). Not an `autofocus` attribute on the button: Foundry focuses [autofocus]
      // AFTER the render callbacks, which stole a prompt field's focus.
      if (options?.isFirstRender && !this.element.querySelector('.dialog-content')?.contains(document.activeElement)) {
        this.element.querySelector('button.dialog-button.default')?.focus();
      }
    }

    /** @override — Enter submits the focused button or the default (not in a textarea), like v1. Escape: DialogV2. */
    _onKeyDown(event) {
      if (event.key === 'Enter' && !event.isComposing) {
        const active = document.activeElement;
        if (!this.element?.contains(active) || active instanceof HTMLTextAreaElement) return;
        if (active?.isContentEditable) return;
        event.preventDefault(); event.stopPropagation();
        const key = active?.dataset?.button || this.data.default;
        const target = key ? this.element.querySelector(`button[data-button="${CSS.escape(key)}"]`) : null;
        if (target && !target.disabled) this._onSubmit(target, event);
        return;
      }
      return super._onKeyDown(event);
    }

    /** @override — the button's v1 callback, then close (v1 Dialog.submit). */
    async _onSubmit(target, event) {
      event?.preventDefault?.();
      if (target?.disabled) return this;
      const key = target?.dataset?.button;
      const button = this.data.buttons?.[key];
      try {
        const result = button?.callback instanceof Function ? button.callback.call(this, this._v1Html(), event) : undefined;
        this._ncmChoice = { key, result };
      } catch (err) {
        ncmNotify.error(err.message);
        throw err;
      }
      return this.close();
    }

    /** @override — v1 ran `close(html)` on every close, before the window went. */
    async close(options = {}) {
      if (!this._ncmCloseCalled) {
        this._ncmCloseCalled = true;
        if (this.data.close instanceof Function) {
          try { this.data.close(this._v1Html()); } catch (err) { console.error('NCM | dialog close callback failed', err); }
        }
      }
      return super.close(options);
    }

    // ── v1 factory semantics ──

    /**
     * v1 Dialog.wait: resolves with the clicked button's callback result, or its key when that is undefined; closing
     * without a choice resolves with `data.close()`'s result, or rejects when that is undefined.
     */
    static wait(data = {}, options = {}) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const buttons = {};
        for (const [key, b] of Object.entries(data.buttons || {})) {
          buttons[key] = { ...b, callback: (html, event) => {
            const r = b?.callback instanceof Function ? b.callback(html, event) : undefined;
            settled = true; resolve(r === undefined ? key : r);
            return r;
          } };
        }
        const originalClose = data.close;
        const close = (html) => {
          if (settled) { if (originalClose instanceof Function) { try { originalClose(html); } catch { /* */ } } return; }
          const r = originalClose instanceof Function ? originalClose(html) : undefined;
          settled = true;
          if (r !== undefined) resolve(r); else reject(new Error('The Dialog was closed without a choice being made.'));
        };
        new this({ ...data, buttons, close }, options).render(true);
      });
    }

    /** v1 Dialog.confirm: yes → yes(html) or true; no → no(html) or false; closed → null (or rejects with rejectClose). */
    static confirm({ title, content, yes, no, render, defaultYes = true, rejectClose = false, options = {} } = {}) {
      return this.wait({
        title, content, render,
        default: defaultYes ? 'yes' : 'no',
        close: () => (rejectClose ? undefined : null),
        buttons: {
          yes: { icon: '<i class="fas fa-check"></i>', label: game.i18n?.localize?.('Yes') ?? 'Yes', callback: (html) => (yes ? yes(html) : true) },
          no: { icon: '<i class="fas fa-times"></i>', label: game.i18n?.localize?.('No') ?? 'No', callback: (html) => (no ? no(html) : false) },
        },
      }, options);
    }

    /** v1 Dialog.prompt: resolves the callback's result; closed → REJECTS (rejectClose defaults to true), or null. */
    static prompt({ title, content, label, callback, render, rejectClose = true, options = {} } = {}) {
      return this.wait({
        title, content, render,
        default: 'ok',
        close: () => (rejectClose ? undefined : null),
        buttons: { ok: { icon: '<i class="fas fa-check"></i>', label, callback } },
      }, options);
    }
  };
  return _NcmDialog;
}
