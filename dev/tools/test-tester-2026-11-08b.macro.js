// NCM batch (tester round 2026-11-08, second batch: the district list, calls that never rang now logged, the
// corporate switchboard, Call as from a contact's own line, greeting sound files, Reply All can add people, the
// messenger opens at the size it was left at). Run as a GM after reloading the world. Checks the rules in the running
// module (no world writes), then whispers a result card with the by-hand list (most of it needs a player client).
(async () => {
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const MID = 'night-city-messenger';
  const base = `/modules/${MID}/scripts`;
  const text = async (p) => (await fetch(`/modules/${MID}/${p}`, { cache: 'no-store' })).text();
  try {
    if (!game.user.isGM) throw new Error('Run as a GM');
    const cs = game.nightcity?.callService;
    if (!cs) throw new Error('The call service is not loaded (Calls switched off?)');

    // 1. the district list keeps its rows' height
    const css = await text('styles/components/admin-panel/tab-phone.css');
    check('District list: rows keep their height and the list scrolls', /\.ncm-wk-opts \{[^}]*grid-auto-rows: max-content/.test(css));

    // 2. a call that never rang is accepted for the log (built from what the GM can check)
    const pc = game.actors.find((a) => a.hasPlayerOwner && cs.numberOf(a.id));
    const owner = pc ? game.users.find((u) => !u.isGM && pc.testUserPermission(u, 'OWNER')) : null;
    if (pc && owner) {
      const sum = { callId: `ncmtest-${Date.now()}`, outcome: 'answered', unrung: true, from: { actorId: pc.id, number: cs.numberOf(pc.id) }, to: { number: 'ARA-0100', name: 'Arasaka' }, lines: [{ text: 'forged' }] };
      const r = cs._unrungSummary(sum, owner);
      check(`A no-ring call by ${pc.name} is accepted, with no words and no person on the other end`, r.ok && r.summary.lines.length === 0 && !r.summary.to.actorId, r.why || '');
      const other = game.users.find((u) => !u.isGM && !pc.testUserPermission(u, 'OWNER'));
      if (other) check('Someone else cannot log it as them', !cs._unrungSummary({ ...sum, callId: sum.callId + 'b' }, other).ok);
      cs._loggedCalls?.delete(sum.callId);
    } else check('No player character with a number (skipped)', true, 'give a player character a number to check it here');
    check('The service has the switchboard (boardPick)', typeof cs.boardPick === 'function');

    // 3. the switchboard screen
    const { CallHud } = await import(`${base}/ui/Calls/CallHud.js`);
    const hud = Object.create(CallHud.prototype); hud.service = cs;
    const html = hud._boardHtml({ id: 'x', board: { greet: 'Hello <b>', exts: [{ x: '17', who: 'Mr. Smith' }], operator: true } });
    check('The switchboard shows the greeting (escaped), the extensions and a box', html.includes('Hello &lt;b&gt;') && html.includes('data-act="ext"') && html.includes('data-board-ext'));

    // 4. Call as from a line
    const nv = await text('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
    check('A line\'s Dial button passes its number', nv.includes('data-n="${esc(l.n)}"'));

    // 5. greeting sound files
    const V = await import(`${base}/utils/voicemail.js`);
    check('A greeting takes an https link or a world path, never http:// or a script', V.greetingLink('https://x.test/a.mp3') && V.greetingLink('worlds/w/a.ogg') && !V.greetingLink('http://x.test/a.mp3') && !V.greetingLink('javascript:alert(1)'));
    check('The greeting kind reads Audio', V.GREETING_LABELS.recorded === 'Audio');

    // 6. Reply All, the messenger's size
    const comp = await text('scripts/ui/MessageComposer/MessageComposerApp.js');
    check('Every reply keeps the To field open (an anonymous one stays locked)', comp.includes("recipientLocked: this.mode === 'reply' && !!this.anonReplyTo,"));
    const Q = await import(`${base}/utils/replyQuote.js`);
    const orig = { from: 'a@x.net', to: 'b@x.net', participants: [{ email: 'a@x.net' }, { email: 'b@x.net' }] };
    check('A reply quotes the earlier mail only when someone new is on it', Q.newcomers(orig, [{ email: 'a@x.net' }]).length === 0 && Q.newcomers(orig, [{ email: 'c@x.net', name: 'C' }]).join() === 'C');
    check('Never a locked or self-destructing original', !!Q.quoteBlockedWhy({ encryption: { type: 'ICE' } }) && !!Q.quoteBlockedWhy({ selfDestruct: { mode: 'after_read' } }));
    const hudSrc = await text('scripts/ui/Calls/CallHud.js');
    check('A half-typed extension survives a redraw', hudSrc.includes('again.value = kept.value'));
    const { MessageViewerApp } = await import(`${base}/ui/MessageViewer/MessageViewerApp.js`);
    check('The messenger remembers its size', typeof MessageViewerApp._openingSize === 'function' && typeof MessageViewerApp.prototype._rememberSize === 'function');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  }
  const ok = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM tester round 2026-11-08 (2): ${ok ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">By hand, with a player client:<br>
    1. Admin → Phone → Numbers: Walk through it for someone in Night City, on an area with many districts. The rows are full height and the list scrolls.<br>
    2. Corporations: set an office to "You" answer, a greeting and a listed extension. As the player, dial its main number from the keypad: the switchboard shows the greeting, the extension, a box and Operator. A wrong extension says "No such extension" and stays.<br>
    3. Pick Operator and don't answer: after the ring, the office's greeting plays and you can leave a message.<br>
    4. After each call, the player's Calls log (Outgoing) AND Admin → Phone → Call log show it. Also dial a number nobody has: "Not in service" is logged.<br>
    5. Give an NPC a second (office) line. Numbers → that line → Dial: the choice names the office number, and the player's screen shows that number.<br>
    6. Player: Calls → My line → Greeting → Audio → paste a sound-file link → Play → Save. Call them from another client and don't answer: that file plays. As GM, the line's greeting dialog has the same field and a folder button.<br>
    7. Reply, and Reply All: the To field says "Add someone…" and Cc is there; the sender's chip has a lock. Reply to an anonymous mail: no To field.<br>
    7b. Reply and add someone who was not on the mail: "Copied in for new people" shows by Replying to. Send: the new person's copy ends with the quoted earlier mail. On an encrypted mail it says "Not copied in" instead.<br>
    7c. On the switchboard, type part of an extension, then ring that player from another client: the typed digits stay.<br>
    7d. My line → Audio → paste an http:// (not https) link → Save: refused with a message saying why.<br>
    8. Player with Text Size 120%: open the messenger (bigger than before), resize it, close, reopen: it opens at the size you left it.</p>` });
})();
