/**
 * Read a program's own shard entry (GM side).
 * @file scripts/utils/programSource.js
 * @module night-city-messenger
 * @description A player's request names WHICH program they used ({ itemUuid, entryId }); the GM reads what it does
 *   from the entry itself, which only the GM's tools write. That is how a macro link stays a GM's: it is never in
 *   the message (AUDIT-POST §2: a socket handler trusts the sender, never a field). Lives in utils so services can
 *   use it (SiphonFlow.programMacroId re-uses it for terminal uploads).
 */

import { MODULE_ID } from './constants.js';
import { log } from './helpers.js';

/**
 * @param {{itemUuid?:string, entryId?:string}} source
 * @returns {Promise<{shard:Item, contentData:object}|null>}
 */
export async function programEntry(source) {
  const { itemUuid, entryId } = source || {};
  if (!itemUuid || !entryId || typeof itemUuid !== 'string' || typeof entryId !== 'string') return null;
  try {
    const shard = await fromUuid(itemUuid);
    if (!shard || typeof shard.getFlag !== 'function') return null;
    const journalId = shard.getFlag?.(MODULE_ID, 'journalId');
    const journal = journalId ? game.journal?.get(journalId) : null;
    const page = journal?.pages?.find?.((p) => p.flags?.[MODULE_ID]?.messageId === entryId);
    const contentData = page?.flags?.[MODULE_ID]?.contentData;
    return contentData ? { shard, contentData } : null;
  } catch (err) {
    log.warn(`Program entry lookup failed: ${err.message}`);
    return null;
  }
}
