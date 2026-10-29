/**
 * SoundBoardApp — the GM's Sound board (2026-10-29, dev: "change the sounds so users can upload their own").
 * @file scripts/ui/Sounds/SoundBoardApp.js
 * @module night-city-messenger
 *
 * Admin → Tools → Sounds. Every NCM sound, grouped, with where it plays, a ▶ preview, Browse (Foundry's file picker —
 * which can upload), a volume, Off, and Reset. Replacements are the world setting `soundOverrides` (sanitized by
 * utils/soundCatalog.js) and apply to every client — the file has to be somewhere players can load (User Data).
 * Every change writes at once; the window repaints off the setting.
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { isGM } from '../../utils/helpers.js';
import { adminConfirm } from '../../utils/adminTheme.js';
import { BaseApplication } from '../BaseApplication.js';
import { sanitizeSoundOverrides, soundBoard, SOUND_INFO } from '../../utils/soundCatalog.js';

const FP = () => (typeof FilePicker !== 'undefined' ? FilePicker : foundry.applications?.apps?.FilePicker);

export class SoundBoardApp extends BaseApplication {
  static ADMIN_THEMED = true;

  constructor(options = {}) {
    super(foundry.utils.mergeObject({ id: 'ncm-sound-board' }, options, { inplace: false }));
    this._query = '';
    this._changedOnly = false;
  }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    classes: ['ncm-app', 'ncm-sound-board'],
    window: { title: 'Sounds', resizable: true, minimizable: true, icon: 'fas fa-volume-high' },
    position: { width: 720, height: 680 },
    actions: {
      play: SoundBoardApp._act, browse: SoundBoardApp._act, off: SoundBoardApp._act, reset: SoundBoardApp._act,
      changed: SoundBoardApp._act, resetAll: SoundBoardApp._act, exportSet: SoundBoardApp._act, importSet: SoundBoardApp._act,
      volume: SoundBoardApp._act,
    },
  }, { inplace: false });

  static PARTS = { main: { template: TEMPLATES.SOUND_BOARD } };

  static open() {
    if (!isGM()) return void ui.notifications.warn('Only the GM can change the sounds.');
    const existing = foundry.applications?.instances?.get?.('ncm-sound-board');
    if (existing) { existing.render(true); existing.bringToFront?.(); if (existing.minimized) existing.maximize?.(); return existing; }
    const app = new SoundBoardApp();
    app.render(true);
    return app;
  }

  _overrides() { try { return sanitizeSoundOverrides(game.settings.get(MODULE_ID, 'soundOverrides')); } catch { return {}; } }

  async _write(next) { await game.settings.set(MODULE_ID, 'soundOverrides', sanitizeSoundOverrides(next)); }

  async _prepareContext(options) {
    const ctx = await super._prepareContext?.(options) ?? {};
    const ov = this._overrides();
    const groups = soundBoard(ov, MODULE_ID);
    const changed = Object.keys(ov).length;
    return { ...ctx, groups, changed, total: Object.keys(SOUND_INFO).length, changedOnly: this._changedOnly, query: this._query,
      soundOn: game.nightcity?.soundService?.enabled !== false };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element; if (!root) return;
    // search + "changed only" filter the live rows (no re-render while typing)
    const q = root.querySelector('[data-sb-q]');
    const apply = () => {
      const v = (q?.value || '').trim().toLowerCase();
      this._query = q?.value || '';
      root.querySelectorAll('[data-sb-row]').forEach((r) => {
        const hit = (!v || r.dataset.sbText.includes(v)) && (!this._changedOnly || r.dataset.sbChanged === '1');
        r.style.display = hit ? '' : 'none';
      });
      root.querySelectorAll('[data-sb-group]').forEach((g) => { g.style.display = [...g.querySelectorAll('[data-sb-row]')].some((r) => r.style.display !== 'none') ? '' : 'none'; });
    };
    q?.addEventListener('input', apply);
    apply();
    // the volume box commits on change (a number box fires data-action on click)
    root.querySelectorAll('[data-sb-vol]').forEach((inp) => inp.addEventListener('change', () => this._setVolume(inp.dataset.sbVol, inp.value)));
    if (!this._hooked) {
      this._hooked = true;
      this._onSetting = (st) => { if (st?.key === `${MODULE_ID}.soundOverrides`) this.render(); };
      Hooks.on('updateSetting', this._onSetting);
    }
  }

  async close(options) {
    if (this._onSetting) Hooks.off('updateSetting', this._onSetting);
    return super.close(options);
  }

  static async _act(event, target) {
    try { await this._run(target.dataset.action, target.dataset); }
    catch (e) { console.error('NCM | Sound board', e); ui.notifications.error(`NCM | Sounds: ${e.message}`); }
  }

  async _run(op, ds) {
    const id = ds.id;
    const ov = this._overrides();
    switch (op) {
      case 'play': return game.nightcity?.soundService?.preview(id);
      case 'browse': {
        const Picker = FP();
        if (!Picker) return void ui.notifications.warn('The file picker is not available.');
        const cur = ov[id]?.src || '';
        new Picker({
          type: 'audio', current: cur,
          callback: async (path) => {
            if (!path) return;
            await this._write({ ...ov, [id]: { ...(ov[id] || {}), src: path, off: false } });
            game.nightcity?.soundService?.preview(id, { src: path, volume: ov[id]?.volume ?? 1 });
          },
        }).render(true);
        return;
      }
      case 'off': return this._write({ ...ov, [id]: { ...(ov[id] || {}), off: !ov[id]?.off } });
      case 'reset': { const next = { ...ov }; delete next[id]; return this._write(next); }
      case 'changed': this._changedOnly = !this._changedOnly; return this.render();
      case 'resetAll': {
        if (!Object.keys(ov).length) return;
        const ok = await adminConfirm({ title: 'Sounds — back to the module\'s own', content: `<p>Put all ${Object.keys(ov).length} changed sounds back to the module's own files?</p>` });
        if (ok) await this._write({});
        return;
      }
      case 'exportSet': {
        const blob = new Blob([JSON.stringify({ ncmSounds: 1, exportedAt: new Date().toISOString(), sounds: ov }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'ncm-sounds.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return;
      }
      case 'importSet': {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
          const file = input.files?.[0]; if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            const sounds = sanitizeSoundOverrides(data?.sounds ?? data);
            const n = Object.keys(sounds).length;
            if (!n) return void ui.notifications.warn('No sounds in that file.');
            await this._write({ ...ov, ...sounds });
            ui.notifications.info(`${n} sound${n === 1 ? '' : 's'} imported. The files must be where your players can load them.`);
          } catch { ui.notifications.error('That is not a sounds file.'); }
        });
        input.click();
        return;
      }
    }
  }

  async _setVolume(id, value) {
    const ov = this._overrides();
    const v = Math.max(10, Math.min(200, Math.round(Number(value) || 100))) / 100;
    const next = { ...ov, [id]: { ...(ov[id] || {}), volume: v } };
    await this._write(next);
  }
}
