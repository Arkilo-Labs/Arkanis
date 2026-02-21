import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { resolveUserPath } from '../../artifacts/artifactPaths.js';
import { ErrorCode } from '../../contracts/errors.js';

const MAX_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB

const InputSchema = z
    .object({
        path: z.string().min(1),
        content: z.string(),
    })
    .strict();

const OutputSchema = z
    .object({
        path: z.string(),
        size_bytes: z.number().int().nonnegative(),
    })
    .strict();

export const fileWriteTool = {
    name: 'file.write',
    permissions: {
        needs_network: false,
        needs_workspace_write: false,
        needs_host_exec: false,
        needs_secrets: false,
    },
    inputSchema: InputSchema,
    outputSchema: OutputSchema,

    async run(ctx, args) {
        const { runPaths } = ctx;

        let resolvedPath;
        try {
            resolvedPath = resolveUserPath(runPaths.artifactsDir, args.path);
        } catch (err) {
            throw Object.assign(new Error(`路径越界: "${args.path}"`), {
                code: ErrorCode.ERR_INVALID_ARGUMENT,
            });
        }

        const sizeBytes = Buffer.byteLength(args.content, 'utf-8');
        if (sizeBytes > MAX_CONTENT_BYTES) {
            throw Object.assign(
                new Error(`content 超出最大限制 ${MAX_CONTENT_BYTES} bytes`),
                { code: ErrorCode.ERR_INVALID_ARGUMENT },
            );
        }

        await mkdir(path.dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, args.content, 'utf-8');

        return {
            path: args.path,
            size_bytes: sizeBytes,
        };
    },
};
