import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

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

const requiredAssets = [
    'onnx/tts.json',
    'onnx/unicode_indexer.json',
    'onnx/duration_predictor.onnx',
    'onnx/text_encoder.onnx',
    'onnx/vector_estimator.onnx',
    'onnx/vocoder.onnx',
    ...requiredVoiceStyles.map((voiceStyle) => `voice_styles/${voiceStyle}`),
];

async function assertFile(relativePath) {
    const filePath = path.join(sourceAssetsDir, relativePath);
    try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile() || fileStat.size === 0) {
            throw new Error();
        }
    } catch {
        throw new Error(`Missing required asset: ${path.relative(repoDir, filePath)}. Run npm run assets:download first.`);
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

async function copyOnnxRuntime(sourceDir, destinationDir, label) {
    await mkdir(destinationDir, { recursive: true });
    const onnxRuntimeFiles = [
        'ort-wasm-simd-threaded.mjs',
        'ort-wasm-simd-threaded.wasm',
        'ort-wasm-simd-threaded.jsep.mjs',
        'ort-wasm-simd-threaded.jsep.wasm'
    ];

    for (const onnxRuntimeFile of onnxRuntimeFiles) {
        const onnxRuntimeFilePath = path.join(sourceDir, onnxRuntimeFile);
        const onnxRuntimeFileStat = await stat(onnxRuntimeFilePath);
        if (!onnxRuntimeFileStat.isFile() || onnxRuntimeFileStat.size === 0) {
            throw new Error(`Missing ${label} ONNX Runtime file: ${onnxRuntimeFilePath}`);
        }
        await copyFileByStream(
            onnxRuntimeFilePath,
            path.join(destinationDir, onnxRuntimeFile)
        );
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

function assertSupertonicOnly(files) {
    const disallowedFiles = files.filter((file) => file.toLowerCase().includes('kokoro'));
    if (disallowedFiles.length > 0) {
        throw new Error(`Static bundle contains removed secondary TTS artifacts:\n${disallowedFiles.join('\n')}`);
    }
}

async function main() {
    for (const asset of requiredAssets) {
        await assertFile(asset);
    }

    await mkdir(distAssetsDir, { recursive: true });
    await cp(path.join(sourceAssetsDir, 'onnx'), path.join(distAssetsDir, 'onnx'), {
        recursive: true,
        force: true
    });
    await cp(path.join(sourceAssetsDir, 'voice_styles'), path.join(distAssetsDir, 'voice_styles'), {
        recursive: true,
        force: true
    });
    await copyOnnxRuntime(supertonicOnnxRuntimeDistDir, distSupertonicRuntimeDir, 'Supertonic');
    await removeFinderConflictCopies(distDir);
    await removeUnusedViteRuntimeWasmCopies();

    const files = await collectFiles(distDir);
    assertSupertonicOnly(files);
    const readme = [
        "# Mr.Patterson's Reader Static Bundle",
        '',
        'Upload this folder to any static web server and open `index.html` over HTTP or HTTPS.',
        'Open `voices.html` from the same folder to hear all 10 bundled voice examples.',
        '',
        'This self-contained bundle loads Supertonic models from the bundled `assets/` folder. It does not require the Hugging Face CDN after upload.',
        '',
        'Double-click a reader chunk to start playback there. Already-generated chunks reuse cached audio instead of regenerating.',
        '',
        'Use the fixed mobile controls at the bottom of the screen for play, pause, stop, and WAV download while reading on a phone or tablet.',
        '',
        'After generation finishes, use `Download WAV` to export one audio file for offline listening.',
        '',
        'Open the top-right settings gear to enable approximate word highlighting.',
        '',
        'To use your own voice, create and download a Supertonic-compatible voice-style JSON from Supertonic Voice Builder, then open the top-right voice settings gear and load it with the `Custom voice JSON` picker.',
        '',
        'The service worker caches only the app shell. It does not cache the large bundled Supertonic model files by default.',
        '',
        'Do not open `index.html` directly with `file://`; browser security rules can block ONNX, WASM, and model asset loading.',
        '',
        'Bundled files:',
        ...files.map((file) => `- ${file}`)
    ].join('\n');

    await writeFile(path.join(distDir, 'README.txt'), `${readme}\n`, 'utf8');
    console.log(`static assets copied into ${distDir}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
