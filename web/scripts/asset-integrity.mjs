import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateIntegrityManifest } from '../runtime-integrity.js';
import {
    CDN_ASSET_REVISION,
    REQUIRED_ONNX_FILES,
    REQUIRED_VOICE_STYLE_FILES,
} from './package-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WEB_DIR = path.resolve(__dirname, '..');
export const SOURCE_ASSETS_DIR = path.resolve(WEB_DIR, '../assets');
export const INTEGRITY_MANIFEST_PATH = path.join(WEB_DIR, 'assets-integrity.json');

export const REQUIRED_RELEASE_ASSET_PATHS = Object.freeze([
    ...REQUIRED_ONNX_FILES.map((file) => `onnx/${file}`),
    ...REQUIRED_VOICE_STYLE_FILES.map((file) => `voice_styles/${file}`),
].sort());

export async function fileSha256(filePath) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

export async function loadSourceIntegrityManifest() {
    const manifest = JSON.parse(await readFile(INTEGRITY_MANIFEST_PATH, 'utf8'));
    return validateIntegrityManifest(manifest, {
        expectedRevision: CDN_ASSET_REVISION,
        requiredPaths: REQUIRED_RELEASE_ASSET_PATHS,
        exactPaths: true,
    });
}

export async function verifyLocalAsset(filePath, entry, label = entry.path) {
    let fileStat;
    try {
        fileStat = await stat(filePath);
    } catch {
        throw new Error(`Missing required pinned asset ${label}: ${filePath}`);
    }
    if (!fileStat.isFile()) {
        throw new Error(`Required pinned asset is not a file: ${label}`);
    }
    if (fileStat.size !== entry.size) {
        throw new Error(`Pinned asset size mismatch for ${label}: expected ${entry.size}, received ${fileStat.size}.`);
    }
    const actualSha256 = await fileSha256(filePath);
    if (actualSha256 !== entry.sha256) {
        throw new Error(`Pinned asset SHA-256 mismatch for ${label}. Run npm run assets:download -- --force.`);
    }
}

export async function verifyLocalAssets(relativePaths, assetsDir = SOURCE_ASSETS_DIR) {
    const manifest = await loadSourceIntegrityManifest();
    for (const relativePath of relativePaths) {
        const entry = manifest.entries.get(relativePath);
        if (!entry) {
            throw new Error(`No pinned integrity metadata exists for ${relativePath}.`);
        }
        await verifyLocalAsset(path.join(assetsDir, relativePath), entry, relativePath);
    }
    return manifest;
}
