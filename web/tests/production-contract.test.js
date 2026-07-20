import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    AssetIntegrityError,
    validateIntegrityManifest,
    verifyAssetBytes,
} from '../runtime-integrity.js';
import { verifyLocalAsset } from '../scripts/asset-integrity.mjs';
import { computeAppBuildId, resolveBuildIdentity } from '../scripts/build-identity.mjs';
import { CDN_ASSET_REVISION } from '../scripts/package-config.mjs';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helloEntry = {
    path: 'onnx/test.bin',
    size: 5,
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
};

test('runtime integrity rejects missing, duplicate, and tampered assets', async () => {
    const manifest = validateIntegrityManifest({
        revision: CDN_ASSET_REVISION,
        files: [helloEntry],
    }, {
        expectedRevision: CDN_ASSET_REVISION,
        requiredPaths: [helloEntry.path],
        exactPaths: true,
    });
    assert.equal(manifest.entries.get(helloEntry.path).size, 5);

    await assert.doesNotReject(() => verifyAssetBytes(
        new TextEncoder().encode('hello'),
        helloEntry,
        helloEntry.path,
        webcrypto.subtle
    ));
    await assert.rejects(
        () => verifyAssetBytes(new TextEncoder().encode('HELLO'), helloEntry, helloEntry.path, webcrypto.subtle),
        AssetIntegrityError
    );
    await assert.rejects(
        () => verifyAssetBytes(new TextEncoder().encode('shorter'), helloEntry, helloEntry.path, webcrypto.subtle),
        /expected 5 bytes/
    );
    assert.throws(() => validateIntegrityManifest({
        revision: CDN_ASSET_REVISION,
        files: [helloEntry, helloEntry],
    }), /duplicate path/);
});

test('packaging verifier rejects same-size local source tampering', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'supertonic-integrity-'));
    const filePath = path.join(tempDir, 'test.bin');
    try {
        await writeFile(filePath, 'hello');
        await assert.doesNotReject(() => verifyLocalAsset(filePath, helloEntry));
        await writeFile(filePath, 'HELLO');
        await assert.rejects(() => verifyLocalAsset(filePath, helloEntry), /SHA-256 mismatch/);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});

test('service-worker build identity changes with mode, base URL, and revision', () => {
    const staticIdentity = resolveBuildIdentity({
        mode: 'static',
        assetBaseUrls: 'assets',
        assetRevision: CDN_ASSET_REVISION,
    });
    const cdnIdentity = resolveBuildIdentity({
        mode: 'cdn',
        assetBaseUrls: `https://huggingface.co/model/resolve/${CDN_ASSET_REVISION}`,
        assetRevision: CDN_ASSET_REVISION,
    });
    const nextRevisionIdentity = resolveBuildIdentity({
        ...cdnIdentity,
        assetRevision: '0000000000000000000000000000000000000000',
    });
    const ids = [
        computeAppBuildId(webDir, staticIdentity),
        computeAppBuildId(webDir, cdnIdentity),
        computeAppBuildId(webDir, nextRevisionIdentity),
    ];
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => /^[0-9a-f]{16}$/.test(id)));
});

test('voice waveform rendering does not require inline styles', async () => {
    const [source, css] = await Promise.all([
        readFile(path.join(webDir, 'voices.js'), 'utf8'),
        readFile(path.join(webDir, 'voices.css'), 'utf8'),
    ]);
    assert.doesNotMatch(source, /<span\s+style=/);
    for (let height = 18; height <= 47; height += 1) {
        assert.match(source, /voice-bar-height-/);
        assert.match(css, new RegExp(`\\.voice-bar-height-${height}\\s*\\{\\s*height:\\s*${height}px;`));
    }
});

test('WebGPU is attempted only after a usable adapter is acquired', async () => {
    const [main, helper] = await Promise.all([
        readFile(path.join(webDir, 'main.js'), 'utf8'),
        readFile(path.join(webDir, 'helper.js'), 'utf8'),
    ]);
    assert.match(main, /function hasUsableWebGpu\(\)/);
    assert.match(main, /if \(!await hasUsableWebGpu\(\)\)/);
    assert.match(main, /navigator\.gpu\.requestAdapter\(\)/);
    assert.match(helper, /ort-wasm-simd-threaded\.jsep\.mjs/);
    assert.doesNotMatch(helper, /ort-wasm-simd-threaded\.jsep\.js/);
});
