# Food's Up

A macro planner: set protein / carb / fat targets per meal, and the app builds
food combinations that hit them. No build step — plain HTML, CSS and JavaScript
that the browser runs directly.

## Files

| File | What it holds |
|---|---|
| `index.html` | **Landing page.** What visitors see first at the root URL — trilingual (EN/RU/AR), RTL-aware, with a working demo calculator. Links to `app.html`. |
| `app.html` | The actual app shell: top bar, tabs. This is where sign-in lives. |
| `styles.css` | All the design for the app (`app.html`). The landing page has its own inline styles, kept separate so it loads fast and never breaks if the app's CSS changes. |
| `config.js` | Supabase URL and key. Leave empty to run in local mode. |
| `foods.js` | Starting food list (43 entries). |
| `app.js` | Application logic: account, generator, sync, views, i18n. |
| `schema.sql` | Supabase tables and security policies. |
| `logo-*.png`, `favicon-*.png` | Brand assets, shared by both pages. |

## Two pages, one deploy

`index.html` is the marketing/landing page — free-standing HTML/CSS/JS, no dependency on `app.js`. Its "Get started" and "Sign in" buttons link to `app.html?start=1`, which lands the visitor straight on the Account tab instead of the Plan tab.

Its own language toggle writes to the same `localStorage` key the app uses (`minumeal:lang`), so a language choice made on the landing page carries over automatically once someone clicks through.

If you ever change the Supabase **Site URL**, keep it pointed at your domain's root — the wildcard in **Redirect URLs** (`https://yourdomain/**`) already covers `/app.html`, so no extra Supabase configuration is needed for the two-page split.


## Running locally

Open the folder in VS Code, install the **Live Server** extension, right-click
`index.html` → *Open with Live Server*.

Without the extension, from inside the folder:

```bash
python3 -m http.server 5173
# then open http://localhost:5173
```

Double-clicking the file works too, but Supabase sign-in does not run over
`file://` — use `http://localhost`.

## Deploying

Point Cloudflare Pages or Netlify at this folder. No build command; the output
directory is the root (`/`). Connect it to a Git repo and every `git push`
republishes the site.

## Setting up sync (optional)

Skip this and the app still works — it just keeps everything in one browser.

