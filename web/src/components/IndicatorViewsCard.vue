<script setup>
import { computed } from 'vue';

const props = defineProps({
  views: {
    type: Object,
    default: null
  },
  title: {
    type: String,
    default: '指标观点'
  }
});

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

const items = computed(() => {
  const v = props.views || {};

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
      note: v?.macd?.note || ''
    },
    {
      key: 'boll',
      name: '布林带',
      right: biasLabel(bollBias),
      badgeClass: badgeClassByBias(bollBias),
      note: v?.bollinger?.note || ''
    },
    {
      key: 'trend',
      name: '趋势强度',
      right: `${strengthLabel(adxLevel)} · ${biasLabel(adxBias)}`,
      badgeClass: 'iv-badge iv-badge--purple',
      note: v?.trend_strength?.note || ''
    },
    {
      key: 'overall',
      name: '综合倾向',
      right: biasLabel(overallBias),
      badgeClass: badgeClassByBias(overallBias),
      note: ''
    }
  ];
});
</script>

<template>
  <div
    v-if="views"
    class="glass-card iv-card overflow-hidden"
    style="--glass-bg: rgba(5, 6, 12, 0.72); --glass-border: rgba(255, 255, 255, 0.08)"
  >
    <div class="px-6 pt-5 pb-4 border-b border-white/5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <i class="fas fa-chart-line text-white/55 text-sm"></i>
          <span class="text-label text-white/80">{{ title }}</span>
        </div>
        <span class="text-xs text-white/25">AI 观点</span>
      </div>
    </div>

    <div class="divide-y divide-white/5">
      <div v-for="item in items" :key="item.key" class="px-6 py-4 iv-row">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-white/70 tracking-wide">{{ item.name }}</span>
          <span :class="item.badgeClass">{{ item.right }}</span>
        </div>
        <div v-if="item.note" class="mt-2 text-xs text-white/35 leading-relaxed line-clamp-2">
          {{ item.note }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.iv-card {
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* 压暗 glass-card 的高光效果，避免整块发灰 */
.iv-card.glass-card::before,
.iv-card.glass-card::after {
  opacity: 0;
}

.iv-row {
  transition: background 160ms ease, transform 160ms ease;
}

.iv-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.iv-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
}

.iv-badge--bullish {
  background: rgba(52, 199, 89, 0.14);
  border-color: rgba(52, 199, 89, 0.22);
  color: rgba(120, 255, 170, 0.9);
}

.iv-badge--bearish {
  background: rgba(255, 59, 48, 0.14);
  border-color: rgba(255, 59, 48, 0.22);
  color: rgba(255, 140, 135, 0.92);
}

.iv-badge--neutral {
  background: rgba(90, 200, 250, 0.12);
  border-color: rgba(90, 200, 250, 0.18);
  color: rgba(150, 225, 255, 0.9);
}

.iv-badge--purple {
  background: rgba(175, 82, 222, 0.14);
  border-color: rgba(175, 82, 222, 0.22);
  color: rgba(224, 174, 255, 0.92);
}
</style>
