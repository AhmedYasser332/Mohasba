import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addDaysIso, getWeekDates, resolveIslamicDate } from '../../src/domain/prayer-engine';
import {
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '../../src/domain/starter-pack';
import { loadTestEnv } from '../helpers/load-env';
import { resetTestDb } from '../helpers/reset-test-db';

loadTestEnv();

const PORT = 3104;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR =
  'C:/Users/ahmed/.gemini/antigravity/brain/f71a0285-daff-460c-9b19-50e9a1762d6f/scratch/screenshots/ux-upgrade';

let serverProcess: ChildProcess | null = null;

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

    const starterBtn = page.getByTestId('onboarding-starter-pack');
    await expect(starterBtn).toBeVisible({ timeout: 10_000 });
    await starterBtn.click();
    await expect(page.locator('.day-strip .day-tile')).toHaveCount(7);

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
    await expect(page.locator('.day-strip .day-tile')).toHaveCount(7);

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

    // 4. Bug C: الضحى والصباح hides btn-mosque-done (no dead disabled mosque button)
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

    // 6a. Left-click binary cell 3 times: EMPTY -> DONE -> MISSED -> EMPTY with ZERO modal popup
    const fajrCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${todayIslamic}`,
    );
    await expect(fajrCell).not.toHaveClass(/st-done|st-missed/);

    await fajrCell.click();
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(fajrCell).toHaveClass(/st-done/);

    await fajrCell.click();
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(fajrCell).toHaveClass(/st-missed/);

    await fajrCell.click();
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(fajrCell).not.toHaveClass(/st-done|st-missed/);

    // 6b. Left-click percentage cell (ورد قراءة القرآن) 4 times: EMPTY -> DONE -> 50% -> MISSED -> EMPTY
    const quranCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}-${todayIslamic}`,
    );
    await quranCell.click();
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(quranCell).toHaveClass(/st-done/);

    await quranCell.click();
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(quranCell).toHaveClass(/st-percent/);
    await expect(quranCell).toContainText('50%');

    await quranCell.click();
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(quranCell).toHaveClass(/st-missed/);

    await quranCell.click();
    await expect(page.locator('dialog.app-dialog[open]')).toHaveCount(0);
    await expect(quranCell).not.toHaveClass(/st-done|st-missed|st-percent/);

    // 6c. Right-click cell -> opens CellEditorDialog, saves DONE + personal note -> verify .m-cell-note-dot renders
    const dhuhaCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.DHUHA_PRAYER}-${todayIslamic}`,
    );
    await dhuhaCell.click({ button: 'right' });

    const editorDialog = page.locator('dialog.app-dialog[open]');
    await expect(editorDialog).toBeVisible();
    await editorDialog.getByRole('button', { name: 'تم', exact: true }).click();
    await editorDialog.locator('textarea').fill('ملاحظة اختبار UX');
    await editorDialog.getByTestId('cell-editor-save').click();
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
    await ishaFardCell.click();
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

    // 6j. Period Header hover quick-complete -> hover .cell-period and click .period-quick-done-btn
    const maghribFardCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.MAGHRIB_FARD}-${todayIslamic}`,
    );
    await maghribFardCell.focus();
    const maghribPeriodTd = page.locator('td.cell-period', {
      hasText: 'المغرب',
    });
    await maghribPeriodTd.hover();
    await maghribPeriodTd.locator('.period-quick-done-btn').click();
    for (const actionId of [
      STARTER_PACK_ACTION_IDS.MAGHRIB_FARD,
      STARTER_PACK_ACTION_IDS.MAGHRIB_JAMAAH,
      STARTER_PACK_ACTION_IDS.MAGHRIB_BADIYAH,
      STARTER_PACK_ACTION_IDS.MAGHRIB_ADHKAR,
    ]) {
      await expect(
        page.getByTestId(`week-cell-${actionId}-${todayIslamic}`),
      ).toHaveClass(/st-done/);
    }

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
    await pastCell.click();
    await expect(pastCell).toHaveClass(/st-done/);
    if (satDate >= twoDaysAgo) {
      await page.getByRole('button', { name: 'الأسبوع الحالي' }).click();
    }

    if (friDate <= todayIslamic) {
      await page.getByRole('button', { name: 'الأسبوع التالي' }).click();
    }
    const futureCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${futureDate}`,
    );
    await futureCell.click();
    await expect(futureCell).toHaveClass(/st-done/);
    if (friDate <= todayIslamic) {
      await page.getByRole('button', { name: 'الأسبوع الحالي' }).click();
    }

    // 6l. Crosshair hover & focus highlight (.is-row-crosshair & .is-col-crosshair)
    await fajrCell.hover();
    await expect(fajrCell.locator('xpath=ancestor::tr[1]')).toHaveClass(
      /is-row-crosshair/,
    );
    const todayColIdx = weekDates.indexOf(todayIslamic);
    await expect(
      page.locator('.overview-table-time thead th.col-day').nth(todayColIdx),
    ).toHaveClass(/is-col-crosshair/);
    await fajrCell.focus();
    await page.mouse.move(10, 10);
    await expect(fajrCell.locator('xpath=ancestor::tr[1]')).toHaveClass(
      /is-row-crosshair/,
    );

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

    // Put Quran cell into 50% and Fajr Fard into DONE for a rich One-Glance screenshot, then wait for sync
    await quranCell.click();
    await quranCell.click();
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
      await page.getByRole('button', { name: 'الأسبوع الحالي' }).click();
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
      await page.getByRole('button', { name: 'الأسبوع الحالي' }).click();
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

    // Set default_home_view = 'week' -> reload bare / -> lands directly on الجدول الأسبوعي
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الإعدادات' })
      .click();
    await page.getByTestId('accordion-toggle-general').click();
    await page.getByTestId('pref-home-view-week').click();
    await expect(page.getByTestId('general-prefs-feedback')).toBeVisible();

    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('.page-heading')).toHaveText('الجدول الأسبوعي');
    await expect(page.locator('.matrix-desktop-wrap')).toBeVisible();

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
