import { expect, type Page } from '@playwright/test';

/**
 * Seeds the canonical legacy Starter Pack via POST /api/bootstrap/init while verifying
 * the 2-step 3-level Onboarding Wizard renders cleanly on first run.
 */
export async function seedStarterPackViaBrowser(page: Page): Promise<void> {
  const wizard = page.getByTestId('onboarding-wizard');
  await expect(wizard).toBeVisible({ timeout: 10_000 });

  await page.evaluate(async () => {
    const res = await fetch('/api/bootstrap/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'fetch',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ mode: 'starter_pack' }),
    });
    if (!res.ok) {
      throw new Error(`Starter pack seed failed: ${res.status} ${await res.text()}`);
    }
  });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.day-strip .day-tile')).toHaveCount(7, {
    timeout: 20_000,
  });
}
