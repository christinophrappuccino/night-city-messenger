// NCM batch (tester round 2026-11-09, Aegaeon: the corporate switchboard in every mode, calls that went to voicemail
// reach the call logs, N hangs up voicemail, node logs (GM lines off the ticker, delete a line, clear, a steady
// ticker), a pushed group never gives a character itself, numbers ride with a pushed group, Share a number ticks a
// group). Run as a GM after reloading the world. Checks the rules in the running module (no world writes), then
// whispers a result card with the by-hand list (most of it needs a player client).
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass: !!pass, note });
  const MID = 'night-city-messenger';
  const base = `/modules/${MID}/scripts`;
  const text = async (p) => (await fetch(`/modules/${MID}/${p}`, { cache: 'no-store' })).text();
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');

    // 1. the switchboard rule
    const PN = await import(`${base}/utils/phoneNumbering.js`);
    const sb = PN.officeShowsBoard;
    check('Voicemail with a greeting or a listed extension opens the switchboard', typeof sb === 'function' && sb({ answers: 'vm', greet: 'Hi' }) && sb({ answers: 'vm', exts: [{ x: '17', who: 'A' }] }));
    check('Voicemail with nothing to show still goes straight to the tone', sb && !sb({ answers: 'vm' }));
    const cs = game.nightcity?.callService;
    if (cs) {
      check('0 on a Voicemail board leaves a message (boardPick allows it)', (await text('scripts/services/CallService.js')).includes('!c.board.operator && !c.board.vm'));
      check('The GM keeps an ended call to check a voicemail log against', typeof cs._keepEnded === 'function');
      // the offices that would still skip the switchboard, and main numbers someone holds
      const rows = cs.numberContext?.rows?.filter((r) => r.Category === 'Corporate' && r.Code) || [];
      const held = rows.filter((r) => { const n = `+${r['Region code']} ${r['City code']} ${r.Code}-0100`; const c = cs.resolve(n); return c.kind !== 'unowned' && !c.special; });
      check(`Corporate main numbers held by someone: ${held.length}`, true, held.length ? `${held.map((r) => r.District).join(', ')} — calls ring the holder, not the switchboard (Admin → Corporations says so)` : 'none');
    } else check('Calls are off in this world (call checks skipped)', true);
    const hud = await text('scripts/ui/Calls/CallHud.js');
    check('N hangs up the voicemail screen', hud.includes("c.state === 'board' || c.state === 'voicemail') this.act('hangup', c.id);"));
    check('The board offers "0 Leave a message" under Voicemail', hud.includes("'Leave a message'"));

    // 2. node logs
    const N = await import(`${base}/utils/networkNodes.js`);
    const log = N.appendLog(N.appendLog([], { ts: 1, who: 'GM', what: 'switched off' }), { ts: 2, who: 'Kiri', what: 'jacked in' });
    check('A line the GM writes as GM stays off the ticker', log[0].gm && N.tickerLogLines({ log }).length === 1);
    check('Old "GM — …" lines read the same', N.sanitizeNode({ log: [{ ts: 1, who: 'GM', what: 'x' }] }).log[0].gm);
    const ns = game.nightcity?.networkService;
    check('Delete a line / Clear the log exist (GM)', typeof ns?.removeNodeLogLine === 'function' && typeof ns?.clearNodeLog === 'function');
    const css = await text('styles/components/node-console.css');
    check('The ticker is a seamless loop', css.includes('translateX(-50%)'));
    const nodes = Object.values(game.settings.get(MID, 'networkNodes') || {});
    const gmLines = nodes.reduce((n, x) => n + (x.log || []).filter((e) => N.isGmLine(e)).length, 0);
    check(`Nodes: ${nodes.length}, GM-only log lines now hidden from tickers: ${gmLines}`, true);

    // 3. groups
    const cgs = game.nightcity?.contactGroupService;
    check('The group service knows "itself" by address too', typeof cgs?.selfTest === 'function' && typeof cgs?.copyFor === 'function');
    for (const g of (cgs?.getMasterGroups?.() || []).slice(0, 6)) {
      const pcs = cgs.characterIdsOf(g);
      const selfIn = pcs.filter((id) => cgs.copyFor(g, id).members.length === g.members.length);
      check(`Group "${g.name}": ${pcs.length} character(s); each one's copy leaves them out`, !selfIn.length, selfIn.length ? `not recognised in their own group: ${selfIn.map((id) => game.actors.get(id)?.name).join(', ')}` : '');
    }
    const np = await text('scripts/utils/namePicker.js');
    check('Share a number / Push to players can tick a whole group', np.includes('ncm-pkr__set'));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${Handlebars.escapeExpression(r.name)}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM tester round 2026-11-09: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">By hand, with a player client:<br>
    1. Admin → Phone → Corporations: an office on Voicemail with a greeting and a listed extension. The Greeting box shows in every mode. As the player, dial the main number: the switchboard shows the greeting, the extension and "0 Leave a message". Press 0: "Nobody is free to take your call", the tone, leave a message.<br>
    2. Same office with no greeting and no listed extension: straight to the tone. The player's dial hint says "It takes a message", not "A switchboard".<br>
    3. Give a contact the office's main number (…-0100): Corporations warns that they hold it; the player's hint no longer says switchboard.<br>
    4. Call an NPC line, don't answer as GM, leave a voicemail. The player's Calls log AND Admin → Phone → Call log show it (as Voicemail). Call a player who is offline: it is logged too.<br>
    5. On the voicemail screen, press N once: it hangs up.<br>
    6. Inspect Node: hover a log line → × deletes it; Clear empties the log (confirm first). An eye marks the lines on the ticker; your "GM — …" lines say GM only.<br>
    7. Open the node's Console as a player: no "GM — …" lines on the ticker; it scrolls steadily and every line comes round again; switching the node or jacking in does not restart it.<br>
    8. Admin → Contacts → Groups → a party group → Push to players: "Tick a group" ticks its characters. Afterwards nobody has themselves as a contact (an old self-contact from earlier pushes is gone), their tray lists everyone else, the group does not read "Out of date", and the other characters' numbers are on their contacts.<br>
    9. Admin → Phone → a number → Share: "Tick a group" ticks that group's characters.</p>` });
})();
