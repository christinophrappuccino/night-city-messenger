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
 *  - malware → a plain PLANT + the three uploadable EXECUTE verbs + Custom.
 * @returns {Array<{key,label,icon,blurb,group,modes,host,params}>}
 */
export function abilitiesFor(type) {
  if (type === 'malware') {
    const execs = programEffectOptions({ mode: 'triggered', host: 'terminal', exclude: ['plant', 'logicBomb', 'adjudicate'] });
    return [PLANT_ABILITY, ...execs, { key: 'adjudicate', ...PROGRAM_EFFECTS.adjudicate, params: PROGRAM_EFFECTS.adjudicate.params || [] }];
  }
  return programEffectOptions({ mode: 'instant' });
}

/** Info for a workshop verb (handles the synthetic 'plant'). */
export function abilityInfo(verb) {
  if (verb === 'plant') return PLANT_ABILITY;
  return programEffectInfo(verb);
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
    gate: false, gateSkill: 'Interface', gateDV: 15,   // run/deploy gate
    mode: 'text', description: '', macroId: '',        // custom: describe vs macro
    params: {},                           // per-verb params by field name
  };
}

/**
 * The resident trigger a program installs when uploaded. The KIND is always honored
 * (onLogin/onDate/onAction/onHeat); onAction/onHeat carry their detail from the
 * workshop's trigger sub-fields. onDate needs a real timestamp the workshop can't yet
 * author (free text), so it's left for the reaper to skip until a date picker lands.
 */
function buildUploadTrigger(program) {
  const kind = program.trigger || 'onLogin';
  const t = { kind };
  if (kind === 'onAction' && program.params?.__trigAction) t.action = program.params.__trigAction;
  else if (kind === 'onHeat') t.atLeast = Number(program.params?.__trigHeat) || 50;
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
  const p = program || defaultProgram();
  const info = abilityInfo(p.verb);
  const fileName = p.disguised ? (p.coverName || 'file') : (p.progName || 'program');
  // A program is a FILE, not mail — the file envelope drops the sender/email chrome
  // (a program has no "From"). A disguised program's cover re-renders as its own type,
  // so this only styles the real/GM view.
  const base = { from: '', subject: fileName, envelope: 'file' };

  if (p.type === 'malware') {
    const isExec = p.verb !== 'plant' && p.verb !== 'adjudicate';
    const contentData = {
      name: fileName,
      payloadType: p.verb === 'plant' ? 'virus' : String(info?.label || p.verb).toLowerCase(),
      description: p.description || info?.blurb || '',
      threat: Number(p.threat) || 0,
      sizeLabel: '',
      deployable: true,
      honeypot: !!p.honeypot,
      deployRequire: !!p.gate,
      deploySkill: p.gateSkill || 'Interface',
      deployDV: Number(p.gateDV) || 15,
      iceActorId: p.iceActorId || null,
      deployed: false, deployedBy: null, tripped: false,
      // disguise (payload-parity, additive on malware)
      disguised: !!p.disguised,
      ...(p.disguised ? { disguiseType: p.passes || 'note', coverIcon: p.coverIcon || undefined } : {}),
      ...(Number(p.detectDV) ? { sniffDV: Number(p.detectDV) } : {}),
      // authored glyph
      ...(p.icon ? { iconClass: p.icon } : {}),
      // uploadable — the whole point of a malware file
      uploadable: true,
      uploadDV: Number(p.gateDV) || 15,
      uploadSkill: p.gateSkill || 'Interface',
      uploadTraceOnFail: !!p.decoy,
      ...(Number(p.detectDV) > 0 ? { uploadStealthDV: Number(p.detectDV) } : {}),
      ...(isExec ? { uploadEffect: p.verb } : {}),
      ...(isExec && p.trigger ? { uploadTrigger: buildUploadTrigger(p) } : {}),
    };
    return { ...base, contentType: CONTENT_TYPES.MALWARE, contentData };
  }

  // payload
  const contentData = {
    name: fileName,
    program: p.progName || '',
    description: p.description || info?.blurb || '',
    effect: { type: p.verb, duration: 0, ...(p.mode === 'macro' && p.macroId ? { macroId: p.macroId } : {}) },
    requirements: [],
    executeRequire: !!p.gate,
    executeSkill: p.gateSkill || 'Interface',
    executeDV: Number(p.gateDV) || 15,
    traceOnFail: !!p.decoy,
    disguised: !!p.disguised,
    ...(p.disguised ? { disguiseType: p.passes || 'note', coverIcon: p.coverIcon || undefined } : {}),
    ...(Number(p.detectDV) ? { sniffDV: Number(p.detectDV) } : {}),
    ...(Number(p.uses) > 0 ? { charges: Number(p.uses) } : {}),
    threat: Number(p.threat) || 0,
    ...(p.icon ? { iconClass: p.icon } : {}),
    output: [],
    ...verbParams(p),
    // carryable/uploadable so it's detected by the terminal upload flow
    // (a payload has no uploadEffect → it uploads as a PLANT / forged file).
    uploadable: true,
    uploadDV: Number(p.gateDV) || 15,
    uploadSkill: p.gateSkill || 'Interface',
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
    prog.verb = cd.uploadEffect || 'plant';
    prog.honeypot = !!cd.honeypot;
    prog.iceActorId = cd.iceActorId || '';
    prog.gate = !!cd.deployRequire;
    prog.gateSkill = cd.deploySkill || 'Interface';
    prog.gateDV = Number(cd.deployDV) || 15;
    prog.decoy = !!cd.uploadTraceOnFail;
    prog.trigger = cd.uploadTrigger?.kind || 'onLogin';
  } else {
    prog.verb = cd.effect?.type || 'adjudicate';
    prog.gate = !!cd.executeRequire;
    prog.gateSkill = cd.executeSkill || 'Interface';
    prog.gateDV = Number(cd.executeDV) || 15;
    prog.decoy = !!cd.traceOnFail;
    prog.uses = Number(cd.charges) || 0;
    prog.mode = cd.effect?.macroId ? 'macro' : 'text';
    prog.macroId = cd.effect?.macroId || '';
    // gather any stored verb params
    for (const pf of abilityInfo(prog.verb)?.params || []) {
      if (cd[pf.f] !== undefined) prog.params[pf.f] = cd[pf.f];
    }
  }

  prog.progName = cd.program || cd.name || prog.progName;
  prog.icon = cd.iconClass || prog.icon;
  prog.threat = Number(cd.threat) || prog.threat;
  prog.detectDV = Number(cd.sniffDV) || prog.detectDV;
  prog.description = cd.description || '';
  prog.disguised = !!cd.disguised;
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
  if (p.type === 'malware' && p.verb !== 'plant' && p.verb !== 'adjudicate') {
    const t = TRIGGERS[p.trigger] || TRIGGERS.onLogin;
    return { blurb, tail: `, ${t[1]}` };
  }
  if (p.verb === 'plant') return { blurb: 'leaves a forged file for whoever looks next', tail: '' };
  return { blurb, tail: ', the moment someone runs it' };
}
