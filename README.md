# PlayState

**Find the right game for right now.**

PlayState is a personalized game picker that matches your library to your available time and the kind of experience you want. Build a library from the IGDB catalog, answer three quick questions, and get up to three games worth playing tonight.

## How it works

1. Sign in.
2. Search for games you own and add them to your library.
3. Tell PlayState how much time you have, what sounds good, and how you want to play.
4. Get up to three suggestions from your own library, each with plain reasons such as "Matches Strategy" or "Supports single-player".

Suggestions come from a small, explainable point system. There is no machine learning and no made-up match percentage.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Authentication | Clerk |
| Database | PostgreSQL on Supabase |
| ORM | Prisma |
| Validation | Zod |
| Game metadata | IGDB (Twitch OAuth) |
| Hosting | Vercel (web), Render (API), Supabase (database) |
| Tests | Vitest, Supertest |

## Architecture

```text
Browser
  |
  v
Next.js on Vercel (apps/web)
  |   Clerk session token sent as a Bearer header
  v
Express API on Render (apps/api)
  |-- Clerk: verifies the token and identifies the user
  |-- Zod: validates query, params, and body
  |-- Prisma --> Supabase PostgreSQL
  `-- IGDB service --> Twitch OAuth + IGDB
```

The repository is an npm workspace with two apps:

```text
apps/web   Next.js frontend
apps/api   Express REST API
```

Inside the API, each request follows one path:

```text
Route -> Controller -> Service -> Prisma or IGDB
```

- Routes map URLs to controllers and attach authentication.
- Controllers validate input with Zod, call one service, and send the response.
- Services hold the logic: IGDB access and normalization, library rules, and recommendation scoring.
- One error middleware turns every failure into the same JSON shape.

Three rules hold everywhere:

- The user ID always comes from the verified Clerk session, never from the request body or URL.
- Every library query is scoped to that user ID.
- IGDB and Twitch credentials exist only on the API server. The browser talks to PlayState, and PlayState talks to IGDB.

## Getting started

Requirements: Node.js 20.9 or newer (developed on Node 24) and npm.

You also need:

- a Clerk application (publishable key and secret key),
- a Supabase project (pooled and direct connection strings),
- a Twitch developer application (client ID and client secret) for IGDB.

```bash
git clone https://github.com/maximusf/PlayState.git
cd PlayState
npm install

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Fill in both files (see the next section), then create the database tables:

```bash
npm run db:deploy -w apps/api
```

Run the two apps in separate terminals:

```bash
npm run dev:api   # http://localhost:4000
npm run dev:web   # http://localhost:3000
```

## Environment variables

Real values never belong in Git. Each app reads its own file.

### `apps/web/.env.local`

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key, used by the Next.js server only |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/library` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/library` |
| `NEXT_PUBLIC_API_URL` | Base URL of the API, `http://localhost:4000` locally |

### `apps/api/.env`

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on, `4000` locally |
| `FRONTEND_URL` | Origin allowed by CORS. Comma-separated for more than one |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `DATABASE_URL` | Supabase pooled connection (port 6543), used by the running API |
| `DIRECT_URL` | Supabase session connection (port 5432), used by Prisma migrations |
| `TWITCH_CLIENT_ID` | Twitch application client ID |
| `TWITCH_CLIENT_SECRET` | Twitch application client secret |

Only variables that start with `NEXT_PUBLIC_` reach the browser. No secret uses that prefix.

## Development commands

Run from the repository root.

| Command | What it does |
|---|---|
| `npm run dev:web` | Start the Next.js dev server |
| `npm run dev:api` | Start the Express dev server with reload |
| `npm run build` | Build both apps |
| `npm run lint` | Lint the frontend |
| `npm test` | Run the API test suite |
| `npm run db:migrate -w apps/api` | Create and apply a migration during development |
| `npm run db:deploy -w apps/api` | Apply existing migrations |

## API overview

Base path: `/api`. Successful responses use `{ "data": ... }`. Errors use `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Auth | Description | Statuses |
|---|---|---|---|---|
| GET | `/api/health` | No | Liveness check | 200 |
| GET | `/api/catalog/search?q=` | No | Search IGDB by title (2 to 100 characters) | 200, 400, 502 |
| GET | `/api/catalog/games/:igdbId` | No | Details for one game | 200, 400, 404, 502 |
| GET | `/api/library` | Yes | The signed-in user's games | 200, 401 |
| POST | `/api/library` | Yes | Add a game, body `{ "igdbId": 113112 }` | 201, 400, 401, 404, 409, 502 |
| DELETE | `/api/library/:id` | Yes | Remove a library entry | 204, 401, 404 |
| POST | `/api/recommendations` | Yes | Up to three suggestions | 200, 400, 401 |

Recommendation request:

```json
{
  "availableTime": "ONE_TO_TWO_HOURS",
  "genres": ["Strategy", "Simulation"],
  "gameMode": "SINGLE_PLAYER"
}
```

- `availableTime`: `UNDER_30`, `THIRTY_TO_SIXTY`, `ONE_TO_TWO_HOURS`, `TWO_PLUS_HOURS`, `ANY`
- `genres`: any of `Action`, `Adventure`, `RPG`, `Strategy`, `Simulation`, `Shooter`, `Puzzle`, `Platformer`, `Racing`, `Sports`, `Sandbox`. An empty list means anything.
- `gameMode`: `SINGLE_PLAYER`, `MULTIPLAYER`, `EITHER`

Error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `GAME_NOT_FOUND`, `GAME_ALREADY_ADDED`, `LIBRARY_ITEM_NOT_FOUND`, `EMPTY_LIBRARY`, `IGDB_UNAVAILABLE`, `INTERNAL_ERROR`.

### How suggestions are scored

Only games in the signed-in user's library are considered.

| Signal | Points |
|---|---|
| Game matches a selected type directly | +2 per type |
| Game matches a related genre or theme | +1 per type |
| Game supports the requested mode | +1 |
| Game's genres suit the session length | +1 |

- If types were selected, a game must match at least one.
- If a mode was requested and the game lists its modes without it, the game is left out. Games with no mode data stay in.
- Time only adds a point. IGDB has no session-length data, so it never removes a game.
- Games are sorted by points, ties are shuffled, and the top three are returned.

## Deployment

| Part | Host | Notes |
|---|---|---|
| `apps/web` | Vercel | Set the project Root Directory to `apps/web` and add the web variables |
| `apps/api` | Render | `render.yaml` defines the web service, build, start, and health check |
| Database | Supabase | Migrations run during the Render build with `prisma migrate deploy` |

After both are live, set `NEXT_PUBLIC_API_URL` on Vercel to the Render URL, and `FRONTEND_URL` on Render to the Vercel URL. CORS only accepts origins listed in `FRONTEND_URL`.

## Project documents

- [DESIGN.md](DESIGN.md): visual identity, layout, components, and states.
- [RESEARCH.md](RESEARCH.md): notes on each technology used.

## About this build

This version of PlayState was built as an individual Research Milestone project to evaluate the stack above for a later capstone. It is intentionally small: one library, one picker, and a scoring method that can be explained in a paragraph.

## License

[MIT](LICENSE)
