// NCM stage 2, step 10b — the Cyberpunk RED data readers (scripts/utils/cpr.js) against YOUR world.
// Every Cyberpunk RED read (roles, money, Luck, ICE stats, item types, price) now goes through one file. This macro
// loads it and checks each reader gives what the system's own data says, on every character and Black ICE actor.
// Read-only: it changes nothing. Run as the GM. Results arrive as a whispered card.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('Step 10b test: run this as the GM.'); return; }
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    const C = await import(`/modules/night-city-messenger/scripts/utils/cpr.js?t=${Date.now()}`);
    check('utils/cpr.js loads', typeof C.roleName === 'function' && typeof C.isBlackIceActor === 'function');
    check(`The world runs Cyberpunk RED (${game.system.id})`, game.system.id === C.CPR_SYSTEM_ID);

    const people = game.actors.filter((a) => !C.NON_PERSON_ACTOR_TYPES.has(a.type));
    let roleBad = [], moneyBad = [], luckBad = [];
    for (const a of people) {
      const direct = a.items.find((i) => i.type === 'role');
      if (C.roleName(a) !== (direct?.name || '') || C.roleRank(direct) !== Number(direct?.system?.rank ?? 0)) roleBad.push(a.name);
      if (C.wealthBalance(a) !== (a.system?.wealth?.value ?? 0) || C.wealthLedger(a).length !== (a.system?.wealth?.transactions?.length ?? 0)) moneyBad.push(a.name);
      if (a.system?.stats?.luck && C.luckOf(a).value !== Number(a.system.stats.luck.value)) luckBad.push(a.name);
    }
    check(`Role name + rank match the role item on ${people.length} people`, roleBad.length === 0, roleBad.join(', '));
    check('Eddies balance + ledger match system.wealth', moneyBad.length === 0, moneyBad.join(', '));
    check('Luck matches system.stats.luck', luckBad.length === 0, luckBad.join(', '));

    const ice = C.blackIceActors();
    const iceBad = ice.filter((a) => a.system?.stats && C.iceAttack(a) !== (a.system.stats.atk ?? 0)).map((a) => a.name);
    check(`Black ICE found: ${ice.length} (${ice.map((a) => a.name).slice(0, 6).join(', ') || 'none in this world'})`, true);
    check('ICE ATK matches system.stats.atk', iceBad.length === 0, iceBad.join(', '));
    const typed = game.actors.filter((a) => a.type === 'blackIce' || a.type === 'black-ice');
    check('Every actor of a Black ICE type is counted', typed.every((a) => C.isBlackIceActor(a)));

    const types = C.itemTypes();
    check(`Item types from the system: ${types.length}`, types.includes('gear') && !types.includes('base'), types.join(', '));
    const priced = game.items.find((i) => i.system?.price?.market != null);
    check('Market price reads like system.price.market', !priced || C.marketPrice(priced) === priced.system.price.market, priced?.name || 'no priced world item');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 10b: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: open a player's inbox and contacts (role chips show), send eddies in a message and claim them (balance + ledger line), and open a shard guarded by Black ICE (the ICE portrait and ATK show).</p>` });
})();
