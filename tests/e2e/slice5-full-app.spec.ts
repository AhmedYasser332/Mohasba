import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { addDaysIso, resolveIslamicDate } from '../../src/domain/prayer-engine';
import {
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '../../src/domain/starter-pack';
import { loadTestEnv } from '../helpers/load-env';
import { resetTestDb } from '../helpers/reset-test-db';

loadTestEnv();

const PORT = 3102;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR =
  'C:/Users/ahmed/.gemini/antigravity/brain/f71a0285-daff-460c-9b19-50e9a1762d6f/scratch/screenshots/slice5';

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

test.describe('Slice 5: Full 5-View E2E (Qadaa, Analytics, Settings, Target Evolution, Offline Tab Switching)', () => {
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

  test.afterAll(() => {
    killServerProcess(serverProcess);
    serverProcess = null;
  });

  test('executes full Qadaa + Target Evolution + Analytics + Settings CRUD + Export/Import + Offline 5-view journey on Desktop & Mobile Light/Dark', async ({
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

    const assertNoOverflow = async () => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    };

    const navDesktop = async (label: string) => {
      await page.locator('.desktop-rail').getByRole('button', { name: label }).click();
    };

    const navMobile = async (label: string) => {
      await page.locator('.mobile-nav').getByRole('button', { name: label }).click();
    };

    // 1. Desktop 1440x900 Light Mode -> Load + SW ready + Unlock + Starter Pack
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload({ waitUntil: 'networkidle' });

    const unlockInput = page.getByLabel('passcode');
    if (await unlockInput.isVisible()) {
      const passcode = process.env.APP_PASSCODE;
      if (!passcode) {
        throw new Error('APP_PASSCODE is required for slice5 E2E test');
      }
      await unlockInput.fill(passcode);
      await page.getByRole('button', { name: 'فتح الجدول' }).click();
      await expect(unlockInput).toBeHidden({ timeout: 10_000 });
    }

    const starterBtn = page.getByTestId('onboarding-starter-pack');
    await expect(starterBtn).toBeVisible({ timeout: 10_000 });
    await starterBtn.click();
    await expect(page.locator('.day-strip .day-tile')).toHaveCount(7);

    // 2. Mark Quran Wird MISSED today (10 صفحات) & Fajr Jamaah MISSED today (non-recoverable core)
    await page.getByRole('tab', { name: 'ورد القرآن' }).click();
    const quranRow = page.getByTestId(
      `now-action-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}`,
    );
    await expect(quranRow).toBeVisible();
    await quranRow.getByRole('button', { name: /تسجيل فات للعمل/ }).click();
    await expect(
      quranRow.getByRole('button', { name: /تسجيل فات للعمل/ }),
    ).toHaveClass(/active-missed/);

    await page.getByRole('tab', { name: 'الفجر' }).click();
    const fajrJamaahRow = page.getByTestId(
      `now-action-${STARTER_PACK_ACTION_IDS.FAJR_JAMAAH}`,
    );
    await expect(fajrJamaahRow).toBeVisible();
    await fajrJamaahRow.getByRole('button', { name: /تسجيل فات للعمل/ }).click();
    await expect(
      fajrJamaahRow.getByRole('button', { name: /تسجيل فات للعمل/ }),
    ).toHaveClass(/active-missed/);

    // Wait for 5s Undo hold to expire and sync cleanly
    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8_000 });
    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 10_000 },
    );

    // Compute today & tomorrow Islamic dates using Cairo default settings
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
    const tomorrowIslamic = addDaysIso(todayIslamic, 1);

    // 3. Settings: Test is_qadaa_eligible warning + Target Evolution (default D+1) + Period Reorder + ntfy
    await navDesktop('الإعدادات');
    await expect(page.getByTestId('settings-periods-section')).toBeVisible();

    // 3a. Live open-Qadaa warning when toggling is_qadaa_eligible true -> false on QURAN_WIRD
    await page
      .getByTestId(`action-edit-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}`)
      .click();
    const qadaaCheckbox = page.getByTestId('action-qadaa-checkbox');
    await expect(qadaaCheckbox).toBeChecked();
    await qadaaCheckbox.uncheck();
    await expect(page.getByTestId('qadaa-disable-warning')).toBeVisible();
    await expect(page.getByTestId('qadaa-disable-warning')).toContainText('1');
    await page.locator('dialog.app-dialog[open] button:has-text("إلغاء")').click();

    // 3b. Target Evolution ("تطوير الهدف"): assert default effective_from = tomorrow (D+1), upgrade to "20 صفحة"
    await page
      .getByTestId(`action-evolve-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}`)
      .click();
    const evolveDateInput = page.getByTestId('evolve-effective-from-input');
    await expect(evolveDateInput).toHaveValue(tomorrowIslamic);
    await page.getByTestId('evolve-target-label-input').fill('20 صفحة');
    await page.getByTestId('evolve-target-save').click();
    await expect(page.locator('dialog.app-dialog[open]')).toBeHidden({
      timeout: 10_000,
    });

    // 3c. Reorder period (POST /api/schema/reorder)
    const reorderPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/schema/reorder') &&
        res.request().method() === 'POST',
    );
    await page
      .getByTestId(`period-move-down-${STARTER_PACK_PERIOD_IDS.FAJR}`)
      .click();
    const reorderRes = await reorderPromise;
    expect(reorderRes.status()).toBe(200);
    // Restore original order
    await page
      .getByTestId(`period-move-up-${STARTER_PACK_PERIOD_IDS.FAJR}`)
      .click();

    // 3d. ntfy settings update + test-ntfy button feedback
    const ntfyToggle = page.getByTestId('ntfy-master-toggle');
    await ntfyToggle.check();
    await page.getByTestId('ntfy-save-btn').click();
    await page.getByTestId('ntfy-test-btn').click();
    await expect(page.getByTestId('ntfy-test-feedback')).toBeVisible({
      timeout: 10_000,
    });

    // 4. Qadaa View: verify historical "10 صفحات" is preserved, capture Desktop & Mobile screenshots, then resolve!
    await navDesktop('القضاء');
    const quranPendingItem = page.getByTestId(
      `qadaa-pending-item-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}-${todayIslamic}`,
    );
    await expect(quranPendingItem).toBeVisible();
    await expect(quranPendingItem).toContainText('10 صفحات');
    await expect(quranPendingItem).not.toContainText('20 صفحة');
    await assertNoOverflow();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-qadaa-light.png`,
      fullPage: true,
    });

    // Mobile Qadaa Light screenshot
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-qadaa-light.png`,
      fullPage: true,
    });

    // Back to Desktop and resolve Qadaa via 1-tap "تم القضاء"
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByTestId(
        `qadaa-resolve-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}-${todayIslamic}`,
      )
      .click();
    await expect(quranPendingItem).toBeHidden();
    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8_000 });
    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 10_000 },
    );

    // Non-recoverable misses tab
    await page.getByTestId('qadaa-tab-nonrecoverable').click();
    await expect(page).toHaveURL(/view=qadaa&tab=nonrecoverable/);
    await expect(
      page.getByTestId(
        `qadaa-nonrecoverable-item-${STARTER_PACK_ACTION_IDS.FAJR_JAMAAH}-${todayIslamic}`,
      ),
    ).toBeVisible();

    // 5. Analytics View: 7d/30d toggle, progression trail "10 صفحات ← 20 صفحة", zero NaN, Light & Dark + Mobile screenshots
    await navDesktop('التحليلات');
    await expect(page.getByTestId('analytics-pulse')).toBeVisible();
    await expect(page.getByTestId('analytics-progression-trails')).toContainText(
      '10 صفحات ← 20 صفحة',
    );
    const analyticsBodyText = await page.locator('main').innerText();
    expect(analyticsBodyText).not.toContain('NaN');
    expect(analyticsBodyText).not.toContain('undefined');

    await page.getByTestId('analytics-toggle-30d').click();
    await expect(page.getByTestId('analytics-toggle-30d')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByTestId('analytics-toggle-7d').click();
    await assertNoOverflow();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-analytics-light.png`,
      fullPage: true,
    });

    const themeBtn = page.getByTestId('theme-toggle-btn');
    await themeBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-analytics-dark.png`,
      fullPage: true,
    });
    await themeBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(200);

    // Mobile Analytics Light screenshot
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-analytics-light.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });

    // 6. Settings: Online Export, Chunked JSON Import round-trip (setting active_from to D-2 for 48h catchup test!), Audit Logs & Screenshots
    await navDesktop('الإعدادات');

    const [exportDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-full-btn').click(),
    ]);
    const exportedPath = await exportDownload.path();
    expect(exportedPath).toBeTruthy();
    const exportedJson = JSON.parse(
      fs.readFileSync(exportedPath!, 'utf-8'),
    ) as {
      schema_version: number;
      periods: Array<{ active_from: string }>;
      actions: Array<{ active_from: string }>;
      target_versions: unknown[];
      daily_logs: unknown[];
    };
    expect(exportedJson.schema_version).toBe(1);
    expect(exportedJson.actions.length).toBeGreaterThan(20);

    // Backdate active_from to D-2 in a temp import file so yesterday's expired unlogged cells surface in 48h Catch-Up deterministically at any time of day
    const twoDaysAgo = addDaysIso(todayIslamic, -2);
    const modifiedImport = {
      ...exportedJson,
      periods: exportedJson.periods.map((p) => ({
        ...p,
        active_from: twoDaysAgo,
      })),
      actions: exportedJson.actions.map((a) => ({
        ...a,
        active_from: twoDaysAgo,
      })),
    };
    const tempImportPath = path.join(SCREENSHOT_DIR, 'temp-import-roundtrip.json');
    fs.writeFileSync(tempImportPath, JSON.stringify(modifiedImport), 'utf-8');

    await page.getByTestId('import-json-input').setInputFiles(tempImportPath);
    await expect(page.getByTestId('backup-feedback')).toContainText(
      'تم الاستيراد بنجاح',
      { timeout: 15_000 },
    );
    fs.rmSync(tempImportPath, { force: true });

    // Audit Logs viewer
    await page.getByTestId('toggle-audit-logs-btn').click();
    await expect(page.getByTestId('audit-logs-list')).toBeVisible({
      timeout: 10_000,
    });
    await assertNoOverflow();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-settings-light.png`,
      fullPage: true,
    });

    await themeBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-settings-dark.png`,
      fullPage: true,
    });

    // Mobile Settings Dark screenshot
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-settings-dark.png`,
      fullPage: true,
    });

    // Switch back to Desktop Light & test 48h Catch-Up tab with real expired unlogged cells
    await themeBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.setViewportSize({ width: 1440, height: 900 });

    await navDesktop('القضاء');
    await page.getByTestId('qadaa-tab-catchup').click();
    await expect(page).toHaveURL(/view=qadaa&tab=catchup/);
    const yesterdayIslamic = addDaysIso(todayIslamic, -1);
    const catchupDoneBtn = page.getByTestId(
      `catchup-done-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}-${yesterdayIslamic}`,
    );
    await expect(catchupDoneBtn).toBeVisible();
    await catchupDoneBtn.click();
    await expect(catchupDoneBtn).toBeHidden();

    // Wait for 5s Undo & sync before going offline
    await expect(page.getByTestId('undo-toast')).toBeHidden({ timeout: 8_000 });
    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 10_000 },
    );

    // 7. Offline 5-View Tab Switching + Offline Guard Banner + Emergency Export
    consoleErrors.length = 0;
    pageErrors.length = 0;

    await context.setOffline(true);

    for (const navLabel of [
      'الآن',
      'الجدول الأسبوعي',
      'القضاء',
      'التحليلات',
      'الإعدادات',
    ]) {
      await navDesktop(navLabel);
      await assertNoOverflow();
    }

    await expect(page.getByTestId('settings-offline-banner')).toBeVisible();
    await expect(page.getByTestId('add-period-btn')).toBeDisabled();
    await expect(page.getByTestId('export-full-btn')).toBeDisabled();
    await expect(page.getByTestId('export-emergency-btn')).toBeEnabled();

    const [emergencyDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-emergency-btn').click(),
    ]);
    expect(emergencyDownload.suggestedFilename()).toContain('mohasba-emergency');

    // Also test mobile nav switching offline
    await page.setViewportSize({ width: 390, height: 844 });
    for (const mobileLabel of ['الآن', 'الجدول', 'القضاء', 'التحليلات', 'الإعدادات']) {
      await navMobile(mobileLabel);
      await assertNoOverflow();
    }

    await context.setOffline(false);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
