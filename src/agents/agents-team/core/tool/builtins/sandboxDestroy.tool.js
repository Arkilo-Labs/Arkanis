import { z } from 'zod';
import { SandboxErrorCode } from '../../../../../core/sandbox/contracts/sandboxErrors.js';

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
        const { sandboxProvider, sandboxRegistry } = ctx;

        const handle = sandboxRegistry.get(args.sandbox_id);
        if (!handle) {
            const err = new Error(`sandbox ${args.sandbox_id} 未在 registry 中找到`);
            err.code = SandboxErrorCode.ERR_SANDBOX_NOT_FOUND;
            throw err;
        }

        await sandboxProvider.destroy(handle);
        sandboxRegistry.remove(args.sandbox_id);

        return { sandbox_id: args.sandbox_id, destroyed: true };
    },
};
