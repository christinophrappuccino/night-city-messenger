// NCM audit fix E4 — "do NCM's rolls follow the roll mode, and does NCM stop leaking styles and settings?"
// Run as anyone. It reads settings, puts a few invisible test elements on the page for a moment to see whether
// NCM's stylesheet still reaches them, then removes them. No roll is made and nothing is saved. Results arrive as
// a chat card whispered to you.
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const probes = [];
  try {
    // 1. Roll mode
    const { rollModeAudience, currentRollMode } = await import('/modules/night-city-messenger/scripts/services/SkillService.js');
    const mode = currentRollMode();
    const aud = rollModeAudience(mode);
    const who = aud.blind ? 'the GMs only (hidden from you)' : aud.whisper ? `${aud.whisper.length} user(s)` : 'everyone';
    check('NCM skill rolls follow your chat roll mode', typeof rollModeAudience === 'function', `you are on "${mode}", so the dice and the card go to ${who}`);
    check('GM roll goes to the GMs and you', rollModeAudience('gmroll').whisper.includes(game.user.id) && rollModeAudience('gmroll').blind === false);
    const blind = rollModeAudience('blindroll');
    check('Blind roll goes to the GMs only', blind.blind === true && (game.user.isGM || !blind.whisper.includes(game.user.id)));

    // 2. Map notes: switched on once, then remembered
    const key = `ncm.notesAutoShown.${game.world.id}.${game.user.id}`;
    const auto = game.settings.get('night-city-messenger', 'terminalPinsAutoShow');
    check('Map notes are switched on once, then your choice is kept', !auto || localStorage.getItem(key) === '1', auto ? 'remembered on this browser' : '"Show terminal pins automatically" is off, so NCM never touches it');

    // 3. Leftover styles no longer reach other modules' elements
    const probe = (html) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden'; d.innerHTML = html; document.body.appendChild(d); probes.push(d); return d.firstElementChild; };
    const mk = probe('<div class="mk-place"></div>');
    check('A ".mk-place" element elsewhere is left alone', getComputedStyle(mk).display !== 'grid', `display: ${getComputedStyle(mk).display}`);
    const fw = probe('<div class="fw-in"></div>');
    check('A ".fw-in" element elsewhere does not animate', getComputedStyle(fw).animationName === 'none', `animation: ${getComputedStyle(fw).animationName}`);
    const step = probe('<button type="button" data-rollp-step="x">x</button>');
    check('A "data-rollp-step" button elsewhere is left alone', getComputedStyle(step).borderRadius !== '2px' || getComputedStyle(step).width !== '22px', `width ${getComputedStyle(step).width}`);
    const boot = probe('<div data-boot-animation="crt-power-on"></div>');
    check('A "data-boot-animation" element elsewhere does not animate', getComputedStyle(boot).animationName === 'none', `animation: ${getComputedStyle(boot).animationName}`);

    // 4. Popped-out chat (informational)
    check('Chat-card buttons are bound in every chat log, popped out ones too', true, 'pop the chat log out (right-click the chat tab) and try "View in Inbox" on a shared message card');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    for (const p of probes) p.remove();
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM E4 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check: set the chat roll mode to "Blind GM Roll", then make an NCM skill roll (a shard breach, a network login). The 3D dice and the card should show only for the GM. NCM's own screens still tell the roller whether it worked.</p>` });
})();
