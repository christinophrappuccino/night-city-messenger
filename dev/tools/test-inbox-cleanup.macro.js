// NCM batch (inbox cleanup, 2026-11-05 — dev/mockups/inbox-cleanup-mock.html): the Calls tab's "?" sits beside
// "My line" and the line tools are icon-only; the directory opens inside the Calls area (not over the whole Agent),
// renders dark, and Close works; the Agent header is Contacts · Compose ▾ · (Admin) · ⚙; the Messages chips end in
// More ▾, and Mark all read is a strip under Unread; Admin → Messages → Needs a reply is a list (search, Sort ▾,
// Reply · inbox · ✓). Run as a GM with a character to open (or any user: the admin checks are skipped for a player).
// It opens your Agent (and the admin panel), clicks through, and leaves them open. Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const inside = (a, b) => { const r = a.getBoundingClientRect(), o = b.getBoundingClientRect(); return r.top >= o.top - 1 && r.left >= o.left - 1 && r.bottom <= o.bottom + 1 && r.right <= o.right + 1; };
  try {
    const actorId = game.user.character?.id || game.actors.find((a) => a.isOwner && a.hasPlayerOwner)?.id || game.actors.find((a) => a.isOwner)?.id;
    game.nightcity.openInbox(actorId);
    await sleep(2500);
    const app = document.getElementById('ncm-message-viewer');
    check('The Agent opened', !!app);
    if (app) {
      // ── header
      app.querySelector('[data-action="set-primary-tab"][data-tab="messages"]')?.click(); await sleep(1200);
      const acts = app.querySelector('.ncm-viewer__header-actions');
      check('Header: no separate New conversation / Player guide buttons', !acts.querySelector(':scope > [data-action="new-conversation"], :scope > [data-action="open-player-guide"]'));
      check('Header: Compose is a split button', !!acts.querySelector('.ncm-viewer__compose [data-action="compose-new"]'));
      const caret = acts.querySelector('[data-menu="compose"]');
      if (caret) {
        caret.click(); await sleep(250);
        const m = app.querySelector('[data-hmenu="compose"]');
        check('Compose ▾ opens with New message + New conversation', m && !m.hidden && !!m.querySelector('[data-action="new-conversation"]'));
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(150);
        check('…and a click outside closes it', m?.hidden === true);
      } else check('Compose ▾ (only while Conversations are on)', !game.nightcity?.conversationService?.enabled, 'Conversations are on but there is no ▾');
      // ── chips
      const pills = [...app.querySelectorAll('.ncm-viewer__pills-track > .ncm-pill')];
      check('Chips: Mark all read is not a chip', !pills.some((p) => p.dataset.action === 'mark-all-read'));
      check('Chips: Trash / Spam / Drafts are not chips on All', !pills.some((p) => ['trash', 'spam', 'drafts', 'scheduled'].includes(p.dataset.filter)));
      const more = app.querySelector('.ncm-viewer__more-pill');
      check('Chips: More ▾ is last', !!more && pills[pills.length - 1] === more);
      more?.click(); await sleep(250);
      const fm = app.querySelector('[data-hmenu="folders"]');
      check('More ▾ lists Drafts, Scheduled, Spam and Trash', fm && !fm.hidden && ['drafts', 'scheduled', 'spam', 'trash'].every((k) => fm.querySelector(`[data-filter="${k}"]`)));
      check('…and is not clipped by the chip row', fm && document.elementFromPoint(fm.getBoundingClientRect().left + 20, fm.getBoundingClientRect().bottom - 10)?.closest('[data-hmenu="folders"]') === fm);
      fm?.querySelector('[data-filter="trash"]')?.click(); await sleep(1200);
      check('Picking Trash shows it as a chip with its strip', !!app.querySelector('.ncm-viewer__pills-track > .ncm-pill--active[data-filter="trash"]') && !!app.querySelector('.ncm-viewer__filter-bar--danger'));
      app.querySelector('[data-action="set-filter"][data-filter="unread"]')?.click(); await sleep(1200);
      const strip = app.querySelector('.ncm-viewer__filter-bar--info [data-action="mark-all-read"]');
      const unread = Number(app.querySelector('.ncm-pill[data-filter="unread"] .ncm-pill__badge')?.textContent || 0);
      check('Unread shows the Mark all read strip when something is unread', unread ? !!strip : !strip, `${unread} unread`);
      app.querySelector('[data-action="set-filter"][data-filter="inbox"]')?.click(); await sleep(800);
      // ── calls
      const callsTab = app.querySelector('[data-action="set-primary-tab"][data-tab="calls"]');
      if (callsTab) {
        callsTab.click(); await sleep(1800);
        app.querySelector('[data-intro-done]')?.click(); await sleep(200);   // the first-visit How numbers work card covers the tab
        const hd = app.querySelector('.ncm-calls-line__hd');
        if (hd) {
          const card = app.querySelector('.ncm-calls-line');
          check('My line: the ? sits beside the label', hd.querySelector('span:first-child + .ncm-calls-help[data-calls-intro]') !== null);
          check('My line: every tool fits inside the card', [...hd.querySelectorAll('button')].filter((b) => b.offsetParent).every((b) => inside(b, card)));
          app.querySelector('[data-calls-xopen]')?.click(); await sleep(500);
          const x = app.querySelector('.ncm-calls-xlist');
          check('The directory opens inside the Calls area', !!x && inside(x, app.querySelector('.ncm-calls')) && !inside(app.querySelector('.ncm-viewer__header'), x));
          const tab = x?.querySelector('[data-xtab]'); const bg = tab ? getComputedStyle(tab).backgroundColor : '';
          check('…its tabs are not white', !!tab && !/rgb\(2[2-5]\d, 2[2-5]\d, 2[2-5]\d\)/.test(bg), bg);
          const close = x?.querySelector('[data-xclose]'); const b = close?.getBoundingClientRect();
          check('…its Close button is on top', !!close && document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('[data-xclose]') === close);
          close?.click(); await sleep(300);
          check('…and Close closes it', !app.querySelector('.ncm-calls-xlist'));
          check('The empty hint has no second directory link', !app.querySelector('.ncm-calls-xp [data-calls-xopen]'));
        } else check('Calls: My line card (this character needs a number)', true, 'skipped — no line yet');
        app.querySelector('[data-action="set-primary-tab"][data-tab="messages"]')?.click(); await sleep(800);
      }
    }
    // ── the footer follows the tab (round 3)
    if (app) {
      const key = (k, t = document.body) => t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      const foot = () => app.querySelector('.ncm-viewer__footer')?.textContent.replace(/\s+/g, ' ').trim();
      if (app.querySelector('[data-tab="calls"]')) {
        app.querySelector('[data-tab="calls"]').click(); await sleep(1800);
        app.querySelector('[data-intro-done]')?.click(); await sleep(150);
        check('Calls footer: / Dial · Enter Call · Esc Close', /\/ Dial Enter Call Esc Close/.test(foot() || ''), foot());
        check('Calls: no top search box', !app.querySelector('.ncm-viewer__nav-search'));
        if (app.querySelector('[data-calls-num]')) {
          document.activeElement?.blur?.(); key('/'); await sleep(100);
          check('Calls: / jumps to the number box', document.activeElement?.matches?.('[data-calls-num]'));
          app.querySelector('[data-calls-xopen]')?.click(); await sleep(400);
          key('Escape', app.querySelector('[data-xfind]') || document.body); await sleep(200);
          check('Calls: Esc closes the directory, not the Agent', !app.querySelector('.ncm-calls-xlist') && !!document.getElementById('ncm-message-viewer'));
        }
      }
      app.querySelector('[data-tab="shards"]')?.click(); await sleep(1800);
      check('Chips footer: / Search · ↑↓ Navigate · Enter Open', /\/ Search ↑↓ Navigate Enter Open/.test(foot() || ''), foot());
      const rows = app.querySelectorAll('.ncm-viewer__shard-item');
      if (rows.length) {
        document.activeElement?.blur?.(); key('ArrowDown'); await sleep(100);
        check('Chips: ↓ puts the cursor on the first chip', rows[0].classList.contains('is-cursor'));
        const first = rows[0].querySelector('.ncm-viewer__shard-name')?.textContent.trim() || '';
        const input = app.querySelector('.ncm-viewer__search-input');
        input.value = first; input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(900);
        const after = app.querySelectorAll('.ncm-viewer__shard-item');
        check('Chips: the search box narrows the chips', after.length >= 1 && after.length <= rows.length, `"${first}" → ${after.length}`);
        const box = app.querySelector('.ncm-viewer__search-input'); box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); await sleep(900);
      } else check('Chips keys (this character has no chips)', true, 'skipped');
      app.querySelector('[data-tab="messages"]')?.click(); await sleep(800);
      check('Messages footer unchanged', /\/ Search ↑↓ Navigate Enter Select/.test(foot() || '') || /R Reply/.test(foot() || ''), foot());
    }
    // ── admin
    if (game.user.isGM) {
      const panel = await game.nightcity.openAdminTab('messages', { select: 'view:reply' });
      await sleep(1500);
      const root = panel?.element;
      const rq = root?.querySelector('.ncm-msg2-rq');
      check('Needs a reply is the list (no Desk)', !!rq && !root.querySelector('.ncm-msg2-desk'));
      check('…with search, Show ▾ and Sort ▾', !!rq?.querySelector('[data-msg2-rqsearch]') && !!rq?.querySelector('[data-op="rqSort"]') && !!rq?.querySelector('[data-op="rFilt"]'));
      const rows = rq ? [...rq.querySelectorAll('.ncm-msg2-rq__row')] : [];
      check('…every line has Reply, the inbox and (if waiting) ✓', rows.every((r) => r.querySelector('[data-op="rqReply"]') && r.querySelector('[data-op="rqInbox"]') && (r.classList.contains('is-done') || r.querySelector('[data-op="markAnswered"]'))), `${rows.length} lines`);
    } else check('Admin checks (GM only)', true, 'skipped');
    check('No startup step failed', !(game.nightcity.startupReport?.failed || []).length, (game.nightcity.startupReport?.failed || []).join(', '));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM inbox cleanup: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: as a player, open ⚙ ▾ → Player guide; More ▾ → Spam with new spam (the More chip should carry a red count). As the GM, in Needs a reply press Reply on an alias line (the composer opens as the alias), try Sort ▾ → By player, and search for a player's name.</p>` });
})();
