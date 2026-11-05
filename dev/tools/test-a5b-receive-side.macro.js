// NCM audit fix A5b — "what does a client accept from another client?"
// Paste into a Script macro and run it as the GM (one client is enough).
//
// It plays a hostile client against this one, without needing a second login:
//   1. Watch: a share offer and pictures in another user's name are dropped; a hostile
//      picture mounted into a scratch copy runs nothing and keeps the harmless parts.
//   2. Overheard calls: a HUD message from a player is dropped; one from the GM shows,
//      and a hostile line in it shows as text.
//   3. A picture path inside url('…') cannot add CSS rules.
//   4. A mail body cannot use a var() fallback to cover the screen.
// Results arrive as a whispered chat card: PASS = nothing ran, nothing escaped.
//
// Side effects: an Intercept screen opens for a moment and closes. Nothing is written to the world.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Run this as the GM.'); return; }
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fired = (window.__ncmA5b = new Set());
  const bait = (label) => `<img src="ncm-a5b-${label}.invalid" onerror="window.__ncmA5b.add('${label}')">`;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const player = game.users.find((u) => !u.isGM);
  const playerId = player?.id || 'aPlayerThatIsNotHere';

  let mountMirror, cleanHtml;
  try {
    ({ mountMirror } = await import(`${base}/utils/watchMirror.js`));
    ({ cleanHtml } = await import(`${base}/utils/richText.js`));
  } catch (err) {
    ui.notifications.error(`A5b test: could not load NCM modules — ${err.message}`);
    return;
  }
  const scratch = document.createElement('div');
  scratch.style.cssText = 'position:fixed;left:-5000px;top:0;width:800px;height:600px;overflow:hidden';
  document.body.appendChild(scratch);

  // ── 1. Watch ──
  const watch = game.nightcity.watchService;
  if (!watch) check('Watch service loaded', false, 'game.nightcity.watchService missing');
  else {
    const fakeShare = `${playerId}:a5b-test`;
    watch.onSocket({ type: 'offer', shareId: fakeShare, userId: playerId, who: 'Forged', what: 'A5B' }, game.user.id);
    check('Watch: an offer in someone else\'s name is dropped', !watch.offers.has(fakeShare));
    watch.onSocket({ type: 'offer', shareId: fakeShare, userId: playerId, who: 'Forged', what: 'A5B' });
    check('Watch: an offer with no verified sender is dropped', !watch.offers.has(fakeShare));
    watch.offers.delete(fakeShare);
    watch._removeChip?.(fakeShare);

    const hostile = `<div class="a5b-ok">keep me</div>${bait('mirror')}<style>body{display:none!important}</style><a href="java&#9;script:window.__ncmA5b.add('link')">x</a><svg><set attributeName="href" to="javascript:x"/></svg><base href="https://example.invalid/">`;
    mountMirror(scratch, { html: hostile, cls: 'ncm-app " onload=x', data: { 'data-a5b': '1', onanimationstart: "window.__ncmA5b.add('root')" }, rootVars: '--a5b:1', vars: '', wcVars: '', wcClass: 'window-content', w: 800, h: 600 });
    await sleep(600);
    const st = scratch.querySelector('.ncm-watch__mirror');
    const h = st?.innerHTML || '';
    check('Watch: a hostile picture runs nothing', !fired.has('mirror') && !fired.has('root') && !fired.has('link'), [...fired].join(', '));
    check('Watch: no <style>, <base>, <set>, handlers or script links in the copy', !/<style|<base|<set|\son[a-z]+=|javascript/i.test(h));
    check('Watch: the root takes only data-* keys', st?.getAttribute('data-a5b') === '1' && !st?.hasAttribute('onanimationstart'));
    check('Watch: the harmless parts survive', !!st?.querySelector('div.a5b-ok'));
    check('The page is still visible', getComputedStyle(document.body).display !== 'none');
  }

  // ── 2. Overheard calls ──
  const ov = game.nightcity.overheardService, hud = game.nightcity.overheardHud;
  if (!ov || !hud) check('Overheard service loaded', false, 'game.nightcity.overheardService missing');
  else if (hud.cur) check('Overheard HUD free', false, 'an intercept is already open — close it and run again');
  else {
    await ov.handleSocket({ op: 'joined', runId: 'a5b', label: 'Forged', net: 'x', from: 0, skill: 'Basic Tech', dv: 13 }, playerId);
    check('Overheard: a screen from a player is dropped', !hud.cur);
    await ov.handleSocket({ op: 'joined', runId: 'a5b', label: 'A5B test intercept', net: 'x', from: 0, skill: 'Basic Tech', dv: 13 }, game.user.id);
    check('Overheard: a screen from the GM shows', hud.cur?.runId === 'a5b');
    await ov.handleSocket({ op: 'line', runId: 'a5b', line: { i: 0, id: 'a5b-l', who: 'Side A', html: `hello ${bait('line')} <span class="ncm-r4-gl">▒░</span>`, tts: false } }, game.user.id);
    await sleep(4000); // the line types out like a real call
    const tx = hud.root?.querySelector('[data-line="a5b-l"] .tx');
    check('Overheard: a hostile line runs nothing', !fired.has('line'), fired.has('line') ? 'the image tag RAN' : '');
    check('Overheard: it shows as text, garble kept', !!tx && !tx.querySelector('img') && tx.textContent.includes('<img') && !!tx.querySelector('.ncm-r4-gl'), tx ? `"${tx.textContent.slice(0, 50)}"` : 'line not found');
    hud._close();
  }

  // ── 3. A picture path inside url('…') ──
  try {
    const tpl = Handlebars.compile(`<span class="a5b-css" style="display:block;width:10px;height:10px;background-image:url('{{ncm-css-url img}}')"></span>`);
    scratch.insertAdjacentHTML('beforeend', tpl({ img: "img/x');position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;('" }));
    const el = scratch.querySelector('.a5b-css');
    const cs = getComputedStyle(el);
    check("CSS url: a path cannot add rules", cs.position !== 'fixed' && cs.zIndex !== '99999', `position ${cs.position}`);
    check('CSS url: a script URL renders as nothing', tpl({ img: 'javascript:alert(1)' }).includes("url('')"));
  } catch (err) {
    check('CSS url test ran', false, err.message);
  }

  // ── 4. A mail body with a var() fallback ──
  const body = cleanHtml('<p class="a5b-mail" style="position:var(--ncm-x,fixed);inset:var(--ncm-x,0);z-index:var(--ncm-x,99999)">covered</p><span style="color:var(--ncm-secondary)">kept</span>', { mode: 'mail' });
  scratch.insertAdjacentHTML('beforeend', body);
  const p = scratch.querySelector('p');
  check('Mail: a var() fallback cannot position anything', !!p && getComputedStyle(p).position !== 'fixed' && !/position|inset|z-index/.test(body), body.slice(0, 80));
  check('Mail: a plain module colour survives', /color:var\(--ncm-secondary\)/.test(body));

  // ── Report ──
  scratch.remove();
  await sleep(300);
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
  ChatMessage.create({
    whisper: [game.user.id],
    content: `<b>NCM A5b test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>`
      + `<p style="font-size:11px;opacity:.75">Scripts that ran: ${fired.size ? [...fired].join(', ') : 'none'}${player ? '' : ' · no player user exists, so a made-up id stood in for one'}</p>`,
  });
})();
