# Minumeal

A macro planner: set protein / carb / fat targets per meal, and the app builds
food combinations that hit them. No build step — plain HTML, CSS and JavaScript
that the browser runs directly.

## Files

| File | What it holds |
|---|---|
| `index.html` | Page shell: top bar, date strip, tabs. Rarely changes. |
| `styles.css` | All the design. Colours and type live in the `:root` block at the top. |
| `config.js` | Supabase URL and key. Leave empty to run in local mode. |
| `foods.js` | Starting food list (43 entries). |
| `app.js` | Application logic: account, generator, sync, views. |
| `schema.sql` | Supabase tables and security policies. |
| `logo-*.png`, `favicon-*.png` | Brand assets. |

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
   `viewAccount`. Each returns an HTML string.
7. **events** — one delegated listener, dispatching on the `data-act` attribute.

To add a screen: drop a `<button data-tab="...">` into the tab list in
`index.html`, write a `viewX()` in `app.js`, and add it to the branch in
`render()`.

## How the generator works

`candidates()` assembles random food sets — if the target needs protein it
takes one food with the protein role, likewise for carbs and fat — then calls
`optimize()` on each set and ranks the results by distance from the target.

`optimize()` runs coordinate descent: it repeatedly updates one food's quantity
using the closed-form solution that minimises error with the others held fixed,
clamps to that food's min–max range, and snaps to its portion step. 45 passes.

Error weights are `W = {p:6, c:4, f:9}`. Fat is 9 because of its calorie
density; protein is 6 rather than 4 to hold the protein target more tightly.
That is the line to edit if you want more or less tolerance on protein.
