const SERVICE_WORKER_URL = new URL(self.location.href);
const SCOPE_URL = new URL(self.registration.scope);
const BUILD_ID = (SERVICE_WORKER_URL.searchParams.get('build') || 'unversioned')
    .replace(/[^A-Za-z0-9._-]/g, '_');
const SCOPE_KEY = SCOPE_URL.pathname
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '') || 'root';
const CACHE_PREFIX = `supertonic-reader-shell:${SCOPE_KEY}:`;
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const FALLBACK_APP_SHELL = [
    './',
    './index.html',
    './voices.html'
];
const APP_SHELL_MANIFEST_URL = './app-shell-manifest.json';
const OFFLINE_FALLBACK_URL = './index.html';

function shouldSkipCache(request) {
    const url = new URL(request.url);

    if (request.method !== 'GET') {
        return true;
    }

    if (url.origin !== self.location.origin) {
        return true;
    }

    if (!url.href.startsWith(SCOPE_URL.href)) {
        return true;
    }

    if (
        url.pathname.includes('/assets/onnx/') ||
        url.pathname.includes('/assets/voice_styles/') ||
        url.pathname.includes('/onnx-runtime/')
    ) {
        return true;
    }

    return false;
}

function isNavigationRequest(request) {
    const accept = request.headers.get('accept') || '';

    return request.mode === 'navigate' ||
        (request.destination === 'document' && accept.includes('text/html'));
}

async function updateCache(cache, request, response) {
    if (!response || !response.ok || !response.clone) {
        return;
    }

    try {
        await cache.put(request, response.clone());
    } catch (error) {
        console.warn('Supertonic service worker could not update cache.', error);
    }
}

async function appShellUrls() {
    const urls = [...FALLBACK_APP_SHELL];

    try {
        const response = await fetch(APP_SHELL_MANIFEST_URL, { cache: 'no-store' });
        if (!response.ok) {
            return urls;
        }

        const manifest = await response.json();
        if (Array.isArray(manifest.files)) {
            urls.push(...manifest.files);
        }
    } catch (error) {
        console.warn('Supertonic service worker could not load the app shell manifest.', error);
    }

    return [...new Set(urls)];
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(await appShellUrls());
            await self.skipWaiting();
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (shouldSkipCache(event.request)) {
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cachedResponse = await cache.match(event.request);
            if (isNavigationRequest(event.request)) {
                return fetch(event.request)
                    .then((response) => {
                        updateCache(cache, event.request, response);
                        return response;
                    })
                    .catch(async () => {
                        const fallbackUrl = new URL(OFFLINE_FALLBACK_URL, SCOPE_URL).href;
                        const offlineResponse = cachedResponse || await cache.match(fallbackUrl);
                        if (offlineResponse) {
                            return offlineResponse;
                        }

                        return new Response('Offline', {
                            status: 503,
                            statusText: 'Offline',
                            headers: {
                                'Content-Type': 'text/plain',
                            },
                        });
                    });
            }

            const networkResponse = fetch(event.request)
                .then((response) => {
                    if (response.ok) {
                        updateCache(cache, event.request, response);
                    }
                    return response;
                })
                .catch(() => cachedResponse);

            return cachedResponse || networkResponse;
        })
    );
});
