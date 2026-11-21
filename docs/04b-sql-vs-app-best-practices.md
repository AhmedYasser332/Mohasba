# SQL vs. Application Logic — Best-Practices Guide (`Mohasba Tracker v2`)

**Purpose:** Permanent engineering guide establishing the exact boundary between PostgreSQL SQL (`supabase/migrations/*.sql`) and TypeScript application logic (`src/domain/*`, `src/server/*`) so the codebase stays clean, testable, portable, and maintainable.  
**Derived From:** Stage 5 Principal Architecture & Supabase Postgres Audit (`#52`–`#54`, 2026-11-21).

---

## 1. The Core Golden Rule

> **Put Declarative Data Integrity in SQL DDL. Put 100% of Business Logic in Pure TypeScript (`src/domain/*`). Never mix the two.**

Why? Business rules written inside `PL/pgSQL` triggers or stored procedures are:
- Invisible to TypeScript's type checker,
- Slow and painful to unit-test (cannot run in Vitest in milliseconds),
- Guaranteed to drift from the Offline-First Browser PWA (which must run the exact same rules locally in Airplane Mode!).

---

## 2. The Boundary Matrix (What Goes Where)

| Layer | ✅ BELONGS HERE | ❌ BANNED HERE |
| :--- | :--- | :--- |
| **PostgreSQL SQL DDL (`supabase/migrations/*.sql`)** | **Declarative Data Integrity (Last Line of Defense):**<br>• Primary Keys (composite PK `(action_id, log_date)` on `daily_logs`, `BIGINT GENERATED ALWAYS AS IDENTITY` on `audit_logs`, singleton `id = 1 CHECK (id = 1)` on `app_settings`)<br>• Foreign Keys (`ON DELETE RESTRICT` preventing deletion of referenced `target_versions`, `actions`, `periods`; composite FK `(target_version_id, action_id)` preventing cross-action target links)<br>• Uniqueness (`UNIQUE (action_id, effective_from)`, **`UNIQUE NULLS NOT DISTINCT`** on `reminder_dispatches`)<br>• Simple column-domain `CHECK` constraints — **always NULL-safe under SQL 3-valued logic** (`percent_value BETWEEN 1 AND 99`, `status IS NOT DISTINCT FROM 'PERCENT'`, `archived_at IS NULL OR archived_at >= active_from`)<br>• `TEXT CHECK (...)` instead of Postgres `ENUM` (avoids painful `ALTER TYPE` migration locks)<br>• Query-driven & partial indexes only<br>• Default-deny RLS (`ENABLE ROW LEVEL SECURITY`, zero policies) + explicit `REVOKE` from `PUBLIC/anon/authenticated` + explicit `GRANT` to `service_role` | • **ZERO** `PL/pgSQL` business triggers<br>• **ZERO** conflict precedence rules (`Positive > MISSED`, `note_updated_at` LWW)<br>• **ZERO** prayer-time, DST, or Fajr-rollover math<br>• **ZERO** Qadaa scoring, Weakness Insights, or `"هدف جديد"` adaptation logic<br>• **ZERO** `VARCHAR(N)` (prefer `TEXT` + optional `CHECK (char_length(...) <= N)`) or bare `TIMESTAMP` (always `TIMESTAMPTZ`) |
| **Pure TypeScript Domain (`src/domain/*`)** | **100% of Behavioral Business Logic (Shared by Browser PWA & Server):**<br>• Conflict resolution (`Positive > MISSED`, causal `parent_mutation_id`, independent `note_updated_at`)<br>• Prayer engine (`adhan` + two-pass `zonedWallClockToUtc` + 3-day window)<br>• 5-state canonicalization (`100% → DONE`, `0% → MISSED`) & non-overwriting bulk planners<br>• Target Evolution (`D` vs `D+1` default, immutability checks)<br>• All 3 Lean Weakness Analytics Insights | • Zero imports from `react`, `next/*`, `@supabase/*`, DOM, or Node-only APIs |
| **Server Services & Repositories (`src/server/*`)** | • Input validation (`Zod`), auth/CSRF guards, secret scrubbing<br>• Batched `@supabase/supabase-js` queries (2–4 reads) → call `src/domain/*` → persist results<br>• Fail-safe best-effort `audit_logs` writer + JSON stdout structured logging | • Never duplicate `src/domain/*` formulas inline in Route Handlers |

