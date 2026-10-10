# Research Findings

Notes recorded while building the PlayState Research Milestone. Items marked "not yet verified" depend on deployment steps that were still pending when the note was written.

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
- There is no session-length data. Time-to-beat is about finishing a game, not one sitting, so time matching is a rough genre-based hint.
- Search results include editions, add-on packs, and unrelated older games with the same name, so the first result is not always the one a user expects.
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

## Render

Deployment experience: not yet verified. A `render.yaml` blueprint defines the service. Expected points to confirm: installing dev dependencies during the build (`--include=dev`) so TypeScript and Prisma are available, running migrations in the build step, and cold starts on the free plan.

## Vercel

Deployment experience: not yet verified. Expected points to confirm: setting the Root Directory to `apps/web` in an npm workspace, and adding the Clerk and API URL variables before the first build.
