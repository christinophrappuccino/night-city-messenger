/**
 * Encoder Config — the GM's "Player Authoring" card, as its own window.
 * @file scripts/ui/ShardEncoder/EncoderConfigApp.js
 * @module night-city-messenger
 * @description Everything the Shard Encoder reads is a world setting, edited here:
 *   whether players may author at all, the blank TIERS (price, what a botch does, perk,
 *   which items count), the content-type allow-list with its craft skill + DV, the
 *   program families with their rank thresholds, pricing, and the optional-depth toggles.
 *
 *   It also owns the authoring GATE — WHO may encode — in the same shape as the
 *   terminal operator gate, evaluated by the same `canOperate`, but stored separately
 *   so "anyone may operate a terminal, only a Tech may forge a shard" is expressible.
 *
 *   It is a GM tool, so it is `ADMIN_THEMED` and wears the admin-panel vocabulary:
 *   display-font chrome, mono for values, 2px radius, the `.ncm-ct-row__check` checkbox.
 *   Dialogs open through `adminConfirm` / the shared `showNamePicker` so they inherit
 *   the preset.
 *
 *   Render model: build once into a bare PART root and patch — a settings sheet full of
 *   live inputs must not lose focus mid-typing, which an AppV2 re-render would do.
 *   NOTHING is written until Save: `this.draft` is the working copy.
 */

import { MODULE_ID, TEMPLATES, SKILL_MAP } from '../../utils/constants.js';
import { log, isGM, isSelectableCharacter } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { adminConfirm } from '../../utils/adminTheme.js';
import { abilityInfo } from '../content/ProgramModel.js';
import {
  BOTCH_RULES, TIER_PERKS, PRICING_MODES, PROGRAM_FAMILIES, FAMILY_ABILITIES, BLANK_SOURCES,
  resolveEncoderConfig, typeRows, gateSummary, timeCostFor, formatMinutes,
} from '../content/EncoderModel.js';
import {
  showNamePicker, worldItemEntries, worldRoleEntries, roleImgFor,
  FALLBACK_ITEM_IMG, FALLBACK_ROLE_IMG,
} from '../../utils/namePicker.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TIER_COLORS = ['cyan', 'gold', 'green', 'red', 'muted'];

/** Friendly labels for the content types, in the order the GM should read them. */
const TYPE_LABELS = {
  message: 'Message', note: 'Note', eddies: 'Eddies drop', document: 'Document', record: 'Records',
  dossier: 'Dossier', credentials: 'Credentials', chatlog: 'Chat log', spreadsheet: 'Spreadsheet',
  banking: 'Banking', gallery: 'Image gallery', avlog: 'Audio / video log', location: 'Location',
  schematic: 'Schematic', calendar: 'Calendar', syslog: 'System log', payload: 'Payload', malware: 'Malware',
};

export class EncoderConfigApp extends BaseApplication {

