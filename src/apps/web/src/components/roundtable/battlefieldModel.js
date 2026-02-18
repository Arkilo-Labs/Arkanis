function normalizeDirection(value) {
    const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return text;
}

export function campFromDirection(direction) {
    const dir = normalizeDirection(direction);
    if (dir === 'LONG' || dir === 'BULL') return 'BULL';
    if (dir === 'SHORT' || dir === 'BEAR') return 'BEAR';
    if (dir === 'WAIT') return 'NEUTRAL';
    return 'NEUTRAL';
}

export function computeLatestBeliefs(beliefUpdates) {
    const list = Array.isArray(beliefUpdates) ? beliefUpdates : [];
    const byAgent = new Map();

    for (const item of list) {
        const source = typeof item?.source === 'string' ? item.source.trim() : '';
        if (!source) continue;
        byAgent.set(source, item);
    }

    return byAgent;
}

export function inferBattlePhase({ hasLeader, hasDraftDecision, bullCount, bearCount, agentCount }) {
    const agents = Math.max(0, Number(agentCount) || 0);
    const bulls = Math.max(0, Number(bullCount) || 0);
    const bears = Math.max(0, Number(bearCount) || 0);

    const polarized = bulls > 0 && bears > 0 && bulls + bears >= Math.min(4, Math.max(2, agents));
    if (polarized) return 'duel';
    if (hasDraftDecision || hasLeader) return 'synthesis';
    return 'gathering';
}

export function pickWinnerSideFromDecision(decision) {
    const json = decision?.json && typeof decision.json === 'object' ? decision.json : null;
    const direction = normalizeDirection(json?.direction);

    if (direction.includes('LONG') || direction.includes('BULL')) return 'LEFT';
    if (direction.includes('SHORT') || direction.includes('BEAR')) return 'RIGHT';
    return null;
}

