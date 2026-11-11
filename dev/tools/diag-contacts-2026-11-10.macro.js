// NCM diagnostic (tester report 2026-11-10: "after Push to players they have ALL contacts, burners and aliases, in
// Speed dial"). READ-ONLY: it writes nothing. Run as a GM in the world where it happened. It whispers a card with:
//   - who you are logged in as, and every user's role (an Assistant GM counts as a GM: the Calls tab then lists
//     every number in the directory, burners and aliases included, whoever's Messenger is open)
//   - for each player character: how many contacts they hold, how many have a number, and how many of those are
//     someone's burner / alias / another player character
(async () => {
  const MID = 'night-city-messenger';
  const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
  const ROLES = Object.fromEntries(Object.entries(CONST.USER_ROLES).map(([k, v]) => [v, k]));
  const cs = game.nightcity?.callService, mcs = game.nightcity?.masterContactService;
  const lines = Object.values(cs?.lines?.() || {});
  const users = game.users.contents.map((u) => `<li>${esc(u.name)} — ${esc(ROLES[u.role] || u.role)}${u.isGM ? ' <b>(counts as GM)</b>' : ''}${u.character ? ` · plays ${esc(u.character.name)}` : ''}${u.active ? ' · online' : ''}</li>`).join('');
  const pcs = game.actors.filter((a) => a.hasPlayerOwner && a.type === 'character');
  const rows = pcs.map((a) => {
    const list = a.getFlag(MID, 'contacts') || [];
    const withNum = list.filter((c) => c.phone);
    const kinds = { burner: 0, alias: 0, extra: 0, pc: 0 };
    for (const c of withNum) {
      const l = lines.find((x) => x.number === c.phone || (cs?.resolve && x.normal && cs.resolve(c.phone)?.normal === x.normal));
      if (l?.kind && kinds[l.kind] !== undefined) kinds[l.kind]++;
      if (c.actorId && game.actors.get(c.actorId)?.hasPlayerOwner) kinds.pc++;
    }
    const groups = (a.getFlag(MID, 'contactGroups') || []).length;
    const self = list.filter((c) => c.actorId === a.id).length;
    return `<li><b>${esc(a.name)}</b>: ${list.length} contacts, ${withNum.length} with a number${kinds.burner ? `, ${kinds.burner} burner` : ''}${kinds.alias ? `, ${kinds.alias} alias` : ''}${kinds.extra ? `, ${kinds.extra} extra line` : ''}${kinds.pc ? `, ${kinds.pc} player characters` : ''}${self ? `, <b>${self} is themselves</b>` : ''} · ${groups} group(s)</li>`;
  }).join('');
  const dir = mcs?.getAll?.() || [];
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM contacts check (read-only)</b>
    <p>You: ${esc(game.user.name)} — ${esc(ROLES[game.user.role])}${game.user.isGM ? ' (GM)' : ''}</p>
    <p><b>Users</b></p><ul>${users}</ul>
    <p><b>Directory</b>: ${dir.length} contacts · ${lines.length} phone lines (${lines.filter((l) => l.kind === 'burner').length} burner, ${lines.filter((l) => l.kind === 'alias').length} alias)</p>
    <p><b>What each character holds</b></p><ul>${rows || '<li>No player characters.</li>'}</ul>
    <p style="font-size:12px">If a character holds only the people you pushed, their contacts are fine: what showed "everybody" was a Messenger opened by a user who counts as a GM.</p>` });
})();
