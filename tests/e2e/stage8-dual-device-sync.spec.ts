import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { resolveIslamicDate } from '../../src/domain/prayer-engine';
import {
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '../../src/domain/starter-pack';
import { loadTestEnv } from '../helpers/load-env';
import { createTestAdminClient, resetTestDb } from '../helpers/reset-test-db';

loadTestEnv();

const PORT = 3103;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR =
  'C:/Users/ahmed/.gemini/antigravity/brain/f71a0285-daff-460c-9b19-50e9a1762d6f/scratch/screenshots/stage8';

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

async function unlockIfNeeded(page: Page, passcode: string): Promise<void> {
  const unlockInput = page.getByLabel('passcode');
  if (await unlockInput.isVisible()) {
    await unlockInput.fill(passcode);
    await page.getByRole('button', { name: 'فتح الجدول' }).click();
    await expect(unlockInput).toBeHidden({ timeout: 10_000 });
  }
}

interface OutboxRecord {
  mutation_id: string;
  cell_key: string;
  state: string;
  attempt_count: number;
  device_id: string;
  parent_mutation_id: string | null;
  status: string | null;
}

async function readOutboxItemsForCell(
  page: Page,
  cellKey: string,
): Promise<OutboxRecord[]> {
  return page.evaluate(async (targetKey) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('mohasba-db', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<OutboxRecord[]>((resolve, reject) => {
        const tx = db.transaction('outbox', 'readonly');
        const store = tx.objectStore('outbox');
        const req = store.getAll();
        req.onsuccess = () => {
          const all = (req.result as OutboxRecord[]) ?? [];
          resolve(all.filter((item) => item.cell_key === targetKey));
        };
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }, cellKey);
}

test.describe('Stage 8: Real Dual-Browser Airplane-Mode Phone vs Online PC Sync Convergence', () => {
  test.setTimeout(180_000);

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

  test('verifies Positive > MISSED offline conflict, Dropped-ACK M1->M2 causal self-correction, and independent note_updated_at LWW merge', async ({
    browser,
  }) => {
    const passcode = process.env.APP_PASSCODE;
    if (!passcode) {
      throw new Error('APP_PASSCODE is required for Stage 8 dual-device E2E');
    }

    const admin = createTestAdminClient();
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

    const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const pcContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    const phoneConsoleErrors: string[] = [];
    const pcConsoleErrors: string[] = [];
    const phonePageErrors: string[] = [];
    const pcPageErrors: string[] = [];

    try {
      const phonePage = await phoneContext.newPage();
      const pcPage = await pcContext.newPage();

      phonePage.on('console', (msg) => {
        if (msg.type() === 'error') phoneConsoleErrors.push(msg.text());
      });
      phonePage.on('pageerror', (err) => phonePageErrors.push(err.message));

      pcPage.on('console', (msg) => {
        if (msg.type() === 'error') pcConsoleErrors.push(msg.text());
      });
      pcPage.on('pageerror', (err) => pcPageErrors.push(err.message));

      // Boot & activate SW on both Phone and PC
      await Promise.all([
        phonePage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' }),
        pcPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' }),
      ]);

      await Promise.all([
        phonePage.evaluate(async () => {
          await navigator.serviceWorker.ready;
        }),
        pcPage.evaluate(async () => {
          await navigator.serviceWorker.ready;
        }),
      ]);

      await Promise.all([
        phonePage.reload({ waitUntil: 'networkidle' }),
        pcPage.reload({ waitUntil: 'networkidle' }),
      ]);

      // Unlock both contexts
      await unlockIfNeeded(pcPage, passcode);
      await unlockIfNeeded(phonePage, passcode);

      // Onboard Starter Pack on PC, then reload Phone so both share identical state
      const starterBtn = pcPage.getByTestId('onboarding-starter-pack');
      await expect(starterBtn).toBeVisible({ timeout: 10_000 });
      await starterBtn.click();
      await expect(pcPage.locator('.day-strip .day-tile')).toHaveCount(7, {
        timeout: 15_000,
      });

      await phonePage.reload({ waitUntil: 'networkidle' });
      await expect(phonePage.locator('.day-strip .day-tile')).toHaveCount(7, {
        timeout: 15_000,
      });

      // Clear boot-time error arrays before scenarios (e.g. intentional aborted network tests will be tracked below)
      phoneConsoleErrors.length = 0;
      pcConsoleErrors.length = 0;

      // Navigate both to الفجر period on today
      await pcPage.getByRole('tab', { name: 'الفجر' }).click();
      await phonePage.getByRole('tab', { name: 'الفجر' }).click();
      await expect(
        phonePage.getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.FAJR_FARD}`),
      ).toBeVisible();
      await expect(
        pcPage.getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.FAJR_FARD}`),
      ).toBeVisible();

      // =========================================================================
      // Scenario A: Offline Phone (DONE) vs Online PC (MISSED) -> Positive > MISSED
      // =========================================================================
      await phoneContext.setOffline(true);

      const phoneFajrRow = phonePage.getByTestId(
        `now-action-${STARTER_PACK_ACTION_IDS.FAJR_FARD}`,
      );
      await phoneFajrRow
        .getByRole('button', { name: /تسجيل تم للعمل/ })
        .click();
      await expect(
        phoneFajrRow.getByRole('button', { name: /تسجيل تم للعمل/ }),
      ).toHaveClass(/active-done/);

      // Wait past 5s Undo hold so Phone's mutation sits offline in IDB outbox
      await expect(phonePage.getByTestId('undo-toast')).toBeHidden({
        timeout: 8_000,
      });
      await expect(phonePage.getByTestId('sync-badge-btn')).toHaveAttribute(
        'data-sync',
        'offline_pending',
      );

      // Online PC marks the SAME action MISSED
      const pcFajrRow = pcPage.getByTestId(
        `now-action-${STARTER_PACK_ACTION_IDS.FAJR_FARD}`,
      );
      await pcFajrRow
        .getByRole('button', { name: /تسجيل فات للعمل/ })
        .click();
      await expect(
        pcFajrRow.getByRole('button', { name: /تسجيل فات للعمل/ }),
      ).toHaveClass(/active-missed/);
      await expect(pcPage.getByTestId('undo-toast')).toBeHidden({
        timeout: 8_000,
      });
      await expect(pcPage.getByTestId('sync-badge-btn')).toHaveAttribute(
        'data-sync',
        'synced',
        { timeout: 15_000 },
      );

      const { data: pcDbRowA, error: pcDbErrA } = await admin
        .from('daily_logs')
        .select('*')
        .eq('action_id', STARTER_PACK_ACTION_IDS.FAJR_FARD)
        .eq('log_date', todayIslamic)
        .single();
      expect(pcDbErrA).toBeNull();
      expect(pcDbRowA?.status).toBe('MISSED');

      // Reconnect Phone and wait for sync convergence
      await phoneContext.setOffline(false);
      await expect(phonePage.getByTestId('sync-badge-btn')).toHaveAttribute(
        'data-sync',
        'synced',
        { timeout: 15_000 },
      );

      // Reload BOTH Phone and PC -> assert DONE won everywhere
      await Promise.all([
        phonePage.reload({ waitUntil: 'networkidle' }),
        pcPage.reload({ waitUntil: 'networkidle' }),
      ]);
      await phonePage.getByRole('tab', { name: 'الفجر' }).click();
      await pcPage.getByRole('tab', { name: 'الفجر' }).click();

      await expect(
        phonePage
          .getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.FAJR_FARD}`)
          .getByRole('button', { name: /تسجيل تم للعمل/ }),
      ).toHaveClass(/active-done/);
      await expect(
        pcPage
          .getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.FAJR_FARD}`)
          .getByRole('button', { name: /تسجيل تم للعمل/ }),
      ).toHaveClass(/active-done/);

      const { data: convergedRowA, error: convergedErrA } = await admin
        .from('daily_logs')
        .select('*')
        .eq('action_id', STARTER_PACK_ACTION_IDS.FAJR_FARD)
        .eq('log_date', todayIslamic)
        .single();
      expect(convergedErrA).toBeNull();
      expect(convergedRowA?.status).toBe('DONE');

      // =========================================================================
      // Scenario B: Dropped-ACK 4G Same-Device Self-Correction (M1: DONE -> M2: MISSED)
      // =========================================================================
      let firstSyncIntercepted = false;
      let resolveM1Aborted!: () => void;
      const m1AbortedPromise = new Promise<void>((resolve) => {
        resolveM1Aborted = resolve;
      });

      await phonePage.route('**/api/sync', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        if (!firstSyncIntercepted) {
          firstSyncIntercepted = true;
          const serverRes = await route.fetch();
          expect(serverRes.status()).toBe(200);
          await route.abort('failed');
          resolveM1Aborted();
          return;
        }
        // Keep aborting any 1s backoff retries until M2 is tapped and unroute() runs
        await route.abort('failed');
      });

      const phoneSunnahRow = phonePage.getByTestId(
        `now-action-${STARTER_PACK_ACTION_IDS.FAJR_SUNNAH}`,
      );
      await phoneSunnahRow
        .getByRole('button', { name: /تسجيل تم للعمل/ })
        .click();
      await expect(
        phoneSunnahRow.getByRole('button', { name: /تسجيل تم للعمل/ }),
      ).toHaveClass(/active-done/);

      await m1AbortedPromise;

      const sunnahCellKey = `${STARTER_PACK_ACTION_IDS.FAJR_SUNNAH}::${todayIslamic}`;
      let m1Record: OutboxRecord | undefined;
      await expect
        .poll(
          async () => {
            const items = await readOutboxItemsForCell(phonePage, sunnahCellKey);
            m1Record = items.find(
              (i) => i.attempt_count >= 1 && i.state === 'pending',
            );
            return Boolean(m1Record);
          },
          { timeout: 5_000 },
        )
        .toBe(true);

      const m1Id = m1Record!.mutation_id;
      const phoneDeviceId = m1Record!.device_id;

      // Verify M1: DONE actually committed on mohasba-test despite aborted ACK
      const { data: m1DbRow, error: m1DbErr } = await admin
        .from('daily_logs')
        .select('*')
        .eq('action_id', STARTER_PACK_ACTION_IDS.FAJR_SUNNAH)
        .eq('log_date', todayIslamic)
        .single();
      expect(m1DbErr).toBeNull();
      expect(m1DbRow?.status).toBe('DONE');
      expect(m1DbRow?.last_mutation_id).toBe(m1Id);

      // Tap MISSED (M2) on Phone -> must enqueue M2 with parent_mutation_id = M1
      await phoneSunnahRow
        .getByRole('button', { name: /تسجيل فات للعمل/ })
        .click();
      await expect(
        phoneSunnahRow.getByRole('button', { name: /تسجيل فات للعمل/ }),
      ).toHaveClass(/active-missed/);

      let m2Record: OutboxRecord | undefined;
      await expect
        .poll(
          async () => {
            const items = await readOutboxItemsForCell(phonePage, sunnahCellKey);
            m2Record = items.find(
              (i) =>
                i.mutation_id !== m1Id &&
                i.parent_mutation_id === m1Id &&
                i.device_id === phoneDeviceId &&
                i.status === 'MISSED',
            );
            return Boolean(m2Record);
          },
          { timeout: 5_000 },
        )
        .toBe(true);

      const m2Id = m2Record!.mutation_id;

      // Unroute interceptor and wait for M1 (already_applied) + M2 (Causal Fast Path #3) sync
      await phonePage.unroute('**/api/sync');
      await expect(phonePage.getByTestId('undo-toast')).toBeHidden({
        timeout: 8_000,
      });
      await expect(phonePage.getByTestId('sync-badge-btn')).toHaveAttribute(
        'data-sync',
        'synced',
        { timeout: 15_000 },
      );

      // Reload BOTH Phone and PC -> assert MISSED won via Causal Fast Path #3
      await Promise.all([
        phonePage.reload({ waitUntil: 'networkidle' }),
        pcPage.reload({ waitUntil: 'networkidle' }),
      ]);
      await phonePage.getByRole('tab', { name: 'الفجر' }).click();
      await pcPage.getByRole('tab', { name: 'الفجر' }).click();

      await expect(
        phonePage
          .getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.FAJR_SUNNAH}`)
          .getByRole('button', { name: /تسجيل فات للعمل/ }),
      ).toHaveClass(/active-missed/);
      await expect(
        pcPage
          .getByTestId(`now-action-${STARTER_PACK_ACTION_IDS.FAJR_SUNNAH}`)
          .getByRole('button', { name: /تسجيل فات للعمل/ }),
      ).toHaveClass(/active-missed/);

      const { data: convergedRowB, error: convergedErrB } = await admin
        .from('daily_logs')
        .select('*')
        .eq('action_id', STARTER_PACK_ACTION_IDS.FAJR_SUNNAH)
        .eq('log_date', todayIslamic)
        .single();
      expect(convergedErrB).toBeNull();
      expect(convergedRowB?.status).toBe('MISSED');
      expect(convergedRowB?.last_mutation_id).toBe(m2Id);
      expect(convergedRowB?.row_version).toBe(2);

      // =========================================================================
      // Scenario C: Independent note_updated_at LWW Merge (Offline Phone DONE + PC Note)
      // =========================================================================
      const independentNote = 'ملاحظة اختبار التزامن المستقل';

      // Clear any console error generated by our intentional route.abort('failed') in Scenario B
      phoneConsoleErrors.length = 0;

      await phoneContext.setOffline(true);

      const phoneAdhkarRow = phonePage.getByTestId(
        `now-action-${STARTER_PACK_ACTION_IDS.FAJR_ADHKAR}`,
      );
      await phoneAdhkarRow
        .getByRole('button', { name: /تسجيل تم للعمل/ })
        .click();
      await expect(
        phoneAdhkarRow.getByRole('button', { name: /تسجيل تم للعمل/ }),
      ).toHaveClass(/active-done/);

      await expect(phonePage.getByTestId('undo-toast')).toBeHidden({
        timeout: 8_000,
      });
      await expect(phonePage.getByTestId('sync-badge-btn')).toHaveAttribute(
        'data-sync',
        'offline_pending',
      );

      // On PC (online), open Cell Editor <dialog> for أذكار بعد صلاة الفجر and save MISSED + personal note
      const pcAdhkarRow = pcPage.getByTestId(
        `now-action-${STARTER_PACK_ACTION_IDS.FAJR_ADHKAR}`,
      );
      await pcAdhkarRow
        .getByRole('button', { name: /خيارات إضافية للعمل/ })
        .click();

      const cellDialog = pcPage.locator('dialog.app-dialog[open]');
      await expect(cellDialog).toBeVisible();
      await cellDialog.locator('textarea').fill(independentNote);
      await cellDialog.getByRole('button', { name: 'فات', exact: true }).click();
      await expect(cellDialog).toBeHidden();

      await expect(pcPage.getByTestId('undo-toast')).toBeHidden({
        timeout: 8_000,
      });
      await expect(pcPage.getByTestId('sync-badge-btn')).toHaveAttribute(
        'data-sync',
        'synced',
        { timeout: 15_000 },
      );

      // Reconnect Phone and wait for sync
      await phoneContext.setOffline(false);
      await expect(phonePage.getByTestId('sync-badge-btn')).toHaveAttribute(
        'data-sync',
        'synced',
        { timeout: 15_000 },
      );

      // Reload PC & Phone -> assert BOTH status='DONE' AND note preserved
      await Promise.all([
        pcPage.reload({ waitUntil: 'networkidle' }),
        phonePage.reload({ waitUntil: 'networkidle' }),
      ]);
      await pcPage
        .locator(`.period-pill`)
        .filter({ hasText: 'الفجر' })
        .first()
        .click();
      await phonePage
        .locator(`.period-pill`)
        .filter({ hasText: 'الفجر' })
        .first()
        .click();

      const pcAdhkarFinal = pcPage.getByTestId(
        `now-action-${STARTER_PACK_ACTION_IDS.FAJR_ADHKAR}`,
      );
      const phoneAdhkarFinal = phonePage.getByTestId(
        `now-action-${STARTER_PACK_ACTION_IDS.FAJR_ADHKAR}`,
      );

      await expect(
        pcAdhkarFinal.getByRole('button', { name: /تسجيل تم للعمل/ }),
      ).toHaveClass(/active-done/);
      await expect(pcAdhkarFinal).toContainText(independentNote);

      await expect(
        phoneAdhkarFinal.getByRole('button', { name: /تسجيل تم للعمل/ }),
      ).toHaveClass(/active-done/);
      await expect(phoneAdhkarFinal).toContainText(independentNote);

      const { data: convergedRowC, error: convergedErrC } = await admin
        .from('daily_logs')
        .select('*')
        .eq('action_id', STARTER_PACK_ACTION_IDS.FAJR_ADHKAR)
        .eq('log_date', todayIslamic)
        .single();
      expect(convergedErrC).toBeNull();
      expect(convergedRowC?.status).toBe('DONE');
      expect(convergedRowC?.note).toBe(independentNote);

      // Ensure URL query preserves الفجر period cleanly on both
      expect(STARTER_PACK_PERIOD_IDS.FAJR).toBeTruthy();

      // Capture final post-convergence screenshots
      await phonePage.screenshot({
        path: `${SCREENSHOT_DIR}/phone-post-sync.png`,
        fullPage: true,
      });
      await pcPage.screenshot({
        path: `${SCREENSHOT_DIR}/pc-post-sync.png`,
        fullPage: true,
      });

      expect(phoneConsoleErrors).toEqual([]);
      expect(pcConsoleErrors).toEqual([]);
      expect(phonePageErrors).toEqual([]);
      expect(pcPageErrors).toEqual([]);
    } finally {
      await phoneContext.close();
      await pcContext.close();
    }
  });
});
