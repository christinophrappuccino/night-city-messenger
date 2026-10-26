/**
 * Shard Encoder — the player-facing shard / program authoring window.
 * @file scripts/ui/ShardEncoder/ShardEncoderApp.js
 * @module night-city-messenger
 * @description Ported from the dev-approved mock (dev/mockups/shard-encoder-fui-mock.html).
 *   Hosted in the Malware Workshop frame (the app root carries `ncm-malware-workshop`, so the
 *   Workshop's rails / stage / core / chips ARE the real rules); only `.ncm-enc-*` is new CSS.
 *
 *   BUILD STATE (2026-09-21 — steps 1-3 of the agreed order): the live stages are
 *   BLANK -> PROGRAM -> ENCODE. The Content stage (the composer in player mode), the Lock
 *   stage (the ceiling table) and the Market card are later steps; they are deliberately
 *   ABSENT rather than rendered dead. `STAGES` is the ONE list the spine, the footer count
 *   and the navigation read, so a new stage slots in by adding a row + a `_stage<Key>()`.
 *
 *   Render model: the PART is a bare root; `_mount()` builds the chamber once and every
 *   interaction PATCHES the DOM (never `this.render()`), so the core, the canvas, focus and
 *   scroll survive — which is also what lets the stage transition animate on live nodes.
 *
 *   Rules live in EncoderModel.js (pure, sim-tested). Accessibility lives in
 *   utils/legibility.js — per player: text size, contrast, motion, density, outlines, plain
 *   font, details-open — opened from the footer's DISPLAY button and applied live.
 *
 *   Writes: the player owns the blank item, but a shard's journal is GM-owned, so the
 *   conversion + first entry ride the existing SHARD_CONVERT_REQUEST relay. That needs a GM
 *   online, and it is checked BEFORE the roll — never after something irreversible.
 */

import { MODULE_ID, TEMPLATES, SOCKET_OPS, ENCRYPTION_TYPES, FAILURE_MODES, SHARD_PRESETS } from '../../utils/constants.js';
import { log, isGM, resolveOperator, getOperatorActors, openOperatorPicker, canEncode, canEditShard, whisperCardHtml, getPlayerCharacters } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { COVER_TYPES, abilityInfo, programToEntry } from '../content/ProgramModel.js';
import { CONTENT_TYPE_INFO, enrichContent } from '../content/ContentRenderers.js';
import { showNamePicker, documentEntries, isCarrier } from '../../utils/namePicker.js';
import {
  PROGRAM_FAMILIES, PROGRAM_TYPES, TIER_PERKS, SLOPPY_BAND, resolveEncoderConfig, tierForItem, botchFor, capacityOf,
  ladderOdds, likelyRung, oddsClass, programAbilities, craftChoices, programDV, programEfficiency,
  gearBonusFor, assistBonusFor, timeCostFor, formatMinutes,
  programForecast, contentChoices, contentDV, contentStackDV, contentEfficiency, contentForecast, typeRows, encodeOutcome,
  lockOptions, lockIsSet, LOCK_FAILURES, isEligibleBlank, blankRuleRefusal,
} from '../content/EncoderModel.js';
import { withShardPrefix } from '../../utils/shardNaming.js';
import { playerConfirm } from '../../utils/adminTheme.js';
import { shardTerm as T, withArticle } from '../../utils/shardTerm.js';
import {
  LEGIBILITY_RANGES, LEGIBILITY_PRESETS, getLegibility, setLegibility, applyLegibility, effectiveMotion,
} from '../../utils/legibility.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shortSk = (s) => String(s).replace('Electronics/Security Tech', 'Elec/Sec Tech');
const GLYPHS = '01ABCDEF◈×#$%&/<>[]{}';
const HEXC = '0123456789ABCDEF·×◈{}[]<>/;:';
const CELLS = 100;
/** Item types that are sheet abstractions, never a physical blank (the burn-picker rule). */
const NON_CARRIER = ['skill', 'role', 'criticalInjury', 'netarch'];

/**
 * A shard is a chip, so it should look like the system's chip. These are the
 * Cyberpunk RED compendium gear icons — the same art the system's own gear
 * uses, so a player-made shard sits in an inventory without looking imported.
 * The first is the default; the rest are one-click alternatives, and the
 * FilePicker takes anything.
 */
const GEAR_ART = 'systems/cyberpunk-red-core/icons/compendium/gear/';

/**
 * The two-colour palette a player mixes a custom look from. Accents are the CT
 * palette the rest of the module already speaks; grounds are deliberately all
 * DARK — a shard is a screen, and a pale ground makes the derived text tokens
 * unreadable without the eleven-key grid to repair them.
 */
const ENC_LOOK_SWATCHES = Object.freeze({
  secondary: ['#19f3f7', '#00ff41', '#f7c948', '#F65261', '#e070ff', '#60b0ff', '#ff8a3d', '#c0c8d8'],
  bgDeep: ['#0a0a0f', '#0a0606', '#080a08', '#0c080f', '#08090f', '#0f0c08', '#0c0c0c', '#0a080c'],
});
const SHARD_ART = [
  ['memory_chip.svg', 'Chip'],
  ['computer.svg', 'Computer'],
  ['agent.svg', 'Agent'],
  ['tech_tool.svg', 'Tech tool'],
  ['disposable_cellphone.svg', 'Burner'],
  ['braindance_viewer.svg', 'Braindance'],
];
const DEFAULT_SHARD_IMG = GEAR_ART + SHARD_ART[0][0];

/**
 * The boot choreographies `ItemInboxApp` implements (its `_bootAnimations` map).
 * Offering one it cannot play would be a dead option, so this list mirrors that
 * map — if a style is added there, add it here.
 */
const BOOT_STYLES = [
  ['standard-fade', 'Fade in'],
  ['holographic-snap', 'Holo snap'],
  ['scan-sweep', 'Scan sweep'],
  ['glitch-stutter', 'Glitch'],
  ['neon-breathe', 'Neon breathe'],
  ['warm-dissolve', 'Warm dissolve'],
  ['camera-flash', 'Camera flash'],
  ['authority-stamp', 'Authority stamp'],
  ['instant-dump', 'No frills'],
];
const BOOT_SPEEDS = [['fast', 'Fast'], ['normal', 'Normal'], ['dramatic', 'Dramatic']];

/**
 * The live stages, in order. The middle one is a BRANCH: the same slot is either
 * CONTENT (forge a file) or PROGRAM (build a tool), decided by `S.mode` — the
 * design's "② CONTENT / ② PROGRAM". The Lock stage slots in before 'encode'.
 */
const STAGES = [
  { key: 'blank', title: 'Blank', sub: "what it's on" },
  { key: 'build', title: { content: 'Content', program: 'Program' }, sub: { content: 'what goes on it', program: "build, don't write" } },
  { key: 'lock', title: 'Lock', sub: 'optional', optional: true },
  { key: 'encode', title: 'Encode', sub: 'the roll' },
];
const stageText = (row, field, mode) => (typeof row[field] === 'string' ? row[field] : row[field][mode]);

