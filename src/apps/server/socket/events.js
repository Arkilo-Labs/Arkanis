export const SOCKET_EVENTS = Object.freeze({
    LOG: 'log',
    PROCESS_EXIT: 'process-exit',

    KILL_PROCESS: 'kill-process',
    PROCESS_KILLED: 'process-killed',

    CONFIG_RELOAD: 'config-reload',
    PROVIDERS_UPDATED: 'providers-updated',

    ROUND_AGENT_SPEAK: 'roundtable:agent-speak',
    ROUND_TOOL_CALL: 'roundtable:tool-call',
    ROUND_BELIEF_UPDATE: 'roundtable:belief-update',
    ROUND_DECISION: 'roundtable:decision',
    ROUND_TOKEN_USAGE: 'roundtable:token-usage',
    LENS_TOKEN_USAGE: 'lens:token-usage',
});

export const ROUND_EVENT_TO_SOCKET_EVENT = Object.freeze({
    'agent-speak': SOCKET_EVENTS.ROUND_AGENT_SPEAK,
    'tool-call': SOCKET_EVENTS.ROUND_TOOL_CALL,
    'belief-update': SOCKET_EVENTS.ROUND_BELIEF_UPDATE,
    decision: SOCKET_EVENTS.ROUND_DECISION,
    'token-usage': SOCKET_EVENTS.ROUND_TOKEN_USAGE,
});

export function resolveRoundtableSocketEvent(type) {
    const key = String(type || '').trim();
    return ROUND_EVENT_TO_SOCKET_EVENT[key] || '';
}