  /** GM tool — follows the Admin Panel theme + text size. */
  static ADMIN_THEMED = true;

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-encoder-config',
    classes: ['ncm-app', 'ncm-encoder-config'],
    window: { title: 'Player Authoring — the Shard Encoder', icon: 'fas fa-user-pen', resizable: true },
    position: { width: 880, height: 700 },
  }, { inplace: false });

  static PARTS = { main: { template: TEMPLATES.ENCODER_CONFIG } };

  constructor(options = {}) {
    super(options);
    this.draft = resolveEncoderConfig(game.nightcity?.settingsManager?.getEncoderConfigRaw?.() ?? {});
    this.dirty = false;
    this.tab = 'basics';
  }

  async _prepareContext() { return {}; }

  /**
   * GM-only. It writes a WORLD setting, which Foundry would refuse for a player
   * anyway — refusing at the door is clearer than a permission error on Save.
   */
  async render(options, _options) {
    if (!isGM()) {
      ui.notifications?.warn('NCM | Player authoring is a GM setting.');
      return this;
    }
    return super.render(options, _options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._mount();
  }

  g(sel) { return this.element?.querySelector(sel) ?? null; }

  _markDirty() {
    this.dirty = true;
    const btn = this.g('[data-ec="save"]');
    if (btn) { btn.disabled = false; btn.classList.remove('is-off'); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  MOUNT
  // ═══════════════════════════════════════════════════════════════════════
  _mount() {
    const root = this.g('#ecRoot');
    if (!root) return;
    root.innerHTML = `
      <div class="ncm-ecfg__tabs">
        ${[['basics', 'Basics', 'fa-toggle-on'], ['who', 'Who can make them', 'fa-user-shield'], ['tiers', 'Blanks', 'fa-microchip'],
           ['types', 'What they can make', 'fa-file-lines'], ['programs', 'Programs', 'fa-bolt'],
           ['depth', 'Optional depth', 'fa-sliders']].map(([k, l, i]) =>
          `<button type="button" class="ncm-ecfg__tab ${this.tab === k ? 'is-on' : ''}" data-ec="tab" data-v="${k}"><i class="fas ${i}"></i> ${l}</button>`).join('')}
      </div>
      <div class="ncm-ecfg__body" id="ecBody"></div>
      <div class="ncm-ecfg__foot">
        <span class="ncm-ecfg__foothint" id="ecFootHint"></span>
        <span style="flex:1"></span>
        <button type="button" class="ncm-ecfg__btn" data-ec="reset"><i class="fas fa-rotate-left"></i> Reset to defaults</button>
        <button type="button" class="ncm-ecfg__btn ncm-ecfg__btn--primary ${this.dirty ? '' : 'is-off'}" data-ec="save" ${this.dirty ? '' : 'disabled'}><i class="fas fa-floppy-disk"></i> Save</button>
      </div>`;
    this._renderBody();
    if (!this._wired) { this._wire(root); this._wired = true; }
  }

  _renderBody() {
    const b = this.g('#ecBody');
    if (!b) return;
    b.innerHTML = this[`_tab${this.tab[0].toUpperCase()}${this.tab.slice(1)}`]?.() ?? '';
    const hint = this.g('#ecFootHint');
    if (hint) {
      hint.innerHTML = this.draft.enabled
        ? 'Players can open the Encoder from their Agent, an item, or the Program Deck.'
        : '<b>Player authoring is off.</b> Nothing below reaches your players until you switch it on.';
    }
  }

  // ── shared field helpers (admin vocabulary) ──────────────────────────────
  _check(path, on, label, hint) {
    return `<label class="ncm-ecfg__check">
      <input type="checkbox" class="ncm-ct-row__check" data-ec-set="${path}" ${on ? 'checked' : ''}>
      <span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;
  }
  _select(path, value, opts, { width } = {}) {
    return `<select class="ncm-ecfg__sel" data-ec-set="${path}" ${width ? `style="min-width:${width}"` : ''}>
      ${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }
  _num(path, value, { min = 0, max = 99, width = '62px' } = {}) {
    return `<input type="number" class="ncm-ecfg__num" data-ec-set="${path}" value="${Number(value) || 0}" min="${min}" max="${max}" style="width:${width}">`;
  }
  _text(path, value, { ph = '', width } = {}) {
    return `<input type="text" class="ncm-ecfg__txt" data-ec-set="${path}" value="${esc(value)}" placeholder="${esc(ph)}" ${width ? `style="width:${width}"` : ''}>`;
  }
  /**
   * A labelled field: caption over control(s), optional hint beneath.
   *
   * `body` may be several elements (an input plus a unit, a number plus a chip).
   * They go in their own flex ROW — without that wrapper they stacked, so
   * "2 · to the DV" rendered as "2" with "to the DV" orphaned on the next line.
   */
  _field(label, body, hint) {
    return `<div class="ncm-ecfg__f"><label>${esc(label)}</label>`
      + `<div class="ncm-ecfg__fc">${body}</div>`
      + `${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
  }
  _sec(title, hint, body) {
    return `<div class="ncm-ecfg__sec">
      <div class="ncm-ecfg__sec-t">${esc(title)}${hint ? `<span>${esc(hint)}</span>` : ''}</div>
      ${body}</div>`;
  }
  _skillOpts(sel) {
    const skills = Object.keys(SKILL_MAP);
    if (sel && !skills.includes(sel)) skills.unshift(sel);
    return [['', '— no roll —'], ...skills.map((s) => [s, s])].filter(([v]) => v !== '' || sel === '');
  }
  /**
   * Like `_skillOpts`, but the empty choice NEVER disappears — so a rule made of a
   * skill can be un-made. (`_skillOpts` drops it once a skill is chosen, which is
   * right for a type's craft skill, where "no skill" means a different thing, and
   * wrong for an optional requirement you must be able to withdraw.)
   */
  _skillOptsClearable(sel, emptyLabel = '— not required —') {
    const skills = Object.keys(SKILL_MAP);
    if (sel && !skills.includes(sel)) skills.unshift(sel);
    return [['', emptyLabel], ...skills.map((s) => [s, s])];
  }

  // ── TAB · basics ─────────────────────────────────────────────────────────
  _tabBasics() {
    const d = this.draft;
    return this._sec('Player authoring', 'turn the Shard Encoder on for your players', `
      <div class="ncm-ecfg__row">
        ${this._check('enabled', d.enabled, 'Players may encode their own shards',
          'They get an Encode button in their Agent, on an item right-click, and in the Program Deck. Nothing else on these tabs does anything until this is ticked.')}
      </div>`)
    + this._sec('Selling what they make', 'whether a player can put a price on a shard they made', `
      <div class="ncm-ecfg__row">
        ${this._field('Pricing', this._select('pricing', d.pricing, Object.entries(PRICING_MODES), { width: '280px' }),
          'Propose: the player suggests a price and you approve, change or refuse it. The price is only written onto the item after you approve — they cannot set it themselves.')}
      </div>`)
    + this._sec('Locking a shard', 'whether players can put encryption on what they make', `
      <div class="ncm-ecfg__row">
        ${this._check('lock.allowed', d.lock.allowed, 'Players may lock what they make', 'They roll Cryptography, and the result sets the highest encryption DV they may choose. The roll cannot be failed — a bad one just means a weaker lock.')}
        ${this._check('lock.blackIce', d.lock.blackIce, 'Black ICE allowed', 'Black ICE needs a high Cryptography roll as well as this tick. Leave it off and players can encrypt but never arm a shard.')}
      </div>`)
    + this._sec('Second attempts', 'what a player can do with a shard that came out badly', `
      <div class="ncm-ecfg__row">
        ${this._check('reencode.allowed', d.reencode.allowed, 'Rewrite a sloppy shard', 'A second go at one that landed but carries tells.')}
        ${this._field('at DV +', this._num('reencode.dv', d.reencode.dv, { max: 20, width: '54px' }))}
        ${this._check('copy.allowed', d.copy.allowed, 'Copy a clean shard', 'Duplicate a good one onto another blank.')}
        ${this._field('at DV +', this._num('copy.dv', d.copy.dv, { max: 20, width: '54px' }))}
      </div>`)
    + this._sec('How it looks', 'which visual styles a player may dress a shard in', `
      <div class="ncm-ecfg__col">
        ${this._check('look.presets', d.look.presets, 'Offer the built-in looks',
          'The nine styles that ship with the module. Players get the colours and the startup screen only — never the security those presets carry.')}
        ${this._check('look.savedThemes', d.look.savedThemes, 'Offer the looks you saved',
          'The looks you saved yourself, from any shard: Configure → Theme → Save this look.')}
        ${this._check('look.custom', d.look.custom, 'Let them mix their own',
          'They pick an accent colour and a background. The backgrounds on offer are all dark, so they cannot make a shard nobody can read.')}
      </div>`)
    + this._sec('Keeping track', 'how you find out what your players have made', `
      <div class="ncm-ecfg__row">
        ${this._check('audit', d.audit, 'Tag player-made shards and log every encode',
          'The shard records who made it and how well it came out, and every encode is listed in Admin → Security → Activity.')}
      </div>`);
  }

  // ── TAB · who may encode ─────────────────────────────────────────────────
  /**
   * The authoring gate. Deliberately the SAME shape and the same evaluator as the
   * terminal operator gate (Admin → Security → Operator Access), so a GM who has
   * written one already knows how to write this one — but a separate object, so
   * "anyone may operate a terminal, only a Tech may forge a shard" is sayable.
   */
  _tabWho() {
    const g = this.draft.gate;
    const sum = gateSummary(g);
    const gated = sum.gated;

    const chipRow = (chips, addAct, delAct, fallbackImg, addLabel, addV = '') => (chips.length ? chips : [])
      .map((c, i) => `<span class="ncm-ecfg__chip"><img src="${esc(c.img || fallbackImg)}" alt="">${esc(c.name)}
        <i class="fas fa-xmark" data-ec="${delAct}" data-v="${esc(String(c.key ?? i))}"></i></span>`).join('')
      + `<button type="button" class="ncm-ecfg__chip ncm-ecfg__chip--add" data-ec="${addAct}" data-v="${esc(addV)}"><i class="fas fa-plus"></i> ${esc(addLabel)}</button>`;

    // ── the live answer, so the GM never has to guess what they just wrote ──
    let verdict;
    if (!this.draft.enabled) verdict = '<b>Player authoring is off</b> — nobody can encode yet, whatever this page says.';
    else if (!gated) verdict = 'Right now: <b>any player</b> with a character they own may encode.';
    else if (sum.inert) verdict = '<b>Nothing is required yet</b>, so this behaves exactly like “anyone”. Add a role, a skill or some gear below.';
    else verdict = `Right now a character qualifies by: <b>${esc(sum.parts.join(g.logic === 'all' ? '  AND  ' : '  OR  '))}</b>${g.actors.length ? `, or by being one of the ${g.actors.length} named character${g.actors.length === 1 ? '' : 's'}` : ''}.`;

    const roleChips = g.roles.map((n) => ({ name: n, img: roleImgFor(n) }));
    const actorChips = g.actors.map((id) => {
      const a = game.actors?.get(id);
      return { key: id, name: a?.name || `(deleted character · ${String(id).slice(0, 6)}…)`, img: a?.img || FALLBACK_ITEM_IMG };
    });

    const head = this._sec('Who may encode', 'which characters are allowed to use the Encoder at all', `
      <div class="ncm-ecfg__row">
        ${this._field('Access', this._select('gate.mode', g.mode, [
          ['anyone', 'Anyone — every player with a character'],
          ['gated', 'Only characters who qualify'],
        ], { width: '300px' }), 'A character who qualifies sees the Encode buttons. One who does not never sees them at all, rather than clicking one that refuses.')}
        ${gated ? this._field('Combine with', this._select('gate.logic', g.logic, [['any', 'ANY one of the rules below'], ['all', 'ALL of the rules below']], { width: '220px' })) : ''}
      </div>
      <div class="ncm-ecfg__verdict${(sum.inert && this.draft.enabled) ? ' is-warn' : ''}">${verdict}</div>`);

    // Ungated: the rules below would be inert, and a page full of inert controls
    // reads as a broken page. The choice above is the whole story.
    if (!gated) return head;

    return head
    + this._sec('By role', 'qualify by having a role — matched against the character’s CPR role item', `
      <div class="ncm-ecfg__row">
        ${this._field('Any of / all of', this._select('gate.roleLogic', g.roleLogic, [['any', 'any one role'], ['all', 'every listed role']], { width: '180px' }))}
      </div>
      <div class="ncm-ecfg__chips">${chipRow(roleChips, 'gateRoleAdd', 'gateRoleDel', FALLBACK_ROLE_IMG, 'role')}</div>`)

    + this._sec('By skill', 'qualify by having at least this much rank in ANY one of these skills', `
      ${(g.skills.length ? g.skills : []).map((s, i) => `
      <div class="ncm-ecfg__row">
        ${this._field(i ? 'or' : 'Skill', this._select(`gate.skills.${i}.name`, s.name, this._skillOptsClearable(s.name), { width: '220px' }))}
        ${this._field('at rank', this._num(`gate.skills.${i}.min`, s.min, { max: 10, width: '54px' }))}
        <button type="button" class="ncm-ecfg__mini ncm-ecfg__mini--danger" data-ec="gateSkillDel" data-v="${i}" aria-label="Remove this skill" style="align-self:flex-end"><i class="fas fa-xmark"></i></button>
      </div>`).join('')}
      ${g.skills.length ? '' : '<div class="ncm-ecfg__verdict">No skill rule — add one to let a character qualify by rank.</div>'}
      <div class="ncm-ecfg__chips"><button type="button" class="ncm-ecfg__chip ncm-ecfg__chip--add" data-ec="gateSkillAdd"><i class="fas fa-plus"></i> skill</button></div>`)

    + this._sec('By gear', 'qualify by carrying particular items', `
      ${g.itemGroups.map((grp, gi) => `
        <div class="ncm-ecfg__grp">
          <div class="ncm-ecfg__grp-h">
            <span class="ncm-ecfg__grp-t">Option ${String.fromCharCode(65 + gi)}</span>
            <span style="flex:1"></span>
            <button type="button" class="ncm-ecfg__mini ncm-ecfg__mini--danger" data-ec="gateGroupDel" data-v="${gi}"><i class="fas fa-xmark"></i></button>
          </div>
          <div class="ncm-ecfg__chips">${chipRow(
            grp.map((it, ii) => ({ ...it, key: `${gi}:${ii}` })),
            `gateGearAdd`, 'gateGearDel', FALLBACK_ITEM_IMG, 'item', String(gi))}</div>
        </div>`).join('')}
      <button type="button" class="ncm-ecfg__btn" data-ec="gateGroupAdd"><i class="fas fa-plus"></i> ${g.itemGroups.length ? 'Add an OR option' : 'Require some gear'}</button>`)

    + this._sec('Always allowed', 'characters who qualify no matter what the rules above say', `
      <div class="ncm-ecfg__chips">${chipRow(actorChips, 'gateActorAdd', 'gateActorDel', FALLBACK_ITEM_IMG, 'character')}</div>
      <div class="ncm-ecfg__row" style="margin-top:8px">
        ${this._check('gate.allowGM', g.allowGM, 'The GM always qualifies', 'You build shards through this window regardless — this is for a GM who also plays a character.')}
      </div>`);
  }

  // ── TAB · blank tiers ────────────────────────────────────────────────────
  _tabTiers() {
    const d = this.draft;
    const botchOpts = Object.entries(BOTCH_RULES).map(([k, v]) => [k, v.label]);
    const perkOpts = Object.entries(TIER_PERKS).map(([k, v]) => [k, v.label]);
    const cards = d.tiers.map((t, i) => `
      <div class="ncm-ecfg__tier" data-tier-i="${i}" style="--tc:var(--ncm-${t.color === 'muted' ? 'text-muted' : t.color === 'gold' ? 'accent' : t.color === 'cyan' ? 'secondary' : t.color === 'red' ? 'danger' : 'success'})">
        <div class="ncm-ecfg__tier-h">
          ${this._text(`tiers.${i}.name`, t.name, { width: '140px' })}
          ${this._select(`tiers.${i}.color`, t.color, TIER_COLORS.map((c) => [c, c]), { width: '92px' })}
          ${t.fallback
            ? '<span class="ncm-ecfg__badge">fallback · anything unlisted</span>'
            : `<button type="button" class="ncm-ecfg__mini" data-ec="fallback" data-v="${i}">make fallback</button>`}
          <span style="flex:1"></span>
          ${d.tiers.length > 1 && !t.fallback ? `<button type="button" class="ncm-ecfg__mini ncm-ecfg__mini--danger" data-ec="tierdel" data-v="${i}"><i class="fas fa-xmark"></i></button>` : ''}
        </div>
        <div class="ncm-ecfg__row">
          ${this._field('Sold for', this._num(`tiers.${i}.price`, t.price, { max: 100000, width: '84px' }) + ' <span class="ncm-ecfg__unit">eb</span>')}
          ${this._check(`tiers.${i}.buyable`, t.buyable, 'On sale', 'Players can buy this one from the Encoder.')}
          ${this._field('If the encode is rejected', this._select(`tiers.${i}.onRejected`, t.onRejected, botchOpts, { width: '150px' }))}
          ${this._field('On a natural 1', this._select(`tiers.${i}.onNat1`, t.onNat1, botchOpts, { width: '150px' }))}
          ${this._field('Holds', this._num(`tiers.${i}.capacity`, t.capacity, { max: 99, width: '62px' }) + ' <span class="ncm-ecfg__unit">entries</span>', '0 = no limit')}
          ${this._field('Perk', this._select(`tiers.${i}.perk`, t.perk, perkOpts, { width: '130px' }))}
          ${this._check(`tiers.${i}.integrity`, t.integrity, 'Tracks integrity', 'Shards made on this blank glitch as failed breaches wear them down, and are bricked at 0. Tune it per shard in Configure Shard → Systems.')}
          ${this._field('Hardened', this._num(`tiers.${i}.hardening`, t.hardening, { max: 90, width: '62px' }) + ' <span class="ncm-ecfg__unit">% less per hit</span>', '0 = not hardened')}
        </div>
        <div class="ncm-ecfg__items">
          <span class="ncm-ecfg__items-l">Items</span>
          ${t.fallback
            ? '<span class="ncm-ecfg__chip is-any">anything else they may write on</span>'
            : t.items.map((it, j) => `<span class="ncm-ecfg__chip">
                <img src="${esc(it.img || 'icons/svg/item-bag.svg')}" alt="">${esc(it.name)}
                <i class="fas fa-xmark" data-ec="itemdel" data-v="${i}:${j}"></i></span>`).join('')
              + `<button type="button" class="ncm-ecfg__chip ncm-ecfg__chip--add" data-ec="itemadd" data-v="${i}"><i class="fas fa-plus"></i> item</button>`}
        </div>
      </div>`).join('');

    return this._sec('What can be written on', "which of a character's items can become a shard", `
      <div class="ncm-ecfg__row">
        ${this._field('Players may write on', this._select('blanks.source', d.blanks?.source || 'gear', Object.entries(BLANK_SOURCES), { width: '380px' }),
          'Writing on an item renames it and can replace its picture. "Gear only" keeps weapons, armor and cyberware out of it. Removing the shard data later gives the item its old name and picture back. Items listed in a tier below always count.')}
      </div>`)
    + this._sec('Blank tiers', 'the kinds of blank chip a player can write on', `
      <div class="ncm-ecfg__tiers">${cards}
        <button type="button" class="ncm-ecfg__btn" data-ec="tieradd"><i class="fas fa-plus"></i> Add a tier</button>
      </div>
      <div class="ncm-ecfg__note">Premium is whatever you say it is. Membership is by item name, so a chip you add here matches any copy of that item in the world. Anything you never list falls to the fallback tier.</div>`);
  }

  // ── TAB · content types ──────────────────────────────────────────────────
  _tabTypes() {
    const rows = typeRows(this.draft).filter((r) => !r.isProgram);
    const on = rows.filter((r) => r.on).length;
    const body = `
      <table class="ncm-ecfg__table">
        <thead><tr><th style="width:26px"></th><th>Type</th><th>Craft skill</th><th style="width:56px">DV</th><th>Another way</th><th style="width:62px">at DV +</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr class="${r.on ? '' : 'is-off'}">
            <td><input type="checkbox" class="ncm-ct-row__check" data-ec-set="types.${r.key}.on" ${r.on ? 'checked' : ''}></td>
            <td class="ncm-ecfg__tname">${esc(TYPE_LABELS[r.key] || r.key)}</td>
            <td>${this._select(`types.${r.key}.skill`, r.skill, this._skillOpts(r.skill), { width: '150px' })}</td>
            <td>${r.noRoll ? '<span class="ncm-ecfg__dim">—</span>' : this._num(`types.${r.key}.dv`, r.dv, { max: 30, width: '48px' })}</td>
            <td>${r.noRoll ? '<span class="ncm-ecfg__dim">—</span>' : this._select(`types.${r.key}.alt`, r.alt, this._skillOpts(r.alt), { width: '140px' })}</td>
            <td>${r.noRoll || !r.alt ? '<span class="ncm-ecfg__dim">—</span>' : this._num(`types.${r.key}.altDV`, r.altDV, { max: 20, width: '48px' })}</td>
          </tr>`).join('')}</tbody>
      </table>`;
    return this._sec('More than one file per shard', 'writing a second file onto the same shard is harder than the first', `
      <div class="ncm-ecfg__row">
        ${this._field('Each file past the first adds', this._num('content.extraEntryDV', this.draft.content?.extraEntryDV ?? 2, { max: 20, width: '58px' }) + ' <span class="ncm-ecfg__unit">to the DV</span>',
          'How many files fit at all is set by the blank tier (its "Holds" number). Set this to 0 and extra files cost nothing.')}
      </div>`)
    + this._sec('What players can make', `${on} of ${rows.length} allowed · a type with no craft skill is written without a roll`, body)
      + `<div class="ncm-ecfg__note"><b>Craft skill</b> is what the player rolls to fake that kind of file, and <b>DV</b> is how hard it is. Leave the skill blank and the type needs no roll at all — a note is just a note, and nothing about it is a forgery. <b>Another way</b> lets a second skill do the same job at a higher DV, for a character who has the wrong trade but the right idea.</div>`;
  }

  // ── TAB · programs ───────────────────────────────────────────────────────
  _tabPrograms() {
    const p = this.draft.programs;
    const famRow = Object.entries(PROGRAM_FAMILIES).map(([k, f]) =>
      this._check(`programs.families.${k}`, p.families?.[k] !== false, f.label, f.hint)).join('');
    const abilityRows = Object.entries(FAMILY_ABILITIES).map(([fam, keys]) => `
      <tr class="ncm-ecfg__grouprow"><td colspan="3">${esc(PROGRAM_FAMILIES[fam]?.label || fam)}</td></tr>
      ${keys.map((k) => {
        const a = p.abilities?.[k] || { dv: 15, rank: 0 };
        return `<tr>
          <td class="ncm-ecfg__tname"><i class="${esc(abilityInfo(k)?.icon || 'fas fa-bolt')}"></i> ${esc(abilityInfo(k)?.label || k)}
            <small>${esc(abilityInfo(k)?.blurb || '')}</small></td>
          <td>${this._num(`programs.abilities.${k}.dv`, a.dv, { max: 30, width: '52px' })}</td>
          <td>${this._num(`programs.abilities.${k}.rank`, a.rank, { max: 10, width: '52px' })}</td>
        </tr>`;
      }).join('')}`).join('');

    const alts = (p.alts || []).map((a, i) => `
      <div class="ncm-ecfg__row ncm-ecfg__altrow">
        ${this._field('Skill', this._select(`programs.alts.${i}.skill`, a.skill, Object.keys(SKILL_MAP).map((s) => [s, s]), { width: '190px' }))}
        ${this._field('at DV +', this._num(`programs.alts.${i}.dv`, a.dv, { max: 20, width: '54px' }))}
        ${this._field('Only for', `<span class="ncm-ecfg__dim">${esc((a.only || []).length ? a.only.map((k) => abilityInfo(k)?.label || k).join(', ') : 'anything')}</span>`)}
        <button type="button" class="ncm-ecfg__mini ncm-ecfg__mini--danger" data-ec="altdel" data-v="${i}"><i class="fas fa-xmark"></i></button>
      </div>`).join('');

    return this._sec('Families', 'the two kinds of program, and whether players may build each', `<div class="ncm-ecfg__row">${famRow}</div>`)
      + this._sec('The gating skill', 'rank in this skill decides which abilities they can build, and how many charges they get', `
        <div class="ncm-ecfg__row">
          ${this._field('Skill', this._select('programs.skill', p.skill, Object.keys(SKILL_MAP).map((s) => [s, s]), { width: '190px' }))}
          ${this._field('Charges', `${this._num('programs.chargesBase', p.chargesBase, { max: 9, width: '48px' })} <span class="ncm-ecfg__unit">+ rank ÷</span> ${this._num('programs.chargesPer', p.chargesPer, { min: 1, max: 20, width: '48px' })}`)}
          ${this._field('Trojan cover needs rank', this._num('programs.disguiseRank', p.disguiseRank, { max: 10, width: '48px' }))}
          ${this._field('and costs DV +', this._num('programs.disguiseDV', p.disguiseDV, { max: 10, width: '48px' }))}
        </div>`)
      + this._sec('Other skills that can build one', 'let a different skill do the job, at a higher DV', alts
        + `<button type="button" class="ncm-ecfg__btn" data-ec="altadd"><i class="fas fa-plus"></i> Add another skill</button>`)
      + this._sec('Abilities', 'per ability: the DV to build it, and the minimum rank needed before it is offered', `
        <table class="ncm-ecfg__table">
          <thead><tr><th>Ability</th><th style="width:70px">Build DV</th><th style="width:70px">Needs rank</th></tr></thead>
          <tbody>${abilityRows}</tbody>
        </table>`);
  }

  // ── TAB · optional depth ─────────────────────────────────────────────────
  _tabDepth() {
    const o = this.draft.optional;

    // A worked example beats a formula: a GM setting minutes-per-DV wants to know
    // what that means for the forgery they have in mind, not to do the sum.
    const exDV = 15;
    const exMins = timeCostFor(this.draft, exDV);

    const gearRows = o.gear.items.length ? o.gear.items.map((it, i) => `
      <div class="ncm-ecfg__gearrow">
        <img src="${esc(it.img || FALLBACK_ITEM_IMG)}" alt="">
        <span class="ncm-ecfg__gearname">${esc(it.name)}</span>
        <span class="ncm-ecfg__unit">worth</span>
        ${this._num(`optional.gear.items.${i}.bonus`, it.bonus, { min: -5, max: 10, width: '52px' })}
        <button type="button" class="ncm-ecfg__mini ncm-ecfg__mini--danger" data-ec="gearDel" data-v="${i}"><i class="fas fa-xmark"></i></button>
      </div>`).join('')
      : '<div class="ncm-ecfg__empty">Nothing listed — so nothing a character carries changes the roll yet.</div>';

    return this._sec('Gear helps', 'carrying the right kit adds to the encode roll', `
      <div class="ncm-ecfg__row">
        ${this._check('optional.gear.on', o.gear.on, 'Use gear bonuses')}
        ${o.gear.on ? this._field('When they carry several', this._select('optional.gear.stack', o.gear.stack, [
          ['best', 'Only the best one counts'],
          ['sum', 'Add them all up'],
        ], { width: '220px' }), 'Best is the safe default — adding a deck, a kit and a workshop is how a +9 happens by accident.') : ''}
      </div>
      ${o.gear.on ? `<div class="ncm-ecfg__gearlist">${gearRows}</div>
      <div class="ncm-ecfg__row"><button type="button" class="ncm-ecfg__btn" data-ec="gearAdd"><i class="fas fa-plus"></i> Add an item</button></div>` : ''}`)

    + this._sec('It takes time', 'each encode costs time on the world clock', `
      <div class="ncm-ecfg__row">
        ${this._check('optional.time.on', o.time.on, 'Charge time for encoding')}
      </div>
      ${o.time.on ? `<div class="ncm-ecfg__row">
        ${this._field('Every encode takes', this._num('optional.time.baseMinutes', o.time.baseMinutes, { max: 10080, width: '68px' }) + ' <span class="ncm-ecfg__unit">minutes</span>')}
        ${this._field('Plus, per point of DV', this._num('optional.time.perDV', o.time.perDV, { max: 600, width: '58px' }) + ' <span class="ncm-ecfg__unit">minutes</span>')}
      </div>
      <div class="ncm-ecfg__row">
        ${this._check('optional.time.advanceClock', o.time.advanceClock, 'Move the world clock forward',
          'Off, the cost is only reported — useful if you advance time yourself.')}
      </div>
      <div class="ncm-ecfg__verdict" data-ec-timeex>A DV ${exDV} forgery would take <b>${esc(formatMinutes(exMins))}</b>; a no-roll note takes <b>${esc(formatMinutes(timeCostFor(this.draft, 0)))}</b>.</div>` : ''}`)

    + this._sec('Someone can help', 'a second character lends a hand on the roll', `
      <div class="ncm-ecfg__row">
        ${this._check('optional.assist.on', o.assist.on, 'Allow an assistant')}
        ${o.assist.on ? this._field('Worth', this._num('optional.assist.bonus', o.assist.bonus, { max: 5, width: '52px' }) + ' <span class="ncm-ecfg__unit">to the roll</span>') : ''}
      </div>
      ${o.assist.on ? `<div class="ncm-ecfg__row">
        ${this._check('optional.assist.requireSkill', o.assist.requireSkill, 'They need the skill themselves',
          'On, a helper with no rank in the craft skill adds nothing — holding the torch is not knowing forgery.')}
      </div>` : ''}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  WIRING
  // ═══════════════════════════════════════════════════════════════════════
  _wire(root) {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ec]');
      if (!t) return;
      this._onAct(t.dataset.ec, t.dataset.v, t);
    });
    const read = (el) => {
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'number') return Number(el.value) || 0;
      return el.value;
    };
    const set = (el) => {
      foundry.utils.setProperty(this.draft, el.dataset.ecSet, read(el));
      this._markDirty();
    };
    root.addEventListener('input', (e) => { const t = e.target.closest('[data-ec-set]'); if (t && t.type === 'text') set(t); });
    root.addEventListener('change', (e) => {
      const t = e.target.closest('[data-ec-set]');
      if (!t) return;
      set(t);
      // Structural choices repaint the body so dependent fields follow.
      if (/^(enabled|gate\.(mode|logic|roleLogic|skills\.\d+\.name)|optional\.[a-z]+\.(on|stack)|types\..*\.(on|skill|alt)|tiers\..*\.(color|buyable)|programs\.(skill|families))/.test(t.dataset.ecSet)) this._renderBody();
      // The time example is patched in place rather than repainted: a number input
      // fires `change` on every arrow-key press, and a repaint would take the focus
      // out from under the GM mid-edit.
      else if (/^optional\.time\./.test(t.dataset.ecSet)) this._syncTimeExample();
    });
  }

  /** Repaint the time worked-example in place (see the note in _wire). */
  _syncTimeExample() {
    const el = this.g('[data-ec-timeex]');
    if (!el) return;
    const mins = timeCostFor(this.draft, 15);
    el.innerHTML = 'A DV 15 forgery would take <b>' + esc(formatMinutes(mins))
      + '</b>; a no-roll note takes <b>' + esc(formatMinutes(timeCostFor(this.draft, 0))) + '</b>.';
  }

  async _onAct(act, v, el) {
    switch (act) {
      case 'tab': this.tab = v; this._mount(); return;
      case 'save': return void this._save();
      case 'reset': return void this._reset();
      case 'tieradd': {
        const id = `tier-${foundry.utils.randomID(5)}`;
        this.draft.tiers.push({ id, name: 'New tier', color: 'green', price: 100, buyable: true, fallback: false,
          onRejected: 'bricked', onNat1: 'bricked-trace', perk: '', items: [] });
        this._markDirty(); this._renderBody(); return;
      }
      case 'tierdel': {
        const i = Number(v);
        if (this.draft.tiers[i]?.fallback) return;
        this.draft.tiers.splice(i, 1);
        this._markDirty(); this._renderBody(); return;
      }
      case 'fallback': {
        this.draft.tiers.forEach((t, i) => { t.fallback = i === Number(v); });
        this._markDirty(); this._renderBody(); return;
      }
      case 'itemadd': return void this._pickItem(Number(v));
      case 'itemdel': {
        const [i, j] = String(v).split(':').map(Number);
        this.draft.tiers[i]?.items.splice(j, 1);
        this._markDirty(); this._renderBody(); return;
      }
      case 'altadd': {
        (this.draft.programs.alts ||= []).push({ skill: 'Electronics/Security Tech', dv: 3, only: [] });
        this._markDirty(); this._renderBody(); return;
      }
      case 'altdel': {
        this.draft.programs.alts.splice(Number(v), 1);
        this._markDirty(); this._renderBody(); return;
      }

      // ── the authoring gate ──────────────────────────────────────────────
      case 'gateRoleAdd': {
        const pick = await showNamePicker({
          title: 'Roles that may encode',
          hint: 'A character qualifies by carrying this CPR role item. Matched by name.',
          entries: worldRoleEntries(), taken: new Set(this.draft.gate.roles),
        });
        if (!pick) return;
        this.draft.gate.roles.push(pick.name);
        this._markDirty(); this._renderBody(); return;
      }
      case 'gateSkillAdd':
        (this.draft.gate.skills ||= []).push({ name: 'Interface', min: 4 });
        this._markDirty(); this._renderBody(); return;
      case 'gateSkillDel':
        this.draft.gate.skills.splice(Number(v), 1);
        this._markDirty(); this._renderBody(); return;

      case 'gateRoleDel':
        this.draft.gate.roles.splice(Number(v), 1);
        this._markDirty(); this._renderBody(); return;

      case 'gateGroupAdd':
        this.draft.gate.itemGroups.push([]);
        this._markDirty(); this._renderBody(); return;
      case 'gateGroupDel':
        this.draft.gate.itemGroups.splice(Number(v), 1);
        this._markDirty(); this._renderBody(); return;

      case 'gateGearAdd': {
        const gi = Number(v);
        const grp = this.draft.gate.itemGroups[gi];
        if (!grp) return;
        const pick = await showNamePicker({
          title: `Gear required for option ${String.fromCharCode(65 + gi)}`,
          hint: 'Everything in one option is required TOGETHER. Matched by item name, so every copy in the world counts.',
          entries: worldItemEntries({ limit: 150 }), taken: new Set(grp.map((i) => i.name)),
        });
        if (!pick) return;
        grp.push({ name: pick.name, img: pick.img || '' });
        this._markDirty(); this._renderBody(); return;
      }
      case 'gateGearDel': {
        const [gi, ii] = String(v).split(':').map(Number);
        this.draft.gate.itemGroups[gi]?.splice(ii, 1);
        this._markDirty(); this._renderBody(); return;
      }

      case 'gateActorAdd': {
        // Characters, not every actor in the world — this is an allowlist of
        // people at the table, and an NPC on it would never reach a door anyway.
        const chars = (game.actors?.contents ?? [])
          .filter((a) => a.hasPlayerOwner && isSelectableCharacter(a))
          .map((a) => ({ id: a.id, name: a.name, img: a.img || FALLBACK_ITEM_IMG }))
          .sort((x, y) => x.name.localeCompare(y.name));
        const pick = await showNamePicker({
          title: 'Characters who may always encode',
          hint: 'These skip every rule above. Player-owned characters only.',
          entries: chars, taken: new Set(this.draft.gate.actors),
          emptyText: 'no player-owned characters in this world yet',
        });
        if (!pick?.id) return;
        this.draft.gate.actors.push(pick.id);
        this._markDirty(); this._renderBody(); return;
      }
      case 'gearAdd': {
        const pick = await showNamePicker({
          title: 'Gear that helps with encoding',
          hint: 'Matched by item name, so every copy in the world counts.',
          entries: worldItemEntries({ limit: 200 }),
          taken: new Set(this.draft.optional.gear.items.map((i) => i.name)),
          takenLabel: 'already listed',
        });
        if (!pick) return;
        this.draft.optional.gear.items.push({ name: pick.name, img: pick.img || '', bonus: 1 });
        this._markDirty(); this._renderBody(); return;
      }
      case 'gearDel':
        this.draft.optional.gear.items.splice(Number(v), 1);
        this._markDirty(); this._renderBody(); return;

      case 'gateActorDel':
        this.draft.gate.actors = this.draft.gate.actors.filter((id) => id !== v);
        this._markDirty(); this._renderBody(); return;
      default: log.debug(`EncoderConfig: unhandled ${act}`);
    }
  }

  /**
   * Which world items count as a blank of this tier. Goes through the shared
   * picker — its own copy filtered rows with the `hidden` ATTRIBUTE, which loses
   * to the row's own `display:flex` rule, so the search box here
   * silently did nothing.
   */
  async _pickItem(tierIndex) {
    const tier = this.draft.tiers[tierIndex];
    if (!tier) return;
    const pick = await showNamePicker({
      title: `Blanks that count as ${tier.name}`,
      hint: 'Matched by item name, so every copy in the world counts.',
      entries: worldItemEntries(),
      taken: new Set(this.draft.tiers.flatMap((t) => t.items.map((i) => i.name))),
      takenLabel: 'already a blank',
      emptyText: 'no items in this world yet',
      closeLabel: 'Close',
    });
    if (!pick) return;
    tier.items.push({ name: pick.name, img: pick.img || '' });
    this._markDirty();
    this._renderBody();
  }

  async _save() {
    if (!isGM()) return;
    try {
      const clean = resolveEncoderConfig(this.draft);
      await game.nightcity?.settingsManager?.setEncoderConfig(clean);
      this.draft = clean;
      this.dirty = false;
      ui.notifications?.info('NCM | Player authoring saved.');
      this._mount();
      // The item doors read the setting directly — repaint any open sheet.
      setTimeout(() => { ui.items?.render(); Object.values(ui.windows).forEach((w) => { if (w.actor) w.render(false); }); }, 100);
    } catch (err) {
      log.error('EncoderConfig: save failed', err);
      ui.notifications?.error('NCM | Could not save — see the console.');
    }
  }

  async _reset() {
    const ok = await adminConfirm({
      title: 'Reset player authoring',
      content: '<p>Put every Encoder setting back to the shipped defaults?</p><p style="opacity:.7">Your blank tiers and their item lists go with it. Nothing is written until you press Save.</p>',
    });
    if (!ok) return;
    this.draft = resolveEncoderConfig({});
    this._markDirty();
    this._mount();
  }
}
