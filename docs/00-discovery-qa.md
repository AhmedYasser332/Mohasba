# Phase 0 & Stage 1 — Discovery, 3-Dimensional Classification & Lifecycle Path

**Status:** **GATE 1 APPROVED (2026-11-20)** — Transitioned to Stage 2 (Requirements & Business Rules)  
**Governance Mode:** Strict  
**Last Updated:** 2026-11-20  

---

## 1. Knowledge Map

### `[CONFIRMED]` — Agreed Core Facts & Direction
1. **Core Problem & Mission:** Prevent backlog ("مراكمة ملئ الجدول") by enabling fast mobile logging right after prayer ("في الشارع بعد الصلاة") alongside a clear PC weekly overview.
2. **Distribution Model (`Open-Source Personal Instance`):**
   - Single-user per personal deployment right now (not a hosted multi-tenant SaaS).
   - Published as an **Open-Source** project so the user's developer friends can clone, configure, and deploy their own personal instances.
3. **Offline Resilience (`Offline-First PWA`):**
   - Confirmed **Installable PWA with Offline capability** — must work reliably in the street when leaving the mosque even without mobile data, syncing automatically to Supabase Cloud when connectivity returns.
4. **Weakness Discovery (`Analytics & Blind-Spot Insights`):**
   - Confirmed — include clear analytics and consistency insights designed to surface personal blind spots and weak areas ("عشان الواحد ياخد باله من نقاط الضعف بتاعته").
5. **Day-1 Data Strategy (`Clean Slate`):**
   - Start clean from zero on launch (optional historical Excel import deferred unless requested later).
6. **Domain Baseline (`جدول المحاسبة`):**
   - Weekly accountability grid structure (`السبت` to `الجمعة`, configurable for OSS users).
   - Two distinct sides: Time-bound prayer periods (`الصبح`, `الصباح`, `الظهر`, `العصر`, `المساء`, `المغرب`, `العشاء`) + Open daily/Friday habit groups (`الأذكار والسنن اليومية`, `العلم والعمل والبر`, `الصيام وغض البصر`, `وظائف الجمعة`, `الاستيقاظ بدون Snoozes`).
   - Status values: Done (`✅`), Missed (`❌️`), Qadaa Done (`🔘`), Percentages (`0%..100%`), optional notes.
   - Smart Qadaa tracking (`القضاء`): distinguish *unlogged/forgot to fill* vs *confirmed missed* vs *disabled/excused*, and exclude non-recoverable items from Qadaa debt.
   - Per-cell enable/disable capability + default active weekdays per action.
   - Dynamic flexibility: add, edit, soft-archive, reorder, or move actions & create custom periods (e.g., `الليل`), plus optional time-window binding for left-side items.
   - `ntfy` push notifications as part of the roadmap.
7. **Database & Framework Choice:**
   - **Database:** **Supabase Cloud** (Managed PostgreSQL + Supabase Studio Table Editor).
   - **Full-Stack App:** **Next.js** (Frontend + Backend API in one codebase).
   - **Hosting Flexibility:** Portable across Cloudflare / Vercel / user's **Linux VPS** (with clean decoupling for any future backend separation).

### `[CONFIRMED]` — Gate 1 Final Decisions & New Product Requirements (2026-11-20)
8. **Launch Hosting & Cron Strategy:** Default Open-Source deployment targeting **Vercel / Cloudflare + integrated Cron** (for `ntfy` + Supabase 7-day keep-alive), plus a ready **Dockerfile** for Linux VPS self-hosters.
9. **UI Language & Starter Pack:** **Arabic primary UI** + **Generic Islamic Starter Pack**, with all static copy organized in semantic dictionary files so adding an English pack later is clean and effortless.
10. **MVP v1 Analytics Scope:** Launch MVP v1 with the **3 lean weakness insights** (*Top 3–5 Weak Spots*, *7-Window vs Left-Group Breakdown*, *Qadaa & Backlog Pulse*), deferring Weekday Slump Matrix & Keystone correlations to `v1.1`.
11. **Action Goal Evolution / Target Progression (`تطوير الهدف` — IN MVP SCOPE):**
    - Actions must support evolving targets over time under the **same stable action identity** (e.g., `ورد قراءة القرآن` evolving from `10 صفحات` → `20 صفحة` without splitting into two separate tasks).
    - Historical logs must preserve the exact target that was active on their date, and Analytics/History must clearly highlight the user's progression/growth over time.
12. **Future Agent Automation Integration (`v1.1+` — Deferred from MVP, Shapes Extensibility):**
    - Instead of a token-heavy MCP server (`[REJECTED]`), future versions will expose **Scoped REST Endpoints + Scoped API Key (specific read/write permissions) + a lightweight Agent Skill** so external AI coding/automation agents (Antigravity, Claude Code, Codex running e.g. nightly at 12:00 AM) can inspect logs/rules/progress and write deep qualitative analysis back to the database for display in the app.

