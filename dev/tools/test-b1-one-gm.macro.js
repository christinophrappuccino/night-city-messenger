// NCM audit fix B1 — "does exactly ONE GM handle each player request?"
// One Script macro (give players Observer permission on it).
//
//   1. EVERY GM that is logged in runs it   → each starts watching.
//   2. A player runs it                     → sends one ordinary request through
//                                             NCM: a harmless "probe" success row
//                                             for the Security activity log (no heat).
//   3. Each GM runs it again                → each reports, then cleans up.
//
// What each GM's report shows:
//   • "This GM handled it: N time(s)" — counted on THIS client, by watching its
//     own trace service for the test. Across all GMs the total must be exactly 1,
//     and it should be the active GM.
//   • Who wrote the log (Foundry tells every client who wrote a setting — both
//     the first-ever write and later ones).
//   • Whether the probe row reached the log at all.
// With one GM logged in it checks that player requests are still handled.
(async () => {
  const MOD = 'night-city-messenger';
  const PROBE = 'ncm-b1-probe';
  const say = (html) => ChatMessage.create({ whisper: [game.user.id], content: html });

  // ── PLAYER: send one request ──
  if (!game.user.isGM) {
    const svc = game.nightcity?.traceService;
    if (!svc) { ui.notifications.error('B1 test: NCM trace service not found on this client.'); return; }
    const actor = game.user.character || game.actors.find((a) => a.isOwner) || null;
    svc.logSuccess({ actor, action: PROBE, source: 'NCM B1 probe', severity: 'minor' });
    ui.notifications.info('B1 test: request sent. Each GM: run this macro again.');
    return;
  }

  const state = window.__ncmB1;

  // ── GM, step 3: report + clean up ──
  if (state) {
    Hooks.off('updateSetting', state.hook);
    Hooks.off('createSetting', state.hook);
    const svc = game.nightcity?.traceService;
    if (svc && state.original) svc.recordTrace = state.original;
    delete window.__ncmB1;

    const writers = [...state.writers].map((id) => game.users.get(id)?.name || id);
    const log = (() => { try { return game.settings.get(MOD, 'traceLog') || []; } catch { return []; } })();
    const rows = log.filter((r) => r.action === PROBE);
    const amActive = game.users.activeGM?.id === game.user.id;
    // On THIS client: the active GM must handle it exactly once, any other GM never.
    const pass = amActive ? state.handled === 1 : state.handled === 0;
    if (rows.length && amActive) {
      await game.settings.set(MOD, 'traceLog', log.filter((r) => r.action !== PROBE));
    }
    say(`<b>NCM B1 test (${game.user.name}): ${pass ? 'PASS ✔' : 'FAIL ✘'}</b><ul>`
      + `<li>This GM handled the request: <b>${state.handled}</b> time(s) — expected <b>${amActive ? 1 : 0}</b> (${amActive ? 'you are the active GM' : 'you are not the active GM'})</li>`
      + `<li>Probe row in the activity log: <b>${rows.length ? 'yes' : 'no'}</b>${rows.length > 1 ? ` (${rows.length} rows — more than one GM wrote it)` : ''}</li>`
      + `<li>Who wrote the log: ${writers.length ? writers.join(', ') : '<i>no write seen</i>'}</li></ul>`
      + `<span style="font-size:11px;opacity:.75">GMs online at the start: ${state.gms}. ${rows.length && amActive ? 'Probe row(s) removed.' : ''}</span>`);
    return;
  }

  // ── GM, step 1: watch ──
  const svc = game.nightcity?.traceService;
  if (!svc) { ui.notifications.error('B1 test: NCM trace service not found.'); return; }
  const st = { writers: new Set(), handled: 0, original: svc.recordTrace, gms: '' };
  // Count THIS client's own handling of the probe (restored in step 3).
  svc.recordTrace = async function (p) {
    if (p?.action === PROBE) st.handled++;
    return st.original.call(this, p);
  };
  st.hook = (setting, changes, options, userId) => {
    if (setting?.key !== `${MOD}.traceLog`) return;
    const value = setting.value ?? changes?.value;
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    if (text.includes(PROBE)) st.writers.add(userId);
  };
  Hooks.on('updateSetting', st.hook);
  Hooks.on('createSetting', st.hook);   // the first-ever write CREATES the setting
  const gms = game.users.filter((u) => u.isGM && u.active);
  st.gms = gms.map((u) => u.name).join(', ');
  window.__ncmB1 = st;
  const active = game.users.activeGM;
  say(`<b>NCM B1 test — watching on ${game.user.name}</b><br>GMs online: <b>${st.gms || 'none?'}</b><br>`
    + `Active GM (should handle requests): <b>${active?.name || '—'}</b>${active?.id === game.user.id ? ' (you)' : ''}<br>`
    + (gms.length > 1 ? 'Run this macro on <b>every</b> GM now, then have a player run it, then run it again on each GM.' : 'Next: a player runs this macro, then run it again here.'));
})();
