/**
 * Shard item naming — the optional name prefix (world setting `shardNamePrefix`)
 * and the "what was this item before it was a shard" record.
 *
 * Pure: no Foundry globals, so the sims drive it directly. Callers pass the
 * prefix in (SettingsManager.getShardNamePrefix()).
 *
 * The prefix is matched case-insensitively, so a GM who switches "Shard-" to
 * "shard-" does not get "shard-Shard-Pistol".
 */

const startsWithCI = (s, p) => String(s ?? '').toLowerCase().startsWith(String(p ?? '').toLowerCase());

/** "Pistol" + "Chip - " → "Chip - Pistol". Already prefixed, or no prefix → unchanged. */
export function withShardPrefix(name, prefix) {
  const n = String(name ?? '');
  const p = String(prefix ?? '');
  if (!p.trim() || startsWithCI(n, p)) return n;
  return `${p}${n}`;
}

/** "Chip - Pistol" → "Pistol". Not prefixed, or no prefix → unchanged (never empties a name). */
export function stripShardPrefix(name, prefix) {
  const n = String(name ?? '');
  const p = String(prefix ?? '');
  if (!p.trim() || !startsWithCI(n, p)) return n;
  const rest = n.slice(p.length).replace(/^\s+/, '');
  return rest || n;
}

/**
 * The item patch that undoes a conversion. `original` is the `{name, img}`
 * recorded when the item became a shard; a shard converted before that record
 * existed has none, so the name just loses the prefix and the art stays.
 */
export function restorePatch(item, original, prefix) {
  const patch = {};
  const name = original?.name ? String(original.name) : stripShardPrefix(item?.name, prefix);
  if (name && name !== item?.name) patch.name = name;
  if (original?.img && original.img !== item?.img) patch.img = original.img;
  return patch;
}
