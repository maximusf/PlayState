# Research Findings

Notes recorded while building the PlayState Research Milestone.

## Summary for the team

| Technology | Verdict | Main thing to know |
|---|---|---|
| Next.js | Use | Version 16 renamed Middleware to Proxy, and most tutorials are out of date |
| Express | Use | Route, Controller, Service kept the API small and easy to test |
| Clerk | Use | Works well, but the SDK changes quickly, so pin versions |
| Prisma + Supabase | Use | Prisma 7 setup differs from most guides, and Supabase needs two connection strings |
| IGDB | Use for metadata | No session-length data, and search results need filtering |
| Zod | Use | One schema per endpoint validates and types the input |
| npm workspaces | Use | One lockfile for both apps, with hosts building from the repository root |
| Render | Use for demos | The free plan sleeps when idle |
| Vercel | Use | The simplest part of the deployment |

## Next.js

### What Worked Well

- The App Router made the page structure obvious: one folder per route, and a route group `(app)` that puts every signed-in page under one layout.
- Server Components are useful for small auth decisions. The header and landing page read the session on the server and render the right links with no client code.
- `next/font` self-hosts Google fonts at build time, so two typefaces were added without a new dependency or a runtime request.
- Tailwind CSS 4 keeps design tokens in CSS (`@theme`), which made a small, consistent palette easy to enforce.

### Difficulties

- Next.js 16 renamed Middleware to Proxy (`proxy.ts`). Most tutorials still say `middleware.ts`. The framework ships its own docs in `node_modules/next/dist/docs`, which were more reliable than search results.
- `LayoutProps` and other route types are generated during `next build` or `next dev`, so running `tsc` alone on a fresh checkout reports a missing type.
- Deciding what should be a Server Component versus a Client Component takes practice. Pages that fetch from the separate API with a session token ended up as Client Components.

### Would We Use It for the Capstone?

Yes. Routing, layouts, and deployment are well suited to a product like this. The team should agree early on a data fetching pattern.

## Node.js / Express

### What Worked Well

- Route, Controller, Service is enough structure for this size of API. Each file has one job and is short.
- Express 5 forwards errors from async handlers automatically, so controllers have no try/catch blocks and no wrapper helper.
- One error middleware made response shapes consistent with very little code.
- Supertest runs the real app in memory, so status codes, validation, and ownership rules are tested without a network or database.

### Difficulties

- Middleware order matters. The health route sits before Clerk so it works even if auth is misconfigured, and CORS must run before everything.
- CommonJS and ES module settings interact with TypeScript and Prisma's generated client. The Prisma generator had to be told to emit CommonJS.

### API Design Lessons

- Derive identity from the verified session only. The API never reads a user ID from the body or URL.
- Enforce ownership inside the query (`where: { id, userId }`), not with a separate check. Another user's record simply does not match, and the response is 404.
- Let the database enforce uniqueness. The unique constraint on `(userId, gameId)` is the duplicate check, and its error maps to 409.
- Separate upstream failure (502) from PlayState failure (500) so clients and logs can tell them apart.
- Never forward raw upstream or database errors. Log them on the server and return a stable code and message.
- Keep pure logic separate from data access. The scoring function takes a library and preferences and returns a list, which made it simple to test.

### Would We Use It for the Capstone?

Yes. A separate Express API is more setup than Next.js route handlers, but it gave direct practice with REST design and keeps the backend independent of the frontend host.

## Clerk

### What Worked Well

- Prebuilt sign-in, sign-up, and account components removed almost all auth UI work.
- `@clerk/express` verifies the session token and exposes the user ID with `getAuth(req)`.
- Cross-origin calls are simple: the frontend asks Clerk for a token and sends it as a Bearer header.

### Difficulties

- The SDK is moving quickly. `createRouteMatcher` is deprecated in the installed version in favor of checks inside pages and layouts, and several control components have been renamed.
- `requireAuth()` in the Express SDK redirects to a sign-in page, which is wrong for a JSON API. The correct approach is `clerkMiddleware()` plus `getAuth()` and an explicit 401.
- Nothing renders without valid keys, including public pages, so the UI cannot be previewed before Clerk is configured.
- The API needs both the publishable key and the secret key.
- A production Clerk instance needs a domain you own, so a `vercel.app` deployment stays on development keys.
- Verified: sign-up, sign-in, redirecting signed-out visitors, and Bearer token verification in the API all work locally with development keys.

### Would We Use It for the Capstone?

Yes, with versions pinned and the upgrade guides read before any major version bump.

## Prisma + Supabase PostgreSQL

### What Worked Well

- The schema file is a readable description of the data model, and the generated client gives typed queries.
- Composite unique constraints and cascading deletes are one line each.
- String arrays in PostgreSQL store genres, themes, and modes without extra tables.

### Difficulties

