import { join } from 'path';
import { withRetries, withTimeout } from '../runtime/runtime.js';
import { launchPuppeteerBrowser } from '../../../../core/utils/puppeteerLaunch.js';

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

async function pickLargestCanvasClip(page, { padding = 32 } = {}) {
    const pad = Math.max(0, Number(padding) || 0);

    const clip = await page.evaluate((padPx) => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        if (!canvases.length) return null;

        const pick = canvases
            .map((el) => ({ el, rect: el.getBoundingClientRect() }))
            .filter((x) => x.rect && x.rect.width >= 200 && x.rect.height >= 200)
            .map((x) => ({ el: x.el, rect: x.rect, area: x.rect.width * x.rect.height }))
            .sort((a, b) => b.area - a.area)[0];

        if (!pick) return null;

        pick.el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = pick.el.getBoundingClientRect();

        const x = Math.max(0, r.left - padPx);
        const y = Math.max(0, r.top - padPx);
        const width = Math.max(1, r.width + padPx * 2);
        const height = Math.max(1, r.height + padPx * 2);

        return { x, y, width, height };
    }, pad);

    if (!clip) return null;

    const vp = page.viewport();
    if (!vp) return null;

    const x = clamp(Number(clip.x) || 0, 0, Math.max(0, vp.width - 1));
    const y = clamp(Number(clip.y) || 0, 0, Math.max(0, vp.height - 1));
    const width = clamp(Number(clip.width) || 1, 1, Math.max(1, vp.width - x));
    const height = clamp(Number(clip.height) || 1, 1, Math.max(1, vp.height - y));

    return { x, y, width, height };
}

export async function screenshotPage({
    url,
    outputDir,
    fileName = 'liquidation.png',
    waitMs = 4000,
    viewport,
    fullPage = false,
    deviceScaleFactor = 2,
    preferChartClip = true,
    clipPadding = 32,
}) {
    return withRetries(
        async () => {
            const browser = await launchPuppeteerBrowser({ purpose: 'trade-roundtable.screenshot' });

            try {
                const page = await browser.newPage();
                await page.setViewport(
                    viewport ?? {
                        width: 2560,
                        height: 1440,
                        deviceScaleFactor: Math.max(1, Number(deviceScaleFactor) || 2),
                    },
                );
                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                );
                page.setDefaultNavigationTimeout(60000);

                await withTimeout(page.goto(url, { waitUntil: 'networkidle2' }), 70000, `页面打开(${url})`);
                await new Promise((resolve) => setTimeout(resolve, waitMs));

                const outPath = join(outputDir, fileName);

                const clip = preferChartClip ? await pickLargestCanvasClip(page, { padding: clipPadding }) : null;
                const screenshotOptions = clip ? { path: outPath, clip } : { path: outPath, fullPage };

                await withTimeout(page.screenshot(screenshotOptions), 45000, `页面截图(${url})`);
                return outPath;
            } finally {
                await browser.close();
            }
        },
        { retries: 1, baseDelayMs: 1500 },
    );
}
