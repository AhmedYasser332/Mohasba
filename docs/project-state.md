# Project State — Mohasba Tracker v2 (Open-Source Personal Offline PWA + Supabase)

## Identity and scope
- **Project:** Mohasba Tracker v2 (`جدول المحاسبة`)
- **Governance mode:** Strict (No phase transition or production code without explicit user authorization)
- **Project date / revision:** 2026-11-21
- **3-Dimensional Classification:** `[APPROVED — 2026-11-20]`
  - **Delivery intent:** Production Application / MVP (Long-lived Personal App + Open-Source Self-Hostable Starter for developer friends)
  - **Engineering rigor:** `Focused` overall, with **targeted `Standard`-level rigor** on Offline Sync, Single-Instance Access Boundary, and Deterministic Prayer/Domain Core
  - **Risk overlays:**
    - `Concurrency / idempotency`: **ACTIVE (Full)** — Offline Phone PWA outbox vs Online PC edits, frozen-on-send `mutation_id` + causal `parent_mutation_id` + integer `row_version`, atomic `commit_sync_batch` RPC, deterministic conflict precedence, soft-archive FK safety, target-version date resolution, flaky-4G idempotency
    - `Availability / recovery`: **ACTIVE (Expanded)** — IndexedDB outbox durability (visible Unsynced badge, iOS A2HS guidance, local JSON export) + 10-minute cron piggybacking Supabase keep-alive (inside 7-day inactivity pause) + dated off-Supabase backups & pre-launch restore drill
    - `Sensitive / personal data`: **ACTIVE (Expanded)** — Server-only Supabase (`SERVICE_ROLE_KEY`, anon default-deny, RPC `REVOKE`), fail-closed `APP_PASSCODE` + per-IP hashed rate-limit + CSRF + `POST /api/logout` IDB wipe, zero-secret/scrubbed public OSS repo hygiene (`_archive_v1_sheets/` gitignored), private unguessable `ntfy` topic guidance, future scoped API key isolation
    - `External dependencies`: **ACTIVE (Expanded)** — Zero-API local prayer calculation (`adhan` + DST wall-clock rules), `ntfy` outage/anti-flood tolerance
    - `Public API / webhooks`: **ACTIVE (Lightweight)** — Secret-authenticated `POST /api/cron/tick` endpoint (and future `v1.1+` scoped REST endpoints + API key for external AI analyst agents)
    - `Multi-tenant isolation`: Inactive (single-owner per self-hosted instance)
    - `Financial correctness`: Inactive

## Mandatory Project Rules
- **Strict Phase Gates:** Stage 7 (`Slice 0` → `Slice 6`) is complete and pushed cleanly to `origin main` (strictly tested against `mohasba-test` only; Production `Mohasba` and live Oracle VPS remain 100% untouched). Ready for **Stage 8 (Integrated Quality Verification)** before requesting Stage 9 Deploy Consent.
- **Gate Commit & Push Rule:** Every time a phase Gate is explicitly closed/approved by the user, create a clean Git commit and push to `origin main` (`git@github-ahmedyasser332:AhmedYasser332/Mohasba.git`) — strictly verifying no private archives (`_archive_v1_sheets/`), `*.rar`, or `.env*` secrets are staged.
- **Consult-First Rule (2026-11-21 User Directive):** Discuss major design/planning choices interactively BEFORE authoring stage specifications.
- **Agent / Swarm Model Rule:** Every swarm worker and helper MUST explicitly specify a `gemini-4-hydrogen-*` model (`gemini-4-hydrogen-high` default), NEVER Argon/Neon/Claude unless explicitly requested by the user.
- **Dual-DB Protection:** Never touch production Supabase project `Mohasba` during Stages 7–8; run all live tests and restore drills strictly against `mohasba-test`.
- **Right-Sized Personal OSS Simplicity (2026-11-20 User Directive):** Keep architecture moderate and right-sized for a personal single-instance open-source app — **NO** user-account auth/authorization/RBAC/multi-tenant ceremony.

