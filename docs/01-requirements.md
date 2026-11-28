# Stage 2: Requirements & Business Rules Specification — Mohasba Tracker v2

**Status:** **GATE 2 APPROVED (2026-11-20)** — Transitioned to Stage 3 (UX / Interface Discovery)  
**Governance Mode:** Strict (No Stage 4/5 Architecture/SQL or Production Code before Stage 3 UX Gate Sign-Off)  
**Last Updated:** 2026-11-20  
**Upstream Reference:** [docs/00-discovery-qa.md](file:///d:/Ahmed/Projects/mohasba/docs/00-discovery-qa.md) *(Gate 1 Approved 2026-11-20)*

---

## 1. Islamic Day Rollover & Time Window Horizon

### 1.1 Rollover Modes (`rollover_mode`)
- **`FAJR` (Proposed Default):** For any instant `t` in the user's configured `iana_timezone`:
  - If `t < FajrInstant(civilDate(t))`, then `accountability_date = civilDate(t) - 1 day`.
  - If `t >= FajrInstant(civilDate(t))`, then `accountability_date = civilDate(t)`.
- **`MIDNIGHT` (Optional Setting for OSS users):** `accountability_date = civilDate(t)` (flips at `00:00`), while cross-midnight periods (`العشاء`, `الليل`) remain loggable for day `D` via Yesterday Catch-Up until `FajrInstant(D + 1)` rather than falsely expiring at `00:01`.

### 1.2 Multi-Day Window Horizon & DST Safety
- **Zero-API Deterministic Parity:** Both the offline PWA and server `ntfy` cron compute identical prayer windows locally from saved coordinates/city preset, calculation method, Asr madhhab, explicit `iana_timezone`, and manual minute offsets—zero runtime external prayer API calls.
- **UTC Epoch Bounds:** Window bounds (`startInstant`, `endInstant`) for `accountability_date = D` always resolve as UTC epoch instants. Cross-midnight windows (`end <= start`, e.g. `العشاء` or custom `الليل`) end at **`FajrInstant(D + 1)`**—never `FajrInstant(D)`—surviving `23h`/`25h` Egypt/local DST transitions with zero drift.
- **Intentional Overlaps:** Overlapping windows (e.g., `الصبح` ending at `Sunrise` while `الصباح` starts at `Sunrise - 30m`, or `العصر` overlapping `المساء`) remain active simultaneously without splitting accountability days.

### 1.3 Acceptance Criteria
- In `FAJR` mode, logging `ركعة وتر` or `أذكار النوم` at `01:20 AM` (Fajr `04:50 AM`) attributes to `D - 1`; `العشاء` of `D - 1` is still `OPEN` and `الصبح` of `D` has not opened.
- At `04:55 AM` (post-Fajr), `accountability_date` flips to `D`; `D - 1`'s `العشاء` transitions to `EXPIRED` and enters 48h Catch-Up if `EMPTY`.

---

## 2. Two-Layer Cell Lifecycle, Percentages & Qadaa Engine

### 2.1 Layer 1 — Effective Cell Availability (`(action_id, accountability_date)`)
- **Precedence:** `explicit_cell_override ?? !default_disabled_days.includes(weekday(D))`.
- **Enabling a Default-Off Cell:** Tapping a grayed-out default-off cell (e.g., voluntary Tuesday fasting or Friday Dhuhr Qabliyah) sets an explicit `ENABLED` override → cell becomes `EMPTY` and enters that day's logging, Qadaa, and Analytics denominator.
- **Disabling an Active Cell (`DISABLED / EXCUSED`):** Marks an excused/N/A day (travel, illness, off-schedule) and removes the cell from Analytics denominators, Backlog, and Qadaa. Disabling a cell that already holds a logged status requires confirmation or triggers immediate 5-second Undo.

### 2.2 Layer 2 — Canonical Log States (When `ENABLED`)
| State | Symbol | Score Weight | Rules & Transitions |
| :--- | :---: | :---: | :--- |
| `EMPTY` *(no record / cleared)* | — | Excluded (`null`) | `PENDING` before window expiry; virtual **`UNLOGGED_EXPIRED`** after `t >= endInstant(window, D)` (surfaces in Backlog; never counted as `MISSED ❌️` in Weakness denominator). |
| `DONE` | `✅` | `1.00` | Completed on time / within day. |
| `MISSED` | `❌️` | `0.00` | Confirmed missed. Enters **Qadaa Queue** **iff** `is_qadaa_eligible = true`. |
| `QADAA_DONE` | `🔘` | `0.85` | Missed originally, made up later. Valid **only** if `is_qadaa_eligible = true`; stamps `qadaa_resolved_at`. |
| `PERCENT` | `1%..99%` | `p / 100` | Valid **only** if `supports_percentage = true`. **Canonicalization:** `100%` normalizes to `DONE (✅)`; `0%` normalizes to `MISSED (❌️)` (entering Qadaa if eligible); `1%..99%` stays `PERCENT` without creating Qadaa debt. Street Mode offers `25/50/75/100/0%` chips; Detailed/PC supports `10%` steps. |

- **Forbidden Transitions:** `ANY → QADAA_DONE` when `is_qadaa_eligible = false`; `ANY → PERCENT(1..99)` when `supports_percentage = false`.
- **Reversibility:** Any valid state may transition back to any other valid state for Undo or correction; leaving `QADAA_DONE` clears `qadaa_resolved_at`.

### 2.3 Cross-Week Global Qadaa Engine
- **Scope:** Qadaa Queue spans **all dates `<= today`** across unlimited weeks/months until resolved.
- **Non-Recoverable Exclusion:** Items with `is_qadaa_eligible = false` (e.g., `الجماعة الأولى`, `ملئ جدول المحاسبة`, `بدون Snoozes`, `التبكير`, `غض البصر`, situational daily sunan) never clutter Qadaa Debt.
- **Historical Repair Attribution:** Resolving a miss from Week `N - 1` during Week `N` updates the **original `(action_id, original_log_date)`** cell to `QADAA_DONE (🔘)` and stamps `qadaa_resolved_at = now()`, repairing Week `N - 1`'s record while crediting Week `N`'s Qadaa clearance velocity.

---

## 3. Action Target Evolution (`تطوير الهدف` — MVP Scope)

### 3.1 Simple Rename vs. Target Evolution
- **Simple Rename (`تعديل الاسم فقط`):** Edits `title` or `icon` for typos/clarity without creating a new version, milestone trail, or analytics grace period.
- **Target Evolution (`تطوير الهدف`):** Appends a **Target Version** under the **same stable `action_id`** (never splitting into a second task):
  - Fields: `effective_from` (`accountability_date`), `target_label` (e.g., `"20 صفحة"`, `"30 دقيقة"`, `"سورة الملك + السجدة"`), optional structured `target_value` + `target_unit`, and `direction` (`level_up` | `step_down` | `adjustment`).
  - **Optional/Null Support:** Pure binary/qualitative habits (`الجماعة الأولى`, `بدون Snoozes`) keep `target_versions` empty (`null`) with zero configuration noise.
  - **Bidirectional Progression:** Supports both level-ups (`10 → 20 صفحة`) and temporary step-downs (`20 → 10 صفحات` during exams/travel, then back up).
  - **Uniqueness & Immutability:** At most one Target Version per `(action_id, effective_from)`. A Target Version is editable **only while zero logs reference it**; once referenced by any log, it becomes **immutable** (future changes append a new version).

### 3.2 Same-Day Upgrade Rule, Historical Honesty & Cross-Upgrade Qadaa
- **Same-Day Default:** When upgrading a target, `effective_from` defaults to **`today (D)`** if today's cell is `EMPTY`, or **`tomorrow (D + 1)`** if today already has a non-empty log (protecting today's earned `DONE ✅` under the old target, with explicit override allowed if intentional).
- **Historical Snapshot Invariant:** Every log records/resolves the exact Target Version active when logged (`target_version_id`). Past logs (`10 صفحات ✅`) are **never** retroactively displayed as `20 صفحة ✅`.
- **Cross-Upgrade Qadaa Fairness:** If `ورد القرآن` was `MISSED ❌️` on Day `D` under `10 صفحات`, upgraded to `20 صفحة` on `D + 2`, and resolved to `QADAA_DONE 🔘` on `D + 3`, the Qadaa Queue displays and resolves **Day `D`'s original target (`10 صفحات`)**—never retroactively demanding `20 صفحة` for past debt.
- **Percentage Continuity:** `PERCENT` on Day `D` always scores relative to Day `D`'s active target (`50%` of `10 صفحات` = 5 pages; `50%` of `20 صفحة` = 10 pages; both score `0.50` under the same continuous action).
- **Zero Street Friction:** Street Mode displays only the active `target_label` inline (e.g., `ورد قراءة القرآن — 20 صفحة`) with zero extra taps or version pickers.

