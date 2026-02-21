import { z } from 'zod';

import { writeHandleJson, writeEnvFingerprint } from '../../../../../core/sandbox/audit/sandboxAuditWriter.js';

const InputSchema = z
    .object({
        image: z.string().min(1).optional(),
        network: z.enum(['off', 'restricted', 'full']).optional(),
        timeout_ms: z.number().int().positive().optional(),
    })
    .strict();

const OutputSchema = z
    .object({
        sandbox_id: z.string(),
        run_id: z.string(),
        provider_id: z.string(),
        engine_resolved: z.string(),
        runtime_resolved: z.string(),
        image: z.string(),
        network_policy: z.string(),
        created_at: z.string(),
        sandbox_ref: z
            .object({ provider_id: z.string(), sandbox_id: z.string() })
            .strict()
            .optional(),
    })
    .strict();

export const sandboxCreateTool = {
    name: 'sandbox.create',
    permissions: {
        needs_network: false,
        needs_workspace_write: false,
        needs_host_exec: false,
        needs_secrets: false,
    },
    inputSchema: InputSchema,
    outputSchema: OutputSchema,

    async run(ctx, args) {
        const { sandboxProvider, sandboxRegistry, runPaths, policyEngine } = ctx;

        // sandbox 本身要用网络时，检查系统 policy 是否允许
        if (args.network && args.network !== 'off') {
            const check = policyEngine.check({ needs_network: true });
            if (!check.ok) {
                const err = new Error(check.error.message);
                Object.assign(err, check.error);
                throw err;
            }
        }

        const spec = {
            engine: 'auto',
            runtime: 'auto',
            mode: 'sandboxed',
            network_policy: args.network ?? 'off',
            workspace_access: 'none',
            ...(args.image ? { image: args.image } : {}),
            ...(args.timeout_ms ? { resources: { max_wall_clock_ms: args.timeout_ms } } : {}),
        };

        const handle = await sandboxProvider.createSandbox(spec, {
            artifactsDir: runPaths.artifactsDir,
        });

        sandboxRegistry.register(handle);

        // 持久化 handle 供跨进程回读，并写初始 env_fingerprint
        await writeHandleJson(runPaths.runDir, handle.sandbox_id, handle);
        const snapshot = await sandboxProvider.snapshot(handle);
        await writeEnvFingerprint(runPaths.runDir, handle.sandbox_id, snapshot);

        return {
            sandbox_id: handle.sandbox_id,
            run_id: runPaths.runId,
            provider_id: handle.provider_id,
            engine_resolved: handle.engine_resolved,
            runtime_resolved: handle.runtime_resolved,
            image: handle.image,
            network_policy: handle.network_policy,
            created_at: handle.created_at,
            sandbox_ref: { provider_id: handle.provider_id, sandbox_id: handle.sandbox_id },
        };
    },
};
