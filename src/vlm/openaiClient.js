/**
 * OpenAI Vision API 客户端
 */

import { readFileSync } from 'fs';
import axios from 'axios';
import { openaiConfig } from '../config/index.js';
import { VLMDecision, VLMDecisionSchema } from './schema.js';
import logger from '../utils/logger.js';

// VLM 系统提示词
export const DEFAULT_SYSTEM_PROMPT = `# Role & Persona
你是一位拥有15年经验的顶级机构量化交易员，专注于**价格行为学 (Price Action)**、**市场结构分析 (Market Structure)** 和 **智能资金流向 (Smart Money Concepts)**。

你的核心能力是通过画线来可视化市场结构，像专业交易员一样标注图表。

# 结构识别方法论 (必须掌握)

## 1. 波浪结构识别 (Swing Structure)
在任何分析前，你必须识别图表中的波浪结构：
- **上升趋势**: 更高的高点 (HH) + 更高的低点 (HL)，依次标记为 1→2→3→4→5
- **下降趋势**: 更低的高点 (LH) + 更低的低点 (LL)，依次标记为 1→2→3→4→5
- **震荡区间**: 多个平行的高点和低点形成通道

画线要求: 用 \`trend_line\` 连接波浪的关键转折点，用 \`label\` 标注波浪序号 (1, 2, 3, 4, 5)

## 2. 关键价位识别
- **支撑位 (Support)**: 价格多次触及后反弹的水平位
- **阻力位 (Resistance)**: 价格多次触及后回落的水平位
- **流动性区域 (Liquidity Pool)**: 前高/前低的扫动区

画线要求: 用 \`horizontal_line\` 标注关键支撑阻力，并用 text 标明 "S1"/"R1"/"Liquidity"

## 3. 形态识别
- **ABCD 形态**: A(起点) → B(回调) → C(延续) → D(目标)
- **双顶/双底**: 两个峰/谷形成反转信号
- **头肩形态**: 左肩 + 头 + 右肩，颈线突破
- **楔形/三角形**: 收敛的趋势线形成突破信号

画线要求: 用多条 \`trend_line\` 组合勾勒形态轮廓

## 4. 通道识别
当价格在两条平行线之间运行时，使用 \`parallel_channel\` 标注

# Analysis Workflow (强制执行)

## Step 1: 结构分析 (Structure)
- 识别当前趋势方向
- 标注最近的 3-5 个波浪转折点 (Swing High/Low)
- 用 trend_line 连接这些点

## Step 2: 关键位标注 (Key Levels)
- 找出 2-3 个关键支撑位
- 找出 2-3 个关键阻力位
- 用 horizontal_line 标注

## Step 3: 形态确认 (Pattern)
- 检查是否存在经典形态
- 用 label 标注形态名称 (如 "OB", "MSS", "BOS", "CHoCH")

## Step 4: 入场分析 (Entry)
- 如果有明确入场信号，用 marker 标注入场点
- 用 horizontal_line 标注 SL (止损) 和 TP (止盈)

# 风控铁律
- 多单止损必须在结构低点下方
- 空单止损必须在结构高点上方
- 没有明确结构 = enter: false
- "无人区"震荡 = enter: false

# Output Schema (严格 JSON)
{
    "enter": true/false,
    "direction": "long"/"short",
    "position_size": 0.0~1.0,
    "leverage": 1.0~10.0,
    "confidence": 0.0~1.0,
    "entry_price": "market"/数值,
    "stop_loss_price": 数值,
    "take_profit_price": 数值,
    "reason": "详细的专业分析理由",
    "draw_instructions": [...]
}

# VLM 坐标规范（强制）
- 坐标采用 **0~1000 归一化数值**
- 坐标原点：左上角为 (0,0)，右下角为 (1000,1000)
- 坐标换算（仅用于理解，不需要输出真实像素）：
  - X真实 = x_norm / 1000 * 屏幕宽度
  - Y真实 = y_norm / 1000 * 屏幕高度
- 你输出的 \`x_norm\` / \`y_norm\` / \`start_x_norm\` / \`end_x_norm\` 都必须在 **[0,1000]**

# 画图指令规范（mode: "normalized"，并同时给出价格）
你必须使用 \`mode: "normalized"\`。
并且在需要价格的地方 **同时提供 price**（用于校验/落地），例如趋势线端点、标记点、水平线等。

## 1. horizontal_line - 水平线
{"type": "horizontal_line", "mode": "normalized", "price": 95000.0, "y_norm": 620, "color": "#ff0000", "text": "SL"}

## 2. trend_line - 趋势线 (连接波浪高低点)
{"type": "trend_line", "mode": "normalized", "from": {"bar_index": 50, "price": 92000.0, "x_norm": 260, "y_norm": 730}, "to": {"bar_index": 150, "price": 96000.0, "x_norm": 820, "y_norm": 310}, "color": "#00ff00"}

## 3. parallel_channel - 平行通道 (通道交易)
{"type": "parallel_channel", "mode": "normalized", "from": {"bar_index": 20, "price": 91000.0, "x_norm": 120, "y_norm": 760}, "to": {"bar_index": 180, "price": 95000.0, "x_norm": 910, "y_norm": 420}, "channel_width": 2000.0, "color": "#ffff00"}

## 4. marker - 标记点
{"type": "marker", "mode": "normalized", "position": {"bar_index": 195, "price": 89800.0, "x_norm": 960, "y_norm": 820}, "shape": "arrow_up", "color": "#00ff00", "text": "Entry"}

## 5. label - 文字标签 (标注形态/波浪序号)
{"type": "label", "mode": "normalized", "position": {"bar_index": 80, "price": 93000.0, "x_norm": 430, "y_norm": 600}, "text": "1", "color": "#ffffff"}

## 6. ray_line - 射线
{"type": "ray_line", "mode": "normalized", "from": {"bar_index": 100, "price": 91000.0, "x_norm": 520, "y_norm": 760}, "color": "#00ffff"}

# 颜色规范
- #00ff00 / #22c55e: 多头、支撑、入场、止盈
- #ff0000 / #ef4444: 空头、阻力、止损
- #ffff00 / #eab308: 通道、关注区
- #00ffff / #3b82f6: 趋势线、中性
- #ffffff: 文字标签

# 画线输出要求 (强制)
1. **最少 6-10 条线**: 包括趋势线、支撑阻力、入场标记
2. **波浪必须标注**: 用 trend_line 连接 + label 标序号
3. **坐标必须用 0~1000 归一化**: 左上角(0,0) → 右下角(1000,1000)
4. **关键点必须同时给出价格**: trend_line / marker / label / ray_line 的锚点必须包含 price；horizontal_line 必须包含 price
5. **bar_index 从0开始**: 0=最早K线，越大越新
6. **画线顺序**: 宏观结构 → 关键价位 → 入场信号
7. **只输出 JSON**: 无需解释文字`;

