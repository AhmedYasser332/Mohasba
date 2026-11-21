# Mohasba Tracker v2 (`جدول المحاسبة`)

An **open-source, personal, single-instance, offline-first PWA** for daily Islamic accountability — designed for `<3s` one-thumb street logging right after prayer (even in Airplane Mode) and a high-density desktop weekly ledger.

## Key Capabilities

- **Instant Offline-First PWA (`الآن` Street Mode):** Local IndexedDB (`idb`) writes in `<50ms` with 5-second Undo, frozen-on-send `mutation_id` + causal `parent_mutation_id` conflict resolution, cross-tab sync, and Service Worker shell caching for offline reloads & deep links.
- **Dual-Mode Weekly Ledger (`الجدول الأسبوعي`):** Switch between Desktop Standard Mode (`العرض المريح`) and zero-scroll side-by-side **One-Glance Mode (`نظرة واحدة`)** with `Ctrl+I` (`Ctrl+ه`) collapsible RTL sidebar, plus Mobile WHOOP-style 7-day boxes.
- **Prayer-Aware Islamic Day Engine:** Offline astronomical calculation (`adhan`) supporting `FAJR` or `MIDNIGHT` day rollover, Egypt/global DST gap & overlap handling, manual per-prayer offsets, and the `2px` Time-Window Horizon Rail.
- **Cross-Week Qadaa (`القضاء`) & Target Evolution (`تطوير الهدف`):** Upgrade action targets over time (e.g., `10 صفحات` → `20 صفحة`) while preserving historical logs and open Qadaa items under their original day's target snapshot.
- **3 Lean Weakness Insights (`التحليلات`):** Cold-start & `"هدف جديد"` adaptation guard, isolated `TIME_BOUND` vs `DAILY_GROUP` metrics separating `الجماعة الأولى` from Sunan, and Qadaa velocity / anti-`مراكمة` logging coverage.
- **Zero-Account Personal Security:** Server-only Supabase PostgreSQL (`SERVICE_ROLE_KEY`, default-deny RLS, zero `NEXT_PUBLIC_*` DB keys), fail-closed `APP_PASSCODE` 180-day `HttpOnly` Web Crypto cookie, per-IP rate limiting, CSRF guard, and `POST /api/logout` local IndexedDB wipe.
- **Smart `ntfy` Push Reminders:** Per-period pre-expiry / post-start triggers, quiet hours, nightly catch-up digest, anti-flood expiry bounds, and Supabase keep-alive piggybacked on a 10-minute cron tick.

---

## Architecture & Portability

- **Stack:** Next.js App Router (TypeScript strict, `output: 'standalone'`), Tailwind CSS v4, pure TypeScript `src/domain/*`, Supabase PostgreSQL 15+/17 (HTTP `@supabase/supabase-js` only, 9 tables + 2 logic-free persistence RPCs).
- **Primary Self-Hosting Target:** Any Linux / Oracle Always-Free VPS running **Docker (`127.0.0.1:3000`) + Cloudflare Tunnel (`cloudflared`)** with zero open inbound ports (`80`/`443`).
- **Web-Standard Portable Codebase:** `src/domain/*` has zero runtime dependencies, `src/server/*` uses Web Crypto (`crypto.subtle`), standard Web `Request`, HTTP Supabase, and zero `next/headers` or `import 'server-only'` — keeping it portable across Node 22 Docker and standard Web runtimes *(note: MVP launch verification targets Docker + Node 22; Cloudflare Workers Free CPU benchmarking is not claimed as part of MVP)*.

---

## 5-Minute Self-Hosting Setup

### 1. Create a Free Supabase Project
In the Supabase Dashboard when creating your project:
1. **Enable Data API:** `ON`
2. **Grant API access to new tables automatically:** `OFF`
3. **Enable Row Level Security (RLS) on new tables automatically:** `ON`
4. Open the **SQL Editor** and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) verbatim (creates all 9 tables, 2 RPCs, default-deny RLS, `REVOKE` from `PUBLIC/anon/authenticated`, and explicit `GRANT ... TO service_role`).
5. Verify in **Database → Advisors** that there are zero exposed-table warnings.

