# VAFA Talent ID

A lightweight talent identification dashboard for the **VAFA Women's competition**,
built for the OBGFC Women's coaching team.

> ⚠️ This is the **Talent Identification** app.
> It is **not** the match-day Match Tracker (that's a separate project).

## What it does
- Pulls fixtures and player stats from **PlayHQ** (VAFA / AFL tenant)
- Computes a single weighted **Talent Score** per player
- Surfaces:
  - **Dashboard** — summary tiles, top 5 prospects, recent fixtures
  - **Leaderboards** — sort by any stat, filter by position / min games
  - **Players** — search, profile pages with per-game sparkline
  - **Opposition Scout** — top danger players + recent form by club
  - **Watchlist** — star players you want to follow (saved locally)

## Tech
**Plain HTML + vanilla JS + CSS.** No build step. No modules. No JSX. No React.
This avoids the "Cannot use import statement outside a module" / JSX parse errors
that broke previous builds on GitHub Pages.

## Local run
```
python -m http.server 8080
```
then open `http://localhost:8080`.

## Deploy to GitHub Pages
1. Push to `patmalone-png/vafa-talent-tracker`.
2. **Settings → Pages → Deploy from branch → `main` / root**.
3. Visit `https://patmalone-png.github.io/vafa-talent-tracker/`.

## Refreshing PlayHQ data
- Auto: every Sunday 19:00 UTC via `.github/workflows/fetch.yml`.
- Manual: **Actions → fetch-playhq → Run workflow**.
- The API key is baked into `scripts/fetch_playhq.py` per request.
- For local one-off: `python scripts/fetch_playhq.py`.

## Files
```
index.html                     App shell
app.js                         All logic (vanilla JS)
styles.css                     Theme
data/games.json                Fixtures cache
data/players.json              Aggregated player stats
scripts/fetch_playhq.py        PlayHQ → JSON
scripts/diagnose.py            Tenant/endpoint probe
.github/workflows/fetch.yml    Weekly + manual refresh
```
