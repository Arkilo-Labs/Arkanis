/**
 * OpenAI Vision API 客户端
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import axios from 'axios';
import { lensConfig } from '../config/index.js';
import { LensDecision } from './schema.js';
import logger from '../utils/logger.js';
import PromptManager from './promptManager.js';
import { resolveProviderForRole } from '../services/providerResolver.js';
import { resolveDataDir } from '../utils/dataDir.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const DATA_DIR = resolveDataDir({ projectRoot: PROJECT_ROOT });

// Lens 系统提示词
export const DEFAULT_SYSTEM_PROMPT = PromptManager.getPrompt('default');

export const DEFAULT_USER_PROMPT = `请仔细分析这张 K 线图，根据 System Prompt 的规则给出你的交易决策。

重要提示：
1. 图表显示的是最近的K线数据，bar_index 从0开始(最早)到最大值(最新)
2. 仔细观察右上角的价格刻度，确保你标注的价格在图表显示范围内
3. 如果没有明确的交易机会，enter 设为 false
4. 如果决定入场，必须设置止损和止盈价位
5. **entry_price 必须给出具体价格值**，基于以下策略：
   - 做多：在支撑位上方、回调位、突破后回踩位设置限价买入
   - 做空：在阻力位下方、反弹位、跌破后反抽位设置限价卖出
   - 如果当前价格已经是最佳入场点，可以用 "market"
   - 限价单价格应该比当前价格更优（做多低于当前价，做空高于当前价）
6. 在 draw_instructions 中使用 0~1000 归一化坐标，并在关键点位同时提供 price
7. 请尽可能的提高盈亏比，确保每笔交易的风险回报比至少为 1:2 或更高
8. 你应该仔细分析当前的市场结构、关键支撑阻力位以及价格行为形态
9. 请尽可能的保守来降低风险
10. 要顺势交易，不要试图抄底
11. 警惕假突破
12. 入场晚了就别入，出场晚了就极速出
13. 图表包含 BOLL(20,2) / MACD(12,26,9) / ADX(14)，必须在 JSON 中输出 indicator_views，给出你对每个指标的看法（偏多/偏空/中性、强弱/是否低于平均等）`;

export const ENHANCED_USER_PROMPT_TEMPLATE = `请仔细分析这张 K 线图。

# 图表上下文信息
- 交易对: {symbol}
- 时间周期: {timeframe}
- K线数量: {barsCount} 根
- bar_index 范围: 0 ~ {maxBarIndex} (0=最早, {maxBarIndex}=最新)
- **重要**: 图表宽度均匀分布 {barsCount} 根 K 线，每根 K 线的宽度相等
- **定位方法**: 将图表宽度分为 {barsCount} 等份，第 n 根 K 线位于 n/{maxBarIndex} 处
- 价格范围: {priceMin} ~ {priceMax}
- 当前价格 (最新收盘): {currentPrice}
- 图表指标: BOLL(20,2) / MACD(12,26,9) / ADX(14)（已绘制在截图内）

# bar_index 精确定位指南
1. **横向定位**: 图表从左到右线性分布，使用以下公式计算 bar_index
   - 最左侧（图表起点）= bar_index 0
   - 最右侧（图表终点）= bar_index {maxBarIndex}
   - 中间位置 = bar_index {maxBarIndex}/2 = {halfBarIndex}
   - 任意位置 = (图表宽度占比) × {maxBarIndex}

2. **关键参考点**:
   - 如果你看到的 K 线在图表 25% 位置，其 bar_index ≈ {quarterBarIndex}
   - 如果在 50% 位置（中点），bar_index ≈ {halfBarIndex}
   - 如果在 75% 位置，bar_index ≈ {threeQuarterBarIndex}

3. **识别转折点**: 仔细观察每个波浪的高点/低点，估算其在图表中的水平位置占比，然后换算为 bar_index

# 分析要求
1. **结构识别**: 首先识别市场结构 (上升/下降/震荡) - **这是最重要的步骤**
   - 找出 3-5 个明显的波浪转折点（Swing High/Low）
   - **必须用 trend_line 或 polyline 连接这些转折点**
   - 用 label 标注波浪序号 (1, 2, 3, 4, 5)
   - **必须提供精确的 bar_index**，根据转折点在图表中的位置估算
   - **至少画 2-3 条斜向趋势线**，不能只画水平线
   - 趋势线应该连接实际的高点或低点，不能随意画

2. **关键价位**: 画出 2-3 条支撑线和 2-3 条阻力位
   - 观察价格多次触及的水平位
   - 用 horizontal_line 标注，必须提供 price
   - 注意：水平线是辅助工具，不能替代趋势线

3. **形态分析**: 如有经典形态 (双顶/双底/头肩/楔形/旗形)
   - 用多条 trend_line 勾勒形态轮廓
   - 每个关键点必须提供 bar_index 和 price

4. **入场标注**: 如有机会
   - 用 marker 标注入场点
   - 用 horizontal_line 标 SL/TP
   - **必须给出具体的 entry_price**

5. **入场价格策略**:
   - **做多限价单**: 在关键支撑位上方 10-50 点设置买入价
     * 例如：支撑 86000，当前价 86200，设置 entry_price: 86050
   - **做空限价单**: 在关键阻力位下方 10-50 点设置卖出价
     * 例如：阻力 87400，当前价 87200，设置 entry_price: 87350
   - **回调入场**: 价格向支撑/阻力回调时的限价位
     * 例如：趋势向上，等待回调到 0.382 斐波那契位
   - **市价入场**: 仅在以下情况使用 "market"
     * 强势突破且不会回踩
     * 入场机会稍纵即逝
     * 当前价格就是最佳入场点
   - **价格合理性检查**:
     * 限价买入必须 ≤ 当前价格（{currentPrice}）
     * 限价卖出必须 ≥ 当前价格（{currentPrice}）
     * 入场价与止损价之间要留出合理的风险空间

6. **坐标规范**:
   - **优先使用 bar_index + price**，这是最精确的定位方式
   - 归一化坐标 (x_norm, y_norm) 仅作为辅助参考
   - x_norm = bar_index × 1000 / {maxBarIndex}
   - y_norm = (price 的归一化值) × 1000，顶部=0，底部=1000

# 画线数量要求
- 最少 8 条线，推荐 10-15 条
- **必须包含**: 趋势结构线 (2-3条 trend_line/polyline，必须有) + 支撑阻力线 (4-6条 horizontal_line) + 波浪标签 (3-5个 label)
- **禁止**: 不能只画水平线而不画趋势线
- **优先级**: 趋势线 > 水平线 > 标签

# 示例：如何精确标注和设置入场价格
假设你识别了一个上升趋势，有 3 个关键点：
- 点1（起点）: 在图表 10% 位置，价格 85000，估算 bar_index = {maxBarIndex} × 0.1 ≈ {exampleBar1}
- 点2（中继）: 在图表 50% 位置，价格 84000，估算 bar_index ≈ {halfBarIndex}
- 点3（高点）: 在图表 90% 位置，价格 87000，估算 bar_index = {maxBarIndex} × 0.9 ≈ {exampleBar3}
- 当前价格: {currentPrice}
- 关键支撑位: 86800

入场分析：
- 趋势向上，应做多
- 价格在支撑位上方，等待小幅回调后入场
- 入场价设置在 86850（支撑 86800 上方 50 点）
- 止损设置在 86600（支撑下方 200 点）
- 止盈设置在 87600（盈亏比约 1:3.75）

输出示例：
{{
  "enter": true,
  "direction": "long",
  "entry_price": 86850,
  "stop_loss_price": 86600,
  "take_profit_price": 87600,
  "position_size": 0.3,
  "leverage": 5,
  "confidence": 0.75,
  "reason": "上升趋势完好，价格回调至支撑位上方形成买入机会。设置限价单在86850等待回调入场。",
  "indicator_views": {{
    "bollinger": {{ "bias": "neutral", "note": "价格在中轨附近，带宽一般" }},
    "macd": {{ "bias": "bullish", "note": "MACD 上穿信号线，动能转强" }},
    "trend_strength": {{ "level": "average", "bias": "neutral", "note": "ADX 中等，趋势强度一般" }}
  }},
  "draw_instructions": [
    {{
      "type": "polyline",
      "points": [
        {{"bar_index": {exampleBar1}, "price": 85000}},
        {{"bar_index": {halfBarIndex}, "price": 84000}},
        {{"bar_index": {exampleBar3}, "price": 87000}}
      ],
      "color": "#00ffff",
      "text": "Uptrend Structure"
    }},
    {{
      "type": "trend_line",
      "from": {{"bar_index": {exampleBar1}, "price": 85000}},
      "to": {{"bar_index": {exampleBar3}, "price": 86800}},
      "color": "#22c55e",
      "text": "Support Trendline"
    }},
    {{
      "type": "horizontal_line",
      "price": 86800,
      "color": "#22c55e",
      "text": "Support"
    }},
    {{
      "type": "marker",
      "position": {{"bar_index": {exampleBar3}, "price": 86850}},
      "shape": "arrow_up",
      "color": "#00ff00",
      "text": "Entry"
    }},
    {{
      "type": "horizontal_line",
      "price": 86600,
      "color": "#ef4444",
      "text": "SL"
    }},
    {{
      "type": "horizontal_line",
      "price": 87600,
      "color": "#22c55e",
      "text": "TP"
    }},
    {{
      "type": "label",
      "position": {{"bar_index": {halfBarIndex}, "price": 84000}},
      "text": "1",
      "color": "#ffffff"
    }}
  ]
}}

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
    let content = String(text ?? '').trim();
    if (!content) return content;

    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
        content = fenceMatch[1].trim();
    }

    const extracted = findLastValidJsonSegment(content);
    return extracted ?? content;
}

/**
 * 提取最后一个可解析的 JSON 段（不做“修 JSON”）
 */
