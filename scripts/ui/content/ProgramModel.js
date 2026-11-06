/**
 * Program Model — the Malware Workshop's authoring format and its mapping to real
 * content entries.
 * @file scripts/ui/content/ProgramModel.js
 * @module night-city-messenger
 * @description The workshop authors a self-contained `program` definition (below).
 *   `programToEntry(program)` turns it into the `{ contentType, contentData, subject,
 *   from }` an item entry expects — as a **payload** (utility program: instant effect
 *   + disguise + execute gate) OR a **malware** file (hostile: honeypot / linked ICE /
 *   plant, plus an `uploadEffect` execute verb). `entryToProgram(entry)` is the reverse
 *   (edit / load-from-library). Both directions round-trip through the real
 *   `PROGRAM_EFFECTS` catalog so the workshop can never offer a verb an applier lacks.
 *
 *   Two additive contentData fields the workshop introduces (GM-approved): `iconClass`
 *   (the authored file/program glyph, honored by the renderer) and, on malware, the
 *   payload-parity `disguised`/`disguiseType`/`sniffDV`. Nothing breaks when absent.
 */

import { CONTENT_TYPES } from '../../utils/constants.js';
import { PROGRAM_EFFECTS, programEffectInfo, programEffectOptions } from './ContentRenderers.js';

/** Ability family → chamber temperature (colour encodes the kind of harm). */
export const FAMILY = Object.freeze({
  Utility:     { v: 'var(--ncm-secondary,#19f3f7)', word: 'Utility program' },
  Sabotage:    { v: 'var(--ncm-warning,#ffab00)',   word: 'Sabotage' },
  Persistence: { v: 'var(--ncm-danger,#ff0033)',    word: 'Persistence' },
  Network:     { v: 'var(--ncm-purple,#a855f7)',    word: 'Network program' },
  Custom:      { v: 'var(--ncm-accent,#f7c948)',    word: 'Custom routine' },
});

/** Real cover types a disguise can wear — these are content types `_disguiseCover` renders. */
export const COVER_TYPES = Object.freeze([
  { value: 'note',    label: 'a plain note',   icon: 'fas fa-note-sticky' },
  { value: 'message', label: 'a message',      icon: 'fas fa-envelope' },
  { value: 'eddies',  label: 'an eddies drop', icon: 'fas fa-coins' },
  { value: 'dossier', label: 'a dossier',      icon: 'fas fa-id-card' },
]);

/** Resident triggers (for malware execute verbs, once uploaded). */
export const TRIGGERS = Object.freeze({
  onLogin:  ['Next login',        'the next time anyone logs into the target', 'Sleeps until someone logs in.'],
  onDate:   ['On a date',         'on a date you set',                         'Fires on the game clock, whether anyone is looking.'],
  onAction: ['After an action',   'the next time someone acts on the target',  'Waits for a specific move — a siphon, a decrypt, an exfil.'],
  onHeat:   ['When they run hot', 'once the operator is running hot enough',   'Fires once this operator’s heat on the target crosses your line.'],
});

export const THREAT_WORD = Object.freeze(['Harmless', 'Nuisance', 'Serious', 'Severe', 'Catastrophic']);

/** The workshop's "Plant a forgery" pseudo-verb — a malware file with no execute effect. */
const PLANT_ABILITY = Object.freeze({
  key: 'plant', label: 'Plant a forgery', icon: 'fas fa-file-arrow-up',
  blurb: 'leaves a forged file for whoever looks next', group: 'Persistence',
  modes: ['triggered'], host: 'terminal', params: [],
});

/**
 * Abilities offered for a given program type.
 *  - payload → INSTANT verbs the operator runs on execute (Utility/Sabotage + Custom).
 *  - malware → a plain PLANT + the uploadable EXECUTE verbs + the NETWORK programs (inserted into a node from a
 *    jack-in session) + Custom.
 * @returns {Array<{key,label,icon,blurb,group,modes,host,params}>}
 */
export function abilitiesFor(type) {
  if (type === 'malware') {
    const execs = programEffectOptions({ mode: 'triggered', host: 'terminal', exclude: ['plant', 'logicBomb', 'adjudicate'] });
    return [PLANT_ABILITY, ...execs, ...programEffectOptions({ mode: 'node' }), { key: 'adjudicate', ...PROGRAM_EFFECTS.adjudicate, params: PROGRAM_EFFECTS.adjudicate.params || [] }];
  }
  return programEffectOptions({ mode: 'instant' });
}

/** Info for a workshop verb (handles the synthetic 'plant'). */
export function abilityInfo(verb) {
  if (verb === 'plant') return PLANT_ABILITY;
  return programEffectInfo(verb);
}

