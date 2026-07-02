# Contributing to Prepline

Thanks for helping make Prepline better. This project is small but opinionated; following the conventions below keeps the scheduler, API, and UI consistent.

## Setup

### Backend

```bash
cd backend
uv sync --all-groups
uv run pytest -q
```

### Frontend

```bash
cd frontend
npm install
npm run test
npm run build
```

## Running the full app locally

```bash
# Terminal 1 — API on :8000
cd backend
uv run uvicorn app.main:app --reload --port 8000

# Terminal 2 — Vite dev server with /api proxy
cd frontend
npm run dev
```

Or run single-origin with the built frontend:

```bash
cd frontend && npm run build
cd ../backend && uv run uvicorn app.main:app --port 8000
```

## Code style

- **Python**: format with `black`, imports with `isort`, lint with `ruff`. Line length is 100.
- **TypeScript / TSX**: format with `prettier` (`npm run format` in `frontend/`).

Before committing, run:

```bash
cd backend
uv run ruff check app tests
uv run black --check app tests
uv run isort --check app tests
uv run pytest -q

cd ../frontend
npm run format
npm run test
npm run build
```

## Architecture conventions

- Keep `backend/app/scheduler/` pure — no FastAPI or database imports. It must remain unit-testable in isolation.
- All backend times are naive UTC; serialize as ISO-8601 with a trailing `Z`.
- Dish colors are assigned by plan order in `frontend/src/theme.ts`. Do not re-sort or re-assign hues when filtering.
- API keys, personal paths, and environment-specific values must not be hard-coded. Author metadata lives only in `pyproject.toml` and `package.json`.

## Tests

- Backend tests live in `backend/tests/` and run with `pytest`.
- Frontend utilities and lane math are covered by `vitest` (e.g., `frontend/src/lib/lanes.test.ts`).

## Commit messages

Use conventional commits where practical:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `test:` test additions or fixes
- `refactor:` code change that neither fixes a bug nor adds a feature
- `chore:` tooling, dependencies, formatting

## License

By contributing, you agree that your contributions will be licensed under the same license as the project: [AGPL-3.0-only](LICENSE).
