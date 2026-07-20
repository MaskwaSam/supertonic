import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CDN_ASSET_REVISION,
    LEGAL_FILES,
    ONNX_RUNTIME_FILES,
    REQUIRED_ONNX_FILES,
    REQUIRED_VOICE_STYLE_FILES,
} from './package-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(webDir, '..');
const sourceAssetsDir = path.join(repoDir, 'assets');
const onnxRuntimeDistDir = path.join(webDir, 'node_modules/onnxruntime-web/dist');
const distDir = path.join(webDir, 'dist');

const requiredRuntimeFiles = ONNX_RUNTIME_FILES.map(({ destination }) => `onnx-runtime/${destination}`);

const requiredVoiceStyles = REQUIRED_VOICE_STYLE_FILES.map((file) => `assets/voice_styles/${file}`);

const requiredOnnxFiles = REQUIRED_ONNX_FILES.map((file) => `assets/onnx/${file}`);
const requiredLegalFiles = LEGAL_FILES.map(({ destination }) => destination);

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

async function sha256(filePath) {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function assertSameFile(sourcePath, destinationRelativePath) {
    const destinationPath = path.join(distDir, destinationRelativePath);
    const [sourceHash, destinationHash] = await Promise.all([
        sha256(sourcePath),
        sha256(destinationPath),
    ]);
    assert(sourceHash === destinationHash, `Packaged file differs from its allowlisted source: ${destinationRelativePath}`);
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
    for (const file of [
        'index.html',
        'voices.html',
        'sw.js',
        'app-shell-manifest.json',
        'assets-integrity.json',
        'README.txt',
        'RELEASE-MANIFEST.json',
        ...requiredLegalFiles,
        ...requiredRuntimeFiles,
        ...requiredVoiceStyles,
    ]) {
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

    for (const voiceStyle of REQUIRED_VOICE_STYLE_FILES) {
        await assertSameFile(
            path.join(sourceAssetsDir, 'voice_styles', voiceStyle),
            `assets/voice_styles/${voiceStyle}`
        );
    }
    for (const { source, destination } of ONNX_RUNTIME_FILES) {
        await assertSameFile(
            path.join(onnxRuntimeDistDir, source),
            `onnx-runtime/${destination}`
        );
    }
    for (const { source, destination } of LEGAL_FILES) {
        await assertSameFile(path.resolve(webDir, source), destination);
    }
    await assertSameFile(
        path.join(webDir, 'assets-integrity.json'),
        'assets-integrity.json'
    );

    return manifest;
}

async function assertCdn(files) {
    const onnxFiles = files.filter((file) => file.endsWith('.onnx') || file.startsWith('assets/onnx/'));
    assert(onnxFiles.length === 0, `CDN dist must not contain local ONNX model files:\n${onnxFiles.join('\n')}`);

    const readme = await readFile(path.join(distDir, 'README.txt'), 'utf8');
    assert(readme.includes('Supertonic Reader CDN Bundle'), 'CDN README marker is missing.');
    assert(readme.includes(CDN_ASSET_REVISION), 'CDN README does not mention the pinned asset revision.');
}

async function assertStatic(files) {
    for (const file of requiredOnnxFiles) {
        assert(files.includes(file), `Missing self-contained model file: ${file}`);
        await assertNonEmptyFile(file);
    }
    for (const onnxFile of REQUIRED_ONNX_FILES) {
        await assertSameFile(
            path.join(sourceAssetsDir, 'onnx', onnxFile),
            `assets/onnx/${onnxFile}`
        );
    }

    const readme = await readFile(path.join(distDir, 'README.txt'), 'utf8');
    assert(readme.includes('Static Bundle'), 'Static README marker is missing.');
    assert(readme.includes('self-contained bundle loads Supertonic models from the bundled `assets/` folder'), 'Static README must describe bundled local model loading.');

    const jsFiles = files.filter((file) => /^assets\/[^/]+\.js$/.test(file));
    const jsText = (await Promise.all(jsFiles.map((file) => readFile(path.join(distDir, file), 'utf8')))).join('\n');
    assert(!jsText.includes('huggingface.co/Supertone/supertonic-3'), 'Static build still embeds the Hugging Face model URL.');
}

async function assertReleaseManifest(files, resolvedMode) {
    const releaseManifest = JSON.parse(await readFile(path.join(distDir, 'RELEASE-MANIFEST.json'), 'utf8'));
    assert(releaseManifest.schemaVersion === 1, 'Release manifest schema version must be 1.');
    assert(releaseManifest.mode === resolvedMode, `Release manifest mode must be ${resolvedMode}.`);
    assert(releaseManifest.model?.revision === CDN_ASSET_REVISION, 'Release manifest model revision is not pinned correctly.');
    assert(/^[0-9a-f]{40}$/.test(releaseManifest.sourceCommit), 'Release manifest must contain a full source commit.');
    assert(/^[0-9a-f]{64}$/.test(releaseManifest.packageLockSha256), 'Release manifest must hash package-lock.json.');
    assert(Array.isArray(releaseManifest.files), 'Release manifest files must be an array.');

    const actualFiles = files.filter((file) => file !== 'RELEASE-MANIFEST.json').sort();
    const manifestPaths = releaseManifest.files.map((entry) => entry.path).sort();
    assert(new Set(manifestPaths).size === manifestPaths.length, 'Release manifest contains duplicate file paths.');
    assert(
        JSON.stringify(manifestPaths) === JSON.stringify(actualFiles),
        'Release manifest file list does not exactly match dist.'
    );

    for (const entry of releaseManifest.files) {
        assert(/^[0-9a-f]{64}$/.test(entry.sha256), `Invalid SHA-256 for ${entry.path}.`);
        const filePath = path.join(distDir, entry.path);
        const fileStat = await stat(filePath);
        assert(entry.bytes === fileStat.size, `Release manifest byte count differs for ${entry.path}.`);
        assert(entry.sha256 === await sha256(filePath), `Release manifest hash differs for ${entry.path}.`);
    }
}

function assertExactAllowlist(files, appShellManifest, resolvedMode) {
    const expected = new Set([
        'index.html',
        'voices.html',
        'sw.js',
        'app-shell-manifest.json',
        'assets-integrity.json',
        'README.txt',
        'RELEASE-MANIFEST.json',
        ...requiredLegalFiles,
        ...requiredRuntimeFiles,
        ...requiredVoiceStyles,
        ...(resolvedMode === 'static' ? requiredOnnxFiles : []),
    ]);

    for (const entry of appShellManifest.files) {
        const normalized = String(entry).replace(/^\.\//, '');
        if (normalized && normalized !== '.') {
            expected.add(normalized);
        }
    }

    const unexpected = files.filter((file) => !expected.has(file));
    const missing = [...expected].filter((file) => !files.includes(file));
    assert(unexpected.length === 0, `Unexpected files in dist (release allowlist violation):\n${unexpected.join('\n')}`);
    assert(missing.length === 0, `Allowlisted files missing from dist:\n${missing.join('\n')}`);
}

async function main() {
    const mode = argValue('--mode') || (hasFlag('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'auto');
    const files = await collectFiles(distDir);
    const appShellManifest = await assertCommon(files);

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


    assertExactAllowlist(files, appShellManifest, resolvedMode);
    await assertReleaseManifest(files, resolvedMode);

    console.log(`PASS ${resolvedMode} dist verification (${files.length} files)`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
