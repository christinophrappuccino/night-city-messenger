/**
 * Chat card actions — the per-client half of a shared-message card.
 * @file scripts/integrations/ChatCards.js
 * @module night-city-messenger
 * @description A chat message is ONE block of HTML that every client sees, so a
 *   card cannot know who is reading it. Foundry's `renderChatMessage` hook runs
 *   on each client, which is where the From/To rows get their add-contact
 *   affordance: an **Add contact** button when that person is not in the
 *   viewer's own contacts, a quiet "in contacts" when they are, nothing for the
 *   viewer themself, a masked anonymous sender (the card carries no ids for one),
 *   a send-only system address, or a group copy's joined address list.
 *
 *   Clicking adds them the way the inbox's Add does (name / address / portrait /
 *   actor link / directory id, through ContactRepository.addContact), then flips
 *   the button to "in contacts" in that card without a reload.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, resolveOperator } from '../utils/helpers.js';

const ROW = '.ncm-cc__p';
const BTN_ACTION = 'ncm-add-contact';

/** Whether the viewer's contact list already holds this row's person. */
export function rowIsContact(contacts, { email, actorId, contactId }) {
  const e = String(email || '').toLowerCase().trim();
  return (contacts || []).some((c) =>
    (contactId && c.masterContactId === contactId)
    || (e && String(c.email || '').toLowerCase().trim() === e)
    || (actorId && (c.actorId === actorId || c.linkedActorId === actorId)));
}

/** Which affordance a row gets for THIS viewer: 'add' | 'in' | null. Pure, so the sim drives it. */
export function rowAffordance(row, { viewerActorId, contacts, isSendOnly }) {
  if (!row) return null;
  const email = row.email || '';
  if (!email && !row.actorId) return null;
  if (email.includes(',')) return null;                       // a group copy's joined "a, b" address
  if (row.actorId && row.actorId === viewerActorId) return null;
  if (email && isSendOnly?.(email)) return null;
  return rowIsContact(contacts, row) ? 'in' : 'add';
}

const rowData = (el) => ({
  email: el.dataset.ncmEmail || '',
  actorId: el.dataset.ncmActor || '',
  contactId: el.dataset.ncmContact || '',
  name: el.dataset.ncmName || '',
  portrait: el.dataset.ncmPortrait || '',
});

const inHtml = () => '<span class="ncm-cc__in">in contacts</span>';
const addHtml = () => `<button type="button" class="ncm-cc__act" data-action="${BTN_ACTION}" title="Add to your contacts"><i class="fas fa-user-plus"></i>Add contact</button>`;

/** Paint the slots of every card inside `root` for the current viewer. */
export function decorateChatCards(root) {
  const rows = root?.querySelectorAll?.(`${ROW}[data-ncm-email], ${ROW}[data-ncm-actor]`);
  if (!rows?.length) return;
  const me = resolveOperator();
  if (!me) return;
  const contacts = me.getFlag?.(MODULE_ID, 'contacts') || [];
  const master = game.nightcity?.masterContactService;
  const isSendOnly = (email) => !!master?.isSendOnly?.(email);
  for (const el of rows) {
    const slot = el.querySelector('.ncm-cc__slot');
    if (!slot) continue;
    const a = rowAffordance(rowData(el), { viewerActorId: me.id, contacts, isSendOnly });
    slot.innerHTML = a === 'add' ? addHtml() : a === 'in' ? inHtml() : '';
  }
}

/** The click: add the row's person to the viewer's contacts. */
export async function addContactFromCard(btn) {
  const el = btn.closest(ROW);
  const slot = el?.querySelector('.ncm-cc__slot');
  const d = el ? rowData(el) : null;
  const me = resolveOperator();
  const repo = game.nightcity?.contactRepository;
  if (!d || !me || !repo?.addContact) { ui.notifications?.warn('NCM | Contact system unavailable.'); return false; }
  btn.disabled = true;
  try {
    const master = game.nightcity?.masterContactService;
    const mc = (d.contactId && master?.getContact?.(d.contactId)) || (d.actorId && master?.getByActorId?.(d.actorId)) || null;
    const result = await repo.addContact(me.id, {
      name: d.name || d.email,
      email: d.email,
      actorId: d.actorId || mc?.actorId || null,
      masterContactId: mc?.id || d.contactId || null,
      portrait: d.portrait || mc?.portrait || '',
      trust: 'neutral',
      notes: 'Added from a shared message in chat',
    });
    if (result?.success) {
      if (slot) slot.innerHTML = inHtml();
      ui.notifications?.info(`NCM | Added "${d.name || d.email}" to contacts.`);
      game.nightcity?.soundService?.play?.('receive');
      return true;
    }
    if (/already exists/i.test(result?.error || '')) { if (slot) slot.innerHTML = inHtml(); return true; }
    ui.notifications?.warn(`NCM | ${result?.error || 'Could not add contact.'}`);
    btn.disabled = false;
    return false;
  } catch (err) {
    log.warn(`ChatCards: add contact failed: ${err.message}`);
    ui.notifications?.error('NCM | Failed to add contact.');
    btn.disabled = false;
    return false;
  }
}

/** Register the render hook + the delegated click. Call once per client. */
export function registerChatCardHooks() {
  Hooks.on('renderChatMessage', (message, html) => {
    try { decorateChatCards(html?.[0] ?? html); } catch (err) { log.warn(`ChatCards: decorate failed: ${err.message}`); }
  });
  // Capture-phase at the document: chat HTML cannot carry its own listeners,
  // and Foundry's own chat handlers must not swallow the click first.
  document.addEventListener('click', (ev) => {
    const btn = ev.target?.closest?.(`button[data-action="${BTN_ACTION}"]`);
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    addContactFromCard(btn);
  }, true);
}
