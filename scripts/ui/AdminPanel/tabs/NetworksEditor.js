/**
 * NetworksEditor — the network editor that used to be the standalone Network
 * Manager, folded into Admin → Networks (2026-10-27 redesign).
 * @file scripts/ui/AdminPanel/tabs/NetworksEditor.js
 * @module night-city-messenger
 *
 * Pure apart from `readEditorForm`, which only reads the element it is handed.
 * No Foundry globals here, so dev/tools/sims/test-admin-networks.mjs drives it
 * directly.
 *
 * The SAVE CONTRACT is `readEditorForm(root)` → the same `networkData` shape
 * the retired standalone Network Manager's save built (it goes straight into
 * NetworkService.createNetwork / updateNetwork), plus `where` = the scene ids
 * the network should be on (written to each scene's `networkAvailability`
 * flag, the Scenes tab's path). Every field the old editor could set has a
 * named control here — the sim asserts the list.
 */

import { bypassFieldsFrom, readBypassRows } from '../../../utils/bypassSkills.js';

/** The six editor steps, in order. */
export const NET2_STEPS = [
  { key: 'identity', icon: 'fa-id-card', label: 'Identity' },
  { key: 'signal', icon: 'fa-signal', label: 'Signal' },
  { key: 'access', icon: 'fa-lock', label: 'Access' },
  { key: 'behaviour', icon: 'fa-sliders', label: 'Behaviour' },
  { key: 'where', icon: 'fa-location-dot', label: 'Where' },
  { key: 'look', icon: 'fa-palette', label: 'Look' },
];

export const NET2_ICONS = [
  'fa-wifi', 'fa-building', 'fa-mask', 'fa-landmark', 'fa-shield-halved', 'fa-database',
  'fa-skull', 'fa-tower-broadcast', 'fa-satellite-dish', 'fa-crosshairs', 'fa-server',
  'fa-microchip', 'fa-globe', 'fa-signal', 'fa-lock', 'fa-eye', 'fa-skull-crossbones',
  'fa-robot', 'fa-handshake', 'fa-radiation', 'fa-truck-medical', 'fa-handcuffs',
];

export const NET2_COLORS = ['#4488ff', '#19f3f7', '#00ff41', '#f7c948', '#ff6600', '#ff3355', '#c76bff', '#d4a35c', '#F65261', '#8888a0'];

/** Every field the editor writes — the sim checks each has a control. */
export const NET2_FIELDS = [
  'name', 'type', 'description', 'lore', 'group',
  'signalStrength', 'reliability', 'messageDelay',
  'requiresAuth', 'securityLevel', 'authLogic', 'maxAttempts', 'lockoutMinutes',
  'allowPassword', 'password', 'allowSkillCheck', 'allowKeyItem', 'keyItemName', 'keyItemTag', 'keyItemImg', 'keyItemConsume',
  'failureMode', 'encryptionType', 'iceSource', 'iceActorId', 'iceCustomName', 'iceCustomDamage', 'iceCustomPortrait',
  'traced', 'anonymity', 'canRoute', 'restrictedAccess',
  'globalAvailability',
  'iconMode', 'themeIcon', 'themeColor', 'customImage', 'glitchIntensity',
];

