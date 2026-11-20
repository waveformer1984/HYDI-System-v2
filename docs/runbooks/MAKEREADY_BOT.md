# MakeReady Bot — Frank + public intake ($0, local)

Config-driven builder widget + owner email intake for post-construction / make-ready cleaning companies. Public traffic is gated by `proxy.ts` / `lib/security/ingressGate.js`.

## Demo (product offer page)

- **URL (heidi-web):** `http://127.0.0.1:3000/makeready-bot` (tailnet/ngrok only if allowlisted)
- Fictional customer config: `config/makeready/demo-makeready-co.json`
- Platform SaaS pricing file: `config/makeready/platform-offer.json` (`setup_cents`, `monthly_cents` — null shows “Contact for pricing”)

## Onboard customer #2..N

From repo root on Frank (or any machine with Node):

```bash
node scripts/makeready-onboard.js your-company-slug
```

Prompts: company name, service-area ZIPs (stored as shown), phases (`phase_id per_sqft` lines), story multipliers, minimum charge, add-ons, owner email, lead time, insurance statement. Writes `config/makeready/<slug>.json` and prints an embed `<script>` snippet.

- Slug must match `^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`
- Phase/add-on rates must be **> 0**
- Refuses to overwrite an existing slug unless `--force`

After onboarding, commit the new JSON (or deploy it with your normal Frank pull/build path).

## Where data lands

| Flow | Table | API |
|------|--------|-----|
| Builder lot submit (widget) | `public.makeready_requests` | `POST /api/makeready-bot/submit` |
| “Book a 10-min demo” (offer page) | `public.makeready_leads` | `POST /api/makeready-bot/lead` |

Both tables are **service_role only** (RLS). The Next API uses `SUPABASE_SERVICE_ROLE_KEY` server-side.

## Apply migrations on Frank (manual)

**Merges and auto-deploy do not apply SQL.** Use local Supabase Postgres on **127.0.0.1:54322** (repo default `PG_*` / `PGPORT`).

PowerShell (Frank, repo root):

```powershell
cd C:\Users\Owner\HYDI-System-v2
$env:PGHOST = "127.0.0.1"
$env:PGPORT = "54322"
$env:PGUSER = "postgres"
$env:PGPASSWORD = "postgres"
$env:PGDATABASE = "postgres"
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261120120000_makeready_bot.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261120180000_makeready_leads.sql
```

Bash equivalent:

```bash
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres \
  psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261120120000_makeready_bot.sql
PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres \
  psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261120180000_makeready_leads.sql
```

Skip a file if that migration is already applied. Widget **submit** needs `makeready_requests`; offer **demo form** needs `makeready_leads`.

## Embed snippet

```html
<script src="https://YOUR_HOST/makeready-bot/widget.js"
  data-slug="your-company-slug"
  data-api="https://YOUR_HOST"></script>
```

Public widget path: `/makeready-bot/widget.js` (not `/public/...`).

## Operational notes

- LLM down: widget stays in **form mode** (`chatReply` fallback).
- Owner email: `SMTP_PASS` (fallback `SMTP_PASSWORD`), port **465** → `secure: true`.
- No paid API spend required for intake; local Ollama optional for chat.