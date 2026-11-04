// NCM audit fix A5a — "can HTML stored in mail or shard content run on a reader's screen?"
// Paste into a Script macro and run it as the GM (one client is enough).
//
// Feeds booby-trapped content through the real rendering code, into scratch
// elements that are never shown, then checks with the BROWSER's own parsers:
//   1. Mail links (SEC-15): every disguised `javascript:` link must come out dead,
//      ordinary links and image paths must survive — judged by the browser's URL parser.
//   2. Inbox body (SEC-15): the viewer's real body renderer, with a trapped image.
//   3. Forward (SEC-13): the composer's real forward setup — header + quoted body.
//   4. Typed content (SEC-14): an entry with an unknown type, and a payload scan
//      report, through the real content-body template.
// Results arrive as a whispered chat card. Nothing is sent, saved or shown.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Run this as the GM.'); return; }
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fired = (window.__ncmA5a = new Set());
  const trap = (label) => `<img src="ncm-a5a-${label}.invalid" onerror="window.__ncmA5a.add('${label}')">`;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const scratch = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  const liveHandlers = (el) => [...el.querySelectorAll('*')].filter((n) => [...n.attributes].some((a) => /^on/i.test(a.name))).length;

  let cleanHtml, MessageService, MessageComposerApp, MessageViewerApp, enrichContent;
  try {
    ({ cleanHtml } = await import(`${base}/utils/richText.js`));
    ({ MessageService } = await import(`${base}/services/MessageService.js`));
    ({ MessageComposerApp } = await import(`${base}/ui/MessageComposer/MessageComposerApp.js`));
    ({ MessageViewerApp } = await import(`${base}/ui/MessageViewer/MessageViewerApp.js`));
    ({ enrichContent } = await import(`${base}/ui/content/ContentRenderers.js`));
  } catch (err) {
    ui.notifications.error(`A5a test: could not load NCM modules — ${err.message}`);
    return;
  }

  // ── 1. Links, judged by the browser's own URL parser ──
  const attacks = ['javascript&#58;alert(1)', 'javascript&#x3A;alert(1)', 'javascript&colon;alert(1)', 'java&#9;script:alert(1)',
    'javascript&amp;#58;alert(1)', '&#106;avascript:alert(1)', 'javascript&#0000058alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,hi', 'vbscript:x'];
  const live = [];
  for (const href of attacks) {
    const a = scratch(cleanHtml(`<a href="${href}">x</a>`, { mode: 'mail' })).querySelector('a');
    if (a && a.getAttribute('href') !== null && /^(javascript|vbscript|data):$/i.test(a.protocol)) live.push(href);
  }
  check(`Disguised script links are dead (${attacks.length} forms)`, live.length === 0, live.length ? `still live: ${live.join(', ')}` : '');
  const keep = ['https://example.com/a?x=1&y=2', 'mailto:v@nc.net', 'worlds/my world/img.png'];
  const lost = keep.filter((href) => !scratch(cleanHtml(`<a href="${href}">x</a>`, { mode: 'mail' })).querySelector('a[href]'));
  check('Ordinary links and paths still work', lost.length === 0, lost.length ? `lost: ${lost.join(', ')}` : '');

  // ── 2. The inbox's real body renderer ──
  try {
    const viewer = Object.create(MessageViewerApp.prototype);
    viewer._decryptedBlocks = new Set();
    const html = viewer._renderMessageBody(`<p>Hello <b>V</b></p>${trap('inbox')}<a href="javascript&#58;alert(1)">click</a>`, 'a5a-test');
    const el = scratch(html);
    await sleep(500);
    const a = el.querySelector('a');
    check('Inbox body: no handler, no live script link, formatting kept',
      !fired.has('inbox') && liveHandlers(el) === 0 && !(a && /^javascript:$/i.test(a.protocol)) && !!el.querySelector('b'),
      fired.has('inbox') ? 'the trap RAN' : '');
  } catch (err) {
    check('Inbox body: no handler, no live script link, formatting kept', false, `could not drive the viewer: ${err.message}`);
  }

  // ── 3. Forward: the composer's real setup ──
  try {
    const orig = { from: `boss${trap('fwdfrom')}@nc.net`, to: 'v@nc.net', timestamp: new Date().toISOString(), subject: `Job ${trap('fwdsubj')}`,
      body: `<p>Original <b>body</b></p>${trap('fwdbody')}`, messageId: 'a5a', threadId: 'a5a', references: [] };
    const svc = game.nightcity.messageService;
    const t = { originalMessage: orig, fromActorId: null, messageService: { buildForward: (...a) => MessageService.prototype.buildForward.apply(svc, a) } };
    MessageComposerApp.prototype._initForward.call(t);
    const el = scratch(t.body);
    await sleep(500);
    const ran = ['fwdfrom', 'fwdsubj', 'fwdbody'].filter((l) => fired.has(l));
    check('Forward: sender, subject and quoted body cannot run, formatting kept',
      ran.length === 0 && liveHandlers(el) === 0 && !!el.querySelector('b') && el.textContent.includes('<img'),
      ran.length ? `RAN: ${ran.join(', ')}` : '');
  } catch (err) {
    check('Forward: sender, subject and quoted body cannot run, formatting kept', false, `could not drive the composer: ${err.message}`);
  }

  // ── 4. Typed content through the real template ──
  try {
    const tpl = 'modules/night-city-messenger/templates/content/content-body.hbs';
    const unknown = enrichContent({ contentType: 'a5a-not-a-type', subject: 's', timestamp: new Date().toISOString(), body: `<p>keep <b>this</b></p>${trap('fallback')}` }, { isGM: true, interactive: false });
    const elU = scratch(await renderTemplate(tpl, unknown));
    const payload = enrichContent({ contentType: 'payload', subject: 'p', timestamp: new Date().toISOString(),
      contentData: { name: 'A5a probe', effect: { type: 'scanner' }, executed: true, scanReport: `SCAN — account ${trap('scan')}` } }, { isGM: true, interactive: false });
    const elP = scratch(await renderTemplate(tpl, payload));
    await sleep(500);
    check('Unknown content type: body cannot run, formatting kept', !fired.has('fallback') && liveHandlers(elU) === 0 && !!elU.querySelector('b'), fired.has('fallback') ? 'the trap RAN' : '');
    check('Payload scan report cannot run', !fired.has('scan') && liveHandlers(elP) === 0, fired.has('scan') ? 'the trap RAN' : '');
  } catch (err) {
    check('Typed content through the real template', false, `could not render: ${err.message}`);
  }

  // ── Report ──
  await sleep(300);
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
  ChatMessage.create({
    whisper: [game.user.id],
    content: `<b>NCM A5a test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>`
      + `<p style="font-size:11px;opacity:.75">Traps that ran: ${fired.size ? [...fired].join(', ') : 'none'}</p>`,
  });
})();