/** A network program: inserted into a node, never uploaded to a terminal. */
export const isNodeVerb = (verb) => /^node[A-Z]/.test(String(verb || ''));

/** Where a program runs, in words: { key: 'node'|'terminal'|'host', label }. Shown wherever a program is listed. */
export function programRunsOn(program) {
  const verb = program?.verb;
  if (isNodeVerb(verb)) return { key: 'node', label: 'a network node' };
  if (program?.type === 'malware') return { key: 'terminal', label: 'a terminal' };
  return { key: 'host', label: abilityInfo(verb)?.host === 'terminal' ? 'a terminal' : 'the shard or terminal it sits on' };
}

/** The legal values of "Waits for" → the action names the trace funnel reports. Older saves stored the label. */
export const TRIGGER_ACTIONS = Object.freeze([['siphon', 'a siphon'], ['crack', 'a crack'], ['unlock', 'a decrypt'], ['exfil', 'an exfil'], ['camera', 'a camera grab']]);
const triggerAction = (v) => (TRIGGER_ACTIONS.find(([a, l]) => a === v || l === v) || TRIGGER_ACTIONS[0])[0];

/** The window's own state, never part of a saved program. */
const UI_KEYS = ['saved', 'saving', 'build', 'lib', 'libSource', 'libCat', 'libSearch', 'libSort', 'iov', 'iovTab', 'iovTarget', 'iovPick', 'view'];
export function stripProgramUi(program) {
  const out = { ...(program || {}) };
  for (const k of UI_KEYS) delete out[k];
  return out;
}

/** Bring a saved program to the current shape (older library records + the description that used to land in params). */
export function normalizeProgram(program) {
  const p = stripProgramUi(program);
  p.params = { ...(p.params || {}) };
  if (!p.description && p.params.__desc) p.description = p.params.__desc;
  delete p.params.__desc;
  if (p.uploadDV === undefined) p.uploadDV = p.gate ? (Number(p.gateDV) || 9) : 9;
  if (!p.uploadSkill) p.uploadSkill = p.gateSkill || 'Interface';
  return p;
}

/** The family/colour group for a program (drives the chamber temperature). */
export function programGroup(program) {
  return abilityInfo(program?.verb)?.group || 'Custom';
}

/** A fresh program definition. */
export function defaultProgram(type = 'payload') {
  const malware = type === 'malware';
  return {
    type,                                 // 'payload' | 'malware'
    verb: malware ? 'deployICE' : 'scanner',
    trigger: 'onLogin',                   // malware execute verbs only (resident trigger)
    triggerDetail: '',                    // onDate iso / onAction move / onHeat threshold
    progName: malware ? 'Hellhound' : 'Icepick',
    icon: malware ? 'fas fa-biohazard' : 'fas fa-satellite-dish',
    disguised: malware,
    coverName: 'shift-notes.txt',
    coverIcon: 'fas fa-note-sticky',
    passes: 'note',                       // a COVER_TYPES value
    scan: 'Personal notes — nothing flagged.',
    threat: malware ? 3 : 1,
    detectDV: 17,                         // ANALYZE / System-Sweep DV
    decoy: false,                         // fires a trace when probed/failed
    uses: malware ? 1 : 0,                // 0 = unlimited (payload charges)
    honeypot: false,                      // malware only
    iceActorId: '',
    gate: false, gateSkill: 'Interface', gateDV: 9,    // run/deploy gate
    uploadSkill: 'Interface', uploadDV: 9,             // the roll to push it onto a machine or node
    description: '',                                   // what it does, in the GM's words (every verb)
    mode: 'text', macroId: '',                         // custom: describe vs macro
    params: {},                           // per-verb params by field name
  };
}

/**
 * The resident trigger a program installs when uploaded: onLogin / onAction (+ which action) / onHeat (+ how hot) /
 * onDate (+ the game time, picked with the CyberTimePicker; the reaper reads atMs).
 */
function buildUploadTrigger(program) {
  const kind = program.trigger || 'onLogin';
  const t = { kind };
  if (kind === 'onAction') t.action = triggerAction(program.params?.__trigAction);
  else if (kind === 'onHeat') t.atLeast = Number(program.params?.__trigHeat) || 50;
  else if (kind === 'onDate') { const ms = Date.parse(program.triggerDetail || ''); if (Number.isFinite(ms)) t.atMs = ms; }
  return t;
}