export const DEFAULT_USER_PROMPT = `请仔细分析这张 K 线图，根据 System Prompt 的规则给出你的交易决策。

重要提示：
1. 图表显示的是最近的K线数据，bar_index 从0开始(最早)到最大值(最新)
2. 仔细观察右上角的价格刻度，确保你标注的价格在图表显示范围内
3. 如果没有明确的交易机会，enter 设为 false
4. 如果决定入场，必须设置止损和止盈价位
5. 在 draw_instructions 中使用 0~1000 归一化坐标，并在关键点位同时提供 price
6. 请尽可能的提高盈亏比，确保每笔交易的风险回报比至少为 1:2 或更高。
7. 你应该仔细分析当前的市场结构、关键支撑阻力位以及价格行为形态
8. 请尽可能的保守来降低风险
9. 要顺势交易，不要试图抄底
10. 警惕假突破
11. 入场晚了就别入，出场晚了就极速出`;

export const ENHANCED_USER_PROMPT_TEMPLATE = `请仔细分析这张 K 线图。

# 图表上下文信息
- 交易对: {symbol}
- 时间周期: {timeframe}
- K线数量: {barsCount} 根
- bar_index 范围: 0 ~ {maxBarIndex} (0=最早, {maxBarIndex}=最新)
- 价格范围: {priceMin} ~ {priceMax}
- 当前价格 (最新收盘): {currentPrice}

# 分析要求
1. **结构识别**: 首先识别市场结构 (上升/下降/震荡)，用 trend_line 连接 3-5 个波浪点并用 label 标注序号
2. **关键价位**: 画出 2-3 条支撑线和 2-3 条阻力线
3. **形态分析**: 如有经典形态 (双顶/双底/头肩/楔形)，用多条 trend_line 勾勒
4. **入场标注**: 如有机会，用 marker 标注入场点，horizontal_line 标 SL/TP
5. **坐标规范**: 所有坐标使用 0~1000 归一化（左上角(0,0)→右下角(1000,1000)），并在关键点同时提供 price

# 画线数量要求
- 最少 6 条线，推荐 8-10 条
- 必须包含: 趋势结构线 + 支撑阻力线 + 波浪序号标签

# 风险提示
- 顺势交易，不抄底
- 警惕假突破
- 无明确结构 = enter: false
- 入场晚了就别入

请输出 JSON 格式的决策和画图指令。`;

