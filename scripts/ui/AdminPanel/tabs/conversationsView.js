/**
 * Admin → Messages → Conversations: watching and stepping in.
 * @file scripts/ui/AdminPanel/tabs/conversationsView.js
 * @module night-city-messenger
 * @description Mock dev/mockups/conversations-mock.html (Admin states), approved 2026-11-02. Reading here is invisible: no member is
 *   added, nobody is told, nothing is marked read. The list filters without a redraw; the chat is the same pane players get, in GM mode.
 */

import { EVENTS } from '../../../utils/constants.js';
import { isIn } from '../../../utils/conversations.js';
import { titleFor } from '../../../utils/conversations.js';
import { ConversationPane, avatar, startConversationDialog } from '../../MessageViewer/conversationPane.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svc = () => game.nightcity?.conversationService;

const relative = (app, at) => { try { return app?._relativeTime?.(at) || ''; } catch { return ''; } };

export const convCount = () => (svc()?.enabled ? svc().all().length : 0);
export const convWaiting = () => { const s = svc(); if (!s?.enabled) return 0; return s.all().filter((c) => c.members.some((m) => isIn(m) && s.isNpc(m)) && s.waiting(c).n > 0).length; };

export function newConvState() { return { sel: null, q: '', show: 'all', who: '', sort: 'latest' }; }

function rowsFor(st) {
  const s = svc();
  let rows = s.all().map((c) => {
    const npc = c.members.some((m) => isIn(m) && s.isNpc(m));
    const wait = npc ? s.waiting(c) : { n: 0, who: '' };
    return { c, npc, wait, title: titleFor(c) };
  });
  const q = st.q.trim().toLowerCase();
  rows = rows.filter((r) => (st.show === 'all' || (st.show === 'wait' && r.wait.n) || (st.show === 'npc' && r.npc) || (st.show === 'players' && !r.npc))
    && (!st.who || r.c.members.some((m) => m.key === st.who))
    && (!q || r.title.toLowerCase().includes(q) || r.c.members.some((m) => m.name.toLowerCase().includes(q))));
  const by = { latest: (a, b) => new Date(b.c.lastAt) - new Date(a.c.lastAt), waiting: (a, b) => (b.wait.n - a.wait.n) || (new Date(a.c.lastAt) - new Date(b.c.lastAt)), lines: (a, b) => b.c.lastSeq - a.c.lastSeq };
  return rows.sort(by[st.sort] || by.latest);
}

