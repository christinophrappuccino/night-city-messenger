// NCM audit fix A2 — "can a player make the GM's client run a macro?"
// One Script macro, three runs (give players Observer permission on it):
//
//   1. GM runs it    → creates a harmless CANARY macro (written by the GM), checks
//                      locally that a GM-written macro runs and a player-written
//                      one is refused, and says what to do next.
//   2. Player runs it → sends the forged request the audit found: "run program X
//                      on this terminal, and also run macro <CANARY>".
//                      You (GM) should see a toast "… ran "A2 probe" on …" — that
//                      is the request ARRIVING. The canary must NOT run.
//   3. GM runs it again → reports PASS/FAIL (did the canary run?) and deletes the
//                      canary and anything else this test created.
//
// Needs one terminal in the world (any converted terminal item). World changes:
// a temporary canary macro (and, during step 1 only, a temporary player-authored
// macro), both deleted by step 3.
(async () => {
  const MOD = 'night-city-messenger';
  const NAME = 'NCM A2 canary';
  const say = (html, to = [game.user.id]) => ChatMessage.create({ whisper: to, content: html });
  const canary = game.macros.getName(NAME);

  // ── PLAYER: send the forged request ──
  if (!game.user.isGM) {
    if (!canary) { ui.notifications.warn('A2 test: run this macro as the GM first.'); return; }
    const terminal = canary.getFlag(MOD, 'terminal');
    if (!terminal) { ui.notifications.warn('A2 test: the GM step found no terminal — ask the GM to convert an item to a terminal and redo step 1.'); return; }
    game.socket.emit(`module.${MOD}`, {
      operation: 'payload:effectRequest',
      data: { kind: 'uploadRun', itemUuid: terminal, effectType: 'adjudicate', params: { macroId: canary.id }, name: 'A2 probe', description: 'audit test', macroId: canary.id, actorId: null },
    });
    ui.notifications.info('A2 test: forged request sent. Tell the GM to run this macro again.');
    return;
  }

  // ── GM, step 3: report + clean up ──
  if (canary) {
    const runs = Number(canary.getFlag(MOD, 'a2ran') || 0);
    const baseline = Number(canary.getFlag(MOD, 'a2baseline') || 0);
    const pass = runs === baseline;
    await canary.delete();
    say(`<b>NCM A2 test: ${pass ? 'PASS ✔' : 'FAIL ✘'}</b><br>`
      + (pass ? 'The player\'s forged request did not run the canary macro.'
              : `The canary ran ${runs - baseline} time(s) after the local check — a player\'s request made your client run a macro.`)
      + '<br><span style="font-size:11px;opacity:.75">Canary macro deleted.</span>');
    return;
  }

  // ── GM, step 1: set up + local checks ──
  const base = foundry.utils.getRoute('modules/night-city-messenger/scripts');
  let runGmMacro;
  try { ({ runGmMacro } = await import(`${base}/utils/helpers.js`)); }
  catch (err) { ui.notifications.error(`A2 test: could not load NCM — ${err.message}`); return; }

  const terminal = game.items.find((i) => i.getFlag(MOD, 'isTerminal'));
  const command = `const m = game.macros.getName(${JSON.stringify(NAME)});
if (m) await m.setFlag(${JSON.stringify(MOD)}, 'a2ran', Number(m.getFlag(${JSON.stringify(MOD)}, 'a2ran') || 0) + 1);`;
  const made = await Macro.create({
    name: NAME, type: 'script', command, img: 'icons/svg/bird.svg',
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MOD]: { terminal: terminal?.uuid || '', a2ran: 0 } },
  });

  const rows = [];
  // a) a GM-written macro runs through the gate
  const ranGm = await runGmMacro(made.id, {}, 'A2 test');
  await new Promise((r) => setTimeout(r, 400));
  const after = Number(game.macros.get(made.id)?.getFlag(MOD, 'a2ran') || 0);
  rows.push(`${ranGm && after === 1 ? '✔' : '✘'} A macro written by a GM runs (intended automation)`);
  await made.setFlag(MOD, 'a2baseline', after);

  // b) a player-written macro is refused
  const player = game.users.find((u) => !u.isGM);
  if (player) {
    let temp = null;
    try { temp = await Macro.create({ name: 'NCM A2 player macro (temp)', type: 'script', command: 'console.log("A2 temp ran")', author: player.id }); } catch { temp = null; }
    if (temp && !temp.author?.isGM) {
      const ranP = await runGmMacro(temp.id, {}, 'A2 test');
      rows.push(`${ranP ? '✘' : '✔'} A macro written by a player is refused (you should also see a warning naming it)`);
    } else {
      rows.push('– Could not create a player-authored test macro here (Foundry set you as the author) — check skipped');
    }
    if (temp) await temp.delete();
  } else {
    rows.push('– No player user in this world — player-macro check skipped');
  }

  say(`<b>NCM A2 test — step 1 done</b><ul>${rows.map((r) => `<li>${r}</li>`).join('')}</ul>`
    + (terminal
      ? `Next: a <b>player</b> runs this same macro (it sends the forged request against <i>${Handlebars.escapeExpression(terminal.name)}</i>). You'll see a toast saying "A2 probe" ran — that's the request arriving. Then run this macro again here for the result.`
      : '<b>No terminal found.</b> Convert any item to a terminal, then run this macro again as GM (it will report and delete the canary), and start over.'));
})();
