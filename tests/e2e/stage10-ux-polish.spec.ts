import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { addDaysIso, resolveIslamicDate } from '../../src/domain/prayer-engine';
import {
  STARTER_PACK_ACTION_IDS,
  STARTER_PACK_PERIOD_IDS,
} from '../../src/domain/starter-pack';
import { loadTestEnv } from '../helpers/load-env';
import { resetTestDb } from '../helpers/reset-test-db';
import { seedStarterPackViaBrowser } from '../helpers/seed-starter-e2e';

loadTestEnv();

const PORT = 3106;
const BASE_URL = `http://127.0.0.1:${PORT}`;
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

async function assertNoHorizontalOverflow(page: Page, contextLabel: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${contextLabel}: scrollWidth (${metrics.scrollWidth}) > clientWidth (${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
}

test.describe('Stage 10 UX Polish: Concurrent Live Periods, Inline Rename/Quick Edit, 2-Step Escape, Persistence, Shortcuts & ntfy Reveal', () => {
  test.setTimeout(120_000);

  test.beforeAll(async () => {
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

  test('verifies all Stage 10 UX polish requirements across Desktop 1440x900 and Mobile 360x780', async ({
    page,
    request,
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

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });

    const unlockInput = page.getByLabel('passcode');
    if (await unlockInput.isVisible()) {
      const passcode = process.env.APP_PASSCODE;
      if (!passcode) {
        throw new Error('APP_PASSCODE is required for stage10 E2E test');
      }
      await unlockInput.fill(passcode);
      await page.getByRole('button', { name: 'فتح الجدول' }).click();
      await expect(unlockInput).toBeHidden({ timeout: 10_000 });
    }

    await seedStarterPackViaBrowser(page);
    await expect(page.locator('.day-strip .day-tile')).toHaveCount(7, {
      timeout: 20_000,
    });

    consoleErrors.length = 0;
    pageErrors.length = 0;

    // =========================================================================
    // (a) Now: Marking DONE does NOT show undo-toast while Ctrl+Z still works
    // =========================================================================
    await page.getByRole('tab', { name: 'ورد القرآن' }).click();
    const quranNowRow = page.getByTestId(
      `now-action-${STARTER_PACK_ACTION_IDS.QURAN_WIRD}`,
    );
    const quranNowDoneBtn = quranNowRow.getByRole('button', {
      name: /تسجيل تم للعمل/,
    });
    await quranNowDoneBtn.click();
    await expect(quranNowDoneBtn).toHaveClass(/active-done/);
    await expect(page.getByTestId('undo-toast')).toBeHidden();
    await page.keyboard.press('Control+KeyZ');
    await expect(quranNowDoneBtn).not.toHaveClass(/active-done/);

    // =========================================================================
    // (b) Now: Concurrent overlapping TIME_BOUND periods, ended period hidden,
    //     RTL ArrowLeft/ArrowRight period switching, Ctrl+ArrowLeft/ArrowRight day switching
    // =========================================================================
    const createdTempIds = await page.evaluate(async () => {
      const post = async (url: string, body: unknown) => {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'fetch',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(`POST ${url} failed: ${res.status} ${await res.text()}`);
        }
        return res.json();
      };

      // Two 23h58m/23h59m overlapping windows (Fajr(D) -> Fajr(D+1)-1/-2) + one 1-min ended window (Fajr(D) -> Fajr(D)+1)
      const p1 = (
        await post('/api/periods', {
          title: 'نافذة متداخلة أ',
          side: 'TIME_BOUND',
          sort_order: 90,
          start_anchor: 'FAJR',
          start_offset_min: 0,
          end_anchor: 'FAJR',
          end_offset_min: -1,
        })
      ).period.id as string;
      const p2 = (
        await post('/api/periods', {
          title: 'نافذة متداخلة ب',
          side: 'TIME_BOUND',
          sort_order: 91,
          start_anchor: 'FAJR',
          start_offset_min: 0,
          end_anchor: 'FAJR',
          end_offset_min: -2,
        })
      ).period.id as string;
      const pEnded = (
        await post('/api/periods', {
          title: 'نافذة منتهية تجريبية',
          side: 'TIME_BOUND',
          sort_order: 92,
          start_anchor: 'FAJR',
          start_offset_min: 0,
          end_anchor: 'FAJR',
          end_offset_min: 1,
        })
      ).period.id as string;

      await post('/api/actions', {
        period_id: p1,
        title: 'عمل متداخل أ',
        sort_order: 1,
      });
      await post('/api/actions', {
        period_id: p2,
        title: 'عمل متداخل ب',
        sort_order: 1,
      });
      await post('/api/actions', {
        period_id: pEnded,
        title: 'عمل منتهي',
        sort_order: 1,
      });

      return { p1, p2, pEnded };
    });

    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await assertNoHorizontalOverflow(page, 'Desktop 1440 Now concurrent');

    const liveAllPill = page.getByTestId('period-pill-live-all');
    await expect(liveAllPill).toBeVisible();
    await expect(liveAllPill).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('now-concurrent-divider').first()).toBeVisible();
    await expect(
      page.getByTestId(`now-period-panel-${createdTempIds.p1}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`now-period-panel-${createdTempIds.p2}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`now-period-panel-${createdTempIds.pEnded}`),
    ).toHaveCount(0);

    // RTL period arrow navigation: ArrowLeft advances to next pill (first TIME_BOUND period = الفجر); ArrowRight returns to live-all
    await page.keyboard.press('ArrowLeft');
    await expect(liveAllPill).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('tab', { name: 'الفجر' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowRight');
    await expect(liveAllPill).toHaveAttribute('aria-selected', 'true');

    // Ctrl+ArrowLeft advances +1 day; Ctrl+ArrowRight returns -1 day (back to today)
    const tomorrowIso = addDaysIso(todayIslamic, 1);
    await page.keyboard.press('Control+ArrowLeft');
    await expect(page.getByTestId('stale-date-banner')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`date=${tomorrowIso}`));
    await page.keyboard.press('Control+ArrowRight');
    await expect(page.getByTestId('stale-date-banner')).toHaveCount(0);

    // Clean up temporary concurrent/ended periods before Week tests
    await page.evaluate(async (ids) => {
      for (const pid of [ids.p1, ids.p2, ids.pEnded]) {
        const res = await fetch(`/api/periods/${pid}?force=true`, {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'fetch' },
        });
        if (!res.ok) {
          throw new Error(`Failed deleting temp period ${pid}: ${res.status}`);
        }
      }
    }, createdTempIds);

    await page.reload({ waitUntil: 'networkidle' });

    // =========================================================================
    // (a2) & (c) Week Table: no undo-toast + Ctrl+Z, instant crosshair + pointerleave clear,
    //           double-click inline rename (action & period) + persist,
    //           right-click EntityContextMenu -> Quick Edit (action & period) + save,
    //           2-step Escape on logged cells (1st clears, 2nd deselects)
    // =========================================================================
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الجدول الأسبوعي' })
      .click();
    await page.getByRole('tab', { name: 'نظرة واحدة' }).click();
    await expect(page.getByTestId('one-glance-split')).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Desktop 1440 Week One-Glance');

    const fajrCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_FARD}-${todayIslamic}`,
    );
    const fajrJamaahCell = page.getByTestId(
      `week-cell-${STARTER_PACK_ACTION_IDS.FAJR_JAMAAH}-${todayIslamic}`,
    );

    // Marking DONE in Week does NOT show undo-toast, Ctrl+Z undoes cleanly
    await fajrCell.dblclick();
    await expect(fajrCell).toHaveClass(/st-done/);
    await expect(page.getByTestId('undo-toast')).toBeHidden();
    await page.keyboard.press('Control+KeyZ');
    await expect(fajrCell).not.toHaveClass(/st-done/);

    // Crosshair defaults to instant (data-glide="false") and clears completely on pointerleave
    await fajrCell.hover();
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    const hoveredCrosshair = await fajrCell.evaluate((el) => {
      const stage = el.closest<HTMLElement>('.ledger-table-stage')!;
      const rowBar = stage.querySelector<HTMLElement>('.crosshair-row-bar')!;
      const colBar = stage.querySelector<HTMLElement>('.crosshair-col-bar')!;
      return {
        mode: stage.dataset.crosshairMode,
        rowActive: rowBar.dataset.active,
        colActive: colBar.dataset.active,
        rowGlide: rowBar.dataset.glide,
        colGlide: colBar.dataset.glide,
      };
    });
    expect(hoveredCrosshair).toEqual({
      mode: 'hover',
      rowActive: 'true',
      colActive: 'true',
      rowGlide: 'false',
      colGlide: 'false',
    });

    await page.mouse.move(10, 10);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    const leftCrosshair = await fajrCell.evaluate((el) => {
      const stage = el.closest<HTMLElement>('.ledger-table-stage')!;
      return {
        mode: stage.dataset.crosshairMode,
        rowActive: stage.querySelector<HTMLElement>('.crosshair-row-bar')?.dataset.active,
        colActive: stage.querySelector<HTMLElement>('.crosshair-col-bar')?.dataset.active,
        headActive: stage.querySelector<HTMLElement>('.crosshair-head-bar')?.dataset.active,
      };
    });
    expect(leftCrosshair).toEqual({
      mode: 'idle',
      rowActive: 'false',
      colActive: 'false',
      headActive: 'false',
    });

    // Double-click inline rename on Action & Period header + persistence across reload
    await page
      .getByRole('button', { name: 'تحديد صف صلاة الفجر' })
      .dblclick();
    const renameInput = page
      .getByTestId('one-glance-split')
      .getByTestId('inline-rename-input');
    await expect(page.getByTestId('inline-rename-input')).toHaveCount(1);
    await expect(renameInput).toBeVisible();
    await renameInput.fill('الفجر المعدلة');
    await renameInput.press('Enter');
    await expect(
      page.getByRole('button', { name: 'تحديد صف الفجر المعدلة' }),
    ).toBeVisible();

    await page
      .locator('.overview-table-time td.cell-period .period-select-btn', {
        hasText: 'الفجر',
      })
      .dblclick();
    await expect(renameInput).toBeVisible();
    await renameInput.fill('الفجر التجريبية');
    await renameInput.press('Enter');
    await expect(
      page.locator('.overview-table-time td.cell-period .period-select-btn', {
        hasText: 'الفجر التجريبية',
      }),
    ).toBeVisible();

    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 20_000 },
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الجدول الأسبوعي' })
      .click();
    await page.getByRole('tab', { name: 'نظرة واحدة' }).click();
    await expect(
      page.getByRole('button', { name: 'تحديد صف الفجر المعدلة' }),
    ).toBeVisible();
    await expect(
      page.locator('.overview-table-time td.cell-period .period-select-btn', {
        hasText: 'الفجر التجريبية',
      }),
    ).toBeVisible();

    // Right-click EntityContextMenu -> Quick Edit dialog for Action & Period (restore original titles)
    await page
      .locator('.overview-table-time td.cell-title', { hasText: 'الفجر المعدلة' })
      .click({ button: 'right' });
    const entityMenu = page.getByTestId('entity-context-menu');
    await expect(entityMenu).toBeVisible();
    await page.getByTestId('entity-menu-item-edit-action').click();
    const quickActionDialog = page.getByTestId('quick-action-edit-dialog');
    await expect(quickActionDialog).toBeVisible();
    await quickActionDialog
      .getByLabel('اسم العمل')
      .fill('صلاة الفجر');
    await page.getByTestId('quick-action-edit-save').click();
    await expect(quickActionDialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'تحديد صف صلاة الفجر' }),
    ).toBeVisible();

    await page
      .locator('.overview-table-time td.cell-period', {
        hasText: 'الفجر التجريبية',
      })
      .click({ button: 'right' });
    await expect(entityMenu).toBeVisible();
    await page.getByTestId('entity-menu-item-edit-period').click();
    const quickPeriodDialog = page.getByTestId('quick-period-edit-dialog');
    await expect(quickPeriodDialog).toBeVisible();
    await quickPeriodDialog.getByLabel('اسم الفترة').fill('الفجر');
    await page.getByTestId('quick-period-edit-save').click();
    await expect(quickPeriodDialog).toBeHidden();
    await expect(
      page.locator('.overview-table-time td.cell-period .period-select-btn', {
        hasText: 'الفجر',
      }),
    ).toBeVisible();

    // 2-step Escape on single focused logged cell AND multi-selected logged cells
    await page.waitForTimeout(520);
    await fajrCell.dblclick();
    await expect(fajrCell).toHaveClass(/st-done/);
    await expect(fajrCell).toHaveClass(/is-grid-focused/);
    await page.keyboard.press('Escape');
    await expect(fajrCell).not.toHaveClass(/st-done/);
    await expect(fajrCell).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(fajrCell).not.toHaveClass(/is-grid-focused/);

    await page.waitForTimeout(520);
    await fajrCell.dblclick();
    await page.waitForTimeout(520);
    await fajrJamaahCell.dblclick();
    await expect(fajrCell).toHaveClass(/st-done/);
    await expect(fajrJamaahCell).toHaveClass(/st-done/);
    await fajrCell.focus();
    await fajrJamaahCell.click({ modifiers: ['Shift'] });
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(fajrCell).not.toHaveClass(/st-done/);
    await expect(fajrJamaahCell).not.toHaveClass(/st-done/);
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.m-cell.is-grid-selected')).toHaveCount(0);

    // =========================================================================
    // (d) Expand/collapse persistence across navigation & reload:
    //     WeekView collapsedGroups, SettingsView accordions, ActionsSection period groups, Desktop sidebar
    // =========================================================================
    await page.getByRole('tab', { name: 'العرض المريح' }).click();
    await assertNoHorizontalOverflow(page, 'Desktop 1440 Week Standard');
    const fajrCollapseBtn = page
      .locator('.group-chevron-btn[aria-label="طي الفجر"]')
      .first();
    await fajrCollapseBtn.click();
    await expect(
      page.locator('.group-chevron-btn[aria-label="توسيع الفجر"]').first(),
    ).toHaveAttribute('aria-expanded', 'false');

    // Expand Settings accordions + Actions period group + collapse desktop sidebar
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الإعدادات' })
      .click();
    await assertNoHorizontalOverflow(page, 'Desktop 1440 Settings');

    await page.getByTestId('accordion-toggle-general').click();
    await page.getByTestId('accordion-toggle-actions').click();
    await page
      .getByTestId(`actions-period-toggle-${STARTER_PACK_PERIOD_IDS.FAJR}`)
      .click();
    await expect(
      page.getByTestId(`actions-period-toggle-${STARTER_PACK_PERIOD_IDS.FAJR}`),
    ).toHaveAttribute('aria-expanded', 'true');

    const shell = page.locator('.app-shell');
    await page.getByRole('button', { name: 'طي القائمة الجانبية' }).click();
    await expect(shell).toHaveClass(/sidebar-collapsed/);

    // Navigate away to الآن and back via Alt+1 / Alt+5 while sidebar is collapsed, then reload
    await page.keyboard.press('Alt+Digit1');
    await expect(page.locator('.day-strip')).toBeVisible();
    await page.keyboard.press('Alt+Digit5');
    await expect(page.getByTestId('accordion-toggle-general')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByTestId('accordion-toggle-actions')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(
      page.getByTestId(`actions-period-toggle-${STARTER_PACK_PERIOD_IDS.FAJR}`),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(shell).toHaveClass(/sidebar-collapsed/);

    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 15_000 },
    );
    await page.reload({ waitUntil: 'networkidle' });
    await expect(shell).toHaveClass(/sidebar-collapsed/);
    await expect(page.getByTestId('accordion-toggle-general')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByTestId('accordion-toggle-actions')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(
      page.getByTestId(`actions-period-toggle-${STARTER_PACK_PERIOD_IDS.FAJR}`),
    ).toHaveAttribute('aria-expanded', 'true');

    // Expand sidebar back before navigating to Week via desktop rail
    await page.getByRole('button', { name: 'فتح القائمة الجانبية' }).click();
    await expect(shell).not.toHaveClass(/sidebar-collapsed/);

    // Check WeekView collapsedGroups persisted across reload too
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الجدول الأسبوعي' })
      .click();
    await expect(
      page.locator('.group-chevron-btn[aria-label="توسيع الفجر"]').first(),
    ).toHaveAttribute('aria-expanded', 'false');
    await page
      .locator('.group-chevron-btn[aria-label="توسيع الفجر"]')
      .first()
      .click();
    await expect(
      page.locator('.group-chevron-btn[aria-label="طي الفجر"]').first(),
    ).toHaveAttribute('aria-expanded', 'true');

    // =========================================================================
    // (e) Ctrl+, and Alt+5 open Settings; ntfy copy-saved-url-btn & /api/settings/ntfy-reveal security
    // =========================================================================
    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الآن' })
      .click();
    await page.keyboard.press('Control+Comma');
    await expect(page.getByTestId('settings-expand-all-btn')).toBeVisible();

    await page
      .locator('.desktop-rail')
      .getByRole('button', { name: 'الآن' })
      .click();
    await page.keyboard.press('Alt+Digit5');
    await expect(page.getByTestId('settings-expand-all-btn')).toBeVisible();

    await page.getByTestId('accordion-toggle-ntfy').click();
    await page.getByTestId('ntfy-generate-btn').click();
    const generatedUrl = await page
      .getByTestId('ntfy-topic-url-input')
      .inputValue();
    await page
      .getByTestId('ntfy-access-token-input')
      .fill('tk_stage10_secret_token_check');
    await expect(page.getByTestId('sync-badge-btn')).toHaveAttribute(
      'data-sync',
      'synced',
      { timeout: 20_000 },
    );
    await page.getByTestId('ntfy-save-btn').click();
    await expect(page.getByTestId('ntfy-copy-saved-url-btn')).toBeVisible({
      timeout: 10_000,
    });

    // Test API contract & security directly
    const revealCheck = await page.evaluate(async () => {
      const okRes = await fetch('/api/settings/ntfy-reveal', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'fetch' },
      });
      const okJson = (await okRes.json()) as Record<string, unknown>;
      const cacheControl = okRes.headers.get('cache-control');
      return {
        status: okRes.status,
        cacheControl,
        json: okJson,
        rawText: JSON.stringify(okJson),
      };
    });
    expect(revealCheck.status).toBe(200);
    expect(revealCheck.cacheControl).toContain('no-store');
    expect(revealCheck.json).toEqual({ url: generatedUrl, source: 'db' });
    expect(revealCheck.rawText).not.toContain('tk_stage10_secret_token_check');

    // Missing CSRF header + missing Origin must be rejected (403) even with valid session cookie
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const missingCsrfRes = await request.post(
      `${BASE_URL}/api/settings/ntfy-reveal`,
      {
        headers: {
          Cookie: cookieHeader,
        },
      },
    );
    expect(missingCsrfRes.status()).toBe(403);

    // Unauthenticated request with CSRF header must be rejected (401)
    const unauthRes = await request.post(`${BASE_URL}/api/settings/ntfy-reveal`, {
      headers: {
        'X-Requested-With': 'fetch',
        Origin: BASE_URL,
      },
    });
    expect(unauthRes.status()).toBe(401);

    // =========================================================================
    // (f) Mobile 360x780 layout check: zero horizontal overflow & >= 44px quick-edit menu triggers
    // =========================================================================
    await page.setViewportSize({ width: 360, height: 780 });
    await page
      .locator('.mobile-nav')
      .getByRole('button', { name: 'الآن' })
      .click();
    await expect(page.locator('.day-strip')).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Mobile 360 Now');

    const nowWindowEditBtn = page.locator('.window-edit-btn').first();
    await expect(nowWindowEditBtn).toBeVisible();
    const nowEditBox = await nowWindowEditBtn.boundingBox();
    expect(nowEditBox).not.toBeNull();
    expect(nowEditBox!.width).toBeGreaterThanOrEqual(44);
    expect(nowEditBox!.height).toBeGreaterThanOrEqual(44);
    await nowWindowEditBtn.click();
    await expect(entityMenu).toBeVisible();
    await page.getByTestId('entity-menu-item-edit-period').click();
    await expect(quickPeriodDialog).toBeVisible();
    await quickPeriodDialog.getByRole('button', { name: 'إلغاء' }).click();
    await expect(quickPeriodDialog).toBeHidden();

    await page
      .locator('.mobile-nav')
      .getByRole('button', { name: 'الجدول' })
      .click();
    await expect(page.locator('.m-whoop-row').first()).toBeVisible();
    await assertNoHorizontalOverflow(page, 'Mobile 360 Week Cards');

    const mobileMenuBtns = page.locator(
      '.m-entity-menu-btn:not(.is-compact-cell)',
    );
    const mobileMenuCount = await mobileMenuBtns.count();
    expect(mobileMenuCount).toBeGreaterThan(0);
    const firstMobileMenuBox = await mobileMenuBtns.first().boundingBox();
    expect(firstMobileMenuBox).not.toBeNull();
    expect(firstMobileMenuBox!.width).toBeGreaterThanOrEqual(44);
    expect(firstMobileMenuBox!.height).toBeGreaterThanOrEqual(44);

    // Open mobile action quick-edit via 44px trigger
    const firstActionMenuBtn = page
      .locator('.m-whoop-head .m-entity-menu-btn')
      .first();
    await firstActionMenuBtn.click();
    await expect(entityMenu).toBeVisible();
    await page.getByTestId('entity-menu-item-edit-action').click();
    await expect(quickActionDialog).toBeVisible();
    await quickActionDialog.getByRole('button', { name: 'إلغاء' }).click();
    await expect(quickActionDialog).toBeHidden();

    await page
      .locator('.mobile-nav')
      .getByRole('button', { name: 'الإعدادات' })
      .click();
    await assertNoHorizontalOverflow(page, 'Mobile 360 Settings');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
