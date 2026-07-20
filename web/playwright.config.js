import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 15_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,
    forbidOnly: true,
    retries: 0,
    workers: 1,
    reporter: [['line']],
    outputDir: '/tmp/supertonic-reader-playwright-results',
    use: {
        baseURL: 'http://127.0.0.1:3000',
        trace: 'retain-on-failure',
        launchOptions: executablePath ? { executablePath } : undefined,
    },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: true,
        timeout: 30_000,
    },
});
