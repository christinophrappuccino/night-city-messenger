// NCM audit fix A4b — "can a name full of HTML run script through a tooltip,
// and can a macro label break a generated macro?"
// Paste into a Script macro and run it as the GM (one client is enough).
//
// Foundry shows tooltips with innerHTML, so before A4b a name like
// <img src=x onerror=…> in any NCM tooltip ran when someone hovered it.
// This macro feeds a booby-trapped name into:
//   1. a real NCM template (the attachment chip), rendered by Foundry
//   2. an NCM tooltip built in code (tipText)
//   3. Foundry's real tooltip, shown on both of those (no hovering needed)
//   4. a generated access-point macro whose label holds hidden line breaks (U+2028)
// Results arrive as a whispered chat card: PASS = the name shows as text, nothing runs.
//
// Side effects: none. A tooltip flashes for a moment; nothing is written to the world.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Run this as the GM.'); return; }
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fired = (window.__ncmA4b = new Set());
  const bait = (label) => `<img src="ncm-a4b-${label}.invalid" onerror="window.__ncmA4b.add('${label}')"> A4B-${label} R&D`;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });

  let tipText, accessMacroSnippet;
  try {
    ({ tipText } = await import(`${base}/utils/notify.js`));
    ({ accessMacroSnippet } = await import(`${base}/utils/accessPoints.js`));
  } catch (err) {
    ui.notifications.error(`A4b test: could not load NCM modules — ${err.message}`);
    return;
  }

  // Show Foundry's real tooltip for an element, read what it displays, then hide it.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:40%;top:40%;z-index:10000';
  document.body.appendChild(host);
  async function showTip(el) {
    host.replaceChildren(el);
    game.tooltip.activate(el);
    await sleep(400);
    const box = document.getElementById('tooltip');
    const out = { text: box?.textContent || '', imgs: box?.querySelectorAll('img[src*="ncm-a4b-"]').length || 0 };
    game.tooltip.deactivate();
    return out;
  }
  const judge = (label, shown) => {
    const ranOrLive = fired.has(label) || shown.imgs > 0;
    const asText = shown.text.includes(`<img`) && shown.text.includes('R&D') && !shown.text.includes('&lt;') && !shown.text.includes('&amp;');
    return {
      pass: !ranOrLive && asText,
      note: fired.has(label) ? 'the image tag RAN'
        : shown.imgs ? 'a live <img> is in the tooltip'
        : !shown.text ? 'tooltip was empty — hover the element to look'
        : shown.text.includes('&lt;') || shown.text.includes('&amp;') ? `shows escape codes: "${shown.text.slice(0, 60)}"`
        : !asText ? `unexpected text: "${shown.text.slice(0, 60)}"` : '',
    };
  };

  // ── 1. A real template, rendered by Foundry ──
  try {
    const html = await renderTemplate('modules/night-city-messenger/templates/partials/attachment-chip.hbs', {
      attachment: { name: bait('template'), icon: 'fas fa-file' }, index: 0, messageId: 'a4b',
    });
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const chip = wrap.querySelector('[data-tooltip]');
    check('Template: the tooltip attribute holds the name', !!chip && chip.dataset.tooltip.includes('A4B-template'), chip ? '' : 'no data-tooltip in the rendered chip');
    if (chip) { const r = judge('template', await showTip(chip)); check('Template: Foundry tooltip shows the name as text', r.pass, r.note); }
  } catch (err) {
    check('Template rendered', false, err.message);
  }

  // ── 2. A tooltip built in code ──
  {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<span data-tooltip="Open ${tipText(bait('code'))}">hover</span>`;
    const r = judge('code', await showTip(wrap.firstElementChild));
    check('Code-built: Foundry tooltip shows the name as text', r.pass, r.note);
  }

  // ── 3. Hidden line breaks in a macro label ──
  try {
    const label = 'Evil\u2028ui.notifications.error("A4B label broke out")//\u2029';
    const code = accessMacroSnippet({ kind: 'terminal', id: 'Item.a4b-test' }, label);
    const noBreaks = !/[\u2028\u2029]/.test(code);
    let parses = true;
    try { new (Object.getPrototypeOf(async function () {}).constructor)(code); } catch { parses = false; }
    check('Macro label: hidden line breaks removed', noBreaks, noBreaks ? '' : 'U+2028/U+2029 still in the generated code');
    check('Macro label: generated macro still parses', parses);
  } catch (err) {
    check('Macro label test ran', false, err.message);
  }

  // ── Report ──
  host.remove();
  await sleep(300);
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(r.note)}</i>` : ''}</li>`).join('');
  ChatMessage.create({
    whisper: [game.user.id],
    content: `<b>NCM A4b test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul>`
      + `<p style="font-size:11px;opacity:.75">Scripts that ran: ${fired.size ? [...fired].join(', ') : 'none'}</p>`,
  });
})();
