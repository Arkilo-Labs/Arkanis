import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import LogTerminal from '../LogTerminal.jsx';
import MarkdownView, { renderInlineMarkdown } from './MarkdownView.jsx';
import { summarizeTranscriptEntry } from './summaryRules.js';
import { campFromDirection, computeLatestBeliefs, inferBattlePhase, pickWinnerSideFromDecision } from './battlefieldModel.js';

const SESSION_STATUS_META = Object.freeze({
    running: { label: '运行中', className: 'badge-accent', icon: 'fa-spinner fa-spin' },
    completed: { label: '已完成', className: 'badge-success', icon: 'fa-circle-check' },
    failed: { label: '失败', className: 'badge-error', icon: 'fa-circle-xmark' },
    killed: { label: '已终止', className: 'badge-muted', icon: 'fa-hand' },
    incomplete: { label: '不完整', className: 'badge-muted', icon: 'fa-circle-question' },
});

const PHASE_LABEL = Object.freeze({
    opening: '开场',
    chair: '主席',
    discussion: '讨论',
    finalize: '收敛',
    summary: '总结',
    history: '历史',
    cross_examination: '质询',
    rebuttal: '反驳',
});

function normalizeTimestamp(value) {
    const ts = Number(value);
    if (Number.isFinite(ts) && ts > 0) return ts;
    return Date.now();
}

function formatTimestamp(value) {
    const ts = normalizeTimestamp(value);
    return new Date(ts).toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function normalizeEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list
        .map((item, index) => ({
            ...item,
            _index: index,
            timestamp: normalizeTimestamp(item?.timestamp),
        }))
        .sort((left, right) => {
            if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
            return left._index - right._index;
        });
}

function buildEntryKey(entry) {
    if (entry?.seq != null && entry.seq !== '') return `seq_${entry.seq}`;
    return [
        entry.name || 'agent',
        entry.turn ?? 'turn',
        entry.phase || 'phase',
        entry.timestamp || 'time',
        entry._index ?? 'idx',
    ].join('__');
}

function isMobileViewport() {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
}

function anchorPoint(node, containerRect) {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.left)) return null;

    const side = node.dataset?.side || '';
    const midY = rect.top + rect.height / 2;
    const centerX = rect.left + rect.width / 2;

    if (side === 'LEFT') {
        return { x: rect.right - containerRect.left, y: midY - containerRect.top };
    }
    if (side === 'RIGHT') {
        return { x: rect.left - containerRect.left, y: midY - containerRect.top };
    }

    return { x: centerX - containerRect.left, y: midY - containerRect.top };
}

function buildBezierPath(a, b) {
    if (!a || !b) return '';
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);

    const pull = Math.min(260, Math.max(90, dx * 0.55 + dy * 0.1));
    const dir = a.x < b.x ? 1 : -1;
    const c1 = { x: a.x + pull * dir, y: a.y };
    const c2 = { x: b.x - pull * dir, y: b.y };

    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function buildArenaPositions(count, radius = 34) {
    const total = Math.max(1, count);
    const points = [];
    for (let i = 0; i < total; i += 1) {
        const angle = (Math.PI * 2 * i) / total - Math.PI / 2;
        points.push({
            x: 50 + Math.cos(angle) * radius,
            y: 50 + Math.sin(angle) * radius,
        });
    }
    return points;
}

function buildSynthesisPositions(count) {
    const total = Math.max(1, count);
    if (total === 1) return [{ x: 50, y: 35 }];

    const leader = { x: 50, y: 22 };
    const followers = total - 1;
    const points = [leader];

    const center = { x: 50, y: 74 };
    const radius = { x: 34, y: 18 };
    const startAngle = Math.PI * 1.08;
    const endAngle = -Math.PI * 0.08;

    for (let i = 0; i < followers; i += 1) {
        const t = followers === 1 ? 0.5 : i / (followers - 1);
        const angle = startAngle + (endAngle - startAngle) * t;
        points.push({
            x: center.x + Math.cos(angle) * radius.x,
            y: center.y + Math.sin(angle) * radius.y,
        });
    }

    return points;
}

