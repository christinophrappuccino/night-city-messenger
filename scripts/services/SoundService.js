/**
 * SoundService — Audio Management
 * @file scripts/services/SoundService.js
 * @module cyberpunkred-messenger
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
