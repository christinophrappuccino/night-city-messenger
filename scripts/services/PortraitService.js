/**
 * Portrait Service — Contact Image Management
 * @file scripts/services/PortraitService.js
 * @module cyberpunkred-messenger
 * @description Client-side image processing for contact portraits.
 *   Handles upload, resize/crop to 128×128, base64 conversion,
 *   storage via ContactRepository, and fallback chain logic.
 *
 * Sprint 3.3 deliverables:
 *   - Upload via Foundry FilePicker or native file input
 *   - Client-side resize/crop to 128×128 (canvas)
 *   - Storage as base64 in contact flags or as module file path
 *   - Fallback chain: custom portrait → linked actor img → initials
 *   - Permission model: players own contacts, GMs any contact
 *   - "Include portrait" toggle for share/push operations
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

/** Maximum portrait dimension (square) */
const PORTRAIT_SIZE = 128;

/** Maximum base64 size before we warn (500KB) */
const MAX_BASE64_BYTES = 500 * 1024;

/** Accepted image MIME types */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export class PortraitService {

  // ═══════════════════════════════════════════════════════════
  //  Service Accessors
  // ═══════════════════════════════════════════════════════════

  get contactRepo() { return game.nightcity?.contactRepository; }

  // ═══════════════════════════════════════════════════════════
  //  Upload Methods
  // ═══════════════════════════════════════════════════════════

  /**
   * Open Foundry's FilePicker to select an image, then process and store it.
   * Best for GMs and players who want to use existing module/world images.
   *
   * @param {string} actorId — Owner actor
   * @param {string} contactId — Target contact
   * @param {object} [options]
   * @param {boolean} [options.useBase64=false] — If true, fetch and convert to base64.
   *   If false, store the Foundry file path directly (lighter on flags).
   * @returns {Promise<{success: boolean, portrait?: string, error?: string}>}
   */
  async uploadViaFilePicker(actorId, contactId, options = {}) {
    return new Promise((resolve) => {
      const fp = new FilePicker({
        type: 'image',
        current: '',
        callback: async (path) => {
          if (!path) return resolve({ success: false, error: 'No file selected' });

          try {
            let portrait;

            if (options.useBase64) {
              // Fetch image, resize, convert to base64
              portrait = await this.processImageFromUrl(path);
            } else {
              // Store the file path directly (Foundry can serve it)
              portrait = path;
            }

            const result = await this.contactRepo.setPortrait(actorId, contactId, portrait);
            resolve(result.success
              ? { success: true, portrait }
              : { success: false, error: result.error }
            );
          } catch (error) {
            log.error('PortraitService.uploadViaFilePicker:', error);
            resolve({ success: false, error: error.message });
          }
        },
      });
      fp.browse();
    });
  }

  /**
   * Open a native file input dialog for direct image upload.
   * Processes the file client-side (resize/crop), stores as base64.
   * Best for players uploading from their local machine.
   *
   * @param {string} actorId — Owner actor
   * @param {string} contactId — Target contact
   * @returns {Promise<{success: boolean, portrait?: string, error?: string}>}
   */
  async uploadViaFileInput(actorId, contactId) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';

      input.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        input.remove();

        if (!file) return resolve({ success: false, error: 'No file selected' });

        if (!ACCEPTED_TYPES.includes(file.type)) {
          return resolve({ success: false, error: `Unsupported image type: ${file.type}` });
        }

        try {
          const portrait = await this.processImageFile(file);
          const result = await this.contactRepo.setPortrait(actorId, contactId, portrait);
          resolve(result.success
            ? { success: true, portrait }
            : { success: false, error: result.error }
          );
        } catch (error) {
          log.error('PortraitService.uploadViaFileInput:', error);
          resolve({ success: false, error: error.message });
        }
      });

      input.addEventListener('cancel', () => {
        input.remove();
        resolve({ success: false, error: 'Upload cancelled' });
      });

      document.body.appendChild(input);
      input.click();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Image Processing
  // ═══════════════════════════════════════════════════════════

  /**
   * Process a File object: resize/crop to 128×128, return base64.
   * Uses center-crop strategy (takes the largest centered square).
   *
   * @param {File} file — Image file from file input
   * @returns {Promise<string>} base64 data URL
   */
  async processImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const base64 = this._resizeAndCrop(img);
            resolve(base64);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Process an image from a URL (Foundry path or web URL).
   * Fetches, resizes/crops to 128×128, returns base64.
   *
   * @param {string} url — Image URL or Foundry file path
   * @returns {Promise<string>} base64 data URL
   */
  async processImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        try {
          const base64 = this._resizeAndCrop(img);
          resolve(base64);
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = () => reject(new Error(`Failed to load image from: ${url}`));
      img.src = url;
    });
  }

  /**
   * Center-crop and resize an image to PORTRAIT_SIZE × PORTRAIT_SIZE.
   * Takes the largest centered square from the source, scales to target size.
   *
   * @param {HTMLImageElement} img — Loaded image element
   * @returns {string} base64 data URL (image/webp preferred, falls back to png)
   * @private
   */
  _resizeAndCrop(img) {
    const canvas = document.createElement('canvas');
    canvas.width = PORTRAIT_SIZE;
    canvas.height = PORTRAIT_SIZE;
    const ctx = canvas.getContext('2d');

    // Calculate center crop
    const srcSize = Math.min(img.naturalWidth, img.naturalHeight);
    const srcX = (img.naturalWidth - srcSize) / 2;
    const srcY = (img.naturalHeight - srcSize) / 2;

    // Draw cropped + resized
    ctx.drawImage(
      img,
      srcX, srcY, srcSize, srcSize,     // Source rectangle (centered square)
      0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE  // Destination (128×128)
    );

    // Prefer WebP for smaller size, fall back to PNG
    let base64 = canvas.toDataURL('image/webp', 0.85);
    if (!base64.startsWith('data:image/webp')) {
      base64 = canvas.toDataURL('image/png');
    }

    // Size check
    const sizeBytes = Math.ceil((base64.length - 'data:image/webp;base64,'.length) * 0.75);
    if (sizeBytes > MAX_BASE64_BYTES) {
      log.warn(`Portrait base64 is ${(sizeBytes / 1024).toFixed(0)}KB — consider using file path storage.`);
    }

    return base64;
  }

  // ═══════════════════════════════════════════════════════════
  //  Fallback Chain
  // ═══════════════════════════════════════════════════════════

  /**
   * Resolve the best available portrait source for a contact.
   * Priority: custom portrait → linked actor img → null (caller uses initials).
   *
   * @param {object} contact — Contact data from ContactRepository
   * @returns {string|null} Image URL/base64 or null
   */
  resolvePortrait(contact) {
    // 1. Custom portrait (base64 or file path)
    if (contact.portrait) return contact.portrait;

    // 2. Linked actor image
    if (contact.actorId) {
      const actor = game.actors.get(contact.actorId);
      if (actor?.img && actor.img !== 'icons/svg/mystery-man.svg') {
        return actor.img;
      }
    }

    // 3. Legacy customImg field
    if (contact.customImg) return contact.customImg;

    // 4. No portrait — caller renders initials
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  //  Permission Checks
  // ═══════════════════════════════════════════════════════════

  /**
   * Check if the current user can modify portraits for a given actor's contacts.
   *
   * @param {string} actorId — Actor who owns the contacts
   * @returns {boolean}
   */
  canUploadPortrait(actorId) {
    if (game.user.isGM) return true;
    const actor = game.actors.get(actorId);
    return actor?.isOwner ?? false;
  }

  /**
   * Check if the current user can modify portraits in the GM master directory.
   * @returns {boolean}
   */
  canUploadGMPortrait() {
    return game.user.isGM;
  }

  // ═══════════════════════════════════════════════════════════
  //  Share / Transfer Helpers
  // ═══════════════════════════════════════════════════════════

  /**
   * Prepare a contact for sharing. Optionally strips or includes the portrait.
   *
   * @param {object} contact — Source contact data
   * @param {object} options
   * @param {boolean} [options.includePortrait=true] — Include portrait in shared data
   * @param {boolean} [options.includeNotes=false] — Include personal notes
   * @param {boolean} [options.includeTags=true] — Include custom tags
   * @returns {object} Contact data ready for transfer
   */
  prepareForShare(contact, options = {}) {
    const {
      includePortrait = true,
      includeNotes = false,
      includeTags = true,
    } = options;

    const shared = { ...contact };

    // Always strip GM-only data
    delete shared.statusOverride;

    // Conditional stripping
    if (!includePortrait) {
      shared.portrait = '';
    }

    if (!includeNotes) {
      shared.notes = '';
    }

    if (!includeTags) {
      shared.tags = [];
    }

    // Generate new ID for the copy
    shared.id = foundry.utils.randomID();

    return shared;
  }

  /**
   * Convert a Foundry file path portrait to base64 for cross-user transfer.
   * File paths are local to the server and may not resolve for other users'
   * file storage. Base64 is self-contained.
   *
   * @param {string} portrait — Portrait value (may be path or already base64)
   * @returns {Promise<string>} base64 data URL
   */
  async ensureBase64(portrait) {
    if (!portrait) return '';

    // Already base64
    if (portrait.startsWith('data:')) return portrait;

    // Convert file path to base64
    try {
      return await this.processImageFromUrl(portrait);
    } catch (error) {
      log.warn(`Failed to convert portrait to base64: ${error.message}`);
      return '';
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Cleanup
  // ═══════════════════════════════════════════════════════════

  /**
   * Remove portrait from a contact.
   *
   * @param {string} actorId
   * @param {string} contactId
   * @returns {Promise<{success: boolean}>}
   */
  async removePortrait(actorId, contactId) {
    return this.contactRepo.setPortrait(actorId, contactId, '');
  }
}
