import { mkdir, readdir, rm, utimes } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const distDir = path.join(webDir, 'dist');
const outputPath = path.resolve(webDir, process.argv[2] || '../../supertonic-reader-dist.zip');
const ZIP_EPOCH = new Date('1980-01-01T00:00:00.000Z');

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
await rm(outputPath, { force: true });
await run('zip', [
    '-qX',
    outputPath,
    ...entries,
], {
    cwd: distDir,
    env: { ...process.env, TZ: 'UTC' },
});
await run('unzip', ['-tq', outputPath]);
console.log(`PASS wrote ${outputPath}`);
