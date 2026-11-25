import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { STARTER_PACK_ACTION_IDS } from '../../src/domain/starter-pack';
import { loadTestEnv } from '../helpers/load-env';
import { resetTestDb } from '../helpers/reset-test-db';

loadTestEnv();

const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR =
  'C:/Users/ahmed/.gemini/antigravity/brain/f71a0285-daff-460c-9b19-50e9a1762d6f/scratch/screenshots/slice4';

let serverProcess: ChildProcess | null = null;

async function waitForHealth(url: string, timeoutMs = 20_000): Promise<void> {
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

test.describe('Slice 4: App Shell, Street Mode (الآن), Weekly Matrix, Cell Editor & Offline Persistence', () => {
  test.setTimeout(90_000);

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

  test.afterAll(() => {
    killServerProcess(serverProcess);
    serverProcess = null;
  });

  test('unlocks, onboards Starter Pack, verifies Desktop & Mobile Light/Dark + One-Glance + Cell Editor + Tap/Undo/Sync/Offline Reload', async ({
    page,
    context,
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

    // 1. Desktop 1440x900 Light Mode
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });

    // Wait for SW control so later offline reload uses precached assets cleanly
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload({ waitUntil: 'networkidle' });

    // Unlock via Passcode UI
    const unlockInput = page.getByLabel('passcode');
    if (await unlockInput.isVisible()) {
      const passcode = process.env.APP_PASSCODE;
      if (!passcode) {
        throw new Error('APP_PASSCODE is required for slice4 E2E test');
      }
      await unlockInput.fill(passcode);
      await page.getByRole('button', { name: 'فتح الجدول' }).click();
      await expect(unlockInput).toBeHidden({ timeout: 10_000 });
    }

    // Complete First-Run Starter Pack onboarding
    const starterBtn = page.getByTestId('onboarding-starter-pack');
    await expect(starterBtn).toBeVisible({ timeout: 10_000 });
    await starterBtn.click();

    // Verify Street Mode (الآن) renders live Starter Pack periods & actions
    await expect(page.locator('.day-strip .day-tile')).toHaveCount(7);
    await expect(page.locator('.horizon-track')).toBeVisible();
    await expect(page.locator('.action-row').first()).toBeVisible();

    // Gate 3 §6 Condition #3: single top-left icon-only theme toggle, zero duplicate sidebar theme button
    const themeToggleBtns = page.getByTestId('theme-toggle-btn');
    await expect(themeToggleBtns).toHaveCount(1);
    const themeBox = await themeToggleBtns.boundingBox();
    expect(themeBox).not.toBeNull();
    expect(themeBox!.x).toBeLessThan(120); // top-left in 1440px RTL viewport
    await expect(
      page.locator('.desktop-rail').getByRole('button', { name: /الوضع|مظهر|داكن|فاتح/ }),
    ).toHaveCount(0);

    // Verify Desktop Light overflowX: false & capture screenshot
    const desktopNowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(desktopNowOverflow).toBe(false);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-now-light.png`,
      fullPage: true,
    });

    // Test Ctrl+KeyI sidebar collapse & expand
    const shell = page.locator('.app-shell');
    await expect(shell).not.toHaveClass(/sidebar-collapsed/);
    await page.keyboard.press('Control+KeyI');
    await expect(shell).toHaveClass(/sidebar-collapsed/);
    await page.keyboard.press('Control+KeyI');
    await expect(shell).not.toHaveClass(/sidebar-collapsed/);

    // Toggle Dark Mode via top-left button & capture screenshot
    await themeToggleBtns.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(220);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-now-dark.png`,
      fullPage: true,
    });
    // Switch back to Light for Standard Week screenshot
    await themeToggleBtns.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(220);

    // Navigate to Weekly Matrix (الجدول الأسبوعي)
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الجدول الأسبوعي' })
      .click();
    await expect(page.locator('.matrix-desktop-wrap table.ledger-table')).toBeVisible();

    // Verify Standard Mode (العرض المريح)
    const weekStdOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(weekStdOverflow).toBe(false);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-week-standard-light.png`,
      fullPage: true,
    });

    // Switch to One-Glance Mode (نظرة واحدة) -> auto-collapses sidebar & fits 1440x900
    await page.getByRole('tab', { name: 'نظرة واحدة' }).click();
    await expect(page.getByTestId('one-glance-split')).toBeVisible();
    await expect(shell).toHaveClass(/sidebar-collapsed/);

    // Gate 3 §6 Conditions #1 & #2: distinct .period-spacer separators, zero horizontal & zero vertical scroll at 1440x900
    const oneGlanceMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      spacerCount: document.querySelectorAll('tr.period-spacer').length,
      rowHeight:
        document
          .querySelector('.overview-split tr.data-row')
          ?.getBoundingClientRect().height ?? 0,
    }));
    expect(oneGlanceMetrics.scrollWidth).toBeLessThanOrEqual(
      oneGlanceMetrics.innerWidth,
    );
    expect(oneGlanceMetrics.scrollHeight).toBeLessThanOrEqual(
      oneGlanceMetrics.innerHeight,
    );
    expect(oneGlanceMetrics.spacerCount).toBeGreaterThanOrEqual(7);
    expect(oneGlanceMetrics.rowHeight).toBeGreaterThanOrEqual(24);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-week-oneglance-light.png`,
      fullPage: false,
    });

    // One-Glance Dark screenshot
    await themeToggleBtns.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(220);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-week-oneglance-dark.png`,
      fullPage: false,
    });
    await themeToggleBtns.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(220);

    // Open Cell Editor <dialog> via right-click on Quran Wird (supports_percentage): fill note then tap 50% chip -> instant commit & close
    const quranRow = page
      .locator('.overview-split tr.data-row')
      .filter({ hasText: 'ورد قراءة القرآن' })
      .first();
    const targetQuranCell = quranRow
      .locator('td.cell-status button.m-cell:not(.st-inactive)')
      .first();
    await targetQuranCell.click({ button: 'right' });

    const dialog = page.locator('dialog.app-dialog[open]');
    await expect(dialog).toBeVisible();
    await dialog.locator('textarea').fill('ملاحظة اختبار 50%');
    await dialog.getByRole('button', { name: '50%' }).click();
    await expect(dialog).toBeHidden();
    await expect(targetQuranCell).toContainText('50%');
    await expect(targetQuranCell.locator('.m-cell-note-dot')).toBeVisible();

    // Wait for 5s Undo hold to expire and sync before capturing mobile screenshots
    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8_000 });
    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 10_000 },
    );

    // 2. Mobile 390x844 Light & Dark
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator('.mobile-nav')
      .getByRole('button', { name: 'الآن' })
      .click();
    await expect(page.locator('.day-strip')).toBeVisible();

    // Verify 44px+ touch targets on tap-btn & mobile-nav-btn, and zero horizontal overflow
    const mobileNowMetrics = await page.evaluate(() => {
      const tapBtns = Array.from(document.querySelectorAll('.tap-btn')).map(
        (el) => el.getBoundingClientRect(),
      );
      const navBtns = Array.from(
        document.querySelectorAll('.mobile-nav-btn'),
      ).map((el) => el.getBoundingClientRect());
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        minTapHeight: Math.min(...tapBtns.map((b) => b.height)),
        minTapWidth: Math.min(...tapBtns.map((b) => b.width)),
        minNavHeight: Math.min(...navBtns.map((b) => b.height)),
      };
    });
    expect(mobileNowMetrics.scrollWidth).toBeLessThanOrEqual(
      mobileNowMetrics.innerWidth,
    );
    expect(mobileNowMetrics.minTapHeight).toBeGreaterThanOrEqual(44);
    expect(mobileNowMetrics.minNavHeight).toBeGreaterThanOrEqual(44);

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-now-light.png`,
      fullPage: true,
    });

    await themeToggleBtns.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(220);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-now-dark.png`,
      fullPage: true,
    });
    await themeToggleBtns.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(220);

    // Mobile Week View: WHOOP boxes with Sat..Fri labels & overflowX: false
    await page
      .locator('.mobile-nav')
      .getByRole('button', { name: 'الجدول' })
      .click();
    await expect(page.locator('.m-whoop-row').first()).toBeVisible();

    const mobileWeekMetrics = await page.evaluate(() => {
      const labels = Array.from(
        document.querySelectorAll('.m-whoop-row:first-of-type .m-whoop-day-lbl'),
      ).map((el) => el.textContent?.trim());
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        labels,
      };
    });
    expect(mobileWeekMetrics.scrollWidth).toBeLessThanOrEqual(
      mobileWeekMetrics.innerWidth,
    );
    for (const abbr of ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
      expect(mobileWeekMetrics.labels).toContain(abbr);
    }

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-week-light.png`,
      fullPage: true,
    });

    // 3. End-to-End Tap -> 5s Undo -> Re-tap -> Sync to mohasba-test -> Offline Reload & Tab Switching
    await page.setViewportSize({ width: 1440, height: 900 });
    // Expand sidebar (auto-collapsed by One-Glance mode earlier)
    await page.getByRole('button', { name: 'فتح القائمة الجانبية' }).click();
    await expect(shell).not.toHaveClass(/sidebar-collapsed/);
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الآن' })
      .click();

    // Select a bound/active action (or jump to Quran Wird daily group so it's always present regardless of time-of-day)
    await page.getByRole('tab', { name: 'ورد القرآن' }).click();
    const quranNowRow = page.getByTestId(
      `now-action-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}`,
    );
    await expect(quranNowRow).toBeVisible();

    const doneTapBtn = quranNowRow.getByRole('button', {
      name: /تسجيل تم للعمل/,
    });
    await doneTapBtn.click();
    await expect(doneTapBtn).toHaveClass(/active-done/);

    // Undo within 5s window
    const undoBtn = page.getByTestId('undo-toast-btn');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
    await expect(doneTapBtn).not.toHaveClass(/active-done/);

    // Re-tap Done and wait for 5s hold expiry + live sync to mohasba-test
    await doneTapBtn.click();
    await expect(doneTapBtn).toHaveClass(/active-done/);
    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8_000 });
    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 10_000 },
    );

    // Go Offline -> reload -> verify persistence & offline tab switching with 0 ChunkLoadError
    consoleErrors.length = 0;
    pageErrors.length = 0;

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.getByRole('tab', { name: 'ورد القرآن' }).click();
    await expect(
      page
        .getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}`)
        .getByRole('button', { name: /تسجيل تم للعمل/ }),
    ).toHaveClass(/active-done/);

    // Switch through all 5 views offline
    for (const navName of [
      'الجدول الأسبوعي',
      'القضاء',
      'التحليلات',
      'الإعدادات',
      'الآن',
    ]) {
      await page
        .locator('.desktop-rail')
        .getByRole('button', { name: navName })
        .click();
    }

    await context.setOffline(false);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
