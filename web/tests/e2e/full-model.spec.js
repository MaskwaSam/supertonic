import { expect, test } from '@playwright/test';

const enabled = process.env.SUPERTONIC_FULL_MODEL_SMOKE === '1';
const targetUrl = process.env.SUPERTONIC_FULL_MODEL_URL || '/';
const timeoutMs = Number.parseInt(process.env.SUPERTONIC_FULL_MODEL_TIMEOUT_MS || '600000', 10);
const effectiveTimeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 600_000;

function wavPcmMetrics(wav) {
    let offset = 12;
    while (offset + 8 <= wav.length) {
        const chunkId = wav.subarray(offset, offset + 4).toString('ascii');
        const chunkSize = wav.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        const dataEnd = dataStart + chunkSize;
        if (dataEnd > wav.length) {
            throw new Error(`Invalid WAV ${chunkId} chunk length.`);
        }
        if (chunkId === 'data') {
            const sampleCount = Math.floor(chunkSize / 2);
            let peak = 0;
            let squareSum = 0;
            for (let index = 0; index < sampleCount; index += 1) {
                const sample = wav.readInt16LE(dataStart + (index * 2)) / 32768;
                peak = Math.max(peak, Math.abs(sample));
                squareSum += sample * sample;
            }
            return {
                sampleCount,
                peak,
                rms: sampleCount > 0 ? Math.sqrt(squareSum / sampleCount) : 0,
            };
        }
        offset = dataEnd + (chunkSize % 2);
    }
    throw new Error('WAV file does not contain a data chunk.');
}

test.describe('opt-in full model smoke', () => {
    test.skip(!enabled, 'Set SUPERTONIC_FULL_MODEL_SMOKE=1 to download the model and run real inference.');

    test('loads the real model, synthesizes speech, and downloads a valid WAV', async ({ page }) => {
        test.setTimeout(effectiveTimeoutMs);
        await page.addInitScript(() => {
            Object.defineProperty(globalThis.navigator, 'gpu', {
                configurable: true,
                value: undefined,
            });
        });

        const failedAssets = [];
        page.on('requestfailed', (request) => {
            if (/\/(?:onnx|voice_styles|onnx-runtime)\//.test(request.url())) {
                failedAssets.push(`${request.url()}: ${request.failure()?.errorText || 'request failed'}`);
            }
        });

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('#text').fill('Production smoke test for Supertonic speech synthesis.');
        await page.locator('#voiceStyleSelect').selectOption('assets/voice_styles/M1.json');
        await page.locator('#langSelect').selectOption('en');
        await page.locator('#totalStep').fill('2');
        await page.locator('#speed').fill('2');
        await page.locator('#generatePlayBtn').click();

        await expect(page.locator('#downloadBtn')).toBeEnabled({ timeout: effectiveTimeoutMs });
        await expect(page.locator('#modelSourceBadge')).toContainText('Supertonic');
        await expect(page.locator('#backendBadge')).toContainText('WebAssembly');
        expect(failedAssets, failedAssets.join('\n')).toEqual([]);

        const downloadPromise = page.waitForEvent('download');
        await page.locator('#downloadBtn').click();
        const download = await downloadPromise;
        const stream = await download.createReadStream();
        expect(stream).not.toBeNull();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const wav = Buffer.concat(chunks);
        expect(download.suggestedFilename()).toBe('supertonic-reader.wav');
        expect(wav.byteLength).toBeGreaterThan(1_000);
        expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
        const metrics = wavPcmMetrics(wav);
        expect(metrics.sampleCount).toBeGreaterThan(500);
        expect(metrics.peak).toBeGreaterThan(0.001);
        expect(metrics.rms).toBeGreaterThan(0.0001);
    });
});
