// Multi-client socket harness for NCM sims (audit remediation A1).
//
// A fake Foundry server plus N clients, each running its OWN instance of the
// real SocketManager. The server behaves like Foundry 12's handleCustomSocket
// (dist/server/sockets.mjs): an emit reaches every OTHER connected client, and
// the server appends the emitting user's id as the listener's second argument.
// Nothing the emitting client writes into the payload can change that id.
//
// Each client has its own `game` (user, users, actors, socket). Delivery swaps
// globalThis.game to the recipient's while its handler runs, so code that reads
// `game.user` sees the right client. Delivery is synchronous; an async handler's
// code after its first `await` runs with whatever `game` is current then, so
// sims that need a whole async handler should `await world.settle(promise)` or
// read their results synchronously.
//
// Usage:
//   const world = await createWorld({ users: [
//     { id: 'gm1', name: 'GM', isGM: true },
//     { id: 'p1', name: 'Rache', isGM: false },
//   ], actors: [{ id: 'a1', name: 'V', owners: ['p1'] }] });
//   const gm = world.client('gm1');
//   gm.sockets.register(op, (data, sender) => …);
//   world.client('p1').sockets.emit(op, { … });   // honest emit
//   world.client('p1').rawEmit({ operation: op, data: {}, sender: 'gm1' }); // forged payload
//   world.flush();

import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const EVENT = 'module.night-city-messenger';

function makeUsers(defs, clientsById) {
  const users = defs.map((d) => ({
    id: d.id,
    name: d.name ?? d.id,
    isGM: !!d.isGM,
    role: d.role ?? (d.isGM ? 4 : 1),
    get active() { return clientsById.get(d.id)?.connected ?? false; },
  }));
  const coll = {
    get: (id) => users.find((u) => u.id === id) ?? null,
    find: (fn) => users.find(fn) ?? null,
    filter: (fn) => users.filter(fn),
    some: (fn) => users.some(fn),
    map: (fn) => users.map(fn),
    get contents() { return users; },
    [Symbol.iterator]: () => users[Symbol.iterator](),
    // Foundry 12: the connected GM with the highest role, ties broken by id.
    get activeGM() {
      return users.filter((u) => u.active && u.isGM)
        .sort((a, b) => (b.role - a.role) || a.id.localeCompare(b.id))[0] ?? null;
    },
  };
  return coll;
}

function makeActors(defs) {
  const OWNER = 3;
  const actors = defs.map((d) => ({
    id: d.id,
    name: d.name ?? d.id,
    ownership: Object.fromEntries((d.owners || []).map((u) => [u, OWNER])),
    testUserPermission(user, level) {
      if (user?.isGM) return true;
      return (this.ownership[user?.id] ?? 0) >= level;
    },
  }));
  return {
    get: (id) => actors.find((a) => a.id === id) ?? null,
    find: (fn) => actors.find(fn) ?? null,
    filter: (fn) => actors.filter(fn),
    [Symbol.iterator]: () => actors[Symbol.iterator](),
  };
}

export async function createWorld({ users = [], actors = [] } = {}) {
  const { SocketManager } = await import(pathToFileURL(`${ROOT}/scripts/core/SocketManager.js`).href);
  const clientsById = new Map();
  const queue = [];
  const userColl = makeUsers(users, clientsById);
  const actorColl = makeActors(actors);
  const log = [];   // every delivery: { event, from, to, message }

  for (const def of users) {
    const listeners = new Map();
    const client = {
      id: def.id,
      connected: def.connected ?? true,
      listeners,
      game: null,
      sockets: null,
      /** Emit a raw payload exactly as a hostile console could. */
      rawEmit(message) { queue.push({ event: EVENT, from: def.id, message }); },
    };
    client.game = {
      user: userColl.get(def.id),
      users: userColl,
      actors: actorColl,
      nightcity: {},
      socket: {
        on(event, fn) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(fn); },
        emit(event, message) { queue.push({ event, from: def.id, message }); },
      },
    };
    // One real SocketManager per client, bypassing the singleton.
    const sm = Object.create(SocketManager.prototype);
    sm._handlers = new Map();
    sm._initialized = false;
    client.sockets = sm;
    clientsById.set(def.id, client);
    withGame(client.game, () => sm.initialize());
  }

  function withGame(g, fn) {
    const prev = globalThis.game;
    globalThis.game = g;
    try { return fn(); } finally { globalThis.game = prev; }
  }

  const world = {
    clients: clientsById,
    log,
    client(id) { return clientsById.get(id); },
    /** Run code as this client (its `game` is current while fn runs). */
    as(id, fn) { return withGame(clientsById.get(id).game, fn); },
    /** Deliver everything queued, like the server would. Returns the number of deliveries. */
    flush() {
      let n = 0;
      while (queue.length) {
        const { event, from, message } = queue.shift();
        for (const c of clientsById.values()) {
          if (c.id === from || !c.connected) continue;   // the server never echoes to the sender
          const fns = c.listeners.get(event) || [];
          for (const fn of fns) {
            withGame(c.game, () => fn(message, from));      // 2nd arg = the server's user id
            log.push({ event, from, to: c.id, message });
            n++;
          }
        }
      }
      return n;
    },
    /** Await a promise with this client's game current at start (best effort; see header). */
    async settle(promise) { return promise; },
    users: userColl,
    actors: actorColl,
  };
  return world;
}
