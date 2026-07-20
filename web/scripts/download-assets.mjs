import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import {
    CDN_ASSET_REVISION,
    REQUIRED_ONNX_FILES,
    REQUIRED_VOICE_STYLE_FILES,
} from './package-config.mjs';

const MODEL_ID = 'Supertone/supertonic-3';
const RESOLVE_BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/${CDN_ASSET_REVISION}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../assets');
const integrityManifestPath = path.resolve(__dirname, '../assets-integrity.json');
const force = process.argv.includes('--force');

async function fileSha256(filePath) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

async function hasExpectedIntegrity(filePath, entry) {
    try {
        const fileStat = await stat(filePath);
        return fileStat.isFile() &&
            fileStat.size === entry.size &&
            await fileSha256(filePath) === entry.sha256;
    } catch {
        return false;
    }
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return 'unknown size';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function getAssetFiles() {
    const manifest = JSON.parse(await readFile(integrityManifestPath, 'utf8'));
    if (manifest.revision !== CDN_ASSET_REVISION) {
        throw new Error('Asset integrity manifest revision does not match package configuration.');
    }
    const expectedPaths = [
        ...REQUIRED_ONNX_FILES.map((file) => `onnx/${file}`),
        ...REQUIRED_VOICE_STYLE_FILES.map((file) => `voice_styles/${file}`),
    ].sort();
    const entries = Array.isArray(manifest.files) ? manifest.files : [];
    const actualPaths = entries.map((entry) => entry.path).sort();
    if (new Set(actualPaths).size !== actualPaths.length ||
        JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
        throw new Error('Asset integrity manifest must contain the exact required ONNX and voice-style files.');
    }
    for (const entry of entries) {
        if (!Number.isSafeInteger(entry.size) || entry.size < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
            throw new Error(`Invalid integrity metadata for ${entry.path}.`);
        }
    }
    return entries;
}

async function downloadFile(entry) {
    const filename = entry.path;
    const targetPath = path.join(assetsDir, filename);
    const targetDir = path.dirname(targetPath);

    if (!force && await hasExpectedIntegrity(targetPath, entry)) {
        console.log(`verified ${filename}`);
        return;
    }

    await mkdir(targetDir, { recursive: true });

    const url = `${RESOLVE_BASE_URL}/${filename}?download=true`;
    const response = await fetch(url);
    if (!response.ok || !response.body) {
        throw new Error(`Could not download ${filename}: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('content-length'));
    console.log(`download ${filename} (${formatBytes(contentLength)})`);

    const tempPath = `${targetPath}.download`;
    const fileStream = createWriteStream(tempPath);
    await finished(Readable.fromWeb(response.body).pipe(fileStream));

    if (!await hasExpectedIntegrity(tempPath, entry)) {
        await unlink(tempPath).catch(() => {});
        throw new Error(`Downloaded asset failed size or SHA-256 verification: ${filename}`);
    }

    await unlink(targetPath).catch(() => {});
    await rename(tempPath, targetPath);
}

async function main() {
    const files = await getAssetFiles();
    if (files.length === 0) {
        throw new Error(`No ONNX or voice style assets found in ${MODEL_ID}`);
    }

    await mkdir(assetsDir, { recursive: true });

    for (const file of files) {
        await downloadFile(file);
    }

    console.log(`assets ready: ${assetsDir}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
