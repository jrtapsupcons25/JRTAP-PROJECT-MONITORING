# JRTAP Site Ops

A field operations app for **JR.TAP Supplies and Construction Services** (owner: Braulio Jr Piano). Office staff (Owner/Admin) manage projects, approve material and petty cash requests, and review company-wide payroll; site staff (supervisors/engineers/laborers) log daily activity, submit requests, and track manpower from the field.

This is a real, deployable Vite + vanilla JavaScript single-page app backed by Supabase (Postgres + Auth + Storage + Realtime). It replaces an earlier prototype that lived entirely inside a Claude Artifact sandbox — there is no dependency on that runtime here; this is a normal static web app you can build and host anywhere.

## Stack

- [Vite](https://vitejs.dev/) + plain ES modules (no framework, no TypeScript, no build-time template language)
- [`@supabase/supabase-js`](https://supabase.com/docs/reference/javascript) v2 for Auth, Postgres (via PostgREST, schema `siteops`), Storage, and Realtime
- A `state` object + `render()` pipeline with hash-based routing, organized under `src/`

## Local development

```bash
npm install
npm run dev
```

Then open the printed local URL (usually `http://localhost:5173`).

## Building for production

```bash
npm run build
```

Output goes to `dist/`. Preview the production build locally with:

```bash
npm run preview
```

## Environment variables

The app reads two Vite env vars:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/publishable key |

**Both already have working defaults baked into `src/supabase.js`**, pointing at the JRTAP Site Ops Supabase project — so the app runs out of the box with zero configuration. Set `.env` (copy `.env.example`) only if you want to point the app at a different Supabase project without editing source.

```bash
cp .env.example .env
```

## Deploying to Vercel

1. Push this repository to GitHub (see note below — it isn't pushed yet).
2. In Vercel, click **New Project** and import the GitHub repo.
3. Framework preset: **Vite** (Vercel usually detects this automatically).
4. Build command: `npm run build` — Output directory: `dist` (Vercel's Vite preset fills these in automatically).
5. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = `https://ttsptqmozwtahribqdvi.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (the anon key from `.env.example`)
   (Optional — the app works with its built-in defaults even if you skip this step.)
6. Click **Deploy**.

The same steps apply to Netlify (build command `npm run build`, publish directory `dist`, same two env vars) or any other static host — the app is a plain static bundle after `npm run build`.

## About the GitHub repo

This environment has no GitHub credentials, so the repository is being handed over as a local git repository (already `git init` + committed) plus a zip of the folder. To publish it yourself: create an empty repository on github.com, then from this folder run:

```bash
git remote add origin <your-repo-url>
git push -u origin main
```

## Backend

All data lives in Supabase Postgres under the **`siteops`** schema (a separate, unrelated `public` schema hosts a different live app and is never touched here). Row-level security enforces who can read/write what — the client just calls the API normally via `supabase.schema('siteops')`. Authentication is real Supabase Auth (email + password); there is no PIN or magic-link flow. Account creation (including the very first Owner account) goes through a deployed edge function, `siteops-manage-team`, since client code can't create `auth.users` rows directly.

See `src/supabase.js` and `src/data.js` for the full data-access layer, and `src/auth.js` for auth + team-management calls.

## Project structure

```
src/
  main.js            entry point: boots auth, shell, router, realtime
  supabase.js         Supabase client + siteops schema handle + edge fn caller
  auth.js              sign in/out, profile lookup, team management calls
  state.js              in-memory app state
  router.js             hash-based routing
  data.js                 all Postgres/Storage queries
  payroll.js               weekly / company-wide payroll math
  utils.js                  formatting, toasts, modal helpers, repeaters
  icons.js                    inline SVG icon set
  logo.js                      embedded JR.TAP logo (base64 PNG)
  styles.css                    full design system (light/dark theme tokens)
  render/
    shell.js       sidebar, topbar, nav
    auth.js          login screen + first-run Owner setup
    dashboard.js       role-branched dashboard
    projects.js          project list + create/edit modal
    projectDetail.js       project detail: 5 tabs (Overview / Daily Activities / Materials / Expenses / Manpower & Payroll)
    materials.js              material requests (submit + approve/reject)
    pettycash.js                 petty cash requests (submit + approve/reject)
    logs.js                        daily site logs (activities, materials used, photos)
    team.js                          team management (owner/admin)
```

## What's implemented

Everything listed in the project brief: login + first-run Owner setup, role-branched dashboard, projects (create/edit/status, owner/admin only), project detail with all 5 tabs, material requests and petty cash requests (submit + approve/reject), daily logs (activities, site conditions, materials-used line items, photo upload to private Storage with signed URLs), per-project worker roster, attendance marking, cash advances ("bale"), direct materials in/out log, direct expenses log, weekly + company-wide payroll, team management (invite/deactivate/reactivate/reset password/delete via the edge function), sign out, and a lightweight Supabase Realtime subscription that refreshes the current page when relevant tables change.

### Known simplifications

- The first-run "no team yet" state can't be reliably detected before signing in (RLS means an anonymous read of `team_members` always comes back empty, whether or not a team already exists) — so the login screen always defaults to the normal sign-in form, with a "Set up the Owner account" link available at all times. The edge function itself is the real authority and will refuse a bootstrap create once any team member exists.
- Realtime refresh re-fetches and re-renders the current page on relevant table changes (debounced) rather than doing fine-grained in-place DOM patches — simple and correct, but a full re-render rather than a diffed update.
- No automated test suite — this was verified with a production build (`npm run build`) and manual code review, not against a live Supabase project inside this environment.
