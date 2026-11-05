// A small stand-in for Foundry's journals, for sims that hand-build `globalThis.game` (stage 2, step 13).
// Enough for scripts/data/gmLogStore.js and other journal-backed stores: game.journal (find / contents / get),
// JournalEntry.create, journal.pages with createEmbeddedDocuments / deleteEmbeddedDocuments, and documents with
// getFlag and a dot-path update. New sims should prefer lib/world.mjs, which has all of this and more.
//
//   import { installJournals } from './lib/journalMock.mjs';
//   const J = installJournals(globalThis.game);     // after game exists
//   J.writes   → how many page updates happened;   J.all() → the journals
const MOD = 'night-city-messenger';
let n = 0;
const setPath = (obj, path, value) => { const k = path.split('.'); let o = obj; while (k.length > 1) { const p = k.shift(); o = o[p] ??= {}; } o[k[0]] = value; };
const getFlag = (doc) => (scope, key) => doc.flags?.[scope]?.[key];

export function installJournals(game) {
  const journals = [];
  const state = { writes: 0, creates: 0 };
  const makeDoc = (data, parent = null) => {
    const doc = { id: `doc${++n}`, ...structuredClone(data), parent };
    doc.flags ??= {};
    doc.getFlag = getFlag(doc);
    doc.update = async (patch) => { state.writes++; for (const [k, v] of Object.entries(patch)) setPath(doc, k, structuredClone(v)); return doc; };
    return doc;
  };
  const makeJournal = (data) => {
    const j = makeDoc({ ...data, pages: undefined });
    const pages = [];
    j.pages = Object.assign(pages, { contents: pages, get: (id) => pages.find((p) => p.id === id) || null });
    j.createEmbeddedDocuments = async (type, list) => { const made = list.map((d) => makeDoc(d, j)); pages.push(...made); state.creates += made.length; return made; };
    j.deleteEmbeddedDocuments = async (type, ids) => { for (const id of ids) { const i = pages.findIndex((p) => p.id === id); if (i >= 0) pages.splice(i, 1); } return ids; };
    return j;
  };
  game.journal = Object.assign(journals, { contents: journals, get: (id) => journals.find((j) => j.id === id) || null });
  globalThis.JournalEntry = { create: async (data) => { const j = makeJournal(data); journals.push(j); return j; } };
  return {
    get writes() { return state.writes; }, get creates() { return state.creates; },
    all: () => journals,
    /** rows of a GM log page (data/gmLogStore.js), or null when there is no page */
    gmLogRows: (name) => {
      for (const j of journals) for (const p of j.pages) if (p.flags?.[MOD]?.gmLog === name) return p.flags[MOD].rows;
      return null;
    },
  };
}
