/**
 * What the world calls a payphone — the `payphoneTerm` world setting (dev, 2026-11-05: "similar to memory chip").
 *
 * The sibling of shardTerm.js. Player-facing words read it at the moment they are shown: the booth's screen and
 * the other end of a call ("Payphone, Kabuki"), the map pins' labels, the ringing toast, the walk-up messages.
 * GM tools (Admin → Phone, Access, the payphone editor) keep saying "payphone" — plain language for the GM, the
 * table's word for the players. Stored keys, flags, setting names and sounds never change; it is a label.
 *
 * Read live (no reload): only the map pins carry the word in their stored text, and the setting's onChange renames
 * them (TerminalScenePins.relabelPayphones, primary GM).
 */

export const PAYPHONE_TERM_DEFAULT = 'Payphone';

/** The term from a raw setting value: trimmed, one line, at most 40 characters, the default when empty. Pure. */
export function resolvePayphoneTerm(raw) {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return t || PAYPHONE_TERM_DEFAULT;
}

/** The current world's term (the default before settings exist). */
export function payphoneTermRaw() {
  let raw = '';
  try { raw = game.settings.get('night-city-messenger', 'payphoneTerm'); } catch { /* not registered yet */ }
  return resolvePayphoneTerm(raw);
}

/**
 * The term, cased: '' as typed (Title Case for the default), 'lower' for mid-sentence ("the payphone"),
 * 'upper' for a sign. `a: true` puts "a" / "an" in front.
 * @param {''|'lower'|'upper'} [mode]
 * @param {{a?: boolean}} [opts]
 */
export function payphoneTerm(mode = '', { a = false } = {}) {
  let t = payphoneTermRaw();
  if (mode === 'lower') t = t.toLowerCase();
  else if (mode === 'upper') t = t.toUpperCase();
  return a ? `${/^[aeiou]/i.test(t) ? 'an' : 'a'} ${t}` : t;
}

/** "Payphone, Kabuki" — a booth as its screen, the other end and the map name it. */
export function payphonePlace(name) {
  return `${payphoneTermRaw()}, ${name || 'somewhere'}`;
}