## Stage and authorization
- **Current stage/workstream:** **Stage 8 Verified (Automated & Live `mohasba-test` Drills Complete)** — Ready for User Hands-On Docker / `.sql.gz` Check & Stage 9 Deploy Consent
- **Approved scope:**
  - v1 Google Sheets + Apps Script prototype archived cleanly in `_archive_v1_sheets/` (2026-11-14).
  - **Gate 1 APPROVED (2026-11-20):** Approved 3D Classification, Adaptive Lifecycle Roadmap, Hosting strategy, Arabic primary UI + i18n dictionary, 3 lean MVP Insights, Action Target Evolution, and `v1.1+` Scoped REST API + Thin Skill.
  - **Gate 2 APPROVED (2026-11-20):** Approved [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md) and all 6 business-rule decisions (with expanded in-app `ntfy` customization).
  - **Gate 3 APPROVED (2026-11-20):** Approved [docs/02-ux-design-system.md](file:///d:/Ahmed/Projects/mohasba/docs/02-ux-design-system.md), [docs/02b-anti-ai-slop-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/02b-anti-ai-slop-guide.md), and [docs/prototype/index.html](file:///d:/Ahmed/Projects/mohasba/docs/prototype/index.html) with 3 production UI polish conditions locked in Section 6.
  - **Gate 4 APPROVED (2026-11-21):** Approved [docs/03-architecture.md](file:///d:/Ahmed/Projects/mohasba/docs/03-architecture.md) (Primary Launch: Oracle VPS Docker + Cloudflare Tunnel; Supported OSS Target: Cloudflare Workers; Frozen-on-send `mutation_id` + causal `parent_mutation_id` + `row_version` + `commit_sync_batch` RPC; Fail-closed `APP_PASSCODE`).
  - **Gate 5 APPROVED (2026-11-21):** Approved [docs/04-data-and-security.md](file:///d:/Ahmed/Projects/mohasba/docs/04-data-and-security.md) & [docs/04b-sql-vs-app-best-practices.md](file:///d:/Ahmed/Projects/mohasba/docs/04b-sql-vs-app-best-practices.md) (9 tables, NULL-safe `CHECK`s, per-item subtransaction `commit_sync_batch` + `trim_audit_logs_if_needed`, keyset pagination, per-row reorder, resumable Starter Pack, `pg_dump` encrypted off-VPS backup, Hybrid Observability).
  - **Gate 6 APPROVED (2026-11-21):** Approved [docs/05-implementation-plan.md](file:///d:/Ahmed/Projects/mohasba/docs/05-implementation-plan.md) (7 test-heavy vertical slices `Slice 0`–`Slice 6`, `mohasba-test` vs untouched `Mohasba`, Oracle VPS Docker + `cloudflared` Tunnel).
  - **Stage 7 EXECUTED (2026-11-21):** All 7 vertical slices (`Slice 0` → `Slice 6`) implemented, independently audited, verified live against `mohasba-test`, and committed slice-by-slice to `origin main`.
  - **Stage 8 EXECUTED (2026-11-21):** Dual-device Airplane-Mode Phone vs PC sync & dropped-ACK (`M1 → M2`) E2E verified live; `1,260`-row full JSON Export → Wipe → Chunked Import Restore Drill passed with 100% parity; Fresh-Clone OSS build (`0` secrets) passed; full regression suite passed (`mohasba-test` only; `Mohasba` prod confirmed `0` tables).
- **Pending gate(s):**
  - **Optional Local Docker & `.sql.gz` `pg_dump 17` Drill:** Deferred locally only because Docker Desktop daemon & `postgresql-client-17` / `SUPABASE_DB_BACKUP_URL` are not active on this Windows machine (run directly once Docker Desktop / Oracle VPS is ready).
  - **Stage 9 Deploy Consent:** Explicit consent required before applying `0001_init.sql` to Production `Mohasba` or deploying to live Oracle VPS.

## Decisions and uncertainties
- **Confirmed decisions (`[CONFIRMED]`):**
  - Open-Source Personal Instance + Offline-First Installable PWA + 3 Lean Weakness Insights + Clean Slate on launch.
  - **Action Target Evolution (`تطوير الهدف`):** Actions keep one stable identity while supporting evolving targets/levels (e.g. `10 صفحات` → `20 صفحة`), preserving historical logs under their original target and highlighting progression in Analytics.
  - **Future `v1.1+` AI Analyst Integration:** Scoped REST API endpoints + Scoped API Key + Thin Agent Skill (explicitly replacing MCP to avoid token burn) so external agents (Antigravity / Claude Code / Codex) can run scheduled nightly analyses and write structured reports to DB.
  - Launch hosting: **Primary: Oracle Always-Free / Linux VPS Docker (`127.0.0.1:3000` + Cloudflare Tunnel + `crontab`)** · **Supported OSS Target: Cloudflare Workers (`@opennextjs/cloudflare` + Direct Native `scheduled()` Cron)** — zero Vercel.
  - Language: Arabic UI + Generic Islamic Starter Pack + i18n-ready dictionary.
- **Rejected scope (`[REJECTED]`):**
  - Google Sheets / Apps Script; `ورقة الأوقات` & `ورقة الذنوب`; Hosted Multi-Tenant SaaS; Supabase Auth / RBAC / multi-user accounts; Vercel hosting; Super-app bloat; Naive binary streaks; Heavy MCP server.

## Implementation and verification
- **Current milestone/slice/task:** **Stage 7 COMPLETE (`Slice 0` → `Slice 6`)** — Ready for Stage 8 (Integrated Quality Verification on `mohasba-test`).
- **Verified completed tasks:**
  - Gates 1–6 formally closed and pushed to `origin main`.
  - **Slice 0 (`3d15931`):** Next.js 16 + Tailwind v4 + ESLint boundary guards + `0001_init.sql` applied to `mohasba-test` (`0` security/perf WARN/ERROR advisors, `12/12` live DB lockdown & CHECK tests).
  - **Slice 1 (`8f959ff`):** Pure `src/domain/*` (`prayer-engine` DST/Cairo parity, `lifecycle`, `qadaa`, `targets`, `conflict`, `analytics`, `starter-pack`, `i18n/ar`) — `45/45` unit tests passing.
  - **Slice 2 (`a322242`):** Web-Standard `src/server/*` + all 20 API operations (19 route files) — `31/31` live integration tests on `mohasba-test` (concurrency, intra-batch chaining, poison isolation, `trim_audit_logs_if_needed`, `1,250+`-row keyset pagination, resumable Starter Pack, per-row reorder, auth/CSRF/cron/privacy).
  - **Slice 3 (`cde67db`):** Offline-First PWA Engine (`idb` 4 stores, outbox engine, `MohasbaProvider`, `public/sw.js`, `scripts/generate-sw-manifest.mjs`) — `51/51` unit tests + Playwright SW E2E passing.
  - **Slice 4 (`e289080`):** *Al-Mizan Al-Ma'dani* Single App Shell (`○ Static`), `الآن` Street Mode (`2px` Horizon Rail), `الجدول الأسبوعي` (Standard + One-Glance enforcing all 3 Gate 3 §6 conditions + `<dialog>` Cell Editor) — `impeccable detect` `[]`, Desktop & Mobile Light/Dark screenshots visually inspected.
  - **Slice 5 (`6220763`):** `القضاء` (Cross-Upgrade historical target snapshot, 48h Catch-Up, Non-Recoverable), `التحليلات` (3 Lean Insights), `الإعدادات` (Online-only CRUD, Simple Rename vs `تطوير الهدف`, `ntfy`, Export/Import, Audit Logs drawer, Sign Out) — `impeccable detect` `[]`, full 5-view Playwright E2E + offline 5-view switching + screenshots inspected.
  - **Slice 6:** `Dockerfile` (3-stage `node:20-alpine` standalone + Node `fetch` healthcheck), `docker-compose.yml` (`mohasba` + `cloudflared` under `profiles: ["tunnel"]`), `scripts/backup-supabase.sh` (`set -euo pipefail`, `pg_dump` 17 Session Pooler `5432`, `gzip -t`, `age`/`rclone crypt`), `deploy/crontab.example`, OSS `README.md` & `LICENSE` (MIT).
- **Actual test evidence:**
  - `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` (`51/51`), `npm run test:integration` (`31/31` live on `mohasba-test`), `npm run build` (`/` `○ Static`), `impeccable.cmd detect --json src/app src/client` (`[]`), `npx playwright test --workers=1` (`3/3` E2E specs + Desktop/Mobile Light/Dark screenshots inspected), `bash -n scripts/backup-supabase.sh` (`0`), `docker compose config --quiet` (`0`), Production `Mohasba` confirmed 100% untouched.

## Handoff and resumption
- **Last meaningful milestone:** Stage 7 (`Slice 0` → `Slice 6`) completed, verified, and pushed to `origin main`.
- **Authoritative specs and plans:** [docs/00-discovery-qa.md](file:///d:/Ahmed/Projects/mohasba/docs/00-discovery-qa.md), [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md), [docs/02-ux-design-system.md](file:///d:/Ahmed/Projects/mohasba/docs/02-ux-design-system.md), [docs/02b-anti-ai-slop-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/02b-anti-ai-slop-guide.md), [docs/03-architecture.md](file:///d:/Ahmed/Projects/mohasba/docs/03-architecture.md), [docs/04-data-and-security.md](file:///d:/Ahmed/Projects/mohasba/docs/04-data-and-security.md), [docs/04b-sql-vs-app-best-practices.md](file:///d:/Ahmed/Projects/mohasba/docs/04b-sql-vs-app-best-practices.md), [docs/05-implementation-plan.md](file:///d:/Ahmed/Projects/mohasba/docs/05-implementation-plan.md)
- **Exact next action:** Begin **Stage 8 (Integrated Quality Verification)** on `mohasba-test` (real-device Airplane-Mode sync test + Dual `.sql.gz` & `>1,000`-row JSON Restore Drills) upon user review, followed by Stage 9 Production Release only with explicit deploy consent.
- **New approval needed?** Yes — User review before Stage 8/9, and explicit deploy consent before touching Production `Mohasba` or live Oracle VPS.
