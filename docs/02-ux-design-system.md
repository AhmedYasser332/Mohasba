# Stage 3: UX & Design System Specification — Mohasba Tracker v2

**Status:** **GATE 3 APPROVED (2026-11-20)** — Transitioned to Stage 4 (System Architecture), with Section 6 polish conditions locked for Stage 7 Production UI  
**Governance Mode:** Strict (Exploratory static HTML mock only; zero production Next.js/Supabase code until Gate 3–6 approval)  
**Design Mode:** **Operate Mode** (`/impeccable` `operate.md` + `/frontend-design` anti-slop discipline)  
**Last Updated:** 2026-11-20  
**Upstream Reference:** [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md) *(Gate 2 Approved 2026-11-20)*  
**Anti-AI-Slop Standards & Checklist:** [docs/02b-anti-ai-slop-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/02b-anti-ai-slop-guide.md)

---

## 1. Visual World & Anti-AI-Slop Manifesto

**Visual World:** *"Al-Mizan Al-Ma'dani"* (Architectural Mineral Ledger in Daylight / Nocturnal Basalt at Fajr).

Mohasba Tracker v2 is lived in two physical realities: **bright outdoor daylight** walking out of the mosque (`<3s` one-thumb logging) and **dark bedroom stillness** at Fajr and Witr/Isha, paired with a **50-action weekly ledger** on desktop.