---

## 4. Street Mode (`<3s`), Bulk Catch-Up & Dynamic Schema Flows

### 4.1 `<3s` Street Post-Prayer Flow (`الآن / الشارع`)
- Opens directly to the currently active local prayer window (`<= 50 ms` local IndexedDB write + optimistic UI), showing only active enabled items (`active_from <= today`, not archived, not disabled). Includes manual switcher for earlier windows of the current Islamic day.
- **Mosque vs. Home Split Quick-Actions (Strictly Non-Overwriting):**
  - **`تم ما في المسجد`:** Marks `DONE ✅` **only** on `EMPTY` enabled items in the current window where `is_mosque_action = true` AND `supports_percentage = false` (e.g., `الجماعة الأولى`, `أذكار بعد الصلاة`, mosque-prayed `السنة القبلية`). **Explicitly excludes** Left-side multi-prayer mosque habits (`المشي إلى المسجد`, `المسجد دخول وخروج`) so Fajr never marks an all-day habit `100%`, and **excludes** `ملئ جدول المحاسبة`.
  - **`تم الفترة بالكامل`:** Marks all remaining `EMPTY` enabled Right-side items in the current window as `DONE ✅` (including `100%` for Right-side percentage items and `ملئ جدول المحاسبة` if in that period).
  - **Non-Overwrite Invariant:** Neither bulk button ever overwrites an existing `✅ / ❌️ / 🔘 / % / DISABLED` cell. Disabled/no-op when 0 eligible `EMPTY` items remain.
