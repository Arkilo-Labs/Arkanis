import { createHash, randomBytes } from 'node:crypto';

import { ErrorCode } from '../contracts/errors.js';
import { DenyReason } from '../contracts/denyReasons.js';
import { nowIso, durationMs } from '../../../../core/sandbox/utils/clock.js';
import { writeSkillRunRecord } from '../audit/skillAuditWriter.js';

/**
 * SkillRunner — skill 执行流水线。
 *
 * 执行顺序：
 *   白名单检查 → manifest 加载 → 版本核对 → builtin 查找 → 执行 → 写审计
 *
 * 所有执行必须经过 ToolGateway（通过 builtin fn 调用 ctx.toolGateway.call）。
 *
 * @param {object} opts
 * @param {import('./skillRegistry.js').SkillRegistry} opts.skillRegistry
 * @param {string} opts.skillRunsJsonlPath  绝对路径
 * @param {string} opts.skillsDir  skills 根目录（绝对路径）
 * @param {Array<{id:string,version:string}>} opts.allowedSkills  白名单列表
 */
export class SkillRunner {
    constructor({ skillRegistry, skillRunsJsonlPath, skillsDir, allowedSkills = [] }) {
        this._registry = skillRegistry;
        this._auditPath = skillRunsJsonlPath;
        this._skillsDir = skillsDir;
        this._whitelist = new Map(allowedSkills.map((s) => [s.id, s]));
    }

    /**
     * 执行一个 skill。
     *
     * @param {string} skillId
     * @param {object} inputs  未经深度校验的输入（必须是 JSON 可序列化对象）
     * @param {import('../runtime/runContext.js').RunContext} ctx
     * @param {object} [runMeta]
     * @param {string} [runMeta.run_id]
     * @param {string} [runMeta.correlation_id]
     * @param {string} [runMeta.parent_correlation_id]
     * @returns {Promise<{ok:true,outputs:object}|{ok:false,error:object}>}
     */
    async run(skillId, inputs, ctx, runMeta = {}) {
        const startedAt = nowIso();
        const correlationId = runMeta.correlation_id ?? `sr_${randomBytes(6).toString('hex')}`;
        const runId = runMeta.run_id ?? ctx?.runPaths?.runId ?? 'unknown';
        const parentCorrelationId = runMeta.parent_correlation_id;

        // 1. 白名单检查
        if (!this._whitelist.has(skillId)) {
            const error = {
                code: ErrorCode.ERR_POLICY_DENIED,
                message: `skill "${skillId}" 不在白名单中`,
                deny_reason: DenyReason.SKILL_NOT_WHITELISTED,
            };
            const endedAt = nowIso();
            await this._writeAudit({
                runId,
                correlationId,
                parentCorrelationId,
                skillId,
                skillVersion: 'unknown',
                inputs,
                startedAt,
                endedAt,
                ok: false,
                error,
                policyDecision: { decision: 'deny', reason: DenyReason.SKILL_NOT_WHITELISTED },
            });
            return { ok: false, error };
        }

        // 2. manifest 加载（lazy）
        let manifest;
        try {
            try {
                manifest = this._registry.getManifest(skillId);
            } catch {
                manifest = await this._registry.loadManifest(this._skillsDir, skillId);
            }
        } catch (err) {
            const error = {
                code: err.code ?? ErrorCode.ERR_SKILL_NOT_FOUND,
                message: err.message,
            };
            const endedAt = nowIso();
            await this._writeAudit({
                runId,
                correlationId,
                parentCorrelationId,
                skillId,
                skillVersion: 'unknown',
                inputs,
                startedAt,
                endedAt,
                ok: false,
                error,
            });
            return { ok: false, error };
        }

        // 3. 版本核对
        const whitelisted = this._whitelist.get(skillId);
        if (whitelisted.version && manifest.version !== whitelisted.version) {
            const error = {
                code: ErrorCode.ERR_SKILL_VALIDATION_FAILED,
                message: `skill "${skillId}" 版本 ${manifest.version} 与白名单要求 ${whitelisted.version} 不符`,
            };
            const endedAt = nowIso();
            await this._writeAudit({
                runId,
                correlationId,
                parentCorrelationId,
                skillId,
                skillVersion: manifest.version,
                inputs,
                startedAt,
                endedAt,
                ok: false,
                error,
            });
            return { ok: false, error };
        }

        // 4. 实现类型路由
        if (manifest.implementation.type !== 'builtin') {
            const error = {
                code: ErrorCode.ERR_SKILL_VALIDATION_FAILED,
                message: `skill "${skillId}" 实现类型 "${manifest.implementation.type}" 暂不支持`,
            };
            const endedAt = nowIso();
            await this._writeAudit({
                runId,
                correlationId,
                parentCorrelationId,
                skillId,
                skillVersion: manifest.version,
                inputs,
                startedAt,
                endedAt,
                ok: false,
                error,
            });
            return { ok: false, error };
        }

        // 5. builtin fn 查找
        const builtinFn = this._registry.getBuiltin(manifest.implementation.entry);
        if (!builtinFn) {
            const error = {
                code: ErrorCode.ERR_SKILL_VALIDATION_FAILED,
                message: `skill "${skillId}" builtin "${manifest.implementation.entry}" 未注册`,
            };
            const endedAt = nowIso();
            await this._writeAudit({
                runId,
                correlationId,
                parentCorrelationId,
                skillId,
                skillVersion: manifest.version,
                inputs,
                startedAt,
                endedAt,
                ok: false,
                error,
            });
            return { ok: false, error };
        }

        // 6. 执行 builtin（只能通过 ctx.toolGateway.call 操作工具）
        let outputs;
        try {
            outputs = await builtinFn(ctx, inputs, {
                manifest,
                correlationId,
                runId,
            });
        } catch (err) {
            const knownCode = Object.values(ErrorCode).includes(err?.code);
            const error = {
                code: knownCode ? err.code : ErrorCode.ERR_SKILL_VALIDATION_FAILED,
                message: err.message,
            };
            const endedAt = nowIso();
            await this._writeAudit({
                runId,
                correlationId,
                parentCorrelationId,
                skillId,
                skillVersion: manifest.version,
                inputs,
                startedAt,
                endedAt,
                ok: false,
                error,
            });
            return { ok: false, error };
        }

        // 7. 写审计 ok=true
        const endedAt = nowIso();
        await this._writeAudit({
            runId,
            correlationId,
            parentCorrelationId,
            skillId,
            skillVersion: manifest.version,
            inputs,
            startedAt,
            endedAt,
            ok: true,
            artifactRefs: outputs?.artifact_refs,
            toolCorrelationIds: outputs?._tool_correlation_ids,
        });

        return { ok: true, outputs };
    }