export class ShardEncoderApp extends BaseApplication {

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-shard-encoder',
    classes: ['ncm-app', 'ncm-malware-workshop', 'ncm-shard-encoder'],
    window: { title: 'Encoder', icon: 'fas fa-microchip', resizable: true, minimizable: true },
    position: { width: 1060, height: 690 },
  }, { inplace: false });

  static PARTS = { main: { template: TEMPLATES.SHARD_ENCODER } };

  /**
   * @param {object} [options]
   * @param {Item}   [options.item]   a blank the player already picked (the right-click door)
   * @param {string} [options.stage]  'blank' | 'program'
   * @param {string} [options.family] 'utility' | 'execute' (the Program Deck door)
   * @param {Actor}  [options.actor]  operate as this character (default: resolveOperator())
   */
  constructor(options = {}) {
    super(options);
    this.actor = options.actor || resolveOperator();
    this.cfg = resolveEncoderConfig(game.nightcity?.settingsManager?.getEncoderConfigRaw?.() ?? {});
    const fams = Object.keys(PROGRAM_FAMILIES).filter((f) => this.cfg.programs?.families?.[f] !== false);
    const family = fams.includes(options.family) ? options.family : (fams[0] || 'utility');
    const isShard = !!options.item?.getFlag?.(MODULE_ID, 'isDataShard');
    // A right-click on something the GM's blank rule excludes (a weapon, a
    // cyberarm) does NOT seed it — the player picks a real blank instead.
    const seedOk = options.item && !isShard && isEligibleBlank(this.cfg, {
      name: options.item.name, type: options.item.type, tierId: options.item.getFlag?.(MODULE_ID, 'blankTier') || '',
    });
    const seed = seedOk ? options.item : null;
    // A shard that already exists opens the RE-ENCODE door: the chip is the
    // source, the lock stays what it was, and the roll adds to it. Whether this
    // character may is `canEditShard` — the launcher and every door checked it,
    // but a macro can hand anything in, so the window judges again.
    const editing = isShard && canEditShard(options.item, this.actor).ok ? options.item : null;

    // The Program Deck's door asks for the program branch by name; everything else
    // starts on CONTENT, and the Payload / Malware tiles switch over.
    const mode = (options.family || options.stage === 'program') ? 'program' : 'content';
    this.S = {
      stage: ((seed || editing) && options.stage !== 'blank') ? 'build' : 'blank',
      mode,
      type: '',                              // the type of the NEXT file to write
      entries: [],                           // the files already written (content mode)
      editIndex: -1,                         // which one the composer is reopening
      adding: false,                         // the next type pick is for a NEW file
      dec: (seed || editing) ? (mode === 'program' ? 'fam' : 'type') : 'src',   // which decision row is open
      srcMode: editing ? 'edit' : 'own',     // 'own' | 'buy' | 'edit' (re-encode an existing shard)
      srcSearch: '', srcType: '', srcOnlyKnown: false,  // the blank list's search + filters
      itemId: (editing || seed)?.id || '',
      buyTierId: '',
      label: editing ? (editing.getFlag(MODULE_ID, 'config')?.shardName || editing.name) : (seed?.name || ''),
      img: '',                               // '' = the default chip art
      preset: '',                            // '' = plain; else a SHARD_PRESETS key
      savedLook: '',                         // '' = none; else an index into the GM's saved looks
      assistId: '',                          // '' = nobody helping (optional depth)
      customLook: null,                      // null = none; else { secondary, bgDeep } the player mixed
      customOpen: false,                     // is the mixer expanded?
      // What the shard does when it is opened. Seeded from the preset the moment
      // one is picked, then the player's own words win.
      boot: { enabled: true, title: '', subtitle: '', animationStyle: 'standard-fade', speed: 'normal' },
      bootTouched: false,                    // has the player typed their own?
      family,
      ability: '',                           // resolved by _ability() on first read
      craft: this.cfg.programs?.skill || 'Interface',
      disguise: '',                          // '' | a COVER_TYPES value
      progName: '',
      description: '',
      params: {},
      // The lock a player is building. Untouched = the shard ships open.
      lock: {
        password: '', encrypted: false, dv: 0, blackIce: false,
        failure: 'lockout', keyItem: null,
        cryptoTotal: null, gateTotal: null,   // null = that roll has not been made
      },
      manCollapsed: false, optOpen: false, opAll: false,
      detailsOpen: !!getLegibility().details,
      result: null,                          // set by the encode sequence
      busy: false,
    };
    this._madeItemId = null;
    this._raf = 0; this._rgb = '25,243,247'; this._build = 0; this._compiling = false; this._flareStart = 0;
    this._lg = getLegibility();
  }

  get title() { return this.actor ? `${T('short')} Encoder — ${this.actor.name}` : `${T('short')} Encoder`; }

  async _prepareContext() { return {}; }

  _onRender(context, options) {
    super._onRender(context, options);
    this._mount();
    // Say it once, on open, rather than letting the player build a whole shard
    // and only then discover they cannot write it.
    const problem = this._permissionProblem();
    if (problem && !this._warnedPermission) {
      this._warnedPermission = true;
      ui.notifications?.warn(`NCM | ${problem}`);
      this._status(`<span style="color:var(--ncm-warning)">${esc(problem)}</span>`);
    }
  }

  async close(options) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    return super.close(options);
  }

  // ── small helpers ────────────────────────────────────────────────────────
  g(id) { return this.element?.querySelector('#' + id) ?? null; }
  _motion() { return effectiveMotion(this._lg, { animationsEnabled: this.animationsEnabled }); }
  _still() { return this._motion() === 'off'; }

  /** stat + rank for a skill on the operator (Interface resolves off the Netrunner role). */
  _skill(name) {
    const d = game.nightcity?.skillService?.getSkillData?.(this.actor, name);
    if (!d) return { level: 0, stat: '—', statValue: 0, total: 0 };
    return {
      level: d.skillLevel || 0, stat: String(d.statName || '').toUpperCase(),
      statValue: d.statValue || 0, total: (d.statValue || 0) + (d.skillLevel || 0),
    };
  }
  _rank(name) { return this._skill(name || 'Interface').level; }

  /**
   * A plain descriptor for the pure model: the name it matches tier item-lists by, plus an
   * explicit tier stamped on a blank that was BOUGHT through the Encoder (that wins).
   */
  _desc(item) {
    if (!item) return null;
    return { name: item.name, type: item.type, tierId: item.getFlag?.(MODULE_ID, 'blankTier') || '' };
  }

  /** The blank the player is writing on, plus its GM tier and craft perk. */
  _blank() {
    const item = this.S.itemId ? (this.actor?.items?.get(this.S.itemId) || game.items?.get(this.S.itemId)) : null;
    // Nothing picked yet means NO tier — the readout must not claim one before there
    // is a blank, or the artifact card lies about what a botch would cost.
    const tier = this.S.srcMode === 'buy'
      ? (this.cfg.tiers.find((t) => t.id === this.S.buyTierId) || null)
      : (item ? tierForItem(this.cfg, this._desc(item)) : null);
    return { item, tier, perk: TIER_PERKS[tier?.perk || '']?.craft || 0 };
  }

  /** Re-encoding an existing shard rather than writing a blank? */
  _isEdit() { return this.S.srcMode === 'edit'; }

  /**
   * The shards in this character's gear that THEY may rewrite — the shard's
   * own rule (`playerEditing`) plus the GM's world switches, via canEditShard.
   * Carried only: a world shard is not in anyone's gear to re-encode.
   */
  _editable() {
    const items = this.actor?.items?.contents ?? [];
    return items.filter((i) => i.getFlag?.(MODULE_ID, 'isDataShard') && canEditShard(i, this.actor).ok)
      .map((i) => ({ item: i, files: (game.nightcity?.dataShardService?.getShardMessages?.(i) || []).length }))
      .sort((a, b) => a.item.name.localeCompare(b.item.name));
  }

  /** How many files are already on the shard being re-encoded (0 otherwise). */
  _onChip() {
    if (!this._isEdit()) return 0;
    const { item } = this._blank();
    return item ? (game.nightcity?.dataShardService?.getShardMessages?.(item) || []).length : 0;
  }

  /**
   * What a rejection costs. A blank can be bricked; a shard that already exists
   * is never destroyed by a bad re-encode — nothing is written and it stays as
   * it was (a trace can still fire, if the tier says so).
   */
  _botch(opts = {}) {
    const b = botchFor(this._blank().tier, opts);
    if (!this._isEdit()) return b;
    return { ...b, bricks: false, short: `the ${T('short', 'lower')} is unchanged` };
  }

  /**
   * A readable name for a system item type. CPR's are lowercase or camelCase
   * ('gear', 'cyberware', 'itemUpgrade'), and the picker should say what the
   * character sheet says.
   */
  _typeLabel(type) {
    const known = {
      gear: 'Gear', cyberware: 'Cyberware', weapon: 'Weapons', armor: 'Armor', clothing: 'Clothing',
      ammo: 'Ammo', drug: 'Drugs', vehicle: 'Vehicles', cyberdeck: 'Cyberdecks', program: 'Programs',
      itemUpgrade: 'Upgrades', criticalInjury: 'Injuries',
    };
    if (known[type]) return known[type];
    const words = String(type || 'item').replace(/([a-z])([A-Z])/g, '$1 $2');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /** Candidate blanks in the operator's gear — anything carryable that isn't already ours. */
  _candidates() {
    const items = this.actor?.items?.contents ?? [];
    return items.filter((i) => !NON_CARRIER.includes(i.type)
        && !i.getFlag?.(MODULE_ID, 'isDataShard') && !i.getFlag?.(MODULE_ID, 'isTerminal')
        && !i.getFlag?.(MODULE_ID, 'blankBricked')
        && isEligibleBlank(this.cfg, this._desc(i)))
      .map((i) => ({ item: i, tier: tierForItem(this.cfg, this._desc(i)) }))
      .sort((a, b) => (b.tier?.price ?? 0) - (a.tier?.price ?? 0) || a.item.name.localeCompare(b.item.name));
  }

  /** The current ability row (DV + rank gate); repairs S.ability if the family changed. */
  _ability() {
    const rank = this._rank(this.cfg.programs?.skill);
    const list = programAbilities(this.cfg, this.S.family, rank);
    let cur = list.find((a) => a.key === this.S.ability);
    if (!cur) { cur = list.find((a) => !a.locked) || list[0] || null; this.S.ability = cur?.key || ''; }
    return { rank, list, cur };
  }

  _isProgram() { return this.S.mode === 'program'; }

  /** The content types the GM allows, minus the two that route to the Program branch. */
  _types() { return typeRows(this.cfg).filter((r) => r.on && !r.isProgram); }
  _typeRow() { return this._types().find((r) => r.key === this.S.type) || null; }

  /** Every file written so far. */
  _entries() { return this.S.entries || []; }

  /** How many more fit, given the blank's tier. Infinity when there is no limit. */
  _room() {
    // Re-encoding: the chip's OWN stamped capacity, less what is already on it.
    if (this._isEdit()) {
      const limit = Number(this._blank().item?.getFlag?.(MODULE_ID, 'config')?.capacity) || 0;
      if (!limit) return Infinity;
      return Math.max(0, limit - this._onChip() - this._entries().length);
    }
    const { limit } = capacityOf(this._blank().tier);
    if (!limit) return Infinity;
    return Math.max(0, limit - this._entries().length);
  }

  /** The types currently on the chip, plus the one being added next. */
  _stackTypes() { return this._entries().map((e) => e.contentType).filter(Boolean); }

  /**
   * Eddies loaded onto the chip, which come out of the operator's OWN wealth.
   * A cred drop is money moved, not money invented — the old conversion wizard
   * debited it and so must this, or a player can mint eb from nothing (the type
   * needs no roll, so there is not even a check in the way).
   * @returns {number} 0 for every other content type
   */
  _eddiesLoad() {
    if (this._isProgram()) return 0;
    // Every cred drop on the chip is money the operator is putting in, so they
    // all count — not just the one that happens to be selected.
    return this._entries()
      .filter((e) => e.contentType === 'eddies')
      .reduce((n, e) => n + Math.max(0, Math.round(Number(e.contentData?.amount) || 0)), 0);
  }

  /**
   * A no-roll type (a note is a note) skips the check — but only if NOTHING on
   * the chip needs one. One forged file makes the whole chip a forgery.
   */
  _needsRoll() {
    if (this._isProgram()) return true;
    return this._stackTypes().some((t) => this.cfg.types?.[t]?.skill);
  }

  _dv() {
    // The GM's "re-encode at DV +N": writing onto a chip that already carries
    // files means agreeing with what is there.
    const extra = this._isEdit() ? Math.max(0, Number(this.cfg.reencode?.dv) || 0) : 0;
    if (this._isProgram()) return programDV(this.cfg, { ability: this.S.ability, craft: this.S.craft, disguised: !!this.S.disguise }) + extra;
    return this._stack().dv + extra;
  }

  /** The whole chip's difficulty: the hardest file, plus a penalty for crowding. */
  _stack() {
    const types = this._stackTypes();
    if (!types.length && this.S.type) types.push(this.S.type);      // nothing written yet — preview the pick
    return contentStackDV(this.cfg, { types, craft: this.S.craft });
  }

  /**
   * The craft choices for whichever branch is live. In content mode they come
   * from the HARDEST file on the chip — that is the one setting the DV, so it is
   * the one whose trade matters.
   */
  _choices() {
    if (this._isProgram()) return craftChoices(this.cfg, this.S.ability);
    return contentChoices(this.cfg, this._stack().hardest || this.S.type);
  }

  /** Keep S.craft on a skill this branch actually offers. */
  _syncCraft() {
    const cs = this._choices();
    if (!cs.length) return;
    if (!cs.some((c) => c.skill === this.S.craft && c.applies)) this.S.craft = (cs.find((c) => c.applies) || cs[0]).skill;
  }

  /**
   * Everything that adds to the encode roll besides the skill itself: the blank
   * tier's perk, plus whichever optional-depth rules the GM switched on.
   *
   * ONE place, so the odds in the readout, the ladder preview and the actual roll
   * can never quote different numbers — which is exactly what happens when a
   * bonus is added at the call site.
   */
  _bonuses() {
    const perk = this._blank().perk;
    const carried = (this.actor?.items?.contents ?? []).map((i) => i.name);
    const gear = gearBonusFor(this.cfg, carried);
    const assist = assistBonusFor(this.cfg, { helperRank: this._helperRank() });
    return { perk, gear, assist, total: perk + gear.bonus + assist };
  }

  /** The character lending a hand, if the GM allows it and one is chosen. */
  _helper() {
    if (!this.cfg.optional?.assist?.on || !this.S.assistId) return null;
    return game.actors?.get(this.S.assistId) || null;
  }

  /** The helper's rank in the craft skill — 0 when there is no helper. */
  _helperRank() {
    const h = this._helper();
    if (!h) return 0;
    return game.nightcity?.skillService?.getSkillData?.(h, this.S.craft)?.skillLevel ?? 0;
  }

  /** How long this encode costs on the world clock (0 when the rule is off). */
  _timeCost() { return timeCostFor(this.cfg, this._needsRoll() ? this._dv() : 0); }

  /**
   * Charge the encode's time cost.
   *
   * Advancing the world clock is a GM-only write, so a player cannot do it —
   * rather than fail silently or block the encode, the cost is always REPORTED
   * (to the table, and to the GM by whisper when a player cannot move the clock
   * themselves). Never throws: running out of permission must not cost a player
   * the shard they just rolled for.
   */
  async _spendTime() {
    const mins = this._timeCost();
    if (!mins) return;
    const label = formatMinutes(mins);
    const who = this.actor?.name || 'Someone';
    let moved = false;

    if (this.cfg.optional?.time?.advanceClock) {
      try {
        if (isGM() && typeof game.time?.advance === 'function') {
          await game.time.advance(mins * 60);
          moved = true;
        } else if (isGM()) {
          await game.nightcity?.timeService?.advanceManualTime?.(mins * 60);
          moved = true;
        }
      } catch (err) {
        log.warn(`Encoder: could not advance the clock — ${err.message}`);
      }
    }

    try {
      await ChatMessage.create({
        content: whisperCardHtml({
          tone: 'info',
          icon: 'fas fa-hourglass-half',
          title: 'Encoding took time',
          lines: [`${who} spent <b>${label}</b> encoding ${this._artName()}.`,
            moved ? 'The world clock has moved.' : 'The clock has NOT been moved — advance it if you want that.'],
        }),
        whisper: moved ? [] : ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
        speaker: { alias: `${T('short')} Encoder` },
      });
    } catch (err) {
      log.warn(`Encoder: could not report the time cost — ${err.message}`);
    }
  }

  /** stat + rank in the craft skill, plus every bonus in play. */
  _base() { return this._skill(this.S.craft).total + this._bonuses().total; }
  _odds() { return ladderOdds(this._base(), this._dv()); }

  _defaultName() {
    const word = String(abilityInfo(this.S.ability)?.label || 'Program').replace(/[^A-Za-z]/g, '') || 'Program';
    return this.S.family === 'execute' ? `${word}.exe` : `${word}.prg`;
  }
  _name() { return this.S.progName || this._defaultName(); }
  /** What the chip is called — the label, else the item it came from. */
  _shardName() { return this.S.label || this._blank().item?.name || `Untitled ${T('short', 'lower')}`; }

  /** The chip art: the player's pick, else the blank's own art, else the system chip. */
  _img() { return this.S.img || this._blank().item?.img || DEFAULT_SHARD_IMG; }

  /**
   * What the startup would say if the player typed nothing. A preset's own boot
   * block wins, so picking "Corporate Dossier" shows Arasaka's words as the
   * placeholder and typing over them is an override, not a fight.
   */
  _bootDefaults() {
    const p = this.S.preset ? SHARD_PRESETS?.[this.S.preset]?.boot : null;
    return {
      title: p?.title || T('one', 'upper'),
      subtitle: p?.subtitle || 'Reading chip contents...',
      animationStyle: p?.animationStyle || 'standard-fade',
      speed: p?.speed || 'normal',
    };
  }

  /** The presets a player may dress a shard in — look only, never security. */
  _presets() {
    if (this.cfg.look?.presets === false) return [{ key: '', label: 'Plain', icon: 'fas fa-microchip' }];
    const all = game.nightcity?.dataShardService?.getAllPresets?.() ?? [];
    return [{ key: '', label: 'Plain', icon: 'fas fa-microchip' },
      ...all.filter((p) => p.key !== 'blank').map((p) => ({ key: p.key, label: p.label, icon: p.icon }))];
  }

  _presetLabel() { return this._presets().find((p) => p.key === this.S.preset)?.label || 'Plain'; }

  _presetCards() {
    return this._presets().map((p) => `
      <span class="ncm-enc-preset ${(!this.S.savedLook && p.key === this.S.preset) ? 'on' : ''}" data-enc="preset:${esc(p.key)}">
        <i class="${esc(p.icon || 'fas fa-microchip')}"></i>${esc(p.label)}</span>`).join('');
  }

  /**
   * The GM's saved looks (the `shardThemePresets` library, authored in the shard
   * config's Theme tab), offered to the player as extra dress.
   *
   * Look only — a saved look is palette + fonts + wallpaper and carries no
   * security block by construction, so offering it here cannot hand a player a
   * shard with Black ICE on it. Same reason the preset chips exist at all.
   * Off when the GM has switched `look.savedThemes` off, or when none are saved.
   */
  _savedLooks() {
    if (this.cfg.look?.savedThemes === false) return [];
    try {
      const v = game.settings.get(MODULE_ID, 'shardThemePresets');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  _savedLookCards() {
    const looks = this._savedLooks();
    if (!looks.length) return '';
    return `
      <div class="ncm-fw-grouplab" style="--gfam:var(--fam);margin-top:10px">Looks your GM made</div>
      <div class="ncm-enc-presets">
        ${looks.map((t, i) => {
          const c = t.theme?.colors || {};
          return `<span class="ncm-enc-preset ncm-enc-preset--look ${this.S.savedLook === String(i) ? 'on' : ''}" data-enc="savedlook:${i}">
            <span class="ncm-enc-lookdot" style="background:${esc(c.secondary || '#19f3f7')}"></span>${esc(t.name)}</span>`;
        }).join('')}
      </div>`;
  }

  /**
   * A look the PLAYER mixes themselves. Deliberately two decisions — an accent
   * and a ground — not the GM's eleven-key grid: this is dressing a chip you are
   * about to hand someone, not authoring a theme, and every extra swatch is
   * another thing to get wrong while the encode roll waits.
   *
   * It writes the same `theme.colors` shape everything else uses, so a custom
   * look reads through `buildShardThemePrefs` exactly like a preset. Look only —
   * it can no more carry security than a preset chip can.
   */
  _customLookCards() {
    if (this.cfg.look?.custom === false) return '';
    const on = !!this.S.customLook;
    const cur = this.S.customLook || {};
    const open = this.S.customOpen;

    const head = `
      <div class="ncm-fw-grouplab" style="--gfam:var(--fam);margin-top:10px">Mix your own</div>
      <div class="ncm-enc-presets">
        <span class="ncm-enc-preset ncm-enc-preset--look ${on ? 'on' : ''}" data-enc="customlook">
          <span class="ncm-enc-lookdot" style="background:${esc(cur.secondary || '#19f3f7')}"></span>
          ${on ? 'Your look' : 'Mix your own'}</span>
        ${on ? '<span class="ncm-enc-preset" data-enc="customclear"><i class="fas fa-xmark"></i>Clear</span>' : ''}
      </div>`;
    if (!open) return head;

    const swatch = (key, val, label) => `
      <div class="ncm-enc-mixrow">
        <label>${esc(label)}</label>
        <div class="ncm-enc-mixsw">
          ${ENC_LOOK_SWATCHES[key].map((hex) => `
            <span class="ncm-enc-mixdot ${String(cur[key] || '').toLowerCase() === hex ? 'on' : ''}"
                  style="background:${hex}" data-enc="mix:${key}:${hex}" data-tooltip="${hex}"></span>`).join('')}
          <input type="color" class="ncm-enc-mixpick" value="${esc(cur[key] || ENC_LOOK_SWATCHES[key][0])}"
                 data-enc-mix="${key}" data-tooltip="Any colour">
        </div>
      </div>`;

    return head + `
      <div class="ncm-enc-mix">
        ${swatch('secondary', cur.secondary, 'Accent')}
        ${swatch('bgDeep', cur.bgDeep, 'Ground')}
        <div class="ncm-fw-hint">Two colours is the whole thing — the rest of the chip is derived from them.</div>
      </div>`;
  }

  /**
   * The cosmetic half of a preset — theme, boot sequence and the preset key the
   * viewer styles from. Deliberately NOT `security`: several shipped presets carry
   * Black ICE at DV 20, and a player must not get that for free by liking the
   * artwork. Security comes from the LOCK stage, where it is rolled for.
   */
  _lookConfig() {
    const out = { };
    const img = this._img();
    if (img) out.__img = img;                       // stripped before it reaches the service

    const p = this.S.preset ? SHARD_PRESETS?.[this.S.preset] : null;
    if (p) {
      out.preset = this.S.preset;
      if (p.theme) out.theme = foundry.utils.deepClone(p.theme);
      if (p.boot) out.boot = foundry.utils.deepClone(p.boot);
    }

    // A saved look layers its PALETTE on top. The two shapes coexist: a preset's
    // `theme` is the chrome block the boot splash reads (accent / headerBg /
    // watermarkIcon), a saved look is `{colors, fonts, wallpaper}` — no shared
    // keys, so neither clobbers the other.
    const look = this._savedLooks()[Number(this.S.savedLook)];
    if (this.S.savedLook !== '' && look?.theme) {
      const t = foundry.utils.deepClone(look.theme);
      const base = t.basePreset;
      delete t.basePreset;
      if (base && SHARD_PRESETS?.[base]) {
        out.preset = base;
        if (SHARD_PRESETS[base].boot) out.boot = foundry.utils.deepClone(SHARD_PRESETS[base].boot);
      }
      out.theme = { ...(out.theme || {}), ...t };
    }

    // The player's own two colours win over everything above them — they are the
    // last thing touched, so they are the most recent intent.
    if (this.S.customLook) {
      out.theme = { ...(out.theme || {}) };
      out.theme.colors = { ...(out.theme.colors || {}), ...this.S.customLook };
    }
    return out;
  }

  /** The colours currently dressing the shard — what the mixer opens on. */
  _activeLookColors() {
    if (this.S.customLook) return this.S.customLook;
    const saved = this._savedLooks()[Number(this.S.savedLook)];
    if (this.S.savedLook !== '' && saved?.theme?.colors) return saved.theme.colors;
    return SHARD_PRESETS?.[this.S.preset]?.palette || {};
  }

  /**
   * The startup, merged over whatever the preset supplies. Only fields the player
   * actually set are written, so an untouched shard keeps its preset's own words
   * rather than being overwritten with the generic defaults.
   */
  _bootConfig(base = {}) {
    const B = this.S.boot;
    const out = foundry.utils.deepClone(base.boot || {});
    out.enabled = B.enabled !== false;
    // The startup shows the chip the player chose. Without this it falls back to
    // a generic glyph — or to nothing at all once a preset supplies neither —
    // which is the "there's no icon in the animation" report.
    const art = this._img();
    if (art) { out.iconMode = 'image'; out.imageUrl = art; out.imageSize = out.imageSize || 96; }
    else if (!out.faIcon) { out.iconMode = 'fa'; out.faIcon = 'fas fa-microchip'; }
    if (B.title) out.title = B.title;
    if (B.subtitle) out.subtitle = B.subtitle;
    if (B.animationStyle) out.animationStyle = B.animationStyle;
    if (B.speed) out.speed = B.speed;
    return out;
  }

  /** What the artifact is called: a program's name, or the forged file's subject. */
  _artName() {
    if (this._isProgram()) return this._name();
    const files = this._entries();
    if (files.length === 1) return files[0].subject || this._shardName();
    if (files.length > 1) return this._shardName();
    return this._typeRow()?.key ? (CONTENT_TYPE_INFO[this.S.type]?.label || 'File') : this._shardName();
  }

  /** The stages actually in play — LOCK disappears when the GM disallows it. */
  _stages() {
    // The LOCK stage was rolled when the shard was made; a re-encode keeps it.
    return STAGES.filter((row) => row.key !== 'lock' || (this.cfg.lock?.allowed !== false && !this._isEdit()));
  }
  _stageIndex(key = this.S.stage) { return Math.max(0, this._stages().findIndex((s) => s.key === key)); }

  /** What this operator may lock, given whichever lock rolls they have made. */
  _lockOpts() {
    return lockOptions(this.cfg, { cryptoTotal: this.S.lock.cryptoTotal, gateTotal: this.S.lock.gateTotal });
  }

  /** Can this client actually land the write? Shard journals are GM-owned. */
  _canPersist() {
    if (isGM()) return true;
    if (game.users?.activeGM) return true;
    ui.notifications?.warn('NCM | No GM is connected — an encode cannot be written. Try again when your GM is online.');
    return false;
  }

  /**
   * Everything that would make an encode fail LATER, checked up front and said
   * in one sentence. Three of these are permission problems, and a permission
   * error thrown halfway through a write is the worst way to learn about them:
   *   · no operator at all
   *   · an operator you do not OWN (buying a blank creates an item on them, and
   *     paying for it updates their wealth — both need ownership)
   *   · the GM switched authoring off while the window was open
   * @returns {string|null} the problem, or null when it is safe to proceed
   */
  _permissionProblem() {
    if (!this.cfg.enabled && !isGM()) return 'Your GM has switched player authoring off.';
    if (!this.actor) return 'No operator — pick a character before encoding.';
    if (!this.actor.isOwner) return `You do not have permission to change ${this.actor.name}. Pick a character you own.`;
    // WHO may encode. Checked here rather than only at the door because the
    // operator is switchable from inside the window — picking a character who
    // does not qualify has to fail HERE, and it has to fail before the roll.
    const gate = canEncode(this.actor);
    if (!gate.ok) return gate.reason;
    // Re-encoding: the shard's own rule, judged again here because the operator
    // is switchable and a GM can change the rule while the window is open.
    if (this._isEdit()) {
      const { item } = this._blank();
      if (!item) return `That ${T('short', 'lower')} is gone — pick another.`;
      const edit = canEditShard(item, this.actor);
      if (!edit.ok) return edit.reason;
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  MOUNT — build the chamber once, then patch
  // ═══════════════════════════════════════════════════════════════════════
  _mount() {
    const root = this.g('encRoot');
    if (!root) return;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    root.innerHTML = this._shellHTML();
    this._applyLg();
    this._mountStage({ enter: true });
    if (!this._wired) { this._wire(root); this._wired = true; }
    this._sizeCanvas();
  }

  /** Stamp the player's accessibility prefs on the window root (live, no re-render). */
  _applyLg() {
    const root = this.g('encRoot');
    if (root) this._lg = applyLegibility(root, this._lg, { animationsEnabled: this.animationsEnabled });
    // The frame itself carries the contrast palette too, so the window header matches.
    if (this.element) { this.element.dataset.lgMotion = this._lg ? this._motion() : 'full'; }
  }

  _shellHTML() {
    return `
      <div class="ncm-fw-rail ncm-fw-rail--l">
        <div class="ncm-fw-railhd"><b><i class="fas fa-microchip"></i>Encoder</b></div>
        <div class="ncm-enc-stages" id="encStages"></div>
        <div id="encRail"></div>
      </div>

      <div class="ncm-fw-stage" id="encStageEl">
        <canvas class="ncm-fw-canvas" id="encCanvas"></canvas>
        <div class="ncm-fw-grid"></div>
        <div class="ncm-enc-sweep" id="encSweep"></div>
        <div class="ncm-fw-stagehd">
          <div style="flex:1;min-width:0;">
            <div class="ncm-fw-stagehd__n" id="encHdN">—</div>
            <div class="ncm-fw-stagehd__s" id="encHdS"></div>
          </div>
          <span class="ncm-fw-fam" id="encHdFam"></span>
        </div>
        <div class="ncm-fw-core-wrap" id="encCoreWrap">
          <div class="ncm-enc-die" id="encDie">
            <span class="ncm-enc-die__cube" id="encDieCube">?</span>
            <span class="ncm-enc-die__sum" id="encDieSum"></span>
          </div>
          <div class="ncm-enc-core-lbl" id="encCoreLbl">READY</div>
          <div class="ncm-fw-seal" id="encSeal"><i class="fas fa-check"></i> <span id="encSealN"></span></div>
          <div class="ncm-fw-core" id="encCore">
            <span class="ncm-fw-ring ncm-fw-ring--1"></span><span class="ncm-fw-ring ncm-fw-ring--2"></span><span class="ncm-fw-ring ncm-fw-ring--3"></span>
            <span class="ncm-fw-chipwrap"><span class="ncm-fw-chip-core"><i class="fas fa-microchip" id="encCoreIc"></i></span></span>
          </div>
        </div>
        <div class="ncm-enc-doc" id="encDoc" hidden>
          <div class="ncm-enc-doc__hd"><i class="fas fa-file"></i> <b id="encDocT">FILE</b>
            <span class="r" id="encDocSub"></span></div>
          <div class="ncm-enc-doc__body" id="encDocBody"></div>
        </div>
        <div class="ncm-enc-man" id="encMan" hidden></div>
        <div class="ncm-enc-write" id="encWrite" hidden>
          <div class="ncm-enc-sectors" id="encSectors">
            <div class="ncm-enc-sectors__hd"><i class="fas fa-hard-drive"></i> <b>WRITE</b> · sector map <span class="addr" id="encAddr">0x0000</span></div>
            <div class="ncm-enc-grid" id="encGrid"></div>
            <div class="ncm-enc-scan" id="encScan"></div>
            <div class="ncm-enc-hash" id="encHash">CRC —</div>
          </div>
          <div class="ncm-hackfx" id="encHackfx"></div>
        </div>
        <div class="ncm-fw-synth">
          <div class="ncm-fw-synth__row">
            <span class="ncm-fw-synth__lbl" id="encSynthLbl">Encode</span>
            <span class="ncm-fw-synth__bar"><span class="ncm-fw-synth__fill" id="encFill" style="width:0%"></span></span>
            <span class="ncm-fw-synth__pct" id="encPct">0%</span>
          </div>
          <div class="ncm-fw-synth__status" id="encStatus"></div>
        </div>
      </div>

      <div class="ncm-fw-rail ncm-fw-rail--r">
        <div class="ncm-fw-railhd"><b><i class="fas fa-wave-square"></i>Readout</b></div>
        <div class="ncm-fw-card ncm-fw-card--does">
          <div class="ncm-fw-card__t"><i class="fas fa-chart-simple"></i><span>What you'll get</span></div>
          <div class="ncm-fw-says" id="encSays"></div>
          <div class="ncm-enc-bar" id="encBar"></div>
          <div class="ncm-fw-timing" id="encTiming"></div>
          <button type="button" class="ncm-enc-more" data-enc="details" id="encMoreBtn"></button>
          <div class="ncm-enc-details" id="encDetails" hidden>
            <div class="ncm-enc-ladder" id="encLadder"></div>
            <div class="ncm-enc-eff" id="encEff" style="margin-top:6px"></div>
          </div>
        </div>
        <div class="ncm-fw-card ncm-fw-card--req">
          <div class="ncm-fw-card__t"><i class="fas fa-microchip"></i><span>Artifact</span></div>
          <div class="ncm-enc-art" id="encArt">
            <span class="ncm-enc-art__chip"></span>
            <div><div class="ncm-enc-art__n" id="encArtN">—</div><div class="ncm-enc-art__d" id="encArtD"></div></div>
          </div>
          <div style="margin-top:7px" id="encArtKv"></div>
        </div>
        <div class="ncm-fw-card" id="encMktCard" hidden>
          <div class="ncm-fw-card__t"><i class="fas fa-tag"></i><span>Market</span>
            <span id="encMktMode" style="margin-left:auto;text-transform:none;letter-spacing:.02em;font:calc(9.5px * var(--ncm-text-scale,1)) var(--ncm-font-mono,monospace);color:var(--ncm-text-secondary,#9fb3c0)"></span>
          </div>
          <div class="ncm-enc-mkt" id="encMkt"></div>
        </div>
        <div class="ncm-fw-card ncm-enc-opcard" id="encOpCard">
          <div class="ncm-fw-card__t"><i class="fas fa-user"></i><span id="encOpName">Operator</span>
            ${getOperatorActors().length > 1 ? '<button type="button" class="ncm-enc-more" style="margin:0 0 0 auto!important" data-enc="operator"><i class="fas fa-repeat"></i> Switch</button>' : ''}
          </div>
          <div id="encOpRows"></div>
          <button type="button" class="ncm-enc-more" data-enc="opall" id="encOpAll"><i class="fas fa-chevron-down"></i> All skills</button>
        </div>
      </div>

      <div class="ncm-fw-foot">
        <span class="ncm-fw-foot__hint" id="encHint"></span>
        <span class="ncm-fw-sp"></span>
        <button type="button" class="ncm-fw-save2" data-enc="display" title="Text size, contrast, motion"><i class="fas fa-universal-access"></i> Display</button>
        <button type="button" class="ncm-fw-save2" data-enc="cancel">Cancel</button>
        <button type="button" class="ncm-fw-save2" data-enc="back" id="encBack"><i class="fas fa-arrow-left"></i> Back</button>
        <button type="button" class="ncm-fw-save" data-enc="next" id="encNext"><i class="fas fa-arrow-right"></i> Next</button>
      </div>

      <div class="ncm-enc-lg" id="encLg" hidden>${this._lgHTML()}</div>`;
  }

  // ── DISPLAY (accessibility) popover ──────────────────────────────────────
  _lgHTML() {
    const p = this._lg, R = LEGIBILITY_RANGES;
    const row = (label, hint, body) => `
      <div class="ncm-enc-lg__row"><div class="ncm-enc-lg__k">${esc(label)}${hint ? `<span>${esc(hint)}</span>` : ''}</div>${body}</div>`;
    const slider = (field, val, r, suffix) => `
      <div class="ncm-enc-lg__sl">
        <input type="range" data-enc-lg="${field}" min="${r.min}" max="${r.max}" step="${r.step}" value="${val}">
        <b id="encLgV-${field}">${val}${suffix}</b>
      </div>`;
    const seg = (field, val, opts) => `
      <div class="ncm-fw-seg">${opts.map(([v, l]) => `<button type="button" data-enc-lg="${field}" data-v="${v}" class="${v === val ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const toggle = (field, on, label) => `
      <button type="button" class="ncm-enc-lg__tog ${on ? 'on' : ''}" data-enc-lg="${field}" data-v="${on ? '0' : '1'}">
        <i class="fas ${on ? 'fa-square-check' : 'fa-square'}"></i> ${esc(label)}</button>`;
    const forced = this._motion() === 'off' && p.motion !== 'off';

    return `
      <div class="ncm-enc-lg__hd"><i class="fas fa-universal-access"></i> <b>Display</b> · how this window reads
        <button type="button" class="ncm-enc-lg__x" data-enc="display"><i class="fas fa-xmark"></i></button></div>
      <div class="ncm-enc-lg__body">
        <div class="ncm-enc-lg__presets">${Object.entries(LEGIBILITY_PRESETS).map(([k, v]) =>
          `<button type="button" class="ncm-fw-chip" data-enc-lgpreset="${k}"><i class="${v.icon}"></i>${esc(v.label)}</button>`).join('')}</div>
        ${row('Text size', 'multiplies your Agent text size', slider('textScale', p.textScale, R.textScale, '%'))}
        ${row('Contrast', 'darks darker, lights lighter', slider('contrast', p.contrast, R.contrast, '%'))}
        ${row('Motion', forced ? 'forced off by your system setting' : 'animation during the encode',
          seg('motion', p.motion, [['full', 'Full'], ['calm', 'Calm'], ['off', 'Off']]))}
        ${row('Spacing', '', seg('density', p.density, [['compact', 'Compact'], ['roomy', 'Roomy']]))}
        <div class="ncm-enc-lg__togs">
          ${toggle('outlines', p.outlines, 'Stronger box edges')}
          ${toggle('plainFont', p.plainFont, 'Plain font (no display caps / mono)')}
          ${toggle('details', p.details, 'Always show the numbers')}
        </div>
        <div class="ncm-fw-hint">Yours only — it changes nothing for anyone else, and your Agent theme still decides the colours.</div>
      </div>`;
  }

  _toggleLg(force) {
    const el = this.g('encLg'); if (!el) return;
    const show = force ?? el.hidden;
    if (show) el.innerHTML = this._lgHTML();
    el.hidden = !show;
  }

  async _setLg(patch) {
    this._lg = await setLegibility(patch);
    if (patch.details !== undefined) { this.S.detailsOpen = !!patch.details; }
    this._applyLg();
    const el = this.g('encLg');
    if (el && !el.hidden) el.innerHTML = this._lgHTML();
    this._patch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  WIRING — one delegated listener set on the chamber root
  // ═══════════════════════════════════════════════════════════════════════
  _wire(root) {
    root.addEventListener('click', (e) => {
      const lgp = e.target.closest('[data-enc-lgpreset]');
      if (lgp) { const k = lgp.dataset.encLgpreset; this._setLg({ ...(k === 'default' ? LEGIBILITY_PRESETS.default.prefs : LEGIBILITY_PRESETS[k]?.prefs || {}) }); return; }
      const lg = e.target.closest('button[data-enc-lg]');
      if (lg) { const f = lg.dataset.encLg; const v = lg.dataset.v; this._setLg({ [f]: (v === '0' || v === '1') ? v === '1' : v }); return; }
      const t = e.target.closest('[data-enc]');
      if (!t) return;
      const [act, arg] = String(t.dataset.enc).split(':');
      this._onAct(act, arg ?? t.dataset.v, t);
    });
    root.addEventListener('input', (e) => {
      const lg = e.target.closest('input[data-enc-lg]');
      if (lg) {
        const f = lg.dataset.encLg, v = Number(lg.value);
        const out = this.g('encLgV-' + f); if (out) out.textContent = v + '%';
        this._lg = applyLegibility(this.g('encRoot'), { ...this._lg, [f]: v }, { animationsEnabled: this.animationsEnabled });
        clearTimeout(this._lgSave); this._lgSave = setTimeout(() => setLegibility({ [f]: v }), 250);
        return;
      }
      const sr = e.target.closest('[data-enc-search]');
      if (sr) {
        // DOM-only: re-rendering the rail on every keystroke would steal focus.
        this.S.srcSearch = sr.value;
        const q = sr.value.trim().toLowerCase();
        let shown = 0;
        this.element.querySelectorAll('.ncm-enc-src [data-src-name]').forEach((row) => {
          const hit = !q || row.dataset.srcName.includes(q);
          row.hidden = !hit;
          if (hit) shown++;
        });
        const count = this.element.querySelector('[data-enc-srccount]');
        if (count) count.textContent = q ? `${shown} match${shown === 1 ? '' : 'es'}` : count.textContent;
        return;
      }
      // The custom-look colour pickers fire `input` continuously while dragging.
      // They only repaint the swatch row + the preview — a full rail re-render
      // per frame would tear the picker out from under the cursor.
      const mix = e.target.closest('[data-enc-mix]');
      if (mix) {
        this.S.customLook = { ...(this.S.customLook || {}), [mix.dataset.encMix]: mix.value };
        this.S.savedLook = '';
        for (const dot of this.element.querySelectorAll(`[data-enc^="mix:${mix.dataset.encMix}:"]`)) {
          dot.classList.toggle('on', dot.dataset.enc.split(':')[2] === String(mix.value).toLowerCase());
        }
        const chipDot = this.element.querySelector('[data-enc="customlook"] .ncm-enc-lookdot');
        if (chipDot && mix.dataset.encMix === 'secondary') chipDot.style.background = mix.value;
        this._patch();
        return;
      }
      const t = e.target.closest('[data-enc-in]'); if (!t) return;
      const f = t.dataset.encIn;
      if (f === 'label') this.S.label = t.value;
      else if (f === 'progName') { this.S.progName = t.value; this._patchNames(); return; }
      else if (f === 'description') this.S.description = t.value;
      else if (f === 'param') { this.S.params[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value; return; }
      else if (f === 'lockpw') { this.S.lock.password = t.value; }
      else if (f === 'bootTitle') { this.S.boot.title = t.value; this.S.bootTouched = true; return; }
      else if (f === 'bootSub') { this.S.boot.subtitle = t.value; this.S.bootTouched = true; return; }
      this._patch();
    });
    root.addEventListener('change', (e) => {
      const t = e.target.closest('[data-enc-sel]'); if (!t) return;
      const f = t.dataset.encSel;
      if (f === 'disguise') { this.S.disguise = t.value; this._renderRail({ enter: false }); }
      else if (f === 'param') { this.S.params[t.dataset.f] = t.value; }
      this._patch();
    });
  }

  async _onAct(act, arg, el) {
    const S = this.S;
    if (!['type', 'addwrite', 'addentry', 'dec'].includes(act)) S.adding = false;
    switch (act) {
      case 'display':  this._toggleLg(); return;
      case 'details':  S.detailsOpen = !S.detailsOpen; this._patchDetails(); return;
      case 'opall':    S.opAll = true; this._renderOperator(); return;
      case 'dec':      S.dec = S.dec === arg ? null : arg; this._renderRail({ enter: false }); return;
      case 'srcmode':  if (S.srcMode !== arg) S.itemId = ''; S.srcMode = arg; this._renderRail({ enter: false }); this._patch(); return;
      case 'edit':     S.srcMode = 'edit'; S.itemId = arg; S.dec = 'lbl';
                       S.label = this._blank().item?.getFlag(MODULE_ID, 'config')?.shardName || this._blank().item?.name || '';
                       this._renderRail({ enter: false }); this._patch(); return;
      case 'srcfilter': S.srcOnlyKnown = !S.srcOnlyKnown; if (S.srcOnlyKnown) S.srcType = '';
                        this._renderRail({ enter: false }); return;
      case 'srctype':   S.srcType = arg || ''; if (arg) S.srcOnlyKnown = false;
                        this._renderRail({ enter: false }); return;
      case 'src':      S.srcMode = 'own'; S.itemId = arg; S.dec = 'look';
                       if (!S.label) S.label = this._blank().item?.name || '';
                       this._renderRail({ enter: false }); this._patch(); return;
      case 'buy':      S.srcMode = 'buy'; S.buyTierId = arg; S.itemId = ''; S.dec = 'look';
                       this._renderRail({ enter: false }); this._patch(); return;
      case 'type': {
        const adding = S.adding;
        S.adding = false;
        S.type = arg; S.mode = 'content'; S.editIndex = -1;
        this._syncCraft();
        S.dec = 'write';
        this._renderRail({ enter: false }); this._patch();
        // "Write another file" asks what the file IS, then writes it. Stopping at
        // the rail here left no way to reach the editor for a second file.
        if (adding) return void this._openEditor();
        return;
      }
      case 'toprogram': S.mode = 'program'; S.entries = []; S.dec = 'fam'; this._syncCraft();
                        this._mountStage({ enter: true }); return;
      case 'write':    return void this._openEditor();
      case 'addwrite': {
        if (this._room() <= 0) { ui.notifications?.warn('NCM | That chip is full.'); return; }
        S.editIndex = -1;
        // Choosing what the next file IS comes before writing it — and picking a
        // type while this is set opens the editor for a NEW file, never the last one.
        S.adding = true;
        S.dec = 'type';
        this._renderRail({ enter: false }); this._patch();
        return;
      }
      case 'img':      S.img = GEAR_ART + arg; this._renderRail({ enter: false }); this._patch(); return;
      case 'assist': {
        // A helper who cannot help is refused rather than silently accepted —
        // the chip already says 'no help', so letting it latch would contradict it.
        if (arg && el?.classList.contains('is-lock')) return;
        S.assistId = arg || '';
        this._renderRail({ enter: false }); this._patch();
        return;
      }
      case 'customlook': {
        // First click starts a look from the current dress, so the mixer opens on
        // something rather than on nothing; later clicks just fold it.
        if (!S.customLook) {
          const from = this._activeLookColors();
          S.customLook = { secondary: from.secondary || ENC_LOOK_SWATCHES.secondary[0], bgDeep: from.bgDeep || ENC_LOOK_SWATCHES.bgDeep[0] };
          S.preset = S.preset || '';
          S.savedLook = '';
          S.customOpen = true;
        } else {
          S.customOpen = !S.customOpen;
        }
        this._renderRail({ enter: false }); this._patch();
        return;
      }
      case 'customclear':
        S.customLook = null; S.customOpen = false;
        this._renderRail({ enter: false }); this._patch();
        return;
      case 'mix': {
        const [key, hex] = String(arg).split(':');
        S.customLook = { ...(S.customLook || {}), [key]: hex };
        S.savedLook = '';
        this._renderRail({ enter: false }); this._patch();
        return;
      }
      case 'savedlook': {
        // Picking a saved look replaces a preset pick rather than stacking on it —
        // two 'on' chips claiming to set the same thing reads as a bug.
        S.savedLook = S.savedLook === String(arg) ? '' : String(arg);
        if (S.savedLook !== '') {
          const base = this._savedLooks()[Number(S.savedLook)]?.theme?.basePreset;
          S.preset = (base && SHARD_PRESETS?.[base]) ? base : S.preset;
        }
        const bd = this._bootDefaults();
        if (!S.bootTouched) { S.boot.animationStyle = bd.animationStyle; S.boot.speed = bd.speed; }
        this._renderRail({ enter: false }); this._patch();
        return;
      }
      case 'preset': {
        S.preset = arg || '';
        S.savedLook = '';
        // A preset brings its own startup; adopt its animation and speed unless
        // the player has already chosen their own.
        const d = this._bootDefaults();
        if (!S.bootTouched) { S.boot.animationStyle = d.animationStyle; S.boot.speed = d.speed; }
        this._renderRail({ enter: false }); this._patch();
        return;
      }
      case 'bootanim':  S.boot.animationStyle = arg; S.bootTouched = true; this._renderRail({ enter: false }); return;
      case 'bootspeed': S.boot.speed = arg; S.bootTouched = true; this._renderRail({ enter: false }); return;
      case 'bootoff':   S.boot.enabled = !S.boot.enabled; this._renderRail({ enter: false }); this._patch(); return;
      case 'browseimg': return void this._browseImage();
      case 'designimg': return void this._designImage();
      case 'lockpw': {
        if (arg === 'off') { S.lock.password = ''; }
        else if (!S.lock.password) { S.lock.password = this._makePassword(); }
        this._renderRail({ enter: false }); this._patch(); return;
      }
      case 'lockgen':  S.lock.password = this._makePassword(); this._renderRail({ enter: false }); this._patch(); return;
      case 'lockenc': {
        S.lock.encrypted = arg === 'on';
        if (S.lock.encrypted && !S.lock.dv) S.lock.dv = this._lockOpts().dvChoices.slice(-1)[0] || 0;
        if (!S.lock.encrypted) S.lock.blackIce = false;
        this._renderRail({ enter: false }); this._patch(); return;
      }
      case 'lockdv':   S.lock.dv = Number(arg) || 0; this._renderRail({ enter: false }); this._patch(); return;
      case 'lockice': {
        if (arg === 'black' && !this._lockOpts().canBlackIce) return;
        S.lock.blackIce = arg === 'black';
        this._renderRail({ enter: false }); this._patch(); return;
      }
      case 'lockfail': {
        if (LOCK_FAILURES[arg]?.needsRung && !this._lockOpts().canDamage) return;
        S.lock.failure = arg; S.lock.keyItem = null;
        this._renderRail({ enter: false }); this._patch(); return;
      }
      case 'lockroll':    return void this._rollLock(arg);
      case 'lockkey':     return void this._pickKeyItem();
      case 'lockkeyoff':  S.lock.keyItem = null; this._renderRail({ enter: false }); this._patch(); return;
      case 'discard': {
        // Drop one file, not the lot — a chip can carry several now.
        const i = Number(arg);
        if (Number.isInteger(i) && i >= 0) S.entries.splice(i, 1); else S.entries = [];
        this._syncCraft();
        this._renderRail({ enter: false }); this._patch(); return;
      }
      case 'editentry': {
        const i = Number(arg);
        if (!Number.isInteger(i) || !S.entries[i]) return;
        S.editIndex = i;
        S.type = S.entries[i].contentType || S.type;
        return void this._openEditor();
      }
      case 'addentry': {
        if (this._room() <= 0) { ui.notifications?.warn('NCM | That chip is full.'); return; }
        S.editIndex = -1;
        S.adding = true;
        S.dec = 'type';
        this._renderRail({ enter: false }); this._patch(); return;
      }
      case 'fam':      S.family = arg; S.ability = ''; S.dec = 'ab'; this._syncCraft(); this._renderRail({ enter: false }); this._patch(); return;
      case 'ab':       if (el?.classList.contains('is-lock')) return; S.ability = arg; S.dec = 'sk'; this._syncCraft();
                       this._renderRail({ enter: false }); this._patch(); return;
      case 'sk':       if (el?.classList.contains('is-lock')) return; S.craft = arg; S.dec = null;
                       this._renderRail({ enter: false }); this._patch(); this._renderStages(); return;
      case 'man':      S.manCollapsed = !S.manCollapsed; this._renderManifest(); return;
      case 'opt':      S.optOpen = !S.optOpen; this._renderManifest(); return;
      case 'operator': if (await openOperatorPicker(this.element)) { this.actor = resolveOperator(); this._mount(); } return;
      case 'cancel':   this.close(); return;
      case 'back':     this._navigate(-1); return;
      case 'next':     this._navigate(1); return;
      case 'go':       this._runEncode(); return;
      case 'price':    return void this._proposePrice();
      case 'open': {
        const id = this._madeItemId;
        const it = id ? (this.actor?.items?.get(id) || game.items?.get(id)) : null;
        this.close();
        if (it) game.nightcity?.openDataShard?.(it);
        return;
      }
      case 'restart':  this._restart(); return;
      case 'done':     this.close(); return;
      default: log.debug(`Encoder: unhandled action ${act}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  NAVIGATION + the stage transition (out-fold → sweep → core morph → in)
  // ═══════════════════════════════════════════════════════════════════════
  _navigate(dir) {
    const i = this._stageIndex();
    const stages = this._stages();
    if (dir < 0) { if (i === 0) return void this.close(); return void this._transitionTo(stages[i - 1].key); }
    if (this.S.stage === 'encode') { if (!this.S.result) this._runEncode(); return; }
    if (this.S.stage === 'blank' && !this._blank().tier) {
      ui.notifications?.warn('NCM | Pick something to write on first.');
      return;
    }
    if (this.S.stage === 'build' && !this._isProgram()) {
      if (!this._typeRow()) { ui.notifications?.warn('NCM | Pick what goes on the chip first.'); return; }
      if (!this._entries().length) { ui.notifications?.warn('NCM | Write something first — there is nothing to encode yet.'); return; }
    }
    this._transitionTo(stages[i + 1].key);
  }

  async _transitionTo(key) {
    if (key === this.S.stage || this._transitioning) return;
    this._transitioning = true;
    const root = this.g('encRoot');
    const back = this._stageIndex(key) < this._stageIndex();
    root.dataset.dir = back ? 'back' : 'fwd';
    const cards = [...this.element.querySelectorAll('.ncm-fw-rail--r .ncm-fw-card')];
    const moving = this._motion() !== 'off';

    if (moving) {
      ['encRail', 'encMan', 'encWrite'].forEach((id) => this.g(id)?.classList.add('is-leaving'));
      cards.forEach((c) => c.classList.add('is-leaving'));
      this.g('encCore')?.classList.add('is-dip');
      await wait(190);
    }
    this.element.querySelectorAll('.is-leaving').forEach((e) => e.classList.remove('is-leaving'));
    this.S.stage = key;
    this._mountStage({ enter: true });

    if (moving) {
      const sweep = this.g('encSweep');
      if (sweep) { sweep.classList.remove('run'); void sweep.offsetWidth; sweep.classList.add('run'); }
      const core = this.g('encCore');
      if (core) { core.classList.remove('is-dip'); core.classList.add('is-morph'); setTimeout(() => core.classList.remove('is-morph'), 500); }
      this._decode(this.g('encCoreLbl'));
      cards.forEach((c) => { if (!c.hidden) { c.classList.add('is-arriving'); setTimeout(() => c.classList.remove('is-arriving'), 400); } });
    } else {
      this.g('encCore')?.classList.remove('is-dip');
    }
    this._transitioning = false;
  }

  /** Glyph-scramble that resolves left→right. Skipped entirely when motion is off. */
  _decode(el, text) {
    if (!el) return;
    const str = text ?? el.dataset.txt ?? el.textContent;
    el.dataset.txt = str;
    if (this._motion() !== 'full') { el.textContent = str; return; }
    const t0 = performance.now(), dur = 420;
    const step = () => {
      if (!el.isConnected) return;
      const k = (performance.now() - t0) / dur;
      const n = Math.floor(str.length * Math.max(0, Math.min(1, k)));
      let out = str.slice(0, n);
      for (let i = n; i < str.length; i++) out += str[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      el.textContent = out;
      if (k < 1) requestAnimationFrame(step); else el.textContent = str;
    };
    step();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STAGE MOUNT
  // ═══════════════════════════════════════════════════════════════════════
  _mountStage({ enter = true } = {}) {
    const root = this.g('encRoot');
    root.dataset.encStage = this.S.stage;
    root.dataset.fam = this.S.stage === 'blank' ? 'blank' : (this._isProgram() ? this.S.family : 'content');
    // reset the centre
    this.g('encMan').hidden = true;
    this.g('encDoc').hidden = true;
    this.g('encWrite').hidden = true;
    this.g('encMktCard').hidden = true;
    this.g('encDie').classList.remove('show', 'rolling');
    this.g('encCore').className = 'ncm-fw-core';
    this.g('encSeal').className = 'ncm-fw-seal';
    this.g('encCoreWrap').style.flex = '';
    this._setBuild(this.S.stage === 'encode' ? 0.35 : 0);
    if (this.S.stage !== 'blank') this._syncCraft();
    if (this.S.stage === 'lock' && !['pw', 'enc', 'fail'].includes(this.S.dec)) this.S.dec = 'enc';
    if (this.S.stage === 'build' && !this._isProgram() && !['type', 'write', 'sk'].includes(this.S.dec)) this.S.dec = 'type';
    if (this.S.stage === 'blank' && !['src', 'look', 'lbl'].includes(this.S.dec)) this.S.dec = 'src';
    this._renderStages();
    this._renderRail({ enter });
    this._renderOperator();
    this._patch();
  }

  _renderStages() {
    const cur = this._stageIndex();
    this.g('encStages').innerHTML = this._stages().map((row, i) => `
      <div class="ncm-enc-stage ${i < cur ? 'is-done' : ''} ${i === cur ? 'is-on' : ''} ${row.optional ? 'is-opt' : ''}" data-enc="stage:${row.key}">
        <span class="ncm-enc-stage__n">${i < cur ? '<i class="fas fa-check"></i>' : i + 1}</span>
        <div><div class="ncm-enc-stage__t">${esc(stageText(row, 'title', this.S.mode))}</div>
             <div class="ncm-enc-stage__d">${esc(stageText(row, 'sub', this.S.mode))}</div></div>
        ${this._spineSkill(row, i === cur)}
      </div>`).join('');
    this.g('encStages').querySelectorAll('[data-enc^="stage:"]').forEach((row) => {
      row.addEventListener('click', () => {
        const key = row.dataset.enc.split(':')[1];
        if (this.S.result) return;                       // after a seal the run is over
        if (this._stageIndex(key) > this._stageIndex() && this.S.stage === 'blank' && !this._blank().tier) return;
        this._transitionTo(key);
      });
    });
  }

  /**
   * The skill chip on the active spine row — whichever skill THAT stage rolls.
   * The lock rolls its own; blank rolls nothing; the rest use the craft skill.
   */
  _spineSkill(row, active) {
    if (!active || row.key === 'blank') return '';
    if (row.key === 'lock') {
      const sk = this.cfg.lock?.skill || 'Cryptography';
      return `<span class="ncm-enc-stage__sk">${esc(shortSk(sk).toUpperCase())} ${this._skill(sk).total}</span>`;
    }
    if (!this._needsRoll()) return '';
    return `<span class="ncm-enc-stage__sk">${esc(shortSk(this.S.craft).toUpperCase())} ${this._base()}</span>`;
  }

  /** One collapsible decision row — the Workshop's "ask one question at a time". */
  _decRow(key, icon, label, value, body, i = 0) {
    const open = this.S.dec === key;
    return `
      <div class="ncm-enc-dec ncm-enc-in ${open ? 'is-open' : 'is-done'}" style="--i:${i}">
        <div class="ncm-enc-dec__hd" data-enc="dec:${key}">
          <i class="fas ${open ? icon : 'fa-check'} ic"></i>
          <span class="ncm-enc-dec__k">${esc(label)}</span>
          <span class="ncm-enc-dec__v">${value}</span>
          <i class="fas ${open ? 'fa-chevron-up' : 'fa-pen'} ed"></i>
        </div>
        <div class="ncm-enc-dec__b">${body}</div>
      </div>`;
  }

  _renderRail({ enter = true } = {}) {
    const rail = this.g('encRail');
    rail.classList.toggle('fx-skip', !enter);
    if (this.S.stage === 'blank') rail.innerHTML = this._railBlank();
    else if (this.S.stage === 'build') rail.innerHTML = this._isProgram() ? this._railProgram() : this._railContent();
    else if (this.S.stage === 'lock') rail.innerHTML = this._railLock();
    else rail.innerHTML = this._railEncode();
    if (this.S.stage === 'build' && this._isProgram()) this._renderManifest();
    this._renderOperator();
  }

  // ── STAGE 1 · BLANK ──────────────────────────────────────────────────────
  _railBlank() {
    const { item, tier } = this._blank();
    const cands = this._candidates();
    const buyable = this.cfg.tiers.filter((t) => t.buyable);
    const wealth = this.actor?.system?.wealth?.value ?? 0;

    const card = (name, sub, t, on, act, o = {}) => {
      const b = botchFor(t);
      return `<div class="ncm-fw-icecard ${on ? 'on' : ''}" data-enc="${act}" data-src-name="${esc(String(name).toLowerCase())}" ${o.hide ? 'hidden' : ''}>
        <span class="ncm-fw-icecard__ic" ${on ? 'style="color:var(--fam)"' : ''}><i class="fas fa-microchip"></i></span>
        <span class="ncm-fw-icecard__b">
          <span class="ncm-fw-icecard__n">${esc(name)}<span class="ncm-enc-tier" data-tier="${esc(t?.color || 'cyan')}">${esc(t?.name || '—')}</span></span>
          <span class="ncm-fw-icecard__d">${esc(sub)} · ${esc(capacityOf(t).label)}${t?.hardening ? ` · hardened −${t.hardening}%` : ""}<span class="botch ${b.bricks ? 'bad' : 'ok'}">on a botch: ${esc(b.short)}${t?.perk ? ' · ' + esc(TIER_PERKS[t.perk].label) : ''}</span></span>
        </span>
        ${on ? '<span class="ncm-fw-icecard__dmg" style="color:var(--ncm-success)">READY</span>' : ''}
      </div>`;
    };

    // Only items the GM actually listed in a tier are "known" blanks; everything
    // else is scrap you are choosing to wipe.
    const known = cands.filter(({ tier: t }) => t && !t.fallback);

    // Gear is sorted by TYPE on a character sheet, so that is how you look for
    // something in it. Chips are built from what this character actually carries.
    const byType = new Map();
    for (const c of cands) byType.set(c.item.type, (byType.get(c.item.type) || 0) + 1);
    const types = [...byType.entries()]
      .sort((a, b) => b[1] - a[1] || this._typeLabel(a[0]).localeCompare(this._typeLabel(b[0])));
    if (this.S.srcType && !byType.has(this.S.srcType)) this.S.srcType = '';   // it went away

    let shown = cands;
    if (this.S.srcOnlyKnown) shown = shown.filter(({ tier: t }) => t && !t.fallback);
    if (this.S.srcType) shown = shown.filter(({ item: it }) => it.type === this.S.srcType);
    const q = this.S.srcSearch.trim().toLowerCase();

    const ownList = shown.length
      ? shown.map(({ item: it, tier: t }) => card(it.name, `${esc(it.type)} · will be wiped`, t,
          it.id === this.S.itemId && this.S.srcMode === 'own', `src:${it.id}`,
          { hide: !!q && !it.name.toLowerCase().includes(q) })).join('')
      : (this.S.srcOnlyKnown
        ? '<div class="ncm-fw-hint">You are carrying nothing your GM counts as a blank. Pick <b>All</b>, or buy one.</div>'
        : this.S.srcType
          ? `<div class="ncm-fw-hint">No ${esc(this._typeLabel(this.S.srcType).toLowerCase())} in your gear. Pick <b>All</b> to see everything.</div>`
          : `<div class="ncm-fw-hint">Nothing you carry can be written on. ${esc(blankRuleRefusal(this.cfg))}</div>`);

    const chip = (key, label, n, on, icon) => `
      <span class="ncm-fw-chip ${on ? 'on' : ''}" data-enc="srctype:${key}">
        ${icon ? `<i class="fas ${icon}"></i>` : ''}${esc(label)}<span class="ncm-enc-count">${n}</span></span>`;

    const srcTools = cands.length ? `
      <div class="ncm-enc-srctools">
        <div class="ncm-enc-search">
          <i class="fas fa-magnifying-glass"></i>
          <input type="text" data-enc-search="src" value="${esc(this.S.srcSearch)}" placeholder="search your gear…">
        </div>
      </div>
      <div class="ncm-enc-srcchips">
        ${chip('', 'All', cands.length, !this.S.srcType && !this.S.srcOnlyKnown)}
        ${known.length ? `<span class="ncm-fw-chip ${this.S.srcOnlyKnown ? 'on' : ''}" data-enc="srcfilter">
          <i class="fas fa-microchip"></i>Blanks<span class="ncm-enc-count">${known.length}</span></span>` : ''}
        ${types.map(([t, n]) => chip(t, this._typeLabel(t), n, this.S.srcType === t)).join('')}
      </div>
      <div class="ncm-fw-hint" data-enc-srccount>${shown.length} of ${cands.length} in your gear</div>` : '';

    const buyList = buyable.length
      ? buyable.map((t) => `<span class="ncm-fw-chip ${this.S.srcMode === 'buy' && this.S.buyTierId === t.id ? 'on' : ''} ${wealth < t.price ? 'is-lock' : ''}" data-enc="buy:${t.id}">
          <i class="fas fa-cart-shopping"></i>${esc(t.name)} · ${t.price} eb<span class="dv">${esc(capacityOf(t).label)}</span>${wealth < t.price ? '<span class="need">short</span>' : ''}</span>`).join('')
      : '<div class="ncm-fw-hint">Your GM sells no blanks — convert something you own.</div>';

    // Shards this character may re-encode — shown only when the GM allows it
    // and there is at least one, so the segment is never a dead option.
    const editable = this.cfg.reencode?.allowed === false ? [] : this._editable();
    const reDV = Math.max(0, Number(this.cfg.reencode?.dv) || 0);
    const editList = editable.length
      ? editable.map(({ item: it, files }) => {
        const on = this._isEdit() && it.id === this.S.itemId;
        const cfg = it.getFlag(MODULE_ID, 'config') || {};
        const cap = Number(cfg.capacity) || 0;
        return `<div class="ncm-fw-icecard ${on ? 'on' : ''}" data-enc="edit:${it.id}">
          <span class="ncm-fw-icecard__ic" ${on ? 'style="color:var(--fam)"' : ''}><i class="fas fa-pen-nib"></i></span>
          <span class="ncm-fw-icecard__b">
            <span class="ncm-fw-icecard__n">${esc(cfg.shardName || it.name)}</span>
            <span class="ncm-fw-icecard__d">${files} file${files === 1 ? '' : 's'} on it${cap ? ` · holds ${cap}` : ''}${cfg.playerMade?.quality != null ? ` · quality ${cfg.playerMade.quality}%` : ''}<span class="botch ok">on a botch: the shard is unchanged</span></span>
          </span>
          ${on ? '<span class="ncm-fw-icecard__dmg" style="color:var(--ncm-success)">READY</span>' : ''}
        </div>`;
      }).join('')
      : `<div class="ncm-fw-hint">Nothing in your gear can be re-encoded — ${withArticle(T('short', 'lower'))} you made, or one your GM opened up.</div>`;

    const srcValue = this.S.srcMode === 'buy'
      ? `Buy ${esc(tier?.name || '—')}<small>${tier?.price ?? 0} eb</small>`
      : this._isEdit()
        ? (item ? `${esc(this._shardName())}<small>re-encode · ${this._onChip()} on it</small>` : 'Not chosen')
        : (item ? `${esc(item.name)}<small>${esc(tier?.name || '')}</small>` : 'Not chosen');

    return this._decRow('src', 'fa-box-open', 'Source', srcValue, `
      <div class="ncm-fw-seg" style="width:100%">
        <button type="button" data-enc="srcmode:own" class="${this.S.srcMode === 'own' ? 'on' : ''}">Convert an item</button>
        <button type="button" data-enc="srcmode:buy" class="${this.S.srcMode === 'buy' ? 'on' : ''}">Buy a blank</button>
        ${editable.length ? `<button type="button" data-enc="srcmode:edit" class="${this._isEdit() ? 'on' : ''}">Re-encode ${withArticle(T('short', 'lower'))}</button>` : ''}
      </div>
      ${this.S.srcMode === 'own'
        ? `${srcTools}<div class="ncm-enc-src" style="margin-top:8px">${ownList}</div>`
        : this._isEdit()
          ? `<div class="ncm-enc-src" style="margin-top:8px">${editList}</div>
             <div class="ncm-fw-hint" style="margin-top:6px">Add files to ${withArticle(T('short', 'lower'))} that already exists, or re-roll how convincing its files are. One roll covers the chip${reDV ? `, at <b>DV +${reDV}</b> for agreeing with what is already on it` : ''}. The lock and the look stay as they are.</div>`
          : `<div class="ncm-enc-buy" style="margin-top:8px">${buyList}</div>
           <div class="ncm-fw-hint" style="margin-top:6px">You have <b>${wealth} eb</b>. The cost comes off when the encode starts, and comes back if the write never happens.</div>`}
      <div class="ncm-fw-hint">${withArticle(T('one'))} is a physical thing — it has to come from somewhere. The tier decides what it costs and what a botched encode does to it.</div>`, 0)
    + (this._isEdit() ? '' : this._decRow('look', 'fa-palette', 'Look',
      `${esc(this._presetLabel())}<small>${this.S.boot.enabled
        ? esc(BOOT_STYLES.find(([k]) => k === this.S.boot.animationStyle)?.[1] || 'Fade in')
        : 'no startup'}</small>`, `
      <div class="ncm-enc-artrow">
        <div class="ncm-enc-artpick" data-enc="browseimg" data-tooltip="Choose any image">
          <img src="${esc(this._img())}" alt="">
        </div>
        <div class="ncm-enc-artopts">
          ${SHARD_ART.map(([file, label]) => `
            <span class="ncm-enc-artopt ${this._img() === GEAR_ART + file ? 'on' : ''}" data-enc="img:${file}" data-tooltip="${esc(label)}">
              <img src="${GEAR_ART + file}" alt="${esc(label)}"></span>`).join('')}
          <span class="ncm-enc-artopt ncm-enc-artopt--make" data-enc="designimg" data-tooltip="Design your own">
            <i class="fas fa-palette"></i></span>
        </div>
      </div>
      <div class="ncm-fw-grouplab" style="--gfam:var(--fam);margin-top:10px">How it reads when opened</div>
      <div class="ncm-enc-presets">
        ${this._presetCards()}
      </div>
      ${this._savedLookCards()}
      ${this._customLookCards()}

      <div class="ncm-fw-grouplab" style="--gfam:var(--fam);margin-top:10px">What it says when it starts up</div>
      <div class="ncm-enc-boot">
        <div class="ncm-enc-lbl" style="margin-top:0">
          <label for="encBootT">Title</label>
          <input id="encBootT" class="ncm-enc-inp" type="text" data-enc-in="bootTitle"
                 value="${esc(this.S.boot.title)}" placeholder="${esc(this._bootDefaults().title)}">
        </div>
        <div class="ncm-enc-lbl">
          <label for="encBootS">Under it</label>
          <input id="encBootS" class="ncm-enc-inp" type="text" data-enc-in="bootSub"
                 value="${esc(this.S.boot.subtitle)}" placeholder="${esc(this._bootDefaults().subtitle)}">
        </div>
        <div class="ncm-enc-lbl">
          <label>Animation</label>
          <div class="ncm-enc-presets">
            ${BOOT_STYLES.map(([k, l]) => `
              <span class="ncm-enc-preset ${this.S.boot.animationStyle === k ? 'on' : ''}" data-enc="bootanim:${k}">${esc(l)}</span>`).join('')}
          </div>
        </div>
        <div class="ncm-enc-lbl">
          <label>Speed</label>
          <div class="ncm-fw-seg" style="width:100%">
            ${BOOT_SPEEDS.map(([k, l]) => `
              <button type="button" data-enc="bootspeed:${k}" class="${this.S.boot.speed === k ? 'on' : ''}">${esc(l)}</button>`).join('')}
          </div>
        </div>
        <button type="button" class="ncm-enc-more" data-enc="bootoff">
          <i class="fas fa-${this.S.boot.enabled ? 'eye-slash' : 'eye'}"></i> ${this.S.boot.enabled ? 'Skip the startup entirely' : 'Bring the startup back'}</button>
      </div>
      <div class="ncm-fw-hint">The look is cosmetic — the artwork, the startup and the colours, not how hard it is to open. That is the Lock stage.</div>`, 2))
    + this._decRow('lbl', 'fa-tag', 'Label', esc(this._shardName()), `
      <div class="ncm-enc-lbl" style="margin-top:0">
        <label for="encLabel">Shard name</label>
        <input id="encLabel" class="ncm-enc-inp" type="text" data-enc-in="label" value="${esc(this.S.label)}" placeholder="${esc(item?.name || `Untitled ${T('short', 'lower')}`)}">
      </div>
      <div class="ncm-fw-hint">What it says on the chip. The icon comes from what you put on it.</div>`, 1);
  }

  // ── STAGE 2 · PROGRAM ────────────────────────────────────────────────────
  _railProgram() {
    const { rank, list, cur } = this._ability();
    const dv = this._dv(), o = this._odds();
    const fams = Object.entries(PROGRAM_FAMILIES).filter(([k]) => this.cfg.programs?.families?.[k] !== false);

    const famBody = `
      <div class="ncm-fw-seg" style="width:100%">${fams.map(([k, f]) =>
        `<button type="button" data-enc="fam:${k}" class="${this.S.family === k ? 'on' : ''}">${esc(f.label)}</button>`).join('')}</div>
      <div class="ncm-fw-hint">${esc(PROGRAM_FAMILIES[this.S.family]?.hint || '')}</div>`;

    const abBody = `
      <div class="ncm-fw-chips">${list.map((a) => {
        const info = abilityInfo(a.key);
        return `<span class="ncm-fw-chip ${a.key === this.S.ability ? 'on' : ''} ${a.locked ? 'is-lock' : ''}" data-enc="ab:${a.key}">
          <i class="${esc(info.icon)}"></i>${esc(info.label)}<span class="dv">DV ${a.dv}</span>
          ${a.locked ? `<span class="need">${esc(shortSk(this.cfg.programs.skill))} ${a.needRank}+</span>` : ''}</span>`;
      }).join('') || '<div class="ncm-fw-hint">Your GM has turned this family off.</div>'}</div>
      <div class="ncm-fw-hint">${esc(abilityInfo(this.S.ability)?.blurb || '')} · greyed abilities need a higher rank</div>`;

    const skBody = `
      <div class="ncm-enc-sk">${craftChoices(this.cfg, this.S.ability).map((c) => {
        const cdv = programDV(this.cfg, { ability: this.S.ability, craft: c.skill, disguised: !!this.S.disguise });
        const co = ladderOdds(this._skill(c.skill).total + this._bonuses().total, cdv);
        return `<span class="ncm-fw-chip ${c.skill === this.S.craft ? 'on' : ''} ${c.recommended ? 'is-rec' : ''} ${c.applies ? '' : 'is-lock'}" data-enc="sk:${esc(c.skill)}">
          <span>${esc(shortSk(c.skill))}</span>
          <span class="ncm-enc-sk__tot">${co.base}</span>
          <span class="ncm-enc-sk__dv">vs ${cdv}</span>
          ${c.penalty ? `<span class="ncm-enc-sk__pen">+${c.penalty}</span>` : ''}
          ${c.applies ? `<span class="ncm-enc-odds ${oddsClass(co.clean)}">${co.clean}%</span>` : '<span class="need">not for this</span>'}</span>`;
      }).join('')}</div>
      <div class="ncm-fw-hint">★ the right tool has no penalty — another trade can jury-rig it at a higher DV${this.S.disguise ? ' · the cover adds +' + (this.cfg.programs.disguiseDV || 2) : ''}</div>`;

    return this._decRow('fam', 'fa-layer-group', 'Family', esc(PROGRAM_FAMILIES[this.S.family]?.label || '—'), famBody, 0)
      + this._decRow('ab', 'fa-bolt', 'Ability', `${esc(abilityInfo(this.S.ability)?.label || '—')}<small>DV ${cur?.dv ?? '—'}</small>`, abBody, 1)
      + this._decRow('sk', 'fa-hand-fist', 'Craft skill', `${esc(shortSk(this.S.craft))}<small>${o.base} vs ${dv} · ${o.clean}%</small>`, skBody, 2);
  }

  // ── STAGE 2 · CONTENT (the forged file) ──────────────────────────────────
  _railContent() {
    const types = this._types();
    const row = this._typeRow();
    const dv = this._dv();
    const o = this._odds();

    const tile = (t) => {
      const info = CONTENT_TYPE_INFO[t.key] || {};
      const tdv = contentDV(this.cfg, { type: t.key, craft: t.skill });
      const to = t.skill ? ladderOdds(this._skill(t.skill).total + this._bonuses().total, tdv) : null;
      return `<div class="ncm-enc-type ${t.key === this.S.type ? 'on' : ''}" data-enc="type:${t.key}">
        <div class="t"><i class="${esc(info.icon || 'fas fa-file')}"></i>${esc(info.label || t.key)}</div>
        <div class="m">${to
          ? `<span class="o ncm-enc-odds ${oddsClass(to.clean)}">${to.clean}%</span>`
          : '<span class="o" style="color:var(--ncm-text-muted)">no roll</span>'}
          ${t.skill ? `<span class="sk">${esc(shortSk(t.skill))} ${t.dv}</span>` : ''}</div>
      </div>`;
    };

    const progTiles = PROGRAM_TYPES.filter((k) => this.cfg.types?.[k]?.on).map((k) => {
      const info = CONTENT_TYPE_INFO[k] || {};
      return `<div class="ncm-enc-type prog" data-enc="toprogram:${k}">
        <div class="t"><i class="${esc(info.icon || 'fas fa-virus')}"></i>${esc(info.label || k)}</div>
        <div class="m"><span class="sk">→ build it instead</span></div></div>`;
    }).join('');

    const files = this._entries();
    const wrote = files.length > 0;
    const room = this._room();
    const stack = this._stack();
    const onChip = this._onChip();
    const contentsValue = wrote
      ? `${files.length} new file${files.length === 1 ? '' : 's'}<small>${onChip ? `+ ${onChip} already on it · ` : ''}${stack.extra ? `DV +${stack.extra}` : 'DV unchanged'}</small>`
      : onChip
        ? `<small>${onChip} file${onChip === 1 ? '' : 's'} already on it</small><small style="color:var(--ncm-warning)">nothing new yet</small>`
        : '<small style="color:var(--ncm-warning)">nothing written yet</small>';

    return this._decRow('type', 'fa-file', 'File type',
      row ? `${esc(CONTENT_TYPE_INFO[row.key]?.label || row.key)}${row.skill ? `<small>DV ${row.dv}</small>` : '<small>no roll</small>'}` : 'Not chosen', `
      <div class="ncm-enc-types">${types.map(tile).join('')}${progTiles}</div>
      <div class="ncm-fw-hint">The percentage is your chance of a clean forgery with that type. A message, a note or a cred drop needs no roll — there is nothing to fake.</div>`, 0)
    + this._decRow('write', 'fa-pen-nib', 'Contents', contentsValue, `
      ${wrote ? `<div class="ncm-enc-files">${files.map((e, i) => {
        const fi = CONTENT_TYPE_INFO[e.contentType] || {};
        return `<div class="ncm-enc-file">
          <i class="${esc(fi.icon || 'fas fa-file')}"></i>
          <span class="n">${esc(e.subject || fi.label || 'Untitled')}</span>
          <span class="t">${esc(fi.label || e.contentType || '')}</span>
          <i class="fas fa-pen ed" data-enc="editentry:${i}" data-tooltip="Rewrite this file (it replaces this one — use the button below to add another)"></i>
          <i class="fas fa-xmark rm" data-enc="discard:${i}" data-tooltip="Take it off the chip"></i>
        </div>`;
      }).join('')}</div>` : ''}
      <button type="button" class="ncm-fw-save2" style="width:100%" data-enc="${wrote ? 'addwrite' : 'write'}" ${room <= 0 ? 'disabled' : ''}>
        <i class="fas fa-${wrote ? 'plus' : 'pen-nib'}"></i> ${wrote ? 'Write another file' : 'Write the contents'}</button>
      <div class="ncm-fw-hint">${!row
        ? 'Pick a file type first.'
        : room <= 0
          ? `This chip is full — it holds ${this._isEdit() ? (Number(this._blank().item?.getFlag?.(MODULE_ID, 'config')?.capacity) || 0) : capacityOf(this._blank().tier).limit}. Take one off, or start on a bigger blank.`
          : wrote
            ? `Room for ${room === Infinity ? 'more' : room} more. Each file past the first adds <b>+${Math.max(0, Number(this.cfg.content?.extraEntryDV ?? 2))}</b> to the encode — they have to agree with each other.`
            : 'The real editor for this type opens in its own window. Nothing is written to the chip until the encode.'}</div>`, 1)
    + (this._needsRoll() ? this._decRow('sk', 'fa-hand-fist', 'Craft skill',
      `${esc(shortSk(this.S.craft))}<small>${o.base} vs ${dv} · ${o.clean}%</small>`, `
      <div class="ncm-enc-sk">${this._choices().map((c) => {
        const cdv = contentDV(this.cfg, { type: this.S.type, craft: c.skill });
        const co = ladderOdds(this._skill(c.skill).total + this._bonuses().total, cdv);
        return `<span class="ncm-fw-chip ${c.skill === this.S.craft ? 'on' : ''} ${c.recommended ? 'is-rec' : ''}" data-enc="sk:${esc(c.skill)}">
          <span>${esc(shortSk(c.skill))}</span>
          <span class="ncm-enc-sk__tot">${co.base}</span>
          <span class="ncm-enc-sk__dv">vs ${cdv}</span>
          ${c.penalty ? `<span class="ncm-enc-sk__pen">+${c.penalty}</span>` : ''}
          <span class="ncm-enc-odds ${oddsClass(co.clean)}">${co.clean}%</span></span>`;
      }).join('')}</div>
      <div class="ncm-fw-hint">★ the obvious trade has no penalty — another one can still pass it off, at a higher DV</div>`, 2) : '');
  }

  // ── STAGE · LOCK (optional) ──────────────────────────────────────────────
  _railLock() {
    const L = this.S.lock;
    const opts = this._lockOpts();
    const cryptoSkill = this.cfg.lock?.skill || 'Cryptography';
    const gateSkill = this.cfg.lock?.gateSkill || 'Electronics/Security Tech';

    const pwValue = L.password ? 'On<small>••••••••</small>' : 'Off';
    const encValue = L.encrypted
      ? `${L.blackIce ? 'Black ICE' : 'Standard ICE'}<small>DV ${L.dv}</small>`
      : 'Off';
    const failValue = L.keyItem
      ? `Key item<small>${esc(L.keyItem.name)}</small>`
      : LOCK_FAILURES[L.failure]?.label || 'Lock them out';

    // ① a password is just a secret — no skill, no roll, always available.
    const pwBody = `
      <div class="ncm-fw-seg" style="width:100%">
        <button type="button" data-enc="lockpw:off" class="${L.password ? '' : 'on'}">No password</button>
        <button type="button" data-enc="lockpw:on" class="${L.password ? 'on' : ''}">Password</button>
      </div>
      ${L.password ? `<div class="ncm-enc-lbl" style="margin-top:8px">
        <label for="encLockPw">The word</label>
        <input id="encLockPw" class="ncm-enc-inp mono" type="text" data-enc-in="lockpw" value="${esc(L.password)}">
      </div>
      <button type="button" class="ncm-enc-more" data-enc="lockgen"><i class="fas fa-dice"></i> Make one up</button>` : ''}
      <div class="ncm-fw-hint">No skill and no roll — a password is a secret you set. Anyone you tell can open it.</div>`;

    // ② the encryption roll sets a CEILING, never pass/fail.
    const encBody = `
      <div class="ncm-fw-seg" style="width:100%">
        <button type="button" data-enc="lockenc:off" class="${L.encrypted ? '' : 'on'}">Open</button>
        <button type="button" data-enc="lockenc:on" class="${L.encrypted ? 'on' : ''}">Encrypt it</button>
      </div>
      ${L.encrypted ? `
        ${opts.rolled ? `
          <div class="ncm-fw-grouplab" style="--gfam:var(--fam);margin-top:9px">How hard · your ceiling is DV ${opts.maxDV}</div>
          <div class="ncm-fw-chips">${opts.dvChoices.map((dv) => `
            <span class="ncm-fw-chip ${L.dv === dv ? 'on' : ''}" data-enc="lockdv:${dv}">DV ${dv}</span>`).join('')}</div>
          <div class="ncm-fw-icecards" style="margin-top:9px">
            <div class="ncm-fw-icecard ${L.blackIce ? '' : 'on'}" data-enc="lockice:std">
              <span class="ncm-fw-icecard__ic" ${L.blackIce ? '' : 'style="color:var(--fam)"'}><i class="fas fa-shield-halved"></i></span>
              <span class="ncm-fw-icecard__b"><span class="ncm-fw-icecard__n">Standard ICE</span>
                <span class="ncm-fw-icecard__d">it just refuses</span></span></div>
            <div class="ncm-fw-icecard ${L.blackIce ? 'on' : ''} ${opts.canBlackIce ? '' : 'is-lock'}" data-enc="lockice:black">
              <span class="ncm-fw-icecard__ic" ${L.blackIce ? 'style="color:var(--fam)"' : ''}><i class="fas fa-skull"></i></span>
              <span class="ncm-fw-icecard__b"><span class="ncm-fw-icecard__n">Black ICE</span>
                <span class="ncm-fw-icecard__d">${opts.canBlackIce ? 'it fights back' : (this.cfg.lock?.blackIce === false ? 'your GM does not allow it' : `needs a ${esc(shortSk(cryptoSkill))} roll of 15+`)}</span></span></div>
          </div>`
        : `<div class="ncm-fw-hint" style="margin-top:8px">Roll ${esc(shortSk(cryptoSkill))} once. The total is a <b>ceiling</b>, not a pass or a fail — a poor roll still locks the chip, just not as hard.</div>
           <button type="button" class="ncm-fw-save2" style="width:100%;margin-top:8px" data-enc="lockroll:crypto">
             <i class="fas fa-dice-d20"></i> Roll ${esc(shortSk(cryptoSkill))} ${this._skill(cryptoSkill).total}</button>`}` : ''}
      <div class="ncm-fw-hint">${opts.rolled ? `You rolled ${L.cryptoTotal} · ${esc(opts.rungLabel)} · anything up to DV ${opts.maxDV}` : 'Skip the whole stage and the chip opens for anyone.'}</div>`;

    // ③ what happens to whoever forces it — the hardware gates.
    const failBody = `
      <div class="ncm-fw-chips">${Object.entries(LOCK_FAILURES).map(([k, f]) => {
        const locked = f.needsRung && !opts.canDamage;
        return `<span class="ncm-fw-chip ${L.failure === k && !L.keyItem ? 'on' : ''} ${locked ? 'is-lock' : ''}" data-enc="lockfail:${k}">
          ${esc(f.label)}${locked ? `<span class="need">${esc(shortSk(gateSkill))} 10+</span>` : ''}</span>`;
      }).join('')}</div>
      <div class="ncm-fw-hint">${esc(LOCK_FAILURES[L.failure]?.hint || '')}</div>
      <div class="ncm-fw-grouplab" style="--gfam:var(--fam);margin-top:9px">Or hang it on something you carry</div>
      ${opts.gateRolled
        ? (opts.canKeyItem
          ? `<button type="button" class="ncm-fw-save2" style="width:100%" data-enc="lockkey">
               <i class="fas fa-id-card"></i> ${L.keyItem ? esc(L.keyItem.name) : 'Fit a key item'}</button>
             ${L.keyItem ? '<button type="button" class="ncm-enc-more" data-enc="lockkeyoff"><i class="fas fa-xmark"></i> No key item</button>' : ''}`
          : `<div class="ncm-fw-hint">You rolled ${L.gateTotal} — not enough to fit a reader. A key item needs 20+.</div>`)
        : `<button type="button" class="ncm-fw-save2" style="width:100%" data-enc="lockroll:gate">
             <i class="fas fa-dice-d20"></i> Roll ${esc(shortSk(gateSkill))} ${this._skill(gateSkill).total}</button>
           <div class="ncm-fw-hint">One roll covers both: a bite-back failure needs 10+, a key-item reader 20+.</div>`}`;

    return this._decRow('pw', 'fa-key', 'Password', pwValue, pwBody, 0)
      + this._decRow('enc', 'fa-shield-halved', 'Encryption', encValue, encBody, 1)
      + this._decRow('fail', 'fa-bolt', 'On failure', failValue, failBody, 2);
  }

  /** One line describing the lock, for the encode stage and the artifact card. */
  _lockSummary() {
    const L = this.S.lock;
    if (!lockIsSet(L)) return 'open';
    const bits = [];
    if (L.password) bits.push('password');
    if (L.encrypted) bits.push(`${L.blackIce ? 'Black ICE' : 'ICE'} DV ${L.dv}`);
    if (L.keyItem) bits.push(`key: ${L.keyItem.name}`);
    return bits.join(' · ');
  }

  _patchLock() {
    const L = this.S.lock;
    const opts = this._lockOpts();
    const set = lockIsSet(L);
    const cryptoSkill = this.cfg.lock?.skill || 'Cryptography';

    this._head(this._artName(), set
      ? `LOCK · ${L.encrypted ? `${L.blackIce ? 'Black ICE' : 'ICE'} DV ${L.dv}` : 'no encryption'}${L.password ? ' · password' : ''}${L.keyItem ? ' · key item' : ''}`
      : 'LOCK · optional · the chip is open', 'LOCK');
    this.g('encCoreIc').className = set ? 'fas fa-lock' : 'fas fa-lock-open';
    this.g('encCoreLbl').textContent = set ? 'SECURING' : 'OPEN';

    this._says(opts.rolled
      ? `You rolled <b class="v">${L.cryptoTotal}</b> — <b>${esc(opts.rungLabel)}</b>. You can set anything up to <b>DV ${opts.maxDV}</b>${opts.canBlackIce ? ', Black ICE included' : ''}.`
      : `${esc(shortSk(cryptoSkill))} <b class="v">${this._skill(cryptoSkill).total}</b> sets the ceiling. It is a <b>cap, not a check</b> — you cannot fail this roll, you can only find out how hard you can lock it.`,
      set ? '<i class="fas fa-lock"></i> whoever wants in has to get past this'
          : '<i class="fas fa-forward"></i> skip it and the chip opens for anyone');

    this.g('encBar').innerHTML = '';
    this.g('encLadder').innerHTML = `
      <div class="ncm-enc-rung c" style="grid-template-columns:1fr">
        <span>A lock roll sets a <b>ceiling</b>. A poor one still locks the chip — it just cannot lock it hard, and it cannot fight back.
          <small>${(this.cfg.lock?.ceilings || []).map((r) => `${r.at}+ → DV ${r.dv}`).join(' · ')}</small></span></div>
      <div class="ncm-enc-rung" style="grid-template-columns:1fr">
        <span>How well the contents are forged and how hard the box is locked are different questions, so they are different rolls on different skills.</span></div>`;
    this.g('encEff').innerHTML = `
      <div><b>Password</b><span>${L.password ? 'on' : '—'}</span></div>
      <div><b>ICE</b><span>${L.encrypted ? (L.blackIce ? 'Black' : 'Std') : '—'}</span></div>
      <div><b>DV cap</b><span>${opts.rolled ? opts.maxDV : '—'}</span></div>`;

    this._art(this._artName(), set ? 'locked · not yet encoded' : 'open · not yet encoded', [
      ['Opens with', L.password && L.encrypted ? 'password or a breach' : L.password ? 'the password' : L.encrypted ? 'a breach roll' : 'anyone'],
      ['Breach DV', L.encrypted ? String(L.dv) : '—'],
      ['On failure', L.keyItem ? `key item · ${L.keyItem.name}` : (LOCK_FAILURES[L.failure]?.label || '—')],
    ]);
    this._status(set
      ? `Locked · ${L.encrypted ? `DV ${L.dv}` : 'password only'} · press <b>Next</b> when you're done`
      : 'Optional · leave it open, or lock it down');
    this._hint('STAGE · LOCK · optional');
    this._setBuild(set ? 0.65 : 0.4);
  }

  // ── STAGE 3 · ENCODE ─────────────────────────────────────────────────────
  /**
   * "Who's helping?" — only when the GM switched assists on, and only when there
   * is a roll to help WITH (there is nothing to assist on a note).
   *
   * Candidates are the other player characters. Whether a given one is actually
   * worth anything is shown per chip rather than hidden: when the GM requires the
   * skill, someone without it is offered but marked as no help, so the player
   * learns the rule instead of wondering why the number did not move.
   */
  _assistSection(needs) {
    const a = this.cfg.optional?.assist;
    if (!a?.on || !needs) return '';
    const others = getPlayerCharacters().filter((c) => c.id !== this.actor?.id);
    if (!others.length) return '';

    const chips = others.map((c) => {
      const rank = game.nightcity?.skillService?.getSkillData?.(c, this.S.craft)?.skillLevel ?? 0;
      const useless = a.requireSkill && rank < 1;
      return `<span class="ncm-fw-chip ${this.S.assistId === c.id ? 'on' : ''} ${useless ? 'is-lock' : ''}"
                    data-enc="assist:${esc(c.id)}"
                    data-tooltip="${esc(useless ? `No rank in ${this.S.craft} — no help on this roll` : `${this.S.craft} ${rank}`)}">
        ${esc(c.name)}<span class="dv">${useless ? 'no help' : `+${a.bonus}`}</span></span>`;
    }).join('');

    return `
      <div class="ncm-fw-sec">
        <div class="ncm-fw-sec__t"><i class="fas fa-user-plus"></i><span>Anyone helping?</span></div>
        <div class="ncm-enc-sk">
          <span class="ncm-fw-chip ${this.S.assistId ? '' : 'on'}" data-enc="assist:">On my own</span>
          ${chips}
        </div>
      </div>`;
  }

  _railEncode() {
    const { item, tier, perk } = this._blank();
    const dv = this._dv(), o = this._odds(), b = this._botch();
    const needs = this._needsRoll();
    const where = this.S.srcMode === 'buy'
      ? `a bought ${tier?.name || 'blank'} (${tier?.price ?? 0} eb)`
      : this._isEdit() ? `${item?.name || '—'} (re-encode · ${this._onChip()} already on it)` : (item?.name || '—');
    const what = this._isProgram()
      ? abilityInfo(this.S.ability)?.label || ''
      : (CONTENT_TYPE_INFO[this.S.type]?.label || this.S.type || '');
    return this._assistSection(needs) + `
      <div class="ncm-fw-sec">
        <div class="ncm-fw-sec__t"><i class="fas fa-lock"></i><span>Locked in</span></div>
        <div class="ncm-enc-lockin">
          <div class="ncm-enc-kv"><span>${this._isProgram() ? 'Building' : 'Forging'}</span><b>${esc(what)}</b></div>
          <div class="ncm-enc-kv"><span>Called</span><b>${esc(this._artName())}</b></div>
          <div class="ncm-enc-kv"><span>Roll</span><b>${needs ? `${esc(shortSk(this.S.craft))} ${o.base} vs ${dv}` : 'none needed'}</b></div>
          ${perk && needs ? `<div class="ncm-enc-kv"><span>Blank perk</span><b>+${perk}</b></div>` : ''}
          ${(() => {
            // Name what is helping, and who. A silent +3 on the roll is a bonus
            // the player cannot check, argue with, or learn from.
            const b = this._bonuses();
            let out = '';
            if (needs && b.gear.bonus) out += `<div class="ncm-enc-kv"><span>${esc(b.gear.from.join(' + '))}</span><b>+${b.gear.bonus}</b></div>`;
            if (needs && b.assist) out += `<div class="ncm-enc-kv"><span>${esc(this._helper()?.name || 'Helper')} helping</span><b>+${b.assist}</b></div>`;
            const mins = this._timeCost();
            if (mins) out += `<div class="ncm-enc-kv"><span>Takes</span><b>${esc(formatMinutes(mins))}</b></div>`;
            return out;
          })()}
          <div class="ncm-enc-kv"><span>Onto</span><b>${esc(where)}</b></div>
          ${this._eddiesLoad() ? `<div class="ncm-enc-kv"><span>Costs you</span><b>${this._eddiesLoad()} eb</b></div>` : ''}
          <div class="ncm-enc-kv"><span>Locked</span><b>${esc(this._lockSummary())}</b></div>
          <div class="ncm-enc-kv"><span>If it fails</span><b>${needs ? esc(b.short) : 'it cannot'}</b></div>
        </div>
        <div class="ncm-fw-hint">${needs
          ? `One roll. Meet the DV for a clean result; miss by up to ${SLOPPY_BAND} and it still writes, badly; miss by more and nothing is written.`
          : 'Nothing to fake here — the write cannot fail, and the blank is never at risk.'}</div>
      </div>`;
  }

  // ── MANIFEST (Program stage) — name + description lead; options fold away ──
  _renderManifest() {
    const man = this.g('encMan'); if (!man) return;
    const info = abilityInfo(this.S.ability);
    const params = info?.params || [];
    const rank = this._rank(this.cfg.programs?.skill);
    const canDisguise = rank >= (this.cfg.programs?.disguiseRank ?? 4);

    man.hidden = false;
    man.classList.toggle('is-collapsed', this.S.manCollapsed);
    this.g('encCoreWrap').style.flex = this.S.manCollapsed ? '' : '0 0 168px';

    man.innerHTML = `
      <div class="ncm-enc-man__hd" data-enc="man">
        <i class="fas fa-file-code"></i> <b>MANIFEST</b> · what you're building
        <span class="r">${esc(this.S.family === 'execute' ? 'malware' : 'payload')} · ${esc(info?.label || '')}</span>
        <i class="fas fa-chevron-down tog"></i>
      </div>
      <div class="ncm-enc-man__sum">
        <b>${esc(this._name())}</b> <i>·</i> ${this.S.disguise ? 'disguised as ' + esc(this.S.disguise) : 'no disguise'}
        <i>·</i> ${params.length} parameter${params.length === 1 ? '' : 's'} <i>·</i> <span style="color:var(--fam)">click to expand</span>
      </div>
      <div class="ncm-enc-man__body">
        <div class="ncm-enc-fg">
          <div class="ncm-enc-f" style="--flex:1 1 170px"><label for="encName">Program name</label>
            <input id="encName" class="mono" type="text" data-enc-in="progName" value="${esc(this.S.progName)}" placeholder="${esc(this._defaultName())}">
            <span class="sub">what the file is called</span></div>
          <div class="ncm-enc-f" style="--flex:1 1 100%"><label for="encDesc">Description</label>
            <textarea id="encDesc" data-enc-in="description" placeholder="${esc(info?.blurb || '')}">${esc(this.S.description)}</textarea></div>
        </div>
        <button type="button" class="ncm-enc-more" data-enc="opt">
          <i class="fas fa-chevron-${this.S.optOpen ? 'up' : 'down'}"></i> Options · disguise</button>
        <div class="ncm-enc-fg ncm-enc-optbody" ${this.S.optOpen ? '' : 'hidden'}>
          <div class="ncm-enc-f ${canDisguise ? '' : 'is-lock'}" style="--fw:170px">
            <label for="encDisg">Disguise as <span style="color:var(--ncm-accent)">DV +${this.cfg.programs?.disguiseDV ?? 2}</span></label>
            <select id="encDisg" data-enc-sel="disguise" ${canDisguise ? '' : 'disabled'}>
              <option value="">none · reads as what it is</option>
              ${COVER_TYPES.map((c) => `<option value="${esc(c.value)}" ${this.S.disguise === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
            </select>
            <span class="sub">${canDisguise
              ? 'a scan has to beat the build quality to see through it'
              : `<span class="need">${esc(shortSk(this.cfg.programs.skill))} ${this.cfg.programs?.disguiseRank ?? 4}+</span> to hide it`}</span>
          </div>
        </div>
        ${params.length ? `
        <div class="ncm-enc-man__params">
          <div class="ncm-enc-man__hd"><i class="fas fa-sliders"></i> <b>${esc(String(info.label).toUpperCase())}</b> · parameters</div>
          <div class="ncm-enc-fg">${params.map((p) => this._paramField(p)).join('')}</div>
        </div>` : ''}
      </div>`;
  }

  _paramField(p) {
    const v = this.S.params[p.f] ?? p.def ?? '';
    const id = `encP-${p.f}`;
    const sub = p.hint ? `<span class="sub">${esc(p.hint)}</span>` : '';
    if (p.type === 'checkbox') {
      return `<div class="ncm-enc-f" style="--fw:150px"><label for="${id}">${esc(p.label)}</label>
        <input id="${id}" type="checkbox" data-enc-in="param" data-f="${esc(p.f)}" ${v ? 'checked' : ''}>${sub}</div>`;
    }
    if (p.type === 'ice') {
      const ice = (game.actors?.filter((a) => a.type === 'blackIce' || a.type === 'black-ice'
        || a.getFlag?.(MODULE_ID, 'isBlackICE') || a.name?.toLowerCase().includes('black ice')) ?? []);
      return `<div class="ncm-enc-f" style="--fw:190px"><label for="${id}">${esc(p.label)}</label>
        <select id="${id}" data-enc-sel="param" data-f="${esc(p.f)}">
          <option value="">the box's own ICE, if it has any</option>
          ${ice.map((a) => `<option value="${a.id}" ${v === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>${sub}</div>`;
    }
    const type = p.type === 'number' ? 'number' : 'text';
    return `<div class="ncm-enc-f" style="--fw:${p.type === 'number' ? '96px' : '150px'}"><label for="${id}">${esc(p.label)}</label>
      <input id="${id}" type="${type}" class="${p.type === 'number' ? '' : 'mono'}" data-enc-in="param" data-f="${esc(p.f)}" value="${esc(v)}">${sub}</div>`;
  }

  /**
   * Open the REAL entry composer in player mode. It collects instead of persisting:
   * the Encoder keeps the entry and only the encode roll decides if it is ever written.
   */
  async _openEditor() {
    const row = this._typeRow();
    if (!row) { ui.notifications?.warn('NCM | Pick a file type first.'); return; }
    // The composer owns one window id, so a second one would fight the first for
    // the same slot. Finish the file you are on.
    if (this._composer?.rendered) {
      ui.notifications?.warn('NCM | Finish the file you are writing first.');
      this._composer.bringToFront?.();
      return;
    }
    const { item } = this._blank();
    // Captured NOW: -1 means this is a new file, and nothing the rail does while
    // the composer is open can turn it into an overwrite.
    const slot = this.S.editIndex;
    const { PlayerEntryComposer } = await import('./PlayerEntryComposer.js');
    this._composer = new PlayerEntryComposer({
      item: item || this._blank().item,
      type: row.key,
      entry: slot >= 0 ? this.S.entries[slot] : null,
      allowedTypes: this._types().map((t) => t.key),
      onCollect: (entry) => {
        // The composer's own "Change type" can swap the type out from under us.
        // The roll must follow what was actually WRITTEN, not what was picked in
        // the rail — otherwise a message rewritten as a dossier would still be
        // forged at the message's (nonexistent) DV.
        this._adoptEntryType(entry);
        if (slot >= 0 && this.S.entries[slot]) this.S.entries[slot] = entry;
        else this.S.entries.push(entry);
        this.S.editIndex = -1;
        this._syncCraft();
        this.S.dec = this._needsRoll() ? 'sk' : null;
        this._renderRail({ enter: false });
        this._patch();
      },
    });
    this._composer.render(true);
  }

  /** Any image at all — the quick picks are a shortcut, not a limit. */
  async _browseImage() {
    try {
      const fp = new FilePicker({
        type: 'image',
        current: this._img(),
        callback: (path) => { this.S.img = path; this._renderRail({ enter: false }); this._patch(); },
      });
      fp.render(true);
    } catch (err) { log.warn('Encoder: the file picker is unavailable', err); }
  }

  /**
   * Design the chip and bake it into the item's picture. The builder hands back a
   * PNG data URI, which needs no upload permission and travels with the item.
   */
  async _designImage() {
    try {
      const { runIconBuilder } = await import('./ShardIconBuilder.js');
      const made = await runIconBuilder({
        host: this.element,
        image: this.S.img && !this.S.img.startsWith('data:') ? this.S.img : '',
      });
      if (!made) return;
      this.S.img = made;
      this._renderRail({ enter: false });
      this._patch();
      ui.notifications?.info('NCM | Chip designed — it goes on the item when you encode.');
    } catch (err) {
      log.error('Encoder: the icon builder failed', err);
      ui.notifications?.error('NCM | The designer could not open — see the console.');
    }
  }

  /** A throwaway passphrase, so nobody has to invent one at the table. */
  _makePassword() {
    const words = ['ronin', 'kestrel', 'chrome', 'static', 'halcyon', 'mirror', 'vector', 'nomad', 'ember', 'cinder', 'tessera', 'harbour'];
    const w = () => words[Math.floor(Math.random() * words.length)];
    return `${w()}-${w()}-${Math.floor(10 + Math.random() * 89)}`;
  }

  /**
   * A lock roll. This one CANNOT be failed — the total is a ceiling, so a poor
   * roll narrows what you may set rather than costing you anything.
   */
  async _rollLock(which) {
    if (this.S.busy) return;
    const skill = which === 'gate'
      ? (this.cfg.lock?.gateSkill || 'Electronics/Security Tech')
      : (this.cfg.lock?.skill || 'Cryptography');
    if (!this.actor) { ui.notifications?.warn('NCM | No operator — pick a character first.'); return; }
    this.S.busy = true; this._patchFooter();
    try {
      const res = await game.nightcity?.skillService?.performCheck(this.actor, skill, {
        dc: 0, showChat: true, context: `${T('short')} Encoder`,
        flavor: which === 'gate' ? 'Fitting the lock hardware' : 'Setting the encryption',
      });
      if (!res) throw new Error('The roll could not be made.');
      if (which === 'gate') this.S.lock.gateTotal = res.total;
      else {
        this.S.lock.cryptoTotal = res.total;
        const opts = this._lockOpts();
        this.S.lock.dv = Math.min(this.S.lock.dv || opts.maxDV, opts.maxDV);
        if (this.S.lock.blackIce && !opts.canBlackIce) this.S.lock.blackIce = false;
      }
      this._playTone('shard-compile');
      this._renderRail({ enter: false });
      this._patch();
    } catch (err) {
      log.error('Encoder: lock roll failed', err);
      ui.notifications?.error(`NCM | ${err.message}`);
    } finally {
      this.S.busy = false; this._patchFooter();
    }
  }

  /**
   * Hang the lock on something the operator carries — the shared picker on the
   * PLAYER theme (`admin: false`), chips per gear type. Its own copy filtered
   * rows with the `hidden` attribute, which the burn-row `display:flex` rule
   * beats, so the search box here never filtered anything.
   */
  async _pickKeyItem() {
    const carried = (this.actor?.items?.contents ?? []).filter(isCarrier);
    if (!carried.length) { ui.notifications?.warn('NCM | You are carrying nothing that could work as a key.'); return; }
    const pick = await showNamePicker({
      admin: false,
      title: 'Fit a key item',
      hint: 'Whoever holds this opens the chip without a roll. Pick something you can afford to hand over.',
      entries: documentEntries(carried, { group: (i) => this._typeLabel(i.type), note: (i) => this._typeLabel(i.type) }),
      selected: this.S.lock.keyItem?.id || '',
      placeholder: 'search your gear…',
    });
    const it = pick?.id ? carried.find((i) => i.id === pick.id) : null;
    if (!it) return;
    this.S.lock.keyItem = { id: it.id, name: it.name, img: it.img || '' };
    this.S.lock.failure = 'lockout';
    this._renderRail({ enter: false });
    this._patch();
  }

  /**
   * Follow a type change made inside the composer. Anything the GM allows is
   * adopted silently; anything else (a type switched off mid-session, or a
   * program type) is refused with a reason rather than rolled at the wrong DV.
   * @returns {boolean} whether the entry's type is usable
   */
  _adoptEntryType(entry) {
    const next = entry?.contentType;
    if (!next || next === this.S.type) return true;
    const allowed = this._types().some((t) => t.key === next);
    if (!allowed) {
      const label = CONTENT_TYPE_INFO[next]?.label || next;
      ui.notifications?.warn(`NCM | Your GM does not allow ${label} on a player-made ${T('short', 'lower')} — it stays a ${CONTENT_TYPE_INFO[this.S.type]?.label || this.S.type}.`);
      entry.contentType = this.S.type;
      return false;
    }
    this.S.type = next;
    const row = this._typeRow();
    ui.notifications?.info(`NCM | Now forging a ${CONTENT_TYPE_INFO[next]?.label || next}${row?.skill ? ` — ${shortSk(row.skill)} vs DV ${row.dv}` : ' — no roll needed'}.`);
    return true;
  }

  /** The centre panel shows the forged file itself, through the shared renderer. */
  async _renderPreview() {
    const host = this.g('encDoc');
    if (!host) return;
    const shown = this.S.entries[this.S.previewIndex ?? (this.S.entries.length - 1)];
    if (this.S.stage !== 'build' || this._isProgram() || !shown) { host.hidden = true; return; }
    host.hidden = false;
    this.g('encCoreWrap').style.flex = '0 0 130px';
    const info = CONTENT_TYPE_INFO[shown.contentType] || {};
    this.g('encDocT').textContent = (info.label || 'File').toUpperCase();
    const n = this.S.entries.length;
    this.g('encDocSub').textContent = (shown.subject || '') + (n > 1 ? `  ·  ${n} files on the chip` : '');
    try {
      const enriched = enrichContent({ ...shown }, { isGM: false, interactive: false });
      const rt = foundry.applications?.handlebars?.renderTemplate || renderTemplate;
      this.g('encDocBody').innerHTML = await rt(TEMPLATES.CONTENT_BODY, enriched);
    } catch (err) {
      log.warn('Encoder: preview failed', err);
      this.g('encDocBody').innerHTML = '<div class="ncm-fw-hint">The preview could not be drawn — the file itself is fine.</div>';
    }
  }

  // ── OPERATOR card ────────────────────────────────────────────────────────
  _renderOperator() {
    const nameEl = this.g('encOpName');
    if (nameEl) nameEl.textContent = this.actor ? `Operator · ${this.actor.name}` : 'No operator';
    const rows = this.g('encOpRows'); if (!rows) return;
    const stageSkills = this.S.stage === 'blank'
      ? []
      : [...new Set(this._choices().map((c) => c.skill).concat(this._isProgram() ? [this.cfg.programs?.skill] : []))].filter(Boolean);
    const all = [...new Set([...stageSkills, 'Forgery', 'Cryptography', 'Perception', 'Library Search', 'Accounting'])];
    const show = this.S.opAll ? all : stageSkills;
    this.g('encOpCard').hidden = !this.actor;
    this.g('encOpAll').hidden = this.S.opAll || !show.length || show.length >= all.length;
    if (!show.length) {
      rows.innerHTML = '<div class="ncm-fw-hint" style="margin:0">Nothing is rolled on this stage. Everything you encode goes onto <b>'
        + esc(this.actor?.name || 'this character') + '</b>.</div>';
      return;
    }
    rows.innerHTML = show.map((sk, i) => {
      const s = this._skill(sk);
      return `<div class="ncm-enc-op ${sk === this.S.craft ? 'is-craft' : ''}" style="--i:${i}">
        <span class="ncm-enc-op__k">${esc(shortSk(sk))}</span>
        <span class="ncm-enc-op__v"><small>${esc(s.stat)} ${s.statValue} + ${s.level} =</small>${s.total}</span>
        <span class="ncm-enc-op__pips">${Array.from({ length: 10 }, (_, j) => `<i class="${j < s.level ? 'on' : ''}"></i>`).join('')}</span>
      </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PATCH — everything that changes without rebuilding the rail
  // ═══════════════════════════════════════════════════════════════════════
  _patch() {
    if (!this.g('encRoot')) return;
    const S = this.S;
    if (S.stage === 'blank') this._patchBlank();
    else if (S.stage === 'build') (this._isProgram() ? this._patchProgram() : this._patchContent());
    else if (S.stage === 'lock') this._patchLock();
    else this._patchEncode();
    this._patchDetails();
    this._patchFooter();
  }

  _patchBlank() {
    const { item, tier } = this._blank();
    const b = tier ? this._botch() : null;
    const name = this._shardName();
    if (this._isEdit() && item) {
      // Re-encode: the chip is not empty, and that is the whole point.
      const on = this._onChip();
      const cap = Number(item.getFlag(MODULE_ID, 'config')?.capacity) || 0;
      this._head(name, `RE-ENCODE · ${on} file${on === 1 ? '' : 's'} on it${cap ? ` · holds ${cap}` : ''}`, 'RE-ENCODE');
      this.g('encCoreIc').className = 'fas fa-pen-nib';
      this.g('encCoreLbl').textContent = 'IN USE';
      this._says('No roll here. This chip already carries files — the roll is about what you <b>add</b>, and it re-stamps how convincing the whole chip is.',
        '<i class="fas fa-arrow-right"></i> next: what goes on it');
      this.g('encBar').innerHTML = ''; this.g('encLadder').innerHTML = '';
      this.g('encEff').innerHTML = `
        <div><b>On it</b><span>${on}</span></div>
        <div><b>Room</b><span>${cap ? Math.max(0, cap - on) : '∞'}</span></div>
        <div><b>On a botch</b><span style="font-size:calc(10px * var(--ncm-text-scale,1) * var(--ncm-lg-text,1))">unchanged</span></div>`;
      this._art(name, `${on} file${on === 1 ? '' : 's'} · re-encoding`, [
        ['Source', `your ${T('short', 'lower')}`],
        ['On it', `${on} file${on === 1 ? '' : 's'}`],
        ['Holds', cap ? `${cap} entries` : 'no limit'],
        ['On a botch', 'unchanged'],
      ]);
      this._status(`${T('short')} ready · name it, then pick what to add`);
      this._hint('STAGE 1 · RE-ENCODE · no roll');
      return;
    }
    this._head(name, tier ? `BLANK · ${tier.name} · nothing on it yet` : 'BLANK · pick something to write on', 'BLANK');
    this.g('encCoreIc').className = 'fas fa-microchip';
    this.g('encCoreLbl').textContent = 'EMPTY';
    this._says('No roll here. A blank is a chip and a label — the roll is about what goes <b>on</b> it.',
      '<i class="fas fa-arrow-right"></i> next: what goes on it');
    this.g('encBar').innerHTML = '';
    this.g('encLadder').innerHTML = '';
    this.g('encEff').innerHTML = `
      <div><b>Content</b><span style="color:var(--ncm-text-muted)">—</span></div>
      <div><b>Holds</b><span>${tier ? (capacityOf(tier).unlimited ? '∞' : capacityOf(tier).limit) : '—'}</span></div>
      <div><b>On a botch</b><span style="font-size:calc(10px * var(--ncm-text-scale,1) * var(--ncm-lg-text,1))">${esc(b?.short || '—')}</span></div>`;
    this._art(name, tier ? `${tier.name} blank · empty` : 'no blank chosen', [
      ['Source', this.S.srcMode === 'buy' ? 'bought' : (item ? 'inventory item' : '—')],
      ['Tier', tier ? tier.name + (tier.perk ? ' · ' + TIER_PERKS[tier.perk].label : '') : '—'],
      ['Holds', tier ? (capacityOf(tier).unlimited ? 'no limit' : `${capacityOf(tier).limit} entries`) : '—'],
      ['On a botch', b?.short || '—'],
    ]);
    this._status(tier ? 'Blank ready · name it, then pick what goes on it' : 'Pick something to write on');
    this._hint('STAGE 1 · BLANK · no roll');
  }

  _patchProgram() {
    const { cur } = this._ability();
    const dv = this._dv(), o = this._odds();
    const eff = programForecast(this.cfg, { base: o.base, dv, rank: this._rank(this.cfg.programs?.skill) });
    const [rung, pct] = likelyRung(o);
    const info = abilityInfo(this.S.ability);
    const b = this._botch();

    this._head(this._name(),
      `${String(this.S.family).toUpperCase()} · ${String(info?.label || '').toLowerCase()}${this.S.disguise ? ' · disguised as ' + this.S.disguise : ''}`,
      String(this.S.family).toUpperCase());
    this.g('encCoreIc').className = info?.icon || 'fas fa-microchip';
    this.g('encCoreLbl').textContent = 'BUILDING';

    const tail = rung === 'clean'
      ? ` — ${eff.charges} charge${eff.charges > 1 ? 's' : ''}, and a scan needs DV ${eff.stealthLo}–${eff.stealthHi} to spot it.`
      : rung === 'sloppy'
        ? ' — one charge and a tell a sweep will see.'
        : ` — nothing compiles and ${b.short}.`;
    this._says(`${esc(shortSk(this.S.craft))} <b class="v">${o.base}</b> vs DV <b class="v">${dv}</b>. Most likely a <b>${rung}</b> build (${pct}%)${tail}`,
      `<i class="fas fa-dice"></i> clean ${o.clean}% · sloppy ${o.sloppy}% · rejected ${o.rejected}%`);
    this._ladder(o, dv, eff, b);
    this._art(this._name(), `${this.S.family === 'execute' ? 'malware' : 'payload'} · not yet encoded`, [
      ['Writes as', this.S.family === 'execute' ? 'malware · a resident' : 'payload · a program'],
      ['Deck slot', String(this.S.family).toUpperCase()],
      ...(this.S.disguise ? [['Reads as', this.S.disguise + ' (cover)']] : []),
    ]);
    this._status(`${esc(shortSk(this.S.craft))} <b>${o.base}</b> vs DV <b>${dv}</b> · clean ${o.clean}% / sloppy ${o.sloppy}% / rejected ${o.rejected}%`);
    this._hint(`STAGE 2 · PROGRAM · ${esc(String(info?.label || '').toUpperCase())} · ${esc(shortSk(this.cfg.programs.skill))} rank ${this._rank(this.cfg.programs?.skill)}`);
    this._setBuild(0.45);
  }

  _patchContent() {
    const row = this._typeRow();
    const info = row ? (CONTENT_TYPE_INFO[row.key] || {}) : {};
    const dv = this._dv();
    const b = this._botch();
    const files = this._entries();
    const wrote = files.length > 0;
    const stack = this._stack();
    // With several files the header describes the CHIP, not the last type picked.
    const head = files.length > 1
      ? `${files.length} FILES${this._needsRoll() ? ` · ${shortSk(this.S.craft)} vs DV ${dv}` : ''}`
      : row ? `${String(info.label || row.key).toUpperCase()}${this._needsRoll() ? ` · ${shortSk(this.S.craft)} vs DV ${dv}` : ' · no roll'}`
        : 'CONTENT · pick what goes on it';

    this._head(this._artName(), head,
      files.length > 1 ? 'CONTENT' : (row ? String(info.label || row.key).toUpperCase() : 'CONTENT'));
    this.g('encCoreIc').className = info.icon || 'fas fa-file';
    this.g('encCoreLbl').textContent = wrote ? 'READY' : 'EMPTY';
    this._renderPreview();

    if (!row) {
      this._says('Pick what goes on the chip. Each type is forged with a different trade, so what you can fake convincingly depends on who you are.',
        '<i class="fas fa-arrow-right"></i> then write it');
      this.g('encBar').innerHTML = ''; this.g('encLadder').innerHTML = '';
      this.g('encEff').innerHTML = '<div><b>Type</b><span style="color:var(--ncm-text-muted)">—</span></div><div><b>Written</b><span style="color:var(--ncm-text-muted)">—</span></div><div><b>Roll</b><span style="color:var(--ncm-text-muted)">—</span></div>';
    } else if (!this._needsRoll()) {
      const load = this._eddiesLoad();
      if (load) {
        const have = this.actor?.system?.wealth?.value ?? 0;
        this._says(`A cred drop is money <b>moved</b>, not made: <b class="v">${load} eb</b> comes out of ${esc(this.actor?.name || 'your')}'s own wealth when you encode it. ${have < load ? '<b style="color:var(--ncm-danger)">More than you have.</b>' : `You have ${have} eb.`}`,
          '<i class="fas fa-coins"></i> taken when it is written, not before');
      } else {
        this._says(`A ${esc(String(info.label || row.key).toLowerCase())} needs <b>no roll</b> — there is nothing to fake. Write it and it goes on the chip as it is.`,
          '<i class="fas fa-check"></i> no check, no risk to the blank');
      }
      this.g('encBar').innerHTML = ''; this.g('encLadder').innerHTML = '';
      const have = this.actor?.system?.wealth?.value ?? 0;
      this.g('encEff').innerHTML = load
        // For a cred drop the only numbers that matter are the money ones.
        ? `<div><b>Loaded</b><span>${load}</span></div>
           <div><b>You have</b><span>${have}</span></div>
           <div><b>After</b><span style="${have - load < 0 ? 'color:var(--ncm-danger)' : ''}">${have - load}</span></div>`
        : `<div><b>Type</b><span>${esc(info.label || row.key)}</span></div>
           <div><b>Written</b><span>${wrote ? 'yes' : 'not yet'}</span></div><div><b>Roll</b><span>none</span></div>`;
    } else {
      const o = this._odds();
      const f = contentForecast(this.cfg, { base: o.base, dv });
      const [rung, pct] = likelyRung(o);
      const tail = rung === 'clean'
        ? ` — a scan would need DV ${f.scanLo}–${f.scanHi} to call it fake.`
        : rung === 'sloppy' ? ' — it passes at a glance, but a scan will call it forged.'
          : ` — the fake falls apart and ${b.short}.`;
      const crowd = stack.extra
        ? ` ${files.length} files have to agree, which is <b>+${stack.extra}</b> on the DV.`
        : '';
      this._says(`${esc(shortSk(this.S.craft))} <b class="v">${o.base}</b> vs DV <b class="v">${dv}</b>. Most likely a <b>${rung}</b> forgery (${pct}%)${tail}${crowd}`,
        `<i class="fas fa-dice"></i> clean ${o.clean}% · sloppy ${o.sloppy}% · rejected ${o.rejected}%`);
      this._contentLadder(o, dv, f, b);
    }

    const load = this._eddiesLoad();
    this._art(this._artName(), wrote
      ? `${esc(info.label || 'file')} · written, not yet encoded`
      : (row ? 'nothing written yet' : 'no file chosen'), [
      ['Writes as', files.length > 1 ? `${files.length} files` : (row ? `${info.label || row.key} · a file` : '—')],
      ['Forged with', row?.skill ? shortSk(this.S.craft) : 'no roll'],
      ...(load ? [['Costs you', `${load} eb`]] : []),
      ['On a botch', b?.short || '—'],
    ]);
    this._status(row && this._needsRoll()
      ? `${esc(shortSk(this.S.craft))} <b>${this._odds().base}</b> vs DV <b>${dv}</b> · ${wrote ? 'ready to encode' : 'write the contents'}`
      : (row ? (wrote ? 'Ready to encode · no roll needed' : 'Write the contents') : 'Pick a file type'));
    this._hint(`STAGE 2 · CONTENT${row ? ` · ${String(info.label || row.key).toUpperCase()}` : ''}`);
    this._setBuild(wrote ? 0.55 : 0.25);
  }

  /** The forgery ladder — the same three rungs, in the language of a fake. */
  _contentLadder(o, dv, f, botch) {
    this.g('encBar').innerHTML = `<i class="c" style="width:${o.clean}%"></i><i class="s" style="width:${o.sloppy}%"></i><i class="r" style="width:${o.rejected}%"></i>`;
    const hit = this.S.result?.outcome || '';
    const rung = (cls, key, tag, body, small, pct) => `
      <div class="ncm-enc-rung ${cls} ${hit === key ? 'is-hit' : ''}">
        <span class="ncm-enc-rung__tag">${tag}</span>
        <span>${body}<small>${small}</small></span>
        <span class="ncm-enc-rung__pct">${pct}%</span></div>`;
    this.g('encLadder').innerHTML =
      rung('c', 'clean', 'CLEAN', `it holds up · a scan needs DV ${f.scanLo}–${f.scanHi}`, 'you meet the DV', o.clean)
      + rung('s', 'sloppy', 'SLOPPY', 'it lands, but a scan calls it FORGED', 'you miss by up to 4', o.sloppy)
      + rung('r', 'rejected', 'REJECTED', `the fake falls apart · ${esc(botch.short)}`, 'you miss by 5 or more', o.rejected);
    this.g('encEff').innerHTML = `
      <div><b>Quality</b><span>${f.qualityLo}–${f.qualityHi}</span></div>
      <div><b>Scan DV</b><span>${f.scanLo}–${f.scanHi}</span></div>
      <div><b>Tell</b><span>none</span></div>`;
  }

  _patchEncode() {
    const dv = this._dv(), o = this._odds(), R = this.S.result;
    const needs = this._needsRoll();
    const icon = this._isProgram()
      ? abilityInfo(this.S.ability)?.icon
      : CONTENT_TYPE_INFO[this.S.type]?.icon;
    this._head(this._artName(), needs ? `ENCODE · ${esc(shortSk(this.S.craft))} vs DV ${dv}` : 'ENCODE · no roll needed', 'ENCODE');
    this.g('encCoreIc').className = icon || 'fas fa-microchip';
    if (!R) {
      if (needs) {
        this._says(`One roll: ${esc(shortSk(this.S.craft))} <b class="v">${o.base}</b> vs DV <b class="v">${dv}</b>. Commit when you're ready.`,
          `<i class="fas fa-dice"></i> clean ${o.clean}% · sloppy ${o.sloppy}% · rejected ${o.rejected}%`);
        const botch = this._botch();
        if (this._isProgram()) this._ladder(o, dv, programForecast(this.cfg, { base: o.base, dv, rank: this._rank(this.cfg.programs?.skill) }), botch);
        else this._contentLadder(o, dv, contentForecast(this.cfg, { base: o.base, dv }), botch);
      } else {
        this._says('Nothing to fake, nothing to roll. Press <b>Encode</b> and it goes on the chip as you wrote it.',
          '<i class="fas fa-check"></i> the blank is never at risk');
        this.g('encBar').innerHTML = ''; this.g('encLadder').innerHTML = '';
        this.g('encEff').innerHTML = '<div><b>Roll</b><span>none</span></div><div><b>Quality</b><span>—</span></div><div><b>Risk</b><span>none</span></div>';
      }
      const load = this._eddiesLoad();
      this._status(load
        ? `Ready · <b>${load} eb</b> comes out of ${esc(this.actor?.name || 'your')}'s wealth when you commit`
        : (needs ? 'Encoder armed · press <b>Encode</b> to commit' : 'Ready · press <b>Encode</b> to write it'));
      this._hint(`STAGE 3 · ENCODE · ${needs ? 'one roll' : 'no roll'}`);
      this.g('encCoreLbl').textContent = 'READY';
    }
    this._art(this._artName(), R ? this._artLine(R) : 'not yet encoded', [
      ['Roll', needs ? `${esc(shortSk(this.S.craft))} ${o.base} vs ${dv}` : 'none'],
      ['Onto', this._blank().tier?.name || '—'],
    ]);
  }

  _artLine(R) {
    if (R.outcome === 'rejected') return `nothing written · ${R.botch.short}`;
    if (this._isProgram()) {
      return `${this.S.family === 'execute' ? 'malware' : 'payload'} · ${R.eff.charges} charge${R.eff.charges > 1 ? 's' : ''} · scan DV ${R.eff.stealthDV} · run DV ${R.eff.runDV}${R.eff.tell ? ' · ' + R.eff.tell : ''}`;
    }
    const label = CONTENT_TYPE_INFO[this.S.type]?.label || 'file';
    return `${String(label).toLowerCase()} · quality ${R.eff.quality}% · a scan needs DV ${R.eff.scanDV}${R.eff.tell ? ' · ' + R.eff.tell : ''}`;
  }

  _head(name, sub, fam) {
    const n = this.g('encHdN');
    if (n && n.dataset.txt !== name) this._decode(n, name); else if (n) n.textContent = name;
    this.g('encHdS').textContent = sub;
    this.g('encHdFam').textContent = fam;
  }
  _says(html, timing) {
    this.g('encSays').innerHTML = html;
    this.g('encTiming').innerHTML = timing || '';
  }
  _status(html) { this.g('encStatus').innerHTML = html; }
  _hint(html) { this.g('encHint').innerHTML = html; }
  _pct(p) { this.g('encFill').style.width = p + '%'; this.g('encPct').textContent = p + '%'; }

  _ladder(o, dv, eff, botch) {
    this.g('encBar').innerHTML = `<i class="c" style="width:${o.clean}%"></i><i class="s" style="width:${o.sloppy}%"></i><i class="r" style="width:${o.rejected}%"></i>`;
    const hit = this.S.result?.outcome || '';
    const rung = (cls, key, tag, body, small, pctv) => `
      <div class="ncm-enc-rung ${cls} ${hit === key ? 'is-hit' : ''}">
        <span class="ncm-enc-rung__tag">${tag}</span>
        <span>${body}<small>${small}</small></span>
        <span class="ncm-enc-rung__pct">${pctv}%</span></div>`;
    this.g('encLadder').innerHTML =
      rung('c', 'clean', 'CLEAN', `${eff.charges} charge${eff.charges > 1 ? 's' : ''} · scan DV ${eff.stealthLo}–${eff.stealthHi} · run DV ${eff.runDV}`, 'you meet the DV', o.clean)
      + rung('s', 'sloppy', 'SLOPPY', '1 charge · scan DV 8 · a visible tell', 'you miss by up to 4', o.sloppy)
      + rung('r', 'rejected', 'REJECTED', `nothing compiles · ${esc(botch.short)}`, 'you miss by 5 or more', o.rejected);
    this.g('encEff').innerHTML = `
      <div><b>Charges</b><span>${eff.charges}</span></div>
      <div><b>Scan DV</b><span>${eff.stealthLo}–${eff.stealthHi}</span></div>
      <div><b>Run DV</b><span>${eff.runDV}</span></div>`;
  }

  _art(name, desc, kvs) {
    this.g('encArtN').textContent = name;
    this.g('encArtD').textContent = desc;
    this.g('encArtKv').innerHTML = kvs.map(([k, v]) => `<div class="ncm-enc-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  }

  _patchNames() {
    this.g('encHdN').dataset.txt = this._name();
    this.g('encHdN').textContent = this._name();
    this.g('encArtN').textContent = this._name();
    const sum = this.g('encMan')?.querySelector('.ncm-enc-man__sum b');
    if (sum) sum.textContent = this._name();
  }

  _patchDetails() {
    const open = this.S.detailsOpen;
    this.g('encDetails').hidden = !open;
    this.g('encMoreBtn').innerHTML = `<i class="fas fa-chevron-${open ? 'up' : 'down'}"></i> ${open ? 'Fewer numbers' : 'Show the numbers'}`;
  }

  _patchFooter() {
    const next = this.g('encNext'), back = this.g('encBack');
    const i = this._stageIndex();
    back.hidden = i === 0;                       // at stage 1 "Back" would just be Cancel again
    back.innerHTML = '<i class="fas fa-arrow-left"></i> Back';
    if (this.S.stage !== 'encode') {
      next.dataset.enc = 'next';
      const nxt = this._stages()[i + 1];
      next.innerHTML = `<i class="fas fa-arrow-right"></i> ${this.S.stage === 'lock' && !lockIsSet(this.S.lock) ? 'Skip' : 'Next'} · ${nxt ? esc(stageText(nxt, 'title', this.S.mode)) : ''}`;
      next.disabled = this.S.stage === 'blank' && !this._blank().tier;
      return;
    }
    const R = this.S.result;
    next.disabled = !!this.S.busy;
    if (!R) { next.dataset.enc = 'go'; next.innerHTML = '<i class="fas fa-bolt"></i> Encode'; return; }
    if (R.outcome !== 'rejected' && R.saved?.ok && this._madeItemId) {
      next.dataset.enc = 'open';
      next.innerHTML = '<i class="fas fa-folder-open"></i> Open it';
      return;
    }
    if (R.outcome === 'rejected') {
      next.dataset.enc = 'restart';
      next.innerHTML = R.botch.bricks ? '<i class="fas fa-rotate-right"></i> Start over · new blank' : '<i class="fas fa-rotate-right"></i> Try again · same blank';
      return;
    }
    next.dataset.enc = 'done';
    next.innerHTML = '<i class="fas fa-box"></i> Done';
  }

  _setBuild(v) { this._build = v; this.g('encRoot')?.style.setProperty('--build', v); }

  // ═══════════════════════════════════════════════════════════════════════
  //  THE ENCODE — one roll, six beats, then the write
  // ═══════════════════════════════════════════════════════════════════════
  async _runEncode() {
    const S = this.S;
    if (S.busy || S.result) return;
    const problem = this._permissionProblem();
    if (problem) { ui.notifications?.warn(`NCM | ${problem}`); return; }
    const { item, tier } = this._blank();
    const bonuses = this._bonuses();
    if (!tier) { ui.notifications?.warn('NCM | Pick something to write on first.'); return; }
    // Guard BEFORE anything irreversible: a player needs a GM to land the write.
    if (!this._canPersist()) return;
    const price = S.srcMode === 'buy' ? (tier.price || 0) : 0;
    const load = this._eddiesLoad();
    const wealth = this.actor?.system?.wealth?.value ?? 0;
    if (price + load > wealth) {
      ui.notifications?.warn(load
        ? `NCM | That is ${price + load} eb (${price ? `${price} for the blank plus ` : ''}${load} loaded onto it) and ${this.actor?.name || 'you'} has ${wealth} eb.`
        : `NCM | That blank costs ${price} eb and you have ${wealth} eb.`);
      return;
    }
    if ((S.srcMode === 'own' || this._isEdit()) && !item) { ui.notifications?.warn('NCM | That blank is gone — pick another.'); return; }
    if (!this._isProgram() && !this._entries().length) {
      ui.notifications?.warn(this._isEdit() ? 'NCM | Write something new onto it first — a re-encode with nothing added changes nothing.' : 'NCM | There is nothing written to encode.');
      return;
    }
    // Writing on something you already own renames it and can replace its
    // picture. Say so before the roll — removing the shard data later gives
    // both back, but the player should never find out by surprise.
    if (S.srcMode === 'own' && !this._isEdit() && item) {
      const newName = S.label && S.label !== item.name ? S.label : '';
      const newImg = this._img() !== item.img;
      if (newName || newImg) {
        const what = [newName ? `renamed to <b>${esc(newName)}</b>` : '', newImg ? 'its picture replaced' : ''].filter(Boolean).join(' and ');
        const ok = await playerConfirm({
          title: 'Write on this item?',
          content: `<p><b>${esc(item.name)}</b> becomes the shard: it will be ${what}.</p>
            <p style="opacity:.8;font-size:12px;">If the ${T('short', 'lower')} data is ever removed, the item gets its old name and picture back.</p>`,
        });
        if (!ok) return;
      }
    }

    // Last line of defence: the DV about to be rolled must cover everything
    // actually on the chip, whatever the rail happens to have selected.
    if (!this._isProgram()) { this._syncCraft(); this._patch(); }

    S.busy = true; this._patchFooter();
    const dv = this._dv();
    const motion = this._motion();
    const beat = motion === 'off' ? 0 : motion === 'calm' ? 0.5 : 1;

    try {
      // ── ARM ──
      if (this._needsRoll()) {
        this.g('encDie').classList.add('show');
        this.g('encDieSum').innerHTML = `${esc(shortSk(this.S.craft))} ${this._base()} + <b>d10</b>`;
      }
      this.g('encCoreLbl').textContent = 'ARMING';
      this.g('encCore').classList.add('saving');
      this._setBuild(0.55); this._pct(8);
      this._status(this._needsRoll()
        ? `Encoder armed · <b>${esc(shortSk(S.craft))} ${this._base()}</b> vs DV <b>${dv}</b>`
        : 'Encoder armed · writing it as you wrote it');
      this._playTone('shard-compile');
      if (beat && this._needsRoll()) { this.g('encDie').classList.add('rolling'); await this._tumble(900 * beat); }

      // ── ROLL (a type with no craft skill has nothing to fake — no check) ──
      const needsRoll = this._needsRoll();
      let res = { total: 0, margin: 0, processedRoll: 0, rollValue: 0 };
      if (needsRoll) {
        res = await game.nightcity?.skillService?.performCheck(this.actor, S.craft, {
          dc: dv, modifier: bonuses.total, showChat: true,
          context: `${T('short')} Encoder`, flavor: `Encoding ${this._artName()}`,
        });
        if (!res) throw new Error('The skill check could not be rolled.');
      }
      const outcome = needsRoll ? encodeOutcome(res.total, dv) : 'clean';
      const eff = this._isProgram()
        ? programEfficiency(this.cfg, { total: res.total, dv, rank: this._rank(this.cfg.programs?.skill) })
        : contentEfficiency({ total: res.total, dv: needsRoll ? dv : 0 });
      const botch = this._botch({ nat1: needsRoll && res.rollValue === 1 });

      this.g('encDie').classList.remove('rolling');
      if (needsRoll) {
        this.g('encDieCube').textContent = String(res.processedRoll ?? res.rollValue ?? '?');
        this.g('encDieSum').innerHTML = `${esc(shortSk(S.craft))} ${this._base()} + <b>${res.processedRoll}</b> = <b>${res.total}</b> · margin <span class="m">${res.margin >= 0 ? '+' : ''}${res.margin}</span>`;
        this.element.querySelectorAll('.ncm-enc-rung').forEach((r) => r.classList.remove('is-hit'));
        this.element.querySelector(`.ncm-enc-rung.${outcome[0]}`)?.classList.add('is-hit');
      } else {
        this.g('encDie').classList.remove('show');
      }
      this.g('encCoreLbl').textContent = needsRoll ? 'ROLLED' : 'WRITING';
      this._pct(22);
      if (beat) await wait(500 * beat);

      // ── COMPILE ──
      this.g('encCoreLbl').textContent = 'COMPILING';
      this._compiling = motion === 'full';
      this._setBuild(1);
      this.g('encCoreWrap').style.flex = '0 0 180px';
      this.g('encMan').hidden = true;
      this.g('encWrite').hidden = false;
      this._buildGrid();
      this._status(this._isProgram()
        ? `Compiling <b>${esc(this._artName())}</b> · linking · obfuscating`
        : `Laying down <b>${esc(this._artName())}</b> · matching headers · ageing metadata`);
      this._pct(45);
      this._playTone('hack-progress');
      await this._streamCode(1200 * beat);
      this._compiling = false;

      // ── WRITE (the real persistence lands here) ──
      this.g('encCoreLbl').textContent = 'WRITING';
      const end = outcome === 'rejected' ? 0.38 : 1;
      if (beat) await this._paintWrite(end, 1500 * beat); else this._paint(end);
      const saved = await this._persist({ outcome, eff, res, botch, price });

      if (outcome === 'rejected') {
        this.g('encSectors').classList.add('is-tear');
        this.g('encHash').innerHTML = 'CRC <span style="color:var(--ncm-danger)">FAIL</span> — WRITE ABORT';
      } else {
        if (outcome === 'sloppy') { [17, 41, 63, 88].forEach((i) => this._cells[i]?.classList.add('bad')); this.g('encSectors').classList.add('is-tear'); }
        this.g('encHash').textContent = `CRC ${foundry.utils.randomID(4).toUpperCase()}-${foundry.utils.randomID(4).toUpperCase()}`;
        // ── VERIFY ──
        this.g('encCoreLbl').textContent = 'VERIFYING';
        if (beat) { this.g('encScan').classList.add('run'); await wait(700 * beat); }
        this._cells.forEach((c) => { if (c.classList.contains('w') && !c.classList.contains('bad')) c.classList.add('ok'); });
        this._pct(92);
      }

      // ── TIME ──
      // Charged whatever the outcome: a rejected forgery still took the afternoon.
      await this._spendTime();

      // ── SEAL ──
      S.result = { outcome, eff, botch, total: res.total, dv, margin: res.margin, saved, rolled: needsRoll };
      this._seal(S.result);
    } catch (err) {
      log.error('Encoder: encode failed', err);
      ui.notifications?.error(`NCM | The encode failed: ${err.message}`);
      this._status(`<span style="color:var(--ncm-danger)">The encode failed.</span> ${esc(err.message)}`);
      this.g('encCore').classList.remove('saving');
      this.g('encCoreLbl').textContent = 'READY';
    } finally {
      S.busy = false;
      this._patchFooter();
    }
  }

  _seal(R) {
    const root = this.g('encRoot'), seal = this.g('encSeal'), core = this.g('encCore');
    core.classList.remove('saving');
    this.g('encDie').classList.remove('show');
    this.g('encCoreLbl').textContent = '';
    root.classList.add('res-' + R.outcome);
    this._refreshRGB();
    seal.classList.add('show', 'tone-' + R.outcome);
    this.g('encArt').classList.add('eject');
    this.g('encArt').querySelectorAll('.tag').forEach((t) => t.remove());
    this.g('encArt').insertAdjacentHTML('beforeend', `<span class="tag ${R.outcome}">${R.outcome}</span>`);

    const failedWrite = R.outcome !== 'rejected' && R.saved && !R.saved.ok;
    if (R.outcome === 'clean') {
      seal.innerHTML = `<i class="fas fa-check"></i> <span>SEALED · ${esc(this._artName().toUpperCase())}</span>`;
      if (this._motion() === 'full') { this._flareStart = performance.now(); core.classList.add('is-flare'); setTimeout(() => core.classList.remove('is-flare'), 800); }
      this._status(`<b style="color:var(--ncm-success)">${this._isProgram() ? 'CLEAN BUILD' : 'CLEAN FORGERY'}</b> · ${esc(this._artName())} written · it's in your gear`);
      this._playTone('shard-insert');
    } else if (R.outcome === 'sloppy') {
      seal.innerHTML = '<i class="fas fa-triangle-exclamation"></i> <span>GLITCHY BUILD</span>';
      if (this._motion() === 'full') core.classList.add('is-glitch');
      this._status(this._isProgram()
        ? '<b style="color:var(--ncm-warning)">SLOPPY BUILD</b> · it runs once · a sweep will spot it'
        : '<b style="color:var(--ncm-warning)">SLOPPY FORGERY</b> · it passes at a glance · a scan will call it fake');
      this._playTone('hack-success');
    } else {
      seal.innerHTML = '<i class="fas fa-xmark"></i> <span>REJECTED</span>';
      core.classList.add('is-dead');
      this._status(`<b style="color:var(--ncm-danger)">REJECTED</b> · missed by ${Math.abs(R.margin)} · ${esc(R.botch.short)}`);
      this._playTone('hack-fail');
    }
    if (failedWrite) {
      this._status(`<span style="color:var(--ncm-danger)">The roll landed but the ${T('short', 'lower')} could not be written.</span> ${esc(R.saved.error || '')}`);
    }
    this._pct(100);

    const tail = R.outcome === 'rejected'
      ? ` Nothing was written, and ${R.botch.short}.`
      : this._isProgram()
        ? ` ${R.eff.charges} charge${R.eff.charges > 1 ? 's' : ''}, a scan needs DV ${R.eff.stealthDV}, it runs at DV ${R.eff.runDV}.`
        : ` Quality ${R.eff.quality}%, and a scan needs DV ${R.eff.scanDV} to call it fake.`;
    const lede = R.rolled
      ? `Rolled <b class="v">${R.total}</b> vs DV <b class="v">${R.dv}</b> — a <b>${R.outcome}</b> ${this._isProgram() ? 'build' : 'forgery'}.`
      : 'Written as you wrote it — no roll was needed.';
    this._says(lede + tail, R.rolled ? `<i class="fas fa-dice"></i> margin ${R.margin >= 0 ? '+' : ''}${R.margin}` : '<i class="fas fa-check"></i> nothing to fake');
    this._art(this._artName(), this._artLine(R), [
      ['Result', R.outcome],
      ['Roll', R.rolled ? `${R.total} vs ${R.dv}` : 'none needed'],
      ...(R.outcome === 'rejected' ? [['The blank', R.botch.short]] : [['Quality', `${R.eff.quality}%`]]),
    ]);
    this._hint(R.outcome === 'rejected'
      ? (R.botch.bricks ? 'REJECTED · that blank is spent — start over with another' : 'REJECTED · the blank held — try again')
      : `ENCODED · it is in ${esc(this.actor?.name || 'your')}'s gear — Agent → ${T('shortMany', 'upper')}, or the inventory`);
    if (R.outcome !== 'rejected' && R.saved?.ok) this._renderMarket(R);
    this._patchFooter();
  }

  /**
   * MARKET — only ever at the seal: there is nothing to price until the thing exists.
   * The GM's mode decides how much say the player has, and in 'propose' the figure
   * does not touch the item until the GM says yes.
   */
  async _renderMarket(R) {
    const mode = this.cfg.pricing || 'propose';
    const card = this.g('encMktCard');
    if (!card || mode === 'off') return;
    const { suggestFor } = await import('./ShardMarket.js');
    const blankPrice = this._blank().tier?.price ?? 0;
    const suggested = suggestFor({ blankPrice, dv: R.dv, quality: R.eff.quality, outcome: R.outcome });
    if (this.S.price === undefined || this.S.price === null) this.S.price = suggested;

    card.hidden = false;
    this.g('encMktMode').textContent = { propose: 'your GM approves', free: 'you set it', formula: 'automatic' }[mode] || '';

    const state = this.S.priceState || '';
    const chip = {
      '': ['mute', mode === 'formula' ? 'priced' : 'not listed'],
      await: ['wait', 'waiting on your GM'],
      approved: ['ok', 'approved'],
      countered: ['ctr', 'countered'],
      denied: ['no', 'denied'],
      nogm: ['wait', 'no GM online'],
      pending: ['wait', 'no answer yet'],
    }[state] || ['mute', ''];

    const priced = Math.round(this.S.price);
    const note = {
      '': mode === 'propose' ? `Name a figure. It lands on the ${T('short', 'lower')} only once your GM approves it.`
        : mode === 'free' ? `Set it and it goes straight onto the ${T('short', 'lower')}.`
        : 'Your GM prices player work automatically.',
      await: `Your GM has the ask. Nothing is on the ${T('short', 'lower')} yet.`,
      approved: `Written to the ${T('short', 'lower')} — ` + priced + ' eb. A fixer or a shop reads that.',
      countered: 'Your GM countered at ' + priced + ' eb, and that is what it carries.',
      denied: 'Your GM said no. Sell it by hand, or ask again later.',
      nogm: `Nobody is on to approve it. The ${T('short', 'lower')} is still yours — try again when your GM is around.`,
      pending: 'No answer came back. Ask again when your GM is free.',
    }[state] || '';

    const locked = mode === 'formula' || ['await', 'approved', 'denied'].includes(state);
    const shown = Math.round(mode === 'formula' ? suggested : this.S.price);
    const btn = (mode === 'formula' || locked) ? '' :
      '<span class="ncm-fw-chip" data-enc="price"><i class="fas ' +
      (mode === 'free' ? 'fa-tag' : 'fa-paper-plane') + '"></i>' +
      (state === 'countered' ? 'Ask again' : mode === 'free' ? 'List it' : 'Propose') + '</span>';

    this.g('encMkt').innerHTML = 
      '<div class="ncm-enc-mkt__row">' +
        '<input type="number" id="encPrice" value="' + shown + '" min="0" ' + (locked ? 'disabled' : '') + '>' +
        '<span class="ncm-enc-mkt__eb">eb</span>' + btn +
        '<span class="ncm-enc-chip ' + chip[0] + '">' + esc(chip[1]) + '</span>' +
      '</div>' +
      '<div class="ncm-enc-mkt__sug">suggested <b>' + suggested + ' eb</b> · blank ' + blankPrice +
        ' + the work, scaled by how well it came out</div>' +
      (note ? '<div class="ncm-enc-mkt__note">' + esc(note) + '</div>' : '');

    const input = this.g('encPrice');
    if (input) input.addEventListener('input', () => { this.S.price = Math.max(0, Number(input.value) || 0); });
  }

  /** Put the figure to the GM (or straight on the item, depending on the mode). */
  async _proposePrice() {
    const R = this.S.result;
    if (!R || R.outcome === 'rejected') return;
    const mode = this.cfg.pricing || 'propose';
    const { item } = this._blank();
    if (!item) return;
    const price = Math.max(0, Math.round(Number(this.S.price) || 0));
    const { requestShardPrice, applyShardPrice, announceShardPrice } = await import('./ShardMarket.js');

    if (mode === 'free') {
      const ok = isGM()
        ? await applyShardPrice(item, price)
        : (await requestShardPrice({ item, actor: this.actor, price, quality: R.eff.quality, outcome: R.outcome })).decision === 'approved';
      this.S.priceState = ok ? 'approved' : 'denied';
      if (ok) announceShardPrice({ actorName: this.actor?.name || 'A player', itemName: item.name, price, decision: 'approved' });
      this._renderMarket(R);
      return;
    }

    this.S.priceState = 'await';
    this._renderMarket(R);
    const res = await requestShardPrice({ item, actor: this.actor, price, quality: R.eff.quality, outcome: R.outcome });
    this.S.priceState = res.decision;
    if (res.decision === 'approved' || res.decision === 'countered') {
      this.S.price = res.price;
      ui.notifications?.info('NCM | Your GM ' + (res.decision === 'countered' ? 'countered at ' : 'approved ') + res.price + ' eb.');
    } else if (res.decision === 'denied') {
      ui.notifications?.warn('NCM | Your GM did not approve that price.');
    }
    this._renderMarket(R);
  }
  /** Start another run: a bricked blank means a fresh one, otherwise keep the same. */
  _restart() {
    const keep = this.S.result?.botch && !this.S.result.botch.bricks && (this.S.srcMode === 'own' || this._isEdit());
    this.S.result = null;
    this.S.busy = false;
    this.S.price = null; this.S.priceState = ''; this._madeItemId = null;
    this.S.srcSearch = ''; this.S.srcType = ''; this.S.srcOnlyKnown = false;
    if (!keep) { this.S.itemId = ''; this.S.srcMode = 'own'; this.S.buyTierId = ''; }
    this.S.stage = keep ? 'build' : 'blank';
    this.S.dec = keep ? 'sk' : 'src';
    this.g('encRoot').classList.remove('res-clean', 'res-sloppy', 'res-rejected');
    this._pct(0);
    this._mountStage({ enter: true });
  }

  // ── beats ────────────────────────────────────────────────────────────────
  _playTone(id) { try { this.playSound(id); } catch { /* sound is optional */ } }

  async _tumble(ms) {
    const cube = this.g('encDieCube'); const t0 = performance.now();
    while (performance.now() - t0 < ms) { cube.textContent = String(1 + ((Math.random() * 10) | 0)); await wait(70); }
  }

  _buildGrid() {
    this.g('encGrid').innerHTML = Array.from({ length: CELLS }, () => '<span class="ncm-enc-cell"></span>').join('');
    this._cells = [...this.g('encGrid').children];
  }
  _paint(frac) {
    const n = Math.round(CELLS * frac);
    this._cells.forEach((c, i) => { c.className = 'ncm-enc-cell' + (i < n ? ' w' : (frac < 1 && i >= n && frac === 0.38 ? ' dead' : '')); });
    if (n > 0 && n < CELLS) this._cells[n - 1].classList.add('head');
    this.g('encAddr').textContent = '0x' + (0x1A40 + n * 0x20).toString(16).toUpperCase().padStart(4, '0');
  }
  async _paintWrite(end, dur) {
    const t0 = performance.now();
    for (;;) {
      const k = Math.min(1, (performance.now() - t0) / dur);
      this._paint(end * k);
      this._pct(Math.round(45 + 33 * k));
      if (k >= 1) break;
      await new Promise((r) => requestAnimationFrame(r));
    }
    this._paint(end);
  }

  async _streamCode(ms) {
    const host = this.g('encHackfx'); if (!host) return;
    host.innerHTML = '';
    if (this._motion() === 'off' || !ms) {
      host.innerHTML = '<div class="ncm-hackfx__ln is-ok">✓ binary armed — writing…</div>';
      return;
    }
    try {
      const { streamHackCode } = await import('../content/HackFX.js');
      streamHackCode(host, {
        durationMs: ms, subject: this._name(),
        family: this.S.family === 'execute' ? 'execute' : 'plant',
        reduced: this._motion() !== 'full',
      });
    } catch (err) { log.debug('Encoder: HackFX unavailable', err); }
    await wait(ms);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PERSISTENCE — the blank, the shard, the entry, the audit row
  // ═══════════════════════════════════════════════════════════════════════
  async _persist({ outcome, eff, res, botch, price }) {
    const S = this.S;
    let debited = 0;
    try {
      let { item, tier } = this._blank();

      // A bought blank only becomes a real item if there is something to keep.
      if (S.srcMode === 'buy') {
        if (price > 0) { await this._debitWealth(price, `Blank ${T('short', 'lower')} · ${tier.name}`); debited = price; }
        if (outcome !== 'rejected' || !botch.bricks) {
          item = await this._createBlank(tier);
          if (!item) throw new Error('Could not create the blank in your gear.');
          S.itemId = item.id; S.srcMode = 'own';
        }
      }

      if (outcome === 'rejected') {
        // Nothing was written, so nothing was loaded: the money never leaves.
        // (The blank itself IS spent — you bought it and botched it.)
        if (botch.trace) this._fireTrace(res);
        if (botch.bricks && item) await this._brick(item);
        return { ok: true, bricked: botch.bricks };
      }

      if (!item) throw new Error('The blank went missing.');

      // The cred drop comes out of the operator's own wealth, now that the chip
      // is really being written. Re-check first: wealth can have moved since.
      const load = this._eddiesLoad();
      if (load > 0) {
        const have = this.actor?.system?.wealth?.value ?? 0;
        if (load > have) throw new Error(`${this.actor?.name || 'You'} no longer has ${load} eb to load onto it.`);
        await this._debitWealth(load, `Loaded onto ${S.label || item.name}`);
        debited += load;
      }
      const ok = this._isEdit()
        ? await this._writeReencode(item, this._reencodePatch(eff, res, outcome), this._buildEntry(eff, res))
        : await this._writeShard(item, this._shardConfig(eff, res, outcome), this._buildEntry(eff, res));
      if (!ok) throw new Error(isGM() ? (this._isEdit() ? 'The re-encode failed.' : 'The conversion failed.') : 'The GM client did not confirm the write.');
      // Name + art land on the item itself. Both are cosmetic, so a failure here
      // must never cost the player the shard they just rolled for.
      if (item.isOwner) {
        const patch = {};
        const label = S.label ? withShardPrefix(S.label, game.nightcity?.settingsManager?.getShardNamePrefix?.() || '') : '';
        if (label && item.name !== label) patch.name = label;
        const img = this._img();
        if (img && item.img !== img) patch.img = img;
        if (Object.keys(patch).length) { try { await item.update(patch); } catch (e) { log.warn('Encoder: could not restyle the item', e); } }
      }
      this._audit(outcome, eff, res, item);
      // A shard nobody can find may as well not exist: repaint every surface
      // that lists one, and remember it so the seal can offer to open it.
      this._madeItemId = item.id;
      this._refreshShardViews();
      ui.notifications?.info(`NCM | "${S.label || item.name}" is in ${this.actor?.name || 'your'}'s gear.`);
      return { ok: true, itemId: item.id, where: this.actor?.name || '' };
    } catch (err) {
      log.error('Encoder: the write failed', err);
      if (debited) {
        try { await this._refundWealth(debited, 'Encode failed'); ui.notifications?.info(`NCM | Refunded ${debited} eb.`); }
        catch (e2) { log.error('Encoder: refund failed', e2); ui.notifications?.error(`NCM | The write AND the ${debited} eb refund failed — fix your wealth by hand.`); }
      }
      return { ok: false, error: err.message };
    }
  }

  /**
   * The lock, in the shard config's own (long-standing) field names. An untouched
   * lock writes nothing, so a shard nobody locked stays exactly as open as it looks.
   */
  _lockConfig() {
    const L = this.S.lock;
    if (!lockIsSet(L)) return {};
    const out = {};
    if (L.encrypted) {
      out.encrypted = true;
      out.encryptionType = L.blackIce ? ENCRYPTION_TYPES.BLACK_ICE : ENCRYPTION_TYPES.ICE;
      out.encryptionDC = L.dv || 15;
      out.failureMode = L.failure === 'damage' ? FAILURE_MODES.DAMAGE
        : L.failure === 'nothing' ? FAILURE_MODES.NOTHING : FAILURE_MODES.LOCKOUT;
    }
    if (L.password) {
      out.requiresLogin = true;
      out.loginPassword = L.password;
      out.loginDisplayName = 'Passphrase';
    }
    if (L.keyItem) {
      out.requiresKeyItem = true;
      out.keyItemName = L.keyItem.name;
      out.keyItemId = L.keyItem.id;
      out.keyItemImg = L.keyItem.img || null;
      out.keyItemDisplayName = L.keyItem.name;
    }
    return out;
  }

  /** The shard's config overrides — identity plus the player-made provenance the GM audits. */
  _shardConfig(eff, res, outcome) {
    const look = this._lookConfig();
    delete look.__img;                              // the art is an ITEM field, not config
    look.boot = this._bootConfig(look);
    return {
      ...look,
      ...this._lockConfig(),
      shardName: this.S.label || this._artName(),
      metadata: {
        creator: this.actor?.name || 'Unknown',
        timestamp: game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString(),
      },
      // What the chip can hold, taken from the blank's tier. 0 = no limit, which
      // is also what every pre-capacity shard resolves to.
      capacity: capacityOf(this._blank().tier).limit,
      // Integrity from the blank's tier: whether it's tracked at all, and how
      // hardened the chip is. Hardening rides along even when tracking is off,
      // so a GM who switches integrity on later still gets the tougher chip.
      integrity: this._blank().tier?.integrity
        ? { enabled: true, mode: 'cosmetic', maxIntegrity: 100, currentIntegrity: 100, hardening: this._blank().tier?.hardening || 0 }
        : { hardening: this._blank().tier?.hardening || 0 },
      playerMade: {
        actorId: this.actor?.id || '', actorName: this.actor?.name || '',
        at: new Date().toISOString(), outcome, quality: eff.quality,
        kind: this._isProgram() ? 'program' : (this.S.type || 'file'),
        skill: this._needsRoll() ? this.S.craft : '', total: res?.total ?? 0, dv: this._dv(),
      },
    };
  }

  /** Whichever branch ran, this is the entry that gets written. */
  _buildEntry(eff, res) {
    return this._isProgram() ? [this._buildProgramEntry(eff, res)] : this._buildContentEntry(eff, res);
  }

  /**
   * The forged file: exactly what the player authored in the editor, plus the
   * provenance and the scan DV the roll earned. `sniffDV` is what ANALYZE rolls
   * against, so a sloppy forgery really is easier to catch.
   */
  _buildContentEntry(eff) {
    // One roll, one quality: every file on the chip was made in the same sitting
    // and is exactly as convincing as that roll.
    return this._entries().map((src) => {
      const entry = foundry.utils.deepClone(src || {});
      entry.timestamp = entry.timestamp || game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString();
      entry.contentData = entry.contentData || {};
      if (eff.scanDV) entry.contentData.sniffDV = eff.scanDV;
      entry.contentData.provenance = {
        playerMade: true, madeBy: this.actor?.id || '', madeByName: this.actor?.name || '',
        madeAt: new Date().toISOString(), forgeQuality: eff.quality, outcome: eff.rung,
        sourceLabel: 'forged by hand',
      };
      return entry;
    });
  }

  /** The program entry, in the Workshop's own shape, stamped with what the roll bought. */
  _buildProgramEntry(eff, res) {
    const S = this.S;
    const program = {
      type: S.family === 'execute' ? 'malware' : 'payload',
      verb: S.ability,
      trigger: 'onLogin',
      progName: this._name(),
      icon: abilityInfo(S.ability)?.icon || 'fas fa-microchip',
      disguised: !!S.disguise,
      coverName: S.disguise ? `${this._name().replace(/\.\w+$/, '')}.txt` : this._name(),
      passes: S.disguise || 'note',
      scan: S.description || '',
      threat: S.family === 'execute' ? 3 : 1,
      detectDV: eff.stealthDV,
      decoy: false,
      uses: eff.charges,
      gate: true,
      gateSkill: this.cfg.programs?.skill || 'Interface',
      gateDV: eff.runDV,
      mode: 'text',
      description: S.description,
      params: { ...S.params },
    };
    const entry = programToEntry(program);
    entry.from = this.actor?.name || '';
    entry.timestamp = game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString();
    entry.contentData.uploadStealthDV = eff.stealthDV;
    entry.contentData.provenance = {
      playerMade: true, madeBy: this.actor?.id || '', madeByName: this.actor?.name || '',
      madeAt: new Date().toISOString(), forgeQuality: eff.quality, outcome: eff.rung,
      sourceLabel: 'encoded by hand',
    };
    return entry;
  }

  /** What a re-encode stamps onto the shard's provenance (see DataShardService.reencodeShard). */
  _reencodePatch(eff, res, outcome) {
    return {
      actorId: this.actor?.id || '', actorName: this.actor?.name || '',
      outcome, quality: eff.quality, scanDV: eff.scanDV || 0,
      kind: this._isProgram() ? 'program' : (this.S.type || 'file'),
      skill: this._needsRoll() ? this.S.craft : '', total: res?.total ?? 0, dv: this._dv(),
    };
  }

  /**
   * Re-encode: no conversion, no new config — the roll's quality lands on the
   * shard's player-made files and the new files are added. GM direct; a player
   * rides the same conversion relay with a `reencode` block.
   */
  async _writeReencode(item, patch, entries) {
    const list = Array.isArray(entries) ? entries : [entries];
    const svc = game.nightcity?.dataShardService;
    if (isGM()) {
      const r = await svc?.reencodeShard(item, { ...patch, entries: list });
      if (!r?.success) { log.warn('Encoder: re-encode failed', r?.error); return false; }
      for (const why of (r.failed || [])) ui.notifications?.warn(`NCM | ${why}`);
      return true;
    }
    const sm = game.nightcity?.socketManager;
    if (!sm) return false;
    return new Promise((resolve) => {
      const requestId = foundry.utils.randomID(8);
      let done = false;
      const handler = (data) => { if (data?.requestId !== requestId || done) return; done = true; resolve(!!data.success); };
      sm.register(SOCKET_OPS.SHARD_CONVERT_RESULT, handler);
      sm.emit(SOCKET_OPS.SHARD_CONVERT_REQUEST, { requestId, itemId: item.id, actorId: this.actor?.id, reencode: patch, entryData: list });
      setTimeout(() => { if (!done) { done = true; resolve(false); } }, 15000);
    });
  }

  /** GM writes directly; a player relays through the existing shard-conversion socket. */
  async _writeShard(item, config, entries) {
    const list = Array.isArray(entries) ? entries : [entries];
    const svc = game.nightcity?.dataShardService;
    if (isGM()) {
      const r = await svc?.convertToDataShard(item, config);
      if (!r?.success) { log.warn('Encoder: convert failed', r?.error); return false; }
      for (const entry of list) {
        const e = await svc?.addMessage(item, entry);
        // A refusal here is worth hearing — a full chip is the likely reason.
        if (!e?.success) { log.warn('Encoder: entry failed (non-fatal)', e?.error); ui.notifications?.warn(`NCM | ${e?.error || 'One file could not be written.'}`); }
      }
      return true;
    }
    const sm = game.nightcity?.socketManager;
    if (!sm) return false;
    return new Promise((resolve) => {
      const requestId = foundry.utils.randomID(8);
      let done = false;
      const handler = (data) => { if (data?.requestId !== requestId || done) return; done = true; resolve(!!data.success); };
      sm.register(SOCKET_OPS.SHARD_CONVERT_RESULT, handler);
      sm.emit(SOCKET_OPS.SHARD_CONVERT_REQUEST, { requestId, itemId: item.id, actorId: this.actor?.id, config, entryData: list });
      setTimeout(() => { if (!done) { done = true; resolve(false); } }, 15000);
    });
  }

  /**
   * Repaint everything that lists a shard. The item directory and the actor sheet
   * both cache their rows, and the Agent's SHARDS tab builds its list from the
   * operator's inventory at render time — without this the new shard is really
   * there and simply invisible until something else forces a redraw.
   */
  _refreshShardViews() {
    setTimeout(() => {
      try {
        ui.items?.render();
        for (const w of Object.values(ui.windows)) {
          if (w === this) continue;
          if (w.actor?.id === this.actor?.id) w.render(false);
          else if (w.id === 'ncm-message-viewer') w.render(false);
        }
        for (const w of (foundry.applications?.instances?.values?.() ?? [])) {
          if (w === this) continue;
          if (w.constructor?.name === 'MessageViewerApp') w.render(false);
        }
      } catch (err) { log.debug('Encoder: could not refresh the shard views', err); }
    }, 150);
  }

  /** Buy a blank: a real item in the operator's gear, stamped with the tier it was sold as. */
  async _createBlank(tier) {
    if (!this.actor?.isOwner) {
      ui.notifications?.error(`NCM | You cannot add items to ${this.actor?.name || 'that character'}.`);
      return null;
    }
    const types = (game.documentTypes?.Item || game.system?.documentTypes?.Item || []).filter((t) => t !== 'base');
    const type = types.includes('gear') ? 'gear' : (types[0] || 'gear');
    const data = {
      name: this.S.label || `${tier.name} ${T('one')}`,
      type,
      img: this._img(),
      flags: { [MODULE_ID]: { blankTier: tier.id } },
    };
    try {
      const created = await Item.create(data, { parent: this.actor });
      return Array.isArray(created) ? created[0] : created;
    } catch (err) { log.error('Encoder: could not create the blank', err); return null; }
  }

  /**
   * A bricked blank is FLAGGED, not deleted — the chip is visibly spent, the GM can see
   * what happened, and nothing of the player's vanishes without them asking. Bricked
   * items never show up as a candidate blank again.
   */
  async _brick(item) {
    try {
      if (!item.isOwner) return;
      await item.update({
        name: /\(bricked\)$/.test(item.name) ? item.name : `${item.name} (bricked)`,
        [`flags.${MODULE_ID}.blankBricked`]: { at: new Date().toISOString(), by: this.actor?.id || '' },
      });
    } catch (err) { log.warn('Encoder: could not mark the blank bricked', err); }
  }

  _fireTrace(res) {
    try {
      game.nightcity?.traceService?.fireTrace?.({
        actor: this.actor, action: 'upload', source: `${T('short')} Encoder`, severity: 'minor',
        targetKind: 'shard', objectName: this.S.label || this._artName(),
        dv: this._dv(), margin: res?.margin ?? null, outcome: 'failed',
      });
    } catch (err) { log.debug('Encoder: trace unavailable', err); }
  }

  /** The GM's audit trail — who made what, and how well (design: audit is not optional). */
  _audit(outcome, eff, res, item) {
    if (!this.cfg.audit) return;
    try {
      game.nightcity?.traceService?.logSuccess?.({
        actor: this.actor, action: 'upload', source: `Encoder · ${outcome} build`,
        severity: 'minor', targetKind: 'shard', hostItem: item,
        objectName: this.S.label || this._artName(),
        dv: this._dv(), margin: res?.margin ?? null,
      });
    } catch (err) { log.debug('Encoder: audit log unavailable', err); }
  }

  async _debitWealth(amount, reason) {
    const actor = this.actor;
    if (!actor) throw new Error('No operator to pay for it.');
    const wealth = foundry.utils.deepClone(actor.system?.wealth || { value: 0 });
    wealth.value = (wealth.value || 0) - amount;
    wealth.transactions = wealth.transactions || [];
    wealth.transactions.push([`Decreased by ${amount} to ${wealth.value}`, reason]);
    await actor.update({ 'system.wealth': wealth });
  }

  async _refundWealth(amount, reason) {
    const actor = this.actor;
    if (!actor) return;
    const wealth = foundry.utils.deepClone(actor.system?.wealth || { value: 0 });
    wealth.value = (wealth.value || 0) + amount;
    wealth.transactions = wealth.transactions || [];
    wealth.transactions.push([`Increased by ${amount} to ${wealth.value}`, reason]);
    await actor.update({ 'system.wealth': wealth });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CANVAS — the Workshop's inflow loop, trimmed (motion-aware)
  // ═══════════════════════════════════════════════════════════════════════
  _sizeCanvas() {
    const cv = this.g('encCanvas'); if (!cv) return;
    this._cv = cv; this._ctx = cv.getContext('2d');
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) { requestAnimationFrame(() => this._sizeCanvas()); return; }
    this._W = r.width; this._H = r.height;
    cv.width = r.width * DPR; cv.height = r.height * DPR;
    this._ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    this._cx = r.width / 2; this._cy = r.height * 0.42;
    this._parts = Array.from({ length: 70 }, () => this._mkP());
    this._code = Array.from({ length: Math.floor(r.width / 24) }, (_, i) => ({ x: i * 24 + 8, y: Math.random() * r.height, sp: 0.4 + Math.random() * 1.1 }));
    this._motes = [];
    this._refreshRGB();
    if (!this._raf) this._loop();
  }
  _mkP() { const a = Math.random() * Math.PI * 2, rad = 90 + Math.random() * Math.max(130, (this._W || 400) * 0.42); return { a, rad, sp: 0.001 + Math.random() * 0.004, pull: 0.05 + Math.random() * 0.12, sz: 0.6 + Math.random() * 1.8, tw: Math.random() * Math.PI * 2 }; }
  _mkMote() { const a = Math.random() * Math.PI * 2, rad = Math.max(150, (this._W || 400) * 0.5) + Math.random() * 80; return { a, rad, ch: HEXC[(Math.random() * HEXC.length) | 0], v: 2.4 + Math.random() * 3.2 }; }
  _refreshRGB() {
    const p = this.g('encRoot'); if (!p) return;
    const s = document.createElement('span');
    s.style.color = getComputedStyle(p).getPropertyValue('--fam').trim() || '#19f3f7';
    document.body.appendChild(s);
    const m = getComputedStyle(s).color.match(/\d+/g); s.remove();
    if (m && m.length >= 3) this._rgb = m.slice(0, 3).join(',');
  }
  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const ctx = this._ctx, W = this._W, H = this._H;
    if (!ctx || !W || !this.element?.isConnected) return;
    const still = this._still(), calm = this._motion() === 'calm';
    const cx = this._cx, cy = this._cy, rgb = this._rgb;
    ctx.clearRect(0, 0, W, H);
    const intensity = 0.28 + 0.72 * this._build, inflow = this._compiling ? 3.4 : 1;

    ctx.font = '11px "Share Tech Mono", monospace';
    for (const c of this._code) {
      if (!still) c.y += c.sp * (1 + intensity);
      if (c.y > H + 30) c.y = -16;
      for (let j = 0; j < 6; j++) {
        const yy = c.y - j * 15; if (yy < 0 || yy > H) continue;
        ctx.fillStyle = `rgba(${rgb},${(0.05 + 0.10 * intensity) * (1 - j / 6)})`;
        ctx.fillText(HEXC[((c.x + yy + j) | 0) % HEXC.length], c.x, yy);
      }
    }
    for (const p of this._parts) {
      if (!still) { p.a += p.sp; p.rad -= p.pull * inflow * (0.4 + intensity); p.tw += 0.06; if (p.rad < 44) Object.assign(p, this._mkP()); }
      const x = cx + Math.cos(p.a) * p.rad, y = cy + Math.sin(p.a) * p.rad * 0.78;
      const near = 1 - Math.min(1, (p.rad - 44) / 220);
      const al = (0.15 + 0.55 * near) * intensity * (0.6 + 0.4 * Math.sin(p.tw));
      ctx.beginPath(); ctx.arc(x, y, p.sz * (0.7 + near), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${al})`; ctx.fill();
      if (near > 0.62 && !still && !calm) {
        ctx.strokeStyle = `rgba(${rgb},${al * 0.5})`;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx + Math.cos(p.a) * 44, cy + Math.sin(p.a) * 44 * 0.78); ctx.stroke();
      }
    }
    if (this._compiling && !still) {
      while (this._motes.length < 56) this._motes.push(this._mkMote());
      ctx.font = '13px "Share Tech Mono", monospace';
      for (const m of this._motes) {
        m.rad -= m.v * (1.1 + (1 - Math.min(1, m.rad / 300)) * 2.2);
        const x = cx + Math.cos(m.a) * m.rad, y = cy + Math.sin(m.a) * m.rad * 0.8;
        const near = 1 - Math.min(1, m.rad / 300);
        ctx.fillStyle = `rgba(${rgb},${0.25 + 0.7 * near})`;
        ctx.fillText(m.ch, x, y);
        if (Math.random() < 0.4) m.ch = HEXC[(Math.random() * HEXC.length) | 0];
        if (m.rad < 46) Object.assign(m, this._mkMote());
      }
    } else this._motes.length = 0;
    if (this._flareStart && !still) {
      const fe = performance.now() - this._flareStart;
      if (fe < 720) {
        const k = fe / 720, ease = 1 - Math.pow(1 - k, 3);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 78);
        g.addColorStop(0, `rgba(${rgb},${0.55 * (1 - k)})`); g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 78, 0, Math.PI * 2); ctx.fill();
        for (const [mul, w, a] of [[0.6, 3, 0.85], [0.34, 2, 0.55]]) {
          ctx.beginPath(); ctx.arc(cx, cy, 26 + ease * Math.max(190, W * 0.5) * mul, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb},${a * (1 - k)})`; ctx.lineWidth = w * (1 - k) + 0.4; ctx.stroke();
        }
      } else this._flareStart = 0;
    }
  }
}
