/**
 * Message templates — GM-saved mail the composer can insert (2026-10-28).
 * @file scripts/services/MessageTemplateService.js
 * @module night-city-messenger
 * @description World setting `messageTemplates`: `[{ id, name, subject, body,
 *   priority, encryption:{enabled,dv,type,failureMode}, selfDestruct:{enabled,
 *   mode}, createdAt }]`. Insert fills an empty subject, sets the delivery
 *   options the template carries, and asks Replace / Append for the body when
 *   the editor already has text. Save stores what is in the composer now (a
 *   name that exists asks Overwrite). Import / Export follow the spam-template
 *   envelope: `{ ncmMessageTemplates: 1, exportedAt, templates }`, a bare array
 *   accepted, fresh ids, de-duped by name case-insensitively.
 *   `game.nightcity.messageTemplateService`. Writes are GM-only.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log } from '../utils/helpers.js';

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent', 'critical']);
const ENC_TYPES = new Set(['ICE', 'RED_ICE', 'BLACK_ICE']);
const FAIL_MODES = new Set(['nothing', 'damage', 'lockout']);
const SD_MODES = new Set(['after_read', '1h', '6h', '24h']);

export class MessageTemplateService {
  static SETTING = 'messageTemplates';
  static ENVELOPE = 'ncmMessageTemplates';

  /** Normalise one template; unknown values fall back, the name is required. */
  static sanitize(raw, { id, now } = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim();
    if (!name) return null;
    const enc = raw.encryption && typeof raw.encryption === 'object' ? raw.encryption : {};
    const sd = raw.selfDestruct && typeof raw.selfDestruct === 'object' ? raw.selfDestruct : {};
    const dv = Math.max(1, Math.min(30, parseInt(enc.dv) || 12));
    return {
      id: id || raw.id || MessageTemplateService._id(),
      name,
      subject: String(raw.subject || ''),
      body: String(raw.body || ''),
      priority: PRIORITIES.has(raw.priority) ? raw.priority : 'normal',
      encryption: {
        enabled: !!enc.enabled,
        dv,
        type: ENC_TYPES.has(enc.type) ? enc.type : 'ICE',
        failureMode: FAIL_MODES.has(enc.failureMode) ? enc.failureMode : 'nothing',
      },
      selfDestruct: { enabled: !!sd.enabled, mode: SD_MODES.has(sd.mode) ? sd.mode : 'after_read' },
      createdAt: raw.createdAt || now || new Date().toISOString(),
    };
  }

  static _id() {
    const rid = globalThis.foundry?.utils?.randomID;
    return `tpl-${rid ? rid(8) : Math.random().toString(36).slice(2, 10)}`;
  }

  /** "subject + body + ICE DV 14 · self-destruct" — what a template carries. */
  static summary(t) {
    const parts = [];
    if (t.subject) parts.push('subject');
    if (String(t.body || '').replace(/<[^>]*>/g, '').trim()) parts.push('body');
    let s = parts.length ? parts.join(' + ') : 'empty';
    const extras = [];
    if (t.priority && t.priority !== 'normal') extras.push(t.priority);
    if (t.encryption?.enabled) extras.push(`${t.encryption.type === 'BLACK_ICE' ? 'Black ICE' : t.encryption.type === 'RED_ICE' ? 'Red ICE' : 'ICE'} DV ${t.encryption.dv}`);
    if (t.selfDestruct?.enabled) extras.push('self-destruct');
    if (extras.length) s += ` · ${extras.join(' · ')}`;
    return s;
  }

  /** Pure de-dupe + sanitise of an import payload against existing names (no globals). */
  static mergeImport(existing, payload, now) {
    const incoming = Array.isArray(payload) ? payload : payload?.templates;
    if (!Array.isArray(incoming)) throw new Error('Invalid format — expected a message-template export or a JSON array.');
    const names = new Set((existing || []).map(t => t.name.toLowerCase()));
    const added = [];
    let skipped = 0;
    for (const raw of incoming) {
      const t = MessageTemplateService.sanitize(raw, { id: MessageTemplateService._id(), now });
      if (!t || names.has(t.name.toLowerCase())) { skipped++; continue; }
      names.add(t.name.toLowerCase());
      added.push(t);
    }
    return { added, skipped };
  }

  // ── reads ──

  getAll() {
    try {
      const v = game.settings.get(MODULE_ID, MessageTemplateService.SETTING);
      return Array.isArray(v) ? v.map(t => MessageTemplateService.sanitize(t)).filter(Boolean) : [];
    } catch { return []; }
  }

  get(id) { return this.getAll().find(t => t.id === id) || null; }

  findByName(name) {
    const n = String(name || '').trim().toLowerCase();
    return n ? (this.getAll().find(t => t.name.toLowerCase() === n) || null) : null;
  }

  get count() { return this.getAll().length; }

  // ── writes (GM only) ──

  async _write(list) {
    if (!game.user?.isGM) throw new Error('Only the GM can change message templates.');
    await game.settings.set(MODULE_ID, MessageTemplateService.SETTING, list);
  }

  /**
   * Save a template; the same name (case-insensitive) overwrites, keeping the id.
   * @returns {Promise<{ template: object, overwrote: boolean }>}
   */
  async save(raw) {
    const list = this.getAll();
    const existing = this.findByName(raw?.name);
    const t = MessageTemplateService.sanitize(raw, { id: existing?.id });
    if (!t) throw new Error('A template needs a name.');
    if (existing) { t.createdAt = existing.createdAt; }
    const next = existing ? list.map(x => (x.id === existing.id ? t : x)) : [...list, t];
    await this._write(next);
    return { template: t, overwrote: !!existing };
  }

  async remove(id) {
    const list = this.getAll();
    const next = list.filter(t => t.id !== id);
    if (next.length === list.length) return false;
    await this._write(next);
    return true;
  }

  exportTemplates() {
    return { [MessageTemplateService.ENVELOPE]: 1, exportedAt: new Date().toISOString(), templates: this.getAll() };
  }

  /** @returns {Promise<{ imported: number, skipped: number }>} */
  async importTemplates(payload) {
    const list = this.getAll();
    const { added, skipped } = MessageTemplateService.mergeImport(list, payload);
    if (added.length) await this._write([...list, ...added]);
    log.info(`MessageTemplateService: imported ${added.length} (${skipped} skipped)`);
    return { imported: added.length, skipped };
  }
}
