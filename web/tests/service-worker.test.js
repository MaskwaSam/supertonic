import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function serviceWorkerHarness({ scope = 'https://example.test/course/reader/', build = 'build-a' } = {}) {
    const handlers = new Map();
    const deleted = [];
    const opened = [];
    const cache = {
        addAll: async () => {},
        match: async () => undefined,
        put: async () => {},
    };
    const cacheStorage = {
        keys: async () => [
            'unrelated-app-cache',
            'supertonic-reader-shell:course_reader:old-build',
            `supertonic-reader-shell:course_reader:${build}`,
            'supertonic-reader-shell:different_scope:old-build',
        ],
        delete: async (name) => {
            deleted.push(name);
            return true;
        },
        open: async (name) => {
            opened.push(name);
            return cache;
        },
    };
    const self = {
        location: new URL(`sw.js?build=${build}`, scope),
        registration: { scope },
        clients: { claim: async () => {} },
        skipWaiting: async () => {},
        addEventListener: (name, handler) => handlers.set(name, handler),
    };
    const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
    vm.runInNewContext(source, {
        URL,
        Response,
        console,
        fetch: async () => new Response('{}', { status: 200 }),
        caches: cacheStorage,
        self,
    });
    return { handlers, deleted, opened };
}

test('activation deletes only stale Supertonic caches for the current scope', async () => {
    const harness = await serviceWorkerHarness();
    let activation;
    harness.handlers.get('activate')({ waitUntil: (promise) => { activation = promise; } });
    await activation;
    assert.deepEqual(harness.deleted, ['supertonic-reader-shell:course_reader:old-build']);
});

test('install opens a cache keyed by scope and build id', async () => {
    const harness = await serviceWorkerHarness({ build: 'release-42' });
    let installation;
    harness.handlers.get('install')({ waitUntil: (promise) => { installation = promise; } });
    await installation;
    assert.deepEqual(harness.opened, ['supertonic-reader-shell:course_reader:release-42']);
});
