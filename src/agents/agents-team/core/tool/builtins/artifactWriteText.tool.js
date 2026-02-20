import { z } from 'zod';

const InputSchema = z
    .object({
        content: z.string(),
        type: z.enum(['text', 'json', 'stdout', 'stderr', 'mcp_result']).default('text'),
        filename: z.string().min(1).default('content.txt'),
        provenance: z.string().min(1).optional(),
    })
    .strict();

const OutputSchema = z
    .object({
        artifact_id: z.string(),
        type: z.string(),
        path: z.string(),
        hash: z.object({ alg: z.literal('sha256'), value: z.string() }).strict(),
        size_bytes: z.number().int().nonnegative(),
        created_at: z.string(),
        artifact_refs: z
            .array(z.object({ artifact_id: z.string(), type: z.string().optional() }).strict())
            .optional(),
    })
    .strict();

export const artifactWriteTextTool = {
    name: 'artifact.write_text',
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
        const record = await artifactRegistry.writeText({
            content: args.content,
            type: args.type,
            filename: args.filename,
            provenance: args.provenance,
        });

        return {
            artifact_id: record.artifact_id,
            type: record.type,
            path: record.path,
            hash: record.hash,
            size_bytes: record.size_bytes,
            created_at: record.created_at,
            artifact_refs: [{ artifact_id: record.artifact_id, type: record.type }],
        };
    },
};
