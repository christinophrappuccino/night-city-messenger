/**
 * Admin → Phone → Payphones: every booth in the world, and the booth editor from the approved mock beside a live preview.
 * @file scripts/ui/AdminPanel/tabs/payphonesView.js
 * @module night-city-messenger
 * @description Spec dev/design/PHONE-REVISION.md §Payphones "Where the GM edits it"; mock dev/mockups/payphone-booth-mock.html.
 *   Built as strings (like phoneNumbersView.js). Typing and sliders repaint the preview in place and save after a pause
 *   (never a re-render while typing); buttons, selects and segments save and re-render. Every write goes through
 *   PayphoneService (GM-only). Styles: styles/components/payphone-booth.css (ncm-pph-*).
 */

import { ncmNotify, tipText } from '../../../utils/notify.js';
import { formatCyberDate } from '../../../utils/helpers.js';
import { PP_STYLES, PP_HEAR, PP_HELP, PP_CONDITION, TAG_SPOTS, GRIT_TIERS, WIRE_TIERS, gritTier, wireTier, sanitizeLook, lookFromStyle, placeLabel, safeSound } from '../../../utils/payphones.js';
import { boothHtml } from '../../Calls/boothMarkup.js';
import { wireTorch } from '../../Calls/PayphoneBooth.js';
import { themedPrompt, themedConfirm } from '../../../utils/adminTheme.js';
import { dialogBodyHtml } from '../../../utils/dialogBody.js';
import { showNamePicker } from '../../../utils/namePicker.js';
import { openPayphonePlaceDialog, payphoneAccessEntries, showEntriesMenu } from '../../../integrations/AccessPoints.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svc = () => game.nightcity?.payphoneService;

/** This tab's own state for the page (kept on the tab, so a pop-out keeps its own). */
export const newPayphoneState = () => ({ sel: null, q: '' });

const seg = (key, list, cur) => `<div class="ncm-pph-seg" data-pph-seg="${key}">${list.map(([v, l, tip]) => `<button type="button" data-v="${esc(v)}" class="${v === cur ? 'is-on' : ''}"${tip ? ` data-tooltip="${tipText(tip)}"` : ''}>${esc(l)}</button>`).join('')}</div>`;
const sec = (icon, title, body) => `<section class="ncm-pph-sec"><h5><i class="fas ${icon}"></i>${esc(title)}</h5><div class="ncm-pph-sec__b">${body}</div></section>`;
const row = (label, body) => `<div class="ncm-pph-row"><label>${esc(label)}</label>${body}</div>`;

function rowHtml(pp, sel) {
  const s = svc(), scene = game.scenes.get(pp.sceneId), on = s?.inUse?.get(pp.id);
  const pins = s?.pinsOf?.(pp)?.length || 0;
  const state = pp.condition === 'out' ? '<span class="ncm-tagp is-bad">Out of order</span>' : on ? `<span class="ncm-tagp is-attn">${esc(on.name)} on it</span>` : '';
  return `<button type="button" class="ncm-pph-item${pp.id === sel ? ' is-on' : ''}" data-pph="sel" data-id="${pp.id}">
    <span class="sw" style="background:linear-gradient(180deg,${pp.look.panel} 0 28%,${pp.look.case} 28%);box-shadow:inset 5px 0 0 ${pp.look.hand}"></span>
    <span class="t"><b>${esc(pp.name)}</b><small><span class="ncm-addr">${esc(pp.number)}</span> · ${esc(scene?.name || 'no scene')}${pins ? '' : ' · <em>not on the map</em>'}</small></span>${state}</button>`;
}

