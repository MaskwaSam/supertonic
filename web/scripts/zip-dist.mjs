import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, utimes } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const distDir = path.join(webDir, 'dist');
const outputPath = path.resolve(webDir, process.argv[2] || '../../supertonic-reader-dist.zip');
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH || '946684800';
if (!/^\d+$/.test(sourceDateEpoch)) {
    throw new Error('SOURCE_DATE_EPOCH must be a whole number of Unix seconds.');
}
const ZIP_EPOCH = new Date(Number(sourceDateEpoch) * 1000);
if (Number.isNaN(ZIP_EPOCH.getTime()) || ZIP_EPOCH.getUTCFullYear() < 1980 ||
        ZIP_EPOCH.getUTCFullYear() > 2107) {
    throw new Error('SOURCE_DATE_EPOCH must fit the ZIP timestamp range (1980 through 2107).');
}

async function syncDirectory(directory) {
    const handle = await open(directory, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            ...options,
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`${command} exited with code ${code}`));
        });
    });
}

async function collectEntries(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    const paths = [];
    for (const entry of entries) {
        const relativePath = path.posix.join(prefix, entry.name);
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            paths.push(...await collectEntries(fullPath, relativePath));
        } else if (entry.isFile()) {
            paths.push(relativePath);
        }
    }
    return paths.sort();
}

const entries = await collectEntries(distDir);
if (entries.length === 0) {
    throw new Error('Cannot create an archive from an empty dist directory.');
}

for (const relativePath of entries) {
    await utimes(path.join(distDir, relativePath), ZIP_EPOCH, ZIP_EPOCH);
}

await mkdir(path.dirname(outputPath), { recursive: true });
const temporaryOutputPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}-${randomUUID()}.tmp.zip`
);
try {
    await run('zip', [
        '-qX',
        temporaryOutputPath,
        ...entries,
    ], {
        cwd: distDir,
        env: { ...process.env, TZ: 'UTC' },
    });
    await run('unzip', ['-tq', temporaryOutputPath]);
    const handle = await open(temporaryOutputPath, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temporaryOutputPath, outputPath);
    await syncDirectory(path.dirname(outputPath));
} finally {
    await rm(temporaryOutputPath, { force: true });
}
console.log(`PASS wrote ${outputPath}`);