function findLastValidJsonSegment(text) {
    const input = String(text ?? '').trim();
    if (!input) return null;

    try {
        JSON.parse(input);
        return input;
    } catch {
        // 继续尝试提取
    }

    let inString = false;
    let escape = false;
    let startIndex = -1;
    let stack = [];
    let lastValid = null;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (inString) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{' || ch === '[') {
            if (stack.length === 0) startIndex = i;
            stack.push(ch);
            continue;
        }

        if (ch === '}' || ch === ']') {
            if (stack.length === 0) continue;

            const open = stack[stack.length - 1];
            const matched = (open === '{' && ch === '}') || (open === '[' && ch === ']');
            if (!matched) {
                stack = [];
                startIndex = -1;
                continue;
            }

            stack.pop();
            if (stack.length !== 0 || startIndex === -1) continue;

            const candidate = input.slice(startIndex, i + 1);
            startIndex = -1;

            try {
                JSON.parse(candidate);
                lastValid = candidate;
            } catch {
                // 忽略：继续寻找下一个段
            }
        }
    }

    return lastValid;
}

/**
 * OpenAI Vision API 客户端
 */
export class LensClient {
    constructor({
        apiKey,
        baseUrl,
        model,
        timeout = 240,
        enableThinking = false,
        maxTokens = 8192,
        temperature = 0.2,
        } = {}) {
        if (!apiKey) {
            throw new Error('未提供 API Key，请使用 LensClient.fromRole("lens") 创建实例');
        }
        if (!baseUrl) {
            throw new Error('未提供 Base URL');
        }
        if (!model) {
            throw new Error('未提供模型名称');
        }

        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.model = model;
        this.timeout = timeout;
        this.enableThinking = enableThinking;
        this.maxTokens = maxTokens;
        this.temperature = temperature;
        this.promptName = lensConfig.promptName;
    }

