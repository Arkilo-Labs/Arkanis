function splitLines(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

function extractJsonObject(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(raw.slice(start, end + 1));
    } catch {
        return null;
    }
}

function pickHeading(lines) {
    for (const line of lines) {
        const match = line.match(/^#{1,4}\s+(.+)$/);
        if (match) return match[1].trim();
    }
    return '';
}

function pickKeySentences(lines) {
    const result = [];
    const keywords = ['立场', '结论', '风险', '建议', '信号', '观点'];
    for (const line of lines) {
        if (line.startsWith('#')) continue;
        if (!keywords.some((key) => line.includes(key))) continue;
        result.push(line.replace(/^[-*+]\s+/, '').slice(0, 120));
        if (result.length >= 2) break;
    }
    return result;
}

function pickBullets(lines) {
    const result = [];
    for (const line of lines) {
        const bullet = line.match(/^[-*+]\s+(.+)$/);
        if (!bullet) continue;
        const value = bullet[1].trim();
        if (value.length < 12) continue;
        if (/^(补充|说明|备注|注意|总结)/.test(value)) continue;
        result.push(value.slice(0, 120));
        if (result.length >= 2) break;
    }
    return result;
}

function buildDecisionLines(json) {
    if (!json || typeof json !== 'object') return [];
    const lines = [];
    if (json.consensus !== undefined) lines.push(`共识: ${json.consensus ? '已达成' : '未达成'}`);
    if (json.signal != null) lines.push(`信号: ${String(json.signal)}`);
    if (json.direction != null) lines.push(`方向: ${String(json.direction)}`);
    if (json.confidence != null) {
        const num = Number(json.confidence);
        lines.push(Number.isFinite(num) ? `置信度: ${(num * 100).toFixed(0)}%` : `置信度: ${String(json.confidence)}`);
    }
    if (json.next_speaker != null) lines.push(`下一位: ${String(json.next_speaker)}`);
    return lines.slice(0, 4);
}

function detectDebateTags(text) {
    const source = String(text || '');
    const tags = [];
    if (/质疑|反驳|不同意|矛盾|冲突/i.test(source)) tags.push('争论节点');
    if (/风险|止损|失效|invalid/i.test(source)) tags.push('风险提示');
    if (/共识|consensus/i.test(source)) tags.push('共识进展');
    return tags;
}

export function summarizeTranscriptEntry(entry) {
    const text = String(entry?.text || '');
    const lines = splitLines(text);
    const heading = pickHeading(lines);
    const embeddedJson = extractJsonObject(text);
    const decisionLines = buildDecisionLines(embeddedJson);

    const highlights = [];
    for (const line of decisionLines) highlights.push(line);

    if (highlights.length < 3) {
        for (const line of pickKeySentences(lines)) {
            if (!highlights.includes(line)) highlights.push(line);
            if (highlights.length >= 3) break;
        }
    }

    if (highlights.length < 3) {
        for (const line of pickBullets(lines)) {
            if (!highlights.includes(line)) highlights.push(line);
            if (highlights.length >= 3) break;
        }
    }

    const title =
        heading || (decisionLines.length ? '决策更新' : entry?.role ? `${entry.role} 发言` : '发言摘要');
    const tags = detectDebateTags(text);

    return {
        title,
        highlights: highlights.slice(0, 3),
        tags,
        isDebateNode: tags.includes('争论节点'),
        decision: embeddedJson,
    };
}

