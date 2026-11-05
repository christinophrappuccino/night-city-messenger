// NCM stage 2, step 15 — Calls, Payphones, Emergency lines and Overheard calls on the feature registry.
// Each is a world switch that reloads the world; a part needs Calls. Off = not installed (no screen, hooks, timers;
// socket ops dropped), data kept. Read-only. Run as the GM; run it with everything ON, then again after switching
// one part off (Admin → Phone → Settings, or Module Settings). Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Step 15 test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const ns = game.nightcity;
  try {
    const F = ns.features;
    const set = (k) => !!game.settings.get('night-city-messenger', k);
    const want = { calls: set('callsEnabled') };
    for (const [n, k] of [['payphones', 'payphonesEnabled'], ['emergency', 'emergencyEnabled'], ['overheard', 'overheardEnabled']]) want[n] = want.calls && set(k);
    check('Each part reads on/off from its switch, and is off whenever Calls is', Object.entries(want).every(([n, on]) => F.isOn(n) === on),
      Object.entries(want).map(([n, on]) => `${n}:${on ? 'on' : 'off'}`).join(', '));

    check('The four call services exist either way (their data stays editable)', !!(ns.callService && ns.payphoneService && ns.emergencyService && ns.overheardService));
    const screens = { calls: 'callHud', emergency: 'emergencyHud', overheard: 'overheardHud', payphones: 'payphoneBooth' };
    const wrong = Object.entries(screens).filter(([n, k]) => !!ns[k] !== want[n]).map(([n, k]) => `${k} ${ns[k] ? 'built' : 'missing'} with ${n} ${want[n] ? 'on' : 'off'}`);
    check('A part\'s screen is built only when that part is on', wrong.length === 0, wrong.join('; '));

    const svcOf = { calls: ns.callService, payphones: ns.payphoneService, emergency: ns.emergencyService, overheard: ns.overheardService };
    check('Each service\'s "enabled" agrees with the registry', Object.entries(svcOf).every(([n, s]) => s.enabled === want[n]));

    const ops = { calls: 'call:event', emergency: 'call:emergency', overheard: 'call:overheard', payphones: 'call:payphone' };
    const h = ns.socketManager._handlers;
    const sockWrong = Object.entries(ops).filter(([n, op]) => { const fn = h.get(op); return !fn || (!!fn.ncmFeatureOff !== !want[n]); }).map(([n, op]) => op);
    check('Socket ops: the real handler when on, the "switched off" stand-in when off', sockWrong.length === 0, sockWrong.length ? `wrong: ${sockWrong.join(', ')}` : '');

    const skipped = ns.startupReport?.skipped || [];
    const offParts = Object.entries(want).filter(([, on]) => !on).map(([n]) => n);
    check('Startup skipped exactly the off parts\' steps, and nothing failed', offParts.every((n) => skipped.some((s) => s.includes(`(${n} off)`))) && !skipped.some((s) => Object.keys(want).some((n) => want[n] && s.includes(`(${n} off)`))) && !(ns.startupReport?.failed || []).length,
      skipped.join(', ') || 'nothing skipped');

    const pp = ns.payphoneService.getAll()[0];
    check(`Payphones on file: ${ns.payphoneService.getAll().length} (kept whatever the switch)`, true, pp ? pp.name : 'none in this world');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 15: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check, as a player: with everything on, a call, a payphone and the Trauma button work as before. With Payphones off, clicking a booth pin says it is out of order. With Calls off, the Phone button and the Agent's Calls tab are gone.</p>` });
})();
