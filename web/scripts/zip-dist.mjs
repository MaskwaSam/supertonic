import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const distDir = path.join(webDir, 'dist');
const outputPath = path.resolve(webDir, process.argv[2] || '../../supertonic-reader-dist.zip');

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

await rm(outputPath, { force: true });
await run('zip', [
    '-qry',
    outputPath,
    '.',
    '-x',
    '*.DS_Store',
    '__MACOSX/*',
    '*/__MACOSX/*',
], { cwd: distDir });
await run('unzip', ['-tq', outputPath]);
console.log(`PASS wrote ${outputPath}`);
