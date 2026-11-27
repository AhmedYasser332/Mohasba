import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addDaysIso, getWeekDates, resolveIslamicDate } from '../../src/domain/prayer-engine';
import {
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '../../src/domain/starter-pack';
import { loadTestEnv } from '../helpers/load-env';
import { resetTestDb } from '../helpers/reset-test-db';
import { seedStarterPackViaBrowser } from '../helpers/seed-starter-e2e';

loadTestEnv();

const PORT = 3104;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR =
  'C:/Users/ahmed/.gemini/antigravity/brain/f71a0285-daff-460c-9b19-50e9a1762d6f/scratch/screenshots/ux-upgrade';

let serverProcess: ChildProcess | null = null;

/** Must exceed MULTI_TAP_WINDOW_MS (450ms) in week-view.tsx so consecutive cycles stay independent. */
const MULTI_TAP_SETTLE_MS = 520;

/** Select-first grid: double-click = exactly one state cycle; then let the multi-tap window expire. */
async function cycleCell(page: Page, cell: Locator): Promise<void> {
  await cell.dblclick();
  await page.waitForTimeout(MULTI_TAP_SETTLE_MS);
}

async function waitForHealth(url: string, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}/api/health`);
}

function killServerProcess(proc: ChildProcess | null): void {
  if (!proc || proc.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  } else {
    proc.kill('SIGTERM');
  }
}

async function assertTopBarInsideViewport(
  page: Page,
  viewportWidth: number,
  viewportHeight: number,
): Promise<void> {
  const metrics = await page.evaluate(() => {
    const inner = document.querySelector('.top-bar-inner');
    const rect = inner?.getBoundingClientRect() ?? null;
    return {
      rect: rect
        ? {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
          }
        : null,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });

  expect(metrics.rect).not.toBeNull();
  expect(metrics.rect!.left).toBeGreaterThanOrEqual(0);
  expect(metrics.rect!.right).toBeLessThanOrEqual(viewportWidth + 0.5);
  expect(metrics.rect!.top).toBeGreaterThanOrEqual(0);
  expect(metrics.rect!.bottom).toBeLessThanOrEqual(viewportHeight);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
}

test.describe('UX Upgrade: Geometry Fixes, 1-Click Cycling, Copy/Paste, Settings Accordions, In-App ntfy & Shortcuts', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await resetTestDb();

    const nextBin = path.resolve(
      process.cwd(),
      'node_modules',
      'next',
      'dist',
      'bin',
      'next',
    );
    serverProcess = spawn(
      process.execPath,
      [nextBin, 'start', '-p', String(PORT), '-H', '127.0.0.1'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'production',
          APP_URL: BASE_URL,
        },
        stdio: 'pipe',
      },
    );

    await waitForHealth(BASE_URL);
  });

  test.afterAll(async () => {
    killServerProcess(serverProcess);
    serverProcess = null;
    await resetTestDb();
  });

  test('verifies all Bug A-E fixes, zero-modal cell cycling, copy/paste, multi-select, accordions, 6-dot DnD, ntfy masking & keyboard shortcuts', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    const todayIslamic = resolveIslamicDate(Date.now(), {
      rollover_mode: 'FAJR',
      iana_timezone: 'Africa/Cairo',
      latitude: 30.0444,
      longitude: 31.2357,
      calc_method: 'Egyptian',
      asr_madhhab: 'Shafi',
      prayer_offsets: {
        fajr: 0,
        sunrise: 0,
        dhuhr: 0,
        asr: 0,
        maghrib: 0,
        isha: 0,
      },
    });
    const twoDaysAgo = addDaysIso(todayIslamic, -2);
    const weekDates = getWeekDates(todayIslamic, 6);
    const satDate = weekDates[0]!;
    const friDate = weekDates[6]!;

    // 1. Desktop 1440x900 Light Mode -> Unlock + Starter Pack + Backdate active_from to D-2 for catchup & pre-active_from Sat test coverage
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });

    const unlockInput = page.getByLabel('passcode');
    if (await unlockInput.isVisible()) {
      const passcode = process.env.APP_PASSCODE;
      if (!passcode) {
        throw new Error('APP_PASSCODE is required for ux-upgrade E2E test');
      }
      await unlockInput.fill(passcode);
      await page.getByRole('button', { name: 'فتح الجدول' }).click();
      await expect(unlockInput).toBeHidden({ timeout: 10_000 });
    }

    await seedStarterPackViaBrowser(page);

    // Backdate active_from to D-2 via /api/export + /api/import so yesterday populates 48h catchup while Sat (< D-2) stays pre-active_from
    await page.evaluate(async (activeFrom) => {
      const expRes = await fetch('/api/export', { credentials: 'same-origin' });
      if (!expRes.ok) throw new Error(`Export failed: ${expRes.status}`);
      const snap = (await expRes.json()) as {
        schema_version: number;
        settings: Record<string, unknown>;
        periods: Array<Record<string, unknown>>;
        actions: Array<Record<string, unknown>>;
        target_versions: Array<Record<string, unknown>>;
        daily_logs: Array<Record<string, unknown>>;
      };
      const impRes = await fetch('/api/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'fetch',
        },
        body: JSON.stringify({
          schema_version: 1,
          settings: { ...snap.settings, onboarding_completed: true },
          periods: snap.periods.map((p) => ({ ...p, active_from: activeFrom })),
          actions: snap.actions.map((a) => ({ ...a, active_from: activeFrom })),
          target_versions: snap.target_versions.map((t) => ({
            ...t,
            effective_from: activeFrom,
          })),
          daily_logs: snap.daily_logs,
        }),
      });
      if (!impRes.ok) throw new Error(`Import failed: ${impRes.status}`);
    }, twoDaysAgo);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.day-strip .day-tile')).toHaveCount(7, {
      timeout: 20_000,
    });

    // Clear expected pre-unlock 401 console logs before checking runtime errors
    consoleErrors.length = 0;
    pageErrors.length = 0;

    // 2. Bug E: Light mode computed color-scheme MUST be 'light' (never 'light dark')
    const lightColorScheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    );
    expect(lightColorScheme).toBe('light');

    // 3. Bug A: Topbar .top-bar-inner 100% inside viewport on 1440x900
    await assertTopBarInsideViewport(page, 1440, 900);

    // 4. Opus A1 (Stale-date banner) + 20-min visibilitychange auto-snap + Bug C (الضحى والصباح hides btn-mosque-done)
    await page
      .locator('.day-strip .day-tile:not(:has(.day-tile-dot))')
      .first()
      .click();
    await expect(page.getByTestId('stale-date-banner')).toBeVisible();
    await expect(page.getByTestId('stale-date-banner')).toContainText(
      'أنت تسجّل ليوم',
    );
    await page.getByTestId('stale-date-reset-btn').click();
    await expect(page.getByTestId('stale-date-banner')).toHaveCount(0);

    // 20-min idle auto-snap: short absence (5 min) preserves manual day & period; >20 min absence snaps back to today & live prayer window
    await page
      .locator('.day-strip .day-tile:not(:has(.day-tile-dot))')
      .first()
      .click();
    await page.getByRole('tab', { name: 'الضحى والصباح' }).click();
    await expect(page.getByTestId('stale-date-banner')).toBeVisible();
    await expect(page).toHaveURL(/date=/);
    await expect(page).toHaveURL(/period=/);

    await page.evaluate((deltaMs) => {
      const realNow = Date.now;
      const now = realNow();
      let mockNow = now - deltaMs;
      Date.now = () => mockNow;
      const origDesc = Object.getOwnPropertyDescriptor(
        Document.prototype,
        'visibilityState',
      );
      try {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        mockNow = now;
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        Date.now = realNow;
        if (origDesc) {
          Object.defineProperty(document, 'visibilityState', origDesc);
        } else {
          delete (document as unknown as Record<string, unknown>)
            .visibilityState;
        }
      }
    }, 5 * 60 * 1000);
    // 5-minute away must NOT snap away
    await expect(page.getByTestId('stale-date-banner')).toBeVisible();
    await expect(page).toHaveURL(/period=/);

    await page.evaluate((deltaMs) => {
      const realNow = Date.now;
      const now = realNow();
      let mockNow = now - deltaMs;
      Date.now = () => mockNow;
      const origDesc = Object.getOwnPropertyDescriptor(
        Document.prototype,
        'visibilityState',
      );
      try {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        mockNow = now;
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        Date.now = realNow;
        if (origDesc) {
          Object.defineProperty(document, 'visibilityState', origDesc);
        } else {
          delete (document as unknown as Record<string, unknown>)
            .visibilityState;
        }
      }
    }, 21 * 60 * 1000);
    // >20-minute away snaps back to today & live window cleanly
    await expect(page.getByTestId('stale-date-banner')).toHaveCount(0);
    await expect(page).not.toHaveURL(/date=/);
    await expect(page).not.toHaveURL(/period=/);

    // Verify 12-hour AM/PM clock & live tappable countdown in الآن (live window is active)
    const timeMeta = page.locator('.window-time-meta');
    await expect(timeMeta).toBeVisible();
    await expect(timeMeta).toContainText(/(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)/);
    const liveCountdown = page.getByTestId('period-countdown');
    if ((await liveCountdown.count()) > 0) {
      await expect(liveCountdown).toHaveAttribute('aria-pressed', 'false');
      await expect(liveCountdown).toContainText(/باقي\s+\d+:\d{2}$/);
      await liveCountdown.click();
      await expect(liveCountdown).toHaveAttribute('aria-pressed', 'true');
      await expect(liveCountdown).toContainText(/باقي\s+\d+:\d{2}:\d{2}$/);
      await liveCountdown.click();
      await expect(liveCountdown).toHaveAttribute('aria-pressed', 'false');
      await expect(liveCountdown).toContainText(/باقي\s+\d+:\d{2}$/);
    }

    await page.getByRole('tab', { name: 'الضحى والصباح' }).click();
    await expect(
      page.getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.DHUHA_PRAYER}`),
    ).toBeVisible();
    await expect(page.getByTestId('btn-mosque-done')).toHaveCount(0);
    await expect(page.getByTestId('btn-period-done')).toBeVisible();
    await expect(page.getByTestId('btn-period-done')).toHaveClass(/btn-live/);
    await expect(page.locator('.catchup-bar')).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-now-light.png`,
      fullPage: false,
    });

    // 5. Bug B: Hovering sidebar collapse button renders Portal <Tooltip> 100% inside viewport
    const collapseBtn = page.getByRole('button', { name: 'طي القائمة الجانبية' });
    await collapseBtn.hover();
    const portalTooltip = page.getByRole('tooltip');
    await expect(portalTooltip).toBeVisible();
    await expect(portalTooltip).toHaveClass(/is-ready/);
    await expect(portalTooltip).toContainText('طي القائمة');

    const tipBox = await portalTooltip.boundingBox();
    expect(tipBox).not.toBeNull();
    expect(tipBox!.x).toBeGreaterThanOrEqual(0);
    expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(1440);
    expect(tipBox!.y).toBeGreaterThanOrEqual(0);
    expect(tipBox!.y + tipBox!.height).toBeLessThanOrEqual(900);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-tooltip-hover.png`,
      fullPage: false,
    });
    await page.mouse.move(720, 450);
    await expect(portalTooltip).toBeHidden();

    // 6. Weekly Matrix: Standard 6-dot DnD handle + One-Glance + Zero-Modal 1-Click Cycling + Right-Click Editor + Note Dot
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الجدول الأسبوعي' })
      .click();
    await expect(
      page.getByTestId(`dnd-handle-${STARTER_PACK_ACTION_IDS.FAJR_FARD}`),
    ).toBeVisible();

    // Switch to One-Glance Mode (نظرة واحدة)
    await page.getByRole('tab', { name: 'نظرة واحدة' }).click();
    await expect(page.getByTestId('one-glance-split')).toBeVisible();
    await expect(page.locator('.toolbar-bulk-group')).toBeVisible();
    await assertTopBarInsideViewport(page, 1440, 900);

    // 6a. Select-first: single click only focuses (no state change, no modal);
    // each double-click cycles EMPTY -> DONE -> MISSED -> EMPTY; triple-click = 2 cycles.
    const fajrCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${todayIslamic}`,
    );
    await expect(fajrCell).not.toHaveClass(/st-done|st-missed/);

    await fajrCell.click();
    await expect(fajrCell).toBeFocused();
    await expect(fajrCell).toHaveClass(/is-grid-focused/);
    // Zero spurious vertical/horizontal scrollbars in One-Glance Mode at 1440x900
    const oneGlanceOverflow = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>('.overview-split .ledger-table-wrap'),
      ).map((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
    });
    expect(oneGlanceOverflow.length).toBe(2);
    for (const panel of oneGlanceOverflow) {
      expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    }

    // Pure CSS :has() hover crosshair paints real background on hovered row + column
    await fajrCell.hover();
    const initialHoverBg = await fajrCell.evaluate((el) => {
      const tr = el.closest('tr')!;
      const td = el.closest('td')!;
      return {
        rowBg: getComputedStyle(tr).backgroundColor,
        cellBg: getComputedStyle(td).backgroundColor,
      };
    });
    expect(initialHoverBg.rowBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(initialHoverBg.cellBg).not.toBe('rgba(0, 0, 0, 0)');
    await page.waitForTimeout(MULTI_TAP_SETTLE_MS);
    await fajrCell.click();
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(fajrCell).not.toHaveClass(/st-done|st-missed/);
    await page.waitForTimeout(MULTI_TAP_SETTLE_MS);

    await cycleCell(page, fajrCell);
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(fajrCell).toHaveClass(/st-done/);

    await cycleCell(page, fajrCell);
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(fajrCell).toHaveClass(/st-missed/);

    await cycleCell(page, fajrCell);
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(fajrCell).not.toHaveClass(/st-done|st-missed/);

    // Triple-click on a clean cell: select + DONE + MISSED ("3 clicks = missed")
    await fajrCell.click({ clickCount: 3 });
    await expect(fajrCell).toHaveClass(/st-missed/);
    await page.waitForTimeout(MULTI_TAP_SETTLE_MS);
    await cycleCell(page, fajrCell);
    await expect(fajrCell).not.toHaveClass(/st-done|st-missed/);

    // 6b. Percentage cell (ورد قراءة القرآن) 4 double-clicks: EMPTY -> DONE -> 50% -> MISSED -> EMPTY
    const quranCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}-${todayIslamic}`,
    );
    await cycleCell(page, quranCell);
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(quranCell).toHaveClass(/st-done/);

    await cycleCell(page, quranCell);
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(quranCell).toHaveClass(/st-percent/);
    await expect(quranCell).toContainText('50%');

    await cycleCell(page, quranCell);
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(quranCell).toHaveClass(/st-missed/);

    await cycleCell(page, quranCell);
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(quranCell).not.toHaveClass(/st-done|st-missed|st-percent/);

    // 6c. Right-click cell -> instant chip commit (تم commits & closes immediately + 5s Undo toast), then re-open -> Opus A6 unsaved-note guard on إلغاء -> حفظ وإغلاق saves note -> verify .m-cell-note-dot renders
    const dhuhaCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.DHUHA_PRAYER}-${todayIslamic}`,
    );
    await dhuhaCell.click({ button: 'right' });

    const editorDialog = page.locator('dialog.app-dialog[open]');
    await expect(editorDialog).toBeVisible();
    await editorDialog.getByRole('button', { name: 'تم', exact: true }).click();
    await expect(editorDialog).toBeHidden();
    await expect(dhuhaCell).toHaveClass(/st-done/);
    await expect(page.getByTestId('undo-toast')).toBeVisible();

    await dhuhaCell.click({ button: 'right' });
    await expect(editorDialog).toBeVisible();
    await editorDialog.locator('textarea').fill('ملاحظة اختبار UX');
    await editorDialog.getByRole('button', { name: 'إلغاء' }).click();
    await expect(
      editorDialog.getByTestId('cell-editor-unsaved-banner'),
    ).toBeVisible();
    await editorDialog.getByTestId('cell-editor-save-and-close').click();
    await expect(editorDialog).toBeHidden();

    await expect(dhuhaCell).toHaveClass(/st-done/);
    await expect(dhuhaCell.locator('.m-cell-note-dot')).toBeVisible();

    // 6d. Google-Sheets Copy/Paste: focus DONE cell, Ctrl+C, ArrowDown to DHUHR_FARD, Ctrl+V -> DONE pasted cleanly
    await dhuhaCell.focus();
    await page.keyboard.press('Control+KeyC');
    await expect(dhuhaCell).toHaveClass(/is-grid-copied/);
    await page.keyboard.press('ArrowDown');
    const dhuhrCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.DHUHR_FARD}-${todayIslamic}`,
    );
    await expect(dhuhrCell).toBeFocused();
    await page.keyboard.press('Control+KeyV');
    await expect(dhuhrCell).toHaveClass(/st-done/);

    // 6d-2. User bug: copy, then plain-CLICK a target cell (must NOT cycle it), then paste
    const dhuhrQablCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.DHUHR_QABLIYAH}-${todayIslamic}`,
    );
    await expect(dhuhrQablCell).not.toHaveClass(/st-done|st-missed/);
    await dhuhaCell.focus();
    await page.keyboard.press('Control+KeyC');
    await dhuhrQablCell.click();
    await expect(dhuhrQablCell).not.toHaveClass(/st-done|st-missed/);
    await expect(dhuhaCell).toHaveClass(/is-grid-copied/);
    await page.keyboard.press('Control+KeyV');
    await expect(dhuhrQablCell).toHaveClass(/st-done/);
    await page.waitForTimeout(MULTI_TAP_SETTLE_MS);
    // 6e. Shift+Click 3 cells + Auto-clear after bulk apply
    const asrFardCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ASR_FARD}-${todayIslamic}`,
    );
    const asrJamaahCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ASR_JAMAAH}-${todayIslamic}`,
    );
    const asrAdhkarCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ASR_ADHKAR}-${todayIslamic}`,
    );
    await asrFardCell.focus();
    await asrAdhkarCell.click({ modifiers: ['Shift'] });

    const bulkBar = page.getByTestId('week-bulk-bar');
    await expect(bulkBar).toBeVisible();
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(3);
    await bulkBar.getByRole('button', { name: 'تم للكل' }).click();
    await expect(asrFardCell).toHaveClass(/st-done/);
    await expect(asrJamaahCell).toHaveClass(/st-done/);
    await expect(asrAdhkarCell).toHaveClass(/st-done/);
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);
    await expect(bulkBar).toHaveCount(0);

    // 6f. Global Escape clearing (focus outside grid -> press Escape -> 0 selected & bulk bar gone)
    await asrFardCell.focus();
    await asrAdhkarCell.click({ modifiers: ['Shift'] });
    await expect(bulkBar).toBeVisible();
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(3);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.focus();
    });
    await expect(bulkBar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);
    await expect(bulkBar).toHaveCount(0);

    // 6g. Outside-click clearing (select cells -> click empty space outside table -> 0 selected & bulk bar gone)
    await asrFardCell.focus();
    await asrAdhkarCell.click({ modifiers: ['Shift'] });
    await expect(bulkBar).toBeVisible();
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(3);
    await page.getByTestId('week-hint-strip').click();
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);
    await expect(bulkBar).toHaveCount(0);

    // 6h. Google Sheets Fill Handle drag-to-paint (click ISHA_FARD -> DONE, drag fill-handle across 3 cells below)
    const ishaFardCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ISHA_FARD}-${todayIslamic}`,
    );
    const ishaJamaahCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ISHA_JAMAAH}-${todayIslamic}`,
    );
    const ishaBadiyahCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ISHA_BADIYAH}-${todayIslamic}`,
    );
    const ishaWitrCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ISHA_WITR}-${todayIslamic}`,
    );
    await cycleCell(page, ishaFardCell);
    await expect(ishaFardCell).toHaveClass(/st-done/);

    const ishaFardWrap = ishaFardCell.locator('..');
    const fillHandle = ishaFardWrap.getByTestId('fill-handle');
    await expect(fillHandle).toBeVisible();
    const handleBox = await fillHandle.boundingBox();
    const targetBox = await ishaWitrCell.boundingBox();
    if (!handleBox || !targetBox) {
      throw new Error('Missing boundingBox for fill-handle drag test');
    }

    await page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();

    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(ishaJamaahCell).toHaveClass(/st-done/);
    await expect(ishaBadiyahCell).toHaveClass(/st-done/);
    await expect(ishaWitrCell).toHaveClass(/st-done/);
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);
    await expect(bulkBar).toHaveCount(0);

    // 6i. 1-click Action Title row selection -> 7 cells selected -> press 1 -> all 7 DONE & selection auto-clears
    await page
      .getByRole('button', { name: 'تحديد صف أذكار الصباح' })
      .click();
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(7);
    await expect(bulkBar).toBeVisible();
    await page.keyboard.press('Digit1');
    for (const d of weekDates) {
      await expect(
        page.getByTestId(
          `week-cell-${STARTER_PACK_ACTION_IDS.ADHKAR_MORNING}-${d}`,
        ),
      ).toHaveClass(/st-done/);
    }
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);
    await expect(bulkBar).toHaveCount(0);

    // 6j. Period Header hover quick-complete 2-way toggle (ON -> all DONE -> OFF -> all EMPTY -> Ctrl+Z restores)
    const maghribFardCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.MAGHRIB_FARD}-${todayIslamic}`,
    );
    await maghribFardCell.focus();
    const maghribPeriodTd = page.locator('td.cell-period', {
      hasText: 'المغرب',
    });
    const maghribQuickDoneBtn = maghribPeriodTd.locator('.period-quick-done-btn');
    await maghribPeriodTd.hover();
    await expect(maghribQuickDoneBtn).toHaveAttribute('aria-pressed', 'false');
    await maghribQuickDoneBtn.click();
    const maghribActionIds = [
      STARTER_PACK_ACTION_IDS.MAGHRIB_FARD,
      STARTER_PACK_ACTION_IDS.MAGHRIB_JAMAAH,
      STARTER_PACK_ACTION_IDS.MAGHRIB_BADIYAH,
      STARTER_PACK_ACTION_IDS.MAGHRIB_ADHKAR,
    ];
    for (const actionId of maghribActionIds) {
      await expect(
        page.getByTestId(`week-cell-${actionId}-${todayIslamic}`),
      ).toHaveClass(/st-done/);
    }
    await expect(maghribQuickDoneBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(maghribQuickDoneBtn).toHaveClass(/is-all-done/);

    // 2nd click toggles OFF -> clears all Maghrib actions back to EMPTY
    await maghribQuickDoneBtn.click();
    for (const actionId of maghribActionIds) {
      await expect(
        page.getByTestId(`week-cell-${actionId}-${todayIslamic}`),
      ).not.toHaveClass(/st-done/);
    }
    await expect(maghribQuickDoneBtn).toHaveAttribute('aria-pressed', 'false');

    // Ctrl+Z restores Maghrib back to all DONE
    await page.keyboard.press('Control+KeyZ');
    for (const actionId of maghribActionIds) {
      await expect(
        page.getByTestId(`week-cell-${actionId}-${todayIslamic}`),
      ).toHaveClass(/st-done/);
    }
    await expect(maghribQuickDoneBtn).toHaveAttribute('aria-pressed', 'true');

    // 6j-2. Slow 160ms human Shift+Click & Ctrl+Click on cells (must NOT get wiped by click handler)
    const slowAnchorCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${weekDates[1]!}`,
    );
    const slowTargetCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_ADHKAR}-${weekDates[1]!}`,
    );
    await slowAnchorCell.focus();
    const slowTargetBox = await slowTargetCell.boundingBox();
    if (!slowTargetBox) throw new Error('Missing boundingBox for slow Shift+Click');
    await page.keyboard.down('Shift');
    await page.mouse.move(
      slowTargetBox.x + slowTargetBox.width / 2,
      slowTargetBox.y + slowTargetBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(160);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(4);
    await expect(bulkBar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);

    // Slow 160ms human Ctrl+Click disjoint toggle on 2 cells
    const slowCtrlBox1 = await slowAnchorCell.boundingBox();
    if (!slowCtrlBox1) throw new Error('Missing boundingBox for slow Ctrl+Click');
    await page.keyboard.down('Control');
    await page.mouse.move(
      slowCtrlBox1.x + slowCtrlBox1.width / 2,
      slowCtrlBox1.y + slowCtrlBox1.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(160);
    await page.mouse.up();
    await page.mouse.move(
      slowTargetBox.x + slowTargetBox.width / 2,
      slowTargetBox.y + slowTargetBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForTimeout(160);
    await page.mouse.up();
    await page.keyboard.up('Control');
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);

    // 6j-3. Period Header Multi-Select: Shift+Click (الفجر -> العصر), Ctrl+Click (toggle المغرب), and Pointer Hold-Drag (الفجر -> الظهر)
    await fajrCell.focus();
    const fajrPeriodBtn = page
      .locator('td.cell-period', { hasText: 'الفجر' })
      .locator('.period-select-btn');
    const dhuhrPeriodBtn = page
      .locator('td.cell-period', { hasText: 'الظهر' })
      .locator('.period-select-btn');
    const asrPeriodBtn = page
      .locator('td.cell-period', { hasText: 'العصر' })
      .locator('.period-select-btn');
    const maghribPeriodBtn = maghribPeriodTd.locator('.period-select-btn');

    await fajrPeriodBtn.click();
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(4);
    await asrPeriodBtn.click({ modifiers: ['Shift'] });
    // الفجر (4) + الضحى والصباح (1) + الظهر (5) + العصر (3) = 13 cells
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(13);
    await maghribPeriodBtn.click({ modifiers: ['Control'] });
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(17);
    await maghribPeriodBtn.click({ modifiers: ['Control'] });
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(13);
    await page.keyboard.press('Escape');
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);

    // Pointer hold-drag across period headers: الفجر -> الظهر (4 + 1 + 5 = 10 cells)
    const fajrPeriodBox = await fajrPeriodBtn.boundingBox();
    const dhuhrPeriodBox = await dhuhrPeriodBtn.boundingBox();
    if (!fajrPeriodBox || !dhuhrPeriodBox) {
      throw new Error('Missing boundingBox for period drag-select test');
    }
    await page.mouse.move(
      fajrPeriodBox.x + fajrPeriodBox.width / 2,
      fajrPeriodBox.y + fajrPeriodBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      dhuhrPeriodBox.x + dhuhrPeriodBox.width / 2,
      dhuhrPeriodBox.y + dhuhrPeriodBox.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(10);
    await expect(bulkBar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);

    // 6k. Unrestricted past (pre-active_from Sat) & future (Fri) editing + persistence across reload
    const pastPreActiveDate =
      satDate < twoDaysAgo ? satDate : addDaysIso(twoDaysAgo, -1);
    const futureDate =
      friDate > todayIslamic ? friDate : addDaysIso(todayIslamic, 1);

    if (satDate >= twoDaysAgo) {
      await page.getByRole('button', { name: 'الأسبوع السابق' }).click();
    }
    const pastCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${pastPreActiveDate}`,
    );
    await cycleCell(page, pastCell);
    await expect(pastCell).toHaveClass(/st-done/);
    if (satDate >= twoDaysAgo) {
      await page.getByRole('button', { name: 'اليوم', exact: true }).click();
    }

    if (friDate <= todayIslamic) {
      await page.getByRole('button', { name: 'الأسبوع التالي' }).click();
    }
    const futureCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${futureDate}`,
    );
    await cycleCell(page, futureCell);
    await expect(futureCell).toHaveClass(/st-done/);
    if (friDate <= todayIslamic) {
      await page.getByRole('button', { name: 'اليوم', exact: true }).click();
    }

    // 6l. Aggressive rapid pointer-sweep crosshair check across One-Glance Split Mode & Standard Mode (zero stuck cells, zero mismatches)
    const verifyCrosshairSweep = async (
      targets: Array<{
        tableSelector: string;
        actionId: string;
        date: string;
        colIdx: number;
      }>,
    ) => {
      for (const target of targets) {
        const cell = page.getByTestId(
          `week-cell-${target.actionId}-${target.date}`,
        );
        const box = await cell.boundingBox();
        if (!box) {
          throw new Error(
            `Missing boundingBox for crosshair sweep target ${target.actionId}-${target.date}`,
          );
        }
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const audit = await page.evaluate(
          ({ tableSelector, actionId, date, colIdx }) => {
            const activeTable = document.querySelector<HTMLTableElement>(tableSelector);
            const btn = document.querySelector<HTMLElement>(
              `[data-testid="week-cell-${actionId}-${date}"]`,
            );
            const activeTr = btn?.closest('tr');
            if (!activeTable || !activeTr) {
              return { ok: false, reason: 'missing active table or row' };
            }
            const transparent = 'rgba(0, 0, 0, 0)';
            const litRows = Array.from(
              document.querySelectorAll<HTMLTableRowElement>(
                'table.ledger-table tbody tr.data-row',
              ),
            ).filter((tr) => getComputedStyle(tr).backgroundColor !== transparent);
            if (litRows.length !== 1 || litRows[0] !== activeTr) {
              return {
                ok: false,
                reason: `expected 1 lit row (activeTr), got ${litRows.length}`,
              };
            }
            const litColsInActive = new Set<number>();
            for (const td of Array.from(
              activeTable.querySelectorAll<HTMLTableCellElement>(
                'td.cell-status[data-col-index]',
              ),
            )) {
              if (getComputedStyle(td).backgroundColor !== transparent) {
                litColsInActive.add(Number(td.dataset.colIndex));
              }
            }
            if (
              litColsInActive.size !== 1 ||
              !litColsInActive.has(colIdx)
            ) {
              return {
                ok: false,
                reason: `expected only col ${colIdx} lit, got [${Array.from(litColsInActive).join(',')}]`,
              };
            }
            const otherTables = Array.from(
              document.querySelectorAll<HTMLTableElement>('table.ledger-table'),
            ).filter((t) => t !== activeTable);
            for (const other of otherTables) {
              const leakedTd = Array.from(
                other.querySelectorAll<HTMLTableCellElement>('td.cell-status'),
              ).some((td) => getComputedStyle(td).backgroundColor !== transparent);
              if (leakedTd) {
                return { ok: false, reason: 'crosshair leaked into sibling table' };
              }
            }
            return { ok: true, reason: '' };
          },
          target,
        );
        expect(audit, `Crosshair sweep mismatch on ${target.actionId} col ${target.colIdx}: ${audit.reason}`).toEqual({
          ok: true,
          reason: '',
        });
      }
    };

    const todayColIdx = weekDates.indexOf(todayIslamic);
    // Focus fajrCell first, then rapidly sweep across BOTH split tables + period spacers
    await fajrCell.focus();
    await verifyCrosshairSweep([
      {
        tableSelector: '.overview-table-time',
        actionId: STARTER_PACK_ACTION_IDS.FAJR_FARD,
        date: weekDates[0]!,
        colIdx: 0,
      },
      {
        tableSelector: '.overview-table-time',
        actionId: STARTER_PACK_ACTION_IDS.FAJR_JAMAAH,
        date: weekDates[2]!,
        colIdx: 2,
      },
      {
        tableSelector: '.overview-table-time',
        actionId: STARTER_PACK_ACTION_IDS.DHUHA_PRAYER,
        date: weekDates[4]!,
        colIdx: 4,
      },
      {
        tableSelector: '.overview-table-time',
        actionId: STARTER_PACK_ACTION_IDS.DHUHR_FARD,
        date: weekDates[todayColIdx]!,
        colIdx: todayColIdx,
      },
      {
        tableSelector: '.overview-table-time',
        actionId: STARTER_PACK_ACTION_IDS.ASR_FARD,
        date: weekDates[6]!,
        colIdx: 6,
      },
      {
        tableSelector: '.overview-table-daily',
        actionId: STARTER_PACK_ACTION_IDS.QURAN_WIRD,
        date: weekDates[1]!,
        colIdx: 1,
      },
      {
        tableSelector: '.overview-table-daily',
        actionId: STARTER_PACK_ACTION_IDS.ADHKAR_MORNING,
        date: weekDates[3]!,
        colIdx: 3,
      },
      {
        tableSelector: '.overview-table-daily',
        actionId: STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE,
        date: weekDates[5]!,
        colIdx: 5,
      },
      {
        tableSelector: '.overview-table-time',
        actionId: STARTER_PACK_ACTION_IDS.ISHA_FARD,
        date: weekDates[todayColIdx]!,
        colIdx: todayColIdx,
      },
    ]);

    // Verify hover crosshair survives React re-render while cycling a cell under the cursor
    await fajrCell.hover();
    await cycleCell(page, fajrCell);
    await expect(fajrCell).toHaveClass(/st-done/);
    const afterCycleHoverBg = await fajrCell.evaluate((el) => ({
      rowBg: getComputedStyle(el.closest('tr')!).backgroundColor,
      cellBg: getComputedStyle(el.closest('td')!).backgroundColor,
    }));
    expect(afterCycleHoverBg.rowBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(afterCycleHoverBg.cellBg).not.toBe('rgba(0, 0, 0, 0)');
    await cycleCell(page, fajrCell);
    await cycleCell(page, fajrCell);
    await expect(fajrCell).not.toHaveClass(/st-done|st-missed/);

    // Moving pointer outside table clears hover crosshair and cleanly falls back to focus crosshair
    await page.mouse.move(10, 10);
    await expect(fajrCell.locator('xpath=ancestor::tr[1]')).toHaveClass(
      /is-row-crosshair/,
    );
    await expect(
      page.locator('.overview-table-time thead th.col-day').nth(todayColIdx),
    ).toHaveClass(/is-col-crosshair/);
    const fallbackRowBg = await fajrCell.evaluate(
      (el) => getComputedStyle(el.closest('tr')!).backgroundColor,
    );
    expect(fallbackRowBg).not.toBe('rgba(0, 0, 0, 0)');

    // Also run rapid crosshair sweep in Standard Mode (العرض المريح) across group-row separators!
    await page.getByRole('tab', { name: 'العرض المريح' }).click();
    await expect(page.locator('table.ledger-table tr.group-row').first()).toBeVisible();
    await verifyCrosshairSweep([
      {
        tableSelector: 'table.ledger-table',
        actionId: STARTER_PACK_ACTION_IDS.FAJR_FARD,
        date: weekDates[0]!,
        colIdx: 0,
      },
      {
        tableSelector: 'table.ledger-table',
        actionId: STARTER_PACK_ACTION_IDS.FAJR_SUNNAH,
        date: weekDates[3]!,
        colIdx: 3,
      },
      {
        tableSelector: 'table.ledger-table',
        actionId: STARTER_PACK_ACTION_IDS.DHUHA_PRAYER,
        date: weekDates[5]!,
        colIdx: 5,
      },
      {
        tableSelector: 'table.ledger-table',
        actionId: STARTER_PACK_ACTION_IDS.DHUHR_FARD,
        date: weekDates[1]!,
        colIdx: 1,
      },
      {
        tableSelector: 'table.ledger-table',
        actionId: STARTER_PACK_ACTION_IDS.ASR_FARD,
        date: weekDates[todayColIdx]!,
        colIdx: todayColIdx,
      },
    ]);
    // Moving onto a group-row separator clears hover highlight cleanly
    const groupRowBox = await page
      .locator('table.ledger-table tr.group-row')
      .first()
      .boundingBox();
    if (groupRowBox) {
      await page.mouse.move(
        groupRowBox.x + groupRowBox.width / 2,
        groupRowBox.y + groupRowBox.height / 2,
      );
      const anyHoveredTd = await page.evaluate(() =>
        document.querySelector('table.ledger-table td.cell-status:hover') !== null,
      );
      expect(anyHoveredTd).toBe(false);
    }
    // Switch back to One-Glance Mode for remaining desktop tests
    await page.getByRole('tab', { name: 'نظرة واحدة' }).click();
    await expect(page.getByTestId('one-glance-split')).toBeVisible();

    // 6m. Global Ctrl+Z after bulk bar click + focus restoration + Ctrl+Y Redo
    const habitNoSnoozeCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.HABIT_NO_SNOOZE}-${todayIslamic}`,
    );
    const habitLowerGazeCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.HABIT_LOWER_GAZE}-${todayIslamic}`,
    );
    await habitNoSnoozeCell.focus();
    await habitLowerGazeCell.click({ modifiers: ['Shift'] });
    await expect(bulkBar).toBeVisible();
    await bulkBar.getByRole('button', { name: 'تم للكل' }).click();
    await expect(habitNoSnoozeCell).toHaveClass(/st-done/);
    await expect(habitLowerGazeCell).toHaveClass(/st-done/);
    await expect(habitLowerGazeCell).toBeFocused();

    await page.keyboard.press('Control+KeyZ');
    await expect(habitNoSnoozeCell).not.toHaveClass(/st-done/);
    await expect(habitLowerGazeCell).not.toHaveClass(/st-done/);

    await page.keyboard.press('Control+KeyY');
    await expect(habitNoSnoozeCell).toHaveClass(/st-done/);
    await expect(habitLowerGazeCell).toHaveClass(/st-done/);

    // 6n. Ctrl+D Fill Down from ADHKAR_MORNING (DONE) into ADHKAR_EVENING
    const adhkarEveningCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ADHKAR_EVENING}-${todayIslamic}`,
    );
    const adhkarSleepCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ADHKAR_SLEEP}-${todayIslamic}`,
    );
    await adhkarEveningCell.focus();
    await page.keyboard.press('Control+KeyD');
    await expect(adhkarEveningCell).toHaveClass(/st-done/);

    // 6o. Ctrl+X Cut ADHKAR_EVENING -> EMPTY, then Ctrl+V onto ADHKAR_SLEEP
    await adhkarEveningCell.focus();
    await page.keyboard.press('Control+KeyX');
    await expect(adhkarEveningCell).not.toHaveClass(/st-done/);
    await page.keyboard.press('ArrowDown');
    await expect(adhkarSleepCell).toBeFocused();
    await page.keyboard.press('Control+KeyV');
    await expect(adhkarSleepCell).toHaveClass(/st-done/);

    // 6p. Ctrl+A Select All active side (TIME_BOUND) + outer perimeter classes + Esc focus restore
    await fajrCell.focus();
    await page.keyboard.press('Control+KeyA');
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toContainText('161 خانة');
    const firstTimeBoundCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${weekDates[0]!}`,
    );
    const lastTimeBoundCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ISHA_FILL_MOHASBA}-${weekDates[6]!}`,
    );
    await expect(firstTimeBoundCell).toHaveClass(/is-sel-top/);
    await expect(firstTimeBoundCell).toHaveClass(/is-sel-start/);
    await expect(lastTimeBoundCell).toHaveClass(/is-sel-bottom/);
    await expect(lastTimeBoundCell).toHaveClass(/is-sel-end/);
    const nativeSelectedText = await page.evaluate(
      () => window.getSelection()?.toString() ?? '',
    );
    expect(nativeSelectedText).toBe('');
    await page.keyboard.press('Escape');
    await expect(bulkBar).toHaveCount(0);
    await expect(fajrCell).toBeFocused();

    // 6q. Ctrl+Click non-contiguous multi-selection -> Digit1 marks both DONE
    const fajrJamaahCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_JAMAAH}-${todayIslamic}`,
    );
    const habitCharityCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.HABIT_CHARITY_OR_KINDNESS}-${todayIslamic}`,
    );
    await fajrJamaahCell.click({ modifiers: ['Control'] });
    await habitCharityCell.click({ modifiers: ['Control'] });
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toContainText('خانتين');
    await page.keyboard.press('Digit1');
    await expect(fajrJamaahCell).toHaveClass(/st-done/);
    await expect(habitCharityCell).toHaveClass(/st-done/);
    await expect(bulkBar).toHaveCount(0);

    // 6r. Fill Handle double-click auto-fill to end of DHUHR period
    await dhuhrCell.focus();
    await dhuhrCell.locator('..').getByTestId('fill-handle').dblclick();
    for (const actionId of [
      STARTER_PACK_ACTION_IDS.DHUHR_JAMAAH,
      STARTER_PACK_ACTION_IDS.DHUHR_QABLIYAH,
      STARTER_PACK_ACTION_IDS.DHUHR_BADIYAH,
      STARTER_PACK_ACTION_IDS.DHUHR_ADHKAR,
    ]) {
      await expect(
        page.getByTestId(`week-cell-${actionId}-${todayIslamic}`),
      ).toHaveClass(/st-done/);
    }

    // 6s. Opus A5: Ctrl+Z note protection — cycle cell A, save newer note via CellEditor, let toast expire, Ctrl+Z must NOT wipe newer note
    const fajrAdhkarCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_ADHKAR}-${todayIslamic}`,
    );
    await cycleCell(page, fajrAdhkarCell);
    await expect(fajrAdhkarCell).toHaveClass(/st-done/);
    await fajrAdhkarCell.click({ button: 'right' });
    await expect(editorDialog).toBeVisible();
    await editorDialog.locator('textarea').fill('ملاحظة محمية من التراجع');
    await editorDialog.getByTestId('cell-editor-save').click();
    await expect(editorDialog).toBeHidden();
    await expect(fajrAdhkarCell.locator('.m-cell-note-dot')).toBeVisible();

    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8_000 });
    await fajrAdhkarCell.focus();
    await page.keyboard.press('Control+KeyZ');
    await expect(fajrAdhkarCell).toHaveClass(/st-done/);
    await expect(fajrAdhkarCell.locator('.m-cell-note-dot')).toBeVisible();

    // 6t. User Decision #2: Multi-cell Right-Click Context Menu -> تم للكل marks 3 cells st-done, closes menu & clears selection
    const otherWeekDate = weekDates.find((d) => d !== todayIslamic)!;
    const ctxAsrFard = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ASR_FARD}-${otherWeekDate}`,
    );
    const ctxAsrJamaah = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ASR_JAMAAH}-${otherWeekDate}`,
    );
    const ctxAsrAdhkar = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.ASR_ADHKAR}-${otherWeekDate}`,
    );
    await ctxAsrFard.focus();
    await ctxAsrAdhkar.click({ modifiers: ['Shift'] });
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(3);
    await ctxAsrJamaah.click({ button: 'right' });

    const contextMenu = page.getByTestId('week-context-menu');
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByRole('menuitem', { name: 'تم للكل' }).click();
    await expect(ctxAsrFard).toHaveClass(/st-done/);
    await expect(ctxAsrJamaah).toHaveClass(/st-done/);
    await expect(ctxAsrAdhkar).toHaveClass(/st-done/);
    await expect(contextMenu).toHaveCount(0);
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);

    // Put Quran cell into 50% and Fajr Fard into DONE for a rich One-Glance screenshot, then wait for sync
    await cycleCell(page, quranCell);
    await cycleCell(page, quranCell);
    await expect(quranCell).toContainText('50%');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-week-oneglance-light.png`,
      fullPage: false,
    });
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-week-fill-handle.png`,
      fullPage: false,
    });

    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8_000 });
    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 10_000 },
    );

    // Reload and verify unrestricted past (pre-active_from) & future edits persisted in Postgres
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الجدول الأسبوعي' })
      .click();
    await page.getByRole('tab', { name: 'نظرة واحدة' }).click();

    if (satDate >= twoDaysAgo) {
      await page.getByRole('button', { name: 'الأسبوع السابق' }).click();
    }
    await expect(
      page.getByTestId(
        `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${pastPreActiveDate}`,
      ),
    ).toHaveClass(/st-done/);
    if (satDate >= twoDaysAgo) {
      await page.getByRole('button', { name: 'اليوم', exact: true }).click();
    }

    if (friDate <= todayIslamic) {
      await page.getByRole('button', { name: 'الأسبوع التالي' }).click();
    }
    await expect(
      page.getByTestId(
        `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${futureDate}`,
      ),
    ).toHaveClass(/st-done/);
    if (friDate <= todayIslamic) {
      await page.getByRole('button', { name: 'اليوم', exact: true }).click();
    }

    // 7. Settings: Accordions, 6-Dot DnD (zero arrow buttons), In-App ntfy, Keyboard Shortcuts, General Preferences
    await page.getByRole('button', { name: 'فتح القائمة الجانبية' }).click();
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الإعدادات' })
      .click();

    const accordionKeys = [
      'general',
      'periods',
      'actions',
      'rollover',
      'ntfy',
      'shortcuts',
      'backup',
    ] as const;
    for (const key of accordionKeys) {
      await expect(page.getByTestId(`accordion-toggle-${key}`)).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
    await expect(page.locator('.accordion-body')).toHaveCount(0);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-settings-collapsed-light.png`,
      fullPage: false,
    });

    // Click توسيع الكل -> all 7 accordions expand, zero arrow reorder buttons exist, 6-dot drag handles exist
    await page.getByTestId('settings-expand-all-btn').click();
    await expect(page.locator('.accordion-body')).toHaveCount(7);

    await expect(
      page.locator('[data-testid*="move-up"], [data-testid*="move-down"]'),
    ).toHaveCount(0);
    await expect(
      page
        .getByTestId('settings-periods-section')
        .getByTestId(`period-drag-handle-${STARTER_PACK_PERIOD_IDS.FAJR}`),
    ).toBeVisible();
    await page
      .getByTestId(`actions-period-toggle-${STARTER_PACK_PERIOD_IDS.FAJR}`)
      .click();
    await expect(
      page
        .getByTestId('settings-actions-section')
        .getByTestId(`action-drag-handle-${STARTER_PACK_ACTION_IDS.FAJR_FARD}`),
    ).toBeVisible();

    // Collapse everything first, then open only ntfy & shortcuts for clean screenshot & focused testing
    await page.getByTestId('settings-collapse-all-btn').click();
    await page.getByTestId('accordion-toggle-ntfy').click();
    await page.getByTestId('accordion-toggle-shortcuts').click();

    // 7a. In-app ntfy: generate secure topic URL -> save -> verify masked hint & zero secret leaks
    await page.getByTestId('ntfy-generate-btn').click();
    const generatedUrl = await page
      .getByTestId('ntfy-topic-url-input')
      .inputValue();
    expect(generatedUrl.startsWith('https://ntfy.sh/mohasba-')).toBe(true);
    await page.getByTestId('ntfy-save-btn').click();
    await expect(page.getByTestId('ntfy-topic-hint')).toContainText('••••');
    await expect(page.getByTestId('ntfy-configured-badge')).toContainText(
      'مُعدّ من التطبيق',
    );

    // 7b. Keyboard Shortcuts: verify dual dir="ltr" <kbd> caps, capture screenshot, then record custom shortcut
    const navAnalyticsRow = page.getByTestId('shortcut-row-nav_analytics');
    const kbdGroup = navAnalyticsRow.locator('.kbd-group');
    await expect(kbdGroup).toHaveAttribute('dir', 'ltr');
    await expect(kbdGroup.locator('kbd.kbd-cap')).toHaveCount(2);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-settings-ntfy-shortcuts-light.png`,
      fullPage: true,
    });

    await page.getByTestId('shortcut-edit-nav_analytics').click();
    await expect(
      page.getByTestId('shortcut-recording-nav_analytics'),
    ).toBeVisible();
    await page.keyboard.press('Alt+KeyA');
    await expect(page.getByTestId('shortcuts-feedback')).toContainText(
      'تم تحديث اختصار',
    );
    await expect(navAnalyticsRow).toContainText('مخصص');
    await expect(navAnalyticsRow.locator('kbd.kbd-cap').last()).toContainText(
      'A / ش',
    );

    // Reload and verify ntfy masking + secret absence from /api/bootstrap & /api/export + shortcut persistence
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('accordion-toggle-ntfy').click();
    await expect(page.getByTestId('ntfy-topic-hint')).toContainText('••••');

    const secretLeakCheck = await page.evaluate(async (rawSecret) => {
      const [bootRes, expRes] = await Promise.all([
        fetch('/api/bootstrap', { credentials: 'same-origin' }),
        fetch('/api/export', { credentials: 'same-origin' }),
      ]);
      const bootText = await bootRes.text();
      const expText = await expRes.text();
      return {
        bootHasRaw: bootText.includes(rawSecret),
        expHasRaw: expText.includes(rawSecret),
      };
    }, generatedUrl);
    expect(secretLeakCheck.bootHasRaw).toBe(false);
    expect(secretLeakCheck.expHasRaw).toBe(false);

    await page.getByTestId('accordion-toggle-shortcuts').click();
    await expect(page.getByTestId('shortcut-row-nav_analytics')).toContainText(
      'مخصص',
    );

    // Test newly persisted custom shortcut Alt+KeyA -> navigates to التحليلات
    await page.keyboard.press('Alt+KeyA');
    await expect(page.getByTestId('analytics-pulse')).toBeVisible();

    // 7c. General Preferences: show_catchup_banner = false & default_home_view = 'week'
    // First create 1 Qadaa-eligible miss on Fajr Sunnah so القضاء badge stays visible (> 0)
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الآن' })
      .click();
    await page.getByRole('tab', { name: 'الفجر' }).click();
    await page
      .getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.FAJR_SUNNAH}`)
      .getByRole('button', { name: /تسجيل فات للعمل/ })
      .click();
    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8_000 });

    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الإعدادات' })
      .click();
    await page.getByTestId('accordion-toggle-general').click();
    const catchupToggle = page.getByTestId('pref-show-catchup-banner');
    await expect(catchupToggle).toBeChecked();
    await catchupToggle.uncheck();
    await expect(page.getByTestId('general-prefs-feedback')).toBeVisible();

    // Verify 48h catchup banner disappears on الآن while القضاء badge stays intact
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الآن' })
      .click();
    await expect(page.locator('.catchup-bar')).toHaveCount(0);
    await expect(
      page.locator('.desktop-rail .nav-btn', { hasText: 'القضاء' }).locator('.count-chip'),
    ).toContainText('1');

    // Set enter_key_mode = 'move_down' & default_home_view = 'week' -> reload bare / -> lands directly on الجدول الأسبوعي
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الإعدادات' })
      .click();
    await page.getByTestId('accordion-toggle-general').click();
    await page
      .getByTestId('pref-enter-key-mode')
      .getByTestId('pref-enter-key-mode-move_down')
      .click();
    await expect(
      page.getByTestId('pref-enter-key-mode-move_down'),
    ).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('pref-home-view-week').click();
    await expect(page.getByTestId('general-prefs-feedback')).toBeVisible();

    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.page-heading')).toHaveText('الجدول الأسبوعي');
    await expect(page.locator('.matrix-desktop-wrap')).toBeVisible();

    // User Decision #1: Enter moves focus down from row 0 (FAJR_FARD) to row 1 (FAJR_JAMAAH) with zero dialog; F2 opens CellEditorDialog
    const row0Cell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${todayIslamic}`,
    );
    const row1Cell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_JAMAAH}-${todayIslamic}`,
    );
    await row0Cell.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(row1Cell).toBeFocused();
    await page.keyboard.press('F2');
    await expect(page.locator('dialog.app-dialog[open]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.app-dialog[open]')).toBeHidden();

    // 8. Mobile 390x844 Light & Dark checks + screenshots
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.m-whoop-row').first()).toBeVisible();
    await assertTopBarInsideViewport(page, 390, 844);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-week-light.png`,
      fullPage: false,
    });

    await page.getByTestId('theme-toggle-btn').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkColorScheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    );
    expect(darkColorScheme).toBe('dark');

    await page
      .locator('.mobile-nav')
      .getByRole('button', { name: 'الإعدادات' })
      .click();
    await page.getByTestId('accordion-toggle-ntfy').click();
    await assertTopBarInsideViewport(page, 390, 844);
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-settings-dark.png`,
      fullPage: true,
    });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
