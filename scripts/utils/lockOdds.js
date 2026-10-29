/**
 * Lock odds — "how hard is this account for your party" (2026-10-27,
 * dev-approved mock dev/mockups/admin-lock-odds-mock.html).
 *
 * PURE: no Foundry globals. The caller (TerminalConfigApp) reads each
 * character's skill base through SkillService.getSkillData — the same
 * stat + rank performCheck adds before the d10, honouring roleAbilityRoll —
 * and hands this module plain numbers.
 *
 * The chance is a plain d10 needing (DV − base): no crits, no fumbles, no
 * Luck. That is deliberate and the panel's note says so.
 */

/** Tone thresholds (percent). */
export const ODDS_LIKELY = 65;
export const ODDS_MAYBE = 35;
/** 5+ characters switch from cards to compact rows. */
export const ODDS_CARD_LIMIT = 4;

/**
 * Chance (0–100) that base + d10 ≥ dv. A d10 shows 1..10, so the roll needs
 * at least (dv − base); needing 1 or less always succeeds, needing 11+ never.
 * @param {number} base stat + rank
 * @param {number} dv
 * @returns {{ pct: number, need: number }}
 */
export function d10Chance(base, dv) {
  const need = Math.round(Number(dv) || 0) - Math.round(Number(base) || 0);
  if (need <= 1) return { pct: 100, need: Math.max(1, need) };
  if (need > 10) return { pct: 0, need };
  return { pct: (11 - need) * 10, need };
}

/** likely / maybe / long shot / can't — as CSS tone keys. */
export function oddsTone(pct) {
  if (pct == null || pct <= 0) return 'none';
  if (pct < ODDS_MAYBE) return 'lo';
  if (pct < ODDS_LIKELY) return 'mid';
  return 'hi';
}

const short = (s) => String(s || '').replace('Electronics/Security Tech', 'Elec/Sec Tech');

/** "password", "password or key item", "password + key item". */
function noRollWays(lock, joiner) {
  return [lock.password && 'password', lock.keyItem && 'key item'].filter(Boolean).join(joiner);
}

/**
 * One character's best way in.
 * @param {{ name: string, role?: string, skills: Object<string,{base:number, found:boolean}> }} pc
 *   `skills` is keyed by the EXACT names on the lock's bypass rows.
 * @param {object} lock see {@link lockOdds}
 */
export function characterOdds(pc, lock) {
  const out = { name: pc.name, role: pc.role || '', img: pc.img || '', pct: null, how: '', none: true, skill: '', base: 0, dv: 0, need: 0 };
  if (!lock.requiresAuth) return { ...out, pct: 100, how: 'open — walks straight in', none: false };
  const others = noRollWays(lock, lock.logic === 'all' ? ' + ' : ' or ');
  if (!lock.skill) {
    out.how = others ? `no roll — only the ${others}` : 'no way in';
    return out;
  }
  let best = null;
  for (const r of lock.rows || []) {
    const s = pc.skills?.[r.name];
    if (!s?.found) continue;
    const c = d10Chance(s.base, r.dv);
    if (!best || c.pct > best.pct || (c.pct === best.pct && s.base - r.dv > best.base - best.dv)) {
      best = { pct: c.pct, need: c.need, skill: r.name, base: s.base, dv: r.dv };
    }
  }
  if (!best) {
    out.pct = 0;
    out.how = (lock.rows || []).length ? 'no skill on the list' : 'no skill set on the lock';
    if (others && lock.logic !== 'all') out.how += ` — only the ${others}`;
    return out;
  }
  let how = `${short(best.skill)} ${best.base} + d10 vs ${best.dv}`;
  if (best.pct === 0) how += ' — can\'t make it';
  else if (best.pct < 100) how += ` (needs ${best.need}+)`;
  if (others) how += lock.logic === 'all' ? `, and the ${others}` : '';
  return { ...out, ...best, how, none: best.pct === 0 };
}

const listNames = (rows) => {
  const names = rows.slice(0, 3).map((r) => r.name).join(', ');
  return rows.length > 3 ? `${names} and ${rows.length - 3} more` : names;
};

