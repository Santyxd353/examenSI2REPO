/* The build replaces both constants with an allowlist of this release's public files. */
const CACHE = 'lumina-shell-' + '__LUMINA_SHELL_VERSION__';
const PUBLIC_FILES = __LUMINA_SHELL_FILES__;
const PUBLIC_PATHS = new Set(PUBLIC_FILES);
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          PUBLIC_FILES.map(
            (path) =>
              new Request(path, { credentials: 'omit', cache: 'reload', redirect: 'error' }),
          ),
        ),
      ),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('lumina-shell-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('Authorization')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/' && !url.searchParams.has('plataforma')) {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match('/')));
  } else if (!url.search && PUBLIC_PATHS.has(url.pathname) && url.pathname !== '/') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => (await cache.match(request)) ?? fetch(request)),
    );
  }
});