### 2. Configure Environment Variables
Copy `.env.example` to `.env` (or `.env.local` for local dev) and fill the 6 server-only variables:

```bash
cp .env.example .env
chmod 600 .env
```

Generate a strong `CRON_SECRET`:
```bash
openssl rand -hex 32
```

Required variables:
- `SUPABASE_URL` — Project URL (`https://<ref>.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — Secret / `service_role` key (server-only, never exposed to browser)
- `CRON_SECRET` — 64-char random hex secret (signs session cookies via HKDF & authenticates `/api/cron/tick`)
- `APP_URL` — Public HTTPS origin (e.g., `https://mohasba.yourdomain.com`)
- `APP_PASSCODE` — Personal unlock passcode (fail-closed in production: returns `503` if unset unless `ALLOW_UNAUTHENTICATED=true`)
- `NTFY_TOPIC_URL` *(optional)* — Private unguessable `ntfy.sh` or self-hosted `ntfy` topic URL

### 3. Run Locally (Development / Verification)
```bash
npm ci
npm run dev
```

Run checks & tests:
```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

*(Integration tests in `npm run test:integration` require a dedicated staging Supabase project with `ALLOW_TEST_DB_RESET=true` and `TEST_SUPABASE_REF=<staging-ref>` in `.env.local` — never run integration tests against your production database.)*

### 4. Deploy on Oracle Always-Free / Linux VPS (Docker + Cloudflare Tunnel)

> **Oracle Cloud Tip (Preventing Idle Reclamation):** Oracle's Always-Free tier may reclaim instances with very low CPU/network utilization over 7 days. Upgrading your Oracle account to **Pay-As-You-Go (PAYG)** while setting a **`$1` Budget Alert** keeps Always-Free ARM/AMD shapes at **`$0/month`** while disabling automatic idle reclamation.

1. Clone this repo into `/srv/mohasba` and configure `chmod 600 /srv/mohasba/.env`.
2. Add `CLOUDFLARE_TUNNEL_TOKEN=...` to `.env` (from Cloudflare Zero Trust → Tunnels, routing your custom domain to `http://mohasba:3000`).
3. Start the app + tunnel (zero inbound ports `80`/`443` needed on your VPS firewall):
   ```bash
   docker compose --profile tunnel up -d --build
   ```
   *(To test locally without a tunnel token, run `docker compose up -d --build mohasba` and verify `http://127.0.0.1:3000/api/health`.)*

### 5. Automated Cron & Encrypted Weekly Backups
1. Install `postgresql-client-17` (from the official PGDG repo so `pg_dump` major version matches Supabase PostgreSQL 17), plus `age` or `rclone` (`rclone crypt`) for off-VPS encryption.
2. Create `chmod 600 /srv/mohasba/.backup.env` containing your Supabase **Session Pooler URI (port `5432`, IPv4-safe — NEVER Transaction Pooler `6543`)**:
   ```bash
   SUPABASE_DB_BACKUP_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"
   AGE_RECIPIENT="age1..."
   RCLONE_REMOTE="mohasba-crypt:mohasba-backups"
   ```
3. Install the cron entries from [`deploy/crontab.example`](deploy/crontab.example) (`crontab -e`):
   - Every 10 minutes: `POST http://127.0.0.1:3000/api/cron/tick` (`ntfy` reminders + Supabase keep-alive + daily ring-buffer prune).
   - Weekly Sunday `03:15 UTC`: [`scripts/backup-supabase.sh`](scripts/backup-supabase.sh) (`set -euo pipefail`, `gzip -t` integrity verification before promotion/rotation, encrypted off-VPS upload, 12-snapshot retention).

---

## License

[MIT](LICENSE)
