import { z } from 'zod';

import { ErrorCode } from '../../contracts/errors.js';

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
        provider_id: z.string(),
        engine_resolved: z.string(),
        runtime_resolved: z.string(),
        image: z.string(),
        network_policy: z.string(),
        created_at: z.string(),
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
        const { sandboxProvider, sandboxRegistry, runPaths } = ctx;

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

        return {
            sandbox_id: handle.sandbox_id,
            provider_id: handle.provider_id,
            engine_resolved: handle.engine_resolved,
            runtime_resolved: handle.runtime_resolved,
            image: handle.image,
            network_policy: handle.network_policy,
            created_at: handle.created_at,
        };
    },
};
