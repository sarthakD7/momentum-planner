# Momentum Planner

Personal day planner: dashboard (Today / Overdue / Tomorrow), timeline time-boxing, inbox, habits with streaks, focus timer. Installable web app (PWA) that syncs between devices through Supabase.

- `index.html` – the app
- `boot.js` – sign-in (email link) and the database connection
- `supa-db.js` – sync layer: offline cache, queued writes, live updates
- `sw.js`, `manifest.webmanifest`, `icons/` – installable / offline support
- `supabase/001_docs.sql` – database setup (tables, row-level security, realtime)

The Supabase publishable key in `boot.js` is meant to be public; each user's data is protected by row-level security.
