import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(webDir, '..');
const sourceAssetsDir = path.join(repoDir, 'assets');
const distDir = path.join(webDir, 'dist');
const distAssetsDir = path.join(distDir, 'assets');

const requiredAssets = [
    'onnx/tts.json',
    'onnx/unicode_indexer.json',
    'onnx/duration_predictor.onnx',
    'onnx/text_encoder.onnx',
    'onnx/vector_estimator.onnx',
    'onnx/vocoder.onnx',
    'voice_styles/M1.json'
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

    const files = await collectFiles(distDir);
    const readme = [
        "# Mr.Patterson's Reader Static Bundle",
        '',
        'Upload this folder to any static web server and open `index.html` over HTTP or HTTPS.',
        '',
        'This bundle tries the Hugging Face CDN first, then falls back to the bundled `assets/` model folder if the CDN cannot be reached.',
        '',
        'Use the `Use Bundled Model` button if the CDN is slow but still technically reachable.',
        '',
        'Double-click a reader chunk to start playback there. Already-generated chunks reuse cached audio instead of regenerating.',
        '',
        'The service worker caches only the app shell/runtime files. It does not cache the large Supertonic model files by default.',
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
