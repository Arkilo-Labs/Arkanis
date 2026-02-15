function ema(values, period) {
    const p = Math.max(1, Math.floor(period));
    const k = 2 / (p + 1);
    let prev = values[0];
    const out = [prev];
    for (let i = 1; i < values.length; i++) {
        const v = values[i];
        prev = v * k + prev * (1 - k);
        out.push(prev);
    }
    return out;
}

export function computeRsi(closes, period = 14) {
    const p = Math.max(1, Math.floor(period));
    if (!Array.isArray(closes) || closes.length < p + 1) return null;

    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= p; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gainSum += diff;
        else lossSum += -diff;
    }

    let avgGain = gainSum / p;
    let avgLoss = lossSum / p;
    for (let i = p + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (p - 1) + gain) / p;
        avgLoss = (avgLoss * (p - 1) + loss) / p;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

export function computeMacd(closes, fast = 12, slow = 26, signal = 9) {
    if (!Array.isArray(closes) || closes.length < slow + signal + 2) return null;
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
    const signalLine = ema(macdLine, signal);
    const hist = macdLine.map((v, i) => v - signalLine[i]);
    const last = closes.length - 1;
    return {
        macd: macdLine[last],
        signal: signalLine[last],
        hist: hist[last],
    };
}

