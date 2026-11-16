// test-terminal-commands — commands other modules add to the TTY prompt (API v2.2.0, scripts/utils/terminalCommands.js):
// names are checked, NCM's own can't be taken, applies() filters, run() output becomes lines, a throw becomes a line,
// and TerminalViewerApp tries them only after its own commands, just before "unknown command", and lists them under ?.
// Run: node dev/tools/sims/test-terminal-commands.mjs
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const T = await import(pathToFileURL(path.join(ROOT, 'scripts/utils/terminalCommands.js')).href);

ok(T.registerTerminalCommand({ name: 'cd', run: () => '' }) === null, 'a viewer command is refused');
ok(T.registerTerminalCommand({ name: 'bad name', run: () => '' }) === null && T.registerTerminalCommand({ name: 'x' }) === null, 'a bad name or no run is refused');
const off = T.registerTerminalCommand({ name: 'Alarm', help: 'fire it', applies: (ctx) => ctx.itemId === 't1', run: (ctx) => [`ALARM ${ctx.args.join(' ')}`, ''] });
ok(typeof off === 'function', 'a good command registers');
ok(T.commandsFor({ itemId: 't1' }).length === 1 && T.commandsFor({ itemId: 't2' }).length === 0, 'applies() decides which terminals show it');
ok(JSON.stringify(await T.runTerminalCommand('alarm on now', { itemId: 't1' })) === JSON.stringify(['ALARM on now']), 'run gets the args; empty lines drop');
ok((await T.runTerminalCommand('alarm', { itemId: 't2' })) === null, "a terminal it doesn't apply to: not handled");
T.registerTerminalCommand({ name: 'boom', run: () => { throw new Error('nope'); } });
ok(JSON.stringify(await T.runTerminalCommand('boom', {})) === JSON.stringify(['boom: nope']), 'a throw becomes a line, never an error');
off(); ok(T.commandsFor({ itemId: 't1' }).every((c) => c.name !== 'alarm'), 'the unregister function takes it off');

const V = readFileSync(path.join(ROOT, 'scripts/ui/Terminal/TerminalViewerApp.js'), 'utf8').replace(/\r\n/g, '\n');
const fn = V.slice(V.indexOf('  _onTtyCommand(raw) {'), V.indexOf('  _ttyCmdCtx() {'));
ok(fn.includes('runTerminalCommand(c, this._ttyCmdCtx())') && fn.indexOf('runTerminalCommand(') > fn.indexOf("const cd = /^cd"), 'the prompt tries registered commands last, after cd');
ok(/unknown command: \$\{c\}/.test(fn.slice(fn.indexOf('runTerminalCommand('))), '"unknown command" only when nothing took it');
ok(fn.includes('commandsFor(this._ttyCmdCtx())'), '? lists them');
const c0 = V.indexOf('  _ttyCmdCtx() {'); const ctx = V.slice(c0, V.indexOf('\n  }\n', c0));
ok(!/:\s*this\.item\s*[,}]/.test(ctx) && !/:\s*this\.terminalService\s*[,}]/.test(ctx) && !/:\s*acct\s*[,}]/.test(ctx),'the context is plain data: no documents, no services');

console.log(`test-terminal-commands: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
