/**
 * SoundService — Audio Management
 * @file scripts/services/SoundService.js
 * @module night-city-messenger
 * @description Manages all module audio with volume control, enable/disable,
 *              and preloading. All sounds go through this service — never
 *              call AudioHelper.play() directly.
 */

import { MODULE_ID, SOUND_PATHS } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

/**
 * Safe reference to AudioHelper (v12 namespaced path)
 * @returns {typeof AudioHelper}
 */
function getAudioHelper() {
  return foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
}

export class SoundService {

  /** Base volume multiplier for the UI click — quieter than event sounds. */
  static CLICK_GAIN = 0.25;

  /**
   * @param {SettingsManager} settingsManager
   */
  constructor(settingsManager) {
    this._settings = settingsManager;
    this._preloaded = false;
  }

  /**
   * Initialize — kick off preload (non-blocking)
   */
  async initialize() {
    // Fire-and-forget preload — never block initialization
    this._preload().catch(() => {});
    log.info('SoundService initialized');
  }

  /**
   * Play a sound by ID
   * @param {string} soundId - Key from SOUND_PATHS
   * @param {object} [options]
   * @param {number} [options.volume] - Override volume (0-1)
   * @param {boolean} [options.loop] - Loop the sound
   * @returns {Promise<void>}
   */
  async play(soundId, { volume, loop } = {}) {
    const prefs = this._settings.getTheme();
    if (!prefs.soundEnabled) return;

    const relativePath = SOUND_PATHS[soundId];
    if (!relativePath) {
      log.warn(`Unknown sound ID: ${soundId}`);
      return;
    }

    const src = `modules/${MODULE_ID}/assets/sounds/${relativePath}`;
    const vol = (volume ?? 1.0) * (prefs.soundVolume ?? 0.5);

    try {
      const AH = getAudioHelper();
      await AH.play({ src, volume: vol, loop: !!loop }, false);
    } catch (error) {
      // Sound files may not exist yet — fail silently
      log.debug(`Sound not available: ${soundId}`);
    }
  }

  /**
   * Play a sound with per-play pitch/volume shaping — the public face of the
   * Web Audio path playClick uses. Terminal sound sets route through this so
   * a set can re-pitch existing assets into a different machine personality.
   * rate 1 short-circuits to the standard player (no Web Audio needed); a
   * failed Web Audio play falls back to the standard player un-pitched.
   * @param {string} soundId - Key from SOUND_PATHS
   * @param {object} [options]
   * @param {number} [options.volume=1] - Relative volume (scaled by the user slider)
   * @param {number} [options.rate=1] - Playback rate (pitch/speed)
   * @returns {Promise<void>}
   */
  async playStyled(soundId, { volume = 1, rate = 1 } = {}) {
    if (rate === 1) return this.play(soundId, { volume });
    const prefs = this._settings.getTheme();
    if (!prefs.soundEnabled) return;
    const userVol = prefs.soundVolume ?? 0.5;
    try {
      if (await this._playVaried(soundId, userVol * volume, rate)) return;
    } catch {
      // fall through to the standard player
    }
    this.play(soundId, { volume });
  }

  /**
   * Play the UI "click" with per-press variation so repeated clicks don't
   * sound identical/machine-gun. Quieter than event sounds (`CLICK_GAIN`),
   * with randomized pitch + a little volume jitter via a Web Audio buffer
   * source. Falls back to the standard player (reduced volume, no pitch
   * shift) if Web Audio is unavailable.
   * @returns {Promise<void>}
   */
  async playClick() {
    const prefs = this._settings.getTheme();
    if (!prefs.soundEnabled) return;

    const userVol = prefs.soundVolume ?? 0.5;
    const jitter = 0.85 + Math.random() * 0.30;             // 0.85–1.15 volume
    const gain = SoundService.CLICK_GAIN * jitter;
    const rate = 0.94 + Math.random() * 0.12;               // 0.94–1.06 pitch

    try {
      if (await this._playVaried('click', userVol * gain, rate)) return;
    } catch {
      // fall through to the standard player
    }
    // Fallback keeps the lower volume + jitter, just no pitch shift.
    this.play('click', { volume: gain });
  }

  /**
   * Play a sound through a one-shot Web Audio buffer source so pitch/volume
   * can be varied per play (AudioHelper.play has no per-play rate control).
   * @param {string} soundId
   * @param {number} volume - Final linear gain (already includes user volume)
   * @param {number} [rate=1] - Playback rate (pitch)
   * @returns {Promise<boolean>} true if it played, false to signal fallback
   * @private
   */
  async _playVaried(soundId, volume, rate = 1) {
    const ctx = this._getAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }

    const buffer = await this._getBuffer(soundId, ctx);
    if (!buffer) return false;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, volume);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(0);
    return true;
  }

  /**
   * Resolve an AudioContext — prefer a Foundry-managed one (shares its unlock
   * state), else lazily create our own. Clicks are user gestures so the
   * context will be allowed to run.
   * @returns {?AudioContext}
   * @private
   */
  _getAudioContext() {
    const fctx = game.audio?.getAudioContext?.()
      ?? game.audio?.context
      ?? game.audio?.music?.context
      ?? game.audio?.interface?.context;
    if (fctx) return fctx;
    if (this._ownCtx === undefined) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this._ownCtx = AC ? new AC() : null;
      } catch { this._ownCtx = null; }
    }
    return this._ownCtx;
  }

  /**
   * Fetch + decode a sound into a cached AudioBuffer (null cached on failure
   * so we don't refetch a missing file every click).
   * @param {string} soundId
   * @param {AudioContext} ctx
   * @returns {Promise<?AudioBuffer>}
   * @private
   */
  async _getBuffer(soundId, ctx) {
    this._uiBuffers ??= {};
    if (this._uiBuffers[soundId] !== undefined) return this._uiBuffers[soundId];

    const rel = SOUND_PATHS[soundId];
    if (!rel) return (this._uiBuffers[soundId] = null);
    try {
      const resp = await fetch(`modules/${MODULE_ID}/assets/sounds/${rel}`);
      if (!resp.ok) return (this._uiBuffers[soundId] = null);
      const arr = await resp.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      this._uiBuffers[soundId] = buf;
      return buf;
    } catch {
      return (this._uiBuffers[soundId] = null);
    }
  }

  /**
   * Stop all playing sounds (future: track active sounds)
   */
  stopAll() {
    // Placeholder for future active sound tracking
  }

  /**
   * Check if sound is enabled
   * @returns {boolean}
   */
  get enabled() {
    return this._settings.getTheme().soundEnabled ?? true;
  }

  /**
   * Preload commonly-used sounds to avoid first-play delay.
   * Each preload is individually timeout-protected so a missing
   * file can never hang the process.
   * @private
   */
  async _preload() {
    if (this._preloaded) return;

    const AH = getAudioHelper();
    if (!AH?.preloadSound) {
      log.debug('AudioHelper.preloadSound not available — skipping preload');
      this._preloaded = true;
      return;
    }

    const prioritySounds = ['click', 'receive', 'send', 'open', 'close'];
    for (const id of prioritySounds) {
      const relativePath = SOUND_PATHS[id];
      if (relativePath) {
        const src = `modules/${MODULE_ID}/assets/sounds/${relativePath}`;
        try {
          // Timeout protection: never wait more than 2s per sound
          await Promise.race([
            AH.preloadSound(src),
            new Promise(resolve => setTimeout(resolve, 2000)),
          ]);
        } catch {
          // Sound files may not exist yet
        }
      }
    }

    this._preloaded = true;
    log.debug('Priority sounds preloaded');
  }
}