1. **Create a project** at [supabase.com](https://supabase.com). Free tier is
   plenty. Pick a region near you.
2. **Run the schema.** Dashboard → SQL Editor → New query → paste all of
   `schema.sql` → Run. This creates the tables, the row-level security policies
   and the trigger that gives every new user their own kitchen.
3. **Email sign-in.** It is on by default. Either switch off *Confirm email*
   for a frictionless start, or leave it on and set *Site URL* to your deployed
   address under the authentication URL settings.
4. **Add your keys.** Dashboard → Project Settings → API gives you a *Project
   URL* and an *anon public* key. Put both into `config.js`.
5. **Deploy**, then create your account from the Account tab.

The anon key is public by design; security comes from the policies in step 2.
Never put the `service_role` key in this repo.

### Sharing a kitchen

Your Account tab shows a six-character invite code. A friend who signs up and
enters that code joins your kitchen. From then on:

- **Shared:** food list and saved combinations. Live-updating in both directions.
- **Private:** macro targets and daily plans.

Joining wipes the joiner's own food list, so back up first.

## Changing the design

Colour and type are declared once, in `:root`:

```css
--paper     /* page background */
--card      /* card background */
--ink       /* body text */
--muted     /* secondary text */
--line      /* borders */

--brand     /* logo dark green — primary buttons, calorie bar */
--brand-lt  /* logo light green — fills only, too low-contrast for text */

--pro       /* protein — bars, numbers, chips */
--carb      /* carbs */
--fat       /* fat */
--over      /* over target */
--ok        /* on target */

--disp      /* display face (headings) */
--body      /* body */
--mono      /* numbers, tabular figures */
```

The three macro colours carry meaning everywhere in the interface — change one
and every indicator for that macro follows. Keep them distinct from `--brand`:
brand is identity, the macro triad is data.

For a dark theme, redeclare the same variables inside
`@media (prefers-color-scheme: dark)`. Nothing else needs touching.

Changing a typeface also means updating the Google Fonts link in `index.html`.

## Map of app.js

The file is split into commented sections, in order:

1. **state** — the data model. `S.template` holds meal targets, `S.days` holds
   plans keyed by date, `S.foods` the food list.
2. **local cache** — localStorage read/write.
3. **ui helpers** — modal, toast, clipboard.
4. **generator** — `optimize()` solves portion sizes, `candidates()` builds and
   ranks whole combinations.
5. **sync** — Supabase reads and writes, the offline queue, realtime updates.
6. **views** — `viewPlan`, `viewFoods`, `viewTargets`, `viewSaved`,
   `viewAccount`. Each returns an HTML string. Meal rows are grouped by the role
   they fill, matching how the Build dialog asks for them.
7. **events** — one delegated listener, dispatching on the `data-act` attribute.

To add a screen: drop a `<button data-tab="...">` into the tab list in
`index.html`, write a `viewX()` in `app.js`, and add it to the branch in
`render()`.

## How the generator works

`candidates()` assembles random food sets — if the target needs protein it
takes one food with the protein role, likewise for carbs and fat — then calls
`optimize()` on each set, ranks the results by distance from the target, and
runs `polish()` over the shortlist.

`optimize()` runs coordinate descent: it repeatedly updates one food's quantity
using the closed-form solution that minimises error with the others held fixed,
clamps to that food's min–max range, and snaps to its portion step. 45 passes.

`polish()` then walks each portion one step size at a time and keeps any nudge
that lowers the score. Coordinate descent minimises a *symmetric* error and
snaps on the way, so on its own it can settle above the target; the polish pass
is what pulls a suggestion back down to 75 g instead of leaving it 27 g over.
It is too slow to run on all 420 tries, so it only touches the top 8.

Error weights are `W = {p:6, c:4, f:9}`, and `OVER = 3` multiplies the error of
anything *above* target — going over costs three times what falling short does.
Fat is 9 because of its calorie density; protein is 6 rather than 4 to hold the
protein target more tightly. Those are the lines to edit for more or less
tolerance.

### Build settings

The Build dialog's target and its chosen sources are kept per meal in
`S.build[mealId]` and ride along in the profile blob, so they survive a reload
and reach your other devices. Sources are a *pool*, not a fixed list: pick
chicken and beef together and each option uses one of the two, so cycling
**Another option** walks between them. Pick nothing for a role and the
generator chooses freely from every food carrying that role.

`Another option` cycles the eight candidates from the last solve and solves a
fresh batch once they run out.

### Adding a food by hand

The `+ add food…` picker groups foods by role, so you can see what something
counts as while choosing it.

`fitQty()` decides the starting portion from what the meal still has room for,
rather than dropping in a flat 100 g. It aims at the macro the food is a source
of (`ROLE_MACRO`), pulls back until no other macro crosses its target, and
rounds **down** so stepping never takes it over. Running the ordinary solver on
a single food does not work here: chasing a 55 g protein target it cannot
reach, it stacks six eggs and sails 7 g past the fat target on the way. Add an
egg to an empty breakfast and you get four — 18 g of a 20 g fat target — and a
toast naming the amount, since it is not the number you might have expected.

A food whose own minimum portion is larger than the room left (30 g of rice
against a 15 g carb target) still opens the dialog. Nothing can fix that
automatically, so it says so and lets you decide.

Rebalancing is the default and **Just add it** is a checkbox, not a second tab —
it is an exception, not an equal choice. Each row carries its role as quiet
subtitle text rather than a badge; two badges competing on one line (role plus
"new") read as decoration and said less than one line of prose.

### Other copies in this browser

`cacheKey()` is `minumeal:v3:` plus the signed-in user id, or `local` when signed
out, so every sign-in writes its own localStorage entry. Change account — or move
to a different Supabase project, which issues a fresh user id — and the old plans
are still in the browser with nothing in the interface pointing at them.

`otherCopies()` finds those entries and Settings lists them with their day count,
latest day, saved count and food count, one Load button each. Loading sets the
current state aside under `<key>:before-restore` and lists *that* too, so the
round trip is reversible without opening a console. Entries holding neither a
filled day nor a saved combination are skipped.

`f.u` is free text the user can edit. The seed list shipped two Turkish labels
(`adet`, `ölçek`); `fixUnits()` rewrites those on load and pushes the
correction once so other devices and the shared kitchen pick it up. Units
typed by hand are never touched.

If the addition would push a macro past the meal's target by more than 2 g (or
3%, whichever is larger), `fitDialog()` opens instead of adding silently. It
offers portions that still fit, shows the old value beside every number it
moved, and lets you type your own before anything reaches the plate.

