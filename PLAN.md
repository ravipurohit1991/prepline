please wrap up and complete it from where it is left

# Prepline — Vision & Implementation Plan

> This document exists so that any contributor (human or AI agent) can pick up the
> project cold, understand every decision already made, and finish or extend it
> without re-deriving context. Keep it updated when the architecture changes.

_Last updated: 2026-07-02 — status: backend complete & tested, frontend complete &
building, end-to-end verification + screenshots + README in progress._

---

## 1. The vision

**Prepline is the expediter for your home kitchen.** The universal problem it
solves: when you cook a real meal (3–6 dishes), getting *everything to finish at
the same time* is a hard scheduling problem people solve badly in their heads —
every dinner party, every holiday roast. Recipe apps treat recipes as isolated
documents; nobody schedules them together.

The core interaction mechanic (the thing that makes this feel like a new
category, not a better recipe manager):

1. **Compile** — multiple recipes are compiled into one performable, multi-track
   timeline (a "score", like a DAW arrangement view) by a real
   resource-constrained scheduler: one pair of hands, N burners, oven slots that
   only share at one temperature, and per-dish "hold windows" (how long a
   finished dish can sit).
2. **Perform** — you cook *the meal*, not the recipes. Cook Mode is a live
   conductor: what's on the fire now, what to fire next, countdowns.
3. **Reflow** — when reality drifts ("potatoes need 10 more minutes"), one tap
   replans the entire remaining evening live over WebSocket. If the target serve
   time becomes impossible, the serve ETA slips and every device sees it.

Kitchen vernacular is used deliberately: "fire a step" (start it), "service"
(cook mode), "the pass"/serve flag, "mise en place" (combined prep panel).

## 2. Repository layout

```
/                     repo root (publish as github.com/ravipurohit1991/prepline)
  PLAN.md             this file
  LICENSE             AGPL-3.0 (full SPDX text)
  .vscode/            black/ruff/isort + prettier formatting settings
  backend/            Python 3.11+ / FastAPI / SQLModel / SQLite
    pyproject.toml    deps + black/isort/ruff/pytest config (uv-compatible)
    app/
      scheduler/      THE CORE IP — pure-Python scheduling engine (no FastAPI imports)
        types.py      PlanStep, Resources, Placement, Schedule, StepProgress…
        engine.py     compute_schedule() backward scheduler + replan() for live sessions
      models.py       Recipe, RecipeStep, MealPlan, CookSession (SQLModel tables)
      schemas.py      Pydantic request/response models
      api/            routers: recipes (CRUD), plans (CRUD + /schedule), sessions (REST + WS)
      services/
        planning.py   DB rows -> scheduler steps; schedule -> JSON payload
        sessions.py   SessionRuntime (event application + replan snapshots) + SessionHub (WS fan-out)
      core/           config (pydantic-settings, PREPLINE_* env), db, timeutil (naive-UTC)
      seed.py         demo content: 6-dish "Sunday Roast for Four"; python -m app.seed [--reset]
      demo.py         python -m app.demo — back-dates a mid-service cook session for screenshots
      main.py         create_app() factory; serves frontend/dist as SPA if present
    tests/            26 passing tests: engine (18) + API/WS/seed (8)
  frontend/           React 18 + TypeScript + Vite + Fluent UI v9
    src/
      theme.ts        Fluent light + dark "service" themes; validated track palettes
      styles.css      global CSS (layout, cards, cook mode, timeline chrome)
      api/            types.ts (mirrors backend payloads), client.ts (fetch wrapper)
      lib/            time.ts helpers; lanes.ts usage-sweep (+ vitest lanes.test.ts)
      hooks/useSession.ts  WebSocket session hook (reconnect, 30s sync, REST fallback)
      components/     AppShell, Timeline.tsx (custom SVG score — the hero), WarningsBar
      pages/          LibraryPage, RecipeEditorPage, PlansPage, PlanNewPage,
                      ScorePage (score view), CookPage (dark service mode)
```

## 3. Scheduling engine (backend/app/scheduler/)

All times are **integer minutes relative to the serve target** (0 = serve,
negative = before). `compute_schedule(steps, resources, *, not_before, fixed)`:

- Validates the DAG (unique ids, known deps, no cycles, duration ≥ 1).
- Orders steps successors-first by unconstrained latest-finish (ties: lowest
  `hold_max` first, so the least-holdable dish wins the latest slot).
- Greedy latest-fit placement against a minute-resolution occupancy ledger:
  active steps consume a "cook" slot; equipment consumes capacity; the oven
  additionally refuses two temperatures at once.
- `fixed` placements (done/running steps) keep their times and claims;
  `not_before` (= "now" mid-cook) lower-bounds new placements. If infeasible,
  serve is pushed later minute-by-minute (`serve_push`) until it fits.
- Warnings: `long_hold` (dish ready too early beyond its hold window),
  `serve_pushed`.

`replan(steps, resources, progress, now)` pins done steps to actual times,
projects running steps to `now + remaining`, and re-schedules the rest.