- **`ملئ جدول المحاسبة` (`الظهر` / `العشاء`):** Proposed as **manual explicit check** (also marked by `تم الفترة بالكامل`, excluded from `تم ما في المسجد`), preventing false credit when logging only one prayer in the street.
- **5-Second Undo:** Triggered on bulk actions and destructive overrides (e.g., disabling a logged cell). Writes immediately to IndexedDB (`<= 50 ms`) while holding **network upload** for 5 seconds (canceled cleanly on Undo; flushed immediately to sync queue on `visibilitychange`/`pagehide`; post-flush Undo enqueues a compensating revert restoring the exact prior snapshot).

### 4.2 48-Hour Quick Catch-Up & Multi-Day Weekly Matrix
- **Yesterday + Today (48h) Catch-Up Banner:** Surfaces at the top of Street Mode **only** when yesterday or earlier expired windows of today have `>= 1` enabled `EMPTY` cells, opening an "Unlogged Only" sequential card flow.
- **Weekly Matrix Bulk Actions:**
  - **`يوم اعتيادي`:** Fills only `EMPTY` enabled cells for a chosen day using per-action `include_in_normal_day_preset` (defaulting **`false`** for high-consequence core habits like `الجماعة الأولى`, `بدون Snoozes`, and `التبكير` so Fard/core items are never auto-greened). Shows count preview + 5s Undo.
  - **`ترحيل للقضاء`:** Converts **only** already-expired `EMPTY` enabled cells into `MISSED ❌️` (auto-queuing Qadaa-eligible items; no-op with message when 0 expired `EMPTY` cells exist).

### 4.3 Dynamic Schema CRUD, Soft-Archive & Open-Source Packaging
- **Online-Only Settings CRUD:** Creating, editing, reordering, moving, archiving periods/actions, and creating Target Versions require an online connection (eliminates offline structural conflict graphs with zero impact on street logging).
- **Soft-Archive Honesty & Smart 2-Tier Permanent Delete (`active_from`, `archived_at`) *(Post-Gate Amendment 2026-11-27)*:** Soft-archive remains the recommended default for any item with logged history (dates `< active_from` excluded from denominators; dates `> archived_at` hidden from future logging/Qadaa while historical weeks stay readable). In addition, Settings now supports **Smart 2-Tier Permanent Delete (`DELETE /api/periods/[id]` & `DELETE /api/actions/[id]`)**:
  - **0 logged rows (and 0 children for periods):** Permanently deleted immediately (`200 OK`) for effortless cleanup.
  - **Has child actions or logged history (`> 0` `daily_logs`):** Server returns `409` (`HAS_CHILDREN` / `HAS_HISTORY`) with exact database counts; UI opens a native `<dialog>` focusing **"أرشفة (يحفظ تاريخك)"** (or `إلغاء`) as the safe default and requiring explicit confirmation (`?force=true`) to permanently delete logs/children. Moving an action across periods preserves its stable `action_id` and historical logs. Toggling `is_qadaa_eligible` from `true → false` warns how many open Qadaa items will leave the queue.
