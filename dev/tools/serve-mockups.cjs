#!/usr/bin/env node
/**
 * Serve the repo (and the two vendor stylesheets) over http for the mockups.
 * @file dev/tools/serve-mockups.cjs
 * @module night-city-messenger
 *
 * WHY THIS EXISTS
 * ---------------
 * A `file://` page cannot `import` an ES module: Chrome treats every file URL as
 * a unique opaque origin and blocks it as a cross-origin request. There is no
 * error on screen — the page just renders without the thing it was meant to
 * show. `dev/mockups/boot-splash-preview.html` imports the REAL BootSplash.js,
 * so double-clicking it showed an empty backdrop and nothing else.
 *
 * The same applies to any preview that `fetch`es a real `.hbs` (the admin-security
 * and config-theme probes), which is why those carried a "render with
 * --allow-file-access-from-files" note. Serving over http fixes all of them at
 * once and needs no browser flags.
 *
 *   node dev/tools/serve-mockups.cjs [port]
 *
 * Zero dependencies, read-only, binds to localhost only.
 *
 * The previews link Foundry core + the Cyberpunk RED system stylesheet by
 * absolute `file:///` path so they render against the REAL cascade. An http page
 * may not load a file:// stylesheet, so those two are mirrored here under
 * /_vendor/ and the pages pick the right form from `location.protocol`.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.argv[2] || 8123);

/** The two stylesheets that live outside the repo. Mirrored, never served from a
 *  path the client controls. */
const VENDOR = {
  '/_vendor/foundry2.css': [
    'C:/Program Files/Foundry Virtual Tabletop/resources/app/public/css/foundry2.css',
    'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/public/css/foundry2.css',
  ],
  '/_vendor/cpr.css': [
    path.resolve(ROOT, '../../systems/cyberpunk-red-core/main.css'),
  ],
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.hbs': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

VENDOR['/_vendor/cpr-main.css'] = VENDOR['/_vendor/cpr.css']; // name-picker-probe.html asks by this name

/** Font Awesome ships inside the Foundry install (fonts/fontawesome/). A page
 *  links /_vendor/fa/css/all.min.css and that stylesheet's own relative
 *  ../webfonts/*.woff2 then resolve under the same prefix — so icons render
 *  over http, not only off disk. Read-only, confined to that one directory. */
const FA_DIRS = [
  'C:/Program Files/Foundry Virtual Tabletop/resources/app/public/fonts/fontawesome',
  'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/public/fonts/fontawesome',
];
const FA_PREFIX = '/_vendor/fa/';

const firstThatExists = (list) => list.find((p) => fs.existsSync(p)) || null;

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, `not found: ${file}`);
    send(res, 200, buf, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  if (VENDOR[url]) {
    const hit = firstThatExists(VENDOR[url]);
    if (!hit) return send(res, 404, `${url}: not installed on this machine`);
    return serveFile(res, hit);
  }

  if (url.startsWith(FA_PREFIX)) {
    const dir = firstThatExists(FA_DIRS);
    if (!dir) return send(res, 404, 'Font Awesome: Foundry install not found on this machine');
    const file = path.normalize(path.join(dir, url.slice(FA_PREFIX.length)));
    if (!file.startsWith(path.normalize(dir))) return send(res, 403, 'outside the font directory');
    return serveFile(res, file);
  }

  if (url === '/') {
    const list = fs.readdirSync(path.join(ROOT, 'dev/mockups'))
      .filter((f) => f.endsWith('.html')).sort();
    return send(res, 200,
      `<meta charset="utf-8"><title>NCM mockups</title>`
      + `<body style="background:#0b0b12;color:#cfd8e3;font:14px/1.7 monospace;padding:28px">`
      + `<h1 style="font-size:15px;letter-spacing:.2em">NCM MOCKUPS</h1>`
      + list.map((f) => `<div><a style="color:#19f3f7" href="/dev/mockups/${f}">${f}</a></div>`).join(''),
      'text/html; charset=utf-8');
  }

  // Everything else comes from the repo, and only from the repo.
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) return send(res, 403, 'outside the repo');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    serveFile(res, file);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nNCM mockups → http://127.0.0.1:${PORT}/`);
  console.log(`  boot splash → http://127.0.0.1:${PORT}/dev/mockups/boot-splash-preview.html`);
  console.log(`  concepts    → http://127.0.0.1:${PORT}/dev/mockups/boot-splash-concepts.html`);
  for (const [route, cands] of Object.entries(VENDOR)) {
    if (!firstThatExists(cands)) console.log(`  ! ${route} not found — previews will render without that stylesheet`);
  }
  console.log('\nCtrl+C to stop.\n');
});
