/**
 * OpenAI Vision API 客户端
 */

import { readFileSync } from 'fs';
import axios from 'axios';
import { openaiConfig } from '../config/index.js';
import { VLMDecision, VLMDecisionSchema } from './schema.js';
import logger from '../utils/logger.js';
import PromptManager from './promptManager.js';

// VLM 系统提示词
export const DEFAULT_SYSTEM_PROMPT = PromptManager.getPrompt('default');

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
        this.promptName = openaiConfig.promptName;

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

        const currentSystemPrompt = systemPrompt || PromptManager.getPrompt(this.promptName);

        const messages = [
            { role: 'system', content: currentSystemPrompt },
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

        const currentSystemPrompt = systemPrompt || PromptManager.getPrompt(this.promptName);

        const messages = [
            { role: 'system', content: currentSystemPrompt },
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
