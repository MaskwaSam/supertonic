import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TEST_URL = process.env.SUPERTONIC_TEST_URL || 'http://127.0.0.1:4174/';
const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE || 'playwright';
const outputDir = path.resolve(process.env.SUPERTONIC_SCREENSHOT_DIR || 'test-results/responsive');

const viewports = [
    { name: 'phone-small', width: 360, height: 640 },
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1366, height: 900 },
];

const pages = [
    { name: 'reader', path: '', selector: '.app-shell' },
    { name: 'voices', path: 'voices.html', selector: '.voice-shell' },
];

function pageUrl(pagePath) {
    return new URL(pagePath, TEST_URL).href;
}

async function loadPlaywright() {
    try {
        if (PLAYWRIGHT_MODULE.startsWith('/') || PLAYWRIGHT_MODULE.startsWith('.')) {
            return await import(pathToFileURL(path.resolve(PLAYWRIGHT_MODULE)).href);
        }
        return await import(PLAYWRIGHT_MODULE);
    } catch (error) {
        throw new Error(`Could not load Playwright. Install it or set PLAYWRIGHT_MODULE to an installed Playwright entrypoint. ${error.message}`);
    }
}

function describeElement(element) {
    const rect = element.getBoundingClientRect();
    const id = element.id ? `#${element.id}` : '';
    const className = typeof element.className === 'string' && element.className
        ? `.${element.className.trim().replace(/\s+/g, '.')}`
        : '';
    return `${element.tagName.toLowerCase()}${id}${className} ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
}

async function collectLayoutReport(page, viewport) {
    return page.evaluate(({ viewportName }) => {
        const visibleElements = Array.from(document.body.querySelectorAll('*')).filter((element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                rect.width > 0 &&
                rect.height > 0;
        });

        const horizontallyOverflowing = visibleElements
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.left < -1 || rect.right > window.innerWidth + 1;
            })
            .slice(0, 10)
            .map((element) => {
                const rect = element.getBoundingClientRect();
                const id = element.id ? `#${element.id}` : '';
                const className = typeof element.className === 'string' && element.className
                    ? `.${element.className.trim().replace(/\s+/g, '.')}`
                    : '';
                return `${element.tagName.toLowerCase()}${id}${className} ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
            });

        const clippedControls = Array.from(document.querySelectorAll('button, select, input, textarea'))
            .filter((element) => {
                const style = window.getComputedStyle(element);
                return style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    element.scrollWidth > element.clientWidth + 1;
            })
            .map((element) => {
                const id = element.id ? `#${element.id}` : '';
                return `${element.tagName.toLowerCase()}${id}`;
            });

        const smallTapTargets = window.innerWidth <= 480
            ? Array.from(document.querySelectorAll('button'))
                .filter((element) => {
                    const style = window.getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        !element.closest('.badge-row') &&
                        rect.width > 0 &&
                        rect.height > 0 &&
                        (rect.width < 40 || rect.height < 40);
                })
                .map((element) => {
                    const id = element.id ? `#${element.id}` : '';
                    return `${element.tagName.toLowerCase()}${id}`;
                })
            : [];

        return {
            viewportName,
            innerWidth: window.innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 ||
                document.body.scrollWidth > window.innerWidth + 1,
            horizontallyOverflowing,
            clippedControls,
            smallTapTargets,
            settingsPanelOpen: !document.querySelector('#voiceSettingsPanel')?.hidden,
            stickyVisible: document.querySelector('.sticky-controls')?.classList.contains('visible') || false,
        };
    }, { viewportName: viewport.name });
}

function assertLayout(report) {
    const failures = [];
    if (report.hasHorizontalOverflow) {
        failures.push(`horizontal overflow: html=${report.scrollWidth}, body=${report.bodyScrollWidth}, viewport=${report.innerWidth}`);
    }
    if (report.horizontallyOverflowing.length) {
        failures.push(`overflowing elements: ${report.horizontallyOverflowing.join(' | ')}`);
    }
    if (report.clippedControls.length) {
        failures.push(`clipped controls: ${report.clippedControls.join(', ')}`);
    }
    if (report.smallTapTargets.length) {
        failures.push(`small mobile tap targets: ${report.smallTapTargets.join(', ')}`);
    }
    if (failures.length) {
        throw new Error(`${report.viewportName}: ${failures.join('; ')}`);
    }
}

async function main() {
    const playwright = await loadPlaywright();
    const { chromium } = playwright.default || playwright;
    await mkdir(outputDir, { recursive: true });

    const browser = await chromium.launch();
    const failures = [];
    const consoleErrors = [];

    try {
        for (const pageConfig of pages) {
            for (const viewport of viewports) {
                const page = await browser.newPage({ viewport });
                page.on('console', (message) => {
                    if (message.type() === 'error' && !/Failed to load resource|Could not load Supertonic assets|Supertonic model fetch diagnostics/i.test(message.text())) {
                        consoleErrors.push(`${pageConfig.name} ${viewport.name}: ${message.text()}`);
                    }
                });
                page.on('pageerror', (error) => {
                    consoleErrors.push(`${pageConfig.name} ${viewport.name}: ${error.message}`);
                });
                await page.route('**/*.onnx', (route) => route.abort());
                await page.goto(pageUrl(pageConfig.path), { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForSelector(pageConfig.selector, { timeout: 10000 });

                if (pageConfig.name === 'voices') {
                    await page.waitForSelector('.voice-card', { timeout: 10000 });
                    const voiceCardCount = await page.locator('.voice-card').count();
                    if (voiceCardCount !== 10) {
                        failures.push(`${pageConfig.name} ${viewport.name}: expected 10 voice cards, found ${voiceCardCount}`);
                    }
                }

                const closedReport = await collectLayoutReport(page, {
                    ...viewport,
                    name: `${pageConfig.name} ${viewport.name}`
                });
                try {
                    assertLayout(closedReport);
                } catch (error) {
                    failures.push(error.message);
                }

                if (pageConfig.name === 'reader') {
                    await page.click('#voiceSettingsButton');
                    const settingsReport = await collectLayoutReport(page, {
                        ...viewport,
                        name: `${pageConfig.name} ${viewport.name} settings`
                    });
                    try {
                        assertLayout(settingsReport);
                    } catch (error) {
                        failures.push(error.message);
                    }

                    await page.evaluate(() => {
                        document.querySelector('.sticky-controls')?.classList.add('visible');
                    });
                    const stickyReport = await collectLayoutReport(page, {
                        ...viewport,
                        name: `${pageConfig.name} ${viewport.name} sticky`
                    });
                    try {
                        assertLayout(stickyReport);
                    } catch (error) {
                        failures.push(error.message);
                    }
                }

                const screenshotPath = path.join(outputDir, `${pageConfig.name}-${viewport.name}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }

    if (consoleErrors.length) {
        failures.push(`browser errors: ${consoleErrors.join(' | ')}`);
    }
    if (failures.length) {
        throw new Error(failures.join('\n'));
    }

    console.log(`PASS responsive smoke for ${pages.length} pages across ${viewports.length} viewports at ${TEST_URL}`);
    console.log(`Screenshots: ${outputDir}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
