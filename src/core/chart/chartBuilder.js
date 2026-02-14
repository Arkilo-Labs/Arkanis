/**
 * 图表构建器
 * 使用 Puppeteer + lightweight-charts 渲染 K 线图
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';

import { chartConfig } from '../config/index.js';
import { launchPuppeteerBrowser } from '../utils/puppeteerLaunch.js';
import { CoordMapper } from './coordMapper.js';
import { AnchorMode, OverlayType, ValueAnchor } from './models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 图表构建器
 */
export class ChartBuilder {
    /**
     * @param {Object} options
     * @param {number} [options.width] 图表宽度
     * @param {number} [options.height] 图表高度
     * @param {number} [options.volumePaneHeight] 成交量面板高度占比
     * @param {number} [options.macdPaneHeight] MACD 面板高度占比
     * @param {number} [options.trendStrengthPaneHeight] 趋势强度(ADX)面板高度占比
     */
    constructor({ width = null, height = null, volumePaneHeight = null, macdPaneHeight = null, trendStrengthPaneHeight = null } = {}) {
        this.width = width || chartConfig.width;
        this.height = height || chartConfig.height;
        this.volumePaneHeight = volumePaneHeight || chartConfig.volumePaneHeight;
        this.macdPaneHeight = macdPaneHeight || chartConfig.macdPaneHeight;
        this.trendStrengthPaneHeight = trendStrengthPaneHeight || chartConfig.trendStrengthPaneHeight;
        this._coordMapper = null;
        this._browser = null;
        this._page = null;
        this._textAnnotations = [];
    }

    /**
     * 主图高度占比（剩余用于成交量/MACD/ADX）
     * @private
     */
    _getMainPaneHeightRatio() {
        const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
        const volume = clamp01(this.volumePaneHeight);
        const macd = clamp01(this.macdPaneHeight);
        const strength = clamp01(this.trendStrengthPaneHeight);
        const sum = volume + macd + strength;
        return Math.max(0.35, 1 - Math.min(0.65, sum));
    }

    /**
     * 获取模板 HTML
     * @private
     */
    _getTemplate() {
        const templatePath = join(__dirname, 'template.html');
        return readFileSync(templatePath, 'utf-8');
    }

    /**
     * 替换模板占位符（兼容 {{TOKEN}} / {{ TOKEN }}）
     * @private
     */
    _replaceToken(html, token, value) {
        const compact = `{{${token}}}`;
        const spaced = `{{ ${token} }}`;
        return html.replace(compact, value).replace(spaced, value);
    }

    /**
     * 安全序列化 JSON，避免意外中断 script 标签
     * @private
     */
    _safeJson(value) {
        return JSON.stringify(value).replace(/</g, '\\u003c');
    }

    /**
     * 准备标注数据供 HTML 使用
     * @private
     */
    _prepareOverlays(overlays, mapper) {
        const result = [];

        for (const overlay of overlays) {
            try {
                const prepared = this._prepareOverlay(overlay, mapper);
                if (prepared) {
                    result.push(prepared);
                }
            } catch (e) {
                console.warn(`跳过无效标注: ${e.message}`);
            }
        }

        return result;
    }

    /**
     * 准备单个标注
     * @private
     */
    _prepareOverlay(overlay, mapper) {
        const base = {
            type: overlay.type,
            color: overlay.color,
            width: overlay.width,
            text: overlay.text,
        };

        if (overlay.type === OverlayType.HORIZONTAL_LINE) {
            let price = overlay.price;

            if (price == null && overlay.mode === AnchorMode.NORMALIZED && mapper && overlay.yNorm != null) {
                const [, convertedPrice] = mapper.normalizedToValue(0.5, overlay.yNorm);
                price = convertedPrice;
            }

            if (price != null) {
                // 收集文本标注信息
                if (overlay.text) {
                    this._textAnnotations.push({
                        price,
                        text: overlay.text,
                        color: overlay.color,
                    });
                }
                return { ...base, price };
            }
        }

        if (overlay.type === OverlayType.TREND_LINE || overlay.type === OverlayType.PARALLEL_CHANNEL) {
            const start = this._resolveAnchor(overlay.start, overlay.mode, mapper);
            const end = this._resolveAnchor(overlay.end, overlay.mode, mapper);

            if (start && end) {
                return {
                    ...base,
                    start,
                    end,
                    channelWidth: overlay.channelWidth,
                };
            }
        }

        if (overlay.type === OverlayType.POLYLINE) {
            if (overlay.points && overlay.points.length >= 2) {
                const resolvedPoints = [];
                for (const point of overlay.points) {
                    const resolved = this._resolveAnchor(point, overlay.mode, mapper);
                    if (resolved) {
                        resolvedPoints.push(resolved);
                    }
                }
                if (resolvedPoints.length >= 2) {
                    return { ...base, points: resolvedPoints };
                }
            }
        }

        if (overlay.type === OverlayType.RAY_LINE) {
            const start = this._resolveAnchor(overlay.start, overlay.mode, mapper);
            if (start) {
                return { ...base, start };
            }
        }

        if (overlay.type === OverlayType.MARKER || overlay.type === OverlayType.LABEL) {
            const start = this._resolveAnchor(overlay.start, overlay.mode, mapper);
            if (start) {
                return {
                    ...base,
                    start,
                    shape: overlay.shape,
                    position: overlay.position,
                };
            }
        }

        return null;
    }

