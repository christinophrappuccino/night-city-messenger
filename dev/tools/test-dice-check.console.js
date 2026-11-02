/*
 * Why no Dice So Nice? Paste into the browser console (F12) on the client that doesn't see dice. Changes nothing.
 * It throws one real die on your screen only, then prints a report and whispers it to the GMs.
 */
(async () => {
  const rows = [];
  const d3 = game.dice3d;
  const mod = game.modules.get('dice-so-nice');
  rows.push(`Dice So Nice: installed ${!!mod}, active ${!!mod?.active}, version ${mod?.version ?? 'n/a'}`);
  rows.push(`game.dice3d present: ${!!d3}, showForRoll: ${typeof d3?.showForRoll}`);
  let cfg = null;
  try { cfg = d3?.constructor?.CONFIG?.(); } catch (e) { rows.push(`Could not read its settings: ${e.message}`); }
  if (cfg) rows.push(`3D dice enabled for this user: ${cfg.enabled}, canvas layer: ${cfg.canvasZIndex}, hide after roll: ${cfg.hideAfterRoll}`);
  try { rows.push(`isEnabled now: ${d3?.isEnabled?.()}`); } catch (e) { rows.push(`isEnabled failed: ${e.message}`); }
  try { rows.push(`Disabled during combat: ${game.settings.get('dice-so-nice', 'disabledDuringCombat')}, combat running: ${!!game.combat?.started}`); } catch { /* an older version */ }
  const box = document.getElementById('dice-box-canvas');
  rows.push(box ? `Dice canvas: on the page, size ${box.offsetWidth}x${box.offsetHeight}, z-index ${getComputedStyle(box).zIndex}, parent ${box.parentElement?.id || box.parentElement?.tagName}` : 'Dice canvas: NOT on the page');
  const es = game.nightcity?.emergencyService;
  rows.push(`NCM: skillService._showDice3d ${typeof game.nightcity?.skillService?._showDice3d}, emergencyService.showDie ${typeof es?.showDie} (undefined = the new code has not loaded, reload)`);
  rows.push(`Sound: enabled ${(() => { try { return game.settings.get('night-city-messenger', 'soundEnabled'); } catch { return 'n/a'; } })()}, volume ${(() => { try { return game.settings.get('night-city-messenger', 'soundVolume'); } catch { return 'n/a'; } })()}`);
  try {
    if (d3?.showForRoll) {
      const roll = await new Roll('1d10').evaluate();
      const t0 = performance.now();
      const shown = await Promise.race([d3.showForRoll(roll, game.user, false), new Promise((r) => setTimeout(() => r('timed out after 12 s'), 12000))]);
      rows.push(`Test die: rolled ${roll.total}; showForRoll answered ${shown} after ${Math.round(performance.now() - t0)} ms`);
    }
  } catch (e) { rows.push(`Test die FAILED: ${e.message}`); }
  console.log('NCM dice check\n' + rows.join('\n'));
  await ChatMessage.create({ whisper: game.users.filter((u) => u.isGM).map((u) => u.id), content: `<b>Dice check, ${game.user.name}</b><br>${rows.map((r) => r.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))).join('<br>')}` });
  ui.notifications.info('Dice check done. See the whisper in chat.');
})();
