# Study Log — Aidan & Wyel

A study-time tracker. Aidan logs with a stopwatch; Wyel's hours are pulled
automatically from his Google Sheet. The Compare tab puts the two side by side
on total daily work.

## How it fits together

| Piece | What it does |
|---|---|
| `index.html` | The whole app. No build step. |
| `config.js` | The only file you edit — Supabase credentials and Aidan's subject list. |
| `data/wyel.json` | Wyel's hours, rewritten hourly by the sync workflow. |
| `scripts/sync-wyel.mjs` | Fetches his published CSV and aggregates it by day. |
| `.github/workflows/sync.yml` | Runs the sync hourly and commits the result. |

Aidan's sessions live in Supabase (`public.sessions`), so they sync across
devices and survive any redeploy. Wyel's come from his sheet and are read-only
here — the sheet stays his source of truth.

## Setup

1. **Supabase** — create the table:

   ```sql
   create table if not exists public.sessions (
     id         uuid primary key default gen_random_uuid(),
     person     text not null,
     day        date not null,
     subject    text not null default '',
     minutes    integer not null check (minutes > 0),
     note       text default '',
     created_at timestamptz default now()
   );

   alter table public.sessions enable row level security;

   drop policy if exists "read"   on public.sessions;
   drop policy if exists "insert" on public.sessions;
   drop policy if exists "delete" on public.sessions;

   create policy "read"   on public.sessions for select to anon using (true);
   create policy "insert" on public.sessions for insert to anon with check (true);
   create policy "delete" on public.sessions for delete to anon using (true);

   do $$
   begin
     if not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
     ) then
       alter publication supabase_realtime add table public.sessions;
     end if;
   end $$;
   ```

2. **`config.js`** — paste the Supabase project URL and the **anon / public** key.
   Never the `service_role` key: it bypasses row-level security.

3. **Wyel's CSV** — in his sheet: File → Share → Publish to web → `Daily_Tracker` → CSV.
   Then in this repo: Settings → Secrets and variables → Actions → **Variables** →
   new variable named `WYEL_CSV_URL` with that link. A *variable*, not a secret —
   the URL is already public, and the workflow log is easier to debug this way.

4. **GitHub Pages** — Settings → Pages → Deploy from a branch → `main` / `root`.

The site works before step 3; Wyel's panel just stays empty until the URL exists.

## Running the sync by hand

Actions tab → **Sync Wyel** → *Run workflow*. The log says how many sessions it
read and how many rows it skipped — worth a look after the first run to confirm
the columns were recognised.

## A note on privacy

The site is public to anyone with the URL, and the anon key sits in the page
source by design. The policies above let any visitor read, insert and delete
sessions. That is fine for study hours between two people and deliberately not
fine for anything sensitive.
