/**
 * Contact vocabulary — the role table, relationship types and trust labels the
 * GM contact tools and the integration API share.
 * @file scripts/utils/contactVocab.js
 * @module night-city-messenger
 *
 * These lived in the GM Contact Manager window's script until that window was
 * folded into Admin → Contacts (2026-10-27). IntegrationBridge re-exports
 * RELATIONSHIP_TYPES and TRUST_LABELS on the module API, so they keep their
 * shape exactly.
 */

/** Built-in contact roles (the GM's role table; RoleManagerDialog mirrors it). Icons are bare FA names. */
export const BUILT_IN_ROLES = {
  fixer:      { label: 'Fixer',      icon: 'crosshairs',       color: '#d4a017' },
  netrunner:  { label: 'Netrunner',  icon: 'terminal',         color: '#00e5ff' },
  corp:       { label: 'Corp',       icon: 'briefcase',        color: '#4a8ab5' },
  exec:       { label: 'Exec',       icon: 'building-columns', color: '#6ec1e4' },
  solo:       { label: 'Solo',       icon: 'crosshairs',       color: '#e04848' },
  tech:       { label: 'Tech',       icon: 'gear',             color: '#2ecc71' },
  medtech:    { label: 'Medtech',    icon: 'staff-snake',      color: '#1abc9c' },
  ripperdoc:  { label: 'Ripperdoc',  icon: 'syringe',          color: '#e06888' },
  media:      { label: 'Media',      icon: 'podcast',          color: '#b87aff' },
  nomad:      { label: 'Nomad',      icon: 'truck-monster',    color: '#d4844a' },
  lawman:     { label: 'Lawman',     icon: 'shield-halved',    color: '#6b8fa3' },
  rockerboy:  { label: 'Rockerboy',  icon: 'guitar',           color: '#e05cb5' },
  gang:       { label: 'Gang',       icon: 'users-line',       color: '#cc4444' },
  civilian:   { label: 'Civilian',   icon: 'person',             color: '#8888a0' },
  government: { label: 'Gov',        icon: 'landmark',         color: '#5a7fa5' },
  ai:         { label: 'A.I.',       icon: 'microchip',        color: '#ff44cc' },
};

export const RELATIONSHIP_TYPES = {
  ally:       { label: 'ALLY',       icon: 'fa-handshake',            color: '#00ff41' },
  hostile:    { label: 'HOSTILE',    icon: 'fa-skull-crossbones',     color: '#ff0033' },
  rival:      { label: 'RIVAL',     icon: 'fa-bolt',                 color: '#b87aff' },
  neutral:    { label: 'NEUTRAL',   icon: 'fa-minus',                color: '#555570' },
  contact:    { label: 'CONTACT',   icon: 'fa-address-card',         color: '#7aa2c4' },
  'owes-you': { label: 'OWES YOU',  icon: 'fa-coins',                color: '#f7c948' },
  'you-owe':  { label: 'YOU OWE',   icon: 'fa-hand-holding-dollar',  color: '#d4844a' },
  patron:     { label: 'PATRON',    icon: 'fa-crown',                color: '#6ec1e4' },
  informant:  { label: 'INFORMANT', icon: 'fa-user-secret',          color: '#1abc9c' },
};

export const TRUST_LABELS = {
  0: 'UNKNOWN', 1: 'SUSPICIOUS', 2: 'CAUTIOUS',
  3: 'NEUTRAL', 4: 'TRUSTED', 5: 'IMPLICITLY TRUSTED',
};
