import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'Supertone/supertonic-3';
const ASSET_REVISION = process.env.SUPERTONIC_ASSET_REVISION || '724fb5abbf5502583fb520898d45929e62f02c0b';
const API_URL = `https://huggingface.co/api/models/${MODEL_ID}/revision/${ASSET_REVISION}`;
const RESOLVE_BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/${ASSET_REVISION}`;
const REQUIRED_ASSET_FILES = [
    'onnx/duration_predictor.onnx',
    'onnx/text_encoder.onnx',
    'onnx/tts.json',
    'onnx/unicode_indexer.json',
    'onnx/vector_estimator.onnx',
    'onnx/vocoder.onnx',
    'voice_styles/F1.json',
    'voice_styles/F2.json',
    'voice_styles/F3.json',
    'voice_styles/F4.json',
    'voice_styles/F5.json',
    'voice_styles/M1.json',
    'voice_styles/M2.json',
    'voice_styles/M3.json',
    'voice_styles/M4.json',
    'voice_styles/M5.json',
];
const EXPECTED_SHA256 = new Map(Object.entries({
    'onnx/duration_predictor.onnx': 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db',
    'onnx/text_encoder.onnx': 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff',
    'onnx/tts.json': '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09',
    'onnx/unicode_indexer.json': '9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f',
    'onnx/vector_estimator.onnx': '883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c',
    'onnx/vocoder.onnx': '085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba',
    'voice_styles/F1.json': 'bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2',
    'voice_styles/F2.json': '7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6',
    'voice_styles/F3.json': '12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab',
    'voice_styles/F4.json': 'c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b',
    'voice_styles/F5.json': '45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d',
    'voice_styles/M1.json': 'e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b',
    'voice_styles/M2.json': 'b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50',
    'voice_styles/M3.json': 'ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b',
    'voice_styles/M4.json': 'ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303',
    'voice_styles/M5.json': 'dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2',
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../assets');
const cliArgs = new Set(process.argv.slice(2));
const force = cliArgs.has('--force');
const dryRun = cliArgs.has('--dry-run');
const verifyOnly = cliArgs.has('--verify') || cliArgs.has('--verify-assets');

async function exists(filePath) {
    try {
        const fileStat = await stat(filePath);
        return fileStat.isFile() && fileStat.size > 0;
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
    const response = await fetch(API_URL);
    if (!response.ok) {
        throw new Error(`Could not read Hugging Face model metadata: ${response.status} ${response.statusText}`);
    }

    const metadata = await response.json();
    const available = new Set(metadata.siblings
        .map((sibling) => sibling.rfilename)
        .filter((filename) => filename.startsWith('onnx/') || filename.startsWith('voice_styles/')));
    const missing = REQUIRED_ASSET_FILES.filter((filename) => !available.has(filename));
    if (missing.length > 0) {
        throw new Error(`Pinned asset revision is missing required files:\n${missing.join('\n')}`);
    }

    return REQUIRED_ASSET_FILES;
}

async function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

async function verifyFile(filename) {
    const expected = EXPECTED_SHA256.get(filename);
    if (!expected) {
        throw new Error(`Missing expected SHA-256 for required asset: ${filename}`);
    }

    const filePath = path.join(assetsDir, filename);
    const actual = await sha256File(filePath);
    if (actual !== expected) {
        throw new Error(`SHA-256 mismatch for ${filename}: expected ${expected}, got ${actual}`);
    }

    return actual;
}

async function downloadFile(filename) {
    const targetPath = path.join(assetsDir, filename);
    const targetDir = path.dirname(targetPath);

    if (!force && await exists(targetPath)) {
        await verifyFile(filename);
        console.log(`skip ${filename}`);
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

    await unlink(targetPath).catch(() => {});
    await rename(tempPath, targetPath);
    await verifyFile(filename);
}

async function main() {
    if (dryRun) {
        console.log(`asset revision: ${ASSET_REVISION}`);
        for (const file of REQUIRED_ASSET_FILES) {
            const local = await exists(path.join(assetsDir, file)) ? 'present' : 'missing';
            console.log(`${local} ${file} -> ${RESOLVE_BASE_URL}/${file}`);
        }
        return;
    }

    if (verifyOnly) {
        for (const file of REQUIRED_ASSET_FILES) {
            await verifyFile(file);
            console.log(`verified ${file}`);
        }
        return;
    }

    const files = await getAssetFiles();
    if (files.length === 0) {
        throw new Error(`No ONNX or voice style assets found in ${MODEL_ID}`);
    }

    await mkdir(assetsDir, { recursive: true });

    for (const file of files) {
        await downloadFile(file);
    }

    console.log(`assets ready: ${assetsDir} (${ASSET_REVISION})`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
