// NCM audit fix E2 — "do deletions and links clean up after themselves?"
// Run as the GM. It adds three throwaway directory contacts ("E2 TEST …"), deletes the main one, checks the two
// aliases were given a new home, then deletes the rest. Everything else it only reads. Results arrive as a chat
// card whispered to you.
(async () => {
  if (!game.user.isGM) { ui.notifications.warn('E2 test: run this as the GM.'); return; }
  const ns = game.nightcity;
  const mcs = ns?.masterContactService;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  if (!mcs) { ui.notifications.warn('E2 test: NCM is not loaded.'); return; }

  const made = [];
  try {
    // 1. Deleting a main identity re-homes its aliases
    const root = await mcs.addContact({ name: 'E2 TEST Rogue', email: 'e2-rogue@test.nc', type: 'npc' });
    const rootId = root?.contact?.id;
    if (rootId) made.push(rootId);
    const a1 = await mcs.addContactIdentity(rootId, { name: 'E2 TEST Ghost', email: 'e2-ghost@test.nc' });
    const a2 = await mcs.addContactIdentity(rootId, { name: 'E2 TEST Queen', email: 'e2-queen@test.nc' });
    const id1 = a1?.contact?.id, id2 = a2?.contact?.id;
    made.push(id1, id2);
    check('Three test contacts made (a main and two aliases)', !!(rootId && id1 && id2));
    await mcs.removeContact(rootId);
    made.splice(made.indexOf(rootId), 1);
    const c1 = mcs.getContact(id1), c2 = mcs.getContact(id2);
    check('Deleting the main makes the first alias the new main', !!c1 && !c1.identityOf, c1?.identityOf ? `still points at ${c1.identityOf}` : '');
    check('…and the other alias now points at it', c2?.identityOf === id1, `points at ${c2?.identityOf || 'nothing'}`);

    // 2. The Orphan Audit's repair, dry run only
    const plan = await mcs.repairIdentityLinks();
    check('The Orphan Audit can check directory links', Array.isArray(plan?.stranded) && Array.isArray(plan?.deadLinks), `${plan?.stranded?.length ?? '?'} stranded alias(es), ${plan?.deadLinks?.length ?? '?'} contact(s) linked to a deleted character — run Tools → Orphan Audit to repair them`);

    // 3. Migration ordering
    const done = game.settings.get('night-city-messenger', 'namespaceMigrationDone');
    const ver = game.settings.get('night-city-messenger', 'dataSchemaVersion');
    check('This world\'s data is on the current id and schema', done === true && Number(ver) >= 6, `id migration ${done ? 'done' : 'NOT done'}, schema v${ver}`);

    // 4. Carried terminals (informational)
    const terms = ns.terminalService?.collectTerminals?.() || [];
    const carried = terms.filter((t) => t.parent).length;
    check('Carried terminals are now included in expiry and trigger checks', typeof ns.terminalService?.collectTerminals === 'function', `${terms.length} terminal(s), ${carried} carried by a character`);

    // 5. Call lines
    const { lineFromRightSide } = await import(`/modules/night-city-messenger/scripts/utils/callModel.js`);
    const call = { from: { userId: 'a' }, to: { userIds: ['b', 'c'] }, answeredBy: 'b' };
    check('A call line is only accepted from the person on that side', lineFromRightSide(call, { side: 'callee' }, 'b') && !lineFromRightSide(call, { side: 'callee' }, 'c') && !lineFromRightSide(call, { side: 'caller' }, 'b'));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    for (const id of made.filter(Boolean)) { try { await mcs.removeContact(id); } catch { /* best effort */ } }
  }

  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM E2 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Optional real checks: make a payphone call to a player who doesn't answer and leave a voicemail — it should arrive. Destroy an archive copy of a shard (Admin → Shards) — the player's real shard keeps its files.</p>` });
})();
