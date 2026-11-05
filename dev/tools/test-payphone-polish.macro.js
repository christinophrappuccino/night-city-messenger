// NCM payphone polish — "does the cord reach the handset, and does hanging up stay hung up?"
// Run in the FOUNDRY DESKTOP APP (that is where the cord was off), as anyone. Needs one payphone
// (Admin → Phone → Payphones). It opens the booth for a moment, measures where the cord ends against where the
// handset is, checks the Walk away bar sits above the booth, checks a hang-up does not bring the booth back, then
// closes the booth. Nothing is saved. Results arrive as a chat card whispered to you.
(async () => {
  const ns = game.nightcity;
  const booth = ns?.payphoneBooth;
  const pp = ns?.payphoneService?.getAll?.()[0];
  if (!booth || !pp) { ui.notifications.warn('Payphone test: needs NCM loaded and one payphone.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    booth.open(pp);
    await sleep(900);                       // the entrance and the first cord frames
    const r = booth.root;
    const svg = r?.querySelector('.ncm-pb__cord'), path = r?.querySelector('[data-pb-cord]'), endEl = r?.querySelector('[data-pb-cordend]');
    if (!svg || !path || !endEl) throw new Error('the booth did not draw');
    const [x, y] = (path.getAttribute('d').match(/^M\s*([-\d.]+)\s+([-\d.]+)/) || []).slice(1).map(Number);
    const box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, end = endEl.getBoundingClientRect();
    const s = Math.min(box.width / vb.width, box.height / vb.height);
    const sx = box.left + (box.width - vb.width * s) / 2 + (x - vb.x) * s;
    const sy = box.top + (box.height - vb.height * s) / 2 + (y - vb.y) * s;
    const gap = Math.hypot(sx - (end.left + end.width / 2), sy - (end.top + end.height / 2));
    const zoom = getComputedStyle(r.closest('.ncm-pb-frame')).getPropertyValue('--pb-zoom') || '1';
    check('The cord ends on the handset', gap < 4, `${gap.toFixed(1)} px off (booth zoom ${zoom.trim()})`);

    const foot = r.querySelector('.ncm-pb__foot'), cas = r.querySelector('.ncm-pb__case');
    check('Walk away sits above the booth', !!foot && !!cas && foot.getBoundingClientRect().bottom <= cas.getBoundingClientRect().top + 1);

    booth.close(true);
    booth.hungUp(pp, 'payphone-test-call');
    await sleep(500);
    check('Hanging up does not bring the booth back', !booth.host && !document.querySelector('.ncm-pb-host'));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    try { booth.close(true); } catch { /* best effort */ }
  }
  const all = results.every((x) => x.pass);
  const rows = results.map((x) => `<li>${x.pass ? '✔' : '✘'} ${x.name}${x.note ? ` — <i>${Handlebars.escapeExpression(String(x.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM payphone test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: lift the handset and move it — the cord should follow. Make a call from the booth and hang up — the booth should not reappear.</p>` });
})();
