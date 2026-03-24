# Workspace

## Overview

pnpm workspace monorepo using TypeScript. This is **Nutterx Hosting** — a Heroku-style web platform for deploying any GitHub repository as a Node.js child process.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: MongoDB Atlas (Mongoose), URI in `MONGODB_URI` env var
- **Auth**: JWT (access token 15m, refresh token 7d). Secrets: `JWT_SECRET`, `JWT_REFRESH_SECRET`
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle for api-server)

## Structure

```text
workspace/
├── artifacts/
│   ├── api-server/         # Express 5 API (auth, apps, process management)
│   ├── nutterx-hosting/    # React + Vite frontend (deployed at /)
│   └── mockup-sandbox/     # Component preview server (design tool)
├── lib/
│   ├── api-spec/           # OpenAPI spec (openapi.yaml) + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks (import from "@workspace/api-client-react")
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── mongo/              # Mongoose connection + User, App, Log models
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only emit `.d.ts` files during typecheck; bundling done by esbuild/vite
- **Project references** — list dependencies in `tsconfig.json` `references` array

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Auth routes + apps routes + process manager.

- Entry: `src/index.ts` — reads `PORT` (default 8080), starts Express
- App setup: `src/app.ts` — CORS, JSON, routes at `/api`
- **Key routes**: `GET /api/apps/repo-meta?repoUrl&branch&pat` — fetches `package.json` from GitHub and returns detected start/install command and port. `GET /api/apps/env-template?repoUrl&branch&pat` — fetches `.env.example`, tries specified branch first then main/master fallbacks.
- Routes: `src/routes/auth.ts` (signup/login/refresh/logout/me), `src/routes/apps.ts` (full CRUD, start/stop/restart, SSE log stream, env vars, env template)
- Services: `src/services/processManager.ts` — git clone → install → spawn, auto-restart (5x, exponential backoff), log to MongoDB capped collection
- Middleware: `src/middlewares/auth.ts` — JWT Bearer token verification
- Depends on: `@workspace/mongo`, `@workspace/api-zod`, `mongoose` (direct dep)
- `pnpm --filter @workspace/api-server run dev` — build + start
- `pnpm --filter @workspace/api-server run build` — esbuild ESM bundle → `dist/index.mjs`

### `artifacts/nutterx-hosting` (`@workspace/nutterx-hosting`)

React + Vite frontend. Dark terminal-themed UI.

- Pages: login, dashboard (list apps), new-app (create + env template), app-detail (logs, start/stop/restart, env vars)
- Auth: JWT stored in localStorage (`access_token`, `refresh_token`); `setAuthTokenGetter` wires tokens into generated fetch client
- Hooks: `use-auth.tsx` (auth context), `use-log-stream.tsx` (SSE log streaming via `@microsoft/fetch-event-source`)
- Import API hooks from `@workspace/api-client-react` (barrel export, NOT deep path imports)
- Port: reads `PORT` env var (25013 in dev)

### `lib/mongo` (`@workspace/mongo`)

Mongoose connection + models.

- `src/index.ts` — `connectMongo()`, exports `User`, `App`, `Log` models
- `User` model: email, password (bcrypt), refreshTokens[]
- `App` model: name, slug, repoUrl, branch, status enum (idle/installing/running/stopped/crashed/error), envVars, startCommand, installCommand, port, autoRestart, errorMessage
- `Log` model: capped collection (10MB), appId, line, stream (stdout/stderr), timestamp

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and Orval config. Running codegen produces:
1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from OpenAPI spec. Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks. Import ONLY from `@workspace/api-client-react` (not deep paths like `/src/generated/api`).

Exports: all hooks, schemas, `setBaseUrl`, `setAuthTokenGetter`.

### `lib/db` (`@workspace/db`)

NOT USED. Drizzle ORM was removed from this project; MongoDB via `@workspace/mongo` is used instead.

### `scripts` (`@workspace/scripts`)

Utility scripts. Run via `pnpm --filter @workspace/scripts run <script>`.

## Environment Variables

- `MONGODB_URI` — MongoDB Atlas connection string
- `JWT_SECRET` — JWT access token secret
- `JWT_REFRESH_SECRET` — JWT refresh token secret
- `PORT` — assigned per artifact by Replit

## Deployment Notes

- Apps are deployed as Node.js child processes (no Docker/containers)
- Each app is cloned to `~/.nutterx-apps/<slug>/`
- Auto-detects npm/yarn/pnpm package manager
- Supports up to 5 auto-restarts with exponential backoff
- Logs streamed via SSE using MongoDB change streams on capped `logs` collection
