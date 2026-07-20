import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const APP_BUILD_INPUTS = Object.freeze([
    'assets-integrity.json',
    'helper.js',
    'index.html',
    'main.js',
    'package-lock.json',
    'public/sw.js',
    'runtime-integrity.js',
    'runtime-policy.js',
    'scripts/build-identity.mjs',
    'scripts/package-config.mjs',
    'speech-normalizer.js',
    'style.css',
    'vite.config.js',
    'voices.css',
    'voices.html',
    'voices.js',
]);

export function resolveBuildIdentity({
    mode = process.env.SUPERTONIC_BUILD_MODE || 'development',
    assetBaseUrls = process.env.VITE_SUPERTONIC_ASSET_BASE_URLS ||
        process.env.VITE_SUPERTONIC_ASSET_BASE_URL ||
        'assets',
    assetRevision = '',
} = {}) {
    const normalizedMode = String(mode || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]*$/.test(normalizedMode)) {
        throw new Error(`Invalid Supertonic build mode: ${mode}`);
    }
    const normalizedBaseUrls = String(assetBaseUrls || '').trim();
    if (!normalizedBaseUrls) {
        throw new Error('Supertonic asset base URLs must not be empty.');
    }
    if (assetRevision && !/^[0-9a-f]{40}$/.test(assetRevision)) {
        throw new Error('Supertonic asset revision must be a full Git commit.');
    }
    return Object.freeze({
        mode: normalizedMode,
        assetBaseUrls: normalizedBaseUrls,
        assetRevision,
    });
}

export function computeAppBuildId(webDir, identity) {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(identity));
    hash.update('\0');
    for (const input of APP_BUILD_INPUTS) {
        hash.update(input);
        hash.update('\0');
        hash.update(readFileSync(path.join(webDir, input)));
        hash.update('\0');
    }
    return hash.digest('hex').slice(0, 16);
}
