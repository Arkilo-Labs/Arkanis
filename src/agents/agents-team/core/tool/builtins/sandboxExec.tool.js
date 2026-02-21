import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import {
    writeCommandRecord,
    writeOutputLogs,
    writeEnvFingerprint,
    loadHandleJson,
} from '../../../../../core/sandbox/audit/sandboxAuditWriter.js';
import { ErrorCode } from '../../contracts/errors.js';

const InputSchema = z
    .object({
        sandbox_id: z.string().min(1),
        cmd: z.string().min(1),
        args: z.array(z.string()).default([]),
        cwd: z.string().min(1).optional(),
        timeout_ms: z.number().int().positive().optional(),
    })
    .strict();

const OutputSchema = z
    .object({
        ok: z.boolean(),
        exit_code: z.number().int().nullable(),
        timed_out: z.boolean(),
        stdout_preview: z.string(),
        stderr_preview: z.string(),
        stdout_truncated: z.boolean(),
        stderr_truncated: z.boolean(),
        stdout_bytes: z.number().int().nonnegative(),
        stderr_bytes: z.number().int().nonnegative(),
        sandbox_ref: z
            .object({ provider_id: z.string(), sandbox_id: z.string() })
            .strict()
            .optional(),
        error: z
            .object({ code: z.string(), message: z.string() })
            .strict()
            .optional(),
    })
    .strict();

const PREVIEW_MAX_BYTES = 4096;

export const sandboxExecTool = {
    name: 'sandbox.exec',
    permissions: {
        needs_network: false,
        needs_workspace_write: false,
        needs_host_exec: false,
        needs_secrets: false,
    },
    inputSchema: InputSchema,
    outputSchema: OutputSchema,

    async run(ctx, args, { correlationId: parentCorrelationId } = {}) {
        const { sandboxProvider, sandboxRegistry, runPaths } = ctx;

        let handle = sandboxRegistry.get(args.sandbox_id);
        if (!handle) {
            handle = await loadHandleJson(runPaths.runDir, args.sandbox_id);
        }
        if (!handle) {
            return {
                ok: false,
                exit_code: null,
                timed_out: false,
                stdout_preview: '',
                stderr_preview: '',
                stdout_truncated: false,
                stderr_truncated: false,
                stdout_bytes: 0,
                stderr_bytes: 0,
                error: {
                    code: ErrorCode.ERR_SANDBOX_NOT_FOUND,
                    message: `sandbox ${args.sandbox_id} 不在 registry 中，且未找到 handle.json`,
                },
            };
        }

        const execSpec = {
            cmd: args.cmd,
            args: args.args ?? [],
            ...(args.cwd ? { cwd: args.cwd } : {}),
            ...(args.timeout_ms ? { timeout_ms: args.timeout_ms } : {}),
        };

        const result = await sandboxProvider.exec(handle, execSpec);

        // 写 sandbox 审计（correlation_id 关联到上层 tool_calls.jsonl 的记录）
        const correlationId = `cmd_${randomBytes(4).toString('hex')}`;
        await writeCommandRecord(runPaths.runDir, handle.sandbox_id, {
            run_id: runPaths.runId,
            sandbox_id: handle.sandbox_id,
            provider_id: handle.provider_id,
            correlation_id: correlationId,
            ...(parentCorrelationId ? { parent_correlation_id: parentCorrelationId } : {}),
            cmd: args.cmd,
            args: args.args ?? [],
            ...(args.cwd ? { cwd: args.cwd } : {}),
            started_at: result.started_at,
            ended_at: result.ended_at,
            duration_ms: result.duration_ms,
            timeout_ms: args.timeout_ms ?? handle.resources?.max_wall_clock_ms ?? 60000,
            timed_out: result.timed_out,
            exit_code: result.exit_code ?? null,
            signal: result.signal ?? null,
            workspace_access: handle.workspace_access,
            network_policy: handle.network_policy,
            stdout_bytes: result.stdout_bytes,
            stderr_bytes: result.stderr_bytes,
            stdout_truncated: result.stdout_truncated,
            stderr_truncated: result.stderr_truncated,
            stdout_max_bytes: result.stdout_max_bytes,
            stderr_max_bytes: result.stderr_max_bytes,
            ok: result.ok,
            ...(result.ok ? {} : { error: result.error }),
        });

        await writeOutputLogs(runPaths.runDir, handle.sandbox_id, {
            stdout: result.stdout,
            stderr: result.stderr,
        });

        // 写 env_fingerprint（每次 exec 更新）
        const snapshot = await sandboxProvider.snapshot(handle);
        await writeEnvFingerprint(runPaths.runDir, handle.sandbox_id, snapshot);

        const stdoutPreview = result.stdout.slice(0, PREVIEW_MAX_BYTES);
        const stderrPreview = result.stderr.slice(0, PREVIEW_MAX_BYTES);

        return {
            ok: result.ok,
            exit_code: result.exit_code ?? null,
            timed_out: result.timed_out,
            stdout_preview: stdoutPreview,
            stderr_preview: stderrPreview,
            stdout_truncated: result.stdout_truncated,
            stderr_truncated: result.stderr_truncated,
            stdout_bytes: result.stdout_bytes,
            stderr_bytes: result.stderr_bytes,
            sandbox_ref: { provider_id: handle.provider_id, sandbox_id: handle.sandbox_id },
            ...(result.ok ? {} : { error: result.error }),
        };
    },
};
