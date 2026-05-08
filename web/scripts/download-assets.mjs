import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'Supertone/supertonic-3';
const API_URL = `https://huggingface.co/api/models/${MODEL_ID}`;
const RESOLVE_BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../assets');
const force = process.argv.includes('--force');

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
    return metadata.siblings
        .map((sibling) => sibling.rfilename)
        .filter((filename) => filename.startsWith('onnx/') || filename.startsWith('voice_styles/'));
}

async function downloadFile(filename) {
    const targetPath = path.join(assetsDir, filename);
    const targetDir = path.dirname(targetPath);

    if (!force && await exists(targetPath)) {
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