export const DEFAULT_AUX_USER_PROMPT_TEMPLATE = `下面第二张图是辅助周期图：{auxTimeframe}（主图为 {primaryTimeframe}）。
它通常用于确认更大周期的结构与关键位，过滤逆势交易；也可以辅助判断入场/出场是否更稳健。
要求：
1) 最终仍只输出一份 JSON
2) draw_instructions 只针对主图（{primaryTimeframe}）
3) 若主图有机会但辅助图不支持（入场时机不好/结构未确认），应倾向 enter=false 或降低仓位等待`;

/**
 * 获取图片的 MIME 类型
 */
function getMimeType(filePath) {
    const ext = filePath.toLowerCase().split('.').pop();
    const mimeTypes = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
    };
    return mimeTypes[ext] || 'image/png';
}

/**
 * 编码图片为 Base64
 */
function encodeImage(imagePath) {
    const imageData = readFileSync(imagePath);
    const base64 = imageData.toString('base64');
    const mimeType = getMimeType(imagePath);
    return { mimeType, base64 };
}

/**
 * 从文本中提取 JSON
 */
function extractJson(text) {
    let content = text.trim();

    // 处理 markdown 代码块
    if (content.includes('```json')) {
        const start = content.indexOf('```json') + 7;
        const end = content.indexOf('```', start);
        if (end > start) {
            content = content.slice(start, end).trim();
        }
    } else if (content.includes('```')) {
        const start = content.indexOf('```') + 3;
        const end = content.indexOf('```', start);
        if (end > start) {
            content = content.slice(start, end).trim();
        }
    }

    // 尝试找到 JSON 对象
    if (!content.startsWith('{')) {
        const start = content.indexOf('{');
        if (start !== -1) {
            let depth = 0;
            for (let i = start; i < content.length; i++) {
                if (content[i] === '{') depth++;
                if (content[i] === '}') depth--;
                if (depth === 0) {
                    content = content.slice(start, i + 1);
                    break;
                }
            }
        }
    }

    return content;
}

/**
 * OpenAI Vision API 客户端
 */
export class VLMClient {
    constructor({
        apiKey = null,
        baseUrl = null,
        model = null,
        timeout = null,
        enableThinking = null,
    } = {}) {
        this.apiKey = apiKey || openaiConfig.apiKey;
        this.baseUrl = (baseUrl || openaiConfig.baseUrl || 'https://api.openai.com/v1').replace(
            /\/+$/,
            ''
        );
        this.model = model || openaiConfig.model;
        this.timeout = timeout ?? openaiConfig.timeout;
        this.enableThinking = enableThinking ?? openaiConfig.enableThinking;

        if (!this.apiKey) {
            throw new Error('未配置 OPENAI_API_KEY');
        }
    }

    /**
     * 分析单张图表
     * @param {string} imagePath 图片路径
     * @param {Object} [options]
     * @param {string} [options.systemPrompt]
     * @param {string} [options.userPrompt]
     * @returns {Promise<VLMDecision>}
     */
    async analyzeChart(imagePath, { systemPrompt = null, userPrompt = null } = {}) {
        const { mimeType, base64 } = encodeImage(imagePath);

        const messages = [
            { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    { type: 'text', text: userPrompt || DEFAULT_USER_PROMPT },
                    {
                        type: 'image_url',
                        image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' },
                    },
                ],
            },
        ];