- Prisma 7 changed setup compared with most guides: the connection URL moved to `prisma.config.ts`, a driver adapter (`@prisma/adapter-pg`) is required, and the client is generated into the source tree.
- npm's `latest` tag pointed at a Prisma 8 release candidate, so the version was pinned to 7.
- Supabase needs two connection strings: a pooled one for the running API and a direct or session one for migrations.
- `prisma migrate dev` needs a second, empty "shadow" database, which a single Supabase project does not provide. The second migration was written with `prisma migrate diff` against the live database and applied with `prisma migrate deploy`.
- Supabase exposes the `public` schema through its own Data API. Tables created by Prisma have row level security disabled by default, so the migration enables it explicitly.
- The connection strings Supabase shows contain a `[YOUR-PASSWORD]` placeholder. Replacing only the words and leaving the square brackets produces a valid-looking URL that fails to authenticate.
- The first request after the API starts is slow while the connection pool opens. Later requests are fast.
- Verified: the migration applied cleanly to a new Supabase project through the session connection, and the running API reads and writes through the pooled connection.

### Would We Use It for the Capstone?

Yes. The typed client and migrations are worth the setup. Budget time for connection configuration.

## IGDB

### What Worked Well

- One request can expand related data (`genres.name`, `cover.image_id`), so search results need no follow-up calls.
- Genres, themes, and game modes are consistent enough to drive a simple scoring system.
- Twitch client-credentials tokens last for weeks, so an in-memory cache with one retry on 401 is enough.

### Difficulties

- The query language (Apicalypse) is sent as plain text in a POST body, so user input must be escaped by hand.
- Cover art arrives as an image ID that has to be turned into a URL.
- Fields are omitted when empty, so every field must be treated as optional during normalization.
- There is no session-length data. A separate endpoint (`game_time_to_beats`) gives the hours needed to finish a game, which is not the same as one sitting. PlayState treats genre and time to beat as fallback guesses and lets the player's own tag and past picks override them.
- Raw search results include DLC, season packs, bundles, and special editions. Filtering on `game_type` and `version_parent` removes them. The older `category` field is deprecated and matched nothing.
- Unrelated games with the same name still appear, so the first result is not always the one a user expects.
- Registering a Twitch application requires an OAuth redirect URL even though the client-credentials flow never uses one. `http://localhost` is enough.
- Verified: live search, game details, and cover art work with real credentials.

### Would We Use It Again?

Yes for metadata. Anything about how a game feels to play will need PlayState's own data.

## Zod

### What Worked Well

- One schema per endpoint validates and types the input at the same time.
- Coercion handles route parameters that arrive as strings.
- A thrown `ZodError` is caught by the error middleware, so controllers validate in one line.

### Difficulties

- Zod 4 changed how custom messages are passed (`error` instead of `required_error` and `invalid_type_error`).
- Default messages are too technical for users, so each rule needs its own message.

### Was It Worth Adding?

Yes. It replaced hand-written checks at every boundary and kept bad input out of the services. It was used only at request boundaries.

## npm workspaces

### What Worked Well

- One `npm install` at the repository root installs both apps, and one `package-lock.json` keeps their versions consistent.
- `npm run <script> -w apps/api` runs a script in one app, and `--workspaces --if-present` runs it in every app that defines it.
- Root scripts (`dev:web`, `dev:api`, `build`, `lint`, `test`) give the team one place to look for commands.

### Difficulties

- Converting two separately created apps meant deleting each app's own lockfile and reinstalling from the root.
- Hosts must be told where each app lives: Vercel uses a Root Directory setting, and Render builds from the root with `-w apps/api`.
- npm's `latest` tag can point at a release candidate, which is how Prisma 8 nearly got installed. Check the version before accepting a default.
- Production installs skip dev dependencies, so the Render build needs `--include=dev` for TypeScript and Prisma.

### Would We Use It for the Capstone?

Yes. It needs no extra tool, and it is enough for two apps.

## Render

### What Worked Well

- A `render.yaml` blueprint in the repository defined the service, build command, start command, and health check, so the dashboard only asked for the secret values.
- The first deploy succeeded without changes. The build installs dev dependencies (`--include=dev`) so TypeScript and Prisma are available, then runs `prisma migrate deploy`.
- Every push to `main` redeploys the API automatically.

### Difficulties

- The dashboard takes values literally. Quotes copied from a `.env` file become part of the value and break the database URL.
- The free plan sleeps after about 15 minutes without traffic, and the next request takes up to a minute.
- Free workspaces are aimed at one person. Team access to logs and settings appears to need a paid plan.

### Would We Use It for the Capstone?

Yes for development and demos. Cold starts would need a paid plan or a different host before real users.

## Vercel

### What Worked Well

- Importing the repository with the Root Directory set to `apps/web` worked with the default Next.js settings, even inside an npm workspace. The build took under a minute.
- Every push to `main` redeploys the site automatically.

### Difficulties

- The project name was taken, so the URL became `playstate-nu.vercel.app`. The API's CORS allowlist (`FRONTEND_URL`) had to be updated to the real address.
- `NEXT_PUBLIC_*` values are fixed at build time, so the API had to be deployed first to know its URL.
- Vercel offers a Clerk integration during setup. It was skipped because the site and the API must share one Clerk application, and the keys were already set by hand.

### Would We Use It for the Capstone?

Yes. It was the simplest part of the deployment.