/** "Start from" — blank or a type preset (replaces the old quick-create buttons and preset pills). */
export const NET2_PRESETS = {
  blank:       { label: 'Blank', icon: 'fa-file', color: '#8888a0',
    data: { type: 'CUSTOM', description: '', signalStrength: 75, reliability: 85, effects: { messageDelay: 0, traced: false, anonymity: false }, theme: { icon: 'fa-wifi', color: '#19f3f7' }, security: { requiresAuth: false } } },
  corporate:   { label: 'Corporate', icon: 'fa-building', color: '#4488ff',
    data: { type: 'CORPORATE', description: 'Corporate internal network.', signalStrength: 90, reliability: 95, effects: { messageDelay: 200, traced: true, anonymity: false }, theme: { icon: 'fa-building', color: '#4488ff' }, security: { requiresAuth: true, level: 'HIGH', allowPassword: true, allowSkillCheck: true } } },
  public:      { label: 'Public', icon: 'fa-wifi', color: '#19f3f7',
    data: { type: 'PUBLIC', description: 'Public network — anyone in range connects.', signalStrength: 75, reliability: 85, effects: { messageDelay: 300, traced: false, anonymity: false }, theme: { icon: 'fa-wifi', color: '#19f3f7' }, security: { requiresAuth: false, level: 'LOW' } } },
  underground: { label: 'Underground', icon: 'fa-mask', color: '#00ff41',
    data: { type: 'UNDERGROUND', description: 'Off-grid mesh. Unstable, untraceable.', signalStrength: 45, reliability: 50, effects: { messageDelay: 800, traced: false, anonymity: true }, theme: { icon: 'fa-mask', color: '#00ff41' }, security: { requiresAuth: false } } },
  government:  { label: 'Government', icon: 'fa-landmark', color: '#ff6600',
    data: { type: 'GOVERNMENT', description: 'Hardened facility network. Maximum security.', signalStrength: 95, reliability: 99, effects: { messageDelay: 100, traced: true, anonymity: false }, theme: { icon: 'fa-landmark', color: '#ff6600' }, security: { requiresAuth: true, level: 'MAXIMUM', allowPassword: true, allowSkillCheck: true, failureMode: 'damage', encryptionType: 'BLACK_ICE' } } },
  fixer:       { label: 'Fixer den', icon: 'fa-handshake', color: '#F65261',
    data: { type: 'UNDERGROUND', description: 'Underground fixer network. Low profile.', signalStrength: 65, reliability: 70, effects: { messageDelay: 500, traced: false, anonymity: true }, theme: { icon: 'fa-handshake', color: '#F65261' }, security: { requiresAuth: true, allowPassword: true } } },
  gang:        { label: 'Gang turf', icon: 'fa-skull', color: '#ff3355',
    data: { type: 'UNDERGROUND', description: 'Gang-controlled local mesh. Unstable.', signalStrength: 45, reliability: 50, effects: { messageDelay: 800, traced: false, anonymity: true }, theme: { icon: 'fa-skull', color: '#ff3355' }, security: { requiresAuth: false } } },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base?.[k]) ? deepMerge(base[k], v) : (isObj(v) ? deepMerge({}, v) : v);
  return out;
}

/** A network with every field present (the NetworkService._buildNetworkObject defaults). */
export function blankNetwork() {
  return {
    id: '', name: '', type: 'CUSTOM', isCore: false,
    availability: { global: false, scenes: [] },
    signalStrength: 75, reliability: 85,
    security: {
      level: 'NONE', requiresAuth: false, password: '', allowPassword: false, allowSkillCheck: false, authLogic: 'any',
      bypassSkills: [], bypassDC: 15, bypassSkillDCs: {},
      allowKeyItem: false, keyItemName: '', keyItemTag: '', keyItemImg: '', keyItemConsume: false,
      maxAttempts: 3, lockoutDuration: 3600000, encryptionType: 'ICE', failureMode: 'lockout',
      ice: { source: 'default', actorId: null, customName: '', customPortrait: '', customDamage: '' },
    },
    effects: { messageDelay: 0, traced: false, anonymity: false, canRoute: true, restrictedAccess: false, allowedRecipientNetworks: [] },
    theme: { color: '#19f3f7', icon: 'fa-wifi', iconMode: 'fa', customImage: '', glitchIntensity: 0.1 },
    description: '', lore: '', group: '',
  };
}

/** A draft from a stored network: every field filled, plus `where` (scene ids). */
export function draftFrom(net, where = []) {
  return { ...deepMerge(blankNetwork(), net || {}), where: [...new Set(where)] };
}

/** Lay a preset over a draft. The name the GM already typed survives. */
export function applyPreset(draft, key) {
  const p = NET2_PRESETS[key];
  if (!p) return draft;
  const next = deepMerge(draft, p.data);
  next.name = draft.name;
  next.where = draft.where || [];
  return next;
}

// ─── Reading the form ───

