import { loadTestEnv } from './load-env';

export const TEST_ORIGIN = 'http://localhost:3000';

export interface EnvSnapshot {
  NODE_ENV: string | undefined;
  APP_PASSCODE: string | undefined;
  ALLOW_UNAUTHENTICATED: string | undefined;
  CRON_SECRET: string | undefined;
  APP_URL: string | undefined;
  NTFY_TOPIC_URL: string | undefined;
}

export function snapshotEnv(): EnvSnapshot {
  loadTestEnv();
  return {
    NODE_ENV: process.env.NODE_ENV,
    APP_PASSCODE: process.env.APP_PASSCODE,
    ALLOW_UNAUTHENTICATED: process.env.ALLOW_UNAUTHENTICATED,
    CRON_SECRET: process.env.CRON_SECRET,
    APP_URL: process.env.APP_URL,
    NTFY_TOPIC_URL: process.env.NTFY_TOPIC_URL,
  };
}

export function restoreEnv(snap: EnvSnapshot): void {
  const keys: Array<keyof EnvSnapshot> = [
    'NODE_ENV',
    'APP_PASSCODE',
    'ALLOW_UNAUTHENTICATED',
    'CRON_SECRET',
    'APP_URL',
    'NTFY_TOPIC_URL',
  ];
  const env = process.env as Record<string, string | undefined>;
  for (const k of keys) {
    if (snap[k] === undefined) {
      delete env[k];
    } else {
      env[k] = snap[k];
    }
  }
}

export function enableTestUnauthenticatedMode(): void {
  loadTestEnv();
  delete process.env.APP_PASSCODE;
  process.env.ALLOW_UNAUTHENTICATED = 'true';
  process.env.APP_URL = TEST_ORIGIN;
  if (!process.env.CRON_SECRET) {
    process.env.CRON_SECRET = 'test-cron-secret-0123456789abcdef';
  }
}

export function makeGetRequest(
  pathAndQuery: string,
  extraHeaders?: Record<string, string>,
): Request {
  return new Request(`${TEST_ORIGIN}${pathAndQuery}`, {
    method: 'GET',
    headers: {
      ...(extraHeaders ?? {}),
    },
  });
}

export function makeJsonRequest(
  pathAndQuery: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Request {
  return new Request(`${TEST_ORIGIN}${pathAndQuery}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: TEST_ORIGIN,
      ...(extraHeaders ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export function extractCookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) {
    throw new Error('Expected Set-Cookie header to be present');
  }
  const firstPart = setCookieHeader.split(';')[0]?.trim();
  if (!firstPart) {
    throw new Error('Invalid Set-Cookie header');
  }
  return firstPart;
}
