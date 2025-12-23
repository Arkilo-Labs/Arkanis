export const CREDIT_UNIT_SCALE = 100; // 0.01

export function creditsToUnits(credits) {
    const n = Number(credits);
    if (!Number.isFinite(n) || n < 0) throw new Error('credit 无效');
    return Math.round(n * CREDIT_UNIT_SCALE);
}

export function unitsToCredits(units) {
    const n = Number(units);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n) / CREDIT_UNIT_SCALE;
}

export function planMonthlyAllowanceUnits(planCode) {
    const code = String(planCode || '').trim().toLowerCase();
    if (code === 'free') return 10 * CREDIT_UNIT_SCALE;
    if (code === 'monthly') return 300 * CREDIT_UNIT_SCALE;
    if (code === 'quarterly') return 400 * CREDIT_UNIT_SCALE;
    if (code === 'yearly' || code === 'annual') return 500 * CREDIT_UNIT_SCALE;
    return 0;
}

export function computeChargeUnits({ baseUnits, multiplierX100 }) {
    const base = Number(baseUnits);
    const mul = Number(multiplierX100);
    if (!Number.isFinite(base) || base <= 0) throw new Error('baseUnits 无效');
    if (!Number.isFinite(mul) || mul <= 0) throw new Error('multiplier 无效');
    return Math.max(1, Math.round((base * mul) / 100));
}

function daysInMonthUtc(year, month0) {
    return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function addMonthsKeepDayUtc(date, months, anchorDay) {
    const d = new Date(date.getTime());
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const targetMonth0 = m + Number(months);
    const targetYear = y + Math.floor(targetMonth0 / 12);
    const normalizedMonth0 = ((targetMonth0 % 12) + 12) % 12;
    const dim = daysInMonthUtc(targetYear, normalizedMonth0);
    const day = Math.min(Number(anchorDay), dim);
    return new Date(Date.UTC(targetYear, normalizedMonth0, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

export function computeMonthlyWindowUtc({ subscriptionStart, now, anchorDay }) {
    const start = new Date(subscriptionStart);
    const current = new Date(now);
    let periodStart = start;
    let periodEnd = addMonthsKeepDayUtc(periodStart, 1, anchorDay);

    // 可能订阅很久之前开始，滚动到当前周期
    while (current.getTime() >= periodEnd.getTime()) {
        periodStart = periodEnd;
        periodEnd = addMonthsKeepDayUtc(periodStart, 1, anchorDay);
    }

    return { periodStart, periodEnd };
}