The rebalance deliberately does **not** re-plan the meal: only the new food and
the sources feeding a macro that actually went over are allowed to move. Add a
spoon of oil and the oil comes down; the tomato already on the plate stays
where it is. Locked rows never move.

## The mobile app

`mobile/` holds iOS and Android shells built with Capacitor. The website in the
repo root stays the single source of truth — the shells do not have their own
copy of the app, they package the one that is already there.

```
/              the website, deployed to Vercel exactly as before
/mobile        the Capacitor project
  sync.mjs     copies the site files into mobile/www/
  www/         generated, gitignored — what ships inside the app
  ios/         generated by `npx cap add ios`
  android/     generated by `npx cap add android`
```

`package.json` lives in `mobile/`, never in the root: Vercel reads the root to
decide how to deploy, and a `package.json` there would make it try to build a
Node project instead of serving the static files.

`sync.mjs` names the files the app needs rather than copying the whole folder,
and renames `app.html` to `index.html` — a native shell opens `index.html`, and
in the app there is no landing page to pass through. It leaves out the landing
page, `sw.js` (nothing to cache when the files are already on the device) and
the SQL schema.

```bash
cd mobile
npm install
npm run sync      # rebuild www/ and push it into the native projects
npm run ios       # sync, then open Xcode
npm run android   # sync, then open Android Studio
```

Run `npm run sync` after every change to the site, or the app keeps showing the
previous version.

### Building Android

```bash
cd mobile
npm run android         # assemble www/, then build the debug APK
npm run android:run     # the above, then install and launch on a connected device
npm run android:studio  # assemble www/, then open the project in Android Studio
```

Opening the project in Android Studio upgraded what Capacitor generated: AGP
8.13 to 9.4.1 and Gradle 8.14.3 to 9.6.0. That upgrade needed one fix —
`app/build.gradle` referenced `proguard-android.txt`, which AGP 9 rejects for
carrying `-dontoptimize`; the `-optimize` variant is the same file without that
line. With that change the debug APK builds on both the old and new toolchains.

`android-env.sh` points the build at a JDK and the SDK. There is no system Java
on this machine, and Android Studio's own JDK is version 25, which the Gradle
Capacitor originally generated could not read (`Unsupported class file major
version 69` — its release notes list "Java 24 support" as a feature). Gradle 9.6
handles 25, and `gradle/gradle-daemon-jvm.properties` now pins the daemon to
JDK 21 regardless, but the `gradlew` launcher still needs some JVM on PATH, so
the script stays:

```bash
brew install openjdk@21
```

That is a Homebrew formula rather than a cask, so it installs under
`/opt/homebrew` without a password and leaves the system Java alone.

`android/local.properties` holds the SDK path. It is gitignored — the path is
specific to one machine.

**Run the emulator from Android Studio, not the terminal.** Started headless
from a shell, the emulator on this setup wedges partway up: first with
`Failed to bind to texture: invalid color buffer`, then, with software
rendering, with `Can't find service: activity` once the system services fall
over. `npm run android:studio` opens the project; the green Run button starts
the emulator in a real window with a working GPU context. `npm run android:run`
is for a phone plugged in over USB with debugging enabled, where there is no
emulator involved.

### What each platform needs

| | Free to build and run | Costs money |
|---|---|---|
| iOS | Xcode, the Simulator, and your own iPhone (free Apple ID, re-signed weekly) | App Store: Apple Developer Program, $99/year |
| Android | Android Studio, the emulator, APKs on your own device | Play Store: $25 once |

Writing the code and running it on real hardware costs nothing. The fees are
for publishing, and that decision can wait.
