# CafLife

A caffeine journal with interactive estimates, a drink planner, history summaries,
saved drinks, and optional Google sign-in with Supabase synchronization.

Built with Next.js, React, TypeScript, Tailwind CSS, Recharts, and Supabase.

## Run locally

Install Node.js 24 LTS, then open this folder in VS Code and run:

```sh
npm ci
npm run dev
```

Open http://localhost:3100. Choose **Try sample** to try the app without
setting up an account or database. Sample changes last only for that preview;
they are not saved across reloads.

## Enable accounts and saved data

1. Create or use your Supabase project.
2. Apply `supabase/migrations/001_caffeine.sql` to a new database using the
   Supabase SQL editor or your migration workflow. If it is already applied,
   do not rerun it as a new migration.
3. Enable Google under Supabase Authentication providers and configure its
   Google OAuth credentials. Use the callback URL shown by Supabase in Google.
4. Add `http://localhost:3100/` to Supabase Authentication's allowed redirect URLs.
5. Copy `.env.example` to `.env.local` and fill in your Supabase project URL and
   **publishable key** (the legacy **anon** key also works). Restart the app.

These two values are sent to the browser. Never enter a Supabase secret or
service-role key here. Database row-level security enforces account isolation.
`.env.local` is ignored by Git.

Signed-in data is cached in IndexedDB and synchronized with Supabase. The service
worker supports cached offline use in production on HTTPS; it is disabled during
local development. Offline use requires an initial online visit.

## Check and build

```sh
npm run check   # Lint, TypeScript, and automated tests
npm run build   # Production build
npm start      # Serve the production build locally
```

Tests cover caffeine calculations, timezone behavior, browser storage, backups,
and database permissions and synchronization using an in-memory PostgreSQL engine.
They do not require live Supabase credentials.

## GitHub and Vercel

Commit the source files and `package-lock.json`. The `.gitignore` excludes installed
packages, generated output, local environment files, and deployment state.

Import the GitHub repository into Vercel and select the Next.js framework preset.
Use Node.js 24 and the default build/output settings. To enable accounts, set
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in Vercel's environment settings,
redeploy, and add the site's final HTTPS URL to Supabase's allowed redirect URLs.
Set the Supabase Site URL to your production URL. Only allow preview URLs you trust
if you also want Google sign-in on preview deployments.

Code deployments do not apply database migrations. Manage database changes
separately from website builds.

## Project map

- `app/`: page, layout, global styles, and public configuration endpoint.
- `components/`: tracker, chart, forms, and the six UI components the app uses.
- `hooks/use-tracker.ts`: authentication, local changes, and synchronization.
- `lib/`: caffeine model, storage, validation, and styling helper.
- `public/`: app icons, install manifest, and service worker.
- `supabase/migrations/`: database schema, access policies, and functions.
- `tests/`: automated regression tests.

Caffeine levels are estimates, not medical measurements.
