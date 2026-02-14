import { useMemo } from 'react';

function normalizeText(value) {
    return String(value ?? '').trim().toLowerCase();
}

function biasLabel(bias) {
    const b = normalizeText(bias);
    if (!b || b === 'neutral') return '中性';
    if (b === 'bullish') return '偏多';
    if (b === 'bearish') return '偏空';
    return b;
}

function strengthLabel(level) {
    const l = normalizeText(level);
    if (!l || l === 'average') return '平均';
    if (l === 'above_average') return '高于平均';
    if (l === 'below_average') return '低于平均';
    return l;
}

function badgeClassByBias(bias) {
    const b = normalizeText(bias);
    if (b === 'bullish') return 'iv-badge iv-badge--bullish';
    if (b === 'bearish') return 'iv-badge iv-badge--bearish';
    return 'iv-badge iv-badge--neutral';
}

export default function IndicatorViewsCard({ views = null, title = '指标观点' }) {
    const items = useMemo(() => {
        const v = views || {};

        const bollBias = normalizeText(v?.bollinger?.bias) || 'neutral';
        const macdBias = normalizeText(v?.macd?.bias) || 'neutral';
        const adxLevel = normalizeText(v?.trend_strength?.level) || 'average';
        const adxBias = normalizeText(v?.trend_strength?.bias) || 'neutral';

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