- **Custom Periods & Optional Left-Side Binding:** Custom Right-side periods (e.g., `الليل`) define prayer-relative boundaries (with optional fixed-clock fallback). Left-side open habits may optionally set `bound_time_period` to surface in Street Mode under a secondary *"عادات مرتبطة بهذه الفترة"* sub-list and follow that window's expiry/reminder, while **always staying inside Left-side Group Analytics** and excluded from `تم ما في المسجد`.
- **3-Level Interactive Onboarding Templates, Non-Destructive Level-Up Merge, Safe Workspace Reset & i18n Dictionary *(Post-Gate Amendments 2026-11-27 → 2026-11-28)*:** Public repo ships **3 official tiered Islamic accountability templates** (`src/domain/templates.ts`: **Level 1** `التأسيس — سنة ١` with 41 actions, **Level 2** `المتوسط — سنة ٢ و ٣` with 61 actions, **Level 3** `المتقدم الشامل` with 118 actions — numeric weights deferred to `v1.1+`) plus legacy `starter_pack` API compatibility, Blank mode, and JSON Import. First-run onboarding is a **2-step wizard**: (1) pick a level with a live interactive Preview (uncheck any period/action, view smart default badges for mosque/Qadaa/%/cadence/target, and 1-line inline quick-add), and (2) quick global settings (city, calculation method, rollover, and a single global `ntfy` switch covering all `TIME_BOUND` periods). Post-onboarding, `Settings → النسخ الاحتياطي والبيانات` provides **Non-Destructive Template Merge (`POST /api/bootstrap/merge-template` + `planTemplateMerge`)** to level up or add net-new habits from any of the 3 templates into existing periods with zero duplicates and zero history loss, AND **Safe Workspace Reset (`POST /api/bootstrap/reset`)** with a 1-click JSON backup step + typed confirmation (`تصفير`) that wipes schedule/log tables while preserving city, rollover, `ntfy`, and shortcut settings and returning cleanly to the 3-Level Onboarding Wizard. All static UI/notification copy lives in semantic dictionary keys (`ar` in MVP v1, ready for `en` later).

---

## 5. Deterministic MVP Analytics (3 Lean Insights + Progression)

For any enabled active cell (`D >= action.active_from`, before `archived_at`) with a **logged** status:  
`score(a, D) = { DONE: 1.0, QADAA_DONE: 0.85, PERCENT(p): p/100, MISSED: 0.0 }`. `EMPTY` & `DISABLED` are excluded (`null`).

1. **Insight 1 — Top 3–5 Weakest Spots (`نقاط الضعف الحالية`):**
   - Lookback: rolling **30 logical days** `[today - 29, today]`.
   - Cold-Start Guard: require `logged_count >= 5` (or `>= 2` for actions active `<= 2 days/week`, e.g., `الصيام`, `وظائف الجمعة`).
   - **Post-Upgrade Adaptation Guard (`هدف جديد`):** When a newly added Target Version begins (unless explicitly marked `step_down`), suppress ranking the action as a Weak Spot or negative trend (`↓`) for up to **7 days / until `>= 5` logged days** accumulate under the new target—labeling it `"هدف جديد"` instead.
   - Ranking: filter `consistency_30d < 85%`, sort ascending (tie-break: higher `MISSED` count, then non-recoverable core habits first).
   - **Compact Progression Trail (No 4th Tab):** Any action with `>= 2` target versions displays an inline milestone trail (`10 صفحات ← 20 صفحة` + `effective_from` + pre/post consistency % once both versions have `>= 5` logged days).
2. **Insight 2 — 7-Window vs. Left-Group Breakdown (`الفترات مقابل المجموعات`):**
   - **Strict Side Isolation:** `TIME_BOUND` windows and `DAILY_GROUP` groups never mix (preventing Left-side habits from polluting `العشاء`).
   - Selectable `7d` (default) or `30d` metrics: `weighted_rate`, `on_time_rate`, `qadaa_rate`, `missed_rate`. Inside prayer windows, **Core Jamaah (`الجماعة الأولى`)** is reported separately from **Sunan/Adhkar**.
3. **Insight 3 — Qadaa & Backlog Pulse (`نبض القضاء والتراكم`):**
   - **Bucket A (Recoverable Qadaa):** `open_qadaa` across all history, `oldest_age_days`, 7-day `+added / -cleared / net_velocity`.
   - **Bucket B (Logging Backlog — Anti-`مراكمة`):** `unlogged_expired_7d` + `logging_coverage_7d %`.
   - **Bucket C (Non-Recoverable Core Misses):** `core_misses_7d` (`الجماعة الأولى`, `بدون Snoozes`, `التبكير`, `ملئ الجدول`).