    /**
     * 解析锚点
     * @private
     */
    _resolveAnchor(anchor, mode, mapper) {
        if (!anchor) return null;

        if (anchor instanceof ValueAnchor || anchor.barIndex != null) {
            return {
                barIndex: anchor.barIndex,
                price: anchor.price,
            };
        }

        if (mode === AnchorMode.NORMALIZED && mapper && anchor.x != null && anchor.y != null) {
            const barIndex = Math.round(anchor.x * (mapper.bars.length - 1));
            const [, price] = mapper.normalizedToValue(anchor.x, anchor.y);
            return { barIndex, price };
        }

        return null;
    }

    /**
     * 构建图表并导出 PNG
     * @param {import('./models.js').ChartInput} input 图表输入
     * @param {string} outputPath 输出路径
     * @param {Object} [options]
     * @param {number} [options.waitMs] 等待渲染时间 (毫秒)
     * @returns {Promise<Buffer>}
     */
    async buildAndExport(input, outputPath, { waitMs = 500 } = {}) {
        if (!input.bars || !input.bars.length) {
            throw new Error('bars 数据为空');
        }

        // 创建坐标映射器
        const mainPaneHeightRatio = this._getMainPaneHeightRatio();
        this._coordMapper = new CoordMapper({
            bars: input.bars,
            width: this.width,
            height: Math.floor(this.height * mainPaneHeightRatio),
        });

        // 准备图表数据
        const chartData = input.bars.map((bar) => bar.toDict());
        const indicatorBars =
            Array.isArray(input.indicatorBars) && input.indicatorBars.length ? input.indicatorBars : input.bars;
        const indicatorData = indicatorBars.map((bar) => bar.toDict());
        const futureBarsRaw = Number(input.futureBars);
        const futureBars = Number.isFinite(futureBarsRaw) ? Math.max(0, Math.floor(futureBarsRaw)) : null;

        // 准备标注数据
        this._textAnnotations = [];
        const overlays = this._prepareOverlays(input.overlays || [], this._coordMapper);

        // 生成 HTML
        const watermark = input.title || `${input.symbol} ${input.timeframe}`;
        let html = this._getTemplate();
        html = this._replaceToken(html, 'WIDTH', String(this.width));
        html = this._replaceToken(html, 'HEIGHT', String(this.height));
        html = this._replaceToken(html, 'VOLUME_HEIGHT', String(this.volumePaneHeight));
        html = this._replaceToken(html, 'MACD_HEIGHT', String(this.macdPaneHeight));
        html = this._replaceToken(html, 'TREND_STRENGTH_HEIGHT', String(this.trendStrengthPaneHeight));
        html = this._replaceToken(html, 'FUTURE_BARS', futureBars === null ? 'null' : String(futureBars));
        html = this._replaceToken(html, 'CHART_DATA', this._safeJson(chartData));
        html = this._replaceToken(html, 'INDICATOR_DATA', this._safeJson(indicatorData));
        html = this._replaceToken(html, 'OVERLAYS', this._safeJson(overlays));
        html = this._replaceToken(html, 'WATERMARK_JSON', this._safeJson(watermark));

        // 使用 Puppeteer 渲染
        const browser = await launchPuppeteerBrowser({ purpose: 'chart.render' });

        try {
            const page = await browser.newPage();
            await page.setViewport({ width: this.width, height: this.height });

            page.on('console', (msg) => {
                const type = msg.type();
                const text = msg.text();
                if (type === 'warning' || type === 'error') {
                    console.warn(`[chart][${type}] ${text}`);
                }
            });
            page.on('pageerror', (err) => {
                console.warn(`[chart][pageerror] ${err?.message || String(err)}`);
            });

            await page.setContent(html, { waitUntil: 'domcontentloaded' });

            // 本地注入，避免跨站脚本 + document.write 的噪音与不稳定
            const lightweightChartsPath = join(
                __dirname,
                '..',
                '..',
                '..',
                'node_modules',
                'lightweight-charts',
                'dist',
                'lightweight-charts.standalone.production.js',
            );
            await page.addScriptTag({ path: lightweightChartsPath });
            await page.evaluate(() => {
                if (typeof window.__initChart === 'function') {
                    window.__initChart();
                }
            });

            // 等页面初始化完成
            await page.waitForFunction(
                () => Boolean(window.LightweightCharts) && Boolean(window.__chartReady),
                { timeout: 15000 },
            );

            // 关键数据必须存在，否则直接报错，避免“成功但空图”
            const chartStatus = await page.evaluate(() => ({
                dataLength: Array.isArray(window.chartData) ? window.chartData.length : 0,
                hasMainChart: Boolean(window.mainChart),
            }));
            if (!chartStatus.hasMainChart || chartStatus.dataLength <= 0) {
                throw new Error(`图表未初始化或数据为空: ${JSON.stringify(chartStatus)}`);
            }

            // 等待渲染
            await new Promise((resolve) => setTimeout(resolve, waitMs));

            // 截图
            const screenshot = await page.screenshot({ type: 'png' });

            // 保存文件
            const outputDir = dirname(outputPath);
            mkdirSync(outputDir, { recursive: true });
            writeFileSync(outputPath, screenshot);

            return screenshot;
        } finally {
            await browser.close();
        }
    }

