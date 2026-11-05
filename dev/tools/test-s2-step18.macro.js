// NCM stage 2, step 18 — Module Settings in sections, and the public API v2 (docs/API.md). Read-only (it opens and
// closes the settings window). Run as the GM; for the player half, a player runs it too (it skips the GM-only checks
// and checks the GM-only parts are refused). Results arrive as a whispered card.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isGM = game.user.isGM;
  try {
    // ── Module Settings ──
    const C = await import('/modules/night-city-messenger/scripts/utils/compat.js');
    const app = new (C.SettingsConfigClass())();
    await app.render(game.release.generation >= 13 ? { force: true } : true);
    await sleep(1200);
    try { app.changeTab?.('night-city-messenger', 'categories'); } catch { /* v12 */ }
    await sleep(500);
    const root = app.element instanceof HTMLElement ? app.element : app.element?.[0];
    const heads = [...root.querySelectorAll('.ncm-settings-head')].map((h) => h.firstChild?.textContent);
    const rows = [...root.querySelectorAll('[name^="night-city-messenger."]')].map((e) => e.closest('.form-group'));
    const under = rows.every((r) => { let p = r?.previousElementSibling; while (p && !p.classList.contains('ncm-settings-head')) p = p.previousElementSibling; return !!p; });
    await app.close();
    check(`Module Settings shows NCM in sections (${heads.length})`, heads.length >= (isGM ? 8 : 1) && under, heads.join(' · '));
    check('No setting fell into "Other"', !heads.includes('Other'));

    // ── API v2 ──
    const api = game.modules.get('night-city-messenger')?.api;
    const v2 = api?.v2;
    check('api.v2 is there (version 2.0.0, frozen); v1 still answers', v2?.version === '2.0.0' && Object.isFrozen(v2) && api.apiVersion === '1.2.0' && !!api.messenger, `apiVersion ${api?.apiVersion}`);
    const shape = (r) => r && (r.ok === true ? 'data' in r : (r.ok === false && v2.codes.includes(r.code)));
    const mine = game.actors.find((a) => a.isOwner && a.hasPlayerOwner) || game.user.character || game.actors.find((a) => a.isOwner);
    const results2 = {
      status: await v2.networks.status(), available: await v2.networks.available(),
      list: mine ? await v2.messages.listFor(mine.id, { limit: 5 }) : null, contacts: mine ? await v2.contacts.listFor(mine.id) : null,
      groups: await v2.groups.list(mine ? { actorId: mine.id } : {}), dir: await v2.directory.list(), badShard: await v2.open.shard('no-such-item'),
    };
    check('Every call returns { ok, data } or { ok:false, code, error }', Object.values(results2).every((r) => r === null || shape(r)));
    check(`Your character's mail reads (${mine?.name || 'no character'})`, !mine || results2.list.ok, results2.list?.ok ? `${results2.list.data.length} message(s)` : results2.list?.error);
    check(isGM ? 'The GM reads the directory' : 'A player is refused the directory (NOT_GM)', isGM ? results2.dir.ok : results2.dir.code === 'NOT_GM', results2.dir.ok ? `${results2.dir.data.length} contact(s)` : results2.dir.code);
    check('A missing shard is NOT_FOUND, with no toast', results2.badShard.code === 'NOT_FOUND');
    check('Network status is plain (no passwords)', results2.status.ok && !JSON.stringify(results2.status.data).includes('password'), results2.status.data?.network?.name);
    const other = game.actors.find((a) => !a.isOwner);
    if (!isGM && other) { const r = await v2.messages.listFor(other.id); check("A player cannot read another character's mail (NOT_OWNER)", r.code === 'NOT_OWNER'); }
    let heard = 0; const stop = v2.events.on('message:sent', () => heard++); stop?.();
    check('events.on returns a stop function; there is no emit', typeof stop === 'function' && !('emit' in v2.events));
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM stage 2, step 18: ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: open Configure Settings → Night City Messenger and read it top to bottom — each section heading with its hint, the switches first.</p>` });
})();