/**
 * The verdict line: { tone, title, text } where tone is a meaning key
 * (open | bad | attn | good | info).
 */
export function lockVerdict(lock, rows) {
  if (!lock.requiresAuth) return { tone: 'info', title: 'Open account.', text: 'Anyone at the machine walks straight in.' };
  if (!lock.password && !lock.skill && !lock.keyItem) return { tone: 'bad', title: 'Sealed.', text: 'No way in at all — even you would have to force it open.' };
  if (!lock.skill) return { tone: 'info', title: 'No roll can open it.', text: `Only the ${noRollWays(lock, ' or ')} gets them in — make sure it exists somewhere they can find.` };
  if (!rows.length) return { tone: 'info', title: 'No characters yet.', text: 'Assign or give players a character and their odds show here.' };
  const sorted = [...rows].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const top = sorted[0];
  if (!top || !top.pct) return { tone: 'attn', title: 'Nobody can win the roll.', text: 'Leave the password where they\'ll find it, or bring a DV down.' };
  const able = sorted.filter((r) => (r.pct || 0) >= ODDS_MAYBE);
  if (!able.length) return { tone: 'attn', title: 'Hard.', text: `The best chance is ${top.name} at ${top.pct}% — expect a lockout or two.` };
  if (sorted.every((r) => (r.pct || 0) >= ODDS_LIKELY) && top.pct >= 90) return { tone: 'info', title: 'Easy for everyone', text: '— more a door than a lock.' };
  return { tone: 'good', title: 'Fair.', text: `${listNames(able)} ${able.length === 1 ? 'is the one' : 'are the ones'} to try it (${top.pct}% at best).` };
}

/** The failure-rule note. */
export function lockNote(lock) {
  const n = Math.max(1, Number(lock.maxAttempts) || 3);
  const m = Math.max(0, Number(lock.lockoutMin) || 0);
  const tries = `${n} miss${n === 1 ? '' : 'es'}`;
  let rule = '';
  if (lock.failureMode === 'damage') rule = 'A miss hurts: Black ICE hits the runner. ';
  else if (lock.failureMode === 'permanent') rule = `${tries} lock them out for good. `;
  else if (lock.failureMode === 'nothing') rule = 'A miss costs nothing — they can keep trying. ';
  else rule = `${tries} lock that character out${m ? ` for ${m} min` : ''}. `;
  return `${rule}Their best skill on the list is used. Odds are a plain d10 — no crits or fumbles.`;
}

/**
 * The whole panel's view-model.
 * @param {object} lock { requiresAuth, password, skill, keyItem, rows:[{name,dv}], logic:'any'|'all',
 *                        failureMode, maxAttempts, lockoutMin }
 * @param {Array} party [{ name, role, img, skills: {skillName: {base, found}} }]
 * @param {{ showAll?: boolean }} [opts]
 */
export function lockOdds(lock, party = [], opts = {}) {
  if (!lock?.requiresAuth) return { open: true, verdict: lockVerdict({ requiresAuth: false }, []) };
  const rows = party.map((pc) => characterOdds(pc, lock));
  rows.forEach((r) => { r.tone = oddsTone(r.pct); });
  rows.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.name.localeCompare(b.name));
  const counts = { hi: 0, mid: 0, lo: 0, none: 0 };
  rows.forEach((r) => { counts[r.tone] += 1; });
  const big = rows.length > ODDS_CARD_LIMIT;
  const hiddenCount = big && !opts.showAll ? rows.filter((r) => r.none).length : 0;
  const shown = big && !opts.showAll ? rows.filter((r) => !r.none) : rows;
  return {
    open: false,
    total: rows.length,
    rows,
    shown,
    hiddenCount,
    canFold: big && rows.some((r) => r.none),
    showAll: !!opts.showAll,
    layout: big ? 'list' : 'cards',
    counts,
    realistic: counts.hi + counts.mid,
    spread: ['hi', 'mid', 'lo', 'none'].map((k) => ({ k, w: rows.length ? Math.round((counts[k] / rows.length) * 1000) / 10 : 0 })),
    verdict: lockVerdict(lock, rows),
    note: lockNote(lock),
  };
}

