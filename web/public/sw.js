const CACHE_NAME = 'mr-pattersons-reader-shell-v2';
const APP_SHELL = [
    './',
    './index.html'
];

function shouldSkipCache(request) {
    const url = new URL(request.url);

    if (request.method !== 'GET') {
        return true;
    }

    if (url.origin !== self.location.origin) {
        return true;
    }

    if (url.pathname.includes('/assets/onnx/') || url.pathname.includes('/assets/voice_styles/')) {
        return true;
    }

    return false;
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
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
            const networkResponse = fetch(event.request)
                .then((response) => {
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => cache.put(event.request, responseClone));
                    }
                    return response;
                })
                .catch(() => cachedResponse);

            return cachedResponse || networkResponse;
        })
    );
});