export default function RoundtableBattlefield({
    entries,
    beliefUpdates,
    toolCalls,
    decisions,
    processExit,
    logs,
    isRunning,
    finalDecision,
    draftDecision,
    counts = null,
}) {
    const battlefieldRef = useRef(null);
    const feedRef = useRef(null);
    const messageRefs = useRef(new Map());
    const agentRefs = useRef(new Map());
    const arenaRefs = useRef(new Map());
    const vectorRecalcRaf = useRef(0);
    const prevAttackIdsRef = useRef(new Set());

    const [autoScroll, setAutoScroll] = useState(true);
    const [expanded, setExpanded] = useState({});
    const [vectorPaths, setVectorPaths] = useState([]);
    const [impactMap, setImpactMap] = useState({});
    const [hideFinalOverlay, setHideFinalOverlay] = useState(false);
    const [terminalOpen, setTerminalOpen] = useState(false);

    const normalizedEntries = useMemo(() => normalizeEntries(entries), [entries]);
    const latestBeliefs = useMemo(() => computeLatestBeliefs(beliefUpdates), [beliefUpdates]);

    const leaderName = useMemo(() => {
        const speaker =
            String(finalDecision?.speaker || '').trim() ||
            String(draftDecision?.speaker || '').trim();
        if (speaker) return speaker;

        for (let i = normalizedEntries.length - 1; i >= 0; i -= 1) {
            const entry = normalizedEntries[i];
            const phase = String(entry?.phase || '').trim();
            if (phase === 'chair' || phase === 'finalize') {
                const name = String(entry?.name || '').trim();
                return name || null;
            }
        }

        return null;
    }, [draftDecision?.speaker, finalDecision?.speaker, normalizedEntries]);

    const agents = useMemo(() => {
        const byName = new Map();

        for (const entry of normalizedEntries) {
            const name = String(entry?.name || '').trim();
            if (!name) continue;

            const current = byName.get(name);
            const next = {
                name,
                role: String(entry?.role || '').trim(),
                provider: String(entry?.provider || '').trim(),
                speakCount: (current?.speakCount || 0) + 1,
                lastTurn: entry?.turn ?? null,
                lastPhase: String(entry?.phase || '').trim(),
                lastTimestamp: entry.timestamp,
                firstTimestamp: current?.firstTimestamp ?? entry.timestamp,
            };

            if (!next.role && current?.role) next.role = current.role;
            if (!next.provider && current?.provider) next.provider = current.provider;
            byName.set(name, next);
        }

        return Array.from(byName.values()).sort((a, b) => a.firstTimestamp - b.firstTimestamp);
    }, [normalizedEntries]);

    const agentStates = useMemo(() => {
        const list = agents.map((agent) => {
            const belief = latestBeliefs.get(agent.name);
            const direction = typeof belief?.direction === 'string' ? belief.direction : '';
            const confidence = Number(belief?.confidence);
            const camp = campFromDirection(direction);

            return {
                ...agent,
                camp,
                direction,
                confidence: Number.isFinite(confidence) ? confidence : null,
                posteriors: belief?.posteriors && typeof belief.posteriors === 'object' ? belief.posteriors : null,
                beliefTurn: belief?.turn ?? null,
                beliefUpdatedAt: belief?.timestamp ?? null,
            };
        });

        const latestEntry = normalizedEntries.length ? normalizedEntries[normalizedEntries.length - 1] : null;
        const latestName = String(latestEntry?.name || '').trim();

        return list.map((agent) => {
            let status = 'waiting';
            if (!isRunning && agent.speakCount > 0) {
                status = 'done';
            } else if (isRunning && latestName && latestName === agent.name) {
                status = 'speaking';
            }
            return { ...agent, status };
        });
    }, [agents, isRunning, latestBeliefs, normalizedEntries]);

    const bullAgents = useMemo(
        () => agentStates.filter((a) => a.camp === 'BULL'),
        [agentStates],
    );
    const bearAgents = useMemo(
        () => agentStates.filter((a) => a.camp === 'BEAR'),
        [agentStates],
    );

    const battlePhase = useMemo(() => {
        return inferBattlePhase({
            hasLeader: Boolean(leaderName),
            hasDraftDecision: Boolean(draftDecision),
            bullCount: bullAgents.length,
            bearCount: bearAgents.length,
            agentCount: agentStates.length,
        });
    }, [bearAgents.length, bullAgents.length, draftDecision, leaderName, agentStates.length]);

    const winnerSide = useMemo(() => pickWinnerSideFromDecision(finalDecision), [finalDecision]);

    const phaseBadges = useMemo(() => {
        if (battlePhase === 'duel') return { label: 'Phase 3 · Duel', className: 'badge-error' };
        if (battlePhase === 'synthesis') return { label: 'Phase 2 · Synthesis', className: 'badge-accent' };
        return { label: 'Phase 1 · Gathering', className: 'badge-muted' };
    }, [battlePhase]);

    const arenaAgents = useMemo(() => {
        if (battlePhase === 'gathering') return agentStates.slice(0, 6);
        if (battlePhase === 'synthesis') {
            const leader = String(leaderName || '').trim();
            if (!leader) return agentStates.slice(0, 6);

            const leaderAgent = agentStates.find((a) => a.name === leader);
            const followers = agentStates.filter((a) => a.name !== leader).slice(0, 5);
            if (!leaderAgent) return agentStates.slice(0, 6);
            return [leaderAgent, ...followers];
        }
        return [];
    }, [agentStates, battlePhase, leaderName]);

    const arenaPositions = useMemo(() => {
        if (battlePhase === 'synthesis') return buildSynthesisPositions(arenaAgents.length || 1);
        return buildArenaPositions(arenaAgents.length || 1);
    }, [arenaAgents.length, battlePhase]);

    const messageItems = useMemo(() => {
        const campByName = new Map(agentStates.map((a) => [a.name, a.camp]));
        const leader = String(leaderName || '').trim();

        return normalizedEntries.map((entry) => {
            const key = buildEntryKey(entry);
            const name = String(entry?.name || '').trim();
            const phaseKey = String(entry?.phase || '').trim();
            const camp = name ? campByName.get(name) || 'NEUTRAL' : 'NEUTRAL';

            let side = 'CENTER';
            if (battlePhase === 'duel') {
                if (phaseKey === 'chair' || phaseKey === 'finalize' || phaseKey === 'summary') {
                    side = 'CENTER';
                } else if (leader && name === leader && phaseKey !== 'opening') {
                    side = 'CENTER';
                } else if (camp === 'BULL') {
                    side = 'LEFT';
                } else if (camp === 'BEAR') {
                    side = 'RIGHT';
                }
            }

            const summary = summarizeTranscriptEntry(entry);
            return {
                entry,
                key,
                name,
                phaseKey,
                phaseLabel: PHASE_LABEL[phaseKey] || (phaseKey ? phaseKey : '未知'),
                side,
                camp,
                summary,
            };
        });
    }, [agentStates, battlePhase, leaderName, normalizedEntries]);

    const vectorSpecs = useMemo(() => {
        const byAgentTurn = new Map();
        const lastByAgent = new Map();
        const specs = [];

        for (const item of messageItems) {
            const name = item.name;
            if (!name) continue;
            const turn = item.entry?.turn;
            const key = item.key;
            if (turn != null && turn !== '') {
                byAgentTurn.set(`${name}__${turn}`, key);
            }
            lastByAgent.set(name, key);
        }

        const recentAttack = messageItems
            .filter((item) => item.entry?.relation === 'attack' && item.entry?.target)
            .slice(-18);

        for (const item of recentAttack) {
            const sourceKey = item.key;
            const targetName = String(item.entry?.target || '').trim();
            const targetTurn = item.entry?.targetTurn ?? null;
            if (!targetName) continue;

            let targetKey = null;
            if (targetTurn !== null && targetTurn !== undefined && targetTurn !== '') {
                targetKey = byAgentTurn.get(`${targetName}__${targetTurn}`) || null;
            }

            targetKey = targetKey || lastByAgent.get(targetName) || `agent:${targetName}`;

            specs.push({
                id: `${sourceKey}=>${targetKey}`,
                type: 'ATTACK',
                intensity: 0.85,
                sourceKey,
                targetKey,
            });
        }

        if (battlePhase === 'duel') {
            let lastLeft = null;
            let lastRight = null;
            const heuristic = [];

            for (const item of messageItems) {
                if (item.side === 'LEFT') {
                    const hasExplicitAttack =
                        item.entry?.relation === 'attack' && Boolean(item.entry?.target);
                    if (!hasExplicitAttack && item.summary?.isDebateNode && lastRight) {
                        heuristic.push({
                            id: `heur:${item.key}=>${lastRight}`,
                            type: 'ATTACK',
                            intensity: 0.65,
                            sourceKey: item.key,
                            targetKey: lastRight,
                        });
                    }
                    lastLeft = item.key;
                } else if (item.side === 'RIGHT') {
                    const hasExplicitAttack =
                        item.entry?.relation === 'attack' && Boolean(item.entry?.target);
                    if (!hasExplicitAttack && item.summary?.isDebateNode && lastLeft) {
                        heuristic.push({
                            id: `heur:${item.key}=>${lastLeft}`,
                            type: 'ATTACK',
                            intensity: 0.65,
                            sourceKey: item.key,
                            targetKey: lastLeft,
                        });
                    }
                    lastRight = item.key;
                }
            }

            specs.push(...heuristic.slice(-10));
        }

        const bullNames = bullAgents.map((a) => a.name);
        const bearNames = bearAgents.map((a) => a.name);

        if (battlePhase === 'duel') {
            for (let i = 0; i < bullNames.length - 1; i += 1) {
                specs.push({
                    id: `support:bull:${bullNames[i]}=>${bullNames[i + 1]}`,
                    type: 'SUPPORT',
                    intensity: 0.45,
                    sourceKey: `agent:${bullNames[i]}`,
                    targetKey: `agent:${bullNames[i + 1]}`,
                });
            }

            for (let i = 0; i < bearNames.length - 1; i += 1) {
                specs.push({
                    id: `support:bear:${bearNames[i]}=>${bearNames[i + 1]}`,
                    type: 'SUPPORT',
                    intensity: 0.45,
                    sourceKey: `agent:${bearNames[i]}`,
                    targetKey: `agent:${bearNames[i + 1]}`,
                });
            }
        }

        if (battlePhase === 'synthesis' && leaderName) {
            const leader = String(leaderName).trim();
            for (const agent of agentStates) {
                if (!agent?.name || agent.name === leader) continue;
                specs.push({
                    id: `support:leader:${leader}=>${agent.name}`,
                    type: 'SUPPORT',
                    intensity: 0.35,
                    sourceKey: `agent:${leader}`,
                    targetKey: `agent:${agent.name}`,
                });
            }
        }

        return specs.slice(-32);
    }, [agentStates, battlePhase, bearAgents, bullAgents, leaderName, messageItems]);

    const recomputeVector = useCallback(() => {
        const container = battlefieldRef.current;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        const nextPaths = [];
        const resolveAgentNode = (name) => {
            if (!name) return null;
            if (battlePhase === 'duel') return agentRefs.current.get(name);
            return arenaRefs.current.get(name) || agentRefs.current.get(name);
        };

        for (const spec of vectorSpecs) {
            const sourceNode = spec.sourceKey.startsWith('agent:')
                ? resolveAgentNode(spec.sourceKey.slice('agent:'.length))
                : messageRefs.current.get(spec.sourceKey);

            const targetNode = spec.targetKey.startsWith('agent:')
                ? resolveAgentNode(spec.targetKey.slice('agent:'.length))
                : messageRefs.current.get(spec.targetKey);

            const a = anchorPoint(sourceNode, containerRect);
            const b = anchorPoint(targetNode, containerRect);
            if (!a || !b) continue;

            const d = buildBezierPath(a, b);
            if (!d) continue;

            nextPaths.push({ ...spec, d });
        }

        setVectorPaths(nextPaths);
    }, [battlePhase, vectorSpecs]);

    const scheduleVectorRecompute = useCallback(() => {
        if (vectorRecalcRaf.current) return;
        vectorRecalcRaf.current = window.requestAnimationFrame(() => {
            vectorRecalcRaf.current = 0;
            recomputeVector();
        });
    }, [recomputeVector]);

    const scrollToBottom = useCallback((behavior = 'auto') => {
        const node = feedRef.current;
        if (!node) return;
        node.scrollTo({ top: node.scrollHeight, behavior });
    }, []);

    const onScroll = useCallback(() => {
        const node = feedRef.current;
        if (!node) return;

        const remain = node.scrollHeight - node.scrollTop - node.clientHeight;
        const nearBottom = remain <= 56;
        setAutoScroll((prev) => {
            if (nearBottom) return true;
            return prev ? false : prev;
        });
        scheduleVectorRecompute();
    }, [scheduleVectorRecompute]);

    const toggleExpanded = useCallback((key) => {
        setExpanded((prev) => {
            const nextValue = !prev[key];
            if (isMobileViewport()) {
                return nextValue ? { [key]: true } : {};
            }
            return { ...prev, [key]: nextValue };
        });
    }, []);

    useEffect(() => {
        if (!autoScroll) return;
        scrollToBottom();
        scheduleVectorRecompute();
    }, [autoScroll, messageItems.length, scheduleVectorRecompute, scrollToBottom]);

    useEffect(() => {
        function onResize() {
            recomputeVector();
        }

        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [recomputeVector]);

    useLayoutEffect(() => {
        recomputeVector();
    }, [expanded, recomputeVector]);

    useEffect(() => {
        const prev = prevAttackIdsRef.current;
        const next = new Set();
        const impacts = [];

        for (const spec of vectorSpecs) {
            if (spec.type !== 'ATTACK') continue;
            next.add(spec.id);
            if (!prev.has(spec.id)) {
                impacts.push(spec.targetKey);
            }
        }

        prevAttackIdsRef.current = next;
        if (!impacts.length) return;

        const now = Date.now();
        setImpactMap((prevMap) => {
            const updated = { ...prevMap };
            for (const key of impacts) {
                updated[key] = now;
            }
            return updated;
        });
    }, [vectorSpecs]);

    useEffect(() => {
        if (!Object.keys(impactMap).length) return;
        const timer = window.setTimeout(() => {
            const now = Date.now();
            setImpactMap((prevMap) => {
                const nextMap = {};
                for (const [key, ts] of Object.entries(prevMap)) {
                    if (now - ts < 700) nextMap[key] = ts;
                }
                return nextMap;
            });
        }, 720);

        return () => window.clearTimeout(timer);
    }, [impactMap]);

    useEffect(() => {
        if (!finalDecision) setHideFinalOverlay(false);
    }, [finalDecision]);

    const isImpacted = useCallback(
        (key) => {
            const ts = impactMap[key];
            if (!ts) return false;
            return Date.now() - ts < 650;
        },
        [impactMap],
    );

    const traceItems = useMemo(() => {
        const items = [];

        const push = (payload) => {
            if (!payload) return;
            items.push(payload);
        };

        const clamp = (value, maxLen = 140) => {
            const text = String(value || '').trim();
            if (!text) return '';
            if (text.length <= maxLen) return text;
            return `${text.slice(0, maxLen - 1)}…`;
        };

        const toolList = Array.isArray(toolCalls) ? toolCalls : [];
        for (const ev of toolList.slice(-120)) {
            const stage = String(ev?.stage || '').trim();
            const agent = String(ev?.agent || '').trim();
            const turn = ev?.turn != null ? `#${ev.turn}` : '';
            const when = normalizeTimestamp(ev?.timestamp);

            if (stage === 'request') {
                const names = Array.isArray(ev?.calls) ? ev.calls.map((c) => c?.name).filter(Boolean) : [];
                push({
                    id: `tool:${ev.seq ?? when}:request`,
                    timestamp: when,
                    level: 'info',
                    title: `${agent || 'agent'} ${turn} 请求工具`,
                    detail: names.length ? names.join(', ') : '未知工具',
                });
                continue;
            }

            if (stage === 'result') {
                const results = Array.isArray(ev?.results) ? ev.results : [];
                const summary = results
                    .map((r) => {
                        const name = String(r?.tool || '').trim();
                        const ok = r?.ok === false ? 'err' : 'ok';
                        return name ? `${name}(${ok})` : null;
                    })
                    .filter(Boolean)
                    .slice(0, 4)
                    .join(', ');

                push({
                    id: `tool:${ev.seq ?? when}:result`,
                    timestamp: when,
                    level: results.some((r) => r?.ok === false) ? 'error' : 'success',
                    title: `${agent || 'agent'} ${turn} 工具结果`,
                    detail: summary || '无摘要',
                });
                continue;
            }

            if (stage === 'skipped') {
                const note = clamp(ev?.note || '工具调用已跳过');
                push({
                    id: `tool:${ev.seq ?? when}:skipped`,
                    timestamp: when,
                    level: 'warn',
                    title: `${agent || 'agent'} ${turn} 工具跳过`,
                    detail: note,
                });
                continue;
            }

            if (stage === 'error') {
                const errorText = clamp(ev?.error || '工具调用失败');
                push({
                    id: `tool:${ev.seq ?? when}:error`,
                    timestamp: when,
                    level: 'error',
                    title: `${agent || 'agent'} ${turn} 工具错误`,
                    detail: errorText,
                });
                continue;
            }
        }

        const beliefList = Array.isArray(beliefUpdates) ? beliefUpdates : [];
        for (const ev of beliefList.slice(-120)) {
            const agent = String(ev?.source || '').trim();
            const dir = String(ev?.direction || '').trim();
            const conf = Number(ev?.confidence);
            const when = normalizeTimestamp(ev?.timestamp);
            if (!agent || !dir) continue;

            push({
                id: `belief:${ev.seq ?? when}`,
                timestamp: when,
                level: 'info',
                title: `${agent} 信念更新`,
                detail: Number.isFinite(conf) ? `${dir} · ${(conf * 100).toFixed(0)}%` : `${dir}`,
            });
        }

        const decisionList = Array.isArray(decisions) ? decisions : [];
        for (const ev of decisionList.slice(-80)) {
            const stage = String(ev?.stage || '').trim();
            const json = ev?.json && typeof ev.json === 'object' ? ev.json : null;
            const dir = json?.direction != null ? String(json.direction) : '';
            const signal = json?.signal != null ? String(json.signal) : '';
            const speaker = String(ev?.speaker || '').trim();
            const when = normalizeTimestamp(ev?.timestamp);

            if (!stage) continue;
            push({
                id: `decision:${ev.seq ?? when}`,
                timestamp: when,
                level: stage === 'final' ? 'success' : 'info',
                title: `${speaker || 'leader'} 决策${stage === 'final' ? '最终' : '草案'}`,
                detail: clamp([signal, dir].filter(Boolean).join(' · ') || '无结构信息'),
            });
        }

        if (processExit) {
            const code = processExit.code ?? null;
            const signal = processExit.signal ? String(processExit.signal) : '';
            const when = normalizeTimestamp(processExit.timestamp);

            push({
                id: `exit:${processExit.seq ?? when}`,
                timestamp: when,
                level: code === 0 ? 'success' : 'error',
                title: '进程退出',
                detail: clamp(
                    [
                        code === null ? 'code=--' : `code=${code}`,
                        signal ? `signal=${signal}` : null,
                        processExit.killRequested ? 'killed=1' : null,
                    ]
                        .filter(Boolean)
                        .join(' '),
                ),
            });
        }

        const logList = Array.isArray(logs) ? logs : [];
        const errorLike = (text) => {
            const value = String(text || '');
            return /\[ERROR\]|\bERROR\b|\bError\b|\bUnhandled\b|异常|失败|Traceback/i.test(value);
        };

        let stderrIndex = 0;
        for (const ev of logList.slice(-240)) {
            if (ev?.type === 'stderr' || ev?.type === 'error' || errorLike(ev?.data)) {
                push({
                    id: `stderr:${ev.timestamp}:${stderrIndex++}`,
                    timestamp: normalizeTimestamp(ev?.timestamp),
                    level: 'error',
                    title: '终端错误',
                    detail: clamp(ev?.data, 180),
                });
            }
        }

        items.sort((a, b) => {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return String(a.id).localeCompare(String(b.id));
        });

        return items.slice(-90);
    }, [beliefUpdates, decisions, logs, processExit, toolCalls]);

    const leftAgents = battlePhase === 'duel' ? bullAgents : agentStates;
    const rightAgents = battlePhase === 'duel' ? bearAgents : [];

    const winnerClass =
        finalDecision && !hideFinalOverlay && winnerSide
            ? winnerSide === 'LEFT'
                ? 'rt-bf-win-left'
                : 'rt-bf-win-right'
            : '';

    return (
        <section
            ref={battlefieldRef}
            className={['rt-battlefield', winnerClass].filter(Boolean).join(' ')}
        >
            <div className="rt-bf-layer rt-bf-background" aria-hidden="true"></div>
            <div className="rt-bf-layer rt-bf-divider" aria-hidden="true"></div>

            <div className="rt-bf-layer rt-bf-vectors" aria-hidden="true">
                <svg className="rt-bf-svg" width="100%" height="100%">
                    {vectorPaths.map((path) => (
                        <path
                            key={path.id}
                            d={path.d}
                            className={
                                path.type === 'ATTACK'
                                    ? 'rt-bf-line rt-bf-line-attack'
                                    : 'rt-bf-line rt-bf-line-support'
                            }
                            style={{
                                strokeWidth:
                                    path.type === 'ATTACK'
                                        ? 1.2 + path.intensity
                                        : 0.8 + path.intensity * 0.6,
                            }}
                        />
                    ))}
                </svg>
            </div>

            <div className="rt-bf-layer rt-bf-ui">
                <header className="rt-bf-header">
                    <div className="min-w-0">
                        <div className="text-xs tracking-wide text-text-muted">Battlefield</div>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className={['badge', phaseBadges.className].join(' ')}>
                                <i className="fas fa-chess-rook"></i>
                                {phaseBadges.label}
                            </span>
                            {leaderName ? (
                                <span className="badge badge-muted">
                                    <i className="fas fa-crown"></i>
                                    Leader {leaderName}
                                </span>
                            ) : null}
                            <span className={['badge', autoScroll ? 'badge-success' : 'badge-muted'].join(' ')}>
                                <i className={['fas', autoScroll ? 'fa-arrows-down-to-line' : 'fa-hand'].join(' ')}></i>
                                {autoScroll ? '自动滚动' : '手动查看'}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {counts ? (
                            <>
                                <span className="badge badge-muted">
                                    <i className="fas fa-user"></i>
                                    发言 {counts.speaks ?? 0}
                                </span>
                                <span className="badge badge-muted">
                                    <i className="fas fa-wrench"></i>
                                    工具 {counts.tools ?? 0}
                                </span>
                                <span className="badge badge-muted">
                                    <i className="fas fa-chart-line"></i>
                                    信念 {counts.beliefs ?? 0}
                                </span>
                                <span className="badge badge-muted">
                                    <i className="fas fa-gavel"></i>
                                    决策 {counts.decisions ?? 0}
                                </span>
                            </>
                        ) : null}

                        {!autoScroll && messageItems.length ? (
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setAutoScroll(true);
                                    scrollToBottom('smooth');
                                }}
                            >
                                <i className="fas fa-arrow-down"></i>
                                回到底部
                            </button>
                        ) : null}
                    </div>
                </header>

                <div className="rt-bf-main">
                    <aside className="rt-bf-sidebar rt-bf-sidebar-left">
                        <div className="rt-bf-sidebar-title">
                            <span className="text-xs tracking-wide text-text-muted">
                                {battlePhase === 'duel' ? 'Bullish Camp' : 'Agents'}
                            </span>
                            <span className="text-xs text-text-muted">
                                {battlePhase === 'duel' ? bullAgents.length : agentStates.length}
                            </span>
                        </div>

                        <div className="rt-bf-panel rt-bf-panel-stats">
                            <div className="rt-bf-panel-title">
                                <span>Stats</span>
                                <span className="text-text-muted">
                                    B {bullAgents.length} / S {bearAgents.length}
                                </span>
                            </div>
                            <div className="rt-bf-panel-grid">
                                <div>
                                    <div className="rt-bf-panel-label">事件</div>
                                    <div className="rt-bf-panel-value">
                                        {messageItems.length}
                                    </div>
                                </div>
                                <div>
                                    <div className="rt-bf-panel-label">阵营</div>
                                    <div className="rt-bf-panel-value">
                                        {battlePhase === 'duel' ? 'duel' : battlePhase}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rt-bf-agent-list scrollbar">
                            {leftAgents.length ? (
                                leftAgents.map((agent) => {
                                    const avatarKey = agent.name;
                                    const impacted = isImpacted(`agent:${avatarKey}`);
                                    const badge =
                                        agent.status === 'speaking'
                                            ? 'badge-accent'
                                            : agent.status === 'done'
                                              ? 'badge-success'
                                              : 'badge-muted';
                                    const campClass =
                                        agent.camp === 'BULL'
                                            ? 'rt-bf-camp-bull'
                                            : agent.camp === 'BEAR'
                                              ? 'rt-bf-camp-bear'
                                              : 'rt-bf-camp-neutral';

                                    return (
                                        <button
                                            key={agent.name}
                                            type="button"
                                            data-side="LEFT"
                                            className={[
                                                'rt-bf-agent-chip',
                                                campClass,
                                                impacted ? 'rt-bf-impact' : '',
                                            ].join(' ')}
                                            ref={(node) => {
                                                const map = agentRefs.current;
                                                if (node) map.set(avatarKey, node);
                                                else map.delete(avatarKey);
                                            }}
                                            onClick={() => {
                                                const key = messageItems
                                                    .slice()
                                                    .reverse()
                                                    .find((item) => item.name === agent.name)?.key;
                                                if (!key) return;
                                                const el = messageRefs.current.get(key);
                                                if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                                            }}
                                        >
                                            <span className={['rt-bf-avatar', campClass].join(' ')}>
                                                {agent.name.slice(0, 1).toUpperCase()}
                                            </span>
                                            <span className="min-w-0 flex-1 text-left">
                                                <span className="rt-bf-agent-name">{agent.name}</span>
                                                <span className="rt-bf-agent-role">{agent.role || '未设置角色'}</span>
                                            </span>
                                            <span className={['badge', badge].join(' ')}>
                                                {agent.direction ? agent.direction : '--'}
                                            </span>
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="rt-bf-empty">
                                    {isRunning ? '等待 Agent 入场...' : '暂无 Agent 数据'}
                                </div>
                            )}
                        </div>

                    </aside>

                    <div className="rt-bf-center">
                        {battlePhase !== 'duel' ? (
                            <div className="rt-bf-formation">
                                <div className="rt-bf-formation-title">
                                    {battlePhase === 'gathering' ? 'The Gathering' : 'The Synthesis'}
                                </div>

                                <div className="rt-bf-arena">
                                    {arenaAgents.map((agent, idx) => {
                                        const pos = arenaPositions[idx] || { x: 50, y: 50 };
                                        const style = {
                                            left: `${pos.x}%`,
                                            top: `${pos.y}%`,
                                        };
                                        const isLeader =
                                            battlePhase === 'synthesis' &&
                                            Boolean(leaderName) &&
                                            agent.name === leaderName;
                                        const campClass =
                                            agent.camp === 'BULL'
                                                ? 'rt-bf-camp-bull'
                                                : agent.camp === 'BEAR'
                                                  ? 'rt-bf-camp-bear'
                                                  : 'rt-bf-camp-neutral';

                                        return (
                                            <div
                                                key={agent.name}
                                                ref={(node) => {
                                                    const map = arenaRefs.current;
                                                    if (node) map.set(agent.name, node);
                                                    else map.delete(agent.name);
                                                }}
                                                className={[
                                                    'rt-bf-arena-node',
                                                    campClass,
                                                    isLeader ? 'rt-bf-arena-leader' : '',
                                                    battlePhase === 'gathering' ? 'rt-bf-halo' : '',
                                                ].join(' ')}
                                                style={style}
                                            >
                                                <div className="rt-bf-arena-name">{agent.name}</div>
                                                <div className="rt-bf-arena-role">{agent.role || '未设置角色'}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}

                        <div className="rt-bf-feed">
                            <div
                                ref={feedRef}
                                onScroll={onScroll}
                                className="rt-bf-feed-scroll scrollbar"
                            >
                                {messageItems.length ? (
                                    messageItems.map((item) => {
                                        const entry = item.entry;
                                        const isFiltered = Boolean(entry.filtered);
                                        const expandedNow = Boolean(expanded[item.key]);
                                        const impacted = isImpacted(item.key);

                                        const bubbleClass =
                                            item.side === 'LEFT'
                                                ? 'rt-bf-bubble-left'
                                                : item.side === 'RIGHT'
                                                  ? 'rt-bf-bubble-right'
                                                  : 'rt-bf-bubble-center';

                                        const campClass =
                                            item.camp === 'BULL'
                                                ? 'rt-bf-camp-bull'
                                                : item.camp === 'BEAR'
                                                  ? 'rt-bf-camp-bear'
                                                  : 'rt-bf-camp-neutral';

                                        return (
                                            <div key={item.key} className="rt-bf-msg-row">
                                                <div className="rt-bf-msg-grid">
                                                    <div className="rt-bf-msg-cell rt-bf-msg-left">
                                                        {item.side === 'LEFT' ? (
                                                            <article
                                                                data-side="LEFT"
                                                                ref={(node) => {
                                                                    const map = messageRefs.current;
                                                                    if (node) map.set(item.key, node);
                                                                    else map.delete(item.key);
                                                                }}
                                                                className={[
                                                                    'rt-bf-bubble',
                                                                    bubbleClass,
                                                                    campClass,
                                                                    impacted ? 'rt-bf-impact' : '',
                                                                ].join(' ')}
                                                            >
                                                                <div className="rt-bf-bubble-head">
                                                                    <span className="rt-bf-bubble-name">{item.name || '未知 Agent'}</span>
                                                                    <span className="rt-bf-bubble-meta">
                                                                        <span className="badge badge-muted">{item.phaseLabel}</span>
                                                                        {entry.relation === 'attack' ? (
                                                                            <span className="badge badge-error">attack</span>
                                                                        ) : null}
                                                                        <span className="rt-bf-time">
                                                                            {formatTimestamp(entry.timestamp)}
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                                <div className="rt-bf-bubble-body">
                                                                    <div className="rt-bf-bubble-title">{item.summary.title}</div>
                                                                    {item.summary.highlights.length ? (
                                                                        <div className="rt-bf-bubble-highlights">
                                                                            {item.summary.highlights.map((line) => (
                                                                                <div
                                                                                    key={line}
                                                                                    className="rt-bf-bubble-line"
                                                                                    dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(line) }}
                                                                                />
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="rt-bf-bubble-muted">暂无摘要</div>
                                                                    )}
                                                                </div>
                                                                <div className="rt-bf-bubble-actions">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-secondary btn-sm"
                                                                        onClick={() => toggleExpanded(item.key)}
                                                                    >
                                                                        <i className={['fas', expandedNow ? 'fa-chevron-up' : 'fa-chevron-down'].join(' ')}></i>
                                                                        {expandedNow ? '收起' : '展开'}
                                                                    </button>
                                                                </div>
                                                                {expandedNow ? (
                                                                    isFiltered ? (
                                                                        <div className="rt-bf-filtered">
                                                                            该发言经审计后被过滤，内容不对外展示。
                                                                        </div>
                                                                    ) : (
                                                                        <div className="rt-bf-full">
                                                                            <MarkdownView markdown={entry.text || ''} />
                                                                        </div>
                                                                    )
                                                                ) : null}
                                                            </article>
                                                        ) : null}
                                                    </div>

                                                    <div className="rt-bf-msg-mid">
                                                        <div className="rt-bf-mid-dot"></div>
                                                    </div>

                                                    <div className="rt-bf-msg-cell rt-bf-msg-right">
                                                        {item.side === 'RIGHT' ? (
                                                            <article
                                                                data-side="RIGHT"
                                                                ref={(node) => {
                                                                    const map = messageRefs.current;
                                                                    if (node) map.set(item.key, node);
                                                                    else map.delete(item.key);
                                                                }}
                                                                className={[
                                                                    'rt-bf-bubble',
                                                                    bubbleClass,
                                                                    campClass,
                                                                    impacted ? 'rt-bf-impact' : '',
                                                                ].join(' ')}
                                                            >
                                                                <div className="rt-bf-bubble-head">
                                                                    <span className="rt-bf-bubble-name">{item.name || '未知 Agent'}</span>
                                                                    <span className="rt-bf-bubble-meta">
                                                                        <span className="badge badge-muted">{item.phaseLabel}</span>
                                                                        {entry.relation === 'attack' ? (
                                                                            <span className="badge badge-error">attack</span>
                                                                        ) : null}
                                                                        <span className="rt-bf-time">
                                                                            {formatTimestamp(entry.timestamp)}
                                                                        </span>
                                                                    </span>
                                                                </div>
                                                                <div className="rt-bf-bubble-body">
                                                                    <div className="rt-bf-bubble-title">{item.summary.title}</div>
                                                                    {item.summary.highlights.length ? (
                                                                        <div className="rt-bf-bubble-highlights">
                                                                            {item.summary.highlights.map((line) => (
                                                                                <div
                                                                                    key={line}
                                                                                    className="rt-bf-bubble-line"
                                                                                    dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(line) }}
                                                                                />
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="rt-bf-bubble-muted">暂无摘要</div>
                                                                    )}
                                                                </div>
                                                                <div className="rt-bf-bubble-actions">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-secondary btn-sm"
                                                                        onClick={() => toggleExpanded(item.key)}
                                                                    >
                                                                        <i className={['fas', expandedNow ? 'fa-chevron-up' : 'fa-chevron-down'].join(' ')}></i>
                                                                        {expandedNow ? '收起' : '展开'}
                                                                    </button>
                                                                </div>
                                                                {expandedNow ? (
                                                                    isFiltered ? (
                                                                        <div className="rt-bf-filtered">
                                                                            该发言经审计后被过滤，内容不对外展示。
                                                                        </div>
                                                                    ) : (
                                                                        <div className="rt-bf-full">
                                                                            <MarkdownView markdown={entry.text || ''} />
                                                                        </div>
                                                                    )
                                                                ) : null}
                                                            </article>
                                                        ) : null}
                                                    </div>

                                                    {item.side === 'CENTER' ? (
                                                        <article
                                                            data-side="CENTER"
                                                            ref={(node) => {
                                                                const map = messageRefs.current;
                                                                if (node) map.set(item.key, node);
                                                                else map.delete(item.key);
                                                            }}
                                                            className={[
                                                                'rt-bf-bubble',
                                                                bubbleClass,
                                                                campClass,
                                                                impacted ? 'rt-bf-impact' : '',
                                                            ].join(' ')}
                                                        >
                                                            <div className="rt-bf-bubble-head">
                                                                <span className="rt-bf-bubble-name">{item.name || '未知 Agent'}</span>
                                                                <span className="rt-bf-bubble-meta">
                                                                    <span className="badge badge-muted">{item.phaseLabel}</span>
                                                                    <span className="rt-bf-time">
                                                                        {formatTimestamp(entry.timestamp)}
                                                                    </span>
                                                                </span>
                                                            </div>
                                                            <div className="rt-bf-bubble-body">
                                                                <div className="rt-bf-bubble-title">{item.summary.title}</div>
                                                                {item.summary.highlights.length ? (
                                                                    <div className="rt-bf-bubble-highlights">
                                                                        {item.summary.highlights.map((line) => (
                                                                            <div
                                                                                key={line}
                                                                                className="rt-bf-bubble-line"
                                                                                dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(line) }}
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="rt-bf-bubble-muted">暂无摘要</div>
                                                                )}
                                                            </div>
                                                            <div className="rt-bf-bubble-actions">
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-secondary btn-sm"
                                                                    onClick={() => toggleExpanded(item.key)}
                                                                >
                                                                    <i className={['fas', expandedNow ? 'fa-chevron-up' : 'fa-chevron-down'].join(' ')}></i>
                                                                    {expandedNow ? '收起' : '展开'}
                                                                </button>
                                                            </div>
                                                            {expandedNow ? (
                                                                isFiltered ? (
                                                                    <div className="rt-bf-filtered">
                                                                        该发言经审计后被过滤，内容不对外展示。
                                                                    </div>
                                                                ) : (
                                                                    <div className="rt-bf-full">
                                                                        <MarkdownView markdown={entry.text || ''} />
                                                                    </div>
                                                                )
                                                            ) : null}
                                                        </article>
                                                    ) : null}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="rt-bf-feed-empty">
                                        {isRunning ? '等待首条发言...' : '尚未收到发言记录'}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <aside className="rt-bf-sidebar rt-bf-sidebar-right">
                        <div className="rt-bf-sidebar-title">
                            <span className="text-xs tracking-wide text-text-muted">
                                {battlePhase === 'duel' ? 'Bearish Camp' : 'Logs'}
                            </span>
                            <span className="text-xs text-text-muted">
                                {battlePhase === 'duel' ? bearAgents.length : ''}
                            </span>
                        </div>

                        <div className="rt-bf-panel rt-bf-panel-logs">
                            <div className="rt-bf-panel-title">
                                <span>Trace</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-text-muted">
                                        {traceItems.length}
                                    </span>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setTerminalOpen(true)}
                                    >
                                        <i className="fas fa-terminal"></i>
                                        终端
                                    </button>
                                </div>
                            </div>
                            <div className="rt-bf-trace-list scrollbar">
                                {traceItems.length ? (
                                    traceItems.map((item) => (
                                        <div
                                            key={item.id}
                                            className={[
                                                'rt-bf-trace-row',
                                                item.level === 'error'
                                                    ? 'rt-bf-trace-error'
                                                    : item.level === 'success'
                                                      ? 'rt-bf-trace-success'
                                                      : item.level === 'warn'
                                                        ? 'rt-bf-trace-warn'
                                                        : '',
                                            ].join(' ')}
                                        >
                                            <div className="rt-bf-trace-head">
                                                <span className="rt-bf-trace-title">{item.title}</span>
                                                <span className="rt-bf-trace-time">
                                                    {formatTimestamp(item.timestamp)}
                                                </span>
                                            </div>
                                            <div className="rt-bf-trace-detail">{item.detail}</div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="rt-bf-empty">
                                        {isRunning ? '等待事件...' : '暂无事件'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {battlePhase === 'duel' ? (
                            <div className="rt-bf-agent-list scrollbar">
                                {rightAgents.length ? (
                                    rightAgents.map((agent) => {
                                        const avatarKey = agent.name;
                                        const impacted = isImpacted(`agent:${avatarKey}`);
                                        const badge =
                                            agent.status === 'speaking'
                                                ? 'badge-accent'
                                                : agent.status === 'done'
                                                  ? 'badge-success'
                                                  : 'badge-muted';
                                        const campClass = 'rt-bf-camp-bear';

                                        return (
                                            <button
                                                key={agent.name}
                                                type="button"
                                                data-side="RIGHT"
                                                className={[
                                                    'rt-bf-agent-chip',
                                                    campClass,
                                                    impacted ? 'rt-bf-impact' : '',
                                                ].join(' ')}
                                                ref={(node) => {
                                                    const map = agentRefs.current;
                                                    if (node) map.set(avatarKey, node);
                                                    else map.delete(avatarKey);
                                                }}
                                                onClick={() => {
                                                    const key = messageItems
                                                        .slice()
                                                        .reverse()
                                                        .find((item) => item.name === agent.name)?.key;
                                                    if (!key) return;
                                                    const el = messageRefs.current.get(key);
                                                    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                                                }}
                                            >
                                                <span className={['rt-bf-avatar', campClass].join(' ')}>
                                                    {agent.name.slice(0, 1).toUpperCase()}
                                                </span>
                                                <span className="min-w-0 flex-1 text-left">
                                                    <span className="rt-bf-agent-name">{agent.name}</span>
                                                    <span className="rt-bf-agent-role">{agent.role || '未设置角色'}</span>
                                                </span>
                                                <span className={['badge', badge].join(' ')}>
                                                    {agent.direction ? agent.direction : '--'}
                                                </span>
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div className="rt-bf-empty">
                                        {isRunning ? '等待对抗阵营...' : '暂无阵营数据'}
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </aside>
                </div>

                {terminalOpen ? (
                    <div
                        className="modal-overlay"
                        onClick={(e) => {
                            if (e.target !== e.currentTarget) return;
                            setTerminalOpen(false);
                        }}
                    >
                        <div className="modal-card p-6 w-full max-w-6xl">
                            <div className="flex items-start justify-between gap-3 mb-4">
                                <div>
                                    <div className="text-xs tracking-wide text-text-muted">Terminal</div>
                                    <div className="text-lg font-semibold mt-1">进程输出</div>
                                    <div className="text-xs text-text-muted mt-1">
                                        仅用于排错，建议优先看 Trace（工具调用/决策/错误）
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setTerminalOpen(false)}
                                >
                                    <i className="fas fa-xmark"></i>
                                    关闭
                                </button>
                            </div>
                            <LogTerminal logs={Array.isArray(logs) ? logs.slice(-420) : []} className="h-[70vh]" />
                        </div>
                    </div>
                ) : null}

                {finalDecision && !hideFinalOverlay ? (
                    <div className="rt-bf-final">
                        <div className="rt-bf-final-card">
                            <div className="rt-bf-final-head">
                                <div>
                                    <div className="text-xs tracking-wide text-text-muted">Final Decision</div>
                                    <div className="text-lg font-semibold mt-1">结算视图</div>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setHideFinalOverlay(true)}
                                >
                                    <i className="fas fa-xmark"></i>
                                    关闭
                                </button>
                            </div>

                            <div className="rt-bf-final-grid">
                                <div className="rt-bf-final-item">
                                    <div className="rt-bf-final-label">方向</div>
                                    <div className="rt-bf-final-value">
                                        {String(finalDecision?.json?.direction || '--')}
                                    </div>
                                </div>
                                <div className="rt-bf-final-item">
                                    <div className="rt-bf-final-label">信号</div>
                                    <div className="rt-bf-final-value">
                                        {String(finalDecision?.json?.signal || '--')}
                                    </div>
                                </div>
                                <div className="rt-bf-final-item">
                                    <div className="rt-bf-final-label">置信度</div>
                                    <div className="rt-bf-final-value">
                                        {finalDecision?.json?.confidence != null
                                            ? `${Math.round(Number(finalDecision.json.confidence) * 100)}%`
                                            : '--'}
                                    </div>
                                </div>
                                <div className="rt-bf-final-item">
                                    <div className="rt-bf-final-label">胜方</div>
                                    <div className="rt-bf-final-value">
                                        {winnerSide === 'LEFT'
                                            ? 'bullish'
                                            : winnerSide === 'RIGHT'
                                              ? 'bearish'
                                              : '--'}
                                    </div>
                                </div>
                            </div>

                            {Array.isArray(finalDecision?.json?.rationale) && finalDecision.json.rationale.length ? (
                                <div className="rt-bf-final-notes">
                                    {finalDecision.json.rationale.slice(0, 3).map((line, idx) => (
                                        <div key={`${idx}-${line}`} className="rt-bf-final-line">
                                            - {String(line)}
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