    async _writeAudit({
        runId,
        correlationId,
        parentCorrelationId,
        skillId,
        skillVersion,
        inputs,
        startedAt,
        endedAt,
        ok,
        error,
        policyDecision,
        artifactRefs,
        toolCorrelationIds,
    }) {
        if (!this._auditPath) return;
        try {
            const { inputs_hash, inputs_size_bytes } = hashInputs(inputs);
            const base = {
                run_id: runId,
                correlation_id: correlationId,
                ...(parentCorrelationId ? { parent_correlation_id: parentCorrelationId } : {}),
                skill_id: skillId,
                skill_version: skillVersion,
                inputs_hash,
                inputs_size_bytes,
                ...(policyDecision ? { policy_decision: policyDecision } : {}),
                ...(toolCorrelationIds?.length ? { tool_correlation_ids: toolCorrelationIds } : {}),
                ...(artifactRefs?.length ? { artifact_refs: artifactRefs } : {}),
                started_at: startedAt,
                ended_at: endedAt,
                duration_ms: durationMs(startedAt, endedAt),
            };
            const record = ok ? { ...base, ok: true } : { ...base, ok: false, error };
            await writeSkillRunRecord(this._auditPath, record);
        } catch (err) {
            process.stderr.write(`[skill-audit] 写入失败: ${err?.message}\n`);
        }
    }
}

function hashInputs(inputs) {
    const json = JSON.stringify(inputs ?? {});
    const value = createHash('sha256').update(json).digest('hex');
    return {
        inputs_hash: { alg: 'sha256', value },
        inputs_size_bytes: Buffer.byteLength(json, 'utf-8'),
    };
}