        const responseText = await this._callApi(messages);
        return this._parseResponse(responseText);
    }

    /**
     * 分析双图表 (主图 + 辅助图)
     * @param {Object} params
     * @param {string} params.primaryImagePath 主图路径
     * @param {string} params.auxImagePath 辅助图路径
     * @param {string} params.primaryTimeframe 主图时间周期
     * @param {string} params.auxTimeframe 辅助图时间周期
     * @param {string} [params.systemPrompt]
     * @param {string} [params.primaryUserPrompt]
     * @param {string} [params.auxUserPrompt]
     * @returns {Promise<VLMDecision>}
     */
    async analyzeChartPair({
        primaryImagePath,
        auxImagePath,
        primaryTimeframe,
        auxTimeframe,
        systemPrompt = null,
        primaryUserPrompt = null,
        auxUserPrompt = null,
    }) {
        const primary = encodeImage(primaryImagePath);
        const aux = encodeImage(auxImagePath);

        const mainText = `【主图：${primaryTimeframe}】
${primaryUserPrompt || DEFAULT_USER_PROMPT}
补充：draw_instructions 只针对主图（${primaryTimeframe}）。`;

        const auxText =
            auxUserPrompt ||
            DEFAULT_AUX_USER_PROMPT_TEMPLATE.replace('{primaryTimeframe}', primaryTimeframe).replace(
                '{auxTimeframe}',
                auxTimeframe
            );

        const messages = [
            { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
            {
                role: 'user',
                content: [
                    { type: 'text', text: mainText },
                    {
                        type: 'image_url',
                        image_url: { url: `data:${primary.mimeType};base64,${primary.base64}`, detail: 'high' },
                    },
                    { type: 'text', text: auxText },
                    {
                        type: 'image_url',
                        image_url: { url: `data:${aux.mimeType};base64,${aux.base64}`, detail: 'high' },
                    },
                ],
            },
        ];

        const responseText = await this._callApi(messages);
        return this._parseResponse(responseText);
    }

    /**
     * 调用 API
     * @private
     */
    async _callApi(messages) {
        let base = this.baseUrl.replace(/\/+$/, '');
        if (!base.endsWith('/v1')) {
            base = `${base}/v1`;
        }
        const url = `${base}/chat/completions`;

        const payload = {
            model: this.model,
            messages,
            max_tokens: openaiConfig.maxTokens,
            temperature: openaiConfig.temperature,
        };

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: this.timeout * 1000,
            });

            const data = response.data;

            if (!data.choices || !data.choices.length) {
                throw new Error(`API 响应格式异常: ${JSON.stringify(data)}`);
            }

            const message = data.choices[0].message;
            let content = message.content;
            const reasoningContent = message.reasoning_content || '';

            // Thinking 模型处理
            if (this.enableThinking && reasoningContent) {
                logger.debug(`[Thinking] 推理过程 (${reasoningContent.length} 字符)`);
            }

            if (!content && reasoningContent) {
                logger.debug('[Thinking] content 为空，尝试从 reasoning_content 提取...');
                content = this._extractJsonFromThinking(reasoningContent);
            }

            if (!content) {
                throw new Error(`API 响应 content 为空`);
            }

            return content;
        } catch (error) {
            if (error.response) {
                throw new Error(`API 调用失败: ${error.response.status} - ${error.response.data}`);
            }
            throw error;
        }
    }

    /**
     * 从 thinking 输出中提取 JSON
     * @private
     */
    _extractJsonFromThinking(text) {
        const lastBrace = text.lastIndexOf('}');
        if (lastBrace === -1) return text;

        let depth = 0;
        for (let i = lastBrace; i >= 0; i--) {
            if (text[i] === '}') depth++;
            if (text[i] === '{') depth--;
            if (depth === 0) {
                const extracted = text.slice(i, lastBrace + 1);
                try {
                    JSON.parse(extracted);
                    return extracted;
                } catch {
                    continue;
                }
            }
        }

        return text;
    }

    /**
     * 解析响应
     * @private
     */
    _parseResponse(responseText) {
        const jsonStr = extractJson(responseText);
        return VLMDecision.fromJson(jsonStr);
    }
}

export default VLMClient;
