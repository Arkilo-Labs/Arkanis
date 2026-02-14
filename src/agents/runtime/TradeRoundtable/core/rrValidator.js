/**
 * 盈亏比（Risk-Reward Ratio）校验模块
 * 用于解析 Leader JSON 中的 Plan 并强制校验盈亏比是否符合铁律
 */

/**
 * 从字符串或数字中解析价格
 * 支持 "limit@90700"、"market"、"90700" 等格式
 */
function parsePrice(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    
    const str = String(value || '').trim().toLowerCase();
    
    // market 订单无法计算精确入场价
    if (str === 'market') {
        return null;
    }
    
    // 支持 "limit@90700" 格式
    const limitMatch = str.match(/limit@([\d.]+)/i);
    if (limitMatch) {
        return parseFloat(limitMatch[1]);
    }
    
    // 直接数字字符串
    const numMatch = str.match(/^[\d.]+$/);
    if (numMatch) {
        return parseFloat(numMatch[0]);
    }
    
    // 尝试提取任意数字
    const anyMatch = str.match(/([\d.]+)/);
    if (anyMatch) {
        return parseFloat(anyMatch[1]);
    }
    
    return null;
}

/**
 * 计算盈亏比
 * @param {Object} params
 * @param {number} params.entry - 入场价
 * @param {number} params.sl - 止损价
 * @param {number} params.tp - 止盈价
 * @param {string} params.direction - 方向：LONG 或 SHORT
 * @returns {number|null} 盈亏比，无法计算时返回 null
 */
function calculateRR({ entry, sl, tp, direction }) {
    if (entry == null || sl == null || tp == null) {
        return null;
    }
    
    let risk, reward;
    
    if (direction === 'LONG') {
        risk = entry - sl;
        reward = tp - entry;
    } else if (direction === 'SHORT') {
        risk = sl - entry;
        reward = entry - tp;
    } else {
        return null;
    }
    
    // 风险必须为正数
    if (risk <= 0) {
        return null;
    }
    
    return reward / risk;
}

/**
 * 计算满足最小 RR 要求的调整后入场价
 * @param {Object} params
 * @param {number} params.sl - 止损价
 * @param {number} params.tp - 止盈价
 * @param {string} params.direction - 方向
 * @param {number} params.minRR - 最小盈亏比要求
 * @returns {number} 调整后的入场价
 */
function calculateAdjustedEntry({ sl, tp, direction, minRR }) {
    // RR = reward / risk
    // LONG: RR = (tp - entry) / (entry - sl)
    //       entry * (RR + 1) = tp + RR * sl
    //       entry = (tp + RR * sl) / (RR + 1)
    // SHORT: RR = (entry - tp) / (sl - entry)
    //        entry * (RR + 1) = tp + RR * sl
    //        entry = (tp + RR * sl) / (RR + 1)
    
    // 两种情况公式相同
    return (tp + minRR * sl) / (minRR + 1);
}

/**
 * 校验 Leader JSON 中的交易计划盈亏比
 * @param {Object} leaderJson - Leader 输出的 JSON 对象
 * @param {Object} options
 * @param {number} options.minRR - 最小盈亏比要求，默认 1.5
 * @returns {Object} 校验结果
 */
