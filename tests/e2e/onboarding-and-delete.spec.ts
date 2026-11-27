import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { buildTemplateBundle } from '../../src/domain/templates';
import { loadTestEnv } from '../helpers/load-env';
import { resetTestDb } from '../helpers/reset-test-db';

loadTestEnv();

const PORT = 3105;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR =
  'C:/Users/ahmed/.gemini/antigravity/brain/f71a0285-daff-460c-9b19-50e9a1762d6f/scratch/screenshots/onboarding-delete';

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
  if (!proc?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
  } else {
    proc.kill('SIGTERM');
  }
}

test.describe('2-Step 3-Level Onboarding Wizard & Smart 2-Tier Permanent Delete', () => {
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
      [nextBin, 'start', '-H', '127.0.0.1', '-p', String(PORT)],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'production', APP_URL: BASE_URL },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    await waitForHealth(BASE_URL);
  });

  test.afterAll(async () => {
    killServerProcess(serverProcess);
    serverProcess = null;
    await resetTestDb();
  });

  test('completes 2-step 3-level onboarding (preview, uncheck, quick-add, global ntfy) and verifies smart 2-tier delete in Settings across Desktop & Mobile', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const txt = msg.text();
      // Ignore expected pre-unlock 401 and intentional 409 HAS_HISTORY / HAS_CHILDREN guards
      if (
        txt.includes('status of 401') ||
        txt.includes('status of 409')
      ) {
        return;
      }
      consoleErrors.push(txt);
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Unlock
    const unlockInput = page.getByLabel('passcode');
    if (await unlockInput.isVisible()) {
      const passcode = process.env.APP_PASSCODE;
      if (!passcode) throw new Error('APP_PASSCODE is required');
      await unlockInput.fill(passcode);
      await page.getByRole('button', { name: 'فتح الجدول' }).click();
      await expect(unlockInput).toBeHidden({ timeout: 10_000 });
    }

    // 1. Verify Onboarding Wizard & switching across all 3 levels
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 10_000 });
    const l1 = buildTemplateBundle('level_1');
    const l2 = buildTemplateBundle('level_2');
    const l3 = buildTemplateBundle('level_3');

    await expect(page.getByTestId('onboarding-selected-count')).toContainText(
      `${l1.actions.length} عملاً`,
    );

    await page.getByTestId('onboarding-level-level_2').click();
    await expect(page.getByTestId('onboarding-selected-count')).toContainText(
      `${l2.actions.length} عملاً`,
    );

    await page.getByTestId('onboarding-level-level_3').click();
    await expect(page.getByTestId('onboarding-selected-count')).toContainText(
      `${l3.actions.length} عملاً`,
    );

    // Search/filter Level 3's 118 actions effortlessly
    await page.getByTestId('onboarding-preview-search').fill('زيارة القبور');
    await expect(page.getByTestId('onboarding-preview')).toContainText('زيارة القبور');
    await page.getByTestId('onboarding-preview-search').fill('');

    // Switch back to Level 1 & customize in Preview
    await page.getByTestId('onboarding-level-level_1').click();
    await expect(page.getByTestId('onboarding-selected-count')).toContainText(
      `${l1.actions.length} عملاً`,
    );

    // Expand all periods, uncheck الصيام period, uncheck 1 action in الفجر, quick-add inside الليل
    await page.getByTestId('onboarding-toggle-expand-all').click();
    await expect(page.getByTestId('onboarding-toggle-expand-all')).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    const fastingPeriod = l1.periods.find((p) => p.title === 'الصيام')!;
    const fajrAdhkar = l1.actions.find((a) => a.title === 'أذكار بعد صلاة الفجر')!;
    const nightPeriod = l1.periods.find((p) => p.title === 'الليل')!;

    await page.getByTestId(`preview-period-toggle-${fastingPeriod.id}`).uncheck();
    await page.getByTestId(`preview-action-toggle-${fajrAdhkar.id}`).uncheck();

    const quickAddInput = page.getByTestId(`preview-quick-add-input-${nightPeriod.id}`);
    await quickAddInput.fill('صلاة التوبة');
    await quickAddInput.press('Enter');
    await expect(page.getByTestId('preview-custom-action-row')).toContainText('صلاة التوبة');

    // Count should be l1.actions.length - 1 (fasting) - 1 (fajrAdhkar) + 1 (custom) = l1.actions.length - 1
    await expect(page.getByTestId('onboarding-selected-count')).toContainText(
      `${l1.actions.length - 1} عملاً`,
    );

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-onboarding-step1.png`,
      fullPage: false,
    });

    // Mobile 390px overflow check on Onboarding Step 1
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflowStep1 = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(mobileOverflowStep1).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/mobile-onboarding-step1.png`,
      fullPage: false,
    });

    // Back to Desktop & proceed to Step 2
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('onboarding-next-step').click();
    await expect(page.getByTestId('onboarding-step-2')).toBeVisible();

    // Pick Makkah, enable global ntfy switch, generate private topic URL
    await page.getByTestId('onboarding-city-select').selectOption('makkah');
    await page.getByTestId('onboarding-ntfy-global').check();
    await page.getByTestId('onboarding-ntfy-generate').click();
    await expect(page.getByTestId('onboarding-ntfy-url')).toHaveValue(
      /^https:\/\/ntfy\.sh\/mohasba-[0-9a-f]{24}$/,
    );

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-onboarding-step2.png`,
      fullPage: false,
    });

    // Finish onboarding!
    await page.getByTestId('onboarding-finish').click();
    await expect(page.locator('.day-strip .day-tile')).toHaveCount(7, {
      timeout: 20_000,
    });

    // Verify excluded period الصيام is absent and custom action صلاة التوبة is present in الليل
    await expect(page.getByRole('tab', { name: 'الصيام' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'الليل' }).click();
    await expect(page.locator('.action-row', { hasText: 'صلاة التوبة' })).toBeVisible();

    // Log 1 day on صلاة الوتر so we can test logged-history delete guard in Settings!
    const witrAction = l1.actions.find((a) => a.title === 'صلاة الوتر')!;
    const witrRow = page.getByTestId(`now-action-${witrAction.id}`);
    await witrRow.getByRole('button', { name: /تسجيل تم للعمل/ }).click();
    await expect(witrRow.getByRole('button', { name: /تسجيل تم للعمل/ })).toHaveClass(
      /active-done/,
    );

    // 2. Navigate to Settings and verify Smart 2-Tier Delete for Actions & Periods
    await page.locator('.desktop-rail').getByRole('button', { name: 'الإعدادات' }).click();
    await expect(page.getByTestId('accordion-toggle-periods')).toBeVisible();

    // 2a. Open Actions accordion -> expand الليل -> instant delete unlogged custom action (صلاة التوبة)
    await page.getByTestId('accordion-toggle-actions').click();
    const actionsSection = page.locator('#settings-actions-panel');
    await actionsSection.getByRole('button', { name: /الليل/ }).click();

    const customActionRow = actionsSection.locator('.schema-item-row', {
      hasText: 'صلاة التوبة',
    });
    await expect(customActionRow).toBeVisible();
    const openConfirmDialog = page.locator(
      'dialog[data-testid="delete-confirm-dialog"][open]',
    );
    await customActionRow.getByRole('button', { name: 'حذف', exact: true }).click();
    // Instant delete — NO confirmation dialog opens for 0-log action!
    await expect(openConfirmDialog).toHaveCount(0);
    await expect(customActionRow).toHaveCount(0, { timeout: 15_000 });

    // 2b. Click Delete on logged action (صلاة الوتر) -> DeleteConfirmDialog opens with proper Arabic singular count & Archive default
    await page.getByTestId(`action-delete-${witrAction.id}`).click();
    await expect(openConfirmDialog).toBeVisible({ timeout: 10_000 });
    await expect(openConfirmDialog).toContainText('سجل تاريخي واحد');
    await expect(
      openConfirmDialog.getByTestId('delete-confirm-archive-btn'),
    ).toBeFocused();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-delete-confirm-history.png`,
      fullPage: false,
    });

    // Choose Archive Instead -> safely archived!
    await openConfirmDialog.getByTestId('delete-confirm-archive-btn').click();
    await expect(openConfirmDialog).toHaveCount(0);
    await expect(page.getByTestId(`action-delete-${witrAction.id}`)).toHaveCount(0);

    // Show archived -> click Delete -> confirm Force Delete permanently!
    await actionsSection.getByRole('button', { name: /عرض المؤرشف/ }).click();
    await expect(page.getByTestId(`action-delete-${witrAction.id}`)).toBeVisible();
    await page.getByTestId(`action-delete-${witrAction.id}`).click();
    await expect(openConfirmDialog).toBeVisible();
    await openConfirmDialog.getByTestId('delete-confirm-force-btn').click();
    await expect(openConfirmDialog).toHaveCount(0);
    await expect(page.getByTestId(`action-delete-${witrAction.id}`)).toHaveCount(0, {
      timeout: 15_000,
    });

    // 2c. Open Periods accordion -> create empty period -> instant delete without dialog
    await page.getByTestId('accordion-toggle-periods').click();
    const periodsSection = page.locator('#settings-periods-panel');
    await page.getByTestId('add-period-btn').click();
    const periodDialog = page.locator('dialog.app-dialog[open]');
    await periodDialog.getByRole('textbox').first().fill('مجموعة تجربة للحذف');
    await periodDialog.getByRole('combobox').first().selectOption('DAILY_GROUP');
    await periodDialog.getByRole('button', { name: 'حفظ الفترة' }).click();
    await expect(periodDialog).toBeHidden({ timeout: 15_000 });

    const createdPeriodRow = periodsSection.locator('.schema-item-row', {
      hasText: 'مجموعة تجربة للحذف',
    });
    await expect(createdPeriodRow).toBeVisible();
    await createdPeriodRow
      .getByRole('button', { name: 'حذف', exact: true })
      .click();
    await expect(openConfirmDialog).toHaveCount(0);
    await expect(createdPeriodRow).toHaveCount(0, { timeout: 15_000 });

    // 2d. Delete period with unlogged actions (وظائف الجمعة) -> HAS_CHILDREN confirm -> force delete
    const fridayPeriod = l1.periods.find((p) => p.title === 'وظائف الجمعة')!;
    await page.getByTestId(`period-delete-${fridayPeriod.id}`).click();
    await expect(openConfirmDialog).toBeVisible({ timeout: 10_000 });
    await expect(openConfirmDialog).toContainText('7 أعمال');
    await openConfirmDialog.getByTestId('delete-confirm-force-btn').click();
    await expect(openConfirmDialog).toHaveCount(0);
    await expect(page.getByTestId(`period-row-${fridayPeriod.id}`)).toHaveCount(0, {
      timeout: 15_000,
    });

    // 2e. Verify ntfy global bulk buttons in Settings (since onboarding enabled all TIME_BOUND periods)
    await page.getByTestId('accordion-toggle-ntfy').click();
    await expect(page.getByTestId('ntfy-disable-all-periods')).toBeEnabled();
    await page.getByTestId('ntfy-disable-all-periods').click();
    await expect(page.getByTestId('ntfy-enable-all-periods')).toBeEnabled({
      timeout: 15_000,
    });

    // Verify Dark Mode screenshot on Settings Periods
    await page.getByTestId('theme-toggle-btn').click();
    await page.getByTestId('accordion-toggle-periods').click();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/desktop-settings-periods-dark.png`,
      fullPage: false,
    });

    expect(consoleErrors).toEqual([]);
  });
});
