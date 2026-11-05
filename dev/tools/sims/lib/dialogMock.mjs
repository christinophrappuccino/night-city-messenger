// A stand-in for Foundry's DialogV2, for sims (stage 2 — NCM's dialogs are NcmDialog, utils/ncmDialog.js, on DialogV2).
// The REAL NcmDialog runs on top of it: its v1 data, its confirm / prompt / wait semantics, its callbacks and close
// order. Rendering is skipped (no DOM); an `answer` function clicks a button the way a player would.
//
//   import { installDialogV2 } from './lib/dialogMock.mjs';
//   const D = installDialogV2({ answer: (dlg) => 'yes' });   // the button key to press; null = close without a choice
//   … await adminConfirm({ … })  → true
//   D.made          every dialog opened (each has .data — the v1 data — and .options — classes, window.title …)
//   D.answer = fn   change the answer later; undefined from fn leaves the dialog open
export function installDialogV2({ answer } = {}) {
  // one stand-in per process: NcmDialogClass() builds its class once, on whichever DialogV2 it found first
  if (globalThis.__ncmDialogMock) {
    const m = globalThis.__ncmDialogMock;
    m.answer = answer;
    globalThis.foundry ??= {}; globalThis.foundry.applications ??= {}; globalThis.foundry.applications.api ??= {};
    globalThis.foundry.applications.api.DialogV2 = m.FakeDialogV2;
    return m;
  }
  const state = { made: [], answer };
  class FakeDialogV2 {
    constructor(options = {}) {
      this.options = { ...options, classes: ['dialog', ...(options.classes || [])] };
      this.element = null;
      this.rendered = false;
      this.closed = false;
      state.made.push(this);
    }
    render() {
      this.rendered = true;
      const key = state.answer ? state.answer(this) : undefined;
      if (key !== undefined) queueMicrotask(() => (key === null ? this.close() : this._onSubmit({ dataset: { button: key } }, null)));
      return this;
    }
    async close() { this.closed = true; return this; }
    setPosition() { return this; }
    _onKeyDown() {}
    _onRender() {}
  }
  globalThis.foundry ??= {};
  globalThis.foundry.applications ??= {};
  globalThis.foundry.applications.api ??= {};
  globalThis.foundry.applications.api.DialogV2 = FakeDialogV2;
  return (globalThis.__ncmDialogMock = {
    get made() { return state.made; },
    set answer(fn) { state.answer = fn; },
    get answer() { return state.answer; },
    FakeDialogV2,
  });
}
