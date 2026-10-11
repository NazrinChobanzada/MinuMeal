/* Collect the website's files into mobile/www/, which is what Capacitor copies
   into the iOS and Android projects.

   Why a copy step instead of pointing Capacitor at the repo root: Capacitor
   copies everything in webDir into both native projects. Pointed at the root it
   would drag in .git, node_modules, ios/, android/ and the SQL schema. So we
   name the files the app actually needs, and nothing else.

   Run it with:  npm run sync
*/
import { mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');          // the repo root: the website itself
const www  = join(here, 'www');         // what ships inside the app

// Left side: the file in the repo root. Right side: its name inside the app.
// app.html becomes index.html because a native shell opens index.html — in the
// app there is no landing page to pass through, you are already "inside".
const FILES = {
  'app.html':             'index.html',
  'styles.css':           'styles.css',
  'app.js':               'app.js',
  'config.js':            'config.js',
  'foods.js':             'foods.js',
  'manifest.json':        'manifest.json',
  'logo-lockup.png':      'logo-lockup.png',
  'logo-icon.png':        'logo-icon.png',
  'icon-192.png':         'icon-192.png',
  'apple-touch-icon.png': 'apple-touch-icon.png',
  'favicon-32.png':       'favicon-32.png',
};

// Deliberately NOT copied:
//   index.html  — the marketing landing page; the app opens straight into the planner
//   sw.js       — a service worker caches files off a server. Inside the app the
//                 files are already on the device, so it would add nothing.
//   schema.sql, README.md — not part of what runs.

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });

for (const [from, to] of Object.entries(FILES)) {
  await copyFile(join(site, from), join(www, to));
}

const copied = (await readdir(www)).length;
console.log(`www/ rebuilt — ${copied} files from the site root`);