---

## 6. Offline Phone PWA vs. Online PC Sync, Durability & Recovery

### 6.1 Deterministic Conflict Precedence (`(action_id, log_date)`)
Every queued mutation carries `mutation_id` (client UUID), `client_updated_at`, `base_updated_at`, and `client_target_version_id`. Re-sending an already-applied `mutation_id` is a strict `200 OK` no-op; repeated offline taps on the same cell coalesce locally before flush.

- **Non-Conflicting (`server_updated_at == base_updated_at`):** Accepted directly.
- **Concurrent Conflict (`server_updated_at > base_updated_at`):**
  1. **Positive/Intentional beats `MISSED ❌️`:** `DONE ✅`, `QADAA_DONE 🔘`, `PERCENT > 0%`, or `DISABLED/EXCUSED` **always beat** concurrent `MISSED ❌️` (prevents PC bulk backlog marks from erasing unsynced street prayers).
  2. **Positive vs. Positive** (`DONE` vs `QADAA_DONE`, `PERCENT` vs `PERCENT`, `DISABLED` vs `DONE`) or **Explicit Clear (`EMPTY`) vs. Any:** Newer `client_updated_at` wins.
  3. **`note` Field:** Evaluated independently via `client_updated_at` LWW.
- **Replay Across Soft-Archive & Target Evolution:**
  - Logs key by `(action_id, log_date)` (immune to period moves/reordering) and replay cleanly onto soft-archived actions (`log_date <= archived_at`).
  - Offline Phone stamps `client_target_version_id` from its cached active version for `log_date`. If PC upgraded the target effective `Day D` while Phone logged `Day D` offline under the prior target, replay **must succeed** and **retain `client_target_version_id`** (server validates only that the version belongs to `action_id`).

### 6.2 Durability, iOS Safari Protection & JSON Export/Import
- **4-State Sync Visibility Badge:** Always exposes `Synced`, `Syncing`, `Offline / Queued (N)`, or `Sync Attention Needed` (never silently discards queued logs).
- **iOS Protection:** When `!standalone && iOS`, display an **"Add to Home Screen"** notice explaining Safari's 7-day tab purge and lack of Background Sync. Call `navigator.storage.persist()` where supported; treat Supabase Cloud as durable truth and IndexedDB as cache + outbox.
- **Single Idempotent Merge JSON Export/Import:** Support offline-capable **Full Snapshot Export** + **Emergency Outbox Export**. Import restores `target_versions` *before* `daily_logs` (matching by `version_id` UUID then `(action_id, effective_from)`), validates cross-action references, and merges logs via the conflict rules above without duplicates.

---

## 7. Security, Single-Owner Auth & `ntfy` / Keep-Alive Rules

### 7.1 Single-Owner Auth & Offline Street Grace
- **Owner-Only Lock:** Only configured `OWNER_EMAIL` (case-insensitive) may authenticate; any stranger login/signup receives `403 Owner-Only Instance` and public signups are disabled after owner bootstrap.
- **Offline Expired-JWT Grace Mode:** Launching offline with an expired short-lived JWT **never** redirects to `/login` or wipes IndexedDB—street logging continues normally into the local outbox. On reconnect, session refresh runs *before* queue drain; on refresh failure (`401`), drain pauses cleanly (preserving all pending mutations) until the same owner re-authenticates. Explicit Sign Out warns if `unsynced_count > 0` and offers Emergency JSON Export first.
- **Secret Isolation:** `CRON_SECRET`, `SERVICE_ROLE_KEY`, and private `ntfy` topic URLs are strictly server-only (never `NEXT_PUBLIC_*`). Cron routes verify constant-time `CRON_SECRET` (`401` on mismatch).

### 7.2 Smart `ntfy` Reminders & Supabase Keep-Alive
- **Customizable Cadence & Suppression (Per Gate 2 Condition):**
  - Fully customizable from in-app Settings: master toggle, **per-period reminder toggle** (enable/disable individual prayers/periods), configurable **trigger mode & lead/offset time** (e.g., pre-expiry lead-time default **25m before end**, or optional post-start nudge e.g. `+20m` after Adhan), customizable **Quiet Hours** (`start`–`end`), and **Nightly Backlog Digest** toggle + configurable time.
  - Hard safety cap: max 1 reminder per `(period_id, islamic_date, reminder_kind)` + 1 Nightly Backlog Digest per day. Suppressed server-side if 0 active enabled items exist, all are already logged on server, or already dispatched.