Session events (REST `POST /api/sessions/{id}/events` and the same JSON over
WS): `start_step`, `complete_step`, `delay_step` (semantic: "needs N more
minutes **from now**"), `reset_step` (undo), `finish`, plus WS-only `sync`.
Every event persists progress JSON to the CookSession row and broadcasts the
new snapshot to all connected sockets (multi-device: laptop + phone).

## 4. Design system (frontend)

- **Aesthetic thesis:** the expo pass, not a lifestyle cooking blog. Porcelain
  `#FAF9F7` surfaces, warm ink `#201B14`, **tape blue `#2B5BB7`** as the single
  interactive accent (blue painter's tape = kitchen labeling = mise en place).
- **Type:** Archivo Variable (expanded width for headings/wordmark), IBM Plex
  Mono for every time/duration/countdown. Self-hosted via @fontsource.
- **The one aesthetic risk:** Cook Mode flips to a dark "service" theme
  (`#16130F` bg) — planning is daylight, service is heat. Both Fluent themes in
  `theme.ts`.
- **Track palette (validated):** assigned to dishes in fixed plan order, never
  cycled. Light `deep/tint`: ember `#B4530F`, teal `#00876B`, gold `#8F6A00`,
  plum `#83519B`, herb `#4E7C2A`, rose `#B23A55`. Dark `service`: `#CE6A2B`,
  `#2AA78F`, `#B08C1C`, `#AC7BC9`, `#6FA53F`, `#D4627F`. Both columns pass the
  dataviz six-checks validator (lightness band, chroma floor, CVD separation,
  contrast) against their surfaces. Don't change hues without re-validating.
- **Timeline.tsx** (custom SVG, no chart lib): time ruler with wall-clock ticks,
  one lane per dish (hatch = unattended, solid = hands-on, ✓ = done, pulsing
  outline = running), tape-blue SERVE flag line, dashed late-orange ETA flag
  when pushed, ink playhead in cook mode, and resource lanes (Hands ×N,
  Burners ×N, Oven with temperature labels) that make the constraints visible.

## 5. Status — what is DONE

- [x] Backend: engine + API + WS + seed + demo, 26/26 tests green
      (`cd backend && uv sync && uv run pytest`), ruff/black/isort clean.
- [x] Frontend: all pages implemented, strict TS build green, vitest 4/4
      (`cd frontend && npm install && npm run test && npm run build`).
- [x] FastAPI serves `frontend/dist` (single-origin deploy) with SPA fallback;
      Vite dev proxy for `/api` (+ WS) during development.
- [x] Live smoke test: seeded plan schedules 23 steps, push 0, no warnings.
- [x] `.vscode/settings.json`, `.gitignore`, `.gitattributes`, LICENSE (AGPL).

## 6. Remaining work — in order

1. **End-to-end verification (in progress).** Server runs on :8000 (serves the
   built frontend). Playwright + Chromium are installed in the session
   scratchpad. Drive the real UI: library → meals → open score → Start cooking
   → Fire / +5 min / Done / Undo; confirm WS broadcast by opening the same
   session in a second page; probe error paths (delay a pending step → 409).
2. **Screenshots with real demo data** → save into `docs/screenshots/`:
   `score.png` (hero: fresh-seeded plan, `python -m app.seed --reset`),
   `cook.png` (mid-service: `python -m app.demo --minutes-to-serve 40`, open
   printed `/cook/<id>` URL), optionally `library.png`. Viewport 1440×900,
   deviceScaleFactor 2.
3. **README.md** (repo root) — must include: one-paragraph pitch (the
   "everything ready at once" problem), hero screenshot + cook-mode screenshot
   (real demo data), feature list, quickstart (backend: `uv sync`,
   `uv run uvicorn app.main:app --reload` auto-seeds; frontend: `npm install`,
   `npm run dev`; or single-origin: build frontend then run backend only),
   "how the scheduler works" section (sell the algorithm), API sketch,
   architecture diagram (mermaid), roadmap (recipe import/parsing, shopping
   lists, multiple cooks assignment view, oven preheat modeling, PWA/mobile),
   license note (AGPL-3.0).
4. **CI** — `.github/workflows/ci.yml`: job 1 backend (uv sync, ruff check,
   pytest), job 2 frontend (npm ci, vitest, tsc+vite build).
5. **CONTRIBUTING.md** (short: setup, test commands, formatting = black/isort/
   ruff + prettier) and `backend/.env.example` (PREPLINE_DATABASE_URL,
   PREPLINE_SEED_ON_EMPTY, PREPLINE_CORS_ORIGINS).
6. **Git init + commit + publish.** Local git config user "Ravi Purushottam"
   <email from pyproject>. Conventional initial commit(s). `gh` CLI is NOT
   available in this environment — after committing, hand the user:
   `git remote add origin https://github.com/ravipurohit1991/prepline.git`
   and `git push -u origin main`.

## 7. Constraints & conventions (do not violate)

- Backend stays Python; frontend stays React/TypeScript.
- **No API keys, no personal names/paths/env leakage in code.** Author metadata
  lives ONLY in `pyproject.toml` / `package.json` (Ravi Purushottam, AGPL-3.0,
  the email already recorded there). Never embed absolute local paths.
- License is AGPL-3.0-only everywhere it is declared.
- Formatting: black + isort + ruff (line length 100) for Python; prettier for
  TS. Run before committing.
- Times: backend stores naive UTC, serializes ISO + `Z`; frontend renders local.
- Categorical hues follow the dish's plan position — never re-sort or re-assign
  colors when filtering (dataviz rule).
- Keep the scheduler pure (no I/O imports) so it stays unit-testable.

## 8. Verification quick-reference

```bash
# backend tests
cd backend && uv sync && uv run pytest -q
# backend lint/format
uv run ruff check app tests && uv run black --check app tests && uv run isort --check app tests
# frontend
cd frontend && npm install && npm run test && npm run build
# full app (serves built frontend + API on :8000, auto-seeds empty DB)
cd backend && uv run uvicorn app.main:app --port 8000
# demo content
uv run python -m app.seed --reset      # fresh 6-recipe dinner plan
uv run python -m app.demo              # mid-service session for cook-mode screenshots
```
