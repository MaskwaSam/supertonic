import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDN_BASE_URL = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');

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
    const files = await collectFiles(distDir);
    const readme = [
        "# Mr.Patterson's Reader CDN Bundle",
        '',
        'Upload this folder to any static web server and open `index.html` over HTTP or HTTPS.',
        '',
        `This CDN bundle loads Supertonic ONNX model files and voice styles from ${CDN_BASE_URL}.`,
        '',
        'The server that hosts this folder must allow normal static file serving for HTML, JS, CSS, and WASM files.',
        '',
        'Bundled files:',
        ...files.map((file) => `- ${file}`)
    ].join('\n');

    await writeFile(path.join(distDir, 'README.txt'), `${readme}\n`, 'utf8');
    console.log(`CDN README written into ${distDir}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
