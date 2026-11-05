// NCM audit fix A6 — "does a payphone call stop handing out who is really on it?"
// Run as anyone. It checks the masking rule, then lifts and hangs up a PRETEND booth (an id no real booth has) while
// watching what this client sends. Nothing is saved. Results arrive as a chat card whispered to you.
(async () => {
  const ns = game.nightcity;
  const results = [];
  const check = (name, pass, note = '') => results.push({ name, pass, note });
  const sm = ns?.socketManager;
  const realEmit = sm?.emit?.bind(sm);
  try {
    const { payphoneSendGroups } = await import('/modules/night-city-messenger/scripts/utils/payphones.js');
    const gm = (id) => id === 'gm';
    const call = { from: { payphone: 'pp', realUserId: 'caller' }, to: { userIds: ['answerer'] }, answeredBy: 'answerer' };
    const g = payphoneSendGroups(call, ['gm', 'caller', 'answerer'], gm);
    const of = (id) => g.find((x) => x.userIds.includes(id));
    check('Whoever answers a booth\'s call sees the booth, not the person', of('answerer').maskFrom === true && !of('caller').maskFrom && !of('gm').maskFrom);

    if (!sm || !ns.payphoneService) throw new Error('NCM is not loaded');
    const sent = [];
    sm.emit = (op, data) => { if (data?.id === 'ncm-a6-test') sent.push(data); return realEmit(op, data); };
    ns.payphoneService.setUse('ncm-a6-test', true, { callId: 'pretend-call' });
    ns.payphoneService.setUse('ncm-a6-test', false);
    const lift = sent.find((d) => d.entry);
    check('Lifting a handset tells others who, but not which call', !!lift && lift.entry.callId === null, lift ? `sent: ${lift.entry.name}, call ${lift.entry.callId}` : 'nothing was sent');
  } catch (err) {
    check('The test ran without an error', false, err.message);
  } finally {
    if (sm && realEmit) sm.emit = realEmit;
  }
  const all = results.every((r) => r.pass);
  const rows = results.map((r) => `<li>${r.pass ? '✔' : '✘'} ${r.name}${r.note ? ` — <i>${Handlebars.escapeExpression(String(r.note))}</i>` : ''}</li>`).join('');
  ChatMessage.create({ whisper: [game.user.id], content: `<b>NCM A6 test: ${all ? 'PASS ✔' : 'FAIL ✘'}</b><ul>${rows}</ul><p style="font-size:12px">Real check (two clients): a player calls another player from a payphone. The one who answers sees "Payphone, …", never the caller. The GM's call log still shows who really called.</p>` });
})();
