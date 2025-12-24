import { join } from 'path';
import puppeteer from 'puppeteer';
import { withRetries, withTimeout } from './runtime.js';

export async function screenshotPage({
    url,
    outputDir,
    fileName = 'liquidation.png',
    waitMs = 4000,
    viewport,
    fullPage = false,
}) {
    return withRetries(
        async () => {
            const browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });

            try {
                const page = await browser.newPage();
                await page.setViewport(viewport ?? { width: 1440, height: 900 });
                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                );
                page.setDefaultNavigationTimeout(60000);

                await withTimeout(page.goto(url, { waitUntil: 'networkidle2' }), 70000, `页面打开(${url})`);
                await page.waitForTimeout(waitMs);

                const outPath = join(outputDir, fileName);
                await withTimeout(page.screenshot({ path: outPath, fullPage }), 45000, `页面截图(${url})`);
                return outPath;
            } finally {
                await browser.close();
            }
        },
        { retries: 1, baseDelayMs: 1500 },
    );
}
