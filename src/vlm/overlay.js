/**
 * VLM 画图指令 -> 图表标注转换
 */

import {
    AnchorMode,
    OverlayType,
    MarkerShape,
    MarkerPosition,
    ValueAnchor,
    NormalizedAnchor,
    OverlayObject,
} from '../chart/models.js';
import { DrawInstructionType } from './schema.js';

function normalizeVlmCoordToUnit(value) {
    if (value == null) return null;
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return null;

    // VLM 坐标策略：0~1000 归一化
    const unit = num / 1000;
    return Math.max(0, Math.min(1, unit));
}

/**
 * 转换锚点
 * @param {Object} point 锚点数据
 * @param {import('../data/models.js').Bar[]} bars K线数据
 * @param {string} mode 锚点模式
 * @returns {ValueAnchor | NormalizedAnchor | null}
 */
function convertAnchorPoint(point, bars, mode) {
    if (!point) return null;

    if (point.bar_index != null && bars.length) {
        const idx = Math.min(Math.max(point.bar_index, 0), bars.length - 1);
        return new ValueAnchor({
            barIndex: idx,
            timestamp: bars[idx].ts,
            price: point.price ?? bars[idx].close,
        });
    }

    if (point.timestamp != null) {
        return new ValueAnchor({
            timestamp: new Date(point.timestamp),
            price: point.price ?? 0,
        });
    }

    if (mode === AnchorMode.NORMALIZED) {
        if (point.x_norm != null && point.y_norm != null) {
            const x = normalizeVlmCoordToUnit(point.x_norm);
            const y = normalizeVlmCoordToUnit(point.y_norm);
            if (x != null && y != null) {
                return new NormalizedAnchor({ x, y });
            }
        }
    }

    if (point.x_norm != null && point.y_norm != null) {
        const x = normalizeVlmCoordToUnit(point.x_norm);
        const y = normalizeVlmCoordToUnit(point.y_norm);
        if (x != null && y != null) {
            return new NormalizedAnchor({ x, y });
        }
    }

    return null;
}

/**
 * 将 VLM 的 DrawInstruction 转换为 OverlayObject
 * @param {import('./schema.js').DrawInstruction} instr 画图指令
 * @param {import('../data/models.js').Bar[]} bars K线数据
 * @returns {OverlayObject}
 */
export function drawInstructionToOverlay(instr, bars) {
    const mode = instr.mode === 'value' ? AnchorMode.VALUE : AnchorMode.NORMALIZED;

    if (instr.type === DrawInstructionType.HORIZONTAL_LINE) {
        return new OverlayObject({
            type: OverlayType.HORIZONTAL_LINE,
            mode,
            price: instr.price,
            yNorm: normalizeVlmCoordToUnit(instr.yNorm),
            color: instr.color,
            text: instr.text,
            width: instr.width,
        });
    }

    if (instr.type === DrawInstructionType.TREND_LINE) {
        const startAnchor = convertAnchorPoint(instr.start, bars, mode);
        const endAnchor = convertAnchorPoint(instr.end, bars, mode);
        return new OverlayObject({
            type: OverlayType.TREND_LINE,
            mode,
            start: startAnchor,
            end: endAnchor,
            color: instr.color,
            width: instr.width,
        });
    }

    if (instr.type === DrawInstructionType.PARALLEL_CHANNEL) {
        const startAnchor = convertAnchorPoint(instr.start, bars, mode);
        const endAnchor = convertAnchorPoint(instr.end, bars, mode);
        return new OverlayObject({
            type: OverlayType.PARALLEL_CHANNEL,
            mode,
            start: startAnchor,
            end: endAnchor,
            channelWidth: instr.channelWidth,
            color: instr.color,
            width: instr.width,
        });
    }

    if (instr.type === DrawInstructionType.RAY_LINE) {
        const startAnchor = convertAnchorPoint(instr.start, bars, mode);
        return new OverlayObject({
            type: OverlayType.RAY_LINE,
            mode,
            start: startAnchor,
            color: instr.color,
            width: instr.width,
        });
    }

    if (instr.type === DrawInstructionType.MARKER) {
        const anchor = convertAnchorPoint(instr.position, bars, mode);

        const shapeMap = {
            arrow_up: MarkerShape.ARROW_UP,
            arrow_down: MarkerShape.ARROW_DOWN,
            circle: MarkerShape.CIRCLE,
            square: MarkerShape.SQUARE,
        };
        const shape = shapeMap[instr.shape?.toLowerCase()] ?? MarkerShape.ARROW_UP;

        return new OverlayObject({
            type: OverlayType.MARKER,
            mode,
            start: anchor,
            shape,
            position: shape === MarkerShape.ARROW_UP ? MarkerPosition.BELOW : MarkerPosition.ABOVE,
            color: instr.color,
            text: instr.text,
        });
    }

    if (instr.type === DrawInstructionType.LABEL) {
        const anchor = convertAnchorPoint(instr.position, bars, mode);
        return new OverlayObject({
            type: OverlayType.LABEL,
            mode,
            start: anchor,
            text: instr.text,
            color: instr.color,
        });
    }

    if (instr.type === DrawInstructionType.VERTICAL_SPAN) {
        return new OverlayObject({
            type: OverlayType.VERTICAL_SPAN,
            mode,
            startXNorm: normalizeVlmCoordToUnit(instr.startXNorm),
            endXNorm: normalizeVlmCoordToUnit(instr.endXNorm),
            startBarIndex: instr.startBarIndex,
            endBarIndex: instr.endBarIndex,
            color: instr.color,
        });
    }

    // 默认返回水平线
    return new OverlayObject({
        type: OverlayType.HORIZONTAL_LINE,
        mode,
        price: instr.price ?? 0,
        color: instr.color,
        text: instr.text,
    });
}

export default { drawInstructionToOverlay };
