import { z } from 'zod';
import { SandboxErrorCode } from '../../../../../core/sandbox/contracts/sandboxErrors.js';
import { loadHandleJson } from '../../../../../core/sandbox/audit/sandboxAuditWriter.js';
import { resolveOciEngine } from '../../../../../core/sandbox/index.js';

const InputSchema = z
    .object({
        sandbox_id: z.string().min(1),
    })
    .strict();

const OutputSchema = z
    .object({
        sandbox_id: z.string(),
        destroyed: z.boolean(),
    })
    .strict();

export const sandboxDestroyTool = {
    name: 'sandbox.destroy',
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

        let handle = sandboxRegistry.get(args.sandbox_id);
        if (!handle) {
            handle = await loadHandleJson(runPaths.runDir, args.sandbox_id);
        }

        if (handle) {
            await sandboxProvider.destroy(handle);
        } else {
            // handle 完全丢失：用默认 engine 做 best-effort rm -f（幂等语义）
            try {
                const engineResolved = await resolveOciEngine('auto');
                await sandboxProvider.destroy({ sandbox_id: args.sandbox_id, engine_resolved: engineResolved });
            } catch {
                // 容器可能已不存在，忽略
            }
        }

        sandboxRegistry.remove(args.sandbox_id);
        return { sandbox_id: args.sandbox_id, destroyed: true };
    },
};
