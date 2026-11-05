// NCM audit fix D3 — "does a reload still give a locked-out player a clean slate?"
// Uses made-up test targets ("d3test::…"), so no real terminal or network is touched. The macro knows which step
// you are on from what is saved; just run it, press F5 when it says, and run it again. Both clients stay connected.
//   PLAYER: run → 2 misses are recorded → F5 → run → still 1 try left → a 3rd miss locks out → F5 → run → still locked,
//           and a faked "success" cannot unlock it.
//   GM:     run → force-locks the player's character out of a test target → F5 → run → the forced lockout survived the
//           GM's reload → everything the test made is cleared. (Then the player can run it once more: a fresh start.)
// Results arrive as a chat card whispered to whoever ran it.
(async () => {
  const MOD = 'night-city-messenger';
  const sec = game.nightcity?.securityService;
  if (!sec) { ui.notifications.error('D3 test: NCM is not loaded.'); return; }
  const saved = () => { try { return game.settings.get(MOD, 'securityLockouts') || {}; } catch { return {}; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const say = (title, rows) => {
    const all = rows.every((r) => r.pass);
    ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM D3 test (${title}): ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('')}</ul>` });
  };
  const LOGIN = 'd3test::login', FORCED = 'd3test::forced';

  if (game.user.isGM) {
    const pc = game.actors.find((a) => a.hasPlayerOwner && a.type === 'character');
    if (!pc) { ui.notifications.warn('D3 test: no player character in this world.'); return; }
    const key = `${pc.id}::${FORCED}`;
    if (!saved()[key]) {
      sec.forceLockoutMany(pc.id, [FORCED], { durationMs: 3600000, reason: 'D3 test', label: 'D3 test target' });
      await sleep(800);
      const ok = !!saved()[key]?.forced;
      say('GM, step 1', [{ name: `${pc.name} is force-locked out of the test target, and it is saved`, pass: ok, note: ok ? 'now press F5 (GM) and run this again' : '' }]);
    } else {
      const k = sec.getKnownState(pc.id, FORCED);
      const rows = [{ name: 'After the GM\'s reload the forced lockout is still known, with its reason', pass: !!k?.forced && k.reason === 'D3 test', note: k ? `${Math.round(k.lockoutRemaining / 60000)} min left` : 'not found' }];
      const testKeys = Object.keys(saved()).filter((k2) => k2.includes('::d3test::'));
      for (const k2 of testKeys) { const i = k2.indexOf('::'); sec.clearFor(k2.slice(0, i), [k2.slice(i + 2)]); }
      await sleep(800);
      rows.push({ name: 'Everything the test made is cleared', pass: !Object.keys(saved()).some((k2) => k2.includes('::d3test::')), note: `${testKeys.length} entr${testKeys.length === 1 ? 'y' : 'ies'}` });
      say('GM, step 2', rows);
    }
    return;
  }

  // ── player ──
  if (!game.users.activeGM) { ui.notifications.warn('D3 test: a GM must be online.'); return; }
  const actor = game.user.character || game.actors.find((a) => a.isOwner && a.type === 'character');
  if (!actor) { ui.notifications.warn('D3 test: this player owns no character.'); return; }
  const key = `${actor.id}::${LOGIN}`;
  sec.initTracking(actor.id, LOGIN, { maxAttempts: 3, lockoutDuration: 3600000 });
  const s = saved()[key];
  if (!s) {
    sec.recordFailedAttempt(actor.id, LOGIN); sec.recordFailedAttempt(actor.id, LOGIN);
    await sleep(1200);
    const ok = saved()[key]?.attempts === 2;
    say('player, step 1', [{ name: 'Two misses are recorded and saved by the GM', pass: ok, note: ok ? 'now press F5 and run this again' : 'not saved (is the GM online and up to date?)' }]);
  } else if (!(s.lockoutUntil > 0)) {
    const left = sec.getRemainingAttempts(actor.id, LOGIN);
    sec.recordFailedAttempt(actor.id, LOGIN);
    await sleep(1200);
    say('player, step 2', [
      { name: 'After the reload there is still 1 try left (not 3)', pass: left === 1, note: `${left} left` },
      { name: 'The third miss locks the character out, and it is saved', pass: sec.isLockedOut(actor.id, LOGIN) && saved()[key]?.lockoutUntil > 0, note: 'now press F5 and run this again' },
    ]);
  } else {
    const locked = sec.isLockedOut(actor.id, LOGIN);
    sec.recordSuccess(actor.id, LOGIN);   // what a faked "I got in" would send
    await sleep(1200);
    say('player, step 3', [
      { name: 'After the reload the character is still locked out', pass: locked },
      { name: 'A faked "success" does not end the saved lockout', pass: saved()[key]?.lockoutUntil > 0, note: 'now let the GM run this macro twice (it clears the test at the end)' },
    ]);
  }
})();