- **Offline-Aware Copy & Deep-Link:** Honest non-accusatory Arabic wording (*"اقترب انتهاء وقت [الفترة] — تذكير بالمحاسبة (تجاهله إن كنت قد سجلت دون إنترنت)"*), deep-linking straight to `(period_id, islamic_date)` and triggering foreground reconciliation without overwriting newer offline taps. 5s HTTP timeout, no retry storms, high-entropy/private `ntfy` topic.
- **Supabase Keep-Alive:** Scheduled read-only DB ping every **3 days** (safely inside 7-day free-tier inactivity pause).

---

## 8. Future `v1.1+` Extensibility: Scoped REST API + Scoped API Key + Thin Skill (Replacing MCP)

> **MVP v1 Boundary:** MVP v1 ships **zero** `/api/agent/*` routes, API-key management UI, or `ai_insights` runtime dependency. Stage 2 locks these semantic & security invariants now so `v1.1+` plugs in with zero rewrites.

- **Semantic Read Contract (`agent:read`):** Exposes active rules (`rollover_mode`, `iana_timezone`, `week_start_day`), periods/actions (with `period_side`, `is_qadaa_eligible`, `supports_percentage`, `default_disabled_days`, full `target_versions`), bounded `daily_logs` (with `target_version_id`), and **pre-computed Insight 1/2/3 + Target Progression deltas** (minimizing tokens and preventing AI math hallucinations).
- **Thin Skill Rules:** Instructs external agents (Antigravity, Claude Code, Codex) never to classify `EMPTY_EXPIRED` or `DISABLED` as `MISSED ❌️`, never to merge `DAILY_GROUP` into `العشاء`, and always to check `target_versions` before labeling a post-upgrade dip a regression.
- **Least-Privilege Write-Back & Key Isolation (`agent:insights:write`):** `AGENT_API_KEY` is strictly isolated from `CRON_SECRET` and owner sessions (stored hashed, constant-time verified, shown once, instantly revocable, never in `NEXT_PUBLIC_*` or exports). Permits **read-only** on logs/rules/aggregates and **write-only** on `ai_insights` (idempotent upsert by `(insight_date, horizon, insight_type)` with `model_id` / `key_id` audit metadata); hard **`403`** on mutating `daily_logs`, `actions`, `target_versions`, `periods`, `settings`, or `ntfy`/auth secrets.

---

## 9. Gate 2 Sign-Off Record (APPROVED — 2026-11-20)

All 6 business-rule decisions were explicitly approved by the user on **2026-11-20** (with expanded in-app customization added to Decision #6 `ntfy` reminders):
1. **Day Rollover (`FAJR` vs `MIDNIGHT`):** **APPROVED** — `FAJR` default, `MIDNIGHT` toggleable in Settings.
2. **Partial Percentage (`1%..99%`) & Qadaa:** **APPROVED** — `100% → ✅`, `0% → ❌️` (Qadaa if eligible), `1%..99%` stays `PERCENT` (affects Weakness score only; street `25/50/75/100/0%` chips, detailed `10%` steps).
3. **`ملئ جدول المحاسبة` (`الظهر` / `العشاء`):** **APPROVED** — Manual explicit check (also marked by `تم الفترة بالكامل`, excluded from `تم ما في المسجد`).
4. **Offline Conflict Precedence & Online-Only Settings CRUD:** **APPROVED** — Positive-beats-`MISSED` + Online-Only Settings/Target CRUD (with offline `client_target_version_id` snapshotting).
5. **Action Target Evolution (`تطوير الهدف`):** **APPROVED** — Append-only immutable referenced Target Versions, same-day defaults to `D + 1` if today already logged, Cross-Upgrade Qadaa resolves Day `D`'s original target, and 7-day / 5-log `"هدف جديد"` adaptation guard.
6. **`ntfy` Reminder Cadence:** **APPROVED (with condition)** — Pre-expiry reminder + optional Nightly Backlog Digest, made **richly customizable in-app** (per-period toggles, lead/offset minutes, Quiet Hours, digest time).

**Authorized Next Stage:** Stage 3 — UX / Interface Discovery (visual direction, mobile-first + desktop parity layouts, interaction flows, and optional clickable mock/wireframe).