    /**
     * 获取坐标映射器
     */
    get coordMapper() {
        return this._coordMapper;
    }

    /**
     * 获取文本标注列表
     */
    get textAnnotations() {
        return this._textAnnotations;
    }

    /**
     * 添加文本标注到截图
     * @param {Buffer} imgBuffer 原始截图
     * @returns {Promise<Buffer>}
     */
    async addTextAnnotations(imgBuffer) {
        if (!this._textAnnotations.length || !this._coordMapper) {
            return imgBuffer;
        }

        try {
            const sharp = (await import('sharp')).default;

            // 获取图片元数据
            const metadata = await sharp(imgBuffer).metadata();
            const imgWidth = metadata.width;
            const imgHeight = metadata.height;

            // 计算主图区域
            const volumeHeight = Math.floor(imgHeight * this.volumePaneHeight);
            const macdHeight = Math.floor(imgHeight * this.macdPaneHeight);
            const trendStrengthHeight = Math.floor(imgHeight * this.trendStrengthPaneHeight);
            const mainHeight = imgHeight - volumeHeight - macdHeight - trendStrengthHeight;

            // lightweight-charts 的边距
            const chartTopMargin = 20;
            const chartBottomMargin = 25;
            const chartAreaHeight = mainHeight - chartTopMargin - chartBottomMargin;

            // 获取价格范围
            const mapper = this._coordMapper;
            const displayPriceMin = mapper.minPrice;
            const displayPriceMax = mapper.maxPrice;
            const displayPriceRange = displayPriceMax - displayPriceMin;

            // 生成 SVG 文本标注
            const svgElements = [];
            const marginLeft = 10;

            for (const annotation of this._textAnnotations) {
                const { price, text, color } = annotation;

                // 计算 Y 坐标
                let yPos;
                if (displayPriceRange > 0) {
                    const yRatio = (displayPriceMax - price) / displayPriceRange;
                    yPos = Math.floor(chartTopMargin + yRatio * chartAreaHeight);
                } else {
                    yPos = Math.floor(mainHeight / 2);
                }

                // 添加 SVG 文本
                svgElements.push(`
          <rect x="${marginLeft}" y="${yPos - 10}" width="${text.length * 10 + 10}" height="20" 
                fill="rgba(30, 30, 50, 0.8)" rx="3"/>
          <text x="${marginLeft + 5}" y="${yPos + 4}" 
                fill="${color}" font-family="Arial" font-size="12">${text}</text>
        `);
            }

            if (!svgElements.length) {
                return imgBuffer;
            }

            const svgOverlay = `
        <svg width="${imgWidth}" height="${imgHeight}">
          ${svgElements.join('')}
        </svg>
      `;

            // 合成图片
            const result = await sharp(imgBuffer)
                .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
                .toBuffer();

            return result;
        } catch (e) {
            console.warn(`添加文本标注失败: ${e.message}`);
            return imgBuffer;
        }
    }
}

export default ChartBuilder;
