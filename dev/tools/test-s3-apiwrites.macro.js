// NCM batch: API v2.1.0 — the writes (directory add / update / pushToPlayer, groups.push, calls.place / logFor,
// networks.set; docs/API.md). Run as the GM. It adds a directory contact called "API test (delete me)", edits it,
// reads it back and REMOVES it; reads your first character's call log; and re-selects the network you are on.
// Whispered result card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  try {
    if (!game.user.isGM) throw new Error('Run this as the GM.');
    const v2 = game.modules.get('night-city-messenger')?.api?.v2;
    check(`API version ${v2?.version}`, v2?.version === '2.1.0');
    const add = await v2.directory.add({ name: 'API test (delete me)', email: 'api-test@nightcity.net' });
    check('directory.add', add.ok && !!add.data.contactId, add.ok ? add.data.contactId : add.error);
    if (add.ok) {
      const up = await v2.directory.update(add.data.contactId, { notes: 'edited by the API test' });
      check('directory.update', up.ok, up.error);
      const got = await v2.directory.get(add.data.contactId);
      check('directory.get reads it back', got.ok && got.data.name === 'API test (delete me)');
      await game.nightcity.masterContactService.removeContact(add.data.contactId);
      check('Cleaned up (contact removed)', !game.nightcity.masterContactService.getContact(add.data.contactId));
    }
    check('directory.add with no name is refused (BAD_INPUT)', (await v2.directory.add({})).code === 'BAD_INPUT');
    const pc = game.actors.find((a) => a.hasPlayerOwner && a.type === 'character');
    if (pc && v2.features.has('calls')) {
      const log = await v2.calls.logFor(pc.id);
      check(`calls.logFor(${pc.name})`, log.ok && Array.isArray(log.data) && log.data.every((l) => !('heardBy' in l)), log.ok ? `${log.data.length} call(s)` : log.error);
    } else check('calls.logFor (skipped: no player character, or Calls off)', true);
    const here = game.nightcity.networkService?.currentNetworkId;
    const set = here ? await v2.networks.set(here) : { ok: true };
    check('networks.set to the network you are on', set.ok, set.ok ? set.data?.name : set.error);
    check('networks.set to an unknown network: NOT_FOUND', (await v2.networks.set('no-such-network')).code === 'NOT_FOUND');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM API 2.1 writes: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">As a player, try <code>game.modules.get('night-city-messenger').api.v2.directory.add({name:'x'})</code> in the console: it must answer NOT_GM.</p>` });
})();
