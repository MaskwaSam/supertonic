import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    CDN_ASSET_REVISION,
    REQUIRED_ONNX_FILES,
    REQUIRED_VOICE_STYLE_FILES,
} from '../scripts/package-config.mjs';

test('asset integrity manifest exactly covers the pinned release inputs', async () => {
    const manifest = JSON.parse(await readFile(
        new URL('../assets-integrity.json', import.meta.url),
        'utf8',
    ));
    const expected = [
        ...REQUIRED_ONNX_FILES.map((file) => `onnx/${file}`),
        ...REQUIRED_VOICE_STYLE_FILES.map((file) => `voice_styles/${file}`),
    ].sort();
    const actual = manifest.files.map((entry) => entry.path).sort();

    assert.equal(manifest.revision, CDN_ASSET_REVISION);
    assert.deepEqual(actual, expected);
    assert.equal(new Set(actual).size, actual.length);
    assert.ok(manifest.files.every((entry) => Number.isSafeInteger(entry.size) && entry.size > 0));
    assert.ok(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
});
