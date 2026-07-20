import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const distDir = path.join(webDir, 'dist');

const requiredRuntimeFiles = [
    'onnx-runtime/ort-wasm-simd-threaded.mjs',
    'onnx-runtime/ort-wasm-simd-threaded.wasm',
    'onnx-runtime/ort-wasm-simd-threaded.jsep.mjs',
    'onnx-runtime/ort-wasm-simd-threaded.jsep.wasm',
];

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
    'M5.json',
].map((file) => `assets/voice_styles/${file}`);

const requiredOnnxFiles = [
    'assets/onnx/tts.json',
    'assets/onnx/unicode_indexer.json',
    'assets/onnx/duration_predictor.onnx',
    'assets/onnx/text_encoder.onnx',
    'assets/onnx/vector_estimator.onnx',
    'assets/onnx/vocoder.onnx',
];

function argValue(name) {
    const prefix = `${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
}

function hasFlag(name) {
    return process.argv.includes(name);
}

async function collectFiles(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const relativePath = path.posix.join(prefix, entry.name);
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(fullPath, relativePath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        }
    }

    return files.sort();
}

async function assertNonEmptyFile(relativePath) {
    const filePath = path.join(distDir, relativePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size === 0) {
        throw new Error(`Expected non-empty dist file: ${relativePath}`);
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertNoForbiddenFiles(files) {
    const forbidden = files.filter((file) => (
        file.includes('__MACOSX/') ||
        file.endsWith('/.DS_Store') ||
        file === '.DS_Store' ||
        file.includes('/node_modules/') ||
        file.includes('/vendor/') ||
        /^assets\/ort-wasm.*\.wasm$/.test(file) ||
        / \d+(?=\.[^.]+$)/.test(path.basename(file)) ||
        file.startsWith('/') ||
        file.includes('..') ||
        file.includes('\\') ||
        file.toLowerCase().includes('kokoro')
    ));

    assert(forbidden.length === 0, `Forbidden files in dist:\n${forbidden.join('\n')}`);
}

async function assertCommon(files) {
    assertNoForbiddenFiles(files);
    for (const file of ['index.html', 'voices.html', 'sw.js', 'app-shell-manifest.json', 'README.txt', ...requiredRuntimeFiles, ...requiredVoiceStyles]) {
        assert(files.includes(file), `Missing dist file: ${file}`);
        await assertNonEmptyFile(file);
    }

    assert(files.some((file) => /^assets\/index-[^/]+\.js$/.test(file)), 'Missing built app JavaScript asset.');
    assert(files.some((file) => /^assets\/index-[^/]+\.css$/.test(file)), 'Missing built app CSS asset.');
    assert(files.some((file) => /^assets\/voices-[^/]+\.js$/.test(file)), 'Missing built voice examples JavaScript asset.');
    assert(files.some((file) => /^assets\/voices-[^/]+\.css$/.test(file)), 'Missing built voice examples CSS asset.');

    const indexHtml = await readFile(path.join(distDir, 'index.html'), 'utf8');
    assert(!/\s(?:src|href)="\//.test(indexHtml), 'index.html contains root-absolute asset URLs.');
    assert(indexHtml.includes('./assets/') || indexHtml.includes('assets/'), 'index.html does not reference built assets.');
    assert(indexHtml.includes('voices.html'), 'index.html does not link to the voice examples page.');

    const voicesHtml = await readFile(path.join(distDir, 'voices.html'), 'utf8');
    assert(!/\s(?:src|href)="\//.test(voicesHtml), 'voices.html contains root-absolute asset URLs.');
    assert(voicesHtml.includes('./assets/') || voicesHtml.includes('assets/'), 'voices.html does not reference built assets.');
    assert(voicesHtml.includes('index.html'), 'voices.html does not link back to the reader.');

    const manifest = JSON.parse(await readFile(path.join(distDir, 'app-shell-manifest.json'), 'utf8'));
    assert(Array.isArray(manifest.files), 'app-shell-manifest.json must include a files array.');
    assert(manifest.files.includes('./voices.html'), 'app-shell-manifest.json does not include voices.html.');
    for (const entry of manifest.files) {
        const normalized = String(entry).replace(/^\.\//, '');
        if (!normalized || normalized === '.' || normalized === 'index.html') {
            continue;
        }
        assert(files.includes(normalized), `Service-worker manifest references missing file: ${entry}`);
    }
}

async function assertCdn(files) {
    const onnxFiles = files.filter((file) => file.endsWith('.onnx') || file.startsWith('assets/onnx/'));
    assert(onnxFiles.length === 0, `CDN dist must not contain local ONNX model files:\n${onnxFiles.join('\n')}`);

    const readme = await readFile(path.join(distDir, 'README.txt'), 'utf8');
    assert(readme.includes('Supertonic Reader CDN Bundle'), 'CDN README marker is missing.');
    assert(readme.includes('724fb5abbf5502583fb520898d45929e62f02c0b'), 'CDN README does not mention the pinned asset revision.');
}

async function assertStatic(files) {
    for (const file of requiredOnnxFiles) {
        assert(files.includes(file), `Missing self-contained model file: ${file}`);
        await assertNonEmptyFile(file);
    }

    const readme = await readFile(path.join(distDir, 'README.txt'), 'utf8');
    assert(readme.includes('Static Bundle'), 'Static README marker is missing.');
    assert(readme.includes('self-contained bundle loads Supertonic models from the bundled `assets/` folder'), 'Static README must describe bundled local model loading.');

    const jsFiles = files.filter((file) => /^assets\/[^/]+\.js$/.test(file));
    const jsText = (await Promise.all(jsFiles.map((file) => readFile(path.join(distDir, file), 'utf8')))).join('\n');
    assert(!jsText.includes('huggingface.co/Supertone/supertonic-3'), 'Static build still embeds the Hugging Face model URL.');
}

async function main() {
    const mode = argValue('--mode') || (hasFlag('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'auto');
    const files = await collectFiles(distDir);
    await assertCommon(files);

    const resolvedMode = mode === 'auto'
        ? (files.some((file) => file.startsWith('assets/onnx/')) ? 'static' : 'cdn')
        : mode;

    if (resolvedMode === 'cdn') {
        await assertCdn(files);
    } else if (resolvedMode === 'static') {
        await assertStatic(files);
    } else {
        throw new Error(`Unknown verify mode: ${mode}`);
    }

    console.log(`PASS ${resolvedMode} dist verification (${files.length} files)`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
