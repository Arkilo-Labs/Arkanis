import { z } from 'zod';

import { hashFile } from '../../artifacts/artifactHasher.js';

const InputSchema = z
    .object({
        artifact_id: z.string().min(1),
    })
    .strict();

const OutputSchema = z
    .object({
        artifact_id: z.string(),
        hash: z.object({ alg: z.literal('sha256'), value: z.string() }).strict(),
        size_bytes: z.number().int().nonnegative(),
    })
    .strict();

export const artifactHashTool = {
    name: 'artifact.hash',
    permissions: {
        needs_network: false,
        needs_workspace_write: false,
        needs_host_exec: false,
        needs_secrets: false,
    },
    inputSchema: InputSchema,
    outputSchema: OutputSchema,

    async run(ctx, args) {
        const { artifactRegistry } = ctx;
        const record = artifactRegistry.get(args.artifact_id);
        if (!record) {
            throw new Error(`artifact "${args.artifact_id}" 未找到`);
        }

        const hash = await hashFile(record.path);

        return {
            artifact_id: args.artifact_id,
            hash,
            size_bytes: record.size_bytes,
        };
    },
};