export function validateRR(leaderJson, { minRR = 1.5 } = {}) {
    // 非 ENTER 信号无需校验
    if (!leaderJson || leaderJson.signal !== 'ENTER') {
        return {
            valid: true,
            skipped: true,
            reason: '非 ENTER 信号，无需校验',
        };
    }
    
    const plan = leaderJson.plan || {};
    const direction = leaderJson.direction;
    
    // 解析价格
    const entry = parsePrice(plan.entry);
    const sl = parsePrice(plan.stop_loss);
    const tp = parsePrice(plan.take_profit);
    
    // 检查是否有缺失值
    if (entry == null) {
        // Market 订单特殊处理
        if (String(plan.entry || '').toLowerCase() === 'market') {
            return {
                valid: false,
                warning: true,
                reason: 'Market 订单无法精确计算 RR，建议改用 Limit 订单',
                entry: 'market',
                sl,
                tp,
                direction,
            };
        }
        return {
            valid: false,
            reason: '入场价缺失或无法解析',
            rawEntry: plan.entry,
            sl,
            tp,
            direction,
        };
    }
    
    if (sl == null) {
        return {
            valid: false,
            reason: '止损价缺失或无法解析',
            entry,
            rawSL: plan.stop_loss,
            tp,
            direction,
        };
    }
    
    if (tp == null) {
        return {
            valid: false,
            reason: '止盈价缺失或无法解析',
            entry,
            sl,
            rawTP: plan.take_profit,
            direction,
        };
    }
    
    // 检查方向
    if (direction !== 'LONG' && direction !== 'SHORT') {
        return {
            valid: false,
            reason: `方向无效：${direction}，必须为 LONG 或 SHORT`,
            entry,
            sl,
            tp,
            direction,
        };
    }
    
    // 计算 RR
    const rr = calculateRR({ entry, sl, tp, direction });
    
    if (rr == null) {
        return {
            valid: false,
            reason: '无法计算 RR（可能止损方向设置错误）',
            entry,
            sl,
            tp,
            direction,
        };
    }
    
    const valid = rr >= minRR;
    const result = {
        valid,
        rr: parseFloat(rr.toFixed(2)),
        rrFormatted: rr.toFixed(2),
        entry,
        sl,
        tp,
        direction,
        minRR,
        reason: valid
            ? `RR ${rr.toFixed(2)} >= ${minRR}，符合要求`
            : `RR ${rr.toFixed(2)} < ${minRR}，不符合风控铁律`,
    };
    
    // 如果不合格，给出修正建议
    if (!valid) {
        const adjustedEntry = calculateAdjustedEntry({ sl, tp, direction, minRR });
        result.suggestion = {
            adjustedEntry: parseFloat(adjustedEntry.toFixed(2)),
            explanation: direction === 'LONG'
                ? `将入场价下调至 ${adjustedEntry.toFixed(2)} 可满足 RR >= ${minRR}`
                : `将入场价上调至 ${adjustedEntry.toFixed(2)} 可满足 RR >= ${minRR}`,
        };
    }
    
    return result;
}

/**
 * 批量校验多个交易计划
 * @param {Array<Object>} plans - 交易计划数组
 * @param {Object} options
 * @returns {Array<Object>} 校验结果数组
 */
export function validateMultipleRR(plans, options = {}) {
    return (plans || []).map((plan) => validateRR(plan, options));
}

/**
 * 生成 RR 校验报告（Markdown 格式）
 * @param {Object} result - validateRR 的返回结果
 * @returns {string} Markdown 格式的报告
 */
export function formatRRReport(result) {
    if (result.skipped) {
        return '';
    }
    
    const lines = ['## 盈亏比校验结果', ''];
    
    if (result.valid) {
        lines.push(`- 状态：通过`);
        lines.push(`- RR：${result.rrFormatted}`);
        lines.push(`- 入场：${result.entry}`);
        lines.push(`- 止损：${result.sl}`);
        lines.push(`- 止盈：${result.tp}`);
    } else {
        lines.push(`> [!WARNING]`);
        lines.push(`> ${result.reason}`);
        lines.push('');
        lines.push(`- 入场：${result.entry ?? result.rawEntry ?? 'N/A'}`);
        lines.push(`- 止损：${result.sl ?? result.rawSL ?? 'N/A'}`);
        lines.push(`- 止盈：${result.tp ?? result.rawTP ?? 'N/A'}`);
        
        if (result.suggestion) {
            lines.push('');
            lines.push('**修正建议：**');
            lines.push(result.suggestion.explanation);
        }
    }
    
    return lines.join('\n');
}
