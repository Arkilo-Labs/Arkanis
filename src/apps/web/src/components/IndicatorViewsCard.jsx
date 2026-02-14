import { useMemo } from 'react';

function normalizeBias(value) {
    const v = String(value || '').trim().toLowerCase();
    if (['bullish', 'long', 'buy', '看多', '偏多', '多', '多头'].includes(v)) return 'bullish';
    if (['bearish', 'short', 'sell', '看空', '偏空', '空', '空头'].includes(v)) return 'bearish';
    if (['neutral', 'none', 'wait', 'hold', '中性', '观望'].includes(v)) return 'neutral';
    return v || 'neutral';
}

function normalizeStrengthLevel(value) {
    const v = String(value || '').trim().toLowerCase();
    if (['above_average', 'above', 'strong', 'high', '高于平均', '偏强', '强'].includes(v)) return 'above_average';
    if (['below_average', 'below', 'weak', 'low', '低于平均', '偏弱', '弱'].includes(v)) return 'below_average';
    if (['average', 'mid', 'normal', '中等', '平均', '一般'].includes(v)) return 'average';
    return v || 'average';
}

function biasLabel(bias) {
    const b = normalizeBias(bias);
    if (b === 'bullish') return '偏多';
    if (b === 'bearish') return '偏空';
    if (b === 'neutral') return '中性';
    return b;
}

function strengthLabel(level) {
    const l = normalizeStrengthLevel(level);
    if (l === 'above_average') return '高于平均';
    if (l === 'below_average') return '低于平均';
    if (l === 'average') return '平均';
    return l;
}

function badgeClassByBias(bias) {
    const b = normalizeBias(bias);
    if (b === 'bullish') return 'iv-badge iv-badge--bullish';
    if (b === 'bearish') return 'iv-badge iv-badge--bearish';
    return 'iv-badge iv-badge--neutral';
}

export default function IndicatorViewsCard({ views = null, title = '指标观点' }) {
    const items = useMemo(() => {
        const v = views || {};

        const bollBias = normalizeBias(v?.bollinger?.bias);
        const macdBias = normalizeBias(v?.macd?.bias);
        const adxLevel = normalizeStrengthLevel(v?.trend_strength?.level);
        const adxBias = normalizeBias(v?.trend_strength?.bias);

        const score =
            (bollBias === 'bullish' ? 1 : bollBias === 'bearish' ? -1 : 0) +
            (macdBias === 'bullish' ? 1 : macdBias === 'bearish' ? -1 : 0) +
            (adxBias === 'bullish' ? 1 : adxBias === 'bearish' ? -1 : 0);

        const overallBias = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral';

        return [
            {
                key: 'macd',
                name: 'MACD',
                right: biasLabel(macdBias),
                badgeClass: badgeClassByBias(macdBias),
                note: v?.macd?.note || '',
            },
            {
                key: 'boll',
                name: '布林带',
                right: biasLabel(bollBias),
                badgeClass: badgeClassByBias(bollBias),
                note: v?.bollinger?.note || '',
            },
            {
                key: 'trend',
                name: '趋势强度',
                right: `${strengthLabel(adxLevel)} · ${biasLabel(adxBias)}`,
                badgeClass: 'iv-badge iv-badge--purple',
                note: v?.trend_strength?.note || '',
            },
            {
                key: 'overall',
                name: '综合倾向',
                right: biasLabel(overallBias),
                badgeClass: badgeClassByBias(overallBias),
                note: '',
            },
        ];
    }, [views]);

    if (!views) return null;

    return (
        <div
            className="indicator-views-card glass-card iv-card overflow-hidden"
            style={{
                '--glass-bg': 'rgba(5, 6, 12, 0.72)',
                '--glass-border': 'rgba(255, 255, 255, 0.08)',
            }}
        >
            <div className="px-6 pt-5 pb-4 border-b border-white/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <i className="fas fa-chart-line text-white/55 text-sm"></i>
                        <span className="text-label text-white/80">{title}</span>
                    </div>
                    <span className="text-xs text-white/25">AI 观点</span>
                </div>
            </div>

            <div className="divide-y divide-white/5">
                {items.map((item) => (
                    <div key={item.key} className="px-6 py-4 iv-row">
                        <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-white/70 tracking-wide">
                                {item.name}
                            </span>
                            <span className={item.badgeClass}>{item.right}</span>
                        </div>
                        {item.note ? (
                            <div className="mt-2 text-xs text-white/35 leading-relaxed line-clamp-2">
                                {item.note}
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
