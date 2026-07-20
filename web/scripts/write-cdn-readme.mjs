import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const CDN_ASSET_REVISION = process.env.SUPERTONIC_ASSET_REVISION || '724fb5abbf5502583fb520898d45929e62f02c0b';
const CDN_BASE_URL = `https://huggingface.co/Supertone/supertonic-3/resolve/${CDN_ASSET_REVISION}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(webDir, '..');
const sourceAssetsDir = path.join(repoDir, 'assets');
const nodeModulesDir = path.join(webDir, 'node_modules');
const supertonicOnnxRuntimeDistDir = path.join(nodeModulesDir, 'onnxruntime-web/dist');
const distDir = path.join(webDir, 'dist');
const distAssetsDir = path.join(distDir, 'assets');
const distSupertonicRuntimeDir = path.join(distDir, 'onnx-runtime');
const requiredVoiceStyles = [
    'F1.json',
    'F2.json',
    'F3.json',
    'F4.json',
    'F5.json',
    'M1.json',
    'M2.json',
    'M3.json',
    'M4.json',
    'M5.json'
];
const onnxRuntimeFiles = [
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.jsep.wasm'
];

async function assertFile(filePath, label) {
    try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile() || fileStat.size === 0) {
            throw new Error();
        }
    } catch {
        throw new Error(`Missing required ${label}: ${filePath}`);
    }
}

async function collectFiles(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const relativePath = path.join(prefix, entry.name);
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(fullPath, relativePath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        }
    }

    return files.sort();
}

async function copyFileByStream(sourcePath, destinationPath) {
    await pipeline(
        createReadStream(sourcePath),
        createWriteStream(destinationPath)
    );
}

async function copyOnnxRuntime() {
    await mkdir(distSupertonicRuntimeDir, { recursive: true });

    for (const runtimeFile of onnxRuntimeFiles) {
        const runtimeFilePath = path.join(supertonicOnnxRuntimeDistDir, runtimeFile);
        await assertFile(runtimeFilePath, `ONNX Runtime file ${runtimeFile}`);
        await copyFileByStream(runtimeFilePath, path.join(distSupertonicRuntimeDir, runtimeFile));
    }
}

async function copyVoiceStyles() {
    const sourceVoiceStylesDir = path.join(sourceAssetsDir, 'voice_styles');
    const distVoiceStylesDir = path.join(distAssetsDir, 'voice_styles');

    for (const voiceStyle of requiredVoiceStyles) {
        await assertFile(path.join(sourceVoiceStylesDir, voiceStyle), `Supertonic voice style ${voiceStyle}`);
    }

    await mkdir(distAssetsDir, { recursive: true });
    await cp(sourceVoiceStylesDir, distVoiceStylesDir, {
        recursive: true,
        force: true
    });
}

async function removeUnusedViteRuntimeWasmCopies() {
    let entries = [];
    try {
        entries = await readdir(distAssetsDir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.isFile() && /^ort-wasm.*\.wasm$/.test(entry.name)) {
            await unlink(path.join(distAssetsDir, entry.name));
        }
    }
}

async function removeFinderConflictCopies(dir) {
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await removeFinderConflictCopies(fullPath);
            return;
        }

        if (entry.isFile() && / \d+(?=\.[^.]+$)/.test(entry.name)) {
            await unlink(fullPath);
        }
    }));
}

function assertSupertonicOnly(files) {
    const disallowedFiles = files.filter((file) => (
        file.endsWith('.onnx') ||
        file.startsWith('assets/onnx/') ||
        file.toLowerCase().includes('kokoro')
    ));

    if (disallowedFiles.length > 0) {
        throw new Error(`CDN bundle contains non-CDN model artifacts:\n${disallowedFiles.join('\n')}`);
    }
}

async function main() {
    await copyOnnxRuntime();
    await copyVoiceStyles();
    await removeFinderConflictCopies(distDir);
    await removeUnusedViteRuntimeWasmCopies();

    const files = await collectFiles(distDir);
    assertSupertonicOnly(files);
    const readme = [
        '# Supertonic Reader CDN Bundle',
        '',
        'Upload this folder to any static web server and open `index.html` over HTTP or HTTPS.',
        'Open `voices.html` from the same folder to hear all 10 bundled voice examples.',
        '',
        `This CDN bundle loads Supertonic ONNX model files from ${CDN_BASE_URL}.`,
        `Pinned asset revision: ${CDN_ASSET_REVISION}.`,
        '',
        'It includes the Supertonic app, the voice examples page, ONNX Runtime Web files, and all 10 bundled Supertonic voice styles: F1-F5 and M1-M5.',
        '',
        'It intentionally does not include Supertonic ONNX model files or any secondary TTS model.',
        '',
        'Double-click a reader chunk to start playback there. Already-generated chunks reuse cached audio instead of regenerating.',
        '',
        'Use the fixed mobile controls at the bottom of the screen for play, pause, stop, and WAV download while reading on a phone or tablet.',
        '',
        'Open the top-right settings gear to enable approximate word highlighting.',
        '',
        'To use your own voice, create and download a Supertonic-compatible voice-style JSON from Supertonic Voice Builder, then open the top-right voice settings gear and load it with the `Custom voice JSON` picker.',
        '',
        'The service worker precaches the production app shell from app-shell-manifest.json. It does not cache Supertonic model files, voice styles, or runtime WASM files by default.',
        '',
        'The server that hosts this folder must allow normal static file serving for HTML, JS, CSS, and WASM files.',
        '',
        'Bundled files:',
        '- README.txt',
        ...files
            .filter((file) => file !== 'README.txt')
            .map((file) => `- ${file}`)
    ].join('\n');

    await writeFile(path.join(distDir, 'README.txt'), `${readme}\n`, 'utf8');
    console.log(`CDN README written into ${distDir}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
