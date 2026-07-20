const CACHE_NAME = 'supertonic-reader-shell-v9';
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

async function updateCache(request, response) {
    if (!response || !response.ok || !response.clone) {
        return;
    }

    try {
        const cache = await caches.open(CACHE_NAME);
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
                    .filter((key) => key !== CACHE_NAME)
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
        caches.match(event.request).then((cachedResponse) => {
            if (isNavigationRequest(event.request)) {
                return fetch(event.request)
                    .then((response) => {
                        updateCache(event.request, response);
                        return response;
                    })
                    .catch(async () => {
                        const offlineResponse = cachedResponse || await caches.match(OFFLINE_FALLBACK_URL);
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
                        updateCache(event.request, response);
                    }
                    return response;
                })
                .catch(() => cachedResponse);

            return cachedResponse || networkResponse;
        })
    );
});
