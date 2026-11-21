'use client';

import React, { useEffect, useState } from 'react';
import { MohasbaProvider, useMohasba } from '../store/mohasba-provider';

interface QueryParamsState {
  view: string | null;
  period: string | null;
  date: string | null;
}

function HarnessInner() {
  const {
    hydrated,
    authStatus,
    isOnline,
    syncBadge,
    settings,
    periods,
    actions,
    logs,
    outbox,
    unlockWithPasscode,
    initOnboarding,
    signOut,
  } = useMohasba();

  const [query, setQuery] = useState<QueryParamsState>({
    view: null,
    period: null,
    date: null,
  });
  const [passcode, setPasscode] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const syncSearch = () => {
      const params = new URLSearchParams(window.location.search);
      setQuery({
        view: params.get('view'),
        period: params.get('period'),
        date: params.get('date'),
      });
    };
    syncSearch();
    window.addEventListener('popstate', syncSearch);
    return () => window.removeEventListener('popstate', syncSearch);
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await unlockWithPasscode(passcode);
    setStatusMessage(
      res.ok ? 'unlocked' : `${res.errorCode ?? 'ERROR'}: ${res.errorMessage ?? ''}`,
    );
  };

  const handleSignOut = async () => {
    const res = await signOut();
    setStatusMessage(res.ok ? 'signed_out' : res.errorMessage ?? 'signout_failed');
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-6 py-10">
      <header className="border-b border-[var(--border-hairline)] pb-4">
        <h1 className="text-xl font-semibold text-[var(--ink-primary)]">
          جدول المحاسبة
        </h1>
        <p className="mt-1 text-sm text-[var(--ink-secondary)]">
          Slice 3 PWA Offline Engine Harness
        </p>
      </header>

      <section
        data-testid="pwa-status"
        className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4 text-sm"
      >
        <div>hydrated: {String(hydrated)}</div>
        <div>authStatus: {authStatus}</div>
        <div>isOnline: {String(isOnline)}</div>
        <div>syncBadge: {syncBadge.state}</div>
        <div>
          counts: periods={periods.length}, actions={actions.length}, logs={logs.length}, outbox={outbox.length}
        </div>
        <div data-testid="query-params">
          query: view={query.view ?? ''}, period={query.period ?? ''}, date={query.date ?? ''}
        </div>
        {statusMessage && <div data-testid="status-message">{statusMessage}</div>}
      </section>

      {authStatus === 'locked' && (
        <form
          onSubmit={handleUnlock}
          className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4"
        >
          <input
            type="password"
            aria-label="passcode"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="رمز الدخول"
            className="rounded border border-[var(--border-hairline)] px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-[var(--accent-live)] px-3 py-1.5 text-sm text-white"
          >
            فتح الجدول
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        {authStatus === 'unlocked' && settings && !settings.onboarding_completed && (
          <button
            type="button"
            onClick={() => {
              void initOnboarding('starter_pack');
            }}
            className="rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
          >
            تفعيل الحزمة الأساسية
          </button>
        )}

        <button
          type="button"
          data-testid="signout-btn"
          onClick={() => {
            void handleSignOut();
          }}
          className="rounded border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
        >
          تسجيل الخروج
        </button>
      </div>
    </main>
  );
}

export function Slice3PwaHarness() {
  return (
    <MohasbaProvider>
      <HarnessInner />
    </MohasbaProvider>
  );
}