const numOr = (raw, def) => {
  const s = String(raw ?? '').trim();
  if (s === '') return def;
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Read the editor back into the networkData NetworkService takes.
 * @param {HTMLElement} root — the `.ncm-net2-form` element
 * @param {{recipients?: string[]}} [extra] — scope-picker values that are not inputs
 * @returns {object} networkData + `where` (scene ids)
 */
export function readEditorForm(root, extra = {}) {
  const q = (n) => root.querySelector(`[name="${n}"]`);
  const val = (n) => String(q(n)?.value ?? '').trim();
  const chk = (n) => !!q(n)?.checked;
  const rows = readBypassRows(root);
  const bypass = rows ? bypassFieldsFrom(rows, 15) : { bypassSkills: [], bypassDC: 15, bypassSkillDCs: {} };
  const where = [...root.querySelectorAll('[data-where-scene]')].filter((cb) => cb.checked).map((cb) => cb.dataset.whereScene);
  return {
    name: val('name'),
    type: val('type') || 'CUSTOM',
    availability: { global: chk('globalAvailability'), scenes: [] },
    signalStrength: clamp(Math.round(numOr(val('signalStrength'), 75)), 0, 100),
    reliability: clamp(Math.round(numOr(val('reliability'), 85)), 0, 100),
    security: {
      level: val('securityLevel') || 'NONE',
      requiresAuth: val('requiresAuth') === 'true',
      password: val('password'),
      allowPassword: chk('allowPassword'),
      allowSkillCheck: chk('allowSkillCheck'),
      authLogic: val('authLogic') === 'all' ? 'all' : 'any',
      ...bypass,
      allowKeyItem: chk('allowKeyItem'),
      keyItemName: val('keyItemName'),
      keyItemTag: val('keyItemTag'),
      keyItemImg: val('keyItemImg'),
      keyItemConsume: chk('keyItemConsume'),
      maxAttempts: Math.max(1, Math.round(numOr(val('maxAttempts'), 3))),
      lockoutDuration: Math.max(1, numOr(val('lockoutMinutes'), 60)) * 60000,
      encryptionType: val('encryptionType') || 'ICE',
      failureMode: val('failureMode') || 'lockout',
      ice: {
        source: val('iceSource') || 'default',
        actorId: val('iceActorId') || null,
        customName: val('iceCustomName'),
        customPortrait: val('iceCustomPortrait'),
        customDamage: val('iceCustomDamage'),
      },
    },
    effects: {
      messageDelay: Math.max(0, Math.round(numOr(val('messageDelay'), 0))),
      traced: chk('traced'),
      anonymity: chk('anonymity'),
      canRoute: chk('canRoute'),
      restrictedAccess: chk('restrictedAccess'),
      allowedRecipientNetworks: [...(extra.recipients || [])],
    },
    theme: {
      color: /^#[0-9a-f]{6}$/i.test(val('themeColor')) ? val('themeColor') : '#19f3f7',
      icon: val('themeIcon') || 'fa-wifi',
      iconMode: val('iconMode') === 'image' ? 'image' : 'fa',
      customImage: val('customImage'),
      glitchIntensity: clamp(numOr(val('glitchIntensity'), 0.1), 0, 1),
    },
    description: val('description'),
    lore: val('lore'),
    group: val('group'),
    where,
  };
}

/** Scene availability writes for one network: `[{sceneId, patch}]`, only the scenes that change. */
export function wherePatches(network, wantIds, scenes) {
  const want = new Set(wantIds || []);
  const out = [];
  for (const s of scenes || []) {
    const avail = s.avail || {};
    const has = !!avail[network.id] || (!!network.name && !!avail[network.name]) || (network.availability?.scenes || []).includes(s.id);
    const should = want.has(s.id);
    if (has === should) continue;
    const patch = { [network.id]: should };
    if (!should && network.name && avail[network.name]) patch[network.name] = false;
    out.push({ sceneId: s.id, patch });
  }
  return out;
}

// ─── The template's view of a draft ───

const typeLabel = (t) => { const s = String(t || 'custom').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

/**
 * @param {object} draft — from draftFrom()/readEditorForm()
 * @param {object} o — { isNew, step, presetKey, types:[value], scenes:[{id,name}], iceActors:[{id,name,atk}], groups:[name], bypassHtml, recipientPicker }
 */
export function editorContext(draft, o = {}) {
  const d = draft || draftFrom(null);
  const sec = d.security || {};
  const stepKey = NET2_STEPS.some((s) => s.key === o.step) ? o.step : 'identity';
  const idx = NET2_STEPS.findIndex((s) => s.key === stepKey);
  const lethal = sec.encryptionType === 'BLACK_ICE' || sec.encryptionType === 'RED_ICE';
  const where = new Set(d.where || []);
  const seg = (cur, opts) => opts.map(([value, label]) => ({ value, label, on: String(cur) === String(value) }));
  return {
    isNew: !!o.isNew,
    isCore: !!d.isCore,
    id: d.id || '',
    step: stepKey,
    stepNum: idx + 1,
    stepTotal: NET2_STEPS.length,
    stepLabel: NET2_STEPS[idx].label,
    steps: NET2_STEPS.map((s) => ({ ...s, on: s.key === stepKey })),
    presets: o.isNew ? Object.entries(NET2_PRESETS).map(([key, p]) => ({ key, label: p.label, icon: p.icon, color: p.color, on: key === o.presetKey })) : [],
    d,
    typeOptions: [...new Set([...(o.types || []), d.type].filter(Boolean))].map((v) => ({ value: v, label: typeLabel(v), on: v === d.type })),
    levelOptions: ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'MAXIMUM'].map((v) => ({ value: v, label: typeLabel(v), on: v === (sec.level || 'NONE') })),
    groups: o.groups || [],
    authSeg: seg(String(!!sec.requiresAuth), [['false', 'Open'], ['true', 'Secured']]),
    logicSeg: seg(sec.authLogic === 'all' ? 'all' : 'any', [['any', 'Any one method'], ['all', 'All of them']]),
    failSeg: seg(sec.failureMode || 'lockout', [['lockout', 'Lock out'], ['permanent', 'Lock out for good'], ['damage', 'Black ICE'], ['nothing', 'Nothing']]),
    iceSeg: seg(sec.ice?.source || 'default', [['default', 'Standard dice'], ['custom', 'My own'], ['actor', 'An ICE actor']]),
    iconSeg: seg(d.theme?.iconMode === 'image' ? 'image' : 'fa', [['fa', 'Symbol'], ['image', 'Image']]),
    encOptions: [['ICE', 'Standard ICE'], ['BLACK_ICE', 'Black ICE'], ['RED_ICE', 'Red ICE']].map(([v, l]) => ({ value: v, label: l, on: v === (sec.encryptionType || 'ICE') })),
    isLethal: lethal,
    isDamage: sec.failureMode === 'damage',
    isOpen: !sec.requiresAuth,
    // A short list (only actors that ARE Black ICE) — a <select> is right here (CLAUDE.md picker rule).
    iceChoices: (o.iceActors || []).map((a) => ({ ...a, on: a.id === sec.ice?.actorId })),
    lockoutMinutes: Math.round((sec.lockoutDuration ?? 3600000) / 60000),
    hasKeyItem: !!sec.keyItemName,
    bypassHtml: o.bypassHtml || '',
    recipientPicker: o.recipientPicker || '',
    icons: [...new Set([...(d.theme?.icon ? [d.theme.icon] : []), ...NET2_ICONS])].map((ic) => ({ ic, on: ic === d.theme?.icon })),
    colors: NET2_COLORS.map((c) => ({ c, on: c.toLowerCase() === String(d.theme?.color || '').toLowerCase() })),
    isImage: d.theme?.iconMode === 'image',
    glitch: d.theme?.glitchIntensity ?? 0.1,
    glitchPct: Math.round((d.theme?.glitchIntensity ?? 0.1) * 100),
    scenes: (o.scenes || []).map((s) => ({ ...s, on: where.has(s.id) })),
    whereCount: where.size,
  };
}
