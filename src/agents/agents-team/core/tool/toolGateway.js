import { createHash, randomBytes } from 'node:crypto';

import { ErrorCode } from '../contracts/errors.js';
import { writeToolCallRecord } from '../audit/toolAuditWriter.js';
import { nowIso, durationMs } from '../../../../core/sandbox/utils/clock.js';

/**
 * ToolGateway — 工具调用的统一入口。
 *
 * 流程：inputSchema 校验 → PolicyEngine → run → outputSchema 校验 → 写审计
 * deny 时仍写审计（ok=false）。
 *
 * @param {object} deps
 * @param {import('./toolRegistry.js').ToolRegistry} deps.toolRegistry
 * @param {import('../policy/policyEngine.js').PolicyEngine} deps.policyEngine
 * @param {string} deps.toolCallsJsonlPath  绝对路径
 */
export class ToolGateway {
    constructor({ toolRegistry, policyEngine, toolCallsJsonlPath }) {
        this._registry = toolRegistry;
        this._policy = policyEngine;
        this._auditPath = toolCallsJsonlPath;
    }

    /**
     * 调用工具并返回 ToolResult。
     *
     * @param {string} toolName
     * @param {object} rawArgs  未经验证的参数对象
     * @param {object} ctx  RunContext（传给 tool.run）
     * @param {object} [callMeta]
     * @param {string} [callMeta.run_id]
     * @param {string} [callMeta.correlation_id]
     * @param {string} [callMeta.parent_correlation_id]
     * @returns {Promise<import('../contracts/tool.schema.js').ToolResult>}
     */
    async call(toolName, rawArgs, ctx, callMeta = {}) {
        const startedAt = nowIso();
        const correlationId = callMeta.correlation_id ?? `tc_${randomBytes(6).toString('hex')}`;
        const runId = callMeta.run_id ?? ctx?.runPaths?.runId ?? 'unknown';

        // 1. tool 查找
        let tool;
        try {
            tool = this._registry.get(toolName);
        } catch (err) {
            const endedAt = nowIso();
            const record = buildAuditRecord({
                runId,
                correlationId,
                parentCorrelationId: callMeta.parent_correlation_id,
                toolName,
                rawArgs,
                startedAt,
                endedAt,
                ok: false,
                error: { code: ErrorCode.ERR_TOOL_NOT_FOUND, message: err.message },
            });
            await this._writeAudit(record);
            return { ok: false, error: record.error };
        }

        // 2. inputSchema 校验
        let args;
        try {
            args = tool.inputSchema.parse(rawArgs);
        } catch (err) {
            const endedAt = nowIso();
            const error = {
                code: ErrorCode.ERR_INVALID_ARGUMENT,
                message: `tool "${toolName}" 参数校验失败: ${err.message}`,
            };
            const record = buildAuditRecord({
                runId,
                correlationId,
                parentCorrelationId: callMeta.parent_correlation_id,
                toolName,
                rawArgs,
                startedAt,
                endedAt,
                ok: false,
                error,
            });
            await this._writeAudit(record);
            return { ok: false, error };
        }

        // 3. policy 检查
        const policyCheck = this._policy.check(tool.permissions ?? {});
        if (!policyCheck.ok) {
            const endedAt = nowIso();
            const record = buildAuditRecord({
                runId,
                correlationId,
                parentCorrelationId: callMeta.parent_correlation_id,
                toolName,
                rawArgs,
                startedAt,
                endedAt,
                ok: false,
                error: policyCheck.error,
                policyDecision: policyCheck.policy_decision,
            });
            await this._writeAudit(record);
            return { ok: false, error: policyCheck.error };
        }

        // 4. 执行 tool
        let runResult;
        try {
            runResult = await tool.run(ctx, args);
        } catch (err) {
            const endedAt = nowIso();
            const error = {
                code: ErrorCode.ERR_TOOL_EXEC_FAILED,
                message: `tool "${toolName}" 执行失败: ${err.message}`,
            };
            const record = buildAuditRecord({
                runId,
                correlationId,
                parentCorrelationId: callMeta.parent_correlation_id,
                toolName,
                rawArgs,
                startedAt,
                endedAt,
                ok: false,
                error,
                policyDecision: policyCheck.policy_decision,
            });
            await this._writeAudit(record);
            return { ok: false, error };
        }

        // 5. outputSchema 校验
        let data;
        try {
            data = tool.outputSchema.parse(runResult);
        } catch (err) {
            const endedAt = nowIso();
            const error = {
                code: ErrorCode.ERR_TOOL_EXEC_FAILED,
                message: `tool "${toolName}" 输出 schema 校验失败: ${err.message}`,
            };
            const record = buildAuditRecord({
                runId,
                correlationId,
                parentCorrelationId: callMeta.parent_correlation_id,
                toolName,
                rawArgs,
                startedAt,
                endedAt,
                ok: false,
                error,
                policyDecision: policyCheck.policy_decision,
            });
            await this._writeAudit(record);
            return { ok: false, error };
        }

        // 6. 审计 ok=true
        const endedAt = nowIso();
        const record = buildAuditRecord({
            runId,
            correlationId,
            parentCorrelationId: callMeta.parent_correlation_id,
            toolName,
            rawArgs,
            startedAt,
            endedAt,
            ok: true,
            policyDecision: policyCheck.policy_decision,
            sandboxRef: data?.sandbox_ref,
            artifactRefs: data?.artifact_refs,
            mcpRef: data?.mcp_ref,
        });
        await this._writeAudit(record);

        return { ok: true, data };
    }

    async _writeAudit(record) {
        if (!this._auditPath) return;
        try {
            await writeToolCallRecord(this._auditPath, record);
        } catch (err) {
            process.stderr.write(`[tool-audit] 写入失败: ${err?.message}\n`);
        }
    }
}

// ──────────────────────────────────────────────
// 内部辅助

function hashArgs(rawArgs) {
    const json = JSON.stringify(rawArgs ?? {});
    const h = createHash('sha256').update(json).digest('hex');
    return {
        args_hash: { alg: 'sha256', value: h },
        args_size_bytes: Buffer.byteLength(json, 'utf-8'),
    };
}

function buildAuditRecord({
    runId,
    correlationId,
    parentCorrelationId,
    toolName,
    rawArgs,
    startedAt,
    endedAt,
    ok,
    error,
    policyDecision,
    sandboxRef,
    artifactRefs,
    mcpRef,
}) {
    const { args_hash, args_size_bytes } = hashArgs(rawArgs);
    const base = {
        run_id: runId,
        correlation_id: correlationId,
        tool_name: toolName,
        args_hash,
        args_size_bytes,
        ...(parentCorrelationId ? { parent_correlation_id: parentCorrelationId } : {}),
        ...(policyDecision ? { policy_decision: policyDecision } : {}),
        ...(sandboxRef ? { sandbox_ref: sandboxRef } : {}),
        ...(artifactRefs ? { artifact_refs: artifactRefs } : {}),
        ...(mcpRef ? { mcp_ref: mcpRef } : {}),
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: durationMs(startedAt, endedAt),
    };

    if (ok) return { ...base, ok: true };
    return { ...base, ok: false, error };
}