/** Per-verb params, pulled from program.params by the catalog's field names. */
function verbParams(program) {
  const info = abilityInfo(program.verb);
  const out = {};
  for (const p of info?.params || []) {
    const v = program.params?.[p.f];
    if (v !== undefined && v !== '' && v !== null) out[p.f] = v;
  }
  return out;
}

/**
 * Map a workshop program → an item content entry.
 * @returns {{contentType:string, contentData:object, subject:string, from:string}}
 */
export function programToEntry(program) {
  const p = normalizeProgram(program || defaultProgram());
  const info = abilityInfo(p.verb);
  const fileName = p.disguised ? (p.coverName || 'file') : (p.progName || 'program');
  // A program is a FILE, not mail — the file envelope drops the sender/email chrome
  // (a program has no "From"). A disguised program's cover re-renders as its own type,
  // so this only styles the real/GM view.
  const base = { from: '', subject: fileName, envelope: 'file' };

  if (p.type === 'malware') {
    const isExec = p.verb !== 'plant' && p.verb !== 'adjudicate';
    const isNode = isNodeVerb(p.verb);
    const params = verbParams(p);
    const contentData = {
      name: fileName,
      program: p.progName || '',
      payloadType: p.verb === 'plant' ? 'virus' : String(info?.label || p.verb).toLowerCase(),
      description: p.description || info?.blurb || '',
      threat: Number(p.threat) || 0,
      sizeLabel: '',
      // a network program does nothing until it is inserted into a node: there is nothing to run from the shard
      deployable: !isNode,
      honeypot: !!p.honeypot,
      deployRequire: !!p.gate,
      deploySkill: p.gateSkill || 'Interface',
      deployDV: Number(p.gateDV) || 9,
      iceActorId: p.iceActorId || null,
      deployed: false, deployedBy: null, tripped: false,
      // disguise (payload-parity, additive on malware)
      disguised: !!p.disguised,
      ...(p.disguised ? { disguiseType: p.passes || 'note', coverIcon: p.coverIcon || undefined, coverScan: p.scan || '' } : {}),
      ...(Number(p.detectDV) ? { sniffDV: Number(p.detectDV) } : {}),
      // authored glyph
      ...(p.icon ? { iconClass: p.icon } : {}),
      // a custom routine: the GM's macro, run when it fires
      // (a custom NETWORK routine keeps its macro the same way: the GM reads it from this entry at insert, programSource.js)
      ...((p.verb === 'adjudicate' || p.verb === 'nodeCustom') && p.mode === 'macro' && p.macroId ? { effect: { type: p.verb, macroId: p.macroId } } : {}),
      // uploadable — the whole point of a malware file
      uploadable: true,
      uploadDV: Number(p.uploadDV) || 9,
      uploadSkill: p.uploadSkill || 'Interface',
      uploadTraceOnFail: !!p.decoy,
      ...(Number(p.detectDV) > 0 ? { uploadStealthDV: Number(p.detectDV) } : {}),
      // the verb decides what a push does; only a PLANT has none (it leaves the file itself)
      ...(p.verb !== 'plant' ? { uploadEffect: p.verb } : {}),
      ...(Object.keys(params).length ? { uploadParams: params } : {}),
      ...((isExec && !isNode) || p.verb === 'adjudicate' ? { uploadTrigger: buildUploadTrigger(p) } : {}),
    };
    return { ...base, contentType: CONTENT_TYPES.MALWARE, contentData };
  }

  // payload
  const contentData = {
    name: fileName,
    program: p.progName || '',
    description: p.description || info?.blurb || '',
    effect: { type: p.verb, duration: 0, ...(p.mode === 'macro' && p.macroId ? { macroId: p.macroId } : {}), ...(Object.keys(verbParams(p)).length ? { params: verbParams(p) } : {}) },
    requirements: [],
    executeRequire: !!p.gate,
    executeSkill: p.gateSkill || 'Interface',
    executeDV: Number(p.gateDV) || 9,
    traceOnFail: !!p.decoy,
    disguised: !!p.disguised,
    ...(p.disguised ? { disguiseType: p.passes || 'note', coverIcon: p.coverIcon || undefined, coverScan: p.scan || '' } : {}),
    ...(Number(p.detectDV) ? { sniffDV: Number(p.detectDV) } : {}),
    ...(Number(p.uses) > 0 ? { charges: Number(p.uses) } : {}),
    threat: Number(p.threat) || 0,
    ...(p.icon ? { iconClass: p.icon } : {}),
    output: [],
    // carryable/uploadable: pushing a payload onto a terminal RUNS it there (TerminalViewerApp._gatherCarriedPrograms).
    uploadable: true,
    uploadDV: Number(p.uploadDV) || 9,
    uploadSkill: p.uploadSkill || 'Interface',
    uploadTraceOnFail: !!p.decoy,
    ...(Number(p.detectDV) > 0 ? { uploadStealthDV: Number(p.detectDV) } : {}),
  };
  return { ...base, contentType: CONTENT_TYPES.PAYLOAD, contentData };
}