// ─── HTML (string templating, still pure) ───

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const VERDICT_VAR = { info: 'var(--ncm-act, var(--ncm-secondary))', bad: 'var(--ncm-bad, var(--ncm-danger))', attn: 'var(--ncm-attn, var(--ncm-warning))', good: 'var(--ncm-good, var(--ncm-success))' };

function face(r, hue) {
  if (r.img) return `<span class="ncm-lodds__av"><img src="${esc(r.img)}" alt=""></span>`;
  return `<span class="ncm-lodds__av" style="--tc:${hue(r.name)}">${esc(initials(r.name))}</span>`;
}

/**
 * @param {object} vm from {@link lockOdds}
 * @param {{ hue?: (s:string)=>string }} [o] tagHue for initials faces
 */
export function lockOddsHtml(vm, o = {}) {
  const hue = o.hue || (() => 'var(--ncm-text-label)');
  const head = (icon, src) => `<div class="ncm-lodds__hd"><i class="fas ${icon}"></i><span class="ncm-lodds__t">How hard for your party</span><span class="ncm-lodds__src">${src}</span></div>`;
  if (vm.open) return `<div class="ncm-lodds is-open">${head('fa-lock-open', 'Open — anyone at the machine walks straight in.')}</div>`;
  const pct = (r) => (r.pct == null ? '—' : `${r.pct}%`);
  const vc = VERDICT_VAR[vm.verdict.tone] || VERDICT_VAR.info;
  let body = '';
  if (!vm.total) {
    body = '';
  } else if (vm.layout === 'cards') {
    body = `<div class="ncm-lodds__cards">${vm.rows.map((r) => `<div class="ncm-lodds__c ${r.tone}">${face(r, hue)}<span class="nm">${esc(r.name)}${r.role ? `<small>${esc(r.role)}</small>` : ''}</span><span class="p">${pct(r)}</span>
      <span class="ncm-lodds__meter mt"><i style="--w:${r.pct || 0}%"></i></span><span class="how${r.none ? ' no' : ''}">${esc(r.how)}</span></div>`).join('')}</div>`;
  } else {
    const c = vm.counts;
    body = `<div class="ncm-lodds__sum" style="--vc:${vc}"><span><b>${vm.realistic}</b> of ${vm.total} can realistically get in</span>
      <span class="ncm-lodds__dist" data-tooltip="${c.hi} likely · ${c.mid} maybe · ${c.lo} long shot · ${c.none} can't">${vm.spread.map((s) => `<i class="${s.k}" style="width:${s.w}%"></i>`).join('')}</span></div>
      <div class="ncm-lodds__keyrow"><span class="ncm-lodds__key"><span style="--kc:var(--ncm-good, var(--ncm-success))">likely ${c.hi}</span><span style="--kc:var(--ncm-attn, var(--ncm-warning))">maybe ${c.mid}</span><span style="--kc:var(--ncm-bad, var(--ncm-danger))">long shot ${c.lo}</span><span style="--kc:var(--ncm-text-muted)">can't ${c.none}</span></span></div>
      <div class="ncm-lodds__list">${vm.shown.map((r) => `<div class="ncm-lodds__r ${r.tone}${r.none ? ' is-none' : ''}">${face(r, hue)}<span class="nm">${esc(r.name)}${r.role ? ` <small>${esc(r.role)}</small>` : ''}</span>
        <span class="ncm-lodds__meter"><i style="--w:${r.pct || 0}%"></i></span><span class="p">${pct(r)}</span><span class="how">${esc(r.how)}</span></div>`).join('')}</div>
      ${vm.canFold ? `<button type="button" class="ncm-lodds__more" data-lodds-more>${vm.showAll ? 'Hide the ones who can\'t roll' : `+ ${vm.hiddenCount} who can't roll — show them`}</button>` : ''}`;
  }
  return `<div class="ncm-lodds">${head('fa-users', `${vm.total} character${vm.total === 1 ? '' : 's'} · from their sheets`)}
    ${body}<div class="ncm-lodds__v" style="--vc:${vc}"><b>${esc(vm.verdict.title)}</b> ${esc(vm.verdict.text)}</div>
    <div class="ncm-lodds__note">${esc(vm.note)}</div></div>`;
}
