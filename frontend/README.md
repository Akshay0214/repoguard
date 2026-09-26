# RepoGuard — Frontend MVP

AI-Assisted Repository-Level Code Quality & Technical Debt Analysis.
This is the **frontend-only** MVP: a fully navigable React app running on a
centralized mock-data layer, structured so a real backend/AI pipeline can be
wired in later with minimal changes.

## Getting started

```bash
npm install
npm run dev       # start the dev server (http://localhost:5173)
npm run build     # type-check + production build to dist/
npm run preview   # preview the production build locally
```

Requires Node 18+.

## Tech stack

- React 19 + Vite + TypeScript
- Tailwind CSS v4
- React Router v7
- Lucide React (icons)
- Recharts (health trend, debt trend, category bar, severity donut)
- `@xyflow/react` (interactive dependency graph)

## Routes

| Route | Page |
|---|---|
| `/` | Landing page |
| `/dashboard` | Repository health overview |
| `/analyze` | Trigger a new analysis (GitHub URL or ZIP upload) |
| `/issues` | Code quality issue list, searchable & filterable |
| `/issues/:id` | Issue detail with AI explanation & recommendation |
| `/technical-debt` | Debt summary, hotspots, priority list |
| `/dependencies` | Interactive module/file dependency graph |
| `/history` | Past analysis runs and trend charts |
| `/settings` | Repository, analysis, AI, and appearance preferences |

## Architecture

```
src/
  types/              Shared domain types (Issue, RepositoryOverview, etc.)
  data/mock/           Centralized mock data — one file per domain concept
  services/
    repositoryService.ts   The API integration boundary. Every page calls
                            through here (analyzeRepository, getIssues, ...).
                            Swap the function bodies for real fetch() calls
                            when the backend is ready — no page changes needed.
  components/
    ui/                Generic primitives: Card, Button, Badge, ScoreRing, ...
    layout/             Sidebar, Topbar, AppLayout (route shell), PageHeader
    charts/             Recharts wrappers themed to the design system
    dependencies/       Dependency graph node renderer + layout algorithm
  pages/                One component per route
```

### Where a real backend plugs in

`src/services/repositoryService.ts` is the only file that should need to
change to connect real data:

- `analyzeRepository()` → POST to a job endpoint, subscribe to progress via
  SSE/WebSocket instead of the simulated step timer
- `getRepositoryOverview()`, `getIssues()`, `getTechnicalDebt()`,
  `getDependencies()`, `getAnalysisHistory()` → GET requests against the
  corresponding REST/GraphQL endpoints
- `getSettings()` / `updateSettings()` → GET/PUT against a settings endpoint

Every page already renders loading, empty, and error states around these
calls, so switching from mock promises to real network requests requires no
UI changes.

## Notes for Review 2

This build intentionally does **not** implement GitHub integration,
repository cloning, AST/static analysis, dependency parsing, Git history
analysis, a database, real authentication, or LLM calls — per the frontend
MVP scope. All data is centralized in `src/data/mock/` and served through
`repositoryService.ts` so the next phase (real analysis engine) is a
backend/service-layer task, not a frontend rewrite.