/**
 * Reverse: an item content entry → a workshop program (edit / load-from-library).
 * @param {{contentType?:string, contentData?:object, subject?:string}} entry
 */
export function entryToProgram(entry) {
  const cd = entry?.contentData || {};
  const isMal = entry?.contentType === CONTENT_TYPES.MALWARE;
  const prog = defaultProgram(isMal ? 'malware' : 'payload');

  if (isMal) {
    // a custom routine saved before 2.1 had no uploadEffect: its payloadType still says it was one
    prog.verb = cd.uploadEffect || (cd.payloadType === 'program' ? 'adjudicate' : 'plant');
    prog.mode = cd.effect?.macroId ? 'macro' : 'text';
    prog.macroId = cd.effect?.macroId || '';
    for (const pf of abilityInfo(prog.verb)?.params || []) {
      if (cd.uploadParams?.[pf.f] !== undefined) prog.params[pf.f] = cd.uploadParams[pf.f];
    }
    prog.honeypot = !!cd.honeypot;
    prog.iceActorId = cd.iceActorId || '';
    prog.gate = !!cd.deployRequire;
    prog.gateSkill = cd.deploySkill || 'Interface';
    prog.gateDV = Number(cd.deployDV) || 9;
    prog.decoy = !!cd.uploadTraceOnFail;
    prog.trigger = cd.uploadTrigger?.kind || 'onLogin';
    if (cd.uploadTrigger?.action) prog.params.__trigAction = triggerAction(cd.uploadTrigger.action);
    if (cd.uploadTrigger?.atLeast) prog.params.__trigHeat = cd.uploadTrigger.atLeast;
    if (cd.uploadTrigger?.atMs) prog.triggerDetail = new Date(cd.uploadTrigger.atMs).toISOString();
  } else {
    prog.verb = cd.effect?.type || 'adjudicate';
    prog.gate = !!cd.executeRequire;
    prog.gateSkill = cd.executeSkill || 'Interface';
    prog.gateDV = Number(cd.executeDV) || 9;
    prog.decoy = !!cd.traceOnFail;
    prog.uses = Number(cd.charges) || 0;
    prog.mode = cd.effect?.macroId ? 'macro' : 'text';
    prog.macroId = cd.effect?.macroId || '';
    // gather any stored verb params
    for (const pf of abilityInfo(prog.verb)?.params || []) {
      const v = cd.effect?.params?.[pf.f] ?? cd[pf.f];
      if (v !== undefined) prog.params[pf.f] = v;
    }
  }
  prog.uploadDV = Number(cd.uploadDV) || 9;
  prog.uploadSkill = cd.uploadSkill || 'Interface';

  prog.progName = cd.program || cd.name || prog.progName;
  prog.icon = cd.iconClass || prog.icon;
  prog.threat = Number(cd.threat) || prog.threat;
  prog.detectDV = Number(cd.sniffDV) || prog.detectDV;
  // programToEntry falls back to the verb's blurb; that is not something the GM wrote
  prog.description = cd.description && cd.description !== abilityInfo(prog.verb)?.blurb ? cd.description : '';
  prog.disguised = !!cd.disguised;
  if (cd.coverScan) prog.scan = cd.coverScan;
  if (cd.disguised) {
    prog.coverName = cd.name || prog.coverName;
    prog.passes = cd.disguiseType || 'note';
    prog.coverIcon = cd.coverIcon || prog.coverIcon;
  }
  return prog;
}

/** A one-line "what it does" sentence for readouts. */
export function programSentence(program) {
  const p = program || {};
  const info = abilityInfo(p.verb);
  const blurb = info?.blurb || 'runs a routine you describe';
  // a network program has no terminal trigger (this used to fall into the branch below and read "on login")
  if (isNodeVerb(p.verb)) return { blurb, tail: ', once it is inserted into a network node' };
  if (p.type === 'malware' && p.verb !== 'plant' && p.verb !== 'adjudicate') {
    const t = TRIGGERS[p.trigger] || TRIGGERS.onLogin;
    return { blurb, tail: `, ${t[1]}` };
  }
  if (p.verb === 'plant') return { blurb: 'leaves a forged file for whoever looks next', tail: '' };
  return { blurb, tail: ', the moment someone runs it' };
}
