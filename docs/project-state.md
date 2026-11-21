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
- **Strict Phase Gates:** Gate 6 is closed; parked at the entry of **Stage 7 (Implementation + Continuous Verification)** — do **NOT** start Slice 0 coding or migrations until the user gives the explicit start signal.
- **Gate Commit & Push Rule:** Every time a phase Gate is explicitly closed/approved by the user, create a clean Git commit and push to `origin main` (`git@github-ahmedyasser332:AhmedYasser332/Mohasba.git`) — strictly verifying no private archives (`_archive_v1_sheets/`), `*.rar`, or `.env*` secrets are staged.
- **Consult-First Rule (2026-11-21 User Directive):** Discuss major design/planning choices interactively BEFORE authoring stage specifications.
- **Agent / Swarm Model Rule:** Every swarm worker and helper MUST explicitly specify a `gemini-4-hydrogen-*` model (`gemini-4-hydrogen-high` default), NEVER Argon/Neon/Claude unless explicitly requested by the user.
- **Dual-DB Protection:** Never touch production Supabase project `Mohasba` during Stages 7–8; run all live tests and restore drills strictly against `mohasba-test`.
- **Right-Sized Personal OSS Simplicity (2026-11-20 User Directive):** Keep architecture moderate and right-sized for a personal single-instance open-source app — **NO** user-account auth/authorization/RBAC/multi-tenant ceremony.

## Stage and authorization
- **Current stage/workstream:** Gate 6 CLOSED — Ready to Start Stage 7 (Implementation + Continuous Verification, `Slice 0` → `Slice 6`) on user's explicit go-ahead
- **Approved scope:**
  - v1 Google Sheets + Apps Script prototype archived cleanly in `_archive_v1_sheets/` (2026-11-14).
  - **Gate 1 APPROVED (2026-11-20):** Approved 3D Classification, Adaptive Lifecycle Roadmap, Hosting strategy, Arabic primary UI + i18n dictionary, 3 lean MVP Insights, Action Target Evolution, and `v1.1+` Scoped REST API + Thin Skill.
  - **Gate 2 APPROVED (2026-11-20):** Approved [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md) and all 6 business-rule decisions (with expanded in-app `ntfy` customization).
  - **Gate 3 APPROVED (2026-11-20):** Approved [docs/02-ux-design-system.md](file:///d:/Ahmed/Projects/mohasba/docs/02-ux-design-system.md), [docs/02b-anti-ai-slop-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/02b-anti-ai-slop-guide.md), and [docs/prototype/index.html](file:///d:/Ahmed/Projects/mohasba/docs/prototype/index.html) with 3 production UI polish conditions locked in Section 6.
  - **Gate 4 APPROVED (2026-11-21):** Approved [docs/03-architecture.md](file:///d:/Ahmed/Projects/mohasba/docs/03-architecture.md) (Primary Launch: Oracle VPS Docker + Cloudflare Tunnel; Supported OSS Target: Cloudflare Workers; Frozen-on-send `mutation_id` + causal `parent_mutation_id` + `row_version` + `commit_sync_batch` RPC; Fail-closed `APP_PASSCODE`).
  - **Gate 5 APPROVED (2026-11-21):** Approved [docs/04-data-and-security.md](file:///d:/Ahmed/Projects/mohasba/docs/04-data-and-security.md) & [docs/04b-sql-vs-app-best-practices.md](file:///d:/Ahmed/Projects/mohasba/docs/04b-sql-vs-app-best-practices.md) (9 tables, NULL-safe `CHECK`s, per-item subtransaction `commit_sync_batch` + `trim_audit_logs_if_needed`, keyset pagination, per-row reorder, resumable Starter Pack, `pg_dump` encrypted off-VPS backup, Hybrid Observability).
  - **Gate 6 APPROVED (2026-11-21):** Approved [docs/05-implementation-plan.md](file:///d:/Ahmed/Projects/mohasba/docs/05-implementation-plan.md) (7 test-heavy vertical slices `Slice 0`–`Slice 6`, `mohasba-test` vs untouched `Mohasba`, Oracle VPS Docker + `cloudflared` Tunnel).
- **Pending gate(s):**
  - **Stage 7 Start Signal:** Awaiting user's explicit go-ahead to begin `Slice 0` (Next.js scaffold + `0001_init.sql` on `mohasba-test`).
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
- **Current milestone/slice/task:** **Gate 6 CLOSED & PUSHED** — Parked right before Stage 7 (`Slice 0`) awaiting user's explicit go-ahead to begin implementation.
- **Verified completed tasks:**
  - Gate 1 formally closed (2026-11-20).
  - Gate 2 formally closed (2026-11-20) in [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md).
  - Gate 3 formally closed (2026-11-20) in [docs/02-ux-design-system.md](file:///d:/Ahmed/Projects/mohasba/docs/02-ux-design-system.md) (with Section 6 polish conditions locked for Stage 7).
  - Gate 4 formally closed (2026-11-21) in [docs/03-architecture.md](file:///d:/Ahmed/Projects/mohasba/docs/03-architecture.md) and pushed to `origin main` (`6b288a6`).
  - Gate 5 formally closed (2026-11-21) in [docs/04-data-and-security.md](file:///d:/Ahmed/Projects/mohasba/docs/04-data-and-security.md) & [docs/04b-sql-vs-app-best-practices.md](file:///d:/Ahmed/Projects/mohasba/docs/04b-sql-vs-app-best-practices.md) and pushed to `origin main` (`9a3e38c`).
  - Gate 6 formally closed (2026-11-21) in [docs/05-implementation-plan.md](file:///d:/Ahmed/Projects/mohasba/docs/05-implementation-plan.md) and pushed to `origin main`.
  - Verified both Supabase PostgreSQL 17.12 projects (`Mohasba` prod + `mohasba-test` staging/dev) are `ACTIVE_HEALTHY` via Supabase MCP.
  - Initialized public Git repository with `.gitignore` (excluding private `_archive_v1_sheets/` & archives) and `AGENTS.md`.
- **Actual test evidence:**
  - Stage 3 prototype verified with `impeccable.cmd detect --json` (`[]`) and Playwright desktop/mobile checks; both Supabase Postgres 17.12 projects verified healthy read-only; live migrations and coding paused awaiting explicit Stage 7 start signal.

## Handoff and resumption
- **Last meaningful milestone:** All 6 planning & design Gates (`Gate 1`–`Gate 6`) formally closed and pushed to `origin main`.
- **Authoritative specs and plans:** [docs/00-discovery-qa.md](file:///d:/Ahmed/Projects/mohasba/docs/00-discovery-qa.md), [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md), [docs/02-ux-design-system.md](file:///d:/Ahmed/Projects/mohasba/docs/02-ux-design-system.md), [docs/02b-anti-ai-slop-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/02b-anti-ai-slop-guide.md), [docs/03-architecture.md](file:///d:/Ahmed/Projects/mohasba/docs/03-architecture.md), [docs/04-data-and-security.md](file:///d:/Ahmed/Projects/mohasba/docs/04-data-and-security.md), [docs/04b-sql-vs-app-best-practices.md](file:///d:/Ahmed/Projects/mohasba/docs/04b-sql-vs-app-best-practices.md), [docs/05-implementation-plan.md](file:///d:/Ahmed/Projects/mohasba/docs/05-implementation-plan.md)
- **Exact next action:** Wait for user's explicit go-ahead to launch Stage 7 `Slice 0` (Next.js scaffold + `0001_init.sql` live migration & security tests on `mohasba-test`).
- **New approval needed?** Yes — User's explicit start signal for Stage 7 (and later explicit deploy consent for Stage 9).
