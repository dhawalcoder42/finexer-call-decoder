# Finexer Call Decoder

Internal team tool: turns Otter.ai client call transcripts (.txt) into writer-ready
insights using the free Gemini API. Email login, roles (admin / writer / viewer),
and a shared library stored in Netlify Blobs, so the whole team sees the same calls.

## Roles

- admin: everything, plus the Team panel (add users, set passwords, change roles)
- writer: upload, decode, retry, delete own uploads
- viewer: read only

The ADMIN_EMAIL account is always admin. On first login it uses ADMIN_PASSWORD
from the environment, then the password is stored as a secure hash.

## Setup

1. Node.js 18+ (check with `node -v`)
2. Free Gemini key: https://aistudio.google.com/apikey
3. Copy `.env.example` to `.env` and fill all four values
   (generate SESSION_SECRET with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
4. `npm install`
5. Optional: drop your logo at `public/logo.png`

## Run locally

npx netlify dev

Open http://localhost:8888 and sign in with ADMIN_EMAIL + ADMIN_PASSWORD.

## Deploy (GitHub + Netlify)

1. Push this folder to a private GitHub repo
2. app.netlify.com -> Add new site -> Import an existing project -> GitHub -> pick the repo
3. Build settings are read from netlify.toml automatically
4. Before deploying, add these environment variables in Netlify
   (Site configuration -> Environment variables):
   GEMINI_API_KEY, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
5. Deploy. Open the live URL, sign in as admin, then add your team in the Team panel.

## Notes

- Database: Netlify Blobs (built into Netlify, free tier, no external database account).
- Free Gemini tier is rate limited; the queue waits ~6.5s between calls and retries on 429s.
- Model can be changed with a GEMINI_MODEL env var (default gemini-flash-latest).
