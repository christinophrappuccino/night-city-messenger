/**
 * Terminal commands other modules add (API v2.2.0, `terminals.registerCommand`).
 * @file scripts/utils/terminalCommands.js
 * @module night-city-messenger
 *
 * The TTY mailbox's own commands (a number, m, f, cd, su, write…) are fixed in TerminalViewerApp._onTtyCommand. A
 * command another module registers is looked up only after those, just before "unknown command", and listed under ?.
 * It runs on the client that typed it; whatever it changes outside NCM is that module's business (its own sockets,
 * its own permission checks). NCM never relays it. Registrations live in this client's memory only: a module
 * registers on every client at ready.
 *
 * A registration: { name, help?, applies?(ctx) → boolean, run(ctx) → string | string[] | Promise<…> }, where ctx is
 * plain data: { itemId, itemUuid, terminalName, accountId, username, args: string[], raw, userId, actorId }.
 */

const REGISTRY = new Map();
const NAME = /^[a-z][a-z0-9_-]{0,23}$/;
/** The names the viewer handles itself: a registration can't take one. */
export const RESERVED = new Set(['m', 'mail', 'f', 'files', 'ls', 'clear', 'back', 'q', 'su', 'exit', 'write', 'compose', 'w', 'reply', 'r',
  'logout', 'switch', 'users', 'n', 'p', 'help', 'cd']);

/** Add (or replace) a command. Returns an unregister function, or null when the name is taken or malformed. */
export function registerTerminalCommand(def) {
  const name = String(def?.name || '').trim().toLowerCase();
  if (!NAME.test(name) || RESERVED.has(name) || typeof def?.run !== 'function') return null;
  const entry = { name, help: String(def.help || '').slice(0, 120), applies: typeof def.applies === 'function' ? def.applies : null, run: def.run };
  REGISTRY.set(name, entry);
  return () => { if (REGISTRY.get(name) === entry) REGISTRY.delete(name); };
}
/** The registered commands that apply to this terminal session. */
export function commandsFor(ctx) {
  return [...REGISTRY.values()].filter((c) => { try { return !c.applies || c.applies(ctx) !== false; } catch { return false; } });
}
/** Run a typed line if a registered command takes it. Resolves the lines to show, or null when none matched. */
export async function runTerminalCommand(raw, ctx) {
  const [head, ...args] = String(raw || '').trim().split(/\s+/);
  const c = commandsFor(ctx).find((x) => x.name === String(head || '').toLowerCase());
  if (!c) return null;
  try {
    const out = await c.run({ ...ctx, args, raw: String(raw || '') });
    return (Array.isArray(out) ? out : [out]).map((l) => String(l ?? '')).filter(Boolean);
  } catch (err) { return [`${c.name}: ${err?.message || 'failed'}`]; }
}
/** For the sims. */
export const _registry = REGISTRY;
