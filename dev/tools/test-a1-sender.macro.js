// NCM audit fix A1 — "who really sent this socket message?"
// Paste into a Script macro. Run it as the GM FIRST (it starts listening),
// then run the same macro as a player (it sends a packet that LIES and claims
// to come from the GM). The GM gets a whispered PASS / FAIL in chat.
// PASS = NCM trusted the server's sender id, not the fake one in the packet.
(async () => {
  const OP = 'ncm:a1-selftest';
  const sm = game.nightcity?.socketManager;
  if (!sm) { ui.notifications.error('NCM socket manager not found — is the module enabled?'); return; }

  if (game.user.isGM) {
    sm.register(OP, (data, sender) => {
      const name = (id) => game.users.get(id)?.name ?? `(${id ?? 'nobody'})`;
      const pass = !!sender && sender === data?.realId && sender !== data?.claimed;
      ChatMessage.create({
        whisper: [game.user.id],
        content: `<b>NCM A1 test: ${pass ? 'PASS ✔' : 'FAIL ✘'}</b><br>`
          + `Packet claimed to be from: ${name(data?.claimed)}<br>`
          + `NCM says it came from: ${name(sender)}<br>`
          + `Actually sent by: ${name(data?.realId)}`,
      });
    });
    ui.notifications.info('NCM A1 test: listening. Now run this same macro as a player.');
  } else {
    const gm = game.users.find((u) => u.isGM);
    game.socket.emit('module.night-city-messenger', {
      operation: OP,
      sender: gm?.id,                                   // the lie
      data: { claimed: gm?.id, realId: game.user.id },
    });
    ui.notifications.info("NCM A1 test: sent a packet pretending to be the GM. Check the GM's chat.");
  }
})();
