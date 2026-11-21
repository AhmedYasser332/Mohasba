import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { expect, test } from '@playwright/test';

dotenv.config({
  path: path.resolve(process.cwd(), '.env.local'),
  quiet: true,
});

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess: ChildProcess | null = null;

async function waitForHealth(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // keep polling until server is listening
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

test.describe('Slice 3: Service Worker, Precache Manifest, Offline Reload & Sign-Out Wipe', () => {
  test.beforeAll(async () => {
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

  test('verifies headers, atomic SW cache.addAll(), NetworkOnly /api/*, offline deep-link reload, and logout 4-store IDB wipe', async ({
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

    // 1. Check security & Cache-Control headers on /, /sw.js, /sw-manifest.json
    const rootRes = await page.request.get(`${BASE_URL}/`);
    expect(rootRes.status()).toBe(200);
    expect(rootRes.headers()['x-content-type-options']).toBe('nosniff');
    expect(rootRes.headers()['x-frame-options']).toBe('DENY');
    expect(rootRes.headers()['referrer-policy']).toBe(
      'strict-origin-when-cross-origin',
    );

    const swRes = await page.request.get(`${BASE_URL}/sw.js`);
    expect(swRes.status()).toBe(200);
    expect(swRes.headers()['cache-control']).toBe(
      'no-store, no-cache, must-revalidate',
    );
    expect(swRes.headers()['content-type']).toContain(
      'application/javascript',
    );
    expect(swRes.headers()['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self'",
    );

    const manifestRes = await page.request.get(`${BASE_URL}/sw-manifest.json`);
    expect(manifestRes.status()).toBe(200);
    expect(manifestRes.headers()['cache-control']).toBe(
      'no-store, no-cache, must-revalidate',
    );
    const swManifest = (await manifestRes.json()) as {
      buildId: string;
      assets: string[];
    };
    expect(swManifest.buildId.length).toBeGreaterThan(0);
    expect(swManifest.assets).toContain('/');
    expect(swManifest.assets).toContain('/manifest.webmanifest');
    expect(swManifest.assets.some((a) => a.includes('\\'))).toBe(false);
    expect(swManifest.assets.some((a) => a.endsWith('.map'))).toBe(false);

    // 2. Load / and wait for SW activation + atomic precache
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'جدول المحاسبة' })).toBeVisible();

    const cacheInfo = await page.evaluate(async (expectedBuildId) => {
      const reg = await navigator.serviceWorker.ready;
      const cacheName = `mohasba-shell-${expectedBuildId}`;
      const cache = await caches.open(cacheName);
      const cachedRequests = await cache.keys();
      const cachedPaths = cachedRequests.map((req) => new URL(req.url).pathname);
      return {
        swActiveState: reg.active?.state ?? null,
        cacheKeys: await caches.keys(),
        cachedPaths,
      };
    }, swManifest.buildId);

    expect(cacheInfo.swActiveState).toBe('activated');
    expect(cacheInfo.cacheKeys).toContain(`mohasba-shell-${swManifest.buildId}`);
    for (const asset of swManifest.assets) {
      expect(cacheInfo.cachedPaths).toContain(asset);
    }

    // Reload once so the SW actively controls this client
    await page.reload({ waitUntil: 'networkidle' });
    const hasController = await page.evaluate(
      () => navigator.serviceWorker.controller !== null,
    );
    expect(hasController).toBe(true);

    // 3. Unlock if APP_PASSCODE is configured so IDB hydrates with bootstrap data
    const unlockInput = page.getByLabel('passcode');
    if (await unlockInput.isVisible()) {
      const passcode = process.env.APP_PASSCODE;
      if (!passcode) {
        throw new Error('APP_PASSCODE is required to unlock during E2E test');
      }
      await unlockInput.fill(passcode);
      await page.getByRole('button', { name: 'فتح الجدول' }).click();
      await expect(page.getByTestId('pwa-status')).toContainText(
        'authStatus: unlocked',
      );
    }

    // Wait for IDB snapshot & meta to be populated
    await expect
      .poll(async () => {
        return page.evaluate(async () => {
          const req = indexedDB.open('mohasba-db', 1);
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const countStore = (name: string) =>
            new Promise<number>((resolve, reject) => {
              const tx = db.transaction(name, 'readonly');
              const r = tx.objectStore(name).count();
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
          const snapshotCount = await countStore('snapshot');
          const metaCount = await countStore('meta');
          db.close();
          return { snapshotCount, metaCount };
        });
      })
      .toEqual({ snapshotCount: 4, metaCount: expect.any(Number) });

    // Confirm /api/health works online and is NOT in SW cache
    const healthOnline = await page.evaluate(async () => {
      const r = await fetch('/api/health');
      const matched = await caches.match('/api/health');
      return { status: r.status, cached: Boolean(matched) };
    });
    expect(healthOnline.status).toBe(200);
    expect(healthOnline.cached).toBe(false);

    // 4. Go OFFLINE: verify /api/health fails (NetworkOnly) and / + /?period=asr&date=2026-11-21 load cleanly from cache
    await context.setOffline(true);

    const healthOfflineFailed = await page.evaluate(async () => {
      try {
        await fetch('/api/health');
        return false;
      } catch {
        return true;
      }
    });
    expect(healthOfflineFailed).toBe(true);

    // Clear pre-offline/intentional-probe logs; assert 0 console/page errors during offline reloads & sign-out
    consoleErrors.length = 0;
    pageErrors.length = 0;

    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'جدول المحاسبة' })).toBeVisible();
    await expect(page.getByTestId('pwa-status')).toContainText('hydrated: true');

    await page.goto(`${BASE_URL}/?period=asr&date=2026-11-21`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'جدول المحاسبة' })).toBeVisible();
    await expect(page.getByTestId('query-params')).toContainText(
      'period=asr, date=2026-11-21',
    );

    // Assert zero console errors & zero page errors during offline reloads
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);

    // 5. Go back ONLINE and verify POST /api/logout clears cookie + wipes all 4 IDB stores
    await context.setOffline(false);
    await page.getByTestId('signout-btn').click();
    await expect(page.getByTestId('status-message')).toContainText('signed_out');

    const cookies = await context.cookies(BASE_URL);
    const sessionCookie = cookies.find((c) => c.name === 'mohasba_session');
    expect(sessionCookie).toBeUndefined();

    const storeCountsAfterLogout = await page.evaluate(async () => {
      const req = indexedDB.open('mohasba-db', 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const countStore = (name: string) =>
        new Promise<number>((resolve, reject) => {
          const tx = db.transaction(name, 'readonly');
          const r = tx.objectStore(name).count();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      const counts = {
        snapshot: await countStore('snapshot'),
        logs: await countStore('logs'),
        outbox: await countStore('outbox'),
        meta: await countStore('meta'),
      };
      db.close();
      return counts;
    });

    expect(storeCountsAfterLogout).toEqual({
      snapshot: 0,
      logs: 0,
      outbox: 0,
      meta: 0,
    });
  });
});
