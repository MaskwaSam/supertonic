import { expect, test } from '@playwright/test';

test('reader defers all model requests until an explicit play action', async ({ page }) => {
    const modelRequests = [];
    page.on('request', (request) => {
        if (request.url().includes('/onnx/')) {
            modelRequests.push(request.url());
        }
    });

    await page.goto('/');
    await expect(page.locator('#modelSourceBadge')).toHaveText('Model: not loaded');
    await expect(page.locator('#statusText')).toContainText('380 MiB');
    await expect(page.locator('#generatePlayBtn')).toBeEnabled();
    await page.waitForTimeout(250);
    expect(modelRequests).toEqual([]);

    await page.route('**/onnx/**', (route) => route.abort('failed'));
    await page.locator('#generatePlayBtn').click();
    await expect.poll(() => modelRequests.length).toBeGreaterThan(0);
    await expect(page.locator('#statusPhase')).toHaveText(/Loading|Error/);
});

test('reader chunks are real single-action buttons and custom voices are strictly validated', async ({ page }) => {
    await page.goto('/');
    const chunks = page.locator('#reader button.reader-chunk');
    await expect(chunks.first()).toBeVisible();
    await expect(chunks.first()).toHaveAttribute('aria-label', /Play from chunk 1/);

    await page.locator('#customVoiceInput').setInputFiles({
        name: 'bad-voice.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
            style_ttl: { type: 'float32', dims: [1, 1, 1], data: [[[0]]] },
            style_dp: { type: 'float32', dims: [1, 8, 16], data: [] },
        })),
    });
    await expect(page.locator('#error')).toContainText('style_ttl.dims must be');
    await expect(page.locator('#modelSourceBadge')).toHaveText('Model: not loaded');
});

test('save-data mode is disclosed without starting a background download', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', {
            configurable: true,
            value: { saveData: true },
        });
    });
    const page = await context.newPage();
    const modelRequests = [];
    page.on('request', (request) => {
        if (request.url().includes('/onnx/')) modelRequests.push(request.url());
    });
    await page.goto('/');
    await expect(page.locator('#statusText')).toContainText('Data Saver is on');
    expect(modelRequests).toEqual([]);
    await context.close();
});

test('Play all exposes a working stop control while generation is still loading', async ({ page }) => {
    await page.route('**/onnx/**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.abort('failed');
    });
    await page.goto('/voices.html');
    await page.locator('#playAllButton').click();
    await expect(page.locator('#stopButton')).toBeEnabled();
    await page.locator('#stopButton').click();
    await expect(page.locator('#voiceStatusText')).toHaveText('Stopped.');
    await page.waitForTimeout(1_200);
    await expect(page.locator('#voiceStatusText')).toHaveText('Stopped.');
});
