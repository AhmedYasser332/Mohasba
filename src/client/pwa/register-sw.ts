export interface ServiceWorkerRegistrationHandle {
  registration: ServiceWorkerRegistration | null;
  dispose: () => void;
}

export interface RegisterServiceWorkerOptions {
  onUpdateAvailable?: (registration: ServiceWorkerRegistration) => void;
  onControllerChange?: () => void;
}

export function isIosNonStandalone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  const isIosDevice =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIosDevice) {
    return false;
  }
  const navWithStandalone = navigator as Navigator & { standalone?: boolean };
  const isStandaloneDisplay =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  return !isStandaloneDisplay && navWithStandalone.standalone !== true;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.persist !== 'function'
  ) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function applyWaitingServiceWorker(
  registration: ServiceWorkerRegistration | null | undefined,
): boolean {
  if (!registration?.waiting) {
    return false;
  }
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export async function registerServiceWorker(
  options: RegisterServiceWorkerOptions = {},
): Promise<ServiceWorkerRegistrationHandle> {
  if (
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return { registration: null, dispose: () => {} };
  }

  void requestPersistentStorage();

  const hadController = Boolean(navigator.serviceWorker.controller);
  let controllerChanged = false;
  const handleControllerChange = () => {
    // Only reload when upgrading from an existing SW controller (never on first-ever clients.claim())
    if (!hadController || controllerChanged) {
      return;
    }
    controllerChanged = true;
    options.onControllerChange?.();
  };
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    handleControllerChange,
  );

  let registration: ServiceWorkerRegistration | null = null;
  const cleanups: Array<() => void> = [];

  try {
    registration = await navigator.serviceWorker.register('/sw.js', {
      updateViaCache: 'none',
      scope: '/',
    });

    if (registration.waiting && navigator.serviceWorker.controller) {
      options.onUpdateAvailable?.(registration);
    }

    const handleUpdateFound = () => {
      const installing = registration?.installing;
      if (!installing) return;

      const handleStateChange = () => {
        if (
          installing.state === 'installed' &&
          navigator.serviceWorker.controller &&
          registration
        ) {
          options.onUpdateAvailable?.(registration);
        }
      };

      installing.addEventListener('statechange', handleStateChange);
      cleanups.push(() =>
        installing.removeEventListener('statechange', handleStateChange),
      );
    };

    registration.addEventListener('updatefound', handleUpdateFound);
    cleanups.push(() =>
      registration?.removeEventListener('updatefound', handleUpdateFound),
    );
  } catch {
    // SW registration failure should never crash the UI
  }

  return {
    registration,
    dispose: () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      );
      for (const cleanup of cleanups) {
        cleanup();
      }
    },
  };
}