### Explicit Anti-Slop Bans
- **Zero Wave-1 SaaS Slop:** No purple/indigo gradients, no neon dark-mode glows, no `backdrop-blur` glass cards, no uniform `rounded-2xl shadow-sm` bento grids ("Card Hell").
- **Zero Wave-2 AI Slop:** No `#F4F1EA` / `#F7F6F2` warm cream/beige backgrounds, no terracotta (`#D97757`), no ALL-CAPS tracked eyebrows/kickers above headings, no middle-dot (`·`) metadata strings, no spaced em-dash titles, no trailing `→` arrows on buttons.
- **Zero Ornamental Clutter:** No decorative Islamic arches/arabesques, no raw Unicode emojis (`✅`, `❌️`, `🔘`, `🕌`, `✨`, `🔥`) standing in for an icon system, no colored `border-left`/`border-right` strips > `1px`, no resting drop shadows on cards/lists, no staggered page-load animations.
- **Zero Audio / Music:** Strictly silent UI (respects user's zero-music religious audio constraint).

---

## 2. Verified Design Tokens (Light & Dark, WCAG AA+)

### 2.1 Core Surfaces, Borders & Ink
| Token | Light Mode (Daylight Street & PC) | Dark Mode (Dimmed Graphite Comfort) | Role |
| :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#F3F5F6` *(Cool Mineral Chalk)* | `#16181C` *(Dimmed Graphite Charcoal)* | Outer page canvas (zero yellow/beige warmth; softer night luminance) |
| `--bg-surface` | `#FFFFFF` *(Crisp Ledger Sheet)* | `#1D2026` *(Calm Night Slate)* | Action rows, grouped table body, active containers |
| `--bg-subtle` | `#E9EDF0` *(Muted Alabaster)* | `#242830` *(Muted Header Bar)* | Sticky table headers, collapsible group bars, secondary controls |
| `--border-hairline` | `#D5DCE1` | `#2A2F38` | `1px` soft structural dividers (prevents dark-mode grid lattice fatigue) |
| `--ink-primary` | `#11161A` *(18.21:1 on `#FFF`)* | `#D6DCE2` *(~10.5:1 on surface)* | Softened alabaster text in dark mode to eliminate Fajr eye halation |
| `--ink-secondary` | `#526068` *(6.50:1 on `#FFF`)* | `#8E98A4` *(5.5:1 on surface)* | Counts, schedules, timestamps, inactive navigation |
| `--accent-live` | `#0F5257` *(Aegean Petrol, 8.88:1)* | `#58A4AA` *(Deep `#1E5B60` on dark solid CTAs)* | Reserved strictly for active prayer window, Horizon Rail, and focus rings |

### 2.2 5-State + Unlogged Semantic Tokens (Shape + Border + ~10% Tint, Never Color-Alone)
Every state pairs a uniform `1.5px` stroke SVG glyph with a `1px` border and subtle tint so bright sunlight and color vision deficiency never break readability:

| Canonical State | SVG Glyph | Light (`ink` / `fill` / `border`) | Dark (`ink` / `fill` / `border`) | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `DONE` (`1.00`) | Crisp Check | `#1A6B4B` / `#E7F3ED` / `#B7DEC9` | `#5EB38A` / `#172B23` / `#2A4F3E` | Cedar Pine (`5.68:1` L / `5.90:1` D) |
| `MISSED` (`0.00`) | Crisp Cross | `#A8383B` / `#F9EBEB` / `#E8C1C2` | `#D47476` / `#2D1B1D` / `#573134` | Muted Carmine (`5.50:1` L / `5.10:1` D) |
| `QADAA_DONE` (`0.85`) | Return Arc | `#295985` / `#EBF2F8` / `#BDD2E5` | `#6FA0CC` / `#182533` / `#2E4A66` | Steel Cobalt (`6.50:1` L / `5.61:1` D — zero purple) |
| `PERCENT` (`1–99%`) | `tabular-nums` + `3px` bottom bar | `#9A5B13` / `#FBF2E6` / `#E5CCA8` | `#D19A4B` / `#2B2216` / `#594426` | Harvest Ochre (`4.88:1` L / `6.28:1` D). `#FBF2E6` banned from page/banner surfaces; bar sits at bottom edge, never behind numerals |
| `DISABLED` (`EXCUSED`) | Centered Dash | `#6B7680` / `#ECEFF1` / `#D5DCE1` | `#6E7A84` / `#151A1E` / `#242D34` | Excluded from denominators & Qadaa |
| `PENDING` (`EMPTY` open) | Empty Frame | `#6B7680` / `transparent` / `1px dashed #B8C2C9` | `#7E8B96` / `transparent` / `1px dashed #38444E` | Open window awaiting entry |
| `UNLOGGED_EXPIRED` | Dashed Alert Ring | `#855D25` / `rgba(181,137,74,0.08)` / `1px dashed #B5894A` | `#C99D5B` / `rgba(138,106,59,0.12)` / `1px dashed #8A6A3B` | Distinct from `MISSED` red; signals backlog catch-up |

---

## 3. Typography, Hierarchy, Radius & Motion

- **Single Workhorse Font:** **`Readex Pro`** (`400`, `500`, `600`, `700`) across all headings, controls, and 50-row tables.
- **Numerals:** `font-variant-numeric: tabular-nums` enforced on all percentages, 7-day counts, prayer countdowns, and Qadaa ages.
- **Clock & Countdown Format (Post-Gate Amendment 2026-11-26):** All displayed period clock times use **12-hour `h:mm AM/PM`** (e.g. `6:44 AM - 11:33 AM`, rendered inside an LTR span). The active period's remaining time in `الآن` is a **live descending countdown** `باقي H:MM` (1s tick); tapping it toggles `H:MM:SS` and the choice persists per device (`localStorage` key `mohasba.countdown.showSeconds`).
- **Matrix Hover Crosshair (Post-Gate Amendment 2026-11-27):** Row/column hover & keyboard-focus highlight uses a dedicated GPU-composited overlay stage (`TableCrosshairStage` + `CrosshairCoordinator` with `.crosshair-row-bar`, `.crosshair-col-bar`, sticky `.crosshair-head-bar`, and `2px` `.crosshair-head-line` sized in real CSS pixels for Windows `125%/150%` DPI-scaling precision and translated strictly via `transform: translate3d()` + `opacity` — zero `:has()` ancestor style invalidation, zero per-cell background repaints, and zero React re-renders on pointer move). Fully user-customizable per device in Settings (`التفضيلات والعرض العام`, stored in `localStorage` `mohasba.crosshair.prefs` with live mini preview): mode (`both` / `row` / `col` / `off`), opacity strength slider (`20%`–`220%`), motion (`smooth` `68ms` GPU glide under `@media (prefers-reduced-motion: no-preference)` vs `instant` `0ms`), header indicator toggle, focus-fallback toggle, and One-Glance period-column extension toggle.
- **Scrollbars & Zero-Scroll One-Glance Panels (Post-Gate Amendment 2026-11-26):** Global sleek theme-aware scrollbars (`scrollbar-width: thin`, `6px` rounded `::-webkit-scrollbar` on transparent tracks using `--border-strong` / `--ink-muted`) replace clunky OS defaults, while `.overview-split .ledger-table-wrap` uses `overflow: clip` with clamped `.m-fill-handle` geometry so both One-Glance panels render with zero spurious vertical or horizontal scrollbars at `1440×900`.
- **Fixed `rem` Scale (No fluid `clamp()`):**
  - `0.75rem` (12px / 1.35): matrix column headers, `"هدف جديد"` chip, sync status, countdowns
  - `0.8125rem` (13px / 1.45): 50-row PC matrix titles & percentage chips (`36px` row height)
  - `0.9375rem` (15px / 1.45): mobile street action titles (`52px+` row height, `44px × 44px` tap targets)
  - `1.0625rem` (17px / 1.35): active prayer window heading, collapsible section headers
  - `1.25rem` (20px / 1.25): screen titles & Analytics KPI numerals
- **Hierarchical Border Radius:**
  - `2px`: matrix cells & inline state badges
  - `6px`: inline `✓/✕` buttons, quick-actions, inputs, day strip tiles
  - `8px`: collapsible containers, `<dialog>` drawers, 5s Undo toast
  - `9999px`: **strictly quarantined** to the `6px` WHOOP 7-day history dots
- **Elevation Discipline:** Zero resting drop shadows. Transient overlays (`5s Undo` toast, `<dialog>` cell editor, modals) use `0 6px 20px rgba(17, 22, 26, 0.14)` (Light) / `0 8px 24px rgba(0, 0, 0, 0.5)` (Dark).
- **Motion:** `150–180ms` ease-out on state changes ONLY; zero page-load staggered animations; respects `@media (prefers-reduced-motion: reduce)`.
- **Browser Surfaces:** Custom-themed `::selection`, `caret-color`, `:focus-visible` (`2px solid var(--accent-live)` with `2px` offset), `text-underline-offset`, and clean scrollbars.
- **RTL Logical Properties Only:** `dir="rtl"`, `margin-inline-*`, `padding-inline-*`, `inset-inline-*`, `text-align: start/end` throughout.

---

## 4. Signature Craft Detail

**«شريط أفق الفترة الموقوت» (The Time-Window Horizon Rail):**  
A `2px` hairline integrated directly into the bottom border of the active prayer window header (Street Mode) and active period bar (Desktop Matrix). It visualizes elapsed astronomical time (`startInstant → endInstant`) in quiet Aegean Petrol (`#0F5257` / `#5BA4AA`), shifting smoothly to Harvest Ochre (`#9A5B13` / `#D19A4B`) **only inside the final 25 minutes** before window expiry—matching the default pre-expiry `ntfy` threshold with zero visual clutter.

---

## 5. Dual Desktop (`1440px`) & Mobile (`360–420px`) Shell & 5-Screen IA

| Breakpoint | Navigation Shell | Primary Ergonomic Goal |
| :--- | :--- | :--- |
| **Mobile (`< 1024px`, verified at `390px`)** | Compact top bar (`48px`) + Fixed bottom navigation bar (`5` tabs, `44px+` touch targets, zero horizontal overflow) | One-thumb `<3s` street logging right outside the mosque |
| **Desktop (`>= 1024px`, verified at `1440px`)** | Collapsible RTL inline-start rail (`228px` ↔ `0px`, keyboard layout-independent physical shortcut `Ctrl + KeyI` / `Ctrl + I` / `Ctrl + ه` with hover tooltip) + Full-width ledger workspace | High-density 50-row weekly overview, one-glance zero-scroll sheet mode, keyboard navigation |

### The 5 Screens (All Implemented Interactively in `docs/prototype/index.html`)
1. **`الآن` (`Street Quick-Log`):** 7-day strip (`Joi`), period selector, active prayer header with `2px` Horizon Rail, conditional 48h Catch-Up banner, non-overwriting split buttons (`تم ما في المسجد` vs `تم الفترة بالكامل`), WHOOP-style rows (`target_label`, 7-day dots, inline `✓ / ✕`, inline `25/50/75/100/0%` chips, `•••` excuse/note popover), window-bound left-side sub-list, 4-state Sync Badge, and live 5s Undo toast.
2. **`الجدول الأسبوعي` (`Weekly Matrix`):** Desktop switches between **Standard Mode (`العرض المريح`)** (roomy collapsible table) and **One-Glance Sheet Mode (`نظرة واحدة — بدون سكرول`)** (side-by-side 2-column layout placing Right Time-Bound Periods next to Left Daily Habits so the entire week is visible in one screen without scrolling, automatically collapsing the sidebar). Mobile displays WHOOP-style 7-day status boxes using crisp English day abbreviations (`Sat`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`) with zero horizontal overflow + optional compact grid toggle.

---

## 6. User Prototype Review Conditions (Locked for Phase 7 Production UI)

Feedback captured from hands-on testing of `docs/prototype/index.html` (2026-11-20) — mandatory in the real Next.js implementation:
1. **Distinct Period Separators in One-Glance Mode:** Add crisp, unmistakable visual separation (`2px` stronger divider or subtle `4–6px` band) between each time period (`الصبح` / `الصباح` / `الظهر` / `العصر` / `المساء` / `المغرب` / `العشاء`) and left-side group so boundaries scan instantly.
2. **Breathable Density in One-Glance Mode:** Loosen horizontal and vertical tightness slightly (`25–26px` row height, `12.5px` readable Arabic labels, wider action title column) so labels never feel cramped while still fitting cleanly on a desktop screen.
3. **Single Top-Left Dark/Light Icon Button:** Place the Light/Dark theme switcher permanently as a clean **icon-only button in the top-left of the top bar** across both Desktop and Mobile (removing the redundant labeled theme button from the bottom of the desktop sidebar).
3. **`القضاء` (`Qadaa & 48h Backlog`):** Segmented tabs for (a) `عليّ قضاؤه` (displaying each missed day's **original historical target snapshot** e.g. `10 صفحات` even after upgrading to `20 صفحة`, with 1-tap `تم القضاء`), (b) `استدراك غير مسجّل (48 ساعة)`, and (c) `فوات لا يُقضى` awareness log.
4. **`التحليلات` (`3 Lean Weakness Insights`):** (1) Top Weakest Spots (`<85%` over 30d, `"هدف جديد"` adaptation guard badge, inline progression trail `10 صفحات ← 20 صفحة`), (2) `7d / 30d` Time-Bound Windows vs Daily Habit Groups (isolating `الجماعة الأولى` from Sunan), (3) Qadaa Velocity, Anti-`مراكمة` Logging Coverage, and Non-Recoverable Core Misses.
5. **`الإعدادات` (`Online-Only CRUD, Target Evolution & ntfy`):** Online-only guard banner when offline; Action list with **«تطوير الهدف»** modal enforcing the `today (D)` vs `tomorrow (D+1)` rule; `FAJR` vs `MIDNIGHT` rollover & location config; rich per-period **`ntfy`** customization (per-period toggle + lead-time, Quiet Hours, Nightly Digest + offline-aware Arabic preview); offline-capable JSON Export & iOS A2HS notice.
