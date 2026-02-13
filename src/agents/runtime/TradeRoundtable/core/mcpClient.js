import { spawn } from 'child_process';
import { once } from 'events';

function withTimeout(promise, timeoutMs, label) {
    const t = Math.max(1, Number(timeoutMs) || 0);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} 超时（${t}ms）`)), t);
        promise
            .then((v) => {
                clearTimeout(timer);
                resolve(v);
            })
            .catch((e) => {
                clearTimeout(timer);
                reject(e);
            });
    });
}

function jsonLine(obj) {
    return JSON.stringify(obj);
}

export class McpClient {
    constructor({ serversConfig, logger, stderrMode = 'quiet' }) {
        this.serversConfig = serversConfig;
        this.logger = logger;
        this.stderrMode = stderrMode;
        this._servers = new Map();
        this._nextId = 1;
    }

    async _rawCall(serverName, method, params) {
        const state = this._servers.get(serverName);
        if (!state) throw new Error(`MCP server 未启动: ${serverName}`);
        if (state.startError) {
            const msg = state.startError?.message ? String(state.startError.message) : String(state.startError);
            throw new Error(`MCP 启动失败：${msg}`);
        }

        const id = this._nextId++;
        const req = { jsonrpc: '2.0', id, method, params: params ?? {} };

        const promise = new Promise((resolve, reject) => {
            state.pending.set(id, { resolve, reject });
        });

        try {
            state.child.stdin.write(`${jsonLine(req)}\n`);
        } catch (e) {
            throw new Error(`MCP 写入失败：${e.message}`);
        }

        const res = await promise;
        if (res.error) {
            throw new Error(`[mcp:${serverName}] ${res.error.message || '未知错误'}`);
        }
        return res.result;
    }

    async _notify(serverName, method, params) {
        const state = this._servers.get(serverName);
        if (!state) throw new Error(`MCP server 未启动: ${serverName}`);
        const req = { jsonrpc: '2.0', method, params: params ?? {} };
        try {
            state.child.stdin.write(`${jsonLine(req)}\n`);
        } catch (e) {
            throw new Error(`MCP 通知写入失败：${e.message}`);
        }
    }

    async _ensureInitialized(serverName) {
        const state = this._servers.get(serverName);
        if (!state) throw new Error(`MCP server 未启动: ${serverName}`);
        if (state.initialized) return;
        if (state.initPromise) return state.initPromise;

        state.initPromise = (async () => {
            // MCP 需要初始化握手，否则 tools/* 会被拒绝
            const init = await this._rawCall(serverName, 'initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'TradeRoundtable', version: '1.0' },
            });
            await this._notify(serverName, 'notifications/initialized', {});
            state.initialized = true;
            return init;
        })().catch((e) => {
            state.initPromise = null;
            throw e;
        });

        return state.initPromise;
    }

    async start(serverName) {
        if (this._servers.has(serverName)) return;

        const cfg = this.serversConfig?.mcpServers?.[serverName];
        if (!cfg) throw new Error(`MCP 未配置 server: ${serverName}`);
        if (cfg.type !== 'stdio') throw new Error(`MCP server 类型不支持: ${cfg.type}`);

        const resolveEnvArg = (arg) => {
            const s = String(arg ?? '');
            return s.replace(/\$\{ENV:([A-Z0-9_]+)\}/gi, (_, name) => {
                const v = String(process.env[name] || '').trim();
                if (!v) throw new Error(`MCP 参数需要环境变量 ${name}，但未设置`);
                return v;
            });
        };

        const args = Array.isArray(cfg.args) ? cfg.args.map(resolveEnvArg) : [];
        const child = spawn(cfg.command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        const state = {
            child,
            pending: new Map(),
            buffer: '',
            startError: null,
            initialized: false,
            initPromise: null,
        };

        child.on('error', (err) => {
            state.startError = err;
            const msg = err?.message ? String(err.message) : String(err);
            this.logger.error(`[mcp:${serverName}] 启动失败：${msg}`);
            for (const [, p] of state.pending.entries()) {
                try {
                    p.reject(err);
                } catch {
                    // ignore
                }
            }
            state.pending.clear();
        });

        child.stderr.on('data', (buf) => {
            const raw = String(buf || '');
            const lines = raw.split(/\r?\n/);
            for (const line of lines) {
                const s = String(line || '').trim();
                if (!s) continue;

                if (this.stderrMode === 'verbose') {
                    this.logger.warn(`[mcp:${serverName}] ${s}`);
                    continue;
                }
                if (this.stderrMode === 'silent') {
                    continue;
                }

                // quiet：屏蔽 FastMCP 启动横幅与常规 INFO，只保留明显错误线索
                const errorHints = ['ERROR', 'Traceback', 'Exception', 'Failed', 'invalid', 'Invalid', 'FATAL'];
                if (errorHints.some((k) => s.includes(k))) {
                    this.logger.warn(`[mcp:${serverName}] ${s}`);
                }
            }
        });

        child.stdout.on('data', (buf) => {
            state.buffer += String(buf || '');
            for (;;) {
                const idx = state.buffer.indexOf('\n');
                if (idx < 0) break;
                const line = state.buffer.slice(0, idx).trim();
                state.buffer = state.buffer.slice(idx + 1);
                if (!line) continue;
                try {
                    const msg = JSON.parse(line);
                    const id = msg?.id;
                    if (id != null && state.pending.has(id)) {
                        state.pending.get(id).resolve(msg);
                        state.pending.delete(id);
                    }
                } catch (e) {
                    this.logger.warn(`[mcp:${serverName}] 无法解析输出：${e.message}`);
                }
            }
        });

        this._servers.set(serverName, state);
    }

    async call(serverName, method, params) {
        await this.start(serverName);
        if (String(method) !== 'initialize' && String(method) !== 'initialized') {
            await this._ensureInitialized(serverName);
        }
        return this._rawCall(serverName, method, params);
    }

    async stopAll() {
        for (const [name, state] of this._servers.entries()) {
            try {
                if (state.child.killed) continue;

                // 先温和关闭，再兜底强杀，避免进程句柄把 Node 挂住
                state.child.kill();
                await withTimeout(Promise.race([once(state.child, 'exit'), once(state.child, 'close')]), 3000, `mcp:${name} 关闭`);
            } catch (e) {
                try {
                    state.child.kill('SIGKILL');
                } catch {
                    // ignore
                }
                this.logger.warn(`[mcp:${name}] 关闭失败：${e.message}`);
            }
        }
        this._servers.clear();
    }
}
