// NCM audit fix A4a — "can a name full of HTML run script on the GM's screen?"
// Paste into a Script macro and run it as the GM (one client is enough).
//
// It feeds a booby-trapped name — an <img> whose onerror sets a flag — into the
// three places A4a fixed, then checks whether any of them ran it:
//   1. a toast                         (ncmNotify, SEC-03)
//   2. the Admin → Overview activity feed (SEC-11) — opens the panel on Overview
//   3. the composer's To autocomplete   (SEC-12)
// Results arrive as a whispered chat card: PASS = shown as text, never run.
//
// Side effects: one "Contact … pushed to …" test row in the Overview activity
// list (kept in memory only — gone on reload) and one warning toast. Nothing is
// written to the world.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Run this as the GM.'); return; }
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fired = (window.__ncmA4a = new Set());
  const bait = (label) => `<img src="ncm-a4a-${label}.invalid" onerror="window.__ncmA4a.add('${label}')"> A4A-${label}`;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });

  let ncmNotify, MessageComposerApp;
  try {
    ({ ncmNotify } = await import(`${base}/utils/notify.js`));
    ({ MessageComposerApp } = await import(`${base}/ui/MessageComposer/MessageComposerApp.js`));
  } catch (err) {
    ui.notifications.error(`A4a test: could not load NCM modules — ${err.message}`);
    return;
  }

  // ── 1. Toast ──
  ncmNotify.warn(`A4a test toast: ${bait('toast')}`);
  await sleep(900);
  // The on-screen toast must show the tag as plain "<img …" text — not run it,
  // and not "&lt;img" (that would mean it was escaped twice). Foundry also logs
  // toasts to the browser console; the console copy shows "&lt;img", that's normal.
  const toastLi = [...document.querySelectorAll('#notifications li')].find((li) => li.textContent.includes('A4A-toast'));
  const toastText = toastLi?.textContent || '';
  check('Toast shows the name as text', !!toastLi && !fired.has('toast') && toastText.includes('<img') && !toastText.includes('&lt;'),
    fired.has('toast') ? 'the image tag RAN'
      : !toastLi ? 'toast not found on screen — look for it manually'
      : toastText.includes('&lt;') ? 'shows &lt; — escaped twice' : '');

  // ── 2. Overview activity feed ──
  // The row the fixed code BUILT is checked directly (the Overview timeline may
  // fold a row behind "+N earlier" in a busy world, so on-screen text is only a
  // bonus). It is also rendered into a scratch element to prove nothing runs.
  try {
    const adminPanel = await game.nightcity.openAdminTab('overview');
    await sleep(700);
    game.nightcity.eventBus.emit('contacts:shared', { contactName: bait('overview'), targetActorName: 'A4a test' });
    await sleep(1200);
    const row = (adminPanel?.tabs?.overview?._activityLog || []).find((e) => String(e.html).includes('A4A-overview'));
    if (!row) {
      check('Overview activity row escapes the name', false, 'no test row was logged — is the admin panel open?');
    } else {
      const scratch = document.createElement('div');
      scratch.innerHTML = row.html;                                   // what {{{html}}} does
      await sleep(500);
      const live = scratch.querySelectorAll('img').length;
      check('Overview activity row escapes the name', live === 0 && !fired.has('overview') && scratch.textContent.includes('ncm-a4a-overview.invalid'),
        live ? 'the row contains a live <img> element' : '');
      const onScreen = [...document.querySelectorAll('.ncm-admin-panel')].some((e) => e.textContent.includes('ncm-a4a-overview.invalid'));
      check('(info) test row visible on the Overview right now', true, onScreen ? 'yes, shown as text' : 'not on screen (folded into the timeline — fine)');
    }
  } catch (err) {
    check('Overview activity row escapes the name', false, `could not open the Overview: ${err.message}`);
  }

  // ── 3. Composer To autocomplete (drives the real renderer into a scratch element) ──
  const dropdown = document.createElement('div');
  const fake = {
    element: { querySelector: (sel) => (sel.includes('autocomplete-dropdown') ? dropdown : null) },
    _selectedResultIndex: 0,
    fromContact: { name: bait('tooltip') },
    _searchResults: [{ name: bait('autocomplete'), email: 'a4a@test.nc', initials: 'A4', actorId: 'a4a', known: true }],
  };
  try { MessageComposerApp.prototype._renderAutocomplete.call(fake, 'a4a'); } catch (err) { /* click wiring needs a real window; the HTML is what matters */ }
  await sleep(500);
  const imgs = dropdown.querySelectorAll('img[src*="ncm-a4a-"]').length;
  check('Autocomplete shows the name as text', imgs === 0 && !fired.has('autocomplete') && dropdown.textContent.includes('A4A-autocomplete'),
    imgs ? `${imgs} live <img> element(s) in the dropdown` : '');
  const tipText = dropdown.querySelector('[data-tooltip]')?.dataset.tooltip || '';
  check('Autocomplete tooltip is escaped (Foundry renders tooltips as HTML)', !tipText.includes('<img'), tipText.includes('<img') ? 'raw tag in tooltip' : '');

  // ── Report ──
  await sleep(300);
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${r.note}</i>` : ''}</li>`).join('');
  ChatMessage.create({
    whisper: [game.user.id],
    content: `<b>NCM A4a test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>`
      + `<p style="font-size:11px;opacity:.75">Scripts that ran: ${fired.size ? [...fired].join(', ') : 'none'}</p>`,
  });
})();
