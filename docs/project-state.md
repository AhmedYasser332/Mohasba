# Project State — Mohasba Tracker v2 (Open-Source Personal Offline PWA + Supabase)

## Identity and scope
- **Project:** Mohasba Tracker v2 (`جدول المحاسبة`)
- **Governance mode:** Strict (No phase transition or production code without explicit user authorization)
- **Project date / revision:** 2026-11-28
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
- **Current stage/workstream:** **Stage 8 CLOSED & RELEASE-VERIFIED (2026-11-28 — Multi-Skill Swarm Audit + P0/P1 Hardening + `0004` Atomic RPCs + Full Regression + Docker Healthy + Claude Opus 5.5 High Final Gate `SOLID`)** — Ready for **Stage 9 Production Deploy Consent**
- **Approved scope:**
  - v1 Google Sheets + Apps Script prototype archived cleanly in `_archive_v1_sheets/` (2026-11-14).
  - **Gate 1 APPROVED (2026-11-20):** Approved 3D Classification, Adaptive Lifecycle Roadmap, Hosting strategy, Arabic primary UI + i18n dictionary, 3 lean MVP Insights, Action Target Evolution, and `v1.1+` Scoped REST API + Thin Skill.
  - **Gate 2 APPROVED (2026-11-20):** Approved [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md) and all 6 business-rule decisions (with expanded in-app `ntfy` customization).
  - **Gate 3 APPROVED (2026-11-20):** Approved [docs/02-ux-design-system.md](file:///d:/Ahmed/Projects/mohasba/docs/02-ux-design-system.md), [docs/02b-anti-ai-slop-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/02b-anti-ai-slop-guide.md), and [docs/prototype/index.html](file:///d:/Ahmed/Projects/mohasba/docs/prototype/index.html) with 3 production UI polish conditions locked in Section 6.
  - **Gate 4 APPROVED (2026-11-21):** Approved [docs/03-architecture.md](file:///d:/Ahmed/Projects/mohasba/docs/03-architecture.md) (Primary Launch: Oracle VPS Docker + Cloudflare Tunnel; Supported OSS Target: Cloudflare Workers; Frozen-on-send `mutation_id` + causal `parent_mutation_id` + `row_version` + `commit_sync_batch` RPC; Fail-closed `APP_PASSCODE`).
  - **Gate 5 APPROVED (2026-11-21):** Approved [docs/04-data-and-security.md](file:///d:/Ahmed/Projects/mohasba/docs/04-data-and-security.md) & [docs/04b-sql-vs-app-best-practices.md](file:///d:/Ahmed/Projects/mohasba/docs/04b-sql-vs-app-best-practices.md) (9 tables, NULL-safe `CHECK`s, per-item subtransaction `commit_sync_batch` + `trim_audit_logs_if_needed`, keyset pagination, per-row reorder, resumable Starter Pack, `pg_dump` encrypted off-VPS backup, Hybrid Observability).
  - **Gate 6 APPROVED (2026-11-21):** Approved [docs/05-implementation-plan.md](file:///d:/Ahmed/Projects/mohasba/docs/05-implementation-plan.md) (7 test-heavy vertical slices `Slice 0`–`Slice 6`, `mohasba-test` vs untouched `Mohasba`, Oracle VPS Docker + `cloudflared` Tunnel).
  - **Stage 7 EXECUTED (2026-11-21):** All 7 vertical slices (`Slice 0` → `Slice 6`) implemented, independently audited, verified live against `mohasba-test`, and committed slice-by-slice to `origin main`.
  - **Stage 8 EXECUTED, UX-HARDENED & CLOSED (2026-11-21 → 2026-11-28):**
    - Dual-device Airplane-Mode Phone vs PC sync & dropped-ACK (`M1 → M2`) E2E verified live; `1,260`-row JSON Export → Wipe → Chunked Import Restore Drill passed with 100% parity; live `.sql.gz` `pg_dump 17` → Drop → `psql` Restore Drill passed; UX upgrades (`0002_ux_preferences.sql`), Opus 5.5 Practicality Audit (`A1–A7`), 2-Step 3-Level Onboarding Wizard, Smart 2-Tier Permanent Delete (`0003_atomic_delete_rpcs.sql`), 120fps DPI-proof GPU Crosshair + Settings controls, Non-Destructive Template Merge, and Safe Workspace Reset implemented.
    - **Final Stage 8 Multi-Skill Swarm Audit & Hardening (2026-11-28):** Applied all verified P0/P1 findings across security, architecture, clean code, modern web, and docs/tests: added `supabase/migrations/0004_atomic_workspace_and_unlock.sql` (`reset_workspace_atomic` with `pg_safeupdate`-safe `WHERE` clauses + `record_unlock_failure_atomic` eliminating unlock TOCTOU race), malformed cookie `URIError` guard, default `Cache-Control: no-store` on API responses + unread fetch body cancellation, calendar-date `IsoDateSchema`, shared `assertValidIanaTimezone`, visible-ASCII `ntfy_access_token` validation, `ntfy` daily prune error checks & post-midnight `FAJR` digest shift, `outbox-engine` `race_conflict` loop backoff & mid-flight Undo snapshot sync, `resetWorkspace` race barrier, lazy `AnalyticsView`/`QadaaView` memos, first-install SW `controllerchange` guard, shared `<AppDialog>` across all 10 modal instances (repeated-`Esc` sync + pointer-rect light-dismiss + `<h2>` hierarchy), targeted `prefers-reduced-motion` rules, plaintext `.sql.gz` removal after `age` encryption in `backup-supabase.sh`, stripped hardcoded Windows paths from all 5 E2E specs, synced `README.md` + `docs/01–06`, and added live integration/unit/E2E coverage for `0002`/`0004`, `merge-template`, `reset`, and `crosshair-prefs`.
    - **Stage 8 Final Security/Release Opus 5.5 High Gate (2026-11-28):** One-shot `claude-opus-5-5-high` review returned **`Verdict: SOLID`** (`0` Critical Issues or Silent Traps; 3 non-blocking post-launch notes recorded below).
- **Pending gate(s):**
  - **Stage 9 Deploy Consent:** Explicit user consent required before applying `0001_init.sql` → `0002_ux_preferences.sql` → `0003_atomic_delete_rpcs.sql` → `0004_atomic_workspace_and_unlock.sql` to Production **`Mohasba`** (`eghznlfdauoclcvicuys`, confirmed `0` tables untouched) or deploying to live Oracle VPS.

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
- **Current milestone/slice/task:** **Stage 8 CLOSED & VERIFIED (`Verdict: SOLID`)** — Ready for **Stage 9 Production Release** upon explicit deploy consent.
- **Verified completed tasks:**
  - Gates 1–6 formally closed and pushed to `origin main`.
  - **Slice 0 (`3d15931`) → Slice 6 (`deef7dc`):** Full vertical stack implemented, audited, and pushed cleanly to `origin main`.
  - **Stage 8 Drills, UX Upgrades & Final Hardening (2026-11-21 → 2026-11-28):** Dual-device Airplane-Mode sync & dropped-ACK (`M1 → M2`), `1,260`-row JSON Export/Restore, live `.sql.gz` `pg_dump 17` Restore Drill, 3-Level Onboarding + Merge/Reset, Smart 2-Tier Delete (`0003`), 120fps DPI-proof GPU Crosshair + Settings controls, 4-specialist multi-skill audit fixes + `0004_atomic_workspace_and_unlock.sql`, OSS hygiene scrub, and one-shot `Claude Opus 5.5 High` Final Release Review (`Verdict: SOLID`).
- **Actual test evidence (2026-11-28):**
  - `npm run typecheck` (`0` errors), `npm run lint` (`0` errors, `0` warnings), `npm run test:unit` (`12` files, `77/77` passed), `npm run test:integration` (`9` files, `47/47` passed live on `mohasba-test` including `0002` negative `CHECK`s, `0004` RPC `anon` lockdown, `merge-template`, and `reset`), `npm run build` (`/` `○ Static`, `public/sw-manifest.json` `20` assets), `impeccable.cmd detect --json src/app src/client` (`[]`), `npx playwright test --workers=1` (`6/6` E2E specs passed in 3.5m), `bash -n scripts/backup-supabase.sh` (pass), live Docker `mohasba-app` (`node:22-alpine`) `healthy` (`GET /api/health` -> `200 {"ok":true}`, `/sw-manifest.json` -> `200 no-store`, `/api/bootstrap` -> `401 no-store`), `supabase_mcp:get_advisors` (`security`) on `mohasba-test` (`0` warnings; 9 default-deny RLS INFO), tracked-file OSS scan (`0` secrets/local paths), and Production `Mohasba` confirmed `0` tables untouched.
- **Non-blocking post-launch hardening notes (from Opus 5.5 High Stage 8 review, optional for v2.0.1/v2.1):**
  - Enforce `>= 10`-char `APP_PASSCODE` in production + exponential lockout backoff (for Stage 9 launch, use a strong `>= 14`-char passcode and/or Cloudflare Access).
  - Add `workspace_epoch` in `app_settings` to block stale offline mutations from another device replaying after a Workspace Reset (operationally, sign out other devices before resetting).
  - Avoid running JSON Backup Import while another device is actively syncing.

## Handoff and resumption
- **Last meaningful milestone:** **Stage 8 formally closed (`2026-11-28`)** with full green regression across all 12 unit + 9 live integration + 6 E2E suites, healthy Docker container, and `Claude Opus 5.5 High` Final Release Gate `Verdict: SOLID`.
- **Authoritative specs and plans:** [docs/00-discovery-qa.md](file:///d:/Ahmed/Projects/mohasba/docs/00-discovery-qa.md), [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md), [docs/02-ux-design-system.md](file:///d:/Ahmed/Projects/mohasba/docs/02-ux-design-system.md), [docs/02b-anti-ai-slop-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/02b-anti-ai-slop-guide.md), [docs/03-architecture.md](file:///d:/Ahmed/Projects/mohasba/docs/03-architecture.md), [docs/04-data-and-security.md](file:///d:/Ahmed/Projects/mohasba/docs/04-data-and-security.md), [docs/04b-sql-vs-app-best-practices.md](file:///d:/Ahmed/Projects/mohasba/docs/04b-sql-vs-app-best-practices.md), [docs/05-implementation-plan.md](file:///d:/Ahmed/Projects/mohasba/docs/05-implementation-plan.md), [docs/06-ux-best-practices-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/06-ux-best-practices-guide.md)
- **Exact next action:** Request explicit user deploy consent to enter **Stage 9 (Production Release)**: apply `0001`–`0004` to clean Production `Mohasba`, deploy Docker + `cloudflared` Tunnel + `crontab` + encrypted `pg_dump` 17 backup on Oracle VPS, and verify live HTTPS, `ntfy`, and PWA installability.
- **New approval needed?** Yes — Explicit Stage 9 Deploy Consent before touching Production `Mohasba` (`eghznlfdauoclcvicuys`) or live Oracle VPS.
