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

export class SoundService {
  /**
   * @param {SettingsManager} settingsManager
   */
  constructor(settingsManager) {
    this._settings = settingsManager;
    this._preloaded = false;
  }

  /**
   * Initialize — preload common sounds
   */
  async initialize() {
    await this._preload();
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
      await AudioHelper.play({ src, volume: vol, loop: !!loop }, false);
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
   * Preload commonly-used sounds to avoid first-play delay
   * @private
   */
  async _preload() {
    if (this._preloaded) return;

    const prioritySounds = ['click', 'receive', 'send', 'open', 'close'];
    for (const id of prioritySounds) {
      const relativePath = SOUND_PATHS[id];
      if (relativePath) {
        const src = `modules/${MODULE_ID}/assets/sounds/${relativePath}`;
        try {
          await AudioHelper.preloadSound(src);
        } catch {
          // Sound files may not exist yet
        }
      }
    }

    this._preloaded = true;
    log.debug('Priority sounds preloaded');
  }
}