    /**
     * 从 role 绑定的 Provider 创建客户端
     * @returns {Promise<LensClient>}
     */
    static async fromRole(role = 'lens') {
        const { provider, apiKey } = await resolveProviderForRole({
            projectRoot: PROJECT_ROOT,
            dataDir: DATA_DIR,
            encKey: process.env.SECRETS_ENC_KEY || '',
            role,
        });

        return new LensClient({
            apiKey,
            baseUrl: provider.baseUrl,
            model: provider.modelName,
            enableThinking: provider.thinkingMode === 'enabled',
            maxTokens: provider.maxTokens || 8192,
            temperature: provider.temperature || 0.2,
        });
    }

    /**
     * 分析单张图表
     * @param {string} imagePath 图片路径
     * @param {Object} [options]
     * @param {string} [options.systemPrompt]
     * @param {string} [options.userPrompt]
     * @returns {Promise<LensDecision>}
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
     * @returns {Promise<LensDecision>}
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
补充：draw_instructions 只针对主图（${primaryTimeframe}），indicator_views 则基于图中 BOLL/MACD/ADX 的显示来判断。`;

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
            max_tokens: this.maxTokens,
            temperature: this.temperature,
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
        return extractJson(text);
    }

    /**
     * 解析响应
     * @private
     */
    _parseResponse(responseText) {
        const jsonStr = extractJson(responseText);
        try {
            return LensDecision.fromJson(jsonStr);
        } catch (error) {
            logger.error('[JSON解析失败] 原始响应长度:', responseText.length);
            logger.error('[JSON解析失败] 提取的JSON长度:', jsonStr.length);
            // 保存到文件以便调试
            const debugDir = './outputs/debug';
            if (!existsSync(debugDir)) {
                mkdirSync(debugDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            writeFileSync(
                join(debugDir, `lens_response_${timestamp}.txt`),
                responseText
            );
            writeFileSync(
                join(debugDir, `lens_json_${timestamp}.txt`),
                jsonStr
            );
            logger.error(`[调试信息] 已保存原始响应到: outputs/debug/lens_response_${timestamp}.txt`);
            logger.error(`[调试信息] 已保存提取JSON到: outputs/debug/lens_json_${timestamp}.txt`);
            throw error;
        }
    }
}

export default LensClient;
