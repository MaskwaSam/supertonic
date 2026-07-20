import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { CDN_ASSET_REVISION } from './package-config.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(webDir, '..');
const distDir = path.join(webDir, 'dist');
const manifestPath = path.join(distDir, 'RELEASE-MANIFEST.json');
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : '';

if (!['cdn', 'static'].includes(mode)) {
    throw new Error('write-release-manifest requires --mode cdn or --mode static.');
}

async function collectFiles(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const relativePath = path.posix.join(prefix, entry.name);
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectFiles(fullPath, relativePath));
        } else if (entry.isFile() && relativePath !== 'RELEASE-MANIFEST.json') {
            files.push(relativePath);
        }
    }
    return files.sort();
}

async function sha256(filePath) {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function gitOutput(args, fallback = 'unknown') {
    try {
        const { stdout } = await execFileAsync('git', ['-C', repoDir, ...args], {
            timeout: 3000,
            killSignal: 'SIGTERM',
        });
        return stdout.trim() || fallback;
    } catch {
        return fallback;
    }
}

function sourceCommitOverride() {
    const value = String(process.env.SUPERTONIC_SOURCE_COMMIT || '').trim().toLowerCase();
    if (!value) {
        return '';
    }
    if (!/^[a-f0-9]{40}$/.test(value)) {
        throw new Error('SUPERTONIC_SOURCE_COMMIT must be a full 40-character Git commit.');
    }
    return value;
}

const packageJson = JSON.parse(await readFile(path.join(webDir, 'package.json'), 'utf8'));
const files = await collectFiles(distDir);
const entries = [];
for (const relativePath of files) {
    const filePath = path.join(distDir, relativePath);
    const fileStat = await stat(filePath);
    entries.push({
        path: relativePath,
        bytes: fileStat.size,
        sha256: await sha256(filePath),
    });
}

const manifest = {
    schemaVersion: 1,
    product: 'Supertonic Reader',
    version: packageJson.version,
    mode,
    sourceCommit: sourceCommitOverride() || await gitOutput(['rev-parse', 'HEAD']),
    packageLockSha256: await sha256(path.join(webDir, 'package-lock.json')),
    model: {
        name: 'Supertone/supertonic-3',
        revision: CDN_ASSET_REVISION,
        delivery: mode === 'static' ? 'bundled' : 'cdn',
    },
    files: entries,
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`release manifest written for ${mode} (${entries.length} hashed files)`);
