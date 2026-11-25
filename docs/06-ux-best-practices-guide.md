# Mohasba Tracker v2 — UX Engineering & Interaction Best Practices Guide

**Status:** Authoritative UX Engineering Reference (Post-Stage 8 Power-User Ergonomics Upgrade)  
**Target Product:** Mohasba Tracker v2 (`جدول المحاسبة`) — Arabic RTL, Offline-First Personal PWA (`<3s` Street Mode + 50-Row Desktop Weekly Accountability Matrix)  
**Design System Alignment:** Strictly adheres to *Al-Mizan Al-Ma'dani* ([docs/02-ux-design-system.md](file:///d:/Ahmed/Projects/mohasba/docs/02-ux-design-system.md)) and Anti-AI-Slop Quality Gate ([docs/02b-anti-ai-slop-guide.md](file:///d:/Ahmed/Projects/mohasba/docs/02b-anti-ai-slop-guide.md))  
**Domain & Schema Alignment:** Strictly preserves all invariants in [docs/01-requirements.md](file:///d:/Ahmed/Projects/mohasba/docs/01-requirements.md) and [docs/04-data-and-security.md](file:///d:/Ahmed/Projects/mohasba/docs/04-data-and-security.md)  
**Research Foundations:** W3C WAI-ARIA Authoring Practices Guide (APG — Grid, Accordion, Disclosure, Tooltip), WCAG 2.2 (1.4.13 Content on Hover/Focus, 2.5.7 Dragging Movements, 2.5.8 Target Size), Nielsen Norman Group (NN/g — Contextual Menus, Gestural Discoverability, Progressive Disclosure), Steven Hoober Thumb-Zone Research, Material Design 3 & Apple HIG Bidirectionality (RTL), Atlassian Pragmatic Drag & Drop / `dnd-kit` ergonomics, and interaction models from Google Sheets, Linear, Notion, Raycast, VS Code, Loop Habit Tracker, Streaks, and WHOOP.

---

## 0. Executive Summary & Core Design Axioms

Mohasba Tracker v2 serves two radically different physical contexts with one coherent visual language:
1. **Street Mode (`الآن`, Mobile `360–420px`):** One-thumb outdoor logging in `<3s` walking out of the mosque, or low-glare stillness at Fajr/Isha.
2. **Accountability Ledger (`الجدول الأسبوعي`, Desktop `1440px`):** Keyboard-driven, Google-Sheets-grade bulk entry, rapid state cycling, and structural drag-and-drop across ~50 actions without modal fatigue.

### Six Non-Negotiable UX Axioms
1. **Zero-Modal Routine Logging:** Routine state toggling never opens a `<dialog>`. Precision edits (exact `10%` increments, notes, `DISABLED/EXCUSED` overrides, manual `QADAA_DONE`) live behind an asymmetric secondary gesture (Desktop Right-Click / `Enter`, Mobile `450ms` Long-Press + explicit `•••` escape hatch).
2. **Speed Paired with Reversible Safety:** Fast 1-click actions and bulk pastes rely on immediate optimistic IndexedDB writes (`<= 50ms`), a 5-second non-blocking Undo toast (`تراجع`), and an in-session `Ctrl+Z` batch undo stack — never confirmation popups (except disabling an already-logged cell, per `docs/01-requirements.md` §2.1).
3. **Zero Hidden-Gesture Traps (NN/g Dual-Path Rule):** Every invisible gesture (right-click, long-press, drag handle, keyboard chord) MUST have a visible affordance, inline legend, or explicit fallback control.
4. **Physical Layout Independence (`KeyboardEvent.code`):** Every shortcut binds to physical key geometry (`KeyI`, `Digit1`, `KeyC`, `KeyV`) so Arabic (`ه` / `ؤ` / `ر`) and English keyboard layouts behave identically, while settings render dual-legend `<kbd>` caps (`I / ه`).
5. **Scroll Never Fights Gestures:** Mobile scrolling (`pan-y`) always wins over long-press (`>10px` movement cancels timer) and drag-and-drop (`touch-action: none` isolated strictly to `6-dot` grip handles).
6. **Zero Dependencies Bloat & Zero AI Slop:** Implement tooltips, roving-tabindex grids, long-press, and pointer-event DnD using crisp React 19 + Web Standard primitives matching Mohasba's lean bundle (`package.json`) and strict *Al-Mizan Al-Ma'dani* visual discipline (zero audio, zero purple/beige, zero `·` middle-dots, zero raw emojis, zero resting card shadows).

---

## 1. High-Density Accountability Matrix Ergonomics (Google Sheets + Habit Tracker Hybrid)

### 1.1 Zero-Modal 1-Click / 1-Tap State Cycling

#### Comparative UX Analysis (Loop Habit Tracker vs. Streaks vs. WHOOP vs. Google Sheets)
- **Loop Habit Tracker & Streaks** prove that 1-tap cell toggling creates effortless daily momentum, provided accidental taps are effortlessly reversible via an Undo snackbar/toast rather than slow confirmation modals.
- **WHOOP** demonstrates that when states carry analytical consequences (such as Mohasba's `QADAA_DONE` `0.85` weight or `DISABLED` denominator exclusion), high-consequence states must never be triggered accidentally during routine tapping.

#### Deterministic 1-Click / 1-Tap Cycle Matrix (Mohasba Canonical Rules)

Every matrix cell falls into one of five archetypes. Muscle memory stays uniform across dates so users never suffer mode-error surprises:

| Cell Archetype | Guard / Condition | Exact 1-Click / 1-Tap Cycle | Why This Cycle Is Optimal |
| :--- | :--- | :--- | :--- |
| **1. Standard Binary** (`supports_percentage = false`, `is_qadaa_eligible = false`) | Enabled, `logDate <= today`, active | `EMPTY / PENDING / UNLOGGED_EXPIRED` → **`DONE`** → **`MISSED`** → **`EMPTY`** | Clean 3-step loop: 1 click marks done (90% case), 2nd click corrects to missed, 3rd click clears back to empty. |
| **2. Qadaa-Eligible Binary** (`supports_percentage = false`, `is_qadaa_eligible = true`) | Enabled, `logDate <= today`, active | `EMPTY / PENDING / UNLOGGED_EXPIRED` → **`DONE`** → **`MISSED`** → **`EMPTY`** *(uniform 3-step loop)* | Keeps muscle memory identical to standard binary and prevents accidentally stamping `QADAA_DONE` (`qadaa_resolved_at`) on open windows. `QADAA_DONE` is 1 keystroke (`Digit3`), 1 right-click/long-press, or 1 tap in `القضاء`. |
| **3. Already `QADAA_DONE`** | Cell currently holds `QADAA_DONE` | **1-click opens Cell Editor `<dialog>`** *(do NOT silently wipe `qadaa_resolved_at` on a stray click)* | Protects historical cross-week Qadaa repairs (`qadaa_resolved_at`) from accidental single-tap erasure; `Digit0`/`Delete` or `<dialog>` clears intentionally with 5s Undo. |
| **4. Percentage Action** (`supports_percentage = true`) | Enabled, `logDate <= today`, active | `EMPTY / PENDING / UNLOGGED_EXPIRED` → **`DONE` (100%)** → **`PERCENT` (50%)** → **`MISSED` (0%)** → **`EMPTY`** *(if currently any `PERCENT(p)` e.g. `75%`, 1-click → `MISSED`)* | Gives the 3 most common outcomes (`100%`, `50%`, `0%`) in zero modals while keeping clear within 1–2 clicks. Fine `10%..90%` steps remain 1 right-click / long-press / `Enter` away. |
| **5. `DISABLED` (Default-Off or Excused)** | `availability.isEnabled === false` | **1-click opens Cell Editor `<dialog>`** *(never auto-marks `DONE` on a stray click)* | Prevents accidentally turning on a Tuesday fasting cell or erasing a travel/illness excuse via fat-finger slip. User explicitly enables or picks a state inside `<dialog>`. |
| **6. `INACTIVE` / Future (`logDate > today`)** | Outside `[active_from, archived_at]` or future | **Non-interactive** (`aria-disabled="true"`, cursor `default`, no cycle, no editor) | Enforces `docs/01-requirements.md` §4.3 temporal honesty. |

#### Unintended Click Protection & Optimistic Undo Contract
- **No Click-Debounce Lag:** Execute optimistic IndexedDB write immediately (`<= 50ms`) so rapid clicking through a 7-day row feels instantaneous (Linear sub-50ms standard).
- **Coalesced 5s Undo + Session Stack:**
  - Rapid clicks on the same cell coalesce in the outbox (preserving causal `parent_mutation_id` + frozen `mutation_id` contract from `docs/03-architecture.md`).
  - Push every committed single-cell cycle or bulk batch onto an in-memory **Session Undo Stack (max 30 entries)** wired to `Ctrl+Z` (`Mod+KeyZ`), storing the exact prior `{ availability_override, status, percent_value, note, note_updated_at }` snapshot per cell.
  - Display the non-blocking 5s Undo toast (`تم تحديث [العمل] — تراجع`) only for **bulk edits, paste, clear-all, or disabling a logged cell** (not on every routine single-cell toggle, preventing toast spam during rapid 10-cell clicking — while `Ctrl+Z` always works for single clicks too!).

---

### 1.2 Asymmetric Precision Editing: Right-Click (Desktop) & Long-Press ~450ms (Mobile)

#### Desktop Trigger (`contextmenu` + Keyboard)
- **Right-click (`onContextMenu`)** on any active matrix cell (`logDate <= today`): call `e.preventDefault()`, focus that cell, and immediately open `<CellEditorDialog target={{ action, logDate }} />`.
- **Keyboard equivalents:** `Enter`, `Shift + F10`, or `ContextMenu` key on the focused cell open the exact same `<CellEditorDialog />`.
- **No redundant browser menu:** Suppressing the native browser context menu on matrix cells is standard spreadsheet behavior (Google Sheets / Airtable) and gives desktop users an instant, predictable editing path.

#### Mobile Trigger (`450ms` Long-Press with Scroll Cancellation & iOS Safari Hardening)

Mobile browsers — especially **iOS Safari (WebKit)** — fire native text selection, callout bubbles (`-webkit-touch-callout`), and `pointercancel` if pointer geometry and CSS are not tightly engineered.

**Mandatory CSS on Matrix Cells (`.m-cell`):**
```css
.m-cell {
  -webkit-touch-callout: none; /* Suppresses iOS Safari long-press callout bubble */
  -webkit-user-select: none;
  user-select: none;
  touch-action: manipulation;  /* Allows smooth vertical/horizontal scrolling & disables double-tap zoom; NEVER use touch-action: none here */
}
```

**Pointer Events Long-Press State Machine (`useLongPressCell` Hook):**
1. **`onPointerDown(e)`:**
   - Only arm timer when `e.pointerType === 'touch' || e.pointerType === 'pen'` (mouse uses left-click cycle + right-click editor).
   - Record `startX = e.clientX`, `startY = e.clientY`, `pointerId = e.pointerId`, `longPressFired = false`.
   - Start a **`120ms` visual-arm delay** (adds `.is-pressing` subtle border highlight only if user is still holding past a quick tap) and a **`450ms` activation timer**.
2. **`onPointerMove(e)` (Scroll Cancellation Guard):**
   - Compute Euclidean distance `Math.hypot(e.clientX - startX, e.clientY - startY)`.
   - If distance **`> 10px`** (matching WebKit's ~10px touch-slop heuristic): immediately `clearTimeout`, remove `.is-pressing`, mark `cancelledByScroll = true`. Result: scrolling vertically or horizontally **never** triggers an accidental long-press!
3. **`onPointerCancel` / `window.scroll` (capture phase):**
   - Immediately clear timers and `.is-pressing`.
4. **At `450ms` Activation:**
   - Set `longPressFired = true`.
   - Trigger **silent visual confirmation** (zero audio, zero haptics assumption since iOS Safari lacks `navigator.vibrate`): crisp `150ms` border flash in `--accent-live` + subtle `scale(0.95)` press release, and immediately open `<CellEditorDialog />`.
5. **`onPointerUp` / `onClick`:**
   - Clear all timers and `.is-pressing`.
   - If `longPressFired === true`: call `e.preventDefault(); e.stopPropagation();` inside `onClick` so the finger lift **never** also fires a 1-tap state cycle behind the dialog!
   - Also intercept `onContextMenu` on touch (`e.preventDefault()`) so Android Chrome / Safari 18.2+ never stack a native context menu over `<CellEditorDialog />`.

#### Solving NN/g's Hidden-Gesture Discoverability Problem
Per NN/g research, pure right-click/long-press gestures have low organic discovery without visual scent:
1. **Desktop Inline Hint Strip (Matrix Toolbar Footer):** Compact single-line subtle legend using `1px` vertical dividers (never `·` middle-dots):
   - `نقرة: تبديل` | `كليك يمين أو Enter: تعديل مفصّل` | `Shift+نقرة: تحديد متعدد` | `Ctrl+C / Ctrl+V: نسخ ولصق`
2. **Mobile Dual-Path Affordance:**
   - In **`الآن` Street Mode**, keep the explicit visible `•••` (`IconMoreDots`) button on every row (NN/g Escape Hatch).
   - In **`الجدول الأسبوعي` Mobile View**, display a concise muted caption beneath the week header: `نقرة لتبديل الحالة، واضغط مطوّلاً للتعديل المفصّل أو إضافة ملاحظة`.

---

### 1.3 Google-Sheets-Like Bulk Editing, Selection, Copy/Paste & Keyboard Grid

#### A. W3C ARIA APG Grid Semantics & Roving Tabindex
- Table root: `<table role="grid" aria-multiselectable="true" aria-label="الجدول الأسبوعي">`.
- Period group rows remain structural separators (`role="row"` with disclosure `<button>`), skipped automatically during cell-to-cell vertical arrow navigation.
- Data cells: `<button role="gridcell" tabIndex={isFocused ? 0 : -1} aria-selected={isSelected} aria-label="..."/>`.
- **Single Tab Stop:** Pressing `Tab` enters the grid at the last-focused cell (or today's first active cell). Arrow keys move inside the grid without consuming `Tab` stops; pressing `Tab` again exits cleanly to the next control outside the table.

#### B. RTL-Accurate Spatial Keyboard Navigation (Material 3 / Apple HIG)
Because Mohasba runs in `dir="rtl"`, weekday columns flow **right-to-left** (`Sat` = visual right / `colIdx 0` → `Fri` = visual left / `colIdx 6`):

| Physical Key (`e.code` / `e.key`) | Action in RTL Weekly Matrix |
| :--- | :--- |
| **`ArrowLeft`** | Move focus 1 cell **left** (`colIdx + 1`, next day in week) |
| **`ArrowRight`** | Move focus 1 cell **right** (`colIdx - 1`, previous day in week) |
| **`ArrowUp` / `ArrowDown`** | Move focus 1 action row up/down (skipping collapsed period rows seamlessly) |
| **`Home` / `End`** | Jump to first day (`colIdx 0`, visual far right) / last day (`colIdx 6`, visual far left) of current row |
| **`Ctrl + Home` / `Ctrl + End`** | Jump to first visible cell in grid / last visible cell in grid |
| **`Shift + Arrow*`** | Extend rectangular cell selection from anchor cell |
| **`Shift + Space`** | Select entire current action row (all 7 days of that week) |
| **`Ctrl + Space`** | Select entire current day column (all visible active actions for that date) |
| **`Space`** | Trigger 1-step state cycle on focused cell (when no multi-selection active) |
| **`Enter`** | Open `<CellEditorDialog />` for focused cell |
| **`Digit1`** | Set focused cell (or entire selection) to **`DONE`** |
| **`Digit2`** | Set focused cell (or entire selection) to **`MISSED`** |
| **`Digit3`** | Set focused cell (or entire selection) to **`QADAA_DONE`** (eligible cells only; skips ineligible with count notice) |
| **`Digit4`** | Set focused cell (or entire selection) to **`PERCENT 50%`** (`supports_percentage` cells only; skips others) |
| **`Digit0` / `Delete` / `Backspace`** | Clear focused cell (or entire selection) to **`EMPTY`** |
| **`KeyX`** | Set focused cell (or entire selection) to **`DISABLED`** *(requires 1-step confirm if overwriting logged cells, or applies with immediate 5s Undo toast)* |
| **`Mod + KeyC` / `Mod + KeyV`** | Copy / Paste cell, range, full day column, or full action row |
| **`Mod + KeyZ`** | Undo last cell cycle, paste, or bulk edit batch |
| **`Escape`** | Strict Escape Gradient: (1) Close `<dialog>` → (2) Clear active copy marquee → (3) Clear multi-cell selection (retaining single cell focus) |

> **Important Note on `ArrowLeft`/`ArrowRight`:** Never invert spatial direction! Pressing physical Left Arrow MUST move the focus ring physically leftward on screen (which in RTL is the next column `colIdx + 1`). Inverting this breaks both Material 3 RTL guidelines and user spatial memory.

#### C. Mouse Multi-Cell, Column & Row Selection (Desktop)
1. **Single Click (without modifiers, drag `< 6px`):** Clears any multi-cell selection, focuses clicked cell, and executes the 1-click state cycle.
2. **`Shift + Click`:** Keeps anchor cell, selects the full rectangular range `[minRow..maxRow] × [minCol..maxCol]` **without** mutating cell states.
3. **Click-and-Drag Range Selection (Mouse Only):** On `pointerdown` (`pointerType === 'mouse'`, primary button), if pointer drags `> 6px` into a second cell, enters range-selection mode (suppresses single-click state cycling on `pointerup`!).
4. **Day Column Header Click:** Clicking a weekday header (`السبت`, `الأحد`, ...) selects that entire day column across all visible rows AND updates `effectiveBulkDate` so the toolbar's `يوم اعتيادي` / `ترحيل للقضاء` buttons operate on that exact day. Clicking again (or pressing `Escape`) deselects.
5. **Action Title Click (with `Shift` or column checkbox-free row select):** Clicking a row's selection affordance (or `Shift+Space`) selects all 7 cells in that row for rapid weekly copy/paste.

**Visual Selection Tokens (*Al-Mizan Al-Ma'dani*):**
- **Focused Anchor Cell:** `2px solid var(--accent-live)` outline (`outline-offset: -1px`, crisp `2px` radius).
- **Selected Range Cells:** Subtle `background: var(--accent-live-soft)` overlay + `1px solid var(--accent-live)` outer perimeter border (zero neon glow).
- **Copied Marquee Source:** `1px dashed var(--accent-live)` perimeter until `Escape` or next copy.

#### D. Copy (`Ctrl+C`) & Paste (`Ctrl+V`) Semantics & Domain Guardrails
- **Structured Internal Clipboard + TSV Interop:**
  - Store an internal typed matrix `{ rows: number, cols: number, cells: Array<Array<ClipboardCellSnapshot>> }` in React state/ref (instant, works offline & without clipboard permission prompts).
  - Simultaneously mirror a clean tab-separated text matrix (`TSV`: `DONE` / `MISSED` / `QADAA` / `50%` / `DISABLED` / `""`) via `navigator.clipboard.writeText` (best-effort `try/catch`) so users can also copy into Google Sheets or paste TSV blocks back into Mohasba.
- **Dimension Mapping Rules (Google Sheets Standard):**
  - **`1×1` source → `R×C` target:** Broadcasts the single copied state across every compatible cell in the selected range.
  - **`R×1` (copied day column) → `1` anchor cell or `R×1` target day column:** Pastes vertically down matching visible rows (ideal for copying yesterday's entire day onto today!).
  - **`1×C` (copied row slice) → anchor cell or `1×C` target:** Pastes horizontally across dates.
  - **`R×C` block → anchor cell:** Pastes starting at the anchor cell (`[anchorRow + r, anchorCol + c]`), clipping safely at grid bounds.
- **Domain Compatibility Guardrails (Zero Illegal Transitions):**
  - Never write `QADAA_DONE` to an action where `is_qadaa_eligible === false` — **skip cell** and increment `skippedCount`.
  - Never write `PERCENT(1..99)` to an action where `supports_percentage === false` — **skip cell** and increment `skippedCount`.
  - Never write to `INACTIVE` (`< active_from` or `> archived_at`) or future (`> today`) cells — **skip silently**.
  - Never silently coerce incompatible states; instead show exact Arabic feedback in the 5s Undo toast: e.g., `تم لصق 14 خانة (تم تخطي 2 غير متوافقة)` alongside the `تراجع` button.
- **Single Atomic Undoable Batch:** All cells mutated by a paste or multi-select hotkey dispatch in **one single `commitBatch` / `undoBatch` unit** so 1 click of `تراجع` or 1 press of `Ctrl+Z` restores every cell to its exact pre-paste snapshot (including notes and `availability_override`).

#### E. Floating Contextual Bulk Action Bar
When `selectedCells.length >= 2`, mount a compact floating bar anchored cleanly above the bottom edge (`position: fixed; inset-block-end: 20px; inset-inline: 50%; transform: translateX(50%)` in RTL — or flex-centered wrapper):
- Surface: `--bg-surface`, `1px solid var(--border-strong)`, `--r-panel` (`8px`), `--shadow-overlay` (permitted transient overlay elevation per `docs/02-ux-design-system.md` §3).
- Contents: `<span className="nums">تم تحديد {count} خانات</span>` + crisp action buttons (`تم`, `فات`, `قضاء`, `إفراغ`, `نسخ`, `لصق`, `إلغاء`).
- Auto-hides `قضاء` if 0 selected cells are Qadaa-eligible.

---

### 1.4 Drag-and-Drop Reordering & Cross-Period Moving

#### Why Replace `↑` / `↓` Arrows?
In `ActionsSection` (~50 actions across 8–10 periods) and `PeriodsSection`, clicking `↑` / `↓` one slot at a time takes 10+ server round-trips to move an action from bottom to top, and cannot move an action to another period without opening the full Edit dialog.

#### Architecture Decision: Lightweight Pointer Events Engine (Zero New Dependencies)
- **Why NOT HTML5 Drag & Drop API:** Completely broken on mobile touch screens (iOS Safari / Android Chrome), renders ugly OS-controlled semi-transparent table-row ghosts, and cannot read `dataTransfer` mid-drag to preview cross-period targets.
- **Why Custom Pointer Events (`useSortableList` / `useCrossPeriodDrag`) over heavy third-party DnD packages:** Mohasba's `package.json` intentionally carries zero UI libraries (`next`, `react`, `adhan`, `idb`, `zod`, `@supabase/supabase-js`). A focused ~200-line Pointer Events controller using `setPointerCapture`, cached `getBoundingClientRect()` midpoints, and edge auto-scroll gives 100% control over `<table>` / `<tr>` layouts, RTL positioning, and zero bundle bloat. *(Note: if the team ever expands to multi-column Kanban boards, `@dnd-kit/core` or `@atlaskit/pragmatic-drag-and-drop` are the vetted drop-in upgrades.)*

#### Exact Interaction Specification

1. **6-Dot Grip Handle SVG (`IconGripVertical`):**
   - Add `IconGripVertical` to `src/client/components/icons.tsx` using matching `viewBox="0 0 24 24"`, `1.5px` visual balance (6 crisp `<circle>` dots at `cx="9"/"15"`, `cy="6"/"12"/"18"`, `r="1.15"`, `fill="currentColor"`, `stroke="none"`).
   - **Touch Safety Rule:** Apply `touch-action: none` **strictly on the grip handle button** (`.drag-handle`), NEVER on the row `<tr>` or card! Hit target: `44px × 44px` on touch (`< 1024px`) in Settings; `24px × 28px` compact target on desktop matrix rows.
   - **Offline Guard (Online-Only Schema CRUD Invariant):** Reordering and moving actions/periods are schema mutations (`docs/01-requirements.md` §4.3). When `!isOnline`, hide or disable drag handles (`disabled`, `opacity: 0.35`, tooltip `إعادة الترتيب متاحة عند الاتصال بالإنترنت فقط`).

2. **Where Drag-and-Drop Lives:**
   - **Settings → `PeriodsSection`:** Reorder periods within their own side (`TIME_BOUND` stays with `TIME_BOUND`; `DAILY_GROUP` stays with `DAILY_GROUP` — visually separated by a clear heading so users never try dragging a prayer window into daily groups).
   - **Settings → `ActionsSection`:** Reorder actions within a period **AND** drag an action across periods (including dropping onto a collapsed period header — hovering over a collapsed period header for **`400ms`** auto-expands it!).
   - **Weekly Matrix → Desktop Standard Mode (`>= 1024px`, Online Only):** Subtle `6-dot` grip handle on the inline-start edge of each action title cell (`opacity: 0.35` at rest, `1.0` on row hover/focus). Allows instant inline reordering within a period AND cross-period dragging directly inside the Weekly Ledger! *(Disabled in One-Glance dense mode and Mobile Weekly view to preserve density and scroll safety.)*

3. **Drag Visual Feedback (*Al-Mizan Al-Ma'dani* — Zero Slop):**
   - **Activation Threshold:** Drag begins only after `6px` pointer movement so accidental taps on the grip handle never jitter the list.
   - **Source Row:** `opacity: 0.35` in place (remains visible as spatial anchor).
   - **Floating Ghost (Portal, `position: fixed`, `pointer-events: none`):** Compact pill showing grip icon + action title (`--bg-surface`, `1px solid var(--accent-live)`, `--r-control`, `--shadow-overlay`), zero tilt/wobble gimmicks.
   - **Drop Target Indicator:** Crisp **`2px solid var(--accent-live)` horizontal insertion line** with `4px` end cap between rows — never abrupt jumpy table reflows while hovering!
   - **Cross-Period Drop Highlight:** Target period header receives `background: var(--accent-live-soft)` + `border-color: var(--accent-live)` to confirm the destination group before release.
   - **Edge Auto-Scroll:** When pointer comes within `48px` of viewport top/bottom during drag, smoothly scroll container (`requestAnimationFrame` proportional speed `4–14px/frame`).

4. **Cross-Period Domain Integrity on Drop:**
   - Dropping action `A` into target period `P_new` at index `k`:
     - Preserves `A.id` (100% of `daily_logs` and `target_versions` stay intact).
     - If `P_new.side === 'TIME_BOUND'` and `A.bound_time_period_id !== null`, automatically clears `bound_time_period_id = null` (a right-side time-bound action cannot simultaneously bind as a left-side habit).
     - Persists `period_id` + re-indexed `sort_order` via a single optimistic update + server API call, rolling back cleanly with an error banner if offline/rejected.

5. **Keyboard-Accessible Reordering Fallback (WCAG 2.2 SC 2.5.7):**
   - Every `.drag-handle` is a native focusable `<button type="button" aria-roledescription="مقبض إعادة الترتيب">`.
   - **Fast Keyboard Reorder:** When focused on a grip handle (or action row in Settings), pressing **`Alt + ArrowUp`** / **`Alt + ArrowDown`** immediately shifts the item 1 position up/down; at the top/bottom boundary of a period, pressing `Alt + ArrowUp/Down` again crosses cleanly into the adjacent period!
   - **Screen Reader Live Announcements:** A dedicated `<div className="sr-only" aria-live="assertive" role="status">` announces exact moves in Arabic: e.g., `تم نقل «أذكار الصباح» إلى الموضع 2 داخل «الصباح»`.
   - **Explicit Non-Drag Escape Hatch:** The Period `<select>` dropdown inside Edit Action `<dialog>` remains available for users who prefer direct selection over dragging.

---

## 2. Mobile `<3s` Street Mode vs. Desktop Power-User Mode Ergonomics

### 2.1 Ergonomic Split Matrix

| Dimension | Mobile Street Mode (`360–420px`, `< 1024px`) | Desktop Power-User Mode (`>= 1024px`, `1440px`) |
| :--- | :--- | :--- |
| **Primary Job** | Log 3–6 items walking out of the mosque in `<3s` with one thumb | Review & bulk-edit 50 actions × 7 days with keyboard + mouse |
| **Navigation Shell** | Fixed bottom nav (`5` tabs, `44×44px+` touch targets in Green Thumb Zone) + `48px` compact top bar | Collapsible RTL inline-start rail (`228px ↔ 0px`, `Ctrl+KeyI`) + Full-width ledger |
| **Primary Logging Gesture** | Explicit inline `✓` / `✕` buttons (`44×44px`, `8px` gap) + inline `25/50/75/100/0%` chips + split bulk buttons (`تم ما في المسجد` / `تم الفترة بالكامل`) | Matrix 1-click cycle + keyboard `1/2/3/4/0` + `Shift+click` multi-select + `Ctrl+C/V` |
| **Precision / Secondary Edit** | Visible `•••` button (`الآن`) + `450ms` Long-Press (`الجدول الأسبوعي`) | Right-click (`contextmenu`) or `Enter` on focused cell |
| **Reordering / Structure** | Settings only (via `44×44px` `6-dot` grip handle + Edit `<select>`); disabled inside Weekly Matrix to protect scrolling | Settings **and** inline Weekly Matrix Standard Mode (`6-dot` grip + `Alt+ArrowUp/Down`) |
| **Modal Budget** | Near-zero (only rare notes/excuse/Qadaa edits) | Near-zero (only precision `<dialog>` edits, Target Evolution, and `?` shortcut map) |

### 2.2 Thumb-Zone Placement Rules (Steven Hoober Research)
1. **Green Zone (Bottom Third — Natural Thumb Arc):**
   - Fixed 5-tab bottom navigation bar (`الآن`, `الجدول`, `القضاء`, `التحليلات`, `الإعدادات`).
   - 5-second Undo toast anchored directly above the bottom nav (`inset-block-end: calc(64px + env(safe-area-inset-bottom))`), putting the `تراجع` button straight under the thumb.
2. **Yellow Zone (Middle — Comfortable Reach):**
   - Active prayer window's split quick-actions (`تم ما في المسجد` / `تم الفترة بالكامل`) and action rows (`>= 52px` height).
   - Place inline `✓` and `✕` buttons at `inline-end` (left edge in RTL) with `>= 44×44px` tap area and `>= 8px` gap between them so a tired Fajr thumb never hits `✕` when aiming for `✓`.
3. **Red Zone (Top Corners — Deliberate Reach Only):**
   - Theme toggle (top-left icon button per Gate 3 §6 condition #3), Sync badge popover (top-right), and Sign Out (deep inside Settings).

### 2.3 Zero Horizontal Overflow Engineering Checklist (`360px` & `390px`)
Every view must pass `document.documentElement.scrollWidth <= window.innerWidth` at both `360px` (compact Android) and `390px` (iPhone):
- Use `overflow-x: clip` (never `overflow-x: hidden`) on outer wrappers so `position: sticky` headers and toolbars remain functional.
- Set `min-width: 0` on all flex/grid items containing Arabic action titles, URLs, or `<kbd>` badges.
- Apply `overflow-wrap: anywhere` on long `ntfy` URLs and `dir="ltr"` with `text-align: start` on URL/token inputs so long URLs never force horizontal blowout.
- Wrap dense toolbars (Week navigation, Bulk buttons, Expand/Collapse controls) cleanly with `flex-wrap: wrap; gap: 8px;`.
- Mobile Weekly Matrix keeps WHOOP-style 7-day boxes (`Sat`..`Fri`) cleanly distributed via `grid-template-columns: repeat(7, minmax(0, 1fr))` with `gap: 4px`.

---

## 3. Power-User Settings Architecture & Customizable Keyboard Shortcuts

### 3.1 Collapsible Accordions & Progressive Disclosure in `SettingsView`

#### The Problem Today
Rendering `PeriodsSection`, `ActionsSection` (50 rows!), `RolloverLocationSection`, `NtfySection`, and `BackupAuditSection` fully expanded at once creates a 4,000px+ scroll wall on both desktop and mobile.

#### Target 1-Screen Scannable Settings Architecture
Top of `SettingsView`: compact header row with **`توسيع الكل`** / **`طيّ الكل`** toggle button + offline guard banner (when `!isOnline`). Below it, **6 top-level ARIA Disclosure Accordions**, all **collapsed by default** (with an optional live summary pill in each header so users scan status without opening anything):

| # | Accordion Section (Arabic Title) | Header Summary Pill (`.count-chip`) | Default State |
| :--- | :--- | :--- | :--- |
| 1 | **التفضيلات والاختصارات** *(Preferences & Shortcuts)* | `الشاشة الرئيسية: الآن` | Collapsed |
| 2 | **الفترات الزمنية والمجموعات** *(Periods & Groups)* | `{N} فترة نشطة` | Collapsed |
| 3 | **الأعمال والأهداف** *(Actions & Targets)* | `{N} عمل نشط` | Collapsed |
| 4 | **بداية اليوم والموقع الجغرافي** *(Rollover & Location)* | `[بداية اليوم: الفجر]` `[القاهرة]` *(two clean chips, zero `·` middle-dots)* | Collapsed |
| 5 | **التنبيهات الذكية (`ntfy`)** *(Smart Reminders)* | `[مفعّلة]` / `[غير مهيأة]` | Collapsed |
| 6 | **النسخ الاحتياطي وسجل العمليات** *(Backup & Audit)* | `[تصدير JSON]` | Collapsed |

#### Nested Period-Group Accordions Inside `ActionsSection`
- Inside **الأعمال والأهداف**, group actions by their parent Period (`الصبح`, `الصباح`, `الظهر`, ..., `المجموعات اليومية`), each rendered as a nested collapsible disclosure (`aria-expanded`) showing `{N} أعمال` + a section-level **`توسيع الفترات` / `طيّ الفترات`** toggle.
- Default state when opening `ActionsSection`: **all nested periods collapsed** (or first period expanded if `actions.length <= 12`). Expanding a single period reveals only 4–8 rows — instantaneous scanning!
- **Drag-to-Collapsed-Period Auto-Open:** Hovering a dragged action over a collapsed period accordion header for `400ms` automatically expands it so cross-period dropping stays effortless.

#### W3C APG Accordion Accessibility Contract
```tsx
<section className="panel accordion-panel">
  <h3 className="accordion-heading">
    <button
      type="button"
      id={`${id}-trigger`}
      className="accordion-trigger"
      aria-expanded={isOpen}
      aria-controls={`${id}-panel`}
      onClick={onToggle}
    >
      <span className="accordion-title-group">
        <IconChevronDown className={isOpen ? 'chevron-open' : 'chevron-closed'} size="sm" />
        <span>{title}</span>
      </span>
      <span className="accordion-meta">{summaryBadges}</span>
    </button>
  </h3>
  {isOpen && (
    <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-trigger`} className="accordion-body">
      {children}
    </div>
  )}
</section>
```
- **RTL Chevron Convention:** Closed chevron points **leftward** (inline-end in RTL, `rotate(90deg)` on `IconChevronDown` or `IconChevronLeft`), rotating smoothly to downward (`rotate(0deg)`) on open in `150ms ease-out` (`transition: none` under `prefers-reduced-motion: reduce`).
- Focus remains strictly on the `<button>` when toggled via `Enter`/`Space`.

---

### 3.2 Layout-Independent Keyboard Shortcut Recorder UX

#### A. Physical `KeyboardEvent.code` Model & Arabic Dual-Legend Display
Never match `event.key` for shortcuts — on an Arabic keyboard layout, physical `KeyI` emits `'ه'`, `KeyC` emits `'ؤ'`, `KeyV` emits `'ر'`, `KeyZ` emits `'ئ'`.

**Canonical Shortcut Schema:**
```ts
export interface ShortcutBinding {
  code: string;     // Physical KeyboardEvent.code, e.g. 'KeyI', 'KeyO', 'Digit1'
  mod: boolean;     // Ctrl on Windows/Linux, Meta (Cmd) on macOS
  alt: boolean;
  shift: boolean;
}
```

**Dual-Legend Arabic/Latin Keycap Mapping (`formatShortcutCaps`):**
- Always wrap the `<kbd>` sequence in `<span className="kbd-group" dir="ltr">` so modifier order (`Ctrl` + `Shift` + `I`) reads consistently left-to-right on physical keyboards without bidi scrambling.
- For letter keys (`KeyA`–`KeyZ`), render a crisp dual label showing the physical Latin cap and its standard Arabic-101 legend (e.g., `KeyI` → `I / ه`, `KeyO` → `O / خ`, `KeyZ` → `Z / ئ`, `KeyC` → `C / ؤ`, `KeyV` → `V / ر`).
- Style `<kbd>` cleanly in *Al-Mizan Al-Ma'dani*: `background: var(--bg-subtle)`, `border: 1px solid var(--border-strong)`, `border-radius: var(--r-cell)` (`2px`), `font-size: 0.75rem`, `font-weight: 600`, `padding: 2px 6px`, `font-variant-numeric: tabular-nums` (never `font-family: monospace` on Arabic labels per `docs/02b-anti-ai-slop-guide.md`).

#### B. Recommended Default Shortcut Map

| Action ID | Arabic Label | Default Binding (`code`) | Display Keycaps | Scope |
| :--- | :--- | :--- | :--- | :--- |
| `toggleSidebar` | إظهار / إخفاء الشريط الجانبي | `Mod + KeyI` | `Ctrl` `I / ه` | Global (Desktop) |
| `toggleOneGlance` | تبديل وضع «نظرة واحدة» | `Alt + KeyO` | `Alt` `O / خ` | Weekly Matrix |
| `navNow` | الانتقال إلى «الآن» | `Alt + Digit1` | `Alt` `1` | Global |
| `navWeek` | الانتقال إلى «الجدول الأسبوعي» | `Alt + Digit2` | `Alt` `2` | Global |
| `navQadaa` | الانتقال إلى «القضاء» | `Alt + Digit3` | `Alt` `3` | Global |
| `navAnalytics` | الانتقال إلى «التحليلات» | `Alt + Digit4` | `Alt` `4` | Global |
| `navSettings` | الانتقال إلى «الإعدادات» | `Alt + Digit5` | `Alt` `5` | Global |
| `jumpToday` | القفز إلى اليوم الحالي | `Alt + KeyT` | `Alt` `T / ف` | `الآن` & `الجدول` |
| `undo` | التراجع عن آخر تعديل | `Mod + KeyZ` | `Ctrl` `Z / ئ` | Global (outside inputs) |
| `openShortcutsHelp` | عرض خريطة الاختصارات | `Shift + Slash` (`?`) | `?` | Global (outside inputs) |

*(Note: Single-key Matrix cell hotkeys `1/2/3/4/0/Space/Enter` activate only when DOM focus is inside `role="grid"`, so they never conflict with typing or global navigation!)*

#### C. Recording, Conflict Warning & Reserved Browser Guard
1. **Input Isolation Guard:** Global shortcut listener MUST early-return whenever `document.activeElement` is `<input>`, `<textarea>`, `<select>`, `[contenteditable="true"]`, or when a `<dialog open>` is active (except `Escape` and the Shortcut Recorder itself).
2. **Active Recording State (Raycast Pattern):**
   - Clicking a binding pill enters recording mode: border switches to `2px solid var(--accent-live)`, label changes to `اضغط الاختصار المطلوب... (Esc للإلغاء)`.
   - Ignore bare modifier keys (`Control*`, `Shift*`, `Alt*`, `Meta*`) until a non-modifier physical key is pressed.
   - Require at least one modifier (`Ctrl`/`Alt`) for global navigation shortcuts (prevents accidentally binding plain `KeyA` globally and breaking Arabic typing).
   - `Escape` cancels recording without altering the saved shortcut; `Delete`/`Backspace` (without modifiers) clears/unbinds the shortcut.
3. **Reserved Browser-Shortcut Hard Block:**
   - Reject un-overridable browser/OS combos immediately in the recorder:
     - `Mod + KeyW` (close tab), `Mod + KeyT` (new tab), `Mod + KeyN` (new window), `Mod + KeyR` / `F5` (reload), `Mod + KeyL` (address bar), `Mod + KeyQ` (quit), `Mod + Shift + KeyT` (reopen tab), `Mod + Shift + KeyI` / `F12` (DevTools), `F11` (fullscreen), `Mod + Tab`, `Alt + Tab`.
   - Show an inline `--missed-ink` message: `هذا الاختصار محجوز للمتصفح ولا يمكن تخصيصه؛ اختر تركيبة أخرى.`
4. **Non-Dead-End Conflict Detection (VS Code / Raycast Gold Standard):**
   - If the newly recorded combo matches another Mohasba shortcut `B`, do NOT silently overwrite and do NOT force the user to hunt down `B` manually.
   - Display an inline `--percent-ink` warning directly below the row naming `B`: `هذا الاختصار مُستخدم حالياً لـ «[اسم الأمر]».` accompanied by two instant buttons: **`استبدال ونقل الاختصار`** (assigns to `A` and unbinds `B`) and **`إلغاء`**.
5. **Reset Controls:**
   - Per-row subtle **`إعادة`** button (shown only when binding differs from default).
   - Section-level **`استعادة جميع الافتراضيات`** button with 1-click reset + confirmation status note.
6. **Persistence:** Store customized bindings in `app_settings.keyboard_shortcuts` (JSONB synced across desktop sessions, validated strictly by Zod) and mirror in IndexedDB/`localStorage` for instant zero-latency hydration.

---

### 3.3 Configurable Default Home Screen & 48h Catch-Up Banner Toggle

Inside the **التفضيلات والاختصارات** (`Preferences & Shortcuts`) accordion:

1. **الشاشة الافتراضية عند فتح التطبيق (`default_home_view`):**
   - Segmented radio control: **`الآن (تسجيل الشارع)`** *(default)* vs **`الجدول الأسبوعي`** *(with optional `القضاء` / `التحليلات` support matching `app_settings.default_home_view`)*.
   - **Precedence Rule:** Explicit URL query parameters (`?view=qadaa`, `ntfy` deep-links `?view=now&period=...&date=...`) **always override** `default_home_view`. Only bare root `/` visits read `default_home_view`.
2. **وضع العرض الافتراضي للجدول على الحاسوب (`default_week_mode`):**
   - Segmented radio control: **`العرض المريح`** *(default)* vs **`نظرة واحدة (بدون سكرول)`**.
   - Automatically initializes `oneGlanceMode` (and sidebar auto-collapse when `one_glance` is chosen) on desktop (`>= 1024px`) without breaking mobile layout.
3. **إظهار تنبيه استدراك آخر 48 ساعة في شاشة «الآن» (`show_catchup_banner`):**
   - Clean toggle checkbox (`true` by default) with plain-Arabic helper text:
     - `عند الإيقاف، يختفي شريط التنبيه من أعلى شاشة «الآن» لتبقى خفيفة، بينما يظل التبويب متاحاً دائماً داخل شاشة «القضاء».`
   - **Data Integrity Guarantee:** Hiding the banner is purely presentational — it never suppresses `UNLOGGED_EXPIRED` detection, never alters Analytics Bucket B (`logging_coverage_7d`), and never hides the `القضاء` badge count!

*(All three preferences persist cleanly in `app_settings` and hydrate offline from IndexedDB, ensuring immediate startup parity with zero layout flash.)*

---

### 3.4 Self-Hoster `ntfy` In-App Configuration UX

#### Problem Solved
Currently, self-hosters (especially friends deploying Mohasba via Docker or Cloudflare Workers) must configure `NTFY_TOPIC_URL` via server `.env` files and restart containers to connect or rotate their `ntfy` topic. Making `ntfy` fully configurable inside Settings turns a 15-minute DevOps chore into a 60-second guided flow.

#### 3-Step Arabic Guided Setup Inside `NtfySection`

Place a crisp, numbered 3-step guide (`1`, `2`, `3` in small `22×22px` `--r-cell` bordered numeral badges — zero emojis, zero card-in-card nesting) directly at the top of the `التنبيهات الذكية (ntfy)` accordion:

1. **الخطوة 1 — اشترك في قناة خاصة على تطبيق `ntfy`:**
   - Clear copy: `حمّل تطبيق ntfy المجاني على هاتفك (Android / iOS)، ثم اختر اسم قناة عشوائي طويل لا يمكن تخمينه لأن قنوات ntfy.sh العامة تعتمد على سرية الاسم.`
   - **1-Click High-Entropy Generator:** Button **`توليد رابط قناة خاصة`** generates `https://ntfy.sh/mohasba-${cryptoRandomBase32(16)}` client-side using Web Crypto (`crypto.getRandomValues`), fills the URL input, and exposes a **`نسخ الرابط`** button (switches to `تم النسخ` for 2s) so the user can subscribe to that exact topic name in the `ntfy` phone app immediately.
2. **الخطوة 2 — الصق رابط القناة ورمز الوصول (اختياري):**
   - **Field A — `رابط قناة ntfy`:** `<input type="url" dir="ltr" placeholder="https://ntfy.sh/mohasba-xxxxxxxxxxxx" />`
     - Client + Server validation: must use `https://`, reject `localhost` / loopback / cloud metadata / RFC1918 private IPs (IPv4 & IPv6) server-side, and use `redirect: 'error'` on dispatch.
     - **Masked Topic Display:** Once saved, the API returns only a masked hint (`ntfy_topic_hint`, e.g. `https://ntfy.sh/••••9f2a`) rather than echoing the secret full topic URL on every bootstrap; show that hint with explicit **`تغيير الرابط`** / **`مسح والعودة لمتغير الخادم`** actions.
   - **Field B — `رمز الوصول (Access Token — اختياري للخوادم المحمية)`:** `<input type="password" dir="ltr" placeholder="tk_..." autocomplete="off" />`
     - **Secret-Handling UX:** Once saved, the API **never** sends the raw token back to the browser (`ntfy_has_token: boolean` only). The input displays a locked placeholder `محفوظ (••••••••)` with explicit **`تغيير الرمز`** and **`إزالة الرمز`** actions. Never include `ntfy_topic_url` or `ntfy_access_token` in client JSON backup exports (`docs/01-requirements.md` §7.1 secret isolation!).
   - **Source Precedence Pill:** Show clear status badge: `المصدر النشط: إعدادات التطبيق` vs `المصدر النشط: متغير الخادم (.env)` vs `غير مهيأ`. (In-app URL overrides `.env` when set; clearing in-app URL falls back cleanly to `.env` if present.)
3. **الخطوة 3 — اضغط «تجربة التنبيه» للتأكد فوراً:**
   - Place **`حفظ الإعدادات`** and **`تجربة التنبيه`** side-by-side (`تجربة التنبيه` saves or tests the saved config and reports exact actionable HTTP feedback):
     - `200 OK` → `--done-ink`: `تم إرسال التنبيه التجريبي بنجاح. تحقق من تطبيق ntfy على هاتفك الآن.`
     - `401 / 403` → `--missed-ink`: `رفض الخادم الإرسال (401/403). تحقق من رمز الوصول (Access Token) وصلاحية الكتابة للقناة.`
     - `400 / 404` → `--missed-ink`: `رابط القناة غير صالح. تأكد أن الرابط ينتهي باسم القناة مثل https://ntfy.sh/your-topic.`
     - Network / `5s` timeout → `--missed-ink`: `تعذر الاتصال بخادم ntfy خلال 5 ثوانٍ. تحقق من الرابط واتصال الخادم بالإنترنت.`
- **Clean Separation Below Setup:** Keep the existing Per-Period `ntfy` schedule table, Quiet Hours, Nightly Backlog Digest, and Offline-Aware Arabic Preview right below the 3-step setup inside the same accordion.

---

## 4. RTL Arabic Micro-Interactions & Zero-Slop Polish

### 4.1 Fixing Clipped Tooltips in RTL Collapsible Sidebars (Root-Cause & Portal Architecture)

#### Exact Root-Cause Found in `src/app/globals.css`
Currently:
- `.desktop-rail` (lines 202–217) sets `overflow: hidden` so collapsing `width: var(--sidebar-w)` → `0` hides inner labels smoothly.
- `.has-tip::after` (lines 256–282) renders a CSS pseudo-element tooltip with `position: absolute; inset-block-start: calc(100% + 6px); inset-inline-start: 0;`.
- Inside RTL, the sidebar collapse button sits at the `inline-end` (left edge) of `.brand-block`, so `inset-inline-start: 0` grows **leftward past `.desktop-rail`'s edge**, getting clipped cleanly in half by `overflow: hidden`!
- Additionally, CSS `::after` tooltips fail **WCAG 1.4.13**: they cannot be dismissed with `Escape`, cannot be hovered over, and are invisible to `aria-describedby` screen readers.

#### Authoritative Solution: Zero-Dependency React Portal `<Tooltip>` Component
Replace `.has-tip::after` with a reusable `<Tooltip content={...} shortcut={...}>` component (`src/client/components/tooltip.tsx`):
1. **Portal Escape:** Render the tooltip via `createPortal(..., document.body)` with `position: fixed; z-index: 90;` — completely immune to `overflow: hidden` in `.desktop-rail`, sticky headers, or scrollable modals.
2. **RTL Viewport-Clamped Geometry (`computeTooltipPosition`):**
   - Measure `triggerRect = trigger.getBoundingClientRect()` and `tipRect = tooltip.getBoundingClientRect()` in `useLayoutEffect`.
   - Default placement: **below** the trigger (`top = triggerRect.bottom + 6`), horizontally aligned to trigger center, then **clamped strictly inside `[8px, window.innerWidth - tipRect.width - 8px]`**. If near viewport bottom (`top + tipRect.height > window.innerHeight - 8`), auto-flip above (`triggerRect.top - tipRect.height - 6`).
   - Recalculate or hide immediately on window `scroll` (capture) / `resize`.
3. **WCAG 1.4.13 Compliance:**
   - **Triggered on both `onMouseEnter` and `onFocus`** (only `:focus-visible` or keyboard focus, never lingering after mouse click).
   - **Dismissible:** Pressing `Escape` hides tooltip immediately without moving focus.
   - **Hoverable:** `100ms` close grace timer cleared if pointer enters the tooltip element itself.
   - **Accessible:** Trigger carries `aria-describedby={open ? tooltipId : undefined}`; tooltip carries `id={tooltipId} role="tooltip"`.
   - **Touch Guard:** Do NOT show hover tooltips on `pointerType === 'touch'` (prevents sticky hover tooltips after mobile taps!).
4. **Visual Styling (*Al-Mizan Al-Ma'dani*):**
   - `background: var(--ink-primary)`, `color: var(--ink-inverse)`, `border-radius: var(--r-control)` (`6px`), `padding: 5px 9px`, `font-size: 0.75rem`, `box-shadow: var(--shadow-overlay)`, `150ms` opacity transition (instant under `prefers-reduced-motion`).
   - Supports optional inline `<kbd>` shortcut chip inside tooltip (e.g., `إخفاء الشريط الجانبي` + `Ctrl` `I / ه` in `dir="ltr"`).

### 4.2 Clean Sticky Headers & Z-Index Layering Architecture (RTL Tables)

Define one explicit `z-index` ladder in `src/app/globals.css` so sticky headers, drag ghosts, bulk bars, tooltips, toasts, and `<dialog>` never fight:

| Layer | `z-index` | Element |
| :--- | :---: | :--- |
| Sticky Action Title Column (`inline-start`) | `10` | `.matrix-table .col-action` (when table scrolls horizontally) |
| Sticky Table Column Headers (`<thead>`) | `20` | `.matrix-table thead th` (`position: sticky; inset-block-start: 0`) |
| Sticky Top-Start Corner Header (`<thead> th:first-child`) | `25` | Intersection of sticky row & column |
| Mobile Bottom Navigation & Top Bar | `30` | `.top-bar`, `.mobile-bottom-nav` |
| Sync Status Popover & Floating Bulk Action Bar | `45` | `.sync-popover`, `.bulk-selection-bar` |
| Drag-and-Drop Floating Row Ghost | `60` | `.dnd-drag-ghost` (`pointer-events: none`) |
| 5-Second Undo Toast | `70` | `.undo-toast` |
| React Portal `<Tooltip>` | `90` | `.portal-tooltip` |
| Native `<dialog>` Top Layer | Browser Top Layer | `<CellEditorDialog>`, `<TargetEvolutionDialog>`, `<ShortcutsHelpDialog>` |

**RTL Sticky Polish Rules:**
- Separate sticky `<thead>` from scrolling rows using a crisp `1px solid var(--border-strong)` bottom border (never blurred drop shadows).
- Apply `background: var(--bg-subtle)` (100% opaque, never semi-transparent) on sticky headers and sticky period separators so scrolling rows never bleed through.
- Enforce `dir="ltr"` on numeric time windows (`14:43 - 17:01`), URLs, and `<kbd>` shortcut clusters; use logical CSS properties (`inset-inline-start`, `border-inline-end`, `padding-inline`, `text-align: start`) everywhere else.

### 4.3 *Al-Mizan Al-Ma'dani* Anti-AI-Slop Verification Checklist for All New Features

Before any new interaction ships in Phase 7/8 polish commits, verify every box:
- [ ] **Zero Middle-Dots (`·`) / Em-Dash Titles / Trailing `→` Arrows:** All legend strips, accordion summary pills, and shortcut labels use clean borders, spacing, or `.count-chip` badges — zero `·` separators.
- [ ] **Zero Raw Emojis:** All new glyphs (`IconGripVertical`, `IconKeyboard`, `IconCopy`, `IconCheck`, `IconInfo`) use uniform `1.5px` stroke SVGs in `src/client/components/icons.tsx`.
- [ ] **Zero Wave-1/Wave-2 Colors:** Selection tints strictly use `--accent-live-soft` (`#E3F0F1` Light / `rgba(88,164,170,0.13)` Dark); conflicts use `--percent-ink` (Harvest Ochre); browser-reserved blocks use `--missed-ink` (Muted Carmine). Zero purple/indigo, zero cream/beige, zero neon glow.
- [ ] **Zero Audio / Music:** Long-press confirmation, drag drop, copy/paste, and `ntfy` test feedback are 100% silent visually driven UI transitions (`150–180ms`, `prefers-reduced-motion` compliant).
- [ ] **Dual-Mode & Dual-Viewport Verification:** Verified via `impeccable.cmd detect --json src/app src/client` returning `[]`, plus real Playwright screenshots at **`1440×900`** and **`390×844`** in both **Light (`#F3F5F6`/`#FFFFFF`)** and **Dark (`#16181C`/`#1D2026`)** with `0` console errors and `scrollWidth <= innerWidth`.

---

## 5. Implementation Reference Map (For Phase 7/8 Engineers)

| Feature Area | Primary Target Files | Key Contracts / Invariants |
| :--- | :--- | :--- |
| **Portal `<Tooltip>` + `IconGripVertical`** | `src/client/components/tooltip.tsx` (new), `src/client/components/icons.tsx`, `src/client/components/app-shell.tsx`, `src/app/globals.css` | Replace `.has-tip::after`; Portal to `document.body`; WCAG 1.4.13 (`Escape`, hoverable, `aria-describedby`); RTL viewport clamping. |
| **1-Click Cycle + Long-Press + Right-Click** | `src/client/hooks/use-long-press.ts` (new), `src/client/components/views/week-view.tsx` | 3-step binary / 4-step percent cycle; protect `QADAA_DONE` & `DISABLED`; `450ms` touch timer with `>10px` scroll cancel; `-webkit-touch-callout: none`; `touch-action: manipulation`. |
| **Grid Navigation, Multi-Select, Copy/Paste & Undo Stack** | `src/client/hooks/use-matrix-grid.ts` (new), `src/client/components/views/week-view.tsx`, `src/client/store/mohasba-provider.tsx` | W3C APG roving `tabindex`; RTL `ArrowLeft = col+1`; `Shift+Click`, drag-select, column-header click; TSV + internal clipboard; skip incompatible `QADAA`/`PERCENT`; atomic `undoBatch` + `Ctrl+Z` stack. |
| **6-Dot Drag-and-Drop (Same & Cross-Period)** | `src/client/hooks/use-pointer-dnd.ts` (new), `src/client/components/settings/periods-section.tsx`, `actions-section.tsx`, `week-view.tsx` | `touch-action: none` strictly on `.drag-handle`; online-only guard; `2px` drop line; `400ms` auto-expand collapsed period; `Alt+ArrowUp/Down` + `aria-live="assertive"`. |
| **Collapsible Settings Accordions** | `src/client/components/accordion.tsx` (new), `settings-view.tsx`, `actions-section.tsx` | Default-collapsed 6 categories + `توسيع الكل` / `طيّ الكل`; nested period accordions inside `ActionsSection`. |
| **Preferences + Shortcut Recorder** | `src/client/components/settings/preferences-shortcuts-section.tsx` (new), `src/client/shortcuts/shortcut-registry.ts` (new), `app-shell.tsx`, `now-view.tsx` | Physical `KeyboardEvent.code`; dual `I / ه` keycaps (`dir="ltr"`); browser-reserved hard block; inline conflict swap; `default_home_view`, `default_week_mode`, `show_catchup_banner`. |
| **In-App Self-Hoster `ntfy` Setup** | `src/client/components/settings/ntfy-section.tsx`, `src/app/api/settings/route.ts`, `src/server/services/ntfy.ts`, `supabase/migrations/` (if DB columns added) | 3-step Arabic guide; random topic generator + copy; HTTPS + SSRF validation; write-only masked Access Token (never in GET/exports); actionable HTTP error copy on `تجربة التنبيه`. |