function editorHtml(pp) {
  const l = pp.look, s = svc();
  const styles = Object.entries(PP_STYLES).map(([k, p]) => `<button type="button" class="ncm-pph-pre${l.style === k ? ' is-on' : ''}" data-pph="style" data-v="${k}"><span class="sw" style="background:linear-gradient(180deg,${p.panel} 0 28%,${p.case} 28%);box-shadow:inset 6px 0 0 ${p.hand}"></span><span><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></span></button>`).join('');
  const saved = s.styles();
  const savedHtml = saved.length ? `<div class="ncm-pph-saved">${saved.map((x) => `<span class="ncm-pph-chip"><button type="button" data-pph="useSaved" data-id="${x.id}" data-tooltip="Put this look on the booth"><i class="fas fa-swatchbook"></i>${esc(x.name)}</button><button type="button" data-pph="delSaved" data-id="${x.id}" aria-label="Delete ${esc(x.name)}" data-tooltip="Delete this saved look"><i class="fas fa-xmark"></i></button></span>`).join('')}</div>` : '';
  const gt = GRIT_TIERS[gritTier(l.grit)], wt = WIRE_TIERS[wireTier(l.wire)];
  const tags = l.tags.map(([t, c], i) => `<div class="ncm-pph-tag"><span>${TAG_SPOTS[i]}</span><input type="text" maxlength="24" data-pph-in="tag" data-i="${i}" value="${esc(t)}" placeholder="No tag"><input type="color" data-pph-in="tagc" data-i="${i}" value="${c}" aria-label="${TAG_SPOTS[i]} tag colour"></div>`).join('');
  const sound = (k, label, def) => `<div class="ncm-pph-snd"><label>${label}</label><input type="text" data-pph-in="snd" data-k="${k}" value="${esc(pp.sounds[k])}" placeholder="${esc(def)}"><button type="button" data-pph="sndBrowse" data-k="${k}" aria-label="Browse" data-tooltip="Pick a file"><i class="fas fa-folder-open"></i></button><button type="button" data-pph="sndPlay" data-k="${k}" aria-label="Play" data-tooltip="Hear it"><i class="fas fa-play"></i></button></div>`;
  return `<div class="ncm-pph-ed">
    ${sec('fa-location-dot', 'Where', `${row('Place', `<input type="text" data-pph-in="name" value="${esc(pp.name)}" maxlength="60" placeholder="Kabuki, Night Market">`)}
      <div class="ncm-pph-hint">The screen and a trace show <b>${esc(placeLabel(pp))}</b>.</div>
      ${row('Number', `<div class="ncm-pph-num"><span class="ncm-addr">${esc(pp.number)}</span><button type="button" class="ncm-pph-btn" data-pph="newNumber" data-tooltip="Give it another free number"><i class="fas fa-dice"></i> Another</button></div>`)}
      ${row('Reach', `<div class="ncm-pph-num"><input type="number" min="0" max="20" data-pph-ch="range" value="${pp.range}"><span class="ncm-pph-hint">squares from a pin. 0 = anywhere on the scene.</span></div>`)}`)}
    ${sec('fa-swatchbook', 'Style', `<div class="ncm-pph-presets">${styles}</div>${savedHtml}
      <div class="ncm-pph-acts"><button type="button" class="ncm-pph-btn" data-pph="saveLook"><i class="fas fa-floppy-disk"></i> Save this look</button></div>`)}
    ${sec('fa-palette', 'Colours & brand', `${row('Brand line', `<input type="text" data-pph-in="brand" value="${esc(l.brand)}" maxlength="40">`)}
      ${row('Colours', `<div class="ncm-pph-cols"><label><input type="color" data-pph-in="case" value="${l.case}">Casing</label><label><input type="color" data-pph-in="hand" value="${l.hand}">Handset</label><label><input type="color" data-pph-in="ink" value="${l.ink}">Screen</label></div>`)}
      ${row('Grit', `<div class="ncm-pph-meter"><input type="range" min="0" max="100" data-pph-in="grit" value="${l.grit}"><b data-pph-gv>${gt[1]}<small>${l.grit}</small></b></div>`)}
      <div class="ncm-pph-hint" data-pph-gh>${esc(gt[2])}</div>
      ${row('Wiring', `<div class="ncm-pph-meter"><input type="range" min="0" max="100" data-pph-in="wire" value="${l.wire}"><b data-pph-wv>${wt[1]}<small>${l.wire}</small></b></div>`)}
      <div class="ncm-pph-hint" data-pph-wh>${esc(wt[2])}</div>
      <label class="ncm-pph-chk"><input type="checkbox" data-pph-ch="stickers"${l.stickers ? ' checked' : ''}> Stickers</label>`)}
    ${sec('fa-spray-can', 'Graffiti', `<div class="ncm-pph-tags">${tags}</div><div class="ncm-pph-hint">Up to three tags: big on the casing, small low down, smaller on the top plate. Empty = none.</div>`)}
    ${sec('fa-display', 'Screen text', `${row('Waiting', `<input type="text" data-pph-in="idle" value="${esc(l.idle)}" maxlength="40">`)}
      ${row('Ad ticker', `<textarea data-pph-in="tick" placeholder="One line each; they scroll in turn">${esc(l.tick.join('\n'))}</textarea>`)}
      ${row('Condition', seg('condition', PP_CONDITION, pp.condition))}
      <div class="ncm-pph-hint">Out of order: no dial tone, and calls to it ring out. Grit 85+ looks wrecked but still works.</div>`)}
    ${sec('fa-users', 'Who can hear', `${row('Calls are', seg('hear', PP_HEAR, pp.hear))}
      ${row('Help key', `<select data-pph-ch="help">${PP_HELP.map(([v, t]) => `<option value="${v}"${v === pp.help ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`)}
      <div class="ncm-pph-hint">One handset, one caller. On speaker, everyone in reach follows the call on a read-only strip.</div>`)}
    ${sec('fa-volume-high', 'Sounds', `${sound('ring', 'Ring', 'Payphone bell (Sound Board)')}${sound('key', 'Keys', 'Tones')}${sound('hook', 'Hook', 'Hook switch (Sound Board)')}
      <div class="ncm-pph-hint">Empty = the default. A file here is for this booth only; it must be somewhere players can load.</div>`)}
  </div>`;
}

function logHtml(pp) {
  const list = (svc()?.logOf?.(pp.id) || []).slice(0, 8);
  if (!list.length) return '<div class="ncm-pph-hint">No calls from or to this payphone yet.</div>';
  return `<ul class="ncm-pph-log">${list.map((l) => {
    const out = l.direction === 'out', other = out ? l.to : l.from, me = l.me || {};
    return `<li><i class="fas ${out ? 'fa-arrow-up-right' : 'fa-arrow-down-left'}"></i><span class="t"><b>${esc(me.realName || 'Nobody')}</b> ${out ? 'called' : 'answered'} <b>${esc(other?.anon ? 'a withheld number' : (other?.name || other?.number || 'someone'))}</b><small>${esc(l.outcome || '')}${l.seconds ? ` · ${l.seconds}s` : ''}</small></span><span class="when">${esc(formatCyberDate(l.gameTime || l.startedAt))}</span></li>`;
  }).join('')}</ul>`;
}

/** The page. */
export function payphonesHtml(tab) {
  const s = svc();
  if (!s) return '<div class="ncm-pph"><div class="ncm-ph2-none">Payphones are not loaded.</div></div>';
  const st = tab._pp ??= newPayphoneState();
  const all = s.getAll();
  if (st.sel && !all.some((p) => p.id === st.sel)) st.sel = null;
  if (!st.sel && all.length) st.sel = all[0].id;
  const q = st.q.trim().toLowerCase();
  const shown = q ? all.filter((p) => `${p.name} ${p.number} ${game.scenes.get(p.sceneId)?.name || ''}`.toLowerCase().includes(q)) : all;
  const pp = all.find((p) => p.id === st.sel) || null;
  const head = `<header class="ncm-tabhd"><i class="fas fa-phone-volume"></i><div><h2>Payphones</h2><p>Booths on the map anyone standing at can call from. Pick one to change how it looks and works.</p></div></header>`;
  const list = `<aside class="ncm-pph-list">
    <div class="ncm-pph-tb"><input type="search" data-pph-q value="${esc(st.q)}" placeholder="Find a payphone…" aria-label="Find a payphone"><button type="button" class="ncm-pph-btn is-primary" data-pph="new"><i class="fas fa-plus"></i> New</button></div>
    <div class="ncm-pph-items" data-sc="pph-list">${shown.map((p) => rowHtml(p, st.sel)).join('') || `<div class="ncm-pph-empty">${all.length ? 'Nothing matches.' : 'No payphones yet. New makes one with a free number; then place it on a scene.'}</div>`}</div>
  </aside>`;
  if (!pp) return `<div class="ncm-pph">${head}<div class="ncm-pph-cols2">${list}<div class="ncm-pph-detail"><div class="ncm-pph-empty"><i class="fas fa-phone"></i><p>A payphone is a booth on the map. Anyone in reach can call from it: the other end and a trace see the place, never the person. Calls to it ring the whole scene; whoever stands at it can pick up.</p><button type="button" class="ncm-pph-btn is-primary" data-pph="new"><i class="fas fa-plus"></i> New payphone</button></div></div></div></div>`;
  const pins = s.pinsOf(pp).length;
  const scene = game.scenes.get(pp.sceneId);
  return `<div class="ncm-pph">${head}<div class="ncm-pph-cols2">${list}
  <div class="ncm-pph-detail">
    <div class="ncm-pph-dhead"><div><h3>${esc(placeLabel(pp))}</h3><p><span class="ncm-addr">${esc(pp.number)}</span> · ${esc(scene?.name || 'no scene')} · ${pins ? `${pins} on the map` : '<span class="ncm-tagp is-attn">not on the map yet</span>'}</p></div>
      <div class="ncm-pph-acts">
        <button type="button" class="ncm-pph-btn is-primary" data-pph="place"><i class="fas fa-map-pin"></i> Place on a scene…</button>
        <button type="button" class="ncm-pph-btn" data-pph="ring" data-tooltip="Ring it as one of your NPCs"><i class="fas fa-phone-volume"></i> Ring it as…</button>
        <button type="button" class="ncm-pph-btn" data-pph="open"><i class="fas fa-phone"></i> Open it</button>
        ${scene ? '<button type="button" class="ncm-pph-btn" data-pph="scene"><i class="fas fa-map"></i> Go to scene</button>' : ''}
        <button type="button" class="ncm-pph-btn" data-pph="access" data-tooltip="Hotbar, chat card, journal link, macro"><i class="fas fa-ellipsis"></i></button>
        <button type="button" class="ncm-pph-btn is-bad" data-pph="del" aria-label="Delete" data-tooltip="Delete this payphone"><i class="fas fa-trash"></i></button>
      </div></div>
    <div class="ncm-pph-work">${editorHtml(pp)}
      <div class="ncm-pph-side"><div class="ncm-pph-prev" data-pph-prev>${previewHtml(pp)}</div>
        <div class="ncm-pph-hint ncm-pph-hint--c">Move the cursor over a hole in the casing: it works as a torch.</div>
        ${sec('fa-list', 'Its calls', logHtml(pp))}</div>
    </div>
  </div></div></div>`;
}

function previewHtml(pp) {
  return `<div class="ncm-pb-preview"><div class="ncm-pb-frame" style="--pb-zoom:.56">${boothHtml({ look: pp.look, uid: `pv${pp.id}`, place: pp.name, number: pp.number, condition: pp.condition, helpKey: !!pp.help, helpLabel: pp.help === 'TRAUMA' ? 'Trauma' : 'NCPD', preview: true })}</div></div>`;
}

/** Wire the page. It is rebuilt on every render, so nothing here needs taking down. */
export function wirePayphones(tab, root) {
  const box = root.querySelector('.ncm-pph');
  if (!box) return;
  const s = svc(), st = tab._pp ??= newPayphoneState();
  const cur = () => s.get(st.sel);
  let draft = cur(), saveT = null;
  const prev = box.querySelector('[data-pph-prev]');
  if (prev) wireTorch(prev.querySelector('.ncm-pb'));
  const repaint = () => { if (prev && draft) { prev.innerHTML = previewHtml(draft); wireTorch(prev.querySelector('.ncm-pb')); } };
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => s.save(draft), 450); };
  const saveNow = async (patch, render = true) => { clearTimeout(saveT); draft = { ...draft, ...patch }; await s.save(draft); if (render) tab.app.render(); };

  box.querySelector('[data-pph-q]')?.addEventListener('input', (e) => { clearTimeout(tab._pphQ); tab._pphQ = setTimeout(() => { st.q = e.target.value; tab.app.render(); }, 220); });

  // typing and sliders: the preview follows, the save waits
  box.addEventListener('input', (e) => {
    const t = e.target, k = t.dataset?.pphIn;
    if (!k || !draft) return;
    const look = { ...draft.look };
    if (k === 'name') draft = { ...draft, name: t.value };
    else if (k === 'tag' || k === 'tagc') { const tags = look.tags.map((x) => [...x]); tags[+t.dataset.i][k === 'tag' ? 0 : 1] = t.value; look.tags = tags; }
    else if (k === 'tick') look.tick = t.value.split('\n');
    else if (k === 'grit' || k === 'wire') look[k] = +t.value;
    else if (k === 'snd') { draft = { ...draft, sounds: { ...draft.sounds, [t.dataset.k]: t.value } }; saveSoon(); return; }
    else look[k] = t.value;
    if (k !== 'name' && k !== 'snd') draft = { ...draft, look: sanitizeLook(look) };
    if (k === 'grit') { const g = GRIT_TIERS[gritTier(+t.value)]; box.querySelector('[data-pph-gv]').innerHTML = `${g[1]}<small>${t.value}</small>`; box.querySelector('[data-pph-gh]').textContent = g[2]; }
    if (k === 'wire') { const w = WIRE_TIERS[wireTier(+t.value)]; box.querySelector('[data-pph-wv]').innerHTML = `${w[1]}<small>${t.value}</small>`; box.querySelector('[data-pph-wh]').textContent = w[2]; }
    repaint(); saveSoon();
  });
  box.addEventListener('change', (e) => {
    const t = e.target, k = t.dataset?.pphCh;
    if (!k || !draft) return;
    if (k === 'stickers') saveNow({ look: sanitizeLook({ ...draft.look, stickers: t.checked }) });
    if (k === 'help') saveNow({ help: t.value });
    if (k === 'range') saveNow({ range: +t.value || 0 });
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pph], [data-pph-seg] button');
    if (!b || !box.contains(b)) return;
    const segEl = b.closest('[data-pph-seg]');
    try {
      if (segEl && !b.dataset.pph) return saveNow({ [segEl.dataset.pphSeg]: b.dataset.v });
      switch (b.dataset.pph) {
        case 'sel': st.sel = b.dataset.id; return tab.app.render();
        case 'new': {
          const pp = await s.create({ sceneId: canvas?.scene?.id });
          if (pp) { st.sel = pp.id; tab.app.render(); }
          return;
        }
        case 'style': return saveNow({ look: { ...lookFromStyle(b.dataset.v) }, help: PP_STYLES[b.dataset.v]?.help ?? draft.help });
        case 'useSaved': { const x = s.styles().find((y) => y.id === b.dataset.id); return x && saveNow({ look: sanitizeLook(x.look) }); }
        case 'delSaved': await s.deleteStyle(b.dataset.id); return tab.app.render();
        case 'saveLook': {
          const name = await themedPrompt({ title: 'Save this look', label: 'Save', icon: 'fas fa-floppy-disk', content: dialogBodyHtml({ tone: 'act', icon: 'fas fa-swatchbook', title: 'A saved look', lead: 'Colours, grit, wiring, graffiti and screen text — to put on other booths.', field: { label: 'Name', name: 'name', value: '', placeholder: 'Watson street booth' } }), read: (r) => r.querySelector('input[name=name]')?.value?.trim() || null });
          if (name) { await s.save(draft); await s.saveStyle(name, draft.look); tab.app.render(); }
          return;
        }
        case 'newNumber': { const n = game.nightcity?.callService?.suggestNumbers?.({ count: 1 })?.[0]?.number; return n ? saveNow({ number: n }) : ncmNotify.warn('No free number.'); }
        case 'place': await s.save(draft); return openPayphonePlaceDialog(draft.id);
        case 'open': await s.save(draft); return s.open(draft.id, { skipReach: true });
        case 'scene': return game.scenes.get(draft.sceneId)?.view();
        case 'ring': return ringAs(draft);
        case 'access': return showEntriesMenu(payphoneAccessEntries(draft.id), b);
        case 'sndBrowse': {
          const FP = (typeof FilePicker !== 'undefined') ? FilePicker : foundry.applications?.apps?.FilePicker;
          return new FP({ type: 'audio', current: draft.sounds[b.dataset.k] || '', callback: (p) => saveNow({ sounds: { ...draft.sounds, [b.dataset.k]: safeSound(p) } }) }).render(true);
        }
        case 'sndPlay': {
          const k = b.dataset.k, own = draft.sounds[k];
          if (own) return game.nightcity?.soundService?.preview?.(null, { src: own });
          return game.nightcity?.soundService?.preview?.(k === 'ring' ? 'payphone-ring' : k === 'hook' ? 'payphone-hook' : 'call-connect');
        }
        case 'del': {
          const ok = await themedConfirm({ title: 'Delete payphone', yes: 'Delete it', yesIcon: 'fas fa-trash', bad: true, content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-phone-slash', title: placeLabel(draft), kind: 'Payphone', lead: 'Delete this payphone?', goes: ['Its pins and step-on areas on every scene', 'Its number (free to reuse)'], stays: ['Its call log, for the GM'] }) });
          if (ok) { await s.remove(draft.id); st.sel = null; tab.app.render(); }
          return;
        }
        default: return;
      }
    } catch (err) { console.error('NCM | Payphones:', err); ncmNotify.error(`Payphones: ${err.message}`); }
  });
}

/** Ring a booth as an NPC from the directory (the call comes from that NPC's number). */
async function ringAs(pp) {
  const cs = game.nightcity?.callService, mcs = game.nightcity?.masterContactService;
  const entries = (mcs?.getAll?.() || []).filter((c) => cs?.numberOfContact?.(c.id)).map((c) => ({ id: c.id, name: c.name, img: c.portrait || 'icons/svg/mystery-man.svg', sub: cs.numberOfContact(c.id) }));
  if (!entries.length) return ncmNotify.warn('None of your NPCs has a number. Give one a number in Admin → Phone → Numbers.');
  const pick = await showNamePicker({ title: `Ring ${placeLabel(pp)} as…`, entries, placeholder: 'find an NPC…' });
  if (pick?.id) await svc()?.ringAs(pp.id, { contactId: pick.id });
}

