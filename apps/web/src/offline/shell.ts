/// <reference types="vite/client" />
let ready: Promise<ServiceWorkerRegistration | undefined> | undefined;

export function prepareOfflineShell() {
  if (!import.meta.env.PROD) return Promise.resolve(undefined);
  if (!('serviceWorker' in navigator) || !isSecureContext)
    return Promise.reject(new Error('Para guardar la aplicación, ábrela en HTTPS o localhost.'));
  if (!ready)
    ready = (async () => {
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      let timer: number | undefined;
      try {
        return await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () =>
                reject(new Error('La aplicación no terminó de guardarse. Reintenta con conexión.')),
              15000,
            );
          }),
        ]);
      } finally {
        window.clearTimeout(timer);
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
  return ready;
}
