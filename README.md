# Finexer Call Decoder

Internal team tool: turns Otter.ai client call transcripts (.txt) into writer-ready
insights using the free Gemini API. Email login, roles (admin / writer / viewer),
and a shared library stored in Supabase (Postgres), so the whole team sees the
same calls. Also builds a saved Sales Call FAQ (with pain points and Finexer
answers) and a Competitor Switchers report.

## Roles

- admin: everything, plus the Team panel (add users, set passwords, change roles)
- writer: upload, decode, retry, delete own uploads, generate FAQ / reports
- viewer: read only (can view and download the saved FAQ / reports)

The ADMIN_EMAIL account is always admin. On first login it uses ADMIN_PASSWORD
from the environment, then the password is stored as a secure hash.

## Setup

1. Node.js 18+ (check with `node -v`)
2. Free Gemini key: https://aistudio.google.com/apikey
3. Free Supabase project: https://supabase.com -> New project
   - Open the SQL Editor in the Supabase dashboard, paste the contents of
     `supabase-setup.sql` from this folder, and run it once. This creates
     the `users`, `calls` and `app_state` tables.
   - Project Settings -> API: copy the Project URL and the `service_role`
     secret key (not the anon key).
4. Copy `.env.example` to `.env` and fill all six values
5. `npm install`
6. Optional: drop your logo at `public/logo.png`

## Run locally

npx netlify dev

Open http://localhost:8888 and sign in with ADMIN_EMAIL + ADMIN_PASSWORD.

## Deploy (GitHub + Netlify)

1. Push this folder to a private GitHub repo
2. app.netlify.com -> Add new site -> Import an existing project -> GitHub -> pick the repo
3. Build settings are read from netlify.toml automatically
4. Before deploying, add these environment variables in Netlify:
   GEMINI_API_KEY, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD,
   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
5. Deploy. Open the live URL, sign in as admin, add your team in the Team panel.

## Notes

- Database: Supabase (free tier Postgres): `users`, `calls`, `app_state`.
- FAQ and Switchers reports are generated on demand (admin/writer only) and
  saved in `app_state`, so viewing them costs no Gemini calls.
- Calls stuck in "processing" for over 10 minutes are requeued automatically.
- Free Gemini tier is rate limited; the queue waits ~6.5s between calls and retries on 429s.
- Model can be changed with a GEMINI_MODEL env var (default gemini-flash-latest).