### `[REJECTED]` — Explicitly Out of Scope
1. **Google Sheets / Apps Script** as primary database (v1 archived in `_archive_v1_sheets/`).
2. **`ورقة الأوقات`** and **`ورقة الذنوب`** sheets from the reference Excel workbook.
3. **Hosted Multi-Tenant SaaS** in current scope.
4. **Super-App Feature Bloat** (no built-in Qur'an reader, Qibla compass, 99 Names, or Tasbeeh counters that dilute `<3s` street logging focus).
5. **Naive Binary Streaks & Heavy Cold-Start Analytics in MVP** (no brittle streak-resets-to-0 guilt spirals, XP gamification, or N×N automated correlations requiring 60–90+ days of data).
6. **Heavy MCP Server for AI Insights** (replaced by Scoped REST Endpoints + Scoped API Key + Thin Skill in `v1.1+` to avoid token burn).

### `[PROPOSED]` — Missing Phase 1 Discoveries (From Hydrogen Swarm Audit)
1. **Open-Source Readiness & Privacy:**
   - Separate a **Generic Islamic Starter Pack** from the author's personal habits (`شغل`, `كلية`, `حضور دروس العلم`).
   - Scrub personal archive artifacts (`_archive_v1_sheets/docs/extracted_seed.json`, `seedData.json`, private names) before public GitHub release.
   - Require a **Single-Owner Auth Lock** so strangers cannot sign up on a self-hosted friend's public deployment URL.
   - Make coordinates/city preset, prayer calculation & Asr madhhab method, week-start day, and Day-Rollover configurable (not hardcoded to Cairo).
   - Warn and guard against guessable public `ntfy.sh/<topic>` URLs (treat topic slug as a bearer secret or self-host `ntfy`).
2. **Offline-First PWA, Auth & `ntfy` Realities:**
   - **Zero-API Local Prayer Windows:** Both the offline PWA and server `ntfy` cron must compute prayer windows locally from saved coordinates + explicit IANA timezone (surviving Egypt/local DST transitions, device clock drift, and denied GPS permission via saved presets).
   - **Two-Device Sync Integrity (Phone Offline + PC Online):** Prevent short-lived JWT expiry from triggering "false logouts" in the street; require **soft-archive** (never hard delete) for actions so queued street taps don't orphan; apply per-cell idempotent replay and deterministic conflict precedence.
   - **iOS Safari Persistence Limits:** Because iOS Safari lacks Background Sync and can purge non-installed Safari storage after ~7 days of inactivity, treat Supabase Cloud as durable source of truth and IndexedDB strictly as cache + outbox—backed by **Add-to-Home-Screen onboarding**, a **visible Unsynced Queue badge**, and a **local JSON export fallback**.
   - **Air-Gapped `ntfy` Honesty:** Server cron cannot see logs made on an offline phone until synced; mitigate via opportunistic immediate flush when signal exists, conservative reminder timing, and non-accusatory wording (*"ignore if already logged offline"*).
3. **Weakness Analytics Refinement (`MVP v1` vs `v1.1`):**
   - **Prevent Window Pollution:** Strictly isolate **7 Time-Bound Prayer Windows** from **Left-Side All-Day/Friday Groups** in metrics (never fall back all-day habits into `العشاء` analytics).
   - **Separate 3 Accountability Buckets:** (1) Recoverable Qadaa Debt, (2) Unlogged `EMPTY` Backlog ("مراكمة الجدول"), and (3) Non-Recoverable Core Misses (`الجماعة الأولى`, `بدون Snoozes`, `التبكير`).
   - **Trimmed Lean MVP Insights (3 modules):** (a) *Top 3–5 Weak Spots* (rolling consistency ignoring `EMPTY` and disabled/excused cells), (b) *7-Window vs Left-Group Breakdown*, and (c) *Qadaa & Backlog Pulse*. Defer *Weekday Slump Matrix* and *Keystone Anchor Comparisons* (`بدون Snoozes` / `ملئ الجدول`) to `v1.1` once ≥14–30 real days exist.

### `[RESOLVED]` — Gate 1 Sign-Off Record (2026-11-20)
- **User Statement:** Confirmed all 3 recommendations (Hosting, Arabic + i18n-ready dictionary, 3 lean MVP insights), added **Action Target Progression** (`تطوير الهدف`) and **`v1.1+` Scoped REST API + Scoped API Key + Thin Skill** (rejecting MCP), and explicitly authorized advancing to **Phase 2 (Requirements & Business Rules)**.
- **Approved Classification & Roadmap:** Section 2 (`Production Application / MVP` + `Focused with targeted Standard rigor on Sync/Auth/Domain` + `Concurrency/Idempotency` Full Active) and Section 3 (`Stage 4 → Full Targeted`, `Stage 8 → Real-Device Offline Conflict & Fresh-Clone OSS Smoke Test`) are now **APPROVED**.

---

## 2. Proposed 3-Dimensional Project Classification (Updated After Swarm Audit)

| Dimension | Proposed Level | Rationale & Reconsideration Triggers |
| :--- | :--- | :--- |
| **A. Delivery Intent** | **Production Application / MVP** *(Personal long-lived app + Open-Source self-hostable project)* | Daily personal production use backed by Supabase Cloud, structured cleanly so developer friends can clone and self-host in `<5 min`. *Revisit if expanded into a hosted multi-tenant SaaS.* |
| **B. Engineering Rigor** | **`Focused` overall, with targeted `Standard`-level rigor on Sync, Auth & Domain Core** | Avoids enterprise ceremony on CRUD/analytics UI while enforcing `Standard`-grade determinism and tests on offline outbox idempotency, conflict rules, soft-archiving, offline-safe auth + single-owner lock, and local prayer/rollover math. *Upgrades to full `Standard` if multi-user accounts are added later.* |
| **C. Risk Overlays** | 1. `Concurrency / Idempotency` — **ACTIVE (Full)** *(upgraded from lightweight)*<br>2. `Availability / Recovery` — **ACTIVE (Expanded)**<br>3. `Sensitive / Personal Data` — **ACTIVE (Expanded)**<br>4. `External Dependencies` — **ACTIVE (Expanded)**<br>5. `Public API / Webhooks` — **ACTIVE (Lightweight)**<br>6. `Multi-tenant isolation` — **Inactive** *(single-owner per instance)*<br>7. `Financial correctness` — **Inactive** | 1. Offline Phone PWA + Online PC edits + flaky street 4G require idempotent cell queuing, conflict rules, and soft-archive FK safety.<br>2. Client-side IndexedDB outbox durability (Unsynced badge, iOS A2HS guidance, local JSON export) + Supabase 7-day auto-pause keep-alive + cloud export.<br>3. Single-owner Auth lock + RLS, zero-secret/scrubbed public OSS repo, private unguessable `ntfy` topics.<br>4. Zero-API deterministic local prayer math (DST/travel resilient), offline JWT grace handling, `ntfy` outage/false-positive tolerance.<br>5. Secret-protected `ntfy`/keep-alive cron endpoint. |

---

## 3. Proposed Adaptive Lifecycle Path (Map of Stages)

| Stage | Proposed Depth | Goal & Exit Gate |
| :--- | :--- | :--- |
| **1. Product Discovery & Classification** *(NOW)* | **Full** | Resolve 3 remaining Phase 1 decisions, lock MVP boundary, and approve 3D Classification + Roadmap. **Gate 1 (Explicit Approval)** |
| **2. Requirements & Business Rules** | **Full** | Lock Day Rollover rule, Qadaa vs Excused/Disabled vs Unlogged semantics, percentage rules, soft-archive constraints, dynamic CRUD behavior, and `ntfy` trigger rules. **Gate 2 (Explicit Approval)** |
| **3. UX / Interface Discovery** | **Full (Mobile-First PWA)** | Validate `<3s` Street Mode (`الآن`), Unsynced Queue badge + Offline UX, Yesterday Catch-up, Qadaa Queue, Weekly PC/Mobile Matrix, 3 Lean Weakness Insights, and Dynamic Settings. **Gate 3 (Explicit Approval)** |
| **4. System Architecture** *(Upgraded)* | **Full (Targeted)** | Explicitly design Offline Auth resilience + Outbox Sync State Machine (Phone offline vs PC online) + Shared Zero-API Prayer/Rollover Engine + Clean Next.js module boundaries + `ntfy`/keep-alive cron placement. **Gate 4 (Explicit Approval)** |
| **5. Data, Interfaces & Security** | **Full (Supabase + OSS)** | Exact PostgreSQL migrations, RLS + Single-Owner Lock, `soft-archive` integrity, Server Actions/API contracts, Generic Starter Pack seed script. **Gate 5 (Explicit Approval)** |
| **6. Implementation Planning** | **Focused** | Sequence into testable vertical slices + OSS hygiene check (repo scrub, `.env.example`, `LICENSE`, docs). **Gate 6 (Explicit Approval)** |
| **7. Implementation + Continuous Verification** | **Full** | Build slice by slice (`READ → PLAN → IMPLEMENT → VERIFY`) with unit tests covering prayer math, rollover, Qadaa, and sync conflict rules. |
| **8. Integrated Quality / Release Verification** | **Full (Targeted)** | Real-device **Airplane-Mode Phone vs Online PC sync conflict test**, iOS/Android PWA cache checks, RLS penetration check, and **fresh-clone OSS self-host smoke test**. |
| **9. Release / Operations** | **Focused** | Deploy live, pair `ntfy` on phone, activate keep-alive cron, scrub/prepare GitHub OSS release. **Explicit Deploy Consent** |
| **10. Feedback & Evolution (`v1.1+`)** | **Continuous** | Collect 2–4 weeks of real usage; evolve Weekday Slump Matrix, Keystone correlations, bilingual UI, or VPS splits based on real evidence. |