---

## 3. The "Dumb Persistence Envelope" Exception (Why Exactly 2 Tiny SQL RPCs Exist)

Because our app uses **Supabase Cloud over HTTP (`@supabase/supabase-js` / PostgREST)** so the exact same code runs cleanly on **Oracle VPS Docker** AND **Cloudflare Workers Free** (without splitting into two TCP/Hyperdrive database stacks):
- PostgREST auto-commits every HTTP request independently—it has no client-side `BEGIN / COMMIT`.
- Therefore we allow **strictly 2 tiny, logic-free SQL helper functions** (and **zero** others):
  1. **`public.commit_sync_batch(p_items jsonb)` (~70 lines):** Contains **zero** conflict logic. Receives already-resolved rows computed by TypeScript `src/domain/conflict.ts`, and executes per-item subtransactions (`BEGIN ... EXCEPTION`): atomic `applied_mutations` claim (`ON CONFLICT DO NOTHING`) → strict Create (`ON CONFLICT DO NOTHING`) vs Optimistic Update (`WHERE row_version = expected`) → isolates constraint violations (`rejected`) without rolling back healthy items.
  2. **`public.trim_audit_logs_if_needed(p_max_rows, p_batch_limit)` (~18 lines):** Trims strictly by `row_count > 35,000` (at most 1 batch of 1,000 oldest rows `> 7 days` old per daily tick) while reporting `pg_catalog.pg_total_relation_size('public.audit_logs')` as a monitoring metric only (avoids repeated deletion on un-shrunk physical table bloat).

### Mandatory Security Template for Every SQL Function in This Repo
Every SQL function MUST obey ALL 4 rules (verified by `supabase db advisors` and Stage 8 security tests):
1. **`SECURITY INVOKER`** (avoid `SECURITY DEFINER` since `service_role` already bypasses RLS).
2. **`SET search_path = ''`** with **fully schema-qualified** names (`public.daily_logs`, `pg_catalog.pg_total_relation_size`).
3. **`REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;`** (PostgreSQL grants `EXECUTE` to `PUBLIC` by default!).
4. **`GRANT EXECUTE ON FUNCTION ... TO service_role;`** (required especially when Supabase's *"Grant API access to new tables automatically"* is disabled).

---

## 4. Observability & Audit Retention Best Practice

- **Zero External Telemetry SaaS (No PostHog / Mixpanel):** Personal worship records stay 100% private in the owner's own infrastructure (`docker logs` JSON stdout for routine `200 OK` traces + `public.audit_logs` in Supabase for durable `ERROR`/`WARN` and high-signal `INFO` audit trails).
- **Deterministic Row-Count Ring Buffer (Never Fixed 30-Day Wipe):** Worship tables (`daily_logs`, `actions`, `periods`, `target_versions`) are **NEVER** pruned. Only `audit_logs` is bounded at **`35,000` rows** (~25 MiB steady state = ~3.5–5+ years of personal history!), trimming at most 1 batch of 1,000 oldest rows per daily cron tick (with a hard 7-day protection floor) while keeping `pg_total_relation_size` strictly as an observability metric.
- **Fail-Safe & Privacy-Scrubbed:** Audit logging strips all keys matching `/passcode|secret|token|cookie|authorization|password|topic_url|service_role|key/i`, **never logs raw user `note` content** (logs `has_note` + `note_length` only), and runs non-blocking inside `try/catch` so a logging error can **never** break a prayer log.