export function conversationsHtml(st, app) {
  const s = svc();
  const all = s.all();
  const counts = { all: all.length, wait: convWaiting(), npc: all.filter((c) => c.members.some((m) => isIn(m) && s.isNpc(m))).length };
  counts.players = counts.all - counts.npc;
  const people = [...new Map(all.flatMap((c) => c.members).map((m) => [m.key, m.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const opt = (v, t, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(t)}</option>`;
  const rows = rowsFor(st);
  if (!rows.some((r) => r.c.id === st.sel)) st.sel = rows[0]?.c.id || null;
  const list = rows.map((r) => {
    const { c } = r;
    const tag = r.wait.n ? `<span class="ncm-tagp is-attn"><i class="fas fa-clock"></i> ${r.wait.n} waiting${r.wait.who ? ` on ${esc(r.wait.who)}` : ''}</span>` : r.npc ? '<span class="ncm-tagp is-plain">Has an NPC</span>' : '<span class="ncm-tagp is-plain">Players only</span>';
    return `<button type="button" class="ncm-conv__arow${c.id === st.sel ? ' is-on' : ''}" data-conv-sel="${esc(c.id)}"><span class="ncm-conv__stack">${c.members.filter(isIn).slice(0, 3).map((m) => avatar(s._displayOf(m))).join('')}</span><span class="ncm-conv__arowtx"><b>${esc(r.title)}</b><small>${!c.lastPreview ? 'Nothing yet' : c.lastPreview.from ? `${esc(c.lastPreview.from)}: ${esc(c.lastPreview.text)}` : esc(c.lastPreview.text)}</small><span class="ncm-conv__atags">${tag}<span class="ncm-conv__acount">${c.lastSeq} lines</span></span></span><span class="ncm-conv__time">${esc(relative(app, c.lastAt))}</span></button>`;
  }).join('');
  return `<div class="ncm-conv__atb"><label class="ncm-conv__asearch"><i class="fas fa-magnifying-glass"></i><input type="text" data-conv-q value="${esc(st.q)}" placeholder="Title or member" aria-label="Search conversations"></label>
      <label class="ncm-conv__asel" data-tooltip="Narrow the list">Show<select data-conv-show aria-label="Show">${opt('all', `All (${counts.all})`, st.show)}${opt('wait', `NPC waiting (${counts.wait})`, st.show)}${opt('npc', `Has an NPC (${counts.npc})`, st.show)}${opt('players', `Players only (${counts.players})`, st.show)}</select></label>
      <label class="ncm-conv__asel" data-tooltip="Only conversations with this person">Who<select data-conv-who aria-label="Who is in it">${opt('', 'Anyone', st.who)}${people.map(([k, n]) => opt(k, n, st.who)).join('')}</select></label>
      <label class="ncm-conv__asel">Sort<select data-conv-sort aria-label="Sort">${opt('latest', 'Latest', st.sort)}${opt('waiting', 'Longest waiting', st.sort)}${opt('lines', 'Most lines', st.sort)}</select></label></div>
    <div class="ncm-conv__adminsplit"><div class="ncm-conv__adminlist ncm-scrollbar">${list || `<div class="ncm-conv__panelnote" style="padding:12px">${all.length ? 'Nothing matches.' : 'No conversations yet. Players can start one from their Agent, or use New.'}</div>`}</div><div class="ncm-conv__adminpane" data-conv-pane></div></div>`;
}

/** Wire the rendered view. It is rebuilt with the tab. */
export function wireConversations(tab, root) {
  const box = root.querySelector('[data-conv-admin]');
  if (!box) { tab._convPane?.leave(); return; }
  tab._conv ??= newConvState();
  const st = tab._conv;
  tab._convPane ??= new ConversationPane({ admin: true });
  const pane = tab._convPane;
  const repaint = () => { pane.snapshot(); box.innerHTML = conversationsHtml(st, tab.app); mount(); };
  const mount = () => { const host = box.querySelector('[data-conv-pane]'); if (host && st.sel) pane.mount(host, st.sel); else pane.leave(); };
  box.innerHTML = conversationsHtml(st, tab.app);
  mount();
  box.addEventListener('click', (e) => { const r = e.target.closest('[data-conv-sel]'); if (r) { st.sel = r.dataset.convSel; repaint(); } });
  box.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-conv-show]')) st.show = t.value; else if (t.matches('[data-conv-who]')) st.who = t.value; else if (t.matches('[data-conv-sort]')) st.sort = t.value; else return;
    repaint();
  });
  box.addEventListener('input', (e) => { if (!e.target.matches('[data-conv-q]')) return; st.q = e.target.value; clearTimeout(tab._convT); tab._convT = setTimeout(() => { const at = e.target.selectionStart; repaint(); const q = box.querySelector('[data-conv-q]'); q?.focus(); q?.setSelectionRange(at, at); }, 180); });
  // live: a new line appends to the open chat; the list repaints only its rows
  if (!tab._convBus) {
    const bus = game.nightcity?.eventBus;
    const onLine = ({ id, lines }) => { const b = tab.element?.querySelector?.('[data-conv-admin]'); if (!b) return; if (pane.id === id) pane.onLines(lines); const list = b.querySelector('.ncm-conv__adminlist'); if (list) { const tmp = document.createElement('div'); tmp.innerHTML = conversationsHtml(st, tab.app); const next = tmp.querySelector('.ncm-conv__adminlist'); if (next) list.innerHTML = next.innerHTML; } };
    const onChange = () => { if (tab.element?.querySelector?.('[data-conv-admin]')) tab.render(true); };
    bus?.on?.(EVENTS.CONVERSATION_LINE, onLine);
    bus?.on?.(EVENTS.CONVERSATION_UPDATED, onChange);
    tab._convBus = () => { bus?.off?.(EVENTS.CONVERSATION_LINE, onLine); bus?.off?.(EVENTS.CONVERSATION_UPDATED, onChange); };
  }
}

export function closeConversations(tab) { tab._convPane?.leave(); tab._convBus?.(); tab._convBus = null; }

/** New → Conversation, from anywhere in Messages. */
export async function newConversationAdmin(tab, host) {
  const id = await startConversationDialog({ host, gm: true });
  if (id) { tab._conv ??= newConvState(); tab._conv.sel = id; tab._view = 'conv'; tab.render(true); }
}
